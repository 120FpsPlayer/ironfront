'use strict';

/** Regression tests for the review of "I've paid" and the order status (src/features/payments.js, orderstatus.js). */

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const shop = require('../src/features/shop');
const payments = require('../src/features/payments');
const orderstatus = require('../src/features/orderstatus');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 964000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const realFetch = global.fetch;
const MINUTE = 60_000;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.', emoji: '💎' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

/** Buy → order form → ticket (payment '0' = PaysafeCard, '1' = Crypto). */
async function order(guild, buyer, product, { payment = '0' } = {}) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '1' }, selects: { payment: [payment] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { ticket, channel: guild.channels.cache.get(ticket.channelId) };
}

const pay = (guild, who, channel, { fields = {}, uploads = {} } = {}) => run({ guild, member: who, kind: 'modal', customId: 'pay:submit', fields, uploads, channel });
const card = (channel) => channel.messageList.find((m) => m.id === db.getTicket(channel.id).controlMessageId);
const logChannel = (guild) => guild.channels.cache.get(db.settings(guild.id).logChannelId);
const orderRoles = (guild) => [db.roleId(guild.id, 'seller')];
const nothing = { users: [], roles: [] };
/** Moves the ticket's clocks back: the last payment (cooldown) and the last staff ping. */
const later = (channel, { payment = 0, ping = 0 }) => {
  const ticket = db.getTicket(channel.id);
  ticket.order.payment.at -= payment;
  if (ticket.lastStaffPing) ticket.lastStaffPing -= ping;
};

const emitted = [];
hooks.on('orderStatus', (e) => emitted.push(e));

// ───────────── Re-sends don't ping the team every minute ─────────────

test('"I\'ve paid" sent again pings the team only after the Call support cooldown – or after staff asked for the payment again', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);
  const roles = orderRoles(guild);
  assert.ok(roles.length > 0);

  // The first payment pings the order staff roles – and counts as calling support
  await pay(guild, buyer, channel, { fields: { note: 'x' } });
  assert.deepEqual(channel.messageList.at(-1).body.allowedMentions, { users: [], roles });
  const pinged = db.getTicket(channel.id).lastStaffPing;
  assert.ok(Math.abs(pinged - Date.now()) < 5000);

  // Corrections a minute apart: posted (and logged), but nobody is pinged
  for (let i = 0; i < 3; i++) {
    later(channel, { payment: 2 * MINUTE });
    const logsBefore = logChannel(guild).messageList.length;
    await pay(guild, buyer, channel, { fields: { note: `x${i}` } });
    const posted = channel.messageList.at(-1);
    assert.match(textOf(posted.body), /## 📨 Payment sent again/);
    assert.deepEqual(posted.body.allowedMentions, nothing, `re-send ${i + 1} pings nobody`);
    assert.ok(!roles.some((id) => textOf(posted.body).includes(`<@&${id}>`)));
    assert.equal(logChannel(guild).messageList.length, logsBefore + 1, 'still logged');
    assert.equal(db.getTicket(channel.id).order.payment.note, `x${i}`);
  }
  assert.equal(db.getTicket(channel.id).lastStaffPing, pinged, 'the quiet re-sends do not restart the cooldown');

  // Call support is on the same cooldown
  db.getTicket(channel.id).createdAt -= 60 * MINUTE;
  const call = await run({ guild, member: buyer, kind: 'button', customId: 'ticket:ping', channel });
  assert.match(textOf(lastResponse(call)), /Support has already been called/);

  // Once the cooldown is over, a correction pings again (only the seller once they claimed it)
  await t.claimTicket(channel, seller);
  later(channel, { payment: 2 * MINUTE, ping: 31 * MINUTE });
  await pay(guild, buyer, channel, { fields: { note: 'y' } });
  assert.deepEqual(channel.messageList.at(-1).body.allowedMentions, { users: [seller.id], roles: [] });
  later(channel, { payment: 2 * MINUTE });
  await pay(guild, buyer, channel, { fields: { note: 'z' } });
  assert.deepEqual(channel.messageList.at(-1).body.allowedMentions, nothing, 'the claimer is not pinged every minute either');

  // Staff set it back to "Awaiting payment" (e.g. a wrong PIN): the new payment pings right away
  await orderstatus.setStatus(channel, 'awaiting', seller);
  later(channel, { payment: 2 * MINUTE });
  await pay(guild, buyer, channel, { fields: { note: 'fixed' } });
  assert.deepEqual(channel.messageList.at(-1).body.allowedMentions, { users: [seller.id], roles: [] });
  assert.match(textOf(channel.messageList.at(-1).body), new RegExp(`<@${seller.id}>, please check it`));
});

// ───────────── Staff moved the order on while the payment was on its way ─────────────

/** Starts a payment whose screenshot download waits until release() → { done, release, waitStart } */
function heldPayment(guild, buyer, channel) {
  let release;
  let started = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  global.fetch = async () => {
    started = true;
    await gate;
    return { ok: true, headers: new Map(), arrayBuffer: async () => PNG.buffer.slice(0) };
  };
  const done = pay(guild, buyer, channel, { fields: { note: 'paid' }, uploads: { files: [{ name: 'proof.png', url: 'https://cdn.discordapp.com/ephemeral-attachments/1/2/proof.png' }] } });
  const waitStart = async () => {
    for (let i = 0; i < 100 && !started; i++) await new Promise((r) => setImmediate(r));
    assert.ok(started, 'the download started');
  };
  return { done, release: () => release(), waitStart };
}

test('"I\'ve paid": staff confirming or completing the order during the upload is not undone', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);

  // Paid while the screenshot is downloaded → the payment is not posted, the status stays Paid
  try {
    const held = heldPayment(guild, buyer, channel);
    await held.waitStart();
    await orderstatus.setStatus(channel, 'paid', seller);
    const messages = channel.messageList.length;
    const from = emitted.length;
    held.release();
    const i = await held.done;
    assert.match(textOf(lastResponse(i)), /already confirmed \(💳 Paid\)/);
    const saved = db.getTicket(channel.id).order;
    assert.equal(saved.status, 'paid');
    assert.deepEqual(saved.history.map((h) => h.status), ['paid']);
    assert.equal(saved.payment, undefined);
    assert.equal(channel.messageList.length, messages, 'no payment card');
    assert.equal(emitted.length, from, 'no orderStatus "sent"');
    assert.ok(!customIds(card(channel).body).includes('pay:open'));

    // Completed during the upload → not posted either, the order stays delivered
    const second = await order(guild, buyer, product);
    const held2 = heldPayment(guild, buyer, second.channel);
    await held2.waitStart();
    await t.completeOrder(second.channel, seller, { amount: 10 });
    held2.release();
    const i2 = await held2.done;
    assert.match(textOf(lastResponse(i2)), /already completed/);
    assert.equal(db.getTicket(second.channel.id).order.status, 'delivered');
    assert.ok(!emitted.some((e) => e.ticket.channelId === second.channel.id && e.status === 'sent'));
  } finally {
    global.fetch = realFetch;
  }
});

test('"I\'ve paid": staff confirming it while the card is posted keeps the status and still saves the payment', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);
  const send = channel.send.bind(channel);
  channel.send = async (payload) => {
    channel.send = send;
    const message = await send(payload);
    await orderstatus.setStatus(channel, 'paid', seller); // the seller clicks Status: Paid right now
    return message;
  };
  const from = emitted.length;
  const i = await pay(guild, buyer, channel, { fields: { pins: '1234-5678-9012-3456' } });
  assert.match(textOf(lastResponse(i)), /Thanks!/);
  const saved = db.getTicket(channel.id).order;
  assert.equal(saved.status, 'paid', 'not set back to "sent"');
  assert.deepEqual(saved.history.map((h) => h.status), ['paid']);
  assert.deepEqual(saved.payment.pins, ['1234567890123456'], 'the payment is kept');
  assert.deepEqual(emitted.slice(from).map((e) => e.status), ['paid']);
  assert.ok(!customIds(card(channel).body).includes('pay:open'));
});

// ───────────── The log masks every PIN format the PIN field accepts ─────────────

test('the log masks PINs written with several spaces, spaced dashes or dots – also in the note of a Crypto order', async () => {
  for (const pin of ['1234 - 5678 - 9012 - 3456', '1234  5678  9012  3456', '1234\t5678\t9012\t3456', '1234.5678.9012.3456', '1234 / 5678 / 9012 / 3456', '1234-5678 9012-3456']) {
    assert.equal(payments.maskText(`PIN: ${pin}!`), 'PIN: ••••-••••-••••-3456!', pin);
  }
  // Every PIN the PIN field accepts is masked in a note too
  for (const raw of ['1234 - 5678 - 9012 - 3456', '1234  5678  9012  3456', '1234-5678 9012-3456']) {
    assert.deepEqual(payments.parsePins(raw).pins, ['1234567890123456'], raw);
  }
  assert.equal(payments.maskText('order 12, paid 19.99 on 07.10.2026'), 'order 12, paid 19.99 on 07.10.2026', 'short numbers stay');

  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product, { payment: '1' }); // Crypto: no PIN field
  await pay(guild, buyer, channel, { fields: { note: 'Paid with PaysafeCard after all: 1234 - 5678 - 9012 - 3456' } });
  const raw = JSON.stringify(logChannel(guild).messageList.at(-1).body);
  assert.ok(raw.includes('••••-••••-••••-3456'));
  for (const secret of ['5678', '9012']) assert.ok(!raw.includes(secret), `the log must not contain ${secret}`);
  assert.ok(textOf(channel.messageList.at(-1).body).includes('••••-••••-••••-3456'), 'the ticket hides a PIN in the note too (Show PIN for the owner)');
  assert.ok(!textOf(channel.messageList.at(-1).body).includes('5678'));
});

// ───────────── PIN validation ─────────────

test('PINs separated by spaces: each one needs its 16 digits – a digit too many or too few is rejected', () => {
  assert.equal(payments.parsePins('12345678901234567 123456789012345').bad, '12345678901234567 123456789012345');
  assert.ok(payments.parsePins('1234567890123456 12345678901234567').bad);
  assert.ok(payments.parsePins('1234 5678 9012 345 6').bad);
  assert.ok(payments.parsePins('1234 5678 9012').bad);
  assert.ok(payments.parsePins('123 4567 8901 23456').bad);
  assert.equal(payments.parsePins('1111222233334444 5555').bad, '1111222233334444 5555');

  // Still fine: groups of 4, dashes, two PINs with a space or glued together, several lines
  const ok = (raw, pins) => assert.deepEqual(payments.parsePins(raw), { pins, bad: null }, raw);
  ok('1234 5678 9012 3456', ['1234567890123456']);
  ok('1234-5678-9012-3456 1111-2222-3333-4444', ['1234567890123456', '1111222233334444']);
  ok('1234 5678 9012 3456 1111 2222 3333 4444', ['1234567890123456', '1111222233334444']);
  ok('12345678901234561111222233334444', ['1234567890123456', '1111222233334444']);
  ok('  1234567890123456 ,\n\n 1111 2222 3333 4444 ; ', ['1234567890123456', '1111222233334444']);
});

// ───────────── Orders without a product answer ─────────────

test('a status on an order ticket without a product (e.g. moved from Support) keeps "Custom order" in the Complete order form', async () => {
  const { guild, seller } = await shopGuild();
  const channel = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'I want to buy something special' }]);
  await t.moveTicket(channel, 'order', seller);
  const before = t.completeForm(channel).toJSON();
  assert.match(before.components[0].content, /Custom order – enter what the customer paid/);

  await orderstatus.setStatus(channel, 'paid', seller);
  assert.equal(db.getTicket(channel.id).order.product, null);
  const form = t.completeForm(channel).toJSON();
  assert.ok(!form.components[0].content.includes('null'), form.components[0].content);
  assert.match(form.components[0].content, /\*\*Custom order\*\* × 1/);

  // The completed sale has no product either – the receipt says "Custom order"
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '15' }, channel });
  const sale = db.sales(guild.id).at(-1);
  assert.deepEqual([sale.product, sale.quantity, sale.amount], [null, 1, 15]);
});
