'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cleanup = require('../src/main/cleanup');
const { createPaths } = require('../src/main/paths');
const { tmpDir } = require('./helpers');

const DAY = 864e5;
const NOW = Date.now();

function put(file, body = 'x', ageDays = 0) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  if (ageDays) fs.utimesSync(file, new Date(NOW - ageDays * DAY), new Date(NOW - ageDays * DAY));
  return file;
}

/** A launcher folder: two instances, three versions on disk (one unused), three Java runtimes (one unused). */
function fixture() {
  const paths = createPaths(tmpDir());
  const version = (id, json, jar = 1000) => {
    put(path.join(paths.versions, id, `${id}.json`), JSON.stringify({ id, ...json }));
    if (jar) put(path.join(paths.versions, id, `${id}.jar`), Buffer.alloc(jar));
  };
  version('1.21.1', { javaVersion: { component: 'java-runtime-delta', majorVersion: 21 } }, 5000);
  version('fabric-loader-0.16.9-1.21.1', { inheritsFrom: '1.21.1' }, 0);
  version('1.8.9', { mainClass: 'net.minecraft.client.main.Main' }, 3000); // very old: no javaVersion → jre-legacy
  version('1.19.4', { javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 } }, 4000);
  version('fabric-loader-0.14.21-1.19.4', { inheritsFrom: '1.19.4' }, 0);
  put(path.join(paths.versions, 'przerwane-pobieranie', 'x.jar.part'), Buffer.alloc(700));
  put(path.join(paths.versions, 'version_manifest.json'), '{}'); // a file, not a version folder
  for (const [name, size] of [['java-runtime-delta', 9000], ['java-runtime-gamma', 8000], ['jre-legacy', 6000]]) put(path.join(paths.runtime, name, 'bin', 'java'), Buffer.alloc(size));
  put(path.join(paths.root, 'libraries', 'a', 'a.jar'), Buffer.alloc(2000));
  put(path.join(paths.root, 'assets', 'objects', 'ab', 'abcdef'), Buffer.alloc(1500));
  put(path.join(paths.cache, 'download.part'), Buffer.alloc(400));
  put(path.join(paths.cache, 'tmp', 'deep', 'file'), Buffer.alloc(600));
  put(path.join(paths.logs, 'launcher-old.log'), Buffer.alloc(50), 30);
  put(path.join(paths.logs, 'launcher.log'), Buffer.alloc(70));

  const instance = (id, data, files) => {
    const dir = path.join(paths.instances, id);
    for (const [rel, [size, age]] of Object.entries(files)) put(path.join(dir, rel), Buffer.alloc(size), age);
    return { id, name: id.toUpperCase(), dir, ...data };
  };
  const instances = [
    instance('hammer', { mcVersion: '1.21.1', loader: 'fabric', versionId: 'fabric-loader-0.16.9-1.21.1' }, {
      'mods/sodium.jar': [1200, 40],
      'saves/World/level.dat': [300, 90],
      'logs/latest.log': [100, 0],
      'logs/2026-10-01-1.log.gz': [200, 20],
      'logs/telemetry/old.json': [30, 8],
      'crash-reports/crash-old.txt': [400, 10],
      'crash-reports/crash-new.txt': [500, 2],
    }),
    instance('pvp', { mcVersion: '1.8.9', loader: 'vanilla', versionId: null }, { 'logs/latest.log': [60, 12], 'options.txt': [10, 100] }),
  ];
  return { paths, instances };
}

const exists = (...parts) => fs.existsSync(path.join(...parts));

test('disk usage: sizes per instance, shared game files, Java, cache and logs', async () => {
  const { paths, instances } = fixture();
  const u = await cleanup.usage(paths, instances);
  assert.deepEqual(u.instances, [{ id: 'hammer', name: 'HAMMER', size: 1200 + 300 + 100 + 200 + 30 + 400 + 500 }, { id: 'pvp', name: 'PVP', size: 70 }], 'biggest first');
  const json = (id) => fs.statSync(path.join(paths.versions, id, `${id}.json`)).size;
  assert.equal(u.versions, 5000 + 3000 + 4000 + 700 + 2 + ['1.21.1', 'fabric-loader-0.16.9-1.21.1', '1.8.9', '1.19.4', 'fabric-loader-0.14.21-1.19.4'].reduce((sum, id) => sum + json(id), 0));
  assert.deepEqual([u.libraries, u.assets, u.runtime, u.cache, u.logs], [2000, 1500, 23000, 1000, 120]);
  assert.deepEqual(u.runtimes.map((r) => [r.name, r.size]).sort(), [['java-runtime-delta', 9000], ['java-runtime-gamma', 8000], ['jre-legacy', 6000]]);
  assert.equal(u.total, 2730 + 70 + u.versions + 2000 + 1500 + 23000 + 1000 + 120);
  const empty = await cleanup.usage(createPaths(tmpDir()), []);
  assert.deepEqual([empty.total, empty.instances, empty.runtimes], [0, [], []], 'a fresh install');
});

test('clean-up plan: old logs, cache, versions and Java that no instance uses – and nothing else', async () => {
  const { paths, instances } = fixture();
  const plan = await cleanup.plan(paths, instances);
  const group = Object.fromEntries(plan.groups.map((g) => [g.key, g]));
  assert.deepEqual(Object.keys(group).sort(), ['cache', 'logs', 'runtimes', 'versions']);
  assert.deepEqual([group.logs.count, group.logs.size], [5, 200 + 30 + 400 + 60 + 50], 'only files older than 7 days');
  assert.deepEqual([group.cache.count, group.cache.size], [2, 1000]);
  assert.deepEqual(group.versions.items.map((i) => i.name).sort(), ['1.19.4', 'fabric-loader-0.14.21-1.19.4', 'przerwane-pobieranie']);
  assert.deepEqual(group.runtimes.items, [{ name: 'java-runtime-gamma', size: 8000, java: 17 }], 'delta is used by 1.21.1 (through the Fabric version), jre-legacy by 1.8.9');
  assert.equal(plan.total, plan.groups.reduce((sum, g) => sum + g.size, 0));
  assert.ok(plan.groups.every((g) => !('targets' in g)), 'no paths leave the main process');

  const used = cleanup.referenced(paths, instances);
  assert.deepEqual([...used.versions].sort(), ['1.21.1', '1.8.9', 'fabric-loader-0.16.9-1.21.1']);
  assert.deepEqual([...used.runtimes].sort(), ['java-runtime-delta', 'jre-legacy']);

  // An instance on 1.19.4 keeps that version, its Java, but not the other loader version.
  const more = [...instances, { id: 'old', name: 'Old', dir: path.join(paths.instances, 'old'), mcVersion: '1.19.4', versionId: null }];
  const smaller = Object.fromEntries((await cleanup.plan(paths, more)).groups.map((g) => [g.key, g]));
  assert.deepEqual(smaller.versions.items.map((i) => i.name).sort(), ['fabric-loader-0.14.21-1.19.4', 'przerwane-pobieranie']);
  assert.equal(smaller.runtimes, undefined);
  // Without instances everything downloadable can go; a custom Java inside runtime/ is kept.
  const all = Object.fromEntries((await cleanup.plan(paths, [], { javaPaths: [path.join(paths.runtime, 'jre-legacy', 'bin', 'java'), '', '/usr/bin/java'] })).groups.map((g) => [g.key, g]));
  assert.equal(all.versions.count, 6);
  assert.deepEqual(all.runtimes.items.map((i) => i.name).sort(), ['java-runtime-delta', 'java-runtime-gamma']);
  // A used version whose JSON cannot be read: nobody knows which Java it needs, so no Java is offered.
  fs.writeFileSync(path.join(paths.versions, '1.21.1', '1.21.1.json'), '{ cut off');
  assert.equal((await cleanup.plan(paths, instances)).groups.some((g) => g.key === 'runtimes'), false);
  assert.deepEqual(await cleanup.plan(createPaths(tmpDir()), []), { total: 0, groups: [] });
});

test('clean-up: deletes exactly the chosen groups', async () => {
  const { paths, instances } = fixture();
  const hammer = instances[0].dir;
  let res = await cleanup.apply(paths, instances, ['logs', 'no-such-group', '../../etc']);
  assert.deepEqual(res, { freed: 740, removed: 5, failed: 0 });
  assert.deepEqual([exists(hammer, 'logs/2026-10-01-1.log.gz'), exists(hammer, 'crash-reports/crash-old.txt'), exists(hammer, 'logs/telemetry/old.json'), exists(instances[1].dir, 'logs/latest.log'), exists(paths.logs, 'launcher-old.log')], [false, false, false, false, false]);
  assert.deepEqual([exists(hammer, 'logs/latest.log'), exists(hammer, 'crash-reports/crash-new.txt'), exists(paths.logs, 'launcher.log')], [true, true, true], 'recent logs stay');
  assert.deepEqual([exists(hammer, 'mods/sodium.jar'), exists(hammer, 'saves/World/level.dat'), exists(instances[1].dir, 'options.txt')], [true, true, true], 'old mods, worlds and options are never touched');
  assert.ok(exists(paths.cache, 'download.part') && exists(paths.versions, '1.19.4') && exists(paths.runtime, 'java-runtime-gamma'), 'groups that were not chosen stay');

  res = await cleanup.apply(paths, instances, ['versions', 'runtimes', 'cache']);
  assert.equal(res.failed, 0);
  assert.equal(res.removed, 3 + 1 + 2);
  assert.deepEqual(fs.readdirSync(paths.versions).sort(), ['1.21.1', '1.8.9', 'fabric-loader-0.16.9-1.21.1', 'version_manifest.json']);
  assert.deepEqual(fs.readdirSync(paths.runtime).sort(), ['java-runtime-delta', 'jre-legacy']);
  assert.deepEqual(fs.readdirSync(paths.cache), [], 'the cache folder itself stays');
  assert.ok(exists(paths.root, 'libraries/a/a.jar') && exists(paths.root, 'assets/objects/ab/abcdef'), 'libraries and assets are never collected');

  assert.deepEqual(await cleanup.apply(paths, instances, ['logs', 'versions', 'runtimes', 'cache']), { freed: 0, removed: 0, failed: 0 }, 'nothing left');
  for (const keys of [null, undefined, 'logs', {}, []]) assert.deepEqual(await cleanup.apply(paths, instances, keys), { freed: 0, removed: 0, failed: 0 });
});

test('clean-up: a logs or cache folder that is a link to another place is never emptied', { skip: process.platform === 'win32' }, async () => {
  const { paths, instances } = fixture();
  const elsewhere = tmpDir();
  put(path.join(elsewhere, 'important-old-file.txt'), 'keep me', 400);
  for (const dir of [path.join(instances[0].dir, 'logs'), path.join(instances[0].dir, 'crash-reports'), paths.cache, paths.logs]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.symlinkSync(elsewhere, dir);
  }
  const plan = await cleanup.plan(paths, instances);
  assert.equal(plan.groups.some((g) => g.key === 'cache'), false);
  assert.deepEqual(plan.groups.find((g) => g.key === 'logs').count, 1, 'only the real logs folder of the other instance');
  await cleanup.apply(paths, instances, ['logs', 'cache']);
  assert.equal(fs.readFileSync(path.join(elsewhere, 'important-old-file.txt'), 'utf8'), 'keep me');
});
