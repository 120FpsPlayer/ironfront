'use strict';

/**
 * Automatic crypto payments (config.json → crypto.autoVerify) – a BTC / ETH order is confirmed and delivered by
 * itself once the blockchain shows the payment, like Stripe and PayPal.
 *
 * The shop has one fixed wallet per coin (config.json → shop.paymentMethods, the crypto method's "addresses" –
 * e.g. Revolut crypto receive addresses), so a payment is matched to its order by its TRANSACTION ID: the customer
 * pastes it into the note of the "Pay" form (src/features/payments.js) – BTC: 64 hex characters, ETH: 0x + 64.
 * It is looked up on public block explorers – no key, no app:
 *   BTC – mempool.space (Esplora API)
 *   ETH – Blockscout (eth.blockscout.com) – also internal transfers (exchange withdrawals sent through a contract);
 *         the public node ethereum-rpc.publicnode.com when Blockscout doesn't answer or doesn't know it yet
 *
 * A payment counts when the transaction pays OUR wallet at least 99% of the coins quoted on the payment card
 * (order.cryptoQuote, src/features/paycards.js – or today's rate when the card had none), isn't older than the order
 * (1 h grace), wasn't used for another order (g.usedTxs) and has config.json → crypto.confirmations (BTC 1, ETH 12).
 * Until then it is checked again every minute; after 48 h the team checks it by hand. Confirmed → the usual automatic
 * payment (src/features/autopay.js): Paid, instant delivery, order completed. Too little, a wrong wallet, an old or
 * failed transaction → the customer is told and the team pinged; "Payment OK" always confirms it by hand.
 * config.json → crypto.internalTransfers: false hands ETH that arrived through a contract to the team instead (some
 * wallets – check yours, e.g. Revolut – don't credit those); default true.
 *
 * ticket.order.crypto = { coin, coins (what the ID can be, most likely first), txid (64 hex, no 0x), status
 *   ('checking' | 'confirmed' | 'short' | 'failed'), state (what the card shows – see evaluate), amount / required
 *   (coins, text), missing, confirmations, needed, internal, usedBy, startedAt, checkedAt, confirmedAt, messageId,
 *   previous: [{ coin, txid, status, state, amount }] – the IDs sent before for this order (last 5) }
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const tickets = require('../tickets/tickets');
const autopay = require('./autopay');
const { COLORS } = require('../lib/theme');
const { logEmbed, money, pad, ts, truncate, sendLog } = require('../lib/utils');
const { container, text, divider, linkBtn, row, v2 } = require('../lib/v2');

const CHECK_EVERY = 60_000;
const GIVE_UP_AFTER = 48 * 3_600_000; // then the team checks it by hand
const NOT_FOUND_FOR = 15 * 60_000; // an ID the explorer doesn't know yet (just sent) is looked for this long
const OLDER_GRACE = 3_600_000; // a payment sent up to 1 h before the order still counts
const MIN_SHARE = 99n; // % of the quoted coins that must arrive
const TIMEOUT = 10_000;

const BTC_API = 'https://mempool.space/api';
const BLOCKSCOUT = 'https://eth.blockscout.com/api/v2';
const ETH_RPC = 'https://ethereum-rpc.publicnode.com';

/** The coins checked automatically: smallest unit, digits shown, minutes per confirmation, explorer link. */
const COINS = {
  BTC: { network: 'Bitcoin', decimals: 8, shown: 8, minutes: (n) => n * 10, url: (id) => `https://mempool.space/tx/${id}` },
  ETH: { network: 'Ethereum', decimals: 18, shown: 6, minutes: (n) => Math.ceil((n * 12) / 60), url: (id) => `https://etherscan.io/tx/${id}` },
};
const DEFAULT_CONFIRMATIONS = { BTC: 1, ETH: 12 };

/** States of a found payment to our wallet – its transaction belongs to this order from then on (g.usedTxs). */
const OURS = ['waiting', 'confirmed', 'short', 'internal'];
/** States that are checked again on the next round. */
const AGAIN = ['waiting', 'pending', 'unavailable'];

// Here – paycards.js and delivery.js need this file's neighbours.
const paycards = () => require('./paycards');

/** Checks run: config.json → crypto.autoVerify, and the "Pay" form is on (the transaction ID comes from it). */
const enabled = () => config.crypto?.autoVerify !== false && config.orders?.paymentProofs !== false;

/** Confirmations a coin needs – config.json → crypto.confirmations, at least 1. */
function needed(coin) {
  const n = Math.floor(Number(config.crypto?.confirmations?.[coin]));
  return Number.isFinite(n) ? Math.max(1, n) : DEFAULT_CONFIRMATIONS[coin];
}

/** "~10 min" – how long a coin's confirmations usually take. */
const eta = (coin) => `~${Math.max(1, COINS[coin].minutes(needed(coin)))} min`;

/** The full transaction ID of a coin: "0x…" for Ethereum, the plain 64 characters for Bitcoin. */
const txKey = (coin, txid) => (coin === 'ETH' ? `0x${txid}` : txid);

/** "3f1c9a2b…77e0d1" – short enough for a card. */
const shortId = (id) => `${id.slice(0, 10)}…${id.slice(-6)}`;

/** { BTC: 'bc1…', ETH: '0x…' } – the wallets of the order's crypto method that are checked automatically ({} for other methods). */
function walletsOf(order) {
  const m = paycards().methodOf(order);
  if (paycards().methodType(m) !== 'crypto') return {};
  return Object.fromEntries(paycards().wallets(m).filter((w) => COINS[w.code]).map((w) => [w.code, w.address]));
}

/** The payment card's "after sending" text when the bot confirms it itself – null when none of the wallets is checked. */
function autoText(list) {
  const coins = enabled() ? [...new Set(list.map((w) => w.code))].filter((code) => COINS[code]) : [];
  if (!coins.length) return null;
  return (
    'Then click **Pay** and send the transaction ID (hash) – your order is confirmed here automatically once the network confirms it ' +
    `(usually within ${coins.map((code) => `${eta(code)} for ${code}`).join(', ')}).\n` +
    'No transaction ID? Send a screenshot instead – a seller checks it by hand.'
  );
}

// ───────────── The transaction ID ─────────────

/**
 * The transaction ID in the customer's note → { txid (64 hex, lower case, no 0x), coins: ['BTC', 'ETH'] } – the
 * coins it can be, most likely first; null when there is none (or no wallet for it). "0x…" is Ethereum; a plain one
 * is Bitcoin first, unless the note says ETH. Explorer links (mempool.space/tx/…, etherscan.io/tx/0x…) work too.
 */
function findTx(note, wallets) {
  const s = String(note ?? '');
  const m = /(?<![0-9a-z])(0x)?([0-9a-f]{64})(?![0-9a-z])/i.exec(s);
  if (!m) return null;
  const saysEth = /\b(eth|ether|ethereum|erc-?20)\b/i.test(s) && !/\b(btc|bitcoin)\b/i.test(s);
  const order = m[1] ? ['ETH'] : saysEth ? ['ETH', 'BTC'] : ['BTC', 'ETH'];
  const coins = order.filter((c) => wallets[c]);
  return coins.length ? { txid: m[2].toLowerCase(), coins } : null;
}

/** Is this order's crypto payment checked automatically – a BTC / ETH wallet, a fixed total and a clear shop currency? */
function checksOrder(order) {
  if (!enabled() || !(order?.total > 0) || order.crypto?.status === 'confirmed') return false;
  return Boolean(paycards().rateCurrency()) && Object.keys(walletsOf(order)).length > 0; // no clear currency – no rate to check the amount with
}

/** The transaction to check for this payment → { txid, coins } – null when the order isn't checked automatically. */
const txFor = (ticket, note) => (checksOrder(ticket?.order) ? findTx(note, walletsOf(ticket.order)) : null);

// ───────────── Amounts ─────────────

/** '0.000400' → 40000n – coins as text to the coin's smallest unit (satoshi, wei); null when it isn't a number. */
function toUnits(amount, coin) {
  const d = COINS[coin].decimals;
  const m = /^(\d*)(?:\.(\d*))?$/.exec(String(amount ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || '0') * 10n ** BigInt(d) + BigInt(`${m[2] ?? ''}${'0'.repeat(d)}`.slice(0, d));
}

/** 40000n → '0.0004' – the coin's shown digits, trailing zeros dropped. */
function fromUnits(units, coin) {
  const { decimals, shown } = COINS[coin];
  const base = 10n ** BigInt(decimals);
  const frac = (units % base).toString().padStart(decimals, '0').slice(0, shown).replace(/0+$/, '');
  return frac ? `${units / base}.${frac}` : String(units / base);
}

/** A number from an explorer (satoshis, wei as text, "0x…" from the node) → BigInt; 0n for anything else. */
function big(v) {
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s) || /^0x[0-9a-f]+$/i.test(s)) return BigInt(s);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? BigInt(Math.round(n)) : 0n;
}

/** The rate the order's coins were worked out with – the card's, or today's (null when CoinGecko doesn't answer). */
async function rateOf(order, coin) {
  const quoted = order.cryptoQuote?.total === order.total ? order.cryptoQuote?.rates?.[coin] : null;
  return quoted || (await paycards().cryptoRates([coin]))[coin] || null;
}

/** The coins the order needs, in the smallest unit – from the payment card's quote, or today's rate. null: no rate. */
async function requiredUnits(order, coin) {
  const q = order.cryptoQuote;
  const quoted = q?.amounts?.[coin] && (q.total == null || q.total === order.total) ? toUnits(q.amounts[coin], coin) : null;
  if (quoted) return quoted;
  const rate = await rateOf(order, coin);
  return rate ? toUnits(paycards().coinAmount(order.total, rate, coin), coin) : null;
}

// ───────────── Block explorers ─────────────

/** Ethereum addresses ignore case (checksum spelling), and so do Bitcoin bc1… ones – legacy 1… / 3… addresses don't. */
function sameAddress(coin, a, b) {
  const x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x || !y) return false;
  return coin === 'ETH' || /^bc1/i.test(y) ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** GET → the JSON; null when there is no such transaction (400 / 404 / 422); throws when the explorer can't be reached. */
async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT) });
  if ([400, 404, 422].includes(res.status)) return null;
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

/**
 * A Bitcoin transaction (mempool.space) → { found, paid (satoshis to our wallet), confirmations, time (ms) }.
 * Unconfirmed: confirmations 0, no time yet.
 */
async function lookupBtc(txid, address) {
  const tx = await getJson(`${BTC_API}/tx/${txid}`);
  if (!tx?.txid) return { found: false };
  const paid = (tx.vout ?? []).filter((o) => sameAddress('BTC', o?.scriptpubkey_address, address)).reduce((n, o) => n + big(o.value), 0n);
  if (!tx.status?.confirmed) return { found: true, paid, confirmations: 0, time: null };
  const tip = Number(await getJson(`${BTC_API}/blocks/tip/height`));
  if (!(tip > 0)) throw new Error('mempool.space: no block height');
  return { found: true, paid, confirmations: Math.max(1, tip - Number(tx.status.block_height) + 1), time: Number(tx.status.block_time) * 1000 || null };
}

async function rpc(method, params) {
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || data.error) throw new Error(`publicnode ${method}: ${data?.error?.message ?? res.status}`);
  return data.result ?? null;
}

/**
 * The same from the public Ethereum node. It shows no internal transfers – a transaction that doesn't pay our wallet
 * directly stays "unsure" there (Blockscout decides it on a later round).
 */
async function lookupEthNode(hash, address) {
  const tx = await rpc('eth_getTransactionByHash', [hash]);
  if (!tx) return { found: false };
  const paid = sameAddress('ETH', tx.to, address) ? big(tx.value) : 0n;
  if (!tx.blockNumber) return { found: true, pending: true, unsure: !paid, paid, confirmations: 0, time: null };
  const receipt = await rpc('eth_getTransactionReceipt', [hash]);
  if (receipt?.status === '0x0') return { found: true, failed: true };
  const [head, block] = await Promise.all([rpc('eth_blockNumber', []), rpc('eth_getBlockByNumber', [tx.blockNumber, false])]);
  return { found: true, unsure: !paid, paid, confirmations: Math.max(1, Number(big(head) - big(tx.blockNumber)) + 1), time: block?.timestamp ? Number(big(block.timestamp)) * 1000 : null };
}

/**
 * An Ethereum transaction (Blockscout) → { found, failed, pending, unsure, paid (wei to our wallet), internal,
 * confirmations, time }. Not paid directly → its internal transfers (an exchange withdrawal through a contract);
 * those are only known once it is in a block, so a pending one is "unsure" until then.
 */
async function lookupEth(hash, address) {
  let tx;
  try {
    tx = await getJson(`${BLOCKSCOUT}/transactions/${hash}`);
  } catch (err) {
    return lookupEthNode(hash, address).catch(() => Promise.reject(err)); // Blockscout down – the public node
  }
  if (!tx?.hash) return lookupEthNode(hash, address); // not indexed yet – the node may know it
  if (tx.status === 'error') return { found: true, failed: true };
  const mined = tx.status === 'ok';
  const time = tx.timestamp ? Date.parse(tx.timestamp) || null : null;
  const direct = sameAddress('ETH', tx.to?.hash, address) ? big(tx.value) : 0n;
  if (direct || !mined) return { found: true, pending: !mined, unsure: !direct, paid: direct, confirmations: mined ? Number(tx.confirmations) || 0 : 0, time };
  const list = await getJson(`${BLOCKSCOUT}/transactions/${hash}/internal-transactions`);
  const paid = (list?.items ?? []).filter((i) => i?.success !== false && sameAddress('ETH', i?.to?.hash, address)).reduce((n, i) => n + big(i.value), 0n);
  return { found: true, paid, internal: paid > 0n, confirmations: Number(tx.confirmations) || 0, time };
}

const lookup = (coin, txid, address) => (coin === 'BTC' ? lookupBtc(txid, address) : lookupEth(txKey('ETH', txid), address));

// ───────────── Checking ─────────────

/**
 * What the blockchain says about the order's transaction → { state, coin, paid, required, confirmations, internal, other }
 *   confirmed   – enough coins to our wallet, enough confirmations
 *   waiting     – enough coins, fewer confirmations than needed (also still in the mempool)
 *   pending     – found, but whether it pays us is only known once it is in a block
 *   unavailable – the explorer (or the exchange rate) doesn't answer – tried again
 *   notfound    – no such transaction (yet)
 *   short       – less than 99% of the coins asked for
 *   address     – pays nothing to our wallet · failedtx – failed on the network · old – sent before the order
 *   used        – the transaction belongs to another order (other: its ticket channel)
 *   internal    – confirmed, but through a contract while crypto.internalTransfers is false – the team checks it
 */
async function evaluate(guild, ticket, c) {
  const order = ticket.order;
  const wallets = walletsOf(order);
  const used = db.guild(guild.id).usedTxs;
  let found = null;
  for (const coin of c.coins.filter((x) => wallets[x])) {
    const owner = used[txKey(coin, c.txid)];
    if (owner && owner !== ticket.channelId) return { state: 'used', coin, other: owner };
    let look;
    try {
      look = await lookup(coin, c.txid, wallets[coin]);
    } catch (err) {
      if (!warned.has(c.txid)) console.warn(`[cryptoverify] ${coin} ${c.txid}:`, err.message); // once – it's tried every minute
      warned.add(c.txid);
      return { state: 'unavailable', coin };
    }
    if (look.found) {
      found = { coin, look };
      break;
    }
  }
  if (!found) return { state: 'notfound', coin: c.coins[0] };
  const { coin, look } = found;
  if (look.failed) return { state: 'failedtx', coin };
  if (!look.paid) return { state: look.unsure ? 'pending' : 'address', coin };
  const base = { coin, paid: look.paid, confirmations: look.confirmations ?? 0, internal: Boolean(look.internal) };
  if (look.time != null && look.time < ticket.createdAt - OLDER_GRACE) return { ...base, state: 'old' };
  const required = await requiredUnits(order, coin).catch(() => null);
  if (required == null) return { ...base, state: 'unavailable' };
  if (look.paid * 100n < required * MIN_SHARE) return { ...base, required, state: 'short' };
  if (look.pending || base.confirmations < needed(coin)) return { ...base, required, state: 'waiting' };
  return { ...base, required, state: base.internal && config.crypto?.internalTransfers === false ? 'internal' : 'confirmed' };
}

/** The order's status for a check result: checked again ('checking'), or an answer. */
function statusFor(state, c, now) {
  if (state === 'confirmed' || state === 'short') return state;
  if (state === 'notfound') return now - c.startedAt < NOT_FOUND_FOR ? 'checking' : 'failed';
  if (AGAIN.includes(state)) return now - c.startedAt < GIVE_UP_AFTER ? 'checking' : 'failed';
  return 'failed';
}

/** "0.0001 BTC (≈ 6€)" – what is missing of a short payment. */
async function missingText(order, r) {
  const diff = r.required - r.paid;
  const rate = await rateOf(order, r.coin).catch(() => null);
  const worth = rate ? Math.ceil(Number(fromUnits(diff, r.coin)) * rate * 100) / 100 : null;
  return `${fromUnits(diff, r.coin)} ${r.coin}${worth ? ` (≈ ${money(worth)})` : ''}`;
}

const busy = new Set(); // tickets being checked right now – one check at a time per order
const warned = new Set(); // transactions an explorer failed for – logged once

/**
 * Looks the order's transaction up and records what the blockchain says → the order's crypto record (null: nothing
 * to check). A confirmed payment goes through autopay.paymentReceived – once: the record is 'confirmed' before.
 */
async function check(guild, channelId, { now = Date.now() } = {}) {
  if (busy.has(channelId)) return db.getTicket(channelId)?.order?.crypto ?? null;
  busy.add(channelId);
  try {
    const ticket = db.getTicket(channelId);
    const c = ticket?.order?.crypto;
    if (c?.status !== 'checking') return c ?? null;
    const r = await evaluate(guild, ticket, c);
    if (r.state === 'short') r.missing = await missingText(ticket.order, r);
    return await record(guild, channelId, c.txid, r, now);
  } finally {
    busy.delete(channelId);
  }
}

/** Saves a check result on the CURRENT order (never an older copy) and tells the ticket when something changed. */
async function record(guild, channelId, txid, r, now) {
  const latest = db.getTicket(channelId);
  const c = latest?.order?.crypto;
  if (!c || c.txid !== txid || c.status !== 'checking') return c ?? null; // a new ID was sent meanwhile
  const used = db.guild(guild.id).usedTxs;
  const key = txKey(r.coin, txid);
  if (OURS.includes(r.state)) {
    // Claimed right here, with nothing awaited since the last look – two orders can never both take one payment.
    if (used[key] && used[key] !== channelId) r = { state: 'used', coin: r.coin, other: used[key] };
    else used[key] = channelId;
  } else if (['notfound', 'failedtx'].includes(r.state) && used[key] === channelId) {
    delete used[key]; // it was found before and is gone now (dropped or replaced) – free again
  }
  const status = statusFor(r.state, c, now);
  const state = status === 'failed' && AGAIN.includes(r.state) ? 'timeout' : r.state;
  const found = r.paid != null;
  const next = {
    ...c,
    coin: r.coin,
    coins: found || ['address', 'failedtx', 'pending'].includes(r.state) ? [r.coin] : c.coins, // the network it is on
    status,
    state,
    amount: found ? fromUnits(r.paid, r.coin) : c.amount ?? null,
    required: r.required != null ? fromUnits(r.required, r.coin) : c.required ?? null,
    missing: r.missing ?? null,
    confirmations: r.confirmations ?? c.confirmations ?? 0,
    needed: needed(r.coin),
    internal: r.internal ?? c.internal ?? false,
    usedBy: r.other ?? null,
    checkedAt: now,
    ...(status === 'confirmed' && { confirmedAt: now }),
  };
  const updated = db.updateTicket(channelId, { order: { ...latest.order, crypto: next } });
  const problem = ['short', 'failed'].includes(status);
  // Staff already confirmed the order by hand – kept for the record, but nobody is pinged about it any more.
  const settled = autopay.PAID.includes(autopay.statusBefore(updated));
  if (problem && settled) return next;
  if (status !== c.status || state !== c.state || next.confirmations !== c.confirmations) await show(guild, updated, { fresh: problem });
  if (status === 'confirmed') await confirmed(guild, db.getTicket(channelId));
  else if (problem) await logProblem(guild, db.getTicket(channelId));
  return db.getTicket(channelId).order.crypto;
}

/** Confirmed on the blockchain → Paid, instant delivery and the order completed (src/features/autopay.js). */
async function confirmed(guild, ticket) {
  const before = autopay.statusBefore(ticket);
  if (autopay.PAID.includes(before)) return; // staff confirmed it by hand meanwhile – the same payment, nothing to do
  const c = ticket.order.crypto;
  const cur = paycards().rateCurrency();
  await autopay.paymentReceived(guild, ticket, {
    gateway: `Crypto (${c.coin})`,
    paidAmount: tickets.orderDetails(ticket).total,
    paidCurrency: cur,
    expectedCurrency: cur,
    reference: txKey(c.coin, c.txid),
    before,
  });
}

// ───────────── The card in the ticket ─────────────

/** What the card says for each state → [title, text]. */
function describe(ticket, c) {
  const coin = COINS[c.coin];
  const id = `\`${shortId(txKey(c.coin, c.txid))}\``;
  const network = c.coins.map((x) => COINS[x].network).join(' or ');
  const amount = c.amount ? `**${c.amount} ${c.coin}**` : 'the payment';
  const wallet = walletsOf(ticket.order)[c.coin];
  switch (c.state) {
    case 'confirmed':
      return ['✅ Crypto payment confirmed', `${amount} received · transaction ${id} · ${c.confirmations} ${c.confirmations === 1 ? 'confirmation' : 'confirmations'}.`];
    case 'waiting':
      return [
        '⏳ Payment found – waiting for confirmations',
        `${amount} to our wallet · transaction ${id}\n**Confirmations:** ${Math.min(c.confirmations, c.needed)} / ${c.needed} – your order is confirmed here automatically, usually within ${eta(c.coin)}. No need to do anything.`,
      ];
    case 'pending':
      return ['⏳ Transaction found', `Transaction ${id} is waiting to be included in a block – it's checked again every minute and your order is confirmed here automatically.`];
    case 'unavailable':
      return ['🔎 Checking your transaction', `Transaction ${id} can't be checked on the ${network} network right now – it's tried again automatically every minute. No need to send it again.`];
    case 'notfound':
      return c.status === 'checking'
        ? [
            '🔎 Looking for your transaction',
            `Transaction ${id} isn't on the ${network} network yet. Just sent it? It can take a minute – we keep looking until ${ts(c.startedAt + NOT_FOUND_FOR, 't')}.\n` +
              '-# Please double-check the ID: copy the transaction ID (hash) of this payment from your wallet or exchange.',
          ]
        : ['❌ Transaction not found', `We couldn't find transaction ${id} on the ${network} network. Please check the ID and click **Pay** to send the right one – or a seller checks your payment by hand.`];
    case 'short':
      return [
        '⚠️ Not enough received',
        `Transaction ${id} sends ${amount} – this order needs **${c.required} ${c.coin}**, so **${c.missing}** is missing. A seller sorts out the difference with you here – please wait for them before you send more.`,
      ];
    case 'address':
      return [
        '❌ Not sent to our wallet',
        `Transaction ${id} doesn't send ${c.coin} to our wallet${wallet ? ` \`${wallet}\`` : ''}. Please check the ID – it must be your payment to the address on the payment card – and click **Pay** to send the right one.`,
      ];
    case 'failedtx':
      return ['❌ Transaction failed', `Transaction ${id} failed on the ${coin.network} network – nothing arrived. Check it in your wallet or exchange; after paying again, click **Pay** with the new transaction ID.`];
    case 'old':
      return ['❌ Transaction older than this order', `Transaction ${id} was sent before this order was placed. Please click **Pay** and send the ID of the payment for **this** order.`];
    case 'used':
      return ['❌ Transaction already used', `Transaction ${id} was already used for another order. Please click **Pay** and send the ID of the payment for this order.`];
    case 'internal':
      return ['🔎 A seller confirms this payment', `Transaction ${id} sends ${amount} through a contract (e.g. an exchange withdrawal) – a seller checks that it arrived and confirms your order here.`];
    case 'timeout':
      return ['⌛ Not confirmed after 48 hours', `Transaction ${id} still isn't confirmed on the ${network} network – a seller checks your payment by hand.`];
    default:
      return ['🔎 Checking your transaction', `Transaction ${id} is being checked on the ${network} network…`];
  }
}

/** The crypto check card – the customer (and on a problem the team) pinged in it. */
function statusCard(guild, ticket, c, pings = null) {
  const done = c.status === 'confirmed';
  const problem = ['short', 'failed'].includes(c.status);
  const box = container(done ? COLORS.success : problem ? COLORS.warning : COLORS.brand);
  const [title, body] = describe(ticket, c);
  const customer = problem ? `<@${ticket.ownerId}> ` : '';
  box.addTextDisplayComponents(text(`## ${title}\n${customer}${body}`));
  if (problem) {
    const who = [...(pings?.users ?? []).map((id) => `<@${id}>`), ...(pings?.roles ?? []).map((id) => `<@&${id}>`)].join(' ');
    box.addSeparatorComponents(divider());
    box.addTextDisplayComponents(text(`-# ${who ? `${who} – ` : ''}checked automatically on the blockchain. Staff: once you've checked the payment yourself, **Payment OK** confirms it by hand.`));
  } else if (c.internal) {
    box.addTextDisplayComponents(text('-# Sent through a contract (internal transfer) – e.g. an exchange withdrawal.'));
  }
  const buttons = [];
  if (c.state && !['notfound', 'unavailable'].includes(c.state)) buttons.push(linkBtn(COINS[c.coin].url(txKey(c.coin, c.txid)), 'View transaction', '🔗'));
  if (problem && ticket.status === 'open' && !ticket.completedAt) buttons.push(require('./delivery').confirmButtonFor(guild.id, ticket));
  if (buttons.length) box.addActionRowComponents(row(...buttons));
  const users = problem ? [ticket.ownerId, ...(pings?.users ?? [])] : [];
  return v2(box, { mentions: { users: [...new Set(users)], roles: problem ? pings?.roles ?? [] : [] } });
}

/** Shows the order's crypto state: the card is edited – or, for a problem, posted again so the customer and the team are pinged. */
async function show(guild, ticket, { fresh = false } = {}) {
  const c = ticket.order.crypto;
  const channel = ticket.status === 'deleted' ? null : guild.channels.cache.get(ticket.channelId);
  if (!channel) return;
  const old = c.messageId ? await channel.messages.fetch(c.messageId).catch(() => null) : null;
  if (old && !fresh) {
    await old.edit(statusCard(guild, ticket, c)).catch(() => null);
    return;
  }
  const sent = await channel.send(statusCard(guild, ticket, c, fresh ? autopay.pingsFor(guild, ticket) : null)).catch((err) => console.warn(`[cryptoverify] ticket ${ticket.channelId}:`, err.message));
  if (old) await old.delete().catch(() => null);
  const latest = db.getTicket(ticket.channelId);
  if (sent && latest?.order?.crypto?.txid === c.txid) db.updateTicket(ticket.channelId, { order: { ...latest.order, crypto: { ...latest.order.crypto, messageId: sent.id } } });
}

const PROBLEMS = {
  short: 'Too little sent',
  address: 'Not sent to our wallet',
  failedtx: 'Failed transaction',
  old: 'Sent before the order',
  used: 'Already used for another order',
  notfound: 'Not found',
  timeout: 'Not confirmed after 48 h',
  internal: 'Sent through a contract – check it arrived in your wallet',
};

/** The log: a crypto payment that needs the team (a reused transaction names the other order). */
async function logProblem(guild, ticket) {
  const c = ticket.order.crypto;
  const fields = [
    { name: 'Ticket', value: `<#${ticket.channelId}> (\`#${pad(ticket.number)}\`)`, inline: true },
    { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Problem', value: PROBLEMS[c.state] ?? c.state, inline: true },
    { name: 'Transaction', value: `[\`${shortId(txKey(c.coin, c.txid))}\`](${COINS[c.coin].url(txKey(c.coin, c.txid))})`, inline: true },
  ];
  if (c.amount) fields.push({ name: 'Received', value: `${c.amount} ${c.coin}${c.required ? ` of ${c.required} ${c.coin}` : ''}`, inline: true });
  if (c.usedBy) fields.push({ name: 'Used by', value: `<#${c.usedBy}>${db.getTicket(c.usedBy) ? ` (\`#${pad(db.getTicket(c.usedBy).number)}\`)` : ''}`, inline: true });
  await sendLog(guild, {
    embeds: [logEmbed(COLORS.warning, '🪙 Crypto payment needs a check', guild.client.user).setDescription(truncate(describe(ticket, c)[1], 1000)).addFields(fields)],
  }).catch(() => null);
}

// ───────────── Starting, the timer ─────────────

/**
 * The customer sent a transaction ID with "Pay" (src/features/payments.js) → order.crypto is (re)started and looked
 * up right away. → the crypto record (null when nothing was started). The same ID while it's checked → checked now.
 */
async function start(guild, channelId, tx, { now = Date.now() } = {}) {
  const ticket = db.getTicket(channelId);
  const order = ticket?.order;
  if (!order || !enabled() || order.crypto?.status === 'confirmed') return null;
  const old = order.crypto;
  if (old?.txid !== tx.txid || old.status !== 'checking') {
    // The ID sent before stays on record – its payment (e.g. too little) may still belong to this order.
    const previous = old ? [...(old.previous ?? []), { coin: old.coin, txid: old.txid, status: old.status, state: old.state, amount: old.amount ?? null }].slice(-5) : [];
    const crypto = { coin: tx.coins[0], coins: tx.coins, txid: tx.txid, status: 'checking', state: null, confirmations: 0, needed: needed(tx.coins[0]), startedAt: now, checkedAt: null, messageId: null, previous };
    db.updateTicket(channelId, { order: { ...order, crypto } });
  }
  return check(guild, channelId, { now });
}

/** What the customer is answered after "Pay" with a transaction ID. */
function replyFor(c) {
  if (c?.status === 'confirmed') return 'Your crypto payment is confirmed – thank you! Your order is being completed in your ticket.';
  if (c?.status === 'short' || c?.status === 'failed') return "Thanks! Your transaction couldn't be confirmed automatically – see your ticket, a seller has been told.";
  if (c?.state === 'waiting') return `We found your payment on the blockchain – your order is confirmed in your ticket automatically after ${c.needed} ${c.needed === 1 ? 'confirmation' : 'confirmations'} (usually ${eta(c.coin)}).`;
  if (c?.state === 'notfound') return "Thanks! We can't see your transaction on the blockchain yet – we keep looking for a few minutes. Please double-check the ID (see your ticket).";
  return "Thanks! We're checking your transaction on the blockchain – your order is confirmed in your ticket automatically.";
}

let running = false;

/** Every minute: checks again what waits – confirmations, an explorer that was down, an ID that wasn't found yet. */
async function checkPending(client, { now = Date.now() } = {}) {
  if (running || !enabled()) return;
  running = true;
  try {
    for (const t of db.tickets((x) => x.typeId === 'order' && x.order?.crypto?.status === 'checking')) {
      const guild = client.guilds.cache.get(t.guildId);
      if (!guild || guild.available === false) continue;
      await check(guild, t.channelId, { now }).catch((err) => console.warn(`[cryptoverify] ticket ${t.channelId}:`, err.message));
    }
  } finally {
    running = false;
  }
}

hooks.every('cryptoPayments', CHECK_EVERY, (client) => checkPending(client), 40_000);

module.exports = { COINS, enabled, needed, autoText, findTx, checksOrder, txFor, toUnits, fromUnits, lookupBtc, lookupEth, start, check, checkPending, replyFor, statusCard };
