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
