'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBundles, BUNDLES } = require('../src/main/bundles');
const { PERFORMANCE_MODS } = require('../src/main/optimizer');
const { createServices } = require('../src/main/services');
const { tmpDir } = require('./helpers');

const version = (slug, loaders, mc = '1.21.1') => ({ id: `${slug}-v`, project_id: `${slug}-id`, version_number: '1.0', version_type: 'release', loaders, game_versions: [mc] });

/** Modrinth where `mods` exist for Fabric and `shaders` as shader packs; everything else is missing. */
function fakeModrinth({ fabric = [], forge = [], shaders = [] } = {}) {
  const asked = [];
  return {
    asked,
    versions: async (slug, { loaders, gameVersions }) => {
      asked.push({ slug, loaders, gameVersions });
      if (loaders.includes('iris')) return shaders.includes(slug) ? [version(slug, ['iris'])] : [];
      if (loaders.includes('fabric') && fabric.includes(slug)) return [version(slug, ['fabric'])];
      if (loaders.includes('forge') && forge.includes(slug)) return [version(slug, ['forge'])];
      return [];
    },
  };
}

test('the sets are curated: real-looking slugs, Polish texts, nothing that servers ban', () => {
  assert.deepEqual(BUNDLES.map((b) => b.id), ['pvp', 'survival', 'building', 'shaders', 'visuals']);
  for (const b of BUNDLES) {
    assert.ok(b.name && b.description.length > 30 && b.note.length > 20 && b.icon, b.id);
    assert.ok(b.items.length >= 4, b.id);
    for (const m of b.items) {
      assert.match(m.slug, /^[a-z0-9-]+$/);
      assert.ok(m.name && m.why.length > 10, m.slug);
      assert.ok(m.type === undefined || m.type === 'shader', m.slug);
      for (const other of m.insteadOf ?? []) assert.ok(b.items.some((x) => x.slug === other), `${m.slug} stands in for a mod of the same set`);
    }
    assert.equal(new Set(b.items.map((m) => m.slug)).size, b.items.length, `${b.id}: no slug twice`);
  }
  // Things players get banned for never go into a set (or into the performance mods).
  const all = [...BUNDLES.flatMap((b) => b.items), ...PERFORMANCE_MODS].map((m) => m.slug);
  for (const banned of ['freecam', 'litematica-printer', 'tweakeroo', 'wurst', 'meteor-client', 'xray', 'baritone', 'no-chat-reports', 'freelook', 'gamma-utils', 'minihud']) assert.ok(!all.includes(banned), banned);
  const pvp = BUNDLES.find((b) => b.id === 'pvp').items.map((m) => m.slug);
  assert.ok(!pvp.some((s) => /minimap|world-map/.test(s)), 'no minimap in the PvP set');
});

test('list: the sets without asking Modrinth', () => {
  const modrinth = fakeModrinth();
  const list = createBundles({ modrinth, content: {} }).list();
  assert.deepEqual(Object.keys(list[0]), ['id', 'name', 'icon', 'description', 'note', 'size']);
  assert.equal(list.find((b) => b.id === 'shaders').size, 4, 'Oculus stands in for Iris and is not counted');
  assert.equal(modrinth.asked.length, 0);
});

test('plan: what exists for the instance, what is installed, shader packs asked for as shaders', async () => {
  const modrinth = fakeModrinth({ fabric: ['iris', 'xaeros-minimap', 'jei', 'appleskin'], forge: ['oculus', 'jei'], shaders: ['complementary-reimagined', 'bsl-shaders'] });
  const content = { installedProjects: () => new Map([['jei-id', {}], ['bsl-shaders-id', {}]]) };
  const bundles = createBundles({ modrinth, content });
  const fabric = { loader: 'fabric', mcVersion: '1.21.1' };

  const survival = await bundles.plan(fabric, 'survival');
  assert.equal(survival.supported, true);
  assert.deepEqual(survival.mods.filter((m) => m.available).map((m) => [m.slug, m.installed]), [['xaeros-minimap', false], ['jei', true], ['appleskin', false]]);
  assert.ok(survival.mods.some((m) => m.slug === 'jade' && !m.available), 'a missing mod is listed as missing');
  assert.ok(modrinth.asked.every((a) => a.gameVersions[0] === '1.21.1'));

  const shaders = await bundles.plan(fabric, 'shaders');
  assert.deepEqual(shaders.mods.map((m) => [m.slug, m.type, m.available, m.installed]), [
    ['iris', 'mod', true, false],
    ['complementary-reimagined', 'shader', true, false],
    ['bsl-shaders', 'shader', true, true],
    ['makeup-ultra-fast-shaders', 'shader', false, false],
  ]);
  assert.deepEqual(modrinth.asked.find((a) => a.slug === 'bsl-shaders').loaders, ['iris', 'optifine']);
  assert.deepEqual(modrinth.asked.find((a) => a.slug === 'iris').loaders, ['fabric']);

  // Forge: Oculus instead of Iris; Quilt asks for Quilt and Fabric builds.
  const forge = await bundles.plan({ loader: 'forge', mcVersion: '1.21.1' }, 'shaders');
  assert.deepEqual(forge.mods.filter((m) => m.type === 'mod').map((m) => m.slug), ['oculus']);
  await bundles.plan({ loader: 'quilt', mcVersion: '1.21.1' }, 'pvp');
  assert.deepEqual(modrinth.asked.at(-1).loaders, ['quilt', 'fabric']);

  assert.deepEqual(await bundles.plan({ loader: 'vanilla', mcVersion: '1.21.1' }, 'pvp'), { ...bundles.list()[0], supported: false, mods: [] });
  await assert.rejects(bundles.plan(fabric, 'cheaty'), /Nie ma takiego zestawu/);
  // Modrinth is down: an error, not an empty set.
  const down = createBundles({ modrinth: { versions: async () => Promise.reject(new Error('Brak połączenia z Modrinth. Sprawdź internet.')) }, content });
  await assert.rejects(down.plan(fabric, 'pvp'), /Brak połączenia z Modrinth/);
});

test('install: every available part through the normal content install, with its type; progress is reported', async () => {
  const modrinth = fakeModrinth({ fabric: ['iris'], shaders: ['complementary-reimagined', 'bsl-shaders'] });
  const calls = [];
  const content = {
    installedProjects: () => new Map([['bsl-shaders-id', {}]]),
    install: async (instance, what) => {
      calls.push(what);
      if (what.projectId === 'complementary-reimagined-id') throw new Error('Pobieranie nie powiodło się (HTTP 503)');
      return { installed: ['Iris Shaders', 'Sodium'], skipped: [], warnings: [] };
    },
  };
  const progress = [];
  const res = await createBundles({ modrinth, content }).install({ loader: 'fabric', mcVersion: '1.21.1' }, 'shaders', { onProgress: (p) => progress.push(`${p.done}/${p.total}`) });
  assert.deepEqual(calls, [
    { projectId: 'iris-id', versionId: 'iris-v', type: 'mod' },
    { projectId: 'complementary-reimagined-id', versionId: 'complementary-reimagined-v', type: 'shader' },
  ]);
  assert.deepEqual(res.installed, ['Iris Shaders', 'Sodium'], 'dependencies come along');
  assert.deepEqual(res.warnings, ['Complementary Reimagined: Pobieranie nie powiodło się (HTTP 503)'], 'one failed download does not stop the rest');
  assert.deepEqual(res.missing, ['MakeUp – Ultra Fast']);
  assert.deepEqual(progress, ['0/2', '1/2', '1/2', '2/2']);
  await assert.rejects(createBundles({ modrinth, content }).install({ loader: 'vanilla', mcVersion: '1.21.1' }, 'pvp'), /Mody wymagają loadera/);
});

test('services: the sets are looked up for one instance', async () => {
  const modrinth = fakeModrinth({ fabric: ['appleskin'] });
  const events = [];
  const services = createServices({ root: tmpDir(), config: {}, accounts: {}, emit: (channel, payload) => events.push({ channel, ...payload }) });
  Object.assign(services.modrinth, modrinth);
  const instance = services.instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  assert.equal(services.bundles.list().length, 5);
  const plan = await services.bundles.plan(instance.id, 'survival');
  assert.deepEqual(plan.mods.filter((m) => m.available).map((m) => m.slug), ['appleskin']);
  assert.throws(() => services.bundles.plan('nie-ma', 'survival'), /Nie ma takiej instancji/);
});
