'use strict';
/* Hammer Launcher – app shell: window buttons, sidebar, router, game events, PLAY / login. */

(() => {
  const { api, h, clear, icon, bus, state, toast, attempt } = HS;

  const NAV = ['home', 'instances', 'mods', 'servers', 'worlds', 'optimize', 'skin', 'gallery', 'console', 'settings'];
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

  /* ── Hammer+ in the title bar: a gold pill that leads to the Hammer+ page and shows when it is on ── */
  const pill = document.getElementById('tb-plus');
  pill.addEventListener('click', () => go('plus'));
  function drawPill() {
    const st = state.plus;
    const on = HS.plusOn();
    pill.classList.toggle('on', on);
    pill.title = on ? `Hammer+ jest aktywny ${HS.plusUi.until(st)}` : 'Hammer+ – zobacz, co daje';
    clear(pill, icon('crown'), h('span', 'Hammer+'), on ? icon('check') : null);
  }

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
        h(
          'div.meta',
          h('div.name', a ? HS.raw(h('b', a.name)) : h('b', 'Zaloguj się'), a && HS.plusOn() ? h('span.plus-badge', { title: 'Hammer+ jest aktywny na tym koncie', 'aria-label': 'Hammer+' }, '+') : null),
          h('small', a ? (a.needsLogin ? 'Sesja wygasła' : 'Konto Microsoft') : 'Konto Microsoft'),
        ),
        icon('chevron-down'),
      ),
      h('div.version-tag', `Hammer Launcher v${state.info?.version ?? ''}`, HS.betaPill()),
    );
  }
  function accountMenu(anchor) {
    if (!state.accounts.length) return login();
    HS.menu(anchor, [
      ...state.accounts.map((a) => ({ node: HS.head(a, 24), label: a.name, raw: true, hint: a.needsLogin ? 'wygasło' : null, on: a.id === state.account?.id, onClick: () => state.setSettings({ selectedAccount: a.id }).then(() => state.refreshAccounts()) })),
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
    bus.emit('view', id);
  }
  HS.go = go;
  /** Draws the open tab again where it is (after Hammer+ went on or off, or a copy from the cloud changed things). */
  HS.refreshView = () => {
    const view = document.getElementById('view');
    const top = view.scrollTop;
    go(current);
    view.scrollTop = top;
  };

  /* ── Hammer+ status: from the launcher at the start, and whenever it changes (a code, another account, the code ran out) ── */
  async function setPlus(st) {
    const was = HS.plusOn();
    state.plus = st;
    // The player's own background is only handed out while Hammer+ is active.
    state.backgroundUrl = st?.active ? ((await api.theme.background().catch(() => null))?.url ?? null) : null;
    HS.applyTheme();
    drawPill();
    drawFoot();
    bus.emit('plus', st);
    if (current && (was !== HS.plusOn() || current === 'plus')) HS.refreshView();
  }
  HS.setPlus = setPlus;
  api.on('plus:status', setPlus);
  /** A longer Hammer+ code (a renewal or a referral reward) is picked up from the shop by itself. */
  async function refreshPlus() {
    const res = await api.plus.renew?.().catch(() => null);
    if (!res?.renewed || !res.status?.active) return;
    await setPlus(res.status);
    toast('ok', res.status.until ? `Hammer+ przedłużony – działa do ${HS.fmt.date(res.status.until * 1000)}.` : 'Hammer+ przedłużony – działa teraz bezterminowo.', 7000);
  }
  HS.refreshPlus = refreshPlus;
  setTimeout(refreshPlus, 15_000);
  setInterval(refreshPlus, 6 * 3600_000);

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
  /**
   * `server` ("host:port") joins that server, `world` (a folder in saves/) opens that world, `join` the launcher's own server.
   * `benchmark` ({ seconds }) makes this start an FPS test in `world`: the game measures and closes by itself.
   */
  async function play(instanceId, { join = false, server = null, world = null, worldName = null, benchmark = null } = {}) {
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
    if (benchmark) {
      state.benchmarks.add(instanceId);
      state.benchResults.delete(instanceId);
    }
    bus.emit('game');
    drawNav();
    try {
      const res = benchmark ? await api.benchmark.start(instanceId, { world, worldName, seconds: benchmark.seconds }) : await api.game.launch(instanceId, { join, server, world });
      if (state.running.get(instanceId) === 'preparing') state.running.set(instanceId, 'starting');
      if (benchmark) toast('info', `Uruchamiam test FPS (${benchmark.seconds} s). Nie zamykaj gry – po pomiarze zamknie się sama.`, 7000);
      else if (res?.memoryMb) toast('ok', `${server ? `Uruchamiam grę i łączę z ${server}` : 'Uruchamiam grę'} (${HS.fmt.mb(res.memoryMb)} RAM).`, 3000);
      // Minecraft older than 1.20 cannot open a world from the launcher.
      if (world && res && res.worldOpened === false) toast('info', `Ta wersja Minecrafta nie otwiera świata sama – wybierz „${worldName ?? world}” w grze: Tryb jednoosobowy.`, 9000);
    } catch (err) {
      state.running.delete(instanceId);
      state.benchmarks.delete(instanceId);
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
    if (e.state === 'starting' || e.state === 'running') {
      state.running.set(e.instanceId, e.state);
      if (e.benchmark) state.benchmarks.add(e.instanceId); // an FPS test: the game closes by itself
    } else {
      state.running.delete(e.instanceId);
      state.benchmarks.delete(e.instanceId);
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

  /* ── Test FPS: the game of a test closed – the result (or why there is none) goes to the card in Optymalizacja ── */
  api.on('benchmark:done', (res) => {
    state.benchmarks.delete(res.instanceId);
    state.benchResults.set(res.instanceId, res);
    bus.emit('benchmark', res);
    bus.emit('game');
    const look = current === 'optimize' && state.instance?.id === res.instanceId ? null : { label: 'Zobacz wynik', onClick: () => HS.openBenchmark(res.instanceId) };
    if (res.ok) toast('ok', `Test FPS zakończony: średnio ${HS.fmt.fps(res.run.avg)} FPS${res.comparison ? ` (${res.comparison.text})` : ''}.`, 9000, look);
    else toast('warning', 'Test FPS nie został ukończony.', 9000, look ? { ...look, label: 'Zobacz dlaczego' } : null);
  });
  /** Opens Optymalizacja for an instance with the „Test FPS” card in view. */
  HS.openBenchmark = async (instanceId) => {
    if (instanceId && state.instance?.id !== instanceId) await state.selectInstance(instanceId);
    HS.benchUi.show();
    go('optimize');
  };

  /* ── „Podsumowanie gry” after a session, and mod updates found in the background ── */
  api.on('play:summary', (summary) => {
    state.playSummary = summary ?? null;
    bus.emit('summary', state.playSummary);
  });
  api.on('updates:status', (status) => {
    state.updates = status ?? { checkedAt: null, total: 0, instances: [] };
    bus.emit('updates', state.updates);
  });
  /** Opens the installed mods of an instance, where its updates are listed. */
  HS.openUpdates = async (instanceId) => {
    if (instanceId && state.instance?.id !== instanceId) await state.selectInstance(instanceId);
    HS.modsUi.open('installed');
    go('mods');
  };

  /* ── the shop's message: a bar under the title bar, on every screen ── */
  const alertBar = document.getElementById('alert-bar');
  const ALERT_ICONS = { info: 'bullhorn', warning: 'warning', critical: 'warning' };
  let alertTimer = null;
  function drawAlert() {
    clearTimeout(alertTimer);
    const a = state.feed?.alert;
    const left = a?.until != null ? a.until - Date.now() : null;
    if (!a || (left != null && left <= 0)) {
      alertBar.hidden = true;
      return clear(alertBar);
    }
    // Past its time the message goes by itself, also when the launcher just stays open.
    if (left != null) alertTimer = setTimeout(drawAlert, Math.min(left + 500, 2 ** 31 - 1));
    alertBar.className = `alert-bar ${a.level}`;
    alertBar.hidden = false;
    clear(
      alertBar,
      icon(ALERT_ICONS[a.level] ?? 'bullhorn'),
      HS.raw(h('div.txt', { title: a.text }, a.text)), // the shop's own words
      a.url ? h('button.btn.sm', { type: 'button', onclick: () => HS.open(a.url) }, 'Więcej', icon('external')) : null,
      // A critical message stays until the shop takes it down.
      a.level === 'critical'
        ? null
        : h(
            'button.btn.ghost.sm.icon',
            {
              type: 'button',
              title: 'Zamknij komunikat',
              'aria-label': 'Zamknij komunikat',
              onclick: () => {
                state.feed = { ...state.feed, alert: null };
                drawAlert();
                api.news
                  .closeAlert()
                  .then(setFeed)
                  .catch(() => {});
              },
            },
            icon('close'),
          ),
    );
  }
  /** Aktualności, the message and the newest version as the launcher knows them now. */
  function setFeed(feed) {
    if (!feed) return;
    state.feed = feed;
    drawAlert();
    bus.emit('feed', feed);
  }
  api.on('news:update', setFeed);

  /* ── the launcher's own update: the card on the start screen, Ustawienia, and the required-update window ── */
  function setSelfUpdate(st) {
    if (!st) return;
    state.selfUpdate = st;
    bus.emit('selfupdate', st);
    HS.updateUi.syncRequired();
  }
  HS.setSelfUpdate = setSelfUpdate;
  api.on('selfupdate:state', setSelfUpdate);
  bus.on('game', () => HS.updateUi.syncRequired());

  api.on('cloud:conflict', (c) => HS.plusUi.cloudConflict(c));
  api.on('cloud:synced', () => bus.emit('cloud'));

  bus.on('accounts', drawFoot);
  bus.on('settings', drawFoot);
  bus.on('settings', () => HS.applyTheme());

  /* ── start ── */
  (async () => {
    try {
      state.info = await api.app.info();
      state.settings = await api.settings.get();
      state.plus = state.info.plus ?? null;
      state.backgroundUrl = HS.plusOn() ? ((await api.theme.background().catch(() => null))?.url ?? null) : null;
      HS.applyTheme();
      state.accounts = await api.accounts.list();
      await state.refreshInstances();
      for (const id of await api.game.running()) state.running.set(id, 'running');
      for (const id of await api.benchmark.running()) state.benchmarks.add(id);
      state.playSummary = await api.play.summary();
      state.updates = await api.updates.status();
      state.selfUpdate = await api.selfUpdate.status();
    } catch (err) {
      toast('err', err.message, 8000);
    }
    // „BETA” right after the name in the title bar, and in the window's title.
    if (HS.isBeta()) {
      document.querySelector('.tb-brand span')?.after(HS.betaPill());
      document.title = `${state.info?.config?.name ?? 'Hammer Launcher'} (beta)`;
    }
    // Aktualności and the shop's message come in the background – the start never waits for the shop.
    api.news
      .feed()
      .then(setFeed)
      .catch(() => {});
    drawPill();
    drawFoot();
    HS.community.discord().then(drawDiscordMini);
    setInterval(() => HS.community.discord().then(drawDiscordMini), 5 * 60_000);
    go('home');
    document.getElementById('app').classList.remove('booting');
    HS.updateUi.syncRequired();
    if (!state.instances.length) {
      try {
        const created = await api.instances.ensureDefault();
        if (created) {
          state.settings = await api.settings.get();
          await state.refreshInstances();
          toast('ok', `Gotowa instancja „${created.name}” (Minecraft ${created.mcVersion}). Kliknij GRAJ!`, 6000);
          HS.officialUi.offerOptions(created); // the player's keys and settings from the official Minecraft, if there is one
        }
      } catch (err) {
        toast('warning', `Nie udało się utworzyć instancji startowej: ${err.message}`, 7000);
      }
    }
    // Chmura (Hammer+, when switched on): fetch what another computer sent. Quiet when there is nothing to say.
    api.cloud
      .startup()
      .then((res) => HS.plusUi.cloudResult(res, { auto: true }))
      .catch(() => {});
    // An invitation the launcher was started with (a click on hammer://join?…) – asked for once the window is ready.
    api.invite
      .pending()
      .then((link) => link && HS.inviteUi.fromLink(link))
      .catch(() => {});
  })();

  // An invitation clicked while the launcher is open: the window is in front already – ask the player.
  api.on('invite:link', (link) => HS.inviteUi.fromLink(link));

  /* ── a .hammerpack file dropped anywhere on the window opens its preview ── */
  const droppedRecipe = (e) => [...(e.dataTransfer?.files ?? [])].find((f) => /\.hammerpack$/i.test(f.name));
  const dragsFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  // (capture: the tabs with their own drop areas – Mody, Skórka – never see a recipe file)
  window.addEventListener('dragover', (e) => dragsFiles(e) && e.preventDefault());
  window.addEventListener(
    'drop',
    (e) => {
      const file = droppedRecipe(e);
      if (!file) return void (dragsFiles(e) && e.preventDefault()); // any other file: the tab's own handler, never a page load
      e.preventDefault();
      e.stopPropagation();
      // The tab's own drop area never hears about this drop – tell it the drag is over, so its highlight goes away.
      for (const el of document.querySelectorAll('.dragging')) for (let n = 0; n < 8; n += 1) el.dispatchEvent(new Event('dragleave'));
      const filePath = api.pathForFile(file);
      if (filePath) HS.shareUi.openFile(filePath);
      else toast('err', 'Nie udało się odczytać upuszczonego pliku.');
    },
    true,
  );

  // Ctrl+1…9 switches tabs, Ctrl+0 opens the tenth.
  document.addEventListener('keydown', (e) => {
    const tab = /^[0-9]$/.test(e.key) ? NAV[(Number(e.key) + 9) % 10] : null;
    if ((e.ctrlKey || e.metaKey) && tab) {
      e.preventDefault();
      go(tab);
    }
  });
})();
