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

async function neoForgeVersions(mc) {
  const all = await cached('neoforge', async () => {
    const res = await fetch(NEOFORGE_VERSIONS, { headers: { 'user-agent': 'HammerShop-Launcher' } });
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
      return cached(`forge:${mc}`, async () => {
        const page = await installer.getForgeVersionList({ minecraft: mc });
        return (page.versions ?? []).map((v) => ({ version: v.version, stable: v.type === 'recommended' || v.type === 'latest' || v.type === 'common', recommended: v.type === 'recommended' }));
      });
    default:
      return [];
  }
}

/** The version a new instance gets: the recommended / newest stable one, else the newest. */
function pickLoaderVersion(list) {
  return (list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0])?.version ?? null;
}

module.exports = { minecraftVersions, loaderVersions, pickLoaderVersion, neoForgeMinecraft, _cache: cache };
