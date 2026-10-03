'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const imp = require('../src/features/impersonation');

const commands = loadCommands();
const DAY = 86_400_000;

let n = 950000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);

/** A member with a real-looking profile (the fake's default "user<id>" names would all look alike). */
function person(guild, { username, globalName = null, nickname = null, avatar = null, roles = ['member'], bot = false, ageDays = 400 } = {}) {
  const m = guild.addMember(uid(), roles.map((k) => role(guild, k)), { bot, createdTimestamp: Date.now() - ageDays * DAY });
  Object.assign(m.user, { username, globalName, avatar, client: guild.client });
  m.nickname = nickname;
  m.avatar = null;
  return m;
}

async function setup() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  Object.assign(guild.members.cache.get(guild.ownerId).user, { username: 'owner.nox', globalName: 'Founder' });
  const staff = person(guild, { username: 'alex.nox', globalName: 'Alex', nickname: 'Alex | NØX Support', avatar: 'a_staffhash', roles: ['member', 'support'] });
  const mod = person(guild, { username: 'daniel', globalName: 'Daniel', roles: ['member', 'moderator'] });
  return { guild, staff, mod };
}

const alerts = (guild) => guild.channels.cache.get(db.channelId(guild.id, 'automodLogs')).messageList;
const lastAlert = (guild) => Object.values(imp.store(guild.id).alerts).sort((a, b) => a.at - b.at).at(-1);
const press = async (guild, who, action, alert) => {
  const message = alerts(guild).find((m) => m.id === alert.messageId);
  const i = createInteraction({ guild, member: who, kind: 'button', customId: `imp:${action}:${alert.id}`, message });
  await handle(i, commands);
  return i;
};
const join = async (guild, profile) => {
  const m = person(guild, { roles: [], ...profile });
  await hooks.emit('memberAdd', m);
  return m;
};

// ───────────── Names ─────────────

test('normalise: lowercase, no accents, look-alike characters, only letters and digits, no repeated letters', () => {
  const cases = {
    Alex: 'alex',
    'Ålëx': 'alex',
    A1ex: 'alex',
    AIex: 'alex', // capital i
    '4l3x': 'alex',
    'аlex': 'alex', // Cyrillic а
    '𝐀𝐥𝐞𝐱': 'alex',
    'Ａｌｅｘ': 'alex',
    'Aaaalex!!': 'alex',
    'A|ex': 'alex',
    '$upp0rt': 'suport',
    '7@m@r': 'tamar',
    'Alex | NØX Support': 'alexnoxsuport',
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(imp.normalize(name), expected, name);
  assert.equal(imp.distance('jhon', 'john'), 1, 'a swap of two letters is one edit');
  assert.equal(imp.distance('daniel', 'danlel'), 1);
  assert.equal(imp.core('Alex | NØX Support'), 'Alex', 'titles are stripped from staff nicknames');
  assert.equal(imp.core('Modesto'), null);
});

test('matching: exact names, staff name + title, one letter off for 5+ characters – and no false positives', () => {
  const yes = [
    ['A1ex', 'Alex', 'exact'],
    ['ALEX', 'alex', 'exact'],
    ['alex_support', 'Alex', 'title'],
    ['Support | Alex', 'Alex', 'title'],
    ['Alex NØX Team', 'Alex', 'title'],
    ['real.alex.admin', 'Alex', 'title'],
    ['Danlel', 'Daniel', 'similar'],
    ['Jhonny', 'Johnny', 'similar'],
    ['Dainel', 'Daniel', 'similar'], // two letters swapped
    ['Danie1l', 'Daniel', 'exact'], // 1 → l, then the double l collapses
  ];
  for (const [name, staff, kind] of yes) assert.equal(imp.compare(name, staff), kind, `${name} vs ${staff}`);

  const no = [
    ['Alec', 'Alex'], // one letter off, but only 4 characters
    ['Alexander', 'Alex'],
    ['Alexa', 'Alex'],
    ['Michael', 'Daniel'],
    ['shadow_gamer', 'Shadow'],
    ['Kevin', 'Alex'],
    ['Modesto', 'Mod'],
    ['Lucas', 'Luca'],
    ['Al', 'Al'], // too short to mean anything
  ];
  for (const [name, staff] of no) assert.equal(imp.compare(name, staff), null, `${name} vs ${staff}`);
  assert.equal(imp.compare('NØX Support', 'NØX', { titleOnly: true }), 'title');
  assert.equal(imp.compare('NØX', 'NØX', { titleOnly: true }), null, 'just the brand name is fine');
  assert.equal(imp.compare('NØX Fan', 'NØX', { titleOnly: true }), null);
});

// ───────────── Alerts ─────────────

test('a look-alike joining gets an alert card in #automod-logs: who, which staff member, account age, moderator buttons', async () => {
  const { guild, staff } = await setup();
  const before = alerts(guild).length;
  const fake = await join(guild, { username: 'alexx_99', globalName: 'A1ex', ageDays: 2 });

  assert.equal(alerts(guild).length, before + 1);
  const alert = lastAlert(guild);
  assert.equal(alert.userId, fake.id);
  assert.equal(alert.trigger, 'join');
  assert.deepEqual(alert.matches.map((m) => [m.kind, m.field, m.staffId]), [['exact', 'globalName', staff.id]]);

  const card = alerts(guild).at(-1).body;
  validateMessage(card, guild);
  const out = textOf(card);
  assert.match(out, /Possible staff impersonation/);
  assert.ok(out.includes(`<@${fake.id}>`) && out.includes(fake.id), 'the member and their ID');
  assert.match(out, /joined the server/);
  assert.match(out, /\*\*Display name\*\* “A1ex” – the same name as <@\d+> \(“Alex”\)/);
  assert.ok(out.includes(`<@${staff.id}>`), 'the staff member they look like');
  assert.match(out, /Account created:\*\* <t:\d+:D> \(<t:\d+:R>\).*new account/);
  assert.deepEqual(customIds(card), ['ban', 'kick', 'timeout', 'ignore'].map((a) => `imp:${a}:${alert.id}`));
  assert.deepEqual(card.allowedMentions, { parse: [] }, 'nobody is pinged');

  // Staff name + title, the brand as "the team" and the same avatar
  await join(guild, { username: 'helpdesk01', nickname: 'Alex • Support' });
  assert.equal(lastAlert(guild).matches[0].kind, 'title');
  await join(guild, { username: 'nox_support' });
  assert.match(textOf(alerts(guild).at(-1).body), /poses as the \*\*NØX\*\* team/);
  await join(guild, { username: 'randomguy', avatar: 'a_staffhash' });
  assert.deepEqual(lastAlert(guild).matches.map((m) => [m.kind, m.staffId]), [['avatar', staff.id]]);
  assert.match(textOf(alerts(guild).at(-1).body), /\*\*Avatar\*\* – the same picture as/);
});

test('staff, bots and ordinary names are never flagged; alerts can be turned off', async () => {
  const { guild } = await setup();
  const before = alerts(guild).length;
  const secondAlex = person(guild, { username: 'alex.mod', globalName: 'Alex', roles: ['member', 'moderator'] });
  await hooks.emit('memberAdd', secondAlex);
  await join(guild, { username: 'alexbot', globalName: 'Alex', bot: true });
  for (const name of ['Michael', 'Alexander', 'Kevin', 'shadow_gamer', 'Lucas', 'NØX fan', 'supportive', 'Danny']) {
    await join(guild, { username: name.toLowerCase().replace(/\W/g, ''), globalName: name });
  }
  assert.equal(alerts(guild).length, before, 'no alerts');

  config.security.impersonationAlerts = false;
  try {
    await join(guild, { username: 'alex_support' });
    assert.equal(alerts(guild).length, before);
  } finally {
    config.security.impersonationAlerts = true;
  }
});

test('staff also means hand-made admin roles and the ticket staff roles from /setup', async () => {
  const { guild } = await setup();
  const adminRole = await guild.roles.create({ name: 'Boss', permissions: PermissionFlagsBits.Administrator });
  const helperRole = await guild.roles.create({ name: 'Helpers', permissions: 0n });
  db.updateSettings(guild.id, { staffRoleIds: [helperRole.id] });
  const zoe = person(guild, { username: 'zoe.rose', globalName: 'Zoe Rose' });
  zoe.roles.cache.set(adminRole.id, adminRole);
  const max = person(guild, { username: 'maximilian', globalName: 'Maximilian' });
  max.roles.cache.set(helperRole.id, helperRole);
  const ids = imp.staffProfiles(guild).map((s) => s.id);
  assert.ok(ids.includes(zoe.id) && ids.includes(max.id));

  await join(guild, { username: 'zoe_r0se_', globalName: 'Zoe R0se' });
  assert.equal(lastAlert(guild).matches[0].staffId, zoe.id);
  await join(guild, { username: 'maximillian' });
  assert.deepEqual(lastAlert(guild).matches.map((m) => [m.kind, m.staffId]), [['exact', max.id]], 'll collapses to l');
});

test('one alert per user + name per 24 hours; Ignore silences that user + name for good', async () => {
  const { guild, mod } = await setup();
  const fake = await join(guild, { username: 'danlel' });
  const count = () => alerts(guild).length;
  const first = count();
  const alert = lastAlert(guild);

  // Changing something else re-checks the profile, but the same name isn't reported again
  let old = fake.snapshot();
  fake.nickname = 'just chilling';
  await hooks.emit('memberUpdate', old, fake);
  assert.equal(count(), first, 'no repeat within 24 hours');

  alert.at -= 25 * 3_600_000;
  old = fake.snapshot();
  fake.nickname = 'still chilling';
  await hooks.emit('memberUpdate', old, fake);
  assert.equal(count(), first + 1, 'reported again after 24 hours');

  const again = lastAlert(guild);
  const ignore = await press(guild, mod, 'ignore', again);
  const card = ignore.state.updates[0];
  validateMessage(card, guild);
  assert.match(textOf(card), new RegExp(`Ignored – this name won't be reported again\\*\\* by <@${mod.id}>`));
  assert.deepEqual(customIds(card), [], 'no buttons after Ignore');
  assert.ok(imp.store(guild.id).ignored[`${fake.id}:danlel`]);

  again.at -= 25 * 3_600_000;
  old = fake.snapshot();
  fake.nickname = 'chilling again';
  await hooks.emit('memberUpdate', old, fake);
  assert.equal(count(), first + 1, 'ignored for good');

  // A different look-alike name is a new alert
  old = fake.snapshot();
  fake.nickname = 'Daniel Staff';
  await hooks.emit('memberUpdate', old, fake);
  assert.equal(count(), first + 2);
  assert.equal(lastAlert(guild).trigger, 'nickname');
  assert.deepEqual(lastAlert(guild).matches.map((m) => m.kind), ['title']);
});

test('buttons: only moderators – timeout, ban and kick act on the member and show the result on the card', async () => {
  const { guild, mod } = await setup();
  const support = person(guild, { username: 'helper.sam', roles: ['member', 'support'] });
  const member = person(guild, { username: 'buyer.joe' });
  const fake = await join(guild, { username: 'alex_staff' });
  const alert = lastAlert(guild);

  for (const who of [member, support]) {
    const denied = await press(guild, who, 'ban', alert);
    assert.match(textOf(lastResponse(denied)), /Only moderators and administrators/);
    assert.equal(denied.state.updates.length, 0);
  }
  assert.ok(guild.members.cache.has(fake.id), 'nothing happened');

  const timeout = await press(guild, mod, 'timeout', alert);
  assert.ok(Math.abs(fake.communicationDisabledUntilTimestamp - (Date.now() + DAY)) < 5000, 'timed out for 24 hours');
  const timedOut = timeout.state.updates[0];
  assert.match(textOf(timedOut), new RegExp(`Timed out for 24 hours\\*\\* by <@${mod.id}>`));
  assert.deepEqual(customIds(timedOut), ['ban', 'kick', 'ignore'].map((a) => `imp:${a}:${alert.id}`), 'Ban / Kick / Ignore stay');

  const ban = await press(guild, mod, 'ban', alert);
  assert.ok(guild.bans.cache.has(fake.id), 'banned');
  assert.match(guild.bans.cache.get(fake.id).reason, /impersonation alert/);
  assert.ok(!guild.members.cache.has(fake.id));
  const banned = ban.state.updates[0];
  validateMessage(banned, guild);
  assert.match(textOf(banned), /Banned\*\* by/);
  assert.deepEqual(customIds(banned), []);

  const twice = await press(guild, mod, 'kick', alert);
  assert.match(textOf(lastResponse(twice)), /already handled: \*\*Banned\*\*/);

  // Kick, and a member who already left
  const other = await join(guild, { username: 'danlel' });
  const kickAlert = lastAlert(guild);
  await press(guild, mod, 'kick', kickAlert);
  assert.ok(!guild.members.cache.has(other.id));
  assert.equal(kickAlert.actions[0].action, 'kick');

  const gone = await join(guild, { username: 'alex_admin' });
  guild.removeMember(gone.id);
  const late = await press(guild, mod, 'kick', lastAlert(guild));
  assert.match(textOf(lastResponse(late)), /no longer on the server/);

  const old = createInteraction({ guild, member: mod, kind: 'button', customId: 'imp:ban:deadbeef' });
  await handle(old, commands);
  assert.match(textOf(lastResponse(old)), /too old/);
});

test('profile changes: username, display name, server nickname and avatars are checked', async () => {
  const { guild, staff } = await setup();
  const m = person(guild, { username: 'quiet.one' });
  const count = () => alerts(guild).length;
  const start = count();

  let old = m.snapshot();
  m.user.username = 'alex_nox';
  await hooks.emit('userUpdate', old.user, m.user);
  assert.equal(count(), start + 1);
  assert.equal(lastAlert(guild).trigger, 'username');
  assert.match(textOf(alerts(guild).at(-1).body), /changed their username/);

  old = m.snapshot();
  m.user.globalName = 'Danie1';
  await hooks.emit('userUpdate', old.user, m.user);
  assert.equal(lastAlert(guild).trigger, 'globalName');
  assert.equal(lastAlert(guild).matches.at(-1).kind, 'exact');

  old = m.snapshot();
  m.avatar = 'a_staffhash'; // server avatar
  await hooks.emit('memberUpdate', old, m);
  assert.equal(lastAlert(guild).trigger, 'guildAvatar');
  assert.deepEqual(lastAlert(guild).matches.map((x) => [x.kind, x.staffId]), [['avatar', staff.id]]);

  // Role changes (e.g. verification) don't re-check anything
  const total = count();
  old = m.snapshot();
  await hooks.emit('memberUpdate', old, m);
  assert.equal(count(), total);

  // A partial old member (not cached) is checked, but known matches aren't repeated
  await hooks.emit('memberUpdate', { partial: true }, m);
  assert.equal(count(), total);
});

test('the alert card stays within Discord limits with long names and every kind of match', async () => {
  const { guild } = await setup();
  const long = 'Ⓐ'.repeat(32);
  const alert = {
    id: 'abcd1234',
    userId: '123456789012345678',
    username: 'x'.repeat(32),
    avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
    createdAt: Date.now() - DAY,
    joinedAt: Date.now(),
    trigger: 'profile',
    matches: [
      { key: 'a', kind: 'exact', field: 'username', name: long, staffId: '1', staffName: long },
      { key: 'b', kind: 'title', field: 'globalName', name: `${long}*_\`~|>`, staffId: null, staffName: 'NØX' },
      { key: 'c', kind: 'similar', field: 'nickname', name: long, staffId: '1', staffName: long },
      { key: 'd', kind: 'avatar', field: 'avatar', name: null, staffId: '1', staffName: null },
    ],
    at: Date.now(),
    actions: [{ action: 'timeout', by: '1', at: Date.now() }],
  };
  const r = validateMessage(imp.alertCard(guild, alert), guild);
  assert.ok(r.total <= 40 && r.textLength <= 4000);
});
