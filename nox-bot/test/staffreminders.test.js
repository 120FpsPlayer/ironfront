'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const config = require('../src/lib/config');
const reminders = require('../src/features/staffreminders');
const t = require('../src/tickets/tickets');
const { staffRoleIds } = require('../src/lib/utils');

config.defaults.openCooldownSeconds = 0;

let n = 963000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const MIN = 60_000;
const pad = (x) => String(x).padStart(4, '0');

/** A built server whose shop is open (set by hand, so the tests don't depend on the time of day). */
async function builtGuild(mode = 'open') {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  db.guild(guild.id).shopStatus.mode = mode;
  return { guild, staff: member(guild, ['member', 'support']) };
}

const support = (guild, who = member(guild)) => t.openTicket(who, config.getType('support'), [{ label: 'Subject', value: 'Help' }]);
function purchase(guild, who = member(guild)) {
  const type = config.getType('order');
  return t.openTicket(who, type, type.questions.map((q) => ({ label: q.label, value: q.id === 'product' ? 'Nitro' : 'x' })));
}
/** Moves a ticket's opening time into the past. */
const openedAgo = (channel, ms) => db.updateTicket(channel.id, { createdAt: Date.now() - ms });
const staffChat = (guild) => guild.channels.cache.get(db.channelId(guild.id, 'staffChat'));
const logChannel = (guild) => guild.channels.cache.get(db.settings(guild.id).logChannelId);
const linkButtons = (payload) =>
  payload.components
    .map((c) => c.toJSON())
    .flatMap((c) => c.components)
    .filter((c) => c.type === 1)
    .flatMap((r) => r.components)
    .filter((b) => b.style === 5);

test('after unclaimedMinutes: ONE message for all waiting tickets, link buttons, only their staff roles pinged', async () => {
  const { guild } = await builtGuild();
  const a = await support(guild);
  const b = await purchase(guild);
  const now = Date.now();
  const chat = staffChat(guild);
  const before = chat.messageList.length;

  assert.equal(await reminders.sweep(guild.client, now + 14 * MIN), 0, 'not yet');
  assert.equal(chat.messageList.length, before);

  assert.equal(await reminders.sweep(guild.client, now + 16 * MIN), 2);
  assert.equal(chat.messageList.length, before + 1, 'one message for both');
  const msg = chat.messageList.at(-1);
  validateMessage(msg.body, guild);
  const out = textOf(msg.body);
  assert.match(out, /## 🔔 2 tickets are waiting to be claimed/);
  for (const channel of [a, b]) {
    const ticket = db.getTicket(channel.id);
    assert.match(out, new RegExp(`<#${channel.id}> · ${config.getType(ticket.typeId).label} · <@${ticket.ownerId}> · waiting \\*\\*16m\\*\\*`));
    assert.equal(ticket.unclaimedRemindedAt, now + 16 * MIN);
  }
  assert.deepEqual(
    linkButtons(msg.body).map((x) => [x.label, x.url]),
    [a, b].map((c) => [`#${pad(db.getTicket(c.id).number)}`, c.url]),
  );

  // Pings: the staff roles of those two ticket types – and nothing else (no owners, no @everyone)
  const expected = new Set(['support', 'order'].flatMap((id) => staffRoleIds(guild.id, config.getType(id))).filter((id) => guild.roles.cache.has(id)));
  assert.ok(expected.has(role(guild, 'seller')) && expected.has(role(guild, 'support')));
  assert.deepEqual(Object.keys(msg.body.allowedMentions), ['roles']);
  assert.deepEqual(new Set(msg.body.allowedMentions.roles), expected);
  for (const id of expected) assert.ok(out.includes(`<@&${id}>`));

  // Just reminded → quiet
  assert.equal(await reminders.sweep(guild.client, now + 17 * MIN), 0);
  assert.equal(chat.messageList.length, before + 1);
});

test('repeat: again after repeatMinutes (default 60) – repeatMinutes 0 reminds only once', async () => {
  const { guild } = await builtGuild();
  await support(guild);
  const now = Date.now();
  assert.equal(await reminders.sweep(guild.client, now + 16 * MIN), 1);
  assert.equal(await reminders.sweep(guild.client, now + (16 + 59) * MIN), 0);
  assert.equal(await reminders.sweep(guild.client, now + (16 + 60) * MIN), 1);
  assert.match(textOf(staffChat(guild).messageList.at(-1).body), /waiting \*\*1h 16m\*\*/);
  assert.match(textOf(staffChat(guild).messageList.at(-1).body), /reminded again in 1h/);

  config.staffReminders.repeatMinutes = 0;
  try {
    const other = await builtGuild();
    await support(other.guild);
    assert.equal(await reminders.sweep(other.guild.client, now + 16 * MIN), 1);
    assert.doesNotMatch(textOf(staffChat(other.guild).messageList.at(-1).body), /reminded again/);
    assert.equal(await reminders.sweep(other.guild.client, now + 10 * 60 * MIN), 0, 'only once');
  } finally {
    config.staffReminders.repeatMinutes = 60;
  }

  // unclaimedMinutes from config.json
  config.staffReminders.unclaimedMinutes = 5;
  try {
    const quick = await builtGuild();
    await support(quick.guild);
    assert.equal(await reminders.sweep(quick.guild.client, now + 6 * MIN), 1);
  } finally {
    config.staffReminders.unclaimedMinutes = 15;
  }
});

test('claiming stops the reminders; unclaiming starts the clock again from the unclaim time', async () => {
  const { guild, staff } = await builtGuild();
  const channel = await support(guild);
  openedAgo(channel, 40 * MIN);
  assert.equal(await reminders.sweep(guild.client, Date.now() - 20 * MIN), 1, 'reminded 20 minutes ago');

  await t.claimTicket(channel, staff);
  assert.equal(await reminders.sweep(guild.client, Date.now() + 5 * 60 * MIN), 0, 'claimed – never reminded');

  await t.unclaimTicket(channel, staff);
  assert.ok(Math.abs(db.getTicket(channel.id).unclaimedAt - Date.now()) < 5000);
  assert.equal(await reminders.sweep(guild.client, Date.now() + MIN), 0, 'no instant ping after unclaiming');
  assert.equal(await reminders.sweep(guild.client, Date.now() + 14 * MIN), 0);
  assert.equal(await reminders.sweep(guild.client, Date.now() + 16 * MIN), 1);
  assert.match(textOf(staffChat(guild).messageList.at(-1).body), /waiting \*\*1[56]m\*\*/, 'counted from the unclaim');
});

test('closed shop: no reminders – tickets from the night are reminded as soon as it opens', async () => {
  const { guild } = await builtGuild('closed');
  const channel = await support(guild);
  openedAgo(channel, 3 * 60 * MIN);
  assert.equal(await reminders.sweep(guild.client), 0);
  db.guild(guild.id).shopStatus.mode = 'open';
  assert.equal(await reminders.sweep(guild.client), 1);
  assert.match(textOf(staffChat(guild).messageList.at(-1).body), /waiting \*\*3h\*\*/);

  // Following the working hours (10:00–20:00 Europe/Warsaw): a ticket from 03:00 is reminded at opening time
  const night = await builtGuild('auto');
  const late = await support(night.guild);
  db.updateTicket(late.id, { createdAt: Date.parse('2026-07-15T01:00:00Z') });
  assert.equal(await reminders.sweep(night.guild.client, Date.parse('2026-07-15T07:59:00Z')), 0, '09:59 – still closed');
  assert.equal(await reminders.sweep(night.guild.client, Date.parse('2026-07-15T08:00:00Z')), 1, '10:00 – open');
  assert.match(textOf(staffChat(night.guild).messageList.at(-1).body), /waiting \*\*7h\*\*/);
});

test('many waiting tickets: 10 listed and "+N more", 5 link buttons, one message within Discord limits', async () => {
  const { guild } = await builtGuild();
  const channels = [];
  for (let i = 0; i < 14; i += 1) channels.push(await (i % 2 ? purchase(guild) : support(guild)));
  channels.forEach((c, i) => openedAgo(c, (60 - i) * MIN)); // the first one waits longest
  const chat = staffChat(guild);
  const before = chat.messageList.length;
  assert.equal(await reminders.sweep(guild.client), 14);
  assert.equal(chat.messageList.length, before + 1);
  const msg = chat.messageList.at(-1);
  validateMessage(msg.body, guild);
  const out = textOf(msg.body);
  assert.match(out, /14 tickets are waiting/);
  assert.match(out, /\*\*\+4 more\*\*/);
  assert.equal((out.match(/· waiting \*\*/g) ?? []).length, 10);
  assert.ok(out.includes(`<#${channels[0].id}>`) && !out.includes(`<#${channels[13].id}>`), 'longest waiting first');
  assert.equal(linkButtons(msg.body).length, 5);
  assert.ok(channels.every((c) => db.getTicket(c.id).unclaimedRemindedAt));
});

test('where it goes: the staff chat, else the ticket log channel, else nowhere (and nothing is marked)', async () => {
  const { guild } = await builtGuild();
  const a = await support(guild);
  guild.channels.cache.delete(db.channelId(guild.id, 'staffChat'));
  const log = logChannel(guild);
  const before = log.messageList.length;
  assert.equal(await reminders.sweep(guild.client, Date.now() + 16 * MIN), 1);
  assert.equal(log.messageList.length, before + 1);
  assert.ok(textOf(log.messageList.at(-1).body).includes(`<#${a.id}>`));

  const b = await support(guild);
  guild.channels.cache.delete(log.id);
  assert.equal(await reminders.sweep(guild.client, Date.now() + 16 * MIN), 0);
  assert.equal(db.getTicket(b.id).unclaimedRemindedAt, undefined);
});

test('skipped: turned off, servers that are unavailable, completed orders and closed tickets', async () => {
  const { guild, staff } = await builtGuild();
  const open = await support(guild);
  const later = Date.now() + 16 * MIN;

  config.staffReminders.enabled = false;
  try {
    assert.equal(await reminders.sweep(guild.client, later), 0);
  } finally {
    config.staffReminders.enabled = true;
  }
  guild.available = false;
  assert.equal(await reminders.sweep(guild.client, later), 0);
  delete guild.available;

  await t.closeTicket(open, staff);
  const order = await purchase(guild);
  await t.completeOrder(order, staff, { amount: 5 });
  assert.equal(await reminders.sweep(guild.client, later), 0);

  // The server itself is reminded as usual
  const fresh = await support(guild);
  assert.equal(await reminders.sweep(guild.client, later), 1);
  assert.ok(textOf(staffChat(guild).messageList.at(-1).body).includes(`<#${fresh.id}>`));
});

test('isDue: old tickets without the new fields work', () => {
  const opts = { after: 15 * MIN, repeat: 60 * MIN };
  const now = Date.now();
  assert.equal(reminders.isDue({ createdAt: now - 20 * MIN }, now, opts), true);
  assert.equal(reminders.isDue({ createdAt: now - 10 * MIN }, now, opts), false);
  assert.equal(reminders.isDue({ createdAt: now - 90 * MIN, unclaimedRemindedAt: now - 30 * MIN }, now, opts), false);
  assert.equal(reminders.isDue({ createdAt: now - 90 * MIN, unclaimedRemindedAt: now - 60 * MIN }, now, opts), true);
  assert.equal(reminders.isDue({ createdAt: now - 90 * MIN, unclaimedRemindedAt: now - 60 * MIN }, now, { ...opts, repeat: 0 }), false);
  assert.equal(reminders.waitingSince({ createdAt: 5, unclaimedAt: 9 }), 9);
});
