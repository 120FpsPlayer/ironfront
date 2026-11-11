'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createModrinth } = require('../src/main/modrinth');
const { createContent } = require('../src/main/content');
const { createUpdates } = require('../src/main/updates');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { tmpDir, fabricJar, mrVersion, sha1 } = require('./helpers');

const sodiumJar = fabricJar({ id: 'sodium', name: 'Sodium', version: '0.6.0' });
const cullJar = fabricJar({ id: 'entityculling', name: 'EntityCulling', version: '1.7' });
const apiJar = fabricJar({ id: 'fabric-api', name: 'Fabric API', version: '0.110' });

const SODIUM = mrVersion({ id: 'sod1', projectId: 'AANobbMI', name: 'Sodium 0.6.0', number: '0.6.0', file: { name: 'sodium-0.6.0.jar', body: sodiumJar } });
const API = mrVersion({ id: 'api1', projectId: 'P7dR8mSH', number: '0.110', file: { name: 'fabric-api-0.110.jar', body: apiJar } });
const CULL = mrVersion({ id: 'cull1', projectId: 'NNAgCjsB', number: '1.7', deps: [{ project_id: 'P7dR8mSH', dependency_type: 'required' }, { project_id: 'XXXXXX', dependency_type: 'optional' }], file: { name: 'entityculling-1.7.jar', body: cullJar } });
const PROJECTS = { AANobbMI: { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon_url: 'https://cdn.modrinth.com/s.png' }, P7dR8mSH: { id: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API' }, NNAgCjsB: { id: 'NNAgCjsB', slug: 'entityculling', title: 'EntityCulling' } };
const VERSIONS = { AANobbMI: [SODIUM], sodium: [SODIUM], P7dR8mSH: [API], NNAgCjsB: [CULL], entityculling: [CULL] };

function setup(extra = []) {
  const files = { 'sodium-0.6.0.jar': sodiumJar, 'entityculling-1.7.jar': cullJar, 'fabric-api-0.110.jar': apiJar };
  const routes = [
    ...extra,
    { match: (u) => /cdn\.modrinth\.com\/data\//.test(u), dyn: (u) => files[u.split('/').pop()] },
    { match: (u) => /\/project\/[^/]+\/version/.test(u), json: (u) => VERSIONS[decodeURIComponent(u.split('/project/')[1].split('/')[0])] ?? [] },
    { match: (u) => /\/project\/[^/?]+$/.test(u), json: (u) => PROJECTS[decodeURIComponent(u.split('/project/')[1])] ?? PROJECTS[Object.keys(PROJECTS).find((k) => PROJECTS[k].slug === decodeURIComponent(u.split('/project/')[1]))] },
    { match: (u) => /\/version\/[^/]+$/.test(u), json: (u) => [SODIUM, API, CULL].find((v) => v.id === u.split('/version/')[1]) },
  ];
  const fn = async (url, init) => {
    const r = routes.find((x) => x.match(String(url), init));
    fn.calls.push(String(url));
    if (!r) return new Response('nope', { status: 404 });
    if (r.dyn) {
      const body = r.dyn(String(url));
      return body ? new Response(body, { status: 200, headers: { 'content-length': String(body.length) } }) : new Response('nope', { status: 404 });
    }
    const payload = typeof r.json === 'function' ? r.json(String(url), init) : r.json;
    return payload === undefined ? new Response('nope', { status: 404 }) : new Response(JSON.stringify(payload), { status: 200 });
  };
  fn.calls = [];
  const root = tmpDir();
  const instances = createInstances(createPaths(root));
  const instance = instances.create({ name: 'Test', mcVersion: '1.21.1', loader: 'fabric' });
  const modrinth = createModrinth({ fetchFn: fn, sleep: async () => {} });
  const content = createContent({ modrinth, fetchFn: fn });
  return { content, instance, instances, fetchFn: fn, files, modrinth };
}

test('install: the newest fitting version plus required dependencies – optional ones are left out', async () => {
  const { content, instance } = setup();
  const res = await content.install(instance, { projectId: 'entityculling', type: 'mod' });
  assert.deepEqual(res.installed.sort(), ['EntityCulling', 'Fabric API']);
  const mods = fs.readdirSync(path.join(instance.dir, 'mods')).sort();
  assert.deepEqual(mods, ['entityculling-1.7.jar', 'fabric-api-0.110.jar']);
  const list = content.list(instance, 'mod');
  assert.deepEqual(list.map((m) => [m.title, m.projectId, m.enabled]), [['EntityCulling', 'NNAgCjsB', true], ['Fabric API', 'P7dR8mSH', true]]);

  const again = await content.install(instance, { projectId: 'entityculling', type: 'mod' });
  assert.deepEqual(again.installed, [], 'nothing twice');
  assert.deepEqual(again.skipped, ['EntityCulling']);
});

test('install refuses mods without a loader and explains a missing version', async () => {
  const { content, instances } = setup();
  const vanilla = instances.create({ name: 'Vanilla', mcVersion: '1.21.1', loader: 'vanilla' });
  await assert.rejects(content.install(vanilla, { projectId: 'sodium', type: 'mod' }), /Mody wymagają loadera/);
  const old = instances.create({ name: 'Old', mcVersion: '1.16.5', loader: 'fabric' });
  await assert.rejects(content.install(old, { projectId: 'sodium', type: 'mod' }), /brak wersji dla Minecrafta 1\.16\.5/);
});

test('a download with the wrong checksum is refused and leaves nothing behind', async () => {
  const { content, instance, files } = setup();
  files['sodium-0.6.0.jar'] = Buffer.from('tampered');
  await assert.rejects(content.install(instance, { projectId: 'sodium', type: 'mod' }), /suma kontrolna/);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'mods')), []);
});

test('hand-copied jars are read (fabric.mod.json), can be disabled/enabled and removed', async () => {
  const { content, instance } = setup();
  fs.writeFileSync(path.join(instance.dir, 'mods', 'my-mod.jar'), fabricJar({ id: 'mine', name: 'Mój Mod', version: '2.0', description: 'Opis' }));
  let [mod] = content.list(instance, 'mod');
  assert.deepEqual([mod.title, mod.versionNumber, mod.description, mod.enabled, mod.projectId], ['Mój Mod', '2.0', 'Opis', true, undefined]);
  content.setEnabled(instance, 'mod', 'my-mod.jar', false);
  assert.ok(fs.existsSync(path.join(instance.dir, 'mods', 'my-mod.jar.disabled')));
  [mod] = content.list(instance, 'mod');
  assert.equal(mod.enabled, false);
  content.setEnabled(instance, 'mod', 'my-mod.jar', true);
  content.remove(instance, 'mod', 'my-mod.jar');
  assert.deepEqual(content.list(instance, 'mod'), []);
});

test('updates: Modrinth knows a newer version → it replaces the old file and keeps it disabled', async () => {
  const newer = mrVersion({ id: 'sod2', projectId: 'AANobbMI', number: '0.6.1', file: { name: 'sodium-0.6.1.jar', body: fabricJar({ id: 'sodium', name: 'Sodium', version: '0.6.1' }) } });
  const { content, instance, files, modrinth } = setup([
    { match: (u, i) => /version_files\/update/.test(u) && i?.method === 'POST', json: (u, i) => Object.fromEntries(JSON.parse(i.body).hashes.map((h) => [h, newer])) },
    { match: (u) => /\/versions\?/.test(u), json: [newer] },
    { match: (u) => /\/projects\?/.test(u), json: [PROJECTS.AANobbMI] },
  ]);
  files['sodium-0.6.1.jar'] = Buffer.from(Buffer.from(fabricJar({ id: 'sodium', name: 'Sodium', version: '0.6.1' })));
  newer.files[0].hashes.sha1 = sha1(files['sodium-0.6.1.jar']);
  newer.files[0].size = files['sodium-0.6.1.jar'].length;
  await content.install(instance, { projectId: 'sodium', type: 'mod' });
  content.setEnabled(instance, 'mod', 'sodium-0.6.0.jar', false);
  const updates = await content.checkUpdates(instance, 'mod');
  assert.deepEqual(updates.map((u) => [u.file, u.current, u.latest.versionNumber]), [['sodium-0.6.0.jar', '0.6.0', '0.6.1']]);
  // The update itself goes through updates.js, which keeps a restore point (see updates.test.js).
  const done = await createUpdates({ content, modrinth }).apply(instance, updates.map((u) => ({ type: 'mod', ...u })));
  assert.deepEqual(done.updated.map((u) => u.title), ['Sodium']);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'mods')), ['sodium-0.6.1.jar.disabled']);
});

test('installVersion: exactly the version given – no dependency lookup, nothing newer, another version of the project replaced', async () => {
  const { content, instance, fetchFn, files } = setup();
  // EntityCulling requires Fabric API – an exact install takes the one file and asks Modrinth for nothing.
  assert.equal(await content.installVersion(instance, 'mod', CULL, PROJECTS.NNAgCjsB), 'entityculling-1.7.jar');
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'mods')), ['entityculling-1.7.jar']);
  assert.deepEqual(fetchFn.calls, ['https://cdn.modrinth.com/data/NNAgCjsB/versions/cull1/entityculling-1.7.jar']);
  assert.deepEqual(content.list(instance, 'mod').map((m) => [m.title, m.projectId, m.versionId, m.versionNumber]), [['EntityCulling', 'NNAgCjsB', 'cull1', '1.7']]);
  // Another version of a project that is already there takes its place.
  const older = mrVersion({ id: 'cull0', projectId: 'NNAgCjsB', number: '1.6', file: { name: 'entityculling-1.6.jar', body: fabricJar({ id: 'entityculling', name: 'EntityCulling', version: '1.6' }) } });
  files['entityculling-1.6.jar'] = fabricJar({ id: 'entityculling', name: 'EntityCulling', version: '1.6' });
  older.files[0].hashes.sha1 = sha1(files['entityculling-1.6.jar']);
  await content.installVersion(instance, 'mod', older, PROJECTS.NNAgCjsB);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'mods')), ['entityculling-1.6.jar']);
  // The file has to be what its kind says, and the kind one the launcher knows; a wrong checksum is refused as always.
  await assert.rejects(content.installVersion(instance, 'resourcepack', SODIUM, PROJECTS.AANobbMI), /nie pasuje do rodzaju dodatku/);
  await assert.rejects(content.installVersion(instance, 'datapack', SODIUM, PROJECTS.AANobbMI), /Nieznany rodzaj dodatku/);
  await assert.rejects(content.installVersion(instance, 'mod', { id: 'x', project_id: 'AANobbMI', files: [] }, PROJECTS.AANobbMI), /Brak pliku do pobrania/);
  files['sodium-0.6.0.jar'] = Buffer.from('tampered');
  await assert.rejects(content.installVersion(instance, 'mod', SODIUM, PROJECTS.AANobbMI), /suma kontrolna/);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'mods')), ['entityculling-1.6.jar']);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'resourcepacks')), []);
});
