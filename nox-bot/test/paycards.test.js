'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const paycards = require('../src/features/paycards');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 996000000000000000n;
const uid = () => String(++n);
const member = (guild) => guild.addMember(uid(), [db.roleId(guild.id, 'member')]);
const METHOD = (type) => String(config.shop.paymentMethods.findIndex((m) => m.type === type));
const crypto = () => config.shop.paymentMethods.find((m) => m.type === 'crypto');
const paypal = () => config.shop.paymentMethods.find((m) => m.type === 'paypal');

async function shopGuild(price = '12') {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, product: shop.addProduct(guild, { name: 'Netflix Premium', price, description: 'UHD account.' }) };
}

/** Places an order (quantity 2) and returns the payment card posted in its ticket. */
async function cardFor(guild, product, type) {
  const buyer = member(guild);
  const i = createInteraction({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '2' }, selects: { payment: [METHOD(type)] } });
  await handle(i, commands);
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id)[0];
  const channel = guild.channels.cache.get(ticket.channelId);
  const card = channel.messageList.map((m) => m.body ?? m).find((b) => /^## .*(Pay |Payment)/m.test(textOf(b)));
  return { card, channel, ticket };
}

const withFetch = async (fake, fn) => {
  const real = global.fetch;
  global.fetch = fake;
  try {
    return await fn();
  } finally {
    global.fetch = real;
  }
};

test('PaysafeCard: "Pay 24€" with the steps and an Enter PIN button that opens the PIN form', async () => {
  const { guild, product } = await shopGuild();
  const { card, channel } = await cardFor(guild, product, 'paysafecard');
  assert.ok(card, 'a payment card is posted');
  validateMessage(card, guild);
  const out = textOf(card);
  assert.match(out, /Pay 24€ – PaysafeCard/);
  assert.match(out, /Buy a \*\*PaysafeCard\*\* worth \*\*24€\*\*/);
  assert.match(out, /Click \*\*Pay\*\* and enter the 16-digit PIN/);
  assert.ok(customIds(card).includes('pay:open'));
  const i = createInteraction({ guild, member: guild.members.cache.get(db.getTicket(channel.id).ownerId), kind: 'button', customId: 'pay:open', channel });
  await handle(i, commands);
  const modal = i.state.modals.at(-1);
  assert.ok(JSON.stringify(modal).includes('PaysafeCard PIN'), 'the form asks for the PIN');
});

test('Crypto: the wallets from config.json with the amount in coins (rounded up), and I\'ve paid', async () => {
  const { guild, product } = await shopGuild();
  const prev = { ...crypto().addresses };
  crypto().addresses = { BTC: 'bc1qnoxexamplewallet000000000000000000', ETH: '0x1234567890abcdef1234567890abcdef12345678' };
  try {
    let asked = null;
    const { card } = await withFetch(async (url) => {
      asked = url;
      return { ok: true, json: async () => ({ bitcoin: { eur: 60000 }, ethereum: { eur: 2500 } }) };
    }, () => cardFor(guild, product, 'crypto'));
    validateMessage(card, guild);
    const out = textOf(card);
    assert.match(asked, /^https:\/\/api\.coingecko\.com\/api\/v3\/simple\/price\?ids=bitcoin,ethereum&vs_currencies=eur$/);
    assert.match(out, /Send \*\*24€\*\* to one of these wallets/);
    assert.match(out, /Bitcoin \(BTC\)\*\* – \*\*≈ 0\.00040000 BTC\*\*/);
    assert.match(out, /Ethereum \(ETH\)\*\* – \*\*≈ 0\.009600 ETH\*\*/);
    assert.ok(out.includes('bc1qnoxexamplewallet000000000000000000'));
    assert.ok(out.includes('0x1234567890abcdef1234567890abcdef12345678'));
    assert.match(out, /Then click \*\*Pay\*\* and send the transaction ID/);
    assert.ok(customIds(card).includes('pay:open'));
    assert.equal(paycards.coinAmount(10, 3, 'BTC'), '3.33333334', 'never less than the price');
  } finally {
    crypto().addresses = prev;
  }
});

test('Crypto without rates (CoinGecko down) still shows the wallets; without wallets the seller sends one', async () => {
  const { guild, product } = await shopGuild();
  const prev = { ...crypto().addresses };
  try {
    crypto().addresses = { BTC: 'bc1qnoxsecondwallet', ETH: '' };
    const { card } = await cardFor(guild, product, 'crypto'); // tests have no network → no rates
    assert.ok(textOf(card).includes('bc1qnoxsecondwallet'));
    assert.doesNotMatch(textOf(card), /≈/);
    assert.doesNotMatch(textOf(card), /Ethereum/, 'an empty wallet is left out');

    crypto().addresses = { BTC: '', ETH: '' };
    const { card: none } = await cardFor(guild, product, 'crypto');
    assert.match(textOf(none), /A seller sends you the wallet address here – send \*\*24€\*\*/);
  } finally {
    crypto().addresses = prev;
  }
});

test('PayPal without keys: a paypal.me link with the amount – or the seller sends the address', async () => {
  const { guild, product } = await shopGuild();
  const prev = paypal().paypalMe;
  try {
    paypal().paypalMe = 'https://paypal.me/NoxShop';
    const { card } = await cardFor(guild, product, 'paypal');
    validateMessage(card, guild);
    assert.ok(JSON.stringify(card.components.map((c) => c.toJSON?.() ?? c)).includes('https://paypal.me/NoxShop/24.00EUR'));
    assert.match(textOf(card), /then click \*\*Pay\*\* and send a screenshot/);
    assert.ok(customIds(card).includes('pay:open'));

    paypal().paypalMe = '';
    const { card: manual } = await cardFor(guild, product, 'paypal');
    assert.match(textOf(manual), /A seller sends you the PayPal address here – pay \*\*24€\*\*/);
  } finally {
    paypal().paypalMe = prev;
  }
  assert.equal(paycards.paypalMeName('@Nox_Shop'), null, 'paypal.me names are letters and numbers');
  for (const spelling of ['NoxShop', '@NoxShop', 'paypal.me/NoxShop', 'www.paypal.me/NoxShop', 'https://www.paypal.me/NoxShop/10', 'https://paypal.me/NoxShop?country.x=PL', 'https://www.paypal.com/paypalme/NoxShop']) {
    assert.equal(paycards.paypalMeName(spelling), 'NoxShop', spelling);
  }
});

test('Stripe without a key and prices that aren\'t fixed get a card too; with proofs turned off there is no button', async () => {
  const { guild, product } = await shopGuild();
  const { card: stripeCard } = await cardFor(guild, product, 'stripe');
  assert.match(textOf(stripeCard), /Pay 24€ – Stripe[\s\S]*A seller sends you the payment details here/);

  const custom = shop.addProduct(guild, { name: 'Custom bundle', price: 'from 5€', description: 'Ask us.' });
  const { card: open } = await cardFor(guild, custom, 'paysafecard');
  assert.match(textOf(open), /## .* Payment – PaysafeCard/);
  assert.match(textOf(open), /worth the amount the seller confirms/);

  config.orders.paymentProofs = false;
  try {
    const { card } = await cardFor(guild, product, 'crypto');
    assert.ok(!customIds(card).includes('pay:open'));
    assert.match(textOf(card), /here in the ticket/);
  } finally {
    config.orders.paymentProofs = true;
  }
});

test('payment methods from older config.json files (no "type") are recognised by their name', () => {
  assert.equal(paycards.methodType({ name: 'PaysafeCard' }), 'paysafecard');
  assert.equal(paycards.methodType({ name: 'Crypto', details: 'BTC' }), 'crypto');
  assert.equal(paycards.methodType({ name: 'Bitcoin' }), 'crypto');
  assert.equal(paycards.methodType({ name: 'PayPal' }), 'paypal');
  assert.equal(paycards.methodType({ name: 'Stripe', stripe: true }), 'stripe');
  assert.equal(paycards.methodType({ name: 'Bank transfer' }), 'other');
});

test('one place decides a method\'s kind: the PIN field and Stripe follow it too', () => {
  const ui = require('../src/tickets/ui');
  const stripe = require('../src/features/stripe');
  const prev = [...config.shop.paymentMethods];
  try {
    config.shop.paymentMethods.push({ name: 'PSC', emoji: 'paysafecard', type: 'paysafecard' }, { name: 'PayPal / Karta (Stripe)', emoji: 'paypal' });
    const psc = { method: 'PSC', methodIndex: config.shop.paymentMethods.length - 2 };
    assert.equal(ui.takesPins(psc), true, '"PSC" set as PaysafeCard asks for the PIN');
    assert.equal(ui.takesPins({ method: 'Crypto', methodIndex: 1 }), false);
    assert.equal(ui.takesPins({ method: null }), true, 'unknown method → the PIN field stays');
    const mixed = { method: 'PayPal / Karta (Stripe)', methodIndex: config.shop.paymentMethods.length - 1 };
    assert.equal(paycards.methodType(paycards.methodOf(mixed)), 'paypal');
    assert.equal(stripe.isStripeOrder(mixed), false, 'never a Stripe link AND a PayPal card for one order');
  } finally {
    config.shop.paymentMethods.splice(0, config.shop.paymentMethods.length, ...prev);
  }
});
