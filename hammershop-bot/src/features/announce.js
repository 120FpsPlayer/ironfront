'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { ASSETS, COLORS, banner, hasBanner } = require('../lib/theme');
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
  require('../lib/profile').launcher ? ['pingUpdates', '🚀 Updates role'] : ['pingRestocks', '📦 Restocks role'],
  ['everyone', '@everyone'],
];

function openModal(interaction, { channelId, ping = 'none', bannerKey = 'none' }) {
  const modal = new ModalBuilder().setCustomId(`ann:${channelId}:${ping}:${bannerKey}`).setTitle('📢 Nowe ogłoszenie');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Tytuł')
      .setTextInputComponent(new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(120)),
    new LabelBuilder()
      .setLabel('Treść')
      .setDescription('Działa Markdown: **pogrubienie**, listy, linki, ## nagłówki…')
      .setTextInputComponent(new TextInputBuilder().setCustomId('message').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(3500)),
    new LabelBuilder()
      .setLabel('Link w przycisku (opcjonalnie)')
      .setDescription('Dodaje przycisk, który otwiera ten adres')
      .setTextInputComponent(new TextInputBuilder().setCustomId('url').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setPlaceholder('https://…')),
  );
  return interaction.showModal(modal);
}

/**
 * The announcement card. The admin panel's „Ogłoszenia” tab adds its own touches (all optional): color (the kind's
 * accent), image (a picture under the text), label (the button's text), tag + icon (the kind in the footer).
 */
function buildAnnouncement(guild, author, { title, message, ping, bannerKey, url, color = COLORS.brand, image = null, label = 'Otwórz link', tag = null, icon = '📢' }) {
  const c = container(color);
  const files = [];
  if (bannerKey && bannerKey !== 'none' && hasBanner(bannerKey)) {
    const file = banner(bannerKey);
    files.push(file);
    c.addMediaGalleryComponents(gallery(`attachment://${file.name}`));
  }
  c.addTextDisplayComponents(text(`# ${title}\n${message}`));
  if (image) c.addMediaGalleryComponents(gallery(image));
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
  c.addTextDisplayComponents(text(`-# ${icon} ${tag ? `${tag} · ` : ''}${author} · ${config.brand.name}${pingText}`));
  if (url) {
    if (!/^https?:\/\/\S+$/i.test(url)) throw new UserError('Link w przycisku musi zaczynać się od http:// lub https://');
    c.addActionRowComponents(row(linkBtn(url, label, '🔗')));
  }
  return v2(c, { mentions, files });
}

// ── The admin panel's announcements (the website's „Ogłoszenia” tab, src/web/admin.js) – the same card ──
/** The kinds the panel offers: the card's accent color, the banner on top and the footer's emoji. */
const PANEL_KINDS = {
  ogloszenie: { label: 'Ogłoszenie', emoji: '📢', color: COLORS.brand, banner: 'announcements' },
  aktualizacja: { label: 'Aktualizacja', emoji: '🚀', color: COLORS.success, banner: 'updates' },
  wydarzenie: { label: 'Wydarzenie', emoji: '🎉', color: 0xa970ff, banner: 'events' },
  wazne: { label: 'Ważne', emoji: '⚠️', color: COLORS.danger, banner: 'announcements' },
};
const panelKind = (kind) => (Object.hasOwn(PANEL_KINDS, String(kind)) ? PANEL_KINDS[kind] : null);

/**
 * The banner of a kind – only the server's own banners: on Hammer Launcher a shared banner would carry the shop's name
 * (there is no launcher banner for events, so they get the announcements one).
 */
function kindBanner(kind, launcher = require('../lib/profile').launcher) {
  const own = (key) => (launcher ? fs.existsSync(path.join(ASSETS, 'banners-launcher', `${key}.png`)) : hasBanner(key));
  return [panelKind(kind)?.banner, 'announcements'].filter(Boolean).find(own) ?? null;
}

/** The kinds for the panel's form and preview. */
const panelKinds = () => Object.entries(PANEL_KINDS).map(([id, k]) => ({ id, label: k.label, emoji: k.emoji, color: `#${k.color.toString(16).padStart(6, '0')}`, banner: Boolean(kindBanner(id)) }));

/** ping: 'none' | 'role' (📢 Ogłoszenia) | 'everyone'; author: '<@id>' of whoever sent it from the panel. */
function buildPanelAnnouncement(guild, author, { title, text: message, kind, image, button, ping, banner: withBanner = true }) {
  const k = panelKind(kind) ?? PANEL_KINDS.ogloszenie;
  return buildAnnouncement(guild, author, {
    title, message, image, color: k.color, tag: k.label, icon: k.emoji,
    ping: { role: 'pingAnnouncements', everyone: 'everyone' }[ping] ?? 'none',
    bannerKey: withBanner ? kindBanner(kind) : null,
    url: button?.url ?? null, label: button?.label ?? 'Otwórz link',
  });
}

async function submit(interaction) {
  const [, channelId, ping, bannerKey] = interaction.customId.split(':');
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel?.isTextBased?.()) throw new UserError('Ten kanał już nie istnieje.');
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
  return interaction.editReply({ embeds: [embed(COLORS.success).setDescription(`✅ Ogłoszenie opublikowane na ${channel}.`)], components: [row(linkBtn(sent.url, 'Zobacz', '📢'))] });
}

module.exports = { BANNER_CHOICES, PING_CHOICES, openModal, buildAnnouncement, submit, PANEL_KINDS, panelKind, kindBanner, panelKinds, buildPanelAnnouncement };
