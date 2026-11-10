# Hammer Client

Mod do Minecrafta (Fabric, wersja **1.21.1**) od HammerShop. Daje własne menu i HUD w grze, w stylu Lunar Client. Instaluje go automatycznie **Hammer Launcher** w instancjach Fabric 1.21.1.

## Co jest w środku
- **Menu główne Hammer** zamiast zwykłego ekranu tytułowego: logo, przyciski Jeden gracz / Wiele graczy / Ustawienia / Hammer Mody, przyciski Discord i Sklep, wskazówki.
- **Panel modułów** pod **prawym Shiftem**, w menu pauzy przycisk „Hammer Mody”: karty do włączania i wyłączania modułów, skala HUD, włączanie i wyłączanie menu Hammer.
- **Edytor HUD**: każdy element przeciągasz myszką gdzie chcesz. Pozycje zapisują się względem ekranu, więc pasują do każdej rozdzielczości.
- **Moduły HUD**:
  - widoczne od startu: FPS, CPS (lewy i prawy przycisk), ping, koordynaty z kierunkiem i biomem, klawisze (W A S D, mysz, spacja), zegar, efekty mikstur z czasem, pancerz z wytrzymałością,
  - do włączenia w panelu: prędkość, adres serwera, pamięć RAM, licznik dni.
- **Rozgrywka**: przybliżenie pod **C** (płynne, z kamerą filmową) i przełączany sprint.
- Teksty po polsku i angielsku.

Tylko ułatwienia i wygląd – nic, co daje przewagę na serwerach (żadnego X-raya, reacha itp.).

## Budowanie

Potrzebne: Java 21 i Gradle 8.12+ (wrapper nie jest dołączony).

```bash
gradle build
```

Gotowy plik: `build/libs/hammer-client-<wersja>.jar`. W GitHub Actions mod buduje się sam (zadanie *Hammer Client*). Plik trafia do instalatora launchera jako `resources/hammer-client.jar`.

## Pliki ustawień w instancji
- `config/hammerclient.json` – wybory gracza (moduły, układ HUD, skala, menu).
- `config/hammerclient-launcher.json` – zapisuje go launcher: link do Discorda, sklep, nazwa marki.
