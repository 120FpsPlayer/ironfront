'use strict';

/**
 * Deal of the week (config.deals: { enabled, minPercent: 25, maxPercent: 50, daysPerWeek: [1, 2], hours: 24 }).
 * Each ISO week (in the shop's time zone – config.workingHours.timezone) 1–2 random days are picked, each with a random
 * time inside the opening hours (config.workingHours; the whole day when they are off). The plan is stored, so a restart
 * never re-rolls it. At that time ONE flash sale starts on a random eligible product (a plain number price, in stock, not
 * on sale) with a random discount from minPercent to maxPercent (never above 50%) for `hours`, announced in #restocks as
 * "🔥 Deal of the week". Never two deals at once: a day whose time comes while a deal is still running waits for it to
 * end (while the opening window lasts). Nothing eligible → that day is skipped. The shop closed by hand (/shop close) →
 * the day waits too. /sale deal shows the plan; /sale deal now:true starts one right away.
 *
 * g.deals = { week: '2026-W41', days: ['2026-10-06', …], slots: { [day]: { at, until, state, productId, percent } },
 *             current: { productId, percent, endsAt, startedAt, by } }
 *   state: 'planned' | 'started' | 'skipped' (nothing eligible) | 'missed' (its opening window passed)
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const hours = require('../lib/hours');
const flash = require('./flashsales');
const shop = require('./shop');
const shopstatus = require('./shopstatus');
const { UserError } = require('../lib/utils');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const CHECK_EVERY = MINUTE;
const TOP_PERCENT = 50; // a deal never gives more than this
const TITLE = '🔥 Deal of the week';

const int = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Math.round(Number(value)) : fallback);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function settings() {
  const c = config.deals ?? {};
  const top = Math.min(TOP_PERCENT, flash.MAX_PERCENT);
  const a = clamp(int(c.minPercent, 25), flash.MIN_PERCENT, top);
  const b = clamp(int(c.maxPercent, 50), flash.MIN_PERCENT, top);
  const [d1, d2] = Array.isArray(c.daysPerWeek) ? c.daysPerWeek : [c.daysPerWeek, c.daysPerWeek];
  const x = clamp(int(d1, 1), 0, 7);
  const y = clamp(int(d2 ?? d1, 2), 0, 7);
  const ms = Number(c.hours) > 0 ? Number(c.hours) * HOUR : DAY;
  return {
    enabled: c.enabled !== false,
    minPercent: Math.min(a, b),
    maxPercent: Math.max(a, b),
    minDays: Math.min(x, y),
    maxDays: Math.max(x, y),
    durationMs: clamp(Math.round(ms), MINUTE, flash.MAX_DURATION),
  };
}

const zone = () => (config.workingHours?.enabled ? config.workingHours.timezone : config.workingHours?.timezone) ?? 'UTC';
const two = (n) => String(n).padStart(2, '0');
const dayKey = (y, m, d) => `${y}-${two(m)}-${two(d)}`;

/** The ISO week of a moment in the shop's time zone → { key: '2026-W41', days: [{ key, y, m, d, weekday }] Mon…Sun }. */
function weekOf(now = Date.now()) {
  const z = hours.zoned(new Date(now), zone());
  const date = Date.UTC(z.year, z.month - 1, z.day);
  const monday = date - ((z.weekday + 6) % 7) * DAY;
  const thursday = new Date(monday + 3 * DAY);
  const year = thursday.getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY / 7) + 1;
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const t = new Date(monday + i * DAY);
    days.push({ key: dayKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), weekday: t.getUTCDay() });
  }
  return { key: `${year}-W${two(week)}`, days, today: dayKey(z.year, z.month, z.day) };
}

/** The opening window of a day: { from, to } timestamps – null when the shop isn't open that day. */
function windowOf(day) {
  const wh = config.workingHours;
  const tz = zone();
  if (!wh?.enabled) return { from: hours.wallTime(day.y, day.m, day.d, 0, tz).getTime(), to: hours.wallTime(day.y, day.m, day.d, 1440, tz).getTime() };
  if (Array.isArray(wh.days) && !wh.days.includes(day.weekday)) return null;
  const from = hours.toMinutes(wh.from ?? '00:00');
  const to = hours.toMinutes(wh.to ?? '24:00');
  return { from: hours.wallTime(day.y, day.m, day.d, from, tz).getTime(), to: hours.wallTime(day.y, day.m, day.d, from <= to ? to : to + 1440, tz).getTime() };
}

/** Rolls a new plan for the week of `now`: random days (still ahead) with a random minute inside their opening hours. */
function rollWeek(now = Date.now(), opts = settings()) {
  const week = weekOf(now);
  const open = week.days
    .map((day) => ({ day, win: windowOf(day) }))
    .filter(({ win }) => win && win.to - MINUTE > now)
    .map(({ day, win }) => ({ key: day.key, from: Math.max(win.from, now), to: win.to }));
  const count = Math.min(open.length, randInt(opts.minDays, opts.maxDays));
  const picked = [];
  while (picked.length < count) {
    const i = Math.floor(Math.random() * open.length);
    picked.push(...open.splice(i, 1));
  }
  picked.sort((a, b) => a.from - b.from);
  const slots = {};
  for (const p of picked) {
    const at = Math.floor((p.from + Math.random() * Math.max(0, p.to - p.from - MINUTE)) / MINUTE) * MINUTE;
    slots[p.key] = { at: Math.max(at, Math.ceil(p.from / MINUTE) * MINUTE), until: p.to, state: 'planned' };
  }
  return { week: week.key, days: picked.map((p) => p.key), slots };
}

/** This week's plan for the server – rolled once per ISO week and stored. */
function plan(guildId, now = Date.now()) {
  const g = db.guild(guildId);
  const key = weekOf(now).key;
  if (g.deals.week !== key || !g.deals.slots) {
    Object.assign(g.deals, rollWeek(now));
    db.save();
  }
  return g.deals;
}

/** The deal running right now (its product still on that sale) → { product, ...current } or null. */
function activeDeal(guildId, now = Date.now()) {
  const cur = db.guild(guildId).deals.current;
  if (!cur || !(cur.endsAt > now)) return null;
  const product = shop.products(guildId).find((p) => p.id === cur.productId);
  const sale = product ? shop.activeSale(product, now) : null;
  return sale && sale.endsAt === cur.endsAt ? { ...cur, product } : null;
}

/** Products a deal can go on: a plain number price, in stock, not on sale. */
const eligible = (guildId, now = Date.now()) =>
  shop.products(guildId).filter((p) => p.stock !== 'out' && !(shop.counted(p) && p.stockCount <= 0) && !shop.activeSale(p, now) && !shop.saleProblem(p));

/** Starts a deal now (a random eligible product and percent) and announces it → { product, percent, announced }. */
async function startDeal(guild, { now = Date.now(), by = null, announce = true } = {}) {
  const running = activeDeal(guild.id, now);
  if (running) throw new UserError(`A deal is already running: **${running.product.name}** −${running.percent}% – only one at a time.`);
  const list = eligible(guild.id, now);
  if (!list.length) throw new UserError('No product can be the deal right now – it needs a plain number price, stock and no running sale.');
  const opts = settings();
  const pick = list[Math.floor(Math.random() * list.length)];
  const percent = randInt(opts.minPercent, opts.maxPercent);
  const { product } = flash.startSale(guild, pick.id, { percent, durationMs: opts.durationMs, by, now });
  product.sale.deal = true;
  const g = db.guild(guild.id);
  g.deals.current = { productId: product.id, percent, endsAt: product.sale.endsAt, startedAt: now, by };
  db.save();
  console.log(`[deals] ${guild.name}: ${product.name} −${percent}% for ${Math.round(opts.durationMs / HOUR)}h`);
  const announced = announce ? Boolean(await flash.announceSale(guild, product, now, { title: TITLE }).catch(() => null)) : false;
  return { product, percent, announced };
}

/** One server: marks passed days as missed and starts the deal that's due. → the started deal or null */
async function tickGuild(guild, now = Date.now()) {
  const p = plan(guild.id, now);
  let started = null;
  for (const day of p.days) {
    const slot = p.slots[day];
    if (!slot || slot.state !== 'planned') continue;
    if (now >= slot.until) {
      slot.state = 'missed';
      db.save();
      continue;
    }
    if (now < slot.at || started || activeDeal(guild.id, now) || shopstatus.mode(guild.id) === 'closed') continue;
    if (!eligible(guild.id, now).length) {
      slot.state = 'skipped';
      db.save();
      continue;
    }
    slot.state = 'started'; // first, so an error never starts a second one
    db.save();
    started = await startDeal(guild, { now }).catch((err) => {
      console.warn('[deals]', err.message);
      return null;
    });
    if (started) Object.assign(slot, { productId: started.product.id, percent: started.percent });
    else slot.state = 'skipped';
    db.save();
  }
  return started;
}

/** Every available server → how many deals started. */
async function tick(client, now = Date.now()) {
  if (!settings().enabled) return 0;
  let n = 0;
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || guild.available === false) continue; // a Discord outage – try again on the next run
    if (await tickGuild(guild, now)) n += 1;
  }
  return n;
}

hooks.every('deals', CHECK_EVERY, (client) => tick(client), 45_000);

module.exports = { TITLE, TOP_PERCENT, settings, weekOf, windowOf, rollWeek, plan, activeDeal, eligible, startDeal, tickGuild, tick };
