'use strict';

// Peleryny: two Hammer capes for everybody, the rest and one's own picture with Hammer+, and the on/off switch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { createServices } = require('../src/main/services');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
const BASE = 'https://hammerclient.com/api/launcher';

/** A real (tiny) PNG of the given size. */
function png(width, height) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(64))), chunk('IEND', Buffer.alloc(0))]);
}

function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

/** The shop's PUT /cape – it records how the account proved itself (Hammer+ code or Minecraft sign-in). */
function fakeShop() {
  const shop = { calls: [] };
  shop.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    shop.calls.push({ url: String(url), method: init.method ?? 'GET', code: init.headers?.authorization ?? null, minecraft: init.headers?.['x-minecraft-token'] ?? null, body });
    if (String(url) === `${BASE}/cape`) return new Response(JSON.stringify({ cape: body.cape }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ error: 'nie ma' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  shop.last = () => shop.calls.filter((c) => c.url === `${BASE}/cape`).at(-1);
  return shop;
}

function setup({ plus = false } = {}) {
  const keys = plusKeys();
  const shop = fakeShop();
  const clientDir = tmpDir('hc');
  fs.writeFileSync(path.join(clientDir, 'versions.json'), JSON.stringify({ version: '2.3.1', jars: [{ file: 'hammer-client-1.21.1.jar', minecraft: ['1.21.1'] }] }));
  fs.writeFileSync(path.join(clientDir, 'hammer-client-1.21.1.jar'), 'jar');
  let file = null;
  let child = null;
  const s = createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', website: 'https://hammerclient.com', plusPublicKey: keys.publicKey, server: { address: '' } },
    accounts: { list: () => [GRACZ], launchAuth: async () => ({ ...GRACZ, accessToken: 'token-minecrafta' }) },
    fetchFn: shop.fetch,
    clientDir,
    pickFile: async () => file,
    prepareFn: async () => ({ versionId: 'fabric-loader-0.16.10-1.21.1', javaPath: '/java/bin/java', javaMajor: 21 }),
    launchFn: async () => (child = fakeChild()),
  });
  const code = keys.code({ mc: GRACZ.id });
  if (plus) s.plus.activate(code);
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  fs.writeFileSync(path.join(instance.dir, 'mods', 'fabric-api-0.110.jar'), 'api');
  const pick = (buf) => {
    file = buf ? path.join(tmpDir('pic'), 'peleryna.png') : null;
    if (buf) fs.writeFileSync(file, buf);
  };
  const launcherFile = () => JSON.parse(fs.readFileSync(path.join(instance.dir, 'config', 'hammerclient-launcher.json'), 'utf8'));
  const capePng = path.join(instance.dir, 'config', 'hammerclient', 'cape.png');
  /** One start of the game – it is closed again right away. */
  const play = async () => {
    await s.launch(instance.id);
    child.emit('exit', 0, null);
    await s.afterSessions();
  };
  return { s, shop, instance, code, pick, launcherFile, capePng, play };
}

test('without Hammer+: Hammer and Żar are for everybody – shown to others through the account\'s own Minecraft sign-in', async () => {
  const { s, shop, play, launcherFile } = setup();
  const state = s.plus.capes();
  assert.equal(state.plus, false);
  assert.deepEqual(state.capes.filter((c) => c.free).map((c) => c.id), ['hammer', 'ember']);
  const res = await s.plus.setCape('ember');
  assert.deepEqual([res.selected, res.on, res.shared], ['ember', true, true]);
  assert.deepEqual([shop.last().method, shop.last().code, shop.last().minecraft, shop.last().body], ['PUT', null, 'token-minecrafta', { cape: 'ember' }]);
  // The others and one's own picture are Hammer+.
  await assert.rejects(s.plus.setCape('gold'), /Peleryny Hammer\+/);
  await assert.rejects(s.plus.pickCape(), /Własna peleryna/);
  // The game draws it.
  await play();
  assert.equal(launcherFile().cape, 'ember');
});

test('the switch: off – no cape in the game and none for others; on – the same one again (and the Mojang cape to bring back)', async () => {
  const { s, shop, play, launcherFile } = setup({ plus: true });
  await s.plus.setCape('frost');
  const off = await s.plus.setCapeOn(false, 'migrator');
  assert.deepEqual([off.on, off.selected, off.lastMojang], [false, 'frost', 'migrator'], 'the choice is kept');
  assert.equal(shop.last().body.cape, null, 'others no longer see it');
  await play();
  assert.equal(launcherFile().cape, '');
  const on = await s.plus.setCapeOn(true);
  assert.deepEqual([on.on, on.selected, on.lastMojang], [true, 'frost', 'migrator']);
  assert.equal(shop.last().body.cape, 'frost');
  // Picking a cape while it is off turns it on.
  await s.plus.setCapeOn(false, '');
  assert.equal((await s.plus.setCape('gold')).on, true);
});

test('one\'s own cape (Hammer+): only the cape layout, at most 512 KB – it goes into the game, nobody else is sent it', async () => {
  const { s, shop, play, pick, launcherFile, capePng } = setup({ plus: true });
  assert.equal((await s.plus.setCape('hammer')).selected, 'hammer');
  await assert.rejects(s.plus.setCape('custom'), /Najpierw wgraj własną pelerynę/);
  pick(null);
  assert.equal(await s.plus.pickCape(), null, 'the dialog was cancelled');
  pick(png(64, 64));
  await assert.rejects(s.plus.pickCape(), /układ peleryny Minecrafta.*64×64/);
  pick(png(100, 50));
  await assert.rejects(s.plus.pickCape(), /100×50/);
  pick(Buffer.from('to nie jest obrazek'));
  await assert.rejects(s.plus.pickCape(), /To nie jest obraz PNG/);
  pick(Buffer.concat([png(64, 32), Buffer.alloc(600 * 1024)]));
  await assert.rejects(s.plus.pickCape(), /za duży/);

  const picture = png(128, 64);
  pick(picture);
  const res = await s.plus.pickCape();
  assert.deepEqual([res.selected, res.on], ['custom', true]);
  assert.match(res.custom, /^data:image\/png;base64,/);
  assert.match(res.note, /widzisz tylko Ty/);
  assert.equal(shop.last().body.cape, null, 'the picture itself never leaves the computer');
  await play();
  assert.equal(launcherFile().cape, 'custom');
  assert.ok(fs.readFileSync(capePng).equals(picture), 'the game gets config/hammerclient/cape.png');
  // Another cape: the picture leaves the instance at the next start.
  await s.plus.setCape('royal');
  await play();
  assert.equal(fs.existsSync(capePng), false);
  assert.equal(launcherFile().cape, 'royal');
  // Removing it is always possible; without Hammer+ it cannot be worn.
  await s.plus.setCape('custom');
  const gone = await s.plus.removeCape();
  assert.deepEqual([gone.custom, gone.selected], [null, '']);
  pick(picture);
  await s.plus.pickCape();
  s.plus.remove();
  assert.equal(s.plus.capes().selected, '', 'without Hammer+ one\'s own cape counts as none');
  await play();
  assert.equal(launcherFile().cape, '');
  assert.equal(fs.existsSync(capePng), false);
});
