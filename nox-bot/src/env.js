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
  /** The store website (src/web, src/features/website.js) – served by the bot itself on this port. */
  web: webSettings(),
  ids,
};

/** "9.90" / "9,90" → 990 (cents); empty → fallback. */
function cents(raw, fallback) {
  const t = String(raw ?? '').trim();
  if (!t) return fallback;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : fallback;
}

function webSettings() {
  const str = (name) => (process.env[name] || '').trim();
  // WEB_PORT, or the port a hosting panel gives the server (Pterodactyl: SERVER_PORT, most others: PORT).
  const port = Number(str('WEB_PORT') || str('SERVER_PORT') || str('PORT')) || null;
  const guessed = port && str('SERVER_IP') && str('SERVER_IP') !== '0.0.0.0' ? `http://${str('SERVER_IP')}:${port}` : '';
  return {
    enabled: bool('WEB_ENABLED', true) && Boolean(port),
    port,
    /** The address people open, e.g. https://nox.example.com (for Discord sign-in and the Stripe return links). */
    publicUrl: (str('PUBLIC_URL') || guessed).replace(/\/+$/, ''),
    /** OAuth2 → Client Secret of the bot's application (Discord sign-in). The client ID is the bot's own. */
    clientId: str('DISCORD_CLIENT_ID'),
    clientSecret: str('DISCORD_CLIENT_SECRET'),
    stripeWebhookSecret: str('STRIPE_WEBHOOK_SECRET'),
    /** The one-time NØX Access price (0 = free – signing in with Discord is enough). */
    accessPrice: cents(process.env.WEB_ACCESS_PRICE, 990),
    /** The server whose shop the website sells (default: GUILD_ID, or the one server the bot is in). */
    guildId: str('WEB_GUILD_ID') || null,
    /** Invite for the Support / community buttons – empty: the bot makes a permanent one itself. */
    invite: str('DISCORD_INVITE_URL'),
    // Tests point these at local fakes.
    discordApi: str('DISCORD_API_BASE') || 'https://discord.com/api',
    discordAuthorize: str('DISCORD_AUTHORIZE_URL') || 'https://discord.com/oauth2/authorize',
    stripeApi: str('STRIPE_API_BASE') || 'https://api.stripe.com/v1',
  };
}

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
