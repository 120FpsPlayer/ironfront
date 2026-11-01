'use strict';

/**
 * Store balance (config.balance: { enabled, topUpMin, topUpMax }) – money a member keeps in the shop.
 * Topped-up balance is NON-REFUNDABLE and can't be paid out.
 *
 *   g.balances[userId] = { amount, history: [{ at, change, reason, by, ref }] }   (ref: the ticket channel, if any)
 *
 *   Top up      💰 Balance (My orders, the cart) → Top up → amount + payment method → an order ticket
 *               "Balance top-up 25€" (order.topUp = { amount }) paid like any order. Completing it (by staff, or
 *               automatically after Stripe / PayPal / crypto) credits the balance ONCE – in completeOrder, together
 *               with the sale – and delivers no product.
 *   Pay with it "Store balance (X€ available)" in the order form and at cart checkout: the total is taken at once
 *               (refused when it isn't enough), the order is Paid (order.paidWith = 'balance') and delivered
 *               automatically when the products have files or text. Closed / cancelled orders are NOT refunded –
 *               staff can give it back with /balance add.
 *   /balance    view (own, or a member's for staff) · add · remove (admins & sellers) – logged.
 *
 * Every change is checked and written with no await in between, so two orders can never spend the same money,
 * and a balance never goes below 0.
 *
 * Components:
 *   balance:open          💰 Balance – the member's balance, last changes and Top up (a new private message)
 *   balance:topup         Top up → the amount form
 *   balance:topupform     the amount form
 */

const { ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const { e, ce, COLORS, FALLBACK } = require('../lib/theme');
const { UserError, embed, logEmbed, money, pad, parseAmount, sendLog, truncate, ts } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, v2, notice } = require('../lib/v2');

const HISTORY_MAX = 50; // changes kept per member
const SHOWN = 8; // changes shown in the balance view
const MAX_AMOUNT = 100_000; // the most staff can add or remove at once
const NON_REFUNDABLE = "Balance can't be refunded or paid out.";
const METHOD = 'Store balance';

/** What the customer is told under a payment link (Stripe / PayPal) of a top-up. */
const PAID_NOTE = `💰 Once you've paid, the amount is added to your store balance automatically. ${NON_REFUNDABLE}`;

const round = (n) => Math.round(n * 100) / 100;
const enabled = () => config.balance?.enabled !== false;

/** config.balance.topUpMin / topUpMax as numbers (defaults 5 and 500). */
function limits() {
  const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);
  const min = num(config.balance?.topUpMin, 5);
  return { min, max: Math.max(min, num(config.balance?.topUpMax, 500)) };
}

// ───────────── The balance ─────────────

const accounts = (guildId) => db.guild(guildId).balances;

/** The member's balance (0 when they never had one). */
const get = (guildId, userId) => round(Number(accounts(guildId)[userId]?.amount) || 0);

/** The last changes, newest first. */
const history = (guildId, userId) => [...(accounts(guildId)[userId]?.history ?? [])].reverse();

/**
 * Adds (change > 0) or takes (change < 0) money – checked and written at once, never below 0.
 * → the history entry. Throws a UserError when there isn't enough.
 */
function change(guildId, userId, amount, { reason, by = null, ref = null, now = Date.now() } = {}) {
  const delta = round(Number(amount));
  if (!Number.isFinite(delta)) throw new Error('Bad balance change');
  const all = accounts(guildId);
  const before = round(Number(all[userId]?.amount) || 0);
  const after = round(before + delta);
  if (after < 0) throw new UserError(`Not enough store balance – that's **${money(-delta)}**, the balance is **${money(before)}**.`);
  const account = all[userId] ?? { amount: 0, history: [] };
  account.history ??= [];
  const entry = { at: now, change: delta, reason: truncate(reason ?? '—', 200), by, ref };
  account.amount = after;
  account.history.push(entry);
  if (account.history.length > HISTORY_MAX) account.history.splice(0, account.history.length - HISTORY_MAX);
  all[userId] = account;
  db.save();
  return entry;
}

/**
 * Pays an order with the balance – taken right away (before its ticket is opened, so a second order at the same
 * moment sees the lower balance). → the history entry, for giveBack() if the order can't be placed.
 */
function takeForOrder(guildId, userId, total, { reason = 'Order' } = {}) {
  if (!enabled()) throw new UserError('Paying with store balance is turned off right now – please choose another payment method.');
  if (total == null || !Number.isFinite(Number(total))) {
    throw new UserError("This order has no fixed price yet, so it can't be paid with store balance – please choose another payment method.");
  }
  const have = get(guildId, userId);
  if (have < total) {
    throw new UserError(`Not enough store balance: you have **${money(have)}**, this order is **${money(total)}**. Choose another payment method, or top up first (💰 Balance in **My orders**).`);
  }
  return change(guildId, userId, -total, { reason, by: userId });
}

/** The order couldn't be placed after its balance was taken – the money goes straight back (not a refund). */
function giveBack(guildId, userId, entry) {
  if (!entry || !(entry.change < 0)) return null;
  return change(guildId, userId, -entry.change, { reason: 'Order could not be placed – returned', by: userId });
}

/** The order of a balance payment is open now – its history entry points to the ticket. */
function linkOrder(entry, ticket) {
  if (!entry || !ticket) return;
  entry.reason = `Order #${pad(ticket.number)}`;
  entry.ref = ticket.channelId;
  db.save();
}

/** The order fields of an order paid with balance: Paid from the start. */
function paidFields(now = Date.now()) {
  return { method: METHOD, methodIndex: null, paidWith: 'balance', status: 'paid', statusAt: now, statusBy: null, history: [{ status: 'paid', at: now, by: null }] };
}

/** "Store balance (30€ available)" in a payment method menu – null when it's off or the balance isn't enough for `atLeast`. */
function paymentOption(guildId, userId, atLeast) {
  if (!enabled() || !userId || atLeast == null) return null;
  const have = get(guildId, userId);
  if (!(have > 0) || have < atLeast) return null;
  return { label: `${METHOD} (${money(have)} available)`, value: 'balance', description: "Paid at once from your balance – it can't be refunded", emoji: '💰' };
}

// ───────────── Top-ups ─────────────

/** "25", "25.50" → 25.5 within topUpMin–topUpMax (or a UserError). */
function parseTopUp(raw) {
  const { min, max } = limits();
  const amount = parseAmount(raw);
  if (amount == null || !(amount > 0)) throw new UserError(`\`${truncate(raw, 20)}\` is not an amount – type a number like **25** or **19.99**.`);
  if (amount < min || amount > max) throw new UserError(`You can top up from **${money(min)}** to **${money(max)}** at once.`);
  return round(amount);
}

function topUpModal(guild) {
  const { min, max } = limits();
  const modal = new ModalBuilder()
    .setCustomId('balance:topupform')
    .setTitle('💰 Top up your store balance')
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Pay once – then choose **${METHOD}** when you order, and it's taken off instantly.\n-# ⚠️ ${NON_REFUNDABLE} Only top up what you plan to spend here.`,
      ),
    )
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Amount (${config.shop.currency ?? '€'})`.slice(0, 45))
        .setDescription(`From ${money(min)} to ${money(max)}.`)
        .setTextInputComponent(new TextInputBuilder().setCustomId('amount').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(10).setPlaceholder(`e.g. ${Math.max(min, Math.min(25, max))}`)),
    );
  const methods = require('../lib/paymentState').activeMethods(guild?.id).slice(0, 25); // without methods switched off (/disable)
  if (!methods.length && require('../lib/paymentState').allOff(guild?.id)) throw new UserError('Payments are paused for a moment – please try again a bit later.');
  if (methods.length) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Payment method')
        .setDescription('How would you like to pay? Details follow in your ticket.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('payment')
            .setPlaceholder('Choose a payment method…')
            .addOptions(methods.map(({ m, index: i }) => ({ label: truncate(m.name, 100), value: String(i), description: m.details ? truncate(m.details, 100) : undefined, emoji: guild ? ce(guild, m.emoji) : FALLBACK[m.emoji] ?? '💳' }))),
        ),
    );
  } else {
    modal.addLabelComponents(
      new LabelBuilder().setLabel('Payment method').setTextInputComponent(new TextInputBuilder().setCustomId('payment_text').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)),
    );
  }
  return modal;
}

/** A text field of a form ('' when it's empty or not there). */
function field(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** The payment method picked in a form → { method, methodIndex, payment } (payment: what the ticket shows). */
function pickedMethod(interaction) {
  const picked = pickedRaw(interaction);
  if (picked.methodIndex != null) require('../lib/paymentState').assertOn(interaction.guild.id, picked.method); // switched off since the form opened
  return picked;
}

function pickedRaw(interaction) {
  const typed = field(interaction, 'payment_text');
  try {
    const [index] = interaction.fields.getStringSelectValues('payment');
    const m = config.shop.paymentMethods[Number(index)];
    if (m) return { method: m.name, methodIndex: Number(index), payment: m.details ? `${m.name} (${m.details})` : m.name };
  } catch {
    // the text field instead
  }
  return { method: typed || null, methodIndex: null, payment: typed };
}

function openTopUp(interaction) {
  if (!enabled()) throw new UserError('Store balance is turned off right now.');
  const error = require('../tickets/tickets').checkCanOpen(interaction.member);
  if (error) throw new UserError(error);
  return interaction.showModal(topUpModal(interaction.guild));
}

/** The top-up form → an order ticket for "Balance top-up 25€", paid like any other order. */
async function submitTopUp(interaction) {
  if (!enabled()) throw new UserError('Store balance is turned off right now.');
  const tickets = require('../tickets/tickets');
  const amount = parseTopUp(field(interaction, 'amount'));
  const { method, methodIndex, payment } = pickedMethod(interaction);
  const product = `Balance top-up ${money(amount)}`;
  const answers = [
    { label: 'Balance top-up', value: `**${money(amount)}** – added to your store balance once the payment is confirmed.\n⚠️ ${NON_REFUNDABLE}` },
    { label: 'Payment method', value: payment || '—' },
    { label: 'Price', value: `**Total to pay: ${money(amount)}**` },
  ];
  const order = { productId: null, product, unitPrice: amount, quantity: 1, method, methodIndex, promo: null, discount: 0, subtotal: amount, total: amount, topUp: { amount } };
  const error = tickets.checkCanOpen(interaction.member);
  if (error) throw new UserError(error);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await tickets.openTicket(interaction.member, config.getType('order'), answers, { order });
  const answer = await interaction.editReply({
    embeds: [
      embed(COLORS.success)
        .setTitle(truncate(`💰 Top-up started – ${money(amount)}`, 256))
        .setDescription(
          `Your private order ticket is ready: ${channel}\n` +
            `${e(interaction.guild, 'card')} Total to pay: **${money(amount)}** – it's added to your balance once the payment is confirmed.\n` +
            `⚠️ ${NON_REFUNDABLE}\n**Never pay anyone in DMs.**`,
        ),
    ],
    components: [row(linkBtn(channel.url, 'Go to my top-up', '🎫'))],
  });
  await hooks.emit('orderPlaced', { guild: interaction.guild, channel, ticket: db.getTicket(channel.id), member: interaction.member });
  return answer;
}

/**
 * Called by completeOrder (src/tickets/tickets.js) right after the sale is recorded, with no await in between:
 * a completed top-up credits the balance – exactly once. The amount is what was paid (sale.amount), or the
 * top-up amount when the amount paid wasn't entered. → { amount, balance } or null (not a top-up / already done).
 */
function creditTopUp(guildId, ticket, sale) {
  const topUp = ticket?.order?.topUp;
  if (!topUp || topUp.creditedAt) return null;
  const amount = round(sale?.amount != null ? Number(sale.amount) : Number(topUp.amount) || 0);
  const now = Date.now();
  if (amount > 0) change(guildId, ticket.ownerId, amount, { reason: `Top-up #${pad(ticket.number)}`, by: sale?.sellerId ?? null, ref: ticket.channelId, now });
  db.updateTicket(ticket.channelId, { order: { ...ticket.order, topUp: { ...topUp, creditedAt: now, credited: Math.max(0, amount) } } });
  return { amount: Math.max(0, amount), balance: get(guildId, ticket.ownerId) };
}

/** The card in the ticket when a top-up is completed (instead of "Order completed" with a vouch button). */
function topUpDoneCard(guild, ticket, sale) {
  const credited = ticket.order?.topUp?.credited ?? sale?.amount ?? ticket.order?.topUp?.amount;
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(
      `## 💰 Balance topped up!\n<@${ticket.ownerId}>, **${money(credited)}** was added to your store balance – you now have **${money(get(guild.id, ticket.ownerId))}**.\n` +
        `Pay with it in the shop: choose **${METHOD}** as the payment method when you order.`,
    ),
  );
  c.addTextDisplayComponents(text(`-# ⚠️ ${NON_REFUNDABLE}${sale ? ` · Receipt \`${sale.id}\`` : ''} · ${ts(Date.now(), 'f')}`));
  return v2(c, { mentions: { users: [ticket.ownerId] } });
}

/** A completed top-up in the log channel. */
async function logTopUp({ guild, ticket, staff, sale }) {
  const credited = ticket?.order?.topUp?.credited;
  if (credited == null || !sale) return;
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '💰 Balance topped up', staff?.user ?? staff ?? null).addFields(
        { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Added', value: money(credited), inline: true },
        { name: 'Balance now', value: money(get(guild.id, ticket.ownerId)), inline: true },
        { name: 'Ticket', value: `<#${ticket.channelId}> (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Sale', value: `\`${sale.id}\``, inline: true },
      ),
    ],
  }).catch(() => null);
}

// ───────────── Orders paid with balance ─────────────

/**
 * A new order paid with balance: a notice in the ticket, the log, and – when every product has files or text –
 * the instant delivery (src/features/delivery.js), which completes the order. Otherwise the team is pinged.
 */
async function onOrderPlaced({ guild, channel, ticket }) {
  if (!channel || ticket?.order?.paidWith !== 'balance') return;
  const delivery = require('./delivery');
  const autopay = require('./autopay');
  const order = ticket.order;
  const instant = delivery.deliverable(guild.id, ticket);
  const pings = instant ? { users: [], roles: [] } : autopay.pingsFor(guild, ticket);
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  const ask = instant ? ' 📦 The product is delivered automatically.' : who ? ` ${who}, please deliver it.` : '';
  await channel
    .send(notice(COLORS.success, `💰 **Paid with store balance – ${money(order.total)}** for order \`#${pad(ticket.number)}\`. Balance left: **${money(get(guild.id, ticket.ownerId))}**.${ask}`, { mentions: pings }))
    .catch(() => null);
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '💰 Paid with store balance', guild.client.user).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Amount', value: money(order.total), inline: true },
        { name: 'Balance left', value: money(get(guild.id, ticket.ownerId)), inline: true },
      ),
    ],
  }).catch(() => null);
  if (!instant) return;
  const done = await delivery.deliverPaid(channel, db.getTicket(channel.id), { amount: order.total }).catch((err) => {
    console.warn('[balance] delivery:', err.message);
    return false;
  });
  if (!done) {
    const team = autopay.pingsFor(guild, ticket);
    const mention = [...team.users.map((id) => `<@${id}>`), ...team.roles.map((id) => `<@&${id}>`)].join(' ');
    await channel.send(notice(COLORS.warning, `⚠️ The product couldn't be delivered automatically${mention ? ` – ${mention}, please deliver it by hand` : ' – a seller delivers it by hand'}.`, { mentions: team })).catch(() => null);
  }
}

// ───────────── The 💰 Balance view ─────────────

/** "+25€ · Top-up #0012 · <t:…:R>" */
function historyLine(h) {
  const sign = h.change >= 0 ? '+' : '−';
  return `\`${sign}${money(Math.abs(h.change))}\` · ${truncate(h.reason, 80)}${h.ref ? ` · <#${h.ref}>` : ''} · ${ts(h.at, 'R')}`;
}

/** The private balance view of one member (also /balance view). */
function balanceView(guild, userId, { staffView = false } = {}) {
  const amount = get(guild.id, userId);
  const changes = history(guild.id, userId).slice(0, SHOWN);
  const c = container(COLORS.brand);
  const whose = staffView ? `<@${userId}> has` : 'You have';
  c.addTextDisplayComponents(
    text(
      `## 💰 Store balance\n${whose} **${money(amount)}** to spend in the shop.\n` +
        (staffView ? '' : `-# Pay with it: choose **${METHOD}** as the payment method in the order form or at cart checkout.`),
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`### Last changes\n${changes.length ? changes.map(historyLine).join('\n') : '-# Nothing yet.'}`));
  c.addTextDisplayComponents(text(`-# ⚠️ ${NON_REFUNDABLE}`));
  if (!staffView && enabled()) {
    const buttons = [btn('balance:topup', 'Top up', ce(guild, 'wallet'), ButtonStyle.Success)];
    if (config.cart?.enabled !== false) buttons.push(btn('cart:open', 'Cart', ce(guild, 'cart')));
    c.addActionRowComponents(row(...buttons));
  }
  return v2(c);
}

/** "💰 Balance: 30€" – the button in My orders and the cart (null when balance is off). */
const balanceButton = (guild, userId) => (enabled() ? btn('balance:open', `Balance: ${money(get(guild.id, userId))}`, ce(guild, 'wallet')) : null);

async function showBalance(interaction) {
  if (!enabled()) throw new UserError('Store balance is turned off right now.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return interaction.editReply(balanceView(interaction.guild, interaction.user.id));
}

// ───────────── Staff: /balance add | remove ─────────────

/** /balance add | remove – amount > 0; never below 0. Logged to the ticket log channel. → the new balance. */
async function staffChange(guild, staff, user, amount, reason, { remove = false } = {}) {
  const value = round(Number(amount));
  if (!(value > 0) || value > MAX_AMOUNT) throw new UserError(`The amount must be more than 0 and at most ${money(MAX_AMOUNT)}.`);
  if (user.bot) throw new UserError('Bots have no store balance.');
  const why = String(reason ?? '').trim();
  if (!why) throw new UserError('Give a reason – it is kept in the balance history and the log.');
  const before = get(guild.id, user.id);
  if (remove && value > before) throw new UserError(`<@${user.id}> only has **${money(before)}** – you can remove up to that.`);
  change(guild.id, user.id, remove ? -value : value, { reason: why, by: staff.id });
  const after = get(guild.id, user.id);
  await sendLog(guild, {
    embeds: [
      logEmbed(remove ? COLORS.danger : COLORS.success, remove ? '💰 Balance removed' : '💰 Balance added', staff.user ?? staff).addFields(
        { name: 'Member', value: `<@${user.id}>`, inline: true },
        { name: remove ? 'Removed' : 'Added', value: money(value), inline: true },
        { name: 'Balance', value: `${money(before)} → **${money(after)}**`, inline: true },
        { name: 'Reason', value: truncate(why, 1024) },
      ),
    ],
  }).catch(() => null);
  return after;
}

hooks.on('orderPlaced', onOrderPlaced);
hooks.on('orderCompleted', logTopUp);
hooks.route('balance', {
  button(interaction, action) {
    if (action === 'open') return showBalance(interaction);
    if (action === 'topup') return openTopUp(interaction);
    return null;
  },
  modal: (interaction, action) => (action === 'topupform' ? submitTopUp(interaction) : null),
});

module.exports = {
  METHOD,
  NON_REFUNDABLE,
  PAID_NOTE,
  enabled,
  limits,
  get,
  history,
  change,
  takeForOrder,
  giveBack,
  linkOrder,
  paidFields,
  paymentOption,
  parseTopUp,
  topUpModal,
  creditTopUp,
  topUpDoneCard,
  balanceView,
  balanceButton,
  staffChange,
};
