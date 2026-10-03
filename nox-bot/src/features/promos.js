'use strict';

/**
 * Discount codes – the core. The /promo command, the promo field in the order form, the first-purchase
 * code after verification and the invite rewards all use these functions.
 *
 * PROMO (stored in db.guild(id).promos):
 * { code, percent, amount, expiresAt, maxUses, uses: [{ userId, at, saleId }], userId, oncePerUser,
 *   firstOrderOnly, reason, createdBy, createdAt, active }
 *   percent / amount – exactly one is set (10 → 10% off, or 5 → 5€ off)
 *   userId           – personal code: only this member can use it
 *   uses             – recorded when the order is completed (redeem), not when it is placed
 */

const crypto = require('node:crypto');
const db = require('../lib/db');
const { UserError, money } = require('../lib/utils');

const DAY = 86_400_000;
const CODE = /^[A-Z0-9_-]{3,24}$/;

const normalize = (code) => String(code ?? '').trim().toUpperCase();
const list = (guildId) => db.guild(guildId).promos;
const find = (guildId, code) => list(guildId).find((p) => p.code === normalize(code)) ?? null;

function create(guildId, { code, percent = null, amount = null, expiresAt = null, maxUses = null, userId = null, oncePerUser = true, firstOrderOnly = false, reason = null, createdBy = null }) {
  const c = normalize(code);
  if (!CODE.test(c)) throw new UserError('A code has 3–24 characters: letters, numbers, - and _.');
  if (find(guildId, c)) throw new UserError(`The code **${c}** already exists.`);
  const pct = percent == null ? null : Number(percent);
  const amt = amount == null ? null : Number(amount);
  if ((pct == null) === (amt == null)) throw new UserError('Give either a percentage or an amount off – not both.');
  if (pct != null && !(pct >= 1 && pct <= 100)) throw new UserError('The percentage must be between 1 and 100.');
  if (amt != null && !(amt > 0)) throw new UserError('The amount off must be more than 0.');
  if (maxUses != null && !(Number.isInteger(Number(maxUses)) && Number(maxUses) > 0)) throw new UserError('Max uses must be a whole number above 0.');
  const promo = {
    code: c,
    percent: pct,
    amount: amt,
    expiresAt: expiresAt ?? null,
    maxUses: maxUses == null ? null : Number(maxUses),
    uses: [],
    userId,
    oncePerUser: Boolean(oncePerUser),
    firstOrderOnly: Boolean(firstOrderOnly),
    reason,
    createdBy,
    createdAt: Date.now(),
    active: true,
  };
  list(guildId).push(promo);
  db.save();
  return promo;
}

/** A unique single-use code for one member, e.g. "WELCOME-4F2A9C". */
function personal(guildId, userId, { percent, days = 7, prefix = 'NOX', reason = null, firstOrderOnly = false } = {}) {
  for (let i = 0; i < 20; i += 1) {
    const code = `${normalize(prefix).replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'NOX'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    if (!find(guildId, code)) {
      return create(guildId, { code, percent, expiresAt: Date.now() + days * DAY, maxUses: 1, userId, oncePerUser: true, firstOrderOnly, reason });
    }
  }
  throw new Error('Could not create a unique promo code');
}

function remove(guildId, code) {
  const g = db.guild(guildId);
  const before = g.promos.length;
  g.promos = g.promos.filter((p) => p.code !== normalize(code));
  db.save();
  return g.promos.length < before;
}

/**
 * Why this member can't use the code right now – or null when it's fine.
 * @param {{ now?: number, completedOrders?: number }} opts
 */
function problem(promo, userId, { now = Date.now(), completedOrders = 0 } = {}) {
  if (!promo || !promo.active) return "This code doesn't exist.";
  if (promo.expiresAt && now > promo.expiresAt) return 'This code has expired.';
  if (promo.userId && promo.userId !== userId) return 'This code belongs to someone else.';
  if (promo.maxUses != null && promo.uses.length >= promo.maxUses) return 'This code has been used up.';
  if (promo.oncePerUser && promo.uses.some((u) => u.userId === userId)) return "You've already used this code.";
  if (promo.firstOrderOnly && completedOrders > 0) return 'This code is only valid for your first order.';
  return null;
}

/** { promo, error } – promo is null when the code can't be used. */
function check(guildId, code, userId, opts) {
  const promo = find(guildId, code);
  const error = problem(promo, userId, opts);
  return { promo: error ? null : promo, error };
}

const round = (n) => Math.round(n * 100) / 100;

/** Total after the discount: { total, discount } (total stays null when the price isn't a number). */
function apply(promo, total) {
  if (!promo || total == null) return { total, discount: 0 };
  const discount = promo.percent != null ? (total * promo.percent) / 100 : Math.min(promo.amount, total);
  return { total: round(total - discount), discount: round(discount) };
}

/** Records one use – call it when the order is completed. */
function redeem(guildId, code, userId, saleId = null) {
  const promo = find(guildId, code);
  if (!promo) return null;
  promo.uses.push({ userId, at: Date.now(), saleId });
  db.save();
  return promo;
}

/** "10% off" / "5€ off" */
const label = (promo) => (promo.percent != null ? `${promo.percent}% off` : `${money(promo.amount)} off`);

module.exports = { DAY, normalize, list, find, create, personal, remove, problem, check, apply, redeem, label };
