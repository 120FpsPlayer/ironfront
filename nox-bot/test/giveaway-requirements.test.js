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
const hooks = require('../src/lib/hooks');
const giveaways = require('../src/features/giveaways');
const invites = require('../src/features/invites');

const commands = loadCommands();

let n = 975000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const json = (payload) => JSON.stringify((payload.components ?? []).map((c) => (c.toJSON ? c.toJSON() : c)));

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, mod: member(guild, ['member', 'moderator']) };
}

const startCommand = (guild, mod, options) =>
  run({ guild, member: mod, kind: 'command', commandName: 'giveaway', subcommand: 'start', options: { prize: 'Discord Nitro', duration: '1h', ...options } });

/** `count` members who joined through the inviter's invite and verified – they count as valid invites. */
function invited(guild, inviter, count, { verified = true } = {}) {
  return Array.from({ length: count }, () => {
    const m = member(guild);
    invites.store(guild.id).members[m.id] = { inviterId: inviter.id, code: 'abc', joinedAt: Date.now(), verified, left: false, ...(verified && { creditedTo: inviter.id }) };
    return m;
  });
}

async function leave(guild, m) {
  guild.removeMember(m.id);
  await hooks.emit('memberRemove', m);
}

const enter = (guild, who, gw) => run({ guild, member: who, kind: 'button', customId: `gw:enter:${gw.id}` });

async function withInvites(enabled, fn) {
  const prev = config.invites.enabled;
  config.invites.enabled = enabled;
  try {
    await fn();
  } finally {
    config.invites.enabled = prev;
  }
}

// ───────────── /giveaway start ─────────────

test('/giveaway start buyers_only + min_invites: stored on the giveaway and listed on the card next to the required role', async () => {
  const { guild, mod } = await builtGuild();
  const vip = role(guild, 'customer');
  const start = await startCommand(guild, mod, { buyers_only: true, min_invites: 3, required_role: { id: vip } });
  assert.match(textOf(lastResponse(start)), /started/);
  const gw = Object.values(db.guild(guild.id).giveaways)[0];
  assert.equal(gw.buyersOnly, true);
  assert.equal(gw.minInvites, 3);

  const card = ch(guild, 'giveaways').messageList.at(-1).body;
  validateMessage(card, guild);
  const body = textOf(card);
  assert.match(body, /\*\*Required role:\*\* <@&\d+>\n(?:🛒|<:nox_cart:\d+>) Only customers can enter\n📨 Invited at least \*\*3\*\* members/);
  assert.match(body, /when the timer ends – the requirements are checked again then\./);

  // One invite → "member"; no options → no requirement lines.
  const one = await giveaways.start(guild, mod, { prize: 'Key', durationMs: 3_600_000, winners: 1, minInvites: 1 });
  assert.match(textOf(giveaways.card(guild, one.gw)), /Invited at least \*\*1\*\* member$/m);
  const plain = await giveaways.start(guild, mod, { prize: 'Plain', durationMs: 3_600_000, winners: 1 });
  assert.equal(plain.gw.buyersOnly, false);
  assert.equal(plain.gw.minInvites, null);
  assert.doesNotMatch(textOf(giveaways.card(guild, plain.gw)), /Only customers|Invited at least|checked again/);
});

test('/giveaway start min_invites is refused while invite tracking is off – buyers_only still works', async () => {
  const { guild, mod } = await builtGuild();
  await withInvites(false, async () => {
    const refused = await startCommand(guild, mod, { min_invites: 5 });
    assert.match(textOf(lastResponse(refused)), /Invite tracking is turned off/);
    assert.equal(Object.keys(db.guild(guild.id).giveaways).length, 0, 'no giveaway was started');
    await assert.rejects(giveaways.start(guild, mod, { prize: 'Key', durationMs: 3_600_000, winners: 1, minInvites: 2 }), /Invite tracking is turned off/);

    const buyers = await startCommand(guild, mod, { buyers_only: true });
    assert.match(textOf(lastResponse(buyers)), /started/);
    assert.equal(Object.values(db.guild(guild.id).giveaways)[0].buyersOnly, true);
  });
});

// ───────────── Entering ─────────────

test('buyers_only: members without a completed order are refused with a link to #shop – buyers and customers can enter', async () => {
  const { guild, mod } = await builtGuild();
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 1, buyersOnly: true });
  const shopId = db.channelId(guild.id, 'shop');

  const visitor = member(guild);
  const refused = lastResponse(await enter(guild, visitor, gw));
  assert.equal(refused.flags & 64, 64, 'ephemeral');
  assert.match(textOf(refused), new RegExp(`Only customers can enter this giveaway[\\s\\S]*<#${shopId}>`));
  assert.ok(json(refused).includes(`https://discord.com/channels/${guild.id}/${shopId}`), 'Shop link button');
  assert.deepEqual(gw.entries, []);

  const buyer = member(guild);
  db.guild(guild.id).orders[buyer.id] = 1;
  assert.match(textOf(lastResponse(await enter(guild, buyer, gw))), /You're in!/);
  const customer = member(guild, ['member', 'customer']); // e.g. the role given by hand
  assert.match(textOf(lastResponse(await enter(guild, customer, gw))), /You're in!/);
  assert.deepEqual(gw.entries, [buyer.id, customer.id]);
});

test('min_invites: only valid invites count (verified and still here); leaving the giveaway always works', async () => {
  const { guild, mod } = await builtGuild();
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 1, minInvites: 3 });
  const inviter = member(guild);
  const friends = invited(guild, inviter, 2);
  invited(guild, inviter, 2, { verified: false }); // pending – not verified yet

  const short = lastResponse(await enter(guild, inviter, gw));
  assert.match(textOf(short), /at least \*\*3\*\* valid invites to enter this giveaway – you have \*\*2\*\*/);
  assert.match(textOf(short), /\/invites stats/);
  assert.deepEqual(gw.entries, []);

  invited(guild, inviter, 1);
  assert.match(textOf(lastResponse(await enter(guild, inviter, gw))), /You're in!/);
  assert.deepEqual(gw.entries, [inviter.id]);

  // An invited friend leaves: below the minimum now – but leaving the giveaway still works.
  await leave(guild, friends[0]);
  assert.equal(invites.counts(guild.id, inviter.id).valid, 2);
  assert.match(textOf(lastResponse(await enter(guild, inviter, gw))), /You left the giveaway/);
  assert.deepEqual(gw.entries, []);
  assert.match(textOf(lastResponse(await enter(guild, inviter, gw))), /you have \*\*2\*\*/);
});

test('the required role is checked together with the new requirements – the role first', async () => {
  const { guild, mod } = await builtGuild();
  const vip = role(guild, 'loyal');
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 1, requiredRole: { id: vip }, buyersOnly: true, minInvites: 1 });
  const who = member(guild);
  assert.match(textOf(lastResponse(await enter(guild, who, gw))), /You need the <@&\d+> role/);
  await who.roles.add(vip);
  assert.match(textOf(lastResponse(await enter(guild, who, gw))), /Only customers/);
  db.guild(guild.id).orders[who.id] = 2;
  assert.match(textOf(lastResponse(await enter(guild, who, gw))), /valid invite to enter/);
  invited(guild, who, 1);
  assert.match(textOf(lastResponse(await enter(guild, who, gw))), /You're in!/);
});

// ───────────── Draw ─────────────

test('the draw (and a reroll) skips entrants whose invites dropped below min_invites', async () => {
  const { guild, mod } = await builtGuild();
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 2, minInvites: 2 });
  const [alice, bob] = [member(guild), member(guild)];
  invited(guild, alice, 2);
  const bobFriends = invited(guild, bob, 2);
  for (const who of [alice, bob]) assert.match(textOf(lastResponse(await enter(guild, who, gw))), /You're in!/);

  await leave(guild, bobFriends[1]);
  const winners = await giveaways.end(guild, gw);
  assert.deepEqual(winners, [alice.id], 'bob has 1 invite left – skipped, his place stays empty');
  assert.deepEqual(gw.winners, [alice.id]);
  assert.match(textOf(ch(guild, 'giveaways').messageList.at(-1).body), new RegExp(`<@${alice.id}> won`));

  // Reroll: still nobody else qualifies – until bob is back at 2 valid invites.
  assert.deepEqual(await giveaways.end(guild, gw, { reroll: true, count: 1 }), []);
  invited(guild, bob, 1);
  assert.deepEqual(await giveaways.end(guild, gw, { reroll: true, count: 1 }), [bob.id]);
  assert.deepEqual(gw.winners, [alice.id, bob.id]);
});

test('the draw (and a reroll) skips entrants who lost the required role since they entered', async () => {
  const { guild, mod } = await builtGuild();
  const vip = role(guild, 'loyal');
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 2, requiredRole: { id: vip } });
  const [alice, bob] = [member(guild, ['member', 'loyal']), member(guild, ['member', 'loyal'])];
  for (const who of [alice, bob]) assert.match(textOf(lastResponse(await enter(guild, who, gw))), /You're in!/);

  await bob.roles.remove(vip);
  assert.deepEqual(await giveaways.end(guild, gw), [alice.id], 'bob lost the role – skipped, his place stays empty');
  assert.deepEqual(await giveaways.end(guild, gw, { reroll: true, count: 1 }), []);
  await bob.roles.add(vip);
  assert.deepEqual(await giveaways.end(guild, gw, { reroll: true, count: 1 }), [bob.id]);
});

test('buyers_only at the draw: a completed order always counts, the Customer role only while they still have it', async () => {
  const { guild, mod } = await builtGuild();
  const customerRole = role(guild, 'customer');
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 2, buyersOnly: true });
  const byRole = member(guild, ['member', 'customer']); // the role given by hand – no order
  const buyer = member(guild);
  db.guild(guild.id).orders[buyer.id] = 1;
  for (const who of [byRole, buyer]) assert.match(textOf(lastResponse(await enter(guild, who, gw))), /You're in!/);

  await byRole.roles.remove(customerRole);
  await buyer.roles.remove(customerRole); // had no role – the order still counts
  assert.deepEqual(await giveaways.end(guild, gw), [buyer.id]);
});

// ───────────── Old giveaways ─────────────

test('giveaways saved before the requirements existed: no requirement lines, anyone can enter and win', async () => {
  const { guild, mod } = await builtGuild();
  const { gw } = await giveaways.start(guild, mod, { prize: 'Nitro', durationMs: 3_600_000, winners: 1 });
  delete gw.buyersOnly;
  delete gw.minInvites;
  const card = giveaways.card(guild, gw);
  validateMessage(card, guild);
  assert.doesNotMatch(textOf(card), /Only customers|Invited at least/);

  const nobody = member(guild); // no orders, no invites
  assert.match(textOf(lastResponse(await enter(guild, nobody, gw))), /You're in!/);
  assert.deepEqual(await giveaways.end(guild, gw), [nobody.id]);
});

test('the giveaway card with every requirement stays within Discord limits', async () => {
  const guild = new FakeGuild({ premiumTier: 3 });
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const big = (count) => 'x'.repeat(count);
  const gw = {
    id: 'abcd1234',
    prize: big(120),
    description: big(600),
    winnersCount: 20,
    endsAt: Date.now(),
    hostId: '1',
    requiredRoleId: '2',
    buyersOnly: true,
    minInvites: 100,
    entries: [],
    winners: Array.from({ length: 20 }, (_, i) => String(100000000000000000 + i)),
    ended: false,
  };
  validateMessage(giveaways.card(guild, gw), guild);
  validateMessage(giveaways.card(guild, { ...gw, ended: true }), guild);
});
