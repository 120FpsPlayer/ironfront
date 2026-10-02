'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { RateLimitError } = require('discord.js');
const db = require('../lib/db');
const { ASSETS, EMOJI_PRIORITY, emojiName } = require('../lib/theme');

/** Static emoji slots per boost level. */
const SLOTS = { 0: 50, 1: 100, 2: 150, 3: 250 };

const fileFor = (name) => path.join(ASSETS, 'emojis', `${name}.png`);

/**
 * Uploads the NØX emojis that are missing (most important first) and remembers their IDs.
 * Existing :nox_*: emojis are reused, so running it again only fills the gaps.
 * Stops gracefully when the server is full or Discord rate-limits emoji uploads.
 */
async function syncEmojis(guild, { reason = 'NØX setup', onProgress = () => {}, shouldAbort = () => false } = {}) {
  const result = { reused: 0, uploaded: 0, missing: [], stopped: null, errors: [] };
  const existing = await guild.emojis.fetch();
  const byName = new Map([...existing.values()].map((em) => [em.name, em]));

  for (const name of EMOJI_PRIORITY) {
    const em = byName.get(emojiName(name));
    if (em) {
      db.setEmoji(guild.id, name, em.id);
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
      db.setEmoji(guild.id, name, em.id);
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
  const parts = [`${r.uploaded} uploaded`, `${r.reused} already there`];
  if (r.missing.length) {
    const why = {
      full: 'the server has no free emoji slots (50 without boosts)',
      ratelimit: 'Discord limits how fast emojis can be uploaded',
      aborted: 'the build was stopped',
    }[r.stopped] ?? 'some uploads failed';
    parts.push(`${r.missing.length} not uploaded – ${why}. Run \`/build only:emojis\` later to add the rest`);
  }
  return parts.join(' · ');
}

module.exports = { SLOTS, syncEmojis, describeEmojiResult };
