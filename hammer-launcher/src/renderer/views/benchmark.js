'use strict';
/* Test FPS – the card in Optymalizacja. The player picks a world and a length; the launcher starts the game into
   that world, Hammer Client measures every frame and closes the game, and the result is shown next to the one
   before – so a test before and after „Zoptymalizuj wszystko” shows what the optimisation gave. */

(() => {
  const { api, h, clear, icon, fmt, bus, state } = HS;

  const picked = new Map(); // instance id → { world, seconds } chosen last time
  let showNext = false; // HS.benchUi.show(): the next card that is drawn scrolls itself into view

  const modsText = (n) => (n == null ? null : fmt.count(n, 'mod', 'mody', 'modów'));
  /** What a test ran with: game version, number of mods, optimisation mods, memory. */
  function ranWith(run) {
    return [run.mc ? `Minecraft ${run.mc}` : null, modsText(run.mods), run.optimization?.length ? run.optimization.join(', ') : run.mods != null ? 'bez modów wydajnościowych' : null, run.memoryMb ? `${fmt.mb(run.memoryMb)} RAM` : null].filter(Boolean).join(' · ');
  }

  // What each number says, for the tooltip.
  const HINTS = {
    'Średnio': 'Średnia liczba klatek na sekundę w całym teście',
    '1% low (przycięcia)': 'Średnia z 1% najwolniejszych klatek – im bliżej średniej, tym mniej przycięć',
    'Najniższe': 'Najsłabsza chwila testu',
    'Najwyższe': 'Najlepsza chwila testu',
  };

  function diffChip(c) {
    if (!c) return null;
    return HS.chip(c.text, c.avg > 0 ? 'ok' : c.avg < 0 ? 'warn' : null, c.avg > 0 ? 'arrow-up' : c.avg < 0 ? 'arrow-down' : null);
  }

  /** One of the four numbers; `before` is the same number of the previous test. */
  function stat(label, value, before, main) {
    return h(`div.bench-stat${main ? '.main' : ''}`, { title: HINTS[label] ?? null }, h('small', label), h('b', fmt.fps(value), h('span', 'FPS')), h('small.before', before != null ? `poprzednio ${fmt.fps(before)}` : '\u00a0'));
  }

  function card() {
    const el = h('section.card.bench');
    let info = null;
    let error = null;
    let round = 0;
    let alive = true;
    const inst = () => state.instance;

    async function load() {
      const i = inst();
      const mine = ++round;
      if (!i) return;
      if (info && info.instanceId !== i.id) info = null;
      error = null;
      draw();
      try {
        const res = await api.benchmark.info(i.id);
        if (mine !== round || !alive) return;
        info = { ...res, instanceId: i.id };
      } catch (err) {
        if (mine !== round || !alive) return;
        error = err.message;
      }
      draw();
      if (showNext && info) {
        showNext = false;
        const view = document.getElementById('view');
        view.style.scrollBehavior = 'auto';
        view.scrollTop = el.offsetTop - 16;
        view.style.scrollBehavior = '';
      }
    }

    function form(i) {
      const run = state.running.get(i.id);
      if (!info.worlds.length) {
        return h(
          'p.cloud-note',
          icon('info'),
          h('span.grow', 'W tej instancji nie ma jeszcze świata. Uruchom grę, utwórz świat (Tryb jednoosobowy → Utwórz nowy świat) i wróć tutaj – test mierzy FPS w Twoim świecie.'),
        );
      }
      const mine = picked.get(i.id) ?? {};
      const choice = { world: info.worlds.some((w) => w.folder === mine.world) ? mine.world : info.worlds[0].folder, seconds: info.lengths.includes(mine.seconds) ? mine.seconds : info.seconds };
      picked.set(i.id, choice);
      const worldSel = HS.select(
        info.worlds.map((w, n) => ({ value: w.folder, label: n === 0 ? `${w.name} (ostatnio grany)` : w.name })),
        choice.world,
        (v) => (choice.world = v),
      );
      const start = h('button.btn.primary', { type: 'button', disabled: Boolean(run), title: run ? 'Najpierw zamknij grę tej instancji' : 'Gra uruchomi się w wybranym świecie, zmierzy FPS i zamknie się sama' }, icon('play'), 'Uruchom test');
      start.onclick = () => {
        const world = info.worlds.find((w) => w.folder === choice.world);
        HS.play(i.id, { world: choice.world, worldName: world?.name ?? choice.world, benchmark: { seconds: choice.seconds } });
      };
      return [
        h(
          'div.bench-form',
          h('label.field.world', h('span', 'Świat'), worldSel),
          h('div.field', h('span', 'Długość testu'), HS.seg(info.lengths.map((s) => ({ value: s, label: `${s} s` })), choice.seconds, (v) => (choice.seconds = v))),
          start,
        ),
        h('p.hint', { style: { marginTop: '10px' } }, run ? 'Zamknij grę tej instancji, żeby uruchomić test.' : 'Wynik zależy od miejsca w świecie i od tego, na co patrzy postać – porównuj testy zrobione w tym samym świecie, w tym samym miejscu.'),
      ];
    }

    /** While the game of a test is being prepared or runs. */
    function running(i) {
      const run = state.running.get(i.id);
      const prog = state.progress.get(i.id);
      const preparing = run === 'preparing';
      return h(
        'div.bench-run',
        { role: 'status' },
        h('span.spinner.lg'),
        h(
          'div.grow',
          h('b', preparing ? 'Przygotowuję grę do testu FPS…' : 'Trwa test FPS – gra zamknie się sama'),
          h('small', preparing ? (prog?.label ?? 'To potrwa chwilę.') : 'Nie zamykaj gry i nie przełączaj się na inne okno. Wynik pojawi się tutaj, gdy gra się zamknie.'),
        ),
        preparing ? null : h('button.btn.ghost.sm', { type: 'button', onclick: () => HS.stop(i.id) }, icon('stop'), 'Przerwij'),
      );
    }

    /** „Test nie został ukończony” with the likely reasons. */
    function failure(i, res) {
      return h(
        'div.bench-fail',
        icon('warning'),
        h('div.grow', h('h3', 'Test nie został ukończony'), h('ul', res.reasons.map((r) => h('li', r)))),
        h('button.btn.ghost.sm.icon', { type: 'button', title: 'Ukryj', 'aria-label': 'Ukryj', onclick: () => (state.benchResults.delete(i.id), draw()) }, icon('close')),
      );
    }

    function result(i) {
      const [last, before] = info.history;
      if (!last) return null;
      const fresh = state.benchResults.get(i.id)?.ok;
      const c = info.comparison;
      return h(
        'div.bench-result',
        h(
          'div.bench-head',
          h('h3', fresh ? 'Wynik testu' : 'Ostatni wynik'),
          h('span.dim', [fmt.dateTime(last.at), last.worldName ? `świat „${last.worldName}”` : null, last.seconds ? `${Math.round(last.seconds)} s` : null].filter(Boolean).join(' · ')),
          h('span.grow'),
          diffChip(c),
        ),
        h('div.bench-stats', stat('Średnio', last.avg, before?.avg, true), stat('1% low (przycięcia)', last.low1, before?.low1), stat('Najniższe', last.min, before?.min), stat('Najwyższe', last.max, before?.max)),
        h('p.hint.bench-with', ranWith(last) ? `Test z: ${ranWith(last)}.` : null, before ? ` Poprzedni test: ${fmt.dateTime(before.at)}${ranWith(before) ? ` (${ranWith(before)})` : ''}.` : ' To pierwszy test tej instancji – uruchom go ponownie po zmianach, a zobaczysz różnicę.'),
        c && !c.sameWorld ? h('p.hint.warn', `Poprzedni test był w innym świecie${before?.worldName ? ` („${before.worldName}”)` : ''} – różnica może wynikać z miejsca, a nie z ustawień.`) : null,
        info.history.length > 1
          ? h(
              'details.bench-history',
              h('summary', `Historia testów (${info.history.length})`),
              h(
                'div.bench-rows',
                h('div.bench-row.titles', h('span', 'Kiedy'), h('span', 'Średnio'), h('span', '1% low'), h('span', 'Najniższe'), h('span', 'Najwyższe'), h('span', 'Z czym')),
                info.history.map((r) => h('div.bench-row', h('span', fmt.dateTime(r.at)), h('b', fmt.fps(r.avg)), h('span', fmt.fps(r.low1)), h('span', fmt.fps(r.min)), h('span', fmt.fps(r.max)), h('span.ellipsis.dim', { title: [r.worldName ? `Świat „${r.worldName}”` : null, ranWith(r)].filter(Boolean).join(' · ') }, ranWith(r) || '—'))),
              ),
            )
          : null,
      );
    }

    function draw() {
      const i = inst();
      const head = h('div.card-head', icon('heartbeat'), h('h2.grow', 'Test FPS'), info?.available ? HS.chip('Mierzy Hammer Client', null, 'hammer') : null);
      const intro = h('p.muted.bench-intro', 'Launcher uruchomi grę w Twoim świecie, Hammer Client zmierzy każdą klatkę i gra zamknie się sama. Zrób test przed i po „Zoptymalizuj wszystko”, żeby zobaczyć różnicę.');
      if (!i) return clear(el);
      if (error) return clear(el, head, h('p.cloud-note', icon('warning'), h('span.grow', `Nie udało się sprawdzić, czy test jest dostępny: ${error}`), h('button.btn.sm', { type: 'button', onclick: load }, icon('refresh'), 'Spróbuj ponownie')));
      if (!info) return clear(el, head, h('div.skeleton', { style: { height: '74px' } }));
      if (!info.available) {
        // One line: why this instance cannot be measured (and, where it helps, the way to change that).
        return clear(el, head, h('p.cloud-note', icon('info'), h('span.grow', info.note), info.reason === 'off' ? h('button.btn.sm', { type: 'button', onclick: () => HS.editInstance(i) }, icon('pen'), 'Ustaw instancję') : null));
      }
      const testing = state.benchmarks.has(i.id) && state.running.has(i.id);
      const last = state.benchResults.get(i.id);
      return clear(el, head, intro, testing ? running(i) : form(i), !testing && last && !last.ok ? failure(i, last) : null, result(i));
    }

    const offs = [
      bus.on('game', () => info && draw()),
      // A test of this instance ended: the history has a new entry (or the card says why not).
      bus.on('benchmark', (res) => res.instanceId === inst()?.id && load()),
    ];
    return {
      el,
      load,
      stop: () => {
        alive = false;
        offs.forEach((f) => f());
      },
    };
  }

  HS.benchUi = { card, show: () => (showNext = true) };
})();
