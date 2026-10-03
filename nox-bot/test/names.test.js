'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { CATEGORIES } = require('../src/builder/layout');
const { restyleNames, wantedNames } = require('../src/builder/rename');
const style = require('../src/builder/style');
const t = require('../src/tickets/tickets');
const config = require('../src/lib/config');
const handle = require('../src/handlers/interactions');
const commands = require('../src/commands')();

let n = 930000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const byKey = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
}

test('style: emoji┃small-caps channels and 〔 emoji NAME 〕 categories', () => {
  assert.equal(style.channelName('📦 how-to-buy'), '📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ');
  assert.equal(style.channelName('💎 VIP Lounge'), '💎┃ᴠɪᴘ ʟᴏᴜɴɢᴇ');
  assert.equal(style.channelName('🛡️ staff-chat'), '🛡️┃ꜱᴛᴀꜰꜰ-ᴄʜᴀᴛ');
  assert.equal(style.channelName('👥 Members: 1,234'), '👥┃ᴍᴇᴍʙᴇʀꜱ: 1,234', 'digits stay');
  assert.equal(style.categoryName('🛒 SHOP'), '〔 🛒 SHOP 〕');
  assert.equal(style.numberedCategoryName('〔 🎫 TICKETS 〕', 2), '〔 🎫 TICKETS 2 〕');
  assert.equal(style.numberedCategoryName('Tickets', 3), 'Tickets 3', 'names in another style just get the number');
  assert.equal(style.smallCaps('the quick brown fox jumps over a lazy dog'), 'ᴛʜᴇ ǫᴜɪᴄᴋ ʙʀᴏᴡɴ ꜰᴏx ᴊᴜᴍᴘꜱ ᴏᴠᴇʀ ᴀ ʟᴀᴢʏ ᴅᴏɢ');
  const prev = { ...config.server };
  try {
    Object.assign(config.server, { channelStyle: '{emoji}・{name}', categoryStyle: '━ {name} ━', smallCaps: false });
    assert.equal(style.channelName('📦 how-to-buy'), '📦・how-to-buy');
    assert.equal(style.categoryName('🛒 SHOP'), '━ 🛒 SHOP ━');
    assert.equal(style.numberedCategoryName('━ 🎫 TICKETS ━', 2), '━ 🎫 TICKETS 2 ━');
  } finally {
    Object.assign(config.server, prev);
  }
});

test('a fresh build uses the style for every category and channel', async () => {
  const guild = await builtGuild();
  for (const cat of CATEGORIES) {
    const category = guild.channels.cache.get(db.build(guild.id).categories[cat.key]);
    assert.match(category.name, /^〔 \S+ [A-Z ]+ 〕$/u, cat.key);
  }
  for (const ch of CATEGORIES.flatMap((c) => c.channels)) {
    const channel = byKey(guild, ch.key);
    const [emoji, label, ...rest] = channel.name.split('┃');
    assert.equal(rest.length, 0, channel.name);
    assert.ok(emoji && /\p{Extended_Pictographic}/u.test(emoji), `${channel.name} starts with an emoji`);
    assert.doesNotMatch(label, /[a-wyz]/i, `${channel.name} is all small caps`);
  }
  assert.equal(byKey(guild, 'howToBuy').name, '📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ');
  assert.equal(byKey(guild, 'vouches').name, '⭐┃ᴠᴏᴜᴄʜᴇꜱ');
  assert.equal(byKey(guild, 'lounge').name, '🔊┃ʟᴏᴜɴɢᴇ');
  assert.match(byKey(guild, 'statMembers').name, /^👥┃ᴍᴇᴍʙᴇʀꜱ: \d+$/);
  // Nothing to rename right after a build (also after Discord's own name rules for text channels).
  const res = await restyleNames(guild);
  assert.deepEqual(res, { renamed: 0, unchanged: wantedNames(guild).length, later: [], errors: [] });
});

test('/build only:names renames a server built with the old names – once – and keeps custom ticket names', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);
  const author = guild.addMember(uid(), [role(guild, 'member')]);
  const staff = guild.addMember(uid(), [role(guild, 'member'), role(guild, 'support')]);
  const ticket = await t.openTicket(author, config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  const custom = await t.openTicket(guild.addMember(uid(), [role(guild, 'member')]), config.getType('order'), [{ label: 'Product', value: 'x' }]);
  await t.renameTicket(custom, 'vip-order', staff);
  // The old style: "✦ SHOP ✦" categories, "📦┃how-to-buy" channels, "support-0001" tickets.
  for (const cat of CATEGORIES) guild.channels.cache.get(db.build(guild.id).categories[cat.key]).name = `✦ ${cat.name.split(' ').slice(1).join(' ')} ✦`;
  for (const ch of CATEGORIES.flatMap((c) => c.channels)) byKey(guild, ch.key).name = ch.name.replace(' ', '┃').toLowerCase();
  ticket.name = 'support-0001';

  const i = createInteraction({ guild, member: owner, kind: 'command', commandName: 'build', options: { only: 'names' } });
  await handle(i, commands);
  const total = wantedNames(guild).length; // the custom-named ticket isn't in the list
  assert.equal(total, CATEGORIES.length + CATEGORIES.flatMap((c) => c.channels).length + 1);
  assert.match(textOf(lastResponse(i)), new RegExp(`Renamed \\*\\*${total}\\*\\*`));
  assert.equal(byKey(guild, 'howToBuy').name, '📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ');
  assert.equal(guild.channels.cache.get(db.build(guild.id).categories.catShop).name, '〔 🛒 SHOP 〕');
  assert.match(ticket.name, /^🛠️┃ꜱᴜᴘᴘᴏʀᴛ-\d{4}$/u);
  assert.equal(custom.name, 'vip-order', 'renamed with /ticket rename – kept');
  const again = await restyleNames(guild);
  assert.equal(again.renamed, 0, 'running it again changes nothing');
});

test('ticket channels, overflow categories and transcripts use the style', async () => {
  const guild = await builtGuild();
  const member = guild.addMember(uid(), [role(guild, 'member')]);
  const staff = guild.addMember(uid(), [role(guild, 'member'), role(guild, 'support')]);
  const channel = await t.openTicket(member, config.getType('order'), [{ label: 'Product', value: 'x' }]);
  const number = db.getTicket(channel.id).number;
  assert.equal(channel.name, `🛒┃ᴏʀᴅᴇʀ-${String(number).padStart(4, '0')}`);
  await t.setPriority(channel, 'urgent', staff);
  assert.equal(channel.name, `🔴🛒┃ᴏʀᴅᴇʀ-${String(number).padStart(4, '0')}`);
  const { createTranscript } = require('../src/tickets/transcript');
  const { attachment } = await createTranscript(channel, db.getTicket(channel.id), config.getType('order'));
  assert.equal(attachment.name, `transcript-order-${String(number).padStart(4, '0')}.html`);
  // A full ticket category → 〔 🎫 TICKETS 2 〕
  const base = db.settings(guild.id).categoryId;
  for (let k = guild.channels.cache.filter((c) => c.parentId === base).size; k < 50; k += 1) {
    await guild.channels.create({ name: `filler-${k}`, type: ChannelType.GuildText, parent: base });
  }
  const next = await t.openTicket(guild.addMember(uid(), [role(guild, 'member')]), config.getType('support'), [{ label: 'Subject', value: 'x' }]);
  assert.equal(guild.channels.cache.get(next.parentId).name, '〔 🎫 TICKETS 2 〕');
});
