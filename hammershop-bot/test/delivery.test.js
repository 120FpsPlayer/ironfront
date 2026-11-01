'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const stripe = require('../src/features/stripe');
const { env } = require('../src/env');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 998000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const METHOD = (type) => String(config.shop.paymentMethods.findIndex((m) => m.type === type));
const KEY = 'sk_test_delivery';

/** Fake network: the uploaded file, and a Stripe that says the link is paid. */
function fakeNet(uploads) {
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const file = uploads.find((u) => u.url === url);
    if (file) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(file.bytes).buffer };
    const u = new URL(url);
    if (u.origin === 'https://api.stripe.com') {
      const json = (body) => ({ ok: true, status: 200, json: async () => body });
      if (opts.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
        const amount = Number(new URLSearchParams(opts.body).get('line_items[0][price_data][unit_amount]'));
        return json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1', status: 'open', payment_status: 'unpaid', currency: 'eur', amount_total: amount, expires_at: Math.floor(Date.now() / 1000) + 3600 });
      }
      return json({ id: 'cs_1', status: 'complete', payment_status: 'paid', currency: 'eur', amount_total: 2400, payment_intent: 'pi_1' });
    }
    throw new Error(`No network in tests: ${url}`);
  };
  return () => (global.fetch = real);
}

async function setup() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const owner = guild.members.cache.get(guild.ownerId);
  const product = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.' });
  const upload = { url: 'https://cdn.discordapp.com/attachments/1/2/account.txt', name: 'account.txt', contentType: 'text/plain', size: 22, bytes: Buffer.from('user: nox\npass: secret') };
  const restore = fakeNet([upload]);
  try {
    const i = await run({ guild, member: owner, kind: 'command', commandName: 'product', subcommand: 'delivery', options: { product: product.id, file: upload, text: 'Login at netflix.com' } });
    assert.match(textOf(lastResponse(i)), /account\.txt[\s\S]*text/);
  } finally {
    restore();
  }
  return { guild, product: shop.findProduct(guild.id, product.id), seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, product, type) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '2' }, selects: { payment: [METHOD(type)] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id)[0];
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const texts = (channel) => channel.messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');
const fileNames = (payload) => (payload.files ?? []).map((f) => f.name ?? f.attachment?.name);

test('/product delivery stores the files and text; the shop shows instant delivery with Stripe on', async () => {
  const { product } = await setup();
  assert.deepEqual(product.delivery.files.map((f) => f.name), ['account.txt']);
  assert.equal(product.delivery.text, 'Login at netflix.com');
});

test('Stripe: paid → "on the way" → the product in the ticket and by DM → the order is completed', async () => {
  const { guild, product } = await setup();
  const buyer = member(guild);
  const prev = env.stripeKey;
  env.stripeKey = KEY;
  const restore = fakeNet([]);
  try {
    const { channel, ticket } = await order(guild, buyer, product, 'stripe');
    assert.match(texts(channel), /Instant delivery:\*\* your product arrives right here[\s\S]*1–5 minutes/);
    await stripe.checkPayments(guild.client);
    const all = texts(channel);
    assert.match(all, /📦 The product is delivered automatically/);
    assert.match(all, /Your product is on the way![\s\S]*Payment received/);
    assert.match(all, /Your product – Netflix Premium[\s\S]*Login at netflix\.com/);
    const productMsg = channel.messageList.find((m) => /Your product – /.test(textOf(m.body ?? m)));
    assert.deepEqual(fileNames(productMsg.body ?? productMsg), ['account.txt']);
    const dm = guild.dms.find((d) => d.to === buyer.id && /Your product – /.test(textOf(d.payload)));
    assert.ok(dm, 'sent by DM too');
    assert.deepEqual(fileNames(dm.payload), ['account.txt']);
    assert.ok(ticket().completedAt, 'order completed');
    assert.equal(statusOf(ticket()), 'delivered');
    assert.equal(ticket().order.delivered.auto, true);
    assert.equal(db.sales(guild.id).at(-1).amount, 24);
  } finally {
    restore();
    env.stripeKey = prev;
  }
});

test('PaysafeCard: I\'ve paid → "on the way"; staff click Payment OK – deliver → the product, once', async () => {
  const { guild, product, seller } = await setup();
  const buyer = member(guild);
  const { channel, ticket } = await order(guild, buyer, product, 'paysafecard');
  assert.match(texts(channel), /After you click \*\*Pay\*\*, we check your payment and send your product/);
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  assert.match(texts(channel), /Your product is on the way![\s\S]*We're checking your payment/);
  const card = channel.messageList.at(-1);
  assert.ok(customIds(card.body ?? card).includes('deliver:confirm'));

  const nope = await run({ guild, member: buyer, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(nope)), /Only the team/);
  assert.equal(ticket().order.delivered, undefined);

  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), /Delivered \*\*Netflix Premium\*\* in the ticket and by DM/);
  assert.ok(ticket().completedAt);
  assert.ok(guild.dms.some((d) => d.to === buyer.id && /Your product – /.test(textOf(d.payload))));

  const twice = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(twice)), /already delivered/);
});

test('a product without files or text: Payment OK only sets Paid – the seller delivers by hand', async () => {
  const { guild, seller } = await setup();
  const plain = shop.addProduct(guild, { name: 'Custom Logo', price: '30', description: 'Made for you.' });
  const buyer = member(guild);
  const { channel, ticket } = await order(guild, buyer, plain, 'crypto');
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { note: 'tx 0xabc' }, channel });
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), /order is \*\*Paid\*\*[\s\S]*deliver it by hand/);
  assert.equal(statusOf(ticket()), 'paid');
  assert.equal(ticket().completedAt ?? null, null);
});
