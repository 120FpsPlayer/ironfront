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
  // 'beta' puts a small „BETA” mark next to the launcher's name; '' or 'stable' = no mark. Only a label – the
  // product, the installer and the folders keep their names.
  channel: 'beta',
  website: 'https://hammershop.pl',
  shopUrl: 'https://hammershop.pl',
  // The bot's website (GET /api/shop/store) – Discord invite and store products. Empty = the website above.
  shopApi: '',
  discordInvite: '',
  newsUrl: '',
  server: { name: 'Serwer HammerShop', address: '' },
  discordClientId: '',
  microsoft: { clientId: '', redirect: '' },
  // The launcher's own updates (selfupdate.js): the folder with latest.yml. Empty = "<shopApi or website>/updates".
  updateUrl: '',
  // Base64 of the raw 32-byte Ed25519 key that signs launcher updates. Empty = signatures are not enforced.
  updatePublicKey: '',
  // Hammer+: base64 of the raw 32-byte Ed25519 key the shop signs its codes with. Empty = codes cannot be activated.
  plusPublicKey: '',
  defaultInstance: { name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric', optimized: true },
  // „Udostępnij link” in the Galeria tab: where a screenshot is uploaded (a host that is not HammerShop's) and how
  // long it stays there (1h, 12h, 24h or 72h). An empty url hides the button – nothing is uploaded then.
  screenshotShare: { url: '', time: '72h' },
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
    screenshotShare: { ...DEFAULTS.screenshotShare, ...(raw.screenshotShare && typeof raw.screenshotShare === 'object' ? raw.screenshotShare : {}) },
  };
}

module.exports = { loadConfig, DEFAULTS };
