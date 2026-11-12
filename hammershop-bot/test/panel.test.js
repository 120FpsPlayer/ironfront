'use strict';

// The admin panel, the launcher's news feed, the installer downloads and Hammer+ sold by card – over real HTTP against
// a local copy of the website, with fake Discord, Stripe and Mojang.
const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { startFakes, useFakes } = require('./helpers/webFakes');
const { buildServer } = require('../src/builder/executor');
const { env } = require('../src/env');
const plus = require('../src/lib/plus');
const hammerplus = require('../src/features/hammerplus');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const webAuth = require('../src/web/discord');
const releases = require('../src/web/releases');
const { createWebServer } = require('../src/web/server');

const KEY = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const OWNER = { id: '1', username: 'szef', global_name: 'Szef', avatar: null };
const ADMIN = { id: '200000000000000001', username: 'adminka', global_name: 'Adminka', avatar: null };
const MEMBER = { id: '200000000000000002', username: 'gracz', global_name: 'Gracz', avatar: null };
const BUYER = { id: '200000000000000003', username: 'kupiec', global_name: 'Kupiec', avatar: null };
const MC = { Notch: '069a79f444e94726a5befca90e38aaf5', Steve: '8667ba71b85a4004af54457a9734eed7' };

let fakes;
let site;
let base;
let guild;
const sids = {};

test.before(async () => {
  fakes = await startFakes();
  guild = new FakeGuild({ ownerId: OWNER.id });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  guild.addMember(ADMIN.id, [db.roleId(guild.id, 'admin')]);
  guild.addMember(MEMBER.id, [db.roleId(guild.id, 'member')]);
  guild.addMember(BUYER.id, [db.roleId(guild.id, 'member')]);
  env.plusPrivateKey = KEY;
  // Mojang, faked: two accounts exist.
  hammerplus.setFetch(async (url) => {
    const nick = decodeURIComponent(String(url).split('/').pop());
    const hit = Object.keys(MC).find((n) => n.toLowerCase() === nick.toLowerCase());
    return hit ? { ok: true, status: 200, json: async () => ({ id: MC[hit], name: hit }) } : { ok: false, status: 404, json: async () => ({}) };
  });
  website._setClient(guild.client);
  webAuth.setClientId('123');
  webStore.load();
  site = createWebServer({
    catalog: website.catalog, info: () => ({ invite: 'https://discord.gg/hammershop' }), onPaid: website.onPaid, onLogin: website.onLogin, isMember: website.isMember, currency: () => 'eur',
    featured: website.featuredServers, level: website.panelLevel, announce: website.announce, log: website.panelLog, plus: website.panelPlus, featuredAdmin: website.panelFeatured,
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref();
  base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;
  useFakes(env, fakes.base, base);
  for (const [name, user] of Object.entries({ owner: OWNER, admin: ADMIN, member: MEMBER, buyer: BUYER })) sids[name] = await signIn(user);
});
test.after(() => {
  site?.close();
  fakes?.server.close();
});

let ip = 0;
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].trim()).find((c) => c.startsWith(`${name}=`)) ?? '';

async function signIn(user, next = null) {
  fakes.state.user = user;
  const start = await fetch(`${base}/api/shop/auth/start${next ? `?next=${next}` : ''}`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const jar = [cookieOf(start, 'hs_oauth'), cookieOf(start, 'hs_next')].filter(Boolean).join('; ');
  const back = await fetch(`${base}/api/shop/auth/callback?code=good&state=${state}`, { headers: { cookie: jar }, redirect: 'manual' });
  signIn.landed = back.headers.get('location');
  return cookieOf(back, 'hs_sid');
}

/** → { status, body, headers }. who: 'owner' | 'admin' | 'member' | 'buyer' | null (not signed in). */
async function call(method, pathname, { who = null, body, raw, origin = base, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: 'manual',
    headers: {
      'x-forwarded-for': `10.9.${Math.floor(++ip / 250)}.${ip % 250}`,
      ...(who && { cookie: sids[who] }),
      ...(origin && method !== 'GET' && method !== 'HEAD' && { origin }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(raw !== undefined && { 'content-type': 'application/octet-stream' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
    ...(raw !== undefined && { body: raw }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let parsed = buf.toString('utf8');
  try {
    parsed = JSON.parse(parsed);
  } catch {
    // a file, a page or an empty answer
  }
  return { status: res.status, body: parsed, bytes: buf, headers: res.headers };
}
const admin = (method, route, opts = {}) => call(method, `/api/admin/${route}`, { who: 'owner', ...opts });
const feed = async (ua = 'Hammer-Launcher/2.6.0 (hammershop.pl)') => (await call('GET', '/api/launcher/news', { headers: { 'user-agent': ua } })).body;
const channelText = (key) => guild.channels.cache.get(db.channelId(guild.id, key)).messageList.map((m) => textOf(m.body)).join('\n');
const everything = () => guild.channels.cache.map((c) => (c.messageList ?? []).map((m) => textOf(m.body)).join('\n')).join('\n');

test('the panel is only for the shop\'s people: not signed in, a plain member, an admin, the owner', async () => {
  assert.equal((await call('GET', '/api/admin/me')).status, 401);
  const member = await call('GET', '/api/admin/me', { who: 'member' });
  assert.equal(member.status, 403);
  assert.match(member.body.error, /nie ma dostępu do panelu/);
  assert.equal((await call('GET', '/api/admin/me', { who: 'admin' })).body.level, 'admin');
  const owner = await admin('GET', 'me');
  assert.deepEqual([owner.body.level, owner.body.user.name], ['owner', 'Szef']);
  // A change without the panel's own Origin (another site, a script) is refused – also for the owner.
  assert.equal((await admin('POST', 'news', { body: { title: 'x' }, origin: null })).status, 403);
  assert.equal((await admin('POST', 'news', { body: { title: 'x' }, origin: 'https://evil.example' })).status, 403);
  assert.equal(webStore.newsList().length, 0);
});

test('news: written in the panel, shown in the launcher (pinned first), posted on Discord when asked', async () => {
  assert.deepEqual(await feed(), { news: [], alert: null, release: null });
  const first = await admin('POST', 'news', { who: 'admin', body: { title: '  Nowy   sezon ', body: 'Startujemy w piątek.\r\n\r\n\r\n\r\nZapraszamy!', tag: 'Serwer', url: 'https://hammershop.pl/sezon' } });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual([first.body.item.title, first.body.item.body, first.body.item.tag, first.body.item.pinned], ['Nowy sezon', 'Startujemy w piątek.\n\nZapraszamy!', 'Serwer', false]);
  assert.match(first.body.item.date, /^\d{2}\.\d{2}\.\d{4}$/);
  const pinned = await admin('POST', 'news', { body: { title: 'Ważne: przerwa', body: 'W sobotę.', pinned: true, discord: true } });
  assert.match(pinned.body.discord, /^https:\/\/discord\.com\/channels\//);
  assert.match(channelText('launcher'), /Ważne: przerwa[\s\S]*W sobotę\./);
  await admin('POST', 'news', { body: { title: 'Trzecia', body: '' } });
  const titles = (await feed()).news.map((n) => n.title);
  assert.deepEqual(titles, ['Ważne: przerwa', 'Trzecia', 'Nowy sezon']);
  // Links must be https; a title is required.
  assert.match((await admin('POST', 'news', { body: { title: 'x', url: 'http://hammershop.pl' } })).body.error, /https/);
  assert.match((await admin('POST', 'news', { body: { title: 'x', url: 'javascript:alert(1)' } })).body.error, /https/);
  assert.equal((await admin('POST', 'news', { body: { title: '   ' } })).status, 400);
  // Edit and delete.
  const id = first.body.item.id;
  assert.equal((await admin('PUT', `news/${id}`, { body: { pinned: true, title: 'Nowy sezon – start!' } })).body.item.pinned, true);
  assert.equal((await feed()).news[1].title, 'Nowy sezon – start!');
  assert.equal((await admin('DELETE', `news/${id}`)).status, 200);
  assert.equal((await admin('DELETE', `news/${id}`)).status, 404);
  assert.equal((await feed()).news.length, 2);
  assert.match(everything(), /Panel admina[\s\S]*Nowa aktualność w launcherze: \*\*Nowy sezon\*\* · <@200000000000000001>/, 'every change is written to the log channel with who did it');
});

test('the alert bar: set with a level and a time limit, gone when the time is up or it is switched off', async () => {
  assert.match((await admin('PUT', 'alert', { body: { level: 'loud', text: 'x' } })).body.error, /rodzaj/);
  assert.match((await admin('PUT', 'alert', { body: { level: 'info', text: ' ' } })).body.error, /treść/);
  const set = await admin('PUT', 'alert', { who: 'admin', body: { level: 'warning', text: 'Przerwa techniczna 20:00–21:00', url: 'https://hammershop.pl/status', hours: 2 } });
  assert.equal(set.status, 200, JSON.stringify(set.body));
  const shown = (await feed()).alert;
  assert.deepEqual([shown.level, shown.text, shown.url], ['warning', 'Przerwa techniczna 20:00–21:00', 'https://hammershop.pl/status']);
  assert.ok(shown.until > Date.now() + 110 * 60_000 && shown.until < Date.now() + 130 * 60_000);
  assert.equal(webStore.getAlert(Date.now() + 3 * 3_600_000), null, 'past its time it is not shown');
  const forever = await admin('PUT', 'alert', { body: { level: 'critical', text: 'Zaktualizuj launcher' } });
  assert.equal(forever.body.alert.until, null);
  assert.notEqual(forever.body.alert.id, shown.id, 'a new alert has a new id – launchers that closed the old one show it');
  assert.equal((await admin('DELETE', 'alert')).body.alert, null);
  assert.equal((await feed()).alert, null);
});

test('launcher starts are counted per day and version – only for launchers, and never who', async () => {
  const before = JSON.parse(JSON.stringify(webStore.stats().launches[webStore.dayOf()] ?? { total: 0, unique: 0, versions: {} }));
  await call('GET', '/api/launcher/news', { headers: { 'user-agent': 'Hammer-Launcher/9.9.1 (hammershop.pl)', 'x-forwarded-for': '10.77.0.1' } });
  await call('GET', '/api/launcher/news', { headers: { 'user-agent': 'Hammer-Launcher/9.9.1 (hammershop.pl)', 'x-forwarded-for': '10.77.0.1' } });
  await call('GET', '/api/launcher/news', { headers: { 'user-agent': 'Hammer-Launcher/9.9.2 (hammershop.pl)', 'x-forwarded-for': '10.77.0.2' } });
  await call('GET', '/api/launcher/news', { headers: { 'user-agent': 'Mozilla/5.0 (a browser on the launcher page)', 'x-forwarded-for': '10.77.0.3' } });
  const today = webStore.stats().launches[webStore.dayOf()];
  assert.equal(today.total - before.total, 3);
  assert.equal(today.unique - before.unique, 2);
  assert.deepEqual([today.versions['9.9.1'], today.versions['9.9.2']], [1, 1], 'an open launcher asking again is still one launcher');
  assert.equal((await call('GET', '/updates/%E0%A4%A')).status, 404, 'a broken address is just "not found"');
  assert.doesNotMatch(JSON.stringify(webStore.stats()), /10\.77\.0/);
  const o = (await admin('GET', 'overview')).body;
  assert.equal(o.launches.days.length, 14);
  assert.equal(o.launches.today, today.unique);
});

const installer = (text) => Buffer.concat([Buffer.from('MZ'), Buffer.from(text.repeat(200))]);
const sha512 = (buf) => crypto.createHash('sha512').update(buf).digest('base64');

test('launcher releases: only the owner publishes; latest.yml, the download and Range requests come from this server', async () => {
  assert.equal((await call('GET', '/updates/latest.yml')).status, 404);
  const none = await call('GET', '/download');
  assert.deepEqual([none.status, none.headers.get('location')], [302, '/launcher?download=none']);

  const v1 = installer('wersja pierwsza ');
  // An admin may look, but not upload or publish.
  assert.equal((await admin('PUT', 'releases/file?name=Hammer-Launcher-Setup-2.6.0.exe', { who: 'admin', raw: v1 })).status, 403);
  assert.equal((await admin('GET', 'releases', { who: 'admin' })).body.canEdit, false);
  // Names that could leave the folder or are not installers are refused.
  for (const bad of ['../x.exe', 'a b.exe', 'virus.bat', '.hidden.exe', 'x.exe/../../y.exe']) {
    assert.equal((await admin('PUT', `releases/file?name=${encodeURIComponent(bad)}`, { raw: v1 })).status, 400, bad);
  }
  const up = await admin('PUT', 'releases/file?name=Hammer-Launcher-Setup-2.6.0.exe', { raw: v1 });
  assert.deepEqual(up.body, { name: 'Hammer-Launcher-Setup-2.6.0.exe', size: v1.length, republished: null });
  const listed = (await admin('GET', 'releases')).body;
  assert.deepEqual([listed.current, listed.list.length, listed.files.map((f) => f.name)], [null, 0, ['Hammer-Launcher-Setup-2.6.0.exe']]);
  // An uploaded file is not reachable until it belongs to a published release.
  assert.equal((await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe')).status, 404);

  assert.match((await admin('POST', 'releases', { body: { version: '2.6', file: 'Hammer-Launcher-Setup-2.6.0.exe' } })).body.error, /Wersja ma postać/);
  assert.match((await admin('POST', 'releases', { body: { version: '2.6.0', file: 'nie-ma.exe' } })).body.error, /Nie ma takiego instalatora/);
  assert.match((await admin('POST', 'releases', { body: { version: '2.6.0', file: 'Hammer-Launcher-Setup-2.6.0.exe', minVersion: '3.0.0' } })).body.error, /nie może być nowsza/);
  const pub = await admin('POST', 'releases', { body: { version: '2.6.0', file: 'Hammer-Launcher-Setup-2.6.0.exe', notes: 'Pierwsza beta.\nAuto-aktualizacje.', discord: true } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  assert.deepEqual([pub.body.release.current, pub.body.release.signed, pub.body.release.size], [true, false, v1.length]);
  assert.match(channelText('launcher'), /Hammer Launcher 2\.6\.0[\s\S]*Pierwsza beta\./);

  const yml = (await call('GET', '/updates/latest.yml')).body;
  assert.equal(yml, `version: 2.6.0\nfiles:\n  - url: Hammer-Launcher-Setup-2.6.0.exe\n    sha512: ${sha512(v1)}\n    size: ${v1.length}\npath: Hammer-Launcher-Setup-2.6.0.exe\nsha512: ${sha512(v1)}\nreleaseDate: '${new Date(webStore.currentRelease().at).toISOString()}'\n`);
  const info = (await feed()).release;
  assert.deepEqual([info.version, info.notes, info.minVersion, info.size, info.url], ['2.6.0', 'Pierwsza beta.\nAuto-aktualizacje.', null, v1.length, `${base}/download`]);

  // The download button → the file, counted.
  const dl = await call('GET', '/download');
  assert.deepEqual([dl.status, dl.headers.get('location')], [302, '/updates/Hammer-Launcher-Setup-2.6.0.exe']);
  assert.equal(webStore.currentRelease().downloads, 1);
  const whole = await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe');
  assert.equal(whole.status, 200);
  assert.ok(whole.bytes.equals(v1));
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.match(whole.headers.get('content-disposition'), /attachment; filename="Hammer-Launcher-Setup-2\.6\.0\.exe"/);
  assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
  // Resumed and differential downloads.
  const part = await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe', { headers: { range: 'bytes=10-29' } });
  assert.deepEqual([part.status, part.headers.get('content-range'), part.bytes.length], [206, `bytes 10-29/${v1.length}`, 20]);
  assert.ok(part.bytes.equals(v1.subarray(10, 30)));
  const tail = await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe', { headers: { range: 'bytes=-7' } });
  assert.ok(tail.bytes.equals(v1.subarray(v1.length - 7)));
  const open = await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe', { headers: { range: `bytes=${v1.length - 3}-` } });
  assert.equal(open.bytes.length, 3);
  const beyond = await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe', { headers: { range: `bytes=${v1.length}-` } });
  assert.deepEqual([beyond.status, beyond.headers.get('content-range')], [416, `bytes */${v1.length}`]);
  const head = await call('HEAD', '/updates/Hammer-Launcher-Setup-2.6.0.exe');
  assert.deepEqual([head.status, head.headers.get('content-length'), head.bytes.length], [200, String(v1.length), 0]);
  for (const nope of ['/updates/web.json', '/updates/..%2Fweb.json', '/updates/..%2F..%2Fdata%2Fdb.json', '/updates/nie-ma.exe']) assert.equal((await call('GET', nope)).status, 404, nope);
});

test('a newer release with a signature and a required version; switching back; deleting removes the files', async () => {
  const v2 = installer('wersja druga ');
  const map = Buffer.from('blockmap-bytes');
  await admin('PUT', 'releases/file?name=Hammer-Launcher-Setup-2.6.1.exe', { raw: v2 });
  await admin('PUT', 'releases/file?name=Hammer-Launcher-Setup-2.6.1.exe.blockmap', { raw: map });
  const signature = crypto.randomBytes(64).toString('base64');
  assert.match((await admin('POST', 'releases', { body: { version: '2.6.1', file: 'Hammer-Launcher-Setup-2.6.1.exe', signature: 'krótki' } })).body.error, /Podpis/);
  // A file of another release cannot be published under a second version.
  assert.match((await admin('POST', 'releases', { body: { version: '2.7.0', file: 'Hammer-Launcher-Setup-2.6.0.exe' } })).body.error, /należy już do wersji 2\.6\.0/);
  const pub = await admin('POST', 'releases', { body: { version: '2.6.1', file: 'Hammer-Launcher-Setup-2.6.1.exe', blockmap: 'Hammer-Launcher-Setup-2.6.1.exe.blockmap', minVersion: '2.6.0', signature, notes: "Poprawki. It's better." } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  const yml = (await call('GET', '/updates/latest.yml')).body;
  assert.match(yml, /^version: 2\.6\.1\n/);
  assert.ok(yml.includes(`sha512: ${sha512(v2)}`));
  assert.ok(yml.endsWith(`signature: '${signature}'\n`));
  assert.equal((await feed()).release.minVersion, '2.6.0');
  // The older installer and the blockmaps stay reachable (differential updates read both).
  assert.equal((await call('GET', '/updates/Hammer-Launcher-Setup-2.6.0.exe')).status, 200);
  assert.ok((await call('GET', '/updates/Hammer-Launcher-Setup-2.6.1.exe.blockmap')).bytes.equals(map));

  // A rebuilt installer uploaded under the same name: the release follows the file, the old signature is dropped.
  const rebuilt = installer('wersja druga, poprawiona ');
  const again = await admin('PUT', 'releases/file?name=Hammer-Launcher-Setup-2.6.1.exe', { raw: rebuilt });
  assert.equal(again.body.republished, '2.6.1');
  const after = (await call('GET', '/updates/latest.yml')).body;
  assert.ok(after.includes(`sha512: ${sha512(rebuilt)}`) && !after.includes('signature:'));

  // Back to 2.6.0, then 2.6.1 is deleted with its files.
  assert.equal((await admin('POST', 'releases/current', { body: { version: '9.9.9' } })).status, 404);
  assert.equal((await admin('POST', 'releases/current', { body: { version: '2.6.0' } })).body.current, '2.6.0');
  assert.match((await call('GET', '/updates/latest.yml')).body, /^version: 2\.6\.0\n/);
  assert.equal((await admin('DELETE', 'releases/2.6.1', { who: 'admin' })).status, 403);
  assert.equal((await admin('DELETE', 'releases/2.6.1')).status, 200);
  assert.equal(fs.existsSync(path.join(releases.DIR(), 'Hammer-Launcher-Setup-2.6.1.exe')), false);
  assert.equal(fs.existsSync(path.join(releases.DIR(), 'Hammer-Launcher-Setup-2.6.1.exe.blockmap')), false);
  assert.equal((await call('GET', '/updates/Hammer-Launcher-Setup-2.6.1.exe')).status, 404);
  // No current release → the download is hidden, the feed is empty.
  await admin('POST', 'releases/current', { body: { version: null } });
  assert.equal((await call('GET', '/updates/latest.yml')).status, 404);
  assert.equal((await feed()).release, null);
  await admin('POST', 'releases/current', { body: { version: '2.6.0' } });
});

test('version numbers compare as numbers', () => {
  const c = releases.compareVersions;
  assert.deepEqual([c('2.10.0', '2.9.3'), c('2.6.0', '2.6.0'), c('1.0.0', '2.0.0'), c('2.6.0-beta.1', '2.6.0'), c('2.6.0', '2.6.0-beta.1'), c('2.6.0-beta.1', '2.6.0-beta.2')], [1, 0, -1, -1, 1, -1]);
  assert.deepEqual([releases.parseRange('bytes=0-0', 10), releases.parseRange('bytes=5-99', 10), releases.parseRange('bytes=-0', 10), releases.parseRange('bytes=0-1,4-5', 10), releases.parseRange(undefined, 10)], [{ start: 0, end: 0 }, { start: 5, end: 9 }, false, null, null]);
});

test('Hammer+ in the panel: codes for a nick, checking a code, the price list is the owner\'s', async () => {
  const none = await admin('GET', 'plus', { who: 'admin' });
  assert.deepEqual([none.body.ready, none.body.plans, none.body.canEdit], [true, [], false]);
  assert.equal(none.body.publicKey, plus.publicKey());
  const granted = await admin('POST', 'plus/grant', { who: 'admin', body: { nick: 'notch', days: 30 } });
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  assert.equal(granted.body.record.nick, 'Notch');
  assert.equal(plus.verify(granted.body.code).mc, MC.Notch);
  const unknown = await admin('POST', 'plus/grant', { body: { nick: 'NikogoTakiego', days: 30 } });
  assert.equal(unknown.status, 400);
  assert.match(unknown.body.error, /Nie ma konta Minecraft o nicku NikogoTakiego/); // Discord's ** is gone
  const check = await admin('POST', 'plus/check', { body: { code: granted.body.code } });
  assert.deepEqual([check.body.valid, check.body.nick, check.body.mc], [true, 'Notch', MC.Notch]);
  assert.equal((await admin('POST', 'plus/check', { body: { code: 'HP1.abc.def' } })).body.valid, false);

  const plans = [{ name: 'Hammer+ na 30 dni', days: 30, price: 1500 }, { name: 'Hammer+ na zawsze', days: 0, price: 9900 }];
  assert.equal((await admin('PUT', 'plus/plans', { who: 'admin', body: { plans } })).status, 403);
  assert.match((await admin('PUT', 'plus/plans', { body: { plans: [{ name: 'Za tanio', days: 30, price: 10 }] } })).body.error, /co najmniej 0,50/);
  const saved = await admin('PUT', 'plus/plans', { body: { plans } });
  assert.deepEqual(saved.body.plans, [{ id: 'p30', name: 'Hammer+ na 30 dni', days: 30, price: 1500 }, { id: 'px', name: 'Hammer+ na zawsze', days: 0, price: 9900 }]);
  const shown = (await call('GET', '/api/shop/plus')).body;
  assert.deepEqual([shown.ready, shown.plans.length, shown.currency], [true, 2, 'eur']);
});

async function buyPlus(plan, nick, who = 'buyer') {
  const res = await call('POST', '/api/shop/checkout', { who, body: { kind: 'plus', plan, nick, requestId: crypto.randomUUID() } });
  if (res.status !== 200) return res;
  const sessionId = res.body.url.split('/').pop();
  fakes.pay(sessionId);
  const verified = await call('POST', '/api/shop/verify', { who, body: { sessionId } });
  return { ...verified, orderId: res.body.order };
}
const myOrder = async (id, who = 'buyer') => (await call('GET', '/api/shop/orders', { who })).body.orders.find((o) => o.id === id);

test('Hammer+ bought by card: the nick is checked first, the code comes right after the payment – on the page and by DM', async () => {
  assert.equal((await call('POST', '/api/shop/checkout', { body: { kind: 'plus', plan: 'p30', nick: 'Steve' } })).status, 401);
  const wrongNick = await buyPlus('p30', 'NikogoTakiego');
  assert.equal(wrongNick.status, 400);
  assert.match(wrongNick.body.error, /Nie ma konta Minecraft/);
  assert.match((await buyPlus('nie-ma', 'Steve')).body.error, /Nie ma już takiego planu/);
  assert.equal(fakes.state.created, 0, 'nobody was sent to Stripe for a wrong nick or plan');

  const paid = await buyPlus('p30', 'steve');
  assert.deepEqual([paid.status, paid.body.paid], [200, true]);
  const sent = fakes.state.lastCheckout;
  assert.equal(sent.get('line_items[0][price_data][unit_amount]'), '1500');
  assert.equal(sent.get('line_items[0][price_data][product_data][name]'), 'Hammer+ na 30 dni – Steve');
  assert.equal(sent.get('success_url'), `${base}/launcher?payment=return&session_id={CHECKOUT_SESSION_ID}`);
  assert.equal(sent.get('metadata[kind]'), 'plus');

  const order = await myOrder(paid.orderId);
  assert.deepEqual([order.kind, order.status, order.delivered, order.plus.nick, order.plus.days], ['plus', 'paid', true, 'Steve', 30]);
  const payload = plus.verify(order.plus.code);
  assert.equal(payload.mc, MC.Steve);
  assert.equal(order.plus.until, payload.exp * 1000);
  assert.ok(Math.abs(payload.exp * 1000 - (Date.now() + 30 * 86_400_000)) < 60_000);
  assert.equal((await myOrder(paid.orderId)).plus.until, order.plus.until, 'asked again: the same end date');
  assert.doesNotMatch(JSON.stringify(webStore._state()), /HP1\./, 'the code itself is never stored');
  // Somebody else's orders do not show it.
  assert.equal(await myOrder(paid.orderId, 'member'), undefined);

  const dm = guild.dms.filter((d) => d.to === BUYER.id).map((d) => textOf(d.payload)).join('\n');
  assert.match(dm, /Hammer\+ kupiony/);
  assert.match(dm, /HP1\.[\w-]+\.[\w-]+/);
  assert.equal(plus.verify(/HP1\.[\w-]+\.[\w-]+/.exec(dm)[0]).mc, MC.Steve);
  const grants = (await admin('GET', 'plus')).body.grants;
  assert.deepEqual([grants[0].nick, grants[0].source, grants[0].by], ['Steve', 'website', BUYER.id]);

  // Bought again while it is still running: the new month is added after the first one.
  const more = await buyPlus('p30', 'Steve');
  const second = plus.verify((await myOrder(more.orderId)).plus.code);
  assert.ok(second.exp >= payload.exp + 30 * 86_400 && second.exp <= payload.exp + 31 * 86_400, 'about 60 days from now');
  // Forever stays forever.
  const forever = await buyPlus('px', 'Steve');
  assert.equal(plus.verify((await myOrder(forever.orderId)).plus.code).exp, 0);
  assert.equal((await myOrder(forever.orderId)).plus.until, 0);
  assert.equal((await admin('GET', 'overview')).body.plus.active, 2); // Notch (from the panel) and Steve

  const rows = (await admin('GET', 'orders')).body.orders;
  assert.deepEqual([rows[0].kind, rows[0].plusNick, rows[0].user.name, rows[0].status], ['plus', 'Steve', 'Kupiec', 'paid']);
});

test('without a price list or a signing key Hammer+ is not on sale', async () => {
  env.plusPrivateKey = '';
  assert.deepEqual([(await call('GET', '/api/shop/plus')).body.ready, (await call('GET', '/api/shop/plus')).body.plans], [false, []]);
  assert.equal((await buyPlus('p30', 'Steve')).status, 503);
  env.plusPrivateKey = KEY;
  await admin('PUT', 'plus/plans', { body: { plans: [] } });
  assert.equal((await call('GET', '/api/shop/plus')).body.ready, false);
  assert.equal((await buyPlus('p30', 'Steve')).status, 503);
});

test('featured servers from the panel reach the launcher', async () => {
  const added = await admin('POST', 'featured', { who: 'admin', body: { name: 'Hammer SMP', address: 'MC.HammerShop.pl', description: 'Survival bez resetów.', tags: 'survival, pvp', mc: '1.21.4', loader: 'fabric' } });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.deepEqual([added.body.server.id, added.body.server.address], ['hammer-smp', 'mc.hammershop.pl']);
  assert.match((await admin('POST', 'featured', { body: { name: 'Zły', address: 'https://x', description: 'x' } })).body.error, /host/);
  assert.equal((await call('GET', '/api/launcher/featured')).body.servers[0].name, 'Hammer SMP');
  assert.equal((await admin('GET', 'featured')).body.servers.length, 1);
  assert.equal((await admin('DELETE', 'featured/hammer-smp')).status, 200);
  assert.equal((await admin('DELETE', 'featured/hammer-smp')).status, 404);
});

test('Discord knows the launcher too: the #launcher channel\'s card and /launcher with the current version', async () => {
  const { createInteraction, lastResponse } = require('./helpers/fakeInteraction');
  const handle = require('../src/handlers/interactions');
  const commands = require('../src/commands')();
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'launcher'));
  assert.match(channel.topic, /Hammer Launcher/);
  // /build posted the banner and the card first – the news and versions from the panel came under them.
  const card = textOf(channel.messageList[1].body);
  assert.match(card, /Hammer Launcher[\s\S]*wersja beta[\s\S]*FPS boost jednym kliknięciem[\s\S]*Hammer\+/);
  assert.doesNotMatch(card, /Aktualna wersja/, 'the channel card does not go stale with every version');
  assert.match(channelText('information'), /Hammer Launcher: pobieranie i nowe wersje/);

  const i = createInteraction({ guild, member: guild.members.cache.get(MEMBER.id), kind: 'command', commandName: 'launcher' });
  await handle(i, commands);
  const reply = lastResponse(i);
  assert.match(textOf(reply), /Aktualna wersja: 2\.6\.0[\s\S]*Pierwsza beta\./);
  const urls = JSON.stringify(reply.components.map((c) => (c.toJSON ? c.toJSON() : c)));
  assert.ok(urls.includes(`${base}/launcher`) && urls.includes(`${base}/launcher#plus`), 'the buttons lead to the website');
});

test('the launcher page and the panel are their own pages; sign-in brings people back to them', async () => {
  for (const page of ['/launcher', '/admin', '/launcher/']) {
    const res = await call('GET', page);
    assert.equal(res.status, 200, page);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.match(res.body, /<html lang="pl">/);
  }
  assert.equal((await call('GET', '/admin')).headers.get('x-robots-tag'), 'noindex');
  await signIn(MEMBER, 'launcher');
  assert.equal(signIn.landed, '/launcher?connected=1');
  await signIn(MEMBER, 'admin');
  assert.equal(signIn.landed, '/admin?connected=1');
  await signIn(MEMBER, 'https://evil.example');
  assert.equal(signIn.landed, '/?connected=1');
});
