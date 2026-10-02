'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const db = require('../lib/db');
const { COLORS, embed, reply, replyError, ts, isStaff } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('blacklist')
    .setDescription('Block users from creating tickets')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Block a user')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Unblock a user')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List of blocked users')),

  async execute(interaction) {
    if (!isStaff(interaction.member)) return replyError(interaction, 'The blacklist is only available to staff and administrators.');
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'add') {
      const user = interaction.options.getUser('user');
      if (user.bot) return replyError(interaction, 'You cannot block a bot.');
      db.addBlacklist(guildId, {
        userId: user.id,
        reason: interaction.options.getString('reason'),
        by: interaction.user.id,
        at: Date.now(),
      });
      return reply(interaction, `${user} can no longer create tickets.`);
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('user');
      if (!db.removeBlacklist(guildId, user.id)) return replyError(interaction, `${user} is not blocked.`);
      return reply(interaction, `Unblocked ${user}.`);
    }

    const list = db.blacklist(guildId);
    const lines = list
      .slice(-30)
      .map((b) => `• <@${b.userId}> – ${b.reason ?? 'no reason'} (by <@${b.by}>, ${ts(b.at, 'd')})`);
    return reply(interaction, {
      embeds: [
        embed(COLORS.muted)
          .setTitle(`⛔ Blacklist (${list.length})`)
          .setDescription(lines.join('\n') || 'Nobody is blocked.'),
      ],
    });
  },
};
