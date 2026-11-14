'use strict';

/**
 * The launcher's part of the HammerShop website API. Hammer+ only – the code is the Bearer token:
 *
 *   GET  <base>/cloud                      → { updatedAt, data }        404 = nothing stored yet
 *   PUT  <base>/cloud  { data, baseUpdatedAt? }  → { updatedAt }        409 → { error, updatedAt, data } (a newer copy)
 *   PUT  <base>/cape   { cape: "<id>" | null, cosmetics?: { wings, halo, hat } }   → { cape, cosmetics? }
 *
 * and for everybody, without a code:
 *
 *   GET  <base>/featured                   → { servers: [{ id, name, address, description, tags, icon, mc, loader, pack }] }
 *   GET  <base>/news                       → { news: [...], alert: {...} | null, release: {...} | null }   (news.js)
 *
 * base = <shopApi or website from launcher.config.json>/api/launcher. Errors come as { error: "<Polish text>" }.
 * The shop may not be online (yet): no answer, a server error or a page that is not this API all end in one
 * friendly ShopError with `offline: true` – callers show its text and carry on, nothing here ever blocks a start.
 * Every request says which launcher asks: User-Agent "Hammer-Launcher/<version> (hammershop.pl)" – the shop
 * counts launcher starts per version from it.
 */

const { userAgent } = require('./net');

const OFFLINE_NOTE = 'Chmura zadziała, gdy sklep HammerShop będzie online.';
const MAX_BODY = 256 * 1024; // what PUT /cloud accepts
const MAX_ANSWER = 1024 * 1024; // more than any answer of this API – a bigger one is not this API

class ShopError extends Error {
  constructor(message, { offline = false, status = 0, conflict = null } = {}) {
    super(message);
    this.name = 'ShopError';
    this.offline = offline;
    this.status = status;
    this.conflict = conflict; // 409: { updatedAt, data } – the copy that is in the cloud now
  }
}

/** "<shopApi or website>/api/launcher" – '' unless it is https (plain http only for a shop on this computer). */
function apiBase(config = {}) {
  const site = String(config.shopApi || config.website || '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^\s/]+/.test(site) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(site) ? `${site}/api/launcher` : '';
}

function createShopApi({ config = {}, fetchFn = (...a) => fetch(...a), timeoutMs = 8000, version }) {
  const base = () => apiBase(config);
  const agent = userAgent(version); // `version` is the running launcher's (app.getVersion()); without it: package.json
  const offline = (status = 0) => new ShopError(OFFLINE_NOTE, { offline: true, status });

  /**
   * One request: { status, body } – body is the JSON object of the answer. A server error, a missing route and a
   * page that does not speak this API (a parked domain, a placeholder site) all count as "not online".
   * `missing` is what a 404 with a JSON body means for this call: true = "nothing there yet", a normal answer.
   * `open` marks a public route: it is asked without a code (and no code is ever sent to it).
   */
  async function call(method, pathname, code, json, { missing = false, open = false, headers = {} } = {}) {
    const root = base();
    if (!root || (!code && !open)) throw offline();
    let res;
    let body = null;
    try {
      res = await fetchFn(root + pathname, {
        method,
        headers: { ...(open ? {} : { authorization: `Bearer ${code}` }), accept: 'application/json', 'user-agent': agent, ...(json ? { 'content-type': 'application/json' } : {}), ...headers },
        body: json ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      const parsed = text.length <= MAX_ANSWER ? JSON.parse(text) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
    } catch {
      if (!res) throw offline(); // no connection, no such host, no answer in time
    }
    if (res.status >= 500 || !body || (res.status === 404 && !missing)) throw offline(res.status);
    return { status: res.status, body };
  }

  /** What the shop says about a refusal – its own Polish text when it sent one. */
  function refusal(status, body, fallback) {
    const said = typeof body?.error === 'string' && body.error.trim() ? body.error.trim().replace(/\s+/g, ' ').slice(0, 240) : null;
    if (said) return new ShopError(said, { status });
    if (status === 401 || status === 403) return new ShopError('Sklep nie przyjął Twojego kodu Hammer+. Jeśli kod jest aktualny, napisz do nas na Discordzie.', { status });
    if (status === 413) return new ShopError('Ta kopia jest za duża dla chmury (limit to 256 KB).', { status });
    if (status === 429) return new ShopError('Za dużo prób w krótkim czasie – odczekaj chwilę i spróbuj ponownie.', { status });
    return new ShopError(`${fallback} (błąd ${status}).`, { status });
  }

  /** The copy stored for this account: { updatedAt, data } – null when nothing was sent yet. */
  async function getCloud(code) {
    const { status, body } = await call('GET', '/cloud', code, null, { missing: true });
    if (status === 404) return null;
    if (status !== 200) throw refusal(status, body, 'Nie udało się pobrać kopii z chmury');
    if (body.updatedAt == null || !body.data || typeof body.data !== 'object') throw offline(status);
    return { updatedAt: body.updatedAt, data: body.data };
  }

  /**
   * Stores a copy: { updatedAt }. `baseUpdatedAt` is the copy this one is based on; when the cloud holds a newer
   * one the shop answers 409 and the error carries it in `conflict`.
   */
  async function putCloud(code, { data, baseUpdatedAt }) {
    const payload = { data, ...(baseUpdatedAt != null ? { baseUpdatedAt } : {}) };
    if (Buffer.byteLength(JSON.stringify(payload)) > MAX_BODY) throw new ShopError('Ta kopia jest za duża dla chmury (limit to 256 KB).', { status: 413 });
    const { status, body } = await call('PUT', '/cloud', code, payload);
    if (status === 409) throw new ShopError(typeof body.error === 'string' ? body.error : 'W chmurze jest nowsza kopia.', { status, conflict: { updatedAt: body.updatedAt ?? null, data: body.data && typeof body.data === 'object' ? body.data : null } });
    if (status !== 200 && status !== 201) throw refusal(status, body, 'Nie udało się wysłać kopii do chmury');
    if (body.updatedAt == null) throw offline(status);
    return { updatedAt: body.updatedAt };
  }

  /**
   * Tells the shop which Hammer+ cape the player wears (null = none), so other players' games can show it – and,
   * when given, the cosmetics (Dodatki na postać: { wings, halo, hat }, ids or null; null = none).
   */
  async function putCape(code, cape, cosmetics) {
    const look = cosmetics === undefined ? {} : { cosmetics: cosmetics ? { wings: cosmetics.wings || null, halo: cosmetics.halo === true, hat: cosmetics.hat || null } : null };
    const { status, body } = await call('PUT', '/cape', code, { cape: cape || null, ...look });
    if (status !== 200 && status !== 201) throw refusal(status, body, 'Nie udało się zapisać peleryny w sklepie');
    return { cape: typeof body.cape === 'string' ? body.cape : null };
  }

  /**
   * The same for a free cape, without Hammer+: the account proves who it is with its own Minecraft sign-in (the
   * shop asks Mojang whose token it is and forgets the token right away).
   */
  async function putFreeCape(minecraftToken, cape) {
    const { status, body } = await call('PUT', '/cape', null, { cape: cape || null }, { open: true, headers: { 'x-minecraft-token': String(minecraftToken ?? '') } });
    if (status !== 200 && status !== 201) throw refusal(status, body, 'Nie udało się zapisać peleryny w sklepie');
    return { cape: typeof body.cape === 'string' ? body.cape : null };
  }

  /**
   * The servers the shop recommends – the raw list of the answer (featured.js checks every field of it).
   * Public: asked without a code. Throws the "not online" ShopError when the shop does not answer with a list.
   */
  async function getFeatured() {
    const { status, body } = await call('GET', '/featured', null, null, { open: true });
    if (status !== 200 || !Array.isArray(body.servers)) throw offline(status);
    return body.servers;
  }

  /**
   * Aktualności, the message bar and the newest launcher version – the raw answer (news.js checks every field).
   * Public: asked without a code. Throws the "not online" ShopError when the shop does not answer with this API.
   */
  async function getNews() {
    const { status, body } = await call('GET', '/news', null, null, { open: true });
    if (status !== 200) throw offline(status);
    return body;
  }

  /**
   * A longer Hammer+ code for the account of `code` – a renewal bought on the website or a referral reward, issued
   * after the code the launcher holds. The shop answers with the very code from the bot's DM, or null when there is
   * none. An expired code still counts: it proves which account it is. → { code, until } | null (refused).
   */
  async function freshPlus(code) {
    const { status, body } = await call('GET', '/plus', code, null, { missing: true });
    if (status !== 200) return null;
    return { code: typeof body.code === 'string' ? body.code.slice(0, 1000) : null, until: Number.isInteger(body.until) ? body.until : null };
  }

  return { base, getCloud, putCloud, putCape, putFreeCape, getFeatured, getNews, freshPlus };
}

module.exports = { createShopApi, apiBase, ShopError, OFFLINE_NOTE, MAX_BODY };
