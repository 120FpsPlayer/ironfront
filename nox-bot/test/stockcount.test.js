'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateModal } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const panels = require('../src/lib/panels');
const shop = require('../src/features/shop');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 932000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const product = (guild, who, sub, options) => run({ guild, member: who, kind: 'command', commandName: 'product', subcommand: sub, options });
const said = (i) => textOf(lastResponse(i));

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, seller: member(guild, ['member', 'seller']) };
}

function shopMessage(guild) {
  const panel = db.panels(guild.id, 'shop')[0];
  return guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId);
}

async function order(guild, buyer, p, quantity = '1') {
  const i = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${p.id}`, fields: { quantity }, selects: { payment: ['0'] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { i, ticket, channel: ticket && guild.channels.cache.get(ticket.channelId) };
}

const statusLine = (guild, p) => shop.cardText(guild, p).split('\n').find((l) => /^-# [🟢🟠🔴]/u.test(l));
const logText = (guild) => textOf(guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1).body);

test('/product add | edit | stock: a count sets the status, a status alone turns the counter off', async () => {
  const { guild, seller } = await shopGuild();
  const add = await product(guild, seller, 'add', { name: 'Nitro', price: '10', description: 'Instant.', count: 12, announce: false });
  const nitro = shop.findProduct(guild.id, 'Nitro');
  assert.equal(nitro.stockCount, 12);
  assert.equal(nitro.stock, 'in');
  assert.match(said(add), /It is \*\*in stock\*\* · \*\*12 left\*\*/);
  assert.equal(statusLine(guild, nitro), '-# 🟢 In stock · 12 left');

  const low = await product(guild, seller, 'stock', { product: nitro.id, count: 2 });
  assert.equal(nitro.stock, 'low', `2 is at most config.shop.lowStockAt (${config.shop.lowStockAt})`);
  assert.match(said(low), /\*\*Nitro\*\* is now \*\*low stock – almost gone\*\* · \*\*2 left\*\*\. Completed orders count it down/);
  assert.equal(statusLine(guild, nitro), '-# 🟠 Only 2 left');

  await product(guild, seller, 'stock', { product: nitro.id, count: 0 });
  assert.equal(nitro.stock, 'out');
  assert.equal(statusLine(guild, nitro), '-# 🔴 Sold out');

  // A status on its own turns the counter off.
  const status = await product(guild, seller, 'stock', { product: nitro.id, status: 'in', announce: false });
  assert.equal(nitro.stockCount, null);
  assert.equal(nitro.stock, 'in');
  assert.match(said(status), /is now \*\*in stock\*\*\. The stock counter is off now – set a \*\*count\*\* to turn it back on\./);
  assert.equal(statusLine(guild, nitro), '-# 🟢 In stock');
  const again = await product(guild, seller, 'stock', { product: nitro.id, status: 'low' });
  assert.doesNotMatch(said(again), /counter/, 'nothing to turn off');

  const neither = await product(guild, seller, 'stock', { product: nitro.id });
  assert.match(said(neither), /Give a \*\*status\*\*, or a \*\*count\*\* of how many are left/);

  // /product edit: the same rules.
  const counted = await product(guild, seller, 'edit', { product: nitro.id, count: 50 });
  assert.match(said(counted), /It is \*\*in stock\*\* · \*\*50 left\*\*\./);
  assert.equal(nitro.stockCount, 50);
  const off = await product(guild, seller, 'edit', { product: nitro.id, stock: 'low' });
  assert.match(said(off), /It is \*\*low stock – almost gone\*\* \(no stock counter\)\./);
  assert.equal(nitro.stockCount, null);
  const both = await product(guild, seller, 'edit', { product: nitro.id, stock: 'out', count: 7 });
  assert.equal(nitro.stock, 'in', 'the count wins');
  assert.equal(nitro.stockCount, 7);
  assert.match(said(both), /\*\*7 left\*\*/);
  const name = await product(guild, seller, 'edit', { product: nitro.id, name: 'Nitro Boost' });
  assert.doesNotMatch(said(name), /left|counter/, 'no stock note when the stock was not changed');
  assert.equal(nitro.stockCount, 7, 'other edits keep the counter');

  // The low-stock limit comes from config.json.
  const prev = config.shop.lowStockAt;
  config.shop.lowStockAt = 10;
  try {
    await shop.setStock(guild, nitro.id, null, { count: 7 });
    assert.equal(nitro.stock, 'low');
  } finally {
    config.shop.lowStockAt = prev;
  }
  await assert.rejects(() => shop.setStock(guild, nitro.id, null, { count: -1 }), /whole number from 0 to 100,000/);
  await assert.rejects(() => shop.setStock(guild, nitro.id, null, { count: 2.5 }), /whole number/);

  // Added as sold out: no announcement, and the reply says so.
  const restocks = ch(guild, 'restocks').messageList.length;
  const soldOut = await product(guild, seller, 'add', { name: 'Spotify', price: '5', description: 'One month.', count: 0 });
  assert.match(said(soldOut), /It is \*\*sold out\*\*\./);
  assert.equal(ch(guild, 'restocks').messageList.length, restocks, 'nothing to announce');
});

test('the order form shows how many are left; a bigger quantity is refused', async () => {
  const { guild } = await shopGuild();
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '10', description: 'Instant.', stockCount: 3 });
  const buyer = member(guild);
  const buy = await run({ guild, member: buyer, kind: 'button', customId: `shop:buy:${nitro.id}` });
  const quantity = buy.state.modals[0].components.find((c) => c.component?.custom_id === 'quantity');
  assert.equal(quantity.description, '3 left');

  const tooMany = await order(guild, buyer, nitro, '4');
  assert.match(said(tooMany.i), /Only \*\*3\*\* left – lower the quantity to 3 or less\./);
  assert.equal(tooMany.ticket, undefined);
  const ok = await order(guild, buyer, nitro, '3');
  assert.equal(ok.ticket.order.quantity, 3);

  // Products without a counter take any quantity, as before.
  const plain = shop.addProduct(guild, { name: 'Steam Key', price: '5', description: 'Any game.' });
  assert.equal(validateModal(shop.orderModal(plain, guild), guild).components.find((c) => c.component?.custom_id === 'quantity').description, undefined);
  const many = await order(guild, member(guild), plain, '50');
  assert.equal(many.ticket.order.quantity, 50);
});

test('completed orders count the stock down – at 0 it is sold out, with a note in the ticket log, never below 0', async () => {
  const { guild, seller } = await shopGuild();
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '10', description: 'Instant.', stockCount: 5 });
  const plain = shop.addProduct(guild, { name: 'Steam Key', price: '5', description: 'Any game.' });

  const first = await order(guild, member(guild), nitro, '2');
  const late = await order(guild, member(guild), nitro, '1'); // placed while there were still some left
  const second = await order(guild, member(guild), nitro, '3');
  await t.completeOrder(first.channel, seller);
  assert.equal(nitro.stockCount, 3);
  assert.equal(nitro.stock, 'low');

  await t.completeOrder(second.channel, seller);
  assert.equal(nitro.stockCount, 0);
  assert.equal(nitro.stock, 'out');
  assert.match(logText(guild), /Sold out[\s\S]*\*\*Nitro\*\* is sold out – the last one went with order `#\d{4}`\. Restock it with `\/product stock count:`/);
  await panels.refresh(guild, 'shop');
  const ids = customIds(shopMessage(guild).body);
  assert.ok(ids.includes(`restock:notify:${nitro.id}`), 'Notify me instead of Buy');
  assert.match(textOf(shopMessage(guild).body), /🔴 Sold out/);

  const logs = guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.length;
  await t.completeOrder(late.channel, seller);
  assert.equal(nitro.stockCount, 0, 'never below 0');
  assert.equal(guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.filter((m) => /is sold out/.test(textOf(m.body))).length, 1, 'only one sold-out note');
  assert.ok(guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.length > logs);

  // Products without a counter are not touched.
  const plainOrder = await order(guild, member(guild), plain, '4');
  await t.completeOrder(plainOrder.channel, seller);
  assert.equal(plain.stockCount, null);
  assert.equal(plain.stock, 'in');

  // Sales without a product ID (Purchase ticket form, older sales) are matched by name.
  await shop.setStock(guild, nitro.id, null, { count: 4 });
  await hooks.emit('orderCompleted', { guild, sale: { product: 'nitro', quantity: 3 } });
  assert.equal(nitro.stockCount, 1);
  await hooks.emit('orderCompleted', { guild, sale: { product: 'Something else', quantity: 3 } });
  assert.equal(nitro.stockCount, 1);
  assert.equal(await shop.countDown({ guild, sale: { productId: 'gone', quantity: 1 } }), null);
});

test('back from 0: a new count tells everyone waiting (Notify me) and can announce the restock', async () => {
  const { guild, seller } = await shopGuild();
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '10', description: 'Instant.', stockCount: 0 });
  assert.equal(nitro.stock, 'out');
  const fan = member(guild);
  await run({ guild, member: fan, kind: 'button', customId: `restock:notify:${nitro.id}` });
  const events = [];
  hooks.on('productRestocked', ({ guild: g, product: p }) => {
    if (g === guild) events.push(p.id);
  });

  const restocked = await product(guild, seller, 'stock', { product: nitro.id, count: 4 });
  assert.equal(nitro.stock, 'in');
  assert.deepEqual(events, [nitro.id]);
  assert.match(said(restocked), /\*\*Nitro\*\* is now \*\*in stock\*\* · \*\*4 left\*\*[\s\S]*Restock announced 📦 · 🔔 DM sent to the 1 person waiting/);
  assert.equal(guild.dms.filter((d) => d.to === fan.id && /Back in stock/.test(textOf(d.payload))).length, 1);

  // More stock while it was not sold out – nothing to tell anyone.
  await product(guild, seller, 'stock', { product: nitro.id, count: 9 });
  assert.deepEqual(events, [nitro.id]);

  // Sold out by orders, then /product edit count: – the same restock.
  await shop.setStock(guild, nitro.id, null, { count: 1 });
  const buy = await order(guild, member(guild), nitro, '1');
  await t.completeOrder(buy.channel, seller);
  assert.equal(nitro.stock, 'out');
  await run({ guild, member: fan, kind: 'button', customId: `restock:notify:${nitro.id}` });
  const edit = await product(guild, seller, 'edit', { product: nitro.id, count: 2 });
  assert.match(said(edit), /DM sent to the 1 person waiting/);
  assert.deepEqual(events, [nitro.id, nitro.id]);
});
