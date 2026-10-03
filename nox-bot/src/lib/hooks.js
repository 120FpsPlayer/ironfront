'use strict';

/**
 * A small plug-in bus, so a feature lives in one file under src/features/ and doesn't need edits in
 * index.js or the interaction router:
 *
 *   hooks.on('memberAdd', (member) => …)          Discord events – see DISCORD_EVENTS in src/index.js
 *   hooks.on('verified', (member) => …)           bot events (listed below)
 *   hooks.every('backup', 60_000, (client) => …)  timers, started once the bot is ready
 *   hooks.route('promo', { button, select, modal, dm })   components with custom IDs "promo:…"
 *
 * Bot events:
 *   verified(member)                               someone passed verification
 *   orderCompleted({ guild, ticket, member, staff, sale })   a purchase was marked as completed
 *   productRestocked({ guild, product })           a sold-out product is buyable again
 */

const listeners = new Map();
const timers = [];
const routes = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, []);
  listeners.get(event).push(fn);
}

/** Runs every listener in order; one failing listener never stops the others. */
async function emit(event, ...args) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      await fn(...args);
    } catch (err) {
      console.warn(`[${event}]`, err?.message ?? err);
    }
  }
}

function every(name, ms, fn, firstDelay = ms) {
  timers.push({ name, ms, fn, firstDelay });
}

/**
 * @param {string} scope first part of the custom ID
 * @param {{ button?: Function, select?: Function, userSelect?: Function, modal?: Function, dm?: boolean }} handlers
 *   each handler gets (interaction, action, args); dm: true lets it work in DMs too (interaction.guild is null there)
 */
function route(scope, handlers) {
  routes.set(scope, handlers);
}

module.exports = { on, emit, every, route, timers: () => [...timers], routeFor: (scope) => routes.get(scope) ?? null };
