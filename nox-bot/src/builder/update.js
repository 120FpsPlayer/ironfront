'use strict';

/**
 * /build only:update – brings an already-built server up to date after a bot update:
 * creates the roles, categories and channels that were added to layout.js since the server was built
 * (with their permissions, banners and cards), removes the ones the bot made that are no longer in
 * layout.js, then applies the name style and updates every panel.
 * Only things the bot created itself (remembered in its data) are ever removed – your own channels and
 * roles are never touched.
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

/**
 * Deletes the channels, categories and roles the bot created earlier that layout.js doesn't have any more
 * (e.g. the VIP lounge, voice channels, #memes) – or that a feature switched off in config.json hides.
 * @returns {Promise<{ channels: string[], categories: string[], roles: string[], errors: string[] }>}
 */
async function removeRetired(guild, { reason = `${config.brand.name} update`, keepChannelId = null } = {}) {
  const build = db.build(guild.id);
  if (!build) throw new Error('This server has not been built yet.');
  const res = { channels: [], categories: [], roles: [], errors: [] };
  const wantedChannels = new Set(CATEGORIES.flatMap((c) => c.channels.filter(channelWanted).map((ch) => ch.key)));
  const wantedCategories = new Set(CATEGORIES.map((c) => c.key));
  const wantedRoles = new Set(ROLES.map((r) => r.key));
  const channels = { ...build.channels };
  const categories = { ...build.categories };
  const roles = { ...build.roles };
  const posts = { ...build.posts };
  const forget = (store, key) => {
    delete store[key];
    delete posts[key];
  };

  // Channels first, then their categories (a category must be empty before Discord deletes it cleanly).
  for (const [list, wanted, names] of [
    [channels, wantedChannels, res.channels],
    [categories, wantedCategories, res.categories],
  ]) {
    for (const [key, id] of Object.entries(list)) {
      if (wanted.has(key)) continue;
      const channel = guild.channels.cache.get(id);
      if (!channel) {
        forget(list, key);
        continue;
      }
      if (channel.id === keepChannelId) {
        res.errors.push(`#${channel.name} was kept because you ran the update in it – run it in another channel to remove it.`);
        continue;
      }
      // A category with channels left in it (yours, or the one kept above) stays – deleting it would scatter them.
      if (channel.type === ChannelType.GuildCategory) {
        const left = guild.channels.cache.filter((c) => c.parentId === channel.id);
        if (left.size) {
          res.errors.push(`${channel.name} was kept because it still has ${left.map((c) => `#${c.name}`).join(', ')} – move or delete them and run the update again.`);
          continue;
        }
      }
      try {
        await channel.delete(reason);
        names.push(channel.name);
        forget(list, key);
      } catch (err) {
        if (err.code === 10003) forget(list, key);
        else res.errors.push(`Deleting ${channel.name}: ${describeError(err)}`);
      }
    }
  }
  for (const [key, id] of Object.entries(roles)) {
    if (wantedRoles.has(key)) continue;
    const role = guild.roles.cache.get(id);
    if (!role) {
      delete roles[key];
      continue;
    }
    if (!role.editable) {
      res.errors.push(`Role "${role.name}" is above the bot's role – remove it by hand.`);
      continue;
    }
    try {
      await role.delete(reason);
      res.roles.push(role.name);
      delete roles[key];
    } catch (err) {
      if (err.code === 10011) delete roles[key];
      else res.errors.push(`Deleting role "${role.name}": ${describeError(err)}`);
    }
  }
  db.setBuild(guild.id, { ...db.build(guild.id), channels, categories, roles, posts });
  return res;
}

module.exports = { addMissing, removeRetired };
