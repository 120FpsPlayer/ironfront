'use strict';

/**
 * Instances – separate game folders, each with its own Minecraft version, mod loader, mods, worlds and options.
 * instances/<id>/instance.json holds the settings; the rest of the folder is the game directory.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./store');

const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const ICONS = ['hammer', 'grass', 'diamond', 'sword', 'pickaxe', 'creeper', 'nether', 'end', 'rocket', 'star'];
const CONTENT_DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };

function slug(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'instancja';
}

/** Validates the editable fields of an instance (from the UI) – unknown keys are dropped. */
function clean(data, base = {}) {
  const out = { ...base };
  if (typeof data.name === 'string' && data.name.trim()) out.name = data.name.trim().slice(0, 48);
  if (typeof data.mcVersion === 'string' && /^[\w.\-+ ]{1,40}$/.test(data.mcVersion)) out.mcVersion = data.mcVersion;
  if (LOADERS.includes(data.loader)) out.loader = data.loader;
  if ('loaderVersion' in data) out.loaderVersion = data.loaderVersion ? String(data.loaderVersion).slice(0, 64) : null;
  if (ICONS.includes(data.icon)) out.icon = data.icon;
  if ('memoryMb' in data) out.memoryMb = data.memoryMb == null || data.memoryMb === '' ? null : Math.min(65536, Math.max(1024, Math.round(Number(data.memoryMb)) || 1024));
  if ('jvmPreset' in data) out.jvmPreset = ['recommended', 'zgc', 'vanilla', 'custom'].includes(data.jvmPreset) ? data.jvmPreset : null;
  if (typeof data.customJvmArgs === 'string') out.customJvmArgs = data.customJvmArgs.slice(0, 2000);
  if (typeof data.javaPath === 'string') out.javaPath = data.javaPath.trim();
  if ('optimized' in data) out.optimized = Boolean(data.optimized);
  if ('autoJoinServer' in data) out.autoJoinServer = Boolean(data.autoJoinServer);
  if ('hammerClient' in data) out.hammerClient = Boolean(data.hammerClient);
  // null = the launcher setting (Ustawienia / Optymalizacja)
  if ('processPriority' in data) out.processPriority = ['normal', 'above_normal', 'high'].includes(data.processPriority) ? data.processPriority : null;
  return out;
}

/** `t` puts the launcher's own words in names it makes up ("(kopia)") into the player's language – see i18n.js. */
function createInstances(paths, { t = (text) => text, lang = () => 'pl_pl' } = {}) {
  const dir = (id) => path.join(paths.instances, id);
  const file = (id) => path.join(dir(id), 'instance.json');
  const exists = (id) => /^[a-z0-9-]{1,48}$/.test(String(id)) && fs.existsSync(file(id));

  function get(id) {
    if (!exists(id)) return null;
    const data = readJson(file(id), null);
    return data ? { ...data, id, dir: dir(id) } : null;
  }

  function list() {
    if (!fs.existsSync(paths.instances)) return [];
    return fs
      .readdirSync(paths.instances, { withFileTypes: true })
      .filter((d) => d.isDirectory() && exists(d.name))
      .map((d) => get(d.name))
      .filter(Boolean)
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  function save(instance) {
    const { dir: _dir, id, ...data } = instance;
    writeJson(file(id), data);
    return get(id);
  }

  function create(data) {
    const fields = clean(data, { name: 'Nowa instancja', mcVersion: null, loader: 'vanilla', loaderVersion: null, icon: 'grass', memoryMb: null, jvmPreset: null, customJvmArgs: '', javaPath: '', optimized: false, hammerClient: true });
    if (!fields.mcVersion) throw new Error('Wybierz wersję Minecrafta.');
    let id = slug(fields.name);
    while (fs.existsSync(dir(id))) id = `${slug(fields.name).slice(0, 25)}-${crypto.randomBytes(3).toString('hex')}`;
    for (const sub of Object.values(CONTENT_DIRS)) fs.mkdirSync(path.join(dir(id), sub), { recursive: true });
    // The game starts in the launcher's language – Polish, or English in the English launcher (changeable in the game).
    // onboardAccessibility:false – no narrator onboarding screen before the main menu on the first start.
    const gameLang = /^[a-z]{2}_[a-z]{2}$/.test(String(lang?.() ?? '')) ? lang() : 'pl_pl';
    fs.writeFileSync(path.join(dir(id), 'options.txt'), `lang:${gameLang}\nonboardAccessibility:false\n`);
    const instance = { ...fields, id, createdAt: Date.now(), lastPlayed: null, playTimeMs: 0, versionId: null, installedFor: null, ...(data.modpack ? { modpack: data.modpack } : {}) };
    return save(instance);
  }

  function update(id, patch) {
    const current = get(id);
    if (!current) throw new Error('Nie ma takiej instancji.');
    const next = clean(patch, current);
    // Another version or loader means the game has to be prepared again before the next start.
    if (next.mcVersion !== current.mcVersion || next.loader !== current.loader || next.loaderVersion !== current.loaderVersion) {
      next.versionId = null;
      next.installedFor = null;
    }
    return save(next);
  }

  /** Internal fields the launcher sets itself (versionId, lastPlayed, play time …). */
  function patchInternal(id, patch) {
    const current = get(id);
    if (!current) return null;
    return save({ ...current, ...patch });
  }

  function remove(id) {
    if (!exists(id)) throw new Error('Nie ma takiej instancji.');
    fs.rmSync(dir(id), { recursive: true, force: true });
    return true;
  }

  function duplicate(id) {
    const current = get(id);
    if (!current) throw new Error('Nie ma takiej instancji.');
    const copy = create({ ...current, name: `${current.name} ${t('(kopia)')}`.slice(0, 48) });
    fs.cpSync(dir(id), dir(copy.id), { recursive: true, filter: (src) => path.basename(src) !== 'instance.json' });
    return patchInternal(copy.id, { versionId: current.versionId, installedFor: current.installedFor, optimized: current.optimized });
  }

  return { list, get, create, update, patchInternal, remove, duplicate, dir, contentDir: (id, type) => path.join(dir(id), CONTENT_DIRS[type] ?? 'mods') };
}

module.exports = { createInstances, clean, slug, LOADERS, ICONS, CONTENT_DIRS };
