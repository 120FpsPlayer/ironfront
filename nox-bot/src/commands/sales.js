'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const sales = require('../features/salesreport');
const { reply, replyError } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sales')
    .setDescription('Revenue, orders, top products, sellers and discounts (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('period')
        .setDescription('Time range (default: last 7 days)')
        .addChoices(...Object.entries(sales.PERIODS).map(([value, p]) => ({ name: p.label, value }))),
    ),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Only administrators and sellers can see the sales statistics.');
    const range = sales.periodRange(interaction.options.getString('period') ?? '7d');
    return reply(interaction, sales.salesCard(interaction.guild, range));
  },
};
