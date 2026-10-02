'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Each test file gets its own empty database folder.
process.env.NOX_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nox-test-'));
// Tests work on a copy of config.json, so /reload tests can edit it safely.
process.env.NOX_CONFIG_PATH = path.join(process.env.NOX_DATA_DIR, 'config.json');
fs.copyFileSync(path.join(__dirname, '..', '..', 'config.json'), process.env.NOX_CONFIG_PATH);
process.env.DISCORD_TOKEN ??= 'test.token.value';

const db = require('../../src/lib/db');

db.load();

module.exports = { db };
