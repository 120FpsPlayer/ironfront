'use strict';

/**
 * Modrinth API client (https://docs.modrinth.com) – the mod, resource pack, shader and modpack catalogue.
 * Public API, no key needed; Modrinth asks for an identifying User-Agent. Retries on rate limits and server errors.
 */

const { USER_AGENT } = require('./net');

const API = 'https://api.modrinth.com/v2';
const SORTS = ['relevance', 'downloads', 'follows', 'newest', 'updated'];
const TYPES = ['mod', 'resourcepack', 'shader', 'modpack'];

/** Which Modrinth loaders an instance can use: Quilt runs Fabric mods; resource packs are "minecraft". */
function loadersFor(type, loader) {
  if (type === 'resourcepack') return ['minecraft'];
  if (type === 'shader') return ['iris', 'optifine'];
  if (type === 'modpack') return loader && loader !== 'vanilla' ? [loader] : [];
  if (loader === 'quilt') return ['quilt', 'fabric'];
  if (!loader || loader === 'vanilla') return [];
  return [loader];
}

function createModrinth({ fetchFn = (...a) => fetch(...a), userAgent = USER_AGENT, base = API, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  async function request(pathname, { query, body, method = body ? 'POST' : 'GET' } = {}) {
    const url = new URL(base + pathname);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, typeof v === 'string' ? v : JSON.stringify(v));
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let res;
      try {
        res = await fetchFn(url.toString(), { method, headers: { 'user-agent': userAgent, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
      } catch (err) {
        lastError = new Error('Brak połączenia z Modrinth. Sprawdź internet.');
        await sleep(500 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return null;
      if (res.status === 429 || res.status >= 500) {
        lastError = new Error(res.status === 429 ? 'Modrinth prosi o chwilę przerwy – spróbuj za moment.' : `Modrinth ma chwilowe problemy (HTTP ${res.status}).`);
        await sleep(Number(res.headers?.get?.('x-ratelimit-reset')) * 1000 || 1000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Modrinth: HTTP ${res.status}`);
      return res.json();
    }
    throw lastError;
  }

  return {
    /**
     * Search: { hits: [{ project_id, slug, title, description, icon_url, downloads, follows, categories, author, … }], total_hits }.
     * Filters by type, Minecraft version and the instance's loader; mods that only work on servers are hidden.
     */
    async search({ query = '', type = 'mod', mcVersion, loader, categories = [], sort = 'relevance', offset = 0, limit = 20 } = {}) {
      const t = TYPES.includes(type) ? type : 'mod';
      const facets = [[`project_type:${t}`]];
      if (mcVersion) facets.push([`versions:${mcVersion}`]);
      const loaders = t === 'mod' || t === 'modpack' ? loadersFor(t, loader) : [];
      if (loaders.length) facets.push(loaders.map((l) => `categories:${l}`));
      for (const c of categories) if (/^[\w-]{1,40}$/.test(c)) facets.push([`categories:${c}`]);
      if (t === 'mod') facets.push(['client_side:required', 'client_side:optional']);
      return request('/search', { query: { query: String(query).slice(0, 200), facets, index: SORTS.includes(sort) ? sort : 'relevance', offset: Math.max(0, offset | 0), limit: Math.min(100, Math.max(1, limit | 0)) } });
    },
    project: (idOrSlug) => request(`/project/${encodeURIComponent(idOrSlug)}`),
    projects: async (ids) => (ids.length ? request('/projects', { query: { ids } }) : []),
    /** Versions of a project, newest first, filtered by loaders and game versions. */
    versions: (idOrSlug, { loaders, gameVersions } = {}) =>
      request(`/project/${encodeURIComponent(idOrSlug)}/version`, { query: { ...(loaders?.length ? { loaders } : {}), ...(gameVersions?.length ? { game_versions: gameVersions } : {}) } }).then((v) => v ?? []),
    version: (id) => request(`/version/${encodeURIComponent(id)}`),
    /** sha1 → version, for files that are on Modrinth. */
    versionsByHashes: async (hashes) => (hashes.length ? (await request('/version_files', { body: { hashes, algorithm: 'sha1' } })) ?? {} : {}),
    /** sha1 → the newest version for these loaders / game versions (update check). */
    updates: async (hashes, { loaders, gameVersions }) => (hashes.length ? (await request('/version_files/update', { body: { hashes, algorithm: 'sha1', loaders, game_versions: gameVersions } })) ?? {} : {}),
    categories: () => request('/tag/category').then((c) => c ?? []),
  };
}

/** Best version for an instance: one for this game version and loader; releases before betas before alphas. */
function pickVersion(versions, { mcVersion, loaders = [] } = {}) {
  const fits = versions.filter((v) => (!mcVersion || v.game_versions?.includes(mcVersion)) && (!loaders.length || v.loaders?.some((l) => loaders.includes(l))));
  const rank = { release: 0, beta: 1, alpha: 2 };
  // Prefer the instance's own loader over a compatible one (Quilt instance: quilt build before the fabric build).
  const loaderRank = (v) => (loaders.length ? Math.min(...v.loaders.map((l) => (loaders.indexOf(l) === -1 ? 99 : loaders.indexOf(l)))) : 0);
  return (
    fits
      .map((v, i) => ({ v, i }))
      .sort((a, b) => (rank[a.v.version_type] ?? 3) - (rank[b.v.version_type] ?? 3) || loaderRank(a.v) - loaderRank(b.v) || a.i - b.i)[0]?.v ?? null
  );
}

const primaryFile = (version) => version?.files?.find((f) => f.primary) ?? version?.files?.[0] ?? null;

module.exports = { createModrinth, pickVersion, primaryFile, loadersFor, API, SORTS, TYPES };
