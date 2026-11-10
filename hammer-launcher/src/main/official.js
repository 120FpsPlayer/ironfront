'use strict';

/**
 * The player's "normal" Minecraft – the game folder of the official Minecraft Launcher. The server list is not part
 * of the Microsoft account: it is a file (servers.dat) in that folder, and every instance of this launcher has a
 * folder of its own. So the list is brought over from there (see servers.importFrom).
 */

const os = require('node:os');
const path = require('node:path');

function officialMinecraftDir({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.minecraft');
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'minecraft');
  return path.join(home, '.minecraft');
}

module.exports = { officialMinecraftDir };
