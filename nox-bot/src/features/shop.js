'use strict';

const crypto = require('node:crypto');
const {
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const panels = require('../lib/panels');
const { e, ce, COLORS, FALLBACK } = require('../lib/theme');
const { UserError, embed, truncate, sendToChannel } = require('../lib/utils');
const { SPACER, container, text, divider, btn, linkBtn, row, header, buttonSection, v2, channelUrl } = require('../lib/v2');

const STOCK = {
  in: { label: 'In stock', dot: '🟢' },
  low: { label: 'Low stock – almost gone', dot: '🟠' },
  out: { label: 'Sold out', dot: '🔴' },
};

const products = (guildId) => db.guild(guildId).products;

/**
 * Prices are typed freely ("20", "19.99", "from 5€"). Plain numbers get the shop currency
 * from config.json (20 → 20€); anything else is shown exactly as typed.
 */
const PLAIN_NUMBER = /^(?:\d{1,3}(?:[ .,]\d{3})+|\d+)(?:[.,]\d{1,2})?$/;
function formatPrice(raw) {
  const price = String(raw ?? '').trim();
  const currency = config.shop.currency;
  if (!currency || !PLAIN_NUMBER.test(price)) return price;
  return config.shop.currencyPosition === 'before' ? `${currency}${price}` : `${price}${currency}`;
}

/** Unicode emoji (incl. ZWJ sequences) or a custom <:name:id> emoji. */
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{17,20}>$/;
const UNICODE_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)(?:️|‍|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator})*$/u;
function parseEmoji(input, guild = null) {
  const s = String(input ?? '').trim();
  if (!s) return null;
  if (UNICODE_EMOJI.test(s)) return s;
  if (CUSTOM_EMOJI.test(s)) {
    if (!customEmojiUsable(guild, s)) {
      throw new UserError('The bot cannot use that custom emoji – it is from a server the bot is not in. Use an emoji from this server or a normal emoji (e.g. 💎).');
    }
    return s;
  }
  throw new UserError('That emoji is not valid. Use a normal emoji (e.g. 💎) or a custom emoji from this server.');
}

/** A custom emoji only shows if it is in a server the bot is in and still available. */
function customEmojiUsable(guild, raw) {
  const cache = guild?.client?.emojis?.cache ?? guild?.emojis?.cache;
  if (!cache) return true;
  const emoji = cache.get(raw.match(/(\d{17,20})>$/)?.[1]);
  return Boolean(emoji) && emoji.available !== false;
}

function vouchStats(guildId) {
  const list = db.guild(guildId).vouches;
  const avg = list.length ? list.reduce((a, v) => a + v.rating, 0) / list.length : null;
  return { count: list.length, avg };
}

function findProduct(guildId, query) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return null;
  return products(guildId).find((p) => p.id === q) ?? products(guildId).find((p) => p.name.toLowerCase() === q) ?? null;
}

function requireProduct(guildId, query) {
  const p = findProduct(guildId, query);
  if (!p) throw new UserError('There is no such product. Pick one from the suggestions.');
  return p;
}

// A deleted custom product emoji would show as plain ":name:" text – use the default then.
const productEmoji = (guild, p) => (p.emoji && (!p.emoji.startsWith('<') || customEmojiUsable(guild, p.emoji)) ? p.emoji : e(guild, 'diamond'));

// ───────────── Catalog panel ─────────────

function shopPanel(guild) {
  const list = products(guild.id);
  const c = container(COLORS.brand);
  const intro =
    `# ${e(guild, 'cart')} ${config.brand.name} Shop\n${config.brand.tagline ?? ''}\n` +
    `-# ${list.length ? `${list.length} ${list.length === 1 ? 'product' : 'products'}` : 'Catalog coming soon'} · ` +
    `${e(guild, 'clock')} ${config.shop.deliveryTime ?? 'Fast delivery'}`;
  header(c, intro, guild.iconURL?.({ size: 256 }));
  c.addSeparatorComponents(divider(true));

  if (!list.length) {
    c.addTextDisplayComponents(
      text(
        `### ${e(guild, 'box')} New products are on the way\n` +
          'Our catalog is being stocked right now. Want something already? ' +
          'Click **Custom order** below and our team will help you directly.',
      ),
    );
  } else if (list.length <= 8) {
    for (const p of list) {
      const stock = STOCK[p.stock] ?? STOCK.in;
      const body = `### ${productEmoji(guild, p)} ${p.name}${SPACER}**${formatPrice(p.price)}**\n${truncate(p.description, 220)}\n-# ${stock.dot} ${stock.label}`;
      const buy = p.stock === 'out'
        ? btn(`shop:buy:${p.id}`, 'Sold out', ce(guild, 'x'), ButtonStyle.Secondary).setDisabled(true)
        : btn(`shop:buy:${p.id}`, 'Buy', ce(guild, 'cart'), ButtonStyle.Primary);
      c.addSectionComponents(buttonSection(body, buy));
    }
  } else {
    let budget = 2600;
    const lines = [];
    for (const p of list) {
      const stock = STOCK[p.stock] ?? STOCK.in;
      const line = `**${productEmoji(guild, p)} ${p.name}** — **${formatPrice(p.price)}** · ${stock.dot} ${stock.label}\n-# ${truncate(p.description, 90)}`;
      if (budget - line.length < 0) break;
      budget -= line.length;
      lines.push(line);
    }
    if (lines.length < list.length) lines.push(`-# …and ${list.length - lines.length} more – pick from the list below.`);
    c.addTextDisplayComponents(text(lines.join('\n')));
    const buyable = list.filter((p) => p.stock !== 'out').slice(0, 25);
    if (buyable.length) {
      c.addActionRowComponents(
        row(
          new StringSelectMenuBuilder()
            .setCustomId('shop:select')
            .setPlaceholder('🛒 Choose a product to buy…')
            .addOptions(buyable.map((p) => ({ label: truncate(p.name, 100), value: p.id, description: truncate(`${formatPrice(p.price)} · ${p.description}`, 100), emoji: ce(guild, 'cart') }))),
        ),
      );
    }
  }

  c.addSeparatorComponents(divider(true));
  const footer = [];
  const methods = config.shop.paymentMethods.map((m) => m.name);
  if (methods.length) footer.push(`${e(guild, 'card')} We accept: ${methods.join(' · ')}`);
  const vs = vouchStats(guild.id);
  if (vs.count) footer.push(`${e(guild, 'star')} Rated **${vs.avg.toFixed(1)}/5** from **${vs.count}** ${vs.count === 1 ? 'vouch' : 'vouches'}`);
  footer.push('🔒 We never ask for payment in DMs – only inside your ticket.');
  c.addTextDisplayComponents(text(footer.map((l) => `-# ${l}`).join('\n')));

  const buttons = [btn('ticket:open:order', 'Custom order', ce(guild, 'sparkles'), ButtonStyle.Secondary)];
  const howTo = db.channelId(guild.id, 'howToBuy');
  const vouches = db.channelId(guild.id, 'vouches');
  if (howTo) buttons.push(linkBtn(channelUrl(guild.id, howTo), 'How to buy', ce(guild, 'info')));
  if (vouches) buttons.push(linkBtn(channelUrl(guild.id, vouches), 'Vouches', ce(guild, 'star')));
  c.addActionRowComponents(row(...buttons));
  return v2(c);
}

panels.register('shop', (guild) => shopPanel(guild));
const refreshShop = (guild) => panels.schedule(guild, 'shop');

// ───────────── Catalog management (/product) ─────────────

function addProduct(guild, { name, price, description, emoji, stock = 'in' }) {
  const list = products(guild.id);
  if (list.length >= 50) throw new UserError('The catalog is full (50 products). Remove an old product first.');
  if (list.some((p) => p.name.toLowerCase() === name.trim().toLowerCase())) throw new UserError('A product with this name already exists.');
  const product = {
    id: crypto.randomBytes(4).toString('hex'),
    name: truncate(name.trim(), 80),
    price: truncate(price.trim(), 40),
    description: truncate(description.trim(), 400),
    emoji: parseEmoji(emoji, guild),
    stock: STOCK[stock] ? stock : 'in',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  list.push(product);
  db.save();
  refreshShop(guild);
  return product;
}

function editProduct(guild, query, patch) {
  const p = requireProduct(guild.id, query);
  if (patch.name) p.name = truncate(patch.name.trim(), 80);
  if (patch.price) p.price = truncate(patch.price.trim(), 40);
  if (patch.description) p.description = truncate(patch.description.trim(), 400);
  if (patch.emoji !== undefined && patch.emoji !== null) p.emoji = parseEmoji(patch.emoji, guild);
  p.updatedAt = Date.now();
  db.save();
  refreshShop(guild);
  return p;
}

function removeProduct(guild, query) {
  const p = requireProduct(guild.id, query);
  const g = db.guild(guild.id);
  g.products = g.products.filter((x) => x.id !== p.id);
  db.save();
  refreshShop(guild);
  return p;
}

function setStock(guild, query, stock) {
  const p = requireProduct(guild.id, query);
  if (!STOCK[stock]) throw new UserError('Unknown stock status.');
  const wasOut = p.stock === 'out';
  p.stock = stock;
  p.updatedAt = Date.now();
  db.save();
  refreshShop(guild);
  return { product: p, restocked: wasOut && stock !== 'out' };
}

/** Posts "New product" / "Back in stock" in #restocks and pings the Restocks role. */
async function announceProduct(guild, p, kind = 'new') {
  const channelId = db.channelId(guild.id, 'restocks');
  if (!channelId) return null;
  const roleId = db.roleId(guild.id, 'pingRestocks');
  const c = container(kind === 'new' ? COLORS.brand : COLORS.success);
  const title = kind === 'new' ? `${e(guild, 'sparkles')} New product` : `${e(guild, 'box')} Back in stock`;
  c.addTextDisplayComponents(text(`## ${title}: ${productEmoji(guild, p)} ${p.name}\n${p.description}\n\n**Price:** ${formatPrice(p.price)}`));
  c.addActionRowComponents(row(btn(`shop:buy:${p.id}`, 'Buy now', ce(guild, 'cart'), ButtonStyle.Primary)));
  if (roleId) c.addTextDisplayComponents(text(`-# 🔔 <@&${roleId}>`));
  return sendToChannel(guild, channelId, v2(c, { mentions: { roles: roleId ? [roleId] : [] } }));
}

// ───────────── Buying ─────────────

const promos = require('./promos');
const { parseAmount, money } = require('../lib/utils');

function orderModal(product, guild = null) {
  const modal = new ModalBuilder().setCustomId(`shop:order:${product.id}`).setTitle(truncate(`🛒 ${product.name}`, 45));
  modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${product.name}** — ${formatPrice(product.price)}\n-# ${truncate(product.description, 300)}`));
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Quantity')
      .setTextInputComponent(new TextInputBuilder().setCustomId('quantity').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue('1')),
  );
  const methods = config.shop.paymentMethods.slice(0, 25);
  if (methods.length) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Payment method')
        .setDescription('How would you like to pay? Details follow in your ticket.')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('payment')
            .setPlaceholder('Choose a payment method…')
            .addOptions(methods.map((m, i) => ({ label: truncate(m.name, 100), value: String(i), description: m.details ? truncate(m.details, 100) : undefined, emoji: guild ? ce(guild, m.emoji) : FALLBACK[m.emoji] ?? '💳' }))),
        ),
    );
  } else {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Payment method')
        .setTextInputComponent(new TextInputBuilder().setCustomId('payment_text').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60)),
    );
  }
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Anything else we should know?')
      .setTextInputComponent(new TextInputBuilder().setCustomId('notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
  );
  if (config.promos.enabled !== false) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Promo code')
        .setDescription('Optional – got a discount code? Enter it here.')
        .setTextInputComponent(new TextInputBuilder().setCustomId('promo').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(24).setPlaceholder('e.g. NOX10')),
    );
  }
  return modal;
}

/** "2" → 2; anything that isn't a whole number from 1 to 999 is refused. */
function parseQuantity(raw) {
  const s = String(raw ?? '').trim() || '1';
  const n = /^\d{1,6}$/.test(s) ? Number(s) : NaN;
  if (!(n >= 1 && n <= 999)) throw new UserError('The quantity must be a whole number from **1** to **999** (e.g. `1` or `3`).');
  return n;
}

/**
 * Price maths for an order: unit price × quantity, then the promo code.
 * An invalid code never blocks the order – it is reported as "not applied: <reason>".
 */
function priceOrder(guildId, userId, product, quantity, rawCode) {
  const round = (n) => Math.round(n * 100) / 100;
  const unitPrice = parseAmount(product.price);
  const subtotal = unitPrice == null ? null : round(unitPrice * quantity);
  const code = rawCode ? promos.normalize(rawCode) : null;
  if (!code) return { unitPrice, subtotal, total: subtotal, discount: 0, code: null, promo: null, error: null };
  const completedOrders = db.guild(guildId).orders[userId] ?? 0;
  const { promo, error } = promos.check(guildId, code, userId, { completedOrders, reserved: promos.reservedBy(guildId, code) });
  const { total, discount } = promos.apply(promo, subtotal);
  return { unitPrice, subtotal, total, discount, code, promo, error };
}

/** The "Price" answer shown in the ticket: subtotal, discount and total (when the price is a number) and the promo result. */
function priceAnswers(p, quantity) {
  let promoNote = null;
  if (p.error) promoNote = `${p.code} – not applied: ${p.error}`;
  else if (p.promo && p.subtotal == null) promoNote = `${p.code} – ${promos.label(p.promo)}, the seller applies it to the final price`;
  if (p.subtotal == null) return promoNote ? [{ label: 'Promo code', value: promoNote }] : [];
  const each = quantity > 1 ? ` (${quantity} × ${money(p.unitPrice)})` : '';
  const lines =
    p.discount > 0
      ? [`Subtotal: ${money(p.subtotal)}${each}`, `Discount (${p.code} · ${promos.label(p.promo)}): −${money(p.discount)}`, `**Total to pay: ${money(p.total)}**`]
      : [`**Total to pay: ${money(p.subtotal)}**${each}`];
  if (promoNote) lines.push(`Promo code ${promoNote}`);
  return [{ label: 'Price', value: lines.join('\n') }];
}

async function startOrder(interaction, productId) {
  const tickets = require('../tickets/tickets');
  const product = findProduct(interaction.guild.id, productId);
  if (!product) throw new UserError('This product is no longer available – the catalog has been updated.');
  if (product.stock === 'out') throw new UserError(`**${product.name}** is sold out right now. Grab the Restocks role in #roles to get pinged when it's back!`);
  const error = tickets.checkCanOpen(interaction.member);
  if (error) throw new UserError(error);
  return interaction.showModal(orderModal(product, interaction.guild));
}

async function submitOrder(interaction, productId) {
  const tickets = require('../tickets/tickets');
  const product = findProduct(interaction.guild.id, productId);
  if (!product) throw new UserError('This product is no longer available.');
  const field = (id) => {
    try {
      return interaction.fields.getTextInputValue(id)?.trim() ?? '';
    } catch {
      return '';
    }
  };
  const quantity = parseQuantity(field('quantity'));
  let payment = field('payment_text');
  let method = payment;
  let methodIndex = null;
  try {
    const [index] = interaction.fields.getStringSelectValues('payment');
    const m = config.shop.paymentMethods[Number(index)];
    if (m) {
      payment = m.details ? `${m.name} (${m.details})` : m.name;
      method = m.name;
      methodIndex = Number(index);
    }
  } catch {
    // text fallback already read
  }
  const price = priceOrder(interaction.guild.id, interaction.user.id, product, quantity, field('promo'));
  const answers = [
    { label: 'Product', value: `${product.name} — ${formatPrice(product.price)}` },
    { label: 'Quantity', value: String(quantity) },
    { label: 'Payment method', value: payment || '—' },
  ];
  const notes = field('notes');
  if (notes) answers.push({ label: 'Notes', value: notes });
  answers.push(...priceAnswers(price, quantity));

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await tickets.openTicket(interaction.member, config.getType('order'), answers);
  db.updateTicket(channel.id, {
    order: {
      productId: product.id,
      product: product.name,
      unitPrice: price.unitPrice,
      quantity,
      method: method || null,
      methodIndex,
      promo: price.promo ? price.code : null,
      discount: price.discount,
      subtotal: price.subtotal,
      total: price.total,
    },
  });
  const lines = [`Your private order ticket is ready: ${channel}`];
  if (price.total != null) lines.push(`${e(interaction.guild, 'card')} Total to pay: **${money(price.total)}**${price.discount > 0 ? ` (you save ${money(price.discount)} with **${price.code}**)` : ''}`);
  else if (price.promo) lines.push(`${e(interaction.guild, 'gift')} Promo code **${price.code}** (${promos.label(price.promo)}) – the seller applies it to the final price.`);
  if (price.error) lines.push(`${e(interaction.guild, 'warning')} Promo code **${price.code}** – not applied: ${price.error}`);
  lines.push('A seller will confirm the price and payment details there. **Never pay anyone in DMs.**');
  return interaction.editReply({
    embeds: [embed(COLORS.success).setTitle(truncate(`🛒 Order started – ${product.name}`, 256)).setDescription(lines.join('\n'))],
    components: [row(linkBtn(channel.url, 'Go to my order', '🎫'))],
  });
}

function autocomplete(interaction) {
  const q = interaction.options.getFocused().toLowerCase();
  return interaction.respond(
    products(interaction.guild.id)
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((p) => ({ name: truncate(`${p.name} · ${formatPrice(p.price)} · ${STOCK[p.stock]?.label ?? ''}`, 100), value: p.id })),
  );
}

module.exports = {
  STOCK,
  formatPrice,
  parseEmoji,
  products,
  findProduct,
  shopPanel,
  refreshShop,
  addProduct,
  editProduct,
  removeProduct,
  setStock,
  announceProduct,
  orderModal,
  parseQuantity,
  priceOrder,
  startOrder,
  submitOrder,
  autocomplete,
  vouchStats,
};
