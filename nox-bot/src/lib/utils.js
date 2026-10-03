'use strict';

const { EmbedBuilder, MessageFlags, RateLimitError } = require('discord.js');
const { rateLimitMinutes } = require('./ratelimit');
const { smallCaps } = require('../builder/style');
const config = require('./config');
const db = require('./db');
const perms = require('./permissions');
const { COLORS } = require('./theme');

/** An error whose message is safe to show to the user. */
class UserError extends Error {}

const PRIORITIES = {
  low: { label: 'Low', emoji: '🟢', color: 0x57f287 },
  normal: { label: 'Normal', emoji: '🟣', color: COLORS.brand },
  high: { label: 'High', emoji: '🟠', color: 0xf0b232 },
  urgent: { label: 'Urgent', emoji: '🔴', color: 0xed4245 },
};

function embed(color = COLORS.brand) {
  const e = new EmbedBuilder().setColor(color).setTimestamp();
  if (config.brand.footer) e.setFooter({ text: config.brand.footer });
  return e;
}

const ok = (description) => embed(COLORS.success).setDescription(`✅ ${description}`);
const fail = (description) => embed(COLORS.danger).setDescription(`❌ ${description}`);

async function reply(interaction, payload, ephemeral = true) {
  const data = typeof payload === 'string' ? { embeds: [ok(payload)] } : { ...payload };
  if (interaction.deferred && !interaction.replied) return interaction.editReply(data);
  if (ephemeral) data.flags = (data.flags ?? 0) | MessageFlags.Ephemeral;
  if (interaction.replied) return interaction.followUp(data);
  return interaction.reply(data);
}

const replyError = (interaction, text) => reply(interaction, { embeds: [fail(text)] });

const staffRoleIds = (guildId, type) => perms.ticketRoleIds(guildId, type);
const isStaff = (member, type = null) => perms.isStaff(member, type);
const isAdmin = (member) => perms.isAdmin(member);

const renameHistory = new Map();
function canRename(channelId) {
  const now = Date.now();
  const recent = (renameHistory.get(channelId) ?? []).filter((t) => now - t < 10 * 60_000);
  renameHistory.set(channelId, recent);
  if (recent.length >= 2) return Math.ceil((10 * 60_000 - (now - recent[0])) / 60_000);
  return 0;
}

/**
 * Discord allows renaming a channel only twice per 10 minutes – this keeps track of that.
 * Renames the bot doesn't know about (by people, or before a restart) still hit Discord's limit:
 * that comes back as a RateLimitError, reported as { ok: false, wait } like our own count.
 */
async function safeRename(channel, name) {
  const wait = canRename(channel.id);
  if (wait) return { ok: false, wait };
  const history = renameHistory.get(channel.id);
  const at = Date.now();
  history.push(at);
  try {
    await channel.setName(name);
  } catch (err) {
    history.splice(history.indexOf(at), 1);
    if (err instanceof RateLimitError) return { ok: false, wait: rateLimitMinutes(err) };
    throw err;
  }
  return { ok: true };
}

function slug(text, max = 20) {
  return (
    String(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/ł/g, 'l')
      .replace(/ø/g, 'o')
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'user'
  );
}

const pad = (n) => String(n).padStart(4, '0');

/** Ticket channel name from config.json → channelNameFormat, in the server's style (small caps). */
function channelName(ticket, type) {
  const prio = ticket.priority && ticket.priority !== 'normal' ? PRIORITIES[ticket.priority].emoji : '';
  const name = config.channelNameFormat
    .replace('{prio}', prio)
    .replace('{emoji}', type?.emoji ?? '🎫')
    .replace('{prefix}', type?.channelPrefix ?? 'ticket')
    .replace('{number}', pad(ticket.number))
    .replace('{user}', slug(ticket.ownerName ?? 'user', 16));
  return ((config.server.smallCaps === false ? name : smallCaps(name)).slice(0, 100) || `ticket-${pad(ticket.number)}`);
}

function workingStatus(now = new Date()) {
  const wh = config.workingHours;
  if (!wh?.enabled) return { open: true, text: null };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: wh.timezone ?? 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMin = (s) => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1] ?? 0);
  const from = toMin(wh.from ?? '00:00');
  const to = toMin(wh.to ?? '23:59');
  const inHours = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  const open = (wh.days ?? [0, 1, 2, 3, 4, 5, 6]).includes(day) && inHours;
  return {
    open,
    text: open
      ? `🟢 Support is online now (${wh.from}–${wh.to} ${wh.timezone ?? 'UTC'})`
      : `🌙 We're outside support hours (${wh.from}–${wh.to} ${wh.timezone ?? 'UTC'}) – we'll reply as soon as we can`,
  };
}

function avgResponseTime(guildId) {
  const since = Date.now() - 30 * 86_400_000;
  const times = db
    .tickets((t) => t.guildId === guildId && t.firstResponseAt && t.createdAt >= since)
    .map((t) => t.firstResponseAt - t.createdAt);
  return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
}

function logEmbed(color, title, user) {
  const e = embed(color).setTitle(title);
  if (user) e.setAuthor({ name: user.tag ?? user.username ?? 'User', iconURL: user.displayAvatarURL?.() });
  return e;
}

function duration(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

/** "1d 12h", "30m", "2w", "90s" → milliseconds (null if invalid). */
function parseDuration(text) {
  const str = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (!str) return null;
  const units = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  let total = 0;
  let matched = '';
  for (const m of str.matchAll(/(\d+(?:\.\d+)?)(w|d|h|m|s)/g)) {
    total += Number(m[1]) * units[m[2]];
    matched += m[0];
  }
  if (matched !== str || total <= 0) return null;
  return Math.round(total);
}

const ts = (date, style = 'f') => `<t:${Math.floor(new Date(date).getTime() / 1000)}:${style}>`;

/** Send to one of the channels created by /build (by key), falling back to the ticket log channel. */
async function sendToChannel(guild, channelId, payload) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased?.()) return null;
  return channel.send(payload).catch((err) => {
    console.warn(`[log] Failed to send to #${channel.name}:`, err.message);
    return null;
  });
}

async function sendLog(guild, payload) {
  return sendToChannel(guild, db.settings(guild.id).logChannelId, payload);
}

const truncate = (text, max) => {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

module.exports = {
  UserError,
  COLORS,
  PRIORITIES,
  embed,
  ok,
  fail,
  reply,
  replyError,
  isStaff,
  isAdmin,
  staffRoleIds,
  safeRename,
  slug,
  channelName,
  pad,
  workingStatus,
  avgResponseTime,
  logEmbed,
  duration,
  parseDuration,
  ts,
  sendToChannel,
  sendLog,
  truncate,
};
