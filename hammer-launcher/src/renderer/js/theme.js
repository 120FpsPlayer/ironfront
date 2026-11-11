'use strict';
/* Hammer Launcher – colour maths for the player's own launcher colour (Hammer+). Plain functions without the page:
   the window uses them as HS_THEME, the tests load the same file with require(). */

(() => {
  const PANEL = '#1a140f'; // the dark cards the accent colour is read on
  const HEX = /^#[0-9a-f]{6}$/i;
  const MIN_CONTRAST = 4.5; // WCAG AA for normal text

  const isHex = (value) => typeof value === 'string' && HEX.test(value);
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const hexOf = (parts) => `#${parts.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
  /** `t` of the way from one colour to another (0 = the first, 1 = the second). */
  const mix = (from, to, t) => hexOf(rgb(from).map((v, i) => v + (rgb(to)[i] - v) * t));

  /** Relative luminance of a colour, 0 (black) … 1 (white) – the WCAG formula. */
  function luminance(hex) {
    const [r, g, b] = rgb(hex).map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Contrast between two colours, 1 (the same) … 21 (black on white). */
  function contrast(a, b) {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  /** The shades the launcher needs around one accent colour. */
  const shades = (accent) => ({ accent, accent2: mix(accent, '#ffffff', 0.38), accent3: mix(accent, '#000000', 0.2), accentHi: mix(accent, '#ffffff', 0.66), ink: mix(accent, '#000000', 0.88) });

  /** Readable both ways: the colour as text and icons on the dark cards, and the dark label on a button in that colour. */
  const readable = (s) => contrast(s.accent, PANEL) >= MIN_CONTRAST && contrast(s.ink, s.accent3) >= MIN_CONTRAST;

  /**
   * The palette for a colour the player picked: { accent, accent2, accent3, accentHi, ink, glow ("r,g,b"), adjusted }.
   * A colour too dark to read is lightened step by step until it passes – `adjusted` says that it was.
   * null when `hex` is not "#rrggbb".
   */
  function palette(hex) {
    if (!isHex(hex)) return null;
    const picked = hex.toLowerCase();
    let found = shades(picked);
    for (let t = 0.04; !readable(found) && t <= 1.001; t += 0.04) found = shades(mix(picked, '#ffffff', Math.min(1, t)));
    return { ...found, glow: rgb(found.accent).join(','), adjusted: found.accent !== picked };
  }

  const api = { palette, contrast, luminance, isHex, mix, PANEL, MIN_CONTRAST };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.HS_THEME = api;
})();
