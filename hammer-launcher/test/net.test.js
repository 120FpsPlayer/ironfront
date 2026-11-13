'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { download } = require('../src/main/net');
const { tmpDir } = require('./helpers');

const bodyOf = (...chunks) => new ReadableStream({ start: (c) => (chunks.forEach((x) => c.enqueue(x)), c.close()) });
const answer = (body) => async () => ({ ok: true, status: 200, headers: new Headers(), body });

test('a download: written to a temporary file, checked, then renamed; a wrong checksum leaves nothing behind', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'mods', 'mod.jar');
  const data = Buffer.from('hammer');
  const sha1 = require('node:crypto').createHash('sha1').update(data).digest('hex');
  const got = await download('https://cdn.modrinth.com/x.jar', dest, { fetchFn: answer(bodyOf(new Uint8Array(data))), sha1 });
  assert.deepEqual([got.bytes, got.sha1, fs.readFileSync(dest, 'utf8')], [6, sha1, 'hammer']);
  await assert.rejects(download('https://cdn.modrinth.com/x.jar', path.join(dir, 'zly.jar'), { fetchFn: answer(bodyOf(new Uint8Array(data))), sha1: '0'.repeat(40) }), /zła suma kontrolna/);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['mods']);
});

test('a file that cannot be written is an error of the download – no crash of the launcher, no endless wait', async () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'mod.jar');
  fs.mkdirSync(`${dest}.part`); // a folder where the temporary file should go
  const crashes = [];
  const onCrash = (err) => crashes.push(err);
  process.on('uncaughtException', onCrash);
  try {
    const err = await download('https://cdn.modrinth.com/x.jar', dest, { fetchFn: answer(bodyOf(new Uint8Array(10))) }).then(
      () => null,
      (e) => e,
    );
    assert.ok(err, 'it fails');
    assert.match(err.message, /mod\.jar/);
    await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(crashes, []);
  } finally {
    process.off('uncaughtException', onCrash);
  }
});

test('a full disk: the download ends with a plain sentence instead of waiting forever', { skip: !fs.existsSync('/dev/full') && 'needs /dev/full' }, async () => {
  const dir = tmpDir();
  const dest = path.join(dir, 'big.jar');
  fs.symlinkSync('/dev/full', `${dest}.part`);
  const chunk = new Uint8Array(1024 * 1024);
  const many = new ReadableStream({
    pull(c) {
      c.enqueue(chunk);
    },
  });
  const result = await Promise.race([
    download('https://cdn.modrinth.com/x.jar', dest, { fetchFn: answer(many), maxBytes: 64 * 1024 * 1024 }).then(
      () => 'resolved',
      (e) => e,
    ),
    new Promise((r) => setTimeout(() => r('still waiting'), 5000)),
  ]);
  assert.ok(result instanceof Error, String(result));
  assert.match(result.message, /zabrakło miejsca/);
});
