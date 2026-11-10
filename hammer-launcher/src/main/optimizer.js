'use strict';

/**
 * Optimisation: one click makes an instance run noticeably better.
 *   1. Performance mods from Modrinth that exist for the instance's game version and loader, in two tiers:
 *      "Podstawowe" (safe, installed by default: Sodium, Lithium, FerriteCore, …) and "Turbo" (optional extras for
 *      strong processors: C2ME, ScalableLux, …) – with their required dependencies. Nothing here changes the rules
 *      of the game or gives an advantage over other players.
 *   2. RAM and JVM flags picked for the computer and the Java version (see jvm.js).
 *   3. Graphics presets written to options.txt (Słaby komputer / Maks. FPS / Zrównoważony / Jakość).
 *   4. Windows laptops: Java is told to use the faster graphics card (Windows "Graphics settings").
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { pickVersion, loadersFor } = require('./modrinth');
const { recommendMemory, zgcSupported } = require('./jvm');

const GB = 1024 ** 3;

/**
 * The catalogue – slugs on Modrinth (each one checked against the real API). Availability is looked up per game
 * version + loader, so one list serves Fabric, Quilt, Forge and NeoForge from 1.16 to 26.x.
 *   tier       core = "Podstawowe", turbo = "Turbo", shaders = only with "z shaderami"
 *   insteadOf  a port or successor: offered only when none of the listed mods exists for the instance
 *   legacy     made for older game versions only – not listed at all where it does not exist
 */
const PERFORMANCE_MODS = [
  { slug: 'sodium', name: 'Sodium', why: 'Nowy silnik renderowania – zwykle 2–3× więcej FPS.', tier: 'core' },
  { slug: 'embeddium', name: 'Embeddium', why: 'Sodium dla Forge – szybsze renderowanie.', tier: 'core', insteadOf: ['sodium'] },
  { slug: 'lithium', name: 'Lithium', why: 'Szybsza logika gry: moby, fizyka, redstone.', tier: 'core' },
  { slug: 'radium', name: 'Radium', why: 'Lithium dla Forge – szybsza logika gry.', tier: 'core', insteadOf: ['lithium'] },
  { slug: 'canary', name: 'Canary', why: 'Odpowiednik Lithium dla starszych wersji Forge.', tier: 'core', insteadOf: ['lithium', 'radium'] },
  { slug: 'ferrite-core', name: 'FerriteCore', why: 'Gra zużywa nawet o połowę mniej pamięci RAM.', tier: 'core' },
  { slug: 'modernfix', name: 'ModernFix', why: 'Szybsze uruchamianie i mniej zużytej pamięci.', tier: 'core' },
  { slug: 'modernfix-mvus', name: 'ModernFix (mVUS)', why: 'ModernFix dla najnowszych wersji gry – szybszy start, mniej pamięci.', tier: 'core', insteadOf: ['modernfix'] },
  { slug: 'entityculling', name: 'Entity Culling', why: 'Nie rysuje mobów i skrzyń, których nie widać.', tier: 'core' },
  { slug: 'immediatelyfast', name: 'ImmediatelyFast', why: 'Szybsze rysowanie tekstu, map i interfejsu.', tier: 'core' },
  { slug: 'moreculling', name: 'More Culling', why: 'Pomija niewidoczne ściany bloków i liście.', tier: 'core' },
  { slug: 'dynamic-fps', name: 'Dynamic FPS', why: 'Mniej FPS w tle – laptop się nie grzeje, gdy grasz w innym oknie.', tier: 'core' },
  { slug: 'krypton', name: 'Krypton', why: 'Lżejsza obsługa sieci na serwerach.', tier: 'core' },
  { slug: 'badoptimizations', name: 'BadOptimizations', why: 'Drobne optymalizacje oświetlenia i nieba.', tier: 'core' },
  { slug: 'noisium', name: 'Noisium', why: 'Szybsze generowanie nowych chunków w singleplayerze.', tier: 'core', legacy: true },
  { slug: 'starlight', name: 'Starlight', why: 'Nowy silnik światła dla Minecrafta 1.17–1.20 – szybsze ładowanie chunków.', tier: 'core', legacy: true },
  { slug: 'starlight-forge', name: 'Starlight', why: 'Nowy silnik światła dla Forge – szybsze ładowanie chunków.', tier: 'core', insteadOf: ['starlight'] },
  { slug: 'memoryleakfix', name: 'Memory Leak Fix', why: 'Naprawia wycieki pamięci w starszych wersjach gry.', tier: 'core', legacy: true },
  { slug: 'lazydfu', name: 'LazyDFU', why: 'Starsze wersje gry uruchamiają się dużo szybciej.', tier: 'core', legacy: true },

  { slug: 'c2me-fabric', name: 'C2ME', why: 'Generuje i wczytuje chunki na wielu rdzeniach procesora naraz.', tier: 'turbo' },
  { slug: 'c2me-neoforge', name: 'C2ME', why: 'Generuje i wczytuje chunki na wielu rdzeniach procesora naraz.', tier: 'turbo', insteadOf: ['c2me-fabric'] },
  { slug: 'scalablelux', name: 'ScalableLux', why: 'Szybszy silnik światła – płynniejsze ładowanie nowych terenów.', tier: 'turbo' },
  { slug: 'threadtweak', name: 'ThreadTweak', why: 'Lepiej dzieli pracę gry między rdzenie procesora.', tier: 'turbo' },
  { slug: 'ksyxis', name: 'Ksyxis', why: 'Świat otwiera się szybciej – gra nie czeka na chunki wokół spawnu.', tier: 'turbo' },
  { slug: 'fast-ip-ping', name: 'Fast IP Ping', why: 'Szybsze łączenie z serwerami podanymi jako adres IP.', tier: 'turbo' },

  { slug: 'iris', name: 'Iris Shaders', why: 'Shadery na Sodium – ładniejsza grafika, gdy masz mocny komputer.', tier: 'shaders' },
  { slug: 'oculus', name: 'Oculus', why: 'Iris dla Forge – shadery razem z Embeddium.', tier: 'shaders', insteadOf: ['iris'] },
];

const TIERS = { core: 'Podstawowe', turbo: 'Turbo', shaders: 'Shadery' };

/**
 * Graphics presets. The game has two generations of video settings: up to 1.21.10 one "graphicsMode" (0 fast,
 * 1 fancy), from 1.21.11 a "graphicsPreset" with separate switches (leaves, weather, vignette…). A preset writes
 * both – every game version reads its own keys and ignores the rest. The new keys follow Mojang's own Fast and
 * Fancy presets, so an options.txt upgraded by the game ends up with the same values.
 */
const FAST = { graphicsMode: '0', graphicsPreset: '"custom"', cutoutLeaves: 'false', improvedTransparency: 'false', weatherRadius: '5', vignette: 'false' };
const FANCY = { graphicsMode: '1', graphicsPreset: '"custom"', cutoutLeaves: 'true', improvedTransparency: 'false', weatherRadius: '10', vignette: 'true' };

const OPTION_PRESETS = {
  low: {
    label: 'Słaby komputer',
    values: { ...FAST, renderDistance: '6', simulationDistance: '5', maxFps: '120', enableVsync: 'false', entityShadows: 'false', particles: '2', biomeBlendRadius: '0', ao: 'false', renderClouds: '"false"', mipmapLevels: '0', entityDistanceScaling: '0.5', menuBackgroundBlurriness: '0' },
  },
  fps: {
    label: 'Maks. FPS',
    values: { ...FAST, renderDistance: '8', simulationDistance: '6', maxFps: '260', enableVsync: 'false', entityShadows: 'false', particles: '2', biomeBlendRadius: '0', ao: 'false', renderClouds: '"false"', mipmapLevels: '2', entityDistanceScaling: '0.75' },
  },
  balanced: {
    label: 'Zrównoważony',
    values: { ...FANCY, renderDistance: '12', simulationDistance: '8', maxFps: '144', enableVsync: 'false', entityShadows: 'true', particles: '1', biomeBlendRadius: '2', ao: 'true', renderClouds: '"fast"', mipmapLevels: '4', entityDistanceScaling: '1.0' },
  },
  quality: {
    label: 'Jakość',
    values: { ...FANCY, renderDistance: '16', simulationDistance: '10', maxFps: '260', enableVsync: 'true', entityShadows: 'true', particles: '0', biomeBlendRadius: '5', ao: 'true', renderClouds: '"true"', mipmapLevels: '4', entityDistanceScaling: '1.0' },
  },
};

/** options.txt with some keys changed – every other line (key bindings, sounds…) stays as it was. */
function mergeOptions(text, values) {
  const lines = String(text ?? '').split(/\r?\n/).filter((l) => l.length);
  const seen = new Set();
  const out = lines.map((line) => {
    const i = line.indexOf(':');
    const key = i > 0 ? line.slice(0, i) : null;
    if (key && key in values) {
      seen.add(key);
      return `${key}:${values[key]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) if (!seen.has(k)) out.push(`${k}:${v}`);
  return `${out.join('\n')}\n`;
}

function writeOptionsPreset(instanceDir, preset) {
  const p = OPTION_PRESETS[preset];
  if (!p) throw new Error('Nieznany preset grafiki.');
  const file = path.join(instanceDir, 'options.txt');
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : 'lang:pl_pl\n';
  fs.writeFileSync(file, mergeOptions(current, p.values));
  return file;
}

/** Windows: run Java on the high-performance GPU (the same switch as Settings → System → Display → Graphics). */
function setGpuPreference(javaPath, { platform = process.platform, run = execFile } = {}) {
  if (platform !== 'win32' || !javaPath) return Promise.resolve(false);
  return new Promise((resolve) => {
    run('reg', ['add', 'HKCU\\Software\\Microsoft\\DirectX\\UserGpuPreferences', '/v', javaPath, '/t', 'REG_SZ', '/d', 'GpuPreference=2;', '/f'], { windowsHide: true }, (err) => resolve(!err));
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const n = i++;
        out[n] = await fn(items[n], n);
      }
    }),
  );
  return out;
}

/**
 * Looks a list of catalogue entries up on Modrinth for one instance:
 * [{ ...entry, available, installed, version: { id, projectId, number } | null, error? }].
 * `type` of an entry (mod by default; shader, resourcepack) decides which loaders are asked for.
 * Throws only when not a single lookup worked (no connection) – one mod failing never hides the rest.
 */
async function resolveMods({ modrinth, content, instance, items }) {
  const have = content.installedProjects(instance);
  let lastError = null;
  const found = await mapLimit(items, 4, async (m) => {
    const loaders = loadersFor(m.type ?? 'mod', instance.loader);
    try {
      const version = pickVersion(await modrinth.versions(m.slug, { loaders, gameVersions: [instance.mcVersion] }), { mcVersion: instance.mcVersion, loaders });
      return { ...m, available: Boolean(version), version: version ? { id: version.id, projectId: version.project_id, number: version.version_number } : null, installed: Boolean(version && have.has(version.project_id)) };
    } catch (err) {
      lastError = err;
      return { ...m, available: false, version: null, installed: false, error: true };
    }
  });
  if (found.length && found.every((m) => m.error)) throw lastError;
  return found;
}

/**
 * Drops what should not be shown: a port (`insteadOf`) while one of the mods it stands in for exists, a mod whose
 * port is used instead, and ports / legacy mods that do not exist for this instance at all.
 */
function visibleMods(found) {
  const available = new Set(found.filter((m) => m.available).map((m) => m.slug));
  const replaced = new Set(found.filter((m) => m.available && m.insteadOf && !m.insteadOf.some((s) => available.has(s))).flatMap((m) => m.insteadOf));
  return found.filter((m) => {
    if (m.insteadOf?.some((s) => available.has(s))) return false;
    if (!m.available) return !(m.insteadOf || m.legacy || replaced.has(m.slug));
    return true;
  });
}

/** Installs the available entries of a plan; returns { installed, skipped, warnings, missing }. */
async function installPlanned({ content, instance, mods, onProgress }) {
  const result = { installed: [], skipped: [], warnings: [], missing: [] };
  const todo = mods.filter((m) => m.available && !m.installed);
  let n = 0;
  for (const m of todo) {
    onProgress?.({ label: `Instalacja: ${m.name}`, done: n, total: todo.length });
    try {
      const r = await content.install(instance, { projectId: m.version.projectId, versionId: m.version.id, type: m.type ?? 'mod' });
      result.installed.push(...r.installed);
      result.skipped.push(...r.skipped);
      result.warnings.push(...r.warnings);
    } catch (err) {
      result.warnings.push(`${m.name}: ${err.message}`);
    }
    n += 1;
    onProgress?.({ label: `Instalacja: ${m.name}`, done: n, total: todo.length });
  }
  result.missing = mods.filter((m) => !m.available).map((m) => m.name);
  return result;
}

function createOptimizer({ modrinth, content }) {
  /**
   * What optimisation would do for an instance: { supported, mods: [{ slug, name, why, tier, available, installed,
   * version }] }. "Podstawowe" always; `turbo` adds the extras, `shaders` adds Iris (Oculus on Forge).
   */
  async function plan(instance, { turbo = false, shaders = false } = {}) {
    if (instance.loader === 'vanilla') return { supported: false, mods: [] };
    const wanted = PERFORMANCE_MODS.filter((m) => m.tier === 'core' || (turbo && m.tier === 'turbo') || (shaders && m.tier === 'shaders'));
    return { supported: true, mods: visibleMods(await resolveMods({ modrinth, content, instance, items: wanted })) };
  }

  /** Installs the available mods of a plan; returns { installed, skipped, warnings, missing }. */
  const installMods = (instance, planned, { onProgress } = {}) => installPlanned({ content, instance, mods: planned.mods, onProgress });

  return { plan, installMods };
}

/**
 * What kind of graphics card this is, from its name(s): 'software' (no real GPU), 'integrated', 'dedicated',
 * 'highend' or 'unknown'. With several cards (laptops) the best one counts – the game runs on it.
 */
function classifyGpu(names) {
  const rank = ['unknown', 'software', 'integrated', 'dedicated', 'highend'];
  const one = (name) => {
    const s = String(name ?? '').toLowerCase().replace(/\((r|tm)\)/g, '');
    if (!s.trim()) return 'unknown';
    if (/swiftshader|llvmpipe|softpipe|basic render|software rasterizer/.test(s)) return 'software';
    if (/rtx\s*a?[2-9]\d{3}|gtx\s*1[06][78]0|rx\s*(5[67]\d\d|[679]\d{3})|\barc\b.*\b[ab][57]\d{2}\b|apple m\d.*(pro|max|ultra)/.test(s)) return 'highend';
    if (/geforce|nvidia|quadro|radeon\s*(rx|pro|r[579]|hd)|\barc\b|apple m\d/.test(s)) return 'dedicated';
    if (/intel|radeon|\bamd\b|mali|adreno|powervr|vega|iris|uhd|hd graphics/.test(s)) return 'integrated';
    return 'unknown';
  };
  return [names].flat().map(one).sort((a, b) => rank.indexOf(b) - rank.indexOf(a))[0] ?? 'unknown';
}

const gbText = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0).replace('.', ',')} GB` : `${mb} MB`);

/**
 * Advice for the Optimisation tab, from the computer and the instance:
 * { memoryMb, jvmPreset, optionsPreset, turbo, gpuClass, reasons: [{ key, title, text }] } – `reasons` is what the
 * "Dlaczego?" window shows, in plain words. `turbo` = the computer is strong enough for the Turbo mods.
 */
function recommend({ totalMem, cpuCores = 4, javaMajor = 21, gpu = null }, instance, modCount = 0) {
  const memoryMb = recommendMemory(totalMem, { modCount, loader: instance.loader });
  const ram = totalMem / GB;
  const ramText = `${Math.round(ram)} GB`;
  const gpuClass = classifyGpu(gpu);
  const modded = instance.loader !== 'vanilla';
  // A "16 GB" computer reports a little less than 16 GB – hence 15.
  const zgc = zgcSupported(javaMajor) && ram >= 15 && cpuCores >= 6 && modCount >= 100;

  let optionsPreset = 'balanced';
  let optionsWhy = 'Twój komputer spokojnie uciągnie ładną grafikę przy wysokim FPS.';
  if (ram <= 4.5 || cpuCores <= 2 || gpuClass === 'software') {
    optionsPreset = 'low';
    optionsWhy = gpuClass === 'software' ? 'Nie widzę karty graficznej (gra rysuje na samym procesorze) – wybrałem najlżejsze ustawienia.' : ram <= 4.5 ? `Masz ${ramText} pamięci – najlżejsze ustawienia zostawią grze zapas.` : 'Procesor ma mało rdzeni – najlżejsze ustawienia dadzą płynną grę.';
  } else if (ram <= 8.5 || cpuCores <= 4 || gpuClass === 'integrated') {
    optionsPreset = 'fps';
    optionsWhy = gpuClass === 'integrated' ? 'Masz zintegrowaną kartę graficzną – szybka grafika i krótszy zasięg widzenia dadzą dużo więcej FPS.' : ram <= 8.5 ? `Przy ${ramText} pamięci lepiej postawić na płynność niż na efekty.` : 'Przy 4 wątkach procesora lepiej postawić na płynność niż na efekty.';
  } else if (gpuClass === 'highend' && ram >= 15 && cpuCores >= 8) {
    optionsPreset = 'quality';
    optionsWhy = 'Mocna karta graficzna, dużo pamięci i rdzeni – możesz grać z pełnymi efektami i dalekim widokiem.';
  }

  // The Turbo mods spread chunk work over many cores – on a weak processor they would only get in the way.
  // They stay the player's choice (some are test builds): `turbo` only says whether the computer is up to them.
  const turbo = modded && cpuCores >= 6 && ram >= 7.5;

  const reasons = [
    {
      key: 'memory',
      title: `Pamięć: ${gbText(memoryMb)}`,
      text: `Masz ${ramText} pamięci${modded ? ` i ${modCount} ${modCount === 1 ? 'mod' : 'modów'} w instancji` : ''}. Gra dostanie ${gbText(memoryMb)} – nigdy więcej niż połowę, bo system, Discord i przeglądarka też jej potrzebują, a zbyt duża pamięć spowalnia Javę.`,
    },
    {
      key: 'jvm',
      title: zgc ? 'Flagi Javy: ZGC' : 'Flagi Javy: zalecane (G1GC)',
      text: zgc
        ? `Dużo pamięci, ${cpuCores} wątków procesora i ${modCount} modów – ZGC sprząta pamięć w tle, prawie bez przycięć. Ta instancja działa na Javie ${javaMajor}.`
        : `Dostrojony G1GC to najlepszy wybór dla większości komputerów. Flagi są dobrane do Javy ${javaMajor}, na której działa ta instancja.`,
    },
    { key: 'options', title: `Grafika: ${OPTION_PRESETS[optionsPreset].label}`, text: optionsWhy },
  ];
  if (modded) {
    reasons.push({
      key: 'mods',
      title: 'Mody: zestaw podstawowy',
      text: turbo
        ? `Sprawdzone mody, bezpieczne dla każdego komputera. Twój procesor ma ${cpuCores} wątków, więc możesz też włączyć dodatki Turbo (przełącznik przy liście modów) – szybciej wczytują świat.`
        : 'Sprawdzone mody, bezpieczne dla każdego komputera. Dodatki Turbo polecam dopiero od 6 wątków procesora i 8 GB pamięci.',
    });
  }
  return { memoryMb, jvmPreset: zgc ? 'zgc' : 'recommended', optionsPreset, turbo, gpuClass, reasons };
}

module.exports = { createOptimizer, resolveMods, visibleMods, installPlanned, mergeOptions, writeOptionsPreset, setGpuPreference, recommend, classifyGpu, PERFORMANCE_MODS, OPTION_PRESETS, TIERS };
