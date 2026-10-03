'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Loads every feature in this folder – each one registers its panels, hooks and buttons itself. */
for (const file of fs.readdirSync(__dirname).sort()) {
  if (file.endsWith('.js') && file !== 'load.js') require(path.join(__dirname, file));
}
