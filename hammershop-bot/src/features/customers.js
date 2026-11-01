'use strict';

/**
 * Customer profiles for staff (/customer view, src/commands/customer.js) and private staff notes
 * (/customer note add | remove, or the "Add note" button on a profile).
 * Notes live in db.guild(id).notes: { [userId]: [{ id, by, text, at }] } and are only ever shown ephemerally.
 *
 * Components:
 *   customer:note:<userId>     "Add note" button → form → the note is saved and the profile refreshed
 */

const { ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const hooks = require('../lib/hooks');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { UserError, reply, isStaff, money, pad, truncate, ts, plural } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
const { container, text, divider, btn, row, header, v2 } = require('../lib/v2');
const { quantitySuffix } = require('../lib/orderItems');

const MAX_NOTE_LENGTH = 500;
const MAX_NOTES = 50;
const TEXT_BUDGET = 3900; // a Components V2 card holds 4000 characters of text
const LAST_ORDERS = 5;

const isId = (id) => /^\d{17,20}$/.test(String(id ?? ''));
const isAmount = (n) => typeof n === 'number' && Number.isFinite(n);
const many = (n, one, few, more) => `${n} ${plural(n, one, few, more)}`;

// ───────────── Notes ─────────────

const notesOf = (guildId, userId) => db.guild(guildId).notes[userId] ?? [];

function addNote(guildId, userId, { by, text: raw, now = Date.now() }) {
  const clean = String(raw ?? '').trim();
  if (!clean) throw new UserError('Notatka jest pusta – napisz coś.');
  if (clean.length > MAX_NOTE_LENGTH) throw new UserError(`Notatka może mieć maks. ${many(MAX_NOTE_LENGTH, 'znak', 'znaki', 'znaków')} (ta ma ${clean.length}).`);
  const notes = db.guild(guildId).notes;
  const list = (notes[userId] ??= []);
  if (list.length >= MAX_NOTES) throw new UserError(`Ten klient ma już ${many(MAX_NOTES, 'notatkę', 'notatki', 'notatek')} – najpierw usuń stare przez \`${slash('customer note remove')}\`.`);
  const note = { id: list.reduce((max, n) => Math.max(max, n.id), 0) + 1, by, text: clean, at: now };
  list.push(note);
  db.save();
  return note;
}

/** Removes a note; returns it (or null when there is no such note). */
function removeNote(guildId, userId, id) {
  const notes = db.guild(guildId).notes;
  const list = notes[userId] ?? [];
  const note = list.find((n) => n.id === Number(id));
  if (!note) return null;
  notes[userId] = list.filter((n) => n !== note);
  if (!notes[userId].length) delete notes[userId];
  db.save();
  return note;
}

// ───────────── Profile data ─────────────

/** Account creation time from the user, or from the snowflake ID. */
function createdAt(user) {
  if (user.createdTimestamp) return user.createdTimestamp;
  return isId(user.id) ? Number((BigInt(user.id) >> 22n) + 1420070400000n) : null;
}

const inviterOf = (entry) => (typeof entry === 'string' ? entry : (entry?.inviterId ?? entry?.inviter ?? entry?.by ?? null));
const firstNumber = (...values) => values.find((v) => typeof v === 'number' && Number.isFinite(v)) ?? null;

/**
 * Invite stats from db.guild(id).invites ({ members, inviters, rewarded } – filled by the invites feature).
 * Read defensively: the counts may be numbers, lists or objects, and the feature may be missing entirely.
 */
function inviteInfo(guildId, userId) {
  const invites = db.guild(guildId).invites ?? {};
  const members = invites.members && typeof invites.members === 'object' ? invites.members : {};
  const inviterId = inviterOf(members[userId]);
  const raw = invites.inviters && typeof invites.inviters === 'object' ? invites.inviters[userId] : undefined;
  let count = null;
  let left = null;
  if (typeof raw === 'number') count = raw;
  else if (Array.isArray(raw)) count = raw.length;
  else if (raw && typeof raw === 'object') {
    count = firstNumber(raw.valid, raw.regular, raw.count, raw.total, raw.joins, raw.invites) ?? (Array.isArray(raw.members) ? raw.members.length : null);
    left = firstNumber(raw.left, raw.leaves);
  }
  if (count === null) {
    const invited = Object.values(members).filter((m) => inviterOf(m) === userId);
    count = invited.length;
    left = invited.filter((m) => m && typeof m === 'object' && (m.left || m.leftAt)).length || null;
  }
  return { inviterId: isId(inviterId) ? inviterId : null, count: Number.isFinite(count) ? count : 0, left };
}

function profileData(guild, userId) {
  const g = db.guild(guild.id);
  const sales = db.sales(guild.id).filter((s) => s.userId === userId).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  // A balance top-up isn't spending – what is bought with the balance is (features/balance.js), so nothing counts twice.
  const known = sales.filter((s) => isAmount(s.amount) && !s.topUp);
  const tickets = db.tickets((t) => t.guildId === guild.id && t.ownerId === userId);
  const vouches = g.vouches.filter((v) => v.userId === userId);
  return {
    orders: g.orders[userId] ?? 0,
    sales,
    spent: Math.round(known.reduce((sum, s) => sum + s.amount, 0) * 100) / 100,
    unknown: sales.filter((s) => !isAmount(s.amount)).length,
    openTickets: tickets.filter((t) => t.status === 'open'),
    closedTickets: tickets.filter((t) => t.status !== 'open').length,
    vouches: vouches.length,
    rating: vouches.length ? vouches.reduce((sum, v) => sum + (Number(v.rating) || 0), 0) / vouches.length : null,
    blacklist: db.blacklist(guild.id).find((b) => b.userId === userId) ?? null,
    invites: inviteInfo(guild.id, userId),
    notes: notesOf(guild.id, userId),
  };
}

// ───────────── Profile card ─────────────

function badges(guild, member) {
  if (!member) return '';
  const ids = ['loyal', 'customer'].map((key) => db.roleId(guild.id, key)).filter((id) => id && member.roles?.cache?.has(id));
  return ids.length ? `\n${ids.map((id) => `<@&${id}>`).join(' ')}` : '';
}

function accountText(guild, user, member, d) {
  const memberRole = db.roleId(guild.id, 'member');
  const created = createdAt(user);
  const verified = !member ? '—' : !memberRole ? `— (brak roli Członek – użyj \`${slash('build')}\`)` : member.roles?.cache?.has(memberRole) ? '✅ Tak' : '❌ Nie';
  const lines = [
    `### ${e(guild, 'calendar')} Konto`,
    `**Na serwerze od:** ${member?.joinedTimestamp ? `${ts(member.joinedTimestamp, 'D')} (${ts(member.joinedTimestamp, 'R')})` : '— (poza serwerem)'}`,
    `**Konto założone:** ${created ? `${ts(created, 'D')} (${ts(created, 'R')})` : 'nieznane'}`,
    `**Weryfikacja:** ${verified}`,
    `**Czarna lista:** ${d.blacklist ? `⛔ **Tak** – ${truncate(d.blacklist.reason || 'bez powodu', 120)}${d.blacklist.by ? ` · przez <@${d.blacklist.by}>` : ''}${d.blacklist.at ? ` · ${ts(d.blacklist.at, 'd')}` : ''}` : 'Nie'}`,
  ];
  const inv = d.invites;
  lines.push(`**Zaproszenie od:** ${inv.inviterId ? `<@${inv.inviterId}>` : '—'}${'  '}·${'  '}**Zaproszenia:** ${inv.count}${inv.left ? ` (w tym ${inv.left} poza serwerem)` : ''}`);
  return lines.join('\n');
}

function orderLine(sale) {
  const parts = [`\`#${pad(sale.ticketNumber ?? 0)}\``, `**${truncate(sale.product || 'Zamówienie indywidualne', 40)}**${quantitySuffix(sale)}`, isAmount(sale.amount) ? money(sale.amount) : 'kwota nieznana'];
  if (sale.promo) parts.push(`🏷️ ${sale.promo}`);
  if (sale.completedAt) parts.push(ts(sale.completedAt, 'd'));
  return `> ${parts.join(' · ')}`;
}

function ordersText(guild, d) {
  const lines = [
    `### ${e(guild, 'cart')} Zamówienia`,
    `**Zrealizowane zamówienia:** ${d.orders}${'  '}·${'  '}**Wydano łącznie:** ${money(d.spent)}${d.unknown ? ` (+${many(d.unknown, 'zamówienie', 'zamówienia', 'zamówień')} bez znanej kwoty)` : ''}`,
  ];
  if (d.sales.length) {
    const shown = Math.min(LAST_ORDERS, d.sales.length);
    lines.push(`**${shown === 1 ? 'Ostatnie zamówienie' : `Ostatnie ${many(shown, 'zamówienie', 'zamówienia', 'zamówień')}`}:**`, ...d.sales.slice(0, LAST_ORDERS).map(orderLine));
  } else if (!d.orders) {
    lines.push('-# Brak zrealizowanych zamówień.');
  }
  return lines.join('\n');
}

function activityText(guild, d) {
  const open = d.openTickets.slice(0, 5).map((t) => `<#${t.channelId}>`).join(' ');
  const rating = d.rating === null ? '' : `${'  '}·${'  '}**Średnia ocena:** ⭐ **${d.rating.toFixed(2)}**`;
  return [
    `### ${e(guild, 'ticket')} Tickety i opinie`,
    `**Tickety:** otwarte: ${d.openTickets.length} · zamknięte: ${d.closedTickets}${open ? `${'  '}→ ${open}` : ''}`,
    `**Wystawione opinie:** ${d.vouches}${rating}`,
  ].join('\n');
}

/** Newest notes first, as many as fit into `budget` characters. */
function notesText(guild, notes, budget) {
  const head = `### ${e(guild, 'pencil')} Notatki zespołu (${notes.length})`;
  if (!notes.length) return `${head}\n-# Brak notatek – dodaj pierwszą przyciskiem poniżej lub przez \`${slash('customer note add')}\`.`;
  const lines = [head];
  let used = head.length;
  let shown = 0;
  for (const n of [...notes].reverse()) {
    const line = `**#${n.id}** · <@${n.by}> · ${ts(n.at, 'R')}\n> ${n.text.replace(/\n+/g, '\n> ')}`;
    if (used + line.length + 80 > budget) break;
    lines.push(line);
    used += line.length + 1;
    shown += 1;
  }
  if (shown < notes.length) lines.push(`-# …i jeszcze ${many(notes.length - shown, 'starsza notatka', 'starsze notatki', 'starszych notatek')} – usuń stare: \`${slash('customer note remove')}\`.`);
  return lines.join('\n');
}

/** The profile card (ephemeral – it contains private staff notes). */
function profileCard(guild, user, member) {
  const d = profileData(guild, user.id);
  const name = member?.displayName ?? user.globalName ?? user.username ?? 'Nieznany użytkownik';
  const top = `## ${e(guild, 'person')} ${truncate(name, 64)}\n<@${user.id}>${user.username ? ` · \`${truncate(user.username, 32)}\`` : ''} · ID \`${user.id}\`${badges(guild, member)}`;
  const sections = [accountText(guild, user, member, d), ordersText(guild, d), activityText(guild, d)];
  const footer = '-# 🔒 Ten profil i jego notatki widzi tylko zespół.';
  const used = top.length + sections.reduce((n, s) => n + s.length, 0) + footer.length;

  const c = container(d.blacklist ? COLORS.danger : COLORS.brand);
  header(c, top, user.displayAvatarURL?.({ size: 128 }));
  for (const s of sections) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(s));
  }
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(notesText(guild, d.notes, TEXT_BUDGET - used)));
  c.addTextDisplayComponents(text(footer));
  c.addActionRowComponents(row(btn(`customer:note:${user.id}`, 'Dodaj notatkę', ce(guild, 'pencil'), ButtonStyle.Secondary)));
  return v2(c);
}

// ───────────── "Add note" button ─────────────

function noteModal(userId, name) {
  return new ModalBuilder()
    .setCustomId(`customer:note:${userId}`)
    .setTitle(truncate(`Notatka – ${name}`, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Notatka')
        .setDescription('Widzi ją tylko zespół. Pojawi się na profilu klienta.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(MAX_NOTE_LENGTH).setPlaceholder('Np. 2× spóźniona płatność, woli krypto, kandydat na VIP…'),
        ),
    );
}

function requireStaff(interaction) {
  if (!isStaff(interaction.member)) throw new UserError('Profile klientów i notatki są dostępne tylko dla zespołu.');
}

/** The form has to be the first answer within 3 seconds – so the name comes from the cache, never from the API. */
function openNoteForm(interaction, [userId]) {
  requireStaff(interaction);
  if (!isId(userId)) throw new UserError(`Ten przycisk nie działa – otwórz profil ponownie przez \`${slash('customer view')}\`.`);
  const user = interaction.client.users.cache?.get(userId) ?? interaction.guild.members.cache?.get(userId)?.user;
  return interaction.showModal(noteModal(userId, user?.username ?? 'klient'));
}

async function submitNoteForm(interaction, [userId]) {
  requireStaff(interaction);
  if (!isId(userId)) throw new UserError(`Ten formularz nie działa – otwórz profil ponownie przez \`${slash('customer view')}\`.`);
  addNote(interaction.guild.id, userId, { by: interaction.user.id, text: interaction.fields.getTextInputValue('text') });
  // Answer first: fetching someone who left the server is a slow API call.
  const fromMessage = interaction.isFromMessage();
  await (fromMessage ? interaction.deferUpdate() : interaction.deferReply({ flags: MessageFlags.Ephemeral }));
  const user = await interaction.client.users.fetch(userId).catch(() => ({ id: userId }));
  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const card = profileCard(interaction.guild, user, member);
  return fromMessage ? interaction.editReply(card) : reply(interaction, card);
}

hooks.route('customer', {
  button: (interaction, action, args) => (action === 'note' ? openNoteForm(interaction, args) : null),
  modal: (interaction, action, args) => (action === 'note' ? submitNoteForm(interaction, args) : null),
});

module.exports = { MAX_NOTE_LENGTH, MAX_NOTES, notesOf, addNote, removeNote, inviteInfo, profileData, profileCard, noteModal };
