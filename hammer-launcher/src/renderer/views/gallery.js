'use strict';
/* Galeria – screenshots taken in game (F2) from every instance, with a full-screen viewer. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  function viewer(shots, start, onDelete) {
    let i = start;
    const img = h('img', { alt: '' });
    const title = h('b');
    const sub = h('span');
    const close = () => {
      document.removeEventListener('keydown', onKey);
      box.remove();
    };
    const show = (n) => {
      if (!shots.length) return close();
      i = (n + shots.length) % shots.length;
      const s = shots[i];
      img.src = s.url;
      title.textContent = s.instanceName;
      sub.textContent = `${new Date(s.takenAt).toLocaleString('pl-PL', { dateStyle: 'long', timeStyle: 'short' })} · ${i + 1} z ${shots.length}`;
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(i - 1);
      else if (e.key === 'ArrowRight') show(i + 1);
    };
    const s = () => shots[i];
    const box = h(
      'div.lightbox',
      { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Zrzut ekranu' },
      h(
        'div.lb-top',
        icon('image'),
        h('div.grow', title, ' ', sub),
        h('button.btn.sm', { onclick: () => attempt(() => api.gallery.copy(s().instanceId, s().file), 'Skopiowano obraz do schowka.') }, icon('copy'), 'Kopiuj'),
        h('button.btn.sm', { onclick: () => attempt(() => api.gallery.show(s().instanceId, s().file)) }, icon('folder'), 'Pokaż w folderze'),
        h(
          'button.btn.sm.danger',
          {
            onclick: async () => {
              const cur = s();
              if (!(await HS.confirmDialog({ title: 'Usunąć zrzut ekranu?', text: `${cur.file} zostanie usunięty z dysku.`, confirm: 'Usuń', danger: true }))) return;
              if (await attempt(() => api.gallery.remove(cur.instanceId, cur.file))) {
                shots.splice(i, 1);
                onDelete(cur);
                show(i);
              }
            },
          },
          icon('trash'),
          'Usuń',
        ),
        h('button.btn.ghost.sm.icon', { title: 'Zamknij', 'aria-label': 'Zamknij', onclick: close }, icon('close')),
      ),
      h('div.lb-img', { onclick: (e) => e.target.classList.contains('lb-img') && close() }, img, shots.length > 1 ? [h('button.lb-nav.prev', { 'aria-label': 'Poprzedni', onclick: () => show(i - 1) }, icon('chevron-right')), h('button.lb-nav.next', { 'aria-label': 'Następny', onclick: () => show(i + 1) }, icon('chevron-right'))] : null),
    );
    document.body.append(box);
    document.addEventListener('keydown', onKey);
    show(start);
  }

  function render(root) {
    let filter = '';
    let shots = [];
    let shown = 60;
    const grid = h('div');
    const count = h('span.dim', { style: { whiteSpace: 'nowrap' } });
    const sel = h('select.select', { style: { width: 'auto', minWidth: '220px' }, onchange: (e) => ((filter = e.target.value), (shown = 60), load()) });
    const drawSel = () =>
      clear(
        sel,
        h('option', { value: '' }, 'Wszystkie instancje'),
        state.instances.map((i) => h('option', { value: i.id, selected: i.id === filter }, i.name)),
      );

    function draw() {
      count.textContent = shots.length ? fmt.count(shots.length, 'zrzut', 'zrzuty', 'zrzutów') : '';
      if (!shots.length) {
        return clear(
          grid,
          h('div.card', HS.empty('image', 'Brak zrzutów ekranu', 'W grze naciśnij F2 – zrzut od razu pojawi się tutaj. Możesz go potem skopiować i wkleić np. na Discorda.', state.instance ? h('button.btn', { onclick: () => attempt(() => api.app.openFolder(filter || state.instance.id, 'screenshots')) }, icon('folder'), 'Otwórz folder') : null)),
        );
      }
      clear(
        grid,
        h(
          'div.shots',
          shots.slice(0, shown).map((s, idx) =>
            h(
              'button.shot',
              { title: s.file, onclick: () => viewer(shots, idx, () => draw()) },
              h('img', { src: s.url, alt: '', loading: 'lazy', decoding: 'async' }),
              h('div.meta', h('span.ellipsis', s.instanceName), h('span', fmt.ago(s.takenAt))),
            ),
          ),
        ),
        shots.length > shown ? h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: '14px' } }, h('button.btn', { onclick: () => ((shown += 60), draw()) }, icon('chevron-down'), `Pokaż więcej (${shots.length - shown})`)) : null,
      );
    }
    async function load() {
      clear(grid, h('div.shots', [1, 2, 3, 4, 5, 6].map(() => h('div.skeleton', { style: { aspectRatio: '16/9' } }))));
      try {
        shots = await api.gallery.list(filter || null);
      } catch (err) {
        shots = [];
        HS.toast('err', err.message);
      }
      draw();
    }

    clear(
      root,
      h(
        'div.page',
        h('div.page-head', h('div', h('h1', 'Galeria'), h('p', 'Twoje zrzuty ekranu ze wszystkich instancji. Kliknij, aby powiększyć, skopiować albo usunąć.')), h('div.actions', count, sel, h('button.btn.icon', { title: 'Odśwież', 'aria-label': 'Odśwież', onclick: load }, icon('refresh')))),
        grid,
      ),
    );
    drawSel();
    load();
    const off = bus.on('instances', drawSel);
    return off;
  }

  HS.views.gallery = { title: 'Galeria', icon: 'image', render };
})();
