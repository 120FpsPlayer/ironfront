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
const promos = require('../src/features/promos');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;
let n = 997500000000000000n;
const uid = () => String(++n);

test('a promo code added in the ticket: new total, the old payment card replaced by a new one', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Netflix', price: '20', description: 'UHD.' });
  promos.create(guild.id, { code: 'SAVE10', percent: 10 });
  const buyer = guild.addMember(uid(), [db.roleId(guild.id, 'member')]);
  const psc = String(config.shop.paymentMethods.findIndex((m) => m.type === 'paysafecard'));
  await handle(createInteraction({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '1' }, selects: { payment: [psc] } }), commands);
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id)[0];
  const channel = guild.channels.cache.get(ticket.channelId);
  const all = () => channel.messageList.map((m) => m.body ?? m);
  assert.ok(all().some((b) => customIds(b).includes('tpromo:open')), 'the order card offers "Add promo code"');

  const wrong = createInteraction({ guild, member: buyer, kind: 'modal', customId: 'tpromo:submit', fields: { code: 'NOPE' }, channel });
  await handle(wrong, commands);
  assert.match(textOf(lastResponse(wrong)), /can't be used/);

  const i = createInteraction({ guild, member: buyer, kind: 'modal', customId: 'tpromo:submit', fields: { code: 'save10' }, channel });
  await handle(i, commands);
  assert.match(textOf(lastResponse(i)), /SAVE10.*18€/);
  const t = db.getTicket(channel.id);
  assert.equal(t.order.total, 18);
  assert.equal(t.order.promo, 'SAVE10');
  const cards = all().filter((b) => /Pay \d/.test(textOf(b)));
  assert.equal(cards.length, 1, 'only the new payment card is left');
  assert.match(textOf(cards[0]), /Pay 18€/);
});
