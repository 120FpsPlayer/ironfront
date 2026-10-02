'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const verification = require('../src/features/verification');
const config = require('../src/lib/config');

const commands = loadCommands();

let n = 900000000000000100n;
const uid = () => String(++n);

async function builtGuild(opts = {}) {
  const guild = new FakeGuild(opts);
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const role = (guild, key) => db.roleId(guild.id, key);
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const member = (guild, roles = ['member'], opts) => guild.addMember(uid(), roles.map((k) => role(guild, k)), opts);

// ───────────── Verification ─────────────

test('verification: math check → Member role, wrong answers and new accounts are refused', async () => {
  const guild = await builtGuild();
  const visitor = guild.addMember(uid(), []);
  const verify = ch(guild, 'verify');
  const panel = verify.messageList[1];
  assert.ok(customIds(panel.body).includes('verify:start'));

  const click = await run({ guild, member: visitor, kind: 'button', customId: 'verify:start', channel: verify });
  assert.equal(click.state.modals.length, 1);
  const modalId = click.state.modals[0].custom_id;
  const [, , a, b] = modalId.split(':');

  const wrong = await run({ guild, member: visitor, kind: 'modal', customId: modalId, fields: { answer: String(Number(a) + Number(b) + 1) }, channel: verify });
  assert.match(textOf(lastResponse(wrong)), /Wrong answer/);
  assert.ok(!visitor.roles.cache.has(role(guild, 'member')));

  const forged = await run({ guild, member: visitor, kind: 'modal', customId: `verify:answer:1:1:${'x'.repeat(12)}`, fields: { answer: '2' }, channel: verify });
  assert.match(textOf(lastResponse(forged)), /expired/);

  const right = await run({ guild, member: visitor, kind: 'modal', customId: modalId, fields: { answer: String(Number(a) + Number(b)) }, channel: verify });
  assert.match(textOf(lastResponse(right)), /You're verified/);
  assert.ok(visitor.roles.cache.has(role(guild, 'member')));
  assert.ok(ch(guild, 'verifyLogs').messageList.length >= 2, 'attempts are logged');

  const fresh = guild.addMember(uid(), [], { createdTimestamp: Date.now() - 3600_000 });
  const tooNew = await run({ guild, member: fresh, kind: 'button', customId: 'verify:start', channel: verify });
  assert.match(textOf(lastResponse(tooNew)), /too new/);
});

test('self roles: notification buttons toggle the ping roles', async () => {
  const guild = await builtGuild();
  const m = member(guild);
  const id = role(guild, 'pingRestocks');
  await run({ guild, member: m, kind: 'button', customId: 'sr:pingRestocks' });
  assert.ok(m.roles.cache.has(id));
  await run({ guild, member: m, kind: 'button', customId: 'sr:pingRestocks' });
  assert.ok(!m.roles.cache.has(id));
});

// ───────────── Shop → order ticket → completion → vouch ─────────────

test('shop: products, Buy → order form → ticket → order completed → Customer role → vouch', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);

  // A seller adds a product (announced in #restocks with the Restocks ping)
  const add = await run({ guild, member: seller, kind: 'command', commandName: 'product', subcommand: 'add', options: { name: 'Nitro Boost 1 Month', price: '€6.99', description: 'Instant delivery, full warranty.', emoji: '💎' } });
  assert.match(textOf(lastResponse(add)), /Added \*\*Nitro Boost 1 Month\*\*/);
  const restock = ch(guild, 'restocks').messageList.at(-1);
  assert.match(textOf(restock.body), /New product/);
  assert.deepEqual(restock.body.allowedMentions, { roles: [role(guild, 'pingRestocks')] });

  // Members can't manage products
  const denied = await run({ guild, member: buyer, kind: 'command', commandName: 'product', subcommand: 'add', options: { name: 'x', price: '1', description: 'y' } });
  assert.match(textOf(lastResponse(denied)), /Only administrators and sellers/);

  // The live shop panel shows the product with a Buy button
  const panels = require('../src/lib/panels');
  const shopPanel = await panels.render('shop', guild);
  const product = db.guild(guild.id).products[0];
  assert.ok(customIds(shopPanel).includes(`shop:buy:${product.id}`));
  assert.match(textOf(shopPanel), /€6\.99/);

  // Buy → order modal with a payment dropdown
  const buy = await run({ guild, member: buyer, kind: 'button', customId: `shop:buy:${product.id}` });
  const modal = buy.state.modals[0];
  assert.equal(modal.custom_id, `shop:order:${product.id}`);
  assert.ok(modal.components.some((c) => c.component?.custom_id === 'payment' && c.component.options.length === config.shop.paymentMethods.length));

  const submit = await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${product.id}`, fields: { quantity: '2', notes: 'Thanks!' }, selects: { payment: ['0'] } });
  assert.match(textOf(lastResponse(submit)), /Order started/);
  const ticket = db.tickets((t) => t.ownerId === buyer.id)[0];
  assert.equal(ticket.typeId, 'order');
  assert.deepEqual(ticket.answers.map((a) => a.label), ['Product', 'Quantity', 'Payment method', 'Notes']);
  assert.match(ticket.answers[2].value, /PaysafeCard/);
  const ticketChannel = guild.channels.cache.get(ticket.channelId);
  assert.equal(ticketChannel.parentId, db.settings(guild.id).categoryId);
  // Only the buyer, staff for orders (incl. sellers) and the bot can see it
  const P = require('discord.js').PermissionFlagsBits;
  assert.ok(ticketChannel.permissionsFor(buyer).has(P.ViewChannel));
  assert.ok(ticketChannel.permissionsFor(seller).has(P.ViewChannel));
  assert.ok(!ticketChannel.permissionsFor(member(guild)).has(P.ViewChannel));

  // Staff marks the order as completed from the ⚙️ menu
  const done = await run({ guild, member: seller, kind: 'select', customId: 'ticket:manage', values: ['complete'], channel: ticketChannel });
  assert.match(textOf(lastResponse(done)), /Order completed/);
  assert.ok(buyer.roles.cache.has(role(guild, 'customer')));
  const completedCard = ticketChannel.messageList.at(-1);
  assert.ok(customIds(completedCard.body).includes('vouch:open'));

  // The customer leaves a vouch through the button → modal
  const open = await run({ guild, member: buyer, kind: 'button', customId: 'vouch:open', channel: ticketChannel });
  assert.equal(open.state.modals[0].custom_id, 'vouch:submit');
  const vouch = await run({ guild, member: buyer, kind: 'modal', customId: 'vouch:submit', selects: { rating: ['5'], product: [product.id] }, fields: { review: 'Super fast delivery, works perfectly!', product_other: '' } });
  assert.match(textOf(lastResponse(vouch)), /Thank you for your vouch/);
  const vouchChannel = ch(guild, 'vouches');
  const posted = vouchChannel.messageList.at(-2);
  assert.match(textOf(posted.body), /Vouch #1/);
  assert.match(textOf(posted.body), /Nitro Boost 1 Month/);
  // The "Leave a vouch" panel jumped below the new vouch – it's always the newest message.
  const sticky = vouchChannel.messageList.at(-1);
  assert.ok(customIds(sticky.body).includes('vouch:open'));
  assert.equal(db.panels(guild.id, 'vouches')[0].messageId, sticky.id);
  assert.equal(db.build(guild.id).posts.vouches.find((p) => p.type === 'panel').id, sticky.id);
  assert.equal(vouchChannel.messageList.filter((m) => customIds(m.body).includes('vouch:open')).length, 1, 'only one panel');

  // Cooldown: a second vouch right away is refused
  const again = await run({ guild, member: buyer, kind: 'button', customId: 'vouch:open' });
  assert.match(textOf(lastResponse(again)), /already left a vouch/);

  // Sold out → Buy is refused, restock is announced
  await run({ guild, member: owner, kind: 'command', commandName: 'product', subcommand: 'stock', options: { product: product.id, status: 'out' } });
  const soldOut = await run({ guild, member: buyer, kind: 'button', customId: `shop:buy:${product.id}` });
  assert.match(textOf(lastResponse(soldOut)), /sold out/);
  const before = ch(guild, 'restocks').messageList.length;
  await run({ guild, member: owner, kind: 'command', commandName: 'product', subcommand: 'stock', options: { product: product.id, status: 'in' } });
  assert.equal(ch(guild, 'restocks').messageList.length, before + 1);
});

test('loyal customers: the Loyal Customer role after enough completed orders', async () => {
  const guild = await builtGuild();
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);
  const t = require('../src/tickets/tickets');
  const g = db.guild(guild.id);
  g.orders[buyer.id] = config.shop.loyalAfterOrders - 1;
  const channel = await t.openTicket(buyer, config.getType('order'), [{ label: 'Product', value: 'X' }]);
  const res = await t.completeOrder(channel, seller);
  assert.equal(res.loyal, true);
  assert.ok(buyer.roles.cache.has(role(guild, 'loyal')));
  await assert.rejects(() => t.completeOrder(channel, seller), /already marked/);
});

// ───────────── Tickets ─────────────

test('tickets: panel → form → ticket → claim → close with transcript and rating DM', async () => {
  const guild = await builtGuild();
  const user = member(guild);
  const support = member(guild, ['member', 'support']);

  const open = await run({ guild, member: user, kind: 'button', customId: 'ticket:open:support' });
  const form = open.state.modals[0];
  assert.equal(form.custom_id, 'ticket:form:support:b');
  const created = await run({ guild, member: user, kind: 'modal', customId: form.custom_id, fields: { subject: 'Order missing', details: 'I paid an hour ago.' } });
  assert.match(textOf(lastResponse(created)), /Ticket created/);
  const ticket = db.tickets((t) => t.ownerId === user.id)[0];
  const channel = guild.channels.cache.get(ticket.channelId);
  assert.ok(channel.messageList[0].pinned, 'ticket card pinned');
  assert.ok(ch(guild, 'ticketLogs').messageList.length >= 1, 'logged');

  await run({ guild, member: support, kind: 'button', customId: 'ticket:claim', channel });
  assert.equal(db.getTicket(channel.id).claimedBy, support.id);

  channel.userMessage(user.id, 'Hello?');
  channel.userMessage(support.id, 'On it!');
  const confirm = await run({ guild, member: support, kind: 'button', customId: 'ticket:close', channel });
  assert.ok(customIds(lastResponse(confirm)).includes('ticket:close_confirm'));
  await run({ guild, member: support, kind: 'button', customId: 'ticket:close_confirm', channel });
  assert.equal(db.getTicket(channel.id).status, 'closed');
  assert.equal(channel.parentId, db.settings(guild.id).closedCategoryId);
  const transcript = ch(guild, 'transcripts').messageList.at(-1);
  assert.match(transcript.files[0].name, /^transcript-.*\.html$/);
  const dms = guild.dms.filter((d) => d.to === user.id);
  assert.equal(dms.length, 2, 'DM on open + DM on close');
  const dm = dms.at(-1);
  assert.equal(dm.payload.files.length, 1, 'transcript attached');
  assert.equal(dm.payload.components[0].toJSON().components.length, 5);
});

test('tickets: limit per user and blacklist', async () => {
  const guild = await builtGuild();
  const user = member(guild);
  const staff = member(guild, ['member', 'support']);
  const t = require('../src/tickets/tickets');
  await t.openTicket(user, config.getType('reward'), []);
  db.updateSettings(guild.id, { maxOpenTicketsPerUser: 1 });
  assert.match(t.checkCanOpen(user), /open ticket limit/);
  await run({ guild, member: staff, kind: 'command', commandName: 'blacklist', subcommand: 'add', options: { user: member(guild).user } });
  const listed = db.blacklist(guild.id)[0];
  const blocked = guild.members.cache.get(listed.userId);
  assert.match(t.checkCanOpen(blocked), /blocked/);
});

// ───────────── Giveaways ─────────────

test('giveaways: start → enter / leave → end draws a winner who claims via ticket', async () => {
  const guild = await builtGuild();
  const mod = member(guild, ['member', 'moderator']);
  const users = [member(guild), member(guild), member(guild)];
  const start = await run({ guild, member: mod, kind: 'command', commandName: 'giveaway', subcommand: 'start', options: { prize: 'Discord Nitro', duration: '1h', winners: 1 } });
  assert.match(textOf(lastResponse(start)), /started/);
  const gw = Object.values(db.guild(guild.id).giveaways)[0];
  const card = ch(guild, 'giveaways').messageList.at(-1);
  assert.deepEqual(card.body.allowedMentions, { roles: [role(guild, 'pingGiveaways')] });

  for (const u of users) await run({ guild, member: u, kind: 'button', customId: `gw:enter:${gw.id}` });
  const leave = await run({ guild, member: users[2], kind: 'button', customId: `gw:enter:${gw.id}` });
  assert.match(textOf(lastResponse(leave)), /left the giveaway/);
  assert.equal(gw.entries.length, 2);

  const notMod = await run({ guild, member: users[0], kind: 'command', commandName: 'giveaway', subcommand: 'end', options: { giveaway: gw.id } });
  assert.match(textOf(lastResponse(notMod)), /Only moderators/);

  gw.endsAt = Date.now() - 1;
  await require('../src/features/giveaways').tick(guild.client);
  assert.ok(gw.ended);
  assert.equal(gw.winners.length, 1);
  assert.ok([users[0].id, users[1].id].includes(gw.winners[0]));
  const announcement = ch(guild, 'giveaways').messageList.at(-1);
  assert.ok(customIds(announcement.body).includes('ticket:open:reward'));

  const reroll = await run({ guild, member: mod, kind: 'command', commandName: 'giveaway', subcommand: 'reroll', options: { giveaway: gw.id } });
  assert.match(textOf(lastResponse(reroll)), /Winner/);
  assert.equal(new Set(gw.winners).size, 2, 'reroll picks someone new');
});

test('parseDuration understands 30m, 2h, 1d12h, 1w and rejects garbage', () => {
  const { parseDuration } = require('../src/lib/utils');
  assert.equal(parseDuration('30m'), 1_800_000);
  assert.equal(parseDuration('2h'), 7_200_000);
  assert.equal(parseDuration('1d12h'), 129_600_000);
  assert.equal(parseDuration('1w'), 604_800_000);
  assert.equal(parseDuration('soon'), null);
  assert.equal(parseDuration('5x'), null);
});

// ───────────── Announcements, welcome, logs ─────────────

test('announce: form → card with banner and role ping in #announcements', async () => {
  const guild = await builtGuild();
  const mod = member(guild, ['member', 'moderator']);
  const cmd = await run({ guild, member: mod, kind: 'command', commandName: 'announce', options: { ping: 'pingAnnouncements', banner: 'updates' } });
  const modal = cmd.state.modals[0];
  const submit = await run({ guild, member: mod, kind: 'modal', customId: modal.custom_id, fields: { title: 'Big update', message: '**New products** are live!', url: 'https://example.com' } });
  assert.match(textOf(lastResponse(submit)), /Announcement posted/);
  const post = ch(guild, 'announcements').messageList.at(-1);
  assert.equal(post.files[0].name, 'nox-updates.png');
  assert.deepEqual(post.body.allowedMentions, { roles: [role(guild, 'pingAnnouncements')] });
  assert.ok(post.crossposted, 'published to followers');
});

test('welcome + logs: join card in #welcome, joins/leaves/deletes in #server-logs', async () => {
  const guild = await builtGuild();
  const welcome = require('../src/features/welcome');
  const newbie = guild.addMember(uid(), []);
  await welcome.onMemberAdd(newbie);
  assert.match(textOf(ch(guild, 'welcome').messageList.at(-1).body), /Welcome to NØX/);
  await welcome.onMemberRemove(newbie);
  const chat = ch(guild, 'chat');
  const msg = chat.userMessage(newbie.id, 'spam link');
  msg.author.tag = 'x';
  await welcome.onMessageDelete(msg);
  const logs = ch(guild, 'serverLogs').messageList.map((m) => textOf(m.body)).join('\n');
  assert.match(logs, /Member joined/);
  assert.match(logs, /Member left/);
  assert.match(logs, /Message deleted/);
});

test('stats: member + vouch counters and the activity leaderboard', async () => {
  const guild = await builtGuild();
  const stats = require('../src/features/stats');
  const m = member(guild);
  const chat = ch(guild, 'chat');
  for (let i = 0; i < 3; i += 1) stats.trackMessage({ guild, author: m.user, channel: chat });
  const board = stats.leaderboardPanel(guild);
  assert.match(textOf(board), new RegExp(`<@${m.id}> – \\*\\*3\\*\\* messages`));
  await stats.updateStatChannels(guild.client);
  assert.equal(ch(guild, 'statMembers').name, `👥 Members: ${guild.memberCount}`);
});

// ───────────── /build control panel ─────────────

test('/build: preview → Build → live progress → result card; members cannot use it', async () => {
  const guild = new FakeGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const nobody = guild.addMember(uid(), []);
  const denied = await run({ guild, member: nobody, kind: 'command', commandName: 'build' });
  assert.match(textOf(lastResponse(denied)), /Only the server owner/);

  const preview = await run({ guild, member: owner, kind: 'command', commandName: 'build' });
  const card = lastResponse(preview);
  assert.deepEqual(customIds(card), ['build:go', 'build:wipe', 'build:cancel']);
  assert.equal(card.files[0].name, 'nox-welcome.png');

  const go = await run({ guild, member: owner, kind: 'button', customId: 'build:go', message: { id: 'preview' } });
  const final = lastResponse(go);
  assert.match(textOf(final), /NØX is ready!/);
  assert.deepEqual(final.attachments, [], 'the preview banner is removed');
  assert.ok(db.build(guild.id)?.finishedAt);
});

test('/build: Wipe & Build needs the exact server name and the owner', async () => {
  const guild = new FakeGuild({ name: 'My Server' });
  const owner = guild.members.cache.get(guild.ownerId);
  const admin = guild.addMember(uid(), [], { permissions: require('discord.js').PermissionFlagsBits.Administrator });
  const notOwner = await run({ guild, member: admin, kind: 'button', customId: 'build:wipe' });
  assert.match(textOf(lastResponse(notOwner)), /Only the server owner/);
  const modal = await run({ guild, member: owner, kind: 'button', customId: 'build:wipe' });
  assert.equal(modal.state.modals[0].custom_id, 'build:wipeconfirm');
  const wrong = await run({ guild, member: owner, kind: 'modal', customId: 'build:wipeconfirm', fields: { name: 'nope' }, message: { id: 'm' } });
  assert.match(textOf(lastResponse(wrong)), /does not match/);
  const before = guild.channels.cache.size;
  assert.ok(before > 0);
  const ok = await run({ guild, member: owner, kind: 'modal', customId: 'build:wipeconfirm', fields: { name: 'my server' }, message: { id: 'm' } });
  assert.match(textOf(lastResponse(ok)), /is ready!/);
  assert.ok(!guild.channels.cache.some((c) => c.name.startsWith('old-channel-') && c.id !== ok.channelId), 'old channels removed');
});

test('/help adapts to the member, /panel re-sends panels', async () => {
  const guild = await builtGuild();
  const help = await run({ guild, member: member(guild), kind: 'command', commandName: 'help' });
  assert.doesNotMatch(textOf(lastResponse(help)), /Administration/);
  const owner = guild.members.cache.get(guild.ownerId);
  const adminHelp = await run({ guild, member: owner, kind: 'command', commandName: 'help' });
  assert.match(textOf(lastResponse(adminHelp)), /Administration/);
  const target = ch(guild, 'chat');
  const before = target.messageList.length;
  await run({ guild, member: owner, kind: 'command', commandName: 'panel', options: { type: 'verify', channel: target } });
  assert.equal(target.messageList.length, before + 2);
  assert.ok(verification.verifyPanel(guild));
});

test('ticket rating works from the DM (outside the server)', async () => {
  const guild = await builtGuild();
  const user = member(guild);
  const support = member(guild, ['member', 'support']);
  const t = require('../src/tickets/tickets');
  const channel = await t.openTicket(user, config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  await t.closeTicket(channel, support);
  const dmInteraction = (extra) => {
    const i = createInteraction({ guild, member: user, ...extra });
    i.guild = null;
    i.member = null;
    i.inGuild = () => false;
    return i;
  };
  const click = dmInteraction({ kind: 'button', customId: `rate:${channel.id}:5` });
  await handle(click, commands);
  assert.equal(click.state.modals[0].custom_id, `ratemodal:${channel.id}:5`);
  const submit = dmInteraction({ kind: 'modal', customId: `ratemodal:${channel.id}:5`, fields: { comment: 'Great help!' } });
  await handle(submit, commands);
  assert.equal(db.getTicket(channel.id).rating.stars, 5);
  assert.match(textOf(lastResponse(submit)), /Thanks for the great rating/);
});

test('staff commands: /ticket info + complete, /stats, /setup show, /product list, /giveaway list', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const seller = member(guild, ['member', 'seller']);
  const buyer = member(guild);
  const t = require('../src/tickets/tickets');
  const channel = await t.openTicket(buyer, config.getType('order'), [{ label: 'Product', value: 'X' }]);
  const info = await run({ guild, member: buyer, kind: 'command', commandName: 'ticket', subcommand: 'info', channel });
  assert.match(textOf(lastResponse(info)), /Ticket #0001/);
  const notStaff = await run({ guild, member: buyer, kind: 'command', commandName: 'ticket', subcommand: 'complete', channel });
  assert.match(textOf(lastResponse(notStaff)), /only available to staff/);
  const complete = await run({ guild, member: seller, kind: 'command', commandName: 'ticket', subcommand: 'complete', channel });
  assert.match(textOf(lastResponse(complete)), /Order marked as completed/);
  for (const [commandName, subcommand] of [['stats', null], ['setup', 'show'], ['product', 'list'], ['giveaway', 'list']]) {
    const i = await run({ guild, member: owner, kind: 'command', commandName, subcommand });
    assert.ok(lastResponse(i), `/${commandName} ${subcommand ?? ''} replied`);
    assert.doesNotMatch(textOf(lastResponse(i)), /unexpected error/i);
  }
});
