'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const hooks = require('../src/lib/hooks');
const panels = require('../src/lib/panels');
const config = require('../src/lib/config');
const shop = require('../src/features/shop');
const vouches = require('../src/features/vouches');
const giveaways = require('../src/features/giveaways');
const t = require('../src/tickets/tickets');
const commands = require('../src/commands')();

config.defaults.openCooldownSeconds = 0;
let n = 970000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

test('an order form sent after the product sold out offers Notify me and opens no ticket', async () => {
  const guild = await builtGuild();
  const p = shop.addProduct(guild, { name: 'GTA V', price: '20', description: 'Instant.' });
  await shop.setStock(guild, p.id, 'out');
  const before = db.tickets(() => true).length;
  const i = createInteraction({ guild, member: member(guild), kind: 'modal', customId: `shop:order:${p.id}`, fields: { quantity: '1', notes: '' }, selects: { payment: ['0'] } });
  await handle(i, commands);
  assert.ok(customIds(lastResponse(i)).includes(`restock:notify:${p.id}`));
  assert.equal(db.tickets(() => true).length, before);
});

test('vouches: two at the same moment get different numbers, a deleted vouch message leaves the counters', async () => {
  const guild = await builtGuild();
  const [a, b] = [member(guild), member(guild)];
  await Promise.all([
    vouches.postVouch(guild, a, { rating: 5, product: 'GTA V', review: 'Fast and legit, thank you!' }),
    vouches.postVouch(guild, b, { rating: 4, product: 'Nitro', review: 'Good service, quick reply.' }),
  ]);
  const list = db.guild(guild.id).vouches;
  assert.deepEqual(list.map((v) => v.n).sort(), [1, 2]);
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'vouches'));
  const message = channel.messageList.find((m) => m.id === list[0].messageId);
  await hooks.emit('messageDelete', message);
  assert.equal(db.guild(guild.id).vouches.length, 1, 'the deleted vouch is gone from the stats');
  await vouches.postVouch(guild, a, { rating: 5, product: 'Netflix', review: 'Third vouch, still great.' }).catch(() => null);
  const numbers = db.guild(guild.id).vouches.map((v) => v.n);
  assert.equal(new Set(numbers).size, numbers.length, 'numbers are never reused');
});

test('the vouch form puts the bought product first, even in a big catalog', async () => {
  const guild = await builtGuild();
  for (let i = 1; i <= 30; i += 1) shop.addProduct(guild, { name: `Product ${i}`, price: '5', description: 'x' });
  const bought = shop.findProduct(guild.id, 'Product 28');
  const json = vouches.vouchModal(guild, { productId: bought.id }).toJSON();
  const select = json.components.map((c) => c.component).find((c) => c?.custom_id === 'product');
  assert.equal(select.options[0].value, bought.id);
  assert.equal(select.options[0].default, true);
  assert.equal(select.options.length, 25);
});

test('a giveaway ends once – a second end (or two at the same time) is refused', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const { gw } = await giveaways.start(guild, owner, { prize: 'Nitro', durationMs: 3_600_000, winners: 1 });
  gw.entries.push(member(guild).id);
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'giveaways'));
  const before = channel.messageList.length;
  const results = await Promise.allSettled([giveaways.end(guild, gw), giveaways.end(guild, gw)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(giveaways.end(guild, gw), /already ended/);
  assert.equal(channel.messageList.length - before, 1, 'one winner announcement');
});

test('"Call support" says how long the customer has been waiting since the team last answered', async () => {
  const guild = await builtGuild();
  const author = member(guild);
  const staff = member(guild, ['member', 'support']);
  const channel = await t.openTicket(author, config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  t.trackMessage({ guild, channel, author: staff.user, member: staff });
  t.trackMessage({ guild, channel, author: author.user, member: author });
  const since = db.getTicket(channel.id).waitingSince;
  assert.ok(since, 'waiting starts with the first message after the team answered');
  t.trackMessage({ guild, channel, author: author.user, member: author });
  assert.equal(db.getTicket(channel.id).waitingSince, since, 'more messages from the customer keep the same start');
});

test('/build only:update keeps a retired category that still has your own channels', async () => {
  const guild = await builtGuild();
  const b = db.build(guild.id);
  const cat = await guild.channels.create({ name: '〔 💎 VIP LOUNGE 〕', type: ChannelType.GuildCategory });
  b.categories.catVip = cat.id;
  db.setBuild(guild.id, b);
  const mine = await guild.channels.create({ name: 'my-channel', type: ChannelType.GuildText, parent: cat.id });
  const i = createInteraction({ guild, member: guild.members.cache.get(guild.ownerId), kind: 'command', commandName: 'build', options: { only: 'update' } });
  await handle(i, commands);
  assert.ok(guild.channels.cache.has(cat.id) && guild.channels.cache.get(mine.id).parentId === cat.id);
  assert.match(textOf(lastResponse(i)), /was kept because it still has #my-channel/);
});

test('Wipe & Build during a /lockdown ends the lockdown and resumes invites', async () => {
  const guild = await builtGuild();
  const g = db.guild(guild.id);
  g.security.lockdown = { by: guild.ownerId, at: Date.now(), invitesPaused: true, roles: [] };
  db.save();
  let resumed = false;
  guild.disableInvites = async (on) => {
    if (on === false) resumed = true;
    return guild;
  };
  const R = await buildServer({ guild, mode: 'wipe', invokerId: guild.ownerId });
  assert.equal(db.guild(guild.id).security.lockdown, undefined);
  assert.ok(resumed);
  assert.ok(R.warnings.some((w) => /wipe ended the lockdown/.test(w)));
});

test('a server Discord reports as unavailable keeps its tickets and panels', async () => {
  const guild = await builtGuild();
  const channel = await t.openTicket(member(guild), config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  const panelsBefore = db.panels(guild.id).length;
  guild.available = false;
  const cached = [...guild.channels.cache.entries()];
  guild.channels.cache.clear(); // what an outage looks like: no channels in the cache
  await panels.refresh(guild);
  await t.runInactivityCheck(guild.client);
  assert.equal(db.panels(guild.id).length, panelsBefore, 'panels are kept');
  assert.equal(db.getTicket(channel.id).status, 'open', 'the ticket is not marked as deleted');
  for (const [id, c] of cached) guild.channels.cache.set(id, c);
  guild.available = true;
});

test('verification: the invite credit and welcome code still happen when the "verified" reply comes too late', async () => {
  const guild = await builtGuild();
  const newcomer = guild.addMember(uid(), []);
  const seen = [];
  hooks.on('verified', (m) => seen.push(m.id));
  const verification = require('../src/features/verification');
  const prev = config.verification.captcha;
  config.verification.captcha = false;
  config.verification.minAccountAgeDays = 0;
  try {
    const i = createInteraction({ guild, member: newcomer, kind: 'button', customId: 'verify:start' });
    i.reply = async () => {
      throw Object.assign(new Error('Unknown interaction'), { code: 10062 });
    };
    await verification.handleButton(i).catch(() => null);
    assert.ok(newcomer.roles.cache.has(role(guild, 'member')), 'the role was given');
    assert.ok(seen.includes(newcomer.id), 'the verified features ran');
  } finally {
    config.verification.captcha = prev;
  }
});
