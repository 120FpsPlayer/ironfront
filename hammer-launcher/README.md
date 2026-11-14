# Hammer Launcher

Launcher Minecrafta: Java Edition od **HammerShop**. Interfejs jest po polsku, a dla graczy spoza Polski także po angielsku – patrz [Wersja angielska](#wersja-angielska).

- **Graj jednym kliknięciem.** Launcher sam pobiera grę, właściwą Javę (8 / 17 / 21…) i loader modów.
- **Instancje.** Każda instancja ma własne mody, światy i ustawienia. Do wyboru Vanilla, Fabric, Quilt, Forge i NeoForge, dowolna wersja gry.
- **Optymalizacja** (zakładka *Optymalizacja*):
  - RAM dobrany do komputera i liczby modów (nigdy więcej niż połowa pamięci i maks. 12 GB),
  - flagi Javy dobrane do Javy, na której naprawdę działa instancja (8, 17, 21 albo 25): dostrojony G1GC albo ZGC dla mocnych PC, w Javie 25 mniejsze obiekty w pamięci, większa pamięć na skompilowany kod przy dużej liczbie modów. Przycisk **Pokaż flagi** pokazuje dokładnie, z czym ruszy gra,
  - mody wydajnościowe w dwóch zestawach: **Podstawowe** (Sodium / Embeddium, Lithium, FerriteCore, ModernFix, Entity Culling, ImmediatelyFast, More Culling, Dynamic FPS, Krypton, BadOptimizations…) i opcjonalne **Turbo** dla mocnych procesorów (C2ME, ScalableLux, ThreadTweak, Ksyxis, Fast IP Ping), do tego Iris do shaderów. Launcher sam sprawdza, co istnieje dla danej wersji gry i loadera,
  - presety grafiki *Słaby komputer*, *Maks. FPS*, *Zrównoważony* i *Jakość* (zmieniają `options.txt`, działają też z nowymi ustawieniami grafiki od Minecrafta 1.21.11),
  - podpowiedź dobrana do RAM-u, procesora i karty graficznej – przycisk **Dlaczego?** wyjaśnia każdy wybór,
  - wyższy priorytet procesu gry (dla wszystkich instancji albo osobno dla jednej),
  - wymuszenie wydajnej karty graficznej na laptopach (Windows),
  - przycisk **Zoptymalizuj wszystko**, który robi to naraz i na koniec pokazuje, co dokładnie zrobił,
  - **Test FPS**: launcher uruchamia grę w Twoim świecie, Hammer Client mierzy klatki i gra zamyka się sama – wynik widać obok poprzedniego („+38% średnio”). Szczegóły w sekcji [Test FPS](#test-fps).
- **Mody** (zakładka *Mody*): wyszukiwarka Modrinth z modami, paczkami tekstur, shaderami i paczkami modów. Ma kategorie i sortowanie, a zależności instalują się same. Do tego lista zainstalowanych z włączaniem i wyłączaniem, przeciąganie plików `.jar` / `.zip` i import paczek `.mrpack`. **Aktualizacje** launcher sprawdza sam w tle, a każdą da się cofnąć – patrz [Aktualizacje modów i droga powrotna](#aktualizacje-modów-i-droga-powrotna).
- **Zestawy modów** (*Mody → Zestawy*): gotowe zestawy na jedno kliknięcie – *PvP*, *Survival+*, *Budowanie*, *Shadery* oraz *Wygląd i klimat*. Przy każdym dodatku widać, czy istnieje dla wybranej instancji i czy już jest zainstalowany. W zestawach są tylko dodatki, które nie dają przewagi nad innymi graczami.
- **Skórka** (zakładka *Skórka*): podgląd postaci z przodu i z tyłu, wgranie nowej skórki (PNG 64×64, model klasyczny albo smukły), powrót do domyślnej oraz **Peleryny** – jedna siatka: peleryny konta od Mojang, peleryny Hammer (**Hammer** i **Żar** za darmo, pozostałe ciemne z kłódką – Hammer+) i własna peleryna (Hammer+), plus przełącznik **Wł./Wył.** Założona peleryna jest widoczna na podglądzie postaci od tyłu. Każda skórka, którą nosisz, trafia do biblioteki w launcherze, więc wrócisz do niej jednym kliknięciem. Zmiany idą prosto na konto Microsoft – bez wchodzenia na minecraft.net.
- **Serwery** (zakładka *Serwery*): lista serwerów instancji – ta sama, którą widzisz w grze (`servers.dat`). Przy każdym serwerze status na żywo: gracze, ping, wersja i opis. Dodawanie ze sprawdzeniem adresu, zmiana kolejności i przycisk **Graj**, który uruchamia grę od razu na wybranym serwerze. Lista serwerów nie jest częścią konta Microsoft, tylko plikiem w folderze gry, więc launcher **przenosi serwery ze zwykłego Minecrafta** (z oficjalnego launchera): raz automatycznie dla każdej instancji, a potem przyciskiem **Z Minecrafta** (dodaje tylko te, których jeszcze nie ma). Do tego **zaproszenia** – link, który znajomy klika, a launcher sam przygotowuje mu instancję i serwer – oraz karta **Polecane serwery**. Szczegóły w sekcji [Zaproszenia](#zaproszenia-hammerjoin).
- **Światy** (zakładka *Światy*): światy jednoosobowe instancji z trybem gry, wersją, datą ostatniej gry i rozmiarem. **Graj** otwiera wybrany świat od razu po starcie (Minecraft 1.20+). Kopie zapasowe do plików `.zip` w folderze `backups/` instancji (tam, gdzie zapisuje je też sama gra), przywracanie jako nowy świat (*Jako nowy świat* – niczego nie nadpisuje), z Hammer+ także **w miejsce świata** (*Przywróć wczorajszą wersję*, *Inna wersja…* – patrz [Hammer+](#hammer)), zmiana nazwy i usuwanie do kosza systemowego. Przycisk **Z Minecrafta** kopiuje światy ze zwykłego Minecrafta – patrz [Światy i ustawienia ze zwykłego Minecrafta](#światy-i-ustawienia-ze-zwykłego-minecrafta).
- **Udostępnianie instancji** (menu instancji → *Udostępnij*, *Instancje → Z kodu lub pliku*): instancja jako kod do wklejenia albo plik `.hammerpack` – znajomy dostaje taką samą, bez wysyłania żadnych plików. Szczegóły w sekcji [Udostępnianie instancji](#udostępnianie-instancji).
- **Konsola.** Logi gry na żywo. Gdy gra się wyłączy, launcher wyjaśnia po polsku, co się stało i co zrobić (brak RAM, zła Java, niezgodne lub zdublowane mody, sterowniki…). Przycisk **Wyślij logi** wrzuca log na [mclo.gs](https://mclo.gs) i daje link do wklejenia na Discordzie – token logowania jest wcześniej usuwany.
- **Miejsce na dysku** (w *Ustawieniach*): ile zajmują instancje, pliki gry i Java oraz sprzątanie jednym kliknięciem – stare logi i raporty crashy, pamięć podręczna, wersje gry i Javy, z których nie korzysta żadna instancja.
- **Napraw instancję** (menu instancji): przy następnym starcie launcher instaluje loader od nowa i sprawdza wszystkie pliki gry. Światy, mody i ustawienia zostają.
- **Sieci z serwerem proxy.** Gdy system ma ustawione `HTTPS_PROXY` / `HTTP_PROXY` (szkoła, firma), launcher pobiera przez proxy – bez tego wyglądałby na „brak internetu”.
- **Konta Microsoft.** Logowanie przez oficjalne okno Microsoftu. Tokeny są szyfrowane przez system (Windows DPAPI / pęk kluczy), a hasła launcher nigdy nie widzi.
- **Hammer Client – menu w grze jak w Lunar Client.** W instancjach Fabric i Quilt launcher sam dodaje nasz mod – dla każdej wersji Minecrafta od 1.21 do 26.3 ma osobny plik i wybiera właściwy (zmienisz wersję gry w instancji – launcher podmieni mod):
  - własne menu główne,
  - panel modułów pod prawym Shiftem: 55 modułów z własnymi ustawieniami, profile, kolor akcentu,
  - HUD z edytorem (FPS i wykres FPS, CPS, klawisze, koordynaty, kompas, pancerz, efekty, cel z paskiem życia, licznik przedmiotów, przedmiot w ręce, doświadczenie, ping, TPS, gracze online…),
  - znaczek **H** przed nickiem graczy Hammer Client na liście graczy (Tab) – i **H+** dla Hammer+,
  - zoom pod C, freelook, przełączany sprint, własny celownik, fullbright, własna pora dnia i pogoda,
  - przyciski Hammer Mody i Discord w menu pauzy.

  Włączasz i wyłączasz go w edytorze instancji. Kod moda jest w folderze `hammer-client/`. Launcher bierze go z folderu `resources/hammer-client/` (plik `versions.json` i po jednym `.jar` na wersję gry) – tworzy go `./gradlew dist` w `hammer-client/` (wynik w `hammer-client/build/dist/`). Lista obsługiwanych wersji pochodzi z `versions.json`, więc nowa wersja moda nie wymaga zmian w launcherze.
- **Nasz Discord.** Karta na ekranie głównym i przycisk w menu: nazwa i ikona serwera, ile osób jest online i ilu jest członków, przycisk **Dołącz do Discorda**. Dane pochodzą z publicznego API zaproszeń Discorda (bez tokenu bota).
- **Nowości ze sklepu HammerShop.** Produkty, ceny i obrazki prosto ze strony bota (`/api/shop/store`) – zmienisz coś w bocie, launcher pokaże to sam.
- **Galeria.** Zrzuty ekranu (F2) ze wszystkich instancji: podgląd na pełnym ekranie, kopiowanie do schowka (np. żeby wkleić na Discorda), pokazanie w folderze, usuwanie – oraz **Udostępnij link**, czyli zrzut jako link do wklejenia (po Twojej zgodzie, patrz [Zrzut ekranu jako link](#zrzut-ekranu-jako-link)).
- **Podsumowanie gry.** Po wyjściu z gry ekran *Graj* pokazuje, ile trwała sesja, ile łącznie grasz w tej instancji i jakie zrzuty ekranu zrobiłeś – patrz [Podsumowanie gry](#podsumowanie-gry).
- **Zasobnik.** Podczas gry launcher chowa się do zasobnika obok zegara. Stamtąd możesz go przywrócić albo zatrzymać grę.
- **Kolor launchera** (w *Ustawieniach*): pomarańczowy, złoty, czerwony, niebieski, zielony albo fioletowy.
- **Hammer+** (złoty przycisk na górnym pasku): płatny dodatek – własne kolory i tła, automatyczne kopie światów, zestawy skórek, peleryny i chmura. Sam wygląd i wygoda, nic, co zmienia rozgrywkę. Szczegóły w sekcji [Hammer+](#hammer).
- Aktualności, status w Discordzie (z przyciskami *Dołącz do Discorda* i *Sklep*) oraz opcjonalnie status serwera Minecraft z przyciskiem **Dołącz**, jeśli kiedyś będziecie mieli własny serwer.

> Do gry potrzebne jest konto Microsoft z kupionym Minecraftem: Java Edition. Launcher **nie ma** kont offline / „non-premium”, i to celowo.

## Hammer+

Hammer+ to płatny dodatek do launchera. Daje **wygląd i wygodę** – nic, co zmienia rozgrywkę albo daje przewagę nad innymi graczami. Wszystko, co do tej pory było w launcherze za darmo, zostaje za darmo. Rangi na Discordzie i wcześniejszy dostęp **nie** są częścią Hammer+.

Na górnym pasku jest złoty przycisk **Hammer+** – prowadzi do strony z opisem, miejscem na kod i przyciskiem *Kup w sklepie*. Gdy Hammer+ jest aktywny, przycisk jest wypełniony złotem, a przy nicku konta pojawia się złoty „+”. Funkcje Hammer+ są w swoich zakładkach oznaczone złotą kłódką; kliknięcie w zablokowaną funkcję otwiera stronę Hammer+.

### Co daje

- **Własny kolor launchera** (*Ustawienia → Wygląd*): dowolny kolor, nie tylko 6 gotowych. Kolor za ciemny na ciemne tło launcher sam rozjaśnia, żeby napisy i przyciski zostały czytelne – i mówi o tym.
- **Motywy launchera** (*Ustawienia → Wygląd → Motyw*): *Nether* (lawa, żar i popiół), *End* (fiolet pustki, gwiazdy, blask prętów Endu), *Ocean* (pryzmaryn, bąbelki, światło z góry), *Wiśniowy gaj* (spadające płatki) i *Głęboki mrok* (pulsujący sculk). Motyw ustala wszystkie kolory okna i daje ruchome tło za całym launcherem – pasek boczny i karty lekko je przepuszczają. Kafelki w ustawieniach pokazują żywy podgląd; bez Hammer+ są przyciemnione z kłódką. Przy motywie kolor launchera, animowane tło Graj i własne tło odpoczywają (wracają z motywem *Domyślny*). Tło to jeden canvas (`src/renderer/js/themefx.js`) z kilkudziesięcioma cząsteczkami: najwyżej 30 klatek na sekundę, ograniczona gęstość pikseli, a stoi, gdy gra działa, gdy okno jest schowane albo od 20 s w tle, gdy system ma ograniczone animacje i gdy gracz wyłączy *Ruchome tło* (kolory zostają). Kolory i światła motywów są w `src/renderer/js/themes.js`; `test/themes.test.js` sprawdza, że każdy napis ma kontrast WCAG AA także w najjaśniejszym miejscu tła. Ustawienia: `theme` (`default` | `nether` | `end` | `ocean` | `cherry` | `deepdark`, Hammer+) i `themeMotion` (za darmo).
- **Animowane tła**: *Zorza*, *Kuźnia* i *Gwiazdy* – na ekranie Graj i delikatnie za pozostałymi stronami. To czysty CSS; gdy system ma ograniczone animacje, tło stoi w miejscu.
- **Własne tło launchera**: obraz PNG, JPG albo WebP (do 12 MB). Launcher kopiuje go do swojego folderu (`theme/`) i pokazuje przyciemniony za stronami.
- **Tło menu w grze**: własny obraz za menu Hammer Client. Launcher zmniejsza go do najwyżej 1920×1080 (PNG) i przy starcie gry wkłada do instancji jako `config/hammerclient/menu.png`. W grze wybierz: *Hammer Mody → Ustawienia → Tło menu → Własny obraz*. Bez Hammer+ (albo po usunięciu obrazu) launcher przy następnym starcie zabiera swój plik – obrazu, który gracz włożył tam sam, nie rusza.
- **Automatyczne kopie światów** (*Światy* albo *Ustawienia*, z Hammer+ włączone od razu): po każdej grze – także po crashu – launcher pakuje światy, w których grałeś, do `backups/<świat>-<data>-auto.zip`. Z automatycznych kopii każdego świata zostaje 5 najnowszych (ustawisz od 1 do 20) **i** najnowsza z każdego z ostatnich 7 dni kalendarzowych (czas lokalny, dziś też się liczy) – „wczorajsza wersja” przetrwa więc nawet dziesięć sesji dzisiaj. Kopii zrobionych ręcznie i kopii samej gry nigdy nie usuwa. Kopia nie rusza, gdy gra tej instancji działa, a w jej trakcie nie da się uruchomić tej instancji. Ustawienie `autoBackup` ma domyślnie `true` (działa tylko z Hammer+); plik ustawień sprzed 2.10 (bez `settingsVersion`) dostaje je włączone raz – kto wyłączy je potem, ma je wyłączone.
- **Przywróć wczorajszą wersję** (*Światy*, przy każdym świecie): jednym kliknięciem świat wraca do najnowszej automatycznej kopii sprzed dzisiejszej północy – w tym samym folderze, więc gra pokazuje ten sam świat. Gdy najnowsza taka kopia jest starsza niż wczorajsza, przycisk podaje jej dzień (*Przywróć wersję z 10 listopada*); gdy nie ma żadnej – przycisku nie ma. **Inna wersja…** pokazuje wszystkie kopie świata pogrupowane po dniach (*Dziś*, *Wczoraj*, daty) z godziną i rozmiarem. Przed każdym przywróceniem okno podaje dokładny dzień i godzinę, a obecny stan świata launcher pakuje do `backups/<świat>-<data>-przed-przywroceniem.zip` – przycisk **Cofnij** (w komunikacie po przywróceniu i przy takiej kopii na liście) przywraca go tak samo, także bez Hammer+. Te kopie zostają co najmniej 7 dni, a najnowsza z każdego świata zawsze. Nie działa, gdy gra tej instancji jest uruchomiona. Zamiana jest bezpieczna: kopia rozpakowuje się do ukrytego folderu w `saves/` i musi mieć czytelny `level.dat`, potem dwie zmiany nazwy folderów (stary świat na bok, nowy na jego miejsce) i dopiero wtedy stary jest usuwany. Notatka w `<instancja>/.hammer/przywracanie-swiatow/` pozwala dokończyć albo cofnąć zamianę przerwaną np. wyłączeniem prądu (przy liście światów i przed startem gry) – w folderze jest zawsze stary albo nowy świat, nigdy nic. Bez Hammer+ przyciski są przygaszone z kłódką; kopie ręczne i *Jako nowy świat* zostają za darmo. Moduły: `worlds.js` (`restoreInPlace`, `recoverSwaps`), `autobackup.js` (`prune`, `previousVersion`).
- **Biblioteka na 200 skórek** (bez Hammer+: 24). Gdy Hammer+ się skończy, launcher niczego od razu nie wyrzuca – nowa skórka wypycha wtedy tylko jedną najstarszą.
- **Zestawy** (*Skórka*): skórka + model postaci + peleryna konta pod jedną nazwą, np. „Na PvP”. Zakładasz wszystko jednym kliknięciem; launcher wysyła do Mojang tylko to, co się naprawdę zmienia.
- **Peleryny Hammer+** (*Skórka*): 4 peleryny Hammer+ (Złota, Królewska, Mróz, Karmazyn) – 2 pozostałe (Hammer, Żar) są dla wszystkich (`src/renderer/assets/capes/`, pole `free`). Rysuje je Hammer Client, więc widzisz je Ty i gracze, którzy też mają Hammer Client. **W zwykłym Minecrafcie ich nie widać.**
- **Własna peleryna** (*Skórka*, Hammer+): obrazek PNG w układzie peleryny Minecrafta (64×32 albo wielokrotność, do 512 KB). Launcher kopiuje go do instancji jako `config/hammerclient/cape.png` i Hammer Client rysuje go na Twojej postaci – widzisz ją tylko Ty, obrazek nie wychodzi z komputera.
- **Chmura**: wygląd launchera, lista serwerów (nazwa i adres) oraz układ HUD (`config/hammerclient.json`) każdej instancji – na każdym Twoim komputerze. Instancje są dopasowywane po nazwie. Przyciski **Wyślij do chmury** i **Pobierz z chmury**, czas ostatniej kopii, a opcjonalnie synchronizacja automatyczna (pobranie przy starcie launchera, wysłanie po każdej grze). Gdy w chmurze leży nowsza kopia z innego komputera, launcher niczego nie nadpisuje, tylko pyta, którą zostawić. Kopia ma limit 256 KB, a instancji, której gra właśnie działa, launcher nie rusza. Światy, mody i konta do chmury nie trafiają.

### Jak działa kod

1. Gracz kupuje Hammer+ w sklepie HammerShop, a bot na Discordzie wysyła mu **kod przypisany do jego konta Minecraft**.
2. Gracz wkleja kod na stronie Hammer+ (*Mam kod → Wklej → Aktywuj*).
3. Launcher sprawdza kod **sam, bez internetu**: kod jest podpisany kluczem sklepu (Ed25519), a launcher ma klucz publiczny w `launcher.config.json` (`plusPublicKey`).

Kod ma postać `HP1.<dane>.<podpis>`. `<dane>` to base64url z JSON-em `{"id":"…","mc":"<UUID konta Minecraft, 32 znaki>","exp":<koniec ważności, sekundy uniksowe; 0 = bez końca>,"iat":<data wydania>}`, a `<podpis>` to base64url podpisu Ed25519 tekstu `HP1.<dane>`.

Kod działa, gdy podpis się zgadza, kod nie wygasł **i** jest dla konta Microsoft wybranego w launcherze. Po przełączeniu konta albo gdy kod wygaśnie przy otwartym launcherze, Hammer+ od razu się wyłącza (albo włącza – launcher pamięta po jednym kodzie na konto). Gdy coś nie pasuje, launcher mówi po polsku, co: zły kod, kod po terminie, kod dla innego konta (z oboma nickami) albo brak klucza w tej wersji launchera.

Kody leżą w `plus.json` w folderze launchera – nie w `settings.json`. Każda funkcja Hammer+ jest sprawdzana w procesie głównym launchera, a nie tylko chowana w oknie: wywołanie zablokowanej funkcji kończy się polskim komunikatem. Ustawienia zrobione z Hammer+ zostają zapisane po jego końcu, ale nie działają, dopóki nie wróci; wyłączyć można je zawsze.

Puste `plusPublicKey` oznacza, że w tej wersji launchera Hammer+ nie da się aktywować (strona Hammer+ to mówi).

### Co wymaga sklepu online

Kod, kolory, tła, automatyczne kopie, biblioteka skórek i zestawy działają **bez** strony sklepu. Strona jest potrzebna tylko do dwóch rzeczy:

- **Chmura** – kopia leży na stronie sklepu (`<shopApi albo website>/api/launcher/cloud`),
- **pokazanie Twojej peleryny Hammer innym graczom** (`…/api/launcher/cape`) – z Hammer+ potwierdza ją kod, a darmową (Hammer, Żar) Twoje logowanie Minecraft (strona sprawdza je w Mojang i go nie zapisuje). Ty widzisz swoją pelerynę od razu – wybór idzie do gry w pliku moda.

Dopóki strona nie odpowiada, launcher mówi po prostu „Chmura zadziała, gdy sklep HammerShop będzie online.” Nie blokuje to ani launchera, ani startu gry, a wybraną pelerynę launcher wyśle sam przy następnym starcie gry.

### Dla deweloperów

- Zgłoszenia do sklepu (`src/main/shopapi.js`) mają nagłówek `Authorization: Bearer <kod>`: `GET /cloud` → `{ updatedAt, data }` (404 = nie ma jeszcze kopii), `PUT /cloud` z `{ data, baseUpdatedAt? }` → `{ updatedAt }` (409 → `{ error, updatedAt, data }`, czyli nowsza kopia), `PUT /cape` z `{ cape: "<id>" | null }` → `{ cape }`. Błędy: `{ error: "<tekst po polsku>" }`.
- Plik dla moda `config/hammerclient-launcher.json` (pisany przed każdym startem) ma oprócz `discordUrl`, `shopUrl` i `brand` trzy pola: `plus: { active, until }` (`until` w sekundach uniksowych, 0 = bez końca albo nieaktywny), `cape` (id peleryny: darmowa zawsze, pozostałe i `custom` = własna peleryna tylko z Hammer+; `""` = brak albo przełącznik wyłączony) i `api` (adres API sklepu jak wyżej).
- Moduły: `plus.js` (kod i status), `shopapi.js` + `cloud.js` (chmura), `autobackup.js`, `background.js` (tła), `capes.js`, a w `skins.js` zestawy i limit biblioteki. Kolory własnego motywu liczy `src/renderer/js/theme.js` (ten sam plik ładują testy); motywy launchera to `src/renderer/js/themes.js` (dane i kontrast) i `src/renderer/js/themefx.js` (ruchome tło).

## Światy i ustawienia ze zwykłego Minecrafta

Światy i ustawienia – tak jak lista serwerów – nie są częścią konta Microsoft, tylko plikami w folderze gry. Gdy na komputerze jest zwykły Minecraft (z oficjalnego launchera: `%APPDATA%\.minecraft`, na macOS `~/Library/Application Support/minecraft`, na Linuksie `~/.minecraft`), launcher potrafi je przenieść do instancji. Wszystko to jest za darmo.

- **Światy** (*Światy → Z Minecrafta*): lista światów ze zwykłego Minecrafta z ikoną, nazwą, datą ostatniej gry, rozmiarem i wersją gry (z `level.dat`). Zaznaczasz, które chcesz, a launcher **kopiuje** je do folderu `saves/` wybranej instancji – oryginałów nigdy nie przenosi ani nie usuwa. Gdy świat o takiej nazwie folderu już jest w instancji, kopia dostaje numer: `Nowy świat (2)`. Przy dużych światach widać pasek postępu (w oknie i w pasku bocznym). Świat otwierany ostatnio w **nowszej** wersji gry niż ma instancja jest oznaczony ostrzeżeniem *„Ten świat był otwierany w nowszej wersji gry – może się nie wczytać”* – ostrzeżenie niczego nie blokuje. Kopiowanie nie rusza, gdy gra tej instancji działa, a w jego trakcie nie da się tej instancji uruchomić.
- **Ustawienia** (menu instancji → *Przenieś ustawienia z Minecrafta*): launcher zastępuje `options.txt` instancji plikiem ze zwykłego Minecrafta – klawisze, czułość myszy, grafika, dźwięk, język i lista włączonych paczek zasobów. Poprzedni plik instancji zostaje obok jako `options.txt.przed-importem` (zawsze ten sprzed ostatniego przeniesienia). Okno potwierdzenia mówi wprost, co zostanie nadpisane, a co zostaje. Same pliki paczek zasobów nie są kopiowane – dodaje się je w zakładce *Mody*.
- **Przy nowej instancji** launcher raz, dyskretnie (komunikat w rogu z przyciskiem *Przenieś ustawienia*, który sam znika) proponuje przeniesienie ustawień – tylko wtedy, gdy na komputerze jest zwykły Minecraft z plikiem ustawień.

## Udostępnianie instancji

Instancję można przekazać znajomemu jako **przepis**: nazwa, wersja Minecrafta, loader i jego wersja, dodatki z Modrinth (mody, paczki zasobów, shadery – numer projektu, numer wersji i nazwa pliku), to, czy włączony jest Hammer Client, lista serwerów (tylko nazwa i adres) oraz – jeśli zechcesz – `options.txt`. **Żadne pliki nie są nigdzie wysyłane**: launcher znajomego pobiera dodatki z Modrinth po ich numerach.

- **Eksport** (menu instancji → *Udostępnij*): okno pokazuje, co jest w przepisie, a czego w nim **nie** ma – pliki, które nie pochodzą z Modrinth, są wymienione z nazwy jako *„Nie da się udostępnić – dodaj ręcznie”*. (Mody dodane ręcznie, które Modrinth rozpoznaje po sumie kontrolnej, trafiają do przepisu.) Do wyboru są:
  - **plik** `<nazwa>.hammerpack` (czytelny JSON),
  - **kod** do skopiowania: `HL1.` + base64url z JSON-a spakowanego algorytmem deflate – tylko gdy kod ma najwyżej **6000 znaków**. Przy większej instancji okno proponuje sam plik i mówi dlaczego.
- **Import** (*Instancje → Z kodu lub pliku*, albo upuszczenie pliku `.hammerpack` na okno launchera): wklejasz kod albo wybierasz plik → podgląd (nazwa, wersja gry, loader, liczba modów, serwery) → *Utwórz instancję*. Launcher tworzy **nową** instancję i pobiera dodatki zwykłą drogą z Modrinth, z paskiem postępu. Dodatki, których już nie ma na Modrinth, są wymienione na końcu – reszta instaluje się normalnie.

Przepis w pliku wygląda tak:

```json
{
  "format": "hammerpack",
  "v": 1,
  "name": "Survival z ekipą",
  "mc": "1.21.1",
  "loader": "fabric",
  "loaderVersion": "0.16.10",
  "hammerClient": true,
  "content": [{ "type": "mod", "project": "AANobbMI", "version": "SMxNOGZ6", "file": "sodium-fabric-0.8.13+mc1.21.1.jar" }],
  "servers": [{ "name": "HammerShop", "address": "mc.hammershop.pl" }],
  "options": "…treść options.txt, tylko gdy ją dołączono…"
}
```

`type` to `mod`, `resourcepack` albo `shader`; wyłączony dodatek ma dodatkowo `"off": true`; `loaderVersion` równe `null` oznacza „najnowsza zalecana”.

**Kod i plik to dane z zewnątrz – launcher im nie ufa:**

- wszystko przechodzi ścisłą kontrolę: nazwa do 48 znaków, najwyżej 500 dodatków i 100 serwerów, numery w formacie Modrinth, loader z listy znanych, adresy serwerów tylko w postaci `host` albo `host:port`, `options.txt` jako zwykły tekst do 64 KB; nieznane pola są pomijane,
- wersja gry i wersja loadera muszą istnieć na prawdziwych listach wersji (wersja loadera, której już nie ma, jest zastępowana najnowszą zalecaną – podgląd o tym mówi),
- kod dłuższy niż 6000 znaków jest odrzucany przed rozpakowaniem, a rozpakowywanie zatrzymuje się na 2 MB („bomba zip” nic nie zrobi); plik może mieć najwyżej 2 MB,
- żadna ścieżka ani adres z przepisu nie służy do zapisu ani pobierania: pliki pochodzą wyłącznie z Modrinth, po numerze (nazwa pliku z przepisu jest tylko wyświetlana), a `options.txt` z przepisu trafia wyłącznie do `options.txt` nowej instancji.

## Zaproszenia: `hammer://join`

Właściciel serwera (albo zwykły gracz) wysyła link. Znajomy go klika, a launcher wychodzi na wierzch i pyta, co zrobić – **nic nie dzieje się bez potwierdzenia gracza**.

Format linku:

```
hammer://join?server=<host[:port]>&name=<nazwa do pokazania>&mc=<wersja gry>&loader=<fabric|quilt|forge|neoforge|vanilla>&pack=<numer albo slug paczki modów na Modrinth>&icon=<adres https obrazka>
```

Wymagany jest tylko `server`. Ten sam zestaw parametrów przyjmuje strona sklepu `GET <website>/join?…` – otwiera launcher, a komuś, kto go nie ma, pokazuje, skąd go wziąć. Launcher czyta oba rodzaje linków.

- **Po kliknięciu linku** (albo po wklejeniu go w *Serwery → Mam zaproszenie*) okno pokazuje nazwę i adres serwera, wersję gry i loader, o które prosi link, oraz wybór: jedna z Twoich instancji, która pasuje (ta sama wersja gry i loader), albo **Utwórz nową instancję** – z tymi ustawieniami. Gdy link ma `pack`, launcher najpierw pokazuje nazwę i autora paczki pobrane z Modrinth, a po zgodzie instaluje ją zwykłą instalacją paczek. Po potwierdzeniu serwer trafia na listę wybranej instancji, a okno kończy się przyciskiem **Graj**, który uruchamia grę od razu na tym serwerze.
- **Tworzenie linku** (*Serwery →* ikona *Zaproś* przy serwerze): link z adresem i nazwą serwera oraz wersją gry i loaderem bieżącej instancji (gdy instancja powstała z paczki Modrinth – także z tą paczką, co można wyłączyć), przycisk *Kopiuj link* i informacja, że znajomy potrzebuje Hammer Launchera. Gdy w `launcher.config.json` jest `website` (https), link ma postać `<website>/join?…`, w przeciwnym razie `hammer://join?…`.
- **Kontrola linku**: te same zasady co przy przepisach – adres tylko `host[:port]`, nazwa do 48 znaków, wersja gry z prawdziwej listy wersji, loader z listy znanych, `pack` jako numer albo slug Modrinth (i musi to być paczka modów). `icon` jest wyłącznie pokazywany w oknie, tylko gdy to adres `https` – proces główny launchera nigdy go nie pobiera. Nieznane parametry są pomijane. Zły link kończy się spokojnym komunikatem po polsku.
- **Rejestracja protokołu**: launcher przy każdym starcie zgłasza się w systemie jako program do linków `hammer://` (`app.setAsDefaultProtocolClient`; w Windows wpis w rejestrze bieżącego użytkownika, z `--` przed adresem, żeby nic z linku nie zostało wzięte za przełącznik programu). Pakiety macOS i Linux deklarują protokół także przy budowie (`protocols` w `package.json`); instalator Windows (NSIS) sam takiego wpisu nie robi, więc linki zaczynają działać po pierwszym uruchomieniu launchera. Działa jedna kopia launchera naraz: link kliknięty przy otwartym launcherze trafia do niego (`second-instance`), link, którym launcher został uruchomiony, jest odczytywany z argumentów startu, a na macOS przychodzi zdarzeniem `open-url`.

## Polecane serwery

Karta **Polecane serwery** w zakładce *Serwery* (i wąski pasek na ekranie *Graj*) pokazuje serwery wybrane przez sklep: ikonę, nazwę, opis, tagi i liczbę graczy online (zwykły ping serwera). **Dodaj** dopisuje serwer do listy bieżącej instancji, a **Graj** prowadzi tą samą drogą co zaproszenie: pasująca instancja albo nowa.

Lista pochodzi ze strony sklepu: `GET <shopApi albo website>/api/launcher/featured` → `{ "servers": [{ "id", "name", "address", "description", "tags": ["…"], "icon": "<https albo null>", "mc", "loader", "pack" }] }`. To trasa publiczna (bez kodu Hammer+), a launcher pyta o nią najwyżej raz na 5 minut. Gdy strona nie odpowiada albo lista jest pusta, karty po prostu nie ma – bez żadnego błędu. Teksty z API są traktowane jak dane z zewnątrz: pokazywane wyłącznie jako tekst i przycinane (nazwa 40 znaków, opis 200, najwyżej 6 tagów po 20 znaków, 25 serwerów).

### Dla deweloperów: przenoszenie, przepisy, zaproszenia

- Moduły (bez Electrona, z testami): `official.js` (światy i ustawienia zwykłego Minecrafta), `recipe.js` (przepisy: kontrola, kod, plik, eksport i import), `invite.js` (czytanie i budowanie linków), `featured.js` (lista polecanych); trasa `/featured` jest w `shopapi.js`. W `content.js` doszło `installVersion` (dokładna wersja z Modrinth, bez szukania zależności), a w `modrinth.js` zapytania zbiorcze `versionsByIds` / `projects` (po 100 numerów) i `author`.
- W oknie: `views/official.js`, `views/share.js` i `views/invite.js` (okna dialogowe i karta polecanych); długie zadania zgłaszają postęp zdarzeniem `task:progress` z polem `scope` (`official-worlds`, `recipe`, `modpack`).
- Kod i plik są czytane w procesie głównym; okno dostaje tylko podsumowanie i jednorazowy żeton, którym potwierdza instalację.

## Test FPS

Karta **Test FPS** w zakładce *Optymalizacja* odpowiada na pytanie „ile mam klatek i czy optymalizacja coś dała?”. Jest za darmo.

1. Wybierasz instancję (u góry strony), **świat** – domyślnie ten, w który grałeś ostatnio – i **długość testu**: 10, 20 albo 30 sekund.
2. **Uruchom test** startuje grę od razu w tym świecie. Hammer Client czeka kilka sekund, aż świat się wczyta, mierzy każdą klatkę (powoli obracając kamerę) i **sam zamyka grę**. W tym czasie launcher pokazuje zwykły stan „Gra działa” z dopiskiem *„Trwa test FPS – gra zamknie się sama”*.
3. Po zamknięciu gry karta pokazuje wynik: **średnio**, **1% low** (średnia z 1% najwolniejszych klatek, czyli przycięcia), **najniższe** i **najwyższe** FPS – a obok poprzedni wynik i różnicę, np. *„+38% średnio”*. Zrób test, kliknij *Zoptymalizuj wszystko*, zrób test jeszcze raz – i widać, co się zmieniło.

Dobrze wiedzieć:

- **Wynik zależy od miejsca w świecie** i od tego, na co patrzy postać. Porównuj testy zrobione w tym samym świecie, w tym samym miejscu – gdy poprzedni test był w innym świecie, karta to mówi.
- Test działa tylko w instancjach z **włączonym Hammer Client** (Fabric albo Quilt, wersja gry obsługiwana przez mod, Hammer Client 2.2.0 lub nowszy). Pozostałe instancje dostają jedno zdanie wyjaśnienia. Instancja bez świata – prośbę, żeby najpierw utworzyć świat w grze.
- Launcher pamięta **20 ostatnich testów każdej instancji** (*Historia testów*): datę, liczby, wersję gry, liczbę modów, zainstalowane mody wydajnościowe i ustawioną pamięć RAM.
- Gdy gra zamknie się bez wyniku, karta pisze **„Test nie został ukończony”** i podaje prawdopodobne przyczyny (gra zamknięta przed końcem pomiaru, świat się nie wczytał).
- Test to nie granie: nie liczy się do czasu gry, nie zmienia „ostatnio grane”, nie robi automatycznych kopii światów (Hammer+) ani podsumowania gry. Argumenty testu launcher dodaje tylko do tego jednego startu – w ustawieniach instancji nic nie zostaje.

## Podsumowanie gry

Gdy zwykła sesja gry się kończy, na ekranie *Graj* pojawia się karta **Podsumowanie gry**: nazwa instancji, ile trwała ta sesja, ile łącznie grasz w tej instancji i ile zrzutów ekranu zrobiłeś w jej trakcie – z miniaturami, które prowadzą do *Galerii* tej instancji. Jeśli w tej instancji działa Hammer Client, a test FPS nie był jeszcze robiony, karta delikatnie do niego zaprasza.

- Sesje krótsze niż minuta niczego nie pokazują. Sesja zakończona crashem też nie – tam launcher i tak wyjaśnia w *Konsoli*, co się stało.
- Kartę zamykasz krzyżykiem; znika też sama, gdy uruchomisz następną grę.
- Łączny czas gry każdej instancji widać również na jej karcie w zakładce *Instancje* i w „Wybranej instancji” na ekranie *Graj*.
- Wyłączysz ją w *Ustawienia → Gra → Podsumowanie po grze*.

## Aktualizacje modów i droga powrotna

Launcher pilnuje, czy mody, paczki tekstur i shadery z Modrinth mają nowsze wersje dla wersji gry i loadera danej instancji.

- **Sprawdzanie w tle**: chwilę po starcie launchera i potem co 6 godzin. Gdy coś jest, instancja dostaje znaczek (*„3 aktualizacje”*), a ekran *Graj* jedną kartę: *„Aktualizacje modów: 3 w „Hammer””* – kliknięcie otwiera listę (*Mody → Zainstalowane*). Nic nie instaluje się samo, a gdy nie ma internetu albo Modrinth nie odpowiada, launcher po prostu nic nie mówi. Instancji z paczek modów sprawdzanie w tle nie rusza (paczkę aktualizuje się w całości) – ręczne *Sprawdź aktualizacje* działa w nich jak zawsze. Wyłączysz to w *Ustawienia → Pobieranie i pliki → Sprawdzaj aktualizacje modów w tle*.
- **Aktualizuj wszystko** i aktualizacja pojedynczego dodatku (strzałka przy nim) najpierw robią **punkt przywracania**: pliki, które mają zostać podmienione, launcher **przenosi** (nie usuwa) do `<instancja>/.hammer/przywracanie/<data_godzina>/` razem z małym plikiem `manifest.json` – co zostało zastąpione czym. Dopiero potem pobiera nowe wersje. Gdy pobranie któregoś dodatku się nie uda, jego stara wersja od razu wraca na miejsce. Dodatek, który był wyłączony, po aktualizacji zostaje wyłączony.
- **Cofnij ostatnią aktualizację** (pod przyciskami na liście zainstalowanych) pokazuje, co dokładnie wróci, a potem odwraca manifest: usuwa nowe pliki i przenosi stare z powrotem. Można cofać po kolei do trzech aktualizacji wstecz – launcher trzyma **trzy ostatnie punkty przywracania** każdej instancji, starsze usuwa.
- Aktualizacja i cofanie **nie ruszają, gdy gra tej instancji działa** (gra trzyma te pliki), a w ich trakcie nie da się tej instancji uruchomić.
- **Przerwana aktualizacja** (zamknięty launcher, brak prądu) niczego nie psuje na stałe: manifest powstaje przed przeniesieniem pierwszego pliku, więc lista zainstalowanych mówi, że aktualizacja została przerwana, a *Cofnij ostatnią aktualizację* przywraca pliki sprzed niej. Cofanie można bezpiecznie powtórzyć – plik, który już wrócił, nie jest ruszany drugi raz.

## Zrzut ekranu jako link

W *Galerii*, w podglądzie zrzutu, jest przycisk **Udostępnij link**: launcher wysyła ten jeden obraz do serwisu z tymczasowymi plikami i kopiuje link do schowka – wygodne, gdy chcesz pokazać zrzut komuś, kto nie ma Discorda pod ręką.

To jedyne miejsce (obok *Wyślij logi*), w którym launcher wysyła coś od Ciebie na zewnątrz, dlatego przed pierwszym użyciem pyta o zgodę i mówi wprost:

- obraz **opuszcza Twój komputer** i trafia do **zewnętrznego serwisu, którego nie prowadzi HammerShop** – domyślnie [Litterbox](https://litterbox.catbox.moe) (tymczasowe pliki catbox.moe),
- **zobaczy go każdy, kto ma link**,
- obraz **znika po 72 godzinach** i **nie da się go usunąć wcześniej**.

W oknie jest pole **Nie pytaj ponownie**; pytanie włączysz z powrotem w *Ustawienia → Pobieranie i pliki → Pytaj przed udostępnieniem zrzutu ekranu*. Bez Twojego „tak” nic nie jest wysyłane – pilnuje tego proces główny launchera, nie samo okno.

Wysyłane są tylko pliki PNG i JPG z folderu `screenshots/` instancji, najwyżej 20 MB, pod neutralną nazwą (bez daty z nazwy pliku). Odpowiedź serwisu launcher przyjmuje tylko wtedy, gdy jest adresem `https` w domenie serwisu (`catbox.moe`); błąd albo brak odpowiedzi kończy się spokojnym komunikatem. Adres serwisu i czas przechowywania są w `launcher.config.json` (`screenshotShare`) – **pusty `url` usuwa przycisk** i nic nigdzie nie jest wysyłane.

### Dla deweloperów: test FPS, podsumowanie, aktualizacje, link do zrzutu

- Moduły (bez Electrona, z testami): `benchmark.js` (argumenty, odczyt wyniku, historia i porównanie), `playsummary.js`, `restorepoints.js` (punkty przywracania), `updates.js` (aktualizowanie przez punkt przywracania i sprawdzanie w tle), `screenshare.js` (wysyłka zrzutu, zgoda, kontrola odpowiedzi). W oknie: `views/benchmark.js` oraz dopiski w `home.js`, `mods.js`, `instances.js`, `gallery.js` i `settings.js`.
- **Test FPS – umowa z modem** (Hammer Client 2.2.0+, opis także w `hammer-client/README.md`): start z `-Dhammerclient.benchmark=<sekundy>` (5–180) i `-Dhammerclient.benchmark.quit=true`, prosto do świata (`--quickPlaySingleplayer`). Mod zapisuje `<instancja>/config/hammerclient/benchmark.json`: `{"version":"2.2.1","mc":"1.21.4","seconds":20.0,"frames":4812,"avg":240.6,"low1":121.3,"min":88.0,"max":412.5,"finishedAt":<ms od 1970>}` i zamyka grę. Launcher usuwa stary plik przed startem, po zamknięciu gry przyjmuje wynik tylko z `finishedAt` późniejszym niż start testu i usuwa plik w każdym przypadku. Historia leży w `<instancja>/.hammer/benchmarks.json`. Zdarzenia dla okna: `game:state` z `benchmark: true` oraz `benchmark:done`.
- **Podsumowanie**: zdarzenie `play:summary` (`{ instanceId, name, playedMs, totalMs, endedAt, screenshots: { count, shots }, suggestBenchmark }` albo `null`); łączny czas gry to `playTimeMs` w `instance.json`.
- **Manifest punktu przywracania**: `{ "v": 1, "id": "2026-11-11_14-05-33", "createdAt": …, "state": "pending" | "done", "entries": [{ "type": "mod" | "resourcepack" | "shader", "title", "old": { "file", "disabled", "versionNumber", "index" }, "new": { "file", "versionId", "versionNumber" }, "state": "planned" | "done" | "failed" }] }`. Cofanie patrzy na folder, nie na `state`: stary plik, który leży w punkcie, wraca (po usunięciu nowego); którego tam nie ma – już wrócił albo nigdy nie został ruszony. Manifest leży w folderze gry, więc jest czytany nieufnie: tylko zwykłe nazwy plików `.jar` / `.zip` w `mods/`, `resourcepacks/` i `shaderpacks/`.
- **Link do zrzutu**: `POST <screenshotShare.url>`, formularz multipart `reqtype=fileupload`, `time=<screenshotShare.time>`, `fileToUpload=<plik>`; odpowiedzią jest sam adres. `time` to `1h`, `12h`, `24h` albo `72h` (inna wartość = `72h`). Zgoda „Nie pytaj ponownie” to ustawienie `screenshotShareAsk: false`.

## Wersja beta

Launcher jest w wersji **beta**: obok nazwy „Hammer Launcher” (pasek tytułu, ekran główny, *Ustawienia → O launcherze*, tytuł okna) widać znaczek **BETA**. To tylko oznaczenie – nazwa programu, instalatora i folderów się nie zmienia. Znaczek znika po ustawieniu `"channel": ""` (albo `"stable"`) w `launcher.config.json`.

## Aktualności i komunikaty ze strony

Gdy strona HammerShop / Hammer Launcher jest online, **Aktualności** na ekranie głównym pochodzą z jej panelu admina (`<strona>/admin` → *Aktualności*): tytuł, treść, etykieta, data, przypięcie na górze i opcjonalny link. Nowe wpisy mają kropkę „nowe”, dopóki nie zobaczysz ekranu głównego. Launcher odświeża je co 10 minut i po powrocie do okna.

**Komunikat** z panelu (*Komunikat*) to pasek na samej górze okna, widoczny na każdym ekranie: informacja (pomarańczowy), ostrzeżenie (żółty) albo ważne (czerwony – tego nie da się zamknąć). Zamknięty komunikat nie wraca, dopóki w panelu nie pojawi się nowy.

Jeśli strona nie odpowiada, launcher pokazuje wbudowane porady i działa dalej – nic z tego nie spowalnia startu ani nie blokuje gry.

## Aktualizacje launchera

Zainstalowany launcher (instalator Windows) **aktualizuje się sam – z serwera właściciela, nie z GitHuba**: kilka sekund po starcie i potem co godzinę sprawdza, czy jest nowa wersja, i pobiera ją w tle (tylko to, co się zmieniło). **Gra nigdy nie jest przerywana** – nic się nie instaluje, dopóki działa gra uruchomiona z launchera.

- **W tle, nawet gdy launcher nie jest otwarty** (Windows): launcher startuje razem z systemem jako ikona w zasobniku obok zegara (bez okna), a krzyżyk okna chowa go do zasobnika zamiast zamykać. Gdy aktualizacja się pobierze, a okno jest zamknięte i nikt nie gra, instaluje się sama po cichu i launcher wraca do zasobnika. Grasz w coś innego (np. w Fortnite)? Aktualizacja i tak się zainstaluje. Całkiem zamkniesz launcher z menu ikony w zasobniku. Oba zachowania wyłączysz w *Ustawienia → Aktualizacje launchera* („Uruchamiaj razem z Windows”, „Zamknięcie okna zostawia launcher w tle”); deinstalacja usuwa wpis autostartu.
- **Okno otwarte**: ekran *Graj* pokazuje „Nowa wersja … jest gotowa” z przyciskiem **Zaktualizuj teraz** i opisem zmian. Można też nic nie robić – zainstaluje się, gdy zamkniesz okno.
- **Po aktualizacji**: przy pierwszym otwarciu okna na środku ekranu *Graj* pojawia się okno **Co nowego** z wersją i opisem zmian (jednorazowo). Opis to pole „Co nowego” z panelu admina – idzie w `latest.yml` razem z aktualizacją, więc launcher pokaże go nawet bez połączenia ze stroną.

- *Ustawienia → Aktualizacje launchera*: przełącznik **Aktualizuj automatycznie** (wyłączony = launcher tylko mówi o nowej wersji i daje przycisk **Pobierz i zainstaluj**), aktualna wersja, stan i **Sprawdź teraz**.
- **Wymagana aktualizacja**: gdy właściciel oznaczy starsze wersje jako niewspierane, launcher pokazuje okno „Wymagana aktualizacja” i nie pozwala grać, dopóki się nie zaktualizuje. Bez połączenia ze stroną nic nie jest blokowane.
- **Wersja przenośna** (portable) i uruchomienie deweloperskie nie podmieniają się same – mówią, że jest nowa wersja, i dają przycisk do strony z instalatorem.

### Jak wydać nową wersję (właściciel)
1. Podnieś `version` w `package.json`, wypchnij zmianę i pobierz z GitHub Actions artefakt **Hammer-Launcher-Windows** (jest w nim instalator `Hammer-Launcher-Setup-x.y.z.exe`, jego plik `.blockmap` i `latest.yml`). Przetestuj instalator u siebie.
2. Na stronie: `<strona>/admin` → **Wersje launchera** → wgraj instalator (i `.blockmap`, żeby gracze pobierali same zmiany) → wpisz wersję i „Co nowego” → **Opublikuj wersję**.
3. Od tej chwili strona daje ten plik do pobrania, a zainstalowane launchery same się zaktualizują. Plik `latest.yml` strona tworzy sama – tego z artefaktu nie trzeba wgrywać.

### Podpisane wydania (zalecane)
Aktualizacja to program, który uruchomi się na komputerach wszystkich graczy. Launcher zawsze sprawdza sumę sha512 pobranego pliku, a z ustawionym `updatePublicKey` instaluje **wyłącznie wydania podpisane Twoim kluczem** – nawet ktoś, kto włamałby się na serwer albo konto admina, nie podmieni aktualizacji.

```bash
node scripts/sign-release.js --new-key
```
wypisze nową parę kluczy: **publiczny** wpisujesz do `launcher.config.json` → `updatePublicKey` (i budujesz launcher), **prywatny** zachowujesz u siebie – nigdy w repozytorium ani na serwerze strony.

```bash
node scripts/sign-release.js dist/Hammer-Launcher-Setup-2.6.1.exe --key klucz-prywatny.txt
```
wypisze podpis i zapisze go obok instalatora w pliku `.sig`. Jego zawartość wklejasz w panelu admina w polu **Podpis wydania**. W GitHub Actions wystarczy dodać sekret repozytorium `UPDATE_SIGNING_KEY` (klucz prywatny) – plik `.sig` znajdzie się wtedy w artefakcie. Uwaga: po ustawieniu `updatePublicKey` launcher odrzuci każde wydanie bez poprawnego podpisu, a zgubiony klucz prywatny oznacza, że gracze muszą ręcznie zainstalować wersję z nowym kluczem.

### Dla deweloperów: aktualności, komunikat, aktualizacje
- `GET <shopApi albo website>/api/launcher/news` → `{ news: [{ id, title, body, tag, date, at, url, image, pinned }], alert: { id, level, text, url, until } | null, release: { version, notes, date, minVersion, size, url } | null }`. Trasa publiczna; launcher wysyła nagłówek `User-Agent: Hammer-Launcher/<wersja> (hammershop.pl)` – strona liczy z niego uruchomienia (same liczby). Wszystko z tej odpowiedzi jest traktowane jako niezaufany tekst: przycinane, pokazywane jako tekst, linki tylko `https://` (`src/main/news.js`, `src/main/text.js`).
- Aktualizacje: `electron-updater`, dostawca „generic”, adres `<updateUrl>` albo `<shopApi albo website>/updates` (`latest.yml` + instalator + `.blockmap`). Logika jest w `src/main/selfupdate.js` (bez Electrona – prawdziwy `autoUpdater` i zegar są wstrzykiwane, więc testy używają atrap): wybór adresu, porównywanie wersji liczbami, stany, odmowa przy uruchomionej grze, wersje bez samoaktualizacji, sprawdzanie podpisu (`signature` w `latest.yml` = podpis Ed25519 tekstu `"<wersja>\n<sha512>"`), wymagana wersja.
- Zamknięty komunikat i „ostatnio widziane aktualności” launcher pamięta w `settings.json`.

## Wersja angielska

Launcher jest napisany po polsku i polski pozostaje językiem źródłowym: widoki budują interfejs po polsku, a błędy z procesu głównego mają polską treść. Wersja angielska to **warstwa tłumacząca w oknie** (`src/renderer/js/i18n.js`). Gdy wybrany jest angielski, tłumaczy ona to, co trafia na ekran – teksty, podpowiedzi (`title`), `placeholder`, `aria-label`, `alt`, napisy przycisków i pozycje list – także wszystko, co pojawi się później (komunikaty, okna, paski postępu). Po polsku warstwa w ogóle nie działa.

- **Wybór języka**: *Ustawienia → Wygląd → Język / Language*: *Automatycznie (język systemu)*, *Polski* albo *English*. „Automatycznie” to polski, gdy system jest po polsku (`app.getLocale()` zaczyna się od `pl`), a angielski w każdym innym przypadku. Zmiana działa od razu, bez ponownego uruchamiania. Ustawienie to `language` w `settings.json` (`auto` | `pl` | `en`), a o języku decyduje funkcja `resolveLanguage` w `src/main/i18n.js`.
- **Słownik** – `src/renderer/i18n/en.json`:
  - `strings` – dokładny polski tekst → angielski,
  - `patterns` – teksty ze zmienną częścią, np. `{ "re": "^Aktualizacje modów: (\\d+) w „(.+)”$", "en": "Mod updates: $1 in “$2”" }`. Opcjonalne `"as": { "1": "t" }` mówi, co zrobić z grupą przed wstawieniem: `t` – przetłumacz ją (słownikiem i wzorcami), `tl` – jak `t`, ale od małej litery, `date` – polskie nazwy miesięcy i dni tygodnia na angielskie, `num` – liczba zapisana po polsku („12 345,6”) na angielską, `list` – przetłumacz każdy element listy po przecinku. Wzorce są sprawdzane po kolei, więc bardziej szczegółowe stoją wyżej,
  - `plurals` – rzeczowniki z liczbą: `{ "pl": ["mod", "mody", "modów"], "en": ["mod", "mods"] }` daje „1 mod / 2 mods / 5 mods”,
  - `dates` – nazwy miesięcy i dni tygodnia (dla dat, które proces główny zapisał po polsku),
  - `contexts` – tekst, który w innym miejscu znaczy co innego: `{ "in": ".skin-page", "strings": { "Zestawy": "Outfits" } }` (`in` to selektor CSS; w zakładce *Mody* „Zestawy” to *Bundles*),
  - `same` – teksty celowo takie same w obu językach („Hammer+”, „Fabric”).

  Do tego kilka reguł bez wpisów: części połączone „ · ” oraz kolejne zdania są tłumaczone osobno, a w tekście „Nazwa – opis” tłumaczony jest opis.
- **Czego warstwa nie tłumaczy**: tłumaczone są tylko dokładne trafienia w słowniku i we wzorcach, więc nazwa instancji czy świata wpisana przez gracza zostaje taka, jaka jest. Elementy z cudzym tekstem – nazwy, opisy modów z Modrinth, opisy serwerów, linie logów w Konsoli, nazwy plików – mają atrybut `data-no-i18n` i są pomijane w całości. W kodzie widoku: `HS.raw(h('b', instance.name))`. `data-no-i18n="attrs"` pomija tylko własne `title` / `aria-label` elementu.
- **Liczby i daty** formatuje `HS.fmt` (oraz `HS.locale()`): po angielsku `en-GB` (dzień przed miesiącem, zegar 24-godzinny), po polsku `pl-PL`. Tekst, który nie trafia na stronę, tłumaczy `HS.t('…')`. Jedyny tekst rysowany przez CSS (`content:"…"`) ma w `styles.css` drugą regułę `html[lang="en"] …`.
- **Proces główny** korzysta z tego samego słownika przez `tr(tekst, język)` z `src/main/i18n.js` – tylko dla tekstów systemowych: menu w zasobniku, tytuły i filtry okien wyboru plików, tytuł okna logowania, status w Discordzie oraz nazwy, które launcher nadaje sam („(kopia)” przy duplikacie instancji, „Skórka z konta”). Komunikaty usług zostają w procesie głównym po polsku – tłumaczy je okno, gdy je pokazuje.
- **Czego nie ma po angielsku**: instalatora Windows (NSIS jest budowany po polsku), strony logowania w oknie Microsoftu (jej język wybiera Microsoft) oraz treści z sieci – aktualności z `newsUrl`, produktów sklepu, opisów serwerów i modów. Menu Hammer Client w grze ma własne tłumaczenie i idzie za językiem Minecrafta.

### Jak dodać albo poprawić tłumaczenie

1. Nowy tekst w widoku pisz zwyczajnie po polsku. Tłumaczenie dopisz (albo popraw) w `src/renderer/i18n/en.json`: zwykły tekst w `strings`, tekst ze zmienną częścią w `patterns`, nowy rzeczownik z liczbą w `plurals`. Styl: krótko, jak w grach – *Play*, *Instances*, *Mods*, *Settings* – z amerykańską pisownią (*Optimization*, *color*).
2. `npm test` – testy pilnują słownika (poprawny JSON, brak pustych tłumaczeń, każdy wzorzec się kompiluje i używa tylko grup, które ma, tekst identyczny w obu językach musi być na liście `same`) oraz tego, czy teksty wpisane w `src/renderer/views/*.js`, `js/app.js` i `js/core.js` mają wpis albo wzorzec. `node scripts/i18n-literals.js` wypisuje polskie teksty z kodu okna i procesu głównego, których słownik jeszcze nie zna.
3. Podgląd po angielsku (te same kroki co po polsku, selektory kroków są tłumaczone słownikiem):

   ```bash
   node scripts/preview.js preview-en 1 --lang=en
   ```

   Przebieg kończy się błędem, gdy na którymś ekranie został polski tekst poza `data-no-i18n`: tekst z polskimi literami, tekst będący kluczem słownika albo taki, w którym jest słowo znane tylko z polskiej strony słownika. Obok zrzutów powstaje `i18n-missing.json` – wszystko, czego warstwa nie przetłumaczyła (nazwy, liczby, dane; warto rzucić okiem, czy nie ma tam czegoś naszego). Przykładowe dane podglądu, które celowo są po polsku (nazwy światów, serwerów, skórek), wymienia lista `FOREIGN` w `scripts/preview-i18n.js`.
4. Angielskie teksty mają inną długość. `node scripts/preview.js preview 1 --collect` zapisuje przy polskim przebiegu `i18n-texts.json` (każdy tekst, który widzi warstwa, ze zrzutem, na którym się pojawił) i `i18n-layout.json`; angielski przebieg z `--compare=preview` wypisuje wtedy do `i18n-layout.txt` miejsca, w których angielski tekst jest ucięty albo zawija się, a polski nie. Co się nie mieści, skracamy w słowniku – układu nie zmieniamy.

## Uruchomienie (deweloperskie)

Wymagany Node.js 20+.

```bash
npm install
```

```bash
npm start
```

## Budowa instalatora Windows (.exe)

```bash
npm run dist:win
```

W folderze `dist/` powstaną `Hammer-Launcher-Setup-<wersja>.exe` (instalator po polsku) oraz `Hammer-Launcher-<wersja>-portable.exe` (bez instalacji).
Instalator buduje się też automatycznie w GitHub Actions (workflow **Hammer Launcher**, artefakt *Hammer-Launcher-Windows*).

W `dist/` są też `latest.yml` i pliki `.blockmap` – potrzebne do [aktualizacji launchera](#aktualizacje-launchera) (wgrywasz instalator i `.blockmap` w panelu admina strony; nic nie jest publikowane automatycznie).

**Zabezpieczenia spakowanej aplikacji.** Kod launchera jest spakowany w `app.asar`, a Electron ma włączone „bezpieczniki” (`build.electronFuses` w `package.json`): sprawdzanie integralności `app.asar`, ładowanie kodu tylko z niego, wyłączone uruchamianie launchera jako zwykłego Node.js (`ELECTRON_RUN_AS_NODE`), `NODE_OPTIONS` i `--inspect`, szyfrowane ciasteczka. Zwykła podmiana plików w folderze launchera przestaje działać. To utrudnia grzebanie w programie, ale nie robi z niego sejfu: w launcherze nie ma żadnych sekretów (tylko klucze publiczne), a wszystko, co ważne – płatności, kody Hammer+, aktualizacje – jest sprawdzane na serwerze albo podpisem. GitHub Actions po zbudowaniu instalatora odczytuje bezpieczniki i uruchamia spakowaną aplikację, żeby potwierdzić, że po zabezpieczeniu normalnie startuje.

Pliki nie są podpisane certyfikatem, więc Windows SmartScreen pokaże ostrzeżenie *„System Windows ochronił ten komputer”*: kliknij **Więcej informacji → Uruchom mimo to**. Przy publicznej dystrybucji warto kupić certyfikat do podpisywania kodu.

## Konfiguracja – `launcher.config.json`

| Pole | Co robi |
|---|---|
| `name`, `brand` | Nazwa launchera i marki (okno, Discord, instancja startowa). |
| `website`, `shopUrl` | Przyciski *Strona* i *Sklep HammerShop* na ekranie głównym. Gdy `website` jest adresem https, zaproszenia tworzone w launcherze mają postać `<website>/join?…` (bez niego: `hammer://join?…`). |
| `discordInvite` | Link zaproszenia na Discorda, np. `https://discord.gg/abc`. **Puste = launcher bierze zaproszenie ze strony bota** (to, które bot utworzył przy `/zbuduj`). Najlepiej wpisać stałe zaproszenie (bez wygasania). |
| `shopApi` | Adres strony bota HammerShop, jeśli jest inny niż `website` (np. `https://sklep.hammershop.pl`). Stąd launcher bierze produkty, zaproszenie na Discorda i listę polecanych serwerów (`/api/launcher/featured`), tu też trafia chmura Hammer+ (`/api/launcher`, tylko https). |
| `server.name`, `server.address` | Opcjonalnie: serwer Minecraft na ekranie głównym (status, liczba graczy, przycisk **Dołącz**). Puste = karta się nie pokazuje. |
| `newsUrl` | Własny adres JSON z aktualnościami: `[{"title": "…", "body": "…", "tag": "Nowość", "date": "10.11.2026", "url": "https://…"}]`. **Puste = aktualności, komunikat i informacja o wersji z panelu admina strony** (`<shopApi albo website>/api/launcher/news`), a gdy strona nie odpowiada – wbudowane porady. |
| `channel` | `"beta"` pokazuje znaczek **BETA** obok nazwy launchera. `""` albo `"stable"` = bez znaczka. |
| `updateUrl` | Folder z aktualizacjami launchera (`latest.yml` + instalator). Puste = `<shopApi albo website>/updates`. Tylko `https://` (albo `http://localhost` do testów); bez żadnego adresu aktualizacje są wyłączone. |
| `updatePublicKey` | Klucz publiczny do [podpisanych wydań](#podpisane-wydania-zalecane): base64 z 32 bajtów klucza Ed25519. Puste = podpis nie jest wymagany (launcher sprawdza tylko sumę sha512). |
| `discordClientId` | ID aplikacji z Discord Developer Portal do statusu „Gra w…” (obraz `logo` w Rich Presence). |
| `plusPublicKey` | Klucz publiczny sklepu do sprawdzania kodów Hammer+: base64 z 32 bajtów klucza Ed25519. Puste = Hammer+ nie da się aktywować. Klucz prywatny ma tylko bot. |
| `microsoft.clientId` | Własna aplikacja Azure do logowania (patrz niżej). Puste = domyślne okno logowania. |
| `defaultInstance` | Instancja tworzona przy pierwszym uruchomieniu (Fabric, optymalizacja włączona). Launcher wybiera najnowszą wersję Minecrafta, którą obsługuje dołączony Hammer Client; `mcVersion` jest używane, gdy moda nie ma w launcherze. |
| `screenshotShare.url`, `screenshotShare.time` | *Udostępnij link* w Galerii: adres, pod który launcher wysyła zrzut ekranu (zewnętrzny serwis – domyślnie Litterbox: `https://litterbox.catbox.moe/resources/internals/api.php`), i czas przechowywania (`1h`, `12h`, `24h`, `72h`). **Pusty `url` = przycisku nie ma** i launcher niczego nie wysyła. Tylko adres `https`. |

### Logowanie Microsoft przy publicznej dystrybucji

Do testów launcher używa standardowego okna logowania Microsoft. Jeśli chcesz rozdawać launcher graczom:

1. Zarejestruj aplikację w [Azure Portal](https://portal.azure.com) (*App registrations*): konta osobiste Microsoft, przekierowanie typu *Mobile and desktop* `https://login.microsoftonline.com/common/oauth2/nativeclient`.
2. Złóż wniosek o dostęp do Minecraft API dla nowej aplikacji: [formularz Mojang](https://aka.ms/mce-reviewappid). Bez akceptacji logowanie zwróci błąd.
3. Wpisz `clientId` (i ewentualnie `redirect`) w `launcher.config.json`.

## Gdzie są pliki

- Windows: `%APPDATA%\.hammer-launcher`
- macOS: `~/Library/Application Support/hammer-launcher`
- Linux: `~/.hammer-launcher`

W środku są `instances/` (każda instancja osobno), `versions/`, `libraries/` i `assets/` (gra i jej pliki – wspólne dla wszystkich instancji, pobierane raz), `runtime/` (Java), `skins/` (biblioteka skórek i zestawy), `settings.json` i `accounts.json` (zaszyfrowane tokeny). Hammer+ dodaje `plus.json` (kody), `cloud.json` (ostatnia kopia uzgodniona z chmurą) i `theme/` (własne tła).

W folderze każdej instancji launcher ma swój podfolder `.hammer/`: `content.json` (skąd pochodzą dodatki), `benchmarks.json` (historia testów FPS) i `przywracanie/` (do trzech punktów przywracania po aktualizacjach modów – można je usunąć ręcznie, żeby zwolnić miejsce; wtedy tych aktualizacji nie da się już cofnąć).

## Testy

```bash
npm test
```

Testy jednostkowe działają bez internetu.

```bash
npm run live-check
```

To test na żywo z prawdziwymi serwerami: instaluje Fabric z optymalizacją, Forge, NeoForge i Quilt oraz paczkę modów, a pod Linuksem/Xvfb uruchamia też grę.

Test Hammer Client dla jednej wersji gry (instaluje instancję, uruchamia grę i czeka, aż mod zgłosi w logu swoje menu główne):

```bash
HAMMER_CLIENT_DIR=../hammer-client/build/dist HAMMER_CLIENT_ONLY=1 MC_VERSION=26.3 npm run live-check
```

Bez `HAMMER_CLIENT_ONLY=1` test Hammer Client jest jednym z kroków pełnego testu. Stare `HAMMER_CLIENT_JAR` (jeden plik dla 1.21 / 1.21.1) nadal działa.

```bash
npm run preview
```

Ten skrypt robi zrzuty ekranu interfejsu (Chromium + Playwright, dane przykładowe) po polsku i kończy się błędem, gdy strona zgłosi błąd albo coś się nie mieści. To samo po angielsku – z dodatkową kontrolą, czy na ekranie nie został polski tekst (szczegóły w sekcji [Wersja angielska](#wersja-angielska)):

```bash
node scripts/preview.js preview-en 1 --lang=en
```

## Licencje i zastrzeżenia

Kod launchera: MIT. Ikony: Font Awesome Free (CC BY 4.0), font: Montserrat (SIL OFL 1.1) – szczegóły w `CREDITS.md`.
Mody i paczki pochodzą z [Modrinth](https://modrinth.com) i należą do ich autorów.
Minecraft jest znakiem towarowym Mojang Studios / Microsoft. Hammer Launcher nie jest oficjalnym produktem Minecraft ani nie jest powiązany z Mojang Studios.
