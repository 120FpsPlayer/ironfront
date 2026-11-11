'use strict';
/* Galeria – screenshots taken in game (F2) from every instance, with a full-screen viewer. From the viewer a
   screenshot can be shared as a link: it is uploaded to an outside host (launcher.config.json → screenshotShare),
   after the player has read what that means and said yes. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  let openFilter = null; // HS.openGallery(instanceId): the instance the next visit shows
  let shareInfo = null; // { available, hours, service, ask } – asked once per visit of the tab

  const hoursText = (n) => `${n} ${fmt.plural(n, 'godzinie', 'godzinach', 'godzinach')}`;

  /**
   * The question before a screenshot leaves the computer, in plain words. Resolves { remember } on yes
   * (remember = „Nie pytaj ponownie” was ticked), null on no.
   */
  function consentDialog(info) {
    return new Promise((resolve) => {
      let done = false;
      const again = h('input', { type: 'checkbox' });
      const finish = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const point = (ic, title, text) => h('div.why-item', h('span.why-icon', icon(ic)), h('div', h('b', title), h('p', text)));
      const cancel = h('button.btn.ghost', { type: 'button', onclick: () => finish(null) }, 'Anuluj');
      const m = HS.modal({
        title: 'Udostępnić ten zrzut ekranu jako link?',
        icon: 'link',
        body: h(
          'div.why',
          point('upload', 'Obraz opuści Twój komputer', `Launcher wyśle ten zrzut ekranu do serwisu ${info.service} i skopiuje link do niego.`),
          point('globe', 'To zewnętrzny serwis', 'Nie prowadzi go HammerShop – nie mamy wpływu na to, co się tam dzieje z plikami.'),
          point('eye', 'Zobaczy go każdy, kto ma link', 'Link nie ma hasła. Nie wysyłaj zrzutów, na których widać coś prywatnego.'),
          point('clock', `Zniknie po ${hoursText(info.hours)}`, 'Wcześniej nie da się go usunąć – wysłania nie można cofnąć.'),
          h('label.check', { style: { marginTop: '4px' } }, again, 'Nie pytaj ponownie'),
        ),
        foot: [cancel, h('button.btn.primary', { type: 'button', onclick: () => finish({ remember: again.checked }) }, icon('upload'), 'Wyślij i skopiuj link')],
        onClose: () => finish(null),
      });
      // A stray Enter must not send anything: the keyboard starts on „Anuluj”.
      setTimeout(() => cancel.isConnected && cancel.focus(), 60);
    });
  }

  /** The link, once the upload is done (it is on the clipboard already). */
  function linkDialog(res) {
    const until = new Date(res.expiresAt).toLocaleString(HS.locale(), { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    const m = HS.modal({
      title: 'Link do zrzutu ekranu',
      icon: 'check-circle',
      body: h(
        'div.form',
        h('p.muted', 'Link jest w schowku – wklej go np. na Discordzie.'),
        h('div.row', h('input.input', { value: res.url, readOnly: true, 'aria-label': 'Link do zrzutu ekranu', onfocus: (e) => e.target.select() }), h('button.btn.primary', { type: 'button', onclick: () => HS.copyText(res.url, 'Skopiowano link do zrzutu ekranu.') }, icon('copy'), 'Kopiuj link')),
        h('div.hint', `Obraz zniknie po ${hoursText(res.hours)} – ${until}. Do tego czasu zobaczy go każdy, kto dostanie link.`),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => HS.open(res.url) }, icon('external'), 'Otwórz w przeglądarce'), h('button.btn', { type: 'button', onclick: () => m.close() }, 'Gotowe')],
    });
  }

  /** „Udostępnij link”: the question (unless the player switched it off), the upload, the link on the clipboard. */
  async function shareLink(shot, btn) {
    const info = shareInfo;
    if (!info?.available) return;
    let consent = null;
    if (info.ask) {
      consent = await consentDialog(info);
      if (!consent) return;
    }
    const res = await HS.busy(btn, () => attempt(() => api.gallery.share(shot.instanceId, shot.file, consent ? { agreed: true, remember: consent.remember } : {})));
    if (consent?.remember) {
      shareInfo = { ...info, ask: false };
      state.settings = await api.settings.get().catch(() => state.settings); // the switch in Ustawienia follows
    }
    if (!res?.url) return;
    await HS.copyText(res.url, 'Link do zrzutu ekranu jest w schowku.');
    linkDialog(res);
  }

  function viewer(shots, start, onDelete) {
    let i = start;
    const img = h('img', { alt: '' });
    const title = HS.raw(h('b')); // the instance's name
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
      sub.textContent = `${new Date(s.takenAt).toLocaleString(HS.locale(), { dateStyle: 'long', timeStyle: 'short' })} · ${i + 1} z ${shots.length}`;
    };
    const onKey = (e) => {
      if (document.querySelector('#modal-root .overlay')) return; // a dialog is open on top: the keys are its own
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
        h('div.grow.ellipsis', title, ' ', sub),
        // Only when a host is configured (launcher.config.json → screenshotShare.url).
        shareInfo?.available ? h('button.btn.sm', { title: 'Wyślij zrzut do zewnętrznego serwisu i skopiuj link', onclick: (e) => shareLink(s(), e.currentTarget) }, icon('link'), 'Udostępnij link') : null,
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
    let filter = openFilter && state.instances.some((i) => i.id === openFilter) ? openFilter : '';
    openFilter = null;
    shareInfo = null;
    api.gallery.shareInfo().then((info) => (shareInfo = info), () => (shareInfo = null));
    let shots = [];
    let shown = 60;
    const grid = h('div');
    const count = h('span.dim', { style: { whiteSpace: 'nowrap' } });
    const sel = h('select.select', { style: { width: 'auto', minWidth: '220px' }, onchange: (e) => ((filter = e.target.value), (shown = 60), load()) });
    const drawSel = () =>
      clear(
        sel,
        h('option', { value: '' }, 'Wszystkie instancje'),
        state.instances.map((i) => HS.raw(h('option', { value: i.id, selected: i.id === filter }, i.name))),
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
              h('div.meta', HS.raw(h('span.ellipsis', s.instanceName)), h('span', fmt.ago(s.takenAt))),
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

  /** Opens the Galeria tab showing the screenshots of one instance. */
  HS.openGallery = (instanceId) => {
    openFilter = instanceId ?? null;
    HS.go('gallery');
  };
  HS.views.gallery = { title: 'Galeria', icon: 'image', render };
})();
