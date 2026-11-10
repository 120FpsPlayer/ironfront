'use strict';

/**
 * Renders the launcher interface in Chromium with a fake window.hs (no Electron, no network) and saves a
 * screenshot of every screen. Usage: node scripts/preview.js [outDir] [scale]
 * Needs Playwright with Chromium (npx playwright install chromium) – used for development only.
 */

const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const OUT = path.resolve(process.argv[2] ?? 'preview');
const SCALE = Number(process.argv[3] ?? 1);
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
  const settings = { memoryMb: null, jvmPreset: 'recommended', customJvmArgs: '', javaPath: '', afterLaunch: 'hide', processPriority: 'above_normal', resolution: { width: 1280, height: 720, fullscreen: false }, showSnapshots: false, discordRpc: true, gpuPreference: true, concurrentDownloads: 16, selectedInstance: 'hammershop', selectedAccount: 'acc1', closeOnExit: false, accent: 'orange' };
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
    { file: 'Nasz survival-2026-11-09_21-14.zip', size: 688e6, createdAt: now - 20 * 3600e3, world: 'Nasz survival' },
    { file: '2026-10-28_18-02-51_New World.zip', size: 121e6, createdAt: now - 13 * 864e5, world: 'New World' },
  ];

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
  const skinState = () => {
    const worn = skinLib.find((x) => x.id === wardrobe.worn);
    return { account: { id: 'acc1', name: 'HammerGracz' }, skin: worn ? { url: `https://textures.minecraft.net/texture/${worn.id}`, variant: worn.variant, dataUrl: worn.dataUrl, libraryId: worn.id } : null, capes: wardrobe.capes.map((c) => ({ ...c })), library: skinLib.map((x) => ({ ...x, active: x.id === wardrobe.worn })) };
  };

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

  window.hs = {
    on(ch, fn) {
      if (!listeners.has(ch)) listeners.set(ch, new Set());
      listeners.get(ch).add(fn);
      return () => listeners.get(ch).delete(fn);
    },
    pathForFile: () => null,
    app: { info: async () => ({ version: '1.0.0', platform: 'win32', config: { name: 'Hammer Launcher', brand: 'HammerShop', website: 'https://hammershop.pl', shopUrl: 'https://hammershop.pl', discordInvite: '', server: { name: '', address: '' } }, root: 'C:\\Users\\Gracz\\AppData\\Roaming\\.hammer-launcher', secureStorage: true, hammerClient: { versions: ['1.21', '1.21.1', '1.21.2', '1.21.3', '1.21.4', '1.21.5', '1.21.6', '1.21.7', '1.21.8', '1.21.9', '1.21.10', '1.21.11', '26.1', '26.1.1', '26.1.2', '26.2', '26.3'], version: '2.0.0', available: true } }), openExternal: async () => true, openFolder: async () => '' },
    window: { minimize: async () => {}, maximize: async () => {}, close: async () => {} },
    settings: { get: async () => ({ ...settings }), set: async (p) => Object.assign(settings, p) && { ...settings } },
    system: { info: async () => ({}) },
    news: { list: async () => [
      { title: 'Witaj w Hammer Launcherze!', body: 'Zaloguj się kontem Microsoft, wybierz instancję i kliknij GRAJ. Launcher sam pobierze grę, Javę i mody.', tag: 'Start' },
      { title: 'Jedno kliknięcie – więcej FPS', body: 'Zakładka Optymalizacja dobiera RAM, flagi Javy i mody wydajnościowe (Sodium, Lithium, FerriteCore…) pod Twoją wersję gry.', tag: 'Wydajność' },
      { title: 'Tysiące modów w zakładce Mody', body: 'Szukaj modów, paczek tekstur, shaderów i całych paczek modów z Modrinth – zależności instalują się same.', tag: 'Mody' },
    ] },
    server: { ping: async (address) => (address === 'nowy.example.pl' ? new Promise(() => {}) : (await wait(), PINGS[address] ?? { online: true, latency: 23, version: '1.21.4', players: { online: 137, max: 500 } })) },
    accounts: { list: async () => (window.__noAccount ? [] : accounts.map((a) => ({ ...a, skinUrl: skinLib.find((x) => x.id === wardrobe.worn)?.dataUrl ?? null }))), login: async () => accounts[0], remove: async () => true, select: async () => true },
    versions: {
      minecraft: async () => ['26.3', '26.2', '26.1.2', '26.1.1', '26.1', '1.21.11', '1.21.10', '1.21.8', '1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'].map((id) => ({ id, type: 'release' })),
      loaders: async (l) => (l === 'vanilla' ? [] : [{ version: '0.16.10', stable: true }, { version: '0.16.9', stable: true }, { version: '0.16.8', stable: true }]),
    },
    instances: { list: async () => instances.map((i) => ({ ...i })), ensureDefault: async () => null, create: async (d) => ({ id: 'x', ...d }), update: async (id, p) => Object.assign(instances.find((i) => i.id === id), p), remove: async () => true, duplicate: async () => ({}), repair: async () => ({}), select: async () => true },
    game: { launch: async () => new Promise(() => {}), stop: async () => true, logs: async () => LOG.map((line) => ({ line })), running: async () => [] },
    content: {
      list: async (id, type) => (type === 'mod' ? installed.map((x) => ({ ...x })) : []),
      identify: async () => 0,
      toggle: async () => true,
      remove: async () => true,
      updates: async () => [{ file: installed[3].file, title: "Xaero's Minimap", current: '25.0.0', latest: { id: 'v', versionNumber: '25.1.0' } }],
      update: async () => [],
      install: async () => ({ installed: ['x'], skipped: [], warnings: [] }),
      import: async () => [],
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
      list: async () => [
        ['#7cc8ff', '#2f7a3f', 'Zachód słońca', 'hammershop'], ['#ffb36b', '#4a2b14', 'Nether', 'survival'], ['#9be7ff', '#e7f7ff', 'Góry', 'hammershop'], ['#b18cff', '#1c1036', 'End', 'fo'],
        ['#ffd36b', '#2f7a3f', 'Wioska', 'survival'], ['#7cc8ff', '#1d4ed8', 'Ocean', 'hammershop'], ['#ff8f8f', '#3b1010', 'Baza', 'survival'], ['#c3f07c', '#225c2a', 'Las', 'fo'],
      ].map(([c1, c2, label, inst], i) => ({ instanceId: inst, instanceName: instances.find((x) => x.id === inst).name, file: `2026-11-0${(i % 9) + 1}_18.2${i}.11.png`, url: scene(c1, c2, label), size: 2.1e6, takenAt: now - i * 7.3 * 3600e3 })),
      remove: async () => true, copy: async () => true, show: async () => true,
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
    skins: {
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

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1240, height: 780 }, deviceScaleFactor: SCALE });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(mock);
  await page.goto(PAGE);
  await page.waitForTimeout(400);

  const shot = async (name) => {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
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
  const viewTop = (selector, text) => page.locator(selector, { hasText: text }).first().evaluate((el) => (document.getElementById('view').scrollTop = (el.closest('.card') ?? el).offsetTop - 16));
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

  await browser.close();
  if (errors.length) {
    console.error('Błędy w konsoli strony:\n' + errors.join('\n'));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
