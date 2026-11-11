'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const bench = require('../src/main/benchmark');
const { performanceModsIn } = require('../src/main/optimizer');
const { createServices } = require('../src/main/services');
const { GameManager } = require('../src/main/launch');
const { tmpDir, mockFetch, fabricJar } = require('./helpers');

const RESULT = { version: '2.2.1', mc: '1.21.4', seconds: 20.0, frames: 4812, avg: 240.6, low1: 121.3, min: 88.0, max: 412.5, finishedAt: 1_790_000_000_000 };

/** An instance folder with (optionally) what the mod wrote. */
function instanceDir(result) {
  const instance = { id: 'hammer', name: 'Hammer', dir: tmpDir(), mcVersion: '1.21.4', loader: 'fabric' };
  if (result !== undefined) {
    fs.mkdirSync(path.dirname(bench.resultFile(instance)), { recursive: true });
    fs.writeFileSync(bench.resultFile(instance), typeof result === 'string' ? result : JSON.stringify(result));
  }
  return instance;
}

const CLIENT = { available: true, version: '2.2.1', versions: ['1.21.1', '1.21.4'] };

test('FPS test: the two arguments for Hammer Client, with the length kept between 5 and 180 seconds', () => {
  assert.deepEqual(bench.jvmArgs(20), ['-Dhammerclient.benchmark=20', '-Dhammerclient.benchmark.quit=true']);
  assert.deepEqual(bench.LENGTHS.map((s) => bench.jvmArgs(s)[0]), ['-Dhammerclient.benchmark=10', '-Dhammerclient.benchmark=20', '-Dhammerclient.benchmark=30']);
  assert.deepEqual([3, 5, 29.6, 180, 181, 5000, -1, '30'].map(bench.clampSeconds), [5, 5, 30, 180, 180, 180, 5, 30]);
  assert.deepEqual(['abc', undefined, null, '', NaN].map(bench.clampSeconds), [20, 20, 20, 20, 20], 'not a number → the default length');
  assert.equal(bench.jvmArgs('20 -Dx=y')[0], '-Dhammerclient.benchmark=20', 'nothing but a number ever reaches the command line');
  // The arguments go onto a copy of the launch options – what the launcher keeps is not changed.
  const options = { maxMemory: 4096, extraJVMArgs: ['-XX:+UseG1GC'] };
  const withTest = bench.withBenchmark(options, 10);
  assert.deepEqual(withTest.extraJVMArgs, ['-XX:+UseG1GC', '-Dhammerclient.benchmark=10', '-Dhammerclient.benchmark.quit=true']);
  assert.deepEqual(options, { maxMemory: 4096, extraJVMArgs: ['-XX:+UseG1GC'] });
  assert.deepEqual(bench.withBenchmark({}, 30).extraJVMArgs, bench.jvmArgs(30));
});

test('FPS test: only instances whose Hammer Client can measure – the others get one line of explanation', () => {
  const instance = instanceDir();
  assert.deepEqual(bench.availability(instance, CLIENT), { ok: true, reason: null, note: null });
  assert.deepEqual(bench.availability({ ...instance, loader: 'quilt' }, CLIENT).ok, true);
  const why = (i, client = CLIENT) => bench.availability(i, client);
  assert.deepEqual([why({ ...instance, loader: 'forge' }).reason, why({ ...instance, loader: 'vanilla' }).reason], ['loader', 'loader']);
  assert.match(why({ ...instance, loader: 'forge' }).note, /tylko w instancjach Fabric i Quilt/);
  assert.equal(why({ ...instance, mcVersion: '1.20.1' }).reason, 'game');
  assert.match(why({ ...instance, mcVersion: '1.20.1' }).note, /nie ma wersji dla Minecrafta 1\.20\.1/);
  assert.equal(why(instance, { available: false, version: null, versions: [] }).reason, 'game', 'no mod in this launcher at all');
  assert.equal(why({ ...instance, hammerClient: false }).reason, 'off');
  // Before 2.2.0 the mod ignores the arguments – the game would start and never close by itself.
  assert.equal(why(instance, { ...CLIENT, version: '2.1.9' }).reason, 'old');
  assert.match(why(instance, { ...CLIENT, version: '2.0.0' }).note, /wymaga Hammer Client 2\.2\.0 lub nowszego, a ten launcher ma wersję 2\.0\.0/);
  assert.equal(why(instance, { ...CLIENT, version: null }).reason, 'old', 'the old single jar has no version – too old');
  assert.equal(why(instance, { ...CLIENT, version: '2.2.0' }).ok, true);
  assert.equal(why(instance, { ...CLIENT, version: '2.10.0' }).ok, true, 'versions are compared as numbers');
  // Switched off by hand in the mods list.
  fs.mkdirSync(path.join(instance.dir, 'mods'), { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'mods', 'hammer-client.jar.disabled'), 'x');
  assert.equal(why(instance).reason, 'disabled');
});

test('FPS test: a result is accepted only when it was written after the test started – and the file is always removed', () => {
  const fresh = instanceDir(RESULT);
  const taken = bench.takeResult(fresh, { since: RESULT.finishedAt - 26_000 });
  assert.deepEqual(taken, { ok: true, result: { avg: 240.6, low1: 121.3, min: 88, max: 412.5, frames: 4812, seconds: 20, mc: '1.21.4', version: '2.2.1', finishedAt: RESULT.finishedAt } });
  assert.equal(fs.existsSync(bench.resultFile(fresh)), false, 'deleted after reading');
  assert.deepEqual(bench.takeResult(fresh, { since: 0 }), { ok: false, reason: 'missing' }, 'a result is never read twice');

  // Left from an earlier run: the game was closed early this time, or the world never loaded.
  const stale = instanceDir(RESULT);
  assert.deepEqual(bench.takeResult(stale, { since: RESULT.finishedAt }), { ok: false, reason: 'stale' }, 'finished exactly when the test started is not after it');
  assert.equal(fs.existsSync(bench.resultFile(stale)), false, 'a stale file is removed too');
  assert.deepEqual(bench.takeResult(instanceDir(RESULT), { since: RESULT.finishedAt + 1 }), { ok: false, reason: 'stale' });

  assert.deepEqual(bench.takeResult(instanceDir(), { since: 0 }), { ok: false, reason: 'missing' });

  for (const broken of ['', '{"avg":240', 'null', '[]', '"240"', { ...RESULT, avg: 'dużo' }, { ...RESULT, avg: 0 }, { ...RESULT, low1: -4 }, { ...RESULT, max: 1e9 }, { ...RESULT, min: null }, { ...RESULT, finishedAt: undefined }, { ...RESULT, finishedAt: '1790000000000' }, { avg: 100 }]) {
    const instance = instanceDir(broken);
    assert.deepEqual(bench.takeResult(instance, { since: 0 }), { ok: false, reason: 'malformed' }, JSON.stringify(broken));
    assert.equal(fs.existsSync(bench.resultFile(instance)), false);
  }
  // Something far too big to be the mod's one line is not even read; a folder in the file's place is not a result.
  const huge = instanceDir(`${JSON.stringify(RESULT)}${' '.repeat(40_000)}`);
  assert.deepEqual(bench.takeResult(huge, { since: 0 }), { ok: false, reason: 'malformed' });
  const folder = instanceDir();
  fs.mkdirSync(bench.resultFile(folder), { recursive: true });
  assert.equal(bench.takeResult(folder, { since: 0 }).ok, false);
  // What the launcher does not know is dropped, what is only missing does not spoil the numbers.
  const lean = bench.parseResult(JSON.stringify({ avg: 60.04, low1: 31, min: 12, max: 144, finishedAt: 5, mc: 'x'.repeat(200), extra: { a: 1 } }));
  assert.deepEqual(lean, { avg: 60, low1: 31, min: 12, max: 144, frames: null, seconds: null, mc: 'x'.repeat(40), version: null, finishedAt: 5 });
  // clearResult before a start: an old file can never be taken for the new run.
  const before = instanceDir(RESULT);
  bench.clearResult(before);
  assert.equal(fs.existsSync(bench.resultFile(before)), false);
  bench.clearResult(before); // nothing there – fine
});

test('FPS test: the history keeps the last 20 runs of an instance and shows a run next to the one before', () => {
  const instance = instanceDir();
  assert.deepEqual(bench.history(instance), []);
  const run = (n, more = {}) => ({ at: 1_790_000_000_000 + n * 60_000, seconds: 20, world: 'Nasz świat', worldName: 'Nasz świat', avg: 100 + n, low1: 50 + n, min: 30, max: 300, frames: 2000, mc: '1.21.4', loader: 'fabric', mods: 12, optimization: ['Sodium', 'Lithium'], memoryMb: 4096, client: '2.2.1', ...more });
  const first = bench.record(instance, run(0));
  assert.equal(first.previous, null);
  assert.deepEqual(first.run, run(0));
  const second = bench.record(instance, run(1, { avg: 138, low1: 62 }));
  assert.equal(second.previous.avg, 100);
  assert.deepEqual(bench.compare(second.previous, second.run), { avg: 38, low1: 24, text: '+38% średnio', sameWorld: true });
  for (let n = 2; n < 25; n += 1) bench.record(instance, run(n));
  const all = bench.history(instance);
  assert.equal(all.length, 20);
  assert.deepEqual([all[0].avg, all.at(-1).avg], [124, 105], 'newest first, the oldest five are gone');
  assert.deepEqual(Object.keys(all[0]), ['at', 'seconds', 'world', 'worldName', 'avg', 'low1', 'min', 'max', 'frames', 'mc', 'loader', 'mods', 'optimization', 'memoryMb', 'client']);
  assert.deepEqual([all[0].mods, all[0].optimization, all[0].memoryMb, all[0].mc], [12, ['Sodium', 'Lithium'], 4096, '1.21.4'], 'what the test ran with is remembered');

  // Slower than before, the same, and nothing to compare with.
  assert.deepEqual(bench.compare(run(0, { avg: 200, low1: 100 }), run(1, { avg: 150, low1: 100, world: 'Inny' })), { avg: -25, low1: 0, text: '−25% średnio', sameWorld: false });
  assert.equal(bench.compare(run(0, { avg: 200 }), run(1, { avg: 200.4 })).text, 'bez zmian średnio');
  assert.equal(bench.compare(null, run(1)), null);
  assert.equal(bench.compare(run(0, { avg: 0 }), run(1)), null);

  // The history is a file in the game folder: broken entries are skipped, a broken file is an empty history.
  fs.writeFileSync(bench.historyFile(instance), JSON.stringify({ v: 1, runs: [run(3), { at: 'wczoraj', avg: 10 }, null, { ...run(1), optimization: 'Sodium', mods: -1 }] }));
  assert.deepEqual(bench.history(instance).map((r) => [r.avg, r.mods, r.optimization]), [[103, 12, ['Sodium', 'Lithium']], [101, null, []]]);
  fs.writeFileSync(bench.historyFile(instance), '{ nie json');
  assert.deepEqual(bench.history(instance), []);
  assert.throws(() => bench.record(instance, { at: 1, avg: 'x' }), /nieprawidłowy/);
});

test('FPS test: why there is no result, in plain words', () => {
  const lines = bench.failureReasons('missing');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /zamknięta, zanim pomiar się skończył/);
  assert.match(lines[1], /Świat się nie wczytał/);
  assert.deepEqual(bench.failureReasons('stale'), lines, 'an old result means the same as none');
  assert.match(bench.failureReasons('missing', { crashed: true })[0], /Konsola/);
  assert.match(bench.failureReasons('missing', { stopped: true })[0], /zatrzymana przed końcem/);
  assert.match(bench.failureReasons('malformed')[0], /nie da się odczytać/);
});

test('the optimisation mods of an instance are recognised by slug, mod id or name', () => {
  const items = [
    { title: 'Sodium', slug: 'sodium', modId: 'sodium' },
    { title: 'FerriteCore', modId: 'ferritecore' }, // copied by hand: no slug
    { title: 'Entity Culling', slug: null },
    { title: 'Dynamic FPS', modId: 'dynamic_fps' },
    { title: "Xaero's Minimap", slug: 'xaeros-minimap' },
    { title: 'Fabric API', slug: 'fabric-api', modId: 'fabric-api' },
    { title: 'Concurrent Chunk Management Engine', slug: 'c2me-fabric' },
    { title: 'Sodium', slug: 'sodium' },
  ];
  assert.deepEqual(performanceModsIn(items), ['Sodium', 'FerriteCore', 'Entity Culling', 'Dynamic FPS', 'C2ME']);
  assert.deepEqual(performanceModsIn([]), []);
  assert.deepEqual(performanceModsIn(undefined), []);
});

test('the game manager marks every state event of an FPS test – and none of a normal game', async () => {
  const run = async (benchmark) => {
    const child = new EventEmitter();
    const games = new GameManager({ launchFn: async () => child });
    const states = [];
    games.on('state', (e) => states.push([e.state, e.benchmark]));
    await games.start({ instance: { id: 'hammer', dir: tmpDir() }, options: {}, ...(benchmark === undefined ? {} : { benchmark }) });
    child.emit('exit', 0, null);
    return states;
  };
  assert.deepEqual(await run(true), [['starting', true], ['exited', true]]);
  assert.deepEqual(await run(false), [['starting', undefined], ['exited', undefined]]);
  assert.deepEqual(await run(undefined), [['starting', undefined], ['exited', undefined]]);
});

/* ── through the services: a whole test run with a fake game ── */

const GRACZ = { id: '0123456789abcdef0123456789abcdef', name: 'HammerGracz' };

function fakeChild() {
  const child = new EventEmitter();
  child.kill = () => child.emit('exit', null, 'SIGTERM');
  return child;
}

function setup({ clientVersion = '2.2.1' } = {}) {
  const events = [];
  const launched = [];
  const clientDir = tmpDir('hc');
  fs.writeFileSync(path.join(clientDir, 'versions.json'), JSON.stringify({ version: clientVersion, jars: [{ file: 'hammer-client-1.21.1.jar', minecraft: ['1.21.1'] }] }));
  fs.writeFileSync(path.join(clientDir, 'hammer-client-1.21.1.jar'), 'jar');
  let child = null;
  const s = createServices({
    root: tmpDir(),
    config: { brand: 'HammerShop', server: { address: '' } },
    accounts: { list: () => [GRACZ], launchAuth: async () => ({ ...GRACZ, accessToken: 'token' }) },
    emit: (channel, payload) => events.push({ channel, payload }),
    fetchFn: mockFetch([]),
    clientDir,
    prepareFn: async () => ({ versionId: 'fabric-loader-0.16.10-1.21.1', javaPath: '/java/bin/java', javaMajor: 21 }),
    launchFn: async (options) => {
      launched.push(options);
      child = fakeChild();
      return child;
    },
  });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  fs.mkdirSync(path.join(instance.dir, 'saves', 'Nasz świat'), { recursive: true });
  fs.writeFileSync(path.join(instance.dir, 'mods', 'fabric-api-0.110.jar'), 'api'); // Hammer Client needs it; here it is, so nothing is downloaded
  fs.writeFileSync(path.join(instance.dir, 'mods', 'sodium-0.6.0.jar'), fabricJar({ id: 'sodium', name: 'Sodium', version: '0.6.0' }));
  const of = (channel) => events.filter((e) => e.channel === channel).map((e) => e.payload);
  /** The mod's part: writes the result (unless told not to) and closes the game. */
  const finish = (result, code = 0) => {
    if (result) {
      fs.mkdirSync(path.dirname(bench.resultFile(instance)), { recursive: true });
      fs.writeFileSync(bench.resultFile(instance), JSON.stringify(result));
    }
    child.emit('exit', code, null);
  };
  return { s, instance, events, launched, of, finish, stop: () => child.kill() };
}

test('services: „Uruchom test” starts the game into the world with the test arguments – for that one start only', async () => {
  const { s, instance, launched, of, finish } = setup();
  const info = await s.benchmark.info(instance.id);
  assert.deepEqual([info.available, info.note, info.lengths, info.seconds, info.running, info.history, info.comparison], [true, null, [10, 20, 30], 20, false, [], null]);
  assert.deepEqual(info.worlds.map((w) => w.folder), [], 'a folder without level.dat is not a world to pick');
  const before = fs.readFileSync(path.join(instance.dir, 'instance.json'), 'utf8');

  const started = await s.benchmark.start(instance.id, { world: 'Nasz świat', worldName: 'Nasz świat', seconds: 20 });
  assert.equal(started.benchmark, true);
  assert.deepEqual(launched[0].extraJVMArgs.slice(-2), ['-Dhammerclient.benchmark=20', '-Dhammerclient.benchmark.quit=true']);
  assert.deepEqual(launched[0].extraMCArgs, ['--quickPlaySingleplayer', 'Nasz świat'], 'straight into the world');
  assert.deepEqual(s.benchmark.running(), [instance.id]);
  assert.equal((await s.benchmark.info(instance.id)).running, true);
  assert.deepEqual(of('game:state').map((e) => [e.state, e.benchmark]), [['starting', true]], 'the window is told this start is a test');
  await assert.rejects(s.benchmark.start(instance.id, { world: 'Nasz świat', seconds: 20 }), /już działa/);

  // The mod measured, wrote its file and closed the game.
  finish({ ...RESULT, mc: '1.21.1', finishedAt: Date.now() + 26_000 });
  const [done] = of('benchmark:done');
  assert.equal(done.ok, true);
  assert.deepEqual([done.run.avg, done.run.low1, done.run.min, done.run.max, done.run.seconds, done.run.frames], [240.6, 121.3, 88, 412.5, 20, 4812]);
  assert.deepEqual([done.run.world, done.run.mc, done.run.loader, done.run.mods, done.run.optimization, done.run.client], ['Nasz świat', '1.21.1', 'fabric', 3, ['Sodium'], '2.2.1']);
  assert.equal(done.run.memoryMb, launched[0].maxMemory, 'the memory the test ran with');
  assert.deepEqual([done.previous, done.comparison], [null, null]);
  assert.equal(fs.existsSync(bench.resultFile(instance)), false, 'the result file is gone');
  assert.deepEqual(s.benchmark.running(), []);

  // A test is not a game session: no play time, not "last played", no summary – and nothing of it stays in the instance.
  const after = s.instances.get(instance.id);
  assert.deepEqual([after.playTimeMs, after.lastPlayed], [0, null]);
  assert.equal(fs.readFileSync(path.join(instance.dir, 'instance.json'), 'utf8'), before, 'instance.json is untouched');
  assert.deepEqual(of('play:summary'), []);
  assert.equal(s.play.summary(), null);

  // The next normal start has no trace of the test.
  await s.launch(instance.id, { world: 'Nasz świat' });
  assert.equal(launched[1].extraJVMArgs.some((a) => a.includes('hammerclient.benchmark')), false);
  assert.equal(of('game:state').at(-1).benchmark, undefined);
  finish(null);
  assert.ok(s.instances.get(instance.id).lastPlayed > 0);

  // A second test: next to the first one, with the difference.
  await s.benchmark.start(instance.id, { world: 'Nasz świat', seconds: 10 });
  assert.equal(launched[2].extraJVMArgs.at(-2), '-Dhammerclient.benchmark=10');
  finish({ ...RESULT, avg: 332, low1: 150, finishedAt: Date.now() + 60_000 });
  const second = of('benchmark:done')[1];
  assert.deepEqual([second.ok, second.run.avg, second.previous.avg, second.comparison.text, second.comparison.sameWorld], [true, 332, 240.6, '+38% średnio', true]);
  const card = await s.benchmark.info(instance.id);
  assert.deepEqual([card.history.map((r) => r.avg), card.comparison.text], [[332, 240.6], '+38% średnio']);
});

test('services: a test without a fresh result says „nie został ukończony” – and never counts an old file', async () => {
  const { s, instance, of, finish, stop } = setup();
  const world = { world: 'Nasz świat', seconds: 10 };
  // Closed before the mod wrote anything.
  await s.benchmark.start(instance.id, world);
  finish(null);
  assert.deepEqual(of('benchmark:done')[0], { instanceId: instance.id, ok: false, reason: 'missing', reasons: bench.failureReasons('missing') });
  // A file from before the start (written while the launcher was preparing the game is impossible – it is removed first).
  fs.mkdirSync(path.dirname(bench.resultFile(instance)), { recursive: true });
  fs.writeFileSync(bench.resultFile(instance), JSON.stringify({ ...RESULT, finishedAt: Date.now() - 5000 }));
  await s.benchmark.start(instance.id, world);
  assert.equal(fs.existsSync(bench.resultFile(instance)), false, 'an old result is removed before the game starts');
  finish({ ...RESULT, finishedAt: Date.now() - 5000 });
  assert.deepEqual([of('benchmark:done')[1].ok, of('benchmark:done')[1].reason], [false, 'stale']);
  assert.equal(fs.existsSync(bench.resultFile(instance)), false);
  // Not a result at all.
  await s.benchmark.start(instance.id, world);
  finish('to nie jest wynik');
  assert.equal(of('benchmark:done')[2].reason, 'malformed');
  // Stopped from the launcher, and a crash.
  await s.benchmark.start(instance.id, world);
  stop();
  assert.match(of('benchmark:done')[3].reasons[0], /zatrzymana przed końcem/);
  await s.benchmark.start(instance.id, world);
  finish(null, 1);
  assert.match(of('benchmark:done')[4].reasons[0], /Konsola/);
  // The measurement finished and the game fell over while closing: the numbers still count.
  await s.benchmark.start(instance.id, world);
  finish({ ...RESULT, finishedAt: Date.now() + 20_000 }, 1);
  assert.deepEqual([of('benchmark:done')[5].ok, of('benchmark:done')[5].run.avg], [true, 240.6]);
  assert.equal((await s.benchmark.info(instance.id)).history.length, 1, 'only finished tests are remembered');
  assert.equal(s.instances.get(instance.id).playTimeMs, 0);
});

test('services: the test is refused where it cannot work', async () => {
  const { s, instance, launched } = setup();
  await assert.rejects(s.benchmark.start(instance.id, { seconds: 20 }), /Wybierz świat/);
  await assert.rejects(s.benchmark.start(instance.id, { world: 'Nie ma', seconds: 20 }), /Nie ma już takiego świata/);
  await assert.rejects(s.benchmark.start(instance.id, { world: '../mods', seconds: 20 }), /Nieprawidłowa nazwa świata/);
  await assert.rejects(s.benchmark.start('nie-ma', { world: 'x' }), /Nie ma takiej instancji/);
  const forge = s.instances.create({ name: 'Forge', mcVersion: '1.21.1', loader: 'forge' });
  const info = await s.benchmark.info(forge.id);
  assert.deepEqual([info.available, info.reason, info.worlds], [false, 'loader', []]);
  await assert.rejects(s.benchmark.start(forge.id, { world: 'x' }), /tylko w instancjach Fabric i Quilt/);
  s.instances.update(instance.id, { hammerClient: false });
  await assert.rejects(s.benchmark.start(instance.id, { world: 'Nasz świat' }), /Hammer Client jest wyłączony/);
  assert.equal(launched.length, 0, 'the game never started');
  // A launcher that ships an older mod: it would not measure, so the test is not offered.
  const old = setup({ clientVersion: '2.1.0' });
  assert.equal((await old.s.benchmark.info(old.instance.id)).reason, 'old');
  await assert.rejects(old.s.benchmark.start(old.instance.id, { world: 'Nasz świat' }), /wymaga Hammer Client 2\.2\.0/);
});
