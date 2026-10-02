'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage, validateModal } = require('./helpers/fakeDiscord');
const { buildServer } = require('../src/builder/executor');
const config = require('../src/lib/config');
const panels = require('../src/lib/panels');
const shop = require('../src/features/shop');
const vouches = require('../src/features/vouches');
const giveaways = require('../src/features/giveaways');
const announce = require('../src/features/announce');
const welcome = require('../src/features/welcome');
const stats = require('../src/features/stats');
const ui = require('../src/tickets/ui');
const tickets = require('../src/tickets/tickets');
const session = require('../src/builder/session');
const { postsFor } = require('../src/builder/content');
const { CATEGORIES } = require('../src/builder/layout');

let guild;
const big = (n, ch = 'x') => ch.repeat(n);

test.before(async () => {
  guild = new FakeGuild({ premiumTier: 3 }); // all custom emojis → longest possible text
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
});

test('every channel post stays within Discord limits', () => {
  for (const key of CATEGORIES.flatMap((c) => c.channels).map((c) => c.post).filter(Boolean)) {
    for (const item of postsFor(key, guild)) {
      if (item.payload) validateMessage(item.payload);
    }
  }
});

test('shop panel: 0 to 50 products with maximum-length fields', async () => {
  const g = db.guild(guild.id);
  for (const count of [0, 1, 8, 9, 25, 50]) {
    g.products = Array.from({ length: count }, (_, i) => ({
      id: `p${i}`,
      name: big(80, 'N'),
      price: big(40, '9'),
      description: big(400, 'd'),
      emoji: '<:nox_diamond:123456789012345678>',
      stock: ['in', 'low', 'out'][i % 3],
    }));
    const payload = await panels.render('shop', guild);
    const r = validateMessage(payload);
    assert.ok(r.total <= 40 && r.textLength <= 4000, `${count} products`);
  }
  g.products = [];
});

test('order + vouch modals with many payment methods / products', () => {
  const product = { id: 'abc', name: big(80, 'N'), price: big(40, '9'), description: big(400, 'd') };
  const prev = config.shop.paymentMethods;
  config.shop.paymentMethods = Array.from({ length: 30 }, (_, i) => ({ name: `Method ${i} ${big(100)}`, emoji: 'wallet', details: big(200) }));
  try {
    validateModal(shop.orderModal(product, guild));
  } finally {
    config.shop.paymentMethods = prev;
  }
  db.guild(guild.id).products = Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: big(80, 'N'), price: '1', description: 'd' }));
  validateModal(vouches.vouchModal(guild));
  db.guild(guild.id).products = [];
  validateModal(vouches.vouchModal(guild));
});

test('ticket forms, panel and cards for every ticket type with long answers', () => {
  for (const style of ['buttons', 'select']) validateMessage(ui.panelPayload(guild, style));
  for (const type of config.ticketTypes) {
    if (type.questions.length) validateModal(tickets.buildForm(type, 'b'));
    const ticket = {
      number: 9999,
      ownerId: '1',
      typeId: type.id,
      priority: 'urgent',
      status: 'open',
      claimedBy: '2',
      participants: Array.from({ length: 20 }, (_, i) => String(100000000000000000 + i)),
      createdAt: Date.now(),
      completedAt: null,
      answers: type.questions.map((q) => ({ label: q.label, value: big(q.maxLength ?? 1000) })),
    };
    const user = { createdAt: new Date(), displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
    validateMessage(ui.ticketCard(ticket, type, { guild, ownerUser: user, ownerMember: { joinedAt: new Date() }, pingRoles: ['5', '6', '7'], previousCount: 3 }));
    validateMessage(ui.closedCard({ ...ticket, closedAt: Date.now(), closeReason: big(500) }, '1', { messageCount: 3, transcriptUrl: 'https://x.y/t.html' }));
    validateMessage(ui.closeRequestCard(ticket, '2'));
    validateMessage(ui.inactivityWarning(ticket, Date.now()));
    validateMessage(ui.orderCompletedCard(guild, ticket, '2', { loyal: true, orders: 5 }));
  }
});

test('vouch, giveaway, leaderboard, announcement and welcome cards at maximum size', async () => {
  const g = db.guild(guild.id);
  g.vouches = Array.from({ length: 500 }, (_, i) => ({ n: i + 1, userId: '1', rating: (i % 5) + 1, at: Date.now() }));
  validateMessage(vouches.vouchPanel(guild));
  g.activity = { total: {}, week: {}, weekKey: stats.weekKey() };
  for (let i = 0; i < 30; i += 1) {
    g.activity.total[String(100000000000000000 + i)] = 1_000_000 + i;
    g.activity.week[String(100000000000000000 + i)] = 100_000 + i;
  }
  validateMessage(stats.leaderboardPanel(guild));
  const gw = { id: 'abcd1234', prize: big(120), description: big(600), winnersCount: 20, endsAt: Date.now(), hostId: '1', requiredRoleId: '2', entries: [], winners: Array.from({ length: 20 }, (_, i) => String(100000000000000000 + i)), ended: false };
  validateMessage(giveaways.card(guild, gw));
  validateMessage(giveaways.card(guild, { ...gw, ended: true }));
  const author = guild.members.cache.get(guild.ownerId);
  for (const bannerKey of ['none', ...announce.BANNER_CHOICES.map(([k]) => k)]) {
    validateMessage(announce.buildAnnouncement(guild, author, { title: big(120), message: big(3500), ping: 'everyone', bannerKey, url: 'https://example.com' }));
  }
  validateMessage(welcome.welcomeCard(author));
});

test('/build preview, progress and result cards (with many warnings)', () => {
  const owner = guild.members.cache.get(guild.ownerId);
  validateMessage(session.previewCard(guild, owner));
  validateMessage(session.progressCard(guild, { done: 50, total: 100, phase: 'Creating channels', label: big(200), elapsed: 65_000, phases: [] }, { finishedPhases: ['Cleaning the server', 'Creating roles', 'Uploading emojis', 'Creating channels', 'Server settings', 'Community mode'] }));
  const R = {
    created: { roles: 22, categories: 11, channels: 46, messages: 60, automod: 6, emojis: 50 },
    deleted: { channels: 10, roles: 5, automod: 1 },
    warnings: Array.from({ length: 40 }, () => big(300)),
    errors: Array.from({ length: 5 }, () => big(300)),
    duration: 123_000,
    community: true,
  };
  validateMessage(session.resultCard(guild, R, { originChannelId: guild.channels.cache.first().id, wipe: true }));
  validateMessage(session.resultCard(guild, { ...R, fatal: big(200) }, { wipe: false }));
});

test('modals: verification, announcement, wipe confirmation', async () => {
  const { createInteraction } = require('./helpers/fakeInteraction');
  const visitor = guild.addMember('800000000000000001', []);
  const i = createInteraction({ guild, member: visitor, kind: 'button', customId: 'verify:start' });
  await require('../src/features/verification').handleButton(i);
  assert.equal(i.state.modals.length, 1);
  const a = createInteraction({ guild, member: visitor, kind: 'command' });
  await announce.openModal(a, { channelId: '123456789012345678', ping: 'pingAnnouncements', bannerKey: 'leaderboard' });
  assert.ok(a.state.modals[0].custom_id.length <= 100);
  guild.name = big(100, 'G');
  const w = createInteraction({ guild, member: guild.members.cache.get(guild.ownerId), kind: 'button', customId: 'build:wipe' });
  await session.handle(w);
  assert.equal(w.state.modals.length, 1);
});

test('slash command definitions are valid', () => {
  const commands = require('../src/commands')();
  assert.equal(commands.size, 12);
  for (const [name, cmd] of commands) {
    const json = cmd.data.toJSON();
    assert.ok(json.description.length <= 100, `/${name} description`);
    const walk = (opts = []) => {
      for (const o of opts) {
        assert.ok(o.description.length <= 100, `/${name} ${o.name}`);
        for (const c of o.choices ?? []) assert.ok(c.name.length <= 100, `/${name} choice ${c.name}`);
        assert.ok((o.choices ?? []).length <= 25, `/${name} ${o.name} has ≤ 25 choices`);
        walk(o.options);
      }
    };
    walk(json.options);
  }
});
