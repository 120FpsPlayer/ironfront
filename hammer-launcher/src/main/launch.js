'use strict';

/**
 * Starting the game: builds the launch options (account, RAM, JVM flags, resolution, quick join), spawns Java,
 * streams the log to the window, raises the process priority, tracks play time and explains crashes.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { launch, createMinecraftProcessWatcher } = require('@xmcl/core');
const { recommendMemory, jvmArgs, memoryFromCustom } = require('./jvm');
const { analyze } = require('./crash');

const PRIORITY = { normal: os.constants.priority.PRIORITY_NORMAL, above_normal: os.constants.priority.PRIORITY_ABOVE_NORMAL, high: os.constants.priority.PRIORITY_HIGH };

/** The process priority of a launch: the instance's own choice, else the launcher setting. */
function priorityFor(instance, settings) {
  const own = instance?.processPriority;
  return own && own in PRIORITY ? own : settings?.processPriority in PRIORITY ? settings.processPriority : 'above_normal';
}

/**
 * Gives the game more processor time than programs in the background. Node asks the system directly (Windows:
 * the priority class of the process, others: its nice value) – no helper program is started. Systems that do not
 * allow it (a higher priority without admin rights on Linux / macOS) simply keep the normal one: returns false.
 */
function raisePriority(pid, level, { setPriority = os.setPriority } = {}) {
  if (!pid || !(level in PRIORITY) || level === 'normal') return false;
  try {
    setPriority(pid, PRIORITY[level]);
    return true;
  } catch {
    return false;
  }
}

const XML_ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const unxml = (s) => s.replace(/&(lt|gt|amp|quot|apos);/g, (m) => XML_ENTITIES[m]);

/**
 * Minecraft writes its log to stdout as log4j XML events (the format Mojang's launcher reads). This turns them back
 * into readable lines – "[12:41:02] [Render thread/INFO]: message" – and passes any other line through.
 */
function createLogParser() {
  let event = null;
  const cdata = (text, tag) => {
    const m = new RegExp(`<log4j:${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</log4j:${tag}>`).exec(text);
    return m ? (m[1] ?? unxml(m[2] ?? '')) : null;
  };
  const attr = (text, name) => {
    const m = new RegExp(`${name}="([^"]*)"`).exec(text);
    return m ? unxml(m[1]) : '';
  };
  return (line) => {
    if (!event) {
      const start = line.indexOf('<log4j:Event');
      if (start === -1) return [line];
      event = line.slice(start);
    } else event += `\n${line}`;
    if (!event.includes('</log4j:Event>')) {
      if (event.length > 200_000) event = null; // never buffer forever on a broken stream
      return [];
    }
    const text = event;
    event = null;
    const ts = Number(attr(text, 'timestamp'));
    const time = Number.isFinite(ts) && ts > 0 ? new Date(ts).toTimeString().slice(0, 8) : '';
    const head = `${time ? `[${time}] ` : ''}[${attr(text, 'thread') || 'main'}/${attr(text, 'level') || 'INFO'}]: `;
    const out = (cdata(text, 'Message') ?? '').split(/\r?\n/).map((l, i) => (i === 0 ? head + l : l));
    const thrown = cdata(text, 'Throwable');
    if (thrown) out.push(...thrown.split(/\r?\n/).filter(Boolean));
    return out;
  };
}

/** Number of enabled mods in an instance (for the RAM recommendation). */
function countMods(dir) {
  try {
    return fs.readdirSync(path.join(dir, 'mods')).filter((f) => f.endsWith('.jar')).length;
  } catch {
    return 0;
  }
}

/** Splits "play.hammershop.pl:25566" into { ip, port }. */
function parseAddress(address) {
  const m = /^\s*([^:\s]+)(?::(\d{1,5}))?\s*$/.exec(String(address ?? ''));
  return m ? { ip: m[1], port: m[2] ? Number(m[2]) : 25565 } : null;
}

/** Quick Play (join a server on start) exists since 1.20 (23w14a); older versions use --server. */
function supportsQuickPlay(mcVersion) {
  const m = /^1\.(\d+)/.exec(String(mcVersion));
  return !m || Number(m[1]) >= 20;
}

/** Memory for a launch in MB: custom -Xmx, then the instance, then the global setting, then the recommendation. */
function memoryFor({ instance, settings, totalMem = os.totalmem(), modCount = 0 }) {
  const preset = instance.jvmPreset || settings.jvmPreset;
  const custom = preset === 'custom' ? instance.customJvmArgs || settings.customJvmArgs : '';
  return memoryFromCustom(custom) ?? instance.memoryMb ?? settings.memoryMb ?? recommendMemory(totalMem, { modCount, loader: instance.loader });
}

/**
 * The @xmcl/core launch options – a pure function, so it is easy to test.
 * Where the game starts: `server` ("host:port" from the Serwery tab) joins that server, `world` (a folder in saves/)
 * opens that singleplayer world, otherwise `join` / the instance's autoJoinServer joins the configured server.
 */
function buildLaunchOptions({ paths, instance, settings, account, versionId, javaPath, javaMajor = 21, totalMem, modCount = 0, config = {}, join, server: joinAddress, world } = {}) {
  const preset = instance.jvmPreset || settings.jvmPreset || 'recommended';
  const custom = preset === 'custom' ? instance.customJvmArgs || settings.customJvmArgs : '';
  const maxMemory = memoryFor({ instance, settings, totalMem, modCount });
  const options = {
    gamePath: instance.dir,
    resourcePath: paths.root,
    javaPath,
    version: versionId,
    gameProfile: { name: account.name, id: account.id },
    accessToken: account.accessToken,
    userType: 'msa',
    properties: {},
    launcherName: 'HammerShop',
    launcherBrand: 'Hammer Launcher',
    gameName: config.brand ? `${config.brand} · ${instance.name}` : instance.name,
    maxMemory,
    minMemory: preset === 'vanilla' ? undefined : Math.max(512, Math.floor(maxMemory / 2 / 256) * 256),
    extraJVMArgs: jvmArgs({ preset, custom, javaMajor, memoryMb: maxMemory, modCount }),
    resolution: settings.resolution?.fullscreen ? { fullscreen: true } : { width: settings.resolution?.width ?? 1280, height: settings.resolution?.height ?? 720 },
  };
  const quickPlay = supportsQuickPlay(instance.mcVersion);
  const server = joinAddress ? parseAddress(joinAddress) : world ? null : (join ?? instance.autoJoinServer) ? parseAddress(config.server?.address) : null;
  if (server) {
    if (quickPlay) options.quickPlayMultiplayer = `${server.ip}:${server.port}`;
    else options.server = server;
  } else if (world && quickPlay) {
    // @xmcl/core has no option for this one; older versions have no way to open a world from the command line.
    options.quickPlaySingleplayer = String(world);
    options.extraMCArgs = ['--quickPlaySingleplayer', String(world)];
  }
  return options;
}

/** Newest crash report of an instance written after `since`. */
function newestCrashReport(dir, since) {
  try {
    const folder = path.join(dir, 'crash-reports');
    const file = fs
      .readdirSync(folder)
      .map((f) => ({ f, t: fs.statSync(path.join(folder, f)).mtimeMs }))
      .filter((x) => x.t >= since)
      .sort((a, b) => b.t - a.t)[0];
    return file ? fs.readFileSync(path.join(folder, file.f), 'utf8') : '';
  } catch {
    return '';
  }
}

/**
 * Keeps track of running games. Events:
 *   log    { instanceId, line, stream }
 *   state  { instanceId, state: 'starting' | 'running' | 'exited' | 'crashed', crash?, code?, playedMs?, benchmark?, stopped? }
 *          (stopped: true – the player closed the game with ZATRZYMAJ; that is an ordinary end, not a crash)
 */
class GameManager extends EventEmitter {
  constructor({ launchFn = launch, setPriority = os.setPriority } = {}) {
    super();
    this.launchFn = launchFn;
    this.setPriority = setPriority;
    this.running = new Map(); // instanceId → { process, startedAt, logs }
  }

  isRunning(instanceId) {
    return this.running.has(instanceId);
  }

  logs(instanceId) {
    return this.running.get(instanceId)?.logs ?? this.lastLogs?.get(instanceId) ?? [];
  }

  /** `benchmark: true` marks an FPS test – every state event of that run carries it (it is not a game session). */
  async start({ instance, options, priority = 'above_normal', onExit, benchmark = false }) {
    if (this.running.has(instance.id)) throw new Error('Ta instancja już działa.');
    const mark = benchmark ? { benchmark: true } : {};
    const startedAt = Date.now();
    const logs = [];
    const parsers = { stdout: createLogParser(), stderr: createLogParser() };
    const push = (raw, stream) => {
      for (const line of (parsers[stream] ?? parsers.stdout)(raw)) {
        logs.push({ line, stream, at: Date.now() });
        if (logs.length > 3000) logs.splice(0, logs.length - 3000);
        this.emit('log', { instanceId: instance.id, line, stream });
      }
    };
    this.emit('state', { instanceId: instance.id, state: 'starting', ...mark });
    const child = await this.launchFn(options);
    this.running.set(instance.id, { process: child, startedAt, logs });
    raisePriority(child.pid, priority, { setPriority: this.setPriority }); // not allowed on this system → the game still runs
    for (const [stream, src] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      let rest = '';
      src?.setEncoding?.('utf8');
      src?.on('data', (chunk) => {
        const lines = (rest + chunk).split(/\r?\n/);
        rest = lines.pop();
        for (const line of lines) if (line) push(line, stream);
      });
    }
    const watcher = createMinecraftProcessWatcher(child);
    watcher.on('minecraft-window-ready', () => this.emit('state', { instanceId: instance.id, state: 'running', ...mark }));
    const finish = (code, signal, crashReport = '') => {
      if (!this.running.has(instance.id)) return;
      const stopped = Boolean(this.running.get(instance.id).stopping);
      this.running.delete(instance.id);
      this.lastLogs ??= new Map();
      this.lastLogs.set(instance.id, logs);
      const report = crashReport || (code !== 0 ? newestCrashReport(instance.dir, startedAt) : '');
      // A game the player stopped is killed (on Windows its exit code is 1): an ordinary end, not a crash.
      const crash = stopped ? null : analyze({ code, signal, crashReport: report, log: logs.slice(-400).map((l) => l.line).join('\n') });
      const playedMs = Date.now() - startedAt;
      this.emit('state', { instanceId: instance.id, state: crash && code !== 0 ? 'crashed' : 'exited', code, crash, playedMs, ...(stopped ? { stopped: true } : {}), ...mark });
      onExit?.({ code, crash, playedMs });
    };
    watcher.on('minecraft-exit', ({ code, signal, crashReport }) => finish(code, signal, crashReport));
    watcher.on('error', (err) => {
      push(String(err?.message ?? err), 'stderr');
      finish(-1, null, '');
    });
    return child;
  }

  stop(instanceId) {
    const run = this.running.get(instanceId);
    if (!run) return false;
    run.stopping = true;
    run.process.kill();
    return true;
  }
}

module.exports = { GameManager, buildLaunchOptions, createLogParser, memoryFor, parseAddress, supportsQuickPlay, countMods, priorityFor, raisePriority, PRIORITY };
