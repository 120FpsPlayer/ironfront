'use strict';

/**
 * Lockdown (/lockdown, /unlock) – for raids and emergencies. Members can still read, but can't write, react,
 * open threads or use voice – and can't post through the bot either: new vouches, tickets and orders are paused
 * for everyone but the staff (pausedFor). Open tickets keep working (their owners have their own overwrite).
 *
 *   lock    takes LOCKED away from every role that isn't staff – the Member role, @everyone and any other role
 *           that grants it (old roles, level roles …) – and from their channel overwrites that allow it. Staff
 *           roles that relied on those roles for it get it themselves until /unlock, so the team keeps talking.
 *           Roles I can't edit are reported. Pauses invites when config.security.lockdownPausesInvites, posts a
 *           notice in #announcements (or #chat)
 *   unlock  gives back exactly what was taken (and takes back what staff roles were given), resumes invites only
 *           if the lockdown paused them
 * Lock and unlock of one server run one after another: an /unlock during a running /lockdown waits for it.
 * Never touched: staff roles (permissions.allStaffRoleIds, with every ticket type's roles), the Bots role, roles of
 * bots and roles with Administrator.
 *
 * State (survives restarts) – db.guild(id).security.lockdown:
 *   { by, at, reason, roleId, memberPermissions, roles: [{ id, permissions }], staffRoles: [{ id, added }],
 *     channels: [{ id, roleId, allow }], invitesPaused, invitesAlreadyPaused }
 *   permission bits are strings (JSON has no BigInt); roles = the other locked roles and their bits before the lock
 */

const { OverwriteType, PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, COLORS } = require('../lib/theme');
const { allStaffRoleIds, isStaff } = require('../lib/permissions');
const { toBits } = require('../builder/permissions');
const { UserError, embed, logEmbed, ts, duration, truncate, sendToChannel } = require('../lib/utils');
const { container, text, header, v2 } = require('../lib/v2');

const LOCKED = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions', 'Connect', 'Speak'];
const LOCK_BITS = toBits(LOCKED);
const INVITES_DISABLED = 'INVITES_DISABLED';
const LABELS = {
  SendMessages: 'Send Messages',
  SendMessagesInThreads: 'Send Messages in Threads',
  CreatePublicThreads: 'Create Public Threads',
  CreatePrivateThreads: 'Create Private Threads',
  AddReactions: 'Add Reactions',
  Connect: 'Connect',
  Speak: 'Speak',
};

const current = (guildId) => db.guild(guildId).security.lockdown ?? null;

/** While the server is locked, members can't open tickets or orders or post vouches – staff can. */
const pausedFor = (member) => Boolean(member?.guild && current(member.guild.id) && !isStaff(member));

function memberRole(guild, id = null) {
  const roleId = id ?? db.roleId(guild.id, 'member') ?? db.guild(guild.id).settings.verifyRoleId;
  return roleId ? guild.roles.cache.get(roleId) ?? null : null;
}

/** { SendMessages: value, … } for every permission in `bits`. */
const flags = (bits, value) => Object.fromEntries(new PermissionsBitField(bits).toArray().map((name) => [name, value]));

const auditReason = (member, what) => `${config.brand.name}: ${what} by ${member.user?.tag ?? member.user?.username ?? member.id}`.slice(0, 512);

/** Lock and unlock of one server run one after another – an /unlock never cuts into a running /lockdown. */
const queues = new Map();
function serial(guildId, job) {
  const run = (queues.get(guildId) ?? Promise.resolve()).then(job);
  queues.set(guildId, run.catch(() => null));
  return run;
}

/** The staff roles (with every ticket type's) – they keep talking and are never locked. */
const staffRoleIds = (guild) => allStaffRoleIds(guild, config.ticketTypes);

/** Roles a lockdown leaves alone: staff, the Bots role, roles of bots, Administrator (can't be taken in parts). */
function untouchable(guild, staff) {
  const bots = db.roleId(guild.id, 'bots');
  return (role) => staff.has(role.id) || role.id === bots || Boolean(role.tags?.botId) || role.permissions.has(PermissionFlagsBits.Administrator);
}

/**
 * Can I change this role's permissions? discord.js says no for every managed role, but the booster role and
 * integration roles (held by people) can be edited when they're below my role – a failed try is reported anyway.
 */
const canEdit = (guild, role) => role.editable || (role.managed && !role.tags?.botId && (guild.members.me?.roles?.highest?.position ?? 0) > role.position);

const roleList = (roles, max = 15) => `${roles.slice(0, max).map((r) => `${r}`).join(', ')}${roles.length > max ? ` and ${roles.length - max} more` : ''}`;
/** "**Send Messages**, **Add Reactions** and **Connect**" – the locked permissions in `bits`. */
function allowed(bits) {
  const names = new PermissionsBitField(bits & LOCK_BITS).toArray().map((name) => `**${LABELS[name] ?? name}**`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names.join('');
}

/** #announcements, or #chat when there is none. */
async function postNotice(guild, payload) {
  const channelId = db.channelId(guild.id, 'announcements') ?? db.channelId(guild.id, 'chat');
  return channelId ? sendToChannel(guild, channelId, payload) : null;
}

function lockedCard(guild, lockdown) {
  const c = container(COLORS.warning);
  header(
    c,
    `## ${e(guild, 'lock_locked')} The server is locked\n` +
      `We're dealing with an issue right now${lockdown.reason ? `: **${truncate(lockdown.reason, 200)}**` : ''}. ` +
      'Chat, reactions, threads and voice are paused for members for a moment – and so are new tickets, orders and vouches.\n' +
      `> ${e(guild, 'ticket')} Your open tickets keep working – the team can still help you there.`,
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`-# Locked ${ts(lockdown.at, 'R')} · we'll post here as soon as everything is back to normal 💜`));
  return v2(c);
}

function unlockedCard(guild, lockdown, now = Date.now()) {
  const c = container(COLORS.success);
  header(
    c,
    `## ${e(guild, 'lock_unlocked')} The server is unlocked\n` +
      'Everything is back to normal – chat, reactions, voice, tickets, orders and vouches are open again. Thank you for your patience 💜',
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`-# Unlocked ${ts(now, 'R')} · the lockdown lasted ${duration(now - lockdown.at)}`));
  return v2(c);
}

async function log(guild, title, color, lines) {
  const entry = logEmbed(color, title).setDescription(lines.join('\n'));
  await sendToChannel(guild, db.channelId(guild.id, 'serverLogs'), { embeds: [entry], allowedMentions: { parse: [] } });
}

/** Locks the server. Returns what was done (for the reply). */
const lock = (guild, by, reason = null) => serial(guild.id, () => applyLock(guild, by, reason));

async function applyLock(guild, by, reason) {
  const security = db.guild(guild.id).security;
  const active = security.lockdown;
  if (active) throw new UserError(`The server is already locked – since ${ts(active.at, 'R')} by <@${active.by}>. Use \`/unlock\` to lift it.`);
  const role = memberRole(guild);
  if (!role) throw new UserError('There is no Member role to lock – run `/build` first.');
  if (!role.editable) throw new UserError(`I can't edit ${role} – drag my role above it in **Server Settings → Roles** and try again.`);

  const why = auditReason(by, 'lockdown');
  const staff = staffRoleIds(guild);
  const leftAlone = untouchable(guild, staff);
  const lockable = (r) => r.id === role.id || !leftAlone(r);
  const before = role.permissions.bitfield;
  const lockdown = {
    by: by.id,
    at: Date.now(),
    reason: reason || null,
    roleId: role.id,
    memberPermissions: String(before),
    roles: [],
    staffRoles: [],
    channels: [],
    invitesPaused: false,
    invitesAlreadyPaused: false,
  };
  security.lockdown = lockdown; // saved first, then after every step – if anything fails halfway, /unlock still knows what to give back
  db.save();
  try {
    await role.setPermissions(before & ~LOCK_BITS, why);
  } catch (err) {
    delete security.lockdown;
    db.save();
    throw err;
  }

  // Every other role that lets people chat: @everyone, old roles kept by "Build", level roles, the booster role …
  let taken = before & LOCK_BITS;
  const roles = [];
  const gaps = [];
  for (const other of guild.roles.cache.values()) {
    const bits = other.permissions.bitfield;
    if (other.id === role.id || !lockable(other) || !(bits & LOCK_BITS)) continue;
    if (!canEdit(guild, other)) {
      gaps.push(other);
      continue;
    }
    try {
      await other.setPermissions(bits & ~LOCK_BITS, why);
      lockdown.roles.push({ id: other.id, permissions: String(bits) });
      db.save();
      roles.push(other);
      taken |= bits & LOCK_BITS;
    } catch (err) {
      gaps.push(other);
      console.warn(`[lockdown] @${other.name}:`, err.message);
    }
  }

  // Staff roles that only had these permissions through the locked roles keep them – the team keeps talking
  const kept = [];
  const quiet = [];
  for (const id of staff) {
    const staffRole = guild.roles.cache.get(id);
    if (!staffRole || staffRole.managed || staffRole.permissions.has(PermissionFlagsBits.Administrator)) continue; // managed: a bot's role
    const missing = taken & ~staffRole.permissions.bitfield;
    if (!missing) continue;
    if (!staffRole.editable) {
      if (missing & PermissionFlagsBits.SendMessages) quiet.push(staffRole);
      continue;
    }
    try {
      await staffRole.setPermissions(staffRole.permissions.bitfield | missing, why);
      lockdown.staffRoles.push({ id: staffRole.id, added: String(missing) });
      db.save();
      if (missing & PermissionFlagsBits.SendMessages) kept.push(staffRole);
    } catch (err) {
      if (missing & PermissionFlagsBits.SendMessages) quiet.push(staffRole);
      console.warn(`[lockdown] @${staffRole.name}:`, err.message);
    }
  }

  // Channels where a locked role is allowed these permissions directly (e.g. reactions in read-only channels)
  for (const channel of guild.channels.cache.values()) {
    for (const overwrite of channel.permissionOverwrites?.cache?.values() ?? []) {
      const target = overwrite.type === OverwriteType.Role ? guild.roles.cache.get(overwrite.id) : null;
      const allow = overwrite.allow.bitfield & LOCK_BITS;
      if (!target || !allow || !lockable(target)) continue;
      try {
        await channel.permissionOverwrites.edit(target.id, flags(allow, null), { reason: why, type: OverwriteType.Role });
        lockdown.channels.push({ id: channel.id, roleId: target.id, allow: String(allow) });
        db.save();
      } catch (err) {
        console.warn(`[lockdown] #${channel.name}:`, err.message);
      }
    }
  }

  let invites = 'open';
  if (config.security.lockdownPausesInvites) {
    if (guild.features?.includes(INVITES_DISABLED)) {
      invites = 'already';
      lockdown.invitesAlreadyPaused = true;
    } else {
      try {
        await guild.disableInvites(true);
        lockdown.invitesPaused = true;
        invites = 'paused';
      } catch (err) {
        invites = 'failed';
        console.warn(`[lockdown] ${guild.name}: could not pause invites –`, err.message);
      }
    }
    db.save();
  }

  const notice = await postNotice(guild, lockedCard(guild, lockdown));
  await log(guild, '🔒 Server locked', COLORS.warning, [
    `**By:** <@${by.id}>`,
    `**Reason:** ${lockdown.reason ? truncate(lockdown.reason, 500) : '—'}`,
    `**Roles locked:** ${roleList([role, ...roles])}`,
    ...(gaps.length ? [`**Can't lock:** ${roleList(gaps)}`] : []),
    `**Invites:** ${{ paused: 'paused', already: 'were already paused', failed: "couldn't be paused", open: 'stay open' }[invites]}`,
  ]);
  return { role, roles, gaps, kept, quiet, channels: new Set(lockdown.channels.map((c) => c.id)).size, invites, notice };
}

/** Lifts the lockdown: gives back exactly what lock() took. */
const unlock = (guild, by) => serial(guild.id, () => applyUnlock(guild, by));

async function applyUnlock(guild, by) {
  const security = db.guild(guild.id).security;
  const lockdown = security.lockdown;
  if (!lockdown) throw new UserError("The server isn't locked – there's nothing to unlock.");
  const role = memberRole(guild, lockdown.roleId) ?? memberRole(guild);
  if (role && !role.editable) throw new UserError(`I can't edit ${role} – drag my role above it in **Server Settings → Roles** and try again.`);

  const why = auditReason(by, 'end of lockdown');
  // Only the locked permissions are given back – other changes made during the lockdown stay.
  const giveBack = (r, permissions) => r.setPermissions((r.permissions.bitfield & ~LOCK_BITS) | (BigInt(permissions) & LOCK_BITS), why);
  if (role) await giveBack(role, lockdown.memberPermissions);
  const roles = [];
  const failed = [];
  for (const { id, permissions } of lockdown.roles ?? []) {
    const other = guild.roles.cache.get(id);
    if (!other) continue;
    try {
      await giveBack(other, permissions);
      roles.push(other);
    } catch (err) {
      failed.push(other);
      console.warn(`[lockdown] @${other.name}:`, err.message);
    }
  }
  // Staff roles give back exactly what the lockdown lent them
  for (const { id, added } of lockdown.staffRoles ?? []) {
    const staffRole = guild.roles.cache.get(id);
    if (!staffRole) continue;
    try {
      await staffRole.setPermissions(staffRole.permissions.bitfield & ~BigInt(added), why);
    } catch (err) {
      failed.push(staffRole);
      console.warn(`[lockdown] @${staffRole.name}:`, err.message);
    }
  }
  let channels = 0;
  for (const { id, roleId = lockdown.roleId, allow } of lockdown.channels ?? []) {
    const channel = guild.channels.cache.get(id);
    if (!channel || !guild.roles.cache.has(roleId)) continue;
    try {
      await channel.permissionOverwrites.edit(roleId, flags(BigInt(allow), true), { reason: why, type: OverwriteType.Role });
      channels += 1;
    } catch (err) {
      console.warn(`[lockdown] #${channel.name}:`, err.message);
    }
  }

  let invites = lockdown.invitesAlreadyPaused ? 'still paused' : null;
  if (lockdown.invitesPaused) {
    try {
      await guild.disableInvites(false);
      invites = 'resumed';
    } catch (err) {
      invites = 'failed';
      console.warn(`[lockdown] ${guild.name}: could not resume invites –`, err.message);
    }
  }
  delete security.lockdown;
  db.save();

  const now = Date.now();
  const notice = await postNotice(guild, unlockedCard(guild, lockdown, now));
  await log(guild, '🔓 Server unlocked', COLORS.success, [`**By:** <@${by.id}>`, `**Locked for:** ${duration(now - lockdown.at)} (by <@${lockdown.by}>)`]);
  return { role, roles, failed, channels, invites, notice, lockdown };
}

// ───────────── Replies ─────────────

const where = (notice) => (notice ? `in <#${notice.channelId ?? notice.channel?.id}>` : null);

function lockReply(guild, result, reason) {
  const { roles = [], gaps = [], kept = [], quiet = [] } = result;
  const one = (list, a, b) => (list.length === 1 ? a : b);
  const lines = [
    gaps.length
      ? `⚠️ ${result.role} can't send messages, react, create threads or use voice anymore – but members with the roles below still can:`
      : `✅ ${result.role} can't send messages, react, create threads or use voice anymore.`,
  ];
  for (const gap of gaps.slice(0, 10)) {
    lines.push(`⚠️ ${gap} still allows ${allowed(gap.permissions.bitfield)} – I can't edit it (it's above my role or managed by an integration). Take it away in **Server Settings → Roles**.`);
  }
  if (gaps.length > 10) lines.push(`⚠️ … and ${gaps.length - 10} more roles like that.`);
  if (roles.length) lines.push(`✅ Also locked: ${roleList(roles)} – ${one(roles, 'it allowed', 'they allowed')} chatting too.`);
  if (result.channels) lines.push(`✅ Also paused in **${result.channels}** ${result.channels === 1 ? 'channel' : 'channels'} that allowed it for members.`);
  lines.push('✅ New tickets, orders and vouches are paused for members – open tickets keep working.');
  lines.push(
    {
      paused: '✅ Invites are paused – nobody new can join.',
      already: 'ℹ️ Invites were already paused – they stay paused after `/unlock` too.',
      failed: "⚠️ I couldn't pause invites (I need **Manage Server**) – pause them in **Server Settings → Invites**.",
      open: 'ℹ️ Invites stay open (`security.lockdownPausesInvites` is off).',
    }[result.invites],
  );
  lines.push(result.notice ? `✅ Notice posted ${where(result.notice)}.` : '⚠️ There is no #announcements or #chat channel – no notice was posted.');
  if (kept.length) {
    lines.push(
      `✅ ${roleList(kept)} had no **Send Messages** of ${one(kept, 'its', 'their')} own – ${one(kept, 'it gets', 'they get')} it until \`/unlock\`, ` +
        `so ${one(kept, 'its', 'their')} members can still talk.`,
    );
  }
  if (quiet.length) {
    lines.push(
      `⚠️ ${roleList(quiet)} ${one(quiet, 'has', 'have')} no **Send Messages** of ${one(quiet, 'its', 'their')} own and I can't edit ${one(quiet, 'it', 'them')} – ` +
        `${one(quiet, 'its', 'their')} members can't talk until \`/unlock\`. Drag my role above ${one(quiet, 'it', 'them')} or give ${one(quiet, 'it', 'them')} **Send Messages**.`,
    );
  } else if (!kept.length) {
    lines.push('✅ Staff roles keep their own permissions – the team can still talk.');
  }
  const out = embed(COLORS.warning).setTitle('🔒 Server locked').setDescription(`${lines.join('\n')}\n\nUse \`/unlock\` to lift the lockdown.`);
  if (reason) out.addFields({ name: 'Reason', value: truncate(reason, 1024) });
  return out;
}

function unlockReply(guild, result) {
  const { roles = [], failed = [] } = result;
  const lines = [result.role ? `✅ ${result.role} has its permissions back.` : '⚠️ The Member role no longer exists – nothing to give back.'];
  if (roles.length) lines.push(`✅ So ${roles.length === 1 ? 'does' : 'do'} ${roleList(roles)}.`);
  if (failed.length) lines.push(`⚠️ I couldn't restore ${roleList(failed)} – check ${failed.length === 1 ? 'its' : 'their'} permissions in **Server Settings → Roles**.`);
  if (result.channels) lines.push(`✅ Restored **${result.channels}** channel ${result.channels === 1 ? 'permission' : 'permissions'}.`);
  const invites = {
    resumed: '✅ Invites are open again.',
    'still paused': 'ℹ️ Invites were paused before the lockdown, so they stay paused.',
    failed: "⚠️ I couldn't resume invites – turn them back on in **Server Settings → Invites**.",
  }[result.invites];
  if (invites) lines.push(invites);
  lines.push(result.notice ? `✅ Notice posted ${where(result.notice)}.` : '⚠️ There is no #announcements or #chat channel – no notice was posted.');
  lines.push(`-# The lockdown lasted ${duration(Date.now() - result.lockdown.at)} · locked by <@${result.lockdown.by}>`);
  return embed(COLORS.success).setTitle('🔓 Server unlocked').setDescription(lines.join('\n'));
}

hooks.on('ready', (client) => {
  for (const guild of client.guilds.cache.values()) {
    const lockdown = current(guild.id);
    if (lockdown) console.log(`🔒 ${guild.name} is still locked (since ${new Date(lockdown.at).toISOString()}) – /unlock lifts it.`);
  }
});

module.exports = { LOCKED, LOCK_BITS, current, pausedFor, lock, unlock, lockReply, unlockReply, lockedCard, unlockedCard };
