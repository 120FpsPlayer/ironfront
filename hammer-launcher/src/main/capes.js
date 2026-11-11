'use strict';

/**
 * Peleryny Hammer+ – the capes Hammer Client draws for players with Hammer+. The list and the pictures ship with
 * the launcher (src/renderer/assets/capes: capes.json = [{ id, name, nameEn }] and <id>.png, the standard cape
 * layout); the mod carries the same ones. The launcher only stores which one the player picked.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'renderer', 'assets', 'capes', 'capes.json');

/** [{ id, name }] from capes.json – an empty list when the file is missing or broken. */
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
    out.push({ id, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 40) : id });
  }
  return out;
}

module.exports = { loadCapes, FILE };
