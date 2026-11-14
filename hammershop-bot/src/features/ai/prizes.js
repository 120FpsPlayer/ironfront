'use strict';

/**
 * Giveaway prizes for the AI assistant: which giveaways the ticket's author won and handing out the prize.
 *
 * Everything here acts on one user – the ticket's owner, taken from the ticket record by the caller, never from what
 * the model or a user wrote. A prize is handed out only when the server-side checks pass: the user is in the
 * giveaway's winners, the giveaway has ended and the prize wasn't claimed yet.
 *
 * Claims are written on the giveaway record (data/db.json → giveaways[id].claims):
 *   claims[userId] = { status: 'granted' | 'reported', at, ticket (channel ID), codeId?, nick?, days?, reason? }
 *     granted  – a Hammer+ code was issued (the code itself is never stored – src/features/hammerplus.js)
 *     reported – any other prize (or a Hammer+ whose length isn't clear, or a late claim) – handed to the team
 *
 * Hammer+ length: gw.plusDays (the /giveaway start option, 0 = forever) – or, for older giveaways, read from the prize
 * text ("Hammer+ 30 dni", "Hammer+ na zawsze", "Hammer+ na miesiąc"). When that is not clear, nothing is guessed.
 */

const db = require('../../lib/db');
const giveaways = require('../giveaways');
const hammerplus = require('../hammerplus');
const plus = require('../../lib/plus');

const CLAIM_WINDOW_MS = 48 * 3_600_000; // the winners' card says: claim within 48 hours
const MONTH = 30;
const YEAR = 365;

/** "Hammer+ na miesiąc" → "hammer+ na miesiac" – lowercase, no Polish letters. */
const fold = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');

const PLUS = /hammer\s*\+|hammer\s*plus|hammerplus|(?:^|[^a-z0-9])h\+/;
// Anything else in the prize text (Nitro, money, cards…) makes it a prize for the team, even next to Hammer+.
const OTHER = /nitro|paysafe|\bpsc\b|blik|\bzl\b|\bpln\b|€|\$|\busd\b|\beur\b|robux|steam|v-?bucks|gift ?card|karta|premium|vip|pieniadz|kasa|gotowk/;
const FOREVER = /na zawsze|na stale|dozywotn|lifetime|permanent|forever|bez limitu/;
const UNIT = /(\d{1,4})\s*-?\s*(dni|dzien|dnia|days?|d|tygodni\w*|tydzien|tyg\.?|weeks?|miesiac\w*|miesiec\w*|mies\.?|mc|m-c|months?|lat\w*|rok\w*|years?)(?![a-z])/g;

function unitDays(n, unit) {
  if (/^(dni|dzien|dnia|days?|d)$/.test(unit)) return n;
  if (/^(tydz|tyg|week)/.test(unit)) return n * 7;
  if (/^(mies|mc|m-c|month)/.test(unit)) return n * MONTH;
  if (/^(rok|lat|year)/.test(unit)) return n * YEAR;
  return null;
}

/**
 * What a prize text means → { kind: 'plus', days } (0 = forever) | { kind: 'plus-unknown' } (Hammer+, but how long is
 * not clear) | { kind: 'other' }. Several different lengths, a mixed prize or no length at all are never guessed.
 */
function parsePrize(text) {
  const t = fold(text);
  if (!PLUS.test(t)) return { kind: 'other' };
  if (OTHER.test(t)) return { kind: 'plus-unknown' };
  const found = new Set();
  if (FOREVER.test(t)) found.add(0);
  for (const m of t.matchAll(UNIT)) {
    const days = unitDays(Number(m[1]), m[2]);
    if (days !== null) found.add(days);
  }
  if (/(?:^|[^a-z0-9])(?:na )?tydzien(?![a-z])/.test(t)) found.add(7);
  if (/(?:^|[^a-z0-9])(?:na )?miesiac(?![a-z])/.test(t)) found.add(MONTH);
  if (/(?:^|[^a-z0-9])(?:na )?rok(?![a-z])/.test(t) && !/pol roku/.test(t)) found.add(YEAR);
  if (found.size !== 1) return { kind: 'plus-unknown' };
  const days = [...found][0];
  if (!(days >= 0 && days <= hammerplus.MAX_DAYS) || (days === 0 && !FOREVER.test(t))) return { kind: 'plus-unknown' };
  return { kind: 'plus', days };
}

/** The prize of a giveaway: the explicit Hammer+ length from /giveaway start wins over the prize text. */
function prizeOf(gw) {
  if (Number.isInteger(gw.plusDays) && gw.plusDays >= 0 && gw.plusDays <= hammerplus.MAX_DAYS) return { kind: 'plus', days: gw.plusDays };
  return parsePrize(gw.prize);
}

const plusLength = (days) => (days === 0 ? 'na zawsze' : `${days} ${days === 1 ? 'dzień' : 'dni'}`);

function describePrize(prize) {
  if (prize.kind === 'plus') return `Hammer+ ${plusLength(prize.days)} – bot wydaje kod od razu`;
  if (prize.kind === 'plus-unknown') return 'Hammer+, ale długość nie jest jasna – wyda zespół';
  return 'inna nagroda – wydaje zespół';
}

/** Until when this winner can claim (48 h from the draw – a reroll counts from the reroll). */
const claimDeadline = (gw, userId) => (gw.wonAt?.[userId] ?? gw.endsAt) + CLAIM_WINDOW_MS;

const date = (ms) => new Date(ms).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' });

function claimStatus(gw, userId, now = Date.now()) {
  const claim = gw.claims?.[userId];
  if (claim?.status === 'granted') return `odebrana ${date(claim.at)} – kod Hammer+ dla konta ${claim.nick} został wystawiony`;
  if (claim?.status === 'reported') return `zgłoszona zespołowi ${date(claim.at)} – zespół wyda ją ręcznie`;
  if (now > claimDeadline(gw, userId)) return 'minął czas na odbiór (48 h) – o wydaniu decyduje zespół';
  return 'do odebrania';
}

/** The ticket owner's giveaways – what the moje_wygrane tool returns. */
function winsOverview(guildId, userId, now = Date.now()) {
  const list = giveaways.all(guildId).sort((a, b) => b.endsAt - a.endsAt);
  const won = list.filter((g) => g.ended && g.winners.includes(userId));
  return {
    wygrane: won.map((g) => ({
      id: g.id,
      nagroda: g.prize,
      rodzaj: describePrize(prizeOf(g)),
      zakonczony: date(g.endsAt),
      odbior_do: date(claimDeadline(g, userId)),
      status: claimStatus(g, userId, now),
    })),
    bierze_udzial: list.filter((g) => !g.ended && g.entries.includes(userId)).map((g) => ({ id: g.id, nagroda: g.prize, koniec: date(g.endsAt) })),
    ostatnie_bez_wygranej: list
      .filter((g) => g.ended && g.entries.includes(userId) && !g.winners.includes(userId))
      .slice(0, 5)
      .map((g) => ({ id: g.id, nagroda: g.prize, zakonczony: date(g.endsAt) })),
  };
}

const claiming = new Set(); // "giveawayId:userId" while a claim is being handed out – no double claims in parallel

function recordClaim(gw, userId, claim) {
  gw.claims = { ...(gw.claims ?? {}), [userId]: claim };
  db.save();
}

/**
 * Hands out the prize of giveaway `giveawayId` to `userId` (the ticket owner). Never throws for the user's mistakes.
 * → { result, ... } where result is:
 *   'not-found' | 'not-ended' | 'not-winner' | 'already' (with claim) | 'busy' | 'need-nick' | 'bad-nick' (with error)
 *   'granted'  – { code, record, days, gw } – a Hammer+ code was issued (the caller posts it and syncs the role)
 *   'reported' – { gw, why: 'other' | 'unknown-length' | 'late' | 'no-key' } – the team has to hand it out
 * botId: who issued the code (the bot's own user ID – /hammerplus list shows it).
 */
async function claim({ guildId, userId, giveawayId, nick, botId = null, channelId = null, now = Date.now() }) {
  const id = String(giveawayId ?? '').trim();
  const gw = id ? giveaways.find(guildId, id) : null;
  if (!gw) return { result: 'not-found' };
  if (!gw.ended) return { result: 'not-ended', gw };
  if (!gw.winners.includes(userId)) return { result: 'not-winner', gw };
  if (gw.claims?.[userId]) return { result: 'already', gw, claim: gw.claims[userId] };
  const key = `${gw.id}:${userId}`;
  if (claiming.has(key)) return { result: 'busy', gw };
  claiming.add(key);
  try {
    const report = (why) => {
      recordClaim(gw, userId, { status: 'reported', at: now, ticket: channelId, reason: why });
      return { result: 'reported', gw, why };
    };
    if (now > claimDeadline(gw, userId)) return report('late');
    const prize = prizeOf(gw);
    if (prize.kind === 'other') return report('other');
    if (prize.kind === 'plus-unknown') return report('unknown-length');
    if (!plus.ready()) return report('no-key');
    const name = String(nick ?? '').trim();
    if (!name) return { result: 'need-nick', gw };
    let account;
    try {
      account = await hammerplus.lookup(name); // Mojang – the nick must be a real Java Edition account
    } catch (err) {
      return { result: 'bad-nick', gw, error: err.message };
    }
    if (gw.claims?.[userId]) return { result: 'already', gw, claim: gw.claims[userId] }; // claimed in the meantime
    const { code, record } = hammerplus.grantKnown(guildId, { ...account, days: prize.days, by: botId, source: 'giveaway', discordId: userId, now });
    recordClaim(gw, userId, { status: 'granted', at: now, ticket: channelId, codeId: record.id, nick: record.nick, days: prize.days });
    return { result: 'granted', gw, code, record, days: prize.days };
  } finally {
    claiming.delete(key);
  }
}

module.exports = { parsePrize, prizeOf, plusLength, describePrize, claimDeadline, claimStatus, winsOverview, claim, CLAIM_WINDOW_MS };
