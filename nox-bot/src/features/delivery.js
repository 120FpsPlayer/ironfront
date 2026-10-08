'use strict';

/**
 * Product delivery – the files (and text, e.g. a key or a login) a buyer gets, set with /product delivery.
 *
 *   PayPal / Stripe: once the payment is confirmed (src/features/autopay.js) → "📦 Your product is on the way"
 *     → the product, in the ticket and by DM → the order is completed (sale, receipt, Customer role…)
 *   Other methods (PaysafeCard, crypto…): "Pay" → "📦 Your product is on the way" → staff check the payment
 *     and click "Payment OK – deliver" (or ⚙️ → Deliver product) → the product → the order is completed
 * Products without files or text are delivered by hand, like before.
 * A cart (order.items – src/features/cart.js) gets every item's files / text, one card per item; it is delivered
 * automatically only when every item has something to deliver (otherwise staff send what there is and deliver the
 * rest by hand). A balance top-up (order.topUp – src/features/balance.js) delivers no product: completing it
 * credits the balance.
 * A gift (order.giftTo – src/features/gifts.js) goes by DM to the member it's for instead of the buyer ("🎁 A gift
 * from @buyer"); the ticket gets every card as usual, and the buyer is told whether the DM reached them.
 *
 * product.delivery = { files: [{ name, size }], text, updatedAt } – the files are in data/deliveries/<productId>/
 * ticket.order.delivered = { at, by, dm, auto, giftTo } – dm: the DM reached the buyer (or the gift's recipient)
 */

const { ButtonStyle, FileBuilder, MessageFlags, escapeMarkdown } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const files = require('../lib/deliveryFiles');
const { statusOf } = require('../lib/orderStatus');
const { isStaff } = require('../lib/permissions');
const { COLORS } = require('../lib/theme');
const { UserError, logEmbed, money, pad, ts, truncate, sendLog } = require('../lib/utils');
const { isCart, lineText } = require('../lib/orderItems');
const { container, text, divider, btn, v2, notice } = require('../lib/v2');

const TEXT_MAX = 1500;

// Here – shop.js and tickets.js need this file.
const shop = () => require('./shop');
const tickets = () => require('../tickets/tickets');
const gifts = () => require('./gifts');

/** Does the product have something to deliver (files or text)? */
const hasDelivery = (product) => Boolean(product?.delivery?.files?.length || product?.delivery?.text);

/** The catalog product of an order ticket (null for custom orders and carts). */
const productFor = (guildId, ticket) => shop().ticketProduct(guildId, ticket);

/**
 * What the order is made of → [{ product, name }] – one entry per cart item (product null when it was deleted),
 * or the order's product (name undefined: the card shows the order's product).
 */
function orderParts(guildId, ticket) {
  if (!isCart(ticket?.order)) return [{ product: productFor(guildId, ticket) }];
  const catalog = shop().products(guildId);
  return ticket.order.items.map((item) => ({ product: catalog.find((p) => p.id === item.productId) ?? null, name: lineText(item) }));
}

/** The parts that have files or text to send. */
const sendable = (guildId, ticket) => orderParts(guildId, ticket).filter((x) => hasDelivery(x.product));

/**
 * Can this order be delivered automatically after the payment – the product (every item of a cart) has files or
 * text? A balance top-up too: "delivering" it completes it, which credits the balance.
 */
function deliverable(guildId, ticket) {
  if (ticket?.order?.topUp) return true;
  const parts = orderParts(guildId, ticket);
  return parts.length > 0 && parts.every((x) => hasDelivery(x.product));
}

/** Is there anything to send for ⚙️ → Deliver product (a part of a cart is enough – never for a top-up)? */
const canDeliver = (guildId, ticket) => !ticket?.order?.topUp && sendable(guildId, ticket).length > 0;

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
  if (ticket.order?.topUp) return topUpOnTheWay(ticket, { auto });
  const giftTo = gifts().recipientOf(ticket);
  const where = giftTo ? `here and to <@${giftTo}>'s DMs (it's a gift 🎁)` : 'here and in your DMs';
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      auto
        ? `## 📦 Your product is on the way!\nPayment received for order \`#${pad(ticket.number)}\` – your product is being sent right now, ${where}.`
        : `## 📦 Your product is on the way!\nWe're checking your payment for order \`#${pad(ticket.number)}\` – as soon as it's confirmed, your product is sent right ${where}.`,
    ),
  );
  c.addTextDisplayComponents(text("-# Didn't get it after a few minutes? Write here or click **Call support**."));
  return v2(c);
}

/** The same for a balance top-up: the amount is added to the balance once the payment is confirmed. */
function topUpOnTheWay(ticket, { auto }) {
  const amount = money(ticket.order.topUp.amount);
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      auto
        ? `## 💰 Topping up your balance\nPayment received for order \`#${pad(ticket.number)}\` – **${amount}** is being added to your store balance right now.`
        : `## 💰 Your top-up is on its way!\nWe're checking your payment for order \`#${pad(ticket.number)}\` – as soon as it's confirmed, **${amount}** is added to your store balance.`,
    ),
  );
  c.addTextDisplayComponents(text("-# Balance can't be refunded or paid out. Something wrong? Write here or click **Call support**."));
  return v2(c);
}

const safeBlock = (s) => String(s).replace(/```/g, 'ʼʼʼ');

/** The heading of the product card – a gift says who it's from (in the DM) or who it's for (in the ticket). */
function productHeading(guild, ticket, name, { inDm, giftTo, giftFrom }) {
  if (giftFrom) return `## 🎁 A gift from @${giftFrom} – ${name}\n**@${giftFrom}** bought this for you at **${truncate(guild.name, 80)}** · enjoy! 💜`;
  if (giftTo) return `## 🎁 Your gift – ${name}\nOrder \`#${pad(ticket.number)}\` · a gift for <@${giftTo}> – it goes to their DMs too. Thank you for your purchase! 💜`;
  return `## 📦 Your product – ${name}\nOrder \`#${pad(ticket.number)}\`${inDm ? ` at **${truncate(guild.name, 80)}**` : ''} · thank you for your purchase! 💜`;
}

/**
 * The product itself: its text and files. inDm – the copy sent by DM (with the server name); name – the cart item
 * it is for ("Nitro × 2"; default: the order's product). giftTo – the ticket copy of a gift; giftFrom – the
 * buyer's name on the DM copy a gift's recipient gets.
 */
function productCard(guild, ticket, product, { inDm = false, name = null, giftTo = null, giftFrom = null } = {}) {
  const order = tickets().orderDetails(ticket);
  const { files: attached, missing } = files.attachments(product);
  const c = container(COLORS.success);
  c.addTextDisplayComponents(text(productHeading(guild, ticket, truncate(name || order.product || product.name, 120), { inDm, giftTo, giftFrom })));
  if (product.delivery?.text) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`\`\`\`\n${safeBlock(product.delivery.text)}\n\`\`\``));
  }
  for (const f of attached) c.addFileComponents(new FileBuilder().setURL(`attachment://${f.name}`));
  const footer = giftFrom
    ? 'Keep it safe – never share it with anyone. Something wrong? Ask the friend who gave it to you.'
    : giftTo
      ? 'Keep it safe – never share it with anyone. Something wrong? Write here.'
      : `${inDm ? 'Also in your ticket' : 'Also sent to your DMs'} · keep it safe – never share it with anyone. Something wrong? ${inDm ? 'Write in your ticket.' : 'Write here.'}`;
  c.addTextDisplayComponents(text(`-# ${footer}`));
  return { payload: v2(c, { files: attached }), missing };
}

// ───────────── Delivering ─────────────

const delivering = new Set(); // tickets being delivered right now – one at a time

/** Is the product of this ticket being delivered right now? (A gift can't be changed then.) */
const isDelivering = (channelId) => delivering.has(channelId);

/** "Alex" – how the buyer is named on a gift's DM (no markdown, no mention: it's read outside the server). */
async function buyerName(guild, ticket) {
  const user = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  return escapeMarkdown(truncate(user?.globalName || user?.username || ticket.ownerName || 'a friend', 40));
}

/**
 * Sends the product – every item of a cart that has files or text, one card each – into the ticket and by DM and
 * records it. → { ok, dm, missing } – ok false when there is nothing to deliver, or when all files of an item are
 * gone (then nothing is sent). again – staff send it once more (also after it was delivered). A gift's DMs go to
 * its recipient (order.giftTo) – the buyer has the cards in the ticket and is told whether the DM got through.
 */
async function deliver(channel, ticket, { by, auto = false, again = false } = {}) {
  const guild = channel.guild;
  const parts = sendable(guild.id, ticket);
  if (!parts.length) return { ok: false, reason: 'none' };
  if (delivering.has(channel.id)) return { ok: false, reason: 'busy' };
  if (!again && db.getTicket(channel.id)?.order?.delivered) return { ok: false, reason: 'done' };
  delivering.add(channel.id);
  try {
    const giftTo = gifts().recipientOf(db.getTicket(channel.id) ?? ticket);
    const cards = parts.map((x) => ({ ...x, card: productCard(guild, ticket, x.product, { name: x.name, giftTo }) }));
    const empty = cards.filter((x) => !x.card.payload.files?.length && !x.product.delivery.text); // no files: payload.files is left out
    if (empty.length) return { ok: false, reason: 'missing', missing: empty.flatMap((x) => x.card.missing) };
    let sent = null;
    for (const x of cards) {
      const message = await channel.send(x.card.payload);
      sent ??= message;
    }
    const user = await guild.client.users.fetch(giftTo ?? ticket.ownerId).catch(() => null);
    const giftFrom = giftTo ? await buyerName(guild, ticket) : null;
    let dm = Boolean(user);
    for (const x of cards) {
      if (dm) dm = await user.send(productCard(guild, ticket, x.product, { inDm: true, name: x.name, giftFrom }).payload).then(() => true).catch(() => false);
    }
    const what = cards.length > 1 ? 'your products are' : 'your product is';
    if (giftTo) await channel.send(gifts().deliveredNotice(ticket, giftTo, dm, { many: cards.length > 1 })).catch(() => null);
    else if (!dm) await channel.send(notice(COLORS.warning, `📭 <@${ticket.ownerId}> I couldn't DM you – ${what} right above. Open your DMs for this server to get copies next time.`, { mentions: { users: [ticket.ownerId] } })).catch(() => null);
    const order = tickets().orderDetails(db.getTicket(channel.id));
    db.updateTicket(channel.id, { order: { ...order, delivered: { at: Date.now(), by: by?.id ?? null, dm, auto, messageId: sent?.id ?? null, ...(giftTo && { giftTo }) } } });
    const missing = cards.flatMap((x) => x.card.missing);
    await sendLog(guild, {
      embeds: [
        logEmbed(missing.length ? COLORS.warning : COLORS.success, auto ? '📦 Product delivered automatically' : '📦 Product delivered', by?.user ?? by ?? guild.client.user).addFields(
          { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
          { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
          { name: cards.length > 1 ? 'Products' : 'Product', value: truncate(cards.map((x) => x.name || x.product.name).join('\n'), 1024), inline: true },
          ...(giftTo ? [{ name: '🎁 Gift for', value: `<@${giftTo}>`, inline: true }] : []),
          { name: 'DM', value: dm ? (giftTo ? 'sent to the gift recipient' : 'sent') : giftTo ? "couldn't DM the recipient – the buyer has it in the ticket" : "couldn't DM – it's in the ticket", inline: true },
          ...(missing.length ? [{ name: '⚠️ Missing files', value: truncate(`${missing.join(', ')} – set them again with /product delivery`, 1024) }] : []),
        ),
      ],
    }).catch(() => null);
    return { ok: true, dm, missing, giftTo };
  } finally {
    delivering.delete(channel.id);
  }
}

/** The bot as the "staff member" of an automatic delivery. */
const botMember = (guild) => guild.members.me ?? guild.client.user;

/**
 * PayPal / Stripe confirmed the full payment of an open order (src/features/autopay.js) → "on the way", the product,
 * and the order is completed with the amount paid. Returns true when it delivered (false: delivered by hand).
 * A balance top-up has no product: it is completed right away, which credits the balance (features/balance.js).
 */
async function deliverPaid(channel, ticket, { amount }) {
  if (!deliverable(channel.guild.id, ticket) || ticket.order?.delivered || ticket.completedAt) return false;
  await channel.send(onTheWayCard(ticket, { auto: true })).catch(() => null);
  const bot = botMember(channel.guild);
  const done = ticket.order?.topUp ? { ok: true } : await deliver(channel, db.getTicket(channel.id), { by: bot, auto: true });
  if (!done.ok) return false;
  await tickets()
    .completeOrder(channel, bot, { amount })
    .catch((err) => console.warn(`[delivery] Could not complete order ${ticket.channelId}:`, err.message));
  return true;
}

// ───────────── Staff: "Payment OK – deliver" / ⚙️ → Deliver product ─────────────

/**
 * Staff confirmed the payment: the order is set to Paid, the product is delivered and the order completed.
 * Without files or text only the status changes – the seller delivers by hand. A cart sends what has files or
 * text; it is completed only when every item was sent (otherwise the seller delivers the rest and completes it).
 */
async function confirmAndDeliver(channel, member, { again = false } = {}) {
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This only works in an order ticket.');
  if (!isStaff(member, config.getType('order'))) throw new UserError('Only the team can confirm payments and deliver products.');
  if (ticket.status !== 'open') throw new UserError('This ticket is closed – reopen it first.');
  if (ticket.order?.topUp) return confirmTopUp(channel, ticket, member);
  const cart = isCart(ticket.order);
  const product = cart ? null : productFor(channel.guild.id, ticket);
  if (ticket.order?.delivered && !again) {
    throw new UserError(`The ${cart ? 'products were' : 'product was'} already delivered ${ts(ticket.order.delivered.at, 'R')}. Need to send ${cart ? 'them' : 'it'} again? ⚙️ → **Send product again**.`);
  }
  if (!ticket.completedAt && ['awaiting', 'sent'].includes(statusOf(ticket))) await require('./orderstatus').setStatus(channel, 'paid', member);
  const giftTo = gifts().recipientOf(db.getTicket(channel.id));
  const giftHint = giftTo ? ` 🎁 It's a gift – give it to <@${giftTo}>.` : '';
  if (cart && !canDeliver(channel.guild.id, ticket)) {
    return `Payment confirmed – the order is **Paid**. No product in this cart has files or text to deliver – deliver them by hand, then ⚙️ → **Order completed**.${giftHint}`;
  }
  if (!cart && !hasDelivery(product)) {
    return `Payment confirmed – the order is **Paid**. ${product ? `**${product.name}** has no files or text to deliver` : 'This is a custom order'} – deliver it by hand, then ⚙️ → **Order completed**.${giftHint}`;
  }
  const done = await deliver(channel, db.getTicket(channel.id), { by: member, again });
  if (!done.ok) {
    if (done.reason === 'busy') throw new UserError('The product is being delivered right now.');
    if (done.reason === 'missing') throw new UserError(`The product's files are missing on the bot (${done.missing.join(', ')}) – set them again with \`/product delivery\`.`);
    throw new UserError('The product was already delivered.');
  }
  const latest = db.getTicket(channel.id);
  // Cart items with nothing to send are delivered by hand – the seller completes the order after that.
  const byHand = cart ? orderParts(channel.guild.id, latest).filter((x) => !hasDelivery(x.product)).map((x) => x.name) : [];
  if (!latest.completedAt && !byHand.length) {
    await tickets()
      .completeOrder(channel, member)
      .catch((err) => console.warn(`[delivery] Could not complete order ${channel.id}:`, err.message));
  }
  const note = done.missing.length ? ` ⚠️ Missing files: ${done.missing.join(', ')}.` : '';
  const where = done.giftTo
    ? `in the ticket${done.dm ? ` and to the gift's recipient <@${done.giftTo}> by DM` : ` (couldn't DM the gift's recipient <@${done.giftTo}> – the buyer has it in the ticket)`}`
    : `in the ticket${done.dm ? ' and by DM' : " (the customer's DMs are closed)"}`;
  if (!cart) return `📦 Delivered **${product.name}** ${where}${latest.completedAt ? '' : ' – the order is completed'}.${note}`;
  const count = sendable(channel.guild.id, latest).length;
  const delivered = `📦 Delivered **${count} ${count === 1 ? 'product' : 'products'}** ${where}`;
  if (byHand.length) return `${delivered}. ⚠️ Deliver by hand: ${truncate(byHand.join(', '), 300)} – then ⚙️ → **Order completed**.${giftHint}${note}`;
  return `${delivered}${latest.completedAt ? '' : ' – the order is completed'}.${note}`;
}

/** Staff confirmed the payment of a balance top-up: Paid, then completed – which credits the balance once. */
async function confirmTopUp(channel, ticket, member) {
  if (ticket.completedAt) throw new UserError('This top-up is already completed – the balance was credited.');
  if (['awaiting', 'sent'].includes(statusOf(ticket))) await require('./orderstatus').setStatus(channel, 'paid', member);
  const result = await tickets().completeOrder(channel, member);
  const credited = db.getTicket(channel.id)?.order?.topUp?.credited ?? result.sale.amount;
  return `💰 Payment confirmed – **${money(credited)}** was added to <@${ticket.ownerId}>'s store balance and the top-up is completed.`;
}

/** The button on the "Payment sent" card (src/features/payments.js). */
async function confirmButton(interaction) {
  if (!isStaff(interaction.member, config.getType('order'))) throw new UserError('Only the team can confirm payments and deliver products.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await confirmAndDeliver(interaction.channel, interaction.member);
  return interaction.editReply({ content: result });
}

/** "✅ Payment OK – deliver" – "Payment OK – credit balance" for a top-up, "Payment OK" when it's delivered by hand. */
function confirmButtonFor(guildId, ticket) {
  if (ticket?.order?.topUp) return btn('deliver:confirm', 'Payment OK – credit balance', '✅', ButtonStyle.Success);
  return btn('deliver:confirm', canDeliver(guildId, ticket) ? 'Payment OK – deliver' : 'Payment OK', '✅', ButtonStyle.Success);
}

hooks.route('deliver', { button: (interaction, action) => (action === 'confirm' ? confirmButton(interaction) : null) });

module.exports = {
  TEXT_MAX,
  hasDelivery,
  productFor,
  orderParts,
  deliverable,
  canDeliver,
  setDelivery,
  deliverySummary,
  onTheWayCard,
  productCard,
  isDelivering,
  deliver,
  deliverPaid,
  confirmAndDeliver,
  confirmButtonFor,
};
