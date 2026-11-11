'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const official = require('../src/main/official');
const worlds = require('../src/main/worlds');
const { writeNbt, tag } = require('../src/main/nbt');
const { tmpDir } = require('./helpers');

const { officialMinecraftDir } = official;
const NOW = Date.UTC(2026, 10, 10, 12);

test('official Minecraft folder: where the Minecraft Launcher keeps the game on each system', () => {
  assert.equal(officialMinecraftDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\Gracz\\AppData\\Roaming' }, home: 'C:\\Users\\Gracz' }), path.join('C:\\Users\\Gracz\\AppData\\Roaming', '.minecraft'));
  assert.equal(officialMinecraftDir({ platform: 'win32', env: {}, home: '/home/gracz' }), path.join('/home/gracz', 'AppData', 'Roaming', '.minecraft'));
  assert.equal(officialMinecraftDir({ platform: 'darwin', env: {}, home: '/Users/gracz' }), path.join('/Users/gracz', 'Library', 'Application Support', 'minecraft'));
  assert.equal(officialMinecraftDir({ platform: 'linux', env: {}, home: '/home/gracz' }), path.join('/home/gracz', '.minecraft'));
});

function levelDat({ name, version = '1.21.1', lastPlayed = NOW }) {
  const data = tag.compound({ LevelName: tag.string(name), GameType: tag.int(0), LastPlayed: tag.long(BigInt(lastPlayed)), ...(version ? { Version: tag.compound({ Name: tag.string(version) }) } : {}) });
  return writeNbt(Object.assign(tag.compound({ Data: data }), { name: '' }), { gzip: true });
}

/** A folder that stands for %APPDATA%\.minecraft with worlds in saves/. */
function officialFolder(worldList = {}) {
  const dir = tmpDir('official');
  for (const [folder, files] of Object.entries(worldList)) {
    for (const [rel, body] of Object.entries(files)) {
      const file = path.join(dir, 'saves', folder, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
    }
  }
  return dir;
}
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map((p) => p.split(path.sep).join('/')).filter((p) => fs.statSync(path.join(dir, p)).isFile()).sort();
const newInstance = () => ({ id: 'hs', name: 'Hammer', mcVersion: '1.21.1', dir: tmpDir('instance') });

test('official worlds: listed like the worlds of an instance – name, last played, size, game version, icon', async () => {
  assert.deepEqual(await official.listWorlds(null), [], 'no official Minecraft on this computer');
  assert.deepEqual(await official.listWorlds(tmpDir()), [], 'an official folder without saves/');
  const dir = officialFolder({
    'New World': { 'level.dat': levelDat({ name: 'Mój pierwszy świat', version: '1.20.1', lastPlayed: NOW - 864e5 }), 'region/r.0.0.mca': Buffer.alloc(4000), 'icon.png': 'png' },
    Skyblock: { 'level.dat': levelDat({ name: 'Skyblock', version: '26.1', lastPlayed: NOW }), 'region/r.0.0.mca': Buffer.alloc(1000) },
    Zepsuty: { 'level.dat': 'not nbt' },
  });
  const list = await official.listWorlds(dir);
  assert.deepEqual(list.map((w) => [w.folder, w.name, w.version, w.broken]), [['Skyblock', 'Skyblock', '26.1', false], ['New World', 'Mój pierwszy świat', '1.20.1', false], ['Zepsuty', 'Zepsuty', null, true]]);
  assert.equal(list[1].lastPlayed, NOW - 864e5);
  assert.ok(list[1].size >= 4000);
  assert.match(list[1].iconUrl, /^file:.*New%20World\/icon\.png$/);
  assert.equal(list[0].iconUrl, null);
});

test('official worlds: "newer than the instance" – by the version manifest, else by the numbers, never a guess', () => {
  const order = ['26.1', '25w41a', '1.21.4', '1.21.2-pre1', '1.21.1', '24w14a', '1.20.6', '1.20.1'];
  assert.equal(official.isNewer('1.21.4', '1.21.1', order), true);
  assert.equal(official.isNewer('1.20.1', '1.21.1', order), false);
  assert.equal(official.isNewer('1.21.1', '1.21.1', order), false);
  assert.equal(official.isNewer('25w41a', '1.21.4', order), true, 'a snapshot is placed by the manifest');
  assert.equal(official.isNewer('24w14a', '1.21.1', order), false);
  // Without the manifest (no internet): the numbers decide.
  assert.equal(official.isNewer('1.21.10', '1.21.9'), true, 'numbers, not text');
  assert.equal(official.isNewer('26.1', '1.21.11'), true, 'the year-based versions come after 1.x');
  assert.equal(official.isNewer('1.21.2 Pre-Release 1', '1.21.1'), true, 'the name level.dat gives a pre-release');
  assert.equal(official.isNewer('1.21.1', '1.21.2 Pre-Release 1'), false);
  assert.equal(official.isNewer('1.8.9', '1.21.1'), false);
  assert.equal(official.isNewer('24w14a', '1.21.1'), false, 'a snapshot without the manifest: no warning without a reason');
  assert.equal(official.isNewer('1.21.4', '24w14a'), false);
  assert.equal(official.isNewer(null, '1.21.1'), false, 'a world that does not say its version');
  assert.equal(official.isNewer('1.21.4', ''), false);
  // A version the manifest does not know falls back to the numbers.
  assert.equal(official.isNewer('1.99', '1.21.1', order), true);
});

test('official worlds: a world is copied into the instance – the original is only read, session.lock stays behind', async () => {
  const dir = officialFolder({ 'Nasz świat': { 'level.dat': levelDat({ name: 'Nasz świat' }), 'region/r.0.0.mca': Buffer.alloc(9000, 7), 'data/raids.dat': 'raids', 'session.lock': 'x', 'icon.png': 'png' } });
  const before = tree(path.join(dir, 'saves'));
  const instance = newInstance();
  const seen = [];
  const res = await official.copyWorld(instance, dir, 'Nasz świat', { onProgress: (p) => seen.push(p) });
  assert.deepEqual(res, { source: 'Nasz świat', folder: 'Nasz świat', files: 4, size: fs.statSync(path.join(dir, 'saves', 'Nasz świat', 'level.dat')).size + 9000 + 5 + 3 });
  assert.deepEqual(tree(path.join(instance.dir, 'saves')), ['Nasz świat/data/raids.dat', 'Nasz świat/icon.png', 'Nasz świat/level.dat', 'Nasz świat/region/r.0.0.mca']);
  assert.deepEqual(fs.readFileSync(path.join(instance.dir, 'saves', 'Nasz świat', 'region', 'r.0.0.mca')), Buffer.alloc(9000, 7));
  assert.deepEqual(tree(path.join(dir, 'saves')), before, 'nothing moved or deleted in the official folder');
  assert.deepEqual(seen[0], { done: 0, total: res.size });
  assert.deepEqual(seen.at(-1), { done: res.size, total: res.size });
  assert.ok(seen.every((p, i) => i === 0 || p.done >= seen[i - 1].done), 'progress only goes up');
  assert.deepEqual((await worlds.list(instance)).map((w) => w.name), ['Nasz świat'], 'and the instance sees it as one of its worlds');
});

test('official worlds: a name that is taken gets a numbered folder – nothing in the instance is overwritten', async () => {
  const dir = officialFolder({ 'New World': { 'level.dat': levelDat({ name: 'Z Minecrafta' }), 'region/r.0.0.mca': 'new' } });
  const instance = newInstance();
  fs.mkdirSync(path.join(instance.dir, 'saves', 'New World', 'region'), { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'saves', 'New World', 'level.dat'), levelDat({ name: 'Mój w instancji' }));
  fs.writeFileSync(path.join(instance.dir, 'saves', 'New World', 'region', 'r.0.0.mca'), 'old');
  assert.equal((await official.copyWorld(instance, dir, 'New World')).folder, 'New World (2)');
  assert.equal((await official.copyWorld(instance, dir, 'New World')).folder, 'New World (3)');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'saves', 'New World', 'region', 'r.0.0.mca'), 'utf8'), 'old');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'saves', 'New World (2)', 'region', 'r.0.0.mca'), 'utf8'), 'new');
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')).sort(), ['New World', 'New World (2)', 'New World (3)'], 'no half-copied folder is left');
  // A copy that was cut off earlier (the launcher was closed half-way) is cleared away by the next one.
  fs.mkdirSync(path.join(instance.dir, 'saves', '.importowanie-0a1b2c3d', 'region'), { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'saves', '.importowanie-0a1b2c3d', 'level.dat'), 'half');
  // A copy that fails half-way (the disk fills up) leaves nothing behind either, and says why in Polish.
  fs.mkdirSync(path.join(dir, 'saves', 'Wielki', 'region'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'saves', 'Wielki', 'level.dat'), levelDat({ name: 'Wielki' }));
  fs.writeFileSync(path.join(dir, 'saves', 'Wielki', 'region', 'r.0.0.mca'), Buffer.alloc(3000));
  const copyFile = fs.promises.copyFile;
  let copies = 0;
  fs.promises.copyFile = async (...a) => ((copies += 1) > 1 ? Promise.reject(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' })) : copyFile(...a));
  try {
    await assert.rejects(official.copyWorld(instance, dir, 'Wielki'), /Nie udało się skopiować świata „Wielki”: na dysku zabrakło miejsca\./);
  } finally {
    fs.promises.copyFile = copyFile;
  }
  assert.equal(copies, 2, 'the first file was copied, the second one failed');
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')).sort(), ['New World', 'New World (2)', 'New World (3)']);
});

test('official worlds: only a real world inside saves/ can be copied', async () => {
  const dir = officialFolder({ Dobry: { 'level.dat': levelDat({ name: 'Dobry' }) }, 'Nie świat': { 'notes.txt': 'x' } });
  fs.writeFileSync(path.join(dir, 'options.txt'), 'lang:pl_pl\n');
  const instance = newInstance();
  await assert.rejects(official.copyWorld(instance, dir, '../'), /Nie ma już takiego świata/);
  await assert.rejects(official.copyWorld(instance, dir, '..'), /Nie ma już takiego świata/);
  await assert.rejects(official.copyWorld(instance, dir, 'Dobry/../Dobry'), /Nie ma już takiego świata/);
  await assert.rejects(official.copyWorld(instance, dir, 'Nie ma'), /Nie ma już takiego świata/);
  await assert.rejects(official.copyWorld(instance, null, 'Dobry'), /Nie ma już takiego świata/);
  await assert.rejects(official.copyWorld(instance, dir, 'Nie świat'), /brakuje pliku level\.dat/);
  // A link in saves/ is not followed (it could point anywhere).
  let linked = true;
  try {
    fs.symlinkSync(path.join(dir, 'saves', 'Dobry'), path.join(dir, 'saves', 'Skrót'), 'dir');
  } catch {
    linked = false; // Windows without the right to make links
  }
  if (linked) await assert.rejects(official.copyWorld(instance, dir, 'Skrót'), /Nie ma już takiego świata/);
  // The instance's own saves folder is not a source.
  await official.copyWorld(instance, dir, 'Dobry');
  await assert.rejects(official.copyWorld(instance, instance.dir, 'Dobry'), /już jest w tej instancji/);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')), ['Dobry']);
});

test('official worlds: several at once – one that fails does not stop the others', async () => {
  const done = [];
  const copy = async (folder, i, count) => {
    done.push([folder, i, count]);
    if (folder === 'B') throw new Error('Za mało miejsca na dysku.');
    return { source: folder, folder: `${folder} (2)` };
  };
  assert.deepEqual(await official.copyWorlds(['A', 'B', 'C', 'A', 7], copy), { copied: [{ source: 'A', folder: 'A (2)' }, { source: 'C', folder: 'C (2)' }], failed: [{ folder: 'B', error: 'Za mało miejsca na dysku.' }] });
  assert.deepEqual(done, [['A', 0, 3], ['B', 1, 3], ['C', 2, 3]], 'each world once, in order');
  await assert.rejects(official.copyWorlds([], copy), /Zaznacz przynajmniej jeden świat/);
  await assert.rejects(official.copyWorlds(null, copy), /Zaznacz przynajmniej jeden świat/);
  await assert.rejects(official.copyWorlds(Array.from({ length: official.MAX_WORLDS_AT_ONCE + 1 }, (_, i) => `W${i}`), copy), /najwyżej 50 światów/);
});

test('official settings: options.txt comes over, the previous file stays as options.txt.przed-importem', () => {
  const dir = tmpDir('official');
  const theirs = 'version:3955\nlang:en_us\nmouseSensitivity:0.31\nfov:0.5\nrenderDistance:16\nresourcePacks:["vanilla","file/Faithful 32x.zip"]\nkey_key.sprint:key.keyboard.r\nkey_key.inventory:key.keyboard.tab\n';
  fs.writeFileSync(path.join(dir, 'options.txt'), theirs);
  const instance = newInstance();
  fs.mkdirSync(instance.dir, { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'options.txt'), 'lang:pl_pl\nonboardAccessibility:false\nkey_key.hammerclient.zoom:key.keyboard.c\n');
  assert.equal(official.hasOptions(dir), true);
  assert.deepEqual(official.importOptions(instance, dir), { backup: 'options.txt.przed-importem', lines: 9 });
  const now = fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8');
  assert.equal(now, `${theirs}onboardAccessibility:false\n`, 'keys, sensitivity, video settings, the language and the resource packs – and no first-start accessibility screen');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt.przed-importem'), 'utf8'), 'lang:pl_pl\nonboardAccessibility:false\nkey_key.hammerclient.zoom:key.keyboard.c\n');
  assert.equal(fs.readFileSync(path.join(dir, 'options.txt'), 'utf8'), theirs, 'the official file is only read');
  // A second import: the backup is the file from just before it.
  fs.writeFileSync(path.join(dir, 'options.txt'), 'lang:de_de\nonboardAccessibility:true\n');
  assert.deepEqual(official.importOptions(instance, dir), { backup: 'options.txt.przed-importem', lines: 2 });
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'), 'lang:de_de\nonboardAccessibility:false\n');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt.przed-importem'), 'utf8'), now);
  // An instance without a settings file yet: nothing to keep.
  const fresh = newInstance();
  assert.deepEqual(official.importOptions(fresh, dir), { backup: null, lines: 2 });
  assert.deepEqual(fs.readdirSync(fresh.dir), ['options.txt']);
});

test('official settings: no file, an empty, huge or binary one – nothing is touched', () => {
  const instance = newInstance();
  fs.mkdirSync(instance.dir, { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'options.txt'), 'lang:pl_pl\n');
  const refused = (dir) => {
    assert.equal(official.hasOptions(dir), false);
    assert.throws(() => official.importOptions(instance, dir), /Nie znalazłem ustawień zwykłego Minecrafta/);
    assert.deepEqual(fs.readdirSync(instance.dir), ['options.txt']);
    assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'), 'lang:pl_pl\n');
  };
  refused(null);
  refused(tmpDir());
  const dir = tmpDir('official');
  const file = path.join(dir, 'options.txt');
  fs.writeFileSync(file, '');
  refused(dir);
  fs.writeFileSync(file, `lang:pl_pl\n${'x'.repeat(official.MAX_OPTIONS)}`);
  refused(dir);
  fs.writeFileSync(file, Buffer.from([0x1f, 0x8b, 0, 0, 0x6c, 0x3a, 0x31]));
  refused(dir);
  fs.writeFileSync(file, 'this is just a note\nwithout any setting\n');
  refused(dir);
  fs.rmSync(file);
  fs.mkdirSync(file); // a folder with that name
  refused(dir);
});
