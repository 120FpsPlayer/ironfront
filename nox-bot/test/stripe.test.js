'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const stripe = require('../src/features/stripe');
const orderstatus = require('../src/features/orderstatus');
const t = require('../src/tickets/tickets');
const { env } = require('../src/env');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 995000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const STRIPE = String(config.shop.paymentMethods.findIndex((m) => m.stripe));
const KEY = 'sk_test_nox';

/** A pretend Stripe API: Checkout Sessions you can pay or let expire. */
function fakeStripe() {
  const sessions = new Map();
  const calls = [];
  let seq = 0;
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api.stripe.com');
    assert.equal(opts.headers.Authorization, `Bearer ${KEY}`);
    const params = Object.fromEntries(new URLSearchParams(opts.body ?? ''));
    calls.push({ method: opts.method, path: u.pathname, params, idempotencyKey: opts.headers['Idempotency-Key'] ?? null });
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (opts.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      seq += 1;
      const s = { id: `cs_test_${seq}`, url: `https://checkout.stripe.com/c/pay/cs_test_${seq}`, status: 'open', payment_status: 'unpaid', amount_total: Number(params['line_items[0][price_data][unit_amount]']), expires_at: Number(params.expires_at), payment_intent: null };
      sessions.set(s.id, s);
      return json(200, s);
    }
    const m = /^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(u.pathname);
    const s = m && sessions.get(m[1]);
    if (!s) return json(404, { error: { message: 'No such checkout session' } });
    if (m[2]) s.status = 'expired';
    return json(200, s);
  };
  const pay = (id, amount) => Object.assign(sessions.get(id), { status: 'complete', payment_status: 'paid', payment_intent: `pi_${id}`, ...(amount != null && { amount_total: amount }) });
  return { sessions, calls, pay, restore: () => (global.fetch = realFetch) };
}

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.', emoji: '📺' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, product, { quantity = '2', payment = STRIPE } = {}) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity }, selects: { payment: [payment] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const withKey = async (fn) => {
  const prev = env.stripeKey;
  env.stripeKey = KEY;
  const api = fakeStripe();
  try {
    await fn(api);
  } finally {
    api.restore();
    env.stripeKey = prev;
  }
};

const stripeCard = (channel) => channel.messageList.find((m) => m.id === db.getTicket(channel.id).order?.stripe?.messageId);

test('Stripe is a payment method in the shop and the order form', async () => {
  const { guild, product } = await shopGuild();
  const methods = config.shop.paymentMethods.map((m) => m.name);
  assert.ok(methods.includes('Stripe'));
  const modal = shop.orderModal(product, guild).toJSON();
  const payment = modal.components.find((c) => c.component?.custom_id === 'payment').component;
  assert.ok(payment.options.some((o) => o.label === 'Stripe' && /Card, Apple Pay or Google Pay/.test(o.description)));
  assert.match(textOf(shop.shopPanel(guild)), /We accept: PaysafeCard · Crypto · PayPal · Stripe/);
  assert.equal(stripe.currency(), 'eur', '€ → eur');
});

test('without a key: no payment link, the order works like any other (I\'ve paid stays)', async () => {
  const { guild, product } = await shopGuild();
  const prev = env.stripeKey;
  env.stripeKey = '';
  const realFetch = global.fetch;
  global.fetch = async () => assert.fail('no Stripe call without a key');
  try {
    const { ticket } = await order(guild, member(guild), product);
    assert.equal(ticket().order.method, 'Stripe');
    assert.equal(ticket().order.stripe, undefined);
    const card = ticket().controlMessageId;
    assert.ok(card);
  } finally {
    global.fetch = realFetch;
    env.stripeKey = prev;
  }
});

test('with a key: a Stripe order gets a payment link for its total right away – paid → Paid, seller pinged, DM, log', async () => {
  await withKey(async (api) => {
    const { guild, product, seller } = await shopGuild();
    const buyer = member(guild);
    const { channel, ticket } = await order(guild, buyer, product, { quantity: '2' });

    // The session: 24€ in cents, euro, back to the ticket, our IDs as metadata, ~23 h
    const create = api.calls.find((c) => c.method === 'POST' && c.path === '/v1/checkout/sessions');
    assert.equal(create.params.mode, 'payment');
    assert.equal(create.params['line_items[0][price_data][unit_amount]'], '2400');
    assert.equal(create.params['line_items[0][price_data][currency]'], 'eur');
    assert.match(create.params['line_items[0][price_data][product_data][name]'], /^NØX order #\d{4} – Netflix Premium × 2$/);
    assert.equal(create.params.success_url, `https://discord.com/channels/${guild.id}/${channel.id}`);
    assert.equal(create.params['metadata[channelId]'], channel.id);
    assert.equal(create.params.client_reference_id, channel.id);
    assert.ok(Number(create.params.expires_at) * 1000 - Date.now() > 22 * 3_600_000);
    assert.equal(create.idempotencyKey, `nox-${channel.id}-1`, 'a retry never makes a second session');

    // The card in the ticket: Pay 24€ link + New link; I've paid is gone from the order card
    const s = ticket().order.stripe;
    assert.deepEqual([s.status, s.amount, s.sessionId], ['open', 24, 'cs_test_1']);
    const card = stripeCard(channel);
    validateMessage(card.body ?? card, guild);
    assert.match(textOf(card.body ?? card), /Pay by card – Stripe[\s\S]*24€/);
    const links = JSON.stringify((card.body ?? card).components.map((c) => c.toJSON?.() ?? c));
    assert.ok(links.includes('https://checkout.stripe.com/c/pay/cs_test_1'));
    assert.ok(links.includes('Pay 24€'));
    const control = channel.messageList.find((m) => m.id === ticket().controlMessageId);
    assert.ok(!customIds(control.body ?? control).includes('pay:open'), "no I've paid with a Stripe link");

    // Not paid yet → nothing happens
    await stripe.checkPayments(guild.client);
    assert.equal(statusOf(ticket()), 'awaiting');

    // Paid on Stripe → Paid, card updated, sellers pinged (only them), log without secrets
    api.pay('cs_test_1');
    const before = channel.messageList.length;
    await stripe.checkPayments(guild.client);
    assert.equal(statusOf(ticket()), 'paid');
    assert.equal(ticket().order.stripe.status, 'paid');
    assert.equal(ticket().order.stripe.paymentIntent, 'pi_cs_test_1');
    assert.match(textOf(stripeCard(channel).body ?? stripeCard(channel)), /Paid with Stripe[\s\S]*24€/);
    const posted = channel.messageList.slice(before).map((m) => m.body ?? m);
    const ping = posted.find((p) => /Stripe payment received – 24€/.test(textOf(p)));
    assert.ok(ping);
    assert.deepEqual(ping.allowedMentions, { users: [], roles: [role(guild, 'seller')] });
    const log = guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1);
    const logText = JSON.stringify(log.body ?? log);
    assert.match(logText, /Stripe payment received/);
    assert.ok(!logText.includes(KEY));

    // Checked again → nothing twice
    const count = channel.messageList.length;
    await stripe.checkPayments(guild.client);
    assert.equal(channel.messageList.length, count);

    // Completing the order works as usual – pre-filled with the total
    const { sale } = await t.completeOrder(channel, seller);
    assert.equal(sale.amount, 24);
    assert.equal(sale.method, 'Stripe');
  });
});

test('an expired link offers a new one; New link makes a fresh session and stops the old one – customer or staff only', async () => {
  await withKey(async (api) => {
    const { guild, product } = await shopGuild();
    const buyer = member(guild);
    const { channel, ticket } = await order(guild, buyer, product);
    api.sessions.get('cs_test_1').status = 'expired';
    await stripe.checkPayments(guild.client);
    assert.equal(ticket().order.stripe.status, 'expired');
    assert.ok(customIds(stripeCard(channel).body ?? stripeCard(channel)).includes('stripe:new'));
    assert.match(textOf(stripeCard(channel).body ?? stripeCard(channel)), /Payment link expired/);

    const stranger = await run({ guild, member: member(guild), kind: 'button', customId: 'stripe:new', channel });
    assert.match(textOf(lastResponse(stranger)), /Only the customer or the team/);

    const again = await run({ guild, member: buyer, kind: 'button', customId: 'stripe:new', channel });
    assert.match(textOf(lastResponse(again)), /new payment link for \*\*24€\*\*/);
    assert.equal(ticket().order.stripe.sessionId, 'cs_test_2');
    assert.equal(ticket().order.stripe.attempt, 2);
    assert.equal(api.calls.filter((c) => c.path === '/v1/checkout/sessions').at(-1).idempotencyKey, `nox-${channel.id}-2`);

    // Straight away again → cooldown
    const spam = await run({ guild, member: buyer, kind: 'button', customId: 'stripe:new', channel });
    assert.match(textOf(lastResponse(spam)), /A new link was just made/);
    assert.equal(api.sessions.size, 2);
  });
});

test('paid some other way, or the ticket closed → the open link is stopped so nobody pays twice', async () => {
  await withKey(async (api) => {
    const { guild, product, seller } = await shopGuild();
    const first = await order(guild, member(guild), product);
    await orderstatus.setStatus(first.channel, 'paid', seller);
    assert.ok(api.calls.some((c) => c.path === '/v1/checkout/sessions/cs_test_1/expire'));
    assert.equal(first.ticket().order.stripe.status, 'expired');

    const second = await order(guild, member(guild), product);
    await t.closeTicket(second.channel, seller, 'Changed their mind');
    await stripe.checkPayments(guild.client);
    assert.ok(api.calls.some((c) => c.path === '/v1/checkout/sessions/cs_test_2/expire'));
    assert.equal(second.ticket().order.stripe.status, 'expired');
  });
});

test('a payment that comes in after the ticket was closed is still recorded and the team is told', async () => {
  await withKey(async (api) => {
    const { guild, product, seller } = await shopGuild();
    const { channel, ticket } = await order(guild, member(guild), product);
    await t.closeTicket(channel, seller, 'No answer');
    api.pay('cs_test_1');
    await stripe.checkPayments(guild.client);
    assert.equal(ticket().order.stripe.status, 'paid');
    assert.ok(channel.messageList.some((m) => /reopen it to deliver/.test(textOf(m.body ?? m))));
  });
});

test('other payment methods, no fixed total or a refused key → no link, a clear note, nothing breaks', async () => {
  await withKey(async (api) => {
    const { guild, product } = await shopGuild();
    await order(guild, member(guild), product, { payment: '0' });
    assert.equal(api.calls.length, 0, 'PaysafeCard → no Stripe call');

    const custom = shop.addProduct(guild, { name: 'Custom bundle', price: 'from 5€', description: 'Ask us.' });
    const { channel } = await order(guild, member(guild), custom, { quantity: '1' });
    assert.equal(api.calls.length, 0);
    assert.ok(channel.messageList.some((m) => /sends you the Stripe payment link once the final price is confirmed/.test(textOf(m.body ?? m))));

    // Stripe down / refusing → the customer is told a seller sends a link, the order is still there
    global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) });
    const failed = await order(guild, member(guild), product);
    assert.equal(failed.ticket().order.stripe, undefined);
    assert.ok(failed.channel.messageList.some((m) => /link couldn't be made right now/.test(textOf(m.body ?? m))));
  });
});
