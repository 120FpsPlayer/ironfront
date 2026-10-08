'use strict';

/**
 * Product delivery – the files (and text, e.g. a key or a login) a buyer gets, set with /product delivery.
 *
 *   PayPal / Stripe: once the payment is confirmed (src/features/autopay.js) → "📦 Your product is on the way"
 *     → the product, in the ticket and by DM → the order is completed (sale, receipt, Customer role…)
 *   Other methods (PaysafeCard, crypto…): "Pay" → "📦 Your product is on the way" → staff check the payment
 *     and click "Payment OK – deliver" (or ⚙️ → Deliver product) → the product → the order is completed
 * Products without files or text are delivered by hand, like before.
 *
 * product.delivery = { files: [{ name, size }], text, updatedAt } – the files are in data/deliveries/<productId>/
 * ticket.order.delivered = { at, by, dm, auto }
 */

const { ButtonStyle, FileBuilder, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const files = require('../lib/deliveryFiles');
const { statusOf } = require('../lib/orderStatus');
const { isStaff } = require('../lib/permissions');
const { COLORS } = require('../lib/theme');
const { UserError, logEmbed, pad, ts, truncate, sendLog } = require('../lib/utils');
const { container, text, divider, btn, v2, notice } = require('../lib/v2');

const TEXT_MAX = 1500;

// Here – shop.js and tickets.js need this file.
const shop = () => require('./shop');
const tickets = () => require('../tickets/tickets');

/** Does the product have something to deliver (files or text)? */
const hasDelivery = (product) => Boolean(product?.delivery?.files?.length || product?.delivery?.text);

/** The catalog product of an order ticket (null for custom orders). */
const productFor = (guildId, ticket) => shop().ticketProduct(guildId, ticket);

/** Can this order be delivered automatically (the product has files or text)? */
const deliverable = (guildId, ticket) => hasDelivery(productFor(guildId, ticket));

// ───────────── /product delivery ─────────────

/**
 * Sets what a product delivers. attachments – slash command uploads (added, a file with the same name is
 * replaced); text – the delivery text ('' leaves it, 'none' removes it); clear – removes everything first.
 */
async function setDelivery(guild, query, { attachments = [], text: deliveryText = null, clear = false }) {
  const p = shop().findProduct(guild.id, query);
  if (!p) throw new UserError('There is no such product. Pick one from the suggestions.');
  const current = clear ? { files: [], text: null } : { files: [...(p.delivery?.files ?? [])], text: p.delivery?.text ?? null };
  const uploads = attachments.filter(Boolean);
  const replaced = new Set(uploads.map((a) => files.cleanName(a.name)));
  const kept = current.files.filter((f) => !replaced.has(f.name));
  if (kept.length + uploads.length > files.MAX_FILES) throw new UserError(`A product can deliver up to **${files.MAX_FILES} files** – use \`clear:True\` to start over.`);
  const downloaded = await files.download(uploads, kept.reduce((n, f) => n + (f.size || 0), 0));
  let nextText = current.text;
  if (deliveryText != null && String(deliveryText).trim()) {
    nextText = /^(none|-)$/i.test(String(deliveryText).trim()) ? null : String(deliveryText).trim().slice(0, TEXT_MAX);
  }
  // Files last – only once everything is valid.
  if (clear) files.remove(p.id);
  const saved = files.save(p.id, downloaded);
  p.delivery = { files: [...kept, ...saved], text: nextText, updatedAt: Date.now() };
  if (!hasDelivery(p)) p.delivery = null;
  db.save();
  shop().refreshShop(guild); // "⚡ Instant delivery" on the card
  return p;
}

/** "📄 key.txt (1.2 KB) · 📄 guide.pdf (300 KB) · 💬 text" – for replies and /product list. */
function deliverySummary(p) {
  if (!hasDelivery(p)) return 'nothing – delivered by hand';
  const size = (b) => (b >= 1024 * 1024 ? files.mb(b) : `${Math.max(1, Math.round(b / 1024))} KB`);
  return [...(p.delivery.files ?? []).map((f) => `📄 ${f.name} (${size(f.size)})`), p.delivery.text ? `💬 text (${p.delivery.text.length} characters)` : null].filter(Boolean).join(' · ');
}

// ───────────── Cards ─────────────

/** "📦 Your product is on the way" – auto: paid by PayPal / Stripe; otherwise after "Pay", while staff check it. */
function onTheWayCard(ticket, { auto }) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      auto
        ? `## 📦 Your product is on the way!\nPayment received for order \`#${pad(ticket.number)}\` – your product is being sent right now, here and in your DMs.`
        : `## 📦 Your product is on the way!\nWe're checking your payment for order \`#${pad(ticket.number)}\` – as soon as it's confirmed, your product is sent right here and in your DMs.`,
    ),
  );
  c.addTextDisplayComponents(text("-# Didn't get it after a few minutes? Write here or click **Call support**."));
  return v2(c);
}

const safeBlock = (s) => String(s).replace(/```/g, 'ʼʼʼ');

/** The product itself: its text and files. inDm – the copy sent by DM (with the server name). */
function productCard(guild, ticket, product, { inDm = false } = {}) {
  const order = tickets().orderDetails(ticket);
  const { files: attached, missing } = files.attachments(product);
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(
      `## 📦 Your product – ${truncate(order.product || product.name, 120)}\n` +
        `Order \`#${pad(ticket.number)}\`${inDm ? ` at **${truncate(guild.name, 80)}**` : ''} · thank you for your purchase! 💜`,
    ),
  );
  if (product.delivery?.text) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`\`\`\`\n${safeBlock(product.delivery.text)}\n\`\`\``));
  }
  for (const f of attached) c.addFileComponents(new FileBuilder().setURL(`attachment://${f.name}`));
  c.addTextDisplayComponents(
    text(`-# ${inDm ? 'Also in your ticket' : 'Also sent to your DMs'} · keep it safe – never share it with anyone. Something wrong? ${inDm ? 'Write in your ticket.' : 'Write here.'}`),
  );
  return { payload: v2(c, { files: attached }), missing };
}

// ───────────── Delivering ─────────────

const delivering = new Set(); // tickets being delivered right now – one at a time

/**
 * Sends the product into the ticket and by DM and records it. → { ok, dm, missing } – ok false when the
 * product has nothing to deliver. again – staff send it once more (also after it was delivered).
 */
async function deliver(channel, ticket, { by, auto = false, again = false } = {}) {
  const guild = channel.guild;
  const product = productFor(guild.id, ticket);
  if (!hasDelivery(product)) return { ok: false, reason: 'none' };
  if (delivering.has(channel.id)) return { ok: false, reason: 'busy' };
  if (!again && db.getTicket(channel.id)?.order?.delivered) return { ok: false, reason: 'done' };
  delivering.add(channel.id);
  try {
    const card = productCard(guild, ticket, product);
    if (!card.payload.files.length && !product.delivery.text) return { ok: false, reason: 'missing', missing: card.missing };
    const sent = await channel.send(card.payload);
    const user = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
    const dm = user ? await user.send(productCard(guild, ticket, product, { inDm: true }).payload).then(() => true).catch(() => false) : false;
    if (!dm) await channel.send(notice(COLORS.warning, `📭 <@${ticket.ownerId}> I couldn't DM you – your product is right above. Open your DMs for this server to get copies next time.`, { mentions: { users: [ticket.ownerId] } })).catch(() => null);
    const order = tickets().orderDetails(db.getTicket(channel.id));
    db.updateTicket(channel.id, { order: { ...order, delivered: { at: Date.now(), by: by?.id ?? null, dm, auto, messageId: sent?.id ?? null } } });
    const missing = card.missing;
    await sendLog(guild, {
      embeds: [
        logEmbed(missing.length ? COLORS.warning : COLORS.success, auto ? '📦 Product delivered automatically' : '📦 Product delivered', by?.user ?? by ?? guild.client.user).addFields(
          { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
          { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
          { name: 'Product', value: truncate(product.name, 1024), inline: true },
          { name: 'DM', value: dm ? 'sent' : "couldn't DM – it's in the ticket", inline: true },
          ...(missing.length ? [{ name: '⚠️ Missing files', value: truncate(`${missing.join(', ')} – set them again with /product delivery`, 1024) }] : []),
        ),
      ],
    }).catch(() => null);
    return { ok: true, dm, missing };
  } finally {
    delivering.delete(channel.id);
  }
}

/** The bot as the "staff member" of an automatic delivery. */
const botMember = (guild) => guild.members.me ?? guild.client.user;

/**
 * PayPal / Stripe confirmed the full payment of an open order (src/features/autopay.js) → "on the way", the product,
 * and the order is completed with the amount paid. Returns true when it delivered (false: delivered by hand).
 */
async function deliverPaid(channel, ticket, { amount }) {
  if (!deliverable(channel.guild.id, ticket) || ticket.order?.delivered || ticket.completedAt) return false;
  await channel.send(onTheWayCard(ticket, { auto: true })).catch(() => null);
  const bot = botMember(channel.guild);
  const done = await deliver(channel, db.getTicket(channel.id), { by: bot, auto: true });
  if (!done.ok) return false;
  await tickets()
    .completeOrder(channel, bot, { amount })
    .catch((err) => console.warn(`[delivery] Could not complete order ${ticket.channelId}:`, err.message));
  return true;
}

// ───────────── Staff: "Payment OK – deliver" / ⚙️ → Deliver product ─────────────

/**
 * Staff confirmed the payment: the order is set to Paid, the product is delivered and the order completed.
 * Without files or text only the status changes – the seller delivers by hand.
 */
async function confirmAndDeliver(channel, member, { again = false } = {}) {
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This only works in an order ticket.');
  if (!isStaff(member, config.getType('order'))) throw new UserError('Only the team can confirm payments and deliver products.');
  if (ticket.status !== 'open') throw new UserError('This ticket is closed – reopen it first.');
  const product = productFor(channel.guild.id, ticket);
  if (ticket.order?.delivered && !again) {
    throw new UserError(`The product was already delivered ${ts(ticket.order.delivered.at, 'R')}. Need to send it again? ⚙️ → **Send product again**.`);
  }
  if (!ticket.completedAt && ['awaiting', 'sent'].includes(statusOf(ticket))) await require('./orderstatus').setStatus(channel, 'paid', member);
  if (!hasDelivery(product)) {
    return `Payment confirmed – the order is **Paid**. ${product ? `**${product.name}** has no files or text to deliver` : 'This is a custom order'} – deliver it by hand, then ⚙️ → **Order completed**.`;
  }
  const done = await deliver(channel, db.getTicket(channel.id), { by: member, again });
  if (!done.ok) {
    if (done.reason === 'busy') throw new UserError('The product is being delivered right now.');
    if (done.reason === 'missing') throw new UserError(`The product's files are missing on the bot (${done.missing.join(', ')}) – set them again with \`/product delivery\`.`);
    throw new UserError('The product was already delivered.');
  }
  const latest = db.getTicket(channel.id);
  if (!latest.completedAt) {
    await tickets()
      .completeOrder(channel, member)
      .catch((err) => console.warn(`[delivery] Could not complete order ${channel.id}:`, err.message));
  }
  const note = done.missing.length ? ` ⚠️ Missing files: ${done.missing.join(', ')}.` : '';
  return `📦 Delivered **${product.name}** in the ticket${done.dm ? ' and by DM' : " (the customer's DMs are closed)"}${latest.completedAt ? '' : ' – the order is completed'}.${note}`;
}

/** The button on the "Payment sent" card (src/features/payments.js). */
async function confirmButton(interaction) {
  if (!isStaff(interaction.member, config.getType('order'))) throw new UserError('Only the team can confirm payments and deliver products.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await confirmAndDeliver(interaction.channel, interaction.member);
  return interaction.editReply({ content: result });
}

/** "✅ Payment OK – deliver" – or "✅ Payment OK" when the product is delivered by hand. */
const confirmButtonFor = (guildId, ticket) =>
  btn('deliver:confirm', deliverable(guildId, ticket) ? 'Payment OK – deliver' : 'Payment OK', '✅', ButtonStyle.Success);

hooks.route('deliver', { button: (interaction, action) => (action === 'confirm' ? confirmButton(interaction) : null) });

module.exports = {
  TEXT_MAX,
  hasDelivery,
  productFor,
  deliverable,
  setDelivery,
  deliverySummary,
  onTheWayCard,
  productCard,
  deliver,
  deliverPaid,
  confirmAndDeliver,
  confirmButtonFor,
};
