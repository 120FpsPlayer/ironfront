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
 * ticket.order.paypal = { orderId, url, amount, currency, createdAt, attempt, messageId,
 *   status ('open' | 'paid' | 'expired'), paidAt, paidAmount, paidCurrency, captureId }
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
/** The order has a PayPal link that confirms itself – "I've paid" isn't needed then. */
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

/** Takes the approved money. The same request id every time – PayPal never takes it twice. */
const captureOrder = (id) => call('POST', `/v2/checkout/orders/${encodeURIComponent(id)}/capture`, {}, { requestId: `nox-capture-${id}` });

const approveUrl = (o) => (o?.links ?? []).find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;
const captureOf = (o) => o?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;

// ───────────── The card in the ticket ─────────────

function linkCard(guild, ticket, p) {
  const c = container(p.status === 'paid' ? COLORS.success : p.status === 'expired' ? COLORS.warning : COLORS.brand);
  const total = money(p.amount);
  if (p.status === 'paid') {
    c.addTextDisplayComponents(text(`## ✅ Paid with PayPal\n**${money(p.paidAmount ?? p.amount)}** for order \`#${pad(ticket.number)}\` – received ${ts(p.paidAt, 'R')}.`));
    return v2(c);
  }
  if (p.status === 'expired') {
    c.addTextDisplayComponents(text(`## 💳 PayPal link no longer works\nThe PayPal link for order \`#${pad(ticket.number)}\` (**${total}**) has been closed.\n-# Still want to pay with PayPal? Get a new link.`));
    c.addActionRowComponents(row(btn('paypal:new', 'New payment link', '🔄', ButtonStyle.Primary)));
    return v2(c);
  }
  c.addTextDisplayComponents(
    text(`## ${guild ? ce(guild, 'paypal') : '💳'} Pay ${total} – PayPal\n-# Order \`#${pad(ticket.number)}\`\nPay with your PayPal account or a card on PayPal's secure page.`),
  );
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

const expire = async (guild, channelId, why = null) => {
  const updated = savePaypal(channelId, { status: 'expired' });
  await editCard(guild, updated);
  if (why) {
    const channel = updated.status === 'open' ? guild.channels.cache.get(channelId) : null;
    await channel?.send(notice(COLORS.warning, why)).catch(() => null);
  }
  return 'expired';
};

// ───────────── Settling a link ─────────────

/** Does the ticket still want this money: open, not paid another way, and the same total and currency as the link. */
function wantsPayment(ticket) {
  const p = ticket.order?.paypal;
  const total = tickets.orderDetails(ticket).total;
  if (ticket.status !== 'open' || ticket.completedAt || PAID.includes(statusOf(ticket))) return { ok: false, why: null };
  if (total == null || Math.abs(total - p.amount) >= 0.005 || p.currency !== currency()) {
    return { ok: false, why: `💳 The order total changed to **${total == null ? 'a new price' : money(total)}** – the old PayPal link wasn't charged. Click **New payment link** for the new amount.` };
  }
  return { ok: true };
}

async function markPaid(guild, ticket, cap) {
  const before = autopay.statusBefore(ticket);
  const cur = String(cap?.amount?.currency_code ?? ticket.order.paypal.currency).toLowerCase();
  const paidAmount = cap?.amount?.value != null ? Number(cap.amount.value) : ticket.order.paypal.amount;
  const updated = savePaypal(ticket.channelId, { status: 'paid', paidAt: Date.now(), paidAmount, paidCurrency: cur, captureId: cap?.id ?? null });
  await autopay.paymentReceived(guild, updated, {
    gateway: 'PayPal',
    paidAmount,
    paidCurrency: cur,
    expectedCurrency: currency(),
    reference: cap?.id ?? updated.order.paypal.orderId,
    before,
    refreshCard: (t) => editCard(guild, t),
  });
}

const busy = new Set(); // tickets being settled right now – one at a time, so nothing is taken or recorded twice

/**
 * Looks at the ticket's current link and does what PayPal's answer calls for → 'paid' | 'expired' | 'open' | 'busy'.
 * Approved money is only taken while the ticket still wants it.
 */
async function settle(guild, channelId) {
  if (busy.has(channelId)) return 'busy';
  busy.add(channelId);
  try {
    const ticket = db.getTicket(channelId);
    const p = ticket?.order?.paypal;
    if (!p || p.status !== 'open') return p?.status ?? 'expired';
    const o = await getOrder(p.orderId);
    if (!o || o.status === 'VOIDED') return expire(guild, channelId);
    const latest = db.getTicket(channelId);
    if (latest.order?.paypal?.orderId !== p.orderId || latest.order.paypal.status !== 'open') return latest.order?.paypal?.status ?? 'expired';
    if (o.status === 'COMPLETED') {
      const cap = captureOf(o);
      if (cap?.status === 'COMPLETED') return markPaid(guild, latest, cap).then(() => 'paid');
      if (cap && ['DECLINED', 'FAILED', 'REFUNDED'].includes(cap.status)) return expire(guild, channelId, '💳 The PayPal payment was declined – try again with a new link, or pay another way.');
      return 'open'; // PENDING – PayPal still checks it
    }
    if (o.status === 'APPROVED') {
      const want = wantsPayment(latest);
      if (!want.ok) return expire(guild, channelId, want.why); // never taken – the customer isn't charged
      let done;
      try {
        done = await captureOrder(p.orderId);
      } catch (err) {
        if (err.issue === 'ORDER_ALREADY_CAPTURED') done = await getOrder(p.orderId);
        else if (err.status === 422) return 'open'; // e.g. INSTRUMENT_DECLINED – the customer can pick another way on the same link
        else throw err;
      }
      const cap = captureOf(done);
      if (cap?.status === 'COMPLETED') return markPaid(guild, db.getTicket(channelId), cap).then(() => 'paid');
      if (cap && ['DECLINED', 'FAILED'].includes(cap.status)) return expire(guild, channelId, '💳 The PayPal payment was declined – try again with a new link, or pay another way.');
      return 'open';
    }
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
    if (state === 'open') {
      const fresh = db.getTicket(ticket.channelId).order?.paypal;
      // Approved but still processing (pending) – keep it rather than risk a second payment.
      const o = fresh?.status === 'open' ? await getOrder(fresh.orderId) : null;
      if (o && ['APPROVED', 'COMPLETED'].includes(o.status)) throw new UserError('Your PayPal payment is still being processed – it shows up here as soon as PayPal confirms it.');
      // Never approved – it's simply replaced: an order nobody approved can't be charged.
    }
  }
  const attempt = (db.getTicket(ticket.channelId).paypalAttempts ?? 0) + 1;
  db.updateTicket(ticket.channelId, { paypalAttempts: attempt }); // before calling PayPal – every try has its own request id
  const created = await createOrder(guild, ticket, order, cur, attempt);
  const url = approveUrl(created);
  if (!url) throw new Error('PayPal sent no payment link');
  const latest = db.getTicket(ticket.channelId);
  if (latest.status !== 'open' || latest.completedAt || !['awaiting', 'sent'].includes(statusOf(latest))) return { result: 'none' }; // never approved → never charged
  const p = { orderId: created.id, url, amount: order.total, currency: cur, createdAt: Date.now(), attempt, status: 'open', messageId: null };
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
  const guildIds = new Set(db.tickets((t) => t.order?.paypal?.status === 'open').map((t) => t.guildId));
  for (const id of guildIds) {
    const guild = client.guilds.cache.get(id);
    if (!guild || refusedWarned.has(id)) continue;
    refusedWarned.add(id);
    await sendLog(guild, {
      embeds: [
        logEmbed(COLORS.danger, '⚠️ PayPal refused the keys', client.user).setDescription(
          "PayPal payments **can't be confirmed automatically** right now – approved payments are not taken until this is fixed. Fix `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` in `.env` and restart the bot.",
        ),
      ],
    }).catch(() => null);
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

/** Paid another way or completed: the open link is settled right away – approved money is never taken then. */
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
  return interaction.editReply({ content: `💳 Here's a new PayPal link for **${money(done.ticket.order.paypal.amount)}** – the old one can't be paid any more.` });
}

hooks.on('orderPlaced', onOrderPlaced);
hooks.on('orderStatus', onOrderStatus);
hooks.every('paypalPayments', CHECK_EVERY, (client) => checkPayments(client), 25_000);
hooks.route('paypal', { button: (interaction, action) => (action === 'new' ? newLink(interaction) : null) });

module.exports = { currency, enabled, working, confirmsItself, isPaypalOrder, linkCard, postLink, settle, checkPayments, SUPPORTED };
