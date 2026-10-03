'use strict';

/**
 * Product images. Discord attachment links expire, so /product add | edit downloads the image once and keeps it
 * in data/products/<productId>.<ext>. Messages upload it again and show it with attachment://product-<id>.<ext>.
 */

const fs = require('node:fs');
const path = require('node:path');
const { AttachmentBuilder } = require('discord.js');
const db = require('./db');
const { UserError } = require('./utils');

const MAX_BYTES = 1024 * 1024;
const EXTS = ['png', 'jpg', 'webp', 'gif'];
const TYPES = 'PNG, JPG, WEBP or GIF';

const dir = () => path.join(db.dataDir, 'products');
const safeId = (id) => /^[\w-]{1,64}$/.test(String(id ?? ''));
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** The real file type from the first bytes – the name or content type of an upload can lie. */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Checks a slash command attachment before anything is downloaded (throws a friendly UserError). */
function check(attachment) {
  const name = String(attachment?.name ?? '').toLowerCase();
  const type = String(attachment?.contentType ?? '').toLowerCase();
  const ok = /^image\/(png|jpe?g|webp|gif)$/.test(type) || (!type && /\.(png|jpe?g|webp|gif)$/.test(name));
  if (!ok) throw new UserError(`The product image must be a ${TYPES} file.`);
  if (attachment.size > MAX_BYTES) {
    throw new UserError(`That image is ${mb(attachment.size)} – product images can be up to **1 MB**. Make it smaller (e.g. with squoosh.app or tinypng.com) and try again.`);
  }
}

/** Downloads a slash command attachment → { buffer, ext } (null when there is none). */
async function download(attachment) {
  if (!attachment?.url) return null;
  check(attachment);
  const res = await fetch(attachment.url).catch(() => null);
  if (!res?.ok) throw new UserError('I could not download that image – please try again.');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new UserError(`That image is ${mb(buffer.length)} – product images can be up to **1 MB**.`);
  const ext = sniff(buffer);
  if (!ext) throw new UserError(`That file is not a real ${TYPES} image.`);
  return { buffer, ext };
}

/** Deletes every stored image of a product. */
function remove(productId) {
  if (!safeId(productId)) return;
  for (const ext of EXTS) fs.rmSync(path.join(dir(), `${productId}.${ext}`), { force: true });
}

/** Stores an image for a product (replacing the old one) → what goes into product.image. */
function save(productId, { buffer, ext }) {
  if (!safeId(productId) || !EXTS.includes(ext)) throw new Error(`Invalid product image ${productId}.${ext}`);
  remove(productId);
  fs.mkdirSync(dir(), { recursive: true });
  fs.writeFileSync(path.join(dir(), `${productId}.${ext}`), buffer);
  return { ext, size: buffer.length, at: Date.now() };
}

/** Path of the product's image, or null when it has none or the file is gone. */
function file(product) {
  const ext = product?.image?.ext;
  if (!ext || !EXTS.includes(ext) || !safeId(product.id)) return null;
  const p = path.join(dir(), `${product.id}.${ext}`);
  return fs.existsSync(p) ? p : null;
}

/** { url: 'attachment://…', file: AttachmentBuilder, size } for a message – null without a usable image. */
function attachment(product) {
  const p = file(product);
  if (!p) return null;
  const name = `product-${product.id}.${product.image.ext}`;
  return { url: `attachment://${name}`, file: new AttachmentBuilder(p, { name, description: product.name }), size: fs.statSync(p).size };
}

module.exports = { MAX_BYTES, sniff, check, download, save, remove, file, attachment };
