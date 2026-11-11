'use strict';
/* Instancje – separate game setups (version + loader + mods), with an editor for creating and changing them. */

(() => {
  const { api, h, clear, icon, fmt, LOADERS, TILES, tile, bus, state, attempt } = HS;

  /** Create (no instance) or edit an instance. */
  function editInstance(instance = null) {
    const isNew = !instance;
    const data = {
      name: instance?.name ?? '',
      icon: instance?.icon ?? 'hammer',
      mcVersion: instance?.mcVersion ?? null,
      loader: instance?.loader ?? 'fabric',
      loaderVersion: instance?.loaderVersion ?? null,
      optimized: instance?.optimized ?? true,
      memoryMb: instance?.memoryMb ?? null,
      jvmPreset: instance?.jvmPreset ?? null,
      customJvmArgs: instance?.customJvmArgs ?? '',
      javaPath: instance?.javaPath ?? '',
      autoJoinServer: instance?.autoJoinServer ?? false,
      hammerClient: instance?.hammerClient ?? true,
    };
    let snapshots = state.settings.showSnapshots;

    const nameInput = h('input.input', { value: data.name, maxLength: 48, placeholder: 'np. Survival z przyjaciółmi', oninput: (e) => (data.name = e.target.value) });
    const iconPick = h('div.icon-pick');
    const drawIcons = () =>
      clear(
        iconPick,
        Object.keys(TILES).map((k) =>
          h(
            `button${data.icon === k ? '.on' : ''}`,
            {
              type: 'button',
              title: k,
              onclick: () => {
                data.icon = k;
                drawIcons();
              },
            },
            tile({ icon: k }, 34),
          ),
        ),
      );
    drawIcons();

    const versionSel = h('select.select', { disabled: true }, h('option', 'Wczytywanie wersji…'));
    const loaderVerSel = h('select.select', { disabled: true }, h('option', 'Najnowsza zalecana'));
    const loaderHint = h('div.hint', LOADERS[data.loader].hint);
    const optRow = h('div');

    async function loadVersions() {
      versionSel.disabled = true;
      try {
        const list = await api.versions.minecraft({ snapshots });
        // New instances start on the newest version Hammer Client supports (custom menu and HUD), else the newest one.
        const hc = [...HS.hammerClientVersions()].reverse().find((id) => list.some((v) => v.id === id));
        if (!data.mcVersion) data.mcVersion = hc ?? list[0]?.id;
        clear(
          versionSel,
          list.map((v) => h('option', { value: v.id, selected: v.id === data.mcVersion }, v.type === 'snapshot' ? `${v.id} (snapshot)` : v.id)),
        );
        if (data.mcVersion && !list.some((v) => v.id === data.mcVersion)) versionSel.prepend(h('option', { value: data.mcVersion, selected: true }, data.mcVersion));
        versionSel.disabled = false;
        loadLoaderVersions();
      } catch (err) {
        clear(versionSel, h('option', 'Brak połączenia – nie można pobrać listy wersji'));
        HS.toast('err', err.message);
      }
    }
    versionSel.onchange = () => {
      data.mcVersion = versionSel.value;
      data.loaderVersion = null;
      loadLoaderVersions();
      drawOpt();
    };

    async function loadLoaderVersions() {
      loaderHint.textContent = LOADERS[data.loader].hint;
      drawOpt();
      if (data.loader === 'vanilla') {
        clear(loaderVerSel, h('option', '—'));
        loaderVerSel.disabled = true;
        return;
      }
      loaderVerSel.disabled = true;
      clear(loaderVerSel, h('option', 'Wczytywanie…'));
      try {
        const list = await api.versions.loaders(data.loader, data.mcVersion);
        if (!list.length) {
          clear(loaderVerSel, h('option', `${LOADERS[data.loader].name} nie wspiera tej wersji`));
          loaderHint.innerHTML = '';
          loaderHint.append(h('span.warn', `${LOADERS[data.loader].name} nie ma jeszcze wersji dla Minecrafta ${data.mcVersion}. Wybierz inny loader lub wersję gry.`));
          return;
        }
        clear(
          loaderVerSel,
          h('option', { value: '' }, 'Najnowsza zalecana'),
          list.slice(0, 80).map((v) => h('option', { value: v.version, selected: v.version === data.loaderVersion }, `${v.version}${v.recommended ? ' – zalecana' : v.stable === false ? ' – beta' : ''}`)),
        );
        loaderVerSel.disabled = false;
      } catch (err) {
        clear(loaderVerSel, h('option', 'Nie udało się pobrać wersji loadera'));
      }
    }
    loaderVerSel.onchange = () => (data.loaderVersion = loaderVerSel.value || null);

    const loaderSeg = HS.seg(
      Object.entries(LOADERS).map(([value, l]) => ({ value, label: l.name })),
      data.loader,
      (v) => {
        data.loader = v;
        data.loaderVersion = null;
        loadLoaderVersions();
      },
    );

    const optBox = { padding: '12px 14px', borderRadius: '10px', background: 'rgba(var(--glow),.07)', border: '1px solid rgba(var(--glow),.22)' };
    function drawOpt() {
      const hcOk = HS.hammerClientFits(data.mcVersion, data.loader);
      const hcRange = HS.hammerClientRange();
      clear(
        optRow,
        h(
          'div.form',
          { style: { gap: '10px' } },
          data.loader === 'vanilla'
            ? h('div.hint', 'Mody wydajnościowe wymagają loadera (np. Fabric). W Vanilli launcher nadal dobierze RAM i flagi Javy.')
            : h('div.row', { style: optBox }, icon('bolt'), h('div.grow', h('b', 'Optymalizacja HammerShop'), h('div.hint', 'Przy pierwszym uruchomieniu doda Sodium, Lithium, FerriteCore i inne mody na więcej FPS.')), HS.toggle(data.optimized, (v) => (data.optimized = v))),
          hcOk
            ? h('div.row', { style: optBox }, icon('hammer'), h('div.grow', h('b', 'Hammer Client – menu w grze'), h('div.hint', 'Własne menu główne, panel modułów (prawy Shift), HUD: FPS, CPS, klawisze, pancerz… i zoom pod C.')), HS.toggle(data.hammerClient, (v) => (data.hammerClient = v)))
            : hcRange
              ? h('div.hint', h('span', { style: { color: 'var(--accent2)' } }, 'Hammer Client'), ` (menu i HUD w grze, jak Lunar) działa z Fabric i Quilt na ${hcRange}.`)
              : null,
        ),
      );
    }

    const advanced = isNew
      ? null
      : h(
          'details',
          { style: { borderTop: '1px solid var(--line)', paddingTop: '14px' } },
          h('summary', { style: { cursor: 'pointer', fontWeight: 700, color: 'var(--muted)' } }, 'Zaawansowane (Java, pamięć, serwer)'),
          h(
            'div.form',
            { style: { marginTop: '14px' } },
            h(
              'div.two',
              HS.field('Pamięć RAM (MB)', h('input.input', { type: 'number', min: 1024, max: 65536, step: 512, value: data.memoryMb ?? '', placeholder: 'Jak w ustawieniach', oninput: (e) => (data.memoryMb = e.target.value ? Number(e.target.value) : null) }), 'Puste = ustawienie globalne / automatycznie.'),
              HS.field(
                'Flagi Javy',
                HS.select(
                  [
                    { value: '', label: 'Jak w ustawieniach' },
                    { value: 'recommended', label: 'Zalecane (G1GC)' },
                    { value: 'zgc', label: 'ZGC – mniej przycięć (Java 21+)' },
                    { value: 'vanilla', label: 'Domyślne Mojang' },
                    { value: 'custom', label: 'Własne' },
                  ],
                  data.jvmPreset ?? '',
                  (v) => (data.jvmPreset = v || null),
                ),
              ),
            ),
            HS.field('Własne argumenty Javy', h('textarea.input', { rows: 2, value: data.customJvmArgs, placeholder: '-XX:+UseLargePages', oninput: (e) => (data.customJvmArgs = e.target.value) }), 'Dodawane przy flagach „Własne”. -Xmx/-Xms ustawiasz suwakiem RAM.'),
            HS.field('Własna Java (ścieżka do java/javaw)', h('input.input', { value: data.javaPath, placeholder: 'Puste = launcher sam pobierze właściwą Javę', oninput: (e) => (data.javaPath = e.target.value) })),
            state.info?.config?.server?.address
              ? h('div.row', h('div.grow', h('b', 'Wejdź od razu na serwer'), h('div.hint', `Po uruchomieniu gra połączy się z ${state.info.config.server.address}.`)), HS.toggle(data.autoJoinServer, (v) => (data.autoJoinServer = v)))
              : null,
          ),
        );

    const snapToggle = h('label.row', { style: { gap: '8px', fontSize: '12px', color: 'var(--dim)', cursor: 'pointer', width: 'fit-content' } }, h('input', { type: 'checkbox', checked: snapshots, onchange: (e) => ((snapshots = e.target.checked), loadVersions()) }), 'pokaż snapshoty');

    const save = h('button.btn.primary', {}, icon(isNew ? 'plus' : 'check'), isNew ? 'Utwórz instancję' : 'Zapisz');
    const m = HS.modal({
      title: isNew ? 'Nowa instancja' : `Edytuj: ${instance.name}`,
      icon: 'cube',
      body: h(
        'div.form',
        HS.field('Nazwa', nameInput),
        HS.field('Ikona', iconPick),
        h('div.two', h('div.field', h('span', 'Wersja Minecrafta'), versionSel, snapToggle), HS.field('Wersja loadera', loaderVerSel)),
        HS.field('Loader modów', loaderSeg, loaderHint),
        optRow,
        advanced,
      ),
      foot: [h('button.btn.ghost', { onclick: () => m.close() }, 'Anuluj'), save],
    });
    save.onclick = () =>
      HS.busy(save, async () => {
        if (!data.mcVersion) return HS.toast('warning', 'Wybierz wersję Minecrafta.');
        const payload = { ...data, name: data.name.trim() || `${LOADERS[data.loader].name} ${data.mcVersion}` };
        const res = await attempt(() => (isNew ? api.instances.create(payload) : api.instances.update(instance.id, payload)), isNew ? 'Instancja utworzona – kliknij GRAJ, aby ją pobrać.' : 'Zapisano zmiany.');
        if (!res) return;
        await state.refreshInstances();
        if (isNew) await state.selectInstance(res.id);
        m.close();
        // A new instance starts with the launcher's own settings – one quiet offer to bring the player's over.
        if (isNew) HS.officialUi.offerOptions(res);
      });
    loadVersions();
  }
  HS.editInstance = editInstance;

  // Whether this computer has an official Minecraft with settings to bring over (asked when the tab opens).
  let hasOfficialOptions = false;

  function actions(i, anchor) {
    HS.menu(anchor, [
      { icon: 'play', label: 'Graj', onClick: () => HS.play(i.id) },
      { icon: 'pen', label: 'Edytuj', onClick: () => editInstance(i) },
      { icon: 'puzzle', label: 'Mody', onClick: () => state.selectInstance(i.id).then(() => HS.go('mods')) },
      { icon: 'folder', label: 'Otwórz folder', onClick: () => attempt(() => api.app.openFolder(i.id)) },
      { icon: 'copy', label: 'Duplikuj', onClick: () => attempt(() => api.instances.duplicate(i.id), 'Utworzono kopię instancji.').then(() => state.refreshInstances()) },
      { icon: 'share', label: 'Udostępnij', hint: 'kod albo plik', onClick: () => HS.shareUi.exportDialog(i) },
      ...(hasOfficialOptions ? [{ icon: 'sliders', label: 'Przenieś ustawienia z Minecrafta', onClick: () => HS.officialUi.importOptions(i) }] : []),
      {
        icon: 'wrench',
        label: 'Napraw instancję',
        onClick: async () => {
          // Nothing is deleted: the next start checks every game file and installs the loader again.
          if (!(await attempt(() => api.instances.repair(i.id)))) return;
          HS.toast('ok', `Gotowe – przy następnym uruchomieniu launcher sprawdzi wszystkie pliki gry${i.loader !== 'vanilla' ? ` i zainstaluje ${LOADERS[i.loader]?.name ?? 'loader'} od nowa` : ''}. Światy, mody i ustawienia zostają bez zmian.`, 8000);
          await state.refreshInstances();
        },
      },
      '-',
      {
        icon: 'trash',
        label: 'Usuń',
        onClick: async () => {
          const ok = await HS.confirmDialog({ title: 'Usunąć instancję?', text: `„${i.name}” zostanie usunięta razem ze światami, modami i ustawieniami. Tego nie da się cofnąć.`, confirm: 'Usuń na zawsze', danger: true });
          if (!ok) return;
          if (await attempt(() => api.instances.remove(i.id), 'Instancja usunięta.')) await state.refreshInstances();
        },
      },
    ]);
  }

  function render(root) {
    const grid = h('div.inst-grid');
    const draw = () => {
      const sel = state.instance?.id;
      // Mod updates the background check found – a badge on the instance that leads to the list.
      const updates = new Map((state.updates?.instances ?? []).map((u) => [u.id, u.count]));
      clear(
        grid,
        state.instances.map((i) => {
          const run = state.running.get(i.id);
          const news = updates.get(i.id);
          return h(
            `div.inst-card${i.id === sel ? '.selected' : ''}`,
            { tabIndex: 0, onclick: () => state.selectInstance(i.id), ondblclick: () => editInstance(i), oncontextmenu: (e) => (e.preventDefault(), actions(i, e.currentTarget.querySelector('.more'))) },
            run ? h('span.running-badge', HS.chip(run === 'preparing' ? 'Pobieranie' : 'W grze', 'ok', 'play')) : null,
            h('div.top', tile(i, 48), h('div.grow', h('h3.ellipsis', i.name), h('div.dim', { style: { fontSize: '12.5px' } }, `Minecraft ${i.mcVersion}`))),
            h(
              'div.chips',
              HS.chip(LOADERS[i.loader]?.name ?? i.loader, i.loader === 'vanilla' ? null : 'accent', i.loader === 'vanilla' ? 'cube' : 'puzzle'),
              i.optimized && i.loader !== 'vanilla' ? HS.chip('Zoptymalizowana', 'ok', 'bolt') : null,
              HS.hammerClientOn(i) ? HS.chip('Hammer Client', 'accent', 'hammer') : null,
              i.modpack ? HS.chip(i.modpack.version ? `Paczka ${i.modpack.version}` : 'Paczka modów', null, 'box') : null,
              news
                ? h('button.chip.accent.update-badge', { type: 'button', title: 'Zobacz, co można zaktualizować', onclick: (e) => (e.stopPropagation(), HS.openUpdates(i.id)), ondblclick: (e) => e.stopPropagation() }, icon('arrow-up'), fmt.count(news, 'aktualizacja', 'aktualizacje', 'aktualizacji'))
                : null,
            ),
            h(
              'div.foot',
              icon('clock'),
              h('span', i.playTimeMs ? fmt.duration(i.playTimeMs) : 'jeszcze nie grano'),
              h('button.btn.sm.icon.ghost.more', { title: 'Więcej', 'aria-label': 'Więcej opcji', onclick: (e) => (e.stopPropagation(), actions(i, e.currentTarget)) }, icon('ellipsis')),
              h('button.btn.sm.primary', { style: { marginLeft: 0 }, disabled: Boolean(run), onclick: (e) => (e.stopPropagation(), HS.play(i.id)) }, icon('play'), 'Graj'),
            ),
          );
        }),
        h('button.inst-card.new-card', { onclick: () => editInstance() }, icon('plus'), h('b', 'Nowa instancja'), h('small.dim', 'Dowolna wersja i loader')),
      );
    };

    clear(
      root,
      h(
        'div.page',
        h(
          'div.page-head',
          h('div', h('h1', 'Instancje'), h('p', 'Każda instancja ma własne mody, światy i ustawienia – nic się nie miesza.')),
          h(
            'div.actions',
            h('button.btn', { title: 'Z kodu lub pliku – instancja, którą ktoś Ci udostępnił', onclick: () => HS.shareUi.importDialog() }, icon('share'), 'Z kodu lub pliku'),
            h('button.btn', { title: 'Importuj paczkę modów (.mrpack)', 'aria-label': 'Importuj .mrpack', onclick: (e) => HS.importModpack(e.currentTarget) }, icon('import'), h('span.wide', 'Importuj .mrpack')),
            h('button.btn', { title: 'Otwórz folder instancji', 'aria-label': 'Folder', onclick: () => attempt(() => api.app.openFolder(null, 'instances')) }, icon('folder'), h('span.wide', 'Folder')),
            h('button.btn.primary', { onclick: () => editInstance() }, icon('plus'), 'Nowa instancja'),
          ),
        ),
        grid,
      ),
    );
    draw();
    HS.officialUi.info().then((o) => (hasOfficialOptions = Boolean(o.options)));
    const offs = [bus.on('instances', draw), bus.on('settings', draw), bus.on('game', draw), bus.on('updates', draw)];
    return () => offs.forEach((f) => f());
  }

  HS.importModpack = (btn) =>
    HS.busy(btn, async () => {
      const inst = await attempt(() => api.modpacks.import());
      if (inst) {
        HS.toast('ok', `Zaimportowano paczkę „${inst.name}”.`);
        await state.refreshInstances();
        await state.selectInstance(inst.id);
      }
    });

  HS.views.instances = { title: 'Instancje', icon: 'cubes', render };
})();
