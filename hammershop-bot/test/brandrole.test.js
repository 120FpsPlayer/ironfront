'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const hooks = require('../src/lib/hooks');
const { buildServer } = require('../src/builder/executor');
const { addMissing } = require('../src/builder/update');
const { ensureBrandRole } = require('../src/features/brandrole');
const { ROLES } = require('../src/builder/layout');

const roleOf = (guild, key) => guild.roles.cache.get(db.roleId(guild.id, key));
const below = (guild, role) => [...guild.roles.cache.values()].filter((r) => r.position > role.position);

async function built(opts = {}) {
  const guild = new FakeGuild(opts);
  const R = await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  assert.deepEqual(R.errors, []);
  return { guild, R };
}

test('the bot gets its own HammerShop role: the highest role it can give, hoisted, right under its integration role', async () => {
  const { guild } = await built();
  const brand = roleOf(guild, 'brand');
  assert.equal(ROLES[0].key, 'brand', 'first in layout.js');
  assert.equal(brand.name, '🔨 HammerShop');
  assert.ok(brand.hoist, 'shown separately in the member list');
  assert.equal(brand.permissions.bitfield, 0n, 'only a badge – it grants nothing');
  const botRole = [...guild.roles.cache.values()].find((r) => r.managed);
  assert.equal(brand.position, botRole.position - 1, 'right under the bot integration role');
  assert.deepEqual(below(guild, brand).map((r) => r.id), [botRole.id], 'nothing else above it');
  // The rest of the team follows: CEO → Co-CEO → Manager …
  const ceo = roleOf(guild, 'founder');
  assert.equal(ceo.name, '👑 CEO');
  assert.ok(ceo.position < brand.position);
  assert.ok(roleOf(guild, 'coowner').position < ceo.position);
  assert.ok(guild.members.me.roles.cache.has(brand.id), 'the bot has it');
  assert.ok(guild.members.me.roles.cache.has(roleOf(guild, 'bots').id));
  const owner = guild.members.cache.get(guild.ownerId);
  assert.ok(owner.roles.cache.has(ceo.id), 'the owner is the CEO');
  assert.ok(!owner.roles.cache.has(brand.id), 'but not the bot role');
  assert.deepEqual([...guild.members.cache.values()].filter((m) => m.roles.cache.has(brand.id)).map((m) => m.id), [guild.members.me.id]);
});

test('only the bot has it: somebody who gets the role loses it right away, and ensureBrandRole cleans up too', async () => {
  const { guild } = await built();
  const brand = roleOf(guild, 'brand');
  const human = guild.addMember('5005', [roleOf(guild, 'member').id]);
  const before = human.snapshot();
  human.roles.cache.set(brand.id, brand); // given by hand in Server Settings
  await hooks.emit('memberUpdate', before, human);
  assert.ok(!human.roles.cache.has(brand.id));

  const other = guild.addMember('5006', [brand.id]);
  const res = await ensureBrandRole(guild);
  assert.equal(res.removed, 1);
  assert.ok(!other.roles.cache.has(brand.id));
  assert.ok(guild.members.me.roles.cache.has(brand.id));
  // The bot losing its other roles never takes this one away.
  await hooks.emit('memberUpdate', guild.members.me.snapshot(), guild.members.me);
  assert.ok(guild.members.me.roles.cache.has(brand.id));
});

test('/build only:update on a server built with the old version: adds the HammerShop role on top, renames and recolours the old roles', async () => {
  const { guild } = await built();
  const build = db.build(guild.id);
  // Like a server built before the rename: purple Founder / Co-Founder / Manager, no bot role yet.
  const brand = roleOf(guild, 'brand');
  guild.members.me.roles.cache.delete(brand.id);
  guild.roles.cache.delete(brand.id);
  const roles = { ...build.roles };
  delete roles.brand;
  db.setBuild(guild.id, { ...build, roles });
  Object.assign(roleOf(guild, 'founder'), { name: '👑 Founder', color: 0xd8b4fe });
  Object.assign(roleOf(guild, 'coowner'), { name: '💠 Co-Founder', color: 0xc77dff });
  Object.assign(roleOf(guild, 'manager'), { name: 'Shop boss', color: 0x123456 }); // renamed by the owner – stays
  Object.assign(roleOf(guild, 'admin'), { color: 0xa855f7 });

  const res = await addMissing(guild);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.roles, ['🔨 HammerShop']);
  const newBrand = roleOf(guild, 'brand');
  const botRole = [...guild.roles.cache.values()].find((r) => r.managed);
  assert.equal(newBrand.position, botRole.position - 1);
  assert.ok(guild.members.me.roles.cache.has(newBrand.id));
  assert.equal(roleOf(guild, 'founder').name, '👑 CEO');
  assert.equal(roleOf(guild, 'founder').color, 0xffe0b8);
  assert.equal(roleOf(guild, 'coowner').name, '🔱 Co-CEO');
  assert.equal(roleOf(guild, 'manager').name, 'Shop boss', 'a name the owner chose is kept');
  assert.equal(roleOf(guild, 'manager').color, 0x123456, 'and so is their colour');
  assert.equal(roleOf(guild, 'admin').color, 0xffa94d, 'old purple → orange');
  assert.ok(res.restyled.includes('👑 CEO') && res.restyled.includes('🛡️ Administrator'));

  const again = await addMissing(guild);
  assert.deepEqual([again.roles, again.restyled], [[], []], 'running it again changes nothing');
});
