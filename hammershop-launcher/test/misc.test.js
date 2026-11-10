'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { ping, motdText, varInt, mcString, packet, readVarInt } = require('../src/main/serverping');
const { createInstances, slug } = require('../src/main/instances');
const { createSettings, sanitize, DEFAULT_SETTINGS } = require('../src/main/settings');
const { createPaths } = require('../src/main/paths');
const { createAccounts, createCrypt, loginError } = require('../src/main/accounts');
const { loadNews, BUILT_IN } = require('../src/main/news');
const { loadConfig } = require('../src/main/config');
const { readModsToml } = require('../src/main/jarmeta');
const { neoForgeMinecraft, pickLoaderVersion } = require('../src/main/versions');
const { tmpDir, mockFetch } = require('./helpers');

test('server status: a real Server List Ping exchange with a local fake server', async () => {
  const server = net.createServer((socket) => {
    let got = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      got = Buffer.concat([got, chunk]);
      if (got.includes(Buffer.from([0x01, 0x00]))) {
        const json = JSON.stringify({ version: { name: 'Paper 1.21.1', protocol: 767 }, players: { online: 42, max: 500, sample: [{ name: 'Gracz' }] }, description: { text: '§6HammerShop ', extra: [{ text: '– zapraszamy!' }] } });
        socket.write(packet(0x00, mcString(json)));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const status = await ping(`127.0.0.1:${server.address().port}`);
  server.close();
  assert.equal(status.online, true);
  assert.deepEqual([status.version, status.players.online, status.players.max, status.players.sample], ['Paper 1.21.1', 42, 500, ['Gracz']]);
  assert.equal(status.motd, 'HammerShop – zapraszamy!');
  const offline = await ping('127.0.0.1:1', { timeout: 1000 });
  assert.equal(offline.online, false);
  assert.equal(readVarInt(varInt(300)).value, 300);
  assert.equal(motdText('§aZielony §ltekst'), 'Zielony tekst');
});

test('instances: create (game in Polish), edit (new version = install again), duplicate, remove', () => {
  const instances = createInstances(createPaths(tmpDir()));
  assert.throws(() => instances.create({ name: 'Bez wersji' }), /Wybierz wersję/);
  const a = instances.create({ name: 'Moja Żółta Instancja', mcVersion: '1.21.1', loader: 'fabric', icon: 'diamond', memoryMb: 6000 });
  assert.equal(a.id, 'moja-zolta-instancja');
  assert.equal(fs.readFileSync(path.join(a.dir, 'options.txt'), 'utf8'), 'lang:pl_pl\n');
  assert.ok(fs.existsSync(path.join(a.dir, 'mods')) && fs.existsSync(path.join(a.dir, 'shaderpacks')));
  instances.patchInternal(a.id, { versionId: 'fabric-loader-x-1.21.1', installedFor: 'k' });
  const same = instances.update(a.id, { name: 'Nowa nazwa' });
  assert.equal(same.versionId, 'fabric-loader-x-1.21.1', 'renaming keeps the install');
  const moved = instances.update(a.id, { mcVersion: '1.20.4', loader: 'neoforge', icon: 'not-an-icon', evil: 1 });
  assert.deepEqual([moved.mcVersion, moved.loader, moved.versionId, moved.icon, moved.evil], ['1.20.4', 'neoforge', null, 'diamond', undefined]);
  const b = instances.create({ name: 'Moja Żółta Instancja', mcVersion: '1.21.1' });
  assert.notEqual(b.id, a.id);
  fs.writeFileSync(path.join(a.dir, 'mods', 'x.jar'), 'x');
  const copy = instances.duplicate(a.id);
  assert.ok(fs.existsSync(path.join(copy.dir, 'mods', 'x.jar')));
  assert.equal(copy.name, 'Nowa nazwa (kopia)');
  instances.remove(copy.id);
  assert.equal(instances.list().length, 2);
  assert.equal(slug('Łódź & Kraków!'), 'lodz-krakow');
  assert.equal(instances.get('../../etc'), null, 'ids never escape the folder');
});

test('settings keep only valid values and survive a restart', () => {
  const file = path.join(tmpDir(), 'settings.json');
  const s = createSettings(file);
  s.set({ memoryMb: 999999, jvmPreset: 'zgc', afterLaunch: 'teleport', resolution: { width: 100, height: 99999, fullscreen: 1 }, hacker: true });
  const again = createSettings(file).get();
  assert.deepEqual([again.memoryMb, again.jvmPreset, again.afterLaunch, again.resolution], [65536, 'zgc', 'hide', { width: 640, height: 4320, fullscreen: true }]);
  assert.equal(again.hacker, undefined);
  assert.equal(sanitize({ memoryMb: null }).memoryMb, null);
  assert.equal(DEFAULT_SETTINGS.jvmPreset, 'recommended');
});

class FakeAuth {
  constructor(prompt) {
    this.prompt = prompt;
    FakeAuth.made.push(prompt);
  }
  async launch() {
    if (FakeAuth.fail) throw FakeAuth.fail;
    return FakeAuth.xbox('refresh-1', 'mc-token-1');
  }
  async refresh(token) {
    FakeAuth.refreshed.push(token);
    if (FakeAuth.refreshFail) throw FakeAuth.refreshFail;
    return FakeAuth.xbox('refresh-2', 'mc-token-2');
  }
  static xbox(refresh, mcToken) {
    return { save: () => refresh, getMinecraft: async () => ({ mcToken, exp: Date.now() + 3600e3, xuid: '1', profile: FakeAuth.profile }) };
  }
}
FakeAuth.made = [];
FakeAuth.refreshed = [];
FakeAuth.profile = { id: 'uuid-1', name: 'Gracz', skins: [{ state: 'ACTIVE', url: 'https://textures.minecraft.net/texture/abc', variant: 'SLIM' }] };

test('accounts: login stores encrypted tokens, the game token is reused and refreshed, refusals in Polish', async () => {
  let key = null;
  const crypt = createCrypt({ keyFile: 'k', readKey: () => key, writeKey: (f, k) => (key = k) });
  const file = path.join(tmpDir(), 'accounts.json');
  const accounts = createAccounts({ file, crypt, config: { microsoft: { clientId: '' } }, AuthClass: FakeAuth });
  const acc = await accounts.login();
  assert.deepEqual([acc.id, acc.name, acc.skinUrl, acc.skinVariant], ['uuid-1', 'Gracz', 'https://textures.minecraft.net/texture/abc', 'SLIM']);
  const raw = fs.readFileSync(file, 'utf8');
  assert.ok(!raw.includes('refresh-1') && !raw.includes('mc-token-1'), 'no tokens in plain text');
  assert.deepEqual(await accounts.launchAuth('uuid-1'), { id: 'uuid-1', name: 'Gracz', accessToken: 'mc-token-1' });
  assert.deepEqual(FakeAuth.refreshed, []);
  const data = JSON.parse(raw);
  data.accounts[0].exp = Date.now() - 1;
  fs.writeFileSync(file, JSON.stringify(data));
  const reloaded = createAccounts({ file, crypt, AuthClass: FakeAuth });
  assert.equal((await reloaded.launchAuth('uuid-1')).accessToken, 'mc-token-2');
  assert.deepEqual(FakeAuth.refreshed, ['refresh-1']);
  FakeAuth.refreshFail = { ts: 'error.auth.xboxLive' };
  const d2 = JSON.parse(fs.readFileSync(file, 'utf8'));
  d2.accounts[0].exp = 0;
  fs.writeFileSync(file, JSON.stringify(d2));
  const expired = createAccounts({ file, crypt, AuthClass: FakeAuth });
  await assert.rejects(expired.launchAuth('uuid-1'), /wygasła – zaloguj się ponownie/);
  assert.equal(expired.list()[0].needsLogin, true);
  FakeAuth.refreshFail = null;
  FakeAuth.fail = 'error.gui.closed';
  await assert.rejects(accounts.login(), /Okno logowania zostało zamknięte/);
  FakeAuth.fail = null;
  FakeAuth.profile = { id: 'demo', demo: true };
  await assert.rejects(accounts.login(), /nie ma kupionego Minecraft/);
  assert.equal(loginError({ ts: 'error.auth.xsts.child' }).startsWith('To konto dziecka'), true);
  await assert.rejects(createAccounts({ file: path.join(tmpDir(), 'a.json'), crypt, AuthClass: FakeAuth }).launchAuth(null), /Zaloguj się kontem Microsoft/);
  assert.equal(FakeAuth.made[0], 'select_account', 'without an own Azure app: the standard login');
  createAccounts({ file, crypt, config: { microsoft: { clientId: 'my-app' } }, AuthClass: FakeAuth });
});

test('news: the config list (only https links) or the built-in tips; config defaults', async () => {
  assert.equal(await loadNews(''), BUILT_IN);
  const fetchFn = mockFetch([{ match: /news/, json: [{ title: 'Nowa paczka!', body: 'Opis', url: 'javascript:alert(1)', image: 'https://cdn.example/x.png' }] }]);
  const [item] = await loadNews('https://hammershop.pl/news.json', { fetchFn });
  assert.deepEqual([item.title, item.url, item.image], ['Nowa paczka!', null, 'https://cdn.example/x.png']);
  assert.equal(await loadNews('https://x', { fetchFn: async () => { throw new Error('offline'); } }), BUILT_IN);
  const cfg = loadConfig(path.join(tmpDir(), 'missing.json'));
  assert.equal(cfg.brand, 'HammerShop');
  assert.equal(cfg.defaultInstance.loader, 'fabric');
});

test('versions: NeoForge → Minecraft mapping and the default loader version', () => {
  assert.equal(neoForgeMinecraft('21.1.77'), '1.21.1');
  assert.equal(neoForgeMinecraft('21.0.10-beta'), '1.21');
  assert.equal(neoForgeMinecraft('26.1.0.5'), '26.1');
  assert.equal(pickLoaderVersion([{ version: 'b', stable: false }, { version: 'a', stable: true }]), 'a');
  assert.equal(pickLoaderVersion([{ version: 'x', stable: true }, { version: 'r', recommended: true }]), 'r');
  assert.equal(pickLoaderVersion([]), null);
  const toml = readModsToml("modLoader=\"javafml\"\n[[mods]]\nmodId=\"create\"\nversion=\"0.5.1\"\ndisplayName=\"Create\"\ndescription='''\nBuilding tools\n'''\n[[dependencies.create]]\nmodId=\"forge\"");
  assert.deepEqual([toml.modId, toml.version, toml.displayName], ['create', '0.5.1', 'Create']);
});
