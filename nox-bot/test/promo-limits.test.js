'use strict';

// Promo code limits on real orders: max uses, once per member and first order only must hold when
// orders arrive at the same time, when an order ticket is closed and reopened, and at completion.

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage, validateModal } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const promos = require('../src/features/promos');
const shop = require('../src/features/shop');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0; // tests open several orders per member right after each other

let n = 920000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const answer = (ticket, label) => ticket.answers.find((a) => a.label === label)?.value;
const logText = (guild) => textOf(guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1).body);
const HELD = /All remaining uses of this code are held by other open orders right now – it only becomes available again if one of them is cancelled\./;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.', emoji: '💎' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

/** Buy → order form → ticket. Returns the interaction, the ticket and its channel. */
async function order(guild, buyer, product, { quantity = '1', promo } = {}) {
  const fields = { quantity };
  if (promo !== undefined) fields.promo = promo;
  const i = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields, selects: { payment: ['0'] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { i, ticket, channel: ticket && guild.channels.cache.get(ticket.channelId) };
}

const complete = (guild, seller, channel, amount) =>
  run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: amount == null ? '' : String(amount) }, channel });

// ───────────── Orders placed at the same time ─────────────

test('two buyers submitting a max_uses:1 code at the same time: only one gets the discount', async () => {
  const { guild, product, seller } = await shopGuild();
  promos.create(guild.id, { code: 'FIRST1', percent: 50, maxUses: 1 });
  const a = member(guild);
  const b = member(guild);
  const [ra, rb] = await Promise.all([order(guild, a, product, { promo: 'FIRST1' }), order(guild, b, product, { promo: 'FIRST1' })]);

  assert.ok(ra.ticket && rb.ticket, 'both orders are opened');
  assert.deepEqual([ra, rb].map((r) => r.ticket.order.promo).filter(Boolean), ['FIRST1'], 'exactly one order keeps the code');
  const loser = ra.ticket.order.promo ? rb : ra;
  assert.equal(loser.ticket.order.total, 10);
  assert.match(textOf(lastResponse(loser.i)), /Promo code \*\*FIRST1\*\* – not applied: All remaining uses/);
  assert.match(answer(loser.ticket, 'Price'), HELD);

  await complete(guild, seller, ra.channel, ra.ticket.order.total);
  await complete(guild, seller, rb.channel, rb.ticket.order.total);
  assert.equal(promos.find(guild.id, 'FIRST1').uses.length, 1, 'never redeemed past max_uses');
  assert.deepEqual(db.sales(guild.id).map((s) => s.discount).sort(), [0, 5]);
});

test('an order that fails to open gives its code back right away', async () => {
  const { guild, product } = await shopGuild();
  promos.create(guild.id, { code: 'SOLO', percent: 50, maxUses: 1 });
  const settings = db.settings(guild.id);
  const categoryId = settings.categoryId;
  db.updateSettings(guild.id, { categoryId: null }); // the ticket system is not set up → openTicket refuses
  try {
    const failed = await order(guild, member(guild), product, { promo: 'SOLO' });
    assert.equal(failed.ticket, undefined);
    assert.match(textOf(lastResponse(failed.i)), /not set up yet/);
  } finally {
    db.updateSettings(guild.id, { categoryId });
  }
  const ok = await order(guild, member(guild), product, { promo: 'SOLO' });
  assert.equal(ok.ticket.order.promo, 'SOLO');
});

// ───────────── Closing and reopening an order ─────────────

test('reopening an order whose code was used up in the meantime drops the discount and says so', async () => {
  const { guild, product, seller } = await shopGuild();
  promos.create(guild.id, { code: 'ONE', percent: 50, maxUses: 1, oncePerUser: false });
  const a = member(guild);
  const ra = await order(guild, a, product, { promo: 'ONE' });
  assert.equal(ra.ticket.order.total, 5);
  await t.closeTicket(ra.channel, seller, 'No answer');

  // The closed order released the code – someone else takes it and pays
  const rb = await order(guild, member(guild), product, { promo: 'ONE' });
  assert.equal(rb.ticket.order.promo, 'ONE');
  await complete(guild, seller, rb.channel, 5);

  const reopen = await run({ guild, member: seller, kind: 'button', customId: 'ticket:reopen', channel: ra.channel, message: ra.channel.messageList.at(-1) });
  assert.match(textOf(lastResponse(reopen)), /reopened/);
  const ticket = db.getTicket(ra.channel.id);
  assert.equal(ticket.status, 'open');
  assert.equal(ticket.order.promo, null);
  assert.equal(ticket.order.discount, 0);
  assert.equal(ticket.order.total, 10);
  assert.equal(answer(ticket, 'Price'), '**Total to pay: 10€**\nPromo code ONE – not applied: This code has been used up.');
  const notice = ra.channel.messageList.map((m) => textOf(m.body)).find((x) => /Ticket reopened/.test(x));
  validateMessage(ra.channel.messageList.find((m) => /Ticket reopened/.test(textOf(m.body))).body, guild);
  assert.match(notice, /Promo code \*\*ONE\*\* no longer applies/);
  assert.match(notice, /released while this ticket was closed[\s\S]*This code has been used up\./);
  assert.match(notice, /Total to pay now: \*\*10€\*\*/);
  assert.match(logText(guild), /Ticket reopened[\s\S]*ONE removed – This code has been used up\./);

  const pick = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel: ra.channel });
  assert.equal(pick.state.modals[0].components.find((c) => c.component?.custom_id === 'amount').component.value, '10');
  await complete(guild, seller, ra.channel, 10);
  const sale = db.sales(guild.id).at(-1);
  assert.deepEqual([sale.userId, sale.promo, sale.discount, sale.amount], [a.id, null, 0, 10]);
  assert.equal(promos.find(guild.id, 'ONE').uses.length, 1, 'max_uses holds');
});

test('reopening: once-per-member codes are not taken twice; a code that is still free is kept and held again', async () => {
  const { guild, product, seller } = await shopGuild();
  promos.create(guild.id, { code: 'ONCE', percent: 10 });
  const a = member(guild);
  const first = await order(guild, a, product, { promo: 'ONCE' });
  await t.closeTicket(first.channel, seller);
  const second = await order(guild, a, product, { promo: 'ONCE' });
  assert.equal(second.ticket.order.promo, 'ONCE', 'the closed order released the code');
  await t.reopenTicket(first.channel, seller);
  assert.equal(db.getTicket(first.channel.id).order.promo, null);
  assert.match(textOf(first.channel.messageList.at(-1).body), /ONCE\*\* no longer applies[\s\S]*You're already using this code in another open order\./);
  await t.completeOrder(first.channel, seller);
  await t.completeOrder(second.channel, seller);
  assert.equal(promos.find(guild.id, 'ONCE').uses.filter((u) => u.userId === a.id).length, 1);

  // Still valid → the discount stays and the code is held by the reopened order again
  promos.create(guild.id, { code: 'NOX10', percent: 10 });
  const b = member(guild);
  const kept = await order(guild, b, product, { promo: 'NOX10' });
  await t.closeTicket(kept.channel, seller);
  await t.reopenTicket(kept.channel, seller);
  const ticket = db.getTicket(kept.channel.id);
  assert.deepEqual([ticket.order.promo, ticket.order.total], ['NOX10', 9]);
  assert.doesNotMatch(textOf(kept.channel.messageList.at(-1).body), /no longer applies/);
  const again = await order(guild, b, product, { promo: 'NOX10' });
  assert.match(answer(again.ticket, 'Price'), /You're already using this code in another open order\./);
});

test('reopening an order with a non-numeric price: the code is dropped and the seller prices it without the discount', async () => {
  const { guild, seller } = await shopGuild();
  const product = shop.addProduct(guild, { name: 'Custom Logo', price: 'from 5€', description: 'Made for you.' });
  promos.create(guild.id, { code: 'ART', percent: 15, maxUses: 1, oncePerUser: false });
  const ra = await order(guild, member(guild), product, { promo: 'ART' });
  await t.closeTicket(ra.channel, seller);
  const rb = await order(guild, member(guild), product, { promo: 'ART' });
  assert.equal(rb.ticket.order.promo, 'ART');
  await t.reopenTicket(ra.channel, seller);
  const ticket = db.getTicket(ra.channel.id);
  assert.deepEqual([ticket.order.promo, ticket.order.total], [null, null]);
  assert.match(answer(ticket, 'Promo code'), /^ART – not applied: All remaining uses/);
  assert.match(textOf(ra.channel.messageList.at(-1).body), /The seller confirms the final price without the discount\./);
});

// ───────────── First order only ─────────────

test('first-order-only codes: a member with another open order cannot use one', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  promos.create(guild.id, { code: 'FIRST20', amount: 2, firstOrderOnly: true });
  const welcome = promos.personal(guild.id, buyer.id, { percent: 5, prefix: 'WELCOME', firstOrderOnly: true });
  const one = await order(guild, buyer, product, { promo: 'FIRST20' });
  assert.equal(one.ticket.order.promo, 'FIRST20');
  const two = await order(guild, buyer, product, { promo: welcome.code });
  assert.equal(two.ticket.order.promo, null);
  assert.match(answer(two.ticket, 'Price'), /not applied: This code is only valid for your first order – you already have another open order\./);
  await t.completeOrder(one.channel, seller);
  await t.completeOrder(two.channel, seller);
  assert.deepEqual(db.sales(guild.id).map((s) => [s.promo, s.discount]), [['FIRST20', 2], [null, 0]]);

  // An open order without a code counts as well
  const other = member(guild);
  const plain = await order(guild, other, product);
  promos.create(guild.id, { code: 'HELLO', percent: 10, firstOrderOnly: true });
  const later = await order(guild, other, product, { promo: 'HELLO' });
  assert.match(answer(later.ticket, 'Price'), /only valid for your first order – you already have another open order/);
  // …but a closed one doesn't
  await t.closeTicket(plain.channel, seller);
  await t.closeTicket(later.channel, seller);
  const now = await order(guild, other, product, { promo: 'HELLO' });
  assert.equal(now.ticket.order.promo, 'HELLO');
});

// ───────────── Backstop at completion ─────────────

test('completing an order whose code went over its limit warns the seller in the form, the reply and the log', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  promos.create(guild.id, { code: 'DROP', percent: 50, maxUses: 1, oncePerUser: false });
  const { channel } = await order(guild, buyer, product, { promo: 'DROP' });
  promos.redeem(guild.id, 'DROP', uid(), 'S-0999'); // e.g. an order placed before the limit was enforced

  const pick = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel });
  const form = pick.state.modals[0];
  validateModal(form, guild);
  assert.match(form.components[0].content, /⚠️ \*\*Code DROP is over its limit\*\* – already used up \(1\/1 uses\)\. The total above still includes its discount – enter what the customer actually paid\./);

  const done = await complete(guild, seller, channel, 5);
  const out = textOf(lastResponse(done));
  assert.match(out, /Order completed – sale `S-0001` recorded – 5€ paid \(code DROP\)/);
  assert.match(out, /⚠️ Code DROP was over its limit \(already used up \(1\/1 uses\)\) – its −5€ discount is still recorded on this sale\./);
  assert.match(logText(guild), /Promo code[\s\S]*DROP \(−5€\)[\s\S]*⚠️ over its limit: already used up \(1\/1 uses\)/);
  assert.equal(promos.find(guild.id, 'DROP').uses.length, 2, 'the use is recorded – the history stays true');

  // First order only: another order of the same member was completed first
  const newbie = member(guild);
  const welcome = promos.personal(guild.id, newbie.id, { percent: 10, prefix: 'WELCOME', firstOrderOnly: true });
  const w = await order(guild, newbie, product, { promo: welcome.code });
  db.guild(guild.id).orders[newbie.id] = 1; // e.g. a Purchase ticket from the panel, completed first
  const done2 = await complete(guild, seller, w.channel, 9);
  assert.match(textOf(lastResponse(done2)), /over its limit \(it's for first orders only, and the customer already had a completed order\)/);

  // Within the limit: no warning
  promos.create(guild.id, { code: 'FINE', percent: 10 });
  const f = await order(guild, member(guild), product, { promo: 'FINE' });
  const ok = await complete(guild, seller, f.channel, 9);
  assert.doesNotMatch(textOf(lastResponse(ok)), /over its limit/);
});

// ───────────── Codes held by open orders ─────────────

test('a code held by an open order: honest message for buyers, /promo list and info show who holds it', async () => {
  const { guild, product, seller } = await shopGuild();
  promos.create(guild.id, { code: 'FIRST1', percent: 10, maxUses: 1 });
  const a = await order(guild, member(guild), product, { promo: 'FIRST1' });
  assert.equal(a.ticket.order.promo, 'FIRST1');
  const b = await order(guild, member(guild), product, { promo: 'FIRST1' });
  assert.match(textOf(lastResponse(b.i)), HELD);
  assert.doesNotMatch(textOf(lastResponse(b.i)), /used up/);

  const list = await run({ guild, member: seller, kind: 'command', commandName: 'promo', subcommand: 'list' });
  validateMessage(lastResponse(list), guild);
  assert.match(textOf(lastResponse(list)), /`FIRST1` · \*\*10% off\*\* · 0\/1 uses · 1 held by an open order · no expiry/);
  const info = await run({ guild, member: seller, kind: 'command', commandName: 'promo', subcommand: 'info', options: { code: 'FIRST1' } });
  validateMessage(lastResponse(info), guild);
  const details = textOf(lastResponse(info));
  assert.match(details, /Uses 0\/1 uses · 1 held by an open order/);
  assert.match(details, /all remaining uses are held by open orders/);
  assert.match(details, new RegExp(`Held by open orders \\(1\\)[\\s\\S]*<#${a.channel.id}> · <@${a.ticket.ownerId}>`));

  // Used up for real: the plain "used up" message, nothing held any more
  await complete(guild, seller, a.channel, 9);
  const c = await order(guild, member(guild), product, { promo: 'FIRST1' });
  assert.match(answer(c.ticket, 'Price'), /not applied: This code has been used up\./);
  const after = await run({ guild, member: seller, kind: 'command', commandName: 'promo', subcommand: 'list' });
  assert.match(textOf(lastResponse(after)), /`FIRST1` · \*\*10% off\*\* · 1\/1 uses · no expiry/);
});
