'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require('adm-zip');
const worlds = require('../src/main/worlds');
const { createZip, openZip, crc32, crc32Fallback } = require('../src/main/zipstream');
const { dirSize, cleanFolderName, isPlainName, stamp, explained } = require('../src/main/fsutil');
const { readNbt, writeNbt, tag, get, text } = require('../src/main/nbt');
const { tmpDir } = require('./helpers');

const DAY = 864e5;
const NOW = Date.UTC(2026, 10, 10, 12);

/** A gzipped level.dat like the game's, with the fields the launcher reads and a few it must not touch. */
function levelDat({ name, gameType = 0, hardcore = false, lastPlayed = NOW, version = '1.21.1' }) {
  const data = tag.compound({
    GameType: tag.int(gameType),
    hardcore: tag.byte(hardcore),
    LastPlayed: tag.long(BigInt(lastPlayed)),
    LevelName: tag.string(name),
    RandomSeed: tag.long(-1234567890123456789n),
    BorderSize: tag.double(59999968),
    Player: tag.compound({ Pos: tag.list('double', [tag.double(12.5), tag.double(64), tag.double(-7.25)]), Health: tag.float(20) }),
    ...(version ? { Version: tag.compound({ Name: tag.string(version), Id: tag.int(3955), Snapshot: tag.byte(0) }) } : {}),
    DataPacks: tag.compound({ Enabled: tag.list('string', [tag.string('vanilla')]), Disabled: tag.list('end') }),
  });
  return writeNbt(Object.assign(tag.compound({ Data: data, DataVersion: tag.int(3955) }), { name: '' }), { gzip: true });
}

function makeWorld(instance, folder, level, files = {}) {
  const dir = path.join(instance.dir, 'saves', folder);
  fs.mkdirSync(dir, { recursive: true });
  if (level) fs.writeFileSync(path.join(dir, 'level.dat'), Buffer.isBuffer(level) ? level : levelDat(level));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const newInstance = () => ({ id: 'hs', name: 'Hammer', dir: tmpDir() });
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map((p) => p.split(path.sep).join('/')).filter((p) => fs.statSync(path.join(dir, p)).isFile()).sort();

test('worlds: listed newest first with name, mode, version, size and icon – broken worlds stay on the list', async () => {
  const instance = newInstance();
  assert.deepEqual(await worlds.list(instance), [], 'no saves folder yet');
  makeWorld(instance, 'New World', { name: 'Miasto kreatywne', gameType: 1, lastPlayed: NOW - 3 * DAY }, { 'region/r.0.0.mca': Buffer.alloc(5000) });
  const survival = makeWorld(instance, 'Nasz świat', { name: 'Nasz świat', gameType: 0, hardcore: true, lastPlayed: NOW }, { 'icon.png': 'png', 'region/r.0.0.mca': Buffer.alloc(3000), 'data/raids.dat': 'x'.repeat(100) });
  makeWorld(instance, 'Zepsuty', Buffer.from('not a level.dat at all'));
  makeWorld(instance, 'Pusty folder', null);
  makeWorld(instance, 'Widz', { name: 'Podglądanie', gameType: 3, lastPlayed: NOW - DAY, version: null });
  // level.dat damaged, but the game's own level.dat_old is fine – the world still reads.
  makeWorld(instance, 'Odzyskany', Buffer.from([0x1f, 0x8b, 1, 2, 3]), { 'level.dat_old': levelDat({ name: 'Odzyskany', gameType: 2, lastPlayed: NOW - 2 * DAY }) });
  fs.writeFileSync(path.join(instance.dir, 'saves', 'plik.txt'), 'not a world');
  fs.mkdirSync(path.join(instance.dir, 'saves', '.przywracanie-abc'));

  const list = await worlds.list(instance);
  assert.deepEqual(list.slice(0, 4).map((w) => w.folder), ['Nasz świat', 'Widz', 'Odzyskany', 'New World'], 'by last played');
  assert.deepEqual(list.slice(4).map((w) => w.folder).sort(), ['Pusty folder', 'Zepsuty'], 'broken worlds at the end; files and hidden folders are not worlds');
  const [first, spectator, recovered, creative] = list;
  assert.deepEqual(
    { ...first, iconUrl: null, size: 0 },
    { folder: 'Nasz świat', name: 'Nasz świat', gameType: 0, gameMode: 'Przetrwanie', hardcore: true, version: '1.21.1', lastPlayed: NOW, size: 0, sizePartial: false, iconUrl: null, broken: false },
  );
  assert.equal(first.size, (await dirSize(survival)).size);
  assert.ok(first.size > 3100 && first.size < 4000);
  assert.match(first.iconUrl, /^file:\/\/.*icon\.png$/);
  assert.deepEqual([creative.name, creative.gameMode, creative.hardcore, creative.iconUrl], ['Miasto kreatywne', 'Kreatywny', false, null]);
  assert.deepEqual([spectator.gameMode, spectator.version], ['Widz', null]);
  assert.deepEqual([recovered.gameMode, recovered.broken], ['Przygoda', false]);
  for (const broken of list.slice(4)) {
    assert.deepEqual([broken.broken, broken.name, broken.gameMode, broken.version], [true, broken.folder, null, null]);
    assert.ok(broken.lastPlayed > 0, 'falls back to the folder date');
  }
});

test('worlds: rename changes only LevelName in level.dat', async () => {
  const instance = newInstance();
  const dir = makeWorld(instance, 'New World', { name: 'New World', gameType: 1 }, { 'region/r.0.0.mca': 'region' });
  const before = readNbt(fs.readFileSync(path.join(dir, 'level.dat')));
  const world = await worlds.rename(instance, 'New World', '  Zamek na wzgórzu 🏰 ');
  assert.deepEqual([world.folder, world.name], ['New World', 'Zamek na wzgórzu 🏰']);
  const raw = fs.readFileSync(path.join(dir, 'level.dat'));
  assert.deepEqual([raw[0], raw[1]], [0x1f, 0x8b], 'still gzipped');
  const after = readNbt(raw);
  assert.equal(text(get(after, 'Data', 'LevelName')), 'Zamek na wzgórzu 🏰');
  assert.deepEqual([...get(after, 'Data').value.keys()], [...get(before, 'Data').value.keys()], 'same fields in the same order');
  get(after, 'Data').value.set('LevelName', tag.string('New World'));
  assert.ok(writeNbt(after, { gzip: false }).equals(writeNbt(before, { gzip: false })), 'everything else is byte for byte the same');
  assert.deepEqual(tree(dir), ['level.dat', 'region/r.0.0.mca'], 'no temporary files left');

  await assert.rejects(worlds.rename(instance, 'New World', '   '), /Podaj nazwę/);
  await assert.rejects(worlds.rename(instance, 'New World', 'x'.repeat(65)), /najwyżej 64/);
  await assert.rejects(worlds.rename(instance, 'Nie ma', 'x'), /Nie ma już takiego świata/);
  makeWorld(instance, 'Zepsuty', Buffer.from('garbage'));
  await assert.rejects(worlds.rename(instance, 'Zepsuty', 'x'), /level\.dat jest uszkodzony/);
});

test('worlds: only plain folder and file names inside the instance are accepted', async () => {
  const instance = newInstance();
  makeWorld(instance, 'Świat', { name: 'Świat' });
  fs.mkdirSync(path.join(instance.dir, 'backups'));
  fs.writeFileSync(path.join(instance.dir, 'backups', 'ok.zip'), 'zip');
  fs.writeFileSync(path.join(instance.dir, 'options.txt'), 'lang:pl_pl');
  for (const bad of ['..', '.', '', '../saves/Świat', 'Świat/..', 'Świat/region', '/etc', 'a\\b', '.ukryty', null, undefined, 5, ['Świat'], 'x'.repeat(300), 'a\u0000b']) {
    assert.throws(() => worlds.worldDir(instance, bad), /Nieprawidłowa nazwa świata/, String(bad));
    assert.throws(() => worlds.backupPath(instance, bad), /Nieprawidłowa nazwa kopii/, String(bad));
    await assert.rejects(worlds.remove(instance, bad), /Nieprawidłowa nazwa świata/);
    await assert.rejects(worlds.backup(instance, bad), /Nieprawidłowa nazwa świata/);
    await assert.rejects(worlds.restoreBackup(instance, bad), /Nieprawidłowa nazwa kopii/);
  }
  assert.throws(() => worlds.backupPath(instance, '../options.txt'), /Nieprawidłowa nazwa kopii/);
  assert.throws(() => worlds.backupPath(instance, 'options.txt'), /Nieprawidłowa nazwa kopii/, 'only .zip files');
  assert.throws(() => worlds.backupPath(instance, 'nie-ma.zip'), /Nie ma już takiej kopii/);
  assert.throws(() => worlds.worldDir(instance, 'Nie ma'), /Nie ma już takiego świata/);
  assert.equal(worlds.worldDir(instance, 'Świat'), path.join(instance.dir, 'saves', 'Świat'));
  assert.equal(worlds.backupPath(instance, 'ok.zip'), path.join(instance.dir, 'backups', 'ok.zip'));
  if (process.platform !== 'win32') {
    fs.symlinkSync(path.join(instance.dir, 'saves', 'Świat'), path.join(instance.dir, 'saves', 'Link'));
    assert.throws(() => worlds.worldDir(instance, 'Link'), /Nie ma już takiego świata/, 'links are not worlds');
    assert.deepEqual((await worlds.list(instance)).map((w) => w.folder), ['Świat']);
  }
  // A colon is fine in a folder name on Linux and macOS; on Windows no such folder can exist ("a:" reads as a drive).
  assert.equal(isPlainName('a:b'), process.platform !== 'win32');
  assert.equal(cleanFolderName(' a:b*c?.. ', 'x'), 'a_b_c_');
  assert.equal(cleanFolderName('..', 'Przywrócony świat'), 'Przywrócony świat');
  assert.equal(cleanFolderName('NUL', 'x'), 'x');
  assert.equal(stamp(new Date(2026, 0, 5, 7, 3)), '2026-01-05_07-03');
});

test('worlds: remove goes through the trash function; without one the folder is deleted', async () => {
  const instance = newInstance();
  const a = makeWorld(instance, 'A', { name: 'A' });
  const b = makeWorld(instance, 'B', { name: 'B' });
  const trashed = [];
  assert.equal(await worlds.remove(instance, 'A', { trash: async (p) => trashed.push(p) }), true);
  assert.deepEqual(trashed, [a]);
  assert.ok(fs.existsSync(a), 'the trash function decides what happens to the folder');
  await assert.rejects(worlds.remove(instance, 'B', { trash: async () => Promise.reject(new Error('Nie udało się przenieść do kosza.')) }), /do kosza/);
  assert.ok(fs.existsSync(b), 'a failed trash never falls back to deleting');
  await worlds.remove(instance, 'B');
  assert.equal(fs.existsSync(b), false);
});

test('worlds: backup into backups/<folder>-date.zip, list, restore as a new world, remove', async () => {
  const instance = newInstance();
  const region = crypto.randomBytes(300_000);
  const dir = makeWorld(instance, 'Nasz świat', { name: 'Nasz świat' }, { 'region/r.0.0.mca': region, 'data/raids.dat': 'raids', 'icon.png': 'png', 'session.lock': 'lock', 'pusty.txt': '' });
  const when = new Date(2026, 10, 10, 18, 5, 33);
  const progress = [];
  const made = await worlds.backup(instance, 'Nasz świat', { now: when, onProgress: (p) => progress.push(p) });
  assert.equal(made.file, 'Nasz świat-2026-11-10_18-05.zip');
  assert.equal(made.world, 'Nasz świat');
  const total = progress.at(-1).total;
  assert.equal(total, region.length + 'raids'.length + 'png'.length + fs.statSync(path.join(dir, 'level.dat')).size);
  assert.equal(progress.at(-1).done, total);
  assert.ok(progress.every((p, i) => p.done <= p.total && (i === 0 || p.done >= progress[i - 1].done)));

  // A normal zip: any other program (here adm-zip) reads it, with the world folder at the top like the game's backups.
  const zip = new AdmZip(path.join(instance.dir, 'backups', made.file));
  assert.deepEqual(zip.getEntries().map((e) => e.entryName).sort(), ['Nasz świat/data/raids.dat', 'Nasz świat/icon.png', 'Nasz świat/level.dat', 'Nasz świat/pusty.txt', 'Nasz świat/region/r.0.0.mca']);
  assert.ok(zip.getEntry('Nasz świat/region/r.0.0.mca').getData().equals(region));
  assert.ok(zip.getEntry('Nasz świat/level.dat').getData().equals(fs.readFileSync(path.join(dir, 'level.dat'))));
  assert.equal(fs.readdirSync(path.join(instance.dir, 'backups')).length, 1, 'no .part file left');

  const second = await worlds.backup(instance, 'Nasz świat', { now: when });
  assert.equal(second.file, 'Nasz świat-2026-11-10_18-05 (2).zip', 'never overwrites an older backup');
  // The game's own backup naming, something that is not a backup, and a folder.
  fs.copyFileSync(path.join(instance.dir, 'backups', made.file), path.join(instance.dir, 'backups', '2026-10-28_18-02-51_New World.zip'));
  fs.utimesSync(path.join(instance.dir, 'backups', '2026-10-28_18-02-51_New World.zip'), new Date(NOW - 13 * DAY), new Date(NOW - 13 * DAY));
  fs.writeFileSync(path.join(instance.dir, 'backups', 'notatki.txt'), 'x');
  fs.mkdirSync(path.join(instance.dir, 'backups', 'folder.zip'));
  const list = await worlds.listBackups(instance);
  assert.deepEqual(list.map((b) => [b.file, b.world]).sort(), [['2026-10-28_18-02-51_New World.zip', 'New World'], ['Nasz świat-2026-11-10_18-05 (2).zip', 'Nasz świat'], ['Nasz świat-2026-11-10_18-05.zip', 'Nasz świat']]);
  assert.equal(list.at(-1).file, '2026-10-28_18-02-51_New World.zip', 'newest first');
  assert.ok(list.every((b) => b.size > 300_000 && b.createdAt > 0));
  assert.deepEqual(await worlds.listBackups(newInstance()), []);

  // The world changes after the backup; restoring must not touch it.
  fs.writeFileSync(path.join(dir, 'data/raids.dat'), 'changed after the backup');
  const steps = [];
  const restored = await worlds.restoreBackup(instance, made.file, { onProgress: (p) => steps.push(p) });
  assert.deepEqual(restored, { folder: 'Nasz świat (2)' });
  assert.equal(steps.at(-1).done, steps.at(-1).total);
  assert.equal(fs.readFileSync(path.join(dir, 'data/raids.dat'), 'utf8'), 'changed after the backup');
  const copy = path.join(instance.dir, 'saves', 'Nasz świat (2)');
  assert.deepEqual(tree(copy), ['data/raids.dat', 'icon.png', 'level.dat', 'pusty.txt', 'region/r.0.0.mca']);
  assert.equal(fs.readFileSync(path.join(copy, 'data/raids.dat'), 'utf8'), 'raids');
  assert.ok(fs.readFileSync(path.join(copy, 'region/r.0.0.mca')).equals(region));
  assert.deepEqual((await worlds.restoreBackup(instance, made.file)).folder, 'Nasz świat (3)');
  assert.deepEqual((await worlds.list(instance)).map((w) => w.folder).sort(), ['Nasz świat', 'Nasz świat (2)', 'Nasz świat (3)']);

  const trashed = [];
  await worlds.removeBackup(instance, second.file, { trash: async (p) => trashed.push(path.basename(p)) });
  assert.deepEqual(trashed, [second.file]);
  await worlds.removeBackup(instance, second.file);
  assert.equal(fs.existsSync(path.join(instance.dir, 'backups', second.file)), false);
  await assert.rejects(worlds.backup(instance, 'Nie ma'), /Nie ma już takiego świata/);
});

test('worlds: restore accepts other zips of a world and refuses anything that would leave the folder', async () => {
  const instance = newInstance();
  const backups = path.join(instance.dir, 'backups');
  fs.mkdirSync(backups, { recursive: true });
  const saves = path.join(instance.dir, 'saves');
  const level = levelDat({ name: 'Mapa' });

  // level.dat at the top of the archive (a world zipped by hand): the folder is named after the file.
  const flat = new AdmZip();
  flat.addFile('level.dat', level);
  flat.addFile('region/r.0.0.mca', Buffer.from('region'));
  flat.addFile('datapacks/', Buffer.alloc(0));
  flat.writeZip(path.join(backups, 'Moja mapa-2026-01-01_10-00.zip'));
  assert.deepEqual(await worlds.restoreBackup(instance, 'Moja mapa-2026-01-01_10-00.zip'), { folder: 'Moja mapa' });
  assert.deepEqual(tree(path.join(saves, 'Moja mapa')), ['level.dat', 'region/r.0.0.mca']);
  assert.ok(fs.statSync(path.join(saves, 'Moja mapa', 'datapacks')).isDirectory());

  // A world folder next to other things: only the world is unpacked; a link inside it is skipped.
  const mixed = new AdmZip();
  mixed.addFile('README.txt', Buffer.from('hello'));
  mixed.addFile('World: One/level.dat', level);
  mixed.addFile('World: One/data/x.dat', Buffer.from('x'));
  const link = mixed.addFile('World: One/link', Buffer.from('/etc/passwd'));
  link.header.made = 0x0314;
  link.attr = (0o120777 << 16) >>> 0;
  mixed.writeZip(path.join(backups, 'mixed.zip'));
  const fromMixed = await worlds.restoreBackup(instance, 'mixed.zip');
  assert.equal(fromMixed.folder, 'World_ One', 'a name every system accepts');
  assert.deepEqual(tree(path.join(saves, fromMixed.folder)), ['data/x.dat', 'level.dat']);

  // Zip-slip: entry names are patched in the archive bytes (zip libraries refuse to write such names).
  const evil = (from, to, name) => {
    const zip = new AdmZip();
    zip.addFile('World/level.dat', level);
    zip.addFile(from, Buffer.from('evil'));
    let bytes = zip.toBuffer();
    assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
    for (let at = bytes.indexOf(from); at !== -1; at = bytes.indexOf(from, at + 1)) bytes.write(to, at);
    assert.ok(bytes.includes(to));
    fs.writeFileSync(path.join(backups, name), bytes);
  };
  evil('World/aa/aa/evil.txt', 'World/../../evil.txt', 'slip1.zip');
  evil('World/aa/aa/aa/evil.txt', 'World\\..\\..\\..\\evil.txt', 'slip2.zip');
  evil('World/a/evil.txt', 'World/C:evil.txt', 'slip3.zip');
  evil('World/aaa/evil.txt', 'World/.../evil.txt', 'slip4.zip');
  const before = tree(instance.dir);
  for (const name of ['slip1.zip', 'slip2.zip', 'slip3.zip', 'slip4.zip']) await assert.rejects(worlds.restoreBackup(instance, name), /niedozwolone ścieżki/, name);
  assert.deepEqual(tree(instance.dir), before, 'nothing was written – inside or outside the saves folder');
  assert.deepEqual(fs.readdirSync(saves).sort(), ['Moja mapa', 'World_ One'], 'no half-restored folder left');
  assert.equal(fs.existsSync(path.join(path.dirname(instance.dir), 'evil.txt')), false);

  // Paths outside the world folder are simply not part of the world.
  evil('aaaaa/evil.txt', '../../evil.txt', 'outside.zip');
  assert.deepEqual(tree(path.join(saves, (await worlds.restoreBackup(instance, 'outside.zip')).folder)), ['level.dat']);
  assert.equal(fs.existsSync(path.join(instance.dir, 'evil.txt')), false);

  const notWorld = new AdmZip();
  notWorld.addFile('mods/sodium.jar', Buffer.from('jar'));
  notWorld.writeZip(path.join(backups, 'mody.zip'));
  await assert.rejects(worlds.restoreBackup(instance, 'mody.zip'), /nie ma pliku level\.dat/);
  fs.writeFileSync(path.join(backups, 'zepsuty.zip'), 'this is not a zip file');
  await assert.rejects(worlds.restoreBackup(instance, 'zepsuty.zip'), /nie jest poprawny plik \.zip/);
  // A file whose content does not match its checksum stops the restore and leaves nothing behind.
  const good = new AdmZip();
  good.addFile('W/level.dat', level);
  good.addFile('W/big.bin', Buffer.alloc(50_000, 7));
  const damaged = good.toBuffer();
  const central = damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  damaged.writeUInt32LE(0xdeadbeef, central + 16);
  fs.writeFileSync(path.join(backups, 'crc.zip'), damaged);
  const count = fs.readdirSync(saves).length;
  await assert.rejects(worlds.restoreBackup(instance, 'crc.zip'), /sumę kontrolną/);
  // Damaged compressed data (a system-level zlib error) is explained in Polish as well.
  const garbled = good.toBuffer();
  garbled.fill(0xff, garbled.indexOf('W/big.bin') + 'W/big.bin'.length, garbled.indexOf('W/big.bin') + 'W/big.bin'.length + 30);
  fs.writeFileSync(path.join(backups, 'garbled.zip'), garbled);
  await assert.rejects(worlds.restoreBackup(instance, 'garbled.zip'), /^Error: Nie udało się przywrócić świata: archiwum jest uszkodzone\.$/);
  assert.equal(fs.readdirSync(saves).length, count);
});

test('zip streams: readable by other tools, Zip64 layout, checksums', async () => {
  const dir = tmpDir();
  const big = crypto.randomBytes(700_000);
  const text1 = 'zażółć gęślą jaźń\n'.repeat(4000);
  fs.writeFileSync(path.join(dir, 'a.bin'), big);
  fs.writeFileSync(path.join(dir, 'b.txt'), text1);
  fs.writeFileSync(path.join(dir, 'c'), '');
  const files = [
    { path: path.join(dir, 'a.bin'), name: 'Świat/region/r.0.0.mca', size: big.length, mtimeMs: Date.UTC(2026, 5, 1) },
    { path: path.join(dir, 'b.txt'), name: 'Świat\\notatki żółwia.txt' },
    { path: path.join(dir, 'c'), name: 'Świat/pusty' },
  ];
  for (const zip64 of [false, true]) {
    const dest = path.join(dir, `out${zip64 ? '64' : ''}.zip`);
    let seen = 0;
    const made = await createZip(dest, files, { zip64, onProgress: (n) => (seen = n) });
    assert.deepEqual([made.files, made.size, seen], [3, big.length + Buffer.byteLength(text1), big.length + Buffer.byteLength(text1)]);
    assert.equal(made.bytes, fs.statSync(dest).size);
    assert.ok(made.bytes < big.length + 20_000, 'text is deflated');
    const zip = await openZip(dest);
    assert.deepEqual(zip.entries.map((e) => [e.name, e.size, e.directory, e.symlink]), [['Świat/region/r.0.0.mca', big.length, false, false], ['Świat/notatki żółwia.txt', Buffer.byteLength(text1), false, false], ['Świat/pusty', 0, false, false]]);
    const out = path.join(dir, `x${zip64}`);
    fs.mkdirSync(out);
    for (const [i, entry] of zip.entries.entries()) await zip.extract(entry, path.join(out, String(i)));
    await assert.rejects(zip.extract(zip.entries[0], path.join(out, '0')), /EEXIST/, 'never writes over an existing file');
    await zip.close();
    assert.ok(fs.readFileSync(path.join(out, '0')).equals(big));
    assert.equal(fs.readFileSync(path.join(out, '1'), 'utf8'), text1);
    assert.equal(fs.readFileSync(path.join(out, '2')).length, 0);
    if (!zip64) assert.ok(new AdmZip(dest).getEntry('Świat/region/r.0.0.mca').getData().equals(big));
  }
  await assert.rejects(createZip(path.join(dir, 'bad.zip'), [{ path: path.join(dir, 'missing'), name: 'x' }]), /ENOENT/);
  await assert.rejects(explained('Nie udało się zrobić kopii zapasowej', () => createZip(path.join(dir, 'bad.zip'), [{ path: path.join(dir, 'missing'), name: 'x' }])), /^Error: Nie udało się zrobić kopii zapasowej: plik zniknął w trakcie pracy\.$/);
  await assert.rejects(explained('Nie udało się', async () => Promise.reject(new Error('Własny komunikat po polsku.'))), /^Error: Własny komunikat po polsku\.$/);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('bad')), [], 'a failed archive leaves no file');
  assert.equal(crc32Fallback(Buffer.from('hello world')), 0x0d4a1185);
  assert.equal(crc32Fallback(Buffer.from(' world'), crc32Fallback(Buffer.from('hello'))), crc32(Buffer.from('hello world')));
});
