'use strict';

/* Aktualności and the message bar from the shop's admin panel (src/main/news.js): what the shop's /news answer
   is cut down to, which message is on the screen, the feed with its fallbacks – and how the launcher introduces
   itself to the shop (User-Agent with the real version). */

const test = require('node:test');
const assert = require('node:assert/strict');
const { BUILT_IN, cleanItem, cleanAlert, cleanRelease, cleanFeed, alertVisible, closeAlert, newestAt, createNewsFeed, LIMITS, MAX_NEWS, REFRESH_EVERY, MIN_INTERVAL } = require('../src/main/news');
const { createShopApi } = require('../src/main/shopapi');
const { createServices } = require('../src/main/services');
const { sanitize, DEFAULT_SETTINGS } = require('../src/main/settings');
const { loadConfig, DEFAULTS } = require('../src/main/config');
const { APP_VERSION, userAgent, USER_AGENT } = require('../src/main/net');
const { line, block, httpsUrl } = require('../src/main/text');
const { tmpDir, mockFetch, plusKeys } = require('./helpers');

const NOW = 1_800_000_000_000;
const ITEM = { id: 'n_ab12cd', title: 'Hammer+ taniej o 20%', body: 'Do niedzieli.\nKod: HAMMER20', tag: 'Promocja', date: '12.11.2026', at: NOW - 3600e3, url: 'https://hammershop.pl/launcher#plus', image: 'https://hammershop.pl/img/promo.png', pinned: true };
const OLD = { id: 'n_000001', title: 'Launcher 2.6.0', body: 'Aktualności prosto ze sklepu.', tag: 'Nowość', date: '10.11.2026', at: NOW - 3 * 864e5, url: null, image: null, pinned: false };
const ALERT = { id: 'a_17', level: 'warning', text: 'Dziś o 22:00 przerwa techniczna sklepu.', url: 'https://hammershop.pl/status', until: NOW + 3600e3 };
const RELEASE = { version: '2.6.1', notes: 'Poprawki.', date: '2026-11-12T10:00:00.000Z', minVersion: '2.6.0', size: 257000000, url: 'https://hammershop.pl/download' };

/** The feed against a stand-in shop; `shop.answer` is what /news says (null = the shop is down). */
function setup({ config = { website: 'https://hammershop.pl' }, answer = { news: [ITEM, OLD], alert: ALERT, release: RELEASE }, extraRoutes = [] } = {}) {
  const shop = { answer };
  const fetchFn = mockFetch([...extraRoutes, { match: (url) => /\/api\/launcher\/news$/.test(url) && shop.answer != null, json: () => shop.answer }]);
  const clock = { now: NOW };
  const changes = [];
  const feed = createNewsFeed({ api: createShopApi({ config, fetchFn }), config, fetchFn, now: () => clock.now, onChange: (s) => changes.push(s), firstWait: 5000 });
  const asked = () => fetchFn.calls.filter((c) => c.url.endsWith('/api/launcher/news')).length;
  return { feed, shop, fetchFn, clock, changes, asked };
}

test('text from outside: one line or a few paragraphs, plain, cut to a length; links only when https', () => {
  assert.equal(line('  Dwie\n\tlinie \u202eodwrócone\u0000  ', 100), 'Dwie linie odwrócone');
  assert.equal(line('x'.repeat(50), 10), 'xxxxxxxxxx');
  assert.equal(line('abcdefgh ij', 9), 'abcdefgh', 'no space left at the cut');
  for (const junk of [null, undefined, 7, {}, ['a']]) assert.equal(line(junk, 10), '');
  assert.equal(block(' Pierwszy  akapit.\r\n\r\n\r\n\r\nDrugi\takapit. \n  Trzecia linia.\u0007 ', 200), 'Pierwszy akapit.\n\nDrugi akapit.\nTrzecia linia.');
  assert.equal(block('a\n'.repeat(100), 9), 'a\na\na\na\na');
  assert.equal(block(12, 10), '');
  assert.equal(httpsUrl('https://hammershop.pl/launcher#plus'), 'https://hammershop.pl/launcher#plus');
  assert.equal(httpsUrl(' https://hammershop.pl '), 'https://hammershop.pl/');
  for (const bad of ['http://hammershop.pl', 'javascript:alert(1)', 'hammer://join?server=x', 'file:///C:/x', '//hammershop.pl', 'hammershop.pl', 'https://', 'https://kto:haslo@hammershop.pl', 'https://hammershop.pl/a b', `https://hammershop.pl/${'x'.repeat(700)}`, '', null, 5, {}]) assert.equal(httpsUrl(bad), null, String(bad));
});

test('news of the shop: every field checked – text only, lengths cut, links only https, junk left out', () => {
  assert.deepEqual(cleanItem(ITEM), ITEM);
  assert.deepEqual(cleanItem(OLD), OLD);
  const wild = cleanItem({ id: '<script>', title: `  ${'T'.repeat(300)}`, body: `Linia\u0000 1\n\n\n\nLinia 2 ${'b'.repeat(900)}`, tag: 'Bardzo długi znacznik aktualności', date: 'x'.repeat(90), at: '1762941000000', url: 'javascript:alert(1)', image: 'http://hammershop.pl/a.png', pinned: 'true', html: '<b>x</b>' });
  assert.equal(wild.id, null);
  assert.equal(wild.title.length, LIMITS.title);
  assert.equal(wild.body.length, LIMITS.body);
  assert.ok(wild.body.startsWith('Linia 1\n\nLinia 2 b'));
  assert.equal(wild.tag.length <= LIMITS.tag, true);
  assert.equal(wild.date.length, LIMITS.date);
  assert.deepEqual([wild.at, wild.url, wild.image, wild.pinned], [null, null, null, false], 'a number as text is no time, other schemes are no links, only true pins');
  assert.equal('html' in wild, false, 'unknown fields are dropped');
  assert.deepEqual(cleanItem({ body: 'Sama treść' }), { id: null, title: 'Aktualność', body: 'Sama treść', tag: null, date: null, at: null, url: null, image: null, pinned: false });
  for (const junk of [null, undefined, 'tekst', 5, [], {}, { title: '   ', body: '' }, { title: 7 }]) assert.equal(cleanItem(junk), null, JSON.stringify(junk));

  const feed = cleanFeed({ news: [ITEM, null, 'x', OLD, ...Array.from({ length: 30 }, (_, i) => ({ title: `Nr ${i}` }))], alert: ALERT, release: RELEASE }, NOW);
  assert.equal(feed.news.length, MAX_NEWS);
  assert.deepEqual(feed.news.slice(0, 3).map((n) => n.title), ['Hammer+ taniej o 20%', 'Launcher 2.6.0', 'Nr 0'], 'the order of the shop is kept (pinned first, then newest)');
  for (const junk of [null, undefined, 'x', [], { news: 'x' }, { news: null, alert: 'x', release: [] }]) assert.deepEqual(cleanFeed(junk, NOW), { news: [], alert: null, release: null });
});

test('the message bar: level, text, link and end time; a message without an id still has one', () => {
  assert.deepEqual(cleanAlert(ALERT, NOW), ALERT);
  assert.deepEqual(cleanAlert({ text: 'Bez niczego' }, NOW), { id: cleanAlert({ text: 'Bez niczego', level: 'info' }, NOW).id, level: 'info', text: 'Bez niczego', url: null, until: null });
  assert.match(cleanAlert({ text: 'Bez niczego' }, NOW).id, /^a_[0-9a-f]{12}$/);
  assert.notEqual(cleanAlert({ text: 'Bez niczego' }, NOW).id, cleanAlert({ text: 'Inny tekst' }, NOW).id, 'another text is another message');
  assert.equal(cleanAlert({ ...ALERT, level: 'critical' }, NOW).level, 'critical');
  for (const level of ['error', 'CRITICAL', '', null, 5]) assert.equal(cleanAlert({ ...ALERT, level }, NOW).level, 'info', String(level));
  assert.equal(cleanAlert({ ...ALERT, url: 'http://hammershop.pl' }, NOW).url, null);
  assert.equal(cleanAlert({ ...ALERT, id: 'a b<c>' }, NOW).id.startsWith('a_'), true);
  assert.equal(cleanAlert({ ...ALERT, text: `${'Bardzo długi komunikat. '.repeat(40)}\nDruga linia` }, NOW).text.length, LIMITS.alert);
  assert.equal(cleanAlert({ ...ALERT, text: 'Jedna\nlinia' }, NOW).text, 'Jedna linia');
  // Past `until` it is not shown – and one without an end stays.
  assert.equal(cleanAlert({ ...ALERT, until: NOW - 1 }, NOW), null);
  assert.equal(cleanAlert({ ...ALERT, until: NOW }, NOW), null);
  assert.equal(cleanAlert({ ...ALERT, until: null }, NOW).until, null);
  assert.equal(cleanAlert({ ...ALERT, until: 'jutro' }, NOW).until, null);
  for (const junk of [null, undefined, 'x', [], {}, { text: '  ' }, { text: 5 }, { id: 'a_1', level: 'critical' }]) assert.equal(cleanAlert(junk, NOW), null, JSON.stringify(junk));
});

test('a closed message stays closed until its id changes; a critical one cannot be closed; past its time it goes', () => {
  const alert = cleanAlert(ALERT, NOW);
  assert.equal(alertVisible(alert, { closed: '', now: NOW }), true);
  const closed = closeAlert(alert, '');
  assert.equal(closed, 'a_17');
  assert.equal(alertVisible(alert, { closed, now: NOW }), false);
  assert.equal(alertVisible(alert, { closed, now: NOW + 30 * 60e3 }), false, 'still closed half an hour later');
  // The same id with another text is the same message; a new id shows again.
  assert.equal(alertVisible({ ...alert, text: 'Poprawiona literówka.' }, { closed, now: NOW }), false);
  assert.equal(alertVisible({ ...alert, id: 'a_18' }, { closed, now: NOW }), true);
  // Critical: closing changes nothing, and what was closed before stays remembered.
  const critical = { ...alert, id: 'a_19', level: 'critical' };
  assert.equal(closeAlert(critical, 'a_17'), 'a_17');
  assert.equal(alertVisible(critical, { closed: 'a_19', now: NOW }), true, 'even a stored id does not hide a critical message');
  // Time.
  assert.equal(alertVisible(alert, { closed: '', now: ALERT.until }), false);
  assert.equal(alertVisible(critical, { closed: '', now: ALERT.until + 1 }), false);
  assert.equal(alertVisible({ ...alert, until: null }, { closed: '', now: NOW + 1e12 }), true);
  for (const none of [null, undefined, {}, { id: 'x', text: '' }]) assert.equal(alertVisible(none, { now: NOW }), false);
  assert.equal(closeAlert(null, 'a_1'), 'a_1');
});

test('the newest launcher version of the shop: a real version number, https download page, optional minimum', () => {
  assert.deepEqual(cleanRelease(RELEASE), { version: '2.6.1', notes: 'Poprawki.', date: Date.parse('2026-11-12T10:00:00.000Z'), minVersion: '2.6.0', size: 257000000, url: 'https://hammershop.pl/download' });
  assert.deepEqual(cleanRelease({ version: ' v2.7.0 ' }), { version: '2.7.0', notes: null, date: null, minVersion: null, size: null, url: null });
  assert.equal(cleanRelease({ ...RELEASE, minVersion: 'najnowsza' }).minVersion, null);
  assert.equal(cleanRelease({ ...RELEASE, minVersion: null }).minVersion, null);
  assert.equal(cleanRelease({ ...RELEASE, url: 'http://hammershop.pl/download' }).url, null);
  assert.equal(cleanRelease({ ...RELEASE, size: -5 }).size, null);
  assert.equal(cleanRelease({ ...RELEASE, date: 'wczoraj' }).date, null);
  assert.equal(cleanRelease({ ...RELEASE, notes: `Nowe:\r\n- aktualności\u0000\n\n\n\n- komunikaty ${'x'.repeat(3000)}` }).notes.length, LIMITS.notes);
  for (const junk of [null, undefined, 'x', [], {}, { version: 'nowa' }, { version: 261 }, { notes: 'bez wersji' }]) assert.equal(cleanRelease(junk), null, JSON.stringify(junk));
});

test('the launcher introduces itself to the shop with its real version: "Hammer-Launcher/<version> (hammershop.pl)"', async () => {
  const pkg = require('../package.json');
  assert.equal(APP_VERSION, pkg.version);
  assert.equal(userAgent(), `Hammer-Launcher/${pkg.version} (hammershop.pl)`);
  const COUNTED = /^Hammer-?Launcher\/(\d+\.\d+\.\d+)/; // how the shop counts launcher starts per version
  assert.equal(COUNTED.exec(userAgent())[1], pkg.version);
  assert.equal(userAgent('2.7.3'), 'Hammer-Launcher/2.7.3 (hammershop.pl)');
  assert.equal(userAgent('2.7.0-beta.1'), 'Hammer-Launcher/2.7.0-beta.1 (hammershop.pl)');
  // What is not a version never gets into a header.
  for (const bad of ['', null, undefined, '2.7', 'nowa', '2.7.3\r\nX-Evil: 1', '2.7.3 (x)', {}]) assert.equal(userAgent(bad), userAgent(), String(bad));
  assert.match(USER_AGENT, /^Hammer-Launcher\//, 'the other services keep their header');

  // GET /news – public, no code, with the launcher's own version.
  const { feed, fetchFn } = setup();
  await feed.refresh();
  const [call] = fetchFn.calls;
  assert.equal(call.url, 'https://hammershop.pl/api/launcher/news');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.headers['user-agent'], `Hammer-Launcher/${pkg.version} (hammershop.pl)`);
  assert.equal(COUNTED.exec(call.init.headers['user-agent'])[1], pkg.version);
  assert.equal('authorization' in call.init.headers, false, 'no Hammer+ code goes to a public route');

  // The running app's version (app.getVersion()) wins over package.json – for every call of the shop API.
  const shopFetch = mockFetch([{ match: /\/news$/, json: { news: [] } }, { match: /\/featured$/, json: { servers: [] } }, { match: /\/cloud$/, json: { updatedAt: 1, data: {} } }, { match: /\/cape$/, json: { cape: null } }]);
  const api = createShopApi({ config: { website: 'https://hammershop.pl' }, fetchFn: shopFetch, version: '2.7.3' });
  await api.getNews();
  await api.getFeatured();
  await api.getCloud('HP1.kod');
  await api.putCape('HP1.kod', null);
  assert.deepEqual(shopFetch.calls.map((c) => c.init.headers['user-agent']), Array(4).fill('Hammer-Launcher/2.7.3 (hammershop.pl)'));
  // …and the services hand it on.
  const viaServices = mockFetch([{ match: /\/api\/launcher\/news$/, json: { news: [ITEM] } }]);
  const s = createServices({ root: tmpDir(), config: { website: 'https://hammershop.pl' }, accounts: {}, fetchFn: viaServices, appVersion: '2.8.0' });
  await s.news.feed();
  assert.equal(viaServices.calls.find((c) => c.url.endsWith('/news')).init.headers['user-agent'], 'Hammer-Launcher/2.8.0 (hammershop.pl)');
});

test('feed: the shop\'s news when it has some – else the built-in tips; the shop is asked at most once a minute', async () => {
  const { feed, shop, clock, changes, asked } = setup();
  assert.deepEqual([feed.peek().source, feed.peek().news.map((n) => n.title), feed.peek().ok, feed.peek().fetchedAt], ['builtin', BUILT_IN.map((n) => n.title), false, null], 'before the first answer: the tips');
  const first = await feed.current();
  assert.deepEqual([first.source, first.ok, first.fetchedAt, first.news, first.alert, first.release.version], ['shop', true, NOW, [ITEM, OLD], ALERT, '2.6.1']);
  assert.deepEqual([asked(), changes.length], [1, 1]);
  // Every tab switch and every focus of the window asks – the shop hears it once a minute.
  await Promise.all([feed.current(), feed.refresh(), feed.refresh(), feed.current()]);
  clock.now += MIN_INTERVAL - 1000;
  await feed.refresh();
  assert.equal(asked(), 1);
  clock.now += 2000;
  await feed.refresh();
  assert.deepEqual([asked(), changes.length], [2, 1], 'the same answer is no news for the window');
  // „Sprawdź teraz” asks now.
  await feed.refresh({ force: true });
  assert.equal(asked(), 3);
  // Two at once are one request.
  clock.now += MIN_INTERVAL;
  await Promise.all([feed.refresh(), feed.refresh({ force: true })]);
  assert.equal(asked(), 4);
  assert.equal(MIN_INTERVAL, 60 * 1000);
  assert.equal(REFRESH_EVERY, 10 * 60 * 1000);

  // The list changed: the window is told.
  shop.answer = { news: [OLD], alert: null, release: null };
  clock.now += MIN_INTERVAL;
  const next = await feed.refresh();
  assert.deepEqual([next.news, next.alert, next.release, changes.length], [[OLD], null, null, 2]);
  // An empty list: the tips are back (the shop is online, it just has nothing to say).
  shop.answer = { news: [], alert: null, release: RELEASE };
  clock.now += MIN_INTERVAL;
  const empty = await feed.refresh();
  assert.deepEqual([empty.source, empty.news.map((n) => n.title), empty.ok, empty.release.version], ['builtin', BUILT_IN.map((n) => n.title), true, '2.6.1']);
  // What a caller does to its copy never reaches the feed.
  empty.news.length = 0;
  empty.release.version = '9.9.9';
  assert.deepEqual([feed.peek().news.length, feed.peek().release.version], [3, '2.6.1']);
});

test('feed: the shop is down, slow or answers something else – the tips, quietly; what was known stays', async () => {
  for (const routes of [
    [{ match: /./, status: 500, json: { error: 'boom' } }],
    [{ match: /./, status: 404, json: { error: 'Nie znaleziono' } }],
    [{ match: /./, body: '<!doctype html><title>Domena na sprzedaż</title>' }],
    [{ match: /./, json: ['a', 'b'] }],
  ]) {
    const down = setup({ answer: null, extraRoutes: routes });
    const state = await down.feed.current();
    assert.deepEqual([state.source, state.news.map((n) => n.title), state.alert, state.release, state.ok], ['builtin', BUILT_IN.map((n) => n.title), null, null, false], JSON.stringify(routes[0]));
    assert.equal(down.changes.length, 0, 'nothing changed for the window: it shows the tips already');
  }
  // No connection at all.
  const offline = createNewsFeed({ api: createShopApi({ config: { website: 'https://hammershop.pl' }, fetchFn: async () => Promise.reject(new TypeError('fetch failed')) }), now: () => NOW });
  assert.deepEqual([(await offline.current()).source, offline.peek().ok], ['builtin', false]);
  // No shop address (or not https): nothing is asked, ever.
  for (const config of [{}, { website: '' }, { website: 'http://hammershop.pl' }]) {
    const none = setup({ config });
    assert.deepEqual([(await none.feed.current()).source, none.fetchFn.calls.length, none.feed.peek().ok], ['builtin', 0, false], JSON.stringify(config));
  }
  // A shop that never answers does not hold the first screen: after a moment the tips are there.
  const hanging = createNewsFeed({ api: { base: () => 'https://hammershop.pl/api/launcher', getNews: () => new Promise(() => {}) }, now: () => NOW, firstWait: 20 });
  const started = Date.now();
  assert.equal((await hanging.current()).source, 'builtin');
  assert.ok(Date.now() - started < 2000);

  // It was online, then it goes away: the news, the message and the release stay – only `ok` says it is away.
  const { feed, shop, clock, changes } = setup();
  await feed.current();
  shop.answer = null;
  clock.now += MIN_INTERVAL;
  const away = await feed.refresh();
  assert.deepEqual([away.source, away.news, away.alert, away.release.version, away.ok], ['shop', [ITEM, OLD], ALERT, '2.6.1', false]);
  assert.equal(changes.at(-1).ok, false, 'the window (and the required-update check) hear that the shop is away');
  // …but a message whose time is up goes, with or without the shop.
  clock.now = ALERT.until + 1;
  assert.equal(feed.peek().alert, null);
  assert.equal((await feed.refresh()).alert, null);
  // Back online.
  shop.answer = { news: [OLD], alert: null, release: null };
  clock.now += MIN_INTERVAL;
  assert.deepEqual([(await feed.refresh()).news, feed.peek().ok], [[OLD], true]);
});

test('feed: a custom newsUrl still replaces the list – the message and the release keep coming from the shop', async () => {
  const custom = [{ title: 'Z własnego adresu', body: 'Opis', url: 'https://example.org/a', tag: 'Info', date: '1.11.2026' }];
  const { feed, fetchFn } = setup({ config: { website: 'https://hammershop.pl', newsUrl: 'https://example.org/news.json' }, extraRoutes: [{ match: /example\.org\/news\.json$/, json: custom }] });
  const state = await feed.current();
  assert.deepEqual([state.source, state.news.map((n) => n.title), state.alert.id, state.release.version, state.ok], ['custom', ['Z własnego adresu'], 'a_17', '2.6.1', true]);
  assert.deepEqual(fetchFn.calls.map((c) => c.url).sort(), ['https://example.org/news.json', 'https://hammershop.pl/api/launcher/news']);
  // The custom address fails: the tips – not the shop's list (the owner asked for another source).
  const broken = setup({ config: { website: 'https://hammershop.pl', newsUrl: 'https://example.org/nie-ma.json' } });
  assert.deepEqual([(await broken.feed.current()).source, broken.feed.peek().news.length], ['builtin', 3]);
  // newsUrl without any shop: as before.
  const alone = setup({ config: { website: '', newsUrl: 'https://example.org/news.json' }, extraRoutes: [{ match: /example\.org\/news\.json$/, json: custom }] });
  assert.deepEqual([(await alone.feed.current()).source, alone.feed.peek().alert, alone.feed.peek().ok], ['custom', null, false]);
});

test('settings and config: the new keys have defaults and only take proper values', () => {
  assert.deepEqual([DEFAULT_SETTINGS.autoUpdate, DEFAULT_SETTINGS.closedAlert, DEFAULT_SETTINGS.newsSeenAt], [true, '', 0]);
  assert.equal(sanitize({ autoUpdate: false }).autoUpdate, false);
  assert.equal(sanitize({ autoUpdate: 1 }).autoUpdate, true);
  assert.equal(sanitize({ closedAlert: 'a_17' }).closedAlert, 'a_17');
  assert.equal(sanitize({ closedAlert: '' }, { ...DEFAULT_SETTINGS, closedAlert: 'a_17' }).closedAlert, '');
  for (const bad of ['a b', '<x>', 'x'.repeat(65), 7, null]) assert.equal(sanitize({ closedAlert: bad }, { ...DEFAULT_SETTINGS, closedAlert: 'a_1' }).closedAlert, 'a_1', String(bad));
  assert.equal(sanitize({ newsSeenAt: 1762941000000 }).newsSeenAt, 1762941000000);
  assert.equal(sanitize({ newsSeenAt: -5 }).newsSeenAt, 0);
  assert.equal(sanitize({ newsSeenAt: 'kiedyś' }, { ...DEFAULT_SETTINGS, newsSeenAt: 7 }).newsSeenAt, 7);
  // launcher.config.json: "beta" by default, the update keys empty.
  assert.deepEqual([DEFAULTS.channel, DEFAULTS.updateUrl, DEFAULTS.updatePublicKey], ['beta', '', '']);
  const shipped = loadConfig();
  assert.deepEqual([shipped.channel, shipped.updateUrl, shipped.updatePublicKey], ['beta', '', '']);
  assert.equal(loadConfig('/nie/ma/takiego/pliku.json').channel, 'beta');
  assert.equal(newestAt([ITEM, OLD, { title: 'bez czasu' }, null]), ITEM.at);
  assert.equal(newestAt([]), 0);
  assert.equal(newestAt(null), 0);
});

test('services: the feed for the window – a closed message stays away, „nowe” is measured against what was seen', async () => {
  const shop = { answer: { news: [ITEM, OLD], alert: ALERT, release: null } };
  const fetchFn = mockFetch([{ match: (url) => /\/api\/launcher\/news$/.test(url) && shop.answer != null, json: () => shop.answer }]);
  const clock = { now: NOW };
  const events = [];
  const s = createServices({ root: tmpDir(), config: { website: 'https://hammershop.pl', plusPublicKey: plusKeys().publicKey }, accounts: {}, fetchFn, now: () => clock.now, emit: (channel, payload) => events.push({ channel, payload }) });
  const updates = () => events.filter((e) => e.channel === 'news:update').map((e) => e.payload);
  const feed = await s.news.feed();
  assert.deepEqual([feed.source, feed.news.length, feed.alert.id, feed.seenAt, feed.ok], ['shop', 2, 'a_17', 0, true]);
  assert.equal(updates().length, 1, 'the window is told when the first answer lands');

  // Seen: the newest `at` is remembered (and never moves back).
  assert.equal(s.news.markSeen(), ITEM.at);
  assert.equal(s.settings.get().newsSeenAt, ITEM.at);
  shop.answer = { ...shop.answer, news: [OLD] };
  clock.now += MIN_INTERVAL;
  await s.news.refresh();
  assert.equal(s.news.markSeen(), ITEM.at);
  assert.equal((await s.news.feed()).seenAt, ITEM.at);

  // Closed: gone at once, and it stays gone – also for the next start of the launcher (the setting).
  const closed = s.news.closeAlert();
  assert.deepEqual([closed.alert, s.settings.get().closedAlert, updates().at(-1).alert], [null, 'a_17', null]);
  clock.now += MIN_INTERVAL;
  assert.equal((await s.news.refresh()).alert, null);
  // Another message from the shop shows again; a critical one cannot be closed.
  shop.answer = { ...shop.answer, alert: { id: 'a_18', level: 'critical', text: 'Logowanie Microsoft ma awarię – granie może nie działać.', url: null, until: null } };
  clock.now += MIN_INTERVAL;
  assert.equal((await s.news.refresh()).alert.id, 'a_18');
  assert.equal(updates().at(-1).alert.id, 'a_18');
  assert.equal(s.news.closeAlert().alert.id, 'a_18');
  assert.equal(s.settings.get().closedAlert, 'a_17', 'what was closed before stays remembered');
  // The shop takes the message down.
  shop.answer = { ...shop.answer, alert: null };
  clock.now += MIN_INTERVAL;
  assert.equal((await s.news.refresh()).alert, null);

  // Without a shop the old behaviour stays: the tips, and nothing is asked.
  const none = createServices({ root: tmpDir(), config: {}, accounts: {}, fetchFn: mockFetch([]) });
  assert.deepEqual([(await none.news.feed()).source, (await none.news.feed()).news.length], ['builtin', 3]);
  assert.equal(none.news.closeAlert().alert, null);
  assert.equal(none.news.markSeen(), 0);
});
