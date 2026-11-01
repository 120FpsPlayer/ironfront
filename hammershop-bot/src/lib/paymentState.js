'use strict';

/**
 * Payment methods switched off for a while with /disable (and back on with /enable) – e.g. while the owner fixes
 * PayPal. A switched-off method can't be picked in the order form, the cart or a balance top-up, and the #payments
 * card, the FAQ and the shop panel show it as "temporarily unavailable". Orders already placed keep working.
 *
 * db.guild(id).disabledMethods = { [method name]: { by, at, reason } } – keyed by name, so reordering the methods in
 * config.json keeps it (a renamed method is simply on again).
 */

const config = require('./config');
const db = require('./db');
const { UserError } = require('./utils');

const key = (name) => String(name ?? '').trim().toLowerCase();
const state = (guildId) => db.guild(guildId).disabledMethods ?? {};
const find = (guildId, name) => Object.entries(state(guildId)).find(([k]) => key(k) === key(name))?.[1] ?? null;

/** Switched off? (a method object or its name) */
const isOff = (guildId, method) => Boolean(guildId && find(guildId, method?.name ?? method));

/** The methods that can be picked now, with their index in config.shop.paymentMethods (the form value). */
const activeMethods = (guildId) => config.shop.paymentMethods.map((m, index) => ({ m, index })).filter(({ m }) => !isOff(guildId, m));

/** All methods are configured but every one is off. */
const allOff = (guildId) => config.shop.paymentMethods.length > 0 && activeMethods(guildId).length === 0;

/** "⛔ temporarily unavailable (reason)" or null. */
function offNote(guildId, method) {
  const s = find(guildId, method?.name ?? method);
  return s ? `⛔ temporarily unavailable${s.reason ? ` – ${s.reason}` : ''}` : null;
}

/** A form picked a switched-off method (an old form left open) → a clear error. */
function assertOn(guildId, name) {
  if (name && isOff(guildId, name)) throw new UserError(`**${name}** is temporarily unavailable – please pick another payment method.`);
}

function set(guildId, name, off, { by = null, reason = null } = {}) {
  const g = db.guild(guildId);
  g.disabledMethods ??= {};
  for (const k of Object.keys(g.disabledMethods)) if (key(k) === key(name)) delete g.disabledMethods[k];
  if (off) g.disabledMethods[name] = { by, at: Date.now(), reason: reason || null };
  db.save();
}

module.exports = { isOff, activeMethods, allOff, offNote, assertOn, set };
