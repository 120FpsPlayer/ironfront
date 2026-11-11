'use strict';

/**
 * The launcher's language. Polish is the language everything is written in; English comes from the dictionary
 * src/renderer/i18n/en.json – the same one the window translates its pages with (src/renderer/js/i18n.js).
 * The main process only needs it for its few native texts: the tray menu, the titles and filters of file
 * dialogs, the login window. Messages of the services stay Polish here and are translated when the window
 * shows them.
 */

const fs = require('node:fs');
const path = require('node:path');
const { createTranslator } = require('../renderer/js/i18n');

const LANGUAGES = ['auto', 'pl', 'en'];
const DICTIONARY_FILE = path.join(__dirname, '..', 'renderer', 'i18n', 'en.json');

/**
 * The language the launcher speaks: the player's choice, or – on "auto" – Polish when the system locale
 * (Electron's app.getLocale(): "pl", "pl-PL", "en-US"…) starts with "pl", English for every other locale.
 * A system that names no locale at all gets Polish, the language the launcher is written in.
 */
function resolveLanguage(setting, systemLocale) {
  if (setting === 'pl' || setting === 'en') return setting;
  const locale = String(systemLocale ?? '').trim();
  if (!locale) return 'pl';
  return /^pl(?:[-_]|$)/i.test(locale) ? 'pl' : 'en';
}

let dictionary; // read once, when English is first needed
let translator;

/** The English dictionary (parsed en.json) – null when the file is missing or broken, and the launcher stays Polish. */
function loadDictionary() {
  if (dictionary === undefined) {
    try {
      dictionary = JSON.parse(fs.readFileSync(DICTIONARY_FILE, 'utf8'));
      translator = createTranslator(dictionary);
    } catch {
      dictionary = null;
      translator = null;
    }
  }
  return dictionary;
}

/** A Polish text of the launcher in the given language ('pl' | 'en'); a text the dictionary does not know stays as it is. */
function tr(text, lang) {
  if (lang !== 'en' || typeof text !== 'string') return text;
  loadDictionary();
  return translator?.t(text) ?? text;
}

/** What the window needs to start in a language: { lang, dict } – the dictionary only for English. */
function bootInfo(setting, systemLocale) {
  const lang = resolveLanguage(setting, systemLocale);
  const dict = lang === 'en' ? loadDictionary() : null;
  return dict ? { lang, dict } : { lang: 'pl', dict: null };
}

module.exports = { resolveLanguage, tr, bootInfo, loadDictionary, LANGUAGES, DICTIONARY_FILE };
