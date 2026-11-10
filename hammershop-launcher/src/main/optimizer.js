'use strict';

/**
 * Optimisation: one click makes an instance run noticeably better.
 *   1. Performance mods from Modrinth that exist for the instance's game version and loader (Sodium, Lithium,
 *      FerriteCore, ModernFix, EntityCulling, ImmediatelyFast, …) – with their required dependencies.
 *   2. RAM and JVM flags picked for the computer (see jvm.js).
 *   3. Optional graphics presets written to options.txt (Max FPS / Balanced / Quality).
 *   4. Windows laptops: Java is told to use the faster graphics card (Windows "Graphics settings").
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pickVersion, loadersFor } = require('./modrinth');
const { recommendMemory } = require('./jvm');

/** The catalogue – slugs on Modrinth. Availability is checked per game version + loader. */
const PERFORMANCE_MODS = [
  { slug: 'sodium', name: 'Sodium', why: 'Nowy silnik renderowania – zwykle 2–3× więcej FPS.', group: 'core' },
  { slug: 'embeddium', name: 'Embeddium', why: 'Sodium dla Forge – szybsze renderowanie.', group: 'core', insteadOf: 'sodium' },
  { slug: 'lithium', name: 'Lithium', why: 'Szybsza logika gry: moby, fizyka, redstone.', group: 'core' },
  { slug: 'ferrite-core', name: 'FerriteCore', why: 'Gra zużywa nawet o połowę mniej pamięci RAM.', group: 'core' },
  { slug: 'modernfix', name: 'ModernFix', why: 'Szybsze uruchamianie i mniej zużytej pamięci.', group: 'core' },
  { slug: 'entityculling', name: 'EntityCulling', why: 'Nie rysuje mobów i skrzyń, których nie widać.', group: 'core' },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', why: 'Szybsze rysowanie tekstu, map i interfejsu.', group: 'core' },
  { slug: 'moreculling', name: 'More Culling', why: 'Pomija niewidoczne ściany bloków i liście.', group: 'core' },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', why: 'Mniej FPS w tle – laptop się nie grzeje, gdy grasz w innym oknie.', group: 'core' },
  { slug: 'krypton', name: 'Krypton', why: 'Lżejsza obsługa sieci na serwerach.', group: 'core' },
  { slug: 'badoptimizations', name: 'BadOptimizations', why: 'Drobne optymalizacje oświetlenia i nieba.', group: 'core' },
  { slug: 'noisium', name: 'Noisium', why: 'Szybsze generowanie nowych chunków w singleplayerze.', group: 'core' },
  { slug: 'iris', name: 'Iris Shaders', why: 'Shadery na Sodium – ładniejsza grafika, gdy masz mocny komputer.', group: 'shaders' },
];

const OPTION_PRESETS = {
  fps: {
    label: 'Maks. FPS',
    values: { graphicsMode: '0', renderDistance: '8', simulationDistance: '6', maxFps: '260', enableVsync: 'false', entityShadows: 'false', particles: '2', biomeBlendRadius: '0', ao: 'false', renderClouds: '"false"', mipmapLevels: '2', entityDistanceScaling: '0.75' },
  },
  balanced: {
    label: 'Zrównoważony',
    values: { graphicsMode: '1', renderDistance: '12', simulationDistance: '8', maxFps: '144', enableVsync: 'false', entityShadows: 'true', particles: '1', biomeBlendRadius: '2', ao: 'true', renderClouds: '"fast"', mipmapLevels: '4', entityDistanceScaling: '1.0' },
  },
  quality: {
    label: 'Jakość',
    values: { graphicsMode: '1', renderDistance: '16', simulationDistance: '10', maxFps: '260', enableVsync: 'true', entityShadows: 'true', particles: '0', biomeBlendRadius: '5', ao: 'true', renderClouds: '"true"', mipmapLevels: '4', entityDistanceScaling: '1.0' },
  },
};

/** options.txt with some keys changed – every other line (key bindings, sounds…) stays as it was. */
function mergeOptions(text, values) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.length);
  const seen = new Set();
  const out = lines.map((line) => {
    const i = line.indexOf(':');
    const key = i > 0 ? line.slice(0, i) : null;
    if (key && key in values) {
      seen.add(key);
      return `${key}:${values[key]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}:${v}`);
  return `${out.join('\n')}\n`;
}

function writeOptionsPreset(instanceDir, preset) {
  const p = OPTION_PRESETS[preset];
  if (!p) throw new Error('Nieznany preset grafiki.');
  const file = path.join(instanceDir, 'options.txt');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'lang:pl_pl\n';
  fs.writeFileSync(file, mergeOptions(current, p.values));
  return file;
}

/** Windows: run Java on the high-performance GPU (the same switch as Settings → System → Display → Graphics). */
function setGpuPreference(javaPath, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32' || !javaPath) return Promise.resolve(false);
  return new Promise((resolve) => {
    run('reg', ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', javaPath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true }, (err) => resolve(!err));
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n], n);
      }
    }),
  );
  return out;
}

function createOptimizer({ modrinth, content }) {
  /**
   * What optimisation would do for an instance: [{ slug, name, why, group, available, installed, version }].
   * A mod with `insteadOf` is only offered when the mod it replaces isn't available.
   */
  async function plan(instance, { shaders = false } = {}) {
    if (instance.loader === 'vanilla') return { supported: false, mods: [] };
    const loaders = loadersFor('mod', instance.loader);
    const have = content.installedProjects(instance);
    const wanted = PERFORMANCE_MODS.filter((m) => m.group === 'core' || (shaders && m.group === 'shaders'));
    const found = await mapLimit(wanted, 4, async (m) => {
      try {
        const version = pickVersion(await modrinth.versions(m.slug, { loaders, gameVersions: [instance.mcVersion] }), { mcVersion: instance.mcVersion, loaders });
        return { ...m, available: Boolean(version), version: version ? { id: version.id, projectId: version.project_id, number: version.version_number } : null, installed: Boolean(version && have.has(version.project_id)) };
      } catch {
        return { ...m, available: false, version: null, installed: false, error: true };
      }
    });
    const bySlug = new Map(found.map((m) => [m.slug, m]));
    const mods = found.filter((m) => !(m.insteadOf && bySlug.get(m.insteadOf)?.available));
    return { supported: true, mods };
  }

  /** Installs the available mods of a plan; returns { installed, skipped, warnings, missing }. */
  async function installMods(instance, planned, { onProgress } = {}) {
    const result = { installed: [], skipped: [], warnings: [], missing: [] };
    const todo = planned.mods.filter((m) => m.available && !m.installed);
    let n = 0;
    for (const m of todo) {
      onProgress?.({ label: `Instalacja: ${m.name}`, done: n, total: todo.length });
      try {
        const r = await content.install(instance, { projectId: m.version.projectId, versionId: m.version.id, type: 'mod' });
        result.installed.push(...r.installed);
        result.skipped.push(...r.skipped);
        result.warnings.push(...r.warnings);
      } catch (err) {
        result.warnings.push(`${m.name}: ${err.message}`);
      }
      n += 1;
      onProgress?.({ label: `Instalacja: ${m.name}`, done: n, total: todo.length });
    }
    result.missing = planned.mods.filter((m) => !m.available).map((m) => m.name);
    return result;
  }

  return { plan, installMods };
}

/** Advice for the Optimisation tab, from the computer's specs and the instance. */
function recommend({ totalMem, cpuCores = 4, javaMajor = 21 }, instance, modCount = 0) {
  const memoryMb = recommendMemory(totalMem, { modCount, loader: instance.loader });
  const zgc = javaMajor >= 21 && totalMem >= 16 * 1024 ** 3 && cpuCores >= 6 && modCount >= 100;
  return { memoryMb, jvmPreset: zgc ? 'zgc' : 'recommended', optionsPreset: totalMem <= 8 * 1024 ** 3 || cpuCores <= 4 ? 'fps' : 'balanced' };
}

module.exports = { createOptimizer, mergeOptions, writeOptionsPreset, setGpuPreference, recommend, PERFORMANCE_MODS, OPTION_PRESETS };
