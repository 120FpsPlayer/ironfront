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
  app: { info: () => call('app:info'), openExternal: (url) => call('app:open-external', url), openFolder: (id, sub) => call('app:open-folder', id, sub) },
  window: { minimize: () => call('window:minimize'), maximize: () => call('window:maximize'), close: () => call('window:close') },
  settings: { get: () => call('settings:get'), set: (patch) => call('settings:set', patch) },
  system: { info: () => call('system:info') },
  news: { list: () => call('news:list') },
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
    updates: (id, type) => call('content:updates', id, type),
    update: (id, type, updates) => call('content:update', id, type, updates),
    install: (id, what) => call('content:install', id, what),
    import: (id, type, paths) => call('content:import', id, type, paths),
  },
  modrinth: { search: (p) => call('modrinth:search', p), project: (id) => call('modrinth:project', id), versions: (id, f) => call('modrinth:versions', id, f), categories: () => call('modrinth:categories') },
  modpacks: { install: (what) => call('modpacks:install', what), import: () => call('modpacks:import') },
  community: { discord: () => call('community:discord'), shop: (o) => call('community:shop', o) },
  gallery: { list: (id) => call('gallery:list', id), remove: (id, file) => call('gallery:remove', id, file), copy: (id, file) => call('gallery:copy', id, file), show: (id, file) => call('gallery:show', id, file) },
  optimizer: { info: (id) => call('optimizer:info', id), plan: (id, o) => call('optimizer:plan', id, o), apply: (id, o) => call('optimizer:apply', id, o) },
  servers: {
    list: (id) => call('servers:list', id),
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
  },
  cleanup: { usage: () => call('cleanup:usage'), plan: () => call('cleanup:plan'), apply: (keys) => call('cleanup:apply', keys) },
  logs: { share: (id) => call('logs:share', id) },
};

contextBridge.exposeInMainWorld('hs', api);
