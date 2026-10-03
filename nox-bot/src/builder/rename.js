'use strict';

/**
 * /build only:names – renames the channels and categories the bot made to the current name style
 * (config.json → server.channelStyle / categoryStyle / smallCaps), without touching anything else.
 * Channels a person renamed are renamed back; ticket channels renamed with /ticket rename are kept.
 */

const { ChannelType } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { safeRename, channelName: ticketChannelName } = require('../lib/utils');
const { statNames } = require('../features/stats');
const { CATEGORIES } = require('./layout');
const style = require('./style');

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Every channel the bot manages, with the name it should have now. */
function wantedNames(guild) {
  const build = db.build(guild.id) ?? {};
  const stats = statNames(guild);
  const list = [];
  for (const cat of CATEGORIES) {
    list.push({ id: build.categories?.[cat.key], name: style.categoryName(cat.name) });
    for (const ch of cat.channels) list.push({ id: build.channels?.[ch.key], name: stats[ch.key] ?? style.channelName(ch.name) });
  }
  const settings = db.settings(guild.id);
  const tickets = CATEGORIES.find((c) => c.key === 'catTickets');
  (settings.overflowCategoryIds ?? []).forEach((id, i) => list.push({ id, name: style.numberedCategoryName(style.categoryName(tickets.name), i + 2) }));
  for (const t of db.tickets((x) => x.guildId === guild.id && x.status !== 'deleted' && !x.customName)) {
    list.push({ id: t.channelId, name: ticketChannelName(t, config.getType(t.typeId)) });
  }
  return list.filter((x) => x.id);
}

/**
 * @returns {Promise<{ renamed: number, unchanged: number, later: string[], errors: string[] }>}
 *   later – channels that hit Discord's limit (2 renames per 10 minutes) – run it again later
 */
async function restyleNames(guild, { onProgress = () => {} } = {}) {
  const res = { renamed: 0, unchanged: 0, later: [], errors: [] };
  const list = wantedNames(guild);
  for (const [i, { id, name }] of list.entries()) {
    onProgress(i, list.length);
    const channel = guild.channels.cache.get(id);
    if (!channel) continue;
    const want = TEXT_TYPES.has(channel.type) ? style.textChannelName(name) : name;
    if (channel.name === want) {
      res.unchanged += 1;
      continue;
    }
    try {
      const r = await safeRename(channel, want);
      if (r.ok) res.renamed += 1;
      else res.later.push(want);
    } catch (err) {
      res.errors.push(`${channel.name}: ${String(err.message || err).slice(0, 150)}`);
    }
  }
  onProgress(list.length, list.length);
  return res;
}

module.exports = { wantedNames, restyleNames };
