'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ButtonStyle, MessageFlags, MessageFlagsBitField } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const panels = require('../src/lib/panels');
const images = require('../src/lib/productImages');
const shop = require('../src/features/shop');
const restock = require('../src/features/restock');

const commands = loadCommands();
config.defaults.openCooldownSeconds = 0;

let n = 960000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const ch = (guild, key) => guild.channels.cache.get(db.channelId(guild.id, key));
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const run = async (args) => {
  const i = createInteraction(args);
  await handle(i, commands);
  return i;
};
const product = (guild, who, sub, options) => run({ guild, member: who, kind: 'command', commandName: 'product', subcommand: sub, options });

async function builtGuild() {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return { guild, owner: guild.members.cache.get(guild.ownerId) };
}

function shopMessage(guild) {
  const panel = db.panels(guild.id, 'shop')[0];
  return guild.channels.cache.get(panel.channelId).messageList.find((m) => m.id === panel.messageId);
}

/** Every thumbnail / media URL in a Components V2 payload. */
function mediaUrls(payload) {
  const urls = [];
  const walk = (c) => {
    const d = c?.toJSON ? c.toJSON() : c;
    if (!d) return;
    if (d.media?.url) urls.push(d.media.url);
    for (const x of d.components ?? []) walk(x);
    for (const x of d.items ?? []) walk(x);
    if (d.accessory) walk(d.accessory);
  };
  for (const c of payload?.components ?? []) walk(c);
  return urls;
}

/** Options of the first select menu in a payload. */
function selectOptions(payload) {
  let found = null;
  const walk = (c) => {
    const d = c?.toJSON ? c.toJSON() : c;
    if (!d || found) return;
    if (d.type === 3) found = d.options;
    for (const x of d.components ?? []) walk(x);
  };
  for (const c of payload?.components ?? []) walk(c);
  return found ?? [];
}

const fileNames = (payload) => (payload.files ?? []).map((f) => f.name);

/** Every button in a payload (JSON). */
function buttons(payload) {
  const out = [];
  const walk = (c) => {
    const d = c?.toJSON ? c.toJSON() : c;
    if (!d) return;
    if (d.type === 2) out.push(d);
    for (const x of d.components ?? []) walk(x);
    if (d.accessory) walk(d.accessory);
  };
  for (const c of payload?.components ?? []) walk(c);
  return out;
}
const labels = (payload) => buttons(payload).map((b) => b.label ?? '').join(' | ');
/** The products on a page – their Buy or Notify me buttons. */
const productIds = (payload) => customIds(payload).filter((id) => /^(shop:buy|restock:notify):/.test(id)).map((id) => id.split(':')[2]);

// ───────────── Fake image downloads ─────────────

const SIGNATURES = { png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], jpg: [0xff, 0xd8, 0xff, 0xe0], gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] };
function imageBytes(ext = 'png', size = 2048) {
  const buf = Buffer.alloc(size, 7);
  Buffer.from(SIGNATURES[ext]).copy(buf);
  return buf;
}

/** What Discord gives a slash command for an uploaded file. */
const upload = (name, bytes, contentType = 'image/png', size = bytes.length) => ({ url: `https://cdn.discordapp.com/attachments/1/2/${name}?ex=expires`, name, contentType, size, bytes });

const realFetch = global.fetch;
const fetched = [];
/** Downloads answer with the bytes of the upload that has that URL. */
function stubFetch(...uploads) {
  global.fetch = async (url) => {
    fetched.push(url);
    const file = uploads.find((u) => u.url === url);
    if (!file) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => file.bytes.buffer.slice(file.bytes.byteOffset, file.bytes.byteOffset + file.bytes.length) };
  };
}
test.afterEach(() => {
  global.fetch = realFetch;
  fetched.length = 0;
});

const imagePath = (p) => path.join(db.dataDir, 'products', `${p.id}.${p.image.ext}`);

// ───────────── Categories ─────────────

test('categories: /product add | edit with autocomplete, the shop panel groups products under category headers', async () => {
  const { guild, owner } = await builtGuild();
  const seller = member(guild, ['member', 'seller']);
  const add = (name, category) => product(guild, seller, 'add', { name, price: '20', description: `${name} – instant delivery.`, category, announce: false });

  await add('GTA V', 'Games');
  await add('Minecraft', '  games ');
  await add('Windows 11 Pro', '💻 Software');
  await add('Steam Gift Card', undefined);
  const byName = (name) => shop.products(guild.id).find((p) => p.name === name);
  assert.equal(byName('GTA V').category, 'Games');
  assert.equal(byName('Minecraft').category, 'Games', 'the spelling of the existing category is reused');
  assert.equal(byName('Windows 11 Pro').category, '💻 Software');
  assert.equal(byName('Steam Gift Card').category, null);

  const long = await add('Netflix', 'A category name that is far too long');
  assert.match(textOf(lastResponse(long)), /up to 30 characters/);
  assert.equal(byName('Netflix'), undefined);

  // Autocomplete: existing categories, "New category" for what is typed, "No category" when editing.
  // Existing categories come first – Discord highlights the first suggestion, so Enter reuses "💻 Software".
  const ac = await run({ guild, member: seller, kind: 'autocomplete', commandName: 'product', subcommand: 'add', focusedOption: 'category', focused: 'so' });
  assert.deepEqual(ac.state.responded.map((c) => c.value), ['💻 Software', 'so']);
  assert.match(ac.state.responded[1].name, /New category: so/);
  const all = await run({ guild, member: seller, kind: 'autocomplete', commandName: 'product', subcommand: 'edit', focusedOption: 'category', focused: '' });
  assert.deepEqual(all.state.responded.map((c) => c.value), ['Games', '💻 Software', 'none']);
  const products = await run({ guild, member: seller, kind: 'autocomplete', commandName: 'product', subcommand: 'edit', focusedOption: 'product', focused: 'gta' });
  assert.deepEqual(products.state.responded.map((c) => c.value), [byName('GTA V').id]);

  // The panel: tabs (All · Games · 💻 Software · Other), "All" open, the first page with every product and its category.
  await panels.refresh(guild, 'shop');
  const panel = shopMessage(guild).body;
  validateMessage(panel, guild);
  const tabs = buttons(panel).filter((b) => b.custom_id?.startsWith('shopview:tab:'));
  assert.deepEqual(tabs.map((b) => b.label), ['All', 'Games', 'Software', 'Other']);
  assert.equal(tabs[0].style, ButtonStyle.Primary, '"All" is the open tab');
  assert.equal(tabs.find((b) => b.label === 'Software').emoji.name, '💻', "a category's own emoji is its icon");
  const body = textOf(panel);
  for (const name of ['GTA V', 'Minecraft', 'Windows 11 Pro', 'Steam Gift Card']) assert.match(body, new RegExp(name));
  assert.match(body, /📂 Games/);
  assert.deepEqual(customIds(panel).filter((id) => id.startsWith('shop:buy:')).length, 4);
  assert.ok(!customIds(panel).some((id) => id.startsWith('shopview:page:')), 'one page – no ◀ ▶');

  // Moving and removing categories.
  await product(guild, owner, 'edit', { product: byName('Minecraft').id, category: '💻 software' });
  assert.equal(byName('Minecraft').category, '💻 Software');
  await product(guild, owner, 'edit', { product: byName('GTA V').id, category: 'none' });
  assert.equal(byName('GTA V').category, null);
  assert.deepEqual(shop.categories(guild.id), ['💻 Software']);
});

test('tabs and pages: 5 products per page, ◀ ▶ and tabs answer privately and then update in place', async () => {
  const { guild } = await builtGuild();
  const buyer = member(guild);
  for (const [category, count] of [['Games', 7], ['🎬 Streaming', 4], ['Software', 3]]) {
    for (let i = 1; i <= count; i += 1) shop.addProduct(guild, { name: `${category} ${i}`, price: `${i * 5}`, description: 'Instant delivery, full warranty.', category });
  }
  await shop.setStock(guild, 'Games 2', 'out');
  await panels.refresh(guild, 'shop');
  const message = shopMessage(guild);
  const panel = message.body;
  validateMessage(panel, guild);
  assert.deepEqual(buttons(panel).filter((b) => b.custom_id?.startsWith('shopview:tab:')).map((b) => b.label), ['All', 'Games', 'Streaming', 'Software']);
  assert.equal(productIds(panel).length, 5, '5 products per page');
  assert.match(labels(panel), /Page 1 \/ 3/);
  const games = shop.products(guild.id).filter((p) => p.category === 'Games');
  assert.ok(customIds(panel).includes(`restock:notify:${games[1].id}`), 'a sold-out product offers Notify me');

  // ▶ on the public panel: a private copy of page 2 (the panel itself doesn't change).
  const next = await run({ guild, member: buyer, kind: 'button', customId: 'shopview:page:1:all', message });
  assert.equal(next.deferred, true, 'answers privately');
  const page2 = lastResponse(next);
  validateMessage(page2, guild);
  assert.match(labels(page2), /Page 2 \/ 3/);
  assert.notDeepEqual(productIds(page2), productIds(panel));
  assert.deepEqual(shopMessage(guild).body, panel, 'the public panel is untouched');

  // ▶ inside the private copy: it updates in place.
  const privateCopy = { flags: new MessageFlagsBitField(MessageFlags.Ephemeral) };
  const last = await run({ guild, member: buyer, kind: 'button', customId: 'shopview:page:2:all', message: privateCopy });
  assert.equal(last.state.updates.length + last.state.edits.length > 0, true);
  const page3 = lastResponse(last);
  assert.match(labels(page3), /Page 3 \/ 3/);
  assert.equal(productIds(page3).length, 4, '14 products → 5 + 5 + 4');
  assert.ok(buttons(page3).find((b) => b.label === 'Next').disabled, 'Next is off on the last page');
  const everything = new Set([...productIds(panel), ...productIds(page2), ...productIds(page3)]);
  assert.equal(everything.size, 14, 'every product is on exactly one page');

  // A tab: only that category.
  const tab = await run({ guild, member: buyer, kind: 'button', customId: 'shopview:tab:c:games', message: privateCopy });
  const gamesPage = lastResponse(tab);
  const gameIds = new Set(games.map((p) => p.id));
  assert.ok(productIds(gamesPage).every((id) => gameIds.has(id)), 'only Games products');
  assert.equal(buttons(gamesPage).find((b) => b.label === 'Games').style, ButtonStyle.Primary);
  assert.match(labels(gamesPage), /Page 1 \/ 2/);

  // 50 products in 20 categories: the tabs become a menu, every tab and page stays within Discord's limits.
  const big = (await builtGuild()).guild;
  for (let i = 0; i < 50; i += 1) {
    shop.addProduct(big, { name: `Product ${i} ${'x'.repeat(60)}`, price: '1 299,99', description: 'd'.repeat(400), category: `Category ${String(i % 20).padStart(2, '0')} ${'c'.repeat(18)}` });
  }
  const full = shop.shopPanel(big);
  validateMessage(full, big);
  assert.equal(selectOptions(full).length, 21, 'All + 20 categories');
  for (const option of selectOptions(full)) {
    const i = await run({ guild: big, member: member(big), kind: 'select', customId: 'shopview:tabs', values: [option.value] });
    validateMessage(lastResponse(i), big);
    assert.ok(productIds(lastResponse(i)).length >= 1 && productIds(lastResponse(i)).length <= 5, option.label);
  }
  for (let page = 0; page < 10; page += 1) validateMessage(shop.shopView(big, { page }), big);
});

test('a long category is shown 5 per page until the last page', async () => {
  const { guild } = await builtGuild();
  for (let i = 1; i <= 30; i += 1) shop.addProduct(guild, { name: `Key ${i}`, price: '9.99', description: 'Instant delivery. '.repeat(10), category: 'Keys' });
  shop.addProduct(guild, { name: 'Other', price: '5', description: 'Something else.', category: 'Misc' });
  const privateCopy = { flags: new MessageFlagsBitField(MessageFlags.Ephemeral) };
  let page = lastResponse(await run({ guild, member: member(guild), kind: 'button', customId: 'shopview:tab:c:keys' }));
  const shown = new Set(productIds(page));
  let pages = 1;
  while (!buttons(page).find((b) => b.label === 'Next').disabled) {
    const i = await run({ guild, member: member(guild), kind: 'button', customId: `shopview:page:${pages}:c:keys`, message: privateCopy });
    page = lastResponse(i);
    assert.deepEqual(page.attachments, [], 'turning a page replaces the message');
    assert.ok(productIds(page).length <= 5);
    for (const id of productIds(page)) shown.add(id);
    pages += 1;
    if (pages > 10) break;
  }
  assert.equal(pages, 6, '30 products → 6 pages');
  assert.equal(shown.size, 30, 'every product of the category is on a page');
});

test('without categories: no tabs, just pages of 5 – sold-out products offer Notify me, older panel menus still work', async () => {
  const { guild } = await builtGuild();
  const buyer = member(guild);
  for (let i = 1; i <= 10; i += 1) shop.addProduct(guild, { name: `Product ${i}`, price: '10', description: 'Instant delivery.' });
  const soldOut = shop.findProduct(guild.id, 'Product 3');
  await shop.setStock(guild, soldOut.id, 'out');
  const panel = shop.shopPanel(guild);
  validateMessage(panel, guild);
  assert.ok(!customIds(panel).some((id) => id.startsWith('shopview:tab')), 'no tabs without categories');
  assert.match(labels(panel), /Page 1 \/ 2/);
  assert.ok(customIds(panel).includes(`restock:notify:${soldOut.id}`));

  // An older panel's product menu still opens the order form, its "All products" option the pages.
  const buy = await run({ guild, member: buyer, kind: 'select', customId: 'catalog:pick', values: [shop.findProduct(guild.id, 'Product 1').id] });
  assert.equal(buy.state.modals.length, 1, 'the order form opens');
  const all = await run({ guild, member: buyer, kind: 'select', customId: 'catalog:pick', values: ['all'] });
  assert.match(labels(lastResponse(all)), /Page 1 \/ 2/);
});

// ───────────── Images ─────────────

test('images: /product add stores the picture and shows it in the shop panel, the announcement and the order ticket', async () => {
  const { guild, owner } = await builtGuild();
  const pic = upload('gta.png', imageBytes('png', 4096));
  stubFetch(pic);
  const add = await product(guild, owner, 'add', { name: 'GTA V', price: '20', description: 'Instant delivery.', category: 'Games', image: pic });
  assert.match(textOf(lastResponse(add)), /Added \*\*GTA V\*\* \(20€\) to the shop in \*\*Games\*\* with its image\./);
  assert.deepEqual(fetched, [pic.url], 'downloaded once – Discord links expire');
  const gta = shop.findProduct(guild.id, 'GTA V');
  assert.equal(gta.image.ext, 'png');
  assert.equal(imagePath(gta), path.join(db.dataDir, 'products', `${gta.id}.png`));
  assert.ok(fs.readFileSync(imagePath(gta)).equals(pic.bytes));

  const name = `product-${gta.id}.png`;
  await panels.refresh(guild, 'shop');
  const panel = shopMessage(guild);
  assert.deepEqual(fileNames(panel.body), [name]);
  assert.ok(mediaUrls(panel.body).includes(`attachment://${name}`), 'thumbnail in the card');
  assert.ok(customIds(panel.body).includes(`shop:buy:${gta.id}`));

  const announcement = ch(guild, 'restocks').messageList.at(-1);
  assert.match(textOf(announcement.body), /New product.*GTA V/);
  assert.deepEqual(fileNames(announcement.body), [name]);
  assert.ok(mediaUrls(announcement.body).includes(`attachment://${name}`));

  const buyer = member(guild);
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${gta.id}`, fields: { quantity: '1' }, selects: { payment: ['0'] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id)[0];
  const card = guild.channels.cache.get(ticket.channelId).messageList[0];
  assert.deepEqual(fileNames(card.body), [name]);
  assert.ok(mediaUrls(card.body).includes(`attachment://${name}`), 'the order ticket shows the product');
  // The card keeps its picture when it is updated (claim).
  await run({ guild, member: owner, kind: 'button', customId: 'ticket:claim', channel: guild.channels.cache.get(ticket.channelId) });
  assert.ok(mediaUrls(card.body).includes(`attachment://${name}`));

  // A new picture replaces the old file; remove_image deletes it.
  const jpg = upload('gta.jpg', imageBytes('jpg', 3000), 'image/jpeg');
  stubFetch(jpg);
  const oldPath = imagePath(gta);
  await product(guild, owner, 'edit', { product: gta.id, image: jpg });
  assert.equal(gta.image.ext, 'jpg');
  assert.equal(fs.existsSync(oldPath), false);
  assert.ok(fs.existsSync(imagePath(gta)));

  const jpgPath = imagePath(gta);
  const removed = await product(guild, owner, 'edit', { product: gta.id, remove_image: true });
  assert.match(textOf(lastResponse(removed)), /Updated \*\*GTA V\*\*/);
  assert.equal(gta.image, null);
  assert.equal(fs.existsSync(jpgPath), false);
  await panels.refresh(guild, 'shop');
  assert.deepEqual(fileNames(shopMessage(guild).body), []);
  assert.deepEqual(mediaUrls(shopMessage(guild).body).filter((u) => u.startsWith('attachment://')), []);
  assert.equal(shopMessage(guild).files.length, 0, 'the old upload is gone from the message');

  // Removing a product deletes its picture.
  stubFetch(pic);
  await product(guild, owner, 'edit', { product: gta.id, image: pic });
  const finalPath = imagePath(gta);
  await product(guild, owner, 'remove', { product: gta.id });
  assert.equal(fs.existsSync(finalPath), false);
});

test('images: bigger than 1 MB, the wrong type or not really an image → a friendly error and nothing is stored', async () => {
  const { guild, owner } = await builtGuild();
  const attempt = async (image, name) => {
    stubFetch(image);
    const i = await product(guild, owner, 'add', { name, price: '5', description: 'Test.', image });
    return textOf(lastResponse(i));
  };

  const huge = upload('huge.png', imageBytes('png', 64), 'image/png', 1.5 * 1024 * 1024);
  assert.match(await attempt(huge, 'Huge'), /1\.5 MB – product images can be up to \*\*1 MB\*\*/);
  assert.deepEqual(fetched, [], 'too big – not even downloaded');

  assert.match(await attempt(upload('menu.pdf', Buffer.from('%PDF-1.7 ......'), 'application/pdf'), 'Pdf'), /must be a PNG, JPG, WEBP or GIF/);
  assert.match(await attempt(upload('fake.png', Buffer.from('this is not an image at all'), 'image/png'), 'Fake'), /not a real PNG, JPG, WEBP or GIF image/);
  // The size Discord reported was wrong – the download is checked too.
  assert.match(await attempt(upload('liar.png', imageBytes('png', 1024 * 1024 + 10), 'image/png', 1000), 'Liar'), /That image is 1\.1 MB – product images can be up to \*\*1 MB\*\*/);
  let bodyRead = false;
  global.fetch = async () => ({ ok: true, headers: new Map([['content-length', String(5 * 1024 * 1024)]]), arrayBuffer: async () => ((bodyRead = true), new ArrayBuffer(8)) });
  const header = await product(guild, owner, 'add', { name: 'Header', price: '5', description: 'Test.', image: upload('big.png', imageBytes(), 'image/png', 900) });
  assert.match(textOf(lastResponse(header)), /That image is 5\.0 MB/);
  assert.equal(bodyRead, false, 'a too big download is not read at all');
  global.fetch = async () => ({ ok: false, status: 404 });
  const gone = await product(guild, owner, 'add', { name: 'Gone', price: '5', description: 'Test.', image: upload('gone.png', imageBytes()) });
  assert.match(textOf(lastResponse(gone)), /could not download that image/);

  assert.equal(shop.products(guild.id).length, 0);
  const dir = path.join(db.dataDir, 'products');
  const stored = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => shop.products(guild.id).some((p) => f.startsWith(p.id))) : [];
  assert.deepEqual(stored, []);
  assert.equal(images.MAX_BYTES, 1024 * 1024);
});

test('panel refresh uploads the images again and copes with a missing image file', async () => {
  const { guild } = await builtGuild();
  const a = shop.addProduct(guild, { name: 'Alpha', price: '10', description: 'First.', image: { buffer: imageBytes('png'), ext: 'png' } });
  shop.addProduct(guild, { name: 'Beta', price: '12', description: 'Second.', image: { buffer: imageBytes('gif'), ext: 'gif' } });
  await panels.refresh(guild, 'shop');
  const message = shopMessage(guild);
  assert.equal(message.body.files.length, 2, 'files are uploaded with the edit');
  assert.deepEqual(message.body.attachments, [], 'and replace the old uploads');

  fs.rmSync(imagePath(a));
  await panels.refresh(guild, 'shop');
  assert.deepEqual(fileNames(message.body), [`product-${shop.findProduct(guild.id, 'Beta').id}.gif`]);
  assert.match(textOf(message.body), /Alpha[\s\S]*Beta/, 'Alpha is still shown, just without its picture');
  assert.equal(images.attachment(a), null);

  // Sticky / re-sent panels carry their files too.
  const fresh = await panels.send(ch(guild, 'shop'), 'shop');
  assert.equal(fresh.files.length, 1);
});

test('images: the first order-ticket card shows the ordered product, even when another product name is the start of its name', async () => {
  const { guild } = await builtGuild();
  const short = shop.addProduct(guild, { name: 'Spotify', price: '5', description: 'One month.', image: { buffer: imageBytes('png'), ext: 'png' } });
  const long = shop.addProduct(guild, { name: 'Spotify — 12 months', price: '40', description: 'A whole year.', image: { buffer: imageBytes('gif'), ext: 'gif' } });
  const buyer = member(guild);
  await run({ guild, member: buyer, kind: 'modal', customId: `shop:order:${long.id}`, fields: { quantity: '1' }, selects: { payment: ['0'] } });
  const ticket = db.tickets((x) => x.guildId === guild.id && x.ownerId === buyer.id)[0];
  const card = guild.channels.cache.get(ticket.channelId).messageList[0];
  assert.deepEqual(fileNames(card.body), [`product-${long.id}.gif`], 'not the picture of "Spotify"');
  assert.equal(ticket.order.productId, long.id);

  // A "Custom order" ticket only has the typed answer: the longest matching name wins.
  const typed = (value) => shop.ticketProduct(guild.id, { answers: [{ label: 'What would you like to buy?', value }] });
  assert.equal(typed('Spotify — 12 months')?.id, long.id);
  assert.equal(typed('Spotify — 12 months — 40€')?.id, long.id);
  assert.equal(typed('spotify')?.id, short.id);
  assert.equal(typed('Spotify — 5€')?.id, short.id);
  assert.equal(typed('Spotify Premium'), null);
});

// ───────────── Notify me ─────────────

test('Notify me: a Buy button of a product that has sold out since offers Notify me instead of a dead end', async () => {
  const { guild, owner } = await builtGuild();
  const item = shop.addProduct(guild, { name: 'Nitro', price: '10', description: 'Instant.', image: { buffer: imageBytes('png'), ext: 'png' } });
  const announcement = await shop.announceProduct(guild, item);
  assert.ok(customIds(announcement.body).includes(`shop:buy:${item.id}`), '#restocks keeps its Buy now button');
  await product(guild, owner, 'stock', { product: item.id, status: 'out' });

  const buyer = member(guild);
  const buy = await run({ guild, member: buyer, kind: 'button', customId: `shop:buy:${item.id}` });
  assert.equal(buy.state.modals.length, 0, 'no order form');
  assert.ok(buy.deferred && !buy.state.replies.length, 'answered privately (deferred ephemeral reply)');
  const answer = lastResponse(buy);
  assert.match(textOf(answer), /Nitro[\s\S]*Sold out right now – click \*\*Notify me\*\*/);
  assert.ok(customIds(answer).includes(`restock:notify:${item.id}`));
  assert.ok(!customIds(answer).includes(`shop:buy:${item.id}`));
  assert.deepEqual(fileNames(answer), [`product-${item.id}.png`]);

  const notify = await run({ guild, member: buyer, kind: 'button', customId: `restock:notify:${item.id}` });
  assert.match(textOf(lastResponse(notify)), /You're on the list/);
  assert.deepEqual(restock.waiting(guild.id, item.id), [buyer.id]);
});


test('Notify me: a sold-out product offers a toggle, a restock DMs everyone waiting once and clears the list', async () => {
  const { guild, owner } = await builtGuild();
  const item = shop.addProduct(guild, { name: 'Nitro', price: '10', description: 'Instant.', image: { buffer: imageBytes('png'), ext: 'png' } });
  await product(guild, owner, 'stock', { product: item.id, status: 'out' });
  await panels.refresh(guild, 'shop');
  const ids = customIds(shopMessage(guild).body);
  assert.ok(ids.includes(`restock:notify:${item.id}`));
  assert.ok(!ids.includes(`shop:buy:${item.id}`), 'no disabled "Sold out" button any more');

  const [alice, bob, carol] = [member(guild), member(guild), member(guild)];
  const click = (who) => run({ guild, member: who, kind: 'button', customId: `restock:notify:${item.id}` });
  const on = await click(alice);
  assert.match(textOf(lastResponse(on)), /You're on the list/);
  assert.equal(lastResponse(on).flags & 64, 64, 'ephemeral');
  assert.deepEqual(db.guild(guild.id).notify[item.id], [alice.id]);
  const off = await click(alice);
  assert.match(textOf(lastResponse(off)), /Okay, no DM/);
  assert.equal(db.guild(guild.id).notify[item.id], undefined);

  for (const who of [alice, bob, carol]) await click(who);
  guild.closedDms.add(bob.id);
  const events = [];
  hooks.on('productRestocked', ({ guild: g, product: p }) => {
    if (g === guild) events.push(p.id);
  });
  const restocked = await product(guild, owner, 'stock', { product: item.id, status: 'low' });
  assert.match(textOf(lastResponse(restocked)), /low stock[\s\S]*Restock announced[\s\S]*DM sent to 2 of the 3 people waiting/);
  assert.deepEqual(events, [item.id], 'productRestocked emitted once');
  assert.equal(db.guild(guild.id).notify[item.id], undefined, 'list cleared');
  const dms = guild.dms.filter((d) => /Back in stock/.test(textOf(d.payload)));
  assert.deepEqual(dms.map((d) => d.to).sort(), [alice.id, carol.id].sort());
  const dm = dms[0].payload;
  assert.match(textOf(dm), /Nitro\*\* is back in stock at \*\*NØX\*\*/);
  const link = JSON.stringify(dm.components.map((c) => c.toJSON()));
  assert.ok(link.includes(`https://discord.com/channels/${guild.id}/${db.channelId(guild.id, 'shop')}`), 'Buy link to #shop');
  assert.deepEqual(fileNames(dm), [`product-${item.id}.png`]);

  // Already in stock: a second restock sends nothing; the button now says so.
  await shop.setStock(guild, item.id, 'in');
  assert.equal(guild.dms.filter((d) => /Back in stock/.test(textOf(d.payload))).length, 2);
  const late = await click(member(guild));
  assert.match(textOf(lastResponse(late)), /in stock right now/);
  assert.ok(customIds(lastResponse(late)).includes(`shop:buy:${item.id}`));

  // /product edit stock: works the same way.
  await shop.setStock(guild, item.id, 'out');
  const dave = member(guild);
  await click(dave);
  const edit = await product(guild, owner, 'edit', { product: item.id, stock: 'in' });
  assert.match(textOf(lastResponse(edit)), /DM sent to the 1 person waiting/);
  assert.equal(guild.dms.filter((d) => d.to === dave.id && /Back in stock/.test(textOf(d.payload))).length, 1);
  assert.equal(restock.waiting(guild.id, item.id).length, 0);

  // Removing a product forgets who was waiting for it.
  await shop.setStock(guild, item.id, 'out');
  await click(dave);
  shop.removeProduct(guild, item.id);
  assert.equal(db.guild(guild.id).notify[item.id], undefined);
});

test('/product: only admins and sellers can manage the catalog', async () => {
  const { guild } = await builtGuild();
  const item = shop.addProduct(guild, { name: 'Nitro', price: '10', description: 'Instant.' });
  const visitor = member(guild);
  for (const [sub, options] of [['edit', { product: item.id, category: 'Hack' }], ['stock', { product: item.id, status: 'out' }], ['remove', { product: item.id }]]) {
    const i = await product(guild, visitor, sub, options);
    assert.match(textOf(lastResponse(i)), /Only administrators and sellers can manage the shop/);
  }
  assert.deepEqual({ category: item.category, stock: item.stock }, { category: null, stock: 'in' });
  assert.ok(shop.findProduct(guild.id, item.id));
});

test('buying only works through Buy in #shop: no Purchase button, the ticket panel links to the shop', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  const commands = loadCommands();
  const json = (payload) => JSON.stringify((payload.components ?? []).map((c) => (c.toJSON ? c.toJSON() : c)));
  const shopUrl = `https://discord.com/channels/${guild.id}/${db.channelId(guild.id, 'shop')}`;

  // Shop panel: only "How to buy", "Vouches" and "My orders" under the products.
  const shopPanel = json(await panels.render('shop', guild));
  assert.ok(!shopPanel.includes('ticket:open:order') && !shopPanel.includes('"label":"Purchase"'), 'no Purchase button in the shop');
  assert.ok(shopPanel.includes('"label":"How to buy"') && shopPanel.includes('"label":"Vouches"') && shopPanel.includes('"custom_id":"myorders:open"'));

  // Ticket panel: Purchase has a "Go to shop" link instead of "Open".
  const ticketPanel = json(await panels.render('tickets', guild, { style: 'buttons' }));
  assert.ok(!ticketPanel.includes('ticket:open:order'), 'no Open button for Purchase');
  assert.ok(ticketPanel.includes(shopUrl) && ticketPanel.includes('"label":"Go to shop"'));
  assert.ok(ticketPanel.includes('ticket:open:support'), 'other ticket types still open tickets');

  // Info cards point to the shop too.
  for (const key of ['howToBuy', 'payments']) {
    const channel = guild.channels.cache.get(db.channelId(guild.id, key));
    const cards = channel.messageList.map((m) => JSON.stringify(m.body)).join('');
    assert.ok(!cards.includes('ticket:open:order'), `#${key} has no "Place an order" ticket button`);
    assert.ok(cards.includes(shopUrl), `#${key} links to the shop`);
  }

  // Old buttons and forms that were posted before: a friendly pointer to #shop, no ticket.
  const member = guild.addMember('960000000000000001', [db.roleId(guild.id, 'member')]);
  const before = db.tickets(() => true).length;
  for (const args of [
    { kind: 'button', customId: 'ticket:open:order' },
    { kind: 'select', customId: 'ticket:open', values: ['order'] },
    { kind: 'modal', customId: 'ticket:form:order:b', fields: { product: 'GTA V' } },
  ]) {
    const i = createInteraction({ guild, member, ...args });
    await handle(i, commands);
    assert.equal(i.state.modals.length, 0, `${args.customId}: no form`);
    const out = JSON.stringify(lastResponse(i));
    assert.match(out, /click \*\*Buy\*\* next to the product/, args.customId);
    assert.ok(out.includes(shopUrl), `${args.customId}: link to the shop`);
  }
  assert.equal(db.tickets(() => true).length, before, 'no Purchase ticket was opened');
});
