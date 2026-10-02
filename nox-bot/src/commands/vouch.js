'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const vouches = require('../features/vouches');
const { truncate } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('vouch')
    .setDescription('Leave a review after buying something')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) =>
      o
        .setName('rating')
        .setDescription('Your rating')
        .setRequired(true)
        .addChoices(
          { name: '⭐⭐⭐⭐⭐ Excellent', value: 5 },
          { name: '⭐⭐⭐⭐ Good', value: 4 },
          { name: '⭐⭐⭐ Okay', value: 3 },
          { name: '⭐⭐ Poor', value: 2 },
          { name: '⭐ Bad', value: 1 },
        ),
    )
    .addStringOption((o) => o.setName('product').setDescription('What did you buy?').setRequired(true).setMaxLength(80).setAutocomplete(true))
    .addStringOption((o) => o.setName('review').setDescription('Your review – delivery, quality, support…').setRequired(true).setMinLength(10).setMaxLength(800))
    .addAttachmentOption((o) => o.setName('proof').setDescription('Optional screenshot')),

  autocomplete(interaction) {
    const q = interaction.options.getFocused().toLowerCase();
    return interaction.respond(
      db
        .guild(interaction.guild.id)
        .products.filter((p) => !q || p.name.toLowerCase().includes(q))
        .slice(0, 25)
        .map((p) => ({ name: truncate(p.name, 100), value: truncate(p.name, 80) })),
    );
  },

  async execute(interaction) {
    vouches.checkCanVouch(interaction.member);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const image = await vouches.fetchImage(interaction.options.getAttachment('proof'));
    const { n, message } = await vouches.postVouch(interaction.guild, interaction.member, {
      rating: interaction.options.getInteger('rating'),
      product: interaction.options.getString('product'),
      review: interaction.options.getString('review'),
      image,
    });
    return vouches.thanks(interaction, n, message);
  },
};
