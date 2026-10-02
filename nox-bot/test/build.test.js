'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { buildServer, repostAll } = require('../src/builder/executor');
const { ROLES, CATEGORIES } = require('../src/builder/layout');
const { EMOJI_PRIORITY } = require('../src/lib/theme');

const ALL_CHANNELS = CATEGORIES.flatMap((c) => c.channels);
const byKey = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const role = (guild, key) => db.roleId(guild.id, key);

async function build(opts = {}, buildOpts = {}) {
  const guild = new FakeGuild(opts);
  const R = await buildServer({ guild, mode: 'add', invokerId: guild.ownerId, ...buildOpts });
  return { guild, R };
}

test('builds the full NØX server on a fresh server without errors', async () => {
  const { guild, R } = await build();
  assert.equal(R.fatal, undefined, R.fatal);
  assert.deepEqual(R.errors, []);
  assert.equal(R.created.roles, ROLES.length);
  assert.equal(R.created.categories, CATEGORIES.length);
  assert.equal(R.created.channels, ALL_CHANNELS.length);
  assert.equal(guild.name, 'NØX');
  assert.ok(guild.iconSet, 'server icon set');
  assert.ok(R.community, 'community mode enabled');
  assert.ok(guild.welcomeScreen?.welcomeChannels.length >= 2, 'welcome screen');
  assert.equal(guild.autoModerationRules.cache.size, 6);
  // Announcement channels were converted after Community mode was enabled.
  assert.equal(byKey(guild, 'announcements').type, ChannelType.GuildAnnouncement);
  assert.equal(byKey(guild, 'restocks').type, ChannelType.GuildAnnouncement);
  // System channel = boosters, AFK configured.
  assert.equal(guild.settings.systemChannel, db.channelId(guild.id, 'boosters'));
  assert.equal(guild.settings.afkChannel, db.channelId(guild.id, 'afk'));
  // @everyone has no permissions (gated server).
  assert.equal(guild.roles.everyone.permissions.bitfield, 0n);
});

test('every channel with content got its banner and cards, live panels are registered', async () => {
  const { guild, R } = await build();
  for (const ch of ALL_CHANNELS.filter((c) => c.post)) {
    const channel = byKey(guild, ch.key);
    assert.ok(channel.messageList.length >= 2, `#${ch.name} has messages`);
    assert.ok(channel.messageList[0].files.length === 1, `#${ch.name} starts with a banner`);
  }
  const kinds = db.panels(guild.id).map((p) => p.kind).sort();
  assert.deepEqual(kinds, ['leaderboard', 'shop', 'tickets', 'vouches']);
  assert.ok(R.created.messages > 40);
  // Ticket system configured automatically.
  const s = db.settings(guild.id);
  assert.equal(s.categoryId, db.build(guild.id).categories.catTickets);
  assert.equal(s.logChannelId, db.channelId(guild.id, 'ticketLogs'));
  assert.equal(s.transcriptChannelId, db.channelId(guild.id, 'transcripts'));
  assert.ok(s.staffRoleIds.includes(role(guild, 'support')));
  assert.equal(db.build(guild.id).invite, 'https://discord.gg/noxtest');
});

test('roles are in the right order and the owner/bot/members get their roles', async () => {
  const { guild } = await build({ humans: 4 });
  const positions = ROLES.map((r) => guild.roles.cache.get(role(guild, r.key)).position);
  for (let i = 1; i < positions.length; i += 1) assert.ok(positions[i - 1] > positions[i], `${ROLES[i - 1].key} above ${ROLES[i].key}`);
  const owner = guild.members.cache.get(guild.ownerId);
  assert.ok(owner.roles.cache.has(role(guild, 'founder')));
  assert.ok(owner.roles.cache.has(role(guild, 'member')));
  assert.ok(guild.me.roles.cache.has(role(guild, 'bots')));
  const humans = [...guild.members.cache.values()].filter((m) => !m.user.bot);
  for (const m of humans) assert.ok(m.roles.cache.has(role(guild, 'member')), 'existing members are not locked out');
});

test('permissions: unverified users only see verify + rules, members see the server', async () => {
  const { guild } = await build();
  const visitor = guild.addMember('900000000000000001', []);
  const member = guild.addMember('900000000000000002', [role(guild, 'member')]);
  const can = (m, key, perm) => byKey(guild, key).permissionsFor(m).has(perm);

  // Visitor (not verified yet)
  assert.ok(can(visitor, 'verify', P.ViewChannel));
  assert.ok(can(visitor, 'rules', P.ViewChannel));
  assert.ok(!can(visitor, 'rules', P.SendMessages));
  assert.ok(!can(visitor, 'verify', P.SendMessages));
  for (const key of ['shop', 'chat', 'tickets', 'welcome', 'staffChat', 'serverLogs', 'vipChat']) assert.ok(!can(visitor, key, P.ViewChannel), `visitor cannot see #${key}`);
  assert.ok(can(visitor, 'statMembers', P.ViewChannel) && !can(visitor, 'statMembers', P.Connect), 'stats are visible but locked');

  // Verified member
  assert.ok(!can(member, 'verify', P.ViewChannel), 'verify disappears after verification');
  for (const key of ['rules', 'shop', 'howToBuy', 'payments', 'vouches', 'tickets', 'faq', 'chat', 'media', 'roles', 'giveaways']) {
    assert.ok(can(member, key, P.ViewChannel), `member sees #${key}`);
  }
  assert.ok(can(member, 'chat', P.SendMessages));
  assert.ok(!can(member, 'chat', P.AttachFiles), 'no files in chat');
  assert.ok(can(member, 'media', P.AttachFiles), 'files allowed in media');
  for (const key of ['shop', 'rules', 'announcements', 'tickets', 'vouches', 'giveaways']) assert.ok(!can(member, key, P.SendMessages), `#${key} is read-only`);
  for (const key of ['staffChat', 'ticketLogs', 'serverLogs', 'vipChat', 'discordUpdates']) assert.ok(!can(member, key, P.ViewChannel), `member cannot see #${key}`);
  assert.ok(can(member, 'lounge', P.Speak));
  assert.ok(!can(member, 'afk', P.Speak));
});

test('permissions: staff, sellers and VIPs see exactly their areas', async () => {
  const { guild } = await build();
  const m = role(guild, 'member');
  const support = guild.addMember('900000000000000003', [m, role(guild, 'support')]);
  const seller = guild.addMember('900000000000000004', [m, role(guild, 'seller')]);
  const mod = guild.addMember('900000000000000005', [m, role(guild, 'moderator')]);
  const vip = guild.addMember('900000000000000006', [m, role(guild, 'vip')]);
  const admin = guild.addMember('900000000000000007', [m, role(guild, 'admin')]);
  const can = (x, key, perm) => byKey(guild, key).permissionsFor(x).has(perm);

  assert.ok(can(support, 'staffChat', P.ViewChannel));
  assert.ok(can(support, 'ticketLogs', P.ViewChannel) && can(support, 'transcripts', P.ViewChannel));
  assert.ok(!can(support, 'serverLogs', P.ViewChannel), 'server logs are for moderators');
  assert.ok(can(mod, 'serverLogs', P.ViewChannel) && !can(mod, 'serverLogs', P.SendMessages));
  assert.ok(can(seller, 'restocks', P.SendMessages), 'sellers post restocks');
  assert.ok(!can(seller, 'announcements', P.SendMessages));
  assert.ok(can(admin, 'announcements', P.SendMessages));
  assert.ok(can(admin, 'verify', P.ViewChannel), 'admins still see #verify');
  assert.ok(can(admin, 'discordUpdates', P.ViewChannel) && !can(support, 'discordUpdates', P.ViewChannel));
  assert.ok(can(vip, 'vipChat', P.ViewChannel) && can(vip, 'vipChat', P.SendMessages));
  assert.ok(!can(vip, 'staffChat', P.ViewChannel));
  assert.ok(can(support, 'vipChat', P.ViewChannel), 'staff can moderate the VIP lounge');
});

test('emojis: fills the 50 free slots in priority order and reports the rest', async () => {
  const { guild, R } = await build();
  assert.equal(guild.emojis.cache.size, 50);
  assert.equal(R.created.emojis, 50);
  const uploaded = Object.keys(db.emojiIds(guild.id));
  assert.deepEqual(uploaded.sort(), EMOJI_PRIORITY.slice(0, 50).sort());
  assert.ok(R.warnings.some((w) => w.includes('/build only:emojis')));
  // Panels use the custom emojis now.
  const verify = byKey(guild, 'verify').messageList[1];
  assert.match(JSON.stringify(verify.components), /nox_check/);
});

test('emojis: a boosted server gets all of them, a rate limit stops uploads gracefully', async () => {
  const boosted = await build({ premiumTier: 2 });
  assert.equal(boosted.guild.emojis.cache.size, EMOJI_PRIORITY.length);
  const limited = await build({ emojiRateLimitAfter: 10 });
  assert.equal(limited.guild.emojis.cache.size, 10);
  assert.deepEqual(limited.R.errors, []);
  assert.ok(limited.R.warnings.some((w) => w.includes('Discord limits how fast')));
});

test('wipe & build removes the old server (except the channel /build was used in)', async () => {
  const guild = new FakeGuild({ community: true, existingChannels: 6, existingRoles: 5 });
  const old = [...guild.channels.cache.values()];
  const origin = old[0];
  Object.assign(guild.settings, { rulesChannel: old[1].id, publicUpdatesChannel: old[2].id }); // old Community channels
  await guild.autoModerationRules.create({ name: 'Old spam', triggerType: 3, eventType: 1, actions: [{ type: 1 }] });
  const R = await buildServer({ guild, mode: 'wipe', invokerId: guild.ownerId, keepChannelIds: [origin.id] });
  assert.deepEqual(R.errors, []);
  assert.ok(guild.channels.cache.has(origin.id), 'origin channel kept');
  for (const c of old.slice(1)) assert.ok(!guild.channels.cache.has(c.id), `old #${c.name} deleted`);
  assert.equal([...guild.roles.cache.values()].filter((r) => r.name.startsWith('Old role')).length, 0);
  assert.equal(guild.autoModerationRules.cache.size, 6, 'old AutoMod rule replaced by the NØX rules');
  assert.equal(R.created.channels, ALL_CHANNELS.length);
});

test('building twice without a wipe warns about existing single-instance AutoMod rules but still works', async () => {
  const { guild } = await build();
  const R2 = await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  assert.deepEqual(R2.errors, []);
  assert.ok(R2.warnings.some((w) => w.includes('already has a rule')));
});

test('the build can be stopped', async () => {
  let ticks = 0;
  const { R } = await build({}, { onProgress: () => (ticks += 1), shouldAbort: () => ticks > 20 });
  assert.ok(R.aborted);
  assert.ok(R.created.channels < ALL_CHANNELS.length);
});

test('repost re-publishes all banners and panels without duplicates', async () => {
  const { guild } = await build();
  const before = byKey(guild, 'faq').messageList.length;
  const res = await repostAll(guild);
  assert.deepEqual(res.errors, []);
  assert.equal(byKey(guild, 'faq').messageList.length, before);
  assert.equal(db.panels(guild.id).length, 4);
});

test('without Community mode the build still works (announcement channels stay text)', async () => {
  const config = require('../src/lib/config');
  const prev = config.server.community;
  config.server.community = false;
  try {
    const { guild, R } = await build();
    assert.deepEqual(R.errors, []);
    assert.equal(R.community, false);
    assert.equal(byKey(guild, 'announcements').type, ChannelType.GuildText);
  } finally {
    config.server.community = prev;
  }
});

test('the server icon uses the logo chosen in config.json', async () => {
  const config = require('../src/lib/config');
  const { logoPath } = require('../src/builder/executor');
  const prev = config.server.logo;
  try {
    for (const name of ['eclipse-nox', 'eclipse', 'eclipse-wordmark', 'night', 'neon']) {
      config.server.logo = name;
      const { guild } = await build();
      assert.ok(guild.iconSet.endsWith(`logo-${name}.png`), name);
    }
    assert.ok(logoPath('does-not-exist').endsWith('logo-eclipse-nox.png'), 'unknown names fall back to the default logo');
  } finally {
    config.server.logo = prev;
  }
});
