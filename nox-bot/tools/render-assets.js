'use strict';

/**
 * Renders every NØX image asset (channel banners, custom emojis, server icon and banner)
 * from HTML/SVG templates using a headless Chromium browser.
 *
 *   npm install            (installs the icon + font packages from devDependencies)
 *   npm i -D playwright    (only if Playwright is not installed globally)
 *   npm run render-assets
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

const THEME = {
  brand: 'NØX',
  // Icon gradient (top → bottom) and glow
  iconTop: '#f5ecff',
  iconMid: '#c98bff',
  iconBottom: '#8b3dff',
  glow: '168, 85, 247',
  glowDeep: '109, 40, 217',
  // Emoji tile gradient
  tileLight: '#c98bff',
  tileMid: '#9a4dff',
  tileDark: '#5b1fc4',
};

// ───────────── Banners (1080 × 400) ─────────────
// 25 remakes of the original pack (translated to English) + shop extras.
const BANNERS = [
  ['shop', 'SHOP', 'solid/store'],
  ['purchase', 'PURCHASE', 'solid/cart-shopping', { badge: 'check' }],
  ['rules', 'RULES', 'solid/gavel'],
  ['support', 'SUPPORT', 'solid/headset'],
  ['giveaways', 'GIVEAWAYS', 'solid/gift'],
  ['announcements', 'ANNOUNCEMENTS', 'solid/bullhorn'],
  ['discord', 'DISCORD', 'brands/discord'],
  ['join-us', 'JOIN US', 'solid/user-plus'],
  ['vouches', 'VOUCHES', 'solid/comment-dots'],
  ['partners', 'PARTNERS', 'solid/handshake'],
  ['staff', 'STAFF', 'solid/user-shield'],
  ['updates', 'UPDATES', 'solid/bell'],
  ['help', 'HELP', 'solid/circle-question'],
  ['verification', 'VERIFICATION', 'solid/shield-halved', { badge: 'check' }],
  ['channels', 'CHANNELS', 'solid/hashtag'],
  ['boosters', 'BOOSTERS', 'solid/rocket'],
  ['leaderboard', 'LEADERBOARD', 'solid/trophy'],
  ['media', 'MEDIA', 'solid/photo-film'],
  ['memes', 'MEMES', 'solid/face-laugh-squint'],
  ['events', 'EVENTS', 'solid/calendar-days'],
  ['vip', 'VIP', 'solid/crown'],
  ['bot-commands', 'BOT COMMANDS', 'solid/robot'],
  ['contact', 'CONTACT', 'solid/envelope'],
  ['whats-new', "WHAT'S NEW", 'solid/newspaper'],
  ['welcome', 'WELCOME', 'solid/hand'],
  // extras for the shop layout
  ['tickets', 'TICKETS', 'solid/ticket'],
  ['payments', 'PAYMENTS', 'solid/credit-card'],
  ['roles', 'ROLES', 'solid/masks-theater'],
  ['faq', 'FAQ', 'solid/circle-question'],
  ['restocks', 'RESTOCKS', 'solid/box-open'],
  ['information', 'INFORMATION', 'solid/circle-info'],
  ['how-to-buy', 'HOW TO BUY', 'solid/bag-shopping'],
  ['products', 'PRODUCTS', 'solid/tags'],
  ['chat', 'CHAT', 'solid/comments'],
  ['reviews', 'REVIEWS', 'solid/star'],
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
  // NØX extras used by the bot UI
  ticket: { fa: 'solid/ticket' },
  shield: { fa: 'solid/shield-halved', badge: 'check' },
  box: { fa: 'solid/box-open' },
  sparkles: { fa: 'solid/wand-magic-sparkles' },
  card: { fa: 'solid/credit-card' },
  crypto: { fa: 'brands/bitcoin' },
  paypal: { fa: 'brands/paypal' },
  nox: { logo: true },
};

// ───────────── Helpers ─────────────

function svg(name, { fill = 'currentColor', id } = {}) {
  const raw = fs.readFileSync(path.join(FA, 'svgs', `${name}.svg`), 'utf8');
  const viewBox = raw.match(/viewBox="([^"]+)"/)[1];
  const paths = [...raw.matchAll(/<path[^>]*d="([^"]+)"[^>]*\/?>/g)].map((m) => `<path d="${m[1]}"/>`).join('');
  return `<svg ${id ? `id="${id}"` : ''} xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="${fill}">${paths}</svg>`;
}

// Fonts are embedded as data URLs – Chromium blocks file:// fonts on pages created with setContent().
const fontUrl = (weight) => `data:font/woff2;base64,${fs.readFileSync(path.join(FONT_DIR, `montserrat-latin-${weight}-normal.woff2`)).toString('base64')}`;
const FONTS = [500, 600, 700, 800, 900]
  .map((w) => `@font-face{font-family:Montserrat;font-weight:${w};src:url("${fontUrl(w)}") format("woff2");}`)
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

const moonMark = (cls = 'mark') => `<span class="${cls}">${svg('solid/moon', { fill: 'url(#ig)' })}</span>`;

// ───────────── Banner template ─────────────

function bannerHtml(title, icon, opts = {}) {
  const css = `
.bn{position:relative;width:1080px;height:400px;overflow:hidden;background:#07050c}
.bg{position:absolute;inset:0;background:
  radial-gradient(ellipse 60% 85% at 63% 30%, rgba(46,40,58,.85) 0%, rgba(20,16,28,0) 70%),
  radial-gradient(ellipse 45% 70% at 25% 55%, rgba(${THEME.glowDeep},.20) 0%, rgba(0,0,0,0) 70%),
  radial-gradient(ellipse 60% 60% at 22% 120%, rgba(${THEME.glow},.85) 0%, rgba(${THEME.glowDeep},.38) 42%, rgba(0,0,0,0) 78%),
  radial-gradient(ellipse 55% 45% at 88% 118%, rgba(${THEME.glowDeep},.55) 0%, rgba(0,0,0,0) 75%),
  radial-gradient(ellipse 90% 30% at 50% 110%, rgba(${THEME.glowDeep},.30) 0%, rgba(0,0,0,0) 80%),
  linear-gradient(180deg, #0a0711 0%, #0d0915 55%, #1a0c2c 100%)}
.grid{position:absolute;inset:0;opacity:.07;background-image:
  linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px);
  background-size:40px 40px;mask-image:radial-gradient(ellipse 70% 80% at 50% 45%, #000 0%, transparent 75%);-webkit-mask-image:radial-gradient(ellipse 70% 80% at 50% 45%, #000 0%, transparent 75%)}
.streak{position:absolute;left:-10%;top:-40%;width:55%;height:180%;transform:rotate(18deg);
  background:linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,.035) 50%, rgba(255,255,255,0) 100%)}
.vig{position:absolute;inset:0;box-shadow:inset 0 0 160px rgba(0,0,0,.85)}
.line{position:absolute;left:0;right:0;bottom:0;height:3px;background:linear-gradient(90deg, rgba(${THEME.glow},0) 0%, rgba(${THEME.glow},.9) 30%, rgba(233,213,255,.95) 50%, rgba(${THEME.glow},.9) 70%, rgba(${THEME.glow},0) 100%);opacity:.55}
.content{position:absolute;left:0;right:0;top:0;height:400px;display:flex;align-items:center;justify-content:center;gap:34px;padding:0 70px 18px}
.icon{position:relative;flex:none;width:var(--is);height:var(--is);filter:drop-shadow(0 0 14px rgba(${THEME.glow},.95)) drop-shadow(0 0 42px rgba(${THEME.glowDeep},.75))}
.icon>svg{width:100%;height:100%}
.badge{position:absolute;right:-12%;bottom:-10%;width:46%;height:46%;border-radius:50%;background:#0b0812;padding:7%;}
.badge>div{width:100%;height:100%;border-radius:50%;background:linear-gradient(180deg, ${THEME.iconMid}, ${THEME.iconBottom});display:flex;align-items:center;justify-content:center}
.badge svg{width:56%;height:56%}
.title{font-weight:800;font-size:var(--fs);letter-spacing:.01em;line-height:1;white-space:nowrap;
  background:linear-gradient(180deg,#ffffff 0%,#f4f1f8 38%,#cdc6d9 72%,#a9a1b8 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 10px 14px rgba(0,0,0,.65)) drop-shadow(0 0 1px rgba(255,255,255,.35));padding:6px 0}
.pill{position:absolute;left:24px;bottom:24px;height:44px;padding:0 20px 0 14px;border-radius:22px;border:2px solid rgba(${THEME.glow},.95);
  background:rgba(9,6,14,.88);display:flex;align-items:center;gap:10px;box-shadow:0 0 18px rgba(${THEME.glow},.35), inset 0 0 12px rgba(${THEME.glow},.18)}
.pill .mark{width:22px;height:22px;filter:drop-shadow(0 0 6px rgba(${THEME.glow},.9))}
.pill .mark svg{width:100%;height:100%}
.pill b{color:#fff;font-weight:900;font-size:20px;letter-spacing:.08em}`;

  const badge = opts.badge
    ? `<div class="badge"><div>${svg('solid/check', { fill: '#0b0812' })}</div></div>`
    : '';
  const body = `${iconGradient}<div class="bn">
  <div class="bg"></div><div class="grid"></div><div class="streak"></div>
  ${sparkle(905, 60, 18, 0.55)}${sparkle(960, 95, 9, 0.4)}${sparkle(150, 70, 12, 0.35)}${sparkle(995, 300, 14, 0.3, '#d8b4fe')}${sparkle(470, 330, 8, 0.25)}
  <div class="vig"></div><div class="line"></div>
  <div class="content"><div class="icon">${svg(icon, { fill: 'url(#ig)' })}${badge}</div><div class="title">${title}</div></div>
  <div class="pill">${moonMark()}<b>${THEME.brand}</b></div>
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
  box-shadow:0 2px 3px rgba(30,0,60,.45), inset 0 1.5px 0 rgba(255,255,255,.55), inset 0 -6px 10px rgba(40,0,90,.35), inset 0 0 0 1.5px rgba(255,255,255,.18)}
.gloss{position:absolute;left:4px;right:4px;top:3px;height:56px;border-radius:26px 26px 60% 60%/26px 26px 40% 40%;
  background:linear-gradient(180deg, rgba(255,255,255,.42) 0%, rgba(255,255,255,.10) 70%, rgba(255,255,255,0) 100%)}
.g{position:absolute;left:0;top:0;width:128px;height:128px;display:flex;align-items:center;justify-content:center;padding-top:1px}
.g>svg,.g>.stack{width:60px;height:60px;filter:drop-shadow(0 2.5px 2px rgba(45,0,100,.5))}
.stack{position:relative}.stack>svg{position:absolute;inset:0;width:100%;height:100%}
.stack .inner{position:absolute;left:30%;top:28%;width:40%;height:40%}
.coin{width:66px;height:66px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;
  box-shadow:0 2.5px 2px rgba(45,0,100,.5), inset 0 -3px 0 rgba(120,60,200,.18);font-weight:900;color:${THEME.tileDark};letter-spacing:-.02em}
.coin.ring{box-shadow:0 2.5px 2px rgba(45,0,100,.5), inset 0 0 0 5px rgba(140,80,230,.22)}
.lines{position:absolute;left:24px;top:52px;width:16px}.lines i{display:block;height:5px;border-radius:3px;background:#fff;margin-bottom:9px;opacity:.85}
.badge{position:absolute;right:23px;bottom:24px;width:30px;height:30px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(45,0,100,.5)}
.badge svg{width:17px;height:17px}
.logo{font-weight:900;font-size:34px;color:#fff;letter-spacing:.02em;filter:drop-shadow(0 2.5px 2px rgba(45,0,100,.55))}`;

  let glyph;
  if (spec.coin) {
    const size = spec.coin.length > 1 ? 30 : 40;
    glyph = `<div class="coin${spec.sparkles ? ' ring' : ''}" style="font-size:${size}px">${spec.coin}</div>`;
  } else if (spec.logo) {
    glyph = `<div class="logo">${THEME.brand}</div>`;
  } else if (spec.inner) {
    glyph = `<div class="stack">${svg(spec.fa, { fill: '#fff' })}<span class="inner">${svg(spec.inner, { fill: THEME.tileDark })}</span></div>`;
  } else {
    glyph = svg(spec.fa, { fill: '#fff' });
  }
  const extras = [];
  if (spec.lines) extras.push('<div class="lines"><i></i><i style="width:70%"></i></div>');
  if (spec.badge) extras.push(`<div class="badge">${svg('solid/check', { fill: THEME.tileDark })}</div>`);
  if (spec.sparkles >= 1) extras.push(sparkle(92, 16, 14, 0.95));
  if (spec.sparkles >= 2) extras.push(sparkle(18, 88, 10, 0.85));
  const shift = spec.lines ? 'style="padding-left:14px"' : '';
  return page(`<div class="tile"><div class="gloss"></div></div><div class="g" ${shift}>${glyph}</div>${extras.join('')}`, css, { width: 128, height: 128 });
}

// ───────────── Server banner ─────────────

function serverBannerHtml() {
  const css = `
.sb{position:relative;width:960px;height:540px;overflow:hidden;background:
  radial-gradient(ellipse 60% 70% at 50% 40%, rgba(46,40,58,.9) 0%, rgba(0,0,0,0) 70%),
  radial-gradient(ellipse 70% 50% at 50% 115%, rgba(${THEME.glow},.75) 0%, rgba(${THEME.glowDeep},.3) 45%, rgba(0,0,0,0) 80%),
  linear-gradient(180deg,#09060f 0%,#120a1e 60%,#22103a 100%)}
.vig{position:absolute;inset:0;box-shadow:inset 0 0 180px rgba(0,0,0,.85)}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px}
.row{display:flex;align-items:center;gap:26px}
.moon{width:118px;height:118px;filter:drop-shadow(0 0 16px rgba(${THEME.glow},.95)) drop-shadow(0 0 48px rgba(${THEME.glowDeep},.8))}
.moon svg{width:100%;height:100%}
.t{font-weight:900;font-size:150px;line-height:1;letter-spacing:.04em;background:linear-gradient(180deg,#fff 0%,#f4f1f8 40%,#cdc6d9 75%,#a9a1b8 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 12px 16px rgba(0,0,0,.7))}
.sub{font-weight:600;font-size:22px;letter-spacing:.55em;color:#d8b4fe;opacity:.85;padding-left:.55em}`;
  const body = `${iconGradient}<div class="sb">${sparkle(160, 90, 22, 0.6)}${sparkle(800, 120, 16, 0.5)}${sparkle(840, 400, 12, 0.4, '#d8b4fe')}${sparkle(110, 420, 10, 0.35)}
  <div class="vig"></div><div class="wrap"><div class="row"><div class="moon">${svg('solid/moon', { fill: 'url(#ig)' })}</div><div class="t">${THEME.brand}</div></div>
  <div class="sub">PREMIUM · TRUSTED · FAST</div></div></div>`;
  return page(body, css, { width: 960, height: 540 });
}

// ───────────── Logos (1024 × 1024, vector) ─────────────

/** Deterministic "random" star field, so re-renders look identical. */
function stars(count, size, seed, { minR = 1, maxR = 3, margin = 0, color = '#ffffff' } = {}) {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  let out = '';
  for (let i = 0; i < count; i += 1) {
    const x = margin + rnd() * (size - 2 * margin);
    const y = margin + rnd() * (size - 2 * margin);
    const r = minR + rnd() * (maxR - minR);
    out += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}" fill="${color}" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`;
  }
  return out;
}

const svgSparkle = (x, y, size, opacity = 1, fill = '#fff') =>
  `<path transform="translate(${x - size / 2} ${y - size / 2}) scale(${size / 100})" d="${SPARKLE}" fill="${fill}" opacity="${opacity}"/>`;

const LOGO_DEFS = `
  <linearGradient id="lav" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#fbf5ff"/><stop offset=".35" stop-color="#d9aaff"/><stop offset=".7" stop-color="#a855f7"/><stop offset="1" stop-color="#6d28d9"/>
  </linearGradient>
  <linearGradient id="silver" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff"/><stop offset=".55" stop-color="#f3e8ff"/><stop offset="1" stop-color="#cfb2f5"/>
  </linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="28"/></filter>
  <filter id="glowSoft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="60"/></filter>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="#0a0018" flood-opacity=".75"/></filter>`;

/**
 * Concept A – "Eclipse Ø": the Ø of NØX drawn as a solar eclipse – a glowing ring with a
 * dark core, the diagonal stroke and a diamond-ring flare. Reads well even at 32 px.
 */
function logoEclipseSvg({ wordmark = false } = {}) {
  const cy = wordmark ? 420 : 512;
  const r = wordmark ? 200 : 245;
  const w = wordmark ? 46 : 54;
  const rad = (deg) => (deg * Math.PI) / 180;
  const d = r + w * 0.7;
  const a = rad(-56);
  const s1 = { x1: 512 - Math.cos(a) * d, y1: cy - Math.sin(a) * d, x2: 512 + Math.cos(a) * d, y2: cy + Math.sin(a) * d };
  const fx = 512 + Math.cos(rad(-128)) * r;
  const fy = cy + Math.sin(rad(-128)) * r;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}
    <radialGradient id="bgA" cx=".5" cy="${cy / 1024}" r=".72">
      <stop offset="0" stop-color="#2b0f52"/><stop offset=".45" stop-color="#150828"/><stop offset="1" stop-color="#06030b"/>
    </radialGradient>
    <radialGradient id="core" cx=".5" cy=".5" r=".5">
      <stop offset="0" stop-color="#0a0512"/><stop offset=".78" stop-color="#110720"/><stop offset=".94" stop-color="#2a0f50"/><stop offset="1" stop-color="#5b21b6"/>
    </radialGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bgA)"/>
  ${stars(90, 1024, 7, { minR: 1, maxR: 2.6, margin: 30 })}
  <circle cx="512" cy="${cy}" r="${r + 50}" fill="#8b3dff" opacity=".5" filter="url(#glowSoft)"/>
  <circle cx="512" cy="${cy}" r="${r}" fill="none" stroke="#c98bff" stroke-width="${w * 1.5}" opacity=".6" filter="url(#glow)"/>
  <circle cx="512" cy="${cy}" r="${r - w / 2 + 1}" fill="url(#core)"/>
  <circle cx="512" cy="${cy}" r="${r}" fill="none" stroke="url(#lav)" stroke-width="${w}"/>
  <line x1="${s1.x1}" y1="${s1.y1}" x2="${s1.x2}" y2="${s1.y2}" stroke="#0a0512" stroke-width="${w * 1.2}" stroke-linecap="round"/>
  <line x1="${s1.x1}" y1="${s1.y1}" x2="${s1.x2}" y2="${s1.y2}" stroke="url(#lav)" stroke-width="${w * 0.66}" stroke-linecap="round"/>
  <circle cx="${fx}" cy="${fy}" r="46" fill="#fff" opacity=".6" filter="url(#glow)"/>
  ${svgSparkle(fx, fy, 130, 1)}
  ${svgSparkle(790, 235, 40, 0.75)}${svgSparkle(250, 820, 30, 0.5, '#d8b4fe')}
  ${wordmark ? `<text x="512" y="895" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="190" letter-spacing="14" fill="url(#silver)" filter="url(#shadow)">${THEME.brand}</text>` : ''}
</svg>`;
}

/** Concept B – "Night": a big glowing crescent moon behind the NØX wordmark. */
function logoMoonSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}
    <radialGradient id="bgB" cx=".35" cy=".3" r=".85">
      <stop offset="0" stop-color="#6d28d9"/><stop offset=".35" stop-color="#3b0f75"/><stop offset=".7" stop-color="#170830"/><stop offset="1" stop-color="#07030d"/>
    </radialGradient>
    <mask id="crescent"><rect width="1024" height="1024" fill="#000"/><circle cx="470" cy="360" r="270" fill="#fff"/><circle cx="600" cy="268" r="240" fill="#000"/></mask>
  </defs>
  <rect width="1024" height="1024" fill="url(#bgB)"/>
  ${stars(110, 1024, 21, { minR: 1, maxR: 2.8, margin: 20 })}
  <g mask="url(#crescent)"><rect width="1024" height="1024" fill="#b06bff" filter="url(#glow)" opacity=".9"/></g>
  <g mask="url(#crescent)"><rect width="1024" height="1024" fill="url(#lav)"/></g>
  ${svgSparkle(760, 210, 70, 1)}${svgSparkle(845, 300, 30, 0.75)}${svgSparkle(220, 790, 34, 0.55, '#d8b4fe')}
  <text x="512" y="770" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="300" letter-spacing="8" fill="url(#silver)" filter="url(#shadow)">${THEME.brand}</text>
</svg>`;
}

/** Concept C – "Neon": a vivid purple gradient tile with a bold white wordmark – pops in the server list. */
function logoGradientSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>${LOGO_DEFS}
    <linearGradient id="bgC" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2b8ff"/><stop offset=".3" stop-color="#b266ff"/><stop offset=".65" stop-color="#7c3aed"/><stop offset="1" stop-color="#3b0764"/>
    </linearGradient>
    <radialGradient id="shine" cx=".25" cy=".15" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <mask id="cres2"><rect width="1024" height="1024" fill="#000"/><circle cx="512" cy="300" r="105" fill="#fff"/><circle cx="560" cy="262" r="92" fill="#000"/></mask>
  </defs>
  <rect width="1024" height="1024" fill="url(#bgC)"/>
  <rect width="1024" height="1024" fill="url(#shine)"/>
  ${stars(40, 1024, 5, { minR: 1.5, maxR: 3.5, margin: 40 })}
  <g mask="url(#cres2)"><rect width="1024" height="1024" fill="#fff"/></g>
  ${svgSparkle(640, 230, 50, 1)}
  <text x="512" y="700" text-anchor="middle" font-family="Montserrat" font-weight="900" font-size="300" letter-spacing="6" fill="#ffffff" filter="url(#shadow)">${THEME.brand}</text>
</svg>`;
}

const LOGOS = {
  eclipse: () => logoEclipseSvg(),
  'eclipse-wordmark': () => logoEclipseSvg({ wordmark: true }),
  night: () => logoMoonSvg(),
  neon: () => logoGradientSvg(),
};

function logoHtml(name, size = 1024) {
  const css = `svg{display:block;width:${size}px;height:${size}px}`;
  return page(LOGOS[name](), css, { width: size, height: size });
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

  async function render(html, file, { width, height, transparent = false }) {
    await pageObj.setViewportSize({ width, height });
    await pageObj.setContent(html, { waitUntil: 'load' });
    await pageObj.evaluate(() => document.fonts.ready);
    await pageObj.waitForFunction(() => window.__ready !== false);
    await pageObj.waitForTimeout(30);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await pageObj.screenshot({ path: file, clip: { x: 0, y: 0, width, height }, omitBackground: transparent });
  }

  const only = process.argv[2];
  if (!only || only === 'banners') {
    for (const [key, title, icon, opts] of BANNERS) {
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
  await browser.close();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { BANNERS, EMOJIS, LOGOS, bannerHtml, emojiHtml, serverBannerHtml, logoHtml };
