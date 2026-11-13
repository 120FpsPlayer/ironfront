'use strict';

// The website's own database (data/web.json) and the small helpers every request goes through.
const realFetch = global.fetch;
require('./helpers/setup');
global.fetch = realFetch;
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/lib/db');
const store = require('../src/web/store');
const { createWebServer } = require('../src/web/server');

test('a write that fails (full disk, no permission) does not take the bot down: it is logged and tried again', async () => {
  store.load();
  const file = path.join(db.dataDir, 'web.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(tmp, { recursive: true }); // a folder where the temporary file goes – writing it fails
  const crashes = [];
  const onCrash = (err) => crashes.push(err);
  process.on('uncaughtException', onCrash);
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    store.upsertUser({ id: '700000000000000001', username: 'zapis', global_name: 'Zapis', avatar: null });
    await new Promise((r) => setTimeout(r, 400));
    assert.deepEqual(crashes, []);
    assert.ok(warned.some((w) => /Nie udało się zapisać bazy strony/.test(w)), warned.join('\n'));
    fs.rmSync(tmp, { recursive: true, force: true }); // the disk is fine again
    await new Promise((r) => setTimeout(r, 2500));
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).users['700000000000000001'], 'written once it could be');
  } finally {
    console.warn = warn;
    process.off('uncaughtException', onCrash);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('a broken cookie of another page on the domain breaks nothing; the client address comes from Cloudflare or the own proxy', async () => {
  const site = createWebServer({});
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref();
  const base = `http://127.0.0.1:${site.address().port}`;
  try {
    const res = await realFetch(`${base}/api/shop/session`, { headers: { cookie: 'inna=100%; hs_sid=x%zz' } });
    assert.equal(res.status, 200);
    // 120 launcher calls a minute per address: a made-up first X-Forwarded-For entry does not make a new address.
    let limited = 0;
    for (let i = 0; i < 130; i += 1) {
      const r = await realFetch(`${base}/api/launcher/health`, { headers: { 'x-forwarded-for': `1.2.3.${i}, 10.0.0.9` } });
      if (r.status === 429) limited += 1;
    }
    assert.ok(limited > 0, 'the proxy-added entry counts');
    // Behind Cloudflare its own header names the visitor.
    const cf = await realFetch(`${base}/api/launcher/health`, { headers: { 'x-forwarded-for': '10.0.0.9', 'cf-connecting-ip': '203.0.113.7' } });
    assert.equal(cf.status, 200, 'another visitor – another limit');
  } finally {
    site.close();
  }
});
