'use strict';

/**
 * Peleryny Hammer – the capes Hammer Client draws. The list and the pictures ship with the launcher
 * (src/renderer/assets/capes: capes.json = [{ id, name, nameEn, free, frames?, fps? }] and <id>.png, the standard cape
 * layout – for a moving cape a strip of `frames` such pictures, one under the other, made by
 * hammer-client/tools/gen_cosmetics.py); the mod carries the same ones. `free` capes are for everybody, the rest (the
 * moving ones too, and a cape of one's own) need Hammer+.
 * The launcher only stores which one the player picked.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'renderer', 'assets', 'capes', 'capes.json');

/** [{ id, name, free }] from capes.json – an empty list when the file is missing or broken. */
function loadCapes(file = FILE) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const id = entry?.id;
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    const cape = { id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 40) : id, free: entry.free === true };
    // A moving cape: its picture is a strip of `frames` cape pictures one under the other, shown `fps` per second.
    if (Number.isInteger(entry.frames) && entry.frames > 1 && entry.frames <= 64) Object.assign(cape, { frames: entry.frames, fps: Number.isInteger(entry.fps) && entry.fps >= 1 && entry.fps <= 30 ? entry.fps : 10 });
    out.push(cape);
  }
  return out;
}

/** The ids everybody may wear without Hammer+. */
const freeCapes = (list = loadCapes()) => new Set(list.filter((c) => c.free).map((c) => c.id));

module.exports = { loadCapes, freeCapes, FILE, CUSTOM: 'custom' };
