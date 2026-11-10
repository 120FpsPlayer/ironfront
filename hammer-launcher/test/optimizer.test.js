'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOptimizer, visibleMods, mergeOptions, writeOptionsPreset, setGpuPreference, recommend, classifyGpu, PERFORMANCE_MODS, OPTION_PRESETS, TIERS } = require('../src/main/optimizer');
const { recommendMemory, jvmArgs, effectivePreset, zgcSupported, memoryFromCustom, splitArgs } = require('../src/main/jvm');
const { javaMajorFor, detectJavaMajor } = require('../src/main/java');
const { createServices } = require('../src/main/services');
const { tmpDir } = require('./helpers');

const GB = 1024 ** 3;
const version = (slug, loaders, type = 'release') => ({ id: `${slug}-v`, project_id: `${slug}-id`, version_number: '1', version_type: type, loaders, game_versions: ['1.20.1'] });
const none = { installedProjects: () => new Map() };
/** Modrinth where the given slugs exist for the given loader. */
const having = (loader, slugs) => ({ versions: async (slug, { loaders }) => (loaders.includes(loader) && slugs.includes(slug) ? [version(slug, [loader])] : []) });

test('plan: only mods that exist for this version and loader; Embeddium only where Sodium is missing', async () => {
  const modrinth = having('forge', ['embeddium', 'ferrite-core', 'modernfix', 'entityculling']);
  const content = { installedProjects: () => new Map([['ferrite-core-id', {}]]) };
  const { plan } = createOptimizer({ modrinth, content });
  const forge = await plan({ loader: 'forge', mcVersion: '1.20.1' });
  const available = forge.mods.filter((m) => m.available).map((m) => m.slug);
  assert.deepEqual(available, ['embeddium', 'ferrite-core', 'modernfix', 'entityculling']);
  assert.equal(forge.mods.find((m) => m.slug === 'ferrite-core').installed, true);
  assert.ok(!forge.mods.some((m) => m.slug === 'iris'), 'shaders only on request');
  assert.ok(!forge.mods.some((m) => m.slug === 'sodium'), 'Sodium is not listed as missing when its Forge port is used');
  assert.ok(forge.mods.some((m) => m.slug === 'lithium' && !m.available), 'a mod without any port is listed as missing');

  const everything = { versions: async (slug, { loaders }) => (loaders.includes('fabric') ? [version(slug, ['fabric'])] : []) };
  const fabric = await createOptimizer({ modrinth: everything, content: none }).plan({ loader: 'fabric', mcVersion: '1.20.1' }, { shaders: true });
  assert.ok(!fabric.mods.some((m) => m.slug === 'embeddium'), 'Sodium exists → no Embeddium');
  assert.ok(fabric.mods.some((m) => m.slug === 'iris' && m.available));
  assert.deepEqual(await createOptimizer({ modrinth, content }).plan({ loader: 'vanilla' }), { supported: false, mods: [] });
});

test('plan: two tiers – Podstawowe by default, Turbo only on request', async () => {
  const everything = { versions: async (slug, { loaders }) => (loaders.includes('fabric') ? [version(slug, ['fabric'])] : []) };
  const { plan } = createOptimizer({ modrinth: everything, content: none });
  const instance = { loader: 'fabric', mcVersion: '1.20.1' };
  const basic = await plan(instance);
  assert.ok(basic.mods.length >= 12 && basic.mods.every((m) => m.tier === 'core'), 'the default is the safe tier only');
  for (const slug of ['sodium', 'lithium', 'ferrite-core', 'modernfix', 'entityculling', 'immediatelyfast', 'moreculling', 'dynamic-fps', 'krypton', 'badoptimizations']) assert.ok(basic.mods.some((m) => m.slug === slug), slug);
  const turbo = await plan(instance, { turbo: true });
  assert.deepEqual(turbo.mods.filter((m) => m.tier === 'turbo').map((m) => m.slug), ['c2me-fabric', 'scalablelux', 'threadtweak', 'ksyxis', 'fast-ip-ping']);
  assert.equal(turbo.mods.filter((m) => m.tier === 'core').length, basic.mods.length);
  const all = await plan(instance, { turbo: true, shaders: true });
  assert.deepEqual(all.mods.filter((m) => m.tier === 'shaders').map((m) => m.slug), ['iris']);
  // The catalogue itself.
  assert.ok(PERFORMANCE_MODS.every((m) => /^[a-z0-9-]+$/.test(m.slug) && m.why.length > 10 && m.tier in TIERS));
  assert.equal(new Set(PERFORMANCE_MODS.map((m) => m.slug)).size, PERFORMANCE_MODS.length);
  for (const m of PERFORMANCE_MODS) for (const other of m.insteadOf ?? []) assert.ok(PERFORMANCE_MODS.some((x) => x.slug === other && x.tier === m.tier), `${m.slug} → ${other}`);
});

test('plan: ports and successors (insteadOf), mods for old versions only (legacy)', async () => {
  const plan = (loader, slugs) => createOptimizer({ modrinth: having(loader, slugs), content: none }).plan({ loader, mcVersion: '1.20.1' }, { turbo: true, shaders: true });
  const slugs = (p) => p.mods.filter((m) => m.available).map((m) => m.slug);
  // Forge 1.20.1: Embeddium for Sodium, Radium for Lithium (Canary only when Radium is missing too), Oculus for Iris.
  assert.deepEqual(slugs(await plan('forge', ['embeddium', 'radium', 'canary', 'starlight-forge', 'oculus'])), ['embeddium', 'radium', 'starlight-forge', 'oculus']);
  assert.deepEqual(slugs(await plan('forge', ['canary'])), ['canary']);
  // New versions: the ModernFix fork only where ModernFix itself is not out.
  assert.deepEqual(slugs(await plan('fabric', ['modernfix', 'modernfix-mvus'])), ['modernfix']);
  assert.deepEqual(slugs(await plan('fabric', ['modernfix-mvus'])), ['modernfix-mvus']);
  assert.deepEqual(slugs(await plan('neoforge', ['c2me-neoforge'])), ['c2me-neoforge']);
  // What does not exist: a plain mod is shown as missing, a port or a legacy mod is not shown at all.
  const empty = await plan('fabric', []);
  const shown = empty.mods.map((m) => m.slug);
  for (const slug of ['sodium', 'lithium', 'modernfix', 'c2me-fabric', 'iris']) assert.ok(shown.includes(slug), slug);
  for (const slug of ['embeddium', 'radium', 'canary', 'modernfix-mvus', 'starlight', 'starlight-forge', 'lazydfu', 'memoryleakfix', 'noisium', 'c2me-neoforge', 'oculus']) assert.ok(!shown.includes(slug), slug);
  assert.deepEqual(slugs(await plan('fabric', ['starlight', 'lazydfu', 'memoryleakfix'])), ['starlight', 'memoryleakfix', 'lazydfu'], 'old versions still get their mods');
  // visibleMods on its own.
  const pick = (list) => visibleMods(list).map((m) => m.slug);
  assert.deepEqual(pick([{ slug: 'a', available: false }, { slug: 'b', available: true, insteadOf: ['a'] }]), ['b']);
  assert.deepEqual(pick([{ slug: 'a', available: true }, { slug: 'b', available: true, insteadOf: ['a'] }]), ['a']);
  assert.deepEqual(pick([{ slug: 'a', available: false }, { slug: 'b', available: false, insteadOf: ['a'] }, { slug: 'c', available: false, legacy: true }]), ['a']);
});

test('plan: one failed lookup hides nothing else; no connection at all is an error', async () => {
  const flaky = { versions: async (slug) => (slug === 'lithium' ? Promise.reject(new Error('Modrinth: HTTP 502')) : ['sodium', 'ferrite-core'].includes(slug) ? [version(slug, ['fabric'])] : []) };
  const res = await createOptimizer({ modrinth: flaky, content: none }).plan({ loader: 'fabric', mcVersion: '1.20.1' });
  assert.deepEqual([res.mods.find((m) => m.slug === 'lithium').available, res.mods.find((m) => m.slug === 'sodium').available], [false, true]);
  const down = { versions: async () => Promise.reject(new Error('Brak połączenia z Modrinth. Sprawdź internet.')) };
  await assert.rejects(createOptimizer({ modrinth: down, content: none }).plan({ loader: 'fabric', mcVersion: '1.20.1' }), /Brak połączenia z Modrinth/);
});

test('installMods installs what is available and reports what is missing', async () => {
  const installed = [];
  const content = { installedProjects: () => new Map(), install: async (i, w) => (installed.push(w.projectId), { installed: [w.projectId], skipped: [], warnings: [] }) };
  const { installMods } = createOptimizer({ modrinth: {}, content });
  const res = await installMods({}, { mods: [{ name: 'A', available: true, installed: false, version: { projectId: 'a', id: 'a1' } }, { name: 'B', available: false }, { name: 'C', available: true, installed: true, version: { projectId: 'c' } }] });
  assert.deepEqual(installed, ['a']);
  assert.deepEqual(res.missing, ['B']);
});

test('RAM: more with mods, never more than half the computer or 12 GB', () => {
  assert.equal(recommendMemory(4 * GB), 1536);
  assert.equal(recommendMemory(8 * GB), 2560);
  assert.equal(recommendMemory(16 * GB, { loader: 'fabric', modCount: 80 }), 6144);
  assert.equal(recommendMemory(64 * GB, { loader: 'fabric', modCount: 400 }), 12288);
  assert.ok(recommendMemory(6 * GB, { loader: 'forge', modCount: 300 }) <= 3072);
});

test('JVM flags follow the Java version: 8, 17, 21 and 25', () => {
  const flags = (preset, javaMajor, extra = {}) => jvmArgs({ preset, javaMajor, ...extra });
  for (const major of [8, 16, 17, 21, 25]) {
    for (const preset of ['recommended', 'zgc', 'vanilla', 'custom']) {
      const list = flags(preset, major);
      assert.equal(list[0], '-XX:+IgnoreUnrecognizedVMOptions', 'unknown flags never stop the game');
      assert.ok(list.includes('-Dfile.encoding=UTF-8'));
      assert.equal(new Set(list).size, list.length, 'no flag twice');
      assert.ok(!list.some((f) => /^-Xm[sx]/.test(f)), 'memory is set by the launcher');
    }
    assert.ok(flags('recommended', major).includes('-XX:+UseG1GC'));
    assert.deepEqual(flags('vanilla', major).length, 3, 'vanilla: nothing but the basics');
  }
  // Java 8 does not know UseFastUnorderedTimeStamps; 9+ gets it.
  assert.ok(!flags('recommended', 8).includes('-XX:+UseFastUnorderedTimeStamps'));
  assert.ok(flags('recommended', 17).includes('-XX:+UseFastUnorderedTimeStamps'));
  // ZGC: generational only (Java 21+). The flag for it exists in 21 and 22; later it only prints a warning.
  assert.equal(zgcSupported(17), false);
  assert.ok(flags('zgc', 8).includes('-XX:+UseG1GC') && !flags('zgc', 8).includes('-XX:+UseZGC'), 'Java 8 falls back to G1');
  assert.ok(flags('zgc', 17).includes('-XX:+UseG1GC') && !flags('zgc', 17).includes('-XX:+UseZGC'), 'Java 17 has no generational ZGC → G1');
  assert.ok(flags('zgc', 21).includes('-XX:+UseZGC') && flags('zgc', 21).includes('-XX:+ZGenerational'));
  assert.ok(flags('zgc', 22).includes('-XX:+ZGenerational'));
  assert.ok(flags('zgc', 25).includes('-XX:+UseZGC') && !flags('zgc', 25).includes('-XX:+ZGenerational'), 'Java 25: generational is the only mode');
  assert.ok(!flags('zgc', 23).includes('-XX:+ZGenerational'));
  assert.ok(!flags('zgc', 25).includes('-XX:+UseG1GC'));
  assert.deepEqual([effectivePreset('zgc', 17), effectivePreset('zgc', 21), effectivePreset('custom', 8), effectivePreset('dziwny', 21), effectivePreset(undefined)], ['recommended', 'zgc', 'custom', 'recommended', 'recommended']);
  // Compact object headers: a product flag since Java 25, not before.
  for (const preset of ['recommended', 'zgc']) {
    assert.ok(flags(preset, 25).includes('-XX:+UseCompactObjectHeaders'), preset);
    assert.ok(!flags(preset, 21).includes('-XX:+UseCompactObjectHeaders'), preset);
  }
  assert.ok(!flags('vanilla', 25).includes('-XX:+UseCompactObjectHeaders'));
  // Experimental G1 options come after the switch that unlocks them.
  const g1 = flags('recommended', 21);
  assert.ok(g1.indexOf('-XX:+UnlockExperimentalVMOptions') < g1.indexOf('-XX:G1NewSizePercent=23'));
});

test('JVM flags follow the heap and the number of mods; custom flags keep memory to the launcher', () => {
  const region = (memoryMb) => jvmArgs({ preset: 'recommended', javaMajor: 21, memoryMb }).find((f) => f.startsWith('-XX:G1HeapRegionSize='));
  assert.deepEqual([region(1536), region(2560), region(3072), region(8192)], ['-XX:G1HeapRegionSize=8M', '-XX:G1HeapRegionSize=8M', '-XX:G1HeapRegionSize=16M', '-XX:G1HeapRegionSize=16M']);
  const cache = (modCount, preset = 'recommended', javaMajor = 21) => jvmArgs({ preset, javaMajor, modCount }).find((f) => f.startsWith('-XX:ReservedCodeCacheSize=')) ?? null;
  assert.deepEqual([cache(0), cache(39), cache(40), cache(149), cache(150), cache(400)], [null, null, '-XX:ReservedCodeCacheSize=400M', '-XX:ReservedCodeCacheSize=400M', '-XX:ReservedCodeCacheSize=512M', '-XX:ReservedCodeCacheSize=512M']);
  assert.equal(cache(200, 'zgc', 25), '-XX:ReservedCodeCacheSize=512M');
  assert.equal(cache(200, 'recommended', 8), '-XX:ReservedCodeCacheSize=512M');
  assert.equal(cache(200, 'vanilla'), null);
  assert.equal(cache(200, 'custom'), null, 'own flags are used exactly as written');
  assert.deepEqual(jvmArgs({ preset: 'custom', custom: '-Xmx8G -XX:+UseZGC "-Dname=a b"' }).slice(3), ['-XX:+UseZGC', '-Dname=a b']);
  assert.equal(memoryFromCustom('-Xms2G -Xmx8G'), 8192);
  assert.equal(memoryFromCustom('-Xmx3072M'), 3072);
  assert.deepEqual(splitArgs(''), []);
});

test('which Java an instance runs on: from the game version, or read from an own Java', () => {
  assert.deepEqual(['26.3', '26.1', '26.4-snapshot-7', '1.21.11', '1.21.1', '1.20.5', '1.20.4', '1.18', '1.17.1', '1.16.5', '1.8.9', '24w14a', null].map(javaMajorFor), [25, 25, 25, 21, 21, 21, 17, 17, 16, 8, 8, 21, 21]);
  const home = (release) => {
    const dir = tmpDir('java');
    fs.mkdirSync(path.join(dir, 'bin'));
    if (release != null) fs.writeFileSync(path.join(dir, 'release'), release);
    return path.join(dir, 'bin', 'javaw.exe');
  };
  assert.equal(detectJavaMajor(home('IMPLEMENTOR="Microsoft"\nJAVA_VERSION="21.0.7"\nOS_ARCH="x86_64"\n')), 21);
  assert.equal(detectJavaMajor(home('JAVA_VERSION="1.8.0_202"\nOS_NAME="Linux"\n')), 8);
  assert.equal(detectJavaMajor(home('JAVA_VERSION="25.0.1"\n')), 25);
  assert.equal(detectJavaMajor(home('JAVA_VERSION="17"\n')), 17);
  assert.equal(detectJavaMajor(home(null)), null);
  assert.equal(detectJavaMajor(home('garbage')), null);
  assert.equal(detectJavaMajor('/nie/ma/bin/java'), null);
});

test('graphics cards: none, integrated, dedicated, high-end – the best one of a laptop counts', () => {
  const kinds = Object.fromEntries(
    Object.entries({
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)': 'highend',
      'NVIDIA GeForce RTX 4070 SUPER': 'highend',
      'AMD Radeon RX 6600 XT': 'highend',
      'NVIDIA GeForce GTX 1080 Ti': 'highend',
      'Intel(R) Arc(TM) A770 Graphics': 'highend',
      'NVIDIA GeForce GTX 1650': 'dedicated',
      'NVIDIA GeForce MX150': 'dedicated',
      'AMD Radeon RX 580 Series': 'dedicated',
      'NVIDIA': 'dedicated',
      'Apple M1': 'dedicated',
      'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)': 'integrated',
      'Intel(R) HD Graphics 4000': 'integrated',
      'AMD Radeon(TM) Graphics': 'integrated',
      'AMD Radeon(TM) Vega 8 Graphics': 'integrated',
      'Intel': 'integrated',
      'Google SwiftShader': 'software',
      'llvmpipe (LLVM 15.0.7, 256 bits)': 'software',
      'Microsoft Basic Render Driver': 'software',
      '': 'unknown',
      'Matrox G200': 'unknown',
    }).map(([name, kind]) => [name, [classifyGpu(name), kind]]),
  );
  for (const [name, [got, want]] of Object.entries(kinds)) assert.equal(got, want, name);
  assert.equal(classifyGpu(null), 'unknown');
  assert.equal(classifyGpu(['Intel(R) UHD Graphics 630', 'NVIDIA GeForce RTX 3050 Laptop GPU']), 'highend');
  assert.equal(classifyGpu(['Intel(R) UHD Graphics 630', 'NVIDIA GeForce MX350']), 'dedicated');
  assert.equal(classifyGpu([]), 'unknown');
});

test('recommendation: a preset for every kind of computer, each choice explained in Polish', () => {
  const fabric = { loader: 'fabric' };
  const rec = (pc, mods = 20, instance = fabric) => recommend({ javaMajor: 21, ...pc }, instance, mods);
  assert.equal(rec({ totalMem: 32 * GB, cpuCores: 12 }, 150).jvmPreset, 'zgc');
  assert.equal(rec({ totalMem: 15.9 * GB, cpuCores: 12 }, 150).jvmPreset, 'zgc', 'a 16 GB computer reports a little less');
  assert.equal(rec({ totalMem: 32 * GB, cpuCores: 12, javaMajor: 17 }, 150).jvmPreset, 'recommended', 'no generational ZGC before Java 21');
  assert.equal(rec({ totalMem: 32 * GB, cpuCores: 12 }, 30).jvmPreset, 'recommended', 'few mods → G1');
  // Graphics.
  assert.equal(rec({ totalMem: 4 * GB, cpuCores: 4 }).optionsPreset, 'low');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 2 }).optionsPreset, 'low');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 8, gpu: 'Google SwiftShader' }).optionsPreset, 'low');
  assert.equal(rec({ totalMem: 8 * GB, cpuCores: 4 }).optionsPreset, 'fps');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 8, gpu: 'Intel(R) UHD Graphics 620' }).optionsPreset, 'fps');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 8 }).optionsPreset, 'balanced', 'an unknown card is not assumed to be strong');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 6, gpu: 'NVIDIA GeForce GTX 1650' }).optionsPreset, 'balanced');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 12, gpu: 'NVIDIA GeForce RTX 4070' }).optionsPreset, 'quality');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 12, gpu: ['Intel(R) UHD Graphics', 'NVIDIA GeForce RTX 4070'] }).optionsPreset, 'quality');
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 12, gpu: 'NVIDIA GeForce RTX 4070' }).gpuClass, 'highend');
  // Turbo: only a hint, and only for strong processors with mods.
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 12 }).turbo, true);
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 4 }).turbo, false);
  assert.equal(rec({ totalMem: 16 * GB, cpuCores: 12 }, 0, { loader: 'vanilla' }).turbo, false);
  // Dlaczego?
  const full = rec({ totalMem: 16 * GB, cpuCores: 12, gpu: 'NVIDIA GeForce RTX 3060' }, 14);
  assert.deepEqual(full.reasons.map((r) => r.key), ['memory', 'jvm', 'options', 'mods']);
  assert.deepEqual(full.reasons.map((r) => r.title), ['Pamięć: 4 GB', 'Flagi Javy: zalecane (G1GC)', 'Grafika: Jakość', 'Mody: zestaw podstawowy']);
  assert.match(full.reasons[0].text, /Masz 16 GB pamięci i 14 modów/);
  assert.match(full.reasons[1].text, /Javy 21/);
  assert.match(full.reasons[3].text, /12 wątków.*Turbo/);
  assert.ok(full.reasons.every((r) => r.text.length > 40 && r.text.endsWith('.')));
  assert.deepEqual(rec({ totalMem: 8 * GB, cpuCores: 4 }, 0, { loader: 'vanilla' }).reasons.map((r) => r.key), ['memory', 'jvm', 'options'], 'no mods without a loader');
  assert.match(rec({ totalMem: 16 * GB, cpuCores: 8, gpu: 'Intel(R) UHD Graphics 620' }).reasons[2].text, /zintegrowaną kartę graficzną/);
  assert.match(rec({ totalMem: 32 * GB, cpuCores: 12 }, 150).reasons[1].text, /ZGC sprząta pamięć w tle/);
  assert.equal(rec({ totalMem: 3 * GB, cpuCores: 4 }).reasons[0].title, 'Pamięć: 1,5 GB');
});

test('graphics presets change only their keys and work for old and new video settings', async () => {
  const merged = mergeOptions('version:3953\nkey_key.jump:key.keyboard.space\nrenderDistance:20\n', { renderDistance: '8', maxFps: '260' });
  assert.equal(merged, 'version:3953\nkey_key.jump:key.keyboard.space\nrenderDistance:8\nmaxFps:260\n');
  assert.deepEqual(Object.keys(OPTION_PRESETS), ['low', 'fps', 'balanced', 'quality']);
  assert.deepEqual(Object.values(OPTION_PRESETS).map((p) => p.label), ['Słaby komputer', 'Maks. FPS', 'Zrównoważony', 'Jakość']);
  const num = (preset, key) => Number(OPTION_PRESETS[preset].values[key]);
  for (const key of ['renderDistance', 'simulationDistance', 'mipmapLevels', 'entityDistanceScaling', 'weatherRadius']) {
    assert.ok(num('low', key) <= num('fps', key) && num('fps', key) <= num('balanced', key) && num('balanced', key) <= num('quality', key), `${key} grows with the preset`);
  }
  for (const p of Object.values(OPTION_PRESETS)) {
    // Up to 1.21.10: graphicsMode; from 1.21.11: graphicsPreset and its separate switches – with matching values.
    const fast = p.values.graphicsMode === '0';
    assert.equal(p.values.graphicsPreset, '"custom"');
    assert.deepEqual([p.values.cutoutLeaves, p.values.vignette, p.values.weatherRadius], fast ? ['false', 'false', '5'] : ['true', 'true', '10'], p.label);
    assert.equal(p.values.improvedTransparency, 'false');
    // Values the game accepts.
    assert.ok(num(p.label === 'x' ? 'low' : Object.keys(OPTION_PRESETS).find((k) => OPTION_PRESETS[k] === p), 'renderDistance') >= 2);
    assert.ok(Number(p.values.simulationDistance) >= 5 && Number(p.values.mipmapLevels) >= 0 && Number(p.values.mipmapLevels) <= 4 && Number(p.values.entityDistanceScaling) >= 0.5 && ['0', '1', '2'].includes(p.values.particles) && ['"false"', '"fast"', '"true"'].includes(p.values.renderClouds));
  }
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'options.txt'), 'version:4671\nlang:pl_pl\nkey_key.attack:key.mouse.left\nfov:0.5\nrenderDistance:32\ngraphicsPreset:"fabulous"\n');
  writeOptionsPreset(dir, 'low');
  const text = fs.readFileSync(path.join(dir, 'options.txt'), 'utf8');
  for (const line of ['version:4671', 'lang:pl_pl', 'key_key.attack:key.mouse.left', 'fov:0.5', 'renderDistance:6', 'graphicsPreset:"custom"', 'graphicsMode:0', 'renderClouds:"false"', 'entityShadows:false', 'mipmapLevels:0']) assert.ok(text.split('\n').includes(line), line);
  assert.equal(text.split('\n').filter((l) => l.startsWith('renderDistance:')).length, 1);
  const fresh = tmpDir();
  writeOptionsPreset(fresh, 'fps');
  const made = fs.readFileSync(path.join(fresh, 'options.txt'), 'utf8');
  assert.match(made, /^lang:pl_pl$/m);
  assert.match(made, /^graphicsMode:0$/m);
  assert.throws(() => writeOptionsPreset(dir, 'nope'), /Nieznany preset/);
});

test('Windows GPU preference uses reg.exe', async () => {
  const calls = [];
  const ok = await setGpuPreference('C:\\java\\bin\\javaw.exe', { platform: 'win32', run: (cmd, args, opts, cb) => (calls.push([cmd, ...args]), cb(null)) });
  assert.equal(ok, true);
  assert.deepEqual(calls[0].slice(0, 4), ['reg', 'add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v']);
  assert.ok(calls[0].includes('GpuPreference=2;'));
  assert.equal(await setGpuPreference('/usr/bin/java', { platform: 'linux' }), false);
});

/** Services with a fake Modrinth where every asked mod exists for Fabric. */
function setup({ gpu = 'NVIDIA GeForce RTX 3060', mcVersion = '1.21.1' } = {}) {
  const installs = [];
  const services = createServices({ root: tmpDir(), config: {}, accounts: {}, gpuInfo: () => gpu });
  services.modrinth.versions = async (slug, { loaders }) => (loaders.includes('fabric') ? [{ ...version(slug, ['fabric']), game_versions: [mcVersion] }] : []);
  services.content.install = async (instance, what) => (installs.push(what.projectId), { installed: [what.projectId.replace(/-id$/, '')], skipped: [], warnings: [] });
  const instance = services.instances.create({ name: 'Hammer', mcVersion, loader: 'fabric' });
  return { services, instance, installs };
}

test('services: the Optymalizacja tab gets the Java of the instance, the exact flags and the reasons', async () => {
  const { services, instance } = setup({ mcVersion: '26.3' });
  const info = await services.optimizerInfo(instance.id);
  assert.deepEqual(info.java, { major: 25, known: false, own: false, zgc: true }, 'not installed yet → from the game version');
  assert.ok(info.jvm.flags.recommended.includes('-XX:+UseCompactObjectHeaders') && info.jvm.flags.recommended.includes('-XX:+UseG1GC'));
  assert.ok(info.jvm.flags.zgc.includes('-XX:+UseZGC') && !info.jvm.flags.zgc.includes('-XX:+ZGenerational'));
  assert.equal(info.jvm.flags.vanilla.length, 3);
  assert.equal(info.jvm.memoryMb, info.recommendation.memoryMb);
  assert.deepEqual(Object.keys(info.presets), ['low', 'fps', 'balanced', 'quality']);
  assert.ok(info.recommendation.reasons.length >= 3);
  assert.deepEqual([info.system.gpu, info.system.gpus], ['NVIDIA GeForce RTX 3060', ['NVIDIA GeForce RTX 3060']]);
  // The version JSON on disk wins over the guess; an own Java wins over both.
  const dir = path.join(services.paths.versions, '26.3');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '26.3.json'), JSON.stringify({ id: '26.3', javaVersion: { component: 'java-runtime-epsilon', majorVersion: 25 } }));
  assert.deepEqual((await services.optimizerInfo(instance.id)).java, { major: 25, known: true, own: false, zgc: true });
  const home = tmpDir('java');
  fs.mkdirSync(path.join(home, 'bin'));
  fs.writeFileSync(path.join(home, 'bin', 'java'), '');
  fs.writeFileSync(path.join(home, 'release'), 'JAVA_VERSION="17.0.15"\n');
  services.instances.update(instance.id, { javaPath: path.join(home, 'bin', 'java') });
  const own = await services.optimizerInfo(instance.id);
  assert.deepEqual(own.java, { major: 17, known: true, own: true, zgc: false });
  assert.ok(own.jvm.flags.zgc.includes('-XX:+UseG1GC'), 'ZGC on Java 17 → the tuned G1');
  // A laptop: the weak card runs the launcher, the strong one runs the game.
  const laptop = createServices({ root: tmpDir(), config: {}, accounts: {}, gpuInfo: () => ({ name: 'Intel(R) UHD Graphics 630', devices: ['Intel(R) UHD Graphics 630', 'NVIDIA GeForce RTX 3050'] }) });
  const i2 = laptop.instances.create({ name: 'L', mcVersion: '1.21.1', loader: 'vanilla' });
  const l = await laptop.optimizerInfo(i2.id);
  assert.deepEqual([l.system.gpu, l.system.gpus.length, l.recommendation.gpuClass], ['Intel(R) UHD Graphics 630', 2, 'highend']);
  assert.deepEqual((await createServices({ root: tmpDir(), config: {}, accounts: {} }).system()).gpus, []);
});

test('services: "Zoptymalizuj wszystko" does the work and says what it did', async () => {
  const { services, instance, installs } = setup();
  services.instances.update(instance.id, { memoryMb: 8192 });
  const res = await services.applyOptimization(instance.id, { mods: true, optionsPreset: 'balanced', memoryMb: null, jvmPreset: 'zgc' });
  assert.ok(installs.includes('sodium-id') && installs.includes('lithium-id'));
  assert.ok(!installs.includes('c2me-fabric-id') && !installs.includes('iris-id'), 'Turbo and shaders only when asked for');
  const s = res.summary;
  assert.deepEqual(s.mods.installed, res.installed);
  assert.ok(s.mods.installed.includes('sodium'));
  assert.deepEqual([s.memoryAuto, s.jvmPreset, s.javaMajor, s.optionsPreset, s.priority, s.turbo, s.shaders], [true, 'zgc', 21, { key: 'balanced', label: 'Zrównoważony' }, 'above_normal', false, false]);
  assert.ok(s.memoryMb >= 1024 && s.memoryMb < 8192, 'memory back on automatic');
  const saved = services.instances.get(instance.id);
  assert.deepEqual([saved.memoryMb, saved.jvmPreset, saved.optimized, saved.optimizedFor], [null, 'zgc', true, '1.21.1|fabric']);
  assert.match(fs.readFileSync(path.join(saved.dir, 'options.txt'), 'utf8'), /^renderDistance:12$/m);
  // Turbo on request; a pinned loader version gets a hint.
  services.instances.update(instance.id, { loaderVersion: '0.15.0' });
  const turbo = await services.applyOptimization(instance.id, { mods: true, turbo: true });
  assert.ok(installs.includes('c2me-fabric-id'));
  assert.equal(turbo.summary.turbo, true);
  assert.equal(turbo.summary.optionsPreset, null);
  assert.match(turbo.warnings.at(-1), /Turbo mogą wymagać najnowszego loadera/);
  // Graphics only; a vanilla instance has no mods to install; the priority of the instance wins.
  const only = await services.applyOptimization(instance.id, { mods: false, optionsPreset: 'low' });
  assert.deepEqual([only.summary.mods, only.installed, only.summary.optionsPreset.label], [null, [], 'Słaby komputer']);
  const vanilla = services.instances.create({ name: 'V', mcVersion: '1.16.5', loader: 'vanilla' });
  services.instances.update(vanilla.id, { processPriority: 'high', jvmPreset: 'zgc' });
  const v = await services.applyOptimization(vanilla.id, { mods: true, turbo: true });
  assert.deepEqual([v.summary.mods, v.summary.turbo, v.summary.priority, v.summary.javaMajor, v.summary.jvmPreset], [null, false, 'high', 8, 'recommended']);
  await assert.rejects(services.applyOptimization(instance.id, { mods: false, optionsPreset: 'kosmos' }), /Nieznany preset/);
});
