'use strict';

// Dodatki na postać (Hammer+): wings, a halo and a hat for Hammer Client – next to the capes, and the moving capes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createServices } = require('../src/main/services');
const { loadCosmetics, cleanLook, idsOf } = require('../src/main/cosmetics');
const { loadCapes } = require('../src/main/capes');
const { sanitize, plusOnly } = require('../src/main/settings');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
const BASE = 'https://hammerclient.com/api/launcher';
const NONE = { wings: '', halo: false, hat: '' };

function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

/** The shop's PUT /cape – the bodies it was sent. */
function fakeShop() {
  const shop = { calls: [] };
  shop.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    shop.calls.push({ url: String(url), method: init.method ?? 'GET', code: init.headers?.authorization ?? null, body });
    if (String(url) === `${BASE}/cape`) return new Response(JSON.stringify({ cape: body.cape, ...(body.cosmetics !== undefined && { cosmetics: body.cosmetics }) }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ error: 'nie ma' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  shop.capeCalls = () => shop.calls.filter((c) => c.url === `${BASE}/cape`);
  shop.last = () => shop.capeCalls().at(-1);
  return shop;
}

function setup({ plus = false } = {}) {
  const keys = plusKeys();
  const shop = fakeShop();
  const clientDir = tmpDir('hc');
  fs.writeFileSync(path.join(clientDir, 'versions.json'), JSON.stringify({ version: '2.4.0', jars: [{ file: 'hammer-client-1.21.1.jar', minecraft: ['1.21.1'] }] }));
  fs.writeFileSync(path.join(clientDir, 'hammer-client-1.21.1.jar'), 'jar');
  let child = null;
  const s = createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', website: 'https://hammerclient.com', plusPublicKey: keys.publicKey, server: { address: '' } },
    accounts: { list: () => [GRACZ], launchAuth: async () => ({ ...GRACZ, accessToken: 'token-minecrafta' }) },
    fetchFn: shop.fetch,
    clientDir,
    prepareFn: async () => ({ versionId: 'fabric-loader-0.16.10-1.21.1', javaPath: '/java/bin/java', javaMajor: 21 }),
    launchFn: async () => (child = fakeChild()),
  });
  const code = keys.code({ mc: GRACZ.id });
  if (plus) s.plus.activate(code);
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  fs.writeFileSync(path.join(instance.dir, 'mods', 'fabric-api-0.110.jar'), 'api');
  const launcherFile = () => JSON.parse(fs.readFileSync(path.join(instance.dir, 'config', 'hammerclient-launcher.json'), 'utf8'));
  const play = async () => {
    await s.launch(instance.id);
    child.emit('exit', 0, null);
    await s.afterSessions();
  };
  return { s, shop, code, launcherFile, play };
}

const look = (state) => ({ wings: state.wings, halo: state.halo, hat: state.hat });

test('the list: wings, a halo and hats from cosmetics.json – the pictures for the tiles and the skin preview are there', () => {
  const list = loadCosmetics();
  assert.deepEqual(list.map((c) => [c.id, c.slot]), [['angel', 'wings'], ['dragon', 'wings'], ['halo', 'halo'], ['crown', 'hat'], ['tophat', 'hat'], ['santa', 'hat']]);
  assert.deepEqual(list.map((c) => c.name), ['Anielskie', 'Smocze', 'Aureola', 'Korona', 'Cylinder', 'Czapka Mikołaja']);
  const dir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'cosmetics');
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'cosmetics.json'), 'utf8'));
  for (const c of raw) {
    for (const view of ['front', 'back']) {
      assert.ok(fs.existsSync(path.join(dir, `${c.id}-${view}.png`)), `${c.id}-${view}.png`);
      const place = c[view];
      assert.ok(place && [place.x, place.y, place.w, place.h].every(Number.isFinite), `${c.id} ${view}: where it goes on the figure`);
      // the skin preview has 8 skin pixels of room above the head and one on each side
      assert.ok(place.x >= -1 && place.x + place.w <= 17 && place.y >= -9, `${c.id} ${view} fits the preview`);
    }
  }
  assert.deepEqual([...idsOf('hat')], ['crown', 'tophat', 'santa']);
  assert.deepEqual(cleanLook({ wings: 'crown', halo: 'yes', hat: 'santa' }), { wings: '', halo: false, hat: 'santa' }, 'only ids of the right slot');
  assert.deepEqual(loadCosmetics(path.join(dir, 'nie-ma.json')), []);
  // The moving capes are in the cape list – strips of 16 frames, 10 per second, Hammer+.
  const moving = loadCapes().filter((c) => c.frames);
  assert.deepEqual(moving, [{ id: 'flame', name: 'Płomień', free: false, frames: 16, fps: 10 }, { id: 'sparks', name: 'Iskry', free: false, frames: 16, fps: 10 }, { id: 'waves', name: 'Fale', free: false, frames: 16, fps: 10 }]);
});

test('settings: the cosmetics are Hammer+ (only switching them on) and only ids that exist are kept', () => {
  const base = sanitize({});
  assert.deepEqual([base.cosmeticWings, base.cosmeticHalo, base.cosmeticHat], ['', false, '']);
  const next = sanitize({ cosmeticWings: 'dragon', cosmeticHalo: 1, cosmeticHat: 'tophat' }, base);
  assert.deepEqual([next.cosmeticWings, next.cosmeticHalo, next.cosmeticHat], ['dragon', true, 'tophat']);
  assert.deepEqual(plusOnly(base, next), ['Dodatki na postać', 'Dodatki na postać', 'Dodatki na postać']);
  assert.deepEqual(plusOnly(next, base), [], 'taking them off never needs Hammer+');
  const wrong = sanitize({ cosmeticWings: 'santa', cosmeticHat: '../x', cosmeticHalo: false }, next);
  assert.deepEqual([wrong.cosmeticWings, wrong.cosmeticHalo, wrong.cosmeticHat], ['dragon', false, 'tophat']);
});

test('without Hammer+: the Dodatki are visible but locked – putting one on is refused, nothing reaches the game or the shop', async () => {
  const { s, shop, play, launcherFile } = setup();
  const state = s.plus.cosmetics();
  assert.equal(state.plus, false);
  assert.equal(state.items.length, 6);
  assert.deepEqual(look(state), NONE);
  await assert.rejects(s.plus.setCosmetic('wings', 'angel'), /Dodatki na postać/);
  await assert.rejects(s.plus.setCosmetic('halo', true), /Dodatki na postać/);
  await assert.rejects(s.plus.setCape('flame'), /Peleryny Hammer\+/, 'moving capes are Hammer+ too');
  assert.deepEqual(look(await s.plus.setCosmetic('hat', '')), NONE, 'taking one off always works');
  await play();
  assert.equal(launcherFile().cosmetics, undefined, 'the file stays as it was');
  assert.ok(shop.capeCalls().every((c) => c.body.cosmetics === undefined));
});

test('with Hammer+: one per slot – the game draws them, the shop shows them to others together with the cape', async () => {
  const { s, shop, code, play, launcherFile } = setup({ plus: true });
  await s.plus.setCape('flame');
  assert.deepEqual(shop.last().body, { cape: 'flame' }, 'without cosmetics the shop hears what it always did');
  assert.equal(shop.last().code, `Bearer ${code}`);

  let res = await s.plus.setCosmetic('wings', 'angel');
  assert.deepEqual([look(res), res.plus, res.shared], [{ wings: 'angel', halo: false, hat: '' }, true, true]);
  assert.deepEqual(shop.last().body, { cape: 'flame', cosmetics: { wings: 'angel', halo: false, hat: null } });
  await s.plus.setCosmetic('halo', true);
  await s.plus.setCosmetic('hat', 'crown');
  res = await s.plus.setCosmetic('hat', 'tophat');
  assert.deepEqual(look(res), { wings: 'angel', halo: true, hat: 'tophat' }, 'a new hat replaces the old one');
  assert.deepEqual(shop.last().body, { cape: 'flame', cosmetics: { wings: 'angel', halo: true, hat: 'tophat' } });
  const n = shop.capeCalls().length;
  await s.plus.setCosmetic('hat', 'tophat');
  assert.equal(shop.capeCalls().length, n, 'the shop is not told twice');

  await assert.rejects(s.plus.setCosmetic('hat', 'angel'), /Nie ma takiego dodatku/);
  await assert.rejects(s.plus.setCosmetic('cape', 'flame'), /Nie ma takiego miejsca/);
  await play();
  assert.deepEqual(launcherFile().cosmetics, { wings: 'angel', halo: true, hat: 'tophat' });
  assert.equal(launcherFile().cape, 'flame');

  // All off: the shop is told once (null), then the request is the old one again.
  await s.plus.setCosmetic('wings', null);
  await s.plus.setCosmetic('halo', false);
  await s.plus.setCosmetic('hat', '');
  assert.deepEqual(shop.last().body, { cape: 'flame', cosmetics: null });
  await s.plus.setCape('waves');
  assert.deepEqual(shop.last().body, { cape: 'waves' });
  await play();
  assert.equal(launcherFile().cosmetics, undefined);
});

test('when Hammer+ ends the cosmetics and the moving cape count as none – the choice comes back with the next code', async () => {
  const { s, code, play, launcherFile } = setup({ plus: true });
  await s.plus.setCape('sparks');
  await s.plus.setCosmetic('wings', 'dragon');
  await s.plus.setCosmetic('hat', 'santa');
  s.plus.remove();
  assert.deepEqual([look(s.plus.cosmetics()), s.plus.cosmetics().plus], [NONE, false]);
  assert.equal(s.plus.capes().selected, '');
  await play();
  assert.deepEqual([launcherFile().cape, launcherFile().cosmetics], ['', undefined]);
  assert.deepEqual([s.settings.get().cosmeticWings, s.settings.get().cosmeticHat], ['dragon', 'santa'], 'kept for later');
  s.plus.activate(code);
  assert.deepEqual(look(s.plus.cosmetics()), { wings: 'dragon', halo: false, hat: 'santa' });
  await play();
  assert.deepEqual([launcherFile().cape, launcherFile().cosmetics], ['sparks', { wings: 'dragon', halo: false, hat: 'santa' }]);
});
