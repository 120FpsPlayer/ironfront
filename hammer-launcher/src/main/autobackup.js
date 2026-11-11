'use strict';

/**
 * Automatyczne kopie światów (Hammer+). After a game session the worlds that were played in it are packed with
 * the normal backup code into backups/<folder>-<date>-auto.zip, and only the newest few automatic backups of
 * each world are kept. Backups the player made by hand (and the game's own) are never removed here.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const worlds = require('./worlds');
const { isPlainName } = require('./fsutil');

const DEFAULT_KEEP = 5;
const SLACK_MS = 2000; // file times are coarse on some disks (FAT: two seconds)

/**
 * The folders in saves/ that the game touched since `since` (milliseconds): it writes session.lock when a world
 * is opened and level.dat every time the world is saved.
 */
async function changedWorlds(instance, since) {
  let entries = [];
  try {
    entries = await fsp.readdir(worlds.savesDir(instance), { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isPlainName(entry.name)) continue;
    const dir = path.join(worlds.savesDir(instance), entry.name);
    const level = await fsp.stat(path.join(dir, 'level.dat')).catch(() => null);
    if (!level?.isFile()) continue; // not a world (yet)
    const lock = await fsp.stat(path.join(dir, 'session.lock')).catch(() => null);
    if (Math.max(level.mtimeMs, lock?.mtimeMs ?? 0) >= since - SLACK_MS) out.push(entry.name);
  }
  return out.sort();
}

/** Removes the oldest automatic backups of one world so that `keep` stay. Returns the removed file names. */
async function prune(instance, world, keep = DEFAULT_KEEP) {
  const limit = Math.min(20, Math.max(1, Math.round(Number(keep)) || DEFAULT_KEEP));
  const mine = (await worlds.listBackups(instance)).filter((b) => b.auto && b.world === world); // newest first
  const removed = [];
  for (const old of mine.slice(limit)) {
    await fsp.rm(path.join(worlds.backupsDir(instance), old.file), { force: true }).catch(() => null);
    removed.push(old.file);
  }
  return removed;
}

/**
 * Backs up every world changed since `since` and trims the automatic backups of each to `keep`.
 * `stop()` is asked before each world – true (the game was started again) ends the run. `backup(world)` makes
 * one automatic backup (services.js wraps it to show progress).
 * Returns { made: [{ file, size, world }], failed: [{ world, error }], removed: [file names] }.
 */
async function run(instance, { since, keep = DEFAULT_KEEP, stop = () => false, backup = (world) => worlds.backup(instance, world, { auto: true }) } = {}) {
  const result = { made: [], failed: [], removed: [] };
  for (const world of await changedWorlds(instance, since)) {
    if (stop()) break;
    try {
      result.made.push(await backup(world));
      result.removed.push(...(await prune(instance, world, keep)));
    } catch (err) {
      result.failed.push({ world, error: err?.message ?? String(err) });
    }
  }
  return result;
}

module.exports = { run, prune, changedWorlds, DEFAULT_KEEP };
