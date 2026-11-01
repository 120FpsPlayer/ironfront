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
 *   affiliate        – a creator code: { userId, commission } – its creator can't use it, and earns commission on
 *                      completed sales with it (src/features/affiliates.js)
 *
 * Until then an open order HOLDS its code: the hold counts towards max uses, once per member and
 * first order only (reservedBy / openOrdersOf). A closed order gives its code back – reopening it takes
 * the code again only if it's still free (shop.recheckOrderPromo).
 */

const crypto = require('node:crypto');
const config = require('../lib/config');
const db = require('../lib/db');
const { UserError, money } = require('../lib/utils');

const DAY = 86_400_000;
const CODE = /^[A-Z0-9_-]{3,24}$/;

const normalize = (code) => String(code ?? '').trim().toUpperCase();
const list = (guildId) => db.guild(guildId).promos;
const find = (guildId, code) => list(guildId).find((p) => p.code === normalize(code)) ?? null;

function create(guildId, { code, percent = null, amount = null, expiresAt = null, maxUses = null, userId = null, oncePerUser = true, firstOrderOnly = false, reason = null, createdBy = null, affiliate = null }) {
  const c = normalize(code);
  if (!CODE.test(c)) throw new UserError('Kod musi mieć 3–24 znaki: litery, cyfry, - i _.');
  if (find(guildId, c)) throw new UserError(`Kod **${c}** już istnieje.`);
  const pct = percent == null ? null : Number(percent);
  const amt = amount == null ? null : Number(amount);
  if ((pct == null) === (amt == null)) throw new UserError('Podaj rabat w procentach albo kwotę rabatu – nie oba naraz.');
  if (pct != null && !(pct >= 1 && pct <= 100)) throw new UserError('Procent musi być od 1 do 100.');
  if (amt != null && !(amt > 0)) throw new UserError('Kwota rabatu musi być większa niż 0.');
  if (maxUses != null && !(Number.isInteger(Number(maxUses)) && Number(maxUses) > 0)) throw new UserError('Limit użyć musi być liczbą całkowitą większą niż 0.');
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
    ...(affiliate && { affiliate }),
  };
  list(guildId).push(promo);
  db.save();
  return promo;
}

/** A unique single-use code for one member, e.g. "WITAJ-4F2A9C". */
function personal(guildId, userId, { percent, days = 7, prefix = 'HS', reason = null, firstOrderOnly = false } = {}) {
  for (let i = 0; i < 20; i += 1) {
    const code = `${normalize(prefix).replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'HS'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    if (!find(guildId, code)) {
      return create(guildId, { code, percent, expiresAt: Date.now() + days * DAY, maxUses: 1, userId, oncePerUser: true, firstOrderOnly, reason });
    }
  }
  throw new Error('Nie udało się utworzyć unikalnego kodu rabatowego');
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
 * reserved   – owners of open orders that already use the code (not redeemed yet, but promised).
 * openOrders – how many other open (not completed) orders this member has – first-order codes need 0.
 * @param {{ now?: number, completedOrders?: number, openOrders?: number, reserved?: string[] }} opts
 */
function problem(promo, userId, { now = Date.now(), completedOrders = 0, openOrders = 0, reserved = [] } = {}) {
  if (!promo || !promo.active) return 'Taki kod nie istnieje.';
  if (promo.expiresAt && now > promo.expiresAt) return 'Ten kod wygasł.';
  if (promo.affiliate && config.affiliates?.enabled === false) return 'Kody twórców są teraz wyłączone.';
  if (promo.affiliate && promo.affiliate.userId === userId) return 'To Twój własny kod twórcy – jest dla Twoich odbiorców, nie możesz z niego korzystać.';
  if (promo.userId && promo.userId !== userId) return 'Ten kod należy do kogoś innego.';
  if (promo.oncePerUser && reserved.includes(userId)) return 'Używasz już tego kodu w innym otwartym zamówieniu.';
  if (promo.maxUses != null && promo.uses.length >= promo.maxUses) return 'Ten kod został już wykorzystany.';
  if (promo.oncePerUser && promo.uses.some((u) => u.userId === userId)) return 'Ten kod został już przez Ciebie wykorzystany.';
  if (promo.maxUses != null && promo.uses.length + reserved.length >= promo.maxUses) {
    return 'Wszystkie pozostałe użycia tego kodu są teraz zarezerwowane przez inne otwarte zamówienia – kod będzie znów dostępny tylko wtedy, gdy któreś z nich zostanie anulowane.';
  }
  if (promo.firstOrderOnly && completedOrders > 0) return 'Ten kod działa tylko przy pierwszym zamówieniu.';
  if (promo.firstOrderOnly && openOrders > 0) return 'Ten kod działa tylko przy pierwszym zamówieniu – masz już inne otwarte zamówienie.';
  return null;
}

/**
 * Completing an order: which limit redeeming its code now goes over – or null when it's fine.
 * Only the limits an order that was valid when it was placed can break later. A code that was deleted
 * or has expired since keeps its discount for orders placed in time.
 */
function overLimit(promo, userId, { completedOrders = 0 } = {}) {
  if (!promo) return null;
  if (promo.maxUses != null && promo.uses.length >= promo.maxUses) return `już wykorzystany (${promo.uses.length}/${promo.maxUses} użyć)`;
  if (promo.oncePerUser && promo.uses.some((u) => u.userId === userId)) return 'klient użył go już przy wcześniejszym zamówieniu';
  if (promo.firstOrderOnly && completedOrders > 0) return 'jest tylko na pierwsze zamówienie, a klient ma już zrealizowane zamówienie';
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

// Orders being placed right now: priced, but their ticket isn't saved yet (opening it takes several
// Discord calls). They hold their code like open orders do, so two buyers who submit at the same time
// can't both get the last use of a code.
const placing = new Set();

/**
 * Marks an order as being placed – call it right after pricing it, before the first await. Call the
 * returned release() as soon as the ticket has stored its order (or opening it failed).
 */
function hold(guildId, userId, code = null) {
  const entry = { guildId, userId, code: code ? normalize(code) : null };
  placing.add(entry);
  return () => placing.delete(entry);
}

const placingNow = (guildId, match) => [...placing].filter((h) => h.guildId === guildId && match(h));

/** Open (not yet completed) order tickets that use this code. */
const openOrdersWith = (guildId, code) =>
  db.tickets((t) => t.guildId === guildId && t.status === 'open' && !t.completedAt && t.order?.promo === normalize(code));

/**
 * Owners of open orders that use this code, and of orders being placed with it right now – pass as
 * `reserved` to check(). except – a ticket channel to leave out (the order being checked itself).
 */
const reservedBy = (guildId, code, { except = null } = {}) => [
  ...openOrdersWith(guildId, code)
    .filter((t) => t.channelId !== except)
    .map((t) => t.ownerId),
  ...placingNow(guildId, (h) => h.code === normalize(code)).map((h) => h.userId),
];

/** How many open (not completed) orders this member has, or is placing right now – pass as `openOrders` to check(). */
const openOrdersOf = (guildId, userId, { except = null } = {}) =>
  db.tickets((t) => t.guildId === guildId && t.ownerId === userId && t.typeId === 'order' && t.status === 'open' && !t.completedAt && t.channelId !== except).length +
  placingNow(guildId, (h) => h.userId === userId).length;

/** Records one use – call it when the order is completed. */
function redeem(guildId, code, userId, saleId = null) {
  const promo = find(guildId, code);
  if (!promo) return null;
  promo.uses.push({ userId, at: Date.now(), saleId });
  db.save();
  return promo;
}

/** "10% rabatu" / "5€ rabatu" */
const label = (promo) => (promo.percent != null ? `${promo.percent}% rabatu` : `${money(promo.amount)} rabatu`);

module.exports = { DAY, normalize, list, find, create, personal, remove, problem, overLimit, check, apply, hold, openOrdersWith, reservedBy, openOrdersOf, redeem, label };
