'use strict';
/* Zaproszenia – "join this server" links (hammer://join?… and the shop page …/join?…): the window that asks the
   player what to do with one, pasting one in („Mam zaproszenie”), making one („Zaproś”) – and Polecane serwery,
   whose „Graj” goes through the same question. Nothing from a link happens before the player confirms. */

(() => {
  const { api, h, clear, icon, fmt, LOADERS, bus, state, attempt } = HS;

  const loaderName = (loader) => LOADERS[loader]?.name ?? loader;
  const gameLine = (mc, loader) => [mc ? `Minecraft ${mc}` : null, loader ? loaderName(loader) : null].filter(Boolean).join(' · ');
  const players = (s) => `${fmt.num(s.players?.online ?? 0)} / ${(s.players?.max ?? 0) >= 100_000 ? fmt.compact(s.players.max) : fmt.num(s.players?.max ?? 0)}`;

  /**
   * A picture from an address that came with a link or from the shop: https only. Without one (or when it does
   * not load) the server's own icon from its ping answer is shown, else a plain symbol.
   */
  function remotePic(url, fallback, favicon = null) {
    const el = h('div.pic');
    const local = () => clear(el, typeof favicon === 'string' && favicon.startsWith('data:image/png;base64,') ? h('img', { src: favicon, alt: '' }) : icon(fallback));
    if (typeof url === 'string' && /^https:\/\//.test(url)) {
      const img = h('img', { src: url, alt: '', loading: 'lazy', referrerPolicy: 'no-referrer' });
      img.onerror = local;
      el.append(img);
    } else local();
    return el;
  }

  /**
   * The invitation window. `info` comes from the launcher (api.invite.read): the checked link, the modpack it asks
   * for, the instances that fit and what a new one would be. The player picks where the server goes and confirms;
   * the window then ends with „Graj”.
   */
  function open(info) {
    const { invite, pack, fits, create } = info;
    let choice = fits[0]?.id ?? ''; // '' = a new instance
    const title = invite.name ?? invite.server;
    const body = h('div.form');
    const bar = HS.taskBar('modpack');
    const go = h('button.btn.primary', { type: 'button' });
    const cancel = h('button.btn.ghost', { type: 'button' }, 'Anuluj');
    const m = HS.modal({ title: 'Zaproszenie na serwer', icon: 'invite', body, foot: [cancel, go], onClose: () => bar.stop() });
    cancel.onclick = () => m.close();
    const foot = m.box.querySelector('.modal-foot');

    const drawGo = () => clear(go, icon(choice ? 'plus' : pack ? 'download' : 'cube'), choice ? 'Dodaj serwer' : pack ? 'Zainstaluj paczkę i dodaj serwer' : 'Utwórz instancję i dodaj serwer');

    function option(value, pic, name, detail) {
      const radio = h('input', {
        type: 'radio',
        name: 'invite-target',
        checked: choice === value,
        onchange: () => {
          choice = value;
          drawGo();
        },
      });
      return h('label.clean-row.pick-row', radio, pic, h('div.grow', h('b.ellipsis', name), h('small.ellipsis', detail)));
    }

    function draw() {
      const asks = gameLine(invite.mc ?? pack?.mc, invite.loader ?? pack?.loader);
      clear(
        body,
        h(
          'div.invite-head',
          remotePic(invite.icon, 'server'),
          h('div.grow', HS.raw(h('b.ellipsis', { title }, title)), HS.raw(h('code', invite.server)), h('div.chip-row', asks ? HS.chip(asks, 'accent', 'cube') : HS.chip('dowolna wersja gry', null, 'cube'))),
        ),
        pack
          ? h(
              'div.installed-row',
              remotePic(pack.iconUrl, 'box'),
              h('div.grow', { style: { minWidth: 0 } }, h('b.ellipsis', `Paczka modów: ${pack.title}`), h('small.ellipsis', { style: { display: 'block' } }, [pack.author ? `od ${pack.author}` : null, pack.version ? `wersja ${pack.version}` : null, 'z Modrinth'].filter(Boolean).join(' · '))),
            )
          : null,
        h(
          'div.field',
          h('span', 'Do której instancji dodać ten serwer?'),
          h(
            'div.pick-list',
            fits.map((f) => option(f.id, HS.tile(f, 40), f.name, [gameLine(f.mcVersion, f.loader === 'vanilla' ? null : f.loader), f.hasPack ? 'z tą paczką modów' : null, f.hasServer ? 'ma już ten serwer' : null].filter(Boolean).join(' · '))),
            option('', h('div.pic', icon('plus')), 'Utwórz nową instancję', [gameLine(create.mc, create.loader), pack ? `launcher pobierze paczkę „${pack.title}” z Modrinth` : null].filter(Boolean).join(' · ')),
          ),
          !fits.length && asks ? h('div.hint', `Żadna z Twoich instancji nie ma: ${asks} – launcher przygotuje nową.`) : null,
        ),
        bar.el,
        h('p.hint', 'Launcher tylko doda serwer do listy wybranej instancji – nic się nie uruchomi, dopóki nie klikniesz „Graj”. Otwieraj zaproszenia od osób, którym ufasz.'),
      );
      drawGo();
    }

    function drawDone(res) {
      const i = res.instance;
      const running = state.running.has(i.id);
      const note = (...parts) => {
        const el = HS.empty(...parts);
        el.classList.add('done-note');
        return el;
      };
      clear(
        body,
        note(
          'check-circle',
          res.created ? `Instancja „${i.name}” jest gotowa` : res.added ? 'Serwer dodany' : 'Ten serwer już tu jest',
          `${res.added ? `Serwer „${res.name}” jest na liście instancji „${i.name}”` : `Serwer „${res.name}” był już na liście instancji „${i.name}”`} (${gameLine(i.mcVersion, i.loader === 'vanilla' ? null : i.loader)}). Kliknij „Graj”, a launcher uruchomi grę i od razu połączy z ${res.server}.`,
        ),
      );
      clear(
        foot,
        h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Zamknij'),
        h('button.btn.primary', { type: 'button', disabled: running, title: running ? 'Ta instancja już działa' : '', onclick: () => (m.close(), HS.play(i.id, { server: res.server })) }, icon('play'), 'Graj'),
      );
    }

    go.onclick = () =>
      HS.busy(go, async () => {
        cancel.disabled = true;
        for (const input of body.querySelectorAll('input')) input.disabled = true;
        const res = await attempt(() => api.invite.accept(info.token, { instanceId: choice || null }));
        cancel.disabled = false;
        if (!m.box.isConnected) return;
        if (!res) return draw();
        if (res.created) state.settings = await api.settings.get();
        await state.refreshInstances().catch(() => null);
        if (res.created) bus.emit('settings', state.settings);
        bus.emit('servers', { instanceId: res.instance.id });
        drawDone(res);
      });
    draw();
  }

  /** A link that was clicked (the system started the launcher with it) or „Graj” on a featured server. */
  async function fromLink(input) {
    const info = await attempt(() => api.invite.read(input));
    if (info) open(info);
    return Boolean(info);
  }

  /** „Mam zaproszenie”: paste a link – hammer://join?… or the address of the shop page …/join?… */
  function pasteDialog() {
    const input = h('input.input.code', { placeholder: 'hammer://join?server=… albo https://…/join?server=…', spellcheck: false, autocomplete: 'off', maxLength: 2000, 'aria-label': 'Link z zaproszeniem' });
    const problem = h('div.hint');
    const next = h('button.btn.primary', { type: 'button' }, icon('check'), 'Dalej');
    const m = HS.modal({
      title: 'Mam zaproszenie',
      icon: 'invite',
      body: h(
        'div.form',
        h('p.muted', 'Wklej link, który dostałeś od znajomego albo od właściciela serwera. Launcher pokaże, dokąd prowadzi, i zapyta, do której instancji dodać serwer.'),
        h(
          'div.field',
          h('span', 'Link z zaproszeniem'),
          h(
            'div.code-row',
            input,
            h(
              'button.btn',
              {
                type: 'button',
                title: 'Wklej link ze schowka',
                onclick: async () => {
                  const text = await attempt(() => api.clipboard.read());
                  if (text === undefined) return;
                  if (!text) return void clear(problem, h('span.warn', 'Schowek jest pusty – skopiuj link z wiadomości.'));
                  input.value = text.slice(0, 2000);
                  clear(problem);
                  input.focus();
                },
              },
              icon('paste'),
              'Wklej',
            ),
          ),
          problem,
        ),
      ),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), next],
    });
    next.onclick = () =>
      HS.busy(next, async () => {
        clear(problem);
        try {
          const info = await api.invite.read(input.value);
          m.close();
          open(info);
        } catch (err) {
          clear(problem, h('span.warn', err.message));
        }
      });
    input.addEventListener('keydown', (e) => e.key === 'Enter' && next.click());
  }

  /** „Zaproś”: the link for one server of an instance, to copy and send. */
  function createDialog(instance, server) {
    let withPack = true;
    let data = null;
    const body = h('div.form');
    const copy = h('button.btn.primary', { type: 'button', disabled: true }, icon('copy'), 'Kopiuj link');
    const m = HS.modal({ title: `Zaproś na: ${server.name || server.address}`, icon: 'send', body, foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Zamknij'), copy] });
    copy.onclick = () => data && HS.copyText(data.link, 'Link z zaproszeniem jest w schowku – wyślij go znajomemu.');

    function draw() {
      copy.disabled = !data;
      if (!data) return clear(body, h('div.skeleton', { style: { height: '120px' } }));
      const game = gameLine(data.mc, data.loader === 'vanilla' ? null : data.loader);
      return clear(
        body,
        h('p.muted', `Wyślij ten link znajomemu. Gdy go kliknie, jego Hammer Launcher doda serwer „${data.server.name}” (${data.server.address}) i przygotuje pasującą instancję: ${game}${data.pack?.included ? ` z paczką modów „${data.pack.name}”` : ''}.`),
        h('div.field', h('span', 'Link z zaproszeniem'), h('textarea.input.share-code', { readOnly: true, rows: 3, spellcheck: false, 'aria-label': 'Link z zaproszeniem', onfocus: (e) => e.target.select() }, data.link)),
        data.pack
          ? h(
              'label.cloud-auto',
              HS.toggle(withPack, (v) => {
                withPack = v;
                load();
              }),
              h('div', h('b', `Dołącz paczkę modów „${data.pack.name}”`), h('small', 'Launcher znajomego zainstaluje ją z Modrinth. Wyłącz, jeśli serwer jej nie wymaga.')),
            )
          : null,
        h('p.cloud-note', icon('info'), data.web ? 'Znajomy potrzebuje Hammer Launchera. Jeśli go jeszcze nie ma, link otworzy stronę HammerShop, z której go pobierze.' : 'Znajomy potrzebuje Hammer Launchera – bez niego ten link się nie otworzy. Może go też wkleić w launcherze: Serwery → „Mam zaproszenie”.'),
      );
    }

    async function load() {
      const res = await attempt(() => api.invite.link(instance.id, server.address, { pack: withPack }));
      if (!m.box.isConnected) return;
      if (!res) return void m.close();
      data = res;
      draw();
    }
    draw();
    load();
  }

  /* ── Polecane serwery ── */

  /** The featured list, asked through the launcher (which keeps it for 5 minutes). Never fails: [] means "show nothing". */
  const featuredList = () => api.featured.list().then((list) => (Array.isArray(list) ? list : []), () => []);

  /** The line under a featured server's name: how many play there right now. */
  function online(s) {
    if (!s) return h('span.feat-status', h('span.spinner'));
    if (!s.online) return h('span.feat-status', h('span.dot.off'), 'offline');
    return h('span.feat-status', { title: `${s.latency} ms` }, h('span.dot.on'), `${players(s)} graczy`);
  }

  /**
   * The „Polecane serwery” card of the Serwery tab. has(address) says whether the open instance already lists a
   * server; onAdded(list) gets that instance's new list after „Dodaj”. Returns { el, draw } – el stays empty when
   * the shop has no list (or is not reachable).
   */
  function featuredCard({ has, onAdded }) {
    const el = h('div');
    let servers = [];
    const status = new Map();
    let alive = true;

    function tile(s) {
      const instance = state.instance;
      const listed = Boolean(instance) && has(s.address);
      const answer = status.get(s.address);
      return h(
        'div.feat',
        remotePic(s.icon, 'server', answer?.favicon),
        h(
          'div.grow',
          h('div.row.title', HS.raw(h('b.ellipsis', { title: s.name }, s.name)), online(answer)),
          s.description ? HS.raw(h('p', { title: s.description }, s.description)) : null,
          h('div.chip-row', gameLine(s.mc, s.loader) ? HS.chip(gameLine(s.mc, s.loader), 'accent') : null, s.pack ? HS.chip('paczka modów', null, 'box') : null, s.tags.map((t) => HS.raw(HS.chip(t)))),
          h(
            'div.feat-acts',
            HS.raw(h('small.ellipsis', s.address)),
            h(
              'button.btn.sm',
              {
                type: 'button',
                disabled: !instance || listed,
                title: listed ? 'Ten serwer jest już na liście tej instancji' : instance ? `Dodaj do listy instancji „${instance.name}”` : 'Najpierw utwórz instancję',
                onclick: (e) =>
                  HS.busy(e.currentTarget, async () => {
                    const list = await attempt(() => api.servers.add(instance.id, { name: s.name, address: s.address }), `Dodano „${s.name}” do listy instancji „${instance.name}”.`);
                    if (list) onAdded(list);
                  }),
              },
              icon(listed ? 'check' : 'plus'),
              listed ? 'Na liście' : 'Dodaj',
            ),
            h('button.btn.sm.primary', { type: 'button', title: 'Wybierz instancję i wejdź na ten serwer', onclick: (e) => HS.busy(e.currentTarget, () => fromLink({ featured: s.id })) }, icon('play'), 'Graj'),
          ),
        ),
      );
    }

    function draw() {
      if (!servers.length) return clear(el);
      return clear(el, h('section.card.featured', h('div.card-head', icon('star'), h('h2.grow', 'Polecane serwery'), h('span.dim', { style: { fontSize: '12px' } }, `wybiera ${state.info?.config?.brand ?? 'HammerShop'}`)), h('div.feat-grid', servers.map(tile))));
    }

    featuredList().then((list) => {
      if (!alive) return;
      servers = list;
      draw();
      for (const s of servers) {
        api.server.ping(s.address).then(
          (answer) => alive && (status.set(s.address, answer), draw()),
          () => alive && (status.set(s.address, { online: false }), draw()),
        );
      }
    });
    return { el, draw, stop: () => (alive = false) };
  }

  /** The compact strip of the home screen: up to three featured servers with who is online and „Graj”. */
  function featuredStrip() {
    const el = h('div');
    let alive = true;
    featuredList().then((list) => {
      const servers = list.slice(0, 3);
      if (!alive || !servers.length) return;
      const status = new Map();
      const item = (s) =>
        h(
          'div.feat.compact',
          remotePic(s.icon, 'server', status.get(s.address)?.favicon),
          h('div.grow', HS.raw(h('b.ellipsis', { title: s.name }, s.name)), online(status.get(s.address))),
          h('button.btn.sm.primary', { type: 'button', title: `Wybierz instancję i wejdź na ${s.address}`, onclick: (e) => HS.busy(e.currentTarget, () => fromLink({ featured: s.id })) }, icon('play'), 'Graj'),
        );
      const draw = () =>
        clear(
          el,
          h(
            'section.card.featured-strip',
            h('div.card-head', icon('star'), h('h2.grow', 'Polecane serwery'), h('button.btn.sm', { type: 'button', onclick: () => HS.go('servers') }, list.length > servers.length ? `Wszystkie (${list.length})` : 'Zobacz w Serwerach', icon('chevron-right'))),
            h('div.feat-strip', servers.map(item)),
          ),
        );
      draw();
      for (const s of servers) {
        api.server.ping(s.address).then(
          (answer) => alive && (status.set(s.address, answer), draw()),
          () => alive && (status.set(s.address, { online: false }), draw()),
        );
      }
    });
    return { el, stop: () => (alive = false) };
  }

  HS.inviteUi = { open, fromLink, pasteDialog, createDialog, featuredCard, featuredStrip };
})();
