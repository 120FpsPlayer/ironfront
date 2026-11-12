'use strict';

const { PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { embed, ts, truncate, sendToChannel, duration } = require('../lib/utils');
const { container, section, row, linkBtn, v2, channelUrl } = require('../lib/v2');

/** Polish ordinal number: "1.", "2.", "23.", "111." */
function ordinal(n) {
  return `${n}.`;
}

/** The card posted in #welcome when someone joins. */
function welcomeCard(member) {
  const g = member.guild;
  const verify = db.channelId(g.id, 'verify');
  const shop = db.channelId(g.id, 'shop');
  // On the Hammer Launcher server the next stop after verifying is the download channel.
  const download = require('../lib/profile').launcher ? db.channelId(g.id, 'launcher') : null;
  const c = container(COLORS.brand);
  c.addSectionComponents(
    section(
      `## ${e(g, 'moon')} Witaj w ${config.brand.name}, ${member}!\n` +
        `Jesteś naszym **${ordinal(g.memberCount ?? 1)}** członkiem – cieszymy się, że jesteś z nami 🧡\n` +
        (verify ? `> ${e(g, 'shield')} Zweryfikuj się na <#${verify}>, żeby odblokować serwer\n` : '') +
        (shop ? `> ${e(g, 'cart')} A potem zajrzyj na <#${shop}>` : '') +
        (download ? `> ${e(g, 'download')} A potem pobierz launcher na <#${download}>` : ''),
      member.displayAvatarURL?.({ size: 256 }),
    ),
  );
  const links = [];
  if (verify) links.push(linkBtn(channelUrl(g.id, verify), 'Zweryfikuj się', ce(g, 'check')));
  if (shop) links.push(linkBtn(channelUrl(g.id, shop), 'Sklep', ce(g, 'cart')));
  if (download) links.push(linkBtn(channelUrl(g.id, download), 'Pobierz launcher', ce(g, 'download')));
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
    .setTitle('📥 Nowy członek')
    .setDescription(`${member} · członek nr ${g.memberCount}`)
    .addFields(
      { name: 'Konto utworzone', value: `${ts(member.user.createdTimestamp, 'D')} (${ts(member.user.createdTimestamp, 'R')})${age < 7 * 86_400_000 ? '\n⚠️ **Nowe konto**' : ''}`, inline: true },
      { name: 'ID użytkownika', value: `\`${member.id}\``, inline: true },
    )
    .setThumbnail(member.displayAvatarURL?.() ?? null);
  await sendToChannel(g, db.channelId(g.id, 'serverLogs'), { embeds: [log] });
}

async function onMemberRemove(member) {
  const g = member.guild;
  const roles = member.roles?.cache?.filter((r) => r.id !== g.id).map((r) => `${r}`) ?? [];
  const log = embed(COLORS.danger)
    .setAuthor({ name: member.user?.tag ?? member.user?.username ?? member.id, iconURL: member.displayAvatarURL?.() })
    .setTitle('📤 Członek opuścił serwer')
    .setDescription(`<@${member.id}> · \`${member.id}\``)
    .addFields(
      { name: 'Czas na serwerze', value: member.joinedTimestamp ? duration(Date.now() - member.joinedTimestamp) : 'nieznany', inline: true },
      { name: 'Role', value: truncate(roles.join(' ') || '—', 1024), inline: false },
    );
  await sendToChannel(g, db.channelId(g.id, 'serverLogs'), { embeds: [log] });
}

async function onMessageDelete(message) {
  if (!message.guild || message.author?.bot) return;
  const channelId = db.channelId(message.guild.id, 'serverLogs');
  if (!channelId || message.channelId === channelId) return;
  const log = embed(COLORS.danger)
    .setTitle('🗑️ Wiadomość usunięta')
    .setDescription(
      `**Kanał:** <#${message.channelId}>\n**Autor:** ${message.author ? `${message.author} (\`${message.author.id}\`)` : 'nieznany (wiadomości nie było w pamięci bota)'}\n\n` +
        (message.partial ? '*Treść niedostępna – wiadomość wysłano przed uruchomieniem bota.*' : `>>> ${truncate(message.content || '*(brak tekstu)*', 1800)}`),
    );
  if (message.author) log.setAuthor({ name: message.author.tag ?? message.author.username, iconURL: message.author.displayAvatarURL?.() });
  const files = [...(message.attachments?.values() ?? [])].map((a) => a.name).slice(0, 5);
  if (files.length) log.addFields({ name: 'Załączniki', value: truncate(files.join('\n'), 1024) });
  await sendToChannel(message.guild, channelId, { embeds: [log] });
}

async function onMessageUpdate(before, after) {
  if (!after.guild || after.author?.bot) return;
  if (before.partial || before.content === after.content) return;
  const channelId = db.channelId(after.guild.id, 'serverLogs');
  if (!channelId) return;
  const log = embed(COLORS.warning)
    .setAuthor({ name: after.author.tag ?? after.author.username, iconURL: after.author.displayAvatarURL?.() })
    .setTitle('✏️ Wiadomość edytowana')
    .setDescription(`**Kanał:** <#${after.channelId}> · [Przejdź do wiadomości](${after.url})\n**Autor:** ${after.author}`)
    .addFields(
      { name: 'Przed', value: truncate(before.content || '*(pusta)*', 1024) },
      { name: 'Po', value: truncate(after.content || '*(pusta)*', 1024) },
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
      { reason: `${config.brand.name}: nowi członkowie widzą swoje powitanie` },
    );
  }
  db.setBuild(guild.id, { ...build, welcomePublic: true });
  return true;
}

module.exports = { ordinal, welcomeCard, onMemberAdd, onMemberRemove, onMessageDelete, onMessageUpdate, migrateWelcomeVisibility };
