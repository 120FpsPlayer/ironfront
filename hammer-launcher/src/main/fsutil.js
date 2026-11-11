'use strict';

/** Folder helpers shared by Światy and the disk clean-up: walking files without blocking, sizes, safe names. */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Every regular file below `dir`: onFile({ path, rel, size, mtimeMs }). Links inside are never followed;
 * with `followRoot: false` a `dir` that is itself a link counts as empty (used before deleting anything).
 * Stops after `maxEntries` files and returns { files, partial }.
 */
async function walk(dir, onFile, { maxEntries = 500_000, followRoot = true } = {}) {
  let files = 0;
  if (!followRoot && !(await fsp.lstat(dir).catch(() => null))?.isDirectory()) return { files, partial: false };
  const queue = [''];
  while (queue.length) {
    const relDir = queue.pop();
    let entries;
    try {
      entries = await fsp.readdir(path.join(dir, relDir), { withFileTypes: true });
    } catch {
      continue; // removed in the meantime or not readable
    }
    const found = [];
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) queue.push(rel);
      else if (e.isFile()) found.push(rel);
    }
    for (let i = 0; i < found.length; i += 64) {
      const batch = found.slice(i, i + 64);
      const stats = await Promise.all(batch.map((rel) => fsp.lstat(path.join(dir, rel)).catch(() => null)));
      for (let n = 0; n < batch.length; n++) {
        if (!stats[n]) continue;
        if (files >= maxEntries) return { files, partial: true };
        files += 1;
        onFile({ path: path.join(dir, batch[n]), rel: batch[n], size: stats[n].size, mtimeMs: stats[n].mtimeMs });
      }
    }
  }
  return { files, partial: false };
}

/** { size, files, partial } of a folder; a missing folder is simply empty. */
async function dirSize(dir, options) {
  let size = 0;
  const { files, partial } = await walk(dir, (f) => (size += f.size), options);
  return { size, files, partial };
}

/** Runs fn over the items with at most `limit` at once; results keep their order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A name that is exactly one existing file or folder name: no path parts, no "..", no hidden files. */
function isPlainName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && name === path.basename(name) && !name.startsWith('.') && !/[\\/\x00-\x1f]/.test(name);
}

/** A new folder name that every system accepts (Windows is the strictest). */
function cleanFolderName(name, fallback) {
  const cleaned = String(name ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 100)
    .replace(/[\s.]+$/, '');
  return cleaned && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned) ? cleaned : fallback;
}

/** `base` if nothing with that name exists in `dir`, otherwise "base (2)", "base (3)" … */
function freeName(dir, base, ext = '') {
  let name = `${base}${ext}`;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base} (${n})${ext}`;
  return name;
}

/** Local time as 2026-11-10_18-05 (for file names). */
function stamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}`;
}

const REASONS = {
  ENOSPC: 'na dysku zabrakło miejsca',
  EACCES: 'brak uprawnień do plików',
  EPERM: 'brak uprawnień (plik może być otwarty w innym programie albo blokuje go antywirus)',
  EBUSY: 'plik jest używany przez inny program',
  ENOENT: 'plik zniknął w trakcie pracy',
  EEXIST: 'taki plik już istnieje',
  EROFS: 'dysk jest tylko do odczytu',
  EMFILE: 'system nie pozwala otworzyć więcej plików naraz',
};

/**
 * Runs a file operation; a system error (EACCES, ENOSPC, a zlib error …) comes out as one Polish sentence that
 * starts with `what`. Errors without a code are the launcher's own messages and pass through unchanged.
 */
async function explained(what, fn) {
  try {
    return await fn();
  } catch (err) {
    if (typeof err?.code !== 'string') throw err;
    throw new Error(`${what}: ${fileReason(err)}.`, { cause: err });
  }
}

/** A system error of a file operation as a few Polish words ("plik jest używany przez inny program"). */
function fileReason(err) {
  const code = String(err?.code ?? '');
  return REASONS[code] ?? (code.startsWith('Z_') ? 'archiwum jest uszkodzone' : String(err?.message ?? err));
}

module.exports = { walk, dirSize, mapLimit, isPlainName, cleanFolderName, freeName, stamp, explained, fileReason };
