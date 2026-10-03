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
const promos = require('../src/features/promos');
const shop = require('../src/features/shop');
const orders = require('../src/features/orders');
const t = require('../src/tickets/tickets');
const ui = require('../src/tickets/ui');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0; // tests open several orders per member right after each other

let n = 940000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const HOUR = 3_600_000;

/** An interaction from a DM: no guild, no member – like Discord sends it. */
async function runDm(guild, user, args) {
  const i = createInteraction({ guild, member: user, ...args });
  Object.assign(i, { guild: null, guildId: null, member: null, channel: null, channelId: null, inGuild: () => false });
  await handle(i, commands);
  return i;
}

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.', emoji: '💎' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

/** Buy → order form → ticket. Returns the interaction, the ticket and its channel. */
async function order(guild, buyer, product, { quantity = '1', promo, payment = '0', notes } = {}) {
  const fields = { quantity };
  if (promo !== undefined) fields.promo = promo;
  if (notes) fields.notes = notes;
  const i = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields, selects: { payment: [payment] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { i, ticket, channel: ticket && guild.channels.cache.get(ticket.channelId) };
}

const answer = (ticket, label) => ticket.answers.find((a) => a.label === label)?.value;

// ───────────── Order form ─────────────

test('order form: optional promo code field (5 components), quantity must be a whole number 1–999', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  const buy = await run({ guild, member: buyer, kind: 'button', customId: `shop:buy:${product.id}` });
  const modal = buy.state.modals[0];
  assert.equal(modal.components.length, 5);
  const promoField = modal.components.at(-1);
  assert.equal(promoField.label, 'Promo code');
  assert.equal(promoField.component.custom_id, 'promo');
  assert.equal(promoField.component.required, false);

  for (const quantity of ['abc', '0', '1000', '2.5', '-1', '1e2']) {
    const bad = await order(guild, buyer, product, { quantity });
    assert.match(textOf(lastResponse(bad.i)), /whole number from \*\*1\*\* to \*\*999\*\*/, quantity);
    assert.equal(bad.ticket, undefined, `no ticket for quantity ${quantity}`);
  }
  const ok = await order(guild, buyer, product, { quantity: ' 999 ' });
  assert.equal(ok.ticket.order.quantity, 999);
});

test('order with a valid promo code: subtotal, discount and total in the ticket, stored on the ticket', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  promos.create(guild.id, { code: 'NOX10', percent: 10 });
  const { i, ticket, channel } = await order(guild, buyer, product, { quantity: '3', promo: ' nox10 ', notes: 'Fast please' });

  assert.match(textOf(lastResponse(i)), /Total to pay: \*\*27€\*\* \(you save 3€ with \*\*NOX10\*\*\)/);
  assert.deepEqual(ticket.answers.map((a) => a.label), ['Product', 'Quantity', 'Payment method', 'Notes', 'Price']);
  assert.equal(answer(ticket, 'Price'), 'Subtotal: 30€ (3 × 10€)\nDiscount (NOX10 · 10% off): −3€\n**Total to pay: 27€**');
  assert.deepEqual(ticket.order, {
    productId: product.id,
    product: 'Nitro Boost',
    unitPrice: 10,
    quantity: 3,
    method: 'PaysafeCard',
    methodIndex: 0,
    promo: 'NOX10',
    discount: 3,
    subtotal: 30,
    total: 27,
  });
  const card = textOf(channel.messageList[0].body);
  assert.match(card, /Total to pay: 27€/);
  assert.equal(promos.find(guild.id, 'NOX10').uses.length, 0, 'not redeemed before the order is completed');

  // Fixed amount codes and no code at all
  promos.create(guild.id, { code: 'FIVE', amount: 5 });
  const fixed = await order(guild, member(guild), product, { quantity: '2', promo: 'FIVE' });
  assert.equal(fixed.ticket.order.total, 15);
  const plain = await order(guild, member(guild), product, { quantity: '2' });
  assert.equal(answer(plain.ticket, 'Price'), '**Total to pay: 20€** (2 × 10€)');
  assert.equal(plain.ticket.order.promo, null);
});

test('invalid, expired, foreign and first-order-only codes never block the order', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const other = member(guild);
  promos.create(guild.id, { code: 'OLD', percent: 50, expiresAt: Date.now() - 1000 });
  const personal = promos.personal(guild.id, other.id, { percent: 20, days: 7, prefix: 'WELCOME', firstOrderOnly: true });

  const cases = [
    ['NOPE', "This code doesn't exist."],
    ['OLD', 'This code has expired.'],
    [personal.code, 'This code belongs to someone else.'],
  ];
  for (const [code, reason] of cases) {
    const { i, ticket } = await order(guild, buyer, product, { promo: code });
    assert.ok(ticket, `ticket opened with ${code}`);
    assert.match(answer(ticket, 'Price'), new RegExp(`Promo code ${code} – not applied: ${reason.replace('.', '\\.')}`));
    assert.match(answer(ticket, 'Price'), /\*\*Total to pay: 10€\*\*/);
    assert.equal(ticket.order.promo, null);
    assert.equal(ticket.order.total, 10);
    assert.match(textOf(lastResponse(i)), new RegExp(`Promo code \\*\\*${code}\\*\\* – not applied`));
    await t.closeTicket(guild.channels.cache.get(ticket.channelId), seller);
  }

  // The owner can use their personal code – but only for their first order.
  const own = await order(guild, other, product, { promo: personal.code.toLowerCase() });
  assert.equal(own.ticket.order.promo, personal.code);
  assert.equal(own.ticket.order.total, 8);
  db.guild(guild.id).orders[other.id] = 1;
  await t.closeTicket(own.channel, seller);
  const again = await order(guild, other, product, { promo: personal.code });
  assert.match(answer(again.ticket, 'Price'), /not applied: This code is only valid for your first order\./);
});

test('codes in open orders are reserved: once-per-member and max uses count open orders too', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  promos.create(guild.id, { code: 'ONCE', percent: 10 });
  promos.create(guild.id, { code: 'SINGLE', percent: 10, maxUses: 1, oncePerUser: false });
  const first = await order(guild, buyer, product, { promo: 'ONCE' });
  assert.equal(first.ticket.order.promo, 'ONCE');
  const second = await order(guild, buyer, product, { promo: 'ONCE' });
  assert.match(answer(second.ticket, 'Price'), /not applied: You're already using this code in another open order\./);

  const a = await order(guild, member(guild), product, { promo: 'SINGLE' });
  assert.equal(a.ticket.order.promo, 'SINGLE');
  const b = await order(guild, member(guild), product, { promo: 'SINGLE' });
  assert.match(answer(b.ticket, 'Price'), /not applied: This code has been used up\./);
});

test('prices that are not a number: no totals, a valid code is passed on to the seller', async () => {
  const { guild } = await shopGuild();
  const product = shop.addProduct(guild, { name: 'Custom Logo', price: 'from 5€', description: 'Made for you.' });
  promos.create(guild.id, { code: 'ART', percent: 15 });
  const { i, ticket } = await order(guild, member(guild), product, { quantity: '2', promo: 'ART' });
  assert.equal(answer(ticket, 'Promo code'), 'ART – 15% off, the seller applies it to the final price');
  assert.equal(answer(ticket, 'Price'), undefined);
  assert.equal(ticket.order.total, null);
  assert.equal(ticket.order.unitPrice, null);
  assert.equal(ticket.order.promo, 'ART');
  assert.match(textOf(lastResponse(i)), /Promo code \*\*ART\*\* \(15% off\) – the seller applies it/);
});

// ───────────── Completing an order ─────────────

test('completing from the ⚙️ menu: amount form → sale recorded, promo redeemed once, hook after the reply', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  promos.create(guild.id, { code: 'NOX10', percent: 10 });
  const { ticket, channel } = await order(guild, buyer, product, { quantity: '3', promo: 'NOX10' });

  // Members can't use the staff menu or the form
  const notStaff = await run({ guild, member: buyer, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel });
  assert.match(textOf(lastResponse(notStaff)), /only available to staff/);
  const forged = await run({ guild, member: buyer, kind: 'modal', customId: 'order:complete', fields: { amount: '1' }, channel });
  assert.match(textOf(lastResponse(forged)), /Only staff members can complete orders/);

  const pick = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel });
  const form = pick.state.modals[0];
  assert.equal(form.custom_id, 'order:complete');
  assert.equal(form.title, `✅ Complete order #${String(ticket.number).padStart(4, '0')}`);
  const amountField = form.components.find((c) => c.component?.custom_id === 'amount');
  assert.equal(amountField.component.value, '27', 'prefilled with the order total');
  assert.equal(amountField.component.required, false);
  assert.match(form.components[0].content, /Nitro Boost\*\* × 3 · PaysafeCard · code \*\*NOX10\*\*/);

  const garbage = await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: 'twenty' }, channel });
  assert.match(textOf(lastResponse(garbage)), /is not an amount/);
  assert.equal(db.getTicket(channel.id).completedAt, null);

  let replied = null;
  let hookSawReply = null;
  hooks.on('orderCompleted', ({ sale }) => {
    if (sale.channelId === channel.id) hookSawReply = replied?.state.edits.length > 0;
  });
  replied = createInteraction({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '25,50' }, channel });
  await handle(replied, commands);
  assert.match(textOf(lastResponse(replied)), /Order completed – sale `S-0001` recorded – 25\.50€ paid \(code NOX10\)/);
  assert.equal(hookSawReply, true, 'orderCompleted runs after the staff member got an answer');

  const sale = db.sales(guild.id)[0];
  assert.deepEqual({ ...sale, createdAt: 0, completedAt: 0 }, {
    id: 'S-0001',
    ticketNumber: ticket.number,
    channelId: channel.id,
    userId: buyer.id,
    sellerId: seller.id,
    productId: product.id,
    product: 'Nitro Boost',
    quantity: 3,
    amount: 25.5,
    currency: '€',
    method: 'PaysafeCard',
    promo: 'NOX10',
    discount: 3,
    createdAt: 0,
    completedAt: 0,
  });
  assert.equal(sale.createdAt, ticket.createdAt);
  assert.equal(db.getTicket(channel.id).saleId, 'S-0001');
  const uses = promos.find(guild.id, 'NOX10').uses;
  assert.equal(uses.length, 1);
  assert.deepEqual([uses[0].userId, uses[0].saleId], [buyer.id, 'S-0001']);
  assert.ok(buyer.roles.cache.has(role(guild, 'customer')));
  assert.match(textOf(channel.messageList.at(-1).body), /Receipt `S-0001` · Paid 25\.50€/);
  const log = guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1);
  assert.match(textOf(log.body), /Amount paid 25\.50€/);

  // Only once
  const twice = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel });
  assert.match(textOf(lastResponse(twice)), /already marked as completed/);
  await assert.rejects(() => t.completeOrder(channel, seller), /already marked/);
  assert.equal(promos.find(guild.id, 'NOX10').uses.length, 1, 'redeemed once');
  assert.equal(db.sales(guild.id).length, 1);
});

test('/ticket complete: optional amount (default: the order total), empty form amount = unknown', async () => {
  const { guild, product, seller } = await shopGuild();
  const a = await order(guild, member(guild), product, { quantity: '2' });
  const cmd = await run({ guild, member: seller, kind: 'command', commandName: 'ticket', subcommand: 'complete', channel: a.channel });
  assert.match(textOf(lastResponse(cmd)), /sale `S-0001` recorded – 20€ paid/);
  assert.equal(db.sales(guild.id)[0].amount, 20);

  const b = await order(guild, member(guild), product);
  await run({ guild, member: seller, kind: 'command', commandName: 'ticket', subcommand: 'complete', channel: b.channel, options: { amount: 7.5 } });
  assert.equal(db.sales(guild.id)[1].amount, 7.5);

  const c = await order(guild, member(guild), product);
  const empty = await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '' }, channel: c.channel });
  assert.match(textOf(lastResponse(empty)), /sale `S-0003` recorded\./);
  assert.equal(db.sales(guild.id)[2].amount, null);

  // A Purchase ticket from the ticket panel (no shop form): product, quantity and method come from its answers
  const buyer = member(guild);
  const type = config.getType('order');
  const answers = type.questions.map((q) => ({ label: q.label, value: { product: 'Spotify Premium', quantity: '2', payment: 'PayPal', notes: '' }[q.id] }));
  const channel = await t.openTicket(buyer, type, answers);
  const pick = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel });
  assert.match(pick.state.modals[0].components[0].content, /Custom order/);
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '12' }, channel });
  const sale = db.sales(guild.id)[3];
  assert.deepEqual([sale.product, sale.quantity, sale.method, sale.amount, sale.productId], ['Spotify Premium', 2, 'PayPal', 12, null]);
});

// ───────────── Receipt, proof, vouch reminder ─────────────

test('receipt by DM: order details, total paid, seller, server and a vouch button (DM failures are ignored)', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  promos.create(guild.id, { code: 'NOX10', percent: 10 });
  const { ticket, channel } = await order(guild, buyer, product, { quantity: '3', promo: 'NOX10' });
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '27' }, channel });

  const receipt = guild.dms.filter((d) => d.to === buyer.id).at(-1).payload;
  validateMessage(receipt, guild);
  const out = textOf(receipt);
  for (const part of [
    `Order:** \`#${String(ticket.number).padStart(4, '0')}\``,
    'Receipt:** `S-0001`',
    'Nitro Boost × 3',
    'Unit price:** 10€',
    'Discount:** −3€ (code `NOX10`)',
    'Total paid:** **27€**',
    'Payment method:** PaysafeCard',
    `Seller:** ${seller.displayName}`,
    `Server:** ${guild.name}`,
  ]) {
    assert.ok(out.includes(part), `receipt shows ${part}`);
  }
  assert.match(out, /Date:\*\* <t:\d+:f>/);
  assert.ok(customIds(receipt).includes(`order:vouch:${guild.id}:${channel.id}`));

  // Closed DMs: the order is still completed, nothing breaks
  const shy = member(guild);
  guild.closedDms.add(shy.id);
  const o2 = await order(guild, shy, product);
  const done = await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel: o2.channel });
  assert.match(textOf(lastResponse(done)), /Order completed/);
  assert.equal(guild.dms.filter((d) => d.to === shy.id).length, 0);

  // Receipts turned off
  config.orders.receipts = false;
  try {
    const quiet = member(guild);
    const o3 = await order(guild, quiet, product);
    const before = guild.dms.filter((d) => d.to === quiet.id).length;
    await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel: o3.channel });
    assert.equal(guild.dms.filter((d) => d.to === quiet.id).length, before);
  } finally {
    config.orders.receipts = true;
  }
});

test('proof in #proofs: anonymous – product, quantity, method and delivery time, no user data or price', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { ticket, channel } = await order(guild, buyer, product, { quantity: '2', payment: '2' });
  db.updateTicket(channel.id, { createdAt: Date.now() - 12 * 60_000 });
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '20' }, channel });

  const proofs = ch(guild, 'proofs');
  const proof = proofs.messageList.at(-1).body;
  validateMessage(proof, guild);
  const out = textOf(proof);
  assert.match(out, new RegExp(`Order #${String(ticket.number).padStart(4, '0')} delivered`));
  assert.match(out, /💎 \*\*Nitro Boost\*\* × 2/);
  assert.match(out, /Paid with \*\*PayPal\*\*/);
  assert.match(out, /Delivered in \*\*12m\*\*/);
  assert.match(out, /<t:\d+:R>/);
  const json = JSON.stringify(proof);
  for (const secret of [buyer.id, seller.id, buyer.user.username, seller.displayName, '<@', 'avatars', '20€', '€']) {
    assert.ok(!json.includes(secret), `proof must not contain ${secret}`);
  }
  assert.ok(!proof.components[0].components.some((c) => c.toJSON?.().accessory?.type === 11), 'no thumbnails');

  // Purchase-ticket answers are free text – only catalog products and configured methods are shown
  const other = member(guild);
  const type = config.getType('order');
  const answers = type.questions.map((q) => ({ label: q.label, value: { product: 'a gift for john smith', quantity: '1', payment: 'PayPal john@example.com', notes: '' }[q.id] }));
  const c2 = await t.openTicket(other, type, answers);
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '5' }, channel: c2 });
  const anon = textOf(proofs.messageList.at(-1).body);
  assert.match(anon, /\*\*Custom order\*\* × 1/);
  assert.match(anon, /Paid with \*\*PayPal\*\*/);
  assert.ok(!anon.includes('john'), 'no personal details from the form');

  config.orders.proofs = false;
  try {
    const count = proofs.messageList.length;
    const o = await order(guild, member(guild), product);
    await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel: o.channel });
    assert.equal(proofs.messageList.length, count);
  } finally {
    config.orders.proofs = true;
  }
});

test('vouch reminder: one DM after the configured hours, skipped when the customer already vouched', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel });
  const reminder = db.guild(guild.id).reminders[channel.id];
  const completedAt = db.getTicket(channel.id).completedAt;
  assert.equal(reminder.userId, buyer.id);
  assert.equal(reminder.dueAt, completedAt + config.orders.vouchReminderHours * HOUR);
  assert.equal(reminder.sent, false);

  const dms = () => guild.dms.filter((d) => d.to === buyer.id && /How was your order/.test(textOf(d.payload)));
  await orders.runReminders(guild.client, reminder.dueAt - 60_000);
  assert.equal(dms().length, 0, 'not due yet');
  await orders.runReminders(guild.client, reminder.dueAt + 1);
  assert.equal(dms().length, 1);
  const card = dms()[0].payload;
  validateMessage(card, guild);
  assert.match(textOf(card), /Nitro Boost/);
  assert.ok(customIds(card).includes(`order:vouch:${guild.id}:${channel.id}`));
  assert.equal(reminder.sent, true);
  await orders.runReminders(guild.client, reminder.dueAt + 20 * 60_000);
  assert.equal(dms().length, 1, 'sent only once');

  // Already vouched after the order → no reminder
  const happy = member(guild);
  const o2 = await order(guild, happy, product);
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel: o2.channel });
  await run({ guild, member: happy, kind: 'modal', customId: 'vouch:submit', selects: { rating: ['5'], product: [product.id] }, fields: { review: 'Great service, instant delivery!' } });
  const r2 = db.guild(guild.id).reminders[o2.channel.id];
  await orders.runReminders(guild.client, r2.dueAt + 1);
  assert.equal(r2.sent, true);
  assert.equal(r2.result, 'already vouched');
  assert.equal(guild.dms.filter((d) => d.to === happy.id && /How was your order/.test(textOf(d.payload))).length, 0);

  // Turned off
  config.orders.vouchReminderHours = 0;
  try {
    const o3 = await order(guild, member(guild), product);
    await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel: o3.channel });
    assert.equal(db.guild(guild.id).reminders[o3.channel.id], undefined);
  } finally {
    config.orders.vouchReminderHours = 24;
  }
});

test('vouching from a DM: the button opens the vouch form, the vouch is posted in #vouches with the sticky panel', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '10' }, channel });
  const buttonId = `order:vouch:${guild.id}:${channel.id}`;

  const stranger = member(guild);
  const notYours = await runDm(guild, stranger, { kind: 'button', customId: buttonId });
  assert.match(textOf(lastResponse(notYours)), /belongs to someone else/);

  const click = await runDm(guild, buyer, { kind: 'button', customId: buttonId });
  const form = click.state.modals[0];
  assert.equal(form.custom_id, `order:vouched:${guild.id}`);
  const productSelect = form.components.find((c) => c.component?.custom_id === 'product').component;
  assert.equal(productSelect.options.find((o) => o.default)?.value, product.id, 'the ordered product is preselected');

  const submit = await runDm(guild, buyer, {
    kind: 'modal',
    customId: form.custom_id,
    selects: { rating: ['5'], product: [product.id] },
    fields: { review: 'Delivered in minutes, works perfectly!' },
  });
  assert.match(textOf(lastResponse(submit)), /Thank you for your vouch/);
  const vouchChannel = ch(guild, 'vouches');
  const posted = vouchChannel.messageList.at(-2);
  assert.match(textOf(posted.body), /Vouch #1/);
  assert.match(textOf(posted.body), /Delivered in minutes/);
  assert.match(textOf(posted.body), new RegExp(`Vouched by <@${buyer.id}>`));
  assert.ok(customIds(vouchChannel.messageList.at(-1).body).includes('vouch:open'), 'the vouch panel jumped to the bottom');
  assert.equal(db.guild(guild.id).vouches[0].userId, buyer.id);

  const again = await runDm(guild, buyer, { kind: 'button', customId: buttonId });
  assert.match(textOf(lastResponse(again)), /already left a vouch for this order/);

  // Someone who left the server can't vouch
  guild.members.cache.delete(buyer.id);
  guild.unknownMembers = new Set([buyer.id]);
  const gone = await runDm(guild, buyer, { kind: 'modal', customId: form.custom_id, selects: { rating: ['5'] }, fields: { review: 'Trying again after leaving', product_other: 'x' } });
  assert.match(textOf(lastResponse(gone)), /need to be a member/);
});

// ───────────── First-purchase discount ─────────────

test('welcome discount: one personal first-order code by DM after verifying, removed if the DM fails', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const visitor = guild.addMember(uid(), []);
  const verify = ch(guild, 'verify');
  const start = await run({ guild, member: visitor, kind: 'button', customId: 'verify:start', channel: verify });
  const [, , a, b] = start.state.modals[0].custom_id.split(':');
  await run({ guild, member: visitor, kind: 'modal', customId: start.state.modals[0].custom_id, fields: { answer: String(Number(a) + Number(b)) }, channel: verify });

  const codes = () => promos.list(guild.id).filter((p) => p.reason === 'welcome');
  assert.equal(codes().length, 1);
  const code = codes()[0];
  assert.match(code.code, /^WELCOME-[0-9A-F]{6}$/);
  assert.equal(code.userId, visitor.id);
  assert.equal(code.percent, config.welcomeDiscount.percent);
  assert.equal(code.firstOrderOnly, true);
  assert.equal(code.maxUses, 1);
  assert.ok(Math.abs(code.expiresAt - (Date.now() + config.welcomeDiscount.validDays * promos.DAY)) < 5000);

  const dm = guild.dms.filter((d) => d.to === visitor.id).at(-1).payload;
  validateMessage(dm, guild);
  const out = textOf(dm);
  assert.ok(out.includes(code.code));
  assert.match(out, /5% off your first order/);
  assert.match(out, /Promo code/);
  assert.match(out, /Valid until <t:\d+:f>/);
  const shopLink = dm.components[0].toJSON().components.at(-1).components[0];
  assert.equal(shopLink.url, `https://discord.com/channels/${guild.id}/${db.channelId(guild.id, 'shop')}`);

  // Once per member ever
  await hooks.emit('verified', visitor);
  assert.equal(codes().length, 1);
  assert.equal(guild.dms.filter((d) => d.to === visitor.id && textOf(d.payload).includes('welcome gift')).length, 1);

  // DMs closed → no code is left behind, and nothing is marked as given
  const shy = guild.addMember(uid(), []);
  guild.closedDms.add(shy.id);
  await hooks.emit('verified', shy);
  assert.equal(promos.list(guild.id).filter((p) => p.userId === shy.id).length, 0);
  assert.equal(db.guild(guild.id).welcomeCodes[shy.id], undefined);

  // Members who already bought something don't get a first-order code
  const regular = guild.addMember(uid(), []);
  db.guild(guild.id).orders[regular.id] = 2;
  await hooks.emit('verified', regular);
  assert.equal(promos.list(guild.id).filter((p) => p.userId === regular.id).length, 0);

  // The code works in the order form
  const product = shop.addProduct(guild, { name: 'Game Key', price: '20', description: 'Steam key.' });
  const { ticket } = await order(guild, visitor, product, { promo: code.code });
  assert.equal(ticket.order.promo, code.code);
  assert.equal(ticket.order.total, 19);
});

// ───────────── Discord limits ─────────────

test('receipt, proof, reminder, welcome cards and the completion form stay within Discord limits', async () => {
  const guild = new FakeGuild({ name: 'G'.repeat(100), premiumTier: 3 });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const long = 'N'.repeat(80);
  const sale = { id: 'S-9999', ticketNumber: 9999, channelId: '1', userId: '2', sellerId: '3', productId: null, product: long, quantity: 999, amount: 99999.99, currency: '€', method: 'M'.repeat(200), promo: 'X'.repeat(24), discount: 99999.99, createdAt: Date.now() - 86_400_000 * 40, completedAt: Date.now() };
  const ticket = { number: 9999, order: { product: long, quantity: 999, method: 'M'.repeat(100), promo: 'X'.repeat(24), unitPrice: 9999.99, total: 99999.99 } };
  validateMessage(orders.receiptCard(guild, { sale, ticket, sellerName: 'S'.repeat(100) }), guild);
  validateMessage(orders.proofCard(guild, sale), guild);
  validateMessage(orders.reminderCard(guild, '123456789012345678', { product: long, ticketNumber: 9999 }), guild);
  const promo = promos.personal(guild.id, '2', { percent: 100, days: 7, prefix: 'WELCOME' });
  validateMessage(orders.welcomeCard(guild, { displayName: 'D'.repeat(32) }, promo), guild);
  validateModal(ui.completeOrderModal(ticket), guild);
  validateModal(ui.completeOrderModal({ number: 1 }), guild);
  validateMessage(ui.orderCompletedCard(guild, { ownerId: '2' }, '3', { loyal: true, orders: 5, sale }), guild);
});
