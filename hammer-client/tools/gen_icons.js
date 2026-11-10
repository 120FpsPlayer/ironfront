'use strict';

/**
 * Renders the icon atlas of Hammer Client (white Font Awesome Free icons on transparent, 64 px cells, 8 per row)
 * and icons.json (name → cell index).  Usage: node tools/gen_icons.js
 * Needs Playwright with Chromium and @fortawesome/fontawesome-free (both are devDependencies of ../hammer-launcher).
 */

const fs = require('node:fs');
const path = require('node:path');

const launcher = path.join(__dirname, '..', '..', 'hammer-launcher', 'node_modules');
const { chromium } = require(path.join(launcher, 'playwright'));
const FA = path.join(launcher, '@fortawesome', 'fontawesome-free', 'svgs');
const OUT = path.join(__dirname, '..', 'common', 'src', 'main', 'resources', 'assets', 'hammerclient');

// name in the client → Font Awesome file (solid unless prefixed with brands/)
const ICONS = {
  fps: 'gauge-high', cps: 'computer-mouse', keystrokes: 'keyboard', coords: 'location-dot', compass: 'compass', ping: 'signal',
  server: 'server', clock: 'clock', memory: 'memory', day: 'sun', speed: 'person-running', potions: 'flask', armor: 'shield-halved',
  inventory: 'box-open', items: 'cubes', combo: 'fire', reach: 'ruler', saturation: 'drumstick-bite', stopwatch: 'stopwatch',
  tps: 'heart-pulse', session: 'hourglass-half', zoom: 'magnifying-glass-plus', freelook: 'eye', sprint: 'bolt', sneak: 'shoe-prints',
  fullbright: 'lightbulb', time: 'moon', weather: 'cloud-rain', crosshair: 'crosshairs', hurtcam: 'heart-crack', fov: 'expand',
  fire: 'fire-flame-curved', warning: 'triangle-exclamation', hammer: 'hammer', gear: 'gear', search: 'magnifying-glass', close: 'xmark',
  check: 'check', left: 'chevron-left', right: 'chevron-right', down: 'chevron-down', reset: 'rotate-left', pen: 'pen', plus: 'plus',
  trash: 'trash', store: 'store', power: 'power-off', user: 'user', globe: 'globe', sliders: 'sliders', layers: 'layer-group',
  palette: 'palette', hidden: 'eye-slash', move: 'up-down-left-right', menu: 'bars', home: 'house', gamepad: 'gamepad',
  magic: 'wand-magic-sparkles', star: 'star', info: 'circle-info', lock: 'lock', grid: 'table-cells', bell: 'bell', cube: 'cube',
  puzzle: 'puzzle-piece', users: 'users', quit: 'right-from-bracket', back: 'arrow-left', image: 'image', save: 'floppy-disk',
  copy: 'copy', sky: 'cloud-sun', target: 'bullseye', maximize: 'maximize', video: 'video', list: 'list', hud: 'border-all',
  drop: 'droplet', contrast: 'circle-half-stroke', font: 'font', refresh: 'arrows-rotate', ok: 'circle-check', error: 'circle-xmark',
  heart: 'heart',
  discord: 'brands/discord',
};

(async () => {
  const names = Object.keys(ICONS);
  const cols = 8;
  const cell = 64;
  const rows = Math.ceil(names.length / cols);
  const cells = names.map((name, i) => {
    const file = ICONS[name].includes('/') ? path.join(FA, `${ICONS[name]}.svg`) : path.join(FA, 'solid', `${ICONS[name]}.svg`);
    const svg = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace('<svg', '<svg fill="#fff" style="max-width:46px;max-height:46px;width:100%;height:100%"');
    return `<div style="position:absolute;left:${(i % cols) * cell}px;top:${Math.floor(i / cols) * cell}px;width:${cell}px;height:${cell}px;display:grid;place-items:center">${svg}</div>`;
  });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: cols * cell, height: rows * cell }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent;color:#fff">${cells.join('')}</body></html>`);
  fs.mkdirSync(path.join(OUT, 'textures'), { recursive: true });
  await page.screenshot({ path: path.join(OUT, 'textures', 'icons.png'), omitBackground: true });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'textures', 'icons.png.mcmeta'), JSON.stringify({ texture: { blur: true, clamp: true } }));
  fs.writeFileSync(path.join(OUT, 'icons.json'), JSON.stringify({ cell, cols, width: cols * cell, height: rows * cell, icons: Object.fromEntries(names.map((n, i) => [n, i])) }));
  console.log(`${names.length} icons → icons.png ${cols * cell}x${rows * cell}`);
})();
