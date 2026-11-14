'use strict';

// Hammer+ renews by itself: a renewal bought on the website or a „Zaproś znajomego” reward reaches the launcher
// without pasting the code – the shop is asked with the code the launcher holds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createServices } = require('../src/main/services');
const { tmpDir, plusKeys } = require('./helpers');

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
const BASE = 'https://hammerclient.com/api/launcher';
const NOW = 1_800_000_000_000; // ms
const DAY = 86_400;

function setup(answer, stored = () => null) {
  const keys = plusKeys();
  const root = tmpDir();
  const codes = stored(keys);
  if (codes) fs.writeFileSync(path.join(root, 'plus.json'), JSON.stringify({ codes }));
  const asked = [];
  let clock = NOW;
  const fetchFn = async (url, init = {}) => {
    if (String(url) === `${BASE}/plus`) {
      asked.push(init.headers?.authorization ?? null);
      const body = answer(keys, init.headers?.authorization?.replace(/^Bearer /, ''));
      return new Response(JSON.stringify(body ?? { error: 'nie' }), { status: body ? 200 : 401, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'nie ma' }), { status: 404, headers: { 'content-type': 'application/json' } });
  };
  const s = createServices({
    root,
    config: { brand: 'HammerShop', website: 'https://hammerclient.com', plusPublicKey: keys.publicKey, server: { address: '' } },
    accounts: { list: () => [GRACZ] },
    fetchFn,
    now: () => clock,
  });
  return { s, keys, asked, tick: (ms) => (clock += ms) };
}

test('a longer code of the same account is taken by itself; the window hears that Hammer+ was renewed', async () => {
  const exp = NOW / 1000 + 3 * DAY;
  const longer = NOW / 1000 + 40 * DAY;
  const { s, keys, asked } = setup((k) => ({ code: k.code({ id: 'bbbbbbbbbbbbbbbb', mc: GRACZ.id, exp: longer }), until: longer }));
  const held = keys.code({ mc: GRACZ.id, exp });
  s.plus.activate(held);
  assert.equal(s.plus.status().until, exp);
  const res = await s.plus.renew();
  assert.equal(res.renewed, true);
  assert.equal(res.status.until, longer);
  assert.equal(s.plus.status().until, longer, 'stored – it works offline from now on');
  assert.deepEqual(asked, [`Bearer ${held}`], 'asked with the code the launcher held');
});

test('nothing is taken that is not better: shorter, another account, a forged code; at most one question every ten minutes', async () => {
  const exp = NOW / 1000 + 30 * DAY;
  let offer = null;
  const { s, keys, asked, tick } = setup(() => offer);
  s.plus.activate(keys.code({ mc: GRACZ.id, exp }));
  offer = { code: keys.code({ mc: GRACZ.id, exp: exp - DAY }), until: exp };
  assert.equal((await s.plus.renew()).renewed, false, 'a shorter code never replaces a longer one');
  assert.equal((await s.plus.renew()).renewed, false);
  assert.equal(asked.length, 1, 'the second call within ten minutes does not ask the shop');
  tick(11 * 60_000);
  offer = { code: keys.code({ mc: 'ffffffffffffffffffffffffffffffff', exp: 0 }), until: 0 };
  assert.equal((await s.plus.renew()).renewed, false, 'a code for another account is not taken');
  tick(11 * 60_000);
  const forged = plusKeys().code({ mc: GRACZ.id, exp: 0 });
  offer = { code: forged, until: 0 };
  assert.equal((await s.plus.renew()).renewed, false, 'a code without the shop\'s signature is not taken');
  tick(11 * 60_000);
  offer = null; // the shop refuses or is offline
  assert.equal((await s.plus.renew()).renewed, false);
  assert.equal(s.plus.status().until, exp);
});

test('an expired code still asks – and Hammer+ comes back when the account was renewed; without a code nothing is asked', async () => {
  const none = setup(() => ({ code: null, until: null }));
  assert.equal((await none.s.plus.renew()).renewed, false);
  assert.equal(none.asked.length, 0, 'no code, no question');
  // A code that ran out yesterday – kept in plus.json from when it was running.
  const { s, asked } = setup(
    (k) => ({ code: k.code({ id: 'dddddddddddddddd', mc: GRACZ.id, exp: 0 }), until: 0 }),
    (k) => [k.code({ mc: GRACZ.id, exp: NOW / 1000 - DAY })],
  );
  assert.equal(s.plus.status().active, false);
  const res = await s.plus.renew();
  assert.deepEqual([res.renewed, res.status.active, res.status.until], [true, true, 0]);
  assert.equal(asked.length, 1);
});
