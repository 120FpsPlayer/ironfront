'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shareLog, redact, tail, API } = require('../src/main/logshare');
const { mockFetch } = require('./helpers');

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJ4dWlkIjoiMjUzNTQxNjE5NzUxMjM0NSIsInN1YiI6IjEyMyJ9.c2lnbmF0dXJlLXNpZ25hdHVyZQ';

test('log sharing: the log is posted to mclo.gs as a form and the link comes back', async () => {
  const fetchFn = mockFetch([{ match: (url, init) => url === API && init.method === 'POST', json: { success: true, id: 'HaMm3rX', url: 'https://mclo.gs/HaMm3rX', raw: 'https://api.mclo.gs/1/raw/HaMm3rX' } }]);
  const log = '[12:41:02] [main/INFO]: Loading Minecraft 1.21.1 with Fabric Loader 0.16.9\n[12:41:05] [Render thread/ERROR]: Zażółć & gęślą = jaźń\n';
  assert.deepEqual(await shareLog(log, { fetchFn }), { url: 'https://mclo.gs/HaMm3rX', id: 'HaMm3rX' });
  assert.equal(fetchFn.calls.length, 1);
  const { init } = fetchFn.calls[0];
  assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual([...new URLSearchParams(init.body).entries()], [['content', log]], 'one form field: content');
});

test('log sharing: login tokens never leave the computer', async () => {
  const log = [
    `Launching with: java -Xmx4G net.minecraft.client.main.Main --username Gracz --accessToken ${JWT} --userType msa`,
    '--accessToken   opaque-token-123 --uuid 0123',
    '--accessToken=another-one',
    '[main/INFO]: Setting user: Gracz',
    '[main/INFO]: (Session ID is token:secret-session-token:0123456789abcdef0123456789abcdef)',
    `{"accessToken":"${JWT}"}`,
    'token:abc123:0123-4567 trailing',
    'eyJ is just a prefix here, and key.value.pairs stay',
  ].join('\n');
  const clean = redact(log);
  for (const secret of [JWT, 'opaque-token-123', 'another-one', 'secret-session-token', 'abc123', JWT.split('.')[1]]) assert.ok(!clean.includes(secret), secret);
  assert.match(clean, /--username Gracz --accessToken <ukryty token> --userType msa/);
  assert.match(clean, /--accessToken {3}<ukryty token> --uuid 0123/);
  assert.match(clean, /\(Session ID is <ukryty token>\)/);
  assert.match(clean, /Setting user: Gracz/);
  assert.match(clean, /eyJ is just a prefix here, and key\.value\.pairs stay/);

  const fetchFn = mockFetch([{ match: /mclo\.gs/, json: { success: true, id: 'a', url: 'https://mclo.gs/a' } }]);
  await shareLog(log, { fetchFn });
  const sent = new URLSearchParams(fetchFn.calls[0].init.body).get('content');
  assert.equal(sent, clean);
});

test('log sharing: a log over the limit is cut to its newest part at a line break', async () => {
  const lines = Array.from({ length: 2000 }, (_, i) => `[12:00:00] [main/INFO]: linia ${i} zażółć`);
  const log = lines.join('\n');
  const cut = tail(log, 5000);
  assert.ok(Buffer.byteLength(cut) <= 5000);
  assert.match(cut, /^\[Hammer Launcher\] Log był za długi – to jego ostatnia część\.\n\[12:00:00\] \[main\/INFO\]: linia \d+ zażółć\n/);
  assert.ok(cut.endsWith(lines.at(-1)), 'the end of the log – where the crash is – is kept');
  assert.equal(tail(log, 10 * 1024 * 1024), log, 'short logs are untouched');
  assert.ok(!tail('ż'.repeat(4000), 1001).includes('�'), 'never cut in the middle of a character');

  const fetchFn = mockFetch([{ match: /mclo\.gs/, json: { success: true, id: 'a', url: 'https://mclo.gs/a' } }]);
  await shareLog(log, { fetchFn, maxBytes: 5000 });
  assert.equal(new URLSearchParams(fetchFn.calls[0].init.body).get('content'), cut);
});

test('log sharing: failures become Polish sentences; only real mclo.gs links are accepted', async () => {
  const share = (routes, log = 'log') => shareLog(log, { fetchFn: typeof routes === 'function' ? routes : mockFetch(routes) });
  const never = mockFetch([]);
  await assert.rejects(shareLog('   \n ', { fetchFn: never }), /Nie ma jeszcze żadnych logów/);
  await assert.rejects(shareLog(null, { fetchFn: never }), /Nie ma jeszcze żadnych logów/);
  assert.equal(never.calls.length, 0, 'an empty log is not sent');
  await assert.rejects(share(async () => Promise.reject(new TypeError('fetch failed'))), /Nie udało się połączyć z mclo\.gs/);
  await assert.rejects(share([{ match: /mclo/, json: { success: false, error: 'Required POST argument content is empty.' } }]), /mclo\.gs nie przyjął logów: Required POST argument/);
  await assert.rejects(share([{ match: /mclo/, status: 503, body: 'Service Unavailable' }]), /nie przyjął logów \(błąd 503\)/);
  await assert.rejects(share([{ match: /mclo/, status: 429, json: { success: false } }]), /błąd 429/);
  for (const url of ['http://mclo.gs/a', 'https://evil.example/a', 'https://mclo.gs.evil.example/a', 'javascript:alert(1)', '', null, 42]) {
    await assert.rejects(share([{ match: /mclo/, json: { success: true, id: 'a', url } }]), /nieprawidłową odpowiedź/, String(url));
  }
  assert.deepEqual(await share([{ match: /mclo/, json: { success: true, url: 'https://mclo.gs/Ab12', id: 7 } }]), { url: 'https://mclo.gs/Ab12', id: null });
});
