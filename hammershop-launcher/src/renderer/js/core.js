'use strict';
/* HammerShop Launcher – shared UI helpers: DOM builder, icons, state, toasts, modals, formatting. */

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

  /* ── formatting (Polish) ── */
  const nf = new Intl.NumberFormat('pl-PL');
  const fmt = {
    num: (n) => nf.format(n ?? 0),
    compact: (n) => new Intl.NumberFormat('pl-PL', { notation: 'compact', maximumFractionDigits: 1 }).format(n ?? 0),
    gb: (bytes, d = 1) => `${(bytes / 1024 ** 3).toFixed(d).replace('.', ',')} GB`,
    mb: (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0).replace('.', ',')} GB` : `${mb} MB`),
    size: (b) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`),
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
      return new Date(ts).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' });
    },
    date: (ts) => new Date(ts).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' }),
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

  /* ── toasts ── */
  const TOAST_ICONS = { ok: 'check-circle', err: 'x-circle', warning: 'warning', info: 'info' };
  function toast(kind, text, ms = 4200) {
    const root = document.getElementById('toasts');
    const el = h(`div.toast.${kind}`, icon(TOAST_ICONS[kind] ?? 'info'), h('div', text));
    root.append(el);
    while (root.children.length > 4) root.firstChild.remove();
    const close = () => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    };
    el.addEventListener('click', close);
    setTimeout(close, ms);
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
    setTimeout(() => box.querySelector('input,select,textarea,.btn.primary')?.focus(), 30);
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

  /** A dropdown menu next to an element. items: [{ label, icon, hint, on, onClick }] */
  function menu(anchor, items) {
    document.querySelector('.menu')?.remove();
    const r = anchor.getBoundingClientRect();
    const el = h(
      'div.menu',
      { role: 'menu' },
      items.map((it) => (it === '-' ? h('div.nav-sep') : h(`button${it.on ? '.on' : ''}`, { role: 'menuitem', onclick: () => (el.remove(), it.onClick()) }, it.node ?? (it.icon ? icon(it.icon) : null), h('span.ellipsis', it.label), it.hint ? h('small', it.hint) : null))),
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

  /** The "Instancja" switcher used at the top of Mody / Optymalizacja / Konsola. */
  function instancePicker() {
    const el = h('button.instance-pick.compact', {
      title: 'Zmień instancję',
      onclick: () =>
        menu(
          el,
          state.instances.map((i) => ({ node: tile(i, 26), label: i.name, hint: state.running.has(i.id) ? 'w grze' : `${i.mcVersion} ${i.loader !== 'vanilla' ? LOADERS[i.loader]?.name : ''}`, on: i.id === state.instance?.id, onClick: () => state.selectInstance(i.id) })),
        ),
    });
    const draw = () => {
      const i = state.instance;
      clear(el, i ? tile(i, 34) : null, h('div', h('b', i?.name ?? 'Brak instancji'), h('small', i ? `Minecraft ${i.mcVersion}${i.loader !== 'vanilla' ? ` · ${LOADERS[i.loader]?.name}` : ''}` : '—')), icon('chevron-down'));
    };
    draw();
    return { el, draw };
  }

  window.HS = { views: {}, api, h, append, clear, icon, fmt, LOADERS, TILES, tile, head, bus, state, toast, attempt, busy, modal, confirmDialog, menu, toggle, select, seg, range, field, empty, chip, debounce, open, instancePicker };
})();
