'use strict';

// The Hammer Launcher server (BOT_PROFILE=launcher): the same bot with its own name, logo, channels, roles, rules and
// website – and nothing of the shop. This file runs in its own process, so the profile is set before anything loads.
process.env.HS_TEST_PROFILE = 'launcher';

const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { startFakes, useFakes } = require('./helpers/webFakes');
const { buildServer } = require('../src/builder/executor');
const { env } = require('../src/env');
const config = require('../src/lib/config');
const profile = require('../src/lib/profile');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const tickets = require('../src/tickets/tickets');
const stats = require('../src/features/stats');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const webAuth = require('../src/web/discord');
const { CATEGORIES, ROLES } = require('../src/builder/layout');
const { createWebServer } = require('../src/web/server');

const OWNER = { id: '1', username: 'szef', global_name: 'Szef', avatar: null };
const commands = loadCommands();
let fakes;
let site;
let base;
let guild;
let ownerSid;

const channel = (key) => guild.channels.cache.get(db.channelId(guild.id, key));
const channelText = (key) => channel(key).messageList.map((m) => textOf(m.body)).join('\n');
const everything = () => guild.channels.cache.map((c) => (c.messageList ?? []).map((m) => textOf(m.body)).join('\n')).join('\n');
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].trim()).find((c) => c.startsWith(`${name}=`)) ?? '';

test.before(async () => {
  fakes = await startFakes();
  guild = new FakeGuild({ ownerId: OWNER.id });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  env.plusPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  website._setClient(guild.client);
  webAuth.setClientId('123');
  webStore.load();
  site = createWebServer({
    catalog: website.catalog, info: () => ({ invite: 'https://discord.gg/hammerlauncher' }), onPaid: website.onPaid, onLogin: website.onLogin, isMember: website.isMember, currency: () => 'eur',
    featured: website.featuredServers, level: website.panelLevel, announce: website.announce, log: website.panelLog, plus: website.panelPlus, featuredAdmin: website.panelFeatured,
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref();
  base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;
  useFakes(env, fakes.base, base);
  fakes.state.user = OWNER;
  const start = await fetch(`${base}/api/shop/auth/start?next=admin`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await fetch(`${base}/api/shop/auth/callback?code=good&state=${state}`, { headers: { cookie: [cookieOf(start, 'hs_oauth'), cookieOf(start, 'hs_next')].join('; ') }, redirect: 'manual' });
  ownerSid = cookieOf(back, 'hs_sid');
});
test.after(() => {
  site?.close();
  fakes?.server.close();
});

const admin = async (method, route, body, raw) => {
  const res = await fetch(`${base}/api/admin/${route}`, {
    method,
    headers: { cookie: ownerSid, origin: base, ...(body && { 'content-type': 'application/json' }), ...(raw && { 'content-type': 'application/octet-stream' }) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('the profile: its own name, logo, rules and ticket types laid over the shop\'s settings', () => {
  assert.deepEqual([profile.name, profile.launcher, profile.shop], ['launcher', true, false]);
  assert.equal(config.brand.name, 'Hammer Launcher');
  assert.equal(config.server.logo, 'launcher');
  assert.equal(config.rules.file, 'regulamin-launcher.md');
  assert.deepEqual(config.ticketTypes.map((t) => t.id), ['order', 'support', 'bug', 'plus', 'reward', 'report', 'apply', 'appeal']);
  assert.equal(config.getType('order').shopOnly, true);
  // What only a shop needs is off; the rest keeps the shop's well-tried settings.
  for (const key of ['shopStatus', 'salesReport', 'welcomeDiscount', 'promos', 'affiliates', 'balance', 'gifts', 'cart', 'deals', 'abandonedOrders']) assert.equal(Boolean(config[key].enabled), false, key);
  assert.equal(config.backups.enabled, true);
  assert.equal(config.verification.captcha, true);
  assert.deepEqual(config.overlay({ a: { b: 1, c: [1, 2] }, d: 1 }, { a: { c: [3] }, e: 2 }), { a: { b: 1, c: [3] }, d: 1, e: 2 });
});

test('/build makes the Hammer Launcher server: its name, the H as the icon, its own channels and roles – no shop', () => {
  assert.equal(guild.name, 'Hammer Launcher');
  assert.equal(path.basename(guild.iconSet), 'logo-launcher.png');
  for (const key of ['verify', 'rules', 'welcome', 'information', 'announcements', 'roles', 'launcher', 'updates', 'news', 'plus', 'faq', 'tickets', 'bugs', 'suggestions', 'chat', 'screenshots', 'servers', 'giveaways', 'leaderboard', 'boosters', 'statMembers', 'statVersion', 'statDownloads', 'ticketLogs', 'backups']) {
    assert.ok(channel(key), `#${key}`);
  }
  for (const key of ['shop', 'howToBuy', 'payments', 'restocks', 'vouches', 'proofs', 'sales', 'statShop', 'statVouches']) assert.equal(db.channelId(guild.id, key), null, `no #${key}`);
  assert.equal(CATEGORIES.reduce((n, c) => n + c.channels.length, 0), 33);
  assert.deepEqual(CATEGORIES.map((c) => c.key), ['catStats', 'catWelcome', 'catLauncher', 'catSupport', 'catCommunity', 'catStaff', 'catLogs', 'catTickets', 'catClosed']);

  const names = guild.roles.cache.map((r) => r.name);
  for (const name of ['🔨 Hammer Launcher', '👑 CEO', '💻 Developer', '🧪 Tester', '✅ Członek', '🚀 Aktualizacje']) assert.ok(names.includes(name), name);
  for (const name of ['🔨 HammerShop', '💼 Sprzedawca', '🛍️ Klient', '🧡 Stały Klient', '📦 Dostawy']) assert.ok(!names.includes(name), `no ${name}`);
  assert.equal(ROLES[0].key, 'brand');
  // A developer is one of the bot's admins.
  const dev = guild.addMember('300000000000000001', [db.roleId(guild.id, 'developer')]);
  assert.equal(require('../src/lib/permissions').isAdmin(dev), true);
});

test('every card is the launcher\'s: its own banners, download, Hammer+, bug reports – and not a word about a shop', () => {
  const files = (key) => channel(key).messageList.flatMap((m) => m.files.map((f) => f.name));
  assert.deepEqual(files('launcher'), ['hammerlauncher-launcher.png']);
  assert.deepEqual(files('plus'), ['hammerlauncher-plus.png']);
  assert.deepEqual(files('bugs'), ['hammerlauncher-bugs.png']);
  // The banners with the H in the corner come from assets/banners-launcher/.
  assert.match(require('../src/lib/theme').bannerPath('launcher'), /banners-launcher[\\/]launcher\.png$/);
  assert.match(require('../src/lib/theme').bannerPath('tickets'), /banners[\\/]tickets\.png$/, 'a banner the launcher server has no own version of is shared');

  assert.match(channelText('launcher'), /Hammer Launcher[\s\S]*wersja beta[\s\S]*FPS boost jednym kliknięciem/);
  assert.match(channelText('welcome'), /Witamy w Hammer Launcher[\s\S]*pobierz launcher na <#\d+>/);
  assert.match(channelText('plus'), /Hammer\+[\s\S]*Nie daje żadnej przewagi w grze[\s\S]*„Mam kod”/);
  assert.match(channelText('bugs'), /Zgłoś błąd[\s\S]*Konsola → Udostępnij log/);
  assert.match(channelText('faq'), /Skąd pobrać launcher\?[\s\S]*SmartScreen[\s\S]*Java Edition/);
  assert.match(channelText('updates'), /każdą nową wersję/);
  assert.match(channelText('rules'), /Regulamin Hammer Launcher[\s\S]*§4 · Hammer\+[\s\S]*§7 · Prywatność/);
  assert.match(channelText('information'), /O Hammer Launcher[\s\S]*Przewodnik po kanałach[\s\S]*tworzy launcher i Hammer Client/);
  assert.match(channelText('staffChat'), /Poradnik zespołu[\s\S]*hammerplus nadaj[\s\S]*Panel admina/);
  // The ticket panel: the launcher's categories, and not the shop's "Zakup".
  const panel = channelText('tickets');
  assert.match(panel, /Pomoc z launcherem[\s\S]*Zgłoś błąd[\s\S]*Hammer\+ i płatności[\s\S]*Rekrutacja/);
  assert.doesNotMatch(panel, /Zakup w sklepie|Przejdź do sklepu|🛒/);
  // The notification roles: Ogłoszenia, Giveawaye and – instead of the shop's Dostawy – Aktualizacje.
  assert.match(channelText('roles'), /Aktualizacje\*\* – każda nowa wersja launchera/);
  assert.doesNotMatch(channelText('roles'), /Dostawy|Klient/);

  const all = everything();
  for (const shopWord of [/HammerShop/, /PaysafeCard/, /\bSklep\b/, /Kup\*\*/, /opini[eę]/i, /koszyk/i, /saldo/i]) assert.doesNotMatch(all, shopWord);
});

test('a newcomer is welcomed and, once verified, sent to the download – not to a shop', async () => {
  const welcome = require('../src/features/welcome');
  const member = guild.addMember('300000000000000009', []);
  const card = textOf(welcome.welcomeCard(member));
  assert.match(card, /Witaj w Hammer Launcher[\s\S]*Zweryfikuj się na <#\d+>[\s\S]*pobierz launcher na <#\d+>/);
  assert.match(card, /Pobierz launcher/);
  assert.doesNotMatch(card, /Sklep/);
});

test('the launcher\'s own logo emoji; everything else is the shop\'s emoji set', () => {
  const emojis = require('../src/builder/emojis');
  const ASSETS = require('../src/lib/theme').ASSETS;
  assert.ok(require('node:fs').existsSync(path.join(ASSETS, 'emojis-launcher', 'logo.png')));
  assert.ok(require('node:fs').existsSync(path.join(ASSETS, 'brand', 'logo-launcher.png')));
  assert.ok(require('node:fs').existsSync(path.join(ASSETS, 'brand', 'server-banner-launcher.png')));
  assert.ok(emojis); // the module loads with the profile's file lookup
});

test('tickets: a bug report opens like any ticket; the shop\'s commands are gone, /help and /launcher speak launcher', async () => {
  const member = guild.addMember('300000000000000002', [db.roleId(guild.id, 'member')]);
  const opened = await tickets.openTicket(member, config.getType('bug'), [{ label: 'Co nie działa?', value: 'Edytor HUD nie zapisuje pozycji' }, { label: 'Wersja launchera i Minecrafta', value: '2.6.0, 1.21.4 Fabric' }]);
  assert.match(opened.name, /^🐛.*0001$/u);
  assert.match(opened.messageList.map((m) => textOf(m.body)).join('\n'), /Edytor HUD nie zapisuje pozycji/);

  assert.deepEqual([...commands.keys()].sort(), ['announce', 'backup', 'blacklist', 'build', 'featured', 'giveaway', 'hammerplus', 'help', 'invites', 'launcher', 'lockdown', 'panel', 'reply', 'setup', 'stats', 'ticket', 'unlock']);
  for (const shopCommand of loadCommands.SHOP_ONLY) assert.equal(commands.has(shopCommand), false, shopCommand);

  const help = createInteraction({ guild, member: guild.members.cache.get(OWNER.id), kind: 'command', commandName: 'help' });
  await handle(help, commands);
  const helpText = textOf(lastResponse(help));
  assert.match(helpText, /Hammer Launcher – pomoc[\s\S]*\/launcher[\s\S]*Hammer\+ i launcher[\s\S]*panelu admina/);
  assert.doesNotMatch(helpText, /produkt|promocj|Kup|sklep/i);

  const card = createInteraction({ guild, member, kind: 'command', commandName: 'launcher' });
  await handle(card, commands);
  const buttons = JSON.stringify(lastResponse(card).components.map((c) => (c.toJSON ? c.toJSON() : c)));
  assert.ok(buttons.includes(`"${base}/"`) && buttons.includes(`${base}/#plus`), 'on the launcher\'s own site the page is the front page');
});

test('the website: the front page is the launcher\'s, with the H and the name Hammer Launcher – no shop page', async () => {
  for (const page of ['/', '/launcher', '/cokolwiek']) {
    const res = await fetch(base + page);
    const html = await res.text();
    assert.equal(res.status, 200, page);
    assert.match(html, /<title>Hammer Launcher – nasz własny launcher Minecrafta<\/title>/, page);
    assert.match(html, /class="logo h"[^>]*>.*Hammer<b>Launcher<\/b>/, page);
    assert.match(html, /launcher-icon\.png/);
    assert.doesNotMatch(html, /HammerShop|<!--|Sklep/, page);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  }
  const adminPage = await (await fetch(`${base}/admin`)).text();
  assert.match(adminPage, /<title>Panel admina – Hammer Launcher<\/title>/);
  assert.doesNotMatch(adminPage, /HammerShop|<!--shop|<!--launcher/);
  assert.equal((await fetch(`${base}/assets/launcher-h.png`)).status, 200);
  assert.equal((await fetch(`${base}/assets/nie-ma.png`)).status, 404);
  assert.deepEqual((await (await fetch(`${base}/api/shop/store`)).json()).products, [], 'nothing is sold as a shop product');
});

test('the admin panel posts where the launcher server expects it, and the stat channels follow the releases', async () => {
  assert.deepEqual([stats.statNames(guild).statVersion, stats.statNames(guild).statDownloads], [stats.STAT_NAMES.statVersion(null), stats.STAT_NAMES.statDownloads(0)]);
  await admin('PUT', 'releases/file?name=Hammer-Launcher-Setup-2.6.0.exe', null, Buffer.from('MZ launcher'));
  const published = await admin('POST', 'releases', { version: '2.6.0', file: 'Hammer-Launcher-Setup-2.6.0.exe', notes: 'Pierwsza beta.', discord: true });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const release = channel('updates').messageList.at(-1);
  assert.match(textOf(release.body), /Hammer Launcher 2\.6\.0[\s\S]*Pierwsza beta\./);
  assert.ok(JSON.stringify(release.body.allowedMentions ?? release.body.allowed_mentions ?? {}).includes(db.roleId(guild.id, 'pingUpdates')), 'the 🚀 Aktualizacje role is pinged');
  assert.equal(channel('launcher').messageList.length, 2, 'the download channel keeps just its card');

  const news = await admin('POST', 'news', { title: 'Nowy sezon', body: 'Start w piątek.', discord: true });
  assert.match(news.body.discord, /^https:\/\/discord\.com\/channels\//);
  assert.match(textOf(channel('news').messageList.at(-1).body), /Nowy sezon[\s\S]*Start w piątek\./);

  await fetch(`${base}/download`, { redirect: 'manual' });
  const names = stats.statNames(guild);
  assert.deepEqual([names.statVersion, names.statDownloads], [stats.STAT_NAMES.statVersion('2.6.0'), stats.STAT_NAMES.statDownloads(1)]);
  assert.match(names.statVersion, /2\.6\.0$/);
  assert.equal('statShop' in names, false);

  const feed = await (await fetch(`${base}/api/launcher/news`)).json();
  assert.deepEqual([feed.release.version, feed.release.url, feed.news[0].title], ['2.6.0', `${base}/download`, 'Nowy sezon']);
});
