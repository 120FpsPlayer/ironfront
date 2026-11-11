'use strict';

/**
 * Podsumowanie gry – what the start screen shows after a game session that ended normally: how long it lasted,
 * the total time in that instance and the screenshots taken during it. Sessions shorter than a minute say
 * nothing, crashed ones neither (they get the crash explanation in the Konsola tab), and an FPS test is not a
 * game session at all.
 */

const { listScreenshots } = require('./gallery');

const MIN_SESSION_MS = 60_000;
const SLACK_MS = 2000; // file times are coarse on some disks (FAT: two seconds)
const MAX_THUMBS = 5;

/** Whether a session that just ended gets a summary. */
function worthShowing({ state, playedMs, benchmark = false, enabled = true } = {}) {
  return Boolean(enabled) && !benchmark && state === 'exited' && Number(playedMs) >= MIN_SESSION_MS;
}

/** The screenshots of an instance taken between `from` and `to` (milliseconds): { count, shots } – newest first, a few of them. */
function sessionScreenshots(instance, { from, to }) {
  const taken = listScreenshots(null, [instance]).filter((s) => s.takenAt >= from - SLACK_MS && s.takenAt <= to + SLACK_MS);
  return { count: taken.length, shots: taken.slice(0, MAX_THUMBS).map((s) => ({ file: s.file, url: s.url, takenAt: s.takenAt })) };
}

/**
 * The summary of a session, or null when there is nothing to show.
 *   instance        the instance as it is after the session (playTimeMs already counts it)
 *   state           how the game ended: 'exited' | 'crashed'
 *   playedMs        how long the session lasted; endedAt – when it ended
 *   benchmark       the session was an FPS test
 *   enabled         the setting „Podsumowanie po grze”
 *   suggestBenchmark  the instance can run the FPS test and never has
 * Returns { instanceId, name, playedMs, totalMs, endedAt, screenshots: { count, shots }, suggestBenchmark }.
 */
function summarize({ instance, state, playedMs, endedAt = Date.now(), benchmark = false, enabled = true, suggestBenchmark = false } = {}) {
  if (!instance || !worthShowing({ state, playedMs, benchmark, enabled })) return null;
  return {
    instanceId: instance.id,
    name: instance.name,
    playedMs,
    totalMs: Math.max(playedMs, instance.playTimeMs ?? 0),
    endedAt,
    screenshots: sessionScreenshots(instance, { from: endedAt - playedMs, to: endedAt }),
    suggestBenchmark: Boolean(suggestBenchmark),
  };
}

module.exports = { summarize, worthShowing, sessionScreenshots, MIN_SESSION_MS, MAX_THUMBS };
