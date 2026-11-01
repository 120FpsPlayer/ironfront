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
const { UserError, embed, logEmbed, ts, duration, truncate, sendToChannel, plural, count } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
const { container, text, header, v2 } = require('../lib/v2');

const LOCKED = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'AddReactions', 'Connect', 'Speak'];
const LOCK_BITS = toBits(LOCKED);
const INVITES_DISABLED = 'INVITES_DISABLED';
const LABELS = {
  SendMessages: 'Wysyłanie wiadomości',
  SendMessagesInThreads: 'Wysyłanie wiadomości w wątkach',
  CreatePublicThreads: 'Tworzenie wątków publicznych',
  CreatePrivateThreads: 'Tworzenie wątków prywatnych',
  AddReactions: 'Dodawanie reakcji',
  Connect: 'Łączenie',
  Speak: 'Mówienie',
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

const auditReason = (member, what) => `${config.brand.name}: ${what} – ${member.user?.tag ?? member.user?.username ?? member.id}`.slice(0, 512);

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

const roleList = (roles, max = 15) => `${roles.slice(0, max).map((r) => `${r}`).join(', ')}${roles.length > max ? ` i jeszcze ${roles.length - max}` : ''}`;
/** "**Wysyłanie wiadomości**, **Dodawanie reakcji** i **Łączenie**" – the locked permissions in `bits`. */
function allowed(bits) {
  const names = new PermissionsBitField(bits & LOCK_BITS).toArray().map((name) => `**${LABELS[name] ?? name}**`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} i ${names.at(-1)}` : names.join('');
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
    `## ${e(guild, 'lock_locked')} Serwer jest zablokowany\n` +
      `Właśnie zajmujemy się pewnym problemem${lockdown.reason ? `: **${truncate(lockdown.reason, 200)}**` : ''}. ` +
      'Czat, reakcje, wątki i kanały głosowe są na chwilę wstrzymane dla członków – podobnie jak nowe tickety, zamówienia i opinie.\n' +
      `> ${e(guild, 'ticket')} Twoje otwarte tickety nadal działają – zespół wciąż może Ci w nich pomóc.`,
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`-# Zablokowano ${ts(lockdown.at, 'R')} · napiszemy tutaj, gdy tylko wszystko wróci do normy 🧡`));
  return v2(c);
}

function unlockedCard(guild, lockdown, now = Date.now()) {
  const c = container(COLORS.success);
  header(
    c,
    `## ${e(guild, 'lock_unlocked')} Serwer jest odblokowany\n` +
      'Wszystko wróciło do normy – czat, reakcje, kanały głosowe, tickety, zamówienia i opinie znów działają. Dziękujemy za cierpliwość 🧡',
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`-# Odblokowano ${ts(now, 'R')} · blokada trwała ${duration(now - lockdown.at)}`));
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
  if (active) throw new UserError(`Serwer jest już zablokowany – blokadę założono ${ts(active.at, 'R')} (<@${active.by}>). Użyj \`${slash('unlock')}\`, żeby ją zdjąć.`);
  const role = memberRole(guild);
  if (!role) throw new UserError(`Nie ma roli Członek do zablokowania – najpierw użyj \`${slash('build')}\`.`);
  if (!role.editable) throw new UserError(`Nie mogę edytować roli ${role} – przeciągnij moją rolę nad nią w **Ustawienia serwera → Role** i spróbuj ponownie.`);

  const why = auditReason(by, 'blokada serwera');
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
        console.warn(`[lockdown] ${guild.name}: nie udało się wstrzymać zaproszeń –`, err.message);
      }
    }
    db.save();
  }

  const notice = await postNotice(guild, lockedCard(guild, lockdown));
  await log(guild, '🔒 Serwer zablokowany', COLORS.warning, [
    `**Kto:** <@${by.id}>`,
    `**Powód:** ${lockdown.reason ? truncate(lockdown.reason, 500) : '—'}`,
    `**Zablokowane role:** ${roleList([role, ...roles])}`,
    ...(gaps.length ? [`**Nie da się zablokować:** ${roleList(gaps)}`] : []),
    `**Zaproszenia:** ${{ paused: 'wstrzymane', already: 'były już wstrzymane', failed: 'nie udało się ich wstrzymać', open: 'pozostają otwarte' }[invites]}`,
  ]);
  return { role, roles, gaps, kept, quiet, channels: new Set(lockdown.channels.map((c) => c.id)).size, invites, notice };
}

/** Lifts the lockdown: gives back exactly what lock() took. */
const unlock = (guild, by) => serial(guild.id, () => applyUnlock(guild, by));

async function applyUnlock(guild, by) {
  const security = db.guild(guild.id).security;
  const lockdown = security.lockdown;
  if (!lockdown) throw new UserError('Serwer nie jest zablokowany – nie ma czego odblokowywać.');
  const role = memberRole(guild, lockdown.roleId) ?? memberRole(guild);
  if (role && !role.editable) throw new UserError(`Nie mogę edytować roli ${role} – przeciągnij moją rolę nad nią w **Ustawienia serwera → Role** i spróbuj ponownie.`);

  const why = auditReason(by, 'koniec blokady serwera');
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
      console.warn(`[lockdown] ${guild.name}: nie udało się wznowić zaproszeń –`, err.message);
    }
  }
  delete security.lockdown;
  db.save();

  const now = Date.now();
  const notice = await postNotice(guild, unlockedCard(guild, lockdown, now));
  await log(guild, '🔓 Serwer odblokowany', COLORS.success, [`**Kto:** <@${by.id}>`, `**Blokada trwała:** ${duration(now - lockdown.at)} (założona przez <@${lockdown.by}>)`]);
  return { role, roles, failed, channels, invites, notice, lockdown };
}

// ───────────── Replies ─────────────

const where = (notice) => (notice ? `na <#${notice.channelId ?? notice.channel?.id}>` : null);

function lockReply(guild, result, reason) {
  const { roles = [], gaps = [], kept = [], quiet = [] } = result;
  const one = (list, a, b) => (list.length === 1 ? a : b);
  const lines = [
    gaps.length
      ? `⚠️ ${result.role} nie może już wysyłać wiadomości, reagować, tworzyć wątków ani korzystać z kanałów głosowych – ale członkowie z poniższymi rolami nadal mogą:`
      : `✅ ${result.role} nie może już wysyłać wiadomości, reagować, tworzyć wątków ani korzystać z kanałów głosowych.`,
  ];
  for (const gap of gaps.slice(0, 10)) {
    lines.push(`⚠️ ${gap} nadal daje: ${allowed(gap.permissions.bitfield)} – nie mogę jej edytować (jest nad moją rolą albo zarządza nią integracja). Odbierz te uprawnienia w **Ustawienia serwera → Role**.`);
  }
  if (gaps.length > 10) lines.push(`⚠️ … i jeszcze ${count(gaps.length - 10, 'taka rola', 'takie role', 'takich ról')}.`);
  if (roles.length) lines.push(`✅ Zablokowano też: ${roleList(roles)} – ${one(roles, 'ta rola też pozwalała', 'te role też pozwalały')} pisać.`);
  if (result.channels) lines.push(`✅ Wstrzymano też na **${result.channels}** ${plural(result.channels, 'kanale', 'kanałach', 'kanałach')}, które na to pozwalały członkom.`);
  lines.push('✅ Nowe tickety, zamówienia i opinie są wstrzymane dla członków – otwarte tickety nadal działają.');
  lines.push(
    {
      paused: '✅ Zaproszenia są wstrzymane – nikt nowy nie może dołączyć.',
      already: `ℹ️ Zaproszenia były już wstrzymane – po \`${slash('unlock')}\` też takie zostaną.`,
      failed: '⚠️ Nie udało mi się wstrzymać zaproszeń (potrzebuję uprawnienia **Zarządzanie serwerem**) – wstrzymaj je w **Ustawienia serwera → Zaproszenia**.',
      open: 'ℹ️ Zaproszenia pozostają otwarte (`security.lockdownPausesInvites` jest wyłączone).',
    }[result.invites],
  );
  lines.push(result.notice ? `✅ Komunikat opublikowany ${where(result.notice)}.` : '⚠️ Nie ma kanału #ogłoszenia ani #czat – komunikat nie został opublikowany.');
  if (kept.length) {
    lines.push(
      `✅ ${roleList(kept)} ${one(kept, 'nie miała', 'nie miały')} własnego uprawnienia **Wysyłanie wiadomości** – ${one(kept, 'dostaje', 'dostają')} je do \`${slash('unlock')}\`, ` +
        `żeby ${one(kept, 'jej', 'ich')} członkowie nadal mogli pisać.`,
    );
  }
  if (quiet.length) {
    lines.push(
      `⚠️ ${roleList(quiet)} ${one(quiet, 'nie ma', 'nie mają')} własnego uprawnienia **Wysyłanie wiadomości**, a nie mogę ${one(quiet, 'jej', 'ich')} edytować – ` +
        `${one(quiet, 'jej', 'ich')} członkowie nie mogą pisać do \`${slash('unlock')}\`. Przeciągnij moją rolę nad ${one(quiet, 'nią', 'nie')} albo daj ${one(quiet, 'jej', 'im')} uprawnienie **Wysyłanie wiadomości**.`,
    );
  } else if (!kept.length) {
    lines.push('✅ Role zespołu zachowują własne uprawnienia – zespół nadal może pisać.');
  }
  const out = embed(COLORS.warning).setTitle('🔒 Serwer zablokowany').setDescription(`${lines.join('\n')}\n\nUżyj \`${slash('unlock')}\`, żeby zdjąć blokadę.`);
  if (reason) out.addFields({ name: 'Powód', value: truncate(reason, 1024) });
  return out;
}

function unlockReply(guild, result) {
  const { roles = [], failed = [] } = result;
  const lines = [result.role ? `✅ ${result.role} ma z powrotem swoje uprawnienia.` : '⚠️ Rola Członek już nie istnieje – nie ma czego oddać.'];
  if (roles.length) lines.push(`✅ Tak samo: ${roleList(roles)}.`);
  if (failed.length) lines.push(`⚠️ Nie udało mi się przywrócić: ${roleList(failed)} – sprawdź ${failed.length === 1 ? 'jej' : 'ich'} uprawnienia w **Ustawienia serwera → Role**.`);
  if (result.channels) lines.push(`✅ Przywrócono **${result.channels}** ${plural(result.channels, 'uprawnienie na kanale', 'uprawnienia na kanałach', 'uprawnień na kanałach')}.`);
  const invites = {
    resumed: '✅ Zaproszenia znów są otwarte.',
    'still paused': 'ℹ️ Zaproszenia były wstrzymane już przed blokadą, więc takie zostają.',
    failed: '⚠️ Nie udało mi się wznowić zaproszeń – włącz je z powrotem w **Ustawienia serwera → Zaproszenia**.',
  }[result.invites];
  if (invites) lines.push(invites);
  lines.push(result.notice ? `✅ Komunikat opublikowany ${where(result.notice)}.` : '⚠️ Nie ma kanału #ogłoszenia ani #czat – komunikat nie został opublikowany.');
  lines.push(`-# Blokada trwała ${duration(Date.now() - result.lockdown.at)} · założona przez <@${result.lockdown.by}>`);
  return embed(COLORS.success).setTitle('🔓 Serwer odblokowany').setDescription(lines.join('\n'));
}

hooks.on('ready', (client) => {
  for (const guild of client.guilds.cache.values()) {
    const lockdown = current(guild.id);
    if (lockdown) console.log(`🔒 Serwer ${guild.name} jest nadal zablokowany (od ${new Date(lockdown.at).toISOString()}) – ${slash('unlock')} zdejmie blokadę.`);
  }
});

module.exports = { LOCKED, LOCK_BITS, current, pausedFor, lock, unlock, lockReply, unlockReply, lockedCard, unlockedCard };
