'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const t = require('../src/tickets/tickets');
const { statusOf } = require('../src/lib/orderStatus');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 997000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member'], opts = {}) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)), opts);
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const METHOD = (type) => String(config.shop.paymentMethods.findIndex((m) => m.type === type));

/** A fake network with one uploaded delivery file. */
function fakeNet(upload) {
  const real = global.fetch;
  global.fetch = async (url) => {
    if (url === upload.url) return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(upload.bytes).buffer };
    throw new Error(`No network in tests: ${url}`);
  };
  return () => (global.fetch = real);
}

async function setup() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const owner = guild.members.cache.get(guild.ownerId);
  const product = shop.addProduct(guild, { name: 'Netflix Premium', price: '12', description: 'UHD account.' });
  const upload = { url: 'https://cdn.discordapp.com/attachments/1/2/account.txt', name: 'account.txt', contentType: 'text/plain', size: 22, bytes: Buffer.from('user: nox\npass: secret') };
  const restore = fakeNet(upload);
  try {
    await run({ guild, member: owner, kind: 'command', commandName: 'product', subcommand: 'delivery', options: { product: product.id, file: upload, text: 'Login at netflix.com' } });
  } finally {
    restore();
  }
  return { guild, product: shop.findProduct(guild.id, product.id), seller: member(guild, ['member', 'seller']) };
}

async function order(guild, buyer, product, type = 'paysafecard') {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '1' }, selects: { payment: [METHOD(type)] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).at(-1);
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const card = (channel, ticket) => {
  const m = channel.messageList.find((x) => x.id === ticket.controlMessageId);
  return m.body;
};
const texts = (channel) => channel.messageList.map((m) => textOf(m.body ?? m)).join('\n---\n');
const pick = (guild, who, channel, userId) => run({ guild, member: who, kind: 'userselect', customId: 'gift:pick', values: [userId], channel });

test('gift select: only the buyer, never themselves, a bot or someone who left – changeable and removable', async () => {
  const { guild, product, seller } = await setup();
  const buyer = member(guild);
  const friend = member(guild);
  const other = member(guild);
  const robot = member(guild, [], { bot: true });
  const { channel, ticket } = await order(guild, buyer, product);

  // The order card has the button.
  assert.ok(customIds(card(channel, ticket())).includes('gift:open'));
  assert.match(textOf(card(channel, ticket())), /Buying for a friend\?/);

  // Only the buyer opens the picker.
  for (const who of [seller, other]) {
    const denied = await run({ guild, member: who, kind: 'button', customId: 'gift:open', channel });
    assert.match(textOf(lastResponse(denied)), /Only the buyer/);
  }
  const open = await run({ guild, member: buyer, kind: 'button', customId: 'gift:open', channel });
  assert.ok(customIds(lastResponse(open)).includes('gift:pick'));
  assert.ok(!customIds(lastResponse(open)).includes('gift:remove'), 'nothing to remove yet');

  // Not yourself, not a bot, not someone who isn't on the server, and only the buyer can pick.
  assert.match(textOf(lastResponse(await pick(guild, buyer, channel, buyer.id))), /That's you/);
  assert.match(textOf(lastResponse(await pick(guild, buyer, channel, robot.id))), /Bots can't get gifts/);
  const ghost = uid();
  guild.unknownMembers = new Set([ghost]);
  assert.match(textOf(lastResponse(await pick(guild, buyer, channel, ghost))), /isn't on this server/);
  guild.unknownMembers = null;
  assert.match(textOf(lastResponse(await pick(guild, other, channel, friend.id))), /Only the buyer/);
  assert.equal(ticket().order.giftTo, undefined);

  // The buyer picks a friend → saved, the card and the ticket show it (without pinging the friend).
  const ok = await pick(guild, buyer, channel, friend.id);
  assert.equal(ok.state.deferredAs, 'update');
  assert.match(textOf(lastResponse(ok)), new RegExp(`gift for <@${friend.id}>`));
  assert.equal(ticket().order.giftTo, friend.id);
  assert.match(textOf(card(channel, ticket())), new RegExp(`Gift for <@${friend.id}>`));
  assert.ok(customIds(card(channel, ticket())).includes('gift:open'), 'still changeable');
  const note = channel.messageList.at(-1);
  assert.match(textOf(note.body), new RegExp(`made this order a gift for <@${friend.id}>`));
  assert.deepEqual(note.body.allowedMentions, { parse: [] });

  // Changed to someone else, then removed.
  const reopen = await run({ guild, member: buyer, kind: 'button', customId: 'gift:open', channel });
  assert.ok(customIds(lastResponse(reopen)).includes('gift:remove'));
  await pick(guild, buyer, channel, other.id);
  assert.equal(ticket().order.giftTo, other.id);
  assert.match(textOf(channel.messageList.at(-1).body), new RegExp(`instead of <@${friend.id}>`));
  const removed = await run({ guild, member: buyer, kind: 'button', customId: 'gift:remove', channel });
  assert.match(textOf(lastResponse(removed)), /Not a gift any more/);
  assert.equal(ticket().order.giftTo, undefined);
  assert.match(textOf(channel.messageList.at(-1).body), /no longer a gift/);
  assert.match(textOf(card(channel, ticket())), /Buying for a friend\?/);
});

test('gift delivery: the product goes to the recipient by DM and into the ticket; the buyer keeps the receipt', async () => {
  const { guild, product, seller } = await setup();
  const buyer = member(guild);
  const friend = member(guild);
  const { channel, ticket } = await order(guild, buyer, product);
  await pick(guild, buyer, channel, friend.id);

  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  assert.match(texts(channel), new RegExp(`your product is sent right here and to <@${friend.id}>'s DMs`));
  const dmsBefore = guild.dms.length;
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), new RegExp(`Delivered \\*\\*Netflix Premium\\*\\* in the ticket and to the gift's recipient <@${friend.id}> by DM`));

  // The recipient's DM: who it's from, the text and the file.
  const gift = guild.dms.slice(dmsBefore).find((d) => d.to === friend.id);
  assert.ok(gift, 'the recipient got a DM');
  assert.match(textOf(gift.payload), new RegExp(`A gift from @user${buyer.id} – Netflix Premium[\\s\\S]*Login at netflix\\.com`));
  assert.deepEqual((gift.payload.files ?? []).map((f) => f.name ?? f.attachment?.name), ['account.txt']);
  // The buyer gets no copy of the product by DM – only the receipt.
  const toBuyer = guild.dms.slice(dmsBefore).filter((d) => d.to === buyer.id).map((d) => textOf(d.payload));
  assert.ok(!toBuyer.some((x) => /Your product – |A gift from/.test(x)), 'no product DM to the buyer');
  assert.ok(toBuyer.some((x) => /Thank you for your order![\s\S]*Gift for:\*\* <@/.test(x)), 'the receipt goes to the buyer and says it was a gift');

  // The ticket: the product for the buyer, and the note that the DM got through.
  const all = texts(channel);
  assert.match(all, new RegExp(`Your gift – Netflix Premium[\\s\\S]*a gift for <@${friend.id}>`));
  assert.match(all, new RegExp(`your gift is delivered – <@${friend.id}> got the product by DM`));
  assert.ok(ticket().completedAt, 'order completed');
  assert.equal(statusOf(ticket()), 'delivered');
  assert.equal(ticket().order.delivered.giftTo, friend.id);
  assert.equal(ticket().order.delivered.dm, true);

  // Delivered → the gift can't change any more, and the card has no button.
  const late = await run({ guild, member: buyer, kind: 'button', customId: 'gift:open', channel });
  assert.match(textOf(lastResponse(late)), /already delivered/);
  assert.ok(!customIds(card(channel, ticket())).includes('gift:open'));
  assert.match(textOf(card(channel, ticket())), new RegExp(`Gift for <@${friend.id}>`));
});

test("gift delivery: the recipient's DMs are closed → the buyer is told to pass it on", async () => {
  const { guild, product, seller } = await setup();
  const buyer = member(guild);
  const friend = member(guild);
  guild.closedDms.add(friend.id);
  const { channel, ticket } = await order(guild, buyer, product);
  await pick(guild, buyer, channel, friend.id);
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), /couldn't DM the gift's recipient/);
  const warn = channel.messageList.find((m) => /I couldn't DM/.test(textOf(m.body)));
  assert.match(textOf(warn.body), new RegExp(`<@${buyer.id}> I couldn't DM <@${friend.id}>[\\s\\S]*pass it on`));
  assert.deepEqual(warn.body.allowedMentions, { users: [buyer.id] }, 'pings the buyer only');
  assert.equal(ticket().order.delivered.dm, false);
  assert.ok(channel.messageList.some((m) => /Your gift – Netflix Premium/.test(textOf(m.body))), 'the product is in the ticket');
});

test('gift + a product without delivery files: staff are told to hand it to the recipient; nothing is DMed', async () => {
  const { guild, seller } = await setup();
  const plain = shop.addProduct(guild, { name: 'Custom Logo', price: '30', description: 'Made for you.' });
  const buyer = member(guild);
  const friend = member(guild);
  const { channel, ticket } = await order(guild, buyer, plain, 'crypto');
  await pick(guild, buyer, channel, friend.id);
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { note: 'tx 0xabc' }, channel });
  const dmsBefore = guild.dms.length;
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), new RegExp(`deliver it by hand[\\s\\S]*It's a gift – give it to <@${friend.id}>`));
  assert.equal(statusOf(ticket()), 'paid');
  assert.ok(!guild.dms.slice(dmsBefore).some((d) => d.to === friend.id), 'nothing sent to the recipient automatically');
  // Still changeable until it's delivered by hand (completed).
  assert.ok(customIds(card(channel, ticket())).includes('gift:open'));
  await t.completeOrder(channel, seller);
  assert.ok(!customIds(card(channel, ticket())).includes('gift:open'));
  const receipt = guild.dms.filter((d) => d.to === buyer.id).map((d) => textOf(d.payload)).find((x) => /Thank you for your order!/.test(x));
  assert.match(receipt, new RegExp(`Gift for:\\*\\* <@${friend.id}>`));
});

test('normal orders are unchanged; turning gifts off hides the button', async () => {
  const { guild, product, seller } = await setup();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);
  await run({ guild, member: buyer, kind: 'modal', customId: 'pay:submit', fields: { pins: '1234-5678-9012-3456' }, channel });
  const ok = await run({ guild, member: seller, kind: 'button', customId: 'deliver:confirm', channel });
  assert.match(textOf(lastResponse(ok)), /Delivered \*\*Netflix Premium\*\* in the ticket and by DM/);
  assert.ok(guild.dms.some((d) => d.to === buyer.id && /Your product – Netflix Premium/.test(textOf(d.payload))));

  config.gifts.enabled = false;
  try {
    const other = member(guild);
    const second = await order(guild, other, product);
    assert.ok(!customIds(card(second.channel, second.ticket())).includes('gift:open'));
    const off = await run({ guild, member: other, kind: 'button', customId: 'gift:open', channel: second.channel });
    assert.match(textOf(lastResponse(off)), /Gifts are turned off/);
  } finally {
    config.gifts.enabled = true;
  }
});
