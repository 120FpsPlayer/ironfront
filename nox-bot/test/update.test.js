'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { CATEGORIES } = require('../src/builder/layout');
const handle = require('../src/handlers/interactions');
const commands = require('../src/commands')();

test('/build only:update adds channels and roles from a newer layout to an existing server', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  // A server built with an older version: no #proofs, #sales, #backups, shop status channel or Seller role.
  const b = db.build(guild.id);
  const before = guild.channels.cache.size;
  for (const key of ['proofs', 'sales', 'backups', 'statShop']) {
    await guild.channels.cache.get(b.channels[key]).delete();
    delete b.channels[key];
    delete b.posts?.[key];
  }
  await guild.roles.cache.get(b.roles.seller).delete();
  delete b.roles.seller;
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
  assert.ok(guild.roles.cache.has(now.roles.seller), 'Seller role re-created');
  const proofs = guild.channels.cache.get(now.channels.proofs);
  assert.equal(proofs.parentId, now.categories.catShop);
  assert.equal(proofs.messageList.length, 2, 'banner + intro card');
  assert.deepEqual(now.posts.proofs.map((p) => p.type), ['banner', 'card']);
  // Sellers can post restocks again (channel overwrites use the new role).
  const restocks = guild.channels.cache.get(now.channels.restocks);
  const seller = guild.addMember('940000000000000001', [now.roles.member, now.roles.seller]);
  assert.ok(restocks.permissionsFor(seller).has(PermissionFlagsBits.SendMessages), 'sellers post in #restocks again');
  // Running it again changes nothing.
  const again = createInteraction({ guild, member: owner, kind: 'command', commandName: 'build', options: { only: 'update' } });
  await handle(again, commands);
  assert.match(textOf(lastResponse(again)), /nothing – the server already has every channel and role/);
  assert.equal(guild.channels.cache.size, before);
  assert.equal(CATEGORIES.flatMap((c) => c.channels).filter((ch) => !guild.channels.cache.has(now.channels[ch.key])).length, 0);
});

test('/build only:update removes what the bot made earlier but no longer belongs (VIP, voice, #memes…), never your own channels', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  // A server built by an older version still has the VIP lounge, a voice category, #memes, #commands and the VIP / Partner roles.
  const b = db.build(guild.id);
  const make = (name, type, parent) => guild.channels.create({ name, type, parent });
  const vipCat = await make('〔 💎 VIP LOUNGE 〕', ChannelType.GuildCategory);
  const voiceCat = await make('〔 🔊 VOICE 〕', ChannelType.GuildCategory);
  b.categories.catVip = vipCat.id;
  b.categories.catVoice = voiceCat.id;
  b.channels.vipChat = (await make('💎┃ᴠɪᴘ-ᴄʜᴀᴛ', ChannelType.GuildText, vipCat.id)).id;
  b.channels.lounge = (await make('🔊┃ʟᴏᴜɴɢᴇ', ChannelType.GuildVoice, voiceCat.id)).id;
  b.channels.memes = (await make('😂┃ᴍᴇᴍᴇꜱ', ChannelType.GuildText, b.categories.catCommunity)).id;
  const commandsChannel = await make('🤖┃ᴄᴏᴍᴍᴀɴᴅꜱ', ChannelType.GuildText, b.categories.catCommunity);
  b.channels.commands = commandsChannel.id;
  b.posts.memes = [{ type: 'card', id: '1' }];
  b.roles.vip = (await guild.roles.create({ name: '💎 VIP', permissions: 0n })).id;
  b.roles.partner = (await guild.roles.create({ name: '🤝 Partner', permissions: 0n })).id;
  db.setBuild(guild.id, b);
  const mine = await make('my-own-channel', ChannelType.GuildText, b.categories.catCommunity);
  const myRole = await guild.roles.create({ name: 'My own role', permissions: 0n });

  // Run in #commands: that one is kept (the answer goes there) and reported.
  const owner = guild.members.cache.get(guild.ownerId);
  const i = createInteraction({ guild, member: owner, kind: 'command', commandName: 'build', options: { only: 'update' }, channel: commandsChannel });
  await handle(i, commands);
  const out = textOf(lastResponse(i));
  assert.match(out, /Removed \(no longer part of the server\)/);
  assert.match(out, /ᴠɪᴘ-ᴄʜᴀᴛ/);
  assert.match(out, /💎 VIP/);
  assert.match(out, /kept because you ran the update in it/);
  const now = db.build(guild.id);
  for (const id of [vipCat.id, voiceCat.id, b.channels.vipChat, b.channels.lounge, b.channels.memes]) assert.ok(!guild.channels.cache.has(id), 'retired channel deleted');
  assert.ok(guild.channels.cache.has(commandsChannel.id), 'the channel the update ran in is kept');
  for (const key of ['vipChat', 'lounge', 'memes', 'catVip', 'catVoice']) assert.equal(now.channels[key] ?? now.categories[key], undefined, `${key} forgotten`);
  assert.equal(now.posts.memes, undefined);
  assert.ok(!guild.roles.cache.has(b.roles.vip) && !guild.roles.cache.has(b.roles.partner), 'VIP and Partner roles deleted');
  assert.equal(now.roles.vip, undefined);
  assert.ok(guild.channels.cache.has(mine.id) && guild.roles.cache.has(myRole.id), 'your own channels and roles are never touched');
  for (const key of ['shop', 'chat', 'staffVoice']) assert.ok(guild.channels.cache.has(now.channels[key]), `#${key} stays`);

  // From another channel the leftover goes too.
  const again = createInteraction({ guild, member: owner, kind: 'command', commandName: 'build', options: { only: 'update' } });
  await handle(again, commands);
  assert.ok(!guild.channels.cache.has(commandsChannel.id));
});
