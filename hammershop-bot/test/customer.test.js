'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const customers = require('../src/features/customers');

const commands = loadCommands();

let n = 960000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const DAY = 86_400_000;

let guild;
test.before(async () => {
  guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
});

const run = async (args) => {
  const i = createInteraction({ guild, ...args });
  await handle(i, commands);
  return i;
};
const customer = (who, subcommand, options) => run({ member: who, kind: 'command', commandName: 'customer', subcommand, options });

let ticketNo = 0;
function ticket(ownerId, patch = {}) {
  ticketNo += 1;
  return db.createTicket({ channelId: uid(), guildId: guild.id, number: ticketNo, typeId: 'order', ownerId, status: 'open', createdAt: Date.now(), ...patch });
}

function sale(userId, patch = {}) {
  return db.addSale(guild.id, {
    id: `S-${uid()}`,
    ticketNumber: 1,
    channelId: uid(),
    userId,
    sellerId: guild.ownerId,
    productId: null,
    product: 'Nitro Boost',
    quantity: 1,
    amount: 10,
    currency: '€',
    method: 'PaysafeCard',
    promo: null,
    discount: 0,
    createdAt: Date.now() - DAY,
    completedAt: Date.now() - DAY,
    ...patch,
  });
}

test('/customer view: orders, total spent, tickets, vouches, blacklist, invites and notes on one private card', async () => {
  const buyer = member(guild, ['member', 'customer', 'loyal']);
  const support = member(guild, ['member', 'support']);
  const mod = member(guild, ['member', 'moderator']);
  const inviter = member(guild);
  const g = db.guild(guild.id);

  g.orders[buyer.id] = 6;
  const amounts = [10, 20, null, 15, 5, 30];
  amounts.forEach((amount, i) => sale(buyer.id, { ticketNumber: 100 + i, product: `Product ${i}`, amount, completedAt: Date.now() - (10 - i) * DAY, promo: i === 5 ? 'NOX10' : null }));
  sale(uid(), { amount: 999 }); // someone else
  ticket(buyer.id);
  ticket(buyer.id);
  ticket(buyer.id, { status: 'closed', closedAt: Date.now() });
  ticket(buyer.id, { status: 'deleted' });
  db.createTicket({ channelId: uid(), guildId: 'another-guild', number: 1, ownerId: buyer.id, status: 'open' });
  g.vouches.push({ n: 1, userId: buyer.id, rating: 5, at: Date.now() }, { n: 2, userId: buyer.id, rating: 4, at: Date.now() }, { n: 3, userId: uid(), rating: 1, at: Date.now() });
  db.addBlacklist(guild.id, { userId: buyer.id, reason: 'Chargeback on PayPal', by: mod.id, at: Date.now() });
  g.invites.members[buyer.id] = { inviterId: inviter.id, code: 'nox', at: Date.now() };
  g.invites.members[uid()] = { inviterId: buyer.id, at: Date.now() };
  g.invites.members[uid()] = { inviterId: buyer.id, at: Date.now(), left: true };
  customers.addNote(guild.id, buyer.id, { by: support.id, text: 'Prefers crypto.\nAsks for fast delivery.' });

  const i = await customer(support, 'view', { user: buyer.user });
  const res = lastResponse(i);
  assert.ok(res.flags & MessageFlags.Ephemeral, 'private');
  assert.ok(res.flags & MessageFlags.IsComponentsV2);
  assert.deepEqual(res.allowedMentions, { parse: [] }, 'mentions never ping');
  const card = textOf(res);
  assert.match(card, new RegExp(`<@${buyer.id}> · \`user${buyer.id}\``));
  assert.match(card, new RegExp(`<@&${role(guild, 'loyal')}> <@&${role(guild, 'customer')}>`), 'customer badges');
  assert.match(card, /\*\*Na serwerze od:\*\* <t:\d+:D>/);
  assert.match(card, /\*\*Konto założone:\*\* <t:\d+:D> \(<t:\d+:R>\)/);
  assert.match(card, /\*\*Weryfikacja:\*\* ✅ Tak/);
  assert.match(card, /\*\*Czarna lista:\*\* ⛔ \*\*Tak\*\* – Chargeback on PayPal/);
  assert.match(card, new RegExp(`\\*\\*Zaproszenie od:\\*\\* <@${inviter.id}>  ·  \\*\\*Zaproszenia:\\*\\* 2 \\(w tym 1 poza serwerem\\)`));
  assert.match(card, /\*\*Zrealizowane zamówienia:\*\* 6  ·  \*\*Wydano łącznie:\*\* 80€ \(\+1 zamówienie bez znanej kwoty\)/);
  assert.match(card, /Ostatnie 5 zamówień/);
  assert.match(card, /`#0105` · \*\*Product 5\*\* × 1 · 30€ · 🏷️ NOX10/);
  assert.match(card, /`#0102` · \*\*Product 2\*\* × 1 · kwota nieznana/);
  assert.doesNotMatch(card, /Product 0/, 'only the last 5 orders');
  assert.ok(card.indexOf('Product 5') < card.indexOf('Product 1'), 'newest first');
  assert.match(card, /\*\*Tickety:\*\* otwarte: 2 · zamknięte: 2  → <#\d+> <#\d+>/);
  assert.match(card, /\*\*Wystawione opinie:\*\* 2  ·  \*\*Średnia ocena:\*\* ⭐ \*\*4\.50\*\*/);
  assert.match(card, new RegExp(`Notatki zespołu \\(1\\)\\n\\*\\*#1\\*\\* · <@${support.id}> · <t:\\d+:R>\\n> Prefers crypto\\.\\n> Asks for fast delivery\\.`));
  assert.match(card, /Ten profil i jego notatki widzi tylko zespół/);
  assert.deepEqual(customIds(res), [`customer:note:${buyer.id}`]);
});

test('/customer: staff only – members can neither see profiles nor add notes', async () => {
  const buyer = member(guild);
  const nosy = member(guild, ['member', 'customer', 'vip']);
  const view = await customer(nosy, 'view', { user: buyer.user });
  assert.match(textOf(lastResponse(view)), /dostępne tylko dla zespołu/);
  assert.doesNotMatch(textOf(lastResponse(view)), /Zrealizowane zamówienia/);
  const add = await customer(nosy, 'add', { user: buyer.user, text: 'hello' });
  assert.match(textOf(lastResponse(add)), /dostępne tylko dla zespołu/);
  assert.deepEqual(customers.notesOf(guild.id, buyer.id), []);
  const button = await run({ member: nosy, kind: 'button', customId: `customer:note:${buyer.id}` });
  assert.equal(button.state.modals.length, 0);
  assert.match(textOf(lastResponse(button)), /dostępne tylko dla zespołu/);
  const form = await run({ member: nosy, kind: 'modal', customId: `customer:note:${buyer.id}`, fields: { text: 'sneaky' } });
  assert.match(textOf(lastResponse(form)), /dostępne tylko dla zespołu/);
  assert.deepEqual(customers.notesOf(guild.id, buyer.id), []);

  const auto = createInteraction({ guild, member: nosy, kind: 'autocomplete', commandName: 'customer' });
  auto.options.get = () => ({ value: buyer.id });
  await handle(auto, commands);
  assert.deepEqual(auto.state.responded, [], 'no note suggestions for members');

  const bot = await customer(member(guild, ['member', 'support']), 'view', { user: { ...buyer.user, bot: true } });
  assert.match(textOf(lastResponse(bot)), /Boty nie mają profili klientów/);
});

test('/customer note add | remove: up to 500 characters, own notes – moderators can remove any', async () => {
  const buyer = member(guild);
  const support = member(guild, ['member', 'support']);
  const seller = member(guild, ['member', 'seller']);
  const mod = member(guild, ['member', 'moderator']);

  const added = await customer(support, 'add', { user: buyer.user, text: '  Paid late twice  ' });
  const res = lastResponse(added);
  assert.ok(res.flags & MessageFlags.Ephemeral);
  assert.match(textOf(res), /Notatka \*\*#1\*\* o <@\d+> zapisana/);
  await customer(seller, 'add', { user: buyer.user, text: 'VIP candidate' });
  assert.deepEqual(customers.notesOf(guild.id, buyer.id).map((x) => [x.id, x.by, x.text]), [[1, support.id, 'Paid late twice'], [2, seller.id, 'VIP candidate']]);

  const tooLong = await customer(support, 'add', { user: buyer.user, text: 'x'.repeat(501) });
  assert.match(textOf(lastResponse(tooLong)), /maks\. 500 znaków/);
  const blank = await customer(support, 'add', { user: buyer.user, text: '   ' });
  assert.match(textOf(lastResponse(blank)), /Notatka jest pusta/);
  assert.equal(customers.notesOf(guild.id, buyer.id).length, 2);

  // Suggestions for "id": the notes of the chosen user, newest first
  const auto = createInteraction({ guild, member: support, kind: 'autocomplete', commandName: 'customer', focused: '' });
  auto.options.get = (name) => (name === 'user' ? { value: buyer.id } : null);
  await handle(auto, commands);
  assert.deepEqual(auto.state.responded, [{ name: '#2 · VIP candidate', value: 2 }, { name: '#1 · Paid late twice', value: 1 }]);

  const notMine = await customer(support, 'remove', { user: buyer.user, id: 2 });
  assert.match(textOf(lastResponse(notMine)), /możesz usuwać tylko swoje notatki/);
  const missing = await customer(support, 'remove', { user: buyer.user, id: 9 });
  assert.match(textOf(lastResponse(missing)), /nie ma notatki \*\*#9\*\*/);
  const own = await customer(support, 'remove', { user: buyer.user, id: 1 });
  assert.match(textOf(lastResponse(own)), /Usunięto notatkę \*\*#1\*\*/);
  const byMod = await customer(mod, 'remove', { user: buyer.user, id: 2 });
  assert.match(textOf(lastResponse(byMod)), /Usunięto notatkę \*\*#2\*\*/);
  assert.equal(db.guild(guild.id).notes[buyer.id], undefined, 'no empty list left behind');

  for (let k = 0; k < customers.MAX_NOTES; k += 1) customers.addNote(guild.id, buyer.id, { by: support.id, text: `note ${k}` });
  const full = await customer(support, 'add', { user: buyer.user, text: 'one more' });
  assert.match(textOf(lastResponse(full)), /ma już 50 notatek/);
});

test('"Add note" button on a profile → form → the note is saved and the profile refreshed', async () => {
  const buyer = member(guild);
  const support = member(guild, ['member', 'support']);
  const view = await customer(support, 'view', { user: buyer.user });
  assert.match(textOf(lastResponse(view)), /Notatki zespołu \(0\)[\s\S]*Brak notatek/);

  const button = await run({ member: support, kind: 'button', customId: `customer:note:${buyer.id}` });
  const modal = button.state.modals[0];
  assert.equal(modal.custom_id, `customer:note:${buyer.id}`);
  assert.equal(modal.components[0].component.max_length, 500);

  const submit = await run({ member: support, kind: 'modal', customId: `customer:note:${buyer.id}`, fields: { text: 'Asked for a refund, solved.' }, message: { id: 'profile' } });
  assert.deepEqual([submit.state.replies.length, submit.state.edits.length], [0, 1], 'the profile card is updated in place');
  assert.match(textOf(submit.state.edits[0]), /Notatki zespołu \(1\)[\s\S]*Asked for a refund, solved\./);
  assert.equal(customers.notesOf(guild.id, buyer.id)[0].by, support.id);
});

test('"Add note" answers in time: the form opens without an API call, the saved form is acknowledged before fetching', async () => {
  const support = member(guild, ['member', 'support']);
  const buyer = member(guild);
  const calls = [];
  const users = guild.client.users;
  const realUsers = users.fetch;
  const realMembers = guild.members.fetch;
  let current = null;
  users.fetch = async (id) => {
    calls.push(['user', current?.deferred ?? false]);
    return realUsers.call(users, id);
  };
  guild.members.fetch = async (arg) => {
    calls.push(['member', current?.deferred ?? false]);
    return realMembers.call(guild.members, arg);
  };
  try {
    current = createInteraction({ guild, member: support, kind: 'button', customId: `customer:note:${buyer.id}` });
    await handle(current, commands);
    assert.equal(current.state.modals.length, 1);
    assert.equal(current.state.modals[0].title, `Notatka – user${buyer.id}`, 'the name comes from the cache');
    assert.deepEqual(calls, [], 'no API call before the form (it must open within 3 seconds)');

    // A customer who left: fetching them is a slow API call (404), so the form is acknowledged first
    const ghost = uid();
    guild.unknownMembers = new Set([ghost]);
    current = createInteraction({ guild, member: support, kind: 'modal', customId: `customer:note:${ghost}`, fields: { text: 'Left after a refund.' }, message: { id: 'profile' } });
    await handle(current, commands);
    assert.ok(calls.length > 0 && calls.every(([, deferred]) => deferred), 'deferred before fetching');
    const card = textOf(lastResponse(current));
    assert.match(card, /\*\*Na serwerze od:\*\* — \(poza serwerem\)/);
    assert.match(card, /Left after a refund\./);
  } finally {
    users.fetch = realUsers;
    guild.members.fetch = realMembers;
    guild.unknownMembers = null;
  }
});

test('profile of someone who left, with odd invite data, and with many long notes stays within limits', async () => {
  const ghost = { id: uid(), bot: false, username: 'ghost', globalName: null, createdTimestamp: Date.now() - 30 * DAY, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/2.png' };
  guild.unknownMembers = new Set([ghost.id]);
  const support = member(guild, ['member', 'support']);
  const g = db.guild(guild.id);
  g.invites = { members: { [ghost.id]: 'not-an-id' }, inviters: { [ghost.id]: { total: 9, left: 2 } } };

  const view = await customer(support, 'view', { user: ghost });
  const card = textOf(lastResponse(view));
  assert.match(card, /\*\*Na serwerze od:\*\* — \(poza serwerem\)/);
  assert.match(card, /\*\*Weryfikacja:\*\* —/);
  assert.match(card, /\*\*Zaproszenie od:\*\* —  ·  \*\*Zaproszenia:\*\* 9 \(w tym 2 poza serwerem\)/);
  assert.match(card, /\*\*Zrealizowane zamówienia:\*\* 0  ·  \*\*Wydano łącznie:\*\* 0€/);
  assert.match(card, /Brak zrealizowanych zamówień/);

  // The invites feature may store its data in other shapes – or not at all
  const shapes = [
    [{ members: 'oops', inviters: 5 }, { inviterId: null, count: 0, left: null }],
    [{ members: {}, inviters: { [ghost.id]: 7 } }, { inviterId: null, count: 7, left: null }],
    [{ members: { [ghost.id]: support.id }, inviters: { [ghost.id]: ['a', 'b'] } }, { inviterId: support.id, count: 2, left: null }],
    [{ members: { [ghost.id]: { by: support.id } }, inviters: { [ghost.id]: { regular: 4, fake: 1 } } }, { inviterId: support.id, count: 4, left: null }],
  ];
  for (const [invites, expected] of shapes) {
    g.invites = invites;
    assert.deepEqual(customers.inviteInfo(guild.id, ghost.id), expected);
  }
  g.invites = { members: {}, inviters: {}, rewarded: {} };

  for (let k = 0; k < customers.MAX_NOTES; k += 1) customers.addNote(guild.id, ghost.id, { by: support.id, text: `${k} ${'n'.repeat(495)}` });
  for (let k = 0; k < 20; k += 1) sale(ghost.id, { product: 'P'.repeat(100), promo: 'X'.repeat(24), amount: 123456.78 });
  const full = customers.profileCard(guild, ghost, null);
  const r = validateMessage(full, guild);
  assert.ok(r.textLength <= 4000 && r.total <= 40);
  assert.match(textOf(full), /Notatki zespołu \(50\)[\s\S]*…i jeszcze \d+ (starsza notatka|starsze notatki|starszych notatek)/);
  assert.match(textOf(full), /\*\*#50\*\*/, 'the newest note is shown');
  guild.unknownMembers = null;
});
