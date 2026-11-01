'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const t = require('../tickets/tickets');
const { reply, replyError, isStaff } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reply')
    .setDescription('Send a canned reply in the ticket (staff)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('snippet').setDescription('Which reply should be sent?').setRequired(true).setAutocomplete(true)),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    await interaction.respond(
      config.snippets
        .filter((s) => s.name.toLowerCase().includes(query) || s.id.includes(query) || s.content.toLowerCase().includes(query))
        .slice(0, 25)
        .map((s) => ({ name: `${s.name} – ${s.content}`.slice(0, 100), value: s.id })),
    );
  },

  async execute(interaction) {
    const ticket = db.getTicket(interaction.channel.id);
    if (!ticket) return replyError(interaction, 'Tej komendy można użyć tylko na kanale ticketu.');
    if (!isStaff(interaction.member, config.getType(ticket.typeId))) {
      return replyError(interaction, 'Gotowe odpowiedzi są dostępne tylko dla zespołu.');
    }
    const snippet = config.snippets.find((s) => s.id === interaction.options.getString('snippet'));
    if (!snippet) return replyError(interaction, 'Nie ma takiej odpowiedzi. Wybierz jedną z podpowiedzi.');
    await t.sendSnippet(interaction.channel, snippet, interaction.member);
    return reply(interaction, 'Wysłano.');
  },
};
