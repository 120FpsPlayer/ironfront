'use strict';

/**
 * HammerShop bot – startup file. Set this as the "startup file" on your host (Wispbyte, Pterodactyl…)
 * or run it locally: node index.js
 *
 * If the host did not install the dependencies (e.g. the bot sits in a subfolder),
 * they are installed here automatically on the first start.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 18 || (major === 18 && minor < 17)) {
  console.error(`❌ HammerShop wymaga Node.js 18.17 lub nowszego (masz ${process.versions.node}). Zmień wersję Node / obraz Dockera w panelu hostingu.`);
  process.exit(1);
}

const root = __dirname;
if (!fs.existsSync(path.join(root, 'node_modules', 'discord.js', 'package.json'))) {
  console.log('ℹ️  Instaluję zależności (tylko przy pierwszym uruchomieniu)…');
  try {
    execSync('npm install --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error(`❌ Nie udało się zainstalować zależności. Uruchom samodzielnie „npm install” w: ${root}`);
    process.exit(1);
  }
}

require('./src/index.js');
