'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const cryptoverify = require('../src/features/cryptoverify');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 994000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const CRYPTO = String(config.shop.paymentMethods.findIndex((m) => m.type === 'crypto'));
const wallet = (coin) => config.shop.paymentMethods.find((m) => m.type === 'crypto').addresses[coin];
const hex = (seed) => seed.repeat(64).slice(0, 64);
const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * A pretend blockchain: mempool.space (BTC), Blockscout and the public Ethereum node (ETH), and CoinGecko at
 * 1 BTC = 60000€, 1 ETH = 2500€ – so a 24€ order is 0.00040000 BTC or 0.009600 ETH.
 */
function fakeChain() {
  const btc = new Map();
  const eth = new Map();
  const node = new Map();
  const calls = [];
  const state = { tip: 900000, head: 20000000, blockscoutDown: false, nodeDown: false };
  const real = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push(url);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    const u = new URL(url);
    if (u.origin === 'https://api.coingecko.com') return json(200, { bitcoin: { eur: 60000 }, ethereum: { eur: 2500 } });
    if (u.origin === 'https://mempool.space') {
      if (u.pathname === '/api/blocks/tip/height') return json(200, state.tip);
      const tx = btc.get(u.pathname.replace('/api/tx/', ''));
      return tx ? json(200, tx) : { ok: false, status: 404, json: async () => assert.fail('not JSON') };
    }
    if (u.origin === 'https://eth.blockscout.com') {
      if (state.blockscoutDown) throw new Error('The operation was aborted due to timeout');
      const m = /^\/api\/v2\/transactions\/(0x[0-9a-f]{64})(\/internal-transactions)?$/.exec(u.pathname);
      const t = m && eth.get(m[1]);
      if (!t) return json(404, { message: 'Not found' });
      return json(200, m[2] ? { items: t.internal ?? [], next_page_params: null } : t.tx);
    }
    if (url === 'https://ethereum-rpc.publicnode.com') {
      if (state.nodeDown) return json(503, { jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'overloaded' } });
      const { method, params } = JSON.parse(opts.body);
      const t = node.get(params[0]);
      if (method === 'eth_blockNumber') return json(200, { jsonrpc: '2.0', id: 1, result: `0x${state.head.toString(16)}` });
      if (method === 'eth_getTransactionByHash') return json(200, { jsonrpc: '2.0', id: 1, result: t?.tx ?? null });
      if (method === 'eth_getTransactionReceipt') return json(200, { jsonrpc: '2.0', id: 1, result: t?.receipt ?? null });
      if (method === 'eth_getBlockByNumber') return json(200, { jsonrpc: '2.0', id: 1, result: { timestamp: `0x${nowSec().toString(16)}` } });
    }
    throw new Error(`No network in tests: ${url}`);
  };
  return {
    state,
    calls,
    explorerCalls: () => calls.filter((c) => !c.includes('coingecko')),
    /** A Bitcoin transaction paying `sats` to `to` – confirmations 0 = still in the mempool. */
    btcTx(txid, { sats = 40000, to = wallet('BTC'), confirmations = 1, time = nowSec() } = {}) {
      btc.set(txid, {
        txid,
        vout: [
          { scriptpubkey_address: 'bc1qchangeaddressofthesender000000000000', value: 123456 },
          { scriptpubkey_address: to, value: sats },
        ],
        status: confirmations ? { confirmed: true, block_height: state.tip - confirmations + 1, block_time: time } : { confirmed: false },
      });
    },
    /** An Ethereum transaction on Blockscout – internal: transfers made by a contract (an exchange withdrawal). */
    ethTx(hash, { wei = '9600000000000000', to = wallet('ETH'), confirmations = 12, status = 'ok', internal = null, time = new Date().toISOString() } = {}) {
      eth.set(hash, { tx: { hash, to: { hash: to }, value: wei, status, result: status === 'ok' ? 'success' : status, confirmations, timestamp: time }, internal });
    },
    /** An Ethereum transaction on the public node only. */
    nodeTx(hash, { wei = '9600000000000000', to = wallet('ETH'), confirmations = 12 } = {}) {
      const block = state.head - confirmations + 1;
      node.set(hash, { tx: { hash, to, value: `0x${BigInt(wei).toString(16)}`, blockNumber: `0x${block.toString(16)}` }, receipt: { status: '0x1' } });
    },
    restore: () => (global.fetch = real),
  };
}

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.' });
  product.delivery = { files: [], text: 'Login: nox@example.com / secret', updatedAt: Date.now() }; // delivered automatically
  db.save();
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

/** A crypto order (2 × 12€ = 24€) → its ticket channel. */
async function order(guild, buyer, product) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '2' }, selects: { payment: [CRYPTO] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const pay = (guild, buyer, channel, note) => run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { note }, channel });
const texts = (channel) => channel.messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');
const cryptoCards = (channel) => channel.messageList.filter((m) => /^## (✅ Crypto|⏳|🔎|❌|⚠️ Not enough|⌛)/m.test(textOf(m.body ?? m)));
const logTexts = (guild) => guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');
const productMessages = (channel) => channel.messageList.filter((m) => /Your product – /.test(textOf(m.body ?? m)));

const withChain = async (fn) => {
  const chain = fakeChain();
  try {
    return await fn(chain);
  } finally {
    chain.restore();
  }
};

test('the crypto card: which network, the amount in coins (kept on the order) and that it confirms itself', async () => {
  const { guild, product } = await shopGuild();
  await withChain(async () => {
    const { channel, ticket } = await order(guild, member(guild), product);
    const card = channel.messageList.map((m) => m.body ?? m).find((b) => /^## .*Pay 24€ – Crypto/m.test(textOf(b)));
    validateMessage(card, guild);
    const out = textOf(card);
    assert.match(out, /Bitcoin \(BTC\)\*\* – \*\*≈ 0\.00040000 BTC\*\*\n-# Only on the \*\*Bitcoin\*\* network/);
    assert.match(out, /Ethereum \(ETH\)\*\* – \*\*≈ 0\.009600 ETH\*\*\n-# Only on the \*\*Ethereum\*\* network \(ERC-20\) – not Arbitrum, Base, Optimism, BSC/);
    assert.match(out, /Then click \*\*Pay\*\* and send the transaction ID \(hash\) – your order is confirmed here automatically .*~10 min for BTC, ~3 min for ETH/);
    assert.match(out, /No transaction ID\? Send a screenshot instead – a seller checks it by hand/);
    const quote = ticket().order.cryptoQuote;
    assert.deepEqual(quote.amounts, { BTC: '0.00040000', ETH: '0.009600' });
    assert.deepEqual(quote.rates, { BTC: 60000, ETH: 2500 });
    assert.equal(quote.total, 24);

    const form = await run({ guild, member: guild.members.cache.get(ticket().ownerId), kind: 'button', customId: 'pay:open', channel });
    assert.match(JSON.stringify(form.state.modals[0]), /Paste the transaction ID \(hash\) – your order is then confirmed automatically/);
  });
});

test('finding the transaction ID in the note: BTC, 0x… ETH, explorer links, an ETH hint – and nothing else', () => {
  const both = { BTC: 'bc1q', ETH: '0xabc' };
  const id = 'a1'.repeat(32);
  assert.deepEqual(cryptoverify.findTx(`sent! ${id}`, both), { txid: id, coins: ['BTC', 'ETH'] });
  assert.deepEqual(cryptoverify.findTx(`https://etherscan.io/tx/0x${id.toUpperCase()}`, both), { txid: id, coins: ['ETH'] });
  assert.deepEqual(cryptoverify.findTx(`https://mempool.space/tx/${id}`, both), { txid: id, coins: ['BTC', 'ETH'] });
  assert.deepEqual(cryptoverify.findTx(`paid in ETH: ${id}`, both), { txid: id, coins: ['ETH', 'BTC'] });
  assert.deepEqual(cryptoverify.findTx(`${id}`, { ETH: '0xabc' }), { txid: id, coins: ['ETH'] });
  assert.equal(cryptoverify.findTx(`0x${id}`, { BTC: 'bc1q' }), null, 'an ETH hash without an ETH wallet');
  assert.equal(cryptoverify.findTx('tx 0xabc', both), null);
  assert.equal(cryptoverify.findTx(`${id}ff`, both), null, '66 characters is not a transaction ID');
  assert.equal(cryptoverify.findTx('0x57A092596977975FdB6988dcB9Ce6aE84aDc4d0d', both), null, 'an address is not a transaction ID');
  assert.equal(cryptoverify.toUnits('0.00040000', 'BTC'), 40000n);
  assert.equal(cryptoverify.toUnits('0.0096', 'ETH'), 9600000000000000n);
  assert.equal(cryptoverify.fromUnits(9600000000000000n, 'ETH'), '0.0096');
  assert.equal(cryptoverify.fromUnits(40000n, 'BTC'), '0.0004');
});

test('BTC: a confirmed payment → Paid, the product delivered and the order completed – nobody pinged', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const txid = hex('3f');
    chain.btcTx(txid, { sats: 39700 }); // 99.25% – exchange fees taken off still count
    const i = await pay(guild, buyer, channel, `Sent from Revolut ${txid}`);
    assert.match(textOf(lastResponse(i)), /Your crypto payment is confirmed/);

    const sent = channel.messageList.find((m) => /^## 📨 Payment sent/m.test(textOf(m.body)));
    assert.match(textOf(sent.body), /checked on the blockchain automatically/);
    assert.deepEqual(sent.body.allowedMentions, { users: [], roles: [] }, 'the team is not pinged');
    assert.ok(customIds(sent.body).includes('deliver:confirm'), 'staff can still confirm by hand');

    const c = ticket().order.crypto;
    assert.equal(c.status, 'confirmed');
    assert.equal(c.coin, 'BTC');
    assert.equal(c.amount, '0.000397');
    assert.equal(c.required, '0.0004');
    assert.equal(db.guild(guild.id).usedTxs[txid], channel.id);
    const all = texts(channel);
    assert.match(all, /✅ Crypto payment confirmed\n\*\*0\.000397 BTC\*\* received/);
    assert.match(all, /Crypto \(BTC\) payment received – 24€\*\* for order .* 📦 The product is delivered automatically/);
    assert.match(all, /Your product – Netflix Premium[\s\S]*Login: nox@example\.com/);
    assert.ok(ticket().completedAt, 'order completed');
    assert.equal(statusOf(ticket()), 'delivered');
    assert.equal(db.sales(guild.id).at(-1).amount, 24);
    assert.match(logTexts(guild), /Crypto \(BTC\) payment received[\s\S]*3f3f3f/);
  });
});

test('ETH: waiting for 12 confirmations – the card counts up, then the timer confirms and delivers it, once', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const hash = `0x${hex('e1')}`;
    chain.ethTx(hash, { to: wallet('ETH').toLowerCase(), confirmations: 3 }); // Blockscout spells addresses in lower case
    const i = await pay(guild, buyer, channel, hash);
    assert.match(textOf(lastResponse(i)), /found your payment[\s\S]*after 12 confirmations \(usually ~3 min\)/);
    assert.equal(ticket().order.crypto.status, 'checking');
    assert.equal(statusOf(ticket()), 'sent');
    assert.match(texts(channel), /⏳ Payment found – waiting for confirmations\n\*\*0\.0096 ETH\*\* to our wallet[\s\S]*Confirmations:\*\* 3 \/ 12/);

    chain.ethTx(hash, { confirmations: 7 });
    await cryptoverify.checkPending(guild.client);
    assert.equal(cryptoCards(channel).length, 1, 'the card is edited, not posted again');
    assert.match(texts(channel), /Confirmations:\*\* 7 \/ 12/);
    assert.equal(ticket().completedAt ?? null, null);

    chain.ethTx(hash, { confirmations: 12 });
    await Promise.all([cryptoverify.checkPending(guild.client), cryptoverify.checkPending(guild.client), cryptoverify.check(guild, channel.id)]);
    await cryptoverify.checkPending(guild.client);
    assert.equal(ticket().order.crypto.status, 'confirmed');
    assert.ok(ticket().completedAt);
    assert.equal(productMessages(channel).length, 1, 'delivered once');
    assert.equal(db.sales(guild.id).filter((s) => s.channelId === channel.id).length, 1, 'one sale');
    assert.equal((texts(channel).match(/payment received/g) ?? []).length, 1);
    assert.doesNotMatch(texts(channel), /paid twice/);
    assert.match(texts(channel), /✅ Crypto payment confirmed\n\*\*0\.0096 ETH\*\* received · transaction `0xe1e1e1e1…e1e1e1` · 12 confirmations/);
  });
});

test('too little: status short, the customer and the team are told the difference – the order is NOT paid', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const txid = hex('5a');
    chain.btcTx(txid, { sats: 30000 });
    const i = await pay(guild, buyer, channel, txid);
    assert.match(textOf(lastResponse(i)), /couldn't be confirmed automatically/);
    assert.equal(ticket().order.crypto.status, 'short');
    assert.equal(statusOf(ticket()), 'sent', 'not Paid');
    assert.equal(ticket().completedAt ?? null, null);
    const card = cryptoCards(channel).at(-1);
    assert.match(textOf(card.body), /Not enough received\n<@\d+> Transaction `5a5a5a5a5a…5a5a5a` sends \*\*0\.0003 BTC\*\* – this order needs \*\*0\.0004 BTC\*\*, so \*\*0\.0001 BTC \(≈ 6€\)\*\* is missing/);
    assert.ok(card.body.allowedMentions.users.includes(buyer.id), 'the customer is pinged');
    assert.ok(card.body.allowedMentions.roles.length > 0, 'and the team');
    assert.ok(customIds(card.body).includes('deliver:confirm'), 'Payment OK by hand');
    assert.match(logTexts(guild), /Crypto payment needs a check[\s\S]*Too little sent[\s\S]*0\.0003 BTC of 0\.0004 BTC/);
    assert.equal(db.guild(guild.id).usedTxs[txid], channel.id, 'the transaction belongs to this order');
    await cryptoverify.checkPending(guild.client);
    assert.equal(cryptoCards(channel).length, 1, 'not checked again');
  });
});

test('wrong wallet, a failed ETH transaction, a transaction older than the order: the customer is asked to check the ID', async () => {
  const { guild, product } = await shopGuild();
  await withChain(async (chain) => {
    const a = member(guild);
    const first = await order(guild, a, product);
    chain.btcTx(hex('b1'), { to: 'bc1qsomeoneelseswallet00000000000000000000' });
    await pay(guild, a, first.channel, hex('b1'));
    assert.equal(first.ticket().order.crypto.status, 'failed');
    assert.equal(first.ticket().order.crypto.state, 'address');
    assert.match(texts(first.channel), new RegExp(`Not sent to our wallet\\n<@${a.id}> Transaction \`b1b1b1b1b1…b1b1b1\` doesn't send BTC to our wallet \`${wallet('BTC')}\`\\. Please check the ID`));
    assert.equal(db.guild(guild.id).usedTxs[hex('b1')], undefined);

    const b = member(guild);
    const second = await order(guild, b, product);
    chain.ethTx(`0x${hex('f0')}`, { status: 'error' });
    await pay(guild, b, second.channel, `0x${hex('f0')}`);
    assert.equal(second.ticket().order.crypto.state, 'failedtx');
    assert.match(texts(second.channel), /❌ Transaction failed\n<@\d+> Transaction `0xf0f0f0f0…f0f0f0` failed on the Ethereum network/);

    const c = member(guild);
    const third = await order(guild, c, product);
    chain.btcTx(hex('0d'), { time: nowSec() - 3 * 3600 });
    await pay(guild, c, third.channel, hex('0d'));
    assert.equal(third.ticket().order.crypto.state, 'old');
    assert.match(texts(third.channel), /Transaction older than this order[\s\S]*send the ID of the payment for \*\*this\*\* order/);
    for (const o of [first, second, third]) assert.equal(statusOf(o.ticket()), 'sent', 'never Paid');
  });
});

test('a transaction ID can be used once: a second order with the same ID is refused and the team told', async () => {
  const { guild, product } = await shopGuild();
  await withChain(async (chain) => {
    const a = member(guild);
    const first = await order(guild, a, product);
    const txid = hex('c4');
    chain.btcTx(txid);
    await pay(guild, a, first.channel, txid);
    assert.equal(first.ticket().order.crypto.status, 'confirmed');

    const b = member(guild);
    const second = await order(guild, b, product);
    const calls = chain.explorerCalls().length;
    await pay(guild, b, second.channel, `https://mempool.space/tx/${txid}`);
    assert.equal(second.ticket().order.crypto.state, 'used');
    assert.equal(chain.explorerCalls().length, calls, 'refused without asking the explorer');
    assert.equal(statusOf(second.ticket()), 'sent');
    assert.match(texts(second.channel), /Transaction already used\n<@\d+> Transaction `c4c4c4c4c4…c4c4c4` was already used for another order/);
    assert.match(logTexts(guild), new RegExp(`Already used for another order[\\s\\S]*Used by <#${first.channel.id}>`));
    assert.equal(db.guild(guild.id).usedTxs[txid], first.channel.id);

    // Two orders sending the same new ID at the same moment: only one of them gets it.
    const c = member(guild);
    const d = member(guild);
    const third = await order(guild, c, product);
    const fourth = await order(guild, d, product);
    const shared = hex('77');
    chain.btcTx(shared, { confirmations: 0 });
    await Promise.all([pay(guild, c, third.channel, shared), pay(guild, d, fourth.channel, shared)]);
    const states = [third, fourth].map((o) => o.ticket().order.crypto.state).sort();
    assert.deepEqual(states, ['used', 'waiting']);
    const owner = [third, fourth].find((o) => o.ticket().order.crypto.state === 'waiting');
    assert.equal(db.guild(guild.id).usedTxs[shared], owner.channel.id);
  });
});

test('not found: looked for 15 minutes, then the customer is asked to check the ID and the team pinged', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const txid = hex('9e');
    const i = await pay(guild, buyer, channel, txid);
    assert.match(textOf(lastResponse(i)), /can't see your transaction on the blockchain yet/);
    assert.equal(ticket().order.crypto.status, 'checking');
    assert.match(texts(channel), /🔎 Looking for your transaction\nTransaction `9e9e9e9e9e…9e9e9e` isn't on the Bitcoin or Ethereum network yet/);
    assert.ok(chain.calls.some((u) => u.includes(`mempool.space/api/tx/${txid}`)) && chain.calls.some((u) => u.includes(`blockscout.com/api/v2/transactions/0x${txid}`)), 'both coins are tried');

    await cryptoverify.checkPending(guild.client, { now: Date.now() + 5 * 60_000 });
    assert.equal(ticket().order.crypto.status, 'checking');
    await cryptoverify.checkPending(guild.client, { now: Date.now() + 16 * 60_000 });
    assert.equal(ticket().order.crypto.status, 'failed');
    const card = cryptoCards(channel).at(-1);
    assert.match(textOf(card.body), /❌ Transaction not found\n<@\d+> We couldn't find transaction .* Please check the ID and click \*\*Pay\*\* to send the right one/);
    assert.ok(card.body.allowedMentions.roles.length > 0);
    assert.equal(cryptoCards(channel).length, 1, 'the "looking" card is replaced');

    // Found after all → the customer sends it again and it's confirmed.
    chain.btcTx(txid);
    const again = createInteraction({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { note: txid }, channel });
    db.updateTicket(channel.id, { order: { ...ticket().order, payment: { ...ticket().order.payment, at: Date.now() - 120_000 } } }); // past the cooldown
    await handle(again, commands);
    assert.equal(ticket().order.crypto.status, 'confirmed');
    assert.deepEqual(ticket().order.crypto.previous, [{ coin: 'BTC', txid, status: 'failed', state: 'notfound', amount: null }], 'the first try stays on record');
    assert.ok(ticket().completedAt);
  });
});

test('ETH from an exchange through a contract (internal transfer) counts; Blockscout down → the public node', async () => {
  const { guild, product } = await shopGuild();
  await withChain(async (chain) => {
    const a = member(guild);
    const first = await order(guild, a, product);
    const hash = `0x${hex('1c')}`;
    chain.ethTx(hash, {
      to: '0x00000000000000000000000000000000000c0de0',
      wei: '0',
      internal: [
        { to: { hash: '0x1111111111111111111111111111111111111111' }, value: '5000', success: true },
        { to: { hash: wallet('ETH').toUpperCase().replace('0X', '0x') }, value: '9600000000000000', success: true },
      ],
    });
    await pay(guild, a, first.channel, hash);
    const c = first.ticket().order.crypto;
    assert.equal(c.status, 'confirmed');
    assert.equal(c.internal, true);
    assert.match(texts(first.channel), /internal transfer/);
    assert.ok(first.ticket().completedAt);

    const b = member(guild);
    const second = await order(guild, b, product);
    chain.state.blockscoutDown = true;
    const direct = `0x${hex('2d')}`;
    chain.nodeTx(direct, { confirmations: 15 });
    await pay(guild, b, second.channel, direct);
    assert.equal(second.ticket().order.crypto.status, 'confirmed');
    assert.equal(second.ticket().order.crypto.confirmations, 15);
    assert.ok(second.ticket().completedAt);
    chain.state.blockscoutDown = false;

    // crypto.internalTransfers: false (a wallet that doesn't credit them) → the team checks it, nothing is delivered.
    config.crypto.internalTransfers = false;
    try {
      const c3 = member(guild);
      const third = await order(guild, c3, product);
      const viaContract = `0x${hex('3c')}`;
      chain.ethTx(viaContract, { to: '0x00000000000000000000000000000000000c0de0', wei: '0', internal: [{ to: { hash: wallet('ETH') }, value: '9600000000000000', success: true }] });
      await pay(guild, c3, third.channel, viaContract);
      assert.equal(third.ticket().order.crypto.state, 'internal');
      assert.equal(statusOf(third.ticket()), 'sent');
      assert.equal(third.ticket().completedAt ?? null, null);
      const card = cryptoCards(third.channel).at(-1);
      assert.match(textOf(card.body), /A seller confirms this payment\n<@\d+> Transaction `0x3c3c3c3c…3c3c3c` sends \*\*0\.0096 ETH\*\* through a contract/);
      assert.ok(card.body.allowedMentions.roles.length > 0, 'the team is pinged');
      assert.equal(db.guild(guild.id).usedTxs[viaContract], third.channel.id);
    } finally {
      delete config.crypto.internalTransfers;
    }
  });
});

test('a pending contract transaction waits for its block; without a quote today\'s rate is used', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    db.updateTicket(channel.id, { order: { ...ticket().order, cryptoQuote: undefined } }); // an order from an older version
    const hash = `0x${hex('7b')}`;
    chain.ethTx(hash, { to: '0x00000000000000000000000000000000000c0de0', wei: '0', status: null, confirmations: 0, time: null });
    await pay(guild, buyer, channel, hash);
    assert.equal(ticket().order.crypto.state, 'pending');
    assert.match(texts(channel), /⏳ Transaction found\nTransaction `0x7b7b7b7b…7b7b7b` is waiting to be included in a block/);

    chain.ethTx(hash, { to: '0x00000000000000000000000000000000000c0de0', wei: '0', internal: [{ to: { hash: wallet('ETH') }, value: '9600000000000000', success: true }] });
    await cryptoverify.checkPending(guild.client);
    assert.equal(ticket().order.crypto.status, 'confirmed');
    assert.equal(ticket().order.crypto.required, '0.0096', 'from the rate at check time');
  });
});

test('confirmations: 48 hours without them → the team checks it by hand', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const txid = hex('d8');
    chain.btcTx(txid, { confirmations: 0 });
    await pay(guild, buyer, channel, txid);
    assert.equal(ticket().order.crypto.state, 'waiting');
    assert.match(texts(channel), /Confirmations:\*\* 0 \/ 1 – your order is confirmed here automatically, usually within ~10 min/);
    await cryptoverify.checkPending(guild.client, { now: Date.now() + 49 * 3_600_000 });
    assert.equal(ticket().order.crypto.status, 'failed');
    assert.equal(ticket().order.crypto.state, 'timeout');
    assert.match(texts(channel), /Not confirmed after 48 hours/);
    assert.match(logTexts(guild), /Not confirmed after 48 h/);
    assert.equal(statusOf(ticket()), 'sent');
  });
});

test('staff confirmed it by hand while it was checked: the blockchain confirmation adds nothing twice', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const txid = hex('a7');
    chain.btcTx(txid, { confirmations: 0 });
    await pay(guild, buyer, channel, txid);
    await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
    assert.ok(ticket().completedAt);
    chain.btcTx(txid, { confirmations: 1 });
    await cryptoverify.checkPending(guild.client);
    assert.equal(ticket().order.crypto.status, 'confirmed');
    assert.equal(productMessages(channel).length, 1);
    assert.equal(db.sales(guild.id).filter((s) => s.channelId === channel.id).length, 1);
    assert.doesNotMatch(texts(channel), /payment received|paid twice/);
  });
});

test('crypto.autoVerify off: the old manual flow – no check, the team is pinged', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  const prev = config.crypto.autoVerify;
  config.crypto.autoVerify = false;
  try {
    await withChain(async (chain) => {
      const { channel, ticket } = await order(guild, buyer, product);
      assert.doesNotMatch(texts(channel), /confirmed here automatically/);
      assert.match(texts(channel), /Then click \*\*Pay\*\* and send the transaction ID \(hash\) or a screenshot/);
      assert.match(texts(channel), /Only on the \*\*Bitcoin\*\* network/, 'the network is still named');
      chain.btcTx(hex('ab'));
      const i = await pay(guild, buyer, channel, hex('ab'));
      assert.match(textOf(lastResponse(i)), /Your payment was sent to the seller/);
      assert.equal(chain.explorerCalls().length, 0, 'no explorer is asked');
      assert.equal(ticket().order.crypto, undefined);
      const sent = channel.messageList.find((m) => /^## 📨 Payment sent/m.test(textOf(m.body)));
      assert.ok(sent.body.allowedMentions.roles.length > 0, 'the team is pinged as before');
      await cryptoverify.checkPending(guild.client);
      assert.equal(statusOf(ticket()), 'sent');
    });
  } finally {
    config.crypto.autoVerify = prev;
  }
});

test('the explorer is down: checked again on the next round, the customer isn\'t asked to resend', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  await withChain(async (chain) => {
    const { channel, ticket } = await order(guild, buyer, product);
    const hash = `0x${hex('4e')}`;
    chain.ethTx(hash);
    chain.state.blockscoutDown = true;
    chain.state.nodeDown = true;
    const i = await pay(guild, buyer, channel, hash);
    assert.match(textOf(lastResponse(i)), /We're checking your transaction on the blockchain/);
    assert.equal(ticket().order.crypto.state, 'unavailable');
    assert.match(texts(channel), /🔎 Checking your transaction\nTransaction `0x4e4e4e4e…4e4e4e` can't be checked on the Ethereum network right now – it's tried again automatically every minute\. No need to send it again\./);
    await cryptoverify.checkPending(guild.client, { now: Date.now() + 30 * 60_000 });
    assert.equal(ticket().order.crypto.status, 'checking', 'an explorer that is down is no reason to give up');
    chain.state.blockscoutDown = false;
    chain.state.nodeDown = false;
    await cryptoverify.checkPending(guild.client);
    assert.equal(ticket().order.crypto.status, 'confirmed');

    // A server that is unavailable is skipped.
    const other = await shopGuild();
    const buyer2 = member(other.guild);
    const second = await order(other.guild, buyer2, other.product);
    chain.btcTx(hex('6f'), { confirmations: 0 });
    await pay(other.guild, buyer2, second.channel, hex('6f'));
    chain.btcTx(hex('6f'));
    other.guild.available = false;
    await cryptoverify.checkPending(other.guild.client);
    assert.equal(second.ticket().order.crypto.status, 'checking');
    other.guild.available = true;
    await cryptoverify.checkPending(other.guild.client);
    assert.equal(second.ticket().order.crypto.status, 'confirmed');
  });
});
