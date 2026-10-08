'use strict';

/** /enable – a payment method switched off with /disable can be picked again (src/commands/disable.js). */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const disable = require('./disable');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('enable')
    .setDescription('Switch a payment method back on (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('method').setDescription('Payment method').setRequired(true).setAutocomplete(true)),
  autocomplete: disable.autocomplete,
  execute: (interaction) => disable.toggle(interaction, false),
};
