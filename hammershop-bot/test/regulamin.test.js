'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { refreshContent } = require('../src/builder/refresh');
const content = require('../src/builder/content');
const config = require('../src/lib/config');

async function built() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}
const cards = (guild) => content.postsFor('rules', guild).filter((p) => p.payload);

test('#rules shows regulamin.md: banner + cards within Discord limits, every placeholder filled in', async () => {
  const guild = await built();
  const posts = content.postsFor('rules', guild);
  assert.equal(posts[0].banner, 'rules');
  const list = cards(guild);
  assert.ok(list.length >= 2, 'the regulamin is long – it is split over several cards');
  const all = list
    .map((p) => {
      validateMessage(p.payload, guild);
      const t = textOf(p.payload);
      assert.ok(t.length <= 4000, `card text ${t.length} > 4000`);
      return t;
    })
    .join('\n');
  assert.match(all, /^# 📜 Regulamin HammerShop/);
  for (let n = 1; n <= 10; n += 1) assert.match(all, new RegExp(`§${n} · `), `§${n}`);
  assert.doesNotMatch(all, /\{[#a-zA-Z:]/, 'no placeholder left');
  assert.doesNotMatch(all, /<!--|WAŻNE: uzupełnij/, 'the comment for the owner is not published');
  assert.ok(all.includes(`<#${db.channelId(guild.id, 'tickets')}>`), 'links to the ticket channel');
  assert.ok(all.includes(`<#${db.channelId(guild.id, 'shop')}>`));
  assert.match(all, /<:hs_cart:\d+>/, 'the orange emojis');
  for (const m of config.shop.paymentMethods) assert.ok(all.includes(`**${m.name}**`), `payment method ${m.name}`);
  assert.doesNotMatch(all, /Sprzedawca:\*\*/, 'no seller line until rules.seller is filled in');
});

test('rules.seller / rules.email appear in §1 once filled in, and /build only:panels updates #rules in place', async () => {
  const guild = await built();
  const before = { ...config.rules };
  try {
    config.rules.seller = 'Jan Kowalski, ul. Przykładowa 1, 00-001 Warszawa';
    config.rules.email = 'kontakt@hammershop.pl';
    const all = cards(guild).map((p) => textOf(p.payload)).join('\n');
    assert.match(all, /🏢 \*\*Sprzedawca:\*\* Jan Kowalski, ul\. Przykładowa 1, 00-001 Warszawa/);
    assert.match(all, /✉️ \*\*E-mail:\*\* kontakt@hammershop\.pl/);
    const channel = guild.channels.cache.get(db.channelId(guild.id, 'rules'));
    const count = channel.messageList.length;
    await refreshContent(guild);
    assert.equal(channel.messageList.length, count, 'edited in place');
    assert.ok(channel.messageList.some((m) => /Jan Kowalski/.test(textOf(m.body))));
  } finally {
    Object.assign(config.rules, before);
  }
});

test('no regulamin.md → the built-in server rules (Polish)', async () => {
  const guild = await built();
  const real = fs.readFileSync;
  fs.readFileSync = (file, ...rest) => {
    if (String(file) === content.rulesFile()) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return real.call(fs, file, ...rest);
  };
  try {
    const list = cards(guild);
    assert.equal(list.length, 1);
    assert.match(textOf(list[0].payload), /HammerShop – Zasady serwera/);
  } finally {
    fs.readFileSync = real;
  }
});
