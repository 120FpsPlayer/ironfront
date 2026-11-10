'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const servers = require('../src/main/servers');
const { readNbt, writeNbt, tag, get, text, number } = require('../src/main/nbt');
const { tmpDir } = require('./helpers');

const ICON = Buffer.from('fake png bytes').toString('base64');

/** An instance folder with a servers.dat like the game writes it (icon, resource pack choice, a hidden entry, a field from a mod). */
function instanceWithServers() {
  const dir = tmpDir();
  const root = Object.assign(
    tag.compound({
      servers: tag.list('compound', [
        tag.compound({ name: tag.string('HammerShop'), ip: tag.string('mc.hammershop.pl'), icon: tag.string(ICON), acceptTextures: tag.byte(1), modData: tag.compound({ pinned: tag.long(7n) }) }),
        tag.compound({ ip: tag.string('direct.example.pl'), name: tag.string('Minecraft Server'), hidden: tag.byte(1) }),
        tag.compound({ name: tag.string('Survival §aznajomych'), ip: tag.string('83.12.45.201:25570'), acceptTextures: tag.byte(0) }),
      ]),
      someOtherTag: tag.int(5),
    }),
    { name: '' },
  );
  fs.writeFileSync(path.join(dir, servers.FILE), writeNbt(root));
  return { id: 'x', dir };
}
const onDisk = (instance) => readNbt(fs.readFileSync(path.join(instance.dir, servers.FILE)));

test('server list: read from servers.dat – hidden entries are not shown, icon comes back as a data URL', () => {
  const instance = instanceWithServers();
  assert.deepEqual(servers.list(instance), [
    { index: 0, name: 'HammerShop', address: 'mc.hammershop.pl', icon: `data:image/png;base64,${ICON}`, acceptTextures: true },
    { index: 1, name: 'Survival §aznajomych', address: '83.12.45.201:25570', icon: null, acceptTextures: false },
  ]);
  assert.deepEqual(servers.list({ id: 'new', dir: tmpDir() }), [], 'no servers.dat yet');
});

test('server list: add, edit, move and remove keep icons, unknown fields and hidden entries', () => {
  const instance = instanceWithServers();
  let list = servers.add(instance, { name: '  Skyblock u Oli ', address: ' Play.Example.pl:25566 ' });
  assert.deepEqual(list.map((s) => [s.name, s.address]), [['HammerShop', 'mc.hammershop.pl'], ['Survival §aznajomych', '83.12.45.201:25570'], ['Skyblock u Oli', 'Play.Example.pl:25566']]);
  assert.deepEqual(list[2], { index: 2, name: 'Skyblock u Oli', address: 'Play.Example.pl:25566', icon: null, acceptTextures: null });
  assert.equal(servers.add(instance, { name: '', address: 'bez-nazwy.pl' })[3].name, 'bez-nazwy.pl', 'an empty name becomes the address');

  let root = onDisk(instance);
  assert.equal(root.gzipped, false, 'servers.dat is never compressed');
  assert.equal(number(get(root, 'someOtherTag')), 5);
  assert.deepEqual(get(root, 'servers').value.map((e) => text(get(e, 'ip'))), ['mc.hammershop.pl', '83.12.45.201:25570', 'Play.Example.pl:25566', 'bez-nazwy.pl', 'direct.example.pl'], 'hidden entries stay, after the shown ones');
  assert.equal(number(get(root, 'servers', 4, 'hidden')), 1);
  assert.ok(fs.existsSync(path.join(instance.dir, 'servers.dat_old')), 'the previous file is kept as a backup');

  // Renaming keeps everything else of the entry.
  list = servers.update(instance, 0, { name: 'Hammer' }, 'mc.hammershop.pl');
  root = onDisk(instance);
  assert.equal(list[0].name, 'Hammer');
  assert.equal(text(get(root, 'servers', 0, 'icon')), ICON);
  assert.equal(get(root, 'servers', 0, 'modData', 'pinned').value, 7n);
  assert.equal(number(get(root, 'servers', 0, 'acceptTextures')), 1);
  assert.deepEqual([...get(root, 'servers', 0).value.keys()], ['name', 'ip', 'icon', 'acceptTextures', 'modData']);
  // A new address drops the icon of the old server (the game fetches the new one), nothing else.
  list = servers.update(instance, 0, { address: 'nowy.hammershop.pl' });
  assert.deepEqual([list[0].address, list[0].icon, list[0].acceptTextures], ['nowy.hammershop.pl', null, true]);
  assert.equal(get(onDisk(instance), 'servers', 0, 'modData', 'pinned').value, 7n);

  list = servers.move(instance, 3, 0);
  assert.deepEqual(list.map((s) => s.address), ['bez-nazwy.pl', 'nowy.hammershop.pl', '83.12.45.201:25570', 'Play.Example.pl:25566']);
  list = servers.move(instance, 0, 1);
  assert.deepEqual(list.map((s) => s.index), [0, 1, 2, 3]);
  assert.deepEqual(list.map((s) => s.address).slice(0, 2), ['nowy.hammershop.pl', 'bez-nazwy.pl']);

  list = servers.remove(instance, 1, 'bez-nazwy.pl');
  assert.deepEqual(list.map((s) => s.address), ['nowy.hammershop.pl', '83.12.45.201:25570', 'Play.Example.pl:25566']);
  assert.deepEqual(get(onDisk(instance), 'servers').value.map((e) => text(get(e, 'ip'))).at(-1), 'direct.example.pl');
});

test('server list: addresses, names and positions from the window are checked', () => {
  const instance = instanceWithServers();
  const before = fs.readFileSync(path.join(instance.dir, servers.FILE));
  for (const address of ['', '   ', 'http://x.pl', 'a b.pl', 'x.pl:99999', 'x.pl:0', 'x..pl', '-x.pl', 'x.pl:abc', '[::1]:25565', 'x'.repeat(300), null, undefined, {}]) {
    assert.throws(() => servers.add(instance, { name: 'x', address }), /Podaj poprawny adres serwera/, String(address));
  }
  assert.throws(() => servers.add(instance, { name: 'x'.repeat(49), address: 'ok.pl' }), /najwyżej 48 znaków/);
  assert.throws(() => servers.update(instance, 0, { name: 'x'.repeat(49) }), /najwyżej 48 znaków/);
  assert.throws(() => servers.update(instance, 0, { address: 'nie dobry' }), /Podaj poprawny adres/);
  for (const index of [-1, 2, 1.5, '0', null, NaN]) assert.throws(() => servers.remove(instance, index), /zmieniła się/, String(index));
  assert.throws(() => servers.remove(instance, 0, 'inny.adres.pl'), /zmieniła się/, 'the game changed the list in the meantime');
  assert.throws(() => servers.move(instance, 0, 2), /Nie można przenieść/);
  assert.throws(() => servers.move(instance, 5, 0), /zmieniła się/);
  assert.ok(fs.readFileSync(path.join(instance.dir, servers.FILE)).equals(before), 'a refused change writes nothing');
  assert.equal(servers.cleanAddress(' żółw.pl '), 'żółw.pl');
  assert.equal(servers.cleanAddress('192.168.1.10:25565'), '192.168.1.10:25565');
  assert.equal(servers.add(instance, { name: 'Z\nnową\tlinią', address: 'ok.pl' }).at(-1).name, 'Z nową linią');
});

test('server list: a damaged servers.dat reads as empty (like in the game) and is kept as servers.dat_old', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, servers.FILE), 'this is not NBT');
  const instance = { id: 'x', dir };
  assert.deepEqual(servers.list(instance), []);
  assert.deepEqual(servers.add(instance, { name: 'Nowy', address: 'nowy.pl' }).map((s) => s.name), ['Nowy']);
  assert.equal(fs.readFileSync(path.join(dir, 'servers.dat_old'), 'utf8'), 'this is not NBT');
  // A list written with the "end" element type (how the game stores an empty list) accepts servers.
  fs.writeFileSync(path.join(dir, servers.FILE), writeNbt(Object.assign(tag.compound({ servers: tag.list('end') }), { name: '' })));
  assert.deepEqual(servers.add(instance, { name: 'A', address: 'a.pl' }).map((s) => s.address), ['a.pl']);
  assert.equal(get(readNbt(fs.readFileSync(path.join(dir, servers.FILE))), 'servers').elementType, 'compound');
});
