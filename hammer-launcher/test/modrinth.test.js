'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createModrinth, pickVersion, loadersFor } = require('../src/main/modrinth');
const { mockFetch } = require('./helpers');

test('search: type, game version, the instance loader (Quilt also finds Fabric mods), client-side mods only', async () => {
  const fetchFn = mockFetch([{ match: /\/search/, json: { hits: [{ slug: 'sodium' }], total_hits: 1 } }]);
  const mr = createModrinth({ fetchFn });
  const res = await mr.search({ query: 'sodium', type: 'mod', mcVersion: '1.21.1', loader: 'quilt', categories: ['optimization'], sort: 'downloads', offset: 20 });
  assert.equal(res.hits[0].slug, 'sodium');
  const url = new URL(fetchFn.calls[0].url);
  assert.deepEqual(JSON.parse(url.searchParams.get('facets')), [['project_type:mod'], ['versions:1.21.1'], ['categories:quilt', 'categories:fabric'], ['categories:optimization'], ['client_side:required', 'client_side:optional']]);
  assert.equal(url.searchParams.get('index'), 'downloads');
  assert.equal(url.searchParams.get('offset'), '20');
  assert.match(fetchFn.calls[0].init.headers['user-agent'], /Hammer-Launcher/);

  await mr.search({ type: 'resourcepack', mcVersion: '1.21.1', loader: 'fabric' });
  assert.deepEqual(JSON.parse(new URL(fetchFn.calls[1].url).searchParams.get('facets')), [['project_type:resourcepack'], ['versions:1.21.1']], 'no loader filter for resource packs');
});

test('rate limits and server errors are retried; a missing project is null', async () => {
  const fetchFn = mockFetch([
    { match: /\/project\/sodium$/, status: 429, json: {}, once: true },
    { match: /\/project\/sodium$/, json: { id: 'AANobbMI', title: 'Sodium' } },
    { match: /\/project\/nope$/, status: 404, json: {} },
  ]);
  const mr = createModrinth({ fetchFn, sleep: async () => {} });
  assert.equal((await mr.project('sodium')).title, 'Sodium');
  assert.equal(fetchFn.calls.length, 2);
  assert.equal(await mr.project('nope'), null);
  const down = createModrinth({ fetchFn: mockFetch([{ match: /./, status: 503, json: {} }]), sleep: async () => {} });
  await assert.rejects(down.project('x'), /chwilowe problemy/);
});

test('pickVersion: this game version and loader, releases first, own loader before a compatible one', () => {
  const v = (id, type, loaders, mc = ['1.21.1']) => ({ id, version_type: type, loaders, game_versions: mc });
  const list = [v('beta-new', 'beta', ['fabric']), v('rel-fabric', 'release', ['fabric']), v('rel-quilt', 'release', ['quilt']), v('old-mc', 'release', ['fabric'], ['1.20.1'])];
  assert.equal(pickVersion(list, { mcVersion: '1.21.1', loaders: ['fabric'] }).id, 'rel-fabric');
  assert.equal(pickVersion(list, { mcVersion: '1.21.1', loaders: loadersFor('mod', 'quilt') }).id, 'rel-quilt');
  assert.equal(pickVersion(list, { mcVersion: '1.19.4', loaders: ['fabric'] }), null);
  assert.equal(pickVersion([v('only-beta', 'beta', ['neoforge'])], { mcVersion: '1.21.1', loaders: ['neoforge'] }).id, 'only-beta');
});

test('many versions and projects at once: a hundred ids per request, unknown ids are simply missing', async () => {
  const fetchFn = mockFetch([
    { match: /\/versions\?/, json: (u) => JSON.parse(new URL(u).searchParams.get('ids')).filter((id) => id !== 'gone0000').map((id) => ({ id })) },
    { match: /\/projects\?/, json: (u) => JSON.parse(new URL(u).searchParams.get('ids')).map((id) => ({ id, title: id })) },
  ]);
  const mr = createModrinth({ fetchFn });
  const ids = Array.from({ length: 230 }, (_, i) => `v${String(i).padStart(7, '0')}`);
  assert.deepEqual((await mr.versionsByIds([...ids, 'gone0000'])).map((v) => v.id), ids);
  assert.deepEqual(fetchFn.calls.map((c) => JSON.parse(new URL(c.url).searchParams.get('ids')).length), [100, 100, 31]);
  assert.deepEqual(await mr.versionsByIds([]), []);
  assert.equal(fetchFn.calls.length, 3, 'nothing to ask for – nothing asked');
  assert.equal((await mr.projects(ids)).length, 230);
  assert.equal(fetchFn.calls.length, 6);
  assert.deepEqual(await mr.projects([]), []);
});

test('author: the name the search shows for a project', async () => {
  const fetchFn = mockFetch([{ match: /\/search/, json: (u) => ({ hits: new URL(u).searchParams.get('facets').includes('1KVo5zza') ? [{ project_id: '1KVo5zza', author: 'robotkoer' }] : [{ project_id: 'other000', author: 'ktoś inny' }] }) }]);
  const mr = createModrinth({ fetchFn });
  assert.equal(await mr.author('1KVo5zza'), 'robotkoer');
  assert.deepEqual(JSON.parse(new URL(fetchFn.calls[0].url).searchParams.get('facets')), [['project_id:1KVo5zza']]);
  assert.equal(await mr.author('AANobbMI'), null, 'a hit for another project is not an answer');
});
