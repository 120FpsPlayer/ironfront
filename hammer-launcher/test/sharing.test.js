'use strict';

/* The services behind the four "bring it over / pass it on" features: the official Minecraft's worlds and settings,
   instance recipes, invitations and featured servers – wired the way main.js uses them, with stand-ins for the network. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { createServices } = require('../src/main/services');
const recipe = require('../src/main/recipe');
const { writeNbt, tag } = require('../src/main/nbt');
const { tmpDir, fabricJar, mrVersion, sha1 } = require('./helpers');

const NOW = Date.UTC(2026, 10, 10, 12);
const levelDat = ({ name, version = '1.21.1' }) =>
  writeNbt(Object.assign(tag.compound({ Data: tag.compound({ LevelName: tag.string(name), GameType: tag.int(0), LastPlayed: tag.long(BigInt(NOW)), Version: tag.compound({ Name: tag.string(version) }) }) }), { name: '' }), { gzip: true });

/** A folder that stands for the official Minecraft: two worlds, a server list and the settings. */
function officialFolder() {
  const dir = tmpDir('official');
  const world = (folder, level, size) => {
    fs.mkdirSync(path.join(dir, 'saves', folder, 'region'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'saves', folder, 'level.dat'), levelDat(level));
    fs.writeFileSync(path.join(dir, 'saves', folder, 'region', 'r.0.0.mca'), Buffer.alloc(size, 3));
  };
  world('Stary świat', { name: 'Stary świat', version: '1.20.1' }, 3000);
  world('Nowy świat', { name: 'Nowy świat', version: '26.1' }, 5000);
  fs.writeFileSync(path.join(dir, 'options.txt'), 'lang:en_us\nmouseSensitivity:0.3\nkey_key.sprint:key.keyboard.r\n');
  const root = Object.assign(tag.compound({ servers: tag.list('compound', [tag.compound({ name: tag.string('Hypixel'), ip: tag.string('mc.hypixel.net') })]) }), { name: '' });
  fs.writeFileSync(path.join(dir, 'servers.dat'), writeNbt(root));
  return dir;
}

const sodiumJar = fabricJar({ id: 'sodium', name: 'Sodium', version: '0.6.5' });
const SODIUM = mrVersion({ id: 'mc121S0d', projectId: 'AANobbMI', number: '0.6.5', file: { name: 'sodium-fabric-0.6.5.jar', body: sodiumJar } });
const PROJECTS = {
  AANobbMI: { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', project_type: 'mod' },
  '1KVo5zza': { id: '1KVo5zza', slug: 'fabulously-optimized', title: 'Fabulously Optimized', project_type: 'modpack', icon_url: 'https://cdn.modrinth.com/data/1KVo5zza/icon.png' },
};
/** A tiny .mrpack: Fabric 1.21.4 with one config file. */
const mrpack = (() => {
  const zip = new AdmZip();
  zip.addFile('modrinth.index.json', Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '6.4.0', name: 'Fabulously Optimized', files: [], dependencies: { minecraft: '1.21.4', 'fabric-loader': '0.16.10' } })));
  zip.addFile('overrides/config/fo.txt', Buffer.from('fo'));
  return zip.toBuffer();
})();
const PACK_VERSION = { ...mrVersion({ id: 'foV64000', projectId: '1KVo5zza', number: '6.4.0', mc: ['1.21.3', '1.21.4'], loaders: ['fabric'], file: { name: 'Fabulously.Optimized-6.4.0.mrpack', body: mrpack } }) };

const FEATURED = [
  { id: 'hammer-smp', name: 'Hammer SMP', address: 'mc.hammershop.pl', description: 'Survival bez wipe’ów.', tags: ['survival'], icon: 'https://hammershop.pl/smp.png', mc: '1.21.1', loader: 'fabric', pack: null },
  { id: 'paczka', name: 'Serwer z paczką', address: 'fo.example.pl', description: '', tags: [], icon: null, mc: '1.21.4', loader: 'fabric', pack: 'fabulously-optimized' },
];

function setup(extra = {}) {
  const events = [];
  const calls = [];
  const state = { shopDown: false, saveTo: null, pick: null };
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
    const ids = () => JSON.parse(new URL(u).searchParams.get('ids'));
    if (u.startsWith('https://hammershop.pl/api/launcher/featured')) return state.shopDown ? new Response('Bad gateway', { status: 502 }) : json({ servers: FEATURED });
    if (/api\.modrinth\.com\/v2\/versions\?/.test(u)) return json(ids().map((id) => ({ mc121S0d: SODIUM })[id]).filter(Boolean));
    if (/api\.modrinth\.com\/v2\/projects\?/.test(u)) return json(ids().map((id) => PROJECTS[id]).filter(Boolean));
    if (/api\.modrinth\.com\/v2\/search/.test(u)) return json({ hits: [{ project_id: '1KVo5zza', author: 'robotkoer' }] });
    if (/api\.modrinth\.com\/v2\/version_files$/.test(u)) return json({});
    if (/api\.modrinth\.com\/v2\/project\/[^/]+\/version/.test(u)) {
      const q = new URL(u).searchParams;
      const games = q.get('game_versions') ? JSON.parse(q.get('game_versions')) : null;
      const loaders = q.get('loaders') ? JSON.parse(q.get('loaders')) : null;
      const fits = /1KVo5zza|fabulously-optimized/.test(u) && (!games || games.some((g) => PACK_VERSION.game_versions.includes(g))) && (!loaders || loaders.some((l) => PACK_VERSION.loaders.includes(l)));
      return json(fits ? [PACK_VERSION] : []);
    }
    if (/api\.modrinth\.com\/v2\/project\/[^/?]+$/.test(u)) {
      const key = decodeURIComponent(u.split('/project/')[1]);
      const project = PROJECTS[key] ?? Object.values(PROJECTS).find((p) => p.slug === key);
      return project ? json(project) : json({}, 404);
    }
    if (/api\.modrinth\.com\/v2\/version\/foV64000$/.test(u)) return json(PACK_VERSION);
    if (u.endsWith('/sodium-fabric-0.6.5.jar')) return new Response(sodiumJar, { status: 200 });
    if (u.endsWith('.mrpack')) return new Response(mrpack, { status: 200 });
    return new Response('nope', { status: 404 });
  };
  const versionsApi = {
    minecraftVersions: async ({ snapshots = false } = {}) => [['26.1', 'release'], ['25w41a', 'snapshot'], ['1.21.4', 'release'], ['1.21.1', 'release'], ['1.20.1', 'release']].filter(([, type]) => snapshots || type === 'release').map(([id, type]) => ({ id, type })),
    loaderVersions: async (loader, mc) => (loader === 'fabric' && mc !== '26.1' ? [{ version: '0.16.10', stable: true }] : loader === 'forge' && mc === '1.20.1' ? [{ version: '47.3.0', stable: true }] : []),
  };
  const services = createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', website: 'https://hammershop.pl', server: { address: '' } },
    accounts: { launchAuth: async () => Promise.reject(new Error('Zaloguj się kontem Microsoft.')) },
    emit: (channel, payload) => events.push({ channel, ...payload }),
    fetchFn,
    versionsApi,
    officialDir: officialFolder(),
    saveFile: async (opts) => ((state.saveAsked = opts), state.saveTo),
    pickFile: async (opts) => ((state.pickAsked = opts), state.pick),
    ...extra,
  });
  const instance = services.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  const running = (on = true) => (on ? services.games.running.set(instance.id, { process: { kill() {} }, startedAt: Date.now(), logs: [] }) : services.games.running.delete(instance.id));
  return { services, instance, events, calls, state, running };
}

/* ── the official Minecraft ── */

test('services: what the official Minecraft has to bring over', () => {
  const { services } = setup();
  assert.deepEqual(services.official.info(), { available: true, servers: true, worlds: true, options: true });
  assert.deepEqual(setup({ officialDir: null }).services.official.info(), { available: false, servers: false, worlds: false, options: false });
  assert.deepEqual(setup({ officialDir: path.join(tmpDir(), 'nie-ma') }).services.official.info(), { available: false, servers: false, worlds: false, options: false });
  assert.deepEqual(setup({ officialDir: tmpDir() }).services.official.info(), { available: true, servers: false, worlds: false, options: false });
});

test('services: worlds of the official Minecraft – listed with a warning for a newer game, copied with progress', async () => {
  const { services, instance, events } = setup();
  const list = await services.official.worlds(instance.id);
  assert.deepEqual(list.map((w) => [w.folder, w.version, w.newer]).sort(), [['Nowy świat', '26.1', true], ['Stary świat', '1.20.1', false]], 'the instance runs 1.21.1: a world from 26.1 may not load');
  await assert.rejects(services.official.worlds('nie-ma'), /Nie ma takiej instancji/);
  const res = await services.official.importWorlds(instance.id, ['Nowy świat', 'Stary świat', 'Nie ma takiego']);
  assert.deepEqual(res.copied.map((c) => [c.source, c.folder]), [['Nowy świat', 'Nowy świat'], ['Stary świat', 'Stary świat']], 'a newer world is copied all the same – the warning does not block');
  assert.deepEqual(res.failed.map((f) => f.folder), ['Nie ma takiego']);
  assert.match(res.failed[0].error, /Nie ma już takiego świata w Twoim Minecrafcie/);
  assert.deepEqual((await services.worlds.list(instance.id)).map((w) => w.folder).sort(), ['Nowy świat', 'Stary świat']);
  const progress = events.filter((e) => e.channel === 'task:progress');
  assert.deepEqual(progress.map((e) => e.scope), progress.map(() => 'official-worlds'));
  assert.deepEqual(progress.at(-1), { channel: 'task:progress', scope: 'official-worlds', label: 'Kopiowanie świata: Stary świat (2/3)', done: 1, total: 1 });
  assert.ok(progress.some((e) => e.label === 'Kopiowanie świata: Nowy świat (1/3)'));
  // A second time: numbered folders, nothing overwritten.
  assert.deepEqual((await services.official.importWorlds(instance.id, ['Stary świat'])).copied.map((c) => c.folder), ['Stary świat (2)']);
  assert.equal(services.games.isRunning(instance.id), false);
});

test('services: nothing is brought over under a running game – worlds or settings', async () => {
  const { services, instance, running } = setup();
  const before = fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8');
  running();
  await assert.rejects(services.official.importWorlds(instance.id, ['Stary świat']), /Najpierw zamknij grę – świat skopiowany w trakcie gry mógłby się nie wczytać\./);
  await assert.rejects(services.official.importOptions(instance.id), /Najpierw zamknij grę – przy zamykaniu gra zapisałaby z powrotem swoje ustawienia\./);
  assert.equal(fs.existsSync(path.join(instance.dir, 'saves')), false);
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(instance.dir, 'options.txt.przed-importem')), false);
  // The list itself can still be looked at.
  assert.equal((await services.official.worlds(instance.id)).length, 2);
  running(false);
  // While worlds are being copied the game of that instance cannot be started (and a second copy waits its turn).
  const copying = services.official.importWorlds(instance.id, ['Stary świat']);
  await assert.rejects(services.launch(instance.id), /Poczekaj, aż launcher skończy kopię zapasową świata/);
  await assert.rejects(services.official.importWorlds(instance.id, ['Nowy świat']), /Poczekaj, aż skończy się kopia zapasowa albo przywracanie świata/);
  assert.equal((await copying).copied.length, 1);
  // Afterwards everything works again.
  assert.deepEqual(await services.official.importOptions(instance.id), { backup: 'options.txt.przed-importem', lines: 4 });
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'), 'lang:en_us\nmouseSensitivity:0.3\nkey_key.sprint:key.keyboard.r\nonboardAccessibility:false\n');
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt.przed-importem'), 'utf8'), before);
  await assert.rejects(setup({ officialDir: null }).services.official.importOptions(instance.id), /Nie ma takiej instancji|Nie znalazłem ustawień/);
});

/* ── recipes ── */

test('services: an instance goes out as a code and a file, and comes back as a new instance', async () => {
  const { services, instance, events, state } = setup();
  await services.content.installVersion(instance, 'mod', SODIUM, PROJECTS.AANobbMI);
  fs.writeFileSync(path.join(instance.dir, 'mods', 'tajny-mod.jar'), fabricJar({ id: 'tajny', name: 'Tajny mod', version: '1' }));
  services.servers.add(instance.id, { name: 'HammerShop', address: 'mc.hammershop.pl' });

  const exp = await services.share.export(instance.id, { options: true });
  assert.deepEqual(exp.summary, { name: 'Hammer', mc: '1.21.1', loader: 'fabric', loaderVersion: null, hammerClient: true, mods: 1, resourcepacks: 0, shaders: 0, servers: 1, options: true });
  assert.deepEqual(exp.excluded, [{ type: 'mod', file: 'tajny-mod.jar', title: 'Tajny mod' }]);
  assert.match(exp.code, /^HL1\./);
  assert.deepEqual([exp.maxCode, exp.fileName, exp.hasOptions, exp.optionsLeftOut], [6000, 'Hammer.hammerpack', true, false]);
  assert.equal((await services.share.export(instance.id)).summary.options, false);

  // The file: the system's "save as" dialog decides where; closing it saves nothing.
  assert.equal(await services.share.save(instance.id, { options: true }), null);
  assert.equal(state.saveAsked.defaultName, 'Hammer.hammerpack');
  const dir = tmpDir();
  state.saveTo = path.join(dir, 'moja-instancja'); // the player typed a name without the extension
  assert.deepEqual(await services.share.save(instance.id, { options: true }), { file: 'moja-instancja.hammerpack' });
  const saved = fs.readFileSync(path.join(dir, 'moja-instancja.hammerpack'), 'utf8');
  assert.deepEqual(recipe.parseJson(saved), recipe.decode(exp.code));
  assert.ok(saved.includes('\n  "content": ['), 'pretty JSON');
  state.saveTo = path.join(dir, 'nie-ma-folderu', 'x.hammerpack');
  await assert.rejects(services.share.save(instance.id), /Nie udało się zapisać pliku/);

  // Coming back: first only a preview – nothing is created until the player agrees.
  const preview = await services.share.readCode(` ${exp.code}\n`);
  assert.deepEqual(preview.summary, { ...exp.summary, loaderVersion: null });
  assert.deepEqual(preview.notes, []);
  assert.equal(services.instances.list().length, 1);
  events.length = 0;
  const res = await services.share.install(preview.token);
  assert.equal(res.instance.name, 'Hammer (2)');
  assert.deepEqual([res.installed, res.missing], [1, []]);
  assert.equal(sha1(fs.readFileSync(path.join(res.instance.dir, 'mods', 'sodium-fabric-0.6.5.jar'))), sha1(sodiumJar));
  assert.deepEqual(services.servers.list(res.instance.id).map((s) => s.address), ['mc.hammershop.pl', 'mc.hypixel.net'], 'the recipe\'s server, and – as in every new instance – those of the official Minecraft');
  assert.equal(fs.readFileSync(path.join(res.instance.dir, 'options.txt'), 'utf8'), fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'));
  assert.equal(services.settings.get().selectedInstance, res.instance.id);
  const progress = events.filter((e) => e.channel === 'task:progress');
  assert.deepEqual(progress.map((e) => e.scope), progress.map(() => 'recipe'));
  assert.deepEqual(progress.at(-1), { channel: 'task:progress', scope: 'recipe', label: 'Pobieranie dodatków (1/1)', done: 1, total: 1 }, 'the bar in the sidebar always ends');
  // A preview is good for one instance.
  await assert.rejects(services.share.install(preview.token), /nie jest już wczytany/);
  await assert.rejects(services.share.install('nie-ma'), /nie jest już wczytany/);

  // From the file: picked in the dialog, or dropped on the window (a path).
  state.pick = null;
  assert.equal(await services.share.pick(), null);
  assert.deepEqual(state.pickAsked.filters, [{ name: 'Przepis instancji Hammer Launchera', extensions: ['hammerpack'] }]);
  state.pick = path.join(dir, 'moja-instancja.hammerpack');
  assert.deepEqual((await services.share.pick()).summary, preview.summary);
  assert.deepEqual((await services.share.readFile(state.pick)).summary, preview.summary);
  await assert.rejects(services.share.readFile(path.join(dir, 'moja-instancja.zip')), /To nie jest plik \.hammerpack/);
  await assert.rejects(services.share.readFile(''), /To nie jest plik \.hammerpack/);
  await assert.rejects(services.share.readCode('HL1.@@'), /uszkodzony albo niepełny/);
  await assert.rejects(services.share.readCode('cokolwiek'), /Kod zaczyna się od „HL1\.”/);
  await assert.rejects(services.share.export('nie-ma'), /Nie ma takiej instancji/);
});

test('services: a recipe without content still closes its progress bar, and a bad one never becomes an instance', async () => {
  const { services, events } = setup();
  const empty = recipe.encode({ format: 'hammerpack', v: 1, name: 'Pusta', mc: '1.20.1', loader: 'forge', loaderVersion: '47.3.0', hammerClient: false, content: [], servers: [] });
  const preview = await services.share.readCode(empty.code);
  assert.equal(preview.summary.loaderVersion, '47.3.0');
  events.length = 0;
  const res = await services.share.install(preview.token);
  assert.deepEqual([res.instance.name, res.instance.loader, res.instance.loaderVersion, res.installed], ['Pusta', 'forge', '47.3.0', 0]);
  assert.deepEqual(events.filter((e) => e.channel === 'task:progress').at(-1), { channel: 'task:progress', scope: 'recipe', label: 'Sprawdzanie dodatków na Modrinth', done: 1, total: 1 });
  // A game version that does not exist is refused at the preview.
  const fake = recipe.encode({ format: 'hammerpack', v: 1, name: 'Zmyślona', mc: '9.99', loader: 'vanilla', content: [], servers: [] });
  await assert.rejects(services.share.readCode(fake.code), /Minecrafta 9\.99, a takiej wersji gry nie ma/);
  assert.deepEqual(services.instances.list().map((i) => i.name).sort(), ['Hammer', 'Pusta']);
});

/* ── invitations ── */

test('services: an invitation – read, shown, and only then acted on', async () => {
  const { services, instance } = setup();
  const other = services.instances.create({ name: 'Forge', mcVersion: '1.20.1', loader: 'forge' });
  const info = await services.invite.read('hammer://join?server=mc.hammershop.pl&name=Hammer%20SMP&mc=1.21.1&loader=fabric&icon=https%3A%2F%2Fhammershop.pl%2Fi.png');
  assert.deepEqual(info.invite, { server: 'mc.hammershop.pl', name: 'Hammer SMP', mc: '1.21.1', loader: 'fabric', pack: null, icon: 'https://hammershop.pl/i.png' });
  assert.deepEqual(info.fits, [{ id: instance.id, name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric', icon: 'grass', modpack: null, hasPack: false, hasServer: false }], 'the same game version and loader');
  assert.deepEqual(info.create, { mc: '1.21.1', loader: 'fabric', name: 'Hammer SMP' });
  assert.equal(info.pack, null);
  assert.deepEqual(services.servers.list(instance.id).map((s) => s.address), ['mc.hypixel.net'], 'reading a link changes nothing');
  assert.equal(services.instances.list().length, 2);

  // An instance that does not fit cannot be picked.
  await assert.rejects(services.invite.accept(info.token, { instanceId: other.id }), /nie pasuje do zaproszenia/);
  await assert.rejects(services.invite.accept(info.token, { instanceId: 'nie-ma' }), /Nie ma takiej instancji/);
  // The fitting one: the server goes onto its list – once.
  const res = await services.invite.accept(info.token, { instanceId: instance.id });
  assert.deepEqual([res.instance.id, res.server, res.name, res.added, res.created], [instance.id, 'mc.hammershop.pl', 'Hammer SMP', true, false]);
  assert.deepEqual(services.servers.list(instance.id).map((s) => [s.name, s.address]), [['Hypixel', 'mc.hypixel.net'], ['Hammer SMP', 'mc.hammershop.pl']]);
  await assert.rejects(services.invite.accept(info.token, { instanceId: instance.id }), /nie jest już otwarte/, 'an invitation is used once');
  const again = await services.invite.read('https://hammershop.pl/join?server=MC.HammerShop.pl&mc=1.21.1');
  assert.equal(again.fits[0].hasServer, true);
  const second = await services.invite.accept(again.token, { instanceId: instance.id });
  assert.equal(second.added, false);
  assert.equal(services.servers.list(instance.id).length, 2, 'not added twice');

  // „Utwórz nową instancję”: made with what the link asks for.
  const fresh = await services.invite.read('hammer://join?server=forge.example.pl:25570&mc=1.20.1&loader=forge');
  assert.deepEqual(fresh.fits.map((f) => f.id), [other.id]);
  assert.deepEqual(fresh.create, { mc: '1.20.1', loader: 'forge', name: 'forge.example.pl:25570' });
  const made = await services.invite.accept(fresh.token);
  assert.deepEqual([made.instance.name, made.instance.mcVersion, made.instance.loader, made.created, made.added], ['forge.example.pl:25570', '1.20.1', 'forge', true, true]);
  assert.ok(services.servers.list(made.instance.id).some((s) => s.address === 'forge.example.pl:25570'));
  assert.equal(services.settings.get().selectedInstance, made.instance.id);
});

test('services: an invitation that leaves the game open – any instance fits, a new one is made like the first instance', async () => {
  const { services, instance } = setup({ clientDir: null });
  const forge = services.instances.create({ name: 'Forge', mcVersion: '1.20.1', loader: 'forge' });
  const any = await services.invite.read('hammer://join?server=a.example.pl');
  assert.deepEqual(any.fits.map((f) => f.id).sort(), [forge.id, instance.id].sort());
  assert.deepEqual(any.create, { mc: '1.21.4', loader: 'fabric', name: 'a.example.pl' }, 'Fabric on the newest release that has it (26.1 does not yet)');
  // Only the version given: the loader is Fabric where it exists, else Vanilla.
  assert.deepEqual((await services.invite.read('hammer://join?server=a.example.pl&mc=1.20.1')).create, { mc: '1.20.1', loader: 'fabric', name: 'a.example.pl' });
  assert.deepEqual((await services.invite.read('hammer://join?server=a.example.pl&mc=26.1')).create, { mc: '26.1', loader: 'vanilla', name: 'a.example.pl' });
  assert.deepEqual((await services.invite.read('hammer://join?server=a.example.pl&mc=26.1')).fits, []);
  // Only the loader given.
  assert.deepEqual((await services.invite.read('hammer://join?server=a.example.pl&loader=vanilla')).create, { mc: '26.1', loader: 'vanilla', name: 'a.example.pl' });
  assert.deepEqual((await services.invite.read('hammer://join?server=a.example.pl&loader=forge')).fits.map((f) => f.id), [forge.id]);
});

test('services: an invitation is checked against the real lists – and refused calmly', async () => {
  const { services } = setup();
  const refused = (link, pattern) => assert.rejects(services.invite.read(link), (err) => err.name === 'InviteError' && pattern.test(err.message));
  await refused('hammer://join?server=a.example.pl&mc=9.99', /prosi o Minecrafta 9\.99, a takiej wersji gry nie ma/);
  await refused('hammer://join?server=a.example.pl&mc=1.21.1&loader=quilt', /Quilt nie ma wersji dla Minecrafta 1\.21\.1/);
  await refused('hammer://join?server=a.example.pl&mc=26.1&loader=fabric', /Fabric nie ma wersji dla Minecrafta 26\.1/);
  await refused('hammer://join?server=a.example.pl&pack=nie-ma-takiej', /Paczki modów z tego zaproszenia nie ma na Modrinth/);
  await refused('hammer://join?server=a.example.pl&pack=sodium', /Paczki modów z tego zaproszenia nie ma na Modrinth/, 'a mod is not a modpack');
  await refused('hammer://join?server=a.example.pl&pack=fabulously-optimized&mc=1.20.1', /Paczka „Fabulously Optimized” nie ma wersji dla Minecrafta 1\.20\.1/);
  await refused('hammer://join?server=a.example.pl&pack=fabulously-optimized&loader=forge', /nie ma wersji \(Forge\)/);
  await refused('hammer://play?server=a.example.pl', /To nie wygląda na zaproszenie/);
  await refused('', /Wklej link z zaproszeniem/);
  await refused(null, /Wklej link z zaproszeniem/);
  await refused({ featured: 'nie-ma' }, /nie ma już na liście polecanych/);
  await refused({ nope: true }, /nie ma już na liście polecanych/);
  // A snapshot is a real version too.
  assert.equal((await services.invite.read('hammer://join?server=a.example.pl&mc=25w41a')).invite.mc, '25w41a');
  // Without the version lists (no internet) nothing is guessed.
  const offline = setup({ versionsApi: { minecraftVersions: async () => Promise.reject(new Error('ENOTFOUND')), loaderVersions: async () => [] } });
  await assert.rejects(offline.services.invite.read('hammer://join?server=a.example.pl&mc=1.21.1'), /Nie udało się sprawdzić wersji gry z zaproszenia – sprawdź internet/);
  await assert.rejects(offline.services.invite.read('hammer://join?server=a.example.pl'), /Nie udało się sprawdzić wersji gry – sprawdź internet/);
});

test('services: an invitation with a modpack – name and author shown first, then the usual modpack install', async () => {
  const { services, instance, events, calls } = setup();
  const info = await services.invite.read('hammer://join?server=fo.example.pl&name=Serwer%20z%20paczk%C4%85&mc=1.21.4&loader=fabric&pack=fabulously-optimized');
  assert.deepEqual(info.pack, { title: 'Fabulously Optimized', author: 'robotkoer', iconUrl: 'https://cdn.modrinth.com/data/1KVo5zza/icon.png', version: '6.4.0', mc: '1.21.4', loader: 'fabric' });
  assert.deepEqual(info.create, { mc: '1.21.4', loader: 'fabric', name: 'Fabulously Optimized' });
  assert.deepEqual(info.fits, [], 'the 1.21.1 instance does not fit');
  assert.equal(calls.some((u) => u.endsWith('.mrpack')), false, 'nothing is downloaded before the player agrees');
  assert.equal(services.instances.list().length, 1);
  events.length = 0;
  const res = await services.invite.accept(info.token);
  assert.deepEqual([res.instance.name, res.instance.mcVersion, res.instance.loader, res.instance.loaderVersion, res.created, res.added], ['Fabulously Optimized', '1.21.4', 'fabric', '0.16.10', true, true]);
  assert.deepEqual(res.instance.modpack, { projectId: '1KVo5zza', versionId: 'foV64000', name: 'Fabulously Optimized', version: '6.4.0', iconUrl: 'https://cdn.modrinth.com/data/1KVo5zza/icon.png' });
  assert.equal(fs.readFileSync(path.join(res.instance.dir, 'config', 'fo.txt'), 'utf8'), 'fo');
  assert.ok(services.servers.list(res.instance.id).some((s) => s.address === 'fo.example.pl' && s.name === 'Serwer z paczką'));
  const progress = events.filter((e) => e.channel === 'task:progress');
  assert.ok(progress.length >= 2);
  assert.deepEqual([progress.at(-1).scope, progress.at(-1).done, progress.at(-1).total], ['modpack', 1, 1]);
  // Next time the instance with that pack is the first to fit; the link may leave version and loader to the pack.
  const next = await services.invite.read('hammer://join?server=fo.example.pl&pack=1KVo5zza');
  assert.deepEqual(next.fits.map((f) => [f.name, f.hasPack, f.hasServer]), [['Fabulously Optimized', true, true]]);
  assert.deepEqual([next.pack.mc, next.pack.loader], ['1.21.4', 'fabric']);
  assert.equal(instance.mcVersion, '1.21.1');
});

test('services: „Zaproś” – a link for a server of the instance, through the shop page when there is a website', () => {
  const { services, instance } = setup();
  services.servers.add(instance.id, { name: 'Survival §aznajomych', address: '83.12.45.201:25570' });
  services.servers.add(instance.id, { address: 'bez-nazwy.example.pl' });
  const made = services.invite.link(instance.id, '83.12.45.201:25570');
  assert.deepEqual(made, { link: 'https://hammershop.pl/join?server=83.12.45.201%3A25570&name=Survival+znajomych&mc=1.21.1&loader=fabric', web: true, server: { name: 'Survival znajomych', address: '83.12.45.201:25570' }, mc: '1.21.1', loader: 'fabric', pack: null });
  assert.equal(services.invite.link(instance.id, 'bez-nazwy.example.pl').link, 'https://hammershop.pl/join?server=bez-nazwy.example.pl&mc=1.21.1&loader=fabric', 'a server without a name of its own needs none in the link');
  assert.throws(() => services.invite.link(instance.id, 'nie-ma.example.pl'), /Nie ma już takiego serwera/);
  assert.throws(() => services.invite.link('nie-ma', '83.12.45.201:25570'), /Nie ma takiej instancji/);
  // No website configured: the launcher's own scheme.
  const plain = setup({ config: { brand: 'HammerShop', website: '', server: { address: '' } } });
  plain.services.servers.add(plain.instance.id, { name: 'Mój', address: 'a.example.pl' });
  assert.deepEqual([plain.services.invite.link(plain.instance.id, 'a.example.pl').link, plain.services.invite.link(plain.instance.id, 'a.example.pl').web], ['hammer://join?server=a.example.pl&name=M%C3%B3j&mc=1.21.1&loader=fabric', false]);
  // An instance made from a Modrinth pack: the pack travels along – unless the player leaves it out.
  const pack = services.instances.create({ name: 'FO', mcVersion: '1.21.4', loader: 'fabric', modpack: { projectId: '1KVo5zza', versionId: 'foV64000', name: 'Fabulously Optimized', version: '6.4.0' } });
  services.servers.add(pack.id, { name: 'Z paczką', address: 'fo.example.pl' });
  const withPack = services.invite.link(pack.id, 'fo.example.pl');
  assert.equal(withPack.link, 'https://hammershop.pl/join?server=fo.example.pl&name=Z+paczk%C4%85&mc=1.21.4&loader=fabric&pack=1KVo5zza');
  assert.deepEqual(withPack.pack, { name: 'Fabulously Optimized', included: true });
  const without = services.invite.link(pack.id, 'fo.example.pl', { pack: false });
  assert.equal(without.link.includes('pack='), false);
  assert.deepEqual(without.pack, { name: 'Fabulously Optimized', included: false });
});

/* ── featured servers ── */

test('services: featured servers – the list, „Graj” through the invitation flow, and silence when the shop is away', async () => {
  const { services, instance, state, calls } = setup();
  const list = await services.featured.list();
  assert.deepEqual(list.map((s) => [s.id, s.name, s.address]), [['hammer-smp', 'Hammer SMP', 'mc.hammershop.pl'], ['paczka', 'Serwer z paczką', 'fo.example.pl']]);
  await services.featured.list();
  assert.equal(calls.filter((u) => u.includes('/api/launcher/featured')).length, 1, 'kept for 5 minutes');
  // „Graj” on a featured server is an invitation made from its entry.
  const info = await services.invite.read({ featured: 'hammer-smp' });
  assert.deepEqual(info.invite, { server: 'mc.hammershop.pl', name: 'Hammer SMP', mc: '1.21.1', loader: 'fabric', pack: null, icon: 'https://hammershop.pl/smp.png' });
  assert.deepEqual(info.fits.map((f) => f.id), [instance.id]);
  assert.equal((await services.invite.accept(info.token, { instanceId: instance.id })).added, true);
  assert.equal((await services.invite.read({ featured: 'paczka' })).pack.title, 'Fabulously Optimized');
  // The shop is not there: an empty list, no error anywhere.
  const away = setup();
  away.state.shopDown = true;
  assert.deepEqual(await away.services.featured.list(), []);
  const none = setup({ config: { brand: 'HammerShop', website: '', server: { address: '' } } });
  assert.deepEqual(await none.services.featured.list(), []);
  assert.equal(none.calls.length, 0);
  assert.equal(state.shopDown, false);
});
