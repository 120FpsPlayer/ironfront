'use strict';

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const promos = require('../src/features/promos');

let gid = 0;
const guild = () => `promo-guild-${++gid}`;

test('promo codes: create, check, apply and redeem', () => {
  const g = guild();
  const p = promos.create(g, { code: 'nox10', percent: 10, maxUses: 2 });
  assert.equal(p.code, 'NOX10');
  assert.throws(() => promos.create(g, { code: 'NOX10', percent: 5 }), /Kod \*\*NOX10\*\* już istnieje/);
  assert.throws(() => promos.create(g, { code: 'X', percent: 5 }), /3–24 znaki/);
  assert.throws(() => promos.create(g, { code: 'BOTH', percent: 5, amount: 2 }), /albo kwotę rabatu – nie oba naraz/);
  assert.throws(() => promos.create(g, { code: 'ZERO', percent: 0 }), /od 1 do 100/);
  assert.deepEqual(promos.apply(p, 20), { total: 18, discount: 2 });
  assert.deepEqual(promos.apply(p, null), { total: null, discount: 0 });
  assert.equal(promos.check(g, ' nox10 ', 'u1').error, null);
  promos.redeem(g, 'NOX10', 'u1');
  assert.match(promos.check(g, 'NOX10', 'u1').error, /został już przez Ciebie wykorzystany/);
  promos.redeem(g, 'NOX10', 'u2');
  assert.match(promos.check(g, 'NOX10', 'u3').error, /^Ten kod został już wykorzystany\./);
  assert.match(promos.check(g, 'NOPE', 'u1').error, /Taki kod nie istnieje/);
  const off = promos.create(g, { code: 'FIVE', amount: 5 });
  assert.deepEqual(promos.apply(off, 3), { total: 0, discount: 3 }, 'never below 0');
  assert.equal(promos.label(off), '5€ rabatu');
  assert.equal(promos.label(p), '10% rabatu');
});

test('personal codes: only for their owner, single use, expiring, optionally first order only', () => {
  const g = guild();
  const p = promos.personal(g, 'u1', { percent: 5, days: 7, prefix: 'witaj', firstOrderOnly: true });
  assert.match(p.code, /^WITAJ-[0-9A-F]{6}$/);
  assert.match(promos.check(g, p.code, 'u2').error, /należy do kogoś innego/);
  assert.match(promos.check(g, p.code, 'u1', { completedOrders: 1 }).error, /tylko przy pierwszym zamówieniu/);
  assert.equal(promos.check(g, p.code, 'u1', { completedOrders: 0 }).error, null);
  assert.match(promos.check(g, p.code, 'u1', { now: Date.now() + 8 * promos.DAY }).error, /Ten kod wygasł/);
  assert.equal(promos.remove(g, p.code), true);
  assert.equal(promos.find(g, p.code), null);
});
