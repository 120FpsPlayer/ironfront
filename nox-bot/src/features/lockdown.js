'use strict';

/**
 * Lockdown (/lockdown, /unlock) – for raids and emergencies. Members can still read, but can't write, react,
 * open threads or use voice. Staff roles have these permissions themselves (STAFF_PERMISSIONS in
 * src/builder/permissions.js), so the team keeps talking; ticket owners keep their own ticket overwrite.
 *
 *   lock    takes LOCKED away from the Member role and from Member overwrites that allow them in a channel,
 *           pauses invites when config.security.lockdownPausesInvites, posts a notice in #announcements (or #chat)
 *   unlock  gives back exactly what was taken and resumes invites only if the lockdown paused them
 *
 * State (survives restarts) – db.guild(id).security.lockdown:
 *   { by, at, reason, roleId, memberPermissions, channels: [{ id, allow }], invitesPaused, invitesAlreadyPaused }
 *   memberPermissions / allow are permission bits as strings (JSON has no BigInt)
 */

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, COLORS } = require('../lib/theme');
const { STAFF_KEYS } = require('../lib/permissions');
const { toBits } = require('../builder/permissions');
const { UserError, embed, logEmbed, ts, duration, truncate, sendToChannel } = require('../lib/utils');
const { container, text, header, v2 } = require('../lib/v2');

const LOCKED = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions', 'Connect', 'Speak'];
const LOCK_BITS = toBits(LOCKED);
const INVITES_DISABLED = 'INVITES_DISABLED';

const current = (guildId) => db.guild(guildId).security.lockdown ?? null;

function memberRole(guild, id = null) {
  const roleId = id ?? db.roleId(guild.id, 'member') ?? db.guild(guild.id).settings.verifyRoleId;
  return roleId ? guild.roles.cache.get(roleId) ?? null : null;
}

/** { SendMessages: value, … } for every permission in `bits`. */
const flags = (bits, value) => Object.fromEntries(new PermissionsBitField(bits).toArray().map((name) => [name, value]));

const auditReason = (member, what) => `${config.brand.name}: ${what} by ${member.user?.tag ?? member.user?.username ?? member.id}`.slice(0, 512);

/** Staff roles that would go quiet: no Send Messages of their own (they rely on the Member role). */
function quietStaffRoles(guild) {
  return [...new Set(STAFF_KEYS.map((key) => db.roleId(guild.id, key)).filter(Boolean))]
    .map((id) => guild.roles.cache.get(id))
    .filter((role) => role && !role.permissions.has(PermissionFlagsBits.Administrator) && !role.permissions.has(PermissionFlagsBits.SendMessages));
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
      'Chat, reactions, threads and voice are paused for members for a moment.\n' +
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
      'Everything is back to normal – chat, reactions and voice are open again. Thank you for your patience 💜',
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
async function lock(guild, by, reason = null) {
  const security = db.guild(guild.id).security;
  const active = security.lockdown;
  if (active) throw new UserError(`The server is already locked – since ${ts(active.at, 'R')} by <@${active.by}>. Use \`/unlock\` to lift it.`);
  const role = memberRole(guild);
  if (!role) throw new UserError('There is no Member role to lock – run `/build` first.');
  if (!role.editable) throw new UserError(`I can't edit ${role} – drag my role above it in **Server Settings → Roles** and try again.`);

  const why = auditReason(by, 'lockdown');
  const before = role.permissions.bitfield;
  const lockdown = { by: by.id, at: Date.now(), reason: reason || null, roleId: role.id, memberPermissions: String(before), channels: [], invitesPaused: false, invitesAlreadyPaused: false };
  security.lockdown = lockdown; // saved first – if anything fails halfway, /unlock still knows what to give back
  db.save();
  try {
    await role.setPermissions(before & ~LOCK_BITS, why);
  } catch (err) {
    delete security.lockdown;
    db.save();
    throw err;
  }

  // Channels where the Member role is allowed these permissions directly (e.g. reactions in read-only channels)
  for (const channel of guild.channels.cache.values()) {
    const allowed = (channel.permissionOverwrites?.cache?.get(role.id)?.allow.bitfield ?? 0n) & LOCK_BITS;
    if (!allowed) continue;
    try {
      await channel.permissionOverwrites.edit(role.id, flags(allowed, null), { reason: why });
      lockdown.channels.push({ id: channel.id, allow: String(allowed) });
      db.save();
    } catch (err) {
      console.warn(`[lockdown] #${channel.name}:`, err.message);
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
    `**Invites:** ${{ paused: 'paused', already: 'were already paused', failed: "couldn't be paused", open: 'stay open' }[invites]}`,
  ]);
  return { role, channels: lockdown.channels.length, invites, notice, quiet: quietStaffRoles(guild) };
}

/** Lifts the lockdown: gives back exactly what lock() took. */
async function unlock(guild, by) {
  const security = db.guild(guild.id).security;
  const lockdown = security.lockdown;
  if (!lockdown) throw new UserError("The server isn't locked – there's nothing to unlock.");
  const role = memberRole(guild, lockdown.roleId) ?? memberRole(guild);
  if (role && !role.editable) throw new UserError(`I can't edit ${role} – drag my role above it in **Server Settings → Roles** and try again.`);

  const why = auditReason(by, 'end of lockdown');
  let channels = 0;
  if (role) {
    // Only the locked permissions are given back – other changes made during the lockdown stay.
    const taken = BigInt(lockdown.memberPermissions) & LOCK_BITS;
    await role.setPermissions((role.permissions.bitfield & ~LOCK_BITS) | taken, why);
    for (const { id, allow } of lockdown.channels ?? []) {
      const channel = guild.channels.cache.get(id);
      if (!channel) continue;
      try {
        await channel.permissionOverwrites.edit(role.id, flags(BigInt(allow), true), { reason: why });
        channels += 1;
      } catch (err) {
        console.warn(`[lockdown] #${channel.name}:`, err.message);
      }
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
  return { role, channels, invites, notice, lockdown };
}

// ───────────── Replies ─────────────

const where = (notice) => (notice ? `in <#${notice.channelId ?? notice.channel?.id}>` : null);

function lockReply(guild, result, reason) {
  const lines = [`✅ ${result.role} can't send messages, react, create threads or use voice anymore.`];
  if (result.channels) lines.push(`✅ Also paused in **${result.channels}** ${result.channels === 1 ? 'channel' : 'channels'} that allowed it for members.`);
  lines.push(
    {
      paused: '✅ Invites are paused – nobody new can join.',
      already: 'ℹ️ Invites were already paused – they stay paused after `/unlock` too.',
      failed: "⚠️ I couldn't pause invites (I need **Manage Server**) – pause them in **Server Settings → Invites**.",
      open: 'ℹ️ Invites stay open (`security.lockdownPausesInvites` is off).',
    }[result.invites],
  );
  lines.push(result.notice ? `✅ Notice posted ${where(result.notice)}.` : '⚠️ There is no #announcements or #chat channel – no notice was posted.');
  lines.push(
    result.quiet.length
      ? `⚠️ ${result.quiet.map((r) => `${r}`).join(', ')} ${result.quiet.length === 1 ? 'has' : 'have'} no **Send Messages** of ${result.quiet.length === 1 ? 'its' : 'their'} own – they can't talk until \`/unlock\`.`
      : '✅ Staff roles keep their own permissions – the team can still talk.',
  );
  const out = embed(COLORS.warning).setTitle('🔒 Server locked').setDescription(`${lines.join('\n')}\n\nUse \`/unlock\` to lift the lockdown.`);
  if (reason) out.addFields({ name: 'Reason', value: truncate(reason, 1024) });
  return out;
}

function unlockReply(guild, result) {
  const lines = [result.role ? `✅ ${result.role} has its permissions back.` : '⚠️ The Member role no longer exists – nothing to give back.'];
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

module.exports = { LOCKED, LOCK_BITS, current, lock, unlock, lockReply, unlockReply, lockedCard, unlockedCard };
