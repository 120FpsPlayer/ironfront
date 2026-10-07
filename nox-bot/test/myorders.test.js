'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, MessageFlagsBitField } = require('discord.js');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const panels = require('../src/lib/panels');
const shop = require('../src/features/shop');
const myorders = require('../src/features/myorders');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 980000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const privateCopy = { flags: new MessageFlagsBitField(MessageFlags.Ephemeral) };
const toJSON = (c) => (c?.toJSON ? c.toJSON() : c);

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

/** Every action row of a Components V2 payload (inside its containers). */
function actionRows(payload) {
  const rows = [];
  const walk = (c) => {
    const d = toJSON(c);
    if (!d) return;
    if (d.type === 1) rows.push(d);
    else for (const x of d.components ?? []) walk(x);
  };
  for (const c of payload?.components ?? []) walk(c);
  return rows;
}

/** The row with the My orders button. */
const navRow = (payload) => actionRows(payload).find((r) => r.components.some((b) => b.custom_id === 'myorders:open'));
const navLabels = (payload) => navRow(payload)?.components.map((b) => b.label) ?? [];

/** Options of the first select menu in a payload. */
const selectOptions = (payload) => actionRows(payload).flatMap((r) => r.components).find((c) => c.type === 3)?.options ?? [];

/** Every link button URL in a payload. */
function linkUrls(payload) {
  const urls = [];
  const walk = (c) => {
    const d = toJSON(c);
    if (!d) return;
    if (d.type === 2 && d.url) urls.push(d.url);
    for (const x of d.components ?? []) walk(x);
    if (d.accessory) walk(d.accessory);
  };
  for (const c of payload?.components ?? []) walk(c);
  return urls;
}

/** Buy → order form → order ticket. */
async function order(guild, buyer, product, quantity = '1') {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity }, selects: { payment: ['0'] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { ticket, channel: guild.channels.cache.get(ticket.channelId) };
}

const openMyOrders = (guild, who, message = null) => run({ guild, member: who, kind: 'button', customId: 'myorders:open', message });
const pickReceipt = (guild, who, saleId) => run({ guild, member: who, kind: 'select', customId: 'myorders:receipt', values: [saleId], message: privateCopy });

// ───────────── The button in the shop ─────────────

test('My orders is in the shop row: How to buy · Vouches · My orders on one page, ◀ Page ▶ · My orders with pages – on the panel and every private page', async () => {
  const guild = await builtGuild();
  const buyer = member(guild);
  for (let i = 1; i <= 3; i += 1) shop.addProduct(guild, { name: `Product ${i}`, price: '10', description: 'Instant delivery.' });
  const one = shop.shopPanel(guild);
  validateMessage(one, guild);
  assert.deepEqual(navLabels(one), ['How to buy', 'Vouches', 'My orders']);

  for (let i = 4; i <= 12; i += 1) shop.addProduct(guild, { name: `Product ${i}`, price: '10', description: 'Instant delivery.', category: i % 2 ? 'Games' : 'Keys' });
  await panels.refresh(guild, 'shop');
  const panelInfo = db.panels(guild.id, 'shop')[0];
  const message = guild.channels.cache.get(panelInfo.channelId).messageList.find((m) => m.id === panelInfo.messageId);
  const panel = message.body;
  validateMessage(panel, guild);
  assert.deepEqual(navLabels(panel), ['Previous', 'Page 1 / 3', 'Next', 'My orders']);

  // Private copies: a page turned from the panel, a page inside the copy, a tab.
  const copies = [
    lastResponse(await run({ guild, member: buyer, kind: 'button', customId: 'shopview:page:1:all', message })),
    lastResponse(await run({ guild, member: buyer, kind: 'button', customId: 'shopview:page:2:all', message: privateCopy })),
    lastResponse(await run({ guild, member: buyer, kind: 'button', customId: 'shopview:tab:c:keys', message: privateCopy })),
  ];
  for (const copy of copies) {
    validateMessage(copy, guild);
    assert.ok(customIds(copy).includes('myorders:open'));
  }
  assert.deepEqual(navLabels(copies[1]), ['Previous', 'Page 3 / 3', 'Next', 'My orders']);
  for (const payload of [one, panel, ...copies]) {
    for (const r of actionRows(payload)) assert.ok(r.components.length <= 5, 'at most 5 buttons in a row');
  }

  // Without the How to buy / Vouches channels the row is just My orders.
  db.build(guild.id).channels.howToBuy = null;
  db.build(guild.id).channels.vouches = null;
  assert.deepEqual(navLabels(shop.shopView(guild, { tab: 'c:keys', page: 1 })), ['My orders']);
});

test('the shop still fits 40 components with 5 tabs, pages and 5 products with images (an image is dropped if needed)', async () => {
  const guild = await builtGuild();
  const png = () => {
    const buf = Buffer.alloc(2048, 7);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
    return buf;
  };
  for (const category of ['Games', 'Keys', 'Software', 'Streaming']) {
    for (let i = 1; i <= 3; i += 1) shop.addProduct(guild, { name: `${category} ${i}`, price: '5', description: 'Instant delivery.', category, image: { buffer: png(), ext: 'png' } });
  }
  const pages = [shop.shopPanel(guild), shop.shopView(guild, { page: 1 }), shop.shopView(guild, { page: 2 }), shop.shopView(guild, { tab: 'c:games' })];
  for (const payload of pages) {
    const { total } = validateMessage(payload, guild);
    assert.ok(total <= 40, `${total} components`);
    assert.ok(customIds(payload).includes('myorders:open'));
    assert.ok(navRow(payload).components.length <= 5);
  }
  assert.equal(actionRows(pages[0]).find((r) => r.components.some((b) => b.custom_id?.startsWith('shopview:tab:'))).components.length, 5, '5 tabs');
  assert.ok(pages[0].files.length >= 4, `${pages[0].files.length} of 5 images on a full page`);
});

// ───────────── The view ─────────────

test('My orders: open orders with status, total and ticket link; completed orders newest first – only your own', async () => {
  const guild = await builtGuild();
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);
  const other = member(guild);
  const nitro = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.' });
  const spotify = shop.addProduct(guild, { name: 'Spotify Premium', price: '4.50', description: 'One month.' });

  // A completed order (its ticket is still open), then a new open order that was paid.
  const first = await order(guild, buyer, spotify, '2');
  await t.completeOrder(first.channel, seller, { amount: 9 });
  const second = await order(guild, buyer, nitro, '3');
  second.ticket.order.status = 'paid';
  // An order from the old Purchase ticket form: no ticket.order, only the answers – and no status yet.
  const legacy = db.createTicket({
    channelId: uid(),
    guildId: guild.id,
    number: 77,
    typeId: 'order',
    ownerId: buyer.id,
    status: 'open',
    answers: [
      { label: 'Product', value: 'Netflix 4K' },
      { label: 'Quantity', value: '4' },
    ],
    createdAt: Date.now() - 86_400_000,
    completedAt: null,
  });
  // Someone else's orders never show up.
  const theirs = await order(guild, other, nitro);
  await t.completeOrder(theirs.channel, seller, { amount: 10 });

  const click = await openMyOrders(guild, buyer);
  assert.equal(click.deferred, true, 'deferred first');
  const view = lastResponse(click);
  validateMessage(view, guild);
  assert.equal(view.flags & MessageFlags.IsComponentsV2, MessageFlags.IsComponentsV2);
  const body = textOf(view);
  assert.match(body, /2 open · 1 completed/);
  assert.match(body, new RegExp(`Order #${String(second.ticket.number).padStart(4, '0')}\\*\\* · Nitro Boost × 3 · \\*\\*30€\\*\\*\\n💳 Paid · placed <t:\\d+:R>`));
  assert.match(body, /Order #0077\*\* · Netflix 4K × 4\n⏳ Awaiting payment/, 'old ticket: product from the answers, no total');
  assert.ok(body.indexOf('Nitro Boost × 3') < body.indexOf('Netflix 4K'), 'newest open order first');
  const sale = db.sales(guild.id).find((s) => s.userId === buyer.id);
  assert.match(body, new RegExp(`\`${sale.id}\` · Spotify Premium × 2 · \\*\\*9€\\*\\* · <t:\\d+:d> · ✅ Delivered · <#${first.channel.id}>`));
  assert.doesNotMatch(body, new RegExp(`Order #${String(first.ticket.number).padStart(4, '0')}`), 'a delivered order is listed once, with the completed ones');
  assert.ok(!body.includes(db.sales(guild.id).find((s) => s.userId === other.id).id), "not someone else's sale");
  const urls = linkUrls(view);
  assert.ok(urls.includes(`https://discord.com/channels/${guild.id}/${second.channel.id}`), 'Go to ticket link');
  assert.ok(urls.includes(`https://discord.com/channels/${guild.id}/${legacy.channelId}`));
  assert.ok(!urls.includes(`https://discord.com/channels/${guild.id}/${theirs.channel.id}`));
  assert.deepEqual(selectOptions(view).map((o) => o.value), [sale.id]);

  // Every status of lib/orderStatus.js an open order can have.
  for (const [status, label] of [['sent', '📨 Payment sent – being checked'], ['progress', '🔧 In progress'], ['bogus', '⏳ Awaiting payment']]) {
    second.ticket.order.status = status;
    assert.ok(textOf(myorders.ordersView(guild, buyer.id)).includes(label), status);
  }

  // A private shop page opens My orders as a new private message too.
  const fromCopy = await openMyOrders(guild, buyer, privateCopy);
  assert.equal(fromCopy.state.edits.length, 1);
  assert.match(textOf(lastResponse(fromCopy)), /My orders/);
});

test('View a receipt: shows your receipt in place with a way back – someone else\'s sale ID is refused', async () => {
  const guild = await builtGuild();
  const seller = member(guild, ['member', 'seller']);
  const [buyer, other] = [member(guild), member(guild)];
  const nitro = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.' });
  const mine = await order(guild, buyer, nitro, '2');
  await t.completeOrder(mine.channel, seller, { amount: 18 });
  const theirs = await order(guild, other, nitro);
  await t.completeOrder(theirs.channel, seller, { amount: 10 });
  const [mySale, theirSale] = [buyer, other].map((u) => db.sales(guild.id).find((s) => s.userId === u.id));

  const pick = await pickReceipt(guild, buyer, mySale.id);
  assert.equal(pick.deferred, true);
  assert.equal(pick.state.replies.length, 0, 'replaces the list in place');
  const receipt = lastResponse(pick);
  validateMessage(receipt, guild);
  const body = textOf(receipt);
  assert.match(body, /Thank you for your order!/);
  assert.match(body, new RegExp(`\\*\\*Receipt:\\*\\* \`${mySale.id}\``));
  assert.match(body, /Nitro Boost × 2/);
  assert.match(body, /\*\*Total paid:\*\* \*\*18€\*\*/);
  assert.match(body, new RegExp(`\\*\\*Seller:\\*\\* ${seller.displayName}`));
  assert.ok(customIds(receipt).includes('myorders:back'));

  const back = await run({ guild, member: buyer, kind: 'button', customId: 'myorders:back', message: privateCopy });
  assert.match(textOf(lastResponse(back)), /My orders[\s\S]*Completed orders/);

  // Forged menu values: someone else's sale, or one that doesn't exist.
  for (const forged of [theirSale.id, 'S-9999']) {
    const refused = await pickReceipt(guild, buyer, forged);
    const out = textOf(lastResponse(refused));
    assert.match(out, /isn't one of your orders/);
    assert.doesNotMatch(out, /Thank you for your order/);
    assert.equal(refused.deferred, false, 'refused before anything is shown');
  }
});

test('My orders: friendly empty state that points to Buy in the shop', async () => {
  const guild = await builtGuild();
  const newbie = member(guild);
  const view = lastResponse(await openMyOrders(guild, newbie));
  validateMessage(view, guild);
  assert.match(textOf(view), /haven't ordered anything yet[\s\S]*click \*\*Buy\*\* next to the product/);
  assert.ok(linkUrls(view).includes(`https://discord.com/channels/${guild.id}/${db.channelId(guild.id, 'shop')}`));
  assert.deepEqual(selectOptions(view), []);
});

test('My orders with many long orders: 10 completed + "older", 5 open + links – within 40 components and 4000 characters', async () => {
  const guild = new FakeGuild({ premiumTier: 3 }); // custom emojis → the longest text
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const buyer = member(guild);
  const long = 'P'.repeat(150);
  for (let i = 1; i <= 40; i += 1) {
    db.addSale(guild.id, {
      id: `S-${String(i).padStart(4, '0')}`,
      ticketNumber: i,
      channelId: uid(),
      userId: buyer.id,
      sellerId: null,
      productId: null,
      product: `${long} ${i}`,
      quantity: 999,
      amount: i % 3 ? 1_299_999.99 : null, // some sales from before the amount was recorded
      currency: '€',
      createdAt: Date.now() - i * 86_400_000,
      completedAt: Date.now() - i * 3_600_000,
    });
  }
  for (let i = 1; i <= 8; i += 1) {
    db.createTicket({
      channelId: uid(),
      guildId: guild.id,
      number: 9000 + i,
      typeId: 'order',
      ownerId: buyer.id,
      status: 'open',
      answers: [],
      order: { productId: null, product: `${long} open ${i}`, quantity: 999, total: 1_299_999.99, status: 'sent' },
      createdAt: Date.now() - i * 60_000,
      completedAt: null,
    });
  }
  const view = myorders.ordersView(guild, buyer.id);
  const { total, textLength } = validateMessage(view, guild);
  assert.ok(total <= 40 && textLength <= 4000, `${total} components, ${textLength} characters`);
  const body = textOf(view);
  assert.match(body, /8 open · 40 completed/);
  assert.match(body, /\+3 more: (<#\d+> ?){3}/);
  assert.match(body, /\+30 older orders/);
  assert.equal((body.match(/✅ Delivered/g) ?? []).length, 10);
  assert.ok(body.indexOf('`S-0001`') < body.indexOf('`S-0002`'), 'newest first');
  const options = selectOptions(view);
  assert.equal(options.length, myorders.SHOWN_SALES);
  assert.equal(options[0].value, 'S-0001');
  for (const o of options) assert.ok(o.label.length <= 100 && (o.description ?? '').length <= 100);

  // A receipt of an old sale without its ticket (deleted) and without an amount still works.
  const pick = await pickReceipt(guild, buyer, 'S-0003');
  validateMessage(lastResponse(pick), guild);
  assert.match(textOf(lastResponse(pick)), /as agreed in your ticket/);
});
