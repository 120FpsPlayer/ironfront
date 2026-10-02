'use strict';

const db = require('./db');

/**
 * Live panels: messages the bot keeps up to date (ticket panel, shop catalog, vouch counter,
 * leaderboard). Each feature registers a renderer: (guild, panel) => message payload.
 * The message ID is stored in db.panels so the panel survives restarts.
 */

const renderers = new Map();
const timers = new Map();

function register(kind, render) {
  renderers.set(kind, render);
}

function render(kind, guild, panel = {}) {
  const fn = renderers.get(kind);
  if (!fn) throw new Error(`No renderer for panel "${kind}"`);
  return fn(guild, panel);
}

async function refresh(guild, kind = null) {
  for (const panel of db.panels(guild.id, kind)) {
    const panelKind = panel.kind ?? 'tickets';
    if (!renderers.has(panelKind)) continue;
    const channel = guild.channels.cache.get(panel.channelId);
    if (!channel) {
      db.removePanel(guild.id, panel.messageId);
      continue;
    }
    const message = await channel.messages.fetch(panel.messageId).catch((e) => (e.code === 10008 ? null : undefined));
    if (message === null) {
      db.removePanel(guild.id, panel.messageId);
      continue;
    }
    if (!message) continue;
    const payload = await render(panelKind, guild, panel);
    delete payload.files;
    await message.edit(payload).catch((err) => console.warn(`[panel] Failed to refresh the ${panelKind} panel in #${channel.name}:`, err.message));
  }
}

async function refreshAll(client, kind = null) {
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await refresh(guild, kind).catch((err) => console.warn('[panel]', err.message));
  }
}

/** Refresh a guild's panels of one kind a few seconds from now (many changes → one edit). */
function schedule(guild, kind) {
  if (!guild) return;
  const key = `${guild.id}:${kind}`;
  if (timers.has(key)) return;
  const timer = setTimeout(() => {
    timers.delete(key);
    refresh(guild, kind).catch((err) => console.warn('[panel]', err.message));
  }, 3000);
  timer.unref?.();
  timers.set(key, timer);
}

/** Send a new live panel to a channel and remember it. */
async function send(channel, kind, extra = {}) {
  const payload = await render(kind, channel.guild, extra);
  const message = await channel.send(payload);
  db.addPanel(channel.guild.id, { kind, channelId: channel.id, messageId: message.id, ...extra });
  return message;
}

module.exports = { register, render, refresh, refreshAll, schedule, send };
