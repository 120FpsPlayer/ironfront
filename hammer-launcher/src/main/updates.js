'use strict';

/**
 * Aktualizacje modów (and of resource packs and shader packs from Modrinth):
 *   - updating with a way back: every update first makes a restore point (restorepoints.js), and „Cofnij ostatnią
 *     aktualizację” reverses it exactly,
 *   - the quiet check in the background: when the launcher starts and every six hours, for the badge on an
 *     instance and the card on the start screen. A failed check says nothing – the last answer simply stays.
 */

const fs = require('node:fs');
const path = require('node:path');
const { primaryFile } = require('./modrinth');
const { safeName } = require('./net');
const { fileReason } = require('./fsutil');
const restorePoints = require('./restorepoints');
const { CONTENT_DIRS } = require('./instances');

const TYPES = Object.keys(CONTENT_DIRS); // mod, resourcepack, shader
const SIX_HOURS = 6 * 60 * 60 * 1000;
const FIRST_AFTER = 20_000; // the first check waits until the launcher has started

const key = (type, file) => `${type}/${file}`;

function createUpdates({ content, modrinth }) {
  /**
   * Everything in an instance that has a newer version on Modrinth for its game version and loader:
   * [{ type, file, title, current, latest: { id, versionNumber } }].
   */
  async function check(instance, types = TYPES) {
    const out = [];
    for (const type of types) for (const u of await content.checkUpdates(instance, type)) out.push({ type, ...u });
    return out;
  }

  /**
   * Replaces files with their newer versions – through a restore point, so it can be undone. Everything is
   * looked up on Modrinth before the first file is touched; a file whose download fails keeps its old version.
   * `items` = what check() returned (or part of it). Returns
   * { point (id of the restore point, null when nothing was replaced), updated: [{ type, file, title, from, to }], failed: [{ title, error }] }
   * – `file` is the name the file had before the update.
   */
  async function apply(instance, items, { onProgress, now } = {}) {
    const failed = [];
    const wanted = new Map();
    for (const item of items ?? []) {
      if (!TYPES.includes(item?.type) || typeof item.file !== 'string' || typeof item.latest?.id !== 'string') continue;
      try {
        if (safeName(item.file) !== item.file) continue; // a plain file name of the content folder, never a path
      } catch {
        continue;
      }
      wanted.set(key(item.type, item.file), item);
    }
    if (!wanted.size) return { point: null, updated: [], failed };
    const versions = new Map((await modrinth.versionsByIds([...new Set([...wanted.values()].map((i) => i.latest.id))])).map((v) => [v.id, v]));
    // Names and icons are a nicety – without them the update still goes through.
    const projects = new Map((await modrinth.projects([...new Set([...versions.values()].map((v) => v.project_id))]).catch(() => [])).map((p) => [p.id, p]));
    const plan = new Map();
    const entries = [];
    for (const item of wanted.values()) {
      const title = String(item.title ?? item.file);
      const version = versions.get(item.latest.id);
      const file = primaryFile(version);
      let name = null;
      try {
        name = file ? safeName(file.filename) : null;
      } catch {
        name = null;
      }
      if (!version || !name) {
        failed.push({ title, error: 'Tej wersji nie ma już na Modrinth – sprawdź aktualizacje jeszcze raz.' });
        continue;
      }
      const folder = content.folder(instance, item.type);
      if (!fs.existsSync(path.join(folder, item.file)) && !fs.existsSync(path.join(folder, `${item.file}.disabled`))) {
        failed.push({ title, error: 'Nie ma już tego pliku – odśwież listę.' });
        continue;
      }
      const index = content.indexEntry(instance, item.type, item.file);
      const project = projects.get(version.project_id) ?? { title: index?.title ?? title, icon_url: index?.iconUrl ?? null, slug: index?.slug ?? null, description: index?.description ?? '' };
      plan.set(key(item.type, item.file), { version, project });
      entries.push({ type: item.type, title: project.title ?? title, old: { file: item.file, versionNumber: index?.versionNumber ?? item.current ?? null, index }, new: { file: name, versionId: version.id, versionNumber: version.version_number } });
    }
    if (!entries.length) return { point: null, updated: [], failed };
    const res = await restorePoints.replace(
      instance,
      entries,
      async (entry) => {
        const { version, project } = plan.get(key(entry.type, entry.old.file));
        const name = await content.installVersion(instance, entry.type, version, project);
        if (name !== entry.old.file) content.setIndexEntry(instance, entry.type, entry.old.file, null);
        if (entry.old.disabled) content.setEnabled(instance, entry.type, name, false); // what was switched off stays off
      },
      { now, onStep: (entry, n, total) => onProgress?.({ label: `Aktualizacja: ${entry.title}`, done: n, total }) },
    );
    return {
      point: res.id,
      updated: res.done.map((e) => ({ type: e.type, file: e.old.file, title: e.title, from: e.old.versionNumber, to: e.new.versionNumber })),
      // A system error (the file is held by another program, the disk is full) is said in Polish, like everywhere else.
      failed: [...failed, ...res.failed.map(({ entry, error }) => ({ title: entry.title, error: typeof error?.code === 'string' ? `nie udało się podmienić pliku – ${fileReason(error)}.` : (error?.message ?? String(error)) }))],
    };
  }

  /**
   * „Cofnij ostatnią aktualizację”: the old files go back, the new ones are removed, and the list remembers the
   * old versions again. Returns { point, restored: [{ type, title, from (the version removed), to (the version that is back) }] }.
   */
  function undo(instance) {
    let res;
    try {
      res = restorePoints.restore(instance);
    } catch (err) {
      // Whatever was put back so far stays; the rest is still in the restore point – the undo can simply be run again.
      if (typeof err?.code !== 'string') throw err;
      throw new Error(`Nie udało się cofnąć całej aktualizacji: ${fileReason(err)}. Zamknij programy, które mogą używać tych plików, i spróbuj ponownie.`, { cause: err });
    }
    for (const e of res.restored) {
      if (e.new.file !== e.old.file) content.setIndexEntry(instance, e.type, e.new.file, null);
      if (e.old.index) content.setIndexEntry(instance, e.type, e.old.file, e.old.index);
    }
    return { point: res.id, restored: res.restored.map((e) => ({ type: e.type, title: e.title, from: e.new.versionNumber, to: e.old.versionNumber })) };
  }

  return { check, apply, undo, points: (instance) => restorePoints.list(instance) };
}

/**
 * The background check. `list()` gives the instances, `check(instance)` what has an update; `enabled()` is the
 * setting. Instances that came from a modpack are left alone here – a pack is updated as a whole – and can
 * still be checked by hand in the Mody tab. `onChange(status)` is called whenever the answer may have changed.
 */
function createUpdateWatch({ list, check, enabled = () => true, onChange = () => {}, now = () => Date.now(), every = SIX_HOURS, firstAfter = FIRST_AFTER, timers = { setTimeout, clearTimeout } }) {
  const found = new Map(); // instance id → [{ type, file, title, current, latest }]
  let timer = null;
  let running = null;
  let checkedAt = null;

  /** { checkedAt, total, instances: [{ id, name, count }] } – only instances that have something to update. */
  function status() {
    const rows = list()
      .map((i) => ({ id: i.id, name: i.name, count: found.get(i.id)?.length ?? 0 }))
      .filter((r) => r.count > 0);
    return { checkedAt, total: rows.reduce((sum, r) => sum + r.count, 0), instances: rows };
  }
  const changed = () => {
    try {
      onChange(status());
    } catch {
      // a listener's problem is not the check's
    }
  };

  /** One round over every instance. Never throws; returns the status. */
  function run() {
    if (!enabled()) return Promise.resolve(status());
    if (running) return running; // one round at a time
    const round = async () => {
      const instances = list();
      for (const id of [...found.keys()]) if (!instances.some((i) => i.id === id)) found.delete(id);
      for (const instance of instances) {
        if (instance.modpack) continue;
        try {
          found.set(instance.id, await check(instance));
        } catch {
          // offline, Modrinth busy – quiet; what was known before stays
        }
        if (!enabled()) break; // switched off in the middle
      }
      if (enabled()) checkedAt = now();
      else found.clear();
      changed();
      return status();
    };
    running = round()
      .catch(() => status())
      .finally(() => {
        running = null;
      });
    return running;
  }

  /** Arms the timer: the first round shortly after the start, then one every six hours. */
  function start() {
    stop();
    const arm = (ms) => {
      timer = timers.setTimeout(() => {
        run().catch(() => null);
        arm(every);
      }, ms);
      timer?.unref?.();
    };
    arm(firstAfter);
  }
  function stop() {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
  }

  return {
    run,
    start,
    stop,
    status,
    /** What is known about one instance (a copy). */
    items: (id) => (found.get(id) ?? []).map((u) => ({ ...u, latest: { ...u.latest } })),
    /** A check made by hand, or what is left after an update. */
    set(id, items) {
      found.set(id, [...(items ?? [])]);
      changed();
    },
    /** The setting was switched off: nothing is shown any more. */
    clear() {
      found.clear();
      checkedAt = null;
      changed();
    },
  };
}

module.exports = { createUpdates, createUpdateWatch, TYPES, SIX_HOURS, FIRST_AFTER };
