'use strict';

/**
 * Hammer Launcher's part of the website (src/web/server.js hands these paths over). JSON under /api/launcher/:
 *
 *   GET health            { ok: true, plus } – plus: the Hammer+ signing key is configured
 *   GET featured          { servers: [{ id, name, address, description, tags, icon, mc, loader, pack }] } – the servers
 *                         from /featured; public, cacheable for 5 minutes
 *   GET news              { news: [{ id, title, body, tag, date, at, url, image, pinned }], alert: { id, level, text, url,
 *                         until } | null, release: { version, notes, date, minVersion, size, url } | null } – what the
 *                         admin panel published (src/web/admin.js): the home screen's news, the bar at the top of the
 *                         launcher and the newest installer. Public; every call counts as one start of the launcher
 *                         (only numbers per day and version are kept)
 *   GET cloud             Bearer → { updatedAt, data }; 404 when nothing is stored for the account
 *   PUT cloud             Bearer, { data: {…}, baseUpdatedAt? }, at most 256 KB → { updatedAt };
 *                         409 { error, updatedAt, data } (the stored copy) when baseUpdatedAt is older than what is stored
 *   GET capes?uuids=a,b   { capes: { "<uuid>": "<capeId>" } } – public, at most 100 accounts; only accounts whose
 *                         Hammer+ was running when they picked the cape and still is
 *   PUT cape              Bearer, { cape: "<capeId>" | null } → { cape }
 *                         – or, for the capes everybody may wear (FREE_CAPES), without Hammer+: header
 *                         X-Minecraft-Token = the account's own Minecraft sign-in, checked with Mojang (never stored)
 *   PUT presence          { me: "<uuid>" | null, uuids: ["<uuid>", …] } → { players: { "<uuid>": "h" | "p" } } – public,
 *                         at most 100 accounts. `me` says "this account is playing on Hammer Client right now" (kept in
 *                         memory for five minutes, never written down); the answer names those of `uuids` who play on
 *                         Hammer Client now: "h", or "p" when their Hammer+ is running. The mod draws the H / H+ badge
 *                         in front of their names in the player list (Tab) from it.
 *
 * Bearer = a Hammer+ code (src/lib/plus.js) in "Authorization: Bearer HP1.…": its signature and expiry are checked with
 * the configured key, and the account is the Minecraft UUID inside it. Without a key those endpoints answer 503.
 * Errors are { error: "<Polish message>" } with 400 / 401 / 404 / 409 / 413 / 429.
 *
 * And the page behind "join this server" links:  GET /join?server=…&name=…&mc=…&loader=…&pack=…&icon=…  opens
 * hammer://join?<the same query> in the launcher and shows a button for it.
 */

const crypto = require('node:crypto');
const plus = require('../lib/plus');
const profile = require('../lib/profile');
const config = require('../lib/config');
const store = require('./store');
const admin = require('./admin');
const releases = require('./releases');

const PREFIX = '/api/launcher/';
const CAPES = ['hammer', 'gold', 'ember', 'royal', 'frost', 'crimson'];
const FREE_CAPES = ['hammer', 'ember']; // for everybody – the launcher's capes.json says the same
const MOJANG_PROFILE = 'https://api.minecraftservices.com/minecraft/profile';
const CLOUD_LIMIT = 256 * 1024;
const CAPE_LIMIT = 4 * 1024;
const DRAIN_LIMIT = 4 * 1024 * 1024; // how much of a too-big upload is still read (and thrown away) so the sender gets the answer
const MAX_UUIDS = 100;
const PRESENCE_LIMIT = 8 * 1024;
const PRESENCE_MS = 5 * 60_000; // how long "I play on Hammer Client" holds without being said again
const MAX_PRESENT = 200_000;
const MAX_ANNOUNCED = 8; // accounts one address may announce within PRESENCE_MS (a household, not a whole server)
const MAX_DEPTH = 64;
const SLOW_DOWN = 'Zwolnij trochę i spróbuj ponownie.';

const problem = (status, message) => Object.assign(new Error(message), { status });
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** Nested deeper than the database can write back (a 256 KB body of "[[[[…" parses, but can't be saved). */
function tooDeep(value, max = MAX_DEPTH) {
  const todo = [[value, 1]];
  while (todo.length) {
    const [v, depth] = todo.pop();
    if (!v || typeof v !== 'object') continue;
    if (depth > max) return true;
    for (const child of Array.isArray(v) ? v : Object.values(v)) if (child && typeof child === 'object') todo.push([child, depth + 1]);
  }
  return false;
}

/**
 * The request body, at most limit bytes – more → 413. A too-big upload is answered right away and the rest of it is
 * read and dropped (up to DRAIN_LIMIT), so the launcher sees the 413 instead of a broken connection.
 */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const tooBig = () => problem(413, `Za dużo danych – najwyżej ${Math.round(limit / 1024)} KB.`);
    let size = 0;
    let over = Number(req.headers['content-length']) > limit;
    const chunks = [];
    if (over) reject(tooBig());
    req.on('data', (c) => {
      size += c.length;
      if (!over && size > limit) {
        over = true;
        chunks.length = 0;
        reject(tooBig());
      }
      if (!over) chunks.push(c);
      else if (size > DRAIN_LIMIT) req.destroy();
    });
    req.on('end', () => {
      if (!over) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (err) => {
      if (!over) reject(err);
    });
  });
}

/** The body as a JSON object (the launcher isn't a browser form – the content type doesn't matter). */
async function jsonBody(req, limit) {
  const raw = await readBody(req, limit);
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    throw problem(400, 'Nieprawidłowy JSON.');
  }
  if (!isObject(body)) throw problem(400, 'Wyślij dane jako obiekt JSON.');
  return body;
}

/** The Hammer+ account behind the request → the code's payload { id, mc, exp, iat }. Throws 503 / 401. */
function account(req, res) {
  if (!plus.ready()) throw problem(503, `Hammer+ nie jest jeszcze uruchomiony po stronie ${config.brand.name}. Spróbuj ponownie później.`);
  const unauthorized = (message) => {
    res.setHeader('www-authenticate', 'Bearer');
    return problem(401, message);
  };
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? '').trim());
  if (!m) throw unauthorized('Brak kodu Hammer+. Wpisz swój kod w Hammer Launcherze: Hammer+ → „Mam kod”.');
  let payload;
  try {
    payload = plus.verify(m[1]);
  } catch (err) {
    throw err instanceof plus.PlusError ? unauthorized(err.message) : err;
  }
  store.seenPlus(payload.mc, payload.exp); // a renewed code keeps the account's cape visible
  return payload;
}

// ── Free capes without Hammer+: whose Minecraft sign-in is it? Asked at Mojang; only a hash of the token is kept, for a while. ──
const signedIn = new Map(); // sha256(token) → { mc, until }
let profileFetch = (...a) => fetch(...a);
const setProfileFetch = (fn) => (profileFetch = fn ?? ((...a) => fetch(...a)));
async function minecraftAccount(token) {
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const known = signedIn.get(key);
  if (known && known.until > Date.now()) return known.mc;
  let res;
  try {
    res = await profileFetch(MOJANG_PROFILE, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  } catch {
    throw problem(503, 'Nie udało się sprawdzić konta Minecraft – spróbuj ponownie za chwilę.');
  }
  if (res.status === 401 || res.status === 403) throw problem(401, 'Mojang nie przyjął logowania tego konta – zaloguj się ponownie w launcherze.');
  const body = await res.json().catch(() => null);
  const mc = res.ok ? plus.normalizeUuid(body?.id) : null;
  if (!mc) throw problem(503, 'Nie udało się sprawdzić konta Minecraft – spróbuj ponownie za chwilę.');
  if (signedIn.size > 5000) signedIn.clear();
  signedIn.set(key, { mc, until: Date.now() + 10 * 60_000 });
  return mc;
}

/** Which methods each path under /api/launcher/ takes. */
const ROUTES = { health: ['GET'], featured: ['GET'], news: ['GET'], capes: ['GET'], presence: ['PUT'], cloud: ['GET', 'PUT'], cape: ['PUT'] };

// ── Who plays on Hammer Client right now: account → until when. Only in memory – gone with a restart, back within a minute. ──
const present = new Map();
const announced = new Map(); // address (hashed) → Map(account → until): one address cannot mark a crowd as Hammer players
let presenceSwept = 0;

function sweepPresence(now) {
  if (now - presenceSwept < 60_000 && present.size < MAX_PRESENT) return;
  presenceSwept = now;
  for (const [mc, until] of present) if (until <= now) present.delete(mc);
  for (const [key, list] of announced) {
    for (const [mc, until] of list) if (until <= now) list.delete(mc);
    if (!list.size) announced.delete(key);
  }
  if (present.size >= MAX_PRESENT) present.clear(); // flooded: forget, real players are back with their next call
}

/** Marks the account as playing now; false when this address already speaks for too many accounts. */
function announce(mc, address, now = Date.now()) {
  sweepPresence(now);
  const key = visitorKey(address);
  const mine = announced.get(key) ?? new Map();
  for (const [other, until] of mine) if (until <= now) mine.delete(other);
  if (!mine.has(mc) && mine.size >= MAX_ANNOUNCED) return false;
  mine.set(mc, now + PRESENCE_MS);
  announced.set(key, mine);
  present.set(mc, now + PRESENCE_MS);
  return true;
}

const isPresent = (mc, now = Date.now()) => (present.get(mc) ?? 0) > now;
/** How many accounts play on Hammer Client right now (for the admin panel). */
function onlineNow(now = Date.now()) {
  let n = 0;
  for (const until of present.values()) if (until > now) n += 1;
  return n;
}
const MAX_NEWS = 12;
// Who started the launcher today is only ever kept as a salted hash, in memory, until midnight – enough to count
// "launchers today" without storing a single address.
const SALT = crypto.randomBytes(16);
const visitorKey = (ip) => crypto.createHash('sha256').update(SALT).update(String(ip ?? '')).digest('base64').slice(0, 16);
/** "Hammer-Launcher/2.6.0 (…)" → "2.6.0"; anything else → null. */
const launcherVersion = (ua) => /^Hammer-?Launcher\/(\d{1,4}\.\d{1,4}\.\d{1,4})\b/i.exec(String(ua ?? ''))?.[1] ?? null;

/** What GET news answers. */
function feed(publicUrl, now = Date.now()) {
  return { news: store.newsList().slice(0, MAX_NEWS).map(admin.publicNews), alert: admin.publicAlert(store.getAlert(now)), release: releases.publicInfo(publicUrl) };
}

/**
 * /api/launcher/… – h: { send, fail, limited } (the website's own helpers: security headers, per-IP limits) and
 * featured() → the featured servers.
 */
async function api(req, res, url, { send, fail, limited, featured, publicUrl = () => '', ip = () => null, plusOf = () => false }) {
  const route = url.pathname.slice(PREFIX.length);
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  // The launcher calls from its own window, not from a page of this site – and never with a cookie: the code is in a header.
  res.setHeader('access-control-allow-origin', '*');
  if (method === 'OPTIONS') {
    return send(res, 204, '', { 'access-control-allow-methods': 'GET, PUT, OPTIONS', 'access-control-allow-headers': 'authorization, content-type, x-minecraft-token', 'access-control-max-age': '86400' });
  }
  if (limited(req, 'launcher', 120)) return fail(res, 429, SLOW_DOWN);
  if (!Object.hasOwn(ROUTES, route)) return fail(res, 404, 'Nie znaleziono');
  if (!ROUTES[route].includes(method)) return fail(res, 405, 'Niedozwolona metoda');

  if (route === 'health') return send(res, 200, { ok: true, plus: plus.ready() });
  if (route === 'featured') return send(res, 200, { servers: featured() }, { 'cache-control': 'public, max-age=300' });
  if (route === 'news') {
    const version = launcherVersion(req.headers['user-agent']);
    if (version) store.countLaunch(version, visitorKey(ip(req))); // browsers looking at the launcher page are not launchers
    return send(res, 200, feed(publicUrl()), { 'cache-control': 'no-cache' });
  }

  if (route === 'capes') {
    const asked = String(url.searchParams.get('uuids') ?? '').split(',').map((u) => u.trim()).filter(Boolean);
    if (asked.length > MAX_UUIDS) return fail(res, 400, `Najwyżej ${MAX_UUIDS} kont w jednym zapytaniu.`);
    const capes = {};
    for (const uuid of asked) {
      // Answered under the spelling that was asked for (with or without dashes); anything that isn't a UUID has no cape.
      const mc = plus.normalizeUuid(uuid);
      const cape = mc && store.capeOf(mc);
      if (cape) capes[uuid] = cape;
    }
    return send(res, 200, { capes });
  }

  if (route === 'presence') {
    const body = await jsonBody(req, PRESENCE_LIMIT);
    const asked = Array.isArray(body.uuids) ? body.uuids.filter((u) => typeof u === 'string') : [];
    if (asked.length > MAX_UUIDS) return fail(res, 400, `Najwyżej ${MAX_UUIDS} kont w jednym zapytaniu.`);
    // Only real (online-mode) accounts play on Hammer Launcher: their ids are version 4.
    const me = body.me == null ? null : plus.normalizeUuid(body.me);
    if (me && me[12] === '4') announce(me, ip(req));
    const players = {};
    for (const uuid of asked) {
      const mc = plus.normalizeUuid(uuid);
      if (mc && isPresent(mc)) players[uuid] = plusOf(mc) ? 'p' : 'h';
    }
    return send(res, 200, { players }, { 'cache-control': 'no-store' });
  }

  // A free cape without Hammer+: the account's own Minecraft sign-in proves whose cape it is.
  const minecraftToken = String(req.headers['x-minecraft-token'] ?? '').trim();
  if (route === 'cape' && minecraftToken && !req.headers.authorization) {
    if (limited(req, 'launcher-write', 30)) return fail(res, 429, SLOW_DOWN);
    if (minecraftToken.length > 4096) return fail(res, 400, 'Nieprawidłowe logowanie Minecraft.');
    const body = await jsonBody(req, CAPE_LIMIT);
    if (body.cape !== null && !CAPES.includes(body.cape)) return fail(res, 400, `Nieznana peleryna. Do wyboru: ${CAPES.join(', ')} – albo null, żeby ją zdjąć.`);
    if (body.cape !== null && !FREE_CAPES.includes(body.cape)) return fail(res, 403, 'Ta peleryna jest częścią Hammer+ – wpisz swój kod w Hammer Launcherze: Hammer+ → „Mam kod”.');
    const mc = await minecraftAccount(minecraftToken);
    return send(res, 200, { cape: store.setCape(mc, body.cape, 0, { free: true }) });
  }

  // Everything below belongs to one Hammer+ account.
  const who = account(req, res);

  if (method === 'GET') {
    const stored = store.cloudOf(who.mc);
    if (!stored) return fail(res, 404, 'Nie masz jeszcze nic zapisanego w chmurze.');
    return send(res, 200, { updatedAt: stored.updatedAt, data: stored.data });
  }

  if (limited(req, 'launcher-write', 30)) return fail(res, 429, SLOW_DOWN);

  if (route === 'cape') {
    const body = await jsonBody(req, CAPE_LIMIT);
    if (body.cape !== null && !CAPES.includes(body.cape)) return fail(res, 400, `Nieznana peleryna. Do wyboru: ${CAPES.join(', ')} – albo null, żeby ją zdjąć.`);
    return send(res, 200, { cape: store.setCape(who.mc, body.cape, who.exp, { free: FREE_CAPES.includes(body.cape) }) });
  }

  const body = await jsonBody(req, CLOUD_LIMIT);
  if (!isObject(body.data)) return fail(res, 400, 'Brakuje pola „data” – to musi być obiekt JSON z danymi launchera.');
  if (tooDeep(body.data)) return fail(res, 400, 'Dane są zbyt głęboko zagnieżdżone.');
  const base = body.baseUpdatedAt ?? null;
  if (base !== null && !(typeof base === 'number' && Number.isFinite(base) && base >= 0)) return fail(res, 400, 'Pole „baseUpdatedAt” musi być liczbą – czasem w milisekundach.');
  const stored = store.cloudOf(who.mc);
  if (base !== null && stored && base < stored.updatedAt) {
    return send(res, 409, { error: 'W chmurze jest już nowsza wersja Twoich danych – najpierw je pobierz.', updatedAt: stored.updatedAt, data: stored.data });
  }
  return send(res, 200, { updatedAt: store.saveCloud(who.mc, body.data).updatedAt });
}

// ───────────── /join – "open this server in Hammer Launcher" ─────────────
const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** A query parameter as one line of plain text (control and text-direction characters out, cut to max). */
const param = (url, name, max) => (url.searchParams.get(name) ?? '').replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };
const MC_VERSION = /^\d{1,2}\.\d{1,3}(?:\.\d{1,3})?$/;

// The look of the store page (web/public/index.html): dark, light orange, the hammer logo.
const JOIN_STYLE = [
  '*{box-sizing:border-box;margin:0;padding:0}',
  ':root{--bg:#0e0b09;--line:#ffffff10;--muted:#9d9086;color-scheme:dark}',
  'body{background:var(--bg) radial-gradient(60rem 30rem at 50% -10%,#fa9c5222,#0000 70%) no-repeat;color:#fcf5f0;-webkit-font-smoothing:antialiased;font:14px Inter,Segoe UI,Arial,sans-serif;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px 16px}',
  '.card{background:#1a1410;border:1px solid #e8ba9237;border-radius:15px;width:min(460px,100%);padding:36px 30px 28px;text-align:center;box-shadow:0 30px 100px #000b}',
  '.logo{display:inline-flex;align-items:center;font-size:24px;font-weight:900;letter-spacing:-1.2px;line-height:1;color:inherit;text-decoration:none}',
  '.logo i{width:1.15em;height:1.15em;margin-right:.3em;background:url(/assets/hammershop-mark.svg) center/contain no-repeat;filter:drop-shadow(0 0 10px #ff8a2b55)}',
  '.logo b{font-weight:900;color:#ffa94d}',
  // Hammer Launcher's own site (BOT_PROFILE=launcher): the big H instead of the hammer.
  '.logo.h i{width:1.1em;height:1.25em;background-image:url(/assets/launcher-h.png);filter:drop-shadow(0 0 10px #ffc23355)}',
  '.eyebrow{margin-top:26px;letter-spacing:2px;color:#d2b69f;font-size:10px;font-weight:500}',
  'h1{margin-top:10px;font-size:24px;line-height:1.25;font-weight:700;letter-spacing:-.4px;overflow-wrap:anywhere}',
  'h1 span{color:#ffa94d}',
  '.address{margin-top:12px}',
  'code{display:inline-block;max-width:100%;overflow-wrap:anywhere;padding:7px 12px;border:1px solid var(--line);border-radius:7px;background:#ffffff08;color:#f6be94;font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
  '.chips{margin-top:12px;display:flex;flex-wrap:wrap;justify-content:center;gap:6px}',
  '.chips span{padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:#d2b69f;font-size:11px}',
  '.status{margin-top:22px;color:var(--muted);font-size:12px;min-height:1.5em}',
  '.button{margin-top:12px;display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:46px;padding:10px 22px;border-radius:5px;font-size:13px;font-weight:600;text-decoration:none;transition:transform .15s,box-shadow .15s}',
  '.primary{color:#fff;background:linear-gradient(110deg,#ec944f,#c87b3f);border:1px solid #eeb48670;box-shadow:inset 0 1px #ffdaba22,0 6px 27px #ce87501d}',
  '.primary:hover{background:linear-gradient(110deg,#f6a565,#d98c4f);transform:translateY(-1px);box-shadow:0 7px 27px #e3a26e2f}',
  'a:focus-visible{outline:2px solid #ffa94d;outline-offset:3px}',
  '.hint{margin-top:18px;color:var(--muted);font-size:12px}',
  '.hint a{color:#f6be94;text-decoration:underline;text-underline-offset:3px}',
  '@media (prefers-reduced-motion:reduce){.button{transition:none}}',
].join('');

// Nothing from the address ends up in this script – it reads the link from the button.
const JOIN_SCRIPT =
  '(function(){var a=document.getElementById("open"),s=document.getElementById("status");if(!a)return;' +
  'setTimeout(function(){window.location.href=a.getAttribute("href")},300);' +
  'setTimeout(function(){if(s)s.textContent="Launcher się nie otworzył? Kliknij przycisk poniżej."},3000)})();';

const sha256 = (text) => `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;
/** Only this page's own style and script run, whatever a link puts in the address. */
const JOIN_CSP = `default-src 'none'; img-src 'self'; style-src ${sha256(JOIN_STYLE)}; script-src ${sha256(JOIN_SCRIPT)}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** The page's HTML for this address – everything taken from the query is escaped. */
function joinHtml(url) {
  const link = `hammer://join${url.search}`;
  const name = param(url, 'name', 60);
  const address = param(url, 'server', 100);
  const mc = param(url, 'mc', 12);
  const loader = LOADER_NAMES[param(url, 'loader', 12).toLowerCase()];
  const chips = [MC_VERSION.test(mc) && `Minecraft ${mc}`, loader].filter(Boolean);
  const heading = name ? `Dołącz do serwera <span>${esc(name)}</span>` : address ? 'Dołącz do serwera' : 'Otwórz Hammer Launcher';
  const own = profile.launcher; // Hammer Launcher's own site: its name and the H, no shop
  const title = name || address ? `Dołącz do serwera ${name || address} – Hammer Launcher` : own ? 'Hammer Launcher' : 'Hammer Launcher – HammerShop';
  return (
    '<!doctype html>\n<html lang="pl"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="theme-color" content="#0e0b09"><meta name="color-scheme" content="dark">' +
    `<title>${esc(title)}</title><link rel="icon" href="/assets/${own ? 'launcher-icon' : 'hammershop-icon'}.png"><style>${JOIN_STYLE}</style></head>` +
    '<body><main class="card">' +
    (own ? '<a class="logo h" href="/" aria-label="Hammer Launcher – strona główna"><i aria-hidden="true"></i>Hammer<b>Launcher</b></a>' : '<a class="logo" href="/" aria-label="HammerShop – strona główna"><i aria-hidden="true"></i>Hammer<b>Shop</b></a>') +
    '<p class="eyebrow">HAMMER LAUNCHER</p>' +
    `<h1>${heading}</h1>` +
    (address ? `<p class="address"><code>${esc(address)}</code></p>` : '') +
    (chips.length ? `<p class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</p>` : '') +
    '<p class="status" id="status" role="status">Otwieramy Hammer Launcher…</p>' +
    `<a class="button primary" id="open" href="${esc(link)}">Otwórz w Hammer Launcherze</a>` +
    (own ? '<p class="hint">Nie masz launchera? <a href="/">Pobierz go za darmo</a></p>' : '<p class="hint">Nie masz launchera? <a href="/">Przejdź na stronę HammerShop</a></p>') +
    `</main><script>${JOIN_SCRIPT}</script></body></html>\n`
  );
}

/** GET /join – h: { send } (adds the website's security headers). */
function join(req, res, url, { send }) {
  return send(res, 200, joinHtml(url), { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': JOIN_CSP });
}

module.exports = { api, join, joinHtml, feed, launcherVersion, onlineNow, setProfileFetch, CAPES, FREE_CAPES, CLOUD_LIMIT, MAX_UUIDS, PRESENCE_MS, PREFIX };
