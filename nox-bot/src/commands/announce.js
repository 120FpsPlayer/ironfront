'use strict';

const { SlashCommandBuilder, InteractionContextType, ChannelType, PermissionFlagsBits } = require('discord.js');
const db = require('../lib/db');
const announce = require('../features/announce');
const { replyError } = require('../lib/utils');
const { isMod } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Post a styled announcement (opens a form)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addChannelOption((o) => o.setName('channel').setDescription('Where to post (default: #announcements)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addStringOption((o) =>
      o
        .setName('ping')
        .setDescription('Who to notify')
        .addChoices(...announce.PING_CHOICES.map(([value, name]) => ({ name, value }))),
    )
    .addStringOption((o) =>
      o
        .setName('banner')
        .setDescription('Banner image on top')
        .addChoices({ name: 'No banner', value: 'none' }, ...announce.BANNER_CHOICES.slice(0, 24).map(([value, name]) => ({ name, value }))),
    ),

  async execute(interaction) {
    if (!isMod(interaction.member)) return replyError(interaction, 'Only moderators and administrators can post announcements.');
    const channel =
      interaction.options.getChannel('channel') ?? interaction.guild.channels.cache.get(db.channelId(interaction.guild.id, 'announcements') ?? '') ?? interaction.channel;
    const ping = interaction.options.getString('ping') ?? 'none';
    if (ping === 'everyone' && !interaction.member.permissions.has(PermissionFlagsBits.MentionEveryone)) {
      return replyError(interaction, 'You need the **Mention @everyone** permission to ping everyone.');
    }
    return announce.openModal(interaction, { channelId: channel.id, ping, bannerKey: interaction.options.getString('banner') ?? 'announcements' });
  },
};
