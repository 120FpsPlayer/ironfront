'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Each test file gets its own empty database folder.
process.env.NOX_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'nox-test-'));
process.env.DISCORD_TOKEN ??= 'test.token.value';

// Tests never reach the internet (Stripe, PayPal, crypto rates…) – a test that needs it fakes global.fetch.
global.fetch = async (url) => {
  throw new Error(`No network in tests: ${url}`);
};

const db = require('../../src/lib/db');

db.load();
require('../../src/features/load'); // features register their panels, hooks and buttons

module.exports = { db };
