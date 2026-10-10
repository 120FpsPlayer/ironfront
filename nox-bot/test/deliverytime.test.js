'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const shop = require('../src/features/shop');

const commands = require('../src/commands')();

test('delivery_time: instant, 1–7 days or up to 14 days on the card and the order form; "auto" goes back to automatic', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const owner = guild.members.cache.get(guild.ownerId);
  const run = async (options, subcommand) => {
    const i = createInteraction({ guild, member: owner, kind: 'command', commandName: 'product', subcommand, options });
    await handle(i, commands);
    return i;
  };
  await run({ name: 'Combo', price: '15', description: 'Five games.', delivery_time: '3' }, 'add');
  const p = shop.products(guild.id).find((x) => x.name === 'Combo');
  assert.equal(p.deliveryTime, '3');
  assert.match(shop.cardText(guild, p), /🕒 Delivery: 3 days/);
  assert.match(shop.orderModal(p, guild).toJSON().components[0].content, /15€ · 🕒 Delivery: 3 days/);

  await run({ product: p.id, delivery_time: '14' }, 'edit');
  assert.match(shop.cardText(guild, shop.findProduct(guild.id, p.id)), /🕒 Delivery: up to 14 days/);
  await run({ product: p.id, delivery_time: 'instant' }, 'edit');
  assert.match(shop.cardText(guild, shop.findProduct(guild.id, p.id)), /⚡ Instant delivery/);
  const back = await run({ product: p.id, delivery_time: 'auto' }, 'edit');
  assert.ok(!/error/i.test(textOf(lastResponse(back))));
  assert.equal(shop.findProduct(guild.id, p.id).deliveryTime, null);
  assert.doesNotMatch(shop.cardText(guild, shop.findProduct(guild.id, p.id)), /Delivery|Instant/);
  assert.equal(db.guild(guild.id).products.length > 0, true);
});
