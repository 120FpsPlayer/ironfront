'use strict';

/**
 * The store website, served by the bot (src/features/website.js starts it). The page (web/public/index.html) talks
 * to this API under /api/shop/:
 *
 *   GET  store            products (the bot's shop), what's switched on, the Discord invite, the currency
 *   GET  session          the signed-in Discord user (signing in is all it takes to buy – there is no access fee)
 *   GET  auth/start       → Discord sign-in;  auth/callback  ← back from Discord (sets the session cookie; the bot adds
 *                         the user to the HammerShop server with the Member role – onLogin)
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
 *
 * Hammer Launcher has its own corner here: /api/launcher/* (featured servers, news, Hammer+ cloud sync and capes) and
 * the /join page – see src/web/launcher.js. Its page is /launcher (web/public/launcher.html): the download button
 * (GET /download → the installer in /updates/, which is also where the launcher's own updater looks – see
 * src/web/releases.js), the news, and Hammer+ bought by card:
 *
 *   GET  plus             { ready, plans [{ id, name, days, price }], currency } – the price list from the admin panel
 *   POST checkout         { kind: 'plus', plan, nick, requestId } → { url } – the nick is checked at Mojang first; once
 *                         paid, the bot issues the code for that Minecraft account (onPaid) and the order shows it
 *
 * Downloading the launcher from the website needs a Discord sign-in, like buying Hammer+: /download without a session
 * goes through Discord and back to /launcher?download=1, where the page starts the download itself (the sign-in never
 * ends on a file – the browser would stay on Discord's page). Where sign-in is not set up, /download just downloads.
 * /updates/* – the launcher's own updater – never asks for anything. „Zaproś znajomego” (/r/<code>, GET referrals,
 * POST referrals/claim) is in src/web/referrals.js.
 *
 * The admin panel is /admin (web/public/admin.html) with its API under /api/admin/ – see src/web/admin.js.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { env } = require('../env');
const store = require('./store');
const stripe = require('./stripe');
const discord = require('./discord');
const launcher = require('./launcher');
const admin = require('./admin');
const releases = require('./releases');
const referrals = require('./referrals');
const plusLib = require('../lib/plus');
const profile = require('../lib/profile');
const config = require('../lib/config');

const PUBLIC = path.join(__dirname, '..', '..', 'web', 'public');
const STRIPE_MIN = 50; // Stripe's smallest charge in EUR cents
const MAX_QTY = 10;
const web = () => env.web;
const secure = () => web().publicUrl.startsWith('https://');
const authReady = () => Boolean(discord.clientId() && web().clientSecret && web().publicUrl);
const paymentsReady = () => Boolean(env.stripeKey && web().publicUrl);
const webhookReady = () => Boolean(web().stripeWebhookSecret);
const plusOnSale = () => plusLib.ready() && paymentsReady() && authReady() && store.plusPlans().length > 0;

// ───────────── Products ─────────────
/** Set by createWebServer: { catalog, info, onPaid, onLogin, isMember, currency, featured, level, announce, log, plus, featuredAdmin }. */
/** The bot's own "the user did something wrong" errors (lib/utils.js UserError) – their text is written for Discord. */
const isUserError = (err) => err?.constructor?.name === 'UserError';
const plainMessage = (err) => String(err.message).replace(/\*\*|__|`/g, '');
const notConnected = async () => {
  throw Object.assign(new Error('Bot nie jest jeszcze połączony z Discordem – spróbuj ponownie za chwilę.'), { status: 503 });
};
let hooks = {
  catalog: () => [], info: () => ({}), onPaid: async () => null, onLogin: async () => null, isMember: () => null, currency: () => 'eur', featured: () => [],
  // The admin panel and Hammer+ sales (src/features/website.js fills these in):
  level: async () => null, // (userId) → 'owner' | 'admin' | null
  announce: async () => null, // ({ kind, title, body, url, image, tag, version }) → { url } – posted on Discord
  log: async () => null, // (text) → the bot's log channel
  plus: { lookup: notConnected, grant: notConnected, recent: () => [], inspect: () => ({ valid: false, message: 'Bot nie jest połączony.' }), active: () => 0 },
  featuredAdmin: { list: () => [], add: notConnected, remove: notConnected },
  referrals: { claim: notConnected }, // (user, nick) → { code, nick, until, days } – the referral balance as a code
};
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
      .map(([k, ...v]) => {
        // One broken cookie of some other page on this domain ("x=100%") must not break every request.
        try {
          return [k, decodeURIComponent(v.join('='))];
        } catch {
          return null;
        }
      })
      .filter(Boolean),
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
        reject(Object.assign(new Error('Za duże zapytanie.'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function jsonBody(req) {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) throw Object.assign(new Error('Wyślij dane w formacie JSON.'), { status: 415 });
  const raw = await readBody(req);
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Nieprawidłowy JSON.'), { status: 400 });
  }
}

/** POSTs from other sites are refused (the session cookie is SameSite=Lax too). */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = [web().publicUrl, `http://${req.headers.host}`, `https://${req.headers.host}`].filter(Boolean);
  return allowed.includes(origin);
}

/** A change made in the admin panel must come from the panel: the browser's Origin header is required and must be this site. */
function originOk(req) {
  const origin = req.headers.origin;
  return Boolean(origin) && [web().publicUrl, `http://${req.headers.host}`, `https://${req.headers.host}`].filter(Boolean).includes(origin);
}

/**
 * Who is asking – for the per-address limits and counters. Behind Cloudflare it says so itself (CF-Connecting-IP).
 * Otherwise the last X-Forwarded-For entry is the one the own proxy (Caddy, nginx) added: the first one is whatever the
 * client wrote there, so it could dodge every limit with a made-up address.
 */
const clientIp = (req) => {
  const cf = String(req.headers['cf-connecting-ip'] ?? '').trim();
  if (cf && cf.length <= 64) return cf;
  const hops = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  return hops.at(-1) || req.socket.remoteAddress || '?';
};

// Simple per-IP limits: { key → [timestamps] }
const hits = new Map();
function limited(req, bucket, max, windowMs = 60_000) {
  const ip = clientIp(req);
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 10_000) hits.clear();
  return list.length > max;
}

const userOf = (req) => store.sessionUser(cookies(req).hs_sid);
const sessionJson = (user) => ({
  user: user ? { id: user.id, name: user.name, username: user.username, avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null } : null,
  access: Boolean(user), // signed in = can buy
  member: user ? hooks.isMember(user.id) : null, // on the HammerShop Discord (null = unknown)
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
    ...(order.kind === 'plus' && { plus: plusJson(order) }),
  };
}

/**
 * A Hammer+ order: whose it is, how long it runs and – once paid – the code. The code itself is never stored: it is
 * signed again from what the order holds (the same account, the same end date), so the database has nothing in it
 * that works as a code.
 */
function plusJson(order) {
  const p = order.plus ?? {};
  let code = null;
  if (order.status === 'paid' && p.grantedAt && plusLib.ready()) {
    try {
      code = plusLib.issue({ mc: p.mc, days: p.grantDays ?? p.days, now: p.grantedAt, id: p.codeId ?? null }); // the code from the DM
    } catch {
      code = null;
    }
  }
  // Not on the Discord server: the invite to it, where the 💎 Hammer+ role comes on joining.
  const member = order.status === 'paid' ? hooks.isMember?.(order.userId) : null;
  const invite = member === false ? hooks.info?.()?.invite ?? null : null;
  return { nick: p.nick ?? null, days: p.days ?? null, until: p.exp == null ? null : p.exp * 1000, code, member: member ?? null, invite };
}

/** Stripe says paid (verify or webhook) → the order is paid once; the team is told once. */
async function settle(order, session) {
  if (!order || !session) return order;
  if (session.payment_status === 'paid') {
    const amountOk = session.amount_total === order.amount && String(session.currency).toLowerCase() === order.currency;
    if (!amountOk) {
      console.warn(`[web] ${order.id}: kwota w Stripe ${session.amount_total} ${session.currency} ≠ zamówienie ${order.amount} ${order.currency} – nie oznaczono jako opłacone`);
      return store.updateOrder(order.id, { status: 'failed', note: 'amount mismatch' });
    }
    const { order: paid, first } = store.markPaid(order.id, { payment_intent: session.payment_intent ?? null });
    if (first) {
      console.log(`[web] zamówienie ${paid.id} opłacone – ${paid.kind} – ${(paid.amount / 100).toFixed(2)} ${paid.currency}`);
      await Promise.resolve(hooks.onPaid(paid, store._state().users[paid.userId])).catch((err) => console.warn(`[web] przekazanie ${paid.id} do bota:`, err.message));
    }
    return paid;
  }
  if (session.status === 'expired' && order.status === 'pending') return store.updateOrder(order.id, { status: 'expired' });
  return order;
}

async function checkout(req, res, user) {
  if (!paymentsReady()) return fail(res, 503, 'Płatności nie są jeszcze uruchomione. Nic nie zostało pobrane.');
  if (limited(req, 'checkout', 10)) return fail(res, 429, 'Zbyt wiele prób – odczekaj minutę i spróbuj ponownie.');
  const body = await jsonBody(req);
  if (body.kind === 'access') return fail(res, 409, 'Wystarczy zalogować się przez Discord – nie ma opłaty za dostęp.');
  if (body.kind !== 'products' && body.kind !== 'plus') return fail(res, 400, 'Nieznany rodzaj zamówienia.');
  const kind = 'products';
  const requestId = String(body.requestId ?? '').slice(0, 100) || crypto.randomUUID();

  // The same click twice (double click, back button) → the same payment page.
  const again = store.orderByRequest(user.id, requestId);
  if (again?.status === 'pending' && again.url) return send(res, 200, { url: again.url, order: again.id });
  if (body.kind === 'plus') return checkoutPlus(res, user, body, requestId);

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
    if (!p) return fail(res, 400, 'Coś z Twojego koszyka nie jest już dostępne. Usuń to i spróbuj ponownie.');
    items.push({ id: p.id, name: p.name, price: p.price, quantity: Math.min(MAX_QTY, quantity), productId: p.productId ?? null, variant: p.variant ?? null, eta: p.eta ?? null });
  }
  if (!items.length) return fail(res, 400, 'Twój koszyk jest pusty.');
  const lines = items.map((i) => ({ name: i.name, amount: i.price, quantity: i.quantity, description: i.eta ? `${i.eta} · na Discordzie` : 'Dostawa na Discordzie' }));
  const amount = items.reduce((s, i) => s + i.price * i.quantity, 0);
  if (amount < STRIPE_MIN) return fail(res, 400, 'Kwota jest niższa niż najmniejsza płatność kartą (0.50 €).');

  const currency = hooks.currency();
  const order = store.createOrder({ userId: user.id, kind, items, amount, currency, requestId });
  try {
    const session = await stripe.createCheckout({ order, user, lines, currency, idempotencyKey: `hs-${order.id}` });
    store.updateOrder(order.id, { stripe_id: session.id, url: session.url });
    return send(res, 200, { url: session.url, order: order.id });
  } catch (err) {
    store.updateOrder(order.id, { status: 'failed', note: err.message });
    console.warn(`[web] płatność ${order.id}:`, err.message);
    return fail(res, 502, err.status === 401 ? `Płatności nie są jeszcze poprawnie skonfigurowane – skontaktuj się z ${config.brand.name}.` : 'Nie udało się otworzyć strony płatności. Spróbuj ponownie.');
  }
}

/** Hammer+ for one Minecraft account: the plan's price from the admin panel, the nick checked at Mojang before anyone pays. */
async function checkoutPlus(res, user, body, requestId) {
  if (!plusOnSale()) return fail(res, 503, 'Hammer+ nie jest jeszcze w sprzedaży na stronie. Nic nie zostało pobrane.');
  const plan = store.plusPlans().find((p) => p.id === String(body.plan ?? ''));
  if (!plan) return fail(res, 400, 'Nie ma już takiego planu Hammer+ – odśwież stronę i wybierz ponownie.');
  let account;
  try {
    account = await hooks.plus.lookup(String(body.nick ?? ''));
  } catch (err) {
    if (!isUserError(err) && !err.status) throw err;
    return fail(res, err.status ?? 400, plainMessage(err));
  }
  // Hammer+ forever already: another plan would add nothing – nobody pays for that.
  if (hooks.plus.until?.(account.mc) === 0) return fail(res, 409, `Konto ${account.nick} ma już Hammer+ na zawsze – nie musisz go kupować ponownie. Nic nie zostało pobrane.`);
  const currency = hooks.currency();
  const name = `${plan.name} – ${account.nick}`;
  const items = [{ id: `plus:${plan.id}`, name, price: plan.price, quantity: 1, productId: null, variant: null, eta: 'Kod od razu po płatności' }];
  const order = store.createOrder({ userId: user.id, kind: 'plus', items, amount: plan.price, currency, requestId, plus: { plan: plan.id, days: plan.days, mc: account.mc, nick: account.nick } });
  try {
    const session = await stripe.createCheckout({
      order, user, currency, idempotencyKey: `hs-${order.id}`, returnPath: '/launcher',
      lines: [{ name, amount: plan.price, quantity: 1, description: `Hammer+ w Hammer Launcherze dla konta Minecraft ${account.nick} – ${plan.days ? `${plan.days} dni` : 'na zawsze'}` }],
      message: 'Zaraz po płatności zobaczysz swój kod Hammer+ na stronie i dostaniesz go w wiadomości prywatnej na Discordzie. Wpisujesz go w Hammer Launcherze: Hammer+ → „Mam kod”.',
    });
    store.updateOrder(order.id, { stripe_id: session.id, url: session.url });
    return send(res, 200, { url: session.url, order: order.id });
  } catch (err) {
    store.updateOrder(order.id, { status: 'failed', note: err.message });
    console.warn(`[web] płatność ${order.id}:`, err.message);
    return fail(res, 502, err.status === 401 ? `Płatności nie są jeszcze poprawnie skonfigurowane – skontaktuj się z ${config.brand.name}.` : 'Nie udało się otworzyć strony płatności. Spróbuj ponownie.');
  }
}

async function verify(req, res, user) {
  if (limited(req, 'verify', 30)) return fail(res, 429, 'Zbyt wiele prób – odczekaj minutę i spróbuj ponownie.');
  const { sessionId } = await jsonBody(req);
  const order = sessionId ? store.orderByStripe(String(sessionId)) : null;
  if (!order || order.userId !== user.id) return fail(res, 404, 'Nie znaleziono tej płatności na Twoim koncie.');
  if (order.status === 'paid') return send(res, 200, { paid: true, status: 'paid', order: order.id });
  if (!paymentsReady()) return fail(res, 503, 'Płatności są teraz niedostępne.');
  const session = await stripe.getCheckout(order.stripe_id).catch((err) => {
    console.warn(`[web] sprawdzanie ${order.id}:`, err.message);
    return null;
  });
  if (!session) return fail(res, 502, 'Brak połączenia ze Stripe. Spróbuj ponownie za chwilę.');
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
/**
 * Where sign-in may send people back to – only pages of this site that ask for it. download: the launcher page, which
 * then starts the download itself; polecaj: the „Zaproś znajomego” card of the launcher page.
 */
const NEXT = { launcher: '/launcher', admin: '/admin', download: '/launcher?download=1', polecaj: '/launcher#polecaj' };
/** "/launcher#polecaj" + "connected=1" → "/launcher?connected=1#polecaj" (and & when there is a query already). */
function withQuery(target, query) {
  const [pathAndQuery, hash] = target.split('#');
  return `${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}${query}${hash ? `#${hash}` : ''}`;
}

function authStart(req, res, url) {
  const next = NEXT[url.searchParams.get('next')] ?? null;
  if (!authReady()) return redirect(res, withQuery(next ?? '/', 'auth=unavailable'));
  const state = crypto.randomBytes(16).toString('base64url');
  return redirect(res, discord.authorizeUrl(state), [cookie('hs_oauth', state, 600), cookie('hs_next', next ?? '', next ? 600 : 0)]);
}

async function authCallback(req, res, url) {
  const back = Object.values(NEXT).includes(cookies(req).hs_next) ? cookies(req).hs_next : '/';
  const clear = [cookie('hs_oauth', '', 0), cookie('hs_next', '', 0)];
  if (url.searchParams.get('error')) return redirect(res, withQuery(back, 'auth=cancelled'), clear);
  const state = url.searchParams.get('state');
  const expected = cookies(req).hs_oauth;
  if (!state || !expected || state.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expected))) {
    return redirect(res, withQuery(back, 'auth=failed'), clear);
  }
  try {
    const { me, accessToken } = await discord.userFromCode(String(url.searchParams.get('code') ?? ''));
    // „Zaproś znajomego”: a friend's link counts only at the very first sign-in on the site (src/web/referrals.js).
    const firstTime = !store.siteUserExists(me.id);
    const refCode = cookies(req)[referrals.COOKIE];
    if (refCode) clear.push(cookie(referrals.COOKIE, '', 0));
    const user = store.upsertUser(me);
    if (firstTime && refCode) referrals.onFirstSignIn(user, refCode);
    // Not on the HammerShop Discord yet → the bot adds them (Member role included). Signing in never fails because of it.
    const joined = await Promise.resolve(hooks.onLogin(user, accessToken)).catch((err) => {
      console.warn(`[web] dodawanie ${user.id} do serwera:`, err.message);
      return null;
    });
    const token = store.createSession(user.id);
    return redirect(res, withQuery(back, `connected=1${joined?.added ? '&joined=1' : ''}`), [...clear, cookie('hs_sid', token, 30 * 86_400)]);
  } catch (err) {
    console.warn('[web] logowanie:', err.message);
    return redirect(res, withQuery(back, 'auth=failed'), clear);
  }
}

/**
 * The download button. Signed in (or no Discord sign-in set up on this server) → the installer, counted – also for the
 * signed-in account (the referral card shows how many of your friends downloaded it). Not signed in → Discord first.
 */
function download(req, res) {
  const release = store.currentRelease();
  if (!release) return redirect(res, '/launcher?download=none');
  const user = userOf(req);
  if (!user && authReady()) return authStart(req, res, new URL('/?next=download', 'http://local'));
  if (req.method === 'GET' && !limited(req, 'download', 20)) {
    store.countDownload(release.version);
    if (user) store.countUserDownload(user.id);
  }
  return redirect(res, `/updates/${encodeURIComponent(release.file)}`);
}

// ───────────── Static files ─────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.css': 'text/css', '.js': 'text/javascript' };
/** The launcher page and the admin panel load nothing but their own files (and pictures over https). */
const PAGE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; media-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
// (also under their file names – never the raw file, which has both sites' parts and no CSP)
const PAGES = { '/launcher': 'launcher.html', '/admin': 'admin.html', '/launcher.html': 'launcher.html', '/admin.html': 'admin.html' };
/**
 * A page as this site shows it. The same files serve both sites: what is between <!--shop--> … <!--/shop--> is only
 * for HammerShop's site, <!--launcher--> … <!--/launcher--> only for Hammer Launcher's own (BOT_PROFILE=launcher) –
 * its name, the big H, no link to a shop.
 */
function pageHtml(file) {
  const [mine, other] = profile.launcher ? ['launcher', 'shop'] : ['shop', 'launcher'];
  return fs
    .readFileSync(path.join(PUBLIC, file), 'utf8')
    .replace(new RegExp(`<!--${other}-->[\\s\\S]*?<!--/${other}-->`, 'g'), '')
    .replace(new RegExp(`<!--/?${mine}-->`, 'g'), '')
    .replace(/((?:href|src)=")(\/assets\/[A-Za-z0-9._/-]+\.(?:css|js))"/g, (all, attr, url) => `${attr}${url}?v=${stampOf(url)}"`);
}

/**
 * A stamp of a script's or stylesheet's content, put into its address on the pages (admin.js?v=1a2b3c4d). A proxy in
 * front of the site may tell browsers to keep .js and .css for hours whatever this server says (Cloudflare does) –
 * with the stamp a changed file has a new address, so an update of the site is seen at once.
 */
const stamps = new Map(); // url → { mtime, stamp }
function stampOf(url) {
  try {
    const file = path.join(PUBLIC, url);
    const mtime = fs.statSync(file).mtimeMs;
    if (stamps.get(url)?.mtime !== mtime) stamps.set(url, { mtime, stamp: crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 8) });
    return stamps.get(url).stamp;
  } catch {
    return '0';
  }
}

function serveStatic(req, res, pathname) {
  // Hammer Launcher's own site has no shop: its front page – and any address that is no file – is the launcher's page.
  const home = profile.launcher && (pathname === '/' || pathname === '/index.html' || (!pathname.startsWith('/assets/') && !path.extname(pathname)));
  const page = PAGES[pathname.replace(/\/+$/, '')] ?? (home ? 'launcher.html' : null);
  if (page && fs.existsSync(path.join(PUBLIC, page))) {
    res.writeHead(200, { ...HEADERS, 'content-type': TYPES['.html'], 'cache-control': 'no-cache', 'content-security-policy': PAGE_CSP, ...(page === 'admin.html' && { 'x-robots-tag': 'noindex' }) });
    return res.end(req.method === 'HEAD' ? undefined : pageHtml(page));
  }
  const file = pathname === '/' || pathname === '/index.html' ? path.join(PUBLIC, 'index.html') : path.join(PUBLIC, path.normalize(pathname).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // Unknown paths show the store (single page) – but not for missing assets.
    if (pathname.startsWith('/assets/')) return fail(res, 404, 'Nie znaleziono');
    return serveStatic(req, res, '/');
  }
  const ext = path.extname(file);
  const cache = ['.html', '.js', '.css'].includes(ext) ? 'no-cache' : 'public, max-age=604800, immutable'; // pages and their code are always fresh, pictures keep
  res.writeHead(200, { ...HEADERS, 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': cache });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ───────────── Router ─────────────
async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  // Hammer Launcher: featured servers, Hammer+ cloud sync and capes (src/web/launcher.js).
  if (p.startsWith(launcher.PREFIX)) return launcher.api(req, res, url, { send, fail, limited, featured: () => hooks.featured(), publicUrl: () => web().publicUrl, ip: clientIp, plusOf: (mc) => Boolean(hooks.plus?.running?.(mc)), freshCode: (mc, exp) => hooks.plus?.freshCode?.(mc, exp) ?? null });
  // The admin panel (src/web/admin.js).
  if (p.startsWith(admin.PREFIX)) {
    return admin.api(req, res, url, {
      send, fail, jsonBody, userOf, limited, originOk,
      level: (id) => hooks.level(id), announce: (a) => hooks.announce(a), log: (t) => hooks.log(t),
      plus: hooks.plus, featured: hooks.featuredAdmin, currency: () => hooks.currency(),
      publicUrl: () => web().publicUrl, authReady, paymentsReady, webhookReady, playing: () => launcher.onlineNow(), invitesPaused: () => Boolean(hooks.invitesPaused?.()), ownInviteFailing: () => Boolean(hooks.ownInviteFailing?.()),
    });
  }
  if (!p.startsWith('/api/shop/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Niedozwolona metoda');
    if (p === '/join' || p === '/join/') return launcher.join(req, res, url, { send }); // "join this server" links → the launcher
    // Hammer Launcher's installer: the download button, and the feed its own updater reads (src/web/releases.js).
    if (p === '/download' || p === '/download/') return download(req, res);
    // „Zaproś znajomego”: a personal link (src/web/referrals.js).
    const ref = /^\/r\/([A-Za-z0-9]{1,32})\/?$/.exec(p);
    if (ref) {
      if (limited(req, 'referral-link', 60)) return fail(res, 429, 'Zwolnij trochę i spróbuj ponownie.');
      return referrals.visit(res, ref[1], { redirect, cookie });
    }
    if (p.startsWith('/updates/')) {
      if (limited(req, 'updates', 600)) return fail(res, 429, 'Zwolnij trochę i spróbuj ponownie.');
      let name = null;
      try {
        name = decodeURIComponent(p.slice('/updates/'.length));
      } catch {
        return fail(res, 404, 'Nie znaleziono'); // a broken %-escape is not a file name
      }
      return releases.serve(req, res, name, { send, fail, headers: HEADERS });
    }
    return serveStatic(req, res, p);
  }
  const route = p.slice('/api/shop/'.length);
  if (limited(req, 'api', 120)) return fail(res, 429, 'Zwolnij trochę i spróbuj ponownie.');

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
        currency: hooks.currency(), // prices are in the smallest unit (cents / grosze)
      });
    }
    if (route === 'session') return send(res, 200, sessionJson(userOf(req)));
    if (route === 'plus') return send(res, 200, { ready: plusOnSale(), plans: plusOnSale() ? store.plusPlans() : [], currency: hooks.currency(), authReady: authReady() });
    if (route === 'referrals') return send(res, 200, { ...referrals.pageJson(userOf(req), web().publicUrl), authReady: authReady() });
    if (route === 'auth/start') return authStart(req, res, url);
    if (route === 'auth/callback') return authCallback(req, res, url);
    if (route.startsWith('image/')) {
      const p = products().find((x) => x.id === decodeURIComponent(route.slice(6)));
      if (!p?.imagePath || !fs.existsSync(p.imagePath)) return fail(res, 404, 'Nie znaleziono');
      res.writeHead(200, { ...HEADERS, 'content-type': TYPES[path.extname(p.imagePath)] ?? 'image/png', 'cache-control': 'public, max-age=300' });
      return fs.createReadStream(p.imagePath).pipe(res);
    }
    if (route === 'orders') {
      const user = userOf(req);
      if (!user) return fail(res, 401, 'Zaloguj się przez Discord, aby zobaczyć swoje zamówienia.');
      return send(res, 200, { orders: store.ordersOf(user.id).filter((o) => o.stripe_id || o.status === 'paid').map(orderJson) });
    }
    return fail(res, 404, 'Nie znaleziono');
  }

  if (req.method === 'POST') {
    if (route === 'stripe/webhook') return webhook(req, res);
    if (!sameOrigin(req)) return fail(res, 403, 'Żądanie odrzucone.');
    if (route === 'logout') {
      store.endSession(cookies(req).hs_sid);
      return send(res, 200, { ok: true }, { 'set-cookie': cookie('hs_sid', '', 0) });
    }
    const user = userOf(req);
    if (!user) return fail(res, 401, 'Najpierw zaloguj się przez Discord.');
    if (route === 'checkout') return checkout(req, res, user);
    if (route === 'verify') return verify(req, res, user);
    if (route === 'referrals/claim') return referrals.claim(req, res, user, { send, fail, jsonBody, limited, claim: (u, nick) => hooks.referrals.claim(u, nick) });
    return fail(res, 404, 'Nie znaleziono');
  }
  return fail(res, 405, 'Niedozwolona metoda');
}

/**
 * The website server. h: { catalog() → products, info() → { invite }, onPaid(order, user),
 * onLogin(user, accessToken) → { added, member }, isMember(userId) → true | false | null, currency() → 'eur',
 * featured() → the servers Hammer Launcher recommends }.
 */
function createWebServer(h = {}) {
  hooks = { ...hooks, ...h };
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status ?? (isUserError(err) ? 400 : null); // a wrong nick, address, version… – said plainly
      if (!status) console.error('[web]', err);
      if (!res.headersSent) fail(res, status ?? 500, status ? plainMessage(err) : 'Coś poszło nie tak po naszej stronie. Spróbuj ponownie.');
      else res.end();
    });
  });
}

module.exports = { createWebServer, authReady, paymentsReady, webhookReady, plusOnSale };
