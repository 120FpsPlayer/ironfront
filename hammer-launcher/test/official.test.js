'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { officialMinecraftDir } = require('../src/main/official');

test('official Minecraft folder: where the Minecraft Launcher keeps the game on each system', () => {
  assert.equal(officialMinecraftDir({ platform: 'win32', env: { APPDATA: 'C:\\Users\\Gracz\\AppData\\Roaming' }, home: 'C:\\Users\\Gracz' }), path.join('C:\\Users\\Gracz\\AppData\\Roaming', '.minecraft'));
  assert.equal(officialMinecraftDir({ platform: 'win32', env: {}, home: '/home/gracz' }), path.join('/home/gracz', 'AppData', 'Roaming', '.minecraft'));
  assert.equal(officialMinecraftDir({ platform: 'darwin', env: {}, home: '/Users/gracz' }), path.join('/Users/gracz', 'Library', 'Application Support', 'minecraft'));
  assert.equal(officialMinecraftDir({ platform: 'linux', env: {}, home: '/home/gracz' }), path.join('/home/gracz', '.minecraft'));
});
