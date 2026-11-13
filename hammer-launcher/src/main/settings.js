'use strict';

/** Launcher settings (settings.json). Every setting has a default, so new versions add settings safely. */

const { readJson, writeJson } = require('./store');
const { freeCapes } = require('./capes');
/** Capes everybody may wear – picking one of them needs no Hammer+ (capes.json → free). */
const FREE_CAPES = freeCapes();

const DEFAULT_SETTINGS = Object.freeze({
  memoryMb: null, // null = picked automatically from the computer's RAM and the number of mods
  jvmPreset: 'recommended', // recommended | zgc | vanilla | custom
  customJvmArgs: '',
  javaPath: '', // empty = Java downloaded from Mojang for each game version
  afterLaunch: 'hide', // hide | minimize | keep – what the launcher window does while the game runs
  processPriority: 'above_normal', // normal | above_normal | high
  resolution: { width: 1280, height: 720, fullscreen: false },
  showSnapshots: false,
  discordRpc: true,
  gpuPreference: true, // Windows: ask for the faster graphics card for Java (laptops with two GPUs)
  concurrentDownloads: 16,
  selectedInstance: null,
  selectedAccount: null,
  closeOnExit: false,
  accent: 'orange', // the launcher's colour: orange | gold | red | blue | green | purple – or custom (Hammer+)
  playSummary: true, // the „Podsumowanie gry” card on the start screen after a game session
  modUpdateCheck: true, // look for mod updates in the background (when the launcher starts and every six hours)
  screenshotShareAsk: true, // ask before a screenshot is uploaded for a link („Nie pytaj ponownie” switches it off)
  language: 'auto', // the launcher's language: auto (the system's: Polish for pl, English otherwise) | pl | en – see i18n.js
  autoUpdate: true, // „Aktualizuj automatycznie”: fetch a new launcher version in the background (off = only tell that there is one)
  startWithSystem: true, // Windows: the launcher starts with the system, in the tray – updates arrive before it is even opened
  closeToTray: true, // Windows: the window's close button leaves the launcher in the tray (it updates itself there)
  seenVersion: '', // the launcher version whose „Co nowego” the player has seen ('' = not known yet)
  updateNotes: null, // { version, notes }: „Co nowego” of the update that was downloaded – shown after it is installed
  closedAlert: '', // the id of the shop's message the player closed – it stays closed until the shop sends another one
  newsSeenAt: 0, // the time (`at`) of the newest news item the home screen has shown – newer ones get the „nowe” dot
  // Hammer+ (the values below only work while Hammer+ is active – see PLUS_ONLY)
  accentColor: '', // "#rrggbb" for accent: 'custom'
  background: '', // the player's own background picture: a file name in <launcher folder>/theme/
  heroStyle: 'classic', // classic | aurora | forge | stars – the animated background
  autoBackup: false, // back up the worlds played after each game session
  autoBackupKeep: 5, // automatic backups kept per world (1–20)
  hammerCape: '', // the cape Hammer Client draws: an id from capes.json, or 'custom' (Hammer+: the player's own picture)
  capeOn: true, // the cape switch: off = no cape at all (neither Hammer nor Mojang)
  lastMojangCape: '', // the Mojang cape that was on when the switch went off – it comes back when it goes on
  cloudAuto: false, // cloud copy: fetch at start, send after each game session
});

const PRESETS = ['recommended', 'zgc', 'vanilla', 'custom'];
const AFTER = ['hide', 'minimize', 'keep'];
const PRIORITY = ['normal', 'above_normal', 'high'];
const ACCENTS = ['orange', 'gold', 'red', 'blue', 'green', 'purple'];
const HERO_STYLES = ['classic', 'aurora', 'forge', 'stars'];
const LANGUAGES = ['auto', 'pl', 'en'];

/**
 * Settings only Hammer+ may switch on: key → [is this the free value?, what the feature is called in a message].
 * Switching one off is always allowed, so nobody is stuck with a setting after Hammer+ ends.
 */
const PLUS_ONLY = {
  accent: [(v) => v !== 'custom', 'Własny kolor launchera'],
  background: [(v) => !v, 'Własne tło launchera'],
  heroStyle: [(v) => v === 'classic', 'Animowane tło'],
  autoBackup: [(v) => !v, 'Automatyczne kopie światów'],
  hammerCape: [(v) => !v || FREE_CAPES.has(v), 'Peleryny Hammer+'],
  cloudAuto: [(v) => !v, 'Automatyczna synchronizacja z chmurą'],
};

function clampInt(v, min, max, fallback) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

/** Keeps only known keys with valid values. */
function sanitize(patch, base = DEFAULT_SETTINGS) {
  const out = { ...base };
  if ('memoryMb' in patch) out.memoryMb = patch.memoryMb == null ? null : clampInt(patch.memoryMb, 1024, 65536, base.memoryMb);
  if (PRESETS.includes(patch.jvmPreset)) out.jvmPreset = patch.jvmPreset;
  if (typeof patch.customJvmArgs === 'string') out.customJvmArgs = patch.customJvmArgs.slice(0, 2000);
  if (typeof patch.javaPath === 'string') out.javaPath = patch.javaPath.trim();
  if (AFTER.includes(patch.afterLaunch)) out.afterLaunch = patch.afterLaunch;
  if (PRIORITY.includes(patch.processPriority)) out.processPriority = patch.processPriority;
  if (patch.resolution && typeof patch.resolution === 'object') {
    out.resolution = {
      width: clampInt(patch.resolution.width, 640, 7680, base.resolution.width),
      height: clampInt(patch.resolution.height, 480, 4320, base.resolution.height),
      fullscreen: Boolean(patch.resolution.fullscreen),
    };
  }
  if (ACCENTS.includes(patch.accent) || patch.accent === 'custom') out.accent = patch.accent;
  if (LANGUAGES.includes(patch.language)) out.language = patch.language;
  if (typeof patch.accentColor === 'string' && /^(#[0-9a-f]{6})?$/i.test(patch.accentColor)) out.accentColor = patch.accentColor.toLowerCase();
  if (typeof patch.background === 'string' && /^(background-[0-9a-f]{8}\.(png|jpg|webp))?$/.test(patch.background)) out.background = patch.background;
  if (HERO_STYLES.includes(patch.heroStyle)) out.heroStyle = patch.heroStyle;
  if ('autoBackupKeep' in patch) out.autoBackupKeep = clampInt(patch.autoBackupKeep, 1, 20, base.autoBackupKeep);
  if (typeof patch.hammerCape === 'string' && /^[a-z0-9_-]{0,32}$/.test(patch.hammerCape)) out.hammerCape = patch.hammerCape;
  if (typeof patch.lastMojangCape === 'string' && /^[A-Za-z0-9_-]{0,64}$/.test(patch.lastMojangCape)) out.lastMojangCape = patch.lastMojangCape;
  for (const key of ['showSnapshots', 'discordRpc', 'gpuPreference', 'closeOnExit', 'autoBackup', 'cloudAuto', 'playSummary', 'modUpdateCheck', 'screenshotShareAsk', 'autoUpdate', 'startWithSystem', 'closeToTray', 'capeOn']) if (key in patch) out[key] = Boolean(patch[key]);
  if (typeof patch.seenVersion === 'string' && /^(\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z.-]{1,40})?)?$/.test(patch.seenVersion)) out.seenVersion = patch.seenVersion;
  if ('updateNotes' in patch) {
    const n = patch.updateNotes;
    out.updateNotes = n && typeof n === 'object' && typeof n.version === 'string' && /^\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z.-]{1,40})?$/.test(n.version) ? { version: n.version, notes: typeof n.notes === 'string' ? n.notes.slice(0, 4000) : null } : null;
  }
  if (typeof patch.closedAlert === 'string' && /^[A-Za-z0-9_.:-]{0,64}$/.test(patch.closedAlert)) out.closedAlert = patch.closedAlert;
  if ('newsSeenAt' in patch) out.newsSeenAt = clampInt(patch.newsSeenAt, 0, 1e14, base.newsSeenAt);
  if ('concurrentDownloads' in patch) out.concurrentDownloads = clampInt(patch.concurrentDownloads, 1, 64, base.concurrentDownloads);
  for (const key of ['selectedInstance', 'selectedAccount']) if (key in patch) out[key] = patch[key] ? String(patch[key]) : null;
  return out;
}

/** The Hammer+ features a change would switch on: the names of the settings that go from `before` to a paid value. */
function plusOnly(before, next) {
  return Object.entries(PLUS_ONLY)
    .filter(([key, [free]]) => next[key] !== before[key] && !free(next[key]))
    .map(([, [, label]]) => label);
}

function createSettings(file) {
  let current = sanitize(readJson(file, {}));
  return {
    get: () => structuredClone(current),
    set(patch) {
      current = sanitize(patch ?? {}, current);
      writeJson(file, current);
      return structuredClone(current);
    },
  };
}

module.exports = { createSettings, sanitize, plusOnly, DEFAULT_SETTINGS, ACCENTS, HERO_STYLES, LANGUAGES, PLUS_ONLY };
