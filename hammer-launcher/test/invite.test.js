'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const invite = require('../src/main/invite');

const { parseInvite, buildInvite, inviteFromArgs, InviteError } = invite;
const rejects = (fn, pattern) => assert.throws(fn, (err) => err instanceof InviteError && pattern.test(err.message), `expected an InviteError matching ${pattern}`);
const NOT = /To nie wygląda na zaproszenie do Hammer Launchera/;

test('invite: a full link – every field read and checked', () => {
  const full = 'hammer://join?server=mc.hammershop.pl:25566&name=Hammer%20SMP&mc=1.21.4&loader=fabric&pack=fabulously-optimized&icon=https%3A%2F%2Fhammershop.pl%2Ficon.png';
  assert.deepEqual(parseInvite(full), { server: 'mc.hammershop.pl:25566', name: 'Hammer SMP', mc: '1.21.4', loader: 'fabric', pack: 'fabulously-optimized', icon: 'https://hammershop.pl/icon.png' });
  // Only the server is required.
  assert.deepEqual(parseInvite('hammer://join?server=mc.hammershop.pl'), { server: 'mc.hammershop.pl', name: null, mc: null, loader: null, pack: null, icon: null });
  // The shop's page forwards to the same query – its address is an invitation too.
  assert.deepEqual(parseInvite('https://hammershop.pl/join?server=mc.hammershop.pl&name=Hammer+SMP&loader=NeoForge'), { server: 'mc.hammershop.pl', name: 'Hammer SMP', mc: null, loader: 'neoforge', pack: null, icon: null });
  assert.equal(parseInvite('https://sklep.example.pl/hammer/join/?server=10.0.0.5:25570').server, '10.0.0.5:25570');
  // The shapes a link arrives in: from Windows with a slash, in capitals, pasted from Discord in <…>, quotes or backticks.
  for (const link of ['hammer://join/?server=mc.hammershop.pl', 'HAMMER://JOIN?server=mc.hammershop.pl', 'hammer:join?server=mc.hammershop.pl', '<hammer://join?server=mc.hammershop.pl>', '  `hammer://join?server=mc.hammershop.pl`\n', '„hammer://join?server=mc.hammershop.pl”', '"hammer://join?server=mc.hammershop.pl"']) {
    assert.equal(parseInvite(link).server, 'mc.hammershop.pl', link);
  }
  // Unknown parameters are ignored; of a repeated one the first counts.
  assert.deepEqual(parseInvite('hammer://join?utm_source=discord&server=a.example.pl&server=b.example.pl&run=calc.exe&javaArgs=-Xmx99g&name=A'), { server: 'a.example.pl', name: 'A', mc: null, loader: null, pack: null, icon: null });
  // Polish letters in a name; a pack given as a Modrinth id.
  assert.deepEqual(parseInvite('hammer://join?server=mc.example.pl&name=%C5%BB%C3%B3%C5%82ty%20serwer&pack=1KVo5zza').name, 'Żółty serwer');
  assert.equal(parseInvite('hammer://join?server=mc.example.pl&pack=1KVo5zza').pack, '1KVo5zza');
  for (const loader of ['fabric', 'quilt', 'forge', 'neoforge', 'vanilla']) assert.equal(parseInvite(`hammer://join?server=a.pl&loader=${loader}`).loader, loader);
  for (const mc of ['1.21.4', '26.1', '24w14a', '1.21.2-pre1']) assert.equal(parseInvite(`hammer://join?server=a.pl&mc=${mc}`).mc, mc);
});

test('invite: a malformed link gets a calm Polish sentence – never a stack trace', () => {
  for (const text of ['', '   ', null, undefined]) rejects(() => parseInvite(text), /Wklej link z zaproszeniem/);
  for (const text of [
    'mc.hammershop.pl',
    'to nie jest link',
    'hammer://play?server=mc.hammershop.pl',
    'hammer://join.evil/?server=mc.hammershop.pl',
    'hammer://evil/join?server=mc.hammershop.pl',
    'hammer://',
    'http://hammershop.pl/join?server=mc.hammershop.pl',
    'https://hammershop.pl/?server=mc.hammershop.pl',
    'https://hammershop.pl/joined?server=mc.hammershop.pl',
    'https://hammershop.pl/join/now?server=mc.hammershop.pl',
    'minecraft://join?server=mc.hammershop.pl',
    'file:///C:/Windows/join?server=mc.hammershop.pl',
    'javascript:alert(1)//join?server=a.pl',
    'HL1.abcdef',
    'https://',
    '://join',
  ]) {
    rejects(() => parseInvite(text), NOT);
  }
  rejects(() => parseInvite('hammer://join'), /brakuje adresu serwera/);
  rejects(() => parseInvite('hammer://join?name=Bez%20adresu&mc=1.21.4'), /brakuje adresu serwera/);
  rejects(() => parseInvite('hammer://join?server='), /brakuje adresu serwera/);
  rejects(() => parseInvite('hammer://join?server=%20'), /brakuje adresu serwera/);
  rejects(() => parseInvite(`hammer://join?server=mc.hammershop.pl&name=${'x'.repeat(2100)}`), /za długi jak na zaproszenie/);
  // Whatever is wrong, the message is for a player.
  for (const text of ['hammer://join?server=a b', 'https://[', 'hammer://join?server=%00', `hammer://join?server=${'a'.repeat(5000)}`, '\u0000\u0001\u0002', 'hammer://join?server=x&loader[]=fabric']) {
    try {
      parseInvite(text);
    } catch (err) {
      assert.ok(err instanceof InviteError, `${JSON.stringify(text)} → ${err.name}`);
      assert.doesNotMatch(err.message, /Error|ERR_|Invalid URL|undefined|\bat\b /);
      assert.match(err.message, /\.$/);
    }
  }
});

test('invite: every field is checked – host[:port] only, known loaders, version and pack as plain words', () => {
  const link = (query) => `hammer://join?${query}`;
  for (const server of ['https://mc.hammershop.pl', 'mc.hammershop.pl/path', 'mc.hammershop.pl:99999', 'mc.hammershop.pl:0', 'mc.hammershop.pl:abc', 'a b.pl', 'user@mc.hammershop.pl', 'mc..pl', '-mc.pl', 'mc.pl;rm -rf', 'mc.pl" --flag', '[::1]:25565', '../etc', `${'a'.repeat(254)}.pl`]) {
    rejects(() => parseInvite(link(`server=${encodeURIComponent(server)}`)), /nieprawidłowy adres serwera/);
  }
  assert.equal(parseInvite(link('server=%20MC.Example.pl:25565%20')).server, 'MC.Example.pl:25565');
  assert.equal(parseInvite(link('server=192.168.1.10')).server, '192.168.1.10');
  rejects(() => parseInvite(link(`server=a.pl&name=${'x'.repeat(49)}`)), /Nazwa serwera w tym zaproszeniu jest za długa/);
  assert.equal(parseInvite(link(`server=a.pl&name=${'x'.repeat(48)}`)).name.length, 48);
  assert.equal(parseInvite(link('server=a.pl&name=%20Serwer%E2%80%AE%00%0A%20Oli%20')).name, 'Serwer Oli', 'control and text-direction characters never get through');
  assert.equal(parseInvite(link('server=a.pl&name=%20%0A')).name, null);
  for (const mc of ['../1.21', '1.21/x', '<1.21>', 'x'.repeat(41), '1.21%0Ax', '-1.21', '1.21;x']) rejects(() => parseInvite(link(`server=a.pl&mc=${mc}`)), /nieprawidłowa wersja Minecrafta/);
  for (const loader of ['optifine', 'liteloader', 'fabric,forge', 'fabric%20', 'x']) {
    if (loader === 'fabric%20') assert.equal(parseInvite(link(`server=a.pl&loader=${loader}`)).loader, 'fabric');
    else rejects(() => parseInvite(link(`server=a.pl&loader=${loader}`)), /nieznany loader/);
  }
  for (const pack of ['a', 'ab', '../../x', 'https://modrinth.com/modpack/x', 'pack/x', 'pack?x=1', 'pack x', '-pack', 'x'.repeat(65), 'pack%00']) rejects(() => parseInvite(link(`server=a.pl&pack=${encodeURIComponent(pack)}`)), /nieprawidłowa paczka modów/);
  for (const pack of ['fabulously-optimized', '1KVo5zza', 'better_mc.plus', 'c++pack', 'abc']) assert.equal(parseInvite(link(`server=a.pl&pack=${encodeURIComponent(pack)}`)).pack, pack);
});

test('invite: the icon is only an https address to show – anything else is simply not there', () => {
  const icon = (value) => parseInvite(`hammer://join?server=a.pl&icon=${encodeURIComponent(value)}`).icon;
  assert.equal(icon('https://cdn.example.pl/ikona.png'), 'https://cdn.example.pl/ikona.png');
  assert.equal(icon('https://cdn.example.pl/i.png?size=64#x'), 'https://cdn.example.pl/i.png?size=64#x');
  for (const value of ['http://cdn.example.pl/ikona.png', 'data:image/png;base64,AAAA', 'file:///C:/Users/Gracz/zdjecie.png', 'javascript:alert(1)', '//cdn.example.pl/i.png', 'cdn.example.pl/i.png', 'https://user:haslo@cdn.example.pl/i.png', 'https://localhost/i.png', 'https://', `https://cdn.example.pl/${'x'.repeat(300)}.png`, ' ']) {
    assert.equal(icon(value), null, value);
  }
  // A bad icon never makes the invitation itself invalid.
  assert.equal(parseInvite('hammer://join?server=a.pl&icon=javascript:alert(1)').server, 'a.pl');
});

test('invite: making a link – the shop page when the launcher has a website, else hammer://', () => {
  const fields = { server: 'mc.hammershop.pl:25566', name: 'Hammer SMP & przyjaciele', mc: '1.21.4', loader: 'fabric' };
  const web = buildInvite(fields, { website: 'https://hammershop.pl/' });
  assert.equal(web, 'https://hammershop.pl/join?server=mc.hammershop.pl%3A25566&name=Hammer+SMP+%26+przyjaciele&mc=1.21.4&loader=fabric');
  assert.deepEqual(parseInvite(web), { ...fields, pack: null, icon: null }, 'and it reads back to the same thing');
  const plain = buildInvite(fields);
  assert.equal(plain, 'hammer://join?server=mc.hammershop.pl%3A25566&name=Hammer+SMP+%26+przyjaciele&mc=1.21.4&loader=fabric');
  assert.deepEqual(parseInvite(plain), { ...fields, pack: null, icon: null });
  // What the page hands to the launcher is the same query behind hammer://join.
  assert.deepEqual(parseInvite(`hammer://join${new URL(web).search}`), { ...fields, pack: null, icon: null });
  // A website that is not https (or not an address) is never put into a link.
  for (const website of ['', null, 'http://hammershop.pl', 'hammershop.pl', 'javascript:alert(1)', 'https://', 'https://hammershop.pl/?x=1']) assert.match(buildInvite(fields, { website }), /^hammer:\/\/join\?/);
  assert.equal(buildInvite({ server: 'a.pl' }, { website: 'https://sklep.example.pl/hammer' }), 'https://sklep.example.pl/hammer/join?server=a.pl');
  // Only what is given, in a fixed order; empty fields leave no trace.
  assert.equal(buildInvite({ icon: 'https://x.pl/i.png', pack: '1KVo5zza', server: 'a.pl', name: '', mc: null, extra: 'x' }), 'hammer://join?server=a.pl&pack=1KVo5zza&icon=https%3A%2F%2Fx.pl%2Fi.png');
  // The fields of a link being made are checked like those of one being read.
  rejects(() => buildInvite({ server: 'https://a.pl' }), /nieprawidłowy adres serwera/);
  rejects(() => buildInvite({ name: 'x' }), /brakuje adresu serwera/);
  rejects(() => buildInvite({ server: 'a.pl', loader: 'optifine' }), /nieznany loader/);
});

test('invite: the link among the arguments the launcher was started with', () => {
  assert.equal(inviteFromArgs(['C:\\Program Files\\Hammer Launcher\\Hammer Launcher.exe', '--', 'hammer://join?server=mc.hammershop.pl']), 'hammer://join?server=mc.hammershop.pl');
  assert.equal(inviteFromArgs(['electron', '.', '--allow-file-access-from-files', 'HAMMER://join/?server=a.pl', '--original-process-start-time=1']), 'HAMMER://join/?server=a.pl');
  assert.equal(inviteFromArgs(['hammer-launcher', '--no-sandbox']), null);
  assert.equal(inviteFromArgs(['hammer-launcher', 'https://hammershop.pl/join?server=a.pl', 'C:\\hammer:\\x']), null, 'only the hammer: scheme is taken from the command line');
  assert.equal(inviteFromArgs([]), null);
  assert.equal(inviteFromArgs(undefined), null);
  assert.equal(inviteFromArgs([null, 7, {}]), null);
  // Whatever is passed along is still only text for parseInvite – which refuses what is not an invitation.
  rejects(() => parseInvite(inviteFromArgs(['x', 'hammer://join" --gpu-launcher="calc.exe'])), /brakuje adresu serwera|To nie wygląda/);
  rejects(() => parseInvite(inviteFromArgs(['x', 'hammer://run?cmd=calc.exe'])), NOT);
  assert.ok(inviteFromArgs(['x', `hammer://join?server=${'a'.repeat(9000)}`]).length <= invite.MAX_LINK * 2);
});
