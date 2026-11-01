'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const lockdown = require('../features/lockdown');
const { reply, replyError } = require('../lib/utils');
const { isMod } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Lift the lockdown and give members their permissions back (moderators)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  async execute(interaction) {
    if (!isMod(interaction.member)) return replyError(interaction, 'Only moderators and administrators can unlock the server.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await lockdown.unlock(interaction.guild, interaction.member);
    return reply(interaction, { embeds: [lockdown.unlockReply(interaction.guild, result)] });
  },
};
