'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const customers = require('../features/customers');
const { UserError, reply, replyError, isStaff, truncate } = require('../lib/utils');
const { isMod } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const userOption = (o) => o.setName('user').setDescription('The customer').setRequired(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('customer')
    .setDescription('Customer profiles and private staff notes (staff)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('view').setDescription('Orders, total spent, tickets, vouches, invites and staff notes of a member').addUserOption(userOption))
    .addSubcommandGroup((g) =>
      g
        .setName('note')
        .setDescription('Private staff notes about a customer')
        .addSubcommand((s) =>
          s
            .setName('add')
            .setDescription('Add a private note – only staff can see it')
            .addUserOption(userOption)
            .addStringOption((o) => o.setName('text').setDescription(`The note (up to ${customers.MAX_NOTE_LENGTH} characters)`).setRequired(true).setMaxLength(customers.MAX_NOTE_LENGTH)),
        )
        .addSubcommand((s) =>
          s
            .setName('remove')
            .setDescription('Delete a note (your own – moderators can delete any)')
            .addUserOption(userOption)
            .addIntegerOption((o) => o.setName('id').setDescription('Note number, e.g. 3 for #3 (shown on the profile)').setRequired(true).setMinValue(1).setAutocomplete(true)),
        ),
    ),

  /** Suggests the notes of the user picked in the same command. */
  autocomplete(interaction) {
    if (!isStaff(interaction.member)) return interaction.respond([]);
    const userId = interaction.options.get?.('user')?.value;
    const query = String(interaction.options.getFocused() ?? '').trim().replace(/^#/, '').toLowerCase();
    const notes = userId ? [...customers.notesOf(interaction.guild.id, String(userId))].reverse() : [];
    return interaction.respond(
      notes
        .filter((n) => !query || String(n.id).startsWith(query) || n.text.toLowerCase().includes(query))
        .slice(0, 25)
        .map((n) => ({ name: truncate(`#${n.id} · ${n.text.replace(/\s+/g, ' ')}`, 100), value: n.id })),
    );
  },

  async execute(interaction) {
    if (!isStaff(interaction.member)) return replyError(interaction, 'Profile klientów i notatki są dostępne tylko dla zespołu.');
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user');
    if (user.bot) throw new UserError('Boty nie mają profili klientów.');

    if (sub === 'view') {
      const member = await guild.members.fetch(user.id).catch(() => null);
      return reply(interaction, customers.profileCard(guild, user, member));
    }

    if (sub === 'add') {
      const note = customers.addNote(guild.id, user.id, { by: interaction.user.id, text: interaction.options.getString('text') });
      return reply(interaction, `Notatka **#${note.id}** o ${user} zapisana. Widzi ją tylko zespół – wszystkie notatki pokazuje \`${slash('customer view')}\`.`);
    }

    const id = interaction.options.getInteger('id');
    const note = customers.notesOf(guild.id, user.id).find((n) => n.id === id);
    if (!note) throw new UserError(`${user} nie ma notatki **#${id}**. Wybierz jedną z podpowiedzi.`);
    if (note.by !== interaction.user.id && !isMod(interaction.member)) {
      throw new UserError(`Autorem notatki #${id} jest <@${note.by}> – możesz usuwać tylko swoje notatki. Poproś moderatora o jej usunięcie.`);
    }
    customers.removeNote(guild.id, user.id, id);
    return reply(interaction, `Usunięto notatkę **#${id}** o ${user}.`);
  },
};
