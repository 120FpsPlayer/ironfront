'use strict';

/**
 * The full member list of a server, fetched once per Guild object. discord.js only caches the members it has
 * seen; features that compare against everyone (staff names, invite bookkeeping) call this on ready and when
 * the bot is added to a server, so Discord is asked once per server instead of once per feature. Later joins
 * and leaves arrive as events. A server the bot is removed from and added to again is a new Guild object
 * (only the bot cached), so it is fetched again – never answered from the old server's result.
 */

const loading = new WeakMap(); // Guild → Promise<boolean>

/** Resolves true when every member is cached, false when Discord refused (the next call tries again). */
function fetchAll(guild) {
  if (!loading.has(guild)) {
    const job = guild.members
      .fetch()
      .then(() => true)
      .catch((err) => {
        loading.delete(guild);
        console.warn(`[members] ${guild.name}: could not load the member list –`, err?.message ?? err);
        return false;
      });
    loading.set(guild, job);
  }
  return loading.get(guild);
}

/** Does the cache hold the whole server? Never conclude that someone left from a list that is still missing people. */
const complete = (guild) => guild.members.cache.size >= (guild.memberCount ?? 0);

module.exports = { fetchAll, complete };
