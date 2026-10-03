'use strict';

/**
 * How channel and category names look on the server.
 *
 * Names in layout.js are plain ("📦 how-to-buy", "🛒 SHOP"). config.json → server turns them into the style:
 *   channelStyle  "{emoji}┃{name}"  + smallCaps → 📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ
 *   categoryStyle "〔 {name} 〕"                 → 〔 🛒 SHOP 〕
 * Change the style there and run /build only:names to rename an existing server.
 */

const config = require('../lib/config');

const SMALL_CAPS = {
  a: 'ᴀ', b: 'ʙ', c: 'ᴄ', d: 'ᴅ', e: 'ᴇ', f: 'ꜰ', g: 'ɢ', h: 'ʜ', i: 'ɪ', j: 'ᴊ', k: 'ᴋ', l: 'ʟ', m: 'ᴍ',
  n: 'ɴ', o: 'ᴏ', p: 'ᴘ', q: 'ǫ', r: 'ʀ', s: 'ꜱ', t: 'ᴛ', u: 'ᴜ', v: 'ᴠ', w: 'ᴡ', x: 'x', y: 'ʏ', z: 'ᴢ',
};

/** "how-to-buy" → "ʜᴏᴡ-ᴛᴏ-ʙᴜʏ" (only a–z change; digits, emojis and symbols stay). */
const smallCaps = (text) => String(text).replace(/[a-z]/gi, (c) => SMALL_CAPS[c.toLowerCase()]);

const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** "📦 how-to-buy" → { emoji: "📦", label: "how-to-buy" }; a name without a leading emoji → { emoji: "", label }. */
function splitEmoji(name) {
  const text = String(name).trim();
  const m = /^(\S+)\s+(.+)$/u.exec(text);
  return m && EMOJI.test(m[1]) ? { emoji: m[1], label: m[2] } : { emoji: '', label: text };
}

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (all, key) => (key in values ? values[key] : all));

/** Plain layout name → channel name in the server's style. */
function channelName(name) {
  const { emoji, label } = splitEmoji(name);
  const text = config.server.smallCaps === false ? label : smallCaps(label);
  if (!emoji) return text.slice(0, 100);
  return fill(config.server.channelStyle, { emoji, name: text }).trim().slice(0, 100);
}

/** Plain layout name → category name in the server's style. */
const categoryName = (name) => fill(config.server.categoryStyle, { name: String(name).trim() }).trim().slice(0, 100);

/** "〔 🎫 TICKETS 〕" + 2 → "〔 🎫 TICKETS 2 〕" – the number goes inside the style, if the name uses it. */
function numberedCategoryName(name, n) {
  const after = config.server.categoryStyle.split('{name}')[1] ?? '';
  const end = after.trim();
  if (end && name.endsWith(end) && name.length > end.length) {
    const inner = name.slice(0, -end.length).trimEnd();
    const gap = after.startsWith(' ') ? ' ' : '';
    return `${inner} ${n}${gap}${end}`.slice(0, 100);
  }
  return `${name} ${n}`.slice(0, 100);
}

/** What Discord makes of a text channel name: lowercase, spaces become dashes. */
const textChannelName = (name) => String(name).toLowerCase().replace(/\s+/g, '-');

/** Discord drops emoji variation selectors and joiners (U+FE0E, U+FE0F, U+200D) from channel names. */
const bareName = (name) => String(name).replace(/[\uFE0E\uFE0F\u200D]/g, '');

/** True when a channel already has this name, the way Discord stores it. */
const sameChannelName = (current, wanted) => bareName(current) === bareName(wanted);

module.exports = { smallCaps, splitEmoji, channelName, categoryName, numberedCategoryName, textChannelName, bareName, sameChannelName };
