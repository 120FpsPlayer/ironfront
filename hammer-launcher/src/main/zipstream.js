'use strict';

/**
 * Zip files for world backups, written and read as streams. A world of several gigabytes never sits in memory and
 * the launcher stays responsive while it is packed (adm-zip keeps whole archives in RAM and works synchronously).
 *
 * The writer deflates files with data descriptors – the same layout as Java's ZipOutputStream – and simply stores
 * files that are compressed already (region files are most of a world, so a backup runs at disk speed). Zip64 is
 * used once an archive passes 4 GB or 65 535 files. The reader works from the central directory, so it also opens
 * the backups the game makes itself.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

const U32 = 0xffffffff;
const SIG = { local: 0x04034b50, descriptor: 0x08074b50, central: 0x02014b50, end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50 };
const UTF8 = 0x0800; // names are UTF-8 (bit 11)
const DESCRIPTOR = 0x0008; // CRC and sizes follow the data (bit 3) – they are not known before a file is deflated
const CHUNK = 256 * 1024;
const MAX_DIRECTORY = 64 * 1024 * 1024;
const EMPTY = Buffer.alloc(0);
/** Already compressed files gain nothing from deflate – they are stored as they are. */
const PACKED = /\.(mca|mcc|png|jpe?g|ogg|zip|jar|gz)$/i;

let crcTable = null;
function crc32Fallback(buf, crc = 0) {
  crcTable ??= Uint32Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = (crc ^ U32) >>> 0;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ U32) >>> 0;
}
/** zlib.crc32 exists since Node 20.15 / 22.2. */
const crc32 = typeof zlib.crc32 === 'function' ? zlib.crc32 : crc32Fallback;

const badZip = () => new Error('To nie jest poprawny plik .zip albo archiwum jest uszkodzone.');

function dosTime(ms) {
  const d = new Date(ms ?? Date.now());
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** The Zip64 extra field (id 1) with the given 64-bit values. */
function zip64Extra(values) {
  const buf = Buffer.alloc(4 + values.length * 8);
  buf.writeUInt16LE(1, 0);
  buf.writeUInt16LE(values.length * 8, 2);
  values.forEach((v, i) => buf.writeBigUInt64LE(BigInt(v), 4 + i * 8));
  return buf;
}

/**
 * Writes `files` ([{ path, name, size?, mtimeMs? }], names with "/") into a new zip at `dest`.
 * onProgress(bytesRead) is called while packing. The archive appears under its name only when it is complete.
 * `zip64: true` forces the Zip64 layout (used by the tests; otherwise it is chosen when needed).
 */
async function createZip(dest, files, { onProgress, zip64 = false } = {}) {
  const tmp = `${dest}.part`;
  const handle = await fsp.open(tmp, 'w');
  let offset = 0;
  const writeAt = async (buf, position) => {
    let done = 0;
    while (done < buf.length) done += (await handle.write(buf, done, buf.length - done, position + done)).bytesWritten;
  };
  const write = async (buf) => {
    await writeAt(buf, offset);
    offset += buf.length;
  };
  const entries = [];
  let read = 0;
  try {
    for (const file of files) {
      const name = Buffer.from(String(file.name).replace(/\\/g, '/'), 'utf8');
      if (!name.length || name.length > 0xffff) throw new Error(`Nieprawidłowa nazwa pliku: ${file.name}`);
      const stored = PACKED.test(file.name);
      const big = zip64 || (file.size ?? 0) >= U32; // 64-bit sizes in the local header / data descriptor
      const entry = { name, big, offset, crc: 0, size: 0, compressed: 0, method: stored ? 0 : 8, flags: stored ? UTF8 : UTF8 | DESCRIPTOR, ...dosTime(file.mtimeMs) };
      const head = Buffer.alloc(30);
      head.writeUInt32LE(SIG.local, 0);
      head.writeUInt16LE(big ? 45 : 20, 4);
      head.writeUInt16LE(entry.flags, 6);
      head.writeUInt16LE(entry.method, 8);
      head.writeUInt16LE(entry.time, 10);
      head.writeUInt16LE(entry.date, 12);
      if (big) {
        head.writeUInt32LE(U32, 18);
        head.writeUInt32LE(U32, 22);
      }
      head.writeUInt16LE(name.length, 26);
      head.writeUInt16LE(big ? 20 : 0, 28);
      await write(Buffer.concat([head, name, big ? zip64Extra([0, 0]) : EMPTY]));
      const count = async function* (source) {
        for await (const chunk of source) {
          entry.crc = crc32(chunk, entry.crc);
          entry.size += chunk.length;
          read += chunk.length;
          onProgress?.(read);
          yield chunk;
        }
      };
      const save = async (source) => {
        for await (const chunk of source) {
          entry.compressed += chunk.length;
          await write(chunk);
        }
      };
      const source = fs.createReadStream(file.path, { highWaterMark: CHUNK });
      if (stored) {
        // Stored: the data goes in unchanged, then the CRC and sizes are filled in at the front.
        await pipeline(source, count, save);
        if (!big && entry.size >= U32) throw new Error(`Plik zmienił się w trakcie kopii: ${file.name}`);
        const sums = Buffer.alloc(12);
        sums.writeUInt32LE(entry.crc, 0);
        sums.writeUInt32LE(big ? U32 : entry.size, 4);
        sums.writeUInt32LE(big ? U32 : entry.size, 8);
        await writeAt(sums, entry.offset + 14);
        if (big) await writeAt(zip64Extra([entry.size, entry.size]), entry.offset + 30 + name.length);
      } else {
        await pipeline(source, count, zlib.createDeflateRaw({ chunkSize: CHUNK }), save);
        const desc = Buffer.alloc(big ? 24 : 16);
        desc.writeUInt32LE(SIG.descriptor, 0);
        desc.writeUInt32LE(entry.crc, 4);
        if (big) {
          desc.writeBigUInt64LE(BigInt(entry.compressed), 8);
          desc.writeBigUInt64LE(BigInt(entry.size), 16);
        } else {
          desc.writeUInt32LE(Math.min(entry.compressed, U32), 8);
          desc.writeUInt32LE(Math.min(entry.size, U32), 12);
        }
        await write(desc);
      }
      entries.push(entry);
    }

    // Central directory.
    const directoryStart = offset;
    const directory = [];
    for (const e of entries) {
      const sizes64 = e.big || e.size >= U32 || e.compressed >= U32;
      const offset64 = zip64 || e.offset >= U32;
      const extra = sizes64 || offset64 ? zip64Extra([...(sizes64 ? [e.size, e.compressed] : []), ...(offset64 ? [e.offset] : [])]) : EMPTY;
      const c = Buffer.alloc(46);
      c.writeUInt32LE(SIG.central, 0);
      c.writeUInt16LE(extra.length ? 45 : 20, 4);
      c.writeUInt16LE(extra.length ? 45 : 20, 6);
      c.writeUInt16LE(e.flags, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(sizes64 ? U32 : e.compressed, 20);
      c.writeUInt32LE(sizes64 ? U32 : e.size, 24);
      c.writeUInt16LE(e.name.length, 28);
      c.writeUInt16LE(extra.length, 30);
      c.writeUInt32LE(offset64 ? U32 : e.offset, 42);
      directory.push(c, e.name, extra);
    }
    await write(Buffer.concat(directory));
    const directorySize = offset - directoryStart;

    // End of central directory (with the Zip64 records in front when the plain one is too small).
    const end64 = zip64 || entries.length >= 0xffff || directorySize >= U32 || directoryStart >= U32;
    const tail = [];
    if (end64) {
      const record = Buffer.alloc(56);
      record.writeUInt32LE(SIG.end64, 0);
      record.writeBigUInt64LE(44n, 4);
      record.writeUInt16LE(45, 12);
      record.writeUInt16LE(45, 14);
      record.writeBigUInt64LE(BigInt(entries.length), 24);
      record.writeBigUInt64LE(BigInt(entries.length), 32);
      record.writeBigUInt64LE(BigInt(directorySize), 40);
      record.writeBigUInt64LE(BigInt(directoryStart), 48);
      const locator = Buffer.alloc(20);
      locator.writeUInt32LE(SIG.locator64, 0);
      locator.writeBigUInt64LE(BigInt(offset), 8);
      locator.writeUInt32LE(1, 16);
      tail.push(record, locator);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG.end, 0);
    end.writeUInt16LE(end64 ? 0xffff : entries.length, 8);
    end.writeUInt16LE(end64 ? 0xffff : entries.length, 10);
    end.writeUInt32LE(end64 ? U32 : directorySize, 12);
    end.writeUInt32LE(end64 ? U32 : directoryStart, 16);
    tail.push(end);
    await write(Buffer.concat(tail));
    await handle.close();
    await fsp.rename(tmp, dest);
    return { files: entries.length, size: read, bytes: offset };
  } catch (err) {
    await handle.close().catch(() => null);
    await fsp.rm(tmp, { force: true }).catch(() => null);
    throw err;
  }
}

/**
 * Opens a zip for reading: { entries, extract(entry, dest, onBytes), close() }.
 * entries: [{ name, size, compressedSize, directory, symlink, … }] exactly as stored – the caller decides where a
 * name may be written (see the zip-slip guard in worlds.js).
 */
async function openZip(file) {
  const handle = await fsp.open(file, 'r');
  try {
    const total = (await handle.stat()).size;
    const read = async (position, length) => {
      if (position < 0 || length < 0 || position + length > total) throw badZip();
      const buf = Buffer.alloc(length);
      let got = 0;
      while (got < length) {
        const { bytesRead } = await handle.read(buf, got, length - got, position + got);
        if (!bytesRead) throw badZip();
        got += bytesRead;
      }
      return buf;
    };

    const tailLength = Math.min(total, 22 + 0xffff);
    const tail = await read(total - tailLength, tailLength);
    let at = -1;
    for (let i = tail.length - 22; i >= 0 && at < 0; i--) if (tail.readUInt32LE(i) === SIG.end) at = i;
    if (at < 0) throw badZip();
    let directorySize = tail.readUInt32LE(at + 12);
    let directoryStart = tail.readUInt32LE(at + 16);
    if (at >= 20 && tail.readUInt32LE(at - 20) === SIG.locator64) {
      const record = await read(Number(tail.readBigUInt64LE(at - 12)), 56);
      if (record.readUInt32LE(0) !== SIG.end64) throw badZip();
      directorySize = Number(record.readBigUInt64LE(40));
      directoryStart = Number(record.readBigUInt64LE(48));
    }
    if (directorySize > MAX_DIRECTORY) throw badZip();
    const cd = await read(directoryStart, directorySize);

    const entries = [];
    try {
      for (let p = 0; p + 46 <= cd.length; ) {
        if (cd.readUInt32LE(p) !== SIG.central) throw badZip();
        const nameLength = cd.readUInt16LE(p + 28);
        const extraLength = cd.readUInt16LE(p + 30);
        const entry = {
          name: cd.subarray(p + 46, p + 46 + nameLength).toString('utf8'),
          method: cd.readUInt16LE(p + 10),
          crc: cd.readUInt32LE(p + 16),
          compressedSize: cd.readUInt32LE(p + 20),
          size: cd.readUInt32LE(p + 24),
          offset: cd.readUInt32LE(p + 42),
          encrypted: Boolean(cd.readUInt16LE(p + 8) & 1),
          // Unix archives keep the file type in the upper half of the external attributes.
          symlink: cd.readUInt16LE(p + 4) >> 8 === 3 && ((cd.readUInt32LE(p + 38) >>> 16) & 0xf000) === 0xa000,
        };
        const extraEnd = p + 46 + nameLength + extraLength;
        for (let x = p + 46 + nameLength; x + 4 <= extraEnd; x += 4 + cd.readUInt16LE(x + 2)) {
          if (cd.readUInt16LE(x) !== 1) continue;
          let q = x + 4;
          for (const key of ['size', 'compressedSize', 'offset']) {
            if (entry[key] !== U32) continue;
            entry[key] = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
        }
        entry.directory = entry.name.endsWith('/');
        entries.push(entry);
        p = extraEnd + cd.readUInt16LE(p + 32);
      }
    } catch {
      throw badZip();
    }

    /** Unpacks one entry into a new file (never over an existing one); checks its size and CRC. */
    async function extract(entry, dest, onBytes) {
      if (entry.encrypted) throw new Error('To archiwum jest zaszyfrowane – launcher nie potrafi go otworzyć.');
      if (entry.method !== 0 && entry.method !== 8) throw new Error('To archiwum używa kompresji, której launcher nie obsługuje.');
      if (entry.compressedSize === 0) {
        if (entry.size !== 0) throw badZip();
        return fsp.writeFile(dest, EMPTY, { flag: 'wx' });
      }
      const head = await read(entry.offset, 30);
      if (head.readUInt32LE(0) !== SIG.local) throw badZip();
      const start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
      if (start + entry.compressedSize > total) throw badZip();
      let crc = 0;
      let written = 0;
      const check = async function* (source) {
        for await (const chunk of source) {
          written += chunk.length;
          if (written > entry.size) throw badZip(); // more data than the archive promised (zip bomb)
          crc = crc32(chunk, crc);
          onBytes?.(chunk.length);
          yield chunk;
        }
      };
      const steps = [fs.createReadStream(file, { start, end: start + entry.compressedSize - 1, highWaterMark: CHUNK })];
      if (entry.method === 8) steps.push(zlib.createInflateRaw({ chunkSize: CHUNK }));
      await pipeline(...steps, check, fs.createWriteStream(dest, { flags: 'wx' }));
      if (written !== entry.size || crc !== entry.crc) throw new Error('Archiwum jest uszkodzone (plik ma złą sumę kontrolną).');
      return undefined;
    }

    return { entries, extract, close: () => handle.close() };
  } catch (err) {
    await handle.close().catch(() => null);
    throw err;
  }
}

module.exports = { createZip, openZip, crc32, crc32Fallback };
