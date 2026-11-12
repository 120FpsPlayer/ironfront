'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { RateLimitError } = require('discord.js');
const db = require('../lib/db');
const panels = require('../lib/panels');
const { ASSETS, EMOJI_PRIORITY, emojiName } = require('../lib/theme');
const { slash } = require('../lib/commandsPl');

/** Static emoji slots per boost level. */
const SLOTS = { 0: 50, 1: 100, 2: 150, 3: 250 };

/** The emojis are the same on every server – except the few the Hammer Launcher server draws its own way (its logo: the H). */
function fileFor(name) {
  const own = require('../lib/profile').launcher ? path.join(ASSETS, 'emojis-launcher', `${name}.png`) : null;
  return own && fs.existsSync(own) ? own : path.join(ASSETS, 'emojis', `${name}.png`);
}

/** Emoji name prefixes of earlier versions – their emojis are replaced by the current ones. */
const LEGACY_PREFIXES = ['nox_'];
/** Emoji keys of earlier versions that are gone now (nox → logo). */
const RETIRED = ['nox'];

const artCache = new Map();
/** Short hash of an emoji picture – a new picture (e.g. a new colour) means the uploaded emoji is replaced. */
function artOf(name) {
  if (!artCache.has(name)) {
    const file = fileFor(name);
    artCache.set(name, fs.existsSync(file) ? crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12) : null);
  }
  return artCache.get(name);
}

/**
 * Emojis this bot uploaded that are out of date: another name (an older prefix like :nox_cart:), a picture that has
 * changed since, or a key that no longer exists. Emojis with an older prefix count too when the bot's data was lost.
 * Emojis people uploaded themselves are never touched.
 */
function outdatedEmojis(guild, existing) {
  const prefix = emojiName('');
  const known = new Set([...EMOJI_PRIORITY, ...RETIRED]);
  const art = db.emojiArt(guild.id);
  const out = new Map();
  for (const [name, id] of Object.entries(db.emojiIds(guild.id))) {
    const em = existing.get(id);
    if (!em) continue;
    const stale = !EMOJI_PRIORITY.includes(name) || em.name !== emojiName(name) || (art[name] && artOf(name) && art[name] !== artOf(name));
    if (stale) out.set(em.id, { em, name });
  }
  for (const em of existing.values()) {
    const legacy = LEGACY_PREFIXES.find((p) => p !== prefix && em.name?.startsWith(p));
    if (legacy && known.has(em.name.slice(legacy.length))) out.set(em.id, { em, name: null });
  }
  return [...out.values()];
}

/**
 * Uploads the HammerShop emojis that are missing (most important first) and remembers their IDs.
 * Existing :hs_*: emojis are reused, so running it again only fills the gaps.
 * Stops gracefully when the server is full or Discord rate-limits emoji uploads.
 */
async function syncEmojis(guild, { reason = 'Konfiguracja HammerShop', onProgress = () => {}, shouldAbort = () => false } = {}) {
  const result = { reused: 0, uploaded: 0, replaced: 0, missing: [], stopped: null, errors: [] };
  const existing = await guild.emojis.fetch();

  // Old emojis of this bot (older colours / names) make room for the current ones.
  for (const { em, name } of outdatedEmojis(guild, existing)) {
    if (shouldAbort()) break;
    try {
      await em.delete(reason);
      existing.delete(em.id);
      if (name) db.setEmoji(guild.id, name, null);
      result.replaced += 1;
    } catch (err) {
      result.errors.push(`usuwanie :${em.name}: – ${err.message}`);
    }
  }
  for (const name of RETIRED) if (db.emojiIds(guild.id)[name]) db.setEmoji(guild.id, name, null);
  const byName = new Map([...existing.values()].map((em) => [em.name, em]));

  for (const name of EMOJI_PRIORITY) {
    const em = byName.get(emojiName(name));
    if (em) {
      db.setEmoji(guild.id, name, em.id, db.emojiArt(guild.id)[name] ?? undefined);
      result.reused += 1;
    } else {
      db.setEmoji(guild.id, name, null);
    }
  }

  const limit = SLOTS[guild.premiumTier] ?? 50;
  let used = [...existing.values()].filter((em) => !em.animated).length;
  const todo = EMOJI_PRIORITY.filter((name) => !byName.has(emojiName(name)) && fs.existsSync(fileFor(name)));

  for (let i = 0; i < todo.length; i += 1) {
    const name = todo[i];
    if (shouldAbort()) {
      result.missing.push(...todo.slice(i));
      result.stopped = 'aborted';
      break;
    }
    if (used >= limit) {
      result.missing.push(...todo.slice(i));
      result.stopped = 'full';
      break;
    }
    try {
      const em = await guild.emojis.create({ attachment: fileFor(name), name: emojiName(name), reason });
      db.setEmoji(guild.id, name, em.id, artOf(name));
      result.uploaded += 1;
      used += 1;
    } catch (err) {
      if (err instanceof RateLimitError || err?.name === 'RateLimitError') {
        result.missing.push(...todo.slice(i));
        result.stopped = 'ratelimit';
        break;
      }
      if (err?.code === 30008) {
        result.missing.push(...todo.slice(i));
        result.stopped = 'full';
        break;
      }
      result.errors.push(`${name}: ${err.message}`);
      result.missing.push(name);
    }
    onProgress(name);
  }
  return result;
}

function describeEmojiResult(r) {
  const parts = [`wgrane: ${r.uploaded}`, `już były: ${r.reused}`];
  if (r.replaced) parts.push(`stare emotki zamienione na nowy wygląd: ${r.replaced}`);
  if (r.missing.length) {
    const why = {
      full: 'serwer nie ma wolnych miejsc na emotki (50 bez boostów)',
      ratelimit: 'Discord ogranicza tempo wgrywania emotek',
      aborted: 'budowa została zatrzymana',
    }[r.stopped] ?? 'części emotek nie udało się wgrać';
    parts.push(`niewgrane: ${r.missing.length} – ${why}. Użyj później \`${slash('build')} tylko:emojis\`, żeby dodać resztę`);
  }
  return parts.join(' · ');
}

/**
 * A HammerShop emoji was deleted, or became (un)available after a boost change: forget deleted ones and
 * redraw the live panels, so buttons switch to the Unicode fallback (or back to the custom emoji).
 */
function onEmojiChange(emoji) {
  const guild = emoji?.guild;
  if (!guild) return false;
  const names = Object.entries(db.emojiIds(guild.id)).filter(([, id]) => id === emoji.id).map(([name]) => name);
  if (!names.length) return false;
  if (!guild.emojis.cache.has(emoji.id)) for (const name of names) db.setEmoji(guild.id, name, null);
  for (const kind of new Set(db.panels(guild.id).map((p) => p.kind ?? 'tickets'))) panels.schedule(guild, kind);
  return true;
}

module.exports = { SLOTS, LEGACY_PREFIXES, syncEmojis, describeEmojiResult, onEmojiChange, artOf };
