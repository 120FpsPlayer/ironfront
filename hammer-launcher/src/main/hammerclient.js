'use strict';

/**
 * Hammer Client – the launcher's in-game mod (custom main menu, module panel, HUD, zoom). It ships inside the
 * launcher (resources/hammer-client.jar) and is put into Fabric / Quilt instances of a supported Minecraft version
 * before each start, together with Fabric API, which it needs. Turned off in the instance → the jar is removed.
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha1File } = require('./net');

const SUPPORTED = ['1.21', '1.21.1'];
const FILE = 'hammer-client.jar';

function supports(instance) {
  return ['fabric', 'quilt'].includes(instance?.loader) && SUPPORTED.includes(instance?.mcVersion);
}

const wanted = (instance) => instance.hammerClient !== false && supports(instance);

/**
 * Puts the mod in place (or removes it). Returns { active, reason? }.
 * links: { discordUrl, shopUrl, brand } for config/hammerclient-launcher.json (the mod's Discord / shop buttons).
 */
async function syncHammerClient({ instance, jar, content, links = {} }) {
  const mods = path.join(instance.dir, 'mods');
  const target = path.join(mods, FILE);
  if (!wanted(instance)) {
    fs.rmSync(target, { force: true });
    return { active: false, reason: supports(instance) ? 'off' : 'unsupported' };
  }
  // Switched off by hand in the mods list (.disabled) – respect it.
  if (fs.existsSync(`${target}.disabled`)) return { active: false, reason: 'disabled' };
  if (!jar || !fs.existsSync(jar)) return { active: false, reason: 'missing' };
  fs.mkdirSync(mods, { recursive: true });
  if (!fs.existsSync(target) || sha1File(target) !== sha1File(jar)) fs.copyFileSync(jar, target);

  const hasApi = fs.readdirSync(mods).some((f) => /^fabric-api.*\.jar$/i.test(f) || /^qfapi.*\.jar$/i.test(f));
  if (!hasApi) await content.install(instance, { projectId: 'fabric-api', type: 'mod' });

  const configDir = path.join(instance.dir, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const https = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : '');
  fs.writeFileSync(path.join(configDir, 'hammerclient-launcher.json'), JSON.stringify({ discordUrl: https(links.discordUrl), shopUrl: https(links.shopUrl), brand: links.brand || 'HammerShop' }, null, 2));
  return { active: true };
}

module.exports = { syncHammerClient, supports, SUPPORTED, FILE };
