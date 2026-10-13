'use strict';

/**
 * The store website, served by the bot (src/features/website.js starts it). The page (web/public/index.html) talks
 * to this API under /api/nox/:
 *
 *   GET  store            products (the bot's shop), what's switched on, the Discord invite
 *   GET  session          the signed-in Discord user (signing in is all it takes to buy – there is no access fee)
 *   GET  auth/start       → Discord sign-in;  auth/callback  ← back from Discord (sets the session cookie; the bot adds
 *                         the user to the NØX server with the Member role – onLogin)
 *   POST logout
 *   POST checkout         { kind: 'products', requestId, items: [{ id, quantity }] } → { url } (Stripe Checkout)
 *   POST verify           { sessionId } – after Stripe sends the buyer back: is it paid?
 *   GET  orders           the user's website orders (newest first)
 *   POST stripe/webhook   Stripe → paid / expired (signature checked)
 *   GET  image/:id        a product's own picture
 *
 * Prices always come from the bot's catalog – never from the browser. A paid order is handed to the bot
 * (onPaid): an order ticket opens on Discord and the product is delivered like any other paid order. The order then
 * carries its ticket (number + link) and whether it was delivered – the page's receipt and My orders show them.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { env } = require('../env');
const store = require('./store');
const stripe = require('./stripe');
const discord = require('./discord');

const PUBLIC = path.join(__dirname, '..', '..', 'web', 'public');
const STRIPE_MIN = 50; // Stripe's smallest charge in EUR cents
const MAX_QTY = 10;
const web = () => env.web;
const secure = () => web().publicUrl.startsWith('https://');
const authReady = () => Boolean(discord.clientId() && web().clientSecret && web().publicUrl);
const paymentsReady = () => Boolean(env.stripeKey && web().publicUrl);

// ───────────── Products ─────────────
/** Set by createWebServer: { catalog, info, onPaid, onLogin, isMember, currency }. */
let hooks = { catalog: () => [], info: () => ({}), onPaid: async () => null, onLogin: async () => null, isMember: () => null, currency: () => 'eur' };
const products = () => hooks.catalog();
const publicProduct = (p) => ({ id: p.id, name: p.name, category: p.category, description: p.description, price: p.price, art: p.art, image: p.image ?? null, eta: p.eta ?? null, instant: Boolean(p.instant), published: true });

// ───────────── HTTP helpers ─────────────
const HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};

function send(res, status, body, headers = {}) {
  const json = typeof body !== 'string' && !Buffer.isBuffer(body);
  res.writeHead(status, { ...HEADERS, ...(json && { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }), ...headers });
  res.end(json ? JSON.stringify(body) : body);
}
const fail = (res, status, error) => send(res, status, { error });
const redirect = (res, to, cookies = []) => send(res, 302, '', { location: to, 'set-cookie': cookies, 'cache-control': 'no-store' });

function cookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}
const cookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure() ? '; Secure' : ''}`;

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw Object.assign(new Error('Send JSON.'), { status: 415 });
  const raw = await readBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON.'), { status: 400 });
  }
}

/** POSTs from other sites are refused (the session cookie is SameSite=Lax too). */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = [web().publicUrl, `http://${req.headers.host}`, `https://${req.headers.host}`].filter(Boolean);
  return allowed.includes(origin);
}

// Simple per-IP limits: { key → [timestamps] }
const hits = new Map();
function limited(req, bucket, max, windowMs = 60_000) {
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > max;
}

const userOf = (req) => store.sessionUser(cookies(req).nox_sid);
const sessionJson = (user) => ({
  user: user ? { id: user.id, name: user.name, username: user.username, avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null } : null,
  access: Boolean(user), // signed in = can buy
  member: user ? hooks.isMember(user.id) : null, // on the NØX Discord (null = unknown)
});

// ───────────── Orders ─────────────
function orderJson(order) {
  const paid = order.status === 'paid';
  return {
    id: order.id,
    kind: order.kind,
    items: order.items.map((i) => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity })),
    amount: order.amount,
    currency: order.currency,
    status: order.status,
    created: order.created,
    stripe_id: order.stripe_id,
    delivery: paid ? order.delivery ?? null : null,
    ticketNumber: paid ? order.ticketNumber ?? null : null,
    ticketUrl: paid ? order.ticketUrl ?? null : null,
    delivered: paid && Boolean(order.delivered),
    waiting: paid && Boolean(order.waitingForMember && !order.handedOver),
  };
}

/** Stripe says paid (verify or webhook) → the order is paid once; the team is told once. */
async function settle(order, session) {
  if (!order || !session) return order;
  if (session.payment_status === 'paid') {
    const amountOk = session.amount_total === order.amount && String(session.currency).toLowerCase() === order.currency;
    if (!amountOk) {
      console.warn(`[web] ${order.id}: Stripe total ${session.amount_total} ${session.currency} ≠ order ${order.amount} ${order.currency} – not marked paid`);
      return store.updateOrder(order.id, { status: 'failed', note: 'amount mismatch' });
    }
    const { order: paid, first } = store.markPaid(order.id, { payment_intent: session.payment_intent ?? null });
    if (first) {
      console.log(`[web] order ${paid.id} paid – ${paid.kind} – ${(paid.amount / 100).toFixed(2)} ${paid.currency}`);
      await Promise.resolve(hooks.onPaid(paid, store._state().users[paid.userId])).catch((err) => console.warn(`[web] handing ${paid.id} to the bot:`, err.message));
    }
    return paid;
  }
  if (session.status === 'expired' && order.status === 'pending') return store.updateOrder(order.id, { status: 'expired' });
  return order;
}

async function checkout(req, res, user) {
  if (!paymentsReady()) return fail(res, 503, 'Checkout is not open yet. No payment has been taken.');
  if (limited(req, 'checkout', 10)) return fail(res, 429, 'Too many tries – wait a minute and try again.');
  const body = await jsonBody(req);
  if (body.kind === 'access') return fail(res, 409, "Signing in with Discord is all you need – there's no access fee.");
  if (body.kind !== 'products') return fail(res, 400, 'Unknown checkout.');
  const kind = 'products';
  const requestId = String(body.requestId ?? '').slice(0, 100) || crypto.randomUUID();

  // The same click twice (double click, back button) → the same payment page.
  const again = store.orderByRequest(user.id, requestId);
  if (again?.status === 'pending' && again.url) return send(res, 200, { url: again.url, order: again.id });

  const list = products();
  const wanted = new Map();
  for (const it of Array.isArray(body.items) ? body.items.slice(0, 50) : []) {
    const qty = Number(it?.quantity);
    if (!Number.isInteger(qty) || qty < 1) continue;
    wanted.set(String(it.id), Math.min(MAX_QTY, (wanted.get(String(it.id)) ?? 0) + qty));
  }
  const items = [];
  for (const [id, quantity] of wanted) {
    const p = list.find((x) => x.id === id);
    if (!p) return fail(res, 400, 'Something in your bag is no longer available. Remove it and try again.');
    items.push({ id: p.id, name: p.name, price: p.price, quantity: Math.min(MAX_QTY, quantity), productId: p.productId ?? null, variant: p.variant ?? null, eta: p.eta ?? null });
  }
  if (!items.length) return fail(res, 400, 'Your bag is empty.');
  const lines = items.map((i) => ({ name: i.name, amount: i.price, quantity: i.quantity, description: i.eta ? `${i.eta} · delivered on Discord` : 'Delivered on Discord' }));
  const amount = items.reduce((s, i) => s + i.price * i.quantity, 0);
  if (amount < STRIPE_MIN) return fail(res, 400, 'The total is below the smallest card payment (0.50 €).');

  const currency = hooks.currency();
  const order = store.createOrder({ userId: user.id, kind, items, amount, currency, requestId });
  try {
    const session = await stripe.createCheckout({ order, user, lines, currency, idempotencyKey: `nox-${order.id}` });
    store.updateOrder(order.id, { stripe_id: session.id, url: session.url });
    return send(res, 200, { url: session.url, order: order.id });
  } catch (err) {
    store.updateOrder(order.id, { status: 'failed', note: err.message });
    console.warn(`[web] checkout ${order.id}:`, err.message);
    return fail(res, 502, err.status === 401 ? 'Payments are not set up correctly yet – please contact NØX.' : "The payment page couldn't be opened. Please try again.");
  }
}

async function verify(req, res, user) {
  if (limited(req, 'verify', 30)) return fail(res, 429, 'Too many tries – wait a minute and try again.');
  const { sessionId } = await jsonBody(req);
  const order = sessionId ? store.orderByStripe(String(sessionId)) : null;
  if (!order || order.userId !== user.id) return fail(res, 404, 'This payment was not found on your account.');
  if (order.status === 'paid') return send(res, 200, { paid: true, status: 'paid', order: order.id });
  if (!paymentsReady()) return fail(res, 503, 'Payments are not connected right now.');
  const session = await stripe.getCheckout(order.stripe_id).catch((err) => {
    console.warn(`[web] verify ${order.id}:`, err.message);
    return null;
  });
  if (!session) return fail(res, 502, "Stripe couldn't be reached. Try again in a moment.");
  const updated = await settle(order, session);
  return send(res, 200, { paid: updated.status === 'paid', status: updated.status, order: updated.id });
}

async function webhook(req, res) {
  const raw = await readBody(req, 512 * 1024);
  let event;
  try {
    event = stripe.verifyWebhook(raw, req.headers['stripe-signature']);
  } catch (err) {
    return fail(res, 400, `Webhook: ${err.message}`);
  }
  const s = event.data?.object ?? {};
  const order = (s.metadata?.order_id && store.getOrder(s.metadata.order_id)) || (s.id && store.orderByStripe(s.id));
  if (order && ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired'].includes(event.type)) {
    await settle(order, s);
  } else if (order && event.type === 'checkout.session.async_payment_failed' && order.status === 'pending') {
    store.updateOrder(order.id, { status: 'failed' });
  }
  return send(res, 200, { received: true });
}

// ───────────── Discord sign-in ─────────────
function authStart(req, res) {
  if (!authReady()) return redirect(res, '/?auth=unavailable');
  const state = crypto.randomBytes(16).toString('base64url');
  return redirect(res, discord.authorizeUrl(state), [cookie('nox_oauth', state, 600)]);
}

async function authCallback(req, res, url) {
  const clear = cookie('nox_oauth', '', 0);
  if (url.searchParams.get('error')) return redirect(res, '/?auth=cancelled', [clear]);
  const state = url.searchParams.get('state');
  const expected = cookies(req).nox_oauth;
  if (!state || !expected || state.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return redirect(res, '/?auth=failed', [clear]);
  }
  try {
    const { me, accessToken } = await discord.userFromCode(String(url.searchParams.get('code') ?? ''));
    const user = store.upsertUser(me);
    // Not on the NØX Discord yet → the bot adds them (Member role included). Signing in never fails because of it.
    const joined = await Promise.resolve(hooks.onLogin(user, accessToken)).catch((err) => {
      console.warn(`[web] adding ${user.id} to the server:`, err.message);
      return null;
    });
    const token = store.createSession(user.id);
    return redirect(res, `/?connected=1${joined?.added ? '&joined=1' : ''}`, [clear, cookie('nox_sid', token, 30 * 86_400)]);
  } catch (err) {
    console.warn('[web] sign-in:', err.message);
    return redirect(res, '/?auth=failed', [clear]);
  }
}

// ───────────── Static files ─────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript' };
function serveStatic(req, res, pathname) {
  const file = pathname === '/' || pathname === '/index.html' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Unknown paths show the store (single page) – but not for missing assets.
    if (pathname.startsWith('/assets/')) return fail(res, 404, 'Not found');
    return serveStatic(req, res, '/');
  }
  const ext = path.extname(file);
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=604800, immutable';
  res.writeHead(200, { ...HEADERS, 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ───────────── Router ─────────────
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  if (!p.startsWith('/api/nox/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
    return serveStatic(req, res, p);
  }
  const route = p.slice('/api/nox/'.length);
  if (limited(req, 'api', 120)) return fail(res, 429, 'Slow down a little and try again.');

  if (req.method === 'GET') {
    if (route === 'health') return send(res, 200, { ok: true });
    if (route === 'store') {
      const live = authReady() && paymentsReady();
      return send(res, 200, {
        products: products().map(publicProduct),
        // Without Discord sign-in and Stripe the page shows its clearly marked offline preview (demo account).
        preview: !live,
        authReady: authReady(),
        paymentsReady: paymentsReady(),
        accessPrice: null, // no access fee – signing in with Discord is enough
        discordUrl: hooks.info().invite || null,
      });
    }
    if (route === 'session') return send(res, 200, sessionJson(userOf(req)));
    if (route === 'auth/start') return authStart(req, res);
    if (route === 'auth/callback') return authCallback(req, res, url);
    if (route.startsWith('image/')) {
      const p = products().find((x) => x.id === decodeURIComponent(route.slice(6)));
      if (!p?.imagePath || !fs.existsSync(p.imagePath)) return fail(res, 404, 'Not found');
      res.writeHead(200, { ...HEADERS, 'content-type': TYPES[path.extname(p.imagePath)] ?? 'image/png', 'cache-control': 'public, max-age=300' });
      return fs.createReadStream(p.imagePath).pipe(res);
    }
    if (route === 'orders') {
      const user = userOf(req);
      if (!user) return fail(res, 401, 'Sign in with Discord to see your orders.');
      return send(res, 200, { orders: store.ordersOf(user.id).filter((o) => o.stripe_id || o.status === 'paid').map(orderJson) });
    }
    return fail(res, 404, 'Not found');
  }

  if (req.method === 'POST') {
    if (route === 'stripe/webhook') return webhook(req, res);
    if (!sameOrigin(req)) return fail(res, 403, 'Request refused.');
    if (route === 'logout') {
      store.endSession(cookies(req).nox_sid);
      return send(res, 200, { ok: true }, { 'set-cookie': cookie('nox_sid', '', 0) });
    }
    const user = userOf(req);
    if (!user) return fail(res, 401, 'Sign in with Discord first.');
    if (route === 'checkout') return checkout(req, res, user);
    if (route === 'verify') return verify(req, res, user);
    return fail(res, 404, 'Not found');
  }
  return fail(res, 405, 'Method not allowed');
}

/**
 * The website server. h: { catalog() → products, info() → { invite }, onPaid(order, user),
 * onLogin(user, accessToken) → { added, member }, isMember(userId) → true | false | null, currency() → 'eur' }.
 */
function createWebServer(h = {}) {
  hooks = { ...hooks, ...h };
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!err.status) console.error('[web]', err);
      if (!res.headersSent) fail(res, err.status ?? 500, err.status ? err.message : 'Something went wrong on our side. Please try again.');
      else res.end();
    });
  });
}

module.exports = { createWebServer, authReady, paymentsReady };
