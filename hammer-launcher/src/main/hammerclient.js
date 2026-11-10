'use strict';

/**
 * Hammer Client – the launcher's in-game mod (custom main menu, module panel, HUD, zoom). It ships inside the
 * launcher as a folder with one jar per Minecraft version and an index:
 *
 *   hammer-client/versions.json
 *     { "version": "2.0.0", "jars": [{ "file": "hammer-client-1.21.1-2.0.0.jar", "minecraft": ["1.21", "1.21.1"] }, …] }
 *
 * Before each start the jar made for the instance's game version is put into Fabric / Quilt instances as
 * mods/hammer-client.jar, together with Fabric API, which it needs. Turned off in the instance, or a game version
 * without a jar → the file is removed. Changing the game version of an instance swaps the jar by itself.
 * (Older launchers shipped a single jar for 1.21 / 1.21.1 – that layout is still accepted.)
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha1File } = require('./net');

const INDEX = 'versions.json';
const FILE = 'hammer-client.jar';
const LEGACY_VERSIONS = ['1.21', '1.21.1'];
const NONE = Object.freeze({ version: null, versions: Object.freeze([]), available: false, jarFor: () => null });

/**
 * Orders Minecraft versions the way players read them: 1.21.9 < 1.21.10 < 26.1 (numbers, not text).
 * Anything after the numbers ("-pre1", "-rc1", "-snapshot-7") makes a version older than its release.
 */
function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+(?:\.\d+)*)(.*)$/.exec(String(v ?? '').trim());
    return m ? { nums: m[1].split('.').map(Number), rest: m[2] } : { nums: [], rest: String(v ?? '') };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i += 1) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d;
  }
  if (Boolean(x.rest) !== Boolean(y.rest)) return x.rest ? -1 : 1;
  return x.rest.localeCompare(y.rest, 'en', { numeric: true });
}

/** A jar name from the index must be a plain file name – never a path out of the folder. */
const plainJar = (name) => typeof name === 'string' && /^[\w.+-]{1,120}\.jar$/i.test(name) && !name.includes('..');
const gameVersion = (v) => typeof v === 'string' && /^[\w.+-]{1,40}$/.test(v);

/** The index of a hammer-client folder, or null when there is no (readable) versions.json. */
function readIndex(dir) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, INDEX), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.jars)) return null;
  const jars = new Map(); // Minecraft version → jar path
  for (const entry of raw.jars) {
    if (!entry || !plainJar(entry.file) || !Array.isArray(entry.minecraft)) continue;
    for (const mc of entry.minecraft) if (gameVersion(mc) && !jars.has(mc)) jars.set(mc, path.join(dir, entry.file));
  }
  return {
    version: typeof raw.version === 'string' && /^[\w.+-]{1,32}$/.test(raw.version) ? raw.version : null,
    versions: [...jars.keys()].sort(compareVersions),
    available: [...new Set(jars.values())].some((file) => fs.existsSync(file)),
    jarFor: (mc) => jars.get(mc) ?? null,
  };
}

/**
 * What the launcher has of Hammer Client: { version, versions (oldest → newest), available, jarFor(mcVersion) }.
 * `dir` is the folder with versions.json; `jar` is the old single file for 1.21 / 1.21.1 (used when there is no
 * index). A missing or broken index never throws – then nothing is supported.
 */
function loadHammerClient({ dir = null, jar = null } = {}) {
  const index = dir ? readIndex(dir) : null;
  if (index) return index;
  if (jar) return { version: null, versions: [...LEGACY_VERSIONS], available: fs.existsSync(jar), jarFor: (mc) => (LEGACY_VERSIONS.includes(mc) ? jar : null) };
  return NONE;
}

/** Fabric or Quilt, on a Minecraft version the bundled mod has a jar for. */
function supports(instance, client = NONE) {
  return ['fabric', 'quilt'].includes(instance?.loader) && client.versions.includes(instance?.mcVersion);
}

/**
 * Puts the mod in place (or removes it). Returns { active, reason? }.
 * client: the result of loadHammerClient(). links: { discordUrl, shopUrl, brand } for
 * config/hammerclient-launcher.json (the mod's Discord / shop buttons).
 */
async function syncHammerClient({ instance, client = NONE, content, links = {} }) {
  const mods = path.join(instance.dir, 'mods');
  const target = path.join(mods, FILE);
  const supported = supports(instance, client);
  if (!supported || instance.hammerClient === false) {
    fs.rmSync(target, { force: true });
    return { active: false, reason: supported ? 'off' : 'unsupported' };
  }
  // Switched off by hand in the mods list (.disabled) – respect it.
  if (fs.existsSync(`${target}.disabled`)) return { active: false, reason: 'disabled' };
  const jar = client.jarFor(instance.mcVersion);
  if (!jar || !fs.existsSync(jar)) {
    // A jar left from another game version would stop the game from starting – better no menu than no game.
    fs.rmSync(target, { force: true });
    return { active: false, reason: 'missing' };
  }
  fs.mkdirSync(mods, { recursive: true });
  if (!fs.existsSync(target) || sha1File(target) !== sha1File(jar)) fs.copyFileSync(jar, target);

  const hasApi = fs.readdirSync(mods).some((f) => /^fabric-api.*\.jar$/i.test(f) || /^qfapi.*\.jar$/i.test(f));
  if (!hasApi) await content.install(instance, { projectId: 'fabric-api', type: 'mod' });

  const configDir = path.join(instance.dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const https = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : '');
  fs.writeFileSync(path.join(configDir, 'hammerclient-launcher.json'), JSON.stringify({ discordUrl: https(links.discordUrl), shopUrl: https(links.shopUrl), brand: links.brand || 'HammerShop' }, null, 2));
  return { active: true };
}

module.exports = { loadHammerClient, syncHammerClient, supports, compareVersions, FILE, INDEX, LEGACY_VERSIONS };
