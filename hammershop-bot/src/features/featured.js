'use strict';

/**
 * Featured servers – the Minecraft servers Hammer Launcher recommends on its start page. The team manages the list
 * with /featured (src/commands/featured.js); the launcher reads it from the website: GET /api/launcher/featured
 * (src/web/launcher.js, handed over by src/features/website.js).
 *
 *   db.guild(id).featuredServers = [{ id, name, address, description, tags, icon, mc, loader, pack, addedBy, addedAt }]
 *     id – from the name ("hammer-smp") · address – host or host:port, lowercase · tags – up to 6 short words
 *     icon – an https picture or null · mc – "1.21.4" or null · loader – one of LOADERS or null · pack – text or null
 */

const db = require('../lib/db');
const { UserError } = require('../lib/utils');

const LOADERS = ['fabric', 'quilt', 'forge', 'neoforge', 'vanilla'];
const MAX_SERVERS = 25;
const MAX_TAGS = 6;
const LIMITS = { name: 40, description: 200, tag: 20, icon: 300, pack: 200 };
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MC_VERSION = /^\d{1,2}\.\d{1,3}(?:\.\d{1,3})?$/;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const list = (guildId) => db.guild(guildId).featuredServers;
const find = (guildId, id) => list(guildId).find((s) => s.id === id) ?? null;

/** "Play.Example.pl:25566" → "play.example.pl:25566". Throws a UserError when it isn't host or host:port. */
function parseAddress(raw) {
  const bad = () => new UserError('Podaj adres serwera jako **host** albo **host:port**, np. `mc.hammershop.pl` albo `mc.hammershop.pl:25566` – bez `https://` i bez spacji.');
  const text = String(raw ?? '').trim().toLowerCase();
  const m = /^([^:\s/]+)(?::(\d{1,5}))?$/.exec(text);
  if (!m) throw bad();
  const [, host, port] = m;
  const labels = host.split('.');
  // A name people can reach: a domain (mc.example.pl) or an IPv4 address – "localhost" or a lone word is a typo here.
  if (host.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l))) throw bad();
  if (labels.every((l) => /^\d+$/.test(l)) && !(labels.length === 4 && labels.every((l) => Number(l) <= 255))) throw bad();
  if (port !== undefined && !(Number(port) >= 1 && Number(port) <= 65_535)) throw new UserError('Port serwera musi być liczbą od 1 do 65535.');
  return port === undefined ? host : `${host}:${Number(port)}`;
}

/** The icon must be an https picture address – http, data: and anything else is refused. */
function parseIcon(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let url = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }
  if (!url || url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password || text.length > LIMITS.icon) {
    throw new UserError(`Ikona musi być adresem obrazka zaczynającym się od \`https://\` (najwyżej ${LIMITS.icon} znaków).`);
  }
  return url.href;
}

/** "Survival, PvP ,  survival" → ['survival', 'pvp'] */
function parseTags(raw) {
  const tags = [...new Set(String(raw ?? '').split(',').map((t) => clean(t).toLowerCase()).filter(Boolean))];
  if (tags.length > MAX_TAGS) throw new UserError(`Podaj najwyżej ${MAX_TAGS} tagów, oddzielonych przecinkami.`);
  const long = tags.find((t) => t.length > LIMITS.tag);
  if (long) throw new UserError(`Tag „${long.slice(0, 30)}” jest za długi – najwyżej ${LIMITS.tag} znaków.`);
  return tags;
}

/** "Hammer SMP ⚒" → "hammer-smp" (and "hammer-smp-2" when taken). */
function newId(guildId, name) {
  const base =
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32)
      .replace(/-+$/, '') || 'serwer';
  let id = base;
  for (let n = 2; find(guildId, id); n += 1) id = `${base}-${n}`;
  return id;
}

/** Adds a server to the list (checked first – a UserError says what is wrong). → the new entry. */
function add(guildId, { name, address, description, tags = null, icon = null, mc = null, loader = null, pack = null, addedBy = null }) {
  const servers = list(guildId);
  const entry = {
    name: clean(name),
    address: parseAddress(address),
    description: clean(description),
    tags: parseTags(tags),
    icon: parseIcon(icon),
    mc: clean(mc) || null,
    loader: clean(loader).toLowerCase() || null,
    pack: clean(pack) || null,
  };
  if (!entry.name || entry.name.length > LIMITS.name) throw new UserError(`Nazwa serwera musi mieć od 1 do ${LIMITS.name} znaków.`);
  if (!entry.description || entry.description.length > LIMITS.description) throw new UserError(`Opis musi mieć od 1 do ${LIMITS.description} znaków.`);
  if (entry.mc && !MC_VERSION.test(entry.mc)) throw new UserError('Wersję Minecrafta podaj jako same liczby, np. `1.21.4` albo `1.20`.');
  if (entry.loader && !LOADERS.includes(entry.loader)) throw new UserError(`Nieznany loader. Do wyboru: ${LOADERS.join(', ')}.`);
  if (entry.pack && entry.pack.length > LIMITS.pack) throw new UserError(`Paczka może mieć najwyżej ${LIMITS.pack} znaków.`);
  const same = servers.find((s) => s.address === entry.address);
  if (same) throw new UserError(`Serwer **${entry.address}** jest już na liście polecanych jako **${same.name}** – usuń go najpierw, jeśli chcesz dodać go od nowa.`);
  if (servers.length >= MAX_SERVERS) throw new UserError(`Na liście polecanych może być najwyżej ${MAX_SERVERS} serwerów – usuń któryś, żeby dodać nowy.`);
  const server = { id: newId(guildId, entry.name), ...entry, addedBy, addedAt: Date.now() };
  servers.push(server);
  db.save();
  return server;
}

/** → the removed entry, or null when there was no such server. */
function remove(guildId, id) {
  const g = db.guild(guildId);
  const server = find(guildId, id);
  if (!server) return null;
  g.featuredServers = g.featuredServers.filter((s) => s.id !== id);
  db.save();
  return server;
}

/** The list as the launcher gets it – exactly the fields of the API, nothing about who added what. */
const publicList = (guildId) =>
  list(guildId).map((s) => ({
    id: s.id,
    name: s.name,
    address: s.address,
    description: s.description,
    tags: [...(s.tags ?? [])],
    icon: s.icon ?? null,
    mc: s.mc ?? null,
    loader: s.loader ?? null,
    pack: s.pack ?? null,
  }));

module.exports = { LOADERS, MAX_SERVERS, list, find, add, remove, publicList, parseAddress, parseIcon, parseTags };
