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
        if (!out.write(value)) await new Promise((r) => out.once('drain', r));
        onProgress?.(bytes, total);
      }
    } else {
      const buf = Buffer.from(await res.arrayBuffer());
      bytes = buf.length;
      hash.update(buf);
      out.write(buf);
      onProgress?.(bytes, total);
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    const got = hash.digest('hex');
    if (sha1 && got !== sha1.toLowerCase()) throw new Error(`Uszkodzony plik (zła suma kontrolna): ${path.basename(dest)}`);
    fs.renameSync(tmp, dest);
    return { path: dest, bytes, sha1: got };
  } catch (err) {
    out.destroy();
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

module.exports = { download, checkUrl, safeName, insideDir, sha1File, USER_AGENT, APP_VERSION, userAgent, ALLOWED_HOSTS };
