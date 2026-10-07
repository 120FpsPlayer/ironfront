'use strict';

/**
 * A fake Discord server that implements the parts of the discord.js API the bot uses.
 * It validates everything like Discord does (name lengths, component limits, Components V2
 * rules, overwrite targets, Community requirements, emoji slots, AutoMod constraints…) and
 * throws errors with real API codes, so the tests catch problems before they reach Discord.
 */

const fs = require('node:fs');
const { ChannelType, Collection, PermissionsBitField, OverwriteType, MessageFlags, RateLimitError, Locale } = require('discord.js');

let seq = 100000000000000000n;
const nextId = () => String(++seq);

function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

let RGI = null;
try {
  RGI = new RegExp('^\\p{RGI_Emoji}$', 'v');
} catch {
  RGI = null;
}

// The server a payload is being validated for (set by validateMessage / validateModal).
let validatingFor = null;

function assertEmoji(emoji, where) {
  if (!emoji) return;
  if (typeof emoji === 'object' && emoji.id) {
    if (!/^\d{17,20}$/.test(emoji.id)) throw apiError(50035, `${where}: invalid custom emoji id`);
    // Discord rejects deleted emojis and emojis that are unavailable (e.g. after losing boosts).
    const known = validatingFor?.emojis?.cache;
    if (known && (!known.has(emoji.id) || known.get(emoji.id).available === false)) {
      throw apiError(50035, `${where}.emoji.id[BUTTON_COMPONENT_INVALID_EMOJI]: Invalid emoji`);
    }
    return;
  }
  const name = typeof emoji === 'string' ? emoji : emoji.name;
  if (RGI && !RGI.test(name)) throw apiError(50035, `${where}.emoji[COMPONENT_INVALID_EMOJI]: ${JSON.stringify(name)}`);
}

/**
 * Discord stores text channel names lowercase with dashes instead of spaces, and drops emoji variation
 * selectors / joiners (🛡️ → 🛡). Voice channels and categories keep their names.
 */
const discordName = (name, type) =>
  [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(type) ? String(name).toLowerCase().replace(/\s+/g, '-').replace(/[\uFE0E\uFE0F\u200D]/g, '') : name;

const toJSON = (c) => (c && typeof c.toJSON === 'function' ? c.toJSON() : c);

// ───────────── Component validation ─────────────

function validateButton(b, where) {
  if (b.style === 5) {
    if (!b.url || !/^https?:\/\//.test(b.url)) throw apiError(50035, `${where}: link button needs a url`);
    if (b.custom_id) throw apiError(50035, `${where}: link button cannot have custom_id`);
  } else if (!b.custom_id || b.custom_id.length > 100) {
    throw apiError(50035, `${where}: invalid custom_id ${b.custom_id}`);
  }
  if (!b.label && !b.emoji) throw apiError(50035, `${where}: button needs label or emoji`);
  if (b.label && b.label.length > 80) throw apiError(50035, `${where}: button label > 80`);
  assertEmoji(b.emoji, where);
}

function validateSelect(s, where) {
  if (!s.custom_id || s.custom_id.length > 100) throw apiError(50035, `${where}: select custom_id`);
  if (s.placeholder && s.placeholder.length > 150) throw apiError(50035, `${where}: placeholder > 150`);
  if (s.type === 3) {
    if (!s.options?.length || s.options.length > 25) throw apiError(50035, `${where}: select needs 1-25 options (${s.options?.length})`);
    const values = new Set();
    for (const [i, o] of s.options.entries()) {
      if (!o.label || o.label.length > 100) throw apiError(50035, `${where}.options[${i}].label`);
      if (!o.value || o.value.length > 100) throw apiError(50035, `${where}.options[${i}].value`);
      if (o.description && o.description.length > 100) throw apiError(50035, `${where}.options[${i}].description > 100`);
      if (values.has(o.value)) throw apiError(50035, `${where}: duplicate option value ${o.value}`);
      values.add(o.value);
      assertEmoji(o.emoji, `${where}.options[${i}]`);
    }
  }
}

function validateActionRow(row, where) {
  const comps = row.components ?? [];
  if (!comps.length || comps.length > 5) throw apiError(50035, `${where}: action row needs 1-5 components`);
  const selects = comps.filter((c) => c.type !== 2);
  if (selects.length && comps.length > 1) throw apiError(50035, `${where}: a select must be alone in its row`);
  comps.forEach((c, i) => (c.type === 2 ? validateButton(c, `${where}[${i}]`) : validateSelect(c, `${where}[${i}]`)));
}

function mediaUrlOk(url, files) {
  if (!url) return false;
  if (url.startsWith('attachment://')) return files.has(url.slice('attachment://'.length));
  return /^https?:\/\//.test(url);
}

/** Validates a Components V2 message; returns { total, textLength }. */
function validateV2(components, files, where = 'components') {
  let total = 0;
  let textLength = 0;
  const walk = (c, path, depth) => {
    total += 1;
    switch (c.type) {
      case 1:
        total += (c.components ?? []).length;
        validateActionRow(c, path);
        break;
      case 9: {
        const texts = c.components ?? [];
        if (texts.length < 1 || texts.length > 3) throw apiError(50035, `${path}: section needs 1-3 text displays`);
        for (const t of texts) {
          total += 1;
          textLength += t.content.length;
        }
        if (!c.accessory) throw apiError(50035, `${path}: section needs an accessory`);
        total += 1;
        if (c.accessory.type === 2) validateButton(c.accessory, `${path}.accessory`);
        else if (c.accessory.type === 11) {
          if (!mediaUrlOk(c.accessory.media?.url, files)) throw apiError(50035, `${path}: invalid thumbnail url ${c.accessory.media?.url}`);
        } else throw apiError(50035, `${path}: invalid accessory type`);
        break;
      }
      case 10:
        if (!c.content) throw apiError(50035, `${path}: empty text display`);
        textLength += c.content.length;
        break;
      case 12:
        if (!c.items?.length || c.items.length > 10) throw apiError(50035, `${path}: gallery needs 1-10 items`);
        for (const item of c.items) if (!mediaUrlOk(item.media?.url, files)) throw apiError(50035, `${path}: invalid media url ${item.media?.url}`);
        break;
      case 13:
        // A file component only shows an uploaded file of this message (attachment://name).
        if (!c.file?.url?.startsWith('attachment://') || !mediaUrlOk(c.file.url, files)) throw apiError(50035, `${path}: invalid file url ${c.file?.url}`);
        break;
      case 14:
        break;
      case 17:
        if (depth > 0) throw apiError(50035, `${path}: containers cannot be nested`);
        if (!c.components?.length) throw apiError(50035, `${path}: empty container`);
        c.components.forEach((child, i) => {
          if (![1, 9, 10, 12, 13, 14].includes(child.type)) throw apiError(50035, `${path}[${i}]: type ${child.type} not allowed in a container`);
          walk(child, `${path}[${i}]`, depth + 1);
        });
        break;
      default:
        throw apiError(50035, `${path}: unknown component type ${c.type}`);
    }
  };
  components.map(toJSON).forEach((c, i) => walk(c, `${where}[${i}]`, 0));
  if (total > 40) throw apiError(50035, `${where}: ${total} components (limit 40)`);
  if (textLength > 4000) throw apiError(50035, `${where}: ${textLength} characters of text (limit 4000)`);
  return { total, textLength };
}

function embedLength(e) {
  const d = toJSON(e);
  let n = (d.title?.length || 0) + (d.description?.length || 0) + (d.footer?.text?.length || 0) + (d.author?.name?.length || 0);
  for (const f of d.fields || []) n += f.name.length + f.value.length;
  return { n, d };
}

function fileNames(body) {
  const names = new Map();
  for (const f of body.files ?? []) {
    const name = f.name ?? f.attachment?.split?.('/')?.pop();
    if (typeof f.attachment === 'string' && !fs.existsSync(f.attachment)) throw apiError(50035, `file not found: ${f.attachment}`);
    names.set(name, f);
  }
  return names;
}

/** Validates a message payload the way Discord would (pass the guild to also check custom emojis). */
function validateMessage(body, guild = null) {
  validatingFor = guild;
  try {
    return checkMessage(body);
  } finally {
    validatingFor = null;
  }
}

function checkMessage(body) {
  const files = fileNames(body);
  const v2 = ((body.flags ?? 0) & MessageFlags.IsComponentsV2) !== 0;
  if (v2) {
    if (body.content) throw apiError(50035, 'Components V2 messages cannot have content');
    if (body.embeds?.length) throw apiError(50035, 'Components V2 messages cannot have embeds');
    if (!body.components?.length) throw apiError(50035, 'Components V2 message without components');
    return validateV2(body.components, files);
  }
  const embeds = body.embeds || [];
  if (embeds.length > 10) throw apiError(50035, 'too many embeds');
  let total = 0;
  for (const e of embeds) {
    const { n, d } = embedLength(e);
    total += n;
    if ((d.title?.length || 0) > 256) throw apiError(50035, 'embed title > 256');
    if ((d.description?.length || 0) > 4096) throw apiError(50035, 'embed description > 4096');
    if ((d.fields || []).length > 25) throw apiError(50035, 'embed fields > 25');
    for (const f of d.fields || []) {
      if (!f.name || f.name.length > 256) throw apiError(50035, `field name invalid: ${f.name}`);
      if (!f.value || f.value.length > 1024) throw apiError(50035, `field value invalid (${f.value?.length})`);
    }
  }
  if (total > 6000) throw apiError(50035, `embeds total > 6000 (${total})`);
  const rows = (body.components || []).map(toJSON);
  if (rows.length > 5) throw apiError(50035, 'too many rows');
  rows.forEach((r, i) => validateActionRow(r, `components[${i}]`));
  if (!body.content && !embeds.length && !files.size && !rows.length) throw apiError(50006, 'Cannot send an empty message');
  return { total: rows.length, textLength: 0 };
}

function validateModal(modal, guild = null) {
  validatingFor = guild;
  try {
    return checkModal(modal);
  } finally {
    validatingFor = null;
  }
}

function checkModal(modal) {
  const json = toJSON(modal);
  if (!json.custom_id || json.custom_id.length > 100) throw new Error(`modal custom_id: ${json.custom_id}`);
  if (!json.title || json.title.length > 45) throw new Error(`modal title: ${json.title}`);
  if (json.components.length < 1 || json.components.length > 5) throw new Error(`modal needs 1-5 components (${json.components.length})`);
  for (const [i, c] of json.components.entries()) {
    if (c.type === 10) continue;
    if (c.type !== 18) throw new Error(`modal component ${i} must be a label or text display (got ${c.type})`);
    if (!c.label || c.label.length > 45) throw new Error(`label too long: ${c.label}`);
    if (c.description && c.description.length > 100) throw new Error('label description > 100');
    const inner = c.component;
    if (inner.type === 4) {
      if (inner.value && inner.max_length && inner.value.length > inner.max_length) throw new Error('prefilled value longer than max');
      if (inner.placeholder && inner.placeholder.length > 100) throw new Error('text input placeholder > 100');
      if (inner.min_length && inner.max_length && inner.min_length > inner.max_length) throw new Error('min > max');
    } else if (inner.type === 3) {
      validateSelect(inner, `modal[${i}]`);
    } else if (inner.type === 19) {
      // File upload: 0–10 files (min) and 1–10 (max).
      if (!inner.custom_id || inner.custom_id.length > 100) throw new Error(`file upload custom_id: ${inner.custom_id}`);
      const min = inner.min_values ?? 1;
      const max = inner.max_values ?? 1;
      if (min < 0 || min > 10 || max < 1 || max > 10 || min > max) throw new Error(`file upload min/max values ${min}/${max}`);
    } else {
      throw new Error(`unsupported modal component ${inner.type}`);
    }
  }
  return json;
}

// ───────────── Structures ─────────────

class FakeRole {
  constructor(guild, data) {
    this.guild = guild;
    this.id = data.id || nextId();
    this.name = data.name;
    this.color = data.colors?.primaryColor ?? 0;
    this.hoist = Boolean(data.hoist);
    this.mentionable = Boolean(data.mentionable);
    this.permissions = new PermissionsBitField(data.permissions ?? 0n);
    this.managed = Boolean(data.managed);
    this.position = data.position ?? 1;
    this.unicodeEmoji = data.unicodeEmoji ?? null;
  }

  get editable() {
    if (this.managed) return false;
    return this.guild.me.roles.highest.position > this.position;
  }

  toString() {
    return `<@&${this.id}>`;
  }

  async delete() {
    if (!this.editable) throw apiError(50013, 'Missing Permissions');
    this.guild.roles.cache.delete(this.id);
    for (const m of this.guild.members.cache.values()) m.roles.cache.delete(this.id);
    this.guild.log.push(['roleDelete', this.name]);
    return this;
  }

  async setPermissions(bits) {
    this.permissions = new PermissionsBitField(bits);
    return this;
  }
}

class FakeMessage {
  constructor(channel, body, authorId = 'bot') {
    this.id = nextId();
    this.channel = channel;
    this.channelId = channel.id;
    this.guild = channel.guild;
    this.body = body;
    this.flags = body.flags ?? 0;
    this.embeds = (body.embeds || []).map(toJSON);
    this.components = (body.components || []).map(toJSON);
    this.content = body.content ?? '';
    this.files = body.files ?? [];
    this.author =
      authorId === 'bot'
        ? channel.guild.me.user
        : channel.guild.members.cache.get(authorId)?.user ?? { id: authorId, bot: false, username: `user${authorId}`, tag: `user${authorId}`, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
    this.attachments = new Collection(this.files.map((f, i) => [String(i), { url: `https://cdn.discordapp.com/attachments/${channel.id}/${this.id}/${f.name}`, name: f.name, size: 1000, contentType: 'image/png' }]));
    this.pinned = false;
    this.deleted = false;
    this.createdAt = new Date();
    this.createdTimestamp = Date.now();
    this.mentions = { users: new Collection() };
    this.stickers = new Collection();
    this.reference = null;
    this.editedAt = null;
  }

  get url() {
    return `https://discord.com/channels/${this.guild.id}/${this.channel.id}/${this.id}`;
  }

  async edit(body) {
    if (this.deleted) throw apiError(10008, 'Unknown Message');
    const merged = { ...body };
    if (merged.files === undefined && this.files.length && !('attachments' in body)) merged.files = this.files;
    if (((this.flags & MessageFlags.IsComponentsV2) !== 0) && merged.flags === undefined) merged.flags = this.flags;
    if ((this.flags & MessageFlags.IsComponentsV2) !== 0 && ((merged.flags ?? 0) & MessageFlags.IsComponentsV2) === 0) {
      throw apiError(50035, 'cannot remove the Components V2 flag from a message');
    }
    validateMessage(merged, this.guild);
    this.body = merged;
    this.files = merged.files ?? [];
    this.attachments = new Collection(this.files.map((f, i) => [String(i), { url: `https://cdn.discordapp.com/attachments/${this.channel.id}/${this.id}/${f.name}`, name: f.name, size: 1000, contentType: 'image/png' }]));
    if (merged.components) this.components = merged.components.map(toJSON);
    if (merged.embeds) this.embeds = merged.embeds.map(toJSON);
    this.edits = (this.edits ?? 0) + 1;
    return this;
  }

  async delete() {
    this.deleted = true;
    this.channel.messageList = this.channel.messageList.filter((m) => m !== this);
    return this;
  }

  async pin() {
    this.pinned = true;
    return this;
  }

  async crosspost() {
    if (this.channel.type !== ChannelType.GuildAnnouncement) throw apiError(40033, 'not an announcement channel');
    this.crossposted = true;
    return this;
  }

  async startThread({ name }) {
    if (!name || name.length > 100) throw apiError(50035, 'thread name');
    return { name };
  }
}

class FakeChannel {
  constructor(guild, data) {
    this.guild = guild;
    this.client = guild.client;
    this.id = nextId();
    this.name = discordName(data.name, data.type ?? ChannelType.GuildText);
    this.type = data.type ?? ChannelType.GuildText;
    this.topic = data.topic ?? null;
    this.parentId = data.parent ?? null;
    this.rateLimitPerUser = data.rateLimitPerUser ?? 0;
    this.userLimit = data.userLimit ?? 0;
    this.position = guild.channels.cache.size;
    this.messageList = [];
    this.renames = 0;
    const channel = this;
    const list = (data.permissionOverwrites || []).map((o) => ({
      id: o.id,
      type: o.type ?? OverwriteType.Role,
      allow: new PermissionsBitField(Array.isArray(o.allow) ? o.allow : o.allow ?? 0n).bitfield,
      deny: new PermissionsBitField(Array.isArray(o.deny) ? o.deny : o.deny ?? 0n).bitfield,
    }));
    this.overwriteList = list;
    this.permissionOverwrites = {
      get cache() {
        return new Collection(list.map((o) => [o.id, { ...o, allow: new PermissionsBitField(o.allow), deny: new PermissionsBitField(o.deny) }]));
      },
      async edit(id, perms, options = {}) {
        // Like discord.js: without an explicit type, the ID must be a cached role or a cached user.
        if (typeof options.type !== 'number' && !guild.roles.cache.has(id) && !guild.isUserCached(id)) {
          const err = new TypeError('Supplied parameter is not a User nor a Role.');
          err.code = 'InvalidType';
          throw err;
        }
        let o = list.find((x) => x.id === id);
        if (!o) {
          o = { id, type: options.type ?? (guild.roles.cache.has(id) ? OverwriteType.Role : OverwriteType.Member), allow: 0n, deny: 0n };
          list.push(o);
        }
        for (const [name, value] of Object.entries(perms)) {
          const bit = PermissionsBitField.Flags[name];
          if (bit === undefined) throw apiError(50035, `unknown permission ${name}`);
          o.allow &= ~bit;
          o.deny &= ~bit;
          if (value === true) o.allow |= bit;
          if (value === false) o.deny |= bit;
        }
        return channel;
      },
      async delete(id) {
        const i = list.findIndex((x) => x.id === id);
        if (i !== -1) list.splice(i, 1);
        return channel;
      },
    };
    this.messages = {
      async fetch(arg) {
        if (typeof arg === 'string') {
          const m = channel.messageList.find((x) => x.id === arg);
          if (!m) throw apiError(10008, 'Unknown Message');
          return m;
        }
        const limit = arg?.limit ?? 50;
        if (arg?.after !== undefined) {
          // Discord returns the oldest messages after this ID.
          const after = BigInt(arg.after);
          const older = channel.messageList.filter((m) => BigInt(m.id) > after).slice(0, limit);
          return new Collection(older.reverse().map((m) => [m.id, m]));
        }
        let all = [...channel.messageList].reverse();
        if (arg?.before) {
          const idx = all.findIndex((m) => m.id === arg.before);
          all = idx === -1 ? [] : all.slice(idx + 1);
        }
        return new Collection(all.slice(0, limit).map((m) => [m.id, m]));
      },
    };
  }

  get parent() {
    return this.parentId ? this.guild.channels.cache.get(this.parentId) : null;
  }

  get url() {
    return `https://discord.com/channels/${this.guild.id}/${this.id}`;
  }

  isThread() {
    return false;
  }

  isTextBased() {
    return [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice].includes(this.type);
  }

  toString() {
    return `<#${this.id}>`;
  }

  async delete() {
    if (this.guild.protectedChannels.has(this.id)) throw apiError(50074, 'Cannot delete a channel required for Community Servers');
    this.guild.channels.cache.delete(this.id);
    this.guild.log.push(['channelDelete', this.name]);
    return this;
  }

  async send(body) {
    if (typeof body === 'string') body = { content: body };
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(this.type)) throw apiError(50008, 'Cannot send messages in a non-text channel');
    validateMessage(body, this.guild);
    const msg = new FakeMessage(this, body);
    this.messageList.push(msg);
    return msg;
  }

  /** A message from a user (for transcripts / tracking tests). */
  userMessage(authorId, content) {
    const msg = new FakeMessage(this, { content }, authorId);
    this.messageList.push(msg);
    return msg;
  }

  async setType(type) {
    if (type === ChannelType.GuildAnnouncement && !this.guild.features.includes('COMMUNITY')) throw apiError(50024, 'community required');
    this.type = type;
    return this;
  }

  async setName(name) {
    if (!name || name.length > 100) throw apiError(50035, 'channel name');
    this.assertRenameAllowed();
    this.renames += 1;
    this.name = discordName(name, this.type);
    return this;
  }

  /**
   * Discord: 2 renames per channel per 10 minutes. The 429 comes with a long retry_after while the
   * route bucket itself is fine – discord.js rejects it only if rejectOnRateLimit says so.
   */
  assertRenameAllowed() {
    const now = Date.now();
    this.renameTimes = (this.renameTimes ?? []).filter((t) => now - t < 10 * 60_000);
    if (this.renameTimes.length >= 2) {
      const retryAfter = 10 * 60_000 - (now - this.renameTimes[0]);
      const data = { timeToReset: 800, limit: 5, method: 'PATCH', hash: 'x', url: `/channels/${this.id}`, route: '/channels/:id', majorParameter: this.id, global: false, retryAfter, sublimitTimeout: retryAfter, scope: 'user' };
      const reject = this.guild.rejectOnRateLimit;
      if (typeof reject === 'function' ? reject(data) : true) throw new RateLimitError(data);
      throw apiError(0, `discord.js would silently wait ${Math.round(retryAfter / 1000)}s for this rename`);
    }
    this.renameTimes.push(now);
  }

  async setParent(id) {
    this.guild.assertCategoryRoom(id, this);
    this.parentId = id;
    return this;
  }

  async edit(data) {
    if (data.name !== undefined) {
      if (!data.name || data.name.length > 100) throw apiError(50035, 'channel name');
      if (data.name !== this.name) {
        this.assertRenameAllowed();
        this.renames += 1;
      }
      this.name = discordName(data.name, this.type);
    }
    if (data.parent !== undefined) {
      const parent = this.guild.channels.cache.get(data.parent);
      if (!parent || parent.type !== ChannelType.GuildCategory) throw apiError(50035, 'invalid parent');
      this.guild.assertCategoryRoom(data.parent, this);
      this.parentId = data.parent;
    }
    if (data.topic !== undefined) {
      if (data.topic.length > 1024) throw apiError(50035, 'topic too long');
      this.topic = data.topic;
    }
    if (data.rateLimitPerUser !== undefined) this.rateLimitPerUser = data.rateLimitPerUser;
    if (data.userLimit !== undefined) this.userLimit = data.userLimit;
    if (data.permissionOverwrites) {
      for (const o of data.permissionOverwrites) {
        const known = o.id === this.guild.id || this.guild.roles.cache.has(o.id) || this.guild.members.cache.has(o.id);
        if (!known) throw apiError(50035, `unknown overwrite target ${o.id}`);
      }
      this.overwriteList.splice(
        0,
        this.overwriteList.length,
        ...data.permissionOverwrites.map((o) => ({
          id: o.id,
          type: o.type ?? OverwriteType.Role,
          allow: new PermissionsBitField(o.allow ?? 0n).bitfield,
          deny: new PermissionsBitField(o.deny ?? 0n).bitfield,
        })),
      );
    }
    this.edits = (this.edits ?? 0) + 1;
    return this;
  }

  permissionsFor(member) {
    return member.permissionsIn(this);
  }
}

class FakeMember {
  constructor(guild, id, { roles = [], permissions = 0n, bot = false, createdTimestamp = Date.now() - 400 * 86_400_000 } = {}) {
    this.guild = guild;
    this.id = id;
    this.user = {
      id,
      bot,
      tag: `user${id}`,
      username: `user${id}`,
      globalName: null,
      createdTimestamp,
      createdAt: new Date(createdTimestamp),
      displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png',
      send: async (payload) => {
        // Members with closed DMs (guild.closedDms) can't be messaged; DMs follow the same message rules.
        if (guild.closedDms.has(id)) throw apiError(50007, 'Cannot send messages to this user');
        validateMessage(typeof payload === 'string' ? { content: payload } : payload, guild);
        guild.dms.push({ to: id, payload });
        return payload;
      },
      toString: () => `<@${id}>`,
    };
    this.displayName = `User ${id}`;
    this.joinedAt = new Date();
    this.joinedTimestamp = Date.now();
    this.basePermissions = new PermissionsBitField(permissions);
    const member = this;
    const cache = new Collection(roles.map((r) => [r, guild.roles.cache.get(r) || { id: r }]));
    cache.hasAny = (...ids) => ids.some((x) => cache.has(x));
    this.roles = {
      cache,
      get highest() {
        return [...cache.values()].reduce((a, b) => ((b.position ?? 0) > (a.position ?? 0) ? b : a), { position: 0 });
      },
      async add(roleOrIds) {
        for (const r of [].concat(roleOrIds)) {
          const rid = typeof r === 'string' ? r : r.id;
          const role = guild.roles.cache.get(rid);
          if (!role) throw apiError(10011, 'Unknown Role');
          if (!guild.me.roles.highest.position || role.position >= guild.me.roles.highest.position) throw apiError(50013, 'role above bot');
          cache.set(rid, role);
        }
        guild.log.push(['memberRoleAdd', member.id]);
        return member;
      },
      async remove(roleOrIds) {
        for (const r of [].concat(roleOrIds)) cache.delete(typeof r === 'string' ? r : r.id);
        return member;
      },
    };
  }

  get permissions() {
    let bits = this.basePermissions.bitfield | (this.guild.roles.everyone?.permissions.bitfield ?? 0n);
    for (const role of this.roles.cache.values()) bits |= role.permissions?.bitfield ?? 0n;
    if (bits & PermissionsBitField.Flags.Administrator) return new PermissionsBitField(PermissionsBitField.All);
    return new PermissionsBitField(bits);
  }

  /** Discord's permission algorithm: base → @everyone overwrite → role overwrites → member overwrite. */
  permissionsIn(channel) {
    let bits = this.permissions.bitfield;
    if (bits & PermissionsBitField.Flags.Administrator) return new PermissionsBitField(PermissionsBitField.All);
    const list = channel.overwriteList ?? [];
    const everyone = list.find((o) => o.id === this.guild.id);
    if (everyone) bits = (bits & ~everyone.deny) | everyone.allow;
    let allow = 0n;
    let deny = 0n;
    for (const o of list) {
      if (o.id !== this.guild.id && this.roles.cache.has(o.id)) {
        allow |= o.allow;
        deny |= o.deny;
      }
    }
    bits = (bits & ~deny) | allow;
    const own = list.find((o) => o.id === this.id);
    if (own) bits = (bits & ~own.deny) | own.allow;
    return new PermissionsBitField(bits);
  }

  displayAvatarURL() {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }

  toString() {
    return `<@${this.id}>`;
  }

  async send(payload) {
    return this.user.send(payload);
  }
}

class FakeGuild {
  constructor({ name = 'Test Guild', ownerId = '1', community = false, features = [], existingChannels = 3, existingRoles = 3, premiumTier = 0, emojiRateLimitAfter = Infinity, humans = 3 } = {}) {
    this.id = nextId();
    this.name = name;
    this.ownerId = ownerId;
    this.features = community ? ['COMMUNITY', ...features] : [...features];
    this.premiumTier = premiumTier;
    this.log = [];
    this.dms = [];
    this.closedDms = new Set();
    this.welcomeScreen = null;
    this.iconSet = null;
    this.bannerSet = null;
    this.settings = {};
    this.rejectOnRateLimit = require('../../src/lib/ratelimit').rejectOnRateLimit; // same predicate as the bot's client
    const guild = this;

    const users = new Map();
    this.client = {
      user: { id: 'bot', tag: 'NØX#0001', username: 'NØX', bot: true, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/1.png' },
      users: {
        async fetch(id) {
          return guild.members.cache.get(id)?.user ?? users.get(id) ?? { id, username: `user${id}`, tag: `user${id}`, createdAt: new Date(), displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png', send: async () => null };
        },
        cache: users,
      },
      guilds: { cache: new Collection() },
    };
    this.client.guilds.cache.set(this.id, this);

    this.roles = {
      cache: new Collection(),
      async fetch() {
        return this.cache;
      },
      get everyone() {
        return this.cache.get(guild.id);
      },
      premiumSubscriberRole: null,
      async create(data) {
        if (!data.name || data.name.length > 100) throw apiError(50035, `role name invalid: ${data.name}`);
        if (this.cache.size >= 250) throw apiError(30005, 'Maximum number of guild roles reached (250)');
        if (data.unicodeEmoji && !guild.features.includes('ROLE_ICONS')) throw apiError(50101, 'role icons require boosts');
        if (data.unicodeEmoji) assertEmoji(data.unicodeEmoji, 'unicode_emoji');
        if (typeof data.permissions !== 'bigint') throw apiError(50035, 'permissions must be bits');
        for (const r of this.cache.values()) if (r.id !== guild.id && !r.managed && r.position >= 1) r.position += 1;
        const role = new FakeRole(guild, { ...data, position: 1 });
        this.cache.set(role.id, role);
        guild.log.push(['roleCreate', role.name]);
        return role;
      },
      async setPositions(list) {
        for (const { role, position } of list) {
          const r = this.cache.get(role);
          if (r) r.position = position;
        }
        return guild;
      },
    };
    this.roles.cache.set(this.id, new FakeRole(this, { id: this.id, name: '@everyone', position: 0, permissions: PermissionsBitField.Flags.ViewChannel | PermissionsBitField.Flags.SendMessages }));
    const botRole = new FakeRole(this, { name: 'NØX', managed: true, position: 1000, permissions: PermissionsBitField.Flags.Administrator });
    this.roles.cache.set(botRole.id, botRole);
    for (let i = 0; i < existingRoles; i += 1) {
      const r = new FakeRole(this, { name: `Old role ${i}`, position: 2 + i });
      this.roles.cache.set(r.id, r);
    }
    this.me = new FakeMember(this, 'bot', { roles: [botRole.id], bot: true });
    this.me.user = this.client.user;

    this.channels = {
      cache: new Collection(),
      async fetch(id) {
        if (typeof id === 'string') {
          const c = this.cache.get(id);
          if (!c) throw apiError(10003, 'Unknown Channel');
          return c;
        }
        return this.cache;
      },
      async create(data) {
        if (!data.name || data.name.length > 100) throw apiError(50035, `channel name invalid: ${data.name}`);
        if (this.cache.size >= 500) throw apiError(30013, 'Maximum number of guild channels reached (500)');
        const community = guild.features.includes('COMMUNITY');
        if ([ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice].includes(data.type) && !community) throw apiError(50024, 'Community required');
        if (data.parent) {
          const parent = this.cache.get(data.parent);
          if (!parent || parent.type !== ChannelType.GuildCategory) throw apiError(50035, 'invalid parent');
          if (this.cache.filter((c) => c.parentId === data.parent).size >= 50) throw apiError(50035, 'Invalid Form Body\nparent_id[CHANNEL_PARENT_MAX_CHANNELS]: Maximum number of channels in category reached (50)');
        }
        if (data.type === ChannelType.GuildCategory && data.parent) throw apiError(50035, 'categories cannot have a parent');
        if (data.topic && data.topic.length > 1024) throw apiError(50035, 'topic too long');
        if ((data.rateLimitPerUser ?? 0) > 21600) throw apiError(50035, 'slowmode too long');
        if ((data.userLimit ?? 0) > 99) throw apiError(50035, 'user limit too high');
        if ((data.permissionOverwrites || []).length > 100) throw apiError(50035, 'too many overwrites');
        for (const o of data.permissionOverwrites || []) {
          const known = o.id === guild.id || guild.roles.cache.has(o.id) || guild.members.cache.has(o.id) || o.type === OverwriteType.Member;
          if (!known) throw apiError(50035, `unknown overwrite target ${o.id}`);
        }
        const channel = new FakeChannel(guild, data);
        this.cache.set(channel.id, channel);
        guild.log.push(['channelCreate', channel.name, data.type]);
        return channel;
      },
      async setPositions() {
        return guild;
      },
    };
    for (let i = 0; i < existingChannels; i += 1) {
      const c = new FakeChannel(this, { name: `old-channel-${i}`, type: ChannelType.GuildText });
      this.channels.cache.set(c.id, c);
    }

    this.autoModerationRules = {
      cache: new Collection(),
      async fetch() {
        return this.cache;
      },
      async create(data) {
        const tm = data.triggerMetadata || {};
        if (!data.name || data.name.length > 100) throw apiError(50035, 'rule name');
        if ((tm.keywordFilter || []).length > 1000) throw apiError(50035, 'too many keywords');
        for (const k of tm.keywordFilter || []) if (k.length > 60) throw apiError(50035, 'keyword too long');
        if ((tm.regexPatterns || []).length > 10) throw apiError(50035, 'too many regex');
        if ((data.exemptRoles || []).length > 20) throw apiError(50035, 'too many exempt roles');
        for (const r of data.exemptRoles || []) if (!guild.roles.cache.has(r)) throw apiError(50035, 'unknown exempt role');
        for (const a of data.actions) {
          if (a.metadata?.customMessage && a.metadata.customMessage.length > 150) throw apiError(50035, 'custom message too long');
          if (a.type === 3 && ![1, 5].includes(data.triggerType)) throw apiError(50035, 'timeout not allowed for this trigger');
          if (a.type === 2 && !guild.channels.cache.has(a.metadata?.channel)) throw apiError(50035, 'unknown alert channel');
        }
        if (data.triggerType === 6) {
          if (data.eventType !== 2) throw apiError(50035, 'member profile rules need MEMBER_UPDATE');
          if (data.actions.some((x) => ![2, 4].includes(x.type))) throw apiError(50035, 'member profile rules: block interaction + alert only');
        } else if (data.eventType !== 1 || data.actions.some((x) => x.type === 4)) {
          throw apiError(50035, 'message rules need MESSAGE_SEND');
        }
        if ([3, 4, 5, 6].includes(data.triggerType) && [...this.cache.values()].some((r) => r.triggerType === data.triggerType)) throw apiError(50035, 'Invalid Form Body\ntrigger_type[AUTO_MODERATION_MAX_RULES_OF_TYPE_EXCEEDED]: Maximum number of rules of this type reached');
        const rule = { id: nextId(), name: data.name, triggerType: data.triggerType, data, delete: async () => this.cache.delete(rule.id) };
        this.cache.set(rule.id, rule);
        return rule;
      },
    };

    let emojiUploads = 0;
    this.emojis = {
      cache: new Collection(),
      async fetch() {
        return new Collection(this.cache);
      },
      async create({ attachment, name }) {
        if (!/^\w{2,32}$/.test(name)) throw apiError(50035, `invalid emoji name ${name}`);
        if (!fs.existsSync(attachment)) throw apiError(50035, 'emoji file missing');
        if (fs.statSync(attachment).size > 256 * 1024) throw apiError(50045, 'emoji file too big');
        const limit = { 0: 50, 1: 100, 2: 150, 3: 250 }[guild.premiumTier];
        if ([...this.cache.values()].filter((e) => !e.animated).length >= limit) throw apiError(30008, 'Maximum number of emojis reached');
        if (emojiUploads >= emojiRateLimitAfter) {
          const err = new RateLimitError({ timeToReset: 60_000, limit: 1, method: 'POST', hash: 'x', url: '/guilds/1/emojis', route: '/guilds/:id/emojis', majorParameter: guild.id, global: false, retryAfter: 60_000, sublimitTimeout: 0, scope: 'shared' });
          throw err;
        }
        emojiUploads += 1;
        const emoji = { id: nextId(), name, animated: false, available: true, guild, delete: async () => this.cache.delete(emoji.id) };
        this.cache.set(emoji.id, emoji);
        return emoji;
      },
    };

    this.inviteList = new Collection(); // code → invite, see addInvite() / useInvite()
    this.invites = {
      async create(channelId) {
        if (!guild.channels.cache.has(channelId)) throw apiError(10003, 'Unknown Channel');
        return { url: 'https://discord.gg/noxtest', code: 'noxtest' };
      },
      async fetch() {
        guild.assertBotCan('ManageGuild');
        return new Collection([...guild.inviteList.values()].map((invite) => [invite.code, { ...invite }]));
      },
    };

    this.members = {
      cache: new Collection([['bot', this.me]]),
      get me() {
        return guild.me;
      },
      async fetchMe() {
        return guild.me;
      },
      async fetch(arg) {
        if (arg === undefined) return new Collection(this.cache);
        const id = typeof arg === 'string' ? arg : arg.user;
        if (!this.cache.has(id)) {
          if (guild.unknownMembers?.has(id)) throw apiError(10007, 'Unknown Member');
          this.cache.set(id, new FakeMember(guild, id));
        }
        return this.cache.get(id);
      },
    };
    this.members.cache.set(ownerId, new FakeMember(this, ownerId));
    for (let i = 0; i < humans; i += 1) {
      const m = new FakeMember(this, nextId());
      this.members.cache.set(m.id, m);
    }
  }

  /** discord.js knows a user if it's in the member cache or the client's user cache (empty again after a restart). */
  isUserCached(id) {
    return this.members.cache.has(id) || this.client.users.cache.has(id);
  }

  /** A category holds at most 50 channels (CHANNEL_PARENT_MAX_CHANNELS). */
  assertCategoryRoom(categoryId, channel) {
    if (!categoryId || channel.parentId === categoryId) return;
    const children = this.channels.cache.filter((c) => c.parentId === categoryId).size;
    if (children >= 50) throw apiError(50035, 'Invalid Form Body\nparent_id[CHANNEL_PARENT_MAX_CHANNELS]: Maximum number of channels in category reached (50)');
  }

  /** Community servers can't delete their current rules / updates channel. */
  get protectedChannels() {
    if (!this.features.includes('COMMUNITY')) return new Set();
    return new Set([this.settings.rulesChannel, this.settings.publicUpdatesChannel].filter(Boolean));
  }

  get verificationLevel() {
    return this.settings.verificationLevel ?? 0;
  }

  get systemChannelId() {
    return this.settings.systemChannel ?? null;
  }

  get afkChannelId() {
    return this.settings.afkChannel ?? null;
  }

  get rulesChannelId() {
    return this.features.includes('COMMUNITY') ? this.settings.rulesChannel ?? null : null;
  }

  get publicUpdatesChannelId() {
    return this.features.includes('COMMUNITY') ? this.settings.publicUpdatesChannel ?? null : null;
  }

  get memberCount() {
    return this.members.cache.size;
  }

  iconURL() {
    return this.iconSet ? 'https://cdn.discordapp.com/icons/1/abc.png' : null;
  }

  async fetch() {
    return this;
  }

  async edit(data) {
    if (data.features) {
      if (data.features.includes('COMMUNITY') && !this.features.includes('COMMUNITY')) {
        if (!data.rulesChannel || !data.publicUpdatesChannel) throw apiError(50101, 'community requirements');
        if ((data.verificationLevel ?? this.settings.verificationLevel ?? 0) < 1) throw apiError(50101, 'verification too low');
        if ((data.explicitContentFilter ?? this.settings.explicitContentFilter ?? 0) !== 2) throw apiError(50101, 'content filter');
      }
      this.features = [...new Set(data.features)];
    }
    if (data.description && !this.features.includes('COMMUNITY')) throw apiError(50035, 'description requires community');
    if (this.features.includes('COMMUNITY') && data.verificationLevel !== undefined && data.verificationLevel < 1) throw apiError(50101, 'community needs verification');
    if (data.afkTimeout !== undefined && ![60, 300, 900, 1800, 3600].includes(data.afkTimeout)) throw apiError(50035, 'invalid afk timeout');
    if (data.preferredLocale !== undefined && !Object.values(Locale).includes(data.preferredLocale)) {
      throw apiError(50035, 'Invalid Form Body\npreferred_locale[BASE_TYPE_CHOICES]: Value must be one of a valid locale.');
    }
    for (const key of ['systemChannel', 'afkChannel', 'rulesChannel', 'publicUpdatesChannel', 'safetyAlertsChannel']) {
      if (data[key] && !this.channels.cache.has(data[key])) throw apiError(50035, `unknown ${key}`);
    }
    if (data.name) this.name = data.name;
    Object.assign(this.settings, data);
    this.log.push(['guildEdit', Object.keys(data).join(',')]);
    return this;
  }

  async setIcon(file) {
    if (!fs.existsSync(file)) throw apiError(50035, 'icon missing');
    this.iconSet = file;
    return this;
  }

  async setBanner(file) {
    if (!this.features.includes('BANNER')) throw apiError(50101, 'banner requires boosts');
    this.bannerSet = file;
    return this;
  }

  async editWelcomeScreen(data) {
    if (!this.features.includes('COMMUNITY')) throw apiError(50101, 'community required');
    if (data.welcomeChannels.length > 5) throw apiError(50035, 'too many welcome channels');
    // A member with no roles = what @everyone can do. Discord requires that for welcome channels.
    const everyone = new FakeMember(this, 'probe-everyone');
    for (const w of data.welcomeChannels) {
      assertEmoji(w.emoji, 'welcome_channels');
      const channel = this.channels.cache.get(w.channel);
      if (!channel) throw apiError(50035, 'unknown welcome channel');
      const perms = everyone.permissionsIn(channel);
      if (!perms.has(PermissionsBitField.Flags.ViewChannel) || !perms.has(PermissionsBitField.Flags.ReadMessageHistory)) {
        throw apiError(50035, 'Invalid Form Body\nwelcome_channels[WELCOME_CHANNEL_PERMISSIONS_REQUIRED]: Welcome channels must be readable by everyone.');
      }
      if (w.description.length > 42) throw apiError(50035, `welcome channel description > 42: ${w.description}`);
    }
    if (data.description && data.description.length > 140) throw apiError(50035, 'welcome description too long');
    this.welcomeScreen = data;
    return data;
  }

  /** Adds a member with the given role keys (resolved through the bot's build data). */
  addMember(id, roleIds = [], opts = {}) {
    const m = new FakeMember(this, id, { roles: roleIds, ...opts });
    this.members.cache.set(id, m);
    return m;
  }
}

// ───────────── Invites, profiles and moderation (security features) ─────────────

const DAY_MS = 86_400_000;

/** guild.deny('ManageGuild', …) – the bot loses these permissions: matching calls fail with 50013 like on Discord. */
FakeGuild.prototype.deny = function deny(...names) {
  this.deniedPermissions ??= new Set();
  for (const name of names) this.deniedPermissions.add(name);
  return this;
};

FakeGuild.prototype.assertBotCan = function assertBotCan(name) {
  if (this.deniedPermissions?.has(name)) throw apiError(50013, 'Missing Permissions');
};

/** Like discord.js: toggles the INVITES_DISABLED feature through guild.edit (needs Manage Server). */
FakeGuild.prototype.disableInvites = async function disableInvites(disabled = true) {
  this.assertBotCan('ManageGuild');
  const features = this.features.filter((f) => f !== 'INVITES_DISABLED');
  if (disabled) features.push('INVITES_DISABLED');
  return this.edit({ features });
};

/** A server invite (guild.invites.fetch() returns copies of these). */
FakeGuild.prototype.addInvite = function addInvite({ code = `inv${nextId().slice(-8)}`, inviterId = null, uses = 0, maxUses = 0 } = {}) {
  const inviter = inviterId ? this.members.cache.get(inviterId)?.user ?? { id: inviterId, bot: false } : null;
  const invite = { code, uses, maxUses, inviterId, inviter, guild: this };
  this.inviteList.set(code, invite);
  return invite;
};

/** Someone joins with this invite: one more use, and Discord deletes an invite that is used up. */
FakeGuild.prototype.useInvite = function useInvite(code) {
  const invite = this.inviteList.get(code);
  if (!invite) throw new Error(`no invite ${code}`);
  invite.uses += 1;
  if (invite.maxUses && invite.uses >= invite.maxUses) this.inviteList.delete(code);
  return invite;
};

/** guild.bans.create(user, { reason, deleteMessageSeconds }) – removes the member like Discord does. */
Object.defineProperty(FakeGuild.prototype, 'bans', {
  get() {
    if (!this.banManager) {
      const guild = this;
      this.banManager = {
        cache: new Collection(),
        async create(user, { reason = null, deleteMessageSeconds = 0 } = {}) {
          const id = typeof user === 'string' ? user : user.id;
          guild.assertBotCan('BanMembers');
          if (deleteMessageSeconds < 0 || deleteMessageSeconds > 604_800) throw apiError(50035, 'delete_message_seconds must be 0–604800');
          const member = guild.members.cache.get(id);
          if (member && !member.bannable) throw apiError(50013, 'Missing Permissions');
          this.cache.set(id, { user: member?.user ?? { id }, reason });
          guild.removeMember(id);
          return id;
        },
      };
    }
    return this.banManager;
  },
});

/** The member is gone (kicked, banned or left): fetching them fails with Unknown Member afterwards. */
FakeGuild.prototype.removeMember = function removeMember(id) {
  this.members.cache.delete(id);
  this.unknownMembers ??= new Set();
  this.unknownMembers.add(id);
};

Object.defineProperties(FakeMember.prototype, {
  // The bot can act on members below its highest role (never on the owner).
  manageable: {
    get() {
      return this.id !== this.guild.ownerId && this.guild.me.roles.highest.position > this.roles.highest.position;
    },
  },
  kickable: {
    get() {
      return this.manageable && !this.guild.deniedPermissions?.has('KickMembers');
    },
  },
  bannable: {
    get() {
      return this.manageable && !this.guild.deniedPermissions?.has('BanMembers');
    },
  },
  moderatable: {
    get() {
      return this.manageable && !this.permissions.has(PermissionsBitField.Flags.Administrator) && !this.guild.deniedPermissions?.has('ModerateMembers');
    },
  },
});

FakeMember.prototype.kick = async function kick(reason = null) {
  if (!this.kickable) throw apiError(50013, 'Missing Permissions');
  this.guild.log.push(['kick', this.id, reason]);
  this.guild.removeMember(this.id);
  return this;
};

FakeMember.prototype.timeout = async function timeout(ms, reason = null) {
  if (!this.moderatable) throw apiError(50013, 'Missing Permissions');
  if (ms !== null && (ms <= 0 || ms > 28 * DAY_MS)) throw apiError(50035, 'communication_disabled_until must be within 28 days');
  this.communicationDisabledUntilTimestamp = ms === null ? null : Date.now() + ms;
  this.guild.log.push(['timeout', this.id, reason]);
  return this;
};

/** A copy of the member as it is now – the "old" member / user for memberUpdate and userUpdate events. */
FakeMember.prototype.snapshot = function snapshot() {
  return Object.assign(Object.create(FakeMember.prototype), this, { user: { ...this.user } });
};

module.exports = { FakeGuild, FakeMember, FakeChannel, FakeRole, FakeMessage, validateMessage, validateV2, validateModal, apiError, nextId };
