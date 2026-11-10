'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { readNbt, writeNbt, tag, get, text, number } = require('../src/main/nbt');

/* Hand-written NBT bytes – independent of the codec under test. */
const u16 = (n) => Buffer.from([n >> 8, n & 0xff]);
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
};
const str = (s) => Buffer.concat([u16(Buffer.byteLength(s)), Buffer.from(s, 'utf8')]);
const named = (id, name, payload) => Buffer.concat([Buffer.from([id]), str(name), payload]);
const END = Buffer.from([0]);

test('servers.dat written by hand: plain compound with a list of servers, read and written back byte for byte', () => {
  const server = (fields) => Buffer.concat([...fields, END]);
  const bytes = Buffer.concat([
    Buffer.from([10]),
    str(''),
    named(
      9,
      'servers',
      Buffer.concat([
        Buffer.from([10]),
        i32(2),
        server([named(8, 'name', str('HammerShop')), named(8, 'ip', str('mc.hammershop.pl')), named(8, 'icon', str('aWNvbg==')), named(1, 'acceptTextures', Buffer.from([1]))]),
        server([named(1, 'hidden', Buffer.from([1])), named(8, 'ip', str('10.0.0.5:25570')), named(8, 'name', str('Zażółć gęślą jaźń'))]),
      ]),
    ),
    END,
  ]);
  const root = readNbt(bytes);
  assert.equal(root.gzipped, false);
  assert.equal(root.name, '');
  const servers = get(root, 'servers');
  assert.deepEqual([servers.type, servers.elementType, servers.value.length], ['list', 'compound', 2]);
  assert.equal(text(get(root, 'servers', 0, 'name')), 'HammerShop');
  assert.equal(text(get(root, 'servers', 0, 'icon')), 'aWNvbg==');
  assert.equal(number(get(root, 'servers', 0, 'acceptTextures')), 1);
  assert.equal(text(get(root, 'servers', 1, 'name')), 'Zażółć gęślą jaźń');
  assert.deepEqual([...get(root, 'servers', 1).value.keys()], ['hidden', 'ip', 'name'], 'the order of fields is kept');
  assert.equal(get(root, 'servers', 5, 'name'), undefined);
  assert.equal(get(root, 'nope', 'deeper'), undefined);
  assert.ok(writeNbt(root).equals(bytes), 'same bytes after a round trip');
});

test('numbers and arrays are big-endian like Java writes them (bytes written by hand)', () => {
  const bytes = Buffer.concat([
    Buffer.from([10]),
    str('Level'),
    named(2, 'short', Buffer.from([0xff, 0xc0])),
    named(3, 'int', Buffer.from([0x00, 0x00, 0x0f, 0x73])),
    named(4, 'long', Buffer.from([0x00, 0x00, 0x01, 0x9a, 0x6e, 0x5c, 0x30, 0x7b])),
    named(5, 'float', Buffer.from([0x3e, 0x80, 0x00, 0x00])),
    named(6, 'double', Buffer.from([0x40, 0x09, 0x21, 0xfb, 0x54, 0x44, 0x2d, 0x18])),
    named(7, 'bytes', Buffer.concat([i32(3), Buffer.from([0x01, 0x80, 0xff])])),
    named(11, 'ints', Buffer.concat([i32(2), i32(1), i32(-2)])),
    named(12, 'longs', Buffer.concat([i32(2), Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])])),
    named(9, 'empty', Buffer.concat([Buffer.from([0]), i32(0)])),
    END,
  ]);
  const root = readNbt(bytes);
  assert.equal(root.name, 'Level');
  const value = (name) => get(root, name).value;
  assert.deepEqual([value('short'), value('int'), value('long'), value('float'), value('double')], [-64, 3955, 0x19a6e5c307bn, 0.25, Math.PI]);
  assert.deepEqual([...value('bytes')], [1, 128, 255]);
  assert.deepEqual([...value('ints')], [1, -2]);
  assert.deepEqual([...value('longs')], [-2n, 9223372036854775807n]);
  assert.deepEqual([get(root, 'empty').elementType, value('empty')], ['end', []]);
  assert.ok(writeNbt(root).equals(bytes), 'and written back the same, root name included');
  assert.ok(readNbt(zlib.gzipSync(bytes)).gzipped);
  assert.ok(zlib.gunzipSync(writeNbt(readNbt(zlib.gzipSync(bytes)))).equals(bytes));
});

test('every tag type survives a round trip, also gzipped like level.dat (longs stay exact)', () => {
  const data = tag.compound({
    LevelName: tag.string('Nasz świat'),
    LastPlayed: tag.long(1762790400123n),
    RandomSeed: tag.long(-9223372036854775808n),
    GameType: tag.int(1),
    hardcore: tag.byte(true),
    SpawnY: tag.short(-64),
    BorderSize: tag.double(59999968.5),
    rainTime: tag.float(0.25),
    Version: tag.compound({ Name: tag.string('1.21.1'), Id: tag.int(3955), Snapshot: tag.byte(0) }),
    DataPacks: tag.compound({ Enabled: tag.list('string', [tag.string('vanilla'), tag.string('fabric')]), Disabled: tag.list('end') }),
    Pos: tag.list('double', [tag.double(0.5), tag.double(-0), tag.double(1e300)]),
    Nested: tag.list('list', [tag.list('int', [tag.int(1), tag.int(-2)]), tag.list('end')]),
    blob: tag.byteArray([0, 1, 127, 128, 255]),
    heights: tag.intArray([1, -1, 2147483647, -2147483648]),
    states: tag.longArray([0n, -1n, 9223372036854775807n]),
  });
  data.value.set('42', tag.string('a numeric name stays where it was put')); // a plain JS object would move it to the front
  const root = Object.assign(tag.compound({ Data: data, DataVersion: tag.int(3955) }), { name: '' });
  const plain = writeNbt(root);
  const packed = writeNbt(root, { gzip: true });
  assert.deepEqual([packed[0], packed[1]], [0x1f, 0x8b]);
  assert.ok(zlib.gunzipSync(packed).equals(plain));

  const back = readNbt(packed);
  assert.equal(back.gzipped, true);
  assert.deepEqual(back.value, root.value);
  assert.equal(get(back, 'Data', 'LastPlayed').value, 1762790400123n);
  assert.equal(number(get(back, 'Data', 'LastPlayed')), 1762790400123);
  assert.equal(get(back, 'Data', 'RandomSeed').value, -(2n ** 63n));
  assert.equal(text(get(back, 'Data', 'Version', 'Name')), '1.21.1');
  assert.deepEqual([...get(back, 'Data').value.keys()].slice(-2), ['states', '42'], 'compound order is the order in the file, not sorted');
  assert.deepEqual([...get(back, 'Data', 'heights').value], [1, -1, 2147483647, -2147483648]);
  assert.ok(Object.is(get(back, 'Data', 'Pos', 1).value, -0));
  assert.ok(zlib.gunzipSync(writeNbt(back)).equals(plain), 'written gzipped again by default, with the same content');
  assert.ok(writeNbt(back, { gzip: false }).equals(plain));
});

test('strings use Java modified UTF-8: emoji as surrogate pairs, NUL as two bytes', () => {
  const root = Object.assign(tag.compound({ name: tag.string('Serwer 🔨 \u0000 żółw') }), { name: '' });
  const bytes = writeNbt(root);
  assert.ok(bytes.includes(Buffer.from([0xed, 0xa0, 0xbd, 0xed, 0xb4, 0xa8])), 'U+1F528 is written as two 3-byte surrogates');
  assert.ok(bytes.includes(Buffer.from([0xc0, 0x80])), 'U+0000 is written as C0 80');
  assert.ok(!bytes.includes(Buffer.from('🔨', 'utf8')), 'not as a 4-byte UTF-8 sequence');
  assert.equal(text(get(readNbt(bytes), 'name')), 'Serwer 🔨 \u0000 żółw');
  // A file from another tool with plain UTF-8 still reads correctly.
  const foreign = Buffer.concat([Buffer.from([10]), str(''), named(8, 'name', str('🔨')), END]);
  assert.equal(text(get(readNbt(foreign), 'name')), '🔨');
});

test('a NaN keeps its exact bytes, numbers are range-checked, broken files are rejected', () => {
  const nan = Buffer.from([0x7f, 0xc0, 0x12, 0x34]);
  const bytes = Buffer.concat([Buffer.from([10]), str(''), named(5, 'f', nan), END]);
  assert.ok(writeNbt(readNbt(bytes)).equals(bytes));

  const root = (child) => Object.assign(tag.compound({ x: child }), { name: '' });
  assert.throws(() => writeNbt(root(tag.byte(300))), RangeError);
  assert.throws(() => writeNbt(root(tag.int(2 ** 31))), RangeError);
  assert.throws(() => writeNbt(root(tag.list('int', [tag.string('nope')]))), /cannot hold string/);
  assert.throws(() => writeNbt(root({ type: 'banana', value: 1 })), /not a tag/);
  assert.throws(() => writeNbt(root(tag.string('x'.repeat(70000)))), /65535/);
  assert.throws(() => writeNbt(tag.string('root')), /not a compound/);

  const good = writeNbt(root(tag.compound({ deep: tag.list('compound', [tag.compound({ n: tag.long(5) })]) })));
  for (let cut = 1; cut < good.length; cut++) assert.throws(() => readNbt(good.subarray(0, cut)), RangeError, `cut at ${cut}`);
  assert.throws(() => readNbt(Buffer.from([8, 0, 0, 0, 1, 0x41])), /not a compound/);
  assert.throws(() => readNbt(Buffer.concat([Buffer.from([10]), str(''), named(13, 'x', END), END])), /unknown tag type 13/);
  assert.throws(() => readNbt(Buffer.concat([Buffer.from([10]), str(''), named(9, 'l', Buffer.concat([Buffer.from([0]), i32(2000000000)])), END])), /without an element type/);
  assert.throws(() => readNbt(Buffer.concat([Buffer.from([10]), str(''), named(11, 'a', i32(2000000000)), END])), /unexpected end/);
  // 600 compounds inside each other: deeper than the game allows.
  const deep = Buffer.concat([Buffer.from([10]), str(''), ...Array.from({ length: 600 }, () => Buffer.concat([Buffer.from([10]), str('a')])), Buffer.alloc(601)]);
  assert.throws(() => readNbt(deep), /too deep/);
});
