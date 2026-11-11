'use strict';
/* Hammer+ – the page behind the gold button in the title bar (what it gives, the code, backgrounds, the cloud), and
   the pieces the other tabs use for their Hammer+ parts: the "locked" marker, the settings rows, the cloud box. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  const when = (ms) => new Date(ms).toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' });
  /** "do 11 grudnia 2026" or "bezterminowo" – how long the active code lasts. */
  const until = (st) => (st?.until ? `do ${fmt.date(st.until * 1000)}` : 'bezterminowo');

  /** The marker on everything that needs Hammer+: a small gold button that opens the Hammer+ page. */
  function lockChip(text = 'Hammer+') {
    return h('button.chip.plus-chip', { type: 'button', title: 'To jest w Hammer+ – kliknij, żeby zobaczyć, co daje', onclick: (e) => (e.stopPropagation(), HS.go('plus')) }, icon('lock'), text);
  }

  /** A control that only works with Hammer+: without it the control is dimmed and a click on it opens the Hammer+ page. */
  function locked(control) {
    if (HS.plusOn()) return control;
    for (const el of [control].flat(Infinity)) if (el instanceof HTMLElement) el.inert = true;
    const wrap = h('div.plus-locked', { role: 'button', tabindex: '0', title: 'To jest w Hammer+ – kliknij, żeby zobaczyć, co daje', 'aria-label': 'Funkcja Hammer+ – zobacz, co daje' }, control);
    wrap.addEventListener('click', () => HS.go('plus'));
    wrap.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), HS.go('plus')));
    return wrap;
  }

  /** A settings row for a Hammer+ feature: the usual title / text / control, with the gold marker while it is locked. */
  function row(title, text, control) {
    return h('div.set-row', h('div.txt', h('b', title, HS.plusOn() ? null : lockChip()), text ? h('small', text) : null), h('div.ctl', locked(control)));
  }

  /** Opens a tab and scrolls to the card with that heading (the card may appear a moment later). */
  function goTo(view, heading) {
    HS.go(view);
    if (!heading) return;
    let tries = 0;
    const find = () => {
      const card = [...document.querySelectorAll('#view h2')].find((el) => el.textContent.trim().startsWith(heading))?.closest('.card');
      if (card) document.getElementById('view').scrollTop = card.offsetTop - 16;
      else if ((tries += 1) < 25) setTimeout(find, 100);
    };
    find();
  }

  /* ── pictures: the launcher background and the background of the menus in the game ── */
  const thumb = (url) => h('div.picture-thumb', { style: url ? { backgroundImage: `url("${url}")` } : null }, url ? null : icon('image'));

  /** One picture control: a small preview, "Wybierz obraz" / "Zmień" and "Usuń". get() → url, pick() and drop() → { url } | null. */
  function pictureControl({ get, pick, drop, what }) {
    const el = h('div.picture-ctl');
    let url = null;
    const draw = () =>
      clear(
        el,
        thumb(url),
        h(
          'button.btn.sm',
          {
            type: 'button',
            onclick: (e) =>
              HS.busy(e.currentTarget, async () => {
                const res = await attempt(() => pick());
                if (!res) return; // an error (shown) or the dialog was closed
                url = res.url;
                draw();
              }),
          },
          icon('image'),
          h('span', url ? 'Zmień' : 'Wybierz obraz'),
        ),
        url
          ? h(
              'button.btn.ghost.sm.icon.danger',
              {
                type: 'button',
                title: `Usuń ${what}`,
                'aria-label': `Usuń ${what}`,
                onclick: async () => {
                  const res = await attempt(() => drop());
                  if (!res) return;
                  url = null;
                  draw();
                },
              },
              icon('trash'),
            )
          : null,
      );
    draw();
    Promise.resolve(get()).then((value) => ((url = value ?? null), draw()), () => {});
    return el;
  }

  /** The two rows "Własne tło launchera" and "Tło menu w grze" (Ustawienia → Wygląd and the Hammer+ page). */
  function backgroundRows() {
    const launcher = pictureControl({
      what: 'tło launchera',
      get: () => state.backgroundUrl,
      pick: async () => {
        const res = await api.theme.pickBackground();
        if (res) applyBackground(res);
        return res;
      },
      drop: async () => {
        const res = await api.theme.clearBackground();
        applyBackground(res);
        return res;
      },
    });
    const menu = pictureControl({
      what: 'tło menu w grze',
      get: () => (HS.plusOn() ? api.theme.menuBackground().then((res) => res.url) : null),
      pick: () => api.theme.pickMenuBackground(),
      drop: () => api.theme.clearMenuBackground(),
    });
    return [
      row('Własne tło launchera', 'Twoje zdjęcie albo zrzut ekranu, przyciemnione, za stronami launchera. Launcher kopiuje je do swojego folderu.', launcher),
      row('Tło menu w grze', 'Twój obraz za menu Hammer Client. W grze wybierz: Hammer Mody → Ustawienia → Tło menu → Własny obraz.', menu),
    ];
  }
  function applyBackground(res) {
    state.settings = res.settings;
    state.backgroundUrl = res.url;
    bus.emit('settings', state.settings);
  }

  /* ── automatic world backups ── */
  /** The row "Automatyczne kopie światów" (Ustawienia and the Światy tab): how many to keep, and the switch. */
  function autoBackupRow() {
    const s = state.settings;
    const keep = HS.select(
      Array.from({ length: 20 }, (_, i) => ({ value: i + 1, label: `${i + 1} ${fmt.plural(i + 1, 'najnowszą', 'najnowsze', 'najnowszych')}` })),
      s.autoBackupKeep ?? 5,
      (v) => attempt(() => state.setSettings({ autoBackupKeep: Number(v) })),
    );
    keep.classList.add('narrow');
    keep.setAttribute('aria-label', 'Ile automatycznych kopii każdego świata zostawić');
    const sw = HS.toggle(HS.plusOn() && s.autoBackup, async (v) => {
      if (!(await attempt(() => state.setSettings({ autoBackup: v })))) sw.querySelector('input').checked = !v;
    });
    return row('Automatyczne kopie światów', 'Po każdej grze launcher sam pakuje światy, w których grałeś. Starsze automatyczne kopie znikają, zrobione ręcznie zostają.', h('div.row', h('span.dim', { style: { fontSize: '12.5px' } }, 'Zostaw'), keep, sw));
  }

  /* ── the cloud ── */
  const holds = (x) => `${fmt.count(x.instances, 'instancja', 'instancje', 'instancji')}, ${fmt.count(x.servers, 'serwer', 'serwery', 'serwerów')}`;
  let asking = false;

  /** Two copies differ (this computer's and the cloud's): the player picks which one stays. */
  function cloudConflict(c) {
    if (asking) return;
    asking = true;
    const keepCloud = h('button.btn.primary', { type: 'button' }, icon('cloud-down'), 'Zostaw tę z chmury');
    const keepLocal = h('button.btn', { type: 'button' }, icon('upload'), 'Zostaw tę z tego komputera');
    const m = HS.modal({
      title: 'W chmurze jest inna kopia',
      icon: 'cloud',
      body: h(
        'div.form',
        h('p.muted', `W chmurze leży kopia, której ten komputer nie zna${c.at ? ` – z ${when(c.at)}` : ''}. Najpewniej wysłał ją Twój drugi komputer. Którą zostawić?`),
        h(
          'div.copy-pick',
          h('div.copy', h('div.why-icon', icon('cloud')), h('b', 'Kopia z chmury'), h('small', holds(c.cloud)), keepCloud),
          h('div.copy', h('div.why-icon', icon('monitor')), h('b', 'Ten komputer'), h('small', holds(c.local)), keepLocal),
        ),
        h('p.hint', 'Druga kopia zostanie zastąpiona. Chodzi tylko o wygląd launchera, listy serwerów i układ HUD – światy, mody i konta zostają nietknięte.'),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Zdecyduję później')],
      wide: false,
      onClose: () => (asking = false),
    });
    const choose = (btn, call, opts) =>
      HS.busy(btn, async () => {
        const res = await attempt(call);
        if (!res) return;
        m.close();
        await cloudResult(res, opts);
      });
    keepCloud.onclick = () => choose(keepCloud, () => api.cloud.pull());
    keepLocal.onclick = () => choose(keepLocal, () => api.cloud.push({ force: true, baseUpdatedAt: c.updatedAt }));
  }

  /**
   * Shows what a cloud call answered. `auto` = the launcher asked by itself (at the start): then only news is
   * shown – a copy that was fetched or a question – never "the shop is offline".
   */
  async function cloudResult(res, { auto = false } = {}) {
    if (!res || res.skipped === true) return;
    bus.emit('cloud');
    if (res.conflict) return void cloudConflict(res);
    if (res.offline) return void (auto || HS.toast('info', res.note, 6500));
    if (res.upToDate) return void (auto || HS.toast('ok', 'Kopia w chmurze jest aktualna.'));
    if (res.empty) return void (auto || HS.toast('info', 'W chmurze nie ma jeszcze żadnej kopii. Kliknij „Wyślij do chmury”, żeby zrobić pierwszą.', 6500));
    if (!res.ok) return;
    if (!Array.isArray(res.changed)) return void HS.toast('ok', 'Kopia jest w chmurze.');
    // A copy was taken: the look, server lists and HUD layouts may be different now.
    state.settings = await api.settings.get();
    bus.emit('settings', state.settings);
    const waiting = res.skipped?.length ? ` ${res.skipped.length === 1 ? `Instancja „${res.skipped[0]}” jest w grze, więc została` : `Instancje ${res.skipped.map((n) => `„${n}”`).join(', ')} są w grze, więc zostały`} bez zmian – pobierz ponownie po zamknięciu gry.` : '';
    HS.toast(waiting ? 'warning' : 'ok', `${auto ? 'Pobrano z chmury nowszą kopię z innego komputera.' : 'Pobrano kopię z chmury.'}${waiting}`, waiting ? 9000 : 5000);
    HS.refreshView();
  }

  /** The Chmura box: when the last copy was made, "Wyślij do chmury" / "Pobierz z chmury" and the automatic sync. */
  function cloudBox() {
    const box = h('div.cloud-box');
    let status = null;
    async function load() {
      status = await api.cloud.status().catch(() => null);
      draw();
    }
    function draw() {
      const last = status?.last;
      const send = h('button.btn.primary', { type: 'button' }, icon('upload'), 'Wyślij do chmury');
      const fetchBtn = h('button.btn', { type: 'button' }, icon('cloud-down'), 'Pobierz z chmury');
      send.onclick = () =>
        HS.busy(send, async () => {
          await cloudResult(await attempt(() => api.cloud.push()));
          await load();
        });
      fetchBtn.onclick = async () => {
        if (!(await HS.confirmDialog({ title: 'Pobrać kopię z chmury?', text: 'Wygląd launchera, listy serwerów i układ HUD na tym komputerze staną się takie jak w kopii. Serwery, których w kopii nie ma, znikną z list. Światy i mody zostają nietknięte.', confirm: 'Pobierz' }))) return;
        HS.busy(fetchBtn, async () => {
          await cloudResult(await attempt(() => api.cloud.pull()));
          await load();
        });
      };
      const auto = HS.toggle(Boolean(status?.auto), async (v) => {
        if (!(await attempt(() => state.setSettings({ cloudAuto: v })))) auto.querySelector('input').checked = !v;
      });
      clear(
        box,
        h(
          'div.cloud-state',
          h('div.why-icon', icon('cloud')),
          h(
            'div.grow',
            h('b', last ? `Ostatnia kopia: ${when(last.at)}` : 'Nie masz jeszcze kopii w chmurze'),
            h('small', last ? (last.direction === 'pull' ? 'pobrana na ten komputer' : 'wysłana z tego komputera') : 'Wyślij pierwszą, żeby mieć swoje ustawienia na innym komputerze.'),
          ),
        ),
        status?.note ? h('p.cloud-note', icon('info'), status.note) : null,
        h('div.cloud-acts', send, fetchBtn),
        h('label.cloud-auto', auto, h('div', h('b', 'Synchronizuj automatycznie'), h('small', 'Pobiera przy starcie launchera, wysyła po każdej grze.'))),
        h('p.hint', 'W kopii: wygląd launchera oraz lista serwerów i układ HUD każdej instancji (po nazwie instancji). Światy, mody i konta zostają tylko na komputerze.'),
      );
    }
    draw();
    load();
    const off = bus.on('cloud', () => (box.isConnected ? load() : off()));
    return box;
  }

  /* ── the page ── */
  let capeCount = null; // how many Hammer+ capes this launcher has – asked once

  const PERKS = () => [
    { icon: 'palette', title: 'Własny kolor i animowane tła', text: 'Dowolny kolor launchera – nie tylko 6 gotowych – oraz 3 animowane tła: Zorza, Kuźnia i Gwiazdy.', go: ['settings', 'Wygląd'] },
    { icon: 'images', title: 'Własne obrazy w tle', text: 'Twoje zdjęcie za stronami launchera i osobne za menu Hammer Client w grze.', go: ['settings', 'Wygląd'] },
    { icon: 'archive', title: 'Automatyczne kopie światów', text: 'Po każdej grze launcher sam pakuje światy, w których grałeś, i trzyma 5 najnowszych kopii każdego (ustawisz od 1 do 20).', go: ['worlds', 'Kopie zapasowe'] },
    { icon: 'shirt', title: 'Biblioteka na 200 skórek', text: 'Bez Hammer+ launcher pamięta 24 ostatnie skórki.', go: ['skin', 'Twoje skórki'] },
    { icon: 'outfit', title: 'Zestawy', text: 'Skórka, model postaci i peleryna pod jedną nazwą – zakładasz wszystko jednym kliknięciem.', go: ['skin', 'Zestawy'] },
    { icon: 'crown', title: 'Peleryny Hammer+', text: `${capeCount ? `${fmt.count(capeCount, 'peleryna', 'peleryny', 'peleryn')} do wyboru` : 'Peleryny do wyboru'}. Widzą je gracze z Hammer Client – w zwykłym Minecrafcie ich nie widać.`, go: ['skin', 'Peleryny Hammer+'] },
    { icon: 'cloud', title: 'Chmura', text: 'Wygląd launchera, listy serwerów i układ HUD na każdym Twoim komputerze. Zacznie działać, gdy sklep HammerShop będzie online.', go: null },
  ];

  function render(root) {
    const st = state.plus ?? { active: false, reason: 'none', text: '', configured: true, hasCode: false };
    const on = Boolean(st.active);
    const shopUrl = state.info?.config?.shopUrl;
    const buy = shopUrl ? h('button.btn.gold', { type: 'button', onclick: () => HS.open(shopUrl) }, icon('store'), on ? 'Przedłuż w sklepie' : 'Kup w sklepie') : null;

    /* the code */
    const input = h('input.input.code', { placeholder: 'HP1.…', spellcheck: false, autocomplete: 'off', 'aria-label': 'Kod Hammer+', disabled: !st.configured });
    const activate = h('button.btn.primary', { type: 'button', disabled: !st.configured }, icon('check'), 'Aktywuj');
    activate.onclick = () =>
      HS.busy(activate, async () => {
        if (!input.value.trim()) return void HS.toast('warning', 'Wklej kod, który dostałeś od bota HammerShop.');
        const res = await attempt(() => api.plus.activate(input.value));
        if (!res) return;
        HS.toast(res.active ? 'ok' : 'warning', res.active ? `Hammer+ jest aktywny ${until(res)}. Miłej zabawy!` : res.text, res.active ? 5000 : 9000);
        await HS.setPlus(res); // draws this page again
      });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && activate.click());
    const paste = h(
      'button.btn',
      {
        type: 'button',
        disabled: !st.configured,
        title: 'Wklej kod ze schowka',
        onclick: async () => {
          const text = await attempt(() => api.plus.paste());
          if (text === undefined) return;
          if (!text) return void HS.toast('info', 'Schowek jest pusty – skopiuj kod z wiadomości bota.');
          input.value = text;
          input.focus();
        },
      },
      icon('paste'),
      'Wklej',
    );
    const remove = st.hasCode
      ? h(
          'button.btn.ghost.sm.danger',
          {
            type: 'button',
            onclick: async () => {
              if (!(await HS.confirmDialog({ title: 'Usunąć kod Hammer+?', text: on ? 'Hammer+ wyłączy się na tym komputerze. Kod nadal jest ważny – możesz go wkleić ponownie, tutaj albo na innym komputerze.' : 'Launcher zapomni zapisany kod. Możesz go potem wkleić ponownie.', confirm: 'Usuń kod', danger: true }))) return;
              const res = await attempt(() => api.plus.remove());
              if (res) await HS.setPlus(res);
            },
          },
          icon('trash'),
          'Usuń kod',
        )
      : null;
    const codeCard = h(
      'section.card',
      h('div.card-head', icon('key'), h('h2.grow', 'Mam kod'), remove),
      h('p.muted', { style: { fontSize: '12.5px', marginBottom: '12px' } }, on ? 'Masz nowy kod, np. po przedłużeniu? Wklej go tutaj.' : 'Kod wysyła bot HammerShop na Discordzie po zakupie. Jest przypisany do Twojego konta Minecraft, a launcher sprawdza go sam – bez internetu.'),
      h('div.code-row', input, paste, activate),
      st.configured ? null : h('p.cloud-note', icon('warning'), st.text),
      st.hasCode && st.account ? h('p.hint', { style: { marginTop: '10px' } }, on ? `Zapisany kod: konto ${st.account.name}, ważny ${until(st)}.` : `Zapisany kod jest dla konta ${st.account.name ?? 'innego niż wybrane'}.`) : null,
    );

    /* what it gives */
    const perksBox = h('div.why');
    const drawPerks = () =>
      clear(
        perksBox,
        PERKS().map((p) =>
          h(
            'div.why-item.perk',
            h('div.why-icon.gold', icon(p.icon)),
            h('div.grow', h('b', p.title), h('p', p.text)),
            p.go ? h('button.btn.ghost.sm.icon', { type: 'button', title: 'Pokaż w launcherze', 'aria-label': `Pokaż w launcherze: ${p.title}`, onclick: () => goTo(...p.go) }, icon('chevron-right')) : null,
          ),
        ),
      );
    drawPerks();
    if (capeCount == null) {
      api.plus
        .capes()
        .then((res) => ((capeCount = res.capes.length), perksBox.isConnected && drawPerks()))
        .catch(() => {});
    }

    const headline = on ? 'Hammer+ jest aktywny' : st.reason === 'none' ? 'Więcej wyglądu i wygody' : 'Hammer+ nie jest teraz aktywny';
    const lead = on ? 'Dziękujemy, że wspierasz HammerShop! Wszystko poniżej jest odblokowane.' : st.reason === 'none' ? 'Własne kolory i tła, automatyczne kopie światów, zestawy skórek, peleryny i chmura. Tylko wygląd i wygoda – nic, co daje przewagę w grze.' : st.text;

    clear(
      root,
      h(
        'div.page.plus-page',
        h(
          `section.plus-hero${on ? '.on' : ''}`,
          h('div.plus-mark', icon('crown')),
          h(
            'div.grow',
            h('div.eyebrow', 'Hammer+'),
            h('h1', headline),
            h(`p${!on && st.reason !== 'none' ? '.warn' : ''}`, lead),
            on ? h('div.chips', HS.chip(`Aktywny ${until(st)}`, 'gold', 'check'), HS.chip(st.account.name, null, 'user')) : null,
          ),
          h('div.plus-acts', buy, on ? null : h('button.btn', { type: 'button', onclick: () => input.focus() }, icon('key'), 'Mam kod')),
        ),
        h(
          `div.plus-cols${on ? '.on' : ''}`,
          h(
            'div.grid',
            h('section.card', h('div.card-head', icon('star'), h('h2', 'Co dostajesz')), perksBox, h('p.hint', { style: { marginTop: '12px' } }, 'Wszystko, co do tej pory było w launcherze za darmo, zostaje za darmo. Rangi na Discordzie i wcześniejszy dostęp nie są częścią Hammer+.')),
          ),
          h(
            'div.grid',
            codeCard,
            on ? h('section.card', h('div.card-head', icon('images'), h('h2', 'Twoje tła')), backgroundRows()) : null,
            on ? h('section.card', h('div.card-head', icon('cloud'), h('h2', 'Chmura')), cloudBox()) : null,
          ),
        ),
      ),
    );
    return undefined;
  }

  HS.plusUi = { until, lockChip, locked, row, goTo, backgroundRows, autoBackupRow, cloudBox, cloudResult, cloudConflict };
  HS.views.plus = { title: 'Hammer+', icon: 'crown', render };
})();
