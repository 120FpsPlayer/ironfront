'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFeatured, cleanServer, cleanList, TTL, RETRY } = require('../src/main/featured');
const { createShopApi } = require('../src/main/shopapi');
const { mockFetch } = require('./helpers');

const SMP = { id: 'hammer-smp', name: 'Hammer SMP', address: 'mc.hammershop.pl', description: 'Survival bez wipe’ów, eventy co weekend.', tags: ['survival', 'eventy'], icon: 'https://hammershop.pl/smp.png', mc: '1.21.4', loader: 'fabric', pack: 'fabulously-optimized' };
const SKY = { id: 'skyblock', name: 'Skyblock', address: 'sky.example.pl:25570', description: 'Wyspy i ekonomia.', tags: [], icon: null, mc: null, loader: null, pack: null };

/** The shop API client against a stand-in website; `clock.now` is the time the list sees. */
function setup(routes, config = { website: 'https://hammershop.pl' }) {
  const fetchFn = mockFetch(routes);
  const clock = { now: 1_800_000_000_000 };
  const featured = createFeatured({ api: createShopApi({ config, fetchFn }), now: () => clock.now });
  return { featured, fetchFn, clock };
}

test('featured: the list comes from the shop API – a public route, asked without a code, kept for 5 minutes', async () => {
  const { featured, fetchFn, clock } = setup([{ match: /\/api\/launcher\/featured$/, json: { servers: [SMP, SKY] } }]);
  assert.deepEqual(await featured.list(), [SMP, SKY]);
  assert.equal(fetchFn.calls[0].url, 'https://hammershop.pl/api/launcher/featured');
  assert.equal(fetchFn.calls[0].init.method, 'GET');
  assert.equal('authorization' in fetchFn.calls[0].init.headers, false, 'no Hammer+ code goes to a public route');
  assert.match(fetchFn.calls[0].init.headers['user-agent'], /Hammer-Launcher/);
  // Asked again and again (every tab switch) – the shop hears it once in 5 minutes.
  clock.now += TTL - 1000;
  assert.deepEqual(await Promise.all([featured.list(), featured.list(), featured.list()]), [[SMP, SKY], [SMP, SKY], [SMP, SKY]]);
  assert.equal(fetchFn.calls.length, 1);
  clock.now += 2000;
  await featured.list();
  assert.equal(fetchFn.calls.length, 2);
  // What a caller does to its copy never reaches the kept list.
  (await featured.list())[0].tags.push('zmienione');
  (await featured.list()).length = 0;
  assert.deepEqual(await featured.list(), [SMP, SKY]);
  assert.deepEqual(await featured.find('skyblock'), SKY);
  assert.equal(await featured.find('nie-ma'), null);
  assert.equal(await featured.find(undefined), null);
});

test('featured: the shop API base is the configured one – shopApi before website, https only', async () => {
  const other = setup([{ match: /^https:\/\/sklep\.hammershop\.pl\/api\/launcher\/featured$/, json: { servers: [SKY] } }], { website: 'https://hammershop.pl', shopApi: 'https://sklep.hammershop.pl/' });
  assert.deepEqual(await other.featured.list(), [SKY]);
  for (const config of [{}, { website: '' }, { website: 'http://hammershop.pl' }, { website: 'hammershop.pl' }]) {
    const none = setup([{ match: /./, json: { servers: [SMP] } }], config);
    assert.deepEqual(await none.featured.list(), [], JSON.stringify(config));
    assert.equal(none.fetchFn.calls.length, 0, 'nothing is asked over plain http or without an address');
  }
});

test('featured: the shop is down, slow, or answers something else – an empty list, never an error', async () => {
  const answers = [
    [{ match: /./, status: 500, json: { error: 'boom' } }],
    [{ match: /./, status: 503, body: '<html>Bad gateway</html>' }],
    [{ match: /./, status: 404, json: { error: 'Nie znaleziono' } }],
    [{ match: /./, status: 429, json: { error: 'Zwolnij trochę i spróbuj ponownie.' } }],
    [{ match: /./, body: '<!doctype html><title>Domena na sprzedaż</title>' }],
    [{ match: /./, json: [SMP] }],
    [{ match: /./, json: { servers: 'brak' } }],
    [{ match: /./, json: { servers: null } }],
    [{ match: /./, json: {} }],
    [{ match: /./, json: null }],
    [{ match: /./, body: `{"servers":[${'"x",'.repeat(400_000)}"x"]}` }], // far bigger than this API ever answers
    [],
  ];
  for (const routes of answers) assert.deepEqual(await setup(routes).featured.list(), [], JSON.stringify(routes).slice(0, 80));
  const dead = createFeatured({ api: { getFeatured: async () => Promise.reject(new Error('getaddrinfo ENOTFOUND hammershop.pl')) } });
  assert.deepEqual(await dead.list(), []);
  const weird = createFeatured({ api: { getFeatured: async () => 'not a list' } });
  assert.deepEqual(await weird.list(), []);
  const empty = setup([{ match: /./, json: { servers: [] } }]);
  assert.deepEqual(await empty.featured.list(), [], 'an empty list is an answer too');
});

test('featured: after a failed try the shop is left alone for a minute, and the last good list stays', async () => {
  let fail = false;
  let asked = 0;
  const clock = { now: 1_800_000_000_000 };
  const api = {
    getFeatured: async () => {
      asked += 1;
      if (fail) throw new Error('offline');
      return [SMP];
    },
  };
  const featured = createFeatured({ api, now: () => clock.now });
  assert.deepEqual(await featured.list(), [SMP]);
  fail = true;
  clock.now += TTL + 1;
  assert.deepEqual(await featured.list(), [SMP], 'the shop went away – the list we had is still shown');
  assert.equal(asked, 2);
  clock.now += RETRY - 1000;
  await featured.list();
  assert.equal(asked, 2, 'not asked again within the minute');
  clock.now += 2000;
  fail = false;
  api.getFeatured = async () => ((asked += 1), [SKY]);
  assert.deepEqual(await featured.list(), [SKY]);
  assert.equal(asked, 3);
  // Never reachable at all: asked once a minute, an empty list each time.
  const never = createFeatured({ api: { getFeatured: async () => ((asked += 1), Promise.reject(new Error('offline'))) }, now: () => clock.now });
  asked = 0;
  assert.deepEqual([await never.list(), await never.list()], [[], []]);
  assert.equal(asked, 1);
});

test('featured: everything in the answer is untrusted – checked, cut to length, or dropped', () => {
  const server = (more) => cleanServer({ ...SMP, ...more });
  // An entry without a usable name or address is not shown at all.
  for (const entry of [null, 7, 'mc.hammershop.pl', [], {}, { name: 'Bez adresu' }, { address: 'mc.hammershop.pl' }, { name: '  \n ', address: 'a.pl' }, { name: 7, address: 'a.pl' }]) assert.equal(cleanServer(entry), null);
  for (const address of [undefined, 7, '', 'https://mc.hammershop.pl', 'mc.hammershop.pl/x', 'mc.hammershop.pl:99999', 'a b.pl', 'user@a.pl', '[::1]:25565', { toString: () => 'a.pl' }]) assert.equal(server({ address }), null, String(address));
  // Text is one plain line of limited length.
  assert.equal(server({ name: 'x'.repeat(200) }).name.length, 40);
  assert.equal(server({ description: 'y'.repeat(2000) }).description.length, 200);
  assert.equal(server({ name: '  Hammer\u202e\u0000\n SMP  ' }).name, 'Hammer SMP');
  assert.equal(server({ description: '<img src=x onerror=alert(1)>\n<b>Najlepszy</b>' }).description, '<img src=x onerror=alert(1)> <b>Najlepszy</b>', 'markup stays text – the window never reads it as HTML');
  for (const description of [undefined, null, 7, ['x'], { html: '<b>x</b>' }]) assert.equal(server({ description }).description, '');
  // Tags: at most six short words, each once; anything that is not text is dropped.
  assert.deepEqual(server({ tags: ['survival', ' Survival ', 'survival', 7, null, { x: 1 }, '', 'x'.repeat(50), 'a', 'b', 'c', 'd', 'e'] }).tags, ['survival', 'Survival', 'x'.repeat(20), 'a', 'b', 'c']);
  for (const tags of [undefined, null, 'survival,pvp', 7, { 0: 'x' }]) assert.deepEqual(server({ tags }).tags, []);
  // The icon is an https address or nothing.
  for (const icon of [undefined, null, 7, '', 'http://x.pl/i.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'file:///C:/x.png', '//x.pl/i.png', `https://x.pl/${'i'.repeat(400)}.png`, 'https://user:pass@x.pl/i.png']) assert.equal(server({ icon }).icon, null, String(icon));
  assert.equal(server({ icon: 'https://cdn.example.pl/i.png' }).icon, 'https://cdn.example.pl/i.png');
  // Game version, loader and pack: plain words of the known shapes – else as if not given.
  for (const mc of [undefined, null, 7, '', '../1.21', '<1.21>', 'x'.repeat(41)]) assert.equal(server({ mc }).mc, null);
  assert.equal(server({ mc: ' 1.21.4 ' }).mc, '1.21.4');
  for (const loader of [undefined, null, 7, '', 'optifine', 'fabric,forge']) assert.equal(server({ loader }).loader, null);
  assert.equal(server({ loader: ' Fabric ' }).loader, 'fabric');
  for (const pack of [undefined, null, 7, '', 'a', '../x', 'https://modrinth.com/modpack/x', 'x y']) assert.equal(server({ pack }).pack, null);
  // An id that cannot be used gets a neutral one.
  assert.equal(server({ id: '../../x' }, 0).id, 'serwer-1');
  assert.equal(cleanServer({ ...SMP, id: undefined }, 4).id, 'serwer-5');
  // Only the known fields come out.
  assert.deepEqual(Object.keys(server({ addedBy: '123', html: '<script>', __proto__: { x: 1 } })), ['id', 'name', 'address', 'description', 'tags', 'icon', 'mc', 'loader', 'pack']);
});

test('featured: the list itself – at most 25 servers, each address and id once', () => {
  assert.deepEqual(cleanList(null), []);
  assert.deepEqual(cleanList({ 0: SMP }), []);
  assert.deepEqual(cleanList([SMP, null, 'x', { ...SKY, address: 'MC.HammerShop.pl' }, SKY]), [SMP, SKY], 'the same address twice is one server');
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, name: `Serwer ${i}`, address: `s${i}.example.pl`, description: '' }));
  assert.equal(cleanList(many).length, 25);
  assert.deepEqual(cleanList([{ ...SMP }, { ...SKY, id: 'hammer-smp' }, { ...SKY, id: 'hammer-smp', address: 'trzeci.example.pl' }]).map((s) => s.id), ['hammer-smp', 'hammer-smp-2', 'hammer-smp-3']);
  const longId = 'x'.repeat(64);
  assert.equal(new Set(cleanList([{ ...SMP, id: longId }, { ...SKY, id: longId }, { ...SKY, id: longId, address: 'c.example.pl' }]).map((s) => s.id)).size, 3);
});
