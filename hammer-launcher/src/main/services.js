'use strict';

/**
 * Everything the launcher does, wired together – without Electron, so it can be tested.
 * main.js gives it the Electron bits (window events, safeStorage, dialogs, the login window).
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { createPaths } = require('./paths');
const { createSettings, sanitize, plusOnly } = require('./settings');
const { createInstances } = require('./instances');
const versions = require('./versions');
const { prepareInstance, describeError } = require('./installer');
const { GameManager, buildLaunchOptions, countMods, memoryFor, priorityFor } = require('./launch');
const { createModrinth } = require('./modrinth');
const { createContent } = require('./content');
const { createModpacks } = require('./modpacks');
const { createOptimizer, writeOptionsPreset, setGpuPreference, recommend, performanceModsIn, OPTION_PRESETS } = require('./optimizer');
const { createProgress } = require('./progress');
const { ping } = require('./serverping');
const { createNewsFeed, alertVisible, closeAlert, newestAt } = require('./news');
const { createSelfUpdate, updatesBase, isNewer } = require('./selfupdate');
const { APP_VERSION, userAgent } = require('./net');
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
const officialGame = require('./official');
const recipes = require('./recipe');
const invites = require('./invite');
const { createFeatured } = require('./featured');
const fpsTest = require('./benchmark');
const playSummary = require('./playsummary');
const { createUpdates, createUpdateWatch } = require('./updates');
const { createScreenshotShare } = require('./screenshare');

/**
 * `trash(path)` moves a file or folder to the system trash (Electron's shell.trashItem in main.js). Without it –
 * in the tests – worlds and backups are simply deleted.
 * `clientDir` is the bundled Hammer Client folder (versions.json + one jar per Minecraft version); `clientJar` is the
 * old single jar for 1.21 / 1.21.1. `versionsApi` replaces the version lists in the tests.
 * `pickFile({ title, filters })` opens the system's file dialog and resolves with a path or null (Electron's
 * dialog in main.js); `saveFile({ title, defaultName, filters })` is the "save as" dialog. `convertImage(data, { maxWidth, maxHeight })` makes PNG bytes that fit that size out of a
 * picture (Electron's nativeImage). `capes` is the list of Hammer+ capes (capes.json). `prepareFn` installs what an
 * instance needs before a start (the tests replace it, so a start needs no downloads). `t(text)` gives the names
 * the launcher makes up itself ("(kopia)", "Skórka z konta") in the player's language (main.js: i18n.js); without it they are Polish.
 * `appVersion` is the running launcher's version (app.getVersion()). `updater` is electron-updater's autoUpdater
 * and `updateSupport` says whether this build can replace itself (selfupdate.js → updateSupport) – main.js loads
 * the updater only where it can; `updateLog(line)` writes the updater's log. Without them the launcher only
 * tells that a newer version exists.
 */
function createServices({ root, config, accounts, emit = () => {}, fetchFn = (...a) => fetch(...a), presence = null, gpuInfo = () => null, launchFn, clientDir = null, clientJar = null, trash = null, versionsApi = versions, officialDir = null, pickFile = null, saveFile = null, convertImage = null, capes = loadCapes(), now = () => Date.now(), prepareFn = prepareInstance, t = (text) => text, gameLanguage = () => 'pl_pl', appVersion = APP_VERSION, updater = null, updateSupport = { supported: false, reason: 'dev' }, updateLog = () => {} }) {
  const paths = createPaths(root);
  fs.mkdirSync(paths.instances, { recursive: true });
  // A launcher that has been used before (it has its settings) – told apart from a fresh install for „Co nowego”.
  const usedBefore = fs.existsSync(paths.settings);
  const store = createSettings(paths.settings);
  const instances = createInstances(paths, { t, lang: gameLanguage });

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
      // The background check for mod updates follows its switch at once.
      if (saved.modUpdateCheck && !before.modUpdateCheck) updateWatch.run().catch(() => null);
      if (!saved.modUpdateCheck && before.modUpdateCheck) updateWatch.clear();
      // „Aktualizuj automatycznie” switched on: an update that was only announced is fetched now.
      if (saved.autoUpdate !== before.autoUpdate) selfUpdate.refresh();
      return saved;
    },
  };
  const shop = createShopApi({ config, fetchFn, version: appVersion });
  const backgrounds = createBackgrounds({ dir: path.join(root, 'theme') });
  const menuBackground = createMenuBackground({ dir: path.join(root, 'theme'), convert: convertImage });

  const modrinth = createModrinth({ fetchFn });
  const content = createContent({ modrinth, fetchFn });
  const modpacks = createModpacks({ modrinth, instances, fetchFn });
  const optimizer = createOptimizer({ modrinth, content });
  const bundles = createBundles({ modrinth, content });
  const skinStore = createSkins({ dir: path.join(root, 'skins'), fetchFn, t, limit: () => (plus.status().active ? PLUS_LIBRARY : MAX_LIBRARY) });
  const games = new GameManager(launchFn ? { launchFn } : {});
  const community = createCommunity({ config, fetchFn });
  const busy = new Set(); // instances being prepared
  // Read again each time it is needed – the index is tiny, and a rebuilt mod is picked up without a restart.
  const hammerClient = () => loadHammerClient({ dir: clientDir, jar: clientJar });
  const worldTasks = new Set(); // instances with a world backup or restore in progress
  const contentTasks = new Set(); // instances whose mods are being updated or put back
  const benchRuns = new Map(); // instance id → the FPS test running there: { startedAt, seconds, world, worldName, snapshot }
  let lastSummary = null; // „Podsumowanie gry” of the last session, until it is dismissed or a game starts
  const updates = createUpdates({ content, modrinth });
  const updateWatch = createUpdateWatch({ list: () => instances.list(), check: (instance) => updates.check(instance), enabled: () => Boolean(store.get().modUpdateCheck), onChange: (status) => emit('updates:status', status), now });
  // „Udostępnij link”: the consent is the setting „Pytaj przed udostępnieniem zrzutu ekranu” switched off.
  const screenShare = createScreenshotShare({ config, fetchFn, now, consent: { given: () => !store.get().screenshotShareAsk, remember: () => store.set({ screenshotShareAsk: false }) } });
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

  /* ── the shop's news and messages, and the launcher's own updates ── */
  /** The feed as the window gets it: without a message the player has closed, and with what „nowe” is measured against. */
  const feedView = (s) => ({ ...s, alert: alertVisible(s.alert, { closed: store.get().closedAlert, now: now() }) ? s.alert : null, seenAt: store.get().newsSeenAt });
  const feed = createNewsFeed({
    api: shop,
    config,
    fetchFn,
    now,
    onChange: (s) => {
      selfUpdate.setRelease(s.release, s.ok); // a newer version, and whether this one is still supported
      emit('news:update', feedView(s));
    },
  });
  // A game that runs or is being started: the launcher never restarts or installs under it.
  const selfUpdate = createSelfUpdate({
    updater,
    version: appVersion,
    feedUrl: updatesBase(config),
    support: updateSupport,
    publicKey: config.updatePublicKey,
    gameRunning: () => games.running.size > 0 || busy.size > 0,
    autoUpdate: () => store.get().autoUpdate !== false,
    onChange: (state) => {
      // „Co nowego” of a downloaded update is kept: after it installs it is shown once, even when the shop is offline then.
      if (state.status === 'ready' && state.latest && state.notes && store.get().updateNotes?.version !== state.latest) store.set({ updateNotes: { version: state.latest, notes: state.notes } });
      emit('selfupdate:state', state);
    },
    log: updateLog,
    now,
    userAgent: userAgent(appVersion),
  });

  const sharing = recipes.createSharing({ instances, content, modrinth, versionsApi, serverList });
  const featured = createFeatured({ api: shop, now });
  // What the player is looking at before saying yes: a recipe read from a code or file, an invitation from a link.
  // The window gets a token and a description; the checked data itself stays here.
  const pendingRecipes = new Map();
  const pendingInvites = new Map();
  const remember = (map, value) => {
    const token = crypto.randomBytes(8).toString('hex');
    map.set(token, value);
    while (map.size > 8) map.delete(map.keys().next().value);
    return token;
  };

  games.on('log', (e) => emit('game:log', e));
  games.on('state', (e) => emit('game:state', e));
  games.on('state', () => selfUpdate.refresh()); // „Uruchom ponownie i zaktualizuj” is off while a game runs
  // A game ended. An FPS test is not a game session: it leaves its result and nothing else. After every real
  // session – also one that crashed – the play time is counted and the automatic world backups and the cloud
  // copy (Hammer+) run; one that ended normally gets its summary on the start screen.
  games.on('state', (e) => {
    if (e.state !== 'exited' && e.state !== 'crashed') return;
    const bench = benchRuns.get(e.instanceId);
    benchRuns.delete(e.instanceId);
    const instance = instances.get(e.instanceId);
    if (!instance) return;
    if (e.benchmark || bench) {
      if (bench) finishBenchmark(instance, bench, e);
      return;
    }
    const playedMs = e.playedMs ?? 0;
    const after = instances.patchInternal(instance.id, { playTimeMs: (instance.playTimeMs ?? 0) + playedMs }) ?? instance;
    afterSession(after, playedMs);
    summarizeSession(after, e.state, playedMs);
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
   * `benchmark` ({ seconds, worldName }, only from startBenchmark below) makes this start an FPS test: the two
   * arguments for Hammer Client are added to this one start – nothing of it is stored in the instance.
   */
  async function launch(instanceId, { join, server, world, benchmark = null } = {}) {
    let instance = need(instanceId);
    // „Wymagana aktualizacja”: the shop no longer supports this version – only what it said just now counts.
    if (selfUpdate.status().required) throw new Error('Ta wersja launchera nie jest już wspierana. Zaktualizuj launcher, żeby grać dalej.');
    if (games.isRunning(instance.id)) throw new Error('Ta instancja już działa.');
    if (busy.has(instance.id)) throw new Error('Gra jest już przygotowywana.');
    if (worldTasks.has(instance.id)) throw new Error('Poczekaj, aż launcher skończy kopię zapasową świata – potem uruchom grę.');
    if (contentTasks.has(instance.id)) throw new Error('Poczekaj, aż launcher skończy aktualizację modów – potem uruchom grę.');
    const joinAddress = server ? serverList.cleanAddress(server) : undefined;
    const openWorld = world && !joinAddress ? path.basename(worldSaves.worldDir(instance, world)) : undefined;
    busy.add(instance.id);
    const progress = createProgress((p) => emit('game:progress', { instanceId: instance.id, ...p }));
    try {
      const s = settings.get();
      const account = await accounts.launchAuth(s.selectedAccount);
      let prepared;
      try {
        prepared = await prepareFn({ paths, instance, settings: s, progress, instances });
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
      let clientActive = false;
      try {
        shareCape().catch(() => null); // not awaited: the shop being slow or offline never holds the game back
        const res = await syncClient(instance);
        clientActive = res.active;
        if (!res.active && res.reason === 'missing') emit('toast', { kind: 'warning', text: `Brak pliku Hammer Client dla Minecrafta ${instance.mcVersion} w launcherze – gra uruchomi się bez własnego menu.` });
      } catch (err) {
        emit('toast', { kind: 'warning', text: `Nie udało się przygotować Hammer Client: ${err.message}` });
      }
      // The FPS test is measured by the mod – without it the game would start and never close by itself.
      if (benchmark && !clientActive) throw new Error('Nie udało się przygotować Hammer Client w tej instancji, a to on mierzy FPS. Spróbuj ponownie.');
      if (s.gpuPreference) await setGpuPreference(prepared.javaPath);
      progress.stage('launch');
      const modCount = countMods(instance.dir);
      let options = buildLaunchOptions({ paths, instance, settings: s, account, versionId: prepared.versionId, javaPath: prepared.javaPath, javaMajor: prepared.javaMajor, totalMem: os.totalmem(), modCount, config, join: join ? true : undefined, server: joinAddress, world: openWorld });
      if (benchmark) {
        if (!options.quickPlaySingleplayer) throw new Error('Ta wersja Minecrafta nie otwiera świata sama, więc test FPS w niej nie zadziała.');
        options = fpsTest.withBenchmark(options, benchmark.seconds);
        fpsTest.clearResult(instance); // a result left by an earlier run must not be taken for this one
        benchRuns.set(instance.id, {
          startedAt: now(),
          seconds: fpsTest.clampSeconds(benchmark.seconds),
          world: openWorld,
          worldName: benchmark.worldName ?? openWorld,
          // What the test ran with – remembered next to its numbers.
          snapshot: { mc: instance.mcVersion, loader: instance.loader, mods: modCount, optimization: performanceModsIn(content.list(instance, 'mod').filter((m) => m.enabled)), memoryMb: options.maxMemory },
        });
      } else instances.patchInternal(instance.id, { lastPlayed: Date.now() });
      // A new game: the summary of the one before has had its time.
      if (lastSummary) {
        lastSummary = null;
        emit('play:summary', null);
      }
      try {
        await games.start({ instance, options, priority: priorityFor(instance, s), benchmark: Boolean(benchmark), onExit: () => presence?.clear() });
      } catch (err) {
        benchRuns.delete(instance.id);
        throw err;
      }
      if (benchmark) return { ok: true, memoryMb: options.maxMemory, versionId: prepared.versionId, worldOpened: true, benchmark: true };
      const invite = await community.invite().catch(() => null);
      const buttons = [invite && { label: 'Dołącz do Discorda', url: `https://discord.gg/${invite}` }, config.shopUrl && { label: `Sklep ${config.brand ?? 'HammerShop'}`.slice(0, 32), url: config.shopUrl }].filter(Boolean);
      presence?.set({
        details: `Minecraft ${instance.mcVersion}${instance.loader !== 'vanilla' ? ` · ${LOADER_NAMES[instance.loader]}` : ''}`,
        state: `Gra przez ${config.name ?? 'Hammer Launcher'}`,
        timestamps: { start: Date.now() },
        // The launcher icon straight from the website – nothing has to be uploaded to the Discord application.
        assets: { large_image: /^https:\/\//.test(config.website ?? '') ? `${config.website.replace(/\/+$/, '')}/assets/launcher-icon.png` : 'logo', large_text: config.name ?? 'Hammer Launcher' },
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

  /* ── Test FPS and „Podsumowanie gry” ── */

  /** Everything the „Test FPS” card shows: whether the test can run here, the worlds to run it in, the history. */
  async function benchmarkInfo(instanceId) {
    const instance = need(instanceId);
    const can = fpsTest.availability(instance, hammerClient());
    const worlds = can.ok ? (await worldSaves.list(instance)).filter((w) => !w.broken).map((w) => ({ folder: w.folder, name: w.name, lastPlayed: w.lastPlayed, iconUrl: w.iconUrl })) : [];
    const history = fpsTest.history(instance);
    return { available: can.ok, reason: can.reason, note: can.note, lengths: [...fpsTest.LENGTHS], seconds: fpsTest.DEFAULT_SECONDS, worlds, running: benchRuns.has(instance.id), history, comparison: fpsTest.compare(history[1], history[0]) };
  }

  /** „Uruchom test”: starts the game straight into `world` with the test arguments for this one start. */
  async function startBenchmark(instanceId, { world, worldName, seconds } = {}) {
    const instance = need(instanceId);
    const can = fpsTest.availability(instance, hammerClient());
    if (!can.ok) throw new Error(can.note);
    if (!world) throw new Error('Wybierz świat, w którym launcher ma zmierzyć FPS.');
    const folder = path.basename(worldSaves.worldDir(instance, world)); // throws when there is no such world
    return launch(instance.id, { world: folder, benchmark: { seconds: fpsTest.clampSeconds(seconds), worldName: short(worldName, 80) || folder } });
  }

  /**
   * The game of an FPS test closed: the result is read (only one written after the test was started; the file
   * is removed either way), goes into the history of the instance and to the window – 'benchmark:done' with
   * { instanceId, ok: true, run, previous, comparison } or { instanceId, ok: false, reason, reasons }.
   */
  function finishBenchmark(instance, bench, e) {
    const taken = fpsTest.takeResult(instance, { since: bench.startedAt });
    let payload;
    if (taken.ok) {
      const r = taken.result;
      const run = { at: r.finishedAt, seconds: r.seconds ?? bench.seconds, world: bench.world, worldName: bench.worldName, avg: r.avg, low1: r.low1, min: r.min, max: r.max, frames: r.frames, ...bench.snapshot, mc: r.mc ?? bench.snapshot.mc, client: r.version };
      try {
        const saved = fpsTest.record(instance, run);
        payload = { instanceId: instance.id, ok: true, run: saved.run, previous: saved.previous, comparison: fpsTest.compare(saved.previous, saved.run) };
      } catch {
        payload = { instanceId: instance.id, ok: true, run: fpsTest.cleanRun(run), previous: null, comparison: null }; // the history could not be saved – the result still counts
      }
    } else {
      const stopped = Boolean(e.stopped) || (e.state === 'crashed' && e.code == null); // stopped from the launcher
      payload = { instanceId: instance.id, ok: false, reason: taken.reason, reasons: fpsTest.failureReasons(taken.reason, { crashed: e.state === 'crashed' && !stopped, stopped }) };
    }
    emit('benchmark:done', payload);
    return payload;
  }

  /** „Podsumowanie gry” for a session that just ended – kept until it is dismissed or the next game starts. */
  function summarizeSession(instance, state, playedMs) {
    if (!playSummary.worthShowing({ state, playedMs, enabled: settings.get().playSummary })) return null;
    let summary = null;
    try {
      // The gentle pointer to the FPS test: only where it can run and never has.
      const suggestBenchmark = fpsTest.availability(instance, hammerClient()).ok && !fpsTest.history(instance).length;
      summary = playSummary.summarize({ instance, state, playedMs, endedAt: now(), suggestBenchmark });
    } catch {
      summary = null; // a summary is a nicety – it never gets in the way of what follows a session
    }
    if (!summary) return null;
    lastSummary = summary;
    emit('play:summary', summary);
    return summary;
  }

  /** One update (or undo) of an instance's mods at a time – never under a running game, which holds those files. */
  async function contentTask(instanceId, what, fn) {
    const instance = idle(instanceId, what);
    if (contentTasks.has(instance.id)) throw new Error('Poczekaj, aż skończy się poprzednia aktualizacja.');
    contentTasks.add(instance.id);
    try {
      return await fn(instance);
    } finally {
      contentTasks.delete(instance.id);
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
  async function withProgress(label, fn, extra = {}) {
    let last = 0;
    const update = ({ done, total }) => {
      const now = Date.now();
      if (now - last < 150) return;
      last = now;
      emit('task:progress', { ...extra, label, done, total });
    };
    try {
      return await fn(update);
    } finally {
      if (last) emit('task:progress', { ...extra, label, done: 1, total: 1 });
    }
  }

  /** A task that reports its own steps ({ label, done, total }) to the same bar; the bar always ends at 100 % too. */
  async function withSteps(scope, fn) {
    let label = null;
    try {
      return await fn((p) => {
        label = p.label ?? label;
        emit('task:progress', { scope, ...p });
      });
    } finally {
      if (label != null) emit('task:progress', { scope, label, done: 1, total: 1 });
    }
  }

  /* ── the official Minecraft, recipes, invitations ── */

  /** The version manifest, newest first, as ids – null when it cannot be had quickly (the numbers decide then). */
  function versionOrder() {
    const wait = new Promise((resolve) => setTimeout(resolve, 2500, null).unref?.());
    return Promise.race([versionsApi.minecraftVersions({ snapshots: true }).then((list) => list.map((v) => v.id), () => null), wait]);
  }

  /** A recipe that passed every check → what the window shows before „Utwórz instancję”. */
  async function previewRecipe(recipe) {
    const { loaderVersion, notes } = await sharing.check(recipe);
    return { token: remember(pendingRecipes, recipe), summary: { ...recipes.summary(recipe), loaderVersion }, notes };
  }

  const loaderName = (loader) => recipes.LOADER_NAMES[loader] ?? loader;
  const sameAddress = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const short = (value, max) => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  /**
   * The game a new instance for an invitation gets: the version and loader the link asks for; what it leaves
   * open is filled in like for the first instance of the launcher (Fabric on the newest version Hammer Client
   * supports, else the newest release). Throws InviteError when the loader has no build for that version.
   */
  async function gameFor({ mc = null, loader = null }) {
    const offline = () => new invites.InviteError('Nie udało się sprawdzić wersji gry – sprawdź internet i spróbuj ponownie.');
    const hasLoader = async (l, id) => (l === 'vanilla' ? true : (await versionsApi.loaderVersions(l, id).catch(() => [])).length > 0);
    const wanted = loader ?? 'fabric';
    if (mc) {
      if (await hasLoader(wanted, mc)) return { mc, loader: wanted };
      if (loader) throw new invites.InviteError(`${loaderName(loader)} nie ma wersji dla Minecrafta ${mc} – poproś o nowe zaproszenie.`);
      return { mc, loader: 'vanilla' };
    }
    const releases = await versionsApi.minecraftVersions().catch(() => {
      throw offline();
    });
    if (!releases.length) throw offline();
    const client = hammerClient();
    const preferred = client.available && ['fabric', 'quilt'].includes(wanted) ? [...client.versions].reverse().filter((id) => releases.some((v) => v.id === id)) : [];
    for (const id of [...preferred, ...releases.slice(0, 8).map((v) => v.id)]) if (await hasLoader(wanted, id)) return { mc: id, loader: wanted };
    if (loader) throw new invites.InviteError(`${loaderName(loader)} nie ma jeszcze wersji dla najnowszego Minecrafta – poproś o zaproszenie z wersją gry.`);
    return { mc: releases[0].id, loader: 'vanilla' };
  }

  /**
   * Everything the invitation window shows: the checked link, the modpack it asks for (name and author from
   * Modrinth), the instances that fit and what a new one would be. Nothing is changed here.
   */
  async function describeInvite(invite) {
    if (invite.mc) {
      const versions = await versionsApi.minecraftVersions({ snapshots: true }).catch(() => {
        throw new invites.InviteError('Nie udało się sprawdzić wersji gry z zaproszenia – sprawdź internet i spróbuj ponownie.');
      });
      if (!versions.some((v) => v.id === invite.mc)) throw new invites.InviteError(`To zaproszenie prosi o Minecrafta ${invite.mc}, a takiej wersji gry nie ma.`);
    }
    let pack = null;
    if (invite.pack) {
      const project = await modrinth.project(invite.pack);
      if (!project || project.project_type !== 'modpack' || !recipes.MODRINTH_ID.test(String(project.id))) throw new invites.InviteError('Paczki modów z tego zaproszenia nie ma na Modrinth.');
      const title = short(project.title, 80) || 'Paczka modów';
      const loaders = invite.loader && invite.loader !== 'vanilla' ? [invite.loader] : undefined;
      const version = (await modrinth.versions(project.id, { loaders, gameVersions: invite.mc ? [invite.mc] : undefined }))[0];
      if (!version) throw new invites.InviteError(`Paczka „${title}” nie ma wersji${invite.mc ? ` dla Minecrafta ${invite.mc}` : ''}${loaders ? ` (${loaderName(invite.loader)})` : ''}.`);
      const author = await modrinth.author(project.id).catch(() => null);
      const gameVersions = Array.isArray(version.game_versions) ? version.game_versions.filter((v) => typeof v === 'string' && invites.MC_VERSION.test(v)) : [];
      pack = {
        id: project.id,
        versionId: version.id,
        title,
        author: short(author, 40) || null,
        iconUrl: invites.cleanIcon(project.icon_url),
        version: short(version.version_number, 40) || null,
        mc: invite.mc ?? gameVersions.at(-1) ?? null,
        loader: invite.loader ?? (Array.isArray(version.loaders) ? version.loaders.find((l) => recipes.LOADER_NAMES[l]) : null) ?? null,
      };
    }
    const mc = invite.mc ?? pack?.mc ?? null;
    const loader = invite.loader ?? pack?.loader ?? null;
    const fits = instances
      .list()
      .filter((i) => (!mc || i.mcVersion === mc) && (!loader || i.loader === loader))
      .map((i) => ({
        id: i.id,
        name: i.name,
        mcVersion: i.mcVersion,
        loader: i.loader,
        icon: i.icon,
        modpack: i.modpack?.iconUrl ? { iconUrl: i.modpack.iconUrl } : null,
        hasPack: Boolean(pack && i.modpack?.projectId === pack.id),
        hasServer: serverList.list(i).some((s) => sameAddress(s.address, invite.server)),
      }))
      .sort((a, b) => b.hasPack - a.hasPack);
    const create = pack ? { mc: pack.mc, loader: pack.loader, name: pack.title } : { ...(await gameFor({ mc: invite.mc, loader: invite.loader })), name: invite.name ?? invite.server };
    const token = remember(pendingInvites, { invite, pack, fits: fits.map((f) => f.id), create });
    return { token, invite, pack: pack && { title: pack.title, author: pack.author, iconUrl: pack.iconUrl, version: pack.version, mc: pack.mc, loader: pack.loader }, fits, create };
  }

  /**
   * The player said yes: the server goes onto the list of the chosen instance – or of a new one, made the way the
   * invitation asks (with `pack`, through the usual modpack install). Returns { instance, server, added, created }.
   */
  async function acceptInvite(token, { instanceId = null } = {}) {
    const pending = pendingInvites.get(token);
    if (!pending) throw new Error('To zaproszenie nie jest już otwarte – kliknij link jeszcze raz.');
    const { invite, pack, create } = pending;
    let instance;
    if (instanceId) {
      instance = need(instanceId);
      if (!pending.fits.includes(instance.id)) throw new Error('Ta instancja nie pasuje do zaproszenia – wybierz inną albo utwórz nową.');
    } else if (pack) {
      instance = await withSteps('modpack', (onProgress) => modpacks.installFromModrinth({ projectId: pack.id, versionId: pack.versionId }, { onProgress }));
    } else {
      instance = instances.create({ name: sharing.freeInstanceName(short(create.name, 48) || 'Serwer'), mcVersion: create.mc, loader: create.loader, icon: 'hammer', optimized: create.loader !== 'vanilla', hammerClient: true });
    }
    const added = !serverList.list(instance).some((s) => sameAddress(s.address, invite.server));
    if (added) serverList.add(instance, { name: invite.name ?? invite.server, address: invite.server });
    if (!instanceId) settings.set({ selectedInstance: instance.id });
    pendingInvites.delete(token);
    return { instance: instances.get(instance.id), server: invite.server, name: invite.name ?? invite.server, added, created: !instanceId };
  }

  /** „Zaproś”: the link for one server of an instance, with the instance's game version and loader. */
  function inviteLink(instanceId, address, { pack = true } = {}) {
    const instance = need(instanceId);
    const server = serverList.list(instance).find((s) => s.address === address);
    if (!server) throw new Error('Nie ma już takiego serwera na liście – odśwież ją.');
    const packId = recipes.MODRINTH_ID.test(String(instance.modpack?.projectId ?? '')) ? instance.modpack.projectId : null;
    const name = short(String(server.name ?? '').replace(/§[0-9a-fk-or]/gi, ''), invites.MAX_NAME);
    let link;
    try {
      link = invites.buildInvite({ server: server.address, name: name === server.address ? null : name, mc: instance.mcVersion, loader: instance.loader, pack: pack && packId ? packId : null }, { website: config.website });
    } catch {
      throw new Error('Dla tego adresu nie da się zrobić zaproszenia – zaproszenie przyjmuje tylko adres w postaci host albo host:port.');
    }
    return { link, web: link.startsWith('https://'), server: { name: name || server.address, address: server.address }, mc: instance.mcVersion, loader: instance.loader, pack: packId ? { name: short(instance.modpack.name, 80) || 'Paczka modów', included: Boolean(pack) } : null };
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
    /** A change that the game – running, or still being prepared – or a world backup would trip over is refused. */
    whenIdle: (id, what) => idle(id, what),
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
    /** Aktualności and the message bar – from the shop's /news (or newsUrl), else the built-in tips. Nothing here throws. */
    news: {
      /** { news, source, alert, release, ok, fetchedAt, seenAt } – the first call waits a moment for the shop, never long. */
      feed: async () => feedView(await feed.current()),
      /** Asks the shop again (at most once a minute; `force`: now) – the 'news:update' event brings what changed. */
      refresh: async (opts) => feedView(await feed.refresh({ force: opts?.force === true })),
      /** The player closed the message bar: it stays closed until the shop sends another message. A critical one stays. */
      closeAlert: () => {
        const s = feed.peek();
        store.set({ closedAlert: closeAlert(s.alert, store.get().closedAlert) });
        const view = feedView(s);
        emit('news:update', view);
        return view;
      },
      /** The home screen showed the news: what is there now is no longer „nowe” the next time. */
      markSeen: () => {
        const newest = newestAt(feed.peek().news);
        if (newest > store.get().newsSeenAt) store.set({ newsSeenAt: newest });
        return store.get().newsSeenAt;
      },
      start: () => feed.start(),
      stop: () => feed.stop(),
    },
    /** Aktualizacje launchera – see selfupdate.js for the state ({ status, latest, percent, release, required, … }). */
    selfUpdate: {
      status: () => selfUpdate.status(),
      /** „Sprawdź teraz”: asks the shop about the newest version and – where the launcher can update itself – the update server. */
      check: async () => {
        await feed.refresh({ force: true });
        return selfUpdate.check();
      },
      download: () => selfUpdate.download(),
      /** Restarting waits for what the last game session left running (automatic backups, the cloud copy). */
      install: async () => {
        await afterSessions();
        return selfUpdate.install();
      },
      update: async () => {
        await afterSessions();
        return selfUpdate.update();
      },
      installOnQuit: (exitCode) => selfUpdate.installOnQuit(exitCode),
      /** The launcher sits in the tray with no window: the update installs quietly – after what the last game session left running. */
      installQuietly: async () => {
        await afterSessions();
        return selfUpdate.installQuietly();
      },
      /**
       * „Co nowego” right after the launcher updated itself: { version, from, notes } once, then null. The notes are
       * the ones kept when the update was downloaded, else the shop's for this version. A fresh install has nothing to tell.
       */
      whatsNew: async () => {
        const s = store.get();
        if (!s.seenVersion && !usedBefore) {
          store.set({ seenVersion: appVersion });
          return null;
        }
        if (s.seenVersion && !isNewer(appVersion, s.seenVersion)) return null;
        let notes = s.updateNotes?.version === appVersion ? s.updateNotes.notes : null;
        if (!notes) {
          // Not kept from the download (an older launcher installed it): the shop's notes for this version – the
          // first look at the shop is waited for a moment, so the window does not open before they are here.
          const { release } = await feed.current().catch(() => feed.peek());
          notes = release?.version === appVersion ? release.notes : null;
        }
        return { version: appVersion, from: s.seenVersion || null, notes: notes || null };
      },
      /** The window „Co nowego” was closed: not shown again for this version. */
      seen: () => {
        store.set({ seenVersion: appVersion, updateNotes: null });
        return true;
      },
      start: () => selfUpdate.start(),
      stop: () => selfUpdate.stop(),
    },
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
      /** „Udostępnij link”: { available, hours, service, ask } – without `available` the button is not shown. */
      shareInfo: () => screenShare.info(),
      /** Uploads one screenshot of an instance to the configured host: { url, hours, expiresAt }. Needs the player's yes. */
      share: (instanceId, file, opts) => screenShare.share(screenshotPath(need(instanceId), file), { agreed: opts?.agreed === true, remember: opts?.remember === true }),
    },
    /** Test FPS (Optymalizacja): the card's data, the start, and which instances are being measured right now. */
    benchmark: { info: benchmarkInfo, start: startBenchmark, running: () => [...benchRuns.keys()] },
    /** „Podsumowanie gry”: the summary of the last session (null when there is none) and its dismissal. */
    play: {
      summary: () => lastSummary,
      dismiss: () => {
        lastSummary = null;
        return true;
      },
    },
    /** Aktualizacje modów: the background check, updating with a restore point, and the way back. */
    updates: {
      /** { checkedAt, total, instances: [{ id, name, count }] } – what the badges and the start screen show. */
      status: () => updateWatch.status(),
      /** What is known to have an update in one instance (from the last check): [{ type, file, title, current, latest }]. */
      list: (id) => updateWatch.items(need(id).id),
      /** Asks Modrinth now – every kind of content of the instance. */
      check: async (id) => {
        const instance = need(id);
        const items = await updates.check(instance);
        updateWatch.set(instance.id, items);
        return items;
      },
      /** „Aktualizuj wszystko” and single updates: { point, updated, failed } – see updates.js. */
      apply: (id, items) =>
        contentTask(id, 'aktualizacja podmienia pliki, których gra właśnie używa', async (instance) => {
          const res = await withSteps('updates', (onProgress) => updates.apply(instance, items, { onProgress, now: new Date(now()) }));
          const gone = new Set(res.updated.map((u) => `${u.type}/${u.file}`));
          updateWatch.set(instance.id, updateWatch.items(instance.id).filter((u) => !gone.has(`${u.type}/${u.file}`)));
          return res;
        }),
      /** „Cofnij ostatnią aktualizację”: { point, restored }. */
      undo: (id) => contentTask(id, 'cofnięcie aktualizacji podmienia pliki, których gra właśnie używa', async (instance) => updates.undo(instance)),
      /** The restore points of an instance, newest first (at most three). */
      points: (id) => updates.points(need(id)),
      /** A file was removed from the instance: it no longer counts as something to update. */
      forget: (id, type, file) => {
        const left = updateWatch.items(id).filter((u) => !(u.type === type && u.file === file));
        if (left.length !== updateWatch.items(id).length) updateWatch.set(id, left);
      },
      /** The background check: armed by main.js once the launcher is up; `run` is one round right now. */
      start: () => updateWatch.start(),
      stop: () => updateWatch.stop(),
      run: () => updateWatch.run(),
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
    /** The player's "normal" Minecraft (the official launcher's folder): what it has, and bringing it over. */
    official: {
      /** { available, servers, worlds, options } – what there is to bring over on this computer. */
      info: () => {
        const dir = officialDir && fs.existsSync(officialDir) ? officialDir : null;
        return { available: Boolean(dir), servers: Boolean(dir) && fs.existsSync(path.join(dir, serverList.FILE)), worlds: Boolean(dir) && fs.existsSync(path.join(dir, 'saves')), options: officialGame.hasOptions(dir) };
      },
      /** Its worlds, newest first, like worlds.list – plus `newer`: last opened in a newer game than this instance has. */
      worlds: async (id) => {
        const instance = need(id);
        const [list, order] = await Promise.all([officialGame.listWorlds(officialDir), versionOrder()]);
        return list.map((w) => ({ ...w, newer: !w.broken && officialGame.isNewer(w.version, instance.mcVersion, order) }));
      },
      /** Copies the chosen worlds into the instance (the originals are only read): { copied, failed }. */
      importWorlds: async (id, folders) => {
        const instance = idle(id, 'świat skopiowany w trakcie gry mógłby się nie wczytać');
        worldTasks.add(instance.id);
        try {
          return await officialGame.copyWorlds(folders, (folder, i, count) =>
            withProgress(`Kopiowanie świata: ${folder}${count > 1 ? ` (${i + 1}/${count})` : ''}`, (onProgress) => officialGame.copyWorld(instance, officialDir, folder, { onProgress }), { scope: 'official-worlds' }),
          );
        } finally {
          worldTasks.delete(instance.id);
        }
      },
      /** Replaces the instance's options.txt with the official Minecraft's: { backup, lines }. */
      importOptions: async (id) => officialGame.importOptions(idle(id, 'przy zamykaniu gra zapisałaby z powrotem swoje ustawienia'), officialDir),
    },
    /** Udostępnianie: an instance as a recipe – a code or a .hammerpack file. Nothing is uploaded. */
    share: {
      /** What „Udostępnij” shows: { summary, excluded, code, codeLength, maxCode, fileName, hasOptions, optionsLeftOut }. */
      export: async (id, opts) => {
        const instance = need(id);
        const exp = await sharing.exportRecipe(instance, { options: Boolean(opts?.options) });
        return { summary: exp.summary, excluded: exp.excluded, code: exp.code, codeLength: exp.codeLength, maxCode: recipes.MAX_CODE, fileName: exp.fileName, hasOptions: fs.existsSync(path.join(instance.dir, 'options.txt')), optionsLeftOut: exp.optionsLeftOut };
      },
      /** Asks where to save and writes <nazwa>.hammerpack: { file } – null when the dialog was closed. */
      save: async (id, opts) => {
        const exp = await sharing.exportRecipe(need(id), { options: Boolean(opts?.options), identify: false });
        const picked = await saveFile?.({ title: 'Zapisz przepis instancji', defaultName: exp.fileName, filters: [{ name: 'Przepis instancji Hammer Launchera', extensions: [recipes.EXTENSION] }] });
        if (!picked) return null;
        const target = path.extname(picked).toLowerCase() === `.${recipes.EXTENSION}` ? picked : `${picked}.${recipes.EXTENSION}`;
        try {
          fs.writeFileSync(target, exp.json);
        } catch (err) {
          throw new Error(`Nie udało się zapisać pliku (${err.code ?? err.message}). Wybierz inny folder.`, { cause: err });
        }
        return { file: path.basename(target) };
      },
      /** A pasted code / a .hammerpack file → { token, summary, notes } for the preview. Throws what is wrong with it. */
      readCode: async (code) => previewRecipe(recipes.decode(code)),
      readFile: async (file) => previewRecipe(recipes.readFile(file)),
      /** Opens the file dialog for a .hammerpack; null when it was closed. */
      pick: async () => {
        const file = await pickFile?.({ title: 'Wybierz przepis instancji', filters: [{ name: 'Przepis instancji Hammer Launchera', extensions: [recipes.EXTENSION] }] });
        return file ? previewRecipe(recipes.readFile(file)) : null;
      },
      /** Builds the instance of a previewed recipe: { instance, installed, missing, notes }. */
      install: async (token) => {
        const recipe = pendingRecipes.get(token);
        if (!recipe) throw new Error('Ten przepis nie jest już wczytany – wklej kod albo wybierz plik jeszcze raz.');
        pendingRecipes.delete(token);
        const result = await withSteps('recipe', (onProgress) => sharing.install(recipe, { onProgress }));
        settings.set({ selectedInstance: result.instance.id });
        return result;
      },
    },
    /** Zaproszenia (hammer://join) and the same flow for a featured server. */
    invite: {
      /** A link, or { featured: "<id>" } → what the invitation window shows. Nothing is changed. */
      read: async (input) => {
        if (input && typeof input === 'object') {
          const server = typeof input.featured === 'string' ? await featured.find(input.featured) : null;
          if (!server) throw new invites.InviteError('Tego serwera nie ma już na liście polecanych – odśwież ją.');
          return describeInvite(invites.cleanInvite({ server: server.address, name: server.name, mc: server.mc, loader: server.loader, pack: server.pack, icon: server.icon }));
        }
        return describeInvite(invites.parseInvite(input));
      },
      accept: (token, choice) => acceptInvite(String(token), { instanceId: choice?.instanceId ? String(choice.instanceId) : null }),
      link: (id, address, opts) => inviteLink(id, String(address ?? ''), { pack: opts?.pack !== false }),
    },
    /** Polecane serwery: [{ id, name, address, description, tags, icon, mc, loader, pack }] – [] when there is nothing to show. */
    featured: { list: () => featured.list() },
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
