'use strict';

/** Gifts and creator codes on cart orders (several products in one ticket – src/features/cart.js). */

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, MessageFlagsBitField } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const delivery = require('../src/features/delivery');
const affiliates = require('../src/features/affiliates');
const t = require('../src/tickets/tickets');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 951000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const privateMsg = { flags: new MessageFlagsBitField(MessageFlags.Ephemeral) };
const METHOD = (type) => String(config.shop.paymentMethods.findIndex((m) => m.type === type));
const texts = (channel) => channel.messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');

async function setup() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const netflix = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.' });
  const nitro = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'One month of Nitro.' });
  await delivery.setDelivery(guild, netflix.id, { text: 'NETFLIX-LOGIN-123' });
  await delivery.setDelivery(guild, nitro.id, { text: 'NITRO-GIFT-456' });
  return { guild, netflix, nitro, seller: member(guild, ['member', 'seller']) };
}

/** Both products into the cart, then checkout with a payment method and an optional promo code. */
async function cartOrder(guild, buyer, products, { promo = '' } = {}) {
  for (const p of products) await run({ guild, member: buyer, kind: 'modal', customId: `cart:addform:${p.id}:s`, fields: { quantity: '1' }, selects: {} });
  const open = await run({ guild, member: buyer, kind: 'button', customId: 'cart:checkout', message: privateMsg });
  const form = open.state.modals[0];
  await run({ guild, member: buyer, kind: 'modal', customId: form.custom_id, fields: { promo, notes: '' }, selects: { payment: [METHOD('paysafecard')] }, message: privateMsg });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const cardOf = (channel, ticket) => channel.messageList.find((x) => x.id === ticket.controlMessageId).body;

test('a cart order as a gift: every product goes to the recipient by DM and into the ticket; the buyer keeps the receipt', async () => {
  const { guild, netflix, nitro, seller } = await setup();
  const buyer = member(guild);
  const friend = member(guild);
  const { channel, ticket } = await cartOrder(guild, buyer, [netflix, nitro]);
  assert.equal(ticket().order.items.length, 2);
  assert.ok(customIds(cardOf(channel, ticket())).includes('gift:open'), 'the cart order card has the gift button');

  await run({ guild, member: buyer, kind: 'userselect', customId: 'gift:pick', values: [friend.id], channel });
  assert.equal(ticket().order.giftTo, friend.id);
  assert.match(textOf(cardOf(channel, ticket())), new RegExp(`Prezent dla <@${friend.id}>`));

  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  const dmsBefore = guild.dms.length;
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), new RegExp(`Dostarczono \\*\\*2 produkty\\*\\* w tickecie i w DM do odbiorcy prezentu <@${friend.id}>`));

  const sent = guild.dms.slice(dmsBefore);
  const gifts = sent.filter((d) => d.to === friend.id).map((d) => textOf(d.payload));
  assert.equal(gifts.length, 2, 'one DM per product to the recipient');
  assert.match(gifts[0], new RegExp(`Prezent od @user${buyer.id} – Netflix Premium × 1[\\s\\S]*NETFLIX-LOGIN-123`));
  assert.match(gifts[1], new RegExp(`Prezent od @user${buyer.id} – Nitro Boost × 1[\\s\\S]*NITRO-GIFT-456`));
  const toBuyer = sent.filter((d) => d.to === buyer.id).map((d) => textOf(d.payload));
  assert.ok(!toBuyer.some((x) => /Twój produkt – |Prezent od|NETFLIX-LOGIN/.test(x)), 'no product DM to the buyer');
  assert.ok(toBuyer.some((x) => /Dziękujemy za zamówienie![\s\S]*Prezent dla:\*\* <@/.test(x)), 'the receipt goes to the buyer');
  assert.ok(!sent.some((d) => d.to === friend.id && /Dziękujemy za zamówienie!/.test(textOf(d.payload))), 'no receipt to the recipient');

  const all = texts(channel);
  assert.match(all, /Twój prezent – Netflix Premium × 1[\s\S]*NETFLIX-LOGIN-123/);
  assert.match(all, /Twój prezent – Nitro Boost × 1[\s\S]*NITRO-GIFT-456/);
  assert.match(all, new RegExp(`Twój prezent został dostarczony – produkty trafiły do <@${friend.id}> w wiadomości prywatnej`));
  assert.ok(ticket().completedAt);
  assert.equal(statusOf(ticket()), 'delivered');
  assert.equal(ticket().order.delivered.giftTo, friend.id);
});

test("a cart gift whose recipient has closed DMs: the buyer is told to pass the products on", async () => {
  const { guild, netflix, nitro, seller } = await setup();
  const buyer = member(guild);
  const friend = member(guild);
  guild.closedDms.add(friend.id);
  const { channel, ticket } = await cartOrder(guild, buyer, [netflix, nitro]);
  await run({ guild, member: buyer, kind: 'userselect', customId: 'gift:pick', values: [friend.id], channel });
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), /nie udało się wysłać DM do odbiorcy prezentu/);
  assert.match(texts(channel), new RegExp(`nie udało się wysłać wiadomości prywatnej do <@${friend.id}>[\\s\\S]*produkty są tuż powyżej, przekaż je odbiorcy`));
  assert.equal(ticket().order.delivered.dm, false);
});

test('a creator code in the cart promo field gives the discount and earns commission once', async () => {
  const { guild, netflix, nitro, seller } = await setup();
  const creator = member(guild);
  affiliates.create(guild.id, { userId: creator.id, code: 'NOX-CART', discount: 10, commission: 15 });

  // The creator can't use their own code in the cart either.
  await cartOrder(guild, creator, [netflix], { promo: 'nox-cart' });
  assert.ok(!db.tickets((x) => x.guildId === guild.id && x.ownerId === creator.id && x.order?.promo === 'NOX-CART').length, 'own code refused');

  const buyer = member(guild);
  const { channel, ticket } = await cartOrder(guild, buyer, [netflix, nitro], { promo: 'nox-cart' });
  const order = ticket().order;
  assert.equal(order.promo, 'NOX-CART');
  assert.equal(order.subtotal, 22);
  assert.equal(order.total, 19.8);
  assert.deepEqual(order.affiliate, { code: 'NOX-CART', userId: creator.id, commission: 15 });

  const { sale } = await t.completeOrder(channel, seller);
  assert.equal(sale.amount, 19.8);
  const entry = () => affiliates.list(guild.id).find((a) => a.code === 'NOX-CART');
  assert.equal(entry().earned, 2.97); // 19.80 × 15%
  await t.completeOrder(channel, seller).catch(() => null); // completing again changes nothing
  assert.equal(entry().sales.length, 1);
  assert.equal(entry().earned, 2.97);
  assert.equal(guild.dms.filter((d) => d.to === creator.id && /Dostajesz \*\*2\.97€\*\* prowizji/.test(textOf(d.payload))).length, 1);
});
