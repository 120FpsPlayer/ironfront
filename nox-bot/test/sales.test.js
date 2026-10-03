'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const sales = require('../src/features/salesreport');

const commands = loadCommands();

let n = 950000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const at = (iso) => Date.parse(iso);
const SELLER = uid();

async function newGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

let saleNo = 0;
/** A SALE as the orders work records it (src/lib/db.js) – completed at `when`. */
function addSale(guild, when, patch = {}) {
  saleNo += 1;
  return db.addSale(guild.id, {
    id: `S-${String(saleNo).padStart(4, '0')}`,
    ticketNumber: saleNo,
    channelId: uid(),
    userId: uid(),
    sellerId: SELLER,
    productId: null,
    product: 'Nitro Boost',
    quantity: 1,
    amount: 10,
    currency: '€',
    method: 'PaysafeCard',
    promo: null,
    discount: 0,
    createdAt: when - 60_000,
    completedAt: when,
    ...patch,
  });
}

const salesCmd = async (guild, who, options = {}) => {
  const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'sales', options });
  await handle(i, commands);
  return i;
};

/** Runs fn with another shop time zone. */
function withTimezone(tz, fn) {
  const before = config.workingHours.timezone;
  config.workingHours.timezone = tz;
  try {
    return fn();
  } finally {
    config.workingHours.timezone = before;
  }
}

/** Like a restart: the in-memory data is dropped and read back from data/db.json. */
function restart() {
  db.flush();
  db._reset();
  db.load();
}

// ───────────── Period maths ─────────────

test('periods start at local midnight in the shop time zone (Europe/Warsaw) and compare with the same span before', () => {
  assert.equal(sales.timezone(), 'Europe/Warsaw');
  const now = at('2026-10-03T00:30:00+02:00'); // 22:30 UTC on Oct 2 – already Oct 3 in Warsaw

  const today = sales.periodRange('today', now);
  assert.equal(today.from, at('2026-10-03T00:00:00+02:00'));
  assert.equal(today.to, now + 1, 'up to and including now');
  assert.deepEqual(today.prev, { from: at('2026-10-02T00:00:00+02:00'), to: at('2026-10-02T00:30:00+02:00') + 1 }, 'yesterday up to the same time');

  const week = sales.periodRange('7d', now);
  assert.equal(week.from, at('2026-09-27T00:00:00+02:00'), 'today + the 6 days before');
  assert.equal(week.prev.from, at('2026-09-20T00:00:00+02:00'));
  assert.equal(week.prev.to, at('2026-09-26T00:30:00+02:00') + 1);

  const month = sales.periodRange('30d', now);
  assert.equal(month.from, at('2026-09-04T00:00:00+02:00'));
  assert.equal(month.prev.from, at('2026-08-05T00:00:00+02:00'));

  const all = sales.periodRange('all', now);
  assert.equal(all.from, 0);
  assert.equal(all.prev, null, 'no comparison for all time');
  assert.equal(sales.periodRange('nonsense', now).key, '7d', 'unknown period → last 7 days');
});

test('days stay calendar days when the clocks change (25-hour and 23-hour days)', () => {
  // Summer time ends on 25 Oct 2026 (CEST +02:00 → CET +01:00)
  const after = at('2026-10-27T12:00:00+01:00');
  assert.equal(sales.dayStart(after), at('2026-10-27T00:00:00+01:00'));
  const week = sales.periodRange('7d', after);
  assert.equal(week.from, at('2026-10-21T00:00:00+02:00'), 'still summer time 6 days ago');
  assert.equal(week.prev.from, at('2026-10-14T00:00:00+02:00'));
  assert.equal(week.prev.to, at('2026-10-20T12:00:00+02:00') + 1, 'same wall-clock time a week before');
  assert.equal(sales.addDays(at('2026-10-25T00:00:00+02:00'), 1), at('2026-10-26T00:00:00+01:00'), '25-hour day');
  // Summer time starts on 29 Mar 2026
  assert.equal(sales.addDays(at('2026-03-29T00:00:00+01:00'), 1), at('2026-03-30T00:00:00+02:00'), '23-hour day');
  assert.equal(sales.dayStart(at('2026-03-29T12:00:00+02:00')), at('2026-03-29T00:00:00+01:00'));
  // Month and year boundaries
  assert.equal(sales.addDays(at('2026-01-01T00:00:00+01:00'), -1), at('2025-12-31T00:00:00+01:00'));
  assert.equal(sales.dateKey(at('2026-02-28T23:30:00Z')), '2026-03-01', 'already 1 March in Warsaw');
});

test('a sale at 23:59 local time belongs to that day – in the shop time zone, not in UTC', async () => {
  const guild = await newGuild();
  addSale(guild, at('2026-10-02T23:59:59+02:00'), { amount: 10 }); // 21:59 UTC
  addSale(guild, at('2026-10-03T00:00:00+02:00'), { amount: 20 }); // 22:00 UTC – still Oct 2 in UTC
  const now = at('2026-10-03T12:00:00+02:00');

  const today = sales.summarize(guild.id, sales.periodRange('today', now));
  assert.equal(today.orders, 1);
  assert.equal(today.revenue, 20);
  const yesterday = sales.summarize(guild.id, { from: at('2026-10-02T00:00:00+02:00'), to: at('2026-10-03T00:00:00+02:00') });
  assert.equal(yesterday.revenue, 10);

  withTimezone('UTC', () => {
    assert.equal(sales.summarize(guild.id, sales.periodRange('today', now)).orders, 0, 'both sales were on Oct 2 in UTC');
  });
  withTimezone('America/New_York', () => {
    // 12:00 in Warsaw = 06:00 in New York; the New York day began at 06:00 Warsaw time
    assert.equal(sales.periodRange('today', now).from, at('2026-10-03T00:00:00-04:00'));
    assert.equal(sales.summarize(guild.id, sales.periodRange('today', now)).orders, 0);
  });
  withTimezone('Mars/Olympus_Mons', () => assert.equal(sales.timezone(), 'UTC', 'unknown time zone → UTC'));
});

// ───────────── Numbers and the card ─────────────

test('change vs the previous period of the same length (±%), average and unknown amounts', async () => {
  const guild = await newGuild();
  const now = at('2026-10-03T18:00:00+02:00');
  // The 7 days before: Sep 20 00:00 – Sep 26 18:00
  addSale(guild, at('2026-09-20T10:00:00+02:00'), { amount: 20 });
  addSale(guild, at('2026-09-26T17:59:00+02:00'), { amount: 20 });
  addSale(guild, at('2026-09-26T19:00:00+02:00'), { amount: 500 }); // after "the same time" – not compared
  addSale(guild, at('2026-09-19T23:59:00+02:00'), { amount: 500 }); // before both periods
  // Last 7 days: Sep 27 00:00 – now
  addSale(guild, at('2026-09-27T01:00:00+02:00'), { amount: 30 });
  addSale(guild, at('2026-10-03T12:00:00+02:00'), { amount: null });
  addSale(guild, at('2026-10-03T17:00:00+02:00'), { amount: 30 });

  const range = sales.periodRange('7d', now);
  const cur = sales.summarize(guild.id, range);
  const prev = sales.summarize(guild.id, range.prev);
  assert.deepEqual([cur.orders, cur.revenue, cur.known, cur.unknown, cur.average], [3, 60, 2, 1, 30]);
  assert.deepEqual([prev.orders, prev.revenue], [2, 40]);

  assert.equal(sales.change(60, 40), 50);
  assert.equal(sales.change(30, 40), -25);
  assert.equal(sales.change(5, 0), null);
  assert.equal(sales.changeText(60, 40), '📈 +50%');
  assert.equal(sales.changeText(30, 40), '📉 −25%');
  assert.equal(sales.changeText(40, 40), '➖ ±0%');
  assert.equal(sales.changeText(5, 0), '📈 up');
  assert.equal(sales.changeText(0, 0), '➖ ±0%');

  const card = textOf(sales.salesCard(guild, range));
  assert.match(card, /Sales · Last 7 days/);
  assert.match(card, /27 Sep – 3 Oct 2026 · days in Europe\/Warsaw/);
  assert.match(card, /Revenue: 60€/);
  assert.match(card, /📈 \+50% vs the 7 days before \(40€\)/);
  assert.match(card, /\*\*Orders:\*\* 3 .*📈 \+50% \(2 before\)/);
  assert.match(card, /\*\*Average order:\*\* 30€/);
  assert.match(card, /1 order without a known amount isn't counted/);
});

test('sales card: top 5 products, sellers, payment methods, discounts and promo codes', async () => {
  const guild = await newGuild();
  const now = at('2026-10-03T18:00:00+02:00');
  const day = (h) => now - h * 3_600_000;
  db.guild(guild.id).products.push({ id: 'p-nitro', name: 'Nitro Boost (1 month)', price: '10' });
  const seller2 = uid();
  addSale(guild, day(1), { productId: 'p-nitro', product: 'Nitro (old name)', amount: 9, promo: 'NOX10', discount: 1 });
  addSale(guild, day(2), { productId: 'p-nitro', product: 'Nitro (old name)', amount: 9, promo: 'NOX10', discount: 1, sellerId: seller2 });
  addSale(guild, day(3), { productId: 'p-nitro', amount: 10, method: 'paypal please', sellerId: seller2 });
  addSale(guild, day(4), { product: 'Spotify Premium', amount: 50, method: 'Crypto (BTC)', promo: 'SPRING', discount: 5 });
  for (const [i, name] of ['Netflix', 'Disney+', 'YouTube Premium', 'Canva Pro'].entries()) addSale(guild, day(5 + i), { product: name, amount: 4 - i, method: i ? 'bank transfer' : null });

  const s = sales.summarize(guild.id, sales.periodRange('today', now));
  assert.deepEqual(s.products.map((p) => [p.name, p.orders, p.revenue]).slice(0, 3), [
    ['Spotify Premium', 1, 50],
    ['Nitro Boost (1 month)', 3, 28], // grouped by product ID, current catalog name
    ['Netflix', 1, 4],
  ]);
  assert.deepEqual(s.sellers.map((x) => [x.key, x.orders, x.revenue]), [[SELLER, 6, 69], [seller2, 2, 19]]);
  assert.deepEqual(s.methods.map((m) => [m.name, m.orders]), [['Crypto', 1], ['PaysafeCard', 2], ['PayPal', 1], ['Other', 3], ['Not given', 1]]);
  assert.deepEqual([s.discount, s.discounted], [7, 3]);
  assert.deepEqual(s.promos, [{ code: 'NOX10', uses: 2, discount: 2 }, { code: 'SPRING', uses: 1, discount: 5 }]);

  const card = textOf(sales.salesCard(guild, sales.periodRange('today', now)));
  assert.match(card, /🥇 \*\*Spotify Premium\*\*  ·  1 order · 50€/);
  assert.match(card, /🥈 \*\*Nitro Boost \(1 month\)\*\*  ·  3 orders · 28€/);
  assert.doesNotMatch(card, /Canva Pro/, 'only the top 5 products');
  assert.match(card, new RegExp(`🥇 <@${SELLER}>  ·  6 orders · 69€`));
  assert.match(card, /\*\*PayPal\*\*  ·  1 order · 10€/);
  assert.match(card, /\*\*7€\*\* given on \*\*3 orders\*\*/);
  assert.match(card, /`NOX10`  ·  2 uses · −2€/);
  assert.match(card, /`SPRING`  ·  1 use · −5€/);
});

test('sales card stays within Discord limits with long names, many products, sellers and codes', async () => {
  const guild = await newGuild();
  const now = Date.now();
  for (let i = 0; i < 300; i += 1) {
    addSale(guild, now - i * 60_000, { product: `${'P'.repeat(95)}${i}`, sellerId: uid(), promo: `CODE${'X'.repeat(18)}${i}`, discount: 1.5, method: `${'m'.repeat(60)}${i}`, amount: i % 7 ? 1234567.89 : null });
  }
  for (const period of Object.keys(sales.PERIODS)) {
    const r = validateMessage(sales.salesCard(guild, sales.periodRange(period, now)), guild);
    assert.ok(r.total <= 40 && r.textLength <= 4000, period);
  }
});

test('empty state: no sales yet / none in this period (with the period before)', async () => {
  const guild = await newGuild();
  const now = at('2026-10-03T18:00:00+02:00');
  const empty = textOf(sales.salesCard(guild, sales.periodRange('all', now)));
  assert.match(empty, /No sales yet/);
  assert.match(empty, /Order completed/);
  assert.doesNotMatch(empty, /Revenue/);

  addSale(guild, at('2026-09-22T12:00:00+02:00'), { amount: 15 });
  const week = textOf(sales.salesCard(guild, sales.periodRange('7d', now)));
  assert.match(week, /No sales in this period/);
  assert.match(week, /The 7 days before: 1 order · 15€/);
  validateMessage(sales.salesCard(guild, sales.periodRange('today', now)), guild);
});

// ───────────── /sales ─────────────

test('/sales: admins and sellers only, private, last 7 days by default', async () => {
  const guild = await newGuild();
  addSale(guild, Date.now() - 3_600_000, { amount: 25 });
  for (const who of [member(guild), member(guild, ['member', 'support']), member(guild, ['member', 'moderator'])]) {
    const denied = await salesCmd(guild, who);
    assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);
  }
  for (const who of [member(guild, ['member', 'seller']), member(guild, ['admin']), guild.members.cache.get(guild.ownerId)]) {
    const ok = await salesCmd(guild, who);
    const res = lastResponse(ok);
    assert.ok(res.flags & MessageFlags.Ephemeral, 'only the person asking sees it');
    assert.ok(res.flags & MessageFlags.IsComponentsV2);
    assert.deepEqual(res.allowedMentions, { parse: [] }, 'seller mentions never ping');
    assert.match(textOf(res), /Sales · Last 7 days/);
    assert.match(textOf(res), /Revenue: 25€/);
  }
  const today = await salesCmd(guild, guild.members.cache.get(guild.ownerId), { period: 'today' });
  assert.match(textOf(lastResponse(today)), /Sales · Today/);
  const json = commands.get('sales').data.toJSON();
  assert.deepEqual(json.options[0].choices.map((c) => c.value), ['today', '7d', '30d', 'all']);
});

test('a shop order completed in its ticket shows up in /sales and on the customer profile', async () => {
  const shop = require('../src/features/shop');
  const tickets = require('../src/tickets/tickets');
  const promos = require('../src/features/promos');
  const guild = await newGuild();
  const product = shop.addProduct(guild, { name: 'Spotify Premium', price: '10', description: 'Instant delivery.' });
  promos.create(guild.id, { code: 'NOX10', percent: 10 });
  const buyer = member(guild);
  const seller = member(guild, ['member', 'seller']);
  const buy = createInteraction({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '3', promo: 'NOX10' }, selects: { payment: ['0'] } });
  await handle(buy, commands);
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id)[0];
  await tickets.completeOrder(guild.channels.cache.get(ticket.channelId), seller);

  const card = textOf(lastResponse(await salesCmd(guild, seller, { period: 'today' })));
  assert.match(card, /Revenue: 27€/);
  assert.match(card, /🥇 \*\*Spotify Premium\*\*  ·  1 order · 27€/);
  assert.match(card, new RegExp(`🥇 <@${seller.id}>  ·  1 order · 27€`));
  assert.match(card, /🥇 \*\*PaysafeCard\*\*  ·  1 order · 27€/);
  assert.match(card, /\*\*3€\*\* given on \*\*1 order\*\*/);
  assert.match(card, /`NOX10`  ·  1 use · −3€/);

  const profile = createInteraction({ guild, member: seller, kind: 'command', commandName: 'customer', subcommand: 'view', options: { user: buyer.user } });
  await handle(profile, commands);
  const text = textOf(lastResponse(profile));
  assert.match(text, /\*\*Completed orders:\*\* 1  ·  \*\*Total spent:\*\* 27€/);
  assert.match(text, new RegExp(`\`#${String(ticket.number).padStart(4, '0')}\` · \\*\\*Spotify Premium\\*\\* × 3 · 27€ · 🏷️ NOX10`));
  assert.match(text, /\*\*Tickets:\*\* 1 open · 0 closed/);
});

// ───────────── Weekly report ─────────────

test('weekly report: posted in #sales once per week (Monday 10:00 Warsaw), never twice – not even after a restart', async () => {
  assert.ok(hooks.timers().some((t) => t.name === 'salesReport'), 'timer registered');
  assert.deepEqual([config.salesReport.weekday, config.salesReport.hour], [1, 10]);
  const guild = await newGuild();
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'sales'));
  addSale(guild, at('2026-09-28T00:30:00+02:00'), { amount: 11 }); // Monday – first day of the reported week
  addSale(guild, at('2026-10-04T23:30:00+02:00'), { amount: 22 }); // Sunday night – last day
  addSale(guild, at('2026-10-05T00:30:00+02:00'), { amount: 99 }); // Monday after midnight – next week
  addSale(guild, at('2026-09-23T12:00:00+02:00'), { amount: 10 }); // the week before

  assert.equal(await sales.sendWeeklyReport(guild, at('2026-10-05T09:59:00+02:00')), null, 'not before 10:00');
  assert.equal(channel.messageList.length, 0);

  await Promise.all([sales.runWeeklyReport(guild.client, at('2026-10-05T10:00:30+02:00')), sales.runWeeklyReport(guild.client, at('2026-10-05T10:00:31+02:00'))]);
  assert.equal(channel.messageList.length, 1, 'two checks at the same time post one report');
  const report = textOf(channel.messageList[0].body);
  assert.match(report, /Weekly sales report/);
  assert.match(report, /28 Sep – 4 Oct 2026/);
  assert.match(report, /Revenue: 33€/);
  assert.match(report, /📈 \+230% vs the week before \(10€\)/);
  assert.match(report, /Sent every Monday at 10:00 \(Europe\/Warsaw\)/);
  assert.deepEqual(db.guild(guild.id).stats.salesReport, { week: '2026-10-05', sentAt: at('2026-10-05T10:00:30+02:00') });

  await sales.runWeeklyReport(guild.client, at('2026-10-05T10:10:30+02:00'));
  restart();
  await sales.runWeeklyReport(guild.client, at('2026-10-05T10:20:30+02:00'));
  await sales.runWeeklyReport(guild.client, at('2026-10-06T08:00:00+02:00'));
  assert.equal(channel.messageList.length, 1, 'once per week, also after a restart');

  await sales.runWeeklyReport(guild.client, at('2026-10-12T10:05:00+02:00'));
  assert.equal(channel.messageList.length, 2, 'the next Monday');
  assert.match(textOf(channel.messageList[1].body), /5 Oct – 11 Oct 2026[\s\S]*Revenue: 99€/);
  assert.equal(db.guild(guild.id).stats.salesReport.week, '2026-10-12');

  // After summer time ends: 10:00 CET = 09:00 UTC
  await sales.runWeeklyReport(guild.client, at('2026-10-26T09:30:00+01:00'));
  assert.equal(channel.messageList.length, 2);
  await sales.runWeeklyReport(guild.client, at('2026-10-26T10:00:00+01:00'));
  assert.equal(channel.messageList.length, 3);
  assert.match(textOf(channel.messageList[2].body), /19 Oct – 25 Oct 2026/);
});

test('weekly report: a late bot still posts the same day, a missed week is skipped, a failed post is retried', async () => {
  const guild = await newGuild();
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'sales'));

  await sales.sendWeeklyReport(guild, at('2026-10-07T12:00:00+02:00'));
  assert.equal(channel.messageList.length, 0, 'Wednesday: more than a day late → wait for next Monday');

  // #sales can't be reached → nothing remembered, the next check tries again
  guild.channels.cache.delete(channel.id);
  assert.equal(await sales.sendWeeklyReport(guild, at('2026-10-12T10:00:00+02:00')), null);
  assert.equal(db.guild(guild.id).stats.salesReport, undefined);
  guild.channels.cache.set(channel.id, channel);

  await sales.sendWeeklyReport(guild, at('2026-10-13T09:00:00+02:00'));
  assert.equal(channel.messageList.length, 1, 'Tuesday morning: within a day of the planned time');
  assert.match(textOf(channel.messageList[0].body), /5 Oct – 11 Oct 2026/, 'still the week before Monday');

  const before = config.salesReport.enabled;
  config.salesReport.enabled = false;
  try {
    await sales.runWeeklyReport(guild.client, at('2026-10-19T10:00:00+02:00'));
    assert.equal(channel.messageList.length, 1, 'turned off in config.json');
  } finally {
    config.salesReport.enabled = before;
  }
});

test('weekly report: weekday and hour from config.json (7 = Sunday)', async () => {
  const before = { ...config.salesReport };
  Object.assign(config.salesReport, { weekday: 7, hour: 21 });
  try {
    assert.equal(sales.lastReportTime(at('2026-10-04T21:00:00+02:00')), at('2026-10-04T21:00:00+02:00'));
    assert.equal(sales.lastReportTime(at('2026-10-04T20:59:00+02:00')), at('2026-09-27T21:00:00+02:00'));
    assert.equal(sales.lastReportTime(at('2026-10-10T08:00:00+02:00')), at('2026-10-04T21:00:00+02:00'));
    assert.match(textOf(sales.weeklyCard(await newGuild(), at('2026-10-04T21:00:00+02:00'))), /Sent every Sunday at 21:00/);
  } finally {
    Object.assign(config.salesReport, before);
  }
});
