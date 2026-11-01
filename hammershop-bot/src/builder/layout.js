'use strict';

/**
 * The HammerShop server layout. /build creates exactly this – edit it to change the server.
 *
 * Roles are listed top → bottom. Categories and channels use plain names ("🛒 SHOP", "📦 how-to-buy");
 * the style (〔 🛒 SHOP 〕, 📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ) comes from config.json → server.categoryStyle / channelStyle / smallCaps.
 * Channels:
 *   key      – internal name (used by the bot to find the channel later)
 *   name     – emoji + name (text channels: lowercase with dashes, no spaces). Use emojis without the
 *              invisible ️ variation selector (🔒 not 🛡️) – Discord drops it from channel names.
 *   kind     – text | announcement | voice
 *   profile  – who can see / write (see builder/permissions.js)
 *   posters  – extra role keys allowed to write in read-only channels
 *   post     – which message set /build publishes there (see builder/content.js)
 *   feature  – config.json section: with "enabled": false there, the channel is left out
 */

const SEPARATOR = (key, label) => ({ key, name: `━━━━━ ${label} ━━━━━`, color: 0, perms: 'none', separator: true });

/**
 * Role colours of the NØX version (purple) – /build only:update recolours roles that still have one of them.
 * `was` – the old default names, renamed by /build only:update (a name you chose yourself is never touched).
 */
const OLD_COLORS = [0xd8b4fe, 0xc77dff, 0xb565ff, 0xa855f7, 0x9333ea, 0x8b5cf6, 0x7c3aed, 0xe0aaff, 0xe879f9, 0xc4b5fd, 0x7b61ff, 0xb9a7e8];

const ROLES = [
  // The bot's own role – only the bot has it (src/features/brandrole.js takes it away from anyone else). /build puts
  // it right under the bot's integration role, so it's the highest role of the server and the bot is listed first.
  { key: 'brand', name: '🔨 HammerShop', color: 0xff9f43, perms: 'none', hoist: true, icon: '🔨', botOnly: true },
  { key: 'founder', name: '👑 CEO', color: 0xffe0b8, perms: 'owner', hoist: true, icon: '👑', staff: true, was: ['👑 Founder', 'Founder'] },
  { key: 'coowner', name: '🔱 Co-CEO', color: 0xffcf96, perms: 'owner', hoist: true, icon: '🔱', staff: true, was: ['💠 Co-Founder', 'Co-Founder'] },
  { key: 'manager', name: '🔥 Manager', color: 0xffbb70, perms: 'admin', hoist: true, icon: '🔥', staff: true, was: ['🌙 Manager'] },
  { key: 'admin', name: '🛡️ Administrator', color: 0xffa94d, perms: 'admin', hoist: true, icon: '🛡️', staff: true },
  { key: 'moderator', name: '⚔️ Moderator', color: 0xff9233, perms: 'mod', hoist: true, icon: '⚔️', staff: true, was: ['🔨 Moderator'] },
  { key: 'support', name: '🎧 Support', color: 0xf97d1f, perms: 'support', hoist: true, icon: '🎧', staff: true },
  { key: 'trialSupport', name: '🌱 Trial Support', color: 0xe46a12, perms: 'trial', hoist: true, icon: '🌱', staff: true },
  { key: 'seller', name: '💼 Seller', color: 0xffc785, perms: 'seller', hoist: true, icon: '💼', staff: true },
  SEPARATOR('sepSpecial', 'CUSTOMERS'),
  { key: 'loyal', name: '🧡 Loyal Customer', color: 0xffad66, perms: 'none', hoist: true, icon: '🧡', was: ['💜 Loyal Customer'] },
  { key: 'customer', name: '🛍️ Customer', color: 0xffdcb8, perms: 'none', hoist: true, icon: '🛍️' },
  SEPARATOR('sepMembers', 'MEMBERS'),
  { key: 'bots', name: '🤖 Bots', color: 0xd9894a, perms: 'bot', hoist: true, icon: '🤖' },
  { key: 'member', name: '✅ Member', color: 0xf0c9a3, perms: 'member', hoist: true, icon: '✅' },
  SEPARATOR('sepPings', 'NOTIFICATIONS'),
  { key: 'pingAnnouncements', name: '📢 Announcements', color: 0, perms: 'none' },
  { key: 'pingGiveaways', name: '🎉 Giveaways', color: 0, perms: 'none' },
  { key: 'pingRestocks', name: '📦 Restocks', color: 0, perms: 'none' },
];

const text = (key, name, opts = {}) => ({ key, name, kind: 'text', profile: 'public', ...opts });
const news = (key, name, opts = {}) => ({ key, name, kind: 'announcement', profile: 'readonly', ...opts });
const voice = (key, name, opts = {}) => ({ key, name, kind: 'voice', profile: 'public', ...opts });

const CATEGORIES = [
  {
    key: 'catStats',
    name: '📊 SERVER STATS',
    profile: 'stats',
    channels: [
      voice('statShop', '🟢 Shop open', { profile: 'stats', feature: 'shopStatus' }), // open / closed – see features/shopstatus.js
      voice('statMembers', '👥 Members: 0', { profile: 'stats' }),
      voice('statVouches', '⭐ Vouches: 0', { profile: 'stats' }),
    ],
  },
  {
    key: 'catWelcome',
    name: '👋 WELCOME',
    profile: 'public',
    channels: [
      text('verify', '✅ verify', { profile: 'verify', topic: 'Verify here to unlock the whole server.', post: 'verify' }),
      text('rules', '📜 rules', { profile: 'rules', topic: 'Server rules – read them before you buy or chat.', post: 'rules' }),
      // Readable before verifying (like #rules) – otherwise the ping in a newcomer's welcome card never reaches them.
      text('welcome', '👋 welcome', { profile: 'rules', topic: 'Say hi to our newest members 🧡', post: 'welcome' }),
      text('information', '📌 information', { profile: 'readonly', topic: 'About us, channels, team and contact.', post: 'information' }),
      news('announcements', '📢 announcements', { topic: 'Official news and updates.', post: 'announcements' }),
      text('giveaways', '🎉 giveaways', { profile: 'readonly', topic: 'Giveaways – click Enter to join!', post: 'giveaways' }),
      text('roles', '🎭 roles', { profile: 'readonly', topic: 'Server roles and notification roles.', post: 'roles' }),
    ],
  },
  {
    key: 'catShop',
    name: '🛒 SHOP',
    profile: 'public',
    channels: [
      text('shop', '🛒 shop', { profile: 'readonly', topic: 'Our products – click Buy to order.', post: 'shop' }),
      text('howToBuy', '📦 how-to-buy', { profile: 'readonly', topic: 'How ordering works, step by step.', post: 'howToBuy' }),
      text('payments', '💳 payments', { profile: 'readonly', topic: 'Accepted payment methods.', post: 'payments' }),
      news('restocks', '✨ restocks', { posters: ['seller'], topic: 'New products and restocks.', post: 'restocks' }),
      text('vouches', '⭐ vouches', { profile: 'botsOnly', topic: 'Customer reviews – leave yours with the button or /vouch.', post: 'vouches' }),
      text('proofs', '🧾 proofs', { profile: 'botsOnly', topic: 'Every delivered order, posted automatically.', post: 'proofs' }),
    ],
  },
  {
    key: 'catSupport',
    name: '🎧 SUPPORT',
    profile: 'public',
    channels: [
      text('tickets', '🎫 tickets', { profile: 'readonly', topic: 'Open a ticket – purchases, support, rewards and more.', post: 'tickets' }),
      text('faq', '❓ faq', { profile: 'readonly', topic: 'Frequently asked questions.', post: 'faq' }),
    ],
  },
  {
    key: 'catCommunity',
    name: '💬 COMMUNITY',
    profile: 'public',
    channels: [
      text('chat', '💬 chat', { topic: 'General chat – keep it friendly and in English.', slowmode: 3 }),
      text('leaderboard', '🏆 leaderboard', { profile: 'readonly', topic: 'The most active members.', post: 'leaderboard' }),
      text('boosters', '🚀 boosters', { profile: 'readonly', topic: 'Thank you for boosting!', post: 'boosters' }),
    ],
  },
  {
    key: 'catStaff',
    name: '🔒 STAFF',
    profile: 'staff',
    channels: [
      text('staffChat', '💼 staff-chat', { profile: 'staff', topic: 'Team chat.', post: 'staff' }),
      text('staffCommands', '🔧 staff-commands', { profile: 'staff', topic: 'Staff bot commands.' }),
      text('discordUpdates', '📣 discord-updates', { profile: 'admins', topic: 'Updates from Discord for server admins.' }),
      voice('staffVoice', '🔒 Staff Room', { profile: 'staff' }),
    ],
  },
  {
    key: 'catLogs',
    name: '📁 LOGS',
    profile: 'logs',
    channels: [
      text('ticketLogs', '📁 ticket-logs', { profile: 'staffLogs' }),
      text('transcripts', '📄 transcripts', { profile: 'staffLogs' }),
      text('verifyLogs', '✅ verify-logs', { profile: 'logs' }),
      text('serverLogs', '📋 server-logs', { profile: 'logs' }),
      text('automodLogs', '🤖 automod-logs', { profile: 'logs' }),
      text('sales', '📈 sales', { profile: 'admins', topic: 'Weekly sales reports.' }),
      text('backups', '💾 backups', { profile: 'admins', topic: 'Automatic backups of the bot data – keep this channel private.' }),
    ],
  },
  { key: 'catTickets', name: '🎫 TICKETS', profile: 'hidden', channels: [] },
  { key: 'catClosed', name: '🔐 CLOSED TICKETS', profile: 'hidden', channels: [] },
];

/**
 * Channels shown on the Community welcome screen (max 5, description max 42 characters).
 * Discord only allows channels EVERYONE can read – on HammerShop that's #verify and #rules, because
 * everything else unlocks after verification. Channels that aren't readable are skipped.
 */
const WELCOME_SCREEN = [
  { channel: 'verify', emoji: '✅', description: 'Verify to unlock the whole server' },
  { channel: 'rules', emoji: '📜', description: 'Read the rules before you buy' },
];

module.exports = { ROLES, CATEGORIES, WELCOME_SCREEN, OLD_COLORS };
