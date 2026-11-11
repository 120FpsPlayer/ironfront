'use strict';
/* Skórka – the skin and cape of the signed-in Microsoft account, a library of skins used before, and with Hammer+:
   Zestawy (a skin + model + cape under one name) and the Hammer+ capes that Hammer Client shows. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  const MODELS = [
    { value: 'classic', label: 'Klasyczny', hint: 'szerokie ręce (Steve)' },
    { value: 'slim', label: 'Smukły', hint: 'wąskie ręce (Alex)' },
  ];
  const modelName = (v) => (v === 'slim' ? 'Smukły (wąskie ręce)' : 'Klasyczny (szerokie ręce)');

  /** Loads a picture and says whether it can be a skin: 64×64, or 64×32 in the old format. */
  function loadSkin(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth !== 64 || (img.naturalHeight !== 64 && img.naturalHeight !== 32)) reject(new Error(`Skórka musi mieć 64×64 pikseli (albo 64×32 w starym formacie) – ten obrazek ma ${img.naturalWidth}×${img.naturalHeight}.`));
        else resolve(img);
      };
      img.onerror = () => reject(new Error('To nie jest plik PNG. Skórka musi być obrazkiem PNG 64×64 pikseli.'));
      img.src = dataUrl;
    });
  }

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Nie udało się odczytać pliku.'));
      reader.readAsDataURL(file);
    });

  /** The window before a skin goes to the account: a preview, a name for the library and the arm model. */
  async function uploadDialog(picked, onDone) {
    let img;
    try {
      img = await loadSkin(picked.dataUrl);
    } catch (err) {
      return HS.toast('err', err.message, 7000);
    }
    const legacy = img.naturalHeight === 32;
    let model = !legacy && HS.looksSlim(img) ? 'slim' : 'classic';
    const name = h('input.input', { value: picked.name ?? '', maxLength: 40, placeholder: 'np. Rycerz w zbroi' });
    const stage = h('div.skin-stage.sm');
    const drawStage = () => clear(stage, HS.skinView(picked.dataUrl, { slim: model === 'slim', height: 204 }), HS.skinView(picked.dataUrl, { slim: model === 'slim', back: true, height: 204 }));
    drawStage();
    const save = h('button.btn.primary', { type: 'button' }, icon('check'), 'Ustaw skórkę');
    const m = HS.modal({
      title: 'Nowa skórka',
      icon: 'shirt',
      body: h(
        'div.skin-upload',
        stage,
        h(
          'div.form',
          HS.field('Nazwa w bibliotece', name, 'Pod tą nazwą znajdziesz skórkę w „Twoich skórkach”.'),
          h(
            'div.field',
            h('span', 'Model postaci'),
            legacy ? h('div.hint', 'To skórka w starym formacie 64×32 – zawsze ma szerokie ręce.') : HS.seg(MODELS.map((x) => ({ value: x.value, label: x.label })), model, (v) => ((model = v), drawStage())),
            legacy ? null : h('div.hint', 'Klasyczny ma ręce szerokie na 4 piksele (Steve), smukły na 3 (Alex). Wybierz ten, na którym rękawy wyglądają dobrze.'),
          ),
          h('p.hint', 'Skórkę zobaczą wszyscy gracze. Na serwerze pojawi się po ponownym wejściu.'),
        ),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), save],
    });
    save.onclick = () =>
      HS.busy(save, async () => {
        const res = await attempt(() => api.skins.upload({ png: picked.dataUrl, variant: model, name: name.value }), 'Gotowe – masz nową skórkę!');
        if (!res) return;
        m.close();
        onDone(res);
      });
    return undefined;
  }

  /** The window for a new outfit: a name, a skin of the library, the arm model and a cape of the account. */
  function outfitDialog(data, onDone) {
    const worn = data.library.find((s) => s.active) ?? data.library[0];
    let skin = worn;
    let model = data.skin?.libraryId === worn.id ? data.skin.variant : worn.variant;
    const name = h('input.input', { maxLength: 40, placeholder: 'np. Na PvP' });
    const stage = h('div.skin-stage.sm');
    const drawStage = () => clear(stage, HS.skinView(skin.dataUrl, { slim: model === 'slim', height: 170 }), HS.skinView(skin.dataUrl, { slim: model === 'slim', back: true, height: 170 }));
    drawStage();
    const modelBox = h('div');
    const drawModel = () => clear(modelBox, HS.seg(MODELS.map((x) => ({ value: x.value, label: x.label })), model, (v) => ((model = v), drawStage())));
    drawModel();
    const skinPick = HS.select(data.library.map((s) => ({ value: s.id, label: s.name })), skin.id, (id) => {
      skin = data.library.find((s) => s.id === id);
      model = skin.variant;
      drawModel();
      drawStage();
    });
    const capePick = HS.select([{ value: '', label: 'Bez peleryny' }, ...data.capes.map((c) => ({ value: c.id, label: c.name }))], data.capes.find((c) => c.active)?.id ?? '', () => {});
    const save = h('button.btn.primary', { type: 'button' }, icon('check'), 'Zapisz zestaw');
    const m = HS.modal({
      title: 'Nowy zestaw',
      icon: 'outfit',
      body: h(
        'div.skin-upload',
        stage,
        h(
          'div.form',
          HS.field('Nazwa zestawu', name),
          HS.field('Skórka', skinPick, 'Z Twojej biblioteki skórek.'),
          h('div.field', h('span', 'Model postaci'), modelBox),
          HS.field('Peleryna', capePick, data.capes.length ? 'Jedna z peleryn Twojego konta Minecraft.' : 'To konto nie ma jeszcze peleryn od Mojang.'),
        ),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), save],
    });
    save.onclick = () =>
      HS.busy(save, async () => {
        const cape = data.capes.find((c) => c.id === capePick.value);
        const list = await attempt(() => api.skins.saveOutfit({ name: name.value, skin: skin.id, variant: model, cape: cape?.id ?? null, capeName: cape?.name ?? '' }), 'Zestaw zapisany.');
        if (!list) return;
        m.close();
        onDone(list);
      });
    name.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());
  }

  function render(root) {
    const body = h('div');
    let data = null;
    let hammer = { capes: [], selected: '' }; // Peleryny Hammer+: the launcher's capes and the one picked
    let capeNote = null; // why the picked Hammer+ cape is not visible to other players yet
    let run = 0;
    let alive = true;

    const needLogin = (title, text) =>
      clear(body, h('div.card', HS.empty('shirt', title, text, h('button.btn.primary', { onclick: () => HS.login() }, icon('user-plus'), 'Zaloguj się kontem Microsoft'))));

    /** The new state after a change: redraw, and let the sidebar show the new head. */
    async function show(res) {
      if (!alive) return;
      data = { outfits: [], ...res };
      draw();
      await state.refreshAccounts().catch(() => {});
    }

    async function pick() {
      const picked = await attempt(() => api.skins.pick());
      if (picked) uploadDialog(picked, show);
    }

    function skinCard() {
      const skin = data.skin;
      const src = skin?.dataUrl ?? skin?.url;
      const slim = skin?.variant === 'slim';
      const upload = h('button.btn.primary', { onclick: pick }, icon('upload'), 'Wgraj skórkę');
      const reset = h('button.btn', { disabled: !src, title: src ? 'Zdejmij skórkę z konta' : 'Masz już domyślną skórkę' }, icon('undo'), 'Przywróć domyślną');
      reset.onclick = async () => {
        if (!(await HS.confirmDialog({ title: 'Przywrócić domyślną skórkę?', text: 'Twoja postać dostanie jedną z domyślnych skórek Minecrafta (np. Steve albo Alex). Obecna skórka zostanie w „Twoich skórkach” – wrócisz do niej jednym kliknięciem.', confirm: 'Przywróć domyślną' }))) return;
        HS.busy(reset, async () => {
          const res = await attempt(() => api.skins.reset(), 'Przywrócono domyślną skórkę.');
          if (res) show(res);
        });
      };
      return h(
        'section.card.skin-card',
        h('div.card-head', icon('shirt'), h('h2.grow', 'Twoja skórka'), HS.chip(data.account.name, 'accent', 'user')),
        src
          ? h('div.skin-stage', HS.skinView(src, { slim, height: 272 }), HS.skinView(src, { slim, back: true, height: 272 }))
          : h('div.skin-stage.none', icon('user'), h('p', 'Masz domyślną skórkę Minecrafta.')),
        h('div.skin-meta', src ? HS.chip(modelName(skin.variant), null, 'user') : null, h('span.dim', 'przód i tył')),
        h('div.skin-acts', upload, reset),
        h('p.hint', 'Przeciągnij tutaj plik PNG 64×64 albo kliknij „Wgraj skórkę”. Zmiana trafia na konto Microsoft – widzą ją wszyscy gracze.'),
      );
    }

    function libraryCard() {
      const list = data.library;
      const limit = data.limit ?? 24;
      return h(
        'section.card',
        h(
          'div.card-head',
          icon('history'),
          h('h2.grow', 'Twoje skórki'),
          h('span.dim', { style: { fontSize: '12.5px' }, title: `Launcher pamięta ${limit} ostatnio noszonych skórek` }, list.length ? `${list.length} z ${limit}` : ''),
          HS.plusOn() ? null : HS.plusUi.lockChip('200 w Hammer+'),
        ),
        list.length
          ? h(
              'div.skin-grid',
              list.map((s) => {
                const wear = h('button.btn.sm.primary', { title: `Załóż skórkę „${s.name}”` }, 'Załóż');
                wear.onclick = () =>
                  HS.busy(wear, async () => {
                    const res = await attempt(() => api.skins.use(s.id), `Założono skórkę „${s.name}”.`);
                    if (res) show(res);
                  });
                return h(
                  `div.skin-tile${s.active ? '.on' : ''}`,
                  HS.skinView(s.dataUrl, { slim: s.variant === 'slim', height: 112 }),
                  HS.raw(h('b.ellipsis', { title: s.name }, s.name)),
                  h('small', s.variant === 'slim' ? 'smukły' : 'klasyczny'),
                  h(
                    'div.row',
                    s.active ? HS.chip('Na sobie', 'ok', 'check') : wear,
                    h(
                      'button.btn.ghost.sm.icon.danger',
                      {
                        title: 'Usuń z biblioteki',
                        'aria-label': `Usuń z biblioteki: ${s.name}`,
                        onclick: async () => {
                          const used = data.outfits.filter((o) => o.skin === s.id).length;
                          if (!(await HS.confirmDialog({ title: 'Usunąć skórkę z biblioteki?', text: `„${s.name}” zniknie z launchera.${s.active ? ' Na koncie zostanie – nadal będziesz ją nosić.' : ''}${used ? ` Razem z nią ${used === 1 ? 'zniknie zestaw, w którym jest' : 'znikną zestawy, w których jest'}.` : ''}`, confirm: 'Usuń', danger: true }))) return;
                          if ((await attempt(() => api.skins.forget(s.id))) === undefined) return;
                          data.library = data.library.filter((x) => x.id !== s.id);
                          data.outfits = data.outfits.filter((o) => o.skin !== s.id);
                          draw();
                        },
                      },
                      icon('trash'),
                    ),
                  ),
                );
              }),
            )
          : h('p.muted', { style: { fontSize: '13px' } }, 'Tu pojawi się każda skórka, którą założysz – żeby łatwo do niej wrócić.'),
      );
    }

    function capesCard() {
      const capes = data.capes;
      const active = capes.find((c) => c.active);
      const set = (btn, capeId, okText) =>
        HS.busy(btn, async () => {
          const res = await attempt(() => api.skins.cape(capeId), okText);
          if (res) show(res);
        });
      return h(
        'section.card',
        h('div.card-head', icon('crown'), h('h2.grow', 'Peleryny'), capes.length ? h('span.dim', { style: { fontSize: '12.5px' } }, active ? `Nosisz: ${active.name}` : 'Bez peleryny') : null),
        capes.length
          ? h(
              'div.rows',
              capes.map((c) =>
                h(
                  `div.installed-row.cape-row${c.active ? '.on' : ''}`,
                  h('div.cape-pic', c.url ? HS.capeView(c.url, 48) : icon('crown')),
                  h('div.grow', h('b.ellipsis', c.name), h('small', c.active ? 'Widoczna w grze' : 'Ukryta')),
                  c.active
                    ? [HS.chip('Na sobie', 'ok', 'check'), h('button.btn.sm', { onclick: (e) => set(e.currentTarget, null, 'Ukryto pelerynę.') }, icon('eye-off'), 'Ukryj')]
                    : h('button.btn.sm.primary', { onclick: (e) => set(e.currentTarget, c.id, `Założono pelerynę „${c.name}”.`) }, icon('eye'), 'Pokaż'),
                ),
              ),
            )
          : h('p.muted', { style: { fontSize: '13px' } }, 'To konto nie ma jeszcze żadnej peleryny. Peleryny rozdaje Mojang – np. za udział w wydarzeniach albo migrację konta.'),
      );
    }

    /** Zestawy (Hammer+): looks saved under a name – put on with one click. */
    function outfitsCard() {
      const on = HS.plusOn();
      const list = data.outfits;
      const add = h('button.btn.sm', { type: 'button', disabled: !data.library.length, title: data.library.length ? 'Zapisz skórkę, model i pelerynę pod jedną nazwą' : 'Najpierw załóż jakąś skórkę', onclick: () => outfitDialog(data, (outfits) => ((data.outfits = outfits), draw())) }, icon('plus'), 'Nowy zestaw');
      const tile = (o) => {
        const wear = h('button.btn.sm.primary', { type: 'button', title: `Załóż zestaw „${o.name}”` }, 'Załóż');
        wear.onclick = () =>
          HS.busy(wear, async () => {
            const res = await attempt(() => api.skins.applyOutfit(o.id));
            if (!res) return;
            HS.toast(res.warning ? 'warning' : 'ok', res.warning ?? `Założono zestaw „${o.name}”.`, res.warning ? 9000 : 4200);
            show(res);
          });
        const worn = data.skin?.libraryId === o.skin && data.skin.variant === o.variant && (data.capes.find((c) => c.active)?.id ?? null) === o.cape;
        return h(
          `div.outfit-tile${worn ? '.on' : ''}`,
          HS.skinView(o.dataUrl, { slim: o.variant === 'slim', height: 112 }),
          HS.raw(h('b.ellipsis', { title: o.name }, o.name)),
          h('small.ellipsis', { title: o.skinName }, `${o.variant === 'slim' ? 'smukły' : 'klasyczny'} · ${o.cape ? o.capeName : 'bez peleryny'}`),
          h(
            'div.row',
            worn ? HS.chip('Na sobie', 'ok', 'check') : HS.plusUi.locked(wear),
            h(
              'button.btn.ghost.sm.icon.danger',
              {
                type: 'button',
                title: 'Usuń zestaw',
                'aria-label': `Usuń zestaw: ${o.name}`,
                onclick: async () => {
                  if (!(await HS.confirmDialog({ title: 'Usunąć zestaw?', text: `Zestaw „${o.name}” zniknie. Skórka zostaje w bibliotece.`, confirm: 'Usuń', danger: true }))) return;
                  const left = await attempt(() => api.skins.removeOutfit(o.id));
                  if (left) ((data.outfits = left), draw());
                },
              },
              icon('trash'),
            ),
          ),
        );
      };
      return h(
        'section.card',
        h('div.card-head', icon('outfit'), h('h2.grow', 'Zestawy'), list.length ? h('span.dim', { style: { fontSize: '12.5px' } }, fmt.count(list.length, 'zestaw', 'zestawy', 'zestawów')) : null, on ? add : HS.plusUi.lockChip()),
        list.length
          ? h('div.skin-grid', list.map(tile))
          : h('p.muted', { style: { fontSize: '13px' } }, on ? 'Zestaw to skórka, model postaci i peleryna pod jedną nazwą, np. „Na PvP” albo „Na budowanie”. Kliknij „Nowy zestaw”, a potem zakładaj wszystko jednym kliknięciem.' : 'Zestaw to skórka, model postaci i peleryna pod jedną nazwą – zakładasz wszystko jednym kliknięciem. Zestawy są częścią Hammer+.'),
      );
    }

    /** Peleryny Hammer+: the launcher's own capes, drawn by Hammer Client in the game. */
    function hammerCapesCard() {
      const on = HS.plusOn();
      const selected = on ? hammer.selected : '';
      const picked = hammer.capes.find((c) => c.id === selected);
      const pick = (el, id, okText) =>
        HS.busy(el, async () => {
          const res = await attempt(() => api.plus.setCape(id), okText);
          if (!res) return;
          hammer = { ...hammer, selected: res.selected };
          capeNote = res.selected && !res.shared ? res.note : null;
          draw();
        });
      const tile = (c) => {
        const mine = c.id === selected;
        const el = h(
          `button.hcape${mine ? '.on' : ''}`,
          { type: 'button', 'aria-pressed': String(mine), title: mine ? `Nosisz pelerynę „${c.name}”` : `Załóż pelerynę „${c.name}”`, onclick: () => (on ? !mine && pick(el, c.id, `Założono pelerynę „${c.name}”.`) : HS.go('plus')) },
          HS.capeView(`assets/capes/${c.id}.png`, 80),
          h('b', c.name),
          mine ? HS.chip('Na sobie', 'gold', 'check') : h('small', on ? 'Załóż' : 'Hammer+'),
        );
        return el;
      };
      const none = h(
        `button.hcape${on && !selected ? '.on' : ''}`,
        { type: 'button', 'aria-pressed': String(on && !selected), title: 'Graj bez peleryny Hammer+', onclick: () => (on ? selected && pick(none, null, 'Zdjęto pelerynę Hammer+.') : HS.go('plus')) },
        h('div.none', icon('eye-off')),
        h('b', 'Bez peleryny'),
        on && !selected ? HS.chip('Wybrane', null, 'check') : h('small', on ? 'Zdejmij' : 'Hammer+'),
      );
      return h(
        'section.card',
        h('div.card-head', icon('crown'), h('h2.grow', 'Peleryny Hammer+'), on ? h('span.dim', { style: { fontSize: '12.5px' } }, picked ? `Nosisz: ${picked.name}` : 'Bez peleryny') : HS.plusUi.lockChip()),
        h('div.hcape-grid', hammer.capes.map(tile), none),
        capeNote ? h('p.cloud-note', icon('info'), `Peleryna jest zapisana. ${capeNote}`) : null,
        h('p.hint', { style: { marginTop: '12px' } }, 'Pelerynę Hammer+ rysuje Hammer Client: widzisz ją Ty i gracze, którzy też mają Hammer Client. W zwykłym Minecrafcie (vanilla) jej nie widać – tam działają tylko peleryny od Mojang z karty powyżej.'),
      );
    }

    function draw() {
      if (!data) return;
      const wrap = h('div.skin-page', skinCard(), h('div.grid', libraryCard(), outfitsCard(), capesCard(), hammer.capes.length ? hammerCapesCard() : null));
      // A skin file dropped anywhere on the page.
      let depth = 0;
      wrap.addEventListener('dragenter', (e) => (e.preventDefault(), depth++, wrap.classList.add('dragging')));
      wrap.addEventListener('dragover', (e) => e.preventDefault());
      wrap.addEventListener('dragleave', () => --depth <= 0 && ((depth = 0), wrap.classList.remove('dragging')));
      wrap.addEventListener('drop', async (e) => {
        e.preventDefault();
        depth = 0;
        wrap.classList.remove('dragging');
        const file = e.dataTransfer?.files?.[0];
        if (!file) return;
        if (!/\.png$/i.test(file.name) || file.size > 1024 * 1024) return HS.toast('warning', 'Upuść plik PNG ze skórką (64×64 pikseli).');
        const dataUrl = await attempt(() => readFile(file));
        if (dataUrl) uploadDialog({ name: file.name.replace(/\.png$/i, '').slice(0, 40), dataUrl }, show);
        return undefined;
      });
      clear(body, wrap);
    }

    // Which account (and whether it is signed in) the page was loaded for – it loads again only when that changes.
    const accountKey = () => `${state.account?.id ?? ''}|${state.account?.needsLogin ? 'expired' : 'ok'}`;
    let loadedFor = null;
    async function load() {
      const account = state.account;
      const my = ++run;
      loadedFor = accountKey();
      data = null;
      if (!account) return needLogin('Zaloguj się, żeby zmienić skórkę', 'Skórka należy do konta Microsoft – po zalogowaniu zobaczysz ją tutaj i zmienisz jednym kliknięciem.');
      if (account.needsLogin) return needLogin('Sesja wygasła', `Zaloguj się ponownie na konto ${account.name}, żeby zobaczyć i zmienić skórkę.`);
      clear(body, h('div.skin-page', h('div.skeleton', { style: { height: '470px' } }), h('div.grid', h('div.skeleton', { style: { height: '250px' } }), h('div.skeleton', { style: { height: '140px' } }))));
      try {
        const [res, capes] = await Promise.all([api.skins.get(), api.plus.capes().catch(() => ({ capes: [], selected: '' }))]);
        if (my !== run || !alive) return undefined;
        data = { outfits: [], ...res };
        hammer = capes;
        draw();
        // The head in the sidebar follows a skin changed somewhere else (minecraft.net, the official launcher).
        if ((account.skinUrl ?? null) !== (res.skin?.url ?? null)) state.refreshAccounts().catch(() => {});
      } catch (err) {
        if (my !== run || !alive) return undefined;
        clear(body, h('div.card', HS.empty('warning', 'Nie udało się wczytać skórki', err.message, h('div.row', h('button.btn', { onclick: load }, icon('refresh'), 'Spróbuj ponownie'), /zaloguj/i.test(err.message) ? h('button.btn.primary', { onclick: () => HS.login() }, icon('user-plus'), 'Zaloguj się') : null))));
        if (/zaloguj/i.test(err.message)) state.refreshAccounts().catch(() => {});
      }
      return undefined;
    }

    clear(
      root,
      h(
        'div.page',
        h(
          'div.page-head',
          h('div', h('h1', 'Skórka'), h('p', 'Wygląd Twojej postaci – skórka i peleryna konta Microsoft, bez wchodzenia na minecraft.net.')),
          h('div.actions', h('button.btn.icon', { title: 'Odśwież', 'aria-label': 'Odśwież skórkę', onclick: () => load() }, icon('refresh'))),
        ),
        body,
      ),
    );
    load();

    // Another account was picked, or the player signed in again → that account's skin.
    const off = bus.on('accounts', () => {
      if (accountKey() !== loadedFor) load();
    });
    return () => {
      alive = false;
      run += 1;
      off();
    };
  }

  HS.views.skin = { title: 'Skórka', icon: 'shirt', render };
})();
