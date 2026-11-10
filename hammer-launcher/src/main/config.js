'use strict';

/**
 * launcher.config.json – the branding and links of the launcher (shop, Discord, news, server address…).
 * Missing keys fall back to the defaults below, so an older config file never breaks the launcher.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  name: 'Hammer Launcher',
  brand: 'HammerShop',
  website: 'https://hammershop.pl',
  shopUrl: 'https://hammershop.pl',
  // The bot's website (GET /api/shop/store) – Discord invite and store products. Empty = the website above.
  shopApi: '',
  discordInvite: '',
  newsUrl: '',
  server: { name: 'Serwer HammerShop', address: '' },
  discordClientId: '',
  microsoft: { clientId: '', redirect: '' },
  updateUrl: '',
  defaultInstance: { name: 'Hammer', loader: 'fabric', optimized: true },
};

function loadConfig(file = path.join(__dirname, '..', '..', 'launcher.config.json')) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // no file or invalid JSON → the defaults
  }
  return {
    ...DEFAULTS,
    ...raw,
    server: { ...DEFAULTS.server, ...(raw.server ?? {}) },
    microsoft: { ...DEFAULTS.microsoft, ...(raw.microsoft ?? {}) },
    defaultInstance: { ...DEFAULTS.defaultInstance, ...(raw.defaultInstance ?? {}) },
  };
}

module.exports = { loadConfig, DEFAULTS };
