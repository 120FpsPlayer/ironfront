'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createModrinth } = require('../src/main/modrinth');
const { createContent } = require('../src/main/content');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { createUpdates, createUpdateWatch, SIX_HOURS, FIRST_AFTER } = require('../src/main/updates');
const { createServices } = require('../src/main/services');
const { tmpDir, fabricJar, mrVersion } = require('./helpers');

// (Each file is made once: a zip made a second later has other bytes – and another checksum.)
const BODIES = new Map();
const version = (id, projectId, number, name, body, loaders = ['fabric']) => {
  BODIES.set(name, body);
  return mrVersion({ id, projectId, number, loaders, file: { name, body } });
};
const jar = (id, name, number) => fabricJar({ id, name, version: number });
const SODIUM_0 = version('sod0', 'AANobbMI', '0.6.0', 'sodium-0.6.0.jar', jar('sodium', 'Sodium', '0.6.0'));
const SODIUM_1 = version('sod1', 'AANobbMI', '0.6.1', 'sodium-0.6.1.jar', jar('sodium', 'Sodium', '0.6.1'));
const LITHIUM_0 = version('lit0', 'gvQqBUqZ', '0.14.0', 'lithium-0.14.0.jar', jar('lithium', 'Lithium', '0.14.0'));
const LITHIUM_1 = version('lit1', 'gvQqBUqZ', '0.15.0', 'lithium-0.15.0.jar', jar('lithium', 'Lithium', '0.15.0'));
const PACK_0 = version('fa0', 'YL57xq9U', '1', 'Faithful 1.zip', Buffer.from('faithful 1'), ['minecraft']);
const PACK_1 = version('fa1', 'YL57xq9U', '2', 'Faithful 2.zip', Buffer.from('faithful 2'), ['minecraft']);
const ALL = [SODIUM_0, SODIUM_1, LITHIUM_0, LITHIUM_1, PACK_0, PACK_1];
const NEWER = { [SODIUM_0.id]: SODIUM_1, [LITHIUM_0.id]: LITHIUM_1, [PACK_0.id]: PACK_1 };
const PROJECTS = [
  { id: 'AANobbMI', slug: 'sodium', title: 'Sodium', icon_url: 'https://cdn.modrinth.com/sodium.png', description: 'Szybszy rendering' },
  { id: 'gvQqBUqZ', slug: 'lithium', title: 'Lithium', icon_url: null },
  { id: 'YL57xq9U', slug: 'faithful', title: 'Faithful', icon_url: null },
];

/** A Modrinth that knows the versions above; `state.offline` cuts it off, `state.broken` breaks one download. */
function fakeModrinth() {
  const state = { offline: false, broken: null, calls: [] };
  const byHash = new Map(ALL.map((v) => [v.files[0].hashes.sha1, v]));
  const json = (data) => new Response(JSON.stringify(data), { status: 200 });
  const fetchFn = async (url, init = {}) => {
    const u = String(url);
    state.calls.push(u);
    if (state.offline) throw new Error('offline');
    if (/cdn\.modrinth\.com\/data\//.test(u)) {
      const name = decodeURIComponent(u.split('/').pop());
      const body = BODIES.get(name);
      if (!body || name === state.broken) return new Response('nope', { status: 503 });
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    }
    if (/version_files\/update$/.test(u)) {
      const out = {};
      for (const hash of JSON.parse(init.body).hashes) {
        const current = byHash.get(hash);
        if (current && NEWER[current.id]) out[hash] = NEWER[current.id];
      }
      return json(out);
    }
    if (/\/versions\?/.test(u)) return json(JSON.parse(new URL(u).searchParams.get('ids')).map((id) => ALL.find((v) => v.id === id)).filter(Boolean));
    if (/\/projects\?/.test(u)) return json(JSON.parse(new URL(u).searchParams.get('ids')).map((id) => PROJECTS.find((p) => p.id === id)).filter(Boolean));
    if (/\/version\/[^/]+$/.test(u)) return json(ALL.find((v) => v.id === u.split('/version/')[1]) ?? null);
    return new Response('nope', { status: 404 });
  };
  return { fetchFn, state };
}

async function setup() {
  const { fetchFn, state } = fakeModrinth();
  const instances = createInstances(createPaths(tmpDir()));
  const instance = instances.create({ name: 'Test', mcVersion: '1.21.1', loader: 'fabric' });
  const modrinth = createModrinth({ fetchFn, sleep: async () => {} });
  const content = createContent({ modrinth, fetchFn });
  const updates = createUpdates({ content, modrinth });
  await content.installVersion(instance, 'mod', SODIUM_0, PROJECTS[0]);
  await content.installVersion(instance, 'mod', LITHIUM_0, PROJECTS[1]);
  await content.installVersion(instance, 'resourcepack', PACK_0, PROJECTS[2]);
  const mods = () => fs.readdirSync(path.join(instance.dir, 'mods')).sort();
  const packs = () => fs.readdirSync(path.join(instance.dir, 'resourcepacks')).sort();
  return { instance, instances, content, updates, modrinth, state, mods, packs, fetchFn };
}

test('updates: every kind of content is checked, an update keeps a disabled file disabled and can be undone exactly', async () => {
  const { instance, content, updates, mods, packs } = await setup();
  content.setEnabled(instance, 'mod', 'sodium-0.6.0.jar', false);
  const found = await updates.check(instance);
  assert.deepEqual(found.map((u) => [u.type, u.file, u.title, u.current, u.latest.versionNumber]), [['mod', 'lithium-0.14.0.jar', 'Lithium', '0.14.0', '0.15.0'], ['mod', 'sodium-0.6.0.jar', 'Sodium', '0.6.0', '0.6.1'], ['resourcepack', 'Faithful 1.zip', 'Faithful', '1', '2']]);

  const res = await updates.apply(instance, found, { now: new Date(2026, 10, 11, 14, 5, 33) });
  assert.equal(res.point, '2026-11-11_14-05-33');
  assert.deepEqual(res.updated, [
    { type: 'mod', file: 'lithium-0.14.0.jar', title: 'Lithium', from: '0.14.0', to: '0.15.0' },
    { type: 'mod', file: 'sodium-0.6.0.jar', title: 'Sodium', from: '0.6.0', to: '0.6.1' },
    { type: 'resourcepack', file: 'Faithful 1.zip', title: 'Faithful', from: '1', to: '2' },
  ]);
  assert.deepEqual(res.failed, []);
  assert.deepEqual([mods(), packs()], [['lithium-0.15.0.jar', 'sodium-0.6.1.jar.disabled'], ['Faithful 2.zip']]);
  assert.deepEqual(content.list(instance, 'mod').map((m) => [m.title, m.versionNumber, m.versionId, m.enabled, m.projectId]), [['Lithium', '0.15.0', 'lit1', true, 'gvQqBUqZ'], ['Sodium', '0.6.1', 'sod1', false, 'AANobbMI']]);
  assert.deepEqual(await updates.check(instance), [], 'everything is current now');
  // One restore point: the old files moved into it, with what was replaced by what.
  const [point] = updates.points(instance);
  assert.deepEqual([point.id, point.interrupted, point.entries.map((e) => `${e.title} ${e.old.versionNumber} → ${e.new.versionNumber}`)], [res.point, false, ['Lithium 0.14.0 → 0.15.0', 'Sodium 0.6.0 → 0.6.1', 'Faithful 1 → 2']]);
  assert.deepEqual(fs.readdirSync(path.join(instance.dir, '.hammer', 'przywracanie', res.point, 'mods')).sort(), ['lithium-0.14.0.jar', 'sodium-0.6.0.jar.disabled']);

  const undone = updates.undo(instance);
  assert.deepEqual(undone, { point: res.point, restored: [{ type: 'mod', title: 'Lithium', from: '0.15.0', to: '0.14.0' }, { type: 'mod', title: 'Sodium', from: '0.6.1', to: '0.6.0' }, { type: 'resourcepack', title: 'Faithful', from: '2', to: '1' }] });
  assert.deepEqual([mods(), packs()], [['lithium-0.14.0.jar', 'sodium-0.6.0.jar.disabled'], ['Faithful 1.zip']]);
  // The list knows the old versions again – name, icon and the link to Modrinth included.
  assert.deepEqual(content.list(instance, 'mod').map((m) => [m.title, m.versionNumber, m.versionId, m.enabled, m.projectId, m.iconUrl ?? null]), [['Lithium', '0.14.0', 'lit0', true, 'gvQqBUqZ', null], ['Sodium', '0.6.0', 'sod0', false, 'AANobbMI', 'https://cdn.modrinth.com/sodium.png']]);
  assert.deepEqual(updates.points(instance), []);
  assert.throws(() => updates.undo(instance), /Nie ma czego cofać/);
  assert.equal((await updates.check(instance)).length, 3, 'and the updates are on offer again');
});

test('updates: a single update gets its own restore point; a failed download costs nothing', async () => {
  const { instance, updates, state, mods } = await setup();
  const found = await updates.check(instance, ['mod']);
  const one = await updates.apply(instance, [found.find((u) => u.title === 'Sodium')], { now: new Date(2026, 10, 11, 9, 0, 1) });
  assert.deepEqual([one.updated.map((u) => u.title), one.failed], [['Sodium'], []]);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.1.jar']);
  // Lithium's download breaks: the old Lithium stays, no second restore point appears.
  state.broken = 'lithium-0.15.0.jar';
  const failed = await updates.apply(instance, [found.find((u) => u.title === 'Lithium')], { now: new Date(2026, 10, 11, 9, 0, 2) });
  assert.deepEqual([failed.point, failed.updated], [null, []]);
  assert.match(failed.failed[0].error, /HTTP 503/);
  assert.equal(failed.failed[0].title, 'Lithium');
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.1.jar']);
  assert.deepEqual(updates.points(instance).map((p) => p.entries.map((e) => e.title)), [['Sodium']]);
  // Without Modrinth nothing is touched at all.
  state.offline = true;
  await assert.rejects(updates.apply(instance, [found.find((u) => u.title === 'Lithium')]), /Brak połączenia z Modrinth/);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.1.jar']);
  state.offline = false;
  // A version that is gone, a file that is gone, and things that are not updates.
  const odd = await updates.apply(instance, [{ type: 'mod', file: 'lithium-0.14.0.jar', title: 'Lithium', latest: { id: 'nie-ma' } }, { type: 'mod', file: 'nie-ma.jar', title: 'Duch', latest: { id: 'sod1' } }, { type: 'datapack', file: 'x.zip', latest: { id: 'sod1' } }, null]);
  assert.deepEqual([odd.point, odd.updated, odd.failed.map((f) => f.title)], [null, [], ['Lithium', 'Duch']]);
  assert.match(odd.failed[0].error, /nie ma już na Modrinth/);
  assert.match(odd.failed[1].error, /Nie ma już tego pliku/);
  assert.deepEqual(await updates.apply(instance, []), { point: null, updated: [], failed: [] });
  assert.deepEqual(await updates.apply(instance, [{ type: 'mod', file: '../options.txt', title: 'Zły', latest: { id: 'sod1' } }, { type: 'mod', file: 'mods/lithium-0.14.0.jar', title: 'Zły', latest: { id: 'lit1' } }]), { point: null, updated: [], failed: [] }, 'a path is not a file of the list');
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.1.jar']);
});

test('updates: a file held by another program – the update leaves it alone, the undo can be run again', async () => {
  const { instance, updates, mods } = await setup();
  const found = await updates.check(instance, ['mod']);
  // Windows: another program (an antivirus, an archive tool) holds lithium – it cannot be moved.
  const rename = fs.renameSync;
  const held = (name) => (from, to) => {
    if (path.basename(String(from)).startsWith(name)) throw Object.assign(new Error(`EBUSY: resource busy or locked, rename '${from}'`), { code: 'EBUSY' });
    return rename(from, to);
  };
  fs.renameSync = held('lithium');
  let res;
  try {
    res = await updates.apply(instance, found, { now: new Date(2026, 10, 11, 8, 0, 0) });
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(res.updated.map((u) => u.title), ['Sodium']);
  assert.deepEqual(res.failed, [{ title: 'Lithium', error: 'nie udało się podmienić pliku – plik jest używany przez inny program.' }]);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.1.jar'], 'Lithium keeps its old version');
  // The way back hits the same wall (now Sodium's old file cannot be moved) – nothing is lost, and a second try finishes it.
  fs.renameSync = held('sodium-0.6.0');
  try {
    assert.throws(() => updates.undo(instance), /Nie udało się cofnąć całej aktualizacji: plik jest używany przez inny program\. Zamknij programy/);
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(updates.points(instance).length, 1, 'the restore point is still there');
  assert.deepEqual(updates.undo(instance).restored.map((r) => r.title), ['Sodium']);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.0.jar']);
  assert.deepEqual(updates.points(instance), []);
});

/** Timers the test moves by hand. */
function fakeTimers() {
  const pending = [];
  return {
    setTimeout: (fn, ms) => {
      const timer = { fn, ms, unref() {} };
      pending.push(timer);
      return timer;
    },
    clearTimeout: (timer) => pending.splice(pending.indexOf(timer), 1),
    pending,
    fire: () => pending.shift().fn(),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('background check: shortly after the start, then every six hours – quiet when it fails', async () => {
  const instances = [{ id: 'hammer', name: 'Hammer' }, { id: 'survival', name: 'Survival z ekipą' }, { id: 'fo', name: 'Fabulously Optimized', modpack: { name: 'FO' } }, { id: 'pusta', name: 'Pusta' }];
  const answers = { hammer: [{ type: 'mod', file: 'a.jar', title: 'A', current: '1', latest: { id: 'a2', versionNumber: '2' } }, { type: 'shader', file: 'b.zip', title: 'B', current: '1', latest: { id: 'b2', versionNumber: '2' } }], survival: [{ type: 'mod', file: 'c.jar', title: 'C', current: '1', latest: { id: 'c2', versionNumber: '2' } }], pusta: [] };
  const checked = [];
  const changes = [];
  let on = true;
  let offline = false;
  let clock = 1000;
  const timers = fakeTimers();
  const watch = createUpdateWatch({
    list: () => instances,
    check: async (instance) => {
      checked.push(instance.id);
      if (offline) throw new Error('Brak połączenia z Modrinth. Sprawdź internet.');
      return answers[instance.id];
    },
    enabled: () => on,
    onChange: (status) => changes.push(status),
    now: () => clock,
    timers,
  });
  assert.deepEqual(watch.status(), { checkedAt: null, total: 0, instances: [] });
  watch.start();
  assert.deepEqual(timers.pending.map((t) => t.ms), [FIRST_AFTER], 'nothing is asked while the launcher is still starting');
  assert.deepEqual(checked, []);
  timers.fire();
  await tick();
  assert.deepEqual(checked, ['hammer', 'survival', 'pusta'], 'an instance from a modpack is left alone');
  assert.deepEqual(changes.at(-1), { checkedAt: 1000, total: 3, instances: [{ id: 'hammer', name: 'Hammer', count: 2 }, { id: 'survival', name: 'Survival z ekipą', count: 1 }] });
  assert.deepEqual(watch.items('hammer').map((u) => u.title), ['A', 'B']);
  assert.deepEqual(watch.items('fo'), []);
  assert.deepEqual(timers.pending.map((t) => t.ms), [SIX_HOURS]);
  assert.equal(SIX_HOURS, 6 * 3600 * 1000);

  // Six hours later Modrinth cannot be reached: nobody is told, the last answer stays.
  offline = true;
  clock = 2000;
  timers.fire();
  await tick();
  assert.equal(watch.status().total, 3);
  assert.deepEqual(timers.pending.map((t) => t.ms), [SIX_HOURS], 'and the next round is armed all the same');
  offline = false;
  answers.hammer = [];
  timers.fire();
  await tick();
  assert.deepEqual(watch.status().instances, [{ id: 'survival', name: 'Survival z ekipą', count: 1 }]);

  // Two rounds never run at once; an instance that was removed is forgotten.
  const before = checked.length;
  const [a, b] = [watch.run(), watch.run()];
  assert.equal(a, b);
  await a;
  assert.equal(checked.length, before + 3);
  instances.splice(1, 1);
  await watch.run();
  assert.deepEqual(watch.status().instances, []);
  assert.deepEqual(watch.items('survival'), []);

  // A check made by hand (also of a modpack instance) and what is left after an update.
  watch.set('fo', answers.pusta.concat(answers.hammer, [{ type: 'mod', file: 'z.jar', title: 'Z', latest: { id: 'z2' } }]));
  assert.deepEqual(changes.at(-1).instances, [{ id: 'fo', name: 'Fabulously Optimized', count: 1 }]);
  const copy = watch.items('fo');
  copy[0].latest.id = 'zmienione';
  assert.equal(watch.items('fo')[0].latest.id, 'z2', 'what is handed out is a copy');

  // Switched off: no rounds, nothing shown.
  on = false;
  const quiet = checked.length;
  timers.fire();
  await tick();
  assert.equal(checked.length, quiet);
  watch.clear();
  assert.deepEqual(changes.at(-1), { checkedAt: null, total: 0, instances: [] });
  watch.stop();
  assert.deepEqual(timers.pending, []);
});

/* ── through the services ── */

async function services() {
  const { fetchFn, state } = fakeModrinth();
  const events = [];
  const s = createServices({ root: tmpDir(), config: { brand: 'HammerShop' }, accounts: { list: () => [] }, emit: (channel, payload) => events.push({ channel, payload }), fetchFn, now: () => new Date(2026, 10, 11, 14, 5, 33).getTime() });
  const instance = s.instances.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' });
  await s.content.installVersion(instance, 'mod', SODIUM_0, PROJECTS[0]);
  await s.content.installVersion(instance, 'mod', LITHIUM_0, PROJECTS[1]);
  const running = (on = true) => (on ? s.games.running.set(instance.id, { process: { kill() {} }, startedAt: Date.now(), logs: [] }) : s.games.running.delete(instance.id));
  const statuses = () => events.filter((e) => e.channel === 'updates:status').map((e) => e.payload);
  return { s, instance, events, running, statuses, state, mods: () => fs.readdirSync(path.join(instance.dir, 'mods')).sort() };
}

test('services: the badge follows the check, „Aktualizuj wszystko” and the way back; nothing is replaced under a running game', async () => {
  const { s, instance, events, running, statuses, mods } = await services();
  assert.deepEqual(s.updates.status(), { checkedAt: null, total: 0, instances: [] });
  assert.deepEqual(s.updates.list(instance.id), []);
  // One round of the background check: the window hears about it.
  const status = await s.updates.run();
  assert.deepEqual([status.total, status.instances], [2, [{ id: instance.id, name: 'Hammer', count: 2 }]]);
  assert.deepEqual(statuses().at(-1), status);
  assert.deepEqual(s.updates.list(instance.id).map((u) => u.title), ['Lithium', 'Sodium']);

  running();
  await assert.rejects(s.updates.apply(instance.id, s.updates.list(instance.id)), /Najpierw zamknij grę – aktualizacja podmienia pliki/);
  await assert.rejects(s.updates.undo(instance.id), /Najpierw zamknij grę – cofnięcie aktualizacji/);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.0.jar']);
  running(false);

  // A single update, then everything that is left. While files are being replaced, the game of this instance
  // cannot start and a second update (or the way back) has to wait.
  const pending = s.updates.apply(instance.id, [s.updates.list(instance.id)[1]]);
  await assert.rejects(s.launch(instance.id), /Poczekaj, aż launcher skończy aktualizację modów/);
  await assert.rejects(s.updates.undo(instance.id), /Poczekaj, aż skończy się poprzednia aktualizacja/);
  const one = await pending;
  assert.deepEqual([one.updated.map((u) => u.title), one.point], [['Sodium'], '2026-11-11_14-05-33']);
  assert.deepEqual(statuses().at(-1).instances, [{ id: instance.id, name: 'Hammer', count: 1 }], 'the badge counts down');
  const rest = await s.updates.apply(instance.id, s.updates.list(instance.id));
  assert.deepEqual(rest.updated.map((u) => u.title), ['Lithium']);
  assert.deepEqual(statuses().at(-1), { ...statuses().at(-1), total: 0, instances: [] });
  assert.deepEqual(mods(), ['lithium-0.15.0.jar', 'sodium-0.6.1.jar']);
  assert.deepEqual(events.filter((e) => e.channel === 'task:progress').at(-1).payload, { scope: 'updates', label: 'Aktualizacja: Lithium', done: 1, total: 1 }, 'the progress bar always ends');
  assert.deepEqual(s.updates.points(instance.id).map((p) => p.entries.map((e) => e.title)), [['Lithium'], ['Sodium']]);

  // „Cofnij ostatnią aktualizację” – twice: a stack.
  assert.deepEqual((await s.updates.undo(instance.id)).restored.map((r) => `${r.title} ${r.from} → ${r.to}`), ['Lithium 0.15.0 → 0.14.0']);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.1.jar']);
  assert.deepEqual((await s.updates.undo(instance.id)).restored.map((r) => r.title), ['Sodium']);
  assert.deepEqual(mods(), ['lithium-0.14.0.jar', 'sodium-0.6.0.jar']);
  await assert.rejects(s.updates.undo(instance.id), /Nie ma czego cofać/);
  assert.equal(s.updates.status().total, 0, 'what the player just took back is not pushed again at once');
  assert.equal((await s.updates.check(instance.id)).length, 2, 'a check by hand finds it');
  assert.equal(s.updates.status().total, 2);
  await assert.rejects(s.updates.check('nie-ma'), /Nie ma takiej instancji/);
  assert.throws(() => s.updates.points('nie-ma'), /Nie ma takiej instancji/);
});

test('services: the background check can be switched off in Ustawienia – and comes back when it is switched on', async () => {
  const { s, statuses, state } = await services();
  await s.updates.run();
  assert.equal(s.updates.status().total, 2);
  s.settings.set({ modUpdateCheck: false });
  assert.deepEqual(statuses().at(-1), { checkedAt: null, total: 0, instances: [] });
  const calls = state.calls.length;
  assert.deepEqual(await s.updates.run(), { checkedAt: null, total: 0, instances: [] });
  assert.equal(state.calls.length, calls, 'switched off: Modrinth is not asked');
  s.settings.set({ modUpdateCheck: true });
  await s.updates.run(); // the round the switch started
  assert.equal(s.updates.status().total, 2);
  // Offline: quiet – no message for the player, the last answer stays.
  state.offline = true;
  await s.updates.run();
  assert.equal(s.updates.status().total, 2);
});
