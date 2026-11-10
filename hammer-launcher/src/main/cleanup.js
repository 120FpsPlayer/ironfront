'use strict';

/**
 * Miejsce na dysku – what the launcher's folder is made of and what can be freed without losing anything:
 *   logs      logs and crash reports older than a week (every instance's logs/ and crash-reports/, launcher logs/)
 *   cache     the launcher's cache/
 *   versions  versions/<id> folders no instance uses (they are downloaded again when needed)
 *   runtimes  Java runtimes no used version asks for
 * Libraries and assets are shared between versions in ways that are easy to get wrong – they are never touched.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { walk, dirSize, mapLimit } = require('./fsutil');
const { componentOf, runtimeDir, MAJOR } = require('./java');

const WEEK = 7 * 24 * 3600 * 1000;

const size = async (dir) => (await dirSize(dir)).size;

async function folders(dir) {
  try {
    return (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/** Sizes in bytes: { total, instances: [{ id, name, size }], versions, libraries, assets, runtime, runtimes: [{ name, size }], cache, logs }. */
async function usage(paths, instances) {
  const shared = (name) => size(path.join(paths.root, name));
  const [perInstance, versions, libraries, assets, runtimes, cache, logs] = await Promise.all([
    mapLimit(instances, 2, async (i) => ({ id: i.id, name: i.name, size: await size(i.dir) })),
    shared('versions'),
    shared('libraries'),
    shared('assets'),
    folders(paths.runtime).then((names) => mapLimit(names, 2, async (name) => ({ name, size: await size(path.join(paths.runtime, name)) }))),
    size(paths.cache),
    size(paths.logs),
  ]);
  const runtime = runtimes.reduce((sum, r) => sum + r.size, 0);
  const total = perInstance.reduce((sum, i) => sum + i.size, 0) + versions + libraries + assets + runtime + cache + logs;
  return { total, instances: perInstance.sort((a, b) => b.size - a.size), versions, libraries, assets, runtime, runtimes, cache, logs };
}

/**
 * The versions and Java runtimes the instances need. An instance uses its vanilla version (mcVersion) and its loader
 * version (versionId); a version JSON can inherit from another one and names its Java in javaVersion.component.
 * `certain` is false when a used version JSON cannot be read – then nobody knows which Java it needs.
 */
function referenced(paths, instances, { javaPaths = [] } = {}) {
  const versions = new Set();
  const runtimes = new Set();
  let certain = true;
  const visit = (id, depth = 0) => {
    if (typeof id !== 'string' || !id || versions.has(id) || depth > 10) return;
    versions.add(id);
    const file = path.join(paths.versions, id, `${id}.json`);
    if (!fs.existsSync(file)) return; // not installed (yet) – nothing of it is on the disk
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      certain = false;
      return;
    }
    if (json?.inheritsFrom) visit(String(json.inheritsFrom), depth + 1);
    if (json?.javaVersion?.component || !json?.inheritsFrom) runtimes.add(path.basename(runtimeDir(paths, componentOf(json))));
  };
  for (const instance of instances) {
    visit(instance.mcVersion);
    visit(instance.versionId);
  }
  // A custom Java path that points into runtime/ keeps that runtime as well.
  for (const java of [...javaPaths, ...instances.map((i) => i.javaPath)]) {
    if (!java) continue;
    const rel = path.relative(paths.runtime, path.resolve(String(java)));
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) runtimes.add(rel.split(path.sep)[0]);
  }
  return { versions, runtimes, certain };
}

/** The groups with what exactly would be deleted: [{ key, size, count, items: [{ name, size }], targets: [{ path, size }] }]. */
async function scan(paths, instances, { now = Date.now(), javaPaths } = {}) {
  const groups = [];
  const add = (key, targets, items = []) => {
    if (targets.length) groups.push({ key, size: targets.reduce((sum, t) => sum + t.size, 0), count: targets.length, items, targets });
  };

  const old = [];
  const collect = (f) => {
    if (f.mtimeMs < now - WEEK) old.push({ path: f.path, size: f.size });
  };
  // A logs or cache folder that is a link to somewhere else is left alone – only real folders are cleaned.
  const real = { followRoot: false };
  for (const instance of instances) for (const sub of ['logs', 'crash-reports']) await walk(path.join(instance.dir, sub), collect, real);
  await walk(paths.logs, collect, real);
  add('logs', old);

  const cached = [];
  const cacheIsFolder = (await fsp.lstat(paths.cache).catch(() => null))?.isDirectory();
  for (const entry of cacheIsFolder ? await fsp.readdir(paths.cache, { withFileTypes: true }).catch(() => []) : []) {
    const full = path.join(paths.cache, entry.name);
    const bytes = entry.isDirectory() ? await size(full) : await fsp.lstat(full).then((s) => s.size, () => 0);
    cached.push({ path: full, size: bytes });
  }
  add('cache', cached);

  const used = referenced(paths, instances, { javaPaths });
  const unusedVersions = [];
  for (const name of await folders(paths.versions)) if (!used.versions.has(name)) unusedVersions.push({ name, path: path.join(paths.versions, name), size: await size(path.join(paths.versions, name)) });
  add('versions', unusedVersions, unusedVersions.map(({ name, size: bytes }) => ({ name, size: bytes })));

  if (used.certain) {
    const unusedRuntimes = [];
    for (const name of await folders(paths.runtime)) if (!used.runtimes.has(name)) unusedRuntimes.push({ name, path: path.join(paths.runtime, name), size: await size(path.join(paths.runtime, name)) });
    add('runtimes', unusedRuntimes, unusedRuntimes.map(({ name, size: bytes }) => ({ name, size: bytes, java: MAJOR[name] ?? null })));
  }
  return groups;
}

/** What can be freed safely: { total, groups: [{ key, size, count, items }] } – only groups with something in them. */
async function plan(paths, instances, options) {
  const groups = (await scan(paths, instances, options)).map(({ targets: _targets, ...group }) => group);
  return { total: groups.reduce((sum, g) => sum + g.size, 0), groups };
}

/**
 * Deletes exactly the chosen groups. The list is worked out again here – nothing is deleted because the window said
 * so, only what a fresh scan finds. Returns { freed, removed, failed }.
 */
async function apply(paths, instances, selectedKeys, options) {
  const keys = new Set(Array.isArray(selectedKeys) ? selectedKeys.map(String) : []);
  const root = path.resolve(paths.root);
  const result = { freed: 0, removed: 0, failed: 0 };
  for (const group of await scan(paths, instances, options)) {
    if (!keys.has(group.key)) continue;
    for (const target of group.targets) {
      const rel = path.relative(root, path.resolve(target.path));
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue; // never outside the launcher's folder
      try {
        await fsp.rm(target.path, { recursive: true, force: true });
        result.freed += target.size;
        result.removed += 1;
      } catch {
        result.failed += 1;
      }
    }
  }
  return result;
}

module.exports = { usage, plan, apply, referenced };
