'use strict';

/**
 * Keeps data/db.json from growing with everyone who ever joined. Twice a day (first run 10 minutes after the
 * start) it removes records nothing reads any more:
 *   - personal welcome codes nobody used, 30 days after they expired (not while an order ticket still has the code)
 *   - welcomeCodes entries of members who have completed an order – the order alone rules out a second code
 *     (everyone else keeps theirs: it is what makes the welcome code once per member ever)
 *   - invite records of people who left and were invited by nobody – they count for no one
 * Sales, order counts, used codes, public and invite-reward codes, invite rewards, vouches and notes – everything
 * /sales, /customer, /promo and /invites show – are never touched.
 */

const db = require('../lib/db');
const hooks = require('../lib/hooks');

const DAY = 86_400_000;
const KEEP_EXPIRED_DAYS = 30;
const EVERY = 12 * 3_600_000;

// The fields features/invites.js writes – a record with anything else is left alone.
const INVITE_FIELDS = new Set(['inviterId', 'code', 'joinedAt', 'verified', 'verifiedAt', 'left', 'leftAt']);

const isWelcomeCode = (p) => Boolean(p.userId) && p.reason === 'welcome';

/** Cleans one server → how many records were removed: { codes, welcomeEntries, inviteRecords }. */
function prune(guildId, now = Date.now()) {
  const g = db.guild(guildId);
  // Codes of orders that may still be completed (open, or closed and reopened later).
  const inOrders = new Set(db.tickets((t) => t.guildId === guildId && t.status !== 'deleted' && !t.completedAt && t.order?.promo).map((t) => t.order.promo));
  const dead = (p) => isWelcomeCode(p) && !p.uses?.length && p.expiresAt && now - p.expiresAt > KEEP_EXPIRED_DAYS * DAY && !inOrders.has(p.code);
  const codes = g.promos.filter(dead).length;
  if (codes) g.promos = g.promos.filter((p) => !dead(p));

  let welcomeEntries = 0;
  for (const userId of Object.keys(g.welcomeCodes ?? {})) {
    if ((g.orders[userId] ?? 0) > 0) {
      delete g.welcomeCodes[userId];
      welcomeEntries += 1;
    }
  }

  let inviteRecords = 0;
  const members = g.invites?.members ?? {};
  for (const [id, r] of Object.entries(members)) {
    if (r?.left && !r.inviterId && Object.keys(r).every((k) => INVITE_FIELDS.has(k))) {
      delete members[id];
      inviteRecords += 1;
    }
  }

  const removed = { codes, welcomeEntries, inviteRecords };
  if (codes + welcomeEntries + inviteRecords) db.save();
  return removed;
}

function run(client, now = Date.now()) {
  for (const guildId of db.allGuildIds()) {
    const { codes, welcomeEntries, inviteRecords } = prune(guildId, now);
    if (!codes && !welcomeEntries && !inviteRecords) continue;
    const name = client?.guilds?.cache?.get(guildId)?.name ?? guildId;
    console.log(`[housekeeping] ${name}: removed ${codes} expired welcome codes, ${welcomeEntries} welcome-code entries of customers and ${inviteRecords} invite records of people who left.`);
  }
}

hooks.every('housekeeping', EVERY, (client) => run(client), 10 * 60_000);

module.exports = { KEEP_EXPIRED_DAYS, prune, run };
