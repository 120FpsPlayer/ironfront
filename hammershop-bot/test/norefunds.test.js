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
  assert.match(config.shop.refundPolicy, /Delivered digital products can't be returned/);

  const rules = texts(guild, 'rules');
  assert.match(rules, /§6 · Odstąpienie od umowy, reklamacje i zwroty/);
  assert.match(rules, /Prawo odstąpienia \*\*wygasa\*\*, gdy zaczniemy dostarczać treść cyfrową/);
  assert.match(rules, /Najpierw naprawimy lub wymienimy produkt, a gdy to niemożliwe – \*\*zwrócimy pieniądze\*\*/);
  assert.match(rules, /Saldo sklepu .* Nie wypłacamy go i nie zwracamy/);

  const faq = texts(guild, 'faq');
  assert.match(
    faq,
    /Can I get a refund\?\*\*\n> Delivered digital products can't be returned – by ordering you ask for instant delivery\. Store balance can't be refunded or paid out either\. A product that doesn't work or doesn't match its description\? Open a \*\*Support\*\* ticket in <#\d+> – we fix or replace it, and if we can't, you get your money back\. Full terms: <#\d+>\./,
  );

  const howTo = texts(guild, 'howToBuy');
  assert.ok(howTo.includes(`**Refunds:** ${config.shop.refundPolicy} A product that doesn't work? Open a support ticket – we fix or replace it, and if we can't, you get your money back.`));
  assert.ok(texts(guild, 'payments').includes(`**Refunds:** ${config.shop.refundPolicy} Check the product and the price before you pay.`));
  assert.match(texts(guild, 'staff'), /\*\*Refunds\*\* – delivered products can't be returned and store balance can't be refunded or paid out\. A product doesn't work\? Fix or replace it first – only if that's impossible, a manager sends the money back \(terms: <#\d+> §6\)/);
  assert.match(texts(guild, 'staff'), /`\/sale deal` – the automatic deal of the week/);
});

test('no customer-facing text promises a refund without conditions', () => {
  const dir = path.join(__dirname, '..', 'src');
  const offenders = [];
  const walk = (d) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/[^\n]*\b(we (will )?refund|you('ll| will) (get|be) refunded|money[- ]back guarantee|full refund)[^\n]*/gi)) offenders.push(`${path.relative(dir, p)}: ${m[0].trim()}`);
      }
    }
  };
  walk(dir);
  assert.deepEqual(offenders, []);
});
