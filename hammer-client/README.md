# Hammer Client

Mod do Minecrafta (Fabric) od HammerShop: własne menu, panel modułów i HUD w grze – w stylu Lunar Client i Feather Client. **Hammer Launcher** instaluje go sam w instancjach Fabric i Quilt.

Działa na Minecrafcie **od 1.21 do 26.3** (wszystkie wydania pomiędzy).

## Co jest w środku

- **Menu główne Hammer** zamiast zwykłego ekranu tytułowego: Jeden gracz, Wiele graczy, Hammer Mody, Ustawienia gry, Discord, Sklep, nowości i wskazówki.
- **Panel modułów** pod **prawym Shiftem** (i przyciskiem w menu pauzy): karty modułów z wyszukiwarką, kategorie, ustawienia każdego modułu (kolory z tęczą RGB, suwaki, listy), profile (np. osobny układ na PvP i na survival), kolor akcentu, wybór czcionki HUD.
- **Edytor HUD**: przeciągasz moduły myszką, przyciągają się do krawędzi i do siebie, kółko myszy zmienia rozmiar jednego modułu, a suwak **Rozmiar całego HUD** (50–150%) zmniejsza lub powiększa wszystko naraz. Prawy przycisk otwiera ustawienia. Pozycje są zapisane względem ekranu, więc pasują do każdej rozdzielczości.
- **Waypointy** pod **B**: zaznaczasz miejsce, w którym stoisz (nazwa, kolor), a znacznik z odległością widać potem na ekranie. Miejsce śmierci zapisuje się samo. Lista jest osobna dla każdego serwera i świata i zostaje na Twoim komputerze.
- **43 moduły**:
  - **HUD**: FPS, CPS, klawisze (W A S D, mysz, spacja), koordynaty z kierunkiem i biomem, kompas, pancerz z wytrzymałością, efekty mikstur, ping, zegar, podgląd ekwipunku, licznik przedmiotów (totemy, jabłka, perły…), combo, zasięg ciosu, cel (nazwa, pasek życia, odległość), licznik życia, nazwa bloku, prędkość, nasycenie, adres serwera, TPS serwera, pamięć RAM, dzień w grze, poziom światła, czas sesji, stoper, zabójstwa i śmierci, znak Hammer Client.
  - **Rozgrywka**: przybliżenie pod **C** (płynne, kółko myszy zmienia zoom), swobodna kamera (freelook) pod **lewym Altem**, waypointy, czat (godzina przy wiadomości – kliknięcie w nią kopiuje treść – i dużo dłuższa historia), przełączany sprint i skradanie, ostrzeżenie o niskiej wytrzymałości i o niskim życiu.
  - **Wygląd**: własny celownik, ping w liczbach na liście graczy (Tab), mniej zasłaniania (niższy ogień, bez nakładki dyni, bez winiety), fullbright, własna pora dnia, bezchmurne niebo, bez trzęsienia kamery, stały FOV.
- Teksty po polsku i angielsku (jak język gry).

Tylko wygląd i ułatwienia – nic, co daje nieuczciwą przewagę (żadnego X-raya, reacha, aimbota). Freelook jest domyślnie wyłączony, bo część serwerów PvP go zabrania.

## Hammer+

Dodatki dla osób z aktywnym Hammer+ (kod wpisuje się w Hammer Launcherze, który przekazuje to modowi). Wyłącznie wygląd:

- **odznaka HAMMER+** w menu głównym, panelu modułów i przy logo na HUD,
- **style HUD**: Szkło, Neon, Kontur (zwykły „Klasyczny” jest dla wszystkich),
- **tła menu**: Noc, Zorza, Lawa, Złoto oraz **własny obraz** (wybierany w launcherze),
- **celownik**: trzy dodatkowe kształty (strzałka, litera T, romb) i animacje (pulsowanie, oddech, dynamiczny),
- **peleryny Hammer** – widzi je każdy, kto gra na Hammer Client.

Opcje Hammer+ są w panelu oznaczone plusem. Bez Hammer+ są widoczne, ale zablokowane (kłódka) i działają jak ustawienie domyślne; wybór zostaje zapamiętany na później.

Peleryny innych graczy: mod pyta serwer sklepu o graczy, których właśnie widzisz (wysyła tylko ich identyfikatory kont, paczkami, w tle). Można to wyłączyć w panelu: Ustawienia → „Pokazuj peleryny Hammer innych graczy”.

Uwaga dla właściciela: kod moda jest publiczny, więc blokady po stronie gracza da się obejść przeróbką moda. Naprawdę chronione jest tylko to, co sprawdza serwer sklepu – czyli peleryna widoczna u innych graczy (i funkcje launchera korzystające z serwera).

## Test FPS

Launcher może uruchomić grę z pomiarem płynności: `-Dhammerclient.benchmark=<sekundy>` (od 5 do 180) i opcjonalnie `-Dhammerclient.benchmark.quit=true`. Mod czeka kilka sekund na wczytanie świata, mierzy każdą klatkę (w grze jednoosobowej powoli obraca kamerę), zapisuje wynik w `config/hammerclient/benchmark.json` i – jeśli tak ustawiono – zamyka grę:

```json
{"version":"2.2.0","mc":"1.21.4","seconds":20.0,"frames":4812,"avg":240.6,"low1":121.3,"min":88.0,"max":412.5,"finishedAt":1790000000000}
```

## Jak to jest zbudowane

```
common/              kod wspólny dla wszystkich wersji gry – bez żadnej klasy Minecrafta:
                     własny interfejs (Draw, Ui), ekrany, moduły, ustawienia, teksty, grafiki
versions/src/main/   warstwa gry: Platform i Game dla Minecrafta, rysowanie, ekran-most, mixiny
versions/targets.json  lista wersji: z czym się kompiluje i dla jakich wydań jest dany jar
versions/renames.txt   nazwy, które Mojang zmienił między wersjami
tools/               generatory grafik (czcionka, ikony) i plików językowych
```

Warstwa gry jest napisana **raz**. Różnice między wersjami Minecrafta są oznaczone w kodzie:

```java
//#if MC >= 1.21.6
g.pose().pushMatrix();
//#else
g.pose().pushPose();
//#endif
```

Przed kompilacją mały preprocesor (w `build.gradle`) zostawia właściwe linie dla każdej wersji. Dzięki temu poprawka trafia od razu do wszystkich wersji.

Dodanie nowej wersji gry: wpis w `versions/targets.json`, kompilacja, poprawienie miejsc, które kompilator wskaże (nowy warunek `//#if`).

## Budowanie

Potrzebna Java 25 (Gradle pobierze się sam).

```bash
./gradlew build dist
```

Wynik: `build/dist/` – jeden plik `.jar` na wersję gry i `versions.json` (który jar jest dla których wydań). Ten katalog launcher dołącza do instalatora jako `resources/hammer-client/`.

Tylko wybrane wersje (szybciej podczas pracy):

```bash
HAMMER_TARGETS=1.21.1,26.3 ./gradlew build dist
```

Testy (`./gradlew :common:test`) rysują wszystkie ekrany bez gry do `common/build/preview/*.png`.

W GitHub Actions mod buduje się sam, a każda wspierana wersja gry jest uruchamiana z modem (zadania *Hammer Client w grze*).

## Pliki ustawień w instancji

- `config/hammerclient.json` – wybory gracza (moduły, układ HUD, profile, wygląd).
- `config/hammerclient-launcher.json` – zapisuje go launcher: link do Discorda, sklep, nazwa marki, Hammer+ (`plus.active`, `plus.until`), wybrana peleryna (`cape`) i adres API sklepu (`api`).
- `config/hammerclient/waypoints.json` – waypointy gracza.
- `config/hammerclient/menu.png` – własne tło menu (kopiuje je launcher, Hammer+).
- `config/hammerclient/benchmark.json` – wynik ostatniego testu FPS.
