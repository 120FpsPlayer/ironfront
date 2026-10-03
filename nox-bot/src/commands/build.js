'use strict';

const { SlashCommandBuilder, InteractionContextType, PermissionFlagsBits } = require('discord.js');
const session = require('../builder/session');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription('Build the complete server – roles, channels, banners, emojis, shop, tickets and more')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('only')
        .setDescription('Run just one part (leave empty to build the whole server)')
        .addChoices(
          { name: '🆕 Update – add new channels & roles, apply names, update panels (after a bot update)', value: 'update' },
          { name: '😀 Emojis – upload the missing custom emojis', value: 'emojis' },
          { name: '🔄 Panels – update all banners & cards (after editing config.json)', value: 'panels' },
          { name: '🎨 Names – rename channels & categories to the current style', value: 'names' },
        ),
    ),

  execute: (interaction) => session.start(interaction),
};
