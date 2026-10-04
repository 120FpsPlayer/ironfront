'use strict';

/**
 * Invite tracking with rewards (config.invites).
 *
 *  - The uses of every invite are cached per server – on start, when the bot joins a server and on invite
 *    create / delete. When someone joins, the invite whose uses went up says who invited them (a single-use
 *    invite disappears instead). Vanity URL or no change → inviterId null. Reading invites needs the
 *    Manage Server permission; without it joins are recorded without an inviter and a warning is printed once.
 *  - An invite counts once the new member verifies (hooks 'verified') and only while they stay; leaving takes it
 *    off the count. Self-invites, bots and the bot's own invites never count.
 *  - A member counts for one inviter ever: the first one they verified under (creditedTo, kept across rejoins).
 *    Rejoining through someone else's invite counts for nobody – the same accounts can't be passed around.
 *  - Reaching a level in config.invites.rewards [{ invites, percent }] gives the inviter a personal code
 *    (promos.personal, 30 days, prefix INVITE) by DM – once per level ever, so leaving / rejoining can't farm codes.
 *  - Members who left while the bot was offline stop counting (reconcile) – only after the whole member list of
 *    that server object was fetched, never from a partial one.
 *
 * db.guild(id).invites:
 *   members   { [memberId]: { inviterId, code, joinedAt, verified, verifiedAt?, left, leftAt?, creditedTo? } }
 *   rewarded  { [inviterId]: { [invites]: { code, percent, at, delivered } } }
 */

const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const members = require('../lib/members');
const promos = require('./promos');
const { e, ce, COLORS } = require('../lib/theme');
const { embed, logEmbed, ts, truncate, sendToChannel } = require('../lib/utils');
const { container, text, divider, row, linkBtn, header, v2, channelUrl } = require('../lib/v2');

const REWARD_DAYS = 30;
const DELETED_GRACE = 60_000; // Discord deletes a used-up invite right when someone joins with it

const cache = new Map(); // guildId → Map(code → { code, uses, maxUses, inviterId, deletedAt? })
const unreadable = new Set(); // servers where the bot can't read invites (no Manage Server)
const queues = new Map(); // guildId → promise: joins, leaves and verifications are handled one after another

const enabled = () => config.invites.enabled !== false;

function store(guildId) {
  const invites = db.guild(guildId).invites;
  invites.members ??= {};
  invites.rewarded ??= {};
  return invites;
}

/** Runs jobs of one server in order (two people joining at once must not read the same invite counts). */
function serial(guildId, job) {
  const run = (queues.get(guildId) ?? Promise.resolve()).then(job);
  queues.set(guildId, run.catch(() => null));
  return run;
}

// ───────────── Invite cache ─────────────

function snapshot(invite, guild) {
  const inviterId = invite.inviterId ?? invite.inviter?.id ?? null;
  const byBot = invite.inviter?.bot || (inviterId && inviterId === guild?.client?.user?.id);
  return { code: invite.code, uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0, inviterId: byBot ? null : inviterId };
}

async function fetchInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    unreadable.delete(guild.id);
    return new Map([...invites.values()].map((invite) => [invite.code, snapshot(invite, guild)]));
  } catch (err) {
    if (!unreadable.has(guild.id)) {
      const why = err?.code === 50013 ? 'missing the Manage Server permission' : err?.message ?? err;
      console.warn(`⚠️  [invites] ${guild.name}: can't read the invites (${why}) – joins are recorded without an inviter until that's fixed.`);
    }
    unreadable.add(guild.id);
    return null;
  }
}

/** Re-reads the invites of a server into the cache. */
async function refresh(guild) {
  if (!enabled()) return null;
  const invites = await fetchInvites(guild);
  if (invites) cache.set(guild.id, invites);
  return invites;
}

/** The invite someone just joined with: the one whose uses went up, or a single-use invite that just vanished. */
function usedInvite(before, after, now) {
  const grown = [...after.values()].filter((inv) => inv.uses > (before.get(inv.code)?.uses ?? 0));
  if (grown.length) return { invite: grown.length === 1 ? grown[0] : null, sure: grown.length === 1 };
  const vanished = [...before.values()].filter(
    (inv) => !after.has(inv.code) && inv.maxUses > 0 && inv.uses + 1 >= inv.maxUses && (!inv.deletedAt || now - inv.deletedAt < DELETED_GRACE),
  );
  return { invite: vanished.length === 1 ? vanished[0] : null, sure: vanished.length <= 1 };
}

// ───────────── Members ─────────────

async function attribute(member, now = Date.now()) {
  const guild = member.guild;
  const before = cache.get(guild.id) ?? null;
  const after = await fetchInvites(guild);
  if (after) cache.set(guild.id, after);
  let inviterId = null;
  let code = null;
  if (before && after) {
    const { invite, sure } = usedInvite(before, after, now);
    if (invite) ({ inviterId, code } = invite);
    else if (sure && guild.vanityURLCode) code = guild.vanityURLCode; // nothing changed → the vanity URL
  }
  const records = store(guild.id).members;
  const record = { inviterId, code, joinedAt: now, verified: false, left: false };
  const creditedTo = creditOf(member.id, records[member.id]);
  if (creditedTo) record.creditedTo = creditedTo; // who they counted for stays – everything else starts over
  records[member.id] = record;
  db.save();
  return record;
}

/** The inviter this member has counted for (records from before creditedTo existed: a verified invite). */
function creditOf(id, record) {
  if (!record) return null;
  if (record.creditedTo) return record.creditedTo;
  return record.verified && record.inviterId && record.inviterId !== id ? record.inviterId : null;
}

/** Does this record count for its inviter? Not when the member already counted for someone else. */
const countsFor = (id, record) => Boolean(record.inviterId) && record.inviterId !== id && (!record.creditedTo || record.creditedTo === record.inviterId);

function onLeave(member, now = Date.now()) {
  const record = store(member.guild.id).members[member.id];
  if (!record || record.left) return;
  Object.assign(record, { left: true, leftAt: now });
  db.save();
}

async function onVerified(member) {
  const record = store(member.guild.id).members[member.id];
  if (!record || record.left || record.verified) return [];
  Object.assign(record, { verified: true, verifiedAt: Date.now() });
  if (record.inviterId && record.inviterId !== member.id) record.creditedTo ??= record.inviterId;
  db.save();
  if (!countsFor(member.id, record)) return [];
  return checkRewards(member.guild, record.inviterId);
}

/** Members who left while the bot was offline don't count anymore. Needs the full member list in the cache. */
function reconcile(guild, now = Date.now()) {
  if (!members.complete(guild)) {
    console.warn(`[invites] ${guild.name}: the member list is incomplete – nobody is marked as left.`);
    return 0;
  }
  let changed = 0;
  for (const [id, record] of Object.entries(store(guild.id).members)) {
    if (record.left || guild.members.cache.has(id)) continue;
    Object.assign(record, { left: true, leftAt: now });
    changed += 1;
  }
  if (changed) db.save();
  return changed;
}

async function prepare(guild) {
  if (!enabled()) return;
  await refresh(guild);
  if (await members.fetchAll(guild)) reconcile(guild);
}

// ───────────── Counting ─────────────

/** { valid, pending, left } – valid: verified and still here; pending: not verified yet. */
function counts(guildId, inviterId) {
  const c = { valid: 0, pending: 0, left: 0 };
  for (const [id, r] of Object.entries(store(guildId).members)) {
    if (r.inviterId !== inviterId || !countsFor(id, r)) continue;
    if (r.left) c.left += 1;
    else if (r.verified) c.valid += 1;
    else c.pending += 1;
  }
  return c;
}

/** Inviters with at least one valid invite, best first. */
function leaderboard(guildId) {
  const byInviter = new Map();
  for (const [id, r] of Object.entries(store(guildId).members)) {
    if (!countsFor(id, r)) continue;
    const c = byInviter.get(r.inviterId) ?? { inviterId: r.inviterId, valid: 0, pending: 0, left: 0 };
    if (r.left) c.left += 1;
    else if (r.verified) c.valid += 1;
    else c.pending += 1;
    byInviter.set(r.inviterId, c);
  }
  return [...byInviter.values()].filter((c) => c.valid > 0).sort((a, b) => b.valid - a.valid || b.pending - a.pending || a.left - b.left);
}

/** The reward levels from config.json, smallest first (broken entries are skipped). */
function levels() {
  return (config.invites.rewards ?? [])
    .map((r) => ({ invites: Number(r.invites), percent: Number(r.percent) }))
    .filter((r) => Number.isInteger(r.invites) && r.invites > 0 && r.percent >= 1 && r.percent <= 100)
    .sort((a, b) => a.invites - b.invites);
}

/** The next level this inviter hasn't been rewarded for, or null. */
const nextLevel = (valid, rewarded = {}) => levels().find((l) => !rewarded[l.invites] && l.invites > valid) ?? null;

// ───────────── Rewards ─────────────

const dm = (member, payload) => member.send(payload).then(() => true).catch(() => false);

function rewardCard(guild, inviter, promo, level) {
  const c = container(COLORS.brand);
  header(
    c,
    `## ${e(guild, 'gift')} Invite reward unlocked!\n` +
      `Thank you for growing **${truncate(guild.name, 100)}**, **${truncate(inviter.displayName ?? inviter.user?.username ?? 'friend', 64)}**! 💜 ` +
      `**${level.invites}** people you invited have joined and verified – here's **${promos.label(promo)}** your next order:`,
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`# \`${promo.code}\``));
  c.addSeparatorComponents(divider());
  const next = levels().find((l) => l.invites > level.invites);
  c.addTextDisplayComponents(
    text(
      `### ${e(guild, 'info')} How to use it\n` +
        '> **1.** Open the shop and click **Buy** on any product\n' +
        '> **2.** Paste the code into the **Promo code** field of the order form\n' +
        '> **3.** The discount is taken off your total automatically\n' +
        (next ? `\n${e(guild, 'trophy')} Keep going – **${next.invites}** valid invites unlock **${next.percent}% off**.\n` : '\n') +
        `-# Valid until ${ts(promo.expiresAt, 'f')} (${ts(promo.expiresAt, 'R')}) · only for your account · one use · \`/invites stats\` shows your invites`,
    ),
  );
  const shop = db.channelId(guild.id, 'shop');
  if (shop) c.addActionRowComponents(row(linkBtn(channelUrl(guild.id, shop), 'Shop', ce(guild, 'cart'))));
  return v2(c);
}

/** Gives every reward level the inviter has reached for the first time. Returns the new promo codes. */
async function checkRewards(guild, inviterId) {
  if (config.promos.enabled === false) return [];
  const { valid } = counts(guild.id, inviterId);
  const rewarded = (store(guild.id).rewarded[inviterId] ??= {});
  const due = levels().filter((l) => valid >= l.invites && !rewarded[l.invites]);
  if (!due.length) return [];
  for (const l of due) rewarded[l.invites] = { code: null, percent: l.percent, at: Date.now(), delivered: false }; // claimed before any await
  db.save();

  const inviter = await guild.members.fetch(inviterId).catch(() => null);
  if (!inviter || inviter.user?.bot) {
    for (const l of due) delete rewarded[l.invites]; // given once they're back and the next invite verifies
    db.save();
    return [];
  }
  const given = [];
  for (const l of due) {
    const promo = promos.personal(guild.id, inviterId, { percent: l.percent, days: REWARD_DAYS, prefix: 'INVITE', reason: `${l.invites} invites` });
    Object.assign(rewarded[l.invites], { code: promo.code, delivered: await dm(inviter, rewardCard(guild, inviter, promo, l)) });
    db.save();
    given.push(promo);
    const note = rewarded[l.invites].delivered ? 'sent by DM' : "⚠️ DMs closed – they can see it with `/invites stats`";
    const entry = logEmbed(COLORS.brand, '🎁 Invite reward').setDescription(`<@${inviterId}> reached **${l.invites}** valid invites → \`${promo.code}\` (${promos.label(promo)}) · ${note}`);
    await sendToChannel(guild, db.channelId(guild.id, 'serverLogs'), { embeds: [entry], allowedMentions: { parse: [] } });
  }
  return given;
}

// ───────────── /invites ─────────────

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function codeLine(guildId, code, entry) {
  const promo = promos.find(guildId, code);
  const status = !promo
    ? 'deleted'
    : promo.uses.length
      ? 'used'
      : promo.expiresAt && Date.now() > promo.expiresAt
        ? 'expired'
        : `valid until ${ts(promo.expiresAt, 'D')}`;
  return `\`${code}\` · ${entry.percent}% off · ${status}`;
}

/** /invites stats – valid / pending / left, reward levels, the next reward (and your own codes). */
function statsEmbed(guild, user, { self = false, displayName = null } = {}) {
  const data = store(guild.id);
  const c = counts(guild.id, user.id);
  const rewarded = data.rewarded[user.id] ?? {};
  const list = levels();
  const next = nextLevel(c.valid, rewarded);
  const own = data.members[user.id];
  const intro = [
    self
      ? 'Invite friends with your own invite link – each one counts once they **verify** and **stay** on the server.'
      : `Invites of <@${user.id}>.`,
  ];
  if (own?.inviterId) intro.push(`-# ${self ? 'You' : 'They'} joined through <@${own.inviterId}>'s invite.`);
  const out = embed(COLORS.brand)
    .setTitle(`📨 Invites · ${truncate(displayName ?? user.globalName ?? user.username ?? 'Member', 60)}`)
    .setDescription(intro.join('\n'))
    .addFields(
      { name: '✅ Valid', value: String(c.valid), inline: true },
      { name: '⏳ Pending', value: `${c.pending} (not verified)`, inline: true },
      { name: '🚪 Left', value: String(c.left), inline: true },
      {
        name: '🎁 Next reward',
        value: next
          ? `**${plural(next.invites - c.valid, 'more valid invite')}** → **${next.percent}% off** (a personal code by DM)`
          : list.length
            ? 'Every reward is unlocked – thank you! 💜'
            : 'There are no invite rewards right now.',
      },
    );
  if (list.length) {
    const lines = list.map((l) => `${rewarded[l.invites]?.code ? '✅' : '⬜'} **${l.invites}** valid invites → ${l.percent}% off`);
    out.addFields({ name: '🏆 Reward levels', value: truncate(lines.join('\n'), 1024) });
  }
  const codes = Object.values(rewarded).filter((r) => r.code);
  if (self && codes.length) {
    out.addFields({ name: '🏷️ Your reward codes', value: truncate(codes.map((r) => codeLine(guild.id, r.code, r)).join('\n'), 1024) });
  }
  if (unreadable.has(guild.id)) {
    out.addFields({ name: '⚠️ Tracking paused', value: "I can't see this server's invites (I need **Manage Server**) – new joins aren't counted until that's fixed." });
  }
  return out;
}

const MEDALS = ['🥇', '🥈', '🥉'];

/** /invites top – the 10 best inviters (and where you are). */
function topEmbed(guild, viewerId) {
  const list = leaderboard(guild.id);
  const lines = list.slice(0, 10).map((c, i) => {
    const extra = [c.pending ? `${c.pending} pending` : null, c.left ? `${c.left} left` : null].filter(Boolean).join(' · ');
    return `${MEDALS[i] ?? `**${i + 1}.**`} <@${c.inviterId}> – **${plural(c.valid, 'valid invite')}**${extra ? ` · ${extra}` : ''}`;
  });
  const rank = list.findIndex((c) => c.inviterId === viewerId);
  if (rank >= 10) lines.push(`\nYou're **#${rank + 1}** with ${plural(list[rank].valid, 'valid invite')}.`);
  const body = lines.length ? lines.join('\n') : 'Nobody has a valid invite yet – invite your friends and be the first! 💜';
  return embed(COLORS.brand)
    .setTitle('🏆 Top inviters')
    .setDescription(`${body}\n\n-# Only invited members who verified and are still here count.`);
}

// ───────────── Wiring ─────────────

hooks.on('ready', async (client) => {
  if (!enabled()) return;
  for (const guild of client.guilds.cache.values()) await prepare(guild);
});
hooks.on('guildCreate', (guild) => prepare(guild)); // added (or re-added) to a server: a new Guild object, fetched again
hooks.on('inviteCreate', (invite) => {
  const list = invite.guild && cache.get(invite.guild.id);
  if (list) list.set(invite.code, snapshot(invite, invite.guild));
});
hooks.on('inviteDelete', (invite) => {
  const cached = invite.guild && cache.get(invite.guild.id)?.get(invite.code);
  if (cached) cached.deletedAt = Date.now(); // kept for a moment – the join that used it up may still come
});
hooks.on('memberAdd', (member) => (enabled() && !member.user?.bot ? serial(member.guild.id, () => attribute(member)) : null));
hooks.on('memberRemove', (member) => (enabled() ? serial(member.guild.id, () => onLeave(member)) : null));
hooks.on('verified', (member) => (enabled() ? serial(member.guild.id, () => onVerified(member)) : null));

module.exports = {
  REWARD_DAYS,
  refresh,
  prepare,
  reconcile,
  counts,
  leaderboard,
  levels,
  nextLevel,
  checkRewards,
  rewardCard,
  statsEmbed,
  topEmbed,
  store,
  isReadable: (guildId) => !unreadable.has(guildId),
};
