'use strict';

/**
 * Turns the exported NØX design (one big HTML file from ChatGPT) into the live site:
 *   - the embedded images become files in public/assets/ (the page drops from ~3.4 MB to ~0.4 MB and images are cached),
 *   - the demo-only API stub is swapped for real calls to this server (/api/nox/...). If the server can't be reached
 *     (e.g. the file is opened straight from disk) the page still falls back to the original offline preview.
 *
 *   node scripts/build-website.js path/to/NOX_website.html
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const src = process.argv[2];
if (!src) {
  console.error('Usage: node scripts/build-website.js path/to/NOX_website.html');
  process.exit(1);
}
const OUT = path.join(__dirname, '..', 'web', 'public');
let html = fs.readFileSync(src, 'utf8');

// 1. Images → files (same image = same file)
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' };
const names = new Map();
html = html.replace(/data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)/g, (all, type, b64) => {
  const ext = EXT[type];
  if (!ext || b64.length < 4096) return all; // tiny icons stay inline
  const hash = crypto.createHash('sha1').update(b64).digest('hex').slice(0, 10);
  if (!names.has(hash)) {
    const file = `img-${hash}.${ext}`;
    fs.writeFileSync(path.join(OUT, 'assets', file), Buffer.from(b64, 'base64'));
    names.set(hash, file);
  }
  return `/assets/${names.get(hash)}`;
});

// 2. The demo API stub → real requests to the server
const STUB = /async function de\(a,e\)\{if\(a==="store"\)return\{products:Kc,[\s\S]*?require the connected server\."\)\}/;
if (!STUB.test(html)) {
  console.error('Could not find the demo API function in the HTML – was the design exported again with changes?');
  process.exit(1);
}
const OFFLINE = '{products:Kc,preview:!0,authReady:!1,paymentsReady:!1,accessPrice:990,discordUrl:null}';
const LIVE =
  'async function de(a,e){' +
  'const o=e===void 0?{credentials:"same-origin",headers:{accept:"application/json"}}' +
  ':{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json",accept:"application/json"},body:JSON.stringify(e)};' +
  'let r;try{r=await fetch("/api/nox/"+a,o)}catch(x){' +
  `if(a==="store")return ${OFFLINE};if(a==="session")return{user:null,access:!1};if(a==="logout")return{ok:!0};` +
  'throw new Error("The N\\xD8X server can\'t be reached right now. Please try again in a moment.")}' +
  `if(r.status===404&&a==="store")return ${OFFLINE};` +
  'let j={};try{j=await r.json()}catch(x){}' +
  'if(!r.ok)throw new Error(j.error||"Something went wrong. Please try again.");return j}';
html = html.replace(STUB, LIVE);

// 3. Coming back from Discord with an error: say what happened instead of the demo text.
html = html.replace(
  'Ue("Discord sign-in is not connected yet. You can explore the demo.")',
  'Ue(b.get("auth")==="failed"?"Discord sign-in didn\'t work. Please try again.":b.get("auth")==="cancelled"?"Discord sign-in was cancelled.":"Discord sign-in is not connected yet. You can explore the demo.")',
);

// 4. Products with their own picture (set with /product add | edit image) show it on their card.
html = html.replace(/a\.art==="games"\?\(0,d\.jsx\)\("div",\{className:"art game-art",children:\(0,d\.jsx\)\("img",\{src:"([^"]+)"/, (all, src) =>
  `a.art==="games"||a.image?(0,d.jsx)("div",{className:"art game-art",children:(0,d.jsx)("img",{src:a.image||"${src}"`,
);

// 5. Layout fixes on top of the design's own CSS.
const FIXES = `
/* Phones: the hero picture sat on top of the buttons once the title wrapped to three lines – now it follows them. */
@media (max-width:650px){
  .hero{min-height:0;padding-bottom:64px}
  .hero-visual{position:relative;top:auto;left:50%;margin:6px 0 -176px -285px;transform-origin:50% 0}
  .tabs{overflow-x:auto;scrollbar-width:none;-webkit-mask-image:linear-gradient(90deg,#000 88%,transparent);mask-image:linear-gradient(90deg,#000 88%,transparent)}
  .tabs::-webkit-scrollbar{display:none}
}`;
html = html.replace('</head>', `<style id="nox-fixes">${FIXES}</style></head>`);

fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log(`web/public/index.html – ${(html.length / 1024).toFixed(0)} KB, ${names.size} images in web/public/assets/`);
