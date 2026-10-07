'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage, validateModal } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const panels = require('../src/lib/panels');
const promos = require('../src/features/promos');
const shop = require('../src/features/shop');
const flash = require('../src/features/flashsales');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 933000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const sale = (guild, who, sub, options = {}) => run({ guild, member: who, kind: 'command', commandName: 'sale', subcommand: sub, options });
const product = (guild, who, sub, options) => run({ guild, member: who, kind: 'command', commandName: 'product', subcommand: sub, options });
const said = (i) => textOf(lastResponse(i));
const HOUR = 3_600_000;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.', emoji: '💎' });
  return { guild, nitro, seller: member(guild, ['member', 'seller']) };
}

function shopMessage(guild) {
  const panel = db.panels(guild.id, 'shop')[0];
  return guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId);
}

async function order(guild, buyer, p, { quantity = '1', variant, promo } = {}) {
  const selects = { payment: ['0'] };
  if (variant) selects.variant = [variant];
  const fields = { quantity };
  if (promo) fields.promo = promo;
  const i = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${p.id}`, fields, selects });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { i, ticket };
}

const answer = (ticket, label) => ticket.answers.find((a) => a.label === label)?.value;
const onSale = (p, percent, ms = HOUR) => Object.assign(p, { sale: { percent, endsAt: Date.now() + ms, startedBy: null, startedAt: Date.now() } });

test('/sale start | stop | list: admins and sellers only, number prices only, durations up to 7 days', async () => {
  const { guild, nitro, seller } = await shopGuild();
  const notStaff = await sale(guild, member(guild), 'list');
  assert.match(said(notStaff), /Only administrators and sellers can run flash sales/);
  assert.match(said(await sale(guild, seller, 'list')), /Nothing is on sale right now/);

  const logo = shop.addProduct(guild, { name: 'Custom Logo', price: 'from 5€', description: 'Made for you.' });
  const text = await sale(guild, seller, 'start', { product: logo.id, percent: 20, duration: '2h' });
  assert.match(said(text), /\*\*Custom Logo\*\* can't go on sale: its price "from 5€" is not a plain number/);
  assert.equal(logo.sale, null);
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 1 year = ask');
  const option = await sale(guild, seller, 'start', { product: netflix.id, percent: 20, duration: '2h' });
  assert.match(said(option), /the price of the option \*\*1 year\*\* \("ask"\) is not a plain number/);

  for (const duration of ['soon', '8d', '30s', '0m', '1w1m']) {
    const bad = await sale(guild, seller, 'start', { product: nitro.id, percent: 20, duration });
    assert.match(said(bad), /duration must look like `30m`, `2h`, `1d` or `1h30m` – from 1 minute up to 7 days/, duration);
  }
  assert.equal(flash.saleDuration('1h30m'), 1.5 * HOUR);
  assert.equal(flash.saleDuration('7d'), 168 * HOUR);
  for (const percent of [0, 91, 12.5]) assert.throws(() => flash.startSale(guild, nitro.id, { percent, durationMs: HOUR }), /whole number from 1 to 90/);
  assert.equal(nitro.sale, null);

  const before = Date.now();
  const start = await sale(guild, seller, 'start', { product: nitro.id, percent: 20, duration: '2h', announce: false });
  assert.match(said(start), /Nitro is on sale[\s\S]*\*\*−20%\*\* · ends <t:\d+:R>[\s\S]*~~20€~~ \*\*16€\*\*/);
  assert.equal(nitro.sale.percent, 20);
  assert.equal(nitro.sale.startedBy, seller.id);
  assert.ok(nitro.sale.endsAt >= before + 2 * HOUR && nitro.sale.endsAt <= Date.now() + 2 * HOUR);
  const log = textOf(guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1).body);
  assert.match(log, /Flash sale started[\s\S]*put \*\*Nitro\*\* on sale: \*\*−20%\*\*/);

  const list = await sale(guild, seller, 'list');
  assert.match(said(list), /Flash sales \(1\)[\s\S]*⚡ \*\*Nitro\*\* · \*\*−20%\*\* · ends <t:\d+:R>[\s\S]*~~20€~~ \*\*16€\*\* · started by <@/);

  const restart = await sale(guild, seller, 'start', { product: nitro.id, percent: 30, duration: '1d', announce: false });
  assert.match(said(restart), /It replaces the −20% sale that was running\./);
  assert.equal(nitro.sale.percent, 30);

  // Autocomplete for /sale stop only suggests what is on sale.
  const ac = await run({ guild, member: seller, kind: 'autocomplete', commandName: 'sale', subcommand: 'stop', focusedOption: 'product', focused: '' });
  assert.deepEqual(ac.state.responded.map((c) => c.value), [nitro.id]);
  assert.match(ac.state.responded[0].name, /Nitro · 20€ · −30% sale · In stock/);
  const acStart = await run({ guild, member: seller, kind: 'autocomplete', commandName: 'sale', subcommand: 'start', focusedOption: 'product', focused: '' });
  assert.equal(acStart.state.responded.length, 3);

  const stop = await sale(guild, seller, 'stop', { product: nitro.id });
  assert.match(said(stop), /The sale of \*\*Nitro\*\* has ended – it is back to \*\*20€\*\*/);
  assert.equal(nitro.sale, null);
  assert.match(said(await sale(guild, seller, 'stop', { product: nitro.id })), /\*\*Nitro\*\* is not on sale right now/);
});

test('the card: crossed-out old price, the new price and a live countdown – every option shows its reduced price', async () => {
  const { guild, nitro } = await shopGuild();
  const { product: p } = flash.startSale(guild, nitro.id, { percent: 20, durationMs: 2 * HOUR });
  const end = Math.floor(p.sale.endsAt / 1000);
  const card = shop.cardText(guild, nitro);
  assert.equal(card, `### 💎 Nitro\u2002\u2002~~20€~~ **16€** · −20%\nInstant delivery.\n-# 🟢 In stock\n-# ⏰ Sale ends <t:${end}:R>`);
  await panels.refresh(guild, 'shop');
  assert.match(textOf(shopMessage(guild).body), /~~20€~~ \*\*16€\*\* · −20%[\s\S]*⏰ Sale ends <t:\d+:R>/);

  // The order form tells the buyer too.
  const modal = validateModal(shop.orderModal(nitro, guild), guild);
  assert.match(modal.components[0].content, /\*\*Nitro\*\* — ~~20€~~ \*\*16€\*\* · −20%/);

  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.', emoji: '🎬' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12, 12 months = 40');
  flash.startSale(guild, netflix.id, { percent: 20, durationMs: HOUR });
  const lines = shop.cardText(guild, netflix).split('\n');
  assert.equal(lines[0], '### 🎬 Netflix\u2002\u2002from ~~5€~~ **4€** · −20%');
  assert.equal(lines[2], '-# 1 month 4€ · 3 months 9.60€ · 12 months 32€');
  const options = validateModal(shop.orderModal(netflix, guild), guild).components[0].component.options;
  assert.deepEqual(options.map((o) => o.description), ['4€ (was 5€ · −20% flash sale)', '9.60€ (was 12€ · −20% flash sale)', '32€ (was 40€ · −20% flash sale)']);

  // Over: the card is back to normal, even before the timer clears it.
  nitro.sale.endsAt = Date.now() - 1;
  assert.equal(shop.cardText(guild, nitro), '### 💎 Nitro\u2002\u2002**20€**\nInstant delivery.\n-# 🟢 In stock');
});

test('price maths: the sale comes off the unit price before the quantity and the promo code', async () => {
  const { guild, nitro } = await shopGuild();
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12.50');
  flash.startSale(guild, netflix.id, { percent: 20, durationMs: HOUR });
  promos.create(guild.id, { code: 'NOX10', percent: 10 });

  const threeMonths = netflix.variants.find((v) => v.name === '3 months').id;
  const { i, ticket } = await order(guild, member(guild), netflix, { quantity: '3', variant: threeMonths, promo: 'nox10' });
  assert.equal(ticket.order.product, 'Netflix — 3 months');
  assert.equal(ticket.order.unitPrice, 10);
  assert.equal(ticket.order.subtotal, 30);
  assert.equal(ticket.order.discount, 3);
  assert.equal(ticket.order.total, 27);
  assert.equal(ticket.order.salePercent, 20);
  assert.equal(answer(ticket, 'Product'), 'Netflix — 3 months — 12.50€');
  assert.equal(answer(ticket, 'Price'), '⚡ Flash sale −20%: 12.50€ → 10€ each\nSubtotal: 30€ (3 × 10€)\nDiscount (NOX10 · 10% off): −3€\n**Total to pay: 27€**');
  assert.match(said(i), /Total to pay: \*\*27€\*\* \(⚡ −20% flash sale · you save 3€ with \*\*NOX10\*\*\)/);

  // One item, no code.
  flash.startSale(guild, nitro.id, { percent: 25, durationMs: HOUR });
  const single = await order(guild, member(guild), nitro);
  assert.equal(answer(single.ticket, 'Price'), '⚡ Flash sale −25%: 20€ → 15€\n**Total to pay: 15€**');
  assert.equal(single.ticket.order.total, 15);

  // Cents are rounded: 19.99 − 15% = 16.99.
  const odd = shop.addProduct(guild, { name: 'Odd', price: '19,99', description: 'Odd price.' });
  onSale(odd, 15);
  const p = shop.priceOrder(guild.id, '1', odd, 2, null);
  assert.deepEqual([p.listPrice, p.unitPrice, p.subtotal, p.salePercent], [19.99, 16.99, 33.98, 15]);

  // A promo code that can't be used never blocks the sale price.
  const bad = shop.priceOrder(guild.id, '1', nitro, 2, 'NOPE');
  assert.deepEqual([bad.unitPrice, bad.total, bad.error], [15, 30, "This code doesn't exist."]);
});

test('an ended sale is never applied – the timer clears it, refreshes the panel and skips unavailable servers', async () => {
  const { guild, nitro } = await shopGuild();
  // Ended, but not cleared yet: full price.
  nitro.sale = { percent: 50, endsAt: Date.now() - 1000, startedBy: null, startedAt: Date.now() - HOUR };
  const { ticket } = await order(guild, member(guild), nitro, { quantity: '2' });
  assert.equal(ticket.order.unitPrice, 20);
  assert.equal(ticket.order.total, 40);
  assert.equal('salePercent' in ticket.order, false);
  assert.doesNotMatch(answer(ticket, 'Price'), /Flash sale/);
  assert.deepEqual(flash.onSale(guild.id), []);

  // The panel shows the sale while it runs; the timer ends it and refreshes the panel.
  flash.startSale(guild, nitro.id, { percent: 20, durationMs: HOUR });
  await panels.refresh(guild, 'shop');
  assert.match(textOf(shopMessage(guild).body), /~~20€~~/);
  const timer = hooks.timers().find((x) => x.name === 'flashSales');
  assert.equal(timer.ms, 60_000);

  assert.equal(await flash.expireSales(guild.client, Date.now()), 0, 'still running');
  guild.available = false;
  assert.equal(await flash.expireSales(guild.client, Date.now() + 2 * HOUR), 0, 'an unavailable server is skipped');
  assert.notEqual(nitro.sale, null);
  guild.available = true;
  assert.equal(await flash.expireSales(guild.client, Date.now() + 2 * HOUR), 1);
  assert.equal(nitro.sale, null);
  assert.doesNotMatch(textOf(shopMessage(guild).body), /~~20€~~|Sale ends/);
  assert.match(textOf(shopMessage(guild).body), /Nitro\u2002\u2002\*\*20€\*\*/);
});

test('starting a sale announces it in #restocks with the Restocks ping – unless it is sold out or announce:false', async () => {
  const { guild, nitro, seller } = await shopGuild();
  const restocks = ch(guild, 'restocks');
  const count = restocks.messageList.length;
  const start = await sale(guild, seller, 'start', { product: nitro.id, percent: 20, duration: '2h' });
  assert.match(said(start), /Sale announced in #restocks/);
  assert.equal(restocks.messageList.length, count + 1);
  const post = restocks.messageList.at(-1).body;
  validateMessage(post, guild);
  const roleId = role(guild, 'pingRestocks');
  assert.match(textOf(post), /⚡ Flash sale: 💎 Nitro −20%[\s\S]*\*\*Price:\*\* ~~20€~~ \*\*16€\*\*[\s\S]*Ends <t:\d+:R>/);
  assert.match(textOf(post), new RegExp(`<@&${roleId}>`));
  assert.deepEqual(post.allowedMentions, { roles: [roleId] });
  assert.ok(customIds(post).includes(`shop:buy:${nitro.id}`));

  // With options: every option with its old and new price.
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12');
  await sale(guild, seller, 'start', { product: netflix.id, percent: 50, duration: '30m' });
  assert.match(textOf(restocks.messageList.at(-1).body), /1 month ~~5€~~ \*\*2\.50€\*\* · 3 months ~~12€~~ \*\*6€\*\*/);

  const quiet = restocks.messageList.length;
  await sale(guild, seller, 'start', { product: nitro.id, percent: 10, duration: '1h', announce: false });
  await shop.setStock(guild, netflix.id, 'out');
  const soldOut = await sale(guild, seller, 'start', { product: netflix.id, percent: 10, duration: '1h' });
  assert.match(said(soldOut), /sold out right now – buyers see the sale price once it's back in stock/);
  assert.equal(restocks.messageList.length, quiet, 'nothing posted');
});

test('while on sale the price – or an option price – must stay a number', async () => {
  const { guild, nitro, seller } = await shopGuild();
  flash.startSale(guild, nitro.id, { percent: 20, durationMs: HOUR });
  const edit = await product(guild, seller, 'edit', { product: nitro.id, price: 'ask us' });
  assert.match(said(edit), /\*\*Nitro\*\* is on a flash sale right now and its price "ask us" is not a plain number[\s\S]*`\/sale stop`/);
  assert.equal(nitro.price, '20');
  const variants = await product(guild, seller, 'variants', { product: nitro.id, variants: '1 month = 5, 1 year = ask' });
  assert.match(said(variants), /is on a flash sale right now and the price of the option \*\*1 year\*\*/);
  assert.deepEqual(nitro.variants, []);

  // Numbers are fine, and the preview shows the sale prices.
  const ok = await product(guild, seller, 'variants', { product: nitro.id, variants: '1 month = 5, 1 year = 40' });
  assert.match(said(ok), /• 1 month — ~~5€~~ \*\*4€\*\*\n• 1 year — ~~40€~~ \*\*32€\*\*\n-# ⚡ −20% flash sale until/);
  // After the sale anything goes again.
  await sale(guild, seller, 'stop', { product: nitro.id });
  await product(guild, seller, 'variants', { product: nitro.id, variants: 'none' });
  await product(guild, seller, 'edit', { product: nitro.id, price: 'ask us' });
  assert.equal(nitro.price, 'ask us');
});
