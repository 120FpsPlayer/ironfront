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
