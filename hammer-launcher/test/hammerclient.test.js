'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { syncHammerClient, supports } = require('../src/main/hammerclient');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { tmpDir } = require('./helpers');

function setup() {
  const root = tmpDir();
  const instances = createInstances(createPaths(root));
  const jar = path.join(root, 'hammer-client.jar');
  fs.writeFileSync(jar, 'jar-v1');
  const installs = [];
  const content = { install: async (instance, what) => (installs.push(what.projectId), fs.writeFileSync(path.join(instance.dir, 'mods', 'fabric-api-0.116.0+1.21.1.jar'), 'api')) };
  return { instances, jar, content, installs };
}

test('Hammer Client runs on Fabric / Quilt 1.21.1 only', () => {
  assert.equal(supports({ loader: 'fabric', mcVersion: '1.21.1' }), true);
  assert.equal(supports({ loader: 'quilt', mcVersion: '1.21' }), true);
  assert.equal(supports({ loader: 'forge', mcVersion: '1.21.1' }), false);
  assert.equal(supports({ loader: 'fabric', mcVersion: '1.20.1' }), false);
});

test('new instances skip the narrator onboarding and have Hammer Client on', () => {
  const { instances } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  assert.equal(i.hammerClient, true);
  assert.match(fs.readFileSync(path.join(i.dir, 'options.txt'), 'utf8'), /onboardAccessibility:false/);
});

test('sync puts the mod and Fabric API in place and writes the launcher links', async () => {
  const { instances, jar, content, installs } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  const res = await syncHammerClient({ instance: i, jar, content, links: { discordUrl: 'https://discord.gg/x', shopUrl: 'http://not-https', brand: 'HammerShop' } });
  assert.deepEqual(res, { active: true });
  assert.equal(fs.readFileSync(path.join(i.dir, 'mods', 'hammer-client.jar'), 'utf8'), 'jar-v1');
  assert.deepEqual(installs, ['fabric-api']);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(i.dir, 'config', 'hammerclient-launcher.json'), 'utf8')), { discordUrl: 'https://discord.gg/x', shopUrl: '', brand: 'HammerShop' });

  // A newer launcher ships a newer mod → replaced; Fabric API is not installed twice.
  fs.writeFileSync(jar, 'jar-v2');
  await syncHammerClient({ instance: i, jar, content });
  assert.equal(fs.readFileSync(path.join(i.dir, 'mods', 'hammer-client.jar'), 'utf8'), 'jar-v2');
  assert.deepEqual(installs, ['fabric-api']);
});

test('sync removes the mod when switched off or unsupported, and respects a .disabled file', async () => {
  const { instances, jar, content } = setup();
  const i = instances.create({ name: 'A', mcVersion: '1.21.1', loader: 'fabric' });
  await syncHammerClient({ instance: i, jar, content });
  const off = instances.update(i.id, { hammerClient: false });
  assert.deepEqual(await syncHammerClient({ instance: off, jar, content }), { active: false, reason: 'off' });
  assert.equal(fs.existsSync(path.join(i.dir, 'mods', 'hammer-client.jar')), false);

  const old = instances.create({ name: 'B', mcVersion: '1.20.1', loader: 'fabric' });
  assert.equal((await syncHammerClient({ instance: old, jar, content })).reason, 'unsupported');

  const on = instances.update(i.id, { hammerClient: true });
  fs.writeFileSync(path.join(i.dir, 'mods', 'hammer-client.jar.disabled'), 'x');
  assert.equal((await syncHammerClient({ instance: on, jar, content })).reason, 'disabled');
  assert.equal((await syncHammerClient({ instance: on, jar: path.join(i.dir, 'nope.jar'), content })).reason, 'disabled');
  fs.rmSync(path.join(i.dir, 'mods', 'hammer-client.jar.disabled'));
  assert.equal((await syncHammerClient({ instance: on, jar: null, content })).reason, 'missing');
});
