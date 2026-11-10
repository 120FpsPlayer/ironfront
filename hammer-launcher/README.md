# Hammer Launcher

Launcher Minecrafta: Java Edition od **HammerShop**. Cały interfejs jest po polsku.

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
  - przycisk **Zoptymalizuj wszystko**, który robi to naraz i na koniec pokazuje, co dokładnie zrobił.
- **Mody** (zakładka *Mody*): wyszukiwarka Modrinth z modami, paczkami tekstur, shaderami i paczkami modów. Ma kategorie i sortowanie, a zależności instalują się same. Do tego lista zainstalowanych z włączaniem i wyłączaniem, aktualizacje jednym kliknięciem, przeciąganie plików `.jar` / `.zip` i import paczek `.mrpack`.
- **Zestawy modów** (*Mody → Zestawy*): gotowe zestawy na jedno kliknięcie – *PvP*, *Survival+*, *Budowanie*, *Shadery* oraz *Wygląd i klimat*. Przy każdym dodatku widać, czy istnieje dla wybranej instancji i czy już jest zainstalowany. W zestawach są tylko dodatki, które nie dają przewagi nad innymi graczami.
- **Skórka** (zakładka *Skórka*): podgląd postaci z przodu i z tyłu, wgranie nowej skórki (PNG 64×64, model klasyczny albo smukły), powrót do domyślnej oraz peleryny konta – pokaż / ukryj. Każda skórka, którą nosisz, trafia do biblioteki w launcherze, więc wrócisz do niej jednym kliknięciem. Zmiany idą prosto na konto Microsoft – bez wchodzenia na minecraft.net.
- **Serwery** (zakładka *Serwery*): lista serwerów instancji – ta sama, którą widzisz w grze (`servers.dat`). Przy każdym serwerze status na żywo: gracze, ping, wersja i opis. Dodawanie ze sprawdzeniem adresu, zmiana kolejności i przycisk **Graj**, który uruchamia grę od razu na wybranym serwerze.
- **Światy** (zakładka *Światy*): światy jednoosobowe instancji z trybem gry, wersją, datą ostatniej gry i rozmiarem. **Graj** otwiera wybrany świat od razu po starcie (Minecraft 1.20+). Kopie zapasowe do plików `.zip` w folderze `backups/` instancji (tam, gdzie zapisuje je też sama gra), przywracanie zawsze jako nowy świat, zmiana nazwy i usuwanie do kosza systemowego.
- **Konsola.** Logi gry na żywo. Gdy gra się wyłączy, launcher wyjaśnia po polsku, co się stało i co zrobić (brak RAM, zła Java, niezgodne lub zdublowane mody, sterowniki…). Przycisk **Wyślij logi** wrzuca log na [mclo.gs](https://mclo.gs) i daje link do wklejenia na Discordzie – token logowania jest wcześniej usuwany.
- **Miejsce na dysku** (w *Ustawieniach*): ile zajmują instancje, pliki gry i Java oraz sprzątanie jednym kliknięciem – stare logi i raporty crashy, pamięć podręczna, wersje gry i Javy, z których nie korzysta żadna instancja.
- **Napraw instancję** (menu instancji): przy następnym starcie launcher instaluje loader od nowa i sprawdza wszystkie pliki gry. Światy, mody i ustawienia zostają.
- **Sieci z serwerem proxy.** Gdy system ma ustawione `HTTPS_PROXY` / `HTTP_PROXY` (szkoła, firma), launcher pobiera przez proxy – bez tego wyglądałby na „brak internetu”.
- **Konta Microsoft.** Logowanie przez oficjalne okno Microsoftu. Tokeny są szyfrowane przez system (Windows DPAPI / pęk kluczy), a hasła launcher nigdy nie widzi.
- **Hammer Client – menu w grze jak w Lunar Client.** W instancjach Fabric i Quilt launcher sam dodaje nasz mod – dla każdej wersji Minecrafta od 1.21 do 26.3 ma osobny plik i wybiera właściwy (zmienisz wersję gry w instancji – launcher podmieni mod):
  - własne menu główne,
  - panel modułów pod prawym Shiftem: 38 modułów z własnymi ustawieniami, profile, kolor akcentu,
  - HUD z edytorem (FPS, CPS, klawisze, koordynaty, kompas, pancerz, efekty, cel z paskiem życia, licznik przedmiotów, ping, TPS…),
  - zoom pod C, freelook, przełączany sprint, własny celownik, fullbright, własna pora dnia i pogoda,
  - przyciski Hammer Mody i Discord w menu pauzy.

  Włączasz i wyłączasz go w edytorze instancji. Kod moda jest w folderze `hammer-client/`. Launcher bierze go z folderu `resources/hammer-client/` (plik `versions.json` i po jednym `.jar` na wersję gry) – tworzy go `./gradlew dist` w `hammer-client/` (wynik w `hammer-client/build/dist/`). Lista obsługiwanych wersji pochodzi z `versions.json`, więc nowa wersja moda nie wymaga zmian w launcherze.
- **Nasz Discord.** Karta na ekranie głównym i przycisk w menu: nazwa i ikona serwera, ile osób jest online i ilu jest członków, przycisk **Dołącz do Discorda**. Dane pochodzą z publicznego API zaproszeń Discorda (bez tokenu bota).
- **Nowości ze sklepu HammerShop.** Produkty, ceny i obrazki prosto ze strony bota (`/api/shop/store`) – zmienisz coś w bocie, launcher pokaże to sam.
- **Galeria.** Zrzuty ekranu (F2) ze wszystkich instancji: podgląd na pełnym ekranie, kopiowanie do schowka (np. żeby wkleić na Discorda), pokazanie w folderze, usuwanie.
- **Zasobnik.** Podczas gry launcher chowa się do zasobnika obok zegara. Stamtąd możesz go przywrócić albo zatrzymać grę.
- **Kolor launchera** (w *Ustawieniach*): pomarańczowy, złoty, czerwony, niebieski, zielony albo fioletowy.
- Aktualności, status w Discordzie (z przyciskami *Dołącz do Discorda* i *Sklep*) oraz opcjonalnie status serwera Minecraft z przyciskiem **Dołącz**, jeśli kiedyś będziecie mieli własny serwer.

> Do gry potrzebne jest konto Microsoft z kupionym Minecraftem: Java Edition. Launcher **nie ma** kont offline / „non-premium”, i to celowo.

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

Pliki nie są podpisane certyfikatem, więc Windows SmartScreen pokaże ostrzeżenie *„System Windows ochronił ten komputer”*: kliknij **Więcej informacji → Uruchom mimo to**. Przy publicznej dystrybucji warto kupić certyfikat do podpisywania kodu.

## Konfiguracja – `launcher.config.json`

| Pole | Co robi |
|---|---|
| `name`, `brand` | Nazwa launchera i marki (okno, Discord, instancja startowa). |
| `website`, `shopUrl` | Przyciski *Strona* i *Sklep HammerShop* na ekranie głównym. |
| `discordInvite` | Link zaproszenia na Discorda, np. `https://discord.gg/abc`. **Puste = launcher bierze zaproszenie ze strony bota** (to, które bot utworzył przy `/zbuduj`). Najlepiej wpisać stałe zaproszenie (bez wygasania). |
| `shopApi` | Adres strony bota HammerShop, jeśli jest inny niż `website` (np. `https://sklep.hammershop.pl`). Stąd launcher bierze produkty i zaproszenie. |
| `server.name`, `server.address` | Opcjonalnie: serwer Minecraft na ekranie głównym (status, liczba graczy, przycisk **Dołącz**). Puste = karta się nie pokazuje. |
| `newsUrl` | Adres JSON z aktualnościami: `[{"title": "…", "body": "…", "tag": "Nowość", "date": "10.11.2026", "url": "https://…"}]`. Puste = wbudowane porady. |
| `discordClientId` | ID aplikacji z Discord Developer Portal do statusu „Gra w…” (obraz `logo` w Rich Presence). |
| `microsoft.clientId` | Własna aplikacja Azure do logowania (patrz niżej). Puste = domyślne okno logowania. |
| `defaultInstance` | Instancja tworzona przy pierwszym uruchomieniu (Fabric, optymalizacja włączona). Launcher wybiera najnowszą wersję Minecrafta, którą obsługuje dołączony Hammer Client; `mcVersion` jest używane, gdy moda nie ma w launcherze. |

### Logowanie Microsoft przy publicznej dystrybucji

Do testów launcher używa standardowego okna logowania Microsoft. Jeśli chcesz rozdawać launcher graczom:

1. Zarejestruj aplikację w [Azure Portal](https://portal.azure.com) (*App registrations*): konta osobiste Microsoft, przekierowanie typu *Mobile and desktop* `https://login.microsoftonline.com/common/oauth2/nativeclient`.
2. Złóż wniosek o dostęp do Minecraft API dla nowej aplikacji: [formularz Mojang](https://aka.ms/mce-reviewappid). Bez akceptacji logowanie zwróci błąd.
3. Wpisz `clientId` (i ewentualnie `redirect`) w `launcher.config.json`.

## Gdzie są pliki

- Windows: `%APPDATA%\.hammer-launcher`
- macOS: `~/Library/Application Support/hammer-launcher`
- Linux: `~/.hammer-launcher`

W środku są `instances/` (każda instancja osobno), `versions/`, `libraries/` i `assets/` (gra i jej pliki – wspólne dla wszystkich instancji, pobierane raz), `runtime/` (Java), `skins/` (biblioteka skórek), `settings.json` i `accounts.json` (zaszyfrowane tokeny).

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

Ten skrypt robi zrzuty ekranu interfejsu (Chromium + Playwright, dane przykładowe).

## Licencje i zastrzeżenia

Kod launchera: MIT. Ikony: Font Awesome Free (CC BY 4.0), font: Montserrat (SIL OFL 1.1) – szczegóły w `CREDITS.md`.
Mody i paczki pochodzą z [Modrinth](https://modrinth.com) i należą do ich autorów.
Minecraft jest znakiem towarowym Mojang Studios / Microsoft. Hammer Launcher nie jest oficjalnym produktem Minecraft ani nie jest powiązany z Mojang Studios.
