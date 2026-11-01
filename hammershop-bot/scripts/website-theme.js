'use strict';

/**
 * HammerShop look for the store website (web/public/index.html): light orange instead of purple, the hammer logo
 * instead of the Ø, the HammerShop name, its own pictures and the Polish texts (scripts/website-pl.js).
 * build-website.js runs it last; it can also be run on
 * its own – it is safe to run twice:
 *
 *   node scripts/website-theme.js            (themes web/public/index.html in place)
 *
 * The pictures it points to (web/public/assets/hammershop-*) come from: npm run render-assets -- web
 */

const fs = require('node:fs');
const path = require('node:path');
const { translate } = require('./website-pl');

const BRAND = 'HammerShop';
/** Pictures of the original design → HammerShop pictures (from npm run render-assets -- web). */
const IMAGES = {
  '/assets/img-4ae03cdb79.png': '/assets/hammershop-hero.png', // hero (was the NØX eclipse)
  '/assets/img-3feb6b3344.png': '/assets/hammershop-icon.png', // favicon + account dialog
  '/assets/img-e0087180ac.jpg': '/assets/hammershop-games.jpg', // "games" product art
};

// ───────────── Colours: every purple → the same lightness in orange ─────────────

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

/** Violet / purple / magenta (hue 235–335°) → orange (hue ≈ 20–38°); greys, greens and reds stay as they are. */
function shift(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 0.06 || h < 235 || h > 335) return null;
  return hslToRgb(28 + (h - 280) * 0.18, Math.min(1, s * 1.04), l);
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

function shiftHex(all, body) {
  const short = body.length <= 4;
  const full = short ? [...body].map((c) => c + c).join('') : body;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  const out = shift(r, g, b);
  if (!out) return all;
  const alpha = full.length === 8 ? full.slice(6) : '';
  return `#${out.map(hex2).join('')}${alpha}`;
}

function recolor(html) {
  return html
    .replace(/(?<=[\s:,("'=])#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g, shiftHex)
    .replace(/rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})(\s*[,/][^)]*)?\)/g, (all, r, g, b, rest = '') => {
      const out = shift(Number(r), Number(g), Number(b));
      if (!out) return all;
      return `${all.startsWith('rgba') ? 'rgba' : 'rgb'}(${out.join(all.includes(', ') ? ', ' : ',')}${rest})`;
    });
}

// ───────────── Name and logo ─────────────

const LOGO_FROM = '(0,d.jsxs)("span",{className:"logo",children:[(0,d.jsx)("i",{children:"\\xD8"}),"N\\xD8X",(0,d.jsx)("sup",{children:"\\xAE"})]})';
const LOGO_TO = '(0,d.jsxs)("span",{className:"logo",children:[(0,d.jsx)("i",{"aria-hidden":"true"}),"Hammer",(0,d.jsx)("b",{children:"Shop"})]})';

/** NØX → HammerShop; in all-caps text (eyebrows like "THE NØX UNIVERSE") → HAMMERSHOP. */
function rename(html) {
  // Only the same piece of text counts (stops at quotes and tags); escapes like \\xD8 are skipped.
  const letters = (piece) => piece.replace(/\\x[0-9A-Fa-f]{2}|\\u[0-9A-Fa-f]{4}/g, '').replace(/[^A-Za-z]/g, '');
  const caps = (text, at, len) => {
    const before = text.slice(Math.max(0, at - 30), at).split(/["<>]/).pop();
    const after = text.slice(at + len, at + len + 30).split(/["<>]/)[0];
    const near = `${letters(before).slice(-4)}${letters(after).slice(0, 4)}`;
    return near.length >= 2 && near === near.toUpperCase();
  };
  return html.replace(/N\\xD8X|NØX|N&Oslash;X/g, (m, at, text) => (caps(text, at, m.length) ? BRAND.toUpperCase() : BRAND));
}

const CSS = `
/* HammerShop: the hammer instead of the Ø, a two-tone name, the hammer on the member card */
.logo,.card-top .logo,.footer-top .logo{gap:0;letter-spacing:-1.2px}
.logo i{width:1.15em;height:1.15em;font-size:inherit;margin-right:.3em;transform:none;background:url(/assets/hammershop-mark.svg) center/contain no-repeat;filter:drop-shadow(0 0 10px #ff8a2b55)}
.logo b{font-weight:900;color:#ffa94d}
.card-top .logo i{display:none}
.access-card:after{content:"";font-size:0;width:270px;height:270px;top:-46px;right:-64px;opacity:.07;background:url(/assets/hammershop-mark-flat.svg) center/contain no-repeat}
.eclipse{filter:saturate(1.05)}
`;

function applyTheme(input) {
  let html = input;
  html = html.split(LOGO_FROM).join(LOGO_TO);
  html = rename(html);
  for (const [from, to] of Object.entries(IMAGES)) html = html.split(from).join(to);
  html = html
    .split('HammerShop eclipse logo').join('HammerShop logo')
    .split('children:"nox.app"').join('children:"hammershop.pl"')
    .split('"terminal-user",children:[(0,d.jsx)("b",{children:"N"})').join('"terminal-user",children:[(0,d.jsx)("b",{children:"H"})')
    .split('"server-rail",children:[(0,d.jsx)(Ma,{size:16}),(0,d.jsx)("span",{children:"N"})').join('"server-rail",children:[(0,d.jsx)(Ma,{size:16}),(0,d.jsx)("span",{children:"H"})')
    .split('/api/nox/').join('/api/shop/')
    .split('"nox-root"').join('"hs-root"')
    .split('"nox-bag"').join('"hs-bag"')
    .split('id="nox-fixes"').join('id="hs-fixes"');
  html = recolor(html);
  // The theme's own styles – replaced when run again, so a changed CSS here always lands.
  const block = `<style id="hs-theme">${CSS}</style>`;
  html = html.includes('<style id="hs-theme">') ? html.replace(/<style id="hs-theme">[\s\S]*?<\/style>/, () => block) : html.replace('</head>', () => `${block}</head>`);
  // Last: the texts in Polish (scripts/website-pl.js – it matches the pieces as they read after the renaming above).
  html = translate(html);
  return html;
}

if (require.main === module) {
  const file = path.join(__dirname, '..', 'web', 'public', 'index.html');
  const before = fs.readFileSync(file, 'utf8');
  const after = applyTheme(before);
  fs.writeFileSync(file, after);
  const missing = Object.values(IMAGES).concat(['/assets/hammershop-mark.svg', '/assets/hammershop-mark-flat.svg']).filter((p) => after.includes(p) || p.endsWith('.svg')).filter((p) => !fs.existsSync(path.join(__dirname, '..', 'web', 'public', p)));
  console.log(`web/public/index.html themed for ${BRAND} (${(after.length / 1024).toFixed(0)} KB)${missing.length ? ` – missing pictures, run "npm run render-assets -- web": ${missing.join(', ')}` : ''}`);
}

module.exports = { applyTheme, recolor, rename, shift };
