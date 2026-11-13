'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { createPresence, frame, reader } = require('../src/main/discordrpc');
const { tmpDir } = require('./helpers');

/** A stand-in Discord on discord-ipc-0: answers the hello with READY (or refuses it) and keeps every command. */
async function fakeDiscord({ refuse = false } = {}) {
  const dir = tmpDir('ipc');
  const got = [];
  const server = net.createServer((c) => {
    c.on('data', reader((op, data) => {
      got.push({ op, data });
      if (op === 0) c.write(refuse ? frame(2, { code: 4000, message: 'Invalid Client ID' }) : frame(1, { cmd: 'DISPATCH', evt: 'READY', data: { v: 1 } }));
    }));
  });
  await new Promise((resolve) => server.listen(path.join(dir, 'discord-ipc-0'), resolve));
  const before = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = dir;
  return { got, close: () => { process.env.XDG_RUNTIME_DIR = before; server.close(); } };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('Discord status: says hello with the application ID, waits for READY, then shows the activity and clears it', { skip: process.platform === 'win32' }, async () => {
  const discord = await fakeDiscord();
  try {
    const presence = createPresence('1570806668910927972');
    assert.equal(await presence.set({ details: 'Minecraft 1.21.1 · Fabric' }), true);
    await wait(50);
    assert.deepEqual(discord.got[0], { op: 0, data: { v: 1, client_id: '1570806668910927972' } });
    assert.equal(discord.got[1].data.cmd, 'SET_ACTIVITY');
    assert.deepEqual(discord.got[1].data.args, { pid: process.pid, activity: { details: 'Minecraft 1.21.1 · Fabric' } });
    await presence.clear();
    await wait(50);
    assert.deepEqual(discord.got[2].data.args, { pid: process.pid }, 'no activity = Discord takes the status away');
    presence.close();
  } finally {
    discord.close();
  }
});

test('Discord status: an application Discord refuses, no ID or no Discord at all – nothing breaks', { skip: process.platform === 'win32' }, async () => {
  const discord = await fakeDiscord({ refuse: true });
  try {
    assert.equal(await createPresence('123').set({ details: 'x' }), false);
    assert.equal(await createPresence('').set({ details: 'x' }), false);
  } finally {
    discord.close();
  }
  const before = process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR = tmpDir('none');
  try {
    assert.equal(await createPresence('1570806668910927972').set({ details: 'x' }), false);
  } finally {
    process.env.XDG_RUNTIME_DIR = before;
  }
});
