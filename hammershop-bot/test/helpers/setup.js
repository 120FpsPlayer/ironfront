'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Each test file gets its own empty database folder.
process.env.HS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hammershop-test-'));
process.env.DISCORD_TOKEN ??= 'test.token.value';
// The tests are written for the shop server – whatever BOT_PROFILE this computer's .env has. The Hammer Launcher
// server's own test (profile-launcher.test.js) asks for its profile with HS_TEST_PROFILE.
process.env.BOT_PROFILE = process.env.HS_TEST_PROFILE ?? 'shop';

// Tests never reach the internet (Stripe, PayPal, crypto rates…) – a test that needs it fakes global.fetch.
global.fetch = async (url) => {
  throw new Error(`No network in tests: ${url}`);
};

const db = require('../../src/lib/db');

db.load();
require('../../src/features/load'); // features register their panels, hooks and buttons

module.exports = { db };
