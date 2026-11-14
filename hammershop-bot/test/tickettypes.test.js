'use strict';

// The launcher server's tidy-up: Rekrutacja switched off (and /tickety to switch categories), the two log channels,
// and /build only:update removing the roles, the channel and the cards that are gone from the layout.
process.env.HS_TEST_PROFILE = 'launcher';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const tickets = require('../src/tickets/tickets');
const { sendLog, sendTicketLog } = require('../src/lib/utils');

const commands = loadCommands();
const OWNER = '1';

async function built() {
  const guild = new FakeGuild({ ownerId: OWNER });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}
const channel = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const text = (guild, key) => channel(guild, key).messageList.map((m) => textOf(m.body)).join('\n');
const json = (guild, key) => channel(guild, key).messageList.map((m) => JSON.stringify(m.body)).join('\n');
const tickety = async (guild, member, subcommand, options = {}) => {
  const i = createInteraction({ guild, member, kind: 'command', commandName: 'ticket-types', subcommand, options });
  await handle(i, commands);
  return textOf(lastResponse(i));
};

test('Rekrutacja starts switched off: grey „Wyłączona” in the panel, a closed card in #informacje, nobody can open one', async () => {
  const guild = await built();
  const apply = config.getType('apply');
  assert.equal(apply.label, 'Rekrutacja');
  // The panel lists it with a disabled button; the other categories open as before.
  assert.match(text(guild, 'tickets'), /Rekrutacja[\s\S]*Tymczasowo wyłączona/);
  assert.match(json(guild, 'tickets'), /"custom_id":"ticket:open:apply"[^}]*"disabled":true|"disabled":true[^}]*"custom_id":"ticket:open:apply"/);
  assert.match(text(guild, 'information'), /Rekrutacja jest teraz zamknięta/);
  // A click (from an old panel, say) or a direct open is refused with the reason.
  const member = guild.addMember('300000000000000101');
  const click = createInteraction({ guild, member, customId: 'ticket:open:apply' });
  await handle(click, commands);
  assert.match(textOf(lastResponse(click)), /Rekrutacja jest teraz wyłączona/);
  await assert.rejects(tickets.openTicket(member, apply, []), /Rekrutacja jest teraz wyłączona/);
  assert.equal(db.tickets((t) => t.guildId === guild.id).length, 0);
});

test('/tickety: admins switch a category on and off – the panels follow at once, the change goes to the server log', async () => {
  const guild = await built();
  const owner = guild.members.cache.get(OWNER) ?? guild.addMember(OWNER);
  const nobody = guild.addMember('300000000000000102');
  assert.match(await tickety(guild, nobody, 'on', { type: 'apply' }), /Tylko administracja/);
  const list = await tickety(guild, owner, 'list');
  assert.match(list, /⛔ \*\*Rekrutacja\*\* – wyłączona/);
  assert.match(list, /✅ \*\*Pomoc z launcherem\*\* – włączona/);

  assert.match(await tickety(guild, owner, 'on', { type: 'apply' }), /Rekrutacja\*\* znowu działa/);
  assert.doesNotMatch(text(guild, 'tickets'), /Tymczasowo wyłączona/);
  assert.match(text(guild, 'information'), /Złóż podanie przyciskiem poniżej/);
  assert.match(text(guild, 'serverLogs'), /Kategoria ticketów włączona[\s\S]*Rekrutacja/);
  assert.doesNotMatch(text(guild, 'ticketLogs'), /Kategoria ticketów/, 'not a ticket event');
  const member = guild.addMember('300000000000000103');
  const ticket = await tickets.openTicket(member, config.getType('apply'), [{ label: 'Wiek', value: '17' }]);
  assert.ok(ticket?.channelId ?? ticket, 'a recruitment ticket opens again');

  assert.match(await tickety(guild, owner, 'off', { type: 'bug' }), /Zgłoś błąd\*\* jest teraz wyłączona/);
  assert.match(text(guild, 'tickets'), /Zgłoś błąd[\s\S]*Tymczasowo wyłączona/);
  assert.match(await tickety(guild, owner, 'off', { type: 'bug' }), /jest już wyłączona/);
});

test('two log channels: tickets → #logi-ticketów, everything else (panel, launcher, commands) → #logi-serwera', async () => {
  const guild = await built();
  await sendLog(guild, { content: 'panel admina: nowa wersja 2.10.0' });
  await sendTicketLog(guild, { content: 'ticket #0001 zamknięty' });
  assert.match(text(guild, 'serverLogs'), /panel admina/);
  assert.doesNotMatch(text(guild, 'serverLogs'), /ticket #0001/);
  assert.match(text(guild, 'ticketLogs'), /ticket #0001/);
  assert.doesNotMatch(text(guild, 'ticketLogs'), /panel admina/);
  // A real ticket logs where tickets log.
  const member = guild.addMember('300000000000000104');
  await tickets.openTicket(member, config.getType('support'), [{ label: 'Problem', value: 'Nie startuje' }]);
  assert.ok(channel(guild, 'ticketLogs').messageList.length >= 2);
  assert.equal(channel(guild, 'serverLogs').messageList.length, 1, 'nothing from the ticket in the server log');
});

test('/build only:update tidies a server built earlier: old staff roles, #zrzuty-ekranu and the #serwery card go away', async () => {
  const guild = await built();
  const { addMissing, removeRetired } = require('../src/builder/update');
  const { refreshContent } = require('../src/builder/refresh');
  // Pretend the server was built by an older version: it has a Moderator role, #zrzuty-ekranu and a card in #serwery.
  const mod = await guild.roles.create({ name: '⚔️ Moderator', permissions: 0n });
  const shots = await guild.channels.create({ name: '📸 zrzuty-ekranu' });
  const card = await channel(guild, 'servers').send({ content: 'Serwery i ekipa' });
  const b = db.build(guild.id);
  db.setBuild(guild.id, { ...b, roles: { ...b.roles, moderator: mod.id }, channels: { ...b.channels, screenshots: shots.id }, posts: { ...b.posts, servers: [{ id: card.id, type: 'card' }] } });

  await addMissing(guild);
  const removed = await removeRetired(guild);
  assert.ok(removed.roles.some((n) => /Moderator/.test(n)), 'the old Moderator role is removed');
  assert.ok(removed.channels.some((n) => /zrzuty-ekranu/.test(n)), '#zrzuty-ekranu is removed');
  assert.equal(guild.roles.cache.has(mod.id), false);
  assert.equal(guild.channels.cache.has(shots.id), false);
  const res = await refreshContent(guild);
  assert.equal(res.removed >= 1, true);
  assert.equal(channel(guild, 'servers').messageList.length, 0, 'the #serwery card is gone – chat only');
  assert.equal(db.build(guild.id).posts.servers, undefined);
});
