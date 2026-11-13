'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createServices } = require('../src/main/services');
const { tmpDir } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };

function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', 0, null);
  return child;
}

/** A game start with a stand-in Discord: returns what the launcher told Discord. */
async function startWith(config) {
  const shown = [];
  const s = createServices({
    root: tmpDir(),
    config: { server: { address: '' }, ...config },
    accounts: { list: () => [GRACZ], launchAuth: async () => ({ ...GRACZ, accessToken: 'token' }) },
    fetchFn: async () => Promise.reject(new Error('offline')),
    presence: { set: (activity) => shown.push(activity), clear: () => null },
    prepareFn: async () => ({ versionId: 'fabric-loader-0.16.10-1.21.1', javaPath: '/java/bin/java', javaMajor: 21 }),
    launchFn: async () => fakeChild(),
  });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  await s.launch(instance.id);
  return shown;
}

test('Discord status: while playing it shows the version and the launcher icon from the website', async () => {
  const [activity] = await startWith({ name: 'Hammer Launcher', website: 'https://hammerclient.com/' });
  assert.equal(activity.details, 'Minecraft 1.21.1 · Fabric');
  assert.equal(activity.state, 'Gra przez Hammer Launcher');
  assert.ok(activity.timestamps.start > 0);
  assert.deepEqual(activity.assets, { large_image: 'https://hammerclient.com/assets/launcher-icon.png', large_text: 'Hammer Launcher' });
});

test('Discord status: without a website the picture uploaded to the Discord application ("logo") is used', async () => {
  const [activity] = await startWith({ name: 'Hammer Launcher', website: '' });
  assert.equal(activity.assets.large_image, 'logo');
});
