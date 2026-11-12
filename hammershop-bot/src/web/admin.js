'use strict';

/**
 * The admin panel's API (the page is web/public/admin.html) – /api/admin/*. Only for people signed in through Discord
 * who run the shop: the bot says who they are (h.level(userId) → 'owner' | 'admin' | null):
 *
 *   owner  the server's owner and OWNER_IDS – everything, including what reaches every player's computer or costs
 *          money: launcher releases and the Hammer+ price list
 *   admin  the bot's admins (CEO … Administrator roles) – news, the alert bar, featured servers, Hammer+ codes,
 *          orders and statistics
 *
 *   GET    me                    → { user, level }
 *   GET    overview              → numbers for the dashboard
 *   GET    news                  POST news            PUT news/<id>          DELETE news/<id>
 *   GET    alert                 PUT alert            DELETE alert
 *   GET    releases              → { current, list, files (in data/releases/, not published), maxMb }
 *   PUT    releases/file?name=   (owner) the request body is the installer / .blockmap → { name, size }
 *   DELETE releases/file?name=   (owner) an uploaded file that is not part of a release
 *   POST   releases              (owner) { version, file, blockmap?, notes?, minVersion?, signature?, discord? }
 *   POST   releases/current      (owner) { version | null } – switch back to an older release, or hide the download
 *   DELETE releases/<version>    (owner)
 *   GET    plus                  → { ready, publicKey, plans, grants }
 *   POST   plus/grant            { nick, days } → { code, record }        POST plus/check { code }
 *   PUT    plus/plans            (owner) { plans: [{ id?, name, days, price }] }
 *   GET    featured              POST featured        DELETE featured/<id>
 *   GET    orders                → the newest website orders
 *
 * Every change must come from the panel itself (the Origin header is required and must be this site), and each one is
 * written to the bot's log channel with who did it.
 */

const store = require('./store');
const releases = require('./releases');
const plusLib = require('../lib/plus');

const PREFIX = '/api/admin/';
const LEVELS = ['info', 'warning', 'critical'];
const MAX_PLANS = 8;
const MAX_PLAN_PRICE = 100_000_00; // in the smallest unit
const problem = (status, message) => Object.assign(new Error(message), { status });

/** One line of text: control and direction characters out, spaces squeezed, cut to max. */
const line = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
/** Text that may have line breaks. */
const block = (value, max) => String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

function httpsUrl(value, what) {
  const text = line(value, 500);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw problem(400, `${what}: to nie jest poprawny adres.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw problem(400, `${what}: adres musi zaczynać się od https://`);
  return url.href;
}

/** "12.11.2026" – the date as the shop's customers write it. */
const plDate = (ms) => new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Warsaw' }).format(new Date(ms));

/** A news item as the launcher and the launcher page get it. */
const publicNews = (n) => ({ id: n.id, title: n.title, body: n.body, tag: n.tag ?? null, date: plDate(n.at), at: n.at, url: n.url ?? null, image: n.image ?? null, pinned: Boolean(n.pinned) });
const publicAlert = (a) => (a ? { id: a.id, level: a.level, text: a.text, url: a.url ?? null, until: a.until ?? null } : null);

function newsFields(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.title !== undefined) {
    out.title = line(body.title, 120);
    if (!out.title) throw problem(400, 'Wpisz tytuł aktualności.');
  }
  if (!partial || body.body !== undefined) out.body = block(body.body, 600);
  if (!partial || body.tag !== undefined) out.tag = line(body.tag, 24) || null;
  if (!partial || body.url !== undefined) out.url = httpsUrl(body.url, 'Link');
  if (!partial || body.image !== undefined) out.image = httpsUrl(body.image, 'Obrazek');
  if (!partial || body.pinned !== undefined) out.pinned = Boolean(body.pinned);
  return out;
}

function planFields(raw, used) {
  const name = line(raw?.name, 60);
  const days = Number(raw?.days);
  const price = Number(raw?.price);
  if (!name) throw problem(400, 'Każdy plan Hammer+ potrzebuje nazwy.');
  if (!Number.isInteger(days) || days < 0 || days > plusLib.MAX_DAYS) throw problem(400, `Plan „${name}”: liczba dni od 0 (na zawsze) do ${plusLib.MAX_DAYS}.`);
  if (!Number.isInteger(price) || price < 50 || price > MAX_PLAN_PRICE) throw problem(400, `Plan „${name}”: cena musi wynosić co najmniej 0,50.`);
  const wanted = /^[a-z0-9-]{1,24}$/.test(String(raw?.id ?? '')) ? String(raw.id) : `p${days || 'x'}`;
  let id = wanted;
  for (let n = 2; used.has(id); n += 1) id = `${wanted.slice(0, 20)}-${n}`;
  used.add(id);
  return { id, name, days, price };
}

/** Sums for the dashboard out of the day counters: the last `days` days, oldest first. */
function series(map, days, pick = (v) => v ?? 0, now = Date.now()) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = store.dayOf(now - i * 86_400_000);
    out.push({ day, value: pick(map[day]) });
  }
  return out;
}

function overview(h) {
  const now = Date.now();
  const st = store.stats();
  const orders = store.allOrders().filter((o) => o.status === 'paid');
  const since = (days) => orders.filter((o) => (o.paidAt ?? o.created * 1000) > now - days * 86_400_000);
  const sum = (list) => list.reduce((s, o) => s + o.amount, 0);
  const launches = series(st.launches, 14, (v) => v?.unique ?? 0, now);
  const today = st.launches[store.dayOf(now)] ?? { total: 0, unique: 0, versions: {} };
  const state = store._state();
  return {
    release: releases.publicInfo(h.publicUrl()),
    downloads: { days: series(st.downloads, 14, undefined, now), total30: series(st.downloads, 30, undefined, now).reduce((s, d) => s + d.value, 0) },
    launches: { days: launches, today: today.unique, versions: today.versions },
    orders: { paid7: since(7).length, revenue7: sum(since(7)), paid30: since(30).length, revenue30: sum(since(30)), currency: h.currency() },
    accounts: { users: Object.keys(state.users).length, cloud: Object.keys(state.cloud).length, capes: Object.keys(state.capes).length },
    plus: { ready: plusLib.ready(), active: h.plus.active(), plans: store.plusPlans().length },
    news: store.newsList().length,
    alert: publicAlert(store.getAlert(now)),
    setup: { auth: h.authReady(), payments: h.paymentsReady(), webhook: h.webhookReady(), publicUrl: h.publicUrl() },
  };
}

/** A release as the panel lists it. */
const releaseJson = (r, current) => ({ version: r.version, file: r.file, blockmap: r.blockmap ?? null, size: r.size, signed: Boolean(r.signature), notes: r.notes ?? '', minVersion: r.minVersion ?? null, at: r.at, by: r.by ?? null, downloads: r.downloads ?? 0, current: r.version === current });

function orderRow(o) {
  const user = store._state().users[o.userId];
  return {
    id: o.id, kind: o.kind, status: o.status, amount: o.amount, currency: o.currency, created: o.created * 1000, paidAt: o.paidAt ?? null,
    user: user ? { id: user.id, name: user.name ?? user.username } : { id: o.userId, name: null },
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
    ticketUrl: o.ticketUrl ?? null, delivered: Boolean(o.delivered), plusNick: o.plus?.nick ?? null,
  };
}

/** name → when the console last said how far that upload is (one line every few seconds, not one per piece). */
const uploadSaid = new Map();

/**
 * /api/admin/… – h: the website's helpers { send, fail, jsonBody, userOf, limited, originOk } and the bot's side
 * { level, announce, log, plus { grant, recent, inspect, active }, featured { list, add, remove }, currency,
 *   publicUrl, authReady, paymentsReady, webhookReady }.
 */
async function api(req, res, url, h) {
  const route = url.pathname.slice(PREFIX.length).replace(/\/+$/, '');
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (h.limited(req, 'admin', 240)) return h.fail(res, 429, 'Zwolnij trochę i spróbuj ponownie.');
  const user = h.userOf(req);
  if (!user) return h.fail(res, 401, 'Zaloguj się przez Discord.');
  const level = await h.level(user.id);
  if (!level) return h.fail(res, 403, 'To konto nie ma dostępu do panelu. Panel jest dla właściciela i administratorów serwera HammerShop.');
  const owner = level === 'owner';
  const ownerOnly = () => {
    if (!owner) throw problem(403, 'To może zrobić tylko właściciel sklepu.');
  };
  if (method !== 'GET' && !h.originOk(req)) return h.fail(res, 403, 'Żądanie odrzucone.');
  const who = `<@${user.id}>`;
  const log = (text) => Promise.resolve(h.log(`${text} · ${who}`)).catch(() => null);
  const [head, ...rest] = route.split('/');
  let arg = null;
  try {
    arg = rest.length ? decodeURIComponent(rest.join('/')) : null;
  } catch {
    return h.fail(res, 404, 'Nie znaleziono'); // a broken %-escape names nothing
  }

  if (method === 'GET') {
    if (route === 'me') return h.send(res, 200, { user: { id: user.id, name: user.name ?? user.username, avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null }, level });
    if (route === 'overview') return h.send(res, 200, overview(h));
    if (route === 'news') return h.send(res, 200, { news: store.newsList().map((n) => ({ ...publicNews(n), by: n.by ?? null, discord: n.discord ?? null })) });
    if (route === 'alert') return h.send(res, 200, { alert: publicAlert(store.getAlert()) });
    if (route === 'releases') {
      const current = store.currentRelease()?.version ?? null;
      const list = store.releases();
      const used = new Set(list.flatMap((r) => [r.file, r.blockmap]).filter(Boolean));
      return h.send(res, 200, { current, list: list.map((r) => releaseJson(r, current)), files: releases.filesOnDisk().filter((f) => !used.has(f.name)).map((f) => ({ name: f.name, size: f.size })), maxMb: Number(process.env.RELEASE_MAX_MB) || 700, diskFree: releases.diskFree(), canEdit: owner });
    }
    // Where an upload that broke off goes on (the same file chosen again in the panel).
    if (route === 'releases/file') {
      ownerOnly();
      return h.send(res, 200, { offset: releases.resumeAt(url.searchParams.get('name') ?? '', Number(url.searchParams.get('total')), url.searchParams.get('key')) });
    }
    if (route === 'plus') return h.send(res, 200, { ready: plusLib.ready(), publicKey: plusLib.ready() ? plusLib.publicKey() : null, plans: store.plusPlans(), grants: h.plus.recent(), currency: h.currency(), canEdit: owner });
    if (route === 'featured') return h.send(res, 200, { servers: h.featured.list() });
    if (route === 'orders') return h.send(res, 200, { orders: store.allOrders().filter((o) => o.stripe_id || o.status === 'paid').slice(0, 100).map(orderRow) });
    return h.fail(res, 404, 'Nie znaleziono');
  }

  // ── Uploads: the body is the file itself ──
  if (head === 'releases' && arg === 'file') {
    ownerOnly();
    const name = url.searchParams.get('name') ?? '';
    if (method === 'PUT') {
      // ?offset=&total= – one piece of the file (the panel sends big installers a few MB at a time).
      const piece = url.searchParams.has('offset') || url.searchParams.has('total') ? { offset: Number(url.searchParams.get('offset') ?? NaN), total: Number(url.searchParams.get('total') ?? NaN), key: url.searchParams.get('key') } : null;
      // The server's console tells the story of an upload: when it started, how far it is, why it stopped.
      const say = releases.isFileName(name) ? (text, warn = false) => console[warn ? 'warn' : 'log'](`[web] wgrywanie ${name}: ${text}`) : () => {};
      const mb = (n) => `${Math.round(n / 1024 / 1024)} MB`;
      if (piece?.offset === 0) say(`start (${mb(piece.total)})`);
      let saved;
      try {
        saved = await releases.receive(req, name, piece);
      } catch (err) {
        say(`${err.message}${piece ? ` (przy ${mb(piece.offset)})` : ''}`, true);
        if (err.offset === undefined) throw err;
        return h.send(res, 409, { error: err.message, offset: err.offset }); // the panel goes on from where the server is
      }
      if (saved.done === false) {
        if (Date.now() - (uploadSaid.get(name) ?? 0) > 5000) {
          uploadSaid.set(name, Date.now());
          say(`${mb(saved.offset)} z ${mb(piece.total)}`);
        }
        return h.send(res, 200, saved);
      }
      // The last piece sent twice (its first answer got lost): the file was announced already.
      if (saved.repeated) return h.send(res, 200, { name: saved.name, size: saved.size, done: true, republished: null });
      uploadSaid.delete(name);
      say(`gotowe (${mb(saved.size)})`);
      // A new build under the name of a published release: its record follows the file (an old signature no longer fits).
      const stale = store.releases().find((r) => r.file === saved.name);
      if (stale) await releases.publish({ ...stale, signature: null, makeCurrent: false });
      await log(`📦 Wgrano plik launchera \`${saved.name}\` (${Math.round(saved.size / 1024 / 1024)} MB)`);
      return h.send(res, 200, { ...saved, republished: stale?.version ?? null });
    }
    if (method === 'DELETE') {
      if (!releases.isFileName(name)) return h.fail(res, 400, 'Nieprawidłowa nazwa pliku.');
      if (store.releases().some((r) => r.file === name || r.blockmap === name)) return h.fail(res, 409, 'Ten plik należy do opublikowanej wersji – usuń wersję.');
      require('node:fs').rmSync(releases.fileOf(name), { force: true });
      return h.send(res, 200, { ok: true });
    }
    return h.fail(res, 405, 'Niedozwolona metoda');
  }

  const body = method === 'DELETE' ? {} : await h.jsonBody(req);

  // ── News ──
  if (head === 'news') {
    if (method === 'POST' && !arg) {
      const item = store.addNews({ ...newsFields(body), by: user.id });
      if (body.discord) {
        const posted = await Promise.resolve(h.announce({ kind: 'news', title: item.title, body: item.body, url: item.url, image: item.image, tag: item.tag })).catch(() => null);
        if (posted?.url) store.updateNews(item.id, { discord: posted.url });
      }
      await log(`📰 Nowa aktualność w launcherze: **${item.title}**`);
      return h.send(res, 200, { item: publicNews(store.getNews(item.id)), discord: store.getNews(item.id).discord ?? null });
    }
    if (method === 'PUT' && arg) {
      const item = store.updateNews(arg, newsFields(body, { partial: true }));
      if (!item) return h.fail(res, 404, 'Nie ma takiej aktualności.');
      await log(`📰 Zmieniono aktualność: **${item.title}**`);
      return h.send(res, 200, { item: publicNews(item) });
    }
    if (method === 'DELETE' && arg) {
      const item = store.getNews(arg);
      if (!item || !store.removeNews(arg)) return h.fail(res, 404, 'Nie ma takiej aktualności.');
      await log(`📰 Usunięto aktualność: **${item.title}**`);
      return h.send(res, 200, { ok: true });
    }
  }

  // ── The alert bar ──
  if (route === 'alert') {
    if (method === 'DELETE') {
      store.setAlert(null);
      await log('🔔 Wyłączono komunikat w launcherze');
      return h.send(res, 200, { alert: null });
    }
    if (method === 'PUT') {
      const text = line(body.text, 240);
      if (!text) return h.fail(res, 400, 'Wpisz treść komunikatu.');
      if (!LEVELS.includes(body.level)) return h.fail(res, 400, 'Wybierz rodzaj komunikatu: informacja, ostrzeżenie albo ważne.');
      const hours = body.hours == null || body.hours === '' ? null : Number(body.hours);
      if (hours !== null && !(Number.isFinite(hours) && hours > 0 && hours <= 24 * 60)) return h.fail(res, 400, 'Czas wyświetlania: od 1 godziny do 60 dni – albo puste pole (do odwołania).');
      const alert = store.setAlert({ level: body.level, text, url: httpsUrl(body.url, 'Link'), until: hours ? Date.now() + Math.round(hours * 3_600_000) : null, by: user.id });
      await log(`🔔 Komunikat w launcherze (${alert.level}): ${alert.text}`);
      return h.send(res, 200, { alert: publicAlert(alert) });
    }
  }

  // ── Launcher releases (owner) ──
  if (head === 'releases') {
    ownerOnly();
    if (method === 'POST' && !arg) {
      const release = await releases.publish({
        version: line(body.version, 40), file: line(body.file, 160), blockmap: line(body.blockmap, 160) || null, notes: block(body.notes, 4000),
        minVersion: line(body.minVersion, 40) || null, signature: line(body.signature, 120) || null, by: user.id,
      });
      if (body.discord) {
        await Promise.resolve(h.announce({ kind: 'release', title: `Hammer Launcher ${release.version}`, body: release.notes, url: `${h.publicUrl()}/launcher`, version: release.version })).catch(() => null);
      }
      await log(`🚀 Opublikowano Hammer Launcher **${release.version}** (\`${release.file}\`${release.signature ? ', podpisany' : ''}${release.minVersion ? `, wymagana co najmniej ${release.minVersion}` : ''})`);
      return h.send(res, 200, { release: releaseJson(release, store.currentRelease()?.version ?? null) });
    }
    if (method === 'POST' && arg === 'current') {
      const version = body.version == null ? null : line(body.version, 40);
      if (version !== null && !store.getRelease(version)) return h.fail(res, 404, 'Nie ma takiej wersji.');
      store.setCurrentRelease(version);
      await log(version ? `🚀 Aktualną wersją launchera jest teraz **${version}**` : '🚀 Ukryto pobieranie launchera (brak aktualnej wersji)');
      return h.send(res, 200, { current: version });
    }
    if (method === 'DELETE' && arg) {
      if (!releases.remove(arg)) return h.fail(res, 404, 'Nie ma takiej wersji.');
      await log(`🚀 Usunięto wersję launchera **${arg}**`);
      return h.send(res, 200, { ok: true });
    }
  }

  // ── Hammer+ ──
  if (head === 'plus') {
    if (method === 'POST' && arg === 'grant') {
      const days = Number(body.days);
      const { code, record } = await h.plus.grant({ nick: line(body.nick, 20), days, by: user.id });
      await log(`🔨 Kod Hammer+ dla \`${record.nick}\` (${days ? `${days} dni` : 'na zawsze'}) wystawiony w panelu`);
      return h.send(res, 200, { code, record });
    }
    if (method === 'POST' && arg === 'check') return h.send(res, 200, h.plus.inspect(line(body.code, 600)));
    if (method === 'PUT' && arg === 'plans') {
      ownerOnly();
      const list = Array.isArray(body.plans) ? body.plans : null;
      if (!list || list.length > MAX_PLANS) return h.fail(res, 400, `Najwyżej ${MAX_PLANS} planów.`);
      const used = new Set();
      const plans = store.setPlusPlans(list.map((p) => planFields(p, used)));
      await log(`🔨 Cennik Hammer+ na stronie: ${plans.length ? plans.map((p) => `${p.name} – ${(p.price / 100).toFixed(2)}`).join(' · ') : 'sprzedaż wyłączona'}`);
      return h.send(res, 200, { plans });
    }
  }

  // ── Featured servers ──
  if (head === 'featured') {
    if (method === 'POST' && !arg) {
      const server = await h.featured.add({ name: line(body.name, 60), address: line(body.address, 100), description: line(body.description, 200), tags: line(body.tags, 120) || null, icon: line(body.icon, 300) || null, mc: line(body.mc, 12) || null, loader: line(body.loader, 12) || null, pack: line(body.pack, 64) || null }, user.id);
      await log(`⭐ Polecany serwer w launcherze: **${server.name}** (\`${server.address}\`)`);
      return h.send(res, 200, { server });
    }
    if (method === 'DELETE' && arg) {
      const removed = await h.featured.remove(arg);
      if (!removed) return h.fail(res, 404, 'Nie ma takiego serwera na liście.');
      await log(`⭐ Usunięto polecany serwer: **${removed.name}**`);
      return h.send(res, 200, { ok: true });
    }
  }

  return h.fail(res, 404, 'Nie znaleziono');
}

module.exports = { api, PREFIX, publicNews, publicAlert, plDate, line, block, httpsUrl };
