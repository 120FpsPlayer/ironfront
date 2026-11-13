'use strict';

/**
 * The launcher updates itself – from the owner's own server, through electron-updater's "generic" provider:
 *
 *   <updates base>/latest.yml        the standard electron-builder file (version, files, sha512, releaseDate…)
 *   <updates base>/<installer>       the installer it names, with its optional .blockmap next to it
 *
 * updates base = launcher.config.json → updateUrl, or <shopApi or website>/updates when that is empty. Only
 * https (plain http only for a server on this computer). No base → the feature is off and nothing errors.
 *
 * Only the installed Windows build (NSIS) and the AppImage can replace themselves. Everywhere else – the
 * portable exe, a development run, other Linux packages, macOS – the launcher only tells that a newer version
 * exists (the `release` of the shop's /news answer, see news.js) and offers the page to download it from.
 *
 * latest.yml may carry one extra field, `signature`: the base64 Ed25519 signature of the text
 * "<version>\n<sha512 of the installer, exactly as in latest.yml>". With launcher.config.json → updatePublicKey
 * set (base64 of the raw 32-byte key, like plusPublicKey) an update is downloaded and installed only when that
 * signature is right; without the key nothing is enforced. The launcher only ever holds the public key –
 * scripts/sign-release.js signs with the private one.
 *
 * No Electron here: the real autoUpdater, the timers and the clock come in from main.js; the tests bring fakes.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');
const { publicKey } = require('./plus');
const { block } = require('./text');

const FIRST_CHECK = 6000; // after the window is shown
const CHECK_EVERY = 60 * 60 * 1000; // the launcher may sit in the tray all day: one small latest.yml an hour
const MAX_NOTES = 2000;

/* ── versions ── */

const VERSION = /^v?(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** "2.6.1" → { numbers: [2, 6, 1], pre: [] }; "2.7.0-beta.2" → pre: ['beta', '2']. null when it is not a version. */
function parseVersion(text) {
  const m = typeof text === 'string' ? VERSION.exec(text.trim()) : null;
  return m ? { numbers: [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)], pre: m[4] ? m[4].split('.') : [] } : null;
}

/**
 * Which version is newer – by numbers, not by letters: 2.10.0 is newer than 2.9.9. A test version (2.6.0-beta.1)
 * is older than the same version without the suffix. 1 = a is newer, -1 = b is newer, 0 = the same;
 * null when one of them is not a version at all.
 */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i += 1) if (x.numbers[i] !== y.numbers[i]) return x.numbers[i] > y.numbers[i] ? 1 : -1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === q) continue;
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn) return Number(p) > Number(q) ? 1 : -1;
    if (pn !== qn) return pn ? -1 : 1;
    return p > q ? 1 : -1;
  }
  return 0;
}

/** a is a version newer than b (false when either is not a version). */
const isNewer = (a, b) => compareVersions(a, b) === 1;

/* ── where updates come from, and which builds can take them ── */

const allowedBase = (url) => /^https:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s?#]*)?$/.test(url);

/** The folder with latest.yml: updateUrl, else "<shopApi or website>/updates" – '' when there is none or it is not https. */
function updatesBase(config = {}) {
  const own = String(config.updateUrl ?? '').trim();
  const site = String(config.shopApi || config.website || '').trim().replace(/\/+$/, '');
  const url = (own || (site ? `${site}/updates` : '')).replace(/\/+$/, '');
  return allowedBase(url) ? url : '';
}

/**
 * Can this build replace itself? { supported, reason } – reason says why not: 'dev' (not a built app), 'portable'
 * (the portable exe unpacks itself into a temporary folder), 'package' (a Linux build that is not an AppImage),
 * 'platform' (macOS and the rest), 'config' (built without the updater's app-update.yml).
 */
function updateSupport({ platform = process.platform, packaged = false, portable = false, appImage = false, hasConfig = true } = {}) {
  if (!packaged) return { supported: false, reason: 'dev' };
  if (platform === 'win32') {
    if (portable) return { supported: false, reason: 'portable' };
  } else if (platform === 'linux') {
    if (!appImage) return { supported: false, reason: 'package' };
  } else return { supported: false, reason: 'platform' };
  return hasConfig ? { supported: true, reason: null } : { supported: false, reason: 'config' };
}

/* ── signed updates ── */

/** The text an update's signature is made over. */
const signedText = (version, sha512) => `${version}\n${sha512}`;

/**
 * The file of latest.yml that electron-updater downloads on this system – the .exe on Windows, the .AppImage on
 * Linux (the one for this processor when there are several) – as { url, sha512 }. null when there is none.
 */
function updateFile(info, { platform = process.platform, arch = process.arch } = {}) {
  const listed = Array.isArray(info?.files) && info.files.length ? info.files : typeof info?.path === 'string' ? [{ url: info.path, sha512: info.sha512 }] : [];
  const files = listed.filter((f) => f && typeof f.url === 'string' && f.url);
  if (!files.length) return null;
  const pathOf = (f) => {
    try {
      return new URL(f.url, 'https://updates.invalid/').pathname.toLowerCase();
    } catch {
      return f.url.toLowerCase();
    }
  };
  const ext = platform === 'win32' ? '.exe' : '.appimage';
  const fitting = files.filter((f) => pathOf(f).endsWith(ext));
  const other = platform === 'win32' ? files[0] : files.find((f) => !['.rpm', '.deb', '.pacman'].some((e) => pathOf(f).endsWith(e)));
  const file = fitting.find((f) => pathOf(f).includes(arch) || f.url.includes(arch)) ?? fitting[0] ?? other;
  return file && typeof file.sha512 === 'string' && file.sha512 ? { url: file.url, sha512: file.sha512 } : null;
}

/** Whether `signature` (base64) is the owner's signature of this version and checksum. `key` comes from plus.js → publicKey(). */
function verifyRelease({ version, sha512, signature } = {}, key) {
  if (!key || typeof version !== 'string' || typeof sha512 !== 'string' || typeof signature !== 'string' || !version || !sha512) return false;
  const text = signature.trim();
  if (!/^[A-Za-z0-9+/_-]{86}(==)?$/.test(text)) return false; // 64 bytes
  try {
    const raw = Buffer.from(text, 'base64');
    return raw.length === 64 && crypto.verify(null, Buffer.from(signedText(version, sha512), 'utf8'), key, raw);
  } catch {
    return false;
  }
}

/**
 * The signature of an update as latest.yml describes it: { ok: true, sha512 } – or { ok: false, reason }:
 * 'no-file' (nothing to download for this system), 'unsigned' (no signature at all), 'invalid' (not the owner's).
 */
function checkSignature(info, { key, platform, arch } = {}) {
  const file = updateFile(info, { platform, arch });
  if (!file || typeof info?.version !== 'string') return { ok: false, reason: 'no-file' };
  if (typeof info.signature !== 'string' || !info.signature.trim()) return { ok: false, reason: 'unsigned' };
  return verifyRelease({ version: info.version, sha512: file.sha512, signature: info.signature }, key) ? { ok: true, sha512: file.sha512 } : { ok: false, reason: 'invalid' };
}

/** The SHA-512 of a file as base64 – the form electron-builder writes into latest.yml. */
function sha512File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('base64')));
  });
}

/* ── „Wymagana aktualizacja” ── */

/**
 * The shop says that versions below `minVersion` are no longer supported – and this one is below:
 * { version, minVersion }, else null. Only the shop's last answer counts (`ok`): while it is offline nothing is
 * ever blocked. A minVersion that the announced release itself does not reach is a mistake on the server and
 * blocks nobody.
 */
function requiredUpdate({ current, release, ok } = {}) {
  if (!ok || !release || typeof release.minVersion !== 'string') return null;
  if (!isNewer(release.minVersion, current) || !isNewer(release.version, current)) return null;
  if (compareVersions(release.version, release.minVersion) === -1) return null;
  return { version: release.version, minVersion: release.minVersion };
}

/* ── the texts ── */

const TEXT = {
  check: 'Nie udało się sprawdzić aktualizacji launchera. Spróbuję ponownie później.',
  download: 'Nie udało się pobrać aktualizacji launchera. Spróbuję ponownie później.',
  install: 'Nie udało się uruchomić instalatora aktualizacji. Spróbuj ponownie albo pobierz launcher ze strony.',
  missing: 'Na serwerze nie ma jeszcze plików tej aktualizacji. Spróbuj ponownie za chwilę.',
  game: 'Najpierw zamknij grę – aktualizacja uruchamia launcher ponownie.',
  here: 'Ta wersja launchera nie aktualizuje się sama.',
  nothing: 'Nie ma teraz aktualizacji do pobrania – kliknij „Sprawdź teraz”.',
  notReady: 'Aktualizacja nie jest jeszcze pobrana.',
  unsigned: (v) => `Aktualizacja ${v} nie ma podpisu HammerShop, więc launcher jej nie zainstaluje. Jeśli to się powtarza, daj nam znać na Discordzie.`,
  invalid: (v) => `Aktualizacja ${v} ma nieprawidłowy podpis, więc launcher jej nie zainstaluje. Jeśli to się powtarza, daj nam znać na Discordzie.`,
};

/** „Co nowego” from latest.yml (releaseNotes: a text, or a list of { version, note }) as plain text – null without any. */
function notesOf(info) {
  const raw = info?.releaseNotes;
  const text = Array.isArray(raw) ? raw.map((n) => (typeof n?.note === 'string' ? n.note : '')).filter(Boolean).join('\n\n') : raw;
  return block(typeof text === 'string' ? text.replace(/<[^>]{0,200}>/g, '') : '', MAX_NOTES) || null;
}

/**
 * @param {object} o
 * @param {object|null} o.updater     electron-updater's autoUpdater (main.js loads it only on builds that can update)
 * @param {string} o.version          the running launcher
 * @param {string} o.feedUrl          updatesBase(config) – '' switches the feature off
 * @param {{supported: boolean, reason: string|null}} o.support   updateSupport(…)
 * @param {string} [o.publicKey]      launcher.config.json → updatePublicKey ('' = signatures are not enforced)
 * @param {() => boolean} [o.gameRunning]   a game started by the launcher is running (or being started)
 * @param {() => boolean} [o.autoUpdate]    the setting „Aktualizuj automatycznie”
 * @param {(state: object) => void} [o.onChange]   the state changed (see status())
 * @param {(line: string) => void} [o.log]
 */
function createSelfUpdate({
  updater = null,
  version,
  feedUrl = '',
  support = { supported: false, reason: 'dev' },
  publicKey: keyText = '',
  gameRunning = () => false,
  autoUpdate = () => true,
  onChange = () => {},
  log = () => {},
  now = () => Date.now(),
  timers = {
    set: (fn, ms) => {
      const t = setTimeout(fn, ms);
      t.unref?.();
      return t;
    },
    clear: (t) => clearTimeout(t),
  },
  hashFile = sha512File,
  platform = process.platform,
  arch = process.arch,
  userAgent = null,
  firstDelay = FIRST_CHECK,
  interval = CHECK_EVERY,
} = {}) {
  const enforce = Boolean(String(keyText ?? '').trim()); // a key is configured: unsigned updates are refused
  const key = enforce ? publicKey(keyText) : null; // (a configured key that is no key refuses everything)

  // off | unsupported | idle | checking | available | downloading | ready | error
  let status = !support?.supported ? 'unsupported' : feedUrl && updater ? 'idle' : 'off';
  let latest = null; // the version the updater found
  let percent = null;
  let notes = null;
  let error = null;
  let checkedAt = null;
  let upToDate = false;
  let pending = null; // the update that may be downloaded: found by the last check and – with a key – signed by the owner
  let phase = null; // 'check' | 'download': what the updater is doing, so an error can be told apart
  let wanted = false; // the player asked for this update – it is downloaded whatever the switch says
  let installWhenReady = false; // „Zaktualizuj teraz”: restart into the installer as soon as it is here
  let installing = false;
  let release = null; // what the shop's /news says about the newest version
  let shopOk = false;
  let kicked = null; // the required version a check was already started for
  let timer = null;
  let started = false;
  let last = null;

  const active = () => status !== 'off' && status !== 'unsupported';
  const playing = () => {
    try {
      return Boolean(gameRunning());
    } catch {
      return false;
    }
  };
  const auto = () => {
    try {
      return Boolean(autoUpdate());
    } catch {
      return true;
    }
  };

  /**
   * { status, supported, reason, current, latest, percent, notes, error, checkedAt, upToDate, auto, gameRunning,
   *   release: { version, notes, url, size, date } | null   – the shop's newest version, when it is newer than this one
   *   required: { version, minVersion } | null              – „Wymagana aktualizacja”: playing is off until then }
   */
  function snapshot() {
    const newer = release && isNewer(release.version, version) ? { version: release.version, notes: release.notes ?? null, url: release.url ?? null, size: release.size ?? null, date: release.date ?? null } : null;
    return {
      status,
      supported: Boolean(support?.supported),
      reason: support?.supported ? null : (support?.reason ?? 'dev'),
      current: version,
      latest,
      percent,
      notes: notes ?? (newer && (!latest || latest === newer.version) ? newer.notes : null),
      error,
      checkedAt,
      upToDate,
      auto: auto(),
      gameRunning: playing(),
      release: newer,
      required: requiredUpdate({ current: version, release, ok: shopOk }),
    };
  }

  function changed() {
    const state = snapshot();
    const text = JSON.stringify(state);
    if (text === last) return state;
    last = text;
    try {
      onChange(state);
    } catch {
      // a window that is gone must not stop an update
    }
    return state;
  }

  /* ── what the updater says ── */

  function onNone() {
    phase = null;
    checkedAt = now();
    if (status === 'ready') return changed(); // the installer that is here stays
    const asked = wanted || installWhenReady;
    wanted = false;
    installWhenReady = false;
    pending = null;
    latest = null;
    notes = null;
    percent = null;
    upToDate = true;
    // „Zaktualizuj teraz” was clicked for a version the shop announced, but its files are not on the server.
    status = asked ? 'error' : 'idle';
    error = asked ? TEXT.missing : null;
    return changed();
  }

  function refuse(found, reason) {
    pending = null;
    wanted = false;
    installWhenReady = false;
    log(`REFUSED update ${found}: ${reason === 'invalid' ? 'the signature is not valid' : reason === 'unsigned' ? 'latest.yml has no signature' : 'latest.yml names no file with a checksum'} (updatePublicKey is set)`);
    latest = found;
    upToDate = false;
    percent = null;
    status = 'error';
    error = reason === 'invalid' ? TEXT.invalid(found) : TEXT.unsigned(found);
    return changed();
  }

  function onAvailable(info) {
    phase = null;
    checkedAt = now();
    const found = typeof info?.version === 'string' && parseVersion(info.version) ? info.version.trim() : null;
    if (!found) return onError(new Error('latest.yml without a version'), 'check');
    if (status === 'ready' && found === latest) return changed(); // found again by a later look: its installer is already here
    if (enforce) {
      const res = checkSignature(info, { key, platform, arch });
      if (!res.ok) return refuse(found, res.reason);
      pending = { version: found, sha512: res.sha512 };
    } else pending = { version: found, sha512: null };
    latest = found;
    notes = notesOf(info);
    upToDate = false;
    error = null;
    percent = null;
    status = 'available';
    log(`found version ${found}${enforce ? ' (signature valid)' : ''}`);
    if (auto() || wanted) return startDownload();
    return changed();
  }

  function onProgress(p) {
    if (status !== 'downloading') return;
    const n = Math.max(0, Math.min(100, Math.round(Number(p?.percent) || 0)));
    if (n === percent) return;
    percent = n;
    changed();
  }

  async function onDownloaded(info) {
    phase = null;
    const found = typeof info?.version === 'string' ? info.version.trim() : latest;
    if (enforce) {
      // Once more, with the file that will really be installed: its checksum must be the signed one.
      let ok = false;
      let reason = 'invalid';
      try {
        const res = checkSignature(info, { key, platform, arch });
        if (!res.ok) reason = res.reason;
        else ok = typeof info.downloadedFile === 'string' && (await hashFile(info.downloadedFile)) === res.sha512;
      } catch (err) {
        log(`the downloaded file could not be checked: ${String(err?.message ?? err).slice(0, 200)}`);
      }
      if (!ok) return refuse(found, reason);
    }
    latest = found;
    percent = null;
    error = null;
    upToDate = false;
    status = 'ready';
    log(`update ${found} is downloaded${enforce ? ' and verified' : ''}`);
    changed();
    if (installWhenReady) {
      installWhenReady = false;
      if (!playing()) {
        try {
          install();
        } catch (err) {
          log(`the installer could not be started: ${String(err?.message ?? err).slice(0, 200)}`);
        }
      }
    }
    return snapshot();
  }

  function onError(err, forced = null) {
    const was = forced ?? phase;
    phase = null;
    log(`error (${was ?? 'idle'}): ${err?.code ? `${err.code} ` : ''}${String(err?.message ?? err).split('\n')[0].slice(0, 300)}`);
    if (!was) {
      // Not while checking or downloading: the installer could not be started.
      if (!installing) return snapshot();
      installing = false;
      error = TEXT.install;
      return changed();
    }
    // Nothing is published for this kind of build (yet) – that is "no update", not a failure.
    if (was === 'check' && err?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND') return onNone();
    if (was === 'check' && status === 'ready') return changed(); // a later look that failed takes nothing away
    wanted = false;
    installWhenReady = false;
    if (was === 'download') pending = null;
    percent = null;
    status = 'error';
    error = was === 'download' ? TEXT.download : TEXT.check;
    return changed();
  }

  if (active()) {
    try {
      updater.autoDownload = false; // first the signature, then the download
      // Installing when the launcher closes is done here (installOnQuit) – it must never happen under a running game.
      updater.autoInstallOnAppQuit = false;
      updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      updater.logger = { info: (m) => log(String(m)), warn: (m) => log(`warning: ${m}`), error: (m) => log(`error: ${String(m).split('\n')[0]}`), debug() {} };
      if (userAgent) updater.requestHeaders = { 'User-Agent': userAgent };
      updater.setFeedURL({ provider: 'generic', url: feedUrl });
      updater.on('update-not-available', () => onNone());
      updater.on('update-available', (info) => onAvailable(info));
      updater.on('download-progress', (p) => onProgress(p));
      updater.on('update-downloaded', (info) => onDownloaded(info).catch((err) => onError(err, 'download')));
      updater.on('error', (err) => onError(err));
    } catch (err) {
      log(`updates are off: ${String(err?.message ?? err).slice(0, 200)}`);
      status = 'off';
    }
    if (enforce && !key) log('updatePublicKey in launcher.config.json is not an Ed25519 key - every update will be refused');
  }

  /* ── what the launcher does ── */

  /** Asks the server for latest.yml now. Never throws; answers the state after the look. */
  async function check() {
    if (!active() || status === 'checking' || status === 'downloading') return snapshot();
    phase = 'check';
    if (status !== 'ready') {
      status = 'checking';
      error = null;
      changed();
    }
    try {
      await updater.checkForUpdates();
    } catch (err) {
      if (phase === 'check') onError(err); // (the updater also says it as an 'error' event – whichever comes first counts)
    }
    if (phase === 'check') {
      // The updater answered nothing at all (it considers itself switched off).
      phase = null;
      if (status === 'checking') status = 'idle';
      changed();
    }
    return snapshot();
  }

  function startDownload() {
    phase = 'download';
    status = 'downloading';
    percent = 0;
    error = null;
    changed();
    // (a failed download is also reported as an 'error' event – whichever comes first counts)
    const failed = (err) => (phase === 'download' ? onError(err) : null);
    try {
      Promise.resolve(updater.downloadUpdate()).catch(failed);
    } catch (err) {
      failed(err);
    }
    return snapshot();
  }

  /** „Pobierz i zainstaluj” (automatic updates switched off): fetches the update that was found. */
  function download() {
    if (!active()) throw new Error(TEXT.here);
    if (status === 'downloading' || status === 'ready') return snapshot();
    if (status !== 'available' || !pending) throw new Error(TEXT.nothing);
    wanted = true;
    return startDownload();
  }

  /** „Uruchom ponownie i zaktualizuj”: closes the launcher, installs quietly and starts it again. Never under a running game. */
  function install() {
    if (!active()) throw new Error(TEXT.here);
    if (status !== 'ready') throw new Error(TEXT.notReady);
    if (playing()) throw new Error(TEXT.game);
    installing = true;
    log(`installing ${latest} (restart)`);
    try {
      updater.quitAndInstall(true, true);
    } catch (err) {
      installing = false;
      log(`the installer could not be started: ${String(err?.message ?? err).slice(0, 200)}`);
      throw new Error(TEXT.install, { cause: err });
    }
    return snapshot();
  }

  /**
   * „Zaktualizuj teraz” (the required-update window): whatever is still missing – the look, the download – and
   * then straight into the installer.
   */
  function update() {
    if (!active()) throw new Error(TEXT.here);
    if (playing()) throw new Error(TEXT.game);
    if (status === 'ready') return install();
    wanted = true;
    installWhenReady = true;
    if (status === 'available' && pending) return startDownload();
    if (status === 'idle' || status === 'error' || status === 'available') check();
    return snapshot();
  }

  /**
   * The launcher is closing (Electron's 'quit'): an update that is here installs now, quietly – but never while a
   * game started by the launcher still runs, and not when the launcher is going down with an error.
   */
  function installOnQuit(exitCode = 0) {
    if (!active() || status !== 'ready' || installing || exitCode !== 0 || playing()) return false;
    installing = true;
    try {
      log(`installing ${latest} as the launcher closes`);
      return updater.install(true, false) !== false;
    } catch (err) {
      log(`the installer could not be started: ${String(err?.message ?? err).slice(0, 200)}`);
      return false;
    }
  }

  /**
   * The launcher is in the background – no window open – and the update that is here installs quietly; the launcher
   * starts again in the tray (main.js decides when: no window, after the last game session's work). Never while a
   * game started by the launcher runs, never with automatic updates switched off. false = not now.
   */
  function installQuietly() {
    if (!active() || status !== 'ready' || installing || playing() || !auto()) return false;
    installing = true;
    log(`installing ${latest} in the background (no window, no game)`);
    try {
      updater.quitAndInstall(true, true);
      return true;
    } catch (err) {
      installing = false;
      log(`the installer could not be started: ${String(err?.message ?? err).slice(0, 200)}`);
      return false;
    }
  }

  /** What the shop's /news says about the newest version (`ok`: the shop answered just now). */
  function setRelease(next, ok) {
    release = next && typeof next === 'object' && parseVersion(next.version) ? next : null;
    shopOk = Boolean(ok);
    const state = changed();
    // A required update should not wait for the next round of checking.
    if (state.required && active() && (status === 'idle' || status === 'error') && kicked !== state.required.version) {
      kicked = state.required.version;
      check();
    }
    return state;
  }

  /** A game started or ended, or the „Aktualizuj automatycznie” switch moved. */
  function refresh() {
    if (active() && status === 'available' && pending && auto()) return startDownload();
    return changed();
  }

  function schedule(ms) {
    timers.clear(timer);
    timer = timers.set(async () => {
      await check();
      if (started) schedule(interval);
    }, ms);
  }

  return {
    status: snapshot,
    check,
    download,
    install,
    update,
    installOnQuit,
    installQuietly,
    setRelease,
    refresh,
    /** The first look a few seconds from now, then one every hour. Nothing happens on builds that cannot update. */
    start() {
      if (!active() || started) return;
      started = true;
      schedule(firstDelay);
    },
    stop() {
      started = false;
      timers.clear(timer);
      timer = null;
    },
  };
}

module.exports = { createSelfUpdate, parseVersion, compareVersions, isNewer, updatesBase, updateSupport, updateFile, signedText, verifyRelease, checkSignature, sha512File, requiredUpdate, notesOf, TEXT, FIRST_CHECK, CHECK_EVERY };
