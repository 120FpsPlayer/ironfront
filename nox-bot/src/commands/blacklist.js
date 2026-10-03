'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const db = require('../lib/db');
const { COLORS, embed, reply, replyError, ts, isStaff, truncate } = require('../lib/utils');

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

    // Newest first, as many as fit in one embed (4096 characters).
    const list = db.blacklist(guildId);
    const lines = [];
    let length = 0;
    for (const b of [...list].reverse()) {
      const line = `• <@${b.userId}> – ${truncate(b.reason ?? 'no reason', 100)} (by <@${b.by}>, ${ts(b.at, 'd')})`;
      if (length + line.length + 1 > 3900) break;
      lines.push(line);
      length += line.length + 1;
    }
    if (lines.length < list.length) lines.push(`*…and ${list.length - lines.length} more*`);
    return reply(interaction, {
      embeds: [
        embed(COLORS.muted)
          .setTitle(`⛔ Blacklist (${list.length})`)
          .setDescription(lines.join('\n') || 'Nobody is blocked.'),
      ],
    });
  },
};
