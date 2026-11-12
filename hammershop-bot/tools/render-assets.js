'use strict';

/**
 * Renders every HammerShop image asset (channel banners, custom emojis, logos, server banner)
 * from HTML/SVG templates using a headless Chromium browser.
 *
 *   npm install            (installs the icon + font packages from devDependencies)
 *   npm i -D playwright    (only if Playwright is not installed globally)
 *   npm run render-assets  (or: npm run render-assets -- emojis | banners | brand | web)
 *
 * Change THEME below to re-color everything, or edit BANNERS / EMOJIS to add your own.
 * Icons: Font Awesome Free (CC BY 4.0) – see assets/CREDITS.md. Font: Montserrat (OFL).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'assets');
const FA = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
const FONT_DIR = path.join(path.dirname(require.resolve('@fontsource/montserrat/package.json')), 'files');

/** Light orange ("amber") – every banner, emoji and logo is drawn from these colors. */
const THEME = {
  brand: 'HAMMERSHOP',
  brandA: 'HAMMER', // the wordmark is two-tone: HAMMER (white) + SHOP (orange)
  brandB: 'SHOP',
  // Icon gradient (top → bottom) and glow
  iconTop: '#fff4e5',
  iconMid: '#ffc27e',
  iconBottom: '#ff8a2b',
  glow: '255, 150, 58',
  glowDeep: '234, 98, 18',
  glowSoft: '255, 214, 168', // light highlight (line, small sparkles)
  // Banner background (near black with a warm tint)
  bgTop: '#0b0806',
  bgMid: '#100b08',
  bgBottom: '#28150a',
  accent: '#ffcf9c',
  // Emoji tile gradient – light orange
  tileLight: '#ffd29b',
  tileMid: '#ffa64d',
  tileDark: '#f27c1c',
  tileShadow: '110, 42, 0',
  tileInk: '#c25509', // coin symbols and check marks on white
};

// ───────────── Banners (1080 × 400) ─────────────
// 25 remakes of the original pack + shop extras – titles in Polish.
const BANNERS = [
  ['shop', 'SKLEP', 'solid/store'],
  ['purchase', 'ZAKUP', 'solid/cart-shopping', { badge: 'check' }],
  ['rules', 'REGULAMIN', 'solid/gavel'],
  ['support', 'POMOC', 'solid/headset'],
  ['giveaways', 'GIVEAWAYE', 'solid/gift'],
  ['announcements', 'OGŁOSZENIA', 'solid/bullhorn'],
  ['discord', 'DISCORD', 'brands/discord'],
  ['join-us', 'DOŁĄCZ DO NAS', 'solid/user-plus'],
  ['vouches', 'OPINIE', 'solid/comment-dots'],
  ['partners', 'PARTNERZY', 'solid/handshake'],
  ['staff', 'ZESPÓŁ', 'solid/user-shield'],
  ['updates', 'AKTUALIZACJE', 'solid/bell'],
  ['help', 'POMOC', 'solid/circle-question'],
  ['verification', 'WERYFIKACJA', 'solid/shield-halved', { badge: 'check' }],
  ['channels', 'KANAŁY', 'solid/hashtag'],
  ['boosters', 'BOOSTERZY', 'solid/rocket'],
  ['leaderboard', 'RANKING', 'solid/trophy'],
  ['media', 'MEDIA', 'solid/photo-film'],
  ['memes', 'MEMY', 'solid/face-laugh-squint'],
  ['events', 'WYDARZENIA', 'solid/calendar-days'],
  ['vip', 'VIP', 'solid/crown'],
  ['bot-commands', 'KOMENDY', 'solid/robot'],
  ['contact', 'KONTAKT', 'solid/envelope'],
  ['whats-new', 'NOWOŚCI', 'solid/newspaper'],
  ['launcher', 'LAUNCHER', 'solid/rocket'],
  ['welcome', 'WITAMY', 'solid/hand'],
  // extras for the shop layout
  ['tickets', 'TICKETY', 'solid/ticket'],
  ['payments', 'PŁATNOŚCI', 'solid/credit-card'],
  ['roles', 'ROLE', 'solid/masks-theater'],
  ['faq', 'FAQ', 'solid/circle-question'],
  ['restocks', 'DOSTAWY', 'solid/box-open'],
  ['information', 'INFORMACJE', 'solid/circle-info'],
  ['how-to-buy', 'JAK KUPIĆ', 'solid/bag-shopping'],
  ['products', 'PRODUKTY', 'solid/tags'],
  ['chat', 'CZAT', 'solid/comments'],
  ['reviews', 'OPINIE', 'solid/star'],
  ['proofs', 'REALIZACJE', 'solid/receipt', { badge: 'check' }],
];

// ───────────── Emojis (128 × 128) ─────────────
// name → glyph. { fa } = Font Awesome icon, { coin } = white coin with a symbol, { text } = plain text glyph.
const EMOJIS = {
  arrow_right: { fa: 'solid/arrow-right', lines: true },
  basket: { fa: 'solid/basket-shopping' },
  battery: { fa: 'solid/battery-three-quarters' },
  bell: { fa: 'solid/bell', sparkles: 1 },
  blik: { fa: 'solid/mobile-screen-button', badge: 'check' },
  brush: { fa: 'solid/paintbrush' },
  calculator: { fa: 'solid/calculator' },
  calendar: { fa: 'solid/calendar-days' },
  camera: { fa: 'solid/camera' },
  cart: { fa: 'solid/cart-shopping' },
  chat: { fa: 'solid/comment-dots' },
  check: { fa: 'solid/circle-check' },
  clock: { fa: 'solid/clock' },
  cloud: { fa: 'solid/cloud' },
  coin: { coin: '$', sparkles: 1 },
  crown: { fa: 'solid/crown', sparkles: 2 },
  currency_eur: { coin: '€' },
  currency_gbp: { coin: '£' },
  currency_pln: { coin: 'zł' },
  currency_usd: { coin: '$' },
  diamond: { fa: 'solid/gem', sparkles: 2 },
  download: { fa: 'solid/download' },
  flame: { fa: 'solid/fire-flame-curved' },
  folder: { fa: 'solid/folder-open' },
  gear: { fa: 'solid/gear' },
  gift: { fa: 'solid/gift' },
  group: { fa: 'solid/users' },
  hash: { fa: 'solid/hashtag' },
  heart: { fa: 'solid/heart', sparkles: 1 },
  home: { fa: 'solid/house' },
  info: { fa: 'solid/circle-info' },
  key: { fa: 'solid/key' },
  lock_locked: { fa: 'solid/lock' },
  lock_unlocked: { fa: 'solid/lock-open' },
  mail: { fa: 'solid/envelope' },
  medal: { fa: 'solid/medal' },
  moon: { fa: 'solid/moon', sparkles: 2 },
  music: { fa: 'solid/music' },
  paysafecard: { fa: 'solid/shield', inner: 'solid/lock' },
  pencil: { fa: 'solid/pencil' },
  person: { fa: 'solid/user' },
  phone: { fa: 'solid/mobile-screen-button' },
  pin: { fa: 'solid/location-dot' },
  question: { fa: 'solid/circle-question' },
  refresh: { fa: 'solid/arrows-rotate' },
  rocket: { fa: 'solid/rocket', sparkles: 1 },
  search: { fa: 'solid/magnifying-glass' },
  share: { fa: 'solid/share-nodes' },
  star: { fa: 'solid/star', sparkles: 2 },
  star_outline: { fa: 'regular/star' },
  sun: { fa: 'solid/sun' },
  target: { fa: 'solid/bullseye' },
  thumbs_down: { fa: 'solid/thumbs-down' },
  thumbs_up: { fa: 'solid/thumbs-up' },
  trophy: { fa: 'solid/trophy' },
  upload: { fa: 'solid/upload' },
  wallet: { fa: 'solid/wallet' },
  warning: { fa: 'solid/triangle-exclamation' },
  x: { fa: 'solid/circle-xmark' },
  // HammerShop extras used by the bot UI
  ticket: { fa: 'solid/ticket' },
  shield: { fa: 'solid/shield-halved', badge: 'check' },
  box: { fa: 'solid/box-open' },
  sparkles: { fa: 'solid/wand-magic-sparkles' },
  card: { fa: 'solid/credit-card' },
  crypto: { fa: 'brands/bitcoin' },
  paypal: { fa: 'brands/paypal' },
  logo: { fa: 'solid/hammer', sparkles: 2, big: true },
};

// ───────────── Helpers ─────────────

function svg(name, { fill = 'currentColor', id } = {}) {
  const raw = fs.readFileSync(path.join(FA, 'svgs', `${name}.svg`), 'utf8');
  const viewBox = raw.match(/viewBox="([^"]+)"/)[1];
  const paths = [...raw.matchAll(/<path[^>]*d="([^"]+)"[^>]*\/?>/g)].map((m) => `<path d="${m[1]}"/>`).join('');
  return `<svg ${id ? `id="${id}"` : ''} xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${fill}">${paths}</svg>`;
}

// Fonts are embedded as data URLs – Chromium blocks file:// fonts on pages created with setContent().
// Two subsets: latin (A–Z, Ó) and latin-ext (Ą Ć Ę Ł Ń Ś Ź Ż …) – the Polish titles need both.
const fontUrl = (weight, subset) => `data:font/woff2;base64,${fs.readFileSync(path.join(FONT_DIR, `montserrat-${subset}-${weight}-normal.woff2`)).toString('base64')}`;
const RANGES = {
  'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
  latin: 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
};
const FONTS = [500, 600, 700, 800, 900]
  .flatMap((w) => Object.entries(RANGES).map(([subset, range]) => `@font-face{font-family:Montserrat;font-weight:${w};src:url("${fontUrl(w, subset)}") format("woff2");unicode-range:${range};}`))
  .join('');

const SPARKLE = 'M50 0 C53 30 70 47 100 50 C70 53 53 70 50 100 C47 70 30 53 0 50 C30 47 47 30 50 0Z';
const sparkle = (x, y, size, opacity, color = '#fff') =>
  `<svg class="sp" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;opacity:${opacity}" viewBox="0 0 100 100"><path fill="${color}" d="${SPARKLE}"/></svg>`;

function page(body, css, { width, height }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${FONTS}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;background:transparent;overflow:hidden}
body{font-family:Montserrat,sans-serif;-webkit-font-smoothing:antialiased}
.sp{position:absolute}
${css}
</style></head><body>${body}</body></html>`;
}

const iconGradient = `<svg width="0" height="0" style="position:absolute"><defs>
  <linearGradient id="ig" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${THEME.iconTop}"/><stop offset=".45" stop-color="${THEME.iconMid}"/><stop offset="1" stop-color="${THEME.iconBottom}"/>
  </linearGradient></defs></svg>`;

const hammerMark = (cls = 'mark') => `<span class="${cls}">${svg('solid/hammer', { fill: 'url(#ig)' })}</span>`;
/** HAMMER + SHOP, two-tone (HTML). */
const wordHtml = () => `<span class="wa">${THEME.brandA}</span><span class="wb">${THEME.brandB}</span>`;

// ───────────── Banner template ─────────────

function bannerHtml(title, icon, opts = {}) {
  const css = `
.bn{position:relative;width:1080px;height:400px;overflow:hidden;background:${THEME.bgTop}}
.bg{position:absolute;inset:0;background:
  radial-gradient(ellipse 60% 85% at 63% 30%, rgba(58,46,40,.85) 0%, rgba(28,20,16,0) 70%),
  radial-gradient(ellipse 45% 70% at 25% 55%, rgba(${THEME.glowDeep},.16) 0%, rgba(0,0,0,0) 70%),
  radial-gradient(ellipse 60% 60% at 22% 120%, rgba(${THEME.glow},.80) 0%, rgba(${THEME.glowDeep},.36) 42%, rgba(0,0,0,0) 78%),
  radial-gradient(ellipse 55% 45% at 88% 118%, rgba(${THEME.glowDeep},.50) 0%, rgba(0,0,0,0) 75%),
  radial-gradient(ellipse 90% 30% at 50% 110%, rgba(${THEME.glowDeep},.28) 0%, rgba(0,0,0,0) 80%),
  linear-gradient(180deg, ${THEME.bgTop} 0%, ${THEME.bgMid} 55%, ${THEME.bgBottom} 100%)}
.grid{position:absolute;inset:0;opacity:.07;background-image:
  linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px);
  background-size:40px 40px;mask-image:radial-gradient(ellipse 70% 80% at 50% 45%, #000 0%, transparent 75%);-webkit-mask-image:radial-gradient(ellipse 70% 80% at 50% 45%, #000 0%, transparent 75%)}
.streak{position:absolute;left:-10%;top:-40%;width:55%;height:180%;transform:rotate(18deg);
  background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.035) 50%, rgba(255,255,255,0) 100%)}
.vig{position:absolute;inset:0;box-shadow:inset 0 0 160px rgba(0,0,0,.85)}
.line{position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg, rgba(${THEME.glow},0) 0%, rgba(${THEME.glow},.9) 30%, rgba(${THEME.glowSoft},.95) 50%, rgba(${THEME.glow},.9) 70%, rgba(${THEME.glow},0) 100%);opacity:.6}
.content{position:absolute;left:0;right:0;top:0;height:400px;display:flex;align-items:center;justify-content:center;gap:34px;padding:0 70px 18px}
.icon{position:relative;flex:none;width:var(--is);height:var(--is);filter:drop-shadow(0 0 14px rgba(${THEME.glow},.95)) drop-shadow(0 0 42px rgba(${THEME.glowDeep},.7))}
.icon>svg{width:100%;height:100%}
.badge{position:absolute;right:-12%;bottom:-10%;width:46%;height:46%;border-radius:50%;background:#0d0906;padding:7%;}
.badge>div{width:100%;height:100%;border-radius:50%;background:linear-gradient(180deg, ${THEME.iconMid}, ${THEME.iconBottom});display:flex;align-items:center;justify-content:center}
.badge svg{width:56%;height:56%}
.title{font-weight:800;font-size:var(--fs);letter-spacing:.01em;line-height:1;white-space:nowrap;
  background:linear-gradient(180deg,#ffffff 0%,#f8f4f0 38%,#d9cfc6 72%,#b8aca1 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 10px 14px rgba(0,0,0,.65)) drop-shadow(0 0 1px rgba(255,255,255,.35));padding:6px 0}
.pill{position:absolute;left:24px;bottom:24px;height:44px;padding:0 20px 0 14px;border-radius:22px;border:2px solid rgba(${THEME.glow},.95);
  background:rgba(12,8,5,.88);display:flex;align-items:center;gap:10px;box-shadow:0 0 18px rgba(${THEME.glow},.35), inset 0 0 12px rgba(${THEME.glow},.18)}
.pill .mark{width:24px;height:22px;filter:drop-shadow(0 0 6px rgba(${THEME.glow},.9))}
.pill .mark svg{width:100%;height:100%}
.pill b{font-weight:900;font-size:18px;letter-spacing:.08em}
.pill .mark-h{height:28px;width:auto;margin:0 2px 0 -2px;filter:drop-shadow(0 0 6px rgba(255,200,40,.75))}
.pill .wa{color:#fff}.pill .wb{color:${THEME.iconMid}}`;

  const badge = opts.badge
    ? `<div class="badge"><div>${svg('solid/check', { fill: '#0d0906' })}</div></div>`
    : '';
  const body = `${iconGradient}<div class="bn">
  <div class="bg"></div><div class="grid"></div><div class="streak"></div>
  ${sparkle(905, 60, 18, 0.55)}${sparkle(960, 95, 9, 0.4)}${sparkle(150, 70, 12, 0.35)}${sparkle(995, 300, 14, 0.3, THEME.accent)}${sparkle(470, 330, 8, 0.25)}
  <div class="vig"></div><div class="line"></div>
  <div class="content"><div class="icon">${svg(icon, { fill: 'url(#ig)' })}${badge}</div><div class="title">${title}</div></div>
  ${opts.brand === 'launcher' ? `<div class="pill"><img class="mark-h" src="${hLogo()}" alt=""><b><span class="wa">HAMMER</span> <span class="wb">LAUNCHER</span></b></div>` : `<div class="pill">${hammerMark()}<b>${wordHtml()}</b></div>`}
</div>
<script>
  // Fit icon + title into the safe area (after the font has loaded, so widths are real).
  window.__ready = false;
  document.fonts.ready.then(() => {
    const t = document.querySelector('.title'), i = document.querySelector('.icon');
    let size = 132;
    const fit = () => { t.style.setProperty('--fs', size + 'px'); i.style.setProperty('--is', Math.round(size * 0.98) + 'px'); };
    fit();
    while ((t.offsetWidth + i.offsetWidth + 34) > 900 && size > 60) { size -= 2; fit(); }
    window.__ready = true;
  });
</script>`;
  return page(body, css, { width: 1080, height: 400 });
}

// ───────────── Emoji template ─────────────

function emojiHtml(spec) {
  const css = `
.tile{position:absolute;left:5px;top:4px;width:118px;height:118px;border-radius:30px;overflow:hidden;
  background:linear-gradient(165deg, ${THEME.tileLight} 0%, ${THEME.tileMid} 48%, ${THEME.tileDark} 100%);
  box-shadow:0 2px 3px rgba(${THEME.tileShadow},.45), inset 0 1.5px 0 rgba(255,255,255,.6), inset 0 -6px 10px rgba(${THEME.tileShadow},.28), inset 0 0 0 1.5px rgba(255,255,255,.2)}
.gloss{position:absolute;left:4px;right:4px;top:3px;height:56px;border-radius:26px 26px 60% 60%/26px 26px 40% 40%;
  background:linear-gradient(180deg, rgba(255,255,255,.45) 0%, rgba(255,255,255,.10) 70%, rgba(255,255,255,0) 100%)}
.g{position:absolute;left:0;top:0;width:128px;height:128px;display:flex;align-items:center;justify-content:center;padding-top:1px}
.g>svg,.g>.stack{width:60px;height:60px;filter:drop-shadow(0 2.5px 2px rgba(${THEME.tileShadow},.55)) drop-shadow(0 0 1px rgba(${THEME.tileShadow},.35))}
.g.big>svg{width:72px;height:72px}
.stack{position:relative}.stack>svg{position:absolute;inset:0;width:100%;height:100%}
.stack .inner{position:absolute;left:30%;top:28%;width:40%;height:40%}
.coin{width:66px;height:66px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;
  box-shadow:0 2.5px 2px rgba(${THEME.tileShadow},.5), inset 0 -3px 0 rgba(${THEME.tileShadow},.14);font-weight:900;color:${THEME.tileInk};letter-spacing:-.02em}
.coin.ring{box-shadow:0 2.5px 2px rgba(${THEME.tileShadow},.5), inset 0 0 0 5px rgba(242,124,28,.25)}
.lines{position:absolute;left:24px;top:52px;width:16px}.lines i{display:block;height:5px;border-radius:3px;background:#fff;margin-bottom:9px;opacity:.9}
.badge{position:absolute;right:23px;bottom:24px;width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(${THEME.tileShadow},.5)}
.badge svg{width:17px;height:17px}`;

  let glyph;
  if (spec.coin) {
    const size = spec.coin.length > 1 ? 30 : 40;
    glyph = `<div class="coin${spec.sparkles ? ' ring' : ''}" style="font-size:${size}px">${spec.coin}</div>`;
  } else if (spec.inner) {
    glyph = `<div class="stack">${svg(spec.fa, { fill: '#fff' })}<span class="inner">${svg(spec.inner, { fill: THEME.tileInk })}</span></div>`;
  } else {
    glyph = svg(spec.fa, { fill: '#fff' });
  }
  const extras = [];
  if (spec.lines) extras.push('<div class="lines"><i></i><i style="width:70%"></i></div>');
  if (spec.badge) extras.push(`<div class="badge">${svg('solid/check', { fill: THEME.tileInk })}</div>`);
  if (spec.sparkles >= 1) extras.push(sparkle(92, 16, 14, 0.95));
  if (spec.sparkles >= 2) extras.push(sparkle(18, 88, 10, 0.85));
  const shift = spec.lines ? 'style="padding-left:14px"' : '';
  return page(`<div class="tile"><div class="gloss"></div></div><div class="g${spec.big ? ' big' : ''}" ${shift}>${glyph}</div>${extras.join('')}`, css, { width: 128, height: 128 });
}

// ───────────── Logos (vector) ─────────────

/** Deterministic "random" star field, so re-renders look identical. */
function stars(count, size, seed, { minR = 1, maxR = 3, margin = 0, color = '#ffffff', height = size } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const x = margin + rnd() * (size - 2 * margin);
    const y = margin + rnd() * (height - 2 * margin);
    const r = minR + rnd() * (maxR - minR);
    const warm = rnd() < 0.35 ? THEME.accent : color;
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${warm}" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

const svgSparkle = (x, y, size, opacity = 1, fill = '#fff') =>
  `<path transform="translate(${x - size / 2} ${y - size / 2}) scale(${size / 100})" d="${SPARKLE}" fill="${fill}" opacity="${opacity}"/>`;

const LOGO_DEFS = `
  <linearGradient id="amber" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fff6ea"/><stop offset=".32" stop-color="#ffc98c"/><stop offset=".68" stop-color="#ff9a3d"/><stop offset="1" stop-color="#e2600f"/>
  </linearGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#e4e7ee"/><stop offset="1" stop-color="#9aa1ae"/>
  </linearGradient>
  <linearGradient id="steelDark" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d9dde5"/><stop offset="1" stop-color="#7c8391"/>
  </linearGradient>
  <linearGradient id="steelFace" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#c9ced8"/><stop offset=".6" stop-color="#f4f6fa"/><stop offset="1" stop-color="#ffffff"/>
  </linearGradient>
  <linearGradient id="handle" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#ffb46a"/><stop offset=".5" stop-color="#ff9238"/><stop offset="1" stop-color="#d9600f"/>
  </linearGradient>
  <linearGradient id="grip" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#3b1d0b"/><stop offset=".5" stop-color="#2a1407"/><stop offset="1" stop-color="#170a03"/>
  </linearGradient>
  <linearGradient id="word" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#fff4e8"/><stop offset="1" stop-color="#f1d2b0"/>
  </linearGradient>
  <linearGradient id="wordOrange" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffd7a6"/><stop offset=".5" stop-color="#ffa34a"/><stop offset="1" stop-color="#f07a1c"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
  <filter id="glowSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="blur14" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="blur22" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="22"/></filter>
  <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0b0502" flood-opacity=".8"/></filter>`;

/**
 * The HammerShop hammer – a claw hammer drawn by hand (not an icon font) so it stays crisp at 1024 px:
 * a steel head (striking face on the right, curved claw on the left), an orange handle and a dark grip.
 * Designed around (0, 0), head up; placed with translate / rotate / scale. flat = one colour (silhouette).
 */
const HAMMER_PARTS = {
  handle: 'M-34 -70 h68 l8 360 a42 42 0 0 1 -84 0z',
  grip: 'M-38.6 150 h77.2 l3.4 140 a42 42 0 0 1 -84 0z',
  // claw: thick at the eye, tapering and curving down to a split tip
  claw: 'M-52 -182 C-120 -186 -190 -170 -246 -112 C-252 -104 -244 -94 -234 -98 C-186 -120 -128 -118 -52 -96z',
  neck: 'M40 -168 h96 v64 h-96z',
  face: 'M128 -192 h62 a16 16 0 0 1 16 16 v108 a16 16 0 0 1 -16 16 h-62z',
  eye: 'M-58 -204 h108 a14 14 0 0 1 14 14 v110 a14 14 0 0 1 -14 14 h-108 a14 14 0 0 1 -14 -14 v-110 a14 14 0 0 1 14 -14z',
};

function hammer({ x = 512, y = 512, angle = 38, scale = 1, outline = '#120903', outlineWidth = 16, flat = null } = {}) {
  const P = HAMMER_PARTS;
  const order = ['handle', 'claw', 'neck', 'face', 'eye'];
  const fills = flat
    ? Object.fromEntries(order.map((k) => [k, flat]))
    : { handle: 'url(#handle)', claw: 'url(#steel)', neck: 'url(#steelDark)', face: 'url(#steelFace)', eye: 'url(#steel)' };
  const back = outlineWidth
    ? `<g fill="${outline}" stroke="${outline}" stroke-width="${outlineWidth * 2}" stroke-linejoin="round">${order.map((k) => `<path d="${P[k]}"/>`).join('')}</g>`
    : '';
  const front = order.map((k) => `<path d="${P[k]}" fill="${fills[k]}"/>`).join('');
  const detail = flat
    ? ''
    : `<path d="${P.grip}" fill="url(#grip)"/>
    <g stroke="#ff9a3d" stroke-width="6" stroke-linecap="round" opacity=".8"><line x1="-28" y1="182" x2="28" y2="168"/><line x1="-28" y1="218" x2="28" y2="204"/><line x1="-29" y1="254" x2="29" y2="240"/></g>
    <path d="M-60 -184 C-110 -184 -160 -174 -206 -146" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".8" fill="none"/>
    <path d="M-46 -192 h82" stroke="#fff" stroke-width="8" stroke-linecap="round" opacity=".9"/>
    <path d="M140 -180 v94" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".75"/>
    <path d="M-20 -56 v190" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".28"/>`;
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">${back}${front}${detail}</g>`;
}

/** Where the striking face of a hammer() ends up (for the sparks). */
function faceOf({ x = 512, y = 512, angle = 38, scale = 1 } = {}, local = { x: 236, y: -122 }) {
  const a = (angle * Math.PI) / 180;
  return { x: x + (local.x * Math.cos(a) - local.y * Math.sin(a)) * scale, y: y + (local.x * Math.sin(a) + local.y * Math.cos(a)) * scale };
}

/** A burst of sparks flying off the hammer face. */
function sparks(cx, cy, scale = 1) {
  const rays = [
    [-58, 92], [-30, 120], [0, 104], [28, 128], [58, 96], [-82, 70], [84, 74],
  ];
  const lines = rays
    .map(([deg, len], i) => {
      const a = ((deg - 90) * Math.PI) / 180;
      const r0 = 26 * scale;
      const r1 = (len + (i % 2) * 14) * scale;
      return `<line x1="${(cx + Math.cos(a) * r0).toFixed(1)}" y1="${(cy + Math.sin(a) * r0).toFixed(1)}" x2="${(cx + Math.cos(a) * r1).toFixed(1)}" y2="${(cy + Math.sin(a) * r1).toFixed(1)}" stroke="${i % 3 === 0 ? '#ffffff' : '#ffc27e'}" stroke-width="${(i % 2 ? 7 : 9) * scale}" stroke-linecap="round"/>`;
    })
    .join('');
  return `<g opacity=".95">${lines}</g>${svgSparkle(cx, cy, 120 * scale, 1)}`;
}

const ring = ({ cx = 512, cy = 512, r = 300, w = 46 } = {}) => `
  <circle cx="${cx}" cy="${cy}" r="${r + 60}" fill="#ff8a2b" opacity=".38" filter="url(#glowSoft)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#ffb06a" stroke-width="${w * 1.6}" opacity=".55" filter="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${r - w / 2 + 1}" fill="url(#core)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="url(#amber)" stroke-width="${w}"/>`;

const darkDefs = (cy = 0.5) => `
    <radialGradient id="bgDark" cx=".5" cy="${cy}" r=".75">
      <stop offset="0" stop-color="#4a2309"/><stop offset=".42" stop-color="#1d0e05"/><stop offset="1" stop-color="#080402"/>
    </radialGradient>
    <radialGradient id="core" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#120a05"/><stop offset=".72" stop-color="#1a0d05"/><stop offset=".93" stop-color="#5a2a0a"/><stop offset="1" stop-color="#d9620f"/>
    </radialGradient>`;

/** Two-tone HAMMER|SHOP wordmark (SVG text). */
function wordmark({ x = 512, y = 900, size = 150, spacing = 4, outline = '#120903', outlineWidth = 12, glow = true } = {}) {
  const t = (attrs, a = 'url(#word)', b = 'url(#wordOrange)') =>
    `<text x="${x}" y="${y}" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="${size}" letter-spacing="${spacing}" ${attrs}><tspan fill="${a}">${THEME.brandA}</tspan><tspan fill="${b}">${THEME.brandB}</tspan></text>`;
  return `
  ${glow ? t('opacity=".85" filter="url(#blur22)"', '#ff8a2b', '#ff8a2b') : ''}
  ${t('opacity=".75" filter="url(#blur14)" transform="translate(0 12)"', '#050201', '#050201')}
  ${outlineWidth ? t(`stroke="${outline}" stroke-width="${outlineWidth}" stroke-linejoin="round" paint-order="stroke"`) : t('')}`;
}

/** Concept A – "Forge" (default server icon): a glowing amber ring with the hammer striking sparks. */
function logoHammerSvg() {
  const h = { x: 506, y: 530, angle: 38, scale: 1.08 };
  const f = faceOf(h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}${darkDefs()}</defs>
  <rect width="1024" height="1024" fill="url(#bgDark)"/>
  ${stars(90, 1024, 7, { minR: 1, maxR: 2.6, margin: 30 })}
  ${ring({ cx: 512, cy: 512, r: 318, w: 48 })}
  <g filter="url(#shadow)">${hammer(h)}</g>
  <circle cx="${f.x}" cy="${f.y}" r="54" fill="#ffd2a0" opacity=".55" filter="url(#glow)"/>
  ${sparks(f.x, f.y, 1.05)}
  ${svgSparkle(214, 232, 46, 0.8)}${svgSparkle(832, 812, 30, 0.55, THEME.accent)}${svgSparkle(170, 800, 22, 0.45)}
</svg>`;
}

/** Concept B – emblem + HAMMERSHOP wordmark (bot avatar, socials). */
function logoWordmarkSvg() {
  const h = { x: 505, y: 415, angle: 38, scale: 0.88 };
  const f = faceOf(h);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}${darkDefs(0.42)}</defs>
  <rect width="1024" height="1024" fill="url(#bgDark)"/>
  ${stars(90, 1024, 13, { minR: 1, maxR: 2.6, margin: 30 })}
  ${ring({ cx: 512, cy: 400, r: 238, w: 40 })}
  <g filter="url(#shadow)">${hammer(h)}</g>
  <circle cx="${f.x}" cy="${f.y}" r="44" fill="#ffd2a0" opacity=".55" filter="url(#glow)"/>
  ${sparks(f.x, f.y, 0.82)}
  ${wordmark({ x: 512, y: 832, size: 106, spacing: 2, outlineWidth: 11 })}
  <text x="512" y="902" text-anchor="middle" font-family="Montserrat" font-weight="700" font-size="28" letter-spacing="12" fill="#ffc27e" opacity=".9">SZYBKO · BEZPIECZNIE · UCZCIWIE</text>
  ${svgSparkle(190, 180, 40, 0.75)}${svgSparkle(850, 640, 26, 0.5, THEME.accent)}
</svg>`;
}

/** Concept C – "HS" monogram across the amber ring, a small hammer on top. */
function logoMonogramSvg() {
  const cx = 512;
  const cy = 520;
  const fontSize = 330;
  const baseline = cy + fontSize * 0.355;
  const word = (attrs) => `<text x="${cx}" y="${baseline}" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="${fontSize}" letter-spacing="4" ${attrs}>HS</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}${darkDefs()}</defs>
  <rect width="1024" height="1024" fill="url(#bgDark)"/>
  ${stars(95, 1024, 11, { minR: 1, maxR: 2.6, margin: 30 })}
  ${ring({ cx, cy, r: 300, w: 46 })}
  ${word('fill="#ff8a2b" opacity=".9" filter="url(#blur22)"')}
  ${word('fill="#050201" opacity=".7" filter="url(#blur14)" transform="translate(0 16)"')}
  ${word('fill="url(#word)" stroke="#120903" stroke-width="16" stroke-linejoin="round" paint-order="stroke"')}
  <g filter="url(#shadow)">${hammer({ x: 790, y: 262, angle: 38, scale: 0.4, outlineWidth: 24 })}</g>
  ${sparks(faceOf({ x: 790, y: 262, angle: 38, scale: 0.4 }).x, faceOf({ x: 790, y: 262, angle: 38, scale: 0.4 }).y, 0.5)}
  ${svgSparkle(228, 240, 70, 1)}${svgSparkle(828, 836, 30, 0.55, THEME.accent)}${svgSparkle(196, 846, 22, 0.45)}
</svg>`;
}

/** Concept D – "Neon": a bright light-orange tile with a white hammer and the name – pops in the server list. */
function logoNeonSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}
    <linearGradient id="bgC" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd9a8"/><stop offset=".32" stop-color="#ffb05c"/><stop offset=".7" stop-color="#ff8a2b"/><stop offset="1" stop-color="#d4560b"/>
    </linearGradient>
    <radialGradient id="shine" cx=".25" cy=".15" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <filter id="tileShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#7a2e00" flood-opacity=".55"/></filter>
  </defs>
  <rect width="1024" height="1024" fill="url(#bgC)"/>
  <rect width="1024" height="1024" fill="url(#shine)"/>
  ${stars(36, 1024, 5, { minR: 1.5, maxR: 3.5, margin: 40, color: '#ffffff' })}
  <g filter="url(#tileShadow)">${hammer({ x: 512, y: 400, angle: 38, scale: 1.0, flat: '#ffffff', outline: '#ffffff', outlineWidth: 0 })}</g>
  ${svgSparkle(760, 170, 64, 1)}${svgSparkle(830, 250, 28, 0.85)}
  <text x="512" y="850" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="106" letter-spacing="2" fill="#ffffff" filter="url(#tileShadow)">${THEME.brand}</text>
</svg>`;
}

/** Concept E – "Bag": an amber shopping bag with the hammer stamped on it. */
function logoBagSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}${darkDefs(0.55)}
    <linearGradient id="bag" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffd6a3"/><stop offset=".45" stop-color="#ffa64d"/><stop offset="1" stop-color="#e2650f"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bgDark)"/>
  ${stars(80, 1024, 17, { minR: 1, maxR: 2.6, margin: 30 })}
  <ellipse cx="512" cy="560" rx="360" ry="330" fill="#ff8a2b" opacity=".35" filter="url(#glowSoft)"/>
  <path d="M392 330 v-40 a120 120 0 0 1 240 0 v40" fill="none" stroke="#120903" stroke-width="64" stroke-linecap="round"/>
  <path d="M392 330 v-40 a120 120 0 0 1 240 0 v40" fill="none" stroke="url(#steel)" stroke-width="36" stroke-linecap="round"/>
  <g filter="url(#shadow)">
    <path d="M262 318 h500 a34 34 0 0 1 34 32 l26 444 a52 52 0 0 1 -52 56 h-516 a52 52 0 0 1 -52 -56 l26 -444 a34 34 0 0 1 34 -32z" fill="#120903"/>
    <path d="M270 330 h484 a26 26 0 0 1 26 25 l25 436 a42 42 0 0 1 -42 44 h-502 a42 42 0 0 1 -42 -44 l25 -436 a26 26 0 0 1 26 -25z" fill="url(#bag)"/>
    <path d="M286 346 h452" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/>
  </g>
  ${hammer({ x: 512, y: 610, angle: 38, scale: 0.78, flat: '#1a0c04', outline: '#1a0c04', outlineWidth: 0 })}
  ${svgSparkle(800, 210, 60, 1)}${svgSparkle(864, 290, 26, 0.75)}${svgSparkle(190, 820, 30, 0.5, THEME.accent)}
</svg>`;
}

const LOGOS = {
  hammer: () => logoHammerSvg(),
  'hammer-wordmark': () => logoWordmarkSvg(),
  monogram: () => logoMonogramSvg(),
  neon: () => logoNeonSvg(),
  bag: () => logoBagSvg(),
};

function logoHtml(name, size = 1024) {
  const css = `svg{display:block;width:${size}px;height:${size}px}`;
  return page(LOGOS[name](), css, { width: size, height: size });
}

// ───────────── Server banner (960 × 540) ─────────────

function serverBannerHtml() {
  const h = { x: 158, y: 282, angle: 38, scale: 0.44 };
  const f = faceOf(h);
  const body = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540" width="960" height="540">
  <defs>${LOGO_DEFS}
    <radialGradient id="sbBg" cx=".5" cy=".42" r=".8"><stop offset="0" stop-color="#3a1c09"/><stop offset=".5" stop-color="#140a05"/><stop offset="1" stop-color="#070402"/></radialGradient>
    <radialGradient id="sbGlow" cx=".5" cy="1.1" r=".7"><stop offset="0" stop-color="#ff8a2b" stop-opacity=".75"/><stop offset=".45" stop-color="#ea6212" stop-opacity=".3"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="960" height="540" fill="url(#sbBg)"/>
  <rect width="960" height="540" fill="url(#sbGlow)"/>
  ${stars(70, 960, 3, { minR: 1, maxR: 2.4, margin: 20, height: 540 })}
  <g filter="url(#shadow)">${hammer(h)}</g>
  ${sparks(f.x, f.y, 0.5)}
  ${wordmark({ x: 618, y: 300, size: 70, spacing: 2, outlineWidth: 9 })}
  <text x="618" y="350" text-anchor="middle" font-family="Montserrat" font-weight="600" font-size="17" letter-spacing="7" fill="#ffc27e" opacity=".9">SZYBKO · BEZPIECZNIE · UCZCIWIE</text>
  ${svgSparkle(880, 90, 30, 0.7)}${svgSparkle(90, 470, 18, 0.45, THEME.accent)}${svgSparkle(900, 470, 14, 0.4)}
</svg>`;
  return page(body, 'svg{display:block}', { width: 960, height: 540 });
}

// ───────────── The Hammer Launcher server (BOT_PROFILE=launcher) ─────────────
// Its own pictures: the big H instead of the hammer, "HAMMER LAUNCHER" instead of HammerShop. The emojis are shared.

/** The launcher's H (assets/brand/logo-h.png – the launcher's own logo) as a data URI. */
const hLogo = () => `data:image/png;base64,${fs.readFileSync(path.join(OUT, 'brand', 'logo-h.png')).toString('base64')}`;

/** Banners of the launcher server's channels – the same look, with the launcher's mark in the corner. */
const LAUNCHER_BANNERS = [
  ['verification', 'WERYFIKACJA', 'solid/shield-halved', { badge: 'check' }],
  ['rules', 'REGULAMIN', 'solid/gavel'],
  ['welcome', 'WITAMY', 'solid/hand'],
  ['discord', 'O NAS', 'solid/circle-info'],
  ['channels', 'KANAŁY', 'solid/hashtag'],
  ['staff', 'ZESPÓŁ', 'solid/user-shield'],
  ['contact', 'KONTAKT', 'solid/envelope'],
  ['join-us', 'DOŁĄCZ DO NAS', 'solid/user-plus'],
  ['announcements', 'OGŁOSZENIA', 'solid/bullhorn'],
  ['roles', 'ROLE', 'solid/masks-theater'],
  ['launcher', 'POBIERZ', 'solid/download'],
  ['updates', 'AKTUALIZACJE', 'solid/rocket'],
  ['whats-new', 'AKTUALNOŚCI', 'solid/newspaper'],
  ['plus', 'HAMMER+', 'solid/crown'],
  ['faq', 'FAQ', 'solid/circle-question'],
  ['support', 'POMOC', 'solid/headset'],
  ['bugs', 'ZGŁOŚ BŁĄD', 'solid/bug'],
  ['suggestions', 'PROPOZYCJE', 'solid/lightbulb'],
  ['media', 'ZRZUTY EKRANU', 'solid/image'],
  ['servers', 'SERWERY', 'solid/server'],
  ['giveaways', 'GIVEAWAYE', 'solid/gift'],
  ['leaderboard', 'RANKING', 'solid/trophy'],
  ['boosters', 'BOOSTERZY', 'solid/gem'],
  ['chat', 'CZAT', 'solid/comments'],
];

const LAUNCHER_BG = `radial-gradient(ellipse 75% 70% at 50% 46%, #4a2a0c 0%, #1a0f07 52%, #080503 100%)`;

/** The server icon: the H on a dark, warm background (1024 × 1024 – Discord rounds it itself). */
function launcherLogoHtml(size = 1024) {
  const css = `.lg{position:relative;width:${size}px;height:${size}px;background:${LAUNCHER_BG};overflow:hidden}
.lg::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 60% 40% at 50% 108%, rgba(255,150,40,.55), rgba(0,0,0,0) 70%)}
.lg img{position:absolute;left:50%;top:50%;width:70%;transform:translate(-50%,-50%);filter:drop-shadow(0 ${size * 0.02}px ${size * 0.05}px rgba(0,0,0,.7)) drop-shadow(0 0 ${size * 0.06}px rgba(255,190,40,.45))}`;
  return page(`<div class="lg"><img src="${hLogo()}" alt=""></div>`, css, { width: size, height: size });
}

/** The server banner (960 × 540). */
function launcherServerBannerHtml() {
  const css = `.sb{position:relative;width:960px;height:540px;background:${LAUNCHER_BG};overflow:hidden;font-family:Montserrat}
.sb::after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse 70% 45% at 50% 112%, rgba(255,138,43,.7), rgba(0,0,0,0) 72%)}
.sb img{position:absolute;left:92px;top:50%;height:300px;transform:translateY(-52%);filter:drop-shadow(0 14px 30px rgba(0,0,0,.7)) drop-shadow(0 0 40px rgba(255,190,40,.4));z-index:1}
.sb .t{position:absolute;left:410px;top:176px;z-index:1;line-height:.95;font-weight:900;font-size:86px;letter-spacing:-.01em}
.sb .t .a{display:block;color:#fff}.sb .t .b{display:block;color:${THEME.iconMid}}
.sb .s{position:absolute;left:414px;top:372px;z-index:1;font-weight:600;font-size:17px;letter-spacing:6px;color:#ffc27e;opacity:.9}`;
  return page(`<div class="sb"><img src="${hLogo()}" alt=""><div class="t"><span class="a">HAMMER</span><span class="b">LAUNCHER</span></div><div class="s">MINECRAFT · MODY · FPS BOOST</div></div>`, css, { width: 960, height: 540 });
}

/** The :hs_logo: emoji of the launcher server – the H alone, on nothing. */
function launcherEmojiHtml() {
  return page(`<div class="em"><img src="${hLogo()}" alt=""></div>`, `.em{width:128px;height:128px;display:flex;align-items:center;justify-content:center}.em img{height:122px;width:auto}`, { width: 128, height: 128 });
}

// ───────────── Website pictures (web/public/assets) ─────────────

const WEB_OUT = path.join(ROOT, 'web', 'public', 'assets');

/** The hammer alone as an SVG file, cropped to its own size (the website logo and the member card watermark). */
function hammerMarkSvg({ flat = null } = {}) {
  const h = { x: 0, y: 0, angle: 38, scale: 1, flat, outline: flat ?? '#120903', outlineWidth: flat ? 0 : 16 };
  const a = (h.angle * Math.PI) / 180;
  const pad = flat ? 0 : 20;
  const corners = [[-246 - pad, -222 - pad], [206 + pad, -222 - pad], [206 + pad, 332 + pad], [-246 - pad, 332 + pad]].map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const vb = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)].map((n) => Math.round(n));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}"><defs>${LOGO_DEFS}</defs>${hammer(h)}</svg>`;
}

/** Product art for the "games" category (the original showed the NØX name) – no game covers, just the brand. */
function gamesArtHtml() {
  const feature = (icon, a, b) => `<div class="f"><span>${svg(icon, { fill: 'url(#ig)' })}</span><b>${a}<br>${b}</b></div>`;
  const css = `
.art{position:relative;width:1024px;height:1024px;overflow:hidden;background:
  radial-gradient(ellipse 55% 45% at 50% 40%, rgba(${THEME.glow},.45) 0%, rgba(${THEME.glowDeep},.16) 45%, rgba(0,0,0,0) 72%),
  radial-gradient(ellipse 80% 40% at 50% 112%, rgba(${THEME.glow},.55) 0%, rgba(0,0,0,0) 75%),
  linear-gradient(180deg, #0c0806 0%, #140c07 60%, #26140a 100%)}
.ring{position:absolute;left:262px;top:118px;width:500px;height:500px;border-radius:50%;border:30px solid transparent;
  background:linear-gradient(#120a05,#120a05) padding-box, linear-gradient(135deg,#fff3e2,#ffc27e 35%,#ff8a2b 70%,#d4560b) border-box;
  box-shadow:0 0 60px rgba(${THEME.glow},.65), 0 0 140px rgba(${THEME.glowDeep},.45), inset 0 0 70px rgba(${THEME.glowDeep},.45)}
.pad{position:absolute;left:337px;top:233px;width:350px;height:270px;filter:drop-shadow(0 0 22px rgba(${THEME.glow},.95)) drop-shadow(0 18px 24px rgba(0,0,0,.6))}
.pad svg{width:100%;height:100%}
.t{position:absolute;left:0;right:0;top:672px;text-align:center;font-weight:900;font-size:84px;letter-spacing:2px;line-height:1;color:#fff;filter:drop-shadow(0 10px 16px rgba(0,0,0,.7))}
.t em{font-style:normal;background:linear-gradient(180deg,#ffd7a6,#ffa34a 55%,#f07a1c);-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{position:absolute;left:0;right:0;top:782px;text-align:center;font-weight:700;font-size:24px;letter-spacing:12px;color:${THEME.accent}}
.row{position:absolute;left:90px;right:90px;bottom:70px;display:flex;justify-content:space-between;align-items:center;padding:22px 34px;border-radius:22px;
  background:rgba(14,9,5,.72);border:2px solid rgba(${THEME.glow},.55);box-shadow:0 0 30px rgba(${THEME.glow},.25)}
.f{display:flex;align-items:center;gap:14px}.f span{width:44px;height:44px}.f svg{width:100%;height:100%}
.f b{font-weight:800;font-size:17px;letter-spacing:2.5px;color:#fff;line-height:1.3}`;
  const body = `${iconGradient}<div class="art">
  ${sparkle(140, 120, 34, 0.8)}${sparkle(850, 170, 22, 0.6)}${sparkle(880, 560, 16, 0.5, THEME.accent)}${sparkle(110, 600, 14, 0.4)}
  <div class="ring"></div><div class="pad">${svg('solid/gamepad', { fill: 'url(#ig)' })}</div>
  <div class="t">KOLEKCJA <em>GIER</em></div><div class="sub">OD ${THEME.brand}</div>
  <div class="row">${feature('solid/bolt', 'SZYBKA', 'DOSTAWA')}${feature('solid/shield-halved', 'BEZPIECZNA', 'PŁATNOŚĆ')}${feature('solid/desktop', 'GRY', 'NA PC')}</div>
</div>`;
  return page(body, css, { width: 1024, height: 1024 });
}

// ───────────── Render ─────────────

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    const globalDirs = [process.env.NODE_PATH, '/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules'].filter(Boolean);
    for (const dir of globalDirs) {
      try {
        return require(path.join(dir, 'playwright'));
      } catch {
        // try the next location
      }
    }
    console.error('Playwright is required to render assets: npm i -D playwright');
    process.exit(1);
  }
}

async function main() {
  const { chromium } = loadPlaywright();
  const launch = {};
  if (fs.existsSync('/opt/pw-browsers/chromium')) launch.executablePath = '/opt/pw-browsers/chromium';
  const browser = await chromium.launch(launch).catch(() => chromium.launch());
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const pageObj = await ctx.newPage();

  async function render(html, file, { width, height, transparent = false, type = 'png' }) {
    await pageObj.setViewportSize({ width, height });
    await pageObj.setContent(html, { waitUntil: 'load' });
    await pageObj.evaluate(() => document.fonts.ready);
    await pageObj.waitForFunction(() => window.__ready !== false);
    await pageObj.waitForTimeout(30);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await pageObj.screenshot({ path: file, clip: { x: 0, y: 0, width, height }, ...(type === 'jpeg' ? { type, quality: 88 } : { omitBackground: transparent }) });
  }

  const only = process.argv[2];
  const one = process.argv[3]; // "banners launcher" → just that banner (the others keep their bytes)
  if (!only || only === 'banners') {
    for (const [key, title, icon, opts] of BANNERS) {
      if (one && key !== one) continue;
      await render(bannerHtml(title, icon, opts), path.join(OUT, 'banners', `${key}.png`), { width: 1080, height: 400 });
      process.stdout.write(`banner ${key}\n`);
    }
  }
  if (!only || only === 'emojis') {
    for (const [name, spec] of Object.entries(EMOJIS)) {
      await render(emojiHtml(spec), path.join(OUT, 'emojis', `${name}.png`), { width: 128, height: 128, transparent: true });
      process.stdout.write(`emoji ${name}\n`);
    }
  }
  if (!only || only === 'brand') {
    for (const name of Object.keys(LOGOS)) {
      await render(logoHtml(name), path.join(OUT, 'brand', `logo-${name}.png`), { width: 1024, height: 1024 });
      process.stdout.write(`logo ${name}\n`);
    }
    await render(serverBannerHtml(), path.join(OUT, 'brand', 'server-banner.png'), { width: 960, height: 540 });
    process.stdout.write('server banner\n');
  }
  if (!only || only === 'launcher') {
    for (const [key, title, icon, opts] of LAUNCHER_BANNERS) {
      if (one && key !== one) continue;
      await render(bannerHtml(title, icon, { ...opts, brand: 'launcher' }), path.join(OUT, 'banners-launcher', `${key}.png`), { width: 1080, height: 400 });
      process.stdout.write(`launcher banner ${key}\n`);
    }
    if (!one) {
      await render(launcherLogoHtml(), path.join(OUT, 'brand', 'logo-launcher.png'), { width: 1024, height: 1024 });
      await render(launcherServerBannerHtml(), path.join(OUT, 'brand', 'server-banner-launcher.png'), { width: 960, height: 540 });
      await render(launcherEmojiHtml(), path.join(OUT, 'emojis-launcher', 'logo.png'), { width: 128, height: 128, transparent: true });
      fs.mkdirSync(WEB_OUT, { recursive: true });
      await render(launcherLogoHtml(256), path.join(WEB_OUT, 'launcher-icon.png'), { width: 256, height: 256 });
      fs.copyFileSync(path.join(OUT, 'brand', 'logo-h.png'), path.join(WEB_OUT, 'launcher-h.png'));
      process.stdout.write('launcher logo, server banner, emoji, website icon\n');
    }
  }
  if (!only || only === 'web') {
    fs.mkdirSync(WEB_OUT, { recursive: true });
    fs.writeFileSync(path.join(WEB_OUT, 'hammershop-mark.svg'), hammerMarkSvg());
    fs.writeFileSync(path.join(WEB_OUT, 'hammershop-mark-flat.svg'), hammerMarkSvg({ flat: '#ffffff' }));
    await render(logoHtml('hammer', 640), path.join(WEB_OUT, 'hammershop-hero.png'), { width: 640, height: 640 });
    await render(logoHtml('hammer', 256), path.join(WEB_OUT, 'hammershop-icon.png'), { width: 256, height: 256 });
    await render(gamesArtHtml(), path.join(WEB_OUT, 'hammershop-games.jpg'), { width: 1024, height: 1024, type: 'jpeg' });
    process.stdout.write('website pictures\n');
  }
  await browser.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { THEME, BANNERS, EMOJIS, LOGOS, bannerHtml, emojiHtml, serverBannerHtml, logoHtml, hammerMarkSvg, gamesArtHtml };
