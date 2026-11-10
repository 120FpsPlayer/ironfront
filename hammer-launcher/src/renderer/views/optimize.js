'use strict';
/* Optymalizacja – one-click tuning: RAM, Java flags, performance mods (Podstawowe / Turbo), graphics presets, process priority. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  // Each preset in one plain sentence.
  const JVM = [
    { value: 'recommended', icon: 'gauge', title: 'Zalecane (G1GC)', text: 'Dostrojone sprzątanie pamięci – krótkie przerwy, czyli gra bez przycięć. Najlepszy wybór dla większości.' },
    { value: 'zgc', icon: 'bolt', title: 'ZGC', text: 'Sprząta pamięć w tle, prawie bez przerw – dla mocnych PC (16 GB+, 6+ wątków) i dużych paczek modów.' },
    { value: 'vanilla', icon: 'cube', title: 'Domyślne Mojang', text: 'Tylko ustawienie pamięci, jak w oficjalnym launcherze – do porównań.' },
    { value: 'custom', icon: 'terminal', title: 'Własne', text: 'Twoje argumenty z ustawień instancji – dla zaawansowanych.' },
  ];
  const GFX = [
    { value: 'low', icon: 'heartbeat', title: 'Słaby komputer', text: 'Najlżejsze ustawienia: render 6 chunków, bez cieni, chmur i wygładzania. Dla starych laptopów.' },
    { value: 'fps', icon: 'bolt', title: 'Maks. FPS', text: 'Szybka grafika, render 8 chunków, bez cieni i chmur. Dla słabszych komputerów i PvP.' },
    { value: 'balanced', icon: 'sliders', title: 'Zrównoważony', text: 'Ładna grafika i wysoki FPS. Render 12 chunków, szybkie chmury.' },
    { value: 'quality', icon: 'sparkles', title: 'Jakość', text: 'Pełne efekty i daleki render (16 chunków). Dla mocnych kart graficznych.' },
  ];
  const PRIORITY = [
    { value: 'normal', label: 'Normalny' },
    { value: 'above_normal', label: 'Podwyższony (zalecany)' },
    { value: 'high', label: 'Wysoki' },
  ];
  const TIERS = [
    { key: 'core', title: 'Podstawowe', text: 'Sprawdzone i bezpieczne – nie zmieniają rozgrywki.' },
    { key: 'turbo', title: 'Turbo', text: 'Dodatki dla mocnych procesorów. Część to wersje testowe – wyłącz je, jeśli coś działa dziwnie.' },
    { key: 'shaders', title: 'Shadery', text: 'Ładniejsza grafika kosztem FPS.' },
  ];
  const jvmTitle = (v) => JVM.find((j) => j.value === v)?.title ?? v;
  const gfxTitle = (v) => GFX.find((g) => g.value === v)?.title ?? v;
  const priorityLabel = (v) => ({ normal: 'normalny', above_normal: 'podwyższony', high: 'wysoki' })[v] ?? v;

  /** "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)" → "NVIDIA GeForce RTX 3060". */
  function gpuName(raw) {
    if (!raw) return null;
    let s = String(raw);
    const angle = /^ANGLE \((.*)\)$/.exec(s);
    if (angle) s = angle[1].split(', ')[1] ?? angle[1];
    return s.replace(/\(R\)|\(TM\)|\(0x[0-9a-f]+\)/gi, '').replace(/\s*(Direct3D|vs_|OpenGL|Vulkan).*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 48) || null;
  }

  /** "Dlaczego?" – the recommendation explained, one point per setting. */
  function whyDialog(info) {
    const m = HS.modal({
      title: 'Dlaczego takie ustawienia?',
      icon: 'info',
      body: h(
        'div.why',
        h('p.muted', 'Launcher sprawdził Twój komputer i tę instancję. Oto, co proponuje i z jakiego powodu:'),
        info.recommendation.reasons.map((r) => h('div.why-item', h('span.why-icon', icon({ memory: 'memory', jvm: 'java', options: 'palette', mods: 'bolt' }[r.key] ?? 'check')), h('div', h('b', r.title), h('p', r.text)))),
      ),
      foot: [h('button.btn.primary', { onclick: () => m.close() }, 'Rozumiem')],
    });
  }

  /** The window after "Zoptymalizuj wszystko": what exactly was done. */
  function summaryDialog(instance, res) {
    const s = res.summary ?? {};
    const line = (ic, title, text) => h('div.why-item', h('span.why-icon.ok', icon(ic)), h('div', h('b', title), text ? h('p', text) : null));
    const mods = s.mods;
    const added = mods?.installed?.length ?? 0;
    const m = HS.modal({
      title: 'Gotowe – instancja zoptymalizowana',
      icon: 'check-circle',
      body: h(
        'div.why',
        h('p.muted', `Oto, co launcher zrobił dla „${instance.name}”:`),
        mods
          ? line(
              'bolt',
              added ? `Mody wydajnościowe: dodano ${added}${s.turbo ? ' (z dodatkami Turbo)' : ''}` : 'Mody wydajnościowe: komplet',
              [added ? `${mods.installed.join(', ')}.` : 'Wszystkie pasujące mody były już zainstalowane.', mods.missing?.length ? ` Jeszcze niedostępne dla Minecrafta ${instance.mcVersion}: ${mods.missing.join(', ')}.` : ''].join(''),
            )
          : null,
        line('memory', `Pamięć RAM: ${fmt.mb(s.memoryMb)}`, s.memoryAuto ? 'Dobierana automatycznie do komputera i liczby modów przy każdym starcie.' : 'Ustawiona ręcznie – launcher jej nie zmienia.'),
        line('java', `Flagi Javy: ${jvmTitle(s.jvmPreset)}`, `Dobrane do Javy ${s.javaMajor}, na której działa ta instancja.`),
        s.optionsPreset ? line('palette', `Grafika: ${s.optionsPreset.label}`, 'Zapisana w ustawieniach gry tej instancji – klawisze i reszta ustawień zostały bez zmian.') : null,
        line('gauge', `Priorytet gry: ${priorityLabel(s.priority)}`, 'System daje grze pierwszeństwo przed programami w tle.'),
        (res.warnings ?? []).map((w) => h('div.why-item', h('span.why-icon.warn', icon('warning')), h('div', h('p', w)))),
        h('p.hint', { style: { marginTop: '4px' } }, state.running.has(instance.id) ? 'Gra jest teraz włączona – zmiany zobaczysz po jej ponownym uruchomieniu.' : 'Zmiany zadziałają przy następnym uruchomieniu gry.'),
      ),
      foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Zamknij'), h('button.btn.primary', { disabled: state.running.has(instance.id), onclick: () => (m.close(), HS.play(instance.id)) }, icon('play'), 'Graj')],
    });
  }

  /** The exact arguments a preset starts the game with. */
  function flagsDialog(info, preset) {
    const flags = info.jvm.flags[preset] ?? [];
    const text = [`-Xmx${info.jvm.memoryMb}M`, ...flags].join(' ');
    const m = HS.modal({
      title: `Flagi: ${jvmTitle(preset)}`,
      icon: 'java',
      wide: true,
      body: h(
        'div',
        h('p.muted', { style: { marginBottom: '12px' } }, `Z takimi argumentami launcher uruchomi tę instancję na Javie ${info.java.major}. Nieznane flagi nigdy nie zatrzymają gry – Java je po prostu pominie.`),
        h('div.flags', h('code', `-Xmx${info.jvm.memoryMb}M`), flags.map((f) => h('code', f))),
      ),
      foot: [
        h('button.btn', { onclick: () => navigator.clipboard?.writeText(text).then(() => HS.toast('ok', 'Skopiowano flagi do schowka.'), () => HS.toast('err', 'Nie udało się skopiować.')) }, icon('copy'), 'Kopiuj'),
        h('button.btn.primary', { onclick: () => m.close() }, 'Zamknij'),
      ],
    });
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
    let turbo = false;
    let shaders = false;

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
      const modded = i.loader !== 'vanilla';
      const btn = h('button.btn.primary.big', {}, icon('magic'), 'Zoptymalizuj wszystko');
      btn.onclick = () =>
        HS.busy(btn, async () => {
          const res = await attempt(() => api.optimizer.apply(i.id, { mods: modded, turbo, shaders, optionsPreset: r.optionsPreset, memoryMb: null, jvmPreset: r.jvmPreset }));
          if (!res) return;
          await state.refreshInstances();
          await load();
          summaryDialog(inst(), res);
        });
      clear(
        autoCard,
        h(
          'div.auto',
          h('div.auto-icon', icon('rocket')),
          h(
            'div.grow',
            h('h2', 'Jedno kliknięcie – więcej FPS'),
            h('p.muted', { style: { marginTop: '2px' } }, `Dla Twojego komputera: ${fmt.mb(r.memoryMb)} RAM, flagi „${jvmTitle(r.jvmPreset)}”, grafika „${gfxTitle(r.optionsPreset)}”${modded ? ` i mody wydajnościowe${turbo ? ' z dodatkami Turbo' : ''}` : ''}.`),
          ),
          h('button.btn.ghost', { onclick: () => whyDialog(info) }, icon('info'), 'Dlaczego?'),
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
        list.map((p) => h(`button.preset${p.value === current ? '.on' : ''}${p.off ? '.off' : ''}`, { onclick: () => onPick(p.value) }, h('b', icon(p.icon), p.title, p.tag ? HS.chip(p.tag, p.off ? 'warn' : 'accent') : null), h('small', p.text))),
      );
    }

    function drawJvm() {
      const i = inst();
      const current = i.jvmPreset ?? state.settings.jvmPreset ?? 'recommended';
      const java = info.java;
      const rec = info.recommendation.jvmPreset;
      // ZGC without generational mode (before Java 21) would stutter – there the launcher starts the tuned G1 instead.
      const list = JVM.map((p) => {
        if (p.value === 'zgc' && !java.zgc) return { ...p, off: true, tag: `Wymaga Javy 21`, text: `Dostępne od Minecrafta 1.20.5. W tej instancji (Java ${java.major}) launcher użyje flag zalecanych.` };
        return { ...p, tag: p.value === rec ? 'Zalecane' : null };
      });
      const shown = current === 'custom' ? null : current;
      clear(
        jvmCard,
        h('div.card-head', icon('java'), h('h2.grow', 'Flagi Javy'), HS.chip(`Java ${java.major}`, 'accent'), shown ? h('button.btn.sm', { onclick: () => flagsDialog(info, shown === 'zgc' && !java.zgc ? 'recommended' : shown) }, icon('list'), 'Pokaż flagi') : null),
        presetGrid(list, current, async (v) => {
          await attempt(() => api.instances.update(i.id, { jvmPreset: v }));
          await state.refreshInstances();
          drawJvm();
        }),
        h(
          'p.hint',
          { style: { marginTop: '10px' } },
          java.own
            ? `Ta instancja używa własnej Javy ${java.major} – flagi są dobrane właśnie do niej.`
            : `Ta instancja ${java.known ? 'działa' : 'będzie działać'} na Javie ${java.major} – launcher sam ją pobiera i dobiera do niej flagi${java.major >= 25 ? ' (w Javie 25 także mniejsze obiekty w pamięci)' : ''}.`,
        ),
      );
    }

    function drawGfx() {
      const i = inst();
      const rec = info.recommendation.optionsPreset;
      const btn = h('button.btn', {}, icon('check'), 'Zastosuj');
      btn.onclick = () =>
        HS.busy(btn, async () => {
          if (state.running.get(i.id) === 'running') HS.toast('warning', 'Zmiany zobaczysz po ponownym uruchomieniu gry.');
          await attempt(() => api.optimizer.apply(i.id, { mods: false, optionsPreset: gfx }), `Ustawiono grafikę „${gfxTitle(gfx)}”.`);
        });
      clear(
        gfxCard,
        h('div.card-head', icon('palette'), h('h2.grow', 'Ustawienia grafiki'), btn),
        presetGrid(GFX.map((p) => ({ ...p, tag: p.value === rec ? 'Zalecane' : null })), gfx, (v) => ((gfx = v), drawGfx())),
        h('p.hint', { style: { marginTop: '10px' } }, 'Zmienia ustawienia gry tej instancji (odległość renderowania, cienie, cząsteczki, VSync…). Klawisze i reszta zostają.'),
      );
    }

    function drawSys() {
      const i = inst();
      const s = state.settings;
      const win = state.info?.platform === 'win32';
      clear(
        sysCard,
        h('div.card-head', icon('gauge'), h('h2', 'System')),
        h(
          'div.settings',
          setRow('Wysoki priorytet gry', 'System daje grze więcej czasu procesora niż programom w tle. Dla wszystkich instancji.', HS.select(PRIORITY, s.processPriority, (v) => state.setSettings({ processPriority: v }))),
          setRow(
            'Priorytet tej instancji',
            `Możesz ustawić inny tylko dla „${i.name}”.`,
            HS.select([{ value: '', label: 'Jak wyżej' }, ...PRIORITY.map((p) => ({ value: p.value, label: p.label.replace(' (zalecany)', '') }))], i.processPriority ?? '', async (v) => {
              await attempt(() => api.instances.update(i.id, { processPriority: v || null }));
              await state.refreshInstances();
            }),
          ),
          win ? setRow('Wydajna karta graficzna', 'Na laptopach wymusza kartę dedykowaną (NVIDIA/AMD) zamiast zintegrowanej.', HS.toggle(s.gpuPreference, (v) => state.setSettings({ gpuPreference: v }))) : null,
          setRow('Po uruchomieniu gry', 'Ukryty launcher nie zabiera pamięci ani procesora.', HS.select([{ value: 'hide', label: 'Ukryj do zasobnika' }, { value: 'minimize', label: 'Zminimalizuj' }, { value: 'keep', label: 'Zostaw otwarty' }], s.afterLaunch, (v) => state.setSettings({ afterLaunch: v }))),
        ),
      );
    }
    const setRow = (title, text, ctl) => h('div.set-row', h('div.txt', h('b', title), h('small', text)), h('div.ctl', ctl));

    let planRun = 0;
    async function drawMods() {
      const i = inst();
      const mine = ++planRun;
      const head = h('div.card-head', icon('bolt'), h('h2.grow', 'Mody wydajnościowe'));
      if (i.loader === 'vanilla') {
        return clear(modsCard, head, HS.empty('puzzle', 'Instancja bez loadera', 'Mody wydajnościowe (Sodium, Lithium…) działają z Fabric, Quilt, Forge i NeoForge. Zmień loader, aby je dodać – zwykle to +100% FPS.', h('button.btn.primary', { onclick: () => HS.editInstance(i) }, icon('pen'), 'Zmień loader')));
      }
      const list = h('div.rows', [1, 2, 3, 4].map(() => h('div.skeleton', { style: { height: '50px' } })));
      const btn = h('button.btn.primary', { disabled: true }, icon('download'), 'Zainstaluj');
      const check = (label, on, set, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: on, onchange: (e) => (set(e.target.checked), drawAuto(), drawMods()) }), label);
      head.append(btn);
      clear(
        modsCard,
        head,
        h(
          'div.row',
          { style: { margin: '-6px 0 12px', gap: '16px' } },
          h('span.hint.grow', info.recommendation.turbo ? 'Twój procesor poradzi sobie z dodatkami Turbo.' : 'Zestaw podstawowy wystarczy na tym komputerze.'),
          check('Turbo', turbo, (v) => (turbo = v), 'Dodatki dla mocnych procesorów: wielowątkowe chunki, szybsze światło'),
          check('z shaderami', shaders, (v) => (shaders = v), 'Dodaje Iris – obsługę shaderów'),
        ),
        list,
      );
      let plan;
      try {
        plan = await api.optimizer.plan(i.id, { turbo, shaders });
      } catch (err) {
        if (mine !== planRun) return undefined;
        return clear(list, HS.empty('warning', 'Brak połączenia z Modrinth', err.message, h('button.btn', { onclick: drawMods }, icon('refresh'), 'Spróbuj ponownie')));
      }
      if (mine !== planRun) return undefined;
      const missing = plan.mods.filter((m) => m.available && !m.installed);
      btn.disabled = !missing.length;
      btn.lastChild.textContent = missing.length ? `Zainstaluj (${missing.length})` : 'Komplet';
      btn.onclick = () =>
        HS.busy(btn, async () => {
          const res = await attempt(() => api.optimizer.apply(i.id, { mods: true, turbo, shaders }));
          if (!res) return;
          HS.toast('ok', `Zainstalowano: ${res.installed.join(', ') || 'nic nowego'}.`);
          for (const w of res.warnings ?? []) HS.toast('warning', w, 8000);
          await state.refreshInstances();
          drawMods();
        });
      const row = (m) =>
        h(
          `div.mod-check${m.available ? '' : '.na'}`,
          h('span', { style: { color: m.installed ? 'var(--ok)' : 'var(--accent)', display: 'grid', fontSize: '18px' } }, icon(m.installed ? 'check-circle' : m.available ? 'download' : 'x-circle')),
          h('div.grow', h('b', m.name), h('small', m.why)),
          h('span.state', m.installed ? HS.chip('Zainstalowany', 'ok') : m.available ? HS.chip(m.version?.number ? `Dostępny · ${m.version.number}`.slice(0, 26) : 'Dostępny', 'accent') : HS.chip(`Brak dla ${i.mcVersion}`)),
        );
      return clear(
        list,
        TIERS.map((t) => {
          const mods = plan.mods.filter((m) => (m.tier ?? 'core') === t.key);
          if (!mods.length) return null;
          return [h('div.tier-head', h('b', t.title), h('span', t.text), h('span.count', `${mods.filter((m) => m.installed).length}/${mods.filter((m) => m.available).length}`)), mods.map(row)];
        }),
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
    // Another instance, or the same one with another game version, loader or Java → fresh advice and a fresh mod list.
    const key = () => {
      const i = inst();
      return i ? [i.id, i.mcVersion, i.loader, i.javaPath ?? ''].join('|') : '';
    };
    let shown = key();
    const refresh = () => {
      drawInstBtn();
      if (!inst()) return;
      if (key() !== shown) {
        shown = key();
        load();
      } else if (info) drawSys();
    };
    const offs = [bus.on('settings', refresh), bus.on('instances', refresh)];
    return () => {
      planRun += 1;
      offs.forEach((f) => f());
    };
  }

  HS.views.optimize = { title: 'Optymalizacja', icon: 'gauge', render };
})();
