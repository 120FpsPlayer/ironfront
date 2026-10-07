'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { refreshContent } = require('../src/builder/refresh');
const config = require('../src/lib/config');

const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const role = (guild, key) => db.roleId(guild.id, key);
let n = 910000000000000000n;
const uid = () => String(++n);

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

test('/build only:panels edits the cards in place with the new texts', async () => {
  const guild = await builtGuild();
  const payments = ch(guild, 'payments');
  const ids = payments.messageList.map((m) => m.id);
  const prev = config.shop.deliveryTime;
  config.shop.paymentMethods.push({ name: 'Gift Cards', emoji: 'gift', details: 'Amazon & Steam' });
  config.shop.deliveryTime = 'Instant – under 1 minute';
  try {
    const res = await refreshContent(guild);
    assert.deepEqual(res.errors, []);
    assert.equal(res.sent, 0);
    assert.deepEqual(payments.messageList.map((m) => m.id), ids, 'same messages – edited, not re-posted');
    assert.match(textOf(payments.messageList[1].body), /Gift Cards/);
    assert.match(textOf(ch(guild, 'howToBuy').messageList[1].body), /Instant – under 1 minute/);
  } finally {
    config.shop.paymentMethods.pop();
    config.shop.deliveryTime = prev;
  }
});

test('/build only:panels never touches vouches, giveaways or welcome cards', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const buyer = guild.addMember(uid(), [role(guild, 'member')]);
  await require('../src/features/vouches').postVouch(guild, buyer, { rating: 5, product: 'GTA V', review: 'Fast and legit, thank you!' });
  await require('../src/features/giveaways').start(guild, owner, { prize: 'Nitro', durationMs: 3_600_000, winners: 1 });
  await require('../src/features/welcome').onMemberAdd(guild.addMember(uid(), []));
  const snapshot = (key) => ch(guild, key).messageList.map((m) => m.id);
  const before = { vouches: snapshot('vouches'), giveaways: snapshot('giveaways'), welcome: snapshot('welcome') };
  const res = await refreshContent(guild);
  assert.deepEqual(res.errors, []);
  for (const key of Object.keys(before)) assert.deepEqual(snapshot(key), before[key], `#${key} unchanged`);
});

test('/build only:panels re-sends a card someone deleted', async () => {
  const guild = await builtGuild();
  const faq = ch(guild, 'faq');
  await faq.messageList[1].delete();
  const res = await refreshContent(guild);
  assert.equal(res.sent, 1);
  assert.equal(faq.messageList.length, 2);
  assert.match(textOf(faq.messageList[1].body), /Frequently asked questions/);
});

test('/build only:panels works on servers built before message tracking, without duplicates', async () => {
  const guild = await builtGuild();
  const b = db.build(guild.id);
  delete b.posts;
  db.setBuild(guild.id, b);
  const counts = (key) => ch(guild, key).messageList.length;
  const before = { information: counts('information'), shop: counts('shop'), tickets: counts('tickets') };
  const res = await refreshContent(guild);
  assert.deepEqual(res.errors, []);
  for (const key of Object.keys(before)) assert.equal(counts(key), before[key], `#${key} has no duplicates`);
  assert.equal(db.build(guild.id).posts.information.length, 10, 'posts are tracked from now on');
});

test('shop prices: plain numbers get the € sign, payments are PaysafeCard / Crypto / PayPal / Stripe', async () => {
  const guild = await builtGuild();
  const shop = require('../src/features/shop');
  const panels = require('../src/lib/panels');
  shop.addProduct(guild, { name: 'GTA V', price: '20', description: 'Goat game' });
  shop.addProduct(guild, { name: 'Bundle', price: 'from 5€', description: 'Pick what you want' });
  const panel = await panels.render('shop', guild);
  assert.match(textOf(panel), /GTA V.*\*\*20€\*\*/);
  assert.match(textOf(panel), /\*\*from 5€\*\*/);
  assert.ok(customIds(panel).filter((id) => id.startsWith('shop:buy:')).length === 2);
  const modal = shop.orderModal(db.guild(guild.id).products[0], guild).toJSON();
  assert.match(JSON.stringify(modal), /20€/);
  const payment = modal.components.find((c) => c.component?.custom_id === 'payment').component;
  assert.deepEqual(payment.options.map((o) => o.label), ['PaysafeCard', 'Crypto', 'PayPal', 'Stripe']);
});
