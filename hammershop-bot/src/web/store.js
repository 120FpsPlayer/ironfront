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
 * cosmetics[mc]     = { wings, halo, hat, exp, updatedAt } – the cosmetics (Dodatki) a Hammer+ account wears, shown like
 *                       its cape until exp; the key is there only once somebody has worn any
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
    state.referrals = raw.referrals ?? null; // „Zaproś znajomego” – see its block below
    if (raw.cosmetics) state.cosmetics = raw.cosmetics; // Dodatki – see setCosmetics
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

/**
 * The account picks a cape (null takes it off). exp: when the Hammer+ code it was set with ends (0 = never).
 * free: one of the capes for everybody – shown for as long as it is picked, Hammer+ or not.
 */
function setCape(mc, cape, exp, { free = false } = {}) {
  const before = own(state.capes, mc);
  if (cape == null) delete state.capes[mc];
  else if (free) state.capes[mc] = { cape, exp: 0, free: true, updatedAt: Date.now() };
  else state.capes[mc] = { cape, exp: before && !before.free && outlasts(before.exp, exp) ? before.exp : exp, updatedAt: Date.now() }; // a longer code seen earlier still counts
  save();
  return cape ?? null;
}

/** The account showed a working Hammer+ code that ends at exp – a renewed code keeps its cape and cosmetics visible. */
function seenPlus(mc, exp) {
  const entry = own(state.capes, mc);
  const look = state.cosmetics ? own(state.cosmetics, mc) : null;
  let changed = false;
  if (entry && !entry.free && outlasts(exp, entry.exp)) {
    entry.exp = exp;
    changed = true;
  }
  if (look && outlasts(exp, look.exp)) {
    look.exp = exp;
    changed = true;
  }
  if (changed) save();
}

/** The cape others see on this account – null without one, or once its Hammer+ has run out. */
function capeOf(mc, now = Date.now()) {
  const entry = own(state.capes, mc);
  return entry && running(entry.exp, now) ? entry.cape : null;
}

/**
 * Dodatki: the account wears these cosmetics – { wings, halo, hat } (ids already checked; null / nothing takes them
 * off). exp: when the Hammer+ code they were set with ends (0 = never) – a longer code seen earlier still counts.
 * → what is stored: { wings, halo, hat }.
 */
function setCosmetics(mc, look, exp) {
  const before = state.cosmetics ? own(state.cosmetics, mc) : null;
  const wings = look?.wings || null;
  const hat = look?.hat || null;
  const halo = look?.halo === true;
  if (!wings && !halo && !hat) {
    if (before) delete state.cosmetics[mc];
  } else (state.cosmetics ??= {})[mc] = { wings, halo, hat, exp: before && outlasts(before.exp, exp) ? before.exp : exp, updatedAt: Date.now() };
  save();
  return { wings, halo, hat };
}

/** The cosmetics others see on this account – { wings?, halo?, hat? } with only what it wears; null without any or once its Hammer+ has run out. */
function cosmeticsOf(mc, now = Date.now()) {
  const entry = state.cosmetics ? own(state.cosmetics, mc) : null;
  if (!entry || !running(entry.exp, now)) return null;
  return { ...(entry.wings && { wings: entry.wings }), ...(entry.halo && { halo: true }), ...(entry.hat && { hat: entry.hat }) };
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

// ── „Zaproś znajomego” – the referral programme (src/web/referrals.js, src/features/referrals.js) ──
/*
 * referrals.codes[code]        = discordId – whose personal link /r/<code> it is
 * referrals.people[discordId]  = { code, by, at, downloads, downloadedAt, boughtAt, boughtOrder, earned, balance, rewards }
 *   code         their own link – made the first time they open their referral card, then always the same
 *   by, at       who referred them and when – set once, at their very first sign-in on the site, never changed
 *   downloads    how often they downloaded the installer while signed in (downloadedAt: the first time)
 *   boughtAt     their first paid Hammer+ (boughtOrder) – the moment their referrer earned the reward
 *   earned       Hammer+ days earned as a referrer · balance: of those, the days not added to any Hammer+ yet
 *   rewards      codes issued from rewards [{ id, mc, nick, days, at, friend }] – what they were signed from, so the page
 *                can show them again (the code itself is never stored, like the orders' codes)
 */
const REF_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i – easy to read and to type
const REF_CODE = /^[a-hjkmnp-z2-9]{8}$/;
const MAX_REWARDS = 50;
const refs = () => (state.referrals ??= { codes: {}, people: {} });
/** The referral entry of a Discord account – null when there is none. */
const referralOf = (userId) => (Object.hasOwn(refs().people, String(userId)) ? refs().people[String(userId)] : null);
function refEntry(userId) {
  const id = String(userId);
  if (!referralOf(id)) refs().people[id] = { code: null, by: null, at: null, downloads: 0, earned: 0, balance: 0, rewards: [] };
  return refs().people[id];
}

/** This account has signed in on the site before. */
const siteUserExists = (userId) => Object.hasOwn(state.users, String(userId));

/** The account's own link code – 8 letters and digits, made the first time it is asked for, then always the same. */
function referralCode(userId) {
  const person = refEntry(userId);
  if (!person.code) {
    let code;
    do code = Array.from(crypto.randomBytes(8), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
    while (Object.hasOwn(refs().codes, code));
    person.code = code;
    refs().codes[code] = String(userId);
    save();
  }
  return person.code;
}

/** Whose link a code is – null for anything that is not one of ours. */
function referrerOf(code) {
  const c = String(code ?? '').toLowerCase();
  return REF_CODE.test(c) && Object.hasOwn(refs().codes, c) ? refs().codes[c] : null;
}

/** friendId came through referrerId's link – recorded once, for good. → true when it was recorded now. */
function addReferral(friendId, referrerId, now = Date.now()) {
  if (String(friendId) === String(referrerId) || referralOf(friendId)?.by) return false;
  Object.assign(refEntry(friendId), { by: String(referrerId), at: now });
  save();
  return true;
}

/** A signed-in account downloaded the installer. */
function countUserDownload(userId, now = Date.now()) {
  const person = refEntry(userId);
  person.downloads = (person.downloads ?? 0) + 1;
  person.downloadedAt ??= now;
  save();
}

/** The numbers on an account's referral card: how many came through its link, downloaded, bought; days earned / left. */
function referralStats(userId) {
  const id = String(userId);
  const friends = Object.values(refs().people).filter((p) => p.by === id);
  const me = referralOf(id);
  return { invited: friends.length, downloaded: friends.filter((p) => p.downloads > 0).length, bought: friends.filter((p) => p.boughtAt).length, earned: me?.earned ?? 0, balance: me?.balance ?? 0 };
}

/** friendId's first paid Hammer+ → the ID of whoever referred them (once – null when nobody did, or it was not the first). */
function referralPurchase(friendId, orderId, now = Date.now()) {
  const friend = referralOf(friendId);
  if (!friend?.by || friend.boughtAt) return null;
  Object.assign(friend, { boughtAt: now, boughtOrder: orderId ?? null });
  save();
  return friend.by;
}

/** Reward days for an account: earned counts them, balance keeps them to be claimed on the page. */
function addReferralDays(userId, days, { earned = true, balance = false } = {}) {
  const person = refEntry(userId);
  if (earned) person.earned = (person.earned ?? 0) + days;
  if (balance) person.balance = (person.balance ?? 0) + days;
  save();
  return person;
}

/** The days waiting to be claimed – taken all at once (the balance is 0 afterwards). → how many there were. */
function takeReferralBalance(userId) {
  const person = referralOf(userId);
  const days = person?.balance ?? 0;
  if (days) {
    person.balance = 0;
    save();
  }
  return days;
}

/** A code issued from a reward: { id, mc, nick, days, at, friend } – what it was signed from. */
function addReferralReward(userId, reward) {
  const person = refEntry(userId);
  person.rewards = [...(person.rewards ?? []), reward].slice(-MAX_REWARDS);
  save();
}

/** For the admin panel: the totals and the accounts that brought the most people (who bought Hammer+ first). */
function referralOverview(limit = 10) {
  const people = Object.entries(refs().people);
  const by = new Map();
  for (const [, p] of people) if (p.by) by.set(p.by, [...(by.get(p.by) ?? []), p]);
  const top = [...by.entries()]
    .map(([id, friends]) => ({ id, name: state.users[id]?.name ?? state.users[id]?.username ?? null, invited: friends.length, downloaded: friends.filter((f) => f.downloads > 0).length, bought: friends.filter((f) => f.boughtAt).length, earned: referralOf(id)?.earned ?? 0, balance: referralOf(id)?.balance ?? 0 }))
    .sort((a, b) => b.bought - a.bought || b.invited - a.invited)
    .slice(0, limit);
  const all = people.map(([, p]) => p);
  return {
    links: all.filter((p) => p.code).length,
    invited: all.filter((p) => p.by).length,
    downloaded: all.filter((p) => p.by && p.downloads > 0).length,
    bought: all.filter((p) => p.by && p.boughtAt).length,
    earned: all.reduce((s, p) => s + (p.earned ?? 0), 0),
    balance: all.reduce((s, p) => s + (p.balance ?? 0), 0),
    top,
  };
}

module.exports = {
  load, flush, upsertUser, createSession, sessionUser, endSession, createOrder, getOrder, orderByStripe, orderByRequest, ordersOf, updateOrder, markPaid,
  cloudOf, saveCloud, setCape, seenPlus, capeOf, setCosmetics, cosmeticsOf,
  newsList, getNews, addNews, updateNews, removeNews, getAlert, setAlert,
  releases, getRelease, currentRelease, saveRelease, setCurrentRelease, removeRelease,
  plusPlans, setPlusPlans, countDownload, countLaunch, stats, allOrders, dayOf,
  _state: () => state,
};
// „Zaproś znajomego” (its own block above).
Object.assign(module.exports, { siteUserExists, referralCode, referrerOf, referralOf, addReferral, countUserDownload, referralStats, referralPurchase, addReferralDays, takeReferralBalance, addReferralReward, referralOverview });
