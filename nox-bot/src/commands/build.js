'use strict';

const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const session = require('../builder/session');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription(`Build the complete ${config.brand.name} server – roles, channels, banners, emojis, shop, tickets and more`)
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('only')
        .setDescription('Run just one part (leave empty to build the whole server)')
        .addChoices(
          { name: '😀 Emojis – upload the missing custom emojis', value: 'emojis' },
          { name: '🔄 Panels – re-post all banners & cards (after editing config.json)', value: 'panels' },
        ),
    ),

  execute: (interaction) => session.start(interaction),
};
