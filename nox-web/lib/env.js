'use strict';

/** Settings from .env (or the real environment). Nothing here is required – a missing key just turns that part off. */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(ROOT, '.env'));

const str = (name, fallback = '') => (process.env[name] ?? fallback).trim();

/** "9.90", "9,90", "990c" → cents. */
function cents(raw, fallback) {
  const s = String(raw ?? '').trim();
  if (!s) return fallback;
  if (/^\d+c$/i.test(s)) return Number(s.slice(0, -1));
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : fallback;
}

const env = {
  root: ROOT,
  port: Number(str('PORT', '3000')) || 3000,
  /** The address people open, e.g. https://nox.example.com – used for the Discord and Stripe return links. */
  publicUrl: str('PUBLIC_URL', '').replace(/\/+$/, ''),
  dataDir: str('DATA_DIR', path.join(ROOT, 'data')),

  discordClientId: str('DISCORD_CLIENT_ID'),
  discordClientSecret: str('DISCORD_CLIENT_SECRET'),
  discordInvite: str('DISCORD_INVITE_URL'),
  /** A channel webhook: every paid order is posted there so the team can deliver it. */
  discordOrderWebhook: str('DISCORD_ORDER_WEBHOOK_URL'),

  stripeKey: str('STRIPE_SECRET_KEY'),
  stripeWebhookSecret: str('STRIPE_WEBHOOK_SECRET'),
  currency: str('CURRENCY', 'eur').toLowerCase(),
  /** The one-time NØX Access price, e.g. 9.90. 0 = access is free (only Discord sign-in needed). */
  accessPrice: cents(process.env.ACCESS_PRICE, 990),

  // Tests point these at local fakes.
  discordApi: str('DISCORD_API_BASE', 'https://discord.com/api'),
  discordAuthorize: str('DISCORD_AUTHORIZE_URL', 'https://discord.com/oauth2/authorize'),
  stripeApi: str('STRIPE_API_BASE', 'https://api.stripe.com/v1'),
};

env.authReady = Boolean(env.discordClientId && env.discordClientSecret && env.publicUrl);
env.paymentsReady = Boolean(env.stripeKey && env.publicUrl);
/** Without Discord and Stripe the site shows its clearly marked offline preview (demo account, no real payments). */
env.preview = !env.authReady || !env.paymentsReady;

module.exports = { env, cents };
