'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Agent, EnvHttpProxyAgent } = require('undici');
const { proxyUrl, createAgent } = require('../src/main/proxy');

test('proxy: read from HTTPS_PROXY / HTTP_PROXY in either case, empty when none is set', () => {
  assert.strictEqual(proxyUrl({}), '');
  assert.strictEqual(proxyUrl({ HTTPS_PROXY: 'http://10.0.0.1:3128' }), 'http://10.0.0.1:3128');
  assert.strictEqual(proxyUrl({ https_proxy: 'http://a:1' }), 'http://a:1');
  assert.strictEqual(proxyUrl({ HTTP_PROXY: 'http://b:2' }), 'http://b:2');
  assert.strictEqual(proxyUrl({ HTTPS_PROXY: 'http://first:1', HTTP_PROXY: 'http://second:2' }), 'http://first:1');
});

test('proxy: downloads use a plain agent without a proxy and the proxy agent with one', async () => {
  const plain = createAgent({ connections: 2 }, {});
  const proxied = createAgent({ connections: 2 }, { HTTPS_PROXY: 'http://127.0.0.1:9' });
  assert.ok(plain instanceof Agent && !(plain instanceof EnvHttpProxyAgent));
  assert.ok(proxied instanceof EnvHttpProxyAgent);
  await Promise.all([plain.close(), proxied.close()]);
});
