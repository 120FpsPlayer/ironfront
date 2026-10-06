'use strict';

const { PermissionFlagsBits } = require('discord.js');

/**
 * Permission sets for the NØX roles and the access profiles used by channels.
 * Permissions are written as names (readable) and converted to bits when building.
 */

/** What every verified member can do server-wide. Files are only allowed in media channels and tickets. */
const MEMBER = [
  'ViewChannel', 'ReadMessageHistory', 'SendMessages', 'SendMessagesInThreads', 'AddReactions', 'UseApplicationCommands',
  'EmbedLinks', 'UseExternalEmojis', 'UseExternalStickers', 'ChangeNickname', 'CreateInstantInvite',
  'Connect', 'Speak', 'UseVAD', 'Stream', 'UseEmbeddedActivities', 'UseSoundboard', 'UseExternalSounds',
  'SendVoiceMessages', 'RequestToSpeak', 'SetVoiceChannelStatus',
];

const STAFF_PERMISSIONS = {
  owner: ['Administrator'],
  admin: [
    ...MEMBER, 'AttachFiles', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'KickMembers', 'BanMembers', 'ManageMessages',
    'PinMessages', 'ManageNicknames', 'ManageWebhooks', 'ManageGuildExpressions', 'CreateGuildExpressions', 'ManageEvents',
    'CreateEvents', 'ManageThreads', 'CreatePublicThreads', 'CreatePrivateThreads', 'ModerateMembers', 'ViewAuditLog',
    'ViewGuildInsights', 'MentionEveryone', 'MuteMembers', 'DeafenMembers', 'MoveMembers', 'PrioritySpeaker', 'BypassSlowmode',
    'SendPolls',
  ],
  mod: [
    ...MEMBER, 'AttachFiles', 'KickMembers', 'BanMembers', 'ManageMessages', 'PinMessages', 'ManageNicknames', 'ManageThreads',
    'CreatePublicThreads', 'CreatePrivateThreads', 'ModerateMembers', 'ViewAuditLog', 'MentionEveryone', 'MuteMembers',
    'DeafenMembers', 'MoveMembers', 'ManageEvents', 'CreateEvents', 'BypassSlowmode', 'PrioritySpeaker', 'SendPolls',
  ],
  support: [...MEMBER, 'AttachFiles', 'ManageMessages', 'PinMessages', 'ManageThreads', 'CreatePublicThreads', 'ModerateMembers', 'MuteMembers', 'MoveMembers', 'BypassSlowmode'],
  trial: [...MEMBER, 'AttachFiles', 'ManageMessages', 'ModerateMembers'],
  seller: [...MEMBER, 'AttachFiles', 'PinMessages', 'BypassSlowmode'],
  bot: [...MEMBER, 'AttachFiles'],
  member: MEMBER,
  none: [],
};

const SEND = ['SendMessages', 'SendMessagesInThreads', 'CreatePublicThreads', 'CreatePrivateThreads'];
const POST = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'AttachFiles', 'MentionEveryone'];

const unique = (list) => [...new Set(list)];

function toBits(names = []) {
  let bits = 0n;
  for (const name of names) {
    const flag = PermissionFlagsBits[name];
    if (flag === undefined) throw new Error(`Unknown permission "${name}"`);
    bits |= flag;
  }
  return bits;
}

const ow = (target, allow = [], deny = []) => ({ target, allow: unique(allow), deny: unique(deny) });

/**
 * Role groups by key. '@everyone' and '@booster' are special targets resolved at build time.
 */
const GROUPS = {
  admins: ['founder', 'coowner', 'manager', 'admin'],
  mods: ['founder', 'coowner', 'manager', 'admin', 'moderator'],
  staff: ['founder', 'coowner', 'manager', 'admin', 'moderator', 'support', 'trialSupport', 'seller'],
  bots: ['bots'],
};

/**
 * Channel access profiles. The server is "gated": @everyone has no permissions at all,
 * the Member role (given by verification) unlocks the server. So a channel without
 * overwrites is visible to verified members only.
 */
function profile(name, { posters = [] } = {}) {
  const E = '@everyone';
  const G = GROUPS;
  const allowFor = (keys, perms) => unique(keys).map((k) => ow(k, perms));
  const writers = unique([...G.admins, ...posters, ...G.bots]);

  switch (name) {
    case 'public':
      return [];
    case 'readonly':
      return [ow(E, [], [...SEND, 'AddReactions']), ow('member', ['AddReactions']), ...allowFor(writers, POST)];
    case 'botsOnly':
      return [ow(E, [], [...SEND]), ow('member', ['AddReactions']), ...allowFor([...G.admins, ...G.bots], POST)];
    case 'verify':
      return [
        ow(E, ['ViewChannel', 'ReadMessageHistory'], [...SEND, 'AddReactions', 'UseApplicationCommands']),
        ow('member', [], ['ViewChannel']),
        ...allowFor([...G.admins, ...G.bots], [...POST, 'ViewChannel']),
      ];
    case 'rules':
      return [ow(E, ['ViewChannel', 'ReadMessageHistory'], [...SEND, 'AddReactions']), ...allowFor(writers, POST)];
    case 'stats':
      return [ow(E, ['ViewChannel'], ['Connect', 'SendMessages'])];
    case 'staff':
      return [ow(E, [], ['ViewChannel']), ...allowFor([...G.staff, ...G.bots], ['ViewChannel'])];
    case 'admins':
      return [ow(E, [], ['ViewChannel']), ...allowFor([...G.admins, ...G.bots], ['ViewChannel'])];
    case 'logs':
      return [
        ow(E, [], ['ViewChannel', ...SEND, 'AddReactions']),
        ...allowFor(G.mods, ['ViewChannel', 'ReadMessageHistory']),
        ...allowFor(G.bots, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory']),
      ];
    case 'staffLogs':
      return [
        ow(E, [], ['ViewChannel', ...SEND, 'AddReactions']),
        ...allowFor(G.staff, ['ViewChannel', 'ReadMessageHistory']),
        ...allowFor(G.bots, ['ViewChannel', 'SendMessages', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory']),
      ];
    case 'hidden':
      return [ow(E, [], ['ViewChannel']), ...allowFor([...G.staff, ...G.bots], ['ViewChannel'])];
    default:
      throw new Error(`Unknown access profile "${name}"`);
  }
}

module.exports = { MEMBER, STAFF_PERMISSIONS, SEND, POST, GROUPS, toBits, ow, profile, unique };
