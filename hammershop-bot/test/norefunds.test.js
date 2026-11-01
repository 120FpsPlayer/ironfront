'use strict';

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FakeGuild, validateMessage } = require('./helpers/fakeDiscord');
const { textOf } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const content = require('../src/builder/content');
const config = require('../src/lib/config');

const texts = (guild, key) =>
  content
    .postsFor(key, guild)
    .filter((p) => p.payload)
    .map((p) => {
      validateMessage(p.payload, guild); // the post limits still hold
      return textOf(p.payload);
    })
    .join('\n');

test('refunds: the regulamin, the FAQ, How to buy, Payments and the staff handbook all tell the same policy', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  assert.ok(db.channelId(guild.id, 'tickets'));
  assert.match(config.shop.refundPolicy, /Dostarczonych produktów cyfrowych nie można zwrócić/);

  const rules = texts(guild, 'rules');
  assert.match(rules, /§6 · Odstąpienie od umowy, reklamacje i zwroty/);
  assert.match(rules, /Prawo odstąpienia \*\*wygasa\*\*, gdy zaczniemy dostarczać treść cyfrową/);
  assert.match(rules, /Najpierw naprawimy lub wymienimy produkt, a gdy to niemożliwe – \*\*zwrócimy pieniądze\*\*/);
  assert.match(rules, /Saldo sklepu .* Nie wypłacamy go i nie zwracamy/);

  const faq = texts(guild, 'faq');
  assert.match(
    faq,
    /Czy mogę dostać zwrot pieniędzy\?\*\*\n> Dostarczonych produktów cyfrowych nie można zwrócić – składając zamówienie, prosisz o natychmiastową dostawę\. Salda sklepu również nie zwracamy ani nie wypłacamy\. Produkt nie działa albo nie zgadza się z opisem\? Otwórz ticket \*\*Pomoc\*\* na <#\d+> – naprawimy go lub wymienimy, a jeśli się nie da, oddamy Ci pieniądze\. Pełne zasady: <#\d+>\./,
  );

  const howTo = texts(guild, 'howToBuy');
  assert.ok(howTo.includes(`**Zwroty:** ${config.shop.refundPolicy} Produkt nie działa? Otwórz ticket **Pomoc** – naprawimy go lub wymienimy, a jeśli się nie da, oddamy Ci pieniądze.`));
  assert.ok(texts(guild, 'payments').includes(`**Zwroty:** ${config.shop.refundPolicy} Przed płatnością sprawdź produkt i cenę.`));
  assert.match(texts(guild, 'staff'), /\*\*Zwroty\*\* – dostarczonych produktów nie można zwrócić, a salda sklepu nie zwracamy ani nie wypłacamy\. Produkt nie działa\? Najpierw go napraw lub wymień – dopiero gdy to niemożliwe, manager oddaje pieniądze \(zasady: <#\d+> §6\)/);
  assert.match(texts(guild, 'staff'), /`\/promocja okazja` – automatyczna okazja tygodnia/);
});

// An unconditional refund promise. English: any of these phrases. Polish: giving the money back (or a refund
// guarantee) is only allowed on a line that also says when – after fixing or replacing the product failed
// ("a gdy to niemożliwe", "a jeśli się nie da", "jeśli nie możemy").
const EN_PROMISE = /\b(we (will )?refund|you('ll| will) (get|be) refunded|money[- ]back guarantee|full refund)/i;
const PL_PROMISE =
  /(?<!\p{L})(?<!(?<!\p{L})nie )((zwróc|zwraca|odda|odzysk)\p{L}*( z powrotem)?( (Ci|Tobie|swoje|całe|wszystkie))* pieni(ądze|ędzy)|(dostaniesz|otrzymasz|odzyskasz)( z powrotem)?( (swoje|całe|wszystkie))* pieni(ądze|ędzy)|(dostaniesz|otrzymasz) (pełny |pełen |całkowity )?zwrot|pieniądze (wrócą|zostaną zwrócone)|gwarancj\p{L}* zwrotu|pełn\p{L}* zwrot|zwrot\p{L}* (pieniędzy )?gwarantowan|100 ?% zwrotu)/iu;
const PL_CONDITION = /(?<!\p{L})(gdy|jeśli|jeżeli)( to)?( jest)? (niemożliwe|się nie da|nie (możemy|da się|uda się))(?!\p{L})/iu;
const unconditional = (line) => EN_PROMISE.test(line) || (PL_PROMISE.test(line) && !PL_CONDITION.test(line));

test('the refund check catches unconditional promises in English and Polish, and lets the conditional one through', () => {
  for (const line of [
    'We will refund you.',
    "You'll get refunded within 24h.",
    'Money-back guarantee!',
    'Nie działa? Zwrócimy Ci pieniądze.',
    'Nie podoba się? Oddamy pieniądze bez pytań.',
    'Zawsze zwracamy pieniądze.',
    'Dostaniesz pełny zwrot.',
    'Otrzymasz z powrotem swoje pieniądze.',
    'Gwarancja zwrotu pieniędzy!',
    'Pełny zwrot w 14 dni.',
    'Zwrócimy pieniądze, gdy produkt nie działa.',
  ]) {
    assert.ok(unconditional(line), line);
  }
  for (const line of [
    'Produkt nie działa? Otwórz ticket **Pomoc** – naprawimy go lub wymienimy, a jeśli się nie da, oddamy Ci pieniądze.',
    'Najpierw naprawimy lub wymienimy produkt, a gdy to niemożliwe – **zwrócimy pieniądze** lub obniżymy cenę.',
    'Najpierw go napraw lub wymień – dopiero gdy to niemożliwe, manager oddaje pieniądze.',
    'Naprawimy lub wymienimy produkt, a jeśli nie możemy – zwrócimy pieniądze.',
    'Dostarczonych produktów cyfrowych nie można zwrócić. Salda sklepu nie wypłacamy ani nie zwracamy.',
    'Czy mogę dostać zwrot pieniędzy?',
    'Nie zwracamy pieniędzy za dostarczone produkty.',
  ]) {
    assert.ok(!unconditional(line), line);
  }
});

test('no customer-facing text promises a refund without conditions', () => {
  const root = path.join(__dirname, '..');
  const dir = path.join(root, 'src');
  const offenders = [];
  const check = (p) => {
    fs.readFileSync(p, 'utf8')
      .split('\n')
      .forEach((line) => {
        if (unconditional(line)) offenders.push(`${path.relative(root, p)}: ${line.trim()}`);
      });
  };
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith('.js')) check(p);
    }
  };
  walk(dir);
  // The texts in config.json (canned replies, shop texts) and the regulamin reach customers too.
  for (const file of ['config.json', 'regulamin.md']) check(path.join(root, file));
  assert.deepEqual(offenders, []);
});
