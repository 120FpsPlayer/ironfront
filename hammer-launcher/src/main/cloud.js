'use strict';

/**
 * Chmura (Hammer+) – one small document per Minecraft account, kept by the HammerShop website, so a second
 * computer looks and plays like the first:
 *
 *   { v: 1,
 *     launcher:  { accent, accentColor, heroStyle },                   the launcher's look
 *     instances: { "<instance name>": { servers: [{ name, address }],  the server list
 *                                       hud: { … } } } }               config/hammerclient.json (the mod's HUD layout)
 *
 * Instances are matched by name. Taking a copy makes this computer equal to it for the instances both have:
 * a server that stays keeps its icon, one that is not in the copy goes. An instance whose game is running is
 * never touched – it keeps what it has and is reported as skipped.
 *
 * cloud.json in the launcher folder remembers, per account, the copy this computer last agreed on with the
 * cloud (`base` = its updatedAt, `doc` = the document). That is how the launcher tells "only the cloud changed"
 * (take it) from "both changed" (ask the player which one to keep). No Electron here.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('./store');
const serverList = require('./servers');
const { MAX_BODY } = require('./shopapi');

const VERSION = 1;
const MAX_DOC = MAX_BODY - 6 * 1024; // room for the envelope around the document
const MAX_HUD = 128 * 1024;
const HUD_FILE = path.join('config', 'hammerclient.json');
const LOOK = ['accent', 'accentColor', 'heroStyle'];

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** JSON with the keys of every object in order – two documents with the same content give the same text. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const same = (a, b) => canonical(a) === canonical(b);

/** The shop's updatedAt (unix seconds, milliseconds or a date text) as milliseconds – null when it is neither. */
function toMs(updatedAt) {
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) return updatedAt < 1e11 ? Math.round(updatedAt * 1000) : Math.round(updatedAt);
  const parsed = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** The mod's HUD layout of an instance as an object – null when there is none (or it is being written right now). */
function readHud(instance) {
  try {
    const file = path.join(instance.dir, HUD_FILE);
    if (fs.statSync(file).size > MAX_HUD) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isObject(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * The document of this computer. `skip(instance)` is true for an instance that must not be read now (its game is
 * running): it goes in as it was in `previous`, the document agreed on last time.
 */
function collect({ settings, instances, skip = () => false, previous = null }) {
  const doc = { v: VERSION, launcher: Object.fromEntries(LOOK.map((k) => [k, settings[k]])), instances: {} };
  for (const instance of [...instances].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (Object.hasOwn(doc.instances, instance.name)) continue; // two instances with one name: the first one counts
    if (skip(instance)) {
      if (isObject(previous?.instances?.[instance.name])) doc.instances[instance.name] = previous.instances[instance.name];
      continue;
    }
    const hud = readHud(instance);
    doc.instances[instance.name] = { servers: serverList.list(instance).map(({ name, address }) => ({ name, address })), ...(hud ? { hud } : {}) };
  }
  return doc;
}

/** Refuses a document the cloud would not take, naming what takes the most room. */
function checkSize(doc) {
  const size = Buffer.byteLength(JSON.stringify(doc));
  if (size <= MAX_DOC) return size;
  const biggest = Object.entries(doc.instances ?? {}).map(([name, data]) => [name, Buffer.byteLength(JSON.stringify(data))]).sort((a, b) => b[1] - a[1])[0];
  throw new Error(`Ta kopia jest za duża dla chmury: ${Math.ceil(size / 1024)} KB, a limit to 256 KB.${biggest ? ` Najwięcej zajmuje instancja „${biggest[0]}” (${Math.ceil(biggest[1] / 1024)} KB) – usuń z niej nieużywane serwery albo profile Hammer Client.` : ''}`);
}

/** { instances, servers } – how much a document holds, for the "which copy?" question. */
function summarize(doc) {
  const list = isObject(doc?.instances) ? Object.values(doc.instances).filter(isObject) : [];
  return { instances: list.length, servers: list.reduce((sum, i) => sum + (Array.isArray(i.servers) ? i.servers.length : 0), 0) };
}

/**
 * Makes this computer equal to a document from the cloud. `settings` is the launcher's settings object (get / set).
 * Returns { look (changed), changed: [instance names], skipped: [names of running instances], missing: [names in
 * the copy that are not on this computer] }. Whatever the copy holds is checked like input from the window.
 */
function apply(doc, { settings, instances, skip = () => false }) {
  if (!isObject(doc) || doc.v !== VERSION) throw new Error('Kopia w chmurze pochodzi z nowszego launchera. Zaktualizuj launcher i spróbuj ponownie.');
  const result = { look: false, changed: [], skipped: [], missing: [] };
  if (isObject(doc.launcher)) {
    const before = settings.get();
    const patch = Object.fromEntries(LOOK.filter((k) => typeof doc.launcher[k] === 'string').map((k) => [k, doc.launcher[k]]));
    const after = settings.set(patch);
    result.look = LOOK.some((k) => after[k] !== before[k]);
  }
  const mine = new Map();
  for (const instance of instances) if (!mine.has(instance.name)) mine.set(instance.name, instance);
  for (const [name, data] of Object.entries(isObject(doc.instances) ? doc.instances : {})) {
    const instance = mine.get(name);
    if (!isObject(data)) continue;
    if (!instance) {
      result.missing.push(name);
      continue;
    }
    if (skip(instance)) {
      result.skipped.push(name);
      continue;
    }
    let changed = false;
    if (Array.isArray(data.servers)) changed = serverList.replace(instance, data.servers) || changed;
    if (isObject(data.hud) && Buffer.byteLength(JSON.stringify(data.hud)) <= MAX_HUD && !same(readHud(instance), data.hud)) {
      const file = path.join(instance.dir, HUD_FILE);
      writeJson(file, data.hud);
      changed = true;
    }
    if (changed) result.changed.push(name);
  }
  return result;
}

/**
 * The sync itself. `api` is the shop API (getCloud / putCloud), `local(previous)` gives this computer's document,
 * `take(doc)` applies one (the two functions above, bound by services.js). Every call takes the account's code
 * and its Minecraft UUID. A shop that is not online surfaces as ShopError with offline: true.
 */
function createCloud({ file, api, local, take, now = () => Date.now() }) {
  const load = () => {
    const state = readJson(file, {});
    return isObject(state) && isObject(state.accounts) ? state : { accounts: {} };
  };
  const of = (mc) => {
    const entry = load().accounts[mc];
    return isObject(entry) ? entry : {};
  };
  const remember = (mc, patch) => {
    const state = load();
    state.accounts[mc] = { ...of(mc), ...patch };
    writeJson(file, state);
    return state.accounts[mc];
  };
  const agreed = (mc, updatedAt, doc, direction) => remember(mc, { base: updatedAt, doc, at: now(), direction });
  const conflict = (remote, mine) => ({ conflict: true, updatedAt: remote.updatedAt, at: toMs(remote.updatedAt), cloud: summarize(remote.data), local: summarize(mine) });

  /** { at, direction: 'push' | 'pull', updatedAt } of the last copy this computer and the cloud agreed on – or null. */
  function last(mc) {
    const entry = of(mc);
    return entry.at ? { at: entry.at, direction: entry.direction === 'pull' ? 'pull' : 'push', updatedAt: entry.base ?? null } : null;
  }

  /**
   * "Wyślij do chmury": { ok, at, updatedAt } – or { conflict, … } when the cloud holds a copy this computer has
   * not seen. With `force` the local copy wins over the cloud's `baseUpdatedAt` (the player chose it).
   */
  async function push(code, mc, { force = false, baseUpdatedAt } = {}) {
    const entry = of(mc);
    const doc = local(entry.doc ?? null);
    checkSize(doc);
    const base = force ? baseUpdatedAt ?? entry.base : entry.base;
    if (!force && base == null) {
      // The first copy from this computer: never write over one that another computer left there.
      const remote = await api.getCloud(code).catch((err) => (err?.offline && err.status === 404 ? null : Promise.reject(err)));
      if (remote && !same(remote.data, doc)) return conflict(remote, doc);
      if (remote) {
        const saved = agreed(mc, remote.updatedAt, doc, 'push'); // the cloud already holds exactly this
        return { ok: true, at: saved.at, updatedAt: remote.updatedAt };
      }
    }
    try {
      const { updatedAt } = await api.putCloud(code, { data: doc, baseUpdatedAt: base ?? undefined });
      const saved = agreed(mc, updatedAt, doc, 'push');
      return { ok: true, at: saved.at, updatedAt };
    } catch (err) {
      if (err?.conflict?.data) return conflict(err.conflict, doc);
      throw err;
    }
  }

  /**
   * "Pobierz z chmury": { ok, at, updatedAt, …what apply() changed } – or { empty: true } when nothing is there yet.
   * When an instance had to be skipped (its game is running) the copy does not count as taken in full: the next
   * start fetches it again, and a send before that asks first instead of writing over what was skipped.
   */
  async function pull(code, mc) {
    const remote = await api.getCloud(code);
    if (!remote) return { empty: true };
    const result = take(remote.data);
    const mine = local(of(mc).doc ?? null);
    const saved = result.skipped?.length ? remember(mc, { doc: mine, at: now(), direction: 'pull' }) : agreed(mc, remote.updatedAt, mine, 'pull');
    return { ok: true, at: saved.at, updatedAt: remote.updatedAt, ...result };
  }

  /**
   * Automatic sync at the start of the launcher: takes the cloud's copy when only the cloud changed.
   * { upToDate } | { empty } | { ok, … } | { conflict, … } (both changed, or the first sync of this computer).
   */
  async function startup(code, mc) {
    const remote = await api.getCloud(code);
    if (!remote) return { empty: true };
    const entry = of(mc);
    if (entry.base != null && String(entry.base) === String(remote.updatedAt)) return { upToDate: true };
    const mine = local(entry.doc ?? null);
    if (same(remote.data, mine)) {
      agreed(mc, remote.updatedAt, mine, entry.direction ?? 'pull');
      return { upToDate: true };
    }
    if (!entry.doc || !same(entry.doc, mine)) return conflict(remote, mine);
    return pull(code, mc);
  }

  /** Automatic sync after a game session: sends the copy when something changed here. */
  async function afterSession(code, mc) {
    const entry = of(mc);
    if (entry.base != null && entry.doc && same(entry.doc, local(entry.doc))) return { upToDate: true };
    return push(code, mc);
  }

  return { last, push, pull, startup, afterSession, state: of, remember };
}

module.exports = { createCloud, collect, apply, checkSize, summarize, canonical, toMs, readHud, MAX_DOC, HUD_FILE };
