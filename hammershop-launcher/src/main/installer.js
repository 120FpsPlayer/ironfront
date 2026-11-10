'use strict';

/**
 * Gets an instance ready to play: the Minecraft version (game jar, libraries, assets), the Java runtime it needs,
 * and the mod loader (Fabric, Quilt, NeoForge or Forge). Already installed parts are checked and skipped, so a
 * second start takes a second. Progress goes to the window through `progress` (see progress.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const { Version } = require('@xmcl/core');
const installer = require('@xmcl/installer');
const { Agent, interceptors } = require('undici');
const { ensureJava, componentOf, majorOf } = require('./java');
const { loaderVersions, pickLoaderVersion } = require('./versions');

/** Parallel downloads with retries and redirects (@xmcl reads the redirect history from the request context). */
function createDispatcher(connections = 16) {
  return new Agent({ connections, pipelining: 1, connect: { timeout: 20_000 } }).compose(interceptors.retry({ maxRetries: 3, minTimeout: 500 }), interceptors.redirect({ maxRedirections: 5 }));
}

/** A version JSON that exists and parses – an interrupted download leaves an empty or cut-off file behind. */
function validVersionJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))?.id ? true : false;
  } catch {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return false;
  }
}

const NET_CODES = {
  ENOTFOUND: 'Brak internetu albo serwer jest nieosiągalny',
  EAI_AGAIN: 'Brak internetu albo serwer jest nieosiągalny',
  ECONNREFUSED: 'Serwer odrzucił połączenie',
  ECONNRESET: 'Połączenie zostało przerwane',
  ETIMEDOUT: 'Serwer nie odpowiada',
  UND_ERR_CONNECT_TIMEOUT: 'Serwer nie odpowiada',
  UND_ERR_HEADERS_TIMEOUT: 'Serwer nie odpowiada',
  UND_ERR_SOCKET: 'Połączenie zostało przerwane',
  ENOSPC: 'Brak miejsca na dysku',
  EACCES: 'Brak uprawnień do zapisu w folderze launchera',
  EPERM: 'Brak uprawnień do zapisu (plik może być otwarty w innym programie lub blokowany przez antywirusa)',
  EBUSY: 'Plik jest używany przez inny program',
};

/** One readable Polish sentence for download / install errors (AggregateError has no message of its own). */
function describeError(err) {
  const flat = (e) => (e instanceof AggregateError || Array.isArray(e?.errors) ? e.errors.flatMap(flat) : [e]);
  const parts = new Set();
  for (const e of flat(err)) {
    const inner = e?.cause ?? e?.error ?? e;
    const code = inner?.code ?? e?.code;
    const url = e?.url ?? e?.urls?.[0] ?? inner?.url;
    let host = '';
    try {
      host = url ? new URL(String(url)).host : '';
    } catch {
      host = '';
    }
    let text;
    if (NET_CODES[code]) text = NET_CODES[code];
    else if (/Checksum/i.test(e?.name ?? '')) text = 'Pobrany plik jest uszkodzony';
    else if (inner?.statusCode ?? e?.statusCode) text = `Serwer zwrócił błąd ${inner?.statusCode ?? e?.statusCode}`;
    else text = (e?.message || inner?.message || e?.name || '').trim();
    if (text) parts.add(host ? `${text} (${host})` : text);
  }
  const list = [...parts].slice(0, 3);
  return list.length ? list.join('; ') : 'Nieznany błąd pobierania';
}

const versionJsonPath = (paths, id) => path.join(paths.versions, id, `${id}.json`);

/** Vanilla Minecraft: version JSON + jar + libraries + assets. */
async function ensureMinecraft(paths, mcVersion, { progress, dispatcher } = {}) {
  const resolvedPath = versionJsonPath(paths, mcVersion);
  progress?.stage('minecraft');
  if (!validVersionJson(resolvedPath)) {
    const list = await installer.getVersionList({ dispatcher });
    const meta = list.versions.find((v) => v.id === mcVersion);
    if (!meta) throw new Error(`Nie ma takiej wersji Minecrafta: ${mcVersion}`);
    const task = installer.installTask(meta, paths.root, { side: 'client', dispatcher });
    await task.startAndWait(progress?.context('minecraft', task));
  } else {
    // Installed before: check libraries and assets (fast when everything is there, repairs missing files).
    const resolved = await Version.parse(paths.root, mcVersion);
    const task = installer.installDependenciesTask(resolved, { side: 'client', dispatcher });
    await task.startAndWait(progress?.context('minecraft', task, 'Sprawdzanie plików gry'));
  }
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

/** The mod loader on top of vanilla; returns the version id to launch (e.g. fabric-loader-0.16.9-1.21.1). */
async function ensureLoader(paths, instance, { java, progress, dispatcher } = {}) {
  const { loader, mcVersion } = instance;
  if (loader === 'vanilla') return mcVersion;
  progress?.stage('loader', `Instalacja ${LOADER_NAMES[loader] ?? loader}`);
  const version = instance.loaderVersion || pickLoaderVersion(await loaderVersions(loader, mcVersion));
  if (!version) throw new Error(`${LOADER_NAMES[loader] ?? loader} nie wspiera Minecrafta ${mcVersion}.`);
  let id;
  if (loader === 'fabric') id = await installer.installFabric({ minecraftVersion: mcVersion, version, minecraft: paths.root, dispatcher });
  else if (loader === 'quilt') id = await installer.installQuiltVersion({ minecraftVersion: mcVersion, version, minecraft: paths.root, dispatcher });
  else if (loader === 'neoforge') {
    const task = installer.installNeoForgedTask('neoforge', version, paths.root, { java, side: 'client', dispatcher });
    id = await task.startAndWait(progress?.context('loader', task, 'Instalacja NeoForge'));
  } else if (loader === 'forge') {
    const task = installer.installForgeTask({ version, mcversion: mcVersion }, paths.root, { java, side: 'client', dispatcher });
    id = await task.startAndWait(progress?.context('loader', task, 'Instalacja Forge'));
  } else throw new Error(`Nieznany loader: ${loader}`);
  // Libraries of the loader itself.
  const resolved = await Version.parse(paths.root, id);
  const libs = installer.installLibrariesTask(resolved, { dispatcher });
  await libs.startAndWait(progress?.context('loader', libs, 'Pobieranie bibliotek loadera'));
  return { id, version };
}

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge', forge: 'Forge', vanilla: 'Vanilla' };

/**
 * Everything an instance needs before launch. Returns { versionId, javaPath, javaMajor }.
 * `instance.javaPath` / `settings.javaPath` override the downloaded Java.
 */
async function prepareInstance({ paths, instance, settings, progress, instances }) {
  const dispatcher = createDispatcher(settings.concurrentDownloads);
  try {
    const vanilla = await ensureMinecraft(paths, instance.mcVersion, { progress, dispatcher });
    const component = componentOf(vanilla);
    const custom = instance.javaPath || settings.javaPath;
    const javaPath = custom && fs.existsSync(custom) ? custom : await ensureJava(paths, component, { progress, dispatcher });
    let versionId = instance.mcVersion;
    let loaderVersion = instance.loaderVersion;
    const key = `${instance.mcVersion}|${instance.loader}|${instance.loaderVersion ?? ''}`;
    if (instance.loader !== 'vanilla') {
      if (instance.versionId && instance.installedFor === key && validVersionJson(versionJsonPath(paths, instance.versionId))) {
        versionId = instance.versionId;
        const resolved = await Version.parse(paths.root, versionId);
        const libs = installer.installLibrariesTask(resolved, { dispatcher });
        await libs.startAndWait(progress?.context('loader', libs, 'Sprawdzanie bibliotek loadera'));
      } else {
        const res = await ensureLoader(paths, instance, { java: javaPath, progress, dispatcher });
        versionId = res.id;
        loaderVersion = res.version;
      }
    }
    instances?.patchInternal(instance.id, { versionId, installedFor: key, loaderVersion: instance.loaderVersion ?? null, installedLoaderVersion: loaderVersion ?? null });
    return { versionId, javaPath, javaMajor: majorOf(vanilla), component };
  } finally {
    progress?.flush();
    dispatcher.close().catch(() => null);
  }
}

module.exports = { prepareInstance, ensureMinecraft, ensureLoader, createDispatcher, describeError, validVersionJson, LOADER_NAMES, versionJsonPath };
