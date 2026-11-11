'use strict';

/**
 * The player's "normal" Minecraft – the game folder of the official Minecraft Launcher. Nothing of it is part of
 * the Microsoft account: the server list (servers.dat), the worlds (saves/) and the settings (options.txt) are
 * files in that folder, and every instance of this launcher has a folder of its own. So they are brought over
 * from there:
 *   - the server list – see servers.importFrom,
 *   - worlds – copied into an instance, never moved: the originals stay exactly as they are,
 *   - options.txt – keys, mouse sensitivity, video settings, language and the list of resource packs.
 * No Electron here.
 */

const os = require('node:os');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const worldSaves = require('./worlds');
const { walk, freeName, isPlainName, explained } = require('./fsutil');
const { compareVersions } = require('./hammerclient');
const { mergeOptions } = require('./optimizer');

const OPTIONS = 'options.txt';
const OPTIONS_BACKUP = 'options.txt.przed-importem';
const MAX_OPTIONS = 1024 * 1024; // the game's own file has a few kB
const MAX_WORLDS_AT_ONCE = 50;
const TMP_PREFIX = '.importowanie-'; // a world being copied, inside saves/ of the instance

function officialMinecraftDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.minecraft');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'minecraft');
  return path.join(home, '.minecraft');
}

/**
 * Whether a world last opened in `worldVersion` (Version.Name of its level.dat) comes from a NEWER game than
 * `mcVersion` – such a world may not load. `order` is the version manifest, newest first (snapshots included):
 * with it snapshots and pre-releases are placed exactly; without it the numbers decide ("1.21.4" > "1.21.1",
 * "26.1" > "1.21.11"). When nothing can be said for sure the answer is false – no warning without a reason.
 */
function isNewer(worldVersion, mcVersion, order = null) {
  const world = String(worldVersion ?? '').trim();
  const game = String(mcVersion ?? '').trim();
  if (!world || !game || world === game) return false;
  if (Array.isArray(order)) {
    const w = order.indexOf(world);
    const g = order.indexOf(game);
    if (w !== -1 && g !== -1) return w < g;
  }
  // Weekly snapshots ("24w14a") say nothing about their place without the manifest.
  if (!/^\d+\.\d+/.test(world) || !/^\d+\.\d+/.test(game)) return false;
  return compareVersions(world, game) > 0;
}

/** The worlds of the official Minecraft – the same fields as worlds.list (name, version, lastPlayed, size, iconUrl …). */
async function listWorlds(officialDir) {
  if (!officialDir) return [];
  return worldSaves.list({ dir: officialDir });
}

/** The folder of one world of the official Minecraft – a plain name inside its saves/, a real folder with a level.dat. */
function sourceWorld(officialDir, folder) {
  const gone = () => new Error('Nie ma już takiego świata w Twoim Minecrafcie – odśwież listę.');
  if (!officialDir || !isPlainName(folder)) throw gone();
  const dir = path.join(officialDir, 'saves', folder);
  let stat = null;
  try {
    stat = fs.lstatSync(dir);
  } catch {
    stat = null;
  }
  if (!stat?.isDirectory()) throw gone();
  if (!['level.dat', 'level.dat_old'].some((f) => fs.existsSync(path.join(dir, f)))) throw new Error(`„${folder}” nie wygląda na świat Minecrafta – brakuje pliku level.dat.`);
  return dir;
}

/**
 * Copies one world of the official Minecraft into saves/ of an instance. The original is only read. A world with
 * the same folder name already there → the copy becomes "Name (2)", "Name (3)" … The copy is built in a hidden
 * folder and renamed at the end, so the game never sees half a world. onProgress({ done, total }) in bytes.
 * Returns { source, folder, files, size }.
 */
async function copyWorld(instance, officialDir, folder, { onProgress } = {}) {
  const source = sourceWorld(officialDir, folder);
  const saves = worldSaves.savesDir(instance);
  if (path.resolve(path.dirname(source)) === path.resolve(saves)) throw new Error('Ten świat już jest w tej instancji.');
  const files = [];
  let total = 0;
  await walk(source, (f) => {
    if (f.rel === 'session.lock') return; // held by a running game and useless in a copy
    files.push(f);
    total += f.size;
  });
  return explained(`Nie udało się skopiować świata „${folder}”`, async () => {
    await fsp.mkdir(saves, { recursive: true });
    const free = await fsp.statfs(saves).then((s) => s.bavail * s.bsize, () => Infinity);
    if (total > free) throw new Error(`Za mało miejsca na dysku, żeby skopiować świat „${folder}”.`);
    // What a copy that was cut off (the launcher was closed half-way) left behind goes first – the game would list it as a world.
    for (const name of await fsp.readdir(saves).catch(() => [])) if (name.startsWith(TMP_PREFIX)) await fsp.rm(path.join(saves, name), { recursive: true, force: true }).catch(() => null);
    const tmp = path.join(saves, `${TMP_PREFIX}${crypto.randomBytes(4).toString('hex')}`);
    try {
      await fsp.mkdir(tmp);
      let done = 0;
      onProgress?.({ done, total });
      for (const f of files) {
        const target = path.join(tmp, ...f.rel.split('/'));
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.copyFile(f.path, target);
        done += f.size;
        onProgress?.({ done: Math.min(done, total), total });
      }
      const name = freeName(saves, folder);
      await fsp.rename(tmp, path.join(saves, name));
      return { source: folder, folder: name, files: files.length, size: total };
    } catch (err) {
      await fsp.rm(tmp, { recursive: true, force: true }).catch(() => null);
      throw err;
    }
  });
}

/**
 * Copies the chosen worlds one after another. One that fails does not stop the others.
 * `copy(folder, index, count)` does one world (the services wrap it in a progress bar).
 * Returns { copied: [{ source, folder, files, size }], failed: [{ folder, error }] }.
 */
async function copyWorlds(folders, copy) {
  const list = [...new Set((Array.isArray(folders) ? folders : []).filter((f) => typeof f === 'string'))];
  if (!list.length) throw new Error('Zaznacz przynajmniej jeden świat.');
  if (list.length > MAX_WORLDS_AT_ONCE) throw new Error(`Naraz można skopiować najwyżej ${MAX_WORLDS_AT_ONCE} światów.`);
  const result = { copied: [], failed: [] };
  for (const [i, folder] of list.entries()) {
    try {
      result.copied.push(await copy(folder, i, list.length));
    } catch (err) {
      result.failed.push({ folder: String(folder).slice(0, 255), error: err?.message ?? String(err) });
    }
  }
  return result;
}

/** options.txt of the official Minecraft as text – null when there is none (or it is not a settings file). */
function readOptions(officialDir) {
  if (!officialDir) return null;
  const file = path.join(officialDir, OPTIONS);
  let stat = null;
  try {
    stat = fs.lstatSync(file);
  } catch {
    stat = null;
  }
  if (!stat?.isFile() || stat.size === 0 || stat.size > MAX_OPTIONS) return null;
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  // A settings file is lines of "key:value" – anything binary or without a single setting is not one.
  if (text.includes('\0') || !/^[\w.]+:/m.test(text)) return null;
  return text;
}

/** Whether there are settings to bring over. */
const hasOptions = (officialDir) => readOptions(officialDir) !== null;

/**
 * Replaces options.txt of an instance with the official Minecraft's: key bindings, mouse sensitivity, video and
 * sound settings, the language and the list of resource packs all come along. What the instance had stays next
 * to it as options.txt.przed-importem (the file from just before this import). The first-start accessibility
 * screen stays off, as in every instance of the launcher.
 * Returns { backup: 'options.txt.przed-importem' | null, lines }.
 */
function importOptions(instance, officialDir) {
  const text = readOptions(officialDir);
  if (text === null) throw new Error('Nie znalazłem ustawień zwykłego Minecrafta na tym komputerze. Uruchom go raz – wtedy zapisze swój plik options.txt.');
  const merged = mergeOptions(text, { onboardAccessibility: 'false' });
  const file = path.join(instance.dir, OPTIONS);
  const tmp = `${file}.${process.pid}.tmp`;
  let backup = null;
  try {
    fs.mkdirSync(instance.dir, { recursive: true });
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(instance.dir, OPTIONS_BACKUP));
      backup = OPTIONS_BACKUP;
    }
    fs.writeFileSync(tmp, merged);
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Nie udało się przenieść ustawień (${err.code ?? err.message}). Ustawienia instancji zostały bez zmian.`, { cause: err });
  }
  return { backup, lines: merged.split('\n').filter(Boolean).length };
}

module.exports = { officialMinecraftDir, isNewer, listWorlds, copyWorld, copyWorlds, readOptions, hasOptions, importOptions, OPTIONS, OPTIONS_BACKUP, MAX_OPTIONS, MAX_WORLDS_AT_ONCE };
