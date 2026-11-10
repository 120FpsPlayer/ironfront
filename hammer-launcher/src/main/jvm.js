'use strict';

/**
 * Memory and JVM flags – the "make Minecraft run better" part of a launch. The flags follow the Java the game
 * really runs on (Minecraft uses Java 8, 16/17, 21 and – from 26.1 – Java 25):
 *   recommended – G1GC tuned for the game client (short pauses = fewer stutters), string deduplication
 *   zgc         – generational ZGC (Java 21+): the smoothest frame times with lots of RAM and big modpacks
 *   vanilla     – only the memory settings, like the official launcher
 *   custom      – your own flags (memory still set by the launcher unless you add -Xmx yourself)
 * Unknown flags never stop the game: -XX:+IgnoreUnrecognizedVMOptions goes first. Flags a Java version would only
 * warn about are left out for that version (checked against Mojang's own Java 8, 17, 21 and 25 runtimes).
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

const BASE = ['-XX:+IgnoreUnrecognizedVMOptions', '-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8'];

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

/** Generational ZGC came with Java 21; the older ZGC stalls on the game's allocation rate, so G1 is used there. */
const zgcSupported = (javaMajor) => javaMajor >= 21;

/** The preset that really runs: ZGC on a Java without generational ZGC falls back to the tuned G1. */
function effectivePreset(preset, javaMajor = 21) {
  if (!['recommended', 'zgc', 'vanilla', 'custom'].includes(preset)) return 'recommended';
  return preset === 'zgc' && !zgcSupported(javaMajor) ? 'recommended' : preset;
}

/** G1 flags for one Java version and heap size. */
function g1Flags({ javaMajor = 21, memoryMb = 4096 } = {}) {
  // Big regions keep the game's large buffers out of the slow "humongous" path; a small heap needs smaller ones.
  const region = memoryMb < 3072 ? '8M' : '16M';
  return RECOMMENDED.map((flag) => (flag.startsWith('-XX:G1HeapRegionSize=') ? `-XX:G1HeapRegionSize=${region}` : flag)).filter((flag) => javaMajor > 8 || flag !== '-XX:+UseFastUnorderedTimeStamps'); // that one does not exist in Java 8
}

/** ZGC flags: -XX:+ZGenerational only on Java 21 and 22 – later it is the only mode and the flag prints a warning. */
function zgcFlags({ javaMajor = 21 } = {}) {
  return ZGC.filter((flag) => flag !== '-XX:+ZGenerational' || javaMajor <= 22);
}

/** Flags that help with any garbage collector. */
function commonFlags({ javaMajor = 21, modCount = 0 } = {}) {
  const out = [];
  // Java 25: object headers shrink from 12 to 8 bytes – less memory for the game's millions of small objects.
  if (javaMajor >= 25) out.push('-XX:+UseCompactObjectHeaders');
  // Many mods = a lot of compiled code. When the code cache (240 MB by default) fills up, Java stops compiling
  // and the game gets slow for good. The space is only reserved, not used up front.
  if (modCount >= 150) out.push('-XX:ReservedCodeCacheSize=512M');
  else if (modCount >= 40) out.push('-XX:ReservedCodeCacheSize=400M');
  return out;
}

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
 * javaMajor: the Java the game starts with; memoryMb: the heap; modCount: enabled mods (for the code cache).
 */
function jvmArgs({ preset = 'recommended', custom = '', javaMajor = 21, memoryMb = 4096, modCount = 0 } = {}) {
  const real = effectivePreset(preset, javaMajor);
  if (real === 'vanilla') return [...BASE];
  if (real === 'custom') return [...BASE, ...splitArgs(custom).filter((a) => !/^-Xm[sx]/i.test(a))];
  return [...BASE, ...(real === 'zgc' ? zgcFlags({ javaMajor }) : g1Flags({ javaMajor, memoryMb })), ...commonFlags({ javaMajor, modCount })];
}

/** Custom flags may set the memory themselves (-Xmx6G) – then the launcher leaves it alone. */
function memoryFromCustom(custom) {
  const m = /-Xmx(\d+)([gGmM])/.exec(String(custom ?? ''));
  if (!m) return null;
  return m[2].toLowerCase() === 'g' ? Number(m[1]) * 1024 : Number(m[1]);
}

module.exports = { recommendMemory, jvmArgs, effectivePreset, zgcSupported, splitArgs, memoryFromCustom, RECOMMENDED, ZGC };
