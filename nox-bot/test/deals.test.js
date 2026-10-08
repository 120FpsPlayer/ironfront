'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hours = require('../src/lib/hours');
const shop = require('../src/features/shop');
const flash = require('../src/features/flashsales');
const deals = require('../src/features/deals');

const commands = loadCommands();

let n = 935000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function shopGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const nitro = shop.addProduct(guild, { name: 'Nitro', price: '20', description: 'Instant delivery.', emoji: '💎' });
  const netflix = shop.addProduct(guild, { name: 'Netflix', price: '5', description: 'Premium.' });
  shop.setVariants(guild, netflix.id, '1 month = 5, 3 months = 12');
  // Not eligible: a text price, sold out, already on sale.
  const logo = shop.addProduct(guild, { name: 'Custom Logo', price: 'from 5€', description: 'Made for you.' });
  const gone = shop.addProduct(guild, { name: 'Spotify', price: '3', description: 'Sold out.' });
  await shop.setStock(guild, gone.id, 'out');
  const onSale = shop.addProduct(guild, { name: 'Disney+', price: '4', description: 'On sale.' });
  flash.startSale(guild, onSale.id, { percent: 10, durationMs: 5 * DAY });
  return { guild, eligible: [nitro.id, netflix.id], notEligible: [logo.id, gone.id, onSale.id], seller: member(guild, ['member', 'seller']) };
}

const sale = async (guild, who, options = {}) => {
  const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'sale', subcommand: 'deal', options });
  await handle(i, commands);
  return textOf(lastResponse(i));
};
const restocks = (guild) => guild.channels.cache.get(db.channelId(guild.id, 'restocks')).messageList;
const stopAll = (guild) => {
  for (const p of shop.products(guild.id)) if (p.sale?.deal) flash.stopSale(guild, p.id);
};

test('the week plan: 1–2 days per ISO week, each at a random minute inside the opening hours – stored, never re-rolled', () => {
  const wh = config.workingHours;
  const counts = new Set();
  for (let w = 0; w < 80; w += 1) {
    const monday = hours.wallTime(2026, 1, 5 + w * 7, 0, wh.timezone ?? 'UTC').getTime(); // Monday 00:00 in the shop's zone – the whole week ahead
    const week = deals.weekOf(monday + 3 * HOUR);
    const plan = deals.rollWeek(monday);
    assert.equal(plan.week, week.key);
    assert.ok(plan.days.length >= 1 && plan.days.length <= 2, `${plan.days.length} days`);
    assert.equal(new Set(plan.days).size, plan.days.length);
    counts.add(plan.days.length);
    for (const day of plan.days) {
      const info = week.days.find((d) => d.key === day);
      assert.ok(info, `${day} is in ${week.key}`);
      const slot = plan.slots[day];
      assert.equal(slot.state, 'planned');
      assert.equal(slot.at % 60_000, 0);
      if (wh.enabled) assert.ok(hours.inHours(wh, new Date(slot.at)), `${new Date(slot.at).toISOString()} inside the opening hours`);
      const z = hours.zoned(new Date(slot.at), wh.timezone ?? 'UTC');
      assert.equal(`${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}`, day);
    }
  }
  assert.deepEqual([...counts].sort(), [1, 2], 'both 1 and 2 days happen');
  assert.equal(deals.weekOf(Date.UTC(2026, 9, 8, 12)).key, '2026-W41');
  assert.equal(deals.weekOf(Date.UTC(2027, 0, 1, 12)).key, '2026-W53');

  // Stored per server: the same plan every time, also after a restart (the data is re-read from db.json).
  const guildId = uid();
  const now = Date.UTC(2026, 9, 5, 6); // Monday morning
  const first = JSON.parse(JSON.stringify(deals.plan(guildId, now)));
  for (let i = 0; i < 20; i += 1) assert.deepEqual(JSON.parse(JSON.stringify(deals.plan(guildId, now + i * HOUR))), first);
  db.guild(guildId).deals = JSON.parse(JSON.stringify(db.guild(guildId).deals)); // "restart"
  assert.deepEqual(JSON.parse(JSON.stringify(deals.plan(guildId, now + DAY))), first);
  assert.notEqual(deals.plan(guildId, now + 7 * DAY).week, first.week, 'a new week rolls a new plan');

  // Rolled mid-week: only days still ahead.
  const thursday = Date.UTC(2026, 9, 8, 15);
  const late = deals.rollWeek(thursday);
  for (const day of late.days) {
    assert.ok(day >= '2026-10-08', day);
    assert.ok(late.slots[day].at >= thursday);
  }
});

test('a deal: one eligible product (number price, in stock, not on sale), 25–50% off for 24h, announced as 🔥 Deal of the week – one at a time', async () => {
  const { guild, eligible, notEligible } = await shopGuild();
  const percents = new Set();
  for (let i = 0; i < 25; i += 1) {
    const before = Date.now();
    const { product, percent, announced } = await deals.startDeal(guild);
    assert.ok(eligible.includes(product.id), product.name);
    assert.ok(percent >= 25 && percent <= 50, `${percent}%`);
    percents.add(percent);
    assert.equal(product.sale.percent, percent);
    assert.equal(product.sale.deal, true);
    assert.ok(Math.abs(product.sale.endsAt - before - DAY) < 5_000, '24 hours');
    assert.equal(announced, true);
    // Never two at once.
    await assert.rejects(() => deals.startDeal(guild), /A deal is already running: \*\*.+\*\* −\d+% – only one at a time/);
    stopAll(guild);
  }
  assert.ok(percents.size > 3, 'random percents');
  for (const id of notEligible) assert.notEqual(shop.products(guild.id).find((p) => p.id === id).sale?.deal, true);

  const post = restocks(guild).at(-1).body;
  validateMessage(post, guild);
  assert.match(textOf(post), /## 🔥 Deal of the week: .+ −\d+%/);

  // Never above 50%, even when config.json asks for more.
  const saved = { ...config.deals };
  Object.assign(config.deals, { minPercent: 60, maxPercent: 90, hours: 2 });
  try {
    const { product, percent } = await deals.startDeal(guild, { announce: false });
    assert.equal(percent, 50);
    assert.ok(product.sale.endsAt - Date.now() <= 2 * HOUR);
    stopAll(guild);
  } finally {
    Object.assign(config.deals, saved);
  }

  // Nothing eligible → refused.
  for (const id of eligible) await shop.setStock(guild, id, 'out');
  await assert.rejects(() => deals.startDeal(guild), /No product can be the deal right now/);
});

test('the timer starts the planned deal once at its time, waits for a running deal, skips when nothing is eligible, marks passed days missed', async () => {
  const { guild, eligible } = await shopGuild();
  const now = Date.now();
  const today = deals.weekOf(now);
  const g = db.guild(guild.id);
  const setPlan = (slots) => Object.assign(g.deals, { week: today.key, days: Object.keys(slots), slots });

  setPlan({ [today.today]: { at: now + HOUR, until: now + 3 * HOUR, state: 'planned' } });
  assert.equal(await deals.tickGuild(guild, now), null, 'not yet');
  const started = await deals.tickGuild(guild, now + HOUR + 1);
  assert.ok(started && eligible.includes(started.product.id));
  assert.deepEqual(g.deals.slots[today.today], { at: now + HOUR, until: now + 3 * HOUR, state: 'started', productId: started.product.id, percent: started.percent });
  assert.equal(await deals.tickGuild(guild, now + HOUR + 60_000), null, 'only once');
  assert.equal(shop.products(guild.id).filter((p) => p.sale?.deal).length, 1);

  // A second day whose time comes while the first deal runs waits – and is missed if its window passes.
  setPlan({ [today.today]: { at: now, until: now + 2 * HOUR, state: 'planned' } });
  assert.equal(await deals.tickGuild(guild, now + HOUR + 2), null);
  assert.equal(g.deals.slots[today.today].state, 'planned');
  assert.equal(await deals.tickGuild(guild, now + 2 * HOUR), null);
  assert.equal(g.deals.slots[today.today].state, 'missed');

  // The deal ended (stopped by staff) → the next one can start; nothing eligible → skipped.
  stopAll(guild);
  for (const id of eligible) await shop.setStock(guild, id, 'out');
  setPlan({ [today.today]: { at: now, until: now + 2 * HOUR, state: 'planned' } });
  assert.equal(await deals.tickGuild(guild, now + 1), null);
  assert.equal(g.deals.slots[today.today].state, 'skipped');

  // Turned off / server unavailable → nothing runs.
  for (const id of eligible) await shop.setStock(guild, id, 'in');
  setPlan({ [today.today]: { at: now, until: now + 2 * HOUR, state: 'planned' } });
  config.deals.enabled = false;
  try {
    assert.equal(await deals.tick(guild.client, now + 1), 0);
  } finally {
    config.deals.enabled = true;
  }
  guild.available = false;
  try {
    assert.equal(await deals.tick(guild.client, now + 1), 0);
  } finally {
    guild.available = true;
  }
  assert.equal(await deals.tick(guild.client, now + 1), 1);
});

test('/sale deal: the week plan for staff; now:true starts one (only one at a time)', async () => {
  const { guild, seller } = await shopGuild();
  assert.match(await sale(guild, member(guild)), /Only administrators and sellers can run flash sales/);

  const plan = await sale(guild, seller);
  assert.match(plan, /🔥 Deal of the week/);
  assert.match(plan, /This week \(\d{4}-W\d{2}\):\*\* (\d deals?|no deal days left)/);
  assert.match(plan, /25–50% off for 24h on a random product/);

  const started = await sale(guild, seller, { now: true });
  assert.match(started, /🔥 (Nitro|Netflix) is the deal of the week[\s\S]*\*\*−\d+%\*\* · ends <t:\d+:R>[\s\S]*Deal announced in #restocks/);
  assert.match(textOf(restocks(guild).at(-1).body), /🔥 Deal of the week: /);
  assert.match(await sale(guild, seller), /🔥 \*\*Running now:\*\* \*\*(Nitro|Netflix)\*\* · \*\*−\d+%\*\*/);
  assert.match(await sale(guild, seller, { now: true }), /A deal is already running/);
  const log = textOf(guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1).body);
  assert.match(log, /Deal of the week started/);
});
