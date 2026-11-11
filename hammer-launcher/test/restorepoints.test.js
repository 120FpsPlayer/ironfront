'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const points = require('../src/main/restorepoints');
const { tmpDir } = require('./helpers');

/** An instance folder with files in mods/ (and the other content folders). */
function instanceWith(files) {
  const instance = { id: 'hammer', dir: tmpDir() };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(instance.dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(instance.dir, rel), body);
  }
  return instance;
}
const ls = (instance, folder = 'mods') => (fs.existsSync(path.join(instance.dir, folder)) ? fs.readdirSync(path.join(instance.dir, folder)).sort() : []);
const read = (instance, rel) => fs.readFileSync(path.join(instance.dir, rel), 'utf8');
const entry = (type, title, oldFile, newFile, from = '1.0', to = '2.0') => ({ type, title, old: { file: oldFile, versionNumber: from, index: { projectId: 'AANobbMI', versionId: `old-${title}`, versionNumber: from, title } }, new: { file: newFile, versionId: `new-${title}`, versionNumber: to } });
/** What an update does for one entry: writes the new file into its folder. */
const installer = (instance, folders = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }) => async (e) => fs.writeFileSync(path.join(instance.dir, folders[e.type], e.new.file), `new ${e.title}`);
const at = (n) => new Date(2026, 10, 11, 14, 5, n);

test('restore point: the manifest is written before any file moves, the old files are moved – not deleted', async () => {
  const instance = instanceWith({ 'mods/sodium-0.6.0.jar': 'old Sodium', 'mods/lithium-0.14.jar.disabled': 'old Lithium', 'mods/inny.jar': 'x', 'resourcepacks/Faithful 1.zip': 'old Faithful' });
  const seen = [];
  const res = await points.replace(
    instance,
    [entry('mod', 'Sodium', 'sodium-0.6.0.jar', 'sodium-0.6.1.jar', '0.6.0', '0.6.1'), entry('mod', 'Lithium', 'lithium-0.14.jar', 'lithium-0.15.jar'), entry('resourcepack', 'Faithful', 'Faithful 1.zip', 'Faithful 2.zip')],
    async (e) => {
      // At the moment the new file is about to be written: the manifest is there, the old file is in the point.
      const [point] = points.list(instance);
      seen.push({ title: e.title, interrupted: point.interrupted, entries: point.entries.length, oldInPlace: fs.existsSync(path.join(instance.dir, 'mods', e.old.file)), disabled: e.old.disabled });
      await installer(instance)(e);
    },
    { now: at(33) },
  );
  assert.equal(res.id, '2026-11-11_14-05-33');
  assert.deepEqual(res.done.map((e) => e.title), ['Sodium', 'Lithium', 'Faithful']);
  assert.deepEqual(res.failed, []);
  assert.deepEqual(seen.map((s) => [s.title, s.interrupted, s.entries, s.oldInPlace, s.disabled]), [['Sodium', true, 3, false, false], ['Lithium', true, 3, false, true], ['Faithful', true, 3, false, false]]);
  assert.deepEqual(ls(instance), ['inny.jar', 'lithium-0.15.jar', 'sodium-0.6.1.jar']);
  // <instance>/.hammer/przywracanie/<timestamp>/ holds the old files under their names and the manifest.
  const dir = path.join(instance.dir, '.hammer', 'przywracanie', res.id);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['manifest.json', 'mods', 'resourcepacks']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'mods')).sort(), ['lithium-0.14.jar.disabled', 'sodium-0.6.0.jar']);
  assert.equal(fs.readFileSync(path.join(dir, 'mods', 'sodium-0.6.0.jar'), 'utf8'), 'old Sodium');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.deepEqual([manifest.v, manifest.id, manifest.state, manifest.createdAt], [1, res.id, 'done', at(33).getTime()]);
  assert.deepEqual(manifest.entries[0], { type: 'mod', title: 'Sodium', old: { file: 'sodium-0.6.0.jar', disabled: false, versionNumber: '0.6.0', index: { projectId: 'AANobbMI', versionId: 'old-Sodium', versionNumber: '0.6.0', title: 'Sodium' } }, new: { file: 'sodium-0.6.1.jar', versionId: 'new-Sodium', versionNumber: '0.6.1' }, state: 'done' });
  const [point] = points.list(instance);
  assert.deepEqual([point.id, point.interrupted, point.createdAt], [res.id, false, at(33).getTime()]);
  assert.deepEqual(point.entries.map((e) => [e.type, e.title, e.old.versionNumber, e.new.versionNumber, e.state]), [['mod', 'Sodium', '0.6.0', '0.6.1', 'done'], ['mod', 'Lithium', '1.0', '2.0', 'done'], ['resourcepack', 'Faithful', '1.0', '2.0', 'done']]);
});

test('restore point: „Cofnij ostatnią aktualizację” reverses the manifest exactly', async () => {
  const instance = instanceWith({ 'mods/sodium-0.6.0.jar': 'old Sodium', 'mods/lithium-0.14.jar.disabled': 'old Lithium', 'mods/inny.jar': 'x', 'shaderpacks/BSL 8.zip': 'old BSL' });
  await points.replace(instance, [entry('mod', 'Sodium', 'sodium-0.6.0.jar', 'sodium-0.6.1.jar'), entry('mod', 'Lithium', 'lithium-0.14.jar', 'lithium-0.15.jar'), entry('shader', 'BSL', 'BSL 8.zip', 'BSL 9.zip')], installer(instance), { now: at(1) });
  fs.renameSync(path.join(instance.dir, 'mods', 'sodium-0.6.1.jar'), path.join(instance.dir, 'mods', 'sodium-0.6.1.jar.disabled')); // the player switched the new one off since
  const res = points.restore(instance);
  assert.deepEqual([res.id, res.restored.map((e) => e.title), res.untouched], ['2026-11-11_14-05-01', ['Sodium', 'Lithium', 'BSL'], []]);
  assert.deepEqual(ls(instance), ['inny.jar', 'lithium-0.14.jar.disabled', 'sodium-0.6.0.jar'], 'new files removed, old ones back – what was disabled is disabled again');
  assert.deepEqual(ls(instance, 'shaderpacks'), ['BSL 8.zip']);
  assert.deepEqual([read(instance, 'mods/sodium-0.6.0.jar'), read(instance, 'mods/lithium-0.14.jar.disabled'), read(instance, 'shaderpacks/BSL 8.zip')], ['old Sodium', 'old Lithium', 'old BSL']);
  assert.deepEqual(points.list(instance), [], 'the point is used up');
  assert.equal(fs.existsSync(path.join(instance.dir, '.hammer', 'przywracanie', res.id)), false);
  assert.throws(() => points.restore(instance), /Nie ma czego cofać/);
});

test('restore point: a download that fails puts the old file straight back; nothing replaced → no point', async () => {
  const instance = instanceWith({ 'mods/a-1.jar': 'old A', 'mods/b-1.jar': 'old B', 'mods/c-1.jar.disabled': 'old C' });
  const res = await points.replace(
    instance,
    [entry('mod', 'A', 'a-1.jar', 'a-2.jar'), entry('mod', 'B', 'b-1.jar', 'b-2.jar'), entry('mod', 'C', 'c-1.jar', 'c-2.jar')],
    async (e) => {
      if (e.title === 'B') throw new Error('Pobieranie nie powiodło się (HTTP 503): b-2.jar');
      if (e.title === 'C') {
        fs.writeFileSync(path.join(instance.dir, 'mods', 'c-2.jar'), 'half of C'); // the file landed, a later step failed
        throw new Error('brak miejsca');
      }
      await installer(instance)(e);
    },
    { now: at(2) },
  );
  assert.deepEqual([res.done.map((e) => e.title), res.failed.map((f) => [f.entry.title, f.error.message])], [['A'], [['B', 'Pobieranie nie powiodło się (HTTP 503): b-2.jar'], ['C', 'brak miejsca']]]);
  assert.deepEqual(ls(instance), ['a-2.jar', 'b-1.jar', 'c-1.jar.disabled'], 'B and C keep their old versions, nothing is lost');
  assert.deepEqual(points.list(instance)[0].entries.map((e) => [e.title, e.state]), [['A', 'done'], ['B', 'failed'], ['C', 'failed']]);
  // Going back only reverses what was really replaced.
  const undone = points.restore(instance);
  assert.deepEqual([undone.restored.map((e) => e.title), undone.untouched.map((e) => e.title)], [['A'], ['B', 'C']]);
  assert.deepEqual(ls(instance), ['a-1.jar', 'b-1.jar', 'c-1.jar.disabled']);
  assert.deepEqual([read(instance, 'mods/b-1.jar'), read(instance, 'mods/c-1.jar.disabled')], ['old B', 'old C']);

  // Every download failed: no restore point is left behind.
  const none = await points.replace(instance, [entry('mod', 'A', 'a-1.jar', 'a-2.jar')], async () => Promise.reject(new Error('offline')), { now: at(3) });
  assert.deepEqual([none.id, none.done, none.failed.length], [null, [], 1]);
  assert.deepEqual(points.list(instance), []);
  assert.deepEqual(ls(instance, path.join('.hammer', 'przywracanie')), []);
  assert.deepEqual(ls(instance), ['a-1.jar', 'b-1.jar', 'c-1.jar.disabled']);
  // A file that is gone, or nothing to do at all, never opens a point.
  await assert.rejects(points.replace(instance, [entry('mod', 'Z', 'nie-ma.jar', 'z-2.jar')], installer(instance)), /Nie ma już pliku nie-ma\.jar/);
  await assert.rejects(points.replace(instance, [], installer(instance)), /Nie ma czego aktualizować/);
  assert.deepEqual(ls(instance, path.join('.hammer', 'przywracanie')), []);
});

test('restore point: the newest three are kept, older ones are deleted', async () => {
  const instance = instanceWith({ 'mods/a-1.jar': 'A1' });
  const ids = [];
  for (let n = 1; n <= 5; n += 1) ids.push((await points.replace(instance, [entry('mod', 'A', `a-${n}.jar`, `a-${n + 1}.jar`, String(n), String(n + 1))], installer(instance), { now: at(n) })).id);
  assert.deepEqual(points.list(instance).map((p) => p.id), [ids[4], ids[3], ids[2]]);
  assert.deepEqual(ls(instance, path.join('.hammer', 'przywracanie')), [ids[2], ids[3], ids[4]]);
  assert.deepEqual(ls(instance), ['a-6.jar']);
  // Going back is a stack: each undo reverses the update before.
  assert.deepEqual(points.restore(instance).restored.map((e) => [e.old.versionNumber, e.new.versionNumber]), [['5', '6']]);
  assert.deepEqual(ls(instance), ['a-5.jar']);
  points.restore(instance);
  points.restore(instance);
  assert.deepEqual(ls(instance), ['a-3.jar']);
  assert.throws(() => points.restore(instance), /Nie ma czego cofać/, 'a-1 and a-2 went with the pruned points');
  // Two updates within the same second get their own folders; a folder with a broken manifest counts as the oldest.
  const first = await points.replace(instance, [entry('mod', 'A', 'a-3.jar', 'a-4.jar')], installer(instance), { now: at(9) });
  const second = await points.replace(instance, [entry('mod', 'A', 'a-4.jar', 'a-5.jar')], installer(instance), { now: at(9) });
  assert.deepEqual([first.id, second.id], ['2026-11-11_14-05-09', '2026-11-11_14-05-09-2']);
  fs.mkdirSync(path.join(points.root(instance), '2026-11-11_14-05-50'));
  fs.writeFileSync(path.join(points.root(instance), '2026-11-11_14-05-50', 'manifest.json'), '{ zepsuty');
  fs.mkdirSync(path.join(points.root(instance), 'moje-notatki')); // not a point: never touched
  assert.deepEqual(points.list(instance).map((p) => p.id), [second.id, first.id]);
  await points.replace(instance, [entry('mod', 'A', 'a-5.jar', 'a-6.jar')], installer(instance), { now: at(10) });
  await points.replace(instance, [entry('mod', 'A', 'a-6.jar', 'a-7.jar')], installer(instance), { now: at(11) });
  assert.deepEqual(ls(instance, path.join('.hammer', 'przywracanie')), ['2026-11-11_14-05-09-2', '2026-11-11_14-05-10', '2026-11-11_14-05-11', 'moje-notatki']);
});

test('restore point: an update cut off half-way can be undone, and an undo cut off half-way can be run again', () => {
  const instance = instanceWith({ 'mods/a-1.jar': 'old A', 'mods/b-1.jar': 'old B', 'mods/c-1.jar': 'old C', 'mods/same.jar': 'old Same' });
  // The launcher died in the middle of an update: A was replaced, B was moved away and its download never
  // finished (a .part file is left), C was never touched, and Same keeps its file name across versions.
  const point = points.begin(instance, [entry('mod', 'A', 'a-1.jar', 'a-2.jar'), entry('mod', 'B', 'b-1.jar', 'b-2.jar'), entry('mod', 'C', 'c-1.jar', 'c-2.jar'), entry('mod', 'Same', 'same.jar', 'same.jar')], { now: at(20) });
  assert.deepEqual(ls(instance), ['a-1.jar', 'b-1.jar', 'c-1.jar', 'same.jar'], 'begin only writes the manifest');
  points.stash(instance, point.id, 0);
  fs.writeFileSync(path.join(instance.dir, 'mods', 'a-2.jar'), 'new A');
  points.mark(instance, point.id, 0, 'done');
  points.stash(instance, point.id, 3);
  fs.writeFileSync(path.join(instance.dir, 'mods', 'same.jar'), 'new Same');
  points.mark(instance, point.id, 3, 'done');
  points.stash(instance, point.id, 1);
  fs.writeFileSync(path.join(instance.dir, 'mods', 'b-2.jar.part'), 'half');
  assert.deepEqual(ls(instance), ['a-2.jar', 'b-2.jar.part', 'c-1.jar', 'same.jar']);
  assert.deepEqual(points.list(instance).map((p) => [p.id, p.interrupted]), [[point.id, true]], 'the window can say that the update was interrupted');

  // …and the undo is cut off too: one entry is put back, then nothing more happens.
  const manifest = points.readManifest(instance, point.id);
  assert.equal(points.putBack(instance, point.id, manifest.entries[3]), true);
  assert.equal(read(instance, 'mods/same.jar'), 'old Same');
  assert.equal(points.putBack(instance, point.id, manifest.entries[3]), false, 'already back – a second try touches nothing');
  assert.equal(read(instance, 'mods/same.jar'), 'old Same', 'the restored file is not taken for the new one and removed');

  const res = points.restore(instance);
  assert.deepEqual([res.restored.map((e) => e.title), res.untouched.map((e) => e.title)], [['A', 'B'], ['C', 'Same']]);
  assert.deepEqual(ls(instance), ['a-1.jar', 'b-1.jar', 'c-1.jar', 'same.jar'], 'everything is as before the update');
  assert.deepEqual(['a-1.jar', 'b-1.jar', 'c-1.jar', 'same.jar'].map((f) => read(instance, `mods/${f}`)), ['old A', 'old B', 'old C', 'old Same']);
  assert.deepEqual(points.list(instance), []);
});

test('restore point: the manifest lies in the game folder – a tampered one cannot reach outside the content folders', () => {
  const instance = instanceWith({ 'mods/a-1.jar': 'old A', 'options.txt': 'ustawienia', 'saves/Swiat/level.dat': 'świat' });
  const point = points.begin(instance, [entry('mod', 'A', 'a-1.jar', 'a-2.jar')], { now: at(30) });
  points.stash(instance, point.id, 0);
  fs.writeFileSync(path.join(instance.dir, 'mods', 'a-2.jar'), 'new A');
  const file = path.join(points.pointDir(instance, point.id), 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const evil = (oldFile, newFile, type = 'mod') => ({ type, title: 'Zły', old: { file: oldFile, disabled: false }, new: { file: newFile } });
  manifest.entries.push(evil('a-1.jar', '../options.txt'), evil('../../saves/Swiat/level.dat', 'x.jar'), evil('a-1.jar', 'x.jar', 'saves'), evil('a-1.jar', 'C:\\Windows\\x.jar'), evil('.ukryty.jar', 'x.jar'), evil('a-1.exe', 'x.jar'), null, 'tekst');
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.equal(points.list(instance)[0].entries.length, 1, 'only the honest entry is read');
  points.restore(instance);
  assert.deepEqual(ls(instance), ['a-1.jar']);
  assert.deepEqual([read(instance, 'options.txt'), read(instance, 'saves/Swiat/level.dat')], ['ustawienia', 'świat']);
  // Names that are not plain file names of the right kind never get into a manifest in the first place.
  for (const bad of ['../a-1.jar', 'a-1.jar/..', 'mods/a-1.jar', 'a-1.zip', '', null]) {
    assert.throws(() => points.begin(instance, [entry('mod', 'A', bad, 'a-2.jar')]), /Nieprawidłowa pozycja aktualizacji/, String(bad));
    assert.throws(() => points.begin(instance, [entry('mod', 'A', 'a-1.jar', bad)]), /Nieprawidłowa pozycja aktualizacji/, String(bad));
  }
  assert.throws(() => points.begin(instance, [entry('datapack', 'A', 'a-1.jar', 'a-2.jar')]), /Nieprawidłowa pozycja aktualizacji/);
  assert.deepEqual(points.list(instance), []);
});
