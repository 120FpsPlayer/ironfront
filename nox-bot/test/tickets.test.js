'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { buildServer } = require('../src/builder/executor');
const t = require('../src/tickets/tickets');
const config = require('../src/lib/config');
const { UserError } = require('../src/lib/utils');
const { textOf } = require('./helpers/fakeInteraction');

let n = 920000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

test('reopening after a bot restart gives the author access again (users are not cached anymore)', async () => {
  const guild = await builtGuild();
  const author = guild.addMember(uid(), [role(guild, 'member')]);
  const helper = guild.addMember(uid(), [role(guild, 'member')]);
  const staff = guild.addMember(uid(), [role(guild, 'member'), role(guild, 'support')]);
  const channel = await t.openTicket(author, config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  await t.addUsers(channel, [helper.user], staff);
  // Bot restart: discord.js forgets users that haven't done anything since.
  guild.members.cache.delete(helper.id);
  await t.closeTicket(channel, staff);
  assert.ok(!channel.permissionsFor(author).has(P.ViewChannel), 'author locked out after closing');
  assert.equal(channel.overwriteList.find((o) => o.id === helper.id).deny & P.ViewChannel, P.ViewChannel, 'participant denied');
  guild.members.cache.delete(author.id);
  await t.reopenTicket(channel, staff);
  guild.members.cache.set(author.id, author);
  assert.ok(channel.permissionsFor(author).has(P.ViewChannel), 'author can see the reopened ticket');
  assert.ok(channel.permissionsFor(author).has(P.SendMessages));
});

test('closed tickets never overflow the 50-channel category limit (oldest closed ticket is cleaned up)', async () => {
  const guild = await builtGuild();
  const staff = guild.addMember(uid(), [role(guild, 'member'), role(guild, 'support')]);
  const closedId = db.settings(guild.id).closedCategoryId;
  const inClosed = () => guild.channels.cache.filter((c) => c.parentId === closedId).size;
  const baseline = inClosed(); // ticket-logs etc. are not in here, but count anyway
  const channels = [];
  for (let i = 0; i < 51 - baseline; i += 1) {
    const user = guild.addMember(uid(), [role(guild, 'member')]);
    const channel = await t.openTicket(user, config.getType('support'), []);
    await t.closeTicket(channel, staff);
    channels.push(channel);
  }
  assert.ok(inClosed() <= 50, `closed category has ${inClosed()} channels`);
  const last = channels.at(-1);
  assert.equal(last.parentId, closedId, 'the newest closed ticket was moved into the closed category');
  assert.ok(!guild.channels.cache.has(channels[0].id), 'the oldest closed ticket was removed');
  assert.equal(db.getTicket(channels[0].id).status, 'deleted');
});

test('more than 50 open tickets go into an overflow category instead of failing', async () => {
  const guild = await builtGuild();
  const openId = db.settings(guild.id).categoryId;
  const opened = [];
  for (let i = 0; i < 52; i += 1) {
    const user = guild.addMember(uid(), [role(guild, 'member')]);
    opened.push(await t.openTicket(user, config.getType('support'), []));
  }
  assert.equal(guild.channels.cache.filter((c) => c.parentId === openId).size, 50);
  const overflow = guild.channels.cache.get(opened.at(-1).parentId);
  assert.notEqual(overflow.id, openId);
  assert.match(overflow.name, /TICKETS 2/);
  assert.equal(t.checkCanOpen(guild.addMember(uid(), [role(guild, 'member')])), null);
});

test('rate limits: long channel-rename waits are rejected (also when only retryAfter is long), messages still queue', () => {
  const { rejectOnRateLimit } = require('../src/lib/ratelimit');
  const base = { limit: 5, hash: 'x', majorParameter: '1', global: false, scope: 'user' };
  // Rename sublimit: the bucket resets soon, but Discord says retry in ~9 minutes.
  assert.equal(rejectOnRateLimit({ ...base, method: 'PATCH', route: '/channels/:id', url: '/channels/1', timeToReset: 800, retryAfter: 540_000, sublimitTimeout: 540_000 }), true);
  assert.equal(rejectOnRateLimit({ ...base, method: 'POST', route: '/guilds/:id/emojis', url: '/guilds/1/emojis', timeToReset: 60_000, retryAfter: 60_000, sublimitTimeout: 0 }), true);
  assert.equal(rejectOnRateLimit({ ...base, method: 'PATCH', route: '/channels/:id', url: '/channels/1', timeToReset: 2_000, retryAfter: 2_000, sublimitTimeout: 0 }), false, 'short waits are fine');
  assert.equal(rejectOnRateLimit({ ...base, method: 'POST', route: '/channels/:id/messages', url: '/channels/1/messages', timeToReset: 30_000, retryAfter: 30_000, sublimitTimeout: 0 }), false, 'messages wait');
});

test('ticket renames: Discord limit hit by renames the bot did not make → clear wait message, priority still changes', async () => {
  const guild = await builtGuild();
  const author = guild.addMember(uid(), [role(guild, 'member')]);
  const staff = guild.addMember(uid(), [role(guild, 'member'), role(guild, 'support')]);
  const channel = await t.openTicket(author, config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  // Someone renamed the channel twice by hand (or the bot restarted after two renames).
  await channel.setName('by-hand-1');
  await channel.setName('by-hand-2');
  await assert.rejects(t.renameTicket(channel, 'new-name'), (err) => err instanceof UserError && /twice per 10 minutes.*~\d+ min/.test(err.message));
  await t.setPriority(channel, 'high', staff);
  assert.equal(db.getTicket(channel.id).priority, 'high');
  assert.match(textOf(channel.messageList.at(-1).body), /Discord limit, ~\d+ min/);
});
