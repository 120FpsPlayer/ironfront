'use strict';

/**
 * The bridge between the interface and the launcher: window.hs.* – each call returns a Promise, and
 * errors come back as Error with a Polish message. Nothing else of Node or Electron reaches the page.
 */

const { contextBridge, ipcRenderer, webUtils } = require('electron');

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res?.ok) throw new Error(res?.error ?? 'Nieznany błąd');
  return res.data;
}

/**
 * The launcher's language and – for English – its dictionary, known before the page builds anything
 * ({ lang: 'pl' | 'en', dict }). Asked once, synchronously, so the first screen is already in the right language.
 */
function languageAtStart() {
  try {
    const res = ipcRenderer.sendSync('i18n:boot');
    if (res?.lang === 'en' && res.dict) return { lang: 'en', dict: res.dict };
  } catch {
    // the launcher did not answer – Polish, the language the interface is written in
  }
  return { lang: 'pl', dict: null };
}
const language = languageAtStart();

const listeners = new Map();
ipcRenderer.on('hs:event', (_e, { channel, payload }) => {
  for (const fn of listeners.get(channel) ?? []) fn(payload);
});

const api = {
  on(channel, fn) {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel).add(fn);
    return () => listeners.get(channel)?.delete(fn);
  },
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  // The language the page starts in; load() answers the same after the setting changed (Ustawienia → Język).
  i18n: { lang: language.lang, dict: language.dict, load: () => call('i18n:load') },
  app: { info: () => call('app:info'), openExternal: (url) => call('app:open-external', url), openFolder: (id, sub) => call('app:open-folder', id, sub) },
  window: { minimize: () => call('window:minimize'), maximize: () => call('window:maximize'), close: () => call('window:close') },
  settings: { get: () => call('settings:get'), set: (patch) => call('settings:set', patch) },
  system: { info: () => call('system:info') },
  news: { feed: () => call('news:feed'), refresh: () => call('news:refresh'), closeAlert: () => call('news:close-alert'), seen: () => call('news:seen') },
  selfUpdate: { status: () => call('selfupdate:status'), check: () => call('selfupdate:check'), download: () => call('selfupdate:download'), install: () => call('selfupdate:install'), update: () => call('selfupdate:update'), whatsNew: () => call('selfupdate:whats-new'), seen: () => call('selfupdate:seen') },
  server: { ping: (address) => call('server:ping', address) },
  accounts: { list: () => call('accounts:list'), login: () => call('accounts:login'), remove: (id) => call('accounts:remove', id), select: (id) => call('accounts:select', id) },
  versions: { minecraft: (opts) => call('versions:minecraft', opts), loaders: (loader, mc) => call('versions:loaders', loader, mc) },
  instances: {
    list: () => call('instances:list'),
    ensureDefault: () => call('instances:ensure-default'),
    create: (data) => call('instances:create', data),
    update: (id, patch) => call('instances:update', id, patch),
    remove: (id) => call('instances:remove', id),
    duplicate: (id) => call('instances:duplicate', id),
    repair: (id) => call('instances:repair', id),
    select: (id) => call('instances:select', id),
  },
  game: { launch: (id, opts) => call('game:launch', id, opts), stop: (id) => call('game:stop', id), logs: (id) => call('game:logs', id), running: () => call('game:running') },
  content: {
    list: (id, type) => call('content:list', id, type),
    identify: (id, type) => call('content:identify', id, type),
    toggle: (id, type, file, enabled) => call('content:toggle', id, type, file, enabled),
    remove: (id, type, file) => call('content:remove', id, type, file),
    install: (id, what) => call('content:install', id, what),
    import: (id, type, paths) => call('content:import', id, type, paths),
  },
  modrinth: { search: (p) => call('modrinth:search', p), project: (id) => call('modrinth:project', id), versions: (id, f) => call('modrinth:versions', id, f), categories: () => call('modrinth:categories') },
  modpacks: { install: (what) => call('modpacks:install', what), import: () => call('modpacks:import') },
  community: { discord: () => call('community:discord'), shop: (o) => call('community:shop', o) },
  gallery: {
    list: (id) => call('gallery:list', id),
    remove: (id, file) => call('gallery:remove', id, file),
    copy: (id, file) => call('gallery:copy', id, file),
    show: (id, file) => call('gallery:show', id, file),
    shareInfo: () => call('gallery:share-info'),
    share: (id, file, opts) => call('gallery:share', id, file, opts),
  },
  benchmark: { info: (id) => call('benchmark:info', id), start: (id, opts) => call('benchmark:start', id, opts), running: () => call('benchmark:running') },
  play: { summary: () => call('play:summary'), dismiss: () => call('play:dismiss') },
  updates: {
    status: () => call('updates:status'),
    list: (id) => call('updates:list', id),
    check: (id) => call('updates:check', id),
    apply: (id, items) => call('updates:apply', id, items),
    undo: (id) => call('updates:undo', id),
    points: (id) => call('updates:points', id),
  },
  optimizer: { info: (id) => call('optimizer:info', id), plan: (id, o) => call('optimizer:plan', id, o), apply: (id, o) => call('optimizer:apply', id, o) },
  servers: {
    list: (id) => call('servers:list', id),
    official: () => call('servers:official'),
    importOfficial: (id) => call('servers:importOfficial', id),
    add: (id, data) => call('servers:add', id, data),
    update: (id, index, patch, expected) => call('servers:update', id, index, patch, expected),
    remove: (id, index, expected) => call('servers:remove', id, index, expected),
    move: (id, from, to) => call('servers:move', id, from, to),
  },
  worlds: {
    list: (id) => call('worlds:list', id),
    rename: (id, folder, name) => call('worlds:rename', id, folder, name),
    remove: (id, folder) => call('worlds:remove', id, folder),
    open: (id, folder) => call('worlds:open', id, folder),
    backup: (id, folder) => call('worlds:backup', id, folder),
    backups: (id) => call('worlds:backups', id),
    restore: (id, file) => call('worlds:restore', id, file),
    removeBackup: (id, file) => call('worlds:remove-backup', id, file),
    restoreInPlace: (id, folder, file) => call('worlds:restore-in-place', id, folder, file),
  },
  official: { info: () => call('official:info'), worlds: (id) => call('official:worlds', id), importWorlds: (id, folders) => call('official:import-worlds', id, folders), importOptions: (id) => call('official:import-options', id) },
  share: {
    export: (id, opts) => call('share:export', id, opts),
    save: (id, opts) => call('share:save', id, opts),
    readCode: (code) => call('share:read-code', code),
    readFile: (file) => call('share:read-file', file),
    pick: () => call('share:pick'),
    install: (token) => call('share:install', token),
  },
  invite: { pending: () => call('invite:pending'), read: (input) => call('invite:read', input), accept: (token, choice) => call('invite:accept', token, choice), link: (id, address, opts) => call('invite:link', id, address, opts) },
  featured: { list: () => call('featured:list') },
  clipboard: { read: () => call('clipboard:read'), write: (text) => call('clipboard:write', text) },
  cleanup: { usage: () => call('cleanup:usage'), plan: () => call('cleanup:plan'), apply: (keys) => call('cleanup:apply', keys) },
  logs: { share: (id) => call('logs:share', id) },
  bundles: { list: () => call('bundles:list'), plan: (id, bundleId) => call('bundles:plan', id, bundleId), install: (id, bundleId) => call('bundles:install', id, bundleId) },
  skins: {
    get: () => call('skins:get'),
    pick: () => call('skins:pick'),
    upload: (data) => call('skins:upload', data),
    use: (id, variant) => call('skins:use', id, variant),
    reset: () => call('skins:reset'),
    cape: (capeId) => call('skins:cape', capeId),
    forget: (id) => call('skins:forget', id),
    saveOutfit: (data) => call('skins:outfit-save', data),
    applyOutfit: (id) => call('skins:outfit-apply', id),
    removeOutfit: (id) => call('skins:outfit-remove', id),
  },
  plus: {
    status: () => call('plus:status'),
    renew: () => call('plus:renew'),
    activate: (code) => call('plus:activate', code),
    remove: () => call('plus:remove'),
    paste: () => call('plus:paste'),
    capes: () => call('plus:capes'),
    setCape: (id) => call('plus:cape', id),
    setCapeOn: (on, lastMojang) => call('plus:cape-on', on, lastMojang),
    pickCape: () => call('plus:cape-pick'),
    removeCape: () => call('plus:cape-remove'),
    cosmetics: () => call('plus:cosmetics'),
    setCosmetic: (slot, value) => call('plus:cosmetic', slot, value),
  },
  theme: {
    background: () => call('theme:background'),
    pickBackground: () => call('theme:pick-background'),
    clearBackground: () => call('theme:clear-background'),
    menuBackground: () => call('theme:menu-background'),
    pickMenuBackground: () => call('theme:pick-menu-background'),
    clearMenuBackground: () => call('theme:clear-menu-background'),
  },
  cloud: { status: () => call('cloud:status'), push: (opts) => call('cloud:push', opts), pull: () => call('cloud:pull'), startup: () => call('cloud:startup') },
};

contextBridge.exposeInMainWorld('hs', api);
