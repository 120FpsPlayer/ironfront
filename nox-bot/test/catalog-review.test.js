'use strict';

// Review fixes for the shop catalog features: the Bestseller badge after completed orders, flash sales on
// prices in another currency, the flash sale line of a reopened order, and the options in the sales report.

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const panels = require('../src/lib/panels');
const promos = require('../src/features/promos');
const shop = require('../src/features/shop');
const flash = require('../src/features/flashsales');
const sales = require('../src/features/salesreport');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 935000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const said = (i) => textOf(lastResponse(i));
const answer = (ticket, label) => ticket.answers.find((a) => a.label === label)?.value;
const HOUR = 3_600_000;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, p, { quantity = '1', variant, promo } = {}) {
  const selects = { payment: ['0'] };
  if (variant) selects.variant = [variant];
  const fields = { quantity };
  if (promo) fields.promo = promo;
  const i = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${p.id}`, fields, selects });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { i, ticket, channel: ticket && guild.channels.cache.get(ticket.channelId) };
}

function shopText(guild) {
  const panel = db.panels(guild.id, 'shop')[0];
  return textOf(guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId).body);
}

/** Records panels.schedule(guild, kind) calls for this guild instead of waiting 3 s for the debounced refresh. */
async function watchSchedule(guild, fn) {
  const calls = [];
  const original = panels.schedule;
  panels.schedule = (g, kind) => {
    if (g === guild) calls.push(kind);
  };
  try {
    await fn(calls);
  } finally {
    panels.schedule = original;
  }
}

test('every completed order of a catalog product refreshes the shop, so the 🔥 Bestseller badge moves – stock counted or not', async () => {
  const { guild, seller } = await shopGuild();
  const alpha = shop.addProduct(guild, { name: 'Alpha', price: '10', description: 'Instant delivery.' });
  const beta = shop.addProduct(guild, { name: 'Beta', price: '10', description: 'Instant delivery.' });
  db.addSale(guild.id, { id: uid(), productId: beta.id, product: 'Beta', quantity: 3 });
  await panels.refresh(guild, 'shop');
  assert.match(shopText(guild), /Beta[^#]*-# 🟢 In stock · 🔥 Bestseller/);

  const first = await order(guild, member(guild), alpha, { quantity: '2' });
  const second = await order(guild, member(guild), alpha, { quantity: '2' });
  await watchSchedule(guild, async (calls) => {
    await t.completeOrder(first.channel, seller);
    await t.completeOrder(second.channel, seller);
    assert.equal(alpha.stockCount, null, 'not counted');
    assert.ok(calls.filter((k) => k === 'shop').length >= 2, 'a refresh is scheduled after each completed order');

    // A custom order (no catalog product) can't move the badge – nothing to refresh.
    calls.length = 0;
    await hooks.emit('orderCompleted', { guild, sale: { product: 'A custom logo', quantity: 5 } });
    assert.deepEqual(calls, []);

    // Badges turned off: no refresh needed either.
    const prev = config.badges.enabled;
    config.badges.enabled = false;
    try {
      await hooks.emit('orderCompleted', { guild, sale: { productId: alpha.id, product: 'Alpha', quantity: 1 } });
      assert.deepEqual(calls, []);
    } finally {
      config.badges.enabled = prev;
    }
  });
  await panels.refresh(guild, 'shop');
  const text = shopText(guild);
  assert.match(text, /Alpha[^#]*-# 🟢 In stock · 🔥 Bestseller/);
  assert.equal(text.match(/Bestseller/g).length, 1);
});

test('a flash sale needs prices in the shop currency – "$20" in a € shop is refused, "20€" and "€20" are fine', async () => {
  const { guild, seller } = await shopGuild();
  const dollars = shop.addProduct(guild, { name: 'US Gift Card', price: '$20', description: 'For the US store.' });
  const start = await run({ guild, member: seller, kind: 'command', commandName: 'sale', subcommand: 'start', options: { product: dollars.id, percent: 20, duration: '2h', announce: false } });
  assert.match(said(start), /\*\*US Gift Card\*\* can't go on sale: its price "\$20" is in another currency than the shop's \(€\)/);
  assert.equal(dollars.sale, null);
  assert.doesNotMatch(shop.cardText(guild, dollars), /~~/);

  // Options too.
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 1 year = £40');
  assert.throws(() => flash.startSale(guild, netflix.id, { percent: 20, durationMs: HOUR }), /the price of the option \*\*1 year\*\* \("£40"\) is in another currency than the shop's \(€\)/);
  assert.equal(netflix.sale, null);

  // The shop's own currency, before or after the number, is a number price.
  for (const price of ['20€', '€20', '20 €', '19,99']) {
    const p = shop.addProduct(guild, { name: `Nitro ${price}`, price, description: 'Instant.' });
    assert.equal(shop.saleProblem(p), null, price);
    flash.startSale(guild, p.id, { percent: 20, durationMs: HOUR });
    assert.match(shop.cardText(guild, p), /~~.+~~ \*\*1[56](?:\.99)?€\*\* · −20%/, price);
  }

  // While on sale, the price can't be changed to another currency either.
  const nitro = shop.findProduct(guild.id, 'Nitro 20€');
  const edit = await run({ guild, member: seller, kind: 'command', commandName: 'product', subcommand: 'edit', options: { product: nitro.id, price: '$25' } });
  assert.match(said(edit), /is on a flash sale right now and its price "\$25" is in another currency than the shop's \(€\)/);
  assert.equal(nitro.price, '20€');

  // A shop that sells in dollars: "$20" is fine, "20€" is not.
  const prev = config.shop.currency;
  config.shop.currency = '$';
  try {
    assert.equal(shop.saleProblem(dollars), null);
    assert.match(shop.saleProblem(nitro), /is in another currency than the shop's \(\$\)/);
  } finally {
    config.shop.currency = prev;
  }
});

test('reopening a flash-sale order that loses its promo code keeps the "was → now" sale line', async () => {
  const { guild, seller } = await shopGuild();
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.' });
  flash.startSale(guild, nitro.id, { percent: 20, durationMs: HOUR });
  promos.create(guild.id, { code: 'HALF', percent: 50 });
  const { ticket, channel } = await order(guild, member(guild), nitro, { quantity: '3', promo: 'HALF' });
  assert.equal(ticket.order.listPrice, 20);
  assert.equal(answer(ticket, 'Price'), '⚡ Flash sale −20%: 20€ → 16€ each\nSubtotal: 48€ (3 × 16€)\nDiscount (HALF · 50% off): −24€\n**Total to pay: 24€**');

  await t.closeTicket(channel, seller, 'No answer');
  promos.remove(guild.id, 'HALF');
  await t.reopenTicket(channel, seller);
  const reopened = db.getTicket(channel.id);
  assert.equal(reopened.order.total, 48);
  assert.equal(answer(reopened, 'Price'), "⚡ Flash sale −20%: 20€ → 16€ each\n**Total to pay: 48€** (3 × 16€)\nPromo code HALF – not applied: This code doesn't exist.");

  // Without a sale the order has no listPrice – as before.
  const plain = shop.addProduct(guild, { name: 'Steam Key', price: '5', description: 'Any game.' });
  const { ticket: normal } = await order(guild, member(guild), plain);
  assert.equal('listPrice' in normal.order, false);
  assert.equal('salePercent' in normal.order, false);
});

test('the sales report lists every option of a product on its own row ("Netflix — 3 months")', async () => {
  const { guild } = await shopGuild();
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.' });
  const now = Date.now();
  const sale = (patch) => db.addSale(guild.id, { id: uid(), productId: netflix.id, product: 'Netflix', variant: null, quantity: 1, amount: 5, method: 'PaysafeCard', discount: 0, createdAt: now - 1000, completedAt: now - 500, ...patch });
  sale({ product: 'Netflix — 3 months', variant: '3 months', amount: 12 });
  sale({ product: 'Netflix — 3 months', variant: '3 months', amount: 12 });
  sale({ product: 'Netflix — 1 month', variant: '1 month', amount: 5 });
  sale({}); // bought before the product had options
  netflix.name = 'Netflix Premium'; // renamed since: the rows use the current name

  const s = sales.summarize(guild.id, sales.periodRange('all', now));
  assert.deepEqual(s.products.map((p) => [p.name, p.orders, p.revenue]), [
    ['Netflix Premium — 3 months', 2, 24],
    ['Netflix Premium', 1, 5],
    ['Netflix Premium — 1 month', 1, 5],
  ]);
  assert.match(textOf(sales.salesCard(guild, sales.periodRange('all', now))), /🥇 \*\*Netflix Premium — 3 months\*\*  ·  2 orders · 24€/);

  // A deleted product keeps the name it was sold under, option included.
  db.guild(guild.id).products = [];
  assert.equal(sales.summarize(guild.id, sales.periodRange('all', now)).products[0].name, 'Netflix — 3 months');
});
