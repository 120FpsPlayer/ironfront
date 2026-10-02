'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const t = require('../tickets/tickets');
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
    .addSubcommand((s) => s.setName('complete').setDescription('Mark this purchase as delivered (gives the Customer role)'))
    .addSubcommand((s) => s.setName('info').setDescription('Ticket information')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const { channel, member } = interaction;
    const ticket = db.getTicket(channel.id);
    if (!ticket) return replyError(interaction, 'This command can only be used in a ticket channel.');

    const type = config.getType(ticket.typeId);
    const staff = isStaff(member, type);
    const isOwner = ticket.ownerId === member.id && env.ownerCanClose;

    if (sub === 'close') {
      if (!staff && !isOwner) return replyError(interaction, 'You don\'t have permission to close this ticket.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await t.closeTicket(channel, member, interaction.options.getString('reason'));
      return reply(interaction, 'The ticket has been closed.');
    }

    if (sub === 'info') {
      const p = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
      return reply(interaction, {
        embeds: [
          embed(p.color)
            .setTitle(`🎫 Ticket #${String(ticket.number).padStart(4, '0')}`)
            .addFields(
              { name: 'Category', value: `${type?.emoji ?? ''} ${type?.label ?? ticket.typeId}`, inline: true },
              { name: 'Status', value: ticket.status === 'open' ? '🟢 open' : '🔴 closed', inline: true },
              { name: 'Priority', value: `${p.emoji} ${p.label}`, inline: true },
              { name: 'Author', value: `<@${ticket.ownerId}>`, inline: true },
              { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
              { name: 'Added members', value: ticket.participants.map((id) => `<@${id}>`).join(', ') || '—', inline: true },
              { name: 'Created', value: `${ts(ticket.createdAt)} (${ts(ticket.createdAt, 'R')})`, inline: true },
              {
                name: 'First response',
                value: ticket.firstResponseAt ? `after ${duration(ticket.firstResponseAt - ticket.createdAt)}` : 'none',
                inline: true,
              },
              { name: 'Last activity', value: ts(ticket.lastActivity, 'R'), inline: true },
            ),
        ],
      });
    }

    if (!staff) return replyError(interaction, 'This command is only available to staff members.');

    switch (sub) {
      case 'add':
        await t.addUser(channel, interaction.options.getUser('user'), member);
        return reply(interaction, 'User added.');
      case 'remove':
        await t.removeUser(channel, interaction.options.getUser('user'), member);
        return reply(interaction, 'User removed.');
      case 'claim':
        await t.claimTicket(channel, member);
        return reply(interaction, 'You claimed the ticket.');
      case 'unclaim':
        await t.unclaimTicket(channel, member);
        return reply(interaction, 'You are no longer handling this ticket.');
      case 'priority':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await t.setPriority(channel, interaction.options.getString('level'), member);
        return reply(interaction, 'Priority changed.');
      case 'move':
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await t.moveTicket(channel, interaction.options.getString('category'), member);
        return reply(interaction, 'The ticket has been moved.');
      case 'request-close':
        await t.requestClose(channel, member);
        return reply(interaction, 'Close request sent to the author.');
      case 'complete': {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const { orders, loyal } = await t.completeOrder(channel, member);
        return reply(interaction, `Order marked as completed. The customer now has ${orders} ${orders === 1 ? 'order' : 'orders'}${loyal ? ' and got the Loyal Customer role 💜' : ''}.`);
      }
      case 'rename': {
        const name = slug(interaction.options.getString('name'), 90);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await t.renameTicket(channel, name);
        return reply(interaction, `Renamed to \`${name}\`.`);
      }
    }
  },
};
