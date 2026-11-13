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
 *
 * What the admin panel (src/web/admin.js) manages – Hammer Launcher shows it:
 * news[]            = { id, title, body, tag, url, image, pinned, at (ms), by (Discord user ID), discord (message link) }
 * alert             = { id, level ('info'|'warning'|'critical'), text, url, until (ms | null), at, by } | null
 * releases          = { current (version | null), list [{ version, file, size, sha512, blockmap, signature, notes,
 *                       minVersion, at, by, downloads }] } – the installers themselves are files in data/releases/
 * plusPlans[]       = { id, name, days (0 = forever), price (smallest currency unit) } – Hammer+ as sold on the website
 * stats             = { downloads { 'YYYY-MM-DD': n }, launches { 'YYYY-MM-DD': { total, unique, versions { v: n } } } }
 *                       – total: how often launchers asked for news, unique: how many different launchers (addresses)
 *                       were seen that day, versions: which version each of them ran. No addresses, no accounts: only
 *                       counts (the last 90 days are kept)
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../lib/db');

const FILE = () => path.join(db.dataDir, 'web.json'); // next to the bot's db.json
const SESSION_DAYS = 30;

const STATS_DAYS = 90;
const MAX_NEWS = 100;
const MAX_RELEASES = 30;

const empty = () => ({ users: {}, sessions: {}, orders: {}, cloud: {}, capes: {}, news: [], alert: null, releases: { current: null, list: [] }, plusPlans: [], stats: { downloads: {}, launches: {} } });
let state = empty();
let timer = null;

function load() {
  fs.mkdirSync(db.dataDir, { recursive: true });
  state = empty();
  if (fs.existsSync(FILE())) {
    const raw = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    state = {
      users: raw.users ?? {}, sessions: raw.sessions ?? {}, orders: raw.orders ?? {}, cloud: raw.cloud ?? {}, capes: raw.capes ?? {},
      news: Array.isArray(raw.news) ? raw.news : [],
      alert: raw.alert ?? null,
      releases: { current: raw.releases?.current ?? null, list: Array.isArray(raw.releases?.list) ? raw.releases.list : [] },
      plusPlans: Array.isArray(raw.plusPlans) ? raw.plusPlans : [],
      stats: { downloads: raw.stats?.downloads ?? {}, launches: raw.stats?.launches ?? {} },
    };
  }
  // Old sessions out.
  const now = Date.now();
  for (const [token, s] of Object.entries(state.sessions)) if (s.expiresAt < now) delete state.sessions[token];
}

function flush() {
  clearTimeout(timer);
  timer = null;
  slow = false;
  const tmp = `${FILE()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 1));
  fs.renameSync(tmp, FILE());
}
let failures = 0;
/**
 * The timed write. A file that cannot be written (a full disk, no permission) must not take the bot down: the data
 * stays in memory, the console says why, and the write is tried again a little later.
 */
function flushSoon() {
  try {
    flush();
    if (failures) console.log('💾 Baza strony (web.json) znowu się zapisuje.');
    failures = 0;
  } catch (err) {
    failures += 1;
    if (failures === 1 || failures % 20 === 0) console.warn(`💾 Nie udało się zapisać bazy strony (web.json): ${err.code ?? ''} ${err.message} – ${err.code === 'ENOSPC' ? 'na dysku serwera zabrakło miejsca' : 'sprawdź dysk i uprawnienia'}. Dane są w pamięci, próbuję ponownie.`);
    try {
      fs.rmSync(`${FILE()}.${process.pid}.tmp`, { force: true });
    } catch {
      // nothing to clean up
    }
    timer = setTimeout(flushSoon, Math.min(60_000, 2000 * failures));
    timer.unref?.();
  }
}
let slow = false; // the waiting write is one of the unhurried ones (counters)
const save = () => {
  if (timer && !slow) return;
  clearTimeout(timer);
  slow = false;
  timer = setTimeout(flushSoon, 200);
};
/** For counters that change with every launcher start: written within half a minute, not on every request. */
const saveLater = () => {
  if (timer) return;
  slow = true;
  timer = setTimeout(flushSoon, 30_000);
  timer.unref?.();
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

function createOrder({ userId, kind, items, amount, currency, requestId, plus = null }) {
  const order = { id: orderId(), userId, kind, items, amount, currency, status: 'pending', stripe_id: null, requestId, created: Math.floor(Date.now() / 1000), paidAt: null, ...(plus && { plus }) };
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

// ── The admin panel's content: news, the alert bar, launcher releases, Hammer+ plans ──
const newId = (prefix) => `${prefix}_${crypto.randomBytes(5).toString('hex')}`;

/** Pinned first, then the newest. */
const newsList = () => [...state.news].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.at - a.at);
const getNews = (id) => state.news.find((n) => n.id === id) ?? null;

function addNews(fields) {
  const item = { id: newId('n'), title: '', body: '', tag: null, url: null, image: null, pinned: false, by: null, discord: null, ...fields, at: fields.at ?? Date.now() };
  state.news = [...state.news, item].sort((a, b) => a.at - b.at).slice(-MAX_NEWS);
  save();
  return item;
}

function updateNews(id, patch) {
  const item = getNews(id);
  if (!item) return null;
  Object.assign(item, patch);
  save();
  return item;
}

function removeNews(id) {
  const before = state.news.length;
  state.news = state.news.filter((n) => n.id !== id);
  if (state.news.length !== before) save();
  return state.news.length !== before;
}

/** The alert bar – null when there is none or its time is up. */
const getAlert = (now = Date.now()) => (state.alert && (!state.alert.until || state.alert.until > now) ? state.alert : null);

function setAlert(fields) {
  state.alert = fields ? { id: newId('a'), level: 'info', text: '', url: null, until: null, by: null, ...fields, at: Date.now() } : null;
  save();
  return state.alert;
}

const releases = () => [...state.releases.list].sort((a, b) => b.at - a.at);
const getRelease = (version) => state.releases.list.find((r) => r.version === version) ?? null;
const currentRelease = () => (state.releases.current && getRelease(state.releases.current)) || null;

/** Adds or replaces the release of this version. → { release, dropped (releases pushed out of the list) } */
function saveRelease(release) {
  const rest = state.releases.list.filter((r) => r.version !== release.version);
  const kept = [...rest, { downloads: 0, ...release }].sort((a, b) => a.at - b.at);
  const dropped = kept.slice(0, Math.max(0, kept.length - MAX_RELEASES)).filter((r) => r.version !== state.releases.current);
  state.releases.list = kept.filter((r) => !dropped.includes(r));
  save();
  return { release: getRelease(release.version), dropped };
}

function setCurrentRelease(version) {
  if (version !== null && !getRelease(version)) return null;
  state.releases.current = version;
  save();
  return currentRelease();
}

function removeRelease(version) {
  const release = getRelease(version);
  if (!release) return null;
  state.releases.list = state.releases.list.filter((r) => r !== release);
  if (state.releases.current === version) state.releases.current = null;
  save();
  return release;
}

const plusPlans = () => state.plusPlans;
function setPlusPlans(list) {
  state.plusPlans = list;
  save();
  return state.plusPlans;
}

// ── Counts for the admin panel (never who – only how many) ──
const dayOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const seen = { day: null, keys: new Set() }; // today's visitors, in memory only (hashed – src/web/launcher.js)

function prune(map, now) {
  const oldest = dayOf(now - STATS_DAYS * 86_400_000);
  for (const day of Object.keys(map)) if (day < oldest) delete map[day];
}

function countDownload(version, now = Date.now()) {
  const day = dayOf(now);
  state.stats.downloads[day] = (state.stats.downloads[day] ?? 0) + 1;
  prune(state.stats.downloads, now);
  const release = version && getRelease(version);
  if (release) release.downloads = (release.downloads ?? 0) + 1;
  save();
}

/**
 * A launcher asked for its news. The first time a visitorKey shows up on a day it counts as one more launcher of that
 * version (an open launcher asks again every few minutes – that only raises total).
 */
function countLaunch(version, visitorKey, now = Date.now()) {
  const day = dayOf(now);
  if (seen.day !== day) {
    seen.day = day;
    seen.keys = new Set();
  }
  const entry = (state.stats.launches[day] ??= { total: 0, unique: 0, versions: {} });
  entry.total += 1;
  if (visitorKey && !seen.keys.has(visitorKey) && seen.keys.size < 200_000) {
    seen.keys.add(visitorKey);
    entry.unique += 1;
    const v = version || '?';
    if (Object.keys(entry.versions).length < 40 || Object.hasOwn(entry.versions, v)) entry.versions[v] = (entry.versions[v] ?? 0) + 1;
  }
  prune(state.stats.launches, now);
  saveLater();
}

const stats = () => state.stats;
const allOrders = () => Object.values(state.orders).sort((a, b) => b.created - a.created);

module.exports = {
  load, flush, upsertUser, createSession, sessionUser, endSession, createOrder, getOrder, orderByStripe, orderByRequest, ordersOf, updateOrder, markPaid,
  cloudOf, saveCloud, setCape, seenPlus, capeOf,
  newsList, getNews, addNews, updateNews, removeNews, getAlert, setAlert,
  releases, getRelease, currentRelease, saveRelease, setCurrentRelease, removeRelease,
  plusPlans, setPlusPlans, countDownload, countLaunch, stats, allOrders, dayOf,
  _state: () => state,
};
