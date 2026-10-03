'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { embed, ts, truncate, sendToChannel, duration } = require('../lib/utils');
const { container, section, row, linkBtn, v2, channelUrl } = require('../lib/v2');

/** "1st", "2nd", "23rd", "111th" */
function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

/** The card posted in #welcome when someone joins. */
function welcomeCard(member) {
  const g = member.guild;
  const verify = db.channelId(g.id, 'verify');
  const shop = db.channelId(g.id, 'shop');
  const c = container(COLORS.brand);
  c.addSectionComponents(
    section(
      `## ${e(g, 'moon')} Welcome to ${config.brand.name}, ${member}!\n` +
        `You're our **${ordinal(g.memberCount ?? 1)}** member – glad you're here 💜\n` +
        (verify ? `> ${e(g, 'shield')} Verify in <#${verify}> to unlock the server\n` : '') +
        (shop ? `> ${e(g, 'cart')} Then check out <#${shop}>` : ''),
      member.displayAvatarURL?.({ size: 256 }),
    ),
  );
  const links = [];
  if (verify) links.push(linkBtn(channelUrl(g.id, verify), 'Verify', ce(g, 'check')));
  if (shop) links.push(linkBtn(channelUrl(g.id, shop), 'Shop', ce(g, 'cart')));
  if (links.length) c.addActionRowComponents(row(...links));
  return v2(c, { mentions: { users: [member.id] } });
}

async function onMemberAdd(member) {
  const g = member.guild;
  if (config.welcome?.enabled !== false) {
    await sendToChannel(g, db.channelId(g.id, 'welcome'), welcomeCard(member));
  }
  const age = Date.now() - member.user.createdTimestamp;
  const log = embed(age < 7 * 86_400_000 ? COLORS.warning : COLORS.success)
    .setAuthor({ name: member.user.tag ?? member.user.username, iconURL: member.displayAvatarURL?.() })
    .setTitle('📥 Member joined')
    .setDescription(`${member} · member #${g.memberCount}`)
    .addFields(
      { name: 'Account created', value: `${ts(member.user.createdTimestamp, 'D')} (${ts(member.user.createdTimestamp, 'R')})${age < 7 * 86_400_000 ? '\n⚠️ **New account**' : ''}`, inline: true },
      { name: 'User ID', value: `\`${member.id}\``, inline: true },
    )
    .setThumbnail(member.displayAvatarURL?.() ?? null);
  await sendToChannel(g, db.channelId(g.id, 'serverLogs'), { embeds: [log] });
}

async function onMemberRemove(member) {
  const g = member.guild;
  const roles = member.roles?.cache?.filter((r) => r.id !== g.id).map((r) => `${r}`) ?? [];
  const log = embed(COLORS.danger)
    .setAuthor({ name: member.user?.tag ?? member.user?.username ?? member.id, iconURL: member.displayAvatarURL?.() })
    .setTitle('📤 Member left')
    .setDescription(`<@${member.id}> · \`${member.id}\``)
    .addFields(
      { name: 'Was here for', value: member.joinedTimestamp ? duration(Date.now() - member.joinedTimestamp) : 'unknown', inline: true },
      { name: 'Roles', value: truncate(roles.join(' ') || '—', 1024), inline: false },
    );
  await sendToChannel(g, db.channelId(g.id, 'serverLogs'), { embeds: [log] });
}

async function onMessageDelete(message) {
  if (!message.guild || message.author?.bot) return;
  const channelId = db.channelId(message.guild.id, 'serverLogs');
  if (!channelId || message.channelId === channelId) return;
  const log = embed(COLORS.danger)
    .setTitle('🗑️ Message deleted')
    .setDescription(
      `**Channel:** <#${message.channelId}>\n**Author:** ${message.author ? `${message.author} (\`${message.author.id}\`)` : 'unknown (message was not cached)'}\n\n` +
        (message.partial ? '*Content unavailable – the message was sent before the bot started.*' : `>>> ${truncate(message.content || '*(no text)*', 1800)}`),
    );
  if (message.author) log.setAuthor({ name: message.author.tag ?? message.author.username, iconURL: message.author.displayAvatarURL?.() });
  const files = [...(message.attachments?.values() ?? [])].map((a) => a.name).slice(0, 5);
  if (files.length) log.addFields({ name: 'Attachments', value: truncate(files.join('\n'), 1024) });
  await sendToChannel(message.guild, channelId, { embeds: [log] });
}

async function onMessageUpdate(before, after) {
  if (!after.guild || after.author?.bot) return;
  if (before.partial || before.content === after.content) return;
  const channelId = db.channelId(after.guild.id, 'serverLogs');
  if (!channelId) return;
  const log = embed(COLORS.warning)
    .setAuthor({ name: after.author.tag ?? after.author.username, iconURL: after.author.displayAvatarURL?.() })
    .setTitle('✏️ Message edited')
    .setDescription(`**Channel:** <#${after.channelId}> · [Jump to message](${after.url})\n**Author:** ${after.author}`)
    .addFields(
      { name: 'Before', value: truncate(before.content || '*(empty)*', 1024) },
      { name: 'After', value: truncate(after.content || '*(empty)*', 1024) },
    );
  await sendToChannel(after.guild, channelId, { embeds: [log] });
}

/**
 * Servers built before #welcome was public: unverified newcomers couldn't see the channel, so the
 * ping in their welcome card never reached them. Opens it read-only for everyone, once per server.
 */
async function migrateWelcomeVisibility(guild) {
  const build = db.build(guild.id);
  if (!build || build.welcomePublic) return false;
  const channel = guild.channels.cache.get(build.channels?.welcome);
  if (!channel) return false;
  // @everyone has no server permissions (gated server), so its channel overwrite decides.
  const open = channel.permissionOverwrites.cache.get(guild.id)?.allow.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]);
  if (!open) {
    await channel.permissionOverwrites.edit(
      guild.id,
      { ViewChannel: true, ReadMessageHistory: true, SendMessages: false, AddReactions: false },
      { reason: `${config.brand.name}: newcomers can see their welcome message` },
    );
  }
  db.setBuild(guild.id, { ...build, welcomePublic: true });
  return true;
}

module.exports = { ordinal, welcomeCard, onMemberAdd, onMemberRemove, onMessageDelete, onMessageUpdate, migrateWelcomeVisibility };
