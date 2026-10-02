'use strict';

const config = require('../lib/config');
const db = require('../lib/db');
const panels = require('../lib/panels');
const { e, COLORS } = require('../lib/theme');
const { ts } = require('../lib/utils');
const { container, text, divider, header, v2 } = require('../lib/v2');

/**
 * Server stats: locked voice channels showing the member and vouch count, plus an
 * activity leaderboard (messages this week / all time) in #leaderboard.
 */

const WEEK = 7 * 86_400_000;
/** Week number, weeks start on Monday 00:00 UTC. */
const weekKey = (t = Date.now()) => Math.floor((t + 3 * 86_400_000) / WEEK);
const weekEnds = (key) => (key + 1) * WEEK - 3 * 86_400_000;

const STAT_NAMES = {
  statMembers: (n) => `👥 Members: ${n.toLocaleString('en-US')}`,
  statVouches: (n) => `⭐ Vouches: ${n.toLocaleString('en-US')}`,
};

function trackMessage(message) {
  if (!message.guild || message.author.bot) return;
  if (db.getTicket(message.channel.id)) return; // ticket chats don't count
  const a = db.guild(message.guild.id).activity;
  const key = weekKey();
  if (a.weekKey !== key) {
    a.weekKey = key;
    a.week = {};
  }
  a.total[message.author.id] = (a.total[message.author.id] ?? 0) + 1;
  a.week[message.author.id] = (a.week[message.author.id] ?? 0) + 1;
  db.save();
}

function top(map, n = 10) {
  return Object.entries(map ?? {})
    .sort((x, y) => y[1] - x[1])
    .slice(0, n);
}

function leaderboardPanel(guild) {
  const a = db.guild(guild.id).activity;
  const key = weekKey();
  const week = a.weekKey === key ? a.week : {};
  const medal = (i) => ['🥇', '🥈', '🥉'][i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
  const list = (entries) => (entries.length ? entries.map(([id, n], i) => `${medal(i)} <@${id}> – **${n.toLocaleString('en-US')}** messages`).join('\n') : '*Nobody yet – start chatting!*');

  const c = container(COLORS.brand);
  header(c, `# ${e(guild, 'trophy')} Leaderboard\nThe most active members of **${config.brand.name}**. Chat, help others and climb the ranks!`, guild.iconURL?.({ size: 256 }));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`### ${e(guild, 'flame')} This week\n${list(top(week))}\n-# Resets ${ts(weekEnds(key), 'R')}`));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`### ${e(guild, 'crown')} All time\n${list(top(a.total))}`));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`-# Updated ${ts(Date.now(), 'R')} · Ticket messages and bots don't count.`));
  return v2(c);
}

panels.register('leaderboard', (guild) => leaderboardPanel(guild));

async function updateStatChannels(client) {
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const values = { statMembers: guild.memberCount ?? 0, statVouches: db.guild(guildId).vouches.length };
    for (const [key, value] of Object.entries(values)) {
      const channel = guild.channels.cache.get(db.channelId(guildId, key) ?? '');
      if (!channel) continue;
      const name = STAT_NAMES[key](value);
      // Discord allows 2 renames per 10 minutes per channel – this runs every 10 minutes at most.
      if (channel.name !== name) await channel.setName(name, 'Stats update').catch(() => null);
    }
  }
}

module.exports = { weekKey, STAT_NAMES, trackMessage, leaderboardPanel, updateStatChannels, top };
