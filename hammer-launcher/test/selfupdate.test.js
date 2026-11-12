'use strict';

/* The launcher's own updates (src/main/selfupdate.js): version compare, where the feed is, which builds can update,
   the state machine around electron-updater (a fake one here), signed updates and the required update. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { createSelfUpdate, parseVersion, compareVersions, isNewer, updatesBase, updateSupport, updateFile, signedText, verifyRelease, checkSignature, sha512File, requiredUpdate, notesOf, TEXT, FIRST_CHECK, CHECK_EVERY } = require('../src/main/selfupdate');
const { publicKey } = require('../src/main/plus');
const { signRelease, signInstaller, newKeyPair, privateKeyFrom, withSignature, main: signMain, SignError } = require('../scripts/sign-release');
const { createServices } = require('../src/main/services');
const { tmpDir, mockFetch } = require('./helpers');

const sha = (text) => crypto.createHash('sha512').update(text).digest('base64');
const SUPPORTED = { supported: true, reason: null };
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** latest.yml as electron-builder writes it (already parsed), for one installer. */
const latest = (version, { sha512 = sha(`installer ${version}`), signature, notes, name = `Hammer-Launcher-Setup-${version}.exe` } = {}) => ({
  version,
  files: [{ url: name, sha512, size: 257000000 }],
  path: name,
  sha512,
  releaseDate: '2026-11-12T10:00:00.000Z',
  ...(notes ? { releaseNotes: notes } : {}),
  ...(signature ? { signature } : {}),
});

/** A stand-in for electron-updater's autoUpdater: `answer` is what the next look finds. */
function fakeUpdater() {
  const u = new EventEmitter();
  Object.assign(u, {
    feed: null,
    checks: 0,
    downloads: 0,
    quits: [],
    installs: [],
    answer: null, // { info } = a newer version, { error } = the look fails, null = nothing newer
    failDownload: null,
    setFeedURL(options) {
      u.feed = options;
    },
    async checkForUpdates() {
      u.checks += 1;
      const a = u.answer;
      if (a?.error) {
        u.emit('error', a.error); // electron-updater says it twice: as an event and as a rejection
        throw a.error;
      }
      if (a?.info) u.emit('update-available', a.info);
      else u.emit('update-not-available', { version: '0.0.0' });
      return a;
    },
    async downloadUpdate() {
      u.downloads += 1;
      if (u.failDownload) {
        u.emit('error', u.failDownload);
        throw u.failDownload;
      }
    },
    /** The download ends: electron-updater hands over the info with the path of the file. */
    finish(info, file = '/cache/pending/installer.exe') {
      u.emit('update-downloaded', { ...info, downloadedFile: file });
    },
    quitAndInstall(silent, run) {
      u.quits.push([silent, run]);
    },
    install(silent, run) {
      u.installs.push([silent, run]);
      return true;
    },
  });
  return u;
}

/** Timers the test turns by hand: run() fires the one that is waiting. */
function fakeTimers() {
  const waiting = [];
  return {
    waiting,
    set: (fn, ms) => {
      const t = { fn, ms };
      waiting.push(t);
      return t;
    },
    clear: (t) => {
      const i = waiting.indexOf(t);
      if (i >= 0) waiting.splice(i, 1);
    },
    async run() {
      const t = waiting.shift();
      await t.fn();
      return t.ms;
    },
  };
}

function setup(options = {}) {
  const updater = options.updater === undefined ? fakeUpdater() : options.updater;
  const states = [];
  const logs = [];
  const world = { game: false, auto: true };
  const timers = fakeTimers();
  const self = createSelfUpdate({
    updater,
    version: '2.6.0',
    feedUrl: 'https://hammershop.pl/updates',
    support: SUPPORTED,
    gameRunning: () => world.game,
    autoUpdate: () => world.auto,
    onChange: (s) => states.push(s),
    log: (l) => logs.push(l),
    now: () => 1_800_000_000_000,
    timers,
    platform: 'win32',
    arch: 'x64',
    ...options,
    ...(options.updater === undefined ? { updater } : {}),
  });
  return { self, updater, states, logs, world, timers, statuses: () => states.map((s) => s.status) };
}

test('versions: compared by numbers, not by letters; a test version is older than the release; junk is no version', () => {
  assert.deepEqual(parseVersion('2.6.1'), { numbers: [2, 6, 1], pre: [] });
  assert.deepEqual(parseVersion(' v2.6 '), { numbers: [2, 6, 0], pre: [] });
  assert.deepEqual(parseVersion('2.7.0-beta.2+build5'), { numbers: [2, 7, 0], pre: ['beta', '2'] });
  for (const junk of ['', 'abc', '2', '2.x.1', '2.6.1.4', '1e3.0.0', '-1.0.0', '2.6.1 beta', null, undefined, 2.6, {}, '9999999999.0.0']) assert.equal(parseVersion(junk), null, String(junk));
  const order = ['1.9.9', '2.0.0', '2.5.0', '2.5.10', '2.6.0-alpha', '2.6.0-beta', '2.6.0-beta.2', '2.6.0-beta.10', '2.6.0-rc.1', '2.6.0', '2.6.1', '2.9.9', '2.10.0', '2.100.0', '10.0.0'];
  for (let i = 0; i < order.length; i += 1) {
    for (let j = 0; j < order.length; j += 1) assert.equal(compareVersions(order[i], order[j]), Math.sign(i - j), `${order[i]} vs ${order[j]}`);
  }
  assert.equal(compareVersions('2.6', '2.6.0'), 0);
  assert.equal(compareVersions('v2.6.0', '2.6.0+abc'), 0, 'build metadata does not count');
  assert.equal(compareVersions('2.6.0-1', '2.6.0-beta'), -1, 'a number sorts before a word');
  assert.equal(compareVersions('2.6.0', 'nowa'), null);
  assert.equal(compareVersions(undefined, '2.6.0'), null);
  assert.equal(isNewer('2.10.0', '2.9.9'), true);
  assert.equal(isNewer('2.6.0', '2.6.0'), false);
  assert.equal(isNewer('2.5.9', '2.6.0'), false);
  assert.equal(isNewer('najnowsza', '2.6.0'), false, 'what is not a version is never "newer"');
  assert.equal(isNewer('2.6.1', null), false);
});

test('feed: updateUrl, else <shopApi or website>/updates – https only, http just for this computer; nothing → off', () => {
  assert.equal(updatesBase({ website: 'https://hammershop.pl' }), 'https://hammershop.pl/updates');
  assert.equal(updatesBase({ website: 'https://hammershop.pl/', shopApi: 'https://sklep.hammershop.pl/' }), 'https://sklep.hammershop.pl/updates');
  assert.equal(updatesBase({ website: 'https://hammershop.pl', updateUrl: ' https://pliki.hammershop.pl/launcher/ ' }), 'https://pliki.hammershop.pl/launcher');
  assert.equal(updatesBase({ updateUrl: 'http://localhost:8787/updates' }), 'http://localhost:8787/updates');
  assert.equal(updatesBase({ updateUrl: 'http://127.0.0.1:8787' }), 'http://127.0.0.1:8787');
  for (const config of [{}, { website: '' }, { website: 'http://hammershop.pl' }, { website: 'hammershop.pl' }, { website: 'https://hammershop.pl', updateUrl: 'http://pliki.hammershop.pl/launcher' }, { updateUrl: 'ftp://hammershop.pl/updates' }, { updateUrl: 'https://kto:haslo@hammershop.pl/updates' }, { updateUrl: 'https://hammershop.pl/updates?x=1' }, { updateUrl: 'http://localhost.zly.pl/updates' }, { updateUrl: 'javascript:alert(1)' }]) {
    assert.equal(updatesBase(config), '', JSON.stringify(config));
  }
  assert.equal(updatesBase(), '');
});

test('which builds update themselves: the installed Windows build and the AppImage – nothing else', () => {
  assert.deepEqual(updateSupport({ platform: 'win32', packaged: true }), { supported: true, reason: null });
  assert.deepEqual(updateSupport({ platform: 'linux', packaged: true, appImage: true }), { supported: true, reason: null });
  assert.deepEqual(updateSupport({ platform: 'win32', packaged: true, portable: true }), { supported: false, reason: 'portable' });
  assert.deepEqual(updateSupport({ platform: 'win32', packaged: false }), { supported: false, reason: 'dev' });
  assert.deepEqual(updateSupport({ platform: 'linux', packaged: false, appImage: true }), { supported: false, reason: 'dev' });
  assert.deepEqual(updateSupport({ platform: 'linux', packaged: true }), { supported: false, reason: 'package' });
  assert.deepEqual(updateSupport({ platform: 'darwin', packaged: true }), { supported: false, reason: 'platform' });
  assert.deepEqual(updateSupport({ platform: 'freebsd', packaged: true }), { supported: false, reason: 'platform' });
  assert.deepEqual(updateSupport({ platform: 'win32', packaged: true, hasConfig: false }), { supported: false, reason: 'config' });
  assert.deepEqual(updateSupport({ packaged: false }), { supported: false, reason: 'dev' });
});

test('no feed, or a build that cannot update: the updater is never touched and nothing errors', async () => {
  const off = setup({ feedUrl: '' });
  assert.equal(off.self.status().status, 'off');
  off.self.start();
  assert.equal(off.timers.waiting.length, 0);
  assert.equal((await off.self.check()).status, 'off');
  assert.equal(off.updater.checks, 0);
  assert.equal(off.updater.feed, null);
  assert.throws(() => off.self.download(), /nie aktualizuje się sama/);
  assert.equal(off.self.installOnQuit(0), false);

  for (const reason of ['dev', 'portable', 'package', 'platform']) {
    const { self, updater, timers } = setup({ support: { supported: false, reason } });
    assert.deepEqual([self.status().status, self.status().supported, self.status().reason], ['unsupported', false, reason]);
    self.start();
    await self.check();
    assert.deepEqual([timers.waiting.length, updater.checks, updater.feed, updater.listenerCount('update-available')], [0, 0, null, 0], reason);
    assert.throws(() => self.install(), /nie aktualizuje się sama/);
    assert.throws(() => self.update(), /nie aktualizuje się sama/);
    // It still tells that a newer version exists – from what the shop says (the button opens release.url).
    const state = self.setRelease({ version: '2.6.1', notes: 'Poprawki.', url: 'https://hammershop.pl/launcher', size: 257000000, date: 1, minVersion: null }, true);
    assert.deepEqual(state.release, { version: '2.6.1', notes: 'Poprawki.', url: 'https://hammershop.pl/launcher', size: 257000000, date: 1 });
    assert.equal(state.notes, 'Poprawki.');
    assert.equal(self.setRelease({ version: '2.6.0', notes: null, url: null }, true).release, null, 'the same version is not news');
    assert.equal(self.setRelease({ version: '2.5.9' }, true).release, null);
  }
  // A build that could update, but the updater did not load: off, quietly.
  assert.equal(setup({ updater: null }).self.status().status, 'off');
});

test('the usual round: first look after a few seconds, the update downloads in the background, then it is ready', async () => {
  const { self, updater, timers, states, statuses, logs } = setup();
  assert.deepEqual(updater.feed, { provider: 'generic', url: 'https://hammershop.pl/updates' });
  assert.deepEqual([updater.autoDownload, updater.autoInstallOnAppQuit, updater.allowDowngrade, updater.disableWebInstaller], [false, false, false, true]);
  assert.deepEqual([self.status().status, self.status().current, self.status().latest, self.status().auto], ['idle', '2.6.0', null, true]);
  self.start();
  self.start(); // (twice is once)
  assert.deepEqual(timers.waiting.map((t) => t.ms), [FIRST_CHECK]);
  assert.equal(updater.checks, 0, 'nothing is asked before the timer');

  // Nothing newer.
  assert.equal(await timers.run(), FIRST_CHECK);
  assert.deepEqual(statuses(), ['checking', 'idle']);
  assert.deepEqual([self.status().upToDate, self.status().checkedAt], [true, 1_800_000_000_000]);
  assert.deepEqual(timers.waiting.map((t) => t.ms), [CHECK_EVERY], 'the next look is four hours away');
  assert.equal(CHECK_EVERY, 4 * 60 * 60 * 1000);

  // Four hours later there is 2.6.1.
  const info = latest('2.6.1', { notes: 'Nowy ekran aktualności.\n\n<b>Poprawki</b> w Skórce.' });
  updater.answer = { info };
  states.length = 0;
  await timers.run();
  assert.deepEqual(statuses(), ['checking', 'downloading']);
  assert.equal(updater.downloads, 1);
  assert.deepEqual([self.status().latest, self.status().percent, self.status().upToDate], ['2.6.1', 0, false]);
  assert.equal(self.status().notes, 'Nowy ekran aktualności.\n\nPoprawki w Skórce.', 'release notes as plain text');
  updater.emit('download-progress', { percent: 41.6, transferred: 1, total: 2 });
  updater.emit('download-progress', { percent: 41.9 });
  updater.emit('download-progress', { percent: 250 });
  assert.deepEqual(states.slice(2).map((s) => s.percent), [42, 100], 'one event per whole percent');
  // While it downloads, another look does not start.
  await self.check();
  assert.equal(updater.checks, 2);
  updater.finish(info);
  await tick();
  assert.deepEqual([self.status().status, self.status().latest, self.status().percent, self.status().error], ['ready', '2.6.1', null, null]);
  assert.equal(updater.quits.length, 0, 'nothing restarts by itself');
  assert.ok(logs.some((l) => l.includes('2.6.1')));

  // A later look finds the same version again: the installer that is here stays, nothing is downloaded twice.
  states.length = 0;
  await timers.run();
  assert.deepEqual([self.status().status, updater.downloads, states.length], ['ready', 1, 0]);
  // …and a later look that fails takes nothing away either.
  updater.answer = { error: Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), { code: 'ERR_UPDATER' }) };
  await timers.run();
  assert.deepEqual([self.status().status, self.status().error], ['ready', null]);

  self.stop();
  assert.equal(timers.waiting.length, 0);
});

test('„Uruchom ponownie i zaktualizuj”: never under a running game – the reason is said; closing the launcher installs', async () => {
  const { self, updater, world, states } = setup();
  const info = latest('2.6.1');
  updater.answer = { info };
  await self.check();
  assert.throws(() => self.install(), /nie jest jeszcze pobrana/);
  assert.equal(self.installOnQuit(0), false, 'nothing to install yet');
  updater.finish(info);
  await tick();

  world.game = true;
  states.length = 0;
  assert.equal(self.refresh().gameRunning, true);
  assert.equal(states.at(-1).gameRunning, true, 'the window hears that a game runs (the button goes grey)');
  assert.throws(() => self.install(), new RegExp(TEXT.game));
  assert.throws(() => self.update(), new RegExp(TEXT.game));
  assert.equal(self.installOnQuit(0), false, 'closing the launcher under a running game installs nothing');
  assert.deepEqual([updater.quits, updater.installs], [[], []]);
  assert.equal(self.status().status, 'ready', 'the update waits');

  world.game = false;
  assert.equal(self.refresh().gameRunning, false);
  assert.equal(self.installOnQuit(1), false, 'not when the launcher goes down with an error');
  assert.equal(self.installOnQuit(0), true);
  assert.deepEqual(updater.installs, [[true, false]], 'quietly, without starting the launcher again');
  assert.equal(self.installOnQuit(0), false, 'once');

  // The button: quiet install and the launcher starts again.
  const second = setup();
  second.updater.answer = { info };
  await second.self.check();
  second.updater.finish(info);
  await tick();
  second.self.install();
  assert.deepEqual(second.updater.quits, [[true, true]]);
  assert.equal(second.self.installOnQuit(0), false, 'the installer is already on its way');
  assert.deepEqual(second.updater.installs, []);
  // The installer could not be started: the updater says so, the window gets a calm sentence.
  second.updater.emit('error', new Error('spawn EACCES'));
  assert.deepEqual([second.self.status().status, second.self.status().error], ['ready', TEXT.install]);
});

test('„Aktualizuj automatycznie” off: the launcher only tells; „Pobierz i zainstaluj” fetches; switching it on fetches too', async () => {
  const { self, updater, world, statuses } = setup();
  world.auto = false;
  const info = latest('2.6.1');
  updater.answer = { info };
  await self.check();
  assert.deepEqual([self.status().status, self.status().latest, self.status().auto, updater.downloads], ['available', '2.6.1', false, 0]);
  assert.equal(self.status().status, 'available');
  self.download();
  assert.deepEqual([self.status().status, updater.downloads], ['downloading', 1]);
  self.download(); // a second click does nothing
  await tick();
  assert.equal(updater.downloads, 1);
  updater.finish(info);
  await tick();
  assert.deepEqual(statuses(), ['checking', 'available', 'downloading', 'ready']);
  assert.equal(updater.quits.length, 0, 'the restart is the player\'s click');

  const later = setup();
  later.world.auto = false;
  later.updater.answer = { info };
  await later.self.check();
  assert.throws(() => setup().self.download(), /Nie ma teraz aktualizacji do pobrania/);
  later.world.auto = true;
  assert.equal(later.self.refresh().status, 'downloading', 'the switch went on: the announced update is fetched');
  assert.equal(later.updater.downloads, 1);
  // The server took the release back before anybody fetched it.
  const gone = setup();
  gone.world.auto = false;
  gone.updater.answer = { info };
  await gone.self.check();
  gone.updater.answer = null;
  await gone.self.check();
  assert.deepEqual([gone.self.status().status, gone.self.status().latest, gone.self.status().upToDate], ['idle', null, true]);
});

test('errors are calm Polish, details go to the log; nothing published yet counts as up to date', async () => {
  const { self, updater, logs } = setup();
  updater.answer = { error: Object.assign(new Error('getaddrinfo ENOTFOUND hammershop.pl\n    at stack…'), { code: 'ENOTFOUND' }) };
  const state = await self.check();
  assert.deepEqual([state.status, state.error, state.upToDate], ['error', TEXT.check, false]);
  assert.match(TEXT.check, /^Nie udało się sprawdzić aktualizacji launchera\./);
  assert.ok(logs.some((l) => l.includes('ENOTFOUND')) && !logs.some((l) => l.includes('stack…')));
  // „Sprawdź teraz” after an error works again.
  updater.answer = null;
  assert.deepEqual([(await self.check()).status, self.status().error], ['idle', null]);

  // No latest.yml on the server (nothing was published, or not for this system): not an error.
  updater.answer = { error: Object.assign(new Error('Cannot find channel "latest.yml" update info: HttpError: 404'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }) };
  assert.deepEqual([(await self.check()).status, self.status().upToDate, self.status().error], ['idle', true, null]);

  // The download breaks.
  const info = latest('2.6.1');
  updater.answer = { info };
  updater.failDownload = Object.assign(new Error('sha512 checksum mismatch'), { code: 'ERR_CHECKSUM_MISMATCH' });
  await self.check();
  await tick();
  assert.deepEqual([self.status().status, self.status().error, self.status().percent], ['error', TEXT.download, null]);
  assert.throws(() => self.install(), /nie jest jeszcze pobrana/);
  assert.equal(self.installOnQuit(0), false);
  // The next look tries again.
  updater.failDownload = null;
  await self.check();
  assert.deepEqual([self.status().status, updater.downloads], ['downloading', 2]);

  // A fake that only rejects (no 'error' event), and one that answers nothing at all.
  const quiet = setup();
  quiet.updater.checkForUpdates = async () => Promise.reject(new Error('boom'));
  assert.equal((await quiet.self.check()).status, 'error');
  quiet.updater.checkForUpdates = async () => null;
  assert.equal((await quiet.self.check()).status, 'idle');
  // latest.yml without a proper version.
  const odd = setup();
  odd.updater.answer = { info: { version: 'najnowsza', files: [] } };
  assert.deepEqual([(await odd.self.check()).status, odd.updater.downloads], ['error', 0]);
  // An updater that cannot even be set up switches the feature off.
  const broken = fakeUpdater();
  broken.setFeedURL = () => {
    throw new Error('bad url');
  };
  assert.equal(setup({ updater: broken }).self.status().status, 'off');
});

test('release notes: a text or the updater\'s list – always plain text, cut to a length', () => {
  assert.equal(notesOf({ releaseNotes: 'Jedno.\r\n\r\n\r\n\r\nDrugie.\u0007' }), 'Jedno.\n\nDrugie.');
  assert.equal(notesOf({ releaseNotes: [{ version: '2.6.1', note: '<p>Poprawki</p>' }, { version: '2.6.0', note: 'Aktualności' }, { version: '2.5.0', note: null }] }), 'Poprawki\n\nAktualności');
  assert.equal(notesOf({ releaseNotes: 'x'.repeat(5000) }).length, 2000);
  for (const info of [{}, null, { releaseNotes: null }, { releaseNotes: 7 }, { releaseNotes: '   ' }, { releaseNotes: [] }]) assert.equal(notesOf(info), null);
});

/* ── signed updates ── */

test('signature: sign → verify round trip; a changed version, a changed checksum and a wrong key all fail', () => {
  const owner = newKeyPair();
  const other = newKeyPair();
  const key = publicKey(owner.publicKey);
  assert.ok(key, 'the public half has the format of plusPublicKey: base64 of 32 raw bytes');
  assert.equal(Buffer.from(owner.publicKey, 'base64').length, 32);
  const release = { version: '2.6.1', sha512: sha('installer 2.6.1') };
  const signature = signRelease(release, owner.privateKey);
  assert.equal(Buffer.from(signature, 'base64').length, 64);
  assert.equal(signedText('2.6.1', 'abc'), '2.6.1\nabc');
  assert.equal(verifyRelease({ ...release, signature }, key), true);
  assert.equal(verifyRelease({ ...release, signature: ` ${signature}\n` }, key), true, 'the line break of a .sig file does not matter');
  assert.equal(signRelease(release, privateKeyFrom(`${owner.privateKey}\n`)), signature, 'Ed25519 signatures are the same every time');

  assert.equal(verifyRelease({ ...release, version: '2.6.2', signature }, key), false, 'another version');
  assert.equal(verifyRelease({ ...release, version: '2.6.1 ', signature }, key), false);
  assert.equal(verifyRelease({ ...release, sha512: sha('installer 2.6.1 with a virus'), signature }, key), false, 'another file');
  assert.equal(verifyRelease({ ...release, signature }, publicKey(other.publicKey)), false, 'another key');
  assert.equal(verifyRelease({ ...release, signature: signRelease(release, other.privateKey) }, key), false, 'signed by somebody else');
  const flipped = Buffer.from(signature, 'base64');
  flipped[10] ^= 1;
  assert.equal(verifyRelease({ ...release, signature: flipped.toString('base64') }, key), false);
  for (const bad of ['', 'podpis', signature.slice(0, -4), `${signature}AAAA`, null, undefined, 7, {}]) assert.equal(verifyRelease({ ...release, signature: bad }, key), false, String(bad));
  assert.equal(verifyRelease({ ...release, signature }, null), false, 'no key, no trust');
  assert.equal(verifyRelease({ version: '', sha512: release.sha512, signature }, key), false);
  assert.equal(verifyRelease(undefined, key), false);

  // The signer refuses what is not a release or not a key.
  assert.throws(() => signRelease({ version: 'nowa', sha512: release.sha512 }, owner.privateKey), SignError);
  assert.throws(() => signRelease({ version: '2.6.1', sha512: 'abc' }, owner.privateKey), SignError);
  assert.throws(() => privateKeyFrom(''), /Brak klucza prywatnego/);
  assert.throws(() => privateKeyFrom(owner.publicKey), /To nie jest klucz prywatny/);
  const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
  assert.throws(() => privateKeyFrom(rsa), /Ed25519/);
});

test('signature: it is checked for the file electron-updater downloads on this system', () => {
  const owner = newKeyPair();
  const key = publicKey(owner.publicKey);
  const exe = sha('setup.exe');
  const info = { version: '2.6.1', files: [{ url: 'Hammer-Launcher-Setup-2.6.1.exe', sha512: exe, size: 1 }], path: 'Hammer-Launcher-Setup-2.6.1.exe', sha512: exe };
  assert.deepEqual(updateFile(info, { platform: 'win32', arch: 'x64' }), { url: 'Hammer-Launcher-Setup-2.6.1.exe', sha512: exe });
  // Several files: the .exe on Windows, the AppImage for this processor on Linux – never a .deb.
  const many = { version: '2.6.1', files: [{ url: 'hammer-launcher_2.6.1_amd64.deb', sha512: sha('deb') }, { url: 'Hammer-Launcher-2.6.1-arm64.AppImage', sha512: sha('arm') }, { url: 'Hammer-Launcher-2.6.1-x64.AppImage?x=1', sha512: sha('x64') }, { url: 'https://cdn.example/Hammer%20Launcher%20Setup.EXE', sha512: exe }] };
  assert.equal(updateFile(many, { platform: 'win32', arch: 'x64' }).sha512, exe);
  assert.equal(updateFile(many, { platform: 'linux', arch: 'x64' }).sha512, sha('x64'));
  assert.equal(updateFile(many, { platform: 'linux', arch: 'arm64' }).sha512, sha('arm'));
  assert.equal(updateFile(many, { platform: 'linux', arch: 'ia32' }).sha512, sha('arm'), 'no file for this processor: the first AppImage, like electron-updater');
  // The old form of latest.yml (path + sha512 only).
  assert.deepEqual(updateFile({ version: '2.6.1', path: 'Setup.exe', sha512: exe }, { platform: 'win32', arch: 'x64' }), { url: 'Setup.exe', sha512: exe });
  for (const none of [null, {}, { files: [] }, { files: [{ url: 'Setup.exe' }] }, { files: [{ sha512: exe }] }, { files: 'x' }]) assert.equal(updateFile(none, { platform: 'win32', arch: 'x64' }), null);

  const signature = signRelease({ version: '2.6.1', sha512: exe }, owner.privateKey);
  assert.deepEqual(checkSignature({ ...info, signature }, { key, platform: 'win32', arch: 'x64' }), { ok: true, sha512: exe });
  assert.deepEqual(checkSignature(info, { key, platform: 'win32', arch: 'x64' }), { ok: false, reason: 'unsigned' });
  assert.deepEqual(checkSignature({ ...info, signature: '  ' }, { key, platform: 'win32', arch: 'x64' }), { ok: false, reason: 'unsigned' });
  assert.deepEqual(checkSignature({ ...info, version: '2.6.2', signature }, { key, platform: 'win32', arch: 'x64' }), { ok: false, reason: 'invalid' });
  assert.deepEqual(checkSignature({ ...info, files: [{ url: 'Hammer-Launcher-Setup-2.6.1.exe', sha512: sha('other') }], signature }, { key, platform: 'win32', arch: 'x64' }), { ok: false, reason: 'invalid' }, 'the checksum of the file that will be downloaded counts, not the top-level one');
  assert.deepEqual(checkSignature({ version: '2.6.1', files: [], signature }, { key, platform: 'win32', arch: 'x64' }), { ok: false, reason: 'no-file' });
  assert.deepEqual(checkSignature({ ...info, signature }, { key: null, platform: 'win32', arch: 'x64' }), { ok: false, reason: 'invalid' });
});

test('sign-release.js: the same sha512 as latest.yml, a .sig next to the installer, the signature into latest.yml', async () => {
  const dir = tmpDir('sign');
  const installer = path.join(dir, 'Hammer-Launcher-Setup-2.6.1.exe');
  const bytes = crypto.randomBytes(300 * 1024);
  fs.writeFileSync(installer, bytes);
  const sum = crypto.createHash('sha512').update(bytes).digest('base64'); // what electron-builder's hashFile(file, 'sha512', 'base64') gives
  assert.equal(await sha512File(installer), sum);
  await assert.rejects(sha512File(path.join(dir, 'nie-ma.exe')), /ENOENT/);
  const owner = newKeyPair();
  const key = publicKey(owner.publicKey);

  // Without a latest.yml: the version comes from --version, else from package.json.
  const plain = await signInstaller(installer, { key: owner.privateKey, packageVersion: '2.6.1' });
  assert.deepEqual([plain.version, plain.sha512, plain.sigFile, plain.yml, plain.publicKey], ['2.6.1', sum, `${installer}.sig`, null, owner.publicKey]);
  assert.equal(fs.readFileSync(`${installer}.sig`, 'utf8'), `${plain.signature}\n`);
  assert.equal(verifyRelease({ version: '2.6.1', sha512: sum, signature: fs.readFileSync(`${installer}.sig`, 'utf8') }, key), true);
  assert.equal((await signInstaller(installer, { key: owner.privateKey, version: '2.7.0', packageVersion: '2.6.1' })).version, '2.7.0');

  // With the latest.yml electron-builder wrote next to it: the version and the checksum must be this file's.
  const yml = path.join(dir, 'latest.yml');
  const text = `version: 2.6.1\nfiles:\n  - url: Hammer-Launcher-Setup-2.6.1.exe\n    sha512: ${sum}\n    size: ${bytes.length}\npath: Hammer-Launcher-Setup-2.6.1.exe\nsha512: ${sum}\nreleaseDate: '2026-11-12T10:00:00.000Z'\n`;
  fs.writeFileSync(yml, text);
  const signed = await signInstaller(installer, { key: owner.privateKey, packageVersion: '9.9.9', writeYml: true });
  assert.deepEqual([signed.version, signed.yml], ['2.6.1', { file: yml, matches: true, written: true }], 'the version of latest.yml wins over package.json');
  const info = require('js-yaml').load(fs.readFileSync(yml, 'utf8'));
  assert.deepEqual([info.version, info.sha512, info.files[0].sha512, info.signature], ['2.6.1', sum, sum, signed.signature]);
  assert.deepEqual(checkSignature(info, { key, platform: 'win32', arch: 'x64' }), { ok: true, sha512: sum }, 'what the launcher reads from that latest.yml passes its check');
  // Signing again replaces the line instead of adding a second one.
  await signInstaller(installer, { key: owner.privateKey, writeYml: true });
  assert.equal(fs.readFileSync(yml, 'utf8').match(/^signature:/gm).length, 1);
  assert.equal(withSignature('version: 1.0.0\nsignature: stary\n\n', 'nowy'), 'version: 1.0.0\nsignature: nowy\n');
  await assert.rejects(signInstaller(installer, { key: owner.privateKey, version: '2.6.2' }), /latest\.yml mówi o wersji 2\.6\.1/);
  // The installer changed after latest.yml was written.
  fs.appendFileSync(installer, 'x');
  await assert.rejects(signInstaller(installer, { key: owner.privateKey }), /opisuje inny plik/);
  fs.rmSync(yml);
  await assert.rejects(signInstaller(installer, { key: owner.privateKey, packageVersion: '2.6.1', writeYml: true }), /nie mam gdzie wpisać podpisu/);
  await assert.rejects(signInstaller(installer, { key: owner.privateKey }), /Nie wiem, którą wersję podpisać/);
  await assert.rejects(signInstaller(path.join(dir, 'nie-ma.exe'), { key: owner.privateKey }), /Nie ma takiego pliku/);
  await assert.rejects(signInstaller(installer, { key: '' }), /Brak klucza prywatnego/);

  // The command line: the key from the environment (CI) or from a file; without a key it says what to do.
  const lines = [];
  const out = (l) => lines.push(l);
  assert.equal(await signMain([installer], { env: {}, out }), 1);
  assert.match(lines.join('\n'), /Brak klucza prywatnego/);
  assert.equal(await signMain([installer, '--version', '2.6.1'], { env: { UPDATE_SIGNING_KEY: owner.privateKey }, out }), 0);
  fs.writeFileSync(path.join(dir, 'klucz.txt'), `${owner.privateKey}\n`);
  assert.equal(await signMain([installer, '--key', path.join(dir, 'klucz.txt'), '--version', '2.6.1'], { env: {}, out }), 0);
  assert.equal(await signMain([installer, '--key', path.join(dir, 'nie-ma.txt')], { env: {}, out }), 1);
  assert.equal(await signMain([], { env: {}, out }), 2);
  assert.ok(!lines.join('\n').includes(owner.privateKey), 'the private key is never printed');
  lines.length = 0;
  assert.equal(await signMain(['--new-key'], { env: {}, out }), 0);
  const printed = lines.map((l) => l.trim());
  const secret = printed.find((l) => /^MC4CAQAwBQYDK2VwBCIEI[A-Za-z0-9+/=]+$/.test(l)); // PKCS#8 DER of an Ed25519 key, in base64
  const pub = printed.find((l) => /^[A-Za-z0-9+/]{43}=$/.test(l));
  assert.equal(verifyRelease({ version: '1.0.0', sha512: sum, signature: signRelease({ version: '1.0.0', sha512: sum }, secret) }, publicKey(pub)), true, '--new-key prints a pair that works');
  assert.match(lines.join('\n'), /UPDATE_SIGNING_KEY/);
  assert.match(lines.join('\n'), /updatePublicKey/);
});

test('updatePublicKey set: only an update with the owner\'s signature is downloaded – the rest is refused and logged', async () => {
  const owner = newKeyPair();
  const info = latest('2.6.1');
  const signature = signRelease({ version: '2.6.1', sha512: info.sha512 }, owner.privateKey);
  const hashFile = async () => info.sha512;

  // No signature in latest.yml.
  const unsigned = setup({ publicKey: owner.publicKey, hashFile });
  unsigned.updater.answer = { info };
  await unsigned.self.check();
  assert.deepEqual([unsigned.self.status().status, unsigned.self.status().error, unsigned.updater.downloads], ['error', TEXT.unsigned('2.6.1'), 0]);
  assert.match(unsigned.self.status().error, /^Aktualizacja 2\.6\.1 nie ma podpisu HammerShop, więc launcher jej nie zainstaluje\./);
  assert.ok(unsigned.logs.some((l) => /REFUSED update 2\.6\.1: latest\.yml has no signature/.test(l)));
  assert.throws(() => unsigned.self.download(), /Nie ma teraz aktualizacji do pobrania/);
  assert.throws(() => unsigned.self.install(), /nie jest jeszcze pobrana/);
  assert.equal(unsigned.self.installOnQuit(0), false);

  // Signed by somebody else, or for another version / another file.
  for (const bad of [signRelease({ version: '2.6.1', sha512: info.sha512 }, newKeyPair().privateKey), signRelease({ version: '2.6.2', sha512: info.sha512 }, owner.privateKey), signRelease({ version: '2.6.1', sha512: sha('other') }, owner.privateKey), 'podpis']) {
    const s = setup({ publicKey: owner.publicKey, hashFile });
    s.updater.answer = { info: { ...info, signature: bad } };
    await s.self.check();
    assert.deepEqual([s.self.status().status, s.self.status().error, s.updater.downloads], ['error', TEXT.invalid('2.6.1'), 0], bad.slice(0, 12));
    assert.ok(s.logs.some((l) => /REFUSED update 2\.6\.1: the signature is not valid/.test(l)));
  }

  // The owner's signature: the usual round.
  const good = setup({ publicKey: owner.publicKey, hashFile });
  good.updater.answer = { info: { ...info, signature } };
  await good.self.check();
  assert.deepEqual([good.self.status().status, good.updater.downloads], ['downloading', 1]);
  good.updater.finish({ ...info, signature });
  await tick();
  assert.equal(good.self.status().status, 'ready');
  good.self.install();
  assert.deepEqual(good.updater.quits, [[true, true]]);

  // The file that arrived is not the signed one (whatever the updater thinks): it is not installed.
  const swapped = setup({ publicKey: owner.publicKey, hashFile: async () => sha('something else') });
  swapped.updater.answer = { info: { ...info, signature } };
  await swapped.self.check();
  swapped.updater.finish({ ...info, signature });
  await tick();
  assert.deepEqual([swapped.self.status().status, swapped.self.status().error], ['error', TEXT.invalid('2.6.1')]);
  assert.throws(() => swapped.self.install(), /nie jest jeszcze pobrana/);
  assert.equal(swapped.self.installOnQuit(0), false);
  assert.deepEqual([swapped.updater.quits, swapped.updater.installs], [[], []]);
  // …and neither when the file cannot be read back.
  const unreadable = setup({
    publicKey: owner.publicKey,
    hashFile: async () => {
      throw new Error('EBUSY');
    },
  });
  unreadable.updater.answer = { info: { ...info, signature } };
  await unreadable.self.check();
  unreadable.updater.finish({ ...info, signature });
  await tick();
  assert.equal(unreadable.self.status().status, 'error');
  assert.equal(unreadable.self.installOnQuit(0), false);

  // A configured key that is no key refuses everything (and says so in the log) – it never falls back to "not enforced".
  const broken = setup({ publicKey: 'to-nie-jest-klucz', hashFile });
  assert.ok(broken.logs.some((l) => /updatePublicKey.*is not an Ed25519 key/.test(l)));
  broken.updater.answer = { info: { ...info, signature } };
  await broken.self.check();
  assert.deepEqual([broken.self.status().status, broken.updater.downloads], ['error', 0]);

  // Without a key nothing is enforced: a signature in latest.yml is simply not looked at.
  const free = setup({ publicKey: '' });
  free.updater.answer = { info: { ...info, signature: 'cokolwiek' } };
  await free.self.check();
  assert.equal(free.self.status().status, 'downloading');
});

/* ── „Wymagana aktualizacja” ── */

test('required update: minVersion newer than this launcher – by numbers; an offline shop never blocks', () => {
  const release = (minVersion, version = '2.10.0') => ({ version, minVersion, notes: null, url: 'https://hammershop.pl/launcher' });
  const must = (current, r, ok = true) => requiredUpdate({ current, release: r, ok });
  assert.deepEqual(must('2.6.0', release('2.6.1')), { version: '2.10.0', minVersion: '2.6.1' });
  assert.deepEqual(must('2.9.9', release('2.10.0')), { version: '2.10.0', minVersion: '2.10.0' }, '2.10 is newer than 2.9 – numbers, not letters');
  assert.equal(must('2.10.0', release('2.9.0')), null);
  assert.equal(must('2.6.0', release('2.6.0')), null, 'exactly the minimum is still supported');
  assert.equal(must('2.6.1', release('2.6.0')), null);
  assert.equal(must('2.6.0', release(null)), null);
  assert.equal(must('2.6.0', release(undefined)), null);
  assert.equal(must('2.6.0', release('wkrótce')), null, 'a minVersion that is no version blocks nobody');
  assert.equal(must('2.6.0', null), null);
  assert.equal(must('2.6.0', undefined), null);
  // The shop is offline (its last answer did not come): nothing is ever blocked.
  assert.equal(must('2.6.0', release('2.6.1'), false), null);
  assert.equal(requiredUpdate({ current: '2.6.0', release: release('2.6.1') }), null);
  assert.equal(requiredUpdate(), null);
  // A mistake on the server – a minimum above the newest release, or a "release" that is not newer – blocks nobody.
  assert.equal(must('2.6.0', release('2.7.0', '2.6.5')), null);
  assert.equal(must('2.6.0', release('2.6.1', '2.6.0')), null);
  assert.equal(must('2.6.0', release('2.6.1', 'x')), null);
  // A test version of the minimum itself is below the minimum.
  assert.deepEqual(must('2.7.0-beta.1', release('2.7.0', '2.7.0')), { version: '2.7.0', minVersion: '2.7.0' });
});

test('required update: the look starts at once, „Zaktualizuj teraz” goes straight into the installer – unless a game runs', async () => {
  const { self, updater, world } = setup();
  const info = latest('2.6.1');
  updater.answer = { info };
  world.auto = false; // even with automatic updates off the required one can be fetched with one click
  const release = { version: '2.6.1', notes: 'Ważna poprawka logowania.', url: 'https://hammershop.pl/launcher', minVersion: '2.6.1', size: null, date: null };
  const state = self.setRelease(release, true);
  assert.deepEqual(state.required, { version: '2.6.1', minVersion: '2.6.1' });
  await tick();
  assert.deepEqual([updater.checks, self.status().status, updater.downloads], [1, 'available', 0], 'it does not wait four hours for the next look');
  self.setRelease(release, true);
  await tick();
  assert.equal(updater.checks, 1, 'the shop repeating itself does not start another look');
  assert.equal(self.status().notes, 'Ważna poprawka logowania.', 'the notes of the shop, when latest.yml has none');

  world.game = true;
  assert.throws(() => self.update(), new RegExp(TEXT.game));
  assert.equal(updater.downloads, 0);
  world.game = false;
  assert.equal(self.update().status, 'downloading');
  updater.finish(info);
  await tick();
  assert.deepEqual([self.status().status, updater.quits], ['ready', [[true, true]]], 'no second click needed');

  // The shop goes offline: nothing is blocked any more; it comes back: blocked again.
  assert.equal(self.setRelease(release, false).required, null);
  assert.deepEqual(self.setRelease(release, true).required, { version: '2.6.1', minVersion: '2.6.1' });
  assert.equal(self.setRelease(null, true).required, null);

  // Clicked before anything was found: look, download, install – in one go.
  const fresh = setup();
  fresh.updater.answer = { info };
  fresh.self.update();
  await tick();
  assert.deepEqual([fresh.statuses(), fresh.updater.checks, fresh.updater.downloads], [['checking', 'downloading'], 1, 1]);
  fresh.updater.finish(info);
  await tick();
  assert.deepEqual(fresh.updater.quits, [[true, true]]);
  // A game started while it downloaded: no restart, the update waits with its button.
  const late = setup();
  late.updater.answer = { info };
  late.self.update();
  await tick();
  late.world.game = true;
  late.updater.finish(info);
  await tick();
  assert.deepEqual([late.self.status().status, late.updater.quits], ['ready', []]);
  // The shop announces a version whose files are not on the update server (yet): said calmly, nothing loops.
  const missing = setup();
  missing.self.update();
  await tick();
  assert.deepEqual([missing.self.status().status, missing.self.status().error, missing.updater.checks], ['error', TEXT.missing, 1]);
});

test('services: playing is off while an update is required – and never when the shop does not answer', async () => {
  const shop = { online: true, release: { version: '2.7.0', notes: 'Nowości.', date: '2026-11-12T10:00:00.000Z', minVersion: '2.6.5', size: 257000000, url: 'https://hammershop.pl/launcher' } };
  const fetchFn = mockFetch([{ match: (url) => /\/api\/launcher\/news$/.test(url) && shop.online, json: () => ({ news: [], alert: null, release: shop.release }) }]);
  const events = [];
  const clock = { now: 1_800_000_000_000 };
  const s = createServices({ root: tmpDir(), config: { website: 'https://hammershop.pl' }, accounts: { launchAuth: async () => Promise.reject(new Error('Zaloguj się kontem Microsoft.')) }, fetchFn, appVersion: '2.6.0', now: () => clock.now, emit: (channel, payload) => events.push({ channel, payload }) });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  // Before the shop said anything nothing is blocked (the start goes on to the login).
  await assert.rejects(s.launch(instance.id), /Zaloguj się kontem Microsoft/);
  // „Sprawdź teraz” on a build that cannot update itself asks the shop, and tells.
  const state = await s.selfUpdate.check();
  assert.deepEqual([state.status, state.reason, state.release.version, state.release.url, state.required], ['unsupported', 'dev', '2.7.0', 'https://hammershop.pl/launcher', { version: '2.7.0', minVersion: '2.6.5' }]);
  assert.deepEqual(events.filter((e) => e.channel === 'selfupdate:state').at(-1).payload.required, { version: '2.7.0', minVersion: '2.6.5' });
  await assert.rejects(s.launch(instance.id), /Ta wersja launchera nie jest już wspierana\. Zaktualizuj launcher, żeby grać dalej\./);
  await assert.rejects(s.benchmark.start(instance.id, { world: 'x' }), /.+/);
  await assert.rejects(s.selfUpdate.update(), /nie aktualizuje się sama/);
  // The shop stops answering: playing works again.
  shop.online = false;
  clock.now += 61_000;
  await s.news.refresh();
  assert.equal(s.selfUpdate.status().required, null);
  await assert.rejects(s.launch(instance.id), /Zaloguj się kontem Microsoft/);
  // It is back, and this launcher is new enough.
  shop.online = true;
  shop.release = { ...shop.release, minVersion: '2.6.0' };
  clock.now += 61_000;
  await s.news.refresh();
  assert.deepEqual([s.selfUpdate.status().required, s.selfUpdate.status().release.version], [null, '2.7.0']);
  await assert.rejects(s.launch(instance.id), /Zaloguj się kontem Microsoft/);
});

test('services: the switch „Aktualizuj automatycznie” and a running game reach the updater', async () => {
  const updater = fakeUpdater();
  const events = [];
  const s = createServices({ root: tmpDir(), config: { website: 'https://hammershop.pl' }, accounts: {}, fetchFn: async () => Promise.reject(new TypeError('offline')), appVersion: '2.6.0', updater, updateSupport: SUPPORTED, emit: (channel, payload) => events.push({ channel, payload }) });
  assert.deepEqual(updater.feed, { provider: 'generic', url: 'https://hammershop.pl/updates' });
  assert.match(updater.requestHeaders['User-Agent'], /^Hammer-Launcher\/2\.6\.0 /);
  assert.equal(s.settings.get().autoUpdate, true, 'on by default');
  s.settings.set({ autoUpdate: false });
  const info = latest('2.6.1');
  updater.answer = { info };
  assert.deepEqual([(await s.selfUpdate.check()).status, s.selfUpdate.status().auto], ['available', false]);
  s.settings.set({ autoUpdate: true });
  assert.equal(s.selfUpdate.status().status, 'downloading');
  updater.finish(info);
  await tick();
  assert.equal(s.selfUpdate.status().status, 'ready');
  // A game runs: no restart, and closing the launcher installs nothing.
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  s.games.running.set(instance.id, { process: { kill() {} }, startedAt: Date.now(), logs: [] });
  s.games.emit('state', { instanceId: instance.id, state: 'running' });
  assert.equal(events.filter((e) => e.channel === 'selfupdate:state').at(-1).payload.gameRunning, true);
  await assert.rejects(s.selfUpdate.install(), /Najpierw zamknij grę/);
  assert.equal(s.selfUpdate.installOnQuit(0), false);
  s.games.running.delete(instance.id);
  s.games.emit('state', { instanceId: instance.id, state: 'exited', playedMs: 0 });
  await s.selfUpdate.install();
  assert.deepEqual(updater.quits, [[true, true]]);
});
