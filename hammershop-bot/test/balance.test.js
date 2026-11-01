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
const balance = require('../src/features/balance');
const delivery = require('../src/features/delivery');
const autopay = require('../src/features/autopay');
const sales = require('../src/features/salesreport');
const stripe = require('../src/features/stripe');
const t = require('../src/tickets/tickets');
const { env } = require('../src/env');
const { UserError } = require('../src/lib/utils');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 930000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const privateMsg = { flags: new MessageFlagsBitField(MessageFlags.Ephemeral) };
const METHOD = (type) => String(config.shop.paymentMethods.findIndex((m) => m.type === type));
const said = (i) => textOf(lastResponse(i));
const texts = (channel) => channel.messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');
const logChannel = (guild) => guild.channels.cache.get(db.settings(guild.id).logChannelId);
const NON_REFUNDABLE = /Balance can't be refunded or paid out/;

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  db.updateSettings(guild.id, { maxOpenTicketsPerUser: 0 }); // these tests place many orders per member
  return guild;
}

const command = (guild, who, subcommand, options = {}) => run({ guild, member: who, kind: 'command', commandName: 'balance', subcommand, options });
const lastTicket = (guild, who) => db.tickets((x) => x.guildId === guild.id && x.ownerId === who.id).sort((a, b) => b.number - a.number)[0] ?? null;

/** Buy → the order form → submitted. */
const buy = (guild, who, product, { payment = 'balance', quantity = '1', promo = '' } = {}) =>
  run({ guild, member: who, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity, promo }, selects: { payment: [payment] } });

/** The payment options the order form offers this member. */
async function formOptions(guild, who, product) {
  const i = await run({ guild, member: who, kind: 'button', customId: `shop:buy:${product.id}` });
  return i.state.modals[0].components.find((c) => c.component?.custom_id === 'payment').component.options;
}

/** A product with something to deliver, so a paid order completes on its own. */
async function deliverable(guild, name, price) {
  const p = shop.addProduct(guild, { name, price, description: 'Instant.' });
  await delivery.setDelivery(guild, p.id, { text: `${name.toUpperCase().replace(/\s+/g, '-')}-CODE` });
  return shop.findProduct(guild.id, p.id);
}

// ───────────── /balance ─────────────

test('/balance: everyone sees their own; admins & sellers view, add and remove – never below 0, logged', async () => {
  const guild = await builtGuild();
  const buyer = member(guild);
  const seller = member(guild, ['member', 'seller']);

  const own = await command(guild, buyer, 'view');
  validateMessage(lastResponse(own), guild);
  assert.match(said(own), /You have \*\*0€\*\* to spend in the shop/);
  assert.match(said(own), NON_REFUNDABLE);
  assert.ok(lastResponse(own).flags & MessageFlags.Ephemeral);

  assert.match(said(await command(guild, buyer, 'view', { user: seller.user })), /Only administrators and sellers can see someone else's balance/);
  assert.match(said(await command(guild, buyer, 'add', { user: buyer.user, amount: 100, reason: 'free money' })), /Only administrators and sellers can change store balances/);
  assert.equal(balance.get(guild.id, buyer.id), 0);

  const added = await command(guild, seller, 'add', { user: buyer.user, amount: 30, reason: 'Giveaway prize' });
  assert.match(said(added), /Added \*\*30€\*\* to <@\d+>'s store balance – it is now \*\*30€\*\*/);
  assert.match(textOf(logChannel(guild).messageList.at(-1).body), /Balance added[\s\S]*30€[\s\S]*0€ → \*\*30€\*\*[\s\S]*Giveaway prize/);

  const tooMuch = await command(guild, seller, 'remove', { user: buyer.user, amount: 50, reason: 'oops' });
  assert.match(said(tooMuch), /only has \*\*30€\*\* – you can remove up to that/);
  assert.equal(balance.get(guild.id, buyer.id), 30);
  await command(guild, seller, 'remove', { user: buyer.user, amount: 10, reason: 'Chargeback' });
  assert.equal(balance.get(guild.id, buyer.id), 20);
  assert.match(textOf(logChannel(guild).messageList.at(-1).body), /Balance removed[\s\S]*30€ → \*\*20€\*\*[\s\S]*Chargeback/);
  assert.throws(() => balance.change(guild.id, buyer.id, -21, { reason: 'test' }), /Not enough store balance/);

  const staffView = said(await command(guild, seller, 'view', { user: buyer.user }));
  assert.match(staffView, /<@\d+> has \*\*20€\*\*/);
  assert.match(staffView, /`−10€` · Chargeback[\s\S]*`\+30€` · Giveaway prize/);
  assert.deepEqual(balance.history(guild.id, buyer.id).map((h) => [h.change, h.by]), [
    [-10, seller.id],
    [30, seller.id],
  ]);
});

// ───────────── Top-ups ─────────────

test('Top up: 💰 Balance → Top up → an order ticket; completing it credits the balance once – no product, no proof, non-refundable everywhere', async () => {
  const guild = await builtGuild();
  const buyer = member(guild);
  const seller = member(guild, ['member', 'seller']);

  // My orders has 🛒 Cart and 💰 Balance; the balance view has Top up.
  const mine = await run({ guild, member: buyer, kind: 'button', customId: 'myorders:open' });
  assert.ok(customIds(lastResponse(mine)).includes('balance:open') && customIds(lastResponse(mine)).includes('cart:open'));
  const view = await run({ guild, member: buyer, kind: 'button', customId: 'balance:open' });
  assert.match(said(view), /You have \*\*0€\*\*[\s\S]*Balance can't be refunded or paid out/);
  assert.ok(customIds(lastResponse(view)).includes('balance:topup'));
  const click = await run({ guild, member: buyer, kind: 'button', customId: 'balance:topup', message: privateMsg });
  const form = click.state.modals[0];
  assert.equal(form.custom_id, 'balance:topupform');
  assert.ok(form.components.length <= 5);
  assert.match(form.components[0].content, NON_REFUNDABLE);

  const small = await run({ guild, member: buyer, kind: 'modal', customId: 'balance:topupform', fields: { amount: '2' }, selects: { payment: [METHOD('paysafecard')] } });
  assert.match(said(small), /You can top up from \*\*5€\*\* to \*\*500€\*\* at once/);
  const started = await run({ guild, member: buyer, kind: 'modal', customId: 'balance:topupform', fields: { amount: '25' }, selects: { payment: [METHOD('paysafecard')] } });
  assert.match(said(started), /Top-up started – 25€[\s\S]*Balance can't be refunded or paid out/);

  const ticket = lastTicket(guild, buyer);
  assert.deepEqual(ticket.order.topUp, { amount: 25 });
  assert.deepEqual([ticket.order.product, ticket.order.total, ticket.order.productId], ['Balance top-up 25€', 25, null]);
  const channel = guild.channels.cache.get(ticket.channelId);
  const before = texts(channel);
  assert.match(before, /Balance top-up\*\*\n> \*\*25€\*\* – added to your store balance[\s\S]*Balance can't be refunded or paid out/);
  assert.match(before, /Pay 25€ – PaysafeCard\n-# Order `#\d+` · Balance top-up 25€\n/);
  assert.match(before, /we check your payment and add it to your store balance\. Balance can't be refunded or paid out/);
  assert.equal(shop.ticketProduct(guild.id, ticket), null, 'no product');

  // Pay → "on its way" → staff confirm → credited, completed.
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  assert.match(texts(channel), /Your top-up is on its way![\s\S]*\*\*25€\*\* is added to your store balance/);
  assert.match(textOf(channel.messageList.at(-1).body), /Payment OK – credit balance/);
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(said(ok), /\*\*25€\*\* was added to <@\d+>'s store balance and the top-up is completed/);
  assert.equal(balance.get(guild.id, buyer.id), 25);
  const done = db.getTicket(ticket.channelId);
  assert.ok(done.completedAt);
  assert.equal(done.order.topUp.credited, 25);
  assert.equal(done.order.delivered, undefined, 'nothing was delivered');
  const all = texts(channel);
  assert.match(all, /Balance topped up![\s\S]*\*\*25€\*\* was added to your store balance – you now have \*\*25€\*\*/);
  assert.ok(!channel.messageList.some((m) => customIds(m.body).includes('vouch:open')), 'no vouch for a top-up');

  const receipt = guild.dms.filter((d) => d.to === buyer.id).map((d) => textOf(d.payload)).find((x) => /receipt/.test(x));
  assert.match(receipt, /\*\*Top-up:\*\* 💰 25€ added to your store balance[\s\S]*Balance can't be refunded or paid out/);
  assert.doesNotMatch(receipt, /Happy with your order/);
  const proofs = guild.channels.cache.get(db.channelId(guild.id, 'proofs'));
  assert.ok(!proofs.messageList.some((m) => /Balance top-up/.test(textOf(m.body))), 'no #proofs post');
  assert.equal(db.guild(guild.id).reminders[ticket.channelId], undefined, 'no vouch reminder');
  assert.equal(db.guild(guild.id).orders[buyer.id] ?? 0, 0, "a top-up doesn't count as an order");
  const sum = sales.summarize(guild.id, { from: 0, to: Date.now() + 1000 });
  assert.deepEqual([sum.orders, sum.revenue, sum.topUps.count, sum.topUps.amount], [0, 0, 1, 25]);

  // Once: it can't be completed or confirmed again.
  const again = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(said(again), /already completed – the balance was credited|already marked as completed/);
  await assert.rejects(() => t.completeOrder(channel, seller), /already marked as completed/);
  assert.equal(balance.get(guild.id, buyer.id), 25);
  assert.equal(balance.history(guild.id, buyer.id).length, 1);
  assert.equal(balance.history(guild.id, buyer.id)[0].ref, ticket.channelId);
});

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
      return json({ id: 'cs_top', url: 'https://checkout.stripe.com/c/pay/cs_top', status: 'open', payment_status: 'unpaid', currency: 'eur', amount_total: amount, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    return json({ id: 'cs_top', status: 'complete', payment_status: 'paid', currency: 'eur', amount_total: amount, payment_intent: 'pi_top' });
  };
  return () => (global.fetch = real);
}

test('A top-up paid with Stripe is credited automatically – once, even if the payment is reported again', async () => {
  const guild = await builtGuild();
  const buyer = member(guild);
  const prev = env.stripeKey;
  env.stripeKey = 'sk_test_topup';
  const restore = fakeStripe();
  try {
    await run({ guild, member: buyer, kind: 'modal', customId: 'balance:topupform', fields: { amount: '40' }, selects: { payment: [METHOD('stripe')] } });
    const ticket = lastTicket(guild, buyer);
    const channel = guild.channels.cache.get(ticket.channelId);
    assert.match(texts(channel), /Once you've paid, the amount is added to your store balance automatically\. Balance can't be refunded or paid out/);
    await stripe.checkPayments(guild.client);
    const all = texts(channel);
    assert.match(all, /Stripe payment received – 40€[\s\S]*💰 The balance is credited automatically/);
    assert.match(all, /Topping up your balance[\s\S]*\*\*40€\*\* is being added/);
    assert.equal(balance.get(guild.id, buyer.id), 40);
    assert.ok(db.getTicket(ticket.channelId).completedAt);

    // Reported once more (a second check, a repeated webhook) – never credited twice.
    await stripe.checkPayments(guild.client);
    const latest = db.getTicket(ticket.channelId);
    await autopay.paymentReceived(guild, latest, { gateway: 'Stripe', paidAmount: 40, paidCurrency: 'eur', expectedCurrency: 'eur', reference: 'pi_top', before: autopay.statusBefore(latest) });
    assert.match(textOf(channel.messageList.at(-1).body), /already \*\*completed\*\* – the customer may have paid twice/);
    assert.equal(balance.get(guild.id, buyer.id), 40);
    assert.equal(balance.history(guild.id, buyer.id).length, 1);
  } finally {
    restore();
    env.stripeKey = prev;
  }
});

// ───────────── Paying with balance ─────────────

test('Pay with store balance: offered when it covers the price, taken at once – Paid and delivered instantly; not enough → refused, nothing taken', async () => {
  const guild = await builtGuild();
  const netflix = await deliverable(guild, 'Netflix Premium', '12');
  const buyer = member(guild);
  balance.change(guild.id, buyer.id, 10, { reason: 'test' });
  assert.ok(!(await formOptions(guild, buyer, netflix)).some((o) => o.value === 'balance'), 'not offered below the price');
  balance.change(guild.id, buyer.id, 20, { reason: 'test' });
  const offered = (await formOptions(guild, buyer, netflix)).find((o) => o.value === 'balance');
  assert.equal(offered.label, 'Store balance (30€ available)');

  const paid = await buy(guild, buyer, netflix, { quantity: '2' });
  assert.match(said(paid), /Paid with store balance: \*\*24€\*\* – 6€ left/);
  assert.doesNotMatch(said(paid), /Never pay anyone in DMs/);
  assert.equal(balance.get(guild.id, buyer.id), 6);
  const ticket = db.getTicket(lastTicket(guild, buyer).channelId);
  assert.deepEqual([ticket.order.paidWith, ticket.order.method, ticket.order.total], ['balance', 'Store balance', 24]);
  assert.deepEqual(balance.history(guild.id, buyer.id)[0], { at: balance.history(guild.id, buyer.id)[0].at, change: -24, reason: `Order #${String(ticket.number).padStart(4, '0')}`, by: buyer.id, ref: ticket.channelId });

  const channel = guild.channels.cache.get(ticket.channelId);
  const all = texts(channel);
  assert.match(all, /Paid\*\*\n> 💰 With store balance – Balance can't be refunded or paid out/);
  assert.match(all, /Paid with store balance – 24€\*\* for order `#\d+`\. Balance left: \*\*6€\*\*\. 📦 The product is delivered automatically/);
  assert.match(all, /Your product – Netflix Premium[\s\S]*NETFLIX-PREMIUM-CODE/);
  assert.doesNotMatch(all, /Pay 24€/, 'no payment card');
  assert.ok(ticket.completedAt, 'completed by the instant delivery');
  const sale = db.sales(guild.id).at(-1);
  assert.deepEqual([sale.amount, sale.method, sale.paidWith], [24, 'Store balance', 'balance']);
  assert.deepEqual(sales.summarize(guild.id, { from: 0, to: Date.now() + 1000 }).methods.map((m) => m.name), ['Store balance']);
  assert.match(textOf(logChannel(guild).messageList.find((m) => /Paid with store balance/.test(textOf(m.body))).body), /24€[\s\S]*6€/);

  // Not enough (a forged menu value too) → refused, nothing taken, no ticket.
  const tickets = db.tickets((x) => x.ownerId === buyer.id).length;
  const short = await buy(guild, buyer, netflix);
  assert.match(said(short), /Not enough store balance: you have \*\*6€\*\*, this order is \*\*12€\*\*/);
  assert.equal(balance.get(guild.id, buyer.id), 6);
  assert.equal(db.tickets((x) => x.ownerId === buyer.id).length, tickets);

  // A product without a fixed price can't be paid with balance; a promo code that doesn't work stops it too.
  const custom = shop.addProduct(guild, { name: 'Custom Logo', price: 'Ask us', description: 'Made for you.' });
  assert.match(said(await buy(guild, buyer, custom)), /no fixed price yet, so it can't be paid with store balance/);
  const cheap = shop.addProduct(guild, { name: 'Sticker', price: '2', description: 'Tiny.' });
  assert.match(said(await buy(guild, buyer, cheap, { promo: 'NOPE' })), /Promo code \*\*NOPE\*\* can't be used/);
  assert.equal(balance.get(guild.id, buyer.id), 6);
});

test("Two orders at the same moment can't spend the same balance", async () => {
  const guild = await builtGuild();
  const a = shop.addProduct(guild, { name: 'Game A', price: '12', description: 'A game.' });
  const b = shop.addProduct(guild, { name: 'Game B', price: '12', description: 'Another game.' });
  const buyer = member(guild);
  balance.change(guild.id, buyer.id, 15, { reason: 'test' });
  const [one, two] = await Promise.all([buy(guild, buyer, a), buy(guild, buyer, b)]);
  const answers = [said(one), said(two)];
  assert.equal(answers.filter((x) => /Paid with store balance: \*\*12€\*\*/.test(x)).length, 1);
  assert.equal(answers.filter((x) => /Not enough store balance: you have \*\*3€\*\*/.test(x)).length, 1);
  assert.equal(balance.get(guild.id, buyer.id), 3);
  assert.equal(db.tickets((x) => x.ownerId === buyer.id).length, 1);
});

test("An order that can't be placed gives the balance straight back; a closed order paid with balance is not refunded", async () => {
  const guild = await builtGuild();
  const product = shop.addProduct(guild, { name: 'Custom Logo', price: '12', description: 'Made by hand.' });
  const buyer = member(guild);
  const seller = member(guild, ['member', 'seller']);
  balance.change(guild.id, buyer.id, 30, { reason: 'test' });

  const real = t.openTicket;
  t.openTicket = async () => {
    throw new UserError('Our ticket system is full right now – please try again in a few minutes or contact the staff.');
  };
  try {
    assert.match(said(await buy(guild, buyer, product)), /ticket system is full/);
  } finally {
    t.openTicket = real;
  }
  assert.equal(balance.get(guild.id, buyer.id), 30);
  assert.deepEqual(balance.history(guild.id, buyer.id).slice(0, 2).map((h) => [h.change, h.reason]), [
    [12, 'Order could not be placed – returned'],
    [-12, 'Order'],
  ]);

  // Paid with balance, delivered by hand – the team is pinged; closing it gives nothing back (no refunds).
  await buy(guild, buyer, product);
  const ticket = lastTicket(guild, buyer);
  const channel = guild.channels.cache.get(ticket.channelId);
  assert.equal(statusOf(ticket), 'paid');
  assert.match(texts(channel), /Paid with store balance – 12€[\s\S]*please deliver it/);
  assert.equal(ticket.completedAt, null);
  await t.closeTicket(channel, seller, 'Customer changed their mind');
  assert.equal(balance.get(guild.id, buyer.id), 18, 'not refunded – staff can use /balance add');
});

test('Cart checkout with store balance: the whole cart is paid at once and delivered; not enough → refused and the cart stays', async () => {
  const guild = await builtGuild();
  const key = await deliverable(guild, 'Game Key', '15');
  const nitro = await deliverable(guild, 'Nitro Boost', '7');
  const buyer = member(guild);
  balance.change(guild.id, buyer.id, 50, { reason: 'test' });
  for (const p of [key, nitro]) await run({ guild, member: buyer, kind: 'modal', customId: `cart:addform:${p.id}:s`, fields: { quantity: '1' } });

  const open = await run({ guild, member: buyer, kind: 'button', customId: 'cart:checkout', message: privateMsg });
  const form = open.state.modals[0];
  const options = form.components.find((c) => c.component?.custom_id === 'payment').component.options;
  assert.equal(options.at(-1).label, 'Store balance (50€ available)');
  const placed = await run({ guild, member: buyer, kind: 'modal', customId: form.custom_id, fields: {}, selects: { payment: ['balance'] }, message: privateMsg });
  assert.match(said(placed), /Paid with store balance: \*\*22€\*\* – 28€ left/);
  const ticket = db.getTicket(lastTicket(guild, buyer).channelId);
  assert.equal(ticket.order.paidWith, 'balance');
  assert.ok(ticket.completedAt);
  const all = texts(guild.channels.cache.get(ticket.channelId));
  assert.match(all, /GAME-KEY-CODE[\s\S]*NITRO-BOOST-CODE/);
  assert.equal(balance.get(guild.id, buyer.id), 28);

  // Another member without enough: not offered, and a forged choice is refused – the cart stays as it was.
  const poor = member(guild);
  balance.change(guild.id, poor.id, 5, { reason: 'test' });
  await run({ guild, member: poor, kind: 'modal', customId: `cart:addform:${key.id}:s`, fields: { quantity: '1' } });
  const poorForm = (await run({ guild, member: poor, kind: 'button', customId: 'cart:checkout', message: privateMsg })).state.modals[0];
  assert.ok(!poorForm.components.find((c) => c.component?.custom_id === 'payment').component.options.some((o) => o.value === 'balance'));
  const refused = await run({ guild, member: poor, kind: 'modal', customId: poorForm.custom_id, fields: {}, selects: { payment: ['balance'] }, message: privateMsg });
  assert.match(said(refused), /Not enough store balance: you have \*\*5€\*\*, this order is \*\*15€\*\*/);
  assert.equal(balance.get(guild.id, poor.id), 5);
  assert.equal(db.guild(guild.id).carts[poor.id].items.length, 1, 'the cart is kept');
});
