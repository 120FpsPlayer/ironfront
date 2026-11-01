'use strict';

require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../src/features/chatfilter');

test('swearing and slurs are caught – also spaced, leetspeak, accents, small caps, Cyrillic and markdown', () => {
  for (const t of ['kurwa', 'k u r w a', 'KURWĄ', 'sh1t', 'ｆｕｃｋ', 'ᴋᴜʀᴡᴀ', 'spierdalaj', 'n1gg3r', 'fuuuuck', '||kurwa||', '**f**uck', 'блять', 'hurensohn', 'putain', 'f.u.c.k']) {
    assert.ok(f.findBadWord(t), t);
  }
  assert.equal(f.findBadWord('nigger').kind, 'slur');
  assert.equal(f.findBadWord('kurwa').kind, 'profanity');
});

test('normal words pass', () => {
  for (const t of ['assassin', 'Scunthorpe', 'cocktail', 'class pass', 'Nigeria', 'snigger', 'ile kosztuje netflix?', 'pedał od roweru', 'ciotka', 'kurier', 'as soon as', 'I am a fan', 'skurczybyk', 'blat stołu', 'pula nagród', 'Fukushima']) {
    assert.equal(f.findBadWord(t), null, t);
  }
});

test('links are found, GIFs and normal dots are not links', () => {
  for (const t of ['https://x.com', 'check example.com', 'discord.gg/abc', 'www.test', 'example . com', 'example(dot)com', 'hxxps://bad', 'bit.ly/x']) assert.ok(f.findLink(t), t);
  for (const t of ['https://tenor.com/view/x-gif-1', '4.99', 'e.g. this', 'v1.2.3', 'image.png', 'ok.thanks', 'np. itd.', '5 p.m.', 'o 20.30', 'sure. it works']) assert.equal(f.findLink(t), null, t);
  assert.ok(f.findLink('https://tenor.com/x', { allowGifs: false }));
  assert.equal(f.findLink('see mysite.com', { allowedDomains: ['mysite.com'] }), null);
});
