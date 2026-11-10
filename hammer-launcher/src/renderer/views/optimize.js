'use strict';
/* Optymalizacja – one-click tuning: RAM, Java flags, performance mods, graphics presets, process priority. */

(() => {
  const { api, h, clear, icon, fmt, LOADERS, tile, bus, state, attempt } = HS;

  const JVM = [
    { value: 'recommended', icon: 'gauge', title: 'Zalecane (G1GC)', text: 'Dostrojony garbage collector – płynna gra bez przycięć. Najlepszy wybór dla większości.', tag: 'Zalecane' },
    { value: 'zgc', icon: 'bolt', title: 'ZGC', text: 'Prawie zerowe przycięcia przy dużych paczkach modów. Dla mocnych PC (16 GB+, 6+ rdzeni).' },
    { value: 'vanilla', icon: 'cube', title: 'Domyślne Mojang', text: 'Ustawienia jak w oficjalnym launcherze. Do porównań.' },
    { value: 'custom', icon: 'terminal', title: 'Własne', text: 'Twoje argumenty z ustawień instancji – dla zaawansowanych.' },
  ];
  const GFX = [
    { value: 'fps', icon: 'bolt', title: 'Maks. FPS', text: 'Szybka grafika, render 8 chunków, bez cieni i chmur. Dla słabszych komputerów i PvP.' },
    { value: 'balanced', icon: 'sliders', title: 'Zrównoważony', text: 'Ładna grafika i wysoki FPS. Render 12 chunków, szybkie chmury.' },
    { value: 'quality', icon: 'sparkles', title: 'Jakość', text: 'Pełne efekty i daleki render. Dla mocnych kart graficznych.' },
  ];
  const PRIORITY = [
    { value: 'normal', label: 'Normalny' },
    { value: 'above_normal', label: 'Powyżej normalnego (zalecany)' },
    { value: 'high', label: 'Wysoki' },
  ];

  /** "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 3060". */
  function gpuName(raw) {
    if (!raw) return null;
    let s = String(raw);
    const angle = /^ANGLE \((.*)\)$/.exec(s);
    if (angle) s = angle[1].split(', ')[1] ?? angle[1];
    return s.replace(/\(R\)|\(TM\)|\(0x[0-9a-f]+\)/gi, '').replace(/\s*(Direct3D|vs_|OpenGL|Vulkan).*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 48) || null;
  }

  function render(root) {
    const i0 = state.instance;
    if (!i0) {
      clear(root, h('div.page', h('div.page-head', h('div', h('h1', 'Optymalizacja'))), h('div.card', HS.empty('cube', 'Brak instancji', 'Utwórz instancję, aby ją zoptymalizować.', h('button.btn.primary', { onclick: () => HS.editInstance() }, icon('plus'), 'Nowa instancja')))));
      return () => {};
    }
    const sysBox = h('div.sys', [1, 2, 3, 4].map(() => h('div.skeleton', { style: { height: '70px' } })));
    const autoCard = h('section.card');
    const ramCard = h('section.card');
    const jvmCard = h('section.card');
    const modsCard = h('section.card');
    const gfxCard = h('section.card');
    const sysCard = h('section.card');
    let info = null;
    let gfx = null;

    const inst = () => state.instance;

    async function load() {
      try {
        info = await api.optimizer.info(inst().id);
      } catch (err) {
        HS.toast('err', err.message);
        return;
      }
      gfx = info.recommendation.optionsPreset;
      const s = info.system;
      clear(
        sysBox,
        sysTile('memory', fmt.gb(s.totalMem, 0), `RAM · wolne ${fmt.gb(s.freeMem)}`),
        sysTile('cpu', `${s.cpuCores} ${fmt.plural(s.cpuCores, 'wątek', 'wątki', 'wątków')}`, s.cpuModel),
        sysTile('monitor', gpuName(s.gpu) ?? 'Karta graficzna', s.gpu ? 'Karta graficzna' : 'nie rozpoznano'),
        sysTile('puzzle', fmt.count(info.modCount, 'mod', 'mody', 'modów'), `w „${inst().name}”`),
      );
      drawAuto();
      drawRam();
      drawJvm();
      drawGfx();
      drawSys();
      drawMods();
    }
    const sysTile = (ic, value, sub) => h('div.card', icon(ic), h('div', { style: { minWidth: 0 } }, h('b.ellipsis', { title: value }, value), h('small.ellipsis', { style: { display: 'block' }, title: sub }, sub)));

    function drawAuto() {
      const i = inst();
      const r = info.recommendation;
      const btn = h('button.btn.primary', { style: { height: '46px', padding: '0 22px', fontSize: '14px' } }, icon('magic'), 'Optymalizuj automatycznie');
      btn.onclick = () =>
        HS.busy(btn, async () => {
          const res = await attempt(() => api.optimizer.apply(i.id, { mods: i.loader !== 'vanilla', optionsPreset: r.optionsPreset, memoryMb: null, jvmPreset: r.jvmPreset }));
          if (!res) return;
          await state.refreshInstances();
          const n = res.installed?.length ?? 0;
          HS.toast('ok', i.loader === 'vanilla' ? 'Gotowe! Dobrano RAM, flagi Javy i grafikę.' : `Gotowe! ${n ? `Dodano ${fmt.count(n, 'mod', 'mody', 'modów')} wydajnościowe, ` : ''}dobrano RAM, flagi Javy i grafikę.`, 6000);
          for (const m of res.missing ?? []) HS.toast('info', `${m} – brak wersji dla ${i.mcVersion}, pominięto.`);
          load();
        });
      clear(
        autoCard,
        h(
          'div.row',
          { style: { gap: '18px', alignItems: 'center' } },
          h('div', { style: { width: '58px', height: '58px', borderRadius: '16px', display: 'grid', placeItems: 'center', background: 'linear-gradient(160deg,var(--accent2),var(--accent3))', color: 'var(--accent-ink)', fontSize: '26px', boxShadow: '0 10px 30px rgba(var(--glow),.35)', flex: 'none' } }, icon('rocket')),
          h(
            'div.grow',
            h('h2', 'Jedno kliknięcie – więcej FPS'),
            h('p.muted', { style: { marginTop: '2px' } }, `Dla Twojego komputera: ${fmt.mb(r.memoryMb)} RAM, flagi „${JVM.find((j) => j.value === r.jvmPreset)?.title}”, grafika „${GFX.find((g) => g.value === r.optionsPreset)?.title}”${i.loader !== 'vanilla' ? ' i pakiet modów wydajnościowych' : ''}.`),
          ),
          btn,
        ),
      );
    }

    function drawRam() {
      const i = inst();
      const total = info.system.totalMem / 1024 ** 2;
      const max = Math.max(2048, Math.min(32768, Math.floor((total * 0.8) / 512) * 512));
      const rec = info.recommendation.memoryMb;
      const auto = i.memoryMb == null;
      const value = h('div.value');
      const input = HS.range(h('input', { type: 'range', min: 1024, max, step: 512, value: i.memoryMb ?? rec }));
      const warn = h('div.hint');
      const upd = () => {
        const v = Number(input.value);
        input.style.setProperty('--p', `${((v - 1024) / (max - 1024)) * 100}%`);
        value.textContent = fmt.mb(v);
        warn.className = 'hint';
        if (v > total * 0.6) (warn.className = 'hint warn'), (warn.textContent = 'Za dużo – system i przeglądarka też potrzebują pamięci. Gra może się przycinać.');
        else if (v > 12288) (warn.className = 'hint warn'), (warn.textContent = 'Powyżej 12 GB Java dłużej sprząta pamięć – zwykle nie pomaga.');
        else if (v < rec - 1024) (warn.className = 'hint warn'), (warn.textContent = 'Mało pamięci dla tej instancji – możliwe zacięcia lub błąd „OutOfMemory”.');
        else warn.textContent = `Zalecane dla tej instancji: ${fmt.mb(rec)}.`;
      };
      const save = HS.debounce(() => attempt(() => api.instances.update(i.id, { memoryMb: Number(input.value) })).then(() => state.refreshInstances()), 400);
      input.addEventListener('input', () => {
        upd();
        if (autoToggle.querySelector('input').checked) autoToggle.querySelector('input').click();
        else save();
      });
      const autoToggle = HS.toggle(auto, async (v) => {
        await attempt(() => api.instances.update(i.id, { memoryMb: v ? null : Number(input.value) }));
        if (v) {
          input.value = rec;
          upd();
        }
        await state.refreshInstances();
      });
      const marks = [1024, Math.round(max / 2 / 1024) * 1024, max].map((v) => h('span', { style: { left: `${((v - 1024) / (max - 1024)) * 100}%` } }, fmt.mb(v)));
      clear(
        ramCard,
        h('div.card-head', icon('memory'), h('h2.grow', 'Pamięć RAM'), h('span.dim', { style: { fontSize: '12px' } }, 'automatycznie'), autoToggle),
        h('div.ram', h('div.grow', input, h('div.ram-scale', marks)), value),
        warn,
      );
      upd();
    }

    function presetGrid(list, current, onPick, cols = 2) {
      return h(
        `div.grid.g${cols}`,
        { style: { gap: '10px' } },
        list.map((p) => h(`button.preset${p.value === current ? '.on' : ''}`, { onclick: () => onPick(p.value) }, h('b', icon(p.icon), p.title, p.tag ? HS.chip(p.tag, 'accent') : null), h('small', p.text))),
      );
    }

    function drawJvm() {
      const i = inst();
      const current = i.jvmPreset ?? state.settings.jvmPreset ?? 'recommended';
      clear(
        jvmCard,
        h('div.card-head', icon('java'), h('h2', 'Flagi Javy')),
        presetGrid(JVM, current, async (v) => {
          await attempt(() => api.instances.update(i.id, { jvmPreset: v }));
          await state.refreshInstances();
          drawJvm();
        }),
        h('p.hint', { style: { marginTop: '10px' } }, 'Launcher sam pobiera właściwą Javę (8, 17, 21…) dla każdej wersji gry – nic nie musisz instalować.'),
      );
    }

    function drawGfx() {
      const i = inst();
      const btn = h('button.btn', {}, icon('check'), 'Zastosuj ustawienia grafiki');
      btn.onclick = () =>
        HS.busy(btn, async () => {
          if (state.running.get(i.id) === 'running') HS.toast('warning', 'Zmiany zobaczysz po ponownym uruchomieniu gry.');
          await attempt(() => api.optimizer.apply(i.id, { mods: false, optionsPreset: gfx }), `Ustawiono grafikę „${GFX.find((g) => g.value === gfx)?.title}”.`);
        });
      clear(
        gfxCard,
        h('div.card-head', icon('palette'), h('h2.grow', 'Ustawienia grafiki'), btn),
        presetGrid(GFX, gfx, (v) => ((gfx = v), drawGfx()), 3),
        h('p.hint', { style: { marginTop: '10px' } }, 'Zmienia options.txt instancji (odległość renderowania, cienie, cząsteczki, VSync…). Pozostałe ustawienia zostają.'),
      );
    }

    function drawSys() {
      const s = state.settings;
      const win = state.info?.platform === 'win32';
      clear(
        sysCard,
        h('div.card-head', icon('gauge'), h('h2', 'System')),
        h(
          'div.settings',
          setRow('Priorytet procesu gry', 'Windows daje grze więcej czasu procesora niż programom w tle.', HS.select(PRIORITY, s.processPriority, (v) => state.setSettings({ processPriority: v }))),
          win ? setRow('Wydajna karta graficzna', 'Na laptopach wymusza kartę dedykowaną (NVIDIA/AMD) zamiast zintegrowanej.', HS.toggle(s.gpuPreference, (v) => state.setSettings({ gpuPreference: v }))) : null,
          setRow('Po uruchomieniu gry', 'Ukryty launcher nie zabiera pamięci ani procesora.', HS.select([{ value: 'hide', label: 'Ukryj do zasobnika' }, { value: 'minimize', label: 'Zminimalizuj' }, { value: 'keep', label: 'Zostaw otwarty' }], s.afterLaunch, (v) => state.setSettings({ afterLaunch: v }))),
        ),
      );
    }
    const setRow = (title, text, ctl) => h('div.set-row', h('div.txt', h('b', title), h('small', text)), h('div.ctl', ctl));

    let shaders = false;
    async function drawMods() {
      const i = inst();
      const head = h('div.card-head', icon('bolt'), h('h2.grow', 'Mody wydajnościowe'));
      if (i.loader === 'vanilla') {
        return clear(modsCard, head, HS.empty('puzzle', 'Instancja bez loadera', 'Mody wydajnościowe (Sodium, Lithium…) działają z Fabric, Quilt, Forge i NeoForge. Zmień loader, aby je dodać – zwykle to +100% FPS.', h('button.btn.primary', { onclick: () => HS.editInstance(i) }, icon('pen'), 'Zmień loader')));
      }
      const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, [1, 2, 3, 4].map(() => h('div.skeleton', { style: { height: '50px' } })));
      const btn = h('button.btn.primary', { disabled: true }, icon('download'), 'Zainstaluj');
      const shaderToggle = h('label.row', { style: { gap: '8px', fontSize: '12.5px', color: 'var(--muted)', cursor: 'pointer', whiteSpace: 'nowrap', flex: 'none' } }, h('input', { type: 'checkbox', checked: shaders, onchange: (e) => ((shaders = e.target.checked), drawMods()) }), 'z shaderami (Iris)');
      head.append(btn);
      clear(modsCard, head, h('div.row', { style: { margin: '-6px 0 12px', justifyContent: 'space-between' } }, h('span.hint', 'Sprawdzone mody, które nie zmieniają rozgrywki.'), shaderToggle), list);
      let plan;
      try {
        plan = await api.optimizer.plan(i.id, { shaders });
      } catch (err) {
        return clear(list, HS.empty('warning', 'Brak połączenia z Modrinth', err.message, h('button.btn', { onclick: drawMods }, icon('refresh'), 'Spróbuj ponownie')));
      }
      const missing = plan.mods.filter((m) => m.available && !m.installed);
      btn.disabled = !missing.length;
      btn.lastChild.textContent = missing.length ? `Zainstaluj (${missing.length})` : 'Komplet';
      btn.onclick = () =>
        HS.busy(btn, async () => {
          const res = await attempt(() => api.optimizer.apply(i.id, { mods: true, shaders }));
          if (!res) return;
          HS.toast('ok', `Zainstalowano: ${res.installed.join(', ') || 'nic nowego'}.`);
          await state.refreshInstances();
          drawMods();
        });
      clear(
        list,
        plan.mods.map((m) =>
          h(
            `div.mod-check${m.available ? '' : '.na'}`,
            h('span', { style: { color: m.installed ? 'var(--ok)' : 'var(--accent)', display: 'grid', fontSize: '18px' } }, icon(m.installed ? 'check-circle' : m.available ? 'download' : 'x-circle')),
            h('div.grow', h('b', m.name), h('small', m.why)),
            h('span.state', m.installed ? HS.chip('Zainstalowany', 'ok') : m.available ? HS.chip(m.version?.number ? `Dostępny · ${m.version.number}`.slice(0, 32) : 'Dostępny', 'accent') : HS.chip(`Brak dla ${i.mcVersion}`)),
          ),
        ),
      );
    }

    const picker = HS.instancePicker();
    const instBtn = picker.el;
    const drawInstBtn = picker.draw;

    clear(
      root,
      h(
        'div.page',
        h('div.page-head', h('div', h('h1', 'Optymalizacja'), h('p', 'Więcej FPS i mniej lagów – dobrane pod Twój komputer i tę instancję.')), h('div.actions', instBtn)),
        sysBox,
        h('div', { style: { height: '14px' } }),
        autoCard,
        h('div.grid.g2', { style: { marginTop: '14px', alignItems: 'start' } }, h('div.grid', ramCard, jvmCard, sysCard), h('div.grid', modsCard, gfxCard)),
      ),
    );
    load();
    let lastId = inst().id;
    const off = bus.on('settings', () => {
      if (inst()?.id !== lastId) {
        lastId = inst().id;
        drawInstBtn();
        load();
      }
    });
    return off;
  }

  HS.views.optimize = { title: 'Optymalizacja', icon: 'gauge', render };
})();
