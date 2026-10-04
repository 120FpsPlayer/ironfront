'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const commands = require('../src/commands')();

function apiError(code, message) {
  return Object.assign(new Error(message), { code, status: code === 10062 ? 404 : 400 });
}

async function capture(fn) {
  const lines = { warn: [], error: [] };
  const warn = console.warn;
  const error = console.error;
  console.warn = (...a) => lines.warn.push(a.join(' '));
  console.error = (...a) => lines.error.push(a.join(' '));
  try {
    await fn();
  } finally {
    console.warn = warn;
    console.error = error;
  }
  return lines;
}

test('a form answered too late (10062) gives one clear console line, no stack trace and no ticket', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const member = guild.addMember('950000000000000001', [db.roleId(guild.id, 'member')]);
  const i = createInteraction({ guild, member, kind: 'modal', customId: 'ticket:form:support:b', fields: { subject: 'Help', details: 'x' } });
  i.createdTimestamp = Date.now() - 4200;
  let replies = 0;
  i.deferReply = async () => {
    throw apiError(10062, 'Unknown interaction');
  };
  i.reply = async () => {
    replies += 1;
  };
  const before = db.tickets(() => true).length;
  const lines = await capture(() => handle(i, commands));
  assert.deepEqual(lines.error, [], 'no stack trace');
  assert.equal(lines.warn.length, 1);
  assert.match(lines.warn[0], /expired before the bot could answer \(Discord allows 3 s, it was 4\.\d s old\)/);
  assert.match(lines.warn[0], /ticket:form:support:b/);
  assert.equal(replies, 0, 'no pointless reply attempt');
  assert.equal(db.tickets(() => true).length, before, 'no ticket was created');
});

test('an interaction already answered elsewhere (40060) points to a second bot process', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const member = guild.addMember('950000000000000002', [db.roleId(guild.id, 'member')]);
  const i = createInteraction({ guild, member, kind: 'modal', customId: 'ticket:form:support:b', fields: { subject: 'Help', details: 'x' } });
  i.deferReply = async () => {
    throw apiError(40060, 'Interaction has already been acknowledged.');
  };
  const lines = await capture(() => handle(i, commands));
  assert.deepEqual(lines.error, []);
  assert.match(lines.warn.join('\n'), /running twice with the same token/);
});
