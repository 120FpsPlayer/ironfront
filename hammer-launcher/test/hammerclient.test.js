'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadHammerClient, syncHammerClient, supports, compareVersions } = require('../src/main/hammerclient');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { createServices } = require('../src/main/services');
const { tmpDir } = require('./helpers');

const JARS = [
  { file: 'hammer-client-26.3-2.0.0.jar', minecraft: ['26.3'] },
  { file: 'hammer-client-1.21.1-2.0.0.jar', minecraft: ['1.21', '1.21.1'] },
  { file: 'hammer-client-1.21.10-2.0.0.jar', minecraft: ['1.21.9', '1.21.10'] },
  { file: 'hammer-client-1.21.3-2.0.0.jar', minecraft: ['1.21.2', '1.21.3'] },
  { file: 'hammer-client-26.1.2-2.0.0.jar', minecraft: ['26.1', '26.1.1', '26.1.2'] },
];

/** A hammer-client folder like `./gradlew dist` makes: versions.json and one (fake) jar per entry. */
function bundle(jars = JARS, index = { version: '2.0.0', jars }) {
  const dir = tmpDir('hc');
  for (const j of jars) if (typeof j?.file === 'string' && !/[\\/]/.test(j.file)) fs.writeFileSync(path.join(dir, j.file), `jar for ${j.minecraft}`);
  if (index !== null) fs.writeFileSync(path.join(dir, 'versions.json'), typeof index === 'string' ? index : JSON.stringify(index));
  return dir;
}

function setup() {
  const root = tmpDir();
  const instances = createInstances(createPaths(root));
  const dir = bundle();
  const installs = [];
  const content = { install: async (instance, what) => (installs.push(what.projectId), fs.writeFileSync(path.join(instance.dir, 'mods', `fabric-api-0.116.0+${instance.mcVersion}.jar`), 'api')) };
  return { root, instances, dir, client: loadHammerClient({ dir }), content, installs };
}
const modJar = (i) => path.join(i.dir, 'mods', 'hammer-client.jar');

test('versions are ordered as numbers: 1.21.9 < 1.21.10 < 26.1, a pre-release before its release', () => {
  const sorted = ['26.1', '1.21.10', '1.21.9', '1.21', '26.3', '1.21.1', '26.1.2', '1.20.6', '26.1-pre1', '1.8.9'].sort(compareVersions);
  assert.deepEqual(sorted, ['1.8.9', '1.20.6', '1.21', '1.21.1', '1.21.9', '1.21.10', '26.1-pre1', '26.1', '26.1.2', '26.3']);
  assert.equal(compareVersions('1.21', '1.21.0'), 0);
  assert.ok(compareVersions('26.4-snapshot-7', '26.3') > 0 && compareVersions('26.4-snapshot-7', '26.4') < 0);
});

test('the index lists every supported Minecraft version, oldest first, with the jar for each', () => {
  const dir = bundle();
  const client = loadHammerClient({ dir });
  assert.equal(client.version, '2.0.0');
  assert.equal(client.available, true);
  assert.deepEqual(client.versions, ['1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.9', '1.21.10', '26.1', '26.1.1', '26.1.2', '26.3']);
  assert.equal(client.jarFor('1.21'), path.join(dir, 'hammer-client-1.21.1-2.0.0.jar'));
  assert.equal(client.jarFor('26.1.1'), path.join(dir, 'hammer-client-26.1.2-2.0.0.jar'));
  assert.equal(client.jarFor('1.20.1'), null);
  assert.equal(supports({ loader: 'fabric', mcVersion: '26.3' }, client), true);
  assert.equal(supports({ loader: 'quilt', mcVersion: '1.21' }, client), true);
  assert.equal(supports({ loader: 'forge', mcVersion: '1.21.1' }, client), false);
  assert.equal(supports({ loader: 'neoforge', mcVersion: '26.3' }, client), false);
  assert.equal(supports({ loader: 'fabric', mcVersion: '1.20.1' }, client), false);
  assert.equal(supports({ loader: 'fabric', mcVersion: '1.21.4' }, client), false, 'a version between two jars is not guessed');
  assert.equal(supports(null, client), false);
});

test('a missing or broken index supports nothing and never throws', () => {
  for (const client of [
    loadHammerClient(),
    loadHammerClient({ dir: path.join(tmpDir(), 'nie-ma') }),
    loadHammerClient({ dir: bundle(JARS, null) }),
    loadHammerClient({ dir: bundle(JARS, '{ "version": "2.0.0", "jars": [') }),
    loadHammerClient({ dir: bundle(JARS, { version: '2.0.0' }) }),
    loadHammerClient({ dir: bundle(JARS, 'null') }),
    loadHammerClient({ dir: bundle([], { version: 5, jars: [null, 7, { file: 'a.jar' }, { minecraft: ['1.21.1'] }, { file: 'a.jar', minecraft: 'x' }] }) }),
  ]) {
    assert.deepEqual([client.versions, client.available, client.jarFor('1.21.1'), client.version], [[], false, null, null]);
    assert.equal(supports({ loader: 'fabric', mcVersion: '1.21.1' }, client), false);
  }
  assert.equal(supports({ loader: 'fabric', mcVersion: '1.21.1' }), false, 'no bundle at all');
  // The index lists a jar that was not shipped: the version is known, but there is nothing to install.
  const empty = bundle([], { version: '2.0.0', jars: [{ file: 'hammer-client-26.3-2.0.0.jar', minecraft: ['26.3'] }] });
  assert.deepEqual([loadHammerClient({ dir: empty }).versions, loadHammerClient({ dir: empty }).available], [['26.3'], false]);
});

test('jar names that are not plain file names are refused', () => {
  const outside = path.join(tmpDir(), 'evil.jar');
  fs.writeFileSync(outside, 'evil');
  const dir = bundle([{ file: 'ok-1.21.1.jar', minecraft: ['1.21.1'] }], {
    version: '../2.0.0',
    jars: [
      { file: '../evil.jar', minecraft: ['26.1'] },
      { file: 'sub/evil.jar', minecraft: ['26.2'] },
      { file: 'sub\\evil.jar', minecraft: ['26.2'] },
      { file: outside, minecraft: ['26.3'] },
      { file: '..', minecraft: ['1.21.3'] },
      { file: 'a..jar', minecraft: ['1.21.4'] },
      { file: 'notes.txt', minecraft: ['1.21.5'] },
      { file: 'ok-1.21.1.jar', minecraft: ['1.21.1', '../../1.21', 42] },
    ],
  });
  const client = loadHammerClient({ dir });
  assert.deepEqual(client.versions, ['1.21.1']);
  assert.equal(client.version, null, 'a version that is not a plain version text is dropped');
  for (const mc of ['26.1', '26.2', '26.3', '1.21.3', '1.21.4', '1.21.5']) assert.equal(client.jarFor(mc), null);
});

test('the old single jar still works for 1.21 / 1.21.1 – and an index wins over it', () => {
  const jar = path.join(tmpDir(), 'hammer-client.jar');
  const legacy = loadHammerClient({ jar });
  assert.deepEqual([legacy.versions, legacy.available, legacy.version], [['1.21', '1.21.1'], false, null]);
  fs.writeFileSync(jar, 'jar-v1');
  const ready = loadHammerClient({ jar });
  assert.deepEqual([ready.available, ready.jarFor('1.21'), ready.jarFor('1.21.1'), ready.jarFor('26.3')], [true, jar, jar, null]);
  assert.equal(supports({ loader: 'fabric', mcVersion: '1.21.1' }, ready), true);
  assert.equal(supports({ loader: 'fabric', mcVersion: '26.3' }, ready), false);
  assert.equal(loadHammerClient({ dir: bundle(), jar }).jarFor('26.3').endsWith('hammer-client-26.3-2.0.0.jar'), true);
  assert.equal(loadHammerClient({ dir: bundle(JARS, null), jar }).jarFor('1.21.1'), jar, 'no index → the single jar');
});

test('new instances skip the narrator onboarding and have Hammer Client on', () => {
  const { instances } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  assert.equal(i.hammerClient, true);
  assert.match(fs.readFileSync(path.join(i.dir, 'options.txt'), 'utf8'), /onboardAccessibility:false/);
});

test('sync puts the jar for the instance version and Fabric API in place and writes the launcher links', async () => {
  const { instances, dir, client, content, installs } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  const res = await syncHammerClient({ instance: i, client, content, links: { discordUrl: 'https://discord.gg/x', shopUrl: 'http://not-https', brand: 'HammerShop' } });
  assert.deepEqual(res, { active: true });
  assert.equal(fs.readFileSync(modJar(i), 'utf8'), 'jar for 1.21,1.21.1');
  assert.deepEqual(fs.readdirSync(path.join(i.dir, 'mods')).sort(), ['fabric-api-0.116.0+1.21.1.jar', 'hammer-client.jar'], 'always under the same name');
  assert.deepEqual(installs, ['fabric-api']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(i.dir, 'config', 'hammerclient-launcher.json'), 'utf8')), { discordUrl: 'https://discord.gg/x', shopUrl: '', brand: 'HammerShop' });

  // A newer launcher ships a newer mod → replaced; Fabric API is not installed twice.
  fs.writeFileSync(path.join(dir, 'hammer-client-1.21.1-2.0.0.jar'), 'jar-v2');
  await syncHammerClient({ instance: i, client, content });
  assert.equal(fs.readFileSync(modJar(i), 'utf8'), 'jar-v2');
  assert.deepEqual(installs, ['fabric-api']);

  // An unchanged jar is left alone (same hash → no copy).
  const before = fs.statSync(modJar(i)).mtimeMs;
  await new Promise((r) => setTimeout(r, 15));
  await syncHammerClient({ instance: i, client, content });
  assert.equal(fs.statSync(modJar(i)).mtimeMs, before);
});

test('changing the game version of an instance swaps the jar; a version without a jar removes it', async () => {
  const { instances, client, content } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  await syncHammerClient({ instance: i, client, content });
  const newer = instances.update(i.id, { mcVersion: '26.3' });
  assert.deepEqual(await syncHammerClient({ instance: newer, client, content }), { active: true });
  assert.equal(fs.readFileSync(modJar(i), 'utf8'), 'jar for 26.3');
  const quilt = instances.update(i.id, { mcVersion: '1.21.10', loader: 'quilt' });
  await syncHammerClient({ instance: quilt, client, content });
  assert.equal(fs.readFileSync(modJar(i), 'utf8'), 'jar for 1.21.9,1.21.10');
  const between = instances.update(i.id, { mcVersion: '1.21.4' });
  assert.deepEqual(await syncHammerClient({ instance: between, client, content }), { active: false, reason: 'unsupported' });
  assert.equal(fs.existsSync(modJar(i)), false);
  const forge = instances.update(i.id, { mcVersion: '1.21.1', loader: 'neoforge' });
  assert.equal((await syncHammerClient({ instance: forge, client, content })).reason, 'unsupported');
});

test('sync removes the mod when switched off or unsupported, and respects a .disabled file', async () => {
  const { instances, dir, client, content } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  await syncHammerClient({ instance: i, client, content });
  const off = instances.update(i.id, { hammerClient: false });
  assert.deepEqual(await syncHammerClient({ instance: off, client, content }), { active: false, reason: 'off' });
  assert.equal(fs.existsSync(modJar(i)), false);

  const old = instances.create({ name: 'B', mcVersion: '1.20.1', loader: 'fabric' });
  assert.equal((await syncHammerClient({ instance: old, client, content })).reason, 'unsupported');
  assert.equal((await syncHammerClient({ instance: off, content })).reason, 'unsupported', 'no bundle → nothing is supported');

  const on = instances.update(i.id, { hammerClient: true });
  fs.writeFileSync(`${modJar(i)}.disabled`, 'x');
  assert.equal((await syncHammerClient({ instance: on, client, content })).reason, 'disabled');
  assert.equal(fs.existsSync(modJar(i)), false, 'a mod switched off in the list is not put back');
  fs.rmSync(`${modJar(i)}.disabled`);

  // The jar for this version is not in the launcher: nothing to install, and no stale jar of another version stays.
  fs.writeFileSync(modJar(i), 'jar of another version');
  fs.rmSync(path.join(dir, 'hammer-client-1.21.1-2.0.0.jar'));
  assert.deepEqual(await syncHammerClient({ instance: on, client: loadHammerClient({ dir }), content }), { active: false, reason: 'missing' });
  assert.equal(fs.existsSync(modJar(i)), false);
});

/** Services with fake version lists: Mojang's releases (newest first) and the versions Fabric / Quilt support. */
function services({ clientDir = null, clientJar = null, releases, fabric = releases, config = {} }) {
  return createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', server: { address: '' }, defaultInstance: { name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric', optimized: true }, ...config },
    accounts: {},
    clientDir,
    clientJar,
    versionsApi: {
      minecraftVersions: async () => releases.map((id) => ({ id, type: 'release' })),
      loaderVersions: async (loader, mc) => (['fabric', 'quilt'].includes(loader) && fabric.includes(mc) ? [{ version: '0.20.1', stable: true }] : []),
    },
  });
}
const RELEASES = ['26.4', '26.3', '26.2', '26.1.2', '1.21.11', '1.21.10', '1.21.1', '1.21', '1.20.1'];

test('services: the launcher tells the window which versions Hammer Client supports', () => {
  const info = services({ clientDir: bundle(), releases: RELEASES }).hammerClient.info();
  assert.deepEqual(info, { versions: ['1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.9', '1.21.10', '26.1', '26.1.1', '26.1.2', '26.3'], version: '2.0.0', available: true });
  assert.deepEqual(services({ releases: RELEASES }).hammerClient.info(), { versions: [], version: null, available: false });
  assert.deepEqual(services({ clientDir: path.join(tmpDir(), 'brak'), releases: RELEASES }).hammerClient.info(), { versions: [], version: null, available: false });
});

test('the first instance uses the newest release that Hammer Client and Fabric both support', async () => {
  // 26.4 is newer but the mod has no jar for it yet.
  const newest = await services({ clientDir: bundle(), releases: RELEASES }).ensureDefaultInstance();
  assert.deepEqual([newest.mcVersion, newest.loader, newest.optimized, newest.hammerClient, newest.name], ['26.3', 'fabric', true, true, 'Hammer']);

  // Fabric is not out for 26.3 yet → the next supported version; a version that is not a release is skipped.
  const s = services({ clientDir: bundle(), releases: RELEASES.filter((v) => v !== '26.1.2'), fabric: ['1.21.10', '1.21.1', '1.20.1'] });
  const created = await s.ensureDefaultInstance();
  assert.equal(created.mcVersion, '1.21.10');
  assert.equal(s.settings.get().selectedInstance, created.id);
  assert.equal(await s.ensureDefaultInstance(), null, 'only when there is no instance yet');

  // No bundle (or nothing usable in it) → the configured version, then the newest release.
  assert.equal((await services({ releases: RELEASES }).ensureDefaultInstance()).mcVersion, '1.21.1');
  assert.equal((await services({ clientDir: bundle(), releases: RELEASES, fabric: [] }).ensureDefaultInstance()).loader, 'vanilla');
  assert.equal((await services({ clientDir: bundle(JARS, null), releases: RELEASES, config: { defaultInstance: { loader: 'fabric' } } }).ensureDefaultInstance()).mcVersion, '26.4');
  // The old single jar keeps the old behaviour.
  const jar = path.join(tmpDir(), 'hammer-client.jar');
  fs.writeFileSync(jar, 'jar');
  assert.equal((await services({ clientJar: jar, releases: RELEASES }).ensureDefaultInstance()).mcVersion, '1.21.1');
  // A Forge default instance never follows the mod.
  const forge = await services({ clientDir: bundle(), releases: RELEASES, config: { defaultInstance: { name: 'F', mcVersion: '1.20.1', loader: 'forge' } } }).ensureDefaultInstance();
  assert.deepEqual([forge.mcVersion, forge.loader], ['1.20.1', 'vanilla']);
});
