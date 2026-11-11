'use strict';

// src/lib/plus.js needs no Discord and no database – only the key from the environment, made here for the test.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { env } = require('../src/env');
const plus = require('../src/lib/plus');

const MC = '069a79f444e94726a5befca90e38aaf5';
const DAY = 86_400;
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);

function newKey(type = 'ed25519') {
  const { privateKey, publicKey } = crypto.generateKeyPairSync(type);
  return { b64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), pem: privateKey.export({ format: 'pem', type: 'pkcs8' }), privateKey, publicKey };
}
const key = newKey();
/** Every test starts from the same state – called first in each one (no hooks, so it reads top to bottom). */
function reset() {
  env.plusPrivateKey = key.b64;
}

const b64url = (text) => Buffer.from(text, 'utf8').toString('base64url');
/** A code with any payload text, signed with the given key – what only the bot could make. */
const signed = (payloadText, k = key) => {
  const head = `HP1.${b64url(payloadText)}`;
  return `${head}.${crypto.sign(null, Buffer.from(head, 'ascii'), k.privateKey).toString('base64url')}`;
};
const reasonOf = (fn) => {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof plus.PlusError, `a PlusError, got ${err}`);
    assert.match(err.message, /kod|klucz|konto|dni/i, 'the message is in Polish');
    return err.reason;
  }
  return null;
};

test('a code has the format the launcher is built against: HP1.<payload>.<signature>, Ed25519 over "HP1.<payload>"', () => {
  reset();
  const code = plus.issue({ mc: MC, days: 30, now: NOW });
  assert.match(code, /^HP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'base64url without padding');
  const [, payload, signature] = code.split('.');

  const json = Buffer.from(payload, 'base64url').toString('utf8');
  const data = JSON.parse(json);
  assert.match(data.id, /^[0-9a-f]{16}$/);
  assert.equal(json, `{"id":"${data.id}","mc":"${MC}","exp":${data.exp},"iat":${data.iat}}`, 'exactly these four fields, in this order');
  assert.equal(data.iat, Math.floor(NOW / 1000));
  assert.equal(data.exp, data.iat + 30 * DAY);
  assert.equal(b64url(json), payload, 'canonical base64url');

  // The launcher's side: the raw 32-byte public key from /hammerplus klucz, checked offline.
  const raw = Buffer.from(plus.publicKey(), 'base64');
  assert.equal(raw.length, 32);
  assert.deepEqual(raw, key.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32), 'the last 32 bytes of the SPKI DER');
  const launcherKey = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
  const sig = Buffer.from(signature, 'base64url');
  assert.equal(sig.length, 64);
  assert.equal(crypto.verify(null, Buffer.from(`HP1.${payload}`, 'ascii'), launcherKey, sig), true);

  assert.notEqual(plus.issue({ mc: MC, days: 30, now: NOW }), code, 'every code has its own ID');
});

test('verify gives the payload back; a code works until its last second, and "0 days" never expires', () => {
  reset();
  const code = plus.issue({ mc: MC, days: 7, now: NOW });
  const payload = plus.verify(code, { now: NOW });
  assert.deepEqual(Object.keys(payload), ['id', 'mc', 'exp', 'iat']);
  assert.equal(payload.mc, MC);
  assert.equal(payload.exp, Math.floor(NOW / 1000) + 7 * DAY);
  assert.deepEqual(plus.verify(`  ${code}\n`, { now: NOW }), payload, 'spaces around a pasted code do not matter');

  assert.deepEqual(plus.verify(code, { now: payload.exp * 1000 - 1 }), payload, 'still valid in its last second');
  let expired = null;
  try {
    plus.verify(code, { now: payload.exp * 1000 });
  } catch (err) {
    expired = err;
  }
  assert.ok(expired instanceof plus.PlusError);
  assert.equal(expired.reason, 'expired');
  assert.match(expired.message, /wygasł/);
  assert.deepEqual(expired.payload, payload, 'an expired code still says whose it was');

  const forever = plus.issue({ mc: MC, days: 0, now: NOW });
  assert.equal(plus.verify(forever, { now: NOW }).exp, 0);
  assert.equal(plus.verify(forever, { now: NOW + 100 * 365 * DAY * 1000 }).exp, 0, 'still valid in a hundred years');
  assert.equal(plus.verify(plus.issue({ mc: MC })).exp, 0, 'no days given = never expires, checked against the clock');
});

test('the Minecraft account is stored as 32 lowercase hex characters, however it was written', () => {
  reset();
  const dashed = plus.issue({ mc: '069A79F4-44E9-4726-A5BE-FCA90E38AAF5', days: 1, now: NOW });
  assert.equal(plus.verify(dashed, { now: NOW }).mc, MC);
  assert.equal(plus.normalizeUuid(` ${MC.toUpperCase()} `), MC);
  for (const bad of ['', 'Notch', MC.slice(1), `${MC}0`, MC.replace('0', 'g'), '069a79f4-44e94726a5be-fca90e38aaf5-', null, undefined, 42]) {
    assert.equal(plus.normalizeUuid(bad), null, `not a UUID: ${bad}`);
  }
  assert.equal(reasonOf(() => plus.issue({ mc: 'Notch', days: 1 })), 'input');
  for (const days of [-1, 1.5, '30', NaN, plus.MAX_DAYS + 1]) assert.equal(reasonOf(() => plus.issue({ mc: MC, days })), 'input', `days: ${days}`);
});

test('changed, foreign and malformed codes are refused – each with its own Polish reason', () => {
  reset();
  const code = plus.issue({ mc: MC, days: 30, now: NOW });
  const [, payload, signature] = code.split('.');
  const at = { now: NOW };

  // Someone edits the payload (another account, a later expiry) and keeps the signature.
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const forged = `HP1.${b64url(JSON.stringify({ ...data, mc: 'f'.repeat(32) }))}.${signature}`;
  assert.equal(reasonOf(() => plus.verify(forged, at)), 'signature');
  const longer = `HP1.${b64url(JSON.stringify({ ...data, exp: 0 }))}.${signature}`;
  assert.equal(reasonOf(() => plus.verify(longer, at)), 'signature');
  // A well-formed code signed with somebody else's key.
  assert.equal(reasonOf(() => plus.verify(signed(JSON.stringify(data), newKey()), at)), 'signature');
  assert.equal(reasonOf(() => plus.verify(`HP1.${payload}.${'A'.repeat(86)}`, at)), 'signature');
  assert.equal(reasonOf(() => plus.verify(`HP1.${payload}.AAAA`, at)), 'signature', 'a signature of the wrong length');

  for (const junk of ['', '   ', 'HP1', 'hello', `HP2.${payload}.${signature}`, `hp1.${payload}.${signature}`, `HP1.${payload}`, `${code}.extra`, `HP1.${payload}=.${signature}`, `HP1.pay load.${signature}`, null, undefined, 123, {}, `HP1.${'A'.repeat(2000)}.${signature}`]) {
    assert.equal(reasonOf(() => plus.verify(junk, at)), 'malformed', `not a code: ${String(junk).slice(0, 40)}`);
  }

  // Our own signature on something that isn't a Hammer+ payload is still not a code.
  for (const text of ['not json', '[]', 'null', '{"id":"x"}', JSON.stringify({ ...data, mc: MC.toUpperCase() }), JSON.stringify({ ...data, id: 1234567890123456 }), JSON.stringify({ ...data, exp: -1 }), JSON.stringify({ ...data, exp: '0' }), JSON.stringify({ ...data, iat: 1.5 })]) {
    assert.equal(reasonOf(() => plus.verify(signed(text), at)), 'malformed', text);
  }
  assert.equal(plus.verify(signed(JSON.stringify({ ...data, note: 'extra fields are ignored' })), at).note, undefined);
});

test('the key: missing, broken or of the wrong kind → not ready, nothing is issued or accepted', () => {
  reset();
  const code = plus.issue({ mc: MC, days: 1, now: NOW });
  assert.equal(plus.ready(), true);
  assert.equal(plus.status(), 'ready');

  env.plusPrivateKey = '';
  assert.equal(plus.ready(), false);
  assert.equal(plus.status(), 'missing');
  assert.equal(plus.publicKey(), null);
  assert.equal(reasonOf(() => plus.issue({ mc: MC, days: 1 })), 'nokey');
  assert.equal(reasonOf(() => plus.verify(code, { now: NOW })), 'nokey');

  for (const broken of ['not-a-key', 'AAAA', key.b64.slice(0, 20), newKey('x25519').b64, key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64')]) {
    env.plusPrivateKey = broken;
    assert.equal(plus.ready(), false, broken);
    assert.equal(plus.status(), 'invalid');
    assert.equal(plus.publicKey(), null);
    assert.equal(reasonOf(() => plus.issue({ mc: MC, days: 1 })), 'nokey');
  }

  // A PEM pasted on one line is the same key.
  env.plusPrivateKey = key.pem.replace(/\n/g, '');
  assert.equal(plus.ready(), true);
  assert.equal(plus.verify(code, { now: NOW }).mc, MC);

  // Another key: its own public key, and the old codes stop working.
  const other = newKey();
  env.plusPrivateKey = other.b64;
  assert.equal(plus.publicKey(), other.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'));
  assert.equal(reasonOf(() => plus.verify(code, { now: NOW })), 'signature');
});
