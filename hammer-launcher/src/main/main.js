'use strict';

/**
 * Hammer Launcher – Electron main process: the window, the bridge to the interface (IPC) and the Electron
 * pieces of the services (login window, keychain, dialogs, opening links and folders).
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, Menu, Tray, nativeImage, clipboard, ClipboardItem } = require('electron');
const { loadConfig } = require('./config');
const { defaultRoot } = require('./paths');
const { createAccounts, createCrypt } = require('./accounts');
const { createServices } = require('./services');
const { createPresence } = require('./discordrpc');
const { safeName } = require('./net');
const { fromDataUrl } = require('./skins');
const { useSystemProxy } = require('./proxy');
const { officialMinecraftDir } = require('./official');
const { inviteFromArgs } = require('./invite');
const { tr, bootInfo, resolveLanguage } = require('./i18n');
const { updateSupport, updatesBase } = require('./selfupdate');

useSystemProxy(); // networks that require a proxy (HTTPS_PROXY) – without it the launcher would look offline there

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const config = loadConfig();
  let win = null;
  let services = null;
  let presence = null;
  let gpu = null;
  let tray = null;
  const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
  // „BETA” next to the name (launcher.config.json → channel); the product itself keeps its name.
  const beta = String(config.channel ?? '').trim().toLowerCase() === 'beta';
  const windowTitle = beta ? `${config.name} (beta)` : config.name;

  /* ── language: Polish, or English from the dictionary (Ustawienia → Język; "auto" follows the system) ── */
  const language = () => resolveLanguage(services?.settings.get().language, app.getLocale());
  /** A native text of the launcher (tray, file dialogs, login window) in the current language. */
  const T = (text) => tr(text, language());
  const filtersIn = (filters) => filters?.map((f) => ({ ...f, name: T(f.name) }));

  /** While the game runs with the launcher hidden, a tray icon brings it back (or stops the game). */
  function showTray() {
    if (tray) return;
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: process.platform === 'darwin' ? 18 : 32 }));
    tray.setToolTip(`${config.name} – ${T('gra działa')}`);
    const showWin = () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      win.focus();
    };
    tray.on('click', showWin);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: T('Pokaż launcher'), click: showWin },
        { label: T('Zatrzymaj grę'), click: () => [...(services?.games.running.keys() ?? [])].forEach((id) => services.games.stop(id)) },
        { type: 'separator' },
        { label: T('Zamknij launcher'), click: () => app.quit() },
      ]),
    );
  }
  function hideTray() {
    tray?.destroy();
    tray = null;
  }

  const send = (channel, payload) => {
    if (win && !win.isDestroyed()) win.webContents.send('hs:event', { channel, payload });
  };

  /* ── invitations: hammer://join?… ── */
  // A link the launcher was started with (Windows and Linux pass it as an argument) waits here until the window asks.
  let pendingInvite = inviteFromArgs(process.argv);
  let windowAsked = false; // the window has started and takes links as they come

  /**
   * Makes this launcher the program that opens hammer:// links for the current user. (The macOS and Linux
   * packages also declare it – "protocols" in package.json.) The "--" keeps anything in a link from being read
   * as a switch of the program.
   */
  function registerProtocol() {
    try {
      if (process.defaultApp) {
        // Started as "electron ." (development): a link has to start Electron with this app's folder.
        if (process.argv[1]) app.setAsDefaultProtocolClient('hammer', process.execPath, [path.resolve(process.argv[1]), '--']);
      } else if (process.env.PORTABLE_EXECUTABLE_FILE) {
        // The portable build unpacks itself into a temporary folder – a link must start the file the player keeps.
        app.setAsDefaultProtocolClient('hammer', process.env.PORTABLE_EXECUTABLE_FILE, ['--']);
      } else app.setAsDefaultProtocolClient('hammer', process.execPath, ['--']);
    } catch {
      // not allowed on this system – an invitation can still be pasted in the Serwery tab
    }
  }

  /**
   * A clicked link arrives: the window comes to the front and gets the link. Nothing is done with it here –
   * the window checks it through the services and asks the player before anything happens.
   */
  function openInvite(link) {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    if (!link) return;
    if (windowAsked && win && !win.isDestroyed()) send('invite:link', link);
    else pendingInvite = link;
  }

  /** Only https links (and the configured Discord invite) leave the app – in the system browser. */
  const openExternal = (url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error('Można otwierać tylko adresy https.');
    return shell.openExternal(u.toString());
  };

  function createWindow() {
    windowAsked = false;
    win = new BrowserWindow({
      width: 1240,
      height: 780,
      minWidth: 1040,
      minHeight: 660,
      frame: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      backgroundColor: '#0e0b09',
      show: false,
      title: windowTitle,
      icon: ICON,
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    });
    Menu.setApplicationMenu(null);
    win.once('ready-to-show', () => {
      win.show();
      services?.selfUpdate.start(); // the launcher's own update: a first look a few seconds from now, then every four hours
    });
    // Back in front of the player: a quiet look at the shop's news and messages (never more often than once a minute).
    win.on('focus', () => services?.news.refresh().catch(() => null));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
      try {
        openExternal(url).catch(() => null);
      } catch {
        // not an https link – ignored
      }
      return { action: 'deny' };
    });
    win.on('maximize', () => send('window:state', { maximized: true }));
    win.on('unmaximize', () => send('window:state', { maximized: false }));
    win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }

  /** The log of the launcher's own updates: <launcher folder>/logs/launcher-update.log – it starts over when it grows big. */
  function updateLogger(root) {
    const file = path.join(root, 'logs', 'launcher-update.log');
    return (line) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.rmSync(file, { force: true });
        fs.appendFileSync(file, `${new Date().toISOString()} ${String(line).replace(/\s+/g, ' ').slice(0, 600)}\n`);
      } catch {
        // a log that cannot be written never gets in the way
      }
    };
  }

  /**
   * Can this build replace itself (the installed Windows build and the AppImage can), and with what: electron-updater
   * is loaded only then – a portable exe, a development run and other packages never touch it.
   */
  function setupUpdater(log) {
    const support = updateSupport({
      platform: process.platform,
      packaged: app.isPackaged,
      portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
      appImage: Boolean(process.env.APPIMAGE),
      hasConfig: app.isPackaged && fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')),
    });
    if (!support.supported || !updatesBase(config)) return { support, updater: null };
    try {
      return { support, updater: require('electron-updater').autoUpdater };
    } catch (err) {
      log(`electron-updater could not be loaded: ${err?.message ?? err}`);
      return { support: { supported: false, reason: 'config' }, updater: null };
    }
  }

  function setupServices() {
    const root = defaultRoot(app.getPath('appData'));
    fs.mkdirSync(root, { recursive: true });
    const updateLog = updateLogger(root);
    const { support: updateBuild, updater } = setupUpdater(updateLog);
    const crypt = createCrypt({
      safeStorage,
      keyFile: path.join(root, '.key'),
      readKey: (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null),
      writeKey: (f, k) => fs.writeFileSync(f, k, { mode: 0o600 }),
    });
    const accounts = createAccounts({
      file: path.join(root, 'accounts.json'),
      crypt,
      config,
      // (the title is read when the login window opens, so it follows the language chosen by then)
      windowProperties: { width: 520, height: 680, resizable: false, get title() { return T('Logowanie Microsoft'); }, icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'), parent: win ?? undefined, modal: Boolean(win), autoHideMenuBar: true },
    });
    presence = createPresence(config.discordClientId);
    // Hammer Client: versions.json and one jar per Minecraft version (built by `./gradlew dist` in hammer-client/).
    const clientDir = app.isPackaged ? path.join(process.resourcesPath, 'hammer-client') : path.join(__dirname, '..', '..', 'resources', 'hammer-client');
    services = createServices({
      root,
      config,
      accounts,
      clientDir,
      officialDir: officialMinecraftDir(),
      emit: send,
      t: T, // the names the launcher makes up itself (a copied instance, a skin taken from the account)
      // The launcher's own version and updates (selfupdate.js).
      appVersion: app.getVersion(),
      updater,
      updateSupport: updateBuild,
      updateLog,
      // What friends see in Discord follows the launcher's language as well.
      presence: { set: (a) => (services?.settings.get().discordRpc ? presence.set({ ...a, state: T(a.state), ...(a.buttons ? { buttons: a.buttons.map((b) => ({ ...b, label: T(b.label).slice(0, 32) })) } : {}) }) : null), clear: () => presence.clear() },
      gpuInfo: () => gpu,
      // Worlds and backups the player removes go to the system trash, never straight off the disk.
      trash: (target) => shell.trashItem(target).catch(() => Promise.reject(new Error('Nie udało się przenieść do kosza. Zamknij programy, które mogą używać tych plików, i spróbuj ponownie.'))),
      // The system's file dialog (the backgrounds of Hammer+).
      pickFile: async ({ title, filters }) => {
        const res = await dialog.showOpenDialog(win, { title: T(title), properties: ['openFile'], filters: filtersIn(filters) });
        return res.canceled ? null : res.filePaths[0] ?? null;
      },
      // "Save as" for an instance recipe (.hammerpack) – starts in the player's documents.
      saveFile: async ({ title, defaultName, filters }) => {
        const res = await dialog.showSaveDialog(win, { title: T(title), defaultPath: path.join(app.getPath('documents'), defaultName), filters: filtersIn(filters) });
        return res.canceled ? null : res.filePath || null;
      },
      // Tło menu w grze: any picture → PNG that fits the given size, proportions kept (Hammer Client takes 1920×1080).
      convertImage: (data, { maxWidth, maxHeight }) => {
        const image = nativeImage.createFromBuffer(data);
        if (image.isEmpty()) throw new Error('Nie udało się wczytać tego obrazu. Wybierz plik PNG albo JPG.');
        const { width, height } = image.getSize();
        const scale = Math.min(1, maxWidth / width, maxHeight / height);
        return (scale < 1 ? image.resize({ width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), quality: 'best' }) : image).toPNG();
      },
    });
    services.accounts = accounts;

    // The launcher window steps aside while the game runs and comes back when it closes.
    services.games.on('state', ({ state, benchmark }) => {
      const after = services.settings.get().afterLaunch;
      if (!win || win.isDestroyed()) return;
      if (state === 'running') {
        if (after === 'hide') {
          showTray();
          win.hide();
        } else if (after === 'minimize') win.minimize();
      }
      if (state === 'exited' || state === 'crashed') {
        if (!services.games.running.size) hideTray();
        if (!win.isVisible()) win.show();
        if (win.isMinimized()) win.restore();
        // Automatic world backups and the cloud copy finish first – quitting would cut them off.
        // (Not after an FPS test: its result is what the player is waiting for.)
        if (state === 'exited' && !benchmark && services.settings.get().closeOnExit && !services.games.running.size) services.afterSessions().finally(() => !services.games.running.size && app.quit());
      }
    });
  }

  /** ipcMain.handle with one answer shape: { ok, data } or { ok: false, error } (Polish message). */
  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (event.senderFrame?.url && !event.senderFrame.url.startsWith('file://')) return { ok: false, error: 'Niedozwolone źródło.' };
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err) {
        return { ok: false, error: err?.message ?? String(err) };
      }
    });
  }

  function registerIpc() {
    const s = () => services;
    // The language the window starts in (asked synchronously by preload.js, before the page builds anything) and
    // the same answer again after the setting changed. English comes with its dictionary; Polish needs none.
    const fromWindow = (event) => !event.senderFrame?.url || event.senderFrame.url.startsWith('file://');
    ipcMain.on('i18n:boot', (event) => {
      try {
        event.returnValue = fromWindow(event) ? bootInfo(s().settings.get().language, app.getLocale()) : { lang: 'pl', dict: null };
      } catch {
        event.returnValue = { lang: 'pl', dict: null };
      }
    });
    handle('i18n:load', () => bootInfo(s().settings.get().language, app.getLocale()));
    handle('app:info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      config: { name: config.name, brand: config.brand, channel: beta ? 'beta' : '', website: config.website, shopUrl: config.shopUrl, discordInvite: config.discordInvite, server: config.server },
      root: s().paths.root,
      secureStorage: safeStorage.isEncryptionAvailable(),
      hammerClient: s().hammerClient.info(),
      plus: s().plus.status(),
    }));
    handle('app:open-external', (url) => openExternal(url));
    handle('app:open-folder', (instanceId, sub) => {
      const base = instanceId ? s().instances.dir(instanceId) : s().paths.root;
      const dir = sub ? path.join(base, safeName(sub)) : base;
      fs.mkdirSync(dir, { recursive: true });
      return shell.openPath(dir);
    });
    handle('window:minimize', () => win?.minimize());
    handle('window:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
    handle('window:close', () => win?.close());

    handle('settings:get', () => s().settings.get());
    handle('settings:set', (patch) => s().settings.set(patch));
    handle('system:info', () => s().system());
    // Aktualności and the message bar (the shop's /news), and the launcher's own updates.
    handle('news:feed', () => s().news.feed());
    handle('news:refresh', () => s().news.refresh());
    handle('news:close-alert', () => s().news.closeAlert());
    handle('news:seen', () => s().news.markSeen());
    handle('selfupdate:status', () => s().selfUpdate.status());
    handle('selfupdate:check', () => s().selfUpdate.check());
    handle('selfupdate:download', () => s().selfUpdate.download());
    handle('selfupdate:install', () => s().selfUpdate.install());
    handle('selfupdate:update', () => s().selfUpdate.update());
    handle('server:ping', (address) => s().ping(address || config.server?.address));

    handle('accounts:list', () => s().accounts.list());
    handle('accounts:login', async () => {
      const account = await s().accounts.login();
      s().settings.set({ selectedAccount: account.id });
      s().plus.refresh(); // Hammer+ follows the account
      return account;
    });
    handle('accounts:remove', (id) => {
      s().accounts.remove(id);
      if (s().settings.get().selectedAccount === id) s().settings.set({ selectedAccount: s().accounts.list()[0]?.id ?? null });
      s().plus.refresh();
      return true;
    });
    handle('accounts:select', (id) => s().settings.set({ selectedAccount: id }));

    handle('versions:minecraft', (opts) => s().versions.minecraftVersions(opts));
    handle('versions:loaders', (loader, mc) => s().versions.loaderVersions(loader, mc));

    handle('instances:list', () => s().instances.list());
    handle('instances:ensure-default', () => s().ensureDefaultInstance());
    handle('instances:create', (data) => {
      const instance = s().instances.create(data);
      s().settings.set({ selectedInstance: instance.id });
      return instance;
    });
    handle('instances:update', (id, patch) => s().instances.update(id, patch));
    handle('instances:remove', (id) => {
      if (s().games.isRunning(id)) throw new Error('Najpierw zamknij grę.');
      return s().instances.remove(id);
    });
    handle('instances:duplicate', (id) => s().instances.duplicate(id));
    handle('instances:repair', (id) => s().repairInstance(id));
    handle('instances:select', (id) => s().settings.set({ selectedInstance: id }));

    const str = (v) => (typeof v === 'string' && v ? v : undefined);
    handle('game:launch', (id, opts) => s().launch(id, { join: Boolean(opts?.join), server: str(opts?.server), world: str(opts?.world) }));
    handle('game:stop', (id) => s().games.stop(id));
    handle('game:logs', (id) => s().games.logs(id));
    handle('game:running', () => [...s().games.running.keys()]);

    const inst = (id) => {
      const i = s().instances.get(id);
      if (!i) throw new Error('Nie ma takiej instancji.');
      return i;
    };
    handle('content:list', (id, type) => s().content.list(inst(id), type));
    handle('content:identify', (id, type) => s().content.identify(inst(id), type));
    handle('content:toggle', (id, type, file, enabled) => s().content.setEnabled(inst(id), type, file, enabled));
    handle('content:remove', (id, type, file) => {
      const res = s().content.remove(inst(id), type, file);
      s().updates.forget(id, type, file); // a removed file has nothing to update any more
      return res;
    });
    handle('content:install', (id, what) => s().content.install(inst(id), what));
    handle('content:import', async (id, type, filePaths) => {
      const instance = inst(id);
      let files = filePaths;
      if (!files?.length) {
        const ext = type === 'mod' ? ['jar'] : ['zip'];
        const res = await dialog.showOpenDialog(win, { title: T('Dodaj pliki'), properties: ['openFile', 'multiSelections'], filters: [{ name: T(type === 'mod' ? 'Mody (.jar)' : 'Paczki (.zip)'), extensions: ext }] });
        if (res.canceled) return [];
        files = res.filePaths;
      }
      const dir = s().content.folder(instance, type);
      fs.mkdirSync(dir, { recursive: true });
      const added = [];
      for (const f of files) {
        const name = safeName(path.basename(f));
        if (!/\.(jar|zip)$/i.test(name)) continue;
        fs.copyFileSync(f, path.join(dir, name));
        added.push(name);
      }
      return added;
    });

    handle('modrinth:search', (params) => s().modrinth.search(params));
    handle('modrinth:project', (id) => s().modrinth.project(id));
    handle('modrinth:versions', (id, filters) => s().modrinth.versions(id, filters));
    handle('modrinth:categories', () => s().modrinth.categories());

    handle('modpacks:install', async (what) => {
      const instance = await s().modpacks.installFromModrinth(what, { onProgress: (p) => send('task:progress', { scope: 'modpack', ...p }) });
      s().settings.set({ selectedInstance: instance.id });
      return instance;
    });
    handle('modpacks:import', async () => {
      const res = await dialog.showOpenDialog(win, { title: T('Importuj paczkę modów'), properties: ['openFile'], filters: [{ name: T('Paczka Modrinth (.mrpack)'), extensions: ['mrpack'] }] });
      if (res.canceled || !res.filePaths[0]) return null;
      const instance = await s().modpacks.installFile(res.filePaths[0], { onProgress: (p) => send('task:progress', { scope: 'modpack', ...p }) });
      s().settings.set({ selectedInstance: instance.id });
      return instance;
    });

    handle('community:discord', () => s().community.discord());
    handle('community:shop', (opts) => s().community.shop(opts));

    handle('gallery:list', (id) => s().gallery.list(id || null));
    handle('gallery:remove', (id, file) => s().gallery.remove(id, file));
    handle('gallery:copy', async (id, file) => {
      const image = nativeImage.createFromPath(s().gallery.file(id, file));
      if (image.isEmpty()) throw new Error('Nie udało się wczytać obrazu.');
      // Newer Electron has the promise-based clipboard (write + ClipboardItem), older ones writeImage.
      if (typeof clipboard.writeImage === 'function') clipboard.writeImage(image);
      else await clipboard.write([new ClipboardItem({ 'image/png': new Blob([image.toPNG()], { type: 'image/png' }) })]);
      return true;
    });
    handle('gallery:show', (id, file) => shell.showItemInFolder(s().gallery.file(id, file)));
    // „Udostępnij link”: the upload to the configured host happens here, and only after the player's yes.
    handle('gallery:share-info', () => s().gallery.shareInfo());
    handle('gallery:share', (id, file, opts) => s().gallery.share(id, file, { agreed: opts?.agreed === true, remember: opts?.remember === true }));

    // Test FPS, the summary after a game, and mod updates with their restore points.
    handle('benchmark:info', (id) => s().benchmark.info(id));
    handle('benchmark:start', (id, opts) => s().benchmark.start(id, { world: str(opts?.world), worldName: str(opts?.worldName), seconds: Number(opts?.seconds) }));
    handle('benchmark:running', () => s().benchmark.running());
    handle('play:summary', () => s().play.summary());
    handle('play:dismiss', () => s().play.dismiss());
    handle('updates:status', () => s().updates.status());
    handle('updates:list', (id) => s().updates.list(id));
    handle('updates:check', (id) => s().updates.check(id));
    handle('updates:apply', (id, items) => s().updates.apply(id, Array.isArray(items) ? items.slice(0, 2000).map((u) => ({ type: u?.type, file: u?.file, title: u?.title, current: u?.current, latest: { id: u?.latest?.id, versionNumber: u?.latest?.versionNumber } })) : []));
    handle('updates:undo', (id) => s().updates.undo(id));
    handle('updates:points', (id) => s().updates.points(id));

    handle('servers:list', (id) => s().servers.list(id));
    handle('servers:official', () => s().servers.official());
    handle('servers:importOfficial', (id) => s().servers.importOfficial(id));
    handle('servers:add', (id, data) => s().servers.add(id, data));
    handle('servers:update', (id, index, patch, expected) => s().servers.update(id, index, patch, expected));
    handle('servers:remove', (id, index, expected) => s().servers.remove(id, index, expected));
    handle('servers:move', (id, from, to) => s().servers.move(id, from, to));

    handle('worlds:list', (id) => s().worlds.list(id));
    handle('worlds:rename', (id, folder, name) => s().worlds.rename(id, folder, name));
    handle('worlds:remove', (id, folder) => s().worlds.remove(id, folder));
    handle('worlds:open', (id, folder) => shell.openPath(s().worlds.dir(id, folder)));
    handle('worlds:backup', (id, folder) => s().worlds.backup(id, folder));
    handle('worlds:backups', (id) => s().worlds.listBackups(id));
    handle('worlds:restore', (id, file) => s().worlds.restoreBackup(id, file));
    handle('worlds:remove-backup', (id, file) => s().worlds.removeBackup(id, file));

    handle('cleanup:usage', () => s().cleanup.usage());
    handle('cleanup:plan', () => s().cleanup.plan());
    handle('cleanup:apply', (keys) => s().cleanup.apply(keys));

    handle('logs:share', (id) => s().shareLog(id));

    handle('bundles:list', () => s().bundles.list());
    handle('bundles:plan', (id, bundleId) => s().bundles.plan(id, bundleId));
    handle('bundles:install', (id, bundleId) => s().bundles.install(id, bundleId));

    // Skórka: the picture always travels as PNG data and is checked here (64×64 PNG) before anything is sent.
    handle('skins:get', () => s().skins.get());
    handle('skins:pick', async () => {
      const res = await dialog.showOpenDialog(win, { title: T('Wybierz skórkę'), properties: ['openFile'], filters: [{ name: T('Skórka Minecraft (.png)'), extensions: ['png'] }] });
      if (res.canceled || !res.filePaths[0]) return null;
      if (fs.statSync(res.filePaths[0]).size > 1024 * 1024) throw new Error('Ten plik jest za duży na skórkę. Skórka to mały obrazek PNG 64×64 pikseli.');
      return s().skins.inspect(fs.readFileSync(res.filePaths[0]), path.basename(res.filePaths[0]));
    });
    handle('skins:upload', (data) => s().skins.upload({ png: fromDataUrl(data?.png), variant: data?.variant, name: data?.name }));
    handle('skins:use', (id, variant) => s().skins.use(id, variant));
    handle('skins:reset', () => s().skins.reset());
    handle('skins:cape', (capeId) => s().skins.cape(capeId));
    handle('skins:forget', (id) => s().skins.forget(id));
    handle('skins:outfit-save', (data) => s().skins.saveOutfit({ name: data?.name, skin: data?.skin, variant: data?.variant, cape: data?.cape ?? null, capeName: data?.capeName }));
    handle('skins:outfit-apply', (id) => s().skins.applyOutfit(id));
    handle('skins:outfit-remove', (id) => s().skins.removeOutfit(id));

    // Hammer+: the code is checked here, in the main process – and so is every feature it unlocks.
    handle('plus:status', () => s().plus.status());
    handle('plus:activate', (code) => s().plus.activate(code));
    handle('plus:remove', () => s().plus.remove());
    // (await: readText answers at once in older Electron and with a promise in newer ones)
    handle('plus:paste', async () => String((await clipboard.readText()) ?? '').trim().slice(0, 2000));
    handle('plus:capes', () => s().plus.capes());
    handle('plus:cape', (id) => s().plus.setCape(typeof id === 'string' ? id : null));
    handle('theme:background', () => s().theme.background());
    handle('theme:pick-background', () => s().theme.pickBackground());
    handle('theme:clear-background', () => s().theme.clearBackground());
    handle('theme:menu-background', () => s().theme.menuBackground());
    handle('theme:pick-menu-background', () => s().theme.pickMenuBackground());
    handle('theme:clear-menu-background', () => s().theme.clearMenuBackground());
    handle('cloud:status', () => s().cloud.status());
    handle('cloud:push', (opts) => s().cloud.push({ force: Boolean(opts?.force), baseUpdatedAt: opts?.baseUpdatedAt }));
    handle('cloud:pull', () => s().cloud.pull());
    handle('cloud:startup', () => s().cloud.startup());

    // The official Minecraft: worlds and settings to bring over (the server list has its own handlers above).
    handle('official:info', () => s().official.info());
    handle('official:worlds', (id) => s().official.worlds(id));
    handle('official:import-worlds', (id, folders) => s().official.importWorlds(id, Array.isArray(folders) ? folders.filter((f) => typeof f === 'string') : []));
    handle('official:import-options', (id) => s().official.importOptions(id));

    // Udostępnianie: an instance as a code or a .hammerpack file. Codes and files are checked in the services.
    handle('share:export', (id, opts) => s().share.export(id, { options: Boolean(opts?.options) }));
    handle('share:save', (id, opts) => s().share.save(id, { options: Boolean(opts?.options) }));
    handle('share:read-code', (code) => s().share.readCode(typeof code === 'string' ? code : ''));
    handle('share:read-file', (file) => s().share.readFile(typeof file === 'string' ? file : ''));
    handle('share:pick', () => s().share.pick());
    handle('share:install', (token) => s().share.install(String(token)));

    // Zaproszenia (hammer://join) and featured servers. A link only ever leads to a question in the window.
    handle('invite:pending', () => {
      const link = pendingInvite;
      pendingInvite = null;
      windowAsked = true;
      return link;
    });
    handle('invite:read', (input) => s().invite.read(typeof input === 'string' ? input : typeof input?.featured === 'string' ? { featured: input.featured } : ''));
    handle('invite:accept', (token, choice) => s().invite.accept(token, { instanceId: typeof choice?.instanceId === 'string' ? choice.instanceId : null }));
    handle('invite:link', (id, address, opts) => s().invite.link(id, address, { pack: opts?.pack !== false }));
    handle('featured:list', () => s().featured.list());

    // The clipboard for codes and links (await: Electron's clipboard answers with promises).
    handle('clipboard:read', async () => String((await clipboard.readText()) ?? '').trim().slice(0, 16384));
    handle('clipboard:write', async (text) => {
      await clipboard.writeText(String(text ?? '').slice(0, 16384));
      return true;
    });

    handle('optimizer:info', (id) => s().optimizerInfo(id));
    handle('optimizer:plan', (id, opts) => s().optimizer.plan(inst(id), opts));
    handle('optimizer:apply', (id, opts) => s().applyOptimization(id, opts));
  }

  // A second start (a click on a hammer:// link while the launcher is open, or its icon): this window comes to the front.
  app.on('second-instance', (_event, argv) => openInvite(inviteFromArgs(argv)));
  // macOS hands a clicked link over this way – also before the window exists.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    openInvite(inviteFromArgs([url]));
  });

  app.whenReady().then(async () => {
    try {
      const info = await app.getGPUInfo('complete');
      // Every graphics card of the computer: on a laptop the launcher window may use the weak one, the game the fast one.
      const VENDORS = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' };
      const name = (d) => `${d.vendorString || VENDORS[d.vendorId] || ''} ${d.deviceString ?? ''}`.trim();
      const device = info?.gpuDevice?.find((d) => d.active) ?? info?.gpuDevice?.[0];
      gpu = { name: info?.auxAttributes?.glRenderer || (device ? name(device) : '') || null, devices: (info?.gpuDevice ?? []).map(name).filter(Boolean) };
    } catch {
      gpu = null;
    }
    registerProtocol();
    setupServices();
    registerIpc();
    createWindow();
    services.updates.start(); // mod updates: a quiet look shortly after the start, then every six hours
    services.news.start(); // the shop's news and messages: a quiet look every ten minutes
  });

  // The launcher is closing: an update that was downloaded installs now – never under a running game (selfupdate.js).
  app.on('quit', (_event, exitCode) => services?.selfUpdate.installOnQuit(exitCode));

  app.on('window-all-closed', () => {
    // A running game keeps the launcher alive (play time, logs); it quits when the game ends.
    if (services?.games.running.size) return;
    // An automatic world backup that is still being packed is finished first – half a zip helps nobody.
    (services ? services.afterSessions() : Promise.resolve()).finally(() => {
      if (services?.games.running.size) return;
      presence?.close();
      app.quit();
    });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
