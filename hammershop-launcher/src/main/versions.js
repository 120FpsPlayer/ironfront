'use strict';

/**
 * Minecraft versions (Mojang's manifest) and mod loader versions (Fabric, Quilt, NeoForge, Forge),
 * cached for a while so the instance editor opens instantly.
 */

const installer = require('@xmcl/installer');

const TTL = 10 * 60 * 1000;
const cache = new Map();

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** [{ id, type: 'release'|'snapshot'|…, releaseTime }] – newest first. */
async function minecraftVersions({ snapshots = false } = {}) {
  const list = await cached('mc', () => installer.getVersionList());
  return list.versions
    .filter((v) => v.type === 'release' || (snapshots && v.type === 'snapshot'))
    .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
}

/** The Minecraft version a NeoForge version belongs to: 21.1.77 → 1.21.1, 20.4.237 → 1.20.4, 21.0.10 → 1.21, 26.1.0.5 → 26.1. */
function neoForgeMinecraft(version) {
  const parts = String(version).split('-')[0].split('.');
  const [a, b] = parts;
  if (Number(a) >= 25) {
    // Year-based Minecraft versions (26.1, 26.1.1 …): NeoForge prefixes its build with the game version.
    const game = parts.slice(0, Math.max(2, parts.length - 1));
    if (game.length > 2 && game[2] === '0') game.length = 2;
    return game.join('.');
  }
  return b === '0' ? `1.${a}` : `1.${a}.${b}`;
}

const NEOFORGE_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge';
const FORGE_METADATA = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const FORGE_PROMOTIONS = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json';
const UA = { 'user-agent': 'HammerShop-Launcher/1.0 (hammershop.pl)' };

/**
 * Forge versions from its Maven metadata ("1.20.1-47.3.0" → 47.3.0) and the recommended / latest builds from
 * promotions_slim.json. (The Forge download web page changes its layout too often to be parsed.)
 */
async function forgeVersions(mc, { fetchFn = fetch } = {}) {
  const all = await cached('forge', async () => {
    const res = await fetchFn(FORGE_METADATA, { headers: UA });
    if (!res.ok) throw new Error(`Forge: HTTP ${res.status}`);
    return [...(await res.text()).matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  });
  const promos = await cached('forge-promos', async () => {
    try {
      const res = await fetchFn(FORGE_PROMOTIONS, { headers: UA });
      return res.ok ? ((await res.json()).promos ?? {}) : {};
    } catch {
      return {};
    }
  });
  const recommended = promos[`${mc}-recommended`];
  const latest = promos[`${mc}-latest`];
  return all
    .filter((v) => v.startsWith(`${mc}-`))
    .map((v) => v.slice(mc.length + 1))
    .reverse()
    .map((version) => ({ version, stable: !/beta|pre|rc/i.test(version), recommended: version === recommended, latest: version === latest }));
}

async function neoForgeVersions(mc) {
  const all = await cached('neoforge', async () => {
    const res = await fetch(NEOFORGE_VERSIONS, { headers: UA });
    if (!res.ok) throw new Error(`NeoForge: HTTP ${res.status}`);
    return (await res.json()).versions ?? [];
  });
  return all
    .filter((v) => neoForgeMinecraft(v) === mc)
    .reverse()
    .map((v) => ({ version: v, stable: !/beta|alpha/i.test(v) }));
}

/**
 * Loader versions for one Minecraft version, newest first: [{ version, stable }].
 * An empty list = the loader doesn't support that Minecraft version.
 */
async function loaderVersions(loader, mc) {
  switch (loader) {
    case 'fabric':
      return cached(`fabric:${mc}`, async () => (await installer.getLoaderArtifactListFor(mc)).map((a) => ({ version: a.loader.version, stable: a.loader.stable !== false })));
    case 'quilt':
      return cached(`quilt:${mc}`, async () => (await installer.getQuiltLoaderVersionsByMinecraft({ minecraftVersion: mc })).map((a) => ({ version: a.loader.version, stable: !/beta|pre|rc/i.test(a.loader.version) })));
    case 'neoforge':
      return cached(`neoforge:${mc}`, () => neoForgeVersions(mc));
    case 'forge':
      return cached(`forge:${mc}`, () => forgeVersions(mc));
    default:
      return [];
  }
}

/** The version a new instance gets: the recommended / newest stable one, else the newest. */
function pickLoaderVersion(list) {
  return (list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0])?.version ?? null;
}

module.exports = { minecraftVersions, loaderVersions, pickLoaderVersion, neoForgeMinecraft, forgeVersions, _cache: cache };
