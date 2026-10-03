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
const promos = require('../src/features/promos');
const invites = require('../src/features/invites');

const commands = loadCommands();
const DAY = 86_400_000;

let n = 970000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const record = (guild, m) => invites.store(guild.id).members[m.id];

async function setup() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  await invites.refresh(guild);
  return guild;
}

/** Someone joins (with this invite, if given) – Discord counts the use before the join event arrives. */
async function join(guild, code = null, { id = uid(), bot = false } = {}) {
  if (code) guild.useInvite(code);
  const m = guild.addMember(id, [], { bot });
  await hooks.emit('memberAdd', m);
  return m;
}

async function leave(guild, m) {
  guild.removeMember(m.id);
  await hooks.emit('memberRemove', m);
}

/** The real thing: Verify button → math question → Member role → hooks 'verified'. */
async function verify(guild, m) {
  const channel = guild.channels.cache.get(db.channelId(guild.id, 'verify'));
  const start = createInteraction({ guild, member: m, kind: 'button', customId: 'verify:start', channel });
  await handle(start, commands);
  const [, , a, b] = start.state.modals[0].custom_id.split(':');
  const answer = createInteraction({ guild, member: m, kind: 'modal', customId: start.state.modals[0].custom_id, fields: { answer: String(Number(a) + Number(b)) }, channel });
  await handle(answer, commands);
}

const command = async (guild, who, subcommand, options = {}) => {
  const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'invites', subcommand, options });
  await handle(i, commands);
  return i;
};

async function withRewards(rewards, fn) {
  const prev = config.invites.rewards;
  config.invites.rewards = rewards;
  try {
    await fn();
  } finally {
    config.invites.rewards = prev;
  }
}

// ───────────── Attribution ─────────────

test('joins are attributed to the invite whose uses went up; vanity, unknown, bots and bot invites have no inviter', async () => {
  const guild = await setup();
  const alice = member(guild);
  const bob = member(guild);
  const a = guild.addInvite({ inviterId: alice.id, uses: 3 });
  const b = guild.addInvite({ inviterId: bob.id });
  await invites.refresh(guild);

  const viaA = await join(guild, a.code);
  assert.deepEqual(record(guild, viaA), { inviterId: alice.id, code: a.code, joinedAt: record(guild, viaA).joinedAt, verified: false, left: false });
  assert.ok(Math.abs(record(guild, viaA).joinedAt - Date.now()) < 5000);
  const viaB = await join(guild, b.code);
  assert.equal(record(guild, viaB).inviterId, bob.id);

  // A new invite (created while nobody was watching) that was used right away
  const fresh = guild.addInvite({ inviterId: bob.id });
  assert.equal(record(guild, await join(guild, fresh.code)).inviterId, bob.id);

  // inviteCreate keeps the cache current
  const announced = guild.addInvite({ inviterId: alice.id });
  await hooks.emit('inviteCreate', announced);
  assert.equal(record(guild, await join(guild, announced.code)).inviterId, alice.id);

  // A single-use invite is deleted the moment it's used – even if the delete event comes first
  const once = guild.addInvite({ inviterId: alice.id, maxUses: 1 });
  await invites.refresh(guild);
  guild.useInvite(once.code);
  await hooks.emit('inviteDelete', { code: once.code, guild });
  const viaOnce = await join(guild);
  assert.deepEqual([record(guild, viaOnce).inviterId, record(guild, viaOnce).code], [alice.id, once.code]);

  // Nothing changed → the vanity URL, or unknown
  guild.vanityURLCode = 'noxshop';
  const vanity = await join(guild);
  assert.deepEqual([record(guild, vanity).inviterId, record(guild, vanity).code], [null, 'noxshop']);
  guild.vanityURLCode = null;
  const unknown = await join(guild);
  assert.deepEqual([record(guild, unknown).inviterId, record(guild, unknown).code], [null, null]);

  // Bots are never recorded; invites created by a bot (e.g. the one /build made) have no inviter
  const bot = await join(guild, b.code, { bot: true });
  assert.equal(record(guild, bot), undefined);
  const botInvite = guild.addInvite({ inviterId: guild.client.user.id });
  botInvite.inviter = guild.client.user;
  await invites.refresh(guild);
  const viaBot = await join(guild, botInvite.code);
  assert.deepEqual([record(guild, viaBot).inviterId, record(guild, viaBot).code], [null, botInvite.code]);
});

test('two people joining at the same time are attributed one after another', async () => {
  const guild = await setup();
  const alice = member(guild);
  const bob = member(guild);
  const a = guild.addInvite({ inviterId: alice.id });
  const b = guild.addInvite({ inviterId: bob.id });
  await invites.refresh(guild);

  // The first fetch is slow: the second person joins while the first join is still being looked up.
  const fetch = guild.invites.fetch;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let calls = 0;
  guild.invites.fetch = async () => {
    const result = await fetch();
    calls += 1;
    if (calls === 1) await gate;
    return result;
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

  guild.useInvite(a.code);
  const first = guild.addMember(uid(), []);
  const firstJoin = hooks.emit('memberAdd', first);
  await tick();
  assert.equal(calls, 1, 'the first lookup is running');
  guild.useInvite(b.code);
  const second = guild.addMember(uid(), []);
  const secondJoin = hooks.emit('memberAdd', second);
  await tick();
  assert.equal(calls, 1, 'the second join waits for the first');
  release();
  await Promise.all([firstJoin, secondJoin]);
  assert.equal(record(guild, first).inviterId, alice.id);
  assert.equal(record(guild, second).inviterId, bob.id, 'compared with the counts after the first join, not before it');
});

// ───────────── Counting ─────────────

test('an invite counts only once the member verifies and while they stay; leave / rejoin and self-invites', async () => {
  const guild = await setup();
  const alice = member(guild);
  const bob = member(guild);
  const a = guild.addInvite({ inviterId: alice.id });
  const b = guild.addInvite({ inviterId: bob.id });
  await invites.refresh(guild);

  const first = await join(guild, a.code);
  const second = await join(guild, a.code);
  assert.deepEqual(invites.counts(guild.id, alice.id), { valid: 0, pending: 2, left: 0 }, 'pending until verified');

  await verify(guild, first);
  assert.ok(first.roles.cache.has(role(guild, 'member')), 'really verified');
  assert.equal(record(guild, first).verified, true);
  assert.ok(record(guild, first).verifiedAt);
  assert.deepEqual(invites.counts(guild.id, alice.id), { valid: 1, pending: 1, left: 0 });
  await hooks.emit('verified', first);
  assert.equal(invites.counts(guild.id, alice.id).valid, 1, 'counted once');

  await leave(guild, first);
  assert.deepEqual(invites.counts(guild.id, alice.id), { valid: 0, pending: 1, left: 1 }, 'leaving takes it off the count');
  assert.equal(record(guild, first).left, true);
  await hooks.emit('verified', first);
  assert.equal(invites.counts(guild.id, alice.id).valid, 0, "someone who left can't count");

  // Rejoining through Bob's invite: Bob's now, and only after verifying again
  const back = await join(guild, b.code, { id: first.id });
  assert.deepEqual(record(guild, back), { inviterId: bob.id, code: b.code, joinedAt: record(guild, back).joinedAt, verified: false, left: false });
  assert.deepEqual(invites.counts(guild.id, bob.id), { valid: 0, pending: 1, left: 0 });
  assert.deepEqual(invites.counts(guild.id, alice.id), { valid: 0, pending: 1, left: 0 });
  await verify(guild, back);
  assert.deepEqual(invites.counts(guild.id, bob.id), { valid: 1, pending: 0, left: 0 });

  // Alice leaves and rejoins with her own invite: never counts
  await leave(guild, alice);
  const self = await join(guild, a.code, { id: alice.id });
  await verify(guild, self);
  assert.equal(record(guild, self).inviterId, alice.id);
  assert.deepEqual(invites.counts(guild.id, alice.id), { valid: 0, pending: 1, left: 0 });
  assert.ok(!invites.leaderboard(guild.id).some((c) => c.inviterId === alice.id));

  // Verifying without a join record (joined before tracking) does nothing
  const old = member(guild, []);
  await hooks.emit('verified', old);
  assert.equal(record(guild, old), undefined);
  void second;
});

test('on start: invites are cached and members who left while the bot was offline stop counting', async () => {
  const guild = await setup();
  const alice = member(guild);
  const a = guild.addInvite({ inviterId: alice.id });
  const store = invites.store(guild.id).members;
  store['111111111111111111'] = { inviterId: alice.id, code: a.code, joinedAt: Date.now() - DAY, verified: true, left: false };
  const stayed = member(guild);
  store[stayed.id] = { inviterId: alice.id, code: a.code, joinedAt: Date.now() - DAY, verified: true, left: false };

  await hooks.emit('ready', guild.client);
  assert.equal(store['111111111111111111'].left, true, 'left while offline');
  assert.equal(store[stayed.id].left, false);
  assert.deepEqual(invites.counts(guild.id, alice.id), { valid: 1, pending: 0, left: 1 });
  assert.equal(record(guild, await join(guild, a.code)).inviterId, alice.id, 'the cache from the start is used');
});

// ───────────── Rewards ─────────────

test('rewards: a personal INVITE code by DM once per level – leaving and rejoining cannot farm codes', async () => {
  await withRewards([{ invites: 3, percent: 15 }, { invites: 2, percent: 10 }], async () => {
    const guild = await setup();
    const alice = member(guild);
    const a = guild.addInvite({ inviterId: alice.id });
    await invites.refresh(guild);
    const codes = () => promos.list(guild.id).filter((p) => p.userId === alice.id);
    const dms = () => guild.dms.filter((d) => d.to === alice.id);

    const first = await join(guild, a.code);
    await verify(guild, first);
    assert.equal(codes().length, 0, 'one valid invite is not enough');
    const second = await join(guild, a.code);
    await verify(guild, second);

    assert.equal(codes().length, 1);
    const code = codes()[0];
    assert.match(code.code, /^INVITE-[0-9A-F]{6}$/);
    assert.equal(code.percent, 10);
    assert.equal(code.maxUses, 1);
    assert.equal(code.reason, '2 invites');
    assert.ok(Math.abs(code.expiresAt - (Date.now() + invites.REWARD_DAYS * DAY)) < 5000, 'valid for 30 days');
    assert.deepEqual(invites.store(guild.id).rewarded[alice.id][2], { code: code.code, percent: 10, at: invites.store(guild.id).rewarded[alice.id][2].at, delivered: true });

    assert.equal(dms().length, 1);
    const dm = dms()[0].payload;
    validateMessage(dm, guild);
    const out = textOf(dm);
    assert.ok(out.includes(code.code));
    assert.match(out, /Invite reward unlocked/);
    assert.match(out, /\*\*2\*\* people you invited/);
    assert.match(out, /10% off/);
    assert.match(out, /\*\*3\*\* valid invites unlock \*\*15% off\*\*/);
    assert.match(textOf(guild.channels.cache.get(db.channelId(guild.id, 'serverLogs')).messageList.at(-1).body), new RegExp(`Invite reward[\\s\\S]*${code.code}`));

    // Leave + rejoin + verify again: back to 2, but level 2 was already rewarded
    await leave(guild, second);
    assert.equal(invites.counts(guild.id, alice.id).valid, 1);
    const back = await join(guild, a.code, { id: second.id });
    await verify(guild, back);
    assert.equal(invites.counts(guild.id, alice.id).valid, 2);
    assert.equal(codes().length, 1, 'no second code for the same level');
    assert.equal(dms().length, 1);

    // Third valid invite → the next level, once
    await verify(guild, await join(guild, a.code));
    assert.equal(codes().length, 2);
    assert.equal(codes()[1].percent, 15);
    assert.equal(codes()[1].reason, '3 invites');
    await verify(guild, await join(guild, a.code));
    assert.equal(codes().length, 2, 'every level is rewarded once');

    // The code works in the shop's promo check
    assert.equal(promos.check(guild.id, code.code, alice.id).error, null);
  });
});

test('rewards: closed DMs keep the code (shown in /invites stats); no rewards while promo codes are off', async () => {
  await withRewards([{ invites: 1, percent: 5 }], async () => {
    const guild = await setup();
    const shy = member(guild);
    guild.closedDms.add(shy.id);
    const s = guild.addInvite({ inviterId: shy.id });
    await invites.refresh(guild);
    await verify(guild, await join(guild, s.code));
    const [code] = promos.list(guild.id).filter((p) => p.userId === shy.id);
    assert.ok(code, 'the code is kept');
    assert.equal(invites.store(guild.id).rewarded[shy.id][1].delivered, false);
    assert.match(textOf(guild.channels.cache.get(db.channelId(guild.id, 'serverLogs')).messageList.at(-1).body), /DMs closed/);
    const stats = await command(guild, shy, 'stats');
    assert.match(textOf(lastResponse(stats)), new RegExp(`Your reward codes[\\s\\S]*\`${code.code}\` · 5% off · valid until`));

    const other = member(guild);
    const o = guild.addInvite({ inviterId: other.id });
    await invites.refresh(guild);
    config.promos.enabled = false;
    try {
      await verify(guild, await join(guild, o.code));
      assert.equal(promos.list(guild.id).filter((p) => p.userId === other.id).length, 0);
      assert.equal(invites.store(guild.id).rewarded[other.id], undefined);
    } finally {
      config.promos.enabled = true;
    }
  });
});

// ───────────── Missing permission ─────────────

test('without Manage Server: no crash, one console warning, joins are recorded without an inviter', async () => {
  const guild = await setup();
  const alice = member(guild);
  const a = guild.addInvite({ inviterId: alice.id });
  guild.deny('ManageGuild');
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(await invites.refresh(guild), null);
    const first = await join(guild, a.code);
    const second = await join(guild, a.code);
    assert.equal(record(guild, first).inviterId, null);
    assert.equal(record(guild, second).inviterId, null);
    assert.equal(warnings.filter((w) => w.includes('[invites]')).length, 1, 'warned once');
    assert.match(warnings[0], /missing the Manage Server permission/);
    assert.equal(invites.isReadable(guild.id), false);
    const stats = await command(guild, alice, 'stats');
    assert.match(textOf(lastResponse(stats)), /Tracking paused[\s\S]*Manage Server/);
  } finally {
    console.warn = warn;
  }
  guild.deniedPermissions.delete('ManageGuild');
  await invites.refresh(guild);
  assert.equal(invites.isReadable(guild.id), true);
  assert.equal(record(guild, await join(guild, a.code)).inviterId, alice.id, 'works again once the permission is back');
});

// ───────────── /invites ─────────────

test('/invites stats: valid / pending / left, reward levels and the next reward', async () => {
  await withRewards([{ invites: 2, percent: 10 }, { invites: 5, percent: 20 }], async () => {
    const guild = await setup();
    const alice = member(guild);
    const a = guild.addInvite({ inviterId: alice.id });
    await invites.refresh(guild);
    for (let i = 0; i < 3; i += 1) await verify(guild, await join(guild, a.code));
    await join(guild, a.code); // pending
    await leave(guild, await join(guild, a.code));

    const mine = await command(guild, alice, 'stats');
    const out = textOf(lastResponse(mine));
    assert.match(out, /Valid 3/);
    assert.match(out, /Pending 1 \(not verified\)/);
    assert.match(out, /Left 1/);
    assert.match(out, /\*\*2 more valid invites\*\* → \*\*20% off\*\*/);
    assert.match(out, /✅ \*\*2\*\* valid invites → 10% off\n⬜ \*\*5\*\* valid invites → 20% off/);
    assert.match(out, /Your reward codes[\s\S]*`INVITE-[0-9A-F]{6}` · 10% off · valid until/);
    assert.ok(lastResponse(mine).flags & 64, 'ephemeral');

    // Somebody else's stats: counts, but never their codes
    const other = await command(guild, member(guild), 'stats', { user: alice.user });
    const theirs = textOf(lastResponse(other));
    assert.match(theirs, new RegExp(`Invites of <@${alice.id}>`));
    assert.match(theirs, /Valid 3/);
    assert.doesNotMatch(theirs, /INVITE-/);

    const invited = (await join(guild, a.code));
    const joinedVia = await command(guild, invited, 'stats');
    assert.match(textOf(lastResponse(joinedVia)), new RegExp(`You joined through <@${alice.id}>'s invite`));

    const bot = await command(guild, alice, 'stats', { user: guild.client.user });
    assert.match(textOf(lastResponse(bot)), /Bots don't invite anyone/);
  });
});

test('/invites top: the 10 best inviters, ranked by valid invites, and your own place', async () => {
  const guild = await setup();
  const empty = await command(guild, member(guild), 'top');
  assert.match(textOf(lastResponse(empty)), /Nobody has a valid invite yet/);

  const inviters = Array.from({ length: 12 }, () => member(guild));
  const data = invites.store(guild.id).members;
  inviters.forEach((inviter, i) => {
    for (let k = 0; k <= i; k += 1) data[uid()] = { inviterId: inviter.id, code: 'x', joinedAt: Date.now(), verified: true, left: false };
  });
  data[uid()] = { inviterId: inviters[11].id, code: 'x', joinedAt: Date.now(), verified: false, left: false };
  data[uid()] = { inviterId: inviters[11].id, code: 'x', joinedAt: Date.now(), verified: true, left: true };

  const top = await command(guild, inviters[0], 'top');
  const out = textOf(lastResponse(top));
  const lines = out.split('\n').filter((l) => /<@\d+> – /.test(l));
  assert.equal(lines.length, 10);
  assert.ok(lines[0].startsWith(`🥇 <@${inviters[11].id}> – **12 valid invites** · 1 pending · 1 left`));
  assert.ok(lines[1].startsWith(`🥈 <@${inviters[10].id}> – **11 valid invites**`));
  assert.ok(lines[9].startsWith(`**10.** <@${inviters[2].id}> – **3 valid invites**`));
  assert.match(out, /You're \*\*#12\*\* with 1 valid invite\./);
});

test('/invites when tracking is turned off', async () => {
  const guild = await setup();
  config.invites.enabled = false;
  try {
    const i = await command(guild, member(guild), 'stats');
    assert.match(textOf(lastResponse(i)), /Invite tracking is turned off/);
    const m = await join(guild);
    assert.equal(record(guild, m), undefined, 'nothing is recorded');
  } finally {
    config.invites.enabled = true;
  }
});
