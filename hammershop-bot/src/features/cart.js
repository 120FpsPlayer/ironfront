'use strict';

/**
 * The cart – several products in one order (config.cart: { enabled, maxItems }).
 *
 *   g.carts[userId] = { items: [{ productId, variantId, quantity, name }], updatedAt }   (name: for notes only)
 *
 *   Add to cart   ➕ on the product cards (when they fit the panel – src/features/shop.js), or "➕ Add a product…"
 *                 in the cart → option + quantity → into the cart. The same product and option again adds up.
 *                 At most config.cart.maxItems different products; counted stock is respected.
 *   🛒 Cart       in the shop's bottom row and in My orders – privately: the items with their prices (options,
 *                 flash sales), the total, remove an item, clear, checkout. Sold-out or deleted products are
 *                 dropped with a note.
 *   Checkout      payment method (or "Store balance" – src/features/balance.js) + promo code + notes → ONE order
 *                 ticket with order.items; product = "Netflix — 3 months × 1, Nitro × 2", productId null,
 *                 total = the items at their (sale) prices, then the promo code once. The cart empties when the
 *                 ticket is open. Delivery, stock, badges, receipts and the sales report handle every item.
 *
 * Components:
 *   cart:open                     🛒 Cart – the cart as a new private message
 *   cart:add:<productId>          ➕ Add to cart on a product card → option + quantity form
 *   cart:pick                     "➕ Add a product…" menu in the cart → the same form
 *   cart:addform:<productId>:<o>  the form (o: c = from the cart, updated in place · s = from the shop)
 *   cart:remove                   "Remove an item…" menu (value: productId:variantId)
 *   cart:clear · cart:checkout    buttons in the cart
 *   cart:submit:<cents>           the checkout form (cents: the total it showed – a changed price is refused)
 */

const { ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, StringSelectMenuBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const shop = require('./shop');
const promos = require('./promos');
const balance = require('./balance');
const { cartTitle } = require('../lib/orderItems');
const { e, ce, COLORS } = require('../lib/theme');
const { UserError, money, parseAmount, truncate, count: countPl, plural: pluralPl } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, v2, subtext } = require('../lib/v2');

const MAX_QUANTITY = 999;
const ADD_MENU = 25; // products in the "Add a product" menu (Discord allows 25 options)

const round = (n) => Math.round(n * 100) / 100;
/** "3 sztuki" – the units in a cart. */
const unitsText = (n) => countPl(n, 'sztuka', 'sztuki', 'sztuk');
/** "10 różnych produktów" – how many different products a cart holds. */
const productsText = (n) => `${n} ${pluralPl(n, 'produkt', 'różne produkty', 'różnych produktów')}`;
const enabled = () => config.cart?.enabled !== false;
const isPrivate = (interaction) => Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));

/** config.cart.maxItems – how many different products (and options) a cart holds (default 10, at most 25). */
function maxItems() {
  const n = Math.trunc(Number(config.cart?.maxItems));
  return n >= 1 ? Math.min(n, 25) : 10;
}

const carts = (guildId) => db.guild(guildId).carts;
const keyOf = (item) => `${item.productId}:${item.variantId ?? ''}`;

/** How many things are in a member's cart (units, as stored – for the "Cart (3)" button). */
const count = (guildId, userId) => (carts(guildId)[userId]?.items ?? []).reduce((n, i) => n + (Number(i.quantity) || 0), 0);

// ───────────── Prices ─────────────

/** One line's price: the option's (or product's) price, a running flash sale taken off, × quantity. */
function linePrice(product, variant, quantity, now = Date.now()) {
  const listPrice = parseAmount(variant ? variant.price : product.price);
  const sale = listPrice == null ? null : shop.activeSale(product, now);
  const unitPrice = sale ? shop.salePrice(listPrice, sale.percent) : listPrice;
  return { listPrice, unitPrice, salePercent: sale ? Number(sale.percent) : null, total: unitPrice == null ? null : round(unitPrice * quantity) };
}

/**
 * The cart as it is now: lines with their products and prices, and what was dropped (sold out, deleted, its
 * options changed) – dropped lines are removed from the stored cart. A line over the counted stock gets a
 * `problem` (checkout is refused until it's fixed). → { lines, dropped, units, subtotal, known }
 * subtotal is null when a price isn't a number (the seller confirms it); known – the sum of the numbers.
 */
function resolve(guildId, userId, { now = Date.now() } = {}) {
  const stored = carts(guildId)[userId];
  const lines = [];
  const dropped = [];
  for (const item of stored?.items ?? []) {
    const product = shop.products(guildId).find((p) => p.id === item.productId) ?? null;
    const options = product ? shop.variantsOf(product) : [];
    const variant = item.variantId ? options.find((v) => v.id === item.variantId) ?? null : null;
    let why = null;
    if (!product) why = 'nie ma go już w sklepie';
    else if (product.stock === 'out') why = 'wyprzedany';
    else if (item.variantId ? !variant : options.length > 0) why = 'zmieniły się jego warianty – dodaj go ponownie';
    if (why) {
      dropped.push(`${truncate(item.name || product?.name || 'produkt', 60)} (${why})`);
      continue;
    }
    const quantity = Math.max(1, Math.min(MAX_QUANTITY, Math.trunc(Number(item.quantity)) || 1));
    const name = variant ? `${product.name} — ${variant.name}` : product.name;
    lines.push({ key: keyOf(item), product, variant, quantity, name, rawPrice: variant ? variant.price : product.price, ...linePrice(product, variant, quantity, now) });
  }
  if (dropped.length && stored) {
    const keep = new Set(lines.map((l) => l.key));
    stored.items = stored.items.filter((i) => keep.has(keyOf(i)));
    stored.updatedAt = now;
    db.save();
  }
  // Counted stock: all lines of one product together.
  const units = new Map();
  for (const l of lines) units.set(l.product.id, (units.get(l.product.id) ?? 0) + l.quantity);
  for (const l of lines) {
    if (shop.counted(l.product) && units.get(l.product.id) > l.product.stockCount) l.problem = `zostało tylko ${l.product.stockCount}`;
  }
  const known = round(lines.reduce((n, l) => n + (l.total ?? 0), 0));
  const subtotal = lines.length && lines.every((l) => l.total != null) ? known : null;
  return { lines, dropped, units: lines.reduce((n, l) => n + l.quantity, 0), subtotal, known };
}

/** The promo code on the cart's total – once, like the order form (src/features/shop.js priceOrder). */
function priceCart(guildId, userId, subtotal, rawCode) {
  const code = rawCode ? promos.normalize(rawCode) : null;
  if (!code) return { subtotal, total: subtotal, discount: 0, code: null, promo: null, error: null };
  const { promo, error } = promos.check(guildId, code, userId, {
    completedOrders: db.guild(guildId).orders[userId] ?? 0,
    openOrders: promos.openOrdersOf(guildId, userId),
    reserved: promos.reservedBy(guildId, code),
  });
  const { total, discount } = promos.apply(promo, subtotal);
  return { subtotal, total, discount, code, promo, error };
}

// ───────────── Changing the cart ─────────────

/** Puts a product (and option) into the cart – or adds to the quantity already there. → the stored item. */
function addItem(guildId, userId, product, variant, quantity, now = Date.now()) {
  if (product.stock === 'out') throw new UserError(`**${product.name}** jest teraz wyprzedany – kliknij **Powiadom mnie** na karcie produktu, a damy Ci znać, gdy wróci.`);
  const all = carts(guildId);
  const cart = all[userId] ?? { items: [], updatedAt: now };
  cart.items ??= [];
  const key = keyOf({ productId: product.id, variantId: variant?.id ?? null });
  const existing = cart.items.find((i) => keyOf(i) === key);
  if (!existing && cart.items.length >= maxItems()) {
    throw new UserError(`Twój koszyk jest pełny – mieści maksymalnie ${productsText(maxItems())}. Najpierw złóż zamówienie albo coś usuń.`);
  }
  const next = (Number(existing?.quantity) || 0) + quantity;
  if (next > MAX_QUANTITY) throw new UserError(`Łącznie byłoby ${next} – jeden produkt może być w koszyku maksymalnie **${MAX_QUANTITY}** razy.`);
  if (shop.counted(product)) {
    const others = cart.items.filter((i) => i.productId === product.id && keyOf(i) !== key).reduce((n, i) => n + (Number(i.quantity) || 0), 0);
    if (others + next > product.stockCount) {
      const already = others + (Number(existing?.quantity) || 0);
      throw new UserError(`Zostało tylko **${product.stockCount}** szt. **${product.name}**${already ? ` – ${already} szt. masz już w koszyku` : ''}. Zmniejsz ilość.`);
    }
  }
  const name = variant ? `${product.name} — ${variant.name}` : product.name;
  if (existing) Object.assign(existing, { quantity: next, name });
  else cart.items.push({ productId: product.id, variantId: variant?.id ?? null, quantity, name });
  cart.updatedAt = now;
  all[userId] = cart;
  db.save();
  return existing ?? cart.items[cart.items.length - 1];
}

function removeItem(guildId, userId, key) {
  const cart = carts(guildId)[userId];
  if (!cart?.items) return false;
  const before = cart.items.length;
  cart.items = cart.items.filter((i) => keyOf(i) !== key);
  cart.updatedAt = Date.now();
  db.save();
  return before !== cart.items.length;
}

function clear(guildId, userId) {
  delete carts(guildId)[userId];
  db.save();
}

/** After checkout: takes the ordered lines out (anything added meanwhile stays). */
function removeOrdered(guildId, userId, lines) {
  const cart = carts(guildId)[userId];
  if (!cart) return;
  for (const l of lines) {
    const item = cart.items.find((i) => keyOf(i) === l.key);
    if (item) item.quantity = (Number(item.quantity) || 0) - l.quantity;
  }
  cart.items = cart.items.filter((i) => i.quantity > 0);
  if (!cart.items.length) delete carts(guildId)[userId];
  else cart.updatedAt = Date.now();
  db.save();
}

// ───────────── The cart view ─────────────

/** "**1.** 💎 **Netflix — 3 miesiące** × 2 · ~~5€~~ 4€ za sztukę · **8€**" */
function lineMarkdown(guild, l, i, nameMax = 90) {
  const each = l.quantity > 1 && l.unitPrice != null ? ` · ${l.salePercent ? `~~${money(l.listPrice)}~~ ` : ''}${money(l.unitPrice)} za sztukę` : '';
  const one = l.quantity === 1 && l.salePercent ? ` · ~~${money(l.listPrice)}~~` : '';
  const price = l.total != null ? `**${money(l.total)}**` : truncate(shop.formatPrice(l.rawPrice), 40);
  const sale = l.salePercent ? ` ⚡ −${l.salePercent}%` : '';
  const problem = l.problem ? ` · ⚠️ ${l.problem}` : '';
  return `**${i + 1}.** ${shop.productEmoji(guild, l.product)} **${truncate(l.name, nameMax)}** × ${l.quantity}${each}${one} · ${price}${sale}${problem}`;
}

const LINES_TEXT = 2600; // the item list – with the total and the notes a cart stays under Discord's 4000 characters

/** The item list – the names get shorter when a long cart wouldn't fit. */
function linesText(guild, lines) {
  let block = '';
  for (const max of [90, 50, 30, 16]) {
    block = lines.map((l, i) => lineMarkdown(guild, l, i, max)).join('\n');
    if (block.length <= LINES_TEXT) break;
  }
  return truncate(block, LINES_TEXT);
}

function totalText(cart) {
  if (cart.subtotal != null) return `### Razem: ${money(cart.subtotal)}\n-# Kod rabatowy wpiszesz przy składaniu zamówienia – obejmuje cały koszyk.`;
  if (cart.known > 0) return `### Razem: ${money(cart.known)} + ceny, które potwierdzi sprzedawca\n-# Niektóre ceny nie są stałe – ostateczną kwotę sprzedawca poda w Twoim tickecie.`;
  return '### Razem: kwotę potwierdzi sprzedawca\n-# Te ceny nie są stałe – ostateczną kwotę sprzedawca poda w Twoim tickecie.';
}

/** The "➕ Add a product…" menu – products that can be bought, in catalog order. */
function addMenu(guildId) {
  const list = shop.products(guildId).filter((p) => p.stock !== 'out').slice(0, ADD_MENU);
  if (!list.length) return null;
  return new StringSelectMenuBuilder()
    .setCustomId('cart:pick')
    .setPlaceholder('➕ Dodaj produkt…')
    .addOptions(
      list.map((p) => {
        const sale = shop.activeSale(p);
        return { label: truncate(p.name, 100), value: p.id, description: truncate(`${shop.priceLabel(p)}${sale ? ` · promocja −${sale.percent}%` : ''}${shop.variantsOf(p).length ? ' · wybierz wariant' : ''}`, 100) };
      }),
    );
}

function removeMenu(lines) {
  return new StringSelectMenuBuilder()
    .setCustomId('cart:remove')
    .setPlaceholder('✖️ Usuń pozycję…')
    .addOptions(lines.slice(0, 25).map((l, i) => ({ label: truncate(`${i + 1}. ${l.name} × ${l.quantity}`, 100), value: l.key, description: truncate(l.total != null ? money(l.total) : shop.formatPrice(l.rawPrice), 100), emoji: '✖️' })));
}

/** The private cart of one member. note – shown on top (e.g. "✅ Added …"). */
function cartView(guild, userId, { note = null, now = Date.now() } = {}) {
  const cart = resolve(guild.id, userId, { now });
  const c = container(COLORS.brand);
  const head = `## ${e(guild, 'cart')} Twój koszyk`;
  if (!cart.lines.length) {
    c.addTextDisplayComponents(text(`${head}\nTwój koszyk jest pusty. Kliknij **Do koszyka** przy produkcie w sklepie – albo wybierz go poniżej – i zamów wszystko w jednym zamówieniu.`));
  } else {
    c.addTextDisplayComponents(text(`${head}\n-# ${unitsText(cart.units)} · widzisz to tylko Ty\n${linesText(guild, cart.lines)}`));
  }
  if (note) c.addTextDisplayComponents(text(truncate(note, 300)));
  if (cart.lines.length) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(totalText(cart)));
  }
  const notes = [];
  if (cart.dropped.length) notes.push(`⚠️ Usunięto z koszyka: ${cart.dropped.join(', ')}`);
  if (cart.lines.length >= maxItems()) notes.push(`Twój koszyk jest pełny (${productsText(maxItems())}) – złóż zamówienie albo coś usuń, żeby dodać więcej.`);
  if (balance.enabled() && balance.get(guild.id, userId) > 0) notes.push(`💰 Saldo sklepu: **${money(balance.get(guild.id, userId))}** – wybierz **${balance.METHOD}** przy składaniu zamówienia, żeby nim zapłacić.`);
  if (notes.length) c.addTextDisplayComponents(text(truncate(notes.map((n) => `-# ${n}`).join('\n'), 900)));
  const menu = cart.lines.length < maxItems() ? addMenu(guild.id) : null;
  if (menu) c.addActionRowComponents(row(menu));
  if (cart.lines.length) c.addActionRowComponents(row(removeMenu(cart.lines)));
  const buttons = [
    btn('cart:checkout', 'Zamów', ce(guild, 'card'), ButtonStyle.Success).setDisabled(!cart.lines.length),
    btn('cart:clear', 'Wyczyść koszyk', '🗑️', ButtonStyle.Danger).setDisabled(!cart.lines.length),
  ];
  const wallet = balance.balanceButton(guild, userId);
  if (wallet) buttons.push(wallet);
  c.addActionRowComponents(row(...buttons));
  return v2(c);
}

/** 🛒 Cart (n) – the button in the shop's bottom row and in My orders (null when the cart is off). */
function cartButton(guild, userId = null) {
  if (!enabled()) return null;
  const n = userId ? count(guild.id, userId) : 0;
  return btn('cart:open', n > 0 ? `Koszyk (${n})` : 'Koszyk', ce(guild, 'cart'));
}

/** [🛒 Cart (n)] [💰 Balance: 30€] – the buttons for My orders (none when both are off). */
const shortcuts = (guild, userId) => [cartButton(guild, userId), balance.balanceButton(guild, userId)].filter(Boolean);

/** In place when it's the private cart message, otherwise a new private message. */
async function show(interaction, { inPlace = true, note = null } = {}) {
  if (inPlace && isPrivate(interaction)) await interaction.deferUpdate();
  else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return interaction.editReply(cartView(interaction.guild, interaction.user.id, { note }));
}

function requireEnabled() {
  if (!enabled()) throw new UserError('Koszyk jest wyłączony – kliknij **Kup** przy produkcie, żeby go zamówić.');
}

// ───────────── Adding ─────────────

/** Option (when the product has options) + quantity. origin: c = from the cart, s = from the shop. */
function addModal(product, origin = 's') {
  const modal = new ModalBuilder().setCustomId(`cart:addform:${product.id}:${origin}`).setTitle(truncate(`➕ ${product.name}`, 45));
  if (shop.variantsOf(product).length) modal.addLabelComponents(shop.variantField(product));
  else {
    const price = shop.activeSale(product) ? shop.priceMarkdown(product) : shop.formatPrice(product.price);
    modal.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${product.name}** — ${price}\n${subtext(truncate(product.description || 'Trafi do Twojego koszyka – zamów wszystko w jednym zamówieniu.', 300))}`));
  }
  const quantity = new LabelBuilder()
    .setLabel('Ilość')
    .setTextInputComponent(new TextInputBuilder().setCustomId('quantity').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue('1'));
  if (shop.counted(product)) quantity.setDescription(`Zostało: ${product.stockCount}`);
  return modal.addLabelComponents(quantity);
}

async function openAdd(interaction, productId, origin) {
  requireEnabled();
  const product = shop.findProduct(interaction.guild.id, productId);
  if (!product) throw new UserError('Ten produkt nie jest już dostępny – katalog został zaktualizowany.');
  if (product.stock === 'out') throw new UserError(`**${product.name}** jest teraz wyprzedany.`);
  return interaction.showModal(addModal(product, origin === 'c' ? 'c' : 's'));
}

function field(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id)?.trim() ?? '';
  } catch {
    return '';
  }
}

async function submitAdd(interaction, productId, origin) {
  requireEnabled();
  const product = shop.findProduct(interaction.guild.id, productId);
  if (!product) throw new UserError('Ten produkt nie jest już dostępny.');
  const variant = shop.chosenVariant(interaction, product);
  const quantity = shop.parseQuantity(field(interaction, 'quantity'));
  addItem(interaction.guild.id, interaction.user.id, product, variant, quantity);
  const name = variant ? `${product.name} — ${variant.name}` : product.name;
  return show(interaction, { inPlace: origin === 'c', note: `✅ Dodano **${truncate(name, 100)}** × ${quantity} do koszyka.` });
}

// ───────────── Checkout ─────────────

const cents = (amount) => (amount == null ? 'x' : String(Math.round(amount * 100)));

/** "Saldo sklepu (dostępne 30€)" joins the methods when it covers the whole cart. */
function paymentField(guild, userId, subtotal) {
  const methods = require('../lib/paymentState').activeMethods(guild.id).slice(0, 24); // without methods switched off (/disable)
  const extra = balance.paymentOption(guild.id, userId, subtotal);
  if (!methods.length && !extra && require('../lib/paymentState').allOff(guild.id)) throw new UserError('Płatności są chwilowo wstrzymane – spróbuj ponownie trochę później.');
  if (!methods.length && !extra) {
    return new LabelBuilder().setLabel('Metoda płatności').setTextInputComponent(new TextInputBuilder().setCustomId('payment_text').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(60));
  }
  const options = methods.map(({ m, index: i }) => ({ label: truncate(m.name, 100), value: String(i), description: m.details ? truncate(m.details, 100) : undefined, emoji: ce(guild, m.emoji) }));
  if (extra) options.push(extra);
  return new LabelBuilder()
    .setLabel('Metoda płatności')
    .setDescription('Jak chcesz zapłacić? Szczegóły dostaniesz w tickecie.')
    .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId('payment').setPlaceholder('Wybierz metodę płatności…').addOptions(options));
}

/** The checkout form: what's in the cart, payment method, promo code, notes (4 of the 5 components a form holds). */
function checkoutModal(guild, userId, cart) {
  const lines = cart.lines.map((l) => `• ${l.name} × ${l.quantity} · ${l.total != null ? money(l.total) : shop.formatPrice(l.rawPrice)}`);
  const total = cart.subtotal != null ? `Razem **${money(cart.subtotal)}**` : 'kwotę potwierdzi sprzedawca';
  const modal = new ModalBuilder()
    .setCustomId(`cart:submit:${cents(cart.subtotal)}`)
    .setTitle('🛒 Złóż zamówienie')
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(`**${unitsText(cart.units)}** · ${total}\n${lines.join('\n')}`, 1500)))
    .addLabelComponents(paymentField(guild, userId, cart.subtotal));
  if (config.promos.enabled !== false) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('Kod rabatowy')
        .setDescription('Opcjonalnie – rabat obejmuje cały koszyk.')
        .setTextInputComponent(new TextInputBuilder().setCustomId('promo').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(24).setPlaceholder('np. HS10')),
    );
  }
  return modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Coś jeszcze, o czym mamy wiedzieć?')
      .setTextInputComponent(new TextInputBuilder().setCustomId('notes').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500)),
  );
}

/** The cart's problems that stop a checkout (or null). */
function checkoutProblem(cart) {
  if (cart.dropped.length) return `Niektóre produkty z Twojego koszyka nie są już dostępne: ${cart.dropped.join(', ')}. Zostały usunięte – sprawdź koszyk i złóż zamówienie ponownie.`;
  if (!cart.lines.length) return 'Twój koszyk jest pusty – najpierw coś dodaj.';
  const over = cart.lines.find((l) => l.problem);
  if (over) return `**${over.name}** – ${over.problem}. Usuń tę pozycję i dodaj ją ponownie z mniejszą ilością.`;
  return null;
}

async function openCheckout(interaction) {
  requireEnabled();
  const cart = resolve(interaction.guild.id, interaction.user.id);
  const problem = checkoutProblem(cart);
  if (problem) throw new UserError(problem);
  const error = require('../tickets/tickets').checkCanOpen(interaction.member);
  if (error) throw new UserError(error);
  return interaction.showModal(checkoutModal(interaction.guild, interaction.user.id, cart));
}

/** The payment method picked at checkout → { method, methodIndex, payment, withBalance }. */
function pickedMethod(interaction) {
  const picked = pickedRaw(interaction);
  if (picked.methodIndex != null) require('../lib/paymentState').assertOn(interaction.guild.id, picked.method); // switched off since the form opened
  return picked;
}

function pickedRaw(interaction) {
  const typed = field(interaction, 'payment_text');
  try {
    const [value] = interaction.fields.getStringSelectValues('payment');
    if (value === 'balance') return { method: balance.METHOD, methodIndex: null, payment: balance.METHOD, withBalance: true };
    const m = config.shop.paymentMethods[Number(value)];
    if (m) return { method: m.name, methodIndex: Number(value), payment: m.details ? `${m.name} (${m.details})` : m.name, withBalance: false };
  } catch {
    // the text field instead
  }
  return { method: typed || null, methodIndex: null, payment: typed, withBalance: false };
}

/** The "Produkty" and "Cena" answers shown in the order ticket. */
function cartAnswers(cart, price, { payment, notes, withBalance }) {
  const products = cart.lines.map((l) => `${l.name} × ${l.quantity} — ${l.total != null ? money(l.total) : shop.formatPrice(l.rawPrice)}${l.salePercent ? ` (⚡ −${l.salePercent}%)` : ''}`);
  const answers = [
    { label: 'Produkty', value: products.join('\n') },
    { label: 'Metoda płatności', value: payment || '—' },
  ];
  if (notes) answers.push({ label: 'Uwagi', value: notes });
  const lines = [];
  if (price.subtotal == null) {
    lines.push(price.promo ? `Kod rabatowy ${price.code} – ${promos.label(price.promo)}, sprzedawca uwzględni go w ostatecznej cenie` : 'Sprzedawca potwierdzi ostateczną cenę.');
  } else if (price.discount > 0) {
    lines.push(`Suma: ${money(price.subtotal)}`, `Rabat (${price.code} · ${promos.label(price.promo)}): −${money(price.discount)}`, `**Do zapłaty: ${money(price.total)}**`);
  } else lines.push(`**Do zapłaty: ${money(price.subtotal)}**`);
  if (cart.lines.some((l) => l.salePercent)) lines.unshift('⚡ Uwzględniono ceny z promocji błyskawicznej');
  if (price.error) lines.push(`Kod rabatowy ${price.code} – nie zastosowano: ${price.error}`);
  if (withBalance) lines.push(`💰 Opłacono saldem sklepu – ${balance.NON_REFUNDABLE}`);
  answers.push({ label: 'Cena', value: lines.join('\n') });
  return answers;
}

/** The private answer once the order ticket is open (replaces the cart). */
function placedView(guild, channel, cart, price, { withBalance, userId }) {
  const c = container(COLORS.success);
  const lines = [`## ${e(guild, 'check')} Zamówienie rozpoczęte – ${unitsText(cart.units)}`, `Twój prywatny ticket zamówienia jest gotowy: ${channel}`];
  if (withBalance) lines.push(`💰 Opłacono saldem sklepu: **${money(price.total)}** – na saldzie zostało ${money(balance.get(guild.id, userId))}. Zamówienie zrealizujemy w tickecie.`);
  else if (price.total != null) {
    const savings = [cart.lines.some((l) => l.salePercent) && '⚡ ceny z promocji błyskawicznej', price.discount > 0 && `oszczędzasz ${money(price.discount)} z kodem **${price.code}**`].filter(Boolean);
    lines.push(`${e(guild, 'card')} Do zapłaty: **${money(price.total)}**${savings.length ? ` (${savings.join(' · ')})` : ''}`);
  } else if (price.promo) lines.push(`${e(guild, 'gift')} Kod rabatowy **${price.code}** (${promos.label(price.promo)}) – sprzedawca uwzględni go w ostatecznej cenie.`);
  if (price.error) lines.push(`${e(guild, 'warning')} Kod rabatowy **${price.code}** – nie zastosowano: ${price.error}`);
  if (!withBalance) lines.push('Sprzedawca potwierdzi tam cenę i szczegóły płatności. **Nigdy nie płać nikomu w wiadomościach prywatnych.**');
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addActionRowComponents(row(linkBtn(channel.url, 'Przejdź do zamówienia', '🎫')));
  return v2(c);
}

const placing = new Set(); // members whose cart is being checked out right now

/** The checkout form → one order ticket with every item (order.items). */
async function submitCheckout(interaction, shown) {
  requireEnabled();
  const tickets = require('../tickets/tickets');
  const { guild, member } = interaction;
  const userId = interaction.user.id;
  const key = `${guild.id}:${userId}`;
  if (placing.has(key)) throw new UserError('Twoje zamówienie jest właśnie składane – chwileczkę…');
  const cart = resolve(guild.id, userId);
  const problem = checkoutProblem(cart);
  if (problem) throw new UserError(problem);
  if (shown != null && shown !== cents(cart.subtotal)) {
    throw new UserError('Ceny w Twoim koszyku zmieniły się, gdy formularz był otwarty (np. skończyła się promocja błyskawiczna) – otwórz koszyk, żeby zobaczyć nową kwotę, i złóż zamówienie ponownie.');
  }
  const error = tickets.checkCanOpen(member);
  if (error) throw new UserError(error);
  const { method, methodIndex, payment, withBalance } = pickedMethod(interaction);
  const price = priceCart(guild.id, userId, cart.subtotal, field(interaction, 'promo'));
  // Money taken at once must be exactly what the customer expects – a code that doesn't work stops it.
  if (withBalance && price.error) throw new UserError(`Nie można użyć kodu rabatowego **${price.code}**. ${price.error} Usuń go (albo popraw), żeby zapłacić saldem sklepu.`);
  const items = cart.lines.map((l) => ({
    productId: l.product.id,
    product: l.name,
    variant: l.variant?.name ?? null,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    ...(l.salePercent && { salePercent: l.salePercent, listPrice: l.listPrice }),
  }));
  const order = {
    productId: null,
    product: cartTitle(items),
    items,
    unitPrice: null,
    quantity: 1,
    method: method || null,
    methodIndex,
    promo: price.promo ? price.code : null,
    discount: price.discount,
    subtotal: price.subtotal,
    total: price.total,
    ...(withBalance && balance.paidFields()),
  };
  const answers = cartAnswers(cart, price, { payment, notes: field(interaction, 'notes'), withBalance });

  // Like the order form: from here this order holds its code, and – paid with balance – its money is taken
  // before the first await, so a second order at the same moment can't use the same balance.
  placing.add(key);
  const release = promos.hold(guild.id, userId, order.promo);
  let spent = null;
  let channel;
  try {
    if (withBalance) spent = balance.takeForOrder(guild.id, userId, price.total, { reason: 'Zamówienie z koszyka' });
    if (isPrivate(interaction)) await interaction.deferUpdate();
    else await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    channel = await tickets.openTicket(member, config.getType('order'), answers, { order });
  } catch (err) {
    if (spent) balance.giveBack(guild.id, userId, spent);
    if (!interaction.deferred) throw err;
    if (!(err instanceof UserError)) console.error('[cart] składanie zamówienia:', err);
    const why = err instanceof UserError ? err.message : 'Nie udało się złożyć zamówienia – spróbuj ponownie za chwilę.';
    return interaction.editReply(cartView(guild, userId, { note: `⚠️ ${why}${spent ? ' Z Twojego salda nic nie zostało pobrane.' : ''}` }));
  } finally {
    release(); // the saved ticket holds the code now (or opening it failed)
    placing.delete(key);
  }
  if (spent) balance.linkOrder(spent, db.getTicket(channel.id));
  removeOrdered(guild.id, userId, cart.lines);
  const answer = await interaction.editReply(placedView(guild, channel, cart, price, { withBalance, userId }));
  await hooks.emit('orderPlaced', { guild, channel, ticket: db.getTicket(channel.id), member });
  return answer;
}

// ───────────── Wiring ─────────────

async function clearButton(interaction) {
  requireEnabled();
  clear(interaction.guild.id, interaction.user.id);
  return show(interaction, { note: '🗑️ Twój koszyk jest teraz pusty.' });
}

async function removeSelect(interaction) {
  requireEnabled();
  const removed = removeItem(interaction.guild.id, interaction.user.id, String(interaction.values?.[0] ?? ''));
  return show(interaction, { note: removed ? '✖️ Usunięto z koszyka.' : null });
}

const STALE = 30 * 86_400_000; // a cart nobody changed for 30 days is dropped

/** Drops carts nobody changed for 30 days, so db.json doesn't keep them forever. → how many. */
function dropStale(now = Date.now()) {
  let dropped = 0;
  for (const guildId of db.allGuildIds()) {
    const all = carts(guildId);
    for (const [userId, c] of Object.entries(all)) {
      if (now - (Number(c?.updatedAt) || 0) <= STALE) continue;
      delete all[userId];
      dropped += 1;
    }
  }
  if (dropped) db.save();
  return dropped;
}

hooks.every('staleCarts', 6 * 3_600_000, () => dropStale());
hooks.route('cart', {
  button(interaction, action, args) {
    if (action === 'open') {
      requireEnabled();
      return show(interaction, { inPlace: false });
    }
    if (action === 'add') return openAdd(interaction, args[0], 's');
    if (action === 'clear') return clearButton(interaction);
    if (action === 'checkout') return openCheckout(interaction);
    return null;
  },
  select(interaction, action) {
    if (action === 'pick') return openAdd(interaction, interaction.values?.[0], 'c');
    if (action === 'remove') return removeSelect(interaction);
    return null;
  },
  modal(interaction, action, args) {
    if (action === 'addform') return submitAdd(interaction, args[0], args[1]);
    if (action === 'submit') return submitCheckout(interaction, args[0] ?? null);
    return null;
  },
});

module.exports = {
  enabled,
  maxItems,
  count,
  linePrice,
  resolve,
  priceCart,
  addItem,
  removeItem,
  clear,
  cartView,
  cartButton,
  shortcuts,
  addModal,
  checkoutModal,
  dropStale,
};
