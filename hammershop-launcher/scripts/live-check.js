'use strict';

/**
 * Live check against the real services (Mojang, Modrinth, Fabric/Forge/NeoForge mavens), run in CI:
 * installs real instances end to end and – on Linux under Xvfb – starts the game to see that the
 * classpath, natives and JVM arguments are right.
 *
 *   node scripts/live-check.js [--no-game] [--quick]
 *
 * The game is started with a placeholder test profile only to verify the launch command; the launcher
 * itself has no offline accounts – players always sign in with Microsoft.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServices } = require('../src/main/services');
const { loadConfig } = require('../src/main/config');

const args = new Set(process.argv.slice(2));
const NO_GAME = args.has('--no-game');
const QUICK = args.has('--quick');
const MC = process.env.MC_VERSION || '1.21.1';
const GAME_TIMEOUT = Number(process.env.GAME_TIMEOUT_MS || 300_000);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hammershop-live-'));
const results = [];
const log = (...a) => console.log(...a);

const listeners = new Map();
const on = (ch, fn) => {
  if (!listeners.has(ch)) listeners.set(ch, new Set());
  listeners.get(ch).add(fn);
  return () => listeners.get(ch).delete(fn);
};
let lastProgress = 0;
const emit = (ch, payload) => {
  if (ch === 'game:progress' || ch === 'task:progress') {
    const now = Date.now();
    if (now - lastProgress > 4000 || payload.percent === 100) {
      lastProgress = now;
      log(`   · ${payload.label ?? payload.stage}${payload.percent != null ? ` ${payload.percent}%` : payload.total ? ` ${payload.done}/${payload.total}` : ''}`);
    }
  }
  if (ch === 'toast') log(`   ! ${payload.text}`);
  for (const fn of listeners.get(ch) ?? []) fn(payload);
};

// A launch function that only proves Java works (Windows CI has no OpenGL for the game).
const javaOnly = async (options) => spawn(options.javaPath.replace(/javaw(\.exe)?$/i, 'java$1'), ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] });

const testProfile = { launchAuth: async () => ({ id: '0123456789abcdef0123456789abcdef', name: 'HammerShopCI', accessToken: '0' }) };
const config = loadConfig(path.join(__dirname, '..', 'launcher.config.json'));
const services = createServices({ root, config: { ...config, server: { address: '' } }, accounts: testProfile, emit, launchFn: NO_GAME ? javaOnly : undefined });

async function step(name, fn) {
  const t = Date.now();
  log(`\n▶ ${name}`);
  try {
    const detail = await fn();
    const s = ((Date.now() - t) / 1000).toFixed(1);
    results.push({ name, ok: true, s, detail });
    log(`✔ ${name} (${s} s)${detail ? ` – ${detail}` : ''}`);
    return true;
  } catch (err) {
    const s = ((Date.now() - t) / 1000).toFixed(1);
    results.push({ name, ok: false, s, detail: err.message });
    log(`✘ ${name} (${s} s)\n${err.stack ?? err}`);
    return false;
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** Launches an instance and waits until the game window starts rendering (or Java answers, with --no-game). */
function playAndWatch(instance) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let done = false;
    const READY = NO_GAME ? /version "\d+|openjdk version/i : /Backend library: LWJGL|Reloading ResourceManager|Created: \d+x\d+x\d+ minecraft:textures/;
    const finish = (err, msg) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      offLog();
      offState();
      if (!NO_GAME) services.games.stop(instance.id);
      if (err) reject(new Error(`${err}\n--- ostatnie linie logu ---\n${lines.slice(-60).join('\n')}`));
      else resolve(msg);
    };
    const timer = setTimeout(() => finish(`Gra nie wystartowała w ${GAME_TIMEOUT / 1000} s`), GAME_TIMEOUT);
    const offLog = on('game:log', (e) => {
      if (e.instanceId !== instance.id) return;
      lines.push(e.line);
      if (READY.test(e.line)) finish(null, e.line.trim().slice(0, 140));
    });
    const offState = on('game:state', (e) => {
      if (e.instanceId !== instance.id) return;
      if (e.state === 'crashed' || (e.state === 'exited' && !done)) {
        setTimeout(() => (READY.test(lines.join('\n')) ? finish(null, 'gotowe') : finish(`Gra zakończyła się (kod ${e.code}): ${e.crash?.title ?? ''}`)), 200);
      }
    });
    services.launch(instance.id).catch((err) => finish(err.message));
  });
}

async function main() {
  log(`HammerShop Launcher – test na żywo (${process.platform}, Node ${process.version})\nFolder: ${root}`);
  services.settings.set({ concurrentDownloads: 24 });

  await step('Modrinth: wyszukiwanie', async () => {
    const res = await services.modrinth.search({ query: 'sodium', type: 'mod', mcVersion: MC, loader: 'fabric' });
    assert(res.hits.some((h) => h.slug === 'sodium'), 'Brak Sodium w wynikach');
    const cats = await services.modrinth.categories();
    assert(cats.length > 10, 'Brak kategorii');
    return `${res.total_hits} wyników, ${cats.length} kategorii`;
  });

  let latest;
  await step('Lista wersji i loaderów', async () => {
    const list = await services.versions.minecraftVersions();
    latest = list[0].id;
    const fabric = await services.versions.loaderVersions('fabric', MC);
    const neo = await services.versions.loaderVersions('neoforge', MC);
    const forge = await services.versions.loaderVersions('forge', '1.20.1');
    assert(fabric.length && neo.length && forge.length, `fabric ${fabric.length}, neoforge ${neo.length}, forge ${forge.length}`);
    return `najnowsza ${latest}; Fabric ${fabric[0].version}, NeoForge ${neo[0].version}, Forge 1.20.1: ${forge.length} wersji`;
  });

  // Fabric + optimisation: the main path players use.
  const inst = services.instances.create({ name: 'Test Fabric', mcVersion: MC, loader: 'fabric', optimized: true });
  await step('Mod z zależnościami (Mod Menu → Fabric API)', async () => {
    const res = await services.content.install(inst, { projectId: 'modmenu', type: 'mod' });
    const list = services.content.list(inst, 'mod');
    assert(list.some((m) => /fabric-api/i.test(m.file)), `Brak Fabric API: ${list.map((m) => m.file).join(', ')}`);
    return `zainstalowano: ${res.installed.join(', ')}`;
  });
  await step('Plan modów wydajnościowych', async () => {
    const plan = await services.optimizer.plan(inst);
    const ok = plan.mods.filter((m) => m.available).map((m) => m.name);
    assert(ok.includes('Sodium') && ok.includes('Lithium'), `Dostępne: ${ok.join(', ')}`);
    return ok.join(', ');
  });
  await step(`Instalacja i ${NO_GAME ? 'test Javy' : 'start gry'}: Fabric ${MC} + optymalizacja`, async () => {
    const line = await playAndWatch(inst);
    const mods = services.content.list(services.instances.get(inst.id), 'mod').map((m) => m.title);
    assert(mods.some((m) => /sodium/i.test(m)), `Brak Sodium po optymalizacji: ${mods.join(', ')}`);
    return `${mods.length} modów; ${line}`;
  });
  await step('Sprawdzenie aktualizacji modów', async () => {
    const upd = await services.content.checkUpdates(services.instances.get(inst.id), 'mod');
    return `${upd.length} do aktualizacji`;
  });
  await step('Optymalizacja: grafika i rekomendacja', async () => {
    const info = await services.optimizerInfo(inst.id);
    await services.applyOptimization(inst.id, { mods: false, optionsPreset: info.recommendation.optionsPreset });
    const opts = fs.readFileSync(path.join(services.instances.dir(inst.id), 'options.txt'), 'utf8');
    assert(/renderDistance:/.test(opts) && /lang:pl_pl/.test(opts), 'options.txt bez zmian');
    return `${info.recommendation.memoryMb} MB, ${info.recommendation.jvmPreset}, ${info.recommendation.optionsPreset}`;
  });

  if (!QUICK) {
    for (const [name, mc, loader] of [
      ['Vanilla (najnowsza)', null, 'vanilla'],
      ['Forge 1.20.1', '1.20.1', 'forge'],
      [`NeoForge ${MC}`, MC, 'neoforge'],
      ['Quilt 1.20.4', '1.20.4', 'quilt'],
    ]) {
      const i = services.instances.create({ name, mcVersion: mc ?? latest, loader, optimized: false });
      await step(`Instalacja: ${name}`, async () => {
        const { prepareInstance } = require('../src/main/installer');
        const res = await prepareInstance({ paths: services.paths, instance: services.instances.get(i.id), settings: services.settings.get(), instances: services.instances });
        assert(fs.existsSync(res.javaPath), `Brak Javy: ${res.javaPath}`);
        return `${res.versionId}, Java ${res.javaMajor}`;
      });
    }
    await step('Paczka modów z Modrinth (Fabulously Optimized)', async () => {
      const created = await services.modpacks.installFromModrinth({ projectId: 'fabulously-optimized' });
      const n = services.content.list(created, 'mod').length;
      assert(n >= 10, `Za mało modów: ${n}`);
      return `${created.name}: Minecraft ${created.mcVersion}, ${created.loader}, ${n} modów`;
    });
  }

  const failed = results.filter((r) => !r.ok);
  log(`\n── Podsumowanie ──\n${results.map((r) => `${r.ok ? '✔' : '✘'} ${r.name} (${r.s} s)`).join('\n')}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Test na żywo – ${process.platform}\n\n| | Krok | Czas | Wynik |\n|---|---|---|---|\n${results.map((r) => `| ${r.ok ? '✅' : '❌'} | ${r.name} | ${r.s} s | ${String(r.detail ?? '').replace(/\|/g, '/').replace(/\n[\s\S]*/, '').slice(0, 160)} |`).join('\n')}\n\n`);
  }
  if (!process.env.KEEP) fs.rmSync(root, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
