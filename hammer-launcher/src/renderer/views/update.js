'use strict';
/* Aktualizacje launchera – the pieces the other screens use: the card on the start screen (a new version is
   there, is downloading, is ready), the block in Ustawienia and the window „Wymagana aktualizacja”.
   The state comes from the launcher (state.selfUpdate – see src/main/selfupdate.js); nothing is decided here. */

(() => {
  const { api, h, clear, icon, bus, state, attempt } = HS;

  const GAME = 'Najpierw zamknij grę – aktualizacja uruchamia launcher ponownie.';
  const now = () => state.selfUpdate ?? { status: 'off', supported: false, reason: 'dev', current: state.info?.version ?? '', latest: null, percent: null, notes: null, error: null, upToDate: false, auto: true, gameRunning: false, release: null, required: null };
  /** A game runs or is being started – the launcher must not restart now. */
  const playing = (s) => Boolean(s.gameRunning) || state.running.size > 0;
  const take = (res) => res && HS.setSelfUpdate(res);

  /** Why this build does not update itself (the portable exe, a development run, another kind of package). */
  function whyNot(s) {
    if (s.status === 'off' && s.supported) return 'Aktualizacje nie są ustawione w tej wersji launchera.';
    if (s.reason === 'dev') return 'Wersja deweloperska nie aktualizuje się sama.';
    if (s.reason === 'portable') return 'Wersja przenośna nie aktualizuje się sama – nową pobierzesz ze strony.';
    return 'Ta wersja launchera nie aktualizuje się sama – nową pobierzesz ze strony.';
  }

  /** One line: where the update stands. */
  function stateText(s) {
    if (s.status === 'checking') return 'Sprawdzam…';
    if (s.status === 'available') return `Dostępna jest wersja ${s.latest}`;
    if (s.status === 'downloading') return `Pobieram ${s.percent ?? 0}%`;
    if (s.status === 'ready') return `Aktualizacja ${s.latest} jest gotowa`;
    if (s.status === 'error') return s.error;
    if (s.status === 'idle') return s.upToDate ? 'Masz najnowszą wersję' : 'Jeszcze nie sprawdzano';
    return s.release ? `Dostępna jest wersja ${s.release.version}` : whyNot(s);
  }

  /* ── buttons ── */
  const run = (call) => (e) => HS.busy(e.currentTarget, async () => take(await attempt(call)));
  /** „Uruchom ponownie i zaktualizuj” – grey, with the reason, while a game runs. */
  const restartBtn = (s, cls = 'btn.primary', text = 'Uruchom ponownie i zaktualizuj') => h(`button.${cls}`, { type: 'button', disabled: playing(s), title: playing(s) ? GAME : null, onclick: run(() => api.selfUpdate.install()) }, icon('refresh'), h('span', text));
  const downloadBtn = (cls = 'btn.primary') => h(`button.${cls}`, { type: 'button', onclick: run(() => api.selfUpdate.download()) }, icon('download'), h('span', 'Pobierz i zainstaluj'));
  /** For builds that cannot replace themselves: the page with the new version, in the browser. */
  const pageBtn = (s, cls = 'btn.primary', text = 'Pobierz ze strony') => (s.release?.url ? h(`button.${cls}`, { type: 'button', onclick: () => HS.open(s.release.url) }, icon('external'), h('span', text)) : null);
  const bar = (percent) => h(`div.progress${percent == null ? '.indeterminate' : ''}`, h('i', { style: { '--w': `${percent ?? 0}%` } }));
  /** „Co nowego”: the release notes, as plain text (they are the owner's words, not the launcher's). */
  const notesBox = (text) => (text ? h('div.update-notes', h('small', 'Co nowego'), HS.raw(h('p', text))) : null);

  /* ── the card on the start screen ── */
  function homeCard() {
    const el = h('div');
    function draw() {
      const s = now();
      const card = (title, sub, actions, more) =>
        clear(el, h('section.card.update-card', h('div.update-top', h('div.why-icon', icon('arrow-up')), h('div.grow', h('b', title), sub ? h('small', sub) : null), actions ? h('div.update-acts', actions) : null), more ?? null, notesBox(s.notes)));
      if (s.required) return clear(el); // the window „Wymagana aktualizacja” says it all
      if (s.status === 'ready') return card(`Nowa wersja ${s.latest} jest gotowa`, playing(s) ? 'Zainstaluje się, gdy skończysz grać – gra nigdy nie zostanie przerwana.' : 'Pobrała się w tle. Zaktualizuj teraz albo zostaw – zainstaluje się sama, gdy zamkniesz okno launchera.', restartBtn(s, 'btn.primary', 'Zaktualizuj teraz'));
      if (s.status === 'downloading') return card(`Pobieram aktualizację ${s.latest}`, `${s.percent ?? 0}% – możesz normalnie grać, pobieranie idzie w tle.`, null, bar(s.percent ?? 0));
      if (s.status === 'available' && !s.auto) return card(`Dostępna jest wersja ${s.latest}`, `Masz wersję ${s.current}. Automatyczne aktualizacje są wyłączone.`, downloadBtn());
      // A build that cannot replace itself only tells – the button leads to the download page.
      if ((s.status === 'unsupported' || s.status === 'off') && s.release) return card(`Dostępna jest wersja ${s.release.version}`, `Masz wersję ${s.current}. ${whyNot(s)}`, pageBtn(s));
      return clear(el);
    }
    draw();
    const offs = [bus.on('selfupdate', draw), bus.on('game', draw)];
    return { el, stop: () => offs.forEach((f) => f()) };
  }

  /* ── Ustawienia → Aktualizacje launchera ── */
  function settingsCard() {
    const card = h('section.card');
    const row = (title, text, ctl) => h('div.set-row', h('div.txt', h('b', title), text ? h('small', text) : null), h('div.ctl', ctl));
    function draw() {
      const s = now();
      const active = s.status !== 'off' && s.status !== 'unsupported';
      const busyNow = s.status === 'checking' || s.status === 'downloading';
      const check = h('button.btn', { type: 'button', disabled: busyNow, onclick: run(() => api.selfUpdate.check()) }, icon('refresh'), h('span', 'Sprawdź teraz'));
      const action = s.status === 'ready' ? restartBtn(s) : s.status === 'available' && !s.auto ? downloadBtn() : !active ? pageBtn(s) : null;
      const toggle = HS.toggle(s.auto, async (v) => {
        if (!(await attempt(() => state.setSettings({ autoUpdate: v })))) toggle.querySelector('input').checked = !v;
        take(await api.selfUpdate.status().catch(() => null));
      });
      // Windows: the launcher can live in the tray and start with the system – that is where it updates itself.
      const bg = state.info?.background ?? {};
      const flag = (key) => {
        const t = HS.toggle(state.settings?.[key] !== false, async (v) => {
          if (!(await attempt(() => state.setSettings({ [key]: v })))) t.querySelector('input').checked = !v;
        });
        return t;
      };
      clear(
        card,
        h('div.card-head', icon('arrow-up'), h('h2', 'Aktualizacje launchera')),
        row(`${state.info?.config?.name ?? 'Hammer Launcher'} ${s.current}`, null, h('div.row', action, check)),
        h(`p.update-state${s.status === 'error' ? '.warn' : ''}`, { role: 'status' }, s.status === 'checking' || s.status === 'downloading' ? h('span.spinner') : icon(s.status === 'error' ? 'warning' : s.status === 'ready' || (s.status === 'idle' && s.upToDate) ? 'check-circle' : 'info'), h('span', stateText(s))),
        s.status === 'downloading' ? bar(s.percent ?? 0) : null,
        s.status === 'ready' && playing(s) ? h('p.hint', GAME) : null,
        !active && s.release ? h('p.hint', whyNot(s)) : null,
        active ? row('Aktualizuj automatycznie', 'Launcher sam pobiera nową wersję w tle i instaluje ją, gdy nie grasz, a jego okno jest zamknięte – nigdy w trakcie gry. Wyłączone: tylko powie, że jest nowa wersja.', toggle) : null,
        bg.startWithSystem ? row('Uruchamiaj razem z Windows', 'Launcher startuje w tle – ikona obok zegara – i pobiera aktualizacje, zanim go otworzysz. Okno pojawi się dopiero po kliknięciu ikony.', flag('startWithSystem')) : null,
        bg.tray ? row('Zamknięcie okna zostawia launcher w tle', 'Krzyżyk chowa launcher do zasobnika obok zegara – tam sam się aktualizuje, gdy nie grasz. Całkiem zamkniesz go z menu tej ikony.', flag('closeToTray')) : null,
      );
    }
    draw();
    const offs = [bus.on('selfupdate', draw), bus.on('game', draw)];
    return { el: card, stop: () => offs.forEach((f) => f()) };
  }

  /* ── „Wymagana aktualizacja”: this version is no longer supported – nothing else can be done until it is updated ── */
  let must = null; // the window while it is up: { overlay, body, foot }

  function drawRequired(s) {
    const active = s.status !== 'off' && s.status !== 'unsupported';
    const working = s.status === 'checking' || s.status === 'downloading';
    const game = playing(s);
    clear(
      must.body,
      h('p', `Ta wersja launchera (${s.current}) nie jest już wspierana.`),
      h('p.muted', `Zaktualizuj launcher do wersji ${s.required.version}, żeby grać dalej. Twoje instancje, światy i ustawienia zostają bez zmian.`),
      notesBox(s.notes),
      active && s.status === 'downloading' ? h('div.task-bar', h('div.label', h('b', `Pobieram aktualizację ${s.latest ?? s.required.version}`), h('span', `${s.percent ?? 0}%`)), bar(s.percent ?? 0)) : null,
      active && s.status === 'checking' ? h('div.task-bar', h('div.label', h('b', 'Sprawdzam…')), bar(null)) : null,
      active && s.status === 'ready' && !game ? h('p.hint', `Aktualizacja ${s.latest} jest gotowa – launcher uruchomi się ponownie.`) : null,
      active && s.status === 'error' ? h('p.cloud-note.warn', icon('warning'), s.error) : null,
      !active ? h('p.hint', whyNot(s)) : null,
      active && game ? h('p.cloud-note', icon('info'), GAME) : null,
    );
    const update = h('button.btn.primary', { type: 'button', disabled: game || working, onclick: run(() => api.selfUpdate.update()) }, working ? h('span.spinner') : icon('arrow-up'), h('span', 'Zaktualizuj teraz'));
    clear(
      must.foot,
      // The download page is the way out when the launcher cannot update itself – or when its own update fails.
      active ? (s.status === 'error' ? pageBtn(s, 'btn.ghost') : null) : null,
      active ? update : (pageBtn(s, 'btn.primary', 'Pobierz nową wersję') ?? h('span.hint', 'Pobierz nową wersję ze strony HammerShop.')),
    );
  }

  /** Opens, redraws or closes the window – whatever the launcher's state asks for. */
  function syncRequired() {
    const s = now();
    const shell = document.querySelector('.shell');
    if (!s.required) {
      if (!must) return;
      must.overlay.remove();
      must = null;
      if (shell) shell.inert = false;
      return;
    }
    if (!must) {
      const body = h('div.modal-body.scroll');
      const foot = h('div.modal-foot');
      // No close button and no Escape: the title bar stays free, so the window can still be minimised or closed.
      const box = h('div.modal', { role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Wymagana aktualizacja' }, h('div.modal-head', icon('arrow-up'), h('h2', 'Wymagana aktualizacja')), body, foot);
      must = { overlay: h('div.overlay.must', box), body, foot };
      document.getElementById('modal-root').append(must.overlay);
      if (shell) shell.inert = true; // nothing behind the window takes clicks or the keyboard
    }
    drawRequired(s);
  }

  /* ── „Co nowego”: once, the first time the window opens after the launcher updated itself ── */
  async function whatsNew() {
    if (state.whatsNewAsked) return; // once per window
    state.whatsNewAsked = true;
    const news = await api.selfUpdate.whatsNew().catch(() => null);
    if (!news?.version || must) return;
    const ok = h('button.btn.primary', { type: 'button' }, icon('check'), h('span', 'Super, gramy!'));
    const m = HS.modal({
      title: 'Co nowego',
      icon: 'sparkles',
      body: [
        h('div.whats-new-top', h('div.why-icon', icon('rocket')), h('div', h('b', `Hammer Launcher ${news.version}`), h('small', news.from ? `Launcher zaktualizował się z wersji ${news.from}.` : 'Launcher zaktualizował się do nowej wersji.'))),
        news.notes ? h('div.whats-new-notes', HS.raw(h('p', news.notes))) : h('p.muted', 'Szczegóły znajdziesz w aktualnościach i na naszym Discordzie.'),
      ],
      foot: ok,
      onClose: () => api.selfUpdate.seen().catch(() => null),
    });
    ok.onclick = () => m.close();
  }

  HS.updateUi = { homeCard, settingsCard, syncRequired, stateText, whatsNew };
})();
