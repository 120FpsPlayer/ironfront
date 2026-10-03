'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { CATEGORIES } = require('../src/builder/layout');
const handle = require('../src/handlers/interactions');
const commands = require('../src/commands')();

test('/build only:update adds channels and roles from a newer layout to an existing server', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  // A server built with an older version: no #proofs, #sales, #backups, shop status channel or Partner role.
  const b = db.build(guild.id);
  const before = guild.channels.cache.size;
  for (const key of ['proofs', 'sales', 'backups', 'statShop']) {
    await guild.channels.cache.get(b.channels[key]).delete();
    delete b.channels[key];
    delete b.posts?.[key];
  }
  await guild.roles.cache.get(b.roles.partner).delete();
  delete b.roles.partner;
  db.setBuild(guild.id, b);

  const owner = guild.members.cache.get(guild.ownerId);
  const i = createInteraction({ guild, member: owner, kind: 'command', commandName: 'build', options: { only: 'update' } });
  await handle(i, commands);
  const out = textOf(lastResponse(i));
  assert.match(out, /Server updated/);
  assert.match(out, /ᴘʀᴏᴏꜰꜱ/);
  assert.equal(guild.channels.cache.size, before, 'the 4 channels are back, nothing else was added');
  const now = db.build(guild.id);
  for (const key of ['proofs', 'sales', 'backups', 'statShop']) assert.ok(guild.channels.cache.has(now.channels[key]), key);
  assert.ok(guild.roles.cache.has(now.roles.partner), 'Partner role re-created');
  const proofs = guild.channels.cache.get(now.channels.proofs);
  assert.equal(proofs.parentId, now.categories.catShop);
  assert.equal(proofs.messageList.length, 2, 'banner + intro card');
  assert.deepEqual(now.posts.proofs.map((p) => p.type), ['banner', 'card']);
  // VIP channel lets partners in again (overwrites use the new role).
  const vip = guild.channels.cache.get(now.channels.vipChat);
  const partner = guild.addMember('940000000000000001', [now.roles.member, now.roles.partner]);
  assert.ok(vip.permissionsFor(partner).has(PermissionFlagsBits.ViewChannel), 'partners see the VIP lounge again');
  // Running it again changes nothing.
  const again = createInteraction({ guild, member: owner, kind: 'command', commandName: 'build', options: { only: 'update' } });
  await handle(again, commands);
  assert.match(textOf(lastResponse(again)), /nothing – the server already has every channel and role/);
  assert.equal(guild.channels.cache.size, before);
  assert.equal(CATEGORIES.flatMap((c) => c.channels).filter((ch) => !guild.channels.cache.has(now.channels[ch.key])).length, 0);
});
