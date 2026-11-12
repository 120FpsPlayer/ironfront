'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const launcherinfo = require('../features/launcherinfo');
const { v2 } = require('../lib/v2');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('launcher')
    .setDescription('Hammer Launcher: what it is, the current version and where to download it')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    return interaction.reply(v2(launcherinfo.card(interaction.guild, { live: true })));
  },
};
