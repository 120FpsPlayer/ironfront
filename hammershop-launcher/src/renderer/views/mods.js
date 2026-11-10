'use strict';
/* Mody – browse Modrinth (mods, resource packs, shaders, modpacks) and manage what is installed in an instance. */

(() => {
  const { api, h, clear, icon, fmt, LOADERS, tile, bus, state, attempt } = HS;

  const TYPES = {
    mod: { label: 'Mody', icon: 'puzzle', one: 'mod', few: 'mody', many: 'modów' },
    resourcepack: { label: 'Paczki tekstur', icon: 'image', one: 'paczka', few: 'paczki', many: 'paczek' },
    shader: { label: 'Shadery', icon: 'sun', one: 'shader', few: 'shadery', many: 'shaderów' },
    modpack: { label: 'Paczki modów', icon: 'box', one: 'paczka', few: 'paczki', many: 'paczek' },
  };
  const SORTS = [
    { value: 'relevance', label: 'Najtrafniejsze' },
    { value: 'downloads', label: 'Najczęściej pobierane' },
    { value: 'follows', label: 'Najpopularniejsze' },
    { value: 'newest', label: 'Najnowsze' },
    { value: 'updated', label: 'Ostatnio aktualizowane' },
  ];
  const CAT_PL = {
    adventure: 'Przygoda', cursed: 'Dziwne', decoration: 'Dekoracje', economy: 'Ekonomia', equipment: 'Ekwipunek', food: 'Jedzenie', 'game-mechanics': 'Mechanika gry', library: 'Biblioteki', magic: 'Magia', management: 'Zarządzanie', minigame: 'Minigry', mobs: 'Moby', optimization: 'Optymalizacja', social: 'Społeczność', storage: 'Przechowywanie', technology: 'Technologia', transportation: 'Transport', utility: 'Narzędzia', worldgen: 'Generowanie świata', combat: 'Walka', challenging: 'Wyzwanie', 'kitchen-sink': 'Wszystko w jednym', lightweight: 'Lekkie', multiplayer: 'Multiplayer', quests: 'Questy',
    blocks: 'Bloki', 'core-shaders': 'Core shadery', entities: 'Stworzenia', environment: 'Otoczenie', fonts: 'Czcionki', gui: 'Interfejs', items: 'Przedmioty', locale: 'Języki', models: 'Modele', audio: 'Dźwięki', simplistic: 'Proste', themed: 'Tematyczne', tweaks: 'Poprawki', realistic: 'Realistyczne', modded: 'Do modów', 'vanilla-like': 'W stylu vanilla',
    atmosphere: 'Atmosfera', bloom: 'Bloom', cartoon: 'Kreskówkowe', 'colored-lighting': 'Kolorowe światło', fantasy: 'Fantasy', foliage: 'Roślinność', 'path-tracing': 'Path tracing', pbr: 'PBR', reflections: 'Odbicia', 'semi-realistic': 'Półrealistyczne', shadows: 'Cienie', potato: 'Słaby PC', low: 'Niskie wymagania', medium: 'Średnie wymagania', high: 'Wysokie wymagania', screenshot: 'Do screenów',
  };
  const catName = (c) => CAT_PL[c] ?? c.replace(/-/g, ' ').replace(/^./, (x) => x.toUpperCase());

  /** Plain, safe text from a Modrinth markdown/HTML body (no HTML is ever injected). */
  function bodyText(md) {
    const out = [];
    let para = [];
    const flush = () => {
      const t = para.join(' ').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').trim();
      if (t.length > 1) out.push({ text: t });
      para = [];
    };
    const clean = (s) =>
      s
        .replace(/<[^>]+>/g, ' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~|]+/g, '')
        .replace(/&nbsp;|&amp;/g, (m) => (m === '&amp;' ? '&' : ' '));
    for (const raw of String(md ?? '').split(/\r?\n/)) {
      const line = clean(raw).trim();
      if (!line || /^[-=]{3,}$/.test(line)) flush();
      else if (/^#{1,6}\s/.test(line)) {
        flush();
        out.push({ text: line.replace(/^#+\s*/, ''), head: true });
      } else para.push(line.replace(/^([-+>]|\d+\.)\s+/, '• ').replace(/^• /, para.length ? '\n• ' : '• '));
    }
    flush();
    return out.filter((p) => p.text).slice(0, 16);
  }

  let catCache = null;

  function render(root) {
    const ui = { tab: 'browse', type: 'mod', query: '', sort: 'relevance', cats: new Set(), offset: 0, total: 0, installed: new Set(), updates: [] };
    const inst = () => state.instance;

    const picker = HS.instancePicker();
    const instBtn = picker.el;
    const tabs = h('div');
    const typeSeg = h('div');
    const body = h('div');

    function drawHead() {
      picker.draw();
      clear(
        tabs,
        HS.seg(
          [
            { value: 'browse', label: 'Przeglądaj', icon: 'search' },
            { value: 'installed', label: 'Zainstalowane', icon: 'check' },
          ],
          ui.tab,
          (v) => {
            ui.tab = v;
            if (v === 'installed' && ui.type === 'modpack') ui.type = 'mod';
            drawTypes();
            drawBody();
          },
        ),
      );
      drawTypes();
    }
    function drawTypes() {
      const types = Object.entries(TYPES).filter(([k]) => ui.tab === 'browse' || k !== 'modpack');
      clear(
        typeSeg,
        HS.seg(
          types.map(([value, t]) => ({ value, label: t.label, icon: t.icon })),
          ui.type,
          (v) => {
            ui.type = v;
            ui.cats.clear();
            drawBody();
          },
        ),
      );
    }

    /* ── browse ── */
    async function installedSet() {
      const i = inst();
      if (!i || ui.type === 'modpack') return new Set();
      try {
        const list = await api.content.list(i.id, ui.type);
        return new Set(list.map((x) => x.projectId).filter(Boolean));
      } catch {
        return new Set();
      }
    }

    function needsLoader() {
      const i = inst();
      return ui.type === 'mod' && i && i.loader === 'vanilla';
    }

    function drawBrowse() {
      const results = h('div.results');
      const more = h('div', { style: { display: 'flex', justifyContent: 'center', marginTop: '14px' } });
      const cats = h('div.cats');
      const search = h('input.input', { placeholder: `Szukaj: ${TYPES[ui.type].label.toLowerCase()}…`, value: ui.query, type: 'search' });
      const run = HS.debounce(() => {
        ui.query = search.value.trim();
        ui.offset = 0;
        load(false);
      }, 350);
      search.addEventListener('input', run);

      if (needsLoader()) {
        return clear(
          body,
          h(
            'div.card',
            HS.empty('puzzle', 'Ta instancja to czysty Minecraft', 'Mody wymagają loadera. Zmień loader instancji na Fabric (zalecany) albo utwórz nową instancję z modami.', h('div.row', h('button.btn.primary', { onclick: () => HS.editInstance(inst()) }, icon('pen'), 'Zmień loader'), h('button.btn', { onclick: () => HS.editInstance() }, icon('plus'), 'Nowa instancja'))),
          ),
        );
      }

      clear(
        body,
        h('div.toolbar', h('div.search.grow', icon('search'), search), HS.select(SORTS, ui.sort, (v) => ((ui.sort = v), (ui.offset = 0), load(false)))),
        cats,
        ui.type === 'modpack' ? h('div.hint', { style: { marginBottom: '12px' } }, 'Paczka modów tworzy nową instancję z kompletem modów i ustawień.') : null,
        results,
        more,
      );

      (async () => {
        try {
          catCache ??= await api.modrinth.categories();
          const list = catCache.filter((c) => c.project_type === ui.type && c.header !== 'resolutions' && (c.header !== 'performance impact' || ui.type === 'shader'));
          clear(
            cats,
            list.map((c) =>
              h(
                `button.chip${ui.cats.has(c.name) ? '.on' : ''}`,
                {
                  onclick: (e) => {
                    ui.cats.has(c.name) ? ui.cats.delete(c.name) : ui.cats.add(c.name);
                    e.currentTarget.classList.toggle('on');
                    ui.offset = 0;
                    load(false);
                  },
                },
                catName(c.name),
              ),
            ),
          );
        } catch {
          /* categories are optional */
        }
      })();

      let token = 0;
      async function load(append) {
        const my = ++token;
        if (!append) clear(results, [1, 2, 3, 4, 5].map(() => h('div.skeleton', { style: { height: '90px' } })));
        clear(more);
        const i = inst();
        try {
          const [res, have] = await Promise.all([
            api.modrinth.search({ query: ui.query, type: ui.type, mcVersion: ui.type === 'modpack' ? undefined : i?.mcVersion, loader: ui.type === 'modpack' ? undefined : i?.loader, categories: [...ui.cats], sort: ui.sort, offset: ui.offset, limit: 20 }),
            append ? Promise.resolve(ui.installed) : installedSet(),
          ]);
          if (my !== token) return;
          ui.installed = have;
          ui.total = res.total_hits ?? 0;
          if (!append) clear(results);
          if (!res.hits?.length && !append) {
            results.append(HS.empty('search', 'Nic nie znaleziono', i ? `Brak wyników dla Minecrafta ${i.mcVersion}${ui.type === 'mod' ? ` i ${LOADERS[i.loader]?.name}` : ''}. Spróbuj innej frazy.` : 'Spróbuj innej frazy.'));
            return;
          }
          for (const p of res.hits) results.append(projectRow(p));
          ui.offset += res.hits.length;
          if (ui.offset < ui.total) more.append(h('button.btn', { onclick: (e) => HS.busy(e.currentTarget, () => load(true)) }, icon('chevron-down'), `Pokaż więcej (${fmt.num(ui.total - ui.offset)})`));
        } catch (err) {
          if (my !== token) return;
          clear(results, HS.empty('warning', 'Brak połączenia z Modrinth', err.message, h('button.btn', { onclick: () => load(false) }, icon('refresh'), 'Spróbuj ponownie')));
        }
      }
      load(false);
    }

    function projectRow(p) {
      const installed = ui.installed.has(p.project_id);
      const act = h('div.act');
      const drawAct = (state2) => {
        clear(
          act,
          state2 === 'installed'
            ? HS.chip('Zainstalowano', 'ok', 'check')
            : h('button.btn.primary.sm', { onclick: (e) => install(p, e.currentTarget) }, icon('download'), ui.type === 'modpack' ? 'Zainstaluj paczkę' : 'Zainstaluj'),
          h('button.btn.ghost.sm', { onclick: () => details(p) }, 'Wersje i opis'),
        );
      };
      const row = h(
        'div.project',
        h('div.pic', p.icon_url ? h('img', { src: p.icon_url, alt: '', loading: 'lazy' }) : icon(TYPES[ui.type].icon)),
        h(
          'div.info',
          h('div.title', h('h3', { onclick: () => details(p), title: p.title }, p.title), h('small', `od ${p.author}`)),
          h('p', p.description),
          h(
            'div.meta',
            h('span', icon('download'), fmt.compact(p.downloads)),
            h('span', icon('heart'), fmt.compact(p.follows)),
            h('span', icon('clock'), fmt.ago(p.date_modified)),
            (p.display_categories ?? p.categories ?? [])
              .filter((c) => CAT_PL[c] || !/^(fabric|forge|quilt|neoforge|minecraft|iris|optifine|vanilla|canvas)$/.test(c))
              .slice(0, 3)
              .map((c) => h('span.chip', { style: { height: '20px' } }, catName(c))),
          ),
        ),
        act,
      );
      row._setInstalled = () => drawAct('installed');
      drawAct(installed ? 'installed' : null);
      p._row = row;
      return row;
    }

    async function install(p, btn, versionId) {
      const i = inst();
      if (ui.type === 'modpack') {
        const ok = await HS.confirmDialog({ title: `Zainstalować „${p.title}”?`, text: 'Zostanie utworzona nowa instancja z tą paczką modów. Pobieranie może chwilę potrwać.', confirm: 'Zainstaluj paczkę' });
        if (!ok) return;
        return HS.busy(btn, async () => {
          const created = await attempt(() => api.modpacks.install({ projectId: p.project_id ?? p.id, versionId }));
          if (created) {
            HS.toast('ok', `Paczka „${created.name}” gotowa – kliknij GRAJ.`);
            await state.refreshInstances();
            await state.selectInstance(created.id);
          }
        });
      }
      if (!i) return HS.toast('warning', 'Najpierw utwórz instancję.');
      return HS.busy(btn, async () => {
        const res = await attempt(() => api.content.install(i.id, { projectId: p.project_id ?? p.id, versionId, type: ui.type }));
        if (!res) return;
        const extra = Math.max(0, (res.installed?.length ?? 1) - 1);
        HS.toast('ok', `Zainstalowano ${p.title}${extra ? ` + ${fmt.count(extra, 'zależność', 'zależności', 'zależności')}` : ''}.`);
        for (const w of res.warnings ?? []) HS.toast('warning', w, 7000);
        ui.installed.add(p.project_id ?? p.id);
        p._row?._setInstalled();
      });
    }

    async function details(p) {
      const i = inst();
      const pid = p.project_id ?? p.id;
      const descr = h('div', h('div.skeleton', { style: { height: '120px' } }));
      const versions = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, h('div.skeleton', { style: { height: '160px' } }));
      const m = HS.modal({
        title: p.title,
        wide: true,
        body: h(
          'div',
          h('div.row', { style: { gap: '16px', marginBottom: '16px', alignItems: 'flex-start' } }, h('div.pic', { style: { width: '72px', height: '72px', borderRadius: '16px', overflow: 'hidden', background: 'var(--panel3)', flex: 'none' } }, p.icon_url ? h('img', { src: p.icon_url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null), h('div.grow', h('p.muted', p.description), h('div.row', { style: { marginTop: '8px', gap: '14px', color: 'var(--dim)', fontSize: '12px' } }, h('span', `${fmt.num(p.downloads)} pobrań`), h('span', `od ${p.author}`)))),
          h('div.grid', { style: { gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: '18px' } }, h('div', h('h3', { style: { marginBottom: '8px' } }, 'Opis'), descr), h('div', h('h3', { style: { marginBottom: '8px' } }, ui.type === 'modpack' ? 'Wersje paczki' : i ? `Wersje dla ${i.mcVersion}` : 'Wersje'), versions)),
        ),
        foot: [h('button.btn.ghost', { onclick: () => HS.open(`https://modrinth.com/${ui.type === 'resourcepack' ? 'resourcepack' : ui.type}/${p.slug ?? pid}`) }, icon('external'), 'Otwórz na Modrinth'), h('button.btn', { onclick: () => m.close() }, 'Zamknij')],
      });
      api.modrinth
        .project(pid)
        .then((full) => {
          const gallery = (full.gallery ?? []).slice(0, 4);
          clear(
            descr,
            gallery.length ? h('div.grid.g2', { style: { gap: '8px', marginBottom: '12px' } }, gallery.map((g) => h('img', { src: g.url, alt: g.title ?? '', loading: 'lazy', style: { width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: '10px', background: 'var(--panel3)' } }))) : null,
            bodyText(full.body).map((t) => (t.head ? h('h3', { style: { margin: '12px 0 6px', fontSize: '13.5px' } }, t.text) : h('p.muted', { style: { marginBottom: '8px', fontSize: '13px', whiteSpace: 'pre-line' } }, t.text))),
          );
        })
        .catch(() => clear(descr, h('p.muted', 'Nie udało się wczytać opisu.')));
      const filters = ui.type === 'modpack' ? {} : { loaders: ui.type === 'mod' ? (i?.loader === 'quilt' ? ['quilt', 'fabric'] : [i?.loader]) : ui.type === 'shader' ? ['iris', 'optifine'] : ['minecraft'], gameVersions: i ? [i.mcVersion] : undefined };
      api.modrinth
        .versions(pid, filters)
        .then((list) => {
          if (!list.length) return clear(versions, h('p.muted', `Brak wersji zgodnych z ${i ? `Minecraftem ${i.mcVersion}` : 'tą instancją'}.`));
          const TYPE_PL = { release: ['Stabilna', 'ok'], beta: ['Beta', 'warn'], alpha: ['Alfa', 'err'] };
          clear(
            versions,
            list.slice(0, 12).map((v) =>
              h(
                'div.installed-row',
                h('div.grow', h('b.ellipsis', v.version_number), h('small', `${(v.loaders ?? []).map((l) => LOADERS[l]?.name ?? l).join(', ')} · ${fmt.ago(v.date_published)}`)),
                HS.chip(...TYPE_PL[v.version_type] ?? [v.version_type]),
                h('button.btn.sm', { onclick: (e) => install(p, e.currentTarget, v.id).then(() => ui.type !== 'modpack' && m.close()) }, icon('download')),
              ),
            ),
          );
        })
        .catch((err) => clear(versions, h('p.muted', err.message)));
    }

    /* ── installed ── */
    function drawInstalled() {
      const i = inst();
      if (!i) return clear(body, HS.empty('cube', 'Brak instancji', 'Utwórz instancję, aby dodawać mody.'));
      const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } });
      const filter = h('input.input', { placeholder: 'Filtruj…', type: 'search' });
      const summary = h('span.dim');
      const updBtn = h('button.btn', {}, icon('refresh'), 'Sprawdź aktualizacje');
      const updAll = h('button.btn.primary', { style: { display: 'none' } }, icon('arrow-up'), 'Aktualizuj wszystko');
      let items = [];

      async function load() {
        clear(list, [1, 2, 3].map(() => h('div.skeleton', { style: { height: '58px' } })));
        try {
          items = await api.content.list(i.id, ui.type);
          draw();
          // Files added by hand: look them up on Modrinth once (name, icon, updates).
          if (items.some((x) => !x.projectId)) {
            const n = await api.content.identify(i.id, ui.type).catch(() => 0);
            if (n) {
              items = await api.content.list(i.id, ui.type);
              draw();
            }
          }
        } catch (err) {
          clear(list, HS.empty('warning', 'Nie udało się wczytać listy', err.message));
        }
      }
      function draw() {
        const q = filter.value.trim().toLowerCase();
        const shown = items.filter((x) => !q || `${x.title} ${x.file}`.toLowerCase().includes(q));
        const t = TYPES[ui.type];
        const on = items.filter((x) => x.enabled).length;
        summary.textContent = items.length ? `${fmt.count(items.length, t.one, t.few, t.many)} · włączone: ${on}` : '';
        const upd = new Map(ui.updates.map((u) => [u.file, u]));
        updAll.style.display = ui.updates.length ? '' : 'none';
        updAll.lastChild.textContent = `Aktualizuj wszystko (${ui.updates.length})`;
        if (!items.length) {
          return clear(list, HS.empty(t.icon, `Brak: ${t.label.toLowerCase()}`, 'Znajdź coś w zakładce Przeglądaj albo przeciągnij pliki tutaj.', h('button.btn.primary', { onclick: () => ((ui.tab = 'browse'), drawHead(), drawBody()) }, icon('search'), 'Przeglądaj')));
        }
        clear(
          list,
          shown
            .sort((a, b) => a.title.localeCompare(b.title, 'pl'))
            .map((x) => {
              const u = upd.get(x.file);
              return h(
                `div.installed-row${x.enabled ? '' : '.off'}`,
                h('div.pic', x.iconUrl ? h('img', { src: x.iconUrl, alt: '', loading: 'lazy' }) : icon(t.icon)),
                h('div.grow', { style: { minWidth: 0 } }, h('b.ellipsis', x.title), h('small.ellipsis', { style: { display: 'block' } }, [x.versionNumber, x.file, fmt.size(x.size)].filter(Boolean).join(' · '))),
                u ? h('button.chip.accent', { title: `Nowa wersja: ${u.latest.versionNumber}`, onclick: (e) => doUpdate([u], e.currentTarget) }, icon('arrow-up'), u.latest.versionNumber) : null,
                HS.toggle(x.enabled, (v) => attempt(() => api.content.toggle(i.id, ui.type, x.file, v)).then((r) => (r === undefined ? load() : ((x.enabled = v), draw())))),
                h(
                  'button.btn.ghost.sm.icon.danger',
                  {
                    title: 'Usuń',
                    'aria-label': `Usuń ${x.title}`,
                    onclick: async () => {
                      if (!(await HS.confirmDialog({ title: 'Usunąć?', text: `„${x.title}” zostanie usunięty z instancji.`, confirm: 'Usuń', danger: true }))) return;
                      if ((await attempt(() => api.content.remove(i.id, ui.type, x.file))) !== undefined) {
                        items = items.filter((y) => y !== x);
                        ui.updates = ui.updates.filter((y) => y.file !== x.file);
                        draw();
                      }
                    },
                  },
                  icon('trash'),
                ),
              );
            }),
        );
      }
      async function doUpdate(updates, btn) {
        await HS.busy(btn, async () => {
          const done = await attempt(() => api.content.update(i.id, ui.type, updates));
          if (!done) return;
          HS.toast('ok', `Zaktualizowano: ${done.join(', ') || 'nic'}.`);
          const files = new Set(updates.map((u) => u.file));
          ui.updates = ui.updates.filter((u) => !files.has(u.file));
          await load();
        });
      }
      updBtn.onclick = () =>
        HS.busy(updBtn, async () => {
          const res = await attempt(() => api.content.updates(i.id, ui.type));
          if (!res) return;
          ui.updates = res;
          HS.toast(res.length ? 'info' : 'ok', res.length ? `Dostępne aktualizacje: ${res.length}.` : 'Wszystko jest aktualne.');
          draw();
        });
      updAll.onclick = () => doUpdate(ui.updates, updAll);
      filter.addEventListener('input', draw);

      const wrap = h(
        'div',
        h(
          'div.toolbar',
          h('div.search', { style: { width: '220px' } }, icon('filter'), filter),
          h('span.grow'),
          updAll,
          updBtn,
          h('button.btn', { onclick: (e) => HS.busy(e.currentTarget, async () => ((await attempt(() => api.content.import(i.id, ui.type, []))) ?? []).length && load()) }, icon('plus'), 'Dodaj pliki'),
          h('button.btn.icon', { title: 'Otwórz folder', 'aria-label': 'Otwórz folder', onclick: () => attempt(() => api.app.openFolder(i.id, { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }[ui.type])) }, icon('folder')),
        ),
        h('div', { style: { margin: '-4px 0 10px', fontSize: '12px' } }, summary),
        h('div.dropzone', icon('download'), ` Upuść pliki ${ui.type === 'mod' ? '.jar' : '.zip'}, aby dodać je do „${i.name}”`),
        list,
      );
      // Drag & drop files from the desktop.
      let depth = 0;
      wrap.addEventListener('dragenter', (e) => (e.preventDefault(), depth++, wrap.classList.add('dragging')));
      wrap.addEventListener('dragover', (e) => e.preventDefault());
      wrap.addEventListener('dragleave', () => --depth <= 0 && ((depth = 0), wrap.classList.remove('dragging')));
      wrap.addEventListener('drop', async (e) => {
        e.preventDefault();
        depth = 0;
        wrap.classList.remove('dragging');
        const paths = [...(e.dataTransfer?.files ?? [])].map((f) => api.pathForFile(f)).filter(Boolean);
        if (!paths.length) return;
        const added = await attempt(() => api.content.import(i.id, ui.type, paths));
        if (added?.length) {
          HS.toast('ok', `Dodano: ${added.join(', ')}`);
          load();
        } else if (added) HS.toast('warning', `Nieobsługiwany plik – dodaj pliki ${ui.type === 'mod' ? '.jar' : '.zip'}.`);
      });
      clear(body, wrap);
      load();
    }

    function drawBody() {
      ui.offset = 0;
      if (ui.tab === 'browse') drawBrowse();
      else drawInstalled();
    }

    clear(root, h('div.page', h('div.page-head', h('div', h('h1', 'Mody i dodatki'), h('p', 'Tysiące modów, paczek tekstur i shaderów z Modrinth – zależności instalują się same.')), h('div.actions', instBtn)), h('div.toolbar', tabs, typeSeg), body));
    drawHead();
    drawBody();
    let lastId = inst()?.id;
    const off = bus.on('settings', () => {
      if (inst()?.id === lastId) return;
      lastId = inst()?.id;
      ui.updates = [];
      drawHead();
      drawBody();
    });
    const off2 = bus.on('instances', drawHead);
    return () => (off(), off2());
  }

  HS.views.mods = { title: 'Mody', icon: 'puzzle', render };
})();
