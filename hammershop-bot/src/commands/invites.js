'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const invites = require('../features/invites');
const { UserError, reply } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite tracking: your invites, the next reward and the top inviters')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription("Valid, pending and left invites and the next reward – yours or another member's")
        .addUserOption((o) => o.setName('user').setDescription('Whose invites (default: yours)')),
    )
    .addSubcommand((s) => s.setName('top').setDescription('The top 10 inviters')),

  async execute(interaction) {
    if (config.invites.enabled === false) throw new UserError('Invite tracking is turned off on this server.');
    const guild = interaction.guild;
    if (interaction.options.getSubcommand() === 'top') return reply(interaction, { embeds: [invites.topEmbed(guild, interaction.user.id)] });

    const user = interaction.options.getUser('user') ?? interaction.user;
    if (user.bot) throw new UserError("Bots don't invite anyone – pick a member.");
    const member = user.id === interaction.user.id ? interaction.member : guild.members.cache.get(user.id);
    return reply(interaction, { embeds: [invites.statsEmbed(guild, user, { self: user.id === interaction.user.id, displayName: member?.displayName })] });
  },
};
