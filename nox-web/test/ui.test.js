'use strict';

/**
 * The real page in a headless browser, against the server and fake Discord / Stripe:
 * sign in → activate access (Stripe) → back from Stripe → add to bag → checkout → My orders.
 * Skipped when Playwright / Chromium aren't installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startFakes, fakeEnv } = require('./fakes');

function playwright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright', '/usr/local/lib/node_modules/playwright', '/usr/lib/node_modules/playwright']) {
    try {
      return require(p);
    } catch {
      // next
    }
  }
  return null;
}
const pw = playwright();

test('the store page: sign in, access, bag, checkout, My orders – no errors on the way', { skip: !pw && 'Playwright is not installed' }, async () => {
  const fakes = await startFakes();
  fakeEnv(fakes.base, { DATA_DIR: fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'nox-ui-')) });
  // Fresh modules so this file gets its own env and store.
  for (const k of Object.keys(require.cache)) if (/nox-web[\\/](lib|server)/.test(k)) delete require.cache[k];
  require('../lib/store').load();
  const site = require('../server').createServer();
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${site.address().port}`;
  fakes.state.siteBase = base;

  const launch = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : {};
  const browser = await pw.chromium.launch(launch);
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
  // Discord sends straight back (test/fakes.js); the Stripe page is a stub.
  await page.route((u) => u.hostname === "checkout.stripe.com", (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Stripe</h1>' }));
  try {
    await page.goto(base);
    await page.waitForSelector('text=Find your next upgrade.');
    assert.equal(await page.locator('text=OFFLINE PREVIEW').count(), 0, 'live mode – no preview bar');
    assert.ok(await page.locator('text=per product').count() >= 4, 'real prices, not "preview price"');

    // Sign in with Discord
    await page.getByRole('button', { name: 'Connect Discord' }).first().click();
    await page.getByRole('link', { name: /Continue with Discord/ }).click();
    await page.waitForSelector('text=@tester', { timeout: 10_000 });

    // Activate access → Stripe
    const [stripeNav] = await Promise.all([page.waitForURL(/checkout\.stripe\.com/), page.getByRole('button', { name: /Activate my access/ }).click()]);
    void stripeNav;
    const sessionId = page.url().split('/').pop();
    fakes.pay(sessionId);
    await page.goto(`${base}/?payment=return&session_id=${sessionId}`);
    await page.waitForSelector('text=Payment confirmed. Your account is updated.');

    // Bag → checkout
    await page.keyboard.press('Escape');
    await page.locator('#collection').scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Add to bag' }).first().click();
    await page.waitForSelector('text=added to your bag');
    await page.getByRole('button', { name: /Open bag, 1 items/ }).click();
    await Promise.all([page.waitForURL(/checkout\.stripe\.com/), page.getByRole('button', { name: /Continue to checkout/ }).click()]);
    const productSession = page.url().split('/').pop();
    fakes.pay(productSession);
    await page.goto(`${base}/?payment=return&session_id=${productSession}`);
    await page.waitForSelector('text=Payment confirmed. Your account is updated.');
    await page.waitForSelector('text=PAID');
    assert.ok(await page.locator('text=Open a ticket in the NØX Discord').count(), 'delivery text in My orders');

    assert.deepEqual(problems, []);
  } catch (err) {
    await page.screenshot({ path: require('node:path').join(require('node:os').tmpdir(), 'nox-ui-fail.png') }).catch(() => null);
    console.log('URL', page.url(), 'problems', problems);
    throw err;
  } finally {
    await browser.close();
    site.close();
    fakes.server.close();
  }
});
