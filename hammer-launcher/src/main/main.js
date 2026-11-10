'use strict';

/**
 * Hammer Launcher – Electron main process: the window, the bridge to the interface (IPC) and the Electron
 * pieces of the services (login window, keychain, dialogs, opening links and folders).
 */

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, shell, safeStorage, dialog, Menu, Tray, nativeImage, clipboard } = require('electron');
const { loadConfig } = require('./config');
const { defaultRoot } = require('./paths');
const { createAccounts, createCrypt } = require('./accounts');
const { createServices } = require('./services');
const { createPresence } = require('./discordrpc');
const { safeName } = require('./net');

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
    services = createServices({ root, config, accounts, emit: send, presence: { set: (a) => (services?.settings.get().discordRpc ? presence.set(a) : null), clear: () => presence.clear() }, gpuInfo: () => gpu });
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
        if (state === 'exited' && services.settings.get().closeOnExit && !services.games.running.size) app.quit();
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
      return account;
    });
    handle('accounts:remove', (id) => {
      s().accounts.remove(id);
      if (s().settings.get().selectedAccount === id) s().settings.set({ selectedAccount: s().accounts.list()[0]?.id ?? null });
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
    handle('instances:select', (id) => s().settings.set({ selectedInstance: id }));

    handle('game:launch', (id, opts) => s().launch(id, { join: Boolean(opts?.join) }));
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
    handle('gallery:copy', (id, file) => {
      const image = nativeImage.createFromPath(s().gallery.file(id, file));
      if (image.isEmpty()) throw new Error('Nie udało się wczytać obrazu.');
      clipboard.writeImage(image);
      return true;
    });
    handle('gallery:show', (id, file) => shell.showItemInFolder(s().gallery.file(id, file)));

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
      const device = info?.gpuDevice?.find((d) => d.active) ?? info?.gpuDevice?.[0];
      gpu = info?.auxAttributes?.glRenderer || (device ? `${device.vendorString ?? ''} ${device.deviceString ?? ''}`.trim() || null : null);
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
    presence?.close();
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}
