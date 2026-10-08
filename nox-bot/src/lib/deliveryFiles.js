'use strict';

/**
 * The files a buyer gets (src/features/delivery.js). Discord attachment links expire, so /product delivery
 * downloads each file once and keeps it in data/deliveries/<productId>/<name>. A delivery uploads them again.
 */

const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const db = require('./db');
const { UserError } = require('./utils');

const MAX_FILES = 5;
const MAX_TOTAL = 9 * 1024 * 1024; // all files of a product together – they're sent in one message (Discord takes 10 MB)

const dir = (productId) => path.join(db.dataDir, 'deliveries', productId);
const safeId = (id) => /^[\w-]{1,64}$/.test(String(id ?? ''));
const mb = (bytes) => `${(Math.ceil((bytes / 1024 / 1024) * 10) / 10).toFixed(1)} MB`;

/** "../My Key (1).txt" → "My_Key_1.txt" – no paths, no odd characters, at most 80 characters. */
function cleanName(name) {
  const base = path.basename(String(name ?? 'file')).replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').replace(/_+/g, '_');
  const ext = path.extname(base).slice(0, 12);
  const stem = base.slice(0, base.length - path.extname(base).length).slice(0, 80 - ext.length) || 'file';
  return `${stem}${ext}`;
}

/** Downloads slash command attachments → [{ name, buffer }] (checked before anything is downloaded). */
async function download(attachments, keptBytes = 0) {
  const list = attachments.filter(Boolean);
  const total = list.reduce((n, a) => n + (Number(a.size) || 0), keptBytes);
  if (total > MAX_TOTAL) throw new UserError(`Those files are ${mb(total)} together – a product can have up to **${mb(MAX_TOTAL)}** of files (they're sent in one message).`);
  const out = [];
  for (const a of list) {
    const res = await fetch(a.url, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (!res?.ok) throw new UserError(`I could not download **${cleanName(a.name)}** – please try again.`);
    const buffer = Buffer.from(await res.arrayBuffer());
    out.push({ name: cleanName(a.name), buffer });
  }
  if (out.reduce((n, f) => n + f.buffer.length, keptBytes) > MAX_TOTAL) throw new UserError(`Those files are too big together – up to **${mb(MAX_TOTAL)}**.`);
  return out;
}

/** Saves files for a product → [{ name, size }] (a file with the same name is replaced). */
function save(productId, files) {
  if (!safeId(productId)) throw new Error('Bad product id');
  fs.mkdirSync(dir(productId), { recursive: true });
  return files.map((f) => {
    fs.writeFileSync(path.join(dir(productId), f.name), f.buffer);
    return { name: f.name, size: f.buffer.length };
  });
}

/** Deletes the files of a product (all, or the names given). */
function remove(productId, names = null) {
  if (!safeId(productId)) return;
  if (!names) return fs.rmSync(dir(productId), { recursive: true, force: true });
  for (const n of names) fs.rmSync(path.join(dir(productId), cleanName(n)), { force: true });
}

/** The product's files as attachments – files missing on disk are left out (and listed in `missing`). */
function attachments(product) {
  const files = product?.delivery?.files ?? [];
  const found = [];
  const missing = [];
  for (const f of files) {
    const file = path.join(dir(product.id), f.name);
    if (safeId(product.id) && fs.existsSync(file)) found.push(new AttachmentBuilder(file, { name: f.name }));
    else missing.push(f.name);
  }
  return { files: found, missing };
}

module.exports = { MAX_FILES, MAX_TOTAL, cleanName, download, save, remove, attachments, mb };
