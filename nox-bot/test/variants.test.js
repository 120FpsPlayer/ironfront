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
const panels = require('../src/lib/panels');
const shop = require('../src/features/shop');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 931000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const product = (guild, who, sub, options) => run({ guild, member: who, kind: 'command', commandName: 'product', subcommand: sub, options });

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '20', description: 'Premium account, 4K.', emoji: '🎬' });
  return { guild, netflix, owner: guild.members.cache.get(guild.ownerId), seller: member(guild, ['member', 'seller']) };
}

function shopMessage(guild) {
  const panel = db.panels(guild.id, 'shop')[0];
  return guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId);
}

/** Buy → order form → ticket. */
async function order(guild, buyer, p, { quantity = '1', variant, payment = '0', promo } = {}) {
  const selects = { payment: [payment] };
  if (variant !== undefined) selects.variant = [variant];
  const fields = { quantity };
  if (promo !== undefined) fields.promo = promo;
  const i = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${p.id}`, fields, selects });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { i, ticket, channel: ticket && guild.channels.cache.get(ticket.channelId) };
}

const answer = (ticket, label) => ticket.answers.find((a) => a.label === label)?.value;
const variantId = (p, name) => p.variants.find((v) => v.name === name).id;

// ───────────── Parsing ─────────────

test('variants: separators , ; and new lines, decimal commas, "none" – and friendly errors', () => {
  const parsed = shop.parseVariants('1 month = 5, 3 months = 12; 12 months = 40');
  assert.deepEqual(parsed.map((v) => [v.name, v.price]), [['1 month', '5'], ['3 months', '12'], ['12 months', '40']]);
  assert.equal(new Set(parsed.map((v) => v.id)).size, 3, 'every option has its own ID');

  const decimals = shop.parseVariants('1 month = 4,99, 3 months =12,50\n  1   year  = 40.00 ,');
  assert.deepEqual(decimals.map((v) => [v.name, v.price]), [['1 month', '4,99'], ['3 months', '12,50'], ['1 year', '40.00']]);

  for (const empty of ['none', ' None ', '', '-']) assert.deepEqual(shop.parseVariants(empty), []);

  const bad = (input, pattern) => assert.throws(() => shop.parseVariants(input), pattern, input);
  bad('1 month 5', /name = price/);
  bad('= 5', /name = price/);
  bad('1 month =', /name = price/);
  bad('1 month = 5,3 months = 12', /name = price/); // "5,3" is a decimal comma – the second "=" gives it away
  bad('1 month = 5, 1 MONTH = 6', /\*\*1 MONTH\*\* is there twice/);
  bad(Array.from({ length: 11 }, (_, i) => `${i + 1} months = ${i + 5}`).join(', '), /up to 10 options – that's 11/);
  bad(`${'x'.repeat(51)} = 5`, /names can be up to 50 characters/);
  bad(`1 month = ${'9'.repeat(41)}`, /prices can be up to 40 characters/);

  // The same name again keeps its ID (case and spaces don't matter), new names get new IDs.
  const again = shop.parseVariants('3  MONTHS = 13, 6 months = 20, 1 month = 5', parsed);
  assert.equal(again[0].id, parsed[1].id);
  assert.equal(again[2].id, parsed[0].id);
  assert.ok(!parsed.some((v) => v.id === again[1].id), '6 months is new');
  assert.equal(new Set(again.map((v) => v.id)).size, 3);
});

// ───────────── /product variants ─────────────

test('/product variants: preview reply, stable IDs, "none" removes them; the card, autocomplete, list and announcement show "from"', async () => {
  const { guild, netflix, seller } = await shopGuild();
  const set = (variants) => product(guild, seller, 'variants', { product: netflix.id, variants });

  const first = await set('1 month = 5, 3 months = 12, 12 months = 40');
  const preview = textOf(lastResponse(first));
  assert.match(preview, /Netflix – 3 options/);
  assert.match(preview, /• 1 month — \*\*5€\*\*\n• 3 months — \*\*12€\*\*\n• 12 months — \*\*40€\*\*/);
  assert.match(preview, /The shop shows \*\*from 5€\*\*/);
  const ids = netflix.variants.map((v) => v.id);

  // The card: "from 5€" and one line with every option.
  await panels.refresh(guild, 'shop');
  const card = textOf(shopMessage(guild).body);
  assert.match(card, /🎬 Netflix\u2002{2}from \*\*5€\*\*\n\nPremium account, 4K\.\n\n-# 1 month 5€ · 3 months 12€ · 12 months 40€\n-# 🟢 In stock/);

  // Autocomplete, /product list and the restock announcement.
  const ac = await run({ guild, member: seller, kind: 'autocomplete', commandName: 'product', subcommand: 'edit', focusedOption: 'product', focused: 'net' });
  assert.match(ac.state.responded[0].name, /^Netflix · from 5€ · In stock$/);
  const list = await product(guild, seller, 'list', {});
  assert.match(textOf(lastResponse(list)), /\*\*Netflix\*\* — from 5€ · 3 options/);
  const announcement = await shop.announceProduct(guild, netflix, 'restock');
  assert.match(textOf(announcement.body), /\*\*Price:\*\* from 5€\n-# 1 month 5€ · 3 months 12€ · 12 months 40€/);

  // Entered again: the same names keep their IDs (open order forms still find them).
  await set('1 Month = 6, 3 months = 12, 24 months = 70');
  assert.equal(netflix.variants[0].id, ids[0]);
  assert.equal(netflix.variants[1].id, ids[1]);
  assert.ok(!ids.includes(netflix.variants[2].id));
  assert.equal(netflix.variants[0].name, '1 Month', 'the new spelling is used');

  // Prices that aren't numbers: the product price is shown instead of "from".
  await set('1 month = ask us, 1 year = 40');
  assert.equal(shop.priceLabel(netflix), 'from 40€');
  await set('1 month = ask us, 1 year = on request');
  assert.equal(shop.priceLabel(netflix), '20€');
  assert.match(shop.cardText(guild, netflix), /Netflix\u2002{2}\*\*20€\*\*\n[\s\S]*-# 1 month ask us · 1 year on request/);

  // A long list is cut after whole options with "+N more".
  await set(Array.from({ length: 10 }, (_, i) => `${i + 1} month${i ? 's' : ''} of Premium Ultra HD = ${(i + 1) * 5}`).join(', '));
  const options = shop.cardText(guild, netflix).split('\n')[4];
  assert.match(options, /^-# 1 month of Premium Ultra HD 5€ · .* · \+\d+ more$/);
  assert.ok(options.length <= 150);

  const none = await set('none');
  assert.match(textOf(lastResponse(none)), /\*\*Netflix\*\* has no options any more – it is sold for one price again: \*\*20€\*\*/);
  assert.deepEqual(netflix.variants, []);
  assert.match(shop.cardText(guild, netflix), /Netflix\u2002{2}\*\*20€\*\*\n\nPremium account, 4K\.\n\n-# 🟢 In stock$/);

  // Errors are shown to the seller, nothing changes.
  const wrong = await set('1 month: 5');
  assert.match(textOf(lastResponse(wrong)), /name = price/);
  assert.deepEqual(netflix.variants, []);
  const notSeller = await product(guild, member(guild), 'variants', { product: netflix.id, variants: '1 month = 1' });
  assert.match(textOf(lastResponse(notSeller)), /Only administrators and sellers/);
});

test('old products without the new fields work exactly as before', async () => {
  const { guild, netflix } = await shopGuild();
  for (const key of ['variants', 'stockCount', 'sale']) delete netflix[key];
  assert.equal(shop.cardText(guild, netflix), '### 🎬 Netflix\u2002\u2002**20€**\n\nPremium account, 4K.\n\n-# 🟢 In stock');
  const modal = validateModal(shop.orderModal(netflix, guild), guild);
  assert.equal(modal.components[0].type, 10, 'the intro text');
  assert.match(modal.components[0].content, /\*\*Netflix\*\* — 20€/);
  const { ticket } = await order(guild, member(guild), netflix, { quantity: '2' });
  assert.equal(ticket.order.product, 'Netflix');
  assert.equal(ticket.order.unitPrice, 20);
  assert.equal('variant' in ticket.order, false);
  assert.equal('salePercent' in ticket.order, false);
  assert.equal(answer(ticket, 'Product'), 'Netflix — 20€');
});

// ───────────── Order form ─────────────

test('order form: at most 5 components with and without options, payment methods and promo codes', async () => {
  const { guild, netflix } = await shopGuild();
  const methods = config.shop.paymentMethods;
  const promosOn = config.promos.enabled;
  const plain = { ...netflix, variants: [] };
  const withOptions = { ...netflix, variants: shop.parseVariants('1 month = 5, 3 months = 12, 12 months = 40') };
  const longest = {
    ...netflix,
    name: 'N'.repeat(80),
    description: 'd'.repeat(400),
    variants: shop.parseVariants(Array.from({ length: 10 }, (_, i) => `${String(i).padEnd(50, 'V')} = ${'9'.repeat(40)}`).join(', ')),
    sale: { percent: 20, endsAt: Date.now() + 3_600_000 },
  };
  try {
    for (const payment of [methods, []]) {
      for (const promos of [true, false]) {
        config.shop.paymentMethods = payment;
        config.promos.enabled = promos;
        for (const p of [plain, withOptions, longest]) {
          const modal = validateModal(shop.orderModal(p, guild), guild);
          const label = `${p.variants.length} options, ${payment.length} methods, promos ${promos}`;
          assert.ok(modal.components.length <= 5, label);
          assert.equal(modal.components.length, promos ? 5 : 4, label);
          const ids = modal.components.map((c) => c.component?.custom_id ?? 'intro');
          assert.deepEqual(ids.slice(0, 2), p.variants.length ? ['variant', 'quantity'] : ['intro', 'quantity'], label);
          assert.equal(ids.includes('promo'), promos, label);
          assert.ok(ids.includes(payment.length ? 'payment' : 'payment_text'), label);
        }
      }
    }
  } finally {
    config.shop.paymentMethods = methods;
    config.promos.enabled = promosOn;
  }

  // The Option menu: required, every option with its price, the description of the product above it.
  const modal = validateModal(shop.orderModal(withOptions, guild), guild);
  const option = modal.components[0];
  assert.equal(option.label, 'Option');
  assert.equal(option.description, 'Premium account, 4K.');
  assert.equal(option.component.required, true);
  assert.deepEqual(option.component.options.map((o) => [o.label, o.value, o.description]), withOptions.variants.map((v) => [v.name, v.id, `${v.price}€`]));
  assert.equal(option.component.options.length, 3);
});

test('order with an option: its price, "Name — Option" in the ticket, the sale and the receipt', async () => {
  const { guild, netflix, seller } = await shopGuild();
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12.50, 12 months = 40');
  const buyer = member(guild);

  const buy = await run({ guild, member: buyer, kind: 'button', customId: `shop:buy:${netflix.id}` });
  assert.deepEqual(buy.state.modals[0].components[0].component.options.map((o) => o.label), ['1 month', '3 months', '12 months']);

  const { i, ticket, channel } = await order(guild, buyer, netflix, { quantity: '2', variant: variantId(netflix, '3 months') });
  assert.deepEqual(ticket.order, {
    productId: netflix.id,
    product: 'Netflix — 3 months',
    variant: '3 months',
    unitPrice: 12.5,
    quantity: 2,
    method: 'PaysafeCard',
    methodIndex: 0,
    promo: null,
    discount: 0,
    subtotal: 25,
    total: 25,
  });
  assert.equal(answer(ticket, 'Product'), 'Netflix — 3 months — 12.50€');
  assert.equal(answer(ticket, 'Price'), '**Total to pay: 25€** (2 × 12.50€)');
  const reply = lastResponse(i);
  assert.match(textOf(reply), /Order started – Netflix — 3 months/);
  assert.match(textOf(reply), /Total to pay: \*\*25€\*\*/);
  assert.equal(shop.ticketProduct(guild.id, ticket)?.id, netflix.id, 'the ticket card still finds the product');

  const { sale } = await t.completeOrder(channel, seller);
  assert.equal(sale.product, 'Netflix — 3 months');
  assert.equal(sale.variant, '3 months');
  assert.equal(sale.productId, netflix.id);
  assert.equal(sale.amount, 25);
  const receipt = guild.dms.filter((d) => d.to === buyer.id && /Thank you for your order/.test(textOf(d.payload))).at(-1);
  assert.match(textOf(receipt.payload), /Netflix — 3 months\*?\*? × 2/);
});

test('an option that no longer exists (catalog changed while the form was open) → open the form again', async () => {
  const { guild, netflix } = await shopGuild();
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12');
  const threeMonths = variantId(netflix, '3 months');
  const buyer = member(guild);
  const tickets = () => db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).length;

  // Removed while the form was open.
  shop.setVariants(guild, netflix.id, '1 month = 5, 6 months = 22');
  const removed = await order(guild, buyer, netflix, { variant: threeMonths });
  assert.match(textOf(lastResponse(removed.i)), /The options of \*\*Netflix\*\* have changed since you opened the form – click \*\*Buy\*\* again/);
  assert.equal(tickets(), 0);

  // All options removed – the old pick doesn't match the single price either.
  shop.setVariants(guild, netflix.id, 'none');
  const none = await order(guild, buyer, netflix, { variant: threeMonths });
  assert.match(textOf(lastResponse(none.i)), /have changed since you opened the form/);
  // Options added while a form without the menu was open.
  shop.setVariants(guild, netflix.id, '1 month = 5');
  const added = await order(guild, buyer, netflix, {});
  assert.match(textOf(lastResponse(added.i)), /have changed since you opened the form/);
  assert.equal(tickets(), 0);

  // An option entered again with the same name keeps its ID – the open form still works.
  const oneMonth = variantId(netflix, '1 month');
  shop.setVariants(guild, netflix.id, '1 month = 6, 2 months = 11');
  const ok = await order(guild, buyer, netflix, { variant: oneMonth });
  assert.equal(ok.ticket.order.product, 'Netflix — 1 month');
  assert.equal(ok.ticket.order.unitPrice, 6, 'the current price of the option');
  validateMessage(ok.channel.messageList[0].body, guild);
  assert.ok(customIds(ok.channel.messageList[0].body).includes('ticket:close'));
});
