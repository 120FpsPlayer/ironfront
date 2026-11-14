'use strict';

// Calendar days are local time: the tests run in Polish time, with its change from summer to winter time.
process.env.TZ = 'Europe/Warsaw';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const AdmZip = require('adm-zip');
const worlds = require('../src/main/worlds');
const autoBackup = require('../src/main/autobackup');
const { createServices } = require('../src/main/services');
const { createSettings, migrate, SETTINGS_VERSION } = require('../src/main/settings');
const { writeNbt, tag } = require('../src/main/nbt');
const { stamp } = require('../src/main/fsutil');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
/** Local time on a day of November 2026 (October with `month: 9`). */
const at = (day, hour, minute = 0, month = 10) => new Date(2026, month, day, hour, minute).getTime();
const NOW = at(14, 23, 30);

const levelDat = (name) => writeNbt(Object.assign(tag.compound({ Data: tag.compound({ LevelName: tag.string(name), GameType: tag.int(0) }) }), { name: '' }), { gzip: true });
function makeWorld(instance, folder, files = {}, { level = true } = {}) {
  const dir = path.join(instance.dir, 'saves', folder);
  fs.mkdirSync(dir, { recursive: true });
  if (level) fs.writeFileSync(path.join(dir, 'level.dat'), levelDat(folder));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const touch = (file, ms) => fs.utimesSync(file, new Date(ms), new Date(ms));
/** A backup file as the launcher names it ('auto', 'safety' or '' for one made by hand), dated `ms`. */
function fakeBackup(instance, world, ms, kind = 'auto') {
  const dir = path.join(instance.dir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = `${world}-${stamp(new Date(ms))}${kind === 'auto' ? '-auto' : kind === 'safety' ? '-przed-przywroceniem' : ''}.zip`;
  fs.writeFileSync(path.join(dir, file), 'zip');
  touch(path.join(dir, file), ms);
  return file;
}
const backupNames = (instance) => fs.readdirSync(path.join(instance.dir, 'backups')).sort();
const tree = (dir) => fs.readdirSync(dir, { recursive: true }).map((p) => p.split(path.sep).join('/')).filter((p) => fs.statSync(path.join(dir, p)).isFile()).sort();
const read = (instance, folder, rel) => fs.readFileSync(path.join(instance.dir, 'saves', folder, rel), 'utf8');
const notesDir = (instance) => path.join(instance.dir, '.hammer', 'przywracanie-swiatow');
const notes = (instance) => (fs.existsSync(notesDir(instance)) ? fs.readdirSync(notesDir(instance)) : []);

test('retention: the newest N automatic backups and the newest one of each of the last 7 days stay', async () => {
  const instance = { id: 'hs', dir: tmpDir() };
  const W = 'Nasz świat';
  const today = Array.from({ length: 10 }, (_, i) => fakeBackup(instance, W, at(14, 10 + i, 5))); // ten sessions today
  const yesterdayEarly = fakeBackup(instance, W, at(13, 18, 10));
  const yesterday = fakeBackup(instance, W, at(13, 21, 40));
  const day11 = fakeBackup(instance, W, at(11, 12, 0));
  const day9early = fakeBackup(instance, W, at(9, 8, 0));
  const day9 = fakeBackup(instance, W, at(9, 20, 0));
  const day8 = fakeBackup(instance, W, at(8, 9, 0)); // six days before today – still one of the seven days
  const day7 = fakeBackup(instance, W, at(7, 22, 0)); // seven days before – no longer
  const october = fakeBackup(instance, W, at(30, 10, 0, 9));
  // Never removed by themselves: one made by hand, the game's own, another world's.
  const manual = fakeBackup(instance, W, at(1, 12, 0), '');
  fs.writeFileSync(path.join(instance.dir, 'backups', `2026-11-02_10-00-00_${W}.zip`), 'zip');
  touch(path.join(instance.dir, 'backups', `2026-11-02_10-00-00_${W}.zip`), at(2, 10, 0));
  const other = fakeBackup(instance, 'Inny', at(1, 9, 0));

  const removed = await autoBackup.prune(instance, W, 5, { now: NOW });
  assert.deepEqual(removed.sort(), [...today.slice(0, 5), yesterdayEarly, day9early, day7, october].sort());
  assert.deepEqual(backupNames(instance), [...today.slice(5), yesterday, day11, day9, day8, manual, `2026-11-02_10-00-00_${W}.zip`, other].sort(), 'yesterday 21:40 survived ten sessions today');
  assert.deepEqual(await autoBackup.prune(instance, W, 5, { now: NOW }), [], 'nothing more to remove');
  // A day later the oldest of the seven days drops out; the newest five are still today's.
  assert.deepEqual(await autoBackup.prune(instance, W, 5, { now: at(15, 12, 0) }), [day8]);
  // Keeping one: the newest of each day stays all the same.
  assert.deepEqual((await autoBackup.prune(instance, W, 1, { now: at(15, 12, 0) })).sort(), today.slice(5, 9).sort());
  assert.deepEqual(backupNames(instance), [today[9], yesterday, day11, day9, manual, `2026-11-02_10-00-00_${W}.zip`, other].sort());
  assert.deepEqual(await autoBackup.prune(instance, 'Inny', 1, { now: NOW }), [], 'another world\'s only backup is its newest');
});

test('retention: the pure rule – days in local time, also across the change to winter time', () => {
  const b = (file, createdAt) => ({ file, createdAt });
  // Newest first, as listBackups gives them.
  const list = [b('a', at(14, 9)), b('b', at(14, 1)), b('c', at(13, 23, 59)), b('d', at(13, 0, 1)), b('e', at(12, 23, 59))];
  assert.deepEqual([...autoBackup.retained(list, 1, NOW)].sort(), ['a', 'c', 'e']);
  assert.deepEqual([...autoBackup.retained(list, 3, NOW)].sort(), ['a', 'b', 'c', 'e']);
  assert.deepEqual([...autoBackup.retained([], 5, NOW)], []);
  // 25 October 2026 has 25 hours in Poland: its midnight is still "yesterday" on the 26th, its last hour too.
  assert.equal(autoBackup.midnight(at(26, 10, 0, 9), 1), at(25, 0, 0, 9));
  assert.equal(autoBackup.midnight(at(26, 10, 0, 9), 1), at(26, 0, 0, 9) - 25 * 3600e3);
  const dst = [b('late', at(25, 23, 30, 9)), b('early', at(25, 0, 30, 9)), b('before', at(24, 23, 0, 9))];
  assert.deepEqual([...autoBackup.retained(dst, 1, at(26, 10, 0, 9))].sort(), ['before', 'late']);
});

test('„Przywróć wczorajszą wersję”: the newest automatic backup from before today\'s midnight', () => {
  const b = (file, createdAt, more = {}) => ({ file, createdAt, size: 100, world: 'W', auto: true, ...more });
  const list = [b('today', at(14, 9)), b('manual', at(13, 23), { auto: false }), b('other', at(13, 22, 0), { world: 'X' }), b('yesterday', at(13, 21, 40)), b('older', at(10, 8))];
  assert.deepEqual(autoBackup.previousVersion(list, 'W', NOW), { file: 'yesterday', createdAt: at(13, 21, 40), size: 100, yesterday: true });
  // Only backups older than yesterday: the button names that day.
  assert.deepEqual(autoBackup.previousVersion(list.filter((x) => x.file !== 'yesterday'), 'W', NOW), { file: 'older', createdAt: at(10, 8), size: 100, yesterday: false });
  assert.equal(autoBackup.previousVersion([b('today', at(14, 9))], 'W', NOW), null, 'nothing from before today');
  assert.equal(autoBackup.previousVersion(list, 'Nie ma', NOW), null);
  // Just after midnight the evening before is "yesterday"; across the change of time too.
  assert.equal(autoBackup.previousVersion([b('x', at(13, 23, 59))], 'W', at(14, 0, 1)).yesterday, true);
  assert.equal(autoBackup.previousVersion([b('x', at(25, 0, 30, 9))], 'W', at(26, 18, 0, 9)).yesterday, true);
});

test('retention: a backup from before a restore stays a week – the newest one of a world always', async () => {
  const instance = { id: 'hs', dir: tmpDir() };
  const newest = fakeBackup(instance, 'W', at(1, 10, 0), 'safety');
  const old = fakeBackup(instance, 'W', at(20, 10, 0, 9), 'safety');
  const recent = fakeBackup(instance, 'W', at(12, 10, 0), 'safety');
  touch(path.join(instance.dir, 'backups', newest), at(13, 10, 0));
  const otherWorld = fakeBackup(instance, 'X', at(1, 9, 0), 'safety');
  const list = await worlds.listBackups(instance);
  assert.deepEqual(list.map((x) => [x.world, x.safety, x.auto]), [['W', true, false], ['W', true, false], ['X', true, false], ['W', true, false]]);
  assert.deepEqual(await autoBackup.prune(instance, 'W', 5, { now: NOW }), [old]);
  assert.deepEqual(backupNames(instance), [newest, otherWorld, recent].sort());
  // A month later only the newest one is left – the way back from the last restore.
  assert.deepEqual(await autoBackup.prune(instance, 'W', 5, { now: at(14, 12, 0, 11) }), [recent]);
  assert.deepEqual(await autoBackup.prune(instance, 'X', 5, { now: at(14, 12, 0, 11) }), []);
  assert.deepEqual([worlds.backupWorldName('W-2026-11-13_10-00-przed-przywroceniem (2).zip'), worlds.isSafetyBackup('W-2026-11-13_10-00-przed-przywroceniem (2).zip'), worlds.isAutoBackup('W-2026-11-13_10-00-przed-przywroceniem.zip')], ['W', true, false]);
});

test('restore in place: the folder keeps its name, the state before is kept as a backup – and „Cofnij” brings it back', async () => {
  const instance = { id: 'hs', dir: tmpDir() };
  const W = 'Nasz świat';
  makeWorld(instance, W, { 'region/r.0.0.mca': 'wczoraj', 'data/raids.dat': 'raids', 'icon.png': 'png' });
  const yesterday = await worlds.backup(instance, W, { auto: true, now: new Date(at(13, 21, 40)) });
  // Played today: a region changed, one added, one file gone – and the game left its lock.
  fs.writeFileSync(path.join(instance.dir, 'saves', W, 'region/r.0.0.mca'), 'dziś');
  fs.writeFileSync(path.join(instance.dir, 'saves', W, 'region/r.1.0.mca'), 'nowy region');
  fs.rmSync(path.join(instance.dir, 'saves', W, 'data/raids.dat'));
  fs.writeFileSync(path.join(instance.dir, 'saves', W, 'session.lock'), '☃');
  makeWorld(instance, 'Inny', { 'x.txt': 'nietknięty' });

  const steps = [];
  const res = await worlds.restoreInPlace(instance, W, yesterday.file, { now: new Date(at(14, 15, 30)), onProgress: (p) => steps.push(p) });
  assert.equal(res.folder, W);
  assert.equal(res.safety.file, `${W}-2026-11-14_15-30-przed-przywroceniem.zip`);
  assert.ok(res.safety.size > 0 && res.safety.createdAt > 0);
  assert.equal(res.from.file, yesterday.file);
  assert.deepEqual(tree(path.join(instance.dir, 'saves', W)), ['data/raids.dat', 'icon.png', 'level.dat', 'region/r.0.0.mca']);
  assert.deepEqual([read(instance, W, 'region/r.0.0.mca'), read(instance, W, 'data/raids.dat')], ['wczoraj', 'raids']);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')).sort(), ['Inny', W], 'no hidden folder left in saves/');
  assert.deepEqual(notes(instance), [], 'the note of the swap is gone');
  assert.equal(read(instance, 'Inny', 'x.txt'), 'nietknięty');
  assert.ok(steps.length && steps.every((p) => p.done <= p.total) && steps.at(-1).done === steps.at(-1).total);
  const safety = (await worlds.listBackups(instance)).find((b) => b.file === res.safety.file);
  assert.deepEqual([safety.world, safety.safety, safety.auto], [W, true, false]);
  assert.deepEqual((await worlds.list(instance)).map((w) => [w.folder, w.name, w.broken]).sort(), [['Inny', 'Inny', false], [W, W, false]], 'the game sees the same world under the same folder');

  // „Cofnij”: the safety backup goes back in place – today's state again (and today's state of now is kept too).
  const undo = await worlds.restoreInPlace(instance, W, res.safety.file, { now: new Date(at(14, 15, 31)) });
  assert.deepEqual(tree(path.join(instance.dir, 'saves', W)), ['icon.png', 'level.dat', 'region/r.0.0.mca', 'region/r.1.0.mca']);
  assert.deepEqual([read(instance, W, 'region/r.0.0.mca'), read(instance, W, 'region/r.1.0.mca')], ['dziś', 'nowy region']);
  assert.equal(undo.safety.file, `${W}-2026-11-14_15-31-przed-przywroceniem.zip`);
  assert.deepEqual(backupNames(instance), [yesterday.file, res.safety.file, undo.safety.file].sort());
});

test('restore in place: a broken backup or a failed swap leaves the world exactly as it was', async () => {
  const instance = { id: 'hs', dir: tmpDir() };
  const backups = path.join(instance.dir, 'backups');
  makeWorld(instance, 'W', { 'region/r.0.0.mca': 'obecny' });
  fs.mkdirSync(backups, { recursive: true });
  const before = tree(path.join(instance.dir, 'saves', 'W'));

  // level.dat that does not read: refused before anything is packed or moved.
  const broken = new AdmZip();
  broken.addFile('W/level.dat', Buffer.from('to nie jest level.dat'));
  broken.addFile('W/region/r.0.0.mca', Buffer.from('stary'));
  broken.writeZip(path.join(backups, 'W-2026-11-13_21-40-auto.zip'));
  await assert.rejects(worlds.restoreInPlace(instance, 'W', 'W-2026-11-13_21-40-auto.zip'), /level\.dat jest uszkodzony\. Świat został bez zmian\./);
  const noLevel = new AdmZip();
  noLevel.addFile('mods/sodium.jar', Buffer.from('jar'));
  noLevel.writeZip(path.join(backups, 'W-2026-11-12_10-00-auto.zip'));
  await assert.rejects(worlds.restoreInPlace(instance, 'W', 'W-2026-11-12_10-00-auto.zip'), /nie ma pliku level\.dat/);
  fs.writeFileSync(path.join(backups, 'zepsuty.zip'), 'not a zip');
  await assert.rejects(worlds.restoreInPlace(instance, 'W', 'zepsuty.zip'), /nie jest poprawny plik \.zip/);
  await assert.rejects(worlds.restoreInPlace(instance, 'Nie ma', 'zepsuty.zip'), /Nie ma już takiego świata/);
  await assert.rejects(worlds.restoreInPlace(instance, 'W', '../../W.zip'), /Nieprawidłowa nazwa kopii/);
  assert.deepEqual(tree(path.join(instance.dir, 'saves', 'W')), before);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')), ['W']);
  assert.deepEqual(fs.readdirSync(backups).filter((f) => worlds.isSafetyBackup(f)), [], 'nothing was packed for a backup that cannot be restored');

  // The new world cannot be moved in (here: a disk error on that one rename) → the old one goes straight back.
  const good = await worlds.backup(instance, 'W', { auto: true, now: new Date(at(13, 10, 0)) });
  fs.writeFileSync(path.join(instance.dir, 'saves', 'W', 'region/r.0.0.mca'), 'po kopii');
  const rename = fsp.rename;
  fsp.rename = async (from, to) => {
    if (path.basename(from).startsWith('.przywracanie-')) throw Object.assign(new Error('i/o error'), { code: 'EIO' });
    return rename(from, to);
  };
  try {
    await assert.rejects(worlds.restoreInPlace(instance, 'W', good.file), /^Error: Nie udało się przywrócić świata: i\/o error\.$/);
  } finally {
    fsp.rename = rename;
  }
  assert.equal(read(instance, 'W', 'region/r.0.0.mca'), 'po kopii');
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')), ['W'], 'neither the unpacked copy nor the old one is left');
  assert.deepEqual(notes(instance), []);
  assert.deepEqual(fs.readdirSync(backups).filter((f) => worlds.isSafetyBackup(f)), [], 'the world did not change – no backup of it is left over');

  // Worse: the old world cannot even go back right away. The note and the safety backup stay, and the next
  // recovery puts the old world back in its folder.
  fsp.rename = async (from, to) => {
    if (path.basename(from).startsWith('.przywracanie-') || path.basename(from).startsWith('.przed-przywroceniem-')) throw Object.assign(new Error('i/o error'), { code: 'EIO' });
    return rename(from, to);
  };
  try {
    await assert.rejects(worlds.restoreInPlace(instance, 'W', good.file), /i\/o error/);
  } finally {
    fsp.rename = rename;
  }
  assert.equal(fs.existsSync(path.join(instance.dir, 'saves', 'W')), false, 'the moment a crash would hit');
  assert.equal(notes(instance).length, 1);
  assert.equal(fs.readdirSync(backups).filter((f) => worlds.isSafetyBackup(f)).length, 1, 'the state before is kept');
  assert.deepEqual(worlds.recoverSwaps(instance), ['W']);
  assert.equal(read(instance, 'W', 'region/r.0.0.mca'), 'po kopii');
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')), ['W']);
  assert.deepEqual(notes(instance), []);
});

test('restore in place: a swap cut off by a crash is finished or undone – never a missing world', () => {
  const instance = { id: 'hs', dir: tmpDir() };
  const saves = path.join(instance.dir, 'saves');
  const note = (id, folder) => {
    fs.mkdirSync(notesDir(instance), { recursive: true });
    fs.writeFileSync(path.join(notesDir(instance), `${id}.json`), JSON.stringify({ v: 1, folder, file: `${folder}-2026-11-13_21-40-auto.zip` }));
  };
  // A: the old world was moved away, the new one not yet in – the new one (complete, checked) goes in.
  makeWorld(instance, '.przed-przywroceniem-aaaaaaaa', { 'mark.txt': 'stary' });
  makeWorld(instance, '.przywracanie-aaaaaaaa', { 'mark.txt': 'nowy' });
  note('aaaaaaaa', 'A');
  // B: the old world was moved away and the unpacked one is not a whole world → the old one comes back.
  makeWorld(instance, '.przed-przywroceniem-bbbbbbbb', { 'mark.txt': 'stary' });
  makeWorld(instance, '.przywracanie-bbbbbbbb', { 'mark.txt': 'pół' }, { level: false });
  note('bbbbbbbb', 'B');
  // C: the new world is in place, the old copy was not deleted yet.
  makeWorld(instance, 'C', { 'mark.txt': 'nowy' });
  makeWorld(instance, '.przed-przywroceniem-cccccccc', { 'mark.txt': 'stary' });
  note('cccccccc', 'C');
  // D: cut off right after the note – nothing moved yet: the world stays as it was.
  makeWorld(instance, 'D', { 'mark.txt': 'stary' });
  makeWorld(instance, '.przywracanie-dddddddd', { 'mark.txt': 'nowy' });
  note('dddddddd', 'D');
  // An unpacking that never finished (no note), a note that is not ours, and the player's own hidden folder.
  makeWorld(instance, '.przywracanie-eeeeeeee', { 'mark.txt': 'pół' });
  note('ffffffff', '../poza');
  fs.mkdirSync(path.join(saves, '.moje'));

  assert.deepEqual(worlds.recoverSwaps(instance).sort(), ['A', 'B', 'C', 'D']);
  assert.deepEqual(fs.readdirSync(saves).sort(), ['.moje', 'A', 'B', 'C', 'D']);
  assert.deepEqual(['A', 'B', 'C', 'D'].map((w) => read(instance, w, 'mark.txt')), ['nowy', 'stary', 'nowy', 'stary']);
  assert.deepEqual(notes(instance), []);
  assert.deepEqual(worlds.recoverSwaps(instance), [], 'safe to run again');
  assert.deepEqual(worlds.recoverSwaps({ id: 'x', dir: tmpDir() }), [], 'an instance without saves');
});

/* ── services ── */

function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

function setup({ plus = true, now = () => NOW } = {}) {
  const keys = plusKeys();
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop', plusPublicKey: keys.publicKey }, accounts: { list: () => [GRACZ], launchAuth: async () => Promise.reject(new Error('Zaloguj się kontem Microsoft.')) }, launchFn: async () => fakeChild(), now });
  if (plus) s.plus.activate(keys.code({ mc: GRACZ.id }));
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  return { s, instance, keys, start: () => s.games.start({ instance: s.instances.get(instance.id), options: {} }) };
}

test('services: „Przywróć wczorajszą wersję” – Hammer+, never under a running game, „Cofnij” always works', async () => {
  const { s, instance, keys, start } = setup();
  const W = 'Nasz świat';
  makeWorld(instance, W, { 'region/r.0.0.mca': 'wczoraj' });
  makeWorld(instance, 'Bez kopii');
  const auto = await worlds.backup(instance, W, { auto: true, now: new Date(at(13, 21, 40)) });
  touch(path.join(instance.dir, 'backups', auto.file), at(13, 21, 42));
  const today = await worlds.backup(instance, W, { auto: true, now: new Date(at(14, 12, 0)) });
  touch(path.join(instance.dir, 'backups', today.file), at(14, 12, 1));
  fs.writeFileSync(path.join(instance.dir, 'saves', W, 'region/r.0.0.mca'), 'dziś');

  // The list says which version the button puts back.
  const list = await s.worlds.list(instance.id);
  assert.deepEqual(list.find((w) => w.folder === W).previous, { file: auto.file, createdAt: at(13, 21, 42), size: auto.size, yesterday: true });
  assert.equal(list.find((w) => w.folder === 'Bez kopii').previous, null);

  // Never while the game of the instance runs.
  const child = await start();
  await assert.rejects(s.worlds.restoreInPlace(instance.id, W, auto.file), /^Error: Najpierw zamknij grę – gra nadpisałaby przywrócony świat\.$/);
  child.emit('exit', 0, null);
  await s.afterSessions();
  await assert.rejects(s.worlds.restoreInPlace(instance.id, 'Bez kopii', auto.file), /z innego świata/);
  await assert.rejects(s.worlds.restoreInPlace(instance.id, W, 'Nie ma-2026-11-13_21-40-auto.zip'), /Nie ma już takiej kopii/);

  // A backup from before a restore older than a week goes with the restore's clean-up; a newer one stays.
  const oldSafety = fakeBackup(instance, W, at(1, 10, 0), 'safety');
  const recentSafety = fakeBackup(instance, W, at(12, 10, 0), 'safety');
  const oldAuto = fakeBackup(instance, W, at(20, 10, 0, 9)); // beyond the automatic ones kept – the restore leaves it to the next session

  // During the restore the game cannot be started.
  const running = s.worlds.restoreInPlace(instance.id, W, auto.file);
  await assert.rejects(s.launch(instance.id), /Poczekaj, aż launcher skończy/);
  await assert.rejects(s.worlds.restoreInPlace(instance.id, W, auto.file), /Poczekaj, aż skończy się kopia zapasowa albo przywracanie świata/);
  const res = await running;
  assert.equal(read(instance, W, 'region/r.0.0.mca'), 'wczoraj');
  assert.match(res.safety.file, /^Nasz świat-2026-11-14_23-30-przed-przywroceniem\.zip$/);
  const names = backupNames(instance);
  assert.ok(!names.includes(oldSafety) && names.includes(recentSafety) && names.includes(res.safety.file) && names.includes(today.file) && names.includes(oldAuto));

  // Hammer+ ends: the one-click restore is locked – the way back is not.
  s.plus.remove();
  await assert.rejects(s.worlds.restoreInPlace(instance.id, W, auto.file), /Przywracanie wcześniejszej wersji świata to funkcja Hammer\+/);
  await s.worlds.restoreInPlace(instance.id, W, res.safety.file);
  assert.equal(read(instance, W, 'region/r.0.0.mca'), 'dziś');
  // A swap a crash cut off is finished when the list is read.
  makeWorld(instance, '.przywracanie-0badc0de', { 'x.txt': 'pół' });
  await s.worlds.list(instance.id);
  assert.ok(!fs.existsSync(path.join(instance.dir, 'saves', '.przywracanie-0badc0de')));
  s.plus.activate(keys.code({ mc: GRACZ.id }));
});

test('settings: automatic backups switch on once for files from before – a player\'s „off” after that stays', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'settings.json');
  // A file written by 2.9: false only because that was the default then.
  fs.writeFileSync(file, JSON.stringify({ autoBackup: false, autoBackupKeep: 8, memoryMb: 4096 }));
  const first = createSettings(file);
  assert.deepEqual([first.get().autoBackup, first.get().autoBackupKeep, first.get().memoryMb], [true, 8, 4096]);
  first.set({ autoBackup: false });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).settingsVersion, SETTINGS_VERSION);
  assert.equal(createSettings(file).get().autoBackup, false, 'switched off after the update – stays off');
  // A new install, and a file that is not an object.
  assert.equal(createSettings(path.join(dir, 'nowy.json')).get().autoBackup, true);
  assert.deepEqual(migrate(null), {});
  assert.deepEqual(migrate({ autoBackup: false, settingsVersion: SETTINGS_VERSION }), { autoBackup: false, settingsVersion: SETTINGS_VERSION });
});
