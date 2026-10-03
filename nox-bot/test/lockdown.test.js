'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const lockdown = require('../src/features/lockdown');

const commands = loadCommands();

let n = 960000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));

const command = async (guild, who, commandName, options = {}) => {
  const i = createInteraction({ guild, member: who, kind: 'command', commandName, options });
  await handle(i, commands);
  return i;
};

async function setup() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, mod: member(guild, ['member', 'moderator']) };
}

/** Every role's permissions and every channel overwrite – to compare before / after. */
function snapshot(guild) {
  return {
    roles: Object.fromEntries([...guild.roles.cache.values()].map((r) => [r.id, String(r.permissions.bitfield)])),
    overwrites: Object.fromEntries(
      [...guild.channels.cache.values()].map((c) => [c.id, (c.overwriteList ?? []).map((o) => `${o.id}:${o.allow}:${o.deny}`).sort().join('|')]),
    ),
    features: [...guild.features].sort(),
  };
}

const can = (who, channel, flag) => who.permissionsIn(channel).has(flag);

test('/lockdown and /unlock: moderators and admins only', async () => {
  const { guild } = await setup();
  const before = snapshot(guild);
  for (const who of [member(guild), member(guild, ['member', 'support']), member(guild, ['member', 'seller'])]) {
    const lock = await command(guild, who, 'lockdown', { reason: 'test' });
    assert.match(textOf(lastResponse(lock)), /Only moderators and administrators can lock the server/);
    const unlock = await command(guild, who, 'unlock');
    assert.match(textOf(lastResponse(unlock)), /Only moderators and administrators can unlock the server/);
  }
  assert.deepEqual(snapshot(guild), before, 'nothing changed');
  assert.equal(lockdown.current(guild.id), null);
  for (const name of ['lockdown', 'unlock']) {
    assert.equal(commands.get(name).data.toJSON().default_member_permissions, String(P.ModerateMembers), `/${name} is hidden from members`);
  }
});

test('lockdown → unlock round trip: members are silenced, staff can still talk, everything comes back exactly', async () => {
  const { guild, mod } = await setup();
  const buyer = member(guild);
  const staff = { support: member(guild, ['member', 'support']), seller: member(guild, ['member', 'seller']), trial: member(guild, ['member', 'trialSupport']), mod };
  const chat = ch(guild, 'chat');
  const lounge = ch(guild, 'lounge');
  const announcements = ch(guild, 'announcements');
  const memberRole = guild.roles.cache.get(role(guild, 'member'));
  const before = snapshot(guild);
  const memberBefore = memberRole.permissions.bitfield;
  assert.ok(can(buyer, chat, P.SendMessages) && can(buyer, lounge, P.Connect), 'members can talk before');
  assert.ok(can(buyer, announcements, P.AddReactions), 'members react in read-only channels through a channel overwrite');

  const lock = await command(guild, mod, 'lockdown', { reason: 'Raid in progress' });
  const reply = textOf(lastResponse(lock));
  assert.match(reply, /Server locked/);
  assert.match(reply, /can't send messages, react, create threads or use voice/);
  assert.match(reply, /Invites are paused/);
  assert.match(reply, /Staff roles keep their own permissions/);
  assert.match(reply, /Raid in progress/);

  // The Member role lost exactly the locked permissions
  for (const name of lockdown.LOCKED) assert.ok(!memberRole.permissions.has(P[name]), `Member role has no ${name}`);
  assert.equal(memberRole.permissions.bitfield, memberBefore & ~lockdown.LOCK_BITS, 'everything else is untouched');
  assert.ok(memberRole.permissions.has(P.ViewChannel) && memberRole.permissions.has(P.ReadMessageHistory), 'members can still read');

  // Members are quiet everywhere – also where a channel overwrite allowed reactions
  for (const [flag, channel] of [[P.SendMessages, chat], [P.AddReactions, chat], [P.CreatePublicThreads, chat], [P.Connect, lounge], [P.Speak, lounge], [P.AddReactions, announcements]]) {
    assert.ok(!can(buyer, channel, flag), `member blocked in #${channel.name}`);
  }
  // …but the staff keep talking
  for (const [name, who] of Object.entries(staff)) {
    assert.ok(can(who, chat, P.SendMessages), `${name} can send in #chat`);
    assert.ok(can(who, lounge, P.Connect) && can(who, lounge, P.Speak), `${name} can use voice`);
  }

  // Stored for /unlock (survives restarts), invites paused, notice posted
  const state = lockdown.current(guild.id);
  assert.equal(state.by, mod.id);
  assert.equal(state.reason, 'Raid in progress');
  assert.equal(state.memberPermissions, String(memberBefore));
  assert.ok(state.channels.length > 0 && state.channels.some((c) => c.id === announcements.id));
  assert.equal(state.invitesPaused, true);
  assert.ok(guild.features.includes('INVITES_DISABLED'));
  const notice = announcements.messageList.at(-1);
  assert.match(textOf(notice.body), /The server is locked[\s\S]*Raid in progress[\s\S]*open tickets keep working/);
  assert.match(textOf(ch(guild, 'serverLogs').messageList.at(-1).body), /Server locked[\s\S]*Raid in progress/);

  const twice = await command(guild, mod, 'lockdown');
  assert.match(textOf(lastResponse(twice)), /already locked – since <t:\d+:R> by <@\d+>/);

  // A restart: everything the bot knows comes from data/db.json
  db.flush();
  db._reset();
  db.load();
  assert.equal(lockdown.current(guild.id).memberPermissions, String(memberBefore));

  const admin = guild.members.cache.get(guild.ownerId);
  const unlock = await command(guild, admin, 'unlock');
  const out = textOf(lastResponse(unlock));
  assert.match(out, /Server unlocked/);
  assert.match(out, /has its permissions back/);
  assert.match(out, /Invites are open again/);
  assert.deepEqual(snapshot(guild), before, 'roles, channel overwrites and invites are exactly as before');
  assert.ok(can(buyer, chat, P.SendMessages) && can(buyer, lounge, P.Connect) && can(buyer, announcements, P.AddReactions));
  assert.equal(lockdown.current(guild.id), null);
  assert.match(textOf(announcements.messageList.at(-1).body), /The server is unlocked/);

  const again = await command(guild, mod, 'unlock');
  assert.match(textOf(lastResponse(again)), /isn't locked/);
});

test('invites: already paused stay paused, the setting can turn pausing off, a missing permission is reported', async () => {
  // Paused before the lockdown → still paused afterwards
  const a = await setup();
  await a.guild.disableInvites(true);
  await command(a.guild, a.mod, 'lockdown');
  assert.equal(lockdown.current(a.guild.id).invitesPaused, false);
  const unlockA = await command(a.guild, a.mod, 'unlock');
  assert.match(textOf(lastResponse(unlockA)), /were paused before the lockdown, so they stay paused/);
  assert.ok(a.guild.features.includes('INVITES_DISABLED'));

  // security.lockdownPausesInvites: false
  const b = await setup();
  config.security.lockdownPausesInvites = false;
  try {
    const lock = await command(b.guild, b.mod, 'lockdown');
    assert.match(textOf(lastResponse(lock)), /Invites stay open/);
    assert.ok(!b.guild.features.includes('INVITES_DISABLED'));
    await command(b.guild, b.mod, 'unlock');
    assert.ok(!b.guild.features.includes('INVITES_DISABLED'));
  } finally {
    config.security.lockdownPausesInvites = true;
  }

  // No Manage Server → the lockdown still works
  const c = await setup();
  c.guild.deny('ManageGuild');
  const warn = console.warn;
  console.warn = () => {};
  try {
    const lock = await command(c.guild, c.mod, 'lockdown');
    assert.match(textOf(lastResponse(lock)), /couldn't pause invites/);
    assert.ok(lockdown.current(c.guild.id));
    assert.ok(!c.guild.roles.cache.get(role(c.guild, 'member')).permissions.has(P.SendMessages));
    const unlock = await command(c.guild, c.mod, 'unlock');
    assert.doesNotMatch(textOf(lastResponse(unlock)), /Invites/);
  } finally {
    console.warn = warn;
  }
});

test('notice goes to #chat without #announcements; quiet staff roles are pointed out', async () => {
  const { guild, mod } = await setup();
  db.guild(guild.id).build.channels.announcements = null;
  const seller = guild.roles.cache.get(role(guild, 'seller'));
  const sellerBits = seller.permissions.bitfield;
  await seller.setPermissions(sellerBits & ~P.SendMessages); // e.g. edited by hand

  const lock = await command(guild, mod, 'lockdown', { reason: 'Spam wave' });
  const out = textOf(lastResponse(lock));
  assert.match(out, new RegExp(`Notice posted in <#${db.channelId(guild.id, 'chat')}>`));
  assert.match(out, new RegExp(`<@&${seller.id}> has no \\*\\*Send Messages\\*\\* of its own`));
  assert.match(textOf(ch(guild, 'chat').messageList.at(-1).body), /The server is locked[\s\S]*Spam wave/);

  // Changes made during the lockdown (outside the locked permissions) are kept by /unlock
  const memberRole = guild.roles.cache.get(role(guild, 'member'));
  await memberRole.setPermissions(memberRole.permissions.bitfield | P.AttachFiles);
  await command(guild, mod, 'unlock');
  assert.ok(memberRole.permissions.has(P.AttachFiles) && memberRole.permissions.has(P.SendMessages));
});

test('/lockdown without a Member role or with a role above the bot explains what to do', async () => {
  const { guild, mod } = await setup();
  const memberRole = guild.roles.cache.get(role(guild, 'member'));
  memberRole.position = 5000;
  const high = await command(guild, mod, 'lockdown');
  assert.match(textOf(lastResponse(high)), /I can't edit .* drag my role above it/);
  assert.equal(lockdown.current(guild.id), null);

  db.guild(guild.id).build.roles.member = null;
  db.guild(guild.id).settings.verifyRoleId = null;
  const none = await command(guild, mod, 'lockdown');
  assert.match(textOf(lastResponse(none)), /no Member role/);
});
