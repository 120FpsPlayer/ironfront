'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { env } = require('../env');
const db = require('./db');

/** Role keys created by /build, grouped by power level. */
const ADMIN_KEYS = ['founder', 'coowner', 'manager', 'admin'];
const MOD_KEYS = [...ADMIN_KEYS, 'moderator'];
const SUPPORT_KEYS = [...MOD_KEYS, 'support', 'trialSupport'];
const STAFF_KEYS = [...SUPPORT_KEYS, 'seller'];
const SHOP_KEYS = [...ADMIN_KEYS, 'seller'];

const builtRoles = (guildId, keys) => keys.map((k) => db.roleId(guildId, k)).filter(Boolean);
const hasRole = (member, roleIds) => roleIds.length > 0 && Boolean(member?.roles?.cache?.hasAny?.(...roleIds));

/** Bot owner: the server owner or anyone in OWNER_IDS. */
function isOwner(member) {
  if (!member) return false;
  if (env.ownerIds.includes(member.id)) return true;
  return Boolean(member.guild && member.guild.ownerId === member.id);
}

function isAdmin(member) {
  if (!member?.guild) return false;
  if (isOwner(member)) return true;
  if (hasRole(member, env.adminRoleIds)) return true;
  if (hasRole(member, builtRoles(member.guild.id, ADMIN_KEYS))) return true;
  if (env.discordAdminsAreAdmins && member.permissions) {
    return member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild);
  }
  return false;
}

function isMod(member) {
  if (isAdmin(member)) return true;
  return hasRole(member, builtRoles(member.guild.id, MOD_KEYS));
}

/** Can manage the product catalog (admins + sellers). */
function isShopManager(member) {
  if (isAdmin(member)) return true;
  return hasRole(member, builtRoles(member.guild.id, SHOP_KEYS));
}

const typeEnvCache = new Map();
function typeEnvRoleIds(type) {
  if (!type) return [];
  if (!typeEnvCache.has(type.id)) typeEnvCache.set(type.id, env.ids(`SUPPORT_ROLE_IDS_${type.id.toUpperCase().replace(/-/g, '_')}`));
  return typeEnvCache.get(type.id);
}

/** Every role that can see and handle tickets of this type. */
function ticketRoleIds(guildId, type) {
  return [
    ...new Set([
      ...env.adminRoleIds,
      ...env.supportRoleIds,
      ...(db.settings(guildId).staffRoleIds ?? []),
      ...(type?.staffRoleIds ?? []),
      ...builtRoles(guildId, type?.staffRoles ?? []),
      ...typeEnvRoleIds(type),
    ]),
  ];
}

function isStaff(member, type = null) {
  if (!member?.guild) return false;
  if (isAdmin(member)) return true;
  const roles = ticketRoleIds(member.guild.id, type);
  if (hasRole(member, roles)) return true;
  // Without a specific type, anyone with any staff role counts (e.g. for /stats, /help).
  return !type && hasRole(member, builtRoles(member.guild.id, STAFF_KEYS));
}

/**
 * Every role that makes its members staff: the staff roles from /build, ADMIN_ROLE_IDS, the ticket staff roles
 * (/setup, SUPPORT_ROLE_IDS, and those of the given ticket types) and – when Discord admins count as admins –
 * roles with Administrator or Manage Server. Never @everyone. Returns a Set of role IDs.
 */
function allStaffRoleIds(guild, types = []) {
  const ids = new Set([
    ...builtRoles(guild.id, STAFF_KEYS),
    ...env.adminRoleIds,
    ...ticketRoleIds(guild.id, null),
    ...types.flatMap((type) => ticketRoleIds(guild.id, type)),
  ]);
  if (env.discordAdminsAreAdmins) {
    for (const r of guild.roles.cache.values()) {
      if (r.permissions.has(PermissionFlagsBits.Administrator) || r.permissions.has(PermissionFlagsBits.ManageGuild)) ids.add(r.id);
    }
  }
  ids.delete(guild.id);
  return ids;
}

function openDeniedReason(member) {
  if (isAdmin(member)) return null;
  if (hasRole(member, env.blockedRoleIds)) return 'Your role is not allowed to open tickets.';
  if (env.openRoleIds.length && !hasRole(member, env.openRoleIds)) {
    return `To open a ticket, you need one of these roles: ${env.openRoleIds.map((id) => `<@&${id}>`).join(', ')}`;
  }
  return null;
}

function reportRoles(guilds, ticketTypes) {
  const groups = [
    ['OWNER_IDS', env.ownerIds, 'user'],
    ['ADMIN_ROLE_IDS', env.adminRoleIds],
    ['SUPPORT_ROLE_IDS', env.supportRoleIds],
    ...ticketTypes.map((t) => [`SUPPORT_ROLE_IDS_${t.id.toUpperCase().replace(/-/g, '_')}`, typeEnvRoleIds(t)]),
    ['OPEN_ROLE_IDS', env.openRoleIds],
    ['BLOCKED_ROLE_IDS', env.blockedRoleIds],
  ];
  for (const [name, list, kind] of groups) {
    if (!list.length) continue;
    if (kind === 'user') {
      console.log(`🔐 ${name}: ${list.length} ${list.length === 1 ? 'user' : 'users'}`);
      continue;
    }
    const names = list.map((id) => {
      const role = guilds.map((g) => g.roles.cache.get(id)).find(Boolean);
      return role ? `@${role.name}` : `⚠️ ${id} (no such role on the server!)`;
    });
    console.log(`🔐 ${name}: ${list.length} ${list.length === 1 ? 'role' : 'roles'} → ${names.join(', ')}`);
  }
}

module.exports = {
  ADMIN_KEYS,
  MOD_KEYS,
  SUPPORT_KEYS,
  STAFF_KEYS,
  SHOP_KEYS,
  hasRole,
  isOwner,
  isAdmin,
  isMod,
  isShopManager,
  isStaff,
  allStaffRoleIds,
  ticketRoleIds,
  openDeniedReason,
  reportRoles,
};
