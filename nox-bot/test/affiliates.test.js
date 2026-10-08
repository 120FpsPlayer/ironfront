'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const shop = require('../src/features/shop');
const promos = require('../src/features/promos');
const affiliates = require('../src/features/affiliates');
const t = require('../src/tickets/tickets');

const commands = require('../src/commands')();
config.defaults.openCooldownSeconds = 0;

let n = 996000000000000000n;
const uid = () => String(++n);
const member = (guild, roles = ['member'], opts = {}) => guild.addMember(uid(), roles.map((k) => db.roleId(guild.id, k)), opts);
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const METHOD = String(config.shop.paymentMethods.findIndex((m) => m.type === 'paysafecard'));
const aff = (guild, who, subcommand, options = {}) => run({ guild, member: who, kind: 'command', commandName: 'affiliate', subcommand, options });

let guild;
let product;
let seller;
let creator;
test.before(async () => {
  guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  product = shop.addProduct(guild, { name: 'Spotify Premium', price: '12', description: '12 months.' });
  seller = member(guild, ['member', 'seller']);
  creator = member(guild);
});

/** Places an order (quantity 2 → 24€) with a promo code → { channel, ticket() }. */
async function order(buyer, promo = '') {
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '2', promo }, selects: { payment: [METHOD] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id).at(-1);
  return { channel: guild.channels.cache.get(ticket.channelId), ticket: () => db.getTicket(ticket.channelId) };
}

const dmsTo = (user, re) => guild.dms.filter((d) => d.to === user.id && re.test(textOf(d.payload)));
const entry = (code) => affiliates.list(guild.id).find((a) => a.code === code);

test('/affiliate create: admins & sellers only, defaults from config, a real member, the creator gets a DM', async () => {
  const buyer = member(guild);
  const denied = await aff(guild, buyer, 'create', { user: creator.user, code: 'NOX-HACK' });
  assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);
  assert.equal(promos.find(guild.id, 'NOX-HACK'), null);

  const robot = member(guild, [], { bot: true });
  assert.match(textOf(lastResponse(await aff(guild, seller, 'create', { user: robot.user, code: 'NOX-BOT' }))), /Bots can't be creators/);

  const made = await aff(guild, seller, 'create', { user: creator.user, code: 'nox-alex' });
  assert.match(textOf(lastResponse(made)), /Creator code NOX-ALEX created[\s\S]*5% off[\s\S]*10%/);
  const p = promos.find(guild.id, 'NOX-ALEX');
  assert.deepEqual(p.affiliate, { userId: creator.id, commission: 10 });
  assert.equal(p.percent, 5);
  assert.equal(p.oncePerUser, false, 'everyone, every time');
  assert.equal(p.userId, null, 'not a personal code');
  assert.deepEqual({ ...entry('NOX-ALEX'), createdAt: 0 }, { code: 'NOX-ALEX', userId: creator.id, discount: 5, commission: 10, createdAt: 0, createdBy: seller.id, earned: 0, paidOut: 0, sales: [], payouts: [] });
  assert.equal(dmsTo(creator, /You have a creator code[\s\S]*NOX-ALEX/).length, 1);

  const twice = await aff(guild, seller, 'create', { user: creator.user, code: 'NOX-ALEX' });
  assert.match(textOf(lastResponse(twice)), /already exists/);
  const list = await aff(guild, seller, 'list');
  assert.match(textOf(lastResponse(list)), new RegExp(`NOX-ALEX\` · <@${creator.id}> · 5% off · 10% commission · 0 sales`));
  const promoList = await run({ guild, member: seller, kind: 'command', commandName: 'promo', subcommand: 'list' });
  assert.match(textOf(lastResponse(promoList)), /NOX-ALEX[\s\S]*creator code of/);
});

test('a buyer gets the discount; the order remembers the creator; the creator cannot use their own code', async () => {
  const buyer = member(guild);
  const { channel, ticket } = await order(buyer, 'nox-alex');
  assert.equal(ticket().order.promo, 'NOX-ALEX');
  assert.equal(ticket().order.discount, 1.2);
  assert.equal(ticket().order.total, 22.8);
  assert.deepEqual(ticket().order.affiliate, { code: 'NOX-ALEX', userId: creator.id, commission: 10 });
  const stats = textOf(lastResponse(await aff(guild, creator, 'stats')));
  assert.match(stats, /Uses 1 \(1 in open order\)/);
  await t.closeTicket(channel, seller);

  const own = await order(creator, 'NOX-ALEX');
  assert.equal(own.ticket().order.promo, null);
  assert.equal(own.ticket().order.total, 24);
  assert.match(own.ticket().answers.find((a) => a.label === 'Price').value, /not applied: This is your own creator code/);
  await t.closeTicket(own.channel, seller);

  // The same buyer can use it again (another open order holds no limit).
  const again = await order(buyer, 'NOX-ALEX');
  assert.equal(again.ticket().order.promo, 'NOX-ALEX');
  await t.closeTicket(again.channel, seller);
});

test('commission: recorded once per completed sale, rounded to cents, and the creator gets a DM', async () => {
  const buyer = member(guild);
  const { channel } = await order(buyer, 'NOX-ALEX');
  const before = entry('NOX-ALEX').earned;
  const { sale } = await t.completeOrder(channel, seller);
  assert.equal(sale.amount, 22.8);
  const e = entry('NOX-ALEX');
  assert.equal(e.earned, Math.round((before + 2.28) * 100) / 100);
  assert.deepEqual(
    e.sales.filter((s) => s.saleId === sale.id).map(({ at, ...s }) => s),
    [{ saleId: sale.id, ticketNumber: sale.ticketNumber, buyerId: buyer.id, amount: 22.8, commission: 2.28 }],
  );
  assert.equal(dmsTo(creator, /You earned \*\*2\.28€\*\* from a sale with your code \*\*NOX-ALEX\*\*/).length, 1);

  // The same sale again (a retried hook) changes nothing.
  await hooks.emit('orderCompleted', { guild, ticket: db.getTicket(channel.id), member: null, staff: seller, sale });
  assert.equal(entry('NOX-ALEX').sales.filter((s) => s.saleId === sale.id).length, 1);
  assert.equal(entry('NOX-ALEX').earned, e.earned);
  assert.equal(dmsTo(creator, /You earned/).length, 1);

  // An odd amount is rounded to cents: 13.37 × 10% = 1.337 → 1.34.
  const other = member(guild);
  const second = await order(other, 'NOX-ALEX');
  const res = await t.completeOrder(second.channel, seller, { amount: 13.37 });
  assert.equal(entry('NOX-ALEX').sales.find((s) => s.saleId === res.sale.id).commission, 1.34);
  // An unknown amount earns nothing automatically (no DM), but the sale is counted.
  const third = await order(member(guild), 'NOX-ALEX');
  const unknown = await t.completeOrder(third.channel, seller, { amount: null });
  assert.equal(entry('NOX-ALEX').sales.find((s) => s.saleId === unknown.sale.id).commission, 0);
  assert.equal(dmsTo(creator, /You earned/).length, 2);
});

test('/affiliate stats and payout: own stats for creators, any creator for staff; payout clears what is owed', async () => {
  const stranger = member(guild);
  const none = await aff(guild, stranger, 'stats');
  assert.match(textOf(lastResponse(none)), /You don't have a creator code/);
  const peek = await aff(guild, stranger, 'stats', { user: creator.user });
  assert.match(textOf(lastResponse(peek)), /only see your own/);

  const mine = await aff(guild, creator, 'stats');
  const text = textOf(lastResponse(mine));
  assert.match(text, /NOX-ALEX/);
  assert.match(text, /Sales 3/);
  assert.match(text, /Revenue 36\.17€/); // 22.8 + 13.37 + unknown
  assert.match(text, /Commission earned 3\.62€/);
  assert.match(text, /Paid out 0€/);
  assert.match(text, /Owed \*\*3\.62€\*\*/);
  const staffView = await aff(guild, seller, 'stats', { user: creator.user });
  assert.match(textOf(lastResponse(staffView)), /Owed \*\*3\.62€\*\*/);

  const denied = await aff(guild, creator, 'payout', { user: creator.user });
  assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);
  const paid = await aff(guild, seller, 'payout', { user: creator.user });
  assert.match(textOf(lastResponse(paid)), /Marked \*\*3\.62€\*\* as paid out/);
  assert.equal(entry('NOX-ALEX').paidOut, 3.62);
  assert.equal(entry('NOX-ALEX').payouts.length, 1);
  assert.equal(dmsTo(creator, /Commission paid out[\s\S]*3\.62€/).length, 1);
  const after = textOf(lastResponse(await aff(guild, creator, 'stats')));
  assert.match(after, /Paid out 3\.62€/);
  assert.match(after, /Owed \*\*0€\*\*/);
  const nothing = await aff(guild, seller, 'payout', { user: creator.user });
  assert.match(textOf(lastResponse(nothing)), /Nothing is owed/);
  const noCreator = await aff(guild, seller, 'payout', { user: stranger.user });
  assert.match(textOf(lastResponse(noCreator)), /has no creator code/);
});

test('a removed code: new orders cannot use it, open orders keep the discount and the creator still earns', async () => {
  const holder = member(guild);
  const open = await order(holder, 'NOX-ALEX');
  assert.equal(open.ticket().order.promo, 'NOX-ALEX');

  const auto = createInteraction({ guild, member: seller, kind: 'autocomplete', commandName: 'affiliate', focused: 'alex' });
  await commands.get('affiliate').autocomplete(auto);
  assert.equal(auto.state.responded[0].value, 'NOX-ALEX');

  const removed = await aff(guild, seller, 'remove', { code: 'nox-alex' });
  assert.match(textOf(lastResponse(removed)), /Removed the creator code \*\*NOX-ALEX\*\*[\s\S]*1 open order keeps its discount/);
  assert.equal(promos.find(guild.id, 'NOX-ALEX'), null);
  assert.ok(entry('NOX-ALEX').removedAt);

  const late = await order(member(guild), 'NOX-ALEX');
  assert.equal(late.ticket().order.promo, null);
  assert.match(late.ticket().answers.find((a) => a.label === 'Price').value, /not applied: This code doesn't exist/);

  const earned = entry('NOX-ALEX').earned;
  await t.completeOrder(open.channel, seller);
  assert.equal(entry('NOX-ALEX').earned, Math.round((earned + 2.28) * 100) / 100, 'the open order still earns');
  assert.match(textOf(lastResponse(await aff(guild, seller, 'list'))), /⚫ `NOX-ALEX`[\s\S]*2\.28€ owed[\s\S]*removed/);
  const gone = await aff(guild, seller, 'remove', { code: 'NOX-ALEX' });
  assert.match(textOf(lastResponse(gone)), /no creator code/);
});

test('old promo codes keep working and earn no commission; a creator code deleted with /promo delete still pays orders placed before', async () => {
  promos.create(guild.id, { code: 'SUMMER10', percent: 10 });
  const buyer = member(guild);
  const normal = await order(buyer, 'SUMMER10');
  assert.equal(normal.ticket().order.total, 21.6);
  assert.equal(normal.ticket().order.affiliate, undefined);
  const salesBefore = affiliates.list(guild.id).reduce((k, a) => k + a.sales.length, 0);
  await t.completeOrder(normal.channel, seller);
  assert.equal(affiliates.list(guild.id).reduce((k, a) => k + a.sales.length, 0), salesBefore, 'no commission for a normal code');

  // An order from before the creator's snapshot existed (e.g. placed while the bot was restarting): found by the code's history.
  const maker = member(guild);
  await aff(guild, seller, 'create', { user: maker.user, code: 'NOX-MAYA', discount: 20, commission: 15 });
  const buyer2 = member(guild);
  const placed = await order(buyer2, 'NOX-MAYA');
  assert.equal(placed.ticket().order.total, 19.2);
  const { affiliate, ...withoutSnapshot } = placed.ticket().order;
  assert.ok(affiliate);
  db.updateTicket(placed.channel.id, { order: withoutSnapshot });
  await run({ guild, member: seller, kind: 'command', commandName: 'promo', subcommand: 'delete', options: { code: 'NOX-MAYA' } });
  assert.equal(promos.find(guild.id, 'NOX-MAYA'), null);
  await t.completeOrder(placed.channel, seller);
  assert.equal(entry('NOX-MAYA').earned, 2.88, '15% of 19.20');
  assert.equal(affiliates.isActive(guild.id, entry('NOX-MAYA')), false);

  // Turned off: no new codes, existing ones stop applying – what is owed can still be paid out.
  await aff(guild, seller, 'create', { user: maker.user, code: 'NOX-ZED' });
  config.affiliates.enabled = false;
  try {
    assert.match(textOf(lastResponse(await aff(guild, seller, 'create', { user: maker.user, code: 'NOX-OFF' }))), /turned off/);
    const off = await order(member(guild), 'NOX-ZED');
    assert.equal(off.ticket().order.promo, null);
    assert.match(off.ticket().answers.find((a) => a.label === 'Price').value, /Creator codes are turned off/);
    assert.match(textOf(lastResponse(await aff(guild, seller, 'payout', { user: maker.user }))), /Marked \*\*2\.88€\*\* as paid out/);
  } finally {
    config.affiliates.enabled = true;
  }
});

test('credit(): own orders, balance top-ups and sales without a code earn nothing', () => {
  const g = 'aff-unit-guild';
  const c = 'u-creator';
  promos.create(g, { code: 'UNIT-CODE', percent: 5, oncePerUser: false, affiliate: { userId: c, commission: 10 } });
  const ticket = (extra = {}) => ({ guildId: g, createdAt: Date.now(), order: { promo: 'UNIT-CODE', ...extra } });
  assert.equal(affiliates.credit(g, ticket(), { id: 'S-1', promo: null, userId: 'b', amount: 10 }), null);
  assert.equal(affiliates.credit(g, ticket(), { id: 'S-2', promo: 'UNIT-CODE', userId: c, amount: 10 }), null, 'own order');
  assert.equal(affiliates.credit(g, ticket({ topUp: { amount: 10 } }), { id: 'S-3', promo: 'UNIT-CODE', userId: 'b', amount: 10 }), null, 'top-up');
  const done = affiliates.credit(g, ticket(), { id: 'S-4', promo: 'UNIT-CODE', userId: 'b', amount: 9.99 });
  assert.equal(done.commission, 1);
  assert.equal(done.entry.userId, c, 'a missing entry is made, nothing earned is lost');
  assert.equal(affiliates.credit(g, ticket(), { id: 'S-4', promo: 'UNIT-CODE', userId: 'b', amount: 9.99 }), null, 'once');
  assert.equal(affiliates.owedOf(done.entry), 1);
});
