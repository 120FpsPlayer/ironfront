'use strict';

/**
 * The full member list of a server, fetched once per start. discord.js only caches the members it has
 * seen; features that compare against everyone (staff names, invite bookkeeping) call this on ready, so
 * Discord is asked once per server instead of once per feature. Later joins and leaves arrive as events.
 */

const loading = new Map();

/** Resolves true when every member is cached, false when Discord refused (the next call tries again). */
function fetchAll(guild) {
  if (!loading.has(guild.id)) {
    const job = guild.members
      .fetch()
      .then(() => true)
      .catch((err) => {
        loading.delete(guild.id);
        console.warn(`[members] ${guild.name}: could not load the member list –`, err?.message ?? err);
        return false;
      });
    loading.set(guild.id, job);
  }
  return loading.get(guild.id);
}

module.exports = { fetchAll };
