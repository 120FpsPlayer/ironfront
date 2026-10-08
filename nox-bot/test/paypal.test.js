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
const paypal = require('../src/features/paypal');
const orderstatus = require('../src/features/orderstatus');
const t = require('../src/tickets/tickets');
const { env } = require('../src/env');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 997000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const PAYPAL = String(config.shop.paymentMethods.findIndex((m) => m.type === 'paypal'));

/** A pretend PayPal API: orders the customer can approve; money only moves on capture. */
function fakePaypal() {
  const orders = new Map();
  const calls = [];
  let seq = 0;
  let failNextCreate = false;
  let refuse = false;
  let declineCapture = false;
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    assert.equal(u.origin, 'https://api-m.paypal.com');
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    const body = opts.body && opts.headers['Content-Type'] === 'application/json' ? JSON.parse(opts.body) : null;
    calls.push({ method: opts.method, path: u.pathname, body, requestId: opts.headers['PayPal-Request-Id'] ?? null });
    if (u.pathname === '/v1/oauth2/token') {
      if (refuse) return json(401, { error: 'invalid_client', error_description: 'Client Authentication failed' });
      assert.equal(opts.headers.Authorization, `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`);
      return json(200, { access_token: 'A21-token', expires_in: 32000 });
    }
    assert.equal(opts.headers.Authorization, 'Bearer A21-token');
    if (opts.method === 'POST' && u.pathname === '/v2/checkout/orders') {
      seq += 1;
      const o = { id: `PP${seq}`, status: 'PAYER_ACTION_REQUIRED', amount: body.purchase_units[0].amount, links: [{ rel: 'payer-action', href: `https://www.paypal.com/checkoutnow?token=PP${seq}` }] };
      orders.set(o.id, o);
      if (failNextCreate) {
        failNextCreate = false;
        throw new Error('socket hang up');
      }
      return json(201, o);
    }
    const m = /^\/v2\/checkout\/orders\/([^/]+)(\/capture)?$/.exec(u.pathname);
    const o = m && orders.get(m[1]);
    if (!o) return json(404, { name: 'RESOURCE_NOT_FOUND', details: [{ issue: 'INVALID_RESOURCE_ID' }] });
    if (m[2]) {
      if (o.status === 'COMPLETED') return json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_ALREADY_CAPTURED' }] });
      if (o.status !== 'APPROVED') return json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'ORDER_NOT_APPROVED' }] });
      if (declineCapture) return json(422, { name: 'UNPROCESSABLE_ENTITY', details: [{ issue: 'INSTRUMENT_DECLINED' }] });
      o.status = 'COMPLETED';
      o.purchase_units = [{ payments: { captures: [{ id: `CAP-${o.id}`, status: 'COMPLETED', amount: o.amount }] } }];
    }
    return json(200, { ...o, links: o.links });
  };
  return {
    orders,
    calls,
    approve: (id) => (orders.get(id).status = 'APPROVED'),
    captures: () => calls.filter((c) => c.path.endsWith('/capture')),
    failNextCreate: () => (failNextCreate = true),
    refuse: (on = true) => (refuse = on),
    declineCapture: (on = true) => (declineCapture = on),
    restore: () => (global.fetch = real),
  };
}

const withKeys = async (fn) => {
  const prev = { id: env.paypalClientId, secret: env.paypalSecret };
  env.paypalClientId = 'client-id';
  env.paypalSecret = 'client-secret';
  const api = fakePaypal();
  try {
    await fn(api);
  } finally {
    api.restore();
    env.paypalClientId = prev.id;
    env.paypalSecret = prev.secret;
  }
};

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, product, { quantity = '2' } = {}) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity }, selects: { payment: [PAYPAL] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const card = (channel) => {
  const m = channel.messageList.find((x) => x.id === db.getTicket(channel.id).order?.paypal?.messageId);
  return m?.body ?? m;
};
const said = (channel, re) => channel.messageList.some((m) => re.test(textOf(m.body ?? m)));

test('with PayPal keys: a PayPal link for the order total; approved → the bot takes the money → Paid, seller pinged', async () => {
  await withKeys(async (api) => {
    const { guild, product, seller } = await shopGuild();
    const { channel, ticket } = await order(guild, member(guild), product);

    const create = api.calls.find((c) => c.path === '/v2/checkout/orders');
    assert.equal(create.body.intent, 'CAPTURE');
    assert.deepEqual(create.body.purchase_units[0].amount, { currency_code: 'EUR', value: '24.00' });
    assert.equal(create.body.purchase_units[0].custom_id, channel.id);
    assert.equal(create.body.payment_source.paypal.experience_context.return_url, `https://discord.com/channels/${guild.id}/${channel.id}`);
    assert.equal(create.requestId, `nox-${channel.id}-1`);

    const c = card(channel);
    validateMessage(c, guild);
    assert.match(textOf(c), /Pay 24€ – PayPal/);
    assert.ok(JSON.stringify(c.components.map((x) => x.toJSON?.() ?? x)).includes('https://www.paypal.com/checkoutnow?token=PP1'));
    assert.ok(!said(channel, /Buy a \*\*PaysafeCard|paypal\.me/), 'no manual card');
    const control = channel.messageList.find((m) => m.id === ticket().controlMessageId);
    assert.ok(!customIds(control.body ?? control).includes('pay:open'), "no I've paid with a PayPal link");

    await paypal.checkPayments(guild.client);
    assert.equal(api.captures().length, 0, 'nothing is taken before the customer approves');
    assert.equal(statusOf(ticket()), 'awaiting');

    api.approve('PP1');
    await paypal.checkPayments(guild.client);
    assert.equal(api.captures().length, 1);
    assert.equal(api.captures()[0].requestId, 'nox-capture-PP1', 'the same id every time – never taken twice');
    assert.equal(ticket().order.paypal.status, 'paid');
    assert.equal(ticket().order.paypal.captureId, 'CAP-PP1');
    assert.equal(statusOf(ticket()), 'paid');
    assert.match(textOf(card(channel)), /Paid with PayPal/);
    const ping = channel.messageList.map((m) => m.body ?? m).find((b) => /PayPal payment received – 24€/.test(textOf(b)));
    assert.deepEqual(ping.allowedMentions, { users: [], roles: [role(guild, 'seller')] });

    await paypal.checkPayments(guild.client);
    assert.equal(api.captures().length, 1, 'checked again → nothing twice');
    const { sale } = await t.completeOrder(channel, seller);
    assert.equal(sale.amount, 24);
  });
});

test('approved after the ticket was closed, paid another way or with a changed total → the money is never taken', async () => {
  await withKeys(async (api) => {
    const { guild, product, seller } = await shopGuild();

    const closed = await order(guild, member(guild), product);
    await t.closeTicket(closed.channel, seller, 'Changed their mind');
    api.approve('PP1');
    await paypal.checkPayments(guild.client);
    assert.equal(api.captures().length, 0);
    assert.equal(closed.ticket().order.paypal.status, 'expired');

    const other = await order(guild, member(guild), product);
    api.approve('PP2');
    await orderstatus.setStatus(other.channel, 'paid', seller); // paid by PaysafeCard after all
    assert.equal(api.captures().length, 0);
    assert.equal(other.ticket().order.paypal.status, 'expired');

    const changed = await order(guild, member(guild), product);
    db.updateTicket(changed.channel.id, { order: { ...changed.ticket().order, total: 30 } }); // e.g. a promo code dropped on reopen
    api.approve('PP3');
    await paypal.checkPayments(guild.client);
    assert.equal(api.captures().length, 0);
    assert.equal(changed.ticket().order.paypal.status, 'expired');
    assert.ok(said(changed.channel, /total changed to \*\*30€\*\* – the old PayPal link wasn't charged/));
    assert.ok(customIds(card(changed.channel)).includes('paypal:new'));
  });
});

test('New link: an approved link is taken instead of replaced; an unapproved one is replaced with a fresh request id', async () => {
  await withKeys(async (api) => {
    const { guild, product } = await shopGuild();
    const buyer = member(guild);
    const first = await order(guild, buyer, product);
    api.approve('PP1');
    const i = await run({ guild, member: buyer, kind: 'button', customId: 'paypal:new', channel: first.channel });
    assert.match(textOf(lastResponse(i)), /Your payment just came in/);
    assert.equal(first.ticket().order.paypal.status, 'paid');
    assert.equal(api.orders.size, 1);

    const buyer2 = member(guild);
    const second = await order(guild, buyer2, product);
    const j = await run({ guild, member: buyer2, kind: 'button', customId: 'paypal:new', channel: second.channel });
    assert.match(textOf(lastResponse(j)), /new PayPal link for \*\*24€\*\*/);
    assert.equal(second.ticket().order.paypal.orderId, 'PP3');
    const ids = api.calls.filter((c) => c.path === '/v2/checkout/orders').map((c) => c.requestId);
    assert.deepEqual(ids.slice(-2), [`nox-${second.channel.id}-1`, `nox-${second.channel.id}-2`]);

    const stranger = await run({ guild, member: member(guild), kind: 'button', customId: 'paypal:new', channel: second.channel });
    assert.match(textOf(lastResponse(stranger)), /Only the customer or the team/);
  });
});

test('a declined card stays payable on the same link; refused keys are reported once and I\'ve paid comes back', async () => {
  await withKeys(async (api) => {
    const { guild, product } = await shopGuild();
    const { ticket } = await order(guild, member(guild), product);
    api.approve('PP1');
    api.declineCapture();
    await paypal.checkPayments(guild.client);
    assert.equal(ticket().order.paypal.status, 'open');
    api.declineCapture(false);

    // A new token is needed and the keys are refused
    api.refuse();
    const logs = guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList;
    const before = logs.length;
    // Force a token refresh: pretend the token ran out
    const prevNow = Date.now;
    Date.now = () => prevNow() + 40_000_000;
    try {
      await paypal.checkPayments(guild.client);
      await paypal.checkPayments(guild.client);
    } finally {
      Date.now = prevNow;
    }
    const warnings = logs.slice(before).filter((m) => /PayPal refused the keys/.test(JSON.stringify(m.body ?? m)));
    assert.equal(warnings.length, 1);
    assert.equal(paypal.confirmsItself(ticket()), false);
    api.refuse(false);
  });
});

test('PayPal down or a currency PayPal doesn\'t take → the manual PayPal card instead', async () => {
  await withKeys(async (api) => {
    const { guild, product } = await shopGuild();
    api.failNextCreate();
    const { channel, ticket } = await order(guild, member(guild), product);
    assert.equal(ticket().order.paypal, undefined);
    assert.ok(said(channel, /Pay 24€ – PayPal[\s\S]*PayPal address/), 'the manual card');

    const prev = config.paypal.currency;
    config.paypal.currency = 'krw';
    try {
      assert.equal(paypal.currency(), null);
      assert.equal(paypal.enabled(), false);
      const before = api.calls.length;
      const second = await order(guild, member(guild), product);
      assert.equal(api.calls.length, before, 'no PayPal call');
      assert.ok(said(second.channel, /PayPal address/));
    } finally {
      config.paypal.currency = prev;
    }
  });
});
