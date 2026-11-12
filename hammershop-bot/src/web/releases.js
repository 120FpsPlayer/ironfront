'use strict';

/**
 * Hammer Launcher's installers, kept on this server (data/releases/) – the download button of the website and the
 * launcher's own updater read them from here, nothing goes through GitHub:
 *
 *   GET /download              → the current installer (302 to /updates/<file>, counted)
 *   GET /updates/latest.yml    what electron-updater's "generic" provider reads: version, file, sha512, size
 *                              (+ signature when the owner signs releases – the launcher then refuses anything unsigned)
 *   GET /updates/<file>        the installer or its .blockmap (Range requests work: resumed and differential downloads)
 *
 * A release is published from the admin panel: the installer is uploaded (or copied into data/releases/ by hand), this
 * module hashes it and writes the release into the website's database (src/web/store.js). latest.yml is made here,
 * from that record – the file electron-builder wrote is not needed.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../lib/db');
const store = require('./store');

const DIR = () => path.join(db.dataDir, 'releases');
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z][0-9A-Za-z.-]{0,30})?$/;
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(?:exe|blockmap)$/;
const MAX_BYTES = () => (Number(process.env.RELEASE_MAX_MB) || 700) * 1024 * 1024;
const TYPES = { '.exe': 'application/vnd.microsoft.portable-executable', '.blockmap': 'application/octet-stream', '.yml': 'text/yaml; charset=utf-8' };

const problem = (status, message) => Object.assign(new Error(message), { status });
const isVersion = (v) => typeof v === 'string' && VERSION.test(v);
const isFileName = (n) => typeof n === 'string' && FILE_NAME.test(n) && !n.includes('..');
const fileOf = (name) => path.join(DIR(), name);

/** "2.10.0" is newer than "2.9.3": numbers compare as numbers; a pre-release ("-beta.1") is older than its release. */
function compareVersions(a, b) {
  const split = (v) => {
    const [core, pre = ''] = String(v).split('-');
    return { nums: core.split('.').map(Number), pre };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) if ((x.nums[i] ?? 0) !== (y.nums[i] ?? 0)) return (x.nums[i] ?? 0) < (y.nums[i] ?? 0) ? -1 : 1;
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The files lying in data/releases/ that could be published: [{ name, size, mtime }] – newest first. */
function filesOnDisk() {
  if (!fs.existsSync(DIR())) return [];
  return fs
    .readdirSync(DIR())
    .filter(isFileName)
    .map((name) => {
      const st = fs.statSync(fileOf(name));
      return st.isFile() ? { name, size: st.size, mtime: st.mtimeMs } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
}

/** The sha512 electron-updater checks (base64) and the size of a file in data/releases/. */
function hashFile(name) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    let size = 0;
    fs.createReadStream(fileOf(name))
      .on('data', (c) => {
        size += c.length;
        hash.update(c);
      })
      .on('end', () => resolve({ sha512: hash.digest('base64'), size }))
      .on('error', reject);
  });
}

/**
 * An upload from the admin panel: the request body is the file. Written under a temporary name first, so a broken
 * upload never leaves half an installer where the launcher could fetch it. → { name, size }
 */
function receive(req, name) {
  if (!isFileName(name)) throw problem(400, 'Nazwa pliku może zawierać litery, cyfry, kropki, myślniki i podkreślenia, i musi kończyć się na .exe albo .blockmap.');
  const limit = MAX_BYTES();
  if (Number(req.headers['content-length']) > limit) throw problem(413, `Plik jest za duży – najwyżej ${Math.round(limit / 1024 / 1024)} MB (RELEASE_MAX_MB w .env).`);
  fs.mkdirSync(DIR(), { recursive: true });
  const tmp = path.join(DIR(), `.upload-${crypto.randomBytes(6).toString('hex')}`);
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    let size = 0;
    let failed = false;
    const fail = (err) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rm(tmp, { force: true }, () => reject(err));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(problem(413, `Plik jest za duży – najwyżej ${Math.round(limit / 1024 / 1024)} MB (RELEASE_MAX_MB w .env).`));
        req.destroy();
      }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(problem(400, 'Wysyłanie zostało przerwane.')));
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (!size) return fail(problem(400, 'Plik jest pusty.'));
      fs.rename(tmp, fileOf(name), (err) => (err ? fail(err) : resolve({ name, size })));
    });
    req.pipe(out);
  });
}

/**
 * Publishes a version: { version, file, blockmap?, notes?, minVersion?, signature?, by }. The file must already be
 * in data/releases/. It becomes the current release unless makeCurrent is false. → the release record
 */
async function publish({ version, file, blockmap = null, notes = '', minVersion = null, signature = null, by = null, makeCurrent = true }) {
  if (!isVersion(version)) throw problem(400, 'Wersja ma postać 2.6.0 (trzy liczby, opcjonalnie dopisek, np. 2.6.0-beta.1).');
  if (!isFileName(file) || !file.endsWith('.exe') || !fs.existsSync(fileOf(file))) throw problem(400, 'Nie ma takiego instalatora (.exe) na serwerze – najpierw go wgraj.');
  if (blockmap !== null && (!isFileName(blockmap) || !blockmap.endsWith('.blockmap') || !fs.existsSync(fileOf(blockmap)))) throw problem(400, 'Nie ma takiego pliku .blockmap na serwerze.');
  if (minVersion !== null && !isVersion(minVersion)) throw problem(400, 'Najstarsza wspierana wersja ma postać 2.5.0 – albo zostaw to pole puste.');
  if (minVersion !== null && compareVersions(minVersion, version) > 0) throw problem(400, 'Najstarsza wspierana wersja nie może być nowsza niż publikowana.');
  if (signature !== null && !/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw problem(400, 'Podpis to 88 znaków base64 – wklej zawartość pliku .sig.');
  const taken = store.releases().find((r) => r.version !== version && (r.file === file || (blockmap && r.blockmap === blockmap)));
  if (taken) throw problem(409, `Ten plik należy już do wersji ${taken.version}.`);
  const { sha512, size } = await hashFile(file);
  const before = store.getRelease(version);
  const { release, dropped } = store.saveRelease({
    version, file, blockmap, size, sha512, signature,
    notes: String(notes ?? '').slice(0, 4000),
    minVersion, by, at: Date.now(), downloads: before?.downloads ?? 0,
  });
  // The files of a release that was replaced or pushed out of the list are not needed any more.
  const inUse = new Set(store.releases().flatMap((r) => [r.file, r.blockmap]).filter(Boolean));
  for (const old of [before, ...dropped].filter(Boolean)) for (const name of [old.file, old.blockmap]) if (name && !inUse.has(name)) fs.rmSync(fileOf(name), { force: true });
  if (makeCurrent) store.setCurrentRelease(version);
  return release;
}

/** Takes a release off the list and deletes its files. */
function remove(version) {
  const release = store.removeRelease(version);
  if (!release) return null;
  const inUse = new Set(store.releases().flatMap((r) => [r.file, r.blockmap]).filter(Boolean));
  for (const name of [release.file, release.blockmap]) if (name && !inUse.has(name)) fs.rmSync(fileOf(name), { force: true });
  return release;
}

const yamlString = (text) => `'${String(text).replace(/'/g, "''")}'`;

/** latest.yml for the current release – '' when nothing is published. */
function latestYml(release = store.currentRelease()) {
  if (!release) return '';
  return [
    `version: ${release.version}`,
    'files:',
    `  - url: ${release.file}`,
    `    sha512: ${release.sha512}`,
    `    size: ${release.size}`,
    `path: ${release.file}`,
    `sha512: ${release.sha512}`,
    `releaseDate: ${yamlString(new Date(release.at).toISOString())}`,
    ...(release.signature ? [`signature: ${yamlString(release.signature)}`] : []),
    '',
  ].join('\n');
}

/** What the launcher and the download page are told about the current release. */
function publicInfo(publicUrl = '') {
  const r = store.currentRelease();
  if (!r) return null;
  return { version: r.version, notes: r.notes || '', date: new Date(r.at).toISOString(), minVersion: r.minVersion ?? null, size: r.size, url: `${publicUrl}/download` };
}

/** "bytes=0-99" → { start, end } within size; null = the whole file; false = cannot be satisfied. */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return null; // several ranges or something else: answer with the whole file
  let start;
  let end;
  if (m[1] === '') {
    const tail = Number(m[2]);
    if (!tail) return false;
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? false : { start, end };
}

/**
 * GET /updates/<name> – only latest.yml and the files of published releases are ever served.
 * h: { send, fail, headers } (the website's own helpers and security headers).
 */
function serve(req, res, name, { send, fail, headers }) {
  if (name === 'latest.yml') {
    const yml = latestYml();
    return yml ? send(res, 200, yml, { 'content-type': TYPES['.yml'], 'cache-control': 'no-cache' }) : fail(res, 404, 'Nie opublikowano jeszcze żadnej wersji.');
  }
  const known = store.releases().some((r) => r.file === name || r.blockmap === name);
  if (!known || !isFileName(name) || !fs.existsSync(fileOf(name))) return fail(res, 404, 'Nie znaleziono');
  const { size } = fs.statSync(fileOf(name));
  const range = parseRange(req.headers.range, size);
  const base = {
    ...headers,
    'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=300',
    ...(name.endsWith('.exe') && { 'content-disposition': `attachment; filename="${name}"` }),
  };
  if (range === false) {
    res.writeHead(416, { ...base, 'content-range': `bytes */${size}` });
    return res.end();
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  res.writeHead(range ? 206 : 200, { ...base, 'content-length': end - start + 1, ...(range && { 'content-range': `bytes ${start}-${end}/${size}` }) });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(fileOf(name), { start, end });
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  return stream.pipe(res);
}

module.exports = { DIR, compareVersions, isVersion, isFileName, filesOnDisk, hashFile, receive, publish, remove, latestYml, publicInfo, parseRange, serve, fileOf };
