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
const shop = require('../src/features/shop');
const tickets = require('../src/tickets/tickets');
const { toBits } = require('../src/builder/permissions');

const commands = loadCommands();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const press = async (guild, who, customId, channel = undefined) => {
  const i = createInteraction({ guild, member: who, kind: 'button', customId, channel });
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

test('notice goes to #chat without #announcements; staff roles without their own Send Messages keep talking', async () => {
  const { guild, mod } = await setup();
  db.guild(guild.id).build.channels.announcements = null;
  const seller = guild.roles.cache.get(role(guild, 'seller'));
  const sellerBits = seller.permissions.bitfield;
  await seller.setPermissions(sellerBits & ~P.SendMessages); // e.g. edited by hand – sellers talk through the Member role
  const sellerMember = member(guild, ['member', 'seller']);

  const lock = await command(guild, mod, 'lockdown', { reason: 'Spam wave' });
  const out = textOf(lastResponse(lock));
  assert.match(out, new RegExp(`Notice posted in <#${db.channelId(guild.id, 'chat')}>`));
  assert.match(out, new RegExp(`<@&${seller.id}> had no \\*\\*Send Messages\\*\\* of its own – it gets it until \`/unlock\`, so its members can still talk`));
  assert.ok(can(sellerMember, ch(guild, 'chat'), P.SendMessages), 'sellers can still talk');
  assert.match(textOf(ch(guild, 'chat').messageList.at(-1).body), /The server is locked[\s\S]*Spam wave/);

  // Changes made during the lockdown (outside the locked permissions) are kept by /unlock
  const memberRole = guild.roles.cache.get(role(guild, 'member'));
  await memberRole.setPermissions(memberRole.permissions.bitfield | P.AttachFiles);
  await command(guild, mod, 'unlock');
  assert.ok(memberRole.permissions.has(P.AttachFiles) && memberRole.permissions.has(P.SendMessages));
  assert.equal(seller.permissions.bitfield, sellerBits & ~P.SendMessages, 'the seller role is back to exactly what it was');
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

// ───────────── Regressions ─────────────

test('while locked, members cannot post vouches or open new tickets and orders through the bot – staff can, open tickets keep working', async () => {
  const { guild, mod } = await setup();
  const raider = member(guild);
  const buyer = member(guild);
  const staffer = member(guild, ['member', 'support']);
  const product = shop.addProduct(guild, { name: 'Netflix Premium', price: '5', description: 'Instant delivery.' });
  const own = await tickets.openTicket(buyer, config.getType('support'), []); // opened before the lockdown
  await command(guild, mod, 'lockdown', { reason: 'Raid' });

  const vouches = ch(guild, 'vouches');
  const posts = vouches.messageList.length;
  const vouch = await command(guild, raider, 'vouch', { rating: 1, product: 'x', review: 'RAID RAID join discord.gg/xxx now' });
  assert.match(textOf(lastResponse(vouch)), /server is locked[\s\S]*vouches are paused/);
  const form = await press(guild, raider, 'vouch:open', vouches);
  assert.match(textOf(lastResponse(form)), /vouches are paused/);
  assert.equal(form.state.modals.length, 0);
  assert.equal(vouches.messageList.length, posts, 'nothing was posted in #vouches');

  const ticketCount = () => db.tickets((t) => t.guildId === guild.id).length;
  const count = ticketCount();
  const open = await press(guild, raider, 'ticket:open:support');
  assert.match(textOf(lastResponse(open)), /server is locked[\s\S]*new tickets and orders are paused[\s\S]*open tickets keep working/);
  const buy = await press(guild, raider, `shop:buy:${product.id}`);
  assert.match(textOf(lastResponse(buy)), /new tickets and orders are paused/);
  assert.equal(buy.state.modals.length, 0);
  await assert.rejects(tickets.openTicket(raider, config.getType('order'), []), /new tickets and orders are paused/, 'an order form sent just before the lock');
  assert.equal(ticketCount(), count, 'no new ticket channels');

  // Staff still can; the ticket from before keeps working
  await tickets.openTicket(staffer, config.getType('support'), []);
  assert.equal(ticketCount(), count + 1);
  assert.ok(can(buyer, guild.channels.cache.get(own.id), P.SendMessages), 'the owner can still write in their open ticket');

  await command(guild, mod, 'unlock');
  const after = await command(guild, raider, 'vouch', { rating: 5, product: 'Netflix Premium', review: 'Fast delivery, thank you!' });
  assert.match(textOf(lastResponse(after)), /Thank you for your vouch/);
  const again = await press(guild, raider, `shop:buy:${product.id}`);
  assert.equal(again.state.modals.length, 1, 'orders work again after /unlock');
});

test('staff roles from /setup keep talking during a lockdown, and the reply is based on the real roles', async () => {
  const { guild, mod } = await setup();
  const helpers = await guild.roles.create({ name: 'Helpers', permissions: 0n }); // relies on the Member role
  db.updateSettings(guild.id, { staffRoleIds: [helpers.id] });
  const helper = member(guild);
  helper.roles.cache.set(helpers.id, helpers);
  const buyer = member(guild);
  const chat = ch(guild, 'chat');
  const lounge = ch(guild, 'lounge');
  const before = snapshot(guild);
  assert.ok(can(helper, chat, P.SendMessages));

  const lock = await command(guild, mod, 'lockdown');
  const out = textOf(lastResponse(lock));
  assert.ok(!can(buyer, chat, P.SendMessages), 'members are quiet');
  assert.ok(can(helper, chat, P.SendMessages) && can(helper, lounge, P.Connect), 'the helpers can still talk');
  assert.match(out, new RegExp(`<@&${helpers.id}> had no \\*\\*Send Messages\\*\\* of its own – it gets it until \`/unlock\`, so its members can still talk`));
  assert.doesNotMatch(out, /⚠️/);
  assert.equal(lockdown.current(guild.id).staffRoles.length, 1);

  await command(guild, mod, 'unlock');
  assert.deepEqual(snapshot(guild), before, 'the helpers role is exactly as before');

  // A quiet staff role I can't edit is reported – no "the team can still talk"
  helpers.position = 5000;
  const again = textOf(lastResponse(await command(guild, mod, 'lockdown')));
  assert.match(again, new RegExp(`⚠️ <@&${helpers.id}> has no \\*\\*Send Messages\\*\\* of its own and I can't edit it`));
  assert.doesNotMatch(again, /can still talk/);
  await command(guild, mod, 'unlock');
});

test('/unlock while /lockdown is still running waits for it – nothing stays locked behind its back', async () => {
  const { guild, mod } = await setup();
  const mod2 = member(guild, ['member', 'moderator']);
  const before = snapshot(guild);
  // A slow Discord: every permission edit takes a moment
  for (const r of guild.roles.cache.values()) {
    const set = r.setPermissions.bind(r);
    r.setPermissions = async (...args) => {
      await sleep(15);
      return set(...args);
    };
  }
  for (const c of guild.channels.cache.values()) {
    const overwrites = c.permissionOverwrites;
    const edit = overwrites.edit;
    overwrites.edit = async (...args) => {
      await sleep(15);
      return edit.apply(overwrites, args);
    };
  }
  const disable = guild.disableInvites.bind(guild);
  guild.disableInvites = async (...args) => {
    await sleep(15);
    return disable(...args);
  };

  const locking = command(guild, mod, 'lockdown', { reason: 'Raid' });
  await sleep(5);
  const unlocking = command(guild, mod2, 'unlock');
  const [lock, unlock] = await Promise.all([locking, unlocking]);
  assert.match(textOf(lastResponse(lock)), /Server locked/);
  assert.match(textOf(lastResponse(unlock)), /Server unlocked[\s\S]*Restored \*\*\d+\*\* channel permissions[\s\S]*Invites are open again/);
  assert.equal(lockdown.current(guild.id), null);
  assert.deepEqual(snapshot(guild), before, 'roles, channels and invites are exactly as before');
  const notices = ch(guild, 'announcements').messageList.slice(-2).map((m) => textOf(m.body));
  assert.match(notices[0], /The server is locked/);
  assert.match(notices[1], /The server is unlocked/);
});

test('every other non-staff role that lets people chat is locked too and restored exactly; roles I cannot edit are reported', async () => {
  const guild = new FakeGuild();
  const level = await guild.roles.create({ name: 'Level 5', permissions: toBits(['ViewChannel', 'ReadMessageHistory', 'SendMessages', 'AddReactions', 'Connect', 'Speak']) });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId }); // "add" keeps the server's old roles
  const mod = member(guild, ['member', 'moderator']);
  const chat = ch(guild, 'chat');
  const lounge = ch(guild, 'lounge');
  const announcements = ch(guild, 'announcements');
  // Leftovers that also let people talk: @everyone, an overwrite for the old role, a role above mine
  await guild.roles.everyone.setPermissions(toBits(['SendMessages', 'AddReactions']));
  await announcements.permissionOverwrites.edit(level.id, { SendMessages: true, AttachFiles: true });
  const above = await guild.roles.create({ name: 'Old VIP', permissions: toBits(['SendMessages']) });
  above.position = 5000;
  const booster = await guild.roles.create({ name: 'Server Booster', permissions: toBits(['SendMessages', 'AddReactions']) });
  booster.managed = true; // managed by Discord, but below my role – its permissions can be changed
  const leveled = member(guild);
  leveled.roles.cache.set(level.id, level);
  const boosting = member(guild);
  boosting.roles.cache.set(booster.id, booster);
  const before = snapshot(guild);
  assert.ok(can(leveled, chat, P.SendMessages) && can(leveled, announcements, P.SendMessages));

  const lock = await command(guild, mod, 'lockdown', { reason: 'Raid' });
  const out = textOf(lastResponse(lock));
  for (const [flag, channel] of [[P.SendMessages, chat], [P.AddReactions, chat], [P.Connect, lounge], [P.SendMessages, announcements]]) {
    assert.ok(!can(leveled, channel, flag), `members with the old role are quiet in #${channel.name}`);
  }
  const overwrite = announcements.overwriteList.find((o) => o.id === level.id);
  assert.ok(overwrite.allow & P.AttachFiles && !(overwrite.allow & P.SendMessages), 'only the locked permissions are taken from the overwrite');
  assert.ok(!guild.roles.everyone.permissions.has(P.SendMessages), '@everyone is locked too');
  assert.ok(!can(boosting, chat, P.SendMessages), 'boosters are quiet too');
  assert.ok(can(mod, chat, P.SendMessages), 'staff still talk');
  assert.ok(guild.roles.cache.get(role(guild, 'bots')).permissions.has(P.SendMessages), 'the Bots role is left alone');
  assert.match(out, new RegExp(`Also locked:[^\\n]*<@&${level.id}>`));
  assert.match(out, new RegExp(`⚠️ <@&${above.id}> still allows \\*\\*Send Messages\\*\\*`));
  const state = lockdown.current(guild.id);
  assert.ok(state.roles.some((r) => r.id === level.id) && state.roles.some((r) => r.id === guild.id));
  assert.ok(state.channels.some((c) => c.id === announcements.id && c.roleId === level.id));

  await command(guild, mod, 'unlock');
  assert.deepEqual(snapshot(guild), before, 'every role and overwrite is exactly as before');
});
