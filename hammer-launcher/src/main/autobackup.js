'use strict';

/**
 * Automatyczne kopie światów (Hammer+). After a game session the worlds that were played in it are packed with
 * the normal backup code into backups/<folder>-<date>-auto.zip. Of each world stay the newest few automatic
 * backups AND the newest one of each of the last seven calendar days, so „Przywróć wczorajszą wersję” still has
 * yesterday after many sessions today. Backups the player made by hand (and the game's own) are never removed
 * here; the ones made before a restore in place („…-przed-przywroceniem.zip”) stay a week, the newest one always.
 */

const fsp = require('node:fs/promises');
const path = require('node:path');
const worlds = require('./worlds');
const { isPlainName } = require('./fsutil');

const DEFAULT_KEEP = 5;
const SLACK_MS = 2000; // file times are coarse on some disks (FAT: two seconds)
const DAYS = 7; // the newest automatic backup of each of the last seven calendar days stays (today included)
const SAFETY_MS = 7 * 864e5; // a backup made before a restore in place stays at least a week

/** Local midnight `n` calendar days before the day of `ms` (n = 0: that day's own midnight; DST-safe). */
function midnight(ms, n = 0) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

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

/**
 * Which of one world's automatic backups (newest first) stay: the newest `keep`, and the newest one of each of
 * the last seven calendar days in local time – today and the six days before. Returns a Set of file names.
 */
function retained(backups, keep, now) {
  const stay = new Set(backups.slice(0, keep).map((b) => b.file));
  const from = midnight(now, DAYS - 1);
  const days = new Set();
  for (const b of backups) {
    if (b.createdAt < from) break; // newest first: the rest is older still
    const day = midnight(b.createdAt);
    if (days.has(day)) continue;
    days.add(day);
    stay.add(b.file);
  }
  return stay;
}

/**
 * Removes one world's automatic backups that are no longer retained (see retained), and its backups from before
 * a restore that are older than a week – except the newest of those, the way back from the last restore.
 * `auto: false` leaves the automatic ones alone (after a restore: the copy just put back may be an old one).
 * Returns the removed file names.
 */
async function prune(instance, world, keep = DEFAULT_KEEP, { now = Date.now(), auto: withAuto = true } = {}) {
  const limit = Math.min(20, Math.max(1, Math.round(Number(keep)) || DEFAULT_KEEP));
  const all = (await worlds.listBackups(instance)).filter((b) => b.world === world); // newest first
  const auto = withAuto ? all.filter((b) => b.auto) : [];
  const stay = retained(auto, limit, now);
  const safety = all.filter((b) => b.safety);
  const old = [...auto.filter((b) => !stay.has(b.file)), ...safety.slice(1).filter((b) => b.createdAt < now - SAFETY_MS)];
  const removed = [];
  for (const b of old) {
    await fsp.rm(path.join(worlds.backupsDir(instance), b.file), { force: true }).catch(() => null);
    removed.push(b.file);
  }
  return removed;
}

/**
 * „Przywróć wczorajszą wersję”: the newest automatic backup of `world` made before today's local midnight, as
 * { file, createdAt, size, yesterday } – `yesterday` is false when the newest one before today is older than that
 * (the button then names its date). null when there is none.
 */
function previousVersion(backups, world, now = Date.now()) {
  const today = midnight(now);
  const b = backups.filter((x) => x.auto && x.world === world && x.createdAt < today).sort((x, y) => y.createdAt - x.createdAt)[0];
  return b ? { file: b.file, createdAt: b.createdAt, size: b.size, yesterday: b.createdAt >= midnight(now, 1) } : null;
}

/**
 * Backs up every world changed since `since` and trims the automatic backups of each (see prune).
 * `stop()` is asked before each world – true (the game was started again) ends the run. `backup(world)` makes
 * one automatic backup (services.js wraps it to show progress). `now()` is the clock of the clean-up.
 * Returns { made: [{ file, size, world }], failed: [{ world, error }], removed: [file names] }.
 */
async function run(instance, { since, keep = DEFAULT_KEEP, now = () => Date.now(), stop = () => false, backup = (world) => worlds.backup(instance, world, { auto: true }) } = {}) {
  const result = { made: [], failed: [], removed: [] };
  for (const world of await changedWorlds(instance, since)) {
    if (stop()) break;
    try {
      result.made.push(await backup(world));
      result.removed.push(...(await prune(instance, world, keep, { now: now() })));
    } catch (err) {
      result.failed.push({ world, error: err?.message ?? String(err) });
    }
  }
  return result;
}

module.exports = { run, prune, retained, previousVersion, changedWorlds, midnight, DEFAULT_KEEP, DAYS };
