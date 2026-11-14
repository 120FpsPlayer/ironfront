'use strict';

/**
 * Ticket categories that are switched off for a while (e.g. „Rekrutacja” while the team isn't hiring): the panel shows
 * them as „wyłączona” and nobody can open one. config.json can start a type off (`"disabled": true`); /tickety
 * wylacz|wlacz decides per server from then on (db.guild(id).ticketTypesOff = { [typeId]: { off, by, at } }).
 */

const config = require('../lib/config');
const db = require('../lib/db');

const stateOf = (guildId) => db.guild(guildId).ticketTypesOff ?? {};

/** Is this ticket type switched off on the server? */
function isOff(guildId, type) {
  if (!type) return false;
  const saved = stateOf(guildId)[type.id];
  return saved ? Boolean(saved.off) : Boolean(type.disabled);
}

/** Switches a type off (off = true) or on again. → the type. */
function set(guildId, typeId, off, by = null, now = Date.now()) {
  const type = config.getType(typeId);
  if (!type) throw new Error(`Nie ma kategorii ticketów „${typeId}”.`);
  const g = db.guild(guildId);
  g.ticketTypesOff = { ...(g.ticketTypesOff ?? {}), [type.id]: { off: Boolean(off), by, at: now } };
  db.save();
  return type;
}

/** The Polish answer for someone who tries to open a switched-off type. */
function closedText(type) {
  if (type.id === 'apply') return '⛔ **Rekrutacja jest teraz wyłączona** – nie przyjmujemy podań. Gdy ruszy, ogłosimy to na kanale z ogłoszeniami.';
  return `⛔ Kategoria **${type.label}** jest teraz wyłączona. Wybierz inną kategorię albo spróbuj ponownie później.`;
}

module.exports = { isOff, set, closedText };
