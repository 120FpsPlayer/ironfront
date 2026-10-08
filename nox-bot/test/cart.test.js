'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, MessageFlagsBitField } = require('discord.js');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const cart = require('../src/features/cart');
const flash = require('../src/features/flashsales');
const delivery = require('../src/features/delivery');
const badges = require('../src/features/badges');
const sales = require('../src/features/salesreport');
const orders = require('../src/features/orders');
const promos = require('../src/features/promos');
const stripe = require('../src/features/stripe');
const { env } = require('../src/env');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 940000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const privateMsg = { flags: new MessageFlagsBitField(MessageFlags.Ephemeral) };
const METHOD = (type) => String(config.shop.paymentMethods.findIndex((m) => m.type === type));
const toJSON = (c) => (c?.toJSON ? c.toJSON() : c);
const HOUR = 3_600_000;

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

/** Every action row of a Components V2 payload. */
function actionRows(payload) {
  const rows = [];
  const walk = (c) => {
    const d = toJSON(c);
    if (!d) return;
    if (d.type === 1) rows.push(d);
    else for (const x of d.components ?? []) walk(x);
  };
  for (const c of payload?.components ?? []) walk(c);
  return rows;
}
const navRow = (payload) => actionRows(payload).find((r) => r.components.some((b) => b.custom_id === 'myorders:open'));
const navLabels = (payload) => navRow(payload)?.components.map((b) => b.label) ?? [];

/** ➕ Add to cart → the option + quantity form, submitted. from: 's' (a shop card) or 'c' (inside the cart). */
async function add(guild, buyer, product, { variant = null, quantity = '1', from = 's' } = {}) {
  return run({
    guild,
    member: buyer,
    kind: 'modal',
    customId: `cart:addform:${product.id}:${from}`,
    fields: { quantity },
    selects: variant ? { variant: [variant.id] } : {},
    message: from === 'c' ? privateMsg : null,
  });
}

/** Checkout → the form (its custom ID carries the total it shows) → submitted. */
async function checkout(guild, buyer, { payment = METHOD('paysafecard'), promo = '', notes = '', customId = null } = {}) {
  const open = await run({ guild, member: buyer, kind: 'button', customId: 'cart:checkout', message: privateMsg });
  const form = open.state.modals[0];
  const i = await run({
    guild,
    member: buyer,
    kind: 'modal',
    customId: customId ?? form?.custom_id ?? 'cart:submit:x',
    fields: { promo, notes },
    selects: { payment: [payment] },
    message: privateMsg,
  });
  return { open, form, i, ticket: db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0] ?? null };
}

const texts = (channel) => channel.messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');

/** Netflix with options, Nitro on a −20% flash sale. */
async function catalog(guild) {
  const netflix = shop.addProduct(guild, { name: 'Netflix Premium', price: '5', description: 'UHD account.' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12');
  const nitro = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'One month of Nitro.' });
  flash.startSale(guild, nitro.id, { percent: 20, durationMs: HOUR });
  const fresh = shop.findProduct(guild.id, netflix.id);
  return { netflix: fresh, threeMonths: fresh.variants.find((v) => v.name === '3 months'), nitro: shop.findProduct(guild.id, nitro.id) };
}

// ───────────── Adding ─────────────

test('Add to cart on the cards and in the cart: options, quantities and flash sale prices add up to the total', async () => {
  const guild = await builtGuild();
  const { netflix, threeMonths, nitro } = await catalog(guild);
  const buyer = member(guild);

  // The small shop has room: Buy and ➕ Add to cart in one row on every card, 🛒 Cart in the bottom row.
  const panel = shop.shopPanel(guild);
  validateMessage(panel, guild);
  for (const p of [netflix, nitro]) {
    const cardRow = actionRows(panel).find((r) => r.components.some((b) => b.custom_id === `shop:buy:${p.id}`));
    assert.deepEqual(cardRow.components.map((b) => b.custom_id), [`shop:buy:${p.id}`, `cart:add:${p.id}`]);
  }
  assert.ok(navLabels(panel).includes('Cart'));

  // The button opens the option + quantity form.
  const click = await run({ guild, member: buyer, kind: 'button', customId: `cart:add:${netflix.id}` });
  const form = click.state.modals[0];
  assert.equal(form.custom_id, `cart:addform:${netflix.id}:s`);
  assert.deepEqual(form.components.map((c) => c.component?.custom_id ?? 'text'), ['variant', 'quantity']);

  const first = await add(guild, buyer, netflix, { variant: threeMonths });
  assert.equal(first.state.deferredAs, 'reply', 'from the shop: the cart answers in a new private message');
  assert.match(textOf(lastResponse(first)), /Added \*\*Netflix Premium — 3 months\*\* × 1 to your cart/);
  await add(guild, buyer, nitro, { quantity: '2' });
  const again = await add(guild, buyer, netflix, { variant: threeMonths, from: 'c' });
  assert.equal(again.state.deferredAs, 'update', 'inside the cart: updated in place');
  const view = lastResponse(again);
  validateMessage(view, guild);
  const said = textOf(view);
  assert.match(said, /\*\*Netflix Premium — 3 months\*\* × 2 · 12€ each · \*\*24€\*\*/);
  assert.match(said, /\*\*Nitro Boost\*\* × 2 · ~~10€~~ 8€ each · \*\*16€\*\* ⚡ −20%/);
  assert.match(said, /Total: 40€/);
  assert.deepEqual(db.guild(guild.id).carts[buyer.id].items.map((i) => [i.productId, i.variantId, i.quantity]), [
    [netflix.id, threeMonths.id, 2],
    [nitro.id, null, 2],
  ]);

  // Private shop pages show how many things are in the cart.
  assert.deepEqual(navLabels(shop.shopView(guild, { userId: buyer.id })).slice(-2), ['Cart (4)', 'My orders']);
  const opened = await run({ guild, member: buyer, kind: 'button', customId: 'cart:open' });
  assert.match(textOf(lastResponse(opened)), /4 items · only you can see this/);
  assert.ok(customIds(lastResponse(opened)).includes('cart:checkout'));

  // "➕ Add a product…" in the cart opens the same form, marked as coming from the cart.
  const pick = await run({ guild, member: buyer, kind: 'select', customId: 'cart:pick', values: [nitro.id], message: privateMsg });
  assert.equal(pick.state.modals[0].custom_id, `cart:addform:${nitro.id}:c`);
});

test('Cart limits: max items, counted stock, sold-out and deleted products – refused, or dropped with a note; remove and clear', async () => {
  const guild = await builtGuild();
  const { netflix, threeMonths, nitro } = await catalog(guild);
  const keys = shop.addProduct(guild, { name: 'Steam Key', price: '20', description: 'A random key.', stockCount: 3 });
  const buyer = member(guild);

  const before = config.cart.maxItems;
  config.cart.maxItems = 2;
  try {
    await add(guild, buyer, netflix, { variant: threeMonths });
    await add(guild, buyer, nitro);
    const full = await add(guild, buyer, keys);
    assert.match(textOf(lastResponse(full)), /Your cart is full – it holds up to \*\*2\*\* different products/);
    const more = await add(guild, buyer, nitro, { quantity: '3' });
    assert.match(textOf(lastResponse(more)), /Nitro Boost\*\* × 3 to your cart/, 'more of a product already in the cart is fine');
  } finally {
    config.cart.maxItems = before;
  }

  await add(guild, buyer, keys, { quantity: '2' });
  const over = await add(guild, buyer, keys, { quantity: '2' });
  assert.match(textOf(lastResponse(over)), /Only \*\*3\*\* of \*\*Steam Key\*\* left – 2 are already in your cart/);
  const bad = await add(guild, buyer, keys, { quantity: '0' });
  assert.match(textOf(lastResponse(bad)), /whole number from \*\*1\*\* to \*\*999\*\*/);

  // Sold out meanwhile → dropped with a note; deleted → the same.
  await shop.setStock(guild, nitro.id, 'out');
  shop.removeProduct(guild, netflix.id);
  const view = lastResponse(await run({ guild, member: buyer, kind: 'button', customId: 'cart:open' }));
  const said = textOf(view);
  assert.match(said, /Removed from your cart: Netflix Premium — 3 months \(no longer in the shop\), Nitro Boost \(sold out\)/);
  assert.doesNotMatch(said, /\*\*Nitro Boost\*\* ×/);
  assert.deepEqual(db.guild(guild.id).carts[buyer.id].items.map((i) => i.productId), [keys.id]);
  const soldOut = await add(guild, buyer, shop.findProduct(guild.id, nitro.id));
  assert.match(textOf(lastResponse(soldOut)), /sold out right now/);
  const pickOut = await run({ guild, member: buyer, kind: 'button', customId: `cart:add:${nitro.id}` });
  assert.equal(pickOut.state.modals.length, 0);

  // Stock that dropped below what's in the cart blocks the checkout until it's fixed.
  await shop.setStock(guild, keys.id, null, { count: 1 });
  const blocked = await run({ guild, member: buyer, kind: 'button', customId: 'cart:checkout', message: privateMsg });
  assert.equal(blocked.state.modals.length, 0);
  assert.match(textOf(lastResponse(blocked)), /\*\*Steam Key\*\* – only 1 left/);

  // Remove an item, then clear.
  const removed = await run({ guild, member: buyer, kind: 'select', customId: 'cart:remove', values: [`${keys.id}:`], message: privateMsg });
  assert.equal(removed.state.deferredAs, 'update');
  assert.match(textOf(lastResponse(removed)), /Your cart is empty/);
  await add(guild, buyer, keys);
  const cleared = await run({ guild, member: buyer, kind: 'button', customId: 'cart:clear', message: privateMsg });
  assert.match(textOf(lastResponse(cleared)), /Your cart is empty now/);
  assert.equal(db.guild(guild.id).carts[buyer.id], undefined);
  assert.equal(cart.count(guild.id, buyer.id), 0);
});

test('A huge cart stays within Discord limits (25 long items, 30 products); carts untouched for 30 days are dropped', async () => {
  const guild = await builtGuild();
  const list = [];
  for (let i = 0; i < 30; i += 1) {
    const p = shop.addProduct(guild, { name: `Product ${i} ${'x'.repeat(66)}`, price: '1 299,99', description: 'd'.repeat(400), stockCount: 999 });
    shop.setVariants(guild, p.id, `${'Option A '.repeat(5).trim()} = 1299, ${'Option B '.repeat(5).trim()} = 999`);
    list.push(shop.findProduct(guild.id, p.id));
  }
  for (const p of list.slice(0, 10)) flash.startSale(guild, p.id, { percent: 33, durationMs: HOUR });
  const buyer = member(guild);
  const before = config.cart.maxItems;
  config.cart.maxItems = 99; // capped at 25 – one remove menu holds 25
  try {
    assert.equal(cart.maxItems(), 25);
    for (const p of list.slice(0, 25)) await add(guild, buyer, p, { variant: p.variants[0], quantity: '999' });
    const full = await add(guild, buyer, list[25], { variant: list[25].variants[0] });
    assert.match(textOf(lastResponse(full)), /Your cart is full/);
    const view = cart.cartView(guild, buyer.id, { note: `✅ ${'n'.repeat(500)}` });
    const { total, textLength } = validateMessage(view, guild);
    assert.ok(total <= 40 && textLength <= 4000, `${total} components, ${textLength} characters`);
    const open = await run({ guild, member: buyer, kind: 'button', customId: 'cart:checkout', message: privateMsg });
    assert.equal(open.state.modals.length, 1, 'the checkout form is valid');
  } finally {
    config.cart.maxItems = before;
  }

  // Untouched for 30 days → dropped by the timer; a recent cart stays.
  const fresh = member(guild);
  await add(guild, fresh, list[0], { variant: list[0].variants[0] });
  db.guild(guild.id).carts[buyer.id].updatedAt = Date.now() - 31 * 24 * HOUR;
  assert.equal(cart.dropStale(), 1);
  assert.equal(db.guild(guild.id).carts[buyer.id], undefined);
  assert.ok(db.guild(guild.id).carts[fresh.id]);
});

// ───────────── Checkout ─────────────

test('Checkout: one order ticket with every item, sale prices and the promo code once – the cart empties', async () => {
  const guild = await builtGuild();
  const { netflix, threeMonths, nitro } = await catalog(guild);
  promos.create(guild.id, { code: 'CART10', percent: 10 });
  const buyer = member(guild);
  await add(guild, buyer, netflix, { variant: threeMonths });
  await add(guild, buyer, nitro, { quantity: '2' });

  const { form, i, ticket } = await checkout(guild, buyer, { promo: 'cart10', notes: 'Fast please' });
  assert.equal(form.custom_id, 'cart:submit:2800', 'the form remembers the total it shows');
  assert.ok(form.components.length <= 5);
  assert.deepEqual(form.components.filter((c) => c.type === 18).map((c) => c.component.custom_id), ['payment', 'promo', 'notes']);
  assert.match(form.components[0].content, /3 items\*\* · Total \*\*28€\*\*\n• Netflix Premium — 3 months × 1 · 12€\n• Nitro Boost × 2 · 16€/);

  assert.equal(i.state.deferredAs, 'update', 'the order replaces the cart message');
  const placed = textOf(lastResponse(i));
  assert.match(placed, /Order started – 3 items[\s\S]*Total to pay: \*\*25\.20€\*\* \(⚡ flash sale prices · you save 2\.80€ with \*\*CART10\*\*\)/);
  assert.ok(lastResponse(i).components.length > 0);

  const order = ticket.order;
  assert.equal(order.productId, null);
  assert.equal(order.product, 'Netflix Premium — 3 months × 1, Nitro Boost × 2');
  assert.deepEqual(
    order.items.map((x) => [x.productId, x.product, x.variant, x.quantity, x.unitPrice]),
    [
      [netflix.id, 'Netflix Premium — 3 months', '3 months', 1, 12],
      [nitro.id, 'Nitro Boost', null, 2, 8],
    ],
  );
  assert.equal(order.items[1].salePercent, 20);
  assert.deepEqual([order.subtotal, order.discount, order.total, order.promo, order.quantity], [28, 2.8, 25.2, 'CART10', 1]);
  assert.equal(db.guild(guild.id).carts[buyer.id], undefined, 'the cart is empty');
  assert.deepEqual(promos.reservedBy(guild.id, 'CART10'), [buyer.id], 'the open order holds its code');

  // The ticket shows every item; the payment card is for the whole cart.
  const channel = guild.channels.cache.get(ticket.channelId);
  const all = texts(channel);
  assert.match(all, /\*\*Products\*\*\n> Netflix Premium — 3 months × 1 — 12€\n> Nitro Boost × 2 — 16€ \(⚡ −20%\)/);
  assert.match(all, /Discount \(CART10 · 10% off\): −2\.80€[\s\S]*Total to pay: 25\.20€/);
  assert.match(all, /Pay 25\.20€ – PaysafeCard\n-# Order `#\d+` · Netflix Premium — 3 months × 1, Nitro Boost × 2\n/);
  assert.match(all, /Notes\*\*\n> Fast please/);
});

test('Checkout is refused when the prices changed while the form was open, or the cart is empty', async () => {
  const guild = await builtGuild();
  const { nitro } = await catalog(guild);
  const buyer = member(guild);
  await add(guild, buyer, nitro);
  const open = await run({ guild, member: buyer, kind: 'button', customId: 'cart:checkout', message: privateMsg });
  assert.equal(open.state.modals[0].custom_id, 'cart:submit:800');
  flash.stopSale(guild, nitro.id);
  const late = await run({ guild, member: buyer, kind: 'modal', customId: 'cart:submit:800', fields: {}, selects: { payment: [METHOD('crypto')] }, message: privateMsg });
  assert.match(textOf(lastResponse(late)), /prices in your cart changed while the form was open/);
  assert.equal(db.tickets((x) => x.ownerId === buyer.id).length, 0);

  const empty = member(guild);
  const none = await run({ guild, member: empty, kind: 'button', customId: 'cart:checkout', message: privateMsg });
  assert.match(textOf(lastResponse(none)), /Your cart is empty – add something first/);
});

// ───────────── Delivery, stock, badges, sales ─────────────

/** Stripe that makes a link for the posted amount and reports it paid. */
function fakeStripe() {
  const real = global.fetch;
  let amount = 0;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.origin !== 'https://api.stripe.com') throw new Error(`No network in tests: ${url}`);
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    if (opts.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      amount = Number(new URLSearchParams(opts.body).get('line_items[0][price_data][unit_amount]'));
      return json({ id: 'cs_cart', url: 'https://checkout.stripe.com/c/pay/cs_cart', status: 'open', payment_status: 'unpaid', currency: 'eur', amount_total: amount, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    return json({ id: 'cs_cart', status: 'complete', payment_status: 'paid', currency: 'eur', amount_total: amount, payment_intent: 'pi_cart' });
  };
  return () => (global.fetch = real);
}

test('Stripe pays a cart: every item is delivered (ticket + DM), the stock of each item goes down, sale.items feeds badges, receipts, proofs and the sales report', async () => {
  const guild = await builtGuild();
  const netflix = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.', stockCount: 10 });
  const nitro = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'One month.', stockCount: 5 });
  await delivery.setDelivery(guild, netflix.id, { text: 'NETFLIX-LOGIN-123' });
  await delivery.setDelivery(guild, nitro.id, { text: 'NITRO-GIFT-456' });
  const buyer = member(guild);
  await add(guild, buyer, netflix);
  await add(guild, buyer, nitro, { quantity: '3' });

  const prev = env.stripeKey;
  env.stripeKey = 'sk_test_cart';
  const restore = fakeStripe();
  try {
    const { ticket } = await checkout(guild, buyer, { payment: METHOD('stripe') });
    const channel = guild.channels.cache.get(ticket.channelId);
    assert.match(texts(channel), /Instant delivery:\*\* your product arrives right here/);
    await stripe.checkPayments(guild.client);
    const all = texts(channel);
    assert.match(all, /📦 The product is delivered automatically/);
    assert.match(all, /Your product – Netflix Premium × 1[\s\S]*NETFLIX-LOGIN-123/);
    assert.match(all, /Your product – Nitro Boost × 3[\s\S]*NITRO-GIFT-456/);
    const dms = guild.dms.filter((d) => d.to === buyer.id).map((d) => textOf(d.payload)).join('\n---\n');
    assert.match(dms, /NETFLIX-LOGIN-123/);
    assert.match(dms, /NITRO-GIFT-456/);

    const done = db.getTicket(ticket.channelId);
    assert.ok(done.completedAt);
    assert.equal(statusOf(done), 'delivered');
    const sale = db.sales(guild.id).at(-1);
    assert.equal(sale.amount, 42);
    assert.deepEqual(sale.items.map((x) => [x.productId, x.quantity, x.unitPrice]), [
      [netflix.id, 1, 12],
      [nitro.id, 3, 10],
    ]);
    assert.equal(shop.findProduct(guild.id, netflix.id).stockCount, 9, 'stock per item');
    assert.equal(shop.findProduct(guild.id, nitro.id).stockCount, 2);

    // Receipt and #proofs list the items.
    assert.match(dms, /\*\*Products:\*\*\n> .* Netflix Premium × 1 · 12€ each\n> .* Nitro Boost × 3 · 10€ each/);
    const proofs = guild.channels.cache.get(db.channelId(guild.id, 'proofs'));
    assert.match(textOf(proofs.messageList.at(-1).body), /delivered\n.* \*\*Netflix Premium\*\* × 1\n.* \*\*Nitro Boost\*\* × 3/);

    // 🔥 Bestseller counts units of every item; the sales report has a row per product with its share.
    assert.equal(badges.bestseller(guild.id), nitro.id);
    const sum = sales.summarize(guild.id, { from: 0, to: Date.now() + 1000 });
    assert.equal(sum.orders, 1);
    assert.equal(sum.revenue, 42);
    assert.deepEqual(sum.products.map((p) => [p.name, p.orders, p.revenue]), [
      ['Nitro Boost', 1, 30],
      ['Netflix Premium', 1, 12],
    ]);
    validateMessage(orders.receiptCard(guild, { sale, ticket: done }), guild);
  } finally {
    restore();
    env.stripeKey = prev;
  }
});

test('A cart with a product delivered by hand: staff send what has files or text, then complete it by hand', async () => {
  const guild = await builtGuild();
  const key = shop.addProduct(guild, { name: 'Game Key', price: '15', description: 'A key.' });
  const logo = shop.addProduct(guild, { name: 'Custom Logo', price: '30', description: 'Made for you.' });
  await delivery.setDelivery(guild, key.id, { text: 'KEY-AAAA-BBBB' });
  const buyer = member(guild);
  const seller = member(guild, ['member', 'seller']);
  await add(guild, buyer, key);
  await add(guild, buyer, logo);
  const { ticket } = await checkout(guild, buyer, { payment: METHOD('crypto') });
  const channel = guild.channels.cache.get(ticket.channelId);
  assert.equal(delivery.deliverable(guild.id, ticket), false, 'not automatic – the logo is made by hand');
  assert.equal(delivery.canDeliver(guild.id, ticket), true);

  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { note: 'tx 0xabc' }, channel });
  const card = channel.messageList.at(-1);
  assert.ok(textOf(card.body).includes('Payment OK – deliver'));
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), /Delivered \*\*1 product\*\* in the ticket and by DM\. ⚠️ Deliver by hand: Custom Logo × 1 – then ⚙️ → \*\*Order completed\*\*/);
  assert.match(texts(channel), /Your product – Game Key × 1[\s\S]*KEY-AAAA-BBBB/);
  assert.equal(db.getTicket(ticket.channelId).completedAt ?? null, null, 'completed by hand later');
  assert.equal(statusOf(db.getTicket(ticket.channelId)), 'paid');
});

// ───────────── The shop panel ─────────────

test('The shop keeps every image with 🛒 Cart: 5 tabs, pages and 5 products with images fit 40 components; ➕ Add to cart only where it fits', async () => {
  const guild = await builtGuild();
  const png = () => {
    const buf = Buffer.alloc(2048, 7);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
    return buf;
  };
  for (const category of ['Games', 'Keys', 'Software', 'Streaming']) {
    for (let i = 1; i <= 3; i += 1) shop.addProduct(guild, { name: `${category} ${i}`, price: '5', description: 'Instant delivery.', category, image: { buffer: png(), ext: 'png' } });
  }
  const buyer = member(guild);
  const pages = [shop.shopPanel(guild), shop.shopView(guild, { page: 1, userId: buyer.id }), shop.shopView(guild, { page: 2 }), shop.shopView(guild, { tab: 'c:games' })];
  for (const payload of pages) {
    const { total, textLength } = validateMessage(payload, guild);
    assert.ok(total <= 40 && textLength <= 4000, `${total} components`);
    assert.ok(customIds(payload).includes('cart:open'));
    assert.ok(navRow(payload).components.length <= 5);
  }
  assert.deepEqual(pages.map((p) => p.files.length), [5, 5, 2, 3], 'every product keeps its picture');
  assert.ok(!customIds(pages[0]).some((id) => id.startsWith('cart:add:')), 'a full page has no room for Add to cart');
  assert.ok(customIds(pages[2]).some((id) => id.startsWith('cart:add:')), 'a page with room has it');

  // Turned off: no Cart button, no Add to cart, and the buttons answer that it's off.
  config.cart.enabled = false;
  try {
    const off = shop.shopView(guild, { page: 2 });
    assert.ok(!customIds(off).some((id) => id.startsWith('cart:')));
    const click = await run({ guild, member: buyer, kind: 'button', customId: 'cart:open' });
    assert.match(textOf(lastResponse(click)), /The cart is turned off/);
  } finally {
    config.cart.enabled = true;
  }
});

test('Single-product orders stay as they were: no items, the product and quantity as before', async () => {
  const guild = await builtGuild();
  const product = shop.addProduct(guild, { name: 'Spotify Premium', price: '4.50', description: 'One month.' });
  const buyer = member(guild);
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '2' }, selects: { payment: [METHOD('paysafecard')] } });
  const ticket = db.tickets((x) => x.ownerId === buyer.id)[0];
  assert.equal(ticket.order.items, undefined);
  assert.equal(ticket.order.productId, product.id);
  assert.equal(shop.ticketProduct(guild.id, ticket).id, product.id);
  assert.match(texts(guild.channels.cache.get(ticket.channelId)), /Order `#\d+` · Spotify Premium × 2/);
});
