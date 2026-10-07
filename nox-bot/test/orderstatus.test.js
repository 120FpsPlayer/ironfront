'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const shop = require('../src/features/shop');
const orderstatus = require('../src/features/orderstatus');
const { statusOf } = require('../src/lib/orderStatus');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 962000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const pad = (x) => String(x).padStart(4, '0');

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.', emoji: '💎' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, product, { quantity = '1' } = {}) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity }, selects: { payment: ['0'] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { ticket, channel: guild.channels.cache.get(ticket.channelId) };
}

const card = (channel) => channel.messageList.find((m) => m.id === db.getTicket(channel.id).controlMessageId);

/** The options of the ⚙️ menu on the ticket's card. */
function menuOptions(channel) {
  let options = null;
  const walk = (c) => {
    const d = c?.toJSON ? c.toJSON() : c;
    if (!d) return;
    if (d.custom_id === 'ticket:manage') options = d.options;
    for (const x of d.components ?? []) walk(x);
  };
  for (const c of card(channel).body.components) walk(c);
  return options;
}
const values = (channel) => menuOptions(channel).map((o) => o.value);
const dmsTo = (guild, user) => guild.dms.filter((d) => d.to === user.id);
const linkUrls = (payload) => JSON.stringify(payload.components.map((c) => c.toJSON?.() ?? c)).match(/"url":"[^"]+"/g) ?? [];

const emitted = [];
hooks.on('orderStatus', (e) => emitted.push(e));
/** Every orderStatus event while fn runs. */
async function events(fn) {
  const from = emitted.length;
  await fn();
  return emitted.slice(from);
}

// ───────────── ⚙️ menu ─────────────

test('⚙️ menu: "Status: …" options for open orders, never the current status, at most 25 options', async () => {
  const { guild, product, seller } = await shopGuild();
  const { channel } = await order(guild, member(guild), product);
  assert.deepEqual(values(channel).slice(0, 3), ['complete', 'status:paid', 'status:progress'], 'awaiting is the current status');
  const paid = menuOptions(channel).find((o) => o.value === 'status:paid');
  assert.equal(paid.label, 'Status: Paid');
  assert.equal(paid.emoji.name, '💳');
  assert.match(paid.description, /DMs the customer/);

  await orderstatus.setStatus(channel, 'paid', seller);
  assert.deepEqual(values(channel).slice(0, 3), ['complete', 'status:progress', 'status:awaiting']);
  await orderstatus.setStatus(channel, 'progress', seller);
  assert.deepEqual(values(channel).slice(0, 3), ['complete', 'status:paid', 'status:awaiting']);

  // Not for other tickets, nor once the order is completed
  const support = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  assert.ok(!values(support).some((v) => v.startsWith('status:') || v === 'complete'));
  await t.completeOrder(channel, seller, { amount: 10 });
  const done = await order(guild, member(guild), product);
  await t.completeOrder(done.channel, seller, { amount: 10 });
  assert.ok(!values(done.channel).some((v) => v.startsWith('status:')));

  // Many ticket categories: the menu stays at 25 options and keeps the status options
  const extra = Array.from({ length: 24 }, (_, i) => ({ id: `extra${i}`, label: `Extra ${i}`, emoji: '📁', questions: [], staffRoles: [], staffRoleIds: [] }));
  config.ticketTypes.push(...extra);
  try {
    const big = await order(guild, member(guild), product);
    assert.equal(values(big.channel).length, 25);
    assert.ok(values(big.channel).includes('status:paid') && values(big.channel).includes('status:progress'));
  } finally {
    config.ticketTypes.splice(config.ticketTypes.length - extra.length, extra.length);
  }
});

// ───────────── Changing the status ─────────────

test('setting a status: saved with its history, a notice in the ticket, the card shows it and the customer gets a DM', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { ticket, channel } = await order(guild, buyer, product, { quantity: '2' });
  assert.match(textOf(card(channel).body), /\*\*Order:\*\* ⏳ Awaiting payment/);

  // Members can't use it
  const denied = await run({ guild, member: buyer, kind: 'select', customId: 'ticket:manage', values: ['status:paid'], channel });
  assert.match(textOf(lastResponse(denied)), /only available to staff/);
  assert.equal(statusOf(db.getTicket(channel.id)), 'awaiting');

  const dmsBefore = dmsTo(guild, buyer).length;
  let pick;
  const seen = await events(async () => {
    pick = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['status:paid'], channel });
  });
  assert.match(textOf(lastResponse(pick)), /Order status set to \*\*💳 Paid\*\* – the customer got a DM\./);
  const saved = db.getTicket(channel.id).order;
  assert.equal(saved.status, 'paid');
  assert.equal(saved.statusBy, seller.id);
  assert.ok(Math.abs(saved.statusAt - Date.now()) < 5000);
  assert.deepEqual(saved.history.map((h) => [h.status, h.by]), [['paid', seller.id]]);
  assert.equal(saved.product, 'Nitro Boost');
  assert.equal(saved.total, 20);

  assert.match(textOf(channel.messageList.at(-1).body), /💳 Order status: \*\*Paid\*\*\n-# Set by <@\d+> <t:\d+:R>/);
  assert.match(textOf(card(channel).body), /\*\*Order:\*\* 💳 Paid · <t:\d+:R>/);

  // The DM: order number, product, status and a link to the ticket
  assert.equal(dmsTo(guild, buyer).length, dmsBefore + 1);
  const dm = dmsTo(guild, buyer).at(-1).payload;
  validateMessage(dm, guild);
  const out = textOf(dm);
  assert.match(out, /## 💳 Order update/);
  assert.ok(out.includes(`**Order:** \`#${pad(ticket.number)}\``));
  assert.ok(out.includes('**Product:** Nitro Boost × 2'));
  assert.ok(out.includes('**Status:** 💳 Paid'));
  assert.ok(out.includes('Go to ticket'));
  assert.ok(linkUrls(dm).includes(`"url":"${channel.url}"`), 'a link button to the ticket');

  // The hook
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'paid');
  assert.equal(seen[0].staff, seller);
  assert.equal(seen[0].guild, guild);
  assert.equal(seen[0].ticket.channelId, channel.id);

  // In progress, back to awaiting (undo), and the same status twice is refused
  await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['status:progress'], channel });
  assert.match(textOf(dmsTo(guild, buyer).at(-1).payload), /is now \*\*In progress\*\*/);
  await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['status:awaiting'], channel });
  assert.match(textOf(dmsTo(guild, buyer).at(-1).payload), /is now \*\*Awaiting payment\*\*.*\n[\s\S]*waiting for your payment/);
  assert.deepEqual(db.getTicket(channel.id).order.history.map((h) => h.status), ['paid', 'progress', 'awaiting']);
  await assert.rejects(orderstatus.setStatus(channel, 'awaiting', seller), /already \*\*⏳ Awaiting payment\*\*/);
  await assert.rejects(orderstatus.setStatus(channel, 'delivered', seller), /Unknown order status/);
  const forged = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['status:cancelled'], channel });
  assert.match(textOf(lastResponse(forged)), /Unknown order status/);
  const support = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  await assert.rejects(orderstatus.setStatus(support, 'paid', seller), /Only purchase tickets have an order status/);
});

test('status DMs: closed DMs never break it, and statusDms: false sends none', async () => {
  const { guild, product, seller } = await shopGuild();
  const shy = member(guild);
  guild.closedDms.add(shy.id);
  const a = await order(guild, shy, product);
  const pick = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['status:paid'], channel: a.channel });
  assert.match(textOf(lastResponse(pick)), /Order status set to \*\*💳 Paid\*\*\./);
  assert.equal(db.getTicket(a.channel.id).order.status, 'paid');

  config.orders.statusDms = false;
  try {
    const quiet = member(guild);
    const b = await order(guild, quiet, product);
    assert.ok(!menuOptions(b.channel).find((o) => o.value === 'status:paid').description.includes('DM'));
    const before = dmsTo(guild, quiet).length;
    await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['status:progress'], channel: b.channel });
    assert.equal(dmsTo(guild, quiet).length, before);
    assert.equal(db.getTicket(b.channel.id).order.status, 'progress');
  } finally {
    config.orders.statusDms = true;
  }
});

// ───────────── Delivered ─────────────

test('delivered: the receipt says "✅ Delivered" (no second DM); without receipts the status DM says it', async () => {
  const { guild, product, seller } = await shopGuild();
  const complete = (channel) => run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel });

  const buyer = member(guild);
  const a = await order(guild, buyer, product);
  const before = dmsTo(guild, buyer).length;
  const seen = await events(() => complete(a.channel));
  const dms = dmsTo(guild, buyer).slice(before);
  assert.equal(dms.length, 1, 'only the receipt');
  assert.match(textOf(dms[0].payload), /Here is your receipt/);
  assert.ok(textOf(dms[0].payload).includes('**Status:** ✅ Delivered'));
  const saved = db.getTicket(a.channel.id).order;
  assert.equal(saved.status, 'delivered');
  assert.deepEqual([saved.history.at(-1).status, saved.history.at(-1).by], ['delivered', seller.id]);
  assert.equal(saved.statusAt, db.getTicket(a.channel.id).completedAt);
  assert.deepEqual(seen.map((e) => e.status), ['delivered']);
  assert.match(textOf(card(a.channel).body), /\*\*Order:\*\* ✅ Delivered · <t:\d+:R>/);

  // Receipts off → the status DM instead
  config.orders.receipts = false;
  try {
    const other = member(guild);
    const b = await order(guild, other, product, { quantity: '3' });
    const start = dmsTo(guild, other).length;
    await complete(b.channel);
    const sent = dmsTo(guild, other).slice(start);
    assert.equal(sent.length, 1);
    validateMessage(sent[0].payload, guild);
    assert.match(textOf(sent[0].payload), /## ✅ Order update/);
    assert.ok(textOf(sent[0].payload).includes('**Product:** Nitro Boost × 3'));
    assert.ok(textOf(sent[0].payload).includes('**Status:** ✅ Delivered'));

    // … and nothing at all with status DMs off too
    config.orders.statusDms = false;
    const third = member(guild);
    const c = await order(guild, third, product);
    const from = dmsTo(guild, third).length;
    await complete(c.channel);
    assert.equal(dmsTo(guild, third).length, from);
  } finally {
    config.orders.receipts = true;
    config.orders.statusDms = true;
  }
});

test('order tickets from older versions (no ticket.order): a status change keeps product and quantity', async () => {
  const { guild, seller } = await shopGuild();
  const buyer = member(guild);
  const type = config.getType('order');
  const answers = type.questions.map((q) => ({ label: q.label, value: { product: 'Spotify Premium', quantity: '2', payment: 'PayPal', notes: '' }[q.id] }));
  const channel = await t.openTicket(buyer, type, answers);
  assert.equal(db.getTicket(channel.id).order, undefined);
  assert.equal(statusOf(db.getTicket(channel.id)), 'awaiting');

  await orderstatus.setStatus(channel, 'paid', seller);
  const saved = db.getTicket(channel.id).order;
  assert.deepEqual([saved.product, saved.quantity, saved.method, saved.status], ['Spotify Premium', 2, 'PayPal', 'paid']);
  assert.ok(textOf(dmsTo(guild, buyer).at(-1).payload).includes('**Product:** Spotify Premium × 2'));

  await t.completeOrder(channel, seller, { amount: 12 });
  const sale = db.sales(guild.id).at(-1);
  assert.deepEqual([sale.product, sale.quantity, sale.method], ['Spotify Premium', 2, 'PayPal']);
  assert.equal(statusOf(db.getTicket(channel.id)), 'delivered');
});

test('the status DM stays within Discord limits', async () => {
  const guild = new FakeGuild({ name: 'G'.repeat(100) });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const ticket = { number: 9999, channelId: '123456789012345678', typeId: 'order', status: 'open', order: { product: 'P'.repeat(200), quantity: 999 } };
  for (const status of ['awaiting', 'sent', 'paid', 'progress', 'delivered', 'cancelled']) validateMessage(orderstatus.statusCard(guild, ticket, status), guild);
});
