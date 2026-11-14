'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ApplicationCommandOptionType: T, CommandInteractionOptionResolver, MessageFlags } = require('discord.js');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const { env } = require('../src/env');
const plus = require('../src/lib/plus');
const hammerplus = require('../src/features/hammerplus');
const { unlocalize } = require('../src/lib/commandsPl');

const commands = loadCommands();
const DAY = 86_400_000;
const NOTCH = '069a79f444e94726a5befca90e38aaf5';
const STEVE = '8667ba71b85a4004af54457a9734eed7';

const newKey = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const KEY = newKey();

// Mojang, offline: the command gets this instead of the real fetch.
const mojang = { calls: [], down: false, status: null, profiles: { notch: { id: NOTCH, name: 'Notch' }, _steve_: { id: STEVE, name: '_Steve_' } } };
const fakeMojang = async (url, options) => {
  mojang.calls.push(String(url));
  assert.ok(options.signal, 'the lookup has a timeout');
  if (mojang.down) throw new TypeError('fetch failed');
  if (mojang.status) return { ok: false, status: mojang.status, json: async () => ({}) };
  const profile = mojang.profiles[decodeURIComponent(String(url).split('/').pop()).toLowerCase()];
  return profile ? { ok: true, status: 200, json: async () => profile } : { ok: false, status: 404, json: async () => ({ errorMessage: "Couldn't find any profile with that name" }) };
};

let n = 940000000000000000n;
const uid = () => String(++n);
const role = (guild, key) => db.roleId(guild.id, key);
const member = (guild, roles = ['member']) => guild.addMember(uid(), roles.map((k) => role(guild, k)));

let guild;
let seller;
test.before(async () => {
  guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  seller = member(guild, ['member', 'seller']);
});
/** Every test starts from the same state – called first in each one (no hooks, so it reads top to bottom). */
function reset() {
  env.plusPrivateKey = KEY;
  Object.assign(mojang, { calls: [], down: false, status: null });
  hammerplus.setFetch(fakeMojang);
}

const run = async (who, subcommand, options = {}, g = guild) => {
  const i = createInteraction({ guild: g, member: who, kind: 'command', commandName: 'hammerplus', subcommand, options });
  const defer = i.deferReply;
  i.deferReply = async (opts) => {
    i.state.deferOptions = opts;
    return defer(opts);
  };
  await handle(i, commands);
  return i;
};
const out = (i) => textOf(lastResponse(i));
const codeIn = (i) => /```\n(HP1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\n```/.exec(lastResponse(i).content ?? '')?.[1] ?? null;
const logs = () => guild.channels.cache.get((db.channelId(guild.id, 'serverLogs') ?? db.settings(guild.id).logChannelId)).messageList;

test('/hammerplus: admins and sellers only – nobody else issues, checks or lists codes', async () => {
  reset();
  const buyer = member(guild);
  const support = member(guild, ['member', 'support']);
  for (const who of [buyer, support]) {
    for (const [sub, options] of [['grant', { nick: 'Notch', days: 30 }], ['check', { code: 'HP1.a.b' }], ['list', {}], ['key', {}]]) {
      assert.match(out(await run(who, sub, options)), /Tylko administratorzy i sprzedawcy mogą zarządzać Hammer\+/, `${sub}`);
    }
  }
  assert.equal(mojang.calls.length, 0);
  assert.equal(hammerplus.codes(guild.id).length, 0);
  assert.doesNotMatch(out(await run(guild.members.cache.get(guild.ownerId), 'key')), /Tylko administratorzy/);
});

test('without the key every subcommand says what to add to .env – and "key" shows it is not set', async () => {
  reset();
  env.plusPrivateKey = '';
  for (const [sub, options] of [['grant', { nick: 'Notch', days: 30 }], ['check', { code: 'HP1.a.b' }], ['list', {}]]) {
    const text = out(await run(seller, sub, options));
    assert.match(text, /Hammer\+ nie jest jeszcze skonfigurowany – w pliku `\.env` brakuje klucza/, sub);
    assert.match(text, /npm run plus-key/);
    assert.match(text, /`HAMMER_PLUS_PRIVATE_KEY=…`/);
    assert.match(text, /`\/hammerplus klucz`/);
  }
  assert.equal(mojang.calls.length, 0, 'Mojang is not asked for nothing');
  assert.equal(hammerplus.codes(guild.id).length, 0);
  const key = out(await run(seller, 'key'));
  assert.match(key, /Klucz Hammer\+ nie jest ustawiony[\s\S]*npm run plus-key[\s\S]*HAMMER_PLUS_PRIVATE_KEY/);

  // Set, but not a key the bot can sign with.
  env.plusPrivateKey = 'bm90IGEga2V5';
  assert.match(out(await run(seller, 'grant', { nick: 'Notch', days: 30 })), /`HAMMER_PLUS_PRIVATE_KEY` w pliku `\.env` jest nieprawidłowy/);
  assert.match(out(await run(seller, 'key')), /nie jest ustawiony[\s\S]*jest nieprawidłowy/);
});

test('/hammerplus grant: Mojang lookup → a signed code in a code block, two sentences for the customer, a record without the code', async () => {
  reset();
  const before = Date.now();
  const i = await run(seller, 'grant', { nick: 'notch', days: 30 });
  const res = lastResponse(i);
  assert.equal(i.state.deferOptions?.flags, MessageFlags.Ephemeral, 'only the staff member sees the code');
  assert.deepEqual(mojang.calls, ['https://api.mojang.com/users/profiles/minecraft/notch']);

  const code = codeIn(i);
  assert.ok(code, `the code is in a code block: ${res.content}`);
  const payload = plus.verify(code);
  assert.equal(payload.mc, NOTCH, 'bound to the Minecraft account');
  assert.ok(Math.abs(payload.exp * 1000 - (before + 30 * DAY)) < 5000, '30 days');
  assert.match(res.content, /> Wpisz ten kod w Hammer Launcherze: \*\*Hammer\+\*\* → \*\*„Mam kod”\*\*\.\n> Kod działa tylko na koncie Minecraft `Notch`\./);
  assert.match(out(i), new RegExp(`Konto Minecraft \`Notch\` · \`${NOTCH}\``));
  assert.match(out(i), /Ważny do <t:\d+:f> \(<t:\d+:R>\)/);

  const [record] = hammerplus.codes(guild.id);
  assert.deepEqual({ ...record, at: null }, { id: payload.id, mc: NOTCH, nick: 'Notch', exp: payload.exp, by: seller.id, at: null }, "Mojang's spelling of the nick, who issued it");
  assert.ok(record.at >= before && record.at <= Date.now());
  const stored = JSON.stringify(db.guild(guild.id));
  assert.ok(!stored.includes(code) && !stored.includes(code.split('.')[2]), 'the code itself is never stored');

  const log = logs().at(-1);
  assert.match(textOf(log.body), new RegExp(`Kod Hammer\\+ wystawiony[\\s\\S]*\`Notch\` · \`${NOTCH}\`[\\s\\S]*ID \`${payload.id}\``));
  assert.ok(!textOf(log.body).includes('HP1.'), 'and never logged');

  // 0 days = forever. A nick with underscores stays readable (code span, not italics).
  const forever = await run(seller, 'grant', { nick: '_Steve_', days: 0 });
  assert.equal(plus.verify(codeIn(forever)).exp, 0);
  assert.match(lastResponse(forever).content, /`_Steve_`\*\* – ważny na zawsze:/);
  assert.match(lastResponse(forever).content, /Kod działa tylko na koncie Minecraft `_Steve_`\./);
  assert.equal(hammerplus.codes(guild.id).length, 2);
});

test('/hammerplus grant: unknown nick, no connection and a bad nick are explained in Polish – and nothing is issued', async () => {
  reset();
  const count = hammerplus.codes(guild.id).length;
  const unknown = await run(seller, 'grant', { nick: 'ghost_player', days: 30 });
  assert.match(out(unknown), /Nie ma konta Minecraft o nicku \*\*ghost_player\*\*\. Sprawdź pisownię/);
  assert.equal(codeIn(unknown), null);

  mojang.status = 204; // how Mojang used to answer for a nick nobody has
  assert.match(out(await run(seller, 'grant', { nick: 'ghost_player', days: 30 })), /Nie ma konta Minecraft o nicku/);
  mojang.status = 429;
  assert.match(out(await run(seller, 'grant', { nick: 'Notch', days: 30 })), /Mojang chwilowo ogranicza liczbę zapytań/);
  mojang.status = 503;
  assert.match(out(await run(seller, 'grant', { nick: 'Notch', days: 30 })), /Nie udało się połączyć z Mojang/);
  mojang.status = null;

  mojang.down = true;
  assert.match(out(await run(seller, 'grant', { nick: 'Notch', days: 30 })), /Nie udało się połączyć z Mojang, żeby sprawdzić ten nick – żaden kod nie został wystawiony/);
  mojang.down = false;

  // Without an injected fetch the real one is used – which the test setup cuts off, like a host without internet.
  hammerplus.setFetch(null);
  assert.match(out(await run(seller, 'grant', { nick: 'Notch', days: 30 })), /Nie udało się połączyć z Mojang/);
  hammerplus.setFetch(fakeMojang);

  // A profile without a usable UUID is not trusted.
  mojang.profiles.broken = { id: 'nope', name: 'Broken' };
  assert.match(out(await run(seller, 'grant', { nick: 'broken', days: 30 })), /Nie udało się połączyć z Mojang/);

  const calls = mojang.calls.length;
  for (const nick of ['bad nick!', 'ąę', 'a'.repeat(17), '../../etc']) {
    assert.match(out(await run(seller, 'grant', { nick, days: 30 })), /Nick Minecraft ma najwyżej 16 znaków/, nick);
  }
  assert.equal(mojang.calls.length, calls, 'a nick that cannot exist is not sent anywhere');
  assert.equal(hammerplus.codes(guild.id).length, count, 'no code was issued');
});

test('/hammerplus check: whose code it is and until when – or why it does not work', async () => {
  reset();
  const issued = await run(seller, 'grant', { nick: 'Notch', days: 14 });
  const code = codeIn(issued);
  const id = plus.verify(code).id;

  const ok = out(await run(seller, 'check', { code }));
  assert.match(ok, /✅ Kod Hammer\+ jest ważny/);
  assert.match(ok, new RegExp(`Konto Minecraft \`Notch\` · \`${NOTCH}\``));
  assert.match(ok, /Ważny do <t:\d+:f>/);
  assert.match(ok, new RegExp(`ID kodu \`${id}\``));
  assert.match(ok, new RegExp(`Wystawiony <t:\\d+:f> przez <@${seller.id}>`));
  // Pasted the way Discord shows it: in a code block, with a line break.
  assert.match(out(await run(seller, 'check', { code: `\`\`\`\n${code}\n\`\`\`` })), /jest ważny/);

  // Expired: still says whose it was.
  const old = await hammerplus.grant(guild.id, { nick: 'Notch', days: 1, by: seller.id, now: Date.now() - 3 * DAY });
  const expired = out(await run(seller, 'check', { code: old.code }));
  assert.match(expired, /⌛ Kod Hammer\+ wygasł/);
  assert.match(expired, /Kod jest prawdziwy, ale wygasł <t:\d+:R>/);
  assert.match(expired, new RegExp(`\`Notch\` · \`${NOTCH}\``));

  // Changed, made up, or signed with another key.
  const [head, payload, signature] = code.split('.');
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), exp: 0 })).toString('base64url');
  assert.match(out(await run(seller, 'check', { code: `${head}.${edited}.${signature}` })), /podpis się nie zgadza/);
  assert.match(out(await run(seller, 'check', { code: 'to-nie-jest-kod' })), /To nie jest kod Hammer\+/);
  env.plusPrivateKey = newKey();
  assert.match(out(await run(seller, 'check', { code })), /podpis się nie zgadza/, 'a new key no longer accepts old codes');
  env.plusPrivateKey = KEY;

  // A real code this server has no record of (issued elsewhere with the same key).
  const foreign = plus.issue({ mc: STEVE, days: 0 });
  const unknown = out(await run(seller, 'check', { code: foreign }));
  assert.match(unknown, /jest ważny/);
  assert.match(unknown, new RegExp(`Konto Minecraft \`${STEVE}\``));
  assert.match(unknown, /Ważny na zawsze/);
  assert.match(unknown, /nie ma go w historii tego serwera/);
});

test('/hammerplus list: the last codes with nick, expiry and issuer – never the codes', async () => {
  reset();
  const g = new FakeGuild();
  await buildServer({ guild: g, mode: 'add', invokerId: g.ownerId });
  const owner = g.members.cache.get(g.ownerId);
  assert.match(out(await run(owner, 'list', {}, g)), /Kody Hammer\+ \(0\)[\s\S]*Nie wystawiono jeszcze żadnego kodu – pierwszy wystawisz przez `\/hammerplus nadaj`/);

  await hammerplus.grant(g.id, { nick: 'Notch', days: 1, by: owner.id, now: Date.now() - 5 * DAY });
  await hammerplus.grant(g.id, { nick: 'Notch', days: 30, by: owner.id, now: Date.now() - 2 * DAY });
  const newest = await run(owner, 'grant', { nick: '_Steve_', days: 0 }, g);
  const text = out(await run(owner, 'list', {}, g));
  assert.match(text, /Kody Hammer\+ \(3\)/);
  assert.match(text, new RegExp(`🟢 \`_Steve_\` · na zawsze · wystawiony przez <@${owner.id}> · <t:\\d+:R>\\n🟢 \`Notch\` · do <t:\\d+:f> \\(<t:\\d+:R>\\) · wystawiony przez <@${owner.id}>[^\\n]*\\n⌛ \`Notch\` · wygasł <t:\\d+:R>`), 'newest first, expired marked');
  assert.match(text, /Aktywne 2\nWygasłe 1/);
  assert.ok(!text.includes('HP1.') && !text.includes(codeIn(newest).split('.')[2]), 'no codes in the list');

  // Many codes: the last 15, within Discord's limits (the fake interaction checks them).
  for (let k = 0; k < 20; k += 1) await hammerplus.grant(g.id, { nick: 'Notch', days: 7, by: owner.id });
  const many = out(await run(owner, 'list', {}, g));
  assert.match(many, /Kody Hammer\+ \(23\)/);
  assert.equal((many.match(/wystawiony przez/g) ?? []).length, 15);
  assert.match(many, /…i 8 starszych\./);
});

test('/hammerplus key: the public key for the launcher – exactly the raw 32 bytes of the configured key', async () => {
  reset();
  const saved = { enabled: env.web.enabled, publicUrl: env.web.publicUrl };
  try {
    Object.assign(env.web, { enabled: false, publicUrl: '' });
    const text = out(await run(seller, 'key'));
    assert.match(text, /🔑 Klucz Hammer\+ jest ustawiony/);
    const shown = /```\n([A-Za-z0-9+/=]+)\n```/.exec(text)?.[1];
    assert.equal(shown, plus.publicKey());
    assert.equal(Buffer.from(shown, 'base64').length, 32);
    const expected = crypto.createPublicKey(crypto.createPrivateKey({ key: Buffer.from(KEY, 'base64'), format: 'der', type: 'pkcs8' })).export({ format: 'der', type: 'spki' }).subarray(-32);
    assert.deepEqual(Buffer.from(shown, 'base64'), expected);
    assert.ok(!text.includes(KEY), 'the private key is never shown');
    assert.match(text, /Strona bota nie ma jeszcze publicznego adresu[\s\S]*Same kody działają już teraz/);

    Object.assign(env.web, { enabled: true, publicUrl: 'https://hammershop.pl' });
    assert.match(out(await run(seller, 'key')), /Adres API dla launchera: `https:\/\/hammershop\.pl\/api\/launcher\/`/);
  } finally {
    Object.assign(env.web, saved);
  }
});

test('the Polish command reaches the code: /hammerplus nadaj nick: dni: · sprawdz kod: · lista · klucz', () => {
  reset();
  const resolver = (data) => new CommandInteractionOptionResolver({}, data, {});
  const used = { commandName: 'hammerplus', client: {}, options: resolver([{ name: 'nadaj', type: T.Subcommand, options: [{ name: 'nick', type: T.String, value: 'Notch' }, { name: 'dni', type: T.Integer, value: 30 }] }]) };
  unlocalize(used);
  assert.deepEqual([used.commandName, used.options.getSubcommand(), used.options.getString('nick'), used.options.getInteger('days')], ['hammerplus', 'grant', 'Notch', 30]);
  const check = { commandName: 'hammerplus', client: {}, options: resolver([{ name: 'sprawdz', type: T.Subcommand, options: [{ name: 'kod', type: T.String, value: 'HP1.x.y' }] }]) };
  unlocalize(check);
  assert.deepEqual([check.options.getSubcommand(), check.options.getString('code')], ['check', 'HP1.x.y']);
  for (const [pl, en] of [['lista', 'list'], ['klucz', 'key']]) {
    const i = { commandName: 'hammerplus', client: {}, options: resolver([{ name: pl, type: T.Subcommand, options: [] }]) };
    unlocalize(i);
    assert.equal(i.options.getSubcommand(), en);
  }
});

test('/help lists the Hammer+ and featured-server commands for the people who can use them', async () => {
  reset();
  const help = async (who) => {
    const i = createInteraction({ guild, member: who, kind: 'command', commandName: 'help' });
    await handle(i, commands);
    return out(i);
  };
  assert.match(await help(seller), /Hammer\+ i launcher `\/hammerplus nadaj` · `\/hammerplus sprawdz` · `\/hammerplus lista` · `\/hammerplus klucz`[^\n]*\n`\/polecane dodaj` · `\/polecane usun` · `\/polecane lista`/);
  assert.doesNotMatch(await help(member(guild)), /hammerplus|polecane/);
});
