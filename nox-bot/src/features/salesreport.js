'use strict';

/**
 * Sales statistics – the /sales card (src/commands/sales.js) and the weekly report in #sales.
 *
 *   /sales period:today|7d|30d|all   revenue, orders, average order, change vs the period before, top products,
 *                                    sellers, payment methods and discounts
 *   weekly report                    the last 7 full days, posted in #sales once a week
 *                                    config.salesReport: { enabled, weekday (1 = Monday … 7 = Sunday), hour (0–23) }
 *
 * Sales come from db.sales(guildId) (SALE in src/lib/db.js). Days are counted in the shop's time zone
 * (config.workingHours.timezone): "today" starts at local midnight, not at midnight UTC.
 */

const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, COLORS } = require('../lib/theme');
const { money, truncate, sendToChannel, ts } = require('../lib/utils');
const { container, text, divider, header, v2 } = require('../lib/v2');

const DAY = 86_400_000;
const REPORT_CHECK = 10 * 60_000;
const REPORT_GRACE = DAY; // a report missed by more than a day (bot offline) is skipped – the next one comes a week later
const TOP = 5;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const PERIODS = {
  today: { label: 'Today', days: 1, before: 'yesterday up to this time' },
  '7d': { label: 'Last 7 days', days: 7, before: 'the 7 days before' },
  '30d': { label: 'Last 30 days', days: 30, before: 'the 30 days before' },
  all: { label: 'All time', days: 0 },
};

// ───────────── Time zone maths ─────────────

const formatters = new Map();
function formatter(tz) {
  if (!formatters.has(tz)) {
    const options = { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' };
    formatters.set(tz, new Intl.DateTimeFormat('en-US', options));
  }
  return formatters.get(tz);
}

/** The shop's time zone (config.workingHours.timezone) – UTC when it's missing or unknown. */
function timezone() {
  const tz = config.workingHours?.timezone || 'UTC';
  try {
    formatter(tz);
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Wall-clock time of a moment in a time zone: { year, month (1–12), day, hour, minute, second, weekday (0 = Sunday) }. */
function localParts(ms, tz = timezone()) {
  const p = Object.fromEntries(formatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** How far the time zone is ahead of UTC at this moment (ms). */
function offset(ms, tz) {
  const p = localParts(ms, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** The moment a wall-clock time happens in a time zone. Days may overflow (day 0 = last day of the month before). */
function zonedTime({ year, month, day, hour = 0, minute = 0, second = 0 }, tz = timezone()) {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  return wall - offset(wall - offset(wall, tz), tz);
}

/** Local midnight of the day a moment falls on. */
function dayStart(ms, tz = timezone()) {
  const p = localParts(ms, tz);
  return zonedTime({ year: p.year, month: p.month, day: p.day }, tz);
}

/** The same wall-clock time n days later (or earlier) – a day has 23 or 25 hours when the clocks change. */
function addDays(ms, n, tz = timezone()) {
  const p = localParts(ms, tz);
  return zonedTime({ ...p, day: p.day + n }, tz) + (ms % 1000);
}

const pad2 = (n) => String(n).padStart(2, '0');

/** "2026-10-05" – the local date of a moment. */
function dateKey(ms, tz = timezone()) {
  const p = localParts(ms, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "3 Oct 2026" / "3 Oct" in the shop's time zone (Discord timestamps would use the reader's own time zone). */
function dateText(ms, tz, year = true) {
  const p = localParts(ms, tz);
  return `${p.day} ${MONTHS[p.month - 1]}${year ? ` ${p.year}` : ''}`;
}

/** "27 Sep – 3 Oct 2026" for [from, to). */
function rangeText(from, to, tz) {
  const first = dateText(from, tz);
  const last = dateText(to - 1, tz);
  if (first === last) return first;
  const sameYear = localParts(from, tz).year === localParts(to - 1, tz).year;
  return `${sameYear ? dateText(from, tz, false) : first} – ${last}`;
}

// ───────────── Periods ─────────────

/**
 * A /sales period: from local midnight (days − 1) days ago until now, plus the period before it – the same days
 * shifted back and only up to the same time of day, so a half-finished day is compared fairly.
 * Ranges are [from, to).
 */
function periodRange(period, now = Date.now(), tz = timezone()) {
  const key = PERIODS[period] ? period : '7d';
  const def = PERIODS[key];
  if (!def.days) return { key, label: def.label, from: 0, to: now + 1, prev: null, tz };
  const from = addDays(dayStart(now, tz), -(def.days - 1), tz);
  return {
    key,
    label: def.label,
    before: def.before,
    from,
    to: now + 1,
    prev: { from: addDays(from, -def.days, tz), to: addDays(now, -def.days, tz) + 1 },
    tz,
  };
}

/** The weekly report: the 7 full days before the day of `at`, compared with the 7 days before those. */
function weekRange(at, tz = timezone()) {
  const to = dayStart(at, tz);
  const from = addDays(to, -7, tz);
  return { key: 'week', label: 'Last week', before: 'the week before', from, to, prev: { from: addDays(to, -14, tz), to: from }, tz };
}

// ───────────── Numbers ─────────────

const isAmount = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => Math.round(n * 100) / 100;
const completedAt = (s) => s.completedAt ?? s.createdAt ?? 0;

/** A payment method as configured ("PaysafeCard"); free-text answers that match none are "Other". */
function methodName(sale) {
  const raw = String(sale.method ?? '').trim().toLowerCase();
  if (!raw) return 'Not given';
  return config.shop.paymentMethods.find((m) => raw.includes(String(m.name).toLowerCase()))?.name ?? 'Other';
}

/** Groups sales: [{ key, name, orders, known, revenue }] – highest revenue first, then most orders. */
function tally(list, keyOf, nameOf) {
  const groups = new Map();
  for (const s of list) {
    const key = keyOf(s);
    const entry = groups.get(key) ?? { key, name: nameOf(s), orders: 0, known: 0, revenue: 0 };
    entry.orders += 1;
    if (isAmount(s.amount)) {
      entry.known += 1;
      entry.revenue = round(entry.revenue + s.amount);
    }
    groups.set(key, entry);
  }
  return [...groups.values()].sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || String(a.name).localeCompare(String(b.name)));
}

/** Promo codes used: [{ code, uses, discount }] – most used first. */
function promoTally(list) {
  const groups = new Map();
  for (const s of list.filter((x) => x.promo)) {
    const entry = groups.get(s.promo) ?? { code: s.promo, uses: 0, discount: 0 };
    entry.uses += 1;
    entry.discount = round(entry.discount + (Number(s.discount) || 0));
    groups.set(s.promo, entry);
  }
  return [...groups.values()].sort((a, b) => b.uses - a.uses || b.discount - a.discount || a.code.localeCompare(b.code));
}

/** Everything the sales card shows for the sales completed in [from, to). */
function summarize(guildId, { from, to }) {
  const catalog = db.guild(guildId).products;
  const list = db.sales(guildId).filter((s) => completedAt(s) >= from && completedAt(s) < to);
  const known = list.filter((s) => isAmount(s.amount));
  const revenue = round(known.reduce((sum, s) => sum + s.amount, 0));
  const discounted = list.filter((s) => s.promo || Number(s.discount) > 0);
  const productName = (s) => catalog.find((p) => p.id === s.productId)?.name ?? (String(s.product ?? '').trim() || 'Custom order');
  return {
    orders: list.length,
    revenue,
    known: known.length,
    unknown: list.length - known.length,
    average: known.length ? round(revenue / known.length) : null,
    first: list.reduce((min, s) => Math.min(min, completedAt(s)), Infinity),
    products: tally(list, (s) => s.productId ?? `name:${productName(s).toLowerCase()}`, productName),
    sellers: tally(list.filter((s) => s.sellerId), (s) => s.sellerId, (s) => s.sellerId),
    methods: tally(list, methodName, methodName),
    discount: round(discounted.reduce((sum, s) => sum + (Number(s.discount) || 0), 0)),
    discounted: discounted.length,
    promos: promoTally(list),
  };
}

/** Change in percent (rounded), or null when there was nothing before. */
function change(cur, prev) {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}

/** "📈 +25%", "📉 −10%", "➖ ±0%" or "📈 up" (from nothing in the period before). */
function changeText(cur, prev) {
  const pct = change(cur, prev);
  if (pct === null) return cur > 0 ? '📈 up' : '➖ ±0%';
  if (pct > 0) return `📈 +${pct}%`;
  if (pct < 0) return `📉 −${Math.abs(pct)}%`;
  return '➖ ±0%';
}

// ───────────── Card ─────────────

const MEDALS = ['🥇', '🥈', '🥉'];
const place = (i) => MEDALS[i] ?? `**${i + 1}.**`;
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
const worth = (x) => (x.known ? money(x.revenue) : 'amount unknown');

function overview(guild, cur, prev, range) {
  const lines = [`### ${e(guild, 'wallet')} Revenue: ${money(cur.revenue)}`];
  if (prev) lines.push(`${changeText(cur.revenue, prev.revenue)} vs ${range.before} (${money(prev.revenue)})`);
  lines.push(`**Orders:** ${cur.orders}${prev ? `${'  '}·${'  '}${changeText(cur.orders, prev.orders)} (${prev.orders} before)` : ''}`);
  lines.push(`**Average order:** ${cur.average === null ? '—' : money(cur.average)}`);
  if (cur.unknown) lines.push(`-# ⚠️ ${plural(cur.unknown, 'order')} without a known amount ${cur.unknown === 1 ? "isn't" : "aren't"} counted in revenue or the average.`);
  return lines.join('\n');
}

function topList(title, entries, line) {
  return [`### ${title}`, ...entries.slice(0, TOP).map((x, i) => `${place(i)} ${line(x)}`)].join('\n');
}

function discountsText(guild, cur) {
  if (!cur.discounted) return `### ${e(guild, 'gift')} Discounts\nNo promo codes or discounts used.`;
  const codes = cur.promos.slice(0, TOP).map((p) => `\`${p.code}\`${'  '}·${'  '}${plural(p.uses, 'use')}${p.discount ? ` · −${money(p.discount)}` : ''}`);
  return [`### ${e(guild, 'gift')} Discounts`, `**${money(cur.discount)}** given on **${plural(cur.discounted, 'order')}**`, ...codes].join('\n');
}

/** "27 Sep – 3 Oct 2026 · Europe/Warsaw" (or "Since 12 Mar 2026" for all time). */
function rangeLine(range, cur) {
  if (range.key === 'all') return Number.isFinite(cur.first) ? `Since ${dateText(cur.first, range.tz)} · ${range.tz}` : 'Everything recorded so far';
  return `${rangeText(range.from, range.to, range.tz)} · days in ${range.tz}`;
}

/**
 * The sales card for a range (from periodRange or weekRange).
 * options: title (default "📈 Sales · <period>"), footer (small print at the bottom).
 */
function salesCard(guild, range, { title, footer } = {}) {
  const cur = summarize(guild.id, range);
  const prev = range.prev ? summarize(guild.id, range.prev) : null;
  const c = container(COLORS.brand);
  header(c, `## ${title ?? `📈 Sales · ${range.label}`}\n-# ${rangeLine(range, cur)}`, guild.iconURL?.({ size: 128 }));
  c.addSeparatorComponents(divider());

  if (!cur.orders) {
    const before = prev?.orders ? `\n-# ${range.before[0].toUpperCase()}${range.before.slice(1)}: ${plural(prev.orders, 'order')} · ${money(prev.revenue)}` : '';
    c.addTextDisplayComponents(
      text(
        `### 🌙 No sales ${range.key === 'all' ? 'yet' : 'in this period'}\n` +
          `Sales are recorded when a seller marks a purchase ticket as **Order completed** (⚙️ ticket menu).${before}`,
      ),
    );
  } else {
    c.addTextDisplayComponents(text(overview(guild, cur, prev, range)));
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(topList(`${e(guild, 'box')} Top products`, cur.products, (p) => `**${truncate(p.name, 60)}**${'  '}·${'  '}${plural(p.orders, 'order')} · ${worth(p)}`)));
    if (cur.sellers.length) c.addTextDisplayComponents(text(topList(`${e(guild, 'person')} Sellers`, cur.sellers, (s) => `<@${s.key}>${'  '}·${'  '}${plural(s.orders, 'order')} · ${worth(s)}`)));
    c.addTextDisplayComponents(text(topList(`${e(guild, 'card')} Payment methods`, cur.methods, (m) => `**${m.name}**${'  '}·${'  '}${plural(m.orders, 'order')} · ${worth(m)}`)));
    c.addTextDisplayComponents(text(discountsText(guild, cur)));
  }
  c.addSeparatorComponents(divider());
  const note = footer ?? (cur.orders ? 'Revenue = the amounts paid, as entered when the orders were completed' : 'Pick another range with the `period` option');
  c.addTextDisplayComponents(text(`-# ${note} · ${ts(Date.now(), 'f')}`));
  return v2(c);
}

// ───────────── Weekly report ─────────────

/** Written to disk right away (not in 0.5 s) – a crash or restart right after posting must not post it again. */
function persist() {
  try {
    db.flush();
  } catch (err) {
    console.warn('[salesReport] Failed to save data:', err.message);
    db.save();
  }
}

/** config.salesReport as numbers: weekday 0–6 (0 = Sunday, 7 also means Sunday) and hour 0–23. */
function schedule() {
  const weekday = Math.trunc(Number(config.salesReport.weekday));
  const hour = Math.trunc(Number(config.salesReport.hour));
  return {
    weekday: Number.isFinite(weekday) ? ((weekday % 7) + 7) % 7 : 1,
    hour: Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 10,
  };
}

/** The latest report time (weekday + hour in the shop's time zone) at or before `now`. */
function lastReportTime(now = Date.now(), tz = timezone()) {
  const { weekday, hour } = schedule();
  const p = localParts(now, tz);
  const back = (p.weekday - weekday + 7) % 7;
  const at = zonedTime({ year: p.year, month: p.month, day: p.day - back, hour }, tz);
  return at <= now ? at : zonedTime({ year: p.year, month: p.month, day: p.day - back - 7, hour }, tz);
}

function weeklyCard(guild, at, tz = timezone()) {
  const { weekday, hour } = schedule();
  return salesCard(guild, weekRange(at, tz), {
    title: '📊 Weekly sales report',
    footer: `Sent every ${WEEKDAY_NAMES[weekday]} at ${pad2(hour)}:00 (${tz}) · /sales shows any period`,
  });
}

/**
 * Posts this week's report in #sales when it's due. The week is remembered in db.guild(id).stats.salesReport
 * before the message is sent, so it's never posted twice – not even after a restart.
 */
async function sendWeeklyReport(guild, now = Date.now()) {
  if (!config.salesReport.enabled) return null;
  const channelId = db.channelId(guild.id, 'sales');
  if (!channelId) return null;
  const tz = timezone();
  const at = lastReportTime(now, tz);
  if (now - at > REPORT_GRACE) return null;
  const week = dateKey(at, tz);
  const stats = db.guild(guild.id).stats;
  const before = stats.salesReport ?? null;
  if (before?.week === week) return null;
  stats.salesReport = { week, sentAt: now };
  persist();
  const message = await sendToChannel(guild, channelId, weeklyCard(guild, at, tz));
  if (!message) {
    // Not delivered (channel gone, missing permissions) – try again on the next check.
    if (before) stats.salesReport = before;
    else delete stats.salesReport;
    db.save();
  }
  return message;
}

async function runWeeklyReport(client, now = Date.now()) {
  if (!config.salesReport.enabled) return;
  for (const guild of client.guilds.cache.values()) {
    await sendWeeklyReport(guild, now).catch((err) => console.warn(`[salesReport] ${guild.name}:`, err.message));
  }
}

hooks.every('salesReport', REPORT_CHECK, (client) => runWeeklyReport(client), 2 * 60_000);

module.exports = {
  PERIODS,
  timezone,
  localParts,
  zonedTime,
  dayStart,
  addDays,
  dateKey,
  periodRange,
  weekRange,
  summarize,
  change,
  changeText,
  salesCard,
  weeklyCard,
  lastReportTime,
  sendWeeklyReport,
  runWeeklyReport,
};
