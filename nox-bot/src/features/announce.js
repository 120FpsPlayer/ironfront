'use strict';

const { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { COLORS, banner, hasBanner } = require('../lib/theme');
const { UserError, embed } = require('../lib/utils');
const { container, text, divider, gallery, v2, linkBtn, row } = require('../lib/v2');

/** Banners offered by /announce (max 25 choices). */
const BANNER_CHOICES = [
  ['announcements', '📢 Announcements'],
  ['updates', '🔔 Updates'],
  ['whats-new', "📰 What's new"],
  ['restocks', '📦 Restocks'],
  ['giveaways', '🎁 Giveaways'],
  ['events', '📅 Events'],
  ['shop', '🛒 Shop'],
  ['products', '🏷️ Products'],
  ['payments', '💳 Payments'],
  ['vip', '👑 VIP'],
  ['partners', '🤝 Partners'],
  ['staff', '🛡️ Staff'],
  ['join-us', '➕ Join us (hiring)'],
  ['welcome', '👋 Welcome'],
  ['rules', '⚖️ Rules'],
  ['support', '🎧 Support'],
  ['boosters', '🚀 Boosters'],
  ['leaderboard', '🏆 Leaderboard'],
  ['discord', '💬 Discord'],
].filter(([key]) => hasBanner(key));

const PING_CHOICES = [
  ['none', 'No ping'],
  ['pingAnnouncements', '📢 Announcements role'],
  ['pingGiveaways', '🎉 Giveaways role'],
  ['pingRestocks', '📦 Restocks role'],
  ['everyone', '@everyone'],
];

function openModal(interaction, { channelId, ping = 'none', bannerKey = 'none' }) {
  const modal = new ModalBuilder().setCustomId(`ann:${channelId}:${ping}:${bannerKey}`).setTitle('📢 New announcement');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Title')
      .setTextInputComponent(new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120)),
    new LabelBuilder()
      .setLabel('Message')
      .setDescription('Markdown works: **bold**, lists, links, ## headings…')
      .setTextInputComponent(new TextInputBuilder().setCustomId('message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3500)),
    new LabelBuilder()
      .setLabel('Button link (optional)')
      .setDescription('Adds a button that opens this URL')
      .setTextInputComponent(new TextInputBuilder().setCustomId('url').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setPlaceholder('https://…')),
  );
  return interaction.showModal(modal);
}

function buildAnnouncement(guild, author, { title, message, ping, bannerKey, url }) {
  const c = container(COLORS.brand);
  const files = [];
  if (bannerKey && bannerKey !== 'none' && hasBanner(bannerKey)) {
    const file = banner(bannerKey);
    files.push(file);
    c.addMediaGalleryComponents(gallery(`attachment://${file.name}`));
  }
  c.addTextDisplayComponents(text(`# ${title}\n${message}`));
  c.addSeparatorComponents(divider());
  let mentions = { parse: [] };
  let pingText = '';
  if (ping === 'everyone') {
    pingText = ' · @everyone';
    mentions = { parse: ['everyone'] };
  } else if (ping && ping !== 'none') {
    const roleId = db.roleId(guild.id, ping);
    if (roleId) {
      pingText = ` · <@&${roleId}>`;
      mentions = { roles: [roleId] };
    }
  }
  c.addTextDisplayComponents(text(`-# 📢 ${author} · ${config.brand.name}${pingText}`));
  if (url) {
    if (!/^https?:\/\/\S+$/i.test(url)) throw new UserError('The button link must start with http:// or https://');
    c.addActionRowComponents(row(linkBtn(url, 'Open link', '🔗')));
  }
  return v2(c, { mentions, files });
}

async function submit(interaction) {
  const [, channelId, ping, bannerKey] = interaction.customId.split(':');
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) throw new UserError('That channel no longer exists.');
  const title = interaction.fields.getTextInputValue('title').trim();
  const message = interaction.fields.getTextInputValue('message').trim();
  let url = '';
  try {
    url = interaction.fields.getTextInputValue('url')?.trim() ?? '';
  } catch {
    url = '';
  }
  const payload = buildAnnouncement(interaction.guild, interaction.member, { title, message, ping, bannerKey, url });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const sent = await channel.send(payload);
  if (channel.type === 5) await sent.crosspost().catch(() => null); // announcement channel → publish to followers
  return interaction.editReply({ embeds: [embed(COLORS.success).setDescription(`✅ Announcement posted in ${channel}.`)], components: [row(linkBtn(sent.url, 'View', '📢'))] });
}

module.exports = { BANNER_CHOICES, PING_CHOICES, openModal, buildAnnouncement, submit };
