'use strict';
/* Serwery – the multiplayer server list of an instance (the game's own servers.dat) with live status and one-click join. */

(() => {
  const { api, h, clear, icon, fmt, bus, state, attempt } = HS;

  const PARALLEL = 6; // pings running at once
  const plain = (text) => String(text ?? '').replace(/§[0-9a-fk-or]/gi, '').replace(/\s+/g, ' ').trim();
  const quality = (ms) => (ms < 120 ? 'on' : ms < 300 ? 'mid' : 'off');
  // "137 / 500"; huge networks get a short maximum ("28 431 / 200 tys.") so the column keeps its width.
  const players = (s) => `${fmt.num(s.players?.online ?? 0)} / ${(s.players?.max ?? 0) >= 100_000 ? fmt.compact(s.players.max) : fmt.num(s.players?.max ?? 0)}`;

  /** Add (no server) or edit a server. onSaved gets the new list. */
  function editServer(instance, server, onSaved) {
    const isNew = !server;
    const name = h('input.input', { value: server?.name ?? '', maxLength: 48, placeholder: 'np. Serwer ze znajomymi' });
    const address = h('input.input', { value: server?.address ?? '', maxLength: 260, placeholder: 'np. mc.hammershop.pl albo 192.168.1.10:25565', spellcheck: false });
    const result = h('div.hint', 'Kliknij „Sprawdź”, żeby zobaczyć, czy serwer odpowiada.');
    const check = h('button.btn', { type: 'button' }, icon('signal'), 'Sprawdź');
    check.onclick = () =>
      HS.busy(check, async () => {
        const target = address.value.trim();
        if (!target) return clear(result, h('span.warn', 'Najpierw wpisz adres serwera.'));
        clear(result, 'Łączę z serwerem…');
        const s = await api.server.ping(target).catch(() => ({ online: false }));
        if (!m.box.isConnected) return undefined;
        if (!s.online) return clear(result, h('span.warn', 'Serwer nie odpowiada.'), ' Możesz go dodać mimo to – może jest teraz wyłączony albo adres ma literówkę.');
        return clear(result, h('span.ok', 'Serwer działa'), ` · ${players(s)} graczy · ${s.latency} ms${s.version ? ` · ${plain(s.version)}` : ''}`);
      });
    const save = h('button.btn.primary', { type: 'button' }, icon(isNew ? 'plus' : 'check'), isNew ? 'Dodaj serwer' : 'Zapisz');
    const m = HS.modal({
      title: isNew ? 'Dodaj serwer' : `Edytuj: ${server.name || server.address}`,
      icon: 'server',
      body: h('div.form', HS.field('Nazwa', name, 'Pod tą nazwą zobaczysz serwer tutaj i w grze. Puste pole = adres.'), h('div.field', h('span', 'Adres serwera'), h('div.row', address, check), result)),
      foot: [h('button.btn.ghost', { type: 'button', onclick: () => m.close() }, 'Anuluj'), save],
    });
    save.onclick = () =>
      HS.busy(save, async () => {
        const data = { name: name.value, address: address.value };
        const list = await attempt(() => (isNew ? api.servers.add(instance.id, data) : api.servers.update(instance.id, server.index, data, server.address)), isNew ? 'Dodano serwer – zobaczysz go też w grze.' : 'Zapisano zmiany.');
        if (!list) return;
        m.close();
        onSaved(list);
      });
    for (const input of [name, address]) input.addEventListener('keydown', (e) => e.key === 'Enter' && save.click());
  }

  function render(root) {
    let servers = [];
    let run = 0; // the current round of pings – answers of an older round are dropped
    const status = new Map(); // address → ping answer (nothing while waiting)
    const rows = new Map(); // address → [row element]
    const inst = () => state.instance;
    const picker = HS.instancePicker();
    const body = h('div');
    const summary = h('span.dim');

    function statusBox(s) {
      if (!s) return h('div.server-status', h('div', h('span.spinner'), 'Sprawdzam…'));
      if (!s.online) return h('div.server-status', { title: s.error ?? '' }, h('div', h('span.dot.off'), h('b', 'Offline')));
      return h(
        'div.server-status',
        { title: s.players?.sample?.length ? `Online: ${s.players.sample.join(', ')}` : '' },
        h('div', h(`span.dot.${quality(s.latency)}`), h('b', `${s.latency} ms`)),
        h('div.dim', icon('users'), players(s)),
      );
    }

    function row(server, i) {
      const instance = inst();
      const s = status.get(server.address);
      const pic = s?.favicon ?? server.icon;
      const running = state.running.has(instance.id);
      const act = (fn) => async () => {
        const list = await attempt(fn);
        if (list) show(list);
      };
      return h(
        'div.installed-row.server-row',
        h('div.pic', pic ? h('img', { src: pic, alt: '' }) : icon('server')),
        h(
          'div.grow',
          h('b.ellipsis', server.name || server.address),
          h('small.ellipsis', [server.address, s?.online && s.version ? plain(s.version) : null].filter(Boolean).join(' · ')),
          s?.online && s.motd ? h('small.ellipsis.motd', plain(s.motd)) : null,
        ),
        statusBox(s),
        h(
          'div.row-acts',
          h('button.btn.sm.primary', { disabled: running, title: running ? 'Ta instancja już działa' : `Uruchom grę i wejdź na ${server.address}`, onclick: () => HS.play(instance.id, { server: server.address }) }, icon('play'), 'Graj'),
          h('button.btn.ghost.sm.icon', { title: 'Przesuń wyżej', 'aria-label': `Przesuń wyżej: ${server.name}`, disabled: i === 0, onclick: act(() => api.servers.move(instance.id, i, i - 1)) }, icon('arrow-up')),
          h('button.btn.ghost.sm.icon', { title: 'Przesuń niżej', 'aria-label': `Przesuń niżej: ${server.name}`, disabled: i === servers.length - 1, onclick: act(() => api.servers.move(instance.id, i, i + 1)) }, icon('arrow-down')),
          h('button.btn.ghost.sm.icon', { title: 'Edytuj', 'aria-label': `Edytuj: ${server.name}`, onclick: () => editServer(instance, server, show) }, icon('pen')),
          h(
            'button.btn.ghost.sm.icon.danger',
            {
              title: 'Usuń',
              'aria-label': `Usuń: ${server.name}`,
              onclick: async () => {
                if (!(await HS.confirmDialog({ title: 'Usunąć serwer z listy?', text: `„${server.name || server.address}” zniknie z listy – także w grze. Sam serwer oczywiście zostaje.`, confirm: 'Usuń', danger: true }))) return;
                act(() => api.servers.remove(instance.id, i, server.address))();
              },
            },
            icon('trash'),
          ),
        ),
      );
    }

    function drawSummary() {
      const online = servers.filter((s) => status.get(s.address)?.online).length;
      summary.textContent = servers.length ? `${fmt.count(servers.length, 'serwer', 'serwery', 'serwerów')} · online: ${online}` : '';
    }

    function draw() {
      const instance = inst();
      rows.clear();
      if (!instance) return clear(body, h('div.card', HS.empty('cube', 'Brak instancji', 'Utwórz instancję, żeby dodawać do niej serwery.')));
      drawSummary();
      if (!servers.length) {
        return clear(
          body,
          h(
            'div.card',
            HS.empty(
              'server',
              'Nie masz jeszcze żadnych serwerów',
              'Dodaj serwer, a zobaczysz tutaj, czy działa i ilu graczy jest online. Ta sama lista pojawi się w grze w trybie wieloosobowym.',
              h('button.btn.primary', { onclick: () => editServer(instance, null, show) }, icon('plus'), 'Dodaj serwer'),
            ),
          ),
        );
      }
      const list = h(
        'div.rows',
        servers.map((server, i) => {
          const el = row(server, i);
          rows.set(server.address, [...(rows.get(server.address) ?? []), { el, server, i }]);
          return el;
        }),
      );
      return clear(body, h('div', { style: { margin: '-6px 0 10px', fontSize: '12px' } }, summary), list);
    }

    /** Pings every address that has no answer yet – a few at a time, each row updates as its answer arrives. */
    async function pingMissing() {
      const mine = ++run;
      const todo = [...new Set(servers.map((s) => s.address))].filter((a) => !status.get(a));
      let next = 0;
      const worker = async () => {
        while (next < todo.length && mine === run) {
          const address = todo[next++];
          const answer = await api.server.ping(address).catch((err) => ({ online: false, error: err.message }));
          if (mine !== run) return;
          status.set(address, answer);
          for (const r of rows.get(address) ?? []) {
            const el = row(r.server, r.i);
            r.el.replaceWith(el);
            r.el = el;
          }
          drawSummary();
        }
      };
      await Promise.all(Array.from({ length: Math.min(PARALLEL, todo.length) }, worker));
    }

    function show(list) {
      servers = list;
      for (const address of [...status.keys()]) if (!servers.some((s) => s.address === address)) status.delete(address);
      draw();
      pingMissing();
    }

    async function load({ fresh = false } = {}) {
      const instance = inst();
      run += 1;
      if (fresh) status.clear();
      if (!instance) return draw();
      clear(body, h('div.rows', [1, 2, 3].map(() => h('div.skeleton', { style: { height: '74px' } }))));
      try {
        const list = await api.servers.list(instance.id);
        if (inst()?.id === instance.id) show(list);
      } catch (err) {
        clear(body, h('div.card', HS.empty('warning', 'Nie udało się wczytać listy serwerów', err.message)));
      }
    }

    clear(
      root,
      h(
        'div.page',
        h(
          'div.page-head',
          h('div', h('h1', 'Serwery'), h('p', 'Twoje serwery z tej instancji – te same, które widzisz w grze.')),
          h(
            'div.actions',
            h('button.btn.icon', { title: 'Odśwież status', 'aria-label': 'Odśwież status serwerów', onclick: () => load({ fresh: true }) }, icon('refresh')),
            h('button.btn.primary', { onclick: () => inst() && editServer(inst(), null, show) }, icon('plus'), 'Dodaj serwer'),
            picker.el,
          ),
        ),
        body,
      ),
    );
    load();

    let lastId = inst()?.id;
    const offs = [
      bus.on('settings', () => {
        picker.draw();
        if (inst()?.id === lastId) return;
        lastId = inst()?.id;
        load({ fresh: true });
      }),
      bus.on('instances', () => picker.draw()),
      bus.on('game', () => servers.length && draw()),
    ];
    return () => {
      run += 1;
      offs.forEach((f) => f());
    };
  }

  HS.views.servers = { title: 'Serwery', icon: 'server', render };
})();
