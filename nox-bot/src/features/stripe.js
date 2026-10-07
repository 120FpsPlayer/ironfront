'use strict';

/**
 * Stripe – card payments (also Apple Pay / Google Pay) through a payment link in the order ticket.
 *
 * With STRIPE_SECRET_KEY in .env, an order placed with the Stripe payment method (config.json →
 * shop.paymentMethods, the entry with "stripe": true) gets a Stripe Checkout link for its total right away.
 * The bot asks Stripe about the open links every 30 s – no webhook or public address needed, so it works on
 * any host – and once a link is paid the order is set to Paid and the seller is pinged. Without a key Stripe
 * is just a payment method in the list and the seller sends a link by hand.
 *
 * ticket.order.stripe = { sessionId, url, amount, currency, createdAt, expiresAt, attempt, messageId,
 *   status ('open' | 'paid' | 'expired'), paidAt, paidAmount, paymentIntent }
 */

const { ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const tickets = require('../tickets/tickets');
const orderstatus = require('./orderstatus');
const { env } = require('../env');
const { statusOf } = require('../lib/orderStatus');
const { isStaff, alertRoleIds } = require('../lib/permissions');
const { COLORS } = require('../lib/theme');
const { UserError, logEmbed, money, pad, ts, truncate, sendLog } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, v2, notice, channelUrl } = require('../lib/v2');

const API = 'https://api.stripe.com/v1';
const CHECK_EVERY = 30_000;
const LINK_HOURS = 23; // Stripe allows Checkout links for 30 minutes to 24 hours
const NEW_LINK_COOLDOWN = 60_000;
const MIN_AMOUNT = 50; // 0.50 in the smallest unit – Stripe's minimum for €, $, £

const CURRENCIES = { '€': 'eur', eur: 'eur', '$': 'usd', usd: 'usd', '£': 'gbp', gbp: 'gbp', 'zł': 'pln', pln: 'pln', chf: 'chf' };

/** "eur" – config.json → stripe.currency, or worked out from shop.currency (€ → eur, $ → usd, zł → pln). */
const currency = () => String(config.stripe?.currency || CURRENCIES[String(config.shop.currency ?? '€').trim().toLowerCase()] || 'eur').toLowerCase();

/** Payment links are made only with a key, and while config.json → stripe.enabled isn't false. */
const enabled = () => Boolean(env.stripeKey) && config.stripe?.enabled !== false;

const isStripeMethod = (m) => m?.stripe === true || /stripe/i.test(String(m?.name ?? ''));

/** Is this order paid with Stripe – the method the customer picked in the order form. */
function isStripeOrder(order) {
  if (!order) return false;
  const picked = config.shop.paymentMethods[order.methodIndex];
  if (picked && picked.name === order.method) return isStripeMethod(picked);
  return isStripeMethod({ name: order.method });
}

// ───────────── Stripe API (plain HTTPS, no extra package) ─────────────

async function call(method, path, params = null, { idempotencyKey } = {}) {
  const headers = { Authorization: `Bearer ${env.stripeKey}` };
  if (params) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: params ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Stripe answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Checkout Session for the order's total – one line "NØX order #0012 – Netflix — 3 months × 2". */
function createSession(guild, ticket, order, attempt) {
  const amount = Math.round(order.total * 100);
  const back = channelUrl(guild.id, ticket.channelId);
  return call(
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': currency(),
      'line_items[0][price_data][unit_amount]': amount,
      'line_items[0][price_data][product_data][name]': truncate(`${config.brand.name} order #${pad(ticket.number)} – ${order.product || 'Custom order'} × ${order.quantity ?? 1}`, 250),
      success_url: back,
      cancel_url: back,
      client_reference_id: ticket.channelId,
      'metadata[guildId]': guild.id,
      'metadata[channelId]': ticket.channelId,
      'metadata[ticket]': String(ticket.number),
      'metadata[userId]': ticket.ownerId,
      expires_at: Math.floor((Date.now() + LINK_HOURS * 3_600_000) / 1000),
    },
    { idempotencyKey: `nox-${ticket.channelId}-${attempt}` },
  );
}

const expireSession = (id) => call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`).catch(() => null);

// ───────────── The card in the ticket ─────────────

function linkCard(ticket, s) {
  const c = container(s.status === 'paid' ? COLORS.success : s.status === 'expired' ? COLORS.warning : COLORS.brand);
  const total = money(s.amount);
  if (s.status === 'paid') {
    c.addTextDisplayComponents(text(`## ✅ Paid with Stripe\n**${money(s.paidAmount ?? s.amount)}** for order \`#${pad(ticket.number)}\` – received ${ts(s.paidAt, 'R')}.`));
    return v2(c);
  }
  if (s.status === 'expired') {
    c.addTextDisplayComponents(text(`## 💳 Payment link expired\nThe Stripe link for order \`#${pad(ticket.number)}\` (**${total}**) has run out.\n-# Still want to pay by card? Get a new link.`));
    c.addActionRowComponents(row(btn('stripe:new', 'New payment link', '🔄', ButtonStyle.Primary)));
    return v2(c);
  }
  c.addTextDisplayComponents(
    text(
      `## 💳 Pay by card – Stripe\n**Total:** ${total} · order \`#${pad(ticket.number)}\`\n` +
        "Card, Apple Pay or Google Pay on Stripe's secure page – we never see your card details.",
    ),
  );
  c.addSeparatorComponents(divider());
  // Link buttons take URLs up to 512 characters – a longer Checkout link goes into the text instead.
  const fits = s.url.length <= 512;
  c.addTextDisplayComponents(
    text(`${fits ? '' : `**[💳 Pay ${total}](${s.url})**\n`}-# The link works until ${ts(s.expiresAt, 'f')} · your order is confirmed here automatically once you've paid.`),
  );
  c.addActionRowComponents(row(...(fits ? [linkBtn(s.url, truncate(`Pay ${total}`, 80), '💳')] : []), btn('stripe:new', 'New link', '🔄')));
  return v2(c);
}

const saveStripe = (ticket, patch) => {
  const order = tickets.orderDetails(ticket);
  return db.updateTicket(ticket.channelId, { order: { ...order, stripe: { ...order.stripe, ...patch } } });
};

async function editCard(channel, ticket) {
  const id = ticket.order?.stripe?.messageId;
  const message = id ? await channel.messages.fetch(id).catch(() => null) : null;
  if (message) await message.edit(linkCard(ticket, ticket.order.stripe)).catch(() => null);
}

/**
 * Makes a payment link for the order and posts it in the ticket (or replaces the old one). Returns the ticket,
 * or null when the order can't be paid with a link (no fixed total, too small).
 */
async function postLink(channel, ticket) {
  const order = tickets.orderDetails(ticket);
  if (!(order.total > 0) || Math.round(order.total * 100) < MIN_AMOUNT) return null;
  const old = order.stripe;
  if (old?.status === 'open') await expireSession(old.sessionId); // one link per order – the old one stops working
  const attempt = (old?.attempt ?? 0) + 1;
  const session = await createSession(channel.guild, ticket, order, attempt);
  const s = {
    sessionId: session.id,
    url: session.url,
    amount: order.total,
    currency: currency(),
    createdAt: Date.now(),
    expiresAt: (session.expires_at ?? 0) * 1000 || Date.now() + LINK_HOURS * 3_600_000,
    attempt,
    status: 'open',
    messageId: null,
  };
  const sent = await channel.send(linkCard(ticket, s));
  const updated = db.updateTicket(ticket.channelId, { order: { ...order, stripe: { ...s, messageId: sent?.id ?? null } } });
  if (old?.messageId) {
    const before = await channel.messages.fetch(old.messageId).catch(() => null);
    await before?.delete().catch(() => null);
  }
  await tickets.refreshControlMessage(channel, updated); // the "I've paid" button isn't needed with a link
  return updated;
}

/** A new order with Stripe as its payment method → its payment link, right away. */
async function onOrderPlaced({ channel, ticket }) {
  if (!enabled() || !channel || !isStripeOrder(ticket?.order)) return;
  try {
    const done = await postLink(channel, ticket);
    if (!done) await channel.send(notice(COLORS.brand, '💳 A seller sends you the Stripe payment link once the final price is confirmed.'));
  } catch (err) {
    console.warn(`[stripe] Could not make a payment link for ticket ${ticket.channelId}:`, err.message);
    await channel.send(notice(COLORS.warning, "💳 The card payment link couldn't be made right now – a seller sends you one shortly.")).catch(() => null);
  }
}

// ───────────── Checking the open links ─────────────

/** Stripe says it's paid: the order is Paid, the card says so and the seller is pinged. */
async function markPaid(client, channel, ticket, session) {
  const paidAmount = session.amount_total != null ? session.amount_total / 100 : ticket.order.stripe.amount;
  let updated = saveStripe(ticket, {
    status: 'paid',
    paidAt: Date.now(),
    paidAmount,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
  });
  const s = updated.order.stripe;
  await editCard(channel, updated);
  if (updated.status === 'open' && !updated.completedAt && ['awaiting', 'sent'].includes(statusOf(updated))) {
    await orderstatus.setStatus(channel, 'paid', client.user).catch((err) => console.warn('[stripe] status:', err.message));
    updated = db.getTicket(ticket.channelId);
  }
  const guild = channel.guild;
  const pings = updated.claimedBy
    ? { users: [updated.claimedBy], roles: [] }
    : { users: [], roles: alertRoleIds(guild.id, config.getType(updated.typeId)).filter((id) => guild.roles.cache.has(id)) };
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  const mismatch = Math.abs(paidAmount - s.amount) > 0.005 ? `\n⚠️ The order total is **${money(tickets.orderDetails(updated).total)}** – check the difference.` : '';
  const closed = updated.status !== 'open' ? '\n⚠️ The ticket was closed when the payment came in – reopen it to deliver.' : '';
  await channel
    .send(
      notice(COLORS.success, `💳 **Stripe payment received – ${money(paidAmount)}** for order \`#${pad(updated.number)}\`.${who ? ` ${who}, please deliver it.` : ''}${mismatch}${closed}`, {
        mentions: pings,
      }),
    )
    .catch(() => null);
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '💳 Stripe payment received', client.user).addFields(
        { name: 'Ticket', value: `<#${updated.channelId}> (\`#${pad(updated.number)}\`)`, inline: true },
        { name: 'Customer', value: `<@${updated.ownerId}>`, inline: true },
        { name: 'Amount', value: money(paidAmount), inline: true },
        { name: 'Stripe', value: `\`${truncate(s.paymentIntent ?? s.sessionId, 100)}\``, inline: true },
      ),
    ],
  });
}

let checking = false;
let badKeyWarned = false;

/** Every 30 s: asks Stripe about each open payment link. */
async function checkPayments(client) {
  if (!env.stripeKey || checking) return;
  checking = true;
  try {
    const open = db.tickets((t) => t.typeId === 'order' && t.order?.stripe?.status === 'open' && t.status !== 'deleted');
    for (const ticket of open) {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild || guild.available === false) continue;
      const channel = guild.channels.cache.get(ticket.channelId);
      try {
        const session = await call('GET', `/checkout/sessions/${encodeURIComponent(ticket.order.stripe.sessionId)}`);
        const latest = db.getTicket(ticket.channelId);
        if (latest?.order?.stripe?.sessionId !== session.id || latest.order.stripe.status !== 'open') continue; // a new link meanwhile
        if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
          if (channel) await markPaid(client, channel, latest, session);
          else saveStripe(latest, { status: 'paid', paidAt: Date.now(), paidAmount: (session.amount_total ?? 0) / 100 });
        } else if (session.status === 'expired') {
          const updated = saveStripe(latest, { status: 'expired' });
          if (channel && updated.status === 'open') await editCard(channel, updated);
        } else if (latest.status !== 'open' || latest.completedAt || ['paid', 'progress', 'delivered'].includes(statusOf(latest))) {
          // Closed, completed or paid some other way – nobody should pay this link any more.
          await expireSession(session.id);
          const updated = saveStripe(latest, { status: 'expired' });
          if (channel && updated.status === 'open') await editCard(channel, updated);
        }
      } catch (err) {
        if (err.status === 401) {
          if (!badKeyWarned) console.warn('[stripe] STRIPE_SECRET_KEY was refused by Stripe – check the key in .env.');
          badKeyWarned = true;
          return;
        }
        console.warn(`[stripe] ticket ${ticket.channelId}:`, err.message);
      }
    }
  } finally {
    checking = false;
  }
}

/** Paid some other way (staff set Paid, or completed it) – the open link stops working right away. */
async function onOrderStatus({ guild, ticket, status }) {
  if (!['paid', 'progress', 'delivered'].includes(status)) return;
  const s = ticket?.order?.stripe;
  if (!env.stripeKey || s?.status !== 'open') return;
  // A Stripe payment that just came in sets Paid itself – checkPayments marks the link as paid first, so it isn't open here.
  await expireSession(s.sessionId);
  const updated = saveStripe(ticket, { status: 'expired' });
  const channel = guild?.channels.cache.get(ticket.channelId);
  if (channel) await editCard(channel, updated);
}

// ───────────── "New link" ─────────────

const lastNewLink = new Map();

async function newLink(interaction) {
  const { channel } = interaction;
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This button only works in an order ticket.');
  if (ticket.ownerId !== interaction.user.id && !isStaff(interaction.member, config.getType('order'))) throw new UserError('Only the customer or the team can make a new payment link.');
  if (!enabled()) throw new UserError('Card payments by link are turned off right now – a seller will help you in the ticket.');
  if (ticket.status !== 'open' || ticket.completedAt) throw new UserError('This order is closed.');
  if (!['awaiting', 'sent'].includes(statusOf(ticket))) throw new UserError('This order is already paid.');
  const last = lastNewLink.get(ticket.channelId) ?? 0;
  if (Date.now() - last < NEW_LINK_COOLDOWN) throw new UserError(`A new link was just made – you can make another ${ts(last + NEW_LINK_COOLDOWN, 'R')}.`);
  lastNewLink.set(ticket.channelId, Date.now());
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const updated = await postLink(channel, ticket).catch((err) => {
    console.warn(`[stripe] New link for ticket ${ticket.channelId}:`, err.message);
    throw new UserError("Stripe couldn't make a link right now – try again in a minute, or a seller helps you in the ticket.");
  });
  if (!updated) throw new UserError("This order has no fixed total yet – a seller confirms the price first.");
  return interaction.editReply({ content: `💳 Here's a new payment link for **${money(updated.order.stripe.amount)}** – the old one no longer works.` });
}

hooks.on('orderPlaced', onOrderPlaced);
hooks.on('orderStatus', onOrderStatus);
hooks.every('stripePayments', CHECK_EVERY, (client) => checkPayments(client), 20_000);
hooks.route('stripe', { button: (interaction, action) => (action === 'new' ? newLink(interaction) : null) });

module.exports = { currency, enabled, isStripeOrder, linkCard, postLink, checkPayments, LINK_HOURS };
