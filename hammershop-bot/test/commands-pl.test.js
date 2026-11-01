'use strict';

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ApplicationCommandOptionType: T, CommandInteractionOptionResolver } = require('discord.js');
const loadCommands = require('../src/commands');
const { localizeCommand, unlocalize, slash, MAP } = require('../src/lib/commandsPl');

const NAME = /^[-_\p{Ll}\p{N}]{1,32}$/u;
const commands = loadCommands();

test('every slash command is in Polish: names, descriptions and choices, within Discord limits', () => {
  const pl = [...commands.values()].map((c) => localizeCommand(c.data.toJSON()));
  const english = [];
  const check = (json, en, where) => {
    assert.match(json.name, NAME, `${where}: name "${json.name}"`);
    assert.ok(json.description.length >= 1 && json.description.length <= 100, `${where}: description length ${json.description.length}`);
    if (json.name === en.name && json.description === en.description) english.push(where);
    const names = (json.options ?? []).map((o) => o.name);
    assert.equal(new Set(names).size, names.length, `${where}: option names are unique`);
    for (const [i, o] of (json.options ?? []).entries()) check(o, en.options[i], `${where} ${en.options[i].name}`);
    for (const [i, c] of (json.choices ?? []).entries()) {
      assert.ok(c.name.length >= 1 && c.name.length <= 100, `${where}: choice ${c.value}`);
      assert.equal(c.value, en.choices[i].value, 'choice values never change');
    }
  };
  for (const [i, cmd] of [...commands.values()].entries()) check(pl[i], cmd.data.toJSON(), `/${cmd.data.name}`);
  assert.deepEqual(english, [], 'everything has a Polish name or description');
  assert.equal(new Set(pl.map((c) => c.name)).size, pl.length, 'command names are unique');
  assert.deepEqual(Object.keys(MAP).filter((k) => !commands.has(k)), [], 'no translations for commands that no longer exist');
});

test('a Polish slash command reaches the English command code: subcommand groups, options, autocomplete', () => {
  const resolver = (data) => new CommandInteractionOptionResolver({}, data, { users: new Map() });
  const used = {
    commandName: 'klient',
    client: {},
    options: resolver([{ name: 'notatka', type: T.SubcommandGroup, options: [{ name: 'dodaj', type: T.Subcommand, options: [{ name: 'klient', type: T.User, value: '42' }, { name: 'tresc', type: T.String, value: 'Płaci zawsze na czas' }] }] }]),
  };
  unlocalize(used);
  assert.equal(used.commandName, 'customer');
  assert.equal(used.options.getSubcommandGroup(), 'note');
  assert.equal(used.options.getSubcommand(), 'add');
  assert.equal(used.options.getString('text'), 'Płaci zawsze na czas');
  assert.equal(used.options.get('user').value, '42');

  const auto = { commandName: 'produkt', client: {}, options: resolver([{ name: 'edytuj', type: T.Subcommand, options: [{ name: 'produkt', type: T.String, value: 'Spa', focused: true }] }]) };
  unlocalize(auto);
  assert.deepEqual([auto.commandName, auto.options.getSubcommand(), auto.options.getFocused(true).name, auto.options.getFocused()], ['product', 'edit', 'product', 'Spa']);

  // Already English (tests, or a command without translation) → untouched.
  const plain = { commandName: 'product', options: { getString: () => 'x' } };
  assert.equal(unlocalize(plain), plain);
  assert.equal(plain.commandName, 'product');
});

test('slash() names commands the way people type them', () => {
  assert.equal(slash('product add'), '/produkt dodaj');
  assert.equal(slash('build only:update').startsWith('/zbuduj'), true);
  assert.equal(slash('shop auto'), '/sklep auto');
  assert.equal(slash('customer note add'), '/klient notatka dodaj');
  assert.equal(slash('unlock'), '/odblokuj');
});
