'use strict';

/**
 * „Aktualności” on the home screen, the message bar at the top of the window and what the shop says about the
 * newest launcher version – all from one public call of the shop API (shopapi.js → getNews):
 *
 *   GET <shop API>/news  →  {
 *     news:    [{ id, title, body, tag, date, at, url, image, pinned }],     already sorted: pinned first, then newest
 *     alert:   { id, level: info | warning | critical, text, url, until } | null,
 *     release: { version, notes, date, minVersion, size, url } | null
 *   }
 *
 * Everything in the answer is untrusted text: each field is checked or cut to its length here, the window shows
 * it as text only, and links count only when they are https. When the shop is not reachable (or has no news)
 * the home screen keeps the built-in tips; nothing here ever errors or holds anything up.
 *
 * launcher.config.json → newsUrl still works: a JSON list ([{ title, body, date, tag, image, url }]) from any
 * address replaces the list of the shop (its messages and release still come from the shop). No Electron here.
 */

const crypto = require('node:crypto');
const { line, block, httpsUrl } = require('./text');
const { parseVersion } = require('./selfupdate');

const BUILT_IN = [
  { title: 'Witaj w Hammer Launcherze!', body: 'Zaloguj się kontem Microsoft, wybierz instancję i kliknij GRAJ. Launcher sam pobierze grę, Javę i mody.', date: null, tag: 'Start' },
  { title: 'Jedno kliknięcie – więcej FPS', body: 'Zakładka Optymalizacja dobiera RAM, flagi Javy i mody wydajnościowe (Sodium, Lithium, FerriteCore…) pod Twoją wersję gry.', date: null, tag: 'Wydajność' },
  { title: 'Tysiące modów w zakładce Mody', body: 'Szukaj modów, paczek tekstur, shaderów i całych paczek modów z Modrinth – zależności instalują się same.', date: null, tag: 'Mody' },
];

const MAX_NEWS = 12;
const LIMITS = { title: 120, body: 600, tag: 24, date: 40, alert: 300, notes: 2000 };
const LEVELS = ['info', 'warning', 'critical'];
const REFRESH_EVERY = 10 * 60 * 1000;
const MIN_INTERVAL = 60 * 1000; // the shop is never asked more often than once a minute
const FIRST_WAIT = 1500; // how long the first screen waits for the shop before it shows the built-in tips

function clean(item) {
  const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const url = typeof item.url === 'string' && /^https:\/\//.test(item.url) ? item.url : null;
  const image = typeof item.image === 'string' && /^https:\/\//.test(item.image) ? item.image : null;
  return { title: text(item.title, 120) ?? 'Aktualność', body: text(item.body, 600) ?? '', date: text(item.date, 40), tag: text(item.tag, 24), url, image };
}

async function loadNews(url, { fetchFn = (...a) => fetch(...a), timeout = 6000 } = {}) {
  if (!url) return BUILT_IN;
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeout), headers: { accept: 'application/json' } });
    if (!res.ok) return BUILT_IN;
    const data = await res.json();
    const list = (Array.isArray(data) ? data : data?.news ?? []).slice(0, 12).map(clean);
    return list.length ? list : BUILT_IN;
  } catch {
    return BUILT_IN;
  }
}

/* ── the shop's answer, field by field ── */

const stamp = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1e14 ? Math.round(v) : null);
const ident = (v) => (typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(v) ? v : null);

/** One news item of the shop – null when it has neither a title nor a text. */
function cleanItem(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = line(raw.title, LIMITS.title);
  const body = block(raw.body, LIMITS.body);
  if (!title && !body) return null;
  return { id: ident(raw.id), title: title || 'Aktualność', body, tag: line(raw.tag, LIMITS.tag) || null, date: line(raw.date, LIMITS.date) || null, at: stamp(raw.at), url: httpsUrl(raw.url), image: httpsUrl(raw.image), pinned: raw.pinned === true };
}

/**
 * The message for the bar at the top of the window – null when there is none, it has no text, or its time is up.
 * A message without an id gets one made of its text, so closing it still sticks.
 */
function cleanAlert(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const text = line(raw.text, LIMITS.alert);
  if (!text) return null;
  const until = stamp(raw.until);
  if (until != null && until <= now) return null;
  const level = LEVELS.includes(raw.level) ? raw.level : 'info';
  return { id: ident(raw.id) ?? `a_${crypto.createHash('sha1').update(`${level}\n${text}`).digest('hex').slice(0, 12)}`, level, text, url: httpsUrl(raw.url), until };
}

/** The newest launcher version as the shop announces it – null without a proper version number. */
function cleanRelease(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !parseVersion(raw.version)) return null;
  const date = typeof raw.date === 'string' && raw.date.length <= 40 ? Date.parse(raw.date) : NaN;
  return {
    version: raw.version.trim().replace(/^v/, ''),
    notes: block(raw.notes, LIMITS.notes) || null,
    date: Number.isFinite(date) ? date : null,
    minVersion: parseVersion(raw.minVersion) ? raw.minVersion.trim().replace(/^v/, '') : null,
    size: typeof raw.size === 'number' && Number.isFinite(raw.size) && raw.size > 0 ? Math.round(raw.size) : null,
    url: httpsUrl(raw.url),
  };
}

/** The whole answer: { news, alert, release }. */
function cleanFeed(body, now = Date.now()) {
  const list = Array.isArray(body?.news) ? body.news : [];
  return { news: list.slice(0, MAX_NEWS * 3).map(cleanItem).filter(Boolean).slice(0, MAX_NEWS), alert: cleanAlert(body?.alert, now), release: cleanRelease(body?.release) };
}

/* ── which message the player has closed ── */

/** Is this message on the screen? Not when its time is up, and not when the player closed it – a critical one cannot be closed. */
function alertVisible(alert, { closed = '', now = Date.now() } = {}) {
  if (!alert || typeof alert.text !== 'string' || !alert.text) return false;
  if (alert.until != null && alert.until <= now) return false;
  return alert.level === 'critical' || !closed || alert.id !== closed;
}

/** What closing a message stores (the setting `closedAlert`): its id – it stays closed until the id changes. A critical one stays open. */
function closeAlert(alert, closed = '') {
  return alert && alert.level !== 'critical' && typeof alert.id === 'string' ? alert.id : closed;
}

/** The time of the newest item of a list (0 when no item says when it was written) – what „nowe” is measured against. */
function newestAt(news) {
  return (Array.isArray(news) ? news : []).reduce((max, n) => (typeof n?.at === 'number' && n.at > max ? n.at : max), 0);
}

/**
 * The feed the window reads: `api` is the shop API client (base, getNews). current() answers what is known –
 * { news, source: 'shop' | 'custom' | 'builtin', alert, release, ok, fetchedAt } – and never throws; `ok` says
 * whether the shop answered the last time it was asked.
 */
function createNewsFeed({ api, config = {}, fetchFn = (...a) => fetch(...a), now = () => Date.now(), onChange = () => {}, minInterval = MIN_INTERVAL, every = REFRESH_EVERY, firstWait = FIRST_WAIT }) {
  let state = { news: BUILT_IN.map((n) => ({ ...n })), source: 'builtin', alert: null, release: null, ok: false, fetchedAt: null };
  let shopNews = null; // the last good list of the shop – it stays while the shop is away for a moment
  let askedAt = null;
  let running = null;
  let timer = null;
  let seen = JSON.stringify({ ...state, fetchedAt: null });

  const snapshot = () => ({
    ...state,
    news: state.news.map((n) => ({ ...n })),
    alert: state.alert && alertVisible(state.alert, { now: now() }) ? { ...state.alert } : null,
    release: state.release ? { ...state.release } : null,
  });

  async function load() {
    const fromShop = async () => {
      if (!api?.base?.()) return null;
      try {
        return cleanFeed(await api.getNews(), now());
      } catch {
        return null; // the shop is not online (yet)
      }
    };
    const [shop, custom] = await Promise.all([fromShop(), config.newsUrl ? loadNews(config.newsUrl, { fetchFn }).catch(() => BUILT_IN) : null]);
    if (shop?.news.length) shopNews = shop.news;
    else if (shop) shopNews = null; // the shop answered: it has no news now
    const next = { ...state, ok: Boolean(shop), fetchedAt: now() };
    if (custom) Object.assign(next, { news: custom.map((n) => ({ ...n })), source: custom === BUILT_IN ? 'builtin' : 'custom' });
    else if (shopNews) Object.assign(next, { news: shopNews, source: 'shop' });
    else Object.assign(next, { news: BUILT_IN.map((n) => ({ ...n })), source: 'builtin' });
    // The message and the release are the shop's last word; while it does not answer, the last known ones stay.
    if (shop) Object.assign(next, { alert: shop.alert, release: shop.release });
    state = next;
    const text = JSON.stringify({ ...snapshot(), fetchedAt: null });
    if (text !== seen) {
      seen = text;
      try {
        onChange(snapshot());
      } catch {
        // a listener that fails must not stop the feed
      }
    }
    return snapshot();
  }

  /** Asks the shop again – at most once a minute (`force`: now, e.g. „Sprawdź teraz”). Never throws. */
  function refresh({ force = false } = {}) {
    if (running) return running;
    if (!force && askedAt != null && now() - askedAt < minInterval) return Promise.resolve(snapshot());
    askedAt = now();
    running = load()
      .catch(() => snapshot())
      .finally(() => (running = null));
    return running;
  }

  /**
   * What the window shows now. The very first time it waits a moment for the shop (so the built-in tips do not
   * flash by) – but never long: after `firstWait` it answers with what there is, and onChange brings the rest.
   */
  async function current() {
    if (state.fetchedAt != null) return snapshot();
    let timeout;
    const wait = new Promise((resolve) => (timeout = setTimeout(resolve, firstWait)));
    await Promise.race([refresh(), wait]);
    clearTimeout(timeout);
    return snapshot();
  }

  return {
    current,
    refresh,
    peek: snapshot,
    /** A quiet look every ten minutes (main.js adds one whenever the window gets the focus back). */
    start() {
      if (timer) return;
      timer = setInterval(() => refresh(), every);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { loadNews, BUILT_IN, cleanItem, cleanAlert, cleanRelease, cleanFeed, alertVisible, closeAlert, newestAt, createNewsFeed, LIMITS, MAX_NEWS, REFRESH_EVERY, MIN_INTERVAL };
