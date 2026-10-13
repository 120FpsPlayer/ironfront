'use strict';

/**
 * A small JSON database (data/store.json): users, sessions and orders. Writes go to a temp file first and are then
 * renamed, so a crash never leaves half a file. Fine for a shop – thousands of orders, not millions.
 *
 * users[discordId]  = { id, name, username, avatar, access, accessAt, createdAt, lastSeenAt }
 * sessions[token]   = { userId, createdAt, expiresAt }
 * orders[id]        = { id, userId, kind ('access'|'products'), items [{ id, name, price, quantity }], amount, currency,
 *                       status ('pending'|'paid'|'expired'|'failed'), stripe_id, requestId, created, paidAt, delivery }
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { env } = require('./env');

const FILE = path.join(env.dataDir, 'store.json');
const SESSION_DAYS = 30;

let state = { users: {}, sessions: {}, orders: {} };
let timer = null;

function load() {
  fs.mkdirSync(env.dataDir, { recursive: true });
  if (fs.existsSync(FILE)) {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    state = { users: raw.users ?? {}, sessions: raw.sessions ?? {}, orders: raw.orders ?? {} };
  }
  // Old sessions out.
  const now = Date.now();
  for (const [token, s] of Object.entries(state.sessions)) if (s.expiresAt < now) delete state.sessions[token];
}

function flush() {
  clearTimeout(timer);
  timer = null;
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, FILE);
}
const save = () => {
  if (!timer) timer = setTimeout(flush, 200);
};

// ── Users & sessions ──
function upsertUser(discordUser) {
  const id = String(discordUser.id);
  const now = Date.now();
  const user = state.users[id] ?? { id, access: false, accessAt: null, createdAt: now };
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
const orderId = () => `NOX-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

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

/** Paid → the order is marked once, and an access order turns access on. Returns { order, first } (first = just now). */
function markPaid(id, extra = {}) {
  const order = state.orders[id];
  if (!order) return { order: null, first: false };
  if (order.status === 'paid') return { order, first: false };
  Object.assign(order, extra, { status: 'paid', paidAt: Date.now() });
  if (order.kind === 'access') {
    const user = state.users[order.userId];
    if (user && !user.access) Object.assign(user, { access: true, accessAt: Date.now() });
  }
  save();
  return { order, first: true };
}

function grantAccess(userId) {
  const user = state.users[userId];
  if (user && !user.access) {
    Object.assign(user, { access: true, accessAt: Date.now() });
    save();
  }
  return user;
}

module.exports = { load, flush, upsertUser, createSession, sessionUser, endSession, createOrder, getOrder, orderByStripe, orderByRequest, ordersOf, updateOrder, markPaid, grantAccess, _state: () => state };
