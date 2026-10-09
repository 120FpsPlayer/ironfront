'use strict';

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { buildServer } = require('../src/builder/executor');
const shop = require('../src/features/shop');

test('the order form shows every line of a multi-line description in the same small text', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const p = shop.addProduct(guild, { name: 'Games', price: '30', description: 'Want to play 1,000+ games?\nGet access for one low price.' });
  const intro = shop.orderModal(p, guild, { userId: guild.ownerId }).toJSON().components[0].content;
  assert.equal(intro.split('\n').slice(1).join('\n'), '-# Want to play 1,000+ games?\n-# Get access for one low price.');
});
