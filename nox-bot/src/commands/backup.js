'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const backups = require('../features/backups');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, isAdmin } = require('../lib/utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription("Back up this server's bot data now – posted in #backups (admins)")
    .setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Only administrators can make backups.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { backup, tooBig, message, payload } = await backups.backupNow(interaction.guild, { by: interaction.user.id });
    if (tooBig) return reply(interaction, payload);
    if (message) {
      return reply(interaction, {
        embeds: [embed(COLORS.success).setDescription(`✅ Backup saved in ${message.channel}: [\`${backup.name}\`](${message.url}) · ${backups.size(backup.size)}`)],
      });
    }
    // No #backups channel (or it can't be used) – hand the file over right here.
    const where = db.channelId(interaction.guild.id, 'backups') ? "I couldn't post in #backups" : 'There is no #backups channel (run `/build`)';
    return reply(interaction, { ...payload, content: `${where} – here is the file, keep it somewhere safe.` });
  },
};
