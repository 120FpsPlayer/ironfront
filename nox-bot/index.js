'use strict';

/**
 * NØX bot – startup file. Set this as the "startup file" on your host (Wispbyte, Pterodactyl…)
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
  console.error(`❌ NØX needs Node.js 18.17 or newer (you have ${process.versions.node}). Change the Node version / Docker image in your hosting panel.`);
  process.exit(1);
}

const root = __dirname;
if (!fs.existsSync(path.join(root, 'node_modules', 'discord.js', 'package.json'))) {
  console.log('ℹ️  Installing dependencies (first start only)…');
  try {
    execSync('npm install --omit=dev --no-audit --no-fund', { cwd: root, stdio: 'inherit' });
  } catch {
    console.error(`❌ Could not install dependencies. Run "npm install" yourself in: ${root}`);
    process.exit(1);
  }
}

require('./src/index.js');
