'use strict';

/**
 * Skins and capes of the signed-in Microsoft account (the Minecraft services API – the same one minecraft.net
 * uses), plus a small local library of skins the player has used, so going back to one is a single click:
 *
 *   skins/<sha1>.png      the skin files
 *   skins/library.json    [{ id, name, variant, addedAt, usedAt, texture }] – texture = its address at Mojang
 *   skins/outfits.json    [{ id, name, skin, variant, cape, capeName, createdAt }] – Zestawy (Hammer+): a named
 *                         look = a skin of the library + the arm model + a cape of the account (or none)
 *
 * No Electron here: the network goes through `fetchFn`, the account through `auth(force)`, which resolves with
 * { id, name, accessToken } – with force = true after the server refused the token, to get a fresh one.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readJson, writeJson } = require('./store');
const { USER_AGENT } = require('./net');

const API = 'https://api.minecraftservices.com/minecraft/profile';
const TEXTURE_URL = /^https:\/\/textures\.minecraft\.net\/texture\/[0-9a-f]{16,80}$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 512 * 1024; // a 64×64 picture is a few kB – anything big is not a skin
const MAX_LIBRARY = 24; // skins kept without Hammer+
const PLUS_LIBRARY = 200; // … and with it
const MAX_OUTFITS = 50;
const VARIANTS = ['classic', 'slim'];

const LOGIN_AGAIN = 'Sesja konta Microsoft wygasła – zaloguj się ponownie (Ustawienia → Konta Microsoft) i spróbuj jeszcze raz.';

/** Width and height from the PNG header (signature + IHDR chunk) – null when the data is not a PNG. */
function pngSize(data) {
  if (!Buffer.isBuffer(data) || data.length < 33) return null;
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (data.readUInt32BE(8) !== 13 || data.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** A skin is a PNG of 64×64 pixels (or 64×32, the format from before Minecraft 1.8). Returns { width, height, legacy }. */
function checkSkin(data) {
  if (!Buffer.isBuffer(data) || !data.length) throw new Error('Ten plik jest pusty – wybierz plik PNG ze skórką.');
  if (data.length > MAX_BYTES) throw new Error('Ten plik jest za duży na skórkę. Skórka to mały obrazek PNG 64×64 pikseli.');
  const size = pngSize(data);
  if (!size) throw new Error('To nie jest plik PNG. Skórka musi być obrazkiem PNG 64×64 pikseli.');
  if (size.width !== 64 || (size.height !== 64 && size.height !== 32)) throw new Error(`Skórka musi mieć 64×64 pikseli (albo 64×32 w starym formacie) – ten obrazek ma ${size.width}×${size.height}.`);
  return { ...size, legacy: size.height === 32 };
}

const httpsUrl = (url) => (typeof url === 'string' ? url.replace(/^http:\/\//, 'https://') : null);
const dataUrl = (data) => `data:image/png;base64,${data.toString('base64')}`;
const variantOf = (v) => (String(v ?? '').toLowerCase() === 'slim' ? 'slim' : 'classic');
const cleanName = (name) => String(name ?? '').replace(/\.png$/i, '').replace(/[\x00-\x1f]/g, '').trim().slice(0, 40);

/** "data:image/png;base64,…" from the window → the bytes (only PNG data URLs of a sane size). */
function fromDataUrl(text) {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(text ?? ''));
  if (!m || m[1].length > MAX_BYTES * 1.4) throw new Error('To nie jest plik PNG. Skórka musi być obrazkiem PNG 64×64 pikseli.');
  return Buffer.from(m[1], 'base64');
}

/** One plain Polish sentence for a refusal of the Minecraft services. */
function apiError(status, what) {
  if (status === 401) return LOGIN_AGAIN;
  if (status === 403) return 'Mojang nie pozwala teraz na tę zmianę na tym koncie. Spróbuj później albo zmień ją na minecraft.net.';
  if (status === 404) return 'To konto nie ma profilu Minecraft: Java Edition.';
  if (status === 429) return 'Za dużo zmian w krótkim czasie – odczekaj chwilę i spróbuj ponownie.';
  if (status === 400) return what === 'skin' ? 'Serwer Minecrafta odrzucił tę skórkę. Upewnij się, że to zwykły obrazek PNG 64×64 pikseli.' : 'Serwer Minecrafta odrzucił tę zmianę. Odśwież zakładkę i spróbuj ponownie.';
  if (status >= 500) return `Serwery Minecrafta mają chwilowe problemy (błąd ${status}). Spróbuj za chwilę.`;
  return `Nie udało się – serwer Minecrafta odpowiedział błędem ${status}.`;
}

/** `limit()` says how many skins the library may hold right now (more with Hammer+). */
function createSkins({ dir, fetchFn = (...a) => fetch(...a), now = () => Date.now(), limit = () => MAX_LIBRARY }) {
  const indexFile = path.join(dir, 'library.json');
  const outfitsFile = path.join(dir, 'outfits.json');
  const fileOf = (id) => path.join(dir, `${id}.png`);
  const validId = (id) => /^[0-9a-f]{40}$/.test(String(id));
  const load = () => {
    const list = readJson(indexFile, []);
    return Array.isArray(list) ? list.filter((e) => e && validId(e.id) && fs.existsSync(fileOf(e.id))) : [];
  };
  const save = (list) => writeJson(indexFile, list);
  const loadOutfits = () => {
    const list = readJson(outfitsFile, []);
    return Array.isArray(list) ? list.filter((o) => o && /^[0-9a-f]{12}$/.test(String(o.id)) && validId(o.skin)).slice(0, MAX_OUTFITS) : [];
  };

  /**
   * Adds a skin file to the library (or finds it there); newest first, the oldest ones make room. A library
   * that grew with Hammer+ is not cut down when Hammer+ ends – a new skin then only pushes out one old one –
   * and a skin that belongs to an outfit is never the one to go.
   */
  function remember(list, data, { name, variant, texture = null }) {
    const room = Math.max(limit(), list.length);
    const id = crypto.createHash('sha1').update(data).digest('hex');
    let entry = list.find((e) => e.id === id);
    if (entry) {
      entry.usedAt = now();
      if (texture) entry.texture = texture;
      if (variant) entry.variant = variantOf(variant);
    } else {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fileOf(id), data);
      entry = { id, name: cleanName(name) || 'Skórka', variant: variantOf(variant), addedAt: now(), usedAt: now(), texture };
      list.push(entry);
    }
    // One address at Mojang belongs to one skin.
    if (texture) for (const other of list) if (other !== entry && other.texture === texture) other.texture = null;
    list.sort((a, b) => b.usedAt - a.usedAt);
    const kept = new Set(loadOutfits().map((o) => o.skin));
    for (let i = list.length - 1; i >= 0 && list.length > room; i -= 1) {
      if (list[i] === entry || kept.has(list[i].id)) continue;
      fs.rmSync(fileOf(list[i].id), { force: true });
      list.splice(i, 1);
    }
    return entry;
  }

  const publicEntry = (e, activeTexture) => ({ id: e.id, name: e.name, variant: variantOf(e.variant), addedAt: e.addedAt, usedAt: e.usedAt, active: Boolean(activeTexture && e.texture === activeTexture), dataUrl: dataUrl(fs.readFileSync(fileOf(e.id))) });

  /** One call to the Minecraft services; a refused token is refreshed once before the player is asked to sign in. */
  async function call(auth, method, pathname, { body, json, what } = {}) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const account = await auth(attempt > 0);
      let res;
      try {
        res = await fetchFn(API + pathname, {
          method,
          headers: { authorization: `Bearer ${account.accessToken}`, accept: 'application/json', 'user-agent': USER_AGENT, ...(json ? { 'content-type': 'application/json' } : {}) },
          body: json ? JSON.stringify(json) : body ? body() : undefined,
        });
      } catch {
        throw new Error('Brak połączenia z serwerami Minecrafta. Sprawdź internet i spróbuj ponownie.');
      }
      if (res.status === 401 && attempt === 0) continue;
      if (!res.ok) throw new Error(apiError(res.status, what));
      const profile = await res.json().catch(() => null);
      return { account, profile: profile?.id ? profile : null };
    }
    throw new Error(LOGIN_AGAIN);
  }

  /** The skin picture from Mojang's texture server – null when it cannot be fetched (the window then shows the link). */
  async function fetchTexture(url) {
    try {
      const res = await fetchFn(url, { headers: { 'user-agent': USER_AGENT } });
      if (!res.ok) return null;
      const data = Buffer.from(await res.arrayBuffer());
      checkSkin(data);
      return data;
    } catch {
      return null;
    }
  }

  /**
   * What the Skórka tab shows, from a profile answer of the API:
   * { account: { id, name }, skin: { url, variant, dataUrl, libraryId } | null, capes: [{ id, name, url, active }], library }
   * The skin the account wears is added to the library by itself – so the one from before a change is never lost.
   */
  async function describe(account, profile) {
    const list = load();
    const worn = (profile.skins ?? []).find((s) => s.state === 'ACTIVE') ?? null;
    const url = httpsUrl(worn?.url);
    let skin = null;
    if (url && TEXTURE_URL.test(url)) {
      let entry = list.find((e) => e.texture === url);
      if (!entry) {
        const data = await fetchTexture(url);
        if (data) {
          entry = remember(list, data, { name: `Skórka z konta (${new Date(now()).toLocaleDateString('pl-PL')})`, variant: worn.variant, texture: url });
          save(list);
        }
      }
      skin = { url, variant: variantOf(worn.variant), dataUrl: entry ? dataUrl(fs.readFileSync(fileOf(entry.id))) : null, libraryId: entry?.id ?? null };
    }
    const capes = (profile.capes ?? []).filter((c) => c && typeof c.id === 'string').map((c) => ({ id: c.id, name: String(c.alias ?? 'Peleryna').slice(0, 40), url: TEXTURE_URL.test(httpsUrl(c.url) ?? '') ? httpsUrl(c.url) : null, active: c.state === 'ACTIVE' }));
    return { account: { id: profile.id ?? account.id, name: profile.name ?? account.name }, skin, capes, library: load().map((e) => publicEntry(e, url)), limit: limit(), outfits: outfits() };
  }

  /** After a change the API answers with the new profile; if it does not, the profile is asked for again. */
  async function settle(auth, answer) {
    if (answer.profile) return describe(answer.account, answer.profile);
    return state(auth);
  }

  /** The current skin, capes and the library. */
  async function state(auth) {
    const { account, profile } = await call(auth, 'GET', '');
    if (!profile) throw new Error(apiError(404));
    return describe(account, profile);
  }

  /** Puts a new skin on the account: png = the file's bytes, variant = 'classic' (wide arms) | 'slim'. */
  async function upload(auth, { png, variant = 'classic', name = '' }) {
    checkSkin(png);
    const model = VARIANTS.includes(variant) ? variant : 'classic';
    const body = () => {
      const form = new FormData();
      form.set('variant', model);
      form.set('file', new Blob([png], { type: 'image/png' }), 'skin.png');
      return form;
    };
    const answer = await call(auth, 'POST', '/skins', { body, what: 'skin' });
    const list = load();
    const worn = (answer.profile?.skins ?? []).find((s) => s.state === 'ACTIVE');
    const texture = TEXTURE_URL.test(httpsUrl(worn?.url) ?? '') ? httpsUrl(worn.url) : null;
    remember(list, png, { name, variant: model, texture });
    save(list);
    return settle(auth, answer);
  }

  /** Puts a skin from the library back on (optionally with the other arm model). */
  async function use(auth, id, variant) {
    const entry = load().find((e) => e.id === id);
    if (!entry) throw new Error('Nie ma już tej skórki w bibliotece.');
    return upload(auth, { png: fs.readFileSync(fileOf(entry.id)), variant: VARIANTS.includes(variant) ? variant : variantOf(entry.variant), name: entry.name });
  }

  /** Back to the default skin (Steve, Alex…). The skins in the library stay. */
  const reset = async (auth) => settle(auth, await call(auth, 'DELETE', '/skins/active'));

  /** Shows a cape of the account (capeId) or hides the cape (null). */
  async function setCape(auth, capeId) {
    if (capeId != null && !/^[\w-]{1,64}$/.test(String(capeId))) throw new Error('Nieznana peleryna.');
    return settle(auth, capeId == null ? await call(auth, 'DELETE', '/capes/active') : await call(auth, 'PUT', '/capes/active', { json: { capeId: String(capeId) } }));
  }

  /** Removes a skin from the library (not from the account), and the outfits made of it. Returns the library. */
  function forget(id) {
    const list = load();
    const entry = list.find((e) => e.id === id);
    if (entry) {
      fs.rmSync(fileOf(entry.id), { force: true });
      save(list.filter((e) => e !== entry));
      const left = loadOutfits().filter((o) => o.skin !== entry.id);
      if (fs.existsSync(outfitsFile)) writeJson(outfitsFile, left);
    }
    return library();
  }

  /**
   * Zestawy: [{ id, name, skin, skinName, variant, cape, capeName, createdAt, dataUrl }] – the newest first.
   * An outfit whose skin left the library is not listed (forget() removes it together with the skin).
   */
  function outfits() {
    const list = load();
    return loadOutfits()
      .map((o) => ({ outfit: o, entry: list.find((e) => e.id === o.skin) }))
      .filter((x) => x.entry)
      .map(({ outfit: o, entry }) => ({ id: o.id, name: o.name, skin: o.skin, skinName: entry.name, variant: variantOf(o.variant), cape: o.cape ?? null, capeName: o.cape ? o.capeName || 'Peleryna' : null, createdAt: o.createdAt, dataUrl: dataUrl(fs.readFileSync(fileOf(entry.id))) }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Saves a look under a name: a skin of the library, the arm model and a cape of the account (null = none). */
  function saveOutfit({ name, skin, variant, cape = null, capeName = '' } = {}) {
    const title = cleanName(name);
    if (!title) throw new Error('Podaj nazwę zestawu, np. „Na PvP”.');
    const entry = load().find((e) => e.id === skin);
    if (!entry) throw new Error('Nie ma już tej skórki w bibliotece.');
    if (cape != null && !/^[\w-]{1,64}$/.test(String(cape))) throw new Error('Nieznana peleryna.');
    const list = loadOutfits();
    if (list.length >= MAX_OUTFITS) throw new Error(`Masz już ${MAX_OUTFITS} zestawów – usuń któryś, żeby zapisać nowy.`);
    if (list.some((o) => o.name.toLowerCase() === title.toLowerCase())) throw new Error(`Masz już zestaw „${title}”. Wybierz inną nazwę.`);
    list.push({ id: crypto.randomBytes(6).toString('hex'), name: title, skin: entry.id, variant: VARIANTS.includes(variant) ? variant : variantOf(entry.variant), cape: cape == null ? null : String(cape), capeName: cape == null ? '' : cleanName(capeName), createdAt: now() });
    fs.mkdirSync(dir, { recursive: true });
    writeJson(outfitsFile, list);
    return outfits();
  }

  function removeOutfit(id) {
    const list = loadOutfits();
    if (list.some((o) => o.id === id)) writeJson(outfitsFile, list.filter((o) => o.id !== id));
    return outfits();
  }

  /**
   * Puts a whole outfit on with the usual skin and cape calls – only the parts that differ from what the account
   * wears now are sent. Answers with the new state; when the skin went on but the cape did not (the account no
   * longer has it), the state carries `warning` with the reason.
   */
  async function applyOutfit(auth, id) {
    const outfit = loadOutfits().find((o) => o.id === id);
    if (!outfit) throw new Error('Nie ma już takiego zestawu – odśwież zakładkę.');
    const entry = load().find((e) => e.id === outfit.skin);
    if (!entry) throw new Error('Skórki z tego zestawu nie ma już w bibliotece.');
    let current = await state(auth);
    const model = variantOf(outfit.variant);
    if (current.skin?.libraryId !== entry.id || current.skin.variant !== model) current = await use(auth, entry.id, model);
    const worn = current.capes.find((c) => c.active)?.id ?? null;
    if ((outfit.cape ?? null) === worn) return current;
    try {
      return await setCape(auth, outfit.cape ?? null);
    } catch (err) {
      return { ...current, warning: `Skórka z zestawu jest założona, ale peleryny nie udało się zmienić: ${err.message}` };
    }
  }

  const library = () => load().map((e) => publicEntry(e, null));

  /** A file the player picked, checked before anything is sent: { name, dataUrl, legacy }. */
  const inspect = (png, name = '') => ({ name: cleanName(name) || 'Moja skórka', dataUrl: dataUrl(png), legacy: checkSkin(png).legacy });

  return { state, upload, use, reset, setCape, forget, library, inspect, outfits, saveOutfit, removeOutfit, applyOutfit };
}

module.exports = { createSkins, checkSkin, pngSize, fromDataUrl, apiError, API, MAX_LIBRARY, PLUS_LIBRARY, MAX_OUTFITS };
