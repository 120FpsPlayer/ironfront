'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { createModpacks, loaderOf } = require('../src/main/modpacks');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { tmpDir, mockFetch, sha1 } = require('./helpers');

const MOD = Buffer.from('fake-mod-bytes');
function pack({ files, overrides = {}, deps = { minecraft: '1.21.1', 'fabric-loader': '0.16.9' } }) {
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0', name: 'Paczka Testowa', files, dependencies: deps })));
  for (const [p, body] of Object.entries(overrides)) zip.addFile(p, Buffer.from(body));
  const file = path.join(tmpDir('pack'), 'test.mrpack');
  zip.writeZip(file);
  return file;
}

function setup() {
  const fetchFn = mockFetch([{ match: /cdn\.modrinth\.com\/.*mod\.jar$/, body: MOD }]);
  const instances = createInstances(createPaths(tmpDir()));
  return { instances, modpacks: createModpacks({ modrinth: {}, instances, fetchFn }), fetchFn };
}

test('a .mrpack becomes an instance: version and loader from the pack, client files, overrides (client ones win)', async () => {
  const { modpacks } = setup();
  const file = pack({
    files: [
      { path: 'mods/mod.jar', hashes: { sha1: sha1(MOD) }, downloads: ['https://cdn.modrinth.com/data/x/mod.jar'], env: { client: 'required', server: 'required' } },
      { path: 'mods/server-only.jar', hashes: { sha1: 'x' }, downloads: ['https://cdn.modrinth.com/data/x/server.jar'], env: { client: 'unsupported', server: 'required' } },
    ],
    overrides: { 'overrides/config/a.toml': 'a=1', 'overrides/options.txt': 'lang:en_us', 'client-overrides/options.txt': 'lang:pl_pl\nmaxFps:120' },
  });
  const progress = [];
  const instance = await modpacks.installFile(file, { onProgress: (p) => progress.push(p.done) });
  assert.deepEqual([instance.name, instance.mcVersion, instance.loader, instance.loaderVersion], ['Paczka Testowa', '1.21.1', 'fabric', '0.16.9']);
  assert.deepEqual(fs.readFileSync(path.join(instance.dir, 'mods', 'mod.jar')), MOD);
  assert.ok(!fs.existsSync(path.join(instance.dir, 'mods', 'server-only.jar')), 'server-only files are skipped');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'config', 'a.toml'), 'utf8'), 'a=1');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'), 'lang:pl_pl\nmaxFps:120');
  assert.deepEqual(progress, [0, 1]);
});

test('a pack that tries to write outside its folder or downloads from a foreign host is refused – nothing is left', async () => {
  const { modpacks, instances } = setup();
  const evil = pack({ files: [{ path: '../../evil.jar', hashes: { sha1: sha1(MOD) }, downloads: ['https://cdn.modrinth.com/data/x/mod.jar'] }] });
  await assert.rejects(modpacks.installFile(evil), /poza folderem instancji/);
  const foreign = pack({ files: [{ path: 'mods/a.jar', hashes: { sha1: sha1(MOD) }, downloads: ['https://evil.example/mod.jar'] }] });
  await assert.rejects(modpacks.installFile(foreign), /niedozwolonego źródła/);
  assert.deepEqual(instances.list(), [], 'the half-made instances are removed');
  const notAPack = path.join(tmpDir(), 'x.mrpack');
  new AdmZip().writeZip(notAPack);
  await assert.rejects(modpacks.installFile(notAPack), /To nie jest paczka Modrinth/);
});

test('loader keys of the .mrpack format', () => {
  assert.deepEqual(loaderOf({ minecraft: '1.21.1', neoforge: '21.1.77' }), { loader: 'neoforge', loaderVersion: '21.1.77' });
  assert.deepEqual(loaderOf({ minecraft: '1.20.1', forge: '47.3.0' }), { loader: 'forge', loaderVersion: '47.3.0' });
  assert.deepEqual(loaderOf({ minecraft: '1.21.1', 'quilt-loader': '0.27.1' }), { loader: 'quilt', loaderVersion: '0.27.1' });
  assert.deepEqual(loaderOf({ minecraft: '1.21.1' }), { loader: 'vanilla', loaderVersion: null });
});

test('one pack file that cannot be fetched stops the rest: nothing more is downloaded and no folder is left behind', async () => {
  const root = tmpDir();
  const paths = createPaths(root);
  fs.mkdirSync(paths.instances, { recursive: true });
  const instances = createInstances(paths);
  const files = Array.from({ length: 24 }, (_, i) => ({ path: `mods/m${i}.jar`, downloads: [`https://cdn.modrinth.com/m${i}.jar`], env: { client: 'required' } }));
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ game: 'minecraft', name: 'Pack', dependencies: { minecraft: '1.21.1', 'fabric-loader': '0.16.9' }, files })));
  const file = path.join(root, 'p.mrpack');
  zip.writeZip(file);
  let calls = 0;
  const fetchFn = async (url) => {
    calls += 1;
    if (url.includes('/m0.jar')) return { ok: false, status: 404, headers: new Headers() };
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, status: 200, headers: new Headers(), body: null, arrayBuffer: async () => new ArrayBuffer(4) };
  };
  await assert.rejects(createModpacks({ modrinth: {}, instances, fetchFn }).installFile(file), /HTTP 404/);
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(calls <= 6, `only the downloads already started (${calls})`);
  assert.deepEqual(instances.list(), []);
  assert.deepEqual(fs.readdirSync(paths.instances).filter((d) => !d.startsWith('.') && d !== 'instances.json'), [], 'no orphan folder');
});
