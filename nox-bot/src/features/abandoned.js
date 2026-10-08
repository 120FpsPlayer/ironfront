'use strict';

/**
 * Abandoned orders (config.abandonedOrders: { enabled, afterHours: 24, percent: 5, validDays: 3 }).
 * Every 10 minutes: order tickets that were CLOSED without being completed and without a payment (status
 * "awaiting" – not paid with balance, no Pay / crypto transaction, not a balance top-up) more than afterHours ago
 * get ONE personal single-use code by DM ("COMEBACK-…", percent off, valid validDays) with a "Back to the shop"
 * button – as long as the owner has placed no newer order, completed no order since, isn't blacklisted and got no
 * such code in the last 30 days. Tickets closed long ago (more than afterHours + 7 days) are left alone, so turning
 * this on doesn't message everyone who ever left an order.
 *
 * g.abandoned = { [ticketChannelId]: { userId, sentAt, code } } – code is null when the DM couldn't be delivered
 * (the code is deleted again, the ticket is not tried again and it doesn't count towards the 30 days).
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const promos = require('./promos');
const { e, ce, COLORS } = require('../lib/theme');
const { pad, ts, truncate } = require('../lib/utils');
const { container, text, divider, linkBtn, row, header, v2, channelUrl } = require('../lib/v2');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CHECK_EVERY = 10 * MINUTE;
const ONCE_PER = 30 * DAY; // one comeback code per member per 30 days
const LOOK_BACK = 7 * DAY; // tickets closed longer ago than afterHours + 7 days are never messaged

const num = (value, fallback, min = 0) => (Number.isFinite(Number(value)) && value !== null && value !== '' && Number(value) >= min ? Number(value) : fallback);

function settings() {
  const c = config.abandonedOrders ?? {};
  return {
    enabled: c.enabled !== false && config.promos?.enabled !== false,
    after: num(c.afterHours, 24) * HOUR,
    percent: Math.min(100, Math.max(1, Math.round(num(c.percent, 5, 1)))),
    days: num(c.validDays, 3, 1),
  };
}

/** Closed without being completed, and nothing was paid (or is being checked). */
function unpaidAndClosed(t) {
  const o = t.order;
  if (t.typeId !== 'order' || !o || t.status === 'open' || !t.closedAt || t.completedAt) return false;
  if ((o.status ?? 'awaiting') !== 'awaiting') return false;
  if (o.paidWith === 'balance' || o.topUp || o.crypto?.txid) return false;
  return !(o.payment && typeof o.payment === 'object');
}

/** Has the member come back on their own – a newer order, or a completed order since this one? */
function cameBack(g, guildId, t) {
  const since = t.createdAt ?? t.closedAt;
  const orders = db.tickets((x) => x.guildId === guildId && x.ownerId === t.ownerId && x.typeId === 'order' && x.channelId !== t.channelId);
  if (orders.some((x) => (x.createdAt ?? 0) > since || (x.completedAt ?? 0) > since || (x.status === 'open' && !x.completedAt))) return true;
  return g.sales.some((s) => s.userId === t.ownerId && (s.completedAt ?? s.createdAt ?? 0) > since);
}

/** When this member last got a comeback code (0 = never). */
const lastCode = (g, userId) => Math.max(0, ...Object.values(g.abandoned).filter((a) => a.userId === userId && a.code).map((a) => a.sentAt ?? 0));

/** The tickets of this server that get a code now – one per member, the latest closed first. */
function dueTickets(guildId, now = Date.now(), opts = settings()) {
  const g = db.guild(guildId);
  const seen = new Set();
  return db
    .tickets((t) => t.guildId === guildId && unpaidAndClosed(t))
    .filter((t) => now - t.closedAt >= opts.after && now - t.closedAt <= opts.after + LOOK_BACK && !g.abandoned[t.channelId])
    .sort((a, b) => b.closedAt - a.closedAt)
    .filter((t) => {
      if (seen.has(t.ownerId)) return false;
      seen.add(t.ownerId);
      return !db.isBlacklisted(guildId, t.ownerId) && now - lastCode(g, t.ownerId) >= ONCE_PER && !cameBack(g, guildId, t);
    });
}

function comebackCard(guild, ticket, promo) {
  const c = container(COLORS.brand);
  const product = truncate(ticket.order?.product ?? 'your order', 120);
  header(
    c,
    `## ${e(guild, 'cart')} Still thinking about it?\n` +
      `Your order **${product}** (\`#${pad(ticket.number)}\`) at **${config.brand.name}** was closed before it was paid. ` +
      `Here's **${promos.label(promo)}** your next order – just for you:`,
    guild.iconURL?.({ size: 128 }),
  );
  c.addTextDisplayComponents(text(`# \`${promo.code}\``));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      '> Click **Buy** on any product and paste the code into the **Promo code** field – the discount comes off your total.\n' +
        `-# Valid until ${ts(promo.expiresAt, 'f')} (${ts(promo.expiresAt, 'R')}) · only for your account · one use`,
    ),
  );
  const shopId = db.channelId(guild.id, 'shop');
  const url = shopId ? channelUrl(guild.id, shopId) : `https://discord.com/channels/${guild.id}`;
  c.addActionRowComponents(row(linkBtn(url, 'Back to the shop', ce(guild, 'cart'))));
  return v2(c);
}

/** One ticket: claim it first (so a slow DM is never sent twice), create the code, DM it → the promo or null. */
async function sendCode(guild, ticket, opts = settings(), now = Date.now()) {
  const g = db.guild(guild.id);
  if (g.abandoned[ticket.channelId]) return null;
  g.abandoned[ticket.channelId] = { userId: ticket.ownerId, sentAt: now, code: null };
  db.save();
  const user = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  if (!user) return null;
  const promo = promos.personal(guild.id, ticket.ownerId, { percent: opts.percent, days: opts.days, prefix: 'COMEBACK', reason: `abandoned order #${pad(ticket.number)}` });
  const delivered = await user
    .send(comebackCard(guild, ticket, promo))
    .then(() => true)
    .catch(() => false);
  if (!delivered) {
    promos.remove(guild.id, promo.code); // DMs closed – nobody can see the code
    return null;
  }
  g.abandoned[ticket.channelId].code = promo.code;
  db.save();
  return promo;
}

/** One run over every available server → how many codes were sent. */
async function sweep(client, now = Date.now()) {
  const opts = settings();
  if (!opts.enabled) return 0;
  let sent = 0;
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || guild.available === false) continue; // a Discord outage – try again on the next run
    for (const t of dueTickets(guildId, now, opts)) {
      if (await sendCode(guild, t, opts, now).catch((err) => console.warn('[abandoned]', err.message))) sent += 1;
    }
  }
  if (sent) console.log(`[abandoned] sent ${sent} comeback code${sent === 1 ? '' : 's'}`);
  return sent;
}

hooks.every('abandonedOrders', CHECK_EVERY, (client) => sweep(client), 2 * MINUTE);

module.exports = { settings, unpaidAndClosed, dueTickets, comebackCard, sendCode, sweep };
