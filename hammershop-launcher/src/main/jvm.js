'use strict';

/**
 * Memory and JVM flags – the "make Minecraft run better" part of a launch.
 *   recommended – G1GC tuned for the game client (short pauses = fewer stutters), string deduplication
 *   zgc         – generational ZGC (Java 21+): the smoothest frame times with lots of RAM and big modpacks
 *   vanilla     – only the memory settings, like the official launcher
 *   custom      – your own flags (memory still set by the launcher unless you add -Xmx yourself)
 * Unknown flags never stop the game: -XX:+IgnoreUnrecognizedVMOptions goes first.
 */

const MB = 1024 * 1024;

/**
 * RAM for the game in MB. Vanilla needs little; mods need more. Never more than half of the computer's RAM
 * (the system, Discord and the browser need the rest) and never more than 12 GB (bigger heaps make GC slower).
 */
function recommendMemory(totalBytes, { modCount = 0, loader = 'vanilla' } = {}) {
  const totalMb = Math.floor(totalBytes / MB);
  let mb;
  if (totalMb <= 4096) mb = 1536;
  else if (totalMb <= 8192) mb = 2560;
  else if (totalMb <= 16384) mb = 4096;
  else mb = 6144;
  if (loader !== 'vanilla') mb = Math.max(mb, 3072) + Math.floor(modCount / 40) * 1024;
  const cap = Math.min(12288, Math.floor(totalMb / 2));
  return Math.max(1024, Math.min(mb, cap)) - (Math.max(1024, Math.min(mb, cap)) % 256);
}

const RECOMMENDED = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=37',
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+UnlockDiagnosticVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:G1NewSizePercent=23',
  '-XX:G1MaxNewSizePercent=40',
  '-XX:G1HeapRegionSize=16M',
  '-XX:G1ReservePercent=20',
  '-XX:G1HeapWastePercent=5',
  '-XX:G1MixedGCCountTarget=3',
  '-XX:InitiatingHeapOccupancyPercent=20',
  '-XX:G1MixedGCLiveThresholdPercent=90',
  '-XX:SurvivorRatio=32',
  '-XX:MaxTenuringThreshold=1',
  '-XX:+PerfDisableSharedMem',
  '-XX:+UseStringDeduplication',
  '-XX:+UseFastUnorderedTimeStamps',
  '-XX:+OmitStackTraceInFastThrow',
];

const ZGC = ['-XX:+UseZGC', '-XX:+ZGenerational', '-XX:+DisableExplicitGC', '-XX:+PerfDisableSharedMem', '-XX:+OmitStackTraceInFastThrow'];

/** Splits a flags string the way a shell would (quotes keep spaces). */
function splitArgs(text) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text ?? '')))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * The extra JVM arguments for a launch (memory goes through minMemory / maxMemory of the launch options).
 * ZGC needs Java 17+ (generational ZGC: 21+) – older Java falls back to the recommended G1 flags.
 */
function jvmArgs({ preset = 'recommended', custom = '', javaMajor = 21 } = {}) {
  const base = ['-XX:+IgnoreUnrecognizedVMOptions', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8'];
  if (preset === 'vanilla') return base;
  if (preset === 'custom') return [...base, ...splitArgs(custom).filter((a) => !/^-Xm[sx]/i.test(a))];
  if (preset === 'zgc' && javaMajor >= 17) return [...base, ...(javaMajor >= 21 ? ZGC : ZGC.filter((a) => a !== '-XX:+ZGenerational'))];
  return [...base, ...(javaMajor <= 8 ? RECOMMENDED.filter((a) => a !== '-XX:+UseFastUnorderedTimeStamps') : RECOMMENDED)];
}

/** Custom flags may set the memory themselves (-Xmx6G) – then the launcher leaves it alone. */
function memoryFromCustom(custom) {
  const m = /-Xmx(\d+)([gGmM])/.exec(String(custom ?? ''));
  if (!m) return null;
  return m[2].toLowerCase() === 'g' ? Number(m[1]) * 1024 : Number(m[1]);
}

module.exports = { recommendMemory, jvmArgs, splitArgs, memoryFromCustom, RECOMMENDED, ZGC };
