'use strict';

/**
 * Finds the texts written in the launcher's source – for the English version (src/renderer/i18n/en.json).
 *
 *   node scripts/i18n-literals.js            lists the Polish texts of the interface (src/renderer) and of the
 *                                            main process (src/main) that the dictionary does not cover yet
 *   node scripts/i18n-literals.js --all      lists every text found, covered or not
 *
 * It reads the string literals of the code ('…', "…" and `…${x}…`) – not the comments – and keeps those that
 * are clearly text for people: a literal with Polish letters (ą ć ę ł ń ó ś ź ż), or one that starts with a
 * capital letter and is made of words. A text with `${…}` parts counts as covered when a pattern of the
 * dictionary matches it with something in place of every part. The unit tests (test/i18n.test.js) use the same
 * functions for src/renderer/views.
 */

const fs = require('node:fs');
const path = require('node:path');

const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
// Literals that look like text but are not: key and event names, folder names, names of fields in files, and
// texts that read the same in both languages.
const NOT_TEXT = new Set(['Files', 'Escape', 'Enter', 'Contents', 'Home', 'Message', 'Throwable', 'Intel', 'Roaming', 'Library', 'Application Support', 'Data', 'Version', 'Name', 'Unknown token format']);
const NOT_TEXT_TEMPLATE = /^(Minecraft |Java |Bearer |Modrinth: HTTP |Forge: HTTP |Mod: |Online: |Hammer Launcher v)/;
const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };

/**
 * The string literals of a piece of JavaScript: [{ quasis: [text, …], line }] – a plain string has one quasi,
 * a template `a${x}b` has two (the text around each ${…}). Strings inside ${…} are found as literals of their own.
 */
function literals(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  let last = ''; // the last character of code that is not a space – tells a regular expression from a division
  let lastWord = '';
  const lineOf = (at) => source.slice(0, at).split('\n').length;

  function escape() {
    // i stands on the character after the backslash
    const c = source[i];
    if (c === 'u') {
      if (source[i + 1] === '{') {
        const end = source.indexOf('}', i);
        const ch = String.fromCodePoint(parseInt(source.slice(i + 2, end), 16));
        i = end + 1;
        return ch;
      }
      const ch = String.fromCharCode(parseInt(source.slice(i + 1, i + 5), 16));
      i += 5;
      return ch;
    }
    if (c === 'x') {
      const ch = String.fromCharCode(parseInt(source.slice(i + 1, i + 3), 16));
      i += 3;
      return ch;
    }
    i += 1;
    if (c === '\n') return '';
    return ESCAPES[c] ?? c;
  }

  function string(quote) {
    const line = lineOf(i);
    i += 1;
    let text = '';
    while (i < n && source[i] !== quote) {
      if (source[i] === '\\') {
        i += 1;
        text += escape();
      } else text += source[i++];
    }
    i += 1;
    out.push({ quasis: [text], line });
  }

  function template() {
    const entry = { quasis: [''], line: lineOf(i) };
    out.push(entry);
    i += 1;
    while (i < n && source[i] !== '`') {
      if (source[i] === '\\') {
        i += 1;
        entry.quasis[entry.quasis.length - 1] += escape();
      } else if (source[i] === '$' && source[i + 1] === '{') {
        i += 2;
        code(true);
        entry.quasis.push('');
      } else entry.quasis[entry.quasis.length - 1] += source[i++];
    }
    i += 1;
  }

  function regex() {
    i += 1;
    let inClass = false;
    while (i < n) {
      const c = source[i];
      if (c === '\\') i += 2;
      else if (c === '[') (inClass = true), (i += 1);
      else if (c === ']') (inClass = false), (i += 1);
      else if (c === '/' && !inClass) break;
      else if (c === '\n') break;
      else i += 1;
    }
    i += 1;
    while (i < n && /[a-z]/.test(source[i])) i += 1;
  }

  const regexMayStart = () => last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last) || /^(return|typeof|case|in|of|void|delete|throw|new|else|do)$/.test(lastWord);

  function code(untilBrace) {
    let depth = 0;
    while (i < n) {
      const c = source[i];
      if (c === '/' && source[i + 1] === '/') {
        while (i < n && source[i] !== '\n') i += 1;
      } else if (c === '/' && source[i + 1] === '*') {
        i = source.indexOf('*/', i + 2);
        i = i < 0 ? n : i + 2;
      } else if (c === "'" || c === '"') {
        string(c);
        last = 'x';
        lastWord = '';
      } else if (c === '`') {
        template();
        last = 'x';
        lastWord = '';
      } else if (c === '/' && regexMayStart()) {
        regex();
        last = 'x';
        lastWord = '';
      } else {
        if (c === '{') depth += 1;
        else if (c === '}') {
          if (untilBrace && depth === 0) {
            i += 1;
            return;
          }
          depth -= 1;
        }
        if (/[\w$]/.test(c)) {
          const start = i;
          while (i < n && /[\w$]/.test(source[i])) i += 1;
          lastWord = source.slice(start, i);
          last = 'x';
          if (/^(return|typeof|case|in|of|void|delete|throw|new|else|do)$/.test(lastWord)) last = '';
          continue;
        }
        if (!/\s/.test(c)) {
          last = c;
          lastWord = '';
        }
        i += 1;
      }
    }
  }

  code(false);
  return out;
}

/** A literal is clearly text for people (see the top of this file). */
function isUiText(quasis) {
  const text = quasis.join(' ').trim();
  if (text.length < 2 || !/\p{L}{2}/u.test(text)) return false;
  if (quasis.length === 1 ? NOT_TEXT.has(text) : NOT_TEXT_TEMPLATE.test(quasis[0])) return false;
  if (POLISH.test(text)) return !/^[\w.#[\]=>~:*"'()\s,-]*$/.test(text); // (never true for a text with Polish letters – they are not \w)
  // A template: it starts with a word and goes on ("Usuń ${x}", "Aktywny ${x}", "Z ${x} do ${y}").
  if (quasis.length > 1) return /^\p{Lu}\p{Ll}{2,}[ :]/u.test(quasis[0]) || /^\p{Lu}\p{Ll}* \p{L}/u.test(text);
  // One or more words, the first with a capital letter: "Graj", "Dodaj konto", "Z Minecrafta". Not identifiers
  // (camelCase, snake_case, kebab-case), selectors, paths, addresses, MIME types or key names.
  return /^(?:\p{Lu}\p{Ll}+\.?|\p{Lu}(?= ))(?:[ –-]+[\p{L}\d+„”().,:!?…/&%-]+)*[.!?…:]?$/u.test(text) && !/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(text);
}

const FILLERS = ['7', 'Xyz', '7 Xyz', 'Xyz 7'];

/** Does the dictionary cover this literal? Plain text: an entry (or a counted noun, or a pattern). Template: a pattern. */
function covered(quasis, translator) {
  const plain = quasis.join('').trim();
  if (quasis.length === 1) return translator.t(plain) != null;
  // Parts that stand alone between two ${…} (" · ", ": ", " (") carry no words of their own.
  if (!quasis.some((q) => /\p{L}{2}/u.test(q))) return true;
  // Every ${…} stands for something – or, when it is an optional part of the sentence, for nothing.
  const holes = quasis.length - 1;
  for (const filler of FILLERS) {
    for (let mask = (1 << Math.min(holes, 5)) - 1; mask >= 0; mask -= 1) {
      const text = quasis.map((q, i) => q + (i < holes ? ((mask >> Math.min(i, 4)) & 1 ? filler : '') : '')).join('');
      if (translator.t(text.trim()) != null) return true;
    }
  }
  return false;
}

/**
 * The words (4 letters and more) of the dictionary: those that only stand on its Polish side – a text with one
 * of them is Polish – and those of its English side.
 */
function vocabulary(dict) {
  const words = (text) => String(text).toLowerCase().match(/\p{L}{4,}/gu) ?? [];
  const english = new Set([...Object.values(dict.strings ?? {}), ...(dict.same ?? []), ...(dict.patterns ?? []).map((p) => p.en), ...(dict.plurals ?? []).flatMap((p) => p.en), ...(dict.contexts ?? []).flatMap((c) => Object.values(c.strings ?? {})), ...Object.values(dict.dates ?? {})].flatMap(words));
  const sources = [...Object.keys(dict.strings ?? {}), ...(dict.plurals ?? []).flatMap((p) => p.pl), ...(dict.patterns ?? []).map((p) => p.re.replace(/\\[a-zA-Z]\{?[0-9a-fA-F]*\}?/g, ' ')), ...Object.keys(dict.dates ?? {})];
  const polish = new Set(sources.flatMap(words).filter((w) => !english.has(w)));
  return { polish, english, words };
}

function jsFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? jsFiles(path.join(dir, e.name)) : e.name.endsWith('.js') ? [path.join(dir, e.name)] : []))
    .sort();
}

/** The UI texts of the given files: [{ file, line, quasis }]. */
function uiTexts(files) {
  const out = [];
  for (const file of files) for (const lit of literals(fs.readFileSync(file, 'utf8'))) if (isUiText(lit.quasis)) out.push({ file, line: lit.line, quasis: lit.quasis });
  return out;
}

module.exports = { literals, isUiText, covered, uiTexts, jsFiles, vocabulary, POLISH };

if (require.main === module) {
  const { createTranslator } = require('../src/renderer/js/i18n');
  const root = path.join(__dirname, '..');
  const dict = JSON.parse(fs.readFileSync(path.join(root, 'src', 'renderer', 'i18n', 'en.json'), 'utf8'));
  const translator = createTranslator(dict);
  const { polish, words } = vocabulary(dict);
  // In the main process many literals are names (of mods, of fields) – there only texts that are clearly Polish count.
  const polishText = (text) => POLISH.test(text) || words(text).some((w) => polish.has(w));
  const all = process.argv.includes('--all');
  const json = process.argv.includes('--json');
  const files = [...jsFiles(path.join(root, 'src', 'renderer')), ...jsFiles(path.join(root, 'src', 'main')), path.join(root, 'src', 'preload.js')].filter((f) => !f.endsWith('icons.js'));
  const seen = new Set();
  const rows = [];
  for (const t of uiTexts(files)) {
    const text = t.quasis.join('${…}');
    const ok = covered(t.quasis, translator);
    if ((ok && !all) || seen.has(text)) continue;
    if (!ok && !all && !t.file.includes(`${path.sep}renderer${path.sep}`) && !polishText(text)) continue;
    seen.add(text);
    rows.push({ text, file: path.relative(root, t.file), line: t.line, covered: ok });
  }
  if (json) console.log(JSON.stringify(rows, null, 1));
  else {
    for (const r of rows) console.log(`${r.file}:${r.line}  ${r.covered ? '✓' : '✗'} ${r.text}`);
    console.log(`\n${rows.length} ${all ? 'tekstów' : 'tekstów bez tłumaczenia'}`);
  }
}
