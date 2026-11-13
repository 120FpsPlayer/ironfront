'use strict';
/* Hammer Launcher – shared UI helpers: DOM builder, icons, state, toasts, modals, formatting. */

(() => {
  const api = window.hs;

  /* ── DOM ── */
  function h(tag, attrs, ...children) {
    const [name, ...classes] = tag.split('.');
    const el = document.createElement(name || 'div');
    if (classes.length) el.className = classes.join(' ');
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') for (const [prop, val] of Object.entries(v)) prop.startsWith('--') ? el.style.setProperty(prop, val) : (el.style[prop] = val);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'value' && name === 'textarea') el.value = v; // a textarea has no "value" attribute – its text is its value
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    append(el, children);
    return el;
  }
  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function clear(el, ...children) {
    el.replaceChildren();
    return append(el, children);
  }
  /**
   * Marks an element whose text is not the launcher's own – a name the player typed, a description from the
   * network, a file name – so the English version (js/i18n.js) never translates it: raw(h('b', instance.name)).
   * With 'attrs' only the element's own title / aria-label are left alone, the text inside is still translated.
   */
  function raw(el, what = '') {
    el.setAttribute('data-no-i18n', what);
    return el;
  }

  const SVG = 'http://www.w3.org/2000/svg';
  function icon(name, cls) {
    const def = window.HS_ICONS?.[name] ?? window.HS_ICONS?.cube;
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', def[0]);
    svg.setAttribute('class', `i${cls ? ` ${cls}` : ''}`);
    svg.setAttribute('aria-hidden', 'true');
    for (const d of def[1]) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  /* ── formatting (Polish; numbers and dates follow the language – the words are translated by js/i18n.js) ── */
  const i18n = window.HS_I18N;
  /** 'pl-PL', or 'en-GB' when the launcher speaks English. */
  const locale = () => i18n.locale();
  const formats = {};
  const nf = { format: (n) => (formats[locale()] ??= new Intl.NumberFormat(locale())).format(n) };
  /** "1.5" as the language writes it: with a comma in Polish. */
  const dec = (text) => (i18n.lang === 'en' ? text : text.replace('.', ','));
  const fmt = {
    num: (n) => nf.format(n ?? 0),
    // ("92M" / "21K" in English – the British "92m" reads like metres)
    compact: (n) => new Intl.NumberFormat(i18n.lang === 'en' ? 'en-US' : locale(), { notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0),
    gb: (bytes, d = 1) => `${dec((bytes / 1024 ** 3).toFixed(d))} GB`,
    mb: (mb) => (mb >= 1024 ? `${dec((mb / 1024).toFixed(mb % 1024 ? 1 : 0))} GB` : `${mb} MB`),
    size: (b) => (b >= 1024 ** 3 ? fmt.gb(b, b >= 10 * 1024 ** 3 ? 1 : 2) : b >= 1024 ** 2 ? `${dec((b / 1024 ** 2).toFixed(1))} MB` : `${Math.max(1, Math.round(b / 1024))} KB`),
    plural: (n, one, few, many) => {
      const a = Math.abs(n);
      if (a === 1) return one;
      if (a % 10 >= 2 && a % 10 <= 4 && (a % 100 < 10 || a % 100 >= 20)) return few;
      return many;
    },
    count: (n, one, few, many) => `${nf.format(n)} ${fmt.plural(n, one, few, many)}`,
    duration(ms) {
      const m = Math.floor((ms ?? 0) / 60000);
      if (m < 1) return 'mniej niż minuta';
      if (m < 60) return `${m} min`;
      const hrs = Math.floor(m / 60);
      return `${hrs} h${m % 60 ? ` ${m % 60} min` : ''}`;
    },
    ago(ts) {
      if (!ts) return 'nigdy';
      const s = Math.round((Date.now() - new Date(ts).getTime()) / 1000);
      if (s < 60) return 'przed chwilą';
      const m = Math.round(s / 60);
      if (m < 60) return `${m} min temu`;
      const hr = Math.round(m / 60);
      if (hr < 24) return `${hr} ${fmt.plural(hr, 'godzinę', 'godziny', 'godzin')} temu`;
      const d = Math.round(hr / 24);
      if (d === 1) return 'wczoraj';
      if (d < 30) return `${d} dni temu`;
      return new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
    },
    date: (ts) => new Date(ts).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }),
    /** "11 lis, 14:05" – for lists (test history, restore points). */
    dateTime: (ts) => new Date(ts).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
    /** Frames per second: whole numbers from 100 up, one decimal below ("240", "58,4"). */
    fps: (n) => (n >= 100 ? nf.format(Math.round(n)) : dec(String(Math.round((n ?? 0) * 10) / 10))),
  };

  const LOADERS = {
    vanilla: { name: 'Vanilla', hint: 'Czysty Minecraft, bez modów' },
    fabric: { name: 'Fabric', hint: 'Lekki i szybki – najlepszy do optymalizacji' },
    quilt: { name: 'Quilt', hint: 'Odgałęzienie Fabric, działa z większością jego modów' },
    forge: { name: 'Forge', hint: 'Klasyka – duże, starsze paczki modów' },
    neoforge: { name: 'NeoForge', hint: 'Następca Forge dla nowych wersji' },
  };

  const TILES = {
    hammer: ['hammer', '#ffc68a', '#e8650e'],
    grass: ['seedling', '#8fe39c', '#2b8a4a'],
    diamond: ['gem', '#8ee8ff', '#2385d0'],
    sword: ['shield', '#e1e6ee', '#5f6b7c'],
    pickaxe: ['mountain', '#d9b38a', '#7a5130'],
    creeper: ['skull', '#9be98a', '#357f2d'],
    nether: ['fire', '#ff9a76', '#b01f1a'],
    end: ['dragon', '#d0aaff', '#5a2cae'],
    rocket: ['rocket', '#ffd877', '#de6b22'],
    star: ['star', '#ffe48f', '#e59a12'],
  };

  function tile(instance, size = 44) {
    const url = instance?.modpack?.iconUrl;
    const [ic, c1, c2] = TILES[instance?.icon] ?? TILES.hammer;
    const el = h('div.tile', { style: { '--s': `${size}px`, '--c1': c1, '--c2': c2 } });
    if (url && /^(https:\/\/|data:image\/)/.test(url)) {
      const img = h('img', { src: url, alt: '', loading: 'lazy' });
      img.onerror = () => clear(el, icon(ic));
      el.append(img);
    } else el.append(icon(ic));
    return el;
  }

  /** Player head from the Minecraft skin (face + hat layer), no third-party service. */
  function head(account, size = 36) {
    const el = h('div.head', { style: { '--s': `${size}px` } });
    const skin = account?.skinUrl;
    if (skin && /^(https:\/\/|data:image\/)/.test(skin)) {
      const s = size;
      el.style.backgroundImage = `url("${skin}"), url("${skin}")`;
      el.style.backgroundSize = `${s * 8}px ${s * 8}px, ${s * 8}px ${s * 8}px`;
      el.style.backgroundPosition = `${-s * 5}px ${-s}px, ${-s}px ${-s}px`;
    } else el.textContent = (account?.name ?? '?').slice(0, 1).toUpperCase();
    return el;
  }

  /* ── Minecraft skins on a canvas ── */
  // Where each body part sits in the skin file: [x, y] of its front and back, for the base and the second layer.
  const SKIN_PARTS = {
    head: { size: [8, 8], front: [8, 8], back: [24, 8], over: { front: [40, 8], back: [56, 8] }, grow: 0.5 },
    body: { size: [8, 12], front: [20, 20], back: [32, 20], over: { front: [20, 36], back: [32, 36] }, grow: 0.25 },
    rightArm: { size: [4, 12], front: [44, 20], back: [52, 20], over: { front: [44, 36], back: [52, 36] }, grow: 0.25, arm: true },
    leftArm: { size: [4, 12], front: [36, 52], back: [44, 52], over: { front: [52, 52], back: [60, 52] }, grow: 0.25, arm: true, mirror: 'rightArm' },
    rightLeg: { size: [4, 12], front: [4, 20], back: [12, 20], over: { front: [4, 36], back: [12, 36] }, grow: 0.25 },
    leftLeg: { size: [4, 12], front: [20, 52], back: [28, 52], over: { front: [4, 52], back: [12, 52] }, grow: 0.25, mirror: 'rightLeg' },
  };

  /**
   * Draws a player from a skin image: head, body, arms and legs, with the second layer (hat, jacket, sleeves)
   * slightly bigger on top. slim = the 3-pixel "Alex" arms; back = seen from behind. Old 64×32 skins have no left
   * arm and leg of their own – those mirror the right ones. cape: a loaded cape picture – seen from behind it hangs
   * from the shoulders over the back (10×16 pixels of the cape's outer side), under the head.
   */
  function paintSkin(canvas, img, { slim = false, back = false, cape = null } = {}) {
    const g = canvas.getContext('2d');
    const u = canvas.width / 18; // the figure is 16×32 skin pixels, plus one pixel of room around for the second layer
    const legacy = img.naturalHeight === 32;
    const arm = slim && !legacy ? 3 : 4;
    const side = back ? 'back' : 'front';
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, canvas.width, canvas.height);
    // Where the parts stand, seen from the front; from behind, left and right swap places.
    const place = { head: [4, 0], body: [4, 8], rightArm: [4 - arm, 8], leftArm: [12, 8], rightLeg: [4, 20], leftLeg: [8, 20] };
    if (back) Object.assign(place, { rightArm: [12, 8], leftArm: [4 - arm, 8], rightLeg: [8, 20], leftLeg: [4, 20] });
    const draw = (name, layer) => {
      const part = SKIN_PARTS[name];
      const mirrored = legacy && part.mirror;
      const from = mirrored ? SKIN_PARTS[part.mirror] : part;
      let [sx, sy] = layer ? from.over[side] : from[side];
      const w = part.arm ? arm : part.size[0];
      // Slim arms are one pixel narrower, so the back of the arm starts one pixel earlier in the file.
      if (part.arm && back && arm === 3) sx -= 1;
      const grow = layer ? part.grow : 0;
      const x = (1 + place[name][0] - grow) * u;
      const y = (1 + place[name][1] - grow) * u;
      const dw = (w + grow * 2) * u;
      const dh = (part.size[1] + grow * 2) * u;
      g.save();
      if (mirrored) {
        g.translate(x + dw, y);
        g.scale(-1, 1);
        g.drawImage(img, sx, sy, w, part.size[1], 0, 0, dw, dh);
      } else g.drawImage(img, sx, sy, w, part.size[1], x, y, dw, dh);
      g.restore();
    };
    const order = ['rightLeg', 'leftLeg', 'body', 'rightArm', 'leftArm', 'head'];
    if (back && cape) {
      const limbs = order.filter((n) => n !== 'head');
      for (const name of limbs) draw(name, false);
      if (!legacy) for (const name of limbs) draw(name, true);
      const k = cape.naturalWidth / 64; // high-resolution capes keep the same layout
      g.drawImage(cape, k, k, 10 * k, 16 * k, (1 + 3) * u, (1 + 8) * u, 10 * u, 16 * u);
      draw('head', false);
      draw('head', true);
      return;
    }
    for (const name of order) draw(name, false);
    // The second layer: old skins only have the hat.
    for (const name of legacy ? ['head'] : order) draw(name, true);
  }

  const CAPE_SRC = /^(https:\/\/|data:image\/png|assets\/capes\/[a-z0-9_-]+\.png$)/;
  const loadImg = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  /** A canvas with the player drawn from a skin (https or data URL). height = pixels on screen. cape: the cape worn (seen from behind). */
  function skinView(src, { slim = false, back = false, height = 256, cape = null } = {}) {
    const unit = Math.max(1, Math.round(height / 34));
    const canvas = h('canvas.skin-view', { width: 18 * unit, height: 34 * unit, role: 'img', 'aria-label': back ? (cape ? 'Skórka od tyłu, z peleryną' : 'Skórka od tyłu') : 'Skórka od przodu' });
    if (!src || !/^(https:\/\/|data:image\/png)/.test(src)) return canvas;
    const withCape = back && cape && CAPE_SRC.test(cape);
    Promise.all([loadImg(src), withCape ? loadImg(cape).catch(() => null) : null])
      .then(([img, capeImg]) => paintSkin(canvas, img, { slim, back, cape: capeImg }))
      .catch(() => canvas.classList.add('broken'));
    return canvas;
  }

  /**
   * A cape as the player sees it from behind (the 10×16 outer side of the cape texture). `src` is a cape of the
   * account (https or data URL) or one of the launcher's own Hammer+ capes (assets/capes/<id>.png).
   */
  function capeView(src, height = 64) {
    const unit = Math.max(1, Math.round(height / 16));
    const canvas = h('canvas.cape-view', { width: 10 * unit, height: 16 * unit, role: 'img', 'aria-label': 'Peleryna' });
    if (!src || !CAPE_SRC.test(src)) return canvas;
    const img = new Image();
    img.onload = () => {
      const g = canvas.getContext('2d');
      const k = img.naturalWidth / 64; // high-resolution capes keep the same layout
      g.imageSmoothingEnabled = false;
      g.drawImage(img, k, k, 10 * k, 16 * k, 0, 0, canvas.width, canvas.height);
    };
    img.src = src;
    return canvas;
  }

  /** Slim ("Alex") skins leave the fourth column of the arm empty – a good first guess for the model switch. */
  function looksSlim(img) {
    if (img.naturalWidth !== 64 || img.naturalHeight !== 64) return false;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(54, 20, 2, 12).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  /* ── the launcher's colour (Ustawienia → Wygląd) ── */
  const ACCENTS = [
    { value: 'orange', label: 'Pomarańczowy', color: '#ff9f43' },
    { value: 'gold', label: 'Złoty', color: '#f5c542' },
    { value: 'red', label: 'Czerwony', color: '#ff6b5e' },
    { value: 'blue', label: 'Niebieski', color: '#5aa9ff' },
    { value: 'green', label: 'Zielony', color: '#4fd68a' },
    { value: 'purple', label: 'Fioletowy', color: '#b08cff' },
  ];
  function applyAccent(value) {
    const accent = ACCENTS.some((a) => a.value === value) ? value : 'orange';
    if (accent === 'orange') delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = accent;
  }

  /* ── Hammer+ looks: any accent colour, an animated background, the player's own picture behind the pages ── */
  const FX = [
    { value: 'classic', label: 'Klasyczne', hint: 'iskry jak dotąd' },
    { value: 'aurora', label: 'Zorza', hint: 'powoli falujące światła' },
    { value: 'forge', label: 'Kuźnia', hint: 'żar i iskry z dołu' },
    { value: 'stars', label: 'Gwiazdy', hint: 'nocne niebo' },
  ];
  const ACCENT_VARS = { accent: '--accent', accent2: '--accent2', accent3: '--accent3', accentHi: '--accent-hi', ink: '--accent-ink', glow: '--glow' };
  const plusOn = () => Boolean(state.plus?.active);
  /** The animated background that is on right now – null for the classic one (always without Hammer+). */
  const fxNow = () => (plusOn() && FX.some((f) => f.value === state.settings.heroStyle && f.value !== 'classic') ? state.settings.heroStyle : null);
  /** The layer the animated backgrounds are drawn in (pure CSS). `style` fixes one for a preview; without it the layer follows the settings. */
  function fxLayer(style) {
    return h('div', { class: `fx${style ? ` ${style}` : ` live${fxNow() ? ` ${fxNow()}` : ''}`}`, 'aria-hidden': 'true' });
  }
  /**
   * Puts the look from the settings on the page. `previewColor` ("#rrggbb") shows a colour before it is saved
   * (while the player drags in the colour picker). Without Hammer+ everything falls back to the free look.
   */
  function applyTheme(previewColor) {
    const root = document.documentElement;
    const s = state.settings ?? {};
    const custom = plusOn() ? previewColor ?? (s.accent === 'custom' ? s.accentColor : null) : null;
    const colours = custom ? window.HS_THEME.palette(custom) : null;
    for (const name of Object.values(ACCENT_VARS)) root.style.removeProperty(name);
    if (colours) {
      root.dataset.accent = 'custom';
      for (const [key, name] of Object.entries(ACCENT_VARS)) root.style.setProperty(name, colours[key]);
    } else applyAccent(s.accent);
    const fx = fxNow();
    if (fx) root.dataset.fx = fx;
    else delete root.dataset.fx;
    for (const layer of document.querySelectorAll('.fx.live')) layer.className = `fx live${fx ? ` ${fx}` : ''}`;
    const backdrop = document.getElementById('backdrop');
    const picture = plusOn() ? state.backgroundUrl : null;
    if (backdrop) {
      backdrop.style.backgroundImage = picture ? `url("${picture}")` : '';
      backdrop.classList.toggle('on', Boolean(picture));
    }
  }

  /* ── tiny event bus + app state ── */
  const listeners = new Map();
  const bus = {
    on(evt, fn) {
      if (!listeners.has(evt)) listeners.set(evt, new Set());
      listeners.get(evt).add(fn);
      return () => listeners.get(evt)?.delete(fn);
    },
    emit(evt, data) {
      for (const fn of listeners.get(evt) ?? []) {
        try {
          fn(data);
        } catch (err) {
          console.error(err);
        }
      }
    },
  };

  const state = {
    info: null,
    settings: {},
    accounts: [],
    instances: [],
    running: new Map(), // instanceId → 'starting' | 'running'
    progress: new Map(), // instanceId → { stage, label, done, total, percent }
    logs: new Map(), // instanceId → [{ line, stream }]
    crashes: new Map(), // instanceId → crash analysis
    benchmarks: new Set(), // instances whose game runs as an FPS test right now
    benchResults: new Map(), // instanceId → how the last FPS test of this launcher run ended ('benchmark:done')
    playSummary: null, // „Podsumowanie gry” of the last session – shown on the start screen until dismissed
    updates: { checkedAt: null, total: 0, instances: [] }, // mod updates found by the background check: [{ id, name, count }]
    plus: null, // Hammer+: { active, until, account, reason, text, … } from the launcher
    feed: null, // Aktualności and the shop's message: { news, source, alert, release, ok, seenAt } – null until the launcher answered
    selfUpdate: null, // the launcher's own update: { status, current, latest, percent, notes, error, release, required, … }
    backgroundUrl: null, // the player's own launcher background (Hammer+)
    get account() {
      return this.accounts.find((a) => a.id === this.settings.selectedAccount) ?? this.accounts[0] ?? null;
    },
    get instance() {
      return this.instances.find((i) => i.id === this.settings.selectedInstance) ?? this.instances[0] ?? null;
    },
    async refreshInstances() {
      this.instances = await api.instances.list();
      bus.emit('instances', this.instances);
      return this.instances;
    },
    async refreshAccounts() {
      this.accounts = await api.accounts.list();
      this.settings = await api.settings.get();
      bus.emit('accounts', this.accounts);
      return this.accounts;
    },
    async setSettings(patch) {
      this.settings = await api.settings.set(patch);
      bus.emit('settings', this.settings);
      return this.settings;
    },
    async selectInstance(id) {
      await this.setSettings({ selectedInstance: id });
      bus.emit('instances', this.instances);
    },
  };

  /* ── „BETA” next to the launcher's name (launcher.config.json → channel: "beta") ── */
  const isBeta = () => state.info?.config?.channel === 'beta';
  /** The small mark that goes right after the name – nothing in a stable build. */
  function betaPill() {
    return isBeta() ? h('span.beta-pill', { title: 'Wersja beta' }, 'BETA') : null;
  }

  /* ── toasts ── */
  const TOAST_ICONS = { ok: 'check-circle', err: 'x-circle', warning: 'warning', info: 'info' };
  /** `action` ({ label, onClick }) adds one button to the message – an offer the player may take or let pass. */
  function toast(kind, text, ms = 4200, action = null) {
    const root = document.getElementById('toasts');
    const el = h(`div.toast.${kind}`, icon(TOAST_ICONS[kind] ?? 'info'), h('div', text, action ? h('button.btn.sm', { type: 'button', onclick: () => action.onClick() }, action.label) : null));
    root.append(el);
    while (root.children.length > 4) root.firstChild.remove();
    const close = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    };
    el.addEventListener('click', close);
    setTimeout(close, ms);
  }

  /** Puts text on the clipboard (through the launcher – it works without the window being asked for permission). */
  async function copyText(text, okText = 'Skopiowano do schowka.') {
    try {
      await api.clipboard.write(text);
      toast('ok', okText);
      return true;
    } catch {
      toast('err', 'Nie udało się skopiować do schowka.');
      return false;
    }
  }

  /**
   * A progress bar inside a dialog that follows one kind of long task (the `scope` of the launcher's
   * 'task:progress' events) – empty until the task says something. Returns { el, stop }.
   */
  function taskBar(scope) {
    const el = h('div.task-bar');
    const stop = api.on('task:progress', (p) => {
      if (p.scope !== scope || !el.isConnected) return;
      const pct = p.total > 0 ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
      clear(el, h('div.label', h('b.ellipsis', p.label ?? 'Pracuję…'), pct != null ? h('span', `${pct}%`) : null), h(`div.progress${pct == null ? '.indeterminate' : ''}`, h('i', { style: { '--w': `${pct ?? 0}%` } })));
    });
    return { el, stop };
  }

  /** Runs an async action and shows its error as a toast; returns undefined on failure. */
  async function attempt(fn, okText) {
    try {
      const res = await fn();
      if (okText) toast('ok', typeof okText === 'function' ? okText(res) : okText);
      return res;
    } catch (err) {
      toast('err', err?.message ?? String(err), 6500);
      return undefined;
    }
  }

  /** Disables a button and shows a spinner while the promise runs. */
  async function busy(btn, fn) {
    if (!btn) return fn();
    const old = [...btn.childNodes];
    btn.disabled = true;
    clear(btn, h('span.spinner'), old.filter((n) => n.nodeType === 3 || n.tagName === 'SPAN').map((n) => n.cloneNode(true)));
    try {
      return await fn();
    } finally {
      btn.disabled = false;
      clear(btn, old);
    }
  }

  /* ── modals ── */
  function modal({ title, icon: ic, body, foot, wide = false, onClose } = {}) {
    const root = document.getElementById('modal-root');
    let overlay;
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      onClose?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const box = h(
      `div.modal${wide ? '.wide' : ''}`,
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.modal-head', ic ? icon(ic) : null, h('h2', title), h('button.btn.ghost.sm.icon', { title: 'Zamknij', 'aria-label': 'Zamknij', onclick: close }, icon('close'))),
      h('div.modal-body.scroll', body),
      foot ? h('div.modal-foot', foot) : null,
    );
    overlay = h('div.overlay', { onmousedown: (e) => e.target === overlay && close() }, box);
    root.append(overlay);
    document.addEventListener('keydown', onKey);
    setTimeout(() => box.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea,.btn.primary')?.focus(), 30);
    return { close, box };
  }

  function confirmDialog({ title, text, confirm = 'Potwierdź', danger = false }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const m = modal({
        title,
        icon: danger ? 'warning' : 'info',
        body: h('p.muted', text),
        foot: [h('button.btn.ghost', { onclick: () => finish(false) }, 'Anuluj'), h(`button.btn${danger ? '.danger' : '.primary'}`, { onclick: () => finish(true) }, confirm)],
        onClose: () => finish(false),
      });
    });
  }

  /** A dropdown menu next to an element. items: [{ label, icon, hint, on, onClick, raw }] – raw: the label is a name, not the launcher's text. */
  function menu(anchor, items) {
    document.querySelector('.menu')?.remove();
    const r = anchor.getBoundingClientRect();
    const el = h(
      'div.menu',
      { role: 'menu' },
      items.map((it) => (it === '-' ? h('div.nav-sep') : h(`button${it.on ? '.on' : ''}`, { role: 'menuitem', onclick: () => (el.remove(), it.onClick()) }, it.node ?? (it.icon ? icon(it.icon) : null), it.raw ? raw(h('span.ellipsis', it.label)) : h('span.ellipsis', it.label), it.hint ? h('small', it.hint) : null))),
    );
    document.body.append(el);
    const w = Math.max(r.width, 240);
    el.style.minWidth = `${w}px`;
    const top = r.bottom + 6 + el.offsetHeight > innerHeight ? Math.max(8, r.top - el.offsetHeight - 6) : r.bottom + 6;
    el.style.top = `${top}px`;
    el.style.left = `${Math.min(r.left, innerWidth - w - 10)}px`;
    const off = (e) => {
      if (!el.contains(e.target)) {
        el.remove();
        document.removeEventListener('mousedown', off, true);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', off, true));
    return el;
  }

  /* ── form controls ── */
  function toggle(checked, onChange) {
    const input = h('input', { type: 'checkbox', checked: Boolean(checked), onchange: (e) => onChange(e.target.checked) });
    return h('label.switch', input, h('i'));
  }
  function select(options, value, onChange) {
    const el = h('select.select', { onchange: (e) => onChange(e.target.value) }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
    return el;
  }
  function seg(options, value, onChange) {
    const root = h('div.seg');
    const draw = (v) =>
      clear(
        root,
        options.map((o) =>
          h(
            `button${o.value === v ? '.on' : ''}`,
            {
              onclick: () => {
                draw(o.value);
                onChange(o.value);
              },
            },
            o.icon ? icon(o.icon) : null,
            o.label,
          ),
        ),
      );
    draw(value);
    return root;
  }
  function range(input) {
    const set = () => input.style.setProperty('--p', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
    input.addEventListener('input', set);
    set();
    return input;
  }
  function field(label, control, hint) {
    const single = control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement;
    return h(single ? 'label.field' : 'div.field', h('span', label), control, hint ? h('div.hint', hint) : null);
  }
  function empty(ic, title, text, action) {
    return h('div.empty', icon(ic), h('h3', title), text ? h('p', text) : null, action ?? null);
  }
  function chip(text, kind, ic) {
    return h(`span.chip${kind ? `.${kind}` : ''}`, ic ? icon(ic) : null, text);
  }
  const debounce = (fn, ms = 300) => {
    let t;
    return (...a) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...a), ms);
    };
  };
  const open = (url) => url && attempt(() => api.app.openExternal(url));

  /* ── community: Discord server + HammerShop store (fetched by the launcher, cached for a minute) ── */
  const communityCache = {};
  const once = (key, fn) => {
    const hit = communityCache[key];
    if (hit && Date.now() - hit.at < 60_000) return hit.promise;
    const promise = fn().catch(() => null);
    communityCache[key] = { at: Date.now(), promise };
    return promise;
  };
  const community = { discord: () => once('discord', () => api.community.discord()), shop: () => once('shop', () => api.community.shop({ limit: 4 })) };

  function money(value, currency) {
    try {
      return new Intl.NumberFormat(locale(), currency ? { style: 'currency', currency } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
    } catch {
      return `${dec(value.toFixed(2))}${currency ? ` ${currency}` : ''}`;
    }
  }

  /** The big "Dołącz do naszego Discorda" card. */
  function discordCard(d) {
    const initials = (d.name ?? 'D')
      .split(/\s+/)
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    return h(
      'section.card.discord-card',
      h('div.banner', d.bannerUrl ? h('img', { src: d.bannerUrl, alt: '' }) : null, icon('discord')),
      h(
        'div.body',
        h('div.guild', h('div.guild-icon', d.iconUrl ? h('img', { src: d.iconUrl, alt: '' }) : initials), h('div', { style: { minWidth: 0, paddingBottom: '2px' } }, h('small', 'Nasz Discord'), raw(h('b.ellipsis', d.name)))),
        d.live && (d.online != null || d.members != null)
          ? h(
              'div.counts',
              d.online != null ? h('span', h('i.dot.discord'), h('b', fmt.num(d.online)), 'online') : null,
              d.members != null ? h('span', h('i.dot.idle'), h('b', fmt.num(d.members)), fmt.plural(d.members, 'członek', 'członków', 'członków')) : null,
            )
          : d.invalid
            ? h('p.warn', { style: { fontSize: '12.5px', marginBottom: '12px' } }, 'Zaproszenie na Discorda chwilowo nie działa – zajrzyj tu za kilka minut.')
            : null,
        d.description ? raw(h('p.muted', { style: { fontSize: '12.5px', marginBottom: '12px' } }, d.description)) : null,
        h('div.perks', chip('Pomoc i tickety', null, 'heart'), chip('Giveawaye', null, 'star'), chip('Nowości i promocje', null, 'bolt')),
        d.invalid ? null : h('button.btn.discord', { onclick: () => open(d.url) }, icon('discord'), 'Dołącz do Discorda'),
      ),
    );
  }

  /** Slow, warm sparks rising in the hero. Light on CPU (≈30 fps, pauses when hidden) and off for reduced motion. */
  function embers(canvas) {
    if (!canvas?.getContext) return () => {};
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let w = 0;
    let hgt = 0;
    let raf = 0;
    let last = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      w = canvas.clientWidth;
      hgt = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const spawn = (anywhere) => ({ x: Math.random() * w, y: anywhere ? Math.random() * hgt : hgt + 10, r: 0.6 + Math.random() * 1.8, vy: 0.15 + Math.random() * 0.45, vx: -0.15 + Math.random() * 0.3, a: 0.25 + Math.random() * 0.6, t: Math.random() * 6.28 });
    resize();
    const parts = Array.from({ length: reduced ? 14 : 42 }, () => spawn(true));
    const draw = () => {
      ctx.clearRect(0, 0, w, hgt);
      // The sparks are warm by default and take the launcher's colour when another one is chosen.
      const tint = document.documentElement.dataset.accent ? getComputedStyle(document.documentElement).getPropertyValue('--glow').trim() : '';
      for (const p of parts) {
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        glow.addColorStop(0, `rgba(${tint || '255,190,120'},${p.a})`);
        glow.addColorStop(1, `rgba(${tint || '255,140,40'},0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, 6.283);
        ctx.fill();
      }
    };
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (now - last < 33 || document.hidden) return;
      last = now;
      for (const p of parts) {
        p.t += 0.03;
        p.y -= p.vy;
        p.x += p.vx + Math.sin(p.t) * 0.2;
        p.a -= 0.0012;
        if (p.y < -10 || p.a <= 0.05) Object.assign(p, spawn(false));
      }
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    if (reduced) draw();
    else raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }

  /* ── Hammer Client: the Minecraft versions the bundled mod has a jar for (oldest → newest) ── */
  const hammerClientVersions = () => state.info?.hammerClient?.versions ?? [];
  /** The mod can run in this game version + loader (Fabric or Quilt). */
  const hammerClientFits = (mcVersion, loader) => ['fabric', 'quilt'].includes(loader) && hammerClientVersions().includes(mcVersion);
  /** Hammer Client (in-game menu and HUD) runs in this instance. */
  const hammerClientOn = (i) => Boolean(i && i.hammerClient !== false && hammerClientFits(i.mcVersion, i.loader));
  /** "Minecraft 1.21 – 26.3" – from the list, never hard-coded. Nothing when the launcher has no mod bundled. */
  function hammerClientRange() {
    const list = hammerClientVersions();
    if (!list.length) return null;
    return list.length === 1 ? `Minecraft ${list[0]}` : `Minecraft ${list[0]} – ${list[list.length - 1]}`;
  }

  /** The "Instancja" switcher used at the top of Mody / Optymalizacja / Konsola. */
  function instancePicker() {
    const el = h('button.instance-pick.compact', {
      title: 'Zmień instancję',
      onclick: () =>
        menu(
          el,
          state.instances.map((i) => ({ node: tile(i, 26), label: i.name, raw: true, hint: state.running.has(i.id) ? 'w grze' : `${i.mcVersion} ${i.loader !== 'vanilla' ? LOADERS[i.loader]?.name : ''}`, on: i.id === state.instance?.id, onClick: () => state.selectInstance(i.id) })),
        ),
    });
    const draw = () => {
      const i = state.instance;
      clear(el, i ? tile(i, 34) : null, h('div', i ? raw(h('b', i.name)) : h('b', 'Brak instancji'), h('small', i ? `Minecraft ${i.mcVersion}${i.loader !== 'vanilla' ? ` · ${LOADERS[i.loader]?.name}` : ''}` : '—')), icon('chevron-down'));
    };
    draw();
    return { el, draw };
  }

  window.HS = { views: {}, api, t: i18n.t, locale, h, append, clear, raw, icon, fmt, LOADERS, TILES, tile, head, bus, state, toast, copyText, taskBar, attempt, busy, modal, confirmDialog, menu, toggle, select, seg, range, field, empty, chip, debounce, open, instancePicker, community, money, discordCard, embers, hammerClientOn, hammerClientFits, hammerClientRange, hammerClientVersions, skinView, capeView, paintSkin, looksSlim, ACCENTS, applyAccent, FX, plusOn, fxLayer, applyTheme, isBeta, betaPill };
})();
