'use strict';
/* Konsola – live game log with colours, filter, copy, and a plain-Polish crash explanation. */

(() => {
  const { api, h, clear, icon, LOADERS, tile, bus, state, attempt } = HS;

  const cls = (line) => (/\b(ERROR|FATAL|Exception|Caused by)\b/.test(line) ? 'l-err' : /\bWARN\b/.test(line) ? 'l-warn' : /^\s+at /.test(line) ? 'l-dim' : 'l-info');

  function render(root) {
    let follow = true;
    let filter = '';
    const box = h('div.console', { role: 'log', 'aria-live': 'off' });
    const crashBox = h('div');
    const inst = () => state.instance;

    function line(l) {
      return h(`div.${cls(l.line)}`, l.line);
    }
    function draw() {
      const i = inst();
      const lines = (state.logs.get(i?.id) ?? []).filter((l) => !filter || l.line.toLowerCase().includes(filter));
      if (!lines.length) {
        clear(box, h('div.l-dim', i ? (state.running.has(i.id) ? 'Czekam na logi gry…' : 'Uruchom grę, a tutaj pojawią się jej logi. Przydają się, gdy coś nie działa.') : 'Brak instancji.'));
      } else clear(box, lines.slice(-4000).map(line));
      if (follow) box.scrollTop = box.scrollHeight;
      drawCrash();
    }
    function drawCrash() {
      const c = state.crashes.get(inst()?.id);
      if (!c) return clear(crashBox);
      clear(
        crashBox,
        h(
          'div.crash',
          icon('warning'),
          h(
            'div.grow',
            h('h3', c.title),
            c.hints?.length ? h('ul', c.hints.map((x) => h('li', x))) : null,
            c.details ? h('code', c.details) : null,
          ),
          h('button.btn.ghost.sm.icon', { title: 'Ukryj', 'aria-label': 'Ukryj', onclick: () => (state.crashes.delete(inst()?.id), drawCrash()) }, icon('close')),
        ),
      );
    }
    async function loadLogs() {
      const i = inst();
      if (!i) return draw();
      if (!state.logs.has(i.id)) {
        const lines = await api.game.logs(i.id).catch(() => []);
        if (lines?.length) state.logs.set(i.id, lines.map((l) => (typeof l === 'string' ? { line: l } : l)));
      }
      draw();
    }
    box.addEventListener('scroll', () => {
      follow = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
    });

    const picker = HS.instancePicker();
    const instBtn = picker.el;
    const drawInst = picker.draw;
    const stopBtn = h('button.btn.danger', { onclick: () => inst() && HS.stop(inst().id) }, icon('stop'), 'Zatrzymaj grę');
    const drawStop = () => (stopBtn.style.display = inst() && state.running.has(inst().id) ? '' : 'none');

    const search = h('input.input', {
      type: 'search',
      placeholder: 'Szukaj w logach…',
      oninput: HS.debounce((e) => {
        filter = e.target.value.trim().toLowerCase();
        draw();
      }, 200),
    });

    clear(
      root,
      h(
        'div.page',
        h('div.page-head', h('div', h('h1', 'Konsola'), h('p', 'Logi gry na żywo. Gdy gra się wysypie, launcher wyjaśni dlaczego.')), h('div.actions', stopBtn, instBtn)),
        crashBox,
        h(
          'div.toolbar',
          h('div.search', { style: { width: '280px' } }, icon('search'), search),
          h('span.grow'),
          h(
            'button.btn',
            {
              onclick: () => {
                const text = (state.logs.get(inst()?.id) ?? []).map((l) => l.line).join('\n');
                navigator.clipboard.writeText(text).then(
                  () => HS.toast('ok', 'Skopiowano logi do schowka.'),
                  () => HS.toast('err', 'Nie udało się skopiować.'),
                );
              },
            },
            icon('copy'),
            'Kopiuj',
          ),
          h('button.btn', { onclick: () => attempt(() => api.app.openFolder(inst()?.id, 'logs')) }, icon('folder'), 'Folder logów'),
          h('button.btn', { onclick: () => attempt(() => api.app.openFolder(inst()?.id, 'crash-reports')) }, icon('warning'), 'Raporty crashy'),
          h('button.btn.ghost', { onclick: () => (state.logs.set(inst()?.id, []), draw()) }, icon('trash'), 'Wyczyść'),
        ),
        box,
      ),
    );
    drawInst();
    drawStop();
    loadLogs();

    let pending = [];
    let raf = 0;
    const offs = [
      bus.on('log', (e) => {
        if (e.instanceId !== inst()?.id) return;
        if (filter && !e.line.toLowerCase().includes(filter)) return;
        pending.push(e);
        if (!raf)
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (box.firstChild?.classList?.contains('l-dim') && box.childNodes.length === 1) box.replaceChildren();
            box.append(...pending.map(line));
            pending = [];
            while (box.childNodes.length > 4000) box.firstChild.remove();
            if (follow) box.scrollTop = box.scrollHeight;
          });
      }),
      bus.on('game', () => (drawStop(), drawCrash())),
      bus.on('settings', () => (drawInst(), drawStop(), loadLogs())),
    ];
    return () => {
      cancelAnimationFrame(raf);
      offs.forEach((f) => f());
    };
  }

  HS.views.console = { title: 'Konsola', icon: 'terminal', render };
})();
