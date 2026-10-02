'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PermissionFlagsBits: P } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { reloadAll } = require('../src/builder/reload');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');

const commands = require('../src/commands')();
const CONTENT = path.join(__dirname, '..', 'src', 'builder', 'content.js');
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const role = (guild, key) => db.roleId(guild.id, key);
let n = 910000000000000000n;
const uid = () => String(++n);

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const editConfig = (fn) => {
  const json = JSON.parse(fs.readFileSync(config.path, 'utf8'));
  fn(json);
  fs.writeFileSync(config.path, JSON.stringify(json, null, 2));
};

test('/reload picks up config.json changes and edits the cards in place', async () => {
  const original = fs.readFileSync(config.path, 'utf8');
  try {
    const guild = await builtGuild();
    const payments = ch(guild, 'payments');
    const ids = payments.messageList.map((m) => m.id);
    editConfig((c) => {
      c.shop.paymentMethods.push({ name: 'Gift Cards', emoji: 'gift', details: 'Amazon & Steam' });
      c.shop.deliveryTime = 'Instant – under 1 minute';
    });
    const { steps } = await reloadAll(guild, { invokerId: guild.ownerId });
    assert.ok(steps.every((s) => s.ok), JSON.stringify(steps));
    assert.deepEqual(payments.messageList.map((m) => m.id), ids, 'same messages – edited, not re-posted');
    assert.match(textOf(payments.messageList[1].body), /Gift Cards/);
    assert.match(textOf(ch(guild, 'howToBuy').messageList[1].body), /Instant – under 1 minute/);
  } finally {
    fs.writeFileSync(config.path, original);
    config.reload();
  }
});

test('/reload never touches vouches, giveaways, announcements or welcome cards', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const buyer = guild.addMember(uid(), [role(guild, 'member')]);
  await require('../src/features/vouches').postVouch(guild, buyer, { rating: 5, product: 'GTA V', review: 'Fast and legit, thank you!' });
  await require('../src/features/giveaways').start(guild, owner, { prize: 'Nitro', durationMs: 3_600_000, winners: 1 });
  await require('../src/features/welcome').onMemberAdd(guild.addMember(uid(), []));
  const snapshot = (key) => ch(guild, key).messageList.map((m) => m.id);
  const before = { vouches: snapshot('vouches'), giveaways: snapshot('giveaways'), welcome: snapshot('welcome') };
  const { steps } = await reloadAll(guild, { invokerId: guild.ownerId });
  assert.ok(steps.every((s) => s.ok), JSON.stringify(steps));
  for (const key of Object.keys(before)) assert.deepEqual(snapshot(key), before[key], `#${key} unchanged`);
});

test('/reload recreates deleted channels and roles and resets changed names and permissions', async () => {
  const guild = await builtGuild();
  const faq = ch(guild, 'faq');
  await faq.delete();
  const vip = guild.roles.cache.get(role(guild, 'vip'));
  await vip.delete();
  const chat = ch(guild, 'chat');
  await chat.edit({ name: 'renamed-by-someone', permissionOverwrites: [] });
  const { steps } = await reloadAll(guild, { invokerId: guild.ownerId });
  assert.ok(steps.every((s) => s.ok), JSON.stringify(steps));

  const newFaq = ch(guild, 'faq');
  assert.ok(newFaq && newFaq.id !== faq.id, '#faq recreated');
  assert.equal(newFaq.parentId, db.build(guild.id).categories.catSupport);
  assert.equal(newFaq.messageList.length, 2, 'banner + card posted again');
  assert.ok(guild.roles.cache.has(role(guild, 'vip')), 'VIP role recreated');
  assert.ok(ch(guild, 'vipChat').overwriteList.some((o) => o.id === role(guild, 'vip')), 'VIP lounge uses the new role');
  assert.equal(chat.name, '💬┃chat', 'name restored');
  const visitor = guild.addMember(uid(), []);
  assert.ok(!chat.permissionsFor(visitor).has(P.ViewChannel) && !chat.permissionsFor(visitor).has(P.AttachFiles));
  const member = guild.addMember(uid(), [role(guild, 'member')]);
  assert.ok(chat.permissionsFor(member).has(P.SendMessages));
  assert.ok(!chat.permissionsFor(member).has(P.AttachFiles), 'permissions are back to the layout');
});

test('/reload re-applies the server name and the NØX logo', async () => {
  const guild = await builtGuild();
  guild.name = 'Something else';
  guild.iconSet = null;
  await reloadAll(guild, { invokerId: guild.ownerId });
  assert.equal(guild.name, 'NØX');
  assert.ok(guild.iconSet.endsWith('logo-eclipse-nox.png'));
});

test('/reload works on servers built before message tracking (legacy) without duplicates', async () => {
  const guild = await builtGuild();
  const b = db.build(guild.id);
  delete b.posts;
  db.setBuild(guild.id, b);
  const counts = (key) => ch(guild, key).messageList.length;
  const before = { information: counts('information'), shop: counts('shop'), tickets: counts('tickets') };
  const { steps } = await reloadAll(guild, { invokerId: guild.ownerId });
  assert.ok(steps.every((s) => s.ok), JSON.stringify(steps));
  for (const key of Object.keys(before)) assert.equal(counts(key), before[key], `#${key} has no duplicates`);
  assert.equal(db.build(guild.id).posts.information.length, 10, 'posts are tracked from now on');
});

test('/reload hot-reloads edited scripts and keeps the old version when a script is broken', async () => {
  const original = fs.readFileSync(CONTENT, 'utf8');
  try {
    const guild = await builtGuild();
    const faq = ch(guild, 'faq');
    fs.writeFileSync(CONTENT, original.replace('Frequently asked questions', 'Questions & answers'));
    const ok = await reloadAll(guild, { invokerId: guild.ownerId });
    assert.ok(ok.steps.every((s) => s.ok), JSON.stringify(ok.steps));
    assert.match(textOf(faq.messageList[1].body), /Questions & answers/);

    fs.writeFileSync(CONTENT, `${original}\nthis is not javascript (`);
    const broken = await reloadAll(guild, { invokerId: guild.ownerId });
    assert.ok(broken.aborted);
    assert.match(broken.steps[0].detail, /content\.js/);
    // The last working version is still active.
    const { postsFor } = require('../src/builder/content');
    assert.ok(postsFor('faq', guild).length === 2);
  } finally {
    fs.writeFileSync(CONTENT, original);
    require('../src/builder/reload').reloadFiles();
  }
});

test('/reload with a broken config.json changes nothing', async () => {
  const original = fs.readFileSync(config.path, 'utf8');
  try {
    const guild = await builtGuild();
    fs.writeFileSync(config.path, '{ "brand": ');
    const { steps, aborted } = await reloadAll(guild, { invokerId: guild.ownerId });
    assert.ok(aborted);
    assert.match(steps[0].detail, /config\.json has an error/);
    assert.equal(config.brand.name, 'NØX', 'old config still active');
  } finally {
    fs.writeFileSync(config.path, original);
    config.reload();
  }
});

test('/reload command: admins get a summary, members are refused', async () => {
  const guild = await builtGuild();
  const member = guild.addMember(uid(), [role(guild, 'member')]);
  const denied = await run({ guild, member, kind: 'command', commandName: 'reload' });
  assert.match(textOf(lastResponse(denied)), /Only the server owner and administrators/);
  const owner = guild.members.cache.get(guild.ownerId);
  const done = await run({ guild, member: owner, kind: 'command', commandName: 'reload' });
  const text = textOf(lastResponse(done));
  assert.match(text, /NØX reloaded/);
  assert.match(text, /config\.json, layout\.js, content\.js reloaded/);
  assert.match(text, /updated in place/);
});

test('shop prices: plain numbers get the € sign', async () => {
  const guild = await builtGuild();
  const shop = require('../src/features/shop');
  shop.addProduct(guild, { name: 'GTA V', price: '20', description: 'Goat game' });
  shop.addProduct(guild, { name: 'Bundle', price: 'from 5€', description: 'Pick what you want' });
  const panel = textOf(await require('../src/lib/panels').render('shop', guild));
  assert.match(panel, /GTA V.*\*\*20€\*\*/);
  assert.match(panel, /\*\*from 5€\*\*/);
  const modal = shop.orderModal(db.guild(guild.id).products[0], guild);
  assert.match(JSON.stringify(modal.toJSON()), /20€/);
  assert.deepEqual(modal.toJSON().components.find((c) => c.component?.custom_id === 'payment').component.options.map((o) => o.label), ['PaysafeCard', 'Crypto', 'PayPal']);
  assert.ok(customIds(await require('../src/lib/panels').render('shop', guild)).length >= 2);
});
