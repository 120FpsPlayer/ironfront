'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCommunity, inviteCode } = require('../src/main/community');
const { listScreenshots, screenshotPath, removeScreenshot } = require('../src/main/gallery');
const { tmpDir, mockFetch } = require('./helpers');

const DISCORD = { guild: { id: '111', name: 'HammerShop', icon: 'abc', banner: 'a_def', description: 'Sklep i społeczność' }, approximate_member_count: 1284, approximate_presence_count: 213 };

test('invite codes are read from links and plain codes', () => {
  assert.equal(inviteCode('https://discord.gg/hammershop'), 'hammershop');
  assert.equal(inviteCode('discord.com/invite/Ab-12'), 'Ab-12');
  assert.equal(inviteCode('https://discordapp.com/invite/xyz?event=1'), 'xyz');
  assert.equal(inviteCode('hammershop'), 'hammershop');
  assert.equal(inviteCode('https://evil.example/discord.gg/x'), null);
  assert.equal(inviteCode(''), null);
});

test('Discord card: name, icon, banner, members and online from the invite in the config', async () => {
  const fetchFn = mockFetch([{ match: /discord\.com\/api\/v10\/invites\/hammershop\?with_counts=true/, json: DISCORD }]);
  const c = createCommunity({ config: { discordInvite: 'https://discord.gg/hammershop', website: '' }, fetchFn });
  const d = await c.discord();
  assert.deepEqual(
    { name: d.name, members: d.members, online: d.online, url: d.url, live: d.live },
    { name: 'HammerShop', members: 1284, online: 213, url: 'https://discord.gg/hammershop', live: true },
  );
  assert.equal(d.iconUrl, 'https://cdn.discordapp.com/icons/111/abc.png?size=128');
  assert.equal(d.bannerUrl, 'https://cdn.discordapp.com/banners/111/a_def.gif?size=600');
  await c.discord();
  assert.equal(fetchFn.calls.length, 1, 'cached between calls');
});

test('without an invite in the config the one from the bot website is used; a dead invite is reported', async () => {
  const fetchFn = mockFetch([
    { match: /hammershop\.pl\/api\/shop\/store$/, json: { discordUrl: 'https://discord.gg/fromBot', products: [], currency: 'pln' } },
    { match: /invites\/fromBot/, status: 404, json: { message: 'Unknown Invite' } },
  ]);
  const c = createCommunity({ config: { discordInvite: '', website: 'https://hammershop.pl/' }, fetchFn });
  const d = await c.discord();
  assert.equal(d.code, 'fromBot');
  assert.equal(d.live, false);
  assert.equal(d.invalid, true);
  assert.equal(d.name, 'Hammer Launcher', 'the launcher\'s own server – not the shop brand');
  // The bot replaces a dead invite on its own: the website is asked again right away, and the new invite is used.
  const before = fetchFn.calls.length;
  fetchFn.routes.unshift({ match: /hammershop\.pl\/api\/shop\/store$/, json: { discordUrl: 'https://discord.gg/fresh', products: [], currency: 'pln' } });
  fetchFn.routes.unshift({ match: /invites\/fresh/, json: { guild: { id: '111', name: 'Hammer Launcher' }, approximate_member_count: 5, approximate_presence_count: 2 } });
  const again = await c.discord();
  assert.deepEqual([again.code, again.live, again.invalid ?? false], ['fresh', true, false]);
  assert.ok(fetchFn.calls.length > before);
  assert.equal(await createCommunity({ config: { discordInvite: '', website: '' }, fetchFn: mockFetch([]) }).discord(), null);
});

test('when Discord is unreachable the card keeps its join link', async () => {
  const fetchFn = async () => {
    throw new TypeError('fetch failed');
  };
  const d = await createCommunity({ config: { discordInvite: 'hammershop' }, fetchFn }).discord();
  assert.deepEqual([d.url, d.live, d.invalid], ['https://discord.gg/hammershop', false, false]);
});

test('store products: prices from cents, absolute picture links, currency', async () => {
  const fetchFn = mockFetch([
    {
      match: /api\/shop\/store$/,
      json: {
        currency: 'pln',
        products: [
          { id: 'vip', name: 'Ranga VIP', category: 'Rangi', description: 'Kolorowy   nick', price: 1999, image: '/api/shop/image/vip', instant: true },
          { id: 'x', name: 'Bez ceny', price: 'abc' },
          { id: 'svip', name: 'Ranga SVIP', price: 3999, image: 'http://insecure/x.png' },
        ],
      },
    },
  ]);
  const shop = await createCommunity({ config: { website: 'https://hammershop.pl', shopUrl: 'https://hammershop.pl/sklep' }, fetchFn }).shop({ limit: 4 });
  assert.equal(shop.currency, 'PLN');
  assert.equal(shop.url, 'https://hammershop.pl/sklep');
  assert.deepEqual(
    shop.products.map((p) => [p.name, p.price, p.image, p.description]),
    [
      ['Ranga VIP', 19.99, 'https://hammershop.pl/api/shop/image/vip', 'Kolorowy nick'],
      ['Ranga SVIP', 39.99, null, ''],
    ],
  );
  const offline = await createCommunity({ config: { website: 'https://hammershop.pl', shopUrl: '' }, fetchFn: mockFetch([]) }).shop();
  assert.deepEqual(offline.products, []);
});

test('gallery: screenshots from every instance, newest first, only real files can be removed', () => {
  const root = tmpDir();
  const mk = (id, files) => {
    const dir = path.join(root, id);
    fs.mkdirSync(path.join(dir, 'screenshots'), { recursive: true });
    files.forEach(([name, age]) => {
      const f = path.join(dir, 'screenshots', name);
      fs.writeFileSync(f, 'png');
      const t = new Date(Date.now() - age * 1000);
      fs.utimesSync(f, t, t);
    });
    return { id, name: id.toUpperCase(), dir };
  };
  const a = mk('a', [['old.png', 300], ['notes.txt', 1]]);
  const b = mk('b', [['new.png', 10], ['mid.jpg', 100]]);
  const shots = listScreenshots(null, [a, b, { id: 'c', name: 'C', dir: path.join(root, 'missing') }]);
  assert.deepEqual(shots.map((s) => `${s.instanceId}/${s.file}`), ['b/new.png', 'b/mid.jpg', 'a/old.png']);
  assert.match(shots[0].url, /^file:\/\//);
  assert.throws(() => screenshotPath(a, '../b/screenshots/new.png'), /Nieprawidłowy/);
  assert.throws(() => screenshotPath(a, 'notes.txt'), /Nieprawidłowy/);
  assert.throws(() => screenshotPath(a, 'gone.png'), /Nie ma już/);
  removeScreenshot(b, 'mid.jpg');
  assert.equal(fs.existsSync(path.join(b.dir, 'screenshots', 'mid.jpg')), false);
});
