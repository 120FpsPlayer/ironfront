'use strict';

/**
 * Polish slash commands. The commands are written in English in src/commands/ (names the code uses), and Discord gets
 * them in Polish: /produkt dodaj nazwa:… cena:… When someone uses one, the interaction is turned back into the English
 * names before it reaches the command (unlocalize), so the commands' code never has to know.
 *
 * Names: lowercase, no Polish letters (easy to type), max 32 characters. Descriptions and choices: max 100 characters.
 * A command, option or choice missing here keeps its English text.
 */

const { CommandInteractionOptionResolver } = require('discord.js');

/** name, description, sub-options (by English name), choices (by value). */
const C = (name, description, options = {}, choices = null) => ({ name, description, options, choices });

const STOCK = { in: '🟢 Dostępny', low: '🟠 Mało sztuk', out: '🔴 Wyprzedany' };
const DELIVERY = {
  instant: '⚡ Dostawa natychmiastowa',
  1: '🕒 1 dzień', 2: '🕒 2 dni', 3: '🕒 3 dni', 4: '🕒 4 dni', 5: '🕒 5 dni', 6: '🕒 6 dni', 7: '🕒 7 dni',
  14: '🕒 Do 14 dni',
  auto: '↩️ Automatycznie (domyślnie)',
};
const user = (description = 'Osoba') => C('osoba', description);
const product = C('produkt', 'Produkt');

const MAP = {
  affiliate: C('tworca', 'Kody twórców: kupujący mają rabat, a twórca dostaje prowizję od każdej sprzedaży', {
    create: C('utworz', 'Daj twórcy jego własny kod (admini i sprzedawcy)', {
      user: C('tworca', 'Twórca'),
      code: C('kod', 'Kod, który wpisują kupujący, np. HS-ALEX (3–24 litery, cyfry, - i _)'),
      discount: C('rabat', 'Rabat dla kupujących w procentach (domyślnie 5%)'),
      commission: C('prowizja', 'Procent od każdej sprzedaży dla twórcy (domyślnie 10%)'),
    }),
    list: C('lista', 'Wszystkie kody twórców z ich sprzedażą i należną prowizją (admini i sprzedawcy)'),
    remove: C('usun', 'Usuń kod twórcy – nowe zamówienia nie mogą go użyć (admini i sprzedawcy)', { code: C('kod', 'Kod') }),
    payout: C('wyplata', 'Oznacz należną prowizję twórcy jako wypłaconą (admini i sprzedawcy)', { user: C('tworca', 'Twórca') }),
    stats: C('statystyki', 'Użycia, sprzedaż, przychód i prowizja Twojego kodu twórcy', { user: C('tworca', 'Statystyki innego twórcy (tylko zespół)') }),
  }),
  announce: C('ogloszenie', 'Opublikuj ładne ogłoszenie (otwiera formularz)', {
    channel: C('kanal', 'Gdzie opublikować (domyślnie: kanał z ogłoszeniami)'),
    ping: C('ping', 'Kogo powiadomić', {}, {
      none: 'Bez pingu', pingAnnouncements: '📢 Rola Ogłoszenia', pingGiveaways: '🎉 Rola Giveawaye', pingRestocks: '📦 Rola Dostawy', everyone: '@everyone',
    }),
    banner: C('baner', 'Baner na górze', {}, {
      none: 'Bez banera', announcements: '📢 Ogłoszenia', updates: '🔔 Aktualizacje', 'whats-new': '📰 Nowości', restocks: '📦 Dostawy',
      giveaways: '🎁 Giveawaye', events: '📅 Wydarzenia', shop: '🛒 Sklep', products: '🏷️ Produkty', payments: '💳 Płatności', staff: '🛡️ Zespół',
      'join-us': '➕ Dołącz do nas (rekrutacja)', welcome: '👋 Powitanie', rules: '⚖️ Regulamin', support: '🎧 Pomoc', boosters: '🚀 Boosterzy',
      leaderboard: '🏆 Ranking', discord: '💬 Discord',
    }),
  }),
  backup: C('kopia', 'Zrób teraz kopię zapasową danych bota – trafia na kanał z kopiami (admini)'),
  balance: C('saldo', 'Saldo sklepu – Twoje albo zarządzanie saldem członka (admini i sprzedawcy)', {
    view: C('pokaz', 'Twoje saldo i ostatnie zmiany (zespół: wybierz członka, żeby zobaczyć jego saldo)', { user: user('Członek (tylko zespół – zostaw puste, żeby zobaczyć swoje)') }),
    add: C('dodaj', 'Dodaj saldo członkowi (admini i sprzedawcy)', { user: user('Członek'), amount: C('kwota', 'Kwota do dodania'), reason: C('powod', 'Powód – zapisany w historii i w logach') }),
    remove: C('odejmij', 'Odejmij saldo członkowi (admini i sprzedawcy)', { user: user('Członek'), amount: C('kwota', 'Kwota do odjęcia'), reason: C('powod', 'Powód – zapisany w historii i w logach') }),
  }),
  blacklist: C('czarna-lista', 'Zablokuj osobom tworzenie ticketów', {
    add: C('dodaj', 'Zablokuj osobę', { user: user(), reason: C('powod', 'Powód') }),
    remove: C('usun', 'Odblokuj osobę', { user: user() }),
    list: C('lista', 'Lista zablokowanych osób'),
  }),
  build: C('zbuduj', 'Zbuduj cały serwer – role, kanały, banery, emotki, sklep, tickety i więcej', {
    only: C('tylko', 'Uruchom tylko jedną część (puste = cały serwer)', {}, {
      update: '🆕 Aktualizacja – nowe i stare kanały/role, nazwy i panele',
      emojis: '😀 Emotki – wgraj brakujące emotki',
      panels: '🔄 Panele – odśwież banery i karty (po zmianie config.json)',
      names: '🎨 Nazwy – zmień nazwy kanałów i kategorii na aktualny styl',
    }),
  }),
  customer: C('klient', 'Profile klientów i prywatne notatki zespołu (zespół)', {
    view: C('profil', 'Zamówienia, wydatki, tickety, opinie, zaproszenia i notatki zespołu o członku', { user: C('klient', 'Klient') }),
    note: C('notatka', 'Prywatne notatki zespołu o kliencie', {
      add: C('dodaj', 'Dodaj prywatną notatkę – widzi ją tylko zespół', { user: C('klient', 'Klient'), text: C('tresc', 'Treść notatki (do 500 znaków)') }),
      remove: C('usun', 'Usuń notatkę (swoją – moderatorzy mogą usunąć każdą)', { user: C('klient', 'Klient'), id: C('numer', 'Numer notatki, np. 3 dla #3 (widać go na profilu)') }),
    }),
  }),
  disable: C('wylacz-platnosc', 'Wyłącz na chwilę metodę płatności, np. na czas naprawy (admini i sprzedawcy)', {
    method: C('metoda', 'Metoda płatności'),
    reason: C('powod', 'Widoczny dla klientów, np. „przerwa techniczna – wracamy wieczorem”'),
  }),
  enable: C('wlacz-platnosc', 'Włącz z powrotem metodę płatności (admini i sprzedawcy)', { method: C('metoda', 'Metoda płatności') }),
  launcher: C('launcher', 'Hammer Launcher: co to jest, aktualna wersja i skąd go pobrać'),
  featured: C('polecane', 'Polecane serwery w Hammer Launcherze (admini i sprzedawcy)', {
    add: C('dodaj', 'Dodaj serwer do polecanych w launcherze', {
      name: C('nazwa', 'Nazwa serwera'),
      address: C('adres', 'Adres serwera: host albo host:port, np. mc.hammershop.pl'),
      description: C('opis', 'Krótki opis (do 200 znaków)'),
      tags: C('tagi', 'Tagi oddzielone przecinkami, np. survival, pvp (do 6)'),
      icon: C('ikona', 'Adres ikony serwera – musi zaczynać się od https://'),
      mc: C('wersja', 'Wersja Minecrafta, np. 1.21.4'),
      loader: C('loader', 'Loader modów'),
      pack: C('paczka', 'Paczka modów, którą launcher ma zainstalować dla tego serwera (opcjonalnie)'),
    }),
    remove: C('usun', 'Usuń serwer z polecanych', { server: C('serwer', 'Serwer') }),
    list: C('lista', 'Lista polecanych serwerów'),
  }),
  giveaway: C('giveaway', 'Giveawaye (moderatorzy)', {
    start: C('start', 'Rozpocznij giveaway', {
      prize: C('nagroda', 'Co można wygrać?'),
      duration: C('czas', 'Jak długo? np. 30m, 2h, 1d, 1w, 1d12h'),
      winners: C('zwyciezcy', 'Liczba zwycięzców (domyślnie 1)'),
      description: C('opis', 'Dodatkowe informacje widoczne w giveawayu'),
      channel: C('kanal', 'Kanał (domyślnie: kanał z giveawayami)'),
      required_role: C('wymagana-rola', 'Wziąć udział mogą tylko osoby z tą rolą'),
      buyers_only: C('tylko-klienci', 'Tylko klienci (co najmniej jedno zrealizowane zamówienie)'),
      min_invites: C('min-zaproszen', 'Tylko osoby, które zaprosiły co najmniej tylu członków (wciąż na serwerze)'),
      ping: C('ping', 'Pingnąć rolę Giveawaye? (domyślnie: tak)'),
    }),
    end: C('zakoncz', 'Zakończ giveaway teraz', { giveaway: C('giveaway', 'Który giveaway') }),
    reroll: C('losuj-ponownie', 'Wylosuj nowych zwycięzców zakończonego giveawayu', { giveaway: C('giveaway', 'Który giveaway'), winners: C('zwyciezcy', 'Ilu nowych zwycięzców (domyślnie 1)') }),
    list: C('lista', 'Aktywne i ostatnie giveawaye'),
  }),
  hammerplus: C('hammerplus', 'Hammer+ w Hammer Launcherze – kody przypisane do konta Minecraft (admini i sprzedawcy)', {
    grant: C('nadaj', 'Wystaw kod Hammer+ dla konta Minecraft klienta', {
      nick: C('nick', 'Nick Minecraft klienta (konto premium)'),
      days: C('dni', 'Na ile dni (0 = na zawsze)'),
    }),
    check: C('sprawdz', 'Sprawdź kod: czyj jest i do kiedy działa', { code: C('kod', 'Kod Hammer+ (HP1.…)') }),
    list: C('lista', 'Ostatnio wystawione kody – nick, ważność i kto je wystawił (bez samych kodów)'),
    key: C('klucz', 'Czy klucz podpisu jest ustawiony – i klucz publiczny do wpisania w launcherze'),
  }),
  help: C('pomoc', 'Wszystkie komendy bota HammerShop, których możesz użyć'),
  invites: C('zaproszenia', 'Zaproszenia: Twoje zaproszenia, następna nagroda i ranking zapraszających', {
    stats: C('statystyki', 'Ważne, oczekujące i utracone zaproszenia oraz następna nagroda – Twoje lub innej osoby', { user: user('Czyje zaproszenia (domyślnie: Twoje)') }),
    top: C('ranking', '10 osób, które zaprosiły najwięcej członków'),
  }),
  lockdown: C('zablokuj', 'Zablokuj serwer: członkowie nie piszą, nie reagują i nie wchodzą na głosowe do /odblokuj', {
    reason: C('powod', 'Widoczny w komunikacie o blokadzie, np. „Trwa raid”'),
  }),
  panel: C('panel', 'Wyślij panel (tickety, sklep, opinie, weryfikacja…) na kanał', {
    type: C('typ', 'Który panel?', {}, {
      tickets: '🎫 Panel ticketów', shop: '🛒 Katalog sklepu', vouches: '⭐ Panel opinii', leaderboard: '🏆 Ranking', verify: '✅ Weryfikacja', roles: '🎭 Role i powiadomienia',
    }),
    channel: C('kanal', 'Kanał docelowy (domyślnie ten)'),
    banner: C('baner', 'Dodać nad nim pasujący baner? (domyślnie: tak)'),
    style: C('styl', 'Układ panelu ticketów', {}, { buttons: 'Karty z przyciskami', select: 'Lista rozwijana' }),
  }),
  product: C('produkt', 'Zarządzaj produktami w sklepie (admini i sprzedawcy)', {
    add: C('dodaj', 'Dodaj produkt do sklepu', {
      name: C('nazwa', 'Nazwa produktu'),
      price: C('cena', 'Cena – sama liczba, np. 20 albo 9.99, pokaże się jako 20€ / 9.99€'),
      description: C('opis', 'Krótki opis'),
      emoji: C('emoji', 'Emoji obok nazwy (opcjonalnie)'),
      stock: C('stan', 'Stan magazynu (domyślnie: dostępny)', {}, STOCK),
      announce: C('ogloszenie', 'Ogłosić go na kanale z dostawami z pingiem? (domyślnie: tak)'),
      category: C('kategoria', 'Kategoria w sklepie, np. Pluginy albo 🧩 Pluginy (wybierz lub wpisz nową)'),
      image: C('obrazek', 'Obrazek produktu – PNG, JPG, WEBP lub GIF, do 1 MB'),
      count: C('ilosc', 'Ile masz sztuk – widać „zostało 12”, odlicza się z każdym zamówieniem'),
      file: C('plik', 'Sam produkt – wysyłany kupującemu po płatności (więcej plików: /produkt dostawa)'),
      delivery_text: C('tekst-dostawy', 'Tekst dla kupującego po płatności, np. klucz albo dane logowania'),
      delivery_time: C('czas-dostawy', 'Ile kupujący czeka: od ręki, 1–7 dni albo do 14 dni', {}, DELIVERY),
    }),
    edit: C('edytuj', 'Edytuj produkt', {
      product,
      name: C('nazwa', 'Nowa nazwa'),
      price: C('cena', 'Nowa cena'),
      description: C('opis', 'Nowy opis'),
      emoji: C('emoji', 'Nowe emoji'),
      category: C('kategoria', 'Nowa kategoria – albo „none”, żeby ją usunąć'),
      image: C('obrazek', 'Nowy obrazek – PNG, JPG, WEBP lub GIF, do 1 MB'),
      remove_image: C('usun-obrazek', 'Usuń obrazek produktu'),
      stock: C('stan', 'Nowy stan – sam (bez ilości) wyłącza licznik sztuk', {}, STOCK),
      count: C('ilosc', 'Ile sztuk zostało – ustawia stan, odlicza się z każdym zamówieniem'),
      delivery_time: C('czas-dostawy', 'Ile kupujący czeka: od ręki, 1–7 dni albo do 14 dni', {}, DELIVERY),
    }),
    stock: C('stan', 'Zmień stan magazynu albo ustaw liczbę sztuk', {
      product,
      status: C('status', 'Stan – sam (bez ilości) wyłącza licznik sztuk', {}, STOCK),
      count: C('ilosc', 'Ile sztuk zostało – ustawia stan (0 = wyprzedany), odlicza się z zamówieniami'),
      announce: C('ogloszenie', 'Ogłosić dostawę na kanale z dostawami? (domyślnie: tak)'),
    }),
    variants: C('warianty', 'Warianty z własną ceną, np. 1 / 3 / 12 miesięcy', {
      product,
      variants: C('warianty', '„1 miesiąc = 5, 3 miesiące = 12” – do 10, oddziel , albo ; – „none” usuwa'),
    }),
    delivery: C('dostawa', 'Co kupujący dostaje po płatności: pliki i/lub tekst – wysyłane automatycznie', {
      product,
      file: C('plik', 'Plik dla kupującego (ta sama nazwa = podmiana)'),
      file2: C('plik2', 'Kolejny plik'),
      file3: C('plik3', 'Kolejny plik'),
      file4: C('plik4', 'Kolejny plik'),
      file5: C('plik5', 'Kolejny plik'),
      text: C('tekst', 'Tekst dla kupującego, np. klucz albo login – „none” go usuwa'),
      clear: C('wyczysc', 'Najpierw usuń wszystkie pliki i tekst'),
    }),
    remove: C('usun', 'Usuń produkt', { product }),
    list: C('lista', 'Lista wszystkich produktów'),
  }),
  promo: C('kod', 'Kody rabatowe w sklepie (admini i sprzedawcy)', {
    create: C('utworz', 'Utwórz kod rabatowy – podaj procent ALBO kwotę rabatu', {
      code: C('kod', 'Kod, który wpisują kupujący, np. HS10 (3–24 litery, cyfry, - i _)'),
      percent: C('procent', 'Rabat w procentach (1–100)'),
      amount: C('kwota', 'Stała kwota rabatu'),
      expires_in_days: C('waznosc-dni', 'Ile dni jest ważny (domyślnie: bez końca)'),
      max_uses: C('limit-uzyc', 'Ile zamówień łącznie może go użyć (domyślnie: bez limitu)'),
      once_per_user: C('raz-na-osobe', 'Każdy może go użyć tylko raz (domyślnie: tak)'),
      first_order_only: C('tylko-pierwsze', 'Tylko dla osób, które jeszcze nic nie kupiły (domyślnie: nie)'),
    }),
    list: C('lista', 'Wszystkie kody rabatowe z użyciami i datą ważności'),
    info: C('info', 'Szczegóły i ostatnie użycia jednego kodu', { code: C('kod', 'Kod') }),
    delete: C('usun', 'Usuń kod – od razu przestaje działać', { code: C('kod', 'Kod') }),
  }),
  reply: C('odpowiedz', 'Wyślij gotową odpowiedź w tickecie (zespół)', { snippet: C('szablon', 'Którą odpowiedź wysłać?') }),
  sale: C('promocja', 'Promocje błyskawiczne – procent taniej na produkt przez jakiś czas (admini i sprzedawcy)', {
    start: C('start', 'Przecenić produkt – sklep pokaże starą i nową cenę z odliczaniem', {
      product,
      percent: C('procent', 'Rabat w procentach (1–90)'),
      duration: C('czas', 'Jak długo, np. 30m, 2h, 1d albo 1h30m (do 7 dni)'),
      announce: C('ogloszenie', 'Ogłosić ją na kanale z dostawami z pingiem? (domyślnie: tak)'),
    }),
    stop: C('stop', 'Zakończ promocję teraz', { product: C('produkt', 'Przeceniony produkt') }),
    list: C('lista', 'Produkty przecenione w tej chwili'),
    deal: C('okazja', 'Okazja tygodnia – plan na ten tydzień albo start od razu', { now: C('teraz', 'Uruchomić okazję teraz na losowym produkcie? (domyślnie: tylko pokaż plan)') }),
  }),
  sales: C('sprzedaz', 'Przychód, zamówienia, najlepsze produkty, sprzedawcy i rabaty (admini i sprzedawcy)', {
    period: C('okres', 'Zakres czasu (domyślnie: ostatnie 7 dni)', {}, { today: 'Dziś', '7d': 'Ostatnie 7 dni', '30d': 'Ostatnie 30 dni', all: 'Od początku' }),
  }),
  setup: C('ustawienia', 'Ustawienia ticketów (wszystko ustawia /zbuduj)', {
    set: C('zmien', 'Zmień ustawienia (wypełnij tylko te, które chcesz zmienić)', {
      category: C('kategoria', 'Kategoria dla otwartych ticketów'),
      closed_category: C('kategoria-zamkniete', 'Kategoria dla zamkniętych ticketów'),
      log_channel: C('kanal-logow', 'Kanał z logami ticketów'),
      transcript_channel: C('kanal-transkrypcji', 'Kanał z transkrypcjami'),
      limit: C('limit', 'Maks. otwartych ticketów na osobę (0 = bez limitu)'),
      auto_close_hours: C('autozamkniecie-h', 'Zamknij po tylu godzinach bez odpowiedzi autora (0 = wyłączone)'),
      warning_hours: C('ostrzezenie-h', 'Ostrzeż przed zamknięciem po tylu godzinach (0 = wyłączone)'),
      ping_staff: C('ping-zespolu', 'Pingować role pomocy przy otwarciu ticketu?'),
    }),
    'role-add': C('dodaj-role', 'Dodaj rolę, która obsługuje tickety', { role: C('rola', 'Rola') }),
    'role-remove': C('usun-role', 'Usuń rolę obsługującą tickety', { role: C('rola', 'Rola') }),
    show: C('pokaz', 'Pokaż aktualne ustawienia'),
  }),
  shop: C('sklep', 'Otwórz lub zamknij sklep – widać to na kanale statusu, w sklepie i panelu ticketów', {
    open: C('otworz', 'Otwórz sklep teraz, także poza godzinami pracy (do /sklep auto)'),
    close: C('zamknij', 'Zamknij sklep teraz, także w godzinach pracy (do /sklep auto)'),
    auto: C('auto', 'Wróć do godzin pracy (config.json → workingHours)'),
    status: C('status', 'Pokaż, czy sklep jest otwarty, godziny pracy i następną zmianę'),
  }),
  stats: C('statystyki', 'Statystyki ticketów i pomocy (zespół)', {
    staff: C('osoba', 'Statystyki konkretnej osoby z zespołu'),
    days: C('dni', 'Zakres w dniach (domyślnie: od początku)'),
  }),
  ticket: C('ticket', 'Zarządzaj ticketem na tym kanale', {
    add: C('dodaj', 'Dodaj kogoś do ticketu', { user: user('Kogo dodać') }),
    remove: C('usun', 'Usuń kogoś z ticketu', { user: user('Kogo usunąć') }),
    claim: C('przejmij', 'Przejmij ten ticket'),
    unclaim: C('oddaj', 'Przestań obsługiwać ten ticket'),
    close: C('zamknij', 'Zamknij ticket', { reason: C('powod', 'Powód zamknięcia') }),
    priority: C('priorytet', 'Ustaw priorytet ticketu', {
      level: C('poziom', 'Poziom priorytetu', {}, { low: '🟢 Niski', normal: '🟣 Normalny', high: '🟠 Wysoki', urgent: '🔴 Pilny' }),
    }),
    rename: C('nazwa', 'Zmień nazwę kanału ticketu', { name: C('nazwa', 'Nowa nazwa') }),
    move: C('przenies', 'Przenieś ticket do innej kategorii', { category: C('kategoria', 'Nowa kategoria') }),
    'request-close': C('prosba-zamkniecia', 'Poproś autora o potwierdzenie, że sprawa jest załatwiona'),
    complete: C('zrealizuj', 'Oznacz zakup jako dostarczony (zapisuje sprzedaż, daje rolę Klient)', {
      amount: C('kwota', 'Kwota zapłacona przez klienta (domyślnie: suma zamówienia, jeśli znana)'),
    }),
    info: C('info', 'Informacje o tickecie'),
  }),
  unlock: C('odblokuj', 'Zdejmij blokadę i oddaj członkom uprawnienia (moderatorzy)'),
  vouch: C('opinia', 'Wystaw opinię po zakupie', {
    rating: C('ocena', 'Twoja ocena', {}, { 5: '⭐⭐⭐⭐⭐ Świetnie', 4: '⭐⭐⭐⭐ Dobrze', 3: '⭐⭐⭐ W porządku', 2: '⭐⭐ Słabo', 1: '⭐ Źle' }),
    product: C('produkt', 'Co kupiłeś?'),
    review: C('tresc', 'Twoja opinia – dostawa, jakość, obsługa…'),
    proof: C('zrzut', 'Zrzut ekranu (opcjonalnie)'),
  }),
};

// ───────────── English → Polish (for Discord) ─────────────

function localizeOption(json, node) {
  if (!node) return json;
  const out = { ...json, name: node.name ?? json.name, description: node.description ?? json.description };
  if (Array.isArray(json.choices) && node.choices) out.choices = json.choices.map((c) => ({ ...c, name: node.choices[c.value] ?? c.name }));
  if (Array.isArray(json.options)) out.options = json.options.map((o) => localizeOption(o, node.options?.[o.name]));
  return out;
}

/** A command's JSON (command.data.toJSON()) with the Polish names, descriptions and choices – what Discord gets. */
const localizeCommand = (json) => localizeOption(json, MAP[json.name]);

// ───────────── Polish → English (for the code) ─────────────

function reverseOf(node, en) {
  const opts = new Map();
  for (const [childEn, child] of Object.entries(node.options ?? {})) opts.set(child.name, reverseOf(child, childEn));
  return { en, opts };
}
const REVERSE = new Map(Object.entries(MAP).map(([en, node]) => [node.name, reverseOf(node, en)]));

function renameOptions(list, node) {
  return (list ?? []).map((o) => {
    const child = node?.opts.get(o.name);
    return { ...o, name: child?.en ?? o.name, ...(Array.isArray(o.options) ? { options: renameOptions(o.options, child) } : {}) };
  });
}

/**
 * A slash command or autocomplete interaction used with the Polish names → the English names the commands use.
 * Interactions that already use the English names (e.g. in tests) are left as they are.
 */
function unlocalize(interaction) {
  const node = REVERSE.get(interaction?.commandName);
  if (!node || node.en === interaction.commandName && !node.opts.size) return interaction;
  interaction.commandName = node.en;
  const options = interaction.options;
  if (options && Array.isArray(options.data)) {
    interaction.options = new CommandInteractionOptionResolver(interaction.client, renameOptions(options.data, node), options.resolved);
  }
  return interaction;
}

/**
 * "/produkt dodaj" for slash('product add') – for texts that tell people which command to use.
 * Unknown parts stay as they are.
 */
function slash(path) {
  const parts = String(path).trim().split(/\s+/);
  let node = { options: MAP };
  const out = parts.map((part) => {
    const next = node?.options?.[part];
    node = next;
    return next?.name ?? part;
  });
  return `/${out.join(' ')}`;
}

module.exports = { MAP, localizeCommand, unlocalize, slash };
