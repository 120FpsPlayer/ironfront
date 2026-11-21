'use strict';

// The Hammer Launcher server before its public premiere: what every member and the team see there must speak
// launcher – no shop's commands, banners, AutoMod messages or texts.
process.env.HS_TEST_PROFILE = 'launcher';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { buildServer } = require('../src/builder/executor');
const { addMissing } = require('../src/builder/update');
const config = require('../src/lib/config');
const { localizeCommand } = require('../src/lib/commandsPl');
const commands = require('../src/commands')();

const SHOP_WORDS = /HammerShop|[Ss]klep|[Oo]pini[ae]|[Zz]amówie|[Pp]rodukt|[Ss]przedawc|🛒|📦|🏷️|💳|tylko-klienci|zrealizuj/;

async function built() {
  const guild = new FakeGuild({ ownerId: '1' });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

test('every slash command on the launcher server: no shop in names, descriptions and choices (/pomoc names Hammer Launcher)', () => {
  const texts = [];
  const walk = (node, where) => {
    texts.push([`${where} name`, node.name], [`${where} description`, node.description]);
    for (const c of node.choices ?? []) texts.push([`${where} choice`, c.name]);
    for (const o of node.options ?? []) walk(o, `${where} ${o.name}`);
  };
  for (const cmd of commands.values()) {
    const json = localizeCommand(cmd.data.toJSON());
    walk(json, `/${json.name}`);
  }
  const shopLike = texts.filter(([, t]) => SHOP_WORDS.test(String(t ?? '')));
  assert.deepEqual(shopLike, [], 'shop words in the launcher server\'s commands');
  assert.match(localizeCommand(commands.get('help').data.toJSON()).description, /Hammer Launcher/);
});

test('/ogloszenie offers only the launcher\'s own banners – a shared banner would carry the HammerShop name', () => {
  const announce = require('../src/features/announce');
  const { bannerPath, ASSETS } = require('../src/lib/theme');
  assert.ok(announce.BANNER_CHOICES.length >= 5);
  for (const [key] of announce.BANNER_CHOICES) {
    assert.equal(path.dirname(bannerPath(key)), path.join(ASSETS, 'banners-launcher'), `/ogloszenie baner:${key}`);
  }
});

test('AutoMod: the rules and the message members see when a message is blocked carry Hammer Launcher, not HammerShop', async () => {
  const guild = await built();
  const rules = [...guild.autoModerationRules.cache.values()];
  assert.equal(rules.length, 6);
  for (const rule of rules) {
    assert.match(rule.name, /^Hammer Launcher · /);
    for (const a of rule.actions) if (a.metadata.customMessage) assert.equal(a.metadata.customMessage, 'Zablokowane przez AutoMod Hammer Launcher. Przeczytaj regulamin.');
  }
});

test('/zbuduj tylko:update renames the AutoMod rules a build made as „HammerShop” – alert channel and timeouts stay, your own rules too', async () => {
  // The server was built when every server was „HammerShop” (before the launcher profile had its own name).
  const brand = config.brand.name;
  config.brand.name = 'HammerShop';
  let guild;
  try {
    guild = await built();
  } finally {
    config.brand.name = brand;
  }
  const own = await guild.autoModerationRules.create({ name: 'HammerShop · Moja reguła', triggerType: 1, eventType: 1, triggerMetadata: { keywordFilter: ['*xyz*'] }, actions: [{ type: 1, metadata: { customMessage: 'Moja wiadomość' } }] });
  const before = [...guild.autoModerationRules.cache.values()].filter((r) => r !== own);
  assert.ok(before.every((r) => r.name.startsWith('HammerShop · ')));

  const res = await addMissing(guild);
  assert.deepEqual(res.errors, []);
  assert.equal(res.automod.length, 6);
  const alerts = db.channelId(guild.id, 'automodLogs');
  for (const rule of before) {
    assert.match(rule.name, /^Hammer Launcher · /);
    const block = rule.actions.find((a) => a.type === 1);
    if (block) assert.equal(block.metadata.customMessage, 'Zablokowane przez AutoMod Hammer Launcher. Przeczytaj regulamin.');
    const alert = rule.actions.find((a) => a.type === 2);
    if (alert) assert.equal(alert.metadata.channelId, alerts, `${rule.name}: still alerts in #logi-automod`);
  }
  const timeouts = before.flatMap((r) => r.actions.filter((a) => a.type === 3).map((a) => a.metadata.durationSeconds)).sort((a, b) => a - b);
  assert.deepEqual(timeouts, [600, 3600]);
  assert.equal(own.name, 'HammerShop · Moja reguła', 'a rule the bot does not know is left alone');
  assert.equal((await addMissing(guild)).automod.length, 0, 'nothing left to rename the second time');
});

test('the 💻 Developer is one of the admins: team channels, logs and #kopie-zapasowe – also on a server built before (tylko:update)', async () => {
  const guild = await built();
  const dev = guild.addMember('300000000000000501', [db.roleId(guild.id, 'member'), db.roleId(guild.id, 'developer')]);
  const member = guild.addMember('300000000000000502', [db.roleId(guild.id, 'member')]);
  const ch = (key) => guild.channels.cache.get(db.channelId(guild.id, key));
  const PRIVATE = ['staffChat', 'staffCommands', 'discordUpdates', 'ticketLogs', 'transcripts', 'serverLogs', 'automodLogs', 'backups'];
  const sees = (m, key) => ch(key).permissionsFor(m).has('ViewChannel');
  for (const key of PRIVATE) {
    assert.ok(sees(dev, key), `the Developer sees #${key}`);
    assert.ok(!sees(member, key), `a member does not see #${key}`);
  }
  assert.ok(ch('announcements').permissionsFor(dev).has('SendMessages'), 'the Developer can post in a read-only channel');
  assert.ok(!ch('announcements').permissionsFor(member).has('SendMessages'));

  // A server built before: the channels have no overwrite for the Developer – the update gives it, once.
  const devRole = db.roleId(guild.id, 'developer');
  for (const c of guild.channels.cache.values()) await c.permissionOverwrites.delete(devRole);
  db.setBuild(guild.id, { ...db.build(guild.id), developerAccess: undefined });
  assert.ok(!sees(dev, 'staffChat'));
  const res = await addMissing(guild);
  assert.deepEqual(res.errors, []);
  for (const key of PRIVATE) assert.ok(sees(dev, key), `after the update the Developer sees #${key}`);
  assert.equal(db.build(guild.id).developerAccess, true);
});

test('#hammer-plus names the same perks as the website: animated themes, wings / halo / hats, the 💎 Hammer+ rank, yesterday\'s world', async () => {
  const guild = await built();
  const { textOf } = require('./helpers/fakeInteraction');
  const card = guild.channels.cache.get(db.channelId(guild.id, 'plus')).messageList.map((m) => textOf(m.body)).join('\n');
  for (const perk of [/ruchomym tłem/, /skrzydła, aureola i czapki/, /Ranga \*\*💎 Hammer\+\*\* na naszym Discordzie/, /wczorajszą wersję/, /Chmura/, /200 skórek/, /Znaczek Hammer\+/]) {
    assert.match(card, perk);
  }
});

test('a lockdown on the launcher server talks about tickets only – no orders or vouches there', async () => {
  const guild = await built();
  const lockdown = require('../src/features/lockdown');
  const tickets = require('../src/tickets/tickets');
  const { textOf } = require('./helpers/fakeInteraction');
  const owner = guild.members.cache.get('1') ?? guild.addMember('1', []);
  const reply = await lockdown.lock(guild, owner, 'Trwa raid');
  const notice = guild.channels.cache.get(db.channelId(guild.id, 'announcements')).messageList.map((m) => textOf(m.body)).join('\n');
  assert.match(notice, /nowe tickety/);
  assert.doesNotMatch(notice + JSON.stringify(lockdown.lockReply(guild, reply, 'Trwa raid')), /zamówieni|opini/);
  const member = guild.addMember('300000000000000503', [db.roleId(guild.id, 'member')]);
  await assert.rejects(tickets.openTicket(member, config.getType('support'), []), (err) => /nowe tickety są wstrzymane/.test(err.message) && !/zamówieni/.test(err.message));
  await lockdown.unlock(guild, owner);
  const after = guild.channels.cache.get(db.channelId(guild.id, 'announcements')).messageList.map((m) => textOf(m.body)).join('\n');
  assert.doesNotMatch(after, /zamówieni|opini/);
});

test('start-up: no Hammer+ key on the launcher server → a clear console line (nothing on sale, no codes) that warns against a new key', () => {
  const { env } = require('../src/env');
  const hammerplus = require('../src/features/hammerplus');
  const saved = env.plusPrivateKey;
  try {
    env.plusPrivateKey = '';
    assert.match(hammerplus.keyWarning(true), /brak HAMMER_PLUS_PRIVATE_KEY[\s\S]*nie jest w sprzedaży[\s\S]*nowy klucz z npm run plus-key nie zadziała/);
    assert.equal(hammerplus.keyWarning(false), null, 'the shop server sells no Hammer+ – no warning there');
    assert.match(hammerplus.setupHelp(), /Masz już klucz/);
  } finally {
    env.plusPrivateKey = saved;
  }
});

test('verification in a burst of joins: Discord gets its answer before the role change waits in Discord\'s queue', async () => {
  const guild = await built();
  const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
  const handle = require('../src/handlers/interactions');
  const verify = guild.channels.cache.get(db.channelId(guild.id, 'verify'));
  const newcomer = guild.addMember('300000000000000504', [], { createdTimestamp: Date.now() - 30 * 86_400_000 });
  const start = createInteraction({ guild, member: newcomer, kind: 'button', customId: 'verify:start', channel: verify });
  await handle(start, commands);
  const [, , a, b] = start.state.modals[0].custom_id.split(':');
  const answer = createInteraction({ guild, member: newcomer, kind: 'modal', customId: start.state.modals[0].custom_id, fields: { answer: String(Number(a) + Number(b)) }, channel: verify });
  const add = newcomer.roles.add.bind(newcomer.roles);
  let answeredFirst = null;
  newcomer.roles.add = async (...args) => {
    answeredFirst = answer.deferred || answer.replied;
    return add(...args);
  };
  await handle(answer, commands);
  assert.equal(answeredFirst, true, 'the interaction was answered (deferred) before the role was added');
  assert.ok(newcomer.roles.cache.has(db.roleId(guild.id, 'member')));
  assert.match(textOf(lastResponse(answer)), /Konto zweryfikowane![\s\S]*/);
  assert.match(JSON.stringify(lastResponse(answer)), /Pobierz launcher/);
});

test('/pomoc for the owner lists every command of the launcher server – also turning the AI assistant on and off', async () => {
  const guild = await built();
  const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
  const handle = require('../src/handlers/interactions');
  const owner = guild.members.cache.get('1') ?? guild.addMember('1', []);
  const i = createInteraction({ guild, member: owner, kind: 'command', commandName: 'help' });
  await handle(i, commands);
  const help = textOf(lastResponse(i));
  for (const cmd of commands.values()) {
    const name = localizeCommand(cmd.data.toJSON()).name;
    if (name !== 'pomoc') assert.ok(help.includes(`/${name}`), `/pomoc names /${name}`);
  }
  assert.match(help, /\/asystent wlacz` · `\/asystent wylacz/);
  assert.doesNotMatch(help, SHOP_WORDS);
});

test('Hammer+ DM after a purchase and the #hammer-plus card: „płatność online”, not „kartą” (Stripe also takes BLIK, Przelewy24…)', async () => {
  const guild = await built();
  const { textOf } = require('./helpers/fakeInteraction');
  const website = require('../src/features/website');
  const hammerplus = require('../src/features/hammerplus');
  const { env } = require('../src/env');
  const saved = env.plusPrivateKey;
  env.plusPrivateKey = require('node:crypto').generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  try {
    const { code, record } = hammerplus.grantKnown(guild.id, { mc: '069a79f444e94726a5befca90e38aaf5', nick: 'Notch', days: 30, now: Date.now(), discordId: '300000000000000505' });
    const dm = textOf(website.plusDm(guild, { id: 'o1', amount: 1499 }, code, record, 'added'));
    assert.match(dm, /płatność online \(Stripe\)/);
    assert.doesNotMatch(dm, /kartą/);
  } finally {
    env.plusPrivateKey = saved;
  }
  const card = guild.channels.cache.get(db.channelId(guild.id, 'plus')).messageList.map((m) => textOf(m.body)).join('\n');
  assert.match(card, /Zapłać online przez Stripe/);
  assert.doesNotMatch(card, /Zapłać kartą/);
});

test('the backup card and file, and /zaproszenia, on the launcher server: no sales, products, vouches, promo codes or invite rewards', () => {
  const backups = require('../src/features/backups');
  const guild = new FakeGuild({ ownerId: '1' });
  const card = backups.backupEmbed(guild, { name: 'x.json.gz', size: 1000, rawSize: 4000, createdAt: Date.now(), counts: { tickets: 2, openTickets: 1, sales: 0, products: 0, vouches: 0, promos: 0 } }).toJSON();
  const names = card.fields.map((f) => f.name);
  assert.deepEqual(names.filter((n) => /Sprzedaż|Produkty|Opinie|Kody rabatowe/.test(n)), []);
  assert.ok(names.includes('Tickety'));
  assert.match(backups.fileName(new Date('2026-10-03T12:05:00Z')), /^hammer-launcher-backup-2026-10-03-\d{4}\.json\.gz$/);
  const invites = localizeCommand(commands.get('invites').data.toJSON());
  assert.doesNotMatch(JSON.stringify(invites), /nagrod/);
});

test('🎧 Support moderates: it sees #logi-automod (not the admins\' logs) and can time people out – also on a server built before (tylko:update)', async () => {
  const guild = await built();
  const support = guild.addMember('300000000000000601', [db.roleId(guild.id, 'member'), db.roleId(guild.id, 'support')]);
  const ch = (key) => guild.channels.cache.get(db.channelId(guild.id, key));
  const sees = (key) => ch(key).permissionsFor(support).has('ViewChannel');
  assert.ok(sees('automodLogs') && sees('ticketLogs') && sees('staffChat'));
  assert.ok(!sees('serverLogs') && !sees('backups') && !sees('discordUpdates'));
  assert.ok(guild.roles.cache.get(db.roleId(guild.id, 'support')).permissions.has('ModerateMembers'), 'Support can give a timeout (Przerwa)');

  // A server built before: #logi-automod had no overwrite for Support – the update gives it, once.
  await ch('automodLogs').permissionOverwrites.delete(db.roleId(guild.id, 'support'));
  db.setBuild(guild.id, { ...db.build(guild.id), supportAutomod: undefined });
  assert.ok(!sees('automodLogs'));
  const res = await addMissing(guild);
  assert.deepEqual(res.errors, []);
  assert.ok(sees('automodLogs') && !sees('serverLogs'));
  assert.equal(db.build(guild.id).supportAutomod, true);
});

test('Poradnik zespołu: what the whole team does (tickets, timeouts, deleting messages) apart from what only admins do (Hammer+, panel)', async () => {
  const guild = await built();
  const { textOf } = require('./helpers/fakeInteraction');
  const guide = guild.channels.cache.get(db.channelId(guild.id, 'staffChat')).messageList.map((m) => textOf(m.body)).join('\n');
  assert.match(guide, /Cały zespół[\s\S]*Tickety[\s\S]*Przerwa[\s\S]*Usuń wiadomość[\s\S]*Admini[\s\S]*hammerplus nadaj[\s\S]*Panel admina/);
});

test('ticket „🤝 Partnerstwo”: on the ticket panel, a form Discord accepts (≤5 fields, short labels), the AI thanks and calls the team', async () => {
  const guild = await built();
  const type = config.getType('partner');
  assert.ok(type && !type.disabled, 'the type exists and is on');
  assert.equal(type.label, 'Partnerstwo');
  assert.ok(type.questions.length <= 5, 'a Discord form holds at most 5 fields');
  for (const q of type.questions) {
    assert.ok(q.label.length <= 45, `label „${q.label}” fits Discord's 45 characters`);
    assert.ok((q.placeholder ?? '').length <= 100, `placeholder of „${q.label}” fits Discord's 100 characters`);
  }
  const panel = guild.channels.cache.get(db.channelId(guild.id, 'tickets')).messageList.map((m) => JSON.stringify(m.body?.components ?? m.body)).join('\n');
  assert.match(panel, /Partnerstwo/, 'the ticket panel offers it');
  const { GREETINGS, SYSTEM_PROMPT } = require('../src/features/ai/prompt');
  assert.match(GREETINGS.partner, /propozycję partnerstwa/);
  assert.match(SYSTEM_PROMPT, /partner \(Partnerstwo\)[^\n]*wezwij zespół/);
});
