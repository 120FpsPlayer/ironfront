'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPlus, parseCode, verifyCode, publicKey, cleanUuid } = require('../src/main/plus');
const { createServices } = require('../src/main/services');
const { loadConfig, DEFAULTS } = require('../src/main/config');
const { PLUS_ONLY, sanitize, DEFAULT_SETTINGS } = require('../src/main/settings');
const { tmpDir, plusKeys } = require('./helpers');

const NOW = Date.UTC(2026, 10, 11, 12); // 11 November 2026
const SEC = (ms) => Math.floor(ms / 1000);
const DAY = 86400;
const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };
const KOWAL = { id: 'fedcba98-7654-3210-fedc-ba9876543210', name: 'Kowal' }; // some launchers store the UUID with dashes

/** Hammer+ over a fresh folder, with the account list and the clock in the test's hands. */
function setup({ keys = plusKeys(), accounts = [GRACZ, KOWAL], selected = GRACZ } = {}) {
  const state = { accounts, selected, now: NOW };
  const file = path.join(tmpDir(), 'plus.json');
  const plus = createPlus({ file, publicKey: keys.publicKey, selected: () => state.selected, accounts: () => state.accounts, now: () => state.now });
  return { plus, keys, state, file };
}

test('a code is HP1.<payload>.<signature>: parsed, and verified with the shop\'s Ed25519 key', () => {
  const keys = plusKeys();
  const key = publicKey(keys.publicKey);
  const code = keys.code({ mc: GRACZ.id, exp: SEC(NOW) + 30 * DAY });
  assert.deepEqual(parseCode(code), { code, payload: code.split('.')[1], signature: code.split('.')[2], id: 'a1b2c3d4e5f60718', mc: GRACZ.id, exp: SEC(NOW) + 30 * DAY, iat: 1762000000 });
  assert.deepEqual(verifyCode(code, { key, now: NOW }).reason, 'ok');
  assert.equal(verifyCode(code, { key, now: NOW }).ok, true);
  // Copied from Discord: line breaks, spaces and backticks around it do not matter.
  assert.equal(verifyCode(` \`${code.slice(0, 40)}\n ${code.slice(40)}\` `, { key, now: NOW }).ok, true);
  assert.equal(verifyCode(keys.code({ mc: GRACZ.id, exp: 0 }), { key, now: NOW + 5000 * DAY * 1000 }).ok, true, 'exp 0 never ends');

  // Tampered: another account or a later end in the payload, a changed or cut signature, someone else's key.
  const [, payload, signature] = code.split('.');
  const forged = Buffer.from(JSON.stringify({ id: 'a1b2c3d4e5f60718', mc: cleanUuid(KOWAL.id), exp: 0, iat: 1762000000 })).toString('base64url');
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1); // one character of the signature changed
  for (const bad of [`HP1.${forged}.${signature}`, `HP1.${payload}.${flipped}`, `HP1.${payload}.${signature.slice(0, 40)}`, plusKeys().code({ mc: GRACZ.id })]) {
    assert.deepEqual(verifyCode(bad, { key, now: NOW }), { ok: false, reason: 'invalid', code: null });
  }
  // Expired exactly at `exp`.
  const old = keys.code({ mc: GRACZ.id, exp: SEC(NOW) });
  assert.equal(verifyCode(old, { key, now: NOW }).reason, 'expired');
  assert.equal(verifyCode(old, { key, now: NOW - 1000 }).ok, true);
  // No key in the launcher: nothing can be checked.
  assert.equal(verifyCode(code, { key: null, now: NOW }).reason, 'no-key');
  assert.equal(verifyCode(code, { key: publicKey(''), now: NOW }).reason, 'no-key');
  // Not codes at all.
  for (const junk of ['', null, 'HP1', 'HP1.abc', 'HP2.' + payload + '.' + signature, 'HP1.' + Buffer.from('[1,2]').toString('base64url') + '.' + signature, 'HP1.' + Buffer.from('{"mc":"xyz","exp":0}').toString('base64url') + '.' + signature, 'HP1.' + Buffer.from(`{"mc":"${GRACZ.id}","exp":-5}`).toString('base64url') + '.' + signature, 'x'.repeat(5000)]) {
    assert.equal(parseCode(junk), null);
    assert.equal(verifyCode(junk, { key, now: NOW }).reason, 'invalid');
  }
});

test('the public key is the raw 32 bytes in base64 – anything else is no key', () => {
  assert.ok(publicKey(plusKeys().publicKey));
  for (const bad of ['', '   ', null, undefined, 'not base64 !!!', Buffer.alloc(31).toString('base64'), Buffer.alloc(64).toString('base64')]) assert.equal(publicKey(bad), null);
  assert.equal(DEFAULTS.plusPublicKey, '', 'no key by default');
  assert.ok(publicKey(loadConfig().plusPublicKey), 'launcher.config.json ships the shop\'s key');
  assert.equal(loadConfig(path.join(tmpDir(), 'brak.json')).plusPublicKey, '');
});

test('status: active for the selected account until the code ends, with the reason when it is not', () => {
  const { plus, keys, state } = setup();
  const none = plus.status();
  assert.deepEqual([none.active, none.until, none.account, none.reason, none.hasCode, none.configured], [false, 0, null, 'none', false, true]);
  assert.match(none.text, /Nie masz jeszcze Hammer\+/);
  assert.equal(plus.token(), null);

  const until = SEC(NOW) + 30 * DAY;
  const code = keys.code({ mc: GRACZ.id, exp: until });
  const on = plus.activate(code);
  assert.deepEqual([on.active, on.until, on.account, on.reason, on.hasCode, on.codeId], [true, until, GRACZ, 'ok', true, 'a1b2c3d4e5f60718']);
  assert.match(on.text, /aktywny do 11 grudnia 2026 na koncie HammerGracz/);
  assert.equal(plus.token(), code, 'the code is the token for the shop API');
  assert.equal(plus.need('Chmura').active, true);

  // Another account is picked: the code stays, but it is not for this account – both nicks are named.
  state.selected = KOWAL;
  const wrong = plus.status();
  assert.deepEqual([wrong.active, wrong.until, wrong.reason, wrong.account], [false, 0, 'wrong-account', { id: GRACZ.id, name: 'HammerGracz' }]);
  assert.match(wrong.text, /jest dla konta HammerGracz, a teraz wybrane jest konto Kowal/);
  assert.equal(plus.token(), null);
  assert.throws(() => plus.need('Chmura'), /Chmura to funkcja Hammer\+\. Twój kod Hammer\+ jest dla konta HammerGracz/);
  // The account the code is for is no longer in the launcher: only the selected nick is known.
  state.accounts = [KOWAL];
  assert.match(plus.status().text, /jest dla innego konta Minecraft niż Kowal/);
  // Nobody signed in.
  state.selected = null;
  assert.deepEqual([plus.status().reason, plus.status().active], ['no-account', false]);
  assert.match(plus.status().text, /Zaloguj się kontem Microsoft/);

  // Back on the right account; then the code runs out while the launcher is open.
  state.accounts = [GRACZ, KOWAL];
  state.selected = GRACZ;
  assert.equal(plus.status().active, true);
  state.now = until * 1000 - 1;
  assert.equal(plus.status().active, true);
  state.now = until * 1000;
  const ended = plus.status();
  assert.deepEqual([ended.active, ended.until, ended.reason, ended.hasCode], [false, until, 'expired', true]);
  assert.match(ended.text, /wygasł 11 grudnia 2026/);
  assert.equal(plus.token(), null);
  assert.throws(() => plus.need('Własne tło launchera'), /Własne tło launchera to funkcja Hammer\+\. Twój Hammer\+ wygasł/);
});

test('activate: refusals in Polish; one code per account – the one that lasts longest', () => {
  const { plus, keys, state, file } = setup();
  assert.throws(() => plus.activate(''), /To nie wygląda na kod Hammer\+.*HP1\./);
  assert.throws(() => plus.activate('moj-kod-123'), /To nie wygląda na kod Hammer\+/);
  assert.throws(() => plus.activate(plusKeys().code({ mc: GRACZ.id })), /Ten kod jest nieprawidłowy/);
  assert.throws(() => plus.activate(keys.code({ mc: GRACZ.id, exp: SEC(NOW) - DAY })), /Ten kod wygasł 10 listopada 2026/);
  assert.throws(() => plus.activate(keys.code({ mc: 'a'.repeat(32) })), /jest dla innego konta Minecraft niż HammerGracz/);
  assert.equal(fs.existsSync(file), false, 'a refused code is not stored');
  assert.equal(plus.status().reason, 'none');
  assert.throws(() => plus.need('Zestawy skórek'), /Zestawy skórek to funkcja Hammer\+\. Włączysz go kodem ze sklepu – kliknij „Hammer\+” na górnym pasku\./);

  // A code for another account of this launcher is kept: it works as soon as that account is picked.
  const forKowal = plus.activate(keys.code({ mc: cleanUuid(KOWAL.id), exp: 0 }));
  assert.deepEqual([forKowal.active, forKowal.reason, forKowal.account.name], [false, 'wrong-account', 'Kowal']);
  state.selected = KOWAL;
  assert.deepEqual([plus.status().active, plus.status().until, plus.status().account], [true, 0, KOWAL]);
  assert.match(plus.status().text, /aktywny bezterminowo na koncie Kowal/);
  state.selected = GRACZ;

  const first = keys.code({ mc: GRACZ.id, exp: SEC(NOW) + 5 * DAY });
  const renewed = keys.code({ id: 'ffffffffffffffff', mc: GRACZ.id, exp: SEC(NOW) + 35 * DAY });
  plus.activate(first);
  assert.equal(plus.activate(renewed).until, SEC(NOW) + 35 * DAY);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).codes.length, 2, 'one for each account');
  assert.equal(plus.status().codeId, 'ffffffffffffffff');
  // Pasting the older code again by mistake takes nothing away: the code that lasts longer stays.
  assert.equal(plus.activate(first).until, SEC(NOW) + 35 * DAY);
  assert.equal(plus.activate(keys.code({ id: '0000000000000000', mc: GRACZ.id, exp: 0 })).until, 0, 'a code without an end beats one with a date');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).codes.length, 2);

  // Remove: only the selected account's code goes.
  assert.equal(plus.remove().reason, 'wrong-account');
  state.selected = KOWAL;
  assert.equal(plus.status().active, true);
  assert.equal(plus.remove().reason, 'none');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { codes: [] });

  // Nobody signed in → the code cannot be tied to an account.
  state.selected = null;
  assert.throws(() => plus.activate(first), /Najpierw zaloguj się kontem Microsoft/);
});

test('no key, a changed key and a damaged plus.json never unlock anything', () => {
  const keys = plusKeys();
  const { plus, file } = setup({ keys });
  plus.activate(keys.code({ mc: GRACZ.id }));
  // The same folder with a launcher that has no key, and with one that has another shop's key.
  const noKey = createPlus({ file, publicKey: '', selected: () => GRACZ, now: () => NOW });
  assert.deepEqual([noKey.status().active, noKey.status().reason, noKey.status().configured, noKey.configured], [false, 'no-key', false, false]);
  assert.match(noKey.status().text, /nie ma jeszcze klucza Hammer\+/);
  assert.throws(() => noKey.activate(keys.code({ mc: GRACZ.id })), /nie ma jeszcze klucza Hammer\+/);
  assert.throws(() => noKey.need('Chmura'), /Chmura to funkcja Hammer\+/);
  const otherKey = createPlus({ file, publicKey: plusKeys().publicKey, selected: () => GRACZ, now: () => NOW });
  assert.deepEqual([otherKey.status().active, otherKey.status().reason, otherKey.status().hasCode], [false, 'invalid', true]);
  assert.match(otherKey.status().text, /Zapisany kod Hammer\+ jest nieprawidłowy/);
  assert.equal(otherKey.remove().reason, 'none');
  for (const junk of ['{ broken', '[]', '{"codes":"HP1"}', '{"codes":[1,null,{"a":1}]}']) {
    fs.writeFileSync(file, junk);
    assert.equal(plus.status().reason, 'none');
  }
});

/** Services with two accounts and the shop's key; `log` collects what goes to the window. */
function services({ keys = plusKeys(), selected = GRACZ.id, now } = {}) {
  const events = [];
  const root = tmpDir();
  const s = createServices({ root, config: { brand: 'HammerShop', plusPublicKey: keys.publicKey }, accounts: { list: () => [GRACZ, KOWAL] }, emit: (channel, payload) => events.push({ channel, payload }), ...(now ? { now } : {}) });
  s.settings.set({ selectedAccount: selected });
  return { s, keys, events, root };
}

test('services: every Hammer+ setting is refused in the main process until a code is active', async () => {
  const { s, keys, root } = services();
  s.settings.set({ autoBackup: false }); // on by default (it only works with Hammer+) – switching off is always allowed
  const PAID = [
    [{ accent: 'custom', accentColor: '#12ab9f' }, /Własny kolor launchera to funkcja Hammer\+/],
    [{ heroStyle: 'aurora' }, /Animowane tło to funkcja Hammer\+/],
    [{ autoBackup: true }, /Automatyczne kopie światów to funkcja Hammer\+/],
    [{ hammerCape: 'gold' }, /Peleryny Hammer\+ to funkcja Hammer\+/],
    [{ cloudAuto: true }, /Automatyczna synchronizacja z chmurą to funkcja Hammer\+/],
    [{ background: 'background-0a1b2c3d.png' }, /Własne tło launchera to funkcja Hammer\+/],
    [{ theme: 'nether' }, /Motywy launchera to funkcja Hammer\+/],
    [{ cosmeticWings: 'angel' }, /Dodatki na postać to funkcja Hammer\+/],
    [{ cosmeticHalo: true }, /Dodatki na postać to funkcja Hammer\+/],
    [{ cosmeticHat: 'crown' }, /Dodatki na postać to funkcja Hammer\+/],
  ];
  assert.deepEqual(Object.keys(PLUS_ONLY).sort(), ['accent', 'autoBackup', 'background', 'cloudAuto', 'cosmeticHalo', 'cosmeticHat', 'cosmeticWings', 'hammerCape', 'heroStyle', 'theme'], 'a new paid setting needs a line in this test');
  for (const [patch, error] of PAID) assert.throws(() => s.settings.set(patch), error);
  assert.throws(() => s.settings.set({ memoryMb: 4096, heroStyle: 'stars' }), /Animowane tło/, 'a paid key refuses the whole change');
  assert.equal(s.settings.get().memoryMb, null);
  // Free settings and the six free colours work as before.
  assert.equal(s.settings.set({ accent: 'blue', autoBackupKeep: 9, memoryMb: 4096 }).accent, 'blue');
  await assert.rejects(s.theme.pickBackground(), /Własne tło launchera to funkcja Hammer\+/);
  await assert.rejects(s.plus.setCape('gold'), /Peleryny Hammer\+ to funkcja Hammer\+/);
  assert.throws(() => s.skins.saveOutfit({ name: 'PvP' }), /Zestawy skórek to funkcja Hammer\+/);
  assert.throws(() => s.skins.applyOutfit('abc'), /Zestawy skórek to funkcja Hammer\+/);
  await assert.rejects(s.cloud.push(), /Chmura to funkcja Hammer\+/);
  await assert.rejects(s.cloud.pull(), /Chmura to funkcja Hammer\+/);
  assert.deepEqual(await s.cloud.startup(), { skipped: true });
  assert.deepEqual(s.theme.background(), { url: null });
  assert.deepEqual(s.cloud.status(), { active: false, auto: false, last: null, note: null });

  // With a code every one of them goes through.
  const on = s.plus.activate(keys.code({ mc: GRACZ.id, exp: 0 }));
  assert.deepEqual([on.active, on.account.name], [true, 'HammerGracz']);
  for (const [patch] of PAID) s.settings.set(patch);
  const saved = s.settings.get();
  assert.deepEqual([saved.accent, saved.accentColor, saved.heroStyle, saved.autoBackup, saved.autoBackupKeep, saved.hammerCape, saved.cloudAuto], ['custom', '#12ab9f', 'aurora', true, 9, 'gold', true]);

  // The code lives in plus.json in the launcher folder – never in settings.json.
  assert.ok(fs.readFileSync(path.join(root, 'plus.json'), 'utf8').includes('HP1.'));
  assert.ok(!fs.readFileSync(path.join(root, 'settings.json'), 'utf8').includes('HP1.'));

  // Hammer+ gone: what was set stays stored, switching things off still works, switching on does not.
  assert.equal(s.plus.remove().active, false);
  assert.equal(s.settings.set({ memoryMb: 2048 }).heroStyle, 'aurora', 'other settings can still be saved');
  assert.equal(s.settings.set({ heroStyle: 'aurora', autoBackup: true }).autoBackup, true, 'the same values are not a change');
  assert.throws(() => s.settings.set({ heroStyle: 'stars' }), /Animowane tło/);
  const off = s.settings.set({ accent: 'orange', heroStyle: 'classic', autoBackup: false, hammerCape: '', cloudAuto: false, background: '' });
  assert.deepEqual([off.accent, off.heroStyle, off.autoBackup, off.hammerCape, off.cloudAuto], ['orange', 'classic', false, '', false]);
  const off2 = await s.plus.setCape(null);
  assert.deepEqual([off2.selected, off2.shared, off2.note], ['', false, null], 'taking the cape off is always allowed');
  await assert.rejects(s.plus.setCape('gold'), /Peleryny Hammer\+/, 'a Hammer+ cape needs a code');
  assert.equal((await s.plus.setCape('hammer')).selected, 'hammer', 'a free cape does not');
});

test('settings: the Hammer+ values are checked like every other setting', () => {
  const s = sanitize({ accent: 'custom', accentColor: '#AbCdEf', heroStyle: 'forge', autoBackup: 1, autoBackupKeep: 99, hammerCape: 'frost', cloudAuto: 'yes', background: 'background-0a1b2c3d.webp' });
  assert.deepEqual([s.accent, s.accentColor, s.heroStyle, s.autoBackup, s.autoBackupKeep, s.hammerCape, s.cloudAuto, s.background], ['custom', '#abcdef', 'forge', true, 20, 'frost', true, 'background-0a1b2c3d.webp']);
  const bad = sanitize({ accentColor: 'red; background:url(x)', heroStyle: 'matrix', autoBackupKeep: 0, hammerCape: '../x', background: '../../etc/passwd' });
  assert.deepEqual([bad.accentColor, bad.heroStyle, bad.autoBackupKeep, bad.hammerCape, bad.background], ['', 'classic', 1, '', '']);
  assert.deepEqual([DEFAULT_SETTINGS.autoBackup, DEFAULT_SETTINGS.autoBackupKeep, DEFAULT_SETTINGS.cloudAuto, DEFAULT_SETTINGS.heroStyle], [true, 5, false, 'classic']);
});

test('services: the window hears when Hammer+ changes – a code, another account, the end of the code', async () => {
  const { s, keys, events } = services();
  const heard = () => events.filter((e) => e.channel === 'plus:status').map((e) => [e.payload.active, e.payload.reason]);
  assert.deepEqual(heard(), [], 'nothing to tell at the start');
  const ends = Math.floor(Date.now() / 1000) + 2; // one to two seconds from now
  assert.equal(s.plus.activate(keys.code({ mc: GRACZ.id, exp: ends })).active, true);
  assert.deepEqual(heard(), [[true, 'ok']]);
  s.settings.set({ selectedAccount: KOWAL.id });
  assert.deepEqual(heard().at(-1), [false, 'wrong-account']);
  s.settings.set({ selectedInstance: 'x' });
  assert.equal(heard().length, 2, 'only a real change is announced');
  s.settings.set({ selectedAccount: GRACZ.id });
  assert.deepEqual(heard().at(-1), [true, 'ok']);
  // The code runs out with the launcher open: the window is told without anyone asking.
  await new Promise((r) => setTimeout(r, Math.max(0, ends * 1000 - Date.now()) + 900));
  assert.deepEqual(heard().at(-1), [false, 'expired']);
  assert.equal(heard().length, 4);
  assert.throws(() => s.settings.set({ heroStyle: 'aurora' }), /Twój Hammer\+ wygasł/);
  assert.deepEqual(s.plus.remove().reason, 'none');
  assert.deepEqual(heard().at(-1), [false, 'none']);
});
