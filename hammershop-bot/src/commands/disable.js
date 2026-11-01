'use strict';

/** /disable and /enable – switch a payment method off for a while (e.g. while fixing PayPal) and back on. */

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const paymentState = require('../lib/paymentState');
const { COLORS } = require('../lib/theme');
const { embed, logEmbed, replyError, sendLog, truncate } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

/** ✅ / ⛔ for every payment method. */
function stateEmbed(guildId) {
  const lines = config.shop.paymentMethods.map((m) => {
    const off = paymentState.offNote(guildId, m);
    return off ? `⛔ **${m.name}** – ${off.replace(/^⛔ /, '')}` : `✅ **${m.name}** – włączona`;
  });
  return embed(COLORS.brand)
    .setTitle('💳 Metody płatności')
    .setDescription(truncate(`${lines.join('\n') || 'Brak metod płatności w config.json.'}\n\n-# \`${slash('disable')}\` wyłącza metodę, \`${slash('enable')}\` włącza ją z powrotem – złożone już zamówienia działają dalej.`, 4000));
}

/** The method the option names (autocomplete value = its name). */
function pick(interaction) {
  const raw = interaction.options.getString('method');
  return config.shop.paymentMethods.find((m) => m.name.toLowerCase() === String(raw).trim().toLowerCase()) ?? null;
}

const autocomplete = (interaction) => {
  const q = String(interaction.options.getFocused() ?? '').toLowerCase();
  return interaction.respond(
    config.shop.paymentMethods
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 25)
      .map((m) => ({ name: truncate(`${paymentState.isOff(interaction.guild.id, m) ? '⛔' : '✅'} ${m.name}`, 100), value: m.name.slice(0, 100) })),
  );
};

/** Switches it, refreshes the #payments card, FAQ and shop panel, and logs it. */
async function toggle(interaction, off) {
  if (!isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą włączać i wyłączać metody płatności.');
  const m = pick(interaction);
  if (!m) return replyError(interaction, 'Wybierz metodę płatności z listy.');
  const guild = interaction.guild;
  if (paymentState.isOff(guild.id, m) === off) return interaction.reply({ embeds: [stateEmbed(guild.id)], content: `Metoda **${m.name}** jest już ${off ? 'wyłączona' : 'włączona'}.`, flags: MessageFlags.Ephemeral });
  const reason = off ? interaction.options.getString('reason') : null;
  paymentState.set(guild.id, m.name, off, { by: interaction.user.id, reason });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  // The public cards show it right away – the same in-place update as /build only:panels.
  const res = await require('../builder/refresh').refreshContent(guild).catch((err) => ({ errors: [err.message] }));
  await sendLog(guild, {
    embeds: [
      logEmbed(off ? COLORS.warning : COLORS.success, off ? `⛔ Wyłączono metodę: ${m.name}` : `✅ Włączono metodę: ${m.name}`, interaction.user).setDescription(
        off ? `Nowe zamówienia nie mogą wybrać metody **${m.name}**${reason ? ` – ${truncate(reason, 300)}` : ''}.` : `Metodę **${m.name}** można znowu wybrać.`,
      ),
    ],
  }).catch(() => null);
  const note = res?.errors?.length ? `\n-# ⚠️ Nie udało się zaktualizować części kart: ${truncate(res.errors.join('; '), 300)}` : '\n-# Karta na #płatności, FAQ i panel sklepu są już zaktualizowane.';
  return interaction.editReply({
    content: `${off ? `⛔ Metoda **${m.name}** jest wyłączona – nikt nie wybierze jej w nowym zamówieniu, dopóki nie użyjesz \`${slash('enable')}\`.` : `✅ Metoda **${m.name}** znowu działa.`}${note}`,
    embeds: [stateEmbed(guild.id)],
  });
}

const methodOption = (o) => o.setName('method').setDescription('Payment method').setRequired(true).setAutocomplete(true);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disable')
    .setDescription('Switch a payment method off for a while, e.g. while fixing it (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption(methodOption)
    .addStringOption((o) => o.setName('reason').setDescription('Shown to customers, e.g. "maintenance – back tonight"').setMaxLength(100)),
  autocomplete,
  execute: (interaction) => toggle(interaction, true),
  toggle,
  stateEmbed,
};
