'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const content = require('../src/builder/content');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;
let n = 997700000000000000n;
const uid = () => String(++n);
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const PAYPAL = String(config.shop.paymentMethods.findIndex((m) => m.type === 'paypal'));
const optionsOf = (modal) => JSON.stringify(modal.toJSON?.() ?? modal);

test('/disable PayPal: gone from the order form (other indexes kept), an old form is refused, #payments shows it; /enable brings it back', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const owner = guild.members.cache.get(guild.ownerId);
  const buyer = guild.addMember(uid(), [db.roleId(guild.id, 'member')]);
  const product = shop.addProduct(guild, { name: 'Netflix', price: '10', description: 'UHD.' });

  const nope = await run({ guild, member: buyer, kind: 'command', commandName: 'disable', options: { method: 'PayPal' } });
  assert.match(textOf(lastResponse(nope)), /Only administrators and sellers/);

  const off = await run({ guild, member: owner, kind: 'command', commandName: 'disable', options: { method: 'PayPal', reason: 'maintenance' } });
  assert.match(textOf(lastResponse(off)), /PayPal\*\* is off/);

  const form = optionsOf(shop.orderModal(product, guild, { userId: buyer.id }));
  assert.doesNotMatch(form, /"label":"PayPal"/);
  const psc = config.shop.paymentMethods.findIndex((m) => m.type === 'paysafecard');
  assert.match(form, new RegExp(`"value":"${psc}"`), 'the other methods keep their index');

  const old = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '1' }, selects: { payment: [PAYPAL] } });
  assert.match(textOf(lastResponse(old)), /PayPal\*\* is temporarily unavailable/);
  assert.equal(db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).length, 0);

  const posted = guild.channels.cache.get(db.channelId(guild.id, 'payments')).messageList.map((m) => textOf(m.body ?? m)).join('\n');
  assert.match(posted, /~~PayPal~~[\s\S]*temporarily unavailable – maintenance/, 'the posted #payments card was updated in place');
  const card = JSON.stringify(await content.postsFor('payments', guild));
  assert.match(card, /temporarily unavailable – maintenance/);
  assert.match(JSON.stringify(await content.postsFor('faq', guild)), /PayPal \(temporarily unavailable\)/);

  await run({ guild, member: owner, kind: 'command', commandName: 'enable', options: { method: 'PayPal' } });
  assert.match(optionsOf(shop.orderModal(product, guild, { userId: buyer.id })), /"label":"PayPal"/);
});

test('every method off → the order form says payments are paused', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const ps = require('../src/lib/paymentState');
  for (const m of config.shop.paymentMethods) ps.set(guild.id, m.name, true);
  const product = shop.addProduct(guild, { name: 'Spotify', price: '5', description: 'Premium.' });
  assert.throws(() => shop.orderModal(product, guild, { userId: uid() }), /Payments are paused/);
  for (const m of config.shop.paymentMethods) ps.set(guild.id, m.name, false);
});
