'use strict';

const { SlashCommandBuilder, InteractionContextType, ChannelType, PermissionFlagsBits } = require('discord.js');
const panels = require('../lib/panels');
const { banner } = require('../lib/theme');
const { reply, replyError, isAdmin } = require('../lib/utils');
const { verifyPanel } = require('../features/verification');
const { rolesPanels } = require('../features/selfroles');
require('../tickets/tickets'); // registers the ticket panel
require('../features/shop');
require('../features/vouches');
require('../features/stats');

const TYPES = {
  tickets: { label: '🎫 Ticket panel', banner: 'support', live: true },
  shop: { label: '🛒 Shop catalog', banner: 'shop', live: true },
  vouches: { label: '⭐ Vouch panel', banner: 'vouches', live: true },
  leaderboard: { label: '🏆 Leaderboard', banner: 'leaderboard', live: true },
  verify: { label: '✅ Verification', banner: 'verification' },
  roles: { label: '🎭 Roles & notifications', banner: 'roles' },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Send a panel (tickets, shop, vouches, verification…) to a channel')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Which panel?')
        .setRequired(true)
        .addChoices(...Object.entries(TYPES).map(([value, t]) => ({ name: t.label, value }))),
    )
    .addChannelOption((o) => o.setName('channel').setDescription('Target channel (defaults to this one)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('banner').setDescription('Post the matching banner above it? (default: yes)'))
    .addStringOption((o) =>
      o.setName('style').setDescription('Ticket panel layout').addChoices({ name: 'Cards with buttons', value: 'buttons' }, { name: 'Dropdown list', value: 'select' }),
    ),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Only administrators can use this command.');
    const type = interaction.options.getString('type');
    const def = TYPES[type];
    const channel = interaction.options.getChannel('channel') ?? interaction.channel;
    const withBanner = interaction.options.getBoolean('banner') ?? true;
    const me = interaction.guild.members.me;
    if (!channel.permissionsFor(me).has(['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles'])) {
      return replyError(interaction, `I don't have permission to send messages in ${channel}.`);
    }
    await interaction.deferReply({ flags: 64 });
    if (withBanner && def.banner) await channel.send({ files: [banner(def.banner)] });
    if (def.live) {
      const extra = type === 'tickets' ? { style: interaction.options.getString('style') ?? 'buttons' } : {};
      await panels.send(channel, type, extra);
    } else if (type === 'verify') {
      await channel.send(verifyPanel(interaction.guild));
    } else if (type === 'roles') {
      for (const payload of rolesPanels(interaction.guild)) await channel.send(payload);
    }
    return reply(interaction, `${def.label} sent to ${channel}.${def.live ? ' It updates automatically.' : ''}`);
  },
};
