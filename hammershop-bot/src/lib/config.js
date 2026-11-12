'use strict';

const fs = require('node:fs');
const path = require('node:path');
const hours = require('./hours');
const profile = require('./profile');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');
/** The Hammer Launcher server (BOT_PROFILE=launcher): what it says and does differently, laid over config.json. */
const LAUNCHER_PATH = path.join(__dirname, '..', '..', 'config.launcher.json');

/**
 * Sections added in later versions. A config.json without them (kept from an older version) gets exactly
 * what the shipped config.json has, so updating the bot never turns a feature off without anyone noticing.
 */
const FEATURE_DEFAULTS = {
  rules: { file: 'regulamin.md', seller: '', email: '' },
  chatFilter: { enabled: true, noLinks: ['chat'], allowGifs: true, allowedDomains: [], slurs: 'everywhere', profanity: 'public', extraWords: [], allowedWords: [], strikes: 3, strikeMinutes: 10, timeoutMinutes: 10 },
  orders: { receipts: true, proofs: true, vouchReminderHours: 24, statusDms: true, paymentProofs: true, pinViewers: ['731478953222602822'] },
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
  shopStatus: { enabled: true, openName: '🟢 Sklep otwarty', closedName: '🔴 Sklep zamknięty' },
  security: { impersonationAlerts: true, lockdownPausesInvites: true },
  backups: { enabled: true, everyHours: 24 },
  salesReport: { enabled: true, weekday: 1, hour: 10 },
};

/** Switches someone can turn off in config.json → [what is off, where, the same test the feature uses]. */
const SWITCHES = [
  ['kody rabatowe', 'promos.enabled', (c) => c.promos.enabled === false],
  ['kod na pierwszy zakup', 'welcomeDiscount.enabled', (c) => !c.welcomeDiscount.enabled],
  ['śledzenie zaproszeń', 'invites.enabled', (c) => c.invites.enabled === false],
  ['kanał statusu sklepu', 'shopStatus.enabled', (c) => !c.shopStatus.enabled],
  ['automatyczne kopie zapasowe', 'backups.enabled', (c) => !c.backups.enabled],
  ['tygodniowy raport sprzedaży', 'salesReport.enabled', (c) => !c.salesReport.enabled],
  ['alerty o podszywaniu się', 'security.impersonationAlerts', (c) => !c.security.impersonationAlerts],
  ['potwierdzenia zakupu w DM', 'orders.receipts', (c) => !c.orders.receipts],
  ['posty na #realizacje', 'orders.proofs', (c) => !c.orders.proofs],
  ['przypomnienia o opinii', 'orders.vouchReminderHours', (c) => !(Number(c.orders.vouchReminderHours) > 0)],
  ['DM o statusie zamówienia', 'orders.statusDms', (c) => !c.orders.statusDms],
  ['przycisk „Zapłać” (formularz z PIN-em / dowodem płatności)', 'orders.paymentProofs', (c) => !c.orders.paymentProofs],
  ['odznaki w sklepie', 'badges.enabled', (c) => !c.badges.enabled],
  ['przypomnienia o nieprzejętych ticketach', 'staffReminders.enabled', (c) => !c.staffReminders.enabled],
  ['godziny pracy', 'workingHours.enabled', (c) => !c.workingHours.enabled],
];

/** "automatyczne kopie zapasowe (backups.enabled), …" – the features config.json turns off (empty when none). */
const turnedOff = (c) => SWITCHES.filter(([, , off]) => off(c)).map(([what, where]) => `${what} (${where})`);

/** b laid over a: objects are merged key by key, everything else (lists too) is replaced. */
function overlay(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !a || typeof a !== 'object' || Array.isArray(a)) return b;
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) out[key] = key in a ? overlay(a[key], value) : value;
  return out;
}

function readFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Nie można odczytać pliku ${label}: ${err.message}`);
  }
}

function read() {
  const base = readFile(CONFIG_PATH, 'config.json');
  return profile.launcher ? overlay(base, readFile(LAUNCHER_PATH, 'config.launcher.json')) : base;
}

/** Checks the raw config.json object and fills in the defaults (changes and returns it). */
function load(raw = read()) {
  if (!Array.isArray(raw.ticketTypes) || raw.ticketTypes.length === 0) {
    throw new Error('config.json: "ticketTypes" musi zawierać co najmniej jeden typ ticketu.');
  }
  if (raw.ticketTypes.length > 25) throw new Error('config.json: dozwolone jest maksymalnie 25 typów ticketów (limit Discorda).');
  if (!raw.ticketTypes.some((t) => t.id === 'order')) {
    throw new Error('config.json: typ ticketu "order" jest wymagany (sklep używa go do zakupów).');
  }

  const ids = new Set();
  for (const type of raw.ticketTypes) {
    if (!type.id || !/^[a-z0-9_-]{1,32}$/.test(type.id)) {
      throw new Error(`config.json: nieprawidłowe id typu ticketu "${type.id}" (dozwolone: a-z, 0-9, _ i -).`);
    }
    if (ids.has(type.id)) throw new Error(`config.json: id typu ticketu "${type.id}" występuje więcej niż raz.`);
    ids.add(type.id);
    type.questions ??= [];
    type.staffRoleIds ??= [];
    type.staffRoles ??= [];
    type.channelPrefix ??= type.id;
    type.shopOnly = Boolean(type.shopOnly); // only through Buy in #shop – the ticket panel links to the shop instead
    if (type.questions.length > 5) throw new Error(`config.json: typ ticketu "${type.id}" ma więcej niż 5 pytań (limit formularza na Discordzie).`);
    for (const q of type.questions) {
      if (!q.id || !q.label) throw new Error(`config.json: każde pytanie w "${type.id}" musi mieć "id" i "label".`);
    }
  }

  raw.snippets ??= [];
  for (const s of raw.snippets) {
    if (!s.id || !s.content) throw new Error('config.json: każda gotowa odpowiedź (snippets) musi mieć "id" i "content".');
    s.name ??= s.id;
  }

  raw.brand ??= {};
  raw.brand.name ??= 'HammerShop';
  raw.brand.name = String(raw.brand.name).trim();
  if (raw.brand.name.length < 2 || raw.brand.name.length > 100) {
    throw new Error('config.json: "brand.name" musi mieć 2–100 znaków (limit nazwy serwera na Discordzie).');
  }
  raw.brand.colorInt = parseInt(String(raw.brand.color ?? '#FF9F43').replace('#', ''), 16) || 0xff9f43;
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
      throw new Error(`config.json: "server.${key}" musi zawierać {name} (np. "${key === 'channelStyle' ? '{emoji}┃{name}' : '〔 {name} 〕'}").`);
    }
  }
  raw.emojis ??= {};
  raw.emojis.prefix ??= 'hs_';
  raw.verification ??= { captcha: true, minAccountAgeDays: 0 };
  raw.welcome ??= { enabled: true };
  raw.shop ??= {};
  raw.shop.paymentMethods ??= [];
  raw.shop.lowStockAt ??= 3; // a stock counter at or below this shows "Mało sztuk"
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
config.overlay = overlay;

module.exports = config;
