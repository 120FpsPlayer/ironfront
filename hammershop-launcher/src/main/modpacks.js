'use strict';

/**
 * Modrinth modpacks (.mrpack): a zip with modrinth.index.json (which files to download, with hashes) and
 * overrides/ (configs, resource packs …). Installing one creates a new instance with the right Minecraft
 * version and loader, downloads every client file and copies the overrides.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { download, insideDir, safeName } = require('./net');
const { primaryFile } = require('./modrinth');

const LOADER_KEYS = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', neoforge: 'neoforge', forge: 'forge' };

/** Reads modrinth.index.json from a .mrpack and checks it. */
function readIndex(zip) {
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new Error('To nie jest paczka Modrinth (.mrpack) – brak modrinth.index.json.');
  const index = JSON.parse(entry.getData().toString('utf8'));
  if (index.game !== 'minecraft' || !index.dependencies?.minecraft) throw new Error('Paczka nie jest dla Minecrafta.');
  return index;
}

function loaderOf(dependencies) {
  for (const [key, loader] of Object.entries(LOADER_KEYS)) if (dependencies[key]) return { loader, loaderVersion: dependencies[key] };
  return { loader: 'vanilla', loaderVersion: null };
}

function createModpacks({ modrinth, instances, fetchFn }) {
  /**
   * Installs a pack from a .mrpack file. onProgress({ label, done, total }).
   * Returns the new instance.
   */
  async function installFile(file, { name, icon, modpack, onProgress } = {}) {
    const zip = new AdmZip(file);
    const index = readIndex(zip);
    const { loader, loaderVersion } = loaderOf(index.dependencies);
    const instance = instances.create({ name: name ?? index.name ?? 'Paczka modów', mcVersion: index.dependencies.minecraft, loader, loaderVersion, icon: icon ?? 'star', modpack: modpack ?? { name: index.name, version: index.versionId } });
    try {
      const files = (index.files ?? []).filter((f) => f.env?.client !== 'unsupported');
      let done = 0;
      onProgress?.({ label: `Pobieranie plików paczki (0/${files.length})`, done, total: files.length });
      // A few downloads at a time.
      const queue = [...files];
      const worker = async () => {
        for (let f = queue.shift(); f; f = queue.shift()) {
          const target = insideDir(instance.dir, f.path);
          let lastError;
          for (const url of f.downloads ?? []) {
            try {
              await download(url, target, { sha1: f.hashes?.sha1, fetchFn });
              lastError = null;
              break;
            } catch (err) {
              lastError = err;
            }
          }
          if (lastError || !(f.downloads ?? []).length) throw lastError ?? new Error(`Brak adresu pobierania: ${f.path}`);
          done += 1;
          onProgress?.({ label: `Pobieranie plików paczki (${done}/${files.length})`, done, total: files.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
      // overrides/ then client-overrides/ (the client ones win).
      for (const prefix of ['overrides/', 'client-overrides/']) {
        for (const entry of zip.getEntries()) {
          if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
          const target = insideDir(instance.dir, entry.entryName.slice(prefix.length));
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, entry.getData());
        }
      }
      return instances.get(instance.id);
    } catch (err) {
      instances.remove(instance.id);
      throw err;
    }
  }

  /** Installs a pack straight from Modrinth (newest version, or a chosen one). */
  async function installFromModrinth({ projectId, versionId }, { onProgress } = {}) {
    const project = await modrinth.project(projectId);
    const version = versionId ? await modrinth.version(versionId) : (await modrinth.versions(projectId))[0];
    const file = primaryFile(version);
    if (!project || !version || !file) throw new Error('Nie udało się pobrać paczki z Modrinth.');
    const tmp = path.join(os.tmpdir(), `hammershop-${Date.now()}-${safeName(file.filename)}`);
    onProgress?.({ label: `Pobieranie paczki ${project.title}`, done: 0, total: 0 });
    await download(file.url, tmp, { sha1: file.hashes?.sha1, fetchFn });
    try {
      return await installFile(tmp, { name: project.title, modpack: { projectId: project.id, versionId: version.id, name: project.title, version: version.version_number, iconUrl: project.icon_url }, onProgress });
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  return { installFile, installFromModrinth };
}

module.exports = { createModpacks, readIndex, loaderOf };
