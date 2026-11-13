'use strict';

/**
 * Hammer+ on Discord: whoever has Hammer+ running gets the 💎 Hammer+ role on the server, and loses it when it ends.
 *
 * Who is who: a Hammer+ bought on the website remembers the buyer's Discord account (you sign in with Discord before
 * you can buy), and /hammerplus grant can name one (option "user"). A Discord account counts for as long as its
 * Minecraft account has Hammer+ running – also when the time was added later by someone else.
 *
 * The role is given right after the purchase, when the buyer joins the server later, when they sign in on the
 * website, and by a sweep every 30 minutes – which also takes it away from those whose Hammer+ ended. /build creates
 * the role (layout.launcher.js); a server built earlier gets it made here the first time somebody needs it.
 */

const db = require('../lib/db');
const hooks = require('../lib/hooks');

const ROLE_KEY = 'hammerPlus';
const ROLE_NAME = '💎 Hammer+';
const ROLE_COLOR = 0xffd166;
const SWEEP_MS = 30 * 60_000;

const hp = () => require('./hammerplus');
const siteGuild = () => require('./website').guildOf?.() ?? null;

/** Discord user IDs whose Hammer+ is running now. */
function activeUsers(guildId, now = Date.now()) {
  const out = new Set();
  for (const c of hp().codes(guildId)) {
    if (c.discordId && !out.has(c.discordId) && hp().runningUntil(guildId, c.mc, now) !== null) out.add(c.discordId);
  }
  return out;
}

const hasPlus = (guildId, userId, now = Date.now()) => activeUsers(guildId, now).has(String(userId));
const storedId = (guild) => db.roleId(guild.id, ROLE_KEY) ?? db.guild(guild.id).plusRoleId ?? null;

/** The 💎 Hammer+ role – found by its saved ID or its name, made when `create` and missing. null: none / no permission. */
async function role(guild, { create = false } = {}) {
  const id = storedId(guild);
  let r = id ? guild.roles.cache.get(id) ?? (await guild.roles.fetch(id).catch(() => null)) : null;
  r ??= guild.roles.cache.find((x) => x.name === ROLE_NAME) ?? null;
  if (!r && create) {
    r = await guild.roles
      .create({ name: ROLE_NAME, color: ROLE_COLOR, hoist: true, mentionable: false, permissions: 0n, reason: 'Hammer+ – ranga dla graczy z Hammer+' })
      .catch((err) => (console.warn('💎 Hammer+: nie udało się utworzyć rangi (bot potrzebuje uprawnienia Zarządzanie rolami):', err.message), null));
  }
  if (r && storedId(guild) !== r.id) {
    const g = db.guild(guild.id);
    if (g.build?.roles) g.build.roles[ROLE_KEY] = r.id;
    else g.plusRoleId = r.id;
    db.save();
  }
  return r;
}

/**
 * One person's role to match their Hammer+ → 'added' | 'removed' | 'kept' | 'none' (no Hammer+, no role)
 * | 'not-member' | 'failed' (no role / no permission). Never throws.
 */
async function sync(guild, userId, now = Date.now()) {
  if (!guild || !userId) return 'failed';
  const want = hasPlus(guild.id, userId, now);
  const member = await guild.members.fetch(String(userId)).catch(() => null);
  if (!member) return 'not-member';
  const r = await role(guild, { create: want });
  if (!r) return want ? 'failed' : 'none';
  const has = member.roles.cache.has(r.id);
  try {
    if (want && !has) {
      await member.roles.add(r, 'Hammer+ aktywny');
      return 'added';
    }
    if (!want && has) {
      await member.roles.remove(r, 'Hammer+ wygasł');
      return 'removed';
    }
  } catch (err) {
    console.warn(`💎 Hammer+: ranga dla ${member.user?.tag ?? userId}:`, err.message);
    return 'failed';
  }
  return want ? 'kept' : 'none';
}

/** Everyone at once: the role for all who have Hammer+ running, off for all whose Hammer+ ended. → { added, removed } */
async function syncAll(guild, now = Date.now()) {
  const result = { added: 0, removed: 0 };
  if (!guild) return result;
  const active = activeUsers(guild.id, now);
  const r = await role(guild, { create: active.size > 0 });
  if (!r) return result;
  await guild.members.fetch().catch(() => null);
  for (const member of guild.members.cache.filter((m) => m.roles.cache.has(r.id)).values()) {
    if (active.has(member.id)) continue;
    if (await member.roles.remove(r, 'Hammer+ wygasł').then(() => true, () => false)) result.removed += 1;
  }
  for (const id of active) {
    const member = guild.members.cache.get(id);
    if (!member || member.roles.cache.has(r.id)) continue;
    if (await member.roles.add(r, 'Hammer+ aktywny').then(() => true, () => false)) result.added += 1;
  }
  return result;
}

let timer = null;
hooks.on('ready', () => {
  const run = () => {
    const guild = siteGuild();
    if (guild && hp().codes(guild.id).some((c) => c.discordId)) syncAll(guild).catch((err) => console.warn('💎 Hammer+: rangi:', err.message));
  };
  setTimeout(run, 15_000).unref?.();
  timer ??= setInterval(run, SWEEP_MS);
  timer.unref?.();
});

// Joined the server after buying (or came back): the role straight away.
hooks.on('memberAdd', (member) => {
  if (member.user?.bot || siteGuild()?.id !== member.guild.id) return;
  if (hasPlus(member.guild.id, member.id)) sync(member.guild, member.id).catch(() => null);
});

module.exports = { ROLE_KEY, ROLE_NAME, activeUsers, hasPlus, role, sync, syncAll };
