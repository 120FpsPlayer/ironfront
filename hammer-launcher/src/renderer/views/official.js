'use strict';
/* The player's "normal" Minecraft (the official launcher): bringing its worlds and its settings into an instance.
   (Its server list comes over in the Serwery tab.) Used by Światy, the instance menu and right after a new instance. */

(() => {
  const { api, h, clear, icon, fmt, state, attempt } = HS;

  const NEWER = 'Ten świat był otwierany w nowszej wersji gry – może się nie wczytać';
  const BACKUP = 'options.txt.przed-importem';

  /** What this computer's official Minecraft has: { available, servers, worlds, options } – asked once a minute at most. */
  let seen = null;
  function info() {
    if (!seen || Date.now() - seen.at > 60_000) seen = { at: Date.now(), promise: api.official.info().catch(() => ({ available: false, servers: false, worlds: false, options: false })) };
    return seen.promise;
  }

  /**
   * „Z Minecrafta” in Światy: the worlds of the official Minecraft with checkboxes; the chosen ones are copied
   * into the instance. The originals are never touched. onDone() runs after something was copied.
   */
  function worldsDialog(instance, onDone) {
    let worlds = null; // null = loading
    let error = null;
    let working = false;
    const picked = new Set();
    const list = h('div.pick-list');
    const bar = HS.taskBar('official-worlds');
    const all = h('input', { type: 'checkbox' });
    const count = h('span.dim');
    const copy = h('button.btn.primary', { type: 'button', disabled: true }, icon('download'), h('span', 'Skopiuj zaznaczone'));
    const cancel = h('button.btn.ghost', { type: 'button' }, 'Anuluj');
    const usable = () => (worlds ?? []).filter((w) => !w.broken);

    function drawFoot() {
      const running = state.running.has(instance.id);
      copy.disabled = working || running || !picked.size;
      copy.title = running ? 'Najpierw zamknij grę tej instancji' : '';
      all.checked = usable().length > 0 && picked.size === usable().length;
      all.disabled = working || !usable().length;
      count.textContent = picked.size ? `zaznaczono: ${fmt.count(picked.size, 'świat', 'światy', 'światów')} · ${fmt.size(usable().filter((w) => picked.has(w.folder)).reduce((sum, w) => sum + w.size, 0))}` : '';
    }

    function row(w) {
      const box = h('input', {
        type: 'checkbox',
        checked: picked.has(w.folder),
        disabled: w.broken || working,
        onchange: (e) => {
          if (e.target.checked) picked.add(w.folder);
          else picked.delete(w.folder);
          drawFoot();
        },
      });
      return h(
        `label.clean-row.pick-row${w.broken ? '.off' : ''}`,
        box,
        h('div.pic', w.iconUrl ? h('img', { src: w.iconUrl, alt: '' }) : icon('globe')),
        h(
          'div.grow',
          h('div.row.title', h('b.ellipsis', { title: w.name }, w.name), w.broken ? HS.chip('Uszkodzony', 'warn', 'warning') : null, w.newer ? HS.chip('Nowsza wersja gry', 'warn', 'warning') : null, w.hardcore ? HS.chip('Hardcore', 'err', 'skull') : null),
          h('small.ellipsis', [w.version ? `Minecraft ${w.version}` : null, w.broken ? 'nie udało się odczytać level.dat' : `ostatnia gra: ${fmt.ago(w.lastPlayed)}`, w.folder !== w.name ? `folder: ${w.folder}` : null].filter(Boolean).join(' · ')),
          w.newer ? h('small.warn', `${NEWER}.`) : null,
        ),
        h('span.size', `${w.sizePartial ? 'ponad ' : ''}${fmt.size(w.size)}`),
      );
    }

    function draw() {
      if (error) clear(list, HS.empty('warning', 'Nie udało się wczytać światów', error));
      else if (!worlds) clear(list, [1, 2, 3].map(() => h('div.skeleton', { style: { height: '62px' } })));
      else if (!worlds.length) clear(list, HS.empty('globe', 'W Twoim Minecrafcie nie ma jeszcze światów', 'Gdy stworzysz świat w zwykłym Minecrafcie (z oficjalnego launchera), pojawi się tutaj.'));
      else clear(list, worlds.map(row));
      drawFoot();
    }

    all.onchange = () => {
      picked.clear();
      if (all.checked) for (const w of usable()) picked.add(w.folder);
      draw();
    };

    const m = HS.modal({
      title: 'Światy z Minecrafta',
      icon: 'globe',
      wide: true,
      body: h(
        'div.form',
        h('p.muted', `Wybierz światy ze zwykłego Minecrafta (z oficjalnego launchera). Launcher skopiuje je do instancji „${instance.name}” – oryginały zostają tam, gdzie są, nietknięte. Świat o nazwie, która już tu jest, dostanie numer, np. „Nowy świat (2)”.`),
        h('div.row', { style: { justifyContent: 'space-between' } }, h('label.check', all, 'Zaznacz wszystkie'), count),
        list,
        bar.el,
        h('p.hint', 'Przed kopiowaniem zamknij zwykłego Minecrafta – świat otwarty w grze mógłby skopiować się niekompletnie.'),
      ),
      foot: [cancel, copy],
      onClose: () => bar.stop(),
    });
    cancel.onclick = () => m.close();

    copy.onclick = async () => {
      await copyPicked();
      if (m.box.isConnected) drawFoot(); // (the spinner hands the button back enabled – nothing may be picked any more)
    };
    const copyPicked = () =>
      HS.busy(copy, async () => {
        working = true;
        cancel.disabled = true;
        draw();
        const res = await attempt(() => api.official.importWorlds(instance.id, [...picked]));
        working = false;
        cancel.disabled = false;
        if (!res) return draw();
        const byFolder = new Map((worlds ?? []).map((w) => [w.folder, w]));
        if (res.copied.length) {
          const renamed = res.copied.filter((c) => c.folder !== c.source);
          HS.toast(
            'ok',
            `${res.copied.length === 1 ? `Skopiowano świat „${byFolder.get(res.copied[0].source)?.name ?? res.copied[0].source}”` : `Skopiowano ${fmt.count(res.copied.length, 'świat', 'światy', 'światów')}`} do instancji „${instance.name}”.${renamed.length ? ` Nazwa była zajęta, więc folder to: ${renamed.map((c) => `„${c.folder}”`).join(', ')}.` : ''}`,
            7000,
          );
          const newer = res.copied.filter((c) => byFolder.get(c.source)?.newer);
          if (newer.length) HS.toast('warning', res.copied.length === 1 ? `${NEWER}.` : `${newer.length === res.copied.length ? 'Te światy były otwierane' : 'Część skopiowanych światów była otwierana'} w nowszej wersji gry niż Minecraft ${instance.mcVersion} tej instancji – mogą się nie wczytać.`, 9000);
        }
        for (const f of res.failed) HS.toast('err', f.error, 8000);
        if (res.copied.length) onDone?.();
        if (!res.failed.length) return m.close();
        for (const c of res.copied) picked.delete(c.source);
        return draw();
      });

    draw();
    api.official.worlds(instance.id).then(
      (res) => {
        worlds = res;
        if (m.box.isConnected) draw();
      },
      (err) => {
        error = err.message;
        if (m.box.isConnected) draw();
      },
    );
  }

  /**
   * „Przenieś ustawienia z Minecrafta”: says plainly what is overwritten and what stays, then replaces the
   * instance's options.txt with the official Minecraft's.
   */
  function importOptions(instance) {
    const point = (ic, kind, title, text) => h('div.why-item', h(`div.why-icon${kind ? `.${kind}` : ''}`, icon(ic)), h('div', h('b', title), h('p', text)));
    const go = h('button.btn.primary', { type: 'button' }, icon('sliders'), 'Przenieś ustawienia');
    const m = HS.modal({
      title: 'Przenieść ustawienia z Minecrafta?',
      icon: 'sliders',
      body: h(
        'div.form',
        h('p.muted', `Instancja „${instance.name}” dostanie ustawienia ze zwykłego Minecrafta (z oficjalnego launchera) – nie trzeba ustawiać wszystkiego od nowa.`),
        h(
          'div.why',
          point('warning', 'warn', 'Co zostanie nadpisane', 'Plik options.txt tej instancji: klawisze, czułość myszy, ustawienia grafiki i dźwięku, język gry oraz lista włączonych paczek zasobów. Same pliki paczek dodasz w zakładce Mody.'),
          point('check', 'ok', 'Co zostaje', `Dotychczasowe ustawienia tej instancji – także klawisze modów – zostaną obok w pliku ${BACKUP}. Światy, mody i serwery są bez zmian, a w zwykłym Minecrafcie nic się nie zmienia.`),
        ),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), go],
    });
    go.onclick = () =>
      HS.busy(go, async () => {
        const res = await attempt(() => api.official.importOptions(instance.id));
        if (!res) return;
        m.close();
        HS.toast('ok', `Ustawienia z Minecrafta są w instancji „${instance.name}”.${res.backup ? ` Poprzednie zostały w pliku ${res.backup}.` : ''}`, 7000);
      });
  }

  /**
   * Right after a new instance was made: one quiet offer to bring the settings over – a message in the corner
   * with a button, gone by itself after a while. Nothing appears when there is no official Minecraft here.
   */
  async function offerOptions(instance) {
    if (!instance?.id) return;
    const has = await info();
    if (!has.options) return;
    HS.toast('info', `Masz na tym komputerze zwykłego Minecrafta. Chcesz przenieść z niego klawisze i ustawienia do instancji „${instance.name}”?`, 14000, { label: 'Przenieś ustawienia', onClick: () => importOptions(instance) });
  }

  HS.officialUi = { info, worldsDialog, importOptions, offerOptions, NEWER };
})();
