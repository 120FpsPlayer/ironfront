'use strict';
/* Hammer Launcher – the English version. The interface is written in Polish; this file translates what is on the
   page when the language is English, and does nothing at all in Polish.

   Part 1 – plain functions (the window uses them as HS_I18N, the main process and the tests load the same file
   with require()): the dictionary in i18n/en.json – exact sentences, sentences with variable parts (patterns),
   counted nouns ("5 modów" → "5 mods") and month names.
   Part 2 – only in the window: the layer that keeps the page translated (text, title, placeholder, aria-label,
   alt, button values, option labels) – also everything that is added or changed later.

   Only exact dictionary hits and pattern hits are translated, so a name the player typed stays as it is.
   Containers with text that is not ours (console log, mod descriptions, names) carry data-no-i18n and are skipped. */

(() => {
  /* ── part 1: the dictionary ── */
  const NUMBER = '\\d[\\d\\u00a0\\u202f .,]*';
  const COUNTED = new RegExp(`^(${NUMBER}) (.+)$`, 'su');
  const LETTER = /\p{L}/u;
  // (a full stop after an abbreviation – "np.", "maks." – does not end a sentence)
  const SENTENCE_END = /(?<=[.!?…])(?<!\b(?:[Nn]p|[Mm]aks|[Mm]in|tzw|tj|itd|itp)\.) +(?=[\p{Lu}\d„“])/u;
  const TRANSFORMS = ['t', 'tl', 'date', 'num', 'list'];
  const MAX_PATTERN_TEXT = 700; // longer texts are never ours with variable parts
  const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

  /** "12 345,6" (Polish) → "12,345.6". A number that already reads as English ("1,234.5") stays. */
  function englishNumber(text) {
    const s = String(text).trim();
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) || /^\d+(\.\d+)?$/.test(s)) return s;
    return s.replace(/[\u00a0\u202f ](?=\d{3})/g, ',').replace(/,(?=\d+$)/, '.');
  }

  /**
   * A translator for one dictionary: { same: [...], strings: { pl: en }, contexts: [{ in, strings }],
   * plurals: [{ pl: [one, few, many], en: [one, other] }], dates: { word: word }, patterns: [{ re, en, as }] }.
   * t(text, variant) answers the English text, or null when the text is not in the dictionary.
   */
  function createTranslator(dict = {}) {
    const strings = new Map();
    const nouns = new Map(); // every Polish form of a counted noun → [one, other]
    for (const p of dict.plurals ?? []) {
      p.pl.forEach((form, i) => {
        if (!nouns.has(form)) nouns.set(form, p.en);
        if (!strings.has(form)) strings.set(form, i === 0 ? p.en[0] : p.en[1]);
      });
    }
    for (const s of dict.same ?? []) strings.set(s, s);
    for (const [pl, en] of Object.entries(dict.strings ?? {})) strings.set(pl, en);
    const contexts = (dict.contexts ?? []).map((c) => ({ in: c.in, strings: new Map(Object.entries(c.strings ?? {})) }));
    const contextual = new Set(contexts.flatMap((c) => [...c.strings.keys()]));
    const dates = new Map(Object.entries(dict.dates ?? {}));
    const patterns = (dict.patterns ?? []).map((p) => ({ re: new RegExp(p.re, 'su'), en: p.en, as: p.as ?? null }));
    let cache = new Map();

    const dateWords = (text) => String(text).replace(/\p{L}+/gu, (w) => dates.get(w.toLowerCase()) ?? w);
    /** Translates a part of a sentence; the spaces around it stay where they are. */
    const inner = (value, depth) => {
      const text = value.trim();
      const out = text ? translate(text, depth + 1) : null;
      return out == null ? value : value.replace(text, () => out);
    };
    const transform = (value, how, depth) => {
      if (value == null) return '';
      if (how === 't') return inner(value, depth);
      if (how === 'tl') return lowerFirst(inner(value, depth));
      if (how === 'date') return dateWords(value);
      if (how === 'num') return englishNumber(value);
      if (how === 'list') return value.split(', ').map((part) => inner(part, depth)).join(', ');
      return value;
    };

    /** "5 modów" → "5 mods", "1 plik" → "1 file" – for the nouns listed under "plurals". */
    function counted(text) {
      const m = COUNTED.exec(text);
      const en = m && nouns.get(m[2]);
      if (!en) return null;
      const n = Number(m[1].replace(/\D/g, ''));
      return `${m[1].trim().replace(/[\u00a0\u202f](?=\d{3})/g, ',')} ${n === 1 ? en[0] : en[1]}`;
    }

    function fromPattern(text, depth) {
      if (text.length > MAX_PATTERN_TEXT) return null;
      for (const p of patterns) {
        const m = p.re.exec(text);
        if (!m) continue;
        // (a name quoted the Polish way inside a variable part gets English quotation marks: „x” → “x”)
        const out = p.en.replace(/\$(\d)/g, (_, d) => transform(m[Number(d)], p.as?.[d], depth)).replace(/„/g, '“');
        if (out !== text) return out; // a pattern that changes nothing says nothing – the next one may
      }
      return null;
    }

    /**
     * Two or more sentences in one text ("Zapisano. Wyślij plik znajomemu.") are translated one by one.
     * `whole`: only when every sentence is known – tried before the patterns, so a pattern for the last
     * sentence does not take the ones before it for its variable part.
     */
    function sentences(text, depth, whole) {
      const parts = text.split(SENTENCE_END);
      if (parts.length < 2) return null;
      const out = parts.map((part) => translate(part, depth + 1));
      if (whole ? out.some((v) => v == null) : out.every((v) => v == null)) return null;
      return parts.map((part, i) => out[i] ?? part).join(' ');
    }

    /** "Minecraft 1.21 · 3 mody · wczoraj": parts joined with " · " are translated one by one. */
    function joined(text, depth) {
      if (!text.includes(' · ') && !text.startsWith('· ')) return null;
      const lead = text.startsWith('· ') ? '· ' : '';
      const parts = text.slice(lead.length).split(' · ');
      const out = parts.map((part) => translate(part.trim(), depth + 1));
      return out.some((v) => v != null) ? lead + parts.map((part, i) => out[i] ?? part).join(' · ') : null;
    }

    /**
     * "Sodium – Nowy silnik renderowania": a name, a dash and the launcher's words about it. Translated when
     * the last part is the launcher's text; a part that is a name stays.
     */
    function dashed(text, depth) {
      if (!text.includes(' – ')) return null;
      const parts = text.split(' – ');
      // The launcher's words may have a dash of their own: the longest known ending counts.
      for (let k = 1; k < parts.length; k += 1) {
        const tail = translate(parts.slice(k).join(' – ').trim(), depth + 1);
        if (tail != null) return [...parts.slice(0, k).map((part) => translate(part.trim(), depth + 1) ?? part), tail].join(' – ');
      }
      return null;
    }

    function translate(text, depth = 0) {
      const hit = strings.get(text);
      if (hit != null) return hit;
      if (depth > 4 || !LETTER.test(text)) return null;
      if (cache.has(text)) return cache.get(text);
      let out = counted(text) ?? sentences(text, depth, true) ?? fromPattern(text, depth) ?? joined(text, depth) ?? dashed(text, depth) ?? sentences(text, depth, false);
      if (out === text) out = null; // put together from parts that all read the same – nothing was translated
      if (cache.size > 4000) cache = new Map();
      cache.set(text, out);
      return out;
    }

    return {
      /** English for a Polish text, or null. `variant` picks a context ("in" of dict.contexts) when the text has one. */
      t(text, variant) {
        if (typeof text !== 'string' || !text) return null;
        if (variant && contextual.has(text)) {
          const c = contexts.find((x) => x.in === variant);
          if (c?.strings.has(text)) return c.strings.get(text);
        }
        return translate(text);
      },
      /** The contexts (CSS selectors) in which this text reads differently – empty for nearly every text. */
      contextsOf: (text) => (contextual.has(text) ? contexts.filter((c) => c.strings.has(text)).map((c) => c.in) : []),
      /** Every English reading of a text: the usual one and the ones of its contexts (the preview's selectors use it). */
      variants(text) {
        const all = [translate(text), ...contexts.map((c) => c.strings.get(text))].filter((v) => v != null);
        return [...new Set(all)];
      },
      /** The text is an exact entry of the dictionary that changes in English. */
      isKey: (text) => strings.has(text) && strings.get(text) !== text,
      /** The text is listed as reading the same in both languages. */
      isSame: (text) => strings.get(text) === text,
      size: { strings: strings.size, patterns: patterns.length, plurals: (dict.plurals ?? []).length },
    };
  }

  const core = { createTranslator, englishNumber, TRANSFORMS };
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (typeof window === 'undefined' || !window.document) return;

  /* ── part 2: the layer over the page ── */
  const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
  const WATCHED = [...ATTRS, 'value', 'label'];
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']); // nothing in them is text of the interface
  const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']); // a textarea's text is what the player typed – its placeholder is ours
  const OFF = '[data-no-i18n]:not([data-no-i18n="attrs"])'; // data-no-i18n="attrs" only guards the element's own attributes
  const log = window.__i18nLog ?? null; // the preview listens here: every text the layer sees, and what became of it

  let lang = 'pl';
  let translator = null;
  let observer = null;
  let memo = new WeakMap(); // text node → { src, out }; element → { attribute: { src, out } }
  const nodes = new Set(); // added or changed since the last pass
  const attrs = new Set(); // elements whose watched attribute changed
  let frame = 0;
  let timer = 0;

  /** The attributes of an element the layer may translate. */
  function attributesOf(el) {
    const list = ATTRS.filter((a) => el.hasAttribute(a));
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.getAttribute('type') ?? '') && el.hasAttribute('value')) list.push('value');
    if ((el.tagName === 'OPTION' || el.tagName === 'OPTGROUP') && el.hasAttribute('label')) list.push('label');
    return list;
  }

  /** English for one text as it stands in the page (spaces around it are kept), or null. */
  function english(raw, el) {
    const text = raw.trim();
    if (!text) return null;
    let out = null;
    if (translator) {
      const scopes = translator.contextsOf(text);
      const scope = scopes.length && el ? scopes.find((sel) => el.closest(sel)) : null;
      out = translator.t(text, scope);
    }
    if (log) log(text, out, el);
    if (out == null || out === text) return null;
    const at = raw.indexOf(text);
    return raw.slice(0, at) + out + raw.slice(at + text.length);
  }

  function textNode(node) {
    const el = node.parentElement;
    if (!el || SKIP_TEXT.has(el.tagName)) return;
    const raw = node.nodeValue;
    const was = memo.get(node);
    if (was && raw === was.out) return; // our own text, still in place
    const out = english(raw, el);
    if (out == null) return void memo.delete(node);
    memo.set(node, { src: raw, out });
    node.nodeValue = out;
  }

  function attributes(el) {
    const list = el.getAttribute('data-no-i18n') === 'attrs' ? [] : attributesOf(el);
    if (!list.length) return;
    let was = memo.get(el);
    for (const name of list) {
      const raw = el.getAttribute(name);
      if (was?.[name] && raw === was[name].out) continue;
      const out = english(raw, el);
      if (out == null) {
        if (was) delete was[name];
        continue;
      }
      if (!was) memo.set(el, (was = {}));
      was[name] = { src: raw, out };
      el.setAttribute(name, out);
    }
  }

  const skipped = (el) => !el || Boolean(el.closest(OFF));

  /** Translates an element with everything in it (or one text node); parts marked data-no-i18n are left alone. */
  function scan(root) {
    if (root.nodeType === 3) return skipped(root.parentElement) ? undefined : textNode(root);
    if (root.nodeType !== 1 || skipped(root) || SKIP_TAGS.has(root.tagName)) return undefined;
    attributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeType === 1 && (SKIP_TAGS.has(n.tagName) || n.matches(OFF)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) n.nodeType === 3 ? textNode(n) : attributes(n);
    return undefined;
  }

  /** One pass over everything that changed since the last one. */
  function flush() {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
    const changed = [...nodes];
    const changedAttrs = [...attrs];
    nodes.clear();
    attrs.clear();
    for (const n of changed) if (n.isConnected) scan(n);
    for (const el of changedAttrs) if (el.isConnected && !skipped(el)) attributes(el);
    observer?.takeRecords(); // what this pass wrote is not news
  }

  function schedule() {
    if (frame || timer) return;
    frame = requestAnimationFrame(flush); // before the next paint – the Polish text is never drawn
    timer = setTimeout(flush, 250); // a hidden window draws no frames; its page is kept up to date all the same
  }

  function onMutations(records) {
    for (const r of records) {
      if (r.type === 'childList') for (const n of r.addedNodes) (n.nodeType === 1 || n.nodeType === 3) && nodes.add(n);
      else if (r.type === 'characterData') nodes.add(r.target);
      else attrs.add(r.target);
    }
    if (nodes.size || attrs.size) schedule();
  }

  function start() {
    scan(document.documentElement);
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: WATCHED });
  }

  /** Switches the layer off and puts the Polish text back wherever the layer's own text still stands. */
  function stop() {
    if (!observer) return;
    observer.disconnect();
    observer = null;
    cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = timer = 0;
    nodes.clear();
    attrs.clear();
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      const was = memo.get(n);
      if (!was) continue;
      if (n.nodeType === 3) {
        if (n.nodeValue === was.out) n.nodeValue = was.src;
      } else for (const [name, v] of Object.entries(was)) if (n.getAttribute(name) === v.out) n.setAttribute(name, v.src);
    }
    memo = new WeakMap();
  }

  /** Sets the language of the page: 'en' with its dictionary, or 'pl' (the layer is off). */
  function use(nextLang, dict) {
    stop();
    lang = nextLang === 'en' && dict ? 'en' : 'pl';
    translator = lang === 'en' ? createTranslator(dict) : null;
    document.documentElement.lang = lang;
    if (translator || log) start();
  }

  window.HS_I18N = {
    ...core,
    get lang() {
      return lang;
    },
    /** The locale for numbers and dates: en-GB in English (24-hour clock, day before month), pl-PL in Polish. */
    locale: () => (lang === 'en' ? 'en-GB' : 'pl-PL'),
    /** English for a Polish text of the launcher – for text that never reaches the page (titles, native dialogs). */
    t: (text, variant) => (translator ? (translator.t(text, variant) ?? text) : text),
    /** Every way the page may show a Polish text in English (a few texts read differently from tab to tab) – none in Polish. */
    readings: (text) => (translator ? translator.variants(text) : []),
    use,
    /** Translates what is waiting right now (the preview and tests call it before they look at the page). */
    flush,
  };

  // The launcher tells the language (and hands the dictionary over) before the page starts – see preload.js.
  const boot = window.hs?.i18n;
  use(boot?.lang, boot?.dict);
})();
