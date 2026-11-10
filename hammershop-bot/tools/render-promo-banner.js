'use strict';

/**
 * Renders the HammerShop.pl promo banner – the picture for Discord embeds and link previews – in the black and
 * gold look of the "H" logo.
 *
 *   node tools/render-promo-banner.js            → assets/brand/hammershop-pl-banner.png (1600 × 850)
 *                                                  assets/brand/hammershop-pl-banner-wide.png (1600 × 600)
 *
 * Texts are in TEXT below. Needs Playwright (Chromium) like render-assets.js; the logo is assets/brand/logo-h.png.
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
  for (const [weight, style] of [[600, 'normal'], [700, 'italic'], [800, 'italic'], [900, 'italic']]) {
    for (const subset of ['latin', 'latin-ext']) {
      const file = path.join(FONT_DIR, `montserrat-${subset}-${weight}-${style}.woff2`);
      const range = subset === 'latin' ? 'U+0000-00FF,U+2000-206F,U+20AC,U+2122' : 'U+0100-02AF,U+1E00-1EFF';
      faces.push(`@font-face{font-family:Montserrat;font-weight:${weight};font-style:${style};src:url(${dataUri(file, 'font/woff2')}) format('woff2');unicode-range:${range}}`);
    }
  }
  return faces.join('\n');
}

/** Stable pseudo-random numbers, so the sparks land in the same places on every render. */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function html({ width, height }) {
  const wide = width / height > 2.2;
  const k = height / 850; // the layout is drawn for a height of 850
  const logo = Math.round((wide ? 560 : 470) * k);
  const rand = rng(7);
  const sparks = Array.from({ length: 34 }, () => {
    // Around the logo, thinning out to the right.
    const x = Math.pow(rand(), 1.7) * width * 0.62 + 20;
    const y = rand() * height;
    const size = 2 + rand() * 4;
    const alpha = 0.25 + rand() * 0.6;
    return `<i style="left:${x.toFixed(0)}px;top:${y.toFixed(0)}px;width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;opacity:${alpha.toFixed(2)}"></i>`;
  }).join('');
  const cats = TEXT.categories.map((c) => `<span class="cat">${icon(c.icon)}<b>${c.label}</b></span>`).join('<span class="gem"></span>');

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${width}px;height:${height}px;background:#070707;overflow:hidden}
body{font-family:Montserrat,sans-serif;color:#fff;position:relative}
.bg,.bg>*{position:absolute;inset:0}
.base{background:
  radial-gradient(${Math.round(620 * k)}px ${Math.round(560 * k)}px at ${wide ? 20 : 20.5}% 50%, rgba(255,196,0,.26), rgba(255,150,0,.08) 55%, transparent 72%),
  radial-gradient(${Math.round(700 * k)}px ${Math.round(420 * k)}px at 96% 108%, rgba(255,176,0,.18), transparent 70%),
  radial-gradient(${Math.round(520 * k)}px ${Math.round(300 * k)}px at 4% -8%, rgba(255,214,90,.10), transparent 70%),
  linear-gradient(135deg,#0d0c0b 0%,#131110 46%,#080808 100%)}
.dots{background:radial-gradient(rgba(255,226,150,.16) 1.1px,transparent 1.6px) 0 0/${Math.round(26 * k)}px ${Math.round(26 * k)}px;
  -webkit-mask-image:radial-gradient(ellipse 70% 85% at 68% 50%,#000 0%,rgba(0,0,0,.35) 55%,transparent 82%);mask-image:radial-gradient(ellipse 70% 85% at 68% 50%,#000 0%,rgba(0,0,0,.35) 55%,transparent 82%)}
.sheen{background:linear-gradient(112deg,transparent 30%,rgba(255,255,255,.045) 43%,rgba(255,255,255,.012) 50%,transparent 58%)}
.vignette{background:radial-gradient(ellipse at 50% 50%,transparent 52%,rgba(0,0,0,.62) 100%)}
.grain{opacity:.11;mix-blend-mode:overlay}
.frame{inset:${Math.round(20 * k)}px;border-radius:${Math.round(30 * k)}px;border:1.5px solid rgba(255,205,70,.16);box-shadow:inset 0 0 0 1px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.04)}
svg.lines{position:absolute;inset:0;width:100%;height:100%}
.sparks i{position:absolute;border-radius:50%;background:#ffe9a8;box-shadow:0 0 10px 3px rgba(255,190,40,.55)}

.logo{position:absolute;left:${Math.round((wide ? 0.2 : 0.205) * width - logo / 2)}px;top:${Math.round(height / 2 - logo / 2)}px;width:${logo}px;height:${logo}px}
.logo .ring{position:absolute;inset:${Math.round(-34 * k)}px;border-radius:50%;border:1.5px solid rgba(255,208,80,.20);box-shadow:0 0 60px rgba(255,180,0,.10), inset 0 0 70px rgba(255,180,0,.10)}
.logo .ring.two{inset:${Math.round(-78 * k)}px;border:1px dashed rgba(255,208,80,.13);box-shadow:none}
.logo .plate{position:absolute;inset:${Math.round(18 * k)}px;border-radius:50%;background:radial-gradient(circle at 50% 42%,rgba(255,205,60,.20),rgba(255,160,0,.05) 60%,transparent 72%)}
.logo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;
  filter:drop-shadow(0 ${Math.round(22 * k)}px ${Math.round(26 * k)}px rgba(0,0,0,.65)) drop-shadow(0 0 ${Math.round(38 * k)}px rgba(255,190,0,.42))}

.copy{position:absolute;left:${Math.round((wide ? 0.375 : 0.378) * width)}px;right:${Math.round(70 * k)}px;top:0;bottom:0;display:flex;align-items:center}
.fit{display:flex;flex-direction:column;align-items:flex-start;width:max-content;transform-origin:left center}
.name{font-weight:900;font-style:italic;font-size:${Math.round(126 * k)}px;line-height:1;letter-spacing:${(-3.2 * k).toFixed(1)}px;white-space:nowrap;
  filter:drop-shadow(0 ${Math.round(8 * k)}px ${Math.round(14 * k)}px rgba(0,0,0,.6))}
.name .w{background:linear-gradient(180deg,#ffffff 0%,#fff 46%,#d9d5cc 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:${Math.round(6 * k)}px}
.name .g{background:linear-gradient(180deg,#fff3b8 0%,#ffd21f 38%,#ffb300 68%,#f28a00 100%);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:${Math.round(16 * k)}px;
  filter:drop-shadow(0 0 ${Math.round(22 * k)}px rgba(255,190,0,.45))}
.rule{margin-top:${Math.round(20 * k)}px;width:100%;height:${Math.max(2, Math.round(3 * k))}px;border-radius:2px;background:linear-gradient(90deg,#ffd84d 0%,#ffb300 30%,rgba(255,179,0,.25) 62%,transparent 92%);position:relative}
.rule:after{content:"";position:absolute;left:${Math.round(150 * k)}px;top:-3px;width:${Math.round(90 * k)}px;height:calc(100% + 6px);border-radius:6px;background:linear-gradient(90deg,transparent,#fff7cf,transparent);filter:blur(1.5px);opacity:.9}
.tag{margin-top:${Math.round(34 * k)}px;padding:${Math.round(17 * k)}px ${Math.round(38 * k)}px ${Math.round(18 * k)}px;border-radius:999px;border:${Math.max(2, Math.round(2.5 * k))}px solid transparent;
  background:linear-gradient(180deg,rgba(40,33,18,.92),rgba(18,15,10,.94)) padding-box,linear-gradient(90deg,#ffe27a,#ffb300 45%,#c97a00 75%,#ffd84d) border-box;
  font-weight:700;font-style:italic;font-size:${Math.round(43 * k)}px;letter-spacing:.2px;white-space:nowrap;
  box-shadow:0 ${Math.round(14 * k)}px ${Math.round(34 * k)}px rgba(0,0,0,.5),0 0 ${Math.round(34 * k)}px rgba(255,180,0,.16),inset 0 1px 0 rgba(255,255,255,.10)}
.tag em{font-style:italic;background:linear-gradient(180deg,#fff0a8,#ffc61a 55%,#ff9f0a);-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:2px}
.cats{margin-top:${Math.round(38 * k)}px;width:100%;display:flex;align-items:center;gap:${Math.round(22 * k)}px;font-size:${Math.round(34 * k)}px;white-space:nowrap}
.cats .line{flex:1;min-width:${Math.round(24 * k)}px;height:2px;border-radius:2px;background:linear-gradient(90deg,transparent,rgba(255,196,0,.75))}
.cats .line.r{background:linear-gradient(90deg,rgba(255,196,0,.75),transparent)}
.cat{display:inline-flex;align-items:center;gap:${Math.round(14 * k)}px}
.cat b{font-weight:800;font-style:italic;color:#f6f2e8}
.cat .ico{width:${Math.round(50 * k)}px;height:${Math.round(50 * k)}px;padding:${Math.round(11 * k)}px;border-radius:${Math.round(14 * k)}px;fill:#ffcc2e;
  background:linear-gradient(180deg,rgba(255,204,46,.20),rgba(255,160,0,.07));box-shadow:inset 0 0 0 1.5px rgba(255,204,46,.38),0 6px 16px rgba(0,0,0,.4)}
.gem{flex:none;width:${Math.round(11 * k)}px;height:${Math.round(11 * k)}px;transform:rotate(45deg);border-radius:2px;background:linear-gradient(135deg,#fff0a8,#ffb300);box-shadow:0 0 12px rgba(255,190,0,.7)}
</style></head><body>
<div class="bg">
  <div class="base"></div>
  <div class="dots"></div>
  <div class="sheen"></div>
  <svg class="lines" viewBox="0 0 ${width} ${height}" fill="none">
    <defs>
      <linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffd84d" stop-opacity="0"/><stop offset=".5" stop-color="#ffcf3a"/><stop offset="1" stop-color="#ff9f0a" stop-opacity="0"/></linearGradient>
      <linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb300" stop-opacity="0"/><stop offset=".55" stop-color="#ffd84d" stop-opacity=".55"/><stop offset="1" stop-color="#ffb300" stop-opacity="0"/></linearGradient>
    </defs>
    ${[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
      const m = 20 * k, r = 30 * k, len = 74 * k;
      const x = sx > 0 ? m : width - m, y = sy > 0 ? m : height - m;
      return `<path d="M ${x} ${y + sy * (r + len)} L ${x} ${y + sy * r} Q ${x} ${y} ${x + sx * r} ${y} L ${x + sx * (r + len)} ${y}" stroke="#ffcf3a" stroke-opacity=".75" stroke-width="${(2.5 * k).toFixed(1)}" stroke-linecap="round"/>`;
    }).join('')}
    <path d="M ${-40} ${height * 0.33} C ${width * 0.07} ${height * 0.16}, ${width * 0.2} ${height * 0.04}, ${width * 0.42} ${-30}" stroke="url(#a)" stroke-width="${(4 * k).toFixed(1)}" stroke-linecap="round"/>
    <path d="M ${-40} ${height * 0.47} C ${width * 0.09} ${height * 0.24}, ${width * 0.24} ${height * 0.08}, ${width * 0.52} ${-30}" stroke="url(#b)" stroke-width="${(1.6 * k).toFixed(1)}"/>
    <path d="M ${width * 0.56} ${height + 30} C ${width * 0.74} ${height * 0.93}, ${width * 0.9} ${height * 0.82}, ${width + 40} ${height * 0.62}" stroke="url(#a)" stroke-width="${(4 * k).toFixed(1)}" stroke-linecap="round"/>
    <path d="M ${width * 0.44} ${height + 30} C ${width * 0.7} ${height * 0.9}, ${width * 0.88} ${height * 0.74}, ${width + 40} ${height * 0.48}" stroke="url(#b)" stroke-width="${(1.6 * k).toFixed(1)}"/>
  </svg>
  <div class="sparks">${sparks}</div>
  <svg class="grain"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 .9 0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
  <div class="vignette"></div>
  <div class="frame"></div>
</div>
<div class="logo"><div class="ring two"></div><div class="ring"></div><div class="plate"></div><img src="${dataUri(path.join(BRAND, 'logo-h.png'), 'image/png')}"></div>
<div class="copy"><div class="fit">
  <div class="name"><span class="w">${TEXT.name}</span><span class="g">${TEXT.tld}</span></div>
  <div class="rule"></div>
  <div class="tag">${TEXT.tagline[0]}<em>${TEXT.tagline[1]}</em>${TEXT.tagline[2]}</div>
  <div class="cats"><span class="line"></span>${cats}<span class="line r"></span></div>
</div></div>
<script>
  // The text block is as wide as its longest line; scale it to the room next to the logo (longer texts simply get smaller).
  document.fonts.ready.then(() => {
    const copy = document.querySelector('.copy');
    const fit = document.querySelector('.fit');
    const scale = Math.min(1.35, copy.clientWidth / fit.offsetWidth, (copy.clientHeight * 0.78) / fit.offsetHeight);
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
