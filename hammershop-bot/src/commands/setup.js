'use strict';

const { SlashCommandBuilder, InteractionContextType, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const { env } = require('../env');
const { embed, COLORS, reply, replyError, isAdmin } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');

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
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Tej komendy mogą używać tylko administratorzy.');
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
      if (!Object.keys(patch).length) return replyError(interaction, 'Nie podano żadnych ustawień do zmiany.');
      db.updateSettings(guild.id, patch);
      return reply(interaction, { embeds: [summary(guild).setTitle('✅ Ustawienia zapisane')] });
    }

    if (sub === 'role-add' || sub === 'role-remove') {
      const role = interaction.options.getRole('role');
      const current = db.settings(guild.id).staffRoleIds;
      const next = sub === 'role-add' ? [...new Set([...current, role.id])] : current.filter((id) => id !== role.id);
      db.updateSettings(guild.id, { staffRoleIds: next });
      return reply(interaction, `${sub === 'role-add' ? 'Dodano' : 'Usunięto'} rolę ${role}.\n-# Uprawnienia w już otwartych ticketach się nie zmieniają.`);
    }

    return reply(interaction, { embeds: [summary(guild)] });
  },
};

function summary(guild) {
  const s = db.settings(guild.id);
  const ch = (id) => (id ? `<#${id}>` : '*nie ustawiono*');
  const roles = (list) => list.map((id) => `<@&${id}>`).join(', ') || '*brak*';
  const yesNo = (v) => (v ? 'tak' : 'nie');
  const build = db.build(guild.id);
  return embed(COLORS.brand)
    .setTitle('⚙️ Ustawienia')
    .addFields(
      { name: 'Kategoria ticketów', value: ch(s.categoryId), inline: true },
      { name: 'Kategoria zamkniętych', value: ch(s.closedCategoryId), inline: true },
      { name: `Zbudowano (${slash('build')})`, value: build?.at ? `<t:${Math.floor(build.at / 1000)}:R>` : 'nie', inline: true },
      { name: 'Kanał logów', value: ch(s.logChannelId), inline: true },
      { name: 'Kanał transkrypcji', value: ch(s.transcriptChannelId), inline: true },
      { name: 'Rola weryfikacji', value: s.verifyRoleId ? `<@&${s.verifyRoleId}>` : '*nie ustawiono*', inline: true },
      { name: 'Role ticketów', value: roles(s.staffRoleIds) },
      { name: '👑 Właściciele bota (.env)', value: env.ownerIds.map((id) => `<@${id}>`).join(', ') || '*tylko właściciel serwera*', inline: true },
      { name: '🛡️ Role adminów (.env)', value: roles(env.adminRoleIds), inline: true },
      { name: '🎧 Role pomocy (.env)', value: roles(env.supportRoleIds), inline: true },
      { name: 'Limit na osobę', value: s.maxOpenTicketsPerUser ? String(s.maxOpenTicketsPerUser) : 'bez limitu', inline: true },
      { name: 'Automatyczne zamykanie', value: s.autoCloseHours ? `po ${s.autoCloseHours} h (ostrzeżenie po ${s.autoCloseWarningHours} h)` : 'wyłączone', inline: true },
      { name: 'Ping zespołu', value: yesNo(s.pingStaffOnOpen), inline: true },
    );
}
