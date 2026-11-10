'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOptimizer, mergeOptions, writeOptionsPreset, setGpuPreference, recommend, PERFORMANCE_MODS } = require('../src/main/optimizer');
const { recommendMemory, jvmArgs, memoryFromCustom, splitArgs } = require('../src/main/jvm');
const { tmpDir } = require('./helpers');

const GB = 1024 ** 3;
const version = (slug, loaders) => ({ id: `${slug}-v`, project_id: `${slug}-id`, version_number: '1', version_type: 'release', loaders, game_versions: ['1.20.1'] });

test('plan: only mods that exist for this version and loader; Embeddium only where Sodium is missing', async () => {
  const forgeOnly = new Set(['embeddium', 'ferrite-core', 'modernfix', 'entityculling']);
  const modrinth = { versions: async (slug, { loaders }) => (loaders.includes('forge') && forgeOnly.has(slug) ? [version(slug, ['forge'])] : []) };
  const content = { installedProjects: () => new Map([['ferrite-core-id', {}]]) };
  const { plan } = createOptimizer({ modrinth, content });
  const forge = await plan({ loader: 'forge', mcVersion: '1.20.1' });
  const available = forge.mods.filter((m) => m.available).map((m) => m.slug);
  assert.deepEqual(available, ['embeddium', 'ferrite-core', 'modernfix', 'entityculling']);
  assert.equal(forge.mods.find((m) => m.slug === 'ferrite-core').installed, true);
  assert.ok(!forge.mods.some((m) => m.slug === 'iris'), 'shaders only on request');

  const fabricModrinth = { versions: async (slug, { loaders }) => (loaders.includes('fabric') ? [version(slug, ['fabric'])] : []) };
  const fabric = await createOptimizer({ modrinth: fabricModrinth, content: { installedProjects: () => new Map() } }).plan({ loader: 'fabric', mcVersion: '1.20.1' }, { shaders: true });
  assert.ok(!fabric.mods.some((m) => m.slug === 'embeddium'), 'Sodium exists → no Embeddium');
  assert.ok(fabric.mods.some((m) => m.slug === 'iris' && m.available));
  assert.deepEqual(await createOptimizer({ modrinth, content }).plan({ loader: 'vanilla' }), { supported: false, mods: [] });
});

test('installMods installs what is available and reports what is missing', async () => {
  const installed = [];
  const content = { installedProjects: () => new Map(), install: async (i, w) => (installed.push(w.projectId), { installed: [w.projectId], skipped: [], warnings: [] }) };
  const { installMods } = createOptimizer({ modrinth: {}, content });
  const res = await installMods({}, { mods: [{ name: 'A', available: true, installed: false, version: { projectId: 'a', id: 'a1' } }, { name: 'B', available: false }, { name: 'C', available: true, installed: true, version: { projectId: 'c' } }] });
  assert.deepEqual(installed, ['a']);
  assert.deepEqual(res.missing, ['B']);
  assert.ok(PERFORMANCE_MODS.every((m) => /^[a-z0-9-]+$/.test(m.slug) && m.why.length > 10));
});

test('RAM: more with mods, never more than half the computer or 12 GB', () => {
  assert.equal(recommendMemory(4 * GB), 1536);
  assert.equal(recommendMemory(8 * GB), 2560);
  assert.equal(recommendMemory(16 * GB, { loader: 'fabric', modCount: 80 }), 6144);
  assert.equal(recommendMemory(64 * GB, { loader: 'fabric', modCount: 400 }), 12288);
  assert.ok(recommendMemory(6 * GB, { loader: 'forge', modCount: 300 }) <= 3072);
  assert.equal(recommend({ totalMem: 32 * GB, cpuCores: 12, javaMajor: 21 }, { loader: 'fabric' }, 150).jvmPreset, 'zgc');
  assert.equal(recommend({ totalMem: 8 * GB, cpuCores: 4, javaMajor: 21 }, { loader: 'fabric' }, 20).optionsPreset, 'fps');
});

test('JVM flags: unknown flags never crash the game, ZGC needs Java 17/21, custom flags keep memory to the launcher', () => {
  const rec = jvmArgs({ preset: 'recommended', javaMajor: 21 });
  assert.equal(rec[0], '-XX:+IgnoreUnrecognizedVMOptions');
  assert.ok(rec.includes('-XX:+UseG1GC') && rec.includes('-Dfile.encoding=UTF-8'));
  assert.ok(jvmArgs({ preset: 'zgc', javaMajor: 21 }).includes('-XX:+ZGenerational'));
  assert.ok(!jvmArgs({ preset: 'zgc', javaMajor: 17 }).includes('-XX:+ZGenerational'));
  assert.ok(jvmArgs({ preset: 'zgc', javaMajor: 8 }).includes('-XX:+UseG1GC'), 'Java 8 falls back to G1');
  assert.deepEqual(jvmArgs({ preset: 'custom', custom: '-Xmx8G -XX:+UseZGC "-Dname=a b"' }).slice(3), ['-XX:+UseZGC', '-Dname=a b']);
  assert.equal(memoryFromCustom('-Xms2G -Xmx8G'), 8192);
  assert.equal(memoryFromCustom('-Xmx3072M'), 3072);
  assert.deepEqual(splitArgs(''), []);
});

test('graphics presets change only their keys; Windows GPU preference uses reg.exe', async () => {
  const merged = mergeOptions('version:3953\nkey_key.jump:key.keyboard.space\nrenderDistance:20\n', { renderDistance: '8', maxFps: '260' });
  assert.equal(merged, 'version:3953\nkey_key.jump:key.keyboard.space\nrenderDistance:8\nmaxFps:260\n');
  const dir = tmpDir();
  writeOptionsPreset(dir, 'fps');
  const text = fs.readFileSync(path.join(dir, 'options.txt'), 'utf8');
  assert.match(text, /^lang:pl_pl$/m);
  assert.match(text, /^graphicsMode:0$/m);
  assert.throws(() => writeOptionsPreset(dir, 'nope'), /Nieznany preset/);
  const calls = [];
  const ok = await setGpuPreference('C:\\java\\bin\\javaw.exe', { platform: 'win32', run: (cmd, args, opts, cb) => (calls.push([cmd, ...args]), cb(null)) });
  assert.equal(ok, true);
  assert.deepEqual(calls[0].slice(0, 4), ['reg', 'add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v']);
  assert.ok(calls[0].includes('GpuPreference=2;'));
  assert.equal(await setGpuPreference('/usr/bin/java', { platform: 'linux' }), false);
});
