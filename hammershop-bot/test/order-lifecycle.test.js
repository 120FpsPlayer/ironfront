'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const promos = require('../src/features/promos');
const orderstatus = require('../src/features/orderstatus');
const t = require('../src/tickets/tickets');
const { createTranscript } = require('../src/tickets/transcript');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 990000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const HOUR = 3_600_000;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, product, { quantity = '1', promo = '' } = {}) {
  const i = createInteraction({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity, promo }, selects: { payment: ['0'] } });
  await handle(i, commands);
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { ticket, channel: guild.channels.cache.get(ticket.channelId) };
}

test('reopening an order that was already paid keeps its promo code – even if the code is gone by then', async () => {
  const { guild, seller } = await shopGuild();
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.' });
  promos.create(guild.id, { code: 'WEEK', percent: 50 });
  const { channel } = await order(guild, member(guild), nitro, { promo: 'WEEK' });
  assert.equal(db.getTicket(channel.id).order.total, 10);
  await orderstatus.setStatus(channel, 'paid', seller);
  await t.closeTicket(channel, seller, 'Back tomorrow');
  promos.remove(guild.id, 'WEEK');
  await t.reopenTicket(channel, seller);
  const reopened = db.getTicket(channel.id);
  assert.equal(reopened.order.promo, 'WEEK', 'paid at the discounted total – the code stays');
  assert.equal(reopened.order.total, 10);
  assert.equal(statusOf(reopened), 'paid');

  // Not paid yet → the code is checked again, like before
  promos.create(guild.id, { code: 'GONE', percent: 50 });
  const { channel: unpaid } = await order(guild, member(guild), nitro, { promo: 'GONE' });
  await t.closeTicket(unpaid, seller, 'No answer');
  promos.remove(guild.id, 'GONE');
  await t.reopenTicket(unpaid, seller);
  assert.equal(db.getTicket(unpaid.id).order.promo, null);
  assert.equal(db.getTicket(unpaid.id).order.total, 20);
});

test('auto-close never closes an order that is paid, being checked or in progress', async () => {
  const { guild, seller } = await shopGuild();
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.' });
  const make = async (status) => {
    const { channel } = await order(guild, member(guild), nitro);
    if (status !== 'awaiting') await orderstatus.setStatus(channel, status, seller);
    // The seller wrote last, three days ago
    db.updateTicket(channel.id, { lastMessageBy: 'staff', lastActivity: Date.now() - 72 * HOUR, warned: true });
    return channel;
  };
  const paid = await make('paid');
  const progress = await make('progress');
  const idle = await make('awaiting');
  await t.runInactivityCheck(guild.client);
  assert.equal(db.getTicket(paid.id).status, 'open');
  assert.equal(db.getTicket(progress.id).status, 'open');
  assert.equal(db.getTicket(idle.id).status, 'closed', 'an unpaid order still closes after the customer stopped answering');
});

test('transcripts never contain a PaysafeCard PIN in full – IDs and mentions stay', async () => {
  const { guild, seller } = await shopGuild();
  const buyer = member(guild);
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.' });
  const { channel } = await order(guild, buyer, nitro);
  await channel.send({ content: `<@${seller.id}> here is my pin 1234 5678 9012 3456 and 1111-2222-3333-4444` });
  await channel.send({ content: 'order 1234567890123456789 · paid 19.99' });
  const { attachment } = await createTranscript(channel, db.getTicket(channel.id), config.getType('order'));
  const html = attachment.attachment.toString('utf8');
  assert.ok(!/(?<!\d)1234\D?5678\D?9012\D?3456(?!\d)/.test(html) && !/1111\D?2222\D?3333\D?4444/.test(html), 'no PIN in the transcript');
  assert.ok(html.includes('••••-••••-••••-3456') && html.includes('••••-••••-••••-4444'));
  assert.ok(html.includes('1234567890123456789'), 'longer numbers like IDs stay');
  assert.ok(html.includes(`@${seller.displayName ?? seller.user.username}`) || html.includes('class="mention"'), 'mentions still resolve');
});

test('older shop orders without ticket.order still count down the stock and count for the product', async () => {
  const { guild, seller } = await shopGuild();
  const spotify = shop.addProduct(guild, { name: 'Spotify Premium', price: '10', description: 'Family plan.' });
  await shop.setStock(guild, spotify.id, 'in');
  spotify.stockCount = 5;
  // How the shop stored orders before ticket.order existed: "Name — price" in the Product answer
  const channel = await t.openTicket(member(guild), config.getType('order'), [
    { label: 'Product', value: 'Spotify Premium — 10€' },
    { label: 'Quantity', value: '2' },
    { label: 'Payment method', value: 'PaysafeCard' },
  ]);
  assert.equal(db.getTicket(channel.id).order ?? null, null);
  const { sale } = await t.completeOrder(channel, seller, { amount: 20 });
  assert.equal(sale.productId, spotify.id);
  assert.equal(shop.findProduct(guild.id, spotify.id).stockCount, 3);
});
