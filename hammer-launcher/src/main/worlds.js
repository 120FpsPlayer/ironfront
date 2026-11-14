'use strict';

/**
 * Światy – the singleplayer worlds of an instance (saves/<folder>): what they are (read from level.dat), backups as
 * zip files in backups/ (the folder the game uses for its own backups, with the same layout inside), restoring a
 * backup as a new world, renaming and removing.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { readNbt, writeNbt, tag, get, text, number } = require('./nbt');
const { createZip, openZip } = require('./zipstream');
const { insideDir } = require('./net');
const { walk, dirSize, mapLimit, isPlainName, cleanFolderName, freeName, stamp, explained } = require('./fsutil');
const { readJson, writeJson } = require('./store');

const GAME_MODES = ['Przetrwanie', 'Kreatywny', 'Przygoda', 'Widz'];
const MAX_WORLDS = 300;
const MAX_LEVEL_DAT = 64 * 1024 * 1024;
const SIZE_CAP = 20_000; // files counted per world before the size is reported as "at least"
const MAX_NAME = 64;

const savesDir = (instance) => path.join(instance.dir, 'saves');
const backupsDir = (instance) => path.join(instance.dir, 'backups');

/** The folder of one world – only a plain name inside saves/ that is a real folder (not a link). */
function worldDir(instance, folder) {
  if (!isPlainName(folder)) throw new Error('Nieprawidłowa nazwa świata.');
  const full = path.join(savesDir(instance), folder);
  let stat = null;
  try {
    stat = fs.lstatSync(full);
  } catch {
    stat = null;
  }
  if (!stat?.isDirectory()) throw new Error('Nie ma już takiego świata – odśwież listę.');
  return full;
}

/** The path of one backup – only a plain .zip name inside backups/. */
function backupPath(instance, file) {
  if (!isPlainName(file) || !/\.zip$/i.test(file)) throw new Error('Nieprawidłowa nazwa kopii zapasowej.');
  const full = path.join(backupsDir(instance), file);
  let stat = null;
  try {
    stat = fs.lstatSync(full);
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) throw new Error('Nie ma już takiej kopii zapasowej – odśwież listę.');
  return full;
}

/** level.dat as tags (level.dat_old when the main file is damaged, like the game does); null when neither reads. */
async function readLevel(dir) {
  for (const name of ['level.dat', 'level.dat_old']) {
    try {
      const file = path.join(dir, name);
      const stat = await fsp.stat(file);
      if (stat.size > MAX_LEVEL_DAT) continue;
      const root = readNbt(await fsp.readFile(file));
      const data = get(root, 'Data');
      if (data?.type === 'compound') return { root, data, file, mtimeMs: stat.mtimeMs };
    } catch {
      // missing or damaged – try the next one
    }
  }
  return null;
}

async function describe(instance, folder) {
  const dir = path.join(savesDir(instance), folder);
  const [level, usage, hasIcon, dirStat] = await Promise.all([
    readLevel(dir),
    dirSize(dir, { maxEntries: SIZE_CAP }),
    fsp.stat(path.join(dir, 'icon.png')).then((s) => s.isFile(), () => false),
    fsp.stat(dir).catch(() => null),
  ]);
  const gameType = number(get(level?.data, 'GameType'));
  return {
    folder,
    name: text(get(level?.data, 'LevelName'))?.trim() || folder,
    gameType,
    gameMode: GAME_MODES[gameType] ?? null,
    hardcore: Boolean(number(get(level?.data, 'hardcore'))),
    version: text(get(level?.data, 'Version', 'Name')),
    lastPlayed: number(get(level?.data, 'LastPlayed')) || Math.round(level?.mtimeMs ?? dirStat?.mtimeMs ?? 0),
    size: usage.size,
    sizePartial: usage.partial,
    iconUrl: hasIcon ? pathToFileURL(path.join(dir, 'icon.png')).href : null,
    broken: !level,
  };
}

/**
 * Newest first: [{ folder, name, gameType, gameMode, hardcore, version, lastPlayed, size, sizePartial, iconUrl, broken }].
 * A folder whose level.dat cannot be read is still listed, with broken: true, after the worlds that work.
 */
async function list(instance) {
  let entries = [];
  try {
    entries = await fsp.readdir(savesDir(instance), { withFileTypes: true });
  } catch {
    return [];
  }
  const folders = entries.filter((e) => e.isDirectory() && isPlainName(e.name)).map((e) => e.name).slice(0, MAX_WORLDS);
  const worlds = await mapLimit(folders, 4, (folder) => describe(instance, folder));
  return worlds.sort((a, b) => a.broken - b.broken || b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name, 'pl'));
}

/** Changes the name shown in the game (LevelName in level.dat). The folder keeps its name. */
async function rename(instance, folder, newName) {
  const dir = worldDir(instance, folder);
  const name = String(newName ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!name) throw new Error('Podaj nazwę świata.');
  if (name.length > MAX_NAME) throw new Error(`Nazwa świata może mieć najwyżej ${MAX_NAME} znaki.`);
  const file = path.join(dir, 'level.dat');
  let root;
  try {
    root = readNbt(await fsp.readFile(file));
  } catch {
    throw new Error('Nie udało się odczytać tego świata (plik level.dat jest uszkodzony).');
  }
  const data = get(root, 'Data');
  if (data?.type !== 'compound') throw new Error('Nie udało się odczytać tego świata (plik level.dat jest uszkodzony).');
  data.value.set('LevelName', tag.string(name));
  const tmp = `${file}.${process.pid}.tmp`;
  await explained('Nie udało się zmienić nazwy świata', async () => {
    await fsp.writeFile(tmp, writeNbt(root));
    await fsp.rename(tmp, file).catch(async (err) => {
      await fsp.rm(tmp, { force: true }).catch(() => null);
      throw err;
    });
  });
  return describe(instance, folder);
}

/** Moves a world to the system trash (`trash` comes from Electron; without it the folder is deleted). */
async function remove(instance, folder, { trash } = {}) {
  const dir = worldDir(instance, folder);
  if (trash) await trash(dir);
  else await explained('Nie udało się usunąć świata', () => fsp.rm(dir, { recursive: true, force: true }));
  return true;
}

/**
 * Which world a backup file is of: "<folder>-2026-11-10_18-05.zip" (ours), "<folder>-2026-11-10_18-05-auto.zip"
 * (made by the launcher after a game session), "<folder>-2026-11-10_18-05-przed-przywroceniem.zip" (the state a
 * world had before a backup was restored in its place) or "2026-11-10_18-05-33_<folder>.zip" (the game's).
 */
function backupWorldName(file) {
  const base = String(file).replace(/\.zip$/i, '');
  return base.replace(/-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}(-auto|-przed-przywroceniem)?( \(\d+\))?$/, '').replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/, '') || base;
}

/** A backup the launcher made by itself after a game session – removed automatically (see autobackup.prune). */
const isAutoBackup = (file) => /-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-auto( \(\d+\))?\.zip$/i.test(String(file));
/** The way back from a restore in place („Cofnij”) – kept for a while, then removed like the automatic ones. */
const isSafetyBackup = (file) => /-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-przed-przywroceniem( \(\d+\))?\.zip$/i.test(String(file));

/**
 * Packs a world into backups/<folder>-YYYY-MM-DD_HH-mm.zip (streamed, so big worlds neither fill the memory nor
 * freeze the launcher). onProgress({ done, total }) in bytes. `auto` marks a backup the launcher makes by itself
 * ("…-auto.zip"), `safety` the one made right before a restore in place ("…-przed-przywroceniem.zip").
 * Returns { file, size, createdAt, world, auto, safety }.
 */
async function backup(instance, folder, { onProgress, now = new Date(), auto = false, safety = false } = {}) {
  const dir = worldDir(instance, folder);
  const files = [];
  let total = 0;
  await walk(dir, (f) => {
    if (f.rel === 'session.lock') return; // held by a running game and useless in a copy (the game skips it too)
    files.push({ path: f.path, name: `${folder}/${f.rel}`, size: f.size, mtimeMs: f.mtimeMs });
    total += f.size;
  });
  if (!files.length) throw new Error('Ten świat jest pusty – nie ma czego kopiować.');
  const outDir = backupsDir(instance);
  return explained('Nie udało się zrobić kopii zapasowej', async () => {
    await fsp.mkdir(outDir, { recursive: true });
    const file = freeName(outDir, `${folder}-${stamp(now)}${auto ? '-auto' : safety ? '-przed-przywroceniem' : ''}`, '.zip');
    const dest = path.join(outDir, file);
    await createZip(dest, files, { onProgress: (done) => onProgress?.({ done: Math.min(done, total), total }) });
    const stat = await fsp.stat(dest);
    return { file, size: stat.size, createdAt: stat.mtimeMs, world: folder, auto: Boolean(auto), safety: !auto && Boolean(safety) };
  });
}

/** Newest first: [{ file, size, createdAt, world, auto, safety }] – every .zip in backups/, also the ones made by the game. */
async function listBackups(instance) {
  let names = [];
  try {
    names = await fsp.readdir(backupsDir(instance));
  } catch {
    return [];
  }
  const out = [];
  for (const file of names) {
    if (!isPlainName(file) || !/\.zip$/i.test(file)) continue;
    const stat = await fsp.lstat(path.join(backupsDir(instance), file)).catch(() => null);
    if (stat?.isFile()) out.push({ file, size: stat.size, createdAt: stat.mtimeMs, world: backupWorldName(file), auto: isAutoBackup(file), safety: isSafetyBackup(file) });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

async function removeBackup(instance, file, { trash } = {}) {
  const full = backupPath(instance, file);
  if (trash) await trash(full);
  else await explained('Nie udało się usunąć kopii zapasowej', () => fsp.rm(full, { force: true }));
  return true;
}

/** A path from an archive, relative to the world: plain names only, nothing that could leave the folder. */
function entryPath(rel) {
  const parts = rel.split('/').filter(Boolean);
  // Only dots / spaces covers ".", ".." and the names Windows silently turns into them.
  const bad = (p) => /^[. ]*$/.test(p) || /[\\:*?"<>|\x00-\x1f]/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p);
  if (rel.startsWith('/') || !parts.length || parts.some(bad)) throw new Error('Ta kopia zawiera niedozwolone ścieżki plików – nic nie zostało przywrócone.');
  return parts.join('/');
}

/**
 * Unpacks a backup as a NEW world – an existing world is never overwritten (the copy gets "(2)", "(3)" …).
 * Works with our backups, the game's own, and zips with level.dat at the top. Returns { folder }.
 */
async function restoreBackup(instance, file, options) {
  const source = backupPath(instance, file);
  return explained('Nie udało się przywrócić świata', () => unpackWorld(instance, file, source, options));
}

async function unpackWorld(instance, file, source, { onProgress } = {}) {
  const id = swapId();
  working.add(id);
  let staged = null;
  try {
    const out = await extractWorld(instance, file, source, { id, onProgress });
    staged = out.dir;
    const saves = savesDir(instance);
    const folder = freeName(saves, cleanFolderName(out.wanted, 'Przywrócony świat'));
    await fsp.rename(staged, path.join(saves, folder));
    staged = null;
    return { folder };
  } finally {
    if (staged) await fsp.rm(staged, { recursive: true, force: true }).catch(() => null);
    working.delete(id);
  }
}

/* ── unpacking a backup, and putting it in place of a world ── */

// Hidden folders in saves/ (the launcher's world list skips names with a dot): a backup being unpacked, and the
// old copy of a world during the swap. Both end with the id of their restore.
const STAGED = '.przywracanie-';
const OLD = '.przed-przywroceniem-';
const ID = /^[0-9a-f]{8}$/;
const swapId = () => crypto.randomBytes(4).toString('hex');
const journalDir = (instance) => path.join(instance.dir, '.hammer', 'przywracanie-swiatow');
/** The ids of the restores running in this process right now – recoverSwaps() leaves their folders alone. */
const working = new Set();

/**
 * Unpacks the world of a backup into saves/.przywracanie-<id> – nothing the game or the player sees changes.
 * Every path is checked before anything is written; `reserve` is room on the disk needed besides the world.
 * Returns { dir, wanted, total }: the folder, the name the world's folder had, its size in bytes. On an error
 * nothing is left behind.
 */
async function extractWorld(instance, file, source, { id, onProgress, reserve = 0 }) {
  const zip = await openZip(source);
  const saves = savesDir(instance);
  let tmp = null;
  try {
    const names = zip.entries.map((e) => e.name.replace(/\\/g, '/'));
    // The world is the folder that holds level.dat (the one closest to the top when there are several).
    const levels = names.filter((n) => /(^|\/)level\.dat$/.test(n)).sort((a, b) => a.split('/').length - b.split('/').length);
    if (!levels.length) throw new Error('To nie wygląda na kopię świata – w archiwum nie ma pliku level.dat.');
    const prefix = levels[0].slice(0, -'level.dat'.length);
    const inside = zip.entries.map((entry, i) => ({ entry, rel: names[i].startsWith(prefix) ? names[i].slice(prefix.length) : null })).filter((x) => x.rel && !x.entry.symlink);
    if (inside.length > 200_000) throw new Error('Ta kopia ma zbyt wiele plików.');
    const todo = inside.map((x) => ({ ...x, rel: entryPath(x.rel) })); // checked before anything is written
    const total = todo.reduce((sum, x) => sum + (x.entry.directory ? 0 : x.entry.size), 0);

    await fsp.mkdir(saves, { recursive: true });
    const free = await fsp.statfs(saves).then((s) => s.bavail * s.bsize, () => Infinity);
    if (total + reserve > free) throw new Error('Za mało miejsca na dysku, żeby przywrócić ten świat.');

    const wanted = prefix.split('/').filter(Boolean).pop() ?? backupWorldName(file);
    tmp = path.join(saves, `${STAGED}${id}`);
    await fsp.mkdir(tmp);
    let done = 0;
    for (const { entry, rel } of todo) {
      const target = insideDir(tmp, rel);
      if (entry.directory) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await zip.extract(entry, target, (n) => onProgress?.({ done: Math.min((done += n), total), total }));
    }
    const dir = tmp;
    tmp = null;
    return { dir, wanted, total };
  } finally {
    await zip.close().catch(() => null);
    if (tmp) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => null);
  }
}

/**
 * Puts a backup IN PLACE of a world („Przywróć wczorajszą wersję”, „Inna wersja…”, „Cofnij”). The folder keeps
 * its name, so the game shows the same world – as it was in the backup. The steps, in this order:
 *   1. the backup is unpacked into saves/.przywracanie-<id> and its level.dat must read (a broken copy stops here),
 *   2. the world as it is now is packed into backups/<folder>-<date>-przed-przywroceniem.zip – the way back,
 *   3. a note (<instance>/.hammer/przywracanie-swiatow/<id>.json) records the swap,
 *   4. saves/<folder> → saves/.przed-przywroceniem-<id>,   5. saves/.przywracanie-<id> → saves/<folder>,
 *   6. the old copy is deleted, then the note.
 * Both moves are renames inside saves/, so each one happens entirely or not at all. A swap cut off between 3 and
 * 6 (the launcher closed, the power went out) is finished – or undone – by recoverSwaps(): the folder then holds
 * the old world or the new one, never nothing. `now` dates the safety backup.
 * Returns { folder, safety: { file, size, createdAt } | null (an empty world has nothing to keep), from: { file, createdAt } }.
 */
async function restoreInPlace(instance, folder, file, { onProgress, now = new Date() } = {}) {
  const dir = worldDir(instance, folder);
  const source = backupPath(instance, file);
  const id = swapId();
  working.add(id);
  let staged = null;
  try {
    return await explained('Nie udało się przywrócić świata', async () => {
      const from = { file, createdAt: (await fsp.stat(source)).mtimeMs };
      const current = await dirSize(dir);
      const out = await extractWorld(instance, file, source, { id, reserve: current.size, onProgress: (p) => onProgress?.({ done: p.done, total: p.total + current.size }) });
      staged = out.dir;
      if (!(await readLevel(staged))) throw new Error('Tej kopii nie da się wczytać – plik level.dat jest uszkodzony. Świat został bez zmian.');

      let safety = null;
      if (current.files) {
        const made = await backup(instance, folder, { safety: true, now, onProgress: (p) => onProgress?.({ done: out.total + p.done, total: out.total + p.total }) });
        safety = { file: made.file, size: made.size, createdAt: made.createdAt };
      }

      const saves = savesDir(instance);
      const old = path.join(saves, `${OLD}${id}`);
      const note = path.join(journalDir(instance), `${id}.json`);
      // The world stayed as it was: the note and the backup of its current state are not needed.
      const unchanged = async () => {
        await fsp.rm(note, { force: true }).catch(() => null);
        if (safety) await fsp.rm(path.join(backupsDir(instance), safety.file), { force: true }).catch(() => null);
      };
      writeJson(note, { v: 1, folder, file, safety: safety?.file ?? null, at: Date.now() });
      try {
        await move(dir, old);
      } catch (err) {
        await unchanged(); // nothing moved (on Windows: a file of the world is open in another program)
        throw err;
      }
      try {
        await move(staged, dir);
      } catch (err) {
        // The old world goes straight back. If even that fails, the note and the safety backup stay:
        // recoverSwaps() puts the old world back later (the unpacked copy is deleted below).
        if (await move(old, dir).then(() => true, () => false)) await unchanged();
        throw err;
      }
      staged = null;
      // The new world is in place. When the old copy cannot be deleted right now (a file held by another
      // program), the note stays and recoverSwaps() deletes the rest later.
      if (await fsp.rm(old, { recursive: true, force: true }).then(() => true, () => false)) await fsp.rm(note, { force: true }).catch(() => null);
      return { folder, safety, from };
    });
  } finally {
    if (staged) await fsp.rm(staged, { recursive: true, force: true }).catch(() => null);
    working.delete(id);
  }
}

/**
 * A rename that tries again a few times when Windows says a file is busy – an antivirus or the search indexer
 * often holds a file for a moment right after it was read.
 */
async function move(from, to, tries = 4) {
  for (let n = 1; ; n += 1) {
    try {
      return await fsp.rename(from, to);
    } catch (err) {
      if (n >= tries || !['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * n));
    }
  }
}

const isDir = (p) => {
  try {
    return fs.lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};
const hasLevel = (dir) => ['level.dat', 'level.dat_old'].some((name) => fs.existsSync(path.join(dir, name)));

/**
 * Finishes what a restore cut off by a crash left behind (see restoreInPlace), from the notes and the folders
 * themselves – safe to run any time, and as often as wanted:
 *   - the world's folder is missing → the unpacked backup goes in (it was complete and checked before the note
 *     was written), or else the old copy goes back,
 *   - the world's folder is there → the leftover old copy / unpacked folder is deleted,
 *   - an unpacked folder without a note (an unpacking that never finished) is deleted.
 * Restores running in this process are left alone. Returns the folders of the worlds whose swap was finished.
 */
function recoverSwaps(instance) {
  const saves = savesDir(instance);
  const finished = [];
  const known = new Set();
  let notes = [];
  try {
    notes = fs.readdirSync(journalDir(instance)).filter((name) => ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
  } catch {
    notes = [];
  }
  for (const name of notes) {
    const id = name.slice(0, -'.json'.length);
    known.add(id);
    if (working.has(id)) continue;
    const note = path.join(journalDir(instance), name);
    const folder = readJson(note, null)?.folder;
    try {
      if (!isPlainName(folder)) {
        fs.rmSync(note, { force: true });
        continue;
      }
      const world = path.join(saves, folder);
      const staged = path.join(saves, `${STAGED}${id}`);
      const old = path.join(saves, `${OLD}${id}`);
      if (!fs.existsSync(world)) {
        if (isDir(staged) && hasLevel(staged)) fs.renameSync(staged, world);
        else if (isDir(old)) fs.renameSync(old, world);
      }
      fs.rmSync(old, { recursive: true, force: true });
      fs.rmSync(staged, { recursive: true, force: true });
      fs.rmSync(note, { force: true });
      if (fs.existsSync(world)) finished.push(folder);
    } catch {
      // a file is held by another program – tried again next time
    }
  }
  let entries = [];
  try {
    entries = fs.readdirSync(saves);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    const id = name.startsWith(STAGED) ? name.slice(STAGED.length) : null;
    if (id && ID.test(id) && !known.has(id) && !working.has(id)) {
      try {
        fs.rmSync(path.join(saves, name), { recursive: true, force: true });
      } catch {
        // tried again next time
      }
    }
  }
  return finished;
}

module.exports = { list, rename, remove, backup, listBackups, restoreBackup, restoreInPlace, recoverSwaps, removeBackup, worldDir, backupPath, backupWorldName, isAutoBackup, isSafetyBackup, savesDir, backupsDir, GAME_MODES };
