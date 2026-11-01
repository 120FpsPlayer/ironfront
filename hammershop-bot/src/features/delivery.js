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
const { UserError, logEmbed, money, pad, ts, truncate, sendLog, plural } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
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
  if (!p) throw new UserError('Nie ma takiego produktu. Wybierz produkt z podpowiedzi.');
  const current = clear ? { files: [], text: null } : { files: [...(p.delivery?.files ?? [])], text: p.delivery?.text ?? null };
  const uploads = attachments.filter(Boolean);
  const replaced = new Set(uploads.map((a) => files.cleanName(a.name)));
  const kept = current.files.filter((f) => !replaced.has(f.name));
  if (kept.length + uploads.length > files.MAX_FILES) throw new UserError(`Produkt może dostarczać maks. **${files.MAX_FILES} ${plural(files.MAX_FILES, 'plik', 'pliki', 'plików')}** – użyj \`wyczysc:True\`, żeby zacząć od nowa.`);
  const downloaded = await files.download(uploads, kept.reduce((n, f) => n + (f.size || 0), 0));
  let nextText = current.text;
  if (deliveryText != null && String(deliveryText).trim()) {
    nextText = /^(none|brak|-)$/i.test(String(deliveryText).trim()) ? null : String(deliveryText).trim().slice(0, TEXT_MAX);
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
  if (!hasDelivery(p)) return 'nic – dostawa ręczna';
  const size = (b) => (b >= 1024 * 1024 ? files.mb(b) : `${Math.max(1, Math.round(b / 1024))} KB`);
  return [...(p.delivery.files ?? []).map((f) => `📄 ${f.name} (${size(f.size)})`), p.delivery.text ? `💬 tekst (${p.delivery.text.length} ${plural(p.delivery.text.length, 'znak', 'znaki', 'znaków')})` : null].filter(Boolean).join(' · ');
}

// ───────────── Cards ─────────────

/** "📦 Your product is on the way" – auto: paid by PayPal / Stripe; otherwise after "Pay", while staff check it. */
function onTheWayCard(ticket, { auto }) {
  if (ticket.order?.topUp) return topUpOnTheWay(ticket, { auto });
  const giftTo = gifts().recipientOf(ticket);
  const where = giftTo ? `tutaj i do DM <@${giftTo}> (to prezent 🎁)` : 'tutaj i do Twoich DM';
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      auto
        ? `## 📦 Twój produkt jest w drodze!\nOtrzymaliśmy płatność za zamówienie \`#${pad(ticket.number)}\` – właśnie wysyłamy produkt ${where}.`
        : `## 📦 Twój produkt jest w drodze!\nSprawdzamy Twoją płatność za zamówienie \`#${pad(ticket.number)}\` – gdy tylko ją potwierdzimy, wyślemy produkt ${where}.`,
    ),
  );
  c.addTextDisplayComponents(text('-# Nic nie dotarło po kilku minutach? Napisz tutaj albo kliknij **Wezwij pomoc**.'));
  return v2(c);
}

/** The same for a balance top-up: the amount is added to the balance once the payment is confirmed. */
function topUpOnTheWay(ticket, { auto }) {
  const amount = money(ticket.order.topUp.amount);
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      auto
        ? `## 💰 Doładowujemy Twoje saldo\nOtrzymaliśmy płatność za zamówienie \`#${pad(ticket.number)}\` – właśnie dodajemy **${amount}** do Twojego salda sklepu.`
        : `## 💰 Twoje doładowanie jest w drodze!\nSprawdzamy Twoją płatność za zamówienie \`#${pad(ticket.number)}\` – gdy tylko ją potwierdzimy, dodamy **${amount}** do Twojego salda sklepu.`,
    ),
  );
  c.addTextDisplayComponents(text('-# Salda nie można zwrócić ani wypłacić. Coś nie tak? Napisz tutaj albo kliknij **Wezwij pomoc**.'));
  return v2(c);
}

const safeBlock = (s) => String(s).replace(/```/g, 'ʼʼʼ');

/** The heading of the product card – a gift says who it's from (in the DM) or who it's for (in the ticket). */
function productHeading(guild, ticket, name, { inDm, giftTo, giftFrom }) {
  if (giftFrom) return `## 🎁 Prezent od @${giftFrom} – ${name}\nKupiony dla Ciebie przez **@${giftFrom}** w **${truncate(guild.name, 80)}** · miłego korzystania! 🧡`;
  if (giftTo) return `## 🎁 Twój prezent – ${name}\nZamówienie \`#${pad(ticket.number)}\` · prezent dla <@${giftTo}> – trafia też do DM tej osoby. Dziękujemy za zakup! 🧡`;
  return `## 📦 Twój produkt – ${name}\nZamówienie \`#${pad(ticket.number)}\`${inDm ? ` w **${truncate(guild.name, 80)}**` : ''} · dziękujemy za zakup! 🧡`;
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
    ? 'Przechowuj go bezpiecznie – nigdy nikomu go nie udostępniaj. Coś nie tak? Zapytaj osobę, która dała Ci prezent.'
    : giftTo
      ? 'Przechowuj go bezpiecznie – nigdy nikomu go nie udostępniaj. Coś nie tak? Napisz tutaj.'
      : `${inDm ? 'Kopia jest też w Twoim tickecie' : 'Kopia trafiła też do Twoich DM'} · przechowuj go bezpiecznie – nigdy nikomu go nie udostępniaj. Coś nie tak? ${inDm ? 'Napisz w tickecie.' : 'Napisz tutaj.'}`;
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
  return escapeMarkdown(truncate(user?.globalName || user?.username || ticket.ownerName || 'znajomy', 40));
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
    const what = cards.length > 1 ? 'Twoje produkty są' : 'Twój produkt jest';
    if (giftTo) await channel.send(gifts().deliveredNotice(ticket, giftTo, dm, { many: cards.length > 1 })).catch(() => null);
    else if (!dm) await channel.send(notice(COLORS.warning, `📭 <@${ticket.ownerId}>, nie mogę wysłać Ci wiadomości prywatnej – ${what} tuż powyżej. Włącz DM dla tego serwera, żeby następnym razem dostać kopie.`, { mentions: { users: [ticket.ownerId] } })).catch(() => null);
    const order = tickets().orderDetails(db.getTicket(channel.id));
    db.updateTicket(channel.id, { order: { ...order, delivered: { at: Date.now(), by: by?.id ?? null, dm, auto, messageId: sent?.id ?? null, ...(giftTo && { giftTo }) } } });
    const missing = cards.flatMap((x) => x.card.missing);
    await sendLog(guild, {
      embeds: [
        logEmbed(missing.length ? COLORS.warning : COLORS.success, auto ? '📦 Produkt dostarczony automatycznie' : '📦 Produkt dostarczony', by?.user ?? by ?? guild.client.user).addFields(
          { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
          { name: 'Klient', value: `<@${ticket.ownerId}>`, inline: true },
          { name: cards.length > 1 ? 'Produkty' : 'Produkt', value: truncate(cards.map((x) => x.name || x.product.name).join('\n'), 1024), inline: true },
          ...(giftTo ? [{ name: '🎁 Prezent dla', value: `<@${giftTo}>`, inline: true }] : []),
          { name: 'DM', value: dm ? (giftTo ? 'wysłany do odbiorcy prezentu' : 'wysłany') : giftTo ? 'nie udało się wysłać do odbiorcy prezentu – kupujący ma go w tickecie' : 'nie udało się wysłać – jest w tickecie', inline: true },
          ...(missing.length ? [{ name: '⚠️ Brakujące pliki', value: truncate(`${missing.join(', ')} – dodaj je ponownie przez ${slash('product delivery')}`, 1024) }] : []),
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
    .catch((err) => console.warn(`[delivery] Nie udało się zrealizować zamówienia ${ticket.channelId}:`, err.message));
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
  if (!ticket || ticket.typeId !== 'order') throw new UserError('To działa tylko w tickecie zamówienia.');
  if (!isStaff(member, config.getType('order'))) throw new UserError('Tylko zespół może potwierdzać płatności i dostarczać produkty.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty – najpierw otwórz go ponownie.');
  if (ticket.order?.topUp) return confirmTopUp(channel, ticket, member);
  const cart = isCart(ticket.order);
  const product = cart ? null : productFor(channel.guild.id, ticket);
  if (ticket.order?.delivered && !again) {
    throw new UserError(`${cart ? 'Produkty zostały już dostarczone' : 'Produkt został już dostarczony'} ${ts(ticket.order.delivered.at, 'R')}. Chcesz wysłać ${cart ? 'je' : 'go'} ponownie? ⚙️ → **Wyślij produkt ponownie**.`);
  }
  if (!ticket.completedAt && ['awaiting', 'sent'].includes(statusOf(ticket))) await require('./orderstatus').setStatus(channel, 'paid', member);
  const giftTo = gifts().recipientOf(db.getTicket(channel.id));
  const giftHint = giftTo ? ` 🎁 To prezent – przekaż go <@${giftTo}>.` : '';
  if (cart && !canDeliver(channel.guild.id, ticket)) {
    return `Płatność potwierdzona – zamówienie ma status **Opłacone**. Żaden produkt w tym koszyku nie ma plików ani tekstu do dostarczenia – dostarcz je ręcznie, a potem ⚙️ → **Zamówienie zrealizowane**.${giftHint}`;
  }
  if (!cart && !hasDelivery(product)) {
    return `Płatność potwierdzona – zamówienie ma status **Opłacone**. ${product ? `**${product.name}** nie ma plików ani tekstu do dostarczenia` : 'To zamówienie indywidualne'} – dostarcz je ręcznie, a potem ⚙️ → **Zamówienie zrealizowane**.${giftHint}`;
  }
  const done = await deliver(channel, db.getTicket(channel.id), { by: member, again });
  if (!done.ok) {
    if (done.reason === 'busy') throw new UserError('Produkt jest właśnie dostarczany.');
    if (done.reason === 'missing') throw new UserError(`Bot nie ma już plików produktu (${done.missing.join(', ')}) – dodaj je ponownie przez \`${slash('product delivery')}\`.`);
    throw new UserError('Produkt został już dostarczony.');
  }
  const latest = db.getTicket(channel.id);
  // Cart items with nothing to send are delivered by hand – the seller completes the order after that.
  const byHand = cart ? orderParts(channel.guild.id, latest).filter((x) => !hasDelivery(x.product)).map((x) => x.name) : [];
  if (!latest.completedAt && !byHand.length) {
    await tickets()
      .completeOrder(channel, member)
      .catch((err) => console.warn(`[delivery] Nie udało się zrealizować zamówienia ${channel.id}:`, err.message));
  }
  const note = done.missing.length ? ` ⚠️ Brakujące pliki: ${done.missing.join(', ')}.` : '';
  const where = done.giftTo
    ? `w tickecie${done.dm ? ` i w DM do odbiorcy prezentu <@${done.giftTo}>` : ` (nie udało się wysłać DM do odbiorcy prezentu <@${done.giftTo}> – kupujący ma go w tickecie)`}`
    : `w tickecie${done.dm ? ' i w DM' : ' (klient ma zamknięte DM)'}`;
  if (!cart) return `📦 Dostarczono **${product.name}** ${where}${latest.completedAt ? '' : ' – zamówienie zrealizowane'}.${note}`;
  const count = sendable(channel.guild.id, latest).length;
  const delivered = `📦 Dostarczono **${count} ${plural(count, 'produkt', 'produkty', 'produktów')}** ${where}`;
  if (byHand.length) return `${delivered}. ⚠️ Dostarcz ręcznie: ${truncate(byHand.join(', '), 300)} – a potem ⚙️ → **Zamówienie zrealizowane**.${giftHint}${note}`;
  return `${delivered}${latest.completedAt ? '' : ' – zamówienie zrealizowane'}.${note}`;
}

/** Staff confirmed the payment of a balance top-up: Paid, then completed – which credits the balance once. */
async function confirmTopUp(channel, ticket, member) {
  if (ticket.completedAt) throw new UserError('To doładowanie jest już zrealizowane – środki są na saldzie.');
  if (['awaiting', 'sent'].includes(statusOf(ticket))) await require('./orderstatus').setStatus(channel, 'paid', member);
  const result = await tickets().completeOrder(channel, member);
  const credited = db.getTicket(channel.id)?.order?.topUp?.credited ?? result.sale.amount;
  return `💰 Płatność potwierdzona – **${money(credited)}** dodano do salda sklepu <@${ticket.ownerId}>, a doładowanie jest zrealizowane.`;
}

/** The button on the "Payment sent" card (src/features/payments.js). */
async function confirmButton(interaction) {
  if (!isStaff(interaction.member, config.getType('order'))) throw new UserError('Tylko zespół może potwierdzać płatności i dostarczać produkty.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await confirmAndDeliver(interaction.channel, interaction.member);
  return interaction.editReply({ content: result });
}

/** "✅ Payment OK – deliver" – "Payment OK – credit balance" for a top-up, "Payment OK" when it's delivered by hand. */
function confirmButtonFor(guildId, ticket) {
  if (ticket?.order?.topUp) return btn('deliver:confirm', 'Płatność OK – doładuj saldo', '✅', ButtonStyle.Success);
  return btn('deliver:confirm', canDeliver(guildId, ticket) ? 'Płatność OK – dostarcz' : 'Płatność OK', '✅', ButtonStyle.Success);
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
