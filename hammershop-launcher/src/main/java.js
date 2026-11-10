'use strict';

/**
 * Java for Minecraft: every game version says which Java it needs (javaVersion.component in its version JSON:
 * jre-legacy = Java 8, java-runtime-gamma = Java 17, java-runtime-delta = Java 21 …). The launcher downloads exactly
 * that runtime from Mojang into runtime/<component>/, so players never install Java themselves.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getPlatform } = require('@xmcl/core');
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

function runtimeDir(paths, component) {
  return path.join(paths.runtime, component.replace(/[^\w.-]/g, '_'));
}

/** Makes sure the runtime is downloaded; returns the java executable. */
async function ensureJava(paths, component, { progress, dispatcher } = {}) {
  const dir = runtimeDir(paths, component);
  const exe = javaExecutable(dir);
  const marker = path.join(dir, '.hammershop-ok');
  if (fs.existsSync(exe) && fs.existsSync(marker)) return exe;
  progress?.stage('java');
  const manifest = await installer.fetchJavaRuntimeManifest({ target: component, platform: getPlatform(), dispatcher });
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

module.exports = { ensureJava, javaExecutable, runtimeDir, componentOf, majorOf, MAJOR };
