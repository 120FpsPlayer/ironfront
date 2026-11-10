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
});

const PRESETS = ['recommended', 'zgc', 'vanilla', 'custom'];
const AFTER = ['hide', 'minimize', 'keep'];
const PRIORITY = ['normal', 'above_normal', 'high'];

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
  for (const key of ['showSnapshots', 'discordRpc', 'gpuPreference', 'closeOnExit']) if (key in patch) out[key] = Boolean(patch[key]);
  if ('concurrentDownloads' in patch) out.concurrentDownloads = clampInt(patch.concurrentDownloads, 1, 64, base.concurrentDownloads);
  for (const key of ['selectedInstance', 'selectedAccount']) if (key in patch) out[key] = patch[key] ? String(patch[key]) : null;
  return out;
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

module.exports = { createSettings, sanitize, DEFAULT_SETTINGS };
