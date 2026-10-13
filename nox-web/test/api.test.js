'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { startFakes, fakeEnv } = require('./fakes');

let fakes;
let site;
let base;

test.before(async () => {
  fakes = await startFakes();
  fakeEnv(fakes.base);
  const store = require('../lib/store');
  store.load();
  const { createServer } = require('../server');
  site = createServer();
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${site.address().port}`;
});
test.after(() => {
  site.close();
  fakes.server.close();
});

const get = (p, cookie = '') => fetch(base + p, { headers: { cookie }, redirect: 'manual' });
const post = (p, body, cookie = '', headers = {}) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body), redirect: 'manual' });
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`)) ?? '';

/** Discord sign-in through the fakes → the session cookie. */
async function signIn() {
  const start = await get('/api/nox/auth/start');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await get(`/api/nox/auth/callback?code=good&state=${state}`, cookieOf(start, 'nox_oauth'));
  assert.equal(back.headers.get('location'), '/?connected=1');
  return cookieOf(back, 'nox_sid');
}

test('store: live mode, server prices in cents, the invite and the access price', async () => {
  const res = await get('/api/nox/store');
  const s = await res.json();
  assert.equal(s.preview, false);
  assert.equal(s.authReady, true);
  assert.equal(s.paymentsReady, true);
  assert.equal(s.accessPrice, 990);
  assert.equal(s.discordUrl, 'https://discord.gg/nox');
  assert.deepEqual(s.products.map((p) => [p.id, p.price]), [['games', 990], ['discord-bot', 2990], ['game-bundle', 1500], ['discord-server', 2490]]);
  assert.ok(s.products.every((p) => !('delivery' in p)), 'delivery texts stay private until paid');
});

test('Discord sign-in: a wrong state or a refused code fails; the right one signs in', async () => {
  const start = await get('/api/nox/auth/start');
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.searchParams.get('scope'), 'identify');
  assert.equal(loc.searchParams.get('redirect_uri'), 'http://127.0.0.1:1/api/nox/auth/callback');
  const forged = await get('/api/nox/auth/callback?code=good&state=nope', cookieOf(start, 'nox_oauth'));
  assert.equal(forged.headers.get('location'), '/?auth=failed');
  const refused = await get(`/api/nox/auth/callback?code=bad&state=${loc.searchParams.get('state')}`, cookieOf(start, 'nox_oauth'));
  assert.equal(refused.headers.get('location'), '/?auth=failed');
  const cancelled = await get('/api/nox/auth/callback?error=access_denied');
  assert.equal(cancelled.headers.get('location'), '/?auth=cancelled');

  const sid = await signIn();
  const session = await (await get('/api/nox/session', sid)).json();
  assert.deepEqual(session, { user: { id: '111222333444555666', name: 'Tester', username: 'tester', avatar: null }, access: false });
});

test('access: products need it; one Stripe page per click; paid on verify → access on, the team is told once', async () => {
  const sid = await signIn();
  const early = await post('/api/nox/checkout', { kind: 'products', items: [{ id: 'games', quantity: 1 }] }, sid);
  assert.equal(early.status, 403);

  const first = await (await post('/api/nox/checkout', { kind: 'access', requestId: 'req-1' }, sid)).json();
  assert.match(first.url, /^https:\/\/checkout\.stripe\.com\//);
  const again = await (await post('/api/nox/checkout', { kind: 'access', requestId: 'req-1' }, sid)).json();
  assert.equal(again.url, first.url, 'a double click opens the same payment page');
  assert.equal(fakes.state.lastCheckout.get('line_items[0][price_data][unit_amount]'), '990');
  assert.equal(fakes.state.lastCheckout.get('client_reference_id'), '111222333444555666');

  const id = first.url.split('/').pop();
  const unpaid = await (await post('/api/nox/verify', { sessionId: id }, sid)).json();
  assert.equal(unpaid.paid, false);
  fakes.pay(id);
  const paid = await (await post('/api/nox/verify', { sessionId: id }, sid)).json();
  assert.equal(paid.paid, true);
  await post('/api/nox/verify', { sessionId: id }, sid);
  assert.equal((await (await get('/api/nox/session', sid)).json()).access, true);
  assert.equal(fakes.state.notices?.filter((n) => n.embeds[0].title.includes('Access')).length, 1, 'one notice in the team channel');

  const twice = await post('/api/nox/checkout', { kind: 'access', requestId: 'req-2' }, sid);
  assert.equal(twice.status, 409);
  const orders = (await (await get('/api/nox/orders', sid)).json()).orders;
  assert.equal(orders[0].kind, 'access');
  assert.equal(orders[0].status, 'paid');
});

test('products: prices from the server, quantities capped, unknown items refused; paid → delivery text in My orders', async () => {
  const sid = await signIn(); // same Discord account – access is active from the test above
  const bad = await post('/api/nox/checkout', { kind: 'products', items: [{ id: 'nope', quantity: 1 }] }, sid);
  assert.equal(bad.status, 400);
  const empty = await post('/api/nox/checkout', { kind: 'products', items: [] }, sid);
  assert.equal(empty.status, 400);

  const res = await (await post('/api/nox/checkout', { kind: 'products', requestId: 'cart-1', items: [{ id: 'games', quantity: 50, price: 1 }, { id: 'game-bundle', quantity: 1 }] }, sid)).json();
  const p = fakes.state.lastCheckout;
  assert.equal(p.get('line_items[0][quantity]'), '10', 'at most 10 of one product');
  assert.equal(p.get('line_items[0][price_data][unit_amount]'), '990', 'the price the browser sent is ignored');
  const id = res.url.split('/').pop();
  let orders = (await (await get('/api/nox/orders', sid)).json()).orders;
  assert.equal(orders.find((o) => o.stripe_id === id).status, 'pending');
  assert.equal(orders.find((o) => o.stripe_id === id).delivery, null);
  fakes.pay(id);
  await post('/api/nox/verify', { sessionId: id }, sid);
  orders = (await (await get('/api/nox/orders', sid)).json()).orders;
  const order = orders.find((o) => o.stripe_id === id);
  assert.equal(order.status, 'paid');
  assert.equal(order.amount, 10 * 990 + 1500);
  assert.match(order.delivery, /Open a ticket/);
});

test('Stripe webhook: signature checked; checkout.session.completed marks the order paid', async () => {
  const sid = await signIn();
  const res = await (await post('/api/nox/checkout', { kind: 'products', requestId: 'cart-wh', items: [{ id: 'discord-bot', quantity: 1 }] }, sid)).json();
  const id = res.url.split('/').pop();
  const session = fakes.pay(id);
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: session } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
  const forged = await fetch(`${base}/api/nox/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` }, body: raw });
  assert.equal(forged.status, 400);
  const ok = await fetch(`${base}/api/nox/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
  assert.equal(ok.status, 200);
  const orders = (await (await get('/api/nox/orders', sid)).json()).orders;
  assert.equal(orders.find((o) => o.stripe_id === id).status, 'paid');
});

test('a different amount at Stripe is never marked paid; someone else\'s payment is not found', async () => {
  const sid = await signIn();
  const res = await (await post('/api/nox/checkout', { kind: 'products', requestId: 'cart-mm', items: [{ id: 'discord-server', quantity: 1 }] }, sid)).json();
  const id = res.url.split('/').pop();
  Object.assign(fakes.pay(id), { amount_total: 1 });
  const v = await (await post('/api/nox/verify', { sessionId: id }, sid)).json();
  assert.equal(v.paid, false);
  const other = await post('/api/nox/verify', { sessionId: 'cs_test_999' }, sid);
  assert.equal(other.status, 404);
});

test('safety: other sites can\'t POST, no session → 401, logout ends the session, static files can\'t escape public/', async () => {
  const sid = await signIn();
  const foreign = await post('/api/nox/checkout', { kind: 'access' }, sid, { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403);
  assert.equal((await post('/api/nox/checkout', { kind: 'access' })).status, 401);
  assert.equal((await get('/api/nox/orders')).status, 401);
  assert.equal((await post('/api/nox/logout', {}, sid)).status, 200);
  assert.equal((await (await get('/api/nox/session', sid)).json()).user, null);

  const page = await get('/');
  assert.match(await page.text(), /<title>NØX/);
  const sneaky = await get('/..%2Fserver.js');
  assert.doesNotMatch(await sneaky.text(), /createServer/);
  assert.equal((await get('/assets/nope.png')).status, 404);
});
