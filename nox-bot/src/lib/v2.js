'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  ThumbnailBuilder,
} = require('discord.js');
const { COLORS } = require('./theme');

/**
 * Helpers for Discord "Components V2" cards – the modern message layout with colored
 * containers, sections with thumbnails, separators and buttons.
 */

const SPACER = '  ';

const text = (content) => new TextDisplayBuilder().setContent(String(content).slice(0, 4000));
const divider = (large = false) =>
  new SeparatorBuilder().setDivider(true).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
const gap = (large = false) => new SeparatorBuilder().setDivider(false).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

function btn(id, label, emoji, style = ButtonStyle.Secondary) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function linkBtn(url, label, emoji) {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(label);
  if (emoji) b.setEmoji(emoji);
  return b;
}

const row = (...components) => new ActionRowBuilder().addComponents(...components);

function section(content, thumbnailUrl) {
  const s = new SectionBuilder().addTextDisplayComponents(text(content));
  if (thumbnailUrl) s.setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));
  return s;
}

/** A section with a button on the right instead of a thumbnail. */
function buttonSection(content, button) {
  return new SectionBuilder().addTextDisplayComponents(text(content)).setButtonAccessory(button);
}

/** Section with a thumbnail when one is available, otherwise plain text. */
function header(container, content, thumbnailUrl) {
  if (thumbnailUrl) container.addSectionComponents(section(content, thumbnailUrl));
  else container.addTextDisplayComponents(text(content));
  return container;
}

function gallery(...urls) {
  return new MediaGalleryBuilder().addItems(...urls.map((url) => new MediaGalleryItemBuilder().setURL(url)));
}

const container = (color = COLORS.brand) => new ContainerBuilder().setAccentColor(color);

function v2(c, { mentions, files } = {}) {
  const payload = {
    components: Array.isArray(c) ? c : [c],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: mentions ?? { parse: [] },
  };
  if (files?.length) payload.files = files;
  return payload;
}

function notice(color, content, { thumbnail, buttons, mentions } = {}) {
  const c = container(color);
  header(c, content, thumbnail);
  if (buttons?.length) c.addActionRowComponents(row(...buttons));
  return v2(c, { mentions });
}

/** Link to a channel (works in link buttons). */
const channelUrl = (guildId, channelId) => `https://discord.com/channels/${guildId}/${channelId}`;

module.exports = {
  SPACER,
  text,
  divider,
  gap,
  btn,
  linkBtn,
  row,
  section,
  buttonSection,
  header,
  gallery,
  container,
  v2,
  notice,
  channelUrl,
};
