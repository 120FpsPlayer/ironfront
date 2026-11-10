'use strict';

/**
 * Java for Minecraft: every game version says which Java it needs (javaVersion.component in its version JSON:
 * jre-legacy = Java 8, java-runtime-gamma = Java 17, java-runtime-delta = Java 21 …). The launcher downloads exactly
 * that runtime from Mojang into runtime/<component>/, so players never install Java themselves.
 */

const fs = require('node:fs');
const path = require('node:path');
const installer = require('@xmcl/installer');

/** Java major version of a Mojang runtime component (for the JVM flags). */
const MAJOR = {
  'jre-legacy': 8,
  'java-runtime-alpha': 16,
  'java-runtime-beta': 17,
  'java-runtime-gamma': 17,
  'java-runtime-gamma-snapshot': 17,
  'java-runtime-delta': 21,
  'java-runtime-epsilon': 25,
};

function componentOf(versionJson) {
  return versionJson?.javaVersion?.component || 'jre-legacy';
}

function majorOf(versionJson) {
  return versionJson?.javaVersion?.majorVersion ?? MAJOR[componentOf(versionJson)] ?? 8;
}

/** The java executable inside a runtime folder (javaw on Windows – no console window). */
function javaExecutable(dir, platform = process.platform) {
  if (platform === 'win32') return path.join(dir, 'bin', 'javaw.exe');
  if (platform === 'darwin') {
    const bundle = path.join(dir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java');
    return fs.existsSync(bundle) ? bundle : path.join(dir, 'bin', 'java');
  }
  return path.join(dir, 'bin', 'java');
}

const RUNTIME_INDEX = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

/** Mojang's name for this computer in the runtime index. */
function runtimePlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'ia32' ? 'linux-i386' : 'linux';
}

async function getJson(url, fetchFn) {
  const res = await fetchFn(url, { headers: { 'user-agent': 'HammerShop-Launcher/1.0 (hammershop.pl)' }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw Object.assign(new Error(`Serwer zwrócił błąd ${res.status}`), { statusCode: res.status, url });
  return res.json();
}

/**
 * The file list of one Java runtime: { files, target, version }. (Fetched here and not with @xmcl/installer,
 * whose version of this function passes an option the current undici no longer accepts.)
 */
async function fetchRuntimeManifest(component, { fetchFn = fetch, platform, arch } = {}) {
  const index = await getJson(RUNTIME_INDEX, fetchFn);
  const target = index?.[runtimePlatform(platform, arch)]?.[component]?.[0];
  if (!target?.manifest?.url) throw new Error(`Mojang nie udostępnia Javy „${component}” dla tego systemu. Ustaw własną Javę w ustawieniach.`);
  const manifest = await getJson(target.manifest.url, fetchFn);
  return { files: manifest.files ?? {}, target: component, version: target.version };
}

function runtimeDir(paths, component) {
  return path.join(paths.runtime, component.replace(/[^\w.-]/g, '_'));
}

/** Makes sure the runtime is downloaded; returns the java executable. */
async function ensureJava(paths, component, { progress, dispatcher, fetchFn } = {}) {
  const dir = runtimeDir(paths, component);
  const exe = javaExecutable(dir);
  const marker = path.join(dir, '.hammershop-ok');
  if (fs.existsSync(exe) && fs.existsSync(marker)) return exe;
  progress?.stage('java');
  const manifest = await fetchRuntimeManifest(component, { fetchFn });
  const task = installer.installJavaRuntimeTask({ destination: dir, manifest, dispatcher, lzma: false });
  await task.startAndWait(progress?.context('java', task));
  if (process.platform !== 'win32') {
    // Mojang marks executables in the manifest; make sure the java binaries can run.
    for (const [file, entry] of Object.entries(manifest.files)) {
      if (entry.type === 'file' && entry.executable) fs.chmodSync(path.join(dir, file), 0o755);
    }
  }
  fs.writeFileSync(marker, String(manifest.version?.name ?? component));
  return exe;
}

module.exports = { ensureJava, fetchRuntimeManifest, runtimePlatform, javaExecutable, runtimeDir, componentOf, majorOf, MAJOR };
