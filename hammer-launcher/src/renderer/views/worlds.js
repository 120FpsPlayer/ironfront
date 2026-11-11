'use strict';
/* Światy – the singleplayer worlds of an instance: play, back up, rename, remove – and the backups themselves,
   also the ones the launcher makes by itself after each game session (Hammer+). */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  const MODES = { 0: ['Przetrwanie', null, 'heart'], 1: ['Kreatywny', 'accent', 'magic'], 2: ['Przygoda', null, 'compass'], 3: ['Widz', null, 'eye'] };
  const when = (ts) => new Date(ts).toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' });
  const sizeOf = (w) => `${w.sizePartial ? 'ponad ' : ''}${fmt.size(w.size)}`;

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
            h('b.ellipsis', { title: w.name }, w.name),
            w.broken ? HS.chip('Uszkodzony', 'warn', 'warning') : null,
            mode ? HS.chip(mode[0], mode[1], mode[2]) : null,
            w.hardcore ? HS.chip('Hardcore', 'err', 'skull') : null,
          ),
          h(
            'small.ellipsis',
            [w.version ? `Minecraft ${w.version}` : null, w.broken ? 'nie udało się odczytać level.dat' : `ostatnia gra: ${fmt.ago(w.lastPlayed)}`, sizeOf(w), w.folder !== w.name ? `folder: ${w.folder}` : null].filter(Boolean).join(' · '),
          ),
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
      return clear(list, h('div', { style: { margin: '-6px 0 10px', fontSize: '12px' } }, summary), h('div.rows', worlds.map(worldRow)));
    }

    function backupRow(b) {
      const instance = inst();
      return h(
        'div.installed-row',
        h('div.pic', icon('zip')),
        h(
          'div.grow',
          h('div.row.title', { style: { gap: '8px' } }, h('b.ellipsis', b.world), b.auto ? HS.chip('automatyczna', null, 'history') : null),
          h('small.ellipsis', { style: { display: 'block' }, title: b.file }, `${when(b.createdAt)} · ${fmt.size(b.size)} · ${b.file}`),
        ),
        h(
          'button.btn.sm',
          {
            title: 'Rozpakuj jako nowy świat',
            onclick: (e) =>
              HS.busy(e.currentTarget, async () => {
                const res = await attempt(() => api.worlds.restore(instance.id, b.file));
                if (!res) return;
                HS.toast('ok', `Przywrócono jako nowy świat „${res.folder}”. Twoje obecne światy zostały nietknięte.`, 6000);
                await load();
              }),
          },
          icon('history'),
          'Przywróć',
        ),
        h(
          'button.btn.ghost.sm.icon.danger',
          {
            title: 'Usuń kopię',
            'aria-label': `Usuń kopię: ${b.file}`,
            onclick: async () => {
              if (!(await HS.confirmDialog({ title: 'Usunąć kopię zapasową?', text: `Plik ${b.file} trafi do kosza systemowego.`, confirm: 'Przenieś do kosza', danger: true }))) return;
              if (await attempt(() => api.worlds.removeBackup(instance.id, b.file), 'Kopia jest w koszu.')) loadBackups();
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
            : h('p.muted', { style: { fontSize: '13px', marginTop: '12px' } }, 'Nie masz jeszcze żadnej kopii. Kliknij „Kopia zapasowa” przy świecie, a launcher spakuje go do pliku .zip. Przywrócona kopia zawsze staje się nowym światem – niczego nie nadpisuje.'),
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
      // An automatic backup (Hammer+) finished after a game session → it shows up on the list by itself.
      api.on('worlds:backups', (e) => e?.instanceId === inst()?.id && loadBackups()),
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
