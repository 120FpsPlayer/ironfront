'use strict';

/**
 * Polecane serwery – the Minecraft servers the shop recommends:  GET <shop API>/featured  →
 *   { servers: [{ id, name, address, description, tags: [string], icon: <https URL or null>, mc, loader, pack }] }
 * A public route, asked through the shop API client (shopapi.js) without a code and kept for 5 minutes.
 *
 * Everything in the answer is untrusted text: each field is checked or cut to its length here, the window shows
 * it as text only, and the icon is only an address for an <img> – never fetched by this process. When the shop
 * is not reachable or has no list, the answer is simply an empty list: the card is not shown and nothing errors.
 * No Electron here.
 */

const { LOADERS } = require('./instances');
const { cleanAddress } = require('./servers');
const { cleanIcon, MC_VERSION, PACK } = require('./invite');

const TTL = 5 * 60 * 1000;
const RETRY = 60 * 1000; // after a failed try the shop is not asked again for a minute
const MAX_SERVERS = 25;
const MAX_TAGS = 6;
const LIMITS = { name: 40, description: 200, tag: 20 };

/** One line of plain text, cut to `max` characters: control and text-direction characters become spaces. */
const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

/** One entry of the list, checked – null when it has no usable name or address. */
function cleanServer(raw, index = 0) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || typeof raw.address !== 'string') return null;
  let address;
  try {
    address = cleanAddress(raw.address);
  } catch {
    return null;
  }
  const name = text(raw.name, LIMITS.name);
  if (!name) return null;
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((t) => text(t, LIMITS.tag)).filter(Boolean))].slice(0, MAX_TAGS);
  const mc = typeof raw.mc === 'string' && MC_VERSION.test(raw.mc.trim()) ? raw.mc.trim() : null;
  const loader = typeof raw.loader === 'string' && LOADERS.includes(raw.loader.trim().toLowerCase()) ? raw.loader.trim().toLowerCase() : null;
  const pack = typeof raw.pack === 'string' && PACK.test(raw.pack.trim()) ? raw.pack.trim() : null;
  return {
    id: typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id) ? raw.id : `serwer-${index + 1}`,
    name,
    address,
    description: text(raw.description, LIMITS.description),
    tags,
    icon: typeof raw.icon === 'string' ? cleanIcon(raw.icon) : null,
    mc,
    loader,
    pack,
  };
}

/** The whole answer, checked: at most 25 servers, each address and each id once. */
function cleanList(servers) {
  const out = [];
  const addresses = new Set();
  const ids = new Set();
  for (const [i, raw] of (Array.isArray(servers) ? servers : []).slice(0, MAX_SERVERS * 4).entries()) {
    const server = cleanServer(raw, i);
    if (!server || addresses.has(server.address.toLowerCase())) continue;
    const wanted = server.id;
    for (let n = 2; ids.has(server.id); n += 1) server.id = `${wanted.slice(0, 56)}-${n}`;
    addresses.add(server.address.toLowerCase());
    ids.add(server.id);
    out.push(server);
    if (out.length >= MAX_SERVERS) break;
  }
  return out;
}

/** `api` is the shop API client (getFeatured). list() never throws. */
function createFeatured({ api, now = () => Date.now(), ttl = TTL, retry = RETRY }) {
  let cache = null; // { at, servers, ok }
  let running = null;

  async function load() {
    try {
      cache = { at: now(), servers: cleanList(await api.getFeatured()), ok: true };
    } catch {
      // The shop is not online (yet): the last good list stays for now, and the next try waits a minute.
      cache = { at: now(), servers: cache?.servers ?? [], ok: false };
    }
    return cache.servers;
  }

  /** [{ id, name, address, description, tags, icon, mc, loader, pack }] – [] when there is nothing to show. */
  async function list() {
    if (cache && now() - cache.at < (cache.ok ? ttl : retry)) return cache.servers.map((s) => ({ ...s, tags: [...s.tags] }));
    running ??= load().finally(() => (running = null));
    return (await running).map((s) => ({ ...s, tags: [...s.tags] }));
  }

  /** One server of the current list by id – null when it is not (or no longer) there. */
  async function find(id) {
    return (await list()).find((s) => s.id === id) ?? null;
  }

  return { list, find };
}

module.exports = { createFeatured, cleanServer, cleanList, TTL, RETRY, MAX_SERVERS, MAX_TAGS, LIMITS };
