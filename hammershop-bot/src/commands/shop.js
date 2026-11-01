'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const shopstatus = require('../features/shopstatus');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, ts } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const MODE_LABEL = { auto: '🕒 Automatyczny', open: '🟢 Otwarty (ręcznie)', closed: '🔴 Zamknięty (ręcznie)' };

/** Status card shown after every /shop subcommand. */
function statusEmbed(guild, { title, res = null, now = shopstatus.clock.now() }) {
  const m = shopstatus.mode(guild.id);
  const open = shopstatus.isOpen(guild.id, now);
  const next = shopstatus.nextChange(guild.id, now);
  const state = db.guild(guild.id).shopStatus;
  const lines = [
    `**Teraz:** ${open ? '🟢 Otwarte' : '🔴 Zamknięte'}`,
    `**Tryb:** ${MODE_LABEL[m]}${m !== 'auto' && state.setBy ? ` · ustawiony przez <@${state.setBy}> ${ts(state.setAt ?? Date.now(), 'R')}` : ''}`,
    `**Godziny pracy:** ${shopstatus.hoursText() ?? 'nieustawione (config.json → workingHours)'}`,
  ];
  if (next) lines.push(`**${open ? 'Zamknięcie' : 'Otwarcie'}:** ${shopstatus.whenText(next, now)}`);
  if (m !== 'auto') lines.push(`-# Zostaje tak, dopóki ktoś nie użyje \`${slash('shop auto')}\`.`);

  const { channel, upToDate } = shopstatus.statusChannel(guild, now);
  const notes = [];
  if (res?.error) notes.push(`⚠️ Nie udało się zmienić nazwy kanału statusu: ${res.error}`);
  else if (res?.wait) notes.push(`⏳ Discord pozwala zmienić nazwę kanału tylko dwa razy na 10 minut – kanał statusu ${channel} zaktualizuje się sam za około ${res.wait} min.`);
  else if (!config.shopStatus.enabled) notes.push('ℹ️ Kanał statusu jest wyłączony (config.json → shopStatus.enabled).');
  else if (!channel) notes.push(`ℹ️ Nie ma jeszcze kanału statusu – użyj \`${slash('build')} tylko:update\`, żeby go dodać.`);
  else if (!upToDate) notes.push(`⏳ Kanał statusu ${channel} pokazuje jeszcze co innego – sam zmieni nazwę w ciągu 10 minut (Discord pozwala na 2 zmiany nazwy na 10 minut).`);
  else notes.push(`Kanał statusu ${channel}, panel sklepu i panel ticketów są aktualne.`);

  return embed(open ? COLORS.success : COLORS.danger)
    .setTitle(title)
    .setDescription(`${lines.join('\n')}\n\n${notes.join('\n')}`);
}

/** Subcommand → mode and the title of the answer. */
const ACTIONS = {
  open: { mode: 'open', title: '🟢 Sklep jest otwarty' },
  close: { mode: 'closed', title: '🔴 Sklep jest zamknięty' },
  auto: { mode: 'auto', title: '🕒 Sklep znowu działa według godzin pracy' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Open or close the shop – shown in the status channel, shop and ticket panels')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('open').setDescription('Open the shop now, outside the opening hours too (until /shop auto)'))
    .addSubcommand((s) => s.setName('close').setDescription('Close the shop now, during the opening hours too (until /shop auto)'))
    .addSubcommand((s) => s.setName('auto').setDescription('Follow the opening hours again (config.json → workingHours)'))
    .addSubcommand((s) => s.setName('status').setDescription('Show if the shop is open, the opening hours and the next change')),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą otwierać i zamykać sklep.');
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return reply(interaction, { embeds: [statusEmbed(guild, { title: '🛒 Status sklepu' })] });

    const action = ACTIONS[sub];
    if (!action) return replyError(interaction, 'Nieznana opcja.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await shopstatus.setMode(guild, action.mode, { by: interaction.user.id });
    return reply(interaction, { embeds: [statusEmbed(guild, { title: action.title, res })] });
  },
};
