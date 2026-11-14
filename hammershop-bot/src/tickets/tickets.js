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
const lockdown = require('../features/lockdown');
const ui = require('./ui');
const { createTranscript } = require('./transcript');
const { openDeniedReason } = require('../lib/permissions');
const { statusOf } = require('../lib/orderStatus');
const { numberedCategoryName } = require('../builder/style');
const { slash } = require('../lib/commandsPl');
const {
  UserError,
  COLORS,
  PRIORITIES,
  embed,
  logEmbed,
  staffRoleIds,
  isAdmin,
  isStaff,
  safeRename,
  channelName,
  duration,
  pad,
  ts,
  sendTicketLog,
  money,
  count,
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
      reason: 'Kategoria ticketów jest pełna (50 kanałów) – kategoria dodatkowa',
    })
    .catch((err) => {
      console.error('[tickets] Nie udało się utworzyć dodatkowej kategorii ticketów:', err.message);
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
    const ok = await ch?.delete('Kategoria zamkniętych ticketów jest pełna – usuwam najstarszy zamknięty ticket (transkrypcja jest zapisana)').then(() => true).catch(() => false);
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

/** force – an order already paid elsewhere (the website): only a ticket system that isn't set up stops it. */
function checkCanOpen(member, { force = false } = {}) {
  const settings = db.settings(member.guild.id);
  const category = member.guild.channels.cache.get(settings.categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return `System ticketów nie jest jeszcze skonfigurowany. Administrator musi użyć \`${slash('build')}\` (albo \`${slash('setup set')}\`).`;
  }
  if (force) return null;
  if (lockdown.pausedFor(member)) {
    return 'Serwer jest teraz zablokowany – nowe tickety i zamówienia są wstrzymane do odblokowania. Twoje otwarte tickety działają normalnie.';
  }
  const roleError = openDeniedReason(member);
  if (roleError) return roleError;
  if (db.isBlacklisted(member.guild.id, member.id)) {
    const entry = db.blacklist(member.guild.id).find((b) => b.userId === member.id);
    return `Masz blokadę tworzenia ticketów.${entry?.reason ? `\n**Powód:** ${entry.reason}` : ''}`;
  }
  const open = db.tickets((t) => t.guildId === member.guild.id && t.ownerId === member.id && t.status === 'open');
  if (settings.maxOpenTicketsPerUser > 0 && open.length >= settings.maxOpenTicketsPerUser) {
    return `Osiągnięto limit otwartych ticketów (**${settings.maxOpenTicketsPerUser}**).\nTwoje tickety: ${open.map((t) => `<#${t.channelId}>`).join(', ')}`;
  }
  const cooldown = (D.openCooldownSeconds ?? 0) * 1000;
  const last = lastOpened.get(`${member.guild.id}:${member.id}`);
  if (cooldown && last && Date.now() - last < cooldown && !isAdmin(member)) {
    return `Zwolnij trochę! Kolejny ticket możesz otworzyć ${ts(last + cooldown, 'R')}.`;
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
  await msg.edit(payload).catch((err) => console.warn('[card] Nie udało się odświeżyć karty:', err.message));
}

/** extra: more ticket fields, stored before the first card is posted (the shop's `order`, so the card shows that product). */
async function openTicket(member, type, answers = [], extra = {}, { force = false } = {}) {
  const guild = member.guild;
  const key = `${guild.id}:${member.id}`;
  if (creating.has(key)) throw new UserError('Twój ticket właśnie się tworzy, chwileczkę…');

  const error = checkCanOpen(member, { force });
  if (error) throw new UserError(error);
  // A category switched off with /tickety (the team can still open one by hand with force).
  if (!force && require('./typestate').isOff(guild.id, type)) throw new UserError(require('./typestate').closedText(type));

  creating.add(key);
  try {
    const settings = db.settings(guild.id);
    const staffRoles = staffRoleIds(guild.id, type).filter((id) => guild.roles.cache.has(id));
    const parent = await openCategoryWithRoom(guild);
    if (!parent) throw new UserError('System ticketów jest teraz pełny – spróbuj ponownie za kilka minut albo skontaktuj się z zespołem.');
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
      reason: `Ticket #${number} otwarty przez ${member.user.tag ?? member.user.username}`,
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
              .setTitle(`${type.emoji ?? '🎫'} Twój ticket został utworzony`)
              .setDescription(
                `**Kategoria:** ${type.label}\n**Numer:** \`#${pad(number)}\`\n\n` +
                  'Nasz zespół odpowie najszybciej, jak to możliwe. Damy Ci znać, gdy ticket zostanie zamknięty.\n' +
                  '-# 🔒 Zespół nigdy nie poprosi Cię o płatność w prywatnej wiadomości – tylko w Twoim tickecie.',
              ),
          ],
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channel.url).setLabel('Przejdź do ticketu').setEmoji('🎫'),
            ),
          ],
        })
        .catch(() => null);
    }

    await sendTicketLog(guild, {
      embeds: [
        logEmbed(COLORS.success, '📥 Ticket otwarty', member.user)
          .setThumbnail(member.user.displayAvatarURL?.() ?? null)
          .addFields(
            { name: 'Ticket', value: `${channel}\n\`#${pad(number)}\``, inline: true },
            { name: 'Kategoria', value: `${type.emoji ?? ''} ${type.label}`, inline: true },
            { name: 'Autor', value: `${member}\n\`${member.id}\``, inline: true },
            ...answers.slice(0, 4).map((a) => ({ name: a.label.slice(0, 256), value: (a.value || '—').slice(0, 300) })),
          ),
      ],
      components: [
        new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channel.url).setLabel('Otwórz').setEmoji('🎫')),
      ],
    });

    await hooks.emit('ticketOpened', { guild, channel, ticket: db.getTicket(channel.id), member, type }); // e.g. the AI assistant (features/aiassistant.js)
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

  const summary = logEmbed(COLORS.brand, `📄 Transkrypcja · #${channel.name}`, owner).addFields(
    { name: 'Autor', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Kategoria', value: `${type?.emoji ?? ''} ${type?.label ?? ticket.typeId}`, inline: true },
    { name: 'Obsługa', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
    { name: 'Zamknięty przez', value: actor ? `<@${actor.id}>` : '—', inline: true },
    { name: 'Czas trwania', value: duration(Date.now() - ticket.createdAt), inline: true },
    { name: 'Wiadomości', value: `${messageCount} · ${count(participants.size, 'osoba', 'osoby', 'osób')}`, inline: true },
  );
  if (ticket.closeReason) summary.addFields({ name: 'Powód zamknięcia', value: ticket.closeReason.slice(0, 1024) });

  let url = null;
  const target = settings.transcriptChannelId ? await channel.guild.channels.fetch(settings.transcriptChannelId).catch(() => null) : null;
  if (target?.isTextBased?.()) {
    const sent = await target.send({ embeds: [summary], files: [attachment] }).catch(() => null);
    url = sent?.url ?? null; // the #transkrypcje message – its file link never expires there
    if (url) db.updateTicket(channel.id, { transcriptUrl: url });
  }
  return { attachment, messageCount, url };
}

function ratingRow(channelId) {
  const labels = ['Źle', 'Słabo', 'W porządku', 'Dobrze', 'Świetnie'];
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
  if (!ticket) throw new UserError('To nie jest kanał ticketu.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest już zamknięty.');

  const settings = db.settings(channel.guild.id);
  db.updateTicket(channel.id, { status: 'closed', closedAt: Date.now(), closedBy: actor.id, closeReason: reason, closeRequest: null });
  schedulePanelRefresh(channel.guild);

  let transcript = null;
  try {
    transcript = await archiveTranscript(channel, ticket, actor);
  } catch (err) {
    console.error('[transcript] Błąd tworzenia transkrypcji:', err);
  }

  for (const id of [ticket.ownerId, ...ticket.participants]) {
    await channel.permissionOverwrites
      .edit(id, { ViewChannel: false, SendMessages: false }, AS_MEMBER)
      .catch((err) => console.warn(`[tickets] Nie udało się usunąć ${id} z #${channel.name}:`, err.message));
  }
  if (settings.closedCategoryId && channel.guild.channels.cache.has(settings.closedCategoryId)) {
    await makeRoomInClosed(channel.guild, settings.closedCategoryId);
    await channel
      .setParent(settings.closedCategoryId, { lockPermissions: false })
      .catch((err) => console.warn(`[tickets] Nie udało się przenieść #${channel.name} do kategorii zamkniętych:`, err.message));
  }

  await refreshControlMessage(channel, ticket);
  await channel.send(ui.closedCard(ticket, actor.id, { messageCount: transcript?.messageCount, transcriptUrl: transcript?.url }));

  const owner = await channel.client.users.fetch(ticket.ownerId).catch(() => null);
  const type = config.getType(ticket.typeId);
  if (owner && (D.dmTranscript || D.askForRating)) {
    const dm = embed(COLORS.brand)
      .setAuthor({ name: channel.guild.name, iconURL: channel.guild.iconURL?.() ?? undefined })
      .setTitle('🔒 Twój ticket został zamknięty')
      .setDescription(
        `Dziękujemy za kontakt, **${owner.globalName ?? owner.username}**! 🧡` +
          (D.askForRating ? '\n\n**Jak oceniasz naszą pomoc?** Kliknij ocenę poniżej – zajmie Ci to 5 sekund, a nam bardzo pomoże.' : ''),
      )
      .addFields(
        { name: 'Ticket', value: `\`#${pad(ticket.number)}\``, inline: true },
        { name: 'Kategoria', value: `${type?.emoji ?? ''} ${type?.label ?? ticket.typeId}`, inline: true },
        { name: 'Czas trwania', value: duration(ticket.closedAt - ticket.createdAt), inline: true },
        { name: 'Obsługa', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'Zamknięty przez', value: `<@${actor.id}>`, inline: true },
      );
    if (reason) dm.addFields({ name: 'Powód', value: reason.slice(0, 1024) });
    if (D.dmTranscript && transcript) dm.addFields({ name: '📄 Transkrypcja', value: 'W załączniku – otwórz plik w przeglądarce.' });
    await owner
      .send({
        embeds: [dm],
        files: D.dmTranscript && transcript ? [transcript.attachment] : [],
        components: D.askForRating ? [ratingRow(channel.id)] : [],
      })
      .catch(() => null);
  }

  const links = [];
  if (transcript?.url) links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(transcript.url).setLabel('Transkrypcja').setEmoji('📄'));
  links.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channel.url).setLabel('Kanał').setEmoji('🎫'));
  await sendTicketLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.danger, '🔒 Ticket zamknięty', owner).addFields(
        { name: 'Ticket', value: `${channel}\n\`#${pad(ticket.number)}\``, inline: true },
        { name: 'Autor', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Zamknięty przez', value: `<@${actor.id}>`, inline: true },
        { name: 'Obsługa', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'Czas trwania', value: duration(ticket.closedAt - ticket.createdAt), inline: true },
        { name: 'Wiadomości', value: String(transcript?.messageCount ?? '—'), inline: true },
        { name: 'Powód', value: reason?.slice(0, 1024) || '—' },
      ),
    ],
    components: [new ActionRowBuilder().addComponents(links)],
  });
}

async function reopenTicket(channel, actor) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('To nie jest kanał ticketu.');
  if (ticket.status !== 'closed') throw new UserError('Ten ticket nie jest zamknięty.');

  const settings = db.settings(channel.guild.id);
  const openIds = [settings.categoryId, ...(settings.overflowCategoryIds ?? [])];
  if (settings.closedCategoryId && !openIds.includes(channel.parentId)) {
    const parent = await openCategoryWithRoom(channel.guild);
    if (parent) {
      await channel
        .setParent(parent, { lockPermissions: false })
        .catch((err) => console.warn(`[tickets] Nie udało się przenieść #${channel.name} z powrotem do kategorii otwartych:`, err.message));
    }
  }
  for (const id of [ticket.ownerId, ...ticket.participants]) {
    await channel.permissionOverwrites
      .edit(id, allow(OWNER_PERMS), AS_MEMBER)
      .catch((err) => console.warn(`[tickets] Nie udało się dać ${id} dostępu do #${channel.name}:`, err.message));
  }
  // Closing released the order's promo code – take it again only if it's still free (checked and saved
  // together, so no other order can take it in between).
  const dropped = require('../features/shop').recheckOrderPromo(channel.guild.id, ticket);
  db.updateTicket(channel.id, {
    status: 'open',
    closedAt: null,
    closedBy: null,
    closeReason: null,
    lastActivity: Date.now(),
    lastMessageBy: 'staff',
    warned: false,
    ...(dropped && { order: dropped.order, answers: dropped.answers }),
  });
  await refreshControlMessage(channel, ticket);
  schedulePanelRefresh(channel.guild);

  let text = `## 🔓 Ticket otwarty ponownie\n<@${ticket.ownerId}>, Twój ticket został ponownie otwarty przez <@${actor.id}>.`;
  if (dropped) {
    text +=
      `\n### ⚠️ Kod rabatowy **${dropped.code}** już nie obowiązuje\n` +
      `Kod został zwolniony, gdy ticket był zamknięty, i nie można go już użyć do tego zamówienia: ${dropped.error}\n` +
      (dropped.order.total != null ? `Do zapłaty teraz: **${money(dropped.order.total)}**` : 'Sprzedawca potwierdzi ostateczną cenę bez rabatu.');
  }
  await channel.send(ui.notice(dropped ? COLORS.warning : COLORS.success, text, { mentions: { users: [ticket.ownerId] } }));
  await sendTicketLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.success, '🔓 Ticket otwarty ponownie', actor.user ?? actor).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Otwarty przez', value: `<@${actor.id}>`, inline: true },
        ...(dropped ? [{ name: 'Kod rabatowy', value: `${dropped.code} usunięty – ${dropped.error}`.slice(0, 1024) }] : []),
      ),
    ],
  });
}

async function deleteTicket(channel, actor) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('To nie jest kanał ticketu.');
  if (ticket.status === 'deleted') throw new UserError('Ten ticket jest już usuwany.');

  if (ticket.status === 'open') {
    db.updateTicket(channel.id, { closedAt: Date.now(), closedBy: actor.id, closeReason: 'Usunięty bez zamykania' });
    await archiveTranscript(channel, ticket, actor).catch((err) => console.error('[transcript]', err));
  }
  db.updateTicket(channel.id, { status: 'deleted', deletedAt: Date.now(), deletedBy: actor.id });
  schedulePanelRefresh(channel.guild);

  const delay = D.deleteDelaySeconds ?? 5;
  await channel.send(ui.notice(COLORS.danger, `🗑️ **Ten ticket zostanie usunięty ${ts(Date.now() + delay * 1000, 'R')}**\n-# Transkrypcja została zapisana.`));
  await sendTicketLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.muted, '🗑️ Ticket usunięty', actor.user ?? actor).addFields(
        { name: 'Ticket', value: `#${channel.name} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Autor', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Usunięty przez', value: `<@${actor.id}>`, inline: true },
      ),
    ],
    components: ticket.transcriptUrl
      ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(ticket.transcriptUrl).setLabel('Transkrypcja').setEmoji('📄'))]
      : [],
  });
  setTimeout(() => channel.delete(`Ticket usunięty przez ${actor.user?.tag ?? actor.tag ?? actor.id}`).catch(() => null), delay * 1000);
}

/**
 * A message in an open ticket: activity for auto-close, who spoke last, the first staff answer.
 * A pending close request stays valid – a customer often writes "thanks, all good!" and then clicks Yes.
 */
function trackMessage(message) {
  const ticket = db.getTicket(message.channel.id);
  if (!ticket || ticket.status !== 'open') return;
  const fromStaff = message.author.id !== ticket.ownerId && isStaff(message.member, config.getType(ticket.typeId));
  const patch = { lastActivity: Date.now(), lastMessageBy: fromStaff ? 'staff' : 'owner', warned: false };
  if (!fromStaff && ticket.lastMessageBy === 'staff') patch.waitingSince = Date.now(); // the customer waits from here
  if (fromStaff && !ticket.firstResponseAt) {
    patch.firstResponseAt = Date.now();
    schedulePanelRefresh(message.guild);
  }
  db.updateTicket(message.channel.id, patch);
}

async function requestClose(channel, staff) {
  const ticket = requireOpen(channel);
  if (ticket.closeRequest) throw new UserError('Prośba o zamknięcie już czeka na odpowiedź autora.');
  const msg = await channel.send(ui.closeRequestCard(ticket, staff.id));
  db.updateTicket(channel.id, { closeRequest: { by: staff.id, messageId: msg.id, at: Date.now() }, lastMessageBy: 'staff', lastActivity: Date.now() });
}

async function answerCloseRequest(channel, member, accepted, message) {
  const ticket = requireOpen(channel);
  if (!ticket.closeRequest) throw new UserError('Ta prośba jest już nieaktualna.');
  await message.edit(ui.closeRequestCard(ticket, ticket.closeRequest.by, accepted ? 'accepted' : 'denied')).catch(() => null);
  const by = ticket.closeRequest.by;
  db.updateTicket(channel.id, { closeRequest: null });
  if (accepted) {
    await closeTicket(channel, member, 'Sprawa załatwiona – potwierdzone przez autora');
  } else {
    db.updateTicket(channel.id, { lastMessageBy: 'owner', lastActivity: Date.now(), warned: false, ...(ticket.lastMessageBy === 'staff' && { waitingSince: Date.now() }) });
    await channel.send(ui.notice(COLORS.warning, `🔔 <@${by}>, autor nadal potrzebuje pomocy.`, { mentions: { users: [by] } }));
  }
}

async function claimTicket(channel, member) {
  const ticket = requireOpen(channel);
  if (ticket.claimedBy === member.id) throw new UserError('Już obsługujesz ten ticket.');
  if (ticket.claimedBy && !isAdmin(member)) throw new UserError(`Ten ticket obsługuje już <@${ticket.claimedBy}>.`);
  const previous = ticket.claimedBy;
  db.updateTicket(channel.id, { claimedBy: member.id });
  await refreshControlMessage(channel, ticket);
  await channel.send(
    ui.notice(
      COLORS.success,
      `### 🙋 ${member.displayName} zajmie się Twoim ticketem\n<@${ticket.ownerId}>, od teraz Twój ticket obsługuje ${member}.` +
        (previous ? `\n-# Przejęty od <@${previous}>` : ''),
      { thumbnail: member.displayAvatarURL?.({ size: 128 }) },
    ),
  );
  await sendTicketLog(channel.guild, {
    embeds: [logEmbed(COLORS.brand, '🙋 Ticket przejęty', member.user).setDescription(`${member} przejmuje ${channel} (\`#${pad(ticket.number)}\`)`)],
  });
}

async function unclaimTicket(channel, member) {
  const ticket = requireOpen(channel);
  if (!ticket.claimedBy) throw new UserError('Nikt nie przejął tego ticketu.');
  if (ticket.claimedBy !== member.id && !isAdmin(member)) throw new UserError('Oddać ticket może tylko osoba, która go obsługuje (albo administrator).');
  // unclaimedAt: the unclaimed-ticket reminders (features/staffreminders.js) count from here again.
  db.updateTicket(channel.id, { claimedBy: null, unclaimedAt: Date.now() });
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.notice(COLORS.warning, `↩️ ${member} nie obsługuje już tego ticketu – czekamy na kogoś innego z zespołu.`));
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
  if (!added.length) throw new UserError('Wybrane osoby mają już dostęp do ticketu (albo są botami).');
  db.updateTicket(channel.id, { participants: ticket.participants });
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.notice(COLORS.success, `➕ ${actor} dodaje do ticketu: ${added.map((id) => `<@${id}>`).join(', ')}`, { mentions: { users: added } }));
  return added.length;
}

const addUser = (channel, user, actor) => addUsers(channel, [user], actor);

async function removeUser(channel, user, actor) {
  const ticket = requireOpen(channel);
  if (user.id === ticket.ownerId) throw new UserError('Nie można usunąć autora ticketu.');
  if (!ticket.participants.includes(user.id)) throw new UserError(`${user} nie jest na liście osób dodanych do tego ticketu.`);
  await channel.permissionOverwrites.delete(user.id);
  db.updateTicket(channel.id, { participants: ticket.participants.filter((id) => id !== user.id) });
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.notice(COLORS.warning, `➖ ${actor} usuwa ${user} z ticketu.`));
}

async function setPriority(channel, level, actor) {
  const ticket = requireOpen(channel);
  if (!PRIORITIES[level]) throw new UserError('Nieznany priorytet.');
  if (ticket.priority === level) throw new UserError('Ticket ma już ten priorytet.');
  db.updateTicket(channel.id, { priority: level });
  await refreshControlMessage(channel, ticket);
  const renamed = await safeRename(channel, channelName(ticket, config.getType(ticket.typeId))).catch(() => ({ ok: false }));
  if (renamed.ok) db.updateTicket(channel.id, { customName: false }); // the generated name is back
  const p = PRIORITIES[level];
  await channel.send(
    ui.notice(
      p.color,
      `${p.emoji} ${actor} zmienia priorytet na **${p.label}**.` +
        (renamed.wait ? `\n-# Nazwa kanału zmieni się przy następnej zmianie (limit Discorda, ~${renamed.wait} min).` : ''),
    ),
  );
}

async function moveTicket(channel, typeId, actor) {
  const ticket = requireOpen(channel);
  const from = config.getType(ticket.typeId);
  const to = config.getType(typeId);
  if (!to) throw new UserError('Nie ma takiej kategorii.');
  if (to.id === ticket.typeId) throw new UserError('Ticket jest już w tej kategorii.');

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
      `🔁 ${actor} przenosi ticket: **${from?.emoji ?? ''} ${from?.label ?? '?'}** → **${to.emoji ?? ''} ${to.label}**` +
        (pings.length ? `\n🔔 ${pings.map((id) => `<@&${id}>`).join(' ')}` : '') +
        (renamed.wait ? `\n-# Nazwa kanału zmieni się później (limit Discorda, ~${renamed.wait} min).` : ''),
      { mentions: { roles: pings } },
    ),
  );
}

async function renameTicket(channel, name) {
  requireOpen(channel);
  const result = await safeRename(channel, name);
  if (!result.ok) throw new UserError(`Discord pozwala zmienić nazwę kanału tylko 2 razy na 10 minut. Spróbuj ponownie za ~${result.wait} min.`);
  db.updateTicket(channel.id, { customName: true }); // /build only:names leaves it alone
}

async function pingStaff(channel, member) {
  const ticket = requireOpen(channel);
  if (ticket.ownerId !== member.id) throw new UserError('Tylko autor ticketu może wezwać pomoc.');
  const after = (D.pingStaffAfterMinutes ?? 10) * 60_000;
  const cooldown = (D.pingStaffCooldownMinutes ?? 30) * 60_000;
  if (Date.now() - ticket.createdAt < after) throw new UserError(`Daj nam chwilę 🙂 Pomoc możesz wezwać ${ts(ticket.createdAt + after, 'R')}.`);
  if (ticket.lastMessageBy === 'staff') throw new UserError('Zespół już odpowiedział – sprawdź najnowsze wiadomości.');
  if (ticket.lastStaffPing && Date.now() - ticket.lastStaffPing < cooldown) {
    throw new UserError(`Pomoc została już wezwana. Ponownie możesz ją wezwać ${ts(ticket.lastStaffPing + cooldown, 'R')}.`);
  }
  db.updateTicket(channel.id, { lastStaffPing: Date.now() });
  const roles = ticket.claimedBy ? [] : staffRoleIds(channel.guild.id, config.getType(ticket.typeId)).filter((id) => channel.guild.roles.cache.has(id));
  const who = ticket.claimedBy ? `<@${ticket.claimedBy}>` : roles.map((id) => `<@&${id}>`).join(' ') || 'Zespół';
  await channel.send(
    ui.notice(COLORS.warning, `🔔 ${who} – <@${ticket.ownerId}> czeka na odpowiedź od ${duration(Date.now() - (ticket.waitingSince ?? ticket.createdAt))}.`, {
      mentions: { users: ticket.claimedBy ? [ticket.claimedBy] : [], roles },
    }),
  );
}

async function stillNeedHelp(channel, member, message) {
  const ticket = requireOpen(channel);
  if (ticket.ownerId !== member.id) throw new UserError('Ten przycisk jest dla autora ticketu.');
  db.updateTicket(channel.id, { lastMessageBy: 'owner', lastActivity: Date.now(), warned: false, ...(ticket.lastMessageBy === 'staff' && { waitingSince: Date.now() }) });
  await message.edit(ui.notice(COLORS.success, `✋ <@${ticket.ownerId}> nadal potrzebuje pomocy – automatyczne zamknięcie anulowane.`)).catch(() => null);
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
  if (ticket.typeId !== 'order') throw new UserError('Jako zrealizowane można oznaczyć tylko tickety zakupu.');
  if (ticket.completedAt) throw new UserError('To zamówienie jest już oznaczone jako zrealizowane.');
  return ticket;
}

/** Which limit the order's promo code goes over if it is redeemed now (see promos.overLimit) – or null. */
function promoOverLimit(guildId, ticket) {
  const code = ticket.order?.promo;
  if (!code) return null;
  return promos.overLimit(promos.find(guildId, code), ticket.ownerId, { completedOrders: db.guild(guildId).orders[ticket.ownerId] ?? 0 });
}

/** The "Complete order" form (amount paid) for this ticket. */
function completeForm(channel) {
  const ticket = requireCompletable(channel);
  return ui.completeOrderModal(ticket, { promoWarning: promoOverLimit(channel.guild.id, ticket) });
}

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
  if (paid != null && !(Number.isFinite(paid) && paid >= 0)) throw new UserError('Zapłacona kwota musi być liczbą 0 lub większą (np. 19.99).');
  const guild = channel.guild;
  const g = db.guild(guild.id);
  // Backstop: the code's limits are checked when the order is placed and when it's reopened. If it went
  // over one anyway, the sale keeps the discount it was sold with, but the seller is told.
  const promoWarning = promoOverLimit(guild.id, ticket);
  // A balance top-up (features/balance.js) isn't a purchase – it doesn't count as an order (first-order codes, Loyal).
  if (!order.topUp) g.orders[ticket.ownerId] = (g.orders[ticket.ownerId] ?? 0) + 1;
  const orders = g.orders[ticket.ownerId] ?? 0;
  const now = Date.now();
  const sale = db.addSale(guild.id, {
    id: nextSaleId(guild.id),
    ticketNumber: ticket.number,
    channelId: channel.id,
    userId: ticket.ownerId,
    sellerId: staff.id,
    // Older shop orders have no ticket.order – find their product from the form answer ("Name — 10€").
    productId: order.productId ?? require('../features/shop').ticketProduct(guild.id, ticket)?.id ?? null,
    product: order.product ?? null,
    variant: order.variant ?? null,
    quantity: order.quantity ?? 1,
    amount: paid == null ? null : Math.round(paid * 100) / 100,
    currency: config.shop.currency ?? '€',
    method: order.method ?? null,
    promo: order.promo ?? null,
    discount: order.discount ?? 0,
    createdAt: ticket.createdAt,
    completedAt: now,
    // A cart's products (features/cart.js), a payment with store balance, a balance top-up (features/balance.js).
    ...(order.items?.length && { items: order.items.map((i) => ({ productId: i.productId ?? null, product: i.product ?? null, variant: i.variant ?? null, quantity: i.quantity ?? 1, unitPrice: i.unitPrice ?? null })) }),
    ...(order.paidWith && { paidWith: order.paidWith }),
    ...(order.topUp && { topUp: true }),
  });
  if (sale.promo) promos.redeem(guild.id, sale.promo, ticket.ownerId, sale.id);
  // A completed top-up credits the balance right here, with the sale and no await in between – exactly once.
  if (order.topUp) require('../features/balance').creditTopUp(guild.id, ticket, sale);
  db.updateTicket(channel.id, { completedAt: now, completedBy: staff.id, saleId: sale.id, lastMessageBy: 'staff', lastActivity: now });

  const member = await guild.members.fetch(ticket.ownerId).catch(() => null);
  const customerRole = db.roleId(guild.id, 'customer');
  const loyalRole = db.roleId(guild.id, 'loyal');
  const loyalAfter = Number(config.shop.loyalAfterOrders) || 0;
  let loyal = false;
  if (member) {
    if (customerRole && guild.roles.cache.has(customerRole)) await member.roles.add(customerRole, `Zamówienie #${pad(ticket.number)} zrealizowane`).catch(() => null);
    if (loyalRole && loyalAfter > 0 && orders >= loyalAfter && guild.roles.cache.has(loyalRole) && !member.roles.cache.has(loyalRole)) {
      loyal = await member.roles.add(loyalRole, count(orders, 'zrealizowane zamówienie', 'zrealizowane zamówienia', 'zrealizowanych zamówień')).then(() => true).catch(() => false);
    }
  }
  await refreshControlMessage(channel, ticket);
  await channel.send(ui.orderCompletedCard(guild, ticket, staff.id, { loyal, orders, sale }));
  await sendTicketLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '✅ Zamówienie zrealizowane', staff.user ?? staff).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Klient', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Zamówienia łącznie', value: String(orders), inline: true },
        { name: 'Sprzedaż', value: `\`${sale.id}\``, inline: true },
        { name: 'Zapłacona kwota', value: money(sale.amount), inline: true },
        { name: 'Kod rabatowy', value: sale.promo ? `${sale.promo} (−${money(sale.discount)})${promoWarning ? `\n⚠️ ponad limit: ${promoWarning}` : ''}` : '—', inline: true },
      ),
    ],
  });
  const result = { orders, loyal, sale, promoWarning };
  try {
    if (respond) await respond(result);
  } finally {
    await hooks.emit('orderCompleted', { guild, ticket: db.getTicket(channel.id), member, staff, sale });
  }
  return result;
}

function requireOpen(channel) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('Tej akcji można użyć tylko na kanale ticketu.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty.');
  return ticket;
}

async function saveRating(client, channelId, userId, stars, comment) {
  const ticket = db.getTicket(channelId);
  if (!ticket || ticket.ownerId !== userId) throw new UserError('Nie możesz ocenić tego ticketu.');
  if (ticket.rating) throw new UserError('Ten ticket ma już ocenę. Dziękujemy!');
  db.updateTicket(channelId, { rating: { stars, comment: comment || null, at: Date.now() } });

  const guild = client.guilds.cache.get(ticket.guildId);
  if (guild) {
    const user = await client.users.fetch(userId).catch(() => null);
    await sendTicketLog(guild, {
      embeds: [
        logEmbed(stars >= 4 ? COLORS.success : stars === 3 ? COLORS.warning : COLORS.danger, '⭐ Nowa ocena pomocy', user)
          .setDescription(`## ${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)}\n**${stars}/5**`)
          .addFields(
            { name: 'Ticket', value: `\`#${pad(ticket.number)}\``, inline: true },
            { name: 'Autor', value: `<@${ticket.ownerId}>`, inline: true },
            { name: 'Obsługa', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
            ...(comment ? [{ name: 'Komentarz', value: `>>> ${comment.slice(0, 1000)}` }] : []),
          ),
      ],
    });
  }
}

async function runInactivityCheck(client) {
  const now = Date.now();
  for (const ticket of db.tickets((t) => t.status === 'open')) {
    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild || guild.available === false) continue; // a Discord outage is not a deleted ticket
    const channel = guild.channels.cache.get(ticket.channelId);
    if (!channel) {
      db.updateTicket(ticket.channelId, { status: 'deleted', deletedAt: now });
      continue;
    }
    const settings = db.settings(guild.id);
    if (!settings.autoCloseHours || settings.autoCloseHours <= 0) continue;
    if (ticket.lastMessageBy !== 'staff') continue;
    // A paid order waits for its delivery, not for the customer – only staff close it.
    if (['sent', 'paid', 'progress'].includes(statusOf(ticket))) continue;

    const idle = now - ticket.lastActivity;
    const closeAfter = settings.autoCloseHours * 3_600_000;
    const warnAfter = settings.autoCloseWarningHours * 3_600_000;
    try {
      if (idle >= closeAfter) {
        await closeTicket(channel, client.user, `Zamknięty automatycznie – brak odpowiedzi od ${duration(idle)}`);
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
  trackMessage,
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
