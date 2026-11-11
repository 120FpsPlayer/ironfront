'use strict';

/**
 * Hammer+ – codes for the paid tier of Hammer Launcher, issued by the team with /hammerplus (src/commands/hammerplus.js).
 *
 * A code is signed for one Minecraft account (src/lib/plus.js): the nick is looked up at Mojang, the code is made, and
 * what was issued is written down – never the code itself, so the database holds nothing that works as a code:
 *
 *   db.guild(id).plusCodes = [{ id, mc, nick, exp, by, at }]
 *     id – the code's own ID (16 hex) · mc – the Minecraft UUID (32 hex) · nick – as Mojang spells it
 *     exp – unix seconds, 0 = never expires · by – the staff member's user ID · at – when it was issued (ms)
 *
 * The launcher checks codes offline, so a code can't be taken back – it stops working when it expires.
 */

const { env } = require('../env');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const plus = require('../lib/plus');
const { UserError, truncate, ts } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');

const MOJANG = 'https://api.mojang.com/users/profiles/minecraft/';
const NICK = /^[A-Za-z0-9_]{1,16}$/;
const TIMEOUT = 8_000;
const KEEP = 2000; // issued codes remembered per server
const MAX_DAYS = 3650;

const NO_CONNECTION = 'Nie udało się połączyć z Mojang, żeby sprawdzić ten nick – żaden kod nie został wystawiony. Spróbuj ponownie za chwilę.';
const unknownNick = (nick) => `Nie ma konta Minecraft o nicku **${nick}**. Sprawdź pisownię – Hammer+ działa na kontach premium (Java Edition).`;

/** Tests put their own fetch here (no network there); the bot uses the real one. */
let fetcher = null;
const setFetch = (fn) => (fetcher = fn ?? null);

/** What to do when the signing key is missing or broken – for every /hammerplus answer that needs it. */
function setupHelp() {
  const broken = plus.status() === 'invalid';
  return (
    `${broken ? '`HAMMER_PLUS_PRIVATE_KEY` w pliku `.env` jest nieprawidłowy – to musi być klucz Ed25519 (base64 z PKCS#8 DER).' : 'Hammer+ nie jest jeszcze skonfigurowany – w pliku `.env` brakuje klucza, którym bot podpisuje kody.'}\n` +
    '1. Uruchom w folderze bota `npm run plus-key` – wypisze gotową linię z nowym kluczem.\n' +
    '2. Wklej ją do `.env`: `HAMMER_PLUS_PRIVATE_KEY=…` (nikomu jej nie pokazuj) i uruchom bota ponownie.\n' +
    `3. \`${slash('hammerplus key')}\` pokaże wtedy klucz publiczny, który wpisujesz w Hammer Launcherze.`
  );
}

/** Throws the setup instructions when codes can't be signed. */
function requireKey() {
  if (!plus.ready()) throw new UserError(setupHelp());
}

/** "na zawsze" / "do <date> (<in 3 days>)" – how long a code works. */
const validity = (exp) => (exp === 0 ? 'na zawsze' : `do ${ts(exp * 1000, 'f')} (${ts(exp * 1000, 'R')})`);
const expired = (exp, now = Date.now()) => exp !== 0 && Math.floor(now / 1000) >= exp;

/**
 * A Minecraft nick → { mc (32 hex), nick (Mojang's spelling) }. Throws a UserError when there is no such account or
 * Mojang can't be reached. fetchFn: the fetch to use (default: the real one).
 */
async function lookup(nick, fetchFn = fetcher ?? globalThis.fetch) {
  const name = String(nick ?? '').trim();
  if (!NICK.test(name)) throw new UserError('Nick Minecraft ma najwyżej 16 znaków: litery, cyfry i podkreślenie (_).');
  let res;
  try {
    res = await fetchFn(`${MOJANG}${encodeURIComponent(name)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    throw new UserError(NO_CONNECTION);
  }
  if (res.status === 404 || res.status === 204) throw new UserError(unknownNick(name));
  if (res.status === 429) throw new UserError('Mojang chwilowo ogranicza liczbę zapytań – żaden kod nie został wystawiony. Spróbuj ponownie za minutę.');
  if (!res.ok) throw new UserError(NO_CONNECTION);
  const body = await res.json().catch(() => null);
  const mc = plus.normalizeUuid(body?.id);
  if (!mc) throw new UserError(NO_CONNECTION);
  return { mc, nick: typeof body.name === 'string' && NICK.test(body.name) ? body.name : name };
}

const codes = (guildId) => db.guild(guildId).plusCodes;
const find = (guildId, id) => codes(guildId).find((c) => c.id === id) ?? null;
/** The newest first. */
const recent = (guildId, limit = 15) => [...codes(guildId)].sort((a, b) => b.at - a.at).slice(0, limit);

/**
 * Issues a Hammer+ code for the account behind nick and writes down who got it. → { code, record }.
 * days: 0 = never expires. by: the staff member's user ID.
 */
async function grant(guildId, { nick, days, by, now = Date.now() }) {
  requireKey();
  if (!Number.isInteger(days) || days < 0 || days > MAX_DAYS) throw new UserError(`Podaj liczbę dni od 0 (na zawsze) do ${MAX_DAYS}.`);
  const account = await lookup(nick);
  let code;
  let payload;
  try {
    code = plus.issue({ mc: account.mc, days, now });
    payload = plus.verify(code, { now });
  } catch (err) {
    throw err instanceof plus.PlusError ? new UserError(err.message) : err;
  }
  const record = { id: payload.id, mc: payload.mc, nick: account.nick, exp: payload.exp, by: by ?? null, at: now };
  const g = db.guild(guildId);
  g.plusCodes = [...g.plusCodes, record].slice(-KEEP);
  db.save();
  return { code, record };
}

/**
 * Whose code is it and does it work? → { valid, payload, record, message }
 *   valid – signed by our key and not expired · payload – { id, mc, exp, iat } (also for an expired code)
 *   record – what this server wrote down when it issued it (null: issued elsewhere with the same key)
 *   message – why it doesn't work (Polish)
 */
function inspect(guildId, code, now = Date.now()) {
  requireKey();
  const text = String(code ?? '').replace(/[`\s]/g, ''); // pasted with its code block or a line break
  try {
    const payload = plus.verify(text, { now });
    return { valid: true, payload, record: find(guildId, payload.id), message: null };
  } catch (err) {
    if (!(err instanceof plus.PlusError)) throw err;
    return { valid: false, payload: err.payload, record: err.payload ? find(guildId, err.payload.id) : null, message: err.message };
  }
}

/** One line of /hammerplus list: "🟢 `Notch` · na zawsze · wystawiony przez <@1> · 2 dni temu". */
function line(record, now = Date.now()) {
  const gone = expired(record.exp, now);
  return `${gone ? '⌛' : '🟢'} \`${truncate(record.nick, 20)}\` · ${gone ? `wygasł ${ts(record.exp * 1000, 'R')}` : validity(record.exp)} · wystawiony przez ${record.by ? `<@${record.by}>` : 'bota'} · ${ts(record.at, 'R')}`;
}

hooks.on('ready', () => {
  if (env.plusPrivateKey && !plus.ready()) console.warn('🔨 Hammer+: HAMMER_PLUS_PRIVATE_KEY w .env jest nieprawidłowy (potrzebny klucz Ed25519: base64 z PKCS#8 DER) – wygeneruj nowy: npm run plus-key');
});

module.exports = { lookup, grant, inspect, codes, find, recent, line, validity, expired, setupHelp, requireKey, setFetch, MAX_DAYS };
