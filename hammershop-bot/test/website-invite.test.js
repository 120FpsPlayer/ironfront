'use strict';

// The invite the website and Hammer Launcher hand out: replaced when Discord stops taking it, never the owner's own.
const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { env } = require('../src/env');
const website = require('../src/features/website');

test('a stale invite (a rebuild deleted its channel, it ran out) is replaced; a hiccup at Discord changes nothing; DISCORD_INVITE_URL is never replaced', async () => {
  const guild = new FakeGuild();
  website._setClient(guild.client);
  const channel = [...guild.channels.cache.values()].find((c) => c.type === ChannelType.GuildText) ?? (await guild.channels.create({ name: 'ogolny', type: ChannelType.GuildText }));
  let made = 0;
  const asked = [];
  channel.createInvite = async (options) => {
    asked.push(options);
    made += 1;
    return { code: `nowe${made}` };
  };
  const before = env.web.invite;
  env.web.invite = null;
  try {
    db.guild(guild.id).webInvite = { code: 'stare', url: 'https://discord.gg/stare' };
    guild.client.fetchInvite = async () => {
      throw Object.assign(new Error('Invite is expired.'), { status: 404, code: 50270 });
    };
    await website.checkInvite(guild, { force: true });
    assert.equal(website.inviteOf(), 'https://discord.gg/nowe1');
    assert.deepEqual(asked[0], { maxAge: 0, maxUses: 0, unique: false, reason: 'Strona HammerShop – przycisk Pomoc / społeczność' }, 'a permanent one');

    // Discord cannot be reached, then answers fine: the invite stays.
    guild.client.fetchInvite = async () => {
      throw new Error('ECONNRESET');
    };
    await website.checkInvite(guild, { force: true });
    guild.client.fetchInvite = async () => ({ guild: { id: guild.id }, expiresTimestamp: null });
    await website.checkInvite(guild, { force: true });
    assert.equal(website.inviteOf(), 'https://discord.gg/nowe1');
    // An invite that leads to another server is no good either.
    guild.client.fetchInvite = async () => ({ guild: { id: 'inny-serwer' }, expiresTimestamp: null });
    await website.checkInvite(guild, { force: true });
    assert.equal(website.inviteOf(), 'https://discord.gg/nowe2');
    // Not asked again within half an hour.
    guild.client.fetchInvite = async () => {
      throw Object.assign(new Error('Unknown Invite'), { status: 404, code: 10006 });
    };
    await website.checkInvite(guild);
    assert.equal(made, 2);

    // Invites paused on the server (Server settings → Invites, or a security action): no new invite – it would not
    // work either – and the console says how to resume them.
    const warned = [];
    const warn = console.warn;
    console.warn = (...a) => warned.push(a.join(' '));
    try {
      guild.features = ['INVITES_DISABLED'];
      assert.equal(website.invitesPaused(guild), true);
      await website.checkInvite(guild, { force: true });
      guild.features = [];
      guild.incidentsData = { invitesDisabledUntil: new Date(Date.now() + 3600_000) };
      assert.equal(website.invitesPaused(guild), true);
      await website.checkInvite(guild, { force: true });
      guild.incidentsData = { invitesDisabledUntil: new Date(Date.now() - 1000) };
      assert.equal(website.invitesPaused(guild), false, 'a pause that is over');
      guild.incidentsData = null;
    } finally {
      console.warn = warn;
    }
    assert.equal(made, 2, 'nothing replaced while invites are paused');
    assert.equal(warned.filter((w) => /WSTRZYMANE/.test(w)).length, 1, 'said once, not every half hour');
    assert.match(warned[0], /Wznów zaproszenia/);

    // The owner's own invite from .env wins and is only reported, never replaced.
    env.web.invite = 'https://discord.gg/mojeNaZawsze';
    await website.checkInvite(guild, { force: true });
    assert.equal(website.inviteOf(), 'https://discord.gg/mojeNaZawsze');
    assert.equal(made, 2);
    assert.equal(website.ownInviteFailing(), true, 'the admin panel says so');
    guild.client.fetchInvite = async () => ({ guild: { id: guild.id }, expiresTimestamp: null });
    await website.checkInvite(guild, { force: true });
    assert.equal(website.ownInviteFailing(), false);
  } finally {
    env.web.invite = before;
  }
});
