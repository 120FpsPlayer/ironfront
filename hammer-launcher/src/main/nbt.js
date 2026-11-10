'use strict';

/**
 * NBT (Named Binary Tag) – the format of Minecraft's servers.dat (plain) and level.dat (gzip). Reads and writes every
 * tag type, big-endian like Java Edition. Tag types, the order of compound entries and fields the launcher does not
 * know are kept, so a file that is read, changed in one place and written back stays the same everywhere else.
 *
 * A tag is { type, value }:
 *   byte, short, int, float, double → number        long → BigInt
 *   string → string                                  byteArray → Buffer
 *   intArray → Int32Array                            longArray → BigInt64Array
 *   list → { type: 'list', elementType, value: [tag, …] }
 *   compound → { type: 'compound', value: Map<name, tag> }
 * The root returned by readNbt also carries `name` (usually '') and `gzipped`.
 */

const zlib = require('node:zlib');

const TYPES = ['end', 'byte', 'short', 'int', 'long', 'float', 'double', 'byteArray', 'string', 'list', 'compound', 'intArray', 'longArray'];
const ID = Object.fromEntries(TYPES.map((t, i) => [t, i]));
const MAX_DEPTH = 512; // the same limit as the game
const MAX_INFLATED = 256 * 1024 * 1024;

/** Java's "modified UTF-8": every UTF-16 unit on its own (surrogates take 3 bytes each), U+0000 as C0 80. */
function decodeString(buf, start, end) {
  let out = '';
  const units = [];
  let i = start;
  while (i < end) {
    const a = buf[i++];
    if (a < 0x80) units.push(a);
    else if ((a & 0xe0) === 0xc0 && i < end) units.push(((a & 0x1f) << 6) | (buf[i++] & 0x3f));
    else if ((a & 0xf0) === 0xe0 && i + 1 < end) {
      units.push(((a & 0x0f) << 12) | ((buf[i] & 0x3f) << 6) | (buf[i + 1] & 0x3f));
      i += 2;
    } else if ((a & 0xf8) === 0xf0 && i + 2 < end) {
      // Plain UTF-8 for a character outside the BMP – not what Java writes, but other tools do.
      const cp = (((a & 0x07) << 18) | ((buf[i] & 0x3f) << 12) | ((buf[i + 1] & 0x3f) << 6) | (buf[i + 2] & 0x3f)) - 0x10000;
      units.push(0xd800 | ((cp >> 10) & 0x3ff), 0xdc00 | (cp & 0x3ff));
      i += 3;
    } else units.push(0xfffd);
    if (units.length >= 4096) {
      out += String.fromCharCode(...units);
      units.length = 0;
    }
  }
  return out + String.fromCharCode(...units);
}

function encodeString(str) {
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    len += c >= 1 && c <= 0x7f ? 1 : c <= 0x7ff ? 2 : 3;
  }
  if (len > 0xffff) throw new RangeError('NBT: a string is longer than 65535 bytes');
  const out = Buffer.allocUnsafe(len);
  let p = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 1 && c <= 0x7f) out[p++] = c;
    else if (c <= 0x7ff) {
      out[p++] = 0xc0 | (c >> 6);
      out[p++] = 0x80 | (c & 0x3f);
    } else {
      out[p++] = 0xe0 | (c >> 12);
      out[p++] = 0x80 | ((c >> 6) & 0x3f);
      out[p++] = 0x80 | (c & 0x3f);
    }
  }
  return out;
}

/* ── reading ── */

function createReader(buf) {
  let pos = 0;
  const take = (n) => {
    if (n < 0 || pos + n > buf.length) throw new RangeError('NBT: unexpected end of data');
    pos += n;
    return pos - n;
  };
  const r = {
    u8: () => buf[take(1)],
    i8: () => buf.readInt8(take(1)),
    i16: () => buf.readInt16BE(take(2)),
    u16: () => buf.readUInt16BE(take(2)),
    i32: () => buf.readInt32BE(take(4)),
    i64: () => buf.readBigInt64BE(take(8)),
    bytes: (n) => {
      const at = take(n);
      return Buffer.from(buf.subarray(at, at + n)); // a copy – the tag must not keep the whole file alive
    },
    string: () => {
      const len = r.u16();
      const at = take(len);
      return decodeString(buf, at, at + len);
    },
    /** Floats keep their exact bytes when they are NaN (JavaScript would normalise the payload). */
    float: (type, size) => {
      const at = take(size);
      const value = size === 4 ? buf.readFloatBE(at) : buf.readDoubleBE(at);
      return Number.isNaN(value) ? { type, value, raw: Buffer.from(buf.subarray(at, at + size)) } : { type, value };
    },
  };
  return r;
}

function readPayload(r, id, depth) {
  if (depth > MAX_DEPTH) throw new RangeError('NBT: tags are nested too deep');
  switch (id) {
    case 1:
      return { type: 'byte', value: r.i8() };
    case 2:
      return { type: 'short', value: r.i16() };
    case 3:
      return { type: 'int', value: r.i32() };
    case 4:
      return { type: 'long', value: r.i64() };
    case 5:
      return r.float('float', 4);
    case 6:
      return r.float('double', 8);
    case 7:
      return { type: 'byteArray', value: r.bytes(r.i32()) };
    case 8:
      return { type: 'string', value: r.string() };
    case 9: {
      const elementId = r.u8();
      const count = Math.max(0, r.i32());
      if (elementId > 12) throw new RangeError(`NBT: unknown tag type ${elementId}`);
      if (elementId === 0 && count > 0) throw new RangeError('NBT: a list without an element type');
      const value = [];
      for (let i = 0; i < count; i++) value.push(readPayload(r, elementId, depth + 1));
      return { type: 'list', elementType: TYPES[elementId], value };
    }
    case 10: {
      const value = new Map();
      for (;;) {
        const child = r.u8();
        if (child === 0) break;
        if (child > 12) throw new RangeError(`NBT: unknown tag type ${child}`);
        const name = r.string();
        value.set(name, readPayload(r, child, depth + 1));
      }
      return { type: 'compound', value };
    }
    case 11: {
      const count = r.i32();
      const raw = r.bytes(count * 4);
      const value = new Int32Array(count);
      for (let i = 0; i < count; i++) value[i] = raw.readInt32BE(i * 4);
      return { type: 'intArray', value };
    }
    case 12: {
      const count = r.i32();
      const raw = r.bytes(count * 8);
      const value = new BigInt64Array(count);
      for (let i = 0; i < count; i++) value[i] = raw.readBigInt64BE(i * 8);
      return { type: 'longArray', value };
    }
    default:
      throw new RangeError(`NBT: unknown tag type ${id}`);
  }
}

/** Parses an NBT file (gzip is detected by its magic bytes). The root has to be a compound, like in the game. */
function readNbt(input) {
  let buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const gzipped = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (gzipped) buf = zlib.gunzipSync(buf, { maxOutputLength: MAX_INFLATED });
  const r = createReader(buf);
  if (r.u8() !== ID.compound) throw new RangeError('NBT: the root tag is not a compound');
  const name = r.string();
  const root = readPayload(r, ID.compound, 0);
  root.name = name;
  root.gzipped = gzipped;
  return root;
}

/* ── writing ── */

function createWriter() {
  let buf = Buffer.allocUnsafe(4096);
  let pos = 0;
  const room = (n) => {
    if (pos + n > buf.length) {
      const next = Buffer.allocUnsafe(Math.max(buf.length * 2, pos + n));
      buf.copy(next, 0, 0, pos);
      buf = next;
    }
    pos += n;
    return pos - n;
  };
  const w = {
    u8: (v) => buf.writeUInt8(v, room(1)),
    i8: (v) => buf.writeInt8(v, room(1)),
    i16: (v) => buf.writeInt16BE(v, room(2)),
    i32: (v) => buf.writeInt32BE(v, room(4)),
    i64: (v) => buf.writeBigInt64BE(v, room(8)),
    f32: (v) => buf.writeFloatBE(v, room(4)),
    f64: (v) => buf.writeDoubleBE(v, room(8)),
    bytes: (b) => b.copy(buf, room(b.length)),
    string: (s) => {
      const b = encodeString(String(s));
      buf.writeUInt16BE(b.length, room(2));
      w.bytes(b);
    },
    done: () => Buffer.from(buf.subarray(0, pos)),
  };
  return w;
}

function writePayload(w, tag, depth) {
  if (depth > MAX_DEPTH) throw new RangeError('NBT: tags are nested too deep');
  const { type, value } = tag ?? {};
  switch (type) {
    case 'byte':
      return w.i8(value);
    case 'short':
      return w.i16(value);
    case 'int':
      return w.i32(value);
    case 'long':
      return w.i64(BigInt(value));
    case 'float':
      return tag.raw && Number.isNaN(value) ? w.bytes(tag.raw) : w.f32(value);
    case 'double':
      return tag.raw && Number.isNaN(value) ? w.bytes(tag.raw) : w.f64(value);
    case 'byteArray':
      w.i32(value.length);
      return w.bytes(Buffer.isBuffer(value) ? value : Buffer.from(value));
    case 'string':
      return w.string(value);
    case 'list': {
      const elementType = tag.elementType ?? value[0]?.type ?? 'end';
      if (ID[elementType] === undefined) throw new TypeError(`NBT: unknown list type ${elementType}`);
      w.u8(ID[elementType]);
      w.i32(value.length);
      for (const item of value) {
        if (item?.type !== elementType) throw new TypeError(`NBT: a list of ${elementType} cannot hold ${item?.type}`);
        writePayload(w, item, depth + 1);
      }
      return undefined;
    }
    case 'compound': {
      for (const [name, child] of value) {
        if (!ID[child?.type]) throw new TypeError(`NBT: "${name}" is not a tag`);
        w.u8(ID[child.type]);
        w.string(name);
        writePayload(w, child, depth + 1);
      }
      return w.u8(ID.end);
    }
    case 'intArray':
      w.i32(value.length);
      for (const v of value) w.i32(v);
      return undefined;
    case 'longArray':
      w.i32(value.length);
      for (const v of value) w.i64(BigInt(v));
      return undefined;
    default:
      throw new TypeError(`NBT: unknown tag type ${type}`);
  }
}

/** The bytes of an NBT file. `gzip` defaults to how the root was read (level.dat stays gzipped, servers.dat plain). */
function writeNbt(root, { gzip = Boolean(root?.gzipped) } = {}) {
  if (root?.type !== 'compound') throw new TypeError('NBT: the root tag is not a compound');
  const w = createWriter();
  w.u8(ID.compound);
  w.string(root.name ?? '');
  writePayload(w, root, 0);
  const out = w.done();
  return gzip ? zlib.gzipSync(out) : out;
}

/* ── building and reading single tags ── */

const tag = {
  byte: (v) => ({ type: 'byte', value: Number(v) }),
  short: (v) => ({ type: 'short', value: Number(v) }),
  int: (v) => ({ type: 'int', value: Number(v) }),
  long: (v) => ({ type: 'long', value: BigInt(v) }),
  float: (v) => ({ type: 'float', value: Number(v) }),
  double: (v) => ({ type: 'double', value: Number(v) }),
  string: (v) => ({ type: 'string', value: String(v) }),
  byteArray: (v) => ({ type: 'byteArray', value: Buffer.from(v) }),
  intArray: (v) => ({ type: 'intArray', value: Int32Array.from(v) }),
  longArray: (v) => ({ type: 'longArray', value: BigInt64Array.from(Array.from(v, (x) => BigInt(x))) }),
  list: (elementType, items = []) => ({ type: 'list', elementType, value: [...items] }),
  /** From a Map or a plain object of tags, in that order (JavaScript moves number-like keys of an object to the front – use a Map for those). */
  compound: (entries = {}) => ({ type: 'compound', value: new Map(entries instanceof Map ? entries : Object.entries(entries)) }),
};

/** Follows names (compounds) and indexes (lists): get(root, 'Data', 'Version', 'Name'). Undefined when missing. */
function get(node, ...path) {
  let current = node;
  for (const key of path) {
    if (current?.type === 'compound') current = current.value.get(String(key));
    else if (current?.type === 'list' && Number.isInteger(key)) current = current.value[key];
    else return undefined;
  }
  return current;
}

/** The text of a string tag, or null. */
const text = (t) => (t?.type === 'string' ? t.value : null);
/** The number of any numeric tag (longs as Number – fine for timestamps), or null. */
const number = (t) => (['byte', 'short', 'int', 'float', 'double'].includes(t?.type) ? t.value : t?.type === 'long' ? Number(t.value) : null);

module.exports = { readNbt, writeNbt, tag, get, text, number, TYPES };
