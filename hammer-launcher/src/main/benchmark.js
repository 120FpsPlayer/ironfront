'use strict';

/**
 * Test FPS. The measuring is done by the bundled Hammer Client (2.2.0 and newer): started with
 *
 *   -Dhammerclient.benchmark=<seconds>   (5–180)
 *   -Dhammerclient.benchmark.quit=true
 *
 * straight into a singleplayer world, the mod waits for the world, measures every frame for that long, writes
 * <instance>/config/hammerclient/benchmark.json and closes the game. The launcher's part is here: the two
 * arguments (for that one start only – they are never stored in the instance), reading the result (only one that
 * was written after the test was started; the file is deleted afterwards) and a history of the last runs of each
 * instance in <instance>/.hammer/benchmarks.json, so a player can compare before and after „Zoptymalizuj”.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./store');
const { compareVersions } = require('./hammerclient');

const MIN_CLIENT = '2.2.0'; // the first Hammer Client that measures
const LENGTHS = [10, 20, 30]; // what the interface offers, in seconds
const DEFAULT_SECONDS = 20;
const MIN_SECONDS = 5;
const MAX_SECONDS = 180;
const KEEP = 20; // runs remembered per instance
const MAX_RESULT_BYTES = 16 * 1024; // the mod writes one short line
const MAX_FPS = 100_000;

/** A test length the mod accepts: a whole number of seconds from 5 to 180 (20 when it is not a number at all). */
function clampSeconds(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && value !== null && value !== '' ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, n)) : DEFAULT_SECONDS;
}

/** The extra JVM arguments of a test start. */
function jvmArgs(seconds) {
  return [`-Dhammerclient.benchmark=${clampSeconds(seconds)}`, '-Dhammerclient.benchmark.quit=true'];
}

/** Launch options with the test arguments added – a copy; neither the options given nor the instance change. */
function withBenchmark(options, seconds) {
  return { ...options, extraJVMArgs: [...(options.extraJVMArgs ?? []), ...jvmArgs(seconds)] };
}

const resultFile = (instance) => path.join(instance.dir, 'config', 'hammerclient', 'benchmark.json');
const historyFile = (instance) => path.join(instance.dir, '.hammer', 'benchmarks.json');

/** The bundled mod is new enough to measure. */
function clientMeasures(client) {
  return Boolean(client?.available && client.version && compareVersions(client.version, MIN_CLIENT) >= 0);
}

const NOTES = {
  loader: 'Test FPS mierzy Hammer Client, a on działa tylko w instancjach Fabric i Quilt.',
  game: (i) => `Hammer Client nie ma wersji dla Minecrafta ${i.mcVersion}, więc w tej instancji nie da się zmierzyć FPS.`,
  off: 'W tej instancji Hammer Client jest wyłączony – włącz go w edycji instancji, żeby zmierzyć FPS.',
  disabled: 'Hammer Client jest wyłączony na liście modów tej instancji – włącz go w zakładce Mody, żeby zmierzyć FPS.',
  old: (i, client) => `Test FPS wymaga Hammer Client ${MIN_CLIENT} lub nowszego${client?.version ? `, a ten launcher ma wersję ${client.version}` : ''}. Zaktualizuj launcher.`,
};

/**
 * Whether the FPS test can run in an instance: { ok: true } or { ok: false, reason, note } – `note` is the one
 * line the interface shows instead of the form. `client` is what loadHammerClient() returned.
 */
function availability(instance, client) {
  const no = (reason) => ({ ok: false, reason, note: typeof NOTES[reason] === 'function' ? NOTES[reason](instance, client) : NOTES[reason] });
  if (!['fabric', 'quilt'].includes(instance?.loader)) return no('loader');
  if (!client?.available || !client.versions.includes(instance.mcVersion)) return no('game');
  if (instance.hammerClient === false) return no('off');
  if (fs.existsSync(path.join(instance.dir, 'mods', 'hammer-client.jar.disabled'))) return no('disabled');
  if (!clientMeasures(client)) return no('old');
  return { ok: true, reason: null, note: null };
}

const fps = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MAX_FPS ? Math.round(v * 10) / 10 : null);
const short = (v, max = 40) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '') || null;

/**
 * What the mod wrote, checked: { avg, low1, min, max, frames, seconds, mc, version, finishedAt } – or null when
 * it is not a result (not JSON, numbers missing or impossible).
 */
function parseResult(text) {
  let raw;
  try {
    raw = JSON.parse(String(text));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const [avg, low1, min, max] = [fps(raw.avg), fps(raw.low1), fps(raw.min), fps(raw.max)];
  const finishedAt = typeof raw.finishedAt === 'number' && Number.isFinite(raw.finishedAt) && raw.finishedAt > 0 ? Math.round(raw.finishedAt) : null;
  if (avg == null || low1 == null || min == null || max == null || finishedAt == null || !(avg > 0)) return null;
  const frames = Number.isInteger(raw.frames) && raw.frames >= 0 ? raw.frames : null;
  const seconds = typeof raw.seconds === 'number' && Number.isFinite(raw.seconds) && raw.seconds > 0 && raw.seconds <= 3600 ? Math.round(raw.seconds * 10) / 10 : null;
  return { avg, low1, min, max, frames, seconds, mc: short(raw.mc), version: short(raw.version), finishedAt };
}

/** Removes a result left from an earlier run (before a test starts). */
function clearResult(instance) {
  try {
    fs.rmSync(resultFile(instance), { force: true });
  } catch {
    // cannot be removed – the result check still looks at its finishedAt
  }
}

/**
 * Reads the result of the test that was started at `since` (milliseconds) and deletes the file – whatever was in
 * it. { ok: true, result } or { ok: false, reason }: 'missing' (no file – the game was closed before the end, or
 * the world never loaded), 'stale' (a result from before this test), 'malformed'.
 */
function takeResult(instance, { since = 0 } = {}) {
  const file = resultFile(instance);
  let text = null;
  let found = false;
  try {
    const stat = fs.lstatSync(file);
    found = true;
    if (stat.isFile() && stat.size <= MAX_RESULT_BYTES) text = fs.readFileSync(file, 'utf8');
  } catch {
    // no file
  }
  if (found) clearResult(instance);
  if (!found) return { ok: false, reason: 'missing' };
  const result = text == null ? null : parseResult(text);
  if (!result) return { ok: false, reason: 'malformed' };
  if (!(result.finishedAt > since)) return { ok: false, reason: 'stale' };
  return { ok: true, result };
}

/** One remembered run, checked – null when it is not one (the history file is the player's to break). */
function cleanRun(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const [avg, low1, min, max] = [fps(raw.avg), fps(raw.low1), fps(raw.min), fps(raw.max)];
  const at = typeof raw.at === 'number' && Number.isFinite(raw.at) && raw.at > 0 ? Math.round(raw.at) : null;
  if (avg == null || low1 == null || min == null || max == null || at == null || !(avg > 0)) return null;
  const count = (v, limit) => (Number.isInteger(v) && v >= 0 && v <= limit ? v : null);
  return {
    at,
    seconds: typeof raw.seconds === 'number' && raw.seconds > 0 && raw.seconds <= 3600 ? raw.seconds : null,
    world: short(raw.world, 255),
    worldName: short(raw.worldName, 80),
    avg,
    low1,
    min,
    max,
    frames: count(raw.frames, 1e9),
    mc: short(raw.mc),
    loader: short(raw.loader, 16),
    mods: count(raw.mods, 100_000),
    optimization: Array.isArray(raw.optimization) ? raw.optimization.map((n) => short(n)).filter(Boolean).slice(0, 40) : [],
    memoryMb: count(raw.memoryMb, 1_048_576),
    client: short(raw.client, 32),
  };
}

/** The remembered runs of an instance, newest first (at most 20). */
function history(instance) {
  const stored = readJson(historyFile(instance), null);
  const runs = Array.isArray(stored?.runs) ? stored.runs.map(cleanRun).filter(Boolean) : [];
  return runs.sort((a, b) => b.at - a.at).slice(0, KEEP);
}

/**
 * Adds a run to the history (the newest 20 stay). Returns { run, previous, runs } – `previous` is the run that
 * was the newest until now, the one the new result is shown next to.
 */
function record(instance, run) {
  const entry = cleanRun(run);
  if (!entry) throw new Error('Ten wynik testu FPS jest nieprawidłowy.');
  const before = history(instance);
  const runs = [entry, ...before].sort((a, b) => b.at - a.at).slice(0, KEEP);
  writeJson(historyFile(instance), { v: 1, runs });
  return { run: entry, previous: before[0] ?? null, runs };
}

const percent = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * A run next to the one before it: { avg, low1 (change in per cent), text ("+38% średnio"), sameWorld } – null
 * without something to compare with. Results depend on the place in the world, hence `sameWorld`.
 */
function compare(previous, run) {
  const avg = previous && run ? percent(run.avg, previous.avg) : null;
  if (avg == null) return null;
  return { avg, low1: percent(run.low1, previous.low1), text: avg === 0 ? 'bez zmian średnio' : `${signed(avg)}% średnio`, sameWorld: Boolean(previous.world && previous.world === run.world) };
}

/** Why a test left no result, as the lines the interface shows under „Test nie został ukończony”. */
function failureReasons(reason, { crashed = false, stopped = false } = {}) {
  if (crashed) return ['Gra wyłączyła się w trakcie testu – co się stało, wyjaśnia zakładka Konsola.'];
  if (stopped) return ['Gra została zatrzymana przed końcem pomiaru.'];
  if (reason === 'malformed') return ['Hammer Client zapisał wynik, którego nie da się odczytać. Uruchom test jeszcze raz.'];
  return [
    'Gra została zamknięta, zanim pomiar się skończył – po starcie nie zamykaj jej, zamknie się sama.',
    'Świat się nie wczytał (albo wczytywał się bardzo długo) – otwórz go raz zwykłym „Graj” i spróbuj ponownie.',
  ];
}

module.exports = { clampSeconds, jvmArgs, withBenchmark, resultFile, historyFile, clientMeasures, availability, parseResult, clearResult, takeResult, cleanRun, history, record, compare, failureReasons, MIN_CLIENT, LENGTHS, DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS, KEEP };
