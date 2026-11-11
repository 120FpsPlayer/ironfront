'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { createSkins, checkSkin, pngSize, fromDataUrl, MAX_LIBRARY, PLUS_LIBRARY, MAX_OUTFITS } = require('../src/main/skins');
const { createServices } = require('../src/main/services');
const { createAccounts, createCrypt } = require('../src/main/accounts');
const { tmpDir, sha1, plusKeys } = require('./helpers');

function crc32(data) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A real (tiny) PNG file of the given size; `seed` makes different skins. */
function png(width = 64, height = 64, seed = 0) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height, seed % 251);
  for (let y = 0; y < height; y += 1) raw[y * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const TEXTURE = (n) => `http://textures.minecraft.net/texture/${String(n).repeat(40).slice(0, 40)}`;

/**
 * A stand-in for the Minecraft services: keeps one profile, answers like the real API and remembers every request.
 * `tokens` are the access tokens it accepts – anything else gets 401.
 */
function fakeMojang({ tokens = ['token-1'], skinUrl = TEXTURE('a'), capes = [{ id: 'cape-migrator', state: 'ACTIVE', url: TEXTURE('c'), alias: 'Migrator' }, { id: 'cape-vanilla', state: 'INACTIVE', url: TEXTURE('d'), alias: 'Vanilla' }] } = {}) {
  const textures = new Map([[TEXTURE('a').replace('http:', 'https:'), png(64, 64, 1)]]);
  const profile = { id: 'uuid-1', name: 'Gracz', skins: skinUrl ? [{ id: 's1', state: 'ACTIVE', url: skinUrl, variant: 'CLASSIC' }] : [], capes };
  const calls = [];
  let uploads = 0;
  const json = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? 'GET';
    calls.push({ url: u, method, auth: init.headers?.authorization, body: init.body });
    if (u.startsWith('https://textures.minecraft.net/')) return textures.has(u) ? new Response(textures.get(u), { status: 200 }) : new Response('nope', { status: 404 });
    if (!u.startsWith('https://api.minecraftservices.com/minecraft/profile')) return new Response('?', { status: 404 });
    if (fetchFn.status) return json(fetchFn.status, { error: 'x' });
    if (!tokens.includes(String(init.headers?.authorization ?? '').replace('Bearer ', ''))) return json(401, { error: 'Unauthorized' });
    const route = `${method} ${u.slice('https://api.minecraftservices.com/minecraft/profile'.length)}`;
    if (route === 'GET ') return json(200, profile);
    if (route === 'POST /skins') {
      const file = Buffer.from(await init.body.get('file').arrayBuffer());
      uploads += 1;
      const address = `https://textures.minecraft.net/texture/${sha1(file)}`;
      textures.set(address, file);
      profile.skins = [{ id: `s${uploads + 1}`, state: 'ACTIVE', url: address.replace('https:', 'http:'), variant: init.body.get('variant').toUpperCase() }];
      return json(200, profile);
    }
    if (route === 'DELETE /skins/active') {
      profile.skins = [];
      return json(200, profile);
    }
    if (route === 'PUT /capes/active') {
      const { capeId } = JSON.parse(init.body);
      if (!profile.capes.some((c) => c.id === capeId)) return json(400, { error: 'no such cape' });
      for (const c of profile.capes) c.state = c.id === capeId ? 'ACTIVE' : 'INACTIVE';
      return fetchFn.silent ? json(204) : json(200, profile);
    }
    if (route === 'DELETE /capes/active') {
      for (const c of profile.capes) c.state = 'INACTIVE';
      return json(200, profile);
    }
    return json(404, {});
  };
  return Object.assign(fetchFn, { calls, profile, textures, tokens });
}

const auth = (token = 'token-1', log = []) => async (force) => (log.push(Boolean(force)), { id: 'uuid-1', name: 'Gracz', accessToken: force ? 'token-fresh' : token });

test('a skin file is checked by its PNG header: 64×64 or 64×32, nothing else', () => {
  assert.deepEqual(pngSize(png(64, 64)), { width: 64, height: 64 });
  assert.deepEqual(checkSkin(png(64, 64)), { width: 64, height: 64, legacy: false });
  assert.equal(checkSkin(png(64, 32)).legacy, true);
  assert.throws(() => checkSkin(png(128, 128)), /musi mieć 64×64 pikseli.*ma 128×128/);
  assert.throws(() => checkSkin(png(32, 64)), /ma 32×64/);
  assert.throws(() => checkSkin(Buffer.from('GIF89a' + 'x'.repeat(60))), /To nie jest plik PNG/);
  assert.throws(() => checkSkin(Buffer.from('<html>this is not a picture, just some text</html>')), /To nie jest plik PNG/);
  assert.throws(() => checkSkin(png(64, 64).subarray(0, 20)), /To nie jest plik PNG/, 'a cut-off file');
  assert.throws(() => checkSkin(Buffer.alloc(0)), /pusty/);
  assert.throws(() => checkSkin(Buffer.concat([png(64, 64), Buffer.alloc(600 * 1024)])), /za duży/);
  assert.throws(() => checkSkin('not a buffer'), /pusty/);
  assert.equal(pngSize(Buffer.alloc(40)), null);
  // What the window sends: a PNG data URL and nothing else.
  assert.deepEqual(fromDataUrl(`data:image/png;base64,${png(64, 64).toString('base64')}`), png(64, 64));
  assert.throws(() => fromDataUrl('data:text/html;base64,PGI+'), /To nie jest plik PNG/);
  assert.throws(() => fromDataUrl('/etc/passwd'), /To nie jest plik PNG/);
  assert.throws(() => fromDataUrl(null), /To nie jest plik PNG/);
});

test('the profile: current skin over https, capes, and the worn skin lands in the library', async () => {
  const fetchFn = fakeMojang();
  const dir = path.join(tmpDir(), 'skins');
  const skins = createSkins({ dir, fetchFn, now: () => 1_000 });
  const state = await skins.state(auth());
  assert.deepEqual(state.account, { id: 'uuid-1', name: 'Gracz' });
  assert.equal(state.skin.url, 'https://textures.minecraft.net/texture/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(state.skin.variant, 'classic');
  assert.equal(state.skin.dataUrl, `data:image/png;base64,${png(64, 64, 1).toString('base64')}`);
  assert.deepEqual(state.capes, [
    { id: 'cape-migrator', name: 'Migrator', url: 'https://textures.minecraft.net/texture/cccccccccccccccccccccccccccccccccccccccc', active: true },
    { id: 'cape-vanilla', name: 'Vanilla', url: 'https://textures.minecraft.net/texture/dddddddddddddddddddddddddddddddddddddddd', active: false },
  ]);
  assert.equal(state.library.length, 1);
  assert.deepEqual([state.library[0].id, state.library[0].active, state.library[0].variant], [sha1(png(64, 64, 1)), true, 'classic']);
  assert.match(state.library[0].name, /^Skórka z konta \(/);
  assert.equal(state.skin.libraryId, state.library[0].id);
  assert.equal(fetchFn.calls[0].auth, 'Bearer token-1');
  assert.deepEqual(fs.readdirSync(dir).sort(), [`${sha1(png(64, 64, 1))}.png`, 'library.json'].sort());
  // The second look does not download the picture again.
  const before = fetchFn.calls.length;
  await skins.state(auth());
  assert.deepEqual(fetchFn.calls.slice(before).map((c) => c.url), ['https://api.minecraftservices.com/minecraft/profile']);
  // No custom skin, no capes; a texture server that is down still shows the link.
  const bare = await createSkins({ dir: path.join(tmpDir(), 's'), fetchFn: fakeMojang({ skinUrl: null, capes: [] }) }).state(auth());
  assert.deepEqual([bare.skin, bare.capes, bare.library], [null, [], []]);
  const offline = await createSkins({ dir: path.join(tmpDir(), 's'), fetchFn: fakeMojang({ skinUrl: TEXTURE('b') }) }).state(auth());
  assert.deepEqual([offline.skin.dataUrl, offline.skin.url.startsWith('https://'), offline.library], [null, true, []]);
});

test('upload: multipart with the model and the file; the old skin stays one click away', async () => {
  const fetchFn = fakeMojang();
  let clock = 1_000;
  const skins = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn, now: () => (clock += 1000) });
  await skins.state(auth());
  const knight = png(64, 64, 7);
  const after = await skins.upload(auth(), { png: knight, variant: 'slim', name: 'Rycerz.png' });
  const post = fetchFn.calls.find((c) => c.method === 'POST');
  assert.equal(post.url, 'https://api.minecraftservices.com/minecraft/profile/skins');
  assert.ok(post.body instanceof FormData);
  assert.equal(post.body.get('variant'), 'slim');
  assert.equal(post.body.get('file').type, 'image/png');
  assert.deepEqual(Buffer.from(await post.body.get('file').arrayBuffer()), knight);
  assert.equal(after.skin.variant, 'slim');
  assert.deepEqual(after.library.map((s) => [s.name, s.variant, s.active]), [['Rycerz', 'slim', true], [after.library[1].name, 'classic', false]]);
  assert.match(after.library[1].name, /^Skórka z konta/);
  // Back to the old one: its file is uploaded again, with the model it had.
  const back = await skins.use(auth(), after.library[1].id);
  const posts = fetchFn.calls.filter((c) => c.method === 'POST');
  assert.equal(posts.at(-1).body.get('variant'), 'classic');
  assert.deepEqual(Buffer.from(await posts.at(-1).body.get('file').arrayBuffer()), png(64, 64, 1));
  assert.deepEqual(back.library.map((s) => [s.name.slice(0, 6), s.active]), [['Skórka', true], ['Rycerz', false]]);
  assert.equal(back.library.length, 2, 'no duplicates');
  assert.equal((await skins.use(auth(), after.library[0].id, 'classic')).skin.variant, 'classic', 'the other arm model on request');
  await assert.rejects(skins.use(auth(), 'f'.repeat(40)), /Nie ma już tej skórki/);
  // Bad files never reach the network.
  const n = fetchFn.calls.length;
  await assert.rejects(skins.upload(auth(), { png: png(100, 100) }), /musi mieć 64×64/);
  await assert.rejects(skins.upload(auth(), { png: Buffer.from('nope'.repeat(20)) }), /To nie jest plik PNG/);
  assert.equal(fetchFn.calls.length, n);
  assert.equal((await skins.upload(auth(), { png: png(64, 32, 3), variant: 'dziwny', name: '' })).library[0].name, 'Skórka', 'an unknown model is classic, no name gets a default');
  assert.equal(fetchFn.calls.filter((c) => c.method === 'POST').at(-1).body.get('variant'), 'classic');
});

test('reset to the default skin, show and hide capes', async () => {
  const fetchFn = fakeMojang();
  const skins = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn });
  await skins.state(auth());
  const reset = await skins.reset(auth());
  assert.deepEqual(fetchFn.calls.at(-1), { url: 'https://api.minecraftservices.com/minecraft/profile/skins/active', method: 'DELETE', auth: 'Bearer token-1', body: undefined });
  assert.equal(reset.skin, null);
  assert.deepEqual(reset.library.map((s) => s.active), [false], 'the old skin stays in the library');
  const shown = await skins.setCape(auth(), 'cape-vanilla');
  const put = fetchFn.calls.at(-1);
  assert.deepEqual([put.method, put.url, put.body], ['PUT', 'https://api.minecraftservices.com/minecraft/profile/capes/active', '{"capeId":"cape-vanilla"}']);
  assert.deepEqual(shown.capes.map((c) => [c.name, c.active]), [['Migrator', false], ['Vanilla', true]]);
  const hidden = await skins.setCape(auth(), null);
  assert.deepEqual([fetchFn.calls.at(-1).method, fetchFn.calls.at(-1).url], ['DELETE', 'https://api.minecraftservices.com/minecraft/profile/capes/active']);
  assert.deepEqual(hidden.capes.map((c) => c.active), [false, false]);
  await assert.rejects(skins.setCape(auth(), 'nie-ma-takiej'), /odrzucił tę zmianę/);
  await assert.rejects(skins.setCape(auth(), '../x'), /Nieznana peleryna/);
  // An answer without a body (204) → the profile is asked for again.
  fetchFn.silent = true;
  const n = fetchFn.calls.length;
  assert.deepEqual((await skins.setCape(auth(), 'cape-migrator')).capes.map((c) => c.active), [true, false]);
  assert.deepEqual(fetchFn.calls.slice(n).map((c) => c.method), ['PUT', 'GET']);
});

test('401: the token is refreshed once, then a clear request to sign in again', async () => {
  // The stored token is stale, a fresh one works.
  const fetchFn = fakeMojang({ tokens: ['token-fresh'] });
  const forced = [];
  const skins = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn });
  const state = await skins.state(auth('token-old', forced));
  assert.equal(state.account.name, 'Gracz');
  assert.deepEqual(forced, [false, true]);
  assert.deepEqual(fetchFn.calls.filter((c) => c.url.includes('minecraftservices')).map((c) => c.auth), ['Bearer token-old', 'Bearer token-fresh']);
  // Nothing works → Polish, and says what to do.
  const closed = fakeMojang({ tokens: [] });
  const none = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn: closed });
  await assert.rejects(none.state(auth()), /Sesja konta Microsoft wygasła – zaloguj się ponownie \(Ustawienia → Konta Microsoft\)/);
  await assert.rejects(none.upload(auth(), { png: png() }), /zaloguj się ponownie/);
  await assert.rejects(none.reset(auth()), /zaloguj się ponownie/);
  await assert.rejects(none.setCape(auth(), 'cape-vanilla'), /zaloguj się ponownie/);
  assert.equal(closed.calls.filter((c) => c.method === 'POST').length, 2, 'one retry, not a loop');
  // The launcher could not refresh the session at all: its own message goes to the window.
  await assert.rejects(skins.state(async () => Promise.reject(new Error('Sesja konta Gracz wygasła – zaloguj się ponownie w zakładce Konta.'))), /Sesja konta Gracz wygasła/);
});

test('other refusals and no connection are explained in Polish', async () => {
  const fetchFn = fakeMojang();
  const skins = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn });
  for (const [status, text] of [[429, /Za dużo zmian w krótkim czasie/], [500, /chwilowe problemy \(błąd 500\)/], [503, /chwilowe problemy/], [403, /Mojang nie pozwala/], [404, /nie ma profilu Minecraft: Java Edition/], [418, /błędem 418/]]) {
    fetchFn.status = status;
    await assert.rejects(skins.state(auth()), text);
  }
  fetchFn.status = 400;
  await assert.rejects(skins.upload(auth(), { png: png() }), /odrzucił tę skórkę/);
  const down = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn: async () => Promise.reject(new TypeError('fetch failed')) });
  await assert.rejects(down.state(auth()), /Brak połączenia z serwerami Minecrafta/);
});

test('the library: forget, at most a couple of dozen skins, files that vanished are dropped', async () => {
  const fetchFn = fakeMojang({ skinUrl: null });
  let clock = 0;
  const dir = path.join(tmpDir(), 'skins');
  const skins = createSkins({ dir, fetchFn, now: () => (clock += 1) });
  for (let i = 0; i < MAX_LIBRARY + 3; i += 1) await skins.upload(auth(), { png: png(64, 64, 10 + i), name: `Skórka ${i}` });
  const list = skins.library();
  assert.equal(list.length, MAX_LIBRARY);
  assert.equal(list[0].name, `Skórka ${MAX_LIBRARY + 2}`, 'newest first');
  assert.ok(!list.some((s) => s.name === 'Skórka 0'), 'the oldest made room');
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length, MAX_LIBRARY);
  const left = skins.forget(list[0].id);
  assert.equal(left.length, MAX_LIBRARY - 1);
  assert.ok(!fs.existsSync(path.join(dir, `${list[0].id}.png`)));
  assert.equal(skins.forget('../../settings').length, MAX_LIBRARY - 1, 'only ids of the library are touched');
  fs.rmSync(path.join(dir, `${left[0].id}.png`));
  assert.equal(skins.library().length, MAX_LIBRARY - 2);
  fs.writeFileSync(path.join(dir, 'library.json'), '{ broken');
  assert.deepEqual(skins.library(), []);
  assert.deepEqual(skins.inspect(png(64, 32), 'stara.png'), { name: 'stara', dataUrl: `data:image/png;base64,${png(64, 32).toString('base64')}`, legacy: true });
  assert.throws(() => skins.inspect(Buffer.from('x'.repeat(50))), /To nie jest plik PNG/);
});

test('services: the Skórka tab uses the selected account, refreshes a refused token and updates the head', async () => {
  class FakeAuth {
    async launch() {
      return FakeAuth.xbox('refresh-1', 'token-stale');
    }
    async refresh() {
      FakeAuth.refreshed += 1;
      return FakeAuth.xbox('refresh-2', 'token-fresh');
    }
    static xbox(refresh, mcToken) {
      return { save: () => refresh, getMinecraft: async () => ({ mcToken, exp: Date.now() + 3600e3, profile: { id: 'uuid-1', name: 'Gracz', skins: [] } }) };
    }
  }
  FakeAuth.refreshed = 0;
  let key = null;
  const root = tmpDir();
  const accounts = createAccounts({ file: path.join(root, 'accounts.json'), crypt: createCrypt({ keyFile: 'k', readKey: () => key, writeKey: (f, k) => (key = k) }), AuthClass: FakeAuth });
  const fetchFn = fakeMojang({ tokens: ['token-fresh'] });
  const services = createServices({ root, config: {}, accounts, fetchFn });
  await assert.rejects(services.skins.get(), /Zaloguj się kontem Microsoft/);
  const account = await accounts.login();
  services.settings.set({ selectedAccount: account.id });
  assert.equal(accounts.list()[0].skinUrl, null);
  const state = await services.skins.get();
  assert.equal(FakeAuth.refreshed, 1, 'the stale token was refreshed once');
  assert.equal(state.skin.url, accounts.list()[0].skinUrl, 'the account in the launcher shows the skin from the profile');
  const changed = await services.skins.upload({ png: png(64, 64, 9), variant: 'slim', name: 'Nowa' });
  assert.deepEqual([accounts.list()[0].skinUrl, accounts.list()[0].skinVariant], [changed.skin.url, 'SLIM']);
  assert.equal(FakeAuth.refreshed, 1, 'the fresh token is reused');
  assert.equal((await services.skins.reset()).skin, null);
  assert.deepEqual([accounts.list()[0].skinUrl, accounts.list()[0].skinVariant], [null, 'CLASSIC']);
  assert.equal((await services.skins.use(changed.library[0].id)).skin.variant, 'slim');
  assert.deepEqual((await services.skins.cape('cape-vanilla')).capes.map((c) => c.active), [false, true]);
  assert.deepEqual((await services.skins.cape()).capes.map((c) => c.active), [false, false]);
  assert.equal(services.skins.forget(changed.library[0].id).length, 1);
  assert.ok(fs.existsSync(path.join(root, 'skins', 'library.json')), 'the library lives in the launcher folder');
  assert.ok(!fs.readFileSync(path.join(root, 'accounts.json'), 'utf8').includes('token-fresh'), 'tokens stay encrypted');
});

test('the library limit: 24 skins, 200 with Hammer+ – and a big library is not cut down when Hammer+ ends', async () => {
  const fetchFn = fakeMojang({ skinUrl: null });
  let clock = 0;
  let plus = true;
  const dir = path.join(tmpDir(), 'skins');
  const skins = createSkins({ dir, fetchFn, now: () => (clock += 1), limit: () => (plus ? PLUS_LIBRARY : MAX_LIBRARY) });
  assert.deepEqual([MAX_LIBRARY, PLUS_LIBRARY], [24, 200]);
  for (let i = 0; i < 30; i += 1) await skins.upload(auth(), { png: png(64, 64, 10 + i), name: `Skórka ${i}` });
  assert.equal(skins.library().length, 30, 'more than the free limit');
  assert.equal((await skins.state(auth())).limit, 200);
  // Hammer+ ends: nothing is thrown away at once; a new skin pushes out exactly one old one.
  plus = false;
  const after = await skins.upload(auth(), { png: png(64, 64, 99), name: 'Nowa' });
  assert.deepEqual([after.library.length, after.limit, after.library[0].name], [30, 24, 'Nowa']);
  assert.ok(!after.library.some((x) => x.name === 'Skórka 0'));
  assert.ok(after.library.some((x) => x.name === 'Skórka 1'));
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.png')).length, 30);
});

test('Zestawy: a named look = skin + model + cape, put on with one click through the usual calls', async () => {
  const fetchFn = fakeMojang();
  let clock = 1_000;
  const dir = path.join(tmpDir(), 'skins');
  const skins = createSkins({ dir, fetchFn, now: () => (clock += 1000) });
  const start = await skins.state(auth());
  assert.deepEqual(start.outfits, []);
  const knight = (await skins.upload(auth(), { png: png(64, 64, 7), variant: 'slim', name: 'Rycerz' })).library[0];
  const account = start.library[0];

  const saved = skins.saveOutfit({ name: '  Na PvP ', skin: knight.id, variant: 'slim', cape: 'cape-vanilla', capeName: 'Vanilla' });
  assert.deepEqual(saved.map((o) => [o.name, o.skin, o.skinName, o.variant, o.cape, o.capeName, o.dataUrl === knight.dataUrl]), [['Na PvP', knight.id, 'Rycerz', 'slim', 'cape-vanilla', 'Vanilla', true]]);
  assert.match(saved[0].id, /^[0-9a-f]{12}$/);
  skins.saveOutfit({ name: 'Na co dzień', skin: account.id, variant: 'classic', cape: null });
  assert.deepEqual(skins.outfits().map((o) => [o.name, o.cape, o.capeName]), [['Na co dzień', null, null], ['Na PvP', 'cape-vanilla', 'Vanilla']], 'the newest first');
  assert.throws(() => skins.saveOutfit({ name: '', skin: knight.id }), /Podaj nazwę zestawu/);
  assert.throws(() => skins.saveOutfit({ name: 'na pvp', skin: knight.id }), /Masz już zestaw „na pvp”/);
  assert.throws(() => skins.saveOutfit({ name: 'X', skin: 'f'.repeat(40) }), /Nie ma już tej skórki w bibliotece/);
  assert.throws(() => skins.saveOutfit({ name: 'X', skin: knight.id, cape: '../x' }), /Nieznana peleryna/);
  assert.equal(skins.saveOutfit({ name: 'Domyślny model', skin: knight.id }).find((o) => o.name === 'Domyślny model').variant, 'slim', 'the model the skin has in the library');

  // The account wears the knight with the Migrator cape. "Na co dzień" = the account skin, classic, no cape.
  const [daily, pvp] = [skins.outfits().find((o) => o.name === 'Na co dzień'), skins.outfits().find((o) => o.name === 'Na PvP')];
  let n = fetchFn.calls.length;
  const worn = await skins.applyOutfit(auth(), daily.id);
  const sent = () => fetchFn.calls.slice(n).filter((c) => c.url.includes('minecraftservices')).map((c) => `${c.method} ${c.url.split('/profile')[1]}`);
  assert.deepEqual(sent(), ['GET ', 'POST /skins', 'DELETE /capes/active'], 'the profile is looked at, then the skin and the cape are changed');
  assert.deepEqual([worn.skin.libraryId, worn.skin.variant, worn.capes.map((c) => c.active), worn.warning], [account.id, 'classic', [false, false], undefined]);
  assert.equal(fetchFn.calls.filter((c) => c.method === 'POST').at(-1).body.get('variant'), 'classic');
  // The same outfit again: nothing differs, so nothing is sent (Mojang limits how often a skin may change).
  n = fetchFn.calls.length;
  await skins.applyOutfit(auth(), daily.id);
  assert.deepEqual(sent(), ['GET ']);
  // The other one: skin, model and cape.
  n = fetchFn.calls.length;
  const fight = await skins.applyOutfit(auth(), pvp.id);
  assert.deepEqual(sent(), ['GET ', 'POST /skins', 'PUT /capes/active']);
  assert.deepEqual([fight.skin.libraryId, fight.skin.variant, fight.capes.map((c) => [c.id, c.active])], [knight.id, 'slim', [['cape-migrator', false], ['cape-vanilla', true]]]);
  assert.equal(fight.outfits.length, 3, 'the state carries the outfits');
  // Only the cape differs → only the cape call.
  skins.saveOutfit({ name: 'PvP z Migratorem', skin: knight.id, variant: 'slim', cape: 'cape-migrator' });
  n = fetchFn.calls.length;
  await skins.applyOutfit(auth(), skins.outfits().find((o) => o.name === 'PvP z Migratorem').id);
  assert.deepEqual(sent(), ['GET ', 'PUT /capes/active']);

  // The account lost a cape: the skin still goes on and the player is told about the cape.
  skins.saveOutfit({ name: 'Ze starą peleryną', skin: account.id, cape: 'cape-oddana' });
  const partly = await skins.applyOutfit(auth(), skins.outfits().find((o) => o.name === 'Ze starą peleryną').id);
  assert.equal(partly.skin.libraryId, account.id);
  assert.match(partly.warning, /Skórka z zestawu jest założona, ale peleryny nie udało się zmienić: Serwer Minecrafta odrzucił tę zmianę/);
  await assert.rejects(skins.applyOutfit(auth(), 'nie-ma'), /Nie ma już takiego zestawu/);

  // Removing an outfit keeps the skin; removing a skin takes its outfits with it.
  assert.equal(skins.removeOutfit(pvp.id).length, 4);
  assert.equal(skins.removeOutfit('nie-ma').length, 4);
  assert.equal(skins.library().length, 2);
  skins.forget(knight.id);
  assert.deepEqual(skins.outfits().map((o) => o.name).sort(), ['Na co dzień', 'Ze starą peleryną']);
  fs.writeFileSync(path.join(dir, 'outfits.json'), '{ broken');
  assert.deepEqual(skins.outfits(), []);
  assert.equal(MAX_OUTFITS, 50);
});

test('Zestawy: a skin that belongs to an outfit is never the one pushed out of a full library', async () => {
  const fetchFn = fakeMojang({ skinUrl: null });
  let clock = 0;
  const skins = createSkins({ dir: path.join(tmpDir(), 'skins'), fetchFn, now: () => (clock += 1), limit: () => 3 });
  const oldest = (await skins.upload(auth(), { png: png(64, 64, 1), name: 'W zestawie' })).library[0];
  skins.saveOutfit({ name: 'Ulubiony', skin: oldest.id });
  for (let i = 2; i <= 5; i += 1) await skins.upload(auth(), { png: png(64, 64, i), name: `Skórka ${i}` });
  assert.deepEqual(skins.library().map((x) => x.name), ['Skórka 5', 'Skórka 4', 'W zestawie']);
  assert.equal(skins.outfits().length, 1);
});

test('services: Zestawy and the bigger library need Hammer+ – removing an outfit does not', async () => {
  const mc = 'ab'.repeat(16); // a code is tied to a real Minecraft UUID
  class FakeAuth {
    async launch() {
      return FakeAuth.xbox();
    }
    async refresh() {
      return FakeAuth.xbox();
    }
    static xbox() {
      return { save: () => 'refresh', getMinecraft: async () => ({ mcToken: 'token-1', exp: Date.now() + 3600e3, profile: { id: mc, name: 'Gracz', skins: [] } }) };
    }
  }
  let key = null;
  const root = tmpDir();
  const keys = plusKeys();
  const accounts = createAccounts({ file: path.join(root, 'accounts.json'), crypt: createCrypt({ keyFile: 'k', readKey: () => key, writeKey: (f, k) => (key = k) }), AuthClass: FakeAuth });
  const fetchFn = fakeMojang();
  fetchFn.profile.id = mc;
  const services = createServices({ root, config: { plusPublicKey: keys.publicKey }, accounts, fetchFn });
  const account = await accounts.login();
  services.settings.set({ selectedAccount: account.id });
  const state = await services.skins.get();
  assert.deepEqual([state.limit, state.outfits], [24, []]);
  assert.throws(() => services.skins.saveOutfit({ name: 'Na PvP', skin: state.library[0].id }), /Zestawy skórek to funkcja Hammer\+/);

  services.plus.activate(keys.code({ mc }));
  assert.equal((await services.skins.get()).limit, 200);
  const [outfit] = services.skins.saveOutfit({ name: 'Na PvP', skin: state.library[0].id, variant: 'slim', cape: 'cape-vanilla', capeName: 'Vanilla' });
  const worn = await services.skins.applyOutfit(outfit.id);
  assert.deepEqual([worn.skin.variant, worn.capes.map((c) => c.active), worn.outfits.length], ['slim', [false, true], 1]);
  assert.equal(accounts.list()[0].skinVariant, 'SLIM', 'the head in the launcher follows the outfit');
  assert.ok(fs.existsSync(path.join(root, 'skins', 'outfits.json')));

  // Hammer+ ends: the outfits stay listed, putting one on is locked, removing still works.
  services.plus.remove();
  assert.equal((await services.skins.get()).outfits.length, 1);
  assert.throws(() => services.skins.applyOutfit(outfit.id), /Zestawy skórek to funkcja Hammer\+/);
  assert.deepEqual(services.skins.removeOutfit(outfit.id), []);
});
