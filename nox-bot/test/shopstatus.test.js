'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const hours = require('../src/lib/hours');
const shopstatus = require('../src/features/shopstatus');
const { channelName } = require('../src/builder/style');
const { workingStatus } = require('../src/lib/utils');
const t = require('../src/tickets/tickets');
const ui = require('../src/tickets/ui');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 950000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};

const at = (iso) => new Date(iso);
const setClock = (iso) => {
  shopstatus.clock.now = () => at(iso);
};
test.afterEach(() => {
  shopstatus.clock.now = () => new Date();
});

// Europe/Warsaw: summer time (CEST) is UTC+2, winter time (CET) is UTC+1.
const SUMMER = { before: '2026-07-15T07:59:00Z', opens: '2026-07-15T08:00:00Z', lastMinute: '2026-07-15T17:59:00Z', closes: '2026-07-15T18:00:00Z' };
const WINTER = { before: '2026-01-14T08:59:00Z', opens: '2026-01-14T09:00:00Z', lastMinute: '2026-01-14T18:59:00Z', closes: '2026-01-14T19:00:00Z' };

const OPEN_NAME = () => channelName(config.shopStatus.openName);
const CLOSED_NAME = () => channelName(config.shopStatus.closedName);

/** A built server whose status channel says "open" and has not been renamed in the last 10 minutes. */
async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const channel = ch(guild, 'statShop');
  channel.name = OPEN_NAME(); // /build named it after the real time
  channel.renameTimes = [];
  return guild;
}

function panelMessage(guild, kind) {
  const panel = db.panels(guild.id, kind)[0];
  return guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId);
}

// ───────────── Working hours ─────────────

test('working hours: Europe/Warsaw opens at 10:00 and closes at 20:00, in summer and in winter time', () => {
  const wh = config.workingHours;
  assert.equal(wh.timezone, 'Europe/Warsaw');
  for (const day of [SUMMER, WINTER]) {
    assert.equal(hours.inHours(wh, at(day.before)), false, `${day.before} closed`);
    assert.equal(hours.inHours(wh, at(day.opens)), true, `${day.opens} open`);
    assert.equal(hours.inHours(wh, at(day.lastMinute)), true, `${day.lastMinute} open`);
    assert.equal(hours.inHours(wh, at(day.closes)), false, `${day.closes} closed`);
    assert.equal(hours.nextOpening(wh, at(day.before)).toISOString(), at(day.opens).toISOString());
    assert.equal(hours.nextClosing(wh, at(day.opens)).toISOString(), at(day.closes).toISOString());
  }
  // The day the clocks go back: 10:00 is 09:00 UTC again.
  assert.equal(hours.nextOpening(wh, at('2026-10-25T00:30:00Z')).toISOString(), '2026-10-25T09:00:00.000Z');
  // Over midnight and weekdays only.
  const night = { enabled: true, timezone: 'Europe/Warsaw', from: '18:00', to: '02:00' };
  assert.equal(hours.inHours(night, at('2026-07-15T23:30:00Z')), true, '01:30 belongs to the evening before');
  assert.equal(hours.inHours(night, at('2026-07-15T00:30:00Z')), false, '02:30 is closed');
  const weekdays = { ...wh, days: [1, 2, 3, 4, 5] };
  const saturday = at('2026-10-03T10:00:00Z');
  assert.equal(hours.inHours(weekdays, saturday), false);
  assert.equal(hours.whenText(weekdays, hours.nextOpening(weekdays, saturday), saturday), 'on Monday at 10:00');
  assert.equal(hours.hoursText(weekdays), 'Mon–Fri 10:00–20:00 (Central European Time)');
});

test('the hours text comes from workingHours, so support hours and panels always agree; bad config is refused', () => {
  assert.equal(hours.hoursText(config.workingHours), 'Every day 10:00–20:00 (Central European Time)');
  assert.equal(config.shop.supportHours, 'Every day 10:00–20:00 (Central European Time)', 'written from workingHours when not set');
  assert.equal(shopstatus.hoursText(), config.shop.supportHours);
  assert.equal(hours.problem(config.workingHours), null);
  assert.match(hours.problem({ enabled: true, timezone: 'Mars/Olympus' }), /timezone/);
  assert.match(hours.problem({ enabled: true, timezone: 'Europe/Warsaw', from: '25:00' }), /"from"/);
  assert.match(hours.problem({ enabled: true, timezone: 'Europe/Warsaw', days: [7] }), /"days"/);
  // The same time twice would keep the shop closed forever – open all day is 00:00–24:00.
  assert.match(hours.problem({ enabled: true, timezone: 'Europe/Warsaw', from: '10:00', to: '10:00' }), /"from" and "to" must be different.*00:00.*24:00/);
  assert.equal(hours.problem({ enabled: true, timezone: 'Europe/Warsaw', from: '00:00', to: '24:00' }), null);
  assert.equal(hours.problem({ enabled: false, timezone: 'nonsense' }), null);
});

test('status lines: open with the hours, closed with the next opening time in Warsaw time', () => {
  const guildId = uid();
  setClock(SUMMER.opens);
  assert.equal(shopstatus.isOpen(guildId), true);
  assert.equal(shopstatus.statusLine(guildId, 'shop'), '🟢 **Open now** · Every day 10:00–20:00 (Central European Time)');
  assert.match(shopstatus.statusLine(guildId, 'support'), /^🟢 \*\*Support is online now\*\* · Every day 10:00–20:00/);

  setClock(SUMMER.before);
  const morning = shopstatus.statusLine(guildId, 'shop');
  assert.match(morning, /^🔴 \*\*Closed right now\*\* – we open at 10:00 \(<t:\d+:R>\)\. You can still order; a seller replies when we open\.$/);
  assert.ok(morning.includes(`<t:${at(SUMMER.opens).getTime() / 1000}:R>`), 'the exact opening moment');
  setClock(SUMMER.closes);
  assert.match(shopstatus.statusLine(guildId, 'shop'), /we open tomorrow at 10:00/);
  assert.match(shopstatus.statusLine(guildId, 'support'), /Support is offline right now/);
  assert.equal(shopstatus.statusChannelName(guildId), CLOSED_NAME());
  assert.ok(!/\uFE0F/.test(shopstatus.statusChannelName(guildId)), 'no variation selector in the channel name');
});

// ───────────── Timer ─────────────

test('timer: flips at 10:00 and 20:00 – renames the status channel only when the name changes and refreshes the panels', async () => {
  const guild = await builtGuild();
  const channel = ch(guild, 'statShop');
  const shopPanel = () => textOf(panelMessage(guild, 'shop').body);
  const ticketPanel = () => textOf(panelMessage(guild, 'tickets').body);

  setClock(SUMMER.before);
  await shopstatus.tick(guild.client);
  assert.equal(channel.name, CLOSED_NAME());
  assert.match(shopPanel(), /Closed right now\*\* – we open at 10:00/);
  assert.match(ticketPanel(), /Support is offline right now/);

  const renames = channel.renames;
  const edits = panelMessage(guild, 'shop').edits ?? 0;
  await shopstatus.tick(guild.client);
  await shopstatus.tick(guild.client);
  assert.equal(channel.renames, renames, 'same state – no rename');
  assert.equal(panelMessage(guild, 'shop').edits ?? 0, edits, 'same state – panels untouched');

  setClock(SUMMER.opens);
  const res = await shopstatus.sync(guild);
  assert.deepEqual({ open: res.open, flipped: res.flipped, renamed: res.renamed }, { open: true, flipped: true, renamed: true });
  assert.equal(channel.name, OPEN_NAME());
  assert.match(shopPanel(), /Open now\*\* · Every day 10:00–20:00 \(Central European Time\)/);
  assert.match(ticketPanel(), /Support is online now/);

  setClock(SUMMER.lastMinute);
  assert.equal((await shopstatus.sync(guild)).flipped, false);

  // A fresh server (Discord's rename limit is per channel): closes at 20:00.
  const evening = await builtGuild();
  setClock(SUMMER.lastMinute);
  await shopstatus.tick(evening.client);
  assert.equal(ch(evening, 'statShop').name, OPEN_NAME());
  setClock(SUMMER.closes);
  await shopstatus.tick(evening.client);
  assert.equal(ch(evening, 'statShop').name, CLOSED_NAME());
  assert.match(textOf(panelMessage(evening, 'shop').body), /we open tomorrow at 10:00/);
});

test('timer: runs every minute; at midnight a closed shop says "at 10:00" instead of "tomorrow at 10:00"', async () => {
  const timer = hooks.timers().find((x) => x.name === 'shopStatus');
  assert.equal(timer?.ms, 60_000, 'checked every minute');

  const guild = await builtGuild();
  const channel = ch(guild, 'statShop');
  const shopPanel = () => textOf(panelMessage(guild, 'shop').body);
  setClock(SUMMER.closes); // 20:00 in Warsaw
  await shopstatus.tick(guild.client);
  assert.match(shopPanel(), /we open tomorrow at 10:00/);
  const renames = channel.renames;

  setClock('2026-07-15T22:00:00Z'); // 00:00 in Warsaw – the opening is today now
  await shopstatus.tick(guild.client);
  assert.match(shopPanel(), /Closed right now\*\* – we open at 10:00/);
  assert.doesNotMatch(shopPanel(), /tomorrow/);
  assert.match(textOf(panelMessage(guild, 'tickets').body), /Support is offline right now\*\* – we open at 10:00/);
  assert.equal(channel.renames, renames, 'still closed – the channel keeps its name');

  // Nothing else changes during the night: no more edits.
  const edits = panelMessage(guild, 'shop').edits;
  setClock('2026-07-16T03:00:00Z');
  await shopstatus.tick(guild.client);
  assert.equal(panelMessage(guild, 'shop').edits, edits);
});

test('timer: Discord allows 2 renames per 10 minutes – the rename waits, the panels still flip', async () => {
  const guild = await builtGuild();
  const channel = ch(guild, 'statShop');
  setClock(SUMMER.before);
  await shopstatus.sync(guild);
  setClock(SUMMER.opens);
  await shopstatus.sync(guild);
  setClock(SUMMER.closes);
  channel.renameTimes = [Date.now(), Date.now()]; // two renames just happened (e.g. by hand)
  const res = await shopstatus.sync(guild);
  assert.equal(res.renamed, false);
  assert.ok(res.wait >= 1 && res.wait <= 10, `waits ${res.wait} min`);
  assert.equal(channel.name, OPEN_NAME(), 'not renamed yet');
  assert.match(textOf(panelMessage(guild, 'shop').body), /Closed right now/);
});

// ───────────── /shop ─────────────

test('/shop close | open | auto: manual mode wins over the hours until /shop auto', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const channel = ch(guild, 'statShop');
  setClock(SUMMER.opens);
  await shopstatus.sync(guild);
  assert.equal(channel.name, OPEN_NAME());
  const renames = channel.renames;

  const close = await run({ guild, member: owner, kind: 'command', commandName: 'shop', subcommand: 'close' });
  assert.match(textOf(lastResponse(close)), /The shop is closed[\s\S]*Right now:\*\* 🔴 Closed[\s\S]*until someone runs `\/shop auto`/);
  assert.equal(shopstatus.mode(guild.id), 'closed');
  assert.equal(channel.name, CLOSED_NAME(), 'renamed right away');
  assert.match(textOf(panelMessage(guild, 'shop').body), /Closed right now\*\* – we'll be back soon/);
  assert.equal(workingStatus(undefined, guild.id).open, false, 'workingStatus follows the override');

  // The timer keeps the manual state during the opening hours.
  setClock(SUMMER.lastMinute);
  await shopstatus.tick(guild.client);
  assert.equal(shopstatus.isOpen(guild.id), false);
  assert.equal(channel.name, CLOSED_NAME());

  // Open by hand at night.
  setClock(SUMMER.closes);
  const open = await run({ guild, member: owner, kind: 'command', commandName: 'shop', subcommand: 'open' });
  assert.match(textOf(lastResponse(open)), /The shop is open[\s\S]*Right now:\*\* 🟢 Open/);
  assert.equal(shopstatus.isOpen(guild.id), true);
  assert.equal(channel.name, OPEN_NAME());
  assert.equal(channel.renames, renames + 2);

  // Back to the schedule: 20:00 → closed. The panels flip now; the channel is the third rename in 10 minutes.
  const auto = await run({ guild, member: owner, kind: 'command', commandName: 'shop', subcommand: 'auto' });
  const answer = textOf(lastResponse(auto));
  assert.match(answer, /automatic again[\s\S]*Closed[\s\S]*Opens:\*\* tomorrow at 10:00/);
  assert.match(answer, /only allows renaming a channel twice per 10 minutes – the status channel <#\d+> updates by itself in about \d+ min/);
  assert.equal(shopstatus.mode(guild.id), 'auto');
  assert.equal(channel.name, OPEN_NAME(), 'waits for the rate limit');
  assert.match(textOf(panelMessage(guild, 'shop').body), /we open tomorrow at 10:00/);
  // /shop status doesn't claim the channel is up to date while the rename still waits.
  const pending = textOf(lastResponse(await run({ guild, member: owner, kind: 'command', commandName: 'shop', subcommand: 'status' })));
  assert.match(pending, /Right now:\*\* 🔴 Closed[\s\S]*status channel <#\d+> still says otherwise – it is renamed by itself within 10 minutes/);
  assert.doesNotMatch(pending, /up to date/);

  setClock(SUMMER.opens);
  const status = await run({ guild, member: owner, kind: 'command', commandName: 'shop', subcommand: 'status' });
  assert.match(textOf(lastResponse(status)), /Shop status[\s\S]*Right now:\*\* 🟢 Open[\s\S]*Opening hours:\*\* Every day 10:00–20:00[\s\S]*Closes:\*\* at 20:00[\s\S]*up to date/);

  // A deleted status channel is not linked as if it were there.
  channel.guild.channels.cache.delete(channel.id);
  const gone = textOf(lastResponse(await run({ guild, member: owner, kind: 'command', commandName: 'shop', subcommand: 'status' })));
  assert.match(gone, /No status channel yet/);
});

test('/shop: only admins and sellers can open or close the shop', async () => {
  const guild = await builtGuild();
  setClock(SUMMER.opens);
  const visitor = member(guild);
  const support = member(guild, ['member', 'support']);
  for (const who of [visitor, support]) {
    const denied = await run({ guild, member: who, kind: 'command', commandName: 'shop', subcommand: 'close' });
    assert.match(textOf(lastResponse(denied)), /Only administrators and sellers can open or close the shop/);
  }
  assert.equal(shopstatus.mode(guild.id), 'auto');

  const seller = member(guild, ['member', 'seller']);
  await run({ guild, member: seller, kind: 'command', commandName: 'shop', subcommand: 'close' });
  assert.equal(shopstatus.mode(guild.id), 'closed');
  const admin = member(guild, ['admin']);
  await run({ guild, member: admin, kind: 'command', commandName: 'shop', subcommand: 'auto' });
  assert.equal(shopstatus.mode(guild.id), 'auto');
  assert.equal(db.guild(guild.id).shopStatus.setBy, admin.id);
});

test('tickets agree with the shop status: the ticket panel and a new ticket say when the shop is closed', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const buyer = member(guild);

  await shopstatus.setMode(guild, 'closed', { by: owner.id });
  assert.match(textOf(ui.panelPayload(guild)), /Support is offline right now\*\* – we'll be back soon/);
  const closed = await t.openTicket(buyer, config.getType('order'), [{ label: 'What would you like to buy?', value: 'Nitro' }]);
  assert.match(textOf(closed.messageList[0].body), /We're closed right now\*\* – we'll be back soon\. Our team replies as soon as we're back\./);
  // Any ticket type – the note doesn't promise "a seller" for a support or report ticket.
  const help = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'Hi' }]);
  assert.match(textOf(help.messageList[0].body), /We're closed right now/);
  assert.doesNotMatch(textOf(help.messageList[0].body), /seller/i);
  // Once someone from the team takes the ticket, the card no longer says "we're closed".
  await t.claimTicket(help, owner);
  assert.doesNotMatch(textOf(help.messageList[0].body), /closed right now/i);

  await shopstatus.setMode(guild, 'open', { by: owner.id });
  assert.match(textOf(ui.panelPayload(guild)), /Support is online now\*\* · Every day 10:00–20:00/);
  const open = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'Hi' }]);
  assert.doesNotMatch(textOf(open.messageList[0].body), /closed right now/i);

  // Automatic: a ticket opened at 21:00 Warsaw time tells when the shop opens.
  await shopstatus.setMode(guild, 'auto');
  const late = { number: 7, ownerId: buyer.id, guildId: guild.id, createdAt: at('2026-07-15T19:00:00Z').getTime(), status: 'open', priority: 'normal', answers: [] };
  const card = (ticket) => textOf(ui.ticketCard(ticket, config.getType('support'), { guild, ownerUser: buyer.user }));
  assert.match(card(late), /We're closed right now\*\* – we open tomorrow at 10:00/);
  assert.doesNotMatch(card({ ...late, createdAt: at('2026-07-15T10:00:00Z').getTime() }), /closed right now/i);
});
