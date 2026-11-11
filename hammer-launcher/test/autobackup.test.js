'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const worlds = require('../src/main/worlds');
const autoBackup = require('../src/main/autobackup');
const { createServices } = require('../src/main/services');
const { writeNbt, tag } = require('../src/main/nbt');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 11, 18, 0); // when the game session started

function makeWorld(instance, folder, { savedAt, openedAt = null, files = { 'region/r.0.0.mca': Buffer.alloc(4000, 7) } } = {}) {
  const dir = path.join(instance.dir, 'saves', folder);
  fs.mkdirSync(dir, { recursive: true });
  const level = Object.assign(tag.compound({ Data: tag.compound({ LevelName: tag.string(folder), GameType: tag.int(0) }) }), { name: '' });
  fs.writeFileSync(path.join(dir, 'level.dat'), writeNbt(level, { gzip: true }));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  touch(path.join(dir, 'level.dat'), savedAt);
  if (openedAt) {
    fs.writeFileSync(path.join(dir, 'session.lock'), '☃');
    touch(path.join(dir, 'session.lock'), openedAt);
  }
  return dir;
}
const touch = (file, ms) => fs.utimesSync(file, new Date(ms), new Date(ms));
const names = (instance) => fs.readdirSync(path.join(instance.dir, 'backups')).sort();

test('automatic backups: only the worlds the game touched during the session', async () => {
  const instance = { id: 'hs', dir: tmpDir() };
  assert.deepEqual(await autoBackup.changedWorlds(instance, T0), [], 'no saves folder');
  makeWorld(instance, 'Grany', { savedAt: T0 + 40 * MIN, openedAt: T0 + 5 * MIN });
  makeWorld(instance, 'Stary', { savedAt: T0 - 3 * 24 * 60 * MIN, openedAt: T0 - 3 * 24 * 60 * MIN });
  makeWorld(instance, 'Tylko otwarty', { savedAt: T0 - 60 * MIN, openedAt: T0 + 2 * MIN }); // opened, the game crashed before saving
  makeWorld(instance, 'Na styk', { savedAt: T0 - 1500 }); // coarse file times: two seconds of slack
  fs.mkdirSync(path.join(instance.dir, 'saves', 'Nie świat'));
  fs.mkdirSync(path.join(instance.dir, 'saves', '.przywracanie-abc'));
  fs.writeFileSync(path.join(instance.dir, 'saves', 'plik.txt'), 'x');
  assert.deepEqual(await autoBackup.changedWorlds(instance, T0), ['Grany', 'Na styk', 'Tylko otwarty']);
  assert.deepEqual(await autoBackup.changedWorlds(instance, T0 + 60 * MIN), []);

  const result = await autoBackup.run(instance, { since: T0 });
  assert.deepEqual(result.made.map((b) => [b.world, b.auto, /^.+-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-auto\.zip$/.test(b.file)]), [['Grany', true, true], ['Na styk', true, true], ['Tylko otwarty', true, true]]);
  assert.deepEqual([result.failed, result.removed], [[], []]);
  assert.equal(names(instance).length, 3);
  // The game was started again in the meantime → the run stops before the next world.
  let asked = 0;
  const stopped = await autoBackup.run(instance, { since: T0, stop: () => (asked += 1) > 1 });
  assert.deepEqual(stopped.made.map((b) => b.world), ['Grany']);
  // A world that cannot be packed is reported; the others are still done.
  const flaky = await autoBackup.run(instance, { since: T0, backup: async (world) => (world === 'Na styk' ? Promise.reject(new Error('Nie udało się zrobić kopii zapasowej: na dysku zabrakło miejsca.')) : worlds.backup(instance, world, { auto: true })) });
  assert.deepEqual([flaky.made.map((b) => b.world), flaky.failed], [['Grany', 'Tylko otwarty'], [{ world: 'Na styk', error: 'Nie udało się zrobić kopii zapasowej: na dysku zabrakło miejsca.' }]]);
});

test('automatic backups: the newest N per world stay; manual backups and the game\'s own are never removed', async () => {
  const instance = { id: 'hs', dir: tmpDir() };
  makeWorld(instance, 'Nasz świat', { savedAt: T0 + MIN });
  makeWorld(instance, 'Inny', { savedAt: T0 + MIN });
  const made = [];
  for (let day = 1; day <= 7; day += 1) {
    const b = await worlds.backup(instance, 'Nasz świat', { auto: true, now: new Date(2026, 10, day, 20, 15) });
    touch(path.join(instance.dir, 'backups', b.file), Date.UTC(2026, 10, day, 20));
    made.push(b.file);
  }
  assert.equal(made[0], 'Nasz świat-2026-11-01_20-15-auto.zip');
  const manual = await worlds.backup(instance, 'Nasz świat', { now: new Date(2026, 9, 1, 12, 0) });
  touch(path.join(instance.dir, 'backups', manual.file), Date.UTC(2026, 9, 1));
  const other = await worlds.backup(instance, 'Inny', { auto: true, now: new Date(2026, 9, 2, 12, 0) });
  touch(path.join(instance.dir, 'backups', other.file), Date.UTC(2026, 9, 2));
  fs.copyFileSync(path.join(instance.dir, 'backups', manual.file), path.join(instance.dir, 'backups', '2026-09-01_10-00-00_Nasz świat.zip'));
  const list = await worlds.listBackups(instance);
  assert.deepEqual(list.filter((b) => b.auto).length, 8);
  assert.deepEqual(list.filter((b) => !b.auto).map((b) => [b.file, b.world]).sort(), [['2026-09-01_10-00-00_Nasz świat.zip', 'Nasz świat'], ['Nasz świat-2026-10-01_12-00.zip', 'Nasz świat']]);
  assert.equal(worlds.backupWorldName('Nasz świat-2026-11-01_20-15-auto (2).zip'), 'Nasz świat');
  assert.deepEqual([worlds.isAutoBackup('Nasz świat-2026-11-01_20-15-auto (2).zip'), worlds.isAutoBackup('auto-2026-11-01_20-15.zip'), worlds.isAutoBackup('Mój-auto-2026-11-01_20-15.zip')], [true, false, false]);

  assert.deepEqual((await autoBackup.prune(instance, 'Nasz świat', 5)).sort(), made.slice(0, 2));
  assert.deepEqual(names(instance), ['2026-09-01_10-00-00_Nasz świat.zip', other.file, manual.file, ...made.slice(2)].sort(), 'the five newest automatic ones, and everything made by hand');
  assert.deepEqual(await autoBackup.prune(instance, 'Nasz świat', 5), [], 'nothing more to remove');
  assert.deepEqual(await autoBackup.prune(instance, 'Nasz świat', 1), made.slice(2, 6).reverse());
  assert.deepEqual(await autoBackup.prune(instance, 'Nasz świat', 0), [], 'a nonsense number means the default, never "remove all"');
  assert.deepEqual(await autoBackup.prune(instance, 'Nie ma', 1), []);
  assert.ok(names(instance).includes(other.file), 'another world\'s backups are its own');

  // A full run: one more backup, the list trimmed to what the player asked for.
  const run = await autoBackup.run(instance, { since: T0, keep: 2 });
  assert.deepEqual(run.made.map((b) => b.world), ['Inny', 'Nasz świat']);
  assert.equal((await worlds.listBackups(instance)).filter((b) => b.auto && b.world === 'Nasz świat').length, 2);
  assert.deepEqual(run.removed, []);
  const again = await autoBackup.run(instance, { since: T0, keep: 2 });
  assert.deepEqual(again.removed.map((file) => worlds.backupWorldName(file)), ['Inny', 'Nasz świat'], 'the oldest automatic backup of each world made room');
  assert.ok(!names(instance).includes(other.file) && !names(instance).includes(made[6]));
  assert.equal((await worlds.listBackups(instance)).filter((b) => b.auto && b.world === 'Nasz świat').length, 2);
  assert.ok(fs.existsSync(path.join(instance.dir, 'backups', manual.file)));
});

function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

/** Services with a fake game process; `plus` = Hammer+ active for the account. */
function setup({ plus = true } = {}) {
  const keys = plusKeys();
  const events = [];
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop', plusPublicKey: keys.publicKey }, accounts: { list: () => [GRACZ], launchAuth: async () => Promise.reject(new Error('Zaloguj się kontem Microsoft.')) }, emit: (channel, payload) => events.push({ channel, ...payload }), launchFn: async () => fakeChild() });
  if (plus) s.plus.activate(keys.code({ mc: GRACZ.id }));
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  const start = () => s.games.start({ instance: s.instances.get(instance.id), options: {} });
  const toasts = () => events.filter((e) => e.channel === 'toast').map((e) => e.text);
  return { s, instance, events, start, toasts, keys };
}

test('services: after a game session the worlds played are backed up – with Hammer+ and the option on', async () => {
  const { s, instance, events, start, toasts } = setup();
  makeWorld(instance, 'Stary', { savedAt: Date.now() - 24 * 60 * MIN });
  /** One game session in which the player was in `folders`. Worlds from earlier sessions look a minute old by then. */
  const session = async (...folders) => {
    for (const world of fs.readdirSync(path.join(instance.dir, 'saves'))) {
      for (const file of ['level.dat', 'session.lock']) if (fs.existsSync(path.join(instance.dir, 'saves', world, file)) && world !== 'Stary') touch(path.join(instance.dir, 'saves', world, file), Date.now() - MIN);
    }
    const child = await start();
    for (const folder of folders) makeWorld(instance, folder, { savedAt: Date.now(), openedAt: Date.now() });
    child.emit('exit', 0, null);
    await s.afterSessions();
  };

  // Off by default.
  await session('Nasz świat');
  assert.deepEqual(await s.worlds.listBackups(instance.id), []);

  s.settings.set({ autoBackup: true, autoBackupKeep: 2 });
  await session('Nasz świat');
  const first = await s.worlds.listBackups(instance.id);
  assert.deepEqual(first.map((b) => [b.world, b.auto]), [['Nasz świat', true]]);
  assert.deepEqual(toasts(), ['Automatyczna kopia świata „Nasz świat” jest gotowa.']);
  assert.deepEqual(events.filter((e) => e.channel === 'worlds:backups').map((e) => e.instanceId), [instance.id]);
  assert.deepEqual(events.filter((e) => e.channel === 'task:progress').at(-1), { channel: 'task:progress', label: 'Automatyczna kopia: Nasz świat', done: 1, total: 1 });

  // A session in which no world was opened makes no backup.
  await session();
  assert.equal((await s.worlds.listBackups(instance.id)).length, 1);

  // Two worlds in one session, a few times over – two automatic backups per world stay, the manual one too.
  const manual = await s.worlds.backup(instance.id, 'Nasz świat');
  for (let i = 0; i < 4; i += 1) await session('Drugi', 'Nasz świat');
  assert.match(toasts().at(-1), /^Automatyczne kopie światów są gotowe: „Drugi”, „Nasz świat”\.$/);
  const all = await s.worlds.listBackups(instance.id);
  assert.deepEqual([all.filter((b) => b.auto && b.world === 'Nasz świat').length, all.filter((b) => b.auto && b.world === 'Drugi').length], [2, 2]);
  assert.ok(all.some((b) => b.file === manual.file && !b.auto));

  // A crash counts as a session too.
  const before = all.length;
  const child = await start();
  makeWorld(instance, 'Po crashu', { savedAt: Date.now() + 1000 });
  child.emit('exit', 1, null);
  await s.afterSessions();
  assert.equal((await s.worlds.listBackups(instance.id)).length, before + 1);
});

test('services: an automatic backup holds the instance like a manual one and never runs under a running game', async () => {
  const { s, instance, start } = setup();
  s.settings.set({ autoBackup: true });
  const child = await start();
  makeWorld(instance, 'Duży', { savedAt: Date.now() + 1000, files: { 'region/r.0.0.mca': Buffer.alloc(3_000_000, 1) } });
  child.emit('exit', 0, null);
  // The backup has begun: the game cannot be started in the middle of it, nor the world changed.
  await assert.rejects(s.launch(instance.id), /Poczekaj, aż launcher skończy kopię zapasową świata/);
  await assert.rejects(s.worlds.remove(instance.id, 'Duży'), /Poczekaj, aż skończy się kopia/);
  await s.afterSessions();
  assert.equal((await s.worlds.listBackups(instance.id)).length, 1);
  await assert.rejects(s.launch(instance.id), /Zaloguj się kontem Microsoft/, 'free again');

  // Two instances: the one that still runs is left alone when the other one closes.
  const second = s.instances.create({ name: 'Druga', mcVersion: '1.21.1', loader: 'fabric' });
  makeWorld(second, 'Świat drugiej', { savedAt: Date.now() + 1000 });
  const running = await s.games.start({ instance: s.instances.get(second.id), options: {} });
  const mine = await start();
  makeWorld(instance, 'Duży', { savedAt: Date.now() + 1000 });
  mine.emit('exit', 0, null);
  await s.afterSessions();
  assert.equal((await s.worlds.listBackups(instance.id)).length, 2);
  assert.deepEqual(await s.worlds.listBackups(second.id), [], 'nothing of the running instance was packed');
  running.emit('exit', 0, null);
  await s.afterSessions();
  assert.equal((await s.worlds.listBackups(second.id)).length, 1);
});

test('services: without Hammer+ nothing is backed up by itself – manual backups keep working', async () => {
  const { s, instance, start, keys } = setup({ plus: false });
  assert.throws(() => s.settings.set({ autoBackup: true }), /Automatyczne kopie światów to funkcja Hammer\+/);
  // Hammer+ ended after the option was switched on: the option stays stored but does nothing.
  s.plus.activate(keys.code({ mc: GRACZ.id }));
  s.settings.set({ autoBackup: true });
  s.plus.remove();
  assert.equal(s.settings.get().autoBackup, true);
  const child = await start();
  makeWorld(instance, 'Nasz świat', { savedAt: Date.now() + 1000 });
  child.emit('exit', 0, null);
  await s.afterSessions();
  assert.deepEqual(await s.worlds.listBackups(instance.id), []);
  const manual = await s.worlds.backup(instance.id, 'Nasz świat');
  assert.deepEqual([manual.auto, (await s.worlds.listBackups(instance.id)).length], [false, 1]);
});
