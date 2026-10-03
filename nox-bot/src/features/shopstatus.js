'use strict';

/**
 * Shop open / closed.
 *   auto    follows config.json → workingHours (open 10:00–20:00 every day, Europe/Warsaw)
 *   open    set by hand with /shop open    ┐ stays until /shop auto
 *   closed  set by hand with /shop closed  ┘
 * Shown as the locked voice channel "🟢┃ꜱʜᴏᴘ ᴏᴘᴇɴ" / "🔴┃ꜱʜᴏᴘ ᴄʟᴏꜱᴇᴅ" at the top of the server, in the shop panel,
 * the ticket panel and in new tickets. A timer checks every minute: the channel is renamed only when its name
 * has to change (Discord allows 2 renames per 10 minutes) and the panels are refreshed when the state flips.
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const panels = require('../lib/panels');
const hours = require('../lib/hours');
const { UserError, safeRename, ts } = require('../lib/utils');
const { channelName, sameChannelName } = require('../builder/style');

const MODES = ['auto', 'open', 'closed'];

/** 'auto' (follows workingHours) | 'open' | 'closed' (set by hand). */
function mode(guildId) {
  const m = guildId ? db.guild(guildId).shopStatus.mode : null;
  return MODES.includes(m) ? m : 'auto';
}

function isOpen(guildId, now = new Date()) {
  const m = mode(guildId);
  if (m !== 'auto') return m === 'open';
  return hours.inHours(config.workingHours, now);
}

/** "Every day 10:00–20:00 (Central European Time)" – config.json → shop.supportHours, written from workingHours. */
const hoursText = () => config.shop.supportHours || hours.hoursText(config.workingHours);

/** When the shop opens / closes by itself next (null when that doesn't happen – e.g. set by hand). */
function nextChange(guildId, now = new Date()) {
  if (mode(guildId) !== 'auto') return null;
  const wh = config.workingHours;
  return isOpen(guildId, now) ? hours.nextClosing(wh, now) : hours.nextOpening(wh, now);
}

/** "at 10:00 (in 5 hours)" / "tomorrow at 10:00 (in 14 hours)" */
const whenText = (at, now) => `${hours.whenText(config.workingHours, at, now)} (${ts(at, 'R')})`;

/**
 * The open / closed line (null when there's nothing to say: no working hours and nothing set by hand).
 * place: 'shop' (shop panel) · 'support' (ticket panel) · 'ticket' (the first card of a new ticket)
 */
function statusLine(guildId, place = 'shop', now = new Date()) {
  if (mode(guildId) === 'auto' && !config.workingHours?.enabled) return null;
  if (isOpen(guildId, now)) {
    const lead = { support: '🟢 **Support is online now**', ticket: "🟢 **We're open**" }[place] ?? '🟢 **Open now**';
    return hoursText() ? `${lead} · ${hoursText()}` : lead;
  }
  const next = nextChange(guildId, now);
  const back = next ? `we open ${whenText(next, now)}` : "we'll be back soon";
  if (place === 'support') return `🔴 **Support is offline right now** – ${back}. Open a ticket anyway, we reply as soon as we're back.`;
  if (place === 'ticket') return `🔴 **We're closed right now** – ${back}. A seller replies as soon as we're back.`;
  return `🔴 **Closed right now** – ${back}. You can still order; a seller replies when we open.`;
}

/** Name of the status channel right now (null when the feature is off). */
function statusChannelName(guildId, now = new Date()) {
  if (!config.shopStatus.enabled) return null;
  return channelName(isOpen(guildId, now) ? config.shopStatus.openName : config.shopStatus.closedName);
}

/** Renames the status channel – only when the name is different. → { renamed, wait (minutes, rate limit) } */
async function renameChannel(guild, now = new Date()) {
  const name = statusChannelName(guild.id, now);
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'statShop') ?? '');
  if (!name || !channel || sameChannelName(channel.name, name)) return { renamed: false, wait: 0 };
  const res = await safeRename(channel, name);
  return { renamed: res.ok, wait: res.ok ? 0 : res.wait };
}

async function refreshPanels(guild) {
  for (const kind of ['shop', 'tickets']) await panels.refresh(guild, kind).catch((err) => console.warn('[shop status]', err.message));
}

/** Brings one server up to date: status channel name, and the panels when the state flipped. */
async function sync(guild, now = new Date()) {
  const state = db.guild(guild.id).shopStatus;
  const open = isOpen(guild.id, now);
  const flipped = state.open !== open;
  if (flipped) {
    state.open = open;
    db.save();
    await refreshPanels(guild);
  }
  return { open, flipped, ...(await renameChannel(guild, now)) };
}

async function tick(client, now = new Date()) {
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await sync(guild, now).catch((err) => console.warn(`[shop status] ${guild.name}:`, err.message));
  }
}

/** /shop open | closed | auto – sets the mode, renames the channel and refreshes the panels right away. */
async function setMode(guild, newMode, { by = null, now = new Date() } = {}) {
  if (!MODES.includes(newMode)) throw new UserError('Unknown mode – use open, closed or auto.');
  const state = db.guild(guild.id).shopStatus;
  Object.assign(state, { mode: newMode, open: isOpen(guild.id, now), setBy: by, setAt: now.getTime() });
  db.save();
  await refreshPanels(guild);
  let rename;
  try {
    rename = await renameChannel(guild, now);
  } catch (err) {
    rename = { renamed: false, wait: 0, error: err.message };
  }
  return { mode: newMode, open: state.open, next: nextChange(guild.id, now), ...rename };
}

hooks.every('shopStatus', 60_000, (client) => tick(client), 20_000);

module.exports = { MODES, mode, isOpen, hoursText, nextChange, whenText, statusLine, statusChannelName, renameChannel, sync, tick, setMode };
