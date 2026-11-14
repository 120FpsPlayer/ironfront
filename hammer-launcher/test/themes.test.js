'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readable, contrast, isHex, MIN_CONTRAST } = require('../src/renderer/js/theme');
const { THEMES, IDS, byId, cssVars, VAR_NAMES, sceneCss, previewCss, backdrop, sideBackdrop, cardBackdrop, heroBackdrop } = require('../src/renderer/js/themes');
const fx = require('../src/renderer/js/themefx');
const { sanitize, plusOnly, PLUS_ONLY, DEFAULT_SETTINGS, THEMES: SETTING_THEMES } = require('../src/main/settings');
const { createServices } = require('../src/main/services');
const { tmpDir, plusKeys } = require('./helpers');

const SURFACES = ['bg', 'bg2', 'side', 'panel', 'panel2', 'panel3'];
const ratio = (a, b) => contrast(a, b).toFixed(2);
/** `dim` (hints, dates) is the launcher's quietest text: no theme may be less readable there than the launcher's own look. */
const DIM_MIN = 3.75;

test('themes: every theme passes the checks HS_THEME uses for an own colour – on its own cards', () => {
  for (const t of THEMES) {
    const c = t.colors;
    const shades = { accent: c.accent, accent2: c.accent2, accent3: c.accent3, accentHi: c.accentHi, ink: c.ink };
    assert.ok(readable(shades, c.panel), `${t.id}: HS_THEME.readable`);
    // the same assertions as the test of the own colour (theme.test.js), with the theme's card colour
    for (const key of ['accent', 'accent2']) assert.ok(contrast(c[key], c.panel) >= MIN_CONTRAST, `${t.id}: ${key} on a card (${ratio(c[key], c.panel)})`);
    for (const key of ['accent', 'accent2', 'accent3']) assert.ok(contrast(c.ink, c[key]) >= MIN_CONTRAST, `${t.id}: the button label on ${key} (${ratio(c.ink, c[key])})`);
  }
});

test('themes: all text stays readable on every surface of the window (WCAG AA)', () => {
  for (const t of THEMES) {
    const c = t.colors;
    for (const s of SURFACES) {
      assert.ok(contrast(c.text, c[s]) >= MIN_CONTRAST, `${t.id}: text on ${s} (${ratio(c.text, c[s])})`);
      assert.ok(contrast(c.muted, c[s]) >= MIN_CONTRAST, `${t.id}: muted text on ${s} (${ratio(c.muted, c[s])})`);
      if (s !== 'panel3') assert.ok(contrast(c.dim, c[s]) >= DIM_MIN, `${t.id}: dim text on ${s} (${ratio(c.dim, c[s])})`);
    }
    for (const s of ['bg', 'side', 'panel', 'panel2']) for (const key of ['accent', 'accent2']) assert.ok(contrast(c[key], c[s]) >= MIN_CONTRAST, `${t.id}: ${key} on ${s} (${ratio(c[key], c[s])})`);
  }
  // the bar for `dim` is the launcher's own look (which the default theme is)
  const own = byId('default').colors;
  for (const s of ['bg', 'bg2', 'side', 'panel', 'panel2']) assert.ok(contrast(own.dim, own[s]) >= DIM_MIN, `default: dim on ${s}`);
});

test('themes: text over the moving background stays readable – at its brightest spot: on the page, the side bar, the cards and the banner', () => {
  for (const t of THEMES.filter((x) => x.id !== 'default')) {
    const c = t.colors;
    const page = backdrop(t);
    const side = sideBackdrop(t);
    const hero = heroBackdrop(t);
    const card = cardBackdrop(t);
    for (const [where, bg] of [['page', page], ['side bar', side], ['card', card], ['banner', hero]]) {
      assert.ok(contrast(c.text, bg) >= MIN_CONTRAST, `${t.id}: text on the ${where} (${bg}: ${ratio(c.text, bg)})`);
      assert.ok(contrast(c.muted, bg) >= MIN_CONTRAST, `${t.id}: muted text on the ${where} (${bg}: ${ratio(c.muted, bg)})`);
    }
    for (const [where, bg] of [['page', page], ['card', card]]) assert.ok(contrast(c.dim, bg) >= DIM_MIN, `${t.id}: dim text on the ${where} (${ratio(c.dim, bg)})`);
    for (const [where, bg] of [['side bar', side], ['card', card]]) for (const key of ['accent', 'accent2']) assert.ok(contrast(c[key], bg) >= MIN_CONTRAST, `${t.id}: ${key} on the ${where} (${ratio(c[key], bg)})`);
    assert.ok(t.scene.side >= 0.7 && t.scene.side <= 1, `${t.id}: the side bar stays mostly solid`);
    assert.ok(t.scene.card >= 0.85 && t.scene.card <= 1, `${t.id}: the cards stay nearly solid`);
    assert.ok(t.scene.heroAlpha >= 0.4 && t.scene.heroAlpha <= 1, `${t.id}: the banner keeps a tint`);
  }
});

test('themes: the list matches the setting, every colour is a real colour and every particle a known kind', () => {
  assert.deepEqual(IDS, SETTING_THEMES, 'settings.js THEMES = the ids of themes.js');
  assert.equal(IDS[0], 'default');
  assert.equal(new Set(IDS).size, IDS.length);
  assert.equal(new Set(THEMES.map((t) => t.label)).size, THEMES.length);
  assert.ok(THEMES.length >= 5, 'default + at least four Hammer+ themes');
  for (const t of THEMES) {
    assert.match(t.id, /^[a-z]+$/);
    assert.ok(t.label && t.hint, `${t.id}: a name and a short description`);
    for (const [key, value] of Object.entries(t.colors)) assert.ok(isHex(value), `${t.id}: ${key} = ${value}`);
    const sc = t.scene;
    assert.ok(isHex(sc.sky[0]) && isHex(sc.sky[1]) && isHex(sc.hero[0]) && isHex(sc.hero[1]), `${t.id}: sky and banner`);
    for (const l of [...(sc.glows ?? []), ...(sc.drift ?? []), ...(sc.pulse ? [sc.pulse] : [])]) assert.ok(isHex(l.color) && l.alpha > 0 && l.alpha <= 0.5 && l.size.every((v) => v > 0), `${t.id}: a light`);
    let total = 0;
    for (const p of sc.particles) {
      assert.ok(fx.KINDS[p.kind], `${t.id}: particle kind ${p.kind}`);
      assert.ok(p.colors.length && p.colors.every(isHex), `${t.id}: ${p.kind} colours`);
      for (const range of [p.size, p.speed, p.alpha]) assert.ok(range.length === 2 && range[0] <= range[1] && range[0] >= 0, `${t.id}: ${p.kind} ranges`);
      assert.ok(p.alpha[1] <= 1);
      total += p.n;
    }
    // modest on purpose: at most ~70 moving specks in a 1240×780 window, plus the still one-pixel stars of End
    const stars = sc.particles.filter((p) => p.kind === 'star').reduce((sum, p) => sum + p.n, 0);
    assert.ok(total - stars <= 72, `${t.id}: ${total - stars} moving particles`);
    assert.ok(total <= 130, `${t.id}: ${total} particles in all`);
  }
});

test('themes: the CSS a theme puts on the page – the variables of styles.css and nothing that could break out', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'styles.css'), 'utf8');
  const root = css.match(/:root\{([^}]*)\}/)[1];
  for (const t of THEMES) {
    const vars = cssVars(t);
    assert.deepEqual(Object.keys(vars).sort(), [...VAR_NAMES].sort(), `${t.id}: the same variables for every theme`);
    for (const name of Object.keys(vars).filter((n) => !n.startsWith('--theme-'))) assert.ok(root.includes(`${name}:`), `${name} is a variable of styles.css`);
    for (const name of ['--theme-side', '--theme-card', '--theme-hero']) assert.ok(css.includes(`var(${name})`), `styles.css uses ${name}`);
    assert.match(vars['--glow'], /^\d{1,3},\d{1,3},\d{1,3}$/);
    const all = [...Object.values(vars), ...Object.values(sceneCss(t)), previewCss(t)].join(' ');
    assert.doesNotMatch(all, /url\(|;|\}|NaN|undefined/, `${t.id}: plain gradients and colours`);
  }
  assert.ok(sceneCss(byId('nether')).pulse.startsWith('radial-gradient('), 'Nether: the lava breathes');
  assert.match(sceneCss(byId('ocean')).sky, /repeating-linear-gradient/, 'Ocean: light falls in from above');
  assert.equal(byId('nope'), null);
});

test('theme background: 30 fps at most, a capped pixel density, standing still after a while in the background', () => {
  assert.ok(fx.FPS <= 30 && fx.FRAME_MS >= 33);
  assert.ok(fx.MAX_DPR >= 1 && fx.MAX_DPR <= 2);
  assert.ok(fx.BLUR_PAUSE_MS >= 5000 && fx.BLUR_PAUSE_MS <= 60_000);
  assert.ok(fx.PREVIEW.density < 0.5 && fx.PREVIEW.scale < 1, 'the previews are lighter still');
});

test('theme background: the same theme always starts from the same picture, and the particles keep moving sensibly', () => {
  for (const t of THEMES) {
    const a = fx.createSystem(t, { width: 1240, height: 780 });
    const b = fx.createSystem(t, { width: 1240, height: 780 });
    assert.deepEqual(a.parts.map((p) => [p.x, p.y, p.c]), b.parts.map((p) => [p.x, p.y, p.c]), `${t.id}: a fixed first frame`);
    assert.equal(a.parts.length, t.scene.particles.reduce((sum, p) => sum + p.n, 0));
    // 40 seconds at 30 fps, with a few slow frames among them
    for (let i = 0; i < 1200; i += 1) a.step(i % 97 === 0 ? 0.1 : 1 / 30);
    assert.equal(a.parts.length, b.parts.length, `${t.id}: nothing gets lost or piles up`);
    for (const p of a.parts) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${t.id}: ${p.spec.kind} has a place`);
      assert.ok(p.x > -120 && p.x < 1360 && p.y > -80 && p.y < 860, `${t.id}: ${p.spec.kind} stays around the window (${Math.round(p.x)}, ${Math.round(p.y)})`);
      const alpha = a.alpha(p);
      assert.ok(alpha >= 0 && alpha <= 1, `${t.id}: ${p.spec.kind} alpha ${alpha}`);
    }
    const moved = a.parts.filter((p, i) => p.spec.kind !== 'star' && (p.x !== b.parts[i].x || p.y !== b.parts[i].y)).length;
    assert.ok(moved > 0 || a.parts.every((p) => p.spec.kind === 'star'), `${t.id}: it moves`);
  }
});

test('theme background: a bigger window gets more particles, a small preview fewer and smaller ones', () => {
  const nether = byId('nether');
  const sys = fx.createSystem(nether, { width: 1240, height: 780 });
  const before = sys.parts.length;
  sys.resize(1920, 1040, 1.5);
  assert.equal(sys.parts.length, nether.scene.particles.reduce((sum, p) => sum + Math.round(p.n * 1.5), 0));
  assert.ok(sys.parts.length > before);
  assert.ok(sys.parts.every((p) => p.x <= 1920 + 40 && p.y <= 1040 + 40), 'the particles move with the window');
  sys.resize(0, 0); // a minimised window: nothing changes, nothing breaks
  assert.equal(sys.width, 1920);
  const tiny = fx.createSystem(nether, { width: 130, height: 74, density: fx.PREVIEW.density, scale: fx.PREVIEW.scale, min: fx.PREVIEW.min });
  assert.ok(tiny.parts.length >= nether.scene.particles.length * fx.PREVIEW.min && tiny.parts.length < before / 3);
  assert.ok(Math.max(...tiny.parts.map((p) => p.r)) <= Math.max(...nether.scene.particles.map((p) => p.size[1])) * fx.PREVIEW.scale);
  assert.notDeepEqual(fx.rng(1)(), fx.rng(2)());
  assert.equal(fx.seedOf('end'), fx.seedOf('end'));
});

test('settings: theme is a Hammer+ value (all but „default”), checked like every other setting; „Ruchome tło” is free', () => {
  assert.deepEqual([DEFAULT_SETTINGS.theme, DEFAULT_SETTINGS.themeMotion], ['default', true]);
  assert.equal(sanitize({}).theme, 'default', 'an old settings file without a theme');
  for (const id of IDS) assert.equal(sanitize({ theme: id }).theme, id);
  for (const bad of ['Nether', 'lava', '', null, 7, '../x', { id: 'end' }]) assert.equal(sanitize({ theme: bad }).theme, 'default', String(bad));
  assert.equal(sanitize({ theme: 'bad' }, { ...DEFAULT_SETTINGS, theme: 'end' }).theme, 'end', 'a wrong value keeps the one before');
  assert.deepEqual([sanitize({ themeMotion: 0 }).themeMotion, sanitize({ themeMotion: 'yes' }).themeMotion], [false, true]);
  const [free, label] = PLUS_ONLY.theme;
  assert.deepEqual(IDS.filter((id) => free(id)), ['default']);
  assert.equal(label, 'Motywy launchera');
  assert.deepEqual(plusOnly(DEFAULT_SETTINGS, sanitize({ theme: 'end' })), ['Motywy launchera']);
  assert.deepEqual(plusOnly(sanitize({ theme: 'end' }), sanitize({ theme: 'default' })), [], 'going back to the default look is always allowed');
  assert.deepEqual(plusOnly(DEFAULT_SETTINGS, sanitize({ themeMotion: false })), []);
  assert.ok(!('themeMotion' in PLUS_ONLY));
});

test('services: a theme needs Hammer+ – it stays stored when Hammer+ ends, and going back to „default” always works', () => {
  const keys = plusKeys();
  const me = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop', plusPublicKey: keys.publicKey }, accounts: { list: () => [me] }, emit: () => {} });
  s.settings.set({ selectedAccount: me.id });
  assert.throws(() => s.settings.set({ theme: 'nether' }), /Motywy launchera to funkcja Hammer\+/);
  assert.equal(s.settings.set({ themeMotion: false }).themeMotion, false, '„Ruchome tło” needs no Hammer+');
  assert.equal(s.plus.activate(keys.code({ mc: me.id, exp: 0 })).active, true);
  assert.equal(s.settings.set({ theme: 'end' }).theme, 'end');
  assert.equal(s.plus.remove().active, false);
  assert.equal(s.settings.get().theme, 'end', 'stored – the window shows the default look until Hammer+ is back');
  assert.throws(() => s.settings.set({ theme: 'ocean' }), /Motywy launchera/);
  assert.equal(s.settings.set({ theme: 'default' }).theme, 'default');
});
