'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const db = require('../lib/db');
const config = require('../lib/config');
const { COLORS, embed, reply, replyError, isStaff, duration, count, plural } = require('../lib/utils');

const bar = (n, total, width = 10) => {
  const filled = total ? Math.round((n / total) * width) : 0;
  return `\`${'█'.repeat(filled)}${'░'.repeat(width - filled)}\``;
};
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Ticket & support statistics (staff)')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('staff').setDescription('Show stats for a specific staff member'))
    .addIntegerOption((o) => o.setName('days').setDescription('Range in days (default: all time)').setMinValue(1).setMaxValue(3650)),

  async execute(interaction) {
    if (!isStaff(interaction.member)) return replyError(interaction, 'Statystyki są dostępne tylko dla zespołu.');

    const days = interaction.options.getInteger('days');
    const since = days ? Date.now() - days * 86_400_000 : 0;
    const staffUser = interaction.options.getUser('staff');
    let tickets = db.tickets((t) => t.guildId === interaction.guild.id && t.createdAt >= since);
    if (staffUser) tickets = tickets.filter((t) => t.claimedBy === staffUser.id || t.closedBy === staffUser.id);

    const open = tickets.filter((t) => t.status === 'open').length;
    const ratings = tickets.filter((t) => t.rating).map((t) => t.rating.stars);
    const responses = tickets.filter((t) => t.firstResponseAt).map((t) => t.firstResponseAt - t.createdAt);
    const resolutions = tickets.filter((t) => t.closedAt).map((t) => t.closedAt - t.createdAt);
    const avgRating = avg(ratings);

    const e = embed(COLORS.brand)
      .setTitle(`📊 Statystyki pomocy${staffUser ? ` – ${staffUser.displayName}` : ''}${days ? ` (${count(days, 'dzień', 'dni', 'dni')} wstecz)` : ''}`)
      .addFields(
        { name: 'Łącznie', value: String(tickets.length), inline: true },
        { name: 'Otwarte', value: String(open), inline: true },
        { name: 'Zamknięte', value: String(tickets.length - open), inline: true },
        {
          name: 'Średnia ocena',
          value: avgRating ? `${'⭐'.repeat(Math.round(avgRating))} **${avgRating.toFixed(2)}**/5 (${count(ratings.length, 'ocena', 'oceny', 'ocen')})` : 'brak ocen',
          inline: true,
        },
        { name: 'Śr. czas pierwszej odpowiedzi', value: responses.length ? duration(avg(responses)) : '—', inline: true },
        { name: 'Śr. czas rozwiązania', value: resolutions.length ? duration(avg(resolutions)) : '—', inline: true },
      );

    const perType = config.ticketTypes
      .map((ty) => [ty, tickets.filter((x) => x.typeId === ty.id).length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([ty, n]) => `${ty.emoji ?? '🎫'} ${ty.label} – **${n}** ${bar(n, tickets.length)}`);
    if (perType.length) e.addFields({ name: '📂 Kategorie', value: perType.join('\n') });

    if (ratings.length) {
      const dist = [5, 4, 3, 2, 1].map((n) => {
        const c = ratings.filter((r) => r === n).length;
        return `${n}⭐ ${bar(c, ratings.length)} ${c}`;
      });
      e.addFields({ name: '⭐ Rozkład ocen', value: dist.join('\n'), inline: true });
    }

    const last7 = db.tickets((x) => x.guildId === interaction.guild.id && x.createdAt >= Date.now() - 7 * 86_400_000).length;
    const prev7 = db.tickets(
      (x) => x.guildId === interaction.guild.id && x.createdAt >= Date.now() - 14 * 86_400_000 && x.createdAt < Date.now() - 7 * 86_400_000,
    ).length;
    const trend = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : null;
    e.addFields({
      name: '📅 Ostatnie 7 dni',
      value: `**${last7}** ${plural(last7, 'ticket', 'tickety', 'ticketów')}${trend !== null ? ` (${trend >= 0 ? '📈 +' : '📉 '}${trend}% względem poprzedniego tygodnia)` : ''}`,
      inline: true,
    });

    if (!staffUser) {
      const board = new Map();
      for (const t of tickets) {
        const id = t.claimedBy ?? (t.closedBy && t.closedBy !== t.ownerId ? t.closedBy : null);
        if (!id || id === interaction.client.user.id) continue;
        const entry = board.get(id) ?? { count: 0, stars: [] };
        entry.count += 1;
        if (t.rating) entry.stars.push(t.rating.stars);
        board.set(id, entry);
      }
      const top = [...board.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10)
        .map(([id, s], i) => {
          const r = avg(s.stars);
          return `${['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`} <@${id}> – ${count(s.count, 'ticket', 'tickety', 'ticketów')}${r ? ` · ⭐ ${r.toFixed(1)}` : ''}`;
        });
      if (top.length) e.addFields({ name: '🏆 Ranking zespołu', value: top.join('\n') });
    }

    return reply(interaction, { embeds: [e] });
  },
};
