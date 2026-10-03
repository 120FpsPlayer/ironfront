'use strict';

const {
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  GuildDefaultMessageNotifications,
  GuildSystemChannelFlags,
  Locale,
  OverwriteType,
  PermissionFlagsBits,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const panels = require('../lib/panels');
const { COLORS, banner, hasBanner, ASSETS } = require('../lib/theme');
const { embed } = require('../lib/utils');
const { SUPPORT_KEYS } = require('../lib/permissions');
const { STAFF_PERMISSIONS, GROUPS, toBits, profile } = require('./permissions');
const { syncEmojis, describeEmojiResult } = require('./emojis');
const stats = require('../features/stats');
// Live panels the build posts – loading these modules registers their renderers.
require('../tickets/tickets');
require('../features/shop');
require('../features/vouches');
const path = require('node:path');

const fs = require('node:fs');
const { ROLES, CATEGORIES, WELCOME_SCREEN } = require('./layout');
const { postsFor } = require('./content');
const style = require('./style');

/** assets/brand/logo-<name>.png (eclipse-nox, eclipse, eclipse-wordmark, night, neon) – falls back to eclipse-nox. */
function logoPath(name) {
  const file = path.join(ASSETS, 'brand', `logo-${String(name || 'eclipse-nox').replace(/[^a-z-]/gi, '')}.png`);
  return fs.existsSync(file) ? file : path.join(ASSETS, 'brand', 'logo-eclipse-nox.png');
}

class BuildAborted extends Error {
  constructor() {
    super('The build was stopped.');
    this.name = 'BuildAborted';
  }
}

const API_ERRORS = {
  10003: 'the channel no longer exists',
  10011: 'the role no longer exists',
  30005: 'the server has reached the 250 role limit',
  30013: 'the server has reached the 500 channel limit',
  50001: 'the bot has no access',
  50013: 'the bot is missing permissions',
  50024: 'not possible on this channel type',
  50035: 'invalid data',
  50074: 'the channel is required by Community mode',
  50101: 'the server does not meet the requirements',
};

const LOCALES = Object.values(Locale);
const LOCALE_ALIASES = { en: 'en-US', es: 'es-ES', sv: 'sv-SE', pt: 'pt-BR', zh: 'zh-CN', nb: 'no', nn: 'no' };

/** Discord only accepts its own locale list ("pl", not "pl-PL"). Returns the closest one, or null. */
function discordLocale(value) {
  const wanted = String(value ?? '').trim().replace('_', '-').toLowerCase();
  if (!wanted) return 'en-US';
  const exact = LOCALES.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split('-')[0];
  return LOCALE_ALIASES[base] ?? LOCALES.find((l) => l.toLowerCase() === base) ?? null;
}

function describeError(err) {
  if (!err) return 'unknown error';
  const known = API_ERRORS[err.code];
  if (known && err.code === 50035) {
    const detail = String(err.message || '').split('\n').slice(1, 3).join(' ').trim();
    return detail ? `${known} (${detail.slice(0, 160)})` : known;
  }
  return known ?? String(err.message || err).slice(0, 200);
}

/** Later entries win (e.g. a channel profile overrides its category). */
function mergeOverwrites(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const entry of list || []) {
      const cur = map.get(entry.target) || { target: entry.target, allow: new Set(), deny: new Set() };
      for (const p of entry.allow || []) {
        cur.allow.add(p);
        cur.deny.delete(p);
      }
      for (const p of entry.deny || []) {
        cur.deny.add(p);
        cur.allow.delete(p);
      }
      map.set(entry.target, cur);
    }
  }
  return [...map.values()].map((x) => ({ target: x.target, allow: [...x.allow], deny: [...x.deny] })).filter((x) => x.allow.length || x.deny.length);
}

/** Profiles that decide visibility themselves (they don't inherit the category). */
const OWN_VISIBILITY = new Set(['verify', 'rules', 'stats', 'staff', 'admins', 'logs', 'staffLogs', 'vip', 'hidden']);

function channelOverwrites(cat, ch) {
  const own = profile(ch.profile, { posters: ch.posters });
  if (OWN_VISIBILITY.has(ch.profile)) return own;
  return mergeOverwrites(profile(cat.profile), own);
}

const SCAM_KEYWORDS = [
  '*free nitro*', '*nitro giveaway*', '*discord-nitro*', '*nitro-gift*', '*discordgift*', '*dlscord*', '*discorcl*', '*dicsord*',
  '*steamcommunlty*', '*steamcomrnunity*', '*free steam gift*', '*i accidentally reported you*', '*accidentally reported your account*',
  '*claim your nitro*', '*airdrop claim*',
];
const INVITE_REGEX = '(?i)(discord\\.(gg|io|me|li)|discord(app)?\\.com/invite|dsc\\.gg)/[a-z0-9-]+';

function automodRules(alertChannelId, exemptRoleIds, partnerRoleId) {
  const block = { type: AutoModerationActionType.BlockMessage, metadata: { customMessage: 'Blocked by NØX AutoMod. Please read the rules.' } };
  const alert = alertChannelId ? [{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: alertChannelId } }] : [];
  const msg = (extra = []) => [block, ...alert, ...extra];
  const exemptRoles = exemptRoleIds.slice(0, 20);
  const base = { eventType: AutoModerationRuleEventType.MessageSend, enabled: true, exemptRoles };
  return [
    { ...base, name: 'NØX · Spam filter', triggerType: AutoModerationRuleTriggerType.Spam, actions: msg() },
    {
      ...base,
      name: 'NØX · Mention spam & raids',
      triggerType: AutoModerationRuleTriggerType.MentionSpam,
      triggerMetadata: { mentionTotalLimit: 5, mentionRaidProtectionEnabled: true },
      actions: msg([{ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 600 } }]),
    },
    {
      ...base,
      name: 'NØX · Slurs & sexual content',
      triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      triggerMetadata: { presets: [AutoModerationRuleKeywordPresetType.Slurs, AutoModerationRuleKeywordPresetType.SexualContent] },
      actions: msg(),
    },
    {
      ...base,
      name: 'NØX · Scam links',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { keywordFilter: SCAM_KEYWORDS },
      actions: msg([{ type: AutoModerationActionType.Timeout, metadata: { durationSeconds: 3600 } }]),
    },
    {
      ...base,
      name: 'NØX · Discord invites',
      triggerType: AutoModerationRuleTriggerType.Keyword,
      triggerMetadata: { regexPatterns: [INVITE_REGEX] },
      actions: msg(),
      exemptRoles: [...new Set([...exemptRoles, partnerRoleId].filter(Boolean))].slice(0, 20),
    },
    {
      name: 'NØX · Scam names & profiles',
      eventType: AutoModerationRuleEventType.MemberUpdate,
      triggerType: AutoModerationRuleTriggerType.MemberProfile,
      triggerMetadata: { keywordFilter: SCAM_KEYWORDS },
      actions: [{ type: AutoModerationActionType.BlockMemberInteraction }, ...alert],
      exemptRoles,
      enabled: true,
    },
  ];
}

const SINGLE_TRIGGERS = new Set([
  AutoModerationRuleTriggerType.Spam,
  AutoModerationRuleTriggerType.KeywordPreset,
  AutoModerationRuleTriggerType.MentionSpam,
  AutoModerationRuleTriggerType.MemberProfile,
]);

/** Options for creating one layout role. */
function roleOptions(role, { roleIcons = false, reason } = {}) {
  return {
    name: roleIcons && role.icon ? role.name.replace(/^\S+\s+/, '') : role.name,
    colors: { primaryColor: role.color || 0 },
    hoist: Boolean(role.hoist),
    mentionable: false,
    permissions: toBits(STAFF_PERMISSIONS[role.perms] ?? []),
    reason,
  };
}

async function createRole(guild, role, { roleIcons, reason }) {
  const base = roleOptions(role, { roleIcons, reason });
  if (roleIcons && role.icon) {
    try {
      return await guild.roles.create({ ...base, unicodeEmoji: role.icon });
    } catch {
      // the icon is only decoration – create the role without it
    }
  }
  return guild.roles.create(base);
}

/** Turns layout overwrites ('@everyone', role keys) into Discord overwrites with real IDs. */
function overwriteResolver(guild, roleIds) {
  const boosterRoleId = guild.roles.premiumSubscriberRole?.id ?? null;
  return (list) =>
    list
      .map((o) => {
        let id = null;
        if (o.target === '@everyone') id = guild.id;
        else if (o.target === '@booster') id = boosterRoleId;
        else id = roleIds[o.target];
        if (!id) return null;
        return { id, type: OverwriteType.Role, allow: toBits(o.allow), deny: toBits(o.deny) };
      })
      .filter(Boolean);
}

/** Options for creating (or re-syncing) one layout channel. */
function channelOptions(cat, ch, { parentId, resolve, communityOn, reason }) {
  let type = ch.kind === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
  const convert = ch.kind === 'announcement' && !communityOn;
  if (ch.kind === 'announcement' && communityOn) type = ChannelType.GuildAnnouncement;
  const opts = { name: style.channelName(ch.name), type, parent: parentId, permissionOverwrites: resolve(channelOverwrites(cat, ch)), reason };
  if (type !== ChannelType.GuildVoice) {
    if (ch.topic) opts.topic = ch.topic;
    if (ch.slowmode && type === ChannelType.GuildText) opts.rateLimitPerUser = ch.slowmode;
  } else if (ch.userLimit) {
    opts.userLimit = ch.userLimit;
  }
  return { opts, convert };
}

/** Can @everyone (people who haven't verified yet) read this layout channel? */
function everyoneCanRead(channelKey) {
  for (const cat of CATEGORIES) {
    const ch = cat.channels.find((c) => c.key === channelKey);
    if (!ch) continue;
    if (ch.kind === 'voice') return false;
    const everyone = channelOverwrites(cat, ch).find((o) => o.target === '@everyone');
    return Boolean(everyone && everyone.allow.includes('ViewChannel') && everyone.allow.includes('ReadMessageHistory'));
  }
  return false;
}

/** Number of progress steps (for the progress bar). */
function plannedSteps() {
  const channels = CATEGORIES.reduce((n, c) => n + c.channels.length, 0);
  const posts = CATEGORIES.flatMap((c) => c.channels).filter((c) => c.post).length;
  return ROLES.length + CATEGORIES.length + channels + posts + 12;
}

/**
 * Builds the whole NØX server.
 * @param {object} p
 * @param {import('discord.js').Guild} p.guild
 * @param {'add'|'wipe'} p.mode
 * @param {string} p.invokerId
 * @param {string[]} [p.keepChannelIds]   channels a wipe must not delete (where /build was used)
 * @param {(state) => void} [p.onProgress]
 * @param {() => boolean} [p.shouldAbort]
 */
async function buildServer({ guild, mode = 'add', invokerId, keepChannelIds = [], onProgress = () => {}, shouldAbort = () => false }) {
  const started = Date.now();
  const reason = `${config.brand.name} /build by ${invokerId}`;
  const wipe = mode === 'wipe';
  const S = config.server;
  const R = {
    roles: {},
    channels: {},
    categories: {},
    created: { roles: 0, categories: 0, channels: 0, messages: 0, automod: 0, emojis: 0 },
    deleted: { channels: 0, roles: 0, automod: 0 },
    posts: {},
    warnings: [],
    errors: [],
    phases: [],
    aborted: false,
    community: false,
    emojiSummary: null,
  };

  let done = 0;
  let total = plannedSteps();
  let phase = 'Preparing';
  let label = '';
  const emit = () => onProgress({ done, total, phase, label, phases: R.phases.slice(), elapsed: Date.now() - started });
  const tick = (t) => {
    done += 1;
    if (t) label = t;
    emit();
  };
  const startPhase = (name) => {
    if (phase !== 'Preparing') R.phases.push(phase);
    phase = name;
    label = '';
    emit();
  };
  const checkAbort = () => {
    if (shouldAbort()) throw new BuildAborted();
  };
  const attempt = async (what, fn, { warn = false } = {}) => {
    checkAbort();
    try {
      return await fn();
    } catch (err) {
      if (err instanceof BuildAborted) throw err;
      const message = `${what}: ${describeError(err)}`;
      (warn ? R.warnings : R.errors).push(message);
      console.warn(`[build] ${message}`);
      if (R.errors.length > 40) throw new Error('Too many errors in a row – the build was stopped. Check the bot permissions.');
      return null;
    }
  };
  const saveBuild = (extra = {}) => {
    const prev = db.build(guild.id) ?? {};
    db.setBuild(guild.id, { ...prev, roles: { ...R.roles }, channels: { ...R.channels }, categories: { ...R.categories }, ...extra });
  };

  try {
    emit();
    await guild.fetch();
    await guild.channels.fetch();
    await guild.roles.fetch();
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.Administrator)) {
      throw new Error('The bot needs the Administrator permission to build the server.');
    }
    let communityOn = guild.features.includes('COMMUNITY');

    // ───────────── Wipe ─────────────
    const deferredDeletes = [];
    if (wipe) {
      startPhase('Cleaning the server');
      const keep = new Set(keepChannelIds.filter(Boolean));
      const rules = await guild.autoModerationRules.fetch().catch(() => null);
      for (const rule of rules?.values() ?? []) {
        const ok = await attempt(`Deleting AutoMod rule "${rule.name}"`, () => rule.delete(reason), { warn: true });
        if (ok !== null) R.deleted.automod += 1;
      }
      const channels = [...guild.channels.cache.values()].filter((c) => !c.isThread?.() && !keep.has(c.id));
      total += channels.length;
      const ordered = [...channels.filter((c) => c.type !== ChannelType.GuildCategory), ...channels.filter((c) => c.type === ChannelType.GuildCategory)];
      for (const channel of ordered) {
        checkAbort();
        try {
          await channel.delete(reason);
          R.deleted.channels += 1;
        } catch (err) {
          if (err.code === 50074) deferredDeletes.push(channel);
          else if (err.code !== 10003) R.warnings.push(`Could not delete #${channel.name}: ${describeError(err)}`);
        }
        tick(`Deleted #${channel.name}`);
      }
      const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed && r.editable);
      for (const role of roles) {
        const ok = await attempt(`Deleting role "${role.name}"`, () => role.delete(reason), { warn: true });
        if (ok !== null) R.deleted.roles += 1;
      }
      const skipped = guild.roles.cache.filter((r) => r.id !== guild.id && !r.managed && !r.editable).size;
      if (skipped) R.warnings.push(`${skipped} roles above the bot's role were kept – move the bot's role to the top to remove them too.`);
      // Old panels and build data point to deleted channels.
      const g = db.guild(guild.id);
      g.panels = [];
      g.build = null;
      db.save();
    }

    // ───────────── Roles ─────────────
    startPhase('Creating roles');
    const roleIcons = S.rolesWithIcons !== false && guild.features.includes('ROLE_ICONS');
    for (const role of ROLES) {
      const created = await attempt(`Role "${role.name}"`, () => createRole(guild, role, { roleIcons, reason }));
      if (created) {
        R.roles[role.key] = created.id;
        R.created.roles += 1;
      }
      tick(`Role ${role.name}`);
    }
    await attempt('Role order', () => ensureRoleOrder(guild, ROLES.map((r) => R.roles[r.key]).filter(Boolean)), { warn: true });
    // Gated server: @everyone gets nothing – the Member role (from verification) unlocks everything.
    await attempt('@everyone permissions', () => guild.roles.everyone.setPermissions(0n, reason));
    saveBuild({ at: Date.now(), by: invokerId, mode, version: 1 });

    // ───────────── Emojis ─────────────
    if (config.emojis.upload !== false) {
      startPhase('Uploading emojis');
      const res = await attempt('Emojis', () => syncEmojis(guild, { reason, onProgress: (n) => { label = `:${n}:`; emit(); }, shouldAbort }), { warn: true });
      if (res) {
        R.created.emojis = res.uploaded;
        R.emojiSummary = describeEmojiResult(res);
        if (res.missing.length) R.warnings.push(`Emojis: ${R.emojiSummary}`);
      }
      tick('Emojis');
    }

    // ───────────── Categories & channels ─────────────
    startPhase('Creating channels');
    const resolve = overwriteResolver(guild, R.roles);

    const toConvert = [];
    for (const cat of CATEGORIES) {
      const categoryName = style.categoryName(cat.name);
      const category = await attempt(`Category ${categoryName}`, () =>
        guild.channels.create({ name: categoryName, type: ChannelType.GuildCategory, permissionOverwrites: resolve(profile(cat.profile)), reason }),
      );
      tick(`Category ${categoryName}`);
      if (!category) continue;
      R.categories[cat.key] = category.id;
      R.created.categories += 1;

      for (const ch of cat.channels) {
        const { opts, convert } = channelOptions(cat, ch, { parentId: category.id, resolve, communityOn, reason });
        if (convert) toConvert.push(ch.key);
        const channel = await attempt(`Channel ${opts.name}`, () => guild.channels.create(opts));
        if (channel) {
          R.channels[ch.key] = channel.id;
          R.created.channels += 1;
        }
        tick(`#${opts.name}`);
      }
    }
    saveBuild();

    // ───────────── Server settings ─────────────
    startPhase('Server settings');
    const id = (key) => R.channels[key];
    const settings = {
      verificationLevel: Math.max(0, Math.min(4, Number(S.verificationLevel ?? 2))),
      explicitContentFilter: Math.max(0, Math.min(2, Number(S.explicitContentFilter ?? 2))),
      defaultMessageNotifications: GuildDefaultMessageNotifications.OnlyMentions,
      systemChannelFlags:
        GuildSystemChannelFlags.SuppressJoinNotifications |
        GuildSystemChannelFlags.SuppressGuildReminderNotifications |
        GuildSystemChannelFlags.SuppressJoinNotificationReplies,
      premiumProgressBarEnabled: true,
      reason,
    };
    if (communityOn) {
      settings.verificationLevel = Math.max(1, settings.verificationLevel);
      settings.explicitContentFilter = 2;
    }
    if (S.rename !== false) settings.name = config.brand.name;
    if (id('boosters')) settings.systemChannel = id('boosters');
    if (id('afk')) {
      settings.afkChannel = id('afk');
      settings.afkTimeout = [60, 300, 900, 1800, 3600].includes(S.afkTimeoutSeconds) ? S.afkTimeoutSeconds : 900;
    }
    await attempt('Server settings', () => guild.edit(settings));
    if (S.setIcon !== false) {
      await attempt('Server icon', () => guild.setIcon(logoPath(S.logo), reason), { warn: true });
    }
    if (S.setBanner !== false && guild.features.includes('BANNER')) {
      await attempt('Server banner', () => guild.setBanner(path.join(ASSETS, 'brand', 'server-banner.png'), reason), { warn: true });
    }
    tick('Name, icon and security');

    // ───────────── Community mode ─────────────
    if (S.community !== false) {
      startPhase('Community mode');
      if (id('rules') && id('discordUpdates')) {
        const payload = { rulesChannel: id('rules'), publicUpdatesChannel: id('discordUpdates'), reason };
        if (!communityOn) {
          payload.features = [...new Set([...guild.features, 'COMMUNITY'])];
          payload.verificationLevel = Math.max(1, settings.verificationLevel);
          payload.explicitContentFilter = 2;
        }
        const res = await attempt('Enabling Community mode', () => guild.edit(payload), { warn: true });
        if (res) communityOn = Boolean(res.features?.includes('COMMUNITY')) || guild.features.includes('COMMUNITY');
        if (communityOn) {
          await attempt(
            'Server description',
            () => guild.edit({ description: (config.brand.tagline ?? '').slice(0, 120) || null, safetyAlertsChannel: id('discordUpdates'), reason }),
            { warn: true },
          );
          // Separate edit: a bad language value must not block the description.
          const locale = discordLocale(S.locale) ?? 'en-US';
          if (S.locale && locale !== S.locale) {
            R.warnings.push(`Server language "${S.locale}" is not a Discord language – used "${locale}" instead.`);
          }
          await attempt('Server language', () => guild.edit({ preferredLocale: locale, reason }), { warn: true });
          for (const key of toConvert) {
            const channel = guild.channels.cache.get(R.channels[key]);
            if (channel) await attempt(`Announcement channel #${channel.name}`, () => channel.setType(ChannelType.GuildAnnouncement, reason), { warn: true });
          }
          // Discord only accepts welcome channels everyone can read (before verification).
          const readable = WELCOME_SCREEN.filter((w) => id(w.channel) && everyoneCanRead(w.channel));
          const skipped = WELCOME_SCREEN.filter((w) => id(w.channel) && !everyoneCanRead(w.channel));
          if (skipped.length) {
            R.warnings.push(`Welcome screen: skipped ${skipped.map((w) => `#${w.channel}`).join(', ')} – only channels everyone can read before verifying are allowed.`);
          }
          if (readable.length) {
            const welcomeChannels = readable.map((w) => ({ channel: id(w.channel), description: w.description.slice(0, 42), emoji: w.emoji }));
            await attempt('Welcome screen', () => guild.editWelcomeScreen({ enabled: true, description: (config.brand.tagline ?? '').slice(0, 140), welcomeChannels }), { warn: true });
          }
        } else {
          R.warnings.push('Community mode could not be enabled – announcement channels were created as read-only text channels.');
        }
      }
      tick('Community mode');
    }
    R.community = communityOn;

    // ───────────── Tickets & invite ─────────────
    db.updateSettings(guild.id, {
      categoryId: R.categories.catTickets ?? null,
      closedCategoryId: R.categories.catClosed ?? null,
      logChannelId: id('ticketLogs') ?? null,
      transcriptChannelId: id('transcripts') ?? null,
      staffRoleIds: SUPPORT_KEYS.map((k) => R.roles[k]).filter(Boolean),
      verifyRoleId: R.roles.member ?? null,
    });
    let invite = null;
    if (S.createInvite !== false && id('rules')) {
      const inv = await attempt('Invite link', () => guild.invites.create(id('rules'), { maxAge: 0, maxUses: 0, unique: false, reason }), { warn: true });
      invite = inv?.url ?? null;
    }
    saveBuild({ invite });
    tick('Ticket system');

    // ───────────── Messages & panels ─────────────
    startPhase('Posting banners & panels');
    for (const cat of CATEGORIES) {
      for (const ch of cat.channels) {
        if (!ch.post || !R.channels[ch.key]) continue;
        const channel = guild.channels.cache.get(R.channels[ch.key]);
        if (!channel) continue;
        const sent = await attempt(`Messages in #${channel.name}`, () => publish(channel, ch.post));
        if (sent) {
          R.created.messages += sent.length;
          R.posts[ch.key] = sent;
        }
        tick(`#${channel.name}`);
      }
    }
    saveBuild({ posts: { ...R.posts } });

    // ───────────── AutoMod ─────────────
    startPhase('AutoMod');
    // Fetched again after a wipe too – rules the wipe could not delete still count against the limits.
    const existing = [...((await guild.autoModerationRules.fetch().catch(() => null))?.values() ?? [])];
    const exempt = [...GROUPS.staff, 'bots'].map((k) => R.roles[k]).filter(Boolean);
    let keywordRules = existing.filter((r) => r.triggerType === AutoModerationRuleTriggerType.Keyword).length;
    for (const rule of automodRules(id('automodLogs'), exempt, R.roles.partner)) {
      if (SINGLE_TRIGGERS.has(rule.triggerType) && existing.some((r) => r.triggerType === rule.triggerType)) {
        R.warnings.push(`AutoMod "${rule.name}" skipped – the server already has a rule of this type.`);
        continue;
      }
      if (rule.triggerType === AutoModerationRuleTriggerType.Keyword) {
        if (keywordRules >= 6) {
          R.warnings.push(`AutoMod "${rule.name}" skipped – Discord allows 6 keyword rules.`);
          continue;
        }
        keywordRules += 1;
      }
      const created = await attempt(`AutoMod "${rule.name}"`, () => guild.autoModerationRules.create({ ...rule, reason }), { warn: true });
      if (created) R.created.automod += 1;
    }
    tick('AutoMod');

    // ───────────── Roles for people ─────────────
    startPhase('Giving roles');
    const memberRole = R.roles.member;
    const ownerRoles = [R.roles.founder, memberRole].filter(Boolean);
    if (ownerRoles.length) await attempt('Owner roles', async () => (await guild.members.fetch(guild.ownerId)).roles.add(ownerRoles, reason), { warn: true });
    if (invokerId && invokerId !== guild.ownerId && memberRole) {
      await attempt('Your roles', async () => (await guild.members.fetch(invokerId)).roles.add(memberRole, reason), { warn: true });
    }
    if (R.roles.bots) await attempt('Bot role', () => me.roles.add(R.roles.bots, reason), { warn: true });
    // Existing members shouldn't be locked out: they get the Member role right away (small servers).
    if (memberRole) {
      const members = await guild.members.fetch().catch(() => null);
      const humans = members ? [...members.values()].filter((m) => !m.user.bot && !m.roles.cache.has(memberRole) && m.id !== guild.ownerId && m.id !== invokerId) : [];
      if (humans.length > 250) {
        R.warnings.push(`${humans.length} existing members did not get the Member role automatically – they can verify in #verify.`);
      } else {
        for (const m of humans) await attempt(`Member role for ${m.user.username}`, () => m.roles.add(memberRole, reason), { warn: true });
      }
    }
    tick('Roles given');

    // Channels Community mode protected during the wipe can go now.
    for (const channel of deferredDeletes) {
      await attempt(`Deleting #${channel.name}`, async () => {
        await channel.delete(reason);
        R.deleted.channels += 1;
      }, { warn: true });
    }

    await stats.updateStatChannels(guild.client).catch(() => null);
    saveBuild({ finishedAt: Date.now(), community: communityOn });

    // Report for the team
    if (id('staffChat')) {
      const report = embed(COLORS.brand)
        .setTitle(`🏗️ ${config.brand.name} was built`)
        .setDescription(`Built by <@${invokerId}> in ${Math.round((Date.now() - started) / 1000)}s.`)
        .addFields(
          { name: 'Created', value: `🎭 ${R.created.roles} roles\n📁 ${R.created.categories} categories\n💬 ${R.created.channels} channels\n📨 ${R.created.messages} messages\n🤖 ${R.created.automod} AutoMod rules\n😀 ${R.created.emojis} emojis`, inline: true },
          { name: 'Notes', value: String(R.warnings.length + R.errors.length), inline: true },
        );
      await attempt('Build report', () => guild.channels.cache.get(id('staffChat'))?.send({ embeds: [report] }), { warn: true });
    }
    tick('Done');
    R.phases.push(phase);
  } catch (err) {
    if (err instanceof BuildAborted) {
      R.aborted = true;
      R.warnings.push('The build was stopped – everything created so far stays on the server.');
    } else {
      R.fatal = describeError(err);
      console.error('[build] Fatal error:', err);
    }
  }
  R.duration = Date.now() - started;
  R.done = done;
  R.total = total;
  return R;
}

/**
 * Sends the banner(s), cards and live panels for one channel. Returns what was posted, so
 * /build only:panels can later edit exactly these messages in place: [{ type: 'banner'|'card'|'panel', id, banner?, kind? }]
 */
async function publish(channel, postKey) {
  const posted = [];
  for (const item of postsFor(postKey, channel.guild)) {
    posted.push(await sendItem(channel, item));
  }
  return posted.filter(Boolean);
}

/** Sends one content item and describes it. */
async function sendItem(channel, item) {
  if (item.banner) {
    if (!hasBanner(item.banner)) return null;
    const msg = await channel.send({ files: [banner(item.banner)] });
    return { type: 'banner', id: msg.id, banner: item.banner };
  }
  if (item.panel) {
    const msg = await panels.send(channel, item.panel, item.extra ?? {});
    return { type: 'panel', id: msg.id, kind: item.panel };
  }
  const msg = await channel.send(item.payload);
  return { type: 'card', id: msg.id };
}

async function ensureRoleOrder(guild, ids) {
  const fresh = await guild.roles.fetch();
  const roles = ids.map((rid) => fresh.get(rid) ?? guild.roles.cache.get(rid)).filter(Boolean);
  const sorted = roles.every((r, i) => i === 0 || roles[i - 1].position > r.position);
  if (sorted || roles.length < 2) return true;
  const base = Math.min(...roles.map((r) => r.position));
  await guild.roles.setPositions(roles.map((role, i) => ({ role: role.id, position: base + (roles.length - 1 - i) })));
  return true;
}

module.exports = { buildServer, publish, sendItem, describeError, discordLocale, BuildAborted, mergeOverwrites, channelOverwrites, everyoneCanRead, automodRules, plannedSteps, logoPath, createRole, overwriteResolver, channelOptions, ensureRoleOrder };
