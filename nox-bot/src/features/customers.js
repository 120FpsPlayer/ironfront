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
const { UserError, reply, isStaff, money, pad, truncate, ts } = require('../lib/utils');
const { container, text, divider, btn, row, header, v2 } = require('../lib/v2');

const MAX_NOTE_LENGTH = 500;
const MAX_NOTES = 50;
const TEXT_BUDGET = 3900; // a Components V2 card holds 4000 characters of text
const LAST_ORDERS = 5;

const isId = (id) => /^\d{17,20}$/.test(String(id ?? ''));
const isAmount = (n) => typeof n === 'number' && Number.isFinite(n);
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;

// ───────────── Notes ─────────────

const notesOf = (guildId, userId) => db.guild(guildId).notes[userId] ?? [];

function addNote(guildId, userId, { by, text: raw, now = Date.now() }) {
  const clean = String(raw ?? '').trim();
  if (!clean) throw new UserError('The note is empty – write something.');
  if (clean.length > MAX_NOTE_LENGTH) throw new UserError(`A note can be at most ${MAX_NOTE_LENGTH} characters long (this one has ${clean.length}).`);
  const notes = db.guild(guildId).notes;
  const list = (notes[userId] ??= []);
  if (list.length >= MAX_NOTES) throw new UserError(`This customer already has ${MAX_NOTES} notes – remove old ones with \`/customer note remove\` first.`);
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
  const known = sales.filter((s) => isAmount(s.amount));
  const tickets = db.tickets((t) => t.guildId === guild.id && t.ownerId === userId);
  const vouches = g.vouches.filter((v) => v.userId === userId);
  return {
    orders: g.orders[userId] ?? 0,
    sales,
    spent: Math.round(known.reduce((sum, s) => sum + s.amount, 0) * 100) / 100,
    unknown: sales.length - known.length,
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
  const ids = ['vip', 'loyal', 'customer'].map((key) => db.roleId(guild.id, key)).filter((id) => id && member.roles?.cache?.has(id));
  return ids.length ? `\n${ids.map((id) => `<@&${id}>`).join(' ')}` : '';
}

function accountText(guild, user, member, d) {
  const memberRole = db.roleId(guild.id, 'member');
  const created = createdAt(user);
  const verified = !member ? '—' : !memberRole ? '— (no Member role – run `/build`)' : member.roles?.cache?.has(memberRole) ? '✅ Yes' : '❌ No';
  const lines = [
    `### ${e(guild, 'calendar')} Account`,
    `**Member since:** ${member?.joinedTimestamp ? `${ts(member.joinedTimestamp, 'D')} (${ts(member.joinedTimestamp, 'R')})` : 'not on the server'}`,
    `**Account created:** ${created ? `${ts(created, 'D')} (${ts(created, 'R')})` : 'unknown'}`,
    `**Verified:** ${verified}`,
    `**Blacklisted:** ${d.blacklist ? `⛔ **Yes** – ${truncate(d.blacklist.reason || 'no reason', 120)}${d.blacklist.by ? ` · by <@${d.blacklist.by}>` : ''}${d.blacklist.at ? ` · ${ts(d.blacklist.at, 'd')}` : ''}` : 'No'}`,
  ];
  const inv = d.invites;
  lines.push(`**Invited by:** ${inv.inviterId ? `<@${inv.inviterId}>` : '—'}${'  '}·${'  '}**Invites:** ${inv.count}${inv.left ? ` (${inv.left} left)` : ''}`);
  return lines.join('\n');
}

function orderLine(sale) {
  const parts = [`\`#${pad(sale.ticketNumber ?? 0)}\``, `**${truncate(sale.product || 'Custom order', 40)}** × ${sale.quantity ?? 1}`, isAmount(sale.amount) ? money(sale.amount) : 'amount unknown'];
  if (sale.promo) parts.push(`🏷️ ${sale.promo}`);
  if (sale.completedAt) parts.push(ts(sale.completedAt, 'd'));
  return `> ${parts.join(' · ')}`;
}

function ordersText(guild, d) {
  const lines = [
    `### ${e(guild, 'cart')} Orders`,
    `**Completed orders:** ${d.orders}${'  '}·${'  '}**Total spent:** ${money(d.spent)}${d.unknown ? ` (+${plural(d.unknown, 'order')} without a known amount)` : ''}`,
  ];
  if (d.sales.length) {
    lines.push(`**Last ${Math.min(LAST_ORDERS, d.sales.length) === 1 ? 'order' : `${Math.min(LAST_ORDERS, d.sales.length)} orders`}:**`, ...d.sales.slice(0, LAST_ORDERS).map(orderLine));
  } else if (!d.orders) {
    lines.push('-# No completed orders yet.');
  }
  return lines.join('\n');
}

function activityText(guild, d) {
  const open = d.openTickets.slice(0, 5).map((t) => `<#${t.channelId}>`).join(' ');
  const rating = d.rating === null ? '' : `${'  '}·${'  '}⭐ **${d.rating.toFixed(2)}** average`;
  return [
    `### ${e(guild, 'ticket')} Tickets & vouches`,
    `**Tickets:** ${d.openTickets.length} open · ${d.closedTickets} closed${open ? `${'  '}→ ${open}` : ''}`,
    `**Vouches given:** ${d.vouches}${rating}`,
  ].join('\n');
}

/** Newest notes first, as many as fit into `budget` characters. */
function notesText(guild, notes, budget) {
  const head = `### ${e(guild, 'pencil')} Staff notes (${notes.length})`;
  if (!notes.length) return `${head}\n-# No notes yet – add one with the button below or \`/customer note add\`.`;
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
  if (shown < notes.length) lines.push(`-# …and ${plural(notes.length - shown, 'older note')} – remove old ones with \`/customer note remove\`.`);
  return lines.join('\n');
}

/** The profile card (ephemeral – it contains private staff notes). */
function profileCard(guild, user, member) {
  const d = profileData(guild, user.id);
  const name = member?.displayName ?? user.globalName ?? user.username ?? 'Unknown user';
  const top = `## ${e(guild, 'person')} ${truncate(name, 64)}\n<@${user.id}>${user.username ? ` · \`${truncate(user.username, 32)}\`` : ''} · ID \`${user.id}\`${badges(guild, member)}`;
  const sections = [accountText(guild, user, member, d), ordersText(guild, d), activityText(guild, d)];
  const footer = '-# 🔒 Only staff can see this profile and its notes.';
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
  c.addActionRowComponents(row(btn(`customer:note:${user.id}`, 'Add note', ce(guild, 'pencil'), ButtonStyle.Secondary)));
  return v2(c);
}

// ───────────── "Add note" button ─────────────

function noteModal(userId, name) {
  return new ModalBuilder()
    .setCustomId(`customer:note:${userId}`)
    .setTitle(truncate(`Note about ${name}`, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Note')
        .setDescription('Only staff can see it. Shown on the customer profile.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(MAX_NOTE_LENGTH).setPlaceholder('E.g. paid late twice, prefers crypto, VIP candidate…'),
        ),
    );
}

function requireStaff(interaction) {
  if (!isStaff(interaction.member)) throw new UserError('Customer profiles and notes are only available to staff members.');
}

/** The form has to be the first answer within 3 seconds – so the name comes from the cache, never from the API. */
function openNoteForm(interaction, [userId]) {
  requireStaff(interaction);
  if (!isId(userId)) throw new UserError('This button is broken – open the profile again with `/customer view`.');
  const user = interaction.client.users.cache?.get(userId) ?? interaction.guild.members.cache?.get(userId)?.user;
  return interaction.showModal(noteModal(userId, user?.username ?? 'customer'));
}

async function submitNoteForm(interaction, [userId]) {
  requireStaff(interaction);
  if (!isId(userId)) throw new UserError('This form is broken – open the profile again with `/customer view`.');
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
