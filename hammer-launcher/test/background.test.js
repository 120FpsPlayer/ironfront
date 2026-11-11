'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { fileURLToPath } = require('node:url');
const { createBackgrounds, createMenuBackground, imageType, pngSize, MENU } = require('../src/main/background');
const { createServices } = require('../src/main/services');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };

function crc32(data) {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

/** A PNG file with the given size in its header (a few pixels are enough for these tests); `seed` changes content and length. */
function png(width, height, seed = 0) {
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
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(64, seed))), chunk('tEXt', Buffer.alloc(seed % 250, 0x41)), chunk('IEND', Buffer.alloc(0))]);
}
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 3)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 5)]);

/** Writes `data` as a file the player could pick. */
function picked(name, data) {
  const file = path.join(tmpDir(), name);
  fs.writeFileSync(file, data);
  return file;
}

/** What Electron's nativeImage does in main.js: any picture in, a PNG that fits the box out (proportions kept). */
const fakeConvert = (sizeOf) => (data, { maxWidth, maxHeight }) => {
  const { width, height } = sizeOf(data);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return png(Math.floor(width * scale), Math.floor(height * scale), data.length % 250);
};

test('pictures are recognised by their first bytes, not by the file name', () => {
  assert.deepEqual([imageType(png(4, 4)), imageType(JPG), imageType(WEBP)], ['png', 'jpg', 'webp']);
  for (const junk of [Buffer.from('GIF89a' + 'x'.repeat(30)), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(4), 'tekst', null]) assert.equal(imageType(junk), null);
  assert.deepEqual([pngSize(png(1920, 1080)), pngSize(JPG), pngSize(Buffer.alloc(8))], [{ width: 1920, height: 1080 }, null, null]);
});

test('launcher background: the picked picture is copied into the launcher folder; one at a time', () => {
  const dir = path.join(tmpDir(), 'theme');
  const backgrounds = createBackgrounds({ dir });
  assert.equal(backgrounds.url('background-0a1b2c3d.png'), null, 'nothing stored yet');
  const first = backgrounds.store(picked('wakacje.PNG', png(800, 600, 1)));
  assert.match(first, /^background-[0-9a-f]{8}\.png$/);
  assert.equal(fileURLToPath(backgrounds.url(first)), path.join(dir, first));
  const second = backgrounds.store(picked('zrzut.png', JPG)); // a JPEG with the wrong ending
  assert.match(second, /^background-[0-9a-f]{8}\.jpg$/);
  assert.deepEqual(fs.readdirSync(dir), [second], 'the one before is removed');
  assert.match(backgrounds.store(picked('a.webp', WEBP)), /\.webp$/);
  // What is not a picture never gets in – and names from the window never leave the folder.
  assert.throws(() => backgrounds.store(picked('wirus.png', Buffer.from('MZ' + 'x'.repeat(100)))), /To nie jest obraz PNG, JPG ani WebP/);
  assert.throws(() => backgrounds.store(path.join(dir, 'nie-ma.png')), /Nie udało się otworzyć tego pliku/);
  assert.throws(() => backgrounds.store(dir), /Nie udało się otworzyć tego pliku/);
  assert.throws(() => backgrounds.store(picked('wielki.png', Buffer.concat([png(10, 10), Buffer.alloc(12 * 1024 * 1024)]))), /za duży – wybierz plik do 12 MB/);
  for (const name of ['../../settings.json', 'background-zzzzzzzz.png', 'accounts.json', '', null]) assert.equal(backgrounds.url(name), null);
  backgrounds.clear();
  assert.deepEqual(fs.readdirSync(dir), []);
  createBackgrounds({ dir: path.join(dir, 'brak') }).clear(); // a folder that is not there is fine
});

test('menu background: one PNG of at most 1920×1080, made by the injected converter', async () => {
  const dir = path.join(tmpDir(), 'theme');
  const sizes = new Map();
  const big = Buffer.concat([JPG, Buffer.from('4k')]);
  sizes.set(big.length, { width: 3840, height: 2160 });
  sizes.set(JPG.length, { width: 1000, height: 3000 });
  const menu = createMenuBackground({ dir, convert: fakeConvert((data) => sizes.get(data.length) ?? pngSize(data)) });
  assert.deepEqual([menu.has(), menu.url()], [false, null]);
  assert.deepEqual(await menu.store(picked('4k.jpg', big)), { width: 1920, height: 1080, bytes: fs.statSync(path.join(dir, 'menu.png')).size });
  assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, 'menu.png'))), { width: 1920, height: 1080 });
  assert.match(menu.url(), /^file:\/\/.*\/theme\/menu\.png\?\d+$/);
  const tall = await menu.store(picked('pion.jpg', JPG));
  assert.deepEqual([tall.width, tall.height], [360, 1080], 'the proportions stay');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['menu.json', 'menu.png'], 'one copy');
  assert.deepEqual((await menu.store(picked('maly.png', png(640, 360)))).width, 640, 'a small picture is not blown up');
  // The converter is not trusted: what it returns must be a PNG that fits.
  await assert.rejects(createMenuBackground({ dir, convert: () => png(4000, 1000) }).store(picked('a.png', png(10, 10))), /za duży na tło menu – może mieć najwyżej 1920×1080 pikseli/);
  await assert.rejects(createMenuBackground({ dir, convert: () => JPG }).store(picked('a.png', png(10, 10))), /Nie udało się przygotować tego obrazu/);
  await assert.rejects(createMenuBackground({ dir, convert: () => Promise.reject(new Error('Nie udało się wczytać tego obrazu. Wybierz plik PNG albo JPG.')) }).store(picked('a.webp', WEBP)), /Nie udało się wczytać tego obrazu/);
  await assert.rejects(menu.store(picked('x.png', Buffer.from('to nie obraz, tylko tekst'))), /To nie jest obraz PNG, JPG ani WebP/);
  assert.deepEqual(pngSize(fs.readFileSync(path.join(dir, 'menu.png'))), { width: 640, height: 360 }, 'a refused picture leaves the old one in place');
  // Without a converter only a PNG that already fits is taken.
  const plain = createMenuBackground({ dir: path.join(tmpDir(), 'theme') });
  assert.equal((await plain.store(picked('ok.png', png(1920, 1080)))).height, 1080);
  await assert.rejects(plain.store(picked('za-duzy.png', png(1921, 1080))), /za duży na tło menu/);
  await assert.rejects(plain.store(picked('foto.jpg', JPG)), /Na tło menu wybierz obraz PNG/);
  menu.clear();
  assert.deepEqual([menu.has(), menu.url()], [false, null]);
});

test('menu background: delivered to an instance at the start, taken back when it is the launcher\'s own', async () => {
  const dir = path.join(tmpDir(), 'theme');
  const menu = createMenuBackground({ dir, convert: fakeConvert(pngSize) });
  const instance = { id: 'hs', dir: tmpDir() };
  const target = path.join(instance.dir, 'config', 'hammerclient', 'menu.png');
  assert.equal(MENU.file, path.join('config', 'hammerclient', 'menu.png'));
  assert.equal(menu.deliver(instance, { active: true }), 'none', 'no picture set');
  assert.equal(fs.existsSync(path.dirname(target)), false, 'and no folder is made for nothing');

  await menu.store(picked('a.png', png(1280, 720, 1)));
  assert.equal(menu.deliver(instance, { active: false }), 'none', 'not without Hammer+');
  assert.equal(menu.deliver(instance, { active: true }), 'copied');
  assert.ok(fs.readFileSync(target).equals(fs.readFileSync(path.join(dir, 'menu.png'))));
  const first = fs.statSync(target);
  // The next start: already there (same size and time) → not written again.
  assert.equal(menu.deliver(instance, { active: true }), 'kept');
  assert.equal(fs.statSync(target).ino, first.ino);
  // Another picture → replaced.
  await menu.store(picked('b.png', png(1280, 720, 2)));
  assert.equal(menu.deliver(instance, { active: true }), 'copied');
  assert.ok(fs.readFileSync(target).equals(fs.readFileSync(path.join(dir, 'menu.png'))));
  // A disk that rounds file times: same size, other time, same content → still not written again.
  fs.utimesSync(target, new Date(Date.now() - 4000), new Date(Date.now() - 4000));
  assert.equal(menu.deliver(instance, { active: true }), 'kept');

  // Hammer+ ended (or the mod is off): the launcher takes its picture back – also an older one of its own…
  assert.equal(menu.deliver(instance, { active: false }), 'removed');
  assert.equal(fs.existsSync(target), false);
  assert.equal(menu.deliver(instance, { active: false }), 'none');
  // …and after "Usuń" in the launcher, at the next start.
  menu.deliver(instance, { active: true });
  menu.clear();
  assert.equal(menu.deliver(instance, { active: true }), 'removed');

  // A picture the player put there by hand is not the launcher's: it stays.
  fs.writeFileSync(target, png(800, 600, 9));
  assert.equal(menu.deliver(instance, { active: false }), 'none');
  assert.equal(menu.deliver(instance, { active: true }), 'none');
  assert.ok(fs.existsSync(target));
  // With a launcher picture set and Hammer+ on, the launcher's picture is the one that counts.
  await menu.store(picked('c.png', png(1920, 1080, 3)));
  assert.equal(menu.deliver(instance, { active: true }), 'copied');
  assert.deepEqual(pngSize(fs.readFileSync(target)), { width: 1920, height: 1080 });
});

/** Services with a bundled Hammer Client, a fake file dialog and the fake converter. */
function setup() {
  const keys = plusKeys();
  const state = { pick: null, asked: [] };
  const clientDir = tmpDir('hc');
  fs.writeFileSync(path.join(clientDir, 'hammer-client-1.21.1-2.0.0.jar'), 'jar');
  fs.writeFileSync(path.join(clientDir, 'versions.json'), JSON.stringify({ version: '2.0.0', jars: [{ file: 'hammer-client-1.21.1-2.0.0.jar', minecraft: ['1.21.1'] }] }));
  const s = createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', plusPublicKey: keys.publicKey },
    accounts: { list: () => [GRACZ] },
    clientDir,
    fetchFn: async () => Promise.reject(new TypeError('offline')),
    pickFile: async (options) => (state.asked.push(options), state.pick),
    convertImage: fakeConvert(pngSize),
  });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  fs.writeFileSync(path.join(instance.dir, 'mods', 'fabric-api-0.116.0+1.21.1.jar'), 'api');
  return { s, keys, state, instance, target: path.join(instance.dir, 'config', 'hammerclient', 'menu.png') };
}

test('services: both backgrounds need Hammer+; the file dialog is the injected one', async () => {
  const { s, keys, state } = setup();
  state.pick = picked('tlo.png', png(1600, 900, 4));
  await assert.rejects(s.theme.pickBackground(), /Własne tło launchera to funkcja Hammer\+/);
  await assert.rejects(s.theme.pickMenuBackground(), /Własne tło menu w grze to funkcja Hammer\+/);
  assert.deepEqual(state.asked, [], 'the dialog does not even open');
  assert.deepEqual([s.theme.background(), s.theme.menuBackground()], [{ url: null }, { url: null }]);

  s.plus.activate(keys.code({ mc: GRACZ.id }));
  const set = await s.theme.pickBackground();
  assert.match(set.settings.background, /^background-[0-9a-f]{8}\.png$/);
  assert.equal(fileURLToPath(set.url), path.join(s.paths.root, 'theme', set.settings.background), 'copied into the launcher folder');
  assert.deepEqual(s.theme.background(), { url: set.url });
  assert.deepEqual([state.asked[0].title, state.asked[0].filters[0].extensions], ['Wybierz obraz na tło launchera', ['png', 'jpg', 'jpeg', 'webp']]);
  const menu = await s.theme.pickMenuBackground();
  assert.match(menu.url, /\/theme\/menu\.png\?\d+$/);
  assert.deepEqual(s.theme.menuBackground(), menu);
  assert.deepEqual([state.asked[1].title, state.asked[1].filters[0].extensions], ['Wybierz obraz na tło menu w grze', ['png', 'jpg', 'jpeg']]);
  // The dialog was closed without a file.
  state.pick = null;
  assert.equal(await s.theme.pickBackground(), null);
  assert.equal(await s.theme.pickMenuBackground(), null);
  assert.deepEqual(s.theme.background(), { url: set.url }, 'what was set stays');
  // Not a picture.
  state.pick = picked('lista.png', Buffer.from('zakupy: mleko, chleb, diamenty'));
  await assert.rejects(s.theme.pickBackground(), /To nie jest obraz PNG, JPG ani WebP/);
  await assert.rejects(s.theme.pickMenuBackground(), /To nie jest obraz PNG, JPG ani WebP/);

  // Hammer+ ends: the pictures stay on the disk but are not shown; removing them still works.
  s.plus.remove();
  assert.deepEqual([s.theme.background(), s.theme.menuBackground()], [{ url: null }, { url: null }]);
  assert.ok(fs.existsSync(path.join(s.paths.root, 'theme', 'menu.png')));
  assert.deepEqual(s.theme.clearMenuBackground(), { url: null });
  assert.deepEqual([s.theme.clearBackground().settings.background, s.theme.clearBackground().url], ['', null]);
  assert.deepEqual(fs.readdirSync(path.join(s.paths.root, 'theme')), ['menu.json']);
});

test('services: the menu picture goes into the instance at the start only with Hammer+, and comes back out without', async () => {
  const { s, keys, state, instance, target } = setup();
  await s.hammerClient.sync(instance.id);
  assert.equal(fs.existsSync(target), false);

  s.plus.activate(keys.code({ mc: GRACZ.id }));
  state.pick = picked('menu.png', png(1920, 1080, 6));
  await s.theme.pickMenuBackground();
  await s.hammerClient.sync(instance.id);
  assert.deepEqual(pngSize(fs.readFileSync(target)), { width: 1920, height: 1080 });
  const first = fs.statSync(target);
  await s.hammerClient.sync(instance.id);
  assert.equal(fs.statSync(target).ino, first.ino, 'not copied again');

  // The mod is switched off in the instance → nothing of the launcher stays in its folder.
  s.instances.update(instance.id, { hammerClient: false });
  await s.hammerClient.sync(instance.id);
  assert.equal(fs.existsSync(target), false);
  s.instances.update(instance.id, { hammerClient: true });
  await s.hammerClient.sync(instance.id);
  assert.ok(fs.existsSync(target));

  // Hammer+ ends → the next start takes the picture out; the player's own file would stay.
  s.plus.remove();
  await s.hammerClient.sync(instance.id);
  assert.equal(fs.existsSync(target), false);
  fs.writeFileSync(target, png(640, 480, 8));
  await s.hammerClient.sync(instance.id);
  assert.ok(fs.existsSync(target), 'a hand-placed picture is not the launcher\'s to delete');
});
