'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { download } = require('@xmcl/file-transfer');
const { createDispatcher, describeError, validVersionJson } = require('../src/main/installer');
const versions = require('../src/main/versions');
const { tmpDir, mockFetch } = require('./helpers');

function serve(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

test('downloads through @xmcl work with our dispatcher, including redirects', async () => {
  const body = JSON.stringify({ id: '1.21.1', pad: 'x'.repeat(20000) });
  const { srv, base } = await serve((req, res) => {
    if (req.url === '/old.json') return res.writeHead(302, { location: '/new.json' }).end();
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }).end(body);
  });
  const dir = tmpDir();
  const dispatcher = createDispatcher(4);
  try {
    await download({ url: `${base}/old.json`, destination: path.join(dir, 'a.json'), dispatcher });
    assert.equal(fs.readFileSync(path.join(dir, 'a.json'), 'utf8'), body);
  } finally {
    await dispatcher.close().catch(() => null);
    srv.close();
  }
});

test('describeError turns an empty AggregateError into Polish reasons with hosts', () => {
  const dns = Object.assign(new Error('getaddrinfo ENOTFOUND piston-meta.mojang.com'), { code: 'ENOTFOUND' });
  const err = new AggregateError([Object.assign(new Error(''), { url: 'https://piston-meta.mojang.com/x.json', cause: dns }), Object.assign(new Error('bad'), { name: 'ChecksumNotMatchError', url: 'https://libraries.minecraft.net/a.jar' })]);
  assert.equal(err.message, '');
  const text = describeError(err);
  assert.match(text, /Brak internetu albo serwer jest nieosiągalny \(piston-meta\.mojang\.com\)/);
  assert.match(text, /Pobrany plik jest uszkodzony \(libraries\.minecraft\.net\)/);
  assert.equal(describeError(new AggregateError([])), 'Nieznany błąd pobierania');
  assert.match(describeError(Object.assign(new Error('x'), { code: 'ENOSPC' })), /Brak miejsca na dysku/);
});

test('validVersionJson removes an empty / cut-off version file so it is downloaded again', () => {
  const dir = tmpDir();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, '');
  assert.equal(validVersionJson(bad), false);
  assert.equal(fs.existsSync(bad), false);
  const good = path.join(dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ id: '1.20.1' }));
  assert.equal(validVersionJson(good), true);
  assert.equal(validVersionJson(path.join(dir, 'missing.json')), false);
});

test('Forge versions come from Maven metadata, marked with the recommended build', async () => {
  versions._cache.clear();
  const xml = '<metadata><versioning><versions><version>1.20.1-47.1.0</version><version>1.20.1-47.3.0</version><version>1.20.1-47.4.1</version><version>1.20.4-49.0.3</version><version>1.7.10-10.13.4.1614-1.7.10</version></versions></versioning></metadata>';
  const fetchFn = mockFetch([
    { match: /maven-metadata\.xml$/, body: xml },
    { match: /promotions_slim\.json$/, json: { promos: { '1.20.1-recommended': '47.3.0', '1.20.1-latest': '47.4.1' } } },
  ]);
  const list = await versions.forgeVersions('1.20.1', { fetchFn });
  assert.deepEqual(list.map((v) => v.version), ['47.4.1', '47.3.0', '47.1.0']);
  assert.equal(versions.pickLoaderVersion(list), '47.3.0');
  assert.deepEqual((await versions.forgeVersions('1.7.10', { fetchFn })).map((v) => v.version), ['10.13.4.1614-1.7.10']);
  versions._cache.clear();
});
