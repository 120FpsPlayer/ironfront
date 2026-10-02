'use strict';

/**
 * The NØX server layout. /build creates exactly this – edit it to change the server.
 *
 * Roles are listed top → bottom. Channels:
 *   key      – internal name (used by the bot to find the channel later)
 *   name     – channel name (text channels are lowercase, Discord turns spaces into dashes)
 *   kind     – text | announcement | voice
 *   profile  – who can see / write (see builder/permissions.js)
 *   posters  – extra role keys allowed to write in read-only channels
 *   post     – which message set /build publishes there (see builder/content.js)
 */

const SEPARATOR = (key, label) => ({ key, name: `━━━━━ ${label} ━━━━━`, color: 0, perms: 'none', separator: true });

const ROLES = [
  { key: 'founder', name: '👑 Founder', color: 0xd8b4fe, perms: 'owner', hoist: true, icon: '👑', staff: true },
  { key: 'coowner', name: '💠 Co-Founder', color: 0xc77dff, perms: 'owner', hoist: true, icon: '💠', staff: true },
  { key: 'manager', name: '🌙 Manager', color: 0xb565ff, perms: 'admin', hoist: true, icon: '🌙', staff: true },
  { key: 'admin', name: '🛡️ Administrator', color: 0xa855f7, perms: 'admin', hoist: true, icon: '🛡️', staff: true },
  { key: 'moderator', name: '🔨 Moderator', color: 0x9333ea, perms: 'mod', hoist: true, icon: '🔨', staff: true },
  { key: 'support', name: '🎧 Support', color: 0x8b5cf6, perms: 'support', hoist: true, icon: '🎧', staff: true },
  { key: 'trialSupport', name: '🌱 Trial Support', color: 0x7c3aed, perms: 'trial', hoist: true, icon: '🌱', staff: true },
  { key: 'seller', name: '💼 Seller', color: 0xe0aaff, perms: 'seller', hoist: true, icon: '💼', staff: true },
  SEPARATOR('sepSpecial', 'SPECIAL'),
  { key: 'vip', name: '💎 VIP', color: 0xf0abfc, perms: 'none', hoist: true, icon: '💎' },
  { key: 'partner', name: '🤝 Partner', color: 0x818cf8, perms: 'none', hoist: true, icon: '🤝' },
  { key: 'loyal', name: '💜 Loyal Customer', color: 0xe879f9, perms: 'none', hoist: true, icon: '💜' },
  { key: 'customer', name: '🛍️ Customer', color: 0xc4b5fd, perms: 'none', hoist: true, icon: '🛍️' },
  SEPARATOR('sepMembers', 'MEMBERS'),
  { key: 'bots', name: '🤖 Bots', color: 0x7b61ff, perms: 'bot', hoist: true, icon: '🤖' },
  { key: 'member', name: '✅ Member', color: 0xb9a7e8, perms: 'member', hoist: true, icon: '✅' },
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
      voice('statMembers', '👥 Members: 0', { profile: 'stats' }),
      voice('statVouches', '⭐ Vouches: 0', { profile: 'stats' }),
    ],
  },
  {
    key: 'catWelcome',
    name: '✦ WELCOME ✦',
    profile: 'public',
    channels: [
      text('verify', '✅┃verify', { profile: 'verify', topic: 'Verify here to unlock the whole server.', post: 'verify' }),
      text('rules', '📜┃rules', { profile: 'rules', topic: 'Server rules – read them before you buy or chat.', post: 'rules' }),
      text('welcome', '👋┃welcome', { profile: 'readonly', topic: 'Say hi to our newest members 💜', post: 'welcome' }),
      text('information', '📌┃information', { profile: 'readonly', topic: 'About us, channels, team and contact.', post: 'information' }),
      news('announcements', '📢┃announcements', { topic: 'Official news and updates.', post: 'announcements' }),
      text('giveaways', '🎉┃giveaways', { profile: 'readonly', topic: 'Giveaways – click Enter to join!', post: 'giveaways' }),
      text('roles', '🎭┃roles', { profile: 'readonly', topic: 'Server roles and notification roles.', post: 'roles' }),
      text('partners', '🤝┃partners', { profile: 'readonly', topic: 'Our official partners.', post: 'partners' }),
    ],
  },
  {
    key: 'catShop',
    name: '✦ SHOP ✦',
    profile: 'public',
    channels: [
      text('shop', '🛒┃shop', { profile: 'readonly', topic: 'Our products – click Buy to order.', post: 'shop' }),
      text('howToBuy', '📦┃how-to-buy', { profile: 'readonly', topic: 'How ordering works, step by step.', post: 'howToBuy' }),
      text('payments', '💳┃payments', { profile: 'readonly', topic: 'Accepted payment methods.', post: 'payments' }),
      news('restocks', '✨┃restocks', { posters: ['seller'], topic: 'New products and restocks.', post: 'restocks' }),
      text('vouches', '⭐┃vouches', { profile: 'botsOnly', topic: 'Customer reviews – leave yours with the button or /vouch.', post: 'vouches' }),
    ],
  },
  {
    key: 'catSupport',
    name: '✦ SUPPORT ✦',
    profile: 'public',
    channels: [
      text('tickets', '🎫┃tickets', { profile: 'readonly', topic: 'Open a ticket – purchases, support, rewards and more.', post: 'tickets' }),
      text('faq', '❓┃faq', { profile: 'readonly', topic: 'Frequently asked questions.', post: 'faq' }),
    ],
  },
  {
    key: 'catCommunity',
    name: '✦ COMMUNITY ✦',
    profile: 'public',
    channels: [
      text('chat', '💬┃chat', { topic: 'General chat – keep it friendly and in English.', slowmode: 3 }),
      text('media', '📸┃media', { profile: 'media', topic: 'Screenshots, clips and pictures. Keep it SFW.', post: 'media', slowmode: 10 }),
      text('memes', '😂┃memes', { profile: 'media', topic: 'Memes only. Keep it SFW.', post: 'memes', slowmode: 10 }),
      text('commands', '🤖┃commands', { topic: 'Use bot commands here.', post: 'commands' }),
      text('leaderboard', '🏆┃leaderboard', { profile: 'readonly', topic: 'The most active members.', post: 'leaderboard' }),
      text('boosters', '🚀┃boosters', { profile: 'readonly', topic: 'Thank you for boosting!', post: 'boosters' }),
    ],
  },
  {
    key: 'catVip',
    name: '✦ VIP LOUNGE ✦',
    profile: 'vip',
    channels: [
      text('vipChat', '💎┃vip-chat', { profile: 'vip', topic: 'Exclusive chat for VIPs, partners, loyal customers and boosters.', post: 'vip' }),
      voice('vipVoice', '💎┃VIP Lounge', { profile: 'vip' }),
    ],
  },
  {
    key: 'catVoice',
    name: '✦ VOICE ✦',
    profile: 'public',
    channels: [
      voice('lounge', '🔊┃Lounge'),
      voice('gaming', '🎮┃Gaming'),
      voice('music', '🎵┃Music'),
      voice('duo', '👥┃Duo', { userLimit: 2 }),
      voice('afk', '💤┃AFK', { profile: 'afk' }),
    ],
  },
  {
    key: 'catStaff',
    name: '✦ STAFF ✦',
    profile: 'staff',
    channels: [
      text('staffChat', '🛡️┃staff-chat', { profile: 'staff', topic: 'Team chat.', post: 'staff' }),
      text('staffCommands', '⚙️┃staff-commands', { profile: 'staff', topic: 'Staff bot commands.' }),
      text('discordUpdates', '📣┃discord-updates', { profile: 'admins', topic: 'Updates from Discord for server admins.' }),
      voice('staffVoice', '🛡️┃Staff Room', { profile: 'staff' }),
    ],
  },
  {
    key: 'catLogs',
    name: '✦ LOGS ✦',
    profile: 'logs',
    channels: [
      text('ticketLogs', '📁┃ticket-logs', { profile: 'staffLogs' }),
      text('transcripts', '📄┃transcripts', { profile: 'staffLogs' }),
      text('verifyLogs', '✅┃verify-logs', { profile: 'logs' }),
      text('serverLogs', '🗂️┃server-logs', { profile: 'logs' }),
      text('automodLogs', '🤖┃automod-logs', { profile: 'logs' }),
    ],
  },
  { key: 'catTickets', name: '🎫 TICKETS', profile: 'hidden', channels: [] },
  { key: 'catClosed', name: '📁 CLOSED TICKETS', profile: 'hidden', channels: [] },
];

/** Channels shown on the Community welcome screen (max 5). */
const WELCOME_SCREEN = [
  { channel: 'verify', emoji: '✅', description: 'Verify to unlock the server' },
  { channel: 'rules', emoji: '📜', description: 'Read the rules' },
  { channel: 'shop', emoji: '🛒', description: 'Browse our products' },
  { channel: 'tickets', emoji: '🎫', description: 'Buy or get support' },
  { channel: 'vouches', emoji: '⭐', description: 'See what customers say' },
];

module.exports = { ROLES, CATEGORIES, WELCOME_SCREEN };
