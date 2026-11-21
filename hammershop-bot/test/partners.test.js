'use strict';

// Partnerships on the Hammer Launcher server: the 🤝 PARTNERSTWA category (/build, /build only:update, made by the
// feature itself), the admin panel's „Partnerstwa” tab – a partner's Discord server gets a channel with a card, its
// Minecraft server goes to the launcher's featured list – the logo upload, the announcements, and the website's
// „Partnerzy” page. Over real HTTP against a local copy of the website with a fake Discord server; at the end the tab
// and the page in a real browser.
process.env.HS_TEST_PROFILE = 'launcher';

const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { FakeGuild, addRemoteInvite } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { startFakes, useFakes } = require('./helpers/webFakes');
const { buildServer } = require('../src/builder/executor');
const { CATEGORIES, ROLES } = require('../src/builder/layout');
const { env } = require('../src/env');
const featured = require('../src/features/featured');
const partners = require('../src/features/partners');
const logos = require('../src/lib/partnerLogo');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const webAuth = require('../src/web/discord');
const handle = require('../src/handlers/interactions');
const commands = require('../src/commands')();
const { createWebServer } = require('../src/web/server');

const OWNER = { id: '1', username: 'szef', global_name: 'Szef', avatar: null };
const ADMIN = { id: '200000000000000401', username: 'adminka', global_name: 'Adminka', avatar: null };
const MEMBER = { id: '200000000000000402', username: 'gracz', global_name: 'Gracz', avatar: null };
const ASSETS = path.join(__dirname, '..', 'web', 'public', 'assets');
const ICON = fs.readFileSync(path.join(ASSETS, 'launcher-icon.png')); // a real 256×256 PNG
const PHOTO = fs.readFileSync(path.join(ASSETS, 'hammershop-games.jpg')); // a real 1024×1024 JPEG

let fakes;
let site;
let base;
let guild;
const sids = {};

test.before(async () => {
  fakes = await startFakes();
  guild = new FakeGuild({ ownerId: OWNER.id });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  guild.addMember(ADMIN.id, [db.roleId(guild.id, ROLES.find((r) => r.perms === 'admin').key)]);
  guild.addMember(MEMBER.id, [db.roleId(guild.id, 'member')]);
  website._setClient(guild.client);
  webAuth.setClientId('123');
  webStore.load();
  site = createWebServer({
    catalog: website.catalog, info: () => ({ invite: 'https://discord.gg/hammerlauncher' }), onLogin: website.onLogin, isMember: website.isMember, currency: () => 'pln',
    featured: website.featuredServers, level: website.panelLevel, log: website.panelLog, featuredAdmin: website.panelFeatured, announcements: website.panelAnnouncements, partners: website.panelPartners,
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref();
  base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;
  useFakes(env, fakes.base, base);
  for (const [name, user] of Object.entries({ owner: OWNER, admin: ADMIN, member: MEMBER })) sids[name] = await signIn(user);
});
test.after(() => {
  site?.close();
  fakes?.server.close();
});
test.afterEach(() => cleanUp()); // every test starts with no partners, whatever the one before did

let ip = 0;
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].trim()).find((c) => c.startsWith(`${name}=`)) ?? '';

async function signIn(user) {
  fakes.state.user = user;
  const start = await fetch(`${base}/api/shop/auth/start?next=admin`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const jar = [cookieOf(start, 'hs_oauth'), cookieOf(start, 'hs_next')].filter(Boolean).join('; ');
  const back = await fetch(`${base}/api/shop/auth/callback?code=good&state=${state}`, { headers: { cookie: jar }, redirect: 'manual' });
  return cookieOf(back, 'hs_sid');
}

/** → { status, body, headers, raw }. raw: bytes sent as they are (type: their content type); who: null – not signed in. */
async function call(method, pathname, { who = 'owner', body, raw, type, origin = base } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: 'manual',
    headers: {
      'x-forwarded-for': `10.95.${Math.floor(++ip / 250)}.${ip % 250}`,
      ...(who && { cookie: sids[who] }),
      ...(origin && method !== 'GET' && { origin }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(raw !== undefined && { 'content-type': type ?? 'application/octet-stream' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    ...(raw !== undefined && { body: raw }),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  let parsed = null;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    parsed = bytes.toString('utf8');
  }
  return { status: res.status, body: parsed, headers: res.headers, raw: bytes };
}
const api = (method, route, opts) => call(method, `/api/admin/${route}`, opts);
const channel = (key) => guild.channels.cache.get(db.channelId(guild.id, key));
const text = (ch) => ch.messageList.map((m) => textOf(m.body)).join('\n');
const logText = () => text(channel('serverLogs'));
const category = () => guild.channels.cache.get(db.build(guild.id).categories.catPartnerships);
/** The bot's categories from the top of the server down, by their layout keys. */
function categoryOrder(g = guild) {
  const keyOf = Object.fromEntries(Object.entries(db.build(g.id).categories).map(([key, id]) => [id, key]));
  return [...g.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1)).map((c) => keyOf[c.id] ?? c.name);
}
const ORDER = ['catStats', 'catWelcome', 'catLauncher', 'catPartner', 'catPartnerships', 'catSupport', 'catCommunity', 'catStaff', 'catLogs', 'catTickets', 'catClosed'];

/** A PNG of any size (a real one – zlib and CRCs). */
function png(width, height) {
  const chunk = (kind, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(kind, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  const line = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([255, 154, 60]))]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => line)))), chunk('IEND', Buffer.alloc(0))]);
}
/** A small GIF (64×64). */
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([64, 0, 64, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, 0x2c, 0, 0, 0, 0, 64, 0, 64, 0, 0, 2, 2, 0x44, 0x01, 0, 0x3b])]);

const discordPartner = (fields = {}) => ({ name: 'Kraina Craftu', kind: 'discord', description: 'Przyjazny serwer survival z eventami co tydzień.', invite: addRemoteInvite({ name: 'Kraina Craftu', icon: 'https://cdn.discordapp.com/icons/9/kraina.png', members: 1532 }).url, ...fields });
const mcPartner = (fields = {}) => ({ name: 'Blokowo', kind: 'minecraft', description: 'Skyblock z ekonomią i działkami.', address: 'Play.Blokowo.pl', mc: '1.21.4', loader: 'fabric', tags: 'skyblock, Ekonomia', ...fields });
const add = (fields, opts) => api('POST', 'partners', { body: fields, ...opts });
const cleanUp = async () => {
  for (const p of [...partners.list(guild.id)]) await partners.remove(guild, p.id);
};

test('/build: 🤝 PARTNERSTWA right after 🛒 HAMMERSHOP and before 🎧 POMOC – #współpraca in it, read-only for members, the team and the bot write', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.key), ORDER);
  assert.deepEqual(categoryOrder(), ORDER);
  const cat = category();
  assert.equal(cat.name, '〔 🤝 PARTNERSTWA 〕'); // the server's category style, like the others
  const info = channel('partnerships');
  assert.equal(info.parentId, cat.id);
  assert.match(info.name, /^📋┃/);
  assert.match(text(info), new RegExp(`^# 🤝 Partnerstwa\\nWspółpracujemy z serwerami, które lubimy[\\s\\S]*Jak zostać partnerem\\?\\n> \\*\\*1\\.\\*\\* Napisz do nas – ticketem \\*\\*🤝 Partnerstwo\\*\\* na <#${channel('tickets').id}>[\\s\\S]*ogłaszamy na <#${channel('announcements').id}>`));
  // With the website's address set: the contact form (topic „Współpraca”) and the „Partnerzy” page too.
  const { postsFor } = require('../src/builder/content.launcher');
  const x = { guild, ch: (k) => `<#${db.channelId(guild.id, k)}>`, link: () => null, url: () => null, E: () => '•', icon: null, brand: 'Hammer Launcher' };
  const withSite = postsFor('partnerships', x, null)[0].payload;
  assert.match(textOf(withSite), /przez formularz kontaktowy na stronie \(temat \*\*Współpraca\*\*\) albo ticketem/);
  assert.ok(JSON.stringify(withSite.components.map((c) => c.toJSON())).includes(`"url":"${base}/partnerzy"`));
  const member = guild.members.cache.get(MEMBER.id);
  const support = guild.addMember('200000000000000403', [db.roleId(guild.id, 'member'), db.roleId(guild.id, 'support')]);
  assert.equal(info.permissionsFor(member).has(PermissionFlagsBits.ViewChannel), true, 'members read');
  assert.equal(info.permissionsFor(member).has(PermissionFlagsBits.SendMessages), false, 'members do not write');
  assert.equal(info.permissionsFor(support).has(PermissionFlagsBits.SendMessages), true, 'Support writes');
  assert.equal(info.permissionsFor(guild.members.cache.get(ADMIN.id)).has(PermissionFlagsBits.SendMessages), true, 'admins write');
  // The channel guide in #informacje and the staff guide name it.
  assert.match(text(channel('information')), new RegExp(`### \\S+ Partnerstwa\\n> <#${info.id}> – nasi partnerzy i jak zostać jednym z nich`));
  assert.match(text(channel('staffChat')), /\*\*Partnerstwa\*\* – zakładka w panelu/);
});

test('/build only:update on a server built before partnerships: the category and #współpraca appear in their place – once', async () => {
  const g = new FakeGuild({ ownerId: OWNER.id });
  await buildServer({ guild: g, mode: 'add', invokerId: g.ownerId });
  const b = db.build(g.id);
  await g.channels.cache.get(b.channels.partnerships).delete();
  await g.channels.cache.get(b.categories.catPartnerships).delete();
  const { catPartnerships: _c, ...categories } = b.categories;
  const { partnerships: _ch, ...channels } = b.channels;
  const { partnerships: _p, ...posts } = b.posts;
  db.setBuild(g.id, { ...b, categories, channels, posts });
  assert.deepEqual(categoryOrder(g).slice(3, 5), ['catPartner', 'catSupport']);
  const run = async () => {
    const i = createInteraction({ guild: g, member: g.members.cache.get(g.ownerId) ?? g.addMember(g.ownerId), kind: 'command', commandName: 'build', options: { only: 'update' } });
    await handle(i, commands);
    return textOf(lastResponse(i));
  };
  const out = await run();
  assert.match(out, /Serwer zaktualizowany/);
  assert.match(out, /PARTNERSTWA/);
  assert.deepEqual(categoryOrder(g), ORDER, 'Discord puts a new category at the bottom – the bot moves it under HAMMERSHOP');
  const info = g.channels.cache.get(db.build(g.id).channels.partnerships);
  assert.equal(info.parentId, db.build(g.id).categories.catPartnerships);
  assert.match(text(info), /Jak zostać partnerem\?/);
  assert.match(await run(), /nic – serwer ma już wszystkie kanały i role/);
});

test('who may manage partners: the owner and admins, only from the panel – members and strangers never; Polish checks', async () => {
  const form = mcPartner();
  assert.equal((await api('GET', 'partners', { who: null })).status, 401);
  assert.equal((await api('GET', 'partners', { who: 'member' })).status, 403);
  assert.equal((await add(form, { who: 'member' })).status, 403);
  assert.equal((await add(form, { origin: null })).status, 403, 'CSRF: no Origin header');
  assert.equal((await add(form, { origin: 'https://evil.example' })).status, 403, 'CSRF: another site');
  assert.equal((await api('PUT', 'partners/logo', { raw: ICON, type: 'image/png', origin: null })).status, 403);
  assert.equal((await api('PUT', 'partners/logo', { raw: ICON, type: 'image/png', who: 'member' })).status, 403);
  assert.equal((await api('DELETE', 'partners/nie-ma', { origin: null })).status, 403);
  assert.deepEqual(partners.list(guild.id), []);
  const wrong = async (fields, message) => {
    const res = await add({ ...form, ...fields });
    assert.equal(res.status, 400, `${message}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error, message);
  };
  await wrong({ name: '  ' }, 'Wpisz nazwę partnera.');
  await wrong({ name: 'x'.repeat(41) }, 'Nazwa może mieć najwyżej 40 znaków (teraz 41).');
  await wrong({ kind: 'facebook' }, 'Wybierz rodzaj współpracy: Discord, Minecraft albo Discord + Minecraft.');
  await wrong({ description: '' }, 'Napisz kilka słów o partnerze – opis pokaże się na karcie.');
  await wrong({ description: 'x'.repeat(201) }, 'Opis może mieć najwyżej 200 znaków (teraz 201).');
  await wrong({ address: '' }, 'Wpisz adres serwera Minecraft partnera, np. mc.partner.pl.');
  await wrong({ address: 'https://blokowo.pl' }, 'Podaj adres serwera jako host albo host:port, np. mc.hammershop.pl albo mc.hammershop.pl:25566 – bez https:// i bez spacji.');
  await wrong({ tags: 'a, b, c, d, e, f' }, 'Podaj najwyżej 5 tagów – szósty, „partner”, bot dodaje sam.');
  await wrong({ icon: 'http://x.pl/a.png' }, 'Ikona musi być adresem obrazka zaczynającym się od https:// (najwyżej 300 znaków).');
  await wrong({ kind: 'discord', invite: '' }, 'Wklej link zaproszenia na serwer Discord partnera, np. https://discord.gg/abc123.');
  assert.equal((await api('POST', 'partners', { raw: 'null', type: 'application/json' })).status, 400, 'an empty form, not a crash');
  // An admin adds like the owner.
  const ok = await add(form, { who: 'admin' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.partner.addedBy, { id: ADMIN.id, name: 'Adminka' });
  await cleanUp();
});

test('a Discord partnership: the invite is checked, a read-only channel under PARTNERSTWA with a card – name, description, people, „Dołącz do serwera”', async () => {
  const before = featured.list(guild.id).length;
  const res = await add(discordPartner());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const p = partners.list(guild.id)[0];
  assert.deepEqual([p.id, p.kind, p.discord.guildName, p.discord.memberCount, p.minecraft], ['kraina-craftu', 'discord', 'Kraina Craftu', 1532, null]);
  assert.match(p.discord.invite, /^https:\/\/discord\.gg\/p\d+$/);
  const ch = guild.channels.cache.get(p.discord.channelId);
  assert.equal(ch.parentId, category().id);
  assert.equal(ch.name, '🤝┃ᴋʀᴀɪɴᴀ-ᴄʀᴀꜰᴛᴜ', 'the server\'s channel style');
  assert.equal(ch.topic, 'Partner Hammer Launcher – Przyjazny serwer survival z eventami co tydzień.');
  const member = guild.members.cache.get(MEMBER.id);
  assert.equal(ch.permissionsFor(member).has(PermissionFlagsBits.ViewChannel), true);
  assert.equal(ch.permissionsFor(member).has(PermissionFlagsBits.SendMessages), false, 'members cannot write');
  assert.equal(ch.messageList.length, 1);
  const card = ch.messageList[0].body;
  assert.match(textOf(card), /^# 🤝 Kraina Craftu\nPrzyjazny serwer survival z eventami co tydzień\.[\s\S]*\*\*1532 osoby\*\* na serwerze Discord[\s\S]*Discord · partner Hammer Launcher od <t:\d+:D>/);
  const json = JSON.stringify(card.components.map((c) => c.toJSON()));
  assert.ok(json.includes(`"url":"${p.discord.invite}"`) && json.includes('"label":"Dołącz do serwera"'));
  assert.ok(json.includes('"url":"https://cdn.discordapp.com/icons/9/kraina.png"'), 'the Discord server\'s icon as the thumbnail');
  assert.deepEqual(card.allowedMentions, { parse: [] });
  assert.equal(featured.list(guild.id).length, before, 'nothing in the launcher');
  assert.match(logText(), /Nowe partnerstwo: \*\*Kraina Craftu\*\* \(Discord\) · <@1>/);
  // The panel's list.
  const list = await api('GET', 'partners');
  assert.deepEqual(list.body.partners.map((x) => [x.name, x.kindLabel, x.discord.channel.id, x.image]), [['Kraina Craftu', 'Discord', ch.id, 'https://cdn.discordapp.com/icons/9/kraina.png']]);
  assert.deepEqual([list.body.info.category.id, list.body.info.max, list.body.info.featured.max], [category().id, 45, 25]);
  // The same server twice, or the same name: refused.
  const again = await add(discordPartner({ name: 'Inna nazwa', invite: `https://discord.com/invite/${p.discord.code}` }));
  assert.deepEqual([again.status, again.body.error], [400, 'Serwer Discord z tego zaproszenia jest już partnerem jako „Kraina Craftu”.']);
  assert.equal((await add(discordPartner({ name: 'kraina craftu' }))).body.error, 'Partner o nazwie „Kraina Craftu” jest już na liście – wybierz inną nazwę albo edytuj tamtego partnera.');
  await cleanUp();
  assert.equal(guild.channels.cache.has(ch.id), false);
});

test('a bad invite is said in Polish – and nothing is made: a link that is no invite, a dead one, a temporary one, our own, Discord down', async () => {
  const channels = guild.channels.cache.size;
  const tryInvite = (invite) => add(discordPartner({ invite }));
  assert.equal((await tryInvite('https://example.com/abc')).body.error, 'To nie wygląda na link zaproszenia na Discorda. Wklej link w postaci https://discord.gg/abc123 albo https://discord.com/invite/abc123.');
  assert.equal((await tryInvite('discord.gg/')).status, 400);
  const dead = await tryInvite('https://discord.gg/nie-ma-takiego');
  assert.deepEqual([dead.status, dead.body.error], [400, 'To zaproszenie nie działa – wygasło albo zostało usunięte. Poproś partnera o nowe, bezterminowe zaproszenie (przy tworzeniu zaproszenia: „Wygasa po: Nigdy”).']);
  const week = addRemoteInvite({ expiresAt: Date.now() + 7 * 86_400_000 });
  assert.match((await tryInvite(week.url)).body.error, /^To zaproszenie wygaśnie \d{1,2} \S+ \d{4} – przycisk „Dołącz do serwera” przestałby wtedy działać\. Poproś partnera o zaproszenie bez terminu ważności/);
  const over = addRemoteInvite({ expiresAt: Date.now() - 1000 });
  assert.match((await tryInvite(over.url)).body.error, /^To zaproszenie nie działa/);
  const own = guild.addInvite({ code: 'naszserwer' });
  assert.equal((await tryInvite(`https://discord.gg/${own.code}`)).body.error, 'To zaproszenie prowadzi na nasz własny serwer – wklej zaproszenie na serwer partnera.');
  const down = addRemoteInvite({ fail: Object.assign(new Error('Service Unavailable'), { status: 503 }) });
  const res = await tryInvite(down.url);
  assert.equal(res.status, 502);
  assert.match(res.body.error, /^Discord nie odpowiada – nie udało się sprawdzić zaproszenia/);
  assert.deepEqual([partners.list(guild.id).length, guild.channels.cache.size], [0, channels], 'nothing kept, no channel');
});

test('a Minecraft partnership: on the launcher\'s featured list with the tag „partner” – the launcher\'s API has it at once; no channel', async () => {
  const channels = guild.channels.cache.size;
  const res = await add(mcPartner({ icon: 'https://cdn.example.com/blokowo.png' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const p = partners.list(guild.id)[0];
  assert.equal(p.discord, null);
  assert.equal(guild.channels.cache.size, channels, 'no Discord channel');
  const server = featured.find(guild.id, p.minecraft.featuredId);
  assert.deepEqual([server.name, server.address, server.tags, server.mc, server.loader, server.icon], ['Blokowo', 'play.blokowo.pl', ['partner', 'skyblock', 'ekonomia'], '1.21.4', 'fabric', null], 'no partner picture in the launcher (the owner wants logos only on the website and Discord)');
  const launcher = await call('GET', '/api/launcher/featured', { who: null });
  assert.ok(JSON.stringify(launcher.body).includes('"address":"play.blokowo.pl"'), 'the launcher reads it straight away');
  assert.equal(res.body.partner.minecraft.featured, true);
  // Its address taken by another partner – or by a featured server – is said.
  const same = await add(mcPartner({ name: 'Kopia', address: 'play.blokowo.pl' }));
  assert.equal(same.body.error, 'Serwer play.blokowo.pl jest już na liście polecanych jako Blokowo – usuń go najpierw, jeśli chcesz dodać go od nowa.');
  await cleanUp();
  assert.equal(featured.find(guild.id, server.id), null);
});

test('„Discord + Minecraft”: both – the card shows the address too; the featured list being full is said before anything is made', async () => {
  const res = await add({ ...discordPartner({ name: 'Duet' }), ...mcPartner({ name: 'Duet', kind: 'both', description: 'Discord i serwer w jednym.' }) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const p = partners.list(guild.id)[0];
  assert.ok(p.discord.channelId && p.minecraft.featuredId);
  const card = textOf(guild.channels.cache.get(p.discord.channelId).messageList[0].body);
  assert.match(card, /🎮 \*\*Serwer Minecraft:\*\* `play\.blokowo\.pl` · 1\.21\.4 · Fabric/);
  assert.match(card, /znajdziesz też w Hammer Launcherze, w „Polecanych serwerach”/);
  assert.match(card, /Discord \+ Minecraft · partner Hammer Launcher/);
  // The launcher's list full: a clear sentence, no channel left behind.
  for (let i = featured.list(guild.id).length; i < featured.MAX_SERVERS; i += 1) featured.add(guild.id, { name: `Serwer ${i}`, address: `mc${i}.example.pl`, description: 'x' });
  const channels = guild.channels.cache.size;
  const full = await add({ ...discordPartner({ name: 'Za dużo' }), ...mcPartner({ name: 'Za dużo', kind: 'both', address: 'mc.zaduzo.pl' }) });
  assert.deepEqual([full.status, full.body.error], [400, 'Lista polecanych serwerów w launcherze jest pełna (25 z 25) – usuń któryś w zakładce „Polecane serwery” albo wybierz współpracę „Discord”.']);
  assert.equal(guild.channels.cache.size, channels);
  // …but an existing partner's own entry still changes.
  const edit = await api('PUT', `partners/${p.id}`, { body: { ...discordPartner({ name: 'Duet' }), ...mcPartner({ name: 'Duet', kind: 'both', description: 'Nowy opis.', mc: '1.21.5' }), invite: p.discord.invite } });
  assert.equal(edit.status, 200, JSON.stringify(edit.body));
  assert.equal(featured.find(guild.id, p.minecraft.featuredId).mc, '1.21.5');
  for (const s of [...featured.list(guild.id)]) if (s.name.startsWith('Serwer ')) featured.remove(guild.id, s.id);
  await cleanUp();
});

test('editing: the channel is renamed and its card edited in place; switching the kind adds or takes away the channel and the featured server', async () => {
  const created = await add(discordPartner({ name: 'Zmienny' }));
  const p = partners.find(guild.id, created.body.partner.id);
  const invite = p.discord.invite;
  const ch = guild.channels.cache.get(p.discord.channelId);
  const firstCard = ch.messageList[0].id;
  // A new name and description: the same channel, renamed; the same message, edited.
  const renamed = await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Zmienny Świat', description: 'Teraz z modami!', invite }) });
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.warning, null);
  assert.equal(p.discord.channelId, ch.id);
  assert.equal(ch.name, '🤝┃ᴢᴍɪᴇɴɴʏ-ꜱᴡɪᴀᴛ');
  assert.deepEqual(ch.messageList.map((m) => m.id), [firstCard]);
  assert.match(textOf(ch.messageList[0].body), /^# 🤝 Zmienny Świat\nTeraz z modami!/);
  assert.match(logText(), /Zmieniono partnerstwo: \*\*Zmienny Świat\*\*/);
  // Discord → both: the featured server appears, the channel stays.
  const both = await api('PUT', `partners/${p.id}`, { body: { ...discordPartner({ name: 'Zmienny Świat', invite }), ...mcPartner({ name: 'Zmienny Świat', kind: 'both', address: 'mc.zmienny.pl' }) } });
  assert.equal(both.status, 200, JSON.stringify(both.body));
  const fid = p.minecraft.featuredId;
  assert.ok(featured.find(guild.id, fid));
  assert.equal(p.discord.channelId, ch.id);
  // both → Minecraft: the channel goes, the featured server stays (the same entry).
  const mc = await api('PUT', `partners/${p.id}`, { body: mcPartner({ name: 'Zmienny Świat', address: 'mc.zmienny.pl' }) });
  assert.equal(mc.status, 200, JSON.stringify(mc.body));
  assert.equal(guild.channels.cache.has(ch.id), false);
  assert.deepEqual([p.discord, p.minecraft.featuredId], [null, fid]);
  // Minecraft → Discord: a new channel, the featured server goes.
  const dc = await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Zmienny Świat', invite }) });
  assert.equal(dc.status, 200, JSON.stringify(dc.body));
  assert.equal(featured.find(guild.id, fid), null);
  assert.equal(p.minecraft, null);
  const fresh = guild.channels.cache.get(p.discord.channelId);
  assert.equal(fresh.parentId, category().id);
  // Someone deleted the channel by hand: the panel says so, a save makes it again – and ending still works.
  await fresh.delete();
  assert.equal((await api('GET', 'partners')).body.partners[0].discord.channel, null);
  await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Zmienny Świat', invite }) });
  const again = guild.channels.cache.get(p.discord.channelId);
  assert.ok(again && again.id !== fresh.id);
  await again.delete();
  const gone = await api('DELETE', `partners/${p.id}`);
  assert.deepEqual([gone.status, gone.body], [200, { ok: true, announced: null }]);
  assert.equal(partners.find(guild.id, p.id), null);
  assert.equal((await api('PUT', `partners/${p.id}`, { body: discordPartner({ invite }) })).status, 404);
  assert.equal((await api('DELETE', `partners/${p.id}`)).status, 404);
});

test('ending each kind of partnership removes everything it made – the channel, the featured server, the card on the page', async () => {
  const d = (await add(discordPartner({ name: 'Do usunięcia D' }))).body.partner;
  const m = (await add(mcPartner({ name: 'Do usunięcia M', address: 'mc.usun.pl' }))).body.partner;
  const b = (await add({ ...discordPartner({ name: 'Do usunięcia B' }), ...mcPartner({ name: 'Do usunięcia B', kind: 'both', address: 'mc.oba.pl' }) })).body.partner;
  const page = async () => (await call('GET', '/partnerzy', { who: null })).body;
  for (const name of ['Do usunięcia D', 'Do usunięcia M', 'Do usunięcia B']) assert.ok((await page()).includes(name));
  const channelOf = (id) => partners.find(guild.id, id)?.discord?.channelId;
  const featuredOf = (id) => partners.find(guild.id, id)?.minecraft?.featuredId;
  const [dc, bc, mf, bf] = [channelOf(d.id), channelOf(b.id), featuredOf(m.id), featuredOf(b.id)];
  for (const p of [d, m, b]) assert.equal((await api('DELETE', `partners/${p.id}`)).status, 200);
  assert.equal(guild.channels.cache.has(dc) || guild.channels.cache.has(bc), false, 'the channels are gone');
  assert.equal(featured.find(guild.id, mf) || featured.find(guild.id, bf), null, 'the featured servers are gone');
  const html = await page();
  for (const name of ['Do usunięcia D', 'Do usunięcia M', 'Do usunięcia B']) assert.ok(!html.includes(name), name);
  assert.match(logText(), /Zakończono partnerstwo z \*\*Do usunięcia B\*\* · <@1>/);
});

test('the logo: checked by its bytes and pixels (not its name), kept with a hash in its name, served for good – replaced and deleted with the partner', async () => {
  const upload = (bytes, type = 'image/png') => api('PUT', 'partners/logo', { raw: bytes, type });
  // Not a picture – whatever the name or type says; too big; too small; a long strip.
  const fake = await upload(Buffer.from('to nie jest obrazek, tylko tekst udający logo.png'.repeat(3)));
  assert.deepEqual([fake.status, fake.body.error], [400, 'To nie jest obrazek PNG, JPG, WebP ani GIF – sama zmiana rozszerzenia pliku nie wystarczy. Zapisz logo w jednym z tych formatów.']);
  const big = await upload(Buffer.concat([ICON, Buffer.alloc(logos.MAX_BYTES)]));
  assert.deepEqual([big.status, big.body.error], [413, 'Ten plik ma więcej niż 2 MB – logo może mieć najwyżej 2 MB. Zmniejsz je (np. na squoosh.app) i spróbuj ponownie.']);
  assert.equal((await upload(png(16, 16))).body.error, 'Logo jest za małe (16×16 px) – wybierz obrazek co najmniej 32×32 px, najlepiej 256×256 albo większy.');
  assert.equal((await upload(png(400, 100))).body.error, 'Logo jest bardzo wydłużone (400×100 px) – na karcie byłoby cienkim paskiem. Wybierz kwadratowy obrazek, np. 512×512.');
  // A GIF sent as „image/png” (a renamed file): taken for what it is.
  const gif = await upload(GIF, 'image/png');
  assert.deepEqual([gif.status, gif.body.type, gif.body.width, gif.body.height], [200, 'gif', 64, 64]);
  const photo = await upload(PHOTO, 'image/jpeg');
  assert.deepEqual([photo.body.type, photo.body.width, photo.body.height], ['jpg', 1024, 1024]);
  // Saved with the partner: data/partners/<id>-<hash>.png, shown on the page, the panel and the Discord card.
  const first = await upload(ICON);
  assert.deepEqual([first.status, first.body.type, first.body.width], [200, 'png', 256]);
  const res = await add(discordPartner({ name: 'Z logo', logo: first.body.upload }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const p = partners.find(guild.id, 'z-logo');
  assert.match(p.logo, /^z-logo-[0-9a-f]{10}\.png$/);
  const file = path.join(db.dataDir, 'partners', p.logo);
  assert.deepEqual(fs.readFileSync(file), ICON);
  assert.equal(res.body.partner.logo, `/partnerzy/logo/${p.logo}`);
  assert.equal(res.body.partner.image, `/partnerzy/logo/${p.logo}`, 'the logo comes before the Discord icon');
  const served = await call('GET', `/partnerzy/logo/${p.logo}`, { who: null });
  assert.equal(served.status, 200);
  assert.deepEqual([served.headers.get('content-type'), served.headers.get('cache-control'), served.headers.get('x-content-type-options')], ['image/png', 'public, max-age=31536000, immutable', 'nosniff']);
  assert.deepEqual(served.raw, ICON);
  const card = guild.channels.cache.get(p.discord.channelId).messageList[0];
  assert.deepEqual(card.files.map((f) => f.name), ['partner-logo.png'], 'the card uploads the file itself');
  assert.ok(JSON.stringify(card.body.components.map((c) => c.toJSON())).includes('"url":"attachment://partner-logo.png"'));
  assert.match((await call('GET', '/partnerzy', { who: null })).body, new RegExp(`<img class="partner-logo" src="/partnerzy/logo/${p.logo}"`));
  // A token is used once it is known only; an unknown one is said.
  assert.match((await add(discordPartner({ name: 'Zły token', logo: 'abc' }))).body.error, /^Wybierz plik z logo jeszcze raz/);
  // Replaced: a new name (a new address for Cloudflare), the old file gone, the card edited with the new picture.
  const second = await upload(PHOTO, 'image/jpeg');
  const old = p.logo;
  const replaced = await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Z logo', invite: p.discord.invite, logo: second.body.upload }) });
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.match(p.logo, /^z-logo-[0-9a-f]{10}\.jpg$/);
  assert.equal(fs.existsSync(path.join(db.dataDir, 'partners', old)), false);
  assert.equal((await call('GET', `/partnerzy/logo/${old}`, { who: null })).status, 404);
  assert.equal((await call('GET', `/partnerzy/logo/${p.logo}`, { who: null })).headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(guild.channels.cache.get(p.discord.channelId).messageList[0].files.map((f) => f.name), ['partner-logo.jpg']);
  // Kept when the form leaves it out; taken off with null.
  await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Z logo', invite: p.discord.invite, description: 'Inny opis.' }) });
  assert.match(p.logo, /\.jpg$/);
  const kept = p.logo;
  await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Z logo', invite: p.discord.invite, logo: null }) });
  assert.equal(p.logo, null);
  assert.equal(fs.existsSync(path.join(db.dataDir, 'partners', kept)), false);
  assert.deepEqual(guild.channels.cache.get(p.discord.channelId).messageList[0].files, [], 'the card lost its picture too');
  // Deleted with the partner.
  const third = await upload(ICON);
  await api('PUT', `partners/${p.id}`, { body: discordPartner({ name: 'Z logo', invite: p.discord.invite, logo: third.body.upload }) });
  const last = p.logo;
  await api('DELETE', `partners/${p.id}`);
  assert.equal(fs.existsSync(path.join(db.dataDir, 'partners', last)), false);
  // Only names the bot makes are served – nothing else in the data folder.
  for (const bad of ['..%2Fdb.json', '%2E%2E/db.json', 'x.png', 'z-logo-0123456789.svg', `${last}%00`, '']) assert.equal((await call('GET', `/partnerzy/logo/${bad}`, { who: null })).status, 404, bad);
  assert.equal((await call('GET', '/partnerzy/logo/../../data/db.json', { who: null })).status, 404);
});

test('„Ogłoś”: a new partnership on #📢 ogłoszenia with its logo and links – no ping; ending it says goodbye (or nothing, when unticked)', async () => {
  const news = channel('announcements');
  const before = news.messageList.length;
  const logo = await api('PUT', 'partners/logo', { raw: ICON, type: 'image/png' });
  const res = await add({ ...discordPartner({ name: 'Ogłaszany' }), ...mcPartner({ name: 'Ogłaszany', kind: 'both', address: 'mc.oglaszany.pl' }), logo: logo.body.upload, announce: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.announced.ok, true);
  assert.equal(news.messageList.length, before + 1);
  const post = news.messageList.at(-1);
  const p = partners.find(guild.id, 'oglaszany');
  assert.match(textOf(post.body), new RegExp(`^# 🤝 Nowe partnerstwo: Ogłaszany\\nZ radością ogłaszamy, że \\*\\*Ogłaszany\\*\\* zostaje naszym partnerem! 🧡\\n> Skyblock z ekonomią i działkami\\.[\\s\\S]*Ich serwer Discord: <#${p.discord.channelId}>[\\s\\S]*Serwer Minecraft: \`mc\\.oglaszany\\.pl\``));
  assert.deepEqual(post.body.allowedMentions, { parse: [] }, 'no ping');
  assert.ok(post.files.some((f) => f.name === 'partner-logo.png'), 'the logo next to the title');
  assert.ok(JSON.stringify(post.body.components.map((c) => c.toJSON())).includes(`"url":"${p.discord.invite}"`));
  assert.equal(webStore.announcementList()[0].url, post.url, 'in the „Ogłoszenia” tab\'s history');
  assert.match(logText(), /Nowe partnerstwo: \*\*Ogłaszany\*\* \(Discord \+ Minecraft\) – ogłoszone na Discordzie/);
  // Without the box: nothing on #ogłoszenia.
  await add(mcPartner({ name: 'Cichy', address: 'mc.cichy.pl' }));
  assert.equal(news.messageList.length, before + 1);
  // Discord will not delete the channel: nothing ends – and no goodbye goes out too early.
  const partnerChannel = guild.channels.cache.get(p.discord.channelId);
  const { delete: realDelete } = partnerChannel;
  partnerChannel.delete = async () => {
    throw Object.assign(new Error('Missing Permissions'), { code: 50013 });
  };
  const refused = await api('DELETE', `partners/${p.id}?announce=1`);
  partnerChannel.delete = realDelete;
  assert.equal(refused.status, 502);
  assert.match(refused.body.error, /^Nie udało się usunąć kanału partnera z Discorda: botowi brakuje uprawnień/);
  assert.equal(news.messageList.length, before + 1, 'no goodbye');
  assert.ok(partners.find(guild.id, p.id), 'still a partner');
  // Ending with the goodbye: the partner is gone, its logo file not yet – the card still has it.
  const file = path.join(db.dataDir, 'partners', p.logo);
  const end = await api('DELETE', `partners/${p.id}?announce=1`);
  assert.deepEqual([end.status, end.body.announced.ok], [200, true]);
  const bye = news.messageList.at(-1);
  assert.match(textOf(bye.body), /^# 👋 Koniec partnerstwa z Ogłaszany\nNiestety nasze partnerstwo z \*\*Ogłaszany\*\* dobiegło końca\. Dziękujemy za wspólny czas i życzymy powodzenia! 🧡/);
  assert.deepEqual(bye.body.allowedMentions, { parse: [] });
  assert.deepEqual(bye.files.map((f) => f.name), ['partner-logo.png'], 'the logo, no banner');
  assert.equal(fs.existsSync(file), false, 'the file is gone afterwards');
  assert.equal(guild.channels.cache.has(p.discord.channelId), false);
  // Ending without it: no message.
  const quiet = partners.find(guild.id, 'cichy');
  const count = news.messageList.length;
  assert.deepEqual((await api('DELETE', `partners/${quiet.id}?announce=0`)).body, { ok: true, announced: null });
  assert.equal(news.messageList.length, count);
  // No #ogłoszenia: the partner is still added; the answer says why nothing was announced.
  const kept = news.id;
  guild.channels.cache.delete(kept);
  try {
    const noChannel = await add({ ...mcPartner({ name: 'Bez kanału', address: 'mc.bez.pl' }), announce: true });
    assert.equal(noChannel.status, 200);
    assert.deepEqual(noChannel.body.announced, { ok: false, error: 'Na serwerze nie ma kanału #📢 ogłoszenia – dodaj go na Discordzie komendą /zbuduj tylko:update.' });
  } finally {
    guild.channels.cache.set(kept, news);
  }
  await cleanUp();
});

test('the partner feature makes 🤝 PARTNERSTWA itself when the server has none – in its place', async () => {
  const b = db.build(guild.id);
  const info = channel('partnerships');
  await info.setParent(null);
  await category().delete();
  assert.equal(categoryOrder().includes('catPartnerships'), false);
  const res = await add(discordPartner({ name: 'Pierwszy' }));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(categoryOrder(), ORDER);
  assert.notEqual(db.build(guild.id).categories.catPartnerships, b.categories.catPartnerships);
  assert.equal(guild.channels.cache.get(partners.find(guild.id, 'pierwszy').discord.channelId).parentId, category().id);
  await info.setParent(category().id);
  await cleanUp();
});

test('the „Partnerzy” page: a friendly word before the first partner; then a card each – logo, name, description, Discord button, the address with „Kopiuj IP”', async () => {
  const empty = await call('GET', '/partnerzy', { who: null });
  assert.equal(empty.status, 200);
  assert.match(empty.body, /<title>Partnerzy – Hammer Launcher<\/title>/);
  assert.match(empty.body, /<meta name="description" content="Serwery Discord i Minecraft, z którymi współpracuje Hammer Launcher\./);
  assert.match(empty.headers.get('content-security-policy'), /^default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:;/);
  assert.match(empty.body, /Pierwsi partnerzy już niedługo[\s\S]*temat „Współpraca”[\s\S]*href="\/kontakt"/);
  assert.doesNotMatch(empty.body, /class="partner-card/);
  await add({ ...discordPartner({ name: 'Strona <b>&' }), ...mcPartner({ name: 'Strona <b>&', kind: 'both', description: 'Opis z <script>alert(1)</script> w środku.', address: 'mc.strona.pl' }) });
  await add(mcPartner({ name: 'Tylko MC', address: 'mc.tylko.pl', mc: '', loader: '' }));
  const html = (await call('GET', '/partnerzy', { who: null })).body;
  assert.equal((html.match(/<article class="partner-card/g) ?? []).length, 2);
  assert.ok(html.indexOf('Tylko MC') < html.indexOf('Strona &lt;b&gt;&amp;'), 'the newest first');
  assert.ok(html.includes('<h2>Strona &lt;b&gt;&amp;</h2>'));
  assert.ok(html.includes('Opis z &lt;script&gt;alert(1)&lt;/script&gt; w środku.'));
  assert.doesNotMatch(html, /<script>alert|style="/);
  assert.match(html, /<a class="btn primary small" href="https:\/\/discord\.gg\/p\d+" target="_blank" rel="noopener nofollow">[\s\S]*?Dołącz na Discorda<\/a><span class="partner-members">1532 osoby na serwerze<\/span>/);
  assert.ok(html.includes('<code>mc.strona.pl</code><button class="btn small" type="button" data-copy="mc.strona.pl"'));
  assert.ok(html.includes('Adres serwera · 1.21.4 · Fabric'));
  assert.match(html, /<span class="partner-logo none" aria-hidden="true">T<\/span>/, 'no picture: the first letter');
  assert.match(html, /<img class="partner-logo" src="https:\/\/cdn\.discordapp\.com\/icons\/9\/kraina\.png"/);
  // Linked in the main navigation (the owner looked for it there), the footer, from the /hammershop page – and in the sitemap.
  const start = (await call('GET', '/', { who: null })).body;
  assert.match(start, /<nav class="nav"[^>]*>[\s\S]*?<a href="\/polecaj">Polecaj<\/a>\s*<a href="\/partnerzy">Partnerzy<\/a>/, 'in the main navigation, visible on a laptop too');
  assert.match(start, /<nav class="foot-links"[^>]*>[\s\S]*<a href="\/partnerzy">Partnerzy<\/a>/);
  assert.match((await call('GET', '/hammershop', { who: null })).body, /<a href="\/partnerzy">zobacz naszych partnerów<\/a>/);
  assert.ok((await call('GET', '/sitemap.xml', { who: null })).body.includes(`<loc>${base}/partnerzy</loc>`));
  await cleanUp();
});

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      // next
    }
  }
  return null;
}
const pw = playwright();

test('the tab in a real browser: the kind chips switch the blocks, a logo goes up with a preview, the list, editing and ending – also on a phone', { skip: !pw && 'Playwright is not installed' }, async () => {
  const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const shots = process.env.HS_SHOTS;
  const logoFile = path.join(db.dataDir, 'logo-partnera.png');
  fs.writeFileSync(logoFile, ICON);
  const notPicture = path.join(db.dataDir, 'udaje-obrazek.png');
  fs.writeFileSync(notPicture, 'to nie jest obrazek – tylko tekst z końcówką .png, który udaje logo partnera');
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const w = viewport.width;
      const context = await browser.newContext({ viewport, ...(w < 500 && { isMobile: true, hasTouch: true }) });
      await context.route(/^https:\/\/cdn\.discordapp\.com\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: ICON }));
      await context.setExtraHTTPHeaders({ 'x-forwarded-for': `10.96.0.${w % 250}` });
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
      fakes.state.user = OWNER;
      await page.goto(`${base}/api/shop/auth/start?next=admin`);
      await page.goto(`${base}/admin#partnerstwa`);
      await page.locator('#partner-list .empty').waitFor();
      if (w > 1000) assert.equal(await page.evaluate(() => new Set([...document.querySelectorAll('.tabs button')].map((b) => b.offsetTop)).size), 1, 'all 11 tabs on one line');
      // The chips: Discord shows the invite, Minecraft the server fields, both – both.
      assert.deepEqual([await page.locator('#partner-discord').isVisible(), await page.locator('#partner-minecraft').isVisible()], [true, false]);
      await page.locator('.ann-kind', { hasText: /^Minecraft$/ }).click();
      assert.deepEqual([await page.locator('#partner-discord').isVisible(), await page.locator('#partner-minecraft').isVisible()], [false, true]);
      await page.locator('.ann-kind', { hasText: 'Discord + Minecraft' }).click();
      assert.deepEqual([await page.locator('#partner-discord').isVisible(), await page.locator('#partner-minecraft').isVisible()], [true, true]);
      // Empty form: says what is missing.
      await page.locator('#partner-save').click();
      assert.equal(await page.locator('#partner-error').textContent(), 'Wpisz nazwę partnera.');
      // A file that only pretends to be a picture: the server says no.
      await page.locator('#partner-logo-file').setInputFiles(notPicture);
      await page.waitForFunction(() => /To nie jest obrazek/.test(document.getElementById('partner-error').textContent));
      // A real logo: uploaded, previewed in the square.
      await page.locator('#partner-logo-file').setInputFiles(logoFile);
      await page.waitForFunction(() => /Logo gotowe \(256×256 px\)/.test(document.getElementById('partner-logo-hint').textContent));
      await page.waitForFunction(() => document.getElementById('partner-logo-img').complete && document.getElementById('partner-logo-img').naturalWidth === 256);
      assert.equal(await page.locator('#partner-logo-remove').isVisible(), true);
      const name = `Partner ${w}`;
      await page.locator('#partner-name').fill(name);
      await page.locator('#partner-description').fill('Survival z przyjazną społecznością i eventami w każdy weekend.');
      await page.locator('#partner-invite').fill(addRemoteInvite({ name, icon: 'https://cdn.discordapp.com/icons/1/a.png', members: 87 }).url);
      await page.locator('#partner-address').fill(`mc${w}.partner.pl`);
      await page.locator('#partner-mc').fill('1.21.4');
      await page.locator('#partner-loader').selectOption('fabric');
      await page.locator('#partner-tags').fill('survival, eventy');
      await page.locator('#partner-announce').check();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (shots) await page.screenshot({ path: `${shots}/partnerstwa-formularz-${w}.png`, fullPage: true });
      await page.locator('#partner-save').click();
      const item = page.locator('#partner-list .partner-item', { hasText: name });
      await item.waitFor();
      const p = partners.list(guild.id).find((x) => x.name === name);
      assert.ok(p.logo && p.discord.channelId && p.minecraft.featuredId);
      assert.equal(await item.locator('.partner-kind').textContent(), 'Discord + Minecraft');
      assert.equal(await item.locator('img.partner-thumb').getAttribute('src'), `/partnerzy/logo/${p.logo}`);
      assert.match(await item.locator('a.btn').first().textContent(), /^#🤝┃/);
      assert.equal(await item.locator('code.partner-ip').textContent(), `mc${w}.partner.pl`);
      assert.match(await page.locator('#toast').textContent(), /Partner dodany i ogłoszony na Discordzie\./);
      assert.equal(await page.locator('#partner-name').inputValue(), '', 'the form is ready for the next one');
      assert.match(await page.locator('#partner-logo-hint').textContent(), /^PNG, JPG, WebP albo GIF/, 'the logo hint is back to its first words');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (shots) {
        await item.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${shots}/partnerstwa-lista-${w}.png` });
      }
      // Editing: the form is filled in, the logo shown; a new description is saved.
      await item.locator('button', { hasText: 'Edytuj' }).click();
      assert.equal(await page.locator('#partner-form-title').textContent(), `Edycja: ${name}`);
      assert.equal(await page.locator('#partner-announce-row').isVisible(), false);
      assert.equal(await page.locator('#partner-logo-img').getAttribute('src'), `/partnerzy/logo/${p.logo}`);
      await page.locator('#partner-description').fill('Nowy opis po edycji.');
      await page.locator('#partner-save').click();
      await page.waitForFunction(() => /Zapisano/.test(document.getElementById('toast').textContent));
      assert.equal(partners.find(guild.id, p.id).description, 'Nowy opis po edycji.');
      // Ending: the dialog says what goes; the goodbye is ticked.
      await page.locator('#partner-list .partner-item', { hasText: name }).locator('button', { hasText: 'Zakończ' }).click();
      await page.locator('#partner-delete[open]').waitFor();
      assert.equal(await page.locator('#partner-delete-title').textContent(), `Zakończyć partnerstwo z ${name}?`);
      assert.match(await page.locator('#partner-delete-text').textContent(), new RegExp(`Bot usunie kanał #🤝┃\\S+ z Discorda i serwer mc${w}\\.partner\\.pl z polecanych w launcherze, kartę ze strony „Partnerzy” i logo\\.`));
      assert.equal(await page.locator('#partner-delete-announce').isChecked(), true);
      if (shots) await page.screenshot({ path: `${shots}/partnerstwa-zakoncz-${w}.png` });
      const posts = channel('announcements').messageList.length;
      await page.locator('#partner-delete-yes').click();
      await page.locator('#partner-list .empty').waitFor();
      assert.match(await page.locator('#toast').textContent(), /pożegnanie jest na #ogłoszenia/);
      assert.equal(channel('announcements').messageList.length, posts + 1);
      assert.equal(partners.find(guild.id, p.id), null);
      assert.deepEqual(problems, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test('the „Partnerzy” page in a real browser at 1366 and 390 px: no console errors, nothing wider than the screen, „Kopiuj IP” copies', { skip: !pw && 'Playwright is not installed' }, async () => {
  const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const shots = process.env.HS_SHOTS;
  try {
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const w = viewport.width;
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', ...(w < 500 && { isMobile: true, hasTouch: true }) });
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      await page.goto(`${base}/partnerzy`);
      await page.locator('.empty-card').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${w}: empty – no sideways scrolling`);
      if (shots) await page.screenshot({ path: `${shots}/strona-partnerzy-pusta-${w}.png`, fullPage: true });
      await context.close();
    }
    const logo = await api('PUT', 'partners/logo', { raw: ICON, type: 'image/png' });
    await add({ ...discordPartner({ name: 'Kraina Craftu' }), ...mcPartner({ name: 'Kraina Craftu', kind: 'both', address: 'mc.kraina-craftu.pl', description: 'Przyjazny serwer survival z eventami co tydzień i własnymi questami.' }), logo: logo.body.upload });
    await add(mcPartner({ name: 'Blokowo', address: 'play.blokowo.pl', icon: 'https://cdn.discordapp.com/icons/2/blokowo.png' }));
    await add(discordPartner({ name: 'Ekipa Budowniczych', description: 'Discord dla wszystkich, którzy lubią budować – konkursy, porady i wspólne projekty.' }));
    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      const w = viewport.width;
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', ...(w < 500 && { isMobile: true, hasTouch: true }) });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
      await context.route(/^https:\/\/cdn\.discordapp\.com\//, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: ICON }));
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      await page.goto(`${base}/partnerzy`);
      await page.locator('.partner-card').first().waitFor();
      assert.equal(await page.locator('.partner-card').count(), 3);
      await page.waitForFunction(() => [...document.querySelectorAll('img.partner-logo')].every((i) => i.complete && i.naturalWidth > 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${w}: no sideways scrolling`);
      if (shots) await page.screenshot({ path: `${shots}/strona-partnerzy-${w}.png`, fullPage: true });
      const copy = page.locator('.partner-card', { hasText: 'Kraina Craftu' }).locator('[data-copy]');
      await copy.click();
      await page.waitForFunction(() => document.querySelector('[data-copy="mc.kraina-craftu.pl"]').textContent === 'Skopiowano!');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'mc.kraina-craftu.pl');
      assert.match(await page.locator('#toast').textContent(), /Adres mc\.kraina-craftu\.pl skopiowany/);
      assert.deepEqual(problems, []);
      await context.close();
    }
  } finally {
    await browser.close();
    await cleanUp();
  }
});
