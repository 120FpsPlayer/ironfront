'use strict';

/**
 * „Zaproś znajomego” on the website – the referral programme, for everybody: a friend downloads Hammer Launcher from
 * your link and buys Hammer+ → you get 7 days of Hammer+ for free (src/features/referrals.js gives them).
 *
 *   GET  /r/<code>                  a personal link: remembers who invited (cookie hs_ref, 30 days) → the launcher page
 *   GET  /api/shop/referrals        { signedIn, rewardDays, link, stats { invited, downloaded, bought, earned, balance },
 *                                   latest (the newest reward code that still works) }
 *   POST /api/shop/referrals/claim  { nick } – the days kept as a balance become a Hammer+ code for that Minecraft account
 *
 * A referral is recorded when somebody signs in with Discord on the site for the very first time with the cookie set
 * (onFirstSignIn). Against abuse: not yourself; only accounts that never signed in here before (nobody can be claimed
 * later); the friend's Discord account is at least 7 days old (read from its ID); one referrer per friend, for good.
 */

const store = require('./store');
const plusLib = require('../lib/plus');

const COOKIE = 'hs_ref';
const COOKIE_DAYS = 30;
const REWARD_DAYS = 7;
const MIN_ACCOUNT_DAYS = 7;
const DAY_MS = 86_400_000;
const DISCORD_EPOCH = 1_420_070_400_000n;

/** When a Discord account was made – its ID (a snowflake) carries the time. null when it is not one. */
function accountCreatedAt(id) {
  if (!/^\d{15,22}$/.test(String(id ?? ''))) return null;
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

/**
 * The very first sign-in of user on the site, with the hs_ref cookie's code → 'recorded', or why not: 'none' (no
 * known link), 'self', 'young' (the Discord account is less than 7 days old), 'taken' (already referred).
 */
function onFirstSignIn(user, code, now = Date.now()) {
  const referrer = store.referrerOf(code);
  if (!referrer) return 'none';
  if (referrer === String(user.id)) return 'self';
  const created = accountCreatedAt(user.id);
  if (created === null || now - created < MIN_ACCOUNT_DAYS * DAY_MS) return 'young';
  return store.addReferral(user.id, referrer, now) ? 'recorded' : 'taken';
}

/** /r/<code>: the code is remembered for 30 days (a newer link wins) and the visitor lands on the launcher page. */
function visit(res, code, h) {
  const known = store.referrerOf(code);
  return h.redirect(res, known ? '/launcher?invited=1' : '/launcher', known ? [h.cookie(COOKIE, String(code).toLowerCase(), COOKIE_DAYS * 86_400)] : []);
}

/** The reward code a page shows again – signed anew from what it was issued from, never stored. null without a key. */
function rewardCode(r) {
  if (!plusLib.ready()) return null;
  try {
    return plusLib.issue({ mc: r.mc, days: r.days, now: r.at, id: r.id });
  } catch {
    return null;
  }
}

/** What the page's referral card shows. publicUrl: the site's own address (the link is absolute when it is known). */
function pageJson(user, publicUrl = '', now = Date.now()) {
  if (!user) return { signedIn: false, rewardDays: REWARD_DAYS };
  const code = store.referralCode(user.id);
  const latest = [...(store.referralOf(user.id)?.rewards ?? [])].sort((a, b) => b.at - a.at)[0] ?? null;
  const exp = latest ? (latest.days ? Math.floor(latest.at / 1000) + latest.days * 86_400 : 0) : null;
  const live = latest && (exp === 0 || exp * 1000 > now);
  return {
    signedIn: true,
    rewardDays: REWARD_DAYS,
    link: `${publicUrl}/r/${code}`,
    stats: store.referralStats(user.id),
    latest: live ? { nick: latest.nick, days: latest.days, until: exp === 0 ? 0 : exp * 1000, code: rewardCode(latest) } : null,
    claimReady: plusLib.ready(),
  };
}

/** POST claim: the bot turns the balance into a code (hooks.claim) – the answer has the code for the page. */
async function claim(req, res, user, h) {
  if (h.limited(req, 'referral-claim', 10)) return h.fail(res, 429, 'Zbyt wiele prób – odczekaj minutę i spróbuj ponownie.');
  const body = await h.jsonBody(req);
  if (!(store.referralOf(user.id)?.balance > 0)) return h.fail(res, 409, 'Nie masz teraz dni Hammer+ do odebrania.');
  const granted = await h.claim(user, String(body.nick ?? '').trim().slice(0, 20));
  return h.send(res, 200, { ...granted, stats: store.referralStats(user.id) });
}

module.exports = { COOKIE, REWARD_DAYS, MIN_ACCOUNT_DAYS, accountCreatedAt, onFirstSignIn, visit, pageJson, claim, rewardCode };
