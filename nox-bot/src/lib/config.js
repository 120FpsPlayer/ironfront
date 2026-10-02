'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_PATH = process.env.NOX_CONFIG_PATH || path.join(__dirname, '..', '..', 'config.json');

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
  raw.brand.colorInt = parseInt(String(raw.brand.color ?? '#A855F7').replace('#', ''), 16) || 0xa855f7;
  raw.panel ??= {};
  raw.panel.rules ??= [];
  raw.workingHours ??= { enabled: false };
  raw.channelNameFormat ??= '{prio}{prefix}-{number}';
  raw.defaults ??= {};
  raw.server ??= {};
  raw.emojis ??= {};
  raw.emojis.prefix ??= 'nox_';
  raw.verification ??= { captcha: true, minAccountAgeDays: 0 };
  raw.welcome ??= { enabled: true };
  raw.shop ??= {};
  raw.shop.paymentMethods ??= [];
  raw.vouches ??= {};
  return raw;
}

const config = load();
const reloadHooks = [];

config.getType = (id) => config.ticketTypes.find((t) => t.id === id) ?? null;

/**
 * Re-reads config.json while the bot is running (/reload). The same object is updated, so every
 * module sees the new values. If the file is invalid, an error is thrown and nothing changes.
 */
config.reload = () => {
  const fresh = load();
  for (const key of Object.keys(config)) if (typeof config[key] !== 'function') delete config[key];
  Object.assign(config, fresh);
  for (const hook of reloadHooks) hook(config);
  return config;
};

/** Run something after every reload (e.g. update cached colors). */
config.onReload = (hook) => reloadHooks.push(hook);
Object.defineProperty(config, 'path', { value: CONFIG_PATH, enumerable: false });

module.exports = config;
