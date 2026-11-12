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

const SEPARATOR = (key, label, was) => ({ key, name: `━━━━━ ${label} ━━━━━`, color: 0, perms: 'none', separator: true, was: [`━━━━━ ${was} ━━━━━`] });

/**
 * Role colours of the NØX version (purple) – /build only:update recolours roles that still have one of them.
 * `was` – the old default names (NØX and the English HammerShop version), renamed by /build only:update – a name you
 * chose yourself is never touched.
 */
const OLD_COLORS = [0xd8b4fe, 0xc77dff, 0xb565ff, 0xa855f7, 0x9333ea, 0x8b5cf6, 0x7c3aed, 0xe0aaff, 0xe879f9, 0xc4b5fd, 0x7b61ff, 0xb9a7e8];

const ROLES = [
  // The bot's own role – only the bot has it (src/features/brandrole.js takes it away from anyone else). /build puts
  // it right under the bot's integration role, so it's the highest role of the server and the bot is listed first.
  { key: 'brand', name: '🔨 HammerShop', color: 0xff9f43, perms: 'none', hoist: true, icon: '🔨', botOnly: true },
  { key: 'founder', name: '👑 CEO', color: 0xffe0b8, perms: 'owner', hoist: true, icon: '👑', staff: true, was: ['👑 Founder'] },
  { key: 'coowner', name: '🔱 Co-CEO', color: 0xffcf96, perms: 'owner', hoist: true, icon: '🔱', staff: true, was: ['💠 Co-Founder'] },
  { key: 'manager', name: '🔥 Manager', color: 0xffbb70, perms: 'admin', hoist: true, icon: '🔥', staff: true, was: ['🌙 Manager'] },
  { key: 'admin', name: '🛡️ Administrator', color: 0xffa94d, perms: 'admin', hoist: true, icon: '🛡️', staff: true },
  { key: 'moderator', name: '⚔️ Moderator', color: 0xff9233, perms: 'mod', hoist: true, icon: '⚔️', staff: true, was: ['🔨 Moderator'] },
  { key: 'support', name: '🎧 Support', color: 0xf97d1f, perms: 'support', hoist: true, icon: '🎧', staff: true },
  { key: 'trialSupport', name: '🌱 Stażysta', color: 0xe46a12, perms: 'trial', hoist: true, icon: '🌱', staff: true, was: ['🌱 Trial Support'] },
  { key: 'seller', name: '💼 Sprzedawca', color: 0xffc785, perms: 'seller', hoist: true, icon: '💼', staff: true, was: ['💼 Seller'] },
  SEPARATOR('sepSpecial', 'KLIENCI', 'CUSTOMERS'),
  { key: 'loyal', name: '🧡 Stały Klient', color: 0xffad66, perms: 'none', hoist: true, icon: '🧡', was: ['💜 Loyal Customer', '🧡 Loyal Customer'] },
  { key: 'customer', name: '🛍️ Klient', color: 0xffdcb8, perms: 'none', hoist: true, icon: '🛍️', was: ['🛍️ Customer'] },
  SEPARATOR('sepMembers', 'CZŁONKOWIE', 'MEMBERS'),
  { key: 'bots', name: '🤖 Boty', color: 0xd9894a, perms: 'bot', hoist: true, icon: '🤖', was: ['🤖 Bots'] },
  { key: 'member', name: '✅ Członek', color: 0xf0c9a3, perms: 'member', hoist: true, icon: '✅', was: ['✅ Member'] },
  SEPARATOR('sepPings', 'POWIADOMIENIA', 'NOTIFICATIONS'),
  { key: 'pingAnnouncements', name: '📢 Ogłoszenia', color: 0, perms: 'none', was: ['📢 Announcements'] },
  { key: 'pingGiveaways', name: '🎉 Giveawaye', color: 0, perms: 'none', was: ['🎉 Giveaways'] },
  { key: 'pingRestocks', name: '📦 Dostawy', color: 0, perms: 'none', was: ['📦 Restocks'] },
];

const text = (key, name, opts = {}) => ({ key, name, kind: 'text', profile: 'public', ...opts });
const news = (key, name, opts = {}) => ({ key, name, kind: 'announcement', profile: 'readonly', ...opts });
const voice = (key, name, opts = {}) => ({ key, name, kind: 'voice', profile: 'public', ...opts });

const CATEGORIES = [
  {
    key: 'catStats',
    name: '📊 STATYSTYKI',
    profile: 'stats',
    channels: [
      voice('statShop', '🟢 Sklep otwarty', { profile: 'stats', feature: 'shopStatus' }), // open / closed – see features/shopstatus.js
      voice('statMembers', '👥 Członkowie: 0', { profile: 'stats' }),
      voice('statVouches', '⭐ Opinie: 0', { profile: 'stats' }),
    ],
  },
  {
    key: 'catWelcome',
    name: '👋 WITAMY',
    profile: 'public',
    channels: [
      text('verify', '✅ weryfikacja', { profile: 'verify', topic: 'Zweryfikuj się tutaj, żeby odblokować cały serwer.', post: 'verify' }),
      text('rules', '📜 regulamin', { profile: 'rules', topic: 'Regulamin sklepu i serwera – przeczytaj go przed zakupem.', post: 'rules' }),
      // Readable before verifying (like #rules) – otherwise the ping in a newcomer's welcome card never reaches them.
      text('welcome', '👋 powitania', { profile: 'rules', topic: 'Przywitaj naszych nowych członków 🧡', post: 'welcome' }),
      text('information', '📌 informacje', { profile: 'readonly', topic: 'O nas, kanały, zespół i kontakt.', post: 'information' }),
      news('announcements', '📢 ogłoszenia', { topic: 'Oficjalne ogłoszenia i nowości.', post: 'announcements' }),
      // Hammer Launcher: its card with the download button, and under it the news and versions the admin panel posts.
      text('launcher', '🔨 launcher', { profile: 'readonly', topic: 'Hammer Launcher – nasz launcher Minecrafta: pobieranie, nowości i nowe wersje.', post: 'launcher' }),
      text('giveaways', '🎉 giveawaye', { profile: 'readonly', topic: 'Giveawaye – kliknij Dołącz, żeby wziąć udział!', post: 'giveaways' }),
      text('roles', '🎭 role', { profile: 'readonly', topic: 'Role na serwerze i role z powiadomieniami.', post: 'roles' }),
    ],
  },
  {
    key: 'catShop',
    name: '🛒 SKLEP',
    profile: 'public',
    channels: [
      text('shop', '🛒 sklep', { profile: 'readonly', topic: 'Nasze produkty – kliknij Kup, żeby zamówić.', post: 'shop' }),
      text('howToBuy', '📦 jak-kupić', { profile: 'readonly', topic: 'Jak złożyć zamówienie – krok po kroku.', post: 'howToBuy' }),
      text('payments', '💳 płatności', { profile: 'readonly', topic: 'Metody płatności, które przyjmujemy.', post: 'payments' }),
      news('restocks', '✨ dostawy', { posters: ['seller'], topic: 'Nowe produkty i dostawy.', post: 'restocks' }),
      text('vouches', '⭐ opinie', { profile: 'botsOnly', topic: 'Opinie klientów – wystaw swoją przyciskiem albo komendą /opinia.', post: 'vouches' }),
      text('proofs', '🧾 realizacje', { profile: 'botsOnly', topic: 'Każde dostarczone zamówienie, publikowane automatycznie.', post: 'proofs' }),
    ],
  },
  {
    key: 'catSupport',
    name: '🎧 POMOC',
    profile: 'public',
    channels: [
      text('tickets', '🎫 tickety', { profile: 'readonly', topic: 'Otwórz ticket – zakupy, pomoc, nagrody i więcej.', post: 'tickets' }),
      text('faq', '❓ faq', { profile: 'readonly', topic: 'Najczęściej zadawane pytania.', post: 'faq' }),
    ],
  },
  {
    key: 'catCommunity',
    name: '💬 SPOŁECZNOŚĆ',
    profile: 'public',
    channels: [
      text('chat', '💬 czat', { topic: 'Ogólny czat – piszemy kulturalnie i po polsku.', slowmode: 3 }),
      text('leaderboard', '🏆 ranking', { profile: 'readonly', topic: 'Najaktywniejsi członkowie.', post: 'leaderboard' }),
      text('boosters', '🚀 boosterzy', { profile: 'readonly', topic: 'Dziękujemy za boosty!', post: 'boosters' }),
    ],
  },
  {
    key: 'catStaff',
    name: '🔒 ZESPÓŁ',
    profile: 'staff',
    channels: [
      text('staffChat', '💼 czat-zespołu', { profile: 'staff', topic: 'Czat zespołu.', post: 'staff' }),
      text('staffCommands', '🔧 komendy-zespołu', { profile: 'staff', topic: 'Komendy bota dla zespołu.' }),
      text('discordUpdates', '📣 aktualizacje-discorda', { profile: 'admins', topic: 'Komunikaty od Discorda dla administracji serwera.' }),
      voice('staffVoice', '🔒 Pokój zespołu', { profile: 'staff' }),
    ],
  },
  {
    key: 'catLogs',
    name: '📁 LOGI',
    profile: 'logs',
    channels: [
      text('ticketLogs', '📁 logi-ticketów', { profile: 'staffLogs' }),
      text('transcripts', '📄 transkrypcje', { profile: 'staffLogs' }),
      text('verifyLogs', '✅ logi-weryfikacji', { profile: 'logs' }),
      text('serverLogs', '📋 logi-serwera', { profile: 'logs' }),
      text('automodLogs', '🤖 logi-automod', { profile: 'logs' }),
      text('sales', '📈 sprzedaż', { profile: 'admins', topic: 'Cotygodniowe raporty sprzedaży.' }),
      text('backups', '💾 kopie-zapasowe', { profile: 'admins', topic: 'Automatyczne kopie zapasowe danych bota – ten kanał musi zostać prywatny.' }),
    ],
  },
  { key: 'catTickets', name: '🎫 TICKETY', profile: 'hidden', channels: [] },
  { key: 'catClosed', name: '🔐 ZAMKNIĘTE TICKETY', profile: 'hidden', channels: [] },
];

/**
 * Channels shown on the Community welcome screen (max 5, description max 42 characters).
 * Discord only allows channels EVERYONE can read – on HammerShop that's #verify and #rules, because
 * everything else unlocks after verification. Channels that aren't readable are skipped.
 */
const WELCOME_SCREEN = [
  { channel: 'verify', emoji: '✅', description: 'Zweryfikuj się, żeby odblokować serwer' },
  { channel: 'rules', emoji: '📜', description: 'Przeczytaj regulamin przed zakupem' },
];

// The Hammer Launcher server (BOT_PROFILE=launcher) has its own layout – everything that reads this file gets that one.
module.exports = require('../lib/profile').launcher ? require('./layout.launcher') : { ROLES, CATEGORIES, WELCOME_SCREEN, OLD_COLORS };
