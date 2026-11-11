'use strict';
/* Ustawienia – accounts, game window, Java, downloads, Discord, the launcher's look (colour; with Hammer+ any colour,
   animated and own backgrounds), automatic world backups and the cloud (Hammer+), folders, disk space and clean-up, about. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  const row = (title, text, ctl) => h('div.set-row', h('div.txt', h('b', title), text ? h('small', text) : null), h('div.ctl', ctl));

  function accountsCard() {
    const card = h('section.card');
    const draw = () => {
      const sel = state.account?.id;
      clear(
        card,
        h('div.card-head', icon('users'), h('h2.grow', 'Konta Microsoft'), h('button.btn.primary.sm', { onclick: () => HS.login() }, icon('user-plus'), 'Dodaj konto')),
        state.accounts.length
          ? h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              state.accounts.map((a) =>
                h(
                  'div.installed-row',
                  { style: a.id === sel ? { borderColor: 'rgba(var(--glow),.5)' } : null },
                  HS.head(a, 40),
                  h('div.grow', h('b', a.name), h('small', a.needsLogin ? 'Sesja wygasła – zaloguj się ponownie' : `Dodano ${fmt.ago(a.addedAt)}`)),
                  a.needsLogin ? HS.chip('Wymaga logowania', 'warn', 'warning') : a.id === sel ? HS.chip('Aktywne', 'ok', 'check') : h('button.btn.sm', { onclick: () => state.setSettings({ selectedAccount: a.id }).then(() => state.refreshAccounts()) }, 'Używaj'),
                  h(
                    'button.btn.ghost.sm.icon.danger',
                    {
                      title: 'Wyloguj',
                      'aria-label': `Wyloguj ${a.name}`,
                      onclick: async () => {
                        if (!(await HS.confirmDialog({ title: 'Wylogować konto?', text: `Konto ${a.name} zostanie usunięte z launchera. Możesz je potem dodać ponownie.`, confirm: 'Wyloguj', danger: true }))) return;
                        if (await attempt(() => api.accounts.remove(a.id), 'Wylogowano.')) await state.refreshAccounts();
                      },
                    },
                    icon('logout'),
                  ),
                ),
              ),
            )
          : HS.empty('user', 'Brak kont', 'Zaloguj się kontem Microsoft z kupionym Minecraftem: Java Edition.'),
        h('p.hint', { style: { marginTop: '12px' } }, state.info?.secureStorage ? 'Tokeny logowania są zaszyfrowane przez system (Windows DPAPI / pęk kluczy). Launcher nigdy nie widzi Twojego hasła.' : 'Tokeny logowania są zaszyfrowane kluczem launchera. Launcher nigdy nie widzi Twojego hasła.'),
      );
    };
    draw();
    return { el: card, draw };
  }

  /**
   * Wygląd: the accent colour of the whole launcher (buttons, highlights, progress bars) – six free colours, and
   * with Hammer+ any colour, an animated background, the player's own picture behind the pages and in the game's menus.
   */
  function lookCard() {
    const card = h('section.card');
    let note = null; // why the colour on the screen is not exactly the one that was picked
    const draw = () => {
      const on = HS.plusOn();
      const s = state.settings;
      const custom = on && s.accent === 'custom' ? window.HS_THEME.palette(s.accentColor) : null;
      const current = custom ? { value: 'custom', label: 'Własny' } : (HS.ACCENTS.find((a) => a.value === s.accent) ?? HS.ACCENTS[0]);
      const setAccent = (patch) => attempt(() => state.setSettings(patch)).then(draw);
      let own;
      if (on) {
        const picker = h('input', { type: 'color', value: custom ? s.accentColor : '#3de0b4', 'aria-label': 'Własny kolor launchera' });
        picker.addEventListener('input', () => HS.applyTheme(picker.value)); // shown at once, saved when the picker closes
        picker.addEventListener('change', () => {
          note = window.HS_THEME.palette(picker.value)?.adjusted ? 'Ten kolor był za ciemny na ciemne tło launchera – jest trochę rozjaśniony, żeby napisy i przyciski zostały czytelne.' : null;
          setAccent({ accent: 'custom', accentColor: picker.value });
        });
        own = h(`label.swatch.custom${custom ? '.on' : ''}`, { title: 'Własny kolor', style: custom ? { '--c': custom.accent } : null }, icon(custom ? 'check' : 'plus'), picker);
      } else {
        own = h('button.swatch.custom.locked', { type: 'button', title: 'Własny kolor – w Hammer+', 'aria-label': 'Własny kolor – funkcja Hammer+', onclick: () => HS.go('plus') }, icon('lock'));
      }
      const style = on ? s.heroStyle : 'classic';
      const fxPick = h(
        'div.fx-pick',
        HS.FX.map((f) =>
          h(
            `button.fx-tile${f.value === style ? '.on' : ''}`,
            { type: 'button', title: `${f.label} – ${f.hint}`, 'aria-pressed': String(f.value === style), onclick: () => setAccent({ heroStyle: f.value }) },
            h('div.pic', HS.fxLayer(f.value)),
            h('span', f.label),
          ),
        ),
      );
      clear(
        card,
        h('div.card-head', icon('palette'), h('h2', 'Wygląd')),
        row(
          'Kolor launchera',
          on ? 'Przyciski, podświetlenia i paski postępu w Twoim kolorze. Ostatnie kółko to dowolny kolor.' : 'Przyciski, podświetlenia i paski postępu w Twoim kolorze.',
          h(
            'div.swatches',
            h('span.dim', current.label),
            HS.ACCENTS.map((a) =>
              h(`button.swatch${a.value === current.value ? '.on' : ''}`, { type: 'button', title: a.label, 'aria-label': `Kolor: ${a.label}`, 'aria-pressed': String(a.value === current.value), style: { '--c': a.color }, onclick: () => ((note = null), setAccent({ accent: a.value })) }, a.value === current.value ? icon('check') : null),
            ),
            own,
          ),
        ),
        custom && note ? h('p.hint.look-note', note) : null,
        HS.plusUi.row('Animowane tło', 'Ruchome tło ekranu Graj i delikatnie za pozostałymi stronami. Wyłącza się samo, gdy system ma ograniczone animacje.', fxPick),
        HS.plusUi.backgroundRows(),
      );
    };
    draw();
    return { el: card, draw };
  }

  /** Kopie światów i chmura (Hammer+): automatic backups after each game session and the cloud copy. */
  function plusCard() {
    const on = HS.plusOn();
    const sample = (ic, text) => h('button.btn.sm', { type: 'button' }, icon(ic), text);
    return h(
      'section.card',
      h('div.card-head', icon('archive'), h('h2.grow', 'Kopie światów i chmura'), on ? HS.chip('Hammer+', 'gold', 'check') : null),
      HS.plusUi.autoBackupRow(),
      on
        ? [h('div.sub-head', icon('cloud'), h('div.grow', h('h3', 'Chmura'), h('p.muted', 'Twoje ustawienia na każdym komputerze, na którym masz Hammer Launcher.'))), HS.plusUi.cloudBox()]
        : HS.plusUi.row('Chmura', 'Wygląd launchera, listy serwerów i układ HUD na każdym Twoim komputerze.', h('div.row', sample('upload', 'Wyślij do chmury'), sample('cloud-down', 'Pobierz z chmury'))),
    );
  }

  /* What the launcher's folder is made of, and what can be freed safely. */
  const PARTS = [
    { key: 'instances', label: 'Instancje', color: 'var(--accent)' },
    { key: 'game', label: 'Pliki gry', color: 'var(--info)' },
    { key: 'java', label: 'Java', color: 'var(--ok)' },
    { key: 'temp', label: 'Cache i logi', color: 'var(--warn)' },
  ];
  // `what` finishes the sentence "Launcher usunie na stałe: …".
  const CLEAN = {
    logs: { title: 'Stare logi i raporty crashy', what: 'stare logi i raporty crashy', hint: (g) => `Starsze niż 7 dni · ${fmt.count(g.count, 'plik', 'pliki', 'plików')}` },
    cache: { title: 'Pamięć podręczna launchera', what: 'pamięć podręczną launchera', hint: () => 'Pliki tymczasowe – launcher pobierze je ponownie, gdy będą potrzebne.' },
    versions: { title: 'Nieużywane wersje gry', what: 'nieużywane wersje gry', hint: (g) => `Nie korzysta z nich żadna instancja: ${g.items.map((i) => i.name).join(', ')}` },
    runtimes: { title: 'Nieużywana Java', what: 'nieużywaną Javę', hint: (g) => `Żadna instancja jej nie potrzebuje: ${g.items.map((i) => (i.java ? `Java ${i.java}` : i.name)).join(', ')}` },
  };
  let diskCache = null; // { at, usage, plan } – switching tabs does not scan the disk again

  function diskCard() {
    const card = h('section.card');
    let usage = null;
    let plan = null;
    let failed = null;
    let alive = true;
    const selected = new Set();

    const usageBox = () => {
      if (!usage) return [h('div.skeleton', { style: { height: '12px' } }), h('div.skeleton', { style: { height: '74px', marginTop: '14px' } })];
      const parts = { instances: usage.instances.reduce((sum, i) => sum + i.size, 0), game: usage.versions + usage.libraries + usage.assets, java: usage.runtime, temp: usage.cache + usage.logs };
      const biggest = Math.max(1, ...usage.instances.map((i) => i.size));
      const shown = usage.instances.slice(0, 6);
      return [
        h('div.disk-bar', PARTS.filter((p) => parts[p.key] > 0).map((p) => h('i', { title: `${p.label}: ${fmt.size(parts[p.key])}`, style: { '--c': p.color, flexGrow: String(parts[p.key]) } }))),
        h('div.disk-legend', PARTS.map((p) => h('span', h('i', { style: { '--c': p.color } }), p.label, h('b', parts[p.key] ? fmt.size(parts[p.key]) : '—')))),
        shown.length
          ? h(
              'div.disk-list',
              shown.map((i) => h('div.disk-item', h('span.ellipsis', i.name), h('div.progress', h('i', { style: { '--w': `${Math.max(1, Math.round((i.size / biggest) * 100))}%` } })), h('span.size', fmt.size(i.size)))),
              usage.instances.length > shown.length ? h('div.hint', `…i jeszcze ${fmt.count(usage.instances.length - shown.length, 'mniejsza instancja', 'mniejsze instancje', 'mniejszych instancji')}.`) : null,
            )
          : null,
      ];
    };

    const cleanBox = () => {
      if (!plan) return h('div.skeleton', { style: { height: '56px' } });
      if (!plan.groups.length) return null;
      const running = state.running.size > 0;
      const chosen = () => plan.groups.filter((g) => selected.has(g.key));
      const sum = () => chosen().reduce((total, g) => total + g.size, 0);
      const label = h('span');
      const free = h('button.btn.primary', {}, icon('broom'), label);
      // Ticking a box only changes the button – the list is not redrawn, so the keyboard focus stays on the box.
      const sync = () => {
        label.textContent = `Zwolnij ${fmt.size(sum())}`;
        free.disabled = running || !selected.size;
      };
      sync();
      free.onclick = async () => {
        const keys = chosen().map((g) => g.key);
        const what = keys.map((k) => CLEAN[k]?.what ?? k).join(', ');
        const ok = await HS.confirmDialog({ title: `Zwolnić ${fmt.size(sum())}?`, text: `Launcher usunie na stałe: ${what}. Twoje światy, mody i ustawienia zostają, a potrzebne pliki gry pobiorą się ponownie przy starcie.`, confirm: 'Zwolnij miejsce', danger: true });
        if (!ok) return;
        await HS.busy(free, async () => {
          const res = await attempt(() => api.cleanup.apply(keys));
          if (!res) return;
          HS.toast(res.failed ? 'warning' : 'ok', `Zwolniono ${fmt.size(res.freed)}.${res.failed ? ` Nie udało się usunąć ${fmt.count(res.failed, 'elementu', 'elementów', 'elementów')} – mogą być używane przez inny program.` : ''}`, 6000);
          await load(true);
        });
      };
      return [
        h(
          'div.rows',
          plan.groups.map((g) =>
            h(
              'label.clean-row',
              h('input', { type: 'checkbox', checked: selected.has(g.key), onchange: (e) => ((e.target.checked ? selected.add(g.key) : selected.delete(g.key)), sync()) }),
              h('div.grow', h('b', CLEAN[g.key]?.title ?? g.key), h('small.ellipsis', CLEAN[g.key]?.hint(g) ?? '')),
              h('span.size', fmt.size(g.size)),
            ),
          ),
        ),
        h('div.row', { style: { marginTop: '12px' } }, h('span.grow.hint', running ? h('span.warn', 'Zamknij grę, żeby posprzątać – może właśnie używać tych plików.') : 'Usuwane są tylko pliki, które launcher potrafi pobrać ponownie, oraz stare logi.'), free),
      ];
    };

    function draw() {
      clear(
        card,
        h(
          'div.card-head',
          icon('disk'),
          h('h2.grow', 'Miejsce na dysku'),
          usage ? h('span.dim', { style: { fontSize: '12.5px' } }, `Launcher zajmuje ${fmt.size(usage.total)}`) : null,
          h('button.btn.sm.icon', { title: 'Policz ponownie', 'aria-label': 'Policz ponownie', onclick: () => load(true) }, icon('refresh')),
        ),
        failed ? h('p.warn', { style: { fontSize: '13px' } }, `Nie udało się policzyć plików: ${failed}`) : usageBox(),
        h(
          'div.sub-head',
          icon('broom'),
          h('div.grow', h('h3', 'Sprzątanie'), h('p.muted', !plan ? 'Sprawdzam, co można bezpiecznie usunąć…' : plan.groups.length ? `Możesz bezpiecznie zwolnić ${fmt.size(plan.total)}.` : 'Nie ma nic do sprzątania – wszystko, co leży na dysku, jest w użyciu.')),
        ),
        failed ? null : cleanBox(),
      );
    }

    /** Everything that can be freed starts ticked – the player unticks what should stay. */
    const setPlan = (res) => {
      plan = res;
      selected.clear();
      res.groups.forEach((g) => selected.add(g.key));
    };
    const redraw = () => alive && draw();

    async function load(fresh = false) {
      if (!fresh && diskCache && Date.now() - diskCache.at < 60_000) {
        usage = diskCache.usage;
        setPlan(diskCache.plan);
        return redraw();
      }
      usage = null;
      plan = null;
      failed = null;
      redraw();
      try {
        // The plan is quick, the sizes of big folders take a moment – each part shows up when it is ready.
        await Promise.all([api.cleanup.plan().then((res) => (setPlan(res), redraw())), api.cleanup.usage().then((res) => ((usage = res), redraw()))]);
        diskCache = { at: Date.now(), usage, plan };
      } catch (err) {
        failed = err?.message ?? 'nieznany błąd';
      }
      return redraw();
    }
    load();
    return { el: card, draw: () => plan && redraw(), stop: () => (alive = false) };
  }

  function render(root) {
    const acc = accountsCard();
    const look = lookCard();
    const disk = diskCard();
    const s = () => state.settings;
    const set = (patch) => attempt(() => state.setSettings(patch));

    const res = s().resolution ?? {};
    const w = h('input.input', { type: 'number', min: 640, max: 7680, value: res.width ?? 1280, style: { width: '96px' } });
    const hh = h('input.input', { type: 'number', min: 480, max: 4320, value: res.height ?? 720, style: { width: '96px' } });
    const saveRes = HS.debounce(() => set({ resolution: { ...s().resolution, width: Number(w.value), height: Number(hh.value) } }), 500);
    w.oninput = saveRes;
    hh.oninput = saveRes;

    const ramVal = h('b', { style: { minWidth: '64px', textAlign: 'right' } });
    const ram = HS.range(h('input', { type: 'range', min: 1024, max: 16384, step: 512, value: s().memoryMb ?? 4096, style: { width: '170px' } }));
    const showRam = () => (ramVal.textContent = s().memoryMb == null ? 'auto' : fmt.mb(Number(ram.value)));
    ram.addEventListener('input', () => {
      ramVal.textContent = fmt.mb(Number(ram.value));
    });
    ram.addEventListener('change', () => set({ memoryMb: Number(ram.value) }).then(showRam));

    const javaInput = h('input.input', { value: s().javaPath ?? '', placeholder: 'Automatycznie (zalecane)', style: { width: '260px' }, onchange: (e) => set({ javaPath: e.target.value }) });
    const jvmArgs = h('textarea.input', { rows: 2, value: s().customJvmArgs ?? '', placeholder: 'np. -XX:+UseLargePages', onchange: (e) => set({ customJvmArgs: e.target.value }) });

    clear(
      root,
      h(
        'div.page',
        { style: { maxWidth: '980px' } },
        h('div.page-head', h('div', h('h1', 'Ustawienia'), h('p', 'Domyślne ustawienia dla wszystkich instancji. Każdą instancję możesz też dostroić osobno.'))),
        h(
          'div.settings',
          acc.el,
          h(
            'section.card',
            h('div.card-head', icon('monitor'), h('h2', 'Gra')),
            row('Rozdzielczość okna', 'Rozmiar okna gry przy starcie.', h('div.row', w, h('span.dim', '×'), hh)),
            row('Pełny ekran', 'Uruchamiaj grę od razu na pełnym ekranie.', HS.toggle(res.fullscreen, (v) => set({ resolution: { ...s().resolution, fullscreen: v } }))),
            row('Po uruchomieniu gry', 'Ukryty launcher czeka w zasobniku obok zegara i wraca po wyjściu z gry.', HS.select([{ value: 'hide', label: 'Ukryj do zasobnika' }, { value: 'minimize', label: 'Zminimalizuj' }, { value: 'keep', label: 'Zostaw otwarty' }], s().afterLaunch, (v) => set({ afterLaunch: v }))),
            row('Zamknij launcher po wyjściu z gry', null, HS.toggle(s().closeOnExit, (v) => set({ closeOnExit: v }))),
            row('Wersje snapshot', 'Pokazuj testowe wersje Minecrafta przy tworzeniu instancji.', HS.toggle(s().showSnapshots, (v) => set({ showSnapshots: v }))),
            row('Status w Discordzie', 'Pokaż znajomym, że grasz przez Hammer Launcher.', HS.toggle(s().discordRpc, (v) => set({ discordRpc: v }))),
          ),
          h(
            'section.card',
            h('div.card-head', icon('java'), h('h2', 'Java i pamięć')),
            row(
              'Domyślna pamięć RAM',
              'Automatycznie launcher dobiera RAM do komputera i liczby modów.',
              h(
                'div.row',
                HS.toggle(s().memoryMb == null, (v) => set({ memoryMb: v ? null : Number(ram.value) }).then(() => ((ram.disabled = v), showRam()))),
                h('span.dim', { style: { fontSize: '12px' } }, 'auto'),
                ram,
                ramVal,
              ),
            ),
            row('Domyślne flagi Javy', 'Launcher dopasowuje je do Javy każdej instancji (8, 17, 21 albo 25).', HS.select([{ value: 'recommended', label: 'Zalecane (G1GC)' }, { value: 'zgc', label: 'ZGC – mniej przycięć (Java 21+)' }, { value: 'vanilla', label: 'Domyślne Mojang' }, { value: 'custom', label: 'Własne' }], s().jvmPreset, (v) => set({ jvmPreset: v }))),
            row('Własne argumenty Javy', 'Używane przy flagach „Własne”.', jvmArgs),
            row('Własna Java', 'Zostaw puste – launcher pobierze właściwą Javę dla każdej wersji.', javaInput),
          ),
          h(
            'section.card',
            h('div.card-head', icon('download'), h('h2', 'Pobieranie i pliki')),
            row('Równoległe pobierania', 'Więcej = szybciej na dobrym łączu.', HS.select([4, 8, 16, 32, 48].map((n) => ({ value: n, label: `${n}` })), s().concurrentDownloads, (v) => set({ concurrentDownloads: Number(v) }))),
            row('Folder launchera', state.info?.root ?? '', h('button.btn', { onclick: () => attempt(() => api.app.openFolder(null)) }, icon('folder'), 'Otwórz')),
          ),
          look.el,
          plusCard(),
          disk.el,
          h(
            'section.card',
            h('div.card-head', icon('info'), h('h2', 'O launcherze')),
            h(
              'div.row',
              { style: { gap: '16px' } },
              h('img', { src: 'assets/hammer-mark.png', alt: '', style: { width: '56px', height: '56px' } }),
              h('div.grow', h('h3', `${state.info?.config?.name ?? 'Hammer Launcher'} ${state.info?.version ?? ''}`), h('p.muted', 'Szybki launcher Minecrafta z modami i optymalizacją. Mody i paczki pochodzą z Modrinth. Minecraft jest znakiem towarowym Mojang Studios – launcher nie jest z nim powiązany.'), h('div.dev-credit', 'by HammerShop', h('i.tb-slash', { 'aria-hidden': 'true' }), h('span', 'developed by ', h('strong', '120FpsPlayer')))),
              state.info?.config?.website ? h('button.btn', { onclick: () => HS.open(state.info.config.website) }, icon('globe'), 'Strona') : null,
            ),
          ),
        ),
      ),
    );
    ram.disabled = s().memoryMb == null;
    showRam();
    const offs = [bus.on('accounts', acc.draw), bus.on('game', disk.draw)];
    return () => {
      disk.stop();
      offs.forEach((f) => f());
    };
  }

  HS.views.settings = { title: 'Ustawienia', icon: 'gear', render };
})();
