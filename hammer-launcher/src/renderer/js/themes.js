'use strict';
/* Hammer Launcher – the launcher's themes (Hammer+): the colours of the whole window and the moving background
   behind it. Plain data and functions without the page: the window uses them as HS_THEMES, the tests load the
   same file with require(). js/themefx.js draws the backgrounds. */

(() => {
  /*
   * A theme:
   *   colors  – every colour of the window (the CSS variables of styles.css :root), `line` and `glow` as one colour
   *   scene   – the background behind the whole window:
   *     sky        the base, top → bottom
   *     glows      soft lights that stay put ({ at: [x%, y%], size: [w%, h%], color, alpha } – alpha in the middle)
   *     pulse      one light that slowly breathes (its alpha is the brightest moment)
   *     drift      lights that slowly wander (Ocean: the caustics)
   *     rays       light falling in from above ({ color, alpha }) – Ocean
   *     side       how solid the side bar and the title bar are over the background (0…1)
   *     card       how solid the cards are (just below 1: the lights glow through a little, the text stays crisp)
   *     hero       the banner of the Graj screen: two colours over the background and how solid they are
   *     particles  what moves: kind (see themefx.js), n = how many in a 1240×780 window, colours, size (px),
   *                speed (px per second), alpha, life (seconds an ember burns, optional)
   * 'default' is today's look: its scene only feeds the small preview in Ustawienia → Wygląd.
   */
  const THEMES = [
    {
      id: 'default',
      label: 'Domyślny',
      hint: 'klasyczny wygląd',
      colors: { bg: '#0e0b09', bg2: '#130f0b', side: '#120d0a', panel: '#1a140f', panel2: '#211912', panel3: '#2a2017', line: '#ffc48c', text: '#f7efe7', muted: '#b9a797', dim: '#85725f', accent: '#ff9f43', accent2: '#ffbd78', accent3: '#f07a1c', accentHi: '#ffd4a3', ink: '#2a1405', glow: '#ff963a' },
      scene: {
        sky: ['#1d140d', '#120d09'],
        glows: [{ at: [85, 10], size: [60, 90], color: '#ff963a', alpha: 0.28 }, { at: [0, 120], size: [70, 60], color: '#ff963a', alpha: 0.3 }],
        side: 1,
        hero: ['#1d140d', '#120d09'],
        heroAlpha: 1,
        particles: [{ kind: 'ember', n: 30, colors: ['#ffbe78', '#ffa050'], size: [0.6, 2.2], speed: [5, 14], alpha: [0.3, 0.85] }],
      },
    },
    {
      id: 'nether',
      label: 'Nether',
      hint: 'lawa, żar i popiół',
      colors: { bg: '#110708', bg2: '#160a0a', side: '#14080a', panel: '#1e0d0e', panel2: '#271213', panel3: '#321718', line: '#ff8466', text: '#fbeeea', muted: '#cfaba2', dim: '#ad867c', accent: '#ff7a3a', accent2: '#ffae80', accent3: '#e3581f', accentHi: '#ffd5bd', ink: '#2a0a02', glow: '#ff6a2a' },
      scene: {
        sky: ['#0d0506', '#240a06'],
        glows: [{ at: [6, -4], size: [62, 72], color: '#9a1622', alpha: 0.36 }, { at: [100, 46], size: [46, 62], color: '#c0301c', alpha: 0.17 }, { at: [78, 16], size: [42, 40], color: '#ff5a1e', alpha: 0.09 }],
        pulse: { at: [50, 110], size: [120, 76], color: '#ff4a12', alpha: 0.32 },
        side: 0.74,
        card: 0.9,
        hero: ['#2b0f0c', '#160809'],
        heroAlpha: 0.46,
        particles: [
          { kind: 'ember', n: 48, colors: ['#ffd29a', '#ffa557', '#ff7a2e'], size: [1, 2.8], speed: [18, 46], alpha: [0.55, 1], life: [10, 22] },
          { kind: 'ash', n: 22, colors: ['#8e8582', '#6d6361', '#a39a96'], size: [1.2, 2.6], speed: [4, 11], alpha: [0.25, 0.5] },
        ],
      },
    },
    {
      id: 'end',
      label: 'End',
      hint: 'pustka i gwiazdy',
      colors: { bg: '#0a0810', bg2: '#0e0b16', side: '#0c0913', panel: '#15111f', panel2: '#1c1728', panel3: '#251f33', line: '#d6beff', text: '#f4f0fb', muted: '#b6acc9', dim: '#8f84a6', accent: '#e4df9f', accent2: '#f0edc6', accent3: '#c0ba6e', accentHi: '#f8f6e0', ink: '#1b1530', glow: '#a47cff' },
      scene: {
        sky: ['#06050b', '#120b20'],
        glows: [{ at: [80, 10], size: [62, 72], color: '#7a4cff', alpha: 0.25 }, { at: [8, 92], size: [55, 55], color: '#b04cff', alpha: 0.15 }, { at: [40, 42], size: [52, 42], color: '#3d2a8a', alpha: 0.16 }],
        pulse: { at: [56, 58], size: [74, 62], color: '#5b33c9', alpha: 0.12 },
        side: 0.74,
        card: 0.9,
        hero: ['#1d1530', '#0d0a16'],
        heroAlpha: 0.46,
        particles: [
          { kind: 'star', n: 80, colors: ['#ffffff', '#e2d6ff', '#fff6d6'], size: [0.6, 1.6], speed: [0, 0], alpha: [0.3, 0.9] },
          { kind: 'mote', n: 30, colors: ['#b98cff', '#9a6bff', '#d2a8ff'], size: [1.2, 3], speed: [3, 9], alpha: [0.35, 0.8] },
          { kind: 'rod', n: 12, colors: ['#fbf6ff', '#efe4ff'], size: [1.3, 2.4], speed: [4, 10], alpha: [0.5, 1] },
        ],
      },
    },
    {
      id: 'ocean',
      label: 'Ocean',
      hint: 'pryzmaryn i bąbelki',
      colors: { bg: '#06111a', bg2: '#081520', side: '#07131c', panel: '#0b1b26', panel2: '#10232f', panel3: '#162d3b', line: '#8cdcf0', text: '#eaf6fa', muted: '#a2c3cf', dim: '#80a3b0', accent: '#5ad8b8', accent2: '#9eeed8', accent3: '#25a888', accentHi: '#cdf7ea', ink: '#032119', glow: '#45cfa8' },
      scene: {
        sky: ['#08202c', '#030a10'],
        glows: [{ at: [28, -6], size: [62, 42], color: '#3fb4d8', alpha: 0.13 }, { at: [86, 0], size: [46, 36], color: '#46d0c0', alpha: 0.12 }, { at: [50, 116], size: [95, 42], color: '#04202c', alpha: 0.4 }],
        drift: [{ at: [25, 6], size: [40, 30], color: '#5fe0d8', alpha: 0.1 }, { at: [62, 12], size: [32, 26], color: '#8af0e6', alpha: 0.08 }, { at: [45, 2], size: [24, 16], color: '#c8fff6', alpha: 0.05 }],
        rays: { color: '#8ff5ea', alpha: 0.045 },
        side: 0.74,
        card: 0.9,
        hero: ['#0b2230', '#07121a'],
        heroAlpha: 0.46,
        particles: [
          { kind: 'bubble', n: 36, colors: ['#bff7f0', '#9be9f5'], size: [1.6, 5.5], speed: [14, 38], alpha: [0.3, 0.7] },
          { kind: 'mote', n: 18, colors: ['#5fe3d0', '#9ff5e6'], size: [0.8, 1.9], speed: [2, 6], alpha: [0.25, 0.6] },
        ],
      },
    },
    {
      id: 'cherry',
      label: 'Wiśniowy gaj',
      hint: 'spadające płatki',
      colors: { bg: '#120a0e', bg2: '#170d12', side: '#150b10', panel: '#1f1118', panel2: '#28161f', panel3: '#321c27', line: '#ffaad2', text: '#fdf0f5', muted: '#d2acbc', dim: '#a8828f', accent: '#ff8fc0', accent2: '#ffbdd9', accent3: '#e35f9b', accentHi: '#ffe0ee', ink: '#2c0a19', glow: '#ff86ba' },
      scene: {
        sky: ['#1c0d16', '#0e070b'],
        glows: [{ at: [88, 4], size: [62, 62], color: '#ff7eb6', alpha: 0.2 }, { at: [8, 96], size: [55, 45], color: '#ff9ec8', alpha: 0.1 }, { at: [46, 34], size: [60, 42], color: '#7a2a52', alpha: 0.15 }],
        side: 0.74,
        card: 0.9,
        hero: ['#2b1220', '#150a10'],
        heroAlpha: 0.46,
        particles: [
          { kind: 'petal', n: 40, colors: ['#ffb7d5', '#ff9cc6', '#ffd3e5', '#f58cbb'], size: [2.8, 5], speed: [12, 26], alpha: [0.6, 0.95] },
          { kind: 'mote', n: 12, colors: ['#fff1c9', '#ffe3ef'], size: [0.7, 1.6], speed: [2, 6], alpha: [0.3, 0.65] },
        ],
      },
    },
    {
      id: 'deepdark',
      label: 'Głęboki mrok',
      hint: 'pulsujący sculk',
      colors: { bg: '#040709', bg2: '#060a0d', side: '#05090b', panel: '#0a1114', panel2: '#0e171b', panel3: '#131f24', line: '#4fd6e6', text: '#e4f2f4', muted: '#93b3b8', dim: '#6a8a8f', accent: '#36d2e8', accent2: '#8be6f3', accent3: '#139fb4', accentHi: '#c4f3fa', ink: '#01161b', glow: '#1fc0dc' },
      scene: {
        sky: ['#020405', '#05100f'],
        glows: [{ at: [15, -5], size: [58, 52], color: '#0b2633', alpha: 0.5 }, { at: [92, 70], size: [40, 50], color: '#06323a', alpha: 0.35 }],
        pulse: { at: [50, 112], size: [115, 62], color: '#0b8f9c', alpha: 0.28 },
        side: 0.74,
        card: 0.9,
        hero: ['#0b1d24', '#05090c'],
        heroAlpha: 0.46,
        particles: [
          { kind: 'pulse', n: 6, colors: ['#2fe0e8', '#1fb8c4'], size: [80, 190], speed: [0, 0], alpha: [0.3, 0.6] },
          { kind: 'ember', n: 28, colors: ['#7ff3f5', '#3ad8e0', '#b8fbff'], size: [0.9, 2.2], speed: [6, 16], alpha: [0.45, 0.95], life: [8, 18] },
        ],
      },
    },
  ];

  const IDS = THEMES.map((t) => t.id);
  const HERO_LIGHT = 0.2; // the accent light in the top corner of the Graj banner
  const byId = (id) => THEMES.find((t) => t.id === id) ?? null;

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hexOf = (parts) => `#${parts.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
  const rgba = (hex, alpha) => `rgba(${rgb(hex).join(',')},${alpha})`;
  /** A colour laid over another one with some transparency – what the screen shows (0 = only `base`, 1 = only `top`). */
  const over = (base, top, alpha) => hexOf(rgb(base).map((v, i) => v + (rgb(top)[i] - v) * alpha));
  /** Relative luminance, the WCAG formula (the same as HS_THEME's). */
  function luminance(hex) {
    const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const brighter = (a, b) => (luminance(a) >= luminance(b) ? a : b);

  /** How strong a light (a radial gradient: its colour in the middle, transparent at 70 %) is at x, y (0…1 of the window). */
  function lightAt(l, x, y) {
    const d = Math.hypot((x - l.at[0] / 100) / (l.size[0] / 100), (y - l.at[1] / 100) / (l.size[1] / 100));
    return d >= 0.7 ? 0 : l.alpha * (1 - d / 0.7);
  }
  const RAYS_FADE = [0.22, 0.78]; // where the rays start to fade out and where they are gone (0…1 from the top)
  /** The colour of the background at x, y (0…1 of the window) with everything that breathes at its brightest. */
  function backdropAt(theme, x, y) {
    const sc = theme.scene;
    let colour = over(sc.sky[0], sc.sky[1], y);
    if (sc.rays) colour = over(colour, sc.rays.color, sc.rays.alpha * (1 - Math.min(1, Math.max(0, (y - RAYS_FADE[0]) / (RAYS_FADE[1] - RAYS_FADE[0])))));
    // bottom to top, the way the page stacks them: the lights that stay put (the first one lies on top), the wandering ones, the breathing one
    for (const l of [...(sc.glows ?? [])].reverse()) colour = over(colour, l.color, lightAt(l, x, y));
    for (const l of [...(sc.drift ?? [])].reverse()) colour = over(colour, l.color, lightAt(l, x, y));
    if (sc.pulse) colour = over(colour, sc.pulse.color, lightAt(sc.pulse, x, y));
    return colour;
  }
  /**
   * The brightest colour the background shows anywhere in the window – what text right on it (the page headings)
   * has to stand out from. The particles are left out: specks a few pixels wide that drift past, not a surface.
   */
  function backdrop(theme) {
    let worst = theme.scene.sky[0];
    for (let i = 0; i <= 40; i += 1) for (let j = 0; j <= 40; j += 1) worst = brighter(worst, backdropAt(theme, i / 40, j / 40));
    return worst;
  }
  /** The same behind the side bar and the title bar (their colour over the background). */
  const sideBackdrop = (theme) => over(backdrop(theme), theme.colors.side, theme.scene.side);
  /** The same on a card (its colour over the background). */
  const cardBackdrop = (theme) => over(backdrop(theme), theme.colors.panel, theme.scene.card ?? 1);
  /** The same behind the text of the Graj banner (its two colours over the background, and its light in the corner). */
  const heroBackdrop = (theme) => over(over(backdrop(theme), brighter(theme.scene.hero[0], theme.scene.hero[1]), theme.scene.heroAlpha), theme.colors.glow, HERO_LIGHT);

  /* ── CSS ── */
  const glowCss = (l) => `radial-gradient(${l.size[0]}% ${l.size[1]}% at ${l.at[0]}% ${l.at[1]}%,${rgba(l.color, l.alpha)},transparent 70%)`;
  const raysCss = (r) =>
    `repeating-linear-gradient(104deg,transparent 0 9%,${rgba(r.color, r.alpha)} 11%,transparent 15%,transparent 23%,${rgba(r.color, r.alpha * 0.6)} 25%,transparent 28%)`;
  /** The CSS backgrounds of a scene: { sky, pulse, drift } – `sky` holds the base and the lights that stay put. */
  function sceneCss(theme) {
    const sc = theme.scene;
    const sky = (sc.glows ?? []).map(glowCss);
    // the rays fade out on the way down: the sky's own deep colour lies over their lower part
    if (sc.rays) sky.push(`linear-gradient(180deg,transparent ${RAYS_FADE[0] * 100}%,${sc.sky[1]} ${RAYS_FADE[1] * 100}%)`, raysCss(sc.rays));
    sky.push(`linear-gradient(180deg,${sc.sky[0]},${sc.sky[1]})`);
    return { sky: sky.join(','), pulse: sc.pulse ? glowCss(sc.pulse) : '', drift: (sc.drift ?? []).map(glowCss).join(',') };
  }
  /** One flat picture of a scene for the small previews: everything that moves, in its middle position. */
  function previewCss(theme) {
    const css = sceneCss(theme);
    return [css.drift, css.pulse, css.sky].filter(Boolean).join(',');
  }

  const VARS = { bg: '--bg', bg2: '--bg2', side: '--side', panel: '--panel', panel2: '--panel2', panel3: '--panel3', text: '--text', muted: '--muted', dim: '--dim', accent: '--accent', accent2: '--accent2', accent3: '--accent3', accentHi: '--accent-hi', ink: '--accent-ink' };
  /** The CSS variables a theme puts on the page: name → value (the palette, the lines, the glow, the side bar, the banner). */
  function cssVars(theme) {
    const c = theme.colors;
    const sc = theme.scene;
    const out = Object.fromEntries(Object.entries(VARS).map(([key, name]) => [name, c[key]]));
    out['--line'] = rgba(c.line, 0.09);
    out['--line2'] = rgba(c.line, 0.16);
    out['--glow'] = rgb(c.glow).join(',');
    out['--theme-side'] = rgba(c.side, sc.side);
    out['--theme-card'] = rgba(c.panel, sc.card ?? 1);
    out['--theme-hero'] = `radial-gradient(ellipse 60% 90% at 85% 10%,${rgba(c.glow, HERO_LIGHT)},transparent 60%),linear-gradient(135deg,${rgba(sc.hero[0], sc.heroAlpha)},${rgba(sc.hero[1], sc.heroAlpha)})`;
    return out;
  }
  /** Every variable name cssVars() can set – taken off the page again when the theme goes back to 'default'. */
  const VAR_NAMES = Object.keys(cssVars(THEMES[1]));

  const api = { THEMES, IDS, byId, cssVars, VAR_NAMES, sceneCss, previewCss, backdrop, backdropAt, sideBackdrop, cardBackdrop, heroBackdrop, over, luminance, rgba, rgb };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.HS_THEMES = api;
})();
