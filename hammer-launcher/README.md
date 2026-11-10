# Hammer Launcher

Launcher Minecrafta: Java Edition od **HammerShop**. Cały interfejs jest po polsku.

- **Graj jednym kliknięciem.** Launcher sam pobiera grę, właściwą Javę (8 / 17 / 21…) i loader modów.
- **Instancje.** Każda instancja ma własne mody, światy i ustawienia. Do wyboru Vanilla, Fabric, Quilt, Forge i NeoForge, dowolna wersja gry.
- **Optymalizacja** (zakładka *Optymalizacja*):
  - RAM dobrany do komputera i liczby modów (nigdy więcej niż połowa pamięci i maks. 12 GB),
  - dostrojone flagi Javy (G1GC albo ZGC dla mocnych PC),
  - mody wydajnościowe: Sodium / Embeddium, Lithium, FerriteCore, ModernFix, Entity Culling, ImmediatelyFast, More Culling, Dynamic FPS, Krypton, BadOptimizations i Noisium (opcjonalnie Iris do shaderów),
  - presety grafiki *Maks. FPS*, *Zrównoważony* i *Jakość* (zmieniają `options.txt`),
  - wyższy priorytet procesu gry,
  - wymuszenie wydajnej karty graficznej na laptopach (Windows),
  - przycisk **Optymalizuj automatycznie**, który robi to wszystko naraz.
- **Mody** (zakładka *Mody*): wyszukiwarka Modrinth z modami, paczkami tekstur, shaderami i paczkami modów. Ma kategorie i sortowanie, a zależności instalują się same. Do tego lista zainstalowanych z włączaniem i wyłączaniem, aktualizacje jednym kliknięciem, przeciąganie plików `.jar` / `.zip` i import paczek `.mrpack`.
- **Konsola.** Logi gry na żywo. Gdy gra się wyłączy, launcher wyjaśnia po polsku, co się stało i co zrobić (brak RAM, zła Java, niezgodne lub zdublowane mody, sterowniki…).
- **Konta Microsoft.** Logowanie przez oficjalne okno Microsoftu. Tokeny są szyfrowane przez system (Windows DPAPI / pęk kluczy), a hasła launcher nigdy nie widzi.
- **Nasz Discord.** Karta na ekranie głównym i przycisk w menu: nazwa i ikona serwera, ile osób jest online i ilu jest członków, przycisk **Dołącz do Discorda**. Dane pochodzą z publicznego API zaproszeń Discorda (bez tokenu bota).
- **Nowości ze sklepu HammerShop.** Produkty, ceny i obrazki prosto ze strony bota (`/api/shop/store`) – zmienisz coś w bocie, launcher pokaże to sam.
- **Galeria.** Zrzuty ekranu (F2) ze wszystkich instancji: podgląd na pełnym ekranie, kopiowanie do schowka (np. żeby wkleić na Discorda), pokazanie w folderze, usuwanie.
- **Zasobnik.** Podczas gry launcher chowa się do zasobnika obok zegara. Stamtąd możesz go przywrócić albo zatrzymać grę.
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
| `defaultInstance` | Instancja tworzona przy pierwszym uruchomieniu (domyślnie: najnowsza wersja, Fabric, optymalizacja włączona). |

### Logowanie Microsoft przy publicznej dystrybucji

Do testów launcher używa standardowego okna logowania Microsoft. Jeśli chcesz rozdawać launcher graczom:

1. Zarejestruj aplikację w [Azure Portal](https://portal.azure.com) (*App registrations*): konta osobiste Microsoft, przekierowanie typu *Mobile and desktop* `https://login.microsoftonline.com/common/oauth2/nativeclient`.
2. Złóż wniosek o dostęp do Minecraft API dla nowej aplikacji: [formularz Mojang](https://aka.ms/mce-reviewappid). Bez akceptacji logowanie zwróci błąd.
3. Wpisz `clientId` (i ewentualnie `redirect`) w `launcher.config.json`.

## Gdzie są pliki

- Windows: `%APPDATA%\.hammer-launcher`
- macOS: `~/Library/Application Support/hammer-launcher`
- Linux: `~/.hammer-launcher`

W środku są `instances/` (każda instancja osobno), `versions/`, `libraries/` i `assets/` (gra i jej pliki – wspólne dla wszystkich instancji, pobierane raz), `runtime/` (Java), `settings.json` i `accounts.json` (zaszyfrowane tokeny).

## Testy

```bash
npm test
```

Testy jednostkowe działają bez internetu.

```bash
npm run live-check
```

To test na żywo z prawdziwymi serwerami: instaluje Fabric z optymalizacją, Forge, NeoForge i Quilt oraz paczkę modów, a pod Linuksem/Xvfb uruchamia też grę.

```bash
npm run preview
```

Ten skrypt robi zrzuty ekranu interfejsu (Chromium + Playwright, dane przykładowe).

## Licencje i zastrzeżenia

Kod launchera: MIT. Ikony: Font Awesome Free (CC BY 4.0), font: Montserrat (SIL OFL 1.1) – szczegóły w `CREDITS.md`.
Mody i paczki pochodzą z [Modrinth](https://modrinth.com) i należą do ich autorów.
Minecraft jest znakiem towarowym Mojang Studios / Microsoft. Hammer Launcher nie jest oficjalnym produktem Minecraft ani nie jest powiązany z Mojang Studios.
