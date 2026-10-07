'use strict';

/**
 * Reminders for unclaimed tickets (config.staffReminders). Every minute while the shop is open, the open tickets
 * nobody has claimed for unclaimedMinutes (default 15) are listed in ONE message per server in the staff chat
 * (or the ticket log channel), pinging the staff roles of those ticket types. A ticket is reminded again every
 * repeatMinutes (default 60; 0 = only once) until someone claims it – unclaiming starts its clock again.
 * Tickets that came in while the shop was closed are reminded as soon as it opens.
 *
 * ticket.unclaimedRemindedAt – the last reminder; ticket.unclaimedAt – when it was last unclaimed (tickets.js).
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const shopstatus = require('./shopstatus');
const ui = require('../tickets/ui');
const { COLORS } = require('../lib/theme');
const { duration, pad, truncate, sendToChannel } = require('../lib/utils');
const { alertRoleIds } = require('../lib/permissions');
const { container, text, divider, linkBtn, row, v2, channelUrl } = require('../lib/v2');

const MINUTE = 60_000;
const LISTED = 10; // tickets named in the message – the rest is "+N more"
const LINKS = 5; // link buttons (one row)

/** Minutes from config.json in ms, or the default when the value is missing or not a number ≥ 0. */
function minutes(value, fallback) {
  const n = Number(value);
  return (value != null && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback) * MINUTE;
}

function settings() {
  const cfg = config.staffReminders ?? {};
  return { enabled: cfg.enabled !== false, after: minutes(cfg.unclaimedMinutes, 15), repeat: minutes(cfg.repeatMinutes, 60) };
}

/** Since when the ticket waits for someone to claim it: opened, or unclaimed later. */
const waitingSince = (t) => Math.max(t.createdAt ?? 0, t.unclaimedAt ?? 0);

/** Does this unclaimed ticket need a reminder now? */
function isDue(t, now, { after, repeat }) {
  const since = waitingSince(t);
  if (now - since < after) return false;
  const last = t.unclaimedRemindedAt ?? 0;
  if (last < since) return true; // not reminded since it started waiting
  return repeat > 0 && now - last >= repeat;
}

/** Open tickets of this server that nobody has claimed and that are due for a reminder – longest waiting first. */
function dueTickets(guild, now, opts) {
  return db
    .tickets((t) => t.guildId === guild.id && t.status === 'open' && !t.claimedBy && !t.completedAt && guild.channels.cache.has(t.channelId) && isDue(t, now, opts))
    .sort((a, b) => waitingSince(a) - waitingSince(b));
}

/** The staff roles of these tickets' types that exist on the server. */
function pingRoles(guild, list) {
  const ids = new Set();
  for (const t of list) {
    for (const id of alertRoleIds(guild.id, config.getType(t.typeId))) if (guild.roles.cache.has(id)) ids.add(id);
  }
  return [...ids];
}

function reminderCard(guild, list, { roles, now, repeat }) {
  const c = container(COLORS.warning);
  const head = `## 🔔 ${list.length === 1 ? '1 ticket is' : `${list.length} tickets are`} waiting to be claimed`;
  c.addTextDisplayComponents(text(roles.length ? `${head}\n${roles.map((id) => `<@&${id}>`).join(' ')}` : head));
  c.addSeparatorComponents(divider());
  const lines = list.slice(0, LISTED).map((t) => {
    const type = config.getType(t.typeId);
    return `${ui.typeText(guild, type)} <#${t.channelId}> · ${truncate(type?.label ?? t.typeId, 40)} · <@${t.ownerId}> · waiting **${duration(now - waitingSince(t))}**`;
  });
  if (list.length > LISTED) lines.push(`**+${list.length - LISTED} more**`);
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addActionRowComponents(
    row(...list.slice(0, LINKS).map((t) => linkBtn(channelUrl(guild.id, t.channelId), `#${pad(t.number)}`, ui.typeEmoji(guild, config.getType(t.typeId))))),
  );
  c.addTextDisplayComponents(text(`-# Claim a ticket to stop its reminders.${repeat ? ` Still unclaimed? You'll be reminded again in ${duration(repeat)}.` : ''}`));
  return v2(c, { mentions: { roles } });
}

/** Where the reminder goes: the staff chat, otherwise the ticket log channel (null when neither exists). */
function targetChannelId(guild) {
  return [db.channelId(guild.id, 'staffChat'), db.settings(guild.id).logChannelId].find((id) => id && guild.channels.cache.has(id)) ?? null;
}

/** One sweep: at most one message per server, for all of its due tickets. → how many tickets were reminded */
async function sweep(client, now = Date.now()) {
  const opts = settings();
  if (!opts.enabled) return 0;
  let reminded = 0;
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || guild.available === false) continue; // a Discord outage
    if (!shopstatus.isOpen(guildId, new Date(now))) continue; // reminded once the shop opens
    const due = dueTickets(guild, now, opts);
    const channelId = due.length ? targetChannelId(guild) : null;
    if (!channelId) continue;
    for (const t of due) db.updateTicket(t.channelId, { unclaimedRemindedAt: now }); // first, so a slow send is never repeated
    await sendToChannel(guild, channelId, reminderCard(guild, due, { roles: pingRoles(guild, due), now, repeat: opts.repeat }));
    reminded += due.length;
  }
  return reminded;
}

hooks.every('staffReminders', MINUTE, (client) => sweep(client));

module.exports = { waitingSince, isDue, reminderCard, sweep };
