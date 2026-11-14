'use strict';

/**
 * The language side of scripts/preview.js (the English version of the launcher – see src/renderer/js/i18n.js):
 *
 *   --collect   (Polish run) writes <outDir>/i18n-texts.json: every distinct text the translation layer would
 *               see on any screen – text nodes and the attributes title, placeholder, aria-label, alt – with
 *               the screenshot it first showed up in. This is the list a translator works from.
 *   --lang=en   runs the same steps in English: the selectors of the steps are translated with the dictionary,
 *               and the run fails when Polish is left on a screen (see `leftover` below).
 *               Writes <outDir>/i18n-missing.json (texts the layer saw and left alone) for a look by hand.
 *   --compare=<dir>  with --lang=en: <dir> is the outDir of a --collect run; texts that are cut off or wrap
 *               in English but not in Polish are listed (<outDir>/i18n-layout.txt) – a hint where to shorten.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createTranslator } = require('../src/renderer/js/i18n');
const { vocabulary } = require('./i18n-literals');

const DICTIONARY = path.join(__dirname, '..', 'src', 'renderer', 'i18n', 'en.json');
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/**
 * Words the steps look for inside a longer text (Playwright's hasText finds a part of a text; the dictionary
 * only knows whole texts). Polish part → the same part of the English text.
 */
const PARTS = {
  Zwolnij: 'Free up', // „Zwolnij 993 MB”
  'Zapisz plik': 'Save .hammerpack', // „Zapisz plik .hammerpack”
};

/**
 * Polish that is on the screen on purpose in the English run: the preview's sample data that stands for text
 * which is not the launcher's (names the player or a server owner typed). Where such a name stands alone the
 * views mark it data-no-i18n; these are the names that also appear inside the launcher's own sentences
 * ("Instance “Survival z ekipą” is ready"), where the sentence is translated and the name must stay.
 */
const FOREIGN = [
  'Survival z ekipą', // instance name
  'Nasz survival', 'Miasto kreatywne', 'Hardcore – podejście trzecie', 'Stary swiat', 'Nowa nazwa świata', 'Testy nowej wersji', 'Zamek na wyspie', 'Hardcore z Kubą – nie umieramy', // world names
  'Survival ze znajomymi', 'Serwer testowy u Kuby', 'Nowy serwer', 'Zmieniona nazwa', 'Skyblock u Oli', 'Serwer Kowalskich', 'Wspólny świat z paczką Fabulously Optimized', 'Wspólny świat', // server names
  'Kowal Hammer', 'Rycerz w czerwieni', 'Alex z lasu', 'Zimowy', 'Stara skórka z 2013 (64×32)', 'Nocny łowca', // skin names
  'Na PvP', 'Na budowanie w nocy', 'Na budowanie', 'Zimowe wieczory na serwerze', // outfit names
  'Budowanie u Oli', 'Skyblock od Oli', 'Paczka od Oli (HD)', 'Mój mod testowy', 'Paczka świąteczna 2023', 'stary-mod-od-kolegi', 'moj-mod-testowy', // recipe and file names
  'HammerGracz', 'Kowal', 'Gracz', // account and Windows user names
  'nowy.example.pl', 'nowy.example.com', 'Testy 26', 'Hardcore z Kuba', '“Budowanie”', // a server address, world folders and an instance name of the sample data
  'options.txt.przed-importem', '.hammer/przywracanie', // file and folder names the launcher really uses (they are not translated)
  '-przed-przywroceniem', // the end of the name of a backup made before a world is restored in place (Kopia zapasowa światów)
];

// Short Polish words no English text has – they give away a Polish text whose longer words the dictionary has never seen.
const SHORT_WORDS = /(?<![\p{L}\d-])(i|w|z|np|od|dla|lub|albo|ze|się|jest|nie|na|po|za|przy|oraz|czy)(?![\p{L}\d-])/u;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Runs in the page before everything else: the language of this run, and a listener for what the layer sees. */
function init({ lang, dict, listen }) {
  window.__i18n = { lang, dict };
  if (!listen) return;
  const seen = new Map(); // text → { out, where, near, fresh }
  const describe = (el) => (el ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}` : '');
  window.__i18nLog = (text, out, el) => {
    if (window.__i18nPause) return;
    let entry = seen.get(text);
    if (!entry) seen.set(text, (entry = { where: `${describe(el?.parentElement)} > ${describe(el)}`, near: (el?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200), fresh: true }));
    entry.out = out;
  };
  /** Texts seen for the first time since the last call. */
  window.__i18nDrain = () => {
    const fresh = [];
    for (const [text, entry] of seen) {
      if (!entry.fresh) continue;
      entry.fresh = false;
      fresh.push({ text, out: entry.out ?? null, where: entry.where, near: entry.near === text ? undefined : entry.near });
    }
    return fresh;
  };
}

/** Runs in the page: every text on it the layer is responsible for (outside data-no-i18n). */
function pageTexts() {
  const out = new Set();
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.matches('[data-no-i18n]:not([data-no-i18n="attrs"])')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) {
      const text = n.parentElement.tagName === 'TEXTAREA' ? '' : n.nodeValue.trim(); // what stands in a textarea was typed by the player
      if (text) out.add(text);
    } else if (n.getAttribute('data-no-i18n') !== 'attrs') for (const a of ['title', 'placeholder', 'aria-label', 'alt']) if (n.getAttribute(a)?.trim()) out.add(n.getAttribute(a).trim());
  }
  return [...out];
}

/**
 * Runs in the page: texts that do not fit where they stand – cut off (hidden overflow, with or without "…") –
 * and how many lines the short labels (buttons, chips, headings, tabs) take. Keyed by where the element is, so
 * the Polish and the English run of the same screen can be compared.
 */
function pageLayout() {
  const out = {};
  const counts = new Map();
  const key = (el) => {
    const parts = [];
    for (let e = el, n = 0; e && e.id !== 'app' && n < 4; e = e.parentElement, n += 1) parts.unshift(`${e.tagName.toLowerCase()}${typeof e.className === 'string' && e.className ? `.${e.className.trim().split(/\s+/).filter((c) => !/^(on|active|out|off)$/.test(c)).join('.')}` : ''}`);
    const base = parts.join('>');
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return `${base}#${n}`;
  };
  const SHORT = 'button, .btn, .chip, h1, h2, h3, .nav-item, summary, th, label.check, .set-row .txt b';
  for (const el of document.querySelectorAll('#app *')) {
    if (el.closest('[data-no-i18n]:not([data-no-i18n="attrs"])') || !el.offsetWidth || el.closest('svg')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
    const short = el.matches(SHORT);
    if (!own && !short) continue;
    const k = key(el);
    const cs = getComputedStyle(el);
    const text = el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!text) continue;
    if (cs.overflowX !== 'visible' && el.scrollWidth > el.clientWidth + 1) out[k] = { cut: el.scrollWidth - el.clientWidth, text };
    else if (short) {
      const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      const lines = Math.round((el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / line);
      if (lines > 1 && own) out[k] = { lines, text };
    }
  }
  return out;
}

function createPreviewLanguage({ lang = 'pl', collect = false, compare = null, out }) {
  const dict = JSON.parse(fs.readFileSync(DICTIONARY, 'utf8'));
  const translator = createTranslator(dict);
  const english = lang === 'en';
  const listen = english || collect;
  const firstSeen = []; // { text, out, where, near, shot } in the order the texts showed up
  const flagged = new Map(); // text → why it counts as Polish left on the screen
  const layout = {}; // shot → pageLayout()

  // The words that only stand on the Polish side of the dictionary – a text with one of them is Polish.
  const { polish: polishWords, words } = vocabulary(dict);
  const foreign = new RegExp(FOREIGN.map(escapeRe).sort((a, b) => b.length - a.length).join('|'), 'g');

  /** Why a text on an English screen still counts as Polish – or null. */
  function leftover(text) {
    const own = text.replace(foreign, ' ').trim();
    if (!own || translator.isSame(text)) return null;
    if (POLISH.test(own)) return 'polskie znaki';
    if (translator.isKey(own)) return 'jest w słowniku, ale nie został przetłumaczony';
    const word = words(own).find((w) => polishWords.has(w)) ?? SHORT_WORDS.exec(own)?.[1];
    return word ? `polskie słowo „${word}”` : null;
  }

  /** A Polish text of a step as the English page shows it: every reading the dictionary knows. */
  function variants(text) {
    if (!english) return [text];
    if (text in PARTS) return [PARTS[text]];
    const all = translator.variants(text);
    return all.length ? all : [text];
  }
  /** The English text of a Polish text (the first reading) – for the checks of the steps. */
  const T = (text) => variants(text)[0];

  /** Translates the Polish texts inside the selectors of the steps (hasText, :has-text(), [title="…"]…). */
  function patch(page) {
    if (!english) return;
    const selector = (sel) =>
      typeof sel !== 'string'
        ? sel
        : sel
            .replace(/\[(title|aria-label|placeholder|alt)="([^"]*)"\]/g, (m, attr, value) => {
              const v = variants(value).map((x) => `[${attr}="${x}"]`);
              return v.length > 1 ? `:is(${v.join(',')})` : v[0];
            })
            .replace(/:has-text\("([^"]*)"\)/g, (m, value) => {
              const v = variants(value).map((x) => `:has-text("${x}")`);
              return v.length > 1 ? `:is(${v.join(',')})` : v[0];
            });
    const options = (o) => {
      if (!o || typeof o.hasText !== 'string') return o;
      const v = variants(o.hasText);
      return { ...o, hasText: v.length > 1 ? new RegExp(v.map(escapeRe).join('|'), 'i') : v[0] };
    };
    for (const proto of [Object.getPrototypeOf(page), Object.getPrototypeOf(page.locator('html'))]) {
      const locator = proto.locator;
      proto.locator = function (sel, o) {
        return locator.call(this, selector(sel), options(o));
      };
      if (proto.filter) {
        const filter = proto.filter;
        proto.filter = function (o) {
          return filter.call(this, options(o));
        };
      }
    }
  }

  const drain = async (page, shot) => {
    if (!listen) return;
    for (const entry of await page.evaluate(() => window.__i18nDrain?.() ?? [])) firstSeen.push({ ...entry, shot });
  };

  /** After every screenshot: what is new on the page, what is still Polish, what does not fit. */
  async function afterShot(page, name) {
    await drain(page, name);
    if (english) {
      for (const text of await page.evaluate(pageTexts)) {
        const why = leftover(text);
        if (why && !flagged.has(text)) flagged.set(text, { why, shot: name });
      }
    }
    if (listen) layout[name] = await page.evaluate(pageLayout);
  }

  /** The layer stops listening (a step shows the other language on purpose) or listens again. */
  const pause = (page, on) => page.evaluate((v) => (window.__i18nPause = v), on);

  /** At the end of the run: writes the lists and adds what must fail the run to `errors`. */
  async function finish(page, errors) {
    await drain(page, '(koniec)');
    if (collect && !english) {
      fs.writeFileSync(path.join(out, 'i18n-texts.json'), `${JSON.stringify(firstSeen.map(({ text, where, near, shot }) => ({ text, where, near, shot })), null, 1)}\n`);
      fs.writeFileSync(path.join(out, 'i18n-layout.json'), `${JSON.stringify(layout)}\n`);
      console.log(`Teksty interfejsu: ${firstSeen.length} → ${path.join(out, 'i18n-texts.json')}`);
    }
    if (!english) return;
    // Texts the layer saw between two screenshots (messages that went away again) count as well.
    const missing = firstSeen.filter((e) => e.out == null);
    for (const e of missing) {
      const why = leftover(e.text);
      if (why && !flagged.has(e.text)) flagged.set(e.text, { why, shot: e.shot });
    }
    fs.writeFileSync(path.join(out, 'i18n-missing.json'), `${JSON.stringify(missing.map(({ text, where, near, shot }) => ({ text, where, near, shot, polish: leftover(text) ?? undefined })), null, 1)}\n`);
    fs.writeFileSync(path.join(out, 'i18n-layout.json'), `${JSON.stringify(layout)}\n`);
    if (compare) {
      const base = JSON.parse(fs.readFileSync(path.join(compare, 'i18n-layout.json'), 'utf8'));
      const lines = [];
      for (const [shot, now] of Object.entries(layout)) {
        for (const [key, v] of Object.entries(now)) {
          const was = base[shot]?.[key];
          if (v.cut && !was?.cut) lines.push(`${shot}: ucięte o ${v.cut} px: „${v.text}” (${key})`);
          else if (v.lines && (was?.lines ?? 1) < v.lines) lines.push(`${shot}: ${v.lines} linie zamiast ${was?.lines ?? 1}: „${v.text}” (${key})`);
        }
      }
      fs.writeFileSync(path.join(out, 'i18n-layout.txt'), `${lines.join('\n')}\n`);
      console.log(`Układ: ${lines.length} miejsc, w których angielski tekst mieści się gorzej niż polski → ${path.join(out, 'i18n-layout.txt')}`);
    }
    console.log(`Angielski: ${firstSeen.length} tekstów, ${missing.length} bez tłumaczenia (nazwy, liczby, dane) → ${path.join(out, 'i18n-missing.json')}`);
    if (flagged.size) {
      errors.push(`Polski tekst na angielskim ekranie (${flagged.size}):`);
      for (const [text, { why, shot }] of flagged) errors.push(`  ${shot}: „${text.length > 140 ? `${text.slice(0, 140)}…` : text}” – ${why}`);
    }
  }

  return { lang, english, init, initArg: { lang, dict, listen }, patch, T, afterShot, pause, finish, leftover };
}

module.exports = { createPreviewLanguage, FOREIGN, PARTS };
