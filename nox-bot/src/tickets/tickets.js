'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  LabelBuilder,
  ModalBuilder,
  OverwriteType,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const panels = require('../lib/panels');
const promos = require('../features/promos');
const ui = require('./ui');
const { createTranscript } = require('./transcript');
const { openDeniedReason } = require('../lib/permissions');
const { numberedCategoryName } = require('../builder/style');
const {
  UserError,
  COLORS,
  PRIORITIES,
  embed,
  logEmbed,
  staffRoleIds,
  isAdmin,
  safeRename,
  channelName,
  duration,
  pad,
  ts,
  sendLog,
  money,
} = require('../lib/utils');

const OWNER_PERMS = ['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'AttachFiles', 'EmbedLinks', 'AddReactions'];
const STAFF_PERMS = [...OWNER_PERMS, 'ManageMessages'];
const BOT_PERMS = [...STAFF_PERMS, 'ManageChannels'];
const allow = (perms) => Object.fromEntries(perms.map((p) => [p, true]));
// Always say it's a member overwrite: after a restart discord.js doesn't know most users,
// and without the type it refuses to set their permissions at all.
const AS_MEMBER = { type: OverwriteType.Member };
const CATEGORY_LIMIT = 50;
const childCount = (guild, categoryId) => guild.channels.cache.filter((c) => c.parentId === categoryId).size;

/**
 * A category with room for one more ticket. Discord allows 50 channels per category, so when
 * the open-tickets category is full an overflow category ("〔 🎫 TICKETS 2 〕") is created next to it.
 */
async function openCategoryWithRoom(guild) {
  const settings = db.settings(guild.id);
  const base = guild.channels.cache.get(settings.categoryId);
  if (!base) return null;
  const ids = [settings.categoryId, ...(settings.overflowCategoryIds ?? [])];
  for (const id of ids) {
    if (guild.channels.cache.has(id) && childCount(guild, id) < CATEGORY_LIMIT) return id;
  }
  const overflow = await guild.channels
    .create({
      name: numberedCategoryName(base.name, ids.length + 1),
      type: ChannelType.GuildCategory,
      permissionOverwrites: [...base.permissionOverwrites.cache.values()].map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
      reason: 'Ticket category is full (50 channels) – overflow category',
    })
    .catch((err) => {
      console.error('[tickets] Could not create an overflow ticket category:', err.message);
      return null;
    });
  if (!overflow) return null;
  db.updateSettings(guild.id, { overflowCategoryIds: [...(settings.overflowCategoryIds ?? []).filter((id) => guild.channels.cache.has(id)), overflow.id] });
  return overflow.id;
}

/** Makes room in the closed-tickets category by deleting the oldest closed tickets (their transcripts are saved). */
async function makeRoomInClosed(guild, closedId) {
  let excess = childCount(guild, closedId) - (CATEGORY_LIMIT - 1);
  if (excess <= 0) return;
  const oldest = db
    .tickets((x) => x.guildId === guild.id && x.status === 'closed' && guild.channels.cache.get(x.channelId)?.parentId === closedId)
    .sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  for (const old of oldest) {
    if (excess <= 0) break;
    const ch = guild.channels.cache.get(old.channelId);
    const ok = await ch?.delete('Closed-tickets category is full – removing the oldest closed ticket (transcript is saved)').then(() => true).catch(() => false);
    if (!ok) continue;
    db.updateTicket(old.channelId, { status: 'deleted', deletedAt: Date.now(), deletedBy: 'auto-cleanup' });
    excess -= 1;
  }
}

const creating = new Set();
const lastOpened = new Map();
const D = config.defaults;

panels.register('tickets', (guild, panel) => ui.panelPayload(guild, panel.style));
const buildPanel = (guild, style) => ui.panelPayload(guild, style);
const schedulePanelRefresh = (guild) => panels.schedule(guild, 'tickets');

/** Text input wrapped in a label (the modern modal layout). */
function labeledInput(q, { value } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(q.id)
    .setStyle(q.style === 'paragraph' ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(q.required !== false)
    .setMaxLength(Math.min(q.maxLength ?? 1000, 4000));
  if (q.placeholder) input.setPlaceholder(q.placeholder.slice(0, 100));
  if (q.minLength) input.setMinLength(q.minLength);
  if (value) input.setValue(String(value).slice(0, q.maxLength ?? 1000));
  const label = new LabelBuilder().setLabel(q.label.slice(0, 45)).setTextInputComponent(input);
  if (q.description) label.setDescription(q.description.slice(0, 100));
  return label;
}

function buildForm(type, origin) {
  const modal = new ModalBuilder().setCustomId(`ticket:form:${type.id}:${origin}`).setTitle(`${type.emoji ?? ''} ${type.label}`.trim().slice(0, 45));
  modal.addLabelComponents(...type.questions.map((q) => labeledInput(q)));
  return modal;
}

function checkCanOpen(member) {
  const settings = db.settings(member.guild.id);
  const category = member.guild.channels.cache.get(settings.categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return 'The ticket system is not set up yet. An administrator needs to run `/build` (or `/setup set`).';
  }
  const roleError = openDeniedReason(member);
  if (roleError) return roleError;
  if (db.isBlacklisted(member.guild.id, member.id)) {
    const entry = db.blacklist(member.guild.id).find((b) => b.userId === member.id);
    return `You are blocked from creating tickets.${entry?.reason ? `\n**Reason:** ${entry.reason}` : ''}`;
  }
  const open = db.tickets((t) => t.guildId === member.guild.id && t.ownerId === member.id && t.status === 'open');
  if (settings.maxOpenTicketsPerUser > 0 && open.length >= settings.maxOpenTicketsPerUser) {
    return `You've reached the open ticket limit (**${settings.maxOpenTicketsPerUser}**).\nYour tickets: ${open.map((t) => `<#${t.channelId}>`).join(', ')}`;
  }
  const cooldown = (D.openCooldownSeconds ?? 0) * 1000;
  const last = lastOpened.get(`${member.guild.id}:${member.id}`);
  if (cooldown && last && Date.now() - last < cooldown && !isAdmin(member)) {
    return `Slow down a bit! You can open another ticket ${ts(last + cooldown, 'R')}.`;
  }
  return null;
}

async function renderCard(guild, ticket, pingRoles = []) {
  const ownerUser = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  const ownerMember = await guild.members.fetch(ticket.ownerId).catch(() => null);
  const previousCount = db.tickets((t) => t.guildId === guild.id && t.ownerId === ticket.ownerId && t.channelId !== ticket.channelId).length;
  return ui.ticketCard(ticket, config.getType(ticket.typeId), { guild, ownerUser, ownerMember, pingRoles, previousCount });
}

async function refreshControlMessage(channel, ticket) {
  if (!ticket.controlMessageId) return;
  const msg = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
  if (!msg) return;
  const payload = await renderCard(channel.guild, ticket);
  delete payload.allowedMentions;
  await msg.edit(payload).catch((err) => console.warn('[card] Failed to refresh:', err.message));
}

/** extra: more ticket fields, stored before the first card is posted (the shop's `order`, so the card shows that product). */
async function openTicket(member, type, answers = [], extra = {}) {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  if (creating.has(key)) throw new UserError('Your ticket is being created, one moment…');

  const error = checkCanOpen(member);
  if (error) throw new UserError(error);

  creating.add(key);
  try {
    const settings = db.settings(guild.id);
    const staffRoles = staffRoleIds(guild.id, type).filter((id) => guild.roles.cache.has(id));
    const parent = await openCategoryWithRoom(guild);
    if (!parent) throw new UserError('Our ticket system is full right now – please try again in a few minutes or contact the staff.');
    const number = db.nextTicketNumber(guild.id);
    const draft = { number, priority: 'normal', ownerName: member.user.username };

    const channel = await guild.channels.create({
      name: channelName(draft, type),
      type: ChannelType.GuildText,
      parent,
      topic: `${type.emoji ?? '🎫'} ${type.label} · #${pad(number)} · ${member.user.tag ?? member.user.username} (${member.id})`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: ['ViewChannel'] },
        { id: guild.members.me.id, allow: BOT_PERMS },
        { id: member.id, allow: OWNER_PERMS },
        ...staffRoles.map((id) => ({ id, allow: STAFF_PERMS })),
      ],
      reason: `Ticket #${number} opened by ${member.user.tag ?? member.user.username}`,
    });

    const now = Date.now();
    lastOpened.set(key, now);
    const ticket = db.createTicket({
      channelId: channel.id,
      guildId: guild.id,
      number,
      typeId: type.id,
      ownerId: member.id,
      ownerName: member.user.username,
      status: 'open',
      priority: 'normal',
      claimedBy: null,
      participants: [],
      answers,
      createdAt: now,
      lastActivity: now,
      lastMessageBy: 'owner',
      firstResponseAt: null,
      warned: false,
      lastStaffPing: null,
      closeRequest: null,
      closedAt: null,
      closedBy: null,
      closeReason: null,
      completedAt: null,
      rating: null,
      transcriptUrl: null,
      controlMessageId: null,
      ...extra,
    });

    const pings = settings.pingStaffOnOpen ? staffRoles : [];
    const msg = await channel.send(await renderCard(guild, ticket, pings));
    db.updateTicket(channel.id, { controlMessageId: msg.id });
    schedulePanelRefresh(guild);
    await msg.pin().catch(() => null);

    if (D.dmOnOpen) {
      await member
        .send({
          embeds: [
            embed(COLORS.brand)
              .setAuthor({ name: guild.name, iconURL: guild.iconURL?.() ?? undefined })
              .setTitle(`${type.emoji ?? '🎫'} Your ticket has been created`)
              .setDescription(
                `**Category:** ${type.label}\n**Number:** \`#${pad(number)}\`\n\n` +
                  'Our team will reply as soon as possible. We will let you know when the ticket is closed.\n' +
                  '-# 🔒 Staff will never ask you to pay in DMs – only inside your ticket.',
              ),
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channel.url).setLabel('Go to ticket').setEmoji('🎫'),
            ),
          ],
        })
        .catch(() => null);
    }

    await sendLog(guild, {
      embeds: [
        logEmbed(COLORS.success, '📥 Ticket opened', member.user)
          .setThumbnail(member.user.displayAvatarURL?.() ?? null)
          .addFields(
            { name: 'Ticket', value: `${channel}\n\`#${pad(number)}\``, inline: true },
            { name: 'Category', value: `${type.emoji ?? ''} ${type.label}`, inline: true },
            { name: 'Author', value: `${member}\n\`${member.id}\``, inline: true },
            ...answers.slice(0, 4).map((a) => ({ name: a.label.slice(0, 256), value: (a.value || '—').slice(0, 300) })),
          ),
      ],
      components: [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channel.url).setLabel('Open').setEmoji('🎫')),
      ],
    });

    return channel;
  } finally {
    creating.delete(key);
  }
}

async function archiveTranscript(channel, ticket, actor) {
  const type = config.getType(ticket.typeId);
  const { attachment, messageCount, participants } = await createTranscript(channel, ticket, type);
  const settings = db.settings(channel.guild.id);
  const owner = await channel.client.users.fetch(ticket.ownerId).catch(() => null);

  const summary = logEmbed(COLORS.brand, `📄 Transcript · #${channel.name}`, owner).addFields(
    { name: 'Author', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Category', value: `${type?.emoji ?? ''} ${type?.label ?? ticket.typeId}`, inline: true },
    { name: 'Handled by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
    { name: 'Closed by', value: actor ? `<@${actor.id}>` : '—', inline: true },
    { name: 'Duration', value: duration(Date.now() - ticket.createdAt), inline: true },
    { name: 'Messages', value: `${messageCount} · ${participants.size} people`, inline: true },
  );
  if (ticket.closeReason) summary.addFields({ name: 'Close reason', value: ticket.closeReason.slice(0, 1024) });

  let url = null;
  const target = settings.transcriptChannelId ? await channel.guild.channels.fetch(settings.transcriptChannelId).catch(() => null) : null;
  if (target?.isTextBased?.()) {
    const sent = await target.send({ embeds: [summary], files: [attachment] }).catch(() => null);
    url = sent?.attachments?.first?.()?.url ?? null;
    if (url) db.updateTicket(channel.id, { transcriptUrl: url });
  }
  return { attachment, messageCount, url };
}

function ratingRow(channelId) {
  const labels = ['Poor', 'Meh', 'OK', 'Good', 'Great'];
  return new ActionRowBuilder().addComponents(
    [1, 2, 3, 4, 5].map((n) =>
      new ButtonBuilder()
        .setCustomId(`rate:${channelId}:${n}`)
        .setLabel(`${n} · ${labels[n - 1]}`)
        .setEmoji('⭐')
        .setStyle(n >= 4 ? ButtonStyle.Success : n === 3 ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ),
  );
}

async function closeTicket(channel, actor, reason = null) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('This is not a ticket channel.');
  if (ticket.status !== 'open') throw new UserError('This ticket is already closed.');

  const settings = db.settings(channel.guild.id);
  db.updateTicket(channel.id, { status: 'closed', closedAt: Date.now(), closedBy: actor.id, closeReason: reason, closeRequest: null });
  schedulePanelRefresh(channel.guild);

  let transcript = null;
  try {
    transcript = await archiveTranscript(channel, ticket, actor);
  } catch (err) {
    console.error('[transcript] Generation error:', err);
  }

  for (const id of [ticket.ownerId, ...ticket.participants]) {
    await channel.permissionOverwrites
      .edit(id, { ViewChannel: false, SendMessages: false }, AS_MEMBER)
      .catch((err) => console.warn(`[tickets] Could not remove ${id} from #${channel.name}:`, err.message));
  }
  if (settings.closedCategoryId && channel.guild.channels.cache.has(settings.closedCategoryId)) {
    await makeRoomInClosed(channel.guild, settings.closedCategoryId);
    await channel
      .setParent(settings.closedCategoryId, { lockPermissions: false })
      .catch((err) => console.warn(`[tickets] Could not move #${channel.name} to the closed category:`, err.message));
  }

  await refreshControlMessage(channel, ticket);
  await channel.send(ui.closedCard(ticket, actor.id, { messageCount: transcript?.messageCount, transcriptUrl: transcript?.url }));

  const owner = await channel.client.users.fetch(ticket.ownerId).catch(() => null);
  const type = config.getType(ticket.typeId);
  if (owner && (D.dmTranscript || D.askForRating)) {
    const dm = embed(COLORS.brand)
      .setAuthor({ name: channel.guild.name, iconURL: channel.guild.iconURL?.() ?? undefined })
      .setTitle('🔒 Your ticket has been closed')
      .setDescription(
        `Thanks for reaching out, **${owner.globalName ?? owner.username}**! 💜` +
          (D.askForRating ? '\n\n**How would you rate our support?** Click a rating below – it takes 5 seconds and helps us a lot.' : ''),
      )
      .addFields(
        { name: 'Ticket', value: `\`#${pad(ticket.number)}\``, inline: true },
        { name: 'Category', value: `${type?.emoji ?? ''} ${type?.label ?? ticket.typeId}`, inline: true },
        { name: 'Duration', value: duration(ticket.closedAt - ticket.createdAt), inline: true },
        { name: 'Handled by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'Closed by', value: `<@${actor.id}>`, inline: true },
      );
    if (reason) dm.addFields({ name: 'Reason', value: reason.slice(0, 1024) });
    if (D.dmTranscript && transcript) dm.addFields({ name: '📄 Transcript', value: 'Attached – open the file in your browser.' });
    await owner
      .send({
        embeds: [dm],
        files: D.dmTranscript && transcript ? [transcript.attachment] : [],
        components: D.askForRating ? [ratingRow(channel.id)] : [],
      })
      .catch(() => null);
  }

  const links = [];
  if (transcript?.url) links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(transcript.url).setLabel('Transcript').setEmoji('📄'));
  links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channel.url).setLabel('Channel').setEmoji('🎫'));
  await sendLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.danger, '🔒 Ticket closed', owner).addFields(
        { name: 'Ticket', value: `${channel}\n\`#${pad(ticket.number)}\``, inline: true },
        { name: 'Author', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Closed by', value: `<@${actor.id}>`, inline: true },
        { name: 'Handled by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'Duration', value: duration(ticket.closedAt - ticket.createdAt), inline: true },
        { name: 'Messages', value: String(transcript?.messageCount ?? '—'), inline: true },
        { name: 'Reason', value: reason?.slice(0, 1024) || '—' },
      ),
    ],
    components: [new ActionRowBuilder().addComponents(links)],
  });
}

async function reopenTicket(channel, actor) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('This is not a ticket channel.');
  if (ticket.status !== 'closed') throw new UserError('This ticket is not closed.');

  const settings = db.settings(channel.guild.id);
  const openIds = [settings.categoryId, ...(settings.overflowCategoryIds ?? [])];
  if (settings.closedCategoryId && !openIds.includes(channel.parentId)) {
    const parent = await openCategoryWithRoom(channel.guild);
    if (parent) {
      await channel
        .setParent(parent, { lockPermissions: false })
        .catch((err) => console.warn(`[tickets] Could not move #${channel.name} back to the open category:`, err.message));
    }
  }
  for (const id of [ticket.ownerId, ...ticket.participants]) {
    await channel.permissionOverwrites
      .edit(id, allow(OWNER_PERMS), AS_MEMBER)
      .catch((err) => console.warn(`[tickets] Could not give ${id} access to #${channel.name}:`, err.message));
  }
  db.updateTicket(channel.id, { status: 'open', closedAt: null, closedBy: null, closeReason: null, lastActivity: Date.now(), lastMessageBy: 'staff', warned: false });
  await refreshControlMessage(channel, ticket);
  schedulePanelRefresh(channel.guild);

  await channel.send(
    ui.notice(COLORS.success, `## 🔓 Ticket reopened\n<@${ticket.ownerId}>, <@${actor.id}> has reopened your ticket.`, { mentions: { users: [ticket.ownerId] } }),
  );
  await sendLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.success, '🔓 Ticket reopened', actor.user ?? actor).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'By', value: `<@${actor.id}>`, inline: true },
      ),
    ],
  });
}

async function deleteTicket(channel, actor) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('This is not a ticket channel.');
  if (ticket.status === 'deleted') throw new UserError('This ticket is already being deleted.');

  if (ticket.status === 'open') {
    db.updateTicket(channel.id, { closedAt: Date.now(), closedBy: actor.id, closeReason: 'Deleted without closing' });
    await archiveTranscript(channel, ticket, actor).catch((err) => console.error('[transcript]', err));
  }
  db.updateTicket(channel.id, { status: 'deleted', deletedAt: Date.now(), deletedBy: actor.id });
  schedulePanelRefresh(channel.guild);

  const delay = D.deleteDelaySeconds ?? 5;
  await channel.send(ui.notice(COLORS.danger, `🗑️ **This ticket will be deleted ${ts(Date.now() + delay * 1000, 'R')}**\n-# The transcript has been saved.`));
  await sendLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.muted, '🗑️ Ticket deleted', actor.user ?? actor).addFields(
        { name: 'Ticket', value: `#${channel.name} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Author', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Deleted by', value: `<@${actor.id}>`, inline: true },
      ),
    ],
    components: ticket.transcriptUrl
      ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(ticket.transcriptUrl).setLabel('Transcript').setEmoji('📄'))]
      : [],
  });
  setTimeout(() => channel.delete(`Ticket deleted by ${actor.user?.tag ?? actor.tag ?? actor.id}`).catch(() => null), delay * 1000);
}

async function requestClose(channel, staff) {
  const ticket = requireOpen(channel);
  if (ticket.closeRequest) throw new UserError("A close request is already waiting for the author's answer.");
  const msg = await channel.send(ui.closeRequestCard(ticket, staff.id));
  db.updateTicket(channel.id, { closeRequest: { by: staff.id, messageId: msg.id, at: Date.now() }, lastMessageBy: 'staff', lastActivity: Date.now() });
}

async function answerCloseRequest(channel, member, accepted, message) {
  const ticket = requireOpen(channel);
  if (!ticket.closeRequest) throw new UserError('This request is no longer valid.');
  await message.edit(ui.closeRequestCard(ticket, ticket.closeRequest.by, accepted ? 'accepted' : 'denied')).catch(() => null);
  const by = ticket.closeRequest.by;
  db.updateTicket(channel.id, { closeRequest: null });
  if (accepted) {
    await closeTicket(channel, member, 'The author confirmed the issue is resolved');
  } else {
    db.updateTicket(channel.id, { lastMessageBy: 'owner', lastActivity: Date.now(), warned: false });
    await channel.send(ui.notice(COLORS.warning, `🔔 <@${by}>, the author still needs help.`, { mentions: { users: [by] } }));
  }
}

async function claimTicket(channel, member) {
  const ticket = requireOpen(channel);
  if (ticket.claimedBy === member.id) throw new UserError('You are already handling this ticket.');
  if (ticket.claimedBy && !isAdmin(member)) throw new UserError(`This ticket is already handled by <@${ticket.claimedBy}>.`);
  const previous = ticket.claimedBy;
  db.updateTicket(channel.id, { claimedBy: member.id });
  await refreshControlMessage(channel, ticket);
  await channel.send(
    ui.notice(
      COLORS.success,
      `### 🙋 ${member.displayName} will take care of your ticket\n<@${ticket.ownerId}>, from now on ${member} is handling your ticket.` +
        (previous ? `\n-# Taken over from <@${previous}>` : ''),
      { thumbnail: member.displayAvatarURL?.({ size: 128 }) },
    ),
  );
  await sendLog(channel.guild, {
    embeds: [logEmbed(COLORS.brand, '🙋 Ticket claimed', member.user).setDescription(`${member} claimed ${channel} (\`#${pad(ticket.number)}\`)`)],
  });
}

async function unclaimTicket(channel, member) {
  const ticket = requireOpen(channel);
  if (!ticket.claimedBy) throw new UserError('Nobody has claimed this ticket.');
  if (ticket.claimedBy !== member.id && !isAdmin(member)) throw new UserError('Only the person handling the ticket (or an administrator) can unclaim it.');
  db.updateTicket(channel.id, { claimedBy: null });
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.notice(COLORS.warning, `↩️ ${member} is no longer handling this ticket – waiting for another staff member.`));
}

async function addUsers(channel, users, actor) {
  const ticket = requireOpen(channel);
  const added = [];
  for (const user of users) {
    if (user.bot || user.id === ticket.ownerId || ticket.participants.includes(user.id)) continue;
    await channel.permissionOverwrites.edit(user.id, allow(OWNER_PERMS), AS_MEMBER);
    ticket.participants.push(user.id);
    added.push(user.id);
  }
  if (!added.length) throw new UserError('The selected members already have access to the ticket (or are bots).');
  db.updateTicket(channel.id, { participants: ticket.participants });
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.notice(COLORS.success, `➕ ${actor} added to the ticket: ${added.map((id) => `<@${id}>`).join(', ')}`, { mentions: { users: added } }));
  return added.length;
}

const addUser = (channel, user, actor) => addUsers(channel, [user], actor);

async function removeUser(channel, user, actor) {
  const ticket = requireOpen(channel);
  if (user.id === ticket.ownerId) throw new UserError('You cannot remove the ticket author.');
  if (!ticket.participants.includes(user.id)) throw new UserError(`${user} is not added to this ticket.`);
  await channel.permissionOverwrites.delete(user.id);
  db.updateTicket(channel.id, { participants: ticket.participants.filter((id) => id !== user.id) });
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.notice(COLORS.warning, `➖ ${actor} removed ${user} from the ticket.`));
}

async function setPriority(channel, level, actor) {
  const ticket = requireOpen(channel);
  if (!PRIORITIES[level]) throw new UserError('Unknown priority.');
  if (ticket.priority === level) throw new UserError('The ticket already has this priority.');
  db.updateTicket(channel.id, { priority: level });
  await refreshControlMessage(channel, ticket);
  const renamed = await safeRename(channel, channelName(ticket, config.getType(ticket.typeId))).catch(() => ({ ok: false }));
  if (renamed.ok) db.updateTicket(channel.id, { customName: false }); // the generated name is back
  const p = PRIORITIES[level];
  await channel.send(
    ui.notice(
      p.color,
      `${p.emoji} ${actor} changed the priority to **${p.label}**.` +
        (renamed.wait ? `\n-# The channel name will update on the next change (Discord limit, ~${renamed.wait} min).` : ''),
    ),
  );
}

async function moveTicket(channel, typeId, actor) {
  const ticket = requireOpen(channel);
  const from = config.getType(ticket.typeId);
  const to = config.getType(typeId);
  if (!to) throw new UserError('There is no such category.');
  if (to.id === ticket.typeId) throw new UserError('The ticket is already in this category.');

  const guild = channel.guild;
  const oldRoles = new Set(staffRoleIds(guild.id, from));
  const newRoles = new Set(staffRoleIds(guild.id, to));
  for (const id of newRoles) {
    if (guild.roles.cache.has(id)) await channel.permissionOverwrites.edit(id, allow(STAFF_PERMS)).catch(() => null);
  }
  for (const id of oldRoles) {
    if (!newRoles.has(id)) await channel.permissionOverwrites.delete(id).catch(() => null);
  }

  db.updateTicket(channel.id, { typeId: to.id });
  await refreshControlMessage(channel, ticket);
  const renamed = await safeRename(channel, channelName(ticket, to)).catch(() => ({ ok: false }));
  if (renamed.ok) db.updateTicket(channel.id, { customName: false });
  const pings = [...newRoles].filter((id) => !oldRoles.has(id) && guild.roles.cache.has(id));
  await channel.send(
    ui.notice(
      COLORS.brand,
      `🔁 ${actor} moved the ticket: **${from?.emoji ?? ''} ${from?.label ?? '?'}** → **${to.emoji ?? ''} ${to.label}**` +
        (pings.length ? `\n🔔 ${pings.map((id) => `<@&${id}>`).join(' ')}` : '') +
        (renamed.wait ? `\n-# The channel name will change later (Discord limit, ~${renamed.wait} min).` : ''),
      { mentions: { roles: pings } },
    ),
  );
}

async function renameTicket(channel, name) {
  requireOpen(channel);
  const result = await safeRename(channel, name);
  if (!result.ok) throw new UserError(`Discord only allows renaming a channel twice per 10 minutes. Try again in ~${result.wait} min.`);
  db.updateTicket(channel.id, { customName: true }); // /build only:names leaves it alone
}

async function pingStaff(channel, member) {
  const ticket = requireOpen(channel);
  if (ticket.ownerId !== member.id) throw new UserError('Only the ticket author can call support.');
  const after = (D.pingStaffAfterMinutes ?? 10) * 60_000;
  const cooldown = (D.pingStaffCooldownMinutes ?? 30) * 60_000;
  if (Date.now() - ticket.createdAt < after) throw new UserError(`Give us a moment 🙂 You can call support ${ts(ticket.createdAt + after, 'R')}.`);
  if (ticket.lastMessageBy === 'staff') throw new UserError('Support has already replied – check the latest messages.');
  if (ticket.lastStaffPing && Date.now() - ticket.lastStaffPing < cooldown) {
    throw new UserError(`Support has already been called. You can call again ${ts(ticket.lastStaffPing + cooldown, 'R')}.`);
  }
  db.updateTicket(channel.id, { lastStaffPing: Date.now() });
  const roles = ticket.claimedBy ? [] : staffRoleIds(channel.guild.id, config.getType(ticket.typeId)).filter((id) => channel.guild.roles.cache.has(id));
  const who = ticket.claimedBy ? `<@${ticket.claimedBy}>` : roles.map((id) => `<@&${id}>`).join(' ') || 'Support';
  await channel.send(
    ui.notice(COLORS.warning, `🔔 ${who} – <@${ticket.ownerId}> has been waiting for a reply for ${duration(Date.now() - ticket.lastActivity)}.`, {
      mentions: { users: ticket.claimedBy ? [ticket.claimedBy] : [], roles },
    }),
  );
}

async function stillNeedHelp(channel, member, message) {
  const ticket = requireOpen(channel);
  if (ticket.ownerId !== member.id) throw new UserError('This button is for the ticket author.');
  db.updateTicket(channel.id, { lastMessageBy: 'owner', lastActivity: Date.now(), warned: false });
  await message.edit(ui.notice(COLORS.success, `✋ <@${ticket.ownerId}> still needs help – automatic closing cancelled.`)).catch(() => null);
}

async function sendSnippet(channel, snippet, staff) {
  const ticket = requireOpen(channel);
  const content = snippet.content.replaceAll('{user}', `<@${ticket.ownerId}>`).replaceAll('{staff}', `${staff}`).replaceAll('{server}', channel.guild.name);
  await channel.send(
    ui.notice(COLORS.brand, `${content}\n-# 💬 ${staff.displayName} · ${snippet.name}`, {
      thumbnail: staff.displayAvatarURL?.({ size: 128 }),
      mentions: { users: [ticket.ownerId] },
    }),
  );
  const patch = { lastActivity: Date.now(), lastMessageBy: 'staff', warned: false };
  if (!ticket.firstResponseAt) {
    patch.firstResponseAt = Date.now();
    schedulePanelRefresh(channel.guild);
  }
  db.updateTicket(channel.id, patch);
}

/** The open, not yet completed purchase ticket in this channel (or a UserError). */
function requireCompletable(channel) {
  const ticket = requireOpen(channel);
  if (ticket.typeId !== 'order') throw new UserError('Only purchase tickets can be marked as completed.');
  if (ticket.completedAt) throw new UserError('This order is already marked as completed.');
  return ticket;
}

/** The "Complete order" form (amount paid) for this ticket. */
const completeForm = (channel) => ui.completeOrderModal(requireCompletable(channel));

/** Product, quantity and payment method of an order – from the shop order form, or the Purchase ticket form. */
function orderDetails(ticket) {
  if (ticket.order) return ticket.order;
  const type = config.getType(ticket.typeId);
  const answer = (id, ...labels) => {
    const q = type?.questions.find((x) => x.id === id);
    return ticket.answers?.find((a) => a.label === q?.label || labels.includes(a.label))?.value?.trim() || null;
  };
  const quantity = Number(answer('quantity', 'Quantity'));
  return {
    productId: null,
    product: answer('product', 'Product'),
    quantity: Number.isInteger(quantity) && quantity > 0 ? quantity : 1,
    method: answer('payment', 'Payment method'),
    promo: null,
    discount: 0,
    total: null,
  };
}

function nextSaleId(guildId) {
  const ids = new Set(db.sales(guildId).map((s) => s.id));
  let n = ids.size + 1;
  while (ids.has(`S-${pad(n)}`)) n += 1;
  return `S-${pad(n)}`;
}

/**
 * Staff marks a purchase as delivered: records the sale, redeems the promo code, gives the author the
 * Customer role (and Loyal Customer after enough orders) and posts a card asking for a vouch.
 *
 * amount  – what the customer actually paid: a number, null (unknown) or undefined (= the order total, if known)
 * respond – answers the interaction ({ orders, loyal, sale }); the orderCompleted hook (receipt, proof,
 *           vouch reminder…) runs after it, so the staff member gets an answer first.
 */
async function completeOrder(channel, staff, { amount, respond } = {}) {
  const ticket = requireCompletable(channel);
  const order = orderDetails(ticket);
  const paid = amount === undefined ? order.total ?? null : amount;
  if (paid != null && !(Number.isFinite(paid) && paid >= 0)) throw new UserError('The amount paid must be a number of 0 or more (e.g. 19.99).');
  const guild = channel.guild;
  const g = db.guild(guild.id);
  g.orders[ticket.ownerId] = (g.orders[ticket.ownerId] ?? 0) + 1;
  const orders = g.orders[ticket.ownerId];
  const now = Date.now();
  const sale = db.addSale(guild.id, {
    id: nextSaleId(guild.id),
    ticketNumber: ticket.number,
    channelId: channel.id,
    userId: ticket.ownerId,
    sellerId: staff.id,
    productId: order.productId ?? null,
    product: order.product ?? null,
    quantity: order.quantity ?? 1,
    amount: paid == null ? null : Math.round(paid * 100) / 100,
    currency: config.shop.currency ?? '€',
    method: order.method ?? null,
    promo: order.promo ?? null,
    discount: order.discount ?? 0,
    createdAt: ticket.createdAt,
    completedAt: now,
  });
  if (sale.promo) promos.redeem(guild.id, sale.promo, ticket.ownerId, sale.id);
  db.updateTicket(channel.id, { completedAt: now, completedBy: staff.id, saleId: sale.id, lastMessageBy: 'staff', lastActivity: now });

  const member = await guild.members.fetch(ticket.ownerId).catch(() => null);
  const customerRole = db.roleId(guild.id, 'customer');
  const loyalRole = db.roleId(guild.id, 'loyal');
  const loyalAfter = Number(config.shop.loyalAfterOrders) || 0;
  let loyal = false;
  if (member) {
    if (customerRole && guild.roles.cache.has(customerRole)) await member.roles.add(customerRole, `Order #${pad(ticket.number)} completed`).catch(() => null);
    if (loyalRole && loyalAfter > 0 && orders >= loyalAfter && guild.roles.cache.has(loyalRole) && !member.roles.cache.has(loyalRole)) {
      loyal = await member.roles.add(loyalRole, `${orders} completed orders`).then(() => true).catch(() => false);
    }
  }
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.orderCompletedCard(guild, ticket, staff.id, { loyal, orders, sale }));
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '✅ Order completed', staff.user ?? staff).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Orders so far', value: String(orders), inline: true },
        { name: 'Sale', value: `\`${sale.id}\``, inline: true },
        { name: 'Amount paid', value: money(sale.amount), inline: true },
        { name: 'Promo code', value: sale.promo ? `${sale.promo} (−${money(sale.discount)})` : '—', inline: true },
      ),
    ],
  });
  const result = { orders, loyal, sale };
  try {
    if (respond) await respond(result);
  } finally {
    await hooks.emit('orderCompleted', { guild, ticket: db.getTicket(channel.id), member, staff, sale });
  }
  return result;
}

function requireOpen(channel) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('This action can only be used in a ticket channel.');
  if (ticket.status !== 'open') throw new UserError('This ticket is closed.');
  return ticket;
}

async function saveRating(client, channelId, userId, stars, comment) {
  const ticket = db.getTicket(channelId);
  if (!ticket || ticket.ownerId !== userId) throw new UserError('You cannot rate this ticket.');
  if (ticket.rating) throw new UserError('This ticket has already been rated. Thank you!');
  db.updateTicket(channelId, { rating: { stars, comment: comment || null, at: Date.now() } });

  const guild = client.guilds.cache.get(ticket.guildId);
  if (guild) {
    const user = await client.users.fetch(userId).catch(() => null);
    await sendLog(guild, {
      embeds: [
        logEmbed(stars >= 4 ? COLORS.success : stars === 3 ? COLORS.warning : COLORS.danger, '⭐ New support rating', user)
          .setDescription(`## ${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)}\n**${stars}/5**`)
          .addFields(
            { name: 'Ticket', value: `\`#${pad(ticket.number)}\``, inline: true },
            { name: 'Author', value: `<@${ticket.ownerId}>`, inline: true },
            { name: 'Handled by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
            ...(comment ? [{ name: 'Comment', value: `>>> ${comment.slice(0, 1000)}` }] : []),
          ),
      ],
    });
  }
}

async function runInactivityCheck(client) {
  const now = Date.now();
  for (const ticket of db.tickets((t) => t.status === 'open')) {
    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild) continue;
    const channel = guild.channels.cache.get(ticket.channelId);
    if (!channel) {
      db.updateTicket(ticket.channelId, { status: 'deleted', deletedAt: now });
      continue;
    }
    const settings = db.settings(guild.id);
    if (!settings.autoCloseHours || settings.autoCloseHours <= 0) continue;
    if (ticket.lastMessageBy !== 'staff') continue;

    const idle = now - ticket.lastActivity;
    const closeAfter = settings.autoCloseHours * 3_600_000;
    const warnAfter = settings.autoCloseWarningHours * 3_600_000;
    try {
      if (idle >= closeAfter) {
        await closeTicket(channel, client.user, `Closed automatically – no reply for ${duration(idle)}`);
      } else if (warnAfter > 0 && warnAfter < closeAfter && idle >= warnAfter && !ticket.warned) {
        db.updateTicket(ticket.channelId, { warned: true });
        await channel.send(ui.inactivityWarning(ticket, ticket.lastActivity + closeAfter));
      }
    } catch (err) {
      console.error(`[auto-close] ticket ${ticket.channelId}:`, err.message);
    }
  }
}

module.exports = {
  UserError,
  labeledInput,
  refreshControlMessage,
  buildPanel,
  schedulePanelRefresh,
  buildForm,
  checkCanOpen,
  openTicket,
  closeTicket,
  reopenTicket,
  deleteTicket,
  requestClose,
  answerCloseRequest,
  claimTicket,
  unclaimTicket,
  addUser,
  addUsers,
  removeUser,
  setPriority,
  moveTicket,
  renameTicket,
  pingStaff,
  stillNeedHelp,
  sendSnippet,
  requireCompletable,
  completeForm,
  orderDetails,
  completeOrder,
  archiveTranscript,
  saveRating,
  runInactivityCheck,
};
