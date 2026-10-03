'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const backups = require('../src/features/backups');

const commands = loadCommands();

let n = 970000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const HOUR = 3_600_000;
const at = (iso) => Date.parse(iso);

async function newGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

/** A server with some data: a product, a sale, a vouch, a note and an open + a closed ticket. */
function fill(guild, tag) {
  const g = db.guild(guild.id);
  g.products.push({ id: `p-${tag}`, name: `Product ${tag}`, price: '10' });
  db.addSale(guild.id, { id: `S-${tag}`, userId: uid(), amount: 10, product: `Product ${tag}`, completedAt: Date.now() });
  g.vouches.push({ n: 1, userId: uid(), rating: 5, review: `Great ${tag}`, at: Date.now() });
  g.notes[uid()] = [{ id: 1, by: guild.ownerId, text: `note ${tag}`, at: Date.now() }];
  db.save();
  const open = db.createTicket({ channelId: uid(), guildId: guild.id, number: 1, ownerId: uid(), status: 'open', answers: [{ label: 'x', value: tag }] });
  const closed = db.createTicket({ channelId: uid(), guildId: guild.id, number: 2, ownerId: uid(), status: 'closed' });
  return { open, closed };
}

const backupChannel = (guild) => guild.channels.cache.get(db.channelId(guild.id, 'backups'));
const unzip = (message) => JSON.parse(zlib.gunzipSync(message.files[0].attachment).toString('utf8'));

/** Like a restart: the in-memory data is dropped and read back from data/db.json. */
function restart() {
  db.flush();
  db._reset();
  db.load();
}

test('backup: a gzip of this server only – its guild record and its tickets, shaped like data/db.json', async () => {
  assert.ok(hooks.timers().some((t) => t.name === 'backups'), 'timer registered');
  const guild = await newGuild();
  const other = await newGuild();
  const mine = fill(guild, 'mine');
  const theirs = fill(other, 'theirs');

  const now = at('2026-10-03T14:05:00+02:00');
  await backups.runBackups(guild.client, now);
  const channel = backupChannel(guild);
  assert.equal(channel.messageList.length, 1);
  const message = channel.messageList[0];
  assert.equal(message.files.length, 1);
  assert.equal(message.files[0].name, 'nox-backup-2026-10-03-1405.json.gz', 'local time of the shop (Europe/Warsaw)');
  assert.equal(message.files[0].attachment[0], 0x1f, 'gzip magic bytes');
  assert.equal(message.files[0].attachment[1], 0x8b);

  const data = unzip(message);
  assert.deepEqual(Object.keys(data.guilds), [guild.id], 'only this server');
  assert.deepEqual(Object.keys(data.tickets).sort(), [mine.open.channelId, mine.closed.channelId].sort());
  assert.ok(!(theirs.open.channelId in data.tickets));
  assert.ok(Object.values(data.tickets).every((t) => t.guildId === guild.id));
  assert.equal(data.guilds[guild.id].products[0].name, 'Product mine');
  assert.equal(data.guilds[guild.id].sales[0].id, 'S-mine');
  assert.equal(data.guilds[guild.id].build.channels.backups, channel.id, 'channel and role IDs too');
  assert.doesNotMatch(JSON.stringify(data), /theirs/, 'nothing from the other server');
  assert.deepEqual({ ...data.backup, createdAt: undefined }, { app: 'nox-bot', version: 1, guildId: guild.id, guildName: guild.name, createdAt: undefined });

  const summary = textOf(message.body);
  assert.match(summary, /💾 Backup/);
  assert.match(summary, /Automatic backup \(every 24 h\)/);
  assert.match(summary, /Size \d+ (B|KB) \(\d+ KB unpacked\)/);
  assert.match(summary, /Tickets 2 \(1 open\)/);
  assert.match(summary, /Sales 1/);
  assert.match(summary, /How to restore[\s\S]*data\/db\.json/);
  assert.equal(other.channels.cache.get(db.channelId(other.id, 'backups')).messageList.length, 0, 'each server only gets its own');
});

test('backup: never more than once per period – also across restarts', async () => {
  const guild = await newGuild();
  fill(guild, 'a');
  const channel = backupChannel(guild);
  const t0 = at('2026-10-03T09:00:00+02:00');
  await Promise.all([backups.runBackups(guild.client, t0), backups.runBackups(guild.client, t0 + 1)]);
  assert.equal(channel.messageList.length, 1, 'two checks at the same time post one backup');
  await backups.runBackups(guild.client, t0 + 15 * 60_000);
  assert.equal(channel.messageList.length, 1);
  assert.equal(db.guild(guild.id).stats.backup.lastAt, t0);

  restart();
  await backups.runBackups(guild.client, t0 + HOUR);
  await backups.runBackups(guild.client, t0 + 24 * HOUR - 1);
  assert.equal(channel.messageList.length, 1, 'not again within 24 hours, even after a restart');
  assert.equal(backups.isDue(guild.id, t0 + 24 * HOUR - 1), false);

  await backups.runBackups(guild.client, t0 + 24 * HOUR);
  assert.equal(channel.messageList.length, 2, 'the next day');

  const before = config.backups.everyHours;
  config.backups.everyHours = 6;
  try {
    await backups.runBackups(guild.client, t0 + 29 * HOUR);
    assert.equal(channel.messageList.length, 2);
    await backups.runBackups(guild.client, t0 + 30 * HOUR);
    assert.equal(channel.messageList.length, 3, 'config.backups.everyHours');
  } finally {
    config.backups.everyHours = before;
  }

  config.backups.enabled = false;
  try {
    await backups.runBackups(guild.client, t0 + 100 * HOUR);
    assert.equal(channel.messageList.length, 3, 'turned off in config.json');
  } finally {
    config.backups.enabled = true;
  }
});

test('backup: over the size limit a warning is posted instead – once per period', async () => {
  const guild = await newGuild();
  fill(guild, 'big');
  const channel = backupChannel(guild);
  const limit = backups.LIMITS.maxBytes;
  backups.LIMITS.maxBytes = 200;
  try {
    const t0 = at('2026-10-04T03:00:00+02:00');
    await backups.runBackups(guild.client, t0);
    await backups.runBackups(guild.client, t0 + HOUR);
    assert.equal(channel.messageList.length, 1);
    const warning = channel.messageList[0];
    assert.equal(warning.files.length, 0, 'no file');
    assert.match(textOf(warning.body), /Backup too big to upload[\s\S]*Discord only takes files up to 200 B[\s\S]*data\/db\.json/);
    assert.equal(db.guild(guild.id).stats.backup.tooBig, true);
  } finally {
    backups.LIMITS.maxBytes = limit;
  }
  assert.equal(limit, 9 * 1024 * 1024, '9 MB by default (Discord takes 10 MB from bots)');
});

test('backup: a post that fails is retried at the next check; servers without #backups are skipped', async () => {
  const guild = await newGuild();
  const channel = backupChannel(guild);
  const t0 = at('2026-10-05T12:00:00+02:00');
  guild.channels.cache.delete(channel.id);
  await backups.runBackups(guild.client, t0);
  assert.equal(db.guild(guild.id).stats.backup, undefined, 'not remembered – nothing was posted');
  guild.channels.cache.set(channel.id, channel);
  await backups.runBackups(guild.client, t0 + 15 * 60_000);
  assert.equal(channel.messageList.length, 1);

  const bare = await newGuild();
  db.guild(bare.id).build.channels.backups = null;
  await backups.runBackups(bare.client, t0);
  assert.equal(db.guild(bare.id).stats.backup, undefined);
});

test('/backup: admins only – posts in #backups now and counts as the latest backup', async () => {
  const guild = await newGuild();
  fill(guild, 'cmd');
  const channel = backupChannel(guild);
  const backupCmd = async (who) => {
    const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'backup' });
    await handle(i, commands);
    return i;
  };

  for (const who of [member(guild), member(guild, ['member', 'moderator']), member(guild, ['member', 'seller'])]) {
    const denied = await backupCmd(who);
    assert.match(textOf(lastResponse(denied)), /Only administrators can make backups/);
  }
  assert.equal(channel.messageList.length, 0);

  const admin = member(guild, ['admin']);
  const i = await backupCmd(admin);
  assert.ok(i.deferred, 'deferred before the work');
  assert.equal(channel.messageList.length, 1);
  assert.match(textOf(channel.messageList[0].body), new RegExp(`Made by <@${admin.id}>`));
  assert.match(textOf(lastResponse(i)), new RegExp(`Backup saved in <#${channel.id}>: \\[\`nox-backup-[\\d-]+\\.json\\.gz\`\\]\\(https://discord\\.com/channels/`));
  assert.equal(backups.isDue(guild.id), false, 'the automatic one waits a full period');
  await backups.runBackups(guild.client);
  assert.equal(channel.messageList.length, 1);

  // Without a #backups channel the file comes in the (private) reply
  db.guild(guild.id).build.channels.backups = null;
  const here = await backupCmd(guild.members.cache.get(guild.ownerId));
  const res = lastResponse(here);
  assert.match(res.content, /There is no #backups channel/);
  assert.equal(res.files.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(zlib.gunzipSync(res.files[0].attachment)).guilds), [guild.id]);
  assert.equal(channel.messageList.length, 1);
  assert.deepEqual([here.state.replies.length, here.state.edits.length], [0, 1], 'answered through the deferred (ephemeral) reply');
});

test('restoring: the unzipped backup works as data/db.json', async () => {
  const guild = await newGuild();
  const { open } = fill(guild, 'restore');
  await backups.runBackups(guild.client, Date.now());
  const data = unzip(backupChannel(guild).messageList[0]);

  db.guild(guild.id).products = []; // something went wrong…
  db.flush();
  fs.writeFileSync(path.join(db.dataDir, 'db.json'), JSON.stringify(data)); // "rename it to db.json, put it into data/"
  db._reset();
  db.load();
  assert.equal(db.guild(guild.id).products[0].name, 'Product restore');
  assert.equal(db.getTicket(open.channelId).answers[0].value, 'restore');
  assert.equal(db.channelId(guild.id, 'backups'), backupChannel(guild).id);
});
