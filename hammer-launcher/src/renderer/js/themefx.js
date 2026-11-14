'use strict';
/* Hammer Launcher – the moving backgrounds of the launcher's themes (Hammer+): one canvas behind the whole window
   with a modest number of particles, a few CSS lights, and the small live previews in Ustawienia → Wygląd.
   Light on purpose – players run Minecraft next to it: at most 30 frames a second, a capped pixel density, and it
   stands still while the game runs, while the window is hidden or has been in the background for a while, when the
   system asks for less motion and when „Ruchome tło” is off. The particles start from a fixed seed, so the first
   frame of a theme is always the same picture. The particle maths has no page in it: the tests load this file with
   require() too (the window gets HS_THEME_FX). */

(() => {
  const node = typeof module === 'object' && module.exports;
  const T = node ? require('./themes.js') : window.HS_THEMES;

  const FPS = 30;
  const FRAME_MS = 1000 / FPS;
  const MAX_DPR = 1.5; // sharp enough for soft specks, and a 4K screen does not get a 4K canvas
  const BLUR_PAUSE_MS = 20_000; // the window in the background this long → the background stops
  const REF_AREA = 1240 * 780; // the window size the particle counts of themes.js are for
  const PREVIEW = { density: 0.2, scale: 0.6, min: 2 }; // the small previews: fewer, smaller and slower particles
  const TAU = Math.PI * 2;

  /** A small seeded random number generator (mulberry32): the same seed gives the same particles. */
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** A number from a text (FNV-1a) – each theme's seed is its id. */
  const seedOf = (text) => [...String(text)].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const between = (rand, [a, b]) => a + rand() * (b - a);
  const pick = (rand, list) => list[Math.floor(rand() * list.length) % list.length];
  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  /*
   * How each kind of particle is born and moves. `anywhere` places a newborn anywhere in the window (the first
   * frame) instead of where it enters. Speeds are pixels per second, so a slow frame does not slow the scene.
   */
  const KINDS = {
    // a glowing spark that rises, sways and burns out on the way (Nether embers, Deep Dark souls, the warm sparks)
    ember: {
      spawn(p, s, anywhere) {
        p.x = s.rand() * s.w;
        p.y = anywhere ? s.rand() * s.h : s.h + 4 + s.rand() * 16;
        p.vy = between(s.rand, p.spec.speed) * s.scale;
        p.sway = (4 + s.rand() * 10) * s.scale;
        p.life = anywhere ? 0.3 + s.rand() * 0.7 : 1;
        p.fade = 1 / between(s.rand, p.spec.life ?? [7, 16]);
      },
      step(p, dt, s) {
        p.y -= p.vy * dt;
        p.x += Math.cos(p.t) * p.sway * dt;
        p.life -= p.fade * dt;
        if (p.y < -6 || p.life <= 0) born(p, s, false);
      },
      alpha: (p) => p.a * Math.min(1, p.life * 3) * (0.75 + 0.25 * Math.sin(p.t * 4.3)),
    },
    // grey flakes of ash drifting up, fading out near the top
    ash: {
      spawn(p, s, anywhere) {
        p.x = s.rand() * s.w;
        p.y = anywhere ? s.rand() * s.h : s.h + 4;
        p.vy = between(s.rand, p.spec.speed) * s.scale;
        p.sway = (3 + s.rand() * 8) * s.scale;
      },
      step(p, dt, s) {
        p.y -= p.vy * dt;
        p.x += Math.cos(p.t * 0.7) * p.sway * dt;
        if (p.y < -4) born(p, s, false);
      },
      alpha: (p, s) => p.a * clamp01(p.y / (s.h * 0.25)),
    },
    // a soft light floating slowly in any direction and twinkling (End, Ocean, Wiśniowy gaj)
    mote: {
      spawn(p, s) {
        p.x = s.rand() * s.w;
        p.y = s.rand() * s.h;
        const angle = s.rand() * TAU;
        const v = between(s.rand, p.spec.speed) * s.scale;
        p.vx = Math.cos(angle) * v;
        p.vy = Math.sin(angle) * v - v * 0.3;
      },
      step(p, dt, s) {
        p.x += (p.vx + Math.cos(p.t * 0.5) * 2 * s.scale) * dt;
        p.y += p.vy * dt;
        const m = 8;
        if (p.x < -m) p.x += s.w + 2 * m;
        else if (p.x > s.w + m) p.x -= s.w + 2 * m;
        if (p.y < -m) p.y += s.h + 2 * m;
        else if (p.y > s.h + m) p.y -= s.h + 2 * m;
      },
      alpha: (p) => p.a * (0.55 + 0.45 * Math.sin(p.t * 1.7)),
    },
    // the shimmer of an end rod: a small white sparkle that flares up and fades while it rises
    rod: {
      spawn(p, s, anywhere) {
        p.x = s.rand() * s.w;
        p.y = anywhere ? s.rand() * s.h : s.h + 6;
        p.vy = between(s.rand, p.spec.speed) * s.scale;
      },
      step(p, dt, s) {
        p.y -= p.vy * dt;
        p.x += Math.sin(p.t * 0.8) * 3 * s.scale * dt;
        if (p.y < -6) born(p, s, false);
      },
      alpha: (p) => p.a * Math.max(0, Math.sin(p.t * 1.3)) ** 2,
    },
    // a distant star: stays put and twinkles a little
    star: {
      spawn(p, s) {
        p.x = s.rand() * s.w;
        p.y = s.rand() * s.h;
      },
      step() {},
      alpha: (p) => p.a * (0.7 + 0.3 * Math.sin(p.t * 0.9)),
    },
    // a rising bubble that wobbles – the big ones faster – and fades as it reaches the light
    bubble: {
      spawn(p, s, anywhere) {
        p.x = s.rand() * s.w;
        p.y = anywhere ? s.rand() * s.h : s.h + p.r + 4;
        p.vy = between(s.rand, p.spec.speed) * (0.6 + (0.6 * p.r) / (p.spec.size[1] * s.scale)) * s.scale;
        p.sway = (3 + s.rand() * 6) * s.scale;
      },
      step(p, dt, s) {
        p.y -= p.vy * dt;
        p.x += Math.cos(p.t * 2.2) * p.sway * dt;
        if (p.y < -p.r - 4) born(p, s, false);
      },
      alpha: (p, s) => p.a * clamp01((p.y + p.r) / (s.h * 0.18)),
    },
    // a cherry petal falling with the wind, turning and tumbling
    petal: {
      spawn(p, s, anywhere) {
        p.x = s.rand() * (s.w + 80) - 60;
        p.y = anywhere ? s.rand() * s.h : -10 - s.rand() * 30;
        p.vy = between(s.rand, p.spec.speed) * s.scale;
        p.sway = (12 + s.rand() * 22) * s.scale;
        p.rot = s.rand() * TAU;
        p.spin = (s.rand() - 0.5) * 2.4;
        p.flip = 0.8 + s.rand() * 1.6;
      },
      step(p, dt, s) {
        p.y += p.vy * dt;
        p.x += (Math.cos(p.t * 0.9) * p.sway + 6 * s.scale) * dt;
        p.rot += p.spin * dt;
        if (p.y > s.h + 10 || p.x > s.w + 40) born(p, s, false);
      },
      alpha: (p) => p.a,
    },
    // a sculk vibration: a flat ring that spreads over the floor and fades, then waits a moment (`size` = its radius)
    pulse: {
      spawn(p, s, anywhere) {
        p.x = s.w * (0.08 + s.rand() * 0.84);
        p.y = s.h * (0.3 + s.rand() * 0.72);
        p.dur = 3.2 + s.rand() * 2.4;
        p.age = anywhere ? s.rand() * p.dur : 0;
        p.wait = anywhere ? 0 : s.rand() * 2.5;
      },
      step(p, dt, s) {
        if (p.wait > 0) p.wait -= dt;
        else if ((p.age += dt) >= p.dur) born(p, s, false);
      },
      alpha: (p) => (p.wait > 0 ? 0 : p.a * (1 - p.age / p.dur) ** 1.6),
    },
  };

  /** Gives a particle a new life: its look from its line in the theme, then where and how it moves. */
  function born(p, s, anywhere) {
    p.r = between(s.rand, p.spec.size) * s.scale;
    p.a = between(s.rand, p.spec.alpha);
    p.c = pick(s.rand, p.spec.colors);
    p.t = s.rand() * TAU;
    KINDS[p.spec.kind].spawn(p, s, anywhere);
    return p;
  }

  /**
   * The particles of a theme in a box of `width` × `height` px. `density` scales the counts of themes.js (`min`
   * per kind at least), `scale` their sizes and speeds. step(dt) moves them by dt seconds; resize() keeps them in place
   * relative to the box and adds or removes some to keep the density.
   */
  function createSystem(theme, { width, height, density = 1, scale = 1, min = 0, seed = seedOf(theme.id) } = {}) {
    const s = { w: width, h: height, scale, rand: rng(seed) };
    const parts = [];
    const count = (spec, d) => Math.max(min, Math.round(spec.n * d));
    const fill = (d) => {
      for (const spec of theme.scene.particles) {
        const mine = parts.filter((p) => p.spec === spec);
        for (let i = mine.length; i < count(spec, d); i += 1) parts.push(born({ spec }, s, true));
        for (const extra of mine.slice(count(spec, d))) parts.splice(parts.indexOf(extra), 1);
      }
    };
    fill(density);
    return {
      parts,
      get width() {
        return s.w;
      },
      get height() {
        return s.h;
      },
      scale,
      step(dt) {
        for (const p of parts) {
          p.t += dt;
          KINDS[p.spec.kind].step(p, dt, s);
        }
      },
      resize(w, h, d = density) {
        if (!(w > 0 && h > 0)) return;
        for (const p of parts) {
          p.x *= w / s.w;
          p.y *= h / s.h;
        }
        s.w = w;
        s.h = h;
        density = d;
        fill(d);
      },
      alpha: (p) => clamp01(KINDS[p.spec.kind].alpha(p, s)),
    };
  }

  const api = { FPS, FRAME_MS, MAX_DPR, BLUR_PAUSE_MS, REF_AREA, PREVIEW, KINDS, rng, seedOf, createSystem };
  if (node) {
    module.exports = api;
    return;
  }

  /* ── drawing (the window only) ── */
  const SPRITE = 64;
  /** A soft round light in one colour, drawn once and then stamped – much cheaper than a gradient per particle. */
  function glowSprite(cache, colour) {
    let c = cache.get(colour);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = SPRITE;
    const g = c.getContext('2d');
    const half = SPRITE / 2;
    const fill = g.createRadialGradient(half, half, 0, half, half, half);
    const [r, gr, b] = T.rgb(colour);
    fill.addColorStop(0, `rgba(${r},${gr},${b},1)`);
    fill.addColorStop(0.14, `rgba(${r},${gr},${b},1)`); // a bright core…
    fill.addColorStop(0.32, `rgba(${r},${gr},${b},.42)`); // …in a soft halo
    fill.addColorStop(0.62, `rgba(${r},${gr},${b},.1)`);
    fill.addColorStop(1, `rgba(${r},${gr},${b},0)`);
    g.fillStyle = fill;
    g.fillRect(0, 0, SPRITE, SPRITE);
    cache.set(colour, c);
    return c;
  }
  /** A cherry petal: a small oval, lighter in the middle. */
  function petalSprite(cache, colour) {
    let c = cache.get(colour);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = 24;
    c.height = 14;
    const g = c.getContext('2d');
    g.fillStyle = colour;
    g.beginPath();
    g.ellipse(12, 7, 11, 6, 0, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.ellipse(10, 6, 5, 2.4, 0, 0, TAU);
    g.fill();
    cache.set(colour, c);
    return c;
  }

  const DRAW = {
    ember(ctx, p, a, sp) {
      const size = p.r * 7;
      ctx.globalAlpha = a;
      ctx.drawImage(sp.glow(p.c), p.x - size / 2, p.y - size / 2, size, size);
    },
    mote(ctx, p, a, sp) {
      const size = p.r * 7;
      ctx.globalAlpha = a;
      ctx.drawImage(sp.glow(p.c), p.x - size / 2, p.y - size / 2, size, size);
    },
    ash(ctx, p, a) {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    },
    star(ctx, p, a) {
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, p.r, p.r);
    },
    rod(ctx, p, a, sp) {
      const size = p.r * 8;
      ctx.globalAlpha = a * 0.7;
      ctx.drawImage(sp.glow('#c9a8ff'), p.x - size / 2, p.y - size / 2, size, size);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c;
      const arm = p.r * 3;
      ctx.fillRect(p.x - arm, p.y - 0.6, arm * 2, 1.2);
      ctx.fillRect(p.x - 0.6, p.y - arm, 1.2, arm * 2);
    },
    bubble(ctx, p, a) {
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.stroke();
      const dot = Math.max(1, p.r * 0.35);
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.r * 0.45, p.y - p.r * 0.5, dot, dot);
    },
    petal(ctx, p, a, sp, dpr) {
      const w = p.r * 2.4;
      const hgt = p.r * 1.4;
      ctx.globalAlpha = a;
      const cos = Math.cos(p.rot);
      const sin = Math.sin(p.rot);
      const flip = Math.cos(p.t * p.flip); // the petal turning over: seen from the edge it is a thin line
      ctx.setTransform(dpr * cos * flip, dpr * sin * flip, -dpr * sin, dpr * cos, dpr * p.x, dpr * p.y);
      ctx.drawImage(sp.petal(p.c), -w / 2, -hgt / 2, w, hgt);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    pulse(ctx, p, a, sp, dpr, scale) {
      const k = p.age / p.dur;
      const radius = p.r * (1 - (1 - k) ** 2.2);
      ctx.strokeStyle = p.c;
      ctx.lineWidth = 1.6 * scale;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, radius, radius * 0.38, 0, 0, TAU);
      ctx.stroke();
      if (radius > 12) {
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, radius * 0.62, radius * 0.62 * 0.38, 0, 0, TAU);
        ctx.stroke();
      }
    },
  };

  // the stamps, shared by every scene (a few colours per theme)
  const glows = new Map();
  const petals = new Map();
  const sp = { glow: (c) => glowSprite(glows, c), petal: (c) => petalSprite(petals, c) };

  /** One canvas with the particles of a theme – the window's background, or a small preview. */
  function createScene(canvas, theme, { preview = false } = {}) {
    const ctx = canvas.getContext('2d');
    let sys = null;
    let w = 0;
    let hgt = 0;
    let dpr = 1;
    const scene = {
      canvas,
      theme,
      preview,
      born: performance.now(),
      seen: false,
      resize() {
        w = canvas.clientWidth;
        hgt = canvas.clientHeight;
        if (!w || !hgt) return;
        dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(hgt * dpr);
        const density = preview ? PREVIEW.density : Math.min(1.5, Math.max(0.5, (w * hgt) / REF_AREA));
        if (sys) sys.resize(w, hgt, density);
        else sys = createSystem(theme, { width: w, height: hgt, density, scale: preview ? PREVIEW.scale : 1, min: preview ? PREVIEW.min : 0 });
        scene.draw();
      },
      step(dt) {
        sys?.step(dt);
      },
      draw() {
        if (!sys) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, hgt);
        for (const p of sys.parts) {
          const a = sys.alpha(p);
          if (a > 0.01) DRAW[p.spec.kind](ctx, p, a, sp, dpr, sys.scale);
        }
        ctx.globalAlpha = 1;
      },
      stop: () => ro.disconnect(),
    };
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(canvas);
    return scene;
  }

  /* ── one clock for every scene: ≤ 30 fps, and nothing at all while there is a reason to stand still ── */
  const scenes = new Set();
  const hold = { hidden: false, blur: false, reduced: false }; // reasons for everything to stand still (and the game, below)
  let motion = true; // „Ruchome tło” – the window's background only; the previews in Ustawienia always move
  let layer = null; // the window's background: { id, el, drift, pulse, scene }
  let raf = 0;
  let last = 0;
  let clock = 0;

  /** The game runs (not while it is only being prepared or downloaded) – Minecraft gets the computer to itself. */
  function gameOn() {
    for (const v of window.HS?.state?.running?.values() ?? []) if (v === 'starting' || v === 'running') return true;
    return false;
  }
  const held = () => hold.hidden || hold.blur || hold.reduced || gameOn();
  const moves = (sc) => !held() && (sc.preview || motion);

  /** Forgets the previews whose tile left the page (or never got onto it). */
  function prune() {
    const now = performance.now();
    for (const sc of scenes) {
      if (sc.canvas.isConnected) sc.seen = true;
      else if (sc.seen || now - sc.born > 5000) {
        sc.stop();
        scenes.delete(sc);
      }
    }
  }

  /** The CSS lights of the window's background: the breathing one and the wandering ones, on the same clock. */
  function breathe() {
    if (layer?.pulse) layer.pulse.style.opacity = (0.55 + 0.45 * (0.5 + 0.5 * Math.sin((clock * TAU) / 7))).toFixed(3);
    if (layer?.drift) layer.drift.style.transform = `translate3d(${(Math.sin((clock * TAU) / 26) * 3).toFixed(2)}%,${(Math.cos((clock * TAU) / 31) * 2).toFixed(2)}%,0) scale(${(1.04 + 0.03 * Math.sin((clock * TAU) / 19)).toFixed(3)})`;
  }

  function frame(now) {
    raf = 0;
    if (last && now - last < FRAME_MS - 1) {
      raf = requestAnimationFrame(frame); // between two of the 30 frames a second: nothing to do yet
      return;
    }
    prune();
    if (![...scenes].some((sc) => sc.canvas.isConnected && moves(sc))) {
      last = 0;
      sync();
      return; // stands still – the canvases keep their last picture and no frame is asked for until something changes
    }
    raf = requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : FRAME_MS / 1000;
    last = now;
    for (const sc of scenes) {
      if (!sc.canvas.isConnected || !moves(sc)) continue;
      sc.step(dt);
      sc.draw();
    }
    if (layer && moves(layer.scene)) {
      clock += dt;
      breathe();
    }
    sync();
  }
  /** Something changed (a reason to stand still came or went, a scene was added): start the clock if it should run. */
  function kick() {
    sync();
    if (!raf) raf = requestAnimationFrame(frame);
  }
  /** The window's background says whether it moves – `.still` (handy to look at, and for the preview script). */
  function sync() {
    layer?.el.classList.toggle('still', !moves(layer.scene));
  }

  let wired = false;
  let gameWired = false;
  /** Listens for the reasons to stand still (once). */
  function wire() {
    if (!wired) {
      wired = true;
      const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      hold.reduced = Boolean(media?.matches);
      media?.addEventListener?.('change', (e) => {
        hold.reduced = e.matches;
        kick();
      });
      hold.hidden = document.hidden;
      document.addEventListener('visibilitychange', () => {
        hold.hidden = document.hidden;
        kick();
      });
      let away = 0;
      const blurred = () => {
        clearTimeout(away);
        away = setTimeout(() => {
          hold.blur = true;
          kick();
        }, BLUR_PAUSE_MS);
      };
      window.addEventListener('blur', blurred);
      window.addEventListener('focus', () => {
        clearTimeout(away);
        hold.blur = false;
        kick();
      });
      if (!document.hasFocus()) blurred();
    }
    // the game starting or ending (core.js emits 'game'); HS exists once core.js has run
    if (!gameWired && window.HS?.bus) {
      gameWired = true;
      window.HS.bus.on('game', kick);
    }
  }

  /** The window's background for a theme – built once per theme, behind everything (#app lies over it). */
  function mount(theme) {
    if (layer?.id === theme.id) return;
    unmount();
    const css = T.sceneCss(theme);
    const el = document.createElement('div');
    el.className = 'theme-bg';
    el.id = 'theme-bg';
    el.dataset.theme = theme.id;
    el.setAttribute('aria-hidden', 'true');
    const part = (cls, background) => {
      if (!background) return null;
      const d = document.createElement('div');
      d.className = cls;
      d.style.background = background;
      el.append(d);
      return d;
    };
    part('sky', css.sky);
    const drift = part('drift', css.drift);
    const pulse = part('pulse', css.pulse);
    const canvas = document.createElement('canvas');
    el.append(canvas);
    document.body.prepend(el);
    const scene = createScene(canvas, theme);
    scenes.add(scene);
    layer = { id: theme.id, el, drift, pulse, scene };
    clock = 0;
    breathe();
  }
  function unmount() {
    if (!layer) return;
    layer.scene.stop();
    scenes.delete(layer.scene);
    layer.el.remove();
    layer = null;
  }

  /** The CSS variables core.js manages itself (the accent colour) – left alone when the theme goes back to 'default'. */
  const ACCENT_VARS = new Set(['--accent', '--accent2', '--accent3', '--accent-hi', '--accent-ink', '--glow']);

  /**
   * Puts a theme on the window: its colours (CSS variables on <html>, `data-theme`) and its moving background.
   * 'default' (or an unknown id) takes all of it off again. `motion: false` = „Ruchome tło” off: the colours and a
   * still picture of the background stay.
   */
  function apply(id, { motion: moving = true } = {}) {
    wire();
    motion = moving !== false;
    const theme = T.byId(id);
    const root = document.documentElement;
    if (!theme || theme.id === 'default') {
      if (root.dataset.theme) for (const name of T.VAR_NAMES) if (!ACCENT_VARS.has(name)) root.style.removeProperty(name);
      delete root.dataset.theme;
      unmount();
      return;
    }
    for (const [name, value] of Object.entries(T.cssVars(theme))) root.style.setProperty(name, value);
    root.dataset.theme = theme.id;
    mount(theme);
    kick();
  }

  /** A small live preview of a theme on `canvas` (Ustawienia → Wygląd). It is forgotten once the canvas leaves the page. */
  function preview(canvas, id) {
    wire();
    const sc = createScene(canvas, T.byId(id) ?? T.THEMES[0], { preview: true });
    prune();
    scenes.add(sc);
    kick();
    return sc;
  }

  /** What the backgrounds are doing – for the preview script and for looking around in the developer tools. */
  const status = () => ({ theme: layer?.id ?? 'default', moving: Boolean(layer && moves(layer.scene)), motion, game: gameOn(), ...hold, scenes: scenes.size, running: Boolean(raf) });

  window.HS_THEME_FX = { ...api, apply, preview, status };
})();
