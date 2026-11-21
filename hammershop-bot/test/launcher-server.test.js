'use strict';

// The Hammer Launcher server after its second tidy-up: the #hammershop channel of our co-creator, no reminders about
// unclaimed tickets, and no „Zgłoś użytkownika” / „Odwołanie od kary” categories – tickets opened in them earlier
// still work.
process.env.HS_TEST_PROFILE = 'launcher';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse } = require('./helpers/fakeInteraction');
const { textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { addMissing } = require('../src/builder/update');
const config = require('../src/lib/config');
const tickets = require('../src/tickets/tickets');
const reminders = require('../src/features/staffreminders');
const handle = require('../src/handlers/interactions');
const commands = require('../src/commands')();
const { artOf } = require('../src/builder/emojis');

config.defaults.openCooldownSeconds = 0;
config.defaults.deleteDelaySeconds = 0;

async function built() {
  const guild = new FakeGuild({ ownerId: '1' });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}
const channel = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const text = (guild, key) => channel(guild, key).messageList.map((m) => textOf(m.body)).join('\n');
const json = (guild, key) => channel(guild, key).messageList.map((m) => JSON.stringify(m.body)).join('\n');
/** The bot's categories from the top of the server down, by their layout keys. */
function categoryOrder(guild) {
  const keyOf = Object.fromEntries(Object.entries(db.build(guild.id).categories).map(([key, id]) => [id, key]));
  return [...guild.channels.cache.values()]
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    .map((c) => keyOf[c.id] ?? c.name);
}
const staffOf = (guild) => guild.addMember('300000000000000201', [db.roleId(guild.id, 'member'), db.roleId(guild.id, 'support')]);

test('#hammershop: the co-creator\'s channel with its banner, what it sells and a link to its site', async () => {
  const guild = await built();
  const ch = channel(guild, 'hammershop');
  assert.ok(ch, 'the channel exists');
  assert.match(ch.name, /^🤝/); // the name itself is in small caps (server.smallCaps)
  // Its own category, between the launcher's channels and the help channels.
  const partner = guild.channels.cache.get(db.build(guild.id).categories.catPartner);
  assert.equal(ch.parentId, partner.id);
  assert.match(partner.name, /🛒/);
  assert.deepEqual(guild.channels.cache.filter((c) => c.parentId === partner.id).map((c) => c.id), [ch.id], 'nothing else in it');
  assert.deepEqual(categoryOrder(guild).slice(1, 6), ['catWelcome', 'catLauncher', 'catPartner', 'catPartnerships', 'catSupport']);
  assert.equal(ch.messageList.length, 2, 'a banner and the card');
  assert.match(ch.messageList[0].body.files[0].name, /hammershop\.png$/);
  const card = text(guild, 'hammershop');
  assert.match(card, /HammerShop – nasz współtwórca/);
  for (const word of ['Pluginy', 'Skrypty', 'Boty Discord', 'Serwery']) assert.match(card, new RegExp(word));
  assert.match(json(guild, 'hammershop'), /"url":"https:\/\/hammershop\.pl"/, 'a button to the partner\'s site');
  assert.doesNotMatch(json(guild, 'hammershop'), /Discord HammerShop/, 'no Discord button until an invite is set in the config');
  // The channel guide in #informacje names it; the readers can't write there.
  assert.match(text(guild, 'information'), new RegExp(`### \\S+ HammerShop\\n> <#${ch.id}> – HammerShop, nasz współtwórca`));
});

test('#hammershop gets a Discord button once config.partner.discord is set, and none at all without links', async () => {
  const { postsFor } = require('../src/builder/content.launcher');
  const guild = await built();
  const x = { guild, ch: () => '#tickety', E: () => '•', brand: config.brand.name };
  const before = { ...config.partner };
  try {
    config.partner.discord = 'https://discord.gg/przyklad';
    const withInvite = JSON.stringify(postsFor('hammershop', x, null)[1].payload);
    assert.match(withInvite, /"label":"Discord HammerShop"/);
    assert.match(withInvite, /discord\.gg\/przyklad/);
    Object.assign(config.partner, { url: '', discord: '' });
    const bare = postsFor('hammershop', x, null)[1].payload.components[0].toJSON();
    assert.equal(bare.components.some((c) => c.type === 1), false, 'no empty button row (Discord rejects it)');
  } finally {
    Object.assign(config.partner, before);
  }
});

/** The server as it was before the HammerShop category: no such category; with `inLauncher` the channel sits in LAUNCHER. */
async function builtBeforeTheCategory({ inLauncher }) {
  const guild = await built();
  const b = db.build(guild.id);
  const old = guild.channels.cache.get(b.categories.catPartner);
  const ch = channel(guild, 'hammershop');
  if (inLauncher) await ch.setParent(b.categories.catLauncher);
  else await ch.delete();
  await old.delete();
  const { catPartner: _gone, ...categories } = b.categories;
  const channels = { ...b.channels };
  const posts = { ...b.posts };
  if (!inLauncher) {
    delete channels.hammershop;
    delete posts.hammershop;
  }
  db.setBuild(guild.id, { ...b, categories, channels, posts });
  return guild;
}
const update = async (guild) => {
  const i = createInteraction({ guild, member: guild.members.cache.get(guild.ownerId) ?? guild.addMember(guild.ownerId), kind: 'command', commandName: 'build', options: { only: 'update' } });
  await handle(i, commands);
  return textOf(lastResponse(i));
};

test('/build only:update on a server built before #hammershop existed: the category appears between LAUNCHER and PARTNERSTWA, with the channel in it', async () => {
  const guild = await builtBeforeTheCategory({ inLauncher: false });
  assert.deepEqual(categoryOrder(guild).slice(1, 5), ['catWelcome', 'catLauncher', 'catPartnerships', 'catSupport']);
  const res = await addMissing(guild);
  assert.deepEqual(res.errors, []);
  assert.equal(res.categories.length, 1);
  assert.match(res.categories[0], /🛒/);
  assert.equal(res.channels.length, 1);
  assert.match(res.channels[0], /^🤝/);
  // Discord creates a category at the bottom of the server – the bot puts it where the layout has it.
  assert.deepEqual(categoryOrder(guild), ['catStats', 'catWelcome', 'catLauncher', 'catPartner', 'catPartnerships', 'catSupport', 'catCommunity', 'catStaff', 'catLogs', 'catTickets', 'catClosed']);
  assert.equal(channel(guild, 'hammershop').parentId, db.build(guild.id).categories.catPartner);
  assert.match(text(guild, 'hammershop'), /współtwórca/);
});

test('/build only:update on a server that already has #hammershop in LAUNCHER: the channel moves into the new category, its card stays', async () => {
  const guild = await builtBeforeTheCategory({ inLauncher: true });
  const ch = channel(guild, 'hammershop');
  const messages = ch.messageList.map((m) => m.id);
  // Someone's own category in the middle of the server keeps its place among the others.
  const own = await guild.channels.create({ name: 'MOJA KATEGORIA', type: ChannelType.GuildCategory });
  const out = await update(guild);
  assert.match(out, /Serwer zaktualizowany/);
  assert.match(out, /Przeniesione do właściwej kategorii:\*\* # 🤝/);
  const b = db.build(guild.id);
  assert.equal(ch.parentId, b.categories.catPartner, 'moved – not created a second time');
  assert.equal(guild.channels.cache.filter((c) => /^🤝/.test(c.name)).size, 1);
  assert.deepEqual(ch.messageList.map((m) => m.id), messages, 'the banner and the card are the same messages');
  assert.deepEqual(categoryOrder(guild), ['catStats', 'catWelcome', 'catLauncher', 'catPartner', 'catPartnerships', 'catSupport', 'catCommunity', 'catStaff', 'catLogs', 'catTickets', 'catClosed', own.name]);
  // The channel guide in #informacje lists it under its own heading now.
  assert.match(text(guild, 'information'), new RegExp(`HammerShop\\n> <#${ch.id}> – HammerShop, nasz współtwórca`));
  // Running it again changes nothing.
  const again = await update(guild);
  assert.match(again, /nic – serwer ma już wszystkie kanały i role/);
  assert.doesNotMatch(again, /Przeniesione/);
});

test('/build only:update leaves #hammershop alone when someone put it into a category of their own', async () => {
  const guild = await built();
  const own = await guild.channels.create({ name: 'PARTNERZY', type: ChannelType.GuildCategory });
  const ch = channel(guild, 'hammershop');
  await ch.setParent(own.id);
  const res = await addMissing(guild);
  assert.deepEqual([res.moved, res.channels, res.errors], [[], [], []]);
  assert.equal(ch.parentId, own.id);
});

test('/build only:update replaces the logo emoji when its picture changed (the old gold H → the voxel hammer) before it redraws the cards', async () => {
  const guild = await built();
  const before = db.emojiIds(guild.id).logo;
  assert.ok(before, 'the server has the logo emoji');
  assert.match(json(guild, 'hammershop'), new RegExp(`<:hs_logo:${before}>`));
  // The server was built when the logo was another picture.
  db.setEmoji(guild.id, 'logo', before, 'aaaaaaaaaaaa');
  const out = await update(guild);
  assert.match(out, /Emotki:\*\* zamienione na nowy wygląd: 1/);
  const after = db.emojiIds(guild.id).logo;
  assert.notEqual(after, before);
  assert.equal(guild.emojis.cache.has(before), false, 'the old emoji is gone');
  assert.equal(db.emojiArt(guild.id).logo, artOf('logo'));
  const card = json(guild, 'hammershop');
  assert.match(card, new RegExp(`<:hs_logo:${after}>`), 'the card shows the new emoji');
  assert.doesNotMatch(card, new RegExp(before), 'no dead emoji left on the card');
  assert.doesNotMatch(`${json(guild, 'information')}${json(guild, 'welcome')}${json(guild, 'tickets')}`, new RegExp(before));
  // A logo uploaded before pictures were remembered is replaced once too – then left alone.
  const g = db.guild(guild.id);
  delete g.emojiArt.logo;
  assert.match(await update(guild), /zamienione na nowy wygląd: 1/);
  assert.doesNotMatch(await update(guild), /Emotki:/);
});

test('the ticket panel: no „Zgłoś użytkownika” and no „Odwołanie od kary”; the rules send appeals elsewhere', async () => {
  const guild = await built();
  assert.deepEqual(config.ticketTypes.map((t) => t.id), ['order', 'support', 'bug', 'plus', 'reward', 'partner', 'apply']);
  const panel = `${text(guild, 'tickets')}\n${json(guild, 'tickets')}`;
  assert.doesNotMatch(panel, /Zgłoś użytkownika|Odwołanie od kary|ticket:open:(report|appeal)/);
  assert.match(panel, /Pomoc z launcherem/);
  const rules = text(guild, 'rules');
  assert.doesNotMatch(rules, /Odwołanie od kary/);
  assert.match(rules, /Od kary możesz się odwołać: napisz ticket \*\*Pomoc z launcherem\*\*/);
  assert.match(rules, /E-mail:\*\* hammerlauncherclient@gmail\.com/, 'the contact address is in §1');
  assert.match(text(guild, 'information'), /Wolisz e-mail\?.*hammerlauncherclient@gmail\.com/);
});

test('a ticket opened in a category that was removed later can still be claimed, closed and deleted', async () => {
  const guild = await built();
  const staff = staffOf(guild);
  const owner = guild.addMember('300000000000000202', [db.roleId(guild.id, 'member')]);
  const ch = await tickets.openTicket(owner, config.getType('support'), [{ label: 'Temat', value: 'Stare zgłoszenie' }]);
  db.updateTicket(ch.id, { typeId: 'report' }); // as if it had been opened as „Zgłoś użytkownika” before the update
  assert.equal(config.getType('report'), null);

  await tickets.claimTicket(ch, staff);
  assert.equal(db.getTicket(ch.id).claimedBy, staff.id);
  await tickets.closeTicket(ch, staff, 'załatwione');
  assert.equal(db.getTicket(ch.id).status, 'closed');
  await tickets.deleteTicket(ch, staff);
  assert.equal(db.getTicket(ch.id).status, 'deleted'); // the channel itself goes a few seconds later
});

test('no reminders about unclaimed tickets on this server – however long a ticket waits', async () => {
  const guild = await built();
  assert.equal(config.staffReminders.enabled, false);
  const owner = guild.addMember('300000000000000203', [db.roleId(guild.id, 'member')]);
  const ch = await tickets.openTicket(owner, config.getType('support'), [{ label: 'Temat', value: 'Czekam' }]);
  db.updateTicket(ch.id, { createdAt: Date.now() - 5 * 3_600_000 });
  const chat = channel(guild, 'staffChat');
  const before = chat.messageList.length;
  assert.equal(await reminders.sweep(guild.client, Date.now()), 0);
  assert.equal(await reminders.sweep(guild.client, Date.now() + 24 * 3_600_000), 0);
  assert.equal(chat.messageList.length, before, 'nothing posted, nobody pinged');
  assert.equal(db.getTicket(ch.id).unclaimedRemindedAt, undefined);
});
