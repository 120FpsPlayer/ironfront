'use strict';

/**
 * The payment card: right after an order is placed in the shop, its ticket gets a card "💳 Pay 24€" with
 * what to do for the payment method the customer picked (config.json → shop.paymentMethods):
 *   paysafecard – buy a PaysafeCard for the total, then "Enter PIN" (the "I've paid" form with the PIN field)
 *   crypto      – the wallet addresses ("addresses": { "BTC": "…", "ETH": "…" }) with the amount in coins at
 *                 today's rate, then "I've paid" with the transaction ID or a screenshot
 *   paypal      – with PayPal keys in .env a link that confirms itself (src/features/paypal.js); else a
 *                 paypal.me link with the amount ("paypalMe": "yourname"), then "I've paid" with a screenshot
 *   stripe      – a Stripe link (src/features/stripe.js); without a key the seller sends one
 * A method's kind is its "type", or guessed from its name for configs from older versions.
 */

const { ButtonStyle } = require('discord.js');
const config = require('../lib/config');
const hooks = require('../lib/hooks');
const { COLORS, e, ce } = require('../lib/theme');
const { currencyCode } = require('../lib/currency');
const { money, pad, ts, truncate } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, v2 } = require('../lib/v2');

const TYPES = ['paysafecard', 'crypto', 'paypal', 'stripe'];

/** "paysafecard" | "crypto" | "paypal" | "stripe" | "other" */
function methodType(m) {
  if (TYPES.includes(m?.type)) return m.type;
  if (m?.stripe === true) return 'stripe';
  const name = `${m?.name ?? ''} ${m?.emoji ?? ''}`;
  if (/paysafe/i.test(name)) return 'paysafecard';
  if (/paypal/i.test(name)) return 'paypal';
  if (/stripe/i.test(name)) return 'stripe';
  if (/crypto|bitcoin|btc|ethereum|eth\b|usdt|litecoin/i.test(name)) return 'crypto';
  return 'other';
}

/** The payment method an order was placed with – the one picked in the order form (or found by name). */
function methodOf(order) {
  if (!order?.method) return null;
  const list = config.shop.paymentMethods;
  const picked = list[order.methodIndex];
  if (picked && picked.name === order.method) return picked;
  return list.find((m) => m.name === order.method) ?? { name: order.method };
}

// ───────────── Crypto: wallets and rates ─────────────

const COINS = {
  BTC: { id: 'bitcoin', name: 'Bitcoin', digits: 8 },
  ETH: { id: 'ethereum', name: 'Ethereum', digits: 6 },
  LTC: { id: 'litecoin', name: 'Litecoin', digits: 6 },
  SOL: { id: 'solana', name: 'Solana', digits: 4 },
  USDT: { id: 'tether', name: 'Tether (USDT)', digits: 2 },
  USDC: { id: 'usd-coin', name: 'USD Coin', digits: 2 },
  XMR: { id: 'monero', name: 'Monero', digits: 6 },
  DOGE: { id: 'dogecoin', name: 'Dogecoin', digits: 2 },
  TRX: { id: 'tron', name: 'Tron', digits: 2 },
  BNB: { id: 'binancecoin', name: 'BNB', digits: 6 },
};
const RATE_TTL = 5 * 60_000;
let rateCache = { key: '', at: 0, rates: {} };

/** [{ code: 'BTC', name, address }] – the wallets of a crypto method that are filled in. */
function wallets(m) {
  return Object.entries(m?.addresses ?? {})
    .map(([code, address]) => ({ code: String(code).toUpperCase(), address: String(address ?? '').trim() }))
    .filter((w) => w.address && w.address.length <= 120)
    .map((w) => ({ ...w, name: COINS[w.code]?.name ?? w.code }));
}

/** { BTC: 61234.5, … } – the price of one coin in the shop currency (CoinGecko, cached 5 min); {} when unknown. */
async function cryptoRates(codes, now = Date.now()) {
  const cur = currencyCode(config.crypto?.currency);
  const known = codes.filter((c) => COINS[c]);
  if (!cur || !known.length) return {};
  const key = `${cur}:${known.sort().join(',')}`;
  if (rateCache.key === key && now - rateCache.at < RATE_TTL) return rateCache.rates;
  try {
    const ids = known.map((c) => COINS[c].id).join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=${cur}`, { signal: AbortSignal.timeout(4_000) });
    if (!res.ok) return {};
    const data = await res.json();
    const rates = {};
    for (const c of known) {
      const price = Number(data?.[COINS[c].id]?.[cur]);
      if (price > 0) rates[c] = price;
    }
    rateCache = { key, at: now, rates };
    return rates;
  } catch {
    return {}; // no rates – the card shows the amount in the shop currency only
  }
}

/** 24€ at 61234.5 → "0.00039194" (rounded UP, so the seller never gets less). */
function coinAmount(total, rate, code) {
  const digits = COINS[code]?.digits ?? 6;
  const factor = 10 ** digits;
  return (Math.ceil((total / rate) * factor) / factor).toFixed(digits);
}

// ───────────── PayPal.me ─────────────

/** "https://paypal.me/NoxShop" / "@NoxShop" / "NoxShop" → "NoxShop" (null when it isn't a valid name). */
function paypalMeName(raw) {
  const s = String(raw ?? '').trim().replace(/^https?:\/\/(www\.)?paypal\.me\//i, '').replace(/^@/, '').replace(/\/.*$/, '');
  return /^[A-Za-z0-9]{1,20}$/.test(s) ? s : null;
}

/** paypal.me/NoxShop/24EUR – the amount filled in for the customer. */
function paypalMeUrl(name, total) {
  const cur = currencyCode(config.paypal?.currency);
  const amount = total > 0 && cur ? `/${Number(total).toFixed(2)}${cur.toUpperCase()}` : '';
  return `https://paypal.me/${name}${amount}`;
}

// ───────────── The card ─────────────

const proofsOn = () => config.orders?.paymentProofs !== false;

/** The payment card for an order – null for nothing to show. */
async function paymentCard(guild, ticket, order, { now = Date.now() } = {}) {
  const m = methodOf(order);
  if (!m) return null;
  const type = methodType(m);
  const total = order.total > 0 ? order.total : null;
  const amount = total != null ? `**${money(total)}**` : 'the amount the seller confirms';
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `## ${e(guild, m.emoji ?? 'card')} ${total != null ? `Pay ${money(total)}` : 'Payment'} – ${truncate(m.name, 60)}\n` +
        `-# Order \`#${pad(ticket.number)}\` · ${truncate(order.product || 'Custom order', 80)} × ${order.quantity ?? 1}`,
    ),
  );
  c.addSeparatorComponents(divider());
  const buttons = [];
  const paid = (label = "I've paid", emoji = '💳') => proofsOn() && buttons.push(btn('pay:open', label, emoji, ButtonStyle.Success));
  const proofText = (what) => (proofsOn() ? `then click **I've paid** and send ${what}` : `then send ${what} here in the ticket`);
  const proofSentence = (what) => (proofsOn() ? `Then click **I've paid** and send ${what}.` : `Then send ${what} here in the ticket.`);

  if (type === 'paysafecard') {
    c.addTextDisplayComponents(
      text(
        `**1.** Buy a **PaysafeCard** worth ${amount} – at a kiosk, petrol station or online.\n` +
          `**2.** ${proofsOn() ? 'Click **Enter PIN** and send' : 'Send'} the 16-digit PIN – a photo of the receipt helps.\n` +
          '-# 🔒 Only send the PIN here in your ticket – never in DMs.',
      ),
    );
    paid('Enter PIN', '🔑');
  } else if (type === 'crypto') {
    const list = wallets(m);
    if (!list.length) {
      c.addTextDisplayComponents(text(`A seller sends you the wallet address here – send ${amount}, ${proofText('the transaction ID or a screenshot')}.`));
    } else {
      const rates = total != null ? await cryptoRates(list.map((w) => w.code), now) : {};
      const lines = list.map((w) => {
        const coins = rates[w.code] ? ` – **≈ ${coinAmount(total, rates[w.code], w.code)} ${w.code}**` : '';
        return `**${w.name} (${w.code})**${coins}\n\`\`\`\n${w.address}\n\`\`\``;
      });
      c.addTextDisplayComponents(text(`Send ${amount} to one of these wallets:\n${lines.join('\n')}`));
      const rated = Object.keys(rates).length > 0;
      c.addTextDisplayComponents(
        text(
          `${proofSentence('the transaction ID (hash) or a screenshot')}\n` +
            `-# ${rated ? `Rates from CoinGecko ${ts(now, 'R')} – send at least this; network fees are on you. ` : ''}Double-check the network – crypto payments can't be reversed.`,
        ),
      );
    }
    paid();
  } else if (type === 'paypal') {
    const name = paypalMeName(m.paypalMe);
    if (name) {
      c.addTextDisplayComponents(text(`Pay ${amount} with the PayPal button below, ${proofText('a screenshot of the payment')}.`));
      buttons.push(linkBtn(paypalMeUrl(name, total), truncate(total != null ? `Pay ${money(total)} with PayPal` : 'Pay with PayPal', 80), ce(guild, 'paypal')));
    } else {
      c.addTextDisplayComponents(text(`A seller sends you the PayPal address here – pay ${amount}, ${proofText('a screenshot of the payment')}.`));
    }
    paid();
  } else {
    c.addTextDisplayComponents(text(`A seller sends you the payment details here – pay ${amount}, ${proofText('a screenshot or the transaction ID')}.`));
    paid();
  }
  if (buttons.length) c.addActionRowComponents(row(...buttons.slice(0, 5)));
  return v2(c);
}

/** Posts the payment card – used for every method without an automatic link, and as the fallback when one fails. */
async function postCard(channel, ticket) {
  const order = ticket.order;
  const card = await paymentCard(channel.guild, ticket, order);
  if (card) await channel.send(card).catch((err) => console.warn(`[paycards] ticket ${ticket.channelId}:`, err.message));
}

/** A new order → its payment card, unless an automatic link (Stripe / PayPal) takes care of it. */
async function onOrderPlaced({ channel, ticket }) {
  if (!channel || !ticket?.order) return;
  const type = methodType(methodOf(ticket.order));
  if (type === 'stripe' && require('./stripe').enabled()) return; // stripe.js posts its link
  if (type === 'paypal' && require('./paypal').enabled()) return; // paypal.js posts its link
  await postCard(channel, ticket);
}

hooks.on('orderPlaced', onOrderPlaced);

module.exports = { methodType, methodOf, wallets, cryptoRates, coinAmount, paypalMeName, paypalMeUrl, paymentCard, postCard, COINS };
