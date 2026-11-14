'use strict';

// The launcher's API is called over real HTTP (a local server) – keep the real fetch the test setup replaces.
const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { env } = require('../src/env');
const plus = require('../src/lib/plus');
const featured = require('../src/features/featured');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const launcher = require('../src/web/launcher');
const { createWebServer } = require('../src/web/server');

const DAY = 86_400_000;
const newKey = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const KEY = newKey();
const account = () => crypto.randomBytes(16).toString('hex'); // a Minecraft UUID nobody has used yet
const dashed = (mc) => `${mc.slice(0, 8)}-${mc.slice(8, 12)}-${mc.slice(12, 16)}-${mc.slice(16, 20)}-${mc.slice(20)}`;

let guild;
let site;
let base;
let ip = 0;
let from; // every test calls from its own address, so the per-IP limits of one never reach another

test.before(async () => {
  guild = new FakeGuild();
  website._setClient(guild.client);
  webStore.load();
  site = createWebServer({ featured: website.featuredServers });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref(); // the run ends when the tests are done, also where this hook's "after" only runs at exit (Node 18)
  base = `http://127.0.0.1:${site.address().port}`;
});
test.after(() => site?.close());
/** Every test starts from the same state – called first in each one (no hooks, so it reads top to bottom). */
function reset() {
  env.plusPrivateKey = KEY;
  from = `10.20.30.${++ip}`;
}

/** → { status, body (parsed JSON or text), headers } */
async function call(method, path, { code, body, headers = {}, raw } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: { 'x-forwarded-for': from, ...(code && { authorization: `Bearer ${code}` }), ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
    ...(body !== undefined && { body: raw ? body : JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // not JSON (the /join page, an empty answer)
  }
  return { status: res.status, body: parsed, headers: res.headers };
}
const isError = (res, status, pattern) => {
  assert.equal(res.status, status, JSON.stringify(res.body));
  assert.deepEqual(Object.keys(res.body), ['error'], 'errors are { error }');
  assert.match(res.body.error, pattern);
};

test('health says whether Hammer+ is configured; answers carry the website\'s security headers and work from the launcher\'s window', async () => {
  reset();
  const on = await call('GET', '/api/launcher/health');
  assert.equal(on.status, 200);
  assert.deepEqual(on.body, { ok: true, plus: true });
  assert.equal(on.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(on.headers.get('x-frame-options'), 'DENY');
  assert.equal(on.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(on.headers.get('cache-control'), 'no-store');
  assert.match(on.headers.get('content-type'), /^application\/json/);
  assert.equal(on.headers.get('access-control-allow-origin'), '*');

  env.plusPrivateKey = '';
  assert.deepEqual((await call('GET', '/api/launcher/health')).body, { ok: true, plus: false });
  env.plusPrivateKey = 'not a key';
  assert.deepEqual((await call('GET', '/api/launcher/health')).body, { ok: true, plus: false });

  // A browser-like window asks first whether it may send the Authorization header.
  const preflight = await call('OPTIONS', '/api/launcher/cloud', { headers: { origin: 'app://hammer-launcher', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization, content-type' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods'), /PUT/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/);

  // Unknown paths and wrong methods are errors in the same shape – never the store page.
  isError(await call('GET', '/api/launcher/nope'), 404, /Nie znaleziono/);
  isError(await call('GET', '/api/launcher/constructor'), 404, /Nie znaleziono/);
  isError(await call('POST', '/api/launcher/cloud', { body: {} }), 405, /Niedozwolona metoda/);
  isError(await call('GET', '/api/launcher/cape'), 405, /Niedozwolona metoda/);
  isError(await call('PUT', '/api/launcher/featured', { body: {} }), 405, /Niedozwolona metoda/);
  assert.equal((await call('GET', '/api/launcher/health')).headers.get('access-control-allow-origin'), '*');
});

test('featured: the servers from /polecane, public and cacheable for 5 minutes', async () => {
  reset();
  const empty = await call('GET', '/api/launcher/featured');
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body, { servers: [] });
  assert.equal(empty.headers.get('cache-control'), 'public, max-age=300');

  featured.add(guild.id, { name: 'Hammer SMP', address: 'mc.hammershop.pl', description: 'Survival z ekonomią.', tags: 'survival, pvp', icon: 'https://cdn.hammershop.pl/smp.png', mc: '1.21.4', loader: 'fabric', pack: 'hammer-smp', addedBy: '1' });
  featured.add(guild.id, { name: 'Lobby', address: '123.45.67.89:25570', description: 'Minigry.' });
  const { body } = await call('GET', '/api/launcher/featured');
  assert.deepEqual(body, {
    servers: [
      { id: 'hammer-smp', name: 'Hammer SMP', address: 'mc.hammershop.pl', description: 'Survival z ekonomią.', tags: ['survival', 'pvp'], icon: 'https://cdn.hammershop.pl/smp.png', mc: '1.21.4', loader: 'fabric', pack: 'hammer-smp' },
      { id: 'lobby', name: 'Lobby', address: '123.45.67.89:25570', description: 'Minigry.', tags: [], icon: null, mc: null, loader: null, pack: null },
    ],
  });
  featured.remove(guild.id, 'lobby');
  assert.deepEqual((await call('GET', '/api/launcher/featured')).body.servers.map((s) => s.id), ['hammer-smp']);

  // No Hammer+ needed, and it works before the key is set.
  env.plusPrivateKey = '';
  assert.equal((await call('GET', '/api/launcher/featured')).status, 200);
});

test('Bearer: no code, a broken, changed, foreign or expired code → 401; no key on the server → 503', async () => {
  reset();
  const mc = account();
  const good = plus.issue({ mc, days: 30 });
  const [head, payload, signature] = good.split('.');
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), mc: account() })).toString('base64url');
  env.plusPrivateKey = newKey();
  const foreign = plus.issue({ mc, days: 30 });
  env.plusPrivateKey = KEY;
  const expired = plus.issue({ mc, days: 1, now: Date.now() - 2 * DAY });

  const endpoints = [['GET', '/api/launcher/cloud', undefined], ['PUT', '/api/launcher/cloud', { data: { a: 1 } }], ['PUT', '/api/launcher/cape', { cape: 'gold' }]];
  for (const [method, path, body] of endpoints) {
    const where = `${method} ${path}`;
    const none = await call(method, path, { body });
    isError(none, 401, /Brak kodu Hammer\+/);
    assert.equal(none.headers.get('www-authenticate'), 'Bearer', where);
    isError(await call(method, path, { body, headers: { authorization: `Basic ${Buffer.from('a:b').toString('base64')}` } }), 401, /Brak kodu Hammer\+/);
    isError(await call(method, path, { body, headers: { authorization: 'Bearer' } }), 401, /Brak kodu Hammer\+/);
    isError(await call(method, path, { body, code: 'niby-kod' }), 401, /To nie jest kod Hammer\+/);
    isError(await call(method, path, { body, code: `${head}.${edited}.${signature}` }), 401, /podpis się nie zgadza/);
    isError(await call(method, path, { body, code: foreign }), 401, /podpis się nie zgadza/);
    isError(await call(method, path, { body, code: expired }), 401, /już wygasł/);
  }
  assert.equal(webStore.cloudOf(mc), null, 'nothing was stored');
  assert.equal(webStore.capeOf(mc), null);

  env.plusPrivateKey = '';
  for (const [method, path, body] of endpoints) isError(await call(method, path, { body, code: good }), 503, /Hammer\+ nie jest jeszcze uruchomiony/);
  env.plusPrivateKey = KEY;
  assert.equal((await call('GET', '/api/launcher/cloud', { code: good })).status, 404, 'the good code works again with the key');
});

test('cloud: one copy per Minecraft account – stored, read back, and a stale write gets the stored copy with 409', async () => {
  reset();
  const mc = account();
  const code = plus.issue({ mc, days: 30 });
  isError(await call('GET', '/api/launcher/cloud', { code }), 404, /Nie masz jeszcze nic zapisanego w chmurze/);

  const before = Date.now();
  const first = await call('PUT', '/api/launcher/cloud', { code, body: { data: { instances: [{ name: 'SMP', mc: '1.21.4' }], settings: { ram: 4096, 'ąę': '✓' } } } });
  assert.equal(first.status, 200);
  assert.deepEqual(Object.keys(first.body), ['updatedAt']);
  assert.ok(first.body.updatedAt >= before && first.body.updatedAt <= Date.now(), 'updatedAt is the server\'s time in ms');
  const read = await call('GET', '/api/launcher/cloud', { code });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body, { updatedAt: first.body.updatedAt, data: { instances: [{ name: 'SMP', mc: '1.21.4' }], settings: { ram: 4096, 'ąę': '✓' } } });
  assert.equal(read.headers.get('cache-control'), 'no-store');

  // Based on the stored version → accepted, and the version moves forward (also within the same millisecond).
  const second = await call('PUT', '/api/launcher/cloud', { code, body: { data: { v: 2 }, baseUpdatedAt: first.body.updatedAt } });
  assert.equal(second.status, 200);
  assert.ok(second.body.updatedAt > first.body.updatedAt);

  // Another computer still has the first version → 409 with the stored copy, nothing overwritten.
  const stale = await call('PUT', '/api/launcher/cloud', { code, body: { data: { v: 'old computer' }, baseUpdatedAt: first.body.updatedAt } });
  assert.equal(stale.status, 409);
  assert.deepEqual(Object.keys(stale.body).sort(), ['data', 'error', 'updatedAt']);
  assert.match(stale.body.error, /nowsza wersja/);
  assert.equal(stale.body.updatedAt, second.body.updatedAt);
  assert.deepEqual(stale.body.data, { v: 2 });
  assert.deepEqual((await call('GET', '/api/launcher/cloud', { code })).body, { updatedAt: second.body.updatedAt, data: { v: 2 } });

  // Without baseUpdatedAt the launcher overwrites on purpose; a base from the future is fine too.
  const forced = await call('PUT', '/api/launcher/cloud', { code, body: { data: { v: 3 } } });
  assert.equal(forced.status, 200);
  assert.equal((await call('PUT', '/api/launcher/cloud', { code, body: { data: { v: 4 }, baseUpdatedAt: forced.body.updatedAt + 60_000 } })).status, 200);

  // The account is the Minecraft UUID in the code: another code for it sees the same data, another account sees nothing.
  const renewed = plus.issue({ mc, days: 0 });
  assert.deepEqual((await call('GET', '/api/launcher/cloud', { code: renewed })).body.data, { v: 4 });
  const stranger = plus.issue({ mc: account(), days: 30 });
  assert.equal((await call('GET', '/api/launcher/cloud', { code: stranger })).status, 404);
  // A first save with a base (a fresh account that thinks it has a version) is simply stored.
  assert.equal((await call('PUT', '/api/launcher/cloud', { code: stranger, body: { data: {}, baseUpdatedAt: 5 } })).status, 200);

  // Bodies that aren't { data: {…} }.
  isError(await call('PUT', '/api/launcher/cloud', { code, body: '{"data":', raw: true }), 400, /Nieprawidłowy JSON/);
  isError(await call('PUT', '/api/launcher/cloud', { code, body: '', raw: true }), 400, /Nieprawidłowy JSON/);
  isError(await call('PUT', '/api/launcher/cloud', { code, body: [1, 2] }), 400, /obiekt JSON/);
  for (const data of [undefined, null, 'tekst', 5, [1]]) isError(await call('PUT', '/api/launcher/cloud', { code, body: { data } }), 400, /Brakuje pola „data”/);
  for (const baseUpdatedAt of ['wczoraj', -1, {}, true]) isError(await call('PUT', '/api/launcher/cloud', { code, body: { data: {}, baseUpdatedAt } }), 400, /baseUpdatedAt/);
  const nested = `{"data":${'{"a":'.repeat(200)}1${'}'.repeat(200)}}`;
  isError(await call('PUT', '/api/launcher/cloud', { code, body: nested, raw: true }), 400, /zbyt głęboko zagnieżdżone/);
  assert.deepEqual((await call('GET', '/api/launcher/cloud', { code })).body.data, { v: 4 }, 'refused writes change nothing');
  // The launcher isn't a browser form: JSON without the JSON content type is still JSON.
  assert.equal((await call('PUT', '/api/launcher/cloud', { code, body: '{"data":{"v":5}}', raw: true, headers: { 'content-type': 'text/plain' } })).status, 200);
});

test('cloud: at most 256 KB per save – more is refused with 413 and the stored copy stays', async () => {
  reset();
  const mc = account();
  const code = plus.issue({ mc, days: 30 });
  const body = (bytes) => {
    const shell = JSON.stringify({ data: { blob: '' } });
    return JSON.stringify({ data: { blob: 'x'.repeat(bytes - shell.length) } });
  };
  const fits = body(launcher.CLOUD_LIMIT);
  assert.equal(Buffer.byteLength(fits), 256 * 1024);
  assert.equal((await call('PUT', '/api/launcher/cloud', { code, body: fits, raw: true })).status, 200, 'exactly 256 KB fits');
  const stored = (await call('GET', '/api/launcher/cloud', { code })).body;
  assert.equal(stored.data.blob.length, fits.length - JSON.stringify({ data: { blob: '' } }).length);

  isError(await call('PUT', '/api/launcher/cloud', { code, body: body(launcher.CLOUD_LIMIT + 1), raw: true }), 413, /najwyżej 256 KB/);
  isError(await call('PUT', '/api/launcher/cloud', { code, body: body(1024 * 1024), raw: true }), 413, /najwyżej 256 KB/);
  assert.equal((await call('GET', '/api/launcher/cloud', { code })).body.updatedAt, stored.updatedAt, 'the stored copy is untouched');

  // Sent in pieces without saying how much is coming: counted as it arrives.
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/launcher/cloud`, { method: 'PUT', headers: { authorization: `Bearer ${code}`, 'content-type': 'application/json', 'x-forwarded-for': from } }, (res) => {
      let text = '';
      res.on('data', (c) => (text += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
    });
    req.on('error', reject);
    req.write('{"data":{"blob":"');
    for (let k = 0; k < 10; k += 1) req.write('y'.repeat(40 * 1024));
    req.end('"}}');
  });
  assert.equal(chunked.status, 413);
  assert.match(chunked.body.error, /najwyżej 256 KB/);

  // A cape choice is a few bytes – its body is capped far lower.
  isError(await call('PUT', '/api/launcher/cape', { code, body: { cape: 'gold', padding: 'x'.repeat(8 * 1024) } }), 413, /najwyżej 4 KB/);
  // Without a working code nothing is read at all.
  isError(await call('PUT', '/api/launcher/cloud', { body: body(1024 * 1024), raw: true }), 401, /Brak kodu Hammer\+/);
});

test('capes: an account picks one of the six, everyone can look it up, null takes it off', async () => {
  reset();
  const mc = account();
  const other = account();
  const code = plus.issue({ mc, days: 30 });
  assert.deepEqual(launcher.CAPES, ['hammer', 'gold', 'ember', 'royal', 'frost', 'crimson']);

  for (const cape of launcher.CAPES) {
    const set = await call('PUT', '/api/launcher/cape', { code, body: { cape } });
    assert.equal(set.status, 200);
    assert.deepEqual(set.body, { cape });
    assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body, { capes: { [mc]: cape } });
  }

  // Not a cape → 400, and the choice stays.
  for (const cape of ['diamond', 'GOLD', '', 5, ['gold'], { id: 'gold' }, true]) isError(await call('PUT', '/api/launcher/cape', { code, body: { cape } }), 400, /Nieznana peleryna\. Do wyboru: hammer, gold, ember, royal, frost, crimson/);
  isError(await call('PUT', '/api/launcher/cape', { code, body: {} }), 400, /Nieznana peleryna/);
  isError(await call('PUT', '/api/launcher/cape', { code, body: 'gold', raw: true }), 400, /Nieprawidłowy JSON/);
  assert.equal(webStore.capeOf(mc), 'crimson');

  // The lookup is public (no code), takes many accounts, and answers under the spelling that was asked for.
  await call('PUT', '/api/launcher/cape', { code: plus.issue({ mc: other, days: 0 }), body: { cape: 'frost' } });
  const nobody = account();
  const many = await call('GET', `/api/launcher/capes?uuids=${mc},${nobody},${other}`);
  assert.equal(many.status, 200);
  assert.deepEqual(many.body, { capes: { [mc]: 'crimson', [other]: 'frost' } });
  assert.equal(many.headers.get('access-control-allow-origin'), '*');
  assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${dashed(mc).toUpperCase()}, ${other} ,,nie-uuid,__proto__`)).body, { capes: { [dashed(mc).toUpperCase()]: 'crimson', [other]: 'frost' } });
  assert.deepEqual((await call('GET', '/api/launcher/capes')).body, { capes: {} });
  assert.deepEqual((await call('GET', '/api/launcher/capes?uuids=')).body, { capes: {} });

  // At most 100 accounts per question.
  const hundred = [mc, ...Array.from({ length: 99 }, account)];
  assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${hundred.join(',')}`)).body, { capes: { [mc]: 'crimson' } });
  isError(await call('GET', `/api/launcher/capes?uuids=${[...hundred, account()].join(',')}`), 400, /Najwyżej 100 kont/);

  const off = await call('PUT', '/api/launcher/cape', { code, body: { cape: null } });
  assert.deepEqual(off.body, { cape: null });
  assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc},${other}`)).body, { capes: { [other]: 'frost' } });
});

test('capes are shown only while the account\'s Hammer+ runs – and come back when it is renewed', async () => {
  reset();
  const mc = account();
  const forever = account();
  const month = plus.issue({ mc, days: 30 });
  await call('PUT', '/api/launcher/cape', { code: month, body: { cape: 'royal' } });
  await call('PUT', '/api/launcher/cape', { code: plus.issue({ mc: forever, days: 0 }), body: { cape: 'ember' } });
  const lookup = async () => (await call('GET', `/api/launcher/capes?uuids=${mc},${forever}`)).body.capes;
  assert.deepEqual(await lookup(), { [mc]: 'royal', [forever]: 'ember' });

  const clock = Date.now;
  try {
    // 29 days later: still running. 31 days later: Hammer+ has run out – the cape is no longer shown, the code no longer works.
    Date.now = () => clock() + 29 * DAY;
    assert.deepEqual(await lookup(), { [mc]: 'royal', [forever]: 'ember' });
    Date.now = () => clock() + 31 * DAY;
    assert.deepEqual(await lookup(), { [forever]: 'ember' }, 'a code that never expires keeps its cape');
    isError(await call('PUT', '/api/launcher/cape', { code: month, body: { cape: 'gold' } }), 401, /już wygasł/);
    assert.deepEqual(await lookup(), { [forever]: 'ember' });

    // The customer renews: the launcher signs in with the new code (any call) and the old choice is back.
    const renewed = plus.issue({ mc, days: 30 });
    assert.equal((await call('GET', '/api/launcher/cloud', { code: renewed })).status, 404);
    assert.deepEqual(await lookup(), { [mc]: 'royal', [forever]: 'ember' });

    // A shorter code used later never cuts the longer one short.
    const week = plus.issue({ mc, days: 7 });
    assert.deepEqual((await call('PUT', '/api/launcher/cape', { code: week, body: { cape: 'gold' } })).body, { cape: 'gold' });
    Date.now = () => clock() + 31 * DAY + 20 * DAY;
    assert.deepEqual(await lookup(), { [mc]: 'gold', [forever]: 'ember' }, 'still covered by the 30-day code');
    Date.now = () => clock() + 31 * DAY + 31 * DAY;
    assert.deepEqual(await lookup(), { [forever]: 'ember' });
  } finally {
    Date.now = clock;
  }
});

test('the two free capes need no Hammer+: the account proves itself with its Minecraft sign-in, checked at Mojang', async () => {
  reset();
  const mc = account();
  const asked = [];
  launcher.setProfileFetch(async (url, init) => {
    asked.push({ url, auth: init.headers.authorization });
    if (init.headers.authorization === 'Bearer zly-token') return new Response('{}', { status: 401 });
    return new Response(JSON.stringify({ id: mc, name: 'Darmowy' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  try {
    const put = (cape, token = 'dobry-token') => call('PUT', '/api/launcher/cape', { body: { cape }, headers: { 'x-minecraft-token': token } });
    assert.deepEqual((await put('ember')).body, { cape: 'ember' });
    assert.deepEqual([asked[0].url, asked[0].auth], ['https://api.minecraftservices.com/minecraft/profile', 'Bearer dobry-token']);
    assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body.capes, { [mc]: 'ember' });
    // A free cape stays visible – there is no Hammer+ to run out.
    const clock = Date.now;
    try {
      Date.now = () => clock() + 400 * DAY;
      assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body.capes, { [mc]: 'ember' });
    } finally {
      Date.now = clock;
    }
    // The other capes are Hammer+; a token Mojang does not take is refused; the same token is not asked about twice.
    isError(await put('royal'), 403, /częścią Hammer\+/);
    isError(await put('smok'), 400, /Nieznana peleryna/);
    isError(await put('hammer', 'zly-token'), 401, /Mojang nie przyjął/);
    const before = asked.length;
    assert.deepEqual((await put('hammer')).body, { cape: 'hammer' });
    assert.equal(asked.length, before, 'remembered for a while');
    assert.deepEqual((await put(null)).body, { cape: null });
    assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body.capes, {});
    // With Hammer+ a free cape picked earlier does not stretch a Hammer+ cape past the code.
    const month = plus.issue({ mc, days: 30 });
    await put('ember');
    await call('PUT', '/api/launcher/cape', { code: month, body: { cape: 'gold' } });
    Date.now = () => clock() + 31 * DAY;
    try {
      assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body.capes, {}, 'the Hammer+ cape ends with the code');
    } finally {
      Date.now = clock;
    }
  } finally {
    launcher.setProfileFetch(null);
  }
});

test('moving capes and cosmetics (Hammer+): others see them next to the cape – older Hammer Clients still get a still cape', async () => {
  reset();
  const mc = account();
  const plain = account();
  const code = plus.issue({ mc, days: 30 });
  assert.deepEqual(launcher.MOVING_CAPES, { flame: 'ember', sparks: 'royal', waves: 'frost' });
  assert.deepEqual(launcher.COSMETICS, { wings: ['angel', 'dragon'], hat: ['crown', 'tophat', 'santa'] });
  const lookup = async (...who) => (await call('GET', `/api/launcher/capes?uuids=${who.join(',')}`)).body;

  // A moving cape and all three cosmetics at once.
  const set = await call('PUT', '/api/launcher/cape', { code, body: { cape: 'flame', cosmetics: { wings: 'angel', halo: true, hat: 'crown' } } });
  assert.equal(set.status, 200);
  assert.deepEqual(set.body, { cape: 'flame', cosmetics: { wings: 'angel', halo: true, hat: 'crown' } });
  await call('PUT', '/api/launcher/cape', { code: plus.issue({ mc: plain, days: 0 }), body: { cape: 'gold' } });
  assert.deepEqual(await lookup(mc, plain), { capes: { [mc]: 'ember', [plain]: 'gold' }, looks: { [mc]: { cape: 'flame', wings: 'angel', halo: true, hat: 'crown' } } }, 'older clients read capes: the still look-alike');
  assert.deepEqual(await lookup(plain), { capes: { [plain]: 'gold' } }, 'no looks when nobody in the answer needs them');
  for (const cape of Object.keys(launcher.MOVING_CAPES)) {
    assert.deepEqual((await call('PUT', '/api/launcher/cape', { code, body: { cape } })).body, { cape }, 'a launcher that sends no cosmetics changes none');
    assert.deepEqual(await lookup(mc), { capes: { [mc]: launcher.MOVING_CAPES[cape] }, looks: { [mc]: { cape, wings: 'angel', halo: true, hat: 'crown' } } });
  }

  // Only what the slots may hold – anything else is a 400 and nothing changes (not even the cape).
  for (const cosmetics of [{ wings: 'bat' }, { hat: 'angel' }, { wings: ['angel'] }, { halo: 'yes' }, { halo: 1 }, 'angel', [1], 5, true]) {
    isError(await call('PUT', '/api/launcher/cape', { code, body: { cape: 'gold', cosmetics } }), 400, /dodat|Pole „halo”|cosmetics/i);
  }
  isError(await call('PUT', '/api/launcher/cape', { code, body: { cape: 'smok', cosmetics: { wings: 'angel' } } }), 400, /Nieznana peleryna\. Do wyboru: hammer, gold, ember, royal, frost, crimson, flame, sparks, waves/);
  assert.equal(webStore.capeOf(mc), 'waves');
  // Part of them, then none: an empty slot is null (or left out), halo false.
  assert.deepEqual((await call('PUT', '/api/launcher/cape', { code, body: { cape: null, cosmetics: { wings: null, hat: 'santa' } } })).body, { cape: null, cosmetics: { wings: null, halo: false, hat: 'santa' } });
  assert.deepEqual(await lookup(mc), { capes: {}, looks: { [mc]: { hat: 'santa' } } }, 'cosmetics without a cape');
  assert.deepEqual((await call('PUT', '/api/launcher/cape', { code, body: { cape: 'hammer', cosmetics: null } })).body, { cape: 'hammer', cosmetics: { wings: null, halo: false, hat: null } });
  assert.deepEqual(await lookup(mc), { capes: { [mc]: 'hammer' } });

  // Like a Hammer+ cape they end with the code – and come back with a renewed one.
  await call('PUT', '/api/launcher/cape', { code, body: { cape: 'sparks', cosmetics: { wings: 'dragon', halo: false, hat: 'tophat' } } });
  const clock = Date.now;
  try {
    Date.now = () => clock() + 31 * DAY;
    assert.deepEqual(await lookup(mc, plain), { capes: { [plain]: 'gold' } });
    const renewed = plus.issue({ mc, days: 30 });
    assert.equal((await call('GET', '/api/launcher/cloud', { code: renewed })).status, 404);
    assert.deepEqual(await lookup(mc), { capes: { [mc]: 'royal' }, looks: { [mc]: { cape: 'sparks', wings: 'dragon', hat: 'tophat' } } });
  } finally {
    Date.now = clock;
  }
});

test('without Hammer+ (the Minecraft sign-in) moving capes and cosmetics are refused – taking cosmetics off works', async () => {
  reset();
  const mc = account();
  launcher.setProfileFetch(async () => new Response(JSON.stringify({ id: mc, name: 'Darmowy' }), { status: 200, headers: { 'content-type': 'application/json' } }));
  try {
    const put = (body) => call('PUT', '/api/launcher/cape', { body, headers: { 'x-minecraft-token': `token-${mc}` } }); // a token of its own: known tokens are remembered
    isError(await put({ cape: 'flame' }), 403, /częścią Hammer\+/);
    isError(await put({ cape: 'ember', cosmetics: { halo: true } }), 403, /Dodatki .* częścią Hammer\+/);
    isError(await put({ cape: 'ember', cosmetics: { wings: 'smok' } }), 400, /Nieznany dodatek/);
    assert.deepEqual((await put({ cape: 'ember', cosmetics: null })).body, { cape: 'ember', cosmetics: { wings: null, halo: false, hat: null } });
    assert.deepEqual((await put({ cape: 'hammer' })).body, { cape: 'hammer' });
    assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body, { capes: { [mc]: 'hammer' } });
  } finally {
    launcher.setProfileFetch(null);
  }
});

test('cloud data and capes survive a restart (data/web.json)', async () => {
  reset();
  const mc = account();
  const code = plus.issue({ mc, days: 30 });
  const saved = await call('PUT', '/api/launcher/cloud', { code, body: { data: { keep: ['me'] } } });
  await call('PUT', '/api/launcher/cape', { code, body: { cape: 'hammer', cosmetics: { halo: true } } });
  webStore.flush();
  webStore.load();
  assert.deepEqual((await call('GET', '/api/launcher/cloud', { code })).body, { updatedAt: saved.body.updatedAt, data: { keep: ['me'] } });
  assert.deepEqual((await call('GET', `/api/launcher/capes?uuids=${mc}`)).body, { capes: { [mc]: 'hammer' }, looks: { [mc]: { cape: 'hammer', halo: true } } });
  const file = JSON.parse(require('node:fs').readFileSync(require('node:path').join(db.dataDir, 'web.json'), 'utf8'));
  assert.deepEqual(Object.keys(file).sort(), ['alert', 'capes', 'cloud', 'cosmetics', 'news', 'orders', 'plusPlans', 'releases', 'sessions', 'stats', 'users'], 'next to the website\'s accounts, orders and what the admin panel published');
  assert.ok(!JSON.stringify(file).includes(code), 'the code itself is never stored');
});

test('the per-IP limits of the website apply: too many calls in a minute → 429', async () => {
  reset();
  const mc = account();
  const code = plus.issue({ mc, days: 30 });
  // Saving is limited harder than reading (30 a minute).
  for (let k = 0; k < 30; k += 1) assert.equal((await call('PUT', '/api/launcher/cape', { code, body: { cape: 'gold' } })).status, 200, `save ${k + 1}`);
  isError(await call('PUT', '/api/launcher/cape', { code, body: { cape: 'frost' } }), 429, /Zwolnij trochę/);
  assert.equal(webStore.capeOf(mc), 'gold');
  // 120 calls a minute in total: 31 are used up, 89 more pass, then everything waits.
  const rest = await Promise.all(Array.from({ length: 89 }, () => call('GET', '/api/launcher/health')));
  assert.ok(rest.every((r) => r.status === 200));
  isError(await call('GET', '/api/launcher/health'), 429, /Zwolnij trochę/);
  isError(await call('GET', `/api/launcher/capes?uuids=${mc}`), 429, /Zwolnij trochę/);
  // Somebody else is not affected.
  from = '10.99.99.99';
  assert.equal((await call('GET', '/api/launcher/health')).status, 200);
});

// ───────────── /join ─────────────
const hrefs = (html) => [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1]);
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

test('/join: a small page in the website\'s look that opens hammer://join?… in the launcher', async () => {
  reset();
  const query = '?server=mc.hammershop.pl:25566&name=Hammer%20SMP&mc=1.21.4&loader=fabric&pack=hammer-smp&icon=https://cdn.hammershop.pl/smp.png';
  const res = await call('GET', `/join${query}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/html; charset=utf-8/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = res.body;
  assert.match(html, /^<!doctype html>\n<html lang="pl">/);

  // The button and the automatic attempt use the page's own query string, unchanged.
  assert.match(html, /<a class="button primary" id="open" href="hammer:\/\/join\?[^"]*">Otwórz w Hammer Launcherze<\/a>/);
  assert.equal(unescape(hrefs(html).find((h) => h.startsWith('hammer:'))), `hammer://join${query}`);
  assert.match(html, /window\.location\.href=a\.getAttribute\("href"\)/, 'it tries to open the launcher by itself');
  assert.match(html, /<p class="hint">Nie masz launchera\? <a href="\/">[^<]+<\/a><\/p>/, 'a link to the home page');

  // The server is named on the page.
  assert.match(html, /<h1>Dołącz do serwera <span>Hammer SMP<\/span><\/h1>/);
  assert.match(html, /<code>mc\.hammershop\.pl:25566<\/code>/);
  assert.match(html, /<span>Minecraft 1\.21\.4<\/span><span>Fabric<\/span>/);
  assert.match(html, /<title>Dołącz do serwera Hammer SMP – Hammer Launcher<\/title>/);

  // The website's look, with nothing loaded from elsewhere: one inline style, one inline script, the site's own logo.
  assert.match(html, /--bg:#0e0b09/);
  assert.match(html, /\/assets\/hammershop-mark\.svg/);
  assert.match(html, /Hammer<b>Shop<\/b>/);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(html, /<script[^>]*\bsrc=|<link[^>]*rel="stylesheet"|@import|<iframe|<img|<form/i);
  assert.deepEqual([...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]), [], 'no address of another site');
  assert.doesNotMatch(html, /cdn\.hammershop\.pl\/smp\.png(?!")/, 'the icon from the link is passed on to the launcher, not loaded by the page');

  // Only this page's own style and script may run – whatever the address says.
  const csp = res.headers.get('content-security-policy');
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)[1];
  const style = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const hash = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
  assert.match(csp, /default-src 'none'/);
  assert.ok(csp.includes(`script-src ${hash(script)}`), 'the script is allowed by its hash');
  assert.ok(csp.includes(`style-src ${hash(style)}`), 'the style is allowed by its hash');
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);

  // Without a query it still opens the launcher; other methods are refused; /join/ works too.
  const bare = (await call('GET', '/join')).body;
  assert.match(bare, /<h1>Otwórz Hammer Launcher<\/h1>/);
  assert.match(bare, /id="open" href="hammer:\/\/join"/);
  assert.doesNotMatch(bare, /<code>|class="chips"/);
  assert.match((await call('GET', '/join?server=play.example.pl')).body, /<h1>Dołącz do serwera<\/h1><p class="address"><code>play\.example\.pl<\/code><\/p>/);
  assert.equal((await call('GET', '/join/?server=play.example.pl')).status, 200);
  assert.equal((await call('POST', '/join', { body: {} })).status, 405);
  assert.equal((await call('HEAD', '/join?server=play.example.pl')).status, 200);
  assert.match((await call('GET', '/')).body, /<title>HammerShop/, 'the store page is still the store page');
});

test('/join never puts raw HTML from the address on the page', async () => {
  reset();
  const attacks = [
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    "'><img src=x onerror=alert(1)>",
    '</title><script>alert(1)</script>',
    '</h1><a href="https://evil.example">kliknij</a>',
    '</script><script>alert(1)</script>',
    'javascript:alert(1)',
    '"onmouseover="alert(1)',
    '&lt;b&gt;&amp;',
    '{{7*7}}${7*7}',
  ];
  for (const attack of attacks) {
    for (const param of ['name', 'server', 'mc', 'loader', 'pack', 'icon', 'cokolwiek']) {
      const query = `?${param}=${encodeURIComponent(attack)}&server2=x`;
      const res = await call('GET', `/join${query}`);
      assert.equal(res.status, 200);
      const html = res.body;
      const where = `${param}=${attack}`;
      // Exactly the page's own tags – nothing new can appear, whatever the value.
      assert.equal((html.match(/<script/gi) ?? []).length, 1, where);
      assert.equal((html.match(/<\/script/gi) ?? []).length, 1, where);
      assert.equal((html.match(/<a\b/gi) ?? []).length, 3, where);
      assert.equal((html.match(/<img|<iframe|<svg|<form|<meta http-equiv/gi) ?? []).length, 0, where);
      assert.doesNotMatch(html, /<[^>]*\bon[a-z]+\s*=/i, `no event handler attribute: ${where}`);
      assert.deepEqual(hrefs(html).filter((h) => !h.startsWith('hammer://join')), ['/', '/'], `only the home page and the launcher are linked: ${where}`);
      // The launcher link still carries the query exactly as it came.
      assert.equal(new URL(unescape(hrefs(html).find((h) => h.startsWith('hammer:')))).searchParams.get(param), attack, where);
      // What is shown is the text itself, escaped.
      if (param === 'name') assert.ok(html.includes(`<span>${attack.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</span>`), where);
    }
  }

  // Long and odd values: cut, on one line, never breaking the page.
  const long = await call('GET', `/join?name=${'A'.repeat(500)}&server=${'b'.repeat(500)}&mc=${'9'.repeat(50)}&loader=${encodeURIComponent('<b>')}`);
  assert.match(long.body, new RegExp(`<span>A{60}</span>`));
  assert.match(long.body, new RegExp(`<code>b{100}</code>`));
  assert.doesNotMatch(long.body, /class="chips"/, 'an unknown loader or version is not shown');
  const lines = await call('GET', `/join?name=${encodeURIComponent('Linia 1\r\nLinia 2\t‮odwrócone')}`);
  assert.match(lines.body, /<span>Linia 1 Linia 2 odwrócone<\/span>/);
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

test('/join in a real browser: styled, its script runs under the page\'s own security policy, injected HTML stays text', { skip: !pw && 'Playwright is not installed' }, async () => {
  reset();
  const fs = require('node:fs');
  const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  try {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const page = await (await browser.newContext({ viewport })).newPage();
      const blocked = [];
      const dialogs = [];
      page.on('console', (m) => /Content Security Policy|Refused to/i.test(m.text()) && blocked.push(m.text()));
      page.on('pageerror', (e) => blocked.push(`pageerror: ${e.message}`));
      page.on('dialog', (d) => {
        dialogs.push(d.message());
        d.dismiss().catch(() => null);
      });
      await page.goto(`${base}/join?server=mc.hammershop.pl&name=${encodeURIComponent('Hammer <img src=x onerror=alert(1)> SMP')}&mc=1.21.4&loader=neoforge`);
      const button = page.getByRole('link', { name: 'Otwórz w Hammer Launcherze' });
      await button.waitFor();
      assert.match(await button.getAttribute('href'), /^hammer:\/\/join\?server=mc\.hammershop\.pl&name=/);
      assert.equal(await page.locator('h1 span').textContent(), 'Hammer <img src=x onerror=alert(1)> SMP', 'shown as text');
      assert.equal(await page.locator('img').count(), 0);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(14, 11, 9)', 'the page\'s style applies');
      assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.card')).borderRadius), '15px');
      assert.equal(await page.locator('.chips span').allTextContents().then((t) => t.join('|')), 'Minecraft 1.21.4|NeoForge');
      assert.equal(await page.getByRole('link', { name: 'Przejdź na stronę HammerShop' }).getAttribute('href'), '/');
      // The page's script ran (it tried the launcher, then says what to do when nothing opened).
      await page.waitForFunction(() => document.getElementById('status').textContent.includes('Launcher się nie otworzył'), null, { timeout: 10_000 });
      const box = await button.boundingBox();
      assert.ok(box.width > 200 && box.x >= 0 && box.x + box.width <= viewport.width, 'the button fits the screen');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (process.env.HS_SHOTS) await page.screenshot({ path: `${process.env.HS_SHOTS}/join-${viewport.width}.png` });
      assert.deepEqual(blocked, [], 'nothing of the page itself is blocked');
      assert.deepEqual(dialogs, [], 'nothing from the address ran');
      await page.context().close();
    }
  } finally {
    await browser.close();
  }
});
