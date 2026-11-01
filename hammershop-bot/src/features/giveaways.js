'use strict';

const crypto = require('node:crypto');
const { ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const invites = require('./invites');
const { e, ce, COLORS } = require('../lib/theme');
const { UserError, embed, ts, truncate, sendToChannel, plural, count } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
const { container, text, divider, btn, row, header, v2, linkBtn, channelUrl } = require('../lib/v2');

/**
 * Giveaways: /giveaway start posts a card with an "Enter" button. Entries are stored in
 * data/db.json, so a restart doesn't lose anything. A ticker ends giveaways on time.
 *
 * Who can enter (all optional – giveaways from before a requirement existed simply don't have it):
 *   requiredRoleId   members with this role
 *   buyersOnly       customers: at least one completed order, or the Customer role
 *   minInvites       members with at least this many valid invites (features/invites.js – verified and still here)
 * All of them are checked again for whoever is drawn: a role can be taken away, invites drop when invited members leave.
 */

const editTimers = new Map();

function all(guildId) {
  return Object.values(db.guild(guildId).giveaways);
}

function card(guild, gw) {
  const ended = gw.ended;
  const c = container(ended ? COLORS.muted : COLORS.brand);
  const lines = [
    `# ${e(guild, 'gift')} ${gw.prize}`,
    gw.description ? `${gw.description}\n` : '',
    ended ? `**Zakończony:** ${ts(gw.endsAt, 'R')}` : `**Koniec:** ${ts(gw.endsAt, 'R')} (${ts(gw.endsAt, 'f')})`,
    `**Zwycięzcy:** ${gw.winnersCount}${' '}·${' '}**Uczestnicy:** ${gw.entries.length}`,
    `**Organizator:** <@${gw.hostId}>`,
  ];
  if (gw.requiredRoleId) lines.push(`**Wymagana rola:** <@&${gw.requiredRoleId}>`);
  if (gw.buyersOnly) lines.push(`${e(guild, 'cart')} Tylko dla klientów`);
  if (gw.minInvites) lines.push(`📨 Trzeba zaprosić co najmniej **${gw.minInvites}** ${plural(gw.minInvites, 'osobę', 'osoby', 'osób')}`);
  header(c, lines.filter(Boolean).join('\n'), guild.iconURL?.({ size: 256 }));
  c.addSeparatorComponents(divider());
  if (ended) {
    c.addTextDisplayComponents(
      text(gw.winners.length ? `### ${e(guild, 'trophy')} Zwycięzcy\n${gw.winners.map((id) => `<@${id}>`).join(', ')}` : '### 😢 Brak ważnych zgłoszeń – tym razem bez zwycięzcy.'),
    );
  } else {
    const recheck = gw.requiredRoleId || gw.buyersOnly || gw.minInvites ? ' – wtedy wymagania są sprawdzane ponownie' : '';
    c.addTextDisplayComponents(text(`-# Kliknij **Dołącz**, żeby wziąć udział. Kliknij jeszcze raz, żeby się wypisać. Zwycięzcy zostaną wylosowani, gdy skończy się czas${recheck}.`));
    c.addActionRowComponents(row(btn(`gw:enter:${gw.id}`, 'Dołącz', ce(guild, 'gift'), ButtonStyle.Primary)));
  }
  return v2(c);
}

async function fetchMessage(guild, gw) {
  const channel = guild.channels.cache.get(gw.channelId);
  if (!channel) return null;
  return channel.messages.fetch(gw.messageId).catch(() => null);
}

function scheduleEdit(guild, gw) {
  if (editTimers.has(gw.id)) return;
  const timer = setTimeout(async () => {
    editTimers.delete(gw.id);
    const msg = await fetchMessage(guild, gw);
    if (msg) await msg.edit(card(guild, gw)).catch(() => null);
  }, 4000);
  timer.unref?.();
  editTimers.set(gw.id, timer);
}

async function start(guild, host, { prize, durationMs, winners, description, channel, requiredRole, buyersOnly = false, minInvites = null, ping }) {
  if (durationMs < 60_000) throw new UserError('Giveaway musi trwać co najmniej 1 minutę.');
  if (durationMs > 60 * 86_400_000) throw new UserError('Giveaway może trwać najwyżej 60 dni.');
  if (minInvites && config.invites.enabled === false) {
    throw new UserError('Śledzenie zaproszeń jest wyłączone (`invites.enabled` w config.json) – giveaway nie może wymagać zaproszeń.');
  }
  const target = channel ?? guild.channels.cache.get(db.channelId(guild.id, 'giveaways'));
  if (!target?.isTextBased?.()) throw new UserError(`Wybierz kanał – nie ma jeszcze kanału z giveawayami (użyj \`${slash('build')}\`).`);

  const gw = {
    id: crypto.randomBytes(4).toString('hex'),
    guildId: guild.id,
    channelId: target.id,
    messageId: null,
    prize: truncate(prize, 120),
    description: description ? truncate(description, 600) : null,
    winnersCount: Math.max(1, Math.min(20, winners || 1)),
    endsAt: Date.now() + durationMs,
    hostId: host.id,
    requiredRoleId: requiredRole?.id ?? null,
    buyersOnly: Boolean(buyersOnly),
    minInvites: minInvites ? Math.max(1, Math.min(100, Math.trunc(minInvites))) : null,
    entries: [],
    winners: [],
    ended: false,
    createdAt: Date.now(),
  };
  const payload = card(guild, gw);
  const pingRole = ping ? db.roleId(guild.id, 'pingGiveaways') : null;
  if (pingRole) {
    payload.components[0].addTextDisplayComponents(text(`-# 🔔 <@&${pingRole}>`));
    payload.allowedMentions = { roles: [pingRole] };
  }
  const message = await target.send(payload);
  gw.messageId = message.id;
  db.guild(guild.id).giveaways[gw.id] = gw;
  db.save();
  return { gw, message };
}

// ───────────── Requirements ─────────────

/** Has this member bought something? A completed order – or the Customer role (e.g. given by hand). */
function isCustomer(member) {
  if ((db.guild(member.guild.id).orders[member.id] ?? 0) > 0) return true;
  const role = db.roleId(member.guild.id, 'customer');
  return Boolean(role && member.roles.cache.has(role));
}

/** How many valid invites this member still needs for the giveaway (0 = enough, or no min_invites). */
function invitesMissing(guildId, userId, gw) {
  if (!gw.minInvites) return 0;
  return Math.max(0, gw.minInvites - invites.counts(guildId, userId).valid);
}

/** Why this member can't enter – { reason, buttons } – or null when they can. */
function entryBlock(member, gw) {
  const guild = member.guild;
  if (gw.requiredRoleId && !member.roles.cache.has(gw.requiredRoleId)) {
    return { reason: `🔒 Żeby dołączyć do tego giveawayu, potrzebujesz roli <@&${gw.requiredRoleId}>.`, buttons: [] };
  }
  if (gw.buyersOnly && !isCustomer(member)) {
    const shop = db.channelId(guild.id, 'shop');
    return {
      reason: `${e(guild, 'cart')} Ten giveaway jest tylko dla klientów – potrzebujesz co najmniej jednego zrealizowanego zamówienia. Kup cokolwiek ${shop ? `na <#${shop}>` : 'w sklepie'} i możesz dołączyć!`,
      buttons: shop ? [linkBtn(channelUrl(guild.id, shop), 'Sklep', ce(guild, 'cart'))] : [],
    };
  }
  const missing = invitesMissing(guild.id, member.id, gw);
  if (missing) {
    const have = gw.minInvites - missing;
    return {
      reason:
        `📨 Żeby dołączyć do tego giveawayu, potrzebujesz co najmniej **${gw.minInvites}** ${plural(gw.minInvites, 'ważnego zaproszenia', 'ważnych zaproszeń', 'ważnych zaproszeń')} – masz **${have}**.\n` +
        `-# Zaproszone osoby liczą się, gdy się zweryfikują, i dopóki zostają na serwerze. Twoje zaproszenia pokazuje \`${slash('invites stats')}\`.`,
      buttons: [],
    };
  }
  return null;
}

/** Random winners from the entries – only people who are still on the server and still meet every requirement can win. */
async function drawWinners(guild, entries, count, exclude = [], gw = {}) {
  const pool = entries.filter((id) => !exclude.includes(id));
  const winners = [];
  while (pool.length && winners.length < count) {
    const id = pool.splice(crypto.randomInt(pool.length), 1)[0];
    const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
    if (member && !entryBlock(member, gw)) winners.push(id);
  }
  return winners;
}

const drawing = new Set(); // giveaways whose winners are being drawn right now

/** Ends a giveaway (or rerolls it) – one draw at a time, and a normal end only once. */
async function end(guild, gw, opts = {}) {
  if (drawing.has(gw.id)) throw new UserError('Zwycięzcy tego giveawayu są właśnie losowani – spróbuj ponownie za chwilę.');
  if (!opts.reroll && gw.ended) throw new UserError(`Ten giveaway już się zakończył – użyj \`${slash('giveaway reroll')}\`, żeby wylosować nowego zwycięzcę.`);
  drawing.add(gw.id);
  try {
    return await draw(guild, gw, opts);
  } finally {
    drawing.delete(gw.id);
  }
}

async function draw(guild, gw, { reroll = false, count = null } = {}) {
  const winners = await drawWinners(guild, gw.entries, count ?? gw.winnersCount, reroll ? gw.winners : [], gw);
  // A reroll adds the new winners (so they're excluded from the next reroll too).
  gw.winners = reroll ? [...new Set([...gw.winners, ...winners])] : winners;
  gw.ended = true;
  if (!reroll) gw.endsAt = Math.min(gw.endsAt, Date.now());
  db.save();

  const msg = await fetchMessage(guild, gw);
  if (msg) await msg.edit(card(guild, gw)).catch(() => null);

  const c = container(winners.length ? COLORS.success : COLORS.muted);
  const rewardType = config.getType('reward');
  const tickets = db.channelId(guild.id, 'tickets');
  if (winners.length) {
    c.addTextDisplayComponents(
      text(
        `## ${e(guild, 'trophy')} ${reroll ? (winners.length === 1 ? 'Nowy zwycięzca' : 'Nowi zwycięzcy') : 'Gratulacje'}!\n${winners.map((id) => `<@${id}>`).join(', ')} ${winners.length === 1 ? 'wygrywa' : 'wygrywają'} **${gw.prize}**! 🎉\n` +
          (rewardType ? `Odbierz nagrodę w ciągu **48 godzin** – otwórz ticket **${rewardType.emoji ?? '🎁'} ${rewardType.label}**.` : 'Skontaktuj się z zespołem, żeby odebrać nagrodę.'),
      ),
    );
    const buttons = [];
    if (rewardType) buttons.push(btn(`ticket:open:${rewardType.id}`, 'Odbierz nagrodę', ce(guild, 'gift'), ButtonStyle.Success));
    else if (tickets) buttons.push(linkBtn(channelUrl(guild.id, tickets), 'Pomoc', ce(guild, 'ticket')));
    if (msg) buttons.push(linkBtn(msg.url, 'Giveaway', '🎉'));
    if (buttons.length) c.addActionRowComponents(row(...buttons));
  } else {
    c.addTextDisplayComponents(text(`### 😢 Giveaway z nagrodą **${gw.prize}** zakończył się bez ważnych zgłoszeń.`));
  }
  await sendToChannel(guild, gw.channelId, v2(c, { mentions: { users: winners } }));
  return winners;
}

async function toggleEntry(interaction) {
  const id = interaction.customId.split(':')[2];
  const gw = db.guild(interaction.guild.id).giveaways[id];
  const say = (color, msg, buttons = []) =>
    interaction.reply({ embeds: [embed(color).setDescription(msg)], components: buttons.length ? [row(...buttons)] : [], flags: MessageFlags.Ephemeral });
  if (!gw || gw.ended || Date.now() >= gw.endsAt) return say(COLORS.muted, '⌛ Ten giveaway już się zakończył.');
  // Leaving always works – even when a requirement isn't met any more (e.g. invites dropped).
  if (gw.entries.includes(interaction.user.id)) {
    gw.entries = gw.entries.filter((x) => x !== interaction.user.id);
    db.save();
    scheduleEdit(interaction.guild, gw);
    return say(COLORS.muted, `👋 Wypisano Cię z giveawayu z nagrodą **${gw.prize}**. Kliknij **Dołącz** jeszcze raz, jeśli zmienisz zdanie.`);
  }
  const blocked = entryBlock(interaction.member, gw);
  if (blocked) return say(COLORS.warning, blocked.reason, blocked.buttons);
  gw.entries.push(interaction.user.id);
  db.save();
  scheduleEdit(interaction.guild, gw);
  return say(COLORS.success, `🎉 Bierzesz udział! Powodzenia w walce o **${gw.prize}** – zwycięzcy zostaną wylosowani ${ts(gw.endsAt, 'R')}.\n-# Kliknij **Dołącz** jeszcze raz, żeby się wypisać.`);
}

async function tick(client) {
  const now = Date.now();
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || guild.available === false) continue;
    for (const gw of all(guildId)) {
      if (gw.ended || gw.endsAt > now) continue;
      await end(guild, gw).catch((err) => console.error(`[giveaway] Nie udało się zakończyć ${gw.id}:`, err.message));
    }
  }
}

function find(guildId, query) {
  const q = String(query ?? '').trim();
  const list = all(guildId);
  return list.find((g) => g.id === q || g.messageId === q) ?? list.find((g) => g.prize.toLowerCase() === q.toLowerCase()) ?? null;
}

function autocomplete(interaction, { active = null } = {}) {
  const q = interaction.options.getFocused().toLowerCase();
  const list = all(interaction.guild.id)
    .filter((g) => active === null || g.ended !== active)
    .filter((g) => !q || g.prize.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 25);
  return interaction.respond(list.map((g) => ({ name: truncate(`${g.ended ? '✅' : '🎉'} ${g.prize} · ${count(g.entries.length, 'uczestnik', 'uczestników', 'uczestników')}`, 100), value: g.id })));
}

module.exports = { all, card, start, end, toggleEntry, tick, find, autocomplete, drawWinners };
