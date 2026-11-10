'use strict';

/**
 * Renders the HammerShop.pl promo banner – the picture for Discord embeds and link previews – in the black and
 * gold look of the "H" logo: the logo on a lit stage with a reflection, a metallic wordmark, the tagline in a
 * glass capsule and the categories as tiles.
 *
 *   node tools/render-promo-banner.js            → assets/brand/hammershop-pl-banner.png (1600 × 850)
 *                                                  assets/brand/hammershop-pl-banner-wide.png (1600 × 600)
 *
 * Texts are in TEXT below; the text block scales itself to the room next to the logo. Needs Playwright (Chromium)
 * like render-assets.js; the logo is assets/brand/logo-h.png.
 * Icons: Font Awesome Free (CC BY 4.0). Font: Montserrat (OFL).
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const BRAND = path.join(ROOT, 'assets', 'brand');
const FA = path.dirname(require.resolve('@fortawesome/fontawesome-free/package.json'));
const FONT_DIR = path.join(path.dirname(require.resolve('@fontsource/montserrat/package.json')), 'files');

const TEXT = {
  name: 'HammerShop',
  tld: '.pl',
  tagline: ['Cyfrowe ', 'upgrade’y', ' dla Twojego Serwera'], // the middle part is gold
  taglineIcon: 'solid/bolt',
  categories: [
    { label: 'Pluginy', icon: 'solid/puzzle-piece' },
    { label: 'Boty Discord', icon: 'solid/robot' },
    { label: 'Serwery', icon: 'solid/server' },
  ],
};

const dataUri = (file, mime) => `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
const icon = (name) => fs.readFileSync(path.join(FA, 'svgs', `${name}.svg`), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace('<svg', '<svg class="ico"');

function fontFaces() {
  const faces = [];
  for (const [weight, style] of [[700, 'italic'], [800, 'italic'], [900, 'italic']]) {
    for (const subset of ['latin', 'latin-ext']) {
      const file = path.join(FONT_DIR, `montserrat-${subset}-${weight}-${style}.woff2`);
      const range = subset === 'latin' ? 'U+0000-00FF,U+2000-206F,U+20AC,U+2122' : 'U+0100-02AF,U+1E00-1EFF';
      faces.push(`@font-face{font-family:Montserrat;font-weight:${weight};font-style:${style};src:url(${dataUri(file, 'font/woff2')}) format('woff2');unicode-range:${range}}`);
    }
  }
  return faces.join('\n');
}

/** Stable pseudo-random numbers, so sparks and light discs land in the same places on every render. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function html({ width: W, height: H }) {
  const wide = W / H > 2.2;
  const k = H / 850; // the layout is drawn for a height of 850
  const px = (n) => `${Math.round(n * k)}px`;
  const S = Math.round((wide ? 520 : 452) * k); // logo size
  const cx = Math.round((wide ? 0.19 : 0.2) * W); // logo centre
  const cy = Math.round((wide ? 0.455 : 0.45) * H);
  const logoUrl = dataUri(path.join(BRAND, 'logo-h.png'), 'image/png');
  const rand = rng(11);

  const sparks = Array.from({ length: 46 }, () => {
    const x = Math.pow(rand(), 1.5) * W * 0.7 + 16;
    const y = rand() * H;
    const size = 1.6 + rand() * 3.6;
    return `<i style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;opacity:${(0.25 + rand() * 0.65).toFixed(2)}"></i>`;
  }).join('');
  const bokeh = Array.from({ length: 11 }, (_, i) => {
    // Out-of-focus lights: a loose diagonal from the lower left to the upper right.
    const t = i / 10;
    const x = t * W + (rand() - 0.5) * 300 * k;
    const y = H * (0.95 - t * 0.9) + (rand() - 0.5) * 260 * k;
    const size = (34 + rand() * 120) * k;
    return `<i style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;width:${size.toFixed(0)}px;height:${size.toFixed(0)}px;opacity:${(0.05 + rand() * 0.13).toFixed(2)};filter:blur(${(5 + rand() * 14).toFixed(0)}px)"></i>`;
  }).join('');
  const star = (x, y, size, alpha = 1) => `<b class="star" style="left:${Math.round(x - size / 2)}px;top:${Math.round(y - size / 2)}px;width:${Math.round(size)}px;height:${Math.round(size)}px;opacity:${alpha}"></b>`;
  const cats = TEXT.categories.map((c) => `<span class="cat">${icon(c.icon)}<b>${c.label}</b></span>`).join('');
  const corners = [[1, 1], [-1, 1], [1, -1], [-1, -1]]
    .map(([sx, sy]) => {
      const m = 20 * k, r = 30 * k, len = 86 * k;
      const x = sx > 0 ? m : W - m, y = sy > 0 ? m : H - m;
      return `<path d="M ${x} ${y + sy * (r + len)} L ${x} ${y + sy * r} Q ${x} ${y} ${x + sx * r} ${y} L ${x + sx * (r + len)} ${y}" stroke="url(#gold)" stroke-width="${(3 * k).toFixed(1)}" stroke-linecap="round"/>
        <circle cx="${x + sx * (r + len + 14 * k)}" cy="${y}" r="${(2.4 * k).toFixed(1)}" fill="#ffd84d" fill-opacity=".8"/>`;
    })
    .join('');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${W}px;height:${H}px;background:#060504;overflow:hidden}
body{font-family:Montserrat,sans-serif;color:#fff;position:relative}
.bg,.bg>*{position:absolute;inset:0}

/* ── background ── */
.base{background:
  radial-gradient(${px(760)} ${px(640)} at ${cx}px ${cy}px, rgba(255,190,0,.34), rgba(255,138,0,.12) 46%, transparent 72%),
  radial-gradient(${px(820)} ${px(460)} at 100% 106%, rgba(255,170,0,.24), transparent 70%),
  radial-gradient(${px(680)} ${px(320)} at 62% -12%, rgba(255,222,130,.13), transparent 70%),
  linear-gradient(118deg,#0c0a06 0%,#17120a 38%,#0b0907 68%,#050505 100%)}
svg.hex{width:100%;height:100%;-webkit-mask-image:radial-gradient(ellipse 62% 88% at 72% 48%,#000 0%,rgba(0,0,0,.5) 50%,transparent 80%);mask-image:radial-gradient(ellipse 62% 88% at 72% 48%,#000 0%,rgba(0,0,0,.5) 50%,transparent 80%)}
.rays{mix-blend-mode:screen;opacity:.62;background:
  repeating-conic-gradient(from 8deg at ${cx}px ${cy}px, rgba(255,214,110,.13) 0deg 2.2deg, transparent 2.2deg 13deg),
  repeating-conic-gradient(from 0deg at ${cx}px ${cy}px, rgba(255,190,60,.09) 0deg 5deg, transparent 5deg 31deg);
  -webkit-mask-image:radial-gradient(circle ${px(560)} at ${cx}px ${cy}px,transparent 20%,#000 38%,transparent 100%);mask-image:radial-gradient(circle ${px(560)} at ${cx}px ${cy}px,transparent 20%,#000 38%,transparent 100%)}
.slash{inset:auto;top:-12%;height:124%;transform:skewX(-17deg);border-radius:${px(8)};background:linear-gradient(180deg,transparent 4%,rgba(255,196,40,.07) 34%,rgba(255,160,0,.03) 66%,transparent 96%)}
svg.lines{width:100%;height:100%}
.bokeh i{position:absolute;border-radius:50%;background:radial-gradient(circle,#ffe7a0 0%,#ffbf2e 55%,rgba(255,170,0,.6) 100%)}
.sparks i{position:absolute;border-radius:50%;background:#fff0bd;box-shadow:0 0 ${px(10)} ${px(3)} rgba(255,190,40,.6)}
.star{position:absolute;display:block}
.star:before,.star:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at center,#fff 0%,rgba(255,240,180,.95) 10%,rgba(255,200,60,.35) 30%,transparent 62%)}
.star:before{transform:scaleY(.085)}
.star:after{transform:scaleX(.085)}
.grain{opacity:.12;mix-blend-mode:overlay}
.vignette{background:radial-gradient(ellipse 78% 82% at 50% 48%,transparent 50%,rgba(0,0,0,.66) 100%)}
.frame{inset:${px(20)};border-radius:${px(30)};border:1.5px solid rgba(255,205,70,.15);box-shadow:inset 0 0 0 1px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.05)}

/* ── the logo on its stage ── */
.stage>*{position:absolute}
.halo{left:${cx - S * 0.62}px;top:${cy - S * 0.62}px;width:${S * 1.24}px;height:${S * 1.24}px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,208,70,.36) 0%,rgba(255,170,0,.13) 48%,transparent 70%)}
.orbit{left:${cx - S * 0.66}px;top:${cy - S * 0.66}px;width:${S * 1.32}px;height:${S * 1.32}px;border-radius:50%;border:1.5px solid rgba(255,210,90,.20);box-shadow:inset 0 0 ${px(60)} rgba(255,180,0,.08)}
.orbit.two{left:${cx - S * 0.8}px;top:${cy - S * 0.8}px;width:${S * 1.6}px;height:${S * 1.6}px;border:1px dashed rgba(255,210,90,.14);box-shadow:none}
.floor{left:${cx - S * 0.86}px;top:${cy + S * 0.4}px;width:${S * 1.72}px;height:${S * 0.36}px;border-radius:50%;
  background:radial-gradient(closest-side,rgba(255,214,90,.62) 0%,rgba(255,170,0,.26) 38%,rgba(255,140,0,.07) 66%,transparent 100%);filter:blur(${px(5)})}
.floorline{left:${cx - S * 0.62}px;top:${cy + S * 0.49}px;width:${S * 1.24}px;height:${S * 0.17}px;border-radius:50%;border:${Math.max(1.5, 2 * k)}px solid rgba(255,222,120,.55);
  -webkit-mask-image:linear-gradient(180deg,transparent 30%,#000 100%);mask-image:linear-gradient(180deg,transparent 30%,#000 100%);filter:drop-shadow(0 0 ${px(8)} rgba(255,190,0,.8))}
.floorline.two{left:${cx - S * 0.86}px;top:${cy + S * 0.47}px;width:${S * 1.72}px;height:${S * 0.24}px;border:1px solid rgba(255,222,120,.26)}
.refl{left:${cx - S / 2}px;top:${cy + S * 0.5 - S * 0.115}px;width:${S}px;height:${S}px;transform:scaleY(-1);opacity:.42;filter:blur(${px(2.2)}) saturate(.85);
  -webkit-mask-image:linear-gradient(to top,rgba(0,0,0,.9) 6%,transparent 40%);mask-image:linear-gradient(to top,rgba(0,0,0,.9) 6%,transparent 40%)}
.h{left:${cx - S / 2}px;top:${cy - S / 2}px;width:${S}px;height:${S}px;
  filter:drop-shadow(0 0 ${Math.max(1, 1.2 * k).toFixed(1)}px #241300) drop-shadow(0 0 ${Math.max(1, 1.6 * k).toFixed(1)}px rgba(40,20,0,.9)) drop-shadow(0 ${px(24)} ${px(26)} rgba(0,0,0,.7)) drop-shadow(0 0 ${px(46)} rgba(255,190,0,.5))}
.shine{left:${cx - S / 2}px;top:${cy - S / 2}px;width:${S}px;height:${S}px;mix-blend-mode:screen;opacity:.75;
  background:linear-gradient(116deg,transparent 30%,rgba(255,255,255,.0) 36%,rgba(255,255,255,.62) 44%,rgba(255,255,255,.08) 50%,transparent 56%),linear-gradient(180deg,rgba(255,255,255,.22),transparent 38%);
  -webkit-mask:url(${logoUrl}) center/contain no-repeat;mask:url(${logoUrl}) center/contain no-repeat}

/* ── texts ── */
.copy{position:absolute;left:${Math.round((wide ? 0.365 : 0.372) * W)}px;right:${px(66)};top:0;bottom:0;display:flex;align-items:center}
.fit{display:flex;flex-direction:column;align-items:flex-start;width:max-content;transform-origin:left center}
.orn{display:flex;align-items:center;gap:${px(12)};margin:0 0 ${px(16)} ${px(6)}}
.orn .bar{width:${px(86)};height:${Math.max(2, Math.round(3 * k))}px;border-radius:2px;background:linear-gradient(90deg,#ffe27a,#ff9f0a)}
.orn .bar.s{width:${px(22)};opacity:.55}
.gem{flex:none;width:${px(11)};height:${px(11)};transform:rotate(45deg);border-radius:2px;background:linear-gradient(135deg,#fff0a8,#ffb300);box-shadow:0 0 ${px(12)} rgba(255,190,0,.75)}
.name{position:relative;font-weight:900;font-style:italic;font-size:${px(126)};line-height:1.02;letter-spacing:${(-3.4 * k).toFixed(1)}px;white-space:nowrap}
.name .w{background:linear-gradient(180deg,#ffffff 0%,#ffffff 44%,#e9e4d9 62%,#bdb6a7 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:${px(6)};
  filter:drop-shadow(0 ${Math.max(1, Math.round(3 * k))}px 0 #6b6558) drop-shadow(0 ${px(12)} ${px(16)} rgba(0,0,0,.65))}
.name .g{background:linear-gradient(118deg,transparent 40%,rgba(255,255,255,.85) 50%,transparent 60%),linear-gradient(180deg,#fff6c4 0%,#ffd92e 34%,#ffb400 62%,#e87f00 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:${px(18)};
  filter:drop-shadow(0 ${Math.max(1, Math.round(3 * k))}px 0 #8a4a00) drop-shadow(0 ${px(12)} ${px(16)} rgba(0,0,0,.6)) drop-shadow(0 0 ${px(26)} rgba(255,190,0,.5))}
.rule{margin-top:${px(18)};width:100%;height:${Math.max(2, Math.round(3.5 * k))}px;border-radius:2px;background:linear-gradient(90deg,#ffe27a 0%,#ffb300 28%,rgba(255,179,0,.28) 62%,transparent 94%);position:relative}
.rule:after{content:"";position:absolute;left:${px(170)};top:-4px;width:${px(120)};height:calc(100% + 8px);border-radius:8px;background:linear-gradient(90deg,transparent,#fff9d8,transparent);filter:blur(2px)}
.tag{position:relative;overflow:hidden;margin-top:${px(34)};display:flex;align-items:center;gap:${px(18)};padding:${px(11)} ${px(40)} ${px(11)} ${px(12)};border-radius:999px;border:${Math.max(2, Math.round(2.5 * k))}px solid transparent;
  background:linear-gradient(180deg,rgba(52,42,20,.9),rgba(20,16,9,.94)) padding-box,linear-gradient(100deg,#fff0a8,#ffbe1a 30%,#b86e00 62%,#ffd84d 100%) border-box;
  font-weight:700;font-style:italic;font-size:${px(43)};letter-spacing:.2px;white-space:nowrap;
  box-shadow:0 ${px(16)} ${px(36)} rgba(0,0,0,.55),0 0 ${px(38)} rgba(255,180,0,.20),inset 0 1px 0 rgba(255,255,255,.14)}
.tag:before{content:"";position:absolute;inset:0 0 52% 0;background:linear-gradient(180deg,rgba(255,255,255,.10),rgba(255,255,255,.015))}
.tag:after{content:"";position:absolute;top:-20%;bottom:-20%;left:62%;width:${px(90)};transform:skewX(-22deg);background:linear-gradient(90deg,transparent,rgba(255,255,255,.13),transparent)}
.tag .badge{position:relative;flex:none;width:${px(62)};height:${px(62)};border-radius:50%;display:grid;place-items:center;
  background:radial-gradient(circle at 34% 28%,#fff6c4 0%,#ffd21f 34%,#ffab00 68%,#d97a00 100%);box-shadow:0 0 ${px(22)} rgba(255,190,0,.55),inset 0 -3px 6px rgba(120,60,0,.45),inset 0 2px 3px rgba(255,255,255,.7)}
.tag .badge .ico{width:${px(30)};height:${px(30)};fill:#2a1700}
.tag span{position:relative}
.tag em{font-style:italic;background:linear-gradient(180deg,#fff3b0,#ffcb1f 55%,#ff9f0a);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:2px}
.cats{margin-top:${px(30)};width:100%;display:flex;gap:${px(18)}}
.cat{position:relative;flex:1 1 auto;display:flex;align-items:center;justify-content:center;gap:${px(14)};padding:${px(11)} ${px(26)} ${px(11)} ${px(13)};border-radius:${px(20)};white-space:nowrap;
  background:linear-gradient(180deg,#2a2314 0%,#1a160d 55%,#14110a 100%) padding-box,linear-gradient(160deg,rgba(255,224,120,.9),rgba(255,180,0,.22) 46%,rgba(255,204,70,.65)) border-box;border:${Math.max(1.5, 2 * k)}px solid transparent;
  box-shadow:0 ${px(12)} ${px(26)} rgba(0,0,0,.45),inset 0 1px 0 rgba(255,255,255,.10)}
.cat:before{content:"";position:absolute;inset:0 0 50% 0;border-radius:inherit;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.01))}
.cat>*{position:relative}
.cat b{font-weight:800;font-style:italic;font-size:${px(33)};color:#fbf7ee;letter-spacing:.1px}
.cat .ico{flex:none;width:${px(54)};height:${px(54)};padding:${px(11)};border-radius:${px(15)};fill:#2a1700;
  background:radial-gradient(circle at 32% 26%,#fff3b0 0%,#ffd21f 38%,#ffa800 78%,#e08400 100%);box-shadow:0 0 ${px(16)} rgba(255,190,0,.38),inset 0 -2px 4px rgba(120,60,0,.4),inset 0 1px 2px rgba(255,255,255,.7)}
</style></head><body>
<div class="bg">
  <div class="base"></div>
  <svg class="hex"><defs><pattern id="hx" width="${(55.43 * k).toFixed(2)}" height="${(96 * k).toFixed(2)}" patternUnits="userSpaceOnUse" patternTransform="scale(${k.toFixed(4)})">
    <path d="M27.71 0 L55.43 16 L55.43 48 L27.71 64 L0 48 L0 16 Z M27.71 64 L27.71 96" fill="none" stroke="#ffd573" stroke-opacity=".13" stroke-width="1.2"/></pattern></defs>
    <rect width="100%" height="100%" fill="url(#hx)"/></svg>
  <div class="rays"></div>
  <div class="slash" style="left:${Math.round(W * 0.47)}px;width:${px(120)}"></div>
  <div class="slash" style="left:${Math.round(W * 0.585)}px;width:${px(46)};opacity:.7"></div>
  <div class="slash" style="left:${Math.round(W * 0.86)}px;width:${px(170)};opacity:.8"></div>
  <svg class="lines" viewBox="0 0 ${W} ${H}" fill="none">
    <defs>
      <linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd84d" stop-opacity="0"/><stop offset=".5" stop-color="#ffd040"/><stop offset="1" stop-color="#ff9f0a" stop-opacity="0"/></linearGradient>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb300" stop-opacity="0"/><stop offset=".55" stop-color="#ffd84d" stop-opacity=".5"/><stop offset="1" stop-color="#ffb300" stop-opacity="0"/></linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0a8"/><stop offset=".5" stop-color="#ffc21a"/><stop offset="1" stop-color="#c97a00"/></linearGradient>
    </defs>
    <path d="M ${-40} ${H * 0.31} C ${W * 0.07} ${H * 0.15}, ${W * 0.2} ${H * 0.04}, ${W * 0.44} ${-30}" stroke="url(#a)" stroke-width="${(4.5 * k).toFixed(1)}" stroke-linecap="round"/>
    <path d="M ${-40} ${H * 0.45} C ${W * 0.09} ${H * 0.23}, ${W * 0.24} ${H * 0.08}, ${W * 0.54} ${-30}" stroke="url(#b)" stroke-width="${(1.6 * k).toFixed(1)}"/>
    <path d="M ${W * 0.54} ${H + 30} C ${W * 0.73} ${H * 0.94}, ${W * 0.9} ${H * 0.83}, ${W + 40} ${H * 0.63}" stroke="url(#a)" stroke-width="${(4.5 * k).toFixed(1)}" stroke-linecap="round"/>
    <path d="M ${W * 0.42} ${H + 30} C ${W * 0.69} ${H * 0.91}, ${W * 0.88} ${H * 0.75}, ${W + 40} ${H * 0.49}" stroke="url(#b)" stroke-width="${(1.6 * k).toFixed(1)}"/>
    ${corners}
  </svg>
  <div class="bokeh">${bokeh}</div>
  <div class="sparks">${sparks}</div>
  <svg class="grain"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
  <div class="vignette"></div>
  <div class="frame"></div>
</div>
<div class="stage">
  <div class="orbit two"></div><div class="orbit"></div><div class="halo"></div>
  <div class="floor"></div><div class="floorline two"></div><div class="floorline"></div>
  <img class="refl" src="${logoUrl}">
  <img class="h" src="${logoUrl}">
  <div class="shine"></div>
  ${star(cx - S * 0.2, cy - S * 0.41, 150 * k)}${star(cx + S * 0.43, cy - S * 0.3, 96 * k, 0.9)}${star(cx - S * 0.36, cy + S * 0.37, 70 * k, 0.75)}
</div>
<div class="copy"><div class="fit">
  <div class="orn"><span class="bar"></span><span class="gem"></span><span class="bar s"></span></div>
  <div class="name"><span class="w">${TEXT.name}</span><span class="g">${TEXT.tld}</span></div>
  <div class="rule"></div>
  <div class="tag"><span class="badge">${icon(TEXT.taglineIcon)}</span><span>${TEXT.tagline[0]}<em>${TEXT.tagline[1]}</em>${TEXT.tagline[2]}</span></div>
  <div class="cats">${cats}</div>
</div></div>
<script>
  // The text block is as wide as its longest line; scale it to the room next to the logo (longer texts simply get smaller).
  document.fonts.ready.then(() => {
    const copy = document.querySelector('.copy');
    const fit = document.querySelector('.fit');
    const scale = Math.min(1.35, copy.clientWidth / fit.offsetWidth, (copy.clientHeight * 0.8) / fit.offsetHeight);
    fit.style.transform = 'scale(' + scale.toFixed(4) + ')';
    document.body.dataset.ready = '1';
  });
</script>
</body></html>`;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Brak Playwright. Zainstaluj: npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }
  const browser = await chromium.launch();
  for (const [file, size] of [['hammershop-pl-banner.png', { width: 1600, height: 850 }], ['hammershop-pl-banner-wide.png', { width: 1600, height: 600 }]]) {
    const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 });
    await page.setContent(html(size));
    await page.waitForFunction(() => document.body.dataset.ready === '1');
    await page.screenshot({ path: path.join(BRAND, file) });
    await page.close();
    console.log(`✓ assets/brand/${file} (${size.width} × ${size.height})`);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
