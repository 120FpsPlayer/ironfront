'use strict';

/**
 * The payment card: right after an order is placed in the shop, its ticket gets a card "💳 Pay 24€" with
 * what to do for the payment method the customer picked (config.json → shop.paymentMethods):
 *   paysafecard – buy a PaysafeCard for the total, then "Pay" (the payment form with the PIN field)
 *   crypto      – the wallet addresses ("addresses": { "BTC": "…", "ETH": "…" }) with the amount in coins at
 *                 today's rate (kept as order.cryptoQuote), which network to use, then "Pay" with the transaction
 *                 ID – BTC / ETH payments are confirmed automatically (src/features/cryptoverify.js) – or a screenshot
 *   paypal      – with PayPal keys in .env a link that confirms itself (src/features/paypal.js); else a
 *                 paypal.me link with the amount ("paypalMe": "yourname"), then "Pay" with a screenshot
 *   stripe      – a Stripe link (src/features/stripe.js); without a key the seller sends one
 * A method's kind is its "type", or guessed from its name for configs from older versions.
 */

const { ButtonStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const { COLORS, e, ce } = require('../lib/theme');
const { currencyCode } = require('../lib/currency');
const { money, pad, ts, truncate } = require('../lib/utils');
const { orderTitle } = require('../lib/orderItems');
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

/** "eur" – the currency crypto rates are in: crypto.currency (or paypal / stripe .currency), else from shop.currency; null when unclear. */
const rateCurrency = () => currencyCode(config.crypto?.currency || config.paypal?.currency || config.stripe?.currency);

/** { BTC: 61234.5, … } – the price of one coin in the shop currency (CoinGecko, cached 5 min); {} when unknown. */
async function cryptoRates(codes, now = Date.now()) {
  // The shop's currency – set crypto.currency (or paypal / stripe .currency) when its sign isn't clear ("kr", "$" for CAD…).
  const cur = rateCurrency();
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

/**
 * What the card asks for in coins → order.cryptoQuote = { at, total, rates: { BTC: 60000 }, amounts: { BTC: '0.00040000' } }
 * (amounts only for coins with a rate). The automatic check compares the payment with it (src/features/cryptoverify.js).
 */
async function cryptoQuote(m, total, now = Date.now()) {
  const list = wallets(m);
  const rates = total > 0 && list.length ? await cryptoRates(list.map((w) => w.code), now) : {};
  const amounts = {};
  for (const w of list) if (rates[w.code]) amounts[w.code] = coinAmount(total, rates[w.code], w.code);
  return { at: now, total, rates: { ...rates }, amounts };
}

/** Which network each coin must be sent on – a wrong network can't be checked (or refunded). */
const NETWORKS = {
  BTC: 'Tylko w sieci **Bitcoin** – nie Lightning, BEP-20 ani wrapped BTC.',
  ETH: 'Tylko w sieci **Ethereum** (ERC-20) – nie Arbitrum, Base, Optimism, BSC ani Polygon.',
};

// ───────────── PayPal.me ─────────────

/**
 * "HammerShop", "@HammerShop", "paypal.me/HammerShop", "https://www.paypal.me/HammerShop?country.x=PL" or
 * "https://www.paypal.com/paypalme/HammerShop" → "HammerShop" (null when it isn't a valid name).
 */
function paypalMeName(raw) {
  const s = String(raw ?? '')
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/^(https?:\/\/)?(www\.)?(paypal\.me\/|paypal\.com\/paypalme\/)/i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
  return /^[A-Za-z0-9]{1,20}$/.test(s) ? s : null;
}

let paypalMeWarned = false;

/** paypal.me/HammerShop/24EUR – the amount filled in for the customer. */
function paypalMeUrl(name, total) {
  const cur = currencyCode(config.paypal?.currency);
  const amount = total > 0 && cur ? `/${Number(total).toFixed(2)}${cur.toUpperCase()}` : '';
  return `https://paypal.me/${name}${amount}`;
}

// ───────────── The card ─────────────

const proofsOn = () => config.orders?.paymentProofs !== false;

/** The payment card for an order – null for nothing to show. */
async function paymentCard(guild, ticket, order, { now = Date.now(), quote = null } = {}) {
  const m = methodOf(order);
  if (!m) return null;
  const type = methodType(m);
  const total = order.total > 0 ? order.total : null;
  const amount = total != null ? `**${money(total)}**` : 'kwotę potwierdzoną przez sprzedawcę';
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `## ${e(guild, m.emoji ?? 'card')} ${total != null ? `Zapłać ${money(total)}` : 'Płatność'} – ${truncate(m.name, 60)}\n` +
        `-# Zamówienie \`#${pad(ticket.number)}\` · ${orderTitle(order, { max: 80 })}`,
    ),
  );
  c.addSeparatorComponents(divider());
  const buttons = [];
  const paid = (label = 'Zapłać', emoji = '💳') => proofsOn() && buttons.push(btn('pay:open', label, emoji, ButtonStyle.Success));
  const proofText = (what) => (proofsOn() ? `potem kliknij **Zapłać** i wyślij ${what}` : `potem wyślij ${what} tutaj w tickecie`);
  const proofSentence = (what) => (proofsOn() ? `Potem kliknij **Zapłać** i wyślij ${what}.` : `Potem wyślij ${what} tutaj w tickecie.`);

  if (type === 'paysafecard') {
    c.addTextDisplayComponents(
      text(
        `**1.** Kup **PaysafeCard** na ${amount} – w kiosku, na stacji benzynowej lub online.\n` +
          `**2.** ${proofsOn() ? 'Kliknij **Zapłać** i wpisz' : 'Wyślij'} 16-cyfrowy PIN – zdjęcie potwierdzenia zakupu też się przyda.\n` +
          '-# 🔒 Wysyłaj PIN tylko tutaj, w swoim tickecie – nigdy w DM.',
      ),
    );
    paid();
  } else if (type === 'crypto') {
    const list = wallets(m);
    if (!list.length) {
      c.addTextDisplayComponents(text(`Sprzedawca wyśle Ci tutaj adres portfela – wyślij ${amount}, ${proofText('ID transakcji lub zrzut ekranu')}.`));
    } else {
      const q = quote ?? (total != null ? await cryptoQuote(m, total, now) : null);
      const lines = list.map((w) => {
        const coins = q?.amounts?.[w.code] ? ` – **≈ ${q.amounts[w.code]} ${w.code}**` : '';
        const network = NETWORKS[w.code] ? `\n-# ${NETWORKS[w.code]}` : '';
        return `**${w.name} (${w.code})**${coins}${network}\n\`\`\`\n${w.address}\n\`\`\``;
      });
      c.addTextDisplayComponents(text(`Wyślij ${amount} na jeden z tych portfeli:\n${lines.join('\n')}`));
      const rated = Object.keys(q?.amounts ?? {}).length > 0;
      // BTC / ETH with the transaction ID: confirmed by the bot (src/features/cryptoverify.js) – here, it needs this file.
      const auto = proofsOn() && total != null ? require('./cryptoverify').autoText(list) : null;
      c.addTextDisplayComponents(
        text(
          `${auto ?? proofSentence('ID transakcji (hash) lub zrzut ekranu')}\n` +
            `-# ${rated ? `Kursy z CoinGecko ${ts(now, 'R')} – wyślij co najmniej tyle, w całości: opłaty pokrywasz Ty. ` : ''}Dokładnie sprawdź sieć – płatności krypto nie da się cofnąć.`,
        ),
      );
    }
    paid();
  } else if (type === 'paypal') {
    const name = paypalMeName(m.paypalMe);
    if (!name && String(m.paypalMe ?? '').trim() && !paypalMeWarned) {
      paypalMeWarned = true;
      console.warn(`[paycards] "paypalMe": "${m.paypalMe}" to nie jest nazwa paypal.me – wpisz samą nazwę, np. "HammerShop".`);
    }
    if (name) {
      c.addTextDisplayComponents(text(`Zapłać ${amount} przyciskiem PayPal poniżej, ${proofText('zrzut ekranu płatności')}.`));
      buttons.push(linkBtn(paypalMeUrl(name, total), truncate(total != null ? `Zapłać ${money(total)} przez PayPal` : 'Zapłać przez PayPal', 80), ce(guild, 'paypal')));
    } else {
      c.addTextDisplayComponents(text(`Sprzedawca wyśle Ci tutaj adres PayPal – zapłać ${amount}, ${proofText('zrzut ekranu płatności')}.`));
    }
    paid();
  } else {
    c.addTextDisplayComponents(text(`Sprzedawca wyśle Ci tutaj dane do płatności – zapłać ${amount}, ${proofText('zrzut ekranu lub ID transakcji')}.`));
    paid();
  }
  c.addTextDisplayComponents(
    text(
      order.topUp // a balance top-up (features/balance.js) has no product
        ? `-# 💰 ${proofsOn() ? 'Po kliknięciu **Zapłać** sprawdzimy' : 'Sprawdzimy'} płatność i dodamy ją do Twojego salda sklepu. Salda nie można zwrócić ani wypłacić.`
        : `-# 📦 ${proofsOn() ? 'Po kliknięciu **Zapłać** sprawdzimy' : 'Sprawdzimy'} płatność i wyślemy Ci produkt tutaj oraz w DM.`,
    ),
  );
  if (buttons.length) c.addActionRowComponents(row(...buttons.slice(0, 5)));
  return v2(c);
}

/** Keeps the coin amounts the card shows on the order (the current one – a status set meanwhile stays). */
function saveQuote(channelId, quote) {
  const latest = db.getTicket(channelId);
  if (latest?.order) db.updateTicket(channelId, { order: { ...latest.order, cryptoQuote: quote } });
}

/** Posts the payment card – used for every method without an automatic link, and as the fallback when one fails. */
async function postCard(channel, ticket) {
  const order = ticket.order;
  const m = methodOf(order);
  const quote = methodType(m) === 'crypto' && order.total > 0 && wallets(m).length ? await cryptoQuote(m, order.total) : null;
  if (quote) saveQuote(ticket.channelId, quote);
  const card = await paymentCard(channel.guild, ticket, order, { quote });
  if (card) await channel.send(card).catch((err) => console.warn(`[paycards] ticket ${ticket.channelId}:`, err.message));
}

/** A new order → its payment card, unless an automatic link (Stripe / PayPal) takes care of it. */
async function onOrderPlaced({ channel, ticket }) {
  if (!channel || !ticket?.order || ticket.order.paidWith) return; // paid already – store balance (features/balance.js) or the website (features/website.js)
  const type = methodType(methodOf(ticket.order));
  if (type === 'stripe' && require('./stripe').enabled()) return; // stripe.js posts its link
  if (type === 'paypal' && require('./paypal').enabled()) return; // paypal.js posts its link
  await postCard(channel, ticket);
}

hooks.on('orderPlaced', onOrderPlaced);

module.exports = { methodType, methodOf, wallets, rateCurrency, cryptoRates, coinAmount, cryptoQuote, NETWORKS, paypalMeName, paypalMeUrl, paymentCard, postCard, COINS };
