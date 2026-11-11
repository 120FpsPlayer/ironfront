'use strict';

/**
 * Punkty przywracania – the way back from an update of mods, resource packs and shader packs. Before files of an
 * instance are replaced by newer versions, the old ones are MOVED (never deleted) to
 *
 *   <instance>/.hammer/przywracanie/<timestamp>/        e.g. 2026-11-11_14-05-33
 *     manifest.json                                     what was replaced by what
 *     mods/  resourcepacks/  shaderpacks/               the old files, under the names they had
 *
 * The manifest is written before the first file moves, and going back reads the folder, not a "finished" flag:
 * an old file that sits in the point is put back (after the new one is removed), one that is not there is back
 * already – or never left. So an update that was cut off half-way can be undone, and an undo that was cut off can
 * simply be run again. The newest three points of an instance are kept; older ones are deleted.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./store');
const { safeName } = require('./net');
const { CONTENT_DIRS: FOLDERS } = require('./instances');

const KEEP = 3;
const MANIFEST = 'manifest.json';
const EXT = { mod: '.jar', resourcepack: '.zip', shader: '.zip' };
const ID = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-\d{1,3})?$/;
const STATES = ['planned', 'done', 'failed'];
const MAX_ENTRIES = 2000;

const root = (instance) => path.join(instance.dir, '.hammer', 'przywracanie');
const pointDir = (instance, id) => path.join(root(instance), id);
const folderOf = (instance, type) => path.join(instance.dir, FOLDERS[type]);
/** The name a file has on the disk: a disabled one ends with ".disabled". */
const onDisk = (old) => (old.disabled ? `${old.file}.disabled` : old.file);

/** A plain file name of the right kind for `type` (never a path) – throws otherwise. */
function fileName(type, name) {
  const base = safeName(name);
  if (!(type in FOLDERS) || base !== name || base.startsWith('.') || !base.toLowerCase().endsWith(EXT[type])) throw new Error(`Nieprawidłowa nazwa pliku: ${name}`);
  return base;
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '') || null;

/** What the content list remembered about the old file (name, version, icon) – only the known fields, checked. */
function cleanIndex(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (Number.isFinite(raw.size) && raw.size >= 0) out.size = raw.size;
  if (typeof raw.sha1 === 'string' && /^[0-9a-f]{40}$/i.test(raw.sha1)) out.sha1 = raw.sha1.toLowerCase();
  for (const [key, max] of [['projectId', 64], ['versionId', 64], ['versionNumber', 64], ['title', 120], ['slug', 80], ['description', 500], ['modId', 80]]) {
    const value = text(raw[key], max);
    if (value) out[key] = value;
  }
  if (typeof raw.iconUrl === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(raw.iconUrl)) out.iconUrl = raw.iconUrl;
  return Object.keys(out).length ? out : null;
}

/** One line of the manifest, checked – null when it is not one. The manifest lies in the game folder: never trusted. */
function cleanEntry(raw) {
  try {
    const type = raw.type;
    const oldFile = fileName(type, raw.old.file);
    return {
      type,
      title: text(raw.title, 120) ?? oldFile,
      old: { file: oldFile, disabled: Boolean(raw.old.disabled), versionNumber: text(raw.old.versionNumber, 64), index: cleanIndex(raw.old.index) },
      new: { file: fileName(type, raw.new.file), versionId: text(raw.new.versionId, 64), versionNumber: text(raw.new.versionNumber, 64) },
      state: STATES.includes(raw.state) ? raw.state : 'planned',
    };
  } catch {
    return null;
  }
}

function readManifest(instance, id) {
  const raw = readJson(path.join(pointDir(instance, id), MANIFEST), null);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return null;
  const entries = raw.entries.slice(0, MAX_ENTRIES).map(cleanEntry).filter(Boolean);
  if (!entries.length) return null;
  return { v: 1, id, createdAt: Number.isFinite(raw.createdAt) && raw.createdAt > 0 ? raw.createdAt : 0, state: raw.state === 'done' ? 'done' : 'pending', entries };
}

const writeManifest = (instance, manifest) => writeJson(path.join(pointDir(instance, manifest.id), MANIFEST), manifest);

/** Every folder in przywracanie/ that is named like a point, newest first: [{ id, manifest | null }]. */
function folders(instance) {
  let names = [];
  try {
    names = fs.readdirSync(root(instance), { withFileTypes: true }).filter((d) => d.isDirectory() && ID.test(d.name)).map((d) => d.name);
  } catch {
    return [];
  }
  return names
    .map((id) => ({ id, manifest: readManifest(instance, id) }))
    .sort((a, b) => (b.manifest?.createdAt ?? 0) - (a.manifest?.createdAt ?? 0) || b.id.localeCompare(a.id));
}

/**
 * The restore points of an instance, newest first:
 * [{ id, createdAt, interrupted, entries: [{ type, title, old: { file, versionNumber }, new: { file, versionNumber }, state }] }].
 * `interrupted` – the update was cut off before it finished (the launcher was closed, the power went out).
 */
function list(instance) {
  return folders(instance)
    .filter((p) => p.manifest)
    .map(({ id, manifest }) => ({
      id,
      createdAt: manifest.createdAt,
      interrupted: manifest.state !== 'done',
      entries: manifest.entries.map((e) => ({ type: e.type, title: e.title, old: { file: e.old.file, versionNumber: e.old.versionNumber }, new: { file: e.new.file, versionNumber: e.new.versionNumber }, state: e.state })),
    }));
}

/** Deletes the points beyond the newest `keep` (folders with a broken manifest count as the oldest). Returns the removed ids. */
function prune(instance, keep = KEEP) {
  const removed = [];
  for (const { id } of folders(instance).slice(Math.max(0, keep))) {
    fs.rmSync(pointDir(instance, id), { recursive: true, force: true });
    removed.push(id);
  }
  return removed;
}

/** Local time as 2026-11-11_14-05-33 – the name of a point. */
function stampId(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

/**
 * Opens a restore point: writes the manifest – nothing is moved yet. `entries` =
 * [{ type, title, old: { file, versionNumber, index }, new: { file, versionId, versionNumber } }]; whether an old
 * file is disabled is read from the disk. Throws when an old file is not there. Returns { id, entries }.
 */
function begin(instance, entries, { now = new Date() } = {}) {
  const planned = [];
  for (const raw of entries ?? []) {
    const entry = cleanEntry({ ...raw, old: { ...raw?.old, disabled: false }, state: 'planned' });
    if (!entry) throw new Error('Nieprawidłowa pozycja aktualizacji.');
    const folder = folderOf(instance, entry.type);
    if (fs.existsSync(path.join(folder, entry.old.file))) entry.old.disabled = false;
    else if (fs.existsSync(path.join(folder, `${entry.old.file}.disabled`))) entry.old.disabled = true;
    else throw new Error(`Nie ma już pliku ${entry.old.file} – odśwież listę.`);
    planned.push(entry);
  }
  if (!planned.length) throw new Error('Nie ma czego aktualizować.');
  const stamp = stampId(now);
  let id = stamp;
  for (let n = 2; fs.existsSync(pointDir(instance, id)); n += 1) id = `${stamp}-${n}`;
  fs.mkdirSync(pointDir(instance, id), { recursive: true });
  writeManifest(instance, { v: 1, id, createdAt: now.getTime(), state: 'pending', entries: planned });
  return { id, entries: planned };
}

/** Moves the old file of entry `n` into the point. */
function stash(instance, id, n) {
  const entry = readManifest(instance, id)?.entries[n];
  if (!entry) throw new Error('Nie ma takiego punktu przywracania.');
  const target = path.join(pointDir(instance, id), FOLDERS[entry.type], onDisk(entry.old));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(path.join(folderOf(instance, entry.type), onDisk(entry.old)), target);
  return target;
}

/**
 * Reverses one entry: when its old file sits in the point, the new file is removed and the old one moved back
 * (true). When it does not (it is back already, or it never left), nothing is touched (false) – this is what
 * makes going back safe to repeat.
 */
function putBack(instance, id, entry) {
  const stored = path.join(pointDir(instance, id), FOLDERS[entry.type], onDisk(entry.old));
  if (!fs.existsSync(stored)) return false;
  const folder = folderOf(instance, entry.type);
  fs.mkdirSync(folder, { recursive: true });
  for (const name of [entry.new.file, `${entry.new.file}.disabled`, `${entry.new.file}.part`, entry.old.file, `${entry.old.file}.disabled`]) fs.rmSync(path.join(folder, name), { force: true });
  fs.renameSync(stored, path.join(folder, onDisk(entry.old)));
  return true;
}

/** Notes in the manifest how entry `n` ended: 'done' or 'failed'. */
function mark(instance, id, n, state) {
  const manifest = readManifest(instance, id);
  if (!manifest?.entries[n] || !STATES.includes(state)) return;
  manifest.entries[n].state = state;
  writeManifest(instance, manifest);
}

/**
 * Closes a point after the update: one in which nothing was replaced is removed (null), otherwise it is marked
 * as finished, the points beyond the newest three are deleted and its id is returned.
 */
function finish(instance, id, { keep = KEEP } = {}) {
  const manifest = readManifest(instance, id);
  if (!manifest || !manifest.entries.some((e) => e.state === 'done')) {
    fs.rmSync(pointDir(instance, id), { recursive: true, force: true });
    return null;
  }
  writeManifest(instance, { ...manifest, state: 'done' });
  prune(instance, keep);
  return id;
}

/**
 * Replaces files with a way back. `install(entry)` puts the new file of an entry in place and throws when it
 * cannot – then the old file goes straight back, so a failed download never costs the player a mod.
 * Order: manifest → for each entry: old file into the point → install. Returns { id (null when nothing was
 * replaced), done: [entry], failed: [{ entry, error }] }.
 */
async function replace(instance, entries, install, { now, keep = KEEP, onStep } = {}) {
  const point = begin(instance, entries, { now });
  const done = [];
  const failed = [];
  for (const [n, entry] of point.entries.entries()) {
    onStep?.(entry, n, point.entries.length);
    try {
      stash(instance, point.id, n);
      await install(entry);
      mark(instance, point.id, n, 'done');
      done.push(entry);
    } catch (error) {
      try {
        putBack(instance, point.id, entry);
      } catch {
        // the old file stays in the point – „Cofnij ostatnią aktualizację” still brings it back
      }
      mark(instance, point.id, n, 'failed');
      failed.push({ entry, error });
    }
  }
  return { id: finish(instance, point.id, { keep }), done, failed };
}

/**
 * „Cofnij ostatnią aktualizację”: reverses the newest point exactly – the new files are removed, the old ones
 * moved back under their names (disabled ones stay disabled) – and removes the point. Works the same on a point
 * whose update never finished. Returns { id, createdAt, restored: [entry], untouched: [entry] }; entries whose
 * old file was not in the point (a failed download that was put back at once) are `untouched`.
 */
function restore(instance) {
  const point = folders(instance).find((p) => p.manifest);
  if (!point) throw new Error('Nie ma czego cofać – ta instancja nie ma zapisanej aktualizacji.');
  const restored = [];
  const untouched = [];
  for (const entry of [...point.manifest.entries].reverse()) (putBack(instance, point.id, entry) ? restored : untouched).push(entry);
  fs.rmSync(pointDir(instance, point.id), { recursive: true, force: true });
  return { id: point.id, createdAt: point.manifest.createdAt, restored: restored.reverse(), untouched: untouched.reverse() };
}

module.exports = { list, begin, stash, putBack, mark, finish, replace, restore, prune, root, pointDir, readManifest, KEEP, MANIFEST };
