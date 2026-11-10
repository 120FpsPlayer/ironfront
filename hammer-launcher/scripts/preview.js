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

  // A small Minecraft-like skin (64×64) drawn on a canvas.
  function skin() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const px = (x, y, col) => ((g.fillStyle = col), g.fillRect(x, y, 1, 1));
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) px(x, y, (x + y) % 3 ? '#c98b5e' : '#bd7f53');
    for (let x = 8; x < 16; x++) px(x, 8, '#4a2c17'), px(x, 9, '#4a2c17');
    px(8, 10, '#4a2c17'), px(15, 10, '#4a2c17');
    px(9, 12, '#fff'), px(10, 12, '#3a6fd8'), px(13, 12, '#3a6fd8'), px(14, 12, '#fff');
    px(11, 14, '#8a4c33'), px(12, 14, '#8a4c33');
    for (let x = 40; x < 48; x++) px(x, 8, '#ff9f43'), px(x, 9, '#ff8a2b');
    return c.toDataURL();
  }

  const now = Date.now();
  const settings = { memoryMb: null, jvmPreset: 'recommended', customJvmArgs: '', javaPath: '', afterLaunch: 'hide', processPriority: 'above_normal', resolution: { width: 1280, height: 720, fullscreen: false }, showSnapshots: false, discordRpc: true, gpuPreference: true, concurrentDownloads: 16, selectedInstance: 'hammershop', selectedAccount: 'acc1', closeOnExit: false };
  const instances = [
    { id: 'hammershop', name: 'Hammer', mcVersion: '1.21.4', loader: 'fabric', icon: 'hammer', optimized: true, memoryMb: null, playTimeMs: 46 * 3600e3 + 25 * 60e3, lastPlayed: now - 3 * 3600e3, createdAt: now - 40 * 864e5 },
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

  window.hs = {
    on(ch, fn) {
      if (!listeners.has(ch)) listeners.set(ch, new Set());
      listeners.get(ch).add(fn);
      return () => listeners.get(ch).delete(fn);
    },
    pathForFile: () => null,
    app: { info: async () => ({ version: '1.0.0', platform: 'win32', config: { name: 'Hammer Launcher', brand: 'HammerShop', website: 'https://hammershop.pl', shopUrl: 'https://hammershop.pl', discordInvite: '', server: { name: '', address: '' } }, root: 'C:\\Users\\Gracz\\AppData\\Roaming\\.hammershop', secureStorage: true }), openExternal: async () => true, openFolder: async () => '' },
    window: { minimize: async () => {}, maximize: async () => {}, close: async () => {} },
    settings: { get: async () => ({ ...settings }), set: async (p) => Object.assign(settings, p) && { ...settings } },
    system: { info: async () => ({}) },
    news: { list: async () => [
      { title: 'Witaj w Hammer Launcherze!', body: 'Zaloguj się kontem Microsoft, wybierz instancję i kliknij GRAJ. Launcher sam pobierze grę, Javę i mody.', tag: 'Start' },
      { title: 'Jedno kliknięcie – więcej FPS', body: 'Zakładka Optymalizacja dobiera RAM, flagi Javy i mody wydajnościowe (Sodium, Lithium, FerriteCore…) pod Twoją wersję gry.', tag: 'Wydajność' },
      { title: 'Tysiące modów w zakładce Mody', body: 'Szukaj modów, paczek tekstur, shaderów i całych paczek modów z Modrinth – zależności instalują się same.', tag: 'Mody' },
    ] },
    server: { ping: async () => (await wait(), { online: true, latency: 23, version: '1.21.4', players: { online: 137, max: 500 } }) },
    accounts: { list: async () => accounts.map((a) => ({ ...a, skinUrl: a.skinUrl ?? skin() })), login: async () => accounts[0], remove: async () => true, select: async () => true },
    versions: {
      minecraft: async () => ['1.21.4', '1.21.3', '1.21.1', '1.21', '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.18.2', '1.16.5', '1.12.2', '1.8.9'].map((id) => ({ id, type: 'release' })),
      loaders: async (l) => (l === 'vanilla' ? [] : [{ version: '0.16.10', stable: true }, { version: '0.16.9', stable: true }, { version: '0.16.8', stable: true }]),
    },
    instances: { list: async () => instances.map((i) => ({ ...i })), ensureDefault: async () => null, create: async (d) => ({ id: 'x', ...d }), update: async (id, p) => Object.assign(instances.find((i) => i.id === id), p), remove: async () => true, duplicate: async () => ({}), select: async () => true },
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
      info: async () => ({ system: { platform: 'win32', totalMem: 16 * GB, freeMem: 7.4 * GB, cpuModel: 'AMD Ryzen 5 5600X 6-Core Processor', cpuCores: 12, gpu: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)' }, modCount: 14, recommendation: { memoryMb: 4096, jvmPreset: 'recommended', optionsPreset: 'balanced' } }),
      plan: async () => (await wait(), { supported: true, mods: [
        { slug: 'sodium', name: 'Sodium', why: 'Nowy silnik renderowania – zwykle 2–3× więcej FPS.', available: true, installed: true, version: { number: '0.6.5' } },
        { slug: 'lithium', name: 'Lithium', why: 'Szybsza logika gry: moby, fizyka, redstone.', available: true, installed: true, version: { number: '0.14.3' } },
        { slug: 'ferrite-core', name: 'FerriteCore', why: 'Gra zużywa nawet o połowę mniej pamięci RAM.', available: true, installed: true, version: { number: '7.1.1' } },
        { slug: 'modernfix', name: 'ModernFix', why: 'Szybsze uruchamianie gry i mniej zużytej pamięci.', available: true, installed: false, version: { number: '5.20.2' } },
        { slug: 'entityculling', name: 'Entity Culling', why: 'Nie rysuje mobów i skrzyń, których nie widać.', available: true, installed: false, version: { number: '1.7.3' } },
        { slug: 'immediatelyfast', name: 'ImmediatelyFast', why: 'Szybsze rysowanie interfejsu, tekstu i map.', available: true, installed: false, version: { number: '1.3.4' } },
        { slug: 'dynamic-fps', name: 'Dynamic FPS', why: 'Zmniejsza FPS, gdy gra jest w tle – mniej grzania i prądu.', available: true, installed: false, version: { number: '3.8.0' } },
        { slug: 'krypton', name: 'Krypton', why: 'Szybszy kod sieciowy – mniejsze lagi na serwerach.', available: false, installed: false, version: null },
      ] }),
      apply: async () => ({ installed: [], skipped: [], warnings: [], missing: [] }),
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

  await nav('Optymalizacja');
  await page.waitForTimeout(300);
  await shot('08-optymalizacja');
  await page.locator('.view').evaluate((v) => (v.scrollTop = v.scrollHeight));
  await shot('09-optymalizacja-dol');

  await page.evaluate(() => HS.state.crashes.set('hammershop', { title: 'Zabrakło pamięci RAM dla gry', hints: ['Zwiększ pamięć w zakładce Optymalizacja (np. do 6 GB).', 'Zamknij przeglądarkę i inne programy, które zużywają dużo pamięci.'], details: 'java.lang.OutOfMemoryError: Java heap space' }));
  await nav('Konsola');
  await page.waitForTimeout(300);
  await shot('10-konsola');

  await nav('Galeria');
  await page.waitForTimeout(300);
  await shot('12-galeria');
  await page.locator('.shot').first().click();
  await shot('13-galeria-podglad');
  await page.keyboard.press('Escape');

  await nav('Ustawienia');
  await shot('11-ustawienia');

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
