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

  /** While the game runs with the launcher hidden, a tray icon brings it back (or stops the game). */
  function showTray() {
    if (tray) return;
    tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: process.platform === 'darwin' ? 18 : 32 }));
    tray.setToolTip(`${config.name} – gra działa`);
    const showWin = () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      win.focus();
    };
    tray.on('click', showWin);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Pokaż launcher', click: showWin },
        { label: 'Zatrzymaj grę', click: () => [...(services?.games.running.keys() ?? [])].forEach((id) => services.games.stop(id)) },
        { type: 'separator' },
        { label: 'Zamknij launcher', click: () => app.quit() },
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

  /** Only https links (and the configured Discord invite) leave the app – in the system browser. */
  const openExternal = (url) => {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error('Można otwierać tylko adresy https.');
    return shell.openExternal(u.toString());
  };

  function createWindow() {
    win = new BrowserWindow({
      width: 1240,
      height: 780,
      minWidth: 1040,
      minHeight: 660,
      frame: false,
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
      backgroundColor: '#0e0b09',
      show: false,
      title: config.name,
      icon: ICON,
      webPreferences: { preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
    });
    Menu.setApplicationMenu(null);
    win.once('ready-to-show', () => win.show());
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

  function setupServices() {
    const root = defaultRoot(app.getPath('appData'));
    fs.mkdirSync(root, { recursive: true });
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
      windowProperties: { width: 520, height: 680, resizable: false, title: 'Logowanie Microsoft', icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'), parent: win ?? undefined, modal: Boolean(win), autoHideMenuBar: true },
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
      presence: { set: (a) => (services?.settings.get().discordRpc ? presence.set(a) : null), clear: () => presence.clear() },
      gpuInfo: () => gpu,
      // Worlds and backups the player removes go to the system trash, never straight off the disk.
      trash: (target) => shell.trashItem(target).catch(() => Promise.reject(new Error('Nie udało się przenieść do kosza. Zamknij programy, które mogą używać tych plików, i spróbuj ponownie.'))),
      // The system's file dialog (the backgrounds of Hammer+).
      pickFile: async ({ title, filters }) => {
        const res = await dialog.showOpenDialog(win, { title, properties: ['openFile'], filters });
        return res.canceled ? null : res.filePaths[0] ?? null;
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
    services.games.on('state', ({ state }) => {
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
        if (state === 'exited' && services.settings.get().closeOnExit && !services.games.running.size) services.afterSessions().finally(() => !services.games.running.size && app.quit());
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
    handle('app:info', () => ({
      version: app.getVersion(),
      platform: process.platform,
      config: { name: config.name, brand: config.brand, website: config.website, shopUrl: config.shopUrl, discordInvite: config.discordInvite, server: config.server },
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
    handle('news:list', () => s().news());
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
    handle('content:remove', (id, type, file) => s().content.remove(inst(id), type, file));
    handle('content:updates', (id, type) => s().content.checkUpdates(inst(id), type));
    handle('content:update', (id, type, updates) => s().content.update(inst(id), type, updates));
    handle('content:install', (id, what) => s().content.install(inst(id), what));
    handle('content:import', async (id, type, filePaths) => {
      const instance = inst(id);
      let files = filePaths;
      if (!files?.length) {
        const ext = type === 'mod' ? ['jar'] : ['zip'];
        const res = await dialog.showOpenDialog(win, { title: 'Dodaj pliki', properties: ['openFile', 'multiSelections'], filters: [{ name: type === 'mod' ? 'Mody (.jar)' : 'Paczki (.zip)', extensions: ext }] });
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
      const res = await dialog.showOpenDialog(win, { title: 'Importuj paczkę modów', properties: ['openFile'], filters: [{ name: 'Paczka Modrinth (.mrpack)', extensions: ['mrpack'] }] });
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
      const res = await dialog.showOpenDialog(win, { title: 'Wybierz skórkę', properties: ['openFile'], filters: [{ name: 'Skórka Minecraft (.png)', extensions: ['png'] }] });
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

    handle('optimizer:info', (id) => s().optimizerInfo(id));
    handle('optimizer:plan', (id, opts) => s().optimizer.plan(inst(id), opts));
    handle('optimizer:apply', (id, opts) => s().applyOptimization(id, opts));
  }

  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
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
    setupServices();
    registerIpc();
    createWindow();
  });

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
