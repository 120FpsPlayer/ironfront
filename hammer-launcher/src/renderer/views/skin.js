'use strict';
/* Skórka – the skin of the signed-in Microsoft account, a library of skins used before, Zestawy (Hammer+: a skin +
   model + cape under one name) and Peleryny: one grid with the account's Mojang capes, the Hammer capes (two for
   everybody, the rest – the moving ones too – with Hammer+: dark, with a lock) and one's own cape (Hammer+), plus the
   on/off switch. Right under it Dodatki (Hammer+): wings, a halo and a hat Hammer Client draws on the player. */

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
    let hammer = { capes: [], selected: '', on: true, lastMojang: '', custom: null, plus: false }; // Peleryny (api.plus.capes)
    let capeNote = null; // why the picked cape is not visible to other players (yet)
    let looks = { items: [], wings: '', halo: false, hat: '', plus: false }; // Dodatki (api.plus.cosmetics)
    let lookNote = null; // why the cosmetics are not visible to other players (yet)
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
          ? h('div.skin-stage', HS.skinView(src, { slim, height: 272, look: lookFor('front') }), HS.skinView(src, { slim, back: true, height: 272, cape: worn()?.src ?? null, capeFrames: worn()?.frames ?? 1, capeFps: worn()?.fps ?? 10, look: lookFor('back') }))
          : h('div.skin-stage.none', icon('user'), h('p', 'Masz domyślną skórkę Minecrafta.')),
        h('div.skin-meta', src ? HS.chip(modelName(skin.variant), null, 'user') : null, worn() ? HS.chip(worn().name, 'gold', 'crown') : null, h('span.dim', 'przód i tył')),
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

    /** The cape the player wears now: { kind: 'custom' | 'hammer' | 'mojang', src, name } or null (switched off / none). */
    function worn() {
      if (!data || !hammer.on) return null;
      if (hammer.selected === 'custom' && hammer.custom) return { kind: 'custom', src: hammer.custom, name: 'Własna peleryna' };
      const own = hammer.selected && hammer.capes.find((c) => c.id === hammer.selected);
      if (own) return { kind: 'hammer', id: own.id, src: `assets/capes/${own.id}.png`, name: own.name, frames: own.frames ?? 1, fps: own.fps ?? 10 };
      const mojang = data.capes.find((c) => c.active);
      return mojang ? { kind: 'mojang', id: mojang.id, src: mojang.url, name: mojang.name } : null;
    }

    /**
     * Peleryny: one grid – the account's capes from Mojang (seen in plain Minecraft too), the Hammer capes (two for
     * everybody; the rest dark with a lock until Hammer+) and one's own cape (Hammer+) – and the on/off switch.
     */
    function capesCard() {
      const on = hammer.on;
      const plus = hammer.plus;
      const now = worn();
      const after = (res, okText) => {
        if (!res) return;
        hammer = { ...hammer, ...res };
        capeNote = res.note ?? null;
        if (okText) HS.toast('ok', okText);
        draw();
      };
      const mojangActive = () => data.capes.find((c) => c.active)?.id ?? '';
      // A Hammer cape (or one's own): Hammer Client draws it over a Mojang cape, which plain Minecraft still shows.
      const wearHammer = (el, id, okText) => HS.busy(el, async () => after(await attempt(() => api.plus.setCape(id)), okText));
      // A Mojang cape: the Hammer cape comes off, so everybody sees the same one.
      const wearMojang = (el, cape) =>
        HS.busy(el, async () => {
          if (hammer.selected) after(await attempt(() => api.plus.setCape(null)));
          if (!hammer.on) after(await attempt(() => api.plus.setCapeOn(true, '')));
          const res = await attempt(() => api.skins.cape(cape.id), `Założono pelerynę „${cape.name}”.`);
          if (res) show(res);
        });
      const sw = HS.toggle(on, async (value) => {
        if (!value) {
          const was = mojangActive();
          if (was) {
            const res = await attempt(() => api.skins.cape(null));
            if (res) data = { outfits: [], ...res };
          }
          after(await attempt(() => api.plus.setCapeOn(false, was)), 'Peleryna wyłączona.');
          return;
        }
        const res = await attempt(() => api.plus.setCapeOn(true));
        after(res, 'Peleryna włączona.');
        if (res && !res.selected && res.lastMojang && data.capes.some((c) => c.id === res.lastMojang)) {
          const back = await attempt(() => api.skins.cape(res.lastMojang));
          if (back) show(back);
        }
      });
      sw.title = on ? 'Wyłącz pelerynę' : 'Włącz pelerynę';
      const tile = ({ key, pic, name, sub, active, locked = false, title, onClick }) => {
        const el = h(
          `button.hcape${active ? '.on' : ''}${locked ? '.locked' : ''}${on ? '' : '.off'}`,
          { type: 'button', 'aria-pressed': String(active), title, 'data-cape': key, onclick: () => onClick(el) },
          h('div.hcape-pic', pic, locked ? h('span.hcape-lock', { 'aria-hidden': 'true' }, icon('lock')) : null),
          h('b.ellipsis', name),
          active ? HS.chip('Na sobie', 'gold', 'check') : h('small', locked ? 'Hammer+' : sub),
        );
        return el;
      };
      const tiles = [
        ...data.capes.map((c) =>
          tile({
            key: `mojang:${c.id}`, pic: c.url ? HS.capeView(c.url, 80) : h('div.none', icon('crown')), name: c.name, sub: 'Mojang', title: `Peleryna „${c.name}” od Mojang – widać ją też w zwykłym Minecrafcie`,
            active: now?.kind === 'mojang' && now.id === c.id,
            onClick: (el) => !(now?.kind === 'mojang' && now.id === c.id) && wearMojang(el, c),
          }),
        ),
        ...hammer.capes.map((c) => {
          const locked = !c.free && !plus;
          const active = now?.kind === 'hammer' && now.id === c.id;
          return tile({
            key: c.id, pic: HS.capeView(`assets/capes/${c.id}.png`, 80, { frames: c.frames ?? 1, fps: c.fps ?? 10 }), name: c.name, sub: c.free ? 'Za darmo' : c.frames ? 'Ruchoma' : 'Załóż', locked, active,
            title: locked ? `„${c.name}” – peleryna Hammer+` : active ? `Nosisz pelerynę „${c.name}”` : `Załóż pelerynę „${c.name}”`,
            onClick: (el) => (locked ? HS.go('plus') : !active && wearHammer(el, c.id, `Założono pelerynę „${c.name}”.`)),
          });
        }),
      ];
      // One's own cape (Hammer+): a PNG in the cape layout – worn at once.
      const ownActive = now?.kind === 'custom';
      const own = !plus
        ? tile({ key: 'custom', pic: h('div.none', icon('upload')), name: 'Własna', sub: 'Hammer+', locked: true, active: false, title: 'Własna peleryna z Twojego obrazka – część Hammer+', onClick: () => HS.go('plus') })
        : hammer.custom
          ? tile({ key: 'custom', pic: HS.capeView(hammer.custom, 80), name: 'Własna', sub: 'Załóż', active: ownActive, title: ownActive ? 'Nosisz własną pelerynę' : 'Załóż własną pelerynę', onClick: (el) => !ownActive && wearHammer(el, 'custom', 'Założono własną pelerynę.') })
          : tile({ key: 'custom', pic: h('div.none', icon('upload')), name: 'Własna', sub: 'Wgraj PNG', active: false, title: 'Wgraj własną pelerynę (PNG 64×32)', onClick: (el) => HS.busy(el, async () => after(await attempt(() => api.plus.pickCape()), 'Twoja peleryna jest gotowa.')) });
      const ownActs = plus && hammer.custom
        ? h(
            'div.row.cape-own-acts',
            h('button.btn.sm', { type: 'button', onclick: (e) => HS.busy(e.currentTarget, async () => after(await attempt(() => api.plus.pickCape()), 'Twoja peleryna jest zmieniona.')) }, icon('upload'), 'Zmień własną'),
            h('button.btn.sm.ghost.danger', { type: 'button', onclick: async (e) => {
              const btn = e.currentTarget;
              if (!(await HS.confirmDialog({ title: 'Usunąć własną pelerynę?', text: 'Obrazek peleryny zniknie z launchera. Zawsze możesz wgrać go ponownie.', confirm: 'Usuń', danger: true }))) return;
              HS.busy(btn, async () => after(await attempt(() => api.plus.removeCape()), 'Usunięto własną pelerynę.'));
            } }, icon('trash'), 'Usuń'),
          )
        : null;
      return h(
        'section.card.capes-card',
        h(
          'div.card-head',
          icon('crown'),
          h('h2.grow', 'Peleryny'),
          h('span.dim', { style: { fontSize: '12.5px' } }, on ? (now ? `Nosisz: ${now.name}` : 'Bez peleryny') : 'Wyłączona'),
          h('label.cape-switch', h('span', on ? 'Wł.' : 'Wył.'), sw),
        ),
        h('div.hcape-grid', tiles, own),
        ownActs,
        capeNote ? h('p.cloud-note', icon('info'), capeNote) : null,
        h('p.hint', { style: { marginTop: '12px' } }, 'Peleryny Hammer rysuje Hammer Client – widzisz je Ty i gracze, którzy też mają Hammer Client. Peleryny od Mojang widać też w zwykłym Minecrafcie. Ciemne z kłódką odblokujesz z Hammer+.'),
      );
    }

    /* ── Dodatki (Hammer+): wings, a halo and a hat – tiles like the capes, one choice per row ── */
    /** The flat pictures of what is worn, for one side of the skin preview: [{ src, x, y, w, h, under }]. */
    function lookFor(view) {
      const worn = [looks.wings, looks.halo ? 'halo' : '', looks.hat].filter(Boolean);
      const out = looks.items.filter((c) => worn.includes(c.id) && c[view]).map((c) => ({ id: c.id, slot: c.slot, src: `assets/cosmetics/${c.id}-${view}.png`, ...c[view] }));
      // Like in the game, the halo floats above the hat (its ring is the middle of its picture).
      const hat = out.find((o) => o.slot === 'hat');
      const halo = out.find((o) => o.slot === 'halo');
      if (hat && halo) halo.y = Math.min(halo.y, hat.y - 0.5 - halo.h * 0.75);
      return out;
    }
    /** What a cosmetic is called on its own: wings get their noun („Anielskie skrzydła”). */
    const fullName = (c) => (c.slot === 'wings' ? `${c.name} skrzydła` : c.name);

    function cosmeticsCard() {
      const plus = looks.plus;
      const after = (res, okText) => {
        if (!res) return;
        looks = { ...looks, ...res };
        lookNote = res.note ?? null;
        if (okText) HS.toast('ok', okText);
        draw();
      };
      const PUT_ON = { wings: 'Założono skrzydła.', halo: 'Założono aureolę.', hat: 'Założono czapkę.' };
      const TAKE_OFF = { wings: 'Zdjęto skrzydła.', halo: 'Zdjęto aureolę.', hat: 'Zdjęto czapkę.' };
      const wear = (el, slot, value) => HS.busy(el, async () => after(await attempt(() => api.plus.setCosmetic(slot, value)), value ? PUT_ON[slot] : TAKE_OFF[slot]));
      const tile = ({ key, pic, name, sub, active, locked = false, title, onClick }) => {
        const el = h(
          `button.hcos${active ? '.on' : ''}${locked ? '.locked' : ''}`,
          { type: 'button', 'aria-pressed': String(active), title, 'data-cosmetic': key, onclick: () => onClick(el) },
          h('div.hcos-frame', pic, locked ? h('span.hcos-lock', { 'aria-hidden': 'true' }, icon('lock')) : null),
          h('b.ellipsis', name),
          active ? HS.chip('Na sobie', 'gold', 'check') : h('small', locked ? 'Hammer+' : sub),
        );
        return el;
      };
      const row = (slot, title, noneLabel) => {
        const current = slot === 'halo' ? (looks.halo ? 'halo' : '') : looks[slot];
        const none = tile({ key: `${slot}:none`, pic: h('div.hcos-pic.none', icon('close')), name: noneLabel, sub: 'Zdejmij', active: !current, title: noneLabel, onClick: (el) => current && wear(el, slot, slot === 'halo' ? false : '') });
        const items = looks.items
          .filter((c) => c.slot === slot)
          .map((c) => {
            const active = current === c.id;
            const locked = !plus;
            return tile({
              key: c.id, pic: h('div.hcos-pic', h('img', { src: `assets/cosmetics/${c.id}-${slot === 'wings' ? 'back' : 'front'}.png`, alt: '', draggable: 'false' })), name: c.name, sub: 'Załóż', active, locked,
              title: locked ? 'Dodatek Hammer+ – kliknij, żeby zobaczyć Hammer+' : active ? 'Masz to na sobie' : 'Kliknij, żeby założyć',
              onClick: (el) => (locked ? HS.go('plus') : !active && wear(el, slot, slot === 'halo' ? true : c.id)),
            });
          });
        return h('div.hcos-row', h('h3.hcos-title', title), h('div.hcos-grid', none, items));
      };
      const wornNames = looks.items.filter((c) => [looks.wings, looks.halo ? 'halo' : '', looks.hat].includes(c.id)).map(fullName);
      return h(
        'section.card.cosmetics-card',
        h(
          'div.card-head',
          icon('sparkles'),
          h('h2.grow', 'Dodatki'),
          h('span.dim.hcos-worn', ...(wornNames.length ? wornNames.flatMap((n, i) => [i ? ' · ' : null, h('span', n)]) : ['Bez dodatków'])),
          plus ? null : HS.chip('Hammer+', 'gold', 'lock'),
        ),
        row('wings', 'Skrzydła', 'Bez skrzydeł'),
        row('halo', 'Aureola', 'Bez aureoli'),
        row('hat', 'Czapka', 'Bez czapki'),
        lookNote ? h('p.cloud-note', icon('info'), lookNote) : null,
        h('p.hint', { style: { marginTop: '12px' } }, plus ? 'Skrzydła, aureolę i czapkę rysuje Hammer Client – widzisz je Ty i gracze, którzy też mają Hammer Client. Skrzydła machają, a w locie biją szybciej.' : 'Skrzydła, aureolę i czapkę rysuje Hammer Client – widzisz je Ty i gracze, którzy też mają Hammer Client. Dodatki odblokujesz z Hammer+.'),
      );
    }

    function draw() {
      if (!data) return;
      const wrap = h('div.skin-page', skinCard(), h('div.grid', capesCard(), cosmeticsCard(), libraryCard(), outfitsCard()));
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
        const [res, capes, cosmetics] = await Promise.all([api.skins.get(), api.plus.capes().catch(() => ({ capes: [], selected: '', on: true, lastMojang: '', custom: null, plus: false })), api.plus.cosmetics().catch(() => null)]);
        if (my !== run || !alive) return undefined;
        data = { outfits: [], ...res };
        hammer = { ...hammer, ...capes };
        if (cosmetics) looks = { ...looks, ...cosmetics };
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
