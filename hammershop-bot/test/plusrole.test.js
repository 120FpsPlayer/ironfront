'use strict';

// 💎 Hammer+ on Discord: the role follows the Hammer+ of the person's Minecraft account.
const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { env } = require('../src/env');
const hammerplus = require('../src/features/hammerplus');
const plusrole = require('../src/features/plusrole');
const website = require('../src/features/website');
const layout = require('../src/builder/layout.launcher');

env.plusPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const DAY = 86_400_000;
const mc = () => crypto.randomBytes(16).toString('hex');
const roleOf = (guild) => guild.roles.cache.find((r) => r.name === '💎 Hammer+');
const has = (guild, id) => Boolean(roleOf(guild) && guild.members.cache.get(id)?.roles.cache.has(roleOf(guild).id));

test('the launcher server is built with the 💎 Hammer+ role, which nobody hands out by hand', () => {
  const r = layout.ROLES.find((x) => x.key === 'hammerPlus');
  assert.deepEqual([r.name, r.perms, r.hoist], ['💎 Hammer+', 'none', true]);
});

test('Hammer+ running → the role (made the first time it is needed); ended → the role goes', async () => {
  const guild = new FakeGuild();
  db.guild(guild.id);
  const now = Date.now();
  guild.addMember('300000000000000001');
  hammerplus.grantKnown(guild.id, { mc: mc(), nick: 'Gracz', days: 30, now, discordId: '300000000000000001' });
  assert.equal(await plusrole.sync(guild, '300000000000000001', now), 'added');
  assert.ok(has(guild, '300000000000000001'));
  assert.equal(roleOf(guild).hoist, true);
  assert.equal(db.guild(guild.id).plusRoleId, roleOf(guild).id, 'remembered, so a renamed role is still found');
  assert.equal(await plusrole.sync(guild, '300000000000000001', now), 'kept');
  // 31 days later the month is over.
  assert.equal(await plusrole.sync(guild, '300000000000000001', now + 31 * DAY), 'removed');
  assert.equal(has(guild, '300000000000000001'), false);
  // Somebody without Hammer+ is left alone – and no role is made just for them.
  const other = new FakeGuild();
  other.addMember('300000000000000002');
  assert.equal(await plusrole.sync(other, '300000000000000002', now), 'none');
  assert.equal(roleOf(other), undefined);
});

test('time added later on the same Minecraft account (by anybody) keeps the role', async () => {
  const guild = new FakeGuild();
  const now = Date.now();
  const account = mc();
  guild.addMember('300000000000000003');
  hammerplus.grantKnown(guild.id, { mc: account, nick: 'Kowal', days: 30, now, discordId: '300000000000000003' });
  hammerplus.grantKnown(guild.id, { mc: account, nick: 'Kowal', days: 90, now, by: '1' }); // /hammerplus grant without "user"
  assert.equal(await plusrole.sync(guild, '300000000000000003', now + 40 * DAY), 'added');
});

test('bought but not on the server: nothing to give yet – the DM brings the invite; joining gives the role', async () => {
  const guild = new FakeGuild();
  const now = Date.now();
  guild.unknownMembers = new Set(['300000000000000004']);
  const { code, record } = hammerplus.grantKnown(guild.id, { mc: mc(), nick: 'Nowy', days: 30, now, discordId: '300000000000000004' });
  assert.equal(await plusrole.sync(guild, '300000000000000004', now), 'not-member');
  env.web.invite = 'https://discord.gg/hammerlauncher';
  try {
    const order = { id: 'o1', amount: 1500 };
    const outside = textOf(website.plusDm(guild, order, code, record, 'not-member'));
    assert.match(outside, /dołącz do naszego serwera Discord – zaraz po wejściu dostaniesz ją automatycznie/);
    assert.match(JSON.stringify(website.plusDm(guild, order, code, record, 'not-member')), /discord\.gg\/hammerlauncher/);
    const inside = textOf(website.plusDm(guild, order, code, record, 'added'));
    assert.match(inside, /Masz też rangę \*\*💎 Hammer\+\*\* na naszym serwerze/);
    assert.doesNotMatch(JSON.stringify(website.plusDm(guild, order, code, record, 'added')), /discord\.gg\/hammerlauncher/, 'no invite for someone who is already there');
  } finally {
    env.web.invite = '';
  }
  // They join: the role comes with them.
  guild.unknownMembers.clear();
  guild.addMember('300000000000000004');
  assert.equal(await plusrole.sync(guild, '300000000000000004', now), 'added');
});

test('the sweep every 30 minutes: the role for all whose Hammer+ runs, off for all whose ended', async () => {
  const guild = new FakeGuild();
  const now = Date.now();
  for (const id of ['300000000000000005', '300000000000000006', '300000000000000007']) guild.addMember(id);
  hammerplus.grantKnown(guild.id, { mc: mc(), nick: 'Aktywny', days: 0, now, discordId: '300000000000000005' });
  hammerplus.grantKnown(guild.id, { mc: mc(), nick: 'Wygasly', days: 1, now: now - 5 * DAY, discordId: '300000000000000006' });
  const role = await plusrole.role(guild, { create: true });
  await guild.members.cache.get('300000000000000006').roles.add(role);
  await guild.members.cache.get('300000000000000007').roles.add(role); // given by hand, no Hammer+ at all
  assert.deepEqual(await plusrole.syncAll(guild, now), { added: 1, removed: 2 });
  assert.deepEqual(['300000000000000005', '300000000000000006', '300000000000000007'].map((id) => has(guild, id)), [true, false, false]);
  assert.deepEqual(await plusrole.syncAll(guild, now), { added: 0, removed: 0 }, 'nothing left to do');
});

test('/hammerplus grant can name the Discord account – that account counts for the role', async () => {
  const guild = new FakeGuild();
  hammerplus.setFetch(async (url) => ({ ok: true, status: 200, json: async () => ({ id: mc(), name: decodeURIComponent(String(url).split('/').pop()) }) }));
  try {
    const { record } = await hammerplus.grant(guild.id, { nick: 'Steve', days: 30, by: '1', discordId: '300000000000000008' });
    assert.equal(record.discordId, '300000000000000008');
    assert.ok(plusrole.hasPlus(guild.id, '300000000000000008'));
  } finally {
    hammerplus.setFetch(null);
  }
});
