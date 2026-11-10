'use strict';

/** Galeria – the screenshots players take in game (F2), from every instance's screenshots/ folder. */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const IMAGE = /\.(png|jpe?g)$/i;
const LIMIT = 600;

/** Newest first: [{ instanceId, instanceName, file, url, size, takenAt }]. */
function listScreenshots(_instances, list) {
  const shots = [];
  for (const instance of list) {
    const dir = path.join(instance.dir, 'screenshots');
    let files = [];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!IMAGE.test(file)) continue;
      const full = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      shots.push({ instanceId: instance.id, instanceName: instance.name, file, url: pathToFileURL(full).href, size: stat.size, takenAt: stat.mtimeMs });
    }
  }
  return shots.sort((a, b) => b.takenAt - a.takenAt).slice(0, LIMIT);
}

/** The full path of one screenshot – only a plain file name inside the instance's screenshots folder. */
function screenshotPath(instance, file) {
  const name = String(file ?? '');
  if (!IMAGE.test(name) || name !== path.basename(name) || name.startsWith('.')) throw new Error('Nieprawidłowy plik.');
  const full = path.join(instance.dir, 'screenshots', name);
  if (!fs.existsSync(full)) throw new Error('Nie ma już tego zrzutu ekranu.');
  return full;
}

function removeScreenshot(instance, file) {
  fs.rmSync(screenshotPath(instance, file), { force: true });
  return true;
}

module.exports = { listScreenshots, screenshotPath, removeScreenshot };
