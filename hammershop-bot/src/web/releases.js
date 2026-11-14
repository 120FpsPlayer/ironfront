'use strict';

/**
 * Hammer Launcher's installers, kept on this server (data/releases/) – the download button of the website and the
 * launcher's own updater read them from here, nothing goes through GitHub:
 *
 *   GET /download              → the current installer (302 to /updates/<file>, counted) – after a Discord sign-in
 *                              when the site has one (src/web/server.js)
 *   GET /updates/latest.yml    what electron-updater's "generic" provider reads: version, file, sha512, size
 *                              (+ signature when the owner signs releases – the launcher then refuses anything unsigned)
 *   GET /updates/<file>        the installer or its .blockmap. Range requests work – one range (a resumed download)
 *                              and many at once (multipart/byteranges: electron-updater's differential download asks
 *                              for just the blocks that changed since the installed version)
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

const tooBig = (limit) => problem(413, `Plik jest za duży – najwyżej ${Math.round(limit / 1024 / 1024)} MB (RELEASE_MAX_MB w .env).`);
/** A full disk said plainly – a small hosting plan runs out of room long before RELEASE_MAX_MB. */
const diskProblem = (err) => (err?.code === 'ENOSPC' || err?.code === 'EDQUOT' ? problem(507, 'Na dysku serwera zabrakło miejsca – usuń stare pliki albo zwiększ dysk.') : err);

/** The pieces of an upload that is still on its way: data/releases/.part-<name> (never listed, never served). */
const partOf = (name) => path.join(DIR(), `.part-${name}`);
/** name → stops the request that is writing that file's piece right now (a retry takes over from a stalled one). */
const writing = new Map();
/**
 * What the browser calls the file it is sending ("<size>-<last modified>"), kept beside the pieces: an upload that
 * broke off is picked up again only by the very same file – never by another build that happens to share its name.
 */
const KEY = /^[A-Za-z0-9._-]{1,80}$/;
const keyFile = (name) => `${partOf(name)}.key`;
function keyOf(name) {
  try {
    return fs.readFileSync(keyFile(name), 'utf8');
  } catch {
    return null;
  }
}

/** Free room where the installers are kept, in bytes – null when the system will not say. */
function diskFree() {
  try {
    fs.mkdirSync(DIR(), { recursive: true });
    const st = fs.statfsSync(DIR());
    const free = Number(st.bavail) * Number(st.bsize);
    return Number.isFinite(free) ? free : null;
  } catch {
    return null;
  }
}

/** Where an upload that broke off goes on: the bytes the server already has of this very file (0 – from the start). */
function resumeAt(name, total, key) {
  if (!isFileName(name) || !KEY.test(key ?? '') || !fs.existsSync(partOf(name)) || keyOf(name) !== key) return 0;
  const have = fs.statSync(partOf(name)).size;
  return have < total ? have : 0;
}

/** Unfinished uploads nobody came back to (older than a day) are swept when a new upload starts. */
function sweepParts() {
  for (const entry of fs.readdirSync(DIR())) {
    if (!entry.startsWith('.part-') && !entry.startsWith('.upload-')) continue;
    const file = path.join(DIR(), entry);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > 24 * 3600 * 1000) fs.rmSync(file, { force: true });
    } catch {
      // gone already
    }
  }
}

/**
 * Reads what is left of a request's body and throws it away. An answer sent while the browser is still uploading
 * leaves browsers and proxies hanging (the upload just stops) – so every answer to a piece waits for its body.
 */
const drain = (req) =>
  new Promise((resolve) => {
    if (req.complete || req.destroyed) return resolve();
    req.once('end', resolve).once('close', resolve).once('error', resolve);
    return req.resume();
  });

/** What can be said about a piece before its body is read: an answer ({ done: true }), null (write it) or a thrown problem. */
async function beforePart(req, name, offset, total, key) {
  const limit = MAX_BYTES();
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(total) || offset < 0 || total < 0) throw problem(400, 'Nieprawidłowe położenie kawałka pliku.');
  if (key !== null && !KEY.test(key)) throw problem(400, 'Nieprawidłowy znacznik pliku.');
  if (!total) throw problem(400, 'Plik jest pusty.');
  if (total > limit) throw tooBig(limit);
  const length = Number(req.headers['content-length']);
  if (offset >= total || (Number.isFinite(length) && offset + length > total)) throw problem(400, 'Kawałek wychodzi poza rozmiar pliku.');
  fs.mkdirSync(DIR(), { recursive: true });
  await writing.get(name)?.(); // a piece of this file still being written (a stalled request the panel gave up on) stops first
  const part = partOf(name);
  const have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (!offset) {
    sweepParts();
    const free = diskFree();
    const mb = (n) => Math.floor(n / 1024 / 1024);
    if (free !== null && free + have < total) throw problem(507, `Na dysku serwera jest za mało miejsca: wolne ${mb(free + have)} MB, a plik ma ${mb(total)} MB. Usuń stare pliki albo zwiększ dysk.`);
    if (key) fs.writeFileSync(keyFile(name), key);
    else fs.rmSync(keyFile(name), { force: true });
  } else if (have < offset) {
    // The answer to the last piece got lost on the way, but the file is complete: nothing left to send.
    if (!have && fs.existsSync(fileOf(name)) && fs.statSync(fileOf(name)).size === total) return { name, size: total, done: true, repeated: true };
    throw Object.assign(problem(409, 'Serwer ma mniej tego pliku, niż zakłada przeglądarka – wysyłanie wraca do tego miejsca.'), { offset: have });
  } else if (key && keyOf(name) !== key) {
    throw Object.assign(problem(409, 'Na serwerze leży początek innego pliku o tej nazwie – wysyłanie zaczyna od nowa.'), { offset: 0 });
  } else if (have > offset) fs.truncateSync(part, offset); // what a broken piece left behind
  return null;
}

/**
 * One piece of an upload: the body is the bytes [offset, offset + length) of a file of `total` bytes. The panel sends
 * a big installer this way, a few MB per request – a proxy in front of the site (Cloudflare lets 100 MB through) never
 * sees the whole file, and a broken connection costs one piece, not the upload.
 *
 *   offset 0       starts the file anew
 *   offset > 0     continues; the piece is written at that place, so sending the same piece again is harmless.
 *                  If the server has less than `offset`, it answers 409 with the offset it does have (err.offset).
 *
 * → { name, offset, done: false } while pieces are missing, { name, size, done: true } when the file is complete
 *   (only then does it get its real name – half an installer is never where the launcher could fetch it).
 */
async function receivePart(req, name, offset, total, key = null) {
  let early;
  try {
    early = await beforePart(req, name, offset, total, key);
  } catch (err) {
    await drain(req);
    throw err;
  }
  if (early) {
    await drain(req);
    return early;
  }
  const part = partOf(name);
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(part, offset ? { flags: 'r+', start: offset } : { flags: 'w' });
    const closed = new Promise((done) => out.once('close', done));
    let size = 0;
    let failed = false;
    const stop = () => {
      fail(problem(409, 'Ten kawałek zastąpiła nowsza próba wysyłania.'));
      req.destroy();
      return closed;
    };
    const settle = (fn, value) => {
      if (writing.get(name) === stop) writing.delete(name);
      fn(value);
    };
    const fail = (err) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      // The part stays: the next try continues from it. The rest of this piece is read off the wire before the answer.
      Promise.all([closed, drain(req)]).then(() => settle(reject, diskProblem(err)));
    };
    writing.set(name, stop);
    req.on('data', (c) => {
      size += c.length;
      if (offset + size > total) {
        fail(problem(400, 'Kawałek wychodzi poza rozmiar pliku.'));
        req.destroy();
      }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(problem(400, 'Wysyłanie zostało przerwane.')));
    out.on('error', fail);
    out.on('finish', async () => {
      await closed; // the file is renamed (and the next piece opens it) only once this handle is shut
      if (failed) return;
      if (!size) return fail(problem(400, 'Pusty kawałek pliku.'));
      if (offset + size < total) return settle(resolve, { name, offset: offset + size, done: false });
      return fs.rename(part, fileOf(name), (err) => {
        if (err) return fail(err);
        fs.rmSync(keyFile(name), { force: true });
        return settle(resolve, { name, size: total, done: true });
      });
    });
    req.pipe(out);
  });
}

/**
 * An upload from the admin panel: the request body is the file – or, with part = { offset, total }, one piece of it
 * (see receivePart). Written under a temporary name first, so a broken upload never leaves half an installer where
 * the launcher could fetch it. → { name, size }
 */
function receive(req, name, part = null) {
  if (!isFileName(name)) throw problem(400, 'Nazwa pliku może zawierać litery, cyfry, kropki, myślniki i podkreślenia, i musi kończyć się na .exe albo .blockmap.');
  if (part) return receivePart(req, name, part.offset, part.total, part.key ?? null);
  const limit = MAX_BYTES();
  if (Number(req.headers['content-length']) > limit) throw tooBig(limit);
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
      fs.rm(tmp, { force: true }, () => reject(diskProblem(err)));
    };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        fail(tooBig(limit));
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
    // „Co nowego” travels with the update: the launcher keeps it and shows it once the new version is installed.
    ...(release.notes ? ['releaseNotes: |2-', ...String(release.notes).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').split(/\r?\n/).map((line) => `  ${line}`.trimEnd() || '  ')] : []),
    ...(release.signature ? [`signature: ${yamlString(release.signature)}`] : []),
    '',
  ].join('\n');
}

/**
 * What the launcher and the download page are told about the current release. url: the installer itself – the launcher
 * opens it when it cannot update by itself, and somebody who already has the launcher is not sent through the website's
 * Discord sign-in (/download) for that.
 */
function publicInfo(publicUrl = '') {
  const r = store.currentRelease();
  if (!r) return null;
  return { version: r.version, notes: r.notes || '', date: new Date(r.at).toISOString(), minVersion: r.minVersion ?? null, size: r.size, url: `${publicUrl}/updates/${encodeURIComponent(r.file)}` };
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

const MAX_RANGES = 1500; // electron-updater asks for at most 1000 blocks per request

/**
 * "bytes=0-99, 200-299" → [{ start, end }] in the order asked, for a header with several ranges. null = not such a
 * header, or one this server answers with the whole file instead (too many ranges, or ranges that together are longer
 * than the file – nobody honest needs the same bytes twice).
 */
function parseRanges(header, size) {
  const text = String(header ?? '').trim();
  if (!/^bytes=/.test(text) || !text.includes(',')) return null;
  const specs = text.slice(6).split(',').map((p) => p.trim()).filter(Boolean);
  if (specs.length < 2 || specs.length > MAX_RANGES) return null;
  const out = [];
  let total = 0;
  for (const spec of specs) {
    const one = parseRange(`bytes=${spec}`, size);
    if (one === null) return null; // not a range at all
    if (one === false) continue; // beyond the file: left out
    total += one.end - one.start + 1;
    if (total > size) return null;
    out.push(one);
  }
  return out.length ? out : null;
}

/** Sends the ranges as one multipart/byteranges body (RFC 7233) – read from one open file, never more than 64 KB in memory. */
async function sendRanges(req, res, name, ranges, size, base) {
  const boundary = `hs${crypto.randomBytes(12).toString('hex')}`;
  const type = base['content-type'];
  const head = (r, first) => `${first ? '' : '\r\n'}--${boundary}\r\nContent-Type: ${type}\r\nContent-Range: bytes ${r.start}-${r.end}/${size}\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  const length = ranges.reduce((sum, r, i) => sum + Buffer.byteLength(head(r, i === 0)) + (r.end - r.start + 1), 0) + Buffer.byteLength(tail);
  res.writeHead(206, { ...base, 'content-type': `multipart/byteranges; boundary=${boundary}`, 'content-length': length });
  if (req.method === 'HEAD') return res.end();
  const write = (data) => (res.write(data) || res.destroyed ? null : new Promise((resolve) => res.once('drain', resolve)));
  const file = await fs.promises.open(fileOf(name), 'r');
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    for (let i = 0; i < ranges.length && !res.destroyed; i += 1) {
      await write(head(ranges[i], i === 0));
      for (let at = ranges[i].start; at <= ranges[i].end && !res.destroyed; ) {
        const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, ranges[i].end - at + 1), at);
        if (!bytesRead) throw new Error(`${name}: plik jest krótszy niż zapisano`);
        await write(Buffer.from(buffer.subarray(0, bytesRead))); // a copy: the buffer is reused before the socket has sent it
        at += bytesRead;
      }
    }
    return res.end(tail);
  } catch (err) {
    console.warn('[web] wysyłanie fragmentów:', err.message);
    return res.destroy();
  } finally {
    await file.close();
  }
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
  const many = parseRanges(req.headers.range, size);
  const range = many ? null : parseRange(req.headers.range, size);
  const base = {
    ...headers,
    'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    // Always checked with this server: a build uploaded again under the same name must never come from a cache
    // with its old bytes (the updater compares the file with the checksum in latest.yml).
    'cache-control': 'no-cache',
    ...(name.endsWith('.exe') && { 'content-disposition': `attachment; filename="${name}"` }),
  };
  if (many) return sendRanges(req, res, name, many, size, base);
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

module.exports = { DIR, compareVersions, isVersion, isFileName, filesOnDisk, hashFile, receive, resumeAt, diskFree, publish, remove, latestYml, publicInfo, parseRange, parseRanges, serve, fileOf };
