'use strict';
/* Hammer Launcher – app shell: window buttons, sidebar, router, game events, PLAY / login. */

(() => {
  const { api, h, clear, icon, bus, state, toast, attempt } = HS;

  const NAV = ['home', 'instances', 'mods', 'servers', 'worlds', 'optimize', 'gallery', 'console', 'settings'];
  let current = null;
  let cleanup = null;

  /* ── window buttons (frameless window) ── */
  const WIN_ICONS = { minimize: 'minus', maximize: 'square', close: 'close' };
  for (const btn of document.querySelectorAll('[data-win]')) {
    btn.append(icon(WIN_ICONS[btn.dataset.win]));
    btn.addEventListener('click', () => api.window[btn.dataset.win]());
  }
  api.on('window:state', ({ maximized }) => {
    const btn = document.querySelector('[data-win="maximize"]');
    clear(btn, icon(maximized ? 'restore' : 'square'));
    btn.title = maximized ? 'Przywróć' : 'Maksymalizuj';
  });

  /* ── sidebar ── */
  const nav = document.getElementById('nav');
  const foot = document.getElementById('sidebar-foot');
  function drawNav() {
    const running = state.running.size;
    clear(
      nav,
      NAV.map((id) => {
        const v = HS.views[id];
        return h(
          `button.nav-item${current === id ? '.active' : ''}`,
          { onclick: () => go(id), 'aria-current': current === id ? 'page' : null },
          icon(v.icon),
          v.title,
          id === 'console' && running ? h('span.nav-badge', { title: 'Gra działa' }, String(running)) : null,
        );
      }),
    );
  }
  const taskBox = h('div');
  const discordBox = h('div');
  function drawDiscordMini(d) {
    if (!d || d.invalid) return clear(discordBox);
    clear(
      discordBox,
      h(
        'button.discord-mini',
        { onclick: () => HS.open(d.url), title: `Dołącz do ${d.name}` },
        icon('discord'),
        h('div.grow', { style: { minWidth: 0 } }, h('b.ellipsis', 'Dołącz do Discorda'), h('small', d.online != null ? [h('i.dot.discord', { style: { width: '7px', height: '7px' } }), `${HS.fmt.num(d.online)} online`] : 'Pomoc i społeczność')),
        icon('chevron-right'),
      ),
    );
  }
  function drawFoot() {
    const a = state.account;
    clear(
      foot,
      taskBox,
      discordBox,
      h(
        'button.account-chip',
        { onclick: (e) => accountMenu(e.currentTarget), title: 'Konta' },
        a ? HS.head(a, 36) : h('div.head', { style: { '--s': '36px' } }, icon('user')),
        h('div.meta', h('b', a?.name ?? 'Zaloguj się'), h('small', a ? (a.needsLogin ? 'Sesja wygasła' : 'Konto Microsoft') : 'Konto Microsoft')),
        icon('chevron-down'),
      ),
      h('div.version-tag', `Hammer Launcher v${state.info?.version ?? ''}`),
    );
  }
  function accountMenu(anchor) {
    if (!state.accounts.length) return login();
    HS.menu(anchor, [
      ...state.accounts.map((a) => ({ node: HS.head(a, 24), label: a.name, hint: a.needsLogin ? 'wygasło' : null, on: a.id === state.account?.id, onClick: () => state.setSettings({ selectedAccount: a.id }).then(() => state.refreshAccounts()) })),
      '-',
      { icon: 'user-plus', label: 'Dodaj konto', onClick: login },
      { icon: 'gear', label: 'Zarządzaj kontami', onClick: () => go('settings') },
    ]);
  }

  /* ── router ── */
  function go(id) {
    if (!HS.views[id]) id = 'home';
    cleanup?.();
    cleanup = null;
    current = id;
    const view = document.getElementById('view');
    view.scrollTop = 0;
    try {
      cleanup = HS.views[id].render(view) ?? null;
    } catch (err) {
      console.error(err);
      clear(view, h('div.page', HS.empty('warning', 'Coś poszło nie tak', err.message)));
    }
    drawNav();
  }
  HS.go = go;

  /* ── login ── */
  let loggingIn = false;
  async function login() {
    if (loggingIn) return;
    loggingIn = true;
    toast('info', 'Otwieram okno logowania Microsoft…', 3000);
    try {
      const acc = await api.accounts.login();
      await state.refreshAccounts();
      toast('ok', `Zalogowano jako ${acc.name}. Miłej gry!`);
    } catch (err) {
      toast('err', err.message, 7000);
    } finally {
      loggingIn = false;
    }
  }
  HS.login = login;

  /* ── play / stop ── */
  /** `server` ("host:port") joins that server, `world` (a folder in saves/) opens that world, `join` the launcher's own server. */
  async function play(instanceId, { join = false, server = null, world = null, worldName = null } = {}) {
    if (!state.account) {
      toast('warning', 'Najpierw zaloguj się kontem Microsoft.');
      return login();
    }
    if (state.account.needsLogin) {
      toast('warning', 'Sesja wygasła – zaloguj się ponownie.');
      return login();
    }
    if (state.running.has(instanceId)) return;
    await state.selectInstance(instanceId);
    state.crashes.delete(instanceId);
    state.logs.set(instanceId, []);
    state.running.set(instanceId, 'preparing');
    state.progress.set(instanceId, { label: 'Przygotowanie…', percent: null });
    bus.emit('game');
    drawNav();
    try {
      const res = await api.game.launch(instanceId, { join, server, world });
      if (state.running.get(instanceId) === 'preparing') state.running.set(instanceId, 'starting');
      if (res?.memoryMb) toast('ok', `${server ? `Uruchamiam grę i łączę z ${server}` : 'Uruchamiam grę'} (${HS.fmt.mb(res.memoryMb)} RAM).`, 3000);
      // Minecraft older than 1.20 cannot open a world from the launcher.
      if (world && res && res.worldOpened === false) toast('info', `Ta wersja Minecrafta nie otwiera świata sama – wybierz „${worldName ?? world}” w grze: Tryb jednoosobowy.`, 9000);
    } catch (err) {
      state.running.delete(instanceId);
      toast('err', err.message, 8000);
      if (/zaloguj/i.test(err.message)) state.refreshAccounts();
    } finally {
      state.progress.delete(instanceId);
      bus.emit('game');
      drawNav();
    }
  }
  HS.play = play;
  HS.stop = (id) => attempt(() => api.game.stop(id));

  /* ── events from the launcher ── */
  api.on('game:progress', (p) => {
    state.progress.set(p.instanceId, p);
    bus.emit('game');
  });
  api.on('game:state', async (e) => {
    if (e.state === 'starting' || e.state === 'running') state.running.set(e.instanceId, e.state);
    else {
      state.running.delete(e.instanceId);
      if (e.state === 'crashed' && e.crash) {
        state.crashes.set(e.instanceId, e.crash);
        toast('err', `Gra się wyłączyła: ${e.crash.title}. Szczegóły w zakładce Konsola.`, 9000);
        if (current !== 'console') go('console');
      }
      await state.refreshInstances().catch(() => {});
    }
    bus.emit('game');
    drawNav();
  });
  api.on('game:log', (e) => {
    let list = state.logs.get(e.instanceId);
    if (!list) state.logs.set(e.instanceId, (list = []));
    list.push(e);
    if (list.length > 4000) list.splice(0, list.length - 4000);
    bus.emit('log', e);
  });
  let taskTimer = null;
  api.on('task:progress', (p) => {
    const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : null;
    clear(
      taskBox,
      h(
        'div.card',
        { style: { padding: '12px' } },
        h('div.row', { style: { gap: '8px', marginBottom: '8px', fontSize: '12px' } }, h('span.spinner'), h('b.ellipsis.grow', p.label ?? 'Pobieranie…'), pct != null ? h('span.dim', `${pct}%`) : null),
        h(`div.progress${pct == null ? '.indeterminate' : ''}`, h('i', { style: { '--w': `${pct ?? 0}%` } })),
      ),
    );
    clearTimeout(taskTimer);
    taskTimer = setTimeout(() => clear(taskBox), pct === 100 ? 1500 : 30000);
  });
  api.on('toast', (t) => toast(t.kind ?? 'info', t.text));

  bus.on('accounts', drawFoot);
  bus.on('settings', drawFoot);

  /* ── start ── */
  (async () => {
    try {
      state.info = await api.app.info();
      state.settings = await api.settings.get();
      state.accounts = await api.accounts.list();
      await state.refreshInstances();
      for (const id of await api.game.running()) state.running.set(id, 'running');
    } catch (err) {
      toast('err', err.message, 8000);
    }
    drawFoot();
    HS.community.discord().then(drawDiscordMini);
    setInterval(() => HS.community.discord().then(drawDiscordMini), 5 * 60_000);
    go('home');
    document.getElementById('app').classList.remove('booting');
    if (!state.instances.length) {
      try {
        const created = await api.instances.ensureDefault();
        if (created) {
          state.settings = await api.settings.get();
          await state.refreshInstances();
          toast('ok', `Gotowa instancja „${created.name}” (Minecraft ${created.mcVersion}). Kliknij GRAJ!`, 6000);
        }
      } catch (err) {
        toast('warning', `Nie udało się utworzyć instancji startowej: ${err.message}`, 7000);
      }
    }
  })();

  // Ctrl+1…9 switches tabs.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key) && NAV[Number(e.key) - 1]) {
      e.preventDefault();
      go(NAV[Number(e.key) - 1]);
    }
  });
})();
