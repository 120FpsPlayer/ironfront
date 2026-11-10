'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { generateArguments } = require('@xmcl/core');
const { buildLaunchOptions, GameManager, parseAddress, supportsQuickPlay, memoryFor } = require('../src/main/launch');
const { analyze } = require('../src/main/crash');
const { createPaths } = require('../src/main/paths');
const { DEFAULT_SETTINGS } = require('../src/main/settings');
const { tmpDir } = require('./helpers');

const GB = 1024 ** 3;

/** A minimal version JSON like Mojang's (1.21.1-style arguments). */
function fixtureVersion(root, id = '1.21.1') {
  const dir = path.join(root, 'versions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      id,
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      assets: '17',
      assetIndex: { id: '17', sha1: 'x', size: 1, totalSize: 1, url: 'https://piston-meta.mojang.com/x.json' },
      javaVersion: { component: 'java-runtime-delta', majorVersion: 21 },
      libraries: [],
      downloads: { client: { sha1: 'x', size: 1, url: 'https://piston-data.mojang.com/client.jar' } },
      arguments: {
        game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}', '--versionType', '${version_type}', { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] }, { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }],
        jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
      },
    }),
  );
}

test('launch options → real game arguments: account, RAM, tuned flags, resolution, Polish launcher name', async () => {
  const root = tmpDir();
  fixtureVersion(root);
  const instanceDir = path.join(root, 'instances', 'hs');
  fs.mkdirSync(instanceDir, { recursive: true });
  const options = buildLaunchOptions({
    paths: createPaths(root),
    instance: { id: 'hs', name: 'HammerShop', dir: instanceDir, mcVersion: '1.21.1', loader: 'fabric', memoryMb: null, jvmPreset: null },
    settings: { ...DEFAULT_SETTINGS },
    account: { id: '0123456789abcdef0123456789abcdef', name: 'Gracz', accessToken: 'TOKEN' },
    versionId: '1.21.1',
    javaPath: '/java/bin/java',
    javaMajor: 21,
    totalMem: 16 * GB,
    modCount: 40,
    config: { brand: 'HammerShop' },
  });
  assert.equal(options.maxMemory, 5120, '4 GB for 16 GB RAM + 1 GB for 40 mods');
  assert.equal(options.minMemory, 2560);
  const args = await generateArguments(options);
  const has = (...seq) => args.join('\u0000').includes(seq.join('\u0000'));
  assert.equal(args[0], '/java/bin/java');
  assert.ok(args.includes('-Xmx5120M') && args.includes('-Xms2560M'), args.join(' '));
  assert.ok(args.includes('-XX:+UseG1GC') && args.includes('-XX:+IgnoreUnrecognizedVMOptions'));
  assert.ok(has('--username', 'Gracz') && has('--accessToken', 'TOKEN') && has('--userType', 'msa'));
  assert.ok(has('--gameDir', instanceDir));
  assert.ok(has('--width', '1280') && has('--height', '720'));
  assert.ok(args.includes('net.minecraft.client.main.Main'));
});

test('quick join on the HammerShop server: Quick Play on 1.20+, --server before', () => {
  const base = { paths: createPaths('/r'), settings: { ...DEFAULT_SETTINGS }, account: { id: 'a', name: 'b', accessToken: 'c' }, versionId: 'v', javaPath: 'j', totalMem: 8 * GB, config: { server: { address: 'play.hammershop.pl' } } };
  const modern = buildLaunchOptions({ ...base, instance: { id: 'x', dir: '/d', name: 'x', mcVersion: '1.21.1', loader: 'vanilla', autoJoinServer: true } });
  assert.equal(modern.quickPlayMultiplayer, 'play.hammershop.pl:25565');
  const old = buildLaunchOptions({ ...base, instance: { id: 'x', dir: '/d', name: 'x', mcVersion: '1.16.5', loader: 'vanilla', autoJoinServer: true } });
  assert.deepEqual(old.server, { ip: 'play.hammershop.pl', port: 25565 });
  assert.deepEqual(parseAddress('mc.example.pl:25570'), { ip: 'mc.example.pl', port: 25570 });
  assert.equal(supportsQuickPlay('1.19.4'), false);
  assert.equal(supportsQuickPlay('26.1'), true, 'year-based versions are new');
  const custom = memoryFor({ instance: { jvmPreset: 'custom', customJvmArgs: '-Xmx10G', loader: 'fabric' }, settings: DEFAULT_SETTINGS, totalMem: 8 * GB });
  assert.equal(custom, 10240, 'own -Xmx wins');
});

function fakeChild() {
  const child = new EventEmitter();
  child.pid = undefined;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('exit', null, 'SIGTERM');
  return child;
}

test('the game manager streams the log, reports running/exited and explains a crash', async () => {
  const child = fakeChild();
  const games = new GameManager({ launchFn: async () => child });
  const states = [];
  const lines = [];
  games.on('state', (s) => states.push(s.state));
  games.on('log', (l) => lines.push(l.line));
  let exit;
  const instance = { id: 'hs', dir: tmpDir() };
  await games.start({ instance, options: {}, onExit: (e) => (exit = e) });
  assert.equal(games.isRunning('hs'), true);
  await assert.rejects(games.start({ instance, options: {} }), /już działa/);
  child.stdout.write('[Render thread/INFO]: Setting user: Gracz\n[Render thread/INFO]: Backend library: LWJGL version 3.3.3\n');
  child.stderr.write('java.lang.OutOfMemoryError: Java heap space\n');
  await new Promise((r) => setTimeout(r, 20));
  child.emit('exit', 1, null);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(lines.includes('[Render thread/INFO]: Setting user: Gracz'));
  assert.equal(states.at(-1), 'crashed');
  assert.equal(exit.crash.title, 'Grze zabrakło pamięci RAM');
  assert.equal(games.isRunning('hs'), false);
  assert.ok(games.logs('hs').length >= 3, 'the log stays readable after the game closed');
});

test('crash hints in Polish for the usual problems', () => {
  assert.equal(analyze({ code: 0 }), null);
  assert.equal(analyze({ code: 1, log: 'Exception in thread "main" java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version of the Java Runtime' }).title, 'Zła wersja Javy');
  const mods = analyze({ code: 1, log: "Incompatible mods found!\n - Mod 'Iris' (iris) 1.8.0 requires any version of sodium, which is missing!\n - Install sodium, any version." });
  assert.equal(mods.title, 'Mody się nie zgadzają');
  assert.ok(mods.details.some((d) => d.includes('requires any version of sodium')));
  assert.equal(analyze({ code: -1, log: 'GLFW error 65542: WGL: The driver does not appear to support OpenGL' }).title, 'Problem ze sterownikami karty graficznej');
  assert.equal(analyze({ code: 1, log: 'Mixin apply for mod lithium failed lithium.mixins.json' }).details[0], 'Mod: lithium');
  assert.equal(analyze({ code: 1, crashReport: '---- Minecraft Crash Report ----\nDescription: Ticking entity\n' }).details[0], 'Ticking entity');
});

test('game log: log4j XML events become readable lines, other lines pass through', () => {
  const { createLogParser } = require('../src/main/launch');
  const parse = createLogParser();
  const lines = [
    '<log4j:Event logger="net.minecraft.client.Minecraft" timestamp="1762770031000" level="INFO" thread="Render thread">',
    '  <log4j:Message><![CDATA[Backend library: LWJGL version 3.3.3-snapshot]]></log4j:Message>',
    '</log4j:Event>',
    'Picked up JAVA_TOOL_OPTIONS: -Xss2m',
    '<log4j:Event logger="x" timestamp="1762770032000" level="ERROR" thread="main">',
    '  <log4j:Message><![CDATA[Unreported exception thrown!]]></log4j:Message>',
    '  <log4j:Throwable><![CDATA[java.lang.OutOfMemoryError: Java heap space',
    '\tat net.minecraft.class_2818.method_12011(class_2818.java:212)',
    ']]></log4j:Throwable>',
    '</log4j:Event>',
  ];
  const out = lines.flatMap((l) => parse(l));
  assert.equal(out.length, 5);
  assert.match(out[0], /^\[\d\d:\d\d:\d\d\] \[Render thread\/INFO\]: Backend library: LWJGL version 3\.3\.3-snapshot$/);
  assert.equal(out[1], 'Picked up JAVA_TOOL_OPTIONS: -Xss2m');
  assert.match(out[2], /\[main\/ERROR\]: Unreported exception thrown!$/);
  assert.deepEqual(out.slice(3), ['java.lang.OutOfMemoryError: Java heap space', '\tat net.minecraft.class_2818.method_12011(class_2818.java:212)']);
});

test('play on a chosen server or in a chosen world: Quick Play on 1.20+, --server (or nothing) before', async () => {
  const root = tmpDir();
  fixtureVersion(root);
  const base = { paths: createPaths(root), settings: { ...DEFAULT_SETTINGS }, account: { id: 'a', name: 'b', accessToken: 'c' }, versionId: '1.21.1', javaPath: 'java', totalMem: 8 * GB, config: { server: { address: 'play.hammershop.pl' } } };
  const modern = { id: 'x', dir: path.join(root, 'instances', 'x'), name: 'x', mcVersion: '1.21.1', loader: 'vanilla' };
  const old = { ...modern, mcVersion: '1.16.5' };
  const has = (args, ...seq) => args.join('\u0000').includes(seq.join('\u0000'));

  // A server from the Serwery tab.
  const onServer = buildLaunchOptions({ ...base, instance: modern, server: 'mc.example.pl:25570' });
  assert.equal(onServer.quickPlayMultiplayer, 'mc.example.pl:25570');
  assert.equal(onServer.server, undefined);
  assert.ok(has(await generateArguments(onServer), '--quickPlayMultiplayer', 'mc.example.pl:25570'));
  assert.equal(buildLaunchOptions({ ...base, instance: modern, server: 'mc.example.pl' }).quickPlayMultiplayer, 'mc.example.pl:25565', 'the default port is added');
  const legacy = buildLaunchOptions({ ...base, instance: old, server: 'mc.example.pl:25570' });
  assert.deepEqual([legacy.server, legacy.quickPlayMultiplayer], [{ ip: 'mc.example.pl', port: 25570 }, undefined]);
  // The chosen server wins over the launcher's own server and over a world.
  const both = buildLaunchOptions({ ...base, instance: { ...modern, autoJoinServer: true }, join: true, server: 'inny.pl', world: 'Świat' });
  assert.deepEqual([both.quickPlayMultiplayer, both.quickPlaySingleplayer, both.extraMCArgs], ['inny.pl:25565', undefined, undefined]);

  // A world from the Światy tab.
  const inWorld = buildLaunchOptions({ ...base, instance: { ...modern, autoJoinServer: true }, world: 'Nasz świat (2)' });
  assert.equal(inWorld.quickPlaySingleplayer, 'Nasz świat (2)');
  assert.equal(inWorld.quickPlayMultiplayer, undefined, 'a world is not combined with auto-join');
  const args = await generateArguments(inWorld);
  assert.ok(has(args, '--quickPlaySingleplayer', 'Nasz świat (2)'), args.join(' '));
  assert.ok(!args.includes('--quickPlayMultiplayer') && !args.includes('--server'));
  const oldWorld = buildLaunchOptions({ ...base, instance: old, world: 'Nasz świat' });
  assert.deepEqual([oldWorld.quickPlaySingleplayer, oldWorld.extraMCArgs, oldWorld.server], [undefined, undefined, undefined], 'before 1.20 the world has to be opened in the game');

  // The existing behaviour: join / autoJoinServer use the configured server, nothing by default.
  assert.equal(buildLaunchOptions({ ...base, instance: modern, join: true }).quickPlayMultiplayer, 'play.hammershop.pl:25565');
  assert.equal(buildLaunchOptions({ ...base, instance: { ...modern, autoJoinServer: true } }).quickPlayMultiplayer, 'play.hammershop.pl:25565');
  const plain = buildLaunchOptions({ ...base, instance: modern });
  assert.deepEqual([plain.quickPlayMultiplayer, plain.quickPlaySingleplayer, plain.server, plain.extraMCArgs], [undefined, undefined, undefined, undefined]);
});

test('process priority: the instance wins over the launcher setting; a refusal of the system is silent', () => {
  const { priorityFor, raisePriority, PRIORITY } = require('../src/main/launch');
  assert.equal(priorityFor({}, { processPriority: 'high' }), 'high');
  assert.equal(priorityFor({ processPriority: 'normal' }, { processPriority: 'high' }), 'normal');
  assert.equal(priorityFor({ processPriority: null }, { processPriority: 'normal' }), 'normal');
  assert.equal(priorityFor({ processPriority: 'realtime' }, { processPriority: 'turbo' }), 'above_normal', 'unknown values fall back to the default');
  assert.equal(priorityFor(undefined, undefined), 'above_normal');
  const calls = [];
  const setPriority = (pid, value) => calls.push([pid, value]);
  assert.equal(raisePriority(4242, 'high', { setPriority }), true);
  assert.equal(raisePriority(4242, 'above_normal', { setPriority }), true);
  assert.deepEqual(calls, [[4242, PRIORITY.high], [4242, PRIORITY.above_normal]]);
  assert.equal(raisePriority(4242, 'normal', { setPriority }), false, 'normal = leave the process alone');
  assert.equal(raisePriority(undefined, 'high', { setPriority }), false, 'no process id (the start failed)');
  assert.equal(raisePriority(4242, 'realtime', { setPriority }), false);
  assert.equal(calls.length, 2);
  // Linux / macOS without admin rights: the system says no, the game runs on.
  assert.equal(raisePriority(4242, 'high', { setPriority: () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); } }), false);
});

test('the game manager raises the priority of the started game', async () => {
  const child = fakeChild();
  child.pid = 31337;
  const calls = [];
  const games = new GameManager({ launchFn: async () => child, setPriority: (pid, value) => calls.push([pid, value]) });
  await games.start({ instance: { id: 'p', dir: tmpDir() }, options: {}, priority: 'high' });
  assert.deepEqual(calls, [[31337, require('node:os').constants.priority.PRIORITY_HIGH]]);
  child.emit('exit', 0, null);
});

test('launch options carry flags for the Java, the heap and the number of mods of the instance', () => {
  const base = { paths: createPaths('/r'), settings: { ...DEFAULT_SETTINGS }, account: { id: 'a', name: 'b', accessToken: 'c' }, versionId: 'v', javaPath: 'j', totalMem: 16 * GB };
  const instance = { id: 'x', dir: '/d', name: 'x', mcVersion: '26.3', loader: 'fabric', jvmPreset: 'zgc' };
  const modern = buildLaunchOptions({ ...base, instance, javaMajor: 25, modCount: 200 });
  assert.ok(modern.extraJVMArgs.includes('-XX:+UseZGC') && !modern.extraJVMArgs.includes('-XX:+ZGenerational'));
  assert.ok(modern.extraJVMArgs.includes('-XX:+UseCompactObjectHeaders') && modern.extraJVMArgs.includes('-XX:ReservedCodeCacheSize=512M'));
  const old = buildLaunchOptions({ ...base, instance: { ...instance, mcVersion: '1.16.5' }, javaMajor: 8, modCount: 0, totalMem: 4 * GB });
  assert.ok(old.extraJVMArgs.includes('-XX:+UseG1GC') && old.extraJVMArgs.includes('-XX:G1HeapRegionSize=8M'), 'Java 8, small heap: G1 with smaller regions');
  assert.ok(!old.extraJVMArgs.some((f) => /ZGC|CompactObjectHeaders|ReservedCodeCache|FastUnordered/.test(f)));
});
