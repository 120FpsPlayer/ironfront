'use strict';

// Downloading the launcher after a Discord sign-in, and „Zaproś znajomego” – the referral programme: a friend
// downloads the launcher from your link and buys Hammer+ → +7 days of Hammer+ for you. Over real HTTP against a local
// copy of the website, with fake Discord, Stripe and Mojang.
const realFetch = global.fetch;
const { db } = require('./helpers/setup');
global.fetch = realFetch;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { startFakes, useFakes } = require('./helpers/webFakes');
const { env } = require('../src/env');
const plus = require('../src/lib/plus');
const hammerplus = require('../src/features/hammerplus');
const website = require('../src/features/website');
const webStore = require('../src/web/store');
const webAuth = require('../src/web/discord');
const releases = require('../src/web/releases');
const referrals = require('../src/web/referrals');
const { createWebServer } = require('../src/web/server');

const DAY = 86_400;
/** A Discord ID (snowflake) of an account made `days` ago. */
const madeAgo = (days) => ((BigInt(Date.now() - days * DAY * 1000) - 1_420_070_400_000n) << 22n).toString();
const person = (id, name) => ({ id, username: name.toLowerCase(), global_name: name, avatar: null });
const OWNER = person('1', 'Szef');
const REFERRER = person('200000000000000011', 'Polecajacy');
const FRIEND = person('200000000000000012', 'Kumpel');
const OLD = person('200000000000000013', 'Stary');
const YOUNG = person(madeAgo(2), 'Nowy');
const SECOND = person('200000000000000014', 'Bezplusa');
const FRIEND2 = person('200000000000000015', 'Kolega');
const MC = { Steve: '8667ba71b85a4004af54457a9734eed7', Alex: '6ab4317889fd490597f60f67d9d76fd9', Notch: '069a79f444e94726a5befca90e38aaf5', Jeb: '853c80ef3c3749fdaa49938b674adae6' };

let fakes;
let site;
let base;
let guild;
const sids = {};

test.before(async () => {
  fakes = await startFakes();
  guild = new FakeGuild({ ownerId: OWNER.id });
  db.guild(guild.id);
  for (const u of [REFERRER, FRIEND, OLD, SECOND, FRIEND2]) guild.addMember(u.id);
  env.plusPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  hammerplus.setFetch(async (url) => {
    const nick = decodeURIComponent(String(url).split('/').pop());
    const hit = Object.keys(MC).find((n) => n.toLowerCase() === nick.toLowerCase());
    return hit ? { ok: true, status: 200, json: async () => ({ id: MC[hit], name: hit }) } : { ok: false, status: 404, json: async () => ({}) };
  });
  website._setClient(guild.client);
  webAuth.setClientId('123');
  webStore.load();
  site = createWebServer({
    catalog: website.catalog, info: () => ({ invite: 'https://discord.gg/hammershop' }), onPaid: website.onPaid, onLogin: website.onLogin, isMember: website.isMember, currency: () => 'eur',
    level: website.panelLevel, log: website.panelLog, plus: website.panelPlus, featuredAdmin: website.panelFeatured, referrals: website.panelReferrals,
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  site.unref();
  base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;
  useFakes(env, fakes.base, base);
  sids.owner = await signIn(OWNER);
  // A published launcher to download.
  fs.mkdirSync(releases.DIR(), { recursive: true });
  fs.writeFileSync(releases.fileOf('Hammer-Launcher-Setup-2.9.0.exe'), Buffer.concat([Buffer.from('MZ'), Buffer.alloc(4000, 7)]));
  await releases.publish({ version: '2.9.0', file: 'Hammer-Launcher-Setup-2.9.0.exe' });
  webStore.setPlusPlans([{ id: 'p30', name: 'Hammer+ na 30 dni', days: 30, price: 1500 }]);
});
test.after(() => {
  site?.close();
  fakes?.server.close();
});

let ip = 0;
const setCookies = (res) => (res.headers.getSetCookie?.() ?? []).map((c) => c.trim());
const cookieOf = (res, name) => setCookies(res).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`)) ?? '';

/** The Discord sign-in, step by step. ref: the hs_ref cookie of a personal link. → the session cookie (signIn.landed: where it ended). */
async function signIn(user, { next = null, ref = null, start = null } = {}) {
  fakes.state.user = user;
  const first = start ?? (await fetch(`${base}/api/shop/auth/start${next ? `?next=${next}` : ''}`, { redirect: 'manual' }));
  const state = new URL(first.headers.get('location')).searchParams.get('state');
  const jar = [cookieOf(first, 'hs_oauth'), cookieOf(first, 'hs_next'), ref].filter(Boolean).join('; ');
  const back = await fetch(`${base}/api/shop/auth/callback?code=good&state=${state}`, { headers: { cookie: jar }, redirect: 'manual' });
  signIn.landed = back.headers.get('location');
  signIn.cookies = setCookies(back);
  return cookieOf(back, 'hs_sid');
}

async function call(method, pathname, { sid = '', body, origin = base, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    redirect: 'manual',
    headers: {
      'x-forwarded-for': `10.7.${Math.floor(++ip / 250)}.${ip % 250}`,
      ...(sid && { cookie: sid }),
      ...(origin && method !== 'GET' && { origin }),
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // a page or an empty answer
  }
  return { status: res.status, body: parsed, headers: res.headers };
}
const page = async (sid) => (await call('GET', '/api/shop/referrals', { sid })).body;
const dmsTo = (id) => guild.dms.filter((d) => d.to === id).map((d) => textOf(d.payload));

async function buyPlus(sid, nick) {
  const res = await call('POST', '/api/shop/checkout', { sid, body: { kind: 'plus', plan: 'p30', nick, requestId: crypto.randomUUID() } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  fakes.pay(res.body.url.split('/').pop());
  const verified = await call('POST', '/api/shop/verify', { sid, body: { sessionId: res.body.url.split('/').pop() } });
  assert.equal(verified.body.paid, true);
  return res.body.order;
}

test('downloading from the website needs a Discord sign-in – the sign-in ends on the page, which starts the download', async () => {
  // Not signed in: straight to Discord (nothing counted yet).
  const out = await call('GET', '/download');
  assert.equal(out.status, 302);
  assert.match(out.headers.get('location'), /\/discord\/authorize\?/);
  assert.equal(webStore.currentRelease().downloads, 0);
  // Back from Discord: the launcher page with ?download=1 – never the file itself (the browser would stay on Discord).
  const fakeOut = { headers: out.headers };
  const sid = await signIn(OLD, { start: fakeOut });
  assert.equal(signIn.landed, '/launcher?download=1&connected=1');
  const dl = await call('GET', '/download', { sid });
  assert.deepEqual([dl.status, dl.headers.get('location')], [302, '/updates/Hammer-Launcher-Setup-2.9.0.exe']);
  assert.equal(webStore.currentRelease().downloads, 1);
  assert.equal(webStore.referralOf(OLD.id).downloads, 1, 'counted for the account too');
  // Cancelled at Discord: back on the page, which then just says so.
  const again = await call('GET', '/download');
  const state = new URL(again.headers.get('location')).searchParams.get('state');
  const cancelled = await fetch(`${base}/api/shop/auth/callback?error=access_denied&state=${state}`, { headers: { cookie: [cookieOf(again, 'hs_oauth'), cookieOf(again, 'hs_next')].join('; ') }, redirect: 'manual' });
  assert.equal(cancelled.headers.get('location'), '/launcher?download=1&auth=cancelled');
  // The launcher's own updater never needs a session.
  assert.equal((await call('GET', '/updates/latest.yml')).status, 200);
  assert.equal((await call('GET', '/updates/Hammer-Launcher-Setup-2.9.0.exe')).status, 200);
  // Sign-in not set up on this server: nobody is locked out – the download works without it.
  const secret = env.web.clientSecret;
  env.web.clientSecret = '';
  try {
    const open = await call('GET', '/download');
    assert.deepEqual([open.status, open.headers.get('location')], [302, '/updates/Hammer-Launcher-Setup-2.9.0.exe']);
    assert.equal(webStore.currentRelease().downloads, 2);
    assert.equal((await call('GET', '/api/shop/auth/start?next=polecaj')).headers.get('location'), '/launcher?auth=unavailable#polecaj');
  } finally {
    env.web.clientSecret = secret;
  }
  // The referral card's sign-in comes back to the card.
  await signIn(OLD, { next: 'polecaj' });
  assert.equal(signIn.landed, '/launcher?connected=1#polecaj');
});

test('a personal link: stable per account, remembered for 30 days, counted only at a friend\'s very first sign-in', async () => {
  assert.deepEqual(await page(''), { signedIn: false, rewardDays: 7, authReady: true });
  sids.referrer = await signIn(REFERRER);
  const mine = await page(sids.referrer);
  assert.equal(mine.signedIn, true);
  const code = /\/r\/([a-z2-9]{8})$/.exec(mine.link)?.[1];
  assert.ok(code, mine.link);
  assert.equal(mine.link, `${base}/r/${code}`);
  assert.equal((await page(sids.referrer)).link, mine.link, 'always the same link');
  assert.deepEqual(mine.stats, { invited: 0, downloaded: 0, bought: 0, earned: 0, balance: 0 });

  // The link: a 30-day cookie and the launcher page.
  const visit = await call('GET', `/r/${code}`);
  assert.deepEqual([visit.status, visit.headers.get('location')], [302, '/launcher?invited=1']);
  const set = setCookies(visit).find((c) => c.startsWith('hs_ref='));
  assert.match(set, new RegExp(`^hs_ref=${code}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`));
  assert.equal((await call('GET', `/r/${code.toUpperCase()}`)).headers.get('location'), '/launcher?invited=1', 'typed in capitals');
  // A link that is no one's: just the page, nothing remembered.
  const unknown = await call('GET', '/r/zzzzzzzz');
  assert.deepEqual([unknown.headers.get('location'), cookieOf(unknown, 'hs_ref')], ['/launcher', '']);
  const ref = `hs_ref=${code}`;

  // A friend's first sign-in with the link remembered → recorded, for good; the cookie is cleared.
  sids.friend = await signIn(FRIEND, { ref });
  assert.equal(webStore.referralOf(FRIEND.id).by, REFERRER.id);
  assert.ok(signIn.cookies.some((c) => /^hs_ref=; .*Max-Age=0/.test(c)), 'the cookie is cleared');
  // Somebody who signed in before cannot be claimed later.
  await signIn(OLD, { ref });
  assert.equal(webStore.referralOf(OLD.id).by, null);
  // A Discord account younger than 7 days does not count.
  await signIn(YOUNG, { ref });
  assert.equal(webStore.referralOf(YOUNG.id)?.by ?? null, null);
  // Not yourself (the rule itself – your own link only exists once you have signed in).
  assert.equal(referrals.onFirstSignIn(REFERRER, code), 'self');
  // One referrer per friend: another link later changes nothing.
  sids.second = await signIn(SECOND);
  const otherCode = /\/r\/(\w+)$/.exec((await page(sids.second)).link)[1];
  await signIn(FRIEND, { ref: `hs_ref=${otherCode}` });
  assert.equal(referrals.onFirstSignIn(FRIEND, otherCode), 'taken');
  assert.equal(webStore.referralOf(FRIEND.id).by, REFERRER.id);

  // The friend downloads the launcher → the referrer's card shows it.
  await call('GET', '/download', { sid: sids.friend });
  assert.deepEqual((await page(sids.referrer)).stats, { invited: 1, downloaded: 1, bought: 0, earned: 0, balance: 0 });
});

test('a friend\'s first Hammer+ → +7 days on the referrer\'s running Hammer+: a new code by DM, on the page, the role kept', async () => {
  await buyPlus(sids.referrer, 'Steve');
  const before = hammerplus.runningUntil(guild.id, MC.Steve);
  assert.ok(before > Date.now() / 1000 + 29 * DAY);
  const roleOf = () => guild.roles.cache.find((r) => r.name === '💎 Hammer+');
  const dmsBefore = dmsTo(REFERRER.id).length;

  await buyPlus(sids.friend, 'Alex');
  // The time reaches the launcher like a second purchase: a new code for the same account, the old time plus 7 days.
  const after = hammerplus.runningUntil(guild.id, MC.Steve);
  assert.ok(after >= before + 7 * DAY && after <= before + 8 * DAY, `${after - before}s more`);
  const record = hammerplus.codes(guild.id).at(-1);
  assert.deepEqual([record.mc, record.source, record.discordId, record.by], [MC.Steve, 'referral', REFERRER.id, null]);
  const dm = dmsTo(REFERRER.id).slice(dmsBefore).join('\n');
  assert.match(dm, /Twój znajomy kupił Hammer\+ – dostajesz \+7 dni!/);
  assert.match(dm, /Zastąpi poprzedni kod/);
  const code = /HP1\.[\w-]+\.[\w-]+/.exec(dm)[0];
  assert.deepEqual([plus.verify(code).mc, plus.verify(code).exp], [MC.Steve, after]);
  assert.ok(guild.members.cache.get(REFERRER.id).roles.cache.has(roleOf().id), 'the 💎 Hammer+ role stays');
  // The card: one friend who bought, 7 days earned, nothing to claim – and the same code again.
  const card = await page(sids.referrer);
  assert.deepEqual(card.stats, { invited: 1, downloaded: 1, bought: 1, earned: 7, balance: 0 });
  assert.deepEqual([card.latest.code, card.latest.nick, card.latest.until], [code, 'Steve', after * 1000]);
  assert.doesNotMatch(JSON.stringify(webStore._state()), /HP1\./, 'no code is stored');

  // Only the first purchase counts.
  await buyPlus(sids.friend, 'Alex');
  assert.equal((await page(sids.referrer)).stats.earned, 7);
  assert.equal(hammerplus.runningUntil(guild.id, MC.Steve), after);
});

test('no Hammer+ yet: the days wait as a balance and are claimed on the page with a Minecraft nick', async () => {
  const ref = `hs_ref=${/\/r\/(\w+)$/.exec((await page(sids.second)).link)[1]}`;
  sids.friend2 = await signIn(FRIEND2, { ref });
  await buyPlus(sids.friend2, 'Jeb');
  let card = await page(sids.second);
  assert.deepEqual(card.stats, { invited: 1, downloaded: 0, bought: 1, earned: 7, balance: 7 });
  assert.equal(card.latest, null);
  assert.match(dmsTo(SECOND.id).join('\n'), /dostajesz \+7 dni![\s\S]*Masz \*\*7 dni Hammer\+\*\* do odebrania/);

  // Signed in, from this site only, a real nick, an account without Hammer+ forever.
  assert.equal((await call('POST', '/api/shop/referrals/claim', { body: { nick: 'Steve' } })).status, 401);
  assert.equal((await call('POST', '/api/shop/referrals/claim', { sid: sids.second, origin: 'https://evil.example', body: { nick: 'Steve' } })).status, 403);
  const wrong = await call('POST', '/api/shop/referrals/claim', { sid: sids.second, body: { nick: 'NikogoTakiego' } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.error, /Nie ma konta Minecraft o nicku NikogoTakiego/);
  hammerplus.grantKnown(guild.id, { mc: MC.Notch, nick: 'Notch', days: 0 });
  const forever = await call('POST', '/api/shop/referrals/claim', { sid: sids.second, body: { nick: 'Notch' } });
  assert.equal(forever.status, 400);
  assert.match(forever.body.error, /ma już Hammer\+ na zawsze/);
  assert.equal((await page(sids.second)).stats.balance, 7, 'nothing was taken');

  // Alex has Hammer+ (bought by a friend above): the 7 days are added after it, in one new code.
  const alexUntil = hammerplus.runningUntil(guild.id, MC.Alex);
  const claimed = await call('POST', '/api/shop/referrals/claim', { sid: sids.second, body: { nick: 'alex' } });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.body));
  assert.deepEqual([claimed.body.nick, claimed.body.days, claimed.body.stats.balance], ['Alex', 7, 0]);
  const payload = plus.verify(claimed.body.code);
  assert.equal(payload.mc, MC.Alex);
  assert.ok(payload.exp >= alexUntil + 7 * DAY && payload.exp <= alexUntil + 8 * DAY);
  assert.equal(claimed.body.until, payload.exp * 1000);
  assert.match(dmsTo(SECOND.id).at(-1), /Odebrano 7 dni Hammer\+[\s\S]*HP1\./);
  assert.equal(/HP1\.[\w-]+\.[\w-]+/.exec(dmsTo(SECOND.id).at(-1))[0], claimed.body.code, 'the DM and the page show one code');
  assert.ok(guild.members.cache.get(SECOND.id).roles.cache.has(guild.roles.cache.find((r) => r.name === '💎 Hammer+').id), 'the 💎 Hammer+ role');
  card = await page(sids.second);
  assert.deepEqual([card.stats.balance, card.latest.code], [0, claimed.body.code]);
  const twice = await call('POST', '/api/shop/referrals/claim', { sid: sids.second, body: { nick: 'Alex' } });
  assert.equal(twice.status, 409);
  // The next reward of somebody whose Hammer+ now runs on a Discord-tied account goes straight onto it.
  assert.equal(require('../src/features/referrals').accountOf(guild.id, SECOND.id).mc, MC.Alex);
});

test('the admin panel: the programme\'s totals and the accounts that brought the most people', async () => {
  const overview = await call('GET', '/api/admin/referrals', { sid: sids.owner });
  assert.equal(overview.status, 200);
  assert.deepEqual([overview.body.invited, overview.body.downloaded, overview.body.bought, overview.body.earned, overview.body.balance], [2, 1, 2, 14, 0]);
  assert.deepEqual(overview.body.top.map((t) => [t.name, t.invited, t.bought, t.earned]), [['Polecajacy', 1, 1, 7], ['Bezplusa', 1, 1, 7]]);
  assert.equal((await call('GET', '/api/admin/referrals', { sid: sids.friend })).status, 403);
  // Everything survives a restart (data/web.json).
  webStore.flush();
  webStore.load();
  assert.equal(webStore.referralOf(FRIEND.id).by, REFERRER.id);
  assert.equal(webStore.referrerOf(webStore.referralCode(REFERRER.id)), REFERRER.id);
  assert.deepEqual(webStore.referralStats(SECOND.id), { invited: 1, downloaded: 0, bought: 1, earned: 7, balance: 0 });
  // /hammerplus list says where a reward code came from.
  assert.match(hammerplus.line(hammerplus.recent(guild.id, 5).find((r) => r.source === 'referral')), /nagroda za polecenie dla <@\d+>/);
});

test('a Discord account\'s age comes from its ID', () => {
  assert.equal(referrals.accountCreatedAt('1'), null, 'too short to be a real ID');
  assert.equal(referrals.accountCreatedAt('175928847299117063'), Date.UTC(2016, 3, 30, 11, 18, 25, 796)); // Discord's own example
  assert.ok(Math.abs(referrals.accountCreatedAt(madeAgo(3)) - (Date.now() - 3 * DAY * 1000)) < 5000);
  assert.equal(referrals.accountCreatedAt('abc'), null);
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

test('the real page: signed out it asks for Discord to download; signed in it downloads and shows the referral card', { skip: !pw && 'Playwright is not installed' }, async () => {
  const browser = await pw.chromium.launch(fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {});
  const shots = process.env.HS_SHOTS;
  try {
    for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, acceptDownloads: true });
      const tab = await context.newPage();
      const problems = [];
      tab.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
      tab.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
      const w = viewport.width;
      // Signed out, coming from a friend's link.
      await tab.goto(`${base}/r/${webStore.referralCode(REFERRER.id)}`);
      await tab.locator('#invited').waitFor();
      assert.equal(new URL(tab.url()).pathname + new URL(tab.url()).search, '/launcher');
      const download = tab.locator('#download');
      await tab.waitForFunction(() => document.getElementById('download').textContent === 'Zaloguj przez Discord i pobierz');
      assert.equal(await download.getAttribute('href'), '/download');
      await tab.locator('#ref-login').waitFor();
      assert.equal(await tab.locator('#ref-in').isHidden(), true);
      assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (shots) {
        await tab.screenshot({ path: `${shots}/strona-wylogowany-${w}.png` });
        await tab.locator('#polecaj').scrollIntoViewIfNeeded();
        await tab.screenshot({ path: `${shots}/polecaj-wylogowany-${w}.png` });
        await tab.locator('#plus').scrollIntoViewIfNeeded();
        await tab.screenshot({ path: `${shots}/plus-perki-${w}.png` });
      }
      // The button: Discord, then back on the page, which downloads by itself and says so.
      fakes.state.user = OLD;
      const [file] = await Promise.all([tab.waitForEvent('download', { timeout: 15_000 }), download.click()]);
      assert.equal(file.suggestedFilename(), 'Hammer-Launcher-Setup-2.9.0.exe');
      await file.cancel().catch(() => null);
      await tab.locator('#download-started').waitFor();
      assert.equal(new URL(tab.url()).search, '', 'the address is clean again – a refresh does not download twice');
      assert.equal(await download.textContent(), 'Pobierz na Windows');
      if (shots) {
        await tab.evaluate(() => window.scrollTo(0, 0));
        await tab.screenshot({ path: `${shots}/pobieranie-ruszylo-${w}.png` });
      }
      // Signed in as somebody with friends, a reward code and days to claim: the card.
      webStore.addReferralDays(REFERRER.id, 7, { earned: false, balance: true });
      fakes.state.user = REFERRER;
      await tab.goto(`${base}/api/shop/auth/start?next=polecaj`);
      await tab.locator('#ref-in').waitFor();
      assert.match(await tab.locator('#ref-link').inputValue(), new RegExp(`^${base}/r/[a-z2-9]{8}$`));
      assert.equal(await tab.locator('#ref-bought').textContent(), '1');
      assert.equal(await tab.locator('#ref-invited-l').textContent(), 'osoba z Twojego linku');
      assert.equal(await tab.locator('#ref-earned-l').textContent(), 'dni zdobytych');
      await tab.locator('#ref-claim').waitFor();
      assert.match(await tab.locator('#ref-balance').textContent(), /Masz 7 dni Hammer\+ do odebrania/);
      assert.equal(await tab.locator('#ref-result .code').count(), 1, 'the reward code is shown again');
      assert.equal(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no sideways scrolling');
      if (shots) {
        await tab.locator('#polecaj').scrollIntoViewIfNeeded();
        await tab.waitForTimeout(300);
        await tab.locator('#polecaj').screenshot({ path: `${shots}/polecaj-zalogowany-${w}.png` });
      }
      // Claimed on the page: the code right there.
      await tab.locator('#ref-nick').fill('Jeb');
      await tab.locator('#ref-claim-btn').click();
      await tab.locator('#ref-result .pill', { hasText: 'Odebrane z poleceń' }).waitFor();
      assert.equal(await tab.locator('#ref-claim').isHidden(), true);
      assert.equal(plus.verify(await tab.locator('#ref-result .code').textContent()).mc, MC.Jeb);
      if (shots) await tab.locator('#polecaj').screenshot({ path: `${shots}/polecaj-odebrane-${w}.png` });
      assert.deepEqual(problems, []);
      await context.close();
    }
    // The admin panel's Hammer+ tab: the programme in numbers.
    const panel = await (await browser.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
    fakes.state.user = OWNER;
    await panel.goto(`${base}/api/shop/auth/start?next=admin`);
    await panel.goto(`${base}/admin#plus`);
    await panel.locator('#ref-top tr', { hasText: 'Polecajacy' }).waitFor();
    assert.equal(await panel.locator('#ref-totals .stat').count(), 5);
    if (shots) {
      await panel.locator('#ref-top').scrollIntoViewIfNeeded();
      await panel.screenshot({ path: `${shots}/panel-polecenia.png` });
    }
  } finally {
    await browser.close();
  }
});
