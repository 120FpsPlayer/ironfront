'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { hoursText } = require('./hours');

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`config.json could not be read: ${err.message}`);
  }

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
  // Written from workingHours, so the panels and the info cards always show the same hours (set it to override).
  raw.shop.supportHours ??= hoursText(raw.workingHours);
  raw.vouches ??= {};
  raw.orders = { receipts: true, proofs: true, vouchReminderHours: 24, ...raw.orders };
  raw.promos = { enabled: true, ...raw.promos };
  raw.welcomeDiscount = { enabled: false, percent: 5, validDays: 7, ...raw.welcomeDiscount };
  raw.invites = { enabled: false, rewards: [], ...raw.invites };
  raw.shopStatus = { enabled: false, openName: '🟢 Shop open', closedName: '🔴 Shop closed', ...raw.shopStatus };
  raw.security = { impersonationAlerts: true, lockdownPausesInvites: true, ...raw.security };
  raw.backups = { enabled: false, everyHours: 24, ...raw.backups };
  raw.salesReport = { enabled: false, weekday: 1, hour: 10, ...raw.salesReport };
  return raw;
}

const config = load();

config.getType = (id) => config.ticketTypes.find((t) => t.id === id) ?? null;

module.exports = config;
