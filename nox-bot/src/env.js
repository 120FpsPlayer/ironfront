'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Minimal .env loader (no dependencies). Supports comments, quotes and "=" inside values.
 * Variables already set in the environment win. A Windows BOM is stripped.
 */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

// Look for .env next to index.js and in the working directory (hosting panels run from /home/container).
const PROJECT_DIR = path.join(__dirname, '..');
const ENV_CANDIDATES = [...new Set([path.join(PROJECT_DIR, '.env'), path.join(process.cwd(), '.env')])];
const loadedEnvFiles = ENV_CANDIDATES.filter((file) => loadEnvFile(file));

/** All 17–20 digit IDs from a variable (commas, spaces, mentions – anything works). */
function ids(name) {
  const names = [name, name.replace(/_IDS(?=$|_)/, '_ID')];
  const found = [];
  for (const key of new Set(names)) {
    const raw = process.env[key];
    if (!raw) continue;
    const list = raw.match(/\d{17,20}/g) ?? [];
    if (!list.length && raw.trim()) console.warn(`[.env] ${key}: no valid ID found (17–20 digits).`);
    found.push(...list);
  }
  return [...new Set(found)];
}

function bool(name, fallback) {
  const v = process.env[name]?.trim().toLowerCase();
  if (!v) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(v);
}

const env = {
  token: (process.env.DISCORD_TOKEN || '').trim(),
  /** With a server ID, slash commands appear instantly on that server. */
  guildId: ids('GUILD_ID')[0] ?? null,
  autoDeployCommands: bool('AUTO_DEPLOY_COMMANDS', true),
  /** Extra bot owners (user IDs) – they can use every command, including /build. */
  ownerIds: ids('OWNER_IDS'),
  /** Optional extra admin / support roles (the roles created by /build are used automatically). */
  adminRoleIds: ids('ADMIN_ROLE_IDS'),
  supportRoleIds: ids('SUPPORT_ROLE_IDS'),
  openRoleIds: ids('OPEN_ROLE_IDS'),
  blockedRoleIds: ids('BLOCKED_ROLE_IDS'),
  discordAdminsAreAdmins: bool('DISCORD_ADMINS_ARE_ADMINS', true),
  staffCanDelete: bool('STAFF_CAN_DELETE', true),
  ownerCanClose: bool('OWNER_CAN_CLOSE', true),
  /** Stripe secret (or restricted) key – card payment links in order tickets (src/features/stripe.js). */
  stripeKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
  /** PayPal REST app – PayPal payment links that confirm themselves (src/features/paypal.js). */
  paypalClientId: (process.env.PAYPAL_CLIENT_ID || '').trim(),
  paypalSecret: (process.env.PAYPAL_CLIENT_SECRET || '').trim(),
  paypalSandbox: bool('PAYPAL_SANDBOX', false),
  ids,
};

function validateEnv() {
  const problems = [];
  if (!env.token || env.token === 'YOUR_BOT_TOKEN') {
    problems.push(loadedEnvFiles.length
      ? `Missing bot token. Fill in DISCORD_TOKEN in: ${loadedEnvFiles.join(', ')}`
      : `Missing bot token and no .env file found. Create a .env file (copy .env.example) in: ${ENV_CANDIDATES.join(' or ')}`);
  } else if (env.token.split('.').length !== 3) {
    problems.push('DISCORD_TOKEN looks invalid – copy it again from the Discord Developer Portal (Bot tab → Reset Token).');
  }
  return problems;
}

module.exports = { env, validateEnv, loadEnvFile, loadedEnvFiles };
