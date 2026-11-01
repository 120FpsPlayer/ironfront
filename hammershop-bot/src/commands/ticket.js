'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const t = require('../tickets/tickets');
const ui = require('../tickets/ui');
const { env } = require('../env');
const { PRIORITIES, embed, reply, replyError, isStaff, slug, ts, duration } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Manage the ticket in the current channel')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add someone to the ticket')
        .addUserOption((o) => o.setName('user').setDescription('Who to add').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove someone from the ticket')
        .addUserOption((o) => o.setName('user').setDescription('Who to remove').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('claim').setDescription('Claim this ticket'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Stop handling this ticket'))
    .addSubcommand((s) =>
      s
        .setName('close')
        .setDescription('Close the ticket')
        .addStringOption((o) => o.setName('reason').setDescription('Close reason').setMaxLength(500)),
    )
    .addSubcommand((s) =>
      s
        .setName('priority')
        .setDescription('Set the ticket priority')
        .addStringOption((o) =>
          o
            .setName('level')
            .setDescription('Priority level')
            .setRequired(true)
            .addChoices(...Object.entries(PRIORITIES).map(([value, p]) => ({ name: `${p.emoji} ${p.label}`, value }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('rename')
        .setDescription('Rename the ticket channel')
        .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true).setMaxLength(90)),
    )
    .addSubcommand((s) =>
      s
        .setName('move')
        .setDescription('Move the ticket to another category')
        .addStringOption((o) =>
          o
            .setName('category')
            .setDescription('New category')
            .setRequired(true)
            .addChoices(...config.ticketTypes.map((ty) => ({ name: `${ty.emoji ?? ''} ${ty.label}`.trim(), value: ty.id }))),
        ),
    )
    .addSubcommand((s) => s.setName('request-close').setDescription('Ask the author to confirm the issue is resolved'))
    .addSubcommand((s) =>
      s
        .setName('complete')
        .setDescription('Mark this purchase as delivered (records the sale, gives the Customer role)')
        .addNumberOption((o) => o.setName('amount').setDescription('Amount the customer paid (default: the order total, if known)').setMinValue(0).setMaxValue(1_000_000)),
    )
    .addSubcommand((s) => s.setName('info').setDescription('Ticket information')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { channel, member } = interaction;
    const ticket = db.getTicket(channel.id);
    if (!ticket) return replyError(interaction, 'Tej komendy można użyć tylko na kanale ticketu.');

    const type = config.getType(ticket.typeId);
    const staff = isStaff(member, type);
    const isOwner = ticket.ownerId === member.id && env.ownerCanClose;

    if (sub === 'close') {
      if (!staff && !isOwner) return replyError(interaction, 'Nie masz uprawnień do zamknięcia tego ticketu.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await t.closeTicket(channel, member, interaction.options.getString('reason'));
      return reply(interaction, 'Ticket został zamknięty.');
    }

    if (sub === 'info') {
      const p = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
      return reply(interaction, {
        embeds: [
          embed(p.color)
            .setTitle(`🎫 Ticket #${String(ticket.number).padStart(4, '0')}`)
            .addFields(
              { name: 'Kategoria', value: `${type?.emoji ?? ''} ${type?.label ?? ticket.typeId}`, inline: true },
              { name: 'Status', value: ticket.status === 'open' ? '🟢 otwarty' : '🔴 zamknięty', inline: true },
              { name: 'Priorytet', value: `${p.emoji} ${p.label}`, inline: true },
              { name: 'Autor', value: `<@${ticket.ownerId}>`, inline: true },
              { name: 'Przejęty przez', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
              { name: 'Dodane osoby', value: ticket.participants.map((id) => `<@${id}>`).join(', ') || '—', inline: true },
              { name: 'Utworzony', value: `${ts(ticket.createdAt)} (${ts(ticket.createdAt, 'R')})`, inline: true },
              {
                name: 'Pierwsza odpowiedź',
                value: ticket.firstResponseAt ? `po ${duration(ticket.firstResponseAt - ticket.createdAt)}` : 'brak',
                inline: true,
              },
              { name: 'Ostatnia aktywność', value: ts(ticket.lastActivity, 'R'), inline: true },
            ),
        ],
      });
    }

    if (!staff) return replyError(interaction, 'Ta komenda jest dostępna tylko dla zespołu.');
    // These make several Discord calls – answer first so a slow host doesn't miss Discord's 3 seconds.
    if (['add', 'remove', 'claim', 'unclaim', 'request-close'].includes(sub)) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    switch (sub) {
      case 'add':
        await t.addUser(channel, interaction.options.getUser('user'), member);
        return reply(interaction, 'Osoba dodana.');
      case 'remove':
        await t.removeUser(channel, interaction.options.getUser('user'), member);
        return reply(interaction, 'Osoba usunięta.');
      case 'claim':
        await t.claimTicket(channel, member);
        return reply(interaction, 'Przejmujesz ten ticket.');
      case 'unclaim':
        await t.unclaimTicket(channel, member);
        return reply(interaction, 'Nie obsługujesz już tego ticketu.');
      case 'priority':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await t.setPriority(channel, interaction.options.getString('level'), member);
        return reply(interaction, 'Priorytet zmieniony.');
      case 'move':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await t.moveTicket(channel, interaction.options.getString('category'), member);
        return reply(interaction, 'Ticket został przeniesiony.');
      case 'request-close':
        await t.requestClose(channel, member);
        return reply(interaction, 'Prośba o zamknięcie wysłana do autora.');
      case 'complete': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const amount = interaction.options.getNumber('amount') ?? undefined;
        return t.completeOrder(channel, member, { amount, respond: (result) => reply(interaction, ui.orderCompletedReply(result)) });
      }
      case 'rename': {
        const name = slug(interaction.options.getString('name'), 90);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await t.renameTicket(channel, name);
        return reply(interaction, `Nowa nazwa kanału: \`${name}\`.`);
      }
    }
  },
};
