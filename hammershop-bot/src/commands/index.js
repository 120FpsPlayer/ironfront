'use strict';

const fs = require('node:fs');
const path = require('node:path');

module.exports = function loadCommands() {
  const commands = new Map();
  for (const file of fs.readdirSync(__dirname)) {
    if (!file.endsWith('.js') || file === 'index.js') continue;
    const command = require(path.join(__dirname, file));
    commands.set(command.data.name, command);
  }
  return commands;
};
