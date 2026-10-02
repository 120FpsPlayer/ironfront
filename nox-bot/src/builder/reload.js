'use strict';

const path = require('node:path');
const { ChannelType } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const panels = require('../lib/panels');
const { ASSETS, banner, hasBanner } = require('../lib/theme');
const { SUPPORT_KEYS } = require('../lib/permissions');
const { profile } = require('./permissions');
const { sendItem, channelOptions, overwriteResolver, createRole, ensureRoleOrder, describeError, logoPath } = require('./executor');
const { syncEmojis, describeEmojiResult } = require('./emojis');

/**
 * /reload – makes the running server match the files again, without restarting the bot:
 *   1. re-reads config.json, src/builder/layout.js and src/builder/content.js
 *   2. re-applies the server name and logo
 *   3. recreates missing roles / categories / channels and resets channel names, topics and permissions
 *   4. uploads missing emojis
 *   5. edits every banner, card and panel /build posted IN PLACE (vouches, giveaways,
 *      announcements and other messages in those channels are never touched)
 */

const layout = () => require('./layout');
const content = () => require('./content');
const SCRIPTS = ['./layout', './content'].map((m) => require.resolve(m));

class ReloadError extends Error {}

/** "src/builder/content.js:123" from an error stack, if the error comes from one of our files. */
function where(err) {
  const match = String(err?.stack ?? '').match(/([^\s()]*src[\\/][^\s():]+\.js):(\d+)/);
  return match ? `${path.relative(path.join(__dirname, '..', '..'), match[1])}:${match[2]}` : null;
}

/** Re-reads config.json and the layout/content scripts. If one is broken, the old version stays active. */
function reloadFiles() {
  try {
    config.reload();
  } catch (err) {
    throw new ReloadError(`config.json has an error – nothing was changed.\n${err.message}`);
  }
  const backup = SCRIPTS.map((file) => require.cache[file]);
  try {
    for (const file of SCRIPTS) delete require.cache[file];
    for (const file of SCRIPTS) require(file);
  } catch (err) {
    SCRIPTS.forEach((file, i) => {
      if (backup[i]) require.cache[file] = backup[i];
      else delete require.cache[file];
    });
    const at = where(err);
    throw new ReloadError(`A script has an error${at ? ` in **${at}**` : ''} – the old version is still active.\n${String(err.message).split('\n')[0]}`);
  }
  return ['config.json', 'layout.js', 'content.js'];
}

async function applyBranding(guild, reason) {
  const S = config.server;
  const done = [];
  if (S.rename !== false && guild.name !== config.brand.name) {
    await guild.edit({ name: config.brand.name, reason });
    done.push('name');
  }
  if (S.setIcon !== false) {
    await guild.setIcon(logoPath(S.logo), reason);
    done.push('logo');
  }
  if (S.setBanner !== false && guild.features.includes('BANNER')) {
    await guild.setBanner(path.join(ASSETS, 'brand', 'server-banner.png'), reason);
    done.push('banner');
  }
  return done;
}

/** Recreates what's missing and resets channel settings to the layout. */
async function syncStructure(guild, reason) {
  const { ROLES, CATEGORIES } = layout();
  const build = db.build(guild.id);
  const roles = { ...(build.roles ?? {}) };
  const channels = { ...(build.channels ?? {}) };
  const categories = { ...(build.categories ?? {}) };
  const res = { rolesCreated: 0, categoriesCreated: 0, channelsCreated: 0, channelsChecked: 0, errors: [] };
  const attempt = async (what, fn) => {
    try {
      return await fn();
    } catch (err) {
      res.errors.push(`${what}: ${describeError(err)}`);
      return null;
    }
  };

  await guild.roles.fetch();
  await guild.channels.fetch();

  const roleIcons = config.server.rolesWithIcons !== false && guild.features.includes('ROLE_ICONS');
  for (const role of ROLES) {
    if (roles[role.key] && guild.roles.cache.has(roles[role.key])) continue;
    const created = await attempt(`Role ${role.name}`, () => createRole(guild, role, { roleIcons, reason }));
    if (created) {
      roles[role.key] = created.id;
      res.rolesCreated += 1;
    }
  }
  if (res.rolesCreated) await attempt('Role order', () => ensureRoleOrder(guild, ROLES.map((r) => roles[r.key]).filter(Boolean)));

  const resolve = overwriteResolver(guild, roles);
  const communityOn = guild.features.includes('COMMUNITY');
  const reorder = new Set();
  for (const cat of CATEGORIES) {
    let category = guild.channels.cache.get(categories[cat.key] ?? '');
    if (!category) {
      category = await attempt(`Category ${cat.name}`, () =>
        guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: resolve(profile(cat.profile)), reason }),
      );
      if (!category) continue;
      categories[cat.key] = category.id;
      res.categoriesCreated += 1;
    } else {
      const edit = { permissionOverwrites: resolve(profile(cat.profile)), reason };
      if (category.name !== cat.name) edit.name = cat.name;
      await attempt(`Category ${cat.name}`, () => category.edit(edit));
    }

    for (const ch of cat.channels) {
      const { opts } = channelOptions(cat, ch, { parentId: category.id, resolve, communityOn, reason });
      const channel = guild.channels.cache.get(channels[ch.key] ?? '');
      if (!channel) {
        const created = await attempt(`Channel ${ch.name}`, () => guild.channels.create(opts));
        if (created) {
          channels[ch.key] = created.id;
          res.channelsCreated += 1;
          reorder.add(cat);
        }
        continue;
      }
      const edit = { permissionOverwrites: opts.permissionOverwrites, lockPermissions: false, reason };
      // Stat channels rename themselves ("👥 Members: 123"), so their name is left alone.
      if (ch.profile !== 'stats' && channel.name !== ch.name) edit.name = ch.name;
      if (channel.parentId !== category.id) edit.parent = category.id;
      if (opts.topic !== undefined && (channel.topic ?? '') !== opts.topic) edit.topic = opts.topic;
      if (opts.rateLimitPerUser !== undefined && channel.rateLimitPerUser !== opts.rateLimitPerUser) edit.rateLimitPerUser = opts.rateLimitPerUser;
      if (opts.userLimit !== undefined && channel.userLimit !== opts.userLimit) edit.userLimit = opts.userLimit;
      if (await attempt(`Channel ${ch.name}`, () => channel.edit(edit))) res.channelsChecked += 1;
    }
  }

  // Recreated channels go back to their place in the layout.
  for (const cat of reorder) {
    const positions = cat.channels
      .map((ch) => channels[ch.key])
      .filter((id) => guild.channels.cache.has(id))
      .map((channel, position) => ({ channel, position }));
    await attempt(`Channel order in ${cat.name}`, () => guild.channels.setPositions(positions));
  }
  if (res.categoriesCreated) {
    const positions = CATEGORIES.map((c) => categories[c.key]).filter((id) => guild.channels.cache.has(id)).map((channel, position) => ({ channel, position }));
    await attempt('Category order', () => guild.channels.setPositions(positions));
  }

  db.setBuild(guild.id, { ...db.build(guild.id), roles, channels, categories });
  db.updateSettings(guild.id, {
    categoryId: categories.catTickets ?? null,
    closedCategoryId: categories.catClosed ?? null,
    logChannelId: channels.ticketLogs ?? null,
    transcriptChannelId: channels.transcripts ?? null,
    staffRoleIds: SUPPORT_KEYS.map((k) => roles[k]).filter(Boolean),
    verifyRoleId: roles.member ?? null,
  });

  // Server settings that point at channels (in case one of them was recreated).
  const settings = {};
  if (channels.boosters && guild.systemChannelId !== channels.boosters) settings.systemChannel = channels.boosters;
  if (channels.afk && guild.afkChannelId !== channels.afk) settings.afkChannel = channels.afk;
  if (communityOn && channels.rules && guild.rulesChannelId !== channels.rules) settings.rulesChannel = channels.rules;
  if (communityOn && channels.discordUpdates && guild.publicUpdatesChannelId !== channels.discordUpdates) settings.publicUpdatesChannel = channels.discordUpdates;
  if (Object.keys(settings).length) await attempt('Server settings', () => guild.edit({ ...settings, reason }));
  return res;
}

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
  const items = content().postsFor(postKey, guild).filter((item) => !item.banner || hasBanner(item.banner));
  const entries = tracked?.length ? tracked : await guessLegacyPosts(channel, items.length);
  const used = new Set();
  const out = [];

  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    const type = item.banner ? 'banner' : item.panel ? 'panel' : 'card';
    const entry = entries[i];
    const msg = entry && entry.type === type && !used.has(entry.id) ? await channel.messages.fetch(entry.id).catch(() => null) : null;

    if (!msg) {
      // The message is gone (deleted by someone, or the content got longer) – send it again.
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
      const current = entry.banner ?? item.banner;
      if (current !== item.banner) {
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
      const payload = await panels.render(item.panel, guild, panel);
      delete payload.files;
      await msg.edit(payload);
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

/** Updates every banner, card and panel /build posted. Also used by /build only:panels. */
async function refreshContent(guild) {
  const build = db.build(guild.id);
  if (!build) throw new ReloadError('This server was not built yet – run /build first.');
  const { CATEGORIES } = layout();
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

/**
 * Runs the whole reload. onStep(name) is called before each step (for a progress message).
 * Returns { steps: [{ name, ok, detail }], aborted }.
 */
async function reloadAll(guild, { invokerId, onStep = () => {} } = {}) {
  const reason = `${config.brand.name} /reload by ${invokerId}`;
  const steps = [];
  const run = async (name, fn) => {
    await onStep(name, steps);
    try {
      const detail = await fn();
      steps.push({ name, ok: true, detail });
      return true;
    } catch (err) {
      steps.push({ name, ok: false, detail: err instanceof ReloadError ? err.message : describeError(err) });
      return false;
    }
  };

  if (!db.build(guild.id)) {
    steps.push({ name: 'Server', ok: false, detail: 'This server was not built yet – run /build first.' });
    return { steps, aborted: true };
  }
  const filesOk = await run('Files', () => `${reloadFiles().join(', ')} reloaded`);
  if (!filesOk) return { steps, aborted: true };

  await run('Branding', async () => {
    const done = await applyBranding(guild, reason);
    return done.length ? `${done.join(' + ')} applied` : 'nothing to change';
  });
  await run('Roles & channels', async () => {
    const r = await syncStructure(guild, reason);
    const parts = [];
    if (r.rolesCreated) parts.push(`${r.rolesCreated} roles recreated`);
    if (r.categoriesCreated) parts.push(`${r.categoriesCreated} categories recreated`);
    if (r.channelsCreated) parts.push(`${r.channelsCreated} channels recreated`);
    parts.push(`${r.channelsChecked} channels reset to the layout (names, topics, permissions)`);
    if (r.errors.length) parts.push(`⚠️ ${r.errors.slice(0, 4).join(' · ')}`);
    return parts.join(' · ');
  });
  if (config.emojis.upload !== false) {
    await run('Emojis', async () => describeEmojiResult(await syncEmojis(guild, { reason })));
  }
  await run('Messages', async () => {
    const r = await refreshContent(guild);
    const parts = [`${r.edited} updated in place in ${r.channels} channels`];
    if (r.sent) parts.push(`${r.sent} re-sent`);
    if (r.removed) parts.push(`${r.removed} old removed`);
    if (r.errors.length) parts.push(`⚠️ ${r.errors.slice(0, 4).join(' · ')}`);
    return parts.join(' · ');
  });
  return { steps, aborted: false };
}

module.exports = { reloadAll, reloadFiles, applyBranding, syncStructure, refreshContent, syncPosts, ReloadError };
