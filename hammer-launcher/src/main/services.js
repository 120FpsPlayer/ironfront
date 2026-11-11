'use strict';

/**
 * Everything the launcher does, wired together – without Electron, so it can be tested.
 * main.js gives it the Electron bits (window events, safeStorage, dialogs, the login window).
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createPaths } = require('./paths');
const { createSettings, sanitize, plusOnly } = require('./settings');
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
const { createSkins, MAX_LIBRARY, PLUS_LIBRARY } = require('./skins');
const { createPlus, cleanUuid } = require('./plus');
const { createShopApi } = require('./shopapi');
const cloudSync = require('./cloud');
const { createBackgrounds, createMenuBackground, EXTENSIONS } = require('./background');
const { loadCapes } = require('./capes');
const autoBackup = require('./autobackup');

/**
 * `trash(path)` moves a file or folder to the system trash (Electron's shell.trashItem in main.js). Without it –
 * in the tests – worlds and backups are simply deleted.
 * `clientDir` is the bundled Hammer Client folder (versions.json + one jar per Minecraft version); `clientJar` is the
 * old single jar for 1.21 / 1.21.1. `versionsApi` replaces the version lists in the tests.
 * `pickFile({ title, filters })` opens the system's file dialog and resolves with a path or null (Electron's
 * dialog in main.js). `convertImage(data, { maxWidth, maxHeight })` makes PNG bytes that fit that size out of a
 * picture (Electron's nativeImage). `capes` is the list of Hammer+ capes (capes.json).
 */
function createServices({ root, config, accounts, emit = () => {}, fetchFn = (...a) => fetch(...a), presence = null, gpuInfo = () => null, launchFn, clientDir = null, clientJar = null, trash = null, versionsApi = versions, officialDir = null, pickFile = null, convertImage = null, capes = loadCapes(), now = () => Date.now() }) {
  const paths = createPaths(root);
  fs.mkdirSync(paths.instances, { recursive: true });
  const store = createSettings(paths.settings);
  const instances = createInstances(paths);

  /* ── Hammer+ ── */
  const allAccounts = () => accounts.list?.() ?? [];
  /** The account the launcher plays with: the selected one, else the first (like the PLAY button). */
  const selectedAccount = () => allAccounts().find((a) => a.id === store.get().selectedAccount) ?? allAccounts()[0] ?? null;
  const plus = createPlus({ file: path.join(root, 'plus.json'), publicKey: config.plusPublicKey, selected: selectedAccount, accounts: allAccounts, now });
  const plusKey = (st) => JSON.stringify([st.active, st.until, st.reason, st.account?.id ?? null, st.selected?.id ?? null]);
  let plusSeen = plusKey(plus.status());
  let plusTimer = null;
  /**
   * Called whenever Hammer+ may have changed (a code pasted or removed, another account picked): tells the window
   * when it did, and wakes up again at the moment the code runs out – so Hammer+ ends while the launcher is open.
   */
  function plusChanged() {
    const st = plus.status();
    clearTimeout(plusTimer);
    if (st.active && st.until) {
      plusTimer = setTimeout(plusChanged, Math.min(Math.max(st.until * 1000 - now(), 0) + 500, 2 ** 31 - 1));
      plusTimer.unref?.();
    }
    if (plusKey(st) !== plusSeen) {
      plusSeen = plusKey(st);
      emit('plus:status', st);
    }
    return st;
  }
  /** The settings with the Hammer+ gate in front: a change that switches a paid feature on needs Hammer+. */
  const settings = {
    get: store.get,
    set(patch) {
      const before = store.get();
      const locked = plusOnly(before, sanitize(patch ?? {}, before));
      if (locked.length) plus.need(locked[0]);
      const saved = store.set(patch);
      if (saved.selectedAccount !== before.selectedAccount) plusChanged();
      return saved;
    },
  };
  const shop = createShopApi({ config, fetchFn });
  const backgrounds = createBackgrounds({ dir: path.join(root, 'theme') });
  const menuBackground = createMenuBackground({ dir: path.join(root, 'theme'), convert: convertImage });

  const modrinth = createModrinth({ fetchFn });
  const content = createContent({ modrinth, fetchFn });
  const modpacks = createModpacks({ modrinth, instances, fetchFn });
  const optimizer = createOptimizer({ modrinth, content });
  const bundles = createBundles({ modrinth, content });
  const skinStore = createSkins({ dir: path.join(root, 'skins'), fetchFn, limit: () => (plus.status().active ? PLUS_LIBRARY : MAX_LIBRARY) });
  const games = new GameManager(launchFn ? { launchFn } : {});
  const community = createCommunity({ config, fetchFn });
  const busy = new Set(); // instances being prepared
  // Read again each time it is needed – the index is tiny, and a rebuilt mod is picked up without a restart.
  const hammerClient = () => loadHammerClient({ dir: clientDir, jar: clientJar });
  const worldTasks = new Set(); // instances with a world backup or restore in progress
  const sessionWork = new Set(); // what still runs after a game session: automatic backups, the cloud copy
  /** The cloud never reads or writes an instance whose game is running or being prepared. */
  const inGame = (instance) => games.isRunning(instance.id) || busy.has(instance.id);
  const cloud = cloudSync.createCloud({
    file: path.join(root, 'cloud.json'),
    api: shop,
    now,
    local: (previous) => cloudSync.collect({ settings: settings.get(), instances: instances.list(), skip: inGame, previous }),
    take: (doc) => cloudSync.apply(doc, { settings, instances: instances.list(), skip: inGame }),
  });
  plusChanged(); // arms the timer for a code that ends while the launcher is open

  games.on('log', (e) => emit('game:log', e));
  games.on('state', (e) => emit('game:state', e));
  // After every game session – also one that crashed – the automatic world backups and the cloud copy (Hammer+).
  games.on('state', (e) => {
    const instance = e.state === 'exited' || e.state === 'crashed' ? instances.get(e.instanceId) : null;
    if (instance) afterSession(instance, e.playedMs ?? 0);
  });

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

  const serwerow = (n) => `${n} ${n === 1 ? 'serwer' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'serwery' : 'serwerów'}`;

  /**
   * The server list is a file in the game folder, not part of the Microsoft account – a new instance would start
   * with an empty list. Once per instance the servers of the player's official Minecraft are added to it.
   */
  function seedServers(instance) {
    if (!officialDir || instance.serversImported || games.isRunning(instance.id)) return instance;
    let result;
    try {
      result = serverList.importFrom(instance, officialDir);
    } catch {
      return instance; // e.g. the list could not be saved – try again next time
    }
    if (!result.found) return instance; // no official Minecraft here (yet)
    if (result.added) emit('toast', { kind: 'ok', text: `Dodano ${serwerow(result.added)} z Twojego Minecrafta do instancji „${instance.name}”.` });
    return instances.patchInternal(instance.id, { serversImported: true }) ?? instance;
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
      instance = seedServers(need(instance.id));
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
        shareCape().catch(() => null); // not awaited: the shop being slow or offline never holds the game back
        const res = await syncClient(instance);
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

  /**
   * Puts Hammer Client into the instance (or takes it out) and writes what the mod needs to know from the
   * launcher: the Discord / shop links and Hammer+ of the account that plays – active until when, the cape, the
   * shop API. With Hammer+ the player's own menu picture goes along (config/hammerclient/menu.png); without it
   * the launcher takes its picture back.
   */
  async function syncClient(instance) {
    const invite = await community.invite().catch(() => null);
    const st = plus.status();
    const res = await syncHammerClient({ instance, client: hammerClient(), content, links: { discordUrl: invite ? `https://discord.gg/${invite}` : '', shopUrl: config.shopUrl, brand: config.brand }, plus: { active: st.active, until: st.until }, cape: settings.get().hammerCape, api: shop.base() });
    try {
      menuBackground.deliver(instance, { active: st.active && res.active });
    } catch (err) {
      emit('toast', { kind: 'warning', text: `Nie udało się przygotować tła menu w grze (${err.code ?? err.message}). Gra uruchomi się bez niego.` });
    }
    return res;
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

  /* ── Hammer+: what the launcher does by itself after a game session ── */

  /**
   * Automatyczne kopie światów: packs the worlds played since `since` and keeps the newest few automatic backups
   * of each. The instance is held like during a manual backup, so the game cannot be started in the middle –
   * and nothing happens when it already runs again.
   */
  async function autoBackupWorlds(instance, since) {
    const s = settings.get();
    if (!s.autoBackup || !plus.status().active) return null;
    if (inGame(instance) || worldTasks.has(instance.id)) return null;
    worldTasks.add(instance.id);
    try {
      const result = await autoBackup.run(instance, {
        since,
        keep: s.autoBackupKeep,
        stop: () => inGame(instance),
        backup: (world) => withProgress(`Automatyczna kopia: ${world}`, (onProgress) => worldSaves.backup(instance, world, { auto: true, onProgress })),
      });
      const names = result.made.map((b) => `„${b.world}”`);
      if (names.length) emit('toast', { kind: 'ok', text: names.length === 1 ? `Automatyczna kopia świata ${names[0]} jest gotowa.` : `Automatyczne kopie światów są gotowe: ${names.join(', ')}.` });
      for (const f of result.failed) emit('toast', { kind: 'warning', text: `Nie udało się zrobić automatycznej kopii świata „${f.world}”. ${f.error}` });
      if (result.made.length) emit('worlds:backups', { instanceId: instance.id });
      return result;
    } finally {
      worldTasks.delete(instance.id);
    }
  }

  /** The account the cloud copy belongs to – its code and Minecraft UUID. Throws without Hammer+. */
  function cloudAccount() {
    const st = plus.need('Chmura');
    return { code: plus.token(), mc: cleanUuid(st.account.id) };
  }
  let cloudNote = null; // why the last try did not reach the shop (shown in the Chmura card)
  /** Runs one cloud call. A shop that is not online is an answer – { offline, note } – not an error. */
  async function cloudCall(fn) {
    const { code, mc } = cloudAccount();
    try {
      const res = await fn(code, mc);
      cloudNote = null;
      return res;
    } catch (err) {
      if (!err?.offline) throw err;
      cloudNote = err.message;
      return { offline: true, note: err.message };
    }
  }

  /** Automatic cloud copy after a game session; a newer copy in the cloud is a question for the player. */
  async function autoCloudPush() {
    if (!settings.get().cloudAuto || !plus.status().active) return null;
    try {
      const res = await cloudCall((code, mc) => cloud.afterSession(code, mc));
      if (res.conflict) emit('cloud:conflict', res);
      else if (res.ok) emit('cloud:synced', { at: res.at, direction: 'push' });
      return res;
    } catch (err) {
      emit('toast', { kind: 'warning', text: `Nie udało się wysłać kopii do chmury. ${err.message}` });
      return null;
    }
  }

  /**
   * A game session ended: first the automatic backups of the worlds played (the instance is held from this very
   * moment), then the cloud copy. Runs in the background – `sessionWork` keeps track of it.
   */
  function afterSession(instance, playedMs) {
    const work = (async () => {
      await autoBackupWorlds(instance, now() - playedMs).catch(() => null);
      await autoCloudPush();
    })();
    sessionWork.add(work);
    work.finally(() => sessionWork.delete(work));
  }

  /** Resolves when everything started by the last game sessions is done (main.js waits for it before quitting). */
  async function afterSessions() {
    await new Promise((resolve) => setImmediate(resolve)); // a session that ended this very moment has registered by then
    await Promise.allSettled([...sessionWork]);
  }

  /**
   * Best effort: tells the shop which Hammer+ cape the player wears, so the games of other players can show it.
   * { shared, note } – note says why not (the shop is not online yet). Never throws.
   */
  async function shareCape() {
    const st = plus.status();
    const code = st.active ? plus.token() : null;
    if (!code) return { shared: false, note: null };
    const mc = cleanUuid(st.account.id);
    const cape = settings.get().hammerCape;
    if (cloud.state(mc).capeSent === cape) return { shared: true, note: null };
    try {
      await shop.putCape(code, cape || null);
      cloud.remember(mc, { capeSent: cape });
      return { shared: true, note: null };
    } catch (err) {
      return { shared: false, note: err?.offline ? 'Inni gracze zobaczą ją, gdy sklep HammerShop będzie online.' : String(err?.message ?? err) };
    }
  }

  /** Peleryny Hammer+: picks a cape from capes.json ('' or null = none). Taking it off is always allowed. */
  async function setHammerCape(id) {
    const cape = id == null ? '' : String(id);
    if (cape) {
      plus.need('Peleryny Hammer+');
      if (!capes.some((c) => c.id === cape)) throw new Error('Nie ma takiej peleryny – odśwież zakładkę.');
    }
    settings.set({ hammerCape: cape });
    return { selected: cape, ...(await shareCape()) };
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

  const stamp = (v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 64) ? v : undefined;

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
      /** What every start does for the mod (see syncClient) – { active, reason? }. */
      sync: (id) => syncClient(need(id)),
    },
    gallery: {
      list: (instanceId) => listScreenshots(instances, instanceId ? [need(instanceId)] : instances.list()),
      remove: (instanceId, file) => removeScreenshot(need(instanceId), file),
      file: (instanceId, file) => screenshotPath(need(instanceId), file),
    },
    repairInstance,
    servers: {
      list: (id) => serverList.list(seedServers(need(id))),
      /** Whether this computer has an official Minecraft with a server list to bring over. */
      official: () => ({ available: Boolean(officialDir) && fs.existsSync(path.join(officialDir, serverList.FILE)) }),
      /** The button in the Serwery tab: adds the official Minecraft's servers that are not on the list yet. */
      importOfficial: (id) => {
        const instance = need(id);
        const result = officialDir ? serverList.importFrom(instance, officialDir) : { found: false, added: 0, skipped: 0 };
        if (!result.found) throw new Error('Nie znalazłem listy serwerów zwykłego Minecrafta na tym komputerze. Uruchom go raz i dodaj w nim serwer – wtedy lista się pojawi.');
        instances.patchInternal(instance.id, { serversImported: true });
        return { added: result.added, skipped: result.skipped, servers: serverList.list(instance) };
      },
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
      /** Zestawy (Hammer+). Removing one is always allowed. */
      saveOutfit: (data) => (plus.need('Zestawy skórek'), skinStore.saveOutfit(data ?? {})),
      applyOutfit: (id) => (plus.need('Zestawy skórek'), withSkins((auth) => skinStore.applyOutfit(auth, id))),
      removeOutfit: (id) => skinStore.removeOutfit(id),
    },
    afterSessions,
    plus: {
      /** { active, until, account, reason, text, … } – see plus.js. */
      status: () => plus.status(),
      activate: (code) => (plus.activate(code), plusChanged()),
      remove: () => (plus.remove(), plusChanged()),
      /** Looks again (an account was added or removed) and tells the window when something changed. */
      refresh: () => plusChanged(),
      /** Peleryny Hammer+: { capes: [{ id, name }], selected } – selected is '' without Hammer+. */
      capes: () => ({ capes: capes.map((c) => ({ ...c })), selected: plus.status().active ? settings.get().hammerCape : '' }),
      setCape: (id) => setHammerCape(id),
    },
    theme: {
      /** The player's own background picture as a file:// address – null without one (or without Hammer+). */
      background: () => ({ url: plus.status().active ? backgrounds.url(settings.get().background) : null }),
      /** Opens the file dialog and copies the picked picture into the launcher folder. null = cancelled. */
      pickBackground: async () => {
        plus.need('Własne tło launchera');
        const file = await pickFile?.({ title: 'Wybierz obraz na tło launchera', filters: [{ name: 'Obrazy (PNG, JPG, WebP)', extensions: EXTENSIONS }] });
        if (!file) return null;
        const name = backgrounds.store(file);
        return { settings: settings.set({ background: name }), url: backgrounds.url(name) };
      },
      clearBackground: () => {
        const saved = settings.set({ background: '' });
        backgrounds.clear();
        return { settings: saved, url: null };
      },
      /** Tło menu w grze: the stored picture as a file:// address – null without one (or without Hammer+). */
      menuBackground: () => ({ url: plus.status().active ? menuBackground.url() : null }),
      /** Opens the file dialog and stores the picked picture as a PNG of at most 1920×1080. null = cancelled. */
      pickMenuBackground: async () => {
        plus.need('Własne tło menu w grze');
        const file = await pickFile?.({ title: 'Wybierz obraz na tło menu w grze', filters: [{ name: 'Obrazy (PNG, JPG)', extensions: ['png', 'jpg', 'jpeg'] }] });
        if (!file) return null;
        await menuBackground.store(file);
        return { url: menuBackground.url() };
      },
      /** Removing is always allowed; the copies in the instances go at their next start. */
      clearMenuBackground: () => {
        menuBackground.clear();
        return { url: null };
      },
    },
    cloud: {
      /** { active, auto, last: { at, direction, updatedAt } | null, note } for the Chmura card. */
      status: () => {
        const st = plus.status();
        return { active: st.active, auto: st.active && Boolean(settings.get().cloudAuto), last: st.active ? cloud.last(cleanUuid(st.account.id)) : null, note: cloudNote };
      },
      /** "Wyślij do chmury" – { ok, at } | { conflict, updatedAt, at, cloud, local } | { offline, note }. */
      push: (opts) => cloudCall((code, mc) => cloud.push(code, mc, { force: Boolean(opts?.force), baseUpdatedAt: stamp(opts?.baseUpdatedAt) })),
      /** "Pobierz z chmury" – { ok, at, look, changed, skipped, missing } | { empty } | { offline, note }. */
      pull: () => cloudCall((code, mc) => cloud.pull(code, mc)),
      /** Automatic sync when the launcher starts; { skipped } unless it is switched on. */
      startup: async () => (settings.get().cloudAuto && plus.status().active ? cloudCall((code, mc) => cloud.startup(code, mc)) : { skipped: true }),
    },
  };
}

module.exports = { createServices };
