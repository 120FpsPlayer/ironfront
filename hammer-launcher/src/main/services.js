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
const { createCommunity } = require('./community');
const { listScreenshots, removeScreenshot, screenshotPath } = require('./gallery');
const { syncHammerClient, supports: hammerClientSupports, SUPPORTED: HAMMER_CLIENT_VERSIONS } = require('./hammerclient');
const serverList = require('./servers');
const worldSaves = require('./worlds');
const diskCleanup = require('./cleanup');
const { shareLog } = require('./logshare');

/**
 * `trash(path)` moves a file or folder to the system trash (Electron's shell.trashItem in main.js). Without it –
 * in the tests – worlds and backups are simply deleted.
 */
function createServices({ root, config, accounts, emit = () => {}, fetchFn = (...a) => fetch(...a), presence = null, gpuInfo = () => null, launchFn, clientJar = null, trash = null }) {
  const paths = createPaths(root);
  fs.mkdirSync(paths.instances, { recursive: true });
  const settings = createSettings(paths.settings);
  const instances = createInstances(paths);
  const modrinth = createModrinth({ fetchFn });
  const content = createContent({ modrinth, fetchFn });
  const modpacks = createModpacks({ modrinth, instances, fetchFn });
  const optimizer = createOptimizer({ modrinth, content });
  const games = new GameManager(launchFn ? { launchFn } : {});
  const community = createCommunity({ config, fetchFn });
  const busy = new Set(); // instances being prepared
  const worldTasks = new Set(); // instances with a world backup or restore in progress

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
    const list = await versions.minecraftVersions();
    // The version Hammer Client is made for (custom menu, HUD) – or the newest release.
    const mc = (def.mcVersion && list.find((v) => v.id === def.mcVersion)) || list[0];
    let loader = def.loader ?? 'fabric';
    if (loader !== 'vanilla' && !(await versions.loaderVersions(loader, mc.id).catch(() => [])).length) loader = 'vanilla';
    const instance = instances.create({ name: def.name ?? config.brand ?? 'HammerShop', mcVersion: mc.id, loader, icon: 'hammer', optimized: loader !== 'vanilla' && def.optimized !== false, hammerClient: true });
    settings.set({ selectedInstance: instance.id });
    return instance;
  }

  /**
   * Install everything, then start the game. Progress → 'game:progress', states → 'game:state'.
   * `server` ("host:port") joins that server, `world` (a folder in saves/) opens that world, `join` joins the
   * launcher's configured server. Returns { ok, memoryMb, versionId, worldOpened } – worldOpened is false when the
   * game version cannot open a world by itself and the player has to pick it in the game.
   */
  async function launch(instanceId, { join, server, world } = {}) {
    let instance = need(instanceId);
    if (games.isRunning(instance.id)) throw new Error('Ta instancja już działa.');
    if (busy.has(instance.id)) throw new Error('Gra jest już przygotowywana.');
    if (worldTasks.has(instance.id)) throw new Error('Poczekaj, aż launcher skończy kopię zapasową świata – potem uruchom grę.');
    const joinAddress = server ? serverList.cleanAddress(server) : undefined;
    const openWorld = world && !joinAddress ? path.basename(worldSaves.worldDir(instance, world)) : undefined;
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
      // Hammer Client (custom menu, module panel, HUD) for supported Fabric versions.
      try {
        const invite = await community.invite().catch(() => null);
        const res = await syncHammerClient({ instance, jar: clientJar, content, links: { discordUrl: invite ? `https://discord.gg/${invite}` : '', shopUrl: config.shopUrl, brand: config.brand } });
        if (!res.active && res.reason === 'missing' && instance.hammerClient !== false && hammerClientSupports(instance)) emit('toast', { kind: 'warning', text: 'Brak pliku Hammer Client w launcherze – gra uruchomi się bez własnego menu.' });
      } catch (err) {
        emit('toast', { kind: 'warning', text: `Nie udało się przygotować Hammer Client: ${err.message}` });
      }
      if (s.gpuPreference) await setGpuPreference(prepared.javaPath);
      progress.stage('launch');
      const options = buildLaunchOptions({ paths, instance, settings: s, account, versionId: prepared.versionId, javaPath: prepared.javaPath, javaMajor: prepared.javaMajor, totalMem: os.totalmem(), modCount: countMods(instance.dir), config, join: join ? true : undefined, server: joinAddress, world: openWorld });
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
      const invite = await community.invite().catch(() => null);
      const buttons = [invite && { label: 'Dołącz do Discorda', url: `https://discord.gg/${invite}` }, config.shopUrl && { label: `Sklep ${config.brand ?? 'HammerShop'}`.slice(0, 32), url: config.shopUrl }].filter(Boolean);
      presence?.set({
        details: `Minecraft ${instance.mcVersion}${instance.loader !== 'vanilla' ? ` · ${LOADER_NAMES[instance.loader]}` : ''}`,
        state: `Gra przez ${config.name ?? 'Hammer Launcher'}`,
        timestamps: { start: Date.now() },
        assets: { large_image: 'logo', large_text: config.name ?? 'Hammer Launcher' },
        ...(buttons.length ? { buttons } : {}),
      });
      return { ok: true, memoryMb: options.maxMemory, versionId: prepared.versionId, worldOpened: openWorld ? Boolean(options.quickPlaySingleplayer) : undefined };
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

  /** Changes that the running game would overwrite or trip over wait until it is closed. */
  const idle = (id, what) => {
    const instance = need(id);
    if (games.isRunning(instance.id) || busy.has(instance.id)) throw new Error(`Najpierw zamknij grę – ${what}.`);
    if (worldTasks.has(instance.id)) throw new Error('Poczekaj, aż skończy się kopia zapasowa albo przywracanie świata.');
    return instance;
  };

  /** One backup or restore per instance at a time; the game cannot be started in the middle of it. */
  async function worldTask(instance, label, fn) {
    worldTasks.add(instance.id);
    try {
      return await withProgress(label, fn);
    } finally {
      worldTasks.delete(instance.id);
    }
  }

  /**
   * Runs a long task with a progress bar in the sidebar ('task:progress', a few events per second at most).
   * A bar that was shown always ends at 100 % – also when the task fails – so it never hangs there.
   */
  async function withProgress(label, fn) {
    let last = 0;
    const update = ({ done, total }) => {
      const now = Date.now();
      if (now - last < 150) return;
      last = now;
      emit('task:progress', { label, done, total });
    };
    try {
      return await fn(update);
    } finally {
      if (last) emit('task:progress', { label, done: 1, total: 1 });
    }
  }

  /**
   * "Napraw instancję": the next start installs the mod loader again and checks every game file against Mojang's
   * checksums. Worlds, mods and settings are not touched.
   */
  function repairInstance(instanceId) {
    const instance = idle(instanceId, 'naprawa zmienia pliki, których gra właśnie używa');
    return instances.patchInternal(instance.id, { versionId: null, installedFor: null, verifyFiles: true });
  }

  /** The log of the last (or running) game of an instance; after a launcher restart the game's own latest.log. */
  function currentLog(instance) {
    const lines = games.logs(instance.id);
    if (lines.length) return lines.map((l) => l.line).join('\n');
    try {
      const file = path.join(instance.dir, 'logs', 'latest.log');
      const size = fs.statSync(file).size;
      const length = Math.min(size, 12 * 1024 * 1024);
      const buf = Buffer.alloc(length);
      const fd = fs.openSync(file, 'r');
      try {
        fs.readSync(fd, buf, 0, length, size - length);
      } finally {
        fs.closeSync(fd);
      }
      return buf.toString('utf8');
    } catch {
      return '';
    }
  }

  const cleanupOptions = () => ({ javaPaths: [settings.get().javaPath] });

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
    community,
    hammerClient: { versions: HAMMER_CLIENT_VERSIONS, available: () => Boolean(clientJar && fs.existsSync(clientJar)) },
    gallery: {
      list: (instanceId) => listScreenshots(instances, instanceId ? [need(instanceId)] : instances.list()),
      remove: (instanceId, file) => removeScreenshot(need(instanceId), file),
      file: (instanceId, file) => screenshotPath(need(instanceId), file),
    },
    repairInstance,
    servers: {
      list: (id) => serverList.list(need(id)),
      add: (id, data) => serverList.add(need(id), data ?? {}),
      update: (id, index, patch, expected) => serverList.update(need(id), index, patch ?? {}, expected),
      remove: (id, index, expected) => serverList.remove(need(id), index, expected),
      move: (id, from, to) => serverList.move(need(id), from, to),
    },
    worlds: {
      list: async (id) => worldSaves.list(need(id)),
      dir: (id, folder) => worldSaves.worldDir(need(id), folder),
      rename: async (id, folder, name) => worldSaves.rename(idle(id, 'gra mogłaby nadpisać zmianę nazwy'), folder, name),
      remove: async (id, folder) => worldSaves.remove(idle(id, 'świat może być właśnie otwarty'), folder, { trash }),
      backup: async (id, folder) => {
        const instance = idle(id, 'kopia otwartego świata mogłaby być niekompletna');
        return worldTask(instance, `Kopia zapasowa: ${folder}`, (onProgress) => worldSaves.backup(instance, folder, { onProgress }));
      },
      listBackups: async (id) => worldSaves.listBackups(need(id)),
      restoreBackup: async (id, file) => {
        const instance = idle(id, 'gra pokazałaby na liście świat przywrócony tylko w połowie');
        return worldTask(instance, 'Przywracanie świata z kopii', (onProgress) => worldSaves.restoreBackup(instance, file, { onProgress }));
      },
      removeBackup: async (id, file) => worldSaves.removeBackup(need(id), file, { trash }),
    },
    cleanup: {
      usage: () => diskCleanup.usage(paths, instances.list()),
      plan: () => diskCleanup.plan(paths, instances.list(), cleanupOptions()),
      apply: async (keys) => {
        // Nothing is deleted while a game runs or is being installed – it may be using exactly those files.
        if (games.running.size || busy.size) throw new Error('Najpierw zamknij grę – sprzątanie usuwa pliki, których gra może używać.');
        return diskCleanup.apply(paths, instances.list(), keys, cleanupOptions());
      },
    },
    shareLog: async (id) => shareLog(currentLog(need(id)), { fetchFn }),
  };
}

module.exports = { createServices };
