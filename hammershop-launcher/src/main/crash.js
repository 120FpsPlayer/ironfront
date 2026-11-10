'use strict';

/**
 * Explains why the game stopped – in Polish, with what to do. Reads the crash report and the end of the log.
 * Returns { title, hints: [string], details } or null when the game simply closed normally.
 */

const RULES = [
  {
    test: /java\.lang\.OutOfMemoryError|Out of memory|GC overhead limit exceeded/i,
    title: 'Grze zabrakło pamięci RAM',
    hints: ['Zwiększ pamięć RAM dla tej instancji w zakładce Optymalizacja (albo zostaw „Automatycznie”).', 'Duże paczki modów potrzebują 6–8 GB.'],
  },
  {
    test: /Could not reserve enough space for object heap|Invalid maximum heap size|Initial heap size set to a larger value/i,
    title: 'Ustawiono za dużo pamięci RAM',
    hints: ['Zmniejsz RAM w zakładce Optymalizacja – Twój komputer nie może przydzielić tyle grze.'],
  },
  {
    test: /UnsupportedClassVersionError|has been compiled by a more recent version of the Java Runtime|class file version \d+/i,
    title: 'Zła wersja Javy',
    hints: ['Ustaw Javę na „Automatycznie” w ustawieniach instancji – launcher pobierze właściwą wersję.'],
  },
  {
    test: /Incompatible mods? found|Mod resolution encountered an incompatible mod set|Some of your mods are incompatible|requires (?:any version|version [^\s]+) of/i,
    title: 'Mody się nie zgadzają',
    hints: ['Brakuje wymaganego moda albo dwa mody się wykluczają – szczegóły poniżej.', 'Zaktualizuj mody w zakładce Mody albo wyłącz ostatnio dodany mod.'],
    extract: (text) => [...text.matchAll(/^\s*-\s*(?:Mod|Install|Replace|Remove)\b.*$/gim)].map((m) => m[0].trim()).slice(0, 8),
  },
  {
    test: /DuplicateModsFoundException|Found duplicate mods?|Duplicate mods? found|duplicate mod/i,
    title: 'Ten sam mod jest zainstalowany dwa razy',
    hints: ['Usuń starszą kopię moda w zakładce Mody.'],
  },
  {
    test: /Mixin apply (?:for mod \S+ )?failed|MixinApplyError|InvalidInjectionException|Mixin transformation of .* failed/i,
    title: 'Konflikt modów (Mixin)',
    hints: ['Jeden z modów nie pasuje do tej wersji gry albo do innego moda.', 'Zaktualizuj mody; jeśli to nie pomoże, wyłącz mod podany poniżej.'],
    extract: (text) => [...text.matchAll(/(?:from mod|for mod)\s+([\w-]+)/gi)].map((m) => `Mod: ${m[1]}`).filter((v, i, a) => a.indexOf(v) === i).slice(0, 5),
  },
  {
    test: /Pixel format not accelerated|WGL_ARB_create_context|GLFW error 65542|GLFW error 65543|Could not create context|OpenGL 3\.2|No OpenGL context/i,
    title: 'Problem ze sterownikami karty graficznej',
    hints: ['Zaktualizuj sterowniki karty graficznej (NVIDIA / AMD / Intel) ze strony producenta.', 'Na laptopie włącz w Optymalizacji „mocniejszą kartę graficzną”.'],
  },
  {
    test: /EXCEPTION_ACCESS_VIOLATION|SIGSEGV|A fatal error has been detected by the Java Runtime Environment/i,
    title: 'Awaria sterownika lub biblioteki natywnej',
    hints: ['Zaktualizuj sterowniki karty graficznej.', 'Wyłącz shadery i spróbuj ponownie.'],
  },
  {
    test: /Failed to verify username|Invalid session|InvalidCredentialsException|401 Unauthorized/i,
    title: 'Sesja konta wygasła',
    hints: ['Wyloguj się i zaloguj ponownie w zakładce Konta.'],
  },
  {
    test: /ModLoadingException|Mod .* requires .* or above|LoadingFailedException|net\.minecraftforge\.fml\.ModLoadingException/i,
    title: 'Forge/NeoForge nie załadował modów',
    hints: ['Któryś mod wymaga innej wersji gry, loadera lub innego moda – szczegóły poniżej.'],
    extract: (text) => [...text.matchAll(/^.*(?:requires|needs).*$/gim)].map((m) => m[0].trim()).slice(0, 6),
  },
];

function analyze({ code, signal, crashReport = '', log = '' } = {}) {
  if (code === 0 && !crashReport) return null;
  if (signal === 'SIGTERM' || signal === 'SIGKILL') return { title: 'Gra została zamknięta', hints: [], details: [] };
  const text = `${crashReport}\n${log}`;
  for (const rule of RULES) {
    if (rule.test.test(text)) return { title: rule.title, hints: rule.hints, details: rule.extract ? rule.extract(text) : [] };
  }
  const reason = /^Description: (.+)$/m.exec(crashReport)?.[1];
  return {
    title: 'Gra niespodziewanie się zamknęła',
    hints: ['Otwórz konsolę, żeby zobaczyć szczegóły, albo wyślij nam log na Discordzie.', 'Jeśli dodano nowe mody, spróbuj je wyłączyć.'],
    details: reason ? [reason] : code != null ? [`Kod wyjścia: ${code}`] : [],
  };
}

module.exports = { analyze, RULES };
