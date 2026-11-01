'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const balance = require('../features/balance');
const { reply, replyError, money } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('balance')
    .setDescription('Store balance – your own, or manage a member\'s (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('view')
        .setDescription('Your store balance and its last changes (staff: pick a member to see theirs)')
        .addUserOption((o) => o.setName('user').setDescription('Member (staff only – leave empty for your own)')),
    )
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add store balance to a member (admins & sellers)')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addNumberOption((o) => o.setName('amount').setDescription('Amount to add').setRequired(true).setMinValue(0.01).setMaxValue(100000))
        .addStringOption((o) => o.setName('reason').setDescription('Why – kept in the history and the log').setRequired(true).setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove store balance from a member (admins & sellers)')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
        .addNumberOption((o) => o.setName('amount').setDescription('Amount to remove').setRequired(true).setMinValue(0.01).setMaxValue(100000))
        .addStringOption((o) => o.setName('reason').setDescription('Why – kept in the history and the log').setRequired(true).setMaxLength(200)),
    ),

  async execute(interaction) {
    const o = interaction.options;
    const sub = o.getSubcommand();
    const user = o.getUser('user');
    const staff = isShopManager(interaction.member);

    if (sub === 'view') {
      if (user && user.id !== interaction.user.id) {
        if (!staff) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą zobaczyć cudze saldo.');
        return reply(interaction, balance.balanceView(interaction.guild, user.id, { staffView: true }));
      }
      if (!balance.enabled() && !staff) return replyError(interaction, 'Saldo sklepu jest teraz wyłączone.');
      return reply(interaction, balance.balanceView(interaction.guild, interaction.user.id));
    }

    if (!staff) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą zmieniać saldo członków.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const remove = sub === 'remove';
    const after = await balance.staffChange(interaction.guild, interaction.member, user, o.getNumber('amount'), o.getString('reason'), { remove });
    return reply(
      interaction,
      `${remove ? 'Odjęto' : 'Dodano'} **${money(o.getNumber('amount'))}** ${remove ? 'z salda' : 'do salda'} sklepu <@${user.id}> – wynosi teraz **${money(after)}**. Zapisano w logach ticketów.`,
    );
  },
};
