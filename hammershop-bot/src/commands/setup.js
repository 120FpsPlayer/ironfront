'use strict';

const { SlashCommandBuilder, InteractionContextType, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const { env } = require('../env');
const { embed, COLORS, reply, replyError, isAdmin } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Ticket system settings (everything is set automatically by /build)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('set')
        .setDescription('Change options (only fill in the ones you want to change)')
        .addChannelOption((o) => o.setName('category').setDescription('Category for open tickets').addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption((o) => o.setName('closed_category').setDescription('Category for closed tickets').addChannelTypes(ChannelType.GuildCategory))
        .addChannelOption((o) => o.setName('log_channel').setDescription('Ticket log channel').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('transcript_channel').setDescription('Transcript channel').addChannelTypes(ChannelType.GuildText))
        .addIntegerOption((o) => o.setName('limit').setDescription('Max open tickets per user (0 = no limit)').setMinValue(0).setMaxValue(25))
        .addIntegerOption((o) => o.setName('auto_close_hours').setDescription('Close after this many hours without a reply from the author (0 = off)').setMinValue(0).setMaxValue(720))
        .addIntegerOption((o) => o.setName('warning_hours').setDescription('Warn before closing after this many hours (0 = off)').setMinValue(0).setMaxValue(720))
        .addBooleanOption((o) => o.setName('ping_staff').setDescription('Ping the support roles when a ticket is opened?')),
    )
    .addSubcommand((s) =>
      s.setName('role-add').setDescription('Add a role that handles tickets').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) =>
      s.setName('role-remove').setDescription('Remove a ticket role').addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('show').setDescription('Show the current configuration')),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Only administrators can use this command.');
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'set') {
      const o = interaction.options;
      const map = {
        categoryId: () => o.getChannel('category')?.id,
        closedCategoryId: () => o.getChannel('closed_category')?.id,
        logChannelId: () => o.getChannel('log_channel')?.id,
        transcriptChannelId: () => o.getChannel('transcript_channel')?.id,
        maxOpenTicketsPerUser: () => o.getInteger('limit'),
        autoCloseHours: () => o.getInteger('auto_close_hours'),
        autoCloseWarningHours: () => o.getInteger('warning_hours'),
        pingStaffOnOpen: () => o.getBoolean('ping_staff'),
      };
      const patch = {};
      for (const [key, get] of Object.entries(map)) {
        const value = get();
        if (value !== undefined && value !== null) patch[key] = value;
      }
      if (!Object.keys(patch).length) return replyError(interaction, 'No options were provided to change.');
      db.updateSettings(guild.id, patch);
      return reply(interaction, { embeds: [summary(guild).setTitle('✅ Configuration saved')] });
    }

    if (sub === 'role-add' || sub === 'role-remove') {
      const role = interaction.options.getRole('role');
      const current = db.settings(guild.id).staffRoleIds;
      const next = sub === 'role-add' ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id);
      db.updateSettings(guild.id, { staffRoleIds: next });
      return reply(interaction, `${sub === 'role-add' ? 'Added' : 'Removed'} ${role}.\n-# Permissions in tickets that are already open don't change.`);
    }

    return reply(interaction, { embeds: [summary(guild)] });
  },
};

function summary(guild) {
  const s = db.settings(guild.id);
  const ch = (id) => (id ? `<#${id}>` : '*not set*');
  const roles = (list) => list.map((id) => `<@&${id}>`).join(', ') || '*none*';
  const yesNo = (v) => (v ? 'yes' : 'no');
  const build = db.build(guild.id);
  return embed(COLORS.brand)
    .setTitle('⚙️ Configuration')
    .addFields(
      { name: 'Ticket category', value: ch(s.categoryId), inline: true },
      { name: 'Closed category', value: ch(s.closedCategoryId), inline: true },
      { name: 'Built with /build', value: build?.at ? `<t:${Math.floor(build.at / 1000)}:R>` : 'no', inline: true },
      { name: 'Log channel', value: ch(s.logChannelId), inline: true },
      { name: 'Transcript channel', value: ch(s.transcriptChannelId), inline: true },
      { name: 'Verification role', value: s.verifyRoleId ? `<@&${s.verifyRoleId}>` : '*not set*', inline: true },
      { name: 'Ticket roles', value: roles(s.staffRoleIds) },
      { name: '👑 Bot owners (.env)', value: env.ownerIds.map((id) => `<@${id}>`).join(', ') || '*server owner only*', inline: true },
      { name: '🛡️ Admin roles (.env)', value: roles(env.adminRoleIds), inline: true },
      { name: '🎧 Support roles (.env)', value: roles(env.supportRoleIds), inline: true },
      { name: 'Limit per user', value: s.maxOpenTicketsPerUser ? String(s.maxOpenTicketsPerUser) : 'no limit', inline: true },
      { name: 'Auto-close', value: s.autoCloseHours ? `after ${s.autoCloseHours} h (warning after ${s.autoCloseWarningHours} h)` : 'off', inline: true },
      { name: 'Ping staff', value: yesNo(s.pingStaffOnOpen), inline: true },
    );
}
