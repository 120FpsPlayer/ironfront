'use strict';

/**
 * The Hammer Launcher server layout (BOT_PROFILE=launcher) – what /build creates there. Same rules as layout.js
 * (keys, kinds, profiles, posts); the channels are the launcher's: download, new versions, news, Hammer+, bug
 * reports and ideas instead of a shop. Keys the bot's features look for (verify, rules, welcome, announcements,
 * tickets, chat, giveaways, leaderboard, the log channels…) are the same as on the shop server.
 */

const SEPARATOR = (key, label) => ({ key, name: `━━━━━ ${label} ━━━━━`, color: 0, perms: 'none', separator: true, was: [] });

const ROLES = [
  // The bot's own role – only the bot has it (src/features/brandrole.js), right under its integration role.
  { key: 'brand', name: '🔨 Hammer Launcher', color: 0xffc233, perms: 'none', hoist: true, icon: '🔨', botOnly: true },
  { key: 'founder', name: '👑 CEO', color: 0xffe0b8, perms: 'owner', hoist: true, icon: '👑', staff: true },
  { key: 'coowner', name: '🔱 Co-CEO', color: 0xffcf96, perms: 'owner', hoist: true, icon: '🔱', staff: true },
  { key: 'developer', name: '💻 Developer', color: 0xffd166, perms: 'admin', hoist: true, icon: '💻', staff: true },
  { key: 'manager', name: '🔥 Manager', color: 0xffbb70, perms: 'admin', hoist: true, icon: '🔥', staff: true },
  { key: 'admin', name: '🛡️ Administrator', color: 0xffa94d, perms: 'admin', hoist: true, icon: '🛡️', staff: true },
  { key: 'moderator', name: '⚔️ Moderator', color: 0xff9233, perms: 'mod', hoist: true, icon: '⚔️', staff: true },
  { key: 'support', name: '🎧 Support', color: 0xf97d1f, perms: 'support', hoist: true, icon: '🎧', staff: true },
  { key: 'trialSupport', name: '🌱 Stażysta', color: 0xe46a12, perms: 'trial', hoist: true, icon: '🌱', staff: true },
  SEPARATOR('sepSpecial', 'SPOŁECZNOŚĆ'),
  { key: 'tester', name: '🧪 Tester', color: 0xffad66, perms: 'none', hoist: true, icon: '🧪' },
  SEPARATOR('sepMembers', 'CZŁONKOWIE'),
  { key: 'bots', name: '🤖 Boty', color: 0xd9894a, perms: 'bot', hoist: true, icon: '🤖' },
  { key: 'member', name: '✅ Członek', color: 0xf0c9a3, perms: 'member', hoist: true, icon: '✅' },
  SEPARATOR('sepPings', 'POWIADOMIENIA'),
  { key: 'pingAnnouncements', name: '📢 Ogłoszenia', color: 0, perms: 'none' },
  { key: 'pingUpdates', name: '🚀 Aktualizacje', color: 0, perms: 'none' },
  { key: 'pingGiveaways', name: '🎉 Giveawaye', color: 0, perms: 'none' },
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
      voice('statMembers', '👥 Członkowie: 0', { profile: 'stats' }),
      voice('statVersion', '🚀 Wersja: beta', { profile: 'stats' }), // the newest published launcher – src/features/stats.js
      voice('statDownloads', '⬇ Pobrania: 0', { profile: 'stats' }),
    ],
  },
  {
    key: 'catWelcome',
    name: '👋 WITAMY',
    profile: 'public',
    channels: [
      text('verify', '✅ weryfikacja', { profile: 'verify', topic: 'Zweryfikuj się tutaj, żeby odblokować cały serwer.', post: 'verify' }),
      text('rules', '📜 regulamin', { profile: 'rules', topic: 'Zasady serwera i launchera – przeczytaj je na start.', post: 'rules' }),
      // Readable before verifying (like #rules) – otherwise the ping in a newcomer's welcome card never reaches them.
      text('welcome', '👋 powitania', { profile: 'rules', topic: 'Przywitaj naszych nowych członków 🧡', post: 'welcome' }),
      text('information', '📌 informacje', { profile: 'readonly', topic: 'O Hammer Launcherze, kanały, zespół i kontakt.', post: 'information' }),
      news('announcements', '📢 ogłoszenia', { topic: 'Oficjalne ogłoszenia.', post: 'announcements' }),
      text('roles', '🎭 role', { profile: 'readonly', topic: 'Role na serwerze i role z powiadomieniami.', post: 'roles' }),
    ],
  },
  {
    key: 'catLauncher',
    name: '🔨 LAUNCHER',
    profile: 'public',
    channels: [
      text('launcher', '⬇ pobierz', { profile: 'readonly', topic: 'Pobierz Hammer Launcher – zawsze aktualna wersja.', post: 'launcher' }),
      // The admin panel of the website posts here: new versions (with the 🚀 Aktualizacje ping) and the launcher's news.
      news('updates', '🚀 aktualizacje', { topic: 'Nowe wersje launchera i lista zmian.', post: 'updates' }),
      news('news', '📰 aktualności', { topic: 'Wiadomości, które widać też na ekranie głównym launchera.', post: 'news' }),
      text('plus', '⭐ hammer-plus', { profile: 'readonly', topic: 'Hammer+ – co daje i jak go zdobyć.', post: 'plus' }),
      text('faq', '❓ faq', { profile: 'readonly', topic: 'Najczęściej zadawane pytania o launcher.', post: 'faq' }),
    ],
  },
  {
    key: 'catSupport',
    name: '🎧 POMOC',
    profile: 'public',
    channels: [
      text('tickets', '🎫 tickety', { profile: 'readonly', topic: 'Otwórz ticket – pomoc z launcherem, błędy, Hammer+ i więcej.', post: 'tickets' }),
      text('bugs', '🐛 zgłoś-błąd', { profile: 'readonly', topic: 'Jak zgłosić błąd, żebyśmy mogli go szybko naprawić.', post: 'bugs' }),
      text('suggestions', '💡 propozycje', { topic: 'Pomysły na nowe funkcje launchera i Hammer Client – jeden pomysł na wiadomość.', slowmode: 60, post: 'suggestions' }),
    ],
  },
  {
    key: 'catCommunity',
    name: '💬 SPOŁECZNOŚĆ',
    profile: 'public',
    channels: [
      text('chat', '💬 czat', { topic: 'Ogólny czat – piszemy kulturalnie i po polsku.', slowmode: 3 }),
      text('screenshots', '📸 zrzuty-ekranu', { topic: 'Pochwal się swoim HUD-em, buildem albo ustawieniami.', slowmode: 10, post: 'screenshots' }),
      text('servers', '🎮 serwery', { topic: 'Szukasz ekipy albo serwera do gry? Napisz tutaj.', slowmode: 30, post: 'servers' }),
      text('giveaways', '🎉 giveawaye', { profile: 'readonly', topic: 'Giveawaye – kliknij Dołącz, żeby wziąć udział!', post: 'giveaways' }),
      text('leaderboard', '🏆 ranking', { profile: 'readonly', topic: 'Najaktywniejsi członkowie.', post: 'leaderboard' }),
      text('boosters', '💎 boosterzy', { profile: 'readonly', topic: 'Dziękujemy za boosty!', post: 'boosters' }),
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
      text('backups', '💾 kopie-zapasowe', { profile: 'admins', topic: 'Automatyczne kopie zapasowe danych bota – ten kanał musi zostać prywatny.' }),
    ],
  },
  { key: 'catTickets', name: '🎫 TICKETY', profile: 'hidden', channels: [] },
  { key: 'catClosed', name: '🔐 ZAMKNIĘTE TICKETY', profile: 'hidden', channels: [] },
];

/** The Community welcome screen: channels everyone can read before verifying (description max 42 characters). */
const WELCOME_SCREEN = [
  { channel: 'verify', emoji: '✅', description: 'Zweryfikuj się, żeby odblokować serwer' },
  { channel: 'rules', emoji: '📜', description: 'Przeczytaj zasady serwera i launchera' },
];

module.exports = { ROLES, CATEGORIES, WELCOME_SCREEN, OLD_COLORS: [] };
