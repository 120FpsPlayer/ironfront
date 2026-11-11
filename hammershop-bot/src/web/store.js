'use strict';

/**
 * The website's own JSON database (data/web.json): users, sessions and orders – and what Hammer Launcher keeps online
 * (cloud sync, capes). Writes go to a temp file first and are then renamed, so a crash never leaves half a file. Fine for
 * a shop – thousands of orders, not millions.
 *
 * users[discordId]  = { id, name, username, avatar, createdAt, lastSeenAt }
 * sessions[token]   = { userId, createdAt, expiresAt }
 * orders[id]        = { id, userId, kind ('products'), items [{ id, name, price, quantity }], amount, currency,
 *                       status ('pending'|'paid'|'expired'|'failed'), stripe_id, requestId, created, paidAt,
 *                       delivery, ticketNumber, ticketUrl, delivered }
 * cloud[mc]         = { updatedAt (ms), data {…} } – a Hammer+ account's synced launcher data (mc: Minecraft UUID, 32 hex)
 * capes[mc]         = { cape, exp, updatedAt } – the cape a Hammer+ account picked; exp: when its Hammer+ ends (unix
 *                       seconds, 0 = never) – the cape is shown to others only until then
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../lib/db');

const FILE = () => path.join(db.dataDir, 'web.json'); // next to the bot's db.json
const SESSION_DAYS = 30;

const empty = () => ({ users: {}, sessions: {}, orders: {}, cloud: {}, capes: {} });
let state = empty();
let timer = null;

function load() {
  fs.mkdirSync(db.dataDir, { recursive: true });
  state = empty();
  if (fs.existsSync(FILE())) {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    state = { users: raw.users ?? {}, sessions: raw.sessions ?? {}, orders: raw.orders ?? {}, cloud: raw.cloud ?? {}, capes: raw.capes ?? {} };
  }
  // Old sessions out.
  const now = Date.now();
  for (const [token, s] of Object.entries(state.sessions)) if (s.expiresAt < now) delete state.sessions[token];
}

function flush() {
  clearTimeout(timer);
  timer = null;
  const tmp = `${FILE()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, FILE());
}
const save = () => {
  if (!timer) timer = setTimeout(flush, 200);
};

// ── Users & sessions ──
function upsertUser(discordUser) {
  const id = String(discordUser.id);
  const now = Date.now();
  const user = state.users[id] ?? { id, createdAt: now };
  user.username = discordUser.username;
  user.name = discordUser.global_name || discordUser.username;
  user.avatar = discordUser.avatar ?? null;
  user.lastSeenAt = now;
  state.users[id] = user;
  save();
  return user;
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  state.sessions[token] = { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_DAYS * 86_400_000 };
  save();
  return token;
}

function sessionUser(token) {
  const s = token && state.sessions[token];
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    delete state.sessions[token];
    save();
    return null;
  }
  return state.users[s.userId] ?? null;
}

function endSession(token) {
  if (token && state.sessions[token]) {
    delete state.sessions[token];
    save();
  }
}

// ── Orders ──
const orderId = () => `HS-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

function createOrder({ userId, kind, items, amount, currency, requestId }) {
  const order = { id: orderId(), userId, kind, items, amount, currency, status: 'pending', stripe_id: null, requestId, created: Math.floor(Date.now() / 1000), paidAt: null };
  state.orders[order.id] = order;
  save();
  return order;
}

const getOrder = (id) => state.orders[id] ?? null;
const orderByStripe = (stripeId) => Object.values(state.orders).find((o) => o.stripe_id === stripeId) ?? null;
const orderByRequest = (userId, requestId) => Object.values(state.orders).find((o) => o.userId === userId && o.requestId === requestId) ?? null;
const ordersOf = (userId) => Object.values(state.orders).filter((o) => o.userId === userId).sort((a, b) => b.created - a.created);

function updateOrder(id, patch) {
  const order = state.orders[id];
  if (!order) return null;
  Object.assign(order, patch);
  save();
  return order;
}

/** Paid → the order is marked once. Returns { order, first } (first = just now). */
function markPaid(id, extra = {}) {
  const order = state.orders[id];
  if (!order) return { order: null, first: false };
  if (order.status === 'paid') return { order, first: false };
  Object.assign(order, extra, { status: 'paid', paidAt: Date.now() });
  save();
  return { order, first: true };
}

// ── Hammer Launcher: cloud sync and capes, one entry per Minecraft account (src/web/launcher.js) ──
const own = (map, key) => (Object.hasOwn(map, key) ? map[key] : null);
/** Hammer+ that ends at a is still running after one that ends at b (0 = never ends). */
const outlasts = (a, b) => b !== 0 && (a === 0 || a > b);
const running = (exp, now = Date.now()) => exp === 0 || exp * 1000 > now;

const cloudOf = (mc) => own(state.cloud, mc);

/** Stores the account's data. → { updatedAt, data } – updatedAt always moves forward, so it works as a version. */
function saveCloud(mc, data) {
  const entry = { updatedAt: Math.max(Date.now(), (cloudOf(mc)?.updatedAt ?? 0) + 1), data };
  state.cloud[mc] = entry;
  save();
  return entry;
}

/** The account picks a cape (null takes it off). exp: when the Hammer+ code it was set with ends (0 = never). */
function setCape(mc, cape, exp) {
  const before = own(state.capes, mc);
  if (cape == null) delete state.capes[mc];
  else state.capes[mc] = { cape, exp: before && outlasts(before.exp, exp) ? before.exp : exp, updatedAt: Date.now() }; // a longer code seen earlier still counts
  save();
  return cape ?? null;
}

/** The account showed a working Hammer+ code that ends at exp – a renewed code keeps its cape visible. */
function seenPlus(mc, exp) {
  const entry = own(state.capes, mc);
  if (entry && outlasts(exp, entry.exp)) {
    entry.exp = exp;
    save();
  }
}

/** The cape others see on this account – null without one, or once its Hammer+ has run out. */
function capeOf(mc, now = Date.now()) {
  const entry = own(state.capes, mc);
  return entry && running(entry.exp, now) ? entry.cape : null;
}

module.exports = {
  load, flush, upsertUser, createSession, sessionUser, endSession, createOrder, getOrder, orderByStripe, orderByRequest, ordersOf, updateOrder, markPaid,
  cloudOf, saveCloud, setCape, seenPlus, capeOf,
  _state: () => state,
};
