'use strict';

/**
 * Dodatki na postać (Hammer+) – wings, a halo and hats Hammer Client draws on the player model. The list and the flat
 * pictures for the tiles and the skin preview ship with the launcher (src/renderer/assets/cosmetics: cosmetics.json =
 * [{ id, slot, name, nameEn, front, back }] and <id>-front.png / <id>-back.png, drawn by hammer-client/tools/
 * gen_cosmetics.py together with the mod's own models). A player wears at most one per slot: wings, halo (on / off),
 * hat. The launcher only stores what was picked; the mod draws it and the shop tells other players' games.
 */

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'renderer', 'assets', 'cosmetics', 'cosmetics.json');
const SLOTS = ['wings', 'halo', 'hat'];
/** The settings key of each slot (settings.js). */
const KEYS = { wings: 'cosmeticWings', halo: 'cosmeticHalo', hat: 'cosmeticHat' };

/** [{ id, slot, name }] from cosmetics.json – an empty list when the file is missing or broken. */
function loadCosmetics(file = FILE) {
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
    if (typeof id !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(id) || seen.has(id) || !SLOTS.includes(entry.slot)) continue;
    seen.add(id);
    out.push({ id, slot: entry.slot, name: typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim().slice(0, 40) : id });
  }
  return out;
}

/** The ids of one slot ('wings' | 'hat'), as a Set. */
const idsOf = (slot, list = loadCosmetics()) => new Set(list.filter((c) => c.slot === slot).map((c) => c.id));

/** What a player wears, cleaned: { wings: id | '', halo: boolean, hat: id | '' } – unknown ids count as none. */
function cleanLook(look, list = loadCosmetics()) {
  const pick = (slot) => (typeof look?.[slot] === 'string' && list.some((c) => c.slot === slot && c.id === look[slot]) ? look[slot] : '');
  return { wings: pick('wings'), halo: look?.halo === true && list.some((c) => c.slot === 'halo'), hat: pick('hat') };
}

/** Is anything worn? */
const wearsAny = (look) => Boolean(look && (look.wings || look.halo || look.hat));

module.exports = { loadCosmetics, idsOf, cleanLook, wearsAny, SLOTS, KEYS, FILE };
