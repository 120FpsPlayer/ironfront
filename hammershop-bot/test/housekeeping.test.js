'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const hooks = require('../src/lib/hooks');
const promos = require('../src/features/promos');
const customers = require('../src/features/customers');
const invites = require('../src/features/invites');
const salesreport = require('../src/features/salesreport');
const housekeeping = require('../src/features/housekeeping');

const DAY = 86_400_000;
const welcome = (guildId, userId, expiredDaysAgo, now) => {
  const p = promos.personal(guildId, userId, { percent: 5, days: 7, prefix: 'WELCOME', firstOrderOnly: true, reason: 'welcome' });
  p.expiresAt = now - expiredDaysAgo * DAY;
  db.guild(guildId).welcomeCodes = { ...db.guild(guildId).welcomeCodes, [userId]: { code: p.code, at: p.createdAt } };
  return p;
};

test('housekeeping: unused welcome codes go 30 days after they expired, records nothing reads go, everything else stays', () => {
  const guild = new FakeGuild();
  const gid = guild.id;
  const g = db.guild(gid);
  const now = Date.now();

  const stale = welcome(gid, '910000000000000001', 31, now);
  const recent = welcome(gid, '910000000000000002', 29, now);
  const used = welcome(gid, '910000000000000003', 60, now);
  used.uses.push({ userId: '910000000000000003', at: now - 70 * DAY, saleId: 's1' });
  const inOrder = welcome(gid, '910000000000000004', 60, now);
  db.createTicket({ channelId: '920000000000000004', guildId: gid, number: 4, typeId: 'order', ownerId: '910000000000000004', status: 'closed', order: { promo: inOrder.code } });
  const reward = promos.personal(gid, '910000000000000005', { percent: 10, days: 30, prefix: 'INVITE', reason: '5 invites' });
  reward.expiresAt = now - 90 * DAY;
  const pub = promos.create(gid, { code: 'SUMMER', percent: 10, expiresAt: now - 90 * DAY });

  // A buyer who got a welcome code and has completed an order since – the order alone rules out a second code.
  g.orders['910000000000000006'] = 2;
  g.welcomeCodes['910000000000000006'] = { code: 'WELCOME-AAAAAA', at: now - 100 * DAY };
  db.addSale(gid, { id: 's1', userId: '910000000000000003', promo: used.code, discount: 1, amount: 19, completedAt: now - 70 * DAY });

  const members = invites.store(gid).members;
  Object.assign(members, {
    '930000000000000001': { inviterId: null, code: 'abc', joinedAt: now - 50 * DAY, verified: true, left: true, leftAt: now - 40 * DAY },
    '930000000000000002': { inviterId: '910000000000000005', code: 'def', joinedAt: now - 50 * DAY, verified: true, left: true, leftAt: now - 40 * DAY },
    '930000000000000003': { inviterId: null, code: null, joinedAt: now - 50 * DAY, verified: true, left: false },
    '930000000000000004': { inviterId: null, code: null, joinedAt: now - 50 * DAY, verified: true, left: true, leftAt: now - 40 * DAY, firstInviterId: '910000000000000005' },
  });

  const profile = (userId) => {
    const d = customers.profileData(guild, userId);
    return { orders: d.orders, sales: d.sales, spent: d.spent, invites: d.invites, notes: d.notes };
  };
  const users = ['910000000000000003', '910000000000000005', '910000000000000006', '930000000000000001', '930000000000000002'];
  const before = { profiles: users.map(profile), sales: salesreport.summarize(gid, { from: 0, to: now + 1 }), counts: invites.counts(gid, '910000000000000005') };

  const removed = housekeeping.prune(gid, now);
  assert.deepEqual(removed, { codes: 1, welcomeEntries: 1, inviteRecords: 1 });

  const codes = g.promos.map((p) => p.code);
  assert.ok(!codes.includes(stale.code), 'unused and expired for more than 30 days');
  for (const kept of [recent, used, inOrder, reward, pub]) assert.ok(codes.includes(kept.code), kept.code);
  assert.ok(g.welcomeCodes['910000000000000001'], 'still nobody gets a second welcome code');
  assert.equal(g.welcomeCodes['910000000000000006'], undefined);
  assert.deepEqual(Object.keys(members).sort(), ['930000000000000002', '930000000000000003', '930000000000000004']);

  const after = { profiles: users.map(profile), sales: salesreport.summarize(gid, { from: 0, to: now + 1 }), counts: invites.counts(gid, '910000000000000005') };
  assert.deepEqual(after, before, '/sales, /customer and /invites show the same');

  assert.deepEqual(housekeeping.prune(gid, now), { codes: 0, welcomeEntries: 0, inviteRecords: 0 }, 'nothing left to do');
});

test('housekeeping: runs as a cheap timer twice a day', async () => {
  const timer = hooks.timers().find((x) => x.name === 'housekeeping');
  assert.ok(timer);
  assert.equal(timer.ms, 12 * 3_600_000);
  const guild = new FakeGuild();
  welcome(guild.id, '910000000000000011', 40, Date.now());
  await timer.fn(guild.client);
  assert.equal(db.guild(guild.id).promos.length, 0);
});
