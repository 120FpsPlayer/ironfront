'use strict';

/**
 * Chat filter (config.chatFilter) – no links in #chat, no swearing or slurs.
 *
 *   links      blocked in the channels listed in chatFilter.noLinks (default #chat) – GIFs (tenor, giphy) are fine
 *   slurs      racist / hateful words – blocked everywhere (chatFilter.slurs: "everywhere" | "public" | "off")
 *   profanity  swearing – blocked in public channels, not in tickets (chatFilter.profanity: same values)
 * Words come from src/lib/badwords.js (many languages) plus chatFilter.extraWords; chatFilter.allowedWords are let through.
 * The text is normalised first, so "sh1t", "k u r w a", "ｆｕｃｋ", "ᴋᴜʀᴡᴀ", "kurwą" and Cyrillic look-alikes are caught.
 * Staff, admins and bots are never filtered. A blocked message is deleted, the member gets a short notice that
 * disappears after a few seconds, and #automod-logs gets the details. chatFilter.strikes blocked messages within
 * chatFilter.strikeMinutes → a timeout of chatFilter.timeoutMinutes. Edited messages are checked too.
 */

const { PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const { isStaff } = require('../lib/permissions');
const { COLORS } = require('../lib/theme');
const { logEmbed, truncate, sendToChannel } = require('../lib/utils');
const { SLUR, PROFANITY, SAFE } = require('../lib/badwords');

const NOTICE_MS = 6000;
const settings = () => config.chatFilter ?? {};

// ── Normalising ──
const SMALL_CAPS = { ᴀ: 'a', ʙ: 'b', ᴄ: 'c', ᴅ: 'd', ᴇ: 'e', ꜰ: 'f', ɢ: 'g', ʜ: 'h', ɪ: 'i', ᴊ: 'j', ᴋ: 'k', ʟ: 'l', ᴍ: 'm', ɴ: 'n', ᴏ: 'o', ᴘ: 'p', ꞯ: 'q', ʀ: 'r', ꜱ: 's', ᴛ: 't', ᴜ: 'u', ᴠ: 'v', ᴡ: 'w', ʏ: 'y', ᴢ: 'z' };
const EXTRA = { ł: 'l', ß: 'ss', đ: 'd', ø: 'o', æ: 'ae', œ: 'oe', ı: 'i', ð: 'd', þ: 'th', ſ: 's' };
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '€': 'e' };
// Cyrillic read two ways: as Russian words (transliterated) and as Latin look-alikes ("сунт" → "cyht" isn't it, "nіgger" is).
const TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'i', є: 'e', ґ: 'g' };
const LOOKALIKE = { ...TRANSLIT, в: 'b', н: 'h', р: 'p', с: 'c', у: 'y', х: 'x', к: 'k', т: 't', м: 'm', ѕ: 's', ј: 'j', ԁ: 'd', α: 'a', β: 'b', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x' };

function base(text) {
  return String(text ?? '')
    .normalize('NFKC') // ｆｕｃｋ, 𝐟𝐮𝐜𝐤 → fuck
    .replace(/[​-‏⁠﻿­]/g, '')
    .replace(/[ᴀ-ᴢꜰꜱꞯɢɪʟɴʀʏʙʜ]/g, (c) => SMALL_CAPS[c] ?? c)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '') // ą → a, ö → o
    .replace(/[łßđøæœıðþſ]/g, (c) => EXTRA[c])
    .replace(/\*\*|__|~~|\|\||`+/g, ''); // markdown: **f**uck, ||kurwa||
}

/** The words of a message, each in every way it can be read. */
function tokens(text) {
  const out = new Set();
  const plain = base(text);
  for (const map of [TRANSLIT, LOOKALIKE]) {
    const s = plain.replace(/[Ѐ-ӿͰ-Ͽ]/g, (c) => map[c] ?? c).replace(/[0-9@$!€]/g, (c) => LEET[c] ?? c);
    const words = s.split(/[^a-z]+/).filter(Boolean);
    // "k u r w a", "f.u.c.k" – single letters in a row are one word
    let run = '';
    for (const w of [...words, '']) {
      if (w.length === 1) run += w;
      else {
        if (run.length >= 3) out.add(run);
        run = '';
      }
      if (w.length > 1) out.add(w);
    }
  }
  return [...out];
}

const collapse = (w) => w.replace(/(.)\1+/g, '$1');

/** Lists compiled once per config: { word: Set, prefix: [], contains: [] } per kind. */
let compiled = null;
let compiledFor = null;
function lists() {
  const cfg = settings();
  const key = JSON.stringify([cfg.extraWords ?? [], cfg.allowedWords ?? []]);
  if (compiled && compiledFor === key) return compiled;
  const clean = (w) => tokens(w)[0] ?? '';
  const extra = (cfg.extraWords ?? []).map(String);
  const make = (src, add = []) => ({
    word: new Set([...src.word, ...add.filter((w) => !w.endsWith('*')).map(clean)].filter(Boolean)),
    prefix: [...src.prefix, ...add.filter((w) => w.endsWith('*')).map((w) => clean(w.slice(0, -1)))].filter(Boolean),
    contains: [...src.contains],
  });
  compiled = {
    slur: make(SLUR),
    profanity: make(PROFANITY, extra),
    safe: [...SAFE, ...(cfg.allowedWords ?? []).map(clean)].filter(Boolean),
    allowed: new Set((cfg.allowedWords ?? []).map(clean).filter(Boolean)),
  };
  compiledFor = key;
  return compiled;
}

function hit(list, t) {
  const c = collapse(t);
  const same = (w) => t === w || (collapse(w).length >= 4 && c === collapse(w));
  for (const w of list.word) if (same(w)) return w;
  for (const w of list.prefix) if (t.startsWith(w) || (collapse(w).length >= 4 && c.startsWith(collapse(w)))) return w;
  for (const w of list.contains) if (t.includes(w) || c.includes(collapse(w))) return w;
  return null;
}

/** The first blocked word in the text: { term, kind: 'slur' | 'profanity' } or null. */
function findBadWord(text, { kinds = ['slur', 'profanity'] } = {}) {
  const L = lists();
  for (const t of tokens(text)) {
    if (L.allowed.has(t) || L.safe.some((s) => t.startsWith(s))) continue;
    for (const kind of kinds) {
      const term = hit(L[kind], t);
      if (term) return { term, kind };
    }
  }
  return null;
}

// ── Links ──
const TLDS = 'com|net|org|io|gg|ly|xyz|ru|pl|de|uk|eu|tk|ml|ga|cf|gq|info|biz|shop|store|online|site|link|app|dev|tv|cc|fun|live|club|top|vip|pro|su|ua|cz|sk|lt|lv|ee|ch|nl|fr|es|pt|ro|hu|gr|tr|cn|jp|kr|br|ar|mx|au|nz|gl|gd|ws|bz|lol|cx|ai|sx|click|gift|gifts|icu|cyou|monster|bar|win|bet|casino|page|space|website|tech|world|today|se|dk|fi|at|be|ca|us';
const LINK_PATTERNS = [
  /\b(?:h[tx]{2}ps?|ftp):\/\//i, // http://, hxxp://
  /\bwww\s*\.\s*[a-z0-9-]/i,
  /(?:discord(?:app)?\s*\.\s*com\s*\/\s*invite|discord\s*\.\s*(?:gg|io|me|li)|dsc\s*\.\s*gg)\s*\/\s*\w/i,
  new RegExp(`\\b[a-z0-9][a-z0-9-]*\\.(?:${TLDS})\\b(?![.-]\\w)`, 'i'), // example.com
  new RegExp(`\\b[a-z0-9][a-z0-9-]*(?:\\s+\\.\\s*|\\s*\\(dot\\)\\s*|\\s*\\[dot\\]\\s*|\\s+dot\\s+)(?:${TLDS})\\b`, 'i'), // example . com, example(dot)com
  /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\//, // 1.2.3.4/…
];
const GIFS = ['tenor.com', 'giphy.com'];

/** The first link in the text that isn't allowed, or null. */
function findLink(text, { allowGifs = true, allowedDomains = [] } = {}) {
  const allowed = [...(allowGifs ? GIFS : []), ...allowedDomains.map((d) => String(d).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))].filter(Boolean);
  let s = base(text);
  for (const d of allowed) {
    const host = d.replace(/[.]/g, '\\.');
    s = s.replace(new RegExp(`(?:https?:\\/\\/)?(?:[\\w-]+\\.)*${host}(?:\\/\\S*)?`, 'gi'), ' ');
  }
  for (const re of LINK_PATTERNS) {
    const m = s.match(re);
    if (m) return m[0];
  }
  return null;
}

// ── Messages ──
const strikes = new Map(); // "guild:user" → [timestamps]
const handled = new Set(); // message ids already removed

/** Members (the Member role, or everyone) can read it and it isn't a ticket. */
function isPublic(channel) {
  const parent = channel.isThread?.() ? channel.parent : channel;
  if (!parent || db.getTicket(parent.id)) return false;
  const role = channel.guild.roles.cache.get(db.roleId(channel.guild.id, 'member')) ?? channel.guild.roles.everyone;
  return Boolean(parent.permissionsFor?.(role)?.has(PermissionFlagsBits.ViewChannel));
}

function applies(mode, channel) {
  if (mode === 'off' || mode === false) return false;
  if (mode === 'public') return isPublic(channel);
  return true;
}

function noLinkChannel(channel) {
  const ids = (settings().noLinks ?? ['chat']).map((k) => db.channelId(channel.guild.id, k) ?? k);
  return ids.includes(channel.id) || (channel.isThread?.() && ids.includes(channel.parentId));
}

/** Why this message is blocked: { reason, notice, detail } or null. */
function verdict(message) {
  const cfg = settings();
  const channel = message.channel;
  const text = [message.content, ...(message.embeds ?? []).filter((e) => !e.data?.type || e.data.type === 'rich').map((e) => `${e.title ?? ''} ${e.description ?? ''}`)].join(' ');
  if (!text.trim()) return null;
  if (noLinkChannel(channel)) {
    const link = findLink(message.content ?? '', { allowGifs: cfg.allowGifs !== false, allowedDomains: cfg.allowedDomains ?? [] });
    if (link) return { reason: 'Link', notice: `links aren't allowed in <#${channel.id}>.`, detail: link };
  }
  const kinds = [];
  if (applies(cfg.slurs ?? 'everywhere', channel)) kinds.push('slur');
  if (applies(cfg.profanity ?? 'public', channel)) kinds.push('profanity');
  const bad = kinds.length ? findBadWord(text, { kinds }) : null;
  if (bad) return { reason: bad.kind === 'slur' ? 'Slur / hate speech' : 'Swearing', notice: bad.kind === 'slur' ? 'hate speech isn\'t tolerated here.' : 'please keep it clean – no swearing.', detail: bad.term };
  return null;
}

async function check(message) {
  if (!message?.guild || message.author?.bot || message.webhookId || message.system) return;
  if (settings().enabled === false || handled.has(message.id)) return;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isStaff(member)) return;
  const v = verdict(message);
  if (!v) return;
  handled.add(message.id);
  setTimeout(() => handled.delete(message.id), 60_000).unref?.();
  const guild = message.guild;
  const deleted = await message.delete().then(() => true, () => false);
  if (deleted) {
    const note = await message.channel.send({ content: `<@${member.id}>, ${v.notice}`, allowedMentions: { users: [member.id] } }).catch(() => null);
    if (note) setTimeout(() => note.delete().catch(() => null), NOTICE_MS).unref?.();
  }
  // Strikes → timeout
  const cfg = settings();
  const key = `${guild.id}:${member.id}`;
  const windowMs = (cfg.strikeMinutes ?? 10) * 60_000;
  const list = [...(strikes.get(key) ?? []).filter((t) => Date.now() - t < windowMs), Date.now()];
  strikes.set(key, list);
  let timedOut = false;
  if (cfg.strikes && list.length >= cfg.strikes && member.moderatable) {
    timedOut = await member.timeout((cfg.timeoutMinutes ?? 10) * 60_000, `Chat filter: ${list.length} blocked messages`).then(() => true, () => false);
    if (timedOut) strikes.delete(key);
  }
  const logId = db.channelId(guild.id, 'automodLogs') ?? db.settings(guild.id).logChannelId;
  await sendToChannel(guild, logId, {
    embeds: [
      logEmbed(COLORS.warning, `🧹 Chat filter – ${v.reason}`, member.user).addFields(
        { name: 'Member', value: `<@${member.id}>`, inline: true },
        { name: 'Channel', value: `<#${message.channel.id}>`, inline: true },
        { name: 'Caught', value: `||${truncate(v.detail, 100)}||`, inline: true },
        { name: 'Message', value: `\`\`\`${truncate(String(message.content ?? '').replace(/`/g, "'"), 900) || '—'}\`\`\`` },
        { name: 'Result', value: `${deleted ? 'Deleted' : '⚠️ Could not delete it – give the bot **Manage Messages**'}${timedOut ? ` · ⏳ timed out for ${cfg.timeoutMinutes ?? 10} min (${list.length} strikes)` : ` · strike ${list.length}/${cfg.strikes ?? '–'}`}` },
      ),
    ],
  }).catch(() => null);
}

hooks.on('messageCreate', (message) => check(message).catch((err) => console.warn('[chatfilter]', err.message)));
hooks.on('messageUpdate', async (before, after) => {
  if (!before.partial && before.content === after.content) return; // Discord added a link preview – nothing new
  const message = after.partial ? await after.fetch().catch(() => null) : after;
  if (message) await check(message).catch((err) => console.warn('[chatfilter]', err.message));
});

module.exports = { base, tokens, findBadWord, findLink, verdict, check, isPublic };
