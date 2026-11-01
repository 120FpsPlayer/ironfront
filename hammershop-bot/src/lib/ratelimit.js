'use strict';

const longestWait = (data) => Math.max(data.timeToReset ?? 0, data.retryAfter ?? 0, data.sublimitTimeout ?? 0);

/**
 * Which rate limits discord.js turns into an error instead of silently waiting. Long waits on emoji
 * uploads and channel edits would freeze a button for minutes, so the bot reports them instead.
 * Channel renames (2 per 10 minutes) are a "sublimit": the bucket itself looks fine (short
 * timeToReset) while retryAfter / sublimitTimeout are long – so all three are checked.
 */
function rejectOnRateLimit(data) {
  if (longestWait(data) <= 15_000) return false;
  return data.route.includes('/emojis') || (String(data.method).toUpperCase() === 'PATCH' && data.route.startsWith('/channels/'));
}

/** Whole minutes until a rate limit error clears (at least 1). */
const rateLimitMinutes = (err) => Math.max(1, Math.ceil(longestWait(err) / 60_000));

module.exports = { rejectOnRateLimit, rateLimitMinutes };
