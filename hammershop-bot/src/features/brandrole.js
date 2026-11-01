'use strict';

/**
 * The bot's own role (layout.js → key "brand", "🔨 HammerShop"): the highest role of the server, hoisted, so the bot
 * is listed first in the member list. It belongs to the bot alone – anyone else who gets it loses it right away.
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');

const brandRoleId = (guild) => db.roleId(guild.id, 'brand');

/** The bot's highest role apart from the brand role – normally its integration role. */
function topOwnRole(me, brandId) {
  let top = null;
  for (const r of me.roles.cache.values()) {
    if (r.id === brandId || r.id === me.guild?.id || typeof r.position !== 'number') continue;
    if (!top || r.position > top.position) top = r;
  }
  return top;
}

/**
 * Puts the brand role right under the bot's own role (the highest place the bot can give it), gives it to the bot
 * and takes it away from everyone else.
 * @returns {Promise<{ moved: boolean, given: boolean, removed: number }>}
 */
async function ensureBrandRole(guild, { reason = `${config.brand.name} – własna rola bota` } = {}) {
  const res = { moved: false, given: false, removed: 0 };
  const id = brandRoleId(guild);
  const role = id ? guild.roles.cache.get(id) : null;
  const me = guild.members.me ?? (await guild.members.fetchMe?.().catch(() => null));
  if (!role || !me) return res;

  const top = topOwnRole(me, role.id);
  if (top && role.position !== top.position - 1) {
    // Every role under the bot's own, top → bottom, with the brand role first – Discord wants the whole new order.
    const below = [...guild.roles.cache.values()]
      .filter((r) => r.id !== guild.id && r.id !== role.id && r.position < top.position)
      .sort((a, b) => b.position - a.position);
    const order = [role, ...below];
    const changes = order.map((r, i) => ({ role: r.id, position: top.position - 1 - i })).filter((c, i) => order[i].position !== c.position && c.position > 0);
    if (changes.length) {
      await guild.roles.setPositions(changes);
      res.moved = true;
    }
  }
  if (!me.roles.cache.has(role.id)) {
    await me.roles.add(role.id, reason);
    res.given = true;
  }
  for (const member of guild.members.cache.values()) {
    if (member.id === me.id || !member.roles.cache.has(role.id)) continue;
    await member.roles.remove(role.id, `Tylko bot ${config.brand.name} ma tę rolę`).catch(() => null);
    res.removed += 1;
  }
  return res;
}

// Somebody gave the bot's role to a person (or another bot) – take it back.
hooks.on('memberUpdate', async (before, after) => {
  const guild = after?.guild;
  const id = guild ? brandRoleId(guild) : null;
  if (!id || after.id === guild.members.me?.id || !after.roles?.cache?.has(id)) return;
  await after.roles.remove(id, `Tylko bot ${config.brand.name} ma tę rolę`).catch(() => null);
});

module.exports = { ensureBrandRole, topOwnRole };
