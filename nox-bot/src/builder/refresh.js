'use strict';

const { ChannelType } = require('discord.js');
const db = require('../lib/db');
const panels = require('../lib/panels');
const { banner, hasBanner } = require('../lib/theme');
const { CATEGORIES } = require('./layout');
const { postsFor } = require('./content');
const { sendItem, describeError } = require('./executor');

/**
 * /build only:panels – updates every banner, card and panel /build posted IN PLACE, so nothing
 * moves and other messages in those channels (vouches, giveaways, announcements, welcome cards)
 * are never touched.
 */

/** For servers built before message tracking existed: the oldest bot messages are the /build posts. */
async function guessLegacyPosts(channel, count) {
  const me = channel.guild.members.me?.id;
  const batch = await channel.messages.fetch({ after: '0', limit: 100 }).catch(() => null);
  if (!batch || !me) return [];
  const panelIds = new Set(db.panels(channel.guild.id).map((p) => p.messageId));
  return [...batch.values()]
    .filter((m) => m.author?.id === me)
    .sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1))
    .slice(0, count)
    .map((m) => ({ id: m.id, type: panelIds.has(m.id) ? 'panel' : m.attachments?.size && !m.components?.length ? 'banner' : 'card' }));
}

/** Edits one channel's /build messages to the current content (in place where possible). */
async function syncPosts(channel, postKey, tracked, res) {
  const guild = channel.guild;
  const items = postsFor(postKey, guild).filter((item) => !item.banner || hasBanner(item.banner));
  const entries = tracked?.length ? tracked : await guessLegacyPosts(channel, items.length);
  const used = new Set();
  const out = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const type = item.banner ? 'banner' : item.panel ? 'panel' : 'card';
    const entry = entries[i];
    const msg = entry && entry.type === type && !used.has(entry.id) ? await channel.messages.fetch(entry.id).catch(() => null) : null;

    if (!msg) {
      // The message is gone (deleted by someone) – send it again.
      const posted = await sendItem(channel, item);
      if (posted) {
        out.push(posted);
        used.add(posted.id);
        res.sent += 1;
      }
      continue;
    }
    used.add(msg.id);
    if (type === 'banner') {
      // Legacy entries don't know their banner – assume the one at this position is right.
      if ((entry.banner ?? item.banner) !== item.banner) {
        await msg.edit({ files: [banner(item.banner)], attachments: [] });
        res.edited += 1;
      }
      out.push({ type, id: msg.id, banner: item.banner });
    } else if (type === 'card') {
      await msg.edit(item.payload);
      res.edited += 1;
      out.push({ type, id: msg.id });
    } else {
      const existing = db.panels(guild.id).find((p) => p.messageId === msg.id);
      const panel = { ...(existing ?? {}), ...(item.extra ?? {}), kind: item.panel, channelId: channel.id, messageId: msg.id };
      await msg.edit(panels.forEdit(await panels.render(item.panel, guild, panel)));
      db.addPanel(guild.id, panel);
      res.edited += 1;
      out.push({ type, id: msg.id, kind: item.panel });
    }
  }

  // Old /build messages that are no longer part of the content.
  for (const entry of entries) {
    if (used.has(entry.id)) continue;
    const old = await channel.messages.fetch(entry.id).catch(() => null);
    if (old) {
      await old.delete().catch(() => null);
      res.removed += 1;
    }
    db.removePanel(guild.id, entry.id);
  }
  return out;
}

/** Updates every banner, card and panel /build posted. */
async function refreshContent(guild) {
  const build = db.build(guild.id);
  if (!build) throw new Error('This server was not built yet – run /build first.');
  const posts = { ...(build.posts ?? {}) };
  const res = { channels: 0, edited: 0, sent: 0, removed: 0, errors: [] };
  for (const cat of CATEGORIES) {
    for (const ch of cat.channels) {
      if (!ch.post) continue;
      const channel = guild.channels.cache.get(build.channels?.[ch.key] ?? '');
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) continue;
      try {
        posts[ch.key] = await syncPosts(channel, ch.post, posts[ch.key], res);
        res.channels += 1;
      } catch (err) {
        res.errors.push(`#${channel.name}: ${describeError(err)}`);
      }
    }
  }
  db.setBuild(guild.id, { ...db.build(guild.id), posts });
  // Panels sent with /panel in other channels get the new look too.
  await panels.refresh(guild).catch(() => null);
  return res;
}

module.exports = { refreshContent, syncPosts };
