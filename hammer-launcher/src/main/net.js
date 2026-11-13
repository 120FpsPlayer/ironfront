'use strict';

/** Downloads with a size limit, SHA-1 check and an allow-list of hosts (mods may only come from trusted places). */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const USER_AGENT = 'Hammer-Launcher/1.0 (hammershop.pl)';

/** The launcher's own version (package.json – the same number app.getVersion() answers in the built app). */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const APP_VERSION = (() => {
  try {
    const { version } = require('../../package.json');
    return VERSION.test(String(version)) ? String(version) : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();
/**
 * What the launcher calls itself towards the HammerShop website: "Hammer-Launcher/2.6.0 (hammershop.pl)".
 * The shop counts launcher starts per version from this header, so its requests carry the real version.
 */
const userAgent = (version = APP_VERSION) => `Hammer-Launcher/${VERSION.test(String(version ?? '')) ? version : APP_VERSION} (hammershop.pl)`;
/** Hosts Modrinth allows in modpacks (the .mrpack specification) plus Modrinth's CDN. */
const ALLOWED_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com', 'objects.githubusercontent.com'];

function checkUrl(url, hosts = ALLOWED_HOSTS) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Nieprawidłowy adres pliku: ${url}`);
  }
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname)) throw new Error(`Plik z niedozwolonego źródła: ${u.hostname}`);
  return u;
}

/** A file name that can't escape its folder. */
function safeName(name) {
  const base = path.basename(String(name ?? ''));
  if (!base || base === '.' || base === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(base)) throw new Error(`Nieprawidłowa nazwa pliku: ${name}`);
  return base;
}

/** A relative path inside `root` (for modpack files) – throws when it would leave the folder. */
function insideDir(root, relative) {
  const target = path.resolve(root, String(relative ?? ''));
  const rel = path.relative(path.resolve(root), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Ścieżka poza folderem instancji: ${relative}`);
  return target;
}

function sha1File(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Downloads `url` to `dest` (temp file + rename). Verifies sha1 when given.
 * onProgress(bytes, total) is optional.
 */
async function download(url, dest, { sha1, fetchFn = fetch, maxBytes = 1024 * 1024 * 1024, onProgress, hosts } = {}) {
  checkUrl(url, hosts);
  const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
  if (!res.ok) throw new Error(`Pobieranie nie powiodło się (HTTP ${res.status}): ${path.basename(dest)}`);
  const total = Number(res.headers?.get?.('content-length')) || 0;
  if (total > maxBytes) throw new Error(`Plik jest za duży: ${path.basename(dest)}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  const hash = crypto.createHash('sha1');
  const out = fs.createWriteStream(tmp);
  // A file that cannot be written (a full disk, an antivirus holding it, a folder in its place) is an error of this
  // download – never an uncaught exception of the launcher, and never a wait for 'drain' that does not come.
  let writeError = null;
  const failed = new Promise((_, reject) => {
    out.once('error', (err) => {
      writeError = err;
      reject(err);
    });
  });
  failed.catch(() => {});
  const diskError = (err) => {
    const code = err?.code;
    const name = path.basename(dest);
    if (code === 'ENOSPC') return new Error(`Na dysku zabrakło miejsca – nie da się zapisać pliku ${name}. Zwolnij trochę miejsca i spróbuj ponownie.`, { cause: err });
    if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') return new Error(`Nie da się zapisać pliku ${name} – używa go inny program (np. antywirus). Spróbuj ponownie za chwilę.`, { cause: err });
    return new Error(`Nie udało się zapisać pliku ${name}: ${err?.message ?? err}`, { cause: err });
  };
  const write = async (chunk) => {
    if (writeError) throw writeError;
    if (!out.write(chunk)) await Promise.race([new Promise((r) => out.once('drain', r)), failed]);
  };
  let bytes = 0;
  try {
    if (res.body?.getReader) {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > maxBytes) throw new Error(`Plik jest za duży: ${path.basename(dest)}`);
        hash.update(value);
        await write(value);
        onProgress?.(bytes, total);
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      bytes = buf.length;
      hash.update(buf);
      await write(buf);
      onProgress?.(bytes, total);
    }
    await Promise.race([new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve()))), failed]);
    const got = hash.digest('hex');
    if (sha1 && got !== sha1.toLowerCase()) throw new Error(`Uszkodzony plik (zła suma kontrolna): ${path.basename(dest)}`);
    fs.renameSync(tmp, dest);
    return { path: dest, bytes, sha1: got };
  } catch (err) {
    out.destroy();
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      // (a folder in its place – it stays; the error below says what happened)
    }
    throw err === writeError || (err?.code && writeError === null && ['ENOSPC', 'EPERM', 'EBUSY', 'EACCES', 'EISDIR'].includes(err.code)) ? diskError(err) : err;
  }
}

module.exports = { download, checkUrl, safeName, insideDir, sha1File, USER_AGENT, APP_VERSION, userAgent, ALLOWED_HOSTS };
