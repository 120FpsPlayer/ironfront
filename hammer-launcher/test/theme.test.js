'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { palette, contrast, luminance, isHex, PANEL } = require('../src/renderer/js/theme');

test('contrast is the WCAG ratio: 21 for black on white, 1 for a colour on itself', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 100) / 100, 21);
  assert.equal(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'));
  assert.equal(contrast('#ff9f43', '#ff9f43'), 1);
  assert.deepEqual([luminance('#000000'), Math.round(luminance('#ffffff') * 1000) / 1000], [0, 1]);
  assert.deepEqual([isHex('#12ab9f'), isHex('#12AB9F'), isHex('12ab9f'), isHex('#fff'), isHex('red'), isHex(null)], [true, true, false, false, false, false]);
});

test('own accent colour: any colour ends up readable – as text on the dark cards and under the button label', () => {
  // The whole colour cube in coarse steps plus the awkward ones.
  const colours = ['#000000', '#ffffff', '#0000ff', '#00007f', '#7f0000', '#003300', '#ff0000', '#00ff00', '#ffff00', '#ff00ff', '#1a140f', '#808080', '#2b2b2b'];
  for (let r = 0; r <= 255; r += 51) for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) colours.push(`#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`);
  for (const hex of colours) {
    const p = palette(hex);
    assert.ok(contrast(p.accent, PANEL) >= 4.5, `${hex}: the colour on a card (${contrast(p.accent, PANEL).toFixed(2)})`);
    assert.ok(contrast(p.accent2, PANEL) >= 4.5, `${hex}: the lighter shade on a card`);
    assert.ok(contrast(p.ink, p.accent3) >= 4.5, `${hex}: the label on the darkest part of a button (${contrast(p.ink, p.accent3).toFixed(2)})`);
    assert.ok(contrast(p.ink, p.accent) >= 4.5 && contrast(p.ink, p.accent2) >= 4.5, `${hex}: the label on the rest of the button`);
    for (const key of ['accent', 'accent2', 'accent3', 'accentHi', 'ink']) assert.ok(isHex(p[key]), `${hex}: ${key}`);
    assert.match(p.glow, /^\d{1,3},\d{1,3},\d{1,3}$/);
    assert.equal(p.adjusted, p.accent !== hex);
  }
});

test('own accent colour: a light colour stays exactly as picked, a dark one is lightened and says so', () => {
  const mint = palette('#3DE0B4');
  assert.deepEqual([mint.accent, mint.adjusted, mint.glow], ['#3de0b4', false, '61,224,180']);
  assert.equal(palette('#ff9f43').adjusted, false, 'the launcher\'s own orange');
  const navy = palette('#00007f');
  assert.equal(navy.adjusted, true);
  assert.ok(luminance(navy.accent) > luminance('#00007f'));
  const [r, g, b] = navy.glow.split(',').map(Number);
  assert.ok(b > r && b > g, 'still blue');
  assert.equal(palette('#000000').adjusted, true);
  for (const bad of ['', 'red', '#12', 'url(x)', null, undefined, 7]) assert.equal(palette(bad), null);
});
