'use strict';

/** Launcher settings (settings.json). Every setting has a default, so new versions add settings safely. */

const { readJson, writeJson } = require('./store');

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
  // Hammer+ (the values below only work while Hammer+ is active – see PLUS_ONLY)
  accentColor: '', // "#rrggbb" for accent: 'custom'
  background: '', // the player's own background picture: a file name in <launcher folder>/theme/
  heroStyle: 'classic', // classic | aurora | forge | stars – the animated background
  autoBackup: false, // back up the worlds played after each game session
  autoBackupKeep: 5, // automatic backups kept per world (1–20)
  hammerCape: '', // the Hammer+ cape shown by Hammer Client (an id from capes.json)
  cloudAuto: false, // cloud copy: fetch at start, send after each game session
});

const PRESETS = ['recommended', 'zgc', 'vanilla', 'custom'];
const AFTER = ['hide', 'minimize', 'keep'];
const PRIORITY = ['normal', 'above_normal', 'high'];
const ACCENTS = ['orange', 'gold', 'red', 'blue', 'green', 'purple'];
const HERO_STYLES = ['classic', 'aurora', 'forge', 'stars'];

/**
 * Settings only Hammer+ may switch on: key → [is this the free value?, what the feature is called in a message].
 * Switching one off is always allowed, so nobody is stuck with a setting after Hammer+ ends.
 */
const PLUS_ONLY = {
  accent: [(v) => v !== 'custom', 'Własny kolor launchera'],
  background: [(v) => !v, 'Własne tło launchera'],
  heroStyle: [(v) => v === 'classic', 'Animowane tło'],
  autoBackup: [(v) => !v, 'Automatyczne kopie światów'],
  hammerCape: [(v) => !v, 'Peleryny Hammer+'],
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
  if (typeof patch.accentColor === 'string' && /^(#[0-9a-f]{6})?$/i.test(patch.accentColor)) out.accentColor = patch.accentColor.toLowerCase();
  if (typeof patch.background === 'string' && /^(background-[0-9a-f]{8}\.(png|jpg|webp))?$/.test(patch.background)) out.background = patch.background;
  if (HERO_STYLES.includes(patch.heroStyle)) out.heroStyle = patch.heroStyle;
  if ('autoBackupKeep' in patch) out.autoBackupKeep = clampInt(patch.autoBackupKeep, 1, 20, base.autoBackupKeep);
  if (typeof patch.hammerCape === 'string' && /^[a-z0-9_-]{0,32}$/.test(patch.hammerCape)) out.hammerCape = patch.hammerCape;
  for (const key of ['showSnapshots', 'discordRpc', 'gpuPreference', 'closeOnExit', 'autoBackup', 'cloudAuto', 'playSummary', 'modUpdateCheck', 'screenshotShareAsk']) if (key in patch) out[key] = Boolean(patch[key]);
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

module.exports = { createSettings, sanitize, plusOnly, DEFAULT_SETTINGS, ACCENTS, HERO_STYLES, PLUS_ONLY };
