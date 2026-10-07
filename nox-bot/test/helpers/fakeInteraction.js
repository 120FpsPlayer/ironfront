'use strict';

const { Collection } = require('discord.js');
const { validateMessage, validateModal } = require('./fakeDiscord');

/**
 * A fake interaction. Every response (reply / update / editReply / showModal) is validated
 * like Discord would, and recorded in `state` so tests can inspect it.
 *
 * kind: 'command' | 'button' | 'select' | 'userselect' | 'modal' | 'autocomplete'
 */
function createInteraction({ guild, member, kind = 'button', customId, values, fields = {}, selects = {}, options = {}, subcommand = null, commandName, channel, message = null, focused = '', focusedOption = null }) {
  const state = { replies: [], updates: [], edits: [], modals: [], followUps: [], responded: null };
  const record = (bucket) => async (payload) => {
    if (typeof payload === 'string') payload = { content: payload };
    validateMessage(payload, guild);
    state[bucket].push(payload);
    if (bucket === 'replies' || bucket === 'updates') interaction.replied = true;
    return { id: 'reply', ...payload };
  };
  const ch = channel ?? guild.channels.cache.first();
  const interaction = {
    state,
    kind,
    customId,
    values,
    commandName,
    guild,
    guildId: guild.id,
    client: guild.client,
    member,
    user: member.user,
    channel: ch,
    channelId: ch?.id,
    message,
    replied: false,
    deferred: false,
    users: new Collection((values ?? []).map((id) => [id, guild.members.cache.get(id)?.user ?? { id, bot: false }])),
    inGuild: () => true,
    isRepliable: () => kind !== 'autocomplete',
    isAutocomplete: () => kind === 'autocomplete',
    isChatInputCommand: () => kind === 'command',
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isUserSelectMenu: () => kind === 'userselect',
    isModalSubmit: () => kind === 'modal',
    isFromMessage: () => kind === 'modal' && Boolean(message),
    fields: {
      getTextInputValue: (id) => {
        if (!(id in fields)) throw new Error(`no field ${id}`);
        return fields[id];
      },
      getStringSelectValues: (id) => {
        if (!(id in selects)) throw new Error(`no select ${id}`);
        return selects[id];
      },
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (n) => options[n] ?? null,
      getInteger: (n) => options[n] ?? null,
      getNumber: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
      getChannel: (n) => options[n] ?? null,
      getRole: (n) => options[n] ?? null,
      getUser: (n) => options[n] ?? null,
      getAttachment: (n) => options[n] ?? null,
      getFocused: (full) => (full ? { name: focusedOption, value: focused } : focused),
    },
    reply: record('replies'),
    update: record('updates'),
    followUp: record('followUps'),
    editReply: async (payload) => {
      if (typeof payload === 'string') payload = { content: payload };
      validateMessage(payload, guild);
      state.edits.push(payload);
      return payload;
    },
    // state.deferredAs: 'reply' (a new message) or 'update' (the clicked message is replaced)
    deferReply: async () => {
      interaction.deferred = true;
      state.deferredAs = 'reply';
    },
    deferUpdate: async () => {
      interaction.deferred = true;
      state.deferredAs = 'update';
    },
    showModal: async (modal) => {
      state.modals.push(validateModal(modal, guild));
      interaction.replied = true;
    },
    respond: async (choices) => {
      if (choices.length > 25) throw new Error('too many autocomplete choices');
      for (const c of choices) if (!c.name || c.name.length > 100 || String(c.value).length > 100) throw new Error(`bad choice ${JSON.stringify(c)}`);
      state.responded = choices;
    },
  };
  return interaction;
}

/** Last visible response (reply, update or edit). */
function lastResponse(i) {
  const all = [...i.state.replies, ...i.state.updates, ...i.state.edits, ...i.state.followUps];
  return all[all.length - 1];
}

/** All text in a response (embeds + Components V2 text), for assertions. */
function textOf(payload) {
  if (!payload) return '';
  const parts = [];
  if (payload.content) parts.push(payload.content);
  for (const e of payload.embeds ?? []) {
    const d = e.toJSON ? e.toJSON() : e;
    parts.push(d.title ?? '', d.description ?? '', ...(d.fields ?? []).map((f) => `${f.name} ${f.value}`));
  }
  const walk = (c) => {
    const d = c?.toJSON ? c.toJSON() : c;
    if (!d) return;
    if (d.content) parts.push(d.content);
    if (d.label) parts.push(d.label);
    for (const x of d.components ?? []) walk(x);
    if (d.accessory) walk(d.accessory);
  };
  for (const c of payload.components ?? []) walk(c);
  return parts.join('\n');
}

/** Every custom_id in a payload. */
function customIds(payload) {
  const ids = [];
  const walk = (c) => {
    const d = c?.toJSON ? c.toJSON() : c;
    if (!d) return;
    if (d.custom_id) ids.push(d.custom_id);
    for (const x of d.components ?? []) walk(x);
    if (d.accessory) walk(d.accessory);
  };
  for (const c of payload?.components ?? []) walk(c);
  return ids;
}

module.exports = { createInteraction, lastResponse, textOf, customIds };
