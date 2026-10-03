'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const lockdown = require('../features/lockdown');
const { reply, replyError } = require('../lib/utils');
const { isMod } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lockdown')
    .setDescription("Lock the server: members can't chat, react or use voice until /unlock (moderators)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addStringOption((o) => o.setName('reason').setDescription('Shown in the lockdown notice, e.g. "Raid in progress"').setMaxLength(200)),

  async execute(interaction) {
    if (!isMod(interaction.member)) return replyError(interaction, 'Only moderators and administrators can lock the server.');
    const reason = interaction.options.getString('reason')?.trim() || null;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // many permission edits – can take a few seconds
    const result = await lockdown.lock(interaction.guild, interaction.member, reason);
    return reply(interaction, { embeds: [lockdown.lockReply(interaction.guild, result, reason)] });
  },
};
