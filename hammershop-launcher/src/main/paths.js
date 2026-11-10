'use strict';

/**
 * Where the launcher keeps its files. Everything lives under one folder (by default %APPDATA%\.hammershop on
 * Windows, ~/.hammershop elsewhere):
 *
 *   versions/ libraries/ assets/   shared by every instance (like .minecraft)
 *   runtime/<component>/           Java downloaded from Mojang (java-runtime-delta = Java 21 …)
 *   instances/<id>/                one game folder per instance: mods, saves, options.txt, instance.json
 *   cache/ logs/                   downloads in progress and launcher logs
 */

const os = require('node:os');
const path = require('node:path');

function defaultRoot(appData) {
  if (appData && process.platform === 'win32') return path.join(appData, '.hammershop');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'hammershop');
  return path.join(os.homedir(), '.hammershop');
}

function createPaths(root) {
  return {
    root,
    shared: root,
    versions: path.join(root, 'versions'),
    runtime: path.join(root, 'runtime'),
    instances: path.join(root, 'instances'),
    cache: path.join(root, 'cache'),
    logs: path.join(root, 'logs'),
    settings: path.join(root, 'settings.json'),
    accounts: path.join(root, 'accounts.json'),
  };
}

module.exports = { createPaths, defaultRoot };
