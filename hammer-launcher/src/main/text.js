'use strict';

/**
 * Text that comes from outside the launcher (the shop's news and messages, release notes) on its way to the
 * window: plain text only, cut to a length. Control characters and the characters that turn the direction of a
 * text around never get through.
 */

// (control characters, and the marks that change the direction of the text)
const CONTROL = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

/** One line of plain text, at most `max` characters – '' when the value is not text. */
function line(value, max) {
  return typeof value === 'string' ? value.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
}

/** A few paragraphs of plain text: line breaks stay (never more than one empty line in a row), the rest as in line(). */
function block(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_BUT_NEWLINE, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max)
    .trim();
}

/** An https address as the URL parser reads it – null for anything else (other schemes, a login in the address). */
function httpsUrl(value, max = 600) {
  if (typeof value !== 'string' || !value || value.length > max || /\s/.test(value.trim())) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && u.hostname && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

module.exports = { line, block, httpsUrl };
