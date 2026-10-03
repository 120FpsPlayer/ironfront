'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const promos = require('../src/features/promos');

const commands = loadCommands();

let n = 930000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));

let guild;
test.before(async () => {
  guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
});

const promo = async (who, subcommand, options = {}) => {
  const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'promo', subcommand, options });
  await handle(i, commands);
  return i;
};

test('/promo create: sellers and admins only, percent or amount, sensible defaults', async () => {
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);
  const support = member(guild, ['member', 'support']);

  for (const who of [buyer, support]) {
    const denied = await promo(who, 'create', { code: 'HACK', percent: 90 });
    assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);
  }
  assert.equal(promos.find(guild.id, 'HACK'), null);

  const made = await promo(seller, 'create', { code: 'nox10', percent: 10, expires_in_days: 7, max_uses: 50 });
  assert.match(textOf(lastResponse(made)), /Promo code NOX10 created/);
  const p = promos.find(guild.id, 'NOX10');
  assert.equal(p.percent, 10);
  assert.equal(p.maxUses, 50);
  assert.equal(p.oncePerUser, true, 'once per user by default');
  assert.equal(p.firstOrderOnly, false);
  assert.equal(p.createdBy, seller.id);
  assert.ok(Math.abs(p.expiresAt - (Date.now() + 7 * promos.DAY)) < 5000);
  const log = guild.channels.cache.get(db.settings(guild.id).logChannelId).messageList.at(-1);
  assert.match(textOf(log.body), /Promo code created[\s\S]*NOX10/, 'logged');

  const owner = guild.members.cache.get(guild.ownerId);
  const fixed = await promo(owner, 'create', { code: 'FIVEOFF', amount: 5, once_per_user: false, first_order_only: true });
  assert.match(textOf(lastResponse(fixed)), /FIVEOFF/);
  assert.equal(promos.find(guild.id, 'FIVEOFF').amount, 5);
  assert.equal(promos.find(guild.id, 'FIVEOFF').oncePerUser, false);
  assert.equal(promos.find(guild.id, 'FIVEOFF').firstOrderOnly, true);

  const neither = await promo(seller, 'create', { code: 'NOTHING' });
  assert.match(textOf(lastResponse(neither)), /either \*\*percent\*\*/);
  const both = await promo(seller, 'create', { code: 'BOTH', percent: 5, amount: 2 });
  assert.match(textOf(lastResponse(both)), /not both/);
  const dupe = await promo(seller, 'create', { code: 'NOX10', percent: 20 });
  assert.match(textOf(lastResponse(dupe)), /already exists/);
  const bad = await promo(seller, 'create', { code: 'no spaces!', percent: 20 });
  assert.match(textOf(lastResponse(bad)), /3–24 characters/);
});

test('/promo list, info and autocomplete: personal codes are marked, uses and expiry shown', async () => {
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);
  promos.create(guild.id, { code: 'LIST15', percent: 15, maxUses: 3 });
  promos.redeem(guild.id, 'LIST15', buyer.id, 'S-0009');
  const personal = promos.personal(guild.id, buyer.id, { percent: 5, days: 7, prefix: 'WELCOME', reason: 'welcome', firstOrderOnly: true });
  promos.create(guild.id, { code: 'OLD', percent: 50, expiresAt: Date.now() - 1000 });

  const list = await promo(seller, 'list');
  const out = textOf(lastResponse(list));
  assert.match(out, /`LIST15` · \*\*15% off\*\* · 1\/3 uses/);
  assert.match(out, new RegExp(`${personal.code}\` · \\*\\*5% off\\*\\* · 0/1 uses · expires <t:\\d+:R> · first order only · 👤 personal: <@${buyer.id}> \\(welcome\\)`));
  assert.match(out, /⌛ `OLD` · \*\*50% off\*\* · 0\/∞ uses · expired/);
  assert.ok(out.indexOf('LIST15') < out.indexOf(personal.code), 'public codes come first');

  const info = await promo(seller, 'info', { code: 'list15' });
  const details = textOf(lastResponse(info));
  assert.match(details, /LIST15/);
  assert.match(details, /Uses 1\/3 uses/);
  assert.match(details, new RegExp(`<@${buyer.id}> · \`S-0009\``));

  const ac = createInteraction({ guild, member: seller, kind: 'autocomplete', commandName: 'promo', focused: 'welc' });
  await handle(ac, commands);
  assert.deepEqual(ac.state.responded.map((c) => c.value), [personal.code]);
  assert.match(ac.state.responded[0].name, /personal/);
  const hidden = createInteraction({ guild, member: buyer, kind: 'autocomplete', commandName: 'promo', focused: '' });
  await handle(hidden, commands);
  assert.deepEqual(hidden.state.responded, [], 'members do not see the codes');

  const denied = await promo(buyer, 'list');
  assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);
});

test('/promo delete: removes the code, unknown codes and members are refused', async () => {
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);
  promos.create(guild.id, { code: 'BYE', percent: 10 });
  const denied = await promo(buyer, 'delete', { code: 'BYE' });
  assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);
  assert.ok(promos.find(guild.id, 'BYE'));

  const gone = await promo(seller, 'delete', { code: 'bye' });
  assert.match(textOf(lastResponse(gone)), /Deleted the promo code \*\*BYE\*\*/);
  assert.equal(promos.find(guild.id, 'BYE'), null);
  const unknown = await promo(seller, 'delete', { code: 'BYE' });
  assert.match(textOf(lastResponse(unknown)), /There is no promo code \*\*BYE\*\*/);
});

test('/promo list stays within Discord limits with hundreds of personal codes', async () => {
  const g = new FakeGuild();
  await buildServer({ guild: g, mode: 'add', invokerId: g.ownerId });
  for (let i = 0; i < 300; i += 1) promos.personal(g.id, uid(), { percent: 5, days: 7, prefix: 'WELCOME', reason: 'welcome' });
  promos.create(g.id, { code: 'PUBLIC-CODE-WITH-24-CHAR', percent: 10, maxUses: 100_000, expiresAt: Date.now() + promos.DAY, firstOrderOnly: true, oncePerUser: false });
  const i = createInteraction({ guild: g, member: g.members.cache.get(g.ownerId), kind: 'command', commandName: 'promo', subcommand: 'list' });
  await handle(i, commands);
  const res = lastResponse(i);
  validateMessage(res, g);
  const out = textOf(res);
  assert.match(out, /Promo codes \(301\)/);
  assert.ok(out.indexOf('PUBLIC-CODE-WITH-24-CHAR') < out.indexOf('WELCOME-'), 'the public code is listed first');
  assert.match(out, /…and \d+ more/);
});
