'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const backups = require('../features/backups');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, isAdmin } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription("Back up this server's bot data now – posted in #backups (admins)")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild), // hidden from members, like /panel

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Kopie zapasowe mogą robić tylko administratorzy.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const { backup, tooBig, message, payload } = await backups.backupNow(interaction.guild, { by: interaction.user.id });
    if (tooBig) return reply(interaction, payload);
    if (message) {
      return reply(interaction, {
        embeds: [embed(COLORS.success).setDescription(`✅ Kopia zapasowa zapisana na ${message.channel}: [\`${backup.name}\`](${message.url}) · ${backups.size(backup.size)}`)],
      });
    }
    // No #backups channel (or it can't be used) – hand the file over right here.
    const where = db.channelId(interaction.guild.id, 'backups') ? 'Nie udało mi się opublikować na #kopie-zapasowe' : `Nie ma kanału #kopie-zapasowe (użyj \`${slash('build')}\`)`;
    return reply(interaction, { ...payload, content: `${where} – oto plik, przechowuj go w bezpiecznym miejscu.` });
  },
};
