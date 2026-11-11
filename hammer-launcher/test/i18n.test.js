'use strict';

/* The English version: the dictionary (src/renderer/i18n/en.json), the translator (src/renderer/js/i18n.js),
   the language of the launcher (src/main/i18n.js) and the texts of the interface that must be in the dictionary. */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('./helpers');
const { createTranslator, englishNumber, TRANSFORMS } = require('../src/renderer/js/i18n');
const { resolveLanguage, tr, bootInfo, loadDictionary, LANGUAGES, DICTIONARY_FILE } = require('../src/main/i18n');
const { sanitize, DEFAULT_SETTINGS } = require('../src/main/settings');
const { createInstances } = require('../src/main/instances');
const { createPaths } = require('../src/main/paths');
const { literals, isUiText, covered, uiTexts, jsFiles, vocabulary } = require('../scripts/i18n-literals');

const ROOT = path.join(__dirname, '..');
const POLISH = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const dict = JSON.parse(fs.readFileSync(DICTIONARY_FILE, 'utf8'));
const en = createTranslator(dict);
const groupsOf = (re) => new RegExp(`${re}|`, 'su').exec('').length - 1;

test('dictionary: valid JSON with all its parts, no empty texts, English without Polish letters', () => {
  assert.deepEqual(Object.keys(dict).sort(), ['contexts', 'dates', 'patterns', 'plurals', 'same', 'strings']);
  assert.ok(Object.keys(dict.strings).length > 1000, 'the dictionary holds the interface');
  for (const [pl, text] of Object.entries(dict.strings)) {
    assert.ok(pl.trim() === pl && pl.length > 0, `key with spaces around it: "${pl}"`);
    assert.ok(typeof text === 'string' && text.trim().length > 0, `empty translation of "${pl}"`);
    assert.ok(text.trim() === text, `spaces around the translation of "${pl}"`);
    assert.ok(!POLISH.test(text), `Polish letters in the translation of "${pl}": "${text}"`);
    assert.ok(!text.includes('„'), `Polish quotation mark in the translation of "${pl}"`);
  }
  for (const [word, text] of Object.entries(dict.dates)) assert.ok(word === word.toLowerCase() && /^[A-Z][a-z]+$/.test(text), `date word ${word}`);
  for (const c of dict.contexts) {
    assert.ok(typeof c.in === 'string' && c.in.trim(), 'a context names where it applies (a CSS selector)');
    for (const [pl, text] of Object.entries(c.strings)) assert.ok(pl && text.trim() && !POLISH.test(text), `context ${c.in}: "${pl}"`);
  }
});

test('dictionary: a text that reads the same in English is listed under "same", never as its own translation', () => {
  const same = new Set(dict.same);
  assert.equal(same.size, dict.same.length, 'no text twice under "same"');
  for (const [pl, text] of Object.entries(dict.strings)) {
    assert.notEqual(pl, text, `"${pl}" is translated as itself – list it under "same" if that is intended`);
    assert.ok(!same.has(pl), `"${pl}" is both under "same" and translated`);
  }
  for (const s of dict.same) assert.equal(en.t(s), s);
  assert.ok(en.isSame('Hammer+') && !en.isKey('Hammer+') && en.isKey('Graj') && !en.isSame('Graj'));
});

test('dictionary: every pattern compiles, and its English only uses groups the pattern has', () => {
  const seen = new Set();
  for (const p of dict.patterns) {
    assert.doesNotThrow(() => new RegExp(p.re, 'su'), `pattern does not compile: ${p.re}`);
    assert.ok(p.re.startsWith('^') && p.re.endsWith('$'), `a pattern matches a whole text (^…$): ${p.re}`);
    assert.ok(!seen.has(p.re), `the same pattern twice: ${p.re}`);
    seen.add(p.re);
    const groups = groupsOf(p.re);
    assert.ok(typeof p.en === 'string' && p.en.trim(), `pattern without English: ${p.re}`);
    assert.ok(!POLISH.test(p.en), `Polish letters in the English of ${p.re}`);
    for (const m of p.en.matchAll(/\$(\d)/g)) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= groups, `"${p.en}" uses $${m[1]}, but ${p.re} has ${groups} group(s)`);
    for (const [group, how] of Object.entries(p.as ?? {})) {
      assert.ok(Number(group) >= 1 && Number(group) <= groups, `"as" names group ${group}, but ${p.re} has ${groups}`);
      assert.ok(TRANSFORMS.includes(how), `unknown "as": ${how} in ${p.re}`);
      assert.ok(p.en.includes(`$${group}`), `"as" names group ${group}, which "${p.en}" does not use`);
    }
  }
});

test('dictionary: counted nouns have three Polish forms and two English ones, and no form means two things', () => {
  const forms = new Map();
  for (const p of dict.plurals) {
    assert.equal(p.pl.length, 3, JSON.stringify(p));
    assert.equal(p.en.length, 2, JSON.stringify(p));
    for (const text of [...p.pl, ...p.en]) assert.ok(typeof text === 'string' && text.trim(), JSON.stringify(p));
    for (const form of p.pl) {
      if (forms.has(form)) assert.deepEqual(forms.get(form), p.en, `"${form}" stands for two different English nouns`);
      forms.set(form, p.en);
    }
  }
});

test('language: the player\'s choice, or the system\'s – Polish for pl, English for every other locale', () => {
  assert.deepEqual(LANGUAGES, ['auto', 'pl', 'en']);
  for (const locale of ['pl', 'pl-PL', 'pl_PL', 'PL', 'Pl-pl']) assert.equal(resolveLanguage('auto', locale), 'pl', locale);
  for (const locale of ['en', 'en-US', 'en-GB', 'de', 'de-DE', 'uk', 'cs', 'fr-FR', 'pt-BR', 'plt', 'pl2']) assert.equal(resolveLanguage('auto', locale), 'en', locale);
  // A system that names no locale gets the language the launcher is written in.
  for (const locale of ['', '  ', null, undefined]) assert.equal(resolveLanguage('auto', locale), 'pl');
  // An explicit choice never looks at the system.
  assert.equal(resolveLanguage('pl', 'en-US'), 'pl');
  assert.equal(resolveLanguage('en', 'pl-PL'), 'en');
  // Anything else (an old settings file, a broken value) counts as "auto".
  for (const setting of [undefined, null, '', 'de', 'EN', 5]) assert.deepEqual([resolveLanguage(setting, 'pl-PL'), resolveLanguage(setting, 'en-US')], ['pl', 'en']);
});

test('language setting: "auto" by default, only auto / pl / en are kept', () => {
  assert.equal(DEFAULT_SETTINGS.language, 'auto');
  assert.equal(sanitize({}).language, 'auto');
  assert.equal(sanitize({ language: 'en' }).language, 'en');
  assert.equal(sanitize({ language: 'pl' }).language, 'pl');
  assert.equal(sanitize({ language: 'de' }, { ...DEFAULT_SETTINGS, language: 'en' }).language, 'en');
  assert.equal(sanitize({ language: 'auto' }, { ...DEFAULT_SETTINGS, language: 'en' }).language, 'auto');
});

test('language at the start of the window: English comes with the dictionary, Polish with none', () => {
  assert.deepEqual(bootInfo('pl', 'en-US'), { lang: 'pl', dict: null });
  assert.deepEqual(bootInfo('auto', 'pl-PL'), { lang: 'pl', dict: null });
  const boot = bootInfo('auto', 'en-US');
  assert.equal(boot.lang, 'en');
  assert.equal(boot.dict, loadDictionary());
  assert.deepEqual(boot.dict, dict);
  assert.equal(bootInfo('en', 'pl-PL').lang, 'en');
});

test('tr: Polish stays as written; English comes from the dictionary; an unknown text stays as it is', () => {
  assert.equal(tr('Graj', 'pl'), 'Graj');
  assert.equal(tr('Graj', 'en'), 'Play');
  assert.equal(tr('Pokaż launcher', 'en'), 'Show launcher');
  assert.equal(tr('Zatrzymaj grę', 'en'), 'Stop game');
  assert.equal(tr('Zamknij launcher', 'en'), 'Quit launcher');
  assert.equal(tr('Logowanie Microsoft', 'en'), 'Microsoft sign-in');
  assert.equal(tr('Gra przez Hammer Launcher', 'en'), 'Playing via Hammer Launcher');
  assert.equal(tr('Sklep HammerShop', 'en'), 'HammerShop store');
  assert.equal(tr('Mój świat w kratkę', 'en'), 'Mój świat w kratkę', 'a name nobody translated');
  assert.equal(tr('Survival z ekipą', 'en'), 'Survival z ekipą');
  assert.equal(tr('', 'en'), '');
  assert.equal(tr(null, 'en'), null);
  assert.equal(tr(undefined, 'pl'), undefined);
  assert.equal(tr('Graj', 'de'), 'Graj', 'only "en" translates');
  // Texts with variable parts.
  assert.equal(tr('Aktualizacje modów: 3 w „Hammer”', 'en'), 'Mod updates: 3 in “Hammer”');
  assert.equal(tr('Aktualizuj wszystko (2)', 'en'), 'Update all (2)');
  assert.equal(tr('Zaproś na: HammerShop', 'en'), 'Invite to: HammerShop');
});

test('the native texts of the main process (tray, file dialogs, login window) are all in the dictionary', () => {
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.js'), 'utf8');
  const texts = [...main.matchAll(/\bT\((?:type === 'mod' \? )?'([^']+)'(?: : '([^']+)')?\)/g)].flatMap((m) => [m[1], m[2]].filter(Boolean));
  assert.ok(texts.length >= 10, `main.js passes its native texts through T(): ${texts.join(' | ')}`);
  for (const text of texts) assert.notEqual(tr(text, 'en'), text, `main.js: "${text}"`);
  // The dialogs the services open through pickFile / saveFile: their titles and the names of their filters.
  const services = fs.readFileSync(path.join(ROOT, 'src', 'main', 'services.js'), 'utf8');
  const dialogs = [...services.matchAll(/(?:pickFile|saveFile)\?\.\(\{ title: '([^']+)',.*?filters: \[\{ name: '([^']+)'/g)];
  assert.ok(dialogs.length >= 4);
  for (const [, title, filter] of dialogs) {
    assert.notEqual(tr(title, 'en'), title, `dialog title "${title}"`);
    assert.notEqual(tr(filter, 'en'), filter, `dialog filter "${filter}"`);
  }
});

test('counted nouns: 1 mod / 2 mody / 5 modów → 1 mod / 2 mods / 5 mods', () => {
  assert.deepEqual(['2 mody', '5 modów', '22 mody', '112 modów'].map((s) => en.t(s)), ['2 mods', '5 mods', '22 mods', '112 mods']);
  assert.equal(en.t('1 mod'), null, '"1 mod" reads the same in both languages – nothing to translate');
  assert.deepEqual(['1 świat', '3 światy', '7 światów'].map((s) => en.t(s)), ['1 world', '3 worlds', '7 worlds']);
  assert.deepEqual(['1 plik', '48 plików', '1 zależność', '2 zależności'].map((s) => en.t(s)), ['1 file', '48 files', '1 dependency', '2 dependencies']);
  assert.equal(en.t('1 paczka zasobów'), '1 resource pack');
  assert.equal(en.t('3 mniejsze instancje'), '3 smaller instances');
  // Thousands: the Polish hard space becomes a comma; a number that is English already stays.
  assert.equal(en.t('12\u00a0345 modów'), '12,345 mods');
  assert.equal(en.t('12,345 modów'), '12,345 mods');
  // The noun alone (next to a number in its own element).
  assert.deepEqual(['członek', 'członków', 'serwerów'].map((s) => en.t(s)), ['member', 'members', 'servers']);
  // Not a counted noun the dictionary knows: no guess.
  assert.equal(en.t('5 kotów'), null);
  // Inside a sentence.
  assert.equal(en.t('Starsze niż 7 dni · 48 plików'), 'Older than 7 days · 48 files');
  assert.equal(en.t('6 modów · włączone: 5'), '6 mods · enabled: 5');
  assert.equal(en.t('Zestaw „Budowanie”: zainstalowano 5 dodatków (razem z zależnościami).'), 'Bundle “Building”: installed 5 add-ons (including dependencies).');
});

test('relative times, dates and numbers read naturally in English', () => {
  assert.equal(en.t('przed chwilą'), 'just now');
  assert.equal(en.t('5 min temu'), '5 min ago');
  assert.deepEqual(['1 godzinę temu', '3 godziny temu', '15 godzin temu'].map((s) => en.t(s)), ['1 hour ago', '3 hours ago', '15 hours ago']);
  assert.equal(en.t('wczoraj'), 'yesterday');
  assert.equal(en.t('3 dni temu'), '3 days ago');
  assert.equal(en.t('nigdy'), 'never');
  assert.equal(en.t('mniej niż minuta'), 'less than a minute');
  assert.equal(en.t('Dodano 9 dni temu'), 'Added 9 days ago');
  assert.equal(en.t('Zniknie po 72 godzinach'), 'Gone after 72 hours');
  // A date the main process wrote in Polish.
  assert.equal(en.t('Twój Hammer+ wygasł 3 listopada 2026. Przedłuż go w sklepie – bot wyśle Ci nowy kod.'), 'Your Hammer+ expired on 3 November 2026. Renew it in the store – the bot will send you a new code.');
  assert.equal(en.t('Hammer+ jest aktywny do 11 grudnia 2026 na koncie HammerGracz.'), 'Hammer+ is active until 11 December 2026 on the account HammerGracz.');
  assert.equal(en.t('do 1 stycznia 2027'), 'until 1 January 2027');
  for (const [pl, text] of [['stycznia', 'January'], ['lutego', 'February'], ['marca', 'March'], ['kwietnia', 'April'], ['maja', 'May'], ['czerwca', 'June'], ['lipca', 'July'], ['sierpnia', 'August'], ['września', 'September'], ['października', 'October'], ['listopada', 'November'], ['grudnia', 'December']]) {
    assert.equal(en.t(`do 5 ${pl} 2026`), `until 5 ${text} 2026`);
  }
  for (const day of ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela']) assert.ok(dict.dates[day], day);
  assert.deepEqual(['12\u00a0345,6', '1,5', '1234', '1,234.5', '7'].map(englishNumber), ['12,345.6', '1.5', '1234', '1,234.5', '7']);
  assert.equal(en.t('+38% średnio'), '+38% on average');
  assert.equal(en.t('Test FPS zakończony: średnio 241 FPS (+38% średnio).'), 'FPS test finished: average 241 FPS (+38% on average).');
});

test('texts put together from parts: " · ", sentences, a name with a dash, quotation marks, optional parts', () => {
  assert.equal(en.t('Minecraft 1.21.1 · ostatnia gra: 2 dni temu · 297.5 MB · folder: New World'), 'Minecraft 1.21.1 · last played: 2 days ago · 297.5 MB · folder: New World');
  assert.equal(en.t('Zainstalowano 39 dodatków. 2 dodatków nie udało się dodać – reszta działa.'), 'Installed 39 add-ons. 2 add-ons could not be added – the rest works.');
  assert.equal(en.t('Sodium – Nowy silnik renderowania – zwykle 2–3× więcej FPS.'), 'Sodium – A new rendering engine – usually 2–3× more FPS.');
  assert.equal(en.t('Zorza – powoli falujące światła'), 'Aurora – slowly waving lights');
  assert.equal(en.t('Uruchamiam grę (4 GB RAM).'), 'Launching the game (4 GB RAM).');
  assert.equal(en.t('Uruchamiam grę i łączę z mc.hammershop.pl (4 GB RAM).'), 'Launching the game and connecting to mc.hammershop.pl (4 GB RAM).');
  assert.equal(en.t('Instancje „Hammer”, „PvP” są w grze, więc zostały'), 'Instances “Hammer”, “PvP” are in the game, so they were left');
  assert.equal(en.t('Launcher usunie na stałe: pamięć podręczną launchera, nieużywaną Javę. Twoje światy, mody i ustawienia zostają, a potrzebne pliki gry pobiorą się ponownie przy starcie.'), 'The launcher will permanently delete: the launcher cache, unused Java. Your worlds, mods and settings stay, and the game files that are needed download again at start.');
  // A name inside a sentence is never touched, even when it is a word of the dictionary.
  assert.equal(en.t('Usunąć instancję?'), 'Delete instance?');
  assert.equal(en.t('Świat „Graj” jest w koszu.'), 'The world “Graj” is in the trash.');
  // Text that is not the launcher's: nothing.
  for (const text of ['Survival z ekipą', 'HammerShop – survival, skyblock i eventy co weekend!', '[12:41:02] [main/INFO]: Loading 38 mods:', 'C:\\Users\\Gracz\\AppData\\Roaming\\.hammer-launcher', '1.21.1', '41%', 'sodium-fabric-0.6.5+mc1.21.4.jar']) assert.equal(en.t(text), null, text);
});

test('a text that reads differently in another place has a context', () => {
  assert.equal(en.t('Zestawy'), 'Bundles');
  assert.equal(en.t('Zestawy', '.skin-page'), 'Outfits');
  assert.deepEqual(en.contextsOf('Zestawy').sort(), ['.plus-page', '.skin-page']);
  assert.deepEqual(en.variants('Zestawy').sort(), ['Bundles', 'Outfits']);
  assert.deepEqual(en.contextsOf('Graj'), []);
  assert.deepEqual(en.variants('Graj'), ['Play']);
  assert.deepEqual(en.variants('Nie ma takiego tekstu'), []);
});

test('the capes of Hammer+ are called in the dictionary what capes.json calls them in English', () => {
  const capes = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'capes', 'capes.json'), 'utf8'));
  for (const cape of capes) assert.equal(en.t(cape.name), cape.nameEn, cape.id);
});

test('names the launcher makes up itself follow the language: a copied instance', () => {
  const polish = createInstances(createPaths(tmpDir()));
  assert.equal(polish.duplicate(polish.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' }).id).name, 'Hammer (kopia)');
  const english = createInstances(createPaths(tmpDir()), { t: (text) => tr(text, 'en') });
  assert.equal(english.duplicate(english.create({ name: 'Hammer', mcVersion: '1.21.1', loader: 'fabric' }).id).name, 'Hammer (copy)');
});

/*
 * The texts written in the interface's code must be in the dictionary. What this covers: string literals in
 * src/renderer/views/*.js, js/app.js and js/core.js that are clearly text for people – any literal with Polish
 * letters, and any that starts with a capital letter and is made of words ("Graj", "Dodaj konto", "Z Minecrafta");
 * a template (`Usuń ${x}`) counts as covered when a pattern matches it with something (or nothing) in place of
 * every ${…}. What it cannot see: texts without Polish letters that start with a small letter ("w grze",
 * "online", "z shaderami"), texts glued together from several literals, and texts that come from the main
 * process – those are caught by the English run of scripts/preview.js, which fails when Polish is left on a screen.
 */
test('every text written in the interface code is in the dictionary (or matched by a pattern)', () => {
  const files = [...jsFiles(path.join(ROOT, 'src', 'renderer', 'views')), path.join(ROOT, 'src', 'renderer', 'js', 'app.js'), path.join(ROOT, 'src', 'renderer', 'js', 'core.js')];
  assert.ok(files.length >= 17);
  const texts = uiTexts(files);
  assert.ok(texts.length > 900, `the views hold the interface's texts (${texts.length})`);
  const missing = texts.filter((t) => !covered(t.quasis, en)).map((t) => `${path.relative(ROOT, t.file)}:${t.line}  ${t.quasis.join('${…}')}`);
  assert.deepEqual(missing, [], `texts without a translation – add them to src/renderer/i18n/en.json:\n${missing.join('\n')}`);
});

test('the reader of string literals: strings, templates with parts, comments and regular expressions', () => {
  const found = literals("const a = 'Graj'; // 'not this'\n/* \"nor this\" */ const b = `Usuń ${x ? 'tak' : `nie ${y}`} teraz`; const re = /'[a-z]+'/g; const c = \"It's\"; const d = 4 / 2; const e = 'po\\u0142\\u0105cz \\'x\\'';");
  assert.deepEqual(found.map((f) => f.quasis), [['Graj'], ['Usuń ', ' teraz'], ['tak'], ['nie ', ''], ["It's"], ["połącz 'x'"]]);
  assert.deepEqual(found.map((f) => f.line), [1, 2, 2, 2, 2, 2]);
  assert.deepEqual(['Graj', 'Dodaj konto', 'Z Minecrafta', 'Usunąć?', 'żar i iskry z dołu', 'Test FPS'].map((t) => isUiText([t])), [true, true, true, true, true, true]);
  assert.deepEqual(['click', 'div.card', 'Escape', 'selectedInstance', 'C', 'https://hammershop.pl', 'image/png', 'above_normal', '#ff9f43', 'w grze'].map((t) => isUiText([t])), [false, false, false, false, false, false, false, false, false, false]);
  assert.deepEqual([isUiText(['Usuń ', '']), isUiText(['Aktywny ', '']), isUiText(['Minecraft ', '']), isUiText(['', ' · ', ''])], [true, true, false, false]);
  const tiny = createTranslator({ strings: { Graj: 'Play' }, patterns: [{ re: '^Usuń (.+)$', en: 'Delete $1' }, { re: '^Zwolniono (.+)\\.$', en: 'Freed $1.' }] });
  assert.deepEqual([covered(['Graj'], tiny), covered(['Stop'], tiny), covered(['Usuń ', ''], tiny), covered(['Dodaj ', ''], tiny), covered(['Zwolniono ', '.', ''], tiny), covered(['', ' · ', ''], tiny)], [true, false, true, false, true, true]);
  const words = vocabulary({ strings: { 'Zainstaluj paczkę': 'Install modpack', 'Status w Discordzie': 'Discord status' }, patterns: [{ re: '^Usunięto (\\d+) plików$', en: 'Removed $1 files' }] });
  assert.ok(words.polish.has('zainstaluj') && words.polish.has('usunięto') && words.polish.has('plików') && !words.polish.has('status') && words.english.has('install'));
});

test('texts outside the JavaScript: the static page and the style sheet', () => {
  // index.html: the tooltips and labels of the title bar are translated like everything else.
  const html = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'index.html'), 'utf8');
  const attrs = [...html.matchAll(/\b(?:title|aria-label|placeholder|alt)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(attrs.includes('Minimalizuj') && attrs.includes('Zamknij'));
  for (const text of attrs) assert.ok(en.t(text) != null, `index.html: "${text}" is not in the dictionary`);
  assert.match(html, /<html lang="pl">/, 'the page starts as Polish; js/i18n.js sets the language');
  assert.ok(html.indexOf('js/i18n.js') > 0 && html.indexOf('js/i18n.js') < html.indexOf('js/core.js'), 'i18n.js is loaded before core.js');
  // styles.css: a text drawn by CSS (content:"…") cannot be reached by the layer – it needs its English rule.
  const css = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'styles.css'), 'utf8');
  const drawn = [...css.matchAll(/(^|\})([^{}]+)\{[^{}]*content:"([^"]*\p{L}{2}[^"]*)"/gmu)].map((m) => ({ selector: m[2].trim(), text: m[3] }));
  const polish = drawn.filter((d) => !d.selector.startsWith('html[lang="en"]'));
  assert.ok(polish.length >= 1);
  for (const d of polish) {
    const english = drawn.find((x) => x.selector === `html[lang="en"] ${d.selector}`);
    assert.ok(english, `styles.css: content:"${d.text}" of ${d.selector} has no html[lang="en"] rule`);
    assert.ok(!POLISH.test(english.text) && english.text !== d.text);
  }
});
