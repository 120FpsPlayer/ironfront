'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createShopApi, apiBase, ShopError, OFFLINE_NOTE } = require('../src/main/shopapi');
const cloudSync = require('../src/main/cloud');
const serverList = require('../src/main/servers');
const { createServices } = require('../src/main/services');
const { writeNbt, tag } = require('../src/main/nbt');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
const BASE = 'https://hammershop.pl/api/launcher';

/**
 * A stand-in for the shop website: one cloud copy and one cape per code, answers like the contract says.
 * `mode` makes it misbehave: 'down' (no connection), 'html' (a parked page), 'error' (500), 'gone' (plain 404).
 */
function fakeShop({ codes = [] } = {}) {
  const shop = { codes: new Set(codes), copies: new Map(), capes: new Map(), calls: [], mode: 'ok', clock: 1762860000 };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  shop.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const code = String(init.headers?.authorization ?? '').replace('Bearer ', '');
    const minecraft = init.headers?.['x-minecraft-token'] ?? null;
    shop.calls.push({ method, url: String(url), code, ...(minecraft ? { minecraft } : {}), body: init.body ? JSON.parse(init.body) : undefined });
    if (shop.mode === 'down') throw new TypeError('fetch failed');
    if (shop.mode === 'html') return new Response('<html><body>Domena zaparkowana</body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
    if (shop.mode === 'error') return json(500, { error: 'Błąd serwera.' });
    if (shop.mode === 'gone') return new Response('Cannot GET /api/launcher/cloud', { status: 404 });
    if (!String(url).startsWith(`${BASE}/`)) return new Response('?', { status: 404 });
    if (minecraft && `${method} ${String(url).slice(BASE.length)}` === 'PUT /cape') {
      // A free cape without Hammer+: the Minecraft sign-in proves the account.
      const cape = JSON.parse(init.body).cape;
      if (cape !== null && !['hammer', 'ember'].includes(cape)) return json(403, { error: 'Ta peleryna wymaga Hammer+.' });
      shop.capes.set(`mc:${minecraft}`, cape);
      return json(200, { cape });
    }
    if (!shop.codes.has(code)) return json(401, { error: 'Ten kod Hammer+ został wycofany.' });
    const route = `${method} ${String(url).slice(BASE.length)}`;
    const stored = shop.copies.get(code);
    if (route === 'GET /cloud') return stored ? json(200, stored) : json(404, { error: 'Nie ma jeszcze kopii.' });
    if (route === 'PUT /cloud') {
      const { data, baseUpdatedAt } = JSON.parse(init.body);
      if (stored && baseUpdatedAt !== undefined && baseUpdatedAt !== stored.updatedAt) return json(409, { error: 'W chmurze jest nowsza kopia.', ...stored });
      shop.copies.set(code, { updatedAt: (shop.clock += 60), data });
      return json(200, { updatedAt: shop.clock });
    }
    if (route === 'PUT /cape') {
      shop.capes.set(code, JSON.parse(init.body).cape);
      return json(200, { cape: shop.capes.get(code) });
    }
    return json(404, { error: 'Nie ma takiego adresu.' });
  };
  return shop;
}

test('the shop API base comes from launcher.config.json: shopApi, else the website – https only', () => {
  assert.equal(apiBase({ website: 'https://hammershop.pl' }), BASE);
  assert.equal(apiBase({ website: 'https://hammershop.pl', shopApi: 'https://sklep.hammershop.pl/' }), 'https://sklep.hammershop.pl/api/launcher');
  assert.equal(apiBase({ shopApi: 'http://localhost:3000' }), 'http://localhost:3000/api/launcher', 'a shop on this computer may be plain http');
  for (const bad of [{}, { website: '' }, { website: 'http://hammershop.pl' }, { website: 'ftp://x' }, { website: 'hammershop.pl' }]) assert.equal(apiBase(bad), '');
});

test('shop API: cloud copy and cape with the code as the Bearer token', async () => {
  const shop = fakeShop({ codes: ['HP1.a.b'] });
  const api = createShopApi({ config: { website: 'https://hammershop.pl' }, fetchFn: shop.fetch });
  assert.equal(api.base(), BASE);
  assert.equal(await api.getCloud('HP1.a.b'), null, '404 = nothing stored yet');
  assert.deepEqual(shop.calls.at(-1), { method: 'GET', url: `${BASE}/cloud`, code: 'HP1.a.b', body: undefined });
  const first = await api.putCloud('HP1.a.b', { data: { v: 1, x: 1 } });
  assert.deepEqual(shop.calls.at(-1).body, { data: { v: 1, x: 1 } }, 'no base on the first copy');
  assert.deepEqual(await api.getCloud('HP1.a.b'), { updatedAt: first.updatedAt, data: { v: 1, x: 1 } });
  const second = await api.putCloud('HP1.a.b', { data: { v: 1, x: 2 }, baseUpdatedAt: first.updatedAt });
  assert.ok(second.updatedAt > first.updatedAt);
  // Someone else wrote in between → 409 with their copy.
  const err = await api.putCloud('HP1.a.b', { data: { v: 1, x: 3 }, baseUpdatedAt: first.updatedAt }).catch((e) => e);
  assert.ok(err instanceof ShopError);
  assert.deepEqual([err.status, err.offline, err.conflict], [409, false, { updatedAt: second.updatedAt, data: { v: 1, x: 2 } }]);
  assert.deepEqual(await api.putCape('HP1.a.b', 'gold'), { cape: 'gold' });
  assert.deepEqual(shop.calls.at(-1), { method: 'PUT', url: `${BASE}/cape`, code: 'HP1.a.b', body: { cape: 'gold' } });
  assert.deepEqual(await api.putCape('HP1.a.b', ''), { cape: null });
  assert.deepEqual(shop.calls.at(-1).body, { cape: null });
  // The shop's own Polish refusal reaches the player; too much data never leaves the launcher.
  await assert.rejects(api.getCloud('HP1.zly.kod'), (e) => e.message === 'Ten kod Hammer+ został wycofany.' && e.status === 401 && !e.offline);
  const n = shop.calls.length;
  await assert.rejects(api.putCloud('HP1.a.b', { data: { big: 'x'.repeat(300_000) } }), /za duża dla chmury \(limit to 256 KB\)/);
  assert.equal(shop.calls.length, n);
});

test('shop API: a shop that is not online fails softly, always with the same friendly note', async () => {
  const shop = fakeShop({ codes: ['c'] });
  const api = createShopApi({ config: { website: 'https://hammershop.pl' }, fetchFn: shop.fetch });
  const soft = (e) => e instanceof ShopError && e.offline === true && e.message === 'Chmura zadziała, gdy sklep HammerShop będzie online.';
  for (const mode of ['down', 'html', 'error', 'gone']) {
    shop.mode = mode;
    await assert.rejects(api.getCloud('c'), soft, `GET, ${mode}`);
    await assert.rejects(api.putCloud('c', { data: {} }), soft, `PUT, ${mode}`);
    await assert.rejects(api.putCape('c', 'gold'), soft, `cape, ${mode}`);
  }
  assert.equal(OFFLINE_NOTE, 'Chmura zadziała, gdy sklep HammerShop będzie online.');
  // No address in the config, or no code: nothing is even sent.
  shop.mode = 'ok';
  const n = shop.calls.length;
  await assert.rejects(createShopApi({ config: {}, fetchFn: shop.fetch }).getCloud('c'), soft);
  await assert.rejects(api.getCloud(null), soft);
  assert.equal(shop.calls.length, n);
  // An answer that never comes is given up on.
  const slow = createShopApi({
    config: { website: 'https://hammershop.pl' },
    timeoutMs: 30,
    fetchFn: (url, init) =>
      new Promise((resolve, reject) => {
        const open = setTimeout(resolve, 5000); // stands for the open connection (the timeout's own timer does not keep Node alive)
        init.signal.addEventListener('abort', () => (clearTimeout(open), reject(init.signal.reason)));
      }),
  });
  await assert.rejects(slow.getCloud('c'), soft);
  // A copy without a date or data is not a copy.
  const odd = createShopApi({ config: { website: 'https://hammershop.pl' }, fetchFn: async () => new Response('{"ok":true}', { status: 200 }) });
  await assert.rejects(odd.getCloud('c'), soft);
  await assert.rejects(odd.putCloud('c', { data: {} }), soft);
});

/** Two instances in a launcher folder, each with servers and the mod's HUD file. */
function computer() {
  const root = tmpDir();
  const make = (id, name, servers, hud) => {
    const dir = path.join(root, id);
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    const instance = { id, name, dir };
    for (const s of servers) serverList.add(instance, s);
    if (hud) fs.writeFileSync(path.join(dir, 'config', 'hammerclient.json'), JSON.stringify(hud));
    return instance;
  };
  const stored = { accent: 'blue', accentColor: '', heroStyle: 'classic' };
  const settings = { get: () => ({ ...stored }), set: (patch) => Object.assign(stored, patch) && { ...stored } };
  return { root, make, settings };
}

test('cloud document: the look, every instance\'s servers (name + address) and HUD – by instance name', () => {
  const pc = computer();
  const a = pc.make('a', 'Hammer', [{ name: 'HammerShop', address: 'mc.hammershop.pl' }, { name: 'Kuba', address: 'kuba.pl:25570' }], { hud: { fps: { x: 4, y: 4 } }, accent: '#ff9f43' });
  const b = pc.make('b', 'Survival', [], null);
  const twin = pc.make('c', 'Hammer', [{ name: 'Inny', address: 'inny.pl' }], null);
  const doc = cloudSync.collect({ settings: pc.settings.get(), instances: [b, a, twin] });
  assert.deepEqual(doc, {
    v: 1,
    launcher: { accent: 'blue', accentColor: '', heroStyle: 'classic' },
    instances: {
      Hammer: { servers: [{ name: 'HammerShop', address: 'mc.hammershop.pl' }, { name: 'Kuba', address: 'kuba.pl:25570' }], hud: { hud: { fps: { x: 4, y: 4 } }, accent: '#ff9f43' } },
      Survival: { servers: [] },
    },
  });
  assert.deepEqual(cloudSync.summarize(doc), { instances: 2, servers: 2 });
  assert.equal(cloudSync.canonical({ b: 1, a: [{ d: 1, c: 2 }] }), cloudSync.canonical({ a: [{ c: 2, d: 1 }], b: 1 }), 'key order never makes two copies differ');
  // An instance in a game is not read: it goes in as it was in the copy agreed on last time (or not at all).
  fs.writeFileSync(path.join(a.dir, 'config', 'hammerclient.json'), '{ half-written');
  const during = cloudSync.collect({ settings: pc.settings.get(), instances: [a, b], skip: (i) => i.id === 'a', previous: doc });
  assert.deepEqual(during.instances.Hammer, doc.instances.Hammer);
  assert.deepEqual(Object.keys(cloudSync.collect({ settings: pc.settings.get(), instances: [a, b], skip: (i) => i.id === 'a' }).instances), ['Survival']);
  // A HUD file that does not read is simply left out.
  assert.deepEqual(cloudSync.collect({ settings: pc.settings.get(), instances: [a] }).instances.Hammer.hud, undefined);
  // Dates from the shop: unix seconds, milliseconds or text.
  assert.deepEqual([cloudSync.toMs(1762860000), cloudSync.toMs(1762860000000), cloudSync.toMs(new Date(1762860000000).toISOString()), cloudSync.toMs('wczoraj'), cloudSync.toMs(null)], [1762860000000, 1762860000000, 1762860000000, null, null]);
});

test('cloud document: the size is checked before anything is sent', () => {
  const small = { v: 1, launcher: {}, instances: { A: { servers: [] } } };
  assert.ok(cloudSync.checkSize(small) < 100);
  const huge = { v: 1, launcher: {}, instances: { Mała: { servers: [] }, 'Wielka paczka': { servers: [], hud: { profiles: 'x'.repeat(260 * 1024) } } } };
  assert.throws(() => cloudSync.checkSize(huge), /za duża dla chmury: 26\d KB, a limit to 256 KB\. Najwięcej zajmuje instancja „Wielka paczka”/);
  assert.ok(cloudSync.MAX_DOC < 256 * 1024);
});

test('taking a copy: the instances both have become equal to it; a running instance is not touched', () => {
  const pc = computer();
  const a = pc.make('a', 'Hammer', [{ name: 'Stary', address: 'stary.pl' }, { name: 'HammerShop', address: 'mc.hammershop.pl' }], { hud: { fps: { x: 1 } } });
  const b = pc.make('b', 'Survival', [{ name: 'Zostaje', address: 'zostaje.pl' }], { keep: true });
  const local = pc.make('c', 'Tylko tutaj', [{ name: 'Mój', address: 'moj.pl' }], null);
  // The icon of a server that stays must survive.
  const root = Object.assign(tag.compound({ servers: tag.list('compound', [tag.compound({ name: tag.string('Stary'), ip: tag.string('stary.pl') }), tag.compound({ name: tag.string('HammerShop'), ip: tag.string('mc.hammershop.pl'), icon: tag.string('aWNvbg=='), acceptTextures: tag.byte(1) })]) }), { name: '' });
  fs.writeFileSync(path.join(a.dir, 'servers.dat'), writeNbt(root));
  const doc = {
    v: 1,
    launcher: { accent: 'custom', accentColor: '#12ab9f', heroStyle: 'stars', javaPath: 'C:/evil.exe' },
    instances: {
      Hammer: { servers: [{ name: 'Sklep', address: 'mc.hammershop.pl' }, { name: 'Nowy', address: 'nowy.pl:25570' }, { name: 'zły', address: 'to nie adres' }, null], hud: { hud: { fps: { x: 9 } } } },
      Survival: { servers: [], hud: { other: 1 } },
      'Nie ma tu takiej': { servers: [{ name: 'X', address: 'x.pl' }] },
      Zepsuta: 'tekst',
    },
  };
  const result = cloudSync.apply(doc, { settings: pc.settings, instances: [a, b, local], skip: (i) => i.id === 'b' });
  assert.deepEqual(result, { look: true, changed: ['Hammer'], skipped: ['Survival'], missing: ['Nie ma tu takiej'] });
  assert.deepEqual(pc.settings.get(), { accent: 'custom', accentColor: '#12ab9f', heroStyle: 'stars' }, 'only the look is taken from the copy');
  assert.deepEqual(serverList.list(a).map((s) => [s.name, s.address, s.icon, s.acceptTextures]), [['Sklep', 'mc.hammershop.pl', 'data:image/png;base64,aWNvbg==', true], ['Nowy', 'nowy.pl:25570', null, null]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(a.dir, 'config', 'hammerclient.json'), 'utf8')), { hud: { fps: { x: 9 } } });
  assert.deepEqual(serverList.list(b).map((s) => s.address), ['zostaje.pl'], 'the running instance keeps its list');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(b.dir, 'config', 'hammerclient.json'), 'utf8')), { keep: true });
  assert.deepEqual(serverList.list(local).map((s) => s.address), ['moj.pl'], 'an instance the copy does not know is left alone');
  // The same copy again changes nothing (and writes nothing).
  const before = fs.statSync(path.join(a.dir, 'servers.dat')).mtimeMs;
  assert.deepEqual(cloudSync.apply(doc, { settings: pc.settings, instances: [a, local] }), { look: false, changed: [], skipped: [], missing: ['Survival', 'Nie ma tu takiej'] });
  assert.equal(fs.statSync(path.join(a.dir, 'servers.dat')).mtimeMs, before);
  // A copy from a newer launcher, or something that is not a copy, is refused whole.
  assert.throws(() => cloudSync.apply({ v: 2, instances: {} }, { settings: pc.settings, instances: [a] }), /pochodzi z nowszego launchera/);
  assert.throws(() => cloudSync.apply('x', { settings: pc.settings, instances: [a] }), /pochodzi z nowszego launchera/);
});

/** The sync engine over a fake shop, with this computer's document in a variable. */
function engine(shop, { code = 'kod' } = {}) {
  const pc = { doc: { v: 1, launcher: { accent: 'orange' }, instances: { Hammer: { servers: [] } } }, taken: [] };
  const api = createShopApi({ config: { website: 'https://hammershop.pl' }, fetchFn: shop.fetch });
  let clock = 1_000;
  const cloud = cloudSync.createCloud({
    file: path.join(tmpDir(), 'cloud.json'),
    api,
    now: () => (clock += 1000),
    local: () => structuredClone(pc.doc),
    take: (doc) => {
      pc.taken.push(doc);
      pc.doc = structuredClone(doc);
      return { look: true, changed: Object.keys(doc.instances), skipped: [], missing: [] };
    },
  });
  return { pc, cloud, code, mc: GRACZ.id };
}

test('sync: send, fetch, and a newer copy from another computer is a question, never an overwrite', async () => {
  const shop = fakeShop({ codes: ['kod'] });
  const home = engine(shop);
  const laptop = engine(shop);
  assert.equal(home.cloud.last(home.mc), null);
  assert.deepEqual(await home.cloud.pull('kod', home.mc), { empty: true });

  // Home sends the first copy.
  const sent = await home.cloud.push('kod', home.mc);
  assert.deepEqual([sent.ok, typeof sent.at, sent.updatedAt], [true, 'number', shop.copies.get('kod').updatedAt]);
  assert.deepEqual(home.cloud.last(home.mc), { at: sent.at, direction: 'push', updatedAt: sent.updatedAt });
  assert.deepEqual(shop.calls.map((c) => c.method), ['GET', 'GET', 'PUT'], 'the first send looks before it writes');

  // The laptop has other servers and never synced: its first send must not wipe the copy from home.
  laptop.pc.doc.instances.Hammer.servers = [{ name: 'L', address: 'l.pl' }];
  const asked = await laptop.cloud.push('kod', laptop.mc);
  assert.deepEqual(asked, { conflict: true, updatedAt: sent.updatedAt, at: sent.updatedAt * 1000, cloud: { instances: 1, servers: 0 }, local: { instances: 1, servers: 1 } });
  assert.deepEqual(shop.copies.get('kod').data.instances.Hammer.servers, [], 'nothing was written');
  // "Zostaw tę z tego komputera": the laptop's copy wins, based on the one it was shown.
  const forced = await laptop.cloud.push('kod', laptop.mc, { force: true, baseUpdatedAt: asked.updatedAt });
  assert.equal(forced.ok, true);
  assert.deepEqual(shop.copies.get('kod').data.instances.Hammer.servers, [{ name: 'L', address: 'l.pl' }]);

  // Home changed something too and sends: the shop answers 409 → a question again.
  home.pc.doc.launcher.accent = 'green';
  const clash = await home.cloud.push('kod', home.mc);
  assert.deepEqual([clash.conflict, clash.updatedAt, clash.cloud], [true, forced.updatedAt, { instances: 1, servers: 1 }]);
  assert.equal(shop.calls.at(-1).body.baseUpdatedAt, sent.updatedAt, 'sent as a change of the copy home knew');
  // "Zostaw tę z chmury".
  const taken = await home.cloud.pull('kod', home.mc);
  assert.deepEqual([taken.ok, taken.look, taken.changed, taken.updatedAt], [true, true, ['Hammer'], forced.updatedAt]);
  assert.deepEqual(home.pc.doc.instances.Hammer.servers, [{ name: 'L', address: 'l.pl' }]);
  assert.equal(home.cloud.last(home.mc).direction, 'pull');
  // Now both agree: the next send goes straight through.
  home.pc.doc.launcher.accent = 'red';
  assert.equal((await home.cloud.push('kod', home.mc)).ok, true);
  // A computer whose copy is already what the cloud holds just notes that, without sending.
  const third = engine(shop);
  third.pc.doc = structuredClone(home.pc.doc);
  const n = shop.calls.length;
  assert.equal((await third.cloud.push('kod', third.mc)).ok, true);
  assert.deepEqual(shop.calls.slice(n).map((c) => c.method), ['GET']);
});

test('automatic sync: fetch at the start only when just the cloud changed; send after a game only when this computer did', async () => {
  const shop = fakeShop({ codes: ['kod'] });
  const home = engine(shop);
  const laptop = engine(shop);
  assert.deepEqual(await home.cloud.startup('kod', home.mc), { empty: true });
  // After the first game: nothing agreed yet → the copy is sent.
  assert.equal((await home.cloud.afterSession('kod', home.mc)).ok, true);
  let n = shop.calls.length;
  assert.deepEqual(await home.cloud.afterSession('kod', home.mc), { upToDate: true }, 'nothing changed → nothing is sent');
  assert.deepEqual(await home.cloud.startup('kod', home.mc), { upToDate: true });
  assert.deepEqual(shop.calls.slice(n).map((c) => c.method), ['GET']);

  // The laptop starts with the same content → it simply agrees; with other content it asks first.
  assert.deepEqual(await laptop.cloud.startup('kod', laptop.mc), { upToDate: true });
  const fresh = engine(shop);
  fresh.pc.doc.launcher.accent = 'purple';
  assert.equal((await fresh.cloud.startup('kod', fresh.mc)).conflict, true, 'the first sync of a computer with its own settings is a question');
  assert.deepEqual(fresh.pc.taken, []);

  // The laptop changes the look and plays → sent. Home starts later, unchanged → takes it without asking.
  laptop.pc.doc.launcher.accent = 'gold';
  assert.equal((await laptop.cloud.afterSession('kod', laptop.mc)).ok, true);
  const pulled = await home.cloud.startup('kod', home.mc);
  assert.deepEqual([pulled.ok, pulled.look, home.pc.doc.launcher.accent], [true, true, 'gold']);
  // Both changed since → a question, and nothing is taken.
  laptop.pc.doc.launcher.accent = 'red';
  await laptop.cloud.afterSession('kod', laptop.mc);
  home.pc.doc.instances.Hammer.servers = [{ name: 'H', address: 'h.pl' }];
  n = home.pc.taken.length;
  const both = await home.cloud.startup('kod', home.mc);
  assert.deepEqual([both.conflict, both.local, both.cloud], [true, { instances: 1, servers: 1 }, { instances: 1, servers: 0 }]);
  assert.equal(home.pc.taken.length, n);
  assert.equal((await home.cloud.afterSession('kod', home.mc)).conflict, true, 'and sending after a game asks as well');

  // The shop goes away: every call fails softly and nothing is lost.
  shop.mode = 'down';
  for (const call of [() => home.cloud.push('kod', home.mc), () => home.cloud.pull('kod', home.mc), () => home.cloud.startup('kod', home.mc), () => home.cloud.afterSession('kod', home.mc)]) await assert.rejects(call(), (e) => e.offline === true);
  assert.deepEqual(home.pc.doc.instances.Hammer.servers, [{ name: 'H', address: 'h.pl' }]);
  // A shop whose GET route is missing but that takes the copy: the first send still works.
  const lone = engine(fakeShop({ codes: ['kod'] }));
  assert.equal((await lone.cloud.push('kod', lone.mc)).ok, true);
});

const { EventEmitter } = require('node:events');
function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

/** Services over a launcher folder with Hammer+ active for one account, the fake shop behind fetch, one instance. */
function services(shop, keys = plusKeys()) {
  const events = [];
  const code = keys.code({ mc: GRACZ.id });
  shop.codes.add(code);
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop', website: 'https://hammershop.pl', plusPublicKey: keys.publicKey }, accounts: { list: () => [GRACZ] }, fetchFn: shop.fetch, emit: (channel, payload) => events.push({ channel, payload }), launchFn: async () => fakeChild() });
  s.plus.activate(code);
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  const hudFile = path.join(instance.dir, 'config', 'hammerclient.json');
  fs.mkdirSync(path.dirname(hudFile), { recursive: true });
  /** One game session: the game starts, `during()` runs while it is open, then it exits and the launcher finishes its own work. */
  const play = async (during = () => {}) => {
    const child = await s.games.start({ instance: s.instances.get(instance.id), options: {} });
    await during();
    child.emit('exit', 0, null);
    await s.afterSessions();
  };
  return { s, events, code, instance, hudFile, play, keys };
}
const NOTE = 'Chmura zadziała, gdy sklep HammerShop będzie online.';

test('services: Wyślij / Pobierz with the account\'s code; the shop being offline is an answer, not an error', async () => {
  const shop = fakeShop();
  const keys = plusKeys();
  const home = services(shop, keys);
  home.s.servers.add(home.instance.id, { name: 'HammerShop', address: 'mc.hammershop.pl' });
  fs.writeFileSync(home.hudFile, JSON.stringify({ hud: { fps: { x: 4 } } }));
  home.s.settings.set({ accent: 'custom', accentColor: '#3366ff', heroStyle: 'forge' });

  shop.mode = 'down';
  assert.deepEqual(await home.s.cloud.push(), { offline: true, note: NOTE });
  assert.deepEqual(await home.s.cloud.pull(), { offline: true, note: NOTE });
  assert.deepEqual(home.s.cloud.status(), { active: true, auto: false, last: null, note: NOTE });

  shop.mode = 'ok';
  const sent = await home.s.cloud.push();
  assert.equal(sent.ok, true);
  assert.equal(shop.calls.at(-1).code, home.code, 'the Hammer+ code is the Bearer token');
  assert.deepEqual(shop.copies.get(home.code).data, { v: 1, launcher: { accent: 'custom', accentColor: '#3366ff', heroStyle: 'forge' }, instances: { Hammer: { servers: [{ name: 'HammerShop', address: 'mc.hammershop.pl' }], hud: { hud: { fps: { x: 4 } } } } } });
  assert.deepEqual(home.s.cloud.status(), { active: true, auto: false, last: { at: sent.at, direction: 'push', updatedAt: sent.updatedAt }, note: null });

  // A second computer – another launcher folder, the same account – with its own server: sending asks first.
  const laptop = services(shop, keys);
  laptop.s.servers.add(laptop.instance.id, { name: 'Tylko laptop', address: 'laptop.pl' });
  const asked = await laptop.s.cloud.push();
  assert.deepEqual([asked.conflict, asked.cloud, asked.local], [true, { instances: 1, servers: 1 }, { instances: 1, servers: 1 }]);
  // "Zostaw tę z chmury": the laptop becomes like home.
  const taken = await laptop.s.cloud.pull();
  assert.deepEqual([taken.ok, taken.look, taken.changed, taken.skipped, taken.missing], [true, true, ['Hammer'], [], []]);
  assert.deepEqual(laptop.s.servers.list(laptop.instance.id).map((x) => x.address), ['mc.hammershop.pl']);
  assert.deepEqual(JSON.parse(fs.readFileSync(laptop.hudFile, 'utf8')), { hud: { fps: { x: 4 } } });
  assert.deepEqual([laptop.s.settings.get().accent, laptop.s.settings.get().accentColor, laptop.s.settings.get().heroStyle], ['custom', '#3366ff', 'forge']);
  assert.equal(laptop.s.cloud.status().last.direction, 'pull');
  // "Zostaw tę z tego komputera" after a 409.
  laptop.s.servers.add(laptop.instance.id, { name: 'Nowy', address: 'nowy.pl' });
  assert.equal((await laptop.s.cloud.push()).ok, true);
  home.s.settings.set({ heroStyle: 'stars' });
  const clash = await home.s.cloud.push();
  assert.equal(clash.conflict, true);
  assert.equal((await home.s.cloud.push({ force: true, baseUpdatedAt: clash.updatedAt })).ok, true);
  assert.equal(shop.copies.get(home.code).data.launcher.heroStyle, 'stars');
  assert.deepEqual(shop.copies.get(home.code).data.instances.Hammer.servers.map((x) => x.address), ['mc.hammershop.pl']);

  // Other refusals are real errors, in the shop's own words; a copy that is too big never leaves the computer.
  shop.codes.delete(home.code);
  await assert.rejects(home.s.cloud.pull(), /Ten kod Hammer\+ został wycofany/);
  shop.codes.add(home.code);
  fs.writeFileSync(home.hudFile, JSON.stringify({ profiles: 'x'.repeat(120 * 1024) }));
  const twin = home.s.instances.create({ name: 'Druga', mcVersion: '1.21.1', loader: 'fabric' });
  const third = home.s.instances.create({ name: 'Trzecia', mcVersion: '1.21.1', loader: 'fabric' });
  for (const i of [twin, third]) {
    fs.mkdirSync(path.join(i.dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(i.dir, 'config', 'hammerclient.json'), JSON.stringify({ profiles: 'y'.repeat(100 * 1024) }));
  }
  const n = shop.calls.length;
  await assert.rejects(home.s.cloud.push(), /za duża dla chmury: \d+ KB, a limit to 256 KB\. Najwięcej zajmuje instancja „Hammer”/);
  assert.equal(shop.calls.length, n);
});

test('services: automatic sync – at the start and after a game session – never touches an instance in a game', async () => {
  const shop = fakeShop();
  const keys = plusKeys();
  const home = services(shop, keys);
  const laptop = services(shop, keys);
  assert.deepEqual(await home.s.cloud.startup(), { skipped: true }, 'off until the player switches it on');
  await home.play();
  assert.equal(shop.calls.length, 0, 'and nothing is sent after a game either');

  home.s.settings.set({ cloudAuto: true });
  laptop.s.settings.set({ cloudAuto: true });
  assert.equal(home.s.cloud.status().auto, true);
  assert.deepEqual(await home.s.cloud.startup(), { empty: true });
  // A game session at home: the player adds a server in the game → sent when the game closes.
  await home.play(() => home.s.servers.add(home.instance.id, { name: 'Dodany w grze', address: 'gra.pl' }));
  assert.deepEqual(shop.copies.get(home.code).data.instances.Hammer.servers, [{ name: 'Dodany w grze', address: 'gra.pl' }]);
  assert.deepEqual(home.events.filter((e) => e.channel === 'cloud:synced').map((e) => e.payload.direction), ['push']);
  let n = shop.calls.length;
  await home.play();
  assert.equal(shop.calls.length, n, 'a session that changed nothing sends nothing');

  // The laptop takes the copy once; from then on a start fetches by itself whatever home sent since.
  assert.equal((await laptop.s.cloud.pull()).ok, true);
  await home.play(() => home.s.servers.add(home.instance.id, { name: 'Drugi', address: 'drugi.pl' }));
  const auto = await laptop.s.cloud.startup();
  assert.deepEqual([auto.ok, auto.changed, auto.look], [true, ['Hammer'], false]);
  assert.deepEqual(laptop.s.servers.list(laptop.instance.id).map((x) => x.address), ['gra.pl', 'drugi.pl']);
  assert.deepEqual(await laptop.s.cloud.startup(), { upToDate: true });

  // The laptop plays and removes a server → sent. Home changed its look in the meantime: both changed, so home
  // gets a question at its start and again after its next game – and nothing is taken behind the player's back.
  await laptop.play(() => laptop.s.servers.remove(laptop.instance.id, 0, 'gra.pl'));
  home.s.settings.set({ accent: 'green' });
  assert.equal((await home.s.cloud.startup()).conflict, true);
  await home.play();
  assert.deepEqual(home.events.filter((e) => e.channel === 'cloud:conflict').map((e) => [e.payload.conflict, e.payload.cloud, e.payload.local]), [[true, { instances: 1, servers: 1 }, { instances: 1, servers: 2 }]]);
  assert.deepEqual(home.s.servers.list(home.instance.id).map((x) => x.address), ['gra.pl', 'drugi.pl']);

  // "Zostaw tę z chmury" while the instance is in a game: the look comes, the instance waits…
  shop.copies.get(home.code).data.instances.Hammer.hud = { hud: 1 };
  shop.copies.get(home.code).data.launcher.accent = 'purple';
  let child = await home.s.games.start({ instance: home.s.instances.get(home.instance.id), options: {} });
  const during = await home.s.cloud.pull();
  assert.deepEqual([during.look, during.changed, during.skipped], [true, [], ['Hammer']]);
  assert.equal(home.s.settings.get().accent, 'purple');
  assert.deepEqual(home.s.servers.list(home.instance.id).map((x) => x.address), ['gra.pl', 'drugi.pl']);
  assert.equal(fs.existsSync(home.hudFile), false);
  // …and because the copy was not taken in full, a send asks first instead of writing over the part that waited.
  assert.equal((await home.s.cloud.push()).conflict, true);
  child.emit('exit', 0, null);
  await home.s.afterSessions();
  assert.deepEqual(shop.copies.get(home.code).data.instances.Hammer.servers.map((x) => x.address), ['drugi.pl'], 'the laptop\'s list is still in the cloud');
  // With the game closed the copy is taken in full.
  const full = await home.s.cloud.pull();
  assert.deepEqual([full.changed, full.skipped], [['Hammer'], []]);
  assert.deepEqual(home.s.servers.list(home.instance.id).map((x) => x.address), ['drugi.pl']);
  assert.deepEqual(JSON.parse(fs.readFileSync(home.hudFile, 'utf8')), { hud: 1 });

  // Sending during a game leaves that instance out of it: the cloud keeps what both sides agreed on for it.
  child = await home.s.games.start({ instance: home.s.instances.get(home.instance.id), options: {} });
  home.s.servers.add(home.instance.id, { name: 'W trakcie', address: 'trakcie.pl' });
  home.s.settings.set({ heroStyle: 'aurora' });
  assert.equal((await home.s.cloud.push()).ok, true);
  assert.deepEqual(shop.copies.get(home.code).data.instances.Hammer.servers.map((x) => x.address), ['drugi.pl']);
  assert.equal(shop.copies.get(home.code).data.launcher.heroStyle, 'aurora');
  child.emit('exit', 0, null);
  await home.s.afterSessions();
  assert.deepEqual(shop.copies.get(home.code).data.instances.Hammer.servers.map((x) => x.address), ['drugi.pl', 'trakcie.pl'], 'after the game the instance is sent');

  // The shop is offline: a start and a finished game stay quiet and nothing breaks.
  shop.mode = 'down';
  n = home.events.length;
  assert.deepEqual(await home.s.cloud.startup(), { offline: true, note: NOTE });
  home.s.settings.set({ accent: 'red' });
  await home.play();
  assert.deepEqual(home.events.slice(n).filter((e) => e.channel === 'toast' || e.channel.startsWith('cloud:')), []);
  assert.equal(home.s.cloud.status().note, NOTE);
  // A refusal that is not "offline" is told once, as a warning.
  shop.mode = 'ok';
  shop.codes.delete(home.code);
  await home.play();
  assert.match(home.events.at(-1).payload.text, /Nie udało się wysłać kopii do chmury\. Ten kod Hammer\+ został wycofany\./);
});

test('services: the Hammer+ cape is stored in the launcher and shared with the shop when it is online', async () => {
  const shop = fakeShop();
  const { s, code } = services(shop);
  const said = (r) => ({ selected: r.selected, shared: r.shared, note: r.note });
  assert.deepEqual(s.plus.capes(), {
    capes: [{ id: 'hammer', name: 'Hammer', free: true }, { id: 'gold', name: 'Złota', free: false }, { id: 'ember', name: 'Żar', free: true }, { id: 'royal', name: 'Królewska', free: false }, { id: 'frost', name: 'Mróz', free: false }, { id: 'crimson', name: 'Karmazyn', free: false }],
    selected: '', on: true, lastMojang: '', custom: null, plus: true,
  });
  await assert.rejects(s.plus.setCape('dragon'), /Nie ma takiej peleryny/);
  shop.mode = 'down';
  assert.deepEqual(said(await s.plus.setCape('gold')), { selected: 'gold', shared: false, note: 'Inni gracze zobaczą ją, gdy sklep HammerShop będzie online.' });
  assert.equal(s.settings.get().hammerCape, 'gold', 'the choice is kept although the shop did not hear it');
  assert.equal(s.plus.capes().selected, 'gold');
  shop.mode = 'ok';
  assert.deepEqual(said(await s.plus.setCape('frost')), { selected: 'frost', shared: true, note: null });
  assert.deepEqual([shop.calls.at(-1).method, shop.calls.at(-1).url, shop.calls.at(-1).code, shop.calls.at(-1).body], ['PUT', `${BASE}/cape`, code, { cape: 'frost' }]);
  const n = shop.calls.length;
  assert.deepEqual(said(await s.plus.setCape('frost')), { selected: 'frost', shared: true, note: null });
  assert.equal(shop.calls.length, n, 'the shop is not told twice');
  assert.deepEqual(said(await s.plus.setCape(null)), { selected: '', shared: true, note: null });
  assert.equal(shop.capes.get(code), null);
  // Without Hammer+ a Hammer+ cape counts as none – a free one stays on.
  await s.plus.setCape('royal');
  s.plus.remove();
  assert.equal(s.plus.capes().selected, '');
  assert.equal(s.settings.get().hammerCape, 'royal', 'it comes back with the next code');
  s.plus.activate(code);
  await s.plus.setCape('ember');
  s.plus.remove();
  assert.equal(s.plus.capes().selected, 'ember', 'Żar is free');
});
