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
const productBadges = require('./badges');
const shopstatus = require('./shopstatus');
const { splitEmoji } = require('../builder/style');
const { e, ce, COLORS, FALLBACK } = require('../lib/theme');
const { UserError, embed, truncate, sendToChannel, sendLog, logEmbed, parseAmount, money, ts, pad } = require('../lib/utils');
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
  // Node 18 has no 'v' flag: one emoji is one grapheme ("⭐⭐⭐" is three, and Discord rejects it as a button emoji)
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  RGI = { test: (s) => UNICODE_EMOJI.test(s) && [...graphemes.segment(s)].length === 1 };
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

// ───────────── Variants, stock counter, flash sales ─────────────

const round = (n) => Math.round(n * 100) / 100;

/** A product's options (e.g. 1 / 3 / 12 months) – products saved before variants existed have none. */
const variantsOf = (p) => (Array.isArray(p?.variants) ? p.variants : []);

/** The running flash sale (/sale start) or null. It counts only until endsAt – even before the timer clears it. */
function activeSale(p, now = Date.now()) {
  const sale = p?.sale;
  return sale && Number(sale.percent) > 0 && now < sale.endsAt ? sale : null;
}

/** 20 with −20% → 16. */
const salePrice = (amount, percent) => round((amount * (100 - percent)) / 100);

/** The cheapest option with a number as its price – null without variants or when no option price is a number. */
function cheapestVariant(p) {
  let best = null;
  for (const v of variantsOf(p)) {
    const amount = parseAmount(v.price);
    if (amount != null && (best == null || amount < best.amount)) best = { variant: v, amount };
  }
  return best?.variant ?? null;
}

/** "20€", or "from 5€" for a product with options (falls back to the product price when no option price is a number). */
function priceLabel(p) {
  const cheapest = cheapestVariant(p);
  return cheapest ? `from ${formatPrice(cheapest.price)}` : formatPrice(p.price);
}

/** The price as shown on a card: **20€** · from **5€** · ~~20€~~ **16€** · −20% during a flash sale. */
function priceMarkdown(p, now = Date.now()) {
  const cheapest = cheapestVariant(p);
  const raw = cheapest ? cheapest.price : p.price;
  const from = cheapest ? 'from ' : '';
  const sale = activeSale(p, now);
  const amount = parseAmount(raw);
  if (sale && amount != null) return `${from}~~${formatPrice(raw)}~~ **${money(salePrice(amount, sale.percent))}** · −${sale.percent}%`;
  return `${from}**${formatPrice(raw)}**`;
}

/** The price of an option v (or of the product itself: v = p) – reduced during a flash sale. */
function variantPrice(p, v, now = Date.now()) {
  const sale = activeSale(p, now);
  const amount = parseAmount(v.price);
  return sale && amount != null ? money(salePrice(amount, sale.percent)) : formatPrice(v.price);
}

const OPTIONS_LINE = 140; // characters of the "1 month 5€ · 3 months 12€" line on a card

/** "1 month 5€ · 3 months 12€ · 12 months 40€" – as many options as fit, then "+2 more". */
function optionsText(p, now = Date.now()) {
  const parts = variantsOf(p).map((v) => `${v.name} ${variantPrice(p, v, now)}`);
  if (parts.join(' · ').length <= OPTIONS_LINE) return parts.join(' · ');
  const shown = [];
  for (const part of parts) {
    if ([...shown, part].join(' · ').length > OPTIONS_LINE - 12) break; // room for " · +10 more"
    shown.push(part);
  }
  if (!shown.length) shown.push(truncate(parts[0], OPTIONS_LINE - 12));
  return `${shown.join(' · ')} · +${parts.length - shown.length} more`;
}

/** stockCount: a number when the stock is counted (completed orders count it down), null / missing otherwise. */
const counted = (p) => Number.isInteger(p?.stockCount) && p.stockCount >= 0;

/** The stock status a count means: 0 → sold out, up to config.shop.lowStockAt → low, more → in stock. */
function stockFor(count) {
  const low = Number(config.shop.lowStockAt ?? 3);
  if (count <= 0) return 'out';
  return count <= (Number.isFinite(low) ? low : 3) ? 'low' : 'in';
}

/** "🟢 In stock", or with a counter "🟢 In stock · 12 left" / "🟠 Only 2 left" / "🔴 Sold out". */
function stockText(p) {
  const stock = STOCK[p.stock] ?? STOCK.in;
  if (!counted(p) || p.stock === 'out') return `${stock.dot} ${stock.label}`;
  return p.stock === 'low' ? `${stock.dot} Only ${p.stockCount} left` : `${stock.dot} ${stock.label} · ${p.stockCount} left`;
}

// ───────────── Product cards ─────────────

const UPLOAD_LIMIT = 8 * 1024 * 1024; // images per message (Discord allows 10 files and 10 MB)
const CARD_TEXT = 640; // the description gives way above this, so 5 cards with options, a sale and badges still fit one message

/** badges: Map(productId → ['🔥 Bestseller', '⭐ 4.9']) from features/badges.js – worked out once per panel. */
function cardText(guild, p, { category = false, now = Date.now(), badges = null } = {}) {
  const where = category ? (p.category ? `📂 ${p.category}` : '📂 Other') : null;
  const sale = activeSale(p, now);
  const title = `### ${productEmoji(guild, p)} ${p.name}${SPACER}${priceMarkdown(p, now)}`;
  const extras = [
    variantsOf(p).length ? `-# ${optionsText(p, now)}` : null,
    `-# ${[stockText(p), ...(badges?.get(p.id) ?? []), where].filter(Boolean).join(' · ')}`,
    sale ? `-# ⏰ Sale ends ${ts(sale.endsAt, 'R')}` : null,
  ].filter(Boolean);
  const room = CARD_TEXT - title.length - extras.join('\n').length - 2;
  return [title, truncate(p.description, Math.max(60, Math.min(220, room))), ...extras].join('\n');
}

/** Buy – or 🔔 Notify me while it's sold out (features/restock.js). */
function cardButton(guild, p) {
  return p.stock === 'out'
    ? btn(`restock:notify:${p.id}`, 'Notify me', ce(guild, 'bell'))
    : btn(`shop:buy:${p.id}`, 'Buy', ce(guild, 'cart'), ButtonStyle.Primary);
}

/** A product card: the button on the right – or, with an image, the image on the right and the button below. */
function addCard(c, guild, p, image = null, opts = {}) {
  if (!image) return c.addSectionComponents(buttonSection(cardText(guild, p, opts), cardButton(guild, p)));
  c.addSectionComponents(section(cardText(guild, p, opts), image.url));
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

// ───────────── Catalog panel: tabs + pages ─────────────

const PAGE_SIZE = 5; // products per page
const TAB_BUTTONS = 5; // up to 5 tabs as buttons – more categories get a menu

/** The tabs: "All" plus one per category ("Other" for products without one) – none when there are no categories. */
function shopTabs(list) {
  const gs = groups(list);
  if (!gs.some((g) => g.name)) return [];
  return [{ value: 'all', all: true, name: null, products: gs.flatMap((g) => g.products) }, ...gs];
}

function tabLabel(guild, tab) {
  if (tab.all) return { label: 'All', emoji: ce(guild, 'cart') };
  const { emoji, label } = categoryParts(tab);
  return { label: tab.name ? label : 'Other', emoji: emoji ?? ce(guild, tab.name ? 'folder' : 'box') };
}

/** Tab buttons (the open one highlighted) – or a menu when there are more tabs than fit in one row. */
function tabsRow(guild, tabs, active) {
  if (tabs.length <= TAB_BUTTONS) {
    return row(
      ...tabs.map((t) => {
        const { label, emoji } = tabLabel(guild, t);
        return btn(`shopview:tab:${t.value}`, truncate(label, 40), emoji, t.value === active ? ButtonStyle.Primary : ButtonStyle.Secondary);
      }),
    );
  }
  return row(
    new StringSelectMenuBuilder()
      .setCustomId('shopview:tabs')
      .setPlaceholder('📂 Choose a category…')
      .addOptions(
        tabs.slice(0, 25).map((t) => {
          const { label, emoji } = tabLabel(guild, t);
          return { label: truncate(label, 100), value: t.value, description: groupSummary(t), emoji, default: t.value === active };
        }),
      ),
  );
}

/** Which products a tab shows, in the panel's order. */
function tabProducts(list, value) {
  if (!value || value === 'all') return groups(list).flatMap((g) => g.products);
  return groups(list).find((g) => g.value === value)?.products ?? null;
}

/** ◀ Page x/y · ▶ Next – or the How to buy / Vouches links – and My orders (features/myorders.js) in one row. */
function navRow(guild, value, index, pages) {
  const buttons = [];
  // The page number sits on ◀ (no separate page button), so 5 tabs + 5 products with images + My orders still fit 40 components.
  if (pages > 1) {
    buttons.push(
      btn(`shopview:page:${index - 1}:${value}`, `Page ${index + 1} / ${pages}`, '◀️').setDisabled(index <= 0),
      btn(`shopview:page:${index + 1}:${value}`, 'Next', '▶️').setDisabled(index >= pages - 1),
    );
  }
  // With page buttons the links move into the footer text, so the row never has more than 3 buttons.
  if (pages <= 1) {
    const howTo = db.channelId(guild.id, 'howToBuy');
    const vouches = db.channelId(guild.id, 'vouches');
    if (howTo) buttons.push(linkBtn(channelUrl(guild.id, howTo), 'How to buy', ce(guild, 'info')));
    if (vouches) buttons.push(linkBtn(channelUrl(guild.id, vouches), 'Vouches', ce(guild, 'star')));
  }
  buttons.push(btn('myorders:open', 'My orders', ce(guild, 'box')));
  return row(...buttons);
}

function buildView(guild, { list, tabs, active, items, index, pages, pictures, now, badges = null }) {
  const c = container(COLORS.brand);
  const status = shopstatus.statusLine(guild.id, 'shop', now);
  const vs = vouchStats(guild.id);
  const meta = [
    list.length ? `${list.length} ${list.length === 1 ? 'product' : 'products'}` : 'Catalog coming soon',
    `${e(guild, 'clock')} ${config.shop.deliveryTime ?? 'Fast delivery'}`,
    vs.count ? `${e(guild, 'star')} ${vs.avg.toFixed(1)}/5 from ${vs.count} ${vs.count === 1 ? 'vouch' : 'vouches'}` : null,
  ].filter(Boolean);
  c.addTextDisplayComponents(
    text(`# ${e(guild, 'cart')} ${config.brand.name} Shop\n${config.brand.tagline ?? ''}\n-# ${meta.join(' · ')}${status ? `\n${status}` : ''}`),
  );
  if (tabs.length) c.addActionRowComponents(tabsRow(guild, tabs, active));
  c.addSeparatorComponents(divider(true));

  if (!list.length) {
    c.addTextDisplayComponents(
      text(
        `### ${e(guild, 'box')} New products are on the way\n` +
          'Our catalog is being stocked right now – check back soon. ' +
          'Want a ping when they arrive? Grab the **Restocks** role.',
      ),
    );
  } else {
    const showCategory = active === 'all' && tabs.length > 0;
    const at = now ? new Date(now).getTime() : Date.now();
    for (const p of items) addCard(c, guild, p, pictures.get(p.id), { category: showCategory, now: at, badges });
  }

  c.addSeparatorComponents(divider(true));
  const methods = config.shop.paymentMethods.map((m) => m.name);
  const links = pages > 1 ? ['howToBuy', 'vouches'].map((k) => db.channelId(guild.id, k)).filter(Boolean).map((id) => `<#${id}>`) : [];
  c.addTextDisplayComponents(
    text(
      `-# ${methods.length ? `${e(guild, 'card')} We accept: ${methods.join(' · ')} · ` : ''}🔒 We never ask for payment in DMs – only inside your ticket.` +
        (links.length ? `\n-# ${links.join(' · ')}` : ''),
    ),
  );
  const nav = navRow(guild, active, index, pages);
  if (nav) c.addActionRowComponents(nav);
  return v2(c, { files: items.map((p) => pictures.get(p.id)?.file).filter(Boolean) });
}

/**
 * The shop: tabs per category on top, 5 products per page, ◀ ▶ to turn pages. The panel in #shop always
 * shows the first page of "All"; tabs and pages answer privately (features/catalog.js), so browsing never
 * changes the panel for anyone else. Images are dropped from the bottom up if a page wouldn't fit Discord's limits.
 */
function shopView(guild, { tab = 'all', page = 0, now } = {}) {
  const list = products(guild.id);
  const tabs = shopTabs(list);
  const active = tabs.some((t) => t.value === tab) ? tab : 'all';
  const all = tabProducts(list, active) ?? [];
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const index = Math.min(Math.max(0, Math.trunc(Number(page)) || 0), pages - 1);
  const items = all.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
  const marks = productBadges.compute(guild.id); // once per render, not per card
  for (let n = items.length; n >= 0; n -= 1) {
    const payload = buildView(guild, { list, tabs, active, items, index, pages, pictures: pickImages(items, n), now, badges: marks });
    if (fits(payload) || n === 0) return payload;
  }
  return null;
}

const shopPanel = (guild, { now } = {}) => shopView(guild, { now });

panels.register('shop', (guild) => shopPanel(guild));
const refreshShop = (guild) => panels.schedule(guild, 'shop');

// ───────────── Catalog management (/product) ─────────────

function assertUniqueName(guildId, name, productId = null) {
  if (products(guildId).some((p) => p.id !== productId && p.name.toLowerCase() === name.trim().toLowerCase())) {
    throw new UserError('A product with this name already exists.');
  }
}

const MAX_COUNT = 100_000;

/**
 * The stock fields for /product add | edit | stock: a count sets the status (0 → sold out, up to
 * config.shop.lowStockAt → low, more → in stock); a status alone turns the counter off. {} when neither is given.
 */
function stockPatch({ stock = null, count = null } = {}) {
  if (count != null) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) throw new UserError(`The count must be a whole number from 0 to ${MAX_COUNT.toLocaleString('en-US')}.`);
    return { stockCount: n, stock: stockFor(n) };
  }
  if (!stock) return {};
  if (!STOCK[stock]) throw new UserError('Unknown stock status.');
  return { stock, stockCount: null };
}

/** A price a flash sale can reduce: "20", "19.99", "20€" → the amount; text or another currency ("$20" in a € shop) → null. */
function saleAmount(raw) {
  const rest = String(raw ?? '').replace(config.shop.currency ?? '€', '');
  return /[€$£]/.test(rest) ? null : parseAmount(raw);
}

/** Why a product can't be on a flash sale – its price (or an option's price) is not a plain number in the shop currency – or null. */
function saleProblem(p) {
  const currency = config.shop.currency ?? '€';
  const why = (price, example) => (parseAmount(price) == null ? `is not a plain number (like ${example})` : `is in another currency than the shop's${currency ? ` (${currency})` : ''}`);
  const options = variantsOf(p);
  if (!options.length) return saleAmount(p.price) == null ? `its price "${truncate(p.price, 40)}" ${why(p.price, '`20` or `19.99`')}` : null;
  const bad = options.find((v) => saleAmount(v.price) == null);
  return bad ? `the price of the option **${truncate(bad.name, 50)}** ("${truncate(bad.price, 40)}") ${why(bad.price, '`5` or `4.99`')}` : null;
}

/** A change that would leave a product on sale with a price it can't reduce (see saleProblem) is refused. */
function assertSaleStillWorks(p, next) {
  if (!activeSale(p)) return;
  const problem = saleProblem({ ...p, ...next });
  if (problem) throw new UserError(`**${p.name}** is on a flash sale right now and ${problem}. Use a number, or stop the sale first with \`/sale stop\`.`);
}

/** image: { buffer, ext } from productImages.download(); stockCount: how many are left (null = not counted) */
function addProduct(guild, { name, price, description, emoji, stock = 'in', stockCount = null, category = null, image = null }) {
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
    ...stockPatch({ stock: STOCK[stock] ? stock : 'in', count: stockCount }),
    variants: [],
    sale: null,
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
 * patch: { name, price, description, emoji, category ('none' removes it), image ({ buffer, ext }), removeImage, stock,
 * stockCount } – missing / null fields stay as they are. A stockCount sets the stock status; a stock status alone
 * turns the counter off.
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
  Object.assign(next, stockPatch({ stock: patch.stock, count: patch.stockCount }));
  assertSaleStillWorks(p, next);
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

/** /product stock: a status, or a count (which sets the status) → { product, restocked, counterOff }. */
async function setStock(guild, query, stock, { count = null } = {}) {
  const p = requireProduct(guild.id, query);
  if (!stock && count == null) throw new UserError('Give a **status**, or a **count** of how many are left.');
  const next = stockPatch({ stock, count });
  const wasOut = p.stock === 'out';
  const wasCounted = counted(p);
  Object.assign(p, next, { updatedAt: Date.now() });
  db.save();
  refreshShop(guild);
  return { product: p, restocked: await afterStockChange(guild, p, wasOut), counterOff: wasCounted && !counted(p) };
}

/**
 * A completed order counts the stock down (counted products only). At 0 the product is sold out – the staff
 * log gets a short note, buyers see Notify me.
 */
async function countDown({ guild, sale }) {
  const p = sale ? productBadges.productOf(products(guild.id), sale) : null;
  if (!p || !counted(p)) return null;
  const before = p.stockCount;
  const left = Math.max(0, before - (Number(sale.quantity) || 1));
  Object.assign(p, { stockCount: left, stock: stockFor(left), updatedAt: Date.now() });
  db.save();
  refreshShop(guild);
  if (left === 0 && before > 0) {
    const order = sale.ticketNumber ? ` with order \`#${pad(sale.ticketNumber)}\`` : '';
    await sendLog(guild, {
      embeds: [logEmbed(COLORS.danger, '🔴 Sold out').setDescription(`**${p.name}** is sold out – the last one went${order}. Restock it with \`/product stock count:\`.`)],
    });
  }
  return left;
}
hooks.on('orderCompleted', countDown);

/** Every sale of a catalog product can move the 🔥 Bestseller badge – the panel is refreshed even when the stock isn't counted. */
function afterSale({ guild, sale }) {
  if (sale && productBadges.enabled() && productBadges.productOf(products(guild.id), sale)) refreshShop(guild);
}
hooks.on('orderCompleted', afterSale);

// ───────────── Variants (/product variants) ─────────────

const MAX_VARIANTS = 10;
const VARIANT_FORMAT = 'write the options as **name = price**, separated by commas – e.g. `1 month = 5, 3 months = 12, 12 months = 40`.';

/**
 * "1 month = 5, 3 months = 12; 12 months = 40" → [{ id, name, price }] – separated by , ; or new lines (a comma
 * between two digits is a decimal comma: "4,99"). "none" or nothing → [] (one price again). An option entered
 * again with the same name keeps its ID, so order forms that are open right now still find it.
 */
function parseVariants(input, existing = []) {
  const raw = String(input ?? '').trim();
  if (!raw || /^(none|-)$/i.test(raw)) return [];
  const out = [];
  for (const entry of raw.split(/\s*(?:[;\n]|,(?!\d)|(?<!\d),)\s*/).filter(Boolean)) {
    const at = entry.indexOf('=');
    const name = entry.slice(0, at).replace(/\s+/g, ' ').trim();
    const price = entry.slice(at + 1).trim();
    if (at === -1 || !name || !price || price.includes('=')) throw new UserError(`\`${truncate(entry, 60)}\` – ${VARIANT_FORMAT}`);
    if (name.length > 50) throw new UserError(`Option names can be up to 50 characters – **${truncate(name, 50)}** has ${name.length}.`);
    if (price.length > 40) throw new UserError(`Option prices can be up to 40 characters – the price of **${name}** has ${price.length}.`);
    if (out.some((v) => v.name.toLowerCase() === name.toLowerCase())) throw new UserError(`The option **${name}** is there twice – every option needs its own name.`);
    out.push({ name, price });
  }
  if (out.length > MAX_VARIANTS) throw new UserError(`A product can have up to ${MAX_VARIANTS} options – that's ${out.length}.`);
  const used = new Set();
  return out.map((v) => {
    let id = existing.find((x) => x.name.toLowerCase() === v.name.toLowerCase())?.id;
    while (!id || used.has(id)) id = crypto.randomBytes(3).toString('hex');
    used.add(id);
    return { id, name: v.name, price: v.price };
  });
}

/** /product variants – replaces the options of a product ("none" removes them). */
function setVariants(guild, query, input) {
  const p = requireProduct(guild.id, query);
  const variants = parseVariants(input, variantsOf(p));
  assertSaleStillWorks(p, { variants });
  Object.assign(p, { variants, updatedAt: Date.now() });
  db.save();
  refreshShop(guild);
  return p;
}

/** Posts "New product" / "Back in stock" in #restocks and pings the Restocks role. */
async function announceProduct(guild, p, kind = 'new') {
  const channelId = db.channelId(guild.id, 'restocks');
  if (!channelId) return null;
  const roleId = db.roleId(guild.id, 'pingRestocks');
  const image = images.attachment(p);
  const c = container(kind === 'new' ? COLORS.brand : COLORS.success);
  const title = kind === 'new' ? `${e(guild, 'sparkles')} New product` : `${e(guild, 'box')} Back in stock`;
  const options = variantsOf(p).length ? `\n-# ${optionsText(p)}` : '';
  header(c, `## ${title}: ${productEmoji(guild, p)} ${p.name}\n${p.description}\n\n**Price:** ${activeSale(p) ? priceMarkdown(p) : priceLabel(p)}${options}`, image?.url);
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

/** "16€ (was 20€ · −20% flash sale)" – an option's price in the order form menu. */
function optionPrice(product, v, now = Date.now()) {
  const sale = activeSale(product, now);
  const reduced = variantPrice(product, v, now);
  return sale && parseAmount(v.price) != null ? `${reduced} (was ${formatPrice(v.price)} · −${sale.percent}% flash sale)` : reduced;
}

/** The required "Option" menu of the order form: every option with its price (reduced during a flash sale). */
function variantField(product) {
  const field = new LabelBuilder().setLabel('Option').setStringSelectMenuComponent(
    new StringSelectMenuBuilder()
      .setCustomId('variant')
      .setPlaceholder('Choose an option…')
      .setRequired(true)
      .addOptions(variantsOf(product).slice(0, 25).map((v) => ({ label: truncate(v.name, 100), value: v.id, description: truncate(optionPrice(product, v), 100) }))),
  );
  if (product.description) field.setDescription(truncate(product.description, 100));
  return field;
}

function orderModal(product, guild = null) {
  const modal = new ModalBuilder().setCustomId(`shop:order:${product.id}`).setTitle(truncate(`🛒 ${product.name}`, 45));
  // A form holds 5 components: with options, the Option menu takes the place of the intro (its descriptions show the prices).
  if (variantsOf(product).length) modal.addLabelComponents(variantField(product));
  else {
    const price = activeSale(product) ? priceMarkdown(product) : formatPrice(product.price);
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${product.name}** — ${price}\n-# ${truncate(product.description, 300)}`));
  }
  const quantity = new LabelBuilder()
    .setLabel('Quantity')
    .setTextInputComponent(new TextInputBuilder().setCustomId('quantity').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue('1'));
  if (counted(product)) quantity.setDescription(`${product.stockCount} left`);
  modal.addLabelComponents(quantity);
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
 * Price maths for an order: the unit price (the chosen option's price, a flash sale taken off) × quantity, then
 * the promo code. An invalid code never blocks the order – it is reported as "not applied: <reason>".
 * listPrice – the unit price before the sale; salePercent – the sale's percent (null without one).
 */
function priceOrder(guildId, userId, product, quantity, rawCode, { variant = null, now = Date.now() } = {}) {
  const listPrice = parseAmount(variant ? variant.price : product.price);
  const sale = listPrice == null ? null : activeSale(product, now);
  const unitPrice = sale ? salePrice(listPrice, sale.percent) : listPrice;
  const salePercent = sale ? Number(sale.percent) : null;
  const subtotal = unitPrice == null ? null : round(unitPrice * quantity);
  const code = rawCode ? promos.normalize(rawCode) : null;
  if (!code) return { unitPrice, listPrice, salePercent, subtotal, total: subtotal, discount: 0, code: null, promo: null, error: null };
  const { promo, error } = promos.check(guildId, code, userId, {
    completedOrders: db.guild(guildId).orders[userId] ?? 0,
    openOrders: promos.openOrdersOf(guildId, userId),
    reserved: promos.reservedBy(guildId, code),
  });
  const { total, discount } = promos.apply(promo, subtotal);
  return { unitPrice, listPrice, salePercent, subtotal, total, discount, code, promo, error };
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
  if (p.salePercent) {
    const was = p.listPrice != null ? `: ${money(p.listPrice)} → ${money(p.unitPrice)}${quantity > 1 ? ' each' : ''}` : '';
    lines.unshift(`⚡ Flash sale −${p.salePercent}%${was}`);
  }
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
  // Paid (or being checked) at the discounted total – the code stays, like completeOrder keeps it for orders placed in time.
  if (['sent', 'paid', 'progress'].includes(order.status)) return null;
  const { error } = promos.check(guildId, order.promo, ticket.ownerId, {
    completedOrders: db.guild(guildId).orders[ticket.ownerId] ?? 0,
    openOrders: promos.openOrdersOf(guildId, ticket.ownerId, { except: ticket.channelId }),
    reserved: promos.reservedBy(guildId, order.promo, { except: ticket.channelId }),
  });
  if (!error) return null;
  const subtotal = order.subtotal ?? null;
  const price = { unitPrice: order.unitPrice ?? null, listPrice: order.listPrice ?? null, salePercent: order.salePercent ?? null, subtotal, total: subtotal, discount: 0, code: order.promo, promo: null, error };
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

/** The option picked in the order form (null for products without options) – a UserError when the options changed meanwhile. */
function chosenVariant(interaction, product) {
  let id = null;
  try {
    [id] = interaction.fields.getStringSelectValues('variant');
  } catch {
    // a form without the Option menu
  }
  const options = variantsOf(product);
  if (!id && !options.length) return null;
  const variant = options.find((v) => v.id === id);
  if (!variant) throw new UserError(`The options of **${product.name}** have changed since you opened the form – click **Buy** again to see the current ones.`);
  return variant;
}

async function submitOrder(interaction, productId) {
  const tickets = require('../tickets/tickets');
  const product = findProduct(interaction.guild.id, productId);
  if (!product) throw new UserError('This product is no longer available.');
  // Sold out while the form was open – offer Notify me instead of an order ticket.
  if (product.stock === 'out') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return interaction.editReply(soldOutView(interaction.guild, product));
  }
  const field = (id) => {
    try {
      return interaction.fields.getTextInputValue(id)?.trim() ?? '';
    } catch {
      return '';
    }
  };
  const variant = chosenVariant(interaction, product);
  const quantity = parseQuantity(field('quantity'));
  if (counted(product) && quantity > product.stockCount) {
    throw new UserError(`Only **${product.stockCount}** left – lower the quantity to ${product.stockCount} or less.`);
  }
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
  const price = priceOrder(interaction.guild.id, interaction.user.id, product, quantity, field('promo'), { variant });
  const name = variant ? `${product.name} — ${variant.name}` : product.name;
  const answers = [
    { label: 'Product', value: `${name} — ${formatPrice(variant ? variant.price : product.price)}` },
    { label: 'Quantity', value: String(quantity) },
    { label: 'Payment method', value: payment || '—' },
  ];
  const notes = field('notes');
  if (notes) answers.push({ label: 'Notes', value: notes });
  answers.push(...priceAnswers(price, quantity));

  const order = {
    productId: product.id,
    product: name,
    ...(variant && { variant: variant.name }),
    unitPrice: price.unitPrice,
    quantity,
    method: method || null,
    methodIndex,
    promo: price.promo ? price.code : null,
    discount: price.discount,
    subtotal: price.subtotal,
    total: price.total,
    ...(price.salePercent && { salePercent: price.salePercent, listPrice: price.listPrice }), // listPrice: the unit price before the sale
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
  if (price.total != null) {
    const savings = [price.salePercent && `⚡ −${price.salePercent}% flash sale`, price.discount > 0 && `you save ${money(price.discount)} with **${price.code}**`].filter(Boolean);
    lines.push(`${e(interaction.guild, 'card')} Total to pay: **${money(price.total)}**${savings.length ? ` (${savings.join(' · ')})` : ''}`);
  } else if (price.promo) lines.push(`${e(interaction.guild, 'gift')} Promo code **${price.code}** (${promos.label(price.promo)}) – the seller applies it to the final price.`);
  if (price.error) lines.push(`${e(interaction.guild, 'warning')} Promo code **${price.code}** – not applied: ${price.error}`);
  lines.push('A seller will confirm the price and payment details there. **Never pay anyone in DMs.**');
  const answer = await interaction.editReply({
    embeds: [embed(COLORS.success).setTitle(truncate(`🛒 Order started – ${name}`, 256)).setDescription(lines.join('\n'))],
    components: [row(linkBtn(channel.url, 'Go to my order', '🎫'))],
  });
  // After the answer – e.g. the Stripe payment link (features/stripe.js) takes a call to Stripe.
  await hooks.emit('orderPlaced', { guild: interaction.guild, channel, ticket: db.getTicket(channel.id), member: interaction.member });
  return answer;
}

/** Product suggestions for /product and /sale – filter: only some products (e.g. the ones on sale for /sale stop). */
function autocomplete(interaction, { filter = null } = {}) {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'category') return categoryAutocomplete(interaction, focused.value);
  const q = String(focused.value ?? '').toLowerCase();
  const label = (p) => {
    const sale = activeSale(p);
    const stock = counted(p) && p.stock !== 'out' ? `${p.stockCount} left` : STOCK[p.stock]?.label ?? '';
    return `${p.name} · ${priceLabel(p)}${sale ? ` · −${sale.percent}% sale` : ''} · ${stock}`;
  };
  return interaction.respond(
    products(interaction.guild.id)
      .filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!filter || filter(p)))
      .slice(0, 25)
      .map((p) => ({ name: truncate(label(p), 100), value: p.id })),
  );
}

module.exports = {
  STOCK,
  formatPrice,
  variantsOf,
  activeSale,
  salePrice,
  cheapestVariant,
  priceLabel,
  priceMarkdown,
  variantPrice,
  optionsText,
  counted,
  stockFor,
  stockText,
  saleProblem,
  parseEmoji,
  products,
  findProduct,
  requireProduct,
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
  PAGE_SIZE,
  shopTabs,
  tabProducts,
  shopView,
  shopPanel,
  refreshShop,
  addProduct,
  editProduct,
  removeProduct,
  setStock,
  countDown,
  MAX_VARIANTS,
  parseVariants,
  setVariants,
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
