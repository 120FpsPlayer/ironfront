'use strict';

/**
 * Renders the launcher interface in Chromium with a fake window.hs (no Electron, no network) and saves a
 * screenshot of every screen. Usage: node scripts/preview.js [outDir] [scale] [--lang=en] [--collect] [--compare=<dir>]
 * Needs Playwright with Chromium (npx playwright install chromium) – used for development only.
 *
 * Without switches the run is Polish. --lang=en (or HAMMER_LANG=en) runs the same steps in English and fails
 * when Polish is left on a screen; --collect lists every text of the interface – see scripts/preview-i18n.js.
 */

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { createPreviewLanguage } = require('./preview-i18n');

const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SWITCH = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]));
const OUT = path.resolve(ARGS[0] ?? 'preview');
const SCALE = Number(ARGS[1] ?? 1);
const LANG = (SWITCH.lang ?? process.env.HAMMER_LANG) === 'en' ? 'en' : 'pl';
const PAGE = `file://${path.join(__dirname, '..', 'src', 'renderer', 'index.html')}`;

/* Runs inside the page before the app scripts: a believable fake launcher. */
function mock() {
  const GB = 1024 ** 3;
  const listeners = new Map();
  const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  window.__emit = (channel, payload) => (listeners.get(channel) ?? []).forEach((fn) => fn(payload));

  // Square "logo" icons as data URLs (Modrinth icons are not reachable offline).
  const logo = (text, c1, c2) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="96" height="96" rx="20" fill="url(#g)"/><text x="48" y="62" font-family="Arial" font-weight="900" font-size="40" fill="#fff" text-anchor="middle">${text}</text></svg>`)}`;

  // A server icon the way a ping answers it: a PNG data URL.
  function pngLogo(text, c1, c2) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const fill = g.createLinearGradient(0, 0, 64, 64);
    fill.addColorStop(0, c1);
    fill.addColorStop(1, c2);
    g.fillStyle = fill;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#fff';
    g.font = '900 34px Arial';
    g.textAlign = 'center';
    g.fillText(text, 32, 44);
    return c.toDataURL();
  }

  // Product art and "screenshots" as SVG data URLs.
  const shopArt = (text, c1, c2) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><g fill="#fff" opacity=".12"><rect x="20" y="20" width="60" height="60"/><rect x="240" y="100" width="60" height="60"/></g><text x="160" y="104" font-family="Arial" font-weight="900" font-size="38" fill="#fff" text-anchor="middle">${text}</text></svg>`)}`;
  const scene = (sky, ground, label) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="#ffffff" stop-opacity=".6"/></linearGradient></defs><rect width="640" height="360" fill="url(#s)"/><circle cx="500" cy="80" r="34" fill="#fff6c7" opacity=".9"/><path d="M0 250 L80 200 L160 230 L240 170 L330 220 L420 180 L520 230 L640 190 L640 360 L0 360Z" fill="${ground}"/><g fill="${ground}" opacity=".7">${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 40}" y="${290 + (i % 3) * 8}" width="40" height="80"/>`).join('')}</g><text x="20" y="340" font-family="Arial" font-size="18" fill="#fff" opacity=".7">${label}</text></svg>`)}`;

  // A whole 64×64 skin (both layers), so the Skórka tab has something to draw from the front and from behind.
  function fullSkin({ tone = '#c98b5e', hair = '#4a2c17', shirt = '#3a6fd8', pants = '#2d3a66', shoes = '#3b3b44', trim = '#ff9f43', eye = '#2b4a9c', slim = false, legacy = false } = {}) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = legacy ? 32 : 64;
    const g = c.getContext('2d');
    const rect = (x, y, w, hgt, col) => ((g.fillStyle = col), g.fillRect(x, y, w, hgt));
    // head: sides, front and back in one strip; hair on top, a fringe in front, long hair behind
    rect(0, 8, 32, 8, tone), rect(8, 0, 8, 8, hair), rect(16, 0, 8, 8, tone);
    rect(0, 8, 32, 2, hair), rect(0, 8, 8, 5, hair), rect(16, 8, 8, 5, hair), rect(24, 8, 8, 7, hair);
    rect(9, 12, 2, 1, '#fff'), rect(10, 12, 1, 1, eye), rect(13, 12, 2, 1, '#fff'), rect(13, 12, 1, 1, eye), rect(11, 14, 2, 1, '#8a4c33');
    // body, right arm, right leg
    rect(16, 16, 24, 16, shirt), rect(20, 25, 8, 2, trim), rect(32, 22, 8, 3, trim);
    rect(40, 16, 16, 16, shirt), rect(40, 28, 16, 4, tone);
    rect(0, 16, 16, 16, pants), rect(0, 29, 16, 3, shoes);
    // hat layer: a cap with a brim in front
    rect(40, 0, 8, 8, trim), rect(32, 8, 32, 2, trim), rect(40, 10, 8, 1, '#00000055');
    if (!legacy) {
      rect(16, 48, 16, 16, pants), rect(16, 61, 16, 3, shoes);
      rect(32, 48, 16, 16, shirt), rect(32, 60, 16, 4, tone);
      rect(20, 36, 2, 12, trim), rect(26, 36, 2, 12, trim), rect(32, 36, 8, 2, trim); // an open jacket
      rect(44, 36, 4, 2, trim), rect(52, 52, 4, 2, trim); // cuffs
      if (slim) g.clearRect(54, 16, 2, 16), g.clearRect(46, 48, 2, 16), g.clearRect(54, 32, 2, 16), g.clearRect(62, 48, 2, 16);
    }
    return c.toDataURL();
  }
  // A cape texture (64×32): the outer side is the 10×16 block at 1,1.
  function capeArt(c1, c2) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = c1;
    g.fillRect(0, 0, 22, 17);
    g.fillStyle = c2;
    g.fillRect(3, 4, 6, 2), g.fillRect(5, 6, 2, 7), g.fillRect(3, 13, 6, 1);
    return c.toDataURL();
  }

  const now = Date.now();
  const settings = { memoryMb: null, jvmPreset: 'recommended', customJvmArgs: '', javaPath: '', afterLaunch: 'hide', processPriority: 'above_normal', resolution: { width: 1280, height: 720, fullscreen: false }, showSnapshots: false, discordRpc: true, gpuPreference: true, concurrentDownloads: 16, selectedInstance: 'hammershop', selectedAccount: 'acc1', closeOnExit: false, language: 'auto', accent: 'orange', accentColor: '', background: '', heroStyle: 'classic', autoBackup: false, autoBackupKeep: 5, hammerCape: '', cloudAuto: false, playSummary: true, modUpdateCheck: true, screenshotShareAsk: true, autoUpdate: true, closedAlert: '', newsSeenAt: now - 30 * 3600e3 };
  const instances = [
    { id: 'hammershop', name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric', icon: 'hammer', optimized: true, hammerClient: true, memoryMb: null, playTimeMs: 46 * 3600e3 + 25 * 60e3, lastPlayed: now - 3 * 3600e3, createdAt: now - 40 * 864e5 },
    { id: 'survival', name: 'Survival z ekipą', mcVersion: '1.20.1', loader: 'forge', icon: 'grass', optimized: true, memoryMb: 6144, playTimeMs: 12 * 3600e3, lastPlayed: now - 2 * 864e5, createdAt: now - 20 * 864e5 },
    { id: 'fo', name: 'Fabulously Optimized', mcVersion: '1.21.1', loader: 'fabric', icon: 'star', optimized: true, modpack: { name: 'Fabulously Optimized', version: '6.4.0', iconUrl: logo('FO', '#6dd3ff', '#2563eb') }, playTimeMs: 5 * 3600e3, lastPlayed: now - 6 * 864e5 },
    { id: 'pvp', name: 'PvP 1.8.9', mcVersion: '1.8.9', loader: 'vanilla', icon: 'sword', optimized: false, playTimeMs: 0, lastPlayed: null },
  ];
  const accounts = [{ id: 'acc1', name: 'HammerGracz', skinUrl: null, addedAt: now - 9 * 864e5, needsLogin: false }];
  const MODS = [
    ['Sodium', 'jellysquid3', 'Nowoczesny silnik renderowania – ogromny wzrost FPS.', 92e6, 21000, 'S', '#7ad7a0', '#1f7a4c', ['optimization']],
    ['Iris Shaders', 'coderbot', 'Shadery kompatybilne z OptiFine, działające razem z Sodium.', 61e6, 14800, 'I', '#b18cff', '#5b35c9', ['decoration', 'optimization']],
    ['Lithium', 'jellysquid3', 'Optymalizuje fizykę, AI mobów i ładowanie chunków.', 48e6, 9800, 'L', '#8be3ff', '#2a86c9', ['optimization']],
    ["Xaero's Minimap", 'xaero96', 'Minimapa z waypointami, radarem jaskiń i mobów.', 38e6, 7400, 'X', '#ffd27a', '#c77a12', ['adventure', 'utility']],
    ['Create', 'simibubi', 'Maszyny, przekładnie i automatyzacja w klimacie steampunk.', 27e6, 12100, 'C', '#ffb36b', '#b8571a', ['technology', 'decoration']],
    ['AppleSkin', 'squeek502', 'Pokazuje nasycenie i wartości jedzenia na pasku głodu.', 31e6, 6200, 'A', '#ff8f8f', '#c0392b', ['food', 'utility']],
    ["Farmer's Delight", 'vectorwing', 'Uprawy, kuchnia i ponad 40 nowych potraw.', 19e6, 5900, 'F', '#b5e48c', '#4f8f2f', ['food', 'decoration']],
    ['Jade', 'Snownee', 'Podpowiada, na jaki blok lub moba patrzysz.', 22e6, 4300, 'J', '#8ff0d2', '#1b9a7a', ['utility']],
  ];
  const hit = (m, i) => ({ project_id: `p${i}`, slug: m[0].toLowerCase().replace(/\W+/g, '-'), title: m[0], author: m[1], description: m[2], downloads: m[3], follows: m[4], icon_url: logo(m[5], m[6], m[7]), display_categories: m[8], date_modified: new Date(now - (i + 1) * 3.7 * 864e5).toISOString() });
  const installed = [
    { file: 'sodium-fabric-0.6.5+mc1.21.4.jar', title: 'Sodium', versionNumber: 'mc1.21.4-0.6.5', enabled: true, size: 1.1e6, projectId: 'p0', iconUrl: logo('S', '#7ad7a0', '#1f7a4c') },
    { file: 'lithium-fabric-0.14.3.jar', title: 'Lithium', versionNumber: 'mc1.21.4-0.14.3', enabled: true, size: 720e3, projectId: 'p2', iconUrl: logo('L', '#8be3ff', '#2a86c9') },
    { file: 'ferritecore-7.1.1-fabric.jar', title: 'FerriteCore', versionNumber: '7.1.1', enabled: true, size: 140e3, projectId: 'fc', iconUrl: logo('Fe', '#d6c7a1', '#7d6a3a') },
    { file: 'Xaeros_Minimap_25.0.0_Fabric_1.21.4.jar', title: "Xaero's Minimap", versionNumber: '25.0.0', enabled: true, size: 2.4e6, projectId: 'p3', iconUrl: logo('X', '#ffd27a', '#c77a12') },
    { file: 'appleskin-fabric-mc1.21.4-3.0.6.jar', title: 'AppleSkin', versionNumber: '3.0.6', enabled: false, size: 95e3, projectId: 'p5', iconUrl: logo('A', '#ff8f8f', '#c0392b') },
    { file: 'fabric-api-0.114.0+1.21.4.jar', title: 'Fabric API', versionNumber: '0.114.0+1.21.4', enabled: true, size: 2.2e6, projectId: 'fapi', iconUrl: logo('FA', '#e6d3b3', '#8a6d3b') },
  ];
  const LOG = [
    '[12:41:02] [main/INFO]: Loading Minecraft 1.21.4 with Fabric Loader 0.16.10',
    '[12:41:02] [main/INFO]: Loading 38 mods:',
    '[12:41:03] [main/INFO]: [Sodium] Sodium 0.6.5 – Starting the renderer',
    '[12:41:04] [main/WARN]: Mod resource-pack-overrides uses deprecated API, it may break in future versions',
    '[12:41:05] [Render thread/INFO]: Backend library: LWJGL version 3.3.3-snapshot',
    '[12:41:07] [Render thread/INFO]: OpenGL: NVIDIA GeForce RTX 3060/PCIe/SSE2 GL version 4.6.0',
    '[12:41:11] [Render thread/INFO]: Reloading ResourceManager: vanilla, fabric, sodium, lithium, xaerominimap',
    '[12:41:14] [Render thread/INFO]: Sound engine started',
    '[12:41:15] [Render thread/INFO]: Created: 2048x1024x4 minecraft:textures/atlas/blocks.png-atlas',
    '[12:52:40] [Render thread/ERROR]: Unreported exception thrown!',
    'java.lang.OutOfMemoryError: Java heap space',
    '\tat net.minecraft.class_2818.method_12011(class_2818.java:212)',
    '\tat net.minecraft.class_3898.method_17979(class_3898.java:744)',
  ];

  // Serwery: the list (servers.dat) and what each address answers to a ping. One address never answers (spinner).
  const servers = [
    { name: 'HammerShop', address: 'mc.hammershop.pl' },
    { name: 'Survival ze znajomymi', address: '83.12.45.201:25570' },
    { name: 'Hypixel', address: 'mc.hypixel.net' },
    { name: 'Serwer testowy u Kuby', address: 'kuba.example.pl:25566' },
    { name: 'Nowy serwer', address: 'nowy.example.pl' },
  ];
  const PINGS = {
    'mc.hammershop.pl': { online: true, latency: 23, version: 'Paper 1.21.1', players: { online: 137, max: 500, sample: ['HammerGracz', 'Kowal', 'Mlotek'] }, motd: 'HammerShop – survival, skyblock i eventy co weekend!', favicon: logo('H', '#ffc27e', '#ff8a2b') },
    '83.12.45.201:25570': { online: true, latency: 148, version: 'Fabric 1.20.1', players: { online: 3, max: 10, sample: [] }, motd: 'Nasz survival · wipe dopiero w grudniu', favicon: null },
    'mc.hypixel.net': { online: true, latency: 312, version: 'Requires MC 1.8 / 1.21', players: { online: 28431, max: 200000, sample: [] }, motd: 'Hypixel Network [1.8-1.21] · SKYBLOCK · BEDWARS · SKYWARS', favicon: logo('Hy', '#ffe08a', '#d49a12') },
    'kuba.example.pl:25566': { online: false, error: 'Serwer jest offline.' },
    // Polecane serwery
    'sky.hammershop.pl': { online: true, latency: 31, version: 'Paper 1.21.1', players: { online: 58, max: 200, sample: [] }, motd: 'Hammer Skyblock', favicon: pngLogo('S', '#8be3ff', '#2a86c9') },
    'fo.example.pl:25570': { online: true, latency: 64, version: 'Fabric 1.21.1', players: { online: 12, max: 40, sample: [] }, motd: 'Wspólny świat', favicon: null },
    'pvp.example.pl': { online: false, error: 'Serwer jest offline.' },
  };
  // Only the main instance has servers, worlds and backups – the others show the empty states.
  const serverList = (id = 'hammershop') => (id === 'hammershop' ? servers.map((x, index) => ({ index, icon: null, acceptTextures: null, ...x })) : []);

  // Światy: square world icons like the game's icon.png.
  const worldIcon = (sky, ground) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${sky}"/><circle cx="48" cy="14" r="7" fill="#fff6c7"/><path d="M0 40 L12 30 L24 38 L38 26 L52 36 L64 30 L64 64 L0 64Z" fill="${ground}"/><rect y="50" width="64" height="14" fill="${ground}" opacity=".6"/></svg>`)}`;
  const worlds = [
    { folder: 'Nasz survival', name: 'Nasz survival', gameType: 0, gameMode: 'Przetrwanie', hardcore: false, version: '1.21.1', lastPlayed: now - 3 * 3600e3, size: 1.42 * GB, sizePartial: false, iconUrl: worldIcon('#7cc8ff', '#2f7a3f'), broken: false },
    { folder: 'New World', name: 'Miasto kreatywne', gameType: 1, gameMode: 'Kreatywny', hardcore: false, version: '1.21.1', lastPlayed: now - 2 * 864e5, size: 312e6, sizePartial: false, iconUrl: worldIcon('#ffd36b', '#8a5a2b'), broken: false },
    { folder: 'Hardcore 3', name: 'Hardcore – podejście trzecie', gameType: 0, gameMode: 'Przetrwanie', hardcore: true, version: '1.21.1', lastPlayed: now - 9 * 864e5, size: 86e6, sizePartial: false, iconUrl: null, broken: false },
    { folder: 'Stary swiat', name: 'Stary swiat', gameType: null, gameMode: null, hardcore: false, version: null, lastPlayed: now - 200 * 864e5, size: 4.2e6, sizePartial: false, iconUrl: null, broken: true },
  ];
  const backups = [
    { file: 'Nasz survival-2026-11-09_21-14.zip', size: 688e6, createdAt: now - 20 * 3600e3, world: 'Nasz survival', auto: false },
    { file: '2026-10-28_18-02-51_New World.zip', size: 121e6, createdAt: now - 13 * 864e5, world: 'New World', auto: false },
  ];
  // What the launcher makes by itself after game sessions (Hammer+) – added by window.__autoBackups().
  window.__autoBackups = () => backups.unshift({ file: 'Nasz survival-2026-11-11_19-42-auto.zip', size: 702e6, createdAt: now - 2 * 3600e3, world: 'Nasz survival', auto: true }, { file: 'Nasz survival-2026-11-10_22-07-auto.zip', size: 695e6, createdAt: now - 23 * 3600e3, world: 'Nasz survival', auto: true });

  // Skórka: the account's skin and capes, and the library of skins used before.
  const hex = (ch) => ch.repeat(40);
  const SKINS = {
    kowal: fullSkin(),
    rycerz: fullSkin({ shirt: '#8d99ae', pants: '#4a4e69', trim: '#e63946', hair: '#22223b' }),
    alex: fullSkin({ tone: '#e0ac8a', hair: '#d9822b', shirt: '#4c9a5b', pants: '#6b4a2f', trim: '#ffe08a', eye: '#2f6f3a', slim: true }),
    zima: fullSkin({ shirt: '#e8f1f8', pants: '#5d7a99', trim: '#7cc4ff', hair: '#f4f4f4' }),
    stara: fullSkin({ shirt: '#00a8a8', pants: '#3c2a8f', trim: '#00a8a8', legacy: true }),
    nowa: fullSkin({ shirt: '#2b2d42', pants: '#1b1b2f', trim: '#b08cff', hair: '#111', tone: '#d9a074' }),
  };
  const skinLib = [
    { id: hex('a'), name: 'Kowal Hammer', variant: 'classic', dataUrl: SKINS.kowal, addedAt: now - 3 * 864e5, usedAt: now - 3600e3 },
    { id: hex('b'), name: 'Rycerz w czerwieni', variant: 'classic', dataUrl: SKINS.rycerz, addedAt: now - 9 * 864e5, usedAt: now - 2 * 864e5 },
    { id: hex('c'), name: 'Alex z lasu', variant: 'slim', dataUrl: SKINS.alex, addedAt: now - 20 * 864e5, usedAt: now - 12 * 864e5 },
    { id: hex('d'), name: 'Zimowy', variant: 'classic', dataUrl: SKINS.zima, addedAt: now - 40 * 864e5, usedAt: now - 30 * 864e5 },
    { id: hex('e'), name: 'Stara skórka z 2013 (64×32)', variant: 'classic', dataUrl: SKINS.stara, addedAt: now - 300 * 864e5, usedAt: now - 200 * 864e5 },
  ];
  const wardrobe = { worn: hex('a'), capes: [{ id: 'migrator', name: 'Migrator', url: capeArt('#b3261e', '#ffd166'), active: true }, { id: 'vanilla', name: 'Vanilla', url: capeArt('#2f7a3f', '#e7f7ff'), active: false }, { id: 'mcc15', name: '15th Anniversary', url: capeArt('#3a2a6b', '#b08cff'), active: false }] };
  // Zestawy (Hammer+): looks saved under a name.
  const outfits = [
    { id: 'aaaaaaaaaaa1', name: 'Na PvP', skin: hex('b'), variant: 'classic', cape: 'migrator', capeName: 'Migrator', createdAt: now - 2 * 864e5 },
    { id: 'aaaaaaaaaaa2', name: 'Na budowanie', skin: hex('c'), variant: 'slim', cape: null, capeName: null, createdAt: now - 5 * 864e5 },
    { id: 'aaaaaaaaaaa3', name: 'Zimowe wieczory na serwerze', skin: hex('d'), variant: 'classic', cape: 'vanilla', capeName: 'Vanilla', createdAt: now - 9 * 864e5 },
  ];
  const outfitList = () => outfits.filter((o) => skinLib.some((x) => x.id === o.skin)).map((o) => ({ ...o, skinName: skinLib.find((x) => x.id === o.skin).name, dataUrl: skinLib.find((x) => x.id === o.skin).dataUrl }));
  const skinState = () => {
    const worn = skinLib.find((x) => x.id === wardrobe.worn);
    return { account: { id: 'acc1', name: 'HammerGracz' }, skin: worn ? { url: `https://textures.minecraft.net/texture/${worn.id}`, variant: worn.variant, dataUrl: worn.dataUrl, libraryId: worn.id } : null, capes: wardrobe.capes.map((c) => ({ ...c })), library: skinLib.map((x) => ({ ...x, active: x.id === wardrobe.worn })), limit: plus.active ? 200 : 24, outfits: outfitList() };
  };

  // Hammer+: off until the preview switches it on with window.__plus(true); `why` sets another reason for "off".
  const plus = { active: false, why: null, cape: 'gold', menuUrl: null, bgUrl: null, cloud: 'offline', last: null };
  const UNTIL = Math.floor(new Date(2026, 11, 11, 12).getTime() / 1000);
  const WHY = {
    none: 'Nie masz jeszcze Hammer+. Kod dostaniesz od bota HammerShop na Discordzie po zakupie w sklepie.',
    expired: 'Twój Hammer+ wygasł 3 listopada 2026. Przedłuż go w sklepie – bot wyśle Ci nowy kod.',
    'wrong-account': 'Twój kod Hammer+ jest dla konta Kowal, a teraz wybrane jest konto HammerGracz. Przełącz konto (lewy dolny róg), żeby korzystać z Hammer+.',
  };
  const plusStatus = () =>
    plus.active
      ? { active: true, until: UNTIL, account: { id: 'acc1', name: 'HammerGracz' }, reason: 'ok', text: 'Hammer+ jest aktywny do 11 grudnia 2026 na koncie HammerGracz.', configured: true, hasCode: true, codeId: 'a1b2c3d4e5f60718', selected: { id: 'acc1', name: 'HammerGracz' } }
      : { active: false, until: plus.why === 'expired' ? UNTIL - 38 * 86400 : 0, account: plus.why === 'wrong-account' ? { id: 'acc2', name: 'Kowal' } : plus.why === 'expired' ? { id: 'acc1', name: 'HammerGracz' } : null, reason: plus.why ?? 'none', text: WHY[plus.why ?? 'none'], configured: true, hasCode: Boolean(plus.why), codeId: plus.why ? 'a1b2c3d4e5f60718' : null, selected: { id: 'acc1', name: 'HammerGracz' } };
  window.__plus = (active, why = null) => {
    Object.assign(plus, { active, why });
    window.__emit('plus:status', plusStatus());
  };
  window.__cloud = (mode) => (plus.cloud = mode);
  const CAPES = [['hammer', 'Hammer'], ['gold', 'Złota'], ['ember', 'Żar'], ['royal', 'Królewska'], ['frost', 'Mróz'], ['crimson', 'Karmazyn']].map(([id, name]) => ({ id, name }));
  const NOTE = 'Chmura zadziała, gdy sklep HammerShop będzie online.';
  const cloudAnswer = (direction) => {
    if (plus.cloud === 'offline') return { offline: true, note: NOTE };
    if (plus.cloud === 'conflict') return { conflict: true, updatedAt: 1794300000, at: now - 26 * 3600e3, cloud: { instances: 3, servers: 9 }, local: { instances: 4, servers: 5 } };
    plus.last = { at: Date.now(), direction, updatedAt: 1794400000 };
    return direction === 'pull' ? { ok: true, at: plus.last.at, updatedAt: 1794400000, look: true, changed: ['Hammer'], skipped: [], missing: [] } : { ok: true, at: plus.last.at, updatedAt: 1794400000 };
  };

  /* ── the official Minecraft, instance recipes, invitations, featured servers ── */
  // Long tasks pause while window.__hold is set (so a screenshot can show them half-way); window.__release() lets them finish.
  const gate = (ms = 150) => (window.__hold ? new Promise((resolve) => (window.__release = () => ((window.__hold = false), resolve()))) : wait(ms));
  const officialWorlds = [
    { folder: 'Survival 2024', name: 'Survival 2024', gameType: 0, gameMode: 'Przetrwanie', hardcore: false, version: '1.21.1', lastPlayed: now - 5 * 864e5, size: 2.31 * GB, sizePartial: false, iconUrl: worldIcon('#7cc8ff', '#2f7a3f'), broken: false, newer: false },
    { folder: 'Testy 26', name: 'Testy nowej wersji', gameType: 1, gameMode: 'Kreatywny', hardcore: false, version: '26.1', lastPlayed: now - 864e5, size: 96e6, sizePartial: false, iconUrl: worldIcon('#b18cff', '#1c1036'), broken: false, newer: true },
    { folder: 'New World', name: 'Zamek na wyspie', gameType: 1, gameMode: 'Kreatywny', hardcore: false, version: '1.20.4', lastPlayed: now - 40 * 864e5, size: 412e6, sizePartial: false, iconUrl: worldIcon('#ffd36b', '#8a5a2b'), broken: false, newer: false },
    { folder: 'Hardcore z Kuba', name: 'Hardcore z Kubą – nie umieramy', gameType: 0, gameMode: 'Przetrwanie', hardcore: true, version: '1.21.1', lastPlayed: now - 70 * 864e5, size: 188e6, sizePartial: false, iconUrl: null, broken: false, newer: false },
    { folder: 'Stary swiat 1.7', name: 'Stary swiat 1.7', gameType: null, gameMode: null, hardcore: false, version: null, lastPlayed: now - 900 * 864e5, size: 3.1e6, sizePartial: false, iconUrl: null, broken: true, newer: false },
  ];
  const b62 = (n, seed = 7) => Array.from({ length: n }, (_, i) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[(i * 31 + seed * 17 + ((i * i) % 23)) % 64]).join('');
  const RECIPE_CODE = `HL1.${b62(1376)}`;
  const recipeOf = (id, withOptions) => {
    const i = instances.find((x) => x.id === id) ?? instances[0];
    const pack = id === 'fo';
    return {
      summary: { name: i.name, mc: i.mcVersion, loader: i.loader, loaderVersion: null, hammerClient: i.loader === 'fabric', mods: pack ? 214 : 6, resourcepacks: pack ? 3 : 2, shaders: pack ? 2 : 1, servers: id === 'hammershop' ? servers.length : 0, options: Boolean(withOptions) },
      excluded: pack ? [] : [{ type: 'mod', file: 'OptiFine_1.21.1_HD_U_J1.jar', title: 'OptiFine' }, { type: 'mod', file: 'moj-mod-testowy-0.3.jar', title: 'Mój mod testowy' }, { type: 'resourcepack', file: 'Paczka od Oli (HD).zip', title: 'Paczka od Oli (HD)' }],
      code: pack ? null : withOptions ? `HL1.${b62(2104, 3)}` : RECIPE_CODE,
      codeLength: pack ? 7312 : withOptions ? 2108 : RECIPE_CODE.length,
      maxCode: 6000,
      fileName: `${i.name}.hammerpack`,
      hasOptions: true,
      optionsLeftOut: false,
    };
  };
  const recipePreview = (name, notes = []) => ({ token: `t${Date.now()}`, summary: { name, mc: '1.21.1', loader: 'fabric', loaderVersion: notes.length ? null : '0.16.10', hammerClient: true, mods: 38, resourcepacks: 2, shaders: 1, servers: 3, options: true }, notes });
  const NOT_INVITE = 'To nie wygląda na zaproszenie do Hammer Launchera. Zaproszenie zaczyna się od „hammer://join” albo prowadzi do strony …/join.';
  const FEATURED = [
    { id: 'hammer-smp', name: 'Hammer SMP', address: 'mc.hammershop.pl', description: 'Survival bez wipe’ów: działki, ekonomia i eventy co weekend. Spokojna społeczność i aktywna administracja.', tags: ['survival', 'ekonomia', 'eventy'], icon: null, mc: '1.21.1', loader: 'fabric', pack: null },
    { id: 'skyblock', name: 'Hammer Skyblock', address: 'sky.hammershop.pl', description: 'Wyspy, misje i ranking wysp. Nowy sezon co trzy miesiące.', tags: ['skyblock'], icon: null, mc: '1.21.1', loader: null, pack: null },
    { id: 'fo-smp', name: 'Wspólny świat z paczką Fabulously Optimized', address: 'fo.example.pl:25570', description: 'Serwer dla graczy z paczką FO – shadery, mapa i głosowy czat zbliżeniowy.', tags: ['shadery', 'bez pvp'], icon: null, mc: '1.20.4', loader: 'fabric', pack: 'fabulously-optimized' },
    { id: 'pvp', name: 'Arena PvP 1.8', address: 'pvp.example.pl', description: 'Klasyczne PvP: kity, duele i turnieje w każdą sobotę.', tags: ['pvp', 'turnieje'], icon: null, mc: '1.8.9', loader: 'vanilla', pack: null },
  ];
  const inviteOf = (fields) => {
    const pack = fields.pack ? { title: 'Fabulously Optimized', author: 'robotkoer', iconUrl: null, version: '5.8.0', mc: fields.mc ?? '1.21.1', loader: fields.loader ?? 'fabric' } : null;
    const mc = fields.mc ?? pack?.mc ?? null;
    const loader = fields.loader ?? pack?.loader ?? null;
    const fits = instances.filter((i) => (!mc || i.mcVersion === mc) && (!loader || i.loader === loader)).map((i) => ({ id: i.id, name: i.name, mcVersion: i.mcVersion, loader: i.loader, icon: i.icon, modpack: i.modpack ?? null, hasPack: Boolean(pack && i.modpack), hasServer: i.id === 'hammershop' && servers.some((x) => x.address === fields.server) }));
    return { token: `i${Date.now()}`, invite: { server: fields.server, name: fields.name ?? null, mc: fields.mc ?? null, loader: fields.loader ?? null, pack: fields.pack ?? null, icon: null }, pack, fits, create: pack ? { mc: pack.mc, loader: pack.loader, name: pack.title } : { mc: mc ?? '1.21.1', loader: loader ?? 'fabric', name: fields.name ?? fields.server } };
  };
  let lastInvite = null;

  // Zestawy: which parts of a set exist for the instance and which are already there.
  const BUNDLES = [
    { id: 'pvp', name: 'PvP', icon: 'shield', description: 'Czytelna gra na serwerach: ping w tabeli, głowy graczy na czacie i obsługa paczek tekstur jak w OptiFine.', note: 'Tylko dodatki dozwolone na większości serwerów – żadnych cheatów ani ułatwień w walce.', mods: [['3D Skin Layers', 'Druga warstwa skórki (czapki, kurtki) jest wypukła.', 2], ['Chat Heads', 'Głowa gracza przy każdej wiadomości na czacie.', 1], ['Better Ping Display', 'Ping w milisekundach na liście graczy (Tab).', 1], ['Entity Texture Features', 'Tekstury mobów i graczy z paczek do OptiFine.', 1], ['Entity Model Features', 'Własne modele z paczek tekstur do OptiFine.', 1], ['Continuity', 'Łączone tekstury (szkło bez ramek) z paczek tekstur.', 1], ['LambDynamicLights', 'Pochodnia w ręce naprawdę świeci.', 1], ['Shulker Box Tooltip', 'Podgląd zawartości shulkera po najechaniu myszką.', 1]] },
    { id: 'survival', name: 'Survival+', icon: 'compass', description: 'Wszystko, czego brakuje w zwykłym survivalu: minimapa, mapa świata, receptury i wygodny ekwipunek.', note: 'Niektóre serwery nie pozwalają na minimapy – przed grą zerknij do regulaminu.', mods: [["Xaero's Minimap", 'Minimapa z punktami, do których chcesz wrócić.', 2], ["Xaero's World Map", 'Mapa całego odkrytego świata pod klawiszem M.', 1], ['Just Enough Items', 'Wszystkie receptury i zastosowania przedmiotów.', 1], ['Jade', 'Podpowiada, na jaki blok albo moba patrzysz.', 1], ['AppleSkin', 'Pokazuje, ile głodu i nasycenia da jedzenie.', 2], ['Mouse Tweaks', 'Przenoszenie przedmiotów przeciąganiem i kółkiem myszy.', 1], ['Inventory Profiles Next', 'Sortowanie ekwipunku i skrzyń jednym przyciskiem.', 1], ['Enchantment Descriptions', 'Opis każdego zaklęcia na przedmiocie.', 1], ['Shulker Box Tooltip', 'Podgląd zawartości shulkera po najechaniu myszką.', 1]] },
    { id: 'building', name: 'Budowanie', icon: 'bricks', description: 'Narzędzia budowniczego: szybkie kopiowanie i wypełnianie, schematy budowli i duże zrzuty ekranu.', note: 'WorldEdit i Axiom działają w grze jednoosobowej; na serwerze potrzebujesz uprawnień od administracji.', mods: [['WorldEdit', 'Kopiowanie, wypełnianie i zamiana tysięcy bloków naraz.', 1], ['WorldEdit CUI', 'Pokazuje zaznaczony obszar WorldEdita liniami.', 1], ['Axiom', 'Edytor świata w grze: pędzle, kształty, płynne budowanie.', 1], ['Litematica', 'Wyświetla schemat budowli jako podpowiedź, gdzie stawiać bloki.', 1], ['Fabrishot', 'Zrzuty ekranu w ogromnej rozdzielczości (F9).', 0]] },
    { id: 'shaders', name: 'Shadery', icon: 'sun', description: 'Iris i trzy lubiane paczki shaderów: cienie, falująca woda i ciepłe światło.', note: 'Shader wybierasz w grze: Opcje → Ustawienia graficzne → Paczki shaderów. Potrzebna jest dobra karta graficzna.', mods: [['Iris Shaders', 'Obsługa shaderów – działa razem z Sodium.', 2], ['Complementary Reimagined', 'Najpopularniejszy shader – ładny i w stylu Minecrafta.', 2, 'shader'], ['BSL Shaders', 'Miękkie światło i filmowe kolory.', 2, 'shader'], ['MakeUp – Ultra Fast', 'Lekki shader dla słabszych kart graficznych.', 2, 'shader']] },
    { id: 'visuals', name: 'Wygląd i klimat', icon: 'sparkles', description: 'Gra wygląda i brzmi ładniej bez shaderów: animacje postaci, spadające liście, odgłosy otoczenia.', note: 'Same ozdoby – nie zmieniają rozgrywki i działają na każdym serwerze.', mods: [['Not Enough Animations', 'Postać naprawdę je, trzyma mapę i wiosłuje.', 1], ['3D Skin Layers', 'Druga warstwa skórki (czapki, kurtki) jest wypukła.', 2], ['Wavey Capes', 'Peleryna faluje na wietrze.', 1], ['Visuality', 'Drobne efekty: iskry, bąbelki, krople.', 1], ['Falling Leaves', 'Z drzew spadają liście.', 1], ['Particle Rain', 'Deszcz, śnieg i burze piaskowe z prawdziwych kropel.', 1], ['AmbientSounds', 'Odgłosy lasu, jaskiń i morza w tle.', 1], ['Presence Footsteps', 'Inny odgłos kroków na każdym podłożu.', 1], ['LambDynamicLights', 'Pochodnia w ręce naprawdę świeci.', 1]] },
  ];
  const bundleMeta = (b) => ({ id: b.id, name: b.name, icon: b.icon, description: b.description, note: b.note, size: b.mods.length });
  // state of a part: 0 = no version for this game, 1 = available, 2 = installed

  /* ── Test FPS, „Podsumowanie gry”, mod updates with restore points, screenshot links ── */
  // Test FPS: the history of the main instance (newest first) – one test before „Zoptymalizuj”, one after.
  const benchRun = (at, avg, low1, min, max, more = {}) => ({ at, seconds: 20, world: 'Nasz survival', worldName: 'Nasz survival', avg, low1, min, max, frames: Math.round(avg * 20), mc: '1.21.1', loader: 'fabric', mods: 14, optimization: ['Sodium', 'Lithium', 'FerriteCore'], memoryMb: 4096, client: '2.2.1', ...more });
  const benchRuns = [
    benchRun(now - 26 * 3600e3, 174.3, 88.1, 61, 300.2, { mods: 9, optimization: [] }),
    benchRun(now - 4 * 864e5, 168.9, 84.6, 58.2, 291, { mods: 9, optimization: [], seconds: 10, memoryMb: 2560 }),
    benchRun(now - 9 * 864e5, 152.4, 71, 44.9, 262.7, { mods: 8, optimization: [], world: 'New World', worldName: 'Miasto kreatywne', memoryMb: 2560 }),
  ];
  const benchCompare = (prev, run) => {
    if (!prev || !run) return null;
    const pct = (a, b) => Math.round(((a - b) / b) * 100);
    const avg = pct(run.avg, prev.avg);
    return { avg, low1: pct(run.low1, prev.low1), text: avg === 0 ? 'bez zmian średnio' : `${avg > 0 ? '+' : '−'}${Math.abs(avg)}% średnio`, sameWorld: prev.world === run.world };
  };
  const benchInfo = (id) => {
    const i = instances.find((x) => x.id === id) ?? instances[0];
    const base = { lengths: [10, 20, 30], seconds: 20, worlds: [], running: false, history: [], comparison: null };
    if (!['fabric', 'quilt'].includes(i.loader)) return { ...base, available: false, reason: 'loader', note: 'Test FPS mierzy Hammer Client, a on działa tylko w instancjach Fabric i Quilt.' };
    if (i.hammerClient === false) return { ...base, available: false, reason: 'off', note: 'W tej instancji Hammer Client jest wyłączony – włącz go w edycji instancji, żeby zmierzyć FPS.' };
    const mine = id === 'hammershop';
    const history = mine ? benchRuns.map((r) => ({ ...r })) : [];
    return { ...base, available: true, reason: null, note: null, worlds: mine ? worlds.filter((w) => !w.broken).map((w) => ({ folder: w.folder, name: w.name, lastPlayed: w.lastPlayed, iconUrl: w.iconUrl })) : [], history, comparison: benchCompare(history[1], history[0]) };
  };
  let benchNow = null; // the test that "runs": { id, world, worldName, seconds }
  /** The game of the running test closed: with a result (ok) or without one. */
  window.__benchDone = (ok) => {
    const t = benchNow;
    benchNow = null;
    window.__emit('game:state', { instanceId: t.id, state: 'exited', code: 0, playedMs: 41000, benchmark: true });
    if (!ok) return window.__emit('benchmark:done', { instanceId: t.id, ok: false, reason: 'missing', reasons: ['Gra została zamknięta, zanim pomiar się skończył – po starcie nie zamykaj jej, zamknie się sama.', 'Świat się nie wczytał (albo wczytywał się bardzo długo) – otwórz go raz zwykłym „Graj” i spróbuj ponownie.'] });
    const previous = benchRuns[0];
    const run = benchRun(Date.now(), 240.6, 121.3, 88, 412.5, { seconds: t.seconds, world: t.world, worldName: t.worldName });
    benchRuns.unshift(run);
    return window.__emit('benchmark:done', { instanceId: t.id, ok: true, run, previous, comparison: benchCompare(previous, run) });
  };

  // „Podsumowanie gry”: what the launcher sends after a session; window.__session(shots, suggest) plays one.
  let summary = null;
  window.__session = (count = 3, suggestBenchmark = true) => {
    const art = [['#7cc8ff', '#2f7a3f', 'Zamek'], ['#ffb36b', '#4a2b14', 'Nether'], ['#9be7ff', '#e7f7ff', 'Góry'], ['#b18cff', '#1c1036', 'End'], ['#ffd36b', '#2f7a3f', 'Wioska']];
    summary = { instanceId: 'hammershop', name: 'Hammer', playedMs: 72 * 60e3, totalMs: 47 * 3600e3 + 37 * 60e3, endedAt: Date.now() - 20e3, screenshots: { count, shots: art.slice(0, Math.min(count, 5)).map(([c1, c2, label], n) => ({ file: `2026-11-11_18.2${n}.11.png`, url: scene(c1, c2, label), takenAt: Date.now() - n * 9 * 60e3 })) }, suggestBenchmark };
    window.__emit('play:summary', summary);
  };

  // Mod updates: off until the preview switches the background check's answer on with window.__updates(true).
  const upd = (type, file, title, current, to) => ({ type, file, title, current, latest: { id: `v-${title}`, versionNumber: to } });
  const updSeed = () => [upd('mod', installed[3].file, "Xaero's Minimap", '25.0.0', '25.1.0'), upd('mod', installed[0].file, 'Sodium', 'mc1.21.4-0.6.5', 'mc1.21.4-0.6.6'), upd('shader', 'ComplementaryReimagined_r5.3.zip', 'Complementary Reimagined', 'r5.3', 'r5.4')];
  const updFound = { hammershop: updSeed(), survival: [upd('mod', 'jei-1.20.1-forge-15.20.0.105.jar', 'Just Enough Items', '15.20.0.105', '15.20.0.112'), upd('mod', 'embeddium-0.3.30.jar', 'Embeddium', '0.3.30', '0.3.31')] };
  let updOn = false;
  let updMany = false;
  const updPoints = []; // the restore points of the main instance, newest first
  const updStatus = () => {
    const rows = updOn ? instances.filter((i) => (i.id === 'hammershop' || updMany) && updFound[i.id]?.length).map((i) => ({ id: i.id, name: i.name, count: updFound[i.id].length })) : [];
    return { checkedAt: updOn ? now : null, total: rows.reduce((sum, r) => sum + r.count, 0), instances: rows };
  };
  window.__updates = (on, many = false) => {
    updOn = on;
    updMany = many;
    if (many) updFound.hammershop = updSeed(); // a later check found them again
    window.__emit('updates:status', updStatus());
  };
  // An update that was cut off half-way (the launcher was closed in the middle).
  window.__interrupted = () => updPoints.unshift({ id: '2026-11-11_20-41-07', createdAt: Date.now() - 5 * 60e3, interrupted: true, entries: [{ type: 'mod', title: 'Lithium', old: { file: 'lithium-fabric-0.14.3.jar', versionNumber: 'mc1.21.4-0.14.3' }, new: { file: 'lithium-fabric-0.14.4.jar', versionNumber: 'mc1.21.4-0.14.4' }, state: 'done' }, { type: 'mod', title: 'FerriteCore', old: { file: 'ferritecore-7.1.1-fabric.jar', versionNumber: '7.1.1' }, new: { file: 'ferritecore-7.1.2-fabric.jar', versionNumber: '7.1.2' }, state: 'planned' }] });

  /* ── Aktualności and the message bar from the shop's admin panel, the launcher's own updates ── */
  // The shop's news (already sorted: pinned first, then newest); two of them are newer than the last visit.
  const NEWS = [
    { id: 'n_4', title: 'Hammer+ taniej o 20% do niedzieli', body: 'Własne kolory, animowane tła, automatyczne kopie światów i chmura.\nKod rabatowy: HAMMER20', tag: 'Promocja', date: '12.11.2026', at: now - 2 * 3600e3, url: 'https://hammerclient.com/launcher#plus', image: shopArt('−20%', '#ffb36b', '#c2410c'), pinned: true },
    { id: 'n_3', title: 'Launcher 2.6.0: aktualności i komunikaty prosto ze sklepu', body: 'Od tej wersji launcher aktualizuje się sam, a nowości ze sklepu widzisz od razu na ekranie Graj.', tag: 'Nowość', date: '11.11.2026', at: now - 26 * 3600e3, url: null, image: null, pinned: false },
    { id: 'n_2', title: 'Turniej PvP w sobotę o 18:00', body: 'Zapisy na Discordzie do piątku. Do wygrania rangi i Hammer+ na 3 miesiące.', tag: 'Event', date: '9.11.2026', at: now - 3 * 864e5, url: 'https://discord.gg/hammershop', image: null, pinned: false },
    { id: 'n_1', title: 'Nowe polecane serwery', body: 'W zakładce Serwery znajdziesz serwery, które polecamy – z liczbą graczy na żywo.', tag: null, date: '2.11.2026', at: now - 10 * 864e5, url: null, image: null, pinned: false },
  ];
  // The built-in tips – what the start screen shows while the shop is away or has no news.
  const TIPS = [
    { title: 'Witaj w Hammer Launcherze!', body: 'Zaloguj się kontem Microsoft, wybierz instancję i kliknij GRAJ. Launcher sam pobierze grę, Javę i mody.', tag: 'Start' },
    { title: 'Jedno kliknięcie – więcej FPS', body: 'Zakładka Optymalizacja dobiera RAM, flagi Javy i mody wydajnościowe (Sodium, Lithium, FerriteCore…) pod Twoją wersję gry.', tag: 'Wydajność' },
    { title: 'Tysiące modów w zakładce Mody', body: 'Szukaj modów, paczek tekstur, shaderów i całych paczek modów z Modrinth – zależności instalują się same.', tag: 'Mody' },
  ];
  const feed = { news: NEWS, source: 'shop', alert: null, release: null, ok: true, fetchedAt: now };
  const feedView = () => ({ ...feed, news: feed.news.map((n) => ({ ...n })), alert: feed.alert && (feed.alert.level === 'critical' || feed.alert.id !== settings.closedAlert) ? { ...feed.alert } : null, seenAt: settings.newsSeenAt });
  /** The shop said something else: window.__feed({ alert }) / ({ news: 'tips' }) – the window hears it like from the launcher. */
  window.__feed = (patch) => {
    Object.assign(feed, patch.news === 'tips' ? { ...patch, news: TIPS, source: 'builtin', ok: false } : patch.news === 'shop' ? { ...patch, news: NEWS, source: 'shop', ok: true } : patch);
    window.__emit('news:update', feedView());
  };
  // The launcher's own update: up to date until the preview says otherwise with window.__self({ … }).
  const self = { status: 'idle', supported: true, reason: null, current: '2.6.0', latest: null, percent: null, notes: null, error: null, checkedAt: now - 40 * 60e3, upToDate: true, gameRunning: false, release: null, required: null };
  const selfState = () => ({ ...self, auto: settings.autoUpdate !== false });
  window.__self = (patch) => {
    Object.assign(self, patch);
    window.__emit('selfupdate:state', selfState());
  };

  // The language: the run's own (window.__i18n, set by preview-i18n.js) while the setting says "auto".
  const i18n = window.__i18n ?? { lang: 'pl', dict: null };
  const languageNow = () => {
    const lang = settings.language === 'auto' ? i18n.lang : settings.language;
    return lang === 'en' && i18n.dict ? { lang: 'en', dict: i18n.dict } : { lang: 'pl', dict: null };
  };

  window.hs = {
    on(ch, fn) {
      if (!listeners.has(ch)) listeners.set(ch, new Set());
      listeners.get(ch).add(fn);
      return () => listeners.get(ch).delete(fn);
    },
    i18n: { ...languageNow(), load: async () => languageNow() },
    pathForFile: (file) => (/\.hammerpack$/i.test(file?.name ?? '') ? `C:\\Users\\Gracz\\Downloads\\${file.name}` : null),
    app: { info: async () => ({ plus: plusStatus(), version: '2.6.0', platform: 'win32', config: { name: 'Hammer Launcher', brand: 'HammerShop', channel: window.__stable ? '' : 'beta', website: 'https://hammerclient.com', shopUrl: 'https://hammershop.pl', discordInvite: '', server: { name: '', address: '' } }, root: 'C:\\Users\\Gracz\\AppData\\Roaming\\.hammer-launcher', secureStorage: true, hammerClient: { versions: ['1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11', '26.1', '26.1.1', '26.1.2', '26.2', '26.3'], version: '2.2.1', available: true }, background: { tray: true, startWithSystem: true } }), openExternal: async () => true, openFolder: async () => '' },
    window: { minimize: async () => {}, maximize: async () => {}, close: async () => {} },
    settings: {
      get: async () => ({ ...settings }),
      set: async (p) => {
        Object.assign(settings, p);
        if ('modUpdateCheck' in p) window.__updates(Boolean(p.modUpdateCheck) && updOn, updMany); // switched off: the badges go at once
        if ('autoUpdate' in p) window.__self(p.autoUpdate && self.status === 'available' ? { status: 'downloading', percent: 0 } : {}); // switched on: an announced update is fetched
        return { ...settings };
      },
    },
    system: { info: async () => ({}) },
    news: {
      feed: async () => (await wait(), feedView()),
      refresh: async () => feedView(),
      closeAlert: async () => {
        if (feed.alert && feed.alert.level !== 'critical') settings.closedAlert = feed.alert.id;
        return feedView();
      },
      seen: async () => (settings.newsSeenAt = Math.max(settings.newsSeenAt, ...feed.news.map((n) => n.at ?? 0))),
    },
    selfUpdate: {
      status: async () => selfState(),
      // „Sprawdź teraz”: a moment of „Sprawdzam…”, then what the preview prepared (window.__selfNext) – else "up to date".
      check: async () => {
        window.__self({ status: 'checking', error: null });
        await gate(250);
        window.__self(window.__selfNext ?? { status: 'idle', upToDate: true, latest: null });
        return selfState();
      },
      download: async () => (window.__self({ status: 'downloading', percent: 0 }), selfState()),
      install: async () => {
        if (self.gameRunning) throw new Error('Najpierw zamknij grę – aktualizacja uruchamia launcher ponownie.');
        window.__installed = (window.__installed ?? 0) + 1;
        return selfState();
      },
      // „Co nowego” after an update: what the preview prepared in window.__whatsNew, until it is closed.
      whatsNew: async () => window.__whatsNew ?? null,
      seen: async () => ((window.__seen = (window.__seen ?? 0) + 1), (window.__whatsNew = null), true),
      update: async () => {
        if (self.gameRunning) throw new Error('Najpierw zamknij grę – aktualizacja uruchamia launcher ponownie.');
        if (self.status === 'ready') window.__installed = (window.__installed ?? 0) + 1;
        else window.__self({ status: 'downloading', percent: 0, latest: self.latest ?? self.required?.version ?? null, error: null });
        return selfState();
      },
    },
    server: { ping: async (address) => (address === 'nowy.example.pl' ? new Promise(() => {}) : (await wait(), PINGS[address] ?? { online: true, latency: 23, version: '1.21.4', players: { online: 137, max: 500 } })) },
    accounts: { list: async () => (window.__noAccount ? [] : accounts.map((a) => ({ ...a, skinUrl: skinLib.find((x) => x.id === wardrobe.worn)?.dataUrl ?? null }))), login: async () => accounts[0], remove: async () => true, select: async () => true },
    versions: {
      minecraft: async () => ['26.3', '26.2', '26.1.2', '26.1.1', '26.1', '1.21.11', '1.21.10', '1.21.8', '1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'].map((id) => ({ id, type: 'release' })),
      loaders: async (l) => (l === 'vanilla' ? [] : [{ version: '0.16.10', stable: true }, { version: '0.16.9', stable: true }, { version: '0.16.8', stable: true }]),
    },
    instances: { list: async () => instances.map((i) => ({ ...i })), ensureDefault: async () => null, create: async (d) => (instances.push({ id: `nowa-${instances.length}`, playTimeMs: 0, lastPlayed: null, createdAt: Date.now(), ...d }), { ...instances.at(-1) }), update: async (id, p) => Object.assign(instances.find((i) => i.id === id), p), remove: async () => true, duplicate: async () => ({}), repair: async () => ({}), select: async () => true },
    game: { launch: async () => new Promise(() => {}), stop: async (id) => (benchNow?.id === id && window.__benchDone(false), true), logs: async () => LOG.map((line) => ({ line })), running: async () => [] },
    content: {
      list: async (id, type) => (type === 'mod' ? installed.map((x) => ({ ...x })) : []),
      identify: async () => 0,
      toggle: async () => true,
      remove: async () => true,
      install: async () => ({ installed: ['x'], skipped: [], warnings: [] }),
      import: async () => [],
    },
    benchmark: {
      info: async (id) => (await wait(120), { ...benchInfo(id), running: benchNow?.id === id }),
      start: async (id, opts) => {
        await wait(200);
        benchNow = { id, world: opts.world, worldName: opts.worldName, seconds: opts.seconds };
        window.__emit('game:state', { instanceId: id, state: 'starting', benchmark: true });
        return { ok: true, memoryMb: 4096, benchmark: true };
      },
      running: async () => (benchNow ? [benchNow.id] : []),
    },
    play: { summary: async () => summary, dismiss: async () => ((summary = null), true) },
    updates: {
      status: async () => updStatus(),
      list: async (id) => (updOn ? (updFound[id] ?? []).map((u) => ({ ...u, latest: { ...u.latest } })) : []),
      check: async (id) => (await wait(200), (updFound[id] ?? []).map((u) => ({ ...u, latest: { ...u.latest } }))),
      apply: async (id, items) => {
        window.__emit('task:progress', { scope: 'updates', label: `Aktualizacja: ${items[0].title}`, done: 0, total: items.length });
        await wait(350);
        window.__emit('task:progress', { scope: 'updates', label: `Aktualizacja: ${items.at(-1).title}`, done: 1, total: 1 });
        const entries = [];
        for (const item of items) {
          const mod = installed.find((x) => x.file === item.file);
          const next = item.file.replace(item.current.replace(/^mc[\d.]+-/, ''), item.latest.versionNumber.replace(/^mc[\d.]+-/, ''));
          entries.push({ type: item.type, title: item.title, old: { file: item.file, versionNumber: item.current }, new: { file: next, versionNumber: item.latest.versionNumber }, state: 'done' });
          if (mod) Object.assign(mod, { file: next, versionNumber: item.latest.versionNumber });
          updFound[id] = (updFound[id] ?? []).filter((u) => u.file !== item.file);
        }
        updPoints.unshift({ id: `2026-11-11_14-0${5 + updPoints.length}-33`, createdAt: Date.now(), interrupted: false, entries });
        updPoints.splice(3);
        window.__emit('updates:status', updStatus());
        return { point: updPoints[0].id, updated: items.map((u) => ({ type: u.type, file: u.file, title: u.title, from: u.current, to: u.latest.versionNumber })), failed: [] };
      },
      undo: async (id) => {
        await wait(250);
        const point = updPoints.shift();
        for (const e of point.entries) {
          const mod = installed.find((x) => x.file === e.new.file);
          if (mod) Object.assign(mod, { file: e.old.file, versionNumber: e.old.versionNumber });
        }
        return { point: point.id, restored: point.entries.filter((e) => e.state === 'done').map((e) => ({ type: e.type, title: e.title, from: e.new.versionNumber, to: e.old.versionNumber })) };
      },
      points: async (id) => (id === 'hammershop' ? updPoints.map((p) => ({ ...p, entries: p.entries.map((e) => ({ ...e })) })) : []),
    },
    modrinth: {
      search: async ({ type }) => (await wait(80), type === 'modpack' ? { hits: [hit(['Fabulously Optimized', 'robotkoer', 'Najlepsza paczka na FPS – wygląda jak vanilla, działa dużo szybciej.', 9.1e6, 3100, 'FO', '#6dd3ff', '#2563eb', ['optimization']], 0), hit(['Cobblemon Official', 'Cobblemon', 'Oficjalna paczka Cobblemon z kompletem modów.', 4.2e6, 2500, 'Co', '#ff9fb2', '#c2185b', ['adventure']], 1)], total_hits: 2 } : { hits: MODS.map(hit), total_hits: 18432 }),
      project: async (id) => ({ id, body: '## Co robi?\nTen mod znacząco poprawia wydajność gry – zwykle 2–3× więcej FPS.\n\n## Funkcje\n- szybszy rendering chunków\n- mniej zużytej pamięci\n- działa z Iris (shadery)\n\nDziała z większością innych modów i nie zmienia wyglądu gry.', gallery: [] }),
      versions: async () => [
        { id: 'v1', version_number: 'mc1.21.4-0.6.5', version_type: 'release', loaders: ['fabric', 'quilt'], date_published: new Date(now - 4 * 864e5).toISOString() },
        { id: 'v2', version_number: 'mc1.21.4-0.6.4', version_type: 'release', loaders: ['fabric'], date_published: new Date(now - 19 * 864e5).toISOString() },
        { id: 'v3', version_number: 'mc1.21.4-0.6.5-beta.2', version_type: 'beta', loaders: ['fabric'], date_published: new Date(now - 26 * 864e5).toISOString() },
      ],
      categories: async () => ['adventure', 'decoration', 'economy', 'equipment', 'food', 'game-mechanics', 'library', 'magic', 'mobs', 'optimization', 'storage', 'technology', 'transportation', 'utility', 'worldgen'].map((name) => ({ name, project_type: 'mod', header: 'categories' })),
    },
    modpacks: { install: async () => ({}), import: async () => null },
    community: {
      discord: async () => (await wait(), { code: 'hammershop', url: 'https://discord.gg/hammershop', name: 'HammerShop', description: null, iconUrl: logo('H', '#ffc27e', '#ff8a2b'), bannerUrl: null, members: 1284, online: 213, live: true }),
      shop: async () => (await wait(), { url: 'https://hammershop.pl', currency: 'PLN', products: [
        { id: '1', name: 'Ranga VIP', category: 'Rangi', description: 'Kolorowy nick, /kit vip, prefiks na czacie i dostęp do strefy VIP.', price: 19.99, image: shopArt('VIP', '#ffb36b', '#c2410c'), instant: true },
        { id: '2', name: 'Ranga SVIP', category: 'Rangi', description: 'Wszystko z VIP + /fly w lobby, 2× więcej domów i własne cząsteczki.', price: 39.99, image: shopArt('SVIP', '#c4b5fd', '#6d28d9'), instant: true },
        { id: '3', name: 'Plugin: Hammer Auctions', category: 'Pluginy', description: 'Dom aukcyjny z GUI, podatkami i historią – gotowy w 5 minut.', price: 49.0, image: shopArt('PLUG', '#86efac', '#15803d'), instant: true },
        { id: '4', name: 'Konfiguracja serwera', category: 'Usługi', description: 'Postawimy i zoptymalizujemy Twój serwer Paper/Velocity.', price: 149.0, image: shopArt('SETUP', '#7dd3fc', '#0369a1'), instant: false },
      ] }),
    },
    gallery: {
      list: async (id) => [
        ['#7cc8ff', '#2f7a3f', 'Zachód słońca', 'hammershop'], ['#ffb36b', '#4a2b14', 'Nether', 'survival'], ['#9be7ff', '#e7f7ff', 'Góry', 'hammershop'], ['#b18cff', '#1c1036', 'End', 'fo'],
        ['#ffd36b', '#2f7a3f', 'Wioska', 'survival'], ['#7cc8ff', '#1d4ed8', 'Ocean', 'hammershop'], ['#ff8f8f', '#3b1010', 'Baza', 'survival'], ['#c3f07c', '#225c2a', 'Las', 'fo'],
      ].map(([c1, c2, label, inst], i) => ({ instanceId: inst, instanceName: instances.find((x) => x.id === inst).name, file: `2026-11-0${(i % 9) + 1}_18.2${i}.11.png`, url: scene(c1, c2, label), size: 2.1e6, takenAt: now - i * 7.3 * 3600e3 })).filter((x) => !id || x.instanceId === id),
      remove: async () => true, copy: async () => true, show: async () => true,
      // „Udostępnij link”: window.__noShare = no host configured, window.__shareFails = the host does not answer.
      shareInfo: async () => (window.__noShare ? { available: false, hours: null, service: null, ask: true } : { available: true, hours: 72, service: 'litterbox.catbox.moe', ask: settings.screenshotShareAsk !== false }),
      share: async (id, file, opts) => {
        if (settings.screenshotShareAsk !== false && opts?.agreed !== true) throw new Error('Najpierw potwierdź, że zrzut ekranu może zostać wysłany do zewnętrznego serwisu.');
        if (opts?.remember) settings.screenshotShareAsk = false;
        await gate(250);
        if (window.__shareFails) throw new Error('Nie udało się wysłać zrzutu ekranu – serwis nie odpowiada. Sprawdź internet i spróbuj ponownie za chwilę.');
        return { url: 'https://litter.catbox.moe/k3x9wq.png', hours: 72, expiresAt: Date.now() + 72 * 3600e3 };
      },
    },
    optimizer: {
      info: async (id) => {
        const i = instances.find((x) => x.id === id) ?? instances[0];
        const major = /^26/.test(i.mcVersion) ? 25 : /^1\.(21|20\.[5-9])/.test(i.mcVersion) ? 21 : /^1\.(1[89]|20)/.test(i.mcVersion) ? 17 : 8;
        const g1 = ['-XX:+IgnoreUnrecognizedVMOptions', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-XX:+UseG1GC', '-XX:+ParallelRefProcEnabled', '-XX:MaxGCPauseMillis=37', '-XX:+UnlockExperimentalVMOptions', '-XX:+UnlockDiagnosticVMOptions', '-XX:+DisableExplicitGC', '-XX:G1NewSizePercent=23', '-XX:G1MaxNewSizePercent=40', '-XX:G1HeapRegionSize=16M', '-XX:G1ReservePercent=20', '-XX:G1HeapWastePercent=5', '-XX:G1MixedGCCountTarget=3', '-XX:InitiatingHeapOccupancyPercent=20', '-XX:G1MixedGCLiveThresholdPercent=90', '-XX:SurvivorRatio=32', '-XX:MaxTenuringThreshold=1', '-XX:+PerfDisableSharedMem', '-XX:+UseStringDeduplication', '-XX:+UseFastUnorderedTimeStamps', '-XX:+OmitStackTraceInFastThrow'];
        return {
          system: { platform: 'win32', totalMem: 16 * GB, freeMem: 7.4 * GB, cpuModel: 'AMD Ryzen 5 5600X 6-Core Processor', cpuCores: 12, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', gpus: ['NVIDIA GeForce RTX 3060'] },
          modCount: 14,
          recommendation: {
            memoryMb: 4096, jvmPreset: 'recommended', optionsPreset: 'balanced', turbo: true, gpuClass: 'highend',
            reasons: [
              { key: 'memory', title: 'Pamięć: 4 GB', text: 'Masz 16 GB pamięci i 14 modów w instancji. Gra dostanie 4 GB – nigdy więcej niż połowę, bo system, Discord i przeglądarka też jej potrzebują, a zbyt duża pamięć spowalnia Javę.' },
              { key: 'jvm', title: 'Flagi Javy: zalecane (G1GC)', text: `Dostrojony G1GC to najlepszy wybór dla większości komputerów. Flagi są dobrane do Javy ${major}, na której działa ta instancja.` },
              { key: 'options', title: 'Grafika: Zrównoważony', text: 'Twój komputer spokojnie uciągnie ładną grafikę przy wysokim FPS.' },
              { key: 'mods', title: 'Mody: zestaw podstawowy', text: 'Sprawdzone mody, bezpieczne dla każdego komputera. Twój procesor ma 12 wątków, więc możesz też włączyć dodatki Turbo (przełącznik przy liście modów) – szybciej wczytują świat.' },
            ],
          },
          presets: { low: 'Słaby komputer', fps: 'Maks. FPS', balanced: 'Zrównoważony', quality: 'Jakość' },
          java: { major, known: true, own: false, zgc: major >= 21 },
          jvm: { memoryMb: 4096, flags: { recommended: major >= 25 ? [...g1, '-XX:+UseCompactObjectHeaders'] : g1, zgc: ['-XX:+IgnoreUnrecognizedVMOptions', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', '-XX:+UseZGC', '-XX:+ZGenerational', '-XX:+DisableExplicitGC', '-XX:+PerfDisableSharedMem', '-XX:+OmitStackTraceInFastThrow'], vanilla: g1.slice(0, 3) } },
        };
      },
      plan: async (id, opts) => (await wait(), { supported: true, mods: [
        { slug: 'sodium', name: 'Sodium', why: 'Nowy silnik renderowania – zwykle 2–3× więcej FPS.', tier: 'core', available: true, installed: true, version: { number: '0.6.5' } },
        { slug: 'lithium', name: 'Lithium', why: 'Szybsza logika gry: moby, fizyka, redstone.', tier: 'core', available: true, installed: true, version: { number: '0.14.3' } },
        { slug: 'ferrite-core', name: 'FerriteCore', why: 'Gra zużywa nawet o połowę mniej pamięci RAM.', tier: 'core', available: true, installed: true, version: { number: '7.1.1' } },
        { slug: 'modernfix', name: 'ModernFix', why: 'Szybsze uruchamianie i mniej zużytej pamięci.', tier: 'core', available: true, installed: false, version: { number: '5.20.2' } },
        { slug: 'entityculling', name: 'Entity Culling', why: 'Nie rysuje mobów i skrzyń, których nie widać.', tier: 'core', available: true, installed: false, version: { number: '1.7.3' } },
        { slug: 'immediatelyfast', name: 'ImmediatelyFast', why: 'Szybsze rysowanie tekstu, map i interfejsu.', tier: 'core', available: true, installed: false, version: { number: '1.3.4' } },
        { slug: 'dynamic-fps', name: 'Dynamic FPS', why: 'Mniej FPS w tle – laptop się nie grzeje, gdy grasz w innym oknie.', tier: 'core', available: true, installed: false, version: { number: '3.8.0' } },
        { slug: 'krypton', name: 'Krypton', why: 'Lżejsza obsługa sieci na serwerach.', tier: 'core', available: false, installed: false, version: null },
        ...(opts?.turbo ? [
          { slug: 'c2me-fabric', name: 'C2ME', why: 'Generuje i wczytuje chunki na wielu rdzeniach procesora naraz.', tier: 'turbo', available: true, installed: false, version: { number: '0.4.0-alpha.0.30+1.21.1' } },
          { slug: 'scalablelux', name: 'ScalableLux', why: 'Szybszy silnik światła – płynniejsze ładowanie nowych terenów.', tier: 'turbo', available: true, installed: false, version: { number: '0.3.0' } },
          { slug: 'ksyxis', name: 'Ksyxis', why: 'Świat otwiera się szybciej – gra nie czeka na chunki wokół spawnu.', tier: 'turbo', available: true, installed: true, version: { number: '1.4.6' } },
        ] : []),
        ...(opts?.shaders ? [{ slug: 'iris', name: 'Iris Shaders', why: 'Shadery na Sodium – ładniejsza grafika, gdy masz mocny komputer.', tier: 'shaders', available: true, installed: false, version: { number: '1.8.8' } }] : []),
      ] }),
      apply: async (id, opts) => (await wait(200), {
        installed: opts?.mods ? ['ModernFix', 'Entity Culling', 'ImmediatelyFast', 'Dynamic FPS', ...(opts.turbo ? ['C2ME', 'ScalableLux'] : [])] : [], skipped: ['Sodium', 'Lithium', 'FerriteCore'], warnings: [], missing: opts?.mods ? ['Krypton'] : [],
        summary: { mods: opts?.mods ? { installed: ['ModernFix', 'Entity Culling', 'ImmediatelyFast', 'Dynamic FPS', ...(opts.turbo ? ['C2ME', 'ScalableLux'] : [])], already: 3, missing: ['Krypton'] } : null, memoryMb: 4096, memoryAuto: true, jvmPreset: 'recommended', javaMajor: 21, optionsPreset: opts?.optionsPreset ? { key: opts.optionsPreset, label: { low: 'Słaby komputer', fps: 'Maks. FPS', balanced: 'Zrównoważony', quality: 'Jakość' }[opts.optionsPreset] } : null, priority: 'above_normal', turbo: Boolean(opts?.turbo), shaders: Boolean(opts?.shaders) },
      }),
    },
    servers: {
      list: async (id) => (await wait(), serverList(id)),
      official: async () => ({ available: true }),
      importOfficial: async () => {
        const before = servers.length;
        for (const s of [{ name: 'Hypixel', address: 'mc.hypixel.net' }, { name: 'CraftMC', address: 'craftmc.pl' }]) if (!servers.some((x) => x.address === s.address)) servers.push(s);
        return { added: servers.length - before, skipped: 2 - (servers.length - before), servers: serverList() };
      },
      add: async (id, d) => (servers.push({ name: d.name || d.address, address: d.address }), serverList()),
      update: async (id, index, d) => (Object.assign(servers[index], { name: d.name || d.address, address: d.address }), serverList()),
      remove: async (id, index) => (servers.splice(index, 1), serverList()),
      move: async (id, from, to) => (servers.splice(to, 0, ...servers.splice(from, 1)), serverList()),
    },
    worlds: {
      list: async (id) => (await wait(), id === 'hammershop' ? worlds.map((w) => ({ ...w })) : []),
      rename: async (id, folder, name) => Object.assign(worlds.find((w) => w.folder === folder), { name }),
      remove: async (id, folder) => (worlds.splice(worlds.findIndex((w) => w.folder === folder), 1), true),
      open: async () => '',
      backup: async (id, folder) => (await wait(300), backups.unshift({ file: `${folder}-2026-11-10_18-05.zip`, size: 702e6, createdAt: Date.now(), world: folder }), backups[0]),
      backups: async (id) => (id === 'hammershop' ? backups.map((b) => ({ ...b })) : []),
      restore: async (id, file) => ({ folder: `${backups.find((b) => b.file === file).world} (2)` }),
      removeBackup: async (id, file) => (backups.splice(backups.findIndex((b) => b.file === file), 1), true),
    },
    official: {
      info: async () => ({ available: true, servers: true, worlds: true, options: true }),
      worlds: async () => (await wait(120), officialWorlds.map((w) => ({ ...w }))),
      importWorlds: async (id, folders) => {
        const copied = [];
        for (const [n, folder] of folders.entries()) {
          const w = officialWorlds.find((x) => x.folder === folder);
          const label = `Kopiowanie świata: ${folder}${folders.length > 1 ? ` (${n + 1}/${folders.length})` : ''}`;
          window.__emit('task:progress', { scope: 'official-worlds', label, done: w.size * 0.37, total: w.size });
          await gate();
          window.__emit('task:progress', { scope: 'official-worlds', label, done: 1, total: 1 });
          const taken = worlds.some((x) => x.folder === folder);
          worlds.unshift({ ...w, folder: taken ? `${folder} (2)` : folder, lastPlayed: w.lastPlayed });
          copied.push({ source: folder, folder: taken ? `${folder} (2)` : folder, files: 412, size: w.size });
        }
        return { copied, failed: [] };
      },
      importOptions: async () => (await wait(150), { backup: 'options.txt.przed-importem', lines: 142 }),
    },
    share: {
      export: async (id, opts) => (await wait(200), recipeOf(id, opts?.options)),
      save: async (id) => (await wait(100), { file: recipeOf(id).fileName }),
      readCode: async (code) => {
        await wait(120);
        if (!/^HL1\./.test(String(code).trim())) throw new Error('To nie wygląda na kod instancji. Kod zaczyna się od „HL1.” – skopiuj go w całości.');
        return recipePreview('Survival z ekipą');
      },
      readFile: async (file) => (await wait(120), recipePreview(String(file).split(/[\\/]/).pop().replace(/\.hammerpack$/i, ''), ['Fabric 0.15.2 nie ma już na liście – launcher użyje najnowszej zalecanej wersji.'])),
      pick: async () => (await wait(120), recipePreview('Budowanie u Oli')),
      install: async () => {
        window.__emit('task:progress', { scope: 'recipe', label: 'Sprawdzanie dodatków na Modrinth', done: 0, total: 0 });
        await wait(120);
        window.__emit('task:progress', { scope: 'recipe', label: 'Pobieranie dodatków (17/41)', done: 17, total: 41 });
        await gate();
        window.__emit('task:progress', { scope: 'recipe', label: 'Pobieranie dodatków (41/41)', done: 41, total: 41 });
        instances.push({ id: `przepis-${instances.length}`, name: 'Survival z ekipą', mcVersion: '1.21.1', loader: 'fabric', icon: 'rocket', optimized: false, hammerClient: true, playTimeMs: 0, lastPlayed: null, createdAt: Date.now() });
        settings.selectedInstance = instances.at(-1).id;
        return { instance: { ...instances.at(-1) }, installed: 39, missing: window.__allFound ? [] : [{ type: 'mod', file: 'stary-mod-od-kolegi-1.2.0.jar', reason: 'gone' }, { type: 'resourcepack', file: 'Paczka świąteczna 2023.zip', reason: 'failed' }], notes: [] };
      },
    },
    invite: {
      pending: async () => window.__pendingInvite ?? null,
      read: async (input) => {
        await wait(150);
        if (input && typeof input === 'object') {
          const s = FEATURED.find((x) => x.id === input.featured);
          return (lastInvite = inviteOf({ server: s.address, name: s.name, mc: s.mc, loader: s.loader, pack: s.pack }));
        }
        const text = String(input ?? '').trim();
        if (!text) throw new Error('Wklej link z zaproszeniem.');
        if (!/^(hammer:\/\/join|https:\/\/[^/]+\/join)\?/.test(text)) throw new Error(NOT_INVITE);
        const q = new URL(text).searchParams;
        if (!q.get('server')) throw new Error('W tym zaproszeniu brakuje adresu serwera.');
        return (lastInvite = inviteOf({ server: q.get('server'), name: q.get('name'), mc: q.get('mc'), loader: q.get('loader'), pack: q.get('pack') }));
      },
      accept: async (token, choice) => {
        const { invite, pack, create } = lastInvite;
        let instance = instances.find((i) => i.id === choice?.instanceId);
        const created = !instance;
        if (created) {
          if (pack) {
            window.__emit('task:progress', { scope: 'modpack', label: `Pobieranie paczki ${pack.title}`, done: 0, total: 0 });
            await wait(150);
            window.__emit('task:progress', { scope: 'modpack', label: 'Pobieranie plików paczki (61/148)', done: 61, total: 148 });
            await gate();
            window.__emit('task:progress', { scope: 'modpack', label: 'Pobieranie plików paczki (148/148)', done: 148, total: 148 });
          }
          instance = { id: `zaproszenie-${instances.length}`, name: create.name, mcVersion: create.mc, loader: create.loader, icon: pack ? 'star' : 'hammer', optimized: true, hammerClient: true, playTimeMs: 0, lastPlayed: null, createdAt: Date.now(), ...(pack ? { modpack: { name: pack.title, version: pack.version, iconUrl: logo('FO', '#6dd3ff', '#2563eb') } } : {}) };
          instances.push(instance);
          settings.selectedInstance = instance.id;
        } else await wait(150);
        const has = instance.id === 'hammershop' && servers.some((x) => x.address === invite.server);
        if (instance.id === 'hammershop' && !has) servers.push({ name: invite.name ?? invite.server, address: invite.server });
        return { instance: { ...instance }, server: invite.server, name: invite.name ?? invite.server, added: !has, created };
      },
      link: async (id, address, opts) => {
        await wait(80);
        const i = instances.find((x) => x.id === id);
        const server = servers.find((x) => x.address === address) ?? { name: address, address };
        const pack = i.modpack ? { name: i.modpack.name, included: opts?.pack !== false } : null;
        const q = new URLSearchParams({ server: server.address, ...(server.name !== server.address ? { name: server.name } : {}), mc: i.mcVersion, loader: i.loader, ...(pack?.included ? { pack: '1KVo5zza' } : {}) });
        return { link: `https://hammerclient.com/join?${q}`, web: true, server: { name: server.name, address: server.address }, mc: i.mcVersion, loader: i.loader, pack };
      },
    },
    featured: { list: async () => (await wait(100), (window.__featured ?? FEATURED).map((x) => ({ ...x, tags: [...x.tags] }))) },
    clipboard: { read: async () => window.__clipboard ?? '', write: async (text) => ((window.__clipboard = String(text)), true) },
    cleanup: {
      usage: async () => (await wait(150), {
        total: 12.18 * GB,
        instances: [{ id: 'hammershop', name: 'Hammer', size: 5.2 * GB }, { id: 'survival', name: 'Survival z ekipą', size: 2.1 * GB }, { id: 'fo', name: 'Fabulously Optimized', size: 0.9 * GB }, { id: 'pvp', name: 'PvP 1.8.9', size: 118e6 }],
        versions: 0.31 * GB, libraries: 0.62 * GB, assets: 1.9 * GB, runtime: 0.94 * GB, runtimes: [{ name: 'java-runtime-delta', size: 0.5 * GB }, { name: 'java-runtime-gamma', size: 0.44 * GB }], cache: 96e6, logs: 2.1e6,
      }),
      plan: async () => (await wait(), {
        total: 12.4e6 + 96e6 + 412e6 + 0.44 * GB,
        groups: [
          { key: 'logs', size: 12.4e6, count: 48, items: [] },
          { key: 'cache', size: 96e6, count: 12, items: [] },
          { key: 'versions', size: 412e6, count: 2, items: [{ name: '1.19.4', size: 380e6 }, { name: 'fabric-loader-0.15.11-1.19.4', size: 32e6 }] },
          { key: 'runtimes', size: 0.44 * GB, count: 1, items: [{ name: 'java-runtime-gamma', size: 0.44 * GB, java: 17 }] },
        ],
      }),
      apply: async () => ({ freed: 993e6, removed: 63, failed: 0 }),
    },
    logs: { share: async () => (await wait(200), { url: 'https://mclo.gs/HaMm3rX', id: 'HaMm3rX' }) },
    bundles: {
      list: async () => BUNDLES.map(bundleMeta),
      plan: async (id, bundleId) => {
        await wait(120);
        const b = BUNDLES.find((x) => x.id === bundleId);
        return { ...bundleMeta(b), supported: true, mods: b.mods.map(([name, why, st, type]) => ({ slug: name.toLowerCase().replace(/\W+/g, '-'), name, why, type: type ?? 'mod', available: st > 0, installed: st === 2, version: st ? { number: '1.0.0' } : null })) };
      },
      install: async (id, bundleId) => {
        await wait(300);
        const b = BUNDLES.find((x) => x.id === bundleId);
        const added = b.mods.filter((m) => m[2] === 1).map((m) => m[0]);
        b.mods.forEach((m) => m[2] === 1 && (m[2] = 2));
        return { installed: [...added, 'Fabric API'], skipped: [], warnings: [], missing: b.mods.filter((m) => m[2] === 0).map((m) => m[0]) };
      },
    },
    plus: {
      status: async () => plusStatus(),
      activate: async (code) => {
        if (!/^HP1\./.test(String(code).trim())) throw new Error('To nie wygląda na kod Hammer+. Kod zaczyna się od „HP1.” – skopiuj go w całości z wiadomości bota.');
        Object.assign(plus, { active: true, why: null });
        return plusStatus();
      },
      remove: async () => (Object.assign(plus, { active: false, why: null }), plusStatus()),
      paste: async () => 'HP1.eyJpZCI6ImExYjJjM2Q0ZTVmNjA3MTgiLCJtYyI6IjAxMjM0NTY3ODlhYmNkZWYwMTIzNDU2Nzg5YWJjZGVmIiwiZXhwIjoxNzk3MDczMjAwLCJpYXQiOjE3OTQ0ODEyMDB9.pX9mK2vQ7LwT4zRb8NcY1sHd6EfJ3uGa0oIhVtWqBnMxCkDlSyUjZeFrPgAi5T-_w8Q2',
      capes: async () => ({ capes: CAPES.map((c) => ({ ...c })), selected: plus.active ? plus.cape : '' }),
      setCape: async (id) => (await wait(150), (plus.cape = id ?? ''), { selected: plus.cape, shared: false, note: 'Inni gracze zobaczą ją, gdy sklep HammerShop będzie online.' }),
    },
    theme: {
      background: async () => ({ url: plus.active ? plus.bgUrl : null }),
      pickBackground: async () => ((plus.bgUrl = scene('#3a6fd8', '#1f4d2c', '')), (settings.background = 'background-0a1b2c3d.png'), { settings: { ...settings }, url: plus.bgUrl }),
      clearBackground: async () => ((plus.bgUrl = null), (settings.background = ''), { settings: { ...settings }, url: null }),
      menuBackground: async () => ({ url: plus.active ? plus.menuUrl : null }),
      pickMenuBackground: async () => ((plus.menuUrl = scene('#b18cff', '#1c1036', '')), { url: plus.menuUrl }),
      clearMenuBackground: async () => ((plus.menuUrl = null), { url: null }),
    },
    cloud: {
      status: async () => ({ active: plus.active, auto: plus.active && Boolean(settings.cloudAuto), last: plus.last, note: plus.cloud === 'offline' && plus.asked ? NOTE : null }),
      push: async () => (await wait(200), (plus.asked = true), cloudAnswer('push')),
      pull: async () => (await wait(200), (plus.asked = true), cloudAnswer('pull')),
      startup: async () => ({ skipped: true }),
    },
    skins: {
      saveOutfit: async (d) => (outfits.unshift({ id: `bbbbbbbbbbb${outfits.length}`, name: d.name || 'Zestaw', skin: d.skin, variant: d.variant, cape: d.cape, capeName: d.capeName || null, createdAt: Date.now() }), outfitList()),
      applyOutfit: async (id) => {
        await wait(250);
        const o = outfits.find((x) => x.id === id);
        wardrobe.worn = o.skin;
        skinLib.find((x) => x.id === o.skin).variant = o.variant;
        wardrobe.capes.forEach((c) => (c.active = c.id === o.cape));
        return skinState();
      },
      removeOutfit: async (id) => (outfits.splice(outfits.findIndex((x) => x.id === id), 1), outfitList()),
      get: async () => (await wait(150), skinState()),
      pick: async () => ({ name: 'Nocny łowca', dataUrl: SKINS.nowa, legacy: false }),
      upload: async ({ png, variant, name }) => {
        await wait(250);
        const entry = { id: hex(String(skinLib.length)), name: name || 'Skórka', variant, dataUrl: png, addedAt: Date.now(), usedAt: Date.now() };
        skinLib.unshift(entry);
        wardrobe.worn = entry.id;
        return skinState();
      },
      use: async (id) => (await wait(250), (wardrobe.worn = id), skinState()),
      reset: async () => (await wait(250), (wardrobe.worn = null), skinState()),
      cape: async (capeId) => (await wait(200), wardrobe.capes.forEach((c) => (c.active = c.id === capeId)), skinState()),
      forget: async (id) => (skinLib.splice(skinLib.findIndex((x) => x.id === id), 1), skinLib.map((x) => ({ ...x }))),
    },
  };
}

let whenStepFails = null; // set in main(): the language lists of the run are written even when a step fails

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 780 }, deviceScaleFactor: SCALE });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  // The language of this run: in English the steps below find their buttons through the dictionary (T).
  const language = createPreviewLanguage({ lang: LANG, collect: Boolean(SWITCH.collect), compare: typeof SWITCH.compare === 'string' ? path.resolve(SWITCH.compare) : null, out: OUT });
  const T = language.T;
  await page.addInitScript(language.init, language.initArg);
  await page.addInitScript(mock);
  language.patch(page);
  whenStepFails = async () => {
    const found = [];
    await language.finish(page, found);
    if (found.length) console.error(found.join('\n'));
  };
  await page.goto(PAGE);
  await page.waitForTimeout(400);

  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    await language.afterShot(page, name);
    console.log(`✓ ${name}`);
  };
  const nav = (title) => page.locator('.nav-item', { hasText: title }).click();
  const closeModal = () => page.keyboard.press('Escape');

  await shot('01-graj');
  await page.locator('.view').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await shot('01b-graj-sklep');
  await page.locator('.view').evaluate((v) => (v.scrollTop = 0));
  await page.evaluate(() => {
    HS.state.running.set('hammershop', 'preparing');
    window.__emit('game:progress', { instanceId: 'hammershop', stage: 'minecraft', label: 'Pobieranie Minecrafta', done: 412, total: 1000, percent: 41 });
  });
  await shot('02-graj-pobieranie');
  await page.evaluate(() => {
    HS.state.running.clear();
    HS.state.progress.clear();
    HS.bus.emit('game');
  });

  await nav('Instancje');
  await shot('03-instancje');
  await page.locator('.page-head .btn.primary').click();
  await shot('04-nowa-instancja');
  await closeModal();

  await nav('Mody');
  await page.waitForTimeout(300);
  await shot('05-mody-przegladaj');
  await page.locator('.project h3').first().click();
  await shot('06-mod-szczegoly');
  await closeModal();
  await page.locator('.seg button', { hasText: 'Zainstalowane' }).click();
  await page.waitForTimeout(200);
  await page.locator('button', { hasText: 'Sprawdź aktualizacje' }).click();
  await shot('07-mody-zainstalowane');

  await nav('Serwery');
  await page.waitForTimeout(400);
  await shot('14-serwery');
  await page.locator('.page-head .btn.primary').click();
  await page.locator('.modal input').nth(0).fill('Skyblock u Oli');
  await page.locator('.modal input').nth(1).fill('mc.hammershop.pl');
  await page.locator('.modal button', { hasText: 'Sprawdź' }).click();
  await shot('15-serwer-dodaj');
  await closeModal();

  await nav('Światy');
  await page.waitForTimeout(300);
  await shot('16-swiaty');
  await page.locator('.world-row button[title="Zmień nazwę"]').first().click();
  await shot('17-swiat-zmiana-nazwy');
  await closeModal();

  // The new lists at the smallest window size (nothing may overflow or wrap badly).
  await page.setViewportSize({ width: 1040, height: 660 });
  await shot('16b-swiaty-male-okno');
  await nav('Serwery');
  await page.waitForTimeout(400);
  await shot('14b-serwery-male-okno');
  await page.setViewportSize({ width: 1240, height: 780 });

  // An instance without servers and worlds.
  await page.evaluate(() => HS.state.selectInstance('pvp'));
  await page.waitForTimeout(300);
  await shot('14c-serwery-pusto');
  await nav('Światy');
  await page.waitForTimeout(300);
  await shot('16c-swiaty-pusto');
  await page.evaluate(() => HS.state.selectInstance('hammershop'));

  await nav('Instancje');
  await page.locator('.inst-card .more').first().click();
  await shot('03b-instancja-menu');
  await page.mouse.click(700, 720);

  await nav('Optymalizacja');
  await page.waitForTimeout(300);
  await shot('08-optymalizacja');
  await page.locator('.view').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await shot('09-optymalizacja-dol');

  await page.evaluate(() => HS.state.crashes.set('hammershop', { title: 'Zabrakło pamięci RAM dla gry', hints: ['Zwiększ pamięć w zakładce Optymalizacja (np. do 6 GB).', 'Zamknij przeglądarkę i inne programy, które zużywają dużo pamięci.'], details: 'java.lang.OutOfMemoryError: Java heap space' }));
  await nav('Konsola');
  await page.waitForTimeout(300);
  await shot('10-konsola');
  await page.locator('button', { hasText: 'Wyślij logi' }).click();
  await shot('18-logi-pytanie');
  await page.locator('.modal .btn.primary').click();
  await page.waitForTimeout(300);
  await shot('19-logi-link');
  await closeModal();

  await nav('Galeria');
  await page.waitForTimeout(300);
  await shot('12-galeria');
  await page.locator('.shot').first().click();
  await shot('13-galeria-podglad');
  await page.keyboard.press('Escape');

  await nav('Ustawienia');
  await shot('11-ustawienia');
  await page.waitForTimeout(300);
  const diskTop = () => page.locator('.card', { hasText: 'Miejsce na dysku' }).evaluate((card) => (document.getElementById('view').scrollTop = card.offsetTop - 16));
  await diskTop();
  await shot('20-ustawienia-dysk');
  await page.locator('.clean-row').first().click();
  await page.locator('button', { hasText: 'Zwolnij' }).click();
  await shot('21-sprzatanie-pytanie');
  await closeModal();
  await page.setViewportSize({ width: 1040, height: 660 });
  await diskTop();
  await shot('20b-ustawienia-dysk-male-okno');
  await page.setViewportSize({ width: 1240, height: 780 });

  // Click through the new actions once (no screenshots) – an error in any handler fails the preview.
  const confirm = () => page.locator('.modal-foot .btn').last().click();
  const count = async (selector, expected) => {
    await page.waitForTimeout(250);
    const n = await page.locator(selector).count();
    if (n !== expected) errors.push(`${selector}: ${n} zamiast ${expected}`);
  };
  await nav('Serwery');
  await count('.server-row', 5);
  await page.locator('.server-row button[title="Przesuń niżej"]').first().click();
  await page.locator('.server-row button[title="Edytuj"]').first().click();
  await page.locator('.modal input').nth(0).fill('Zmieniona nazwa');
  await confirm();
  await page.locator('.server-row button[title="Usuń"]').last().click();
  await confirm();
  await count('.server-row', 4);
  await page.locator('.page-head .btn.primary').click();
  await page.locator('.modal input').nth(1).fill('nowy.example.com:25570');
  await confirm();
  await count('.server-row', 5);
  await page.locator('button[title="Odśwież status"]').click();
  await count('.server-row', 5);

  await nav('Światy');
  await count('.world-row', 4);
  await page.locator('.world-row button', { hasText: 'Kopia zapasowa' }).first().click();
  await page.waitForTimeout(500);
  await count('.card .installed-row', 3);
  await page.locator('button', { hasText: 'Przywróć' }).first().click();
  await page.locator('button[title="Usuń kopię"]').last().click();
  await confirm();
  await count('.card .installed-row', 2);
  await page.locator('.world-row button[title="Zmień nazwę"]').first().click();
  await page.locator('.modal input').fill('Nowa nazwa świata');
  await confirm();
  await page.locator('.world-row button[title="Usuń"]').last().click();
  await confirm();
  await count('.world-row', 3);

  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await page.locator('button', { hasText: 'Zwolnij' }).click();
  await confirm();
  await page.waitForTimeout(300);
  await page.locator('button[title="Policz ponownie"]').click();
  await page.waitForTimeout(400);

  /* ── optimisation: explanations, exact flags, Turbo, the summary of "Zoptymalizuj wszystko" ── */
  // (scrolls at once: the page's smooth scrolling would still be on its way when the screenshot is taken)
  const viewTop = (selector, text) =>
    page.locator(selector, { hasText: text }).first().evaluate((el) => {
      const view = document.getElementById('view');
      view.style.scrollBehavior = 'auto';
      view.scrollTop = (el.closest('.card') ?? el).offsetTop - 16;
      view.style.scrollBehavior = '';
    });
  // Messages of the steps before must not cover the new screens.
  const noToasts = () => page.evaluate(() => document.getElementById('toasts').replaceChildren());
  await noToasts();
  await nav('Optymalizacja');
  await page.waitForTimeout(400);
  await page.locator('button', { hasText: 'Dlaczego?' }).click();
  await shot('22-optymalizacja-dlaczego');
  await closeModal();
  await page.locator('button', { hasText: 'Pokaż flagi' }).click();
  await shot('23-optymalizacja-flagi');
  await closeModal();
  await page.locator('label.check', { hasText: 'Turbo' }).click();
  await page.locator('label.check', { hasText: 'z shaderami' }).click();
  await page.waitForTimeout(300);
  await page.locator('.tier-head', { hasText: 'Turbo' }).evaluate((el) => (document.getElementById('view').scrollTop += el.getBoundingClientRect().top - 330));
  await shot('24-optymalizacja-turbo');
  await page.locator('.view').evaluate((v) => (v.scrollTop = 0));
  await page.locator('button', { hasText: 'Zoptymalizuj wszystko' }).click();
  await page.waitForTimeout(600);
  await shot('25-optymalizacja-gotowe');
  await closeModal();
  await page.setViewportSize({ width: 1040, height: 660 });
  await shot('08b-optymalizacja-male-okno');
  await viewTop('h2', 'Flagi Javy');
  await shot('09b-optymalizacja-dol-male-okno');
  await page.locator('button', { hasText: 'Dlaczego?' }).click();
  await shot('22b-optymalizacja-dlaczego-male-okno');
  await closeModal();
  await page.setViewportSize({ width: 1240, height: 780 });
  // An old vanilla instance: Java 8 has no ZGC, and there are no mods without a loader.
  await page.evaluate(() => HS.state.selectInstance('pvp'));
  await page.waitForTimeout(400);
  await viewTop('h2', 'Flagi Javy');
  await shot('26-optymalizacja-java8');
  await page.evaluate(() => HS.state.selectInstance('hammershop'));

  /* ── Mody → Zestawy ── */
  await nav('Mody');
  await page.locator('.seg button', { hasText: 'Zestawy' }).click();
  await page.waitForTimeout(500);
  await shot('27-zestawy');
  await page.locator('.view').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await shot('27b-zestawy-dol');
  await page.locator('.view').evaluate((v) => (v.scrollTop = 0));
  await page.locator('.bundle', { hasText: 'Budowanie' }).locator('.btn.primary').click();
  await page.waitForTimeout(700);
  await count('.bundle .btn.primary:disabled', 2); // Shadery was complete, Budowanie is now
  await noToasts();
  await page.setViewportSize({ width: 1040, height: 660 });
  await shot('27c-zestawy-male-okno');
  await page.setViewportSize({ width: 1240, height: 780 });
  await page.evaluate(() => HS.state.selectInstance('pvp'));
  await page.waitForTimeout(300);
  await shot('27d-zestawy-vanilla');
  await page.evaluate(() => HS.state.selectInstance('hammershop'));

  /* ── Skórka ── */
  await nav('Skórka');
  await page.waitForTimeout(600);
  await shot('28-skorka');
  await page.locator('button', { hasText: 'Wgraj skórkę' }).click();
  await page.waitForTimeout(400);
  await shot('29-skorka-nowa');
  await page.locator('.modal .seg button', { hasText: 'Smukły' }).click();
  await page.locator('.modal input').fill('Nocny łowca');
  await confirm();
  await page.waitForTimeout(700);
  await count('.skin-tile', 6);
  await count('.skin-tile.on', 1);
  await noToasts();
  await shot('30-skorka-po-zmianie');
  await page.locator('.skin-tile', { hasText: 'Alex z lasu' }).locator('.btn.primary').click();
  await page.waitForTimeout(600);
  await page.locator('.cape-row', { hasText: 'Vanilla' }).locator('.btn.primary').click();
  await page.waitForTimeout(500);
  await count('.cape-row.on', 1);
  await page.locator('.cape-row.on button', { hasText: 'Ukryj' }).click();
  await page.waitForTimeout(500);
  await count('.cape-row.on', 0);
  await page.locator('.skin-tile button[title="Usuń z biblioteki"]').last().click();
  await confirm();
  await count('.skin-tile', 5);
  await noToasts();
  await page.setViewportSize({ width: 1040, height: 660 });
  await shot('28b-skorka-male-okno');
  await page.locator('.view').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await shot('28c-skorka-peleryny-male-okno');
  await page.setViewportSize({ width: 1240, height: 780 });
  await page.locator('button', { hasText: 'Przywróć domyślną' }).click();
  await shot('31-skorka-domyslna-pytanie');
  await confirm();
  await page.waitForTimeout(600);
  await noToasts();
  await page.locator('.view').evaluate((v) => (v.scrollTop = 0));
  await shot('32-skorka-domyslna');
  // Not signed in.
  await page.evaluate(async () => {
    window.__noAccount = true;
    await HS.state.refreshAccounts();
  });
  await page.waitForTimeout(300);
  await shot('33-skorka-bez-konta');
  await page.evaluate(async () => {
    window.__noAccount = false;
    await HS.state.refreshAccounts();
  });
  await page.waitForTimeout(500);
  await count('.skin-card', 1);

  /* ── Ustawienia → Wygląd: the launcher's colour ── */
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await viewTop('h2', 'Wygląd');
  await shot('34-ustawienia-wyglad');
  for (const [label, file] of [['Niebieski', '35-kolor-niebieski'], ['Zielony', '36-kolor-zielony'], ['Fioletowy', '37-kolor-fioletowy'], ['Czerwony', '38-kolor-czerwony'], ['Złoty', '39-kolor-zloty']]) {
    await nav('Ustawienia');
    await viewTop('h2', 'Wygląd');
    await page.locator(`.swatch[title="${label}"]`).click();
    await page.waitForTimeout(150);
    await nav(file === '36-kolor-zielony' ? 'Optymalizacja' : file === '37-kolor-fioletowy' ? 'Instancje' : file === '38-kolor-czerwony' ? 'Skórka' : 'Graj');
    await page.waitForTimeout(500);
    await shot(file);
  }
  await nav('Ustawienia');
  await viewTop('h2', 'Wygląd');
  await page.locator('.swatch[title="Pomarańczowy"]').click();
  await count('.swatch.on[title="Pomarańczowy"]', 1);

  // Ten tabs and the task card still fit in the smallest window.
  await page.setViewportSize({ width: 1040, height: 660 });
  await page.evaluate(() => window.__emit('task:progress', { label: 'Instalacja: Sodium', done: 3, total: 8 }));
  await nav('Graj');
  await shot('01c-graj-male-okno');
  const overflow = await page.locator('.sidebar').evaluate((el) => el.scrollHeight - el.clientHeight);
  if (overflow > 0) errors.push(`Pasek boczny nie mieści się w najmniejszym oknie (o ${overflow} px).`);
  await page.setViewportSize({ width: 1240, height: 780 });

  /* ── Hammer+ ── */
  const small = async (name, prepare) => {
    await page.setViewportSize({ width: 1040, height: 660 });
    await prepare?.();
    await shot(name);
    await page.setViewportSize({ width: 1240, height: 780 });
  };
  const jump = (to) => page.locator('.view').evaluate((v, where) => ((v.style.scrollBehavior = 'auto'), (v.scrollTop = where === 'top' ? 0 : v.scrollHeight), (v.style.scrollBehavior = '')), to);
  const top = () => jump('top');
  const bottom = () => jump('bottom');
  /** Nothing may stick out of the window: the title bar keeps its credit, and no page scrolls sideways. */
  const fits = async (where) => {
    const bad = await page.evaluate(() => {
      const out = [];
      const view = document.getElementById('view');
      if (view.scrollWidth > view.clientWidth + 1) out.push(`strona jest szersza niż okno o ${view.scrollWidth - view.clientWidth} px`);
      const bar = document.querySelector('.titlebar');
      if (bar.scrollWidth > bar.clientWidth + 1) out.push('pasek tytułu się nie mieści');
      const dev = document.querySelector('.tb-dev').getBoundingClientRect();
      const pill = document.getElementById('tb-plus').getBoundingClientRect();
      if (!dev.width || dev.right > pill.left - 8) out.push('„developed by 120FpsPlayer” nachodzi na przycisk Hammer+');
      for (const el of document.querySelectorAll('#view .card, #view .plus-hero')) {
        const r = el.getBoundingClientRect();
        const v = view.getBoundingClientRect();
        if (r.right > v.right + 1 || r.left < v.left - 1) out.push(`karta wystaje poza stronę (${el.querySelector('h2,h1')?.textContent ?? '?'})`);
      }
      for (const el of document.querySelectorAll('#view .set-row .ctl, #view .cloud-acts, #view .code-row, #view .plus-acts')) {
        const card = el.closest('.card, .plus-hero').getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.right > card.right - 4 || r.left < card.left + 4) out.push(`kontrolka wystaje poza kartę (${el.closest('.set-row')?.querySelector('b')?.firstChild?.textContent ?? el.className})`);
      }
      return out;
    });
    for (const text of bad) errors.push(`${where}: ${text}`);
  };
  const plusPill = () => page.locator('#tb-plus').click();

  // Off: the page behind the pill – what it gives, where the code goes.
  await page.evaluate(() => window.__emit('task:progress', { label: 'Instalacja: Sodium', done: 8, total: 8 })); // the task card from before goes away
  await page.waitForTimeout(1700);
  await noToasts();
  await plusPill();
  await count('.tb-plus.on', 0);
  await count('.perk', 8);
  await shot('40-hammerplus-wylaczony');
  await fits('Hammer+ wyłączony');
  await small('40b-hammerplus-wylaczony-male-okno', () => fits('Hammer+ wyłączony, małe okno'));
  // A code that is not a code.
  await page.locator('.input.code').fill('moj-kod-123');
  await page.locator('button', { hasText: 'Aktywuj' }).click();
  await shot('41-hammerplus-zly-kod');
  await noToasts();
  // A code for another account, and one that ran out.
  await page.evaluate(() => window.__plus(false, 'wrong-account'));
  await shot('42-hammerplus-inne-konto');
  await page.evaluate(() => window.__plus(false, 'expired'));
  await shot('43-hammerplus-wygasl');
  await page.evaluate(() => window.__plus(false));

  // The locked features, each with its gold marker.
  await nav('Ustawienia');
  await viewTop('h2', 'Wygląd');
  await shot('44-wyglad-bez-hammerplus');
  await fits('Wygląd bez Hammer+');
  await small('44b-wyglad-bez-hammerplus-male-okno', async () => {
    await viewTop('h2', 'Wygląd');
    await fits('Wygląd bez Hammer+, małe okno');
  });
  await viewTop('h2', 'Kopie światów i chmura');
  await shot('45-kopie-chmura-bez-hammerplus');
  await page.locator('.plus-locked').first().click(); // a locked control leads to the Hammer+ page
  await count('.plus-page', 1);
  await nav('Ustawienia');
  await viewTop('h2', 'Wygląd');
  await page.locator('.swatch.custom.locked').click();
  await count('.plus-page', 1);
  await nav('Światy');
  await page.waitForTimeout(300);
  await viewTop('h2', 'Kopie zapasowe');
  await shot('46-swiaty-kopie-bez-hammerplus');
  await nav('Skórka');
  await page.waitForTimeout(600);
  await count('.outfit-tile', 3);
  await count('.outfit-tile .plus-locked', 3);
  await viewTop('h2', 'Zestawy');
  await shot('47-skorka-zestawy-bez-hammerplus');
  await bottom();
  await shot('48-skorka-peleryny-bez-hammerplus');
  await page.locator('.hcape').first().click();
  await count('.plus-page', 1);

  // Paste + activate: everything unlocks, the pill turns gold, the account gets its "+".
  await page.locator('button', { hasText: 'Wklej' }).click();
  await shot('49-hammerplus-wklejony-kod');
  await page.locator('button', { hasText: 'Aktywuj' }).click();
  await page.waitForTimeout(400);
  await count('.tb-plus.on', 1);
  await count('.plus-badge', 1);
  await count('.plus-hero.on', 1);
  await shot('50-hammerplus-aktywny');
  await fits('Hammer+ aktywny');
  await noToasts();
  // Backgrounds and the cloud on the Hammer+ page.
  await page.locator('.picture-ctl button', { hasText: 'Wybierz obraz' }).last().click(); // the in-game menu picture
  await page.waitForTimeout(200);
  await bottom();
  await page.locator('button', { hasText: 'Wyślij do chmury' }).click(); // the shop is not online yet
  await page.waitForTimeout(500);
  await count('.cloud-note', 1);
  await shot('51-hammerplus-chmura-offline');
  await noToasts();
  await small('50b-hammerplus-aktywny-male-okno', async () => {
    await top();
    await fits('Hammer+ aktywny, małe okno');
  });
  await small('51b-hammerplus-chmura-male-okno', async () => {
    await bottom();
    await fits('Hammer+ chmura, małe okno');
  });
  // The shop is online: a copy is sent; then another computer sent a newer one.
  await page.evaluate(() => window.__cloud('ok'));
  await bottom();
  await page.locator('button', { hasText: 'Wyślij do chmury' }).click();
  await page.waitForTimeout(500);
  await count('.cloud-note', 0);
  await shot('52-hammerplus-chmura-wyslana');
  await noToasts();
  await page.evaluate(() => window.__cloud('conflict'));
  await page.locator('button', { hasText: 'Wyślij do chmury' }).click();
  await page.waitForTimeout(500);
  await shot('53-chmura-ktora-kopie');
  await small('53b-chmura-ktora-kopie-male-okno');
  await page.evaluate(() => window.__cloud('ok'));
  await page.locator('.modal button', { hasText: 'Zostaw tę z chmury' }).click();
  await page.waitForTimeout(600);
  await count('.modal', 0);
  await noToasts();
  await bottom();
  await page.locator('button', { hasText: 'Pobierz z chmury' }).click();
  await shot('54-chmura-pobierz-pytanie');
  await confirm();
  await page.waitForTimeout(600);
  await noToasts();
  // The same question when the launcher finds a newer copy by itself after a game.
  await page.evaluate(() => window.__emit('cloud:conflict', { conflict: true, updatedAt: 1, at: Date.now() - 3600e3, cloud: { instances: 1, servers: 1 }, local: { instances: 2, servers: 22 } }));
  await count('.modal', 1);
  await closeModal();

  // Ustawienia → Wygląd with Hammer+: an own colour, an animated background, own pictures.
  await nav('Ustawienia');
  await viewTop('h2', 'Wygląd');
  await page.locator('.swatch.custom input').evaluate((el) => {
    el.value = '#00007f'; // far too dark for a dark launcher → lightened, and the card says so
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await count('.look-note', 1);
  await shot('55-wyglad-kolor-za-ciemny');
  await page.locator('.swatch.custom input').evaluate((el) => {
    el.value = '#3de0b4';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  await count('.look-note', 0);
  await count('.swatch.custom.on', 1);
  await page.locator('.picture-ctl button', { hasText: 'Wybierz obraz' }).first().click(); // the launcher background
  await page.waitForTimeout(300);
  await count('.backdrop.on', 1);
  await viewTop('h2', 'Wygląd');
  await shot('56-wyglad-hammerplus');
  await fits('Wygląd z Hammer+');
  await small('56b-wyglad-hammerplus-male-okno', async () => {
    await viewTop('h2', 'Wygląd');
    await fits('Wygląd z Hammer+, małe okno');
  });
  await nav('Graj');
  await page.waitForTimeout(500);
  await shot('57-graj-wlasny-kolor-i-tlo');
  await nav('Instancje');
  await shot('57b-instancje-wlasne-tlo');
  await nav('Mody');
  await page.waitForTimeout(400);
  await shot('57c-mody-wlasne-tlo');
  // The three animated backgrounds (without the own picture, so they also show behind the other pages).
  await nav('Ustawienia');
  await viewTop('h2', 'Wygląd');
  await page.locator('.picture-ctl button[title="Usuń tło launchera"]').click();
  await count('.backdrop.on', 0);
  for (const [label, file] of [['Zorza', '58-graj-zorza'], ['Kuźnia', '59-graj-kuznia'], ['Gwiazdy', '60-graj-gwiazdy']]) {
    await nav('Ustawienia');
    await viewTop('h2', 'Wygląd');
    await page.locator('.fx-tile', { hasText: label }).click();
    await count('.fx-tile.on', 1);
    if (label === 'Zorza') {
      await viewTop('h2', 'Wygląd');
      await shot('58a-wyglad-animowane-tla');
    }
    await nav('Graj');
    await page.waitForTimeout(900);
    await shot(file);
  }
  await nav('Serwery');
  await page.waitForTimeout(400);
  await shot('60b-serwery-gwiazdy-w-tle');
  await small('60c-graj-gwiazdy-male-okno', () => nav('Graj'));
  await nav('Ustawienia');
  await viewTop('h2', 'Wygląd');
  await page.locator('.fx-tile', { hasText: 'Klasyczne' }).click();
  await page.locator('.swatch[title="Pomarańczowy"]').click();
  await count('.swatch.on[title="Pomarańczowy"]', 1);

  // Automatic world backups and the cloud in Ustawienia and Światy.
  await viewTop('h2', 'Kopie światów i chmura');
  await page.locator('.set-row', { hasText: 'Automatyczne kopie światów' }).locator('.switch').click();
  await page.locator('.set-row', { hasText: 'Automatyczne kopie światów' }).locator('select').selectOption('8');
  await page.waitForTimeout(300);
  await viewTop('h2', 'Kopie światów i chmura');
  await shot('61-kopie-chmura-hammerplus');
  await fits('Kopie światów i chmura');
  await small('61b-kopie-chmura-male-okno', async () => {
    await viewTop('h2', 'Kopie światów i chmura');
    await fits('Kopie światów i chmura, małe okno');
  });
  await page.evaluate(() => window.__autoBackups());
  await nav('Światy');
  await page.waitForTimeout(400);
  await viewTop('h2', 'Kopie zapasowe');
  await count('.auto-backup input:checked', 1);
  await shot('62-swiaty-kopie-automatyczne');
  await fits('Światy z Hammer+');
  await small('62b-swiaty-kopie-automatyczne-male-okno', async () => {
    await viewTop('h2', 'Kopie zapasowe');
    await fits('Światy z Hammer+, małe okno');
  });
  // A backup the launcher finished by itself shows up without a click.
  await page.evaluate(() => window.__emit('worlds:backups', { instanceId: 'hammershop' }));
  await page.evaluate(() => window.__emit('toast', { kind: 'ok', text: 'Automatyczna kopia świata „Nasz survival” jest gotowa.' }));
  await top();
  await shot('62c-swiaty-kopia-gotowa');
  await noToasts();

  // Skórka: the bigger library, Zestawy and Peleryny Hammer+.
  await nav('Skórka');
  await page.waitForTimeout(700);
  await count('.outfit-tile .plus-locked', 0);
  await shot('63-skorka-hammerplus');
  await viewTop('h2', 'Zestawy');
  await shot('64-skorka-zestawy');
  await page.locator('button', { hasText: 'Nowy zestaw' }).click();
  await page.locator('.modal input').fill('Na budowanie w nocy');
  await page.locator('.modal select').first().selectOption({ label: 'Alex z lasu' });
  await page.locator('.modal select').last().selectOption({ label: 'Vanilla' });
  await shot('65-nowy-zestaw');
  await small('65b-nowy-zestaw-male-okno');
  await confirm();
  await count('.outfit-tile', 4);
  await noToasts();
  await page.locator('.outfit-tile', { hasText: 'Na PvP' }).locator('.btn.primary').click();
  await page.waitForTimeout(600);
  await count('.outfit-tile.on', 1);
  await viewTop('h2', 'Zestawy');
  await shot('66-zestaw-zalozony');
  await noToasts();
  await page.locator('.outfit-tile button[title="Usuń zestaw"]').last().click();
  await confirm();
  await count('.outfit-tile', 3);
  await bottom();
  await count('.hcape.on', 1);
  await shot('67-peleryny-hammerplus');
  await page.locator('.hcape', { hasText: 'Mróz' }).click();
  await page.waitForTimeout(400);
  await count('.hcape.on', 1);
  await noToasts();
  await bottom();
  await shot('68-peleryna-hammerplus-wybrana');
  await fits('Skórka z Hammer+');
  await small('68b-peleryny-hammerplus-male-okno', async () => {
    await bottom();
    await fits('Skórka z Hammer+, małe okno');
  });
  await small('64b-skorka-zestawy-male-okno', () => viewTop('h2', 'Zestawy'));
  await page.locator('.hcape', { hasText: 'Bez peleryny' }).click();
  await page.waitForTimeout(400);
  await count('.hcape.on', 1);

  // Hammer+ runs out while the launcher is open: the look and the locks follow at once.
  await nav('Graj');
  await page.evaluate(() => window.__plus(false, 'expired'));
  await page.waitForTimeout(400);
  await count('.tb-plus.on', 0);
  await count('.plus-badge', 0);
  await plusPill();
  await count('.plus-hero.on', 0);
  await page.locator('button', { hasText: 'Usuń kod' }).click();
  await shot('69-hammerplus-usun-kod');
  await confirm();
  await page.waitForTimeout(300);
  await count('button:has-text("Usuń kod")', 0);

  /* ── bringing things over and passing them on: the official Minecraft, recipes, invitations, featured servers ── */
  const modalBtn = (text) => page.locator('.modal button', { hasText: text }).last();
  const menuItem = (text) => page.locator('.menu button', { hasText: text });
  const release = () => page.evaluate(() => window.__release?.());
  /** Nothing in the open dialog may stick out of it. */
  const modalFits = async (where) => {
    const bad = await page.evaluate(() => {
      const box = document.querySelector('.overlay:last-child .modal');
      if (!box) return ['nie ma okna'];
      const out = [];
      const b = box.getBoundingClientRect();
      if (b.right > innerWidth - 8 || b.bottom > innerHeight - 8 || b.left < 8 || b.top < 8) out.push('okno nie mieści się w launcherze');
      const body = box.querySelector('.modal-body');
      if (body.scrollWidth > body.clientWidth + 1) out.push(`treść okna jest szersza niż okno o ${body.scrollWidth - body.clientWidth} px`);
      for (const el of box.querySelectorAll('.modal-foot .btn, .modal-body .btn, .modal-body .chip, .modal-body .input')) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > b.right - 4 || r.left < b.left + 4)) out.push(`element wystaje poza okno (${el.textContent.trim().slice(0, 30) || el.className})`);
      }
      return out;
    });
    for (const text of bad) errors.push(`${where}: ${text}`);
  };
  await noToasts();
  await page.evaluate(() => HS.state.selectInstance('hammershop'));

  // Serwery: „Mam zaproszenie”, „Zaproś” on each server, and the card of featured servers under the list.
  await nav('Serwery');
  await page.waitForTimeout(600);
  await count('.feat', 4);
  await shot('70-serwery-zaproszenia');
  await fits('Serwery');
  await viewTop('h2', 'Polecane serwery');
  await shot('71-polecane-serwery');
  await small('70b-serwery-male-okno', async () => {
    await top();
    await fits('Serwery, małe okno');
  });
  await small('71b-polecane-serwery-male-okno', async () => {
    await viewTop('h2', 'Polecane serwery');
    await fits('Polecane serwery, małe okno');
  });
  await viewTop('h2', 'Polecane serwery');
  await count('.feat button:has-text("Na liście")', 1); // Hammer SMP is on this instance's list already
  await page.locator('.feat', { hasText: 'Hammer Skyblock' }).locator('button', { hasText: 'Dodaj' }).click();
  await count('.feat button:has-text("Na liście")', 2);
  await noToasts();
  // „Graj” on a featured server asks the same question as an invitation.
  await page.locator('.feat', { hasText: 'Hammer SMP' }).locator('.btn.primary').click();
  await page.waitForTimeout(400);
  await count('.modal .pick-row', 3); // Hammer, Fabulously Optimized (both Fabric 1.21.1) and "a new instance"
  await shot('72-polecany-graj');
  await closeModal();

  // A clicked hammer://join link: the window comes to the front and asks.
  await page.evaluate(() => window.__emit('invite:link', 'hammer://join?server=mc.kowalscy.pl:25566&name=Serwer%20Kowalskich&mc=1.21.1&loader=fabric'));
  await page.waitForTimeout(500);
  await count('.modal .pick-row input:checked', 1);
  await shot('73-zaproszenie');
  await modalFits('Zaproszenie');
  await small('73b-zaproszenie-male-okno', () => modalFits('Zaproszenie, małe okno'));
  await modalBtn('Dodaj serwer').click();
  await page.waitForTimeout(500);
  await count('.modal button:has-text("Graj")', 1);
  await shot('74-zaproszenie-graj');
  await modalBtn('Zamknij').click();
  await count('.server-row', 7); // the invitation's server is on the list (and the featured one added before)
  // No instance fits and the link asks for a modpack: its name and author first, then the usual modpack install.
  await page.evaluate(() => window.__emit('invite:link', 'https://hammerclient.com/join?server=fo.example.pl:25570&name=Wsp%C3%B3lny%20%C5%9Bwiat&mc=1.20.4&loader=fabric&pack=fabulously-optimized'));
  await page.waitForTimeout(500);
  await count('.modal .pick-row', 1);
  await shot('75-zaproszenie-z-paczka');
  await modalFits('Zaproszenie z paczką');
  await page.evaluate(() => (window.__hold = true));
  await modalBtn('Zainstaluj paczkę').click();
  await page.waitForTimeout(500);
  await shot('76-zaproszenie-instalacja-paczki');
  await release();
  await page.waitForTimeout(500);
  await shot('77-zaproszenie-z-paczka-gotowe');
  await small('77b-zaproszenie-gotowe-male-okno', () => modalFits('Zaproszenie gotowe, małe okno'));
  await modalBtn('Zamknij').click();
  await page.evaluate(() => HS.state.selectInstance('hammershop'));
  await page.waitForTimeout(1700); // the task card in the sidebar goes away by itself
  // „Mam zaproszenie”: something that is not an invitation gets a calm sentence; a real link opens the question.
  await nav('Serwery');
  await page.waitForTimeout(400);
  await page.locator('.page-head button[aria-label="Mam zaproszenie"]').click();
  await page.locator('.modal input').fill('https://discord.gg/hammershop');
  await modalBtn('Dalej').click();
  await page.waitForTimeout(300);
  await count('.modal .warn', 1);
  await shot('78-mam-zaproszenie-zly-link');
  await page.evaluate(() => (window.__clipboard = 'https://hammerclient.com/join?server=sky.hammershop.pl&name=Hammer+Skyblock'));
  await modalBtn('Wklej').click();
  await modalBtn('Dalej').click();
  await page.waitForTimeout(400);
  await count('.modal .invite-head', 1);
  await count('.modal .pick-row', 6); // any instance fits a link that names no game version
  await shot('79-zaproszenie-dowolna-wersja');
  await modalFits('Zaproszenie bez wersji');
  await small('79b-zaproszenie-dowolna-wersja-male-okno', () => modalFits('Zaproszenie bez wersji, małe okno'));
  await closeModal();
  // „Zaproś”: the link for a server of this instance.
  await page.locator('.server-row button[aria-label="Zaproś na: HammerShop"]').click();
  await page.waitForTimeout(300);
  await shot('80-zapros');
  await modalFits('Zaproś');
  if (!/^https:\/\/hammershop\.pl\/join\?/.test(await page.locator('.modal textarea').inputValue())) errors.push('Zaproś: w oknie nie widać linku');
  await modalBtn('Kopiuj link').click();
  await page.waitForTimeout(200);
  const copied = await page.evaluate(() => window.__clipboard);
  if (!/^https:\/\/hammershop\.pl\/join\?server=mc\.hammershop\.pl&name=HammerShop&mc=1\.21\.1&loader=fabric$/.test(copied)) errors.push(`Zaproś: w schowku jest „${copied}”`);
  await closeModal();
  await noToasts();
  // The start screen: the compact strip.
  await nav('Graj');
  await page.waitForTimeout(600);
  await count('.featured-strip .feat', 3);
  await viewTop('h2', 'Polecane serwery');
  await shot('81-graj-polecane');
  await fits('Graj z polecanymi');
  await small('81b-graj-polecane-male-okno', async () => {
    await viewTop('h2', 'Polecane serwery');
    await fits('Graj z polecanymi, małe okno');
  });
  // The shop has no list (or is not reachable): no card anywhere, and nothing complains.
  await page.evaluate(() => (window.__featured = []));
  await nav('Serwery');
  await page.waitForTimeout(500);
  await count('.featured', 0);
  await nav('Graj');
  await page.waitForTimeout(500);
  await count('.featured-strip', 0);
  await page.evaluate(() => (window.__featured = null));
  await count('.toast', 0);

  // Światy → „Z Minecrafta”: the worlds of the official Minecraft, copied into the instance.
  await nav('Światy');
  await page.waitForTimeout(400);
  await shot('82-swiaty-z-minecrafta-przycisk');
  const worldsBefore = await page.locator('.world-row').count();
  await page.locator('.page-head button', { hasText: 'Z Minecrafta' }).click();
  await page.waitForTimeout(400);
  await count('.modal .pick-row', 5);
  await page.locator('.modal .pick-row', { hasText: 'Survival 2024' }).click();
  await page.locator('.modal .pick-row', { hasText: 'Testy nowej wersji' }).click();
  await count('.modal .pick-row input:checked', 2);
  await shot('83-swiaty-z-minecrafta');
  await modalFits('Światy z Minecrafta');
  await small('83b-swiaty-z-minecrafta-male-okno', () => modalFits('Światy z Minecrafta, małe okno'));
  await page.evaluate(() => (window.__hold = true));
  await modalBtn('Skopiuj zaznaczone').click();
  await page.waitForTimeout(400);
  await shot('84-swiaty-kopiowanie');
  await release();
  await page.waitForTimeout(700);
  await count('.modal', 0);
  await count('.world-row', worldsBefore + 2);
  await shot('85-swiaty-skopiowane');
  await noToasts();
  await page.waitForTimeout(1700); // the task card in the sidebar goes away by itself

  // Instancje: „Z kodu lub pliku”, and „Udostępnij” / „Przenieś ustawienia z Minecrafta” in the instance menu.
  await nav('Instancje');
  await page.waitForTimeout(300);
  await shot('86-instancje');
  await fits('Instancje');
  await small('86b-instancje-male-okno', () => fits('Instancje, małe okno'));
  await page.locator('.inst-card', { hasText: 'Hammer' }).first().locator('.more').click();
  await shot('87-instancja-menu');
  await menuItem('Przenieś ustawienia z Minecrafta').click();
  await shot('88-ustawienia-z-minecrafta');
  await modalFits('Ustawienia z Minecrafta');
  await small('88b-ustawienia-z-minecrafta-male-okno', () => modalFits('Ustawienia z Minecrafta, małe okno'));
  await modalBtn('Przenieś ustawienia').click();
  await page.waitForTimeout(400);
  await count('.modal', 0);
  await shot('89-ustawienia-przeniesione');
  await noToasts();
  await page.locator('.inst-card', { hasText: 'Hammer' }).first().locator('.more').click();
  await menuItem('Udostępnij').click();
  await page.waitForTimeout(500);
  await shot('90-udostepnij');
  await modalFits('Udostępnij');
  if (!/^HL1\./.test(await page.locator('.modal textarea').inputValue())) errors.push('Udostępnij: w oknie nie widać kodu');
  await small('90b-udostepnij-male-okno', () => modalFits('Udostępnij, małe okno'));
  await page.locator('.modal .switch').click();
  await page.waitForTimeout(500);
  await count('.modal .chip:has-text("ustawienia gry")', 1);
  await modalBtn('Kopiuj kod').click();
  await modalBtn('Zapisz plik').click();
  await page.waitForTimeout(400);
  if (!/^HL1\./.test(await page.evaluate(() => window.__clipboard))) errors.push('Udostępnij: kod nie trafił do schowka');
  await page.locator('.modal .modal-body').evaluate((el) => (el.scrollTop = el.scrollHeight));
  await shot('91-udostepnij-kod-i-plik');
  await noToasts();
  await closeModal();
  // A big modpack: the code would be too long – only the file is offered, and the window says why.
  await page.locator('.inst-card', { hasText: 'Fabulously Optimized' }).first().locator('.more').click();
  await menuItem('Udostępnij').click();
  await page.waitForTimeout(500);
  await count('.modal button:has-text("Kopiuj kod"):visible', 0);
  await count('.modal .btn.primary:has-text("Zapisz plik")', 1);
  await count('.modal .cloud-note', 1);
  await shot('92-udostepnij-tylko-plik');
  await closeModal();
  // Import: a wrong code, then a real one → the preview → the install with its progress → what is missing.
  await page.locator('.page-head button', { hasText: 'Z kodu lub pliku' }).click();
  await shot('93-z-kodu-lub-pliku');
  await modalFits('Z kodu lub pliku');
  await page.locator('.modal textarea').fill('moj-kod-od-kolegi');
  await modalBtn('Dalej').click();
  await page.waitForTimeout(300);
  await shot('94-z-kodu-zly-kod');
  await noToasts();
  await modalBtn('Wklej').click();
  await modalBtn('Dalej').click();
  await page.waitForTimeout(400);
  await count('.modal .recipe-name', 1);
  await shot('95-przepis-podglad');
  await modalFits('Podgląd przepisu');
  await small('95b-przepis-podglad-male-okno', () => modalFits('Podgląd przepisu, małe okno'));
  const instancesBefore = await page.locator('.inst-card:not(.new-card)').count();
  await page.evaluate(() => (window.__hold = true));
  await modalBtn('Utwórz instancję').click();
  await page.waitForTimeout(500);
  await shot('96-przepis-instalacja');
  await release();
  await page.waitForTimeout(700);
  await count('.inst-card:not(.new-card)', instancesBefore + 1);
  await count('.modal .share-out .installed-row', 2);
  await shot('97-przepis-czego-brakuje');
  await modalFits('Przepis – czego brakuje');
  await modalBtn('Zamknij').click();
  await page.waitForTimeout(1700); // the task card in the sidebar goes away by itself
  // A .hammerpack file dropped on the window opens the same preview (here with a note about the loader version).
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.items.add(new File(['{}'], 'Skyblock od Oli.hammerpack'));
    document.getElementById('view').dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(400);
  await count('.modal .recipe-name', 1);
  await count('.modal .cloud-note', 1);
  await shot('98-przepis-z-upuszczonego-pliku');
  await page.evaluate(() => (window.__allFound = true));
  await modalBtn('Utwórz instancję').click();
  await page.waitForTimeout(700);
  await count('.modal', 0);
  await noToasts();
  await page.waitForTimeout(1700); // the task card in the sidebar goes away by itself
  // A new instance: one quiet offer to bring the settings of the official Minecraft over.
  await page.locator('.page-head .btn.primary').click();
  await page.locator('.modal input').first().fill('Budowanie');
  await page.waitForTimeout(300);
  await confirm();
  await page.waitForTimeout(600);
  await count('.toast button', 1);
  await shot('99-nowa-instancja-propozycja-ustawien');
  await page.locator('.toast button').click();
  await count('.modal .why-item', 2);
  await closeModal();
  await page.waitForTimeout(1700);

  /* ── Test FPS, „Podsumowanie gry”, mod updates with a way back, a screenshot as a link ── */
  await noToasts();
  await page.evaluate(() => HS.state.selectInstance('hammershop'));
  const cardTop = (selector) =>
    page.locator(selector).first().evaluate((el) => {
      const view = document.getElementById('view');
      view.style.scrollBehavior = 'auto';
      view.scrollTop = el.offsetTop - 16;
      view.style.scrollBehavior = '';
    });

  // Optymalizacja → Test FPS: the form, the last result next to the one before, the history.
  await nav('Optymalizacja');
  await page.waitForTimeout(500);
  await count('.bench', 1);
  await count('.bench-stat', 4);
  // the broken world is not offered (how many worlds there are depends on the earlier "Z Minecrafta" steps)
  await count('.bench .bench-form select', 1);
  await count('.bench .bench-form select option:has-text("Stary swiat")', 0);
  await cardTop('.bench');
  await shot('100-test-fps');
  await fits('Test FPS');
  await page.locator('.bench-history summary').click();
  await cardTop('.bench-result');
  await shot('101-test-fps-historia');
  await small('100b-test-fps-male-okno', async () => {
    await cardTop('.bench');
    await fits('Test FPS, małe okno');
  });
  await small('101b-test-fps-historia-male-okno', () => cardTop('.bench-result'));
  // „Uruchom test”: the game starts as a test – the card and the start screen say that it closes by itself.
  await page.locator('.bench .seg button', { hasText: '30 s' }).click();
  await page.locator('.bench button', { hasText: 'Uruchom test' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__emit('game:state', { instanceId: 'hammershop', state: 'running', benchmark: true }));
  await count('.bench-run', 1);
  await count('.bench button:has-text("Uruchom test")', 0);
  await cardTop('.bench');
  await shot('102-test-fps-trwa');
  await nav('Graj');
  await page.waitForTimeout(300);
  if (!(await page.locator('.play-progress').innerText()).includes(T('Trwa test FPS – gra zamknie się sama'))) errors.push('Graj: nie widać, że trwa test FPS');
  await shot('103-graj-test-fps');
  // The game closed with a result: a message with „Zobacz wynik”, then the new result next to the previous one.
  await noToasts();
  await page.evaluate(() => window.__benchDone(true));
  await page.waitForTimeout(300);
  await count('.toast button', 1);
  await shot('104-test-fps-koniec');
  await page.locator('.toast button').click();
  await page.waitForTimeout(600);
  await count('.bench-run', 0);
  await count('.bench .chip.ok', 1);
  if (!(await page.locator('.bench .chip.ok').innerText()).includes(T('+38% średnio'))) errors.push('Test FPS: nie widać różnicy „+38% średnio”');
  await noToasts();
  await shot('105-test-fps-wynik');
  await fits('Test FPS – wynik');
  await small('105b-test-fps-wynik-male-okno', async () => {
    await cardTop('.bench');
    await fits('Test FPS – wynik, małe okno');
  });
  // A test that left no result: „Test nie został ukończony” with the likely reasons; the last good result stays.
  await page.locator('.bench button', { hasText: 'Uruchom test' }).click();
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__emit('game:state', { instanceId: 'hammershop', state: 'running', benchmark: true }));
  await page.locator('.bench-run button', { hasText: 'Przerwij' }).click();
  await page.waitForTimeout(500);
  await count('.bench-fail', 1);
  await count('.bench-fail li', 2);
  await noToasts();
  await cardTop('.bench');
  await shot('106-test-fps-nieukonczony');
  await small('106b-test-fps-nieukonczony-male-okno', () => cardTop('.bench'));
  await page.locator('.bench-fail button[title="Ukryj"]').click();
  await count('.bench-fail', 0);
  // Instances the test cannot run in get one line; one without a world is told to make one first.
  await page.evaluate(() => HS.state.selectInstance('survival'));
  await page.waitForTimeout(500);
  await count('.bench .cloud-note', 1);
  await count('.bench-form', 0);
  await cardTop('.bench');
  await shot('107-test-fps-forge');
  await page.evaluate(() => HS.state.selectInstance('fo'));
  await page.waitForTimeout(500);
  await count('.bench .cloud-note', 1);
  await count('.bench button:has-text("Uruchom test")', 0);
  await cardTop('.bench');
  await shot('108-test-fps-bez-swiata');
  await page.evaluate(() => HS.state.selectInstance('hammershop'));

  // „Podsumowanie gry” on the start screen after a session: how long, the total, the screenshots, a pointer to the FPS test.
  await nav('Graj');
  await page.evaluate(() => window.__session(3, true));
  await page.waitForTimeout(400);
  await count('.summary-card', 1);
  await count('.sum-shot', 3);
  await count('.sum-hint', 1);
  await shot('110-podsumowanie-gry');
  await fits('Podsumowanie gry');
  await small('110b-podsumowanie-gry-male-okno', () => fits('Podsumowanie gry, małe okno'));
  await page.locator('.sum-shot').first().click(); // a thumbnail opens the gallery of that instance
  await page.waitForTimeout(400);
  await count('.shot', 3);
  if ((await page.locator('.page-head select').inputValue()) !== 'hammershop') errors.push('Podsumowanie gry: Galeria nie pokazuje zrzutów tej instancji');
  await shot('111-podsumowanie-galeria');
  await nav('Graj');
  await count('.summary-card', 1); // still there after a look elsewhere
  await page.locator('.sum-hint button').click(); // the gentle link leads to the FPS test
  await page.waitForTimeout(500);
  await count('.bench', 1);
  await nav('Graj');
  await page.locator('.summary-card button[title="Zamknij"]').click();
  await count('.summary-card', 0);
  // Many screenshots and no pointer (the FPS test was run already).
  await page.evaluate(() => window.__session(12, false));
  await page.waitForTimeout(300);
  await count('.sum-shot', 6);
  await count('.sum-hint', 0);
  await shot('112-podsumowanie-duzo-zrzutow');
  await small('112b-podsumowanie-duzo-zrzutow-male-okno', () => fits('Podsumowanie gry (dużo zrzutów), małe okno'));
  // The switch in Ustawienia → Gra.
  await nav('Ustawienia');
  await viewTop('h2', 'Gra');
  await shot('113-ustawienia-podsumowanie');
  await page.locator('.set-row', { hasText: 'Podsumowanie po grze' }).locator('.switch').click();
  await nav('Graj');
  await count('.summary-card', 0);
  await nav('Ustawienia');
  await page.locator('.set-row', { hasText: 'Podsumowanie po grze' }).locator('.switch').click();
  await nav('Graj');
  await count('.summary-card', 1);
  await page.locator('.summary-card button[title="Zamknij"]').click();

  // Mod updates found in the background: one card on the start screen, a badge on the instance, the list.
  await page.evaluate(() => window.__updates(true));
  await page.waitForTimeout(300);
  await count('.update-line', 1);
  if (!(await page.locator('.update-line').innerText()).includes(T('Aktualizacje modów: 3 w „Hammer”'))) errors.push('Graj: zła treść karty aktualizacji');
  await shot('120-graj-aktualizacje-modow');
  await fits('Graj z aktualizacjami');
  await small('120b-graj-aktualizacje-modow-male-okno', () => fits('Graj z aktualizacjami, małe okno'));
  await nav('Instancje');
  await count('.update-badge', 1);
  await shot('121-instancje-znaczek-aktualizacji');
  await small('121b-instancje-znaczek-male-okno', () => fits('Instancje ze znaczkiem, małe okno'));
  await page.locator('.update-badge').click(); // → Mody → Zainstalowane, with what the check found
  await page.waitForTimeout(500);
  await count('.installed-row button.chip.accent', 2);
  await count('button:has-text("Aktualizuj wszystko (3)")', 1);
  await count('button:has-text("Cofnij ostatnią aktualizację"):visible', 0);
  await shot('122-mody-aktualizacje');
  // One update: a restore point appears, and with it „Cofnij ostatnią aktualizację”.
  await page.locator('.installed-row', { hasText: 'Sodium' }).locator('button.chip.accent').click();
  await page.waitForTimeout(800);
  await count('.installed-row button.chip.accent', 1);
  await count('button:has-text("Cofnij ostatnią aktualizację"):visible', 1);
  await shot('123-mody-po-aktualizacji');
  await noToasts();
  await small('123b-mody-po-aktualizacji-male-okno', () => fits('Mody po aktualizacji, małe okno'));
  await page.locator('button', { hasText: 'Aktualizuj wszystko (2)' }).click();
  await page.waitForTimeout(800);
  await count('.installed-row button.chip.accent', 0);
  await count('button:has-text("Aktualizuj wszystko"):visible', 0);
  await noToasts();
  await nav('Graj');
  await count('.update-line', 0); // nothing left to update
  await nav('Mody');
  await page.locator('.seg button', { hasText: 'Zainstalowane' }).click();
  await page.waitForTimeout(400);
  // The way back: what exactly is reversed, then the old versions are there again.
  await page.locator('button', { hasText: 'Cofnij ostatnią aktualizację' }).click();
  await page.waitForTimeout(300);
  await count('.modal .installed-row', 2);
  await shot('124-cofnij-aktualizacje');
  await modalFits('Cofnij aktualizację');
  await small('124b-cofnij-aktualizacje-male-okno', () => modalFits('Cofnij aktualizację, małe okno'));
  await modalBtn('Cofnij aktualizację').click();
  await page.waitForTimeout(700);
  await count('.modal', 0);
  if (!(await page.locator('.installed-row', { hasText: "Xaero's Minimap" }).innerText()).includes('25.0.0')) errors.push('Cofnij: stara wersja nie wróciła na listę');
  await shot('125-mody-po-cofnieciu');
  await noToasts();
  // An update that was cut off half-way: the list says so, and the same button puts things back.
  await page.evaluate(() => window.__interrupted());
  await nav('Graj');
  await nav('Mody');
  await page.locator('.seg button', { hasText: 'Zainstalowane' }).click();
  await page.waitForTimeout(400);
  await count('.page .cloud-note', 1);
  await shot('126-mody-przerwana-aktualizacja');
  await page.locator('button', { hasText: 'Cofnij ostatnią aktualizację' }).click();
  await page.waitForTimeout(300);
  await count('.modal .cloud-note', 1);
  await shot('127-cofnij-przerwana-aktualizacja');
  await modalBtn('Cofnij aktualizację').click();
  await page.waitForTimeout(700);
  await count('.page .cloud-note', 0);
  await noToasts();
  // Several instances have updates: still one card, with a way into each.
  await page.evaluate(() => window.__updates(true, true));
  await nav('Graj');
  await page.waitForTimeout(300);
  await count('.update-line', 1);
  await count('.update-line .chip', 2);
  await shot('128-graj-aktualizacje-kilka-instancji');
  await fits('Graj – aktualizacje w kilku instancjach');
  await small('128b-graj-aktualizacje-kilka-instancji-male-okno', () => fits('Graj – aktualizacje w kilku instancjach, małe okno'));
  await page.locator('.update-line .chip', { hasText: 'Survival z ekipą' }).click();
  await page.waitForTimeout(500);
  await count('button:has-text("Aktualizuj wszystko (2)")', 1);
  await page.evaluate(() => HS.state.selectInstance('hammershop'));
  // The switch in Ustawienia → Pobieranie i pliki: off – the card and the badges go.
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await viewTop('h2', 'Pobieranie i pliki');
  await count('.set-row:has-text("Pytaj przed udostępnieniem zrzutu ekranu")', 1);
  await shot('129-ustawienia-pobieranie-i-pliki');
  await fits('Ustawienia – pobieranie i pliki');
  await small('129b-ustawienia-pobieranie-i-pliki-male-okno', async () => {
    await viewTop('h2', 'Pobieranie i pliki');
    await fits('Ustawienia – pobieranie i pliki, małe okno');
  });
  await page.locator('.set-row', { hasText: 'Sprawdzaj aktualizacje modów w tle' }).locator('.switch').click();
  await nav('Graj');
  await count('.update-line', 0);
  await nav('Instancje');
  await count('.update-badge', 0);
  await nav('Ustawienia');
  await page.locator('.set-row', { hasText: 'Sprawdzaj aktualizacje modów w tle' }).locator('.switch').click();

  // Galeria → a screenshot → „Udostępnij link”: the question first, then the link (on the clipboard).
  await nav('Galeria');
  await page.waitForTimeout(400);
  await page.locator('.shot').first().click();
  await count('.lightbox button:has-text("Udostępnij link")', 1);
  await shot('130-galeria-udostepnij-link');
  await small('130b-galeria-udostepnij-link-male-okno');
  await page.locator('.lightbox button', { hasText: 'Udostępnij link' }).click();
  await page.waitForTimeout(300);
  await count('.modal .why-item', 4);
  await shot('131-udostepnij-link-zgoda');
  await modalFits('Udostępnij link – zgoda');
  await small('131b-udostepnij-link-zgoda-male-okno', () => modalFits('Udostępnij link – zgoda, małe okno'));
  // „Anuluj”: nothing is sent, the viewer stays open (Escape closes the dialog, not the picture).
  await page.keyboard.press('Escape');
  await count('.modal', 0);
  await count('.lightbox', 1);
  if (await page.evaluate(() => window.__clipboard === 'https://litter.catbox.moe/k3x9wq.png')) errors.push('Udostępnij link: link w schowku mimo anulowania');
  await page.locator('.lightbox button', { hasText: 'Udostępnij link' }).click();
  await page.locator('.modal label.check').click(); // „Nie pytaj ponownie”
  await page.evaluate(() => (window.__hold = true));
  await modalBtn('Wyślij i skopiuj link').click();
  await page.waitForTimeout(300);
  await shot('132-udostepnij-link-wysylanie');
  await release();
  await page.waitForTimeout(500);
  await count('.modal input[readonly]', 1);
  if ((await page.evaluate(() => window.__clipboard)) !== 'https://litter.catbox.moe/k3x9wq.png') errors.push('Udostępnij link: linku nie ma w schowku');
  await shot('133-udostepnij-link-gotowe');
  await modalFits('Udostępnij link – gotowe');
  await small('133b-udostepnij-link-gotowe-male-okno', () => modalFits('Udostępnij link – gotowe, małe okno'));
  await modalBtn('Gotowe').click();
  await noToasts();
  // „Nie pytaj ponownie” was ticked: the next one goes straight to the link.
  await page.keyboard.press('ArrowRight');
  await page.locator('.lightbox button', { hasText: 'Udostępnij link' }).click();
  await page.waitForTimeout(600);
  await count('.modal .why-item', 0);
  await count('.modal input[readonly]', 1);
  await modalBtn('Gotowe').click();
  await noToasts();
  // The host does not answer: a calm message, nothing on the clipboard changes.
  await page.evaluate(() => ((window.__shareFails = true), (window.__clipboard = 'coś innego')));
  await page.locator('.lightbox button', { hasText: 'Udostępnij link' }).click();
  await page.waitForTimeout(600);
  await count('.modal', 0);
  await count('.toast.err', 1);
  if ((await page.evaluate(() => window.__clipboard)) !== 'coś innego') errors.push('Udostępnij link: schowek zmieniony mimo błędu');
  await shot('134-udostepnij-link-blad');
  await noToasts();
  await page.evaluate(() => (window.__shareFails = false));
  // The delete question of the viewer is on top of the picture as well.
  await page.locator('.lightbox button', { hasText: 'Usuń' }).click();
  await page.waitForTimeout(300);
  await modalFits('Usuń zrzut');
  const onTop = await page.evaluate(() => {
    const box = document.querySelector('.modal').getBoundingClientRect();
    return Boolean(document.elementFromPoint(box.left + box.width / 2, box.top + 30)?.closest('.modal'));
  });
  if (!onTop) errors.push('Galeria: okno z pytaniem jest pod podglądem zrzutu');
  await shot('135-galeria-pytanie-nad-podgladem');
  await page.keyboard.press('Escape');
  await count('.lightbox', 1);
  await page.keyboard.press('Escape');
  await count('.lightbox', 0);
  // Ustawienia: the question can be switched back on.
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await count('.set-row:has-text("Pytaj przed udostępnieniem zrzutu ekranu") input:checked', 0);
  await page.locator('.set-row', { hasText: 'Pytaj przed udostępnieniem zrzutu ekranu' }).locator('.switch').click();
  await nav('Galeria');
  await page.waitForTimeout(400);
  await page.locator('.shot').first().click();
  await page.locator('.lightbox button', { hasText: 'Udostępnij link' }).click();
  await count('.modal .why-item', 4);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // No host in launcher.config.json: the button is not there at all (and neither is the switch in Ustawienia).
  await page.evaluate(() => (window.__noShare = true));
  await nav('Graj');
  await nav('Galeria');
  await page.waitForTimeout(400);
  await page.locator('.shot').first().click();
  await count('.lightbox button:has-text("Udostępnij link")', 0);
  await shot('136-galeria-bez-udostepniania');
  await page.keyboard.press('Escape');
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await count('.set-row:has-text("Pytaj przed udostępnieniem zrzutu ekranu")', 0);
  await page.evaluate(() => (window.__noShare = false));

  /* ── „BETA”, the shop's news and message bar, the launcher's own updates, „Kup Hammer+” ── */
  await noToasts();
  // (as at the start of the launcher: two news items came since the start screen was last seen)
  await nav('Instancje');
  await page.evaluate(() => window.hs.settings.set({ newsSeenAt: Date.now() - 30 * 3600e3 }).then((saved) => (HS.state.settings = saved)));
  await nav('Graj');
  await page.waitForTimeout(300);
  // „BETA” right after the name: title bar, start screen, sidebar – and in the window's title.
  await count('.tb-brand .beta-pill', 1);
  await count('.hero .eyebrow .beta-pill', 1);
  await count('.version-tag .beta-pill', 1);
  if ((await page.title()) !== 'Hammer Launcher (beta)') errors.push(`BETA: tytuł okna to „${await page.title()}”`);
  const nameBox = await page.locator('.tb-brand span').first().boundingBox();
  const pillBox = await page.locator('.tb-brand .beta-pill').boundingBox();
  if (!(pillBox.x >= nameBox.x + nameBox.width && pillBox.x - (nameBox.x + nameBox.width) < 16)) errors.push('BETA: znaczek nie stoi tuż za nazwą na pasku tytułu');
  // Aktualności from the shop: a pinned item, tags, dates, the „nowe” mark on what came since the last visit.
  await count('.news-item', 4);
  await count('.news-item.pinned .news-pin', 1);
  await count('.news-item .news-new', 2);
  await count('.news-item.clickable', 2);
  await count('.news-item .news-img', 1);
  await viewTop('h2', 'Aktualności');
  await shot('150-aktualnosci-ze-sklepu');
  await fits('Aktualności ze sklepu');
  await small('150b-aktualnosci-ze-sklepu-male-okno', async () => {
    await viewTop('h2', 'Aktualności');
    await fits('Aktualności ze sklepu, małe okno');
  });
  // Seen: the mark stays during this visit and is gone the next time the start screen is opened.
  if (!(await page.evaluate(() => HS.state.settings.newsSeenAt > Date.now() - 3 * 3600e3))) errors.push('Aktualności: launcher nie zapamiętał, co zostało pokazane');
  await page.evaluate(() => HS.go('home'));
  await count('.news-item .news-new', 2);
  await nav('Instancje');
  await nav('Graj');
  await page.waitForTimeout(200);
  await count('.news-item .news-new', 0);
  // The shop is away (or has no news): the built-in tips, like before.
  await page.evaluate(() => window.__feed({ news: 'tips' }));
  await count('.news-item', 3);
  await count('.news-item .news-pin', 0);
  await viewTop('h2', 'Aktualności');
  await shot('151-aktualnosci-wbudowane');
  await page.evaluate(() => window.__feed({ news: 'shop' }));
  await count('.news-item', 4);

  // The message bar: on every screen, under the title bar.
  await top();
  await page.evaluate(() => window.__feed({ alert: { id: 'a_17', level: 'info', text: 'W ten weekend na serwerze Hammer SMP podwójne nagrody za zadania.', url: 'https://hammershop.pl/aktualnosci/weekend', until: Date.now() + 3 * 3600e3 } }));
  await count('.alert-bar.info:visible', 1);
  await count('.alert-bar button:has-text("Więcej")', 1);
  await shot('152-komunikat-informacja');
  await fits('Komunikat – informacja');
  await nav('Mody');
  await page.waitForTimeout(300);
  await count('.alert-bar.info:visible', 1);
  // Closing it: gone on every screen, and it stays closed while the shop keeps sending the same message.
  await page.locator('.alert-bar button[title="Zamknij komunikat"]').click();
  await count('.alert-bar:visible', 0);
  if ((await page.evaluate(() => window.hs.settings.get().then((x) => x.closedAlert))) !== 'a_17') errors.push('Komunikat: zamknięty komunikat nie został zapamiętany');
  await page.evaluate(() => window.__feed({}));
  await count('.alert-bar:visible', 0);
  // Another message (a new id) shows again – amber for a warning, two lines at most in the smallest window.
  await page.evaluate(() => window.__feed({ alert: { id: 'a_18', level: 'warning', text: 'Dziś między 22:00 a 23:30 przerwa techniczna sklepu HammerShop: w tym czasie nie zadziała chmura Hammer+, polecane serwery ani aktualności. Granie działa normalnie – niczego nie musisz robić, po przerwie wszystko wróci samo.', url: null, until: null } }));
  await count('.alert-bar.warning:visible', 1);
  await count('.alert-bar button:has-text("Więcej")', 0);
  await shot('153-komunikat-ostrzezenie');
  await small('153b-komunikat-ostrzezenie-male-okno', async () => {
    await fits('Komunikat – ostrzeżenie, małe okno');
    const tall = await page.locator('.alert-bar').evaluate((el) => el.offsetHeight);
    if (tall > 60) errors.push(`Komunikat: pasek ma ${tall} px wysokości w małym oknie`);
    const overflowNow = await page.locator('.sidebar').evaluate((el) => el.scrollHeight - el.clientHeight);
    if (overflowNow > 0) errors.push(`Pasek boczny nie mieści się w najmniejszym oknie z komunikatem (o ${overflowNow} px).`);
  });
  // A critical one is red and cannot be closed.
  await page.evaluate(() => window.__feed({ alert: { id: 'a_19', level: 'critical', text: 'Logowanie Microsoft ma awarię – uruchamianie gry może teraz nie działać. To nie jest wina launchera.', url: 'https://hammershop.pl/status', until: null } }));
  await count('.alert-bar.critical:visible', 1);
  await count('.alert-bar button[title="Zamknij komunikat"]', 0);
  await nav('Graj');
  await shot('154-komunikat-krytyczny');
  // Past its time a message goes by itself.
  await page.evaluate(() => window.__feed({ alert: { id: 'a_20', level: 'info', text: 'Za chwilę zniknę.', url: null, until: Date.now() + 700 } }));
  await count('.alert-bar:visible', 1);
  await page.waitForTimeout(1600);
  await count('.alert-bar:visible', 0);
  await page.evaluate(() => window.__feed({ alert: null }));

  // The launcher's own update on the start screen. Automatic updates off: it only tells, with „Pobierz i zainstaluj”.
  const NOTES = 'Aktualności i komunikaty prosto ze sklepu.\nLauncher aktualizuje się sam – także w tle, gdy grasz.\nPoprawki w zakładce Skórka i szybsze sprawdzanie modów.';
  await top();
  await count('.update-card', 0);
  await page.evaluate(() => window.hs.settings.set({ autoUpdate: false }));
  await page.evaluate((notes) => window.__self({ status: 'available', latest: '2.6.1', upToDate: false, notes }), NOTES);
  await count('.update-card', 1);
  await count('.update-card button:has-text("Pobierz i zainstaluj")', 1);
  await shot('155-aktualizacja-dostepna');
  await fits('Aktualizacja dostępna');
  await page.locator('.update-card button', { hasText: 'Pobierz i zainstaluj' }).click();
  await page.evaluate(() => window.__self({ percent: 42 }));
  await count('.update-card .progress', 1);
  if (!(await page.locator('.update-card').innerText()).includes('42%')) errors.push('Aktualizacja: nie widać postępu pobierania');
  await shot('156-aktualizacja-pobieranie');
  await page.evaluate(() => window.__self({ status: 'ready', percent: null }));
  await count('.update-card button:has-text("Zaktualizuj teraz"):not([disabled])', 1);
  if (!(await page.locator('.update-card').innerText()).includes(T('Nowa wersja 2.6.1 jest gotowa'))) errors.push('Aktualizacja: nie widać „Nowa wersja 2.6.1 jest gotowa”');
  await shot('157-aktualizacja-gotowa');
  await fits('Aktualizacja gotowa');
  await small('157b-aktualizacja-gotowa-male-okno', () => fits('Aktualizacja gotowa, małe okno'));
  // A game runs: no restart – the button is grey and the card says why.
  await page.evaluate(() => {
    HS.state.running.set('hammershop', 'running');
    HS.bus.emit('game');
    window.__self({ gameRunning: true });
  });
  await count('.update-card button:has-text("Zaktualizuj teraz")[disabled]', 1);
  if (!(await page.locator('.update-card').innerText()).includes(T('Zainstaluje się, gdy skończysz grać – gra nigdy nie zostanie przerwana.'))) errors.push('Aktualizacja: nie widać, że gra nie zostanie przerwana');
  await shot('158-aktualizacja-gotowa-gra-dziala');
  await page.evaluate(() => {
    HS.state.running.clear();
    HS.bus.emit('game');
    window.__self({ gameRunning: false });
  });
  await page.locator('.update-card button', { hasText: 'Zaktualizuj teraz' }).click();
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => window.__installed)) !== 1) errors.push('Aktualizacja: „Zaktualizuj teraz” nie uruchomiło instalacji');

  // Right after an update: „Co nowego” in a window in the middle of the Graj screen – once, until it is closed.
  await page.evaluate((notes) => ((window.__whatsNew = { version: '2.6.1', from: '2.6.0', notes }), (HS.state.whatsNewAsked = false)), NOTES);
  await nav('Instancje');
  await nav('Graj');
  await count('.modal .whats-new-top', 1);
  if (!(await page.locator('.modal').innerText()).includes(T('Launcher zaktualizował się z wersji 2.6.0.'))) errors.push('Co nowego: nie widać, z jakiej wersji launcher się zaktualizował');
  await shot('173-co-nowego');
  await small('173b-co-nowego-male-okno');
  await page.locator('.modal button', { hasText: 'Super, gramy!' }).click();
  await count('.modal .whats-new-top', 0);
  if ((await page.evaluate(() => window.__seen)) !== 1) errors.push('Co nowego: po zamknięciu okno nie zapamiętało, że je widziano');
  await nav('Instancje');
  await nav('Graj');
  await count('.modal .whats-new-top', 0);

  // Ustawienia → Aktualizacje launchera: the version, the state, „Sprawdź teraz” and the switch.
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await viewTop('h2', 'Aktualizacje launchera');
  await count('.set-row:has-text("Aktualizuj automatycznie") input:checked', 0);
  await count('.card:has-text("Aktualizacje launchera") button:has-text("Uruchom ponownie i zaktualizuj")', 1);
  await count('.set-row:has-text("Uruchamiaj razem z Windows") input:checked', 1);
  await count('.set-row:has-text("Zamknięcie okna zostawia launcher w tle") input:checked', 1);
  await shot('159-ustawienia-aktualizacja-gotowa');
  await fits('Ustawienia – aktualizacja gotowa');
  await page.evaluate(() => window.__self({ status: 'idle', latest: null, notes: null, upToDate: true }));
  await page.locator('.set-row', { hasText: 'Aktualizuj automatycznie' }).locator('.switch').click();
  await count('.set-row:has-text("Aktualizuj automatycznie") input:checked', 1);
  const updateState = () => page.locator('.update-state').innerText();
  if (!(await updateState()).includes(T('Masz najnowszą wersję'))) errors.push('Ustawienia: nie widać „Masz najnowszą wersję”');
  await viewTop('h2', 'Aktualizacje launchera');
  await shot('160-ustawienia-aktualizacje');
  await small('160b-ustawienia-aktualizacje-male-okno', async () => {
    await viewTop('h2', 'Aktualizacje launchera');
    await fits('Ustawienia – aktualizacje, małe okno');
  });
  // „Sprawdź teraz”: „Sprawdzam…”, then the answer – here a new version that starts downloading at once.
  await page.evaluate((notes) => ((window.__hold = true), (window.__selfNext = { status: 'downloading', latest: '2.6.1', percent: 42, upToDate: false, notes })), NOTES);
  await page.locator('button', { hasText: 'Sprawdź teraz' }).click();
  await page.waitForTimeout(200);
  if (!(await updateState()).includes(T('Sprawdzam…'))) errors.push('Ustawienia: nie widać „Sprawdzam…”');
  await count('button:has-text("Sprawdź teraz")[disabled]', 1);
  await shot('161-ustawienia-aktualizacje-sprawdzam');
  await release();
  await page.waitForTimeout(400);
  if (!(await updateState()).includes(T('Pobieram 42%'))) errors.push('Ustawienia: nie widać „Pobieram 42%”');
  await count('.card:has-text("Aktualizacje launchera") .progress', 1);
  await shot('162-ustawienia-aktualizacje-pobieram');
  // An update without the owner's signature is refused – in calm words.
  await page.evaluate(() => window.__self({ status: 'error', percent: null, latest: '2.6.1', notes: null, error: 'Aktualizacja 2.6.1 nie ma podpisu HammerShop, więc launcher jej nie zainstaluje. Jeśli to się powtarza, daj nam znać na Discordzie.' }));
  await count('.update-state.warn', 1);
  await shot('163-ustawienia-aktualizacje-brak-podpisu');
  await fits('Ustawienia – aktualizacja bez podpisu');
  await page.evaluate(() => window.__self({ status: 'error', error: 'Nie udało się sprawdzić aktualizacji launchera. Spróbuję ponownie później.' }));
  await count('.update-state.warn', 1);
  await page.evaluate(() => (window.__selfNext = null));

  // A build that cannot replace itself (the portable exe): it only tells – the button opens the download page.
  const RELEASE = { version: '2.6.1', notes: NOTES, url: 'https://hammerclient.com', size: 257000000, date: Date.now() - 3600e3 };
  await page.evaluate((release) => window.__self({ status: 'unsupported', supported: false, reason: 'portable', error: null, latest: null, notes: release.notes, release }), RELEASE);
  await count('.set-row:has-text("Aktualizuj automatycznie")', 0);
  await count('.card:has-text("Aktualizacje launchera") button:has-text("Pobierz ze strony")', 1);
  await viewTop('h2', 'Aktualizacje launchera');
  await shot('164-ustawienia-aktualizacje-wersja-przenosna');
  await fits('Ustawienia – wersja przenośna');
  await nav('Graj');
  await page.waitForTimeout(300);
  await count('.update-card button:has-text("Pobierz ze strony")', 1);
  await shot('165-nowa-wersja-wersja-przenosna');
  await fits('Nowa wersja – wersja przenośna');
  await page.evaluate(() => window.__self({ release: null, notes: null }));
  await count('.update-card', 0);
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  if (!(await updateState()).includes(T('Wersja przenośna nie aktualizuje się sama – nową pobierzesz ze strony.'))) errors.push('Ustawienia: nie widać, dlaczego wersja przenośna się nie aktualizuje');
  await page.evaluate(() => window.__self({ reason: 'dev' }));
  await page.waitForTimeout(200);
  if (!(await updateState()).includes(T('Wersja deweloperska nie aktualizuje się sama.'))) errors.push('Ustawienia: nie widać, że wersja deweloperska się nie aktualizuje');

  // „O launcherze”: the BETA mark after the name and the line with the way to Discord.
  await bottom();
  await count('.card:has-text("O launcherze") h3 .beta-pill', 1);
  await count('.beta-note button:has-text("Dołącz do Discorda")', 1);
  await shot('166-o-launcherze-beta');
  await fits('O launcherze – beta');
  await small('166b-o-launcherze-beta-male-okno', async () => {
    await bottom();
    await fits('O launcherze – beta, małe okno');
  });

  // „Wymagana aktualizacja”: nothing else can be done – but the window can still be minimised or closed.
  await nav('Graj');
  await page.evaluate((notes) => window.__self({ status: 'available', supported: true, reason: null, latest: '2.6.1', notes, upToDate: false, required: { version: '2.6.1', minVersion: '2.6.1' }, release: { version: '2.6.1', notes, url: 'https://hammerclient.com', size: 257000000, date: Date.now() } }), NOTES);
  await count('.overlay.must .modal', 1);
  await count('.update-card', 0);
  await shot('167-wymagana-aktualizacja');
  await modalFits('Wymagana aktualizacja');
  await page.keyboard.press('Escape');
  await page.mouse.click(60, 400);
  await count('.overlay.must .modal', 1); // neither Escape nor a click next to it closes it
  const behind = await page.evaluate(() => ({ shell: document.querySelector('.shell').inert, play: Boolean(document.elementFromPoint(900, 420)?.closest('.overlay.must')), bar: Boolean(document.elementFromPoint(1217, 19)?.closest('.tb-close')) }));
  if (!behind.shell || !behind.play) errors.push('Wymagana aktualizacja: da się kliknąć w launcher pod oknem');
  if (!behind.bar) errors.push('Wymagana aktualizacja: okno zasłania przyciski paska tytułu');
  await page.locator('.overlay.must button', { hasText: 'Zaktualizuj teraz' }).click();
  await page.evaluate(() => window.__self({ percent: 64 }));
  await count('.overlay.must .progress', 1);
  await count('.overlay.must button:has-text("Zaktualizuj teraz")[disabled]', 1);
  await shot('168-wymagana-aktualizacja-pobieranie');
  await small('168b-wymagana-aktualizacja-male-okno', () => modalFits('Wymagana aktualizacja, małe okno'));
  // A game is still running: the update waits, and the window says why.
  await page.evaluate(() => window.__self({ status: 'ready', percent: null, gameRunning: true }));
  await count('.overlay.must button:has-text("Zaktualizuj teraz")[disabled]', 1);
  await shot('169-wymagana-aktualizacja-gra-dziala');
  await page.evaluate(() => window.__self({ gameRunning: false }));
  await page.locator('.overlay.must button', { hasText: 'Zaktualizuj teraz' }).click();
  await page.waitForTimeout(200);
  if ((await page.evaluate(() => window.__installed)) !== 2) errors.push('Wymagana aktualizacja: „Zaktualizuj teraz” nie uruchomiło instalacji');
  // The launcher's own update failed: the download page is the way out.
  await page.evaluate(() => window.__self({ status: 'error', error: 'Nie udało się pobrać aktualizacji launchera. Spróbuję ponownie później.' }));
  await count('.overlay.must button:has-text("Pobierz ze strony")', 1);
  await shot('170-wymagana-aktualizacja-blad');
  await modalFits('Wymagana aktualizacja – błąd');
  // On a build that cannot replace itself the button opens the download page.
  await page.evaluate(() => window.__self({ status: 'unsupported', supported: false, reason: 'portable', error: null, latest: null }));
  await count('.overlay.must button:has-text("Pobierz nową wersję")', 1);
  await count('.overlay.must button:has-text("Zaktualizuj teraz")', 0);
  await shot('171-wymagana-aktualizacja-wersja-przenosna');
  await modalFits('Wymagana aktualizacja – wersja przenośna');
  // The shop stops answering (or the launcher is new enough): nothing is blocked any more.
  await page.evaluate(() => window.__self({ status: 'idle', supported: true, reason: null, required: null, release: null, latest: null, notes: null, upToDate: true }));
  await count('.overlay.must', 0);
  if (await page.evaluate(() => document.querySelector('.shell').inert)) errors.push('Wymagana aktualizacja: launcher został zablokowany po zamknięciu okna');

  // Hammer+: „Kup Hammer+” next to „Mam kod” – it leads to the launcher's page of the website.
  await page.evaluate(() => window.__plus(false));
  await plusPill();
  await count('.plus-acts button:has-text("Kup Hammer+")', 1);
  await count('.plus-acts button:has-text("Mam kod")', 1);
  await page.evaluate(() => (window.__opened = []) && (window.hs.app.openExternal = async (url) => (window.__opened.push(url), true)));
  await page.locator('.plus-acts button', { hasText: 'Kup Hammer+' }).click();
  if ((await page.evaluate(() => window.__opened.join())) !== 'https://hammerclient.com/launcher#plus') errors.push(`Hammer+: „Kup Hammer+” otwiera ${await page.evaluate(() => window.__opened.join())}`);
  await shot('172-hammerplus-kup');
  await fits('Hammer+ – Kup Hammer+');
  await small('172b-hammerplus-kup-male-okno', () => fits('Hammer+ – Kup Hammer+, małe okno'));

  /* ── Ustawienia → Język / Language: the other language applies at once; back again, every text is as it was ── */
  await nav('Ustawienia');
  await page.waitForTimeout(300);
  await viewTop('h2', 'Wygląd');
  await shot('140-ustawienia-jezyk');
  await fits('Ustawienia – język');
  await small('140b-ustawienia-jezyk-male-okno', async () => {
    await viewTop('h2', 'Wygląd');
    await fits('Ustawienia – język, małe okno');
  });
  const other = LANG === 'en' ? 'pl' : 'en';
  const languageSelect = () => page.locator('.set-row select:has(option[value="auto"])');
  const everyText = () => page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('[title],[aria-label],[placeholder]')].map((el) => `${el.getAttribute('title') ?? ''}|${el.getAttribute('aria-label') ?? ''}|${el.getAttribute('placeholder') ?? ''}`)].join('\n'));
  await count('html[lang="' + LANG + '"]', 1);
  const textBefore = await everyText();
  await language.pause(page, true);
  await languageSelect().selectOption(other);
  await page.waitForTimeout(700);
  await count('html[lang="' + other + '"]', 1);
  const textOther = await everyText();
  if (textOther === textBefore) errors.push('Język: po zmianie języka strona wygląda tak samo');
  if (!textOther.includes(other === 'en' ? 'Settings' : 'Ustawienia')) errors.push('Język: strona nie przeszła na wybrany język');
  await top();
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(OUT, '141-jezyk-zmieniony.png') });
  console.log('✓ 141-jezyk-zmieniony');
  await languageSelect().selectOption('auto');
  await page.waitForTimeout(700);
  await language.pause(page, false);
  await count('html[lang="' + LANG + '"]', 1);
  if ((await everyText()) !== textBefore) errors.push('Język: po powrocie do pierwszego języka teksty na stronie nie są takie jak przedtem');

  await language.finish(page, errors);
  await browser.close();
  if (errors.length) {
    console.error('Błędy w konsoli strony:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(err);
  await whenStepFails?.().catch(() => {});
  process.exit(1);
});
