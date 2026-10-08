'use strict';

const fs = require('node:fs');
const path = require('node:path');
const hours = require('./hours');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

/**
 * Sections added in later versions. A config.json without them (kept from an older version) gets exactly
 * what the shipped config.json has, so updating the bot never turns a feature off without anyone noticing.
 */
const FEATURE_DEFAULTS = {
  orders: { receipts: true, proofs: true, vouchReminderHours: 24, statusDms: true, paymentProofs: true },
  badges: { enabled: true, bestsellerMinSales: 3, ratingMinVouches: 2 },
  staffReminders: { enabled: true, unclaimedMinutes: 15, repeatMinutes: 60 },
  stripe: { enabled: true, currency: '' },
  paypal: { enabled: true, currency: '' },
  crypto: { currency: '', autoVerify: true, confirmations: { BTC: 1, ETH: 12 } },
  cart: { enabled: true, maxItems: 10 },
  gifts: { enabled: true },
  balance: { enabled: true, topUpMin: 5, topUpMax: 500 },
  affiliates: { enabled: true, discountPercent: 5, commissionPercent: 10 },
  abandonedOrders: { enabled: true, afterHours: 24, percent: 5, validDays: 3 },
  deals: { enabled: true, minPercent: 25, maxPercent: 50, daysPerWeek: [1, 2], hours: 24 },
  promos: { enabled: true },
  welcomeDiscount: { enabled: true, percent: 5, validDays: 7 },
  invites: {
    enabled: true,
    rewards: [
      { invites: 5, percent: 10 },
      { invites: 15, percent: 15 },
      { invites: 30, percent: 20 },
    ],
  },
  shopStatus: { enabled: true, openName: '🟢 Shop open', closedName: '🔴 Shop closed' },
  security: { impersonationAlerts: true, lockdownPausesInvites: true },
  backups: { enabled: true, everyHours: 24 },
  salesReport: { enabled: true, weekday: 1, hour: 10 },
};

/** Switches someone can turn off in config.json → [what is off, where, the same test the feature uses]. */
const SWITCHES = [
  ['promo codes', 'promos.enabled', (c) => c.promos.enabled === false],
  ['first-purchase code', 'welcomeDiscount.enabled', (c) => !c.welcomeDiscount.enabled],
  ['invite tracking', 'invites.enabled', (c) => c.invites.enabled === false],
  ['shop status channel', 'shopStatus.enabled', (c) => !c.shopStatus.enabled],
  ['automatic backups', 'backups.enabled', (c) => !c.backups.enabled],
  ['weekly sales report', 'salesReport.enabled', (c) => !c.salesReport.enabled],
  ['look-alike alerts', 'security.impersonationAlerts', (c) => !c.security.impersonationAlerts],
  ['receipts by DM', 'orders.receipts', (c) => !c.orders.receipts],
  ['#proofs posts', 'orders.proofs', (c) => !c.orders.proofs],
  ['vouch reminders', 'orders.vouchReminderHours', (c) => !(Number(c.orders.vouchReminderHours) > 0)],
  ['order status DMs', 'orders.statusDms', (c) => !c.orders.statusDms],
  ['"Pay" button (PIN / proof form)', 'orders.paymentProofs', (c) => !c.orders.paymentProofs],
  ['shop badges', 'badges.enabled', (c) => !c.badges.enabled],
  ['unclaimed ticket reminders', 'staffReminders.enabled', (c) => !c.staffReminders.enabled],
  ['opening hours', 'workingHours.enabled', (c) => !c.workingHours.enabled],
];

/** "automatic backups (backups.enabled), …" – the features config.json turns off (empty when none). */
const turnedOff = (c) => SWITCHES.filter(([, , off]) => off(c)).map(([what, where]) => `${what} (${where})`);

function read() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`config.json could not be read: ${err.message}`);
  }
}

/** Checks the raw config.json object and fills in the defaults (changes and returns it). */
function load(raw = read()) {
  if (!Array.isArray(raw.ticketTypes) || raw.ticketTypes.length === 0) {
    throw new Error('config.json: "ticketTypes" must contain at least one ticket type.');
  }
  if (raw.ticketTypes.length > 25) throw new Error('config.json: a maximum of 25 ticket types is allowed (Discord limit).');
  if (!raw.ticketTypes.some((t) => t.id === 'order')) {
    throw new Error('config.json: the "order" ticket type is required (the shop uses it for purchases).');
  }

  const ids = new Set();
  for (const type of raw.ticketTypes) {
    if (!type.id || !/^[a-z0-9_-]{1,32}$/.test(type.id)) {
      throw new Error(`config.json: invalid ticket type id "${type.id}" (allowed: a-z, 0-9, _ and -).`);
    }
    if (ids.has(type.id)) throw new Error(`config.json: duplicate ticket type id "${type.id}".`);
    ids.add(type.id);
    type.questions ??= [];
    type.staffRoleIds ??= [];
    type.staffRoles ??= [];
    type.channelPrefix ??= type.id;
    type.shopOnly = Boolean(type.shopOnly); // only through Buy in #shop – the ticket panel links to the shop instead
    if (type.questions.length > 5) throw new Error(`config.json: ticket type "${type.id}" has more than 5 questions (Discord form limit).`);
    for (const q of type.questions) {
      if (!q.id || !q.label) throw new Error(`config.json: every question in "${type.id}" needs an "id" and a "label".`);
    }
  }

  raw.snippets ??= [];
  for (const s of raw.snippets) {
    if (!s.id || !s.content) throw new Error('config.json: every canned reply (snippets) needs an "id" and "content".');
    s.name ??= s.id;
  }

  raw.brand ??= {};
  raw.brand.name ??= 'NØX';
  raw.brand.name = String(raw.brand.name).trim();
  if (raw.brand.name.length < 2 || raw.brand.name.length > 100) {
    throw new Error('config.json: "brand.name" must be 2–100 characters (Discord server name limit).');
  }
  raw.brand.colorInt = parseInt(String(raw.brand.color ?? '#A855F7').replace('#', ''), 16) || 0xa855f7;
  raw.panel ??= {};
  raw.panel.rules ??= [];
  raw.workingHours ??= { enabled: false };
  const hoursProblem = hours.problem(raw.workingHours);
  if (hoursProblem) throw new Error(`config.json: "workingHours": ${hoursProblem}.`);
  raw.channelNameFormat ??= '{prio}{prefix}-{number}';
  raw.defaults ??= {};
  raw.server ??= {};
  raw.server.channelStyle ??= '{emoji}┃{name}';
  raw.server.categoryStyle ??= '〔 {name} 〕';
  raw.server.smallCaps ??= true;
  for (const key of ['channelStyle', 'categoryStyle']) {
    if (typeof raw.server[key] !== 'string' || !raw.server[key].includes('{name}')) {
      throw new Error(`config.json: "server.${key}" must contain {name} (e.g. "${key === 'channelStyle' ? '{emoji}┃{name}' : '〔 {name} 〕'}").`);
    }
  }
  raw.emojis ??= {};
  raw.emojis.prefix ??= 'nox_';
  raw.verification ??= { captcha: true, minAccountAgeDays: 0 };
  raw.welcome ??= { enabled: true };
  raw.shop ??= {};
  raw.shop.paymentMethods ??= [];
  raw.shop.lowStockAt ??= 3; // a stock counter at or below this shows "Low stock"
  // Written from workingHours, so the panels and the info cards always show the same hours (set it to override).
  raw.shop.supportHours ??= hours.hoursText(raw.workingHours);
  raw.vouches ??= {};
  for (const [key, defaults] of Object.entries(FEATURE_DEFAULTS)) raw[key] = { ...JSON.parse(JSON.stringify(defaults)), ...raw[key] }; // a copy – nested lists are never shared
  return raw;
}

const config = load();

config.getType = (id) => config.ticketTypes.find((t) => t.id === id) ?? null;
/** The features config.json turns off – printed once at startup and by npm run check. */
config.turnedOff = (c = config) => turnedOff(c);
/** For tests: the same checks and defaults for another config.json object. */
config.load = load;

module.exports = config;
