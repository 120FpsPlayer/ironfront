'use strict';
/* Mody – browse Modrinth (mods, resource packs, shaders, modpacks), one-click sets and what is installed in an instance –
   with updates that first make a restore point, and „Cofnij ostatnią aktualizację” as the way back. */

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
  let openTab = null; // HS.modsUi.open('installed'): the tab the next visit starts on

  /** „Cofnąć ostatnią aktualizację?” – what exactly goes back. Resolves true when the player says yes. */
  function undoDialog(point) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        m.close();
        resolve(v);
      };
      const entries = point.entries.filter((e) => e.state !== 'failed');
      const m = HS.modal({
        title: 'Cofnąć ostatnią aktualizację?',
        icon: 'undo',
        body: h(
          'div.form',
          h('p.muted', `Aktualizacja z ${fmt.dateTime(point.createdAt)}. Launcher usunie nowe wersje i przywróci poprzednie pliki – będzie dokładnie tak, jak przed nią.`),
          point.interrupted ? h('p.cloud-note', icon('info'), 'Ta aktualizacja została przerwana, zanim się skończyła. Cofnięcie przywróci wszystko, co zdążyła podmienić.') : null,
          h(
            'div.rows.share-out',
            entries.map((e) =>
              h('div.installed-row', h('div.pic', icon(e.type === 'mod' ? 'puzzle' : e.type === 'shader' ? 'sun' : 'image')), h('div.grow', { style: { minWidth: 0 } }, HS.raw(h('b.ellipsis', e.title)), h('small.ellipsis', { style: { display: 'block' } }, `${e.new.versionNumber ?? e.new.file} → wraca ${e.old.versionNumber ?? e.old.file}`))),
            ),
          ),
          h('div.hint', 'Stare pliki nie były usuwane – czekają w folderze instancji (.hammer/przywracanie). Launcher pamięta trzy ostatnie aktualizacje każdej instancji.'),
        ),
        foot: [h('button.btn.ghost', { type: 'button', onclick: () => finish(false) }, 'Anuluj'), h('button.btn.primary', { type: 'button', onclick: () => finish(true) }, icon('undo'), 'Cofnij aktualizację')],
        onClose: () => finish(false),
      });
    });
  }

  function render(root) {
    // `updates`: what has a newer version in this instance – mods, resource packs and shaders together.
    const ui = { tab: openTab ?? 'browse', type: 'mod', query: '', sort: 'relevance', cats: new Set(), offset: 0, total: 0, installed: new Set(), updates: [] };
    openTab = null;
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
            { value: 'bundles', label: 'Zestawy', icon: 'layers' },
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
      if (ui.tab === 'bundles') return clear(typeSeg); // a set mixes mods and shader packs
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
          h('div.title', HS.raw(h('h3', { onclick: () => details(p), title: p.title }, p.title)), h('small', `od ${p.author}`)),
          HS.raw(h('p', p.description)),
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
          h('div.row', { style: { gap: '16px', marginBottom: '16px', alignItems: 'flex-start' } }, h('div.pic', { style: { width: '72px', height: '72px', borderRadius: '16px', overflow: 'hidden', background: 'var(--panel3)', flex: 'none' } }, p.icon_url ? h('img', { src: p.icon_url, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null), h('div.grow', HS.raw(h('p.muted', p.description)), h('div.row', { style: { marginTop: '8px', gap: '14px', color: 'var(--dim)', fontSize: '12px' } }, h('span', `${fmt.num(p.downloads)} pobrań`), h('span', `od ${p.author}`)))),
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
            gallery.length ? h('div.grid.g2', { style: { gap: '8px', marginBottom: '12px' } }, gallery.map((g) => HS.raw(h('img', { src: g.url, alt: g.title ?? '', loading: 'lazy', style: { width: '100%', aspectRatio: '16/9', objectFit: 'cover', borderRadius: '10px', background: 'var(--panel3)' } })))) : null,
            bodyText(full.body).map((t) => HS.raw(t.head ? h('h3', { style: { margin: '12px 0 6px', fontSize: '13.5px' } }, t.text) : h('p.muted', { style: { marginBottom: '8px', fontSize: '13px', whiteSpace: 'pre-line' } }, t.text))),
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

    /* ── bundles: curated sets, one click each ── */
    let bundleRun = 0;
    function drawBundles() {
      const i = inst();
      const my = ++bundleRun;
      if (!i) return clear(body, h('div.card', HS.empty('cube', 'Brak instancji', 'Utwórz instancję, aby dodawać zestawy modów.', h('button.btn.primary', { onclick: () => HS.editInstance() }, icon('plus'), 'Nowa instancja'))));
      if (i.loader === 'vanilla') {
        return clear(
          body,
          h('div.card', HS.empty('puzzle', 'Ta instancja to czysty Minecraft', 'Zestawy modów wymagają loadera. Zmień loader instancji na Fabric (zalecany) – wtedy zainstalujesz cały zestaw jednym kliknięciem.', h('button.btn.primary', { onclick: () => HS.editInstance(i) }, icon('pen'), 'Zmień loader'))),
        );
      }
      const grid = h('div.bundle-grid', [1, 2, 3, 4].map(() => h('div.skeleton', { style: { height: '280px' } })));
      clear(body, h('div.hint', { style: { marginBottom: '12px' } }, `Gotowe zestawy na jedno kliknięcie. Launcher dobiera wersje do Minecrafta ${i.mcVersion} (${LOADERS[i.loader]?.name}) i sam doinstalowuje zależności.`), grid);
      api.bundles
        .list()
        .then((list) => my === bundleRun && clear(grid, list.map((b) => bundleCard(i, b, () => my === bundleRun))))
        .catch((err) => my === bundleRun && clear(grid, HS.empty('warning', 'Nie udało się wczytać zestawów', err.message)));
      return undefined;
    }

    function bundleCard(i, b, current) {
      const items = h('div.bundle-items', [1, 2, 3, 4].map(() => h('div.skeleton', { style: { height: '24px', margin: '3px 0' } })));
      const btn = h('button.btn.primary', { disabled: true }, icon('download'), 'Zainstaluj zestaw');
      const count = h('span.chip');
      const stateIcon = (m) => h(`span.st${m.installed ? '.ok' : m.available ? '.get' : ''}`, icon(m.installed ? 'check-circle' : m.available ? 'download' : 'x-circle'));
      async function load() {
        let plan;
        try {
          plan = await api.bundles.plan(i.id, b.id);
        } catch (err) {
          if (current()) clear(items, h('p.muted', { style: { fontSize: '12.5px' } }, err.message), h('button.btn.sm', { style: { width: 'fit-content', marginTop: '8px' }, onclick: load }, icon('refresh'), 'Spróbuj ponownie'));
          return;
        }
        if (!current()) return;
        const available = plan.mods.filter((m) => m.available);
        const todo = available.filter((m) => !m.installed);
        btn.disabled = !todo.length;
        clear(btn, icon(todo.length ? 'download' : available.length ? 'check' : 'x-circle'), todo.length ? `Zainstaluj (${todo.length})` : available.length ? 'Zainstalowany' : 'Niedostępny');
        count.textContent = `${available.length - todo.length}/${available.length}`;
        count.className = `chip${available.length && !todo.length ? ' ok' : ''}`;
        count.title = `Zainstalowane: ${available.length - todo.length} z ${available.length} dostępnych dla Minecrafta ${i.mcVersion}`;
        clear(
          items,
          plan.mods.map((m) =>
            h(
              `div.bundle-item${m.available ? '' : '.na'}`,
              { title: m.available ? `${m.name} – ${m.why}` : `${m.name} – nie ma jeszcze wersji dla Minecrafta ${i.mcVersion} (${LOADERS[i.loader]?.name})` },
              stateIcon(m),
              h('b', m.name),
              h('small.ellipsis', m.available ? m.why : `brak dla ${i.mcVersion}`),
              m.type === 'shader' ? h('em', 'shader') : null,
            ),
          ),
        );
      }
      btn.onclick = async () => {
        const done = await HS.busy(btn, async () => {
          const res = await attempt(() => api.bundles.install(i.id, b.id));
          if (!res) return false;
          const n = res.installed?.length ?? 0;
          HS.toast('ok', n ? `Zestaw „${b.name}”: zainstalowano ${fmt.count(n, 'dodatek', 'dodatki', 'dodatków')} (razem z zależnościami).` : `Zestaw „${b.name}” był już zainstalowany.`, 6000);
          for (const w of res.warnings ?? []) HS.toast('warning', w, 8000);
          return true;
        });
        // After the spinner is gone (it switches the button back on): the fresh state of the set.
        if (done) load();
      };
      load();
      return h(
        'section.card.bundle',
        h('div.bundle-head', h('div.bundle-icon', icon(b.icon)), h('div.grow', h('div.row', h('h2', b.name), count), h('p.muted', b.description))),
        items,
        h('div.bundle-foot', h('span.hint.grow', b.note), btn),
      );
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
      const undoBtn = h('button.btn.sm', { style: { display: 'none' }, title: 'Przywraca pliki sprzed ostatniej aktualizacji i usuwa nowe' }, icon('undo'), 'Cofnij ostatnią aktualizację');
      const note = h('div');
      let items = [];
      let points = []; // the restore points of this instance, newest first

      async function load() {
        clear(list, [1, 2, 3].map(() => h('div.skeleton', { style: { height: '58px' } })));
        try {
          // What the last check found (also the quiet one in the background) and the way back, if there is one.
          [items, ui.updates, points] = await Promise.all([api.content.list(i.id, ui.type), api.updates.list(i.id).catch(() => []), api.updates.points(i.id).catch(() => [])]);
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
        const upd = new Map(ui.updates.filter((u) => u.type === ui.type).map((u) => [u.file, u]));
        const elsewhere = ui.updates.length - upd.size;
        updAll.style.display = ui.updates.length ? '' : 'none';
        updAll.lastChild.textContent = `Aktualizuj wszystko (${ui.updates.length})`;
        updAll.title = `Najpierw powstaje punkt przywracania – aktualizację da się cofnąć.${elsewhere ? ` W tym ${fmt.count(elsewhere, 'dodatek', 'dodatki', 'dodatków')} z pozostałych zakładek (mody, paczki tekstur, shadery).` : ''}`;
        undoBtn.style.display = points.length ? '' : 'none';
        clear(note, points[0]?.interrupted ? h('p.cloud-note', { style: { margin: '0 0 12px' } }, icon('warning'), 'Ostatnia aktualizacja została przerwana, zanim się skończyła. „Cofnij ostatnią aktualizację” przywróci pliki sprzed niej.') : null);
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
                h('div.grow', { style: { minWidth: 0 } }, HS.raw(h('b.ellipsis', x.title)), h('small.ellipsis', { style: { display: 'block' } }, [x.versionNumber, x.file, fmt.size(x.size)].filter(Boolean).join(' · '))),
                u ? h('button.chip.accent', { title: `Nowa wersja: ${u.latest.versionNumber} – kliknij, żeby zaktualizować (da się cofnąć)`, onclick: (e) => doUpdate([u], e.currentTarget) }, icon('arrow-up'), u.latest.versionNumber) : null,
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
                        ui.updates = ui.updates.filter((y) => !(y.type === ui.type && y.file === x.file));
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
      /** One update or all of them: the old files go into a restore point first, so it can be taken back. */
      async function doUpdate(updates, btn) {
        const res = await HS.busy(btn, () => attempt(() => api.updates.apply(i.id, updates)));
        if (!res) return;
        if (res.updated.length) HS.toast('ok', `Zaktualizowano: ${res.updated.map((u) => u.title).join(', ')}. Gdyby coś przestało działać, użyj „Cofnij ostatnią aktualizację”.`, 8000);
        for (const f of res.failed.slice(0, 3)) HS.toast('warning', `${f.title} zostaje w starej wersji: ${f.error}`, 8000);
        await load(); // (after the button is itself again: the list redraws its label)
      }
      updBtn.onclick = () =>
        HS.busy(updBtn, async () => {
          const res = await attempt(() => api.updates.check(i.id));
          if (!res) return;
          ui.updates = res;
          HS.toast(res.length ? 'info' : 'ok', res.length ? `Dostępne aktualizacje: ${res.length}.` : 'Wszystko jest aktualne.');
          draw();
        });
      updAll.onclick = () => doUpdate(ui.updates, updAll);
      undoBtn.onclick = async () => {
        if (!points[0] || !(await undoDialog(points[0]))) return;
        const res = await HS.busy(undoBtn, () => attempt(() => api.updates.undo(i.id)));
        if (!res) return load(); // (a half-done undo may have put some files back already)
        HS.toast('ok', res.restored.length ? `Przywrócono poprzednie wersje: ${res.restored.map((r) => r.title).join(', ')}.` : 'Nie było czego przywracać – pliki są już na swoim miejscu.', 7000);
        return load();
      };
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
        h('div.installed-sum', h('span.grow', summary), undoBtn),
        note,
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
      bundleRun += 1;
      if (ui.tab === 'browse') drawBrowse();
      else if (ui.tab === 'bundles') drawBundles();
      else drawInstalled();
    }

    clear(root, h('div.page', h('div.page-head', h('div', h('h1', 'Mody i dodatki'), h('p', 'Mody, paczki tekstur, shadery i gotowe zestawy z Modrinth – zależności instalują się same.')), h('div.actions', instBtn)), h('div.toolbar', tabs, typeSeg), body));
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
    return () => ((bundleRun += 1), off(), off2());
  }

  HS.modsUi = { open: (tab) => (openTab = tab) };
  HS.views.mods = { title: 'Mody', icon: 'puzzle', render };
})();
