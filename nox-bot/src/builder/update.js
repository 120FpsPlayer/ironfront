'use strict';

/**
 * /build only:update – brings an already-built server up to date after a bot update:
 * creates the roles, categories and channels that were added to layout.js since the server was built
 * (with their permissions, banners and cards), then applies the name style and updates every panel.
 * Nothing that exists is deleted or re-created.
 */

const { ChannelType, OverwriteType } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { ROLES, CATEGORIES } = require('./layout');
const { profile } = require('./permissions');
const style = require('./style');
const { createRole, overwriteResolver, channelOptions, channelOverwrites, channelWanted, ensureRoleOrder, publish, describeError } = require('./executor');

/**
 * @returns {Promise<{ roles: string[], categories: string[], channels: string[], messages: number, errors: string[] }>}
 *   the names of everything that was created
 */
async function addMissing(guild, { reason = `${config.brand.name} update` } = {}) {
  const build = db.build(guild.id);
  if (!build) throw new Error('This server has not been built yet.');
  const res = { roles: [], categories: [], channels: [], messages: 0, errors: [] };
  const roles = { ...build.roles };
  const categories = { ...build.categories };
  const channels = { ...build.channels };
  const posts = { ...build.posts };
  const save = () => db.setBuild(guild.id, { ...db.build(guild.id), roles: { ...roles }, categories: { ...categories }, channels: { ...channels }, posts: { ...posts } });
  const attempt = async (what, fn) => {
    try {
      return await fn();
    } catch (err) {
      res.errors.push(`${what}: ${describeError(err)}`);
      return null;
    }
  };

  // Roles
  const roleIcons = config.server.rolesWithIcons !== false && guild.features.includes('ROLE_ICONS');
  const newRoles = new Set();
  for (const role of ROLES) {
    if (roles[role.key] && guild.roles.cache.has(roles[role.key])) continue;
    const created = await attempt(`Role "${role.name}"`, () => createRole(guild, role, { roleIcons, reason }));
    if (created) {
      roles[role.key] = created.id;
      newRoles.add(role.key);
      res.roles.push(created.name);
    }
  }
  if (newRoles.size) {
    save();
    await attempt('Role order', () => ensureRoleOrder(guild, ROLES.map((r) => roles[r.key]).filter(Boolean)));
    // Existing channels give the new roles the same access a fresh build would.
    for (const cat of CATEGORIES) {
      const targets = [[categories[cat.key], profile(cat.profile)], ...cat.channels.map((ch) => [channels[ch.key], channelOverwrites(cat, ch)])];
      for (const [id, list] of targets) {
        const channel = guild.channels.cache.get(id);
        if (!channel) continue;
        for (const o of list.filter((x) => newRoles.has(x.target))) {
          const perms = Object.fromEntries([...o.allow.map((p) => [p, true]), ...o.deny.map((p) => [p, false])]);
          await attempt(`Permissions in ${channel.name}`, () => channel.permissionOverwrites.edit(roles[o.target], perms, { type: OverwriteType.Role, reason }));
        }
      }
    }
  }

  // Categories and channels
  const resolve = overwriteResolver(guild, roles);
  const communityOn = guild.features.includes('COMMUNITY');
  for (const cat of CATEGORIES) {
    if (!categories[cat.key] || !guild.channels.cache.has(categories[cat.key])) {
      const name = style.categoryName(cat.name);
      const created = await attempt(`Category ${name}`, () =>
        guild.channels.create({ name, type: ChannelType.GuildCategory, permissionOverwrites: resolve(profile(cat.profile)), reason }),
      );
      if (!created) continue;
      categories[cat.key] = created.id;
      res.categories.push(name);
    }
    const added = [];
    for (const ch of cat.channels.filter(channelWanted)) {
      if (channels[ch.key] && guild.channels.cache.has(channels[ch.key])) continue;
      const { opts } = channelOptions(cat, ch, { parentId: categories[cat.key], resolve, communityOn, reason });
      const channel = await attempt(`Channel ${opts.name}`, () => guild.channels.create(opts));
      if (!channel) continue;
      channels[ch.key] = channel.id;
      res.channels.push(channel.name);
      added.push(ch.key);
      save();
      if (ch.post) {
        const sent = await attempt(`Messages in #${channel.name}`, () => publish(channel, ch.post));
        if (sent) {
          posts[ch.key] = sent;
          res.messages += sent.length;
        }
      }
    }
    // New channels are created at the bottom of their category – put them where layout.js has them.
    if (added.length) {
      const order = cat.channels.map((ch) => channels[ch.key]).filter((id) => guild.channels.cache.has(id));
      await attempt(`Channel order in ${style.categoryName(cat.name)}`, () =>
        guild.channels.setPositions(order.map((id, position) => ({ channel: id, position, parent: categories[cat.key] }))),
      );
    }
  }
  save();
  return res;
}

module.exports = { addMissing };
