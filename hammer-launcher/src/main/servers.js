'use strict';

/**
 * The multiplayer server list of an instance. It lives in the game's own servers.dat (plain NBT:
 * { servers: [ { name, ip, icon?, acceptTextures?, hidden? … } ] }), so a server added in the launcher shows up in
 * the game and the other way round. Entries are changed in place – icons and fields the launcher does not know
 * stay as they are. "Hidden" entries (the game's history of direct connections) are never shown and never touched.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readNbt, writeNbt, tag, get, text, number } = require('./nbt');
const { parseAddress } = require('./launch');

const FILE = 'servers.dat';
const MAX_NAME = 48;
const MAX_ICON = 256 * 1024; // base64 characters; the game's icons are 64×64 PNGs of a few kB

/** "mc.example.pl" or "mc.example.pl:25570" – trimmed and checked; throws a Polish message otherwise. */
function cleanAddress(address) {
  const raw = String(address ?? '').trim();
  const parsed = raw.length <= 260 ? parseAddress(raw) : null;
  const hostOk = parsed && parsed.ip.length <= 253 && /^[\p{L}\p{N}_]([\p{L}\p{N}._-]*[\p{L}\p{N}_])?$/u.test(parsed.ip) && !parsed.ip.includes('..');
  if (!hostOk || parsed.port < 1 || parsed.port > 65535) throw new Error('Podaj poprawny adres serwera, np. mc.hammershop.pl albo 192.168.1.10:25565.');
  return /:\d+$/.test(raw) ? `${parsed.ip}:${parsed.port}` : parsed.ip;
}

function cleanName(name, fallback) {
  const cleaned = String(name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (cleaned.length > MAX_NAME) throw new Error(`Nazwa serwera może mieć najwyżej ${MAX_NAME} znaków.`);
  return cleaned || fallback;
}

const isHidden = (entry) => Boolean(number(get(entry, 'hidden')));

/** servers.dat as tags: { root, entries } – a new empty list when the file is missing or unreadable (like the game). */
function load(instance) {
  let root = null;
  try {
    root = readNbt(fs.readFileSync(path.join(instance.dir, FILE)));
  } catch {
    root = null;
  }
  root ??= Object.assign(tag.compound(), { name: '', gzipped: false });
  let list = get(root, 'servers');
  if (list?.type !== 'list' || (list.value.length && list.elementType !== 'compound')) {
    list = tag.list('compound');
    root.value.set('servers', list);
  }
  return { root, list };
}

/** Writes the list back: shown servers in their order, then the hidden ones. The old file stays as servers.dat_old. */
function save(instance, { root, list }, shown) {
  const hidden = list.value.filter(isHidden);
  list.elementType = 'compound';
  list.value = [...shown, ...hidden];
  const file = path.join(instance.dir, FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(instance.dir, { recursive: true });
    fs.writeFileSync(tmp, writeNbt(root, { gzip: false }));
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, `${file}_old`);
    } catch {
      // the backup copy is a courtesy – the list is still saved
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Nie udało się zapisać listy serwerów (${err.code ?? err.message}). Sprawdź, czy plik servers.dat nie jest otwarty w innym programie.`, { cause: err });
  }
}

function describe(entry, index) {
  const icon = text(get(entry, 'icon'));
  const textures = number(get(entry, 'acceptTextures'));
  return {
    index,
    name: text(get(entry, 'name')) ?? '',
    address: text(get(entry, 'ip')) ?? '',
    icon: icon && icon.length <= MAX_ICON && /^[A-Za-z0-9+/=]+$/.test(icon) ? `data:image/png;base64,${icon}` : null,
    acceptTextures: textures == null ? null : Boolean(textures),
  };
}

const shownOf = (list) => list.value.filter((e) => !isHidden(e));

/** [{ index, name, address, icon (data URL or null), acceptTextures (true / false / null = ask) }] */
function list(instance) {
  return shownOf(load(instance).list).map(describe);
}

/** The entry at `index` of the shown servers; `expected` (its address) guards against a list changed by the game. */
function pick(shown, index, expected) {
  const entry = Number.isInteger(index) ? shown[index] : undefined;
  if (!entry || (expected != null && text(get(entry, 'ip')) !== String(expected))) throw new Error('Lista serwerów zmieniła się w międzyczasie – odśwież ją i spróbuj ponownie.');
  return entry;
}

function add(instance, { name, address } = {}) {
  const ip = cleanAddress(address);
  const data = load(instance);
  const shown = shownOf(data.list);
  if (shown.length >= 500) throw new Error('Lista serwerów jest pełna – usuń któryś, żeby dodać nowy.');
  shown.push(tag.compound({ name: tag.string(cleanName(name, ip)), ip: tag.string(ip) }));
  save(instance, data, shown);
  return list(instance);
}

function update(instance, index, patch = {}, expected) {
  const data = load(instance);
  const shown = shownOf(data.list);
  const entry = pick(shown, index, expected);
  if (patch.address !== undefined) {
    const ip = cleanAddress(patch.address);
    if (ip !== text(get(entry, 'ip'))) {
      entry.value.set('ip', tag.string(ip));
      entry.value.delete('icon'); // the icon belonged to the old address; the game fetches the new one
    }
  }
  if (patch.name !== undefined) entry.value.set('name', tag.string(cleanName(patch.name, text(get(entry, 'ip')) ?? '')));
  save(instance, data, shown);
  return list(instance);
}

function remove(instance, index, expected) {
  const data = load(instance);
  const shown = shownOf(data.list);
  shown.splice(shown.indexOf(pick(shown, index, expected)), 1);
  save(instance, data, shown);
  return list(instance);
}

function move(instance, from, to) {
  const data = load(instance);
  const shown = shownOf(data.list);
  const entry = pick(shown, from);
  if (!Number.isInteger(to) || to < 0 || to >= shown.length) throw new Error('Nie można przenieść serwera w to miejsce.');
  shown.splice(from, 1);
  shown.splice(to, 0, entry);
  save(instance, data, shown);
  return list(instance);
}

/**
 * Makes the shown list equal to `entries` ([{ name, address }], in that order) – used when a copy from the cloud
 * is taken. A server that stays (same address) keeps its icon and resource-pack choice; entries with a bad
 * address are left out. Returns true when the list changed – an equal list is not written again.
 */
function replace(instance, entries) {
  const data = load(instance);
  const shown = shownOf(data.list);
  const key = (list) => JSON.stringify(list.map((e) => [text(get(e, 'name')), text(get(e, 'ip'))]));
  const before = key(shown);
  const have = shown.map((entry) => ({ entry, address: text(get(entry, 'ip')) ?? '', used: false }));
  const next = [];
  for (const item of Array.isArray(entries) ? entries.slice(0, 500) : []) {
    let ip;
    try {
      ip = cleanAddress(item?.address);
    } catch {
      continue;
    }
    const name = String(item?.name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, MAX_NAME) || ip;
    const old = have.find((x) => !x.used && x.address === ip);
    if (old) {
      old.used = true;
      old.entry.value.set('name', tag.string(name));
      next.push(old.entry);
    } else next.push(tag.compound({ name: tag.string(name), ip: tag.string(ip) }));
  }
  if (key(next) === before) return false;
  save(instance, data, next);
  return true;
}

/**
 * Adds the servers of another game folder (the official Minecraft's) that this instance does not have yet.
 * A server is "already here" when its address matches. Names, icons and resource-pack choices come along;
 * hidden entries (the game's history of direct connections) do not.
 * Returns { found, added, skipped } – found is false when that folder has no readable server list.
 */
function importFrom(instance, sourceDir) {
  let source;
  try {
    source = readNbt(fs.readFileSync(path.join(sourceDir, FILE)));
  } catch {
    return { found: false, added: 0, skipped: 0 };
  }
  const theirs = get(source, 'servers');
  if (theirs?.type !== 'list') return { found: false, added: 0, skipped: 0 };
  const data = load(instance);
  const shown = shownOf(data.list);
  const key = (entry) => String(text(get(entry, 'ip')) ?? '').trim().toLowerCase();
  const have = new Set(shown.map(key));
  let added = 0;
  let skipped = 0;
  for (const entry of theirs.elementType === 'compound' ? theirs.value : []) {
    const address = key(entry);
    if (!address || isHidden(entry)) continue;
    if (have.has(address) || shown.length >= 500) {
      skipped += 1;
      continue;
    }
    have.add(address);
    shown.push(entry);
    added += 1;
  }
  if (added) save(instance, data, shown);
  return { found: true, added, skipped };
}

module.exports = { list, add, update, remove, move, replace, importFrom, cleanAddress, FILE };
