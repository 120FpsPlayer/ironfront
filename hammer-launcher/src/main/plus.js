'use strict';

/**
 * Hammer+ – the launcher's paid tier (looks and convenience only, nothing that changes the game). A player gets
 * it by pasting a signed code from the shop's Discord bot:
 *
 *   HP1.<payload>.<signature>
 *     payload    base64url (no padding) of {"id":"<16 hex>","mc":"<Minecraft UUID, 32 hex>","exp":<unix s, 0 = never>,"iat":<unix s>}
 *     signature  base64url (no padding) of the Ed25519 signature over the text "HP1.<payload>"
 *
 * The launcher checks a code by itself, without the network, with the public key from launcher.config.json
 * ("plusPublicKey"). A code counts when the signature is right, it has not expired and it was issued for the
 * selected Microsoft account. Codes live in plus.json in the launcher folder – one per Minecraft account, so
 * switching accounts switches Hammer+ with it. No Electron here.
 */

const crypto = require('node:crypto');
const { readJson, writeJson } = require('./store');

const PREFIX = 'HP1';
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex'); // the DER header in front of a raw Ed25519 key
const MAX_CODE = 1024;
const MAX_CODES = 8;

/** A Minecraft UUID the way codes carry it: 32 lowercase hex characters, no dashes. */
const cleanUuid = (id) => String(id ?? '').replace(/-/g, '').toLowerCase();

/** "3 grudnia 2026" from unix seconds. */
const day = (seconds) => new Date(seconds * 1000).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' });

/** The key object for "plusPublicKey" (base64 of the raw 32 bytes) – null when it is empty or not a key. */
function publicKey(base64) {
  const text = String(base64 ?? '').trim();
  if (!text || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(text)) return null;
  try {
    const raw = Buffer.from(text, 'base64');
    if (raw.length !== 32) return null;
    return crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' });
  } catch {
    return null;
  }
}

/**
 * Reads a pasted code: { code, payload, signature, id, mc, exp, iat } – null when it is not a Hammer+ code at all.
 * Spaces, line breaks and the quotes or backticks Discord puts around copied text are dropped first.
 */
function parseCode(text) {
  const code = String(text ?? '').replace(/[\s`'"„”]/g, '');
  if (!code || code.length > MAX_CODE) return null;
  const m = /^HP1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(code);
  if (!m) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const mc = cleanUuid(data.mc);
  if (!/^[0-9a-f]{32}$/.test(mc) || !Number.isInteger(data.exp) || data.exp < 0) return null;
  return { code, payload: m[1], signature: m[2], id: typeof data.id === 'string' ? data.id.slice(0, 32) : '', mc, exp: data.exp, iat: Number.isInteger(data.iat) ? data.iat : 0 };
}

/** Whether the signature of a parsed code is the shop's. */
function signedBy(parsed, key) {
  if (!parsed || !key) return false;
  try {
    const signature = Buffer.from(parsed.signature, 'base64url');
    return signature.length === 64 && crypto.verify(null, Buffer.from(`${PREFIX}.${parsed.payload}`), key, signature);
  } catch {
    return false;
  }
}

const expired = (parsed, nowMs) => parsed.exp !== 0 && parsed.exp * 1000 <= nowMs;
/** Sorts codes with the one that lasts longest first (exp 0 = never ends). */
const longestFirst = (a, b) => (b.exp === 0) - (a.exp === 0) || b.exp - a.exp;

/**
 * Checks a code without looking at accounts: { ok, reason: 'ok' | 'no-key' | 'invalid' | 'expired', code }.
 * `key` is the result of publicKey().
 */
function verifyCode(text, { key, now = Date.now() } = {}) {
  const code = parseCode(text);
  if (!key) return { ok: false, reason: 'no-key', code };
  if (!code || !signedBy(code, key)) return { ok: false, reason: 'invalid', code: null };
  if (expired(code, now)) return { ok: false, reason: 'expired', code };
  return { ok: true, reason: 'ok', code };
}

const HOW = 'Kod dostaniesz od bota HammerShop na Discordzie po zakupie w sklepie.';

/**
 * @param {object} o
 * @param {string} o.file          plus.json in the launcher folder
 * @param {string} o.publicKey     launcher.config.json → plusPublicKey
 * @param {() => ({ id, name } | null)} o.selected   the selected Microsoft account
 * @param {() => Array<{ id, name }>} [o.accounts]   every account in the launcher (for the nick in messages)
 */
function createPlus({ file, publicKey: keyText = '', selected = () => null, accounts = () => [], now = () => Date.now() }) {
  const key = publicKey(keyText);
  const load = () => {
    const list = readJson(file, {})?.codes;
    return Array.isArray(list) ? list.filter((c) => typeof c === 'string').slice(0, MAX_CODES) : [];
  };
  const save = (codes) => writeJson(file, { codes: codes.slice(0, MAX_CODES) });
  const nameOf = (mc) => accounts().find((a) => cleanUuid(a.id) === mc)?.name ?? null;

  /** The stored codes that carry the shop's signature, the one that lasts longest first. */
  function stored() {
    const parsed = load().map(parseCode);
    const good = parsed.filter((c) => signedBy(c, key)).sort(longestFirst);
    return { good, broken: parsed.length - good.length };
  }

  /**
   * Where Hammer+ stands for the selected account:
   * { active, until (unix seconds, 0 = never or not active), account ({ id, name } the code is for, or null),
   *   reason: 'ok' | 'none' | 'invalid' | 'expired' | 'wrong-account' | 'no-account' | 'no-key', text (Polish),
   *   configured (the launcher has a key), hasCode, codeId, selected ({ id, name } | null) }
   */
  function status() {
    const me = selected();
    const mine = me ? cleanUuid(me.id) : null;
    const base = { active: false, until: 0, account: null, reason: 'none', text: `Nie masz jeszcze Hammer+. ${HOW}`, configured: Boolean(key), hasCode: false, codeId: null, selected: me ? { id: me.id, name: me.name } : null };
    if (!key) return { ...base, reason: 'no-key', text: 'Ta wersja launchera nie ma jeszcze klucza Hammer+, więc kodu nie da się tu aktywować. Zaktualizuj launcher.' };
    const { good, broken } = stored();
    const code = good.find((c) => c.mc === mine && !expired(c, now())) ?? good.find((c) => c.mc === mine);
    if (code && !expired(code, now())) {
      return { ...base, active: true, until: code.exp, account: { id: me.id, name: me.name }, reason: 'ok', hasCode: true, codeId: code.id, text: code.exp ? `Hammer+ jest aktywny do ${day(code.exp)} na koncie ${me.name}.` : `Hammer+ jest aktywny bezterminowo na koncie ${me.name}.` };
    }
    if (code) {
      return { ...base, until: code.exp, account: { id: me.id, name: me.name }, reason: 'expired', hasCode: true, codeId: code.id, text: `Twój Hammer+ wygasł ${day(code.exp)}. Przedłuż go w sklepie – bot wyśle Ci nowy kod.` };
    }
    const other = good.find((c) => !expired(c, now())) ?? good[0];
    if (other) {
      const owner = nameOf(other.mc);
      const account = { id: other.mc, name: owner };
      if (!me) return { ...base, account, reason: 'no-account', hasCode: true, codeId: other.id, text: 'Masz zapisany kod Hammer+, ale nie jesteś zalogowany. Zaloguj się kontem Microsoft, dla którego jest ten kod.' };
      return {
        ...base,
        account,
        reason: 'wrong-account',
        hasCode: true,
        codeId: other.id,
        text: owner
          ? `Twój kod Hammer+ jest dla konta ${owner}, a teraz wybrane jest konto ${me.name}. Przełącz konto (lewy dolny róg), żeby korzystać z Hammer+.`
          : `Twój kod Hammer+ jest dla innego konta Minecraft niż ${me.name}. Zaloguj się kontem, dla którego został kupiony.`,
      };
    }
    if (broken) return { ...base, reason: 'invalid', hasCode: true, text: 'Zapisany kod Hammer+ jest nieprawidłowy. Usuń go i wklej kod od bota jeszcze raz.' };
    return base;
  }

  /**
   * Stores a pasted code and answers with the new status. A code that cannot work here is refused with a Polish
   * explanation. A code for another account of this launcher is kept – it starts working once that account is picked.
   */
  function activate(text) {
    if (!key) throw new Error(status().text);
    const code = parseCode(text);
    if (!code) throw new Error('To nie wygląda na kod Hammer+. Kod zaczyna się od „HP1.” – skopiuj go w całości z wiadomości bota.');
    if (!signedBy(code, key)) throw new Error('Ten kod jest nieprawidłowy. Mógł zostać ucięty przy kopiowaniu – skopiuj go jeszcze raz w całości.');
    if (expired(code, now())) throw new Error(`Ten kod wygasł ${day(code.exp)}. Przedłuż Hammer+ w sklepie – bot wyśle Ci nowy kod.`);
    const me = selected();
    if (!me) throw new Error('Najpierw zaloguj się kontem Microsoft – kod Hammer+ jest przypisany do konta Minecraft.');
    if (code.mc !== cleanUuid(me.id) && !nameOf(code.mc)) {
      throw new Error(`Ten kod jest dla innego konta Minecraft niż ${me.name}. Zaloguj się kontem, dla którego został kupiony, i wklej kod ponownie.`);
    }
    // One code per account – the one that lasts longest, so pasting an older code by mistake takes nothing away.
    const codes = load();
    const best = [code, ...codes.map(parseCode).filter((c) => c?.mc === code.mc && signedBy(c, key))].sort(longestFirst)[0];
    save([best.code, ...codes.filter((c) => parseCode(c)?.mc !== code.mc)]);
    return status();
  }

  /** Forgets the code the status talks about (the selected account's, else the one for another account). */
  function remove() {
    const st = status();
    const codes = load();
    const mc = st.account ? cleanUuid(st.account.id) : null;
    save(st.reason === 'invalid' || !mc ? codes.filter((c) => signedBy(parseCode(c), key)) : codes.filter((c) => parseCode(c)?.mc !== mc));
    return status();
  }

  /** The code of the selected account while it is active – what the shop API takes as the Bearer token. */
  function token() {
    const me = selected();
    const mine = me ? cleanUuid(me.id) : null;
    return stored().good.find((c) => c.mc === mine && !expired(c, now()))?.code ?? null;
  }

  /**
   * The gate of every Hammer+ feature in the main process: throws a Polish sentence unless Hammer+ is active.
   * `what` names the feature, e.g. "Własne tło launchera".
   */
  function need(what) {
    const st = status();
    if (st.active) return st;
    const why = st.reason === 'none' ? 'Włączysz go kodem ze sklepu – kliknij „Hammer+” na górnym pasku.' : st.text;
    throw new Error(`${what} to funkcja Hammer+. ${why}`);
  }

  /** The longest stored code of every account (also expired ones) – what the launcher asks the shop to renew. */
  function held() {
    const seen = new Set();
    return stored().good.filter((c) => !seen.has(c.mc) && seen.add(c.mc)).map((c) => c.code);
  }

  /**
   * Takes a code the shop handed out by itself (see services → refreshPlus): only for an account whose code is stored
   * already, only when it is genuine, still running and lasts longer than the stored one. → true when it was stored.
   */
  function adopt(text) {
    const code = parseCode(text);
    if (!code || !signedBy(code, key) || expired(code, now())) return false;
    const codes = load();
    const mine = codes.map(parseCode).filter((c) => c?.mc === code.mc && signedBy(c, key)).sort(longestFirst);
    if (!mine.length || longestFirst(code, mine[0]) >= 0) return false;
    save([code.code, ...codes.filter((c) => parseCode(c)?.mc !== code.mc)]);
    return true;
  }

  return { status, activate, remove, token, need, held, adopt, configured: Boolean(key) };
}

module.exports = { createPlus, parseCode, verifyCode, publicKey, cleanUuid, PREFIX };
