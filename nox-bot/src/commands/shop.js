'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const shopstatus = require('../features/shopstatus');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, ts } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

const MODE_LABEL = { auto: '🕒 Automatic', open: '🟢 Open (set by hand)', closed: '🔴 Closed (set by hand)' };

/** Status card shown after every /shop subcommand. */
function statusEmbed(guild, { title, res = null, now = new Date() }) {
  const m = shopstatus.mode(guild.id);
  const open = shopstatus.isOpen(guild.id, now);
  const next = shopstatus.nextChange(guild.id, now);
  const state = db.guild(guild.id).shopStatus;
  const lines = [
    `**Right now:** ${open ? '🟢 Open' : '🔴 Closed'}`,
    `**Mode:** ${MODE_LABEL[m]}${m !== 'auto' && state.setBy ? ` by <@${state.setBy}> ${ts(state.setAt ?? Date.now(), 'R')}` : ''}`,
    `**Opening hours:** ${shopstatus.hoursText() ?? 'none set (config.json → workingHours)'}`,
  ];
  if (next) lines.push(`**${open ? 'Closes' : 'Opens'}:** ${shopstatus.whenText(next, now)}`);
  if (m !== 'auto') lines.push('-# Stays like this until someone runs `/shop auto`.');

  const channelId = db.channelId(guild.id, 'statShop');
  const notes = [];
  if (res?.error) notes.push(`⚠️ I couldn't rename the status channel: ${res.error}`);
  else if (res?.wait) notes.push(`⏳ Discord only allows renaming a channel twice per 10 minutes – the status channel <#${channelId}> updates by itself in about ${res.wait} min.`);
  else if (!config.shopStatus.enabled) notes.push('ℹ️ The status channel is turned off (config.json → shopStatus.enabled).');
  else if (!channelId) notes.push('ℹ️ No status channel yet – run `/build only:update` to add it.');
  else notes.push(`The status channel <#${channelId}>, the shop panel and the ticket panel are up to date.`);

  return embed(open ? COLORS.success : COLORS.danger)
    .setTitle(title)
    .setDescription(`${lines.join('\n')}\n\n${notes.join('\n')}`);
}

const TITLES = {
  open: '🟢 The shop is open',
  closed: '🔴 The shop is closed',
  auto: '🕒 Opening hours are automatic again',
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('shop')
    .setDescription('Open or close the shop – shown in the status channel, shop and ticket panels')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('open').setDescription('Open the shop now, outside the opening hours too (until /shop auto)'))
    .addSubcommand((s) => s.setName('closed').setDescription('Close the shop now, during the opening hours too (until /shop auto)'))
    .addSubcommand((s) => s.setName('auto').setDescription('Follow the opening hours again (config.json → workingHours)'))
    .addSubcommand((s) => s.setName('status').setDescription('Is the shop open, the opening hours and the next change')),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Only administrators and sellers can open or close the shop.');
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return reply(interaction, { embeds: [statusEmbed(guild, { title: '🛒 Shop status' })] });

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const res = await shopstatus.setMode(guild, sub, { by: interaction.user.id });
    return reply(interaction, { embeds: [statusEmbed(guild, { title: TITLES[sub], res })] });
  },
};
