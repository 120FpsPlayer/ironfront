'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/lib/config');

const shipped = () => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
// Sections that were added after the first version – an older config.json doesn't have them.
const NEW_SECTIONS = ['orders', 'promos', 'welcomeDiscount', 'invites', 'shopStatus', 'security', 'backups', 'salesReport'];

test('config: an older config.json without the new sections gets exactly what the shipped config.json has', () => {
  const old = shipped();
  for (const key of NEW_SECTIONS) delete old[key];
  const loaded = config.load(old);
  const expected = shipped();
  for (const key of NEW_SECTIONS) assert.deepEqual(loaded[key], expected[key], key);
  assert.deepEqual(config.turnedOff(), [], 'the shipped config.json turns nothing off');

  // Defaults are copies – changing one config never changes another.
  const a = config.load(Object.assign(shipped(), { invites: { enabled: true } }));
  a.invites.rewards.push({ invites: 99, percent: 50 });
  const b = config.load(Object.assign(shipped(), { invites: { enabled: true } }));
  assert.equal(b.invites.rewards.length, 3);

  // What the owner wrote always wins.
  const own = config.load(Object.assign(shipped(), { invites: { rewards: [] }, backups: { everyHours: 6 } }));
  assert.deepEqual(own.invites, { enabled: true, rewards: [] });
  assert.deepEqual(own.backups, { enabled: true, everyHours: 6 });
});

test('config: features turned off in config.json are listed for the startup line', () => {
  const raw = shipped();
  raw.backups.enabled = false;
  raw.salesReport = { enabled: false };
  raw.invites.enabled = false;
  raw.orders.vouchReminderHours = 0;
  assert.deepEqual(config.turnedOff(config.load(raw)), [
    'invite tracking (invites.enabled)',
    'automatic backups (backups.enabled)',
    'weekly sales report (salesReport.enabled)',
    'vouch reminders (orders.vouchReminderHours)',
  ]);
  assert.deepEqual(config.turnedOff(), []);
});
