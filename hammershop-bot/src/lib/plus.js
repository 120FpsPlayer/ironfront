'use strict';

/**
 * Hammer+ codes – the paid tier of Hammer Launcher. The bot signs a code for one Minecraft account, the player pastes
 * it into the launcher, and the launcher checks the signature offline with the public key it ships. The same code is
 * the password for the launcher's online features on the website (src/web/launcher.js).
 *
 *   HP1.<payload>.<signature>
 *   payload    base64url (no padding) of the JSON {"id":"<16 hex>","mc":"<32 lowercase hex, no dashes>","exp":<unix
 *              seconds, 0 = never>,"iat":<unix seconds>}
 *   signature  base64url (no padding) of the Ed25519 signature over the ASCII text "HP1.<payload>"
 *
 * The private key comes from .env: HAMMER_PLUS_PRIVATE_KEY = base64 of the PKCS#8 DER key (npm run plus-key makes one).
 * The public key for the launcher (/hammerplus key) = base64 of the raw 32 bytes. Nothing here touches Discord or
 * the database – times are passed in (now, in milliseconds) so it can be tested.
 */

const crypto = require('node:crypto');
const { env } = require('../env');

const PREFIX = 'HP1';
const DAY = 86_400; // seconds
const MAX_DAYS = 36_500;
const MAX_LENGTH = 1024; // a real code has about 240 characters
const B64URL = /^[A-Za-z0-9_-]+$/;
const ID = /^[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{32}$/;
const ANY_UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * Why a code can't be issued or isn't accepted – the message is in Polish and safe to show.
 * reason: 'nokey' | 'input' | 'malformed' | 'signature' | 'expired'; payload – what an expired code says (it was ours).
 */
class PlusError extends Error {
  constructor(message, reason, payload = null) {
    super(message);
    this.name = 'PlusError';
    this.reason = reason;
    this.payload = payload;
  }
}

const NO_KEY = 'Hammer+ nie jest jeszcze skonfigurowany – brakuje klucza podpisu (HAMMER_PLUS_PRIVATE_KEY).';
const MALFORMED = 'To nie jest kod Hammer+. Kod zaczyna się od „HP1.” – wklej go w całości, bez spacji.';
const BAD_SIGNATURE = 'Ten kod Hammer+ jest nieprawidłowy – podpis się nie zgadza (kod został zmieniony albo nie pochodzi z HammerShop).';
const EXPIRED = 'Ten kod Hammer+ już wygasł.';

// ───────────── The key ─────────────
let cached = { raw: null, pair: null };

/** { privateKey, publicKey } from .env – null when the key is missing or isn't an Ed25519 PKCS#8 key. */
function keys() {
  const raw = env.plusPrivateKey || '';
  if (cached.raw !== raw) {
    let pair = null;
    try {
      // A PEM pasted on one line works too: its body is the same base64.
      const der = Buffer.from(raw.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''), 'base64');
      const privateKey = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
      if (privateKey.asymmetricKeyType === 'ed25519') pair = { privateKey, publicKey: crypto.createPublicKey(privateKey) };
    } catch {
      pair = null;
    }
    cached = { raw, pair };
  }
  return cached.pair;
}

/** 'ready' | 'missing' (nothing in .env) | 'invalid' (set, but not an Ed25519 PKCS#8 key). */
const status = () => (keys() ? 'ready' : env.plusPrivateKey ? 'invalid' : 'missing');
/** The signing key is configured – codes can be issued and checked. */
const ready = () => Boolean(keys());

/** The public key the launcher ships: base64 of the raw 32 bytes (the end of the SPKI DER). null without a key. */
function publicKey() {
  const pair = keys();
  return pair ? pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') : null;
}

// ───────────── Codes ─────────────
/** A Minecraft UUID in any spelling (dashes, capitals) → 32 lowercase hex characters; null when it isn't one. */
function normalizeUuid(value) {
  const s = String(value ?? '').trim();
  return ANY_UUID.test(s) ? s.replace(/-/g, '').toLowerCase() : null;
}

/** A new code for the Minecraft account mc, valid for days (0 = never expires). → the code. */
function issue({ mc, days = 0, now = Date.now() } = {}) {
  const pair = keys();
  if (!pair) throw new PlusError(NO_KEY, 'nokey');
  const uuid = normalizeUuid(mc);
  if (!uuid) throw new PlusError('Nieprawidłowe konto Minecraft – UUID ma 32 znaki szesnastkowe.', 'input');
  if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) throw new PlusError(`Liczba dni musi być liczbą całkowitą od 0 (na zawsze) do ${MAX_DAYS}.`, 'input');
  const iat = Math.floor(now / 1000);
  // The key order is part of the format.
  const json = JSON.stringify({ id: crypto.randomBytes(8).toString('hex'), mc: uuid, exp: days ? iat + days * DAY : 0, iat });
  const signed = `${PREFIX}.${Buffer.from(json, 'utf8').toString('base64url')}`;
  return `${signed}.${crypto.sign(null, Buffer.from(signed, 'ascii'), pair.privateKey).toString('base64url')}`;
}

const isTime = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Checks a code with the configured key → its payload { id, mc, exp, iat }. Throws a PlusError (Polish message) when
 * it is not a code, the signature is wrong or it has expired (then err.payload says whose it was).
 */
function verify(code, { now = Date.now() } = {}) {
  const pair = keys();
  if (!pair) throw new PlusError(NO_KEY, 'nokey');
  const text = typeof code === 'string' ? code.trim() : '';
  const parts = text.split('.');
  if (!text || text.length > MAX_LENGTH || parts.length !== 3 || parts[0] !== PREFIX || !B64URL.test(parts[1]) || !B64URL.test(parts[2])) throw new PlusError(MALFORMED, 'malformed');
  const signature = Buffer.from(parts[2], 'base64url');
  if (signature.length !== 64 || !crypto.verify(null, Buffer.from(`${PREFIX}.${parts[1]}`, 'ascii'), pair.publicKey, signature)) throw new PlusError(BAD_SIGNATURE, 'signature');
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new PlusError(MALFORMED, 'malformed');
  }
  const hex = (value, pattern) => typeof value === 'string' && pattern.test(value);
  if (!payload || typeof payload !== 'object' || !hex(payload.id, ID) || !hex(payload.mc, UUID) || !isTime(payload.exp) || !isTime(payload.iat)) throw new PlusError(MALFORMED, 'malformed');
  const clean = { id: payload.id, mc: payload.mc, exp: payload.exp, iat: payload.iat };
  if (clean.exp !== 0 && Math.floor(now / 1000) >= clean.exp) throw new PlusError(EXPIRED, 'expired', clean);
  return clean;
}

module.exports = { PlusError, ready, status, issue, verify, publicKey, normalizeUuid, MAX_DAYS };
