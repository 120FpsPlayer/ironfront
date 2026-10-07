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
 * Money rules: a link is only replaced or marked as stopped once Stripe itself says so (a link that was paid in
 * the meantime is recorded, never lost); an order is only set to Paid when the amount and currency match its
 * total; links of closed or deleted tickets are stopped – and still watched until Stripe confirms it.
 *
 * ticket.order.stripe = { sessionId, url, amount, currency, createdAt, expiresAt, attempt, messageId,
 *   status ('open' | 'paid' | 'expired'), paidAt, paidAmount, paymentIntent }
 * ticket.stripeAttempts – links made so far (each try gets its own Idempotency-Key)
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
const WATCH_AFTER_EXPIRY = 3 * 24 * 3_600_000; // links that never report back stop being checked after this
const NEW_LINK_COOLDOWN = 60_000;
const PAID = ['paid', 'progress', 'delivered'];

/** Currencies with their decimals (Stripe amounts are in the smallest unit: 12.50€ → 1250, ¥1200 → 1200). */
const DECIMALS = { eur: 2, usd: 2, gbp: 2, pln: 2, chf: 2, sek: 2, nok: 2, dkk: 2, czk: 2, ron: 2, bgn: 2, cad: 2, aud: 2, nzd: 2, jpy: 0, krw: 0 };
const SYMBOLS = { '€': 'eur', $: 'usd', '£': 'gbp', zł: 'pln', kč: 'czk', '¥': 'jpy', '₩': 'krw' };

/**
 * "eur" – config.json → stripe.currency, or worked out from shop.currency (€ → eur, $ → usd, zł → pln).
 * null when it isn't clear (e.g. "kr" – SEK, NOK or DKK?): then no links are made rather than charging the wrong currency.
 */
function currency() {
  const set = String(config.stripe?.currency ?? '').trim().toLowerCase();
  if (set) return set in DECIMALS ? set : null;
  const shop = String(config.shop.currency ?? '€').trim().toLowerCase();
  return SYMBOLS[shop] ?? (shop in DECIMALS ? shop : null);
}

const toUnits = (amount, cur) => Math.round(amount * 10 ** DECIMALS[cur]);
const fromUnits = (units, cur) => units / 10 ** (DECIMALS[cur] ?? 2);

let keyRefused = false; // Stripe answered 401/403 – until a call works again
const refusedWarned = new Set(); // guilds told about it in their log channel
let currencyWarned = false;

/** The key works (as far as we know) – open links get checked. */
const working = () => Boolean(env.stripeKey) && !keyRefused;

/** New links are made: a key, a clear currency and config.json → stripe.enabled isn't false (a refused key is tried again). */
const enabled = () => Boolean(env.stripeKey) && config.stripe?.enabled !== false && currency() != null;

/** The order has a Stripe link that confirms itself – "I've paid" isn't needed then. */
const confirmsItself = (ticket) => ticket?.order?.stripe?.status === 'open' && working();

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
    err.refused = res.status === 401 || res.status === 403;
    if (err.refused) keyRefused = true;
    throw err;
  }
  keyRefused = false;
  refusedWarned.clear();
  return data;
}

/** The session as Stripe sees it – null when it doesn't exist (e.g. a test-mode link after switching to a live key). */
const getSession = (id) =>
  call('GET', `/checkout/sessions/${encodeURIComponent(id)}`).catch((err) => {
    if (err.status === 404) return null;
    throw err;
  });

/**
 * Stops a link. Stripe refuses that for a link that was paid (or is being paid) meanwhile – so this returns the
 * session as Stripe sees it afterwards, and the caller records whatever it is. Throws when Stripe can't be reached.
 */
const stopSession = (id) => call('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`).catch(() => getSession(id));

/** Checkout Session for the order's total – one line "NØX order #0012 – Netflix — 3 months × 2". */
function createSession(guild, ticket, order, cur, attempt) {
  const back = channelUrl(guild.id, ticket.channelId);
  return call(
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      'payment_method_types[0]': 'card', // card, Apple Pay, Google Pay – confirmed instantly, never days later
      'line_items[0][quantity]': 1,
      'line_items[0][price_data][currency]': cur,
      'line_items[0][price_data][unit_amount]': toUnits(order.total, cur),
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

// ───────────── The card in the ticket ─────────────

function linkCard(ticket, s) {
  const c = container(s.status === 'paid' ? COLORS.success : s.status === 'expired' ? COLORS.warning : COLORS.brand);
  const total = money(s.amount);
  if (s.status === 'paid') {
    c.addTextDisplayComponents(text(`## ✅ Paid with Stripe\n**${money(s.paidAmount ?? s.amount)}** for order \`#${pad(ticket.number)}\` – received ${ts(s.paidAt, 'R')}.`));
    return v2(c);
  }
  if (s.status === 'expired') {
    c.addTextDisplayComponents(text(`## 💳 Payment link expired\nThe Stripe link for order \`#${pad(ticket.number)}\` (**${total}**) no longer works.\n-# Still want to pay by card? Get a new link.`));
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

/** Merges into the CURRENT order (never an older copy – a status set meanwhile stays). */
function saveStripe(channelId, patch, { replace = false } = {}) {
  const latest = db.getTicket(channelId);
  const order = tickets.orderDetails(latest);
  return db.updateTicket(channelId, { order: { ...order, stripe: replace ? patch : { ...order.stripe, ...patch } } });
}

async function editCard(guild, ticket) {
  const channel = guild?.channels.cache.get(ticket.channelId);
  const id = ticket.order?.stripe?.messageId;
  const message = channel && id ? await channel.messages.fetch(id).catch(() => null) : null;
  if (message) await message.edit(linkCard(ticket, ticket.order.stripe)).catch(() => null);
}

// ───────────── Recording what Stripe says ─────────────

const pingsFor = (guild, ticket) =>
  ticket.claimedBy
    ? { users: [ticket.claimedBy], roles: [] }
    : { users: [], roles: alertRoleIds(guild.id, config.getType(ticket.typeId)).filter((id) => guild.roles.cache.has(id)) };

/**
 * Stripe says the link is paid. The order is set to Paid only when amount and currency match its total and it
 * wasn't paid already – otherwise the team is asked to check it (a changed total, a second payment).
 */
async function markPaid(guild, ticket, session) {
  const s = ticket.order.stripe;
  const cur = String(session.currency ?? s.currency ?? '').toLowerCase();
  const paidAmount = session.amount_total != null ? fromUnits(session.amount_total, cur) : s.amount;
  const before = ticket.completedAt ? 'delivered' : ticket.order?.status ?? 'awaiting';
  let updated = saveStripe(ticket.channelId, {
    status: 'paid',
    paidAt: Date.now(),
    paidAmount,
    paidCurrency: cur,
    paymentIntent: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null,
  });
  const total = tickets.orderDetails(updated).total;
  const matches = cur === currency() && total != null && Math.abs(paidAmount - total) < 0.005;
  const twice = PAID.includes(before);
  // A deleted ticket's channel may still be there for a few seconds – the log is the place then.
  const channel = updated.status === 'deleted' ? null : guild.channels.cache.get(updated.channelId) ?? null;
  const bot = guild.client.user;
  if (matches && !twice) {
    // Open ticket → the usual status change (notice, card, DM); closed ticket → recorded, so reopening shows it.
    if (channel && updated.status === 'open') await orderstatus.setStatus(channel, 'paid', bot).catch((err) => console.warn('[stripe] status:', err.message));
    else orderstatus.recordStatus(updated, 'paid', { by: bot?.id ?? null });
    updated = db.getTicket(updated.channelId);
  }
  await editCard(guild, updated);

  const s2 = updated.order.stripe;
  const warnings = [];
  if (twice) warnings.push(`⚠️ This order was already **${before === 'delivered' ? 'completed' : 'marked as paid'}** – the customer may have paid twice. Check it (refunds: Stripe Dashboard).`);
  else if (!matches) warnings.push(`⚠️ The order total is **${total == null ? 'not fixed' : money(total)}** – it was **not** set to Paid. Check the difference first.`);
  if (updated.status !== 'open') warnings.push(`⚠️ The ticket was ${channel ? 'closed' : 'deleted'} when the payment came in${channel ? ' – reopen it to deliver' : ' – contact the customer'}.`);
  const pings = pingsFor(guild, updated);
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  const head = `💳 **Stripe payment received – ${money(paidAmount)}** for order \`#${pad(updated.number)}\`.`;
  if (channel) {
    const ask = matches && !twice && who ? ` ${who}, please deliver it.` : who ? ` ${who}` : '';
    await channel.send(notice(warnings.length ? COLORS.warning : COLORS.success, `${head}${ask}${warnings.length ? `\n${warnings.join('\n')}` : ''}`, { mentions: pings })).catch(() => null);
  }
  await sendLog(guild, {
    // Without a ticket channel the log is the only place the team hears about it – ping them there.
    ...(!channel && who && { content: who, allowedMentions: pings }),
    embeds: [
      logEmbed(warnings.length ? COLORS.warning : COLORS.success, '💳 Stripe payment received', bot).addFields(
        { name: 'Ticket', value: `<#${updated.channelId}> (\`#${pad(updated.number)}\`)`, inline: true },
        { name: 'Customer', value: `<@${updated.ownerId}>`, inline: true },
        { name: 'Amount', value: money(paidAmount), inline: true },
        { name: 'Stripe', value: `\`${truncate(s2.paymentIntent ?? s2.sessionId, 100)}\``, inline: true },
        ...(warnings.length ? [{ name: 'Check', value: truncate(warnings.join('\n'), 1024) }] : []),
      ),
    ],
  }).catch(() => null);
}

/** Records what Stripe says about the ticket's current link → 'paid' | 'expired' | 'open' (still open, or being paid). */
async function settle(guild, ticket, session) {
  if (!session || session.status === 'expired') {
    const updated = saveStripe(ticket.channelId, { status: 'expired' });
    await editCard(guild, updated);
    return 'expired';
  }
  if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
    await markPaid(guild, ticket, session);
    return 'paid';
  }
  return 'open';
}

/**
 * Makes a payment link for the order and posts it in the ticket (the old link is stopped first).
 * → { result: 'created', ticket } · { result: 'paid' } (the old link was just paid) · { result: 'none' } (no fixed total).
 */
async function postLink(channel, ticket) {
  const guild = channel.guild;
  const cur = currency();
  const order = tickets.orderDetails(ticket);
  if (!cur || !(order.total > 0) || (DECIMALS[cur] === 2 && toUnits(order.total, cur) < 50)) return { result: 'none' };
  const old = order.stripe;
  if (old?.status === 'open') {
    const state = await settle(guild, ticket, await stopSession(old.sessionId));
    if (state === 'paid') return { result: 'paid' };
    if (state === 'open') throw new UserError("The current link is being paid right now – give it a minute, it's confirmed here automatically.");
  }
  // Counted before calling Stripe: every try has its own Idempotency-Key, also after one that failed half-way.
  const attempt = (db.getTicket(ticket.channelId).stripeAttempts ?? 0) + 1;
  db.updateTicket(ticket.channelId, { stripeAttempts: attempt });
  const session = await createSession(guild, ticket, order, cur, attempt);
  const latest = db.getTicket(ticket.channelId);
  if (latest.status !== 'open' || latest.completedAt || !['awaiting', 'sent'].includes(statusOf(latest))) {
    await stopSession(session.id).catch(() => null); // paid or closed meanwhile – this link isn't needed
    return { result: 'none' };
  }
  const s = {
    sessionId: session.id,
    url: session.url,
    amount: order.total,
    currency: cur,
    createdAt: Date.now(),
    expiresAt: (session.expires_at ?? 0) * 1000 || Date.now() + LINK_HOURS * 3_600_000,
    attempt,
    status: 'open',
    messageId: null,
  };
  // Saved before the card is posted – a link that exists on Stripe is always watched.
  saveStripe(ticket.channelId, s, { replace: true });
  const sent = await channel.send(linkCard(latest, s)).catch(() => null);
  const updated = saveStripe(ticket.channelId, { messageId: sent?.id ?? null });
  if (old?.messageId) {
    const before = await channel.messages.fetch(old.messageId).catch(() => null);
    await before?.delete().catch(() => null);
  }
  await tickets.refreshControlMessage(channel, updated); // the "I've paid" button isn't needed with a link
  return { result: 'created', ticket: updated };
}

/** A new order with Stripe as its payment method → its payment link, right away. */
async function onOrderPlaced({ channel, ticket }) {
  if (!channel || !isStripeOrder(ticket?.order) || !env.stripeKey) return;
  if (!enabled()) {
    if (config.stripe?.enabled !== false && currency() == null && !currencyWarned) {
      currencyWarned = true;
      console.warn(`[stripe] No payment links: set config.json → stripe.currency (e.g. "sek") – "${config.shop.currency}" isn't clear.`);
    }
    return;
  }
  try {
    const { result } = await postLink(channel, ticket);
    if (result === 'none') await channel.send(notice(COLORS.brand, '💳 A seller sends you the Stripe payment link once the final price is confirmed.'));
  } catch (err) {
    console.warn(`[stripe] Could not make a payment link for ticket ${ticket.channelId}:`, err.message);
    await channel.send(notice(COLORS.warning, "💳 The card payment link couldn't be made right now – a seller sends you one shortly.")).catch(() => null);
  }
}

// ───────────── Checking the open links ─────────────

let checking = false;
const warnedTickets = new Set();

async function warnRefused(client) {
  console.warn('[stripe] STRIPE_SECRET_KEY was refused by Stripe – check the key in .env.');
  const guildIds = new Set(db.tickets((t) => t.order?.stripe?.status === 'open').map((t) => t.guildId));
  for (const id of guildIds) {
    const guild = client.guilds.cache.get(id);
    if (!guild || refusedWarned.has(id)) continue;
    refusedWarned.add(id);
    await sendLog(guild, {
      embeds: [
        logEmbed(COLORS.danger, '⚠️ Stripe refused the key', client.user).setDescription(
          'Card payments **can\'t be confirmed automatically** right now – check open Stripe orders in your Stripe Dashboard and set them to Paid by hand. Fix `STRIPE_SECRET_KEY` in `.env` and restart the bot.',
        ),
      ],
    }).catch(() => null);
  }
}

/** Every 30 s: asks Stripe about each open payment link – also of closed and deleted tickets, until Stripe has settled it. */
async function checkPayments(client) {
  if (!env.stripeKey || checking) return;
  checking = true;
  try {
    for (const ticket of db.tickets((t) => t.typeId === 'order' && t.order?.stripe?.status === 'open')) {
      const guild = client.guilds.cache.get(ticket.guildId);
      if (!guild || guild.available === false) continue;
      try {
        const session = await getSession(ticket.order.stripe.sessionId);
        const latest = db.getTicket(ticket.channelId);
        if (latest?.order?.stripe?.sessionId !== ticket.order.stripe.sessionId || latest.order.stripe.status !== 'open') continue; // changed meanwhile
        if ((await settle(guild, latest, session)) !== 'open') continue;
        const stop = latest.status !== 'open' || latest.completedAt || PAID.includes(statusOf(latest));
        if (stop && session.status === 'open') {
          // Closed, deleted, completed or paid another way – nobody should pay this link any more.
          await settle(guild, db.getTicket(ticket.channelId), await stopSession(session.id));
        } else if (Date.now() > (latest.order.stripe.expiresAt ?? 0) + WATCH_AFTER_EXPIRY) {
          saveStripe(ticket.channelId, { status: 'expired' }); // never reported back – stop asking
        }
      } catch (err) {
        if (err.refused) {
          await warnRefused(client);
          return;
        }
        if (!warnedTickets.has(ticket.channelId)) console.warn(`[stripe] ticket ${ticket.channelId}:`, err.message);
        warnedTickets.add(ticket.channelId);
      }
    }
  } finally {
    checking = false;
  }
}

/** Paid some other way (staff set Paid, or completed it) – the open link is stopped, or recorded if it was paid too. */
async function onOrderStatus({ guild, ticket, status }) {
  if (!PAID.includes(status) || !guild || !working()) return;
  const s = ticket?.order?.stripe;
  if (s?.status !== 'open') return; // a Stripe payment sets Paid itself – its link is marked as paid before that
  const session = await stopSession(s.sessionId).catch(() => undefined);
  if (session === undefined) return; // Stripe unreachable – checkPayments tries again
  await settle(guild, db.getTicket(ticket.channelId), session);
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
  let done;
  try {
    done = await postLink(channel, ticket);
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn(`[stripe] New link for ticket ${ticket.channelId}:`, err.message);
    throw new UserError("Stripe couldn't make a link right now – try again in a minute, or a seller helps you in the ticket.");
  }
  if (done.result === 'paid') return interaction.editReply({ content: '✅ Your payment just came in – no new link needed.' });
  if (done.result === 'none') throw new UserError('This order has no fixed total yet – a seller confirms the price first.');
  return interaction.editReply({ content: `💳 Here's a new payment link for **${money(done.ticket.order.stripe.amount)}** – the old one no longer works.` });
}

hooks.on('orderPlaced', onOrderPlaced);
hooks.on('orderStatus', onOrderStatus);
hooks.every('stripePayments', CHECK_EVERY, (client) => checkPayments(client), 20_000);
hooks.route('stripe', { button: (interaction, action) => (action === 'new' ? newLink(interaction) : null) });

module.exports = { currency, enabled, working, confirmsItself, isStripeOrder, linkCard, postLink, checkPayments, LINK_HOURS, DECIMALS };
