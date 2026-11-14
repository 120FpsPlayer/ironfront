'use strict';

/**
 * /tickety wylacz|wlacz|lista – switches a ticket category off for a while (e.g. Rekrutacja while the team isn't hiring)
 * and back on. A switched-off category stays in the ticket panel as „Wyłączona” and nobody can open it; the panels
 * (#tickety, the recruitment card in #informacje) are refreshed right away.
 */

const { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const typestate = require('../tickets/typestate');
const { COLORS } = require('../lib/theme');
const { embed, logEmbed, reply, replyError, sendLog } = require('../lib/utils');
const { isAdmin } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

/** The categories people can open from the panel (the shop-only one opens from the shop's Buy buttons). */
const offerable = () => config.ticketTypes.filter((t) => !(t.shopOnly && require('../lib/profile').launcher));
const choices = () => offerable().slice(0, 25).map((t) => ({ name: t.label.slice(0, 100), value: t.id }));

function listEmbed(guild) {
  const lines = offerable().map((t) => `${typestate.isOff(guild.id, t) ? '⛔' : '✅'} **${t.label}** – ${typestate.isOff(guild.id, t) ? 'wyłączona' : 'włączona'}`);
  return embed(COLORS.brand)
    .setTitle('🎫 Kategorie ticketów')
    .setDescription(`${lines.join('\n')}\n\n-# \`${slash('ticket-types off')}\` chowa kategorię za „Wyłączona”, \`${slash('ticket-types on')}\` przywraca ją – otwarte tickety działają dalej.`);
}

/** The panels that show categories are drawn again (in place – nothing moves). */
async function refreshPanels(guild) {
  if (!require('../lib/db').build(guild.id)) return;
  await require('../builder/refresh').refreshContent(guild).catch((err) => console.warn('[tickety] Odświeżenie paneli:', err.message));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-types')
    .setDescription('Switch a ticket category off for a while (e.g. recruitment) and back on (admins)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('off')
        .setDescription('Switch a category off – it shows as disabled in the panel')
        .addStringOption((o) => o.setName('type').setDescription('Category').setRequired(true).addChoices(...choices())),
    )
    .addSubcommand((s) =>
      s
        .setName('on')
        .setDescription('Switch a category back on')
        .addStringOption((o) => o.setName('type').setDescription('Category').setRequired(true).addChoices(...choices())),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Which categories are on and off')),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Tylko administracja może włączać i wyłączać kategorie ticketów.');
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') return interaction.reply({ embeds: [listEmbed(interaction.guild)], flags: MessageFlags.Ephemeral });

    const off = sub === 'off';
    const type = config.getType(interaction.options.getString('type'));
    if (!type) return replyError(interaction, 'Nie ma takiej kategorii ticketów.');
    if (typestate.isOff(interaction.guild.id, type) === off) {
      return replyError(interaction, `Kategoria **${type.label}** jest już ${off ? 'wyłączona' : 'włączona'}.`);
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // the panels are redrawn – a few seconds
    typestate.set(interaction.guild.id, type.id, off, interaction.user.id);
    await refreshPanels(interaction.guild);
    await sendLog(interaction.guild, {
      embeds: [logEmbed(off ? COLORS.warning : COLORS.success, off ? '⛔ Kategoria ticketów wyłączona' : '✅ Kategoria ticketów włączona', interaction.user).setDescription(`**${type.label}** – zmienił(a) <@${interaction.user.id}>`)],
      allowedMentions: { parse: [] },
    });
    return reply(interaction, {
      embeds: [
        embed(off ? COLORS.warning : COLORS.success).setDescription(
          off
            ? `⛔ **${type.label}** jest teraz wyłączona. W panelu ticketów widać ją jako „Wyłączona” i nikt nie otworzy nowego ticketu tej kategorii.`
            : `✅ **${type.label}** znowu działa – można otwierać tickety tej kategorii.`,
        ),
      ],
    });
  },
};
