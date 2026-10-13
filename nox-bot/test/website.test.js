'use strict';

// The website talks to (fake) Discord and Stripe over HTTP – keep the real fetch the test setup replaces.
const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { startFakes, useFakes } = require('./helpers/webFakes');
const { buildServer } = require('../src/builder/executor');
const { env } = require('../src/env');
const shop = require('../src/features/shop');
const delivery = require('../src/features/delivery');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const webAuth = require('../src/web/discord');
const hooks = require('../src/lib/hooks');
const { createWebServer } = require('../src/web/server');

let fakes;
let site;
let base;
let guild;
let buyer;
let keys;
let combo;
let netflix;

test.before(async () => {
  fakes = await startFakes();
  guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  buyer = guild.addMember(fakes.state.user.id, [db.roleId(guild.id, 'member')]);
  // The bot's shop – this is what the website sells.
  keys = shop.addProduct(guild, { name: 'Game Keys', price: '9.90', description: 'Instant keys.', category: '🎮 Games' });
  await delivery.setDelivery(guild, keys.id, { text: 'KEY-ABC-123' });
  combo = shop.addProduct(guild, { name: '5 Game Combo', price: '15', description: 'Five games.', category: 'Games' });
  netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.', category: 'Accounts' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12');
  shop.addProduct(guild, { name: 'Custom Bot', price: 'from 20€', description: 'Ask us.', category: 'Discord Bots' }); // no fixed price → not sold online
  shop.addProduct(guild, { name: 'Sold out thing', price: '3', description: 'x', stock: 'out' });

  website._setClient(guild.client);
  webAuth.setClientId('123');
  webStore.load();
  site = createWebServer({ catalog: website.catalog, info: () => ({ invite: 'https://discord.gg/nox' }), onPaid: website.onPaid, currency: () => 'eur' });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;
  useFakes(env, fakes.base, base);
});
test.after(() => {
  site?.close();
  fakes?.server.close();
});

const get = (p, cookie = '') => fetch(base + p, { headers: { cookie }, redirect: 'manual' });
const post = (p, body, cookie = '', headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: JSON.stringify(body), redirect: 'manual' });
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? '']).flatMap((c) => c.split(/,(?=\s*\w+=)/)).map((c) => c.split(';')[0].trim()).find((c) => c.startsWith(`${name}=`)) ?? '';

async function signIn(user = fakes.state.user) {
  fakes.state.user = user;
  const start = await get('/api/nox/auth/start');
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const back = await get(`/api/nox/auth/callback?code=good&state=${state}`, cookieOf(start, 'nox_oauth'));
  assert.equal(back.headers.get('location'), '/?connected=1');
  return cookieOf(back, 'nox_sid');
}
async function buy(sid, body) {
  const res = await (await post('/api/nox/checkout', body, sid)).json();
  assert.match(res.url ?? '', /^https:\/\/checkout\.stripe\.com\//, JSON.stringify(res));
  const id = res.url.split('/').pop();
  fakes.pay(id);
  const v = await (await post('/api/nox/verify', { sessionId: id }, sid)).json();
  assert.equal(v.paid, true);
  return id;
}

test('the website sells the bot\'s shop: fixed prices only, every option, sale prices, sold-out hidden, tabs matched', async () => {
  const s = await (await get('/api/nox/store')).json();
  assert.equal(s.preview, false);
  const byName = Object.fromEntries(s.products.map((p) => [p.name, p]));
  assert.equal(byName['Game Keys'].price, 990);
  assert.equal(byName['Game Keys'].category, 'Games', '"🎮 Games" → the Games tab');
  assert.equal(byName['5 Game Combo'].art, 'bundle');
  assert.equal(byName['Netflix – 1 month'].price, 500);
  assert.equal(byName['Netflix – 3 months'].price, 1200);
  assert.equal(byName['Custom Bot'], undefined, 'no fixed price → not sold online');
  assert.equal(byName['Sold out thing'], undefined);
  assert.ok(s.products.every((p) => !('imagePath' in p) && !('delivery' in p)));

  // A product picture shows on its card and is served by the website.
  const images = require('../src/lib/productImages');
  shop.findProduct(guild.id, keys.id).image = images.save(keys.id, { buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), ext: 'png' });
  const withImage = (await (await get('/api/nox/store')).json()).products.find((p) => p.name === 'Game Keys');
  assert.equal(withImage.image, `/api/nox/image/${keys.id}`);
  const img = await get(withImage.image);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  require('../src/features/flashsales').startSale(guild, combo.id, { percent: 20, durationMs: 3_600_000 });
  const sale = (await (await get('/api/nox/store')).json()).products.find((p) => p.name === '5 Game Combo');
  assert.equal(sale.price, 1200, 'the flash sale price');
});

test('paid on the website → the order ticket opens on Discord, paid, and the product is delivered by DM and in the ticket', async () => {
  const sid = await signIn();
  await buy(sid, { kind: 'access', requestId: 'acc-1' });
  assert.equal((await (await get('/api/nox/session', sid)).json()).access, true);

  await buy(sid, { kind: 'products', requestId: 'p-1', items: [{ id: keys.id, quantity: 1 }] });
  const ticket = db.tickets((t) => t.guildId === guild.id && t.ownerId === buyer.id).at(-1);
  assert.ok(ticket, 'an order ticket was opened');
  assert.equal(ticket.order.paidWith, 'website');
  assert.equal(ticket.order.total, 9.9);
  const channel = guild.channels.cache.get(ticket.channelId);
  const texts = channel.messageList.map((m) => textOf(m.body ?? m)).join('\n');
  assert.match(texts, /Paid on the website – 9\.90€/);
  assert.doesNotMatch(texts, /## .*Pay 9\.90€/, 'no "Pay" card – it is paid already');
  assert.ok(guild.dms.some((d) => d.to === buyer.id && /KEY-ABC-123/.test(textOf(d.payload))), 'delivered by DM');
  assert.ok(db.getTicket(ticket.channelId).completedAt, 'completed like any paid Discord order');

  const orders = (await (await get('/api/nox/orders', sid)).json()).orders;
  assert.match(orders.find((o) => o.kind === 'products').delivery, /ticket #\d{4} on the NØX Discord/);
});

test('a cart with options: one ticket for everything, staff pinged for what isn\'t automatic', async () => {
  const sid = await signIn();
  const before = db.tickets((t) => t.ownerId === buyer.id).length;
  await buy(sid, { kind: 'products', requestId: 'p-2', items: [{ id: `${netflix.id}~${shop.variantsOf(shop.findProduct(guild.id, netflix.id))[1].id}`, quantity: 2 }, { id: combo.id, quantity: 1 }] });
  const tickets = db.tickets((t) => t.ownerId === buyer.id);
  assert.equal(tickets.length, before + 1);
  const t = tickets.at(-1);
  assert.equal(t.order.items.length, 2);
  assert.equal(t.order.items[0].product, 'Netflix — 3 months');
  assert.equal(t.order.items[0].quantity, 2);
  assert.equal(t.order.total, 24 + 12);
  assert.equal(t.order.status, 'paid');
});

test('paid before joining the server: the order waits, and opens as soon as they join', async () => {
  const stranger = { id: '999888777666555444', username: 'newbie', global_name: 'Newbie', avatar: null };
  guild.unknownMembers = new Set([stranger.id]);
  const sid = await signIn(stranger);
  await buy(sid, { kind: 'access', requestId: 's-acc' });
  await buy(sid, { kind: 'products', requestId: 's-1', items: [{ id: keys.id, quantity: 1 }] });
  let order = (await (await get('/api/nox/orders', sid)).json()).orders.find((o) => o.kind === 'products');
  assert.match(order.delivery, /Join the NØX Discord server/);
  assert.equal(db.tickets((t) => t.ownerId === stranger.id).length, 0);

  guild.unknownMembers.delete(stranger.id);
  const member = guild.addMember(stranger.id, [db.roleId(guild.id, 'member')]);
  await hooks.emit('memberAdd', member);
  assert.equal(db.tickets((t) => t.ownerId === stranger.id).length, 1, 'the ticket opened on join');
  order = (await (await get('/api/nox/orders', sid)).json()).orders.find((o) => o.kind === 'products');
  assert.match(order.delivery, /ticket #\d{4}/);
  fakes.state.user = { id: '111222333444555666', username: 'tester', global_name: 'Tester', avatar: null };
});

test('the Stripe webhook hands the order to the bot too – once, even if the buyer also comes back', async () => {
  const sid = await signIn();
  const res = await (await post('/api/nox/checkout', { kind: 'products', requestId: 'wh-1', items: [{ id: combo.id, quantity: 1 }] }, sid)).json();
  const id = res.url.split('/').pop();
  const session = fakes.pay(id);
  const before = db.tickets((t) => t.ownerId === buyer.id).length;
  const raw = JSON.stringify({ type: 'checkout.session.completed', data: { object: session } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
  const ok = await fetch(`${base}/api/nox/stripe/webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${sig}` }, body: raw });
  assert.equal(ok.status, 200);
  await post('/api/nox/verify', { sessionId: id }, sid);
  assert.equal(db.tickets((x) => x.ownerId === buyer.id).length, before + 1, 'one ticket');
});

test('safety: prices from the shop, foreign sites refused, no session → 401, files stay inside web/public', async () => {
  const sid = await signIn();
  await post('/api/nox/checkout', { kind: 'products', requestId: 'cap', items: [{ id: keys.id, quantity: 99, price: 1 }] }, sid);
  assert.equal(fakes.state.lastCheckout.get('line_items[0][quantity]'), '10');
  assert.equal(fakes.state.lastCheckout.get('line_items[0][price_data][unit_amount]'), '990');
  assert.equal((await post('/api/nox/checkout', { kind: 'access' }, sid, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('/api/nox/checkout', { kind: 'access' })).status, 401);
  assert.match(await (await get('/')).text(), /<title>NØX/);
  assert.doesNotMatch(await (await get('/..%2F..%2Fsrc%2Fenv.js')).text(), /webSettings/);
});

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      // next
    }
  }
  return null;
}
const pw = playwright();

test('the real page in a browser: sign in → bag → Stripe → back → My orders, no errors', { skip: !pw && 'Playwright is not installed' }, async () => {
  const fs = require('node:fs');
  const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  await page.route((u) => u.hostname === 'checkout.stripe.com', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe</h1>' }));
  try {
    await page.goto(base);
    await page.waitForSelector('text=Game Keys');
    assert.equal(await page.locator('text=OFFLINE PREVIEW').count(), 0);
    await page.getByRole('button', { name: 'Connect Discord' }).first().click();
    await page.getByRole('link', { name: /Continue with Discord/ }).click();
    await page.waitForSelector('text=@tester', { timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Add to bag' }).first().click(); // access is active from the tests above
    await page.getByRole('button', { name: /Open bag, 1 items/ }).click();
    await Promise.all([page.waitForURL(/checkout\.stripe\.com/), page.getByRole('button', { name: /Continue to checkout/ }).click()]);
    const sessionId = page.url().split('/').pop();
    fakes.pay(sessionId);
    await page.goto(`${base}/?payment=return&session_id=${sessionId}`);
    await page.waitForSelector('text=Payment confirmed. Your account is updated.');
    await page.waitForSelector('text=on the NØX Discord');
    assert.deepEqual(problems, []);
  } finally {
    await browser.close();
  }
});
