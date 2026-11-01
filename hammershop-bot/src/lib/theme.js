'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AttachmentBuilder } = require('discord.js');
const config = require('./config');
const db = require('./db');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

const COLORS = {
  brand: config.brand.colorInt,
  deep: 0xf97316,
  light: 0xffc48a,
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c,
  info: config.brand.colorInt,
  muted: 0x2b2d31,
};

/** Unicode fallbacks for every custom emoji – used until /build uploads the HammerShop emojis (or if one is deleted). */
const FALLBACK = {
  arrow_right: '➡️', basket: '🧺', battery: '🔋', bell: '🔔', blik: '📱', brush: '🖌️', calculator: '🧮', calendar: '📅',
  camera: '📷', cart: '🛒', chat: '💬', check: '✅', clock: '🕒', cloud: '☁️', coin: '🪙', crown: '👑', currency_eur: '💶',
  currency_gbp: '💷', currency_pln: '💴', currency_usd: '💵', diamond: '💎', download: '📥', flame: '🔥', folder: '📂',
  gear: '⚙️', gift: '🎁', group: '👥', hash: '#️⃣', heart: '🧡', home: '🏠', info: 'ℹ️', key: '🔑', lock_locked: '🔒',
  lock_unlocked: '🔓', mail: '✉️', medal: '🏅', moon: '🌙', music: '🎵', paysafecard: '🛡️', pencil: '✏️', person: '👤',
  phone: '📱', pin: '📍', question: '❓', refresh: '🔄', rocket: '🚀', search: '🔍', share: '🔗', star: '⭐',
  star_outline: '⭐', sun: '☀️', target: '🎯', thumbs_down: '👎', thumbs_up: '👍', trophy: '🏆', upload: '📤', wallet: '👛',
  warning: '⚠️', x: '❌', ticket: '🎫', shield: '🛡️', box: '📦', sparkles: '✨', card: '💳', crypto: '🪙', paypal: '💰',
  logo: '🔨',
};

/**
 * Upload order for /build. A server without boosts has 50 static emoji slots, so the
 * emojis the bot uses most come first; the rest are uploaded when there is room.
 */
const EMOJI_PRIORITY = [
  'logo', 'check', 'x', 'cart', 'shield', 'ticket', 'star', 'star_outline', 'gift', 'diamond', 'crown', 'warning', 'info', 'question',
  'box', 'sparkles', 'card', 'crypto', 'paysafecard', 'paypal', 'coin', 'currency_eur', 'wallet', 'bell', 'rocket', 'trophy', 'chat',
  'group', 'person', 'mail', 'clock', 'lock_locked', 'lock_unlocked', 'heart', 'flame', 'moon', 'medal', 'pencil',
  'gear', 'hash', 'pin', 'refresh', 'search', 'thumbs_up', 'thumbs_down', 'arrow_right', 'blik',
  'currency_usd', 'currency_gbp', 'currency_pln', 'basket', 'calendar', 'camera', 'download', 'upload', 'folder',
  'home', 'key', 'music', 'phone', 'share', 'sun', 'target', 'battery', 'brush', 'calculator', 'cloud',
];

const guildIdOf = (guild) => (typeof guild === 'string' ? guild : guild?.id);

/** Custom emoji ID for this guild, or null when it isn't uploaded / was deleted. */
function emojiId(guild, name) {
  const gid = guildIdOf(guild);
  if (!gid) return null;
  const id = db.emojiIds(gid)[name];
  if (!id) return null;
  // With a Guild object we double-check the emoji still exists and can be used (lost boost slots make
  // emojis unavailable) – a deleted or unavailable emoji in a button makes Discord reject the message.
  if (typeof guild === 'object' && guild?.emojis?.cache) {
    const emoji = guild.emojis.cache.get(id);
    if (!emoji || emoji.available === false) return null;
  }
  return id;
}

const emojiName = (name) => `${config.emojis.prefix}${name}`.slice(0, 32);

/** Emoji for message text: <:hs_cart:123> or the Unicode fallback. */
function e(guild, name) {
  const id = emojiId(guild, name);
  return id ? `<:${emojiName(name)}:${id}>` : (FALLBACK[name] ?? '•');
}

/** Emoji for buttons / select menus: { id, name } or the Unicode fallback. */
function ce(guild, name) {
  const id = emojiId(guild, name);
  return id ? { id, name: emojiName(name) } : (FALLBACK[name] ?? '▫️');
}

const bannerPath = (key) => path.join(ASSETS, 'banners', `${key}.png`);
const hasBanner = (key) => fs.existsSync(bannerPath(key));

const bannerArts = new Map();
/** Short hash of a banner picture – /build only:panels re-uploads a banner whose picture changed (e.g. a new colour). */
function bannerArt(key) {
  if (!bannerArts.has(key)) {
    bannerArts.set(key, hasBanner(key) ? crypto.createHash('sha1').update(fs.readFileSync(bannerPath(key))).digest('hex').slice(0, 12) : null);
  }
  return bannerArts.get(key);
}

/** Polish alt text of the banners (the attachment description). */
const BANNER_ALT = {
  announcements: 'Ogłoszenia', boosters: 'Boosterzy', 'bot-commands': 'Komendy', channels: 'Kanały', chat: 'Czat', contact: 'Kontakt',
  discord: 'Discord', events: 'Wydarzenia', faq: 'FAQ', giveaways: 'Giveawaye', help: 'Pomoc', 'how-to-buy': 'Jak kupić',
  information: 'Informacje', 'join-us': 'Dołącz do nas', leaderboard: 'Ranking', media: 'Media', memes: 'Memy', partners: 'Partnerzy',
  payments: 'Płatności', products: 'Produkty', proofs: 'Realizacje', purchase: 'Zakup', restocks: 'Dostawy', reviews: 'Opinie',
  roles: 'Role', rules: 'Regulamin', shop: 'Sklep', staff: 'Zespół', support: 'Pomoc', tickets: 'Tickety', updates: 'Aktualizacje',
  verification: 'Weryfikacja', vip: 'VIP', vouches: 'Opinie', welcome: 'Powitanie', 'whats-new': 'Nowości',
};

/** A banner image as an attachment (posted above channel cards). */
function banner(key) {
  return new AttachmentBuilder(bannerPath(key), { name: `hammershop-${key}.png`, description: `${config.brand.name} – ${BANNER_ALT[key] ?? key}` });
}

module.exports = {
  ASSETS,
  COLORS,
  FALLBACK,
  EMOJI_PRIORITY,
  emojiId,
  emojiName,
  e,
  ce,
  banner,
  bannerPath,
  hasBanner,
  bannerArt,
};
