'use strict';

/**
 * PayPal – a payment link in the order ticket that confirms itself, like Stripe.
 *
 * With PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET in .env (a PayPal REST app), an order placed with the PayPal
 * payment method gets a PayPal link for its total right away. The customer approves the payment on PayPal; the
 * bot checks the open links every 30 s (no webhook or public address needed) and only then TAKES the money
 * (capture) – and only while the order still wants it: a closed, deleted or otherwise paid order is never
 * charged, and a changed total gets a new link instead. Once the money is taken the order is set to Paid and
 * the seller is pinged (src/features/autopay.js). Without keys the PayPal card shows a paypal.me link
 * (src/features/paycards.js).
 *
 * ticket.order.paypal = { orderId, url, amount, currency, createdAt, attempt, messageId, previous: [{ orderId, createdAt }],
 *   status ('open' | 'paid' | 'expired' | 'held'), paidAt, paidAmount, paidCurrency, captureId,
 *   captureTries, captureError, nextCaptureAt, pendingSince, pendingReason, heldAt }
 *   held – approved after the order was already marked paid: not taken; staff can take it (Take PayPal payment)
 * ticket.paypalAttempts – links made so far (each try gets its own PayPal-Request-Id)
 */

const { ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const tickets = require('../tickets/tickets');
const autopay = require('./autopay');
const { env } = require('../env');
const { statusOf } = require('../lib/orderStatus');
const { isStaff } = require('../lib/permissions');
const { COLORS, ce } = require('../lib/theme');
const { currencyCode, decimalString } = require('../lib/currency');
const { UserError, logEmbed, money, pad, ts, truncate, sendTicketLog } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, v2, notice, channelUrl } = require('../lib/v2');
const { orderTitle } = require('../lib/orderItems');

const CHECK_EVERY = 30_000;
const WATCH_FOR = 3 * 24 * 3_600_000; // links that never report back stop being checked after this
const NEW_LINK_COOLDOWN = 60_000;
const { PAID } = autopay;
/** Currencies PayPal takes (with lib/currency.js decimals). */
const SUPPORTED = ['eur', 'usd', 'gbp', 'pln', 'chf', 'sek', 'nok', 'dkk', 'czk', 'cad', 'aud', 'nzd', 'jpy'];

/** "eur" – config.json → paypal.currency or from shop.currency; null when unclear or not taken by PayPal. */
function currency() {
  const cur = currencyCode(config.paypal?.currency);
  return SUPPORTED.includes(cur) ? cur : null;
}

const hasKeys = () => Boolean(env.paypalClientId && env.paypalSecret);
let keyRefused = false;
const refusedWarned = new Set();

/** Open links get checked: keys that work (as far as we know). */
const working = () => hasKeys() && !keyRefused;
/** New links are made: keys, a currency PayPal takes and config.json → paypal.enabled isn't false. */
const enabled = () => hasKeys() && config.paypal?.enabled !== false && currency() != null;
/** The order has a PayPal link that confirms itself – "Pay" isn't needed then. */
const confirmsItself = (ticket) => ticket?.order?.paypal?.status === 'open' && working();

const isPaypalOrder = (order) => require('./paycards').methodType(require('./paycards').methodOf(order)) === 'paypal';

// ───────────── PayPal API (plain HTTPS, no extra package) ─────────────

const base = () => (env.paypalSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com');
let token = { value: null, until: 0 };

function apiError(res, data) {
  const err = new Error(data?.details?.[0]?.description ?? data?.message ?? data?.error_description ?? `PayPal odpowiedział ${res.status}`);
  err.status = res.status;
  err.issue = data?.details?.[0]?.issue ?? data?.name ?? data?.error ?? null;
  return err;
}

async function accessToken() {
  if (token.value && Date.now() < token.until) return token.value;
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.paypalClientId}:${env.paypalSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const err = apiError(res, data);
    err.refused = res.status === 401 || res.status === 403;
    if (err.refused) keyRefused = true;
    throw err;
  }
  token = { value: data.access_token, until: Date.now() + Math.max(60, (Number(data.expires_in) || 0) - 120) * 1000 };
  return token.value;
}

async function call(method, path, body = null, { requestId } = {}) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(requestId && { 'PayPal-Request-Id': requestId }),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) token = { value: null, until: 0 }; // an expired token – the next call gets a new one
  if (!res.ok) throw apiError(res, data);
  keyRefused = false;
  refusedWarned.clear();
  return data;
}

/** The order as PayPal sees it – null when it doesn't exist (any more). */
const getOrder = (id) =>
  call('GET', `/v2/checkout/orders/${encodeURIComponent(id)}`).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });

function createOrder(guild, ticket, order, cur, attempt) {
  const back = channelUrl(guild.id, ticket.channelId);
  return call(
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: ticket.channelId,
          custom_id: ticket.channelId,
          description: truncate(`Zamówienie ${config.brand.name} #${pad(ticket.number)} – ${orderTitle(order, { max: 120 })}`, 127),
          amount: { currency_code: cur.toUpperCase(), value: decimalString(order.total, cur) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: truncate(config.brand.name, 127),
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: back,
            cancel_url: back,
          },
        },
      },
    },
    { requestId: `hs-${ticket.channelId}-${attempt}` },
  );
}

/**
 * Takes the approved money. Retrying the same try uses the same request id – PayPal never takes it twice; only
 * after PayPal said no (e.g. a declined card) does the next try get a new id, so a re-approval isn't answered
 * with the old refusal.
 */
const captureOrder = (id, tries = 0) => call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { requestId: `hs-capture-${id}${tries ? `-${tries}` : ''}` });

const approveUrl = (o) => (o?.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;
const captureOf = (o) => o?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;

const CAPTURE_RETRY = 2 * 60_000; // after a refused capture
const MAX_CAPTURE_TRIES = 10;
const PENDING_REMIND = 24 * 3_600_000;

// ───────────── The card in the ticket ─────────────

/** What the customer is told about getting the product after paying with a link (PayPal / Stripe). */
const deliveryNote = (ticket) =>
  ticket.order?.topUp
    ? require('./balance').PAID_NOTE // a balance top-up – no product
    : require('./delivery').deliverable(ticket.guildId, ticket) // here – delivery.js needs this file's neighbours
    ? '📦 **Dostawa natychmiastowa:** produkt trafi tutaj i do Twoich DM zaraz po zapłacie – zwykle w mniej niż 30 sekund, najpóźniej w 1–5 minut. Nie dotarł? Napisz tutaj albo kliknij **Wezwij pomoc**.'
    : '📦 Po zapłacie zamówienie potwierdzi się tutaj automatycznie, a sprzedawca od razu je dostarczy.';

function linkCard(guild, ticket, p) {
  const total = money(p.amount);
  const c = container(p.status === 'paid' ? COLORS.success : ['expired', 'held'].includes(p.status) || p.captureError ? COLORS.warning : COLORS.brand);
  if (p.status === 'paid') {
    c.addTextDisplayComponents(text(`## ✅ Opłacone przez PayPal\n**${money(p.paidAmount ?? p.amount)}** za zamówienie \`#${pad(ticket.number)}\` – otrzymano ${ts(p.paidAt, 'R')}.`));
    return v2(c);
  }
  if (p.status === 'held') {
    c.addTextDisplayComponents(
      text(
        `## ⏸️ Płatność PayPal nie została pobrana\nKlient zatwierdził **${total}** w PayPal, ale zamówienie \`#${pad(ticket.number)}\` było już oznaczone jako opłacone – dlatego pieniądze **nie** zostały pobrane.\n` +
          '-# Zespół: pieniądze nie dotarły inną drogą? Pobierz je teraz.',
      ),
    );
    c.addActionRowComponents(row(btn('paypal:take', 'Pobierz płatność PayPal', '💰', ButtonStyle.Primary)));
    return v2(c);
  }
  if (p.status === 'expired') {
    c.addTextDisplayComponents(text(`## 💳 Link PayPal już nie działa\nLink PayPal do zamówienia \`#${pad(ticket.number)}\` (**${total}**) został zamknięty.\n-# Nadal chcesz zapłacić przez PayPal? Wygeneruj nowy link.`));
    c.addActionRowComponents(row(btn('paypal:new', 'Nowy link do płatności', '🔄', ButtonStyle.Primary)));
    return v2(c);
  }
  if (p.pendingSince) {
    c.addTextDisplayComponents(
      text(`## ⏳ PayPal przetwarza Twoją płatność\nZapłacono **${total}** za zamówienie \`#${pad(ticket.number)}\` – PayPal jeszcze sprawdza płatność. **Nie płać ponownie** – potwierdzimy ją tutaj, gdy tylko PayPal ją zwolni.`),
    );
    return v2(c);
  }
  c.addTextDisplayComponents(
    text(`## ${guild ? ce(guild, 'paypal') : '💳'} Zapłać ${total} – PayPal\n-# Zamówienie \`#${pad(ticket.number)}\`\nZapłać kontem PayPal lub kartą na bezpiecznej stronie PayPal.`),
  );
  c.addTextDisplayComponents(text(deliveryNote(ticket)));
  if (p.captureError) {
    c.addTextDisplayComponents(text('⚠️ **PayPal nie mógł pobrać płatności** – Twoje konto **nie** zostało obciążone. Otwórz link ponownie i wybierz inną kartę lub saldo PayPal albo wygeneruj nowy link.'));
  }
  c.addSeparatorComponents(divider());
  const fits = p.url.length <= 512;
  c.addTextDisplayComponents(
    text(`${fits ? '' : `**[💳 Zapłać ${total} przez PayPal](${p.url})**\n`}-# Po zapłacie zamówienie potwierdzi się tutaj automatycznie w ciągu minuty. Link nie działa? Wygeneruj nowy.`),
  );
  c.addActionRowComponents(row(...(fits ? [linkBtn(p.url, truncate(`Zapłać ${total} przez PayPal`, 80), '💳')] : []), btn('paypal:new', 'Nowy link', '🔄')));
  return v2(c);
}

/** Merges into the CURRENT order (never an older copy – a status set meanwhile stays). */
function savePaypal(channelId, patch, { replace = false } = {}) {
  const order = tickets.orderDetails(db.getTicket(channelId));
  return db.updateTicket(channelId, { order: { ...order, paypal: replace ? patch : { ...order.paypal, ...patch } } });
}

async function editCard(guild, ticket) {
  const channel = guild?.channels.cache.get(ticket.channelId);
  const id = ticket.order?.paypal?.messageId;
  const message = channel && id ? await channel.messages.fetch(id).catch(() => null) : null;
  if (message) await message.edit(linkCard(guild, ticket, ticket.order.paypal)).catch(() => null);
}

/**
 * Tells about a link: `customer` goes into the ticket (when it's open), `staff` into the ticket with a ping of the
 * claimer / sellers and into the log – the log pings them when the ticket is gone.
 */
async function tell(guild, ticket, { customer = null, staff = null, color = COLORS.warning } = {}) {
  const open = ticket.status === 'open';
  const channel = ticket.status === 'deleted' ? null : guild.channels.cache.get(ticket.channelId) ?? null;
  if (customer && channel && open) await channel.send(notice(color, customer)).catch(() => null);
  if (!staff) return;
  const pings = autopay.pingsFor(guild, ticket);
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  if (channel) await channel.send(notice(color, `${staff}${who ? `\n${who}` : ''}`, { mentions: pings })).catch(() => null);
  await sendTicketLog(guild, {
    ...(!channel && who && { content: who, allowedMentions: pings }),
    embeds: [
      logEmbed(color, '💳 PayPal', guild.client.user).setDescription(truncate(`${staff}\n**Ticket:** <#${ticket.channelId}> (\`#${pad(ticket.number)}\`) · <@${ticket.ownerId}>`, 4000)),
    ],
  }).catch(() => null);
}

/** The link stops being watched; the ticket card shows "Pay" again. */
async function expire(guild, channelId, messages = {}) {
  const updated = savePaypal(channelId, { status: 'expired' });
  await editCard(guild, updated);
  const channel = updated.status === 'open' ? guild.channels.cache.get(channelId) : null;
  if (channel) await tickets.refreshControlMessage(channel, updated).catch(() => null);
  if (messages.customer || messages.staff) await tell(guild, updated, messages);
  return 'expired';
}

// ───────────── Settling a link ─────────────

/**
 * Does the ticket still want this money → { ok } or { ok: false, reason }:
 * 'paid' – completed or paid another way · 'closed' – closed or deleted · 'total' – the total or currency changed.
 */
function wantsPayment(ticket) {
  const p = ticket.order?.paypal;
  const total = tickets.orderDetails(ticket).total;
  if (ticket.completedAt || PAID.includes(ticket.order?.status)) return { ok: false, reason: 'paid' };
  if (ticket.status !== 'open') return { ok: false, reason: 'closed' };
  if (total == null || Math.abs(total - p.amount) >= 0.005 || p.currency !== currency()) return { ok: false, reason: 'total', total }; // p.amount is the total the link was made for
  return { ok: true };
}

async function markPaid(guild, ticket, cap) {
  const before = autopay.statusBefore(ticket);
  const cur = String(cap?.amount?.currency_code ?? ticket.order.paypal.currency).toLowerCase();
  const paidAmount = cap?.amount?.value != null ? Number(cap.amount.value) : ticket.order.paypal.amount;
  const updated = savePaypal(ticket.channelId, { status: 'paid', paidAt: Date.now(), paidAmount, paidCurrency: cur, captureId: cap?.id ?? null, pendingSince: null });
  await autopay.paymentReceived(guild, updated, {
    gateway: 'PayPal',
    paidAmount,
    paidCurrency: cur,
    expectedCurrency: currency(),
    reference: cap?.id ?? updated.order.paypal.orderId,
    before,
    refreshCard: (t) => editCard(guild, t),
  });
  return 'paid';
}

const declined = (guild, channelId) =>
  expire(guild, channelId, {
    customer: '💳 PayPal odrzucił płatność – Twoje konto **nie** zostało obciążone. Wygeneruj nowy link albo zapłać inną metodą.',
    staff: '💳 PayPal odrzucił płatność za to zamówienie – nic nie zostało pobrane.',
  });

/** The money was taken – or PayPal is still processing it (pending: the customer is charged, the shop has to wait). */
async function captured(guild, channelId, o) {
  const ticket = db.getTicket(channelId);
  const cap = captureOf(o);
  if (cap?.status === 'COMPLETED') return markPaid(guild, ticket, cap);
  if (cap && ['DECLINED', 'FAILED', 'REFUNDED'].includes(cap.status)) return declined(guild, channelId);
  const p = ticket.order.paypal;
  const reason = cap?.status_details?.reason ?? null;
  const manual = reason === 'RECEIVING_PREFERENCE_MANDATES_MANUAL_ACTION';
  const what =
    `⏳ Płatność PayPal na **${money(p.amount)}** jest **w toku**${reason ? ` (\`${truncate(reason, 60)}\`)` : ''} – klient zapłacił, ale PayPal jeszcze jej nie zwolnił.` +
    (manual ? ' **Zaakceptuj ją na swoim koncie PayPal** (Aktywność → ta płatność → Akceptuj) – inaczej PayPal ją zwróci.' : ' Zamówienie dostanie tutaj status Opłacone, gdy tylko PayPal ją zwolni.');
  if (!p.pendingSince) {
    const updated = savePaypal(channelId, { pendingSince: Date.now(), pendingReason: reason });
    await editCard(guild, updated);
    await tell(guild, updated, { staff: what });
  } else if (!p.pendingReminded && Date.now() - p.pendingSince > PENDING_REMIND) {
    const updated = savePaypal(channelId, { pendingReminded: true });
    await tell(guild, updated, { staff: `Nadal czekamy: ${what}` });
  }
  return 'open';
}

/** Approved by the customer: taken if the order still wants it – otherwise never taken, and everyone is told why. */
async function approved(guild, channelId) {
  const ticket = db.getTicket(channelId);
  const p = ticket.order.paypal;
  const want = wantsPayment(ticket);
  if (!want.ok && want.reason === 'paid') {
    // The order was marked paid / completed first – the team decides (Take PayPal payment), nothing is lost silently.
    const updated = savePaypal(channelId, { status: 'held', heldAt: Date.now() });
    await editCard(guild, updated);
    await tell(guild, updated, {
      staff: `⏸️ Klient zatwierdził płatność PayPal na **${money(p.amount)}**, ale **nie została pobrana**, bo zamówienie było już ${ticket.completedAt ? 'zrealizowane' : 'oznaczone jako opłacone'}. Pieniądze nie dotarły inną drogą? Kliknij **Pobierz płatność PayPal**.`,
    });
    if (updated.status === 'open') await tickets.refreshControlMessage(guild.channels.cache.get(channelId), updated).catch(() => null);
    return 'held';
  }
  if (!want.ok && want.reason === 'closed') {
    return expire(guild, channelId, { staff: `💳 Klient zatwierdził płatność PayPal na **${money(p.amount)}** po ${ticket.status === 'deleted' ? 'usunięciu' : 'zamknięciu'} ticketu – **nie została pobrana**, klient nie został obciążony.` });
  }
  if (!want.ok) {
    return expire(guild, channelId, {
      customer: `💳 Kwota zamówienia zmieniła się na **${want.total == null ? 'nową cenę' : money(want.total)}** – płatność przez stary link PayPal nie została pobrana. Kliknij **Nowy link do płatności**, żeby zapłacić nową kwotę.`,
    });
  }
  if (p.nextCaptureAt && Date.now() < p.nextCaptureAt) return 'open'; // PayPal said no a moment ago – the customer may re-approve
  let done;
  try {
    done = await captureOrder(p.orderId, p.captureTries ?? 0);
  } catch (err) {
    if (err.issue === 'ORDER_ALREADY_CAPTURED') done = await getOrder(p.orderId);
    else if (err.status >= 400 && err.status < 500 && ![401, 408, 429].includes(err.status)) {
      // A definite no (declined card, payer action needed…) – nothing was taken.
      const tries = (p.captureTries ?? 0) + 1;
      if (tries >= MAX_CAPTURE_TRIES) return declined(guild, channelId);
      const updated = savePaypal(channelId, { captureTries: tries, captureError: err.issue ?? `HTTP ${err.status}`, nextCaptureAt: Date.now() + CAPTURE_RETRY });
      if (tries === 1) {
        await editCard(guild, updated);
        await tell(guild, updated, {
          customer: '💳 **PayPal nie mógł pobrać płatności** (np. karta została odrzucona) – Twoje konto **nie** zostało obciążone. Otwórz link PayPal ponownie i wybierz inną kartę lub saldo PayPal – albo wygeneruj nowy link.',
          staff: `💳 PayPal odmówił pobrania zatwierdzonej płatności (\`${truncate(err.issue ?? String(err.status), 60)}\`) – nic nie zostało pobrane, klient dostał prośbę o ponowną próbę.`,
        });
      }
      return 'open';
    } else throw err;
  }
  return captured(guild, channelId, done);
}

/** Links replaced by "New link" – an approval on one of them is never taken; the customer is told to use the newest link. */
async function checkPrevious(guild, channelId) {
  const p = db.getTicket(channelId)?.order?.paypal;
  const previous = p?.previous ?? [];
  if (!previous.length) return;
  const keep = [];
  for (const old of previous) {
    const o = await getOrder(old.orderId).catch(() => undefined);
    if (o === undefined) keep.push(old); // PayPal unreachable – ask again next time
    else if (o?.status === 'APPROVED') {
      await tell(guild, db.getTicket(channelId), { customer: '💳 Zatwierdzona płatność dotyczy **starszego** linku PayPal – **nie** została pobrana. Zapłać najnowszym linkiem PayPal w tym tickecie.' });
    } else if (o && !['VOIDED', 'COMPLETED'].includes(o.status) && Date.now() - (old.createdAt ?? 0) < WATCH_FOR) keep.push(old);
  }
  if (keep.length !== previous.length) savePaypal(channelId, { previous: keep });
}

const busy = new Set(); // tickets being settled right now – one at a time, so nothing is taken or recorded twice

/**
 * Looks at the ticket's current link and does what PayPal's answer calls for →
 * 'paid' | 'expired' | 'held' | 'open' | 'busy'. Approved money is only taken while the ticket still wants it.
 */
async function settle(guild, channelId) {
  if (busy.has(channelId)) return 'busy';
  busy.add(channelId);
  try {
    const p = db.getTicket(channelId)?.order?.paypal;
    if (!p || p.status !== 'open') return p?.status ?? 'expired';
    await checkPrevious(guild, channelId);
    const o = await getOrder(p.orderId);
    if (!o || o.status === 'VOIDED') return expire(guild, channelId);
    const latest = db.getTicket(channelId);
    if (latest.order?.paypal?.orderId !== p.orderId || latest.order.paypal.status !== 'open') return latest.order?.paypal?.status ?? 'expired';
    if (o.status === 'COMPLETED') return captured(guild, channelId, o);
    if (o.status === 'APPROVED') return approved(guild, channelId);
    // CREATED / PAYER_ACTION_REQUIRED / SAVED – not approved yet
    if (!wantsPayment(latest).ok || Date.now() - (p.createdAt ?? 0) > WATCH_FOR) return expire(guild, channelId);
    return 'open';
  } finally {
    busy.delete(channelId);
  }
}

// ───────────── Making a link ─────────────

/** → { result: 'created', ticket } · { result: 'paid' } (the old link was just paid) · { result: 'none' } (no fixed total). */
async function postLink(channel, ticket) {
  const guild = channel.guild;
  const cur = currency();
  const order = tickets.orderDetails(ticket);
  if (!cur || !(order.total > 0)) return { result: 'none' };
  const old = order.paypal;
  if (old?.status === 'open') {
    const state = await settle(guild, ticket.channelId);
    if (state === 'paid') return { result: 'paid' };
    if (state === 'busy') throw new UserError('Twoja płatność PayPal jest właśnie sprawdzana – daj jej chwilę.');
    if (state === 'held') throw new UserError('To zamówienie jest już opłacone.');
    if (state === 'open') {
      const fresh = db.getTicket(ticket.channelId).order?.paypal;
      if (fresh?.pendingSince) throw new UserError('PayPal przetwarza Twoją płatność – nie płać ponownie, pojawi się tutaj, gdy tylko PayPal ją zwolni.');
      // Approved and not refused – being taken right now; keep it rather than risk a second payment.
      const o = fresh?.status === 'open' ? await getOrder(fresh.orderId) : null;
      if (o?.status === 'COMPLETED' || (o?.status === 'APPROVED' && !fresh.captureError)) {
        throw new UserError('Twoja płatność PayPal jest przetwarzana – pojawi się tutaj w ciągu minuty.');
      }
      // Never approved, or PayPal refused to take it – nothing was taken, so it's simply replaced.
    }
  }
  const attempt = (db.getTicket(ticket.channelId).paypalAttempts ?? 0) + 1;
  db.updateTicket(ticket.channelId, { paypalAttempts: attempt }); // before calling PayPal – every try has its own request id
  const created = await createOrder(guild, ticket, order, cur, attempt);
  const url = approveUrl(created);
  if (!url) throw new Error('PayPal nie przesłał linku do płatności');
  const latest = db.getTicket(ticket.channelId);
  if (latest.status !== 'open' || latest.completedAt || !['awaiting', 'sent'].includes(statusOf(latest))) return { result: 'none' }; // never approved → never charged
  // Replaced links are still watched for a while – an approval there is never taken, and the customer is told.
  const previous = [...(old?.previous ?? []), ...(old?.orderId && old.status !== 'paid' ? [{ orderId: old.orderId, createdAt: old.createdAt }] : [])].slice(-5);
  const p = { orderId: created.id, url, amount: order.total, currency: cur, createdAt: Date.now(), attempt, status: 'open', messageId: null, previous };
  savePaypal(ticket.channelId, p, { replace: true }); // saved before the card – a link that exists is always watched
  const sent = await channel.send(linkCard(guild, latest, p)).catch(() => null);
  const updated = savePaypal(ticket.channelId, { messageId: sent?.id ?? null });
  if (old?.messageId) {
    const before = await channel.messages.fetch(old.messageId).catch(() => null);
    await before?.delete().catch(() => null);
  }
  await tickets.refreshControlMessage(channel, updated);
  return { result: 'created', ticket: updated };
}

let currencyWarned = false;

/** A new order with PayPal as its payment method → its PayPal link (or the paypal.me card when that fails). */
async function onOrderPlaced({ channel, ticket }) {
  if (!channel || !hasKeys() || !isPaypalOrder(ticket?.order)) return;
  if (!enabled()) {
    if (config.paypal?.enabled !== false && currency() == null && !currencyWarned) {
      currencyWarned = true;
      console.warn(`[paypal] Brak linków do płatności: ustaw config.json → paypal.currency (np. "eur") – "${config.shop.currency}" nie jest jednoznaczne albo PayPal go nie obsługuje.`);
    }
    return; // paycards.js shows the manual PayPal card then
  }
  try {
    const { result } = await postLink(channel, ticket);
    if (result === 'none') await require('./paycards').postCard(channel, db.getTicket(ticket.channelId));
  } catch (err) {
    console.warn(`[paypal] Nie udało się utworzyć linku do płatności dla ticketu ${ticket.channelId}:`, err.message);
    await require('./paycards').postCard(channel, db.getTicket(ticket.channelId)); // the manual way still works
  }
}

// ───────────── Checking the open links ─────────────

let checking = false;
const warnedTickets = new Set();

async function warnRefused(client) {
  console.warn('[paypal] PayPal odrzucił PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET – sprawdź je w .env.');
  const open = db.tickets((t) => t.order?.paypal?.status === 'open');
  for (const id of new Set(open.map((t) => t.guildId))) {
    const guild = client.guilds.cache.get(id);
    if (!guild || refusedWarned.has(id)) continue;
    refusedWarned.add(id);
    await sendTicketLog(guild, {
      embeds: [
        logEmbed(COLORS.danger, '⚠️ PayPal odrzucił klucze', client.user).setDescription(
          'Płatności PayPal **nie mogą być teraz potwierdzane automatycznie**. Zatwierdzone płatności zostaną pobrane, gdy klucze znów zadziałają (jeśli zamówienie nadal na nie czeka) – do tego czasu sprawdzaj otwarte zamówienia PayPal na swoim koncie PayPal. Popraw `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` w `.env` i uruchom bota ponownie.',
        ),
      ],
    }).catch(() => null);
    // The links can't confirm themselves now – "Pay" comes back on their tickets.
    for (const t of open.filter((x) => x.guildId === id && x.status === 'open')) {
      const channel = guild.channels.cache.get(t.channelId);
      if (channel) await tickets.refreshControlMessage(channel, t).catch(() => null);
    }
  }
}

/** Every 30 s: asks PayPal about each open link – also of closed and deleted tickets, until it's settled. */
async function checkPayments(client) {
  if (!hasKeys() || checking) return;
  checking = true;
  try {
    for (const ticket of db.tickets((t) => t.typeId === 'order' && t.order?.paypal?.status === 'open')) {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild || guild.available === false) continue;
      try {
        await settle(guild, ticket.channelId);
      } catch (err) {
        if (err.refused) {
          await warnRefused(client);
          return;
        }
        if (!warnedTickets.has(ticket.channelId)) console.warn(`[paypal] ticket ${ticket.channelId}:`, err.message);
        warnedTickets.add(ticket.channelId);
      }
    }
  } finally {
    checking = false;
  }
}

/** Paid another way or completed: the open link is settled right away – an approval waiting there is held for the team. */
async function onOrderStatus({ guild, ticket, status }) {
  if (!PAID.includes(status) || !guild || !working() || ticket?.order?.paypal?.status !== 'open') return;
  await settle(guild, ticket.channelId).catch(() => null); // unreachable → checkPayments tries again
}

// ───────────── "New link" ─────────────

const lastNewLink = new Map();

async function newLink(interaction) {
  const { channel } = interaction;
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('Ten przycisk działa tylko w tickecie zamówienia.');
  if (ticket.ownerId !== interaction.user.id && !isStaff(interaction.member, config.getType('order'))) throw new UserError('Nowy link do płatności może utworzyć tylko klient lub zespół.');
  if (!enabled()) throw new UserError('Linki PayPal są teraz wyłączone – sprzedawca pomoże Ci w tickecie.');
  if (ticket.status !== 'open' || ticket.completedAt) throw new UserError('To zamówienie jest zamknięte.');
  if (!['awaiting', 'sent'].includes(statusOf(ticket))) throw new UserError('To zamówienie jest już opłacone.');
  const last = lastNewLink.get(ticket.channelId) ?? 0;
  if (Date.now() - last < NEW_LINK_COOLDOWN) throw new UserError(`Nowy link został właśnie utworzony – kolejny możesz utworzyć ${ts(last + NEW_LINK_COOLDOWN, 'R')}.`);
  lastNewLink.set(ticket.channelId, Date.now());
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let done;
  try {
    done = await postLink(channel, ticket);
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn(`[paypal] Nowy link dla ticketu ${ticket.channelId}:`, err.message);
    throw new UserError('PayPal nie może teraz utworzyć linku – spróbuj ponownie za minutę albo poproś o pomoc sprzedawcę w tickecie.');
  }
  if (done.result === 'paid') return interaction.editReply({ content: '✅ Twoja płatność właśnie dotarła – nowy link nie jest potrzebny.' });
  if (done.result === 'none') throw new UserError('To zamówienie nie ma jeszcze ustalonej kwoty – najpierw sprzedawca potwierdzi cenę.');
  return interaction.editReply({ content: `💳 Oto nowy link PayPal na **${money(done.ticket.order.paypal.amount)}** – używaj tego. Płatność przez starszy link nie zostanie pobrana, nawet jeśli ją zatwierdzisz.` });
}

// ───────────── "Take PayPal payment" (staff) ─────────────

/** An approval that wasn't taken because the order was already marked paid – staff take it if the money is still missing. */
async function takeHeld(interaction) {
  const { channel } = interaction;
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('Ten przycisk działa tylko w tickecie zamówienia.');
  if (!isStaff(interaction.member, config.getType('order'))) throw new UserError('Płatność PayPal może pobrać tylko zespół.');
  const p = ticket.order?.paypal;
  if (p?.status !== 'held') throw new UserError('Nie ma płatności PayPal czekającej na pobranie.');
  if (busy.has(ticket.channelId)) throw new UserError('Ta płatność PayPal jest właśnie obsługiwana – spróbuj ponownie za chwilę.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  busy.add(ticket.channelId);
  try {
    const o = await getOrder(p.orderId);
    let done = o;
    if (o?.status === 'APPROVED') done = await captureOrder(p.orderId, p.captureTries ?? 0);
    else if (o?.status !== 'COMPLETED') {
      const updated = savePaypal(ticket.channelId, { status: 'expired' });
      await editCard(channel.guild, updated);
      throw new UserError(`PayPal nie pozwala już pobrać tej płatności (${o ? `status ${o.status}` : 'nie znaleziono'}) – poproś klienta o ponowną płatność.`);
    }
    const cap = captureOf(done);
    if (cap?.status !== 'COMPLETED') throw new UserError(`PayPal jej nie pobrał (${cap?.status ?? 'brak pobrania'}) – sprawdź swoje konto PayPal.`);
    const paidAmount = Number(cap.amount?.value ?? p.amount);
    const updated = savePaypal(ticket.channelId, { status: 'paid', paidAt: Date.now(), paidAmount, paidCurrency: String(cap.amount?.currency_code ?? p.currency).toLowerCase(), captureId: cap.id ?? null });
    await editCard(channel.guild, updated);
    await channel.send(notice(COLORS.success, `💰 Płatność PayPal na **${money(paidAmount)}** pobrana przez <@${interaction.user.id}>.`)).catch(() => null);
    await sendTicketLog(channel.guild, {
      embeds: [
        logEmbed(COLORS.success, '💰 Pobrano wstrzymaną płatność PayPal', interaction.user).addFields(
          { name: 'Ticket', value: `<#${ticket.channelId}> (\`#${pad(ticket.number)}\`)`, inline: true },
          { name: 'Kwota', value: money(paidAmount), inline: true },
          { name: 'PayPal', value: `\`${truncate(cap.id ?? p.orderId, 100)}\``, inline: true },
        ),
      ],
    }).catch(() => null);
    return interaction.editReply({ content: `✅ Pobrano: **${money(paidAmount)}**.` });
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn(`[paypal] Pobieranie wstrzymanej płatności dla ticketu ${ticket.channelId}:`, err.message);
    throw new UserError('Brak połączenia z PayPal – spróbuj ponownie za minutę.');
  } finally {
    busy.delete(ticket.channelId);
  }
}

hooks.on('orderPlaced', onOrderPlaced);
hooks.on('orderStatus', onOrderStatus);
hooks.every('paypalPayments', CHECK_EVERY, (client) => checkPayments(client), 25_000);
hooks.route('paypal', {
  button: (interaction, action) => (action === 'new' ? newLink(interaction) : action === 'take' ? takeHeld(interaction) : null),
});

module.exports = { currency, enabled, working, confirmsItself, isPaypalOrder, linkCard, postLink, settle, checkPayments, SUPPORTED };
