'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { createServices } = require('../src/main/services');
const { writeNbt, tag } = require('../src/main/nbt');
const { tmpDir, mockFetch } = require('./helpers');

function setup(extra = {}) {
  const events = [];
  const trashed = [];
  const services = createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', server: { address: '' } },
    accounts: { launchAuth: async () => Promise.reject(new Error('Zaloguj się kontem Microsoft.')) },
    emit: (channel, payload) => events.push({ channel, ...payload }),
    trash: async (target) => {
      trashed.push(target);
      fs.rmSync(target, { recursive: true, force: true });
    },
    ...extra,
  });
  const instance = services.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  const world = path.join(instance.dir, 'saves', 'Nasz świat');
  fs.mkdirSync(path.join(world, 'region'), { recursive: true });
  const level = Object.assign(tag.compound({ Data: tag.compound({ LevelName: tag.string('Nasz świat'), GameType: tag.int(0), LastPlayed: tag.long(1762790400000n) }) }), { name: '' });
  fs.writeFileSync(path.join(world, 'level.dat'), writeNbt(level, { gzip: true }));
  fs.writeFileSync(path.join(world, 'region', 'r.0.0.mca'), Buffer.alloc(2000));
  const running = (on = true) => (on ? services.games.running.set(instance.id, { process: { kill() {} }, startedAt: Date.now(), logs: [] }) : services.games.running.delete(instance.id));
  return { services, instance, events, trashed, world, running };
}

test('services: server list and worlds of an instance, world removal through the trash', async () => {
  const { services, instance, trashed, world } = setup();
  assert.deepEqual(services.servers.add(instance.id, { name: 'HammerShop', address: 'mc.hammershop.pl' }).map((s) => s.address), ['mc.hammershop.pl']);
  assert.deepEqual(services.servers.list(instance.id).map((s) => s.name), ['HammerShop']);
  assert.throws(() => services.servers.list('nie-ma'), /Nie ma takiej instancji/);
  assert.throws(() => services.servers.add(instance.id, null), /Podaj poprawny adres/);
  assert.deepEqual((await services.worlds.list(instance.id)).map((w) => [w.folder, w.gameMode]), [['Nasz świat', 'Przetrwanie']]);
  assert.equal(services.worlds.dir(instance.id, 'Nasz świat'), world);
  assert.throws(() => services.worlds.dir(instance.id, '../mods'), /Nieprawidłowa nazwa świata/);
  assert.equal(await services.worlds.remove(instance.id, 'Nasz świat'), true);
  assert.deepEqual(trashed, [world]);
  assert.deepEqual(await services.worlds.list(instance.id), []);
});

test('services: a world backup reports progress in the sidebar and the bar always ends', async () => {
  const { services, instance, events, trashed } = setup();
  const made = await services.worlds.backup(instance.id, 'Nasz świat');
  const progress = events.filter((e) => e.channel === 'task:progress');
  assert.ok(progress.length >= 1);
  assert.deepEqual(progress.at(-1), { channel: 'task:progress', label: 'Kopia zapasowa: Nasz świat', done: 1, total: 1 });
  assert.deepEqual((await services.worlds.listBackups(instance.id)).map((b) => b.file), [made.file]);
  assert.deepEqual(await services.worlds.restoreBackup(instance.id, made.file), { folder: 'Nasz świat (2)' });
  events.length = 0;
  await assert.rejects(services.worlds.restoreBackup(instance.id, 'nie-ma.zip'), /Nie ma już takiej kopii/);
  await assert.rejects(services.worlds.backup(instance.id, 'Nie ma'), /Nie ma już takiego świata/);
  assert.deepEqual(events, [], 'a task that fails before it starts shows no bar');
  // A restore that fails half-way (the second file has a wrong checksum) still closes the bar it opened.
  const zip = new AdmZip();
  zip.addFile('W/a.bin', Buffer.alloc(40_000, 1));
  zip.addFile('W/level.dat', Buffer.from('level'));
  const bytes = zip.toBuffer();
  const central = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  bytes.writeUInt32LE(0xdeadbeef, bytes.indexOf(central, bytes.indexOf(central) + 4) + 16);
  fs.writeFileSync(path.join(instance.dir, 'backups', 'zepsuta.zip'), bytes);
  await assert.rejects(services.worlds.restoreBackup(instance.id, 'zepsuta.zip'), /sumę kontrolną/);
  assert.ok(events.length >= 2);
  assert.deepEqual(events.at(-1), { channel: 'task:progress', label: 'Przywracanie świata z kopii', done: 1, total: 1 });
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'saves')).sort(), ['Nasz świat', 'Nasz świat (2)'], 'and leaves no half-restored world');
  await services.worlds.removeBackup(instance.id, made.file);
  assert.deepEqual(trashed.map((p) => path.basename(p)), [made.file]);
});

test('services: nothing is changed under a running game', async () => {
  const { services, instance, running, world } = setup();
  running();
  await assert.rejects(services.worlds.remove(instance.id, 'Nasz świat'), /Najpierw zamknij grę/);
  await assert.rejects(services.worlds.rename(instance.id, 'Nasz świat', 'Inna'), /Najpierw zamknij grę/);
  await assert.rejects(services.worlds.backup(instance.id, 'Nasz świat'), /Najpierw zamknij grę/);
  await assert.rejects(services.worlds.restoreBackup(instance.id, 'x.zip'), /Najpierw zamknij grę/);
  assert.throws(() => services.repairInstance(instance.id), /Najpierw zamknij grę/);
  await assert.rejects(services.cleanup.apply(['cache']), /Najpierw zamknij grę/);
  assert.ok(fs.existsSync(world));
  // Looking is always fine.
  assert.equal((await services.worlds.list(instance.id)).length, 1);
  assert.deepEqual(await services.cleanup.plan(), { total: 0, groups: [] });
  running(false);
  assert.equal((await services.worlds.rename(instance.id, 'Nasz świat', 'Inna')).name, 'Inna');
  fs.mkdirSync(services.paths.cache, { recursive: true });
  fs.writeFileSync(path.join(services.paths.cache, 'x.part'), 'abc');
  assert.deepEqual(await services.cleanup.apply(['cache']), { freed: 3, removed: 1, failed: 0 });
  assert.equal((await services.cleanup.usage()).instances[0].id, instance.id);
});

test('services: while a world is being backed up the game cannot start and the world cannot be changed', async () => {
  const { services, instance, world } = setup();
  fs.writeFileSync(path.join(world, 'region', 'r.1.0.mca'), Buffer.alloc(3_000_000, 1));
  const backup = services.worlds.backup(instance.id, 'Nasz świat');
  await assert.rejects(services.launch(instance.id), /Poczekaj, aż launcher skończy kopię zapasową/);
  await assert.rejects(services.worlds.remove(instance.id, 'Nasz świat'), /Poczekaj, aż skończy się kopia/);
  await assert.rejects(services.worlds.backup(instance.id, 'Nasz świat'), /Poczekaj, aż skończy się kopia/);
  const made = await backup;
  assert.ok(made.size > 0);
  await assert.rejects(services.launch(instance.id), /Zaloguj się kontem Microsoft/, 'free again once the backup is done');
});

test('services: "Napraw instancję" asks for a fresh loader install and a full file check on the next start', () => {
  const { services, instance } = setup();
  services.instances.patchInternal(instance.id, { versionId: 'fabric-loader-0.16.9-1.21.1', installedFor: '1.21.1|fabric|', optimizedFor: '1.21.1|fabric', playTimeMs: 5000 });
  const fixed = services.repairInstance(instance.id);
  assert.deepEqual([fixed.versionId, fixed.installedFor, fixed.verifyFiles], [null, null, true]);
  assert.deepEqual([fixed.name, fixed.mcVersion, fixed.loader, fixed.optimizedFor, fixed.playTimeMs], ['Hammer', '1.21.1', 'fabric', '1.21.1|fabric', 5000], 'nothing else changes');
  assert.equal(services.instances.get(instance.id).verifyFiles, true, 'saved in instance.json');
  // The installer clears the flag with `verifyFiles: undefined` once the check is done.
  assert.equal('verifyFiles' in services.instances.patchInternal(instance.id, { verifyFiles: undefined }), false);
  assert.throws(() => services.repairInstance('nie-ma'), /Nie ma takiej instancji/);
});

test('services: launching on a server or in a world checks what the window sent before anything starts', async () => {
  const { services, instance } = setup();
  await assert.rejects(services.launch(instance.id, { server: 'to nie adres' }), /Podaj poprawny adres serwera/);
  await assert.rejects(services.launch(instance.id, { server: 'x.pl; rm -rf' }), /Podaj poprawny adres serwera/);
  await assert.rejects(services.launch(instance.id, { world: '../../etc' }), /Nieprawidłowa nazwa świata/);
  await assert.rejects(services.launch(instance.id, { world: 'Nie ma takiego' }), /Nie ma już takiego świata/);
  // A refused start leaves the instance free: the next try gets as far as the login.
  await assert.rejects(services.launch(instance.id, { world: 'Nasz świat' }), /Zaloguj się kontem Microsoft/);
  await assert.rejects(services.launch(instance.id, { server: 'mc.hammershop.pl:25565' }), /Zaloguj się kontem Microsoft/);
});

test('services: "Wyślij logi" sends the log of the last game, or the game\'s latest.log after a restart', async () => {
  const fetchFn = mockFetch([{ match: /api\.mclo\.gs\/1\/log$/, json: { success: true, id: 'abc', url: 'https://mclo.gs/abc' } }]);
  const { services, instance, running } = setup({ fetchFn });
  await assert.rejects(services.shareLog(instance.id), /Nie ma jeszcze żadnych logów/);
  fs.mkdirSync(path.join(instance.dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'logs', 'latest.log'), '[main/INFO]: from latest.log --accessToken SECRET123\n');
  assert.deepEqual(await services.shareLog(instance.id), { url: 'https://mclo.gs/abc', id: 'abc' });
  assert.equal(new URLSearchParams(fetchFn.calls.at(-1).init.body).get('content'), '[main/INFO]: from latest.log --accessToken <ukryty token>\n');
  running();
  services.games.running.get(instance.id).logs.push({ line: '[Render thread/INFO]: live line 1' }, { line: '[Render thread/ERROR]: live line 2' });
  await services.shareLog(instance.id);
  assert.equal(new URLSearchParams(fetchFn.calls.at(-1).init.body).get('content'), '[Render thread/INFO]: live line 1\n[Render thread/ERROR]: live line 2');
  await assert.rejects(services.shareLog('nie-ma'), /Nie ma takiej instancji/);
});

/** A folder that stands for the official Minecraft's game folder, with two servers on its list. */
function officialFolder() {
  const dir = tmpDir();
  const root = Object.assign(tag.compound({ servers: tag.list('compound', [tag.compound({ name: tag.string('Hypixel'), ip: tag.string('mc.hypixel.net') }), tag.compound({ name: tag.string('HammerShop'), ip: tag.string('mc.hammershop.pl') })]) }), { name: '' });
  fs.writeFileSync(path.join(dir, 'servers.dat'), writeNbt(root));
  return dir;
}

test('services: the servers of the official Minecraft are added to an instance once, and on request', () => {
  const officialDir = officialFolder();
  const { services, instance, events } = setup({ officialDir });
  services.servers.add(instance.id, { name: 'Mój', address: 'moj.serwer.pl' });

  assert.deepEqual(services.servers.official(), { available: true });
  // First look at the list: the official servers join the instance's own one.
  assert.deepEqual(services.servers.list(instance.id).map((s) => s.address), ['moj.serwer.pl', 'mc.hypixel.net', 'mc.hammershop.pl']);
  assert.match(events.find((e) => e.channel === 'toast')?.text ?? '', /Dodano 2 serwery z Twojego Minecrafta/);
  assert.equal(services.instances.get(instance.id).serversImported, true);

  // Only once: a server the player removes does not come back by itself…
  services.servers.remove(instance.id, 1, 'mc.hypixel.net');
  assert.deepEqual(services.servers.list(instance.id).map((s) => s.address), ['moj.serwer.pl', 'mc.hammershop.pl']);
  assert.equal(events.filter((e) => e.channel === 'toast').length, 1);
  // …but the button brings it back.
  const result = services.servers.importOfficial(instance.id);
  assert.deepEqual([result.added, result.skipped, result.servers.map((s) => s.address)], [1, 1, ['moj.serwer.pl', 'mc.hammershop.pl', 'mc.hypixel.net']]);
});

test('services: without an official Minecraft nothing is imported and the button explains why', () => {
  const none = setup(); // no folder configured (tests, live check)
  assert.deepEqual(none.services.servers.official(), { available: false });
  assert.deepEqual(none.services.servers.list(none.instance.id), []);
  assert.throws(() => none.services.servers.importOfficial(none.instance.id), /Nie znalazłem listy serwerów zwykłego Minecrafta/);

  const missing = setup({ officialDir: path.join(tmpDir(), '.minecraft') }); // configured, but the game was never installed
  assert.deepEqual(missing.services.servers.official(), { available: false });
  assert.deepEqual(missing.services.servers.list(missing.instance.id), []);
  assert.equal(missing.services.instances.get(missing.instance.id).serversImported, undefined, 'it is tried again once the game exists');
  assert.equal(missing.events.filter((e) => e.channel === 'toast').length, 0);
});
