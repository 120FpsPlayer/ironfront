'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApplicationCommandOptionType: T, CommandInteractionOptionResolver } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const featured = require('../src/features/featured');
const { UserError } = require('../src/lib/utils');
const { unlocalize } = require('../src/lib/commandsPl');

const commands = loadCommands();

let n = 950000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));
const builtGuild = async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  return guild;
};

const run = async (guild, who, subcommand, options = {}) => {
  const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'featured', subcommand, options });
  await handle(i, commands);
  return i;
};
const out = (i) => textOf(lastResponse(i));
const BASE = { name: 'Hammer SMP', address: 'mc.hammershop.pl', description: 'Survival z ekonomią i działkami.' };

test('/featured add: sellers and admins add a server – the launcher gets exactly the fields of its API', async () => {
  const guild = await builtGuild();
  const seller = member(guild, ['member', 'seller']);
  for (const who of [member(guild), member(guild, ['member', 'support'])]) {
    for (const [sub, options] of [['add', BASE], ['remove', { server: 'hammer-smp' }], ['list', {}]]) {
      assert.match(out(await run(guild, who, sub, options)), /Tylko administratorzy i sprzedawcy mogą zarządzać polecanymi serwerami/);
    }
  }
  assert.deepEqual(featured.list(guild.id), []);

  const added = await run(guild, seller, 'add', {
    ...BASE,
    address: '  MC.HammerShop.pl:25566 ',
    tags: 'Survival, PvP ,  survival,ekonomia',
    icon: 'https://cdn.hammershop.pl/icons/smp.png',
    mc: '1.21.4',
    loader: 'fabric',
    pack: 'hammer-smp-pack',
  });
  const text = out(added);
  assert.match(text, /Hammer SMP jest na liście polecanych/);
  assert.match(text, /Adres `mc\.hammershop\.pl:25566`/);
  assert.match(text, /Wersja Minecraft 1\.21\.4\nLoader Fabric/);
  assert.match(text, /Tagi survival, pvp, ekonomia/);
  assert.deepEqual(featured.publicList(guild.id), [
    { id: 'hammer-smp', name: 'Hammer SMP', address: 'mc.hammershop.pl:25566', description: 'Survival z ekonomią i działkami.', tags: ['survival', 'pvp', 'ekonomia'], icon: 'https://cdn.hammershop.pl/icons/smp.png', mc: '1.21.4', loader: 'fabric', pack: 'hammer-smp-pack' },
  ]);
  assert.equal(featured.find(guild.id, 'hammer-smp').addedBy, seller.id);
  const log = guild.channels.cache.get((db.channelId(guild.id, 'serverLogs') ?? db.settings(guild.id).logChannelId)).messageList.at(-1);
  assert.match(textOf(log.body), /Polecany serwer dodany[\s\S]*\*\*Hammer SMP\*\* — `mc\.hammershop\.pl:25566`/);

  // Only what is required: the rest is null / empty, never missing. The same name gets its own ID.
  await run(guild, seller, 'add', { ...BASE, address: '123.45.67.89' });
  assert.deepEqual(featured.publicList(guild.id)[1], { id: 'hammer-smp-2', name: 'Hammer SMP', address: '123.45.67.89', description: BASE.description, tags: [], icon: null, mc: null, loader: null, pack: null });
  await run(guild, seller, 'add', { name: 'Żółw & Łoś ⚒', address: 'zolw.example.pl', description: 'x' });
  assert.equal(featured.list(guild.id)[2].id, 'zolw-los');

  const list = out(await run(guild, seller, 'list'));
  assert.match(list, /Polecane serwery \(3\/25\)/);
  assert.match(list, /\*\*Hammer SMP\*\* — `mc\.hammershop\.pl:25566`\nSurvival z ekonomią i działkami\.\n-# Minecraft 1\.21\.4 · Fabric · paczka: hammer-smp-pack · survival, pvp, ekonomia · 🖼️ ikona/);
});

test('/featured add checks the address (host or host:port) and that the icon is an https address', async () => {
  const guild = await builtGuild();
  const owner = guild.members.cache.get(guild.ownerId);

  for (const address of ['https://mc.example.pl', 'mc.example.pl/lobby', 'mc example.pl', 'localhost', 'serwer', 'mc.example.pl:0', 'mc.example.pl:70000', 'mc.example.pl:abc', 'mc.example.pl:25565:1', '256.1.1.1', '1.2.3', '-bad.example.pl', 'mc..example.pl', '[::1]:25565', '', `${'a'.repeat(64)}.pl`]) {
    const text = out(await run(guild, owner, 'add', { ...BASE, address }));
    assert.match(text, /Podaj adres serwera jako \*\*host\*\* albo \*\*host:port\*\*|Port serwera musi być liczbą od 1 do 65535/, `refused: "${address}" → ${text}`);
  }
  for (const icon of ['http://cdn.example.pl/icon.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'ftp://cdn.example.pl/icon.png', '//cdn.example.pl/icon.png', 'cdn.example.pl/icon.png', 'https://user:pass@cdn.example.pl/icon.png', 'https://localhost/icon.png', `https://cdn.example.pl/${'a'.repeat(300)}.png`]) {
    const text = out(await run(guild, owner, 'add', { ...BASE, icon }));
    assert.match(text, /Ikona musi być adresem obrazka zaczynającym się od `https:\/\/`/, `refused: ${icon}`);
  }
  assert.match(out(await run(guild, owner, 'add', { ...BASE, mc: 'latest' })), /Wersję Minecrafta podaj jako same liczby/);
  assert.match(out(await run(guild, owner, 'add', { ...BASE, tags: 'a,b,c,d,e,f,g' })), /Podaj najwyżej 6 tagów/);
  assert.match(out(await run(guild, owner, 'add', { ...BASE, tags: 'x'.repeat(21) })), /jest za długi – najwyżej 20 znaków/);
  assert.match(out(await run(guild, owner, 'add', { ...BASE, name: '   ' })), /Nazwa serwera musi mieć od 1 do 40 znaków/);
  assert.match(out(await run(guild, owner, 'add', { ...BASE, description: 'x'.repeat(201) })), /Opis musi mieć od 1 do 200 znaków/);
  // Discord only offers the listed loaders – the list itself refuses anything else too.
  assert.throws(() => featured.add(guild.id, { ...BASE, loader: 'bukkit' }), (err) => err instanceof UserError && /Nieznany loader\. Do wyboru: fabric, quilt, forge, neoforge, vanilla/.test(err.message));
  assert.deepEqual(featured.list(guild.id), [], 'nothing was added');

  for (const [address, stored] of [['mc.example.pl', 'mc.example.pl'], ['PLAY.Example.PL:25565', 'play.example.pl:25565'], ['123.45.67.89:19132', '123.45.67.89:19132'], ['xn--bcher-kva.example', 'xn--bcher-kva.example'], ['a-b.c0.example.pl:1', 'a-b.c0.example.pl:1']]) {
    assert.equal(featured.parseAddress(address), stored);
  }
  assert.equal(featured.parseIcon('https://cdn.example.pl/icon.png?v=2'), 'https://cdn.example.pl/icon.png?v=2');
  assert.equal(featured.parseIcon(''), null);

  // One entry per address, and at most 25 servers.
  await run(guild, owner, 'add', BASE);
  assert.match(out(await run(guild, owner, 'add', { ...BASE, name: 'Kopia', address: 'MC.hammershop.pl' })), /Serwer \*\*mc\.hammershop\.pl\*\* jest już na liście polecanych jako \*\*Hammer SMP\*\*/);
  for (let k = 2; k <= featured.MAX_SERVERS; k += 1) featured.add(guild.id, { ...BASE, address: `s${k}.example.pl` });
  assert.match(out(await run(guild, owner, 'add', { ...BASE, address: 'jeszcze-jeden.example.pl' })), /najwyżej 25 serwerów/);
  assert.equal(featured.list(guild.id).length, 25);
  assert.equal(new Set(featured.list(guild.id).map((s) => s.id)).size, 25, 'every entry has its own ID');
  const full = await run(guild, owner, 'list');
  assert.match(out(full), /Polecane serwery \(25\/25\)/, 'the full list fits in one card');
});

test('/featured remove and its suggestions; an empty list says how to add the first server', async () => {
  const guild = await builtGuild();
  const seller = member(guild, ['member', 'seller']);
  assert.match(out(await run(guild, seller, 'list')), /Polecane serwery \(0\/25\)[\s\S]*Lista jest pusta – dodaj pierwszy serwer przez `\/polecane dodaj`/);
  await run(guild, seller, 'add', BASE);
  await run(guild, seller, 'add', { name: 'SkyBlock', address: 'sky.example.pl', description: 'Wyspy.' });

  const suggest = async (who, focused) => {
    const i = createInteraction({ guild, member: who, kind: 'autocomplete', commandName: 'featured', focused });
    await handle(i, commands);
    return i.state.responded;
  };
  assert.deepEqual(await suggest(seller, ''), [{ name: 'Hammer SMP · mc.hammershop.pl', value: 'hammer-smp' }, { name: 'SkyBlock · sky.example.pl', value: 'skyblock' }]);
  assert.deepEqual((await suggest(seller, 'SKY')).map((c) => c.value), ['skyblock']);
  assert.deepEqual(await suggest(member(guild), ''), [], 'members get no suggestions');

  assert.match(out(await run(guild, seller, 'remove', { server: 'nie-ma-takiego' })), /Nie ma takiego serwera na liście polecanych/);
  const gone = await run(guild, seller, 'remove', { server: 'skyblock' });
  assert.match(out(gone), /Usunięto \*\*SkyBlock\*\* \(`sky\.example\.pl`\) z polecanych serwerów/);
  assert.deepEqual(featured.list(guild.id).map((s) => s.id), ['hammer-smp']);
  const log = guild.channels.cache.get((db.channelId(guild.id, 'serverLogs') ?? db.settings(guild.id).logChannelId)).messageList.at(-1);
  assert.match(textOf(log.body), /Polecany serwer usunięty[\s\S]*SkyBlock/);
  // Typed by hand instead of picked: the address works as well.
  assert.match(out(await run(guild, seller, 'remove', { server: 'MC.HammerShop.pl' })), /Usunięto \*\*Hammer SMP\*\*/);
  assert.deepEqual(featured.publicList(guild.id), []);
});

test('the Polish command reaches the code: /polecane dodaj nazwa: adres: opis: tagi: ikona: wersja: loader: paczka:', () => {
  const str = (name, value) => ({ name, type: T.String, value });
  const used = {
    commandName: 'polecane',
    client: {},
    options: new CommandInteractionOptionResolver({}, [{ name: 'dodaj', type: T.Subcommand, options: [str('nazwa', 'Hammer SMP'), str('adres', 'mc.hammershop.pl'), str('opis', 'Opis'), str('tagi', 'pvp'), str('ikona', 'https://x.pl/i.png'), str('wersja', '1.21.4'), str('loader', 'fabric'), str('paczka', 'pack')] }], {}),
  };
  unlocalize(used);
  assert.equal(used.commandName, 'featured');
  assert.equal(used.options.getSubcommand(), 'add');
  assert.deepEqual(['name', 'address', 'description', 'tags', 'icon', 'mc', 'loader', 'pack'].map((k) => used.options.getString(k)), ['Hammer SMP', 'mc.hammershop.pl', 'Opis', 'pvp', 'https://x.pl/i.png', '1.21.4', 'fabric', 'pack']);
  const remove = { commandName: 'polecane', client: {}, options: new CommandInteractionOptionResolver({}, [{ name: 'usun', type: T.Subcommand, options: [str('serwer', 'hammer-smp')] }], {}) };
  unlocalize(remove);
  assert.deepEqual([remove.options.getSubcommand(), remove.options.getString('server')], ['remove', 'hammer-smp']);
});
