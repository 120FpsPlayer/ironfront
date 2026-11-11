'use strict';

/**
 * The player's own pictures (Hammer+), kept in the launcher folder so they keep working when the original file
 * is moved or deleted:
 *
 *   theme/background-<hash>.<png|jpg|webp>   the launcher background, shown dimmed behind the pages
 *   theme/menu.png                            the background of the Hammer menus in the game: one PNG of at most
 *                                             1920×1080, copied to <instance>/config/hammerclient/menu.png at each
 *                                             start (Hammer Client shows it when the player picks "Własny obraz")
 *   theme/menu.json                           { sent: [sha1 …] } – the menu pictures the launcher has handed out
 *
 * Only real PNG, JPEG and WebP files of a sane size are taken – checked by their first bytes, not by the name.
 * No Electron here: the menu picture is resized by `convert`, which main.js gives (Electron's nativeImage).
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { readJson, writeJson } = require('./store');

const MAX_BYTES = 12 * 1024 * 1024;
const NAME = /^background-[0-9a-f]{8}\.(png|jpg|webp)$/;
const EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
const MENU = { width: 1920, height: 1080, maxBytes: 24 * 1024 * 1024, file: path.join('config', 'hammerclient', 'menu.png') };

const sha1 = (data) => crypto.createHash('sha1').update(data).digest('hex');

/** A file the player picked, as bytes – refused with a Polish sentence when it is missing, too big or not a picture. */
function readPicture(source) {
  let stat = null;
  try {
    stat = fs.statSync(source);
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) throw new Error('Nie udało się otworzyć tego pliku. Wybierz obraz jeszcze raz.');
  if (stat.size > MAX_BYTES) throw new Error('Ten obraz jest za duży – wybierz plik do 12 MB.');
  const data = fs.readFileSync(source);
  const type = imageType(data);
  if (!type) throw new Error('To nie jest obraz PNG, JPG ani WebP. Wybierz zdjęcie albo zrzut ekranu w jednym z tych formatów.');
  return { data, type };
}

/** 'png' | 'jpg' | 'webp' from the first bytes of a file – null for anything else. */
function imageType(data) {
  if (!Buffer.isBuffer(data) || data.length < 12) return null;
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpg';
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function createBackgrounds({ dir }) {
  const fileOf = (name) => (typeof name === 'string' && NAME.test(name) ? path.join(dir, name) : null);

  /** The file:// address of a stored background for the window – null when it is not there. */
  function url(name) {
    const file = fileOf(name);
    return file && fs.existsSync(file) ? pathToFileURL(file).href : null;
  }

  /** Removes every stored background except `keep`. */
  function clear(keep = null) {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) if (NAME.test(name) && name !== keep) fs.rmSync(path.join(dir, name), { force: true });
  }

  /** Copies a picture into the launcher folder and returns its name there. The one before it is removed. */
  function store(source) {
    const { data, type } = readPicture(source);
    const name = `background-${sha1(data).slice(0, 8)}.${type}`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), data);
    clear(name);
    return name;
  }

  return { url, store, clear };
}

/** Width and height of a PNG from its header – null when the data is not a PNG. */
function pngSize(data) {
  if (imageType(data) !== 'png' || data.length < 33 || data.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/**
 * Tło menu w grze. `convert(data, { maxWidth, maxHeight })` turns any picture into PNG bytes that fit the given
 * size (keeping the proportions); without it only a PNG that already fits is taken.
 */
function createMenuBackground({ dir, convert = null }) {
  const file = path.join(dir, 'menu.png');
  const stateFile = path.join(dir, 'menu.json');
  const sent = () => {
    const list = readJson(stateFile, {})?.sent;
    return Array.isArray(list) ? list.filter((h) => /^[0-9a-f]{40}$/.test(String(h))) : [];
  };
  const has = () => fs.existsSync(file);

  /** The stored picture as a file:// address for the window (changes when the picture does) – null without one. */
  function url() {
    try {
      return `${pathToFileURL(file).href}?${Math.round(fs.statSync(file).mtimeMs)}`;
    } catch {
      return null;
    }
  }

  /** Takes a picture the player picked: checked, made a PNG of at most 1920×1080 and stored as the one copy. */
  async function store(source) {
    const { data, type } = readPicture(source);
    let png = data;
    if (convert) png = await convert(data, { maxWidth: MENU.width, maxHeight: MENU.height });
    else if (type !== 'png') throw new Error('Na tło menu wybierz obraz PNG.');
    const size = Buffer.isBuffer(png) ? pngSize(png) : null;
    if (!size) throw new Error('Nie udało się przygotować tego obrazu. Wybierz inny plik PNG albo JPG.');
    if (size.width > MENU.width || size.height > MENU.height || png.length > MENU.maxBytes) throw new Error(`Ten obraz jest za duży na tło menu – może mieć najwyżej ${MENU.width}×${MENU.height} pikseli.`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, png);
    writeJson(stateFile, { sent: [sha1(png), ...sent().filter((h) => h !== sha1(png))].slice(0, 12) });
    return { width: size.width, height: size.height, bytes: png.length };
  }

  /** Forgets the picture. What already sits in the instances is taken back at their next start. */
  function clear() {
    fs.rmSync(file, { force: true });
  }

  /**
   * Called at each start of an instance. With `active` (Hammer+ on and the mod in the instance) and a picture
   * set, the picture is put into config/hammerclient/menu.png – only when size or time differ. Otherwise a
   * picture the launcher put there is removed; one the player placed by hand (other content) is never touched.
   * Returns 'copied' | 'kept' | 'removed' | 'none'.
   */
  function deliver(instance, { active = false } = {}) {
    const target = path.join(instance.dir, MENU.file);
    let there = null;
    try {
      there = fs.statSync(target);
    } catch {
      there = null;
    }
    if (active && has()) {
      const mine = fs.statSync(file);
      // Same size and time = the copy from an earlier start. (Some disks round the time: then the content decides.)
      if (there?.isFile() && there.size === mine.size && (Math.abs(there.mtimeMs - mine.mtimeMs) < 2 || fs.readFileSync(target).equals(fs.readFileSync(file)))) return 'kept';
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file, target);
      fs.utimesSync(target, mine.atime, mine.mtime); // the time of the original, so the next start sees "already there"
      return 'copied';
    }
    if (!there?.isFile() || there.size > MENU.maxBytes || !sent().includes(sha1(fs.readFileSync(target)))) return 'none';
    fs.rmSync(target, { force: true });
    return 'removed';
  }

  return { url, has, store, clear, deliver };
}

module.exports = { createBackgrounds, createMenuBackground, imageType, pngSize, MAX_BYTES, EXTENSIONS, MENU };
