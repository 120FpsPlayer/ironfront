'use strict';

/**
 * Everything the launcher does, wired together – without Electron, so it can be tested.
 * main.js gives it the Electron bits (window events, safeStorage, dialogs, the login window).
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createPaths } = require('./paths');
const { createSettings } = require('./settings');
const { createInstances } = require('./instances');
const versions = require('./versions');
const { prepareInstance, describeError } = require('./installer');
const { GameManager, buildLaunchOptions, countMods } = require('./launch');
const { createModrinth } = require('./modrinth');
const { createContent } = require('./content');
const { createModpacks } = require('./modpacks');
const { createOptimizer, writeOptionsPreset, setGpuPreference, recommend, OPTION_PRESETS } = require('./optimizer');
const { createProgress } = require('./progress');
const { ping } = require('./serverping');
const { loadNews } = require('./news');
const { systemInfo } = require('./system');
const { majorOf } = require('./java');
const { LOADER_NAMES } = require('./installer');

function createServices({ root, config, accounts, emit = () => {}, fetchFn = (...a) => fetch(...a), presence = null, gpuInfo = () => null, launchFn }) {
  const paths = createPaths(root);
  fs.mkdirSync(paths.instances, { recursive: true });
  const settings = createSettings(paths.settings);
  const instances = createInstances(paths);
  const modrinth = createModrinth({ fetchFn });
  const content = createContent({ modrinth, fetchFn });
  const modpacks = createModpacks({ modrinth, instances, fetchFn });
  const optimizer = createOptimizer({ modrinth, content });
  const games = new GameManager(launchFn ? { launchFn } : {});
  const busy = new Set(); // instances being prepared

  games.on('log', (e) => emit('game:log', e));
  games.on('state', (e) => emit('game:state', e));

  const need = (id) => {
    const instance = instances.get(id);
    if (!instance) throw new Error('Nie ma takiej instancji.');
    return instance;
  };

  /** First start: one ready-to-play instance (newest release, Fabric, optimisation on). */
  async function ensureDefaultInstance() {
    if (instances.list().length) return null;
    const def = config.defaultInstance ?? {};
    const [latest] = await versions.minecraftVersions();
    let loader = def.loader ?? 'fabric';
    if (loader !== 'vanilla' && !(await versions.loaderVersions(loader, latest.id).catch(() => [])).length) loader = 'vanilla';
    const instance = instances.create({ name: def.name ?? config.brand ?? 'HammerShop', mcVersion: latest.id, loader, icon: 'hammer', optimized: loader !== 'vanilla' && def.optimized !== false });
    settings.set({ selectedInstance: instance.id });
    return instance;
  }

  /** Install everything, then start the game. Progress → 'game:progress', states → 'game:state'. */
  async function launch(instanceId, { join } = {}) {
    let instance = need(instanceId);
    if (games.isRunning(instance.id)) throw new Error('Ta instancja już działa.');
    if (busy.has(instance.id)) throw new Error('Gra jest już przygotowywana.');
    busy.add(instance.id);
    const progress = createProgress((p) => emit('game:progress', { instanceId: instance.id, ...p }));
    try {
      const s = settings.get();
      const account = await accounts.launchAuth(s.selectedAccount);
      let prepared;
      try {
        prepared = await prepareInstance({ paths, instance, settings: s, progress, instances });
      } catch (err) {
        throw new Error(`Nie udało się przygotować gry: ${describeError(err)}. Sprawdź internet i spróbuj ponownie.`, { cause: err });
      }
      instance = need(instance.id);
      // Optimised instance: performance mods for this game version (once per version / loader).
      const optKey = `${instance.mcVersion}|${instance.loader}`;
      if (instance.optimized && instance.optimizedFor !== optKey && instance.loader !== 'vanilla') {
        progress.stage('mods', 'Instalacja modów wydajnościowych');
        try {
          const planned = await optimizer.plan(instance);
          await optimizer.installMods(instance, planned, { onProgress: (p) => progress.update('mods', p.done, p.total, p.label) });
          instance = instances.patchInternal(instance.id, { optimizedFor: optKey });
        } catch (err) {
          emit('toast', { kind: 'warning', text: `Nie udało się dodać modów wydajnościowych: ${err.message}` });
        }
      }
      if (s.gpuPreference) await setGpuPreference(prepared.javaPath);
      progress.stage('launch');
      const options = buildLaunchOptions({ paths, instance, settings: s, account, versionId: prepared.versionId, javaPath: prepared.javaPath, javaMajor: prepared.javaMajor, totalMem: os.totalmem(), modCount: countMods(instance.dir), config, join: join ? true : undefined });
      instances.patchInternal(instance.id, { lastPlayed: Date.now() });
      await games.start({
        instance,
        options,
        priority: s.processPriority,
        onExit: ({ playedMs }) => {
          const current = instances.get(instance.id);
          if (current) instances.patchInternal(instance.id, { playTimeMs: (current.playTimeMs ?? 0) + playedMs });
          presence?.clear();
        },
      });
      presence?.set({
        details: `Minecraft ${instance.mcVersion}${instance.loader !== 'vanilla' ? ` · ${LOADER_NAMES[instance.loader]}` : ''}`,
        state: `Instancja: ${instance.name}`,
        timestamps: { start: Date.now() },
        assets: { large_image: 'logo', large_text: config.name ?? 'HammerShop Launcher' },
        ...(config.website ? { buttons: [{ label: config.brand ?? 'HammerShop', url: config.website }] } : {}),
      });
      return { ok: true, memoryMb: options.maxMemory, versionId: prepared.versionId };
    } finally {
      busy.delete(instance.id);
    }
  }

  async function optimizerInfo(instanceId) {
    const instance = need(instanceId);
    const sys = systemInfo(gpuInfo());
    let javaMajor = 21;
    try {
      javaMajor = majorOf(JSON.parse(fs.readFileSync(path.join(paths.versions, instance.mcVersion, `${instance.mcVersion}.json`), 'utf8')));
    } catch {
      // not installed yet – assume a modern version
    }
    const modCount = countMods(instance.dir);
    return { system: sys, modCount, recommendation: recommend({ totalMem: sys.totalMem, cpuCores: sys.cpuCores, javaMajor }, instance, modCount), presets: Object.fromEntries(Object.entries(OPTION_PRESETS).map(([k, v]) => [k, v.label])) };
  }

  async function applyOptimization(instanceId, { mods = true, shaders = false, optionsPreset = null, memoryMb, jvmPreset } = {}) {
    let instance = need(instanceId);
    const patch = {};
    if (memoryMb !== undefined) patch.memoryMb = memoryMb;
    if (jvmPreset !== undefined) patch.jvmPreset = jvmPreset;
    if (Object.keys(patch).length) instance = instances.update(instance.id, patch);
    let result = { installed: [], skipped: [], warnings: [], missing: [] };
    if (mods && instance.loader !== 'vanilla') {
      const planned = await optimizer.plan(instance, { shaders });
      result = await optimizer.installMods(instance, planned, { onProgress: (p) => emit('task:progress', { instanceId, ...p }) });
      instances.patchInternal(instance.id, { optimized: true, optimizedFor: `${instance.mcVersion}|${instance.loader}` });
    }
    if (optionsPreset) writeOptionsPreset(instance.dir, optionsPreset);
    return result;
  }

  return {
    paths,
    settings,
    instances,
    modrinth,
    content,
    modpacks,
    optimizer,
    games,
    versions,
    ensureDefaultInstance,
    launch,
    optimizerInfo,
    applyOptimization,
    ping: (address) => ping(address),
    news: () => loadNews(config.newsUrl, { fetchFn }),
    system: () => systemInfo(gpuInfo()),
  };
}

module.exports = { createServices };
