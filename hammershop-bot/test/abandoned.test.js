'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const promos = require('../src/features/promos');
const shop = require('../src/features/shop');
const abandoned = require('../src/features/abandoned');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 934000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.', emoji: '💎' });
  return { guild, nitro, seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, p, { promo } = {}) {
  const fields = { quantity: '1' };
  if (promo) fields.promo = promo;
  const i = createInteraction({ guild, member: buyer, kind: 'modal', customId: `shop:order:${p.id}`, fields, selects: { payment: ['0'] } });
  await handle(i, commands);
  return db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
}

/** Places an order, optionally changes it, closes it and moves its closing time back. */
async function closedOrder(guild, seller, buyer, p, { patch = null, closedAgo = 25 * HOUR } = {}) {
  const ticket = await order(guild, buyer, p);
  if (patch) db.updateTicket(ticket.channelId, { order: { ...ticket.order, ...patch } });
  await t.closeTicket(guild.channels.cache.get(ticket.channelId), seller);
  db.updateTicket(ticket.channelId, { closedAt: Date.now() - closedAgo, createdAt: Date.now() - closedAgo - HOUR });
  return db.getTicket(ticket.channelId);
}

const comebacks = (guild, who) => guild.dms.filter((d) => d.to === who.id && /Still thinking about it/.test(textOf(d.payload)));
const codeOf = (payload) => textOf(payload).match(/`(COMEBACK-[0-9A-F]{6})`/)?.[1];

test('abandoned order: after afterHours the buyer gets ONE personal 5% COMEBACK code by DM – and the code works', async () => {
  const { guild, nitro, seller } = await shopGuild();
  const buyer = member(guild);
  const ticket = await order(guild, buyer, nitro);
  await t.closeTicket(guild.channels.cache.get(ticket.channelId), seller);
  const closedAt = db.getTicket(ticket.channelId).closedAt;

  assert.equal(await abandoned.sweep(guild.client, closedAt + 23 * HOUR), 0, 'not before 24 hours');
  assert.equal(comebacks(guild, buyer).length, 0);
  assert.equal(await abandoned.sweep(guild.client, closedAt + 24 * HOUR + 1), 1);
  const dms = comebacks(guild, buyer);
  assert.equal(dms.length, 1);
  validateMessage(dms[0].payload, guild);
  const out = textOf(dms[0].payload);
  assert.match(out, /Your order \*\*Nitro\*\* \(`#\d{4}`\) at \*\*.+\*\* was closed before it was paid/);
  assert.match(out, /\*\*5% off\*\* your next order/);
  assert.match(out, /Back to the shop/);
  assert.equal(JSON.parse(JSON.stringify(dms[0].payload.components[0])).components.at(-1).components[0].url, `https://discord.com/channels/${guild.id}/${db.channelId(guild.id, 'shop')}`);
  assert.ok(dms[0].payload.allowedMentions, 'allowedMentions set');

  const code = codeOf(dms[0].payload);
  const promo = promos.find(guild.id, code);
  assert.equal(promo.percent, 5);
  assert.equal(promo.userId, buyer.id);
  assert.equal(promo.maxUses, 1);
  assert.ok(Math.abs(promo.expiresAt - (Date.now() + 3 * DAY)) < 60_000, 'valid for 3 days');
  assert.deepEqual(db.guild(guild.id).abandoned[ticket.channelId], { userId: buyer.id, sentAt: closedAt + 24 * HOUR + 1, code });

  // Only once – for this ticket and for this member.
  assert.equal(await abandoned.sweep(guild.client, closedAt + 30 * HOUR), 0);
  assert.equal(comebacks(guild, buyer).length, 1);

  // The code works for the buyer: 20€ − 5% = 19€.
  const next = await order(guild, buyer, nitro, { promo: code.toLowerCase() });
  assert.equal(next.order.promo, code);
  assert.equal(next.order.total, 19);
  // …and nobody else can use it.
  assert.match(promos.check(guild.id, code, member(guild).id).error, /belongs to someone else/);

  // Turned off → nothing is sent.
  const other = member(guild);
  await closedOrder(guild, seller, other, nitro);
  config.abandonedOrders.enabled = false;
  try {
    assert.equal(await abandoned.sweep(guild.client), 0);
  } finally {
    config.abandonedOrders.enabled = true;
  }
  assert.equal(await abandoned.sweep(guild.client), 1);
});

test('no code for paid, completed, top-up or newer orders, blacklisted members, old tickets – at most one per 30 days; closed DMs are ignored', async () => {
  const { guild, nitro, seller } = await shopGuild();
  const cases = {
    paymentSent: await closedOrder(guild, seller, member(guild), nitro, { patch: { status: 'sent', payment: { at: Date.now(), method: 'PaysafeCard', note: null, pins: [], files: [] } } }),
    paid: await closedOrder(guild, seller, member(guild), nitro, { patch: { status: 'paid' } }),
    balance: await closedOrder(guild, seller, member(guild), nitro, { patch: { paidWith: 'balance' } }),
    topUp: await closedOrder(guild, seller, member(guild), nitro, { patch: { topUp: { amount: 10 } } }),
    crypto: await closedOrder(guild, seller, member(guild), nitro, { patch: { crypto: { coin: 'BTC', txid: 'a'.repeat(64), status: 'checking' } } }),
    tooOld: await closedOrder(guild, seller, member(guild), nitro, { closedAgo: 10 * DAY }),
  };
  // Completed (with a sale) → never abandoned.
  const happy = member(guild);
  const done = await order(guild, happy, nitro);
  await t.completeOrder(guild.channels.cache.get(done.channelId), seller, { amount: 20 });
  assert.equal(abandoned.unpaidAndClosed(db.getTicket(done.channelId)), false);

  // A newer order (still open) → the member came back on their own.
  const returning = member(guild);
  const old = await closedOrder(guild, seller, returning, nitro);
  await order(guild, returning, nitro);
  // A completed order since → same.
  const bought = member(guild);
  const before = await closedOrder(guild, seller, bought, nitro);
  db.addSale(guild.id, { id: 'S-test', userId: bought.id, product: 'Nitro', amount: 20, createdAt: Date.now(), completedAt: Date.now() });

  const banned = member(guild);
  const bannedTicket = await closedOrder(guild, seller, banned, nitro);
  db.addBlacklist(guild.id, { userId: banned.id, reason: 'Chargeback', by: seller.id, at: Date.now() });

  const shy = member(guild);
  guild.closedDms.add(shy.id);
  const shyTicket = await closedOrder(guild, seller, shy, nitro);

  const promosBefore = promos.list(guild.id).length;
  assert.equal(await abandoned.sweep(guild.client), 0);
  const g = db.guild(guild.id);
  for (const [why, ticket] of Object.entries({ ...cases, old, before, bannedTicket })) {
    assert.equal(g.abandoned[ticket.channelId], undefined, why);
    assert.equal(guild.dms.filter((d) => d.to === ticket.ownerId && /Still thinking/.test(textOf(d.payload))).length, 0, why);
  }
  // Closed DMs: tried once, the code is deleted again, never retried.
  assert.deepEqual({ ...g.abandoned[shyTicket.channelId], sentAt: 0 }, { userId: shy.id, sentAt: 0, code: null });
  assert.equal(promos.list(guild.id).length, promosBefore);
  assert.equal(await abandoned.sweep(guild.client), 0);

  // One code per member per 30 days: a second abandoned order a few days later gets nothing.
  const buyer = member(guild);
  const first = await closedOrder(guild, seller, buyer, nitro, { closedAgo: 6 * DAY });
  assert.equal(await abandoned.sweep(guild.client), 1);
  const second = await closedOrder(guild, seller, buyer, nitro);
  assert.equal(await abandoned.sweep(guild.client), 0);
  assert.ok(g.abandoned[first.channelId].code);
  assert.equal(g.abandoned[second.channelId], undefined);

  // An unavailable server (Discord outage) is skipped.
  const third = member(guild);
  await closedOrder(guild, seller, third, nitro);
  guild.available = false;
  try {
    assert.equal(await abandoned.sweep(guild.client), 0);
  } finally {
    guild.available = true;
  }
  assert.equal(await abandoned.sweep(guild.client), 1);
});
