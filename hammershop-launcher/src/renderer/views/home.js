'use strict';
/* Graj – start screen: big PLAY button, instance picker, install progress, news, server status. */

(() => {
  const { api, h, clear, icon, fmt, LOADERS, tile, bus, state, open } = HS;

  function instanceLine(i) {
    if (!i) return 'Brak instancji';
    return `Minecraft ${i.mcVersion}${i.loader !== 'vanilla' ? ` · ${LOADERS[i.loader]?.name ?? i.loader}` : ''}`;
  }

  function pickInstance(anchor) {
    HS.menu(anchor, [
      ...state.instances.map((i) => ({
        node: tile(i, 26),
        label: i.name,
        hint: `${i.mcVersion}${i.loader !== 'vanilla' ? ` ${LOADERS[i.loader]?.name}` : ''}`,
        on: i.id === state.instance?.id,
        onClick: () => state.selectInstance(i.id),
      })),
      '-',
      { icon: 'plus', label: 'Nowa instancja…', onClick: () => HS.editInstance() },
    ]);
  }

  function render(root) {
    const playArea = h('div');
    const progressArea = h('div');
    const newsList = h('div.news', [1, 2, 3].map(() => h('div.skeleton', { style: { height: '72px' } })));
    const serverBody = h('div', h('div.skeleton', { style: { height: '90px' } }));
    const statsBody = h('div');

    function drawPlay() {
      const i = state.instance;
      const run = i ? state.running.get(i.id) : null;
      const prog = i ? state.progress.get(i.id) : null;
      const btn = h(
        'button.play-btn',
        {
          disabled: !i,
          onclick: () => (run === 'running' || run === 'starting' ? HS.stop(i.id) : HS.play(i.id)),
        },
        run === 'running' || run === 'starting'
          ? [icon('stop'), 'ZATRZYMAJ']
          : run === 'preparing'
            ? [h('span.spinner'), 'PRZYGOTOWANIE']
            : [icon('play'), 'GRAJ'],
      );
      if (run === 'running' || run === 'starting') btn.classList.add('running');
      if (run === 'preparing') btn.disabled = true;
      clear(
        playArea,
        h(
          'div.play-bar',
          h('button.instance-pick', { onclick: (e) => pickInstance(e.currentTarget), title: 'Zmień instancję' }, i ? tile(i, 40) : null, h('div', h('b', i?.name ?? 'Brak instancji'), h('small', instanceLine(i))), icon('chevron-down')),
          btn,
        ),
      );
      if (prog && run === 'preparing') {
        const pct = prog.percent;
        clear(
          progressArea,
          h(
            'div.play-progress',
            h('div.label', h('b', prog.label ?? 'Przygotowanie…'), h('span', pct == null ? '' : `${pct}%`)),
            h(`div.progress${pct == null ? '.indeterminate' : ''}`, h('i', { style: { '--w': `${pct ?? 0}%` } })),
          ),
        );
      } else if (run === 'starting') {
        clear(progressArea, h('div.play-progress', h('div.label', h('b', 'Uruchamianie gry…'), h('span', 'okno Minecrafta zaraz się pojawi')), h('div.progress.indeterminate', h('i'))));
      } else if (run === 'running') {
        clear(progressArea, h('div.play-progress', h('div.label', h('b.ok', 'Gra działa'), h('span', 'miłej gry!'))));
      } else clear(progressArea);
      drawStats();
    }

    function drawStats() {
      const i = state.instance;
      if (!i) return clear(statsBody, HS.empty('cube', 'Brak instancji', 'Utwórz pierwszą instancję, aby zagrać.'));
      clear(
        statsBody,
        h('div.row', { style: { marginBottom: '14px' } }, tile(i, 46), h('div.grow', h('h3.ellipsis', i.name), h('div.dim', instanceLine(i)))),
        h(
          'div.grid.g2',
          { style: { gap: '10px' } },
          stat('clock', 'Czas gry', fmt.duration(i.playTimeMs)),
          stat('signal', 'Ostatnio', fmt.ago(i.lastPlayed)),
          stat('bolt', 'Optymalizacja', i.optimized && i.loader !== 'vanilla' ? 'włączona' : 'wyłączona'),
          stat('memory', 'Pamięć RAM', i.memoryMb ? fmt.mb(i.memoryMb) : state.settings.memoryMb ? fmt.mb(state.settings.memoryMb) : 'automatycznie'),
        ),
      );
    }
    const stat = (ic, label, value) => h('div.row', { style: { gap: '10px', padding: '10px', borderRadius: '10px', background: 'var(--bg2)', border: '1px solid var(--line)' } }, h('span', { style: { color: 'var(--accent)', display: 'grid' } }, icon(ic)), h('div', h('small.dim', { style: { display: 'block', fontSize: '11px' } }, label), h('b', { style: { fontSize: '13px' } }, value)));

    const info = state.info?.config ?? {};
    const loginCta = state.accounts.length
      ? null
      : h(
          'div.login-cta',
          icon('microsoft'),
          h('div.grow', h('b', 'Zaloguj się kontem Microsoft'), h('div.muted', 'Potrzebujesz konta z kupionym Minecraftem: Java Edition. Hasło wpisujesz tylko na stronie Microsoftu.')),
          h('button.btn.primary', { onclick: () => HS.login() }, icon('user-plus'), 'Zaloguj się'),
        );

    const links = [
      info.shopUrl && { icon: 'store', title: 'Sklep HammerShop', sub: 'Rangi, pluginy, usługi', url: info.shopUrl },
      info.discordInvite && { icon: 'discord', title: 'Discord', sub: 'Pomoc i społeczność', url: info.discordInvite },
      info.website && { icon: 'globe', title: 'Strona', sub: new URL(info.website).host, url: info.website },
    ].filter(Boolean);

    clear(
      root,
      h(
        'div.page',
        loginCta,
        h(
          'section.hero',
          h('div.grid-bg'),
          h('img.mark', { src: 'assets/hammershop-mark.svg', alt: '' }),
          h('div.eyebrow', icon('hammer'), 'HammerShop Launcher'),
          h('h1', 'Minecraft, który ', h('span', 'po prostu działa'), '.'),
          h('p', 'Więcej FPS, mody w jednym kliknięciu i zero kombinowania z Javą. Wybierz instancję i graj.'),
          playArea,
          progressArea,
        ),
        h(
          'div.home-grid',
          h('section.card', h('div.card-head', icon('book'), h('h2', 'Aktualności')), newsList),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
            info.server?.address ? h('section.card.server-card', h('div.card-head', icon('server'), h('h2', info.server.name || 'Serwer')), serverBody) : null,
            h('section.card', h('div.card-head', icon('cube'), h('h2', 'Wybrana instancja')), statsBody),
            links.length ? h('div.links', { style: { gridTemplateColumns: `repeat(${links.length}, minmax(0,1fr))`, marginTop: 0 } }, links.map((l) => h('button.link-card', { onclick: () => open(l.url) }, icon(l.icon), h('b', l.title), h('small', l.sub)))) : null,
          ),
        ),
      ),
    );

    drawPlay();

    api.news
      .list()
      .then((items) =>
        clear(
          newsList,
          items.map((n) =>
            h(
              `div.news-item${n.url ? '.clickable' : ''}`,
              { onclick: n.url ? () => open(n.url) : null, style: n.url ? { cursor: 'pointer' } : null },
              h('div.bar'),
              h('div.grow', h('div.row', { style: { gap: '8px', marginBottom: '3px' } }, n.tag ? HS.chip(n.tag, 'accent') : null, n.date ? h('small.dim', n.date) : null), h('h3', n.title), h('p', n.body)),
            ),
          ),
        ),
      )
      .catch(() => clear(newsList, h('p.muted', 'Nie udało się pobrać aktualności.')));

    async function ping() {
      if (!info.server?.address) return;
      try {
        const s = await api.server.ping(info.server.address);
        clear(
          serverBody,
          h('div.status', h(`span.dot.${s.online ? 'on' : 'off'}`), h('b', s.online ? 'Online' : 'Offline'), s.online && s.latency != null ? h('span.dim', `${s.latency} ms`) : null, h('span.grow'), h('code.dim', info.server.address)),
          s.online
            ? h(
                'div.row',
                { style: { alignItems: 'flex-end' } },
                h('div.grow', h('div.stat-big', `${fmt.num(s.players?.online)}`, h('span.dim', { style: { fontSize: '15px', fontWeight: 700 } }, ` / ${fmt.num(s.players?.max)}`)), h('div.dim', fmt.plural(s.players?.online ?? 0, 'gracz online', 'graczy online', 'graczy online'))),
                state.instance ? h('button.btn.primary.sm', { onclick: () => HS.play(state.instance.id, { join: true }) }, icon('play'), 'Dołącz') : null,
              )
            : h('p.muted', 'Serwer jest teraz niedostępny.'),
        );
      } catch {
        clear(serverBody, h('div.status', h('span.dot.off'), h('b', 'Offline')));
      }
    }
    ping();
    const timer = setInterval(ping, 60000);

    const offs = [bus.on('instances', drawPlay), bus.on('settings', drawPlay), bus.on('game', drawPlay), bus.on('accounts', () => HS.go('home'))];
    return () => {
      clearInterval(timer);
      offs.forEach((f) => f());
    };
  }

  HS.views.home = { title: 'Graj', icon: 'home', render };
})();
