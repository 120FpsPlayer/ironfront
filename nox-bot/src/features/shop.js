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
const hooks = require('../lib/hooks');
const images = require('../lib/productImages');
const panels = require('../lib/panels');
const shopstatus = require('./shopstatus');
const { splitEmoji } = require('../builder/style');
const { e, ce, COLORS, FALLBACK } = require('../lib/theme');
const { UserError, embed, truncate, sendToChannel } = require('../lib/utils');
const { SPACER, container, text, divider, btn, linkBtn, row, section, header, buttonSection, v2, channelUrl } = require('../lib/v2');

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

// ───────────── Categories ─────────────

const MAX_CATEGORIES = 20; // + "Other products" – all fit in one select menu (25)

/** "  Game   keys " → "Game keys"; empty / "none" → null (no category). */
function cleanCategory(input) {
  const name = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (!name || /^(none|-)$/i.test(name)) return null;
  if (name.length > 30) throw new UserError('Category names can be up to 30 characters.');
  return name;
}

/** Categories in catalog order (the order products were added), optionally ignoring one product. */
function categories(guildId, exceptProductId = null) {
  const seen = new Map();
  for (const p of products(guildId)) {
    if (p.category && p.id !== exceptProductId && !seen.has(p.category.toLowerCase())) seen.set(p.category.toLowerCase(), p.category);
  }
  return [...seen.values()];
}

/** The category a product should get – reuses the spelling of an existing one ("games" → "Games"). */
function resolveCategory(guildId, input, productId = null) {
  const name = cleanCategory(input);
  if (!name) return null;
  const others = categories(guildId, productId);
  const existing = others.find((c) => c.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  if (others.length >= MAX_CATEGORIES) throw new UserError(`The shop can have up to ${MAX_CATEGORIES} categories – use one of the existing ones.`);
  return name;
}

/** Products grouped by category: [{ key, name, value, products }] – products without a category come last. */
function groups(list) {
  const map = new Map();
  for (const p of list) {
    const key = p.category ? p.category.toLowerCase() : '';
    if (!map.has(key)) map.set(key, { key, name: p.category || null, value: key ? `c:${key}` : 'none', products: [] });
    map.get(key).products.push(p);
  }
  const named = [...map.values()].filter((g) => g.key);
  return map.has('') ? [...named, map.get('')] : named;
}

let RGI = null;
try {
  RGI = new RegExp('^\\p{RGI_Emoji}$', 'v');
} catch {
  RGI = UNICODE_EMOJI; // Node < 20
}

/** "🎮 Games" → { emoji: '🎮', label: 'Games' }; "Games" → { emoji: null, label: 'Games' }. */
function categoryParts(group, titled = true) {
  if (!group.name) return { emoji: null, label: titled ? 'Other products' : 'Products' };
  const { emoji, label } = splitEmoji(group.name);
  return emoji && RGI.test(emoji) ? { emoji, label } : { emoji: null, label: group.name };
}

const groupTitle = (guild, group, titled = true) => {
  const { emoji, label } = categoryParts(group, titled);
  return `${emoji ?? e(guild, group.name ? 'folder' : 'box')} ${label}`;
};

/**
 * /product add | edit → category: existing ones first (Discord highlights the first suggestion, so Enter
 * reuses one instead of making a near-duplicate), then what is being typed as a new one.
 */
function categoryAutocomplete(interaction, typed) {
  const q = String(typed ?? '').replace(/\s+/g, ' ').trim().slice(0, 30);
  const list = categories(interaction.guild.id);
  const choices = list.filter((c) => !q || c.toLowerCase().includes(q.toLowerCase())).slice(0, 23).map((c) => ({ name: c, value: c }));
  if (q && !/^(none|-)$/i.test(q) && !list.some((c) => c.toLowerCase() === q.toLowerCase())) choices.push({ name: `➕ New category: ${q}`, value: q });
  if (interaction.options.getSubcommand(false) === 'edit') choices.push({ name: '🚫 No category', value: 'none' });
  return interaction.respond(choices.slice(0, 25));
}

function groupSummary(group) {
  const n = group.products.length;
  const out = group.products.filter((p) => p.stock === 'out').length;
  return `${n} ${n === 1 ? 'product' : 'products'}${out ? ` · ${out} sold out` : ''}`;
}

// ───────────── Product cards ─────────────

const CARD_LIMIT = 8; // more products → compact list with a menu
const UPLOAD_LIMIT = 8 * 1024 * 1024; // images per message (Discord allows 10 files and 10 MB)

function cardText(guild, p) {
  const stock = STOCK[p.stock] ?? STOCK.in;
  return `### ${productEmoji(guild, p)} ${p.name}${SPACER}**${formatPrice(p.price)}**\n${truncate(p.description, 220)}\n-# ${stock.dot} ${stock.label}`;
}

/** Buy – or 🔔 Notify me while it's sold out (features/restock.js). */
function cardButton(guild, p) {
  return p.stock === 'out'
    ? btn(`restock:notify:${p.id}`, 'Notify me', ce(guild, 'bell'))
    : btn(`shop:buy:${p.id}`, 'Buy', ce(guild, 'cart'), ButtonStyle.Primary);
}

/** A product card: the button on the right – or, with an image, the image on the right and the button below. */
function addCard(c, guild, p, image = null) {
  if (!image) return c.addSectionComponents(buttonSection(cardText(guild, p), cardButton(guild, p)));
  c.addSectionComponents(section(cardText(guild, p), image.url));
  return c.addActionRowComponents(row(cardButton(guild, p)));
}

/** One sold-out product with its Notify me button – the answer to a menu pick or an older Buy button. */
function soldOutView(guild, p) {
  const c = container(COLORS.brand);
  const picture = pickImages([p]).get(p.id);
  addCard(c, guild, p, picture);
  c.addTextDisplayComponents(text("-# Sold out right now – click **Notify me** and I'll DM you once it's back."));
  return v2(c, { files: picture ? [picture.file] : [] });
}

/** Images of these products that fit into one message (10 files, 8 MB) → Map(productId → attachment). */
function pickImages(list, max = 10) {
  const picked = new Map();
  let bytes = 0;
  for (const p of list) {
    if (picked.size >= max) break;
    const image = images.attachment(p);
    if (!image || bytes + image.size > UPLOAD_LIMIT) continue;
    bytes += image.size;
    picked.set(p.id, image);
  }
  return picked;
}

/** Components and text characters of a Components V2 payload – Discord allows 40 and 4000. */
function measure(payload) {
  let total = 0;
  let chars = 0;
  const walk = (c) => {
    const d = typeof c?.toJSON === 'function' ? c.toJSON() : c;
    if (!d?.type) return;
    total += 1;
    if (d.type === 10) chars += d.content.length;
    for (const x of d.components ?? []) walk(x);
    if (d.accessory) walk(d.accessory);
  };
  for (const c of payload.components ?? []) walk(c);
  return { total, chars };
}

const fits = (payload) => {
  const { total, chars } = measure(payload);
  return total <= 40 && chars <= 4000;
};

/** Cards grouped under category headers; returns the image files. */
function addCards(c, guild, list, pictures) {
  const gs = groups(list);
  const titled = gs.some((g) => g.name);
  gs.forEach((g, i) => {
    if (titled) {
      if (i > 0) c.addSeparatorComponents(divider());
      c.addTextDisplayComponents(text(`## ${groupTitle(guild, g)}`));
    }
    for (const p of g.products) addCard(c, guild, p, pictures.get(p.id));
  });
  return list.map((p) => pictures.get(p.id)?.file).filter(Boolean);
}

/** Many products: a short list per category and a menu – categories open an ephemeral list (features/catalog.js). */
function addList(c, guild, list) {
  const gs = groups(list);
  const titled = gs.some((g) => g.name);
  let budget = 2400;
  const lines = [];
  let shown = 0;
  for (const g of gs) {
    for (const [i, p] of g.products.entries()) {
      const stock = STOCK[p.stock] ?? STOCK.in;
      const head = titled && i === 0 ? `### ${groupTitle(guild, g)}${SPACER}·${SPACER}${g.products.length}\n` : '';
      const line = `${head}**${productEmoji(guild, p)} ${p.name}** — **${formatPrice(p.price)}** · ${stock.dot} ${stock.label}\n-# ${truncate(p.description, 90)}`;
      if (budget - line.length < 0) break;
      budget -= line.length;
      lines.push(line);
      shown += 1;
    }
  }
  const how = titled ? 'open a category below to buy (sold out? get a DM when it is back)' : 'pick a product below to order it';
  lines.push(shown < list.length ? `-# …and ${list.length - shown} more – ${how}.` : `-# ${how[0].toUpperCase()}${how.slice(1)}.`);
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addActionRowComponents(row(titled ? categoryMenu(guild, gs) : productMenu(guild, list)));
}

function categoryMenu(guild, gs) {
  return new StringSelectMenuBuilder()
    .setCustomId('catalog:browse')
    .setPlaceholder('📂 Browse a category…')
    .addOptions(
      gs.slice(0, 25).map((g) => {
        const { emoji, label } = categoryParts(g);
        return { label: truncate(label, 100), value: g.value, description: groupSummary(g), emoji: emoji ?? ce(guild, g.name ? 'folder' : 'box') };
      }),
    );
}

/** Buyable products open the order form, sold-out ones offer "Notify me". */
function productMenu(guild, list) {
  const options = list.slice(0, list.length > 25 ? 24 : 25).map((p) => ({
    label: truncate(p.name, 100),
    value: p.id,
    description: truncate(`${formatPrice(p.price)} · ${p.stock === 'out' ? 'Sold out – get a DM when it is back' : p.description}`, 100),
    emoji: ce(guild, p.stock === 'out' ? 'bell' : 'cart'),
  }));
  if (list.length > 25) options.push({ label: `All ${list.length} products…`, value: 'all', description: 'Browse the whole catalog page by page', emoji: ce(guild, 'search') });
  return new StringSelectMenuBuilder().setCustomId('catalog:pick').setPlaceholder('🛒 Choose a product…').addOptions(options);
}

// ───────────── Catalog panel ─────────────

function panelPayload(guild, list, { cards = false, pictures = new Map(), now } = {}) {
  const c = container(COLORS.brand);
  const status = shopstatus.statusLine(guild.id, 'shop', now);
  const intro =
    `# ${e(guild, 'cart')} ${config.brand.name} Shop\n${config.brand.tagline ?? ''}\n` +
    `-# ${list.length ? `${list.length} ${list.length === 1 ? 'product' : 'products'}` : 'Catalog coming soon'} · ` +
    `${e(guild, 'clock')} ${config.shop.deliveryTime ?? 'Fast delivery'}` +
    (status ? `\n${status}` : '');
  header(c, intro, guild.iconURL?.({ size: 256 }));
  c.addSeparatorComponents(divider(true));

  let files = [];
  if (!list.length) {
    c.addTextDisplayComponents(
      text(
        `### ${e(guild, 'box')} New products are on the way\n` +
          'Our catalog is being stocked right now. Want something already? ' +
          `Click **${purchaseType().label}** below to open a ticket – our team will help you directly.`,
      ),
    );
  } else if (cards) {
    files = addCards(c, guild, list, pictures);
  } else {
    addList(c, guild, list);
  }

  c.addSeparatorComponents(divider(true));
  const footer = [];
  const methods = config.shop.paymentMethods.map((m) => m.name);
  if (methods.length) footer.push(`${e(guild, 'card')} We accept: ${methods.join(' · ')}`);
  const vs = vouchStats(guild.id);
  if (vs.count) footer.push(`${e(guild, 'star')} Rated **${vs.avg.toFixed(1)}/5** from **${vs.count}** ${vs.count === 1 ? 'vouch' : 'vouches'}`);
  footer.push('🔒 We never ask for payment in DMs – only inside your ticket.');
  c.addTextDisplayComponents(text(footer.map((l) => `-# ${l}`).join('\n')));

  // "Purchase" takes buyers to #tickets, where they open a Purchase ticket for anything that isn't listed.
  const purchase = purchaseType();
  const tickets = db.channelId(guild.id, 'tickets');
  const buttons = [
    tickets
      ? linkBtn(channelUrl(guild.id, tickets), purchase.label, ce(guild, purchase.icon))
      : btn('ticket:open:order', purchase.label, ce(guild, purchase.icon), ButtonStyle.Secondary),
  ];
  const howTo = db.channelId(guild.id, 'howToBuy');
  const vouches = db.channelId(guild.id, 'vouches');
  if (howTo) buttons.push(linkBtn(channelUrl(guild.id, howTo), 'How to buy', ce(guild, 'info')));
  if (vouches) buttons.push(linkBtn(channelUrl(guild.id, vouches), 'Vouches', ce(guild, 'star')));
  c.addActionRowComponents(row(...buttons));
  return v2(c, { files });
}

/** The Purchase ticket type's name and emoji (config.json → ticketTypes "order"). */
function purchaseType() {
  const type = config.getType('order');
  return { label: truncate(type?.label || 'Purchase', 80), icon: type?.icon || 'cart' };
}

/**
 * Up to 8 products: cards with Buy buttons under category headers, with as many product images as
 * Discord's limits allow. More products: a compact list per category and a menu.
 */
function shopPanel(guild, { now } = {}) {
  const list = products(guild.id);
  if (list.length && list.length <= CARD_LIMIT) {
    for (let n = Math.min(list.length, 10); n >= 0; n -= 1) {
      const payload = panelPayload(guild, list, { cards: true, pictures: pickImages(list, n), now });
      if (fits(payload)) return payload;
    }
  }
  return panelPayload(guild, list, { now });
}

panels.register('shop', (guild) => shopPanel(guild));
const refreshShop = (guild) => panels.schedule(guild, 'shop');

// ───────────── Catalog management (/product) ─────────────

function assertUniqueName(guildId, name, productId = null) {
  if (products(guildId).some((p) => p.id !== productId && p.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new UserError('A product with this name already exists.');
  }
}

/** image: { buffer, ext } from productImages.download() */
function addProduct(guild, { name, price, description, emoji, stock = 'in', category = null, image = null }) {
  const list = products(guild.id);
  if (list.length >= 50) throw new UserError('The catalog is full (50 products). Remove an old product first.');
  assertUniqueName(guild.id, name);
  const product = {
    id: crypto.randomBytes(4).toString('hex'),
    name: truncate(name.trim(), 80),
    price: truncate(price.trim(), 40),
    description: truncate(description.trim(), 400),
    emoji: parseEmoji(emoji, guild),
    category: resolveCategory(guild.id, category),
    stock: STOCK[stock] ? stock : 'in',
    image: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  if (image) product.image = images.save(product.id, image);
  list.push(product);
  db.save();
  refreshShop(guild);
  return product;
}

/** Tells everyone waiting (features/restock.js) when a sold-out product can be bought again. */
async function afterStockChange(guild, product, wasOut) {
  const restocked = wasOut && product.stock !== 'out';
  if (restocked) await hooks.emit('productRestocked', { guild, product });
  return restocked;
}

/**
 * patch: { name, price, description, emoji, category ('none' removes it), image ({ buffer, ext }), removeImage, stock }
 * – missing / null fields stay as they are.
 */
async function editProduct(guild, query, patch) {
  const p = requireProduct(guild.id, query);
  const next = {};
  if (patch.name) {
    assertUniqueName(guild.id, patch.name, p.id);
    next.name = truncate(patch.name.trim(), 80);
  }
  if (patch.price) next.price = truncate(patch.price.trim(), 40);
  if (patch.description) next.description = truncate(patch.description.trim(), 400);
  if (patch.emoji != null) next.emoji = parseEmoji(patch.emoji, guild);
  if (patch.category != null) next.category = resolveCategory(guild.id, patch.category, p.id);
  if (patch.stock) {
    if (!STOCK[patch.stock]) throw new UserError('Unknown stock status.');
    next.stock = patch.stock;
  }
  // Files last – only once everything else is valid.
  if (patch.image) next.image = images.save(p.id, patch.image);
  else if (patch.removeImage) {
    images.remove(p.id);
    next.image = null;
  }
  const wasOut = p.stock === 'out';
  Object.assign(p, next, { updatedAt: Date.now() });
  db.save();
  refreshShop(guild);
  await afterStockChange(guild, p, wasOut);
  return p;
}

function removeProduct(guild, query) {
  const p = requireProduct(guild.id, query);
  const g = db.guild(guild.id);
  g.products = g.products.filter((x) => x.id !== p.id);
  delete g.notify[p.id];
  images.remove(p.id);
  db.save();
  refreshShop(guild);
  return p;
}

async function setStock(guild, query, stock) {
  const p = requireProduct(guild.id, query);
  if (!STOCK[stock]) throw new UserError('Unknown stock status.');
  const wasOut = p.stock === 'out';
  p.stock = stock;
  p.updatedAt = Date.now();
  db.save();
  refreshShop(guild);
  return { product: p, restocked: await afterStockChange(guild, p, wasOut) };
}

/** Posts "New product" / "Back in stock" in #restocks and pings the Restocks role. */
async function announceProduct(guild, p, kind = 'new') {
  const channelId = db.channelId(guild.id, 'restocks');
  if (!channelId) return null;
  const roleId = db.roleId(guild.id, 'pingRestocks');
  const image = images.attachment(p);
  const c = container(kind === 'new' ? COLORS.brand : COLORS.success);
  const title = kind === 'new' ? `${e(guild, 'sparkles')} New product` : `${e(guild, 'box')} Back in stock`;
  header(c, `## ${title}: ${productEmoji(guild, p)} ${p.name}\n${p.description}\n\n**Price:** ${formatPrice(p.price)}`, image?.url);
  c.addActionRowComponents(row(btn(`shop:buy:${p.id}`, 'Buy now', ce(guild, 'cart'), ButtonStyle.Primary)));
  if (roleId) c.addTextDisplayComponents(text(`-# 🔔 <@&${roleId}>`));
  return sendToChannel(guild, channelId, v2(c, { mentions: { roles: roleId ? [roleId] : [] }, files: image ? [image.file] : [] }));
}

/** The product an order ticket is about: ticket.order.productId, or the product answer ("GTA V — 20€" / "GTA V"). */
function ticketProduct(guildId, ticket) {
  if (!guildId || !ticket) return null;
  const id = ticket.order?.productId;
  if (id) return products(guildId).find((p) => p.id === id) ?? null;
  const values = (ticket.answers ?? []).filter((a) => /product|buy/i.test(a.label ?? '')).map((a) => String(a.value ?? '').trim().toLowerCase());
  // Names can contain " — " too: "Spotify — 12 months — 40€" is "Spotify — 12 months", not "Spotify" – the longest match wins.
  let best = null;
  for (const p of products(guildId)) {
    const name = p.name.toLowerCase();
    if (values.some((v) => v === name || v.startsWith(`${name} — `)) && name.length > (best?.name.length ?? 0)) best = p;
  }
  return best;
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
  const { promo, error } = promos.check(guildId, code, userId, {
    completedOrders: db.guild(guildId).orders[userId] ?? 0,
    openOrders: promos.openOrdersOf(guildId, userId),
    reserved: promos.reservedBy(guildId, code),
  });
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

/**
 * A closed order gave its promo code back. Reopening it takes the code again only if the member could
 * still use it now – otherwise the discount is dropped. Returns null when nothing changes, or
 * { code, error, order, answers } – the order and the form answers without the discount.
 * Call it right before the ticket is marked open again, with no await in between.
 */
function recheckOrderPromo(guildId, ticket) {
  const order = ticket.order;
  if (!order?.promo || ticket.completedAt) return null;
  const { error } = promos.check(guildId, order.promo, ticket.ownerId, {
    completedOrders: db.guild(guildId).orders[ticket.ownerId] ?? 0,
    openOrders: promos.openOrdersOf(guildId, ticket.ownerId, { except: ticket.channelId }),
    reserved: promos.reservedBy(guildId, order.promo, { except: ticket.channelId }),
  });
  if (!error) return null;
  const subtotal = order.subtotal ?? null;
  const price = { unitPrice: order.unitPrice ?? null, subtotal, total: subtotal, discount: 0, code: order.promo, promo: null, error };
  const answers = (ticket.answers ?? []).filter((a) => a.label !== 'Price' && a.label !== 'Promo code');
  return {
    code: order.promo,
    error,
    order: { ...order, promo: null, discount: 0, total: subtotal },
    answers: [...answers, ...priceAnswers(price, order.quantity ?? 1)],
  };
}

async function startOrder(interaction, productId) {
  const tickets = require('../tickets/tickets');
  const product = findProduct(interaction.guild.id, productId);
  if (!product) throw new UserError('This product is no longer available – the catalog has been updated.');
  // Sold out since the button was posted (#restocks, an open category list) – offer Notify me, not a dead end.
  if (product.stock === 'out') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(soldOutView(interaction.guild, product));
  }
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

  const order = {
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
  };

  // From here on this order holds its code (and counts as an open order of this member) – opening the
  // ticket takes several Discord calls, and a buyer submitting at the same time must not get the same use.
  const release = promos.hold(interaction.guild.id, interaction.user.id, order.promo);
  let channel;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // The order is part of the new ticket, so its first card already shows this product (and its image).
    channel = await tickets.openTicket(interaction.member, config.getType('order'), answers, { order });
  } finally {
    release(); // the saved ticket holds the code now (or opening the ticket failed)
  }
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
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'category') return categoryAutocomplete(interaction, focused.value);
  const q = String(focused.value ?? '').toLowerCase();
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
  productEmoji,
  MAX_CATEGORIES,
  categories,
  groups,
  groupTitle,
  groupSummary,
  categoryParts,
  cardText,
  cardButton,
  addCard,
  soldOutView,
  pickImages,
  measure,
  fits,
  ticketProduct,
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
  priceAnswers,
  recheckOrderPromo,
  startOrder,
  submitOrder,
  autocomplete,
  vouchStats,
};
