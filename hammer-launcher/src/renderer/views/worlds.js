'use strict';
/* Światy – the singleplayer worlds of an instance: play, back up, rename, remove – and the backups themselves,
   also the ones the launcher makes by itself after each game session (Hammer+), with a world put back to an
   earlier version in place: „Przywróć wczorajszą wersję”, „Inna wersja…” and „Cofnij” (Kopia zapasowa światów). */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  const MODES = { 0: ['Przetrwanie', null, 'heart'], 1: ['Kreatywny', 'accent', 'magic'], 2: ['Przygoda', null, 'compass'], 3: ['Widz', null, 'eye'] };
  const when = (ts) => new Date(ts).toLocaleString(HS.locale(), { dateStyle: 'long', timeStyle: 'short' });
  const sizeOf = (w) => `${w.sizePartial ? 'ponad ' : ''}${fmt.size(w.size)}`;

  /* ── Kopia zapasowa światów: when a version is from ── */
  const time = (ts) => new Date(ts).toLocaleTimeString(HS.locale(), { hour: '2-digit', minute: '2-digit' });
  /** Local midnight `n` calendar days before today. */
  function midnight(n = 0) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - n);
    return d.getTime();
  }
  /** The day of a backup as a heading: „Dziś”, „Wczoraj” or its date („11 listopada”; with the year when it is another one). */
  function dayName(ts) {
    if (ts >= midnight(0)) return 'Dziś';
    if (ts >= midnight(1)) return 'Wczoraj';
    const year = new Date(ts).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' };
    return new Date(ts).toLocaleDateString(HS.locale(), { day: 'numeric', month: 'long', ...year });
  }
  /** „wczoraj, 21:40”, „dziś, 09:05”, „11 listopada, 18:05” – when a version is from, inside a sentence. */
  function whenText(ts) {
    const day = dayName(ts);
    return `${day === 'Dziś' ? 'dziś' : day === 'Wczoraj' ? 'wczoraj' : day}, ${time(ts)}`;
  }
  /** What kind of backup it is – the chip in the version picker and in the list of backups. */
  function kindChip(b) {
    if (b.auto) return HS.chip('automatyczna', null, 'history');
    if (b.safety) return HS.chip('przed przywróceniem', 'accent', 'undo');
    if (/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/.test(b.file)) return HS.chip('z gry', null, 'cube');
    return null;
  }

  function renameWorld(instance, world, onDone) {
    const input = h('input.input', { value: world.name, maxLength: 64 });
    const save = h('button.btn.primary', { type: 'button' }, icon('check'), 'Zmień nazwę');
    const m = HS.modal({
      title: 'Zmień nazwę świata',
      icon: 'pen',
      body: h('div.form', HS.field('Nazwa świata', input, `Zmieniasz nazwę widoczną w grze. Folder „${world.folder}” zostaje bez zmian.`)),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), save],
    });
    save.onclick = () =>
      HS.busy(save, async () => {
        if (!(await attempt(() => api.worlds.rename(instance.id, world.folder, input.value), 'Zmieniono nazwę świata.'))) return;
        m.close();
        onDone();
      });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());
    setTimeout(() => input.select(), 40);
  }

  function render(root) {
    let worlds = [];
    let backups = [];
    let token = 0; // answers for an instance the player has already left are dropped
    let loaded = false;
    const inst = () => state.instance;
    const picker = HS.instancePicker();
    const list = h('div');
    const backupBox = h('div');
    const summary = h('span.dim');

    function worldRow(w) {
      const instance = inst();
      const running = state.running.has(instance.id);
      const mode = MODES[w.gameType];
      return h(
        'div.installed-row.world-row',
        h('div.pic', w.iconUrl ? h('img', { src: w.iconUrl, alt: '' }) : icon('globe')),
        h(
          'div.grow',
          h(
            'div.row.title',
            HS.raw(h('b.ellipsis', { title: w.name }, w.name)),
            w.broken ? HS.chip('Uszkodzony', 'warn', 'warning') : null,
            mode ? HS.chip(mode[0], mode[1], mode[2]) : null,
            w.hardcore ? HS.chip('Hardcore', 'err', 'skull') : null,
          ),
          h(
            'small.ellipsis',
            [w.version ? `Minecraft ${w.version}` : null, w.broken ? 'nie udało się odczytać level.dat' : `ostatnia gra: ${fmt.ago(w.lastPlayed)}`, sizeOf(w), w.folder !== w.name ? `folder: ${w.folder}` : null].filter(Boolean).join(' · '),
          ),
          versionsLine(w),
        ),
        h(
          'div.row-acts',
          h(
            'button.btn.sm.primary',
            { disabled: running || w.broken, title: running ? 'Ta instancja już działa' : 'Uruchom grę od razu w tym świecie', onclick: () => HS.play(instance.id, { world: w.folder, worldName: w.name }) },
            icon('play'),
            'Graj',
          ),
          h(
            'button.btn.sm',
            {
              title: 'Kopia zapasowa – spakuj świat do pliku .zip',
              'aria-label': `Kopia zapasowa: ${w.name}`,
              onclick: (e) =>
                HS.busy(e.currentTarget, async () => {
                  const made = await attempt(() => api.worlds.backup(instance.id, w.folder));
                  if (!made) return;
                  HS.toast('ok', `Kopia świata „${w.name}” jest gotowa (${fmt.size(made.size)}).`);
                  await loadBackups();
                }),
            },
            icon('archive'),
            h('span.wide', 'Kopia zapasowa'),
          ),
          h('button.btn.ghost.sm.icon', { title: 'Zmień nazwę', 'aria-label': `Zmień nazwę: ${w.name}`, disabled: w.broken, onclick: () => renameWorld(instance, w, load) }, icon('pen')),
          h('button.btn.ghost.sm.icon', { title: 'Otwórz folder', 'aria-label': `Otwórz folder: ${w.name}`, onclick: () => attempt(() => api.worlds.open(instance.id, w.folder)) }, icon('folder')),
          h(
            'button.btn.ghost.sm.icon.danger',
            {
              title: 'Usuń',
              'aria-label': `Usuń: ${w.name}`,
              onclick: async () => {
                const ok = await HS.confirmDialog({ title: 'Usunąć świat?', text: `„${w.name}” trafi do kosza systemowego – w razie pomyłki przywrócisz go stamtąd. Kopie zapasowe tego świata zostają.`, confirm: 'Przenieś do kosza', danger: true });
                if (!ok) return;
                if (await attempt(() => api.worlds.remove(instance.id, w.folder), `Świat „${w.name}” jest w koszu.`)) load();
              },
            },
            icon('trash'),
          ),
        ),
      );
    }

    /* ── Kopia zapasowa światów: a world back to an earlier version, in place (Hammer+; „Cofnij” for everybody) ── */

    /**
     * Under each world: „Przywróć wczorajszą wersję” (the newest automatic backup from before today – or „Przywróć
     * wersję z <dnia>” when it is older than yesterday) and „Inna wersja…”. Without Hammer+: dimmed, with the padlock.
     */
    function versionsLine(w) {
      const instance = inst();
      if (!HS.plusOn()) {
        return h('div.world-versions', HS.plusUi.locked(h('button.btn.ghost.sm', { type: 'button', tabindex: '-1' }, icon('history'), 'Przywróć wczorajszą wersję')), HS.plusUi.lockChip());
      }
      const prev = w.previous;
      const mine = backups.some((b) => b.world === w.folder);
      if (!prev && !mine) return null;
      const running = state.running.has(instance.id);
      const closeFirst = 'Zamknij grę, żeby przywrócić świat';
      return h(
        'div.world-versions',
        prev
          ? h(
              'button.btn.sm.restore-prev',
              { type: 'button', disabled: running, title: running ? closeFirst : `Wersja z ${whenText(prev.createdAt)}`, onclick: (e) => restoreVersion(w, { ...prev, auto: true }, { title: prev.yesterday ? 'Przywrócić wczorajszą wersję?' : 'Przywrócić tę wersję?', button: e.currentTarget }) },
              icon('history'),
              prev.yesterday ? 'Przywróć wczorajszą wersję' : `Przywróć wersję z ${dayName(prev.createdAt)}`,
            )
          : null,
        mine ? h('button.btn.ghost.sm.other-version', { type: 'button', disabled: running, title: running ? closeFirst : 'Wybierz kopię, do której ma wrócić ten świat', onclick: () => versionPicker(w) }, icon('clock'), 'Inna wersja…') : null,
      );
    }

    /**
     * The confirmation names the exact time; then the backup goes in place of the world. The state before is
     * kept as a backup – the message after it has „Cofnij”, which puts that one back the same way.
     */
    async function restoreVersion(w, b, { title = 'Przywrócić tę wersję?', confirm = 'Przywróć', button = null } = {}) {
      const instance = inst();
      const ok = await HS.confirmDialog({ title, text: `Świat „${w.name}” wróci do stanu z ${whenText(b.createdAt)}. Obecny stan zapiszemy jako kopię – możesz to cofnąć.`, confirm });
      if (!ok) return;
      const res = await HS.busy(button?.isConnected ? button : null, () => attempt(() => api.worlds.restoreInPlace(instance.id, w.folder, b.file)));
      if (!res) return;
      HS.toast('ok', `Świat „${w.name}” wrócił do stanu z ${whenText(b.createdAt)}.`, 12000, res.safety ? { label: 'Cofnij', onClick: () => undoRestore(instance, w, res.safety) } : null);
      await load();
    }

    /** „Cofnij” in the message: the state from right before the restore goes back (no Hammer+ needed). */
    async function undoRestore(instance, w, safety) {
      const res = await attempt(() => api.worlds.restoreInPlace(instance.id, w.folder, safety.file));
      if (!res) return;
      HS.toast('ok', `Cofnięto – świat „${w.name}” jest taki jak przed przywróceniem.`);
      if (inst()?.id === instance.id) await load();
    }

    /** „Inna wersja…”: every backup of the world, grouped by day – newest first, with the time and the size. */
    function versionPicker(w) {
      const instance = inst();
      const days = new Map();
      for (const b of backups.filter((x) => x.world === w.folder)) {
        const day = dayName(b.createdAt);
        if (!days.has(day)) days.set(day, []);
        days.get(day).push(b);
      }
      const running = state.running.has(instance.id);
      const m = HS.modal({
        title: 'Inna wersja świata',
        icon: 'history',
        body: h(
          'div.versions',
          h('p.muted', { style: { marginBottom: '14px' } }, `Wybierz, do jakiego stanu ma wrócić świat „${w.name}”. Obecny stan zapiszemy jako kopię – możesz to cofnąć.`),
          running ? h('p.hint', { style: { marginBottom: '12px' } }, icon('warning'), 'Zamknij grę, żeby przywrócić świat.') : null,
          [...days].map(([day, list]) =>
            h(
              'div.ver-day',
              h('div.ver-day-head', h('b', day), h('span.dim', fmt.count(list.length, 'kopia', 'kopie', 'kopii'))),
              list.map((b) =>
                h(
                  'div.ver-row',
                  h('b.ver-time', time(b.createdAt)),
                  kindChip(b),
                  h('span.dim.grow', fmt.size(b.size)),
                  h(
                    'button.btn.sm',
                    { type: 'button', disabled: running, title: `Wersja z ${whenText(b.createdAt)}`, onclick: () => (m.close(), restoreVersion(w, b)) },
                    icon('history'),
                    'Przywróć',
                  ),
                ),
              ),
            ),
          ),
        ),
        foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Zamknij')],
      });
    }

    function drawWorlds() {
      const instance = inst();
      if (!instance) return clear(list, h('div.card', HS.empty('cube', 'Brak instancji', 'Utwórz instancję – jej światy pojawią się tutaj.')));
      summary.textContent = worlds.length ? `${fmt.count(worlds.length, 'świat', 'światy', 'światów')} · ${fmt.size(worlds.reduce((sum, w) => sum + w.size, 0))}` : '';
      if (!worlds.length) {
        return clear(
          list,
          h(
            'div.card',
            HS.empty(
              'globe',
              'W tej instancji nie ma jeszcze światów',
              'Uruchom grę i stwórz świat w trybie jednoosobowym – pojawi się tutaj. Świat z kopii zapasowej przywrócisz poniżej.',
              h('button.btn.primary', { disabled: state.running.has(instance.id), onclick: () => HS.play(instance.id) }, icon('play'), 'Uruchom grę'),
            ),
          ),
        );
      }
      return clear(
        list,
        h('div', { style: { margin: '-6px 0 10px', fontSize: '12px' } }, summary),
        h('div.rows', worlds.map(worldRow)),
        HS.plusOn() ? null : h('p.hint.world-versions-hint', icon('lock'), 'Kopie po każdej grze i powrót do wczorajszej wersji jednym kliknięciem odblokujesz z Hammer+.'),
      );
    }

    function backupRow(b) {
      const instance = inst();
      // A backup from before a restore: „Cofnij” puts it back in place of its world (while that world is there).
      const world = b.safety ? worlds.find((w) => w.folder === b.world) : null;
      const running = state.running.has(instance.id);
      return h(
        'div.installed-row.backup-row',
        h('div.pic', icon('zip')),
        h(
          'div.grow',
          h('div.row.title', { style: { gap: '8px' } }, HS.raw(h('b.ellipsis', b.world)), b.auto || b.safety ? kindChip(b) : null),
          h('small.ellipsis', { style: { display: 'block' }, title: b.file }, `${when(b.createdAt)} · ${fmt.size(b.size)} · ${b.file}`),
        ),
        world
          ? h(
              'button.btn.sm.undo-restore',
              { type: 'button', disabled: running, title: running ? 'Zamknij grę, żeby przywrócić świat' : 'Wróć do stanu sprzed przywrócenia', onclick: (e) => restoreVersion(world, b, { title: 'Cofnąć przywracanie?', confirm: 'Cofnij', button: e.currentTarget }) },
              icon('undo'),
              'Cofnij',
            )
          : null,
        h(
          'button.btn.sm',
          {
            title: 'Rozpakuj jako nowy świat – obecne światy zostają nietknięte',
            onclick: (e) =>
              HS.busy(e.currentTarget, async () => {
                const res = await attempt(() => api.worlds.restore(instance.id, b.file));
                if (!res) return;
                HS.toast('ok', `Przywrócono jako nowy świat „${res.folder}”. Twoje obecne światy zostały nietknięte.`, 6000);
                await load();
              }),
          },
          icon('history'),
          'Jako nowy świat',
        ),
        h(
          'button.btn.ghost.sm.icon.danger',
          {
            title: 'Usuń kopię',
            'aria-label': `Usuń kopię: ${b.file}`,
            onclick: async () => {
              if (!(await HS.confirmDialog({ title: 'Usunąć kopię zapasową?', text: `Plik ${b.file} trafi do kosza systemowego.`, confirm: 'Przenieś do kosza', danger: true }))) return;
              if (await attempt(() => api.worlds.removeBackup(instance.id, b.file), 'Kopia jest w koszu.')) load(); // the world rows may lose their „wczorajsza wersja”
            },
          },
          icon('trash'),
        ),
      );
    }

    function drawBackups() {
      const instance = inst();
      if (!instance) return clear(backupBox);
      return clear(
        backupBox,
        h(
          'section.card',
          { style: { marginTop: '16px' } },
          h(
            'div.card-head',
            icon('archive'),
            h('h2.grow', 'Kopie zapasowe'),
            backups.length ? h('span.dim', { style: { fontSize: '12px' } }, `${fmt.count(backups.length, 'kopia', 'kopie', 'kopii')} · ${fmt.size(backups.reduce((sum, b) => sum + b.size, 0))}`) : null,
            h('button.btn.sm', { onclick: () => attempt(() => api.app.openFolder(instance.id, 'backups')) }, icon('folder'), 'Otwórz folder'),
          ),
          h('div.auto-backup', HS.plusUi.autoBackupRow()),
          backups.length
            ? h('div.rows', backups.map(backupRow))
            : h('p.muted', { style: { fontSize: '13px', marginTop: '12px' } }, 'Nie masz jeszcze żadnej kopii. Kliknij „Kopia zapasowa” przy świecie, a launcher spakuje go do pliku .zip.'),
        ),
      );
    }

    async function loadBackups() {
      const instance = inst();
      const mine = token;
      if (!instance) return;
      const res = await api.worlds.backups(instance.id).catch(() => []);
      if (mine !== token) return;
      backups = res;
      if (loaded) drawWorlds(); // „Inna wersja…” follows the backups of each world
      drawBackups();
    }

    async function load() {
      const instance = inst();
      const mine = ++token;
      if (!instance) {
        worlds = [];
        backups = [];
        drawWorlds();
        return drawBackups();
      }
      if (!worlds.length) clear(list, h('div.rows', [1, 2, 3].map(() => h('div.skeleton', { style: { height: '76px' } }))));
      try {
        const [w, b] = await Promise.all([api.worlds.list(instance.id), api.worlds.backups(instance.id).catch(() => [])]);
        if (mine !== token) return undefined;
        worlds = w;
        backups = b;
        loaded = true;
      } catch (err) {
        if (mine !== token) return undefined;
        worlds = [];
        return clear(list, h('div.card', HS.empty('warning', 'Nie udało się wczytać światów', err.message)));
      }
      drawWorlds();
      return drawBackups();
    }

    // „Z Minecrafta”: copy worlds of the official Minecraft into this instance – shown when there is one on this computer.
    const fromOfficial = h('button.btn', { hidden: true, title: 'Z Minecrafta – skopiuj światy ze zwykłego Minecrafta (z oficjalnego launchera) do tej instancji', 'aria-label': 'Z Minecrafta', onclick: () => inst() && HS.officialUi.worldsDialog(inst(), load) }, icon('download'), h('span.wide', 'Z Minecrafta'));
    HS.officialUi.info().then((o) => (fromOfficial.hidden = !o.worlds));

    clear(
      root,
      h(
        'div.page',
        h(
          'div.page-head',
          h('div', h('h1', 'Światy'), h('p', 'Światy trybu jednoosobowego z tej instancji i ich kopie zapasowe.')),
          h(
            'div.actions',
            h('button.btn.icon', { title: 'Odśwież', 'aria-label': 'Odśwież listę światów', onclick: () => load() }, icon('refresh')),
            fromOfficial,
            h('button.btn', { title: 'Otwórz folder ze światami', 'aria-label': 'Folder', onclick: () => inst() && attempt(() => api.app.openFolder(inst().id, 'saves')) }, icon('folder'), h('span.wide', 'Folder')),
            picker.el,
          ),
        ),
        list,
        backupBox,
      ),
    );
    load();

    let lastId = inst()?.id;
    let wasRunning = Boolean(lastId && state.running.has(lastId));
    const offs = [
      bus.on('settings', () => {
        picker.draw();
        if (inst()?.id === lastId) return;
        lastId = inst()?.id;
        worlds = [];
        backups = [];
        loaded = false;
        load();
      }),
      bus.on('instances', () => picker.draw()),
      // An automatic backup (Hammer+) finished after a game session → it shows up on the list by itself (and the
      // world rows get their „Przywróć wczorajszą wersję”).
      api.on('worlds:backups', (e) => e?.instanceId === inst()?.id && load()),
      bus.on('game', () => {
        const running = Boolean(inst() && state.running.has(inst().id));
        // After a game the list has new worlds, play dates and sizes.
        if (wasRunning && !running) load();
        else if (loaded) drawWorlds();
        wasRunning = running;
      }),
    ];
    return () => {
      token += 1;
      offs.forEach((f) => f());
    };
  }

  HS.views.worlds = { title: 'Światy', icon: 'globe', render };
})();
