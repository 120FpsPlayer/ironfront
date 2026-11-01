'use strict';

/**
 * npm run check – validates config.json and renders every panel, card and form against
 * Discord's limits (no token needed). Run it after editing config.json.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

process.chdir(path.join(__dirname, '..'));

try {
  const config = require('../src/lib/config');
  console.log(`✔ config.json is valid – ${config.ticketTypes.length} ticket types, ${config.snippets.length} canned replies, ${config.shop.paymentMethods.length} payment methods`);
  const off = config.turnedOff();
  if (off.length) console.log(`ℹ Turned off in config.json: ${off.join(', ')}.`);
} catch (err) {
  console.error(`✖ ${err.message}`);
  process.exit(1);
}

const tests = ['test/payloads.test.js', 'test/build.test.js'];
const res = spawnSync(process.execPath, ['--test', ...tests], { stdio: 'pipe', encoding: 'utf8' });
const out = `${res.stdout}${res.stderr}`;
const failed = out.split('\n').filter((l) => l.startsWith('not ok'));
for (const line of out.split('\n').filter((l) => /^(not )?ok /.test(l))) console.log(line.startsWith('ok') ? `✔ ${line.replace(/^ok \d+ - /, '')}` : `✖ ${line.replace(/^not ok \d+ - /, '')}`);
if (res.status !== 0) {
  if (!failed.length) console.error(out);
  console.error('\n✖ Something in config.json breaks a Discord limit – see the failing check above (run "npm test" for details).');
  process.exit(1);
}
console.log('\nAll good ✅');
