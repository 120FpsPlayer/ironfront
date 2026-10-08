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

test('no refunds: the rules, the FAQ, How to buy, Payments and the staff handbook all say it clearly', async () => {
  const guild = new FakeGuild();
  await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  assert.ok(db.channelId(guild.id, 'tickets'));
  assert.match(config.shop.refundPolicy, /All sales are final/);

  const rules = texts(guild, 'rules');
  assert.match(rules, /\*\*No refunds\*\* – all sales of digital products are final/);
  assert.match(rules, /Store balance can't be refunded or paid out/);
  assert.match(rules, /A problem with a product\? Open a support ticket – we fix or replace it/);

  const faq = texts(guild, 'faq');
  assert.match(
    faq,
    /Can I get a refund\?\*\*\n> No – all sales of digital products are final, so we don't offer refunds\. Store balance can't be refunded or paid out either\. A problem with a product\? Open a \*\*Support\*\* ticket in <#\d+> – we fix or replace it\./,
  );

  const howTo = texts(guild, 'howToBuy');
  assert.ok(howTo.includes(`**No refunds:** ${config.shop.refundPolicy} A problem with a product? Open a support ticket – we fix or replace it.`));
  assert.ok(texts(guild, 'payments').includes(`**No refunds:** ${config.shop.refundPolicy} Check the product and the price before you pay.`));
  assert.match(texts(guild, 'staff'), /\*\*No refunds\*\* – all sales are final and store balance can't be refunded or paid out\. A product doesn't work\? Fix or replace it – never send money back/);
  assert.match(texts(guild, 'staff'), /`\/sale deal` – the automatic deal of the week/);
});

test('no customer-facing text promises a refund', () => {
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
