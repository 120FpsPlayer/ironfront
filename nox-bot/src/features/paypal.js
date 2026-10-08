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
const { UserError, logEmbed, money, pad, ts, truncate, sendLog } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, v2, notice, channelUrl } = require('../lib/v2');

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
  const err = new Error(data?.details?.[0]?.description ?? data?.message ?? data?.error_description ?? `PayPal answered ${res.status}`);
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
          description: truncate(`${config.brand.name} order #${pad(ticket.number)} – ${order.product || 'Custom order'} × ${order.quantity ?? 1}`, 127),
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
    { requestId: `nox-${ticket.channelId}-${attempt}` },
  );
}

/**
 * Takes the approved money. Retrying the same try uses the same request id – PayPal never takes it twice; only
 * after PayPal said no (e.g. a declined card) does the next try get a new id, so a re-approval isn't answered
 * with the old refusal.
 */
const captureOrder = (id, tries = 0) => call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { requestId: `nox-capture-${id}${tries ? `-${tries}` : ''}` });

const approveUrl = (o) => (o?.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;
const captureOf = (o) => o?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;

const CAPTURE_RETRY = 2 * 60_000; // after a refused capture
const MAX_CAPTURE_TRIES = 10;
const PENDING_REMIND = 24 * 3_600_000;

// ───────────── The card in the ticket ─────────────

/** What the customer is told about getting the product after paying with a link (PayPal / Stripe). */
const deliveryNote = (ticket) =>
  require('./delivery').deliverable(ticket.guildId, ticket) // here – delivery.js needs this file's neighbours
    ? "📦 **Instant delivery:** your product arrives right here and in your DMs as soon as you've paid – usually in under 30 seconds, at most 1–5 minutes. Didn't get it? Write here or click **Call support**."
    : "📦 Once you've paid, your order is confirmed here automatically and a seller delivers it right away.";

function linkCard(guild, ticket, p) {
  const total = money(p.amount);
  const c = container(p.status === 'paid' ? COLORS.success : ['expired', 'held'].includes(p.status) || p.captureError ? COLORS.warning : COLORS.brand);
  if (p.status === 'paid') {
    c.addTextDisplayComponents(text(`## ✅ Paid with PayPal\n**${money(p.paidAmount ?? p.amount)}** for order \`#${pad(ticket.number)}\` – received ${ts(p.paidAt, 'R')}.`));
    return v2(c);
  }
  if (p.status === 'held') {
    c.addTextDisplayComponents(
      text(
        `## ⏸️ PayPal payment not taken\nThe customer approved **${total}** on PayPal, but order \`#${pad(ticket.number)}\` was already marked as paid – so it was **not** taken.\n` +
          "-# Staff: haven't received the money another way? Take it now.",
      ),
    );
    c.addActionRowComponents(row(btn('paypal:take', 'Take PayPal payment', '💰', ButtonStyle.Primary)));
    return v2(c);
  }
  if (p.status === 'expired') {
    c.addTextDisplayComponents(text(`## 💳 PayPal link no longer works\nThe PayPal link for order \`#${pad(ticket.number)}\` (**${total}**) has been closed.\n-# Still want to pay with PayPal? Get a new link.`));
    c.addActionRowComponents(row(btn('paypal:new', 'New payment link', '🔄', ButtonStyle.Primary)));
    return v2(c);
  }
  if (p.pendingSince) {
    c.addTextDisplayComponents(
      text(`## ⏳ PayPal is processing your payment\n**${total}** for order \`#${pad(ticket.number)}\` was paid – PayPal is still checking it. **No need to pay again** – it's confirmed here as soon as PayPal releases it.`),
    );
    return v2(c);
  }
  c.addTextDisplayComponents(
    text(`## ${guild ? ce(guild, 'paypal') : '💳'} Pay ${total} – PayPal\n-# Order \`#${pad(ticket.number)}\`\nPay with your PayPal account or a card on PayPal's secure page.`),
  );
  c.addTextDisplayComponents(text(deliveryNote(ticket)));
  if (p.captureError) {
    c.addTextDisplayComponents(text("⚠️ **PayPal couldn't take the payment** – you were **not** charged. Open the link again and choose another card or your PayPal balance, or get a new link."));
  }
  c.addSeparatorComponents(divider());
  const fits = p.url.length <= 512;
  c.addTextDisplayComponents(
    text(`${fits ? '' : `**[💳 Pay ${total} with PayPal](${p.url})**\n`}-# After you pay, your order is confirmed here automatically within a minute. Link not working? Get a new one.`),
  );
  c.addActionRowComponents(row(...(fits ? [linkBtn(p.url, truncate(`Pay ${total} with PayPal`, 80), '💳')] : []), btn('paypal:new', 'New link', '🔄')));
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
  await sendLog(guild, {
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
    customer: '💳 PayPal declined the payment – you were **not** charged. Get a new link, or pay another way.',
    staff: '💳 A PayPal payment for this order was declined by PayPal – nothing was taken.',
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
    `⏳ The PayPal payment of **${money(p.amount)}** is **pending**${reason ? ` (\`${truncate(reason, 60)}\`)` : ''} – the customer has paid, PayPal hasn't released it yet.` +
    (manual ? ' **Accept it in your PayPal account** (Activity → the payment → Accept) – otherwise PayPal sends it back.' : ' The order is set to Paid here as soon as PayPal releases it.');
  if (!p.pendingSince) {
    const updated = savePaypal(channelId, { pendingSince: Date.now(), pendingReason: reason });
    await editCard(guild, updated);
    await tell(guild, updated, { staff: what });
  } else if (!p.pendingReminded && Date.now() - p.pendingSince > PENDING_REMIND) {
    const updated = savePaypal(channelId, { pendingReminded: true });
    await tell(guild, updated, { staff: `Still waiting: ${what}` });
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
      staff: `⏸️ The customer approved a PayPal payment of **${money(p.amount)}**, but it was **not taken** because the order was already ${ticket.completedAt ? 'completed' : 'marked as paid'}. Haven't received the money another way? Click **Take PayPal payment**.`,
    });
    if (updated.status === 'open') await tickets.refreshControlMessage(guild.channels.cache.get(channelId), updated).catch(() => null);
    return 'held';
  }
  if (!want.ok && want.reason === 'closed') {
    return expire(guild, channelId, { staff: `💳 The customer approved a PayPal payment of **${money(p.amount)}** after the ticket was ${ticket.status === 'deleted' ? 'deleted' : 'closed'} – it was **not taken**, the customer wasn't charged.` });
  }
  if (!want.ok) {
    return expire(guild, channelId, {
      customer: `💳 The order total changed to **${want.total == null ? 'a new price' : money(want.total)}** – the old PayPal link wasn't charged. Click **New payment link** for the new amount.`,
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
          customer: "💳 **PayPal couldn't take the payment** (e.g. the card was declined) – you were **not** charged. Open the PayPal link again and pick another card or your PayPal balance – or get a new link.",
          staff: `💳 PayPal refused to take the approved payment (\`${truncate(err.issue ?? String(err.status), 60)}\`) – nothing was taken, the customer was asked to try again.`,
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
      await tell(guild, db.getTicket(channelId), { customer: '💳 You approved an **older** PayPal link – it was **not** charged. Please pay with the newest PayPal link in this ticket.' });
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
    if (state === 'busy') throw new UserError('Your PayPal payment is being checked right now – give it a minute.');
    if (state === 'held') throw new UserError('This order is already paid.');
    if (state === 'open') {
      const fresh = db.getTicket(ticket.channelId).order?.paypal;
      if (fresh?.pendingSince) throw new UserError('Your PayPal payment is being processed by PayPal – no need to pay again, it shows up here as soon as PayPal releases it.');
      // Approved and not refused – being taken right now; keep it rather than risk a second payment.
      const o = fresh?.status === 'open' ? await getOrder(fresh.orderId) : null;
      if (o?.status === 'COMPLETED' || (o?.status === 'APPROVED' && !fresh.captureError)) {
        throw new UserError('Your PayPal payment is being processed – it shows up here within a minute.');
      }
      // Never approved, or PayPal refused to take it – nothing was taken, so it's simply replaced.
    }
  }
  const attempt = (db.getTicket(ticket.channelId).paypalAttempts ?? 0) + 1;
  db.updateTicket(ticket.channelId, { paypalAttempts: attempt }); // before calling PayPal – every try has its own request id
  const created = await createOrder(guild, ticket, order, cur, attempt);
  const url = approveUrl(created);
  if (!url) throw new Error('PayPal sent no payment link');
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
      console.warn(`[paypal] No payment links: set config.json → paypal.currency (e.g. "eur") – "${config.shop.currency}" isn't clear or not taken by PayPal.`);
    }
    return; // paycards.js shows the manual PayPal card then
  }
  try {
    const { result } = await postLink(channel, ticket);
    if (result === 'none') await require('./paycards').postCard(channel, db.getTicket(ticket.channelId));
  } catch (err) {
    console.warn(`[paypal] Could not make a payment link for ticket ${ticket.channelId}:`, err.message);
    await require('./paycards').postCard(channel, db.getTicket(ticket.channelId)); // the manual way still works
  }
}

// ───────────── Checking the open links ─────────────

let checking = false;
const warnedTickets = new Set();

async function warnRefused(client) {
  console.warn('[paypal] PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET were refused by PayPal – check them in .env.');
  const open = db.tickets((t) => t.order?.paypal?.status === 'open');
  for (const id of new Set(open.map((t) => t.guildId))) {
    const guild = client.guilds.cache.get(id);
    if (!guild || refusedWarned.has(id)) continue;
    refusedWarned.add(id);
    await sendLog(guild, {
      embeds: [
        logEmbed(COLORS.danger, '⚠️ PayPal refused the keys', client.user).setDescription(
          "PayPal payments **can't be confirmed automatically** right now. Approved payments are taken as soon as the keys work again (if the order still wants them) – check open PayPal orders in your PayPal account meanwhile. Fix `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` in `.env` and restart the bot.",
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
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This button only works in an order ticket.');
  if (ticket.ownerId !== interaction.user.id && !isStaff(interaction.member, config.getType('order'))) throw new UserError('Only the customer or the team can make a new payment link.');
  if (!enabled()) throw new UserError('PayPal links are turned off right now – a seller will help you in the ticket.');
  if (ticket.status !== 'open' || ticket.completedAt) throw new UserError('This order is closed.');
  if (!['awaiting', 'sent'].includes(statusOf(ticket))) throw new UserError('This order is already paid.');
  const last = lastNewLink.get(ticket.channelId) ?? 0;
  if (Date.now() - last < NEW_LINK_COOLDOWN) throw new UserError(`A new link was just made – you can make another ${ts(last + NEW_LINK_COOLDOWN, 'R')}.`);
  lastNewLink.set(ticket.channelId, Date.now());
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let done;
  try {
    done = await postLink(channel, ticket);
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn(`[paypal] New link for ticket ${ticket.channelId}:`, err.message);
    throw new UserError("PayPal couldn't make a link right now – try again in a minute, or a seller helps you in the ticket.");
  }
  if (done.result === 'paid') return interaction.editReply({ content: '✅ Your payment just came in – no new link needed.' });
  if (done.result === 'none') throw new UserError('This order has no fixed total yet – a seller confirms the price first.');
  return interaction.editReply({ content: `💳 Here's a new PayPal link for **${money(done.ticket.order.paypal.amount)}** – use this one. An older link isn't charged, even if you approve it.` });
}

// ───────────── "Take PayPal payment" (staff) ─────────────

/** An approval that wasn't taken because the order was already marked paid – staff take it if the money is still missing. */
async function takeHeld(interaction) {
  const { channel } = interaction;
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This button only works in an order ticket.');
  if (!isStaff(interaction.member, config.getType('order'))) throw new UserError('Only the team can take a PayPal payment.');
  const p = ticket.order?.paypal;
  if (p?.status !== 'held') throw new UserError('There is no PayPal payment waiting to be taken.');
  if (busy.has(ticket.channelId)) throw new UserError('This PayPal payment is being handled right now – try again in a moment.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  busy.add(ticket.channelId);
  try {
    const o = await getOrder(p.orderId);
    let done = o;
    if (o?.status === 'APPROVED') done = await captureOrder(p.orderId, p.captureTries ?? 0);
    else if (o?.status !== 'COMPLETED') {
      const updated = savePaypal(ticket.channelId, { status: 'expired' });
      await editCard(channel.guild, updated);
      throw new UserError(`PayPal no longer allows taking this payment (${o ? `status ${o.status}` : 'not found'}) – ask the customer to pay again.`);
    }
    const cap = captureOf(done);
    if (cap?.status !== 'COMPLETED') throw new UserError(`PayPal didn't take it (${cap?.status ?? 'no capture'}) – check your PayPal account.`);
    const paidAmount = Number(cap.amount?.value ?? p.amount);
    const updated = savePaypal(ticket.channelId, { status: 'paid', paidAt: Date.now(), paidAmount, paidCurrency: String(cap.amount?.currency_code ?? p.currency).toLowerCase(), captureId: cap.id ?? null });
    await editCard(channel.guild, updated);
    await channel.send(notice(COLORS.success, `💰 PayPal payment of **${money(paidAmount)}** taken by <@${interaction.user.id}>.`)).catch(() => null);
    await sendLog(channel.guild, {
      embeds: [
        logEmbed(COLORS.success, '💰 Held PayPal payment taken', interaction.user).addFields(
          { name: 'Ticket', value: `<#${ticket.channelId}> (\`#${pad(ticket.number)}\`)`, inline: true },
          { name: 'Amount', value: money(paidAmount), inline: true },
          { name: 'PayPal', value: `\`${truncate(cap.id ?? p.orderId, 100)}\``, inline: true },
        ),
      ],
    }).catch(() => null);
    return interaction.editReply({ content: `✅ Taken: **${money(paidAmount)}**.` });
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn(`[paypal] Take held payment for ticket ${ticket.channelId}:`, err.message);
    throw new UserError("PayPal couldn't be reached – try again in a minute.");
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
