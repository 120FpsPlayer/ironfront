'use strict';

// The admin panel's „Ogłoszenia” tab: an announcement card written on the website and posted by the bot on
// #📢 ogłoszenia – over real HTTP against a local copy of the website, with a fake Discord server.
const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType, MessageFlags } = require('discord.js');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { startFakes, useFakes } = require('./helpers/webFakes');
const { buildServer } = require('../src/builder/executor');
const { env } = require('../src/env');
const { COLORS } = require('../src/lib/theme');
const announce = require('../src/features/announce');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const webAuth = require('../src/web/discord');
const { createWebServer } = require('../src/web/server');

const OWNER = { id: '1', username: 'szef', global_name: 'Szef', avatar: null };
const ADMIN = { id: '200000000000000101', username: 'adminka', global_name: 'Adminka', avatar: null };
const MEMBER = { id: '200000000000000102', username: 'gracz', global_name: 'Gracz', avatar: null };

let fakes;
let site;
let base;
let guild;
const sids = {};

test.before(async () => {
  fakes = await startFakes();
  guild = new FakeGuild({ ownerId: OWNER.id, community: true }); // a Community server: #ogłoszenia is an announcement channel
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  guild.addMember(ADMIN.id, [db.roleId(guild.id, 'coowner')]);
  guild.addMember(MEMBER.id, [db.roleId(guild.id, 'member')]);
  cards = channel('announcements').messageList.length;
  website._setClient(guild.client);
  webAuth.setClientId('123');
  webStore.load();
  site = createWebServer({
    catalog: website.catalog, info: () => ({ invite: 'https://discord.gg/hammershop' }), onLogin: website.onLogin, isMember: website.isMember, currency: () => 'eur',
    level: website.panelLevel, announce: website.announce, log: website.panelLog, announcements: website.panelAnnouncements,
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref();
  base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;
  useFakes(env, fakes.base, base);
  for (const [name, user] of Object.entries({ owner: OWNER, admin: ADMIN, member: MEMBER })) sids[name] = await signIn(user);
});
test.after(() => {
  site?.close();
  fakes?.server.close();
});

let ip = 0;
const cookieOf = (res, name) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0].trim()).find((c) => c.startsWith(`${name}=`)) ?? '';

async function signIn(user) {
  fakes.state.user = user;
  const start = await fetch(`${base}/api/shop/auth/start?next=admin`, { redirect: 'manual' });
  const state = new URL(start.headers.get('location')).searchParams.get('state');
  const jar = [cookieOf(start, 'hs_oauth'), cookieOf(start, 'hs_next')].filter(Boolean).join('; ');
  const back = await fetch(`${base}/api/shop/auth/callback?code=good&state=${state}`, { headers: { cookie: jar }, redirect: 'manual' });
  return cookieOf(back, 'hs_sid');
}

/** → { status, body, headers }. who: 'owner' | 'admin' | 'member' | null; from: a fixed address (else a new one each call). */
async function call(method, pathname, { who = 'owner', body, origin = base, from } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: 'manual',
    headers: {
      'x-forwarded-for': from ?? `10.77.${Math.floor(++ip / 250)}.${ip % 250}`,
      ...(who && { cookie: sids[who] }),
      ...(origin && method !== 'GET' && { origin }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let parsed = buf;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    // a picture
  }
  return { status: res.status, body: parsed, headers: res.headers };
}
const send = (body, opts = {}) => call('POST', '/api/admin/announcements', { body, ...opts });
const channel = (key) => guild.channels.cache.get(db.channelId(guild.id, key));
let cards = 0; // what /build itself posted on #ogłoszenia (its banner and card)
const posts = () => channel('announcements').messageList.slice(cards);
const lastPost = () => posts().at(-1);
const json = (payload) => (payload.components ?? []).map((c) => (c.toJSON ? c.toJSON() : c));
const logText = (key) => channel(key).messageList.map((m) => textOf(m.body)).join('\n');
const GOOD = { title: 'Nowy sezon startuje w piątek!', text: '**Ważne:** zapisy od dziś.\n- nagrody\n- turniej', kind: 'ogloszenie', ping: 'none' };

test('the tab is for the panel\'s people: who sees it, what it offers – @everyone only for the owner', async () => {
  assert.equal((await call('GET', '/api/admin/announcements', { who: null })).status, 401);
  assert.equal((await call('GET', '/api/admin/announcements', { who: 'member' })).status, 403);
  assert.equal((await send(GOOD, { who: 'member' })).status, 403);
  const asAdmin = await call('GET', '/api/admin/announcements', { who: 'admin' });
  assert.equal(asAdmin.status, 200, JSON.stringify(asAdmin.body));
  assert.equal(asAdmin.body.canEveryone, false);
  assert.deepEqual(asAdmin.body.kinds.map((k) => [k.id, k.label]), [['ogloszenie', 'Ogłoszenie'], ['aktualizacja', 'Aktualizacja'], ['wydarzenie', 'Wydarzenie'], ['wazne', 'Ważne']]);
  assert.equal(asAdmin.body.kinds[0].color, '#ff9f43', 'the colors the card gets on Discord');
  assert.equal(asAdmin.body.kinds[3].color, `#${COLORS.danger.toString(16)}`);
  assert.equal(asAdmin.body.channel.id, channel('announcements').id);
  assert.equal(asAdmin.body.channel.announcement, true);
  assert.equal(asAdmin.body.role.name, '📢 Ogłoszenia');
  assert.deepEqual(asAdmin.body.history, []);
  assert.deepEqual(asAdmin.body.limits, { title: 120, text: 3500, label: 80, url: 500 });
  assert.equal((await call('GET', '/api/admin/announcements')).body.canEveryone, true, 'the owner may ping everyone');
  // The kind's banner for the preview – a picture, only for the panel's people.
  const banner = await call('GET', '/api/admin/announcements/banner/wydarzenie');
  assert.equal(banner.status, 200);
  assert.equal(banner.headers.get('content-type'), 'image/png');
  assert.deepEqual([...banner.body.subarray(1, 4)].map((b) => String.fromCharCode(b)).join(''), 'PNG');
  assert.equal((await call('GET', '/api/admin/announcements/banner/nieznany')).status, 404);
  assert.equal((await call('GET', '/api/admin/announcements/banner/ogloszenie', { who: 'member' })).status, 403);
  // A change without the panel's own Origin is refused.
  assert.equal((await send(GOOD, { origin: null })).status, 403);
  assert.equal((await send(GOOD, { origin: 'https://evil.example' })).status, 403);
  assert.equal(posts().length, 0);
});

test('the form is checked first: Polish messages, Discord\'s limits, https only – nothing reaches Discord', async () => {
  const wrong = async (body, status, pattern, who = 'owner') => {
    const res = await send({ ...GOOD, ...body }, { who });
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.match(res.body.error, pattern);
  };
  await wrong({ title: '   ' }, 400, /^Wpisz tytuł ogłoszenia\.$/);
  await wrong({ title: 'x'.repeat(121) }, 400, /Tytuł może mieć najwyżej 120 znaków \(teraz 121\)/);
  await wrong({ text: ' \n\n ' }, 400, /^Wpisz treść ogłoszenia\.$/);
  await wrong({ text: 'x'.repeat(3501) }, 400, /Treść może mieć najwyżej 3500 znaków/);
  await wrong({ kind: 'reklama' }, 400, /Wybierz rodzaj ogłoszenia/);
  await wrong({ image: 'http://example.com/a.png' }, 400, /Obrazek: adres musi zaczynać się od https:\/\//);
  await wrong({ image: 'javascript:alert(1)' }, 400, /Obrazek: adres musi zaczynać się od https:\/\//);
  await wrong({ image: 'nie link' }, 400, /Obrazek: to nie jest poprawny adres/);
  await wrong({ image: `https://example.com/${'a'.repeat(500)}.png` }, 400, /Obrazek: adres może mieć najwyżej 500 znaków/);
  await wrong({ buttonLabel: 'Pobierz' }, 400, /Przycisk: wpisz też link/);
  await wrong({ buttonUrl: 'https://hammershop.pl' }, 400, /Przycisk: wpisz też napis/);
  await wrong({ buttonLabel: 'x'.repeat(81), buttonUrl: 'https://hammershop.pl' }, 400, /Napis na przycisku może mieć najwyżej 80 znaków/);
  await wrong({ buttonLabel: 'Pobierz', buttonUrl: 'http://hammershop.pl' }, 400, /Link w przycisku: adres musi zaczynać się od https:\/\//);
  await wrong({ ping: 'here' }, 400, /Wybierz, kogo powiadomić/);
  await wrong({ ping: 'everyone', confirmEveryone: true }, 403, /Ping @everyone może wysłać tylko właściciel serwera/, 'admin');
  await wrong({ ping: 'everyone' }, 400, /Potwierdź, że chcesz powiadomić wszystkich/);
  assert.equal(posts().length, 0);
  assert.deepEqual(webStore.announcementList(), []);
  // Too many at once from one address: slowed down.
  const from = '10.78.0.1';
  for (let i = 0; i < 6; i += 1) assert.equal((await send({ ...GOOD, title: '' }, { from })).status, 400);
  const slow = await send(GOOD, { from });
  assert.equal(slow.status, 429);
  assert.match(slow.body.error, /odczekaj minutę/);
  assert.equal(posts().length, 0);
});

test('sent by an admin: the card on #ogłoszenia with the kind\'s color and banner, the picture, the button, the role ping – published, logged, in the history', async () => {
  const res = await send({
    title: '  Hammer Launcher 2.11 ', text: 'Co nowego:\r\n- **szybszy** start\r\n- nowe motywy\r\n\r\n\r\n\r\nMiłej gry! @everyone <@&999>', kind: 'aktualizacja',
    image: 'https://cdn.example.com/zrzut.png', buttonLabel: 'Pobierz launcher', buttonUrl: 'https://hammerclient.com/launcher', ping: 'role',
  }, { who: 'admin' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const msg = lastPost();
  assert.equal(posts().length, 1);
  assert.equal(res.body.url, msg.url, 'the panel gets the message link');
  assert.equal(msg.crossposted, true, 'an announcement channel: published to the servers that follow it');
  assert.ok(msg.flags & MessageFlags.IsComponentsV2, 'the same kind of card as /ogloszenie');
  const roleId = db.roleId(guild.id, 'pingAnnouncements');
  assert.deepEqual(msg.body.allowedMentions, { roles: [roleId] }, 'only the 📢 Ogłoszenia role is pinged – not @everyone or a role typed in the text');
  const text = textOf(msg.body);
  assert.match(text, /^# Hammer Launcher 2\.11\nCo nowego:\n- \*\*szybszy\*\* start\n- nowe motywy\n\nMiłej gry!/m);
  assert.match(text, new RegExp(`-# 🚀 Aktualizacja · <@${ADMIN.id}> · HammerShop · <@&${roleId}>`));
  assert.match(text, /Pobierz launcher/);
  const [card] = json(msg.body);
  assert.equal(card.accent_color, COLORS.success);
  const galleries = card.components.filter((c) => c.type === 12).map((g) => g.items[0].media.url);
  assert.deepEqual(galleries, ['attachment://hammershop-updates.png', 'https://cdn.example.com/zrzut.png'], 'the banner on top, the picture under the text');
  const button = card.components.find((c) => c.type === 1).components[0];
  assert.deepEqual([button.label, button.url], ['Pobierz launcher', 'https://hammerclient.com/launcher']);
  // History and the server log – never the ticket log.
  const history = (await call('GET', '/api/admin/announcements')).body.history;
  assert.equal(history.length, 1);
  assert.deepEqual([history[0].title, history[0].kind, history[0].ping, history[0].url, history[0].by.name, history[0].crossposted, history[0].deletedAt], ['Hammer Launcher 2.11', 'aktualizacja', 'role', msg.url, 'Adminka', true, null]);
  assert.match(logText('serverLogs'), new RegExp(`Panel admina[\\s\\S]*📢 Ogłoszenie na Discordzie \\(Aktualizacja\\): \\*\\*Hammer Launcher 2\\.11\\*\\* z pingiem roli 📢 Ogłoszenia – ${msg.url.replace(/\./g, '\\.')} · <@${ADMIN.id}>`));
  assert.doesNotMatch(logText('ticketLogs'), /Ogłoszenie na Discordzie/);
});

test('no ping means nobody is pinged; without the banner there is no picture to upload', async () => {
  const res = await send({ ...GOOD, text: 'Bez pingu, nawet gdy ktoś wpisze @everyone albo @here.', kind: 'wydarzenie', banner: false });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const msg = lastPost();
  assert.deepEqual(msg.body.allowedMentions, { parse: [] });
  assert.equal(msg.files.length, 0);
  const [card] = json(msg.body);
  assert.equal(card.accent_color, 0xa970ff);
  assert.equal(card.components.some((c) => c.type === 1), false, 'no button without a link');
  assert.match(textOf(msg.body), /-# 🎉 Wydarzenie · <@1> · HammerShop$/m);
});

test('@everyone: only the owner, only confirmed – and then it really pings everyone', async () => {
  const res = await send({ ...GOOD, title: 'Przerwa techniczna', kind: 'wazne', ping: 'everyone', confirmEveryone: true });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const msg = lastPost();
  assert.deepEqual(msg.body.allowedMentions, { parse: ['everyone'] });
  assert.match(textOf(msg.body), /-# ⚠️ Ważne · <@1> · HammerShop · @everyone/);
  assert.equal(json(msg.body)[0].accent_color, COLORS.danger);
  assert.match(logText('serverLogs'), /Ogłoszenie na Discordzie \(Ważne\): \*\*Przerwa techniczna\*\* z pingiem `@everyone`/);
});

test('„Usuń z Discorda”: the message goes, the history keeps it marked; a message deleted by hand is fine too', async () => {
  const before = posts().length;
  const sent = (await send({ ...GOOD, title: 'Do usunięcia' })).body;
  assert.equal(posts().length, before + 1);
  const gone = await call('DELETE', `/api/admin/announcements/${sent.item.id}`, { who: 'admin' });
  assert.equal(gone.status, 200, JSON.stringify(gone.body));
  assert.equal(gone.body.gone, false);
  assert.equal(posts().length, before);
  assert.equal(posts().some((m) => textOf(m.body).includes('Do usunięcia')), false);
  assert.ok(gone.body.item.deletedAt);
  assert.equal(gone.body.item.deletedBy.name, 'Adminka');
  assert.equal((await call('DELETE', `/api/admin/announcements/${sent.item.id}`)).status, 409);
  assert.equal((await call('DELETE', '/api/admin/announcements/ann_nieznane')).status, 404);
  assert.equal((await call('DELETE', `/api/admin/announcements/${sent.item.id}`, { who: 'member' })).status, 403);
  assert.match(logText('serverLogs'), /🗑️ Usunięto ogłoszenie z Discorda: \*\*Do usunięcia\*\*/);
  // Somebody deleted it on Discord already.
  const other = (await send({ ...GOOD, title: 'Usunięte ręcznie' })).body;
  await lastPost().delete();
  const already = await call('DELETE', `/api/admin/announcements/${other.item.id}`);
  assert.equal(already.status, 200);
  assert.equal(already.body.gone, true);
  assert.match(logText('serverLogs'), /Usunięte ręcznie\*\* \(wiadomości już tam nie było\)/);
});

test('without #ogłoszenia or the 📢 Ogłoszenia role the panel says what to do', async () => {
  const ann = channel('announcements');
  const role = guild.roles.cache.get(db.roleId(guild.id, 'pingAnnouncements'));
  guild.roles.cache.delete(role.id);
  try {
    assert.equal((await call('GET', '/api/admin/announcements')).body.role, null);
    const noRole = await send({ ...GOOD, ping: 'role' });
    assert.equal(noRole.status, 409);
    assert.match(noRole.body.error, /nie ma roli 📢 Ogłoszenia/);
  } finally {
    guild.roles.cache.set(role.id, role);
  }
  guild.channels.cache.delete(ann.id);
  try {
    assert.equal((await call('GET', '/api/admin/announcements')).body.channel, null);
    const noChannel = await send(GOOD);
    assert.equal(noChannel.status, 409);
    assert.match(noChannel.body.error, /nie ma kanału #📢 ogłoszenia – dodaj go na Discordzie komendą \/zbuduj tylko:update/);
  } finally {
    guild.channels.cache.set(ann.id, ann);
  }
});

test('the history keeps the newest 20', async () => {
  for (let i = 0; i < 25; i += 1) webStore.addAnnouncement({ title: `Stare ${i}`, kind: 'ogloszenie', ping: 'none', by: OWNER.id, url: 'https://discord.com/channels/1/2/3', channelId: '2', messageId: '3' });
  const history = (await call('GET', '/api/admin/announcements')).body.history;
  assert.equal(history.length, 20);
  assert.equal(history[0].title, 'Stare 24', 'newest first');
});

test('the biggest card the panel can send still fits Discord; banners are the server\'s own (Hammer Launcher has no events banner)', () => {
  const big = (n) => 'ż'.repeat(n);
  const payload = announce.buildPanelAnnouncement(guild, '<@200000000000000101>', {
    title: big(120), text: big(3500), kind: 'aktualizacja', image: `https://example.com/${'a'.repeat(470)}.png`, button: { label: big(80), url: `https://example.com/${'b'.repeat(470)}` }, ping: 'everyone', banner: true,
  });
  validateMessage(payload, guild);
  assert.equal(announce.kindBanner('wydarzenie', false), 'events');
  assert.equal(announce.kindBanner('wydarzenie', true), 'announcements', 'a shared banner would carry the shop\'s name');
  assert.equal(announce.kindBanner('aktualizacja', true), 'updates');
  assert.equal(announce.kindBanner('nieznany', true), 'announcements');
  // /ogloszenie keeps its own card.
  const classic = announce.buildAnnouncement(guild, '<@5>', { title: 'T', message: 'M', ping: 'none', bannerKey: 'none', url: '' });
  assert.match(textOf(classic), /^-# 📢 <@5> · HammerShop$/m);
  assert.equal(json(classic)[0].accent_color, COLORS.brand);
});

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      // next
    }
  }
  return null;
}
const pw = playwright();

test('the tab in a real browser: the live preview looks like Discord, the form says what is wrong, sending lands on Discord – also on a phone', { skip: !pw && 'Playwright is not installed' }, async () => {
  const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const shots = process.env.HS_SHOTS;
  const picture = fs.readFileSync(path.join(__dirname, '..', 'web', 'public', 'assets', 'hammershop-games.jpg'));
  try {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const w = viewport.width;
      const context = await browser.newContext({ viewport });
      // Pictures from the internet (the bot's avatar, a pasted image link) come from here, not the network.
      await context.route(/^https:\/\/(cdn\.discordapp\.com|cdn\.example\.com)\//, (route) => route.fulfill({ status: 200, contentType: 'image/jpeg', body: picture }));
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      fakes.state.user = OWNER;
      await page.goto(`${base}/api/shop/auth/start?next=admin`);
      await page.goto(`${base}/admin#ogloszenia`);
      await page.locator('#ann-kinds .ann-kind').first().waitFor();
      assert.equal(await page.locator('#ann-kinds .ann-kind').count(), 4);
      assert.equal(await page.locator('#ann-channel').textContent(), `#${channel('announcements').name}`);
      // Empty form: the preview shows where the title and text go; sending says what is missing.
      assert.equal(await page.locator('#ann-md h1').textContent(), 'Tytuł ogłoszenia');
      await page.locator('#ann-send').click();
      assert.equal(await page.locator('#ann-error').textContent(), 'Wpisz tytuł ogłoszenia.');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'ann-title');
      // Typing fills the preview: markdown, the kind's color and banner, the picture, the button, the ping.
      await page.locator('#ann-kinds .ann-kind', { hasText: 'Wydarzenie' }).click();
      await page.locator('#ann-title').fill('Turniej Bedwars w sobotę! 🏆');
      await page.locator('#ann-text').fill('Zapisy na kanale **#turniej** do piątku.\n\n## Nagrody\n- 1. miejsce: *Hammer+ na rok*\n- 2. miejsce: __Hammer+ na 30 dni__\n\n> Regulamin: [hammerclient.com](https://hammerclient.com/regulamin)\n-# Do zobaczenia na serwerze!');
      await page.locator('#ann-image').fill('https://cdn.example.com/plakat.jpg');
      await page.locator('#ann-btn-label').fill('Zapisz się');
      await page.locator('#ann-btn-url').fill('https://hammerclient.com/turniej');
      await page.locator('#ann-ping-role').click();
      await page.locator('#ann-image-img').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.getElementById('ann-banner-img').complete && document.getElementById('ann-banner-img').naturalWidth > 0);
      assert.equal(await page.locator('#ann-md h1').textContent(), 'Turniej Bedwars w sobotę! 🏆');
      assert.equal(await page.locator('#ann-md strong').first().textContent(), '#turniej');
      assert.equal(await page.locator('#ann-md h2').textContent(), 'Nagrody');
      assert.equal(await page.locator('#ann-md ul li').count(), 2);
      assert.equal(await page.locator('#ann-md em').textContent(), 'Hammer+ na rok');
      assert.equal(await page.locator('#ann-md u').textContent(), 'Hammer+ na 30 dni');
      assert.equal(await page.locator('#ann-md blockquote a').getAttribute('href'), 'https://hammerclient.com/regulamin');
      assert.equal(await page.locator('#ann-md .dc-sub').textContent(), 'Do zobaczenia na serwerze!');
      assert.equal(await page.locator('#ann-card').evaluate((n) => getComputedStyle(n).borderLeftColor), 'rgb(169, 112, 255)', 'the kind\'s color, as on Discord');
      assert.equal(await page.locator('#ann-banner-img').getAttribute('src'), '/api/admin/announcements/banner/wydarzenie');
      assert.equal(await page.locator('#ann-btn-text').textContent(), 'Zapisz się');
      assert.equal(await page.locator('#ann-footer').textContent(), '🎉 Wydarzenie · @Szef · HammerShop · @📢 Ogłoszenia');
      assert.equal(await page.locator('#ann-msg').evaluate((n) => n.classList.contains('dc-ping')), true, 'a ping shows like a mention on Discord');
      assert.equal(await page.locator('#ann-avatar').evaluate((n) => n.complete && n.naturalWidth > 0), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (shots) {
        await page.screenshot({ path: `${shots}/ogloszenia-${w}.png` });
        await page.locator('#ann-form').screenshot({ path: `${shots}/ogloszenia-formularz-${w}.png` });
        await page.locator('.ann-side').screenshot({ path: `${shots}/ogloszenia-podglad-${w}.png` });
      }
      // A wrong link is said before anything is sent.
      await page.locator('#ann-btn-url').fill('http://hammerclient.com');
      await page.locator('#ann-send').click();
      assert.equal(await page.locator('#ann-error').textContent(), 'Link w przycisku: adres musi zaczynać się od https://');
      await page.locator('#ann-btn-url').fill('https://hammerclient.com/turniej');
      // @everyone asks once more, with how many people it reaches.
      await page.locator('#ann-ping-everyone').click();
      await page.locator('#ann-send').click();
      await page.locator('#confirm[open]').waitFor();
      assert.equal(await page.locator('#confirm-title').textContent(), 'Wysłać z pingiem @everyone?');
      assert.match(await page.locator('#confirm-text').textContent(), /Powiadomienie dostanie każdy na serwerze \(\d+ (osoba|osoby|osób)\)/);
      if (shots) await page.screenshot({ path: `${shots}/ogloszenia-everyone-${w}.png` });
      await page.locator('#confirm-no').click();
      // Sent with the role ping.
      const before = posts().length;
      await page.locator('#ann-ping-role').click();
      await page.locator('#ann-send').click();
      await page.locator('#confirm[open]').waitFor();
      assert.equal(await page.locator('#confirm-text').textContent(), `„Turniej Bedwars w sobotę! 🏆” pojawi się na #${channel('announcements').name} z pingiem roli 📢 Ogłoszenia.`);
      await page.locator('#confirm-yes').click();
      await page.locator('#ann-result a', { hasText: 'Zobacz na Discordzie' }).waitFor();
      assert.equal(posts().length, before + 1);
      assert.equal(await page.locator('#ann-result a').getAttribute('href'), lastPost().url);
      assert.match(textOf(lastPost().body), /^# Turniej Bedwars w sobotę! 🏆\nZapisy na kanale \*\*#turniej\*\*/m);
      assert.deepEqual(lastPost().body.allowedMentions, { roles: [db.roleId(guild.id, 'pingAnnouncements')] });
      assert.equal(await page.locator('#ann-title').inputValue(), '', 'the form is ready for the next one');
      await page.locator('#ann-history .item', { hasText: 'Turniej Bedwars w sobotę!' }).first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (shots) {
        await page.locator('#ann-history').scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${shots}/ogloszenia-wyslane-${w}.png` });
      }
      assert.deepEqual(problems, []);
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
