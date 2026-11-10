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
const { GameManager, buildLaunchOptions, countMods, memoryFor, priorityFor } = require('./launch');
const { createModrinth } = require('./modrinth');
const { createContent } = require('./content');
const { createModpacks } = require('./modpacks');
const { createOptimizer, writeOptionsPreset, setGpuPreference, recommend, OPTION_PRESETS } = require('./optimizer');
const { createProgress } = require('./progress');
const { ping } = require('./serverping');
const { loadNews } = require('./news');
const { systemInfo } = require('./system');
const { majorOf, javaMajorFor, detectJavaMajor } = require('./java');
const { jvmArgs, effectivePreset, zgcSupported } = require('./jvm');
const { LOADER_NAMES } = require('./installer');
const { createCommunity } = require('./community');
const { listScreenshots, removeScreenshot, screenshotPath } = require('./gallery');
const { loadHammerClient, syncHammerClient } = require('./hammerclient');
const serverList = require('./servers');
const worldSaves = require('./worlds');
const diskCleanup = require('./cleanup');
const { shareLog } = require('./logshare');
const { createBundles } = require('./bundles');
const { createSkins } = require('./skins');

/**
 * `trash(path)` moves a file or folder to the system trash (Electron's shell.trashItem in main.js). Without it –
 * in the tests – worlds and backups are simply deleted.
 * `clientDir` is the bundled Hammer Client folder (versions.json + one jar per Minecraft version); `clientJar` is the
 * old single jar for 1.21 / 1.21.1. `versionsApi` replaces the version lists in the tests.
 */
function createServices({ root, config, accounts, emit = () => {}, fetchFn = (...a) => fetch(...a), presence = null, gpuInfo = () => null, launchFn, clientDir = null, clientJar = null, trash = null, versionsApi = versions }) {
  const paths = createPaths(root);
  fs.mkdirSync(paths.instances, { recursive: true });
  const settings = createSettings(paths.settings);
  const instances = createInstances(paths);
  const modrinth = createModrinth({ fetchFn });
  const content = createContent({ modrinth, fetchFn });
  const modpacks = createModpacks({ modrinth, instances, fetchFn });
  const optimizer = createOptimizer({ modrinth, content });
  const bundles = createBundles({ modrinth, content });
  const skinStore = createSkins({ dir: path.join(root, 'skins'), fetchFn });
  const games = new GameManager(launchFn ? { launchFn } : {});
  const community = createCommunity({ config, fetchFn });
  const busy = new Set(); // instances being prepared
  // Read again each time it is needed – the index is tiny, and a rebuilt mod is picked up without a restart.
  const hammerClient = () => loadHammerClient({ dir: clientDir, jar: clientJar });
  const worldTasks = new Set(); // instances with a world backup or restore in progress

  games.on('log', (e) => emit('game:log', e));
  games.on('state', (e) => emit('game:state', e));

  const need = (id) => {
    const instance = instances.get(id);
    if (!instance) throw new Error('Nie ma takiej instancji.');
    return instance;
  };

  /**
   * First start: one ready-to-play instance – Fabric with optimisation on, on the newest Minecraft release the
   * bundled Hammer Client has a jar for (custom menu, HUD). Without the mod: the configured version, else the newest.
   */
  async function ensureDefaultInstance() {
    if (instances.list().length) return null;
    const def = config.defaultInstance ?? {};
    const list = await versionsApi.minecraftVersions();
    let loader = def.loader ?? 'fabric';
    const hasLoader = async (id) => (await versionsApi.loaderVersions(loader, id).catch(() => [])).length > 0;
    let mc = null;
    const client = hammerClient();
    if (client.available && ['fabric', 'quilt'].includes(loader)) {
      for (const id of [...client.versions].reverse()) {
        const release = list.find((v) => v.id === id && v.type === 'release');
        if (release && (await hasLoader(id))) {
          mc = release;
          break;
        }
      }
    }
    if (!mc) {
      mc = (def.mcVersion && list.find((v) => v.id === def.mcVersion)) || list[0];
      if (loader !== 'vanilla' && !(await hasLoader(mc.id))) loader = 'vanilla';
    }
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
        const res = await syncHammerClient({ instance, client: hammerClient(), content, links: { discordUrl: invite ? `https://discord.gg/${invite}` : '', shopUrl: config.shopUrl, brand: config.brand } });
        if (!res.active && res.reason === 'missing') emit('toast', { kind: 'warning', text: `Brak pliku Hammer Client dla Minecrafta ${instance.mcVersion} w launcherze – gra uruchomi się bez własnego menu.` });
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
        priority: priorityFor(instance, s),
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

  /** The Java an instance starts with: its own Java, else what the game version asks for (a guess until installed). */
  function javaOf(instance, s = settings.get()) {
    const own = instance.javaPath || s.javaPath;
    const ownMajor = own && fs.existsSync(own) ? detectJavaMajor(own) : null;
    if (ownMajor) return { major: ownMajor, known: true, own: true };
    try {
      return { major: majorOf(JSON.parse(fs.readFileSync(path.join(paths.versions, instance.mcVersion, `${instance.mcVersion}.json`), 'utf8'))), known: true, own: false };
    } catch {
      return { major: javaMajorFor(instance.mcVersion), known: false, own: false }; // not installed yet
    }
  }

  /**
   * Everything the Optymalizacja tab shows: the computer, the recommendation with its reasons ("Dlaczego?"), the
   * Java of the instance and the exact flags each preset would start the game with.
   */
  async function optimizerInfo(instanceId) {
    const instance = need(instanceId);
    const s = settings.get();
    const sys = systemInfo(gpuInfo());
    const java = javaOf(instance, s);
    const modCount = countMods(instance.dir);
    const memoryMb = memoryFor({ instance, settings: s, totalMem: sys.totalMem, modCount });
    const flags = (preset) => jvmArgs({ preset, javaMajor: java.major, memoryMb, modCount });
    return {
      system: sys,
      modCount,
      recommendation: recommend({ totalMem: sys.totalMem, cpuCores: sys.cpuCores, javaMajor: java.major, gpu: sys.gpus.length ? sys.gpus : sys.gpu }, instance, modCount),
      presets: Object.fromEntries(Object.entries(OPTION_PRESETS).map(([k, v]) => [k, v.label])),
      java: { major: java.major, known: java.known, own: java.own, zgc: zgcSupported(java.major) },
      jvm: { memoryMb, flags: { recommended: flags('recommended'), zgc: flags('zgc'), vanilla: flags('vanilla') } },
    };
  }

  /**
   * Applies what the tab asked for and says what was done: { installed, skipped, warnings, missing, summary }.
   * summary: { mods, memoryMb, memoryAuto, jvmPreset, javaMajor, optionsPreset, priority, turbo, shaders } – the
   * "Gotowe" window after "Zoptymalizuj wszystko" is built from it.
   */
  async function applyOptimization(instanceId, { mods = true, turbo = false, shaders = false, optionsPreset = null, memoryMb, jvmPreset } = {}) {
    let instance = need(instanceId);
    const patch = {};
    if (memoryMb !== undefined) patch.memoryMb = memoryMb;
    if (jvmPreset !== undefined) patch.jvmPreset = jvmPreset;
    if (Object.keys(patch).length) instance = instances.update(instance.id, patch);
    let result = { installed: [], skipped: [], warnings: [], missing: [] };
    const withMods = mods && instance.loader !== 'vanilla';
    if (withMods) {
      const planned = await optimizer.plan(instance, { turbo, shaders });
      result = await optimizer.installMods(instance, planned, { onProgress: (p) => emit('task:progress', { instanceId, ...p }) });
      instance = instances.patchInternal(instance.id, { optimized: true, optimizedFor: `${instance.mcVersion}|${instance.loader}` });
      // The newest builds of some Turbo mods ask for a current mod loader.
      if (turbo && instance.loaderVersion) result.warnings.push('Dodatki Turbo mogą wymagać najnowszego loadera – jeśli gra zgłosi niezgodne mody, ustaw w instancji wersję loadera „Najnowsza zalecana”.');
    }
    if (optionsPreset) writeOptionsPreset(instance.dir, optionsPreset);
    const s = settings.get();
    const java = javaOf(instance, s);
    const modCount = countMods(instance.dir);
    const preset = instance.jvmPreset || s.jvmPreset || 'recommended';
    const summary = {
      mods: withMods ? { installed: result.installed, already: result.skipped.length, missing: result.missing } : null,
      memoryMb: memoryFor({ instance, settings: s, totalMem: os.totalmem(), modCount }),
      memoryAuto: instance.memoryMb == null && s.memoryMb == null,
      jvmPreset: effectivePreset(preset, java.major),
      javaMajor: java.major,
      optionsPreset: optionsPreset ? { key: optionsPreset, label: OPTION_PRESETS[optionsPreset].label } : null,
      priority: priorityFor(instance, s),
      turbo: withMods && turbo,
      shaders: withMods && shaders,
    };
    return { ...result, summary };
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

  /**
   * Skins and capes of the selected account. Each change answers with the new state; the account's head in the
   * launcher follows it. A token the Minecraft services refuse is refreshed once (force) before the player is asked
   * to sign in again.
   */
  async function withSkins(fn) {
    const id = settings.get().selectedAccount;
    const res = await fn((force) => accounts.launchAuth(id, { force }));
    accounts.setSkin?.(res.account.id, { skinUrl: res.skin?.url ?? null, skinVariant: res.skin?.variant ?? 'classic' });
    return res;
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
    versions: versionsApi,
    ensureDefaultInstance,
    launch,
    optimizerInfo,
    applyOptimization,
    ping: (address) => ping(address),
    news: () => loadNews(config.newsUrl, { fetchFn }),
    system: () => systemInfo(gpuInfo()),
    community,
    /** { versions: every supported Minecraft version, oldest → newest; version: the mod's version; available }. */
    hammerClient: {
      info: () => {
        const { versions: list, version, available } = hammerClient();
        return { versions: [...list], version, available };
      },
    },
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
    bundles: {
      list: () => bundles.list(),
      plan: (id, bundleId) => bundles.plan(need(id), bundleId),
      install: (id, bundleId) => bundles.install(need(id), bundleId, { onProgress: (p) => emit('task:progress', { instanceId: id, ...p }) }),
    },
    skins: {
      get: () => withSkins((auth) => skinStore.state(auth)),
      upload: ({ png, variant, name } = {}) => withSkins((auth) => skinStore.upload(auth, { png, variant, name })),
      use: (id, variant) => withSkins((auth) => skinStore.use(auth, id, variant)),
      reset: () => withSkins((auth) => skinStore.reset(auth)),
      cape: (capeId) => withSkins((auth) => skinStore.setCape(auth, capeId ?? null)),
      forget: (id) => skinStore.forget(id),
      inspect: (png, name) => skinStore.inspect(png, name),
    },
  };
}

module.exports = { createServices };
