'use strict';

/**
 * Orders – what happens after a purchase is marked as completed (completeOrder in src/tickets/tickets.js
 * records the sale and emits orderCompleted), plus the first-purchase discount:
 *
 *   receipt           DM to the customer with the order details           config.orders.receipts
 *   proof             anonymous "Order delivered" card in #proofs           config.orders.proofs
 *   vouch reminder    one DM "How was your order?" some hours later         config.orders.vouchReminderHours (0 = off)
 *   welcome discount  personal first-order code by DM after verifying       config.welcomeDiscount
 *
 * Components:
 *   order:complete                              "Complete order" form (amount paid) from the ⚙️ ticket menu
 *   order:vouch:<guildId>:<ticketChannelId>     "Leave a vouch" button in DMs → vouch form
 *   order:vouched:<guildId>                     the vouch form sent from DMs
 */

const { ButtonStyle, MessageFlags } = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const promos = require('./promos');
const vouches = require('./vouches');
const tickets = require('../tickets/tickets');
const ui = require('../tickets/ui');
const { e, ce, COLORS } = require('../lib/theme');
const { UserError, reply, isStaff, money, parseAmount, pad, ts, duration, truncate, sendToChannel } = require('../lib/utils');
const { SPACER, container, text, divider, btn, linkBtn, row, header, v2, channelUrl } = require('../lib/v2');

const HOUR = 3_600_000;
const REMINDER_CHECK = 10 * 60_000;
const KEEP_SENT_REMINDERS = 30 * 86_400_000;

// ───────────── Helpers ─────────────

const catalog = (guildId) => db.guild(guildId).products;

/** The product's emoji when it can be shown (Unicode, or a custom emoji that still exists), otherwise 📦. */
function productEmoji(guild, product) {
  const raw = product?.emoji;
  if (raw && !raw.startsWith('<')) return raw;
  const id = raw?.match(/(\d{17,20})>$/)?.[1];
  const custom = id ? (guild.client?.emojis?.cache ?? guild.emojis?.cache)?.get(id) : null;
  return custom && custom.available !== false ? raw : e(guild, 'box');
}

/** The catalog product of a sale (by ID, or by name for orders from the Purchase ticket form). */
function catalogProduct(guildId, sale) {
  const list = catalog(guildId);
  return list.find((p) => p.id === sale.productId) ?? list.find((p) => p.name.toLowerCase() === String(sale.product ?? '').trim().toLowerCase()) ?? null;
}

/** A configured payment method name – free-text answers from the ticket form are never shown publicly. */
function publicMethod(sale) {
  const text = String(sale.method ?? '').toLowerCase();
  return config.shop.paymentMethods.find((m) => text && text.includes(m.name.toLowerCase()))?.name ?? null;
}

/** Shop / vouches link buttons (only for channels that exist). */
function linkButtons(guild, keys) {
  const LINKS = { shop: ['Shop', 'cart'], vouches: ['Vouches', 'star'] };
  return keys
    .map((key) => [db.channelId(guild.id, key), ...LINKS[key]])
    .filter(([id]) => id)
    .map(([id, label, icon]) => linkBtn(channelUrl(guild.id, id), label, ce(guild, icon)));
}

const vouchButton = (guild, ticketChannelId) => btn(`order:vouch:${guild.id}:${ticketChannelId}`, 'Leave a vouch', ce(guild, 'star'), ButtonStyle.Success);

const dm = (user, payload) => (user ? user.send(payload).then(() => true).catch(() => false) : Promise.resolve(false));

/** Did this member post a vouch after `since`? */
const vouchedSince = (guildId, userId, since) => db.guild(guildId).vouches.some((v) => v.userId === userId && v.at >= (since ?? 0));

// ───────────── Receipt (DM) ─────────────

function receiptCard(guild, { sale, ticket, sellerName }) {
  const order = ticket?.order ?? {};
  const c = container(COLORS.brand);
  header(
    c,
    `## ${e(guild, 'check')} Thank you for your order!\n` +
      `Here is your receipt from **${truncate(guild.name, 100)}**. Keep this message – it's your proof of purchase.`,
    guild.iconURL?.({ size: 128 }),
  );
  c.addSeparatorComponents(divider());
  const lines = [
    `**Order:** \`#${pad(sale.ticketNumber)}\`${SPACER}**Receipt:** \`${sale.id}\``,
    `**Product:** ${productEmoji(guild, catalogProduct(guild.id, sale))} ${truncate(sale.product ?? 'Custom order', 100)} × ${sale.quantity}`,
  ];
  if (order.unitPrice != null) lines.push(`**Unit price:** ${money(order.unitPrice)}`);
  if (sale.promo) lines.push(`**Discount:** ${sale.discount > 0 ? `−${money(sale.discount)}` : 'applied'} (code \`${sale.promo}\`)`);
  lines.push(`**Total paid:** ${sale.amount != null ? `**${money(sale.amount)}**` : 'as agreed in your ticket'}`);
  if (sale.method) lines.push(`**Payment method:** ${truncate(sale.method, 100)}`);
  lines.push(`**Date:** ${ts(sale.completedAt, 'f')}`);
  if (sellerName) lines.push(`**Seller:** ${truncate(sellerName, 64)}`);
  lines.push(`**Server:** ${truncate(guild.name, 100)}`);
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(`${e(guild, 'star')} **Happy with your order?** A quick vouch helps us a lot.\n-# Questions about this order? Open a ticket on the server. We never ask for payment in DMs.`),
  );
  const buttons = [];
  if (db.channelId(guild.id, 'vouches')) buttons.push(vouchButton(guild, sale.channelId));
  buttons.push(...linkButtons(guild, ['shop']));
  if (buttons.length) c.addActionRowComponents(row(...buttons));
  return v2(c);
}

async function sendReceipt({ guild, ticket, member, staff, sale }) {
  if (!config.orders.receipts) return;
  const user = member?.user ?? (await guild.client.users.fetch(sale.userId).catch(() => null));
  const sellerName = staff?.displayName ?? staff?.user?.globalName ?? staff?.user?.username ?? null;
  await dm(user, receiptCard(guild, { sale, ticket, sellerName }));
}

// ───────────── Proof (#proofs) ─────────────

/** Anonymous: no names, IDs, avatars or prices – only what was delivered and how fast. */
function proofCard(guild, sale) {
  const product = catalogProduct(guild.id, sale);
  // Shop orders store the catalog name; free-text answers from the ticket form are only shown if they match the catalog.
  const name = sale.productId ? sale.product : product?.name;
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(`## ${e(guild, 'check')} Order #${pad(sale.ticketNumber)} delivered\n${productEmoji(guild, product)} **${truncate(name || 'Custom order', 100)}** × ${sale.quantity}`),
  );
  c.addSeparatorComponents(divider());
  const facts = [];
  const method = publicMethod(sale);
  if (method) facts.push(`${e(guild, 'card')} Paid with **${method}**`);
  facts.push(`${e(guild, 'clock')} Delivered in **${duration(sale.completedAt - sale.createdAt)}**`);
  c.addTextDisplayComponents(text(`${facts.join(SPACER)}\n-# ${ts(sale.completedAt, 'R')} · Verified purchase at ${config.brand.name}`));
  const links = linkButtons(guild, ['shop', 'vouches']);
  if (links.length) c.addActionRowComponents(row(...links));
  return v2(c);
}

async function postProof({ guild, sale }) {
  if (!config.orders.proofs) return;
  await sendToChannel(guild, db.channelId(guild.id, 'proofs'), proofCard(guild, sale));
}

// ───────────── Vouch reminder (DM) ─────────────

function scheduleReminder({ guild, ticket, sale }) {
  const hours = Number(config.orders.vouchReminderHours) || 0;
  if (hours <= 0) return;
  db.guild(guild.id).reminders[ticket.channelId] = {
    userId: sale.userId,
    dueAt: sale.completedAt + hours * HOUR,
    sent: false,
    completedAt: sale.completedAt,
    saleId: sale.id,
    ticketNumber: sale.ticketNumber,
    product: sale.product,
  };
  db.save();
}

function reminderCard(guild, ticketChannelId, reminder) {
  const c = container(COLORS.brand);
  header(
    c,
    `## ${e(guild, 'star')} How was your order?\n` +
      `You recently bought **${truncate(reminder.product || 'something', 100)}** at **${truncate(guild.name, 100)}** (order \`#${pad(reminder.ticketNumber)}\`). ` +
      'We hope everything works perfectly! 💜\n\n' +
      'Would you leave us a quick vouch? It takes 30 seconds, you can do it right here – and it helps other buyers trust us.',
    guild.iconURL?.({ size: 128 }),
  );
  c.addActionRowComponents(row(vouchButton(guild, ticketChannelId)));
  c.addTextDisplayComponents(text('-# We only ask once. Something wrong with your order? Open a ticket on the server and we\'ll sort it out.'));
  return v2(c);
}

/** Sends every due reminder once – skipped when the customer already vouched after the order. */
async function runReminders(client, now = Date.now()) {
  for (const guildId of db.allGuildIds()) {
    const reminders = db.guild(guildId).reminders;
    const guild = client.guilds.cache.get(guildId);
    for (const [ticketChannelId, r] of Object.entries(reminders)) {
      if (r.sent) {
        if (now - (r.sentAt ?? r.dueAt) > KEEP_SENT_REMINDERS) delete reminders[ticketChannelId];
        continue;
      }
      if (!guild || r.dueAt > now) continue;
      Object.assign(r, { sent: true, sentAt: now }); // marked first, so a slow DM can never be sent twice
      db.save();
      if (vouchedSince(guildId, r.userId, r.completedAt)) r.result = 'already vouched';
      else if (!db.channelId(guildId, 'vouches')) r.result = 'no vouches channel';
      else {
        const member = await guild.members.fetch(r.userId).catch(() => null);
        if (!member) r.result = 'left the server';
        else r.result = (await dm(member, reminderCard(guild, ticketChannelId, r))) ? 'sent' : 'DMs closed';
      }
      db.save();
    }
  }
}

// ───────────── Vouching from DMs ─────────────

async function resolveMember(interaction, guildId) {
  const guild = interaction.client.guilds.cache.get(guildId);
  if (!guild) throw new UserError("I can't find that server anymore.");
  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) throw new UserError(`You need to be a member of **${guild.name}** to leave a vouch there.`);
  return { guild, member };
}

async function openVouchForm(interaction, [guildId, ticketChannelId]) {
  const { guild, member } = await resolveMember(interaction, guildId);
  const ticket = db.getTicket(ticketChannelId);
  if (ticket && ticket.ownerId !== member.id) throw new UserError('This button belongs to someone else.');
  if (ticket?.completedAt && vouchedSince(guild.id, member.id, ticket.completedAt)) {
    throw new UserError("You've already left a vouch for this order – thank you! 💜");
  }
  vouches.checkCanVouch(member);
  return interaction.showModal(vouches.vouchModal(guild, { customId: `order:vouched:${guild.id}`, productId: ticket?.order?.productId ?? null }));
}

async function submitVouchForm(interaction, [guildId]) {
  const { guild, member } = await resolveMember(interaction, guildId);
  return vouches.submitModal(interaction, guild, member);
}

// ───────────── "Complete order" form ─────────────

async function submitComplete(interaction) {
  const ticket = interaction.guild ? db.getTicket(interaction.channel?.id) : null;
  if (!ticket) throw new UserError('This channel is no longer a ticket.');
  if (!isStaff(interaction.member, config.getType(ticket.typeId))) throw new UserError('Only staff members can complete orders.');
  let raw = '';
  try {
    raw = interaction.fields.getTextInputValue('amount')?.trim() ?? '';
  } catch {
    raw = '';
  }
  const amount = raw ? parseAmount(raw) : null;
  if (raw && amount == null) throw new UserError(`\`${truncate(raw, 20)}\` is not an amount – type a number like **19.99**, or leave the field empty.`);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return tickets.completeOrder(interaction.channel, interaction.member, { amount, respond: (result) => reply(interaction, ui.orderCompletedReply(result)) });
}

// ───────────── First-purchase discount ─────────────

function welcomeCard(guild, member, promo) {
  const c = container(COLORS.brand);
  header(
    c,
    `## ${e(guild, 'gift')} A welcome gift from ${config.brand.name}\n` +
      `Thanks for joining, **${truncate(member.displayName ?? member.user?.username ?? 'friend', 64)}**! 💜 ` +
      `Here's **${promos.label(promo)} your first order** – just for you:`,
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`# \`${promo.code}\``));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${e(guild, 'info')} How to use it\n` +
        '> **1.** Open the shop and click **Buy** on any product\n' +
        '> **2.** Paste the code into the **Promo code** field of the order form\n' +
        '> **3.** The discount is taken off your total automatically\n\n' +
        `-# Valid until ${ts(promo.expiresAt, 'f')} (${ts(promo.expiresAt, 'R')}) · only for your account · one use · first order only`,
    ),
  );
  const links = linkButtons(guild, ['shop']);
  if (links.length) c.addActionRowComponents(row(...links));
  return v2(c);
}

/** Once per member ever: a personal first-order code by DM (deleted again if the DM can't be delivered). */
async function giveWelcomeCode(member) {
  const cfg = config.welcomeDiscount;
  if (!cfg.enabled || config.promos.enabled === false || member.user?.bot) return null;
  const guild = member.guild;
  const g = db.guild(guild.id);
  g.welcomeCodes ??= {}; // { [userId]: { code, at } } – who already got their welcome code
  if (g.welcomeCodes[member.id] || (g.orders[member.id] ?? 0) > 0) return null;
  g.welcomeCodes[member.id] = { code: null, at: Date.now() }; // claimed first, so a double "verified" can't send two codes
  const promo = promos.personal(guild.id, member.id, { percent: cfg.percent, days: cfg.validDays, prefix: 'WELCOME', firstOrderOnly: true, reason: 'welcome' });
  if (!(await dm(member, welcomeCard(guild, member, promo)))) {
    promos.remove(guild.id, promo.code);
    delete g.welcomeCodes[member.id];
    db.save();
    return null;
  }
  g.welcomeCodes[member.id].code = promo.code;
  db.save();
  return promo;
}

// ───────────── Wiring ─────────────

hooks.on('orderCompleted', sendReceipt);
hooks.on('orderCompleted', postProof);
hooks.on('orderCompleted', scheduleReminder);
hooks.on('verified', giveWelcomeCode);
hooks.every('vouchReminders', REMINDER_CHECK, (client) => runReminders(client), 60_000);
hooks.route('order', {
  dm: true,
  button: (interaction, action, args) => (action === 'vouch' ? openVouchForm(interaction, args) : null),
  modal: (interaction, action, args) => {
    if (action === 'complete') return submitComplete(interaction);
    if (action === 'vouched') return submitVouchForm(interaction, args);
    return null;
  },
});

module.exports = { receiptCard, proofCard, reminderCard, welcomeCard, runReminders, giveWelcomeCode, vouchedSince };
