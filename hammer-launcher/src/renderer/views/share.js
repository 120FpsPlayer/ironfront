'use strict';
/* Udostępnianie – an instance as a "recipe": a code to paste or a .hammerpack file. Exporting (instance menu →
   „Udostępnij”) and importing (Instancje → „Z kodu lub pliku”, or a .hammerpack dropped on the window).
   Nothing is uploaded: the recipe names things, the other launcher fetches them from Modrinth. */

(() => {
  const { api, h, clear, icon, fmt, LOADERS, state, attempt } = HS;

  const KIND = { mod: 'mod', resourcepack: 'paczka zasobów', shader: 'shader' };
  const REASON = { gone: 'nie ma już tej wersji na Modrinth', mismatch: 'na Modrinth jest pod tym numerem coś innego', failed: 'nie udało się pobrać' };

  /** What a recipe holds, as chips: game version, loader, how many of what. */
  function summaryChips(s) {
    const loader = LOADERS[s.loader]?.name ?? s.loader;
    return h(
      'div.chip-row',
      HS.chip(`Minecraft ${s.mc}`, 'accent', 'cube'),
      HS.chip(s.loader === 'vanilla' ? loader : `${loader}${s.loaderVersion ? ` ${s.loaderVersion}` : ' – najnowsza zalecana'}`, null, 'puzzle'),
      HS.chip(fmt.count(s.mods, 'mod', 'mody', 'modów'), null, 'puzzle'),
      s.resourcepacks ? HS.chip(fmt.count(s.resourcepacks, 'paczka zasobów', 'paczki zasobów', 'paczek zasobów'), null, 'image') : null,
      s.shaders ? HS.chip(fmt.count(s.shaders, 'shader', 'shadery', 'shaderów'), null, 'sun') : null,
      s.servers ? HS.chip(fmt.count(s.servers, 'serwer', 'serwery', 'serwerów'), null, 'server') : null,
      s.hammerClient ? HS.chip('Hammer Client', null, 'hammer') : null,
      s.options ? HS.chip('ustawienia gry', null, 'sliders') : null,
    );
  }

  /** „Udostępnij”: what goes into the recipe, what cannot, then the file and – when it is short enough – the code. */
  function exportDialog(instance) {
    let withOptions = false;
    let data = null;
    let error = null;
    let round = 0;
    const body = h('div.form');
    const copy = h('button.btn.primary', { type: 'button', disabled: true }, icon('copy'), 'Kopiuj kod');
    const save = h('button.btn', { type: 'button', disabled: true }, icon('export'), 'Zapisz plik .hammerpack');

    function draw() {
      // Without a code (the recipe is too big for one) only the file is offered.
      copy.hidden = Boolean(data) && !data.code;
      copy.disabled = !data?.code;
      save.disabled = !data;
      save.classList.toggle('primary', copy.hidden);
      if (error) return clear(body, HS.empty('warning', 'Nie udało się przygotować przepisu', error));
      if (!data) return clear(body, h('div.skeleton', { style: { height: '70px' } }), h('div.skeleton', { style: { height: '120px' } }));
      const s = data.summary;
      const options = HS.toggle(withOptions, (v) => {
        withOptions = v;
        load();
      });
      return clear(
        body,
        h('p.muted', 'Znajomy wklei kod albo otworzy plik w swoim Hammer Launcherze i dostanie taką samą instancję. Niczego nie wysyłamy do internetu – w przepisie są tylko nazwy i numery, a jego launcher pobierze dodatki z Modrinth.'),
        h('div.field', h('span', 'W przepisie'), summaryChips(s), h('div.hint', 'Serwery to tylko nazwa i adres. Światy, konta i zrzuty ekranu nie są częścią przepisu.')),
        data.hasOptions
          ? h(
              'label.cloud-auto',
              options,
              h('div', h('b', 'Dołącz ustawienia gry (options.txt)'), h('small', data.optionsLeftOut ? 'Plik ustawień tej instancji jest za duży na przepis – zostaje pominięty.' : 'Klawisze, czułość myszy i grafika. Trafią tylko do nowej instancji znajomego.')),
            )
          : null,
        data.excluded.length
          ? h(
              'div.field',
              h('span', `Nie da się udostępnić – dodaj ręcznie (${data.excluded.length})`),
              h('div.rows.share-out', data.excluded.map((x) => h('div.installed-row', h('div.pic', icon(x.type === 'mod' ? 'puzzle' : 'image')), h('div.grow', { style: { minWidth: 0 } }, h('b.ellipsis', { title: x.file }, x.title || x.file), h('small.ellipsis', { style: { display: 'block' } }, `${x.file} · ${KIND[x.type] ?? x.type}`))))),
              h('div.hint', 'Te pliki nie pochodzą z Modrinth, więc przepis ich nie zawiera. Prześlij je znajomemu osobno – doda je u siebie w zakładce Mody.'),
            )
          : null,
        h(
          'div.field',
          h('span', 'Kod do wklejenia'),
          data.code
            ? [h('textarea.input.share-code', { readOnly: true, rows: 3, spellcheck: false, 'aria-label': 'Kod instancji', onfocus: (e) => e.target.select() }, data.code), h('div.hint', `${fmt.num(data.codeLength)} ${fmt.plural(data.codeLength, 'znak', 'znaki', 'znaków')} – wklej go np. na Discordzie.`)]
            : h('p.cloud-note', icon('info'), `Kod miałby ${fmt.num(data.codeLength)} znaków, a mieści się najwyżej ${fmt.num(data.maxCode)} – przy tylu dodatkach udostępnij plik.`),
        ),
      );
    }

    async function load() {
      const mine = ++round;
      data = null;
      error = null;
      draw();
      try {
        const res = await api.share.export(instance.id, { options: withOptions });
        if (mine !== round) return;
        data = res;
      } catch (err) {
        if (mine !== round) return;
        error = err.message;
      }
      if (m.box.isConnected) draw();
    }

    const m = HS.modal({ title: `Udostępnij: ${instance.name}`, icon: 'share', wide: true, body, foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Zamknij'), save, copy] });
    copy.onclick = () => data?.code && HS.copyText(data.code, 'Kod instancji jest w schowku – wklej go znajomemu.');
    save.onclick = () =>
      HS.busy(save, async () => {
        const res = await attempt(() => api.share.save(instance.id, { options: withOptions }));
        if (res) HS.toast('ok', `Zapisano plik ${res.file}. Wyślij go znajomemu – otworzy go w Hammer Launcherze.`, 7000);
      });
    load();
  }

  /** What came of an import that left something out: the instance is there, these items are not. */
  function resultDialog(res) {
    const m = HS.modal({
      title: `Instancja „${res.instance.name}” jest gotowa`,
      icon: 'check-circle',
      body: h(
        'div.form',
        h('p.muted', `Zainstalowano ${fmt.count(res.installed, 'dodatek', 'dodatki', 'dodatków')}.${res.missing.length ? ` ${fmt.count(res.missing.length, 'dodatku', 'dodatków', 'dodatków')} nie udało się dodać – reszta działa.` : ''}`),
        res.notes.map((n) => h('p.cloud-note', icon('info'), n)),
        res.missing.length
          ? h(
              'div.field',
              h('span', `Brakuje (${res.missing.length})`),
              h('div.rows.share-out', res.missing.map((x) => h('div.installed-row', h('div.pic', icon(x.type === 'mod' ? 'puzzle' : 'image')), h('div.grow', { style: { minWidth: 0 } }, h('b.ellipsis', { title: x.file }, x.file), h('small.ellipsis', { style: { display: 'block' } }, `${KIND[x.type] ?? x.type} · ${REASON[x.reason] ?? x.reason}`))))),
              h('div.hint', 'Poszukaj ich w zakładce Mody albo poproś znajomego o nowy kod.'),
            )
          : null,
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Zamknij'), h('button.btn.primary', { type: 'button', onclick: () => (m.close(), HS.go('mods')) }, icon('puzzle'), 'Zobacz mody')],
    });
  }

  /** The preview of a recipe that was read: nothing is created until „Utwórz instancję”. */
  function previewDialog(preview) {
    const s = preview.summary;
    const bar = HS.taskBar('recipe');
    const create = h('button.btn.primary', { type: 'button' }, icon('plus'), 'Utwórz instancję');
    const cancel = h('button.btn.ghost', { type: 'button' }, 'Anuluj');
    const m = HS.modal({
      title: 'Instancja z przepisu',
      icon: 'import',
      body: h(
        'div.form',
        h('div.recipe-name', icon('cube'), h('b.ellipsis', { title: s.name }, s.name)),
        summaryChips(s),
        preview.notes.map((n) => h('p.cloud-note', icon('info'), n)),
        h('p.muted', `Launcher utworzy nową instancję i pobierze ${s.mods + s.resourcepacks + s.shaders ? 'dodatki z Modrinth' : 'grę'}. Twoje obecne instancje zostają bez zmian.${s.options ? ' Ustawienia gry z przepisu trafią tylko do tej nowej instancji.' : ''}`),
        bar.el,
      ),
      foot: [cancel, create],
      onClose: () => bar.stop(),
    });
    cancel.onclick = () => m.close();
    create.onclick = () =>
      HS.busy(create, async () => {
        cancel.disabled = true; // the download cannot be called off half-way – the instance would be left incomplete
        const res = await attempt(() => api.share.install(preview.token));
        if (!res) return void (m.box.isConnected && m.close());
        m.close();
        state.settings = await api.settings.get();
        await state.refreshInstances();
        await state.selectInstance(res.instance.id);
        if (res.missing.length || res.notes.length) resultDialog(res);
        else HS.toast('ok', `Instancja „${res.instance.name}” jest gotowa – kliknij GRAJ.`, 6000);
      });
  }

  /** Runs one way of reading a recipe (code, picked file, dropped file) and opens its preview. */
  async function open(read, closeFirst) {
    const preview = await attempt(read);
    if (!preview) return false;
    closeFirst?.();
    previewDialog(preview);
    return true;
  }

  let importModal = null; // the open „Z kodu lub pliku” window – a file dropped meanwhile takes its place

  /** „Z kodu lub pliku”: paste a code or pick a .hammerpack file. */
  function importDialog() {
    const input = h('textarea.input.share-code', { rows: 4, placeholder: 'HL1.…', spellcheck: false, 'aria-label': 'Kod instancji' });
    const next = h('button.btn.primary', { type: 'button' }, icon('check'), 'Dalej');
    const m = HS.modal({
      title: 'Instancja z kodu lub pliku',
      icon: 'import',
      body: h(
        'div.form',
        h('p.muted', 'Wklej kod, który dostałeś od znajomego, albo wybierz plik .hammerpack. Zanim cokolwiek powstanie, zobaczysz, co jest w środku.'),
        h(
          'div.field',
          h('span', 'Kod instancji'),
          input,
          h(
            'div.row',
            h(
              'button.btn.sm',
              {
                type: 'button',
                onclick: async () => {
                  const text = await attempt(() => api.clipboard.read());
                  if (text === undefined) return;
                  if (!text) return void HS.toast('info', 'Schowek jest pusty – skopiuj kod z wiadomości znajomego.');
                  input.value = text;
                  input.focus();
                },
              },
              icon('paste'),
              'Wklej',
            ),
            h('span.grow'),
            h('button.btn.sm', { type: 'button', onclick: (e) => HS.busy(e.currentTarget, () => open(() => api.share.pick(), () => m.close())) }, icon('folder'), 'Wybierz plik .hammerpack'),
          ),
          h('div.hint', 'Plik .hammerpack możesz też po prostu upuścić na okno launchera.'),
        ),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), next],
      onClose: () => (importModal = null),
    });
    importModal = m;
    next.onclick = () =>
      HS.busy(next, async () => {
        if (!input.value.trim()) return void HS.toast('warning', 'Wklej kod instancji albo wybierz plik.');
        await open(() => api.share.readCode(input.value), () => m.close());
      });
  }

  /** A .hammerpack file dropped on the window. */
  const openFile = (file) => open(() => api.share.readFile(file), () => importModal?.close());

  HS.shareUi = { exportDialog, importDialog, previewDialog, openFile };
})();
