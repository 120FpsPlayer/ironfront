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
const shop = require('../src/features/shop');
const payments = require('../src/features/payments');
const orderstatus = require('../src/features/orderstatus');
const t = require('../src/tickets/tickets');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 961000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const MB = 1024 * 1024;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const realFetch = global.fetch;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const product = shop.addProduct(guild, { name: 'Nitro Boost', price: '10', description: 'Instant delivery.', emoji: '💎' });
  return { guild, product, seller: member(guild, ['member', 'seller']) };
}

/** Buy → order form → ticket (payment '0' = PaysafeCard, '1' = Crypto). */
async function order(guild, buyer, product, { quantity = '1', payment = '0' } = {}) {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity }, selects: { payment: [payment] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).sort((a, b) => b.number - a.number)[0];
  return { ticket, channel: guild.channels.cache.get(ticket.channelId) };
}

/** A Purchase ticket like older versions made them: form answers only, no ticket.order. */
async function legacyOrder(guild, buyer, { payment = 'PaysafeCard' } = {}) {
  const type = config.getType('order');
  const answers = type.questions.map((q) => ({ label: q.label, value: { product: 'Spotify Premium', quantity: '2', payment, notes: '' }[q.id] }));
  const channel = await t.openTicket(buyer, type, answers);
  return { ticket: db.getTicket(channel.id), channel };
}

const pay = (guild, who, channel, { fields = {}, uploads = {} } = {}) => run({ guild, member: who, kind: 'modal', customId: 'pay:submit', fields, uploads, channel });
const card = (channel) => channel.messageList.find((m) => m.id === db.getTicket(channel.id).controlMessageId);
const logChannel = (guild) => guild.channels.cache.get(db.settings(guild.id).logChannelId);
const json = (payload) => JSON.stringify(payload.components.map((c) => c.toJSON?.() ?? c));
/** Lets the cooldown pass: the last payment was sent 2 minutes ago. */
const cool = (channel) => {
  db.getTicket(channel.id).order.payment.at -= 2 * 60_000;
};

// ───────────── Button and form ─────────────

test('"I\'ve paid" sits on the order card while the payment is awaited – only the ticket owner can use it', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { ticket, channel } = await order(guild, buyer, product, { quantity: '2' });
  const first = card(channel);
  assert.ok(customIds(first.body).includes('pay:open'));
  assert.match(textOf(first.body), /Paid already\?\*\* Click \*\*I've paid\*\* and send your PaysafeCard PIN, a screenshot or the transaction ID/);
  assert.match(textOf(first.body), /\*\*Order:\*\* ⏳ Awaiting payment/);

  // Other tickets have no such button
  const support = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  assert.ok(!customIds(card(support).body).includes('pay:open'));

  // Someone else (a stranger who got in, or staff) gets an explanation
  for (const who of [member(guild), seller]) {
    const denied = await run({ guild, member: who, kind: 'button', customId: 'pay:open', channel });
    assert.match(textOf(lastResponse(denied)), new RegExp(`Only <@${buyer.id}> can send the payment for this order`));
    assert.equal(denied.state.modals.length, 0);
  }

  const click = await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel });
  const form = click.state.modals[0];
  assert.equal(form.custom_id, 'pay:submit');
  assert.equal(form.title, `💳 I've paid · order #${String(ticket.number).padStart(4, '0')}`);
  assert.ok(form.components.length <= 5);
  assert.match(form.components[0].content, /\*\*Nitro Boost\*\* × 2 · PaysafeCard · Total \*\*20€\*\*/);
  assert.deepEqual(form.components.slice(1).map((c) => [c.label, c.component.type, c.component.custom_id, c.component.required]), [
    ['PaysafeCard PIN(s)', 4, 'pins', false],
    ['Screenshots', 19, 'files', false],
    ['Note or transaction ID', 4, 'note', false],
  ]);
  assert.equal(form.components[2].component.max_values, 5);

  // Crypto orders: no PIN field
  const cryptoBuyer = member(guild);
  const crypto = await order(guild, cryptoBuyer, product, { payment: '1' });
  const cryptoForm = (await run({ guild, member: cryptoBuyer, kind: 'button', customId: 'pay:open', channel: crypto.channel })).state.modals[0];
  assert.deepEqual(cryptoForm.components.slice(1).map((c) => c.component.custom_id), ['files', 'note']);
  assert.match(textOf(card(crypto.channel).body), /send a screenshot or the transaction ID/);

  // Turned off: no button, and old buttons explain it
  config.orders.paymentProofs = false;
  try {
    await t.refreshControlMessage(channel, db.getTicket(channel.id));
    assert.ok(!customIds(card(channel).body).includes('pay:open'));
    const off = await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel });
    assert.match(textOf(lastResponse(off)), /write your payment details in the ticket/);
  } finally {
    config.orders.paymentProofs = true;
  }
});

test('"I\'ve paid": PINs are checked, and at least one field is needed', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);

  const empty = await pay(guild, buyer, channel, { fields: { pins: '  ', note: '' } });
  assert.match(textOf(lastResponse(empty)), /Fill in at least one field: your PaysafeCard PIN, a screenshot or a note/);
  const short = await pay(guild, buyer, channel, { fields: { pins: '1234-5678', note: '' } });
  assert.match(textOf(lastResponse(short)), /`1234-5678` is not a PaysafeCard PIN – a PIN has 16 digits/);
  const letters = await pay(guild, buyer, channel, { fields: { pins: '1234-5678-9012-345X' } });
  assert.match(textOf(lastResponse(letters)), /is not a PaysafeCard PIN/);
  const many = Array.from({ length: 11 }, (_, i) => String(1000000000000000 + i)).join(', ');
  const tooMany = await pay(guild, buyer, channel, { fields: { pins: many } });
  assert.match(textOf(lastResponse(tooMany)), /That's 11 PINs – you can send up to 10/);
  assert.equal(db.getTicket(channel.id).order.payment, undefined, 'nothing was saved');
  assert.equal(db.getTicket(channel.id).order.status, undefined);

  // Accepted: dashes, spaces inside a PIN, commas, new lines, two PINs separated by a space, duplicates once
  assert.deepEqual(payments.parsePins('1234-5678-9012-3456'), { pins: ['1234567890123456'], bad: null });
  assert.deepEqual(payments.parsePins('1234 5678 9012 3456,\n1111222233334444; 1234567890123456'), { pins: ['1234567890123456', '1111222233334444'], bad: null });
  assert.deepEqual(payments.parsePins('1111222233334444 5555666677778888'), { pins: ['1111222233334444', '5555666677778888'], bad: null });
  assert.equal(payments.parsePins('1111222233334444 5555').bad, '1111222233334444 5555');
  assert.deepEqual(payments.parsePins(''), { pins: [], bad: null });
  assert.equal(payments.maskPin('1234567890123456'), '••••-••••-••••-3456');
  assert.equal(payments.maskText('PIN 1234 5678 9012 3456 and 1111-2222-3333-4444 ok'), 'PIN ••••-••••-••••-3456 and ••••-••••-••••-4444 ok');
});

test('"I\'ve paid": PINs in spoilers, status "sent", staff pinged, the log never shows the PINs, re-sending after the cooldown', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { ticket, channel } = await order(guild, buyer, product);
  const before = channel.messageList.length;

  const done = await pay(guild, buyer, channel, { fields: { pins: '1234-5678-9012-3456\n1111 2222 3333 4444', note: 'Bought at the kiosk, spare: 9999888877776666' } });
  assert.match(textOf(lastResponse(done)), /Thanks! Your payment was sent to the seller/);
  const saved = db.getTicket(channel.id).order;
  assert.equal(saved.status, 'sent');
  assert.equal(saved.product, 'Nitro Boost', 'the shop order is kept');
  assert.equal(saved.total, 10);
  assert.deepEqual(saved.payment.pins, ['1234567890123456', '1111222233334444']);
  assert.equal(saved.payment.method, 'PaysafeCard');
  assert.equal(saved.payment.note, 'Bought at the kiosk, spare: 9999888877776666');
  assert.deepEqual(saved.payment.files, []);
  assert.ok(Math.abs(saved.payment.at - Date.now()) < 5000);
  assert.deepEqual({ ...saved.history.at(-1), at: 0 }, { status: 'sent', at: 0, by: buyer.id });

  // The card in the ticket: PINs in spoilers, the order staff roles pinged (nobody has claimed it)
  assert.equal(channel.messageList.length, before + 1);
  const posted = channel.messageList.at(-1);
  const out = textOf(posted.body);
  assert.match(out, /## 📨 Payment sent\n/);
  assert.ok(out.includes('||1234-5678-9012-3456|| · ||1111-2222-3333-4444||'));
  assert.match(out, /\*\*Method:\*\* PaysafeCard/);
  assert.match(out, /> Bought at the kiosk/);
  // Only the sellers (the Purchase type's own role) – not every staff role
  const roles = [role(guild, 'seller')];
  assert.deepEqual(posted.body.allowedMentions, { users: [], roles });
  assert.ok(!out.includes(`<@&${role(guild, 'admin')}>`) && !out.includes(`<@&${role(guild, 'support')}>`));
  assert.ok(out.includes(`<@&${role(guild, 'seller')}>`));
  assert.equal(saved.payment.messageId, posted.id);

  // The order card shows it, the ticket waits for the team now
  assert.match(textOf(card(channel).body), /\*\*Order:\*\* 📨 Payment sent – being checked/);
  assert.match(textOf(card(channel).body), /Payment sent <t:\d+:R>\*\* – a seller is checking it/);
  assert.equal(db.getTicket(channel.id).lastMessageBy, 'owner');

  // The log: masked PINs, also inside the note
  const log = logChannel(guild).messageList.at(-1);
  const logText = textOf(log.body);
  assert.match(logText, /📨 Payment sent/);
  assert.ok(logText.includes('••••-••••-••••-3456') && logText.includes('••••-••••-••••-4444') && logText.includes('••••-••••-••••-6666'));
  const raw = JSON.stringify(log.body);
  for (const secret of ['1234567890123456', '1234-5678-9012-3456', '1111 2222 3333 4444', '1111222233334444', '9999888877776666', '5678']) {
    assert.ok(!raw.includes(secret), `the log must not contain ${secret}`);
  }

  // Again right away → cooldown
  const soon = await pay(guild, buyer, channel, { fields: { pins: '1234-5678-9012-3457' } });
  assert.match(textOf(lastResponse(soon)), /You've just sent your payment\. You can send a correction <t:\d+:R>/);
  const soonButton = await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel });
  assert.match(textOf(lastResponse(soonButton)), /You've just sent your payment/);

  // A corrected PIN after the cooldown: a seller has claimed it now – only they are pinged
  // (re-sends ping only after the Call support cooldown – see orders-review.test.js)
  cool(channel);
  db.getTicket(channel.id).lastStaffPing -= 31 * 60_000;
  await t.claimTicket(channel, seller);
  await pay(guild, buyer, channel, { fields: { pins: '1234567890123457' } });
  const again = channel.messageList.at(-1);
  assert.match(textOf(again.body), /## 📨 Payment sent again/);
  assert.match(textOf(again.body), new RegExp(`<@${seller.id}>, please check it`));
  assert.deepEqual(again.body.allowedMentions, { users: [seller.id], roles: [] });
  assert.deepEqual(db.getTicket(channel.id).order.payment.pins, ['1234567890123457']);
  assert.deepEqual(db.getTicket(channel.id).order.history.map((h) => h.status), ['sent', 'sent']);
  assert.match(textOf(logChannel(guild).messageList.at(-1).body), /Payment sent again/);

  // Set back to "Awaiting payment" (e.g. a wrong PIN): the card asks for the payment again
  await orderstatus.setStatus(channel, 'awaiting', seller);
  assert.match(textOf(card(channel).body), /Paid already\?\*\* Click \*\*I've paid\*\*/);
  assert.ok(customIds(card(channel).body).includes('pay:open'));

  // Once the seller confirms it, the button is gone
  await orderstatus.setStatus(channel, 'paid', seller);
  assert.ok(!customIds(card(channel).body).includes('pay:open'));
  const late = await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel });
  assert.match(textOf(lastResponse(late)), /already confirmed \(💳 Paid\)/);
  assert.equal(ticket.number, db.getTicket(channel.id).number);
});

test('"I\'ve paid": screenshots are downloaded and uploaded again with the card – too big files keep their link', async () => {
  const { guild, product } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product, { payment: '1' }); // Crypto: no PIN field
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(url);
    if (url.includes('/proof.png')) return { ok: true, headers: new Map([['content-length', String(PNG.length)]]), arrayBuffer: async () => PNG.buffer.slice(0) };
    if (url.includes('/receipt.pdf')) return { ok: true, headers: new Map(), arrayBuffer: async () => Buffer.from('%PDF-1.4 receipt').buffer };
    if (url.includes('/gone.png')) return { ok: false, status: 404 };
    throw new Error(`unexpected download ${url}`);
  };
  const cdn = (name) => `https://cdn.discordapp.com/ephemeral-attachments/1/2/${name}?ex=1`;
  try {
    const done = await pay(guild, buyer, channel, {
      fields: { note: 'tx 0xabc' },
      uploads: {
        files: [
          { name: 'proof.png', url: cdn('proof.png'), size: 2000, contentType: 'image/png' },
          { name: 'receipt.pdf', url: cdn('receipt.pdf'), size: 3000, contentType: 'application/pdf' },
          { name: 'huge.png', url: cdn('huge.png'), size: 20 * MB, contentType: 'image/png' },
          { name: 'gone.png', url: cdn('gone.png'), size: 1000, contentType: 'image/png' },
        ],
      },
    });
    assert.match(textOf(lastResponse(done)), /Thanks!/);
  } finally {
    global.fetch = realFetch;
  }
  assert.deepEqual(fetched.map((u) => u.split('/').pop()), ['proof.png?ex=1', 'receipt.pdf?ex=1', 'gone.png?ex=1'], 'the 20 MB file is never downloaded');

  const posted = channel.messageList.at(-1);
  assert.deepEqual(posted.files.map((f) => f.name), ['payment-1-proof.png', 'payment-2-receipt.pdf']);
  const components = json(posted.body);
  assert.ok(components.includes('attachment://payment-1-proof.png'), 'the picture is shown in a gallery');
  assert.ok(components.includes('"type":13') && components.includes('attachment://payment-2-receipt.pdf'), 'other files as a file component');
  assert.match(textOf(posted.body), /\*\*Screenshots:\*\* 4/);
  assert.match(textOf(posted.body), /Too big to keep \(the link expires\): \[payment-3-huge\.png\]\(.*huge\.png\?ex=1\), \[payment-4-gone\.png\]/);
  assert.ok(!textOf(posted.body).includes('PIN'));

  // Stored: the copies' links (they belong to the ticket message), the rest keeps the original link
  const files = db.getTicket(channel.id).order.payment.files;
  assert.deepEqual(files, [
    { name: 'payment-1-proof.png', url: `https://cdn.discordapp.com/attachments/${channel.id}/${posted.id}/payment-1-proof.png` },
    { name: 'payment-2-receipt.pdf', url: `https://cdn.discordapp.com/attachments/${channel.id}/${posted.id}/payment-2-receipt.pdf` },
    { name: 'payment-3-huge.png', url: cdn('huge.png') },
    { name: 'payment-4-gone.png', url: cdn('gone.png') },
  ]);
  assert.deepEqual(db.getTicket(channel.id).order.payment.pins, []);
  assert.match(textOf(logChannel(guild).messageList.at(-1).body), /Screenshots 4 – in the ticket/);

  // A screenshot alone is enough
  const other = member(guild);
  const o2 = await order(guild, other, product, { payment: '1' });
  global.fetch = async () => ({ ok: true, headers: new Map(), arrayBuffer: async () => PNG.buffer.slice(0) });
  try {
    await pay(guild, other, o2.channel, { uploads: { files: [{ name: 'only.png', url: cdn('only.png') }] } });
  } finally {
    global.fetch = realFetch;
  }
  assert.equal(db.getTicket(o2.channel.id).order.status, 'sent');
  assert.equal(o2.channel.messageList.at(-1).files.length, 1);
});

test('"I\'ve paid" on an order ticket from an older version (no ticket.order) keeps its product and quantity', async () => {
  const { guild, seller } = await shopGuild();
  const buyer = member(guild);
  const { ticket, channel } = await legacyOrder(guild, buyer);
  assert.equal(ticket.order, undefined);
  assert.ok(customIds(card(channel).body).includes('pay:open'));
  const form = (await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel })).state.modals[0];
  assert.match(form.components[0].content, /\*\*Spotify Premium\*\* × 2 · PaysafeCard/);
  assert.ok(form.components.some((c) => c.component?.custom_id === 'pins'));

  await pay(guild, buyer, channel, { fields: { pins: '1234-5678-9012-3456' } });
  const saved = db.getTicket(channel.id).order;
  assert.deepEqual([saved.product, saved.quantity, saved.method, saved.status], ['Spotify Premium', 2, 'PaysafeCard', 'sent']);
  assert.deepEqual(saved.payment.pins, ['1234567890123456']);
  const details = t.orderDetails(db.getTicket(channel.id));
  assert.deepEqual([details.product, details.quantity], ['Spotify Premium', 2]);

  // Completing it later still records the right product
  await run({ guild, member: seller, kind: 'modal', customId: 'order:complete', fields: { amount: '12' }, channel });
  const sale = db.sales(guild.id).at(-1);
  assert.deepEqual([sale.product, sale.quantity, sale.method, sale.amount], ['Spotify Premium', 2, 'PaysafeCard', 12]);

  // An unknown method (no answer) also asks for PINs; PayPal does not
  const paypal = await legacyOrder(guild, member(guild), { payment: 'PayPal' });
  const paypalForm = (await run({ guild, member: guild.members.cache.get(paypal.ticket.ownerId), kind: 'button', customId: 'pay:open', channel: paypal.channel })).state.modals[0];
  assert.ok(!paypalForm.components.some((c) => c.component?.custom_id === 'pins'));
});

test('a closed or completed order takes no payment', async () => {
  const { guild, product, seller } = await shopGuild();
  const buyer = member(guild);
  const { channel } = await order(guild, buyer, product);
  await t.completeOrder(channel, seller, { amount: 10 });
  const completed = await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel });
  assert.match(textOf(lastResponse(completed)), /already completed/);
  const late = await pay(guild, buyer, channel, { fields: { note: 'paid' } });
  assert.match(textOf(lastResponse(late)), /already completed/);

  const second = await order(guild, buyer, product);
  await t.closeTicket(second.channel, seller);
  const closed = await run({ guild, member: buyer, kind: 'button', customId: 'pay:open', channel: second.channel });
  assert.match(textOf(lastResponse(closed)), /This ticket is closed/);
  assert.match(textOf(card(second.channel).body), /\*\*Order:\*\* ❌ Cancelled/);
});

test('the payment form and card stay within Discord limits', async () => {
  const guild = new FakeGuild({ name: 'G'.repeat(100) });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const ticket = { number: 9999, ownerId: '2', typeId: 'order', order: { product: 'P'.repeat(100), quantity: 999, method: 'PaysafeCard'.repeat(10), total: 99999.99 } };
  validateModal(payments.paymentModal(ticket), guild);
  validateModal(payments.paymentModal({ number: 1, typeId: 'order', answers: [] }), guild);
  const files = Array.from({ length: 5 }, (_, i) => ({ name: `payment-${i + 1}-${'x'.repeat(60)}`, url: `https://cdn.discordapp.com/${'y'.repeat(200)}`, image: i < 3, buffer: i % 2 ? null : Buffer.from(PNG) }));
  const payment = { at: Date.now(), method: 'M'.repeat(200), note: 'N'.repeat(500), pins: Array.from({ length: 10 }, (_, i) => String(1000000000000000 + i)) };
  validateMessage(payments.paymentCard(ticket, { payment, files, pings: { users: [], roles: ['1'.repeat(19), '2'.repeat(19)] }, again: true }), guild);
});
