'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { summarize, worthShowing, sessionScreenshots, MIN_SESSION_MS } = require('../src/main/playsummary');
const bench = require('../src/main/benchmark');
const { createServices } = require('../src/main/services');
const { tmpDir, mockFetch } = require('./helpers');

const MIN = 60_000;
const END = Date.UTC(2026, 10, 11, 18, 0, 0);

/** A screenshot file "taken" at `at` (its modification time). */
function shot(instance, name, at) {
  const dir = path.join(instance.dir, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), 'png');
  fs.utimesSync(path.join(dir, name), at / 1000, at / 1000);
}

test('play summary: only for a session that ended normally and lasted at least a minute', () => {
  assert.equal(MIN_SESSION_MS, 60_000);
  assert.equal(worthShowing({ state: 'exited', playedMs: 60_000 }), true);
  assert.equal(worthShowing({ state: 'exited', playedMs: 3 * 3600_000 }), true);
  assert.equal(worthShowing({ state: 'exited', playedMs: 59_999 }), false, 'shorter than a minute');
  assert.equal(worthShowing({ state: 'exited', playedMs: 0 }), false);
  assert.equal(worthShowing({ state: 'exited' }), false);
  assert.equal(worthShowing({ state: 'crashed', playedMs: 2 * 3600_000 }), false, 'a crash gets the crash explanation instead');
  assert.equal(worthShowing({ state: 'exited', playedMs: 5 * MIN, benchmark: true }), false, 'an FPS test is not a game session');
  assert.equal(worthShowing({ state: 'exited', playedMs: 5 * MIN, enabled: false }), false, 'switched off in Ustawienia');
  assert.equal(worthShowing({ state: 'running', playedMs: 5 * MIN }), false);
  assert.equal(worthShowing(), false);
});

test('play summary: how long, the total in the instance and the screenshots taken during the session', () => {
  const instance = { id: 'hammer', name: 'Hammer', dir: tmpDir(), playTimeMs: 47 * 60 * MIN };
  shot(instance, 'przed-sesja.png', END - 90 * MIN); // an older one
  shot(instance, 'pierwszy.png', END - 70 * MIN);
  shot(instance, 'drugi.jpg', END - 30 * MIN);
  shot(instance, 'ostatni.png', END - 1000);
  shot(instance, 'po-sesji.png', END + 10 * MIN);
  shot(instance, 'notatki.txt', END - 30 * MIN); // not a picture
  const summary = summarize({ instance, state: 'exited', playedMs: 72 * MIN, endedAt: END, suggestBenchmark: true });
  assert.deepEqual([summary.instanceId, summary.name, summary.playedMs, summary.totalMs, summary.endedAt, summary.suggestBenchmark], ['hammer', 'Hammer', 72 * MIN, 47 * 60 * MIN, END, true]);
  assert.equal(summary.screenshots.count, 3);
  assert.deepEqual(summary.screenshots.shots.map((s) => s.file), ['ostatni.png', 'drugi.jpg', 'pierwszy.png'], 'newest first');
  assert.match(summary.screenshots.shots[0].url, /^file:\/\/.*screenshots\/ostatni\.png$/);

  // Many screenshots: all are counted, a few are shown.
  for (let n = 0; n < 9; n += 1) shot(instance, `seria-${n}.png`, END - (40 + n) * MIN);
  const many = sessionScreenshots(instance, { from: END - 72 * MIN, to: END });
  assert.deepEqual([many.count, many.shots.length], [12, 5]);

  // No screenshots folder at all, and the first session of an instance.
  const fresh = summarize({ instance: { id: 'nowa', name: 'Nowa', dir: tmpDir() }, state: 'exited', playedMs: 5 * MIN, endedAt: END });
  assert.deepEqual([fresh.screenshots, fresh.totalMs, fresh.suggestBenchmark], [{ count: 0, shots: [] }, 5 * MIN, false]);

  assert.equal(summarize({ instance, state: 'exited', playedMs: 30_000, endedAt: END }), null);
  assert.equal(summarize({ instance, state: 'crashed', playedMs: 72 * MIN, endedAt: END }), null);
  assert.equal(summarize({ instance, state: 'exited', playedMs: 72 * MIN, endedAt: END, benchmark: true }), null);
  assert.equal(summarize({ instance, state: 'exited', playedMs: 72 * MIN, endedAt: END, enabled: false }), null);
  assert.equal(summarize({ instance: null, state: 'exited', playedMs: 72 * MIN }), null);
});

function setup({ clientVersion = '2.2.1', now = END } = {}) {
  const events = [];
  const clientDir = tmpDir('hc');
  fs.writeFileSync(path.join(clientDir, 'versions.json'), JSON.stringify({ version: clientVersion, jars: [{ file: 'hc.jar', minecraft: ['1.21.1'] }] }));
  fs.writeFileSync(path.join(clientDir, 'hc.jar'), 'jar');
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop' }, accounts: { list: () => [] }, emit: (channel, payload) => events.push({ channel, payload }), fetchFn: mockFetch([]), clientDir, now: () => now });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  const ended = (state, playedMs, more = {}) => s.games.emit('state', { instanceId: instance.id, state, code: state === 'exited' ? 0 : 1, playedMs, ...more });
  const summaries = () => events.filter((e) => e.channel === 'play:summary').map((e) => e.payload);
  return { s, instance, events, ended, summaries };
}

test('services: after a normal session the start screen gets its summary – with the total play time of the instance', () => {
  const { s, instance, ended, summaries } = setup();
  s.instances.patchInternal(instance.id, { playTimeMs: 3 * 60 * MIN });
  shot(instance, 'zamek.png', END - 20 * MIN);
  assert.equal(s.play.summary(), null);

  ended('exited', 72 * MIN);
  assert.equal(s.instances.get(instance.id).playTimeMs, 3 * 60 * MIN + 72 * MIN, 'the session is added to the total kept in the instance');
  const [summary] = summaries();
  assert.deepEqual([summary.instanceId, summary.name, summary.playedMs, summary.totalMs, summary.screenshots.count], [instance.id, 'Hammer', 72 * MIN, 3 * 60 * MIN + 72 * MIN, 1]);
  assert.equal(summary.suggestBenchmark, true, 'Hammer Client can measure here and never has');
  assert.deepEqual(s.play.summary(), summary, 'kept for the start screen until it is dismissed');
  assert.equal(s.play.dismiss(), true);
  assert.equal(s.play.summary(), null);

  // Too short, crashed, an FPS test: nothing new (the play time of real sessions still counts).
  ended('exited', 40_000);
  ended('crashed', 30 * MIN);
  ended('exited', 30 * MIN, { benchmark: true });
  assert.equal(summaries().length, 1);
  assert.equal(s.play.summary(), null);
  assert.equal(s.instances.get(instance.id).playTimeMs, 3 * 60 * MIN + 72 * MIN + 40_000 + 30 * MIN, 'a test adds no play time');

  // Once the FPS test has been run for this instance, the pointer to it is gone.
  bench.record(s.instances.get(instance.id), { at: END, avg: 120, low1: 60, min: 30, max: 200 });
  ended('exited', 2 * MIN);
  assert.equal(summaries()[1].suggestBenchmark, false);

  // Switched off in Ustawienia: no card, the play time is counted as always.
  s.settings.set({ playSummary: false });
  s.play.dismiss();
  const before = s.instances.get(instance.id).playTimeMs;
  ended('exited', 10 * MIN);
  assert.equal(summaries().length, 2);
  assert.equal(s.play.summary(), null);
  assert.equal(s.instances.get(instance.id).playTimeMs, before + 10 * MIN);
  s.settings.set({ playSummary: true });
  ended('exited', 10 * MIN);
  assert.equal(summaries().length, 3);
});

test('services: no pointer to the FPS test where it cannot run', () => {
  for (const [what, prepare] of [
    ['an old Hammer Client', () => setup({ clientVersion: '2.0.0' })],
    ['Forge', () => {
      const env = setup();
      env.s.instances.update(env.instance.id, { loader: 'forge' });
      return env;
    }],
    ['Hammer Client off', () => {
      const env = setup();
      env.s.instances.update(env.instance.id, { hammerClient: false });
      return env;
    }],
  ]) {
    const { ended, summaries } = prepare();
    ended('exited', 5 * MIN);
    assert.deepEqual(summaries().map((x) => x.suggestBenchmark), [false], what);
  }
});

test('settings: the three new switches are on by default and survive only as booleans', () => {
  const { s } = setup();
  const defaults = s.settings.get();
  assert.deepEqual([defaults.playSummary, defaults.modUpdateCheck, defaults.screenshotShareAsk], [true, true, true]);
  const changed = s.settings.set({ playSummary: 0, modUpdateCheck: '', screenshotShareAsk: null });
  assert.deepEqual([changed.playSummary, changed.modUpdateCheck, changed.screenshotShareAsk], [false, false, false]);
  assert.deepEqual(Object.keys(s.settings.set({ nieznane: 1 })).includes('nieznane'), false);
});
