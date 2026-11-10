'use strict';
/* Ustawienia – accounts, game window, Java, downloads, Discord, folders, about. */

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

  function render(root) {
    const acc = accountsCard();
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
            row('Domyślne flagi Javy', null, HS.select([{ value: 'recommended', label: 'Zalecane (G1GC)' }, { value: 'zgc', label: 'ZGC – mniej przycięć' }, { value: 'vanilla', label: 'Domyślne Mojang' }, { value: 'custom', label: 'Własne' }], s().jvmPreset, (v) => set({ jvmPreset: v }))),
            row('Własne argumenty Javy', 'Używane przy flagach „Własne”.', jvmArgs),
            row('Własna Java', 'Zostaw puste – launcher pobierze właściwą Javę dla każdej wersji.', javaInput),
          ),
          h(
            'section.card',
            h('div.card-head', icon('download'), h('h2', 'Pobieranie i pliki')),
            row('Równoległe pobierania', 'Więcej = szybciej na dobrym łączu.', HS.select([4, 8, 16, 32, 48].map((n) => ({ value: n, label: `${n}` })), s().concurrentDownloads, (v) => set({ concurrentDownloads: Number(v) }))),
            row('Folder launchera', state.info?.root ?? '', h('button.btn', { onclick: () => attempt(() => api.app.openFolder(null)) }, icon('folder'), 'Otwórz')),
          ),
          h(
            'section.card',
            h('div.card-head', icon('info'), h('h2', 'O launcherze')),
            h(
              'div.row',
              { style: { gap: '16px' } },
              h('img', { src: 'assets/hammer-mark.png', alt: '', style: { width: '56px', height: '56px' } }),
              h('div.grow', h('h3', `${state.info?.config?.name ?? 'Hammer Launcher'} ${state.info?.version ?? ''}`), h('p.muted', 'Szybki launcher Minecrafta z modami i optymalizacją. Mody i paczki pochodzą z Modrinth. Minecraft jest znakiem towarowym Mojang Studios – launcher nie jest z nim powiązany.')),
              state.info?.config?.website ? h('button.btn', { onclick: () => HS.open(state.info.config.website) }, icon('globe'), 'Strona') : null,
            ),
          ),
        ),
      ),
    );
    ram.disabled = s().memoryMb == null;
    showRam();
    const off = bus.on('accounts', acc.draw);
    return off;
  }

  HS.views.settings = { title: 'Ustawienia', icon: 'gear', render };
})();
