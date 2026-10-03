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

/**
 * A renderer returns the whole message, so an edit replaces the files too: images (e.g. product pictures shown
 * with attachment://) are uploaded again and files that are no longer used are removed.
 */
const forEdit = (payload) => ({ ...payload, files: payload.files ?? [], attachments: [] });

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
    const payload = forEdit(await render(panelKind, guild, panel));
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

/**
 * "Sticky" panel: re-sends the panel as the newest message of the channel and deletes the old
 * copy, so it's always the first thing people see (used after every new vouch).
 * Calls are queued per channel, so two vouches at the same moment never leave two panels.
 */
const bumpQueues = new Map();
function bump(guild, kind, channelId) {
  const key = `${guild.id}:${channelId}:${kind}`;
  const next = (bumpQueues.get(key) ?? Promise.resolve())
    .then(() => doBump(guild, kind, channelId))
    .catch((err) => console.warn(`[panel] Failed to move the ${kind} panel down:`, err.message));
  bumpQueues.set(key, next);
  next.finally(() => {
    if (bumpQueues.get(key) === next) bumpQueues.delete(key);
  });
  return next;
}

async function doBump(guild, kind, channelId) {
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;
  for (const panel of db.panels(guild.id, kind).filter((p) => p.channelId === channelId)) {
    const fresh = await channel.send(await render(kind, guild, panel));
    db.removePanel(guild.id, panel.messageId);
    db.addPanel(guild.id, { ...panel, messageId: fresh.id });
    db.replacePostId(guild.id, panel.messageId, fresh.id);
    const old = await channel.messages.fetch(panel.messageId).catch(() => null);
    if (old) await old.delete().catch(() => null);
  }
}

/** Send a new live panel to a channel and remember it. */
async function send(channel, kind, extra = {}) {
  const payload = await render(kind, channel.guild, extra);
  const message = await channel.send(payload);
  db.addPanel(channel.guild.id, { kind, channelId: channel.id, messageId: message.id, ...extra });
  return message;
}

module.exports = { register, render, forEdit, refresh, refreshAll, schedule, send, bump };
