'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { buildServer } = require('../src/builder/executor');
const { refreshContent } = require('../src/builder/refresh');
const { syncEmojis, describeEmojiResult, artOf } = require('../src/builder/emojis');
const { EMOJI_PRIORITY, ASSETS, bannerArt } = require('../src/lib/theme');

const oldPicture = path.join(ASSETS, 'emojis', 'cart.png'); // any small PNG works as the "old purple" upload

test('emojis of the old version (:nox_*:) are replaced by the new light orange :hs_*: ones – your own emojis stay', async () => {
  const guild = new FakeGuild({ premiumTier: 0 });
  const mine = await guild.emojis.create({ attachment: oldPicture, name: 'my_cat' });
  for (const name of ['nox', ...EMOJI_PRIORITY.filter((n) => n !== 'logo')].slice(0, 49)) {
    const em = await guild.emojis.create({ attachment: oldPicture, name: `nox_${name}` });
    if (name !== 'cart') db.setEmoji(guild.id, name, em.id); // the bot's data is lost for one of them – it still goes
  }
  assert.equal(guild.emojis.cache.size, 50, 'the server is full of old emojis');

  const res = await syncEmojis(guild);
  assert.equal(res.replaced, 49);
  assert.equal(res.uploaded, 49, 'the freed slots get the new ones (one slot stays with your own emoji)');
  assert.match(describeEmojiResult(res), /stare emotki zamienione na nowy wygląd: 49/);
  const names = [...guild.emojis.cache.values()].map((em) => em.name);
  assert.ok(names.includes('my_cat'), 'an emoji people uploaded is never touched');
  assert.ok(!names.some((n) => n.startsWith('nox_')), 'no old emoji left');
  assert.ok(names.includes('hs_logo') && names.includes('hs_cart'));
  assert.equal(db.emojiIds(guild.id).nox, undefined, 'the retired key is forgotten');
  assert.equal(db.emojiArt(guild.id).cart, artOf('cart'), 'the picture is remembered');
  assert.ok(mine);
});

test('an emoji whose picture changed is uploaded again; an up-to-date one is kept', async () => {
  const guild = new FakeGuild({ premiumTier: 3 });
  await syncEmojis(guild);
  const before = { ...db.emojiIds(guild.id) };
  db.emojiArt(guild.id).cart = 'oldpicture00'; // uploaded with an older picture
  const res = await syncEmojis(guild);
  assert.equal(res.replaced, 1);
  assert.equal(res.uploaded, 1);
  assert.notEqual(db.emojiIds(guild.id).cart, before.cart, 'a new emoji for the new picture');
  assert.equal(db.emojiIds(guild.id).check, before.check, 'the others are kept');
  const again = await syncEmojis(guild);
  assert.deepEqual([again.replaced, again.uploaded], [0, 0]);
});

test('/build only:panels replaces banners whose picture changed (the old purple ones) in place – once', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const build = db.build(guild.id);
  const shop = build.posts.shop.find((p) => p.type === 'banner');
  assert.equal(shop.art, bannerArt('shop'), 'the build remembers which picture it posted');
  // A server built with the old version: its banners have no (or another) picture hash.
  const posts = JSON.parse(JSON.stringify(build.posts));
  for (const list of Object.values(posts)) for (const p of list) if (p.type === 'banner') delete p.art;
  db.setBuild(guild.id, { ...build, posts });
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'shop'));
  const before = channel.messageList.length;

  const first = await refreshContent(guild);
  const banners = Object.values(posts).flat().filter((p) => p.type === 'banner').length;
  assert.ok(first.edited >= banners, 'every banner was replaced');
  assert.equal(channel.messageList.length, before, 'in place – nothing new was posted');
  assert.equal(db.build(guild.id).posts.shop.find((p) => p.type === 'banner').art, bannerArt('shop'));

  const second = await refreshContent(guild);
  assert.equal(second.edited, first.edited - banners, 'the banners are only replaced once');
});
