'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const panels = require('../src/lib/panels');
const shop = require('../src/features/shop');
const badges = require('../src/features/badges');
const flash = require('../src/features/flashsales');

const commands = loadCommands();

let n = 934000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};

async function shopGuild(opts = {}) {
  const guild = new FakeGuild(opts);
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const add = (name) => shop.addProduct(guild, { name, price: '10', description: `${name} – instant delivery.` });
  return { guild, alpha: add('Alpha'), beta: add('Beta'), gamma: add('Gamma') };
}

const sell = (guild, p, quantity, extra = {}) => db.addSale(guild.id, { id: uid(), productId: p?.id ?? null, product: p?.name ?? null, quantity, ...extra });
const vouch = (guild, rating, extra) => db.guild(guild.id).vouches.push({ n: uid(), userId: '1', rating, at: Date.now(), ...extra });
const badgeOf = (guild, p) => badges.compute(guild.id).get(p.id) ?? [];

/** Temporarily changes config.badges. */
async function withBadges(patch, fn) {
  const prev = { ...config.badges };
  Object.assign(config.badges, patch);
  try {
    await fn();
  } finally {
    Object.keys(config.badges).forEach((k) => delete config.badges[k]);
    Object.assign(config.badges, prev);
  }
}

test('bestseller: most units sold, at least bestsellerMinSales, ties go to the product that comes first', async () => {
  const { guild, alpha, beta, gamma } = await shopGuild();
  assert.equal(badges.bestseller(guild.id), null, 'nothing sold yet');
  sell(guild, beta, 2);
  assert.equal(badges.bestseller(guild.id), null, `2 units – the minimum is ${config.badges.bestsellerMinSales}`);
  sell(guild, beta, 1);
  assert.equal(badges.bestseller(guild.id), beta.id);
  assert.deepEqual(badgeOf(guild, beta), ['🔥 Bestseller']);

  // A tie: Alpha was added first.
  sell(guild, alpha, 3);
  assert.equal(badges.bestseller(guild.id), alpha.id);
  // Older sales without a product ID count by name (any case); unknown names and deleted products don't count.
  sell(guild, null, 1, { product: 'BETA' });
  assert.equal(badges.bestseller(guild.id), beta.id);
  sell(guild, null, 9, { product: 'Delta' });
  sell(guild, { id: 'deleted', name: 'Gone' }, 9);
  assert.equal(badges.bestseller(guild.id), beta.id);
  // An option's sale ("Gamma — 3 months") counts for its product.
  sell(guild, gamma, 5, { product: 'Gamma — 3 months', variant: '3 months' });
  assert.equal(badges.bestseller(guild.id), gamma.id);
  assert.deepEqual(badgeOf(guild, beta), []);

  await withBadges({ bestsellerMinSales: 6 }, () => assert.equal(badges.bestseller(guild.id), null));
  await withBadges({ bestsellerMinSales: 0 }, () => assert.equal(badges.bestseller(guild.id), gamma.id, 'a product that sold nothing never is one'));

  // The card shows it in the status line.
  await panels.refresh(guild, 'shop');
  const panel = db.panels(guild.id, 'shop')[0];
  const text = textOf(guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId).body);
  assert.match(text, /Gamma[^#]*-# 🟢 In stock · 🔥 Bestseller/);
  assert.equal(text.match(/Bestseller/g).length, 1);
});

test('rating: the average of a product\'s vouches from ratingMinVouches on – older vouches are matched by name', async () => {
  const { guild, alpha, beta, gamma } = await shopGuild();
  vouch(guild, 5, { product: 'Alpha', productId: alpha.id });
  assert.deepEqual(badgeOf(guild, alpha), [], `1 vouch – the minimum is ${config.badges.ratingMinVouches}`);
  vouch(guild, 4, { product: 'alpha ' }); // an older vouch: only the name, typed differently
  assert.deepEqual(badgeOf(guild, alpha), ['⭐ 4.5']);

  vouch(guild, 5, { product: 'Beta', productId: beta.id });
  vouch(guild, 5, { product: 'Beta', productId: beta.id });
  vouch(guild, 4, { product: 'Beta', productId: beta.id });
  assert.deepEqual(badgeOf(guild, beta), ['⭐ 4.7'], 'one decimal');
  vouch(guild, 1, { product: 'Something else' });
  vouch(guild, 1, { product: '' });
  assert.deepEqual(badgeOf(guild, gamma), []);
  assert.deepEqual(
    [...badges.ratings(guild.id)].map(([id, r]) => [id, r.count]),
    [[alpha.id, 2], [beta.id, 3]],
  );

  await withBadges({ ratingMinVouches: 3 }, () => assert.deepEqual(badgeOf(guild, alpha), []));
  // Both badges on one card.
  for (let i = 0; i < 3; i += 1) sell(guild, beta, 1);
  assert.deepEqual(badgeOf(guild, beta), ['🔥 Bestseller', '⭐ 4.7']);
  assert.match(shop.cardText(guild, beta, { badges: badges.compute(guild.id) }), /\n-# 🟢 In stock · 🔥 Bestseller · ⭐ 4\.7$/);

  // Turned off in config.json: no badges at all.
  await withBadges({ enabled: false }, () => assert.equal(badges.compute(guild.id).size, 0));
});

test('new vouches store the product ID – from the vouch form and from /vouch', async () => {
  const { guild, beta } = await shopGuild();
  const last = () => db.guild(guild.id).vouches.at(-1);

  await run({ guild, member: member(guild), kind: 'modal', customId: 'vouch:submit', selects: { rating: ['5'], product: [beta.id] }, fields: { review: 'Super fast delivery, works perfectly!' } });
  assert.equal(last().product, 'Beta');
  assert.equal(last().productId, beta.id);

  await run({ guild, member: member(guild), kind: 'command', commandName: 'vouch', options: { rating: 4, product: 'beta', review: 'Great service, thank you!' } });
  assert.equal(last().productId, beta.id, 'a typed name is matched to the catalog');
  await run({ guild, member: member(guild), kind: 'command', commandName: 'vouch', options: { rating: 4, product: 'A custom order', review: 'Great service, thank you!' } });
  assert.equal(last().product, 'A custom order');
  assert.equal(last().productId, null);
  await run({ guild, member: member(guild), kind: 'modal', customId: 'vouch:submit', selects: { rating: ['3'], product: ['__other'] }, fields: { review: 'Okay but slow this time.', product_other: 'Gift card' } });
  assert.equal(last().productId, null);
  assert.deepEqual(badgeOf(guild, beta), ['⭐ 4.5']);
});

// ───────────── Everything at once ─────────────

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4096, 7)]);

test('shop panel: 5 products with 10 options each, a sale, a counter, badges, images and long texts still fit Discord\'s limits', async () => {
  const guild = new FakeGuild({ premiumTier: 3 }); // all custom emojis → longest possible text
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const longest = `<:${'e'.repeat(32)}:${guild.emojis.cache.first().id}>`;
  const list = [];
  for (let i = 0; i < 7; i += 1) {
    const p = shop.addProduct(guild, {
      name: `${i}${'N'.repeat(79)}`,
      price: '99999.99',
      description: 'd'.repeat(400),
      category: `${i % 4}${'C'.repeat(29)}`,
      stockCount: 99_999,
      image: { buffer: PNG, ext: 'png' },
    });
    p.emoji = longest;
    shop.setVariants(guild, p.id, Array.from({ length: 10 }, (_, k) => `${k}${'V'.repeat(49)} = 99999.99`).join(', '));
    flash.startSale(guild, p.id, { percent: 33, durationMs: 7 * 86_400_000 });
    list.push(p);
  }
  for (const p of list) for (let k = 0; k < 3; k += 1) vouch(guild, 4, { productId: p.id, product: p.name });
  sell(guild, list[0], 10);

  const payload = await panels.render('shop', guild);
  const r = validateMessage(payload, guild);
  assert.ok(r.total <= 40 && r.textLength <= 4000, `${r.total} components, ${r.textLength} characters`);
  const text = textOf(payload);
  assert.match(text, /🔥 Bestseller/);
  assert.match(text, /⭐ 4\.0/);
  assert.match(text, /from ~~99999\.99€~~ \*\*66999\.99€\*\* · −33%/);
  assert.match(text, /\+\d+ more/);
  assert.equal(text.match(/Sale ends <t:\d+:R>/g).length, 5);
  assert.equal(text.match(/99999 left/g).length, 5);
  const ids = customIds(payload).filter((id) => id.startsWith('shop:buy:'));
  assert.equal(ids.length, 5, 'every product on the page can be bought');
  assert.equal(shop.measure(payload).chars, r.textLength);

  // Every tab and page fits too.
  for (const tab of ['all', ...shop.shopTabs(shop.products(guild.id)).map((x) => x.value)]) {
    for (const page of [0, 1]) {
      const view = shop.shopView(guild, { tab, page });
      const v = validateMessage(view, guild);
      assert.ok(v.total <= 40 && v.textLength <= 4000, `${tab} page ${page}`);
    }
  }
});
