'use strict';

/**
 * Currency codes for payment providers (Stripe, PayPal, crypto rates): "€" → "eur".
 * Amounts in the smallest unit use the currency's decimals: 12.50€ → 1250, ¥1200 → 1200.
 */

const config = require('./config');

const DECIMALS = { eur: 2, usd: 2, gbp: 2, pln: 2, chf: 2, sek: 2, nok: 2, dkk: 2, czk: 2, ron: 2, bgn: 2, cad: 2, aud: 2, nzd: 2, jpy: 0, krw: 0 };
const SYMBOLS = { '€': 'eur', $: 'usd', '£': 'gbp', zł: 'pln', kč: 'czk', '¥': 'jpy', '₩': 'krw' };

/**
 * "eur" – the provider's own setting (config.json → stripe.currency / paypal.currency) or worked out from
 * shop.currency (€ → eur, $ → usd, zł → pln). null when it isn't clear (e.g. "kr" – SEK, NOK or DKK?):
 * then no payment links are made rather than charging the wrong currency.
 */
function currencyCode(override = '') {
  const set = String(override ?? '').trim().toLowerCase();
  if (set) return set in DECIMALS ? set : null;
  const shop = String(config.shop.currency ?? '€').trim().toLowerCase();
  return SYMBOLS[shop] ?? (shop in DECIMALS ? shop : null);
}

const toUnits = (amount, cur) => Math.round(amount * 10 ** DECIMALS[cur]);
const fromUnits = (units, cur) => units / 10 ** (DECIMALS[cur] ?? 2);
/** 24 → "24.00" (¥ → "24") – for APIs that take the amount as text. */
const decimalString = (amount, cur) => Number(amount).toFixed(DECIMALS[cur] ?? 2);

module.exports = { DECIMALS, SYMBOLS, currencyCode, toUnits, fromUnits, decimalString };
