'use strict';

/**
 * Mods, resource packs and shader packs of an instance. Files live in mods/, resourcepacks/, shaderpacks/;
 * a disabled file gets ".disabled" at the end (the game ignores it). Where a file came from (Modrinth project,
 * version, icon) is remembered in .hammershop/content.json, so the list shows names, icons and update badges.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./store');
const { download, safeName, sha1File } = require('./net');
const { pickVersion, primaryFile, loadersFor } = require('./modrinth');
const { readJarMeta } = require('./jarmeta');

const DIRS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' };
const EXT = { mod: ['.jar'], resourcepack: ['.zip'], shader: ['.zip'] };

function createContent({ modrinth, fetchFn }) {
  const indexFile = (instance) => path.join(instance.dir, '.hammershop', 'content.json');
  const loadIndex = (instance) => {
    const idx = readJson(indexFile(instance), {});
    for (const t of Object.keys(DIRS)) idx[t] ??= {};
    return idx;
  };
  const saveIndex = (instance, idx) => writeJson(indexFile(instance), idx);
  const folder = (instance, type) => path.join(instance.dir, DIRS[type] ?? DIRS.mod);
  const baseName = (file) => file.replace(/\.disabled$/, '');

  /** Files of one type: [{ file, enabled, size, title, version, projectId, iconUrl, sha1, description }]. */
  function list(instance, type = 'mod') {
    const dir = folder(instance, type);
    if (!fs.existsSync(dir)) return [];
    const idx = loadIndex(instance);
    let changed = false;
    const items = [];
    for (const file of fs.readdirSync(dir)) {
      const base = baseName(file);
      if (!EXT[type].some((e) => base.toLowerCase().endsWith(e))) continue;
      const full = path.join(dir, file);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      let meta = idx[type][base];
      if (!meta || meta.size !== stat.size) {
        // New file (copied by hand) or replaced: read its metadata once.
        const jar = type === 'mod' ? readJarMeta(full) : null;
        meta = { ...(meta?.size === stat.size ? meta : {}), size: stat.size, sha1: sha1File(full), title: jar?.name ?? meta?.title ?? base.replace(/\.(jar|zip)$/i, ''), versionNumber: jar?.version ?? meta?.versionNumber ?? null, description: jar?.description ?? meta?.description ?? '', modId: jar?.id ?? null };
        idx[type][base] = meta;
        changed = true;
      }
      items.push({ file: base, enabled: !file.endsWith('.disabled'), size: stat.size, ...meta });
    }
    // Forget files that were deleted by hand.
    for (const name of Object.keys(idx[type])) {
      if (!fs.existsSync(path.join(dir, name)) && !fs.existsSync(path.join(dir, `${name}.disabled`))) {
        delete idx[type][name];
        changed = true;
      }
    }
    if (changed) saveIndex(instance, idx);
    return items.sort((a, b) => String(a.title).localeCompare(String(b.title), 'pl'));
  }

  /** Looks up files that aren't linked to Modrinth yet (by SHA-1) and fills in names and icons. */
  async function identify(instance, type = 'mod') {
    const items = list(instance, type).filter((i) => !i.projectId && i.sha1);
    if (!items.length) return 0;
    const found = await modrinth.versionsByHashes(items.map((i) => i.sha1));
    const projects = await modrinth.projects([...new Set(Object.values(found).map((v) => v.project_id))]);
    const byId = new Map((projects ?? []).map((p) => [p.id, p]));
    const idx = loadIndex(instance);
    let n = 0;
    for (const item of items) {
      const v = found[item.sha1];
      if (!v) continue;
      const p = byId.get(v.project_id);
      idx[type][item.file] = { ...idx[type][item.file], projectId: v.project_id, versionId: v.id, versionNumber: v.version_number, title: p?.title ?? item.title, iconUrl: p?.icon_url ?? null, slug: p?.slug ?? null, description: p?.description ?? item.description };
      n += 1;
    }
    saveIndex(instance, idx);
    return n;
  }

  function installedProjects(instance) {
    const idx = loadIndex(instance);
    const map = new Map();
    for (const type of Object.keys(DIRS)) for (const [file, m] of Object.entries(idx[type])) if (m.projectId) map.set(m.projectId, { type, file, ...m });
    return map;
  }

  async function writeVersion(instance, type, version, project, onProgress) {
    const file = primaryFile(version);
    if (!file) throw new Error(`Brak pliku do pobrania: ${project?.title ?? version.name}`);
    const name = safeName(file.filename);
    const dir = folder(instance, type);
    await download(file.url, path.join(dir, name), { sha1: file.hashes?.sha1, fetchFn, onProgress });
    const idx = loadIndex(instance);
    idx[type][name] = { size: file.size, sha1: file.hashes?.sha1, projectId: version.project_id, versionId: version.id, versionNumber: version.version_number, title: project?.title ?? version.name, iconUrl: project?.icon_url ?? null, slug: project?.slug ?? null, description: project?.description ?? '' };
    saveIndex(instance, idx);
    return name;
  }

  function removeFile(instance, type, name) {
    const dir = folder(instance, type);
    for (const f of [name, `${name}.disabled`]) fs.rmSync(path.join(dir, safeName(f)), { force: true });
    const idx = loadIndex(instance);
    delete idx[type][name];
    saveIndex(instance, idx);
  }

  /**
   * Installs a Modrinth project (newest fitting version, or `versionId`) with its required dependencies.
   * Returns { installed: [titles], skipped: [titles], warnings: [text] }.
   */
  async function install(instance, { projectId, versionId, type = 'mod' }, { onProgress } = {}) {
    const result = { installed: [], skipped: [], warnings: [] };
    const have = installedProjects(instance);
    const loaders = loadersFor(type, instance.loader);
    if (type === 'mod' && instance.loader === 'vanilla') throw new Error('Mody wymagają loadera (Fabric, Quilt, NeoForge albo Forge) – zmień go w ustawieniach instancji.');
    const seen = new Set();

    async function one(pid, vid, depType, depth) {
      if (depth > 6 || (!pid && !vid)) return;
      const version = vid ? await modrinth.version(vid) : pickVersion(await modrinth.versions(pid, { loaders: depType === 'mod' ? loadersFor('mod', instance.loader) : loaders, gameVersions: [instance.mcVersion] }), { mcVersion: instance.mcVersion, loaders: depType === 'mod' ? loadersFor('mod', instance.loader) : loaders });
      const project = await modrinth.project(version?.project_id ?? pid);
      if (!version) {
        const msg = `${project?.title ?? pid}: brak wersji dla Minecrafta ${instance.mcVersion}${loaders.length ? ` (${loaders.join('/')})` : ''}.`;
        if (depth === 0) throw new Error(msg);
        result.warnings.push(`Wymagana zależność – ${msg}`);
        return;
      }
      if (seen.has(version.project_id)) return;
      seen.add(version.project_id);
      const existing = have.get(version.project_id);
      if (existing && (depth > 0 || existing.versionId === version.id)) {
        result.skipped.push(project?.title ?? existing.title);
      } else {
        if (existing) removeFile(instance, existing.type, existing.file); // another version of the same project
        await writeVersion(instance, depType, version, project, onProgress);
        result.installed.push(project?.title ?? version.name);
      }
      for (const dep of version.dependencies ?? []) {
        if (dep.dependency_type === 'incompatible' && dep.project_id && have.has(dep.project_id)) {
          result.warnings.push(`${project?.title} nie działa razem z ${have.get(dep.project_id).title} – wyłącz jeden z nich.`);
        }
        if (dep.dependency_type !== 'required') continue;
        if (dep.project_id && (have.has(dep.project_id) || seen.has(dep.project_id))) continue;
        await one(dep.project_id, dep.version_id && !dep.project_id ? dep.version_id : null, 'mod', depth + 1);
      }
    }

    await one(projectId, versionId, type, 0);
    return result;
  }

  function setEnabled(instance, type, name, enabled) {
    const dir = folder(instance, type);
    const on = path.join(dir, safeName(name));
    const off = `${on}.disabled`;
    if (enabled && fs.existsSync(off)) fs.renameSync(off, on);
    if (!enabled && fs.existsSync(on)) fs.renameSync(on, off);
    return true;
  }

  /** [{ file, title, current, latest: { id, versionNumber } }] – newer versions on Modrinth for this game version. */
  async function checkUpdates(instance, type = 'mod') {
    const items = list(instance, type).filter((i) => i.sha1);
    if (!items.length) return [];
    const loaders = loadersFor(type, instance.loader);
    const latest = await modrinth.updates(items.map((i) => i.sha1), { loaders, gameVersions: [instance.mcVersion] });
    return items
      .filter((i) => latest[i.sha1] && latest[i.sha1].id !== i.versionId && !(latest[i.sha1].files ?? []).some((f) => f.hashes?.sha1 === i.sha1))
      .map((i) => ({ file: i.file, title: i.title, current: i.versionNumber, latest: { id: latest[i.sha1].id, versionNumber: latest[i.sha1].version_number } }));
  }

  /** Replaces files with their newer versions (keeps them disabled if they were disabled). */
  async function update(instance, type, updates, { onProgress } = {}) {
    const done = [];
    for (const u of updates) {
      const version = await modrinth.version(u.latest.id);
      if (!version) continue;
      const wasEnabled = !fs.existsSync(path.join(folder(instance, type), `${u.file}.disabled`));
      const project = await modrinth.project(version.project_id);
      removeFile(instance, type, u.file);
      const name = await writeVersion(instance, type, version, project, onProgress);
      if (!wasEnabled) setEnabled(instance, type, name, false);
      done.push(project?.title ?? u.title);
    }
    return done;
  }

  return { list, identify, install, setEnabled, remove: (instance, type, name) => removeFile(instance, type, name), checkUpdates, update, installedProjects, folder };
}

module.exports = { createContent, DIRS };
