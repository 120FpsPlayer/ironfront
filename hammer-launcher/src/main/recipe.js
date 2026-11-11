'use strict';

/**
 * Udostępnianie instancji – an instance "recipe": what somebody needs to build the same instance on their own
 * computer. Nothing is uploaded anywhere: the recipe names things, the other launcher fetches them from Modrinth.
 *
 *   {
 *     "format": "hammerpack", "v": 1,
 *     "name": "Survival z ekipą", "mc": "1.21.1", "loader": "fabric", "loaderVersion": "0.16.10" | null,
 *     "hammerClient": true,
 *     "content": [{ "type": "mod" | "resourcepack" | "shader", "project": "<Modrinth id>", "version": "<Modrinth id>",
 *                   "file": "sodium-fabric-0.6.5.jar", "off": true (only when switched off) }],
 *     "servers": [{ "name": "…", "address": "host[:port]" }],
 *     "options": "<options.txt>"                    (only when the player chose to include it)
 *   }
 *
 * It travels as a file – <name>.hammerpack, the JSON above, pretty – or as a code: "HL1." + base64url of the
 * raw-deflate-compressed JSON (only when the code has at most 6000 characters).
 *
 * A recipe is untrusted input. Everything is checked against a strict schema with limits before anything is done,
 * a code is never inflated past 2 MB, and nothing in it is ever used as a path or an address: files are fetched
 * from Modrinth by id (the file name in the recipe is only shown), and an options.txt goes to the new instance's
 * own options.txt and nowhere else. No Electron here.
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { LOADERS } = require('./instances');
const { cleanAddress } = require('./servers');
const { primaryFile } = require('./modrinth');
const { cleanFolderName, mapLimit } = require('./fsutil');
const { FILE: HAMMER_CLIENT_JAR } = require('./hammerclient');

const FORMAT = 'hammerpack';
const VERSION = 1;
const PREFIX = 'HL1.';
const EXTENSION = 'hammerpack';
const MAX_CODE = 6000; // characters of a code – a bigger recipe is shared as a file
const MAX_SIZE = 2 * 1024 * 1024; // bytes of a .hammerpack file and of the JSON a code inflates to
const MAX_NAME = 48;
const MAX_CONTENT = 500;
const MAX_SERVERS = 100;
const MAX_SERVER_NAME = 48;
const MAX_FILE_NAME = 160;
const MAX_OPTIONS = 64 * 1024;
const TYPES = ['mod', 'resourcepack', 'shader'];
const TYPE_EXT = { mod: ['.jar'], resourcepack: ['.zip'], shader: ['.zip'] };
const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', forge: 'Forge', vanilla: 'Vanilla' };
/** Modrinth ids are base62 numbers – eight characters today, never more than eleven. */
const MODRINTH_ID = /^[0-9A-Za-z]{8,11}$/;
const MC_VERSION = /^[0-9A-Za-z][\w.\-+ ]{0,39}$/;
const LOADER_VERSION = /^[0-9A-Za-z][\w.+-]{0,63}$/;

/** What is wrong with a recipe, in Polish – shown to the player as it is. */
class RecipeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RecipeError';
  }
}
const bad = (message) => new RecipeError(message);
const NOT_A_RECIPE = 'To nie jest przepis instancji Hammer Launchera.';
const BROKEN_CODE = 'Ten kod jest uszkodzony albo niepełny – skopiuj go jeszcze raz w całości.';

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
/** One line of plain text: control and text-direction characters become spaces. */
const line = (text) => String(text).replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();

/** A file name that is only ever shown: one plain name with the extension its kind has. */
function plainFile(name, type) {
  return (
    typeof name === 'string' &&
    name.length >= 5 &&
    name.length <= MAX_FILE_NAME &&
    !/[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) &&
    !name.startsWith('.') &&
    name.trim() === name &&
    TYPE_EXT[type].some((e) => name.toLowerCase().endsWith(e))
  );
}

/**
 * Checks a parsed recipe and returns a clean copy with the known fields only – everything else is dropped.
 * Throws RecipeError with what is wrong.
 */
function validate(data) {
  if (!isObject(data) || data.format !== FORMAT) throw bad(NOT_A_RECIPE);
  if (data.v !== VERSION) throw bad(Number.isInteger(data.v) && data.v > VERSION ? 'Ten przepis pochodzi z nowszej wersji Hammer Launchera – zaktualizuj launcher, żeby go wczytać.' : NOT_A_RECIPE);

  if (typeof data.name !== 'string') throw bad('Przepis nie ma nazwy instancji.');
  const name = line(data.name);
  if (!name) throw bad('Przepis nie ma nazwy instancji.');
  if (name.length > MAX_NAME) throw bad(`Nazwa instancji w przepisie jest za długa (najwyżej ${MAX_NAME} znaków).`);

  if (typeof data.mc !== 'string' || !MC_VERSION.test(data.mc)) throw bad('Przepis ma nieprawidłową wersję Minecrafta.');
  if (!LOADERS.includes(data.loader)) throw bad('Przepis ma nieznany loader modów.');
  let loaderVersion = null;
  if (data.loaderVersion != null) {
    if (typeof data.loaderVersion !== 'string' || !LOADER_VERSION.test(data.loaderVersion)) throw bad('Przepis ma nieprawidłową wersję loadera.');
    if (data.loader !== 'vanilla') loaderVersion = data.loaderVersion;
  }
  if (data.hammerClient != null && typeof data.hammerClient !== 'boolean') throw bad(NOT_A_RECIPE);

  const rawContent = data.content ?? [];
  if (!Array.isArray(rawContent)) throw bad(NOT_A_RECIPE);
  if (rawContent.length > MAX_CONTENT) throw bad(`Przepis ma za dużo dodatków (najwyżej ${MAX_CONTENT}).`);
  const content = [];
  const seen = new Set();
  for (const item of rawContent) {
    if (!isObject(item) || !TYPES.includes(item.type)) throw bad('Przepis zawiera dodatek nieznanego rodzaju.');
    if (typeof item.project !== 'string' || !MODRINTH_ID.test(item.project) || typeof item.version !== 'string' || !MODRINTH_ID.test(item.version)) throw bad('Przepis zawiera dodatek z nieprawidłowym identyfikatorem Modrinth.');
    if (!plainFile(item.file, item.type)) throw bad('Przepis zawiera dodatek z nieprawidłową nazwą pliku.');
    if (item.off != null && typeof item.off !== 'boolean') throw bad(NOT_A_RECIPE);
    if (seen.has(item.project)) continue; // the same project twice – the first one counts
    seen.add(item.project);
    content.push({ type: item.type, project: item.project, version: item.version, file: item.file, ...(item.off ? { off: true } : {}) });
  }

  const rawServers = data.servers ?? [];
  if (!Array.isArray(rawServers)) throw bad(NOT_A_RECIPE);
  if (rawServers.length > MAX_SERVERS) throw bad(`Przepis ma za dużo serwerów (najwyżej ${MAX_SERVERS}).`);
  const servers = [];
  for (const item of rawServers) {
    if (!isObject(item) || typeof item.address !== 'string' || (item.name != null && typeof item.name !== 'string')) throw bad('Przepis zawiera nieprawidłowy serwer.');
    let address;
    try {
      address = cleanAddress(item.address);
    } catch {
      throw bad('Przepis zawiera serwer z nieprawidłowym adresem – dozwolony jest tylko adres w postaci host albo host:port.');
    }
    const serverName = line(item.name ?? '');
    if (serverName.length > MAX_SERVER_NAME) throw bad(`Nazwa serwera w przepisie jest za długa (najwyżej ${MAX_SERVER_NAME} znaków).`);
    servers.push({ name: serverName || address, address });
  }

  let options = null;
  if (data.options != null) {
    if (typeof data.options !== 'string') throw bad(NOT_A_RECIPE);
    if (Buffer.byteLength(data.options) > MAX_OPTIONS) throw bad('Ustawienia gry w przepisie są za duże.');
    // Plain text only: lines of "key:value". Nothing but tabs and line breaks below the space.
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data.options)) throw bad('Ustawienia gry w przepisie nie są zwykłym tekstem.');
    options = data.options.replace(/\r\n?/g, '\n');
  }

  return { format: FORMAT, v: VERSION, name, mc: data.mc, loader: data.loader, loaderVersion, hammerClient: Boolean(data.hammerClient), content, servers, ...(options != null ? { options } : {}) };
}

/** The JSON of a file or of an inflated code → a checked recipe. */
function parseJson(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    throw bad(NOT_A_RECIPE);
  }
  return validate(data);
}

/** A recipe as the file's text (pretty JSON) and as a code – code is null when it would be longer than MAX_CODE. */
function encode(recipe) {
  const clean = validate(recipe);
  const code = PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(clean)), { level: 9 }).toString('base64url');
  return { json: `${JSON.stringify(clean, null, 2)}\n`, code: code.length <= MAX_CODE ? code : null, codeLength: code.length };
}

/**
 * Reads a pasted code. Spaces, line breaks and the quotes or backticks Discord puts around copied text are
 * dropped first. The length is checked before anything is decoded, and the inflated JSON may not pass MAX_SIZE.
 */
function decode(text) {
  const code = String(text ?? '').slice(0, MAX_CODE * 4).replace(/[\s`'"„”]/g, '');
  if (!code) throw bad('Wklej kod instancji.');
  if (!code.startsWith(PREFIX)) throw bad('To nie wygląda na kod instancji. Kod zaczyna się od „HL1.” – skopiuj go w całości.');
  if (code.length > MAX_CODE) throw bad(`Ten kod jest za długi (najwyżej ${MAX_CODE} znaków). Poproś o plik .${EXTENSION}.`);
  const body = code.slice(PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw bad(BROKEN_CODE);
  let json;
  try {
    json = zlib.inflateRawSync(Buffer.from(body, 'base64url'), { maxOutputLength: MAX_SIZE }).toString('utf8');
  } catch (err) {
    throw bad(err?.code === 'ERR_BUFFER_TOO_LARGE' ? 'Ten kod rozpakowuje się do zbyt dużych danych – to nie jest prawdziwy przepis instancji.' : BROKEN_CODE);
  }
  return parseJson(json);
}

/** Reads a .hammerpack file: a regular file with that extension, at most MAX_SIZE. */
function readFile(file) {
  if (typeof file !== 'string' || path.extname(file).toLowerCase() !== `.${EXTENSION}`) throw bad(`To nie jest plik .${EXTENSION}.`);
  let stat = null;
  try {
    stat = fs.statSync(file);
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) throw bad('Nie udało się otworzyć tego pliku.');
  if (stat.size > MAX_SIZE) throw bad(`Ten plik jest za duży jak na przepis instancji (najwyżej ${MAX_SIZE / 1024 / 1024} MB).`);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw bad('Nie udało się otworzyć tego pliku.');
  }
  return parseJson(text);
}

/** What a recipe holds, for the preview: counts, never the content itself. */
function summary(recipe) {
  const count = (type) => recipe.content.filter((c) => c.type === type).length;
  return { name: recipe.name, mc: recipe.mc, loader: recipe.loader, loaderVersion: recipe.loaderVersion, hammerClient: recipe.hammerClient, mods: count('mod'), resourcepacks: count('resourcepack'), shaders: count('shader'), servers: recipe.servers.length, options: recipe.options != null };
}

/**
 * Builds the recipe of an instance from what is in it.
 *   items    [{ type, file, projectId, versionId, enabled, title }] – the lists of content.list()
 *   servers  [{ name, address }]
 *   options  the text of options.txt, or null to leave it out
 * Returns { recipe, excluded: [{ type, file, title }], optionsLeftOut } – excluded are files that did not come
 * from Modrinth and so cannot be shared; optionsLeftOut is true when the settings file is too big for a recipe.
 */
function build({ instance, items = [], servers = [], options = null }) {
  const content = [];
  const excluded = [];
  const seen = new Set();
  for (const item of items) {
    if (!TYPES.includes(item.type)) continue;
    if (item.type === 'mod' && item.file === HAMMER_CLIENT_JAR) continue; // the launcher's own mod – "hammerClient" below
    const shareable = typeof item.projectId === 'string' && MODRINTH_ID.test(item.projectId) && typeof item.versionId === 'string' && MODRINTH_ID.test(item.versionId);
    if (!shareable) {
      excluded.push({ type: item.type, file: String(item.file), title: line(item.title ?? item.file).slice(0, 80) });
      continue;
    }
    if (seen.has(item.projectId)) continue;
    seen.add(item.projectId);
    const ext = TYPE_EXT[item.type][0];
    content.push({ type: item.type, project: item.projectId, version: item.versionId, file: plainFile(item.file, item.type) ? item.file : `${item.projectId}${ext}`, ...(item.enabled === false ? { off: true } : {}) });
  }
  if (content.length > MAX_CONTENT) throw bad(`Ta instancja ma ponad ${MAX_CONTENT} dodatków z Modrinth – tyle nie zmieści się w przepisie.`);
  const list = [];
  for (const s of servers.slice(0, MAX_SERVERS)) {
    try {
      const address = cleanAddress(s.address);
      list.push({ name: line(s.name ?? '').slice(0, MAX_SERVER_NAME) || address, address });
    } catch {
      // an address the game accepted but a recipe does not – left out
    }
  }
  const text = typeof options === 'string' ? options.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : null;
  const optionsLeftOut = text != null && Buffer.byteLength(text) > MAX_OPTIONS;
  const recipe = validate({
    format: FORMAT,
    v: VERSION,
    name: line(instance.name).slice(0, MAX_NAME) || 'Instancja',
    mc: instance.mcVersion,
    loader: instance.loader,
    loaderVersion: instance.loader === 'vanilla' ? null : (instance.loaderVersion ?? null),
    hammerClient: instance.hammerClient !== false,
    content,
    servers: list,
    ...(text != null && !optionsLeftOut ? { options: text } : {}),
  });
  return { recipe, excluded, optionsLeftOut };
}

/** "<nazwa>.hammerpack" – a file name every system accepts. */
const fileName = (name) => `${cleanFolderName(name, 'instancja')}.${EXTENSION}`;

/**
 * Exporting and importing with the launcher's own parts:
 *   instances, content (content.js), modrinth (modrinth.js), versionsApi (versions.js – the real version lists),
 *   serverList (servers.js).
 */
function createSharing({ instances, content, modrinth, versionsApi, serverList }) {
  /**
   * The recipe of an instance: { recipe, summary, excluded, json, code, codeLength, optionsLeftOut, fileName }.
   * Files that are not linked to Modrinth yet are looked up there first (by checksum), so mods added by hand
   * that do come from Modrinth can be shared too; without the network the lists are used as they are.
   */
  async function exportRecipe(instance, { options = false, identify = true } = {}) {
    const items = [];
    for (const type of TYPES) {
      if (identify) await content.identify(instance, type).catch(() => 0);
      for (const item of content.list(instance, type)) items.push({ ...item, type });
    }
    let text = null;
    if (options) {
      try {
        text = fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8');
      } catch {
        text = null;
      }
    }
    const built = build({ instance, items, servers: serverList.list(instance), options: text });
    return { ...built, summary: summary(built.recipe), ...encode(built.recipe), fileName: fileName(built.recipe.name) };
  }

  /**
   * Checks a recipe against the real version lists: the Minecraft version must exist, the loader must have a build
   * for it. A loader version that is not on the list (any more) is not used – the newest recommended one is.
   * Returns { loaderVersion, notes: [text] }.
   */
  async function check(recipe) {
    const notes = [];
    let versions;
    try {
      versions = await versionsApi.minecraftVersions({ snapshots: true });
    } catch {
      throw bad('Nie udało się sprawdzić wersji Minecrafta z przepisu – sprawdź internet i spróbuj ponownie.');
    }
    if (!versions.some((v) => v.id === recipe.mc)) throw bad(`Przepis prosi o Minecrafta ${recipe.mc}, a takiej wersji gry nie ma.`);
    let loaderVersion = null;
    if (recipe.loader !== 'vanilla') {
      let list;
      try {
        list = await versionsApi.loaderVersions(recipe.loader, recipe.mc);
      } catch {
        throw bad(`Nie udało się sprawdzić wersji ${LOADER_NAMES[recipe.loader]} – sprawdź internet i spróbuj ponownie.`);
      }
      if (!list.length) throw bad(`${LOADER_NAMES[recipe.loader]} nie ma wersji dla Minecrafta ${recipe.mc}.`);
      if (recipe.loaderVersion && list.some((v) => v.version === recipe.loaderVersion)) loaderVersion = recipe.loaderVersion;
      else if (recipe.loaderVersion) notes.push(`${LOADER_NAMES[recipe.loader]} ${recipe.loaderVersion} nie ma już na liście – launcher użyje najnowszej zalecanej wersji.`);
    }
    return { loaderVersion, notes };
  }

  /** A name no other instance has: "Nazwa", "Nazwa (2)", "Nazwa (3)" … (the cloud copy tells instances apart by name). */
  function freeInstanceName(name) {
    const taken = new Set(instances.list().map((i) => i.name));
    if (!taken.has(name)) return name;
    for (let n = 2; ; n += 1) {
      const suffix = ` (${n})`;
      const candidate = `${name.slice(0, MAX_NAME - suffix.length)}${suffix}`;
      if (!taken.has(candidate)) return candidate;
    }
  }

  /**
   * Builds a new instance from a checked recipe. onProgress({ label, done, total }).
   * Returns { instance, installed, missing: [{ type, file, reason }], notes } – missing are items that are no
   * longer on Modrinth (or do not match what the recipe says about them) and files that could not be fetched;
   * everything else is installed all the same.
   */
  async function install(recipe, { onProgress } = {}) {
    const { loaderVersion, notes } = await check(recipe);
    // Everything Modrinth knows about the content, asked before anything is created.
    onProgress?.({ label: 'Sprawdzanie dodatków na Modrinth', done: 0, total: 0 });
    const versions = new Map((await modrinth.versionsByIds(recipe.content.map((c) => c.version))).map((v) => [v.id, v]));
    const projects = new Map((await modrinth.projects([...new Set([...versions.values()].map((v) => v.project_id))])).map((p) => [p.id, p]));

    const created = instances.create({ name: freeInstanceName(recipe.name), mcVersion: recipe.mc, loader: recipe.loader, loaderVersion, icon: 'rocket', optimized: false, hammerClient: recipe.hammerClient });
    try {
      // The recipe's settings go to this instance's own options.txt – the path never comes from the recipe.
      if (recipe.options != null) fs.writeFileSync(path.join(created.dir, 'options.txt'), recipe.options);
      if (recipe.servers.length) serverList.replace(created, recipe.servers);

      const missing = [];
      let installed = 0;
      let done = 0;
      const total = recipe.content.length;
      const step = () => onProgress?.({ label: `Pobieranie dodatków (${done}/${total})`, done, total });
      if (total) step();
      await mapLimit(recipe.content, 4, async (item) => {
        const version = versions.get(item.version);
        const file = version ? primaryFile(version) : null;
        let reason = null;
        if (!version || !file) reason = 'gone';
        else if (version.project_id !== item.project || !TYPE_EXT[item.type].some((e) => String(file.filename).toLowerCase().endsWith(e))) reason = 'mismatch';
        if (!reason) {
          try {
            const name = await content.installVersion(created, item.type, version, projects.get(version.project_id) ?? null);
            if (item.off) content.setEnabled(created, item.type, name, false);
            installed += 1;
          } catch (err) {
            reason = 'failed';
            missing.push({ type: item.type, file: item.file, reason, error: String(err?.message ?? err).slice(0, 200) });
          }
        } else missing.push({ type: item.type, file: item.file, reason });
        done += 1;
        step();
      });
      return { instance: instances.get(created.id), installed, missing, notes };
    } catch (err) {
      instances.remove(created.id);
      throw err;
    }
  }

  return { exportRecipe, check, install, freeInstanceName };
}

module.exports = { createSharing, validate, parseJson, encode, decode, readFile, build, summary, fileName, RecipeError, FORMAT, VERSION, PREFIX, EXTENSION, MAX_CODE, MAX_SIZE, MAX_NAME, MAX_CONTENT, MAX_SERVERS, MAX_OPTIONS, MODRINTH_ID, MC_VERSION, LOADER_NAMES, TYPES };
