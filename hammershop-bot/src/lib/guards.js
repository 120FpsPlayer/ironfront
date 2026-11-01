'use strict';

const { PermissionsBitField } = require('discord.js');

/** Permissions a self-assignable role (verification, notification roles) must never have. */
const DANGEROUS = [
  'Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ManageMessages',
  'ManageWebhooks', 'ModerateMembers', 'MentionEveryone', 'ManageNicknames', 'ManageThreads', 'ViewAuditLog',
  'MuteMembers', 'DeafenMembers', 'MoveMembers', 'ManageGuildExpressions', 'ManageEvents',
];
const DANGEROUS_BITS = new PermissionsBitField(DANGEROUS);

/**
 * Can the bot safely hand out this role automatically? Integration roles, roles above the bot
 * and roles with moderation permissions are always refused – even if someone tampers with a panel.
 */
function isSafeSelfRole(role) {
  if (!role) return false;
  if (role.id === role.guild.id) return false;
  if (role.managed) return false;
  if (!role.editable) return false;
  if (role.permissions.any(DANGEROUS_BITS)) return false;
  return true;
}

module.exports = { DANGEROUS, isSafeSelfRole };
