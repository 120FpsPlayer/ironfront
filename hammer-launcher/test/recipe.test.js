'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const recipe = require('../src/main/recipe');
const servers = require('../src/main/servers');
const { createModrinth } = require('../src/main/modrinth');
const { createContent } = require('../src/main/content');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { tmpDir, fabricJar, mrVersion, sha1 } = require('./helpers');

const { RecipeError } = recipe;

/** A recipe like the launcher writes it. */
const sample = (more = {}) => ({
  format: 'hammerpack',
  v: 1,
  name: 'Survival z ekipą',
  mc: '1.21.1',
  loader: 'fabric',
  loaderVersion: '0.16.10',
  hammerClient: true,
  content: [
    { type: 'mod', project: 'AANobbMI', version: 'mc121S0d', file: 'sodium-fabric-0.6.5+mc1.21.1.jar' },
    { type: 'mod', project: 'P7dR8mSH', version: 'fApi0110', file: 'fabric-api-0.110.0+1.21.1.jar', off: true },
    { type: 'resourcepack', project: 'RpFaith32', version: 'faith32x', file: 'Faithful 32x - 1.21.zip' },
    { type: 'shader', project: 'HVnmMxH1', version: 'compRe51', file: 'ComplementaryReimagined_r5.1.zip' },
  ],
  servers: [
    { name: 'HammerShop', address: 'mc.hammershop.pl' },
    { name: 'U Kuby', address: '83.12.45.201:25570' },
  ],
  ...more,
});
/** A code made by hand from any JSON-able value – also from things the launcher would never write. */
const codeOf = (value) => `HL1.${zlib.deflateRawSync(Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))).toString('base64url')}`;
const rejects = (fn, pattern) => assert.throws(fn, (err) => err instanceof RecipeError && pattern.test(err.message), `expected a RecipeError matching ${pattern}`);

test('recipe: round trip – file and code give back exactly what went in', () => {
  const original = sample({ options: 'lang:pl_pl\nfov:0.5\nkey_key.sprint:key.keyboard.r\n' });
  const { json, code, codeLength } = recipe.encode(original);
  assert.deepEqual(JSON.parse(json), original);
  assert.ok(json.includes('\n  "name": "Survival z ekipą"'), 'the file is pretty JSON');
  assert.match(code, /^HL1\.[A-Za-z0-9_-]+$/);
  assert.equal(code.length, codeLength);
  assert.ok(code.length <= recipe.MAX_CODE);
  assert.deepEqual(recipe.decode(code), original);
  assert.deepEqual(recipe.parseJson(json), original);
  // The way codes arrive from Discord: quoted, in backticks, broken into lines.
  assert.deepEqual(recipe.decode(`  \`${code.slice(0, 40)}\n${code.slice(40, 90)} ${code.slice(90)}\`  `), original);
  assert.deepEqual(recipe.decode(`„${code}”`), original);
  // A file with a byte order mark (saved by Notepad) still reads.
  assert.deepEqual(recipe.parseJson(`\uFEFF${json}`), original);
  // The summary for the preview holds numbers, never the content.
  assert.deepEqual(recipe.summary(recipe.decode(code)), { name: 'Survival z ekipą', mc: '1.21.1', loader: 'fabric', loaderVersion: '0.16.10', hammerClient: true, mods: 2, resourcepacks: 1, shaders: 1, servers: 2, options: true });
});

test('recipe: a file on disk – only a .hammerpack of at most 2 MB', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'Survival z ekipą.hammerpack');
  fs.writeFileSync(file, recipe.encode(sample()).json);
  assert.deepEqual(recipe.readFile(file), sample());
  fs.copyFileSync(file, path.join(dir, 'WIELKIE.HAMMERPACK'));
  assert.deepEqual(recipe.readFile(path.join(dir, 'WIELKIE.HAMMERPACK')), sample());
  fs.copyFileSync(file, path.join(dir, 'przepis.json'));
  rejects(() => recipe.readFile(path.join(dir, 'przepis.json')), /To nie jest plik \.hammerpack/);
  rejects(() => recipe.readFile(path.join(dir, 'nie-ma.hammerpack')), /Nie udało się otworzyć/);
  rejects(() => recipe.readFile(null), /To nie jest plik \.hammerpack/);
  fs.mkdirSync(path.join(dir, 'folder.hammerpack'));
  rejects(() => recipe.readFile(path.join(dir, 'folder.hammerpack')), /Nie udało się otworzyć/);
  fs.writeFileSync(path.join(dir, 'duzy.hammerpack'), Buffer.alloc(recipe.MAX_SIZE + 1, 0x20));
  rejects(() => recipe.readFile(path.join(dir, 'duzy.hammerpack')), /za duży/);
  fs.writeFileSync(path.join(dir, 'smieci.hammerpack'), 'PK\u0003\u0004 not json');
  rejects(() => recipe.readFile(path.join(dir, 'smieci.hammerpack')), /To nie jest przepis instancji/);
  assert.equal(recipe.fileName('Survival: z "ekipą"?'), 'Survival_ z _ekipą__.hammerpack');
  assert.equal(recipe.fileName('...'), 'instancja.hammerpack');
});

test('recipe: every rule of the schema', () => {
  const ok = (more) => recipe.validate(sample(more));
  const no = (more, pattern) => rejects(() => recipe.validate(sample(more)), pattern);
  const item = (more) => ({ content: [{ type: 'mod', project: 'AANobbMI', version: 'mc121S0d', file: 'sodium.jar', ...more }] });

  // what it is
  for (const value of [null, undefined, 7, 'tekst', [], [sample()]]) rejects(() => recipe.validate(value), /To nie jest przepis instancji/);
  no({ format: 'mrpack' }, /To nie jest przepis instancji/);
  no({ format: undefined }, /To nie jest przepis instancji/);
  no({ v: 2 }, /z nowszej wersji Hammer Launchera/);
  no({ v: 0 }, /To nie jest przepis instancji/);
  no({ v: '1' }, /To nie jest przepis instancji/);

  // the name
  no({ name: undefined }, /nie ma nazwy/);
  no({ name: 7 }, /nie ma nazwy/);
  no({ name: '   \n ' }, /nie ma nazwy/);
  no({ name: 'x'.repeat(49) }, /za długa \(najwyżej 48 znaków\)/);
  assert.equal(ok({ name: 'x'.repeat(48) }).name.length, 48);
  assert.equal(ok({ name: '  Moja\u202e\u0000 instancja\n' }).name, 'Moja instancja', 'control and text-direction characters never get through');

  // the game version and the loader
  for (const mc of [undefined, 7, '', ' 1.21', '../1.21', '1.21/../../x', 'x'.repeat(41), '1.21\n', '<1.21>']) no({ mc }, /nieprawidłową wersję Minecrafta/);
  for (const mc of ['1.21.1', '26.1', '24w14a', '1.21.2-pre1', '1.14 Pre-Release 5', 'b1.7.3']) assert.equal(ok({ mc }).mc, mc);
  for (const loader of [undefined, 'Fabric', 'optifine', 'liteloader', '', 7, ['fabric']]) no({ loader }, /nieznany loader/);
  for (const loader of ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']) assert.equal(ok({ loader }).loader, loader);
  for (const loaderVersion of [7, '', '../x', 'a b', 'x'.repeat(65), '0.16.10\n', '0.16/10']) no({ loaderVersion }, /nieprawidłową wersję loadera/);
  assert.equal(ok({ loaderVersion: null }).loaderVersion, null);
  assert.equal(ok({ loaderVersion: undefined }).loaderVersion, null);
  assert.equal(ok({ loaderVersion: '21.1.77-beta+build.5' }).loaderVersion, '21.1.77-beta+build.5');
  assert.equal(ok({ loader: 'vanilla', loaderVersion: '0.16.10' }).loaderVersion, null, 'Vanilla has no loader version');
  no({ hammerClient: 'tak' }, /To nie jest przepis instancji/);
  assert.equal(ok({ hammerClient: undefined }).hammerClient, false);

  // the content
  no({ content: 'sodium' }, /To nie jest przepis instancji/);
  no({ content: {} }, /To nie jest przepis instancji/);
  assert.deepEqual(ok({ content: undefined }).content, []);
  no({ content: Array.from({ length: 501 }, (_, i) => ({ type: 'mod', project: `P${String(i).padStart(7, '0')}`, version: `V${String(i).padStart(7, '0')}`, file: `m${i}.jar` })) }, /za dużo dodatków \(najwyżej 500\)/);
  assert.equal(ok({ content: Array.from({ length: 500 }, (_, i) => ({ type: 'mod', project: `P${String(i).padStart(7, '0')}`, version: `V${String(i).padStart(7, '0')}`, file: `m${i}.jar` })) }).content.length, 500);
  for (const entry of [null, 'sodium', 7, []]) no({ content: [entry] }, /nieznanego rodzaju/);
  for (const type of [undefined, 'modpack', 'datapack', 'plugin', 'Mod', '']) no(item({ type }), /nieznanego rodzaju/);
  for (const project of [undefined, 7, '', 'sodium', 'AANobbM', 'AANobbMI-x', 'AANobb/I', '../../etc', 'AANobbMI?x=1', 'AANobbMIAANobbMI', 'https://x']) no(item({ project }), /nieprawidłowym identyfikatorem Modrinth/);
  for (const version of [undefined, 7, '', 'v1', 'mc121S0d/x', '..\\..\\x', 'mc121S0d\n']) no(item({ version }), /nieprawidłowym identyfikatorem Modrinth/);
  for (const file of [undefined, 7, '', '.jar', 'sodium', 'sodium.exe', 'sodium.zip', '../sodium.jar', '..\\sodium.jar', '/etc/sodium.jar', 'C:\\mods\\sodium.jar', 'mods/sodium.jar', 'sodium.jar ', ' sodium.jar', '.hidden.jar', 'so\u0000dium.jar', 'so:dium.jar', 'so"dium.jar', 'so|dium.jar', `${'x'.repeat(157)}.jar`, 'https://evil.example/sodium.jar']) {
    no(item({ file }), /nieprawidłową nazwą pliku/);
  }
  no({ content: [{ type: 'resourcepack', project: 'RpFaith32', version: 'faith32x', file: 'pack.jar' }] }, /nieprawidłową nazwą pliku/);
  no({ content: [{ type: 'shader', project: 'HVnmMxH1', version: 'compRe51', file: 'shader.jar' }] }, /nieprawidłową nazwą pliku/);
  assert.equal(ok(item({ file: '[1.21] Sodium (fabric) v0.6.5+mc1.21.1 – świetny.JAR' })).content[0].file, '[1.21] Sodium (fabric) v0.6.5+mc1.21.1 – świetny.JAR');
  no(item({ off: 'true' }), /To nie jest przepis instancji/);
  assert.deepEqual(ok(item({ off: false })).content, [{ type: 'mod', project: 'AANobbMI', version: 'mc121S0d', file: 'sodium.jar' }]);
  // Only the known fields survive – a path or an address smuggled into an entry is simply not there afterwards.
  assert.deepEqual(ok(item({ url: 'https://evil.example/x.jar', path: '../../x.jar', downloads: ['https://evil.example'], title: 'x' })).content, [{ type: 'mod', project: 'AANobbMI', version: 'mc121S0d', file: 'sodium.jar' }]);
  assert.deepEqual(Object.keys(ok({ url: 'https://evil.example', dir: 'C:\\Windows', __proto__: { polluted: true } })), ['format', 'v', 'name', 'mc', 'loader', 'loaderVersion', 'hammerClient', 'content', 'servers']);
  // The same project twice: the first one counts.
  assert.deepEqual(ok({ content: [{ type: 'mod', project: 'AANobbMI', version: 'mc121S0d', file: 'a.jar' }, { type: 'mod', project: 'AANobbMI', version: 'mc121S0e', file: 'b.jar' }] }).content.map((c) => c.file), ['a.jar']);

  // the servers
  no({ servers: 'mc.hammershop.pl' }, /To nie jest przepis instancji/);
  assert.deepEqual(ok({ servers: undefined }).servers, []);
  no({ servers: Array.from({ length: 101 }, (_, i) => ({ name: `S${i}`, address: `s${i}.example.pl` })) }, /za dużo serwerów \(najwyżej 100\)/);
  for (const entry of [null, 'mc.hammershop.pl', 7, [], { name: 'x' }, { name: 7, address: 'a.pl' }, { name: 'x', address: 7 }]) no({ servers: [entry] }, /nieprawidłowy serwer/);
  for (const address of ['', 'https://mc.hammershop.pl', 'mc.hammershop.pl/path', 'mc.hammershop.pl:99999', 'mc.hammershop.pl:0', 'a b.pl', 'mc.hammershop.pl:25565:1', 'user@mc.hammershop.pl', '-x.pl', 'x..pl', `${'a'.repeat(254)}.pl`, 'mc.hammershop.pl?x=1', '[::1]:25565']) {
    no({ servers: [{ name: 'x', address }] }, /nieprawidłowym adresem/);
  }
  no({ servers: [{ name: 'x'.repeat(49), address: 'a.pl' }] }, /Nazwa serwera w przepisie jest za długa/);
  assert.deepEqual(ok({ servers: [{ address: ' MC.Example.pl:25565 ', icon: 'data:image/png;base64,AAAA', acceptTextures: 1 }, { name: ' U\u0007 Oli ', address: '192.168.1.10' }] }).servers, [{ name: 'MC.Example.pl:25565', address: 'MC.Example.pl:25565' }, { name: 'U Oli', address: '192.168.1.10' }], 'name and address only');

  // options.txt
  no({ options: 7 }, /To nie jest przepis instancji/);
  no({ options: ['lang:pl_pl'] }, /To nie jest przepis instancji/);
  no({ options: `lang:pl_pl\n${'x'.repeat(recipe.MAX_OPTIONS)}` }, /Ustawienia gry w przepisie są za duże/);
  no({ options: 'lang:pl_pl\u0000' }, /nie są zwykłym tekstem/);
  no({ options: 'lang:pl_pl\u001b[2J' }, /nie są zwykłym tekstem/);
  assert.equal(ok({ options: 'lang:pl_pl\r\nfov:0.5\r\n\tkey:x\n' }).options, 'lang:pl_pl\nfov:0.5\n\tkey:x\n');
  assert.equal('options' in ok({ options: null }), false);
  assert.equal(ok({ options: '' }).options, '');
});

test('recipe: codes are untrusted – too long, damaged, zip bombs, things that are not recipes', () => {
  const good = recipe.encode(sample()).code;
  rejects(() => recipe.decode(''), /Wklej kod instancji/);
  rejects(() => recipe.decode(null), /Wklej kod instancji/);
  rejects(() => recipe.decode('   \n '), /Wklej kod instancji/);
  rejects(() => recipe.decode('HP1.abc.def'), /Kod zaczyna się od „HL1\.”/);
  rejects(() => recipe.decode('https://hammershop.pl/join?server=mc.hammershop.pl'), /Kod zaczyna się od „HL1\.”/);
  rejects(() => recipe.decode(good.slice(4)), /Kod zaczyna się od „HL1\.”/);
  rejects(() => recipe.decode('HL1.'), /uszkodzony albo niepełny/);
  rejects(() => recipe.decode('HL1.@@@@'), /uszkodzony albo niepełny/);
  rejects(() => recipe.decode(`${good}=`), /uszkodzony albo niepełny/);
  rejects(() => recipe.decode(good.slice(0, good.length - 20)), /uszkodzony albo niepełny/, 'a code cut off while copying');
  rejects(() => recipe.decode(`HL1.${Buffer.from('zwykły tekst, nie deflate').toString('base64url')}`), /uszkodzony albo niepełny/);
  // The length is checked before anything is decoded or inflated.
  const inflate = zlib.inflateRawSync;
  let inflated = 0;
  zlib.inflateRawSync = (...a) => ((inflated += 1), inflate(...a));
  try {
    rejects(() => recipe.decode(`HL1.${'A'.repeat(recipe.MAX_CODE)}`), /za długi \(najwyżej 6000 znaków\)/);
    rejects(() => recipe.decode(`HL1.${'A'.repeat(5_000_000)}`), /za długi/);
    assert.equal(inflated, 0);
  } finally {
    zlib.inflateRawSync = inflate;
  }
  // A zip bomb: a code of legal length whose JSON inflates to twice the limit (deflate packs about 1000:1, so this
  // is as bad as a 6000-character code gets). The inflation stops at 2 MB – the rest is never produced.
  const bomb = codeOf(`{"format":"hammerpack","v":1,"name":"${'A'.repeat(2 * recipe.MAX_SIZE)}"}`);
  assert.ok(bomb.length <= recipe.MAX_CODE, `the bomb fits in a code (${bomb.length} characters)`);
  rejects(() => recipe.decode(bomb), /rozpakowuje się do zbyt dużych danych/);
  // Just under the limit it is inflated and then refused for what it is: a name far too long.
  rejects(() => recipe.decode(codeOf(`{"format":"hammerpack","v":1,"name":"${'A'.repeat(recipe.MAX_SIZE - 100)}"}`)), /Nazwa instancji w przepisie jest za długa/);
  // Valid deflate, but not a recipe inside.
  rejects(() => recipe.decode(codeOf('to nie jest JSON')), /To nie jest przepis instancji/);
  rejects(() => recipe.decode(codeOf('[]')), /To nie jest przepis instancji/);
  rejects(() => recipe.decode(codeOf('null')), /To nie jest przepis instancji/);
  rejects(() => recipe.decode(codeOf({ format: 'hammerpack' })), /To nie jest przepis instancji/);
  rejects(() => recipe.decode(codeOf('['.repeat(200_000))), /To nie jest przepis instancji/, 'deeply nested JSON');
  rejects(() => recipe.decode(codeOf(sample({ servers: [{ name: 'x', address: 'file:///etc/passwd' }] }))), /nieprawidłowym adresem/);
  rejects(() => recipe.decode(codeOf(sample({ content: [{ type: 'mod', project: '../../x', version: 'mc121S0d', file: 'a.jar' }] }))), /identyfikatorem Modrinth/);
  // Every message is one calm Polish sentence – never a stack trace or a system error.
  for (const text of ['HL1.@@@@', bomb, codeOf('x'), `HL1.${'A'.repeat(7000)}`]) {
    try {
      recipe.decode(text);
      assert.fail('should have been refused');
    } catch (err) {
      assert.ok(err instanceof RecipeError);
      assert.doesNotMatch(err.message, /Error|ERR_|at |zlib|JSON|undefined/);
    }
  }
});

test('recipe: a big instance gets no code – only the file', () => {
  // Realistic ids and file names do not compress away: 400 mods are well past 6000 characters.
  const rnd = (seed, n) => Array.from({ length: n }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[(seed * 7919 + i * 104729 + ((seed * (i + 3)) % 97)) % 62]).join('');
  const many = (n) => sample({ content: Array.from({ length: n }, (_, i) => ({ type: 'mod', project: rnd(i + 1, 8), version: rnd(i + 1001, 8), file: `${rnd(i + 5000, 12)}-fabric-${i % 9}.${i % 13}.${i % 7}+mc1.21.1.jar` })) });
  const big = recipe.encode(many(400));
  assert.equal(big.code, null);
  assert.ok(big.codeLength > recipe.MAX_CODE);
  assert.equal(JSON.parse(big.json).content.length, 400, 'the file still holds everything');
  assert.deepEqual(recipe.parseJson(big.json), many(400));
  const small = recipe.encode(many(30));
  assert.ok(small.code && small.code.length <= recipe.MAX_CODE);
  assert.deepEqual(recipe.decode(small.code), many(30));
});

test('recipe: built from an instance – Modrinth content in, files from elsewhere listed as not shareable', () => {
  const instance = { name: '  Survival z ekipą  ', mcVersion: '1.21.1', loader: 'fabric', loaderVersion: null, hammerClient: true };
  const items = [
    { type: 'mod', file: 'sodium-fabric-0.6.5.jar', title: 'Sodium', projectId: 'AANobbMI', versionId: 'mc121S0d', enabled: true },
    { type: 'mod', file: 'appleskin.jar', title: 'AppleSkin', projectId: 'EsAfCjCV', versionId: 'appl3sk1', enabled: false },
    { type: 'mod', file: 'hammer-client.jar', title: 'Hammer Client', enabled: true }, // the launcher's own mod: the flag says it
    { type: 'mod', file: 'moj-wlasny-mod.jar', title: 'Mój własny mod', enabled: true },
    { type: 'mod', file: 'OptiFine_1.21.1_HD_U_J1.jar', title: 'OptiFine', projectId: null, versionId: null, enabled: true },
    { type: 'mod', file: 'sodium-duplikat.jar', title: 'Sodium', projectId: 'AANobbMI', versionId: 'mc121S0x', enabled: true },
    { type: 'resourcepack', file: 'Faithful 32x.zip', title: 'Faithful 32x', projectId: 'RpFaith32', versionId: 'faith32x', enabled: true },
    { type: 'resourcepack', file: 'Paczka od Oli.zip', title: 'Paczka od Oli', enabled: true },
    { type: 'shader', file: 'BSL_v8.4.zip', title: 'BSL Shaders', projectId: 'Q1vvjJYV', versionId: 'bslShad8', enabled: true },
    { type: 'datapack', file: 'x.zip', title: 'x', projectId: 'AAAAAAAA', versionId: 'BBBBBBBB' },
  ];
  const list = [{ index: 0, name: 'HammerShop', address: 'mc.hammershop.pl', icon: 'data:image/png;base64,AAAA', acceptTextures: true }, { index: 1, name: 'x'.repeat(60), address: '10.0.0.5:25570', icon: null }, { index: 2, name: 'IPv6', address: '[::1]:25565' }];
  const built = recipe.build({ instance, items, servers: list, options: 'lang:pl_pl\r\nfov:0.5\r\n' });
  assert.deepEqual(built.recipe, {
    format: 'hammerpack',
    v: 1,
    name: 'Survival z ekipą',
    mc: '1.21.1',
    loader: 'fabric',
    loaderVersion: null,
    hammerClient: true,
    content: [
      { type: 'mod', project: 'AANobbMI', version: 'mc121S0d', file: 'sodium-fabric-0.6.5.jar' },
      { type: 'mod', project: 'EsAfCjCV', version: 'appl3sk1', file: 'appleskin.jar', off: true },
      { type: 'resourcepack', project: 'RpFaith32', version: 'faith32x', file: 'Faithful 32x.zip' },
      { type: 'shader', project: 'Q1vvjJYV', version: 'bslShad8', file: 'BSL_v8.4.zip' },
    ],
    servers: [{ name: 'HammerShop', address: 'mc.hammershop.pl' }, { name: 'x'.repeat(48), address: '10.0.0.5:25570' }],
    options: 'lang:pl_pl\nfov:0.5\n',
  });
  assert.deepEqual(built.excluded, [
    { type: 'mod', file: 'moj-wlasny-mod.jar', title: 'Mój własny mod' },
    { type: 'mod', file: 'OptiFine_1.21.1_HD_U_J1.jar', title: 'OptiFine' },
    { type: 'resourcepack', file: 'Paczka od Oli.zip', title: 'Paczka od Oli' },
  ]);
  assert.equal(built.optionsLeftOut, false);
  // Without the settings; Hammer Client off; a settings file too big for a recipe is left out and said so.
  const plain = recipe.build({ instance: { ...instance, loader: 'vanilla', loaderVersion: '0.16.10', hammerClient: false }, items: [], servers: [] });
  assert.equal('options' in plain.recipe, false);
  assert.deepEqual([plain.recipe.loaderVersion, plain.recipe.hammerClient, plain.recipe.content, plain.recipe.servers], [null, false, [], []]);
  const huge = recipe.build({ instance, items: [], servers: [], options: `lang:pl_pl\n${'key:x\n'.repeat(20_000)}` });
  assert.equal(huge.optionsLeftOut, true);
  assert.equal('options' in huge.recipe, false);
  // More Modrinth content than a recipe may hold.
  const tooMany = Array.from({ length: 501 }, (_, i) => ({ type: 'mod', file: `m${i}.jar`, projectId: `P${String(i).padStart(7, '0')}`, versionId: `V${String(i).padStart(7, '0')}` }));
  rejects(() => recipe.build({ instance, items: tooMany }), /ponad 500 dodatków/);
});

/* ── exporting and importing with the launcher's own parts (Modrinth is a stand-in) ── */

const sodiumJar = fabricJar({ id: 'sodium', name: 'Sodium', version: '0.6.5' });
const apiJar = fabricJar({ id: 'fabric-api', name: 'Fabric API', version: '0.110' });
const packZip = Buffer.from('PK resource pack');
const shaderZip = Buffer.from('PK shader pack');
const V = {
  mc121S0d: mrVersion({ id: 'mc121S0d', projectId: 'AANobbMI', number: '0.6.5', file: { name: 'sodium-fabric-0.6.5+mc1.21.1.jar', body: sodiumJar } }),
  fApi0110: mrVersion({ id: 'fApi0110', projectId: 'P7dR8mSH', number: '0.110', file: { name: 'fabric-api-0.110.0+1.21.1.jar', body: apiJar } }),
  faith32x: mrVersion({ id: 'faith32x', projectId: 'RpFaith32', number: '1.21', loaders: ['minecraft'], file: { name: 'Faithful 32x - 1.21.zip', body: packZip } }),
  compRe51: mrVersion({ id: 'compRe51', projectId: 'HVnmMxH1', number: 'r5.1', loaders: ['iris'], file: { name: 'ComplementaryReimagined_r5.1.zip', body: shaderZip } }),
};
const P = { AANobbMI: { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon_url: 'https://cdn.modrinth.com/s.png' }, P7dR8mSH: { id: 'P7dR8mSH', slug: 'fabric-api', title: 'Fabric API' }, RpFaith32: { id: 'RpFaith32', slug: 'faithful-32x', title: 'Faithful 32x' }, HVnmMxH1: { id: 'HVnmMxH1', slug: 'complementary-reimagined', title: 'Complementary Reimagined' } };

function setup({ versions = V, down = false, failFile = null, hashes = {} } = {}) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    calls.push(u);
    if (down) throw new Error('getaddrinfo ENOTFOUND api.modrinth.com');
    const json = (value) => new Response(JSON.stringify(value), { status: 200 });
    const ids = () => JSON.parse(new URL(u).searchParams.get('ids'));
    if (/\/v2\/versions\?/.test(u)) return json(ids().map((id) => versions[id]).filter(Boolean));
    if (/\/v2\/projects\?/.test(u)) return json(ids().map((id) => P[id]).filter(Boolean));
    if (/\/v2\/version_files$/.test(u)) return json(Object.fromEntries(JSON.parse(init.body).hashes.filter((h) => hashes[h]).map((h) => [h, hashes[h]])));
    if (/cdn\.modrinth\.com\/data\//.test(u)) {
      const name = decodeURIComponent(u.split('/').pop());
      const version = Object.values(V).find((v) => v.files[0].filename === name);
      const body = { 'sodium-fabric-0.6.5+mc1.21.1.jar': sodiumJar, 'fabric-api-0.110.0+1.21.1.jar': apiJar, 'Faithful 32x - 1.21.zip': packZip, 'ComplementaryReimagined_r5.1.zip': shaderZip }[name];
      if (!version || !body || name === failFile) return new Response('nope', { status: 503 });
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    }
    return new Response('nope', { status: 404 });
  };
  const root = tmpDir();
  const instances = createInstances(createPaths(root));
  const modrinth = createModrinth({ fetchFn, sleep: async () => {} });
  const content = createContent({ modrinth, fetchFn });
  const versionsApi = {
    minecraftVersions: async () => ['26.1', '1.21.4', '1.21.1', '1.20.1'].map((id) => ({ id, type: 'release' })),
    loaderVersions: async (loader, mc) => (loader === 'fabric' ? [{ version: '0.16.10', stable: true }, { version: '0.16.9', stable: true }] : loader === 'forge' && mc === '1.20.1' ? [{ version: '47.3.0', stable: true }] : []),
  };
  const sharing = recipe.createSharing({ instances, content, modrinth, versionsApi, serverList: servers });
  return { sharing, instances, content, calls, root };
}

test('sharing: a recipe becomes a new instance – content through the usual Modrinth download, servers and settings in place', async () => {
  const { sharing, instances, content, calls } = setup();
  instances.create({ name: 'Survival z ekipą', mcVersion: '1.20.1', loader: 'vanilla' }); // the name is taken
  const steps = [];
  const res = await sharing.install(recipe.validate(sample({ options: 'lang:en_us\nfov:0.5\n' })), { onProgress: (p) => steps.push(p) });
  const { instance } = res;
  assert.deepEqual([instance.name, instance.mcVersion, instance.loader, instance.loaderVersion, instance.hammerClient, instance.optimized], ['Survival z ekipą (2)', '1.21.1', 'fabric', '0.16.10', true, false]);
  assert.deepEqual([res.installed, res.missing, res.notes], [4, [], []]);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'mods')).sort(), ['fabric-api-0.110.0+1.21.1.jar.disabled', 'sodium-fabric-0.6.5+mc1.21.1.jar'], 'a mod that was switched off stays switched off');
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'resourcepacks')), ['Faithful 32x - 1.21.zip']);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, 'shaderpacks')), ['ComplementaryReimagined_r5.1.zip']);
  assert.deepEqual(content.list(instance, 'mod').map((m) => [m.title, m.projectId, m.versionId, m.enabled]), [['Fabric API', 'P7dR8mSH', 'fApi0110', false], ['Sodium', 'AANobbMI', 'mc121S0d', true]], 'known to the launcher like any Modrinth install (updates, icons)');
  assert.equal(sha1(fs.readFileSync(path.join(instance.dir, 'mods', 'sodium-fabric-0.6.5+mc1.21.1.jar'))), sha1(sodiumJar));
  assert.deepEqual(servers.list(instance).map((s) => [s.name, s.address]), [['HammerShop', 'mc.hammershop.pl'], ['U Kuby', '83.12.45.201:25570']]);
  assert.equal(fs.readFileSync(path.join(instance.dir, 'options.txt'), 'utf8'), 'lang:en_us\nfov:0.5\n');
  assert.deepEqual(steps[0], { label: 'Sprawdzanie dodatków na Modrinth', done: 0, total: 0 });
  assert.deepEqual(steps.at(-1), { label: 'Pobieranie dodatków (4/4)', done: 4, total: 4 });
  // Modrinth was asked in bulk – one request for the versions, one for the projects – and files came from its CDN only.
  assert.equal(calls.filter((u) => u.includes('api.modrinth.com')).length, 2);
  assert.ok(calls.filter((u) => !u.includes('api.modrinth.com')).every((u) => u.startsWith('https://cdn.modrinth.com/data/')));
  assert.equal(calls.filter((u) => u.startsWith('https://cdn.modrinth.com/')).length, 4);
});

test('sharing: what is no longer on Modrinth is reported at the end – the rest still installs', async () => {
  // Sodium's version was removed; the "Fabric API" id now belongs to another project; the shader's file is a jar on Modrinth.
  const versions = { ...V, mc121S0d: undefined, fApi0110: { ...V.fApi0110, project_id: 'ZZZZZZZZ' }, compRe51: { ...V.compRe51, files: [{ ...V.compRe51.files[0], filename: 'not-a-shader.jar' }] } };
  const { sharing, instances } = setup({ versions });
  const res = await sharing.install(recipe.validate(sample()));
  assert.equal(res.installed, 1);
  assert.deepEqual(res.missing, [
    { type: 'mod', file: 'sodium-fabric-0.6.5+mc1.21.1.jar', reason: 'gone' },
    { type: 'mod', file: 'fabric-api-0.110.0+1.21.1.jar', reason: 'mismatch' },
    { type: 'shader', file: 'ComplementaryReimagined_r5.1.zip', reason: 'mismatch' },
  ]);
  assert.deepEqual(fs.readdirSync(path.join(res.instance.dir, 'mods')), []);
  assert.deepEqual(fs.readdirSync(path.join(res.instance.dir, 'resourcepacks')), ['Faithful 32x - 1.21.zip']);
  assert.deepEqual(fs.readdirSync(path.join(res.instance.dir, 'shaderpacks')), []);
  assert.equal(instances.list().length, 1, 'the instance is there, with what could be had');
  // A file that fails to download is reported the same way.
  const flaky = setup({ failFile: 'Faithful 32x - 1.21.zip' });
  const second = await flaky.sharing.install(recipe.validate(sample()));
  assert.equal(second.installed, 3);
  assert.deepEqual(second.missing.map((m) => [m.file, m.reason]), [['Faithful 32x - 1.21.zip', 'failed']]);
  assert.match(second.missing[0].error, /HTTP 503/);
});

test('sharing: versions come from the real lists – an unknown game version or loader build is never used', async () => {
  const { sharing, instances } = setup();
  await assert.rejects(sharing.install(recipe.validate(sample({ mc: '9.99' }))), (err) => err instanceof RecipeError && /Minecrafta 9\.99, a takiej wersji gry nie ma/.test(err.message));
  await assert.rejects(sharing.install(recipe.validate(sample({ loader: 'quilt', loaderVersion: null }))), /Quilt nie ma wersji dla Minecrafta 1\.21\.1/);
  await assert.rejects(sharing.install(recipe.validate(sample({ loader: 'forge', loaderVersion: null }))), /Forge nie ma wersji dla Minecrafta 1\.21\.1/);
  assert.equal(instances.list().length, 0, 'nothing is created for a recipe that cannot work');
  // A loader build that is not on the list: the newest recommended one is used, and the preview says so.
  assert.deepEqual(await sharing.check(recipe.validate(sample({ loaderVersion: '9.9.9-evil' }))), { loaderVersion: null, notes: ['Fabric 9.9.9-evil nie ma już na liście – launcher użyje najnowszej zalecanej wersji.'] });
  const res = await sharing.install(recipe.validate(sample({ loaderVersion: '9.9.9-evil', content: [] })));
  assert.equal(res.instance.loaderVersion, null);
  assert.equal(res.notes.length, 1);
  assert.deepEqual(await sharing.check(recipe.validate(sample({ loader: 'vanilla', loaderVersion: null }))), { loaderVersion: null, notes: [] });
  // No internet: said plainly, nothing created.
  const offline = recipe.createSharing({ instances, content: null, modrinth: null, serverList: servers, versionsApi: { minecraftVersions: async () => Promise.reject(new Error('ENOTFOUND')), loaderVersions: async () => [] } });
  await assert.rejects(offline.check(recipe.validate(sample())), /Nie udało się sprawdzić wersji Minecrafta z przepisu – sprawdź internet/);
});

test('sharing: Modrinth cannot be reached – no half-made instance is left behind', async () => {
  const { sharing, instances } = setup({ down: true });
  await assert.rejects(sharing.install(recipe.validate(sample())), /Brak połączenia z Modrinth/);
  assert.equal(instances.list().length, 0);
});

test('sharing: exporting an instance – what is in it, what cannot be shared, code and file name', async () => {
  // A jar added by hand that Modrinth knows by its checksum is shared too; one it does not know is listed by name.
  const handJar = fabricJar({ id: 'lithium', name: 'Lithium', version: '0.14' });
  const { sharing, instances, content } = setup({ hashes: { [sha1(handJar)]: { id: 'l1th1um0', project_id: 'AANobbMI', version_number: '0.14' } } });
  const instance = instances.create({ name: 'Moja: instancja?', mcVersion: '1.21.1', loader: 'fabric', hammerClient: false });
  fs.writeFileSync(path.join(instance.dir, 'mods', 'lithium-dodany-recznie.jar'), handJar);
  fs.writeFileSync(path.join(instance.dir, 'mods', 'hammer-client.jar'), fabricJar({ id: 'hammerclient', name: 'Hammer Client', version: '2.2.0' }));
  fs.writeFileSync(path.join(instance.dir, 'mods', 'tajny-mod.jar'), fabricJar({ id: 'tajny', name: 'Tajny mod', version: '1' }));
  await content.installVersion(instance, 'resourcepack', V.faith32x, P.RpFaith32);
  servers.add(instance, { name: 'HammerShop', address: 'mc.hammershop.pl' });
  const exp = await sharing.exportRecipe(instance, { options: true });
  assert.deepEqual(exp.summary, { name: 'Moja: instancja?', mc: '1.21.1', loader: 'fabric', loaderVersion: null, hammerClient: false, mods: 1, resourcepacks: 1, shaders: 0, servers: 1, options: true });
  assert.deepEqual(exp.recipe.content, [{ type: 'mod', project: 'AANobbMI', version: 'l1th1um0', file: 'lithium-dodany-recznie.jar' }, { type: 'resourcepack', project: 'RpFaith32', version: 'faith32x', file: 'Faithful 32x - 1.21.zip' }]);
  assert.deepEqual(exp.excluded, [{ type: 'mod', file: 'tajny-mod.jar', title: 'Tajny mod' }]);
  assert.equal(exp.recipe.options, 'lang:pl_pl\nonboardAccessibility:false\n');
  assert.equal(exp.fileName, 'Moja_ instancja_.hammerpack');
  assert.deepEqual(recipe.decode(exp.code), exp.recipe);
  assert.deepEqual(recipe.parseJson(exp.json), exp.recipe);
  assert.equal('options' in (await sharing.exportRecipe(instance)).recipe, false, 'settings only when asked for');
});
