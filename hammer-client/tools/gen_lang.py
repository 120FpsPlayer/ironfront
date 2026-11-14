#!/usr/bin/env python3
"""Writes assets/hammerclient/lang/pl_pl.json and en_us.json from one table, so no key is ever missing in one of them.

    python3 tools/gen_lang.py
"""
import json
import os

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'common/src/main/resources/assets/hammerclient/lang')

# key: (polski, English). Keys without "hammerclient." are the game's own (key bindings).
RAW = {
    'key.hammerclient.menu': ('Panel modułów Hammer', 'Hammer module panel'),
    'key.hammerclient.zoom': ('Przybliżenie (zoom)', 'Zoom'),
    'key.hammerclient.freelook': ('Swobodna kamera (freelook)', 'Freelook'),
    'key.hammerclient.stopwatch': ('Stoper: start / stop', 'Stopwatch: start / stop'),
    'key.hammerclient.hud': ('Pokaż / ukryj HUD Hammer', 'Show / hide the Hammer HUD'),
    'key.hammerclient.waypoints': ('Waypointy Hammer', 'Hammer waypoints'),
    'category.hammerclient': ('Hammer Client', 'Hammer Client'),
    'key.category.hammerclient.main': ('Hammer Client', 'Hammer Client'),
}

T = {
    'on': ('Włączony', 'Enabled'), 'off': ('Wyłączony', 'Disabled'),
    'ui.hue': ('Kolor', 'Colour'), 'ui.opacity': ('Krycie', 'Opacity'), 'ui.chroma': ('Tęcza (RGB)', 'Rainbow (RGB)'),

    # main menu
    'title.by': ('od %s', 'by %s'),
    'title.singleplayer': ('Jeden gracz', 'Singleplayer'), 'title.singleplayer.sub': ('Twoje światy', 'Your worlds'),
    'title.multiplayer': ('Wiele graczy', 'Multiplayer'), 'title.multiplayer.sub': ('Serwery i znajomi', 'Servers and friends'),
    'title.mods': ('Hammer Mody', 'Hammer Mods'), 'title.mods.sub': ('Moduły, HUD i profile · %s', 'Modules, HUD and profiles · %s'),
    'title.options': ('Ustawienia gry', 'Game options'), 'title.options.sub': ('Grafika, dźwięk, sterowanie', 'Video, sound, controls'),
    'title.shop': ('Sklep', 'Shop'), 'title.quit': ('Wyjdź', 'Quit'),
    'welcome.title': ('Witaj w Hammer Client!', 'Welcome to Hammer Client!'),
    'welcome.text': ('Naciśnij %s, aby otworzyć panel modułów i ustawić swój HUD.', 'Press %s to open the module panel and set up your HUD.'),
    'news.title': ('Co nowego', "What's new"),
    'news.0': ('Znaczek H w Tab: widać, kto gra na Hammer Client', 'An H in Tab shows who plays on Hammer Client'),
    'news.1': ('11 nowych modułów HUD: wykres FPS, XP, portal…', '11 new HUD modules: FPS graph, XP, portal…'),
    'news.2': ('Waypointy, ping w liczbach w Tab, godzina na czacie', 'Waypoints, ping numbers in Tab, the time in chat'),
    'news.3': ('Hammer+: ruchome peleryny, skrzydła, aureola, czapki', 'Hammer+: moving capes, wings, a halo, hats'),
    'news.4': ('Działa od Minecrafta 1.21 do 26.3', 'Works from Minecraft 1.21 to 26.3'),
    'tip.0': ('Prawy Shift otwiera panel modułów Hammer.', 'Right Shift opens the Hammer module panel.'),
    'tip.1': ('Przytrzymaj C, aby przybliżyć. Kółko myszy zmienia zoom.', 'Hold C to zoom in. The mouse wheel changes the zoom.'),
    'tip.2': ('W edytorze HUD kliknij moduł – każdy ma własny rozmiar (− / +).', 'In the HUD editor click a module – each one has its own size (− / +).'),
    'tip.3': ('Dołącz do naszego Discorda – giveawaye, pomoc i nowości.', 'Join our Discord – giveaways, help and news.'),
    'tip.4': ('F2 robi zrzut ekranu – znajdziesz go w Galerii launchera.', "F2 takes a screenshot – it shows up in the launcher's Gallery."),
    'tip.5': ('Naciśnij B, aby dodać waypoint tam, gdzie stoisz.', 'Press B to add a waypoint where you stand.'),

    # pause menu
    'pause.mods': ('Hammer Mody', 'Hammer Mods'), 'pause.discord': ('Nasz Discord', 'Our Discord'),

    # module panel
    'menu.all': ('Wszystkie', 'All'), 'menu.settings': ('Ustawienia', 'Settings'),
    'menu.settings.sub': ('Wygląd klienta, profile i klawisze', 'Client look, profiles and keys'),
    'menu.profile': ('PROFIL', 'PROFILE'), 'menu.edit_hud': ('Edytuj HUD', 'Edit HUD'),
    'menu.enabled_count': ('Włączone: %s z %s', '%s of %s enabled'), 'menu.search': ('Szukaj modułu…', 'Search modules…'),
    'menu.nothing': ('Nie ma takiego modułu', 'No module like that'), 'menu.options': ('Ustawienia modułu', 'Module options'),
    'menu.back': ('Wróć', 'Back'), 'menu.no_options': ('Ten moduł nie ma dodatkowych ustawień.', 'This module has no extra options.'),
    'menu.reset': ('Przywróć domyślne', 'Reset to defaults'), 'menu.place': ('Ustaw na ekranie', 'Place on screen'), 'menu.done': ('Gotowe', 'Done'),
    'category.hud': ('HUD', 'HUD'), 'category.gameplay': ('Rozgrywka', 'Gameplay'), 'category.visual': ('Wygląd', 'Visuals'),

    # client settings
    'settings.look': ('Wygląd', 'Look'), 'settings.accent': ('Kolor akcentu', 'Accent colour'),
    'settings.animations': ('Animacje interfejsu', 'Interface animations'),
    'settings.custom_menu': ('Menu główne Hammer', 'Hammer main menu'),
    'settings.pause_buttons': ('Przyciski Hammer w menu pauzy', 'Hammer buttons in the pause menu'),
    'settings.hud_visible': ('Pokazuj HUD Hammer', 'Show the Hammer HUD'), 'settings.hud_font': ('Czcionka HUD', 'HUD font'),
    'settings.profiles': ('Profile', 'Profiles'), 'settings.profile_current': ('Aktywny profil: %s', 'Active profile: %s'),
    'settings.profile_new': ('Nowy', 'New'), 'settings.profile_delete': ('Usuń', 'Delete'), 'settings.profile_name': ('Profil %s', 'Profile %s'),
    'settings.keys': ('Klawisze', 'Keys'), 'settings.change_keys': ('Zmień w sterowaniu', 'Change in Controls'),
    'key.menu': ('Panel modułów', 'Module panel'), 'key.zoom': ('Przybliżenie', 'Zoom'), 'key.freelook': ('Swobodna kamera', 'Freelook'),
    'key.stopwatch': ('Stoper: start / stop', 'Stopwatch: start / stop'), 'key.hud': ('Pokaż / ukryj HUD', 'Show / hide HUD'),
    'key.waypoints': ('Waypointy', 'Waypoints'),
    'settings.menu_background': ('Tło menu', 'Menu background'), 'settings.hud_style': ('Styl HUD', 'HUD style'),
    'settings.hud_scale': ('Rozmiar całego HUD', 'Size of the whole HUD'),
    'settings.other_capes': ('Pokazuj peleryny Hammer innych graczy', "Show other players' Hammer capes"),
    'settings.other_cosmetics': ('Pokazuj dodatki innych graczy (skrzydła, aureole, czapki)', "Show other players' cosmetics (wings, halos, hats)"),

    # Hammer+
    'plus.locked': ('To opcja Hammer+ – kod wpiszesz w Hammer Launcherze', 'This is a Hammer+ option – enter your code in Hammer Launcher'),
    'plus.inactive': ('Nieaktywny – kod wpisujesz w Hammer Launcherze', 'Not active – enter your code in Hammer Launcher'),
    'plus.active_until': ('Aktywny do %s', 'Active until %s'), 'plus.active_forever': ('Aktywny bezterminowo', 'Active with no end date'),
    'plus.get': ('Zobacz w sklepie', 'See in the shop'),
    'plus.cape': ('Twoja peleryna: %s', 'Your cape: %s'), 'plus.cape_none': ('brak', 'none'),
    'plus.in_launcher': ('wybierasz w launcherze', 'chosen in the launcher'),
    'plus.custom_missing': ('obraz wybierzesz w launcherze (Hammer+)', 'pick the picture in the launcher (Hammer+)'),
    'cape.hammer': ('Hammer', 'Hammer'), 'cape.gold': ('Złota', 'Gold'), 'cape.ember': ('Żar', 'Ember'),
    'cape.royal': ('Królewska', 'Royal'), 'cape.frost': ('Mróz', 'Frost'), 'cape.crimson': ('Karmazyn', 'Crimson'),
    'cape.custom': ('Własna', 'Your own'),
    'cape.flame': ('Płomień', 'Flame'), 'cape.sparks': ('Iskry', 'Sparks'), 'cape.waves': ('Fale', 'Waves'),
    'plus.cosmetics': ('Twoje dodatki: %s', 'Your cosmetics: %s'),
    'cosmetic.angel': ('Anielskie skrzydła', 'Angel wings'), 'cosmetic.dragon': ('Smocze skrzydła', 'Dragon wings'),
    'cosmetic.halo': ('Aureola', 'Halo'), 'cosmetic.crown': ('Korona', 'Crown'), 'cosmetic.tophat': ('Cylinder', 'Top hat'),
    'cosmetic.santa': ('Czapka Mikołaja', 'Santa hat'),

    # waypoints
    'waypoints.title': ('Waypointy', 'Waypoints'),
    'waypoints.sub': ('%s  ·  %s  ·  %s z %s', '%s  ·  %s  ·  %s of %s'),
    'waypoints.name': ('Nazwa, np. Dom', 'Name, e.g. Home'), 'waypoints.add': ('Dodaj tutaj', 'Add here'),
    'waypoints.default_name': ('Punkt %s', 'Point %s'),
    'waypoints.added': ('Dodano: %s', 'Added: %s'), 'waypoints.deleted': ('Usunięto: %s', 'Deleted: %s'),
    'waypoints.copied': ('Skopiowano: %s', 'Copied: %s'),
    'waypoints.empty': ('Nie masz tu jeszcze żadnego waypointa', 'No waypoints here yet'),
    'waypoints.empty.sub': ('Stań w ważnym miejscu, wpisz nazwę i kliknij „Dodaj tutaj”.', 'Stand somewhere important, type a name and click "Add here".'),
    'waypoints.hint': ('Waypointy widzisz tylko Ty. Są zapisane osobno dla każdego serwera i świata.', 'Only you see your waypoints. They are kept separately for every server and world.'),
    'waypoints.delete': ('Usuń', 'Delete'), 'waypoints.copy': ('Kopiuj współrzędne', 'Copy coordinates'),
    'waypoints.hide': ('Ukryj na ekranie', 'Hide on screen'), 'waypoints.show': ('Pokaż na ekranie', 'Show on screen'),
    'waypoint.death': ('Śmierć', 'Death'),
    'chat.copy_hint': ('Kliknij, aby skopiować wiadomość', 'Click to copy the message'),
    'dim.overworld': ('Świat', 'Overworld'), 'dim.nether': ('Nether', 'Nether'), 'dim.end': ('Kres', 'The End'),

    # FPS test
    'benchmark.warmup': ('Test FPS: wczytuję świat…', 'FPS test: loading the world…'),
    'benchmark.running': ('Test FPS: jeszcze %s s', 'FPS test: %s s left'),
    'benchmark.result': ('Wynik: średnio %s FPS  ·  1% low %s FPS', 'Result: %s FPS average  ·  1% low %s FPS'),

    # HUD editor
    'editor.title': ('Edytor HUD', 'HUD editor'),
    'editor.hint': ('Przeciągaj moduły. Kliknij jeden, aby zmienić jego rozmiar.', 'Drag the modules. Click one to change its size.'),
    'editor.hint2': ('Rozmiar zmienisz przyciskami - i +, uchwytem w rogu albo kółkiem myszy. Prawy przycisk otwiera ustawienia modułu.', 'Change the size with the - and + buttons, the corner handle or the mouse wheel. A right click opens the module options.'),
    'editor.size_of': ('Rozmiar: %s', 'Size: %s'),
    'editor.mods': ('Moduły', 'Modules'), 'editor.reset': ('Reset', 'Reset'),

    # HUD texts
    'hud.facing': ('Kierunek', 'Facing'), 'hud.biome': ('Biom', 'Biome'), 'hud.day': ('Dzień', 'Day'), 'hud.speed': ('Prędkość', 'Speed'),
    'hud.kills': ('Zabójstwa', 'Kills'), 'hud.deaths': ('Śmierci', 'Deaths'),
    'hud.reach': ('Zasięg', 'Reach'), 'hud.saturation': ('Nasycenie', 'Saturation'), 'hud.stopwatch': ('Stoper', 'Stopwatch'),
    'hud.session': ('Sesja', 'Session'), 'hud.light': ('Światło', 'Light'), 'hud.lmb': ('LPM', 'LMB'), 'hud.rmb': ('PPM', 'RMB'),
    'hud.sprinting': ('Sprint włączony', 'Sprint toggled'),
    'hud.health': ('Życie', 'Health'), 'hud.armor': ('Pancerz', 'Armour'), 'hud.low_health': ('Mało życia: %s serca', 'Low health: %s hearts'),
    'hud.sample_target': ('Steve', 'Steve'), 'hud.sample_block': ('Ruda diamentu', 'Diamond Ore'),
    'hud.durability': ('Niska wytrzymałość: %s (%s)', 'Low durability: %s (%s)'),
    'hud.sample_effect': ('Szybkość', 'Speed'), 'hud.sample_effect2': ('Siła', 'Strength'), 'hud.sample_item': ('Diamentowy kilof', 'Diamond Pickaxe'),
    'hud.level': ('Poziom', 'Level'), 'hud.air': ('Powietrze', 'Air'), 'hud.world_time': ('Godzina', 'Time'), 'hud.moon': ('Księżyc', 'Moon'),
    'hud.weather': ('Pogoda', 'Weather'), 'hud.players': ('Gracze', 'Players'), 'hud.item_durability': ('Wytrzymałość', 'Durability'),
    'hud.carried': ('W ekwipunku', 'Carried'), 'hud.rotation': ('Obrót', 'Rotation'), 'hud.nether': ('Nether', 'Nether'),
    'hud.overworld': ('Świat', 'Overworld'), 'hud.in_chunk': ('W chunku', 'In chunk'), 'hud.attack': ('Atak', 'Attack'),
    'moon.0': ('Pełnia', 'Full moon'), 'moon.1': ('Ubywający garb', 'Waning gibbous'), 'moon.2': ('Ostatnia kwadra', 'Last quarter'),
    'moon.3': ('Ubywający sierp', 'Waning crescent'), 'moon.4': ('Nów', 'New moon'), 'moon.5': ('Przybywający sierp', 'Waxing crescent'),
    'moon.6': ('Pierwsza kwadra', 'First quarter'), 'moon.7': ('Przybywający garb', 'Waxing gibbous'),
    'weather.0': ('Pogodnie', 'Clear'), 'weather.1': ('Deszcz', 'Rain'), 'weather.2': ('Burza', 'Thunderstorm'),
    'direction.north': ('północ', 'north'), 'direction.south': ('południe', 'south'), 'direction.east': ('wschód', 'east'), 'direction.west': ('zachód', 'west'),
    'compass.n': ('N', 'N'), 'compass.e': ('E', 'E'), 'compass.s': ('S', 'S'), 'compass.w': ('W', 'W'),
}

MODULES = {
    'fps': ('Licznik FPS', 'Ile klatek na sekundę ma gra.', 'FPS counter', 'Frames per second.'),
    'cps': ('CPS', 'Kliknięcia na sekundę – lewy i prawy przycisk.', 'CPS', 'Clicks per second – left and right button.'),
    'keystrokes': ('Klawisze', 'Podświetla W A S D, myszkę i spację, gdy je wciskasz.', 'Keystrokes', 'Lights up W A S D, mouse buttons and space as you press them.'),
    'coords': ('Koordynaty', 'Pozycja XYZ, kierunek i biom.', 'Coordinates', 'XYZ position, facing and biome.'),
    'compass': ('Kompas', 'Pasek kierunków, który przesuwa się, gdy się obracasz.', 'Direction HUD', 'A strip of directions that slides as you turn.'),
    'armor': ('Pancerz', 'Pancerz i trzymane narzędzia z wytrzymałością.', 'Armour status', 'Armour and held tools with durability.'),
    'potions': ('Efekty', 'Aktywne efekty mikstur z czasem do końca.', 'Potion effects', 'Active effects with time left.'),
    'ping': ('Ping', 'Opóźnienie do serwera w milisekundach.', 'Ping', 'Latency to the server in milliseconds.'),
    'clock': ('Zegar', 'Aktualna godzina – żeby nie zagrać całej nocy.', 'Clock', 'The current time of day.'),
    'inventory': ('Podgląd ekwipunku', 'Trzy rzędy ekwipunku zawsze na ekranie.', 'Inventory HUD', 'The three inventory rows, always on screen.'),
    'items': ('Licznik przedmiotów', 'Ile masz totemów, złotych jabłek, pereł i strzał.', 'Item counter', 'How many totems, golden apples, pearls and arrows you carry.'),
    'combo': ('Combo', 'Liczy trafienia z rzędu, zanim sam oberwiesz.', 'Combo counter', 'Counts hits in a row until you get hit.'),
    'reach': ('Zasięg ciosu', 'Z jakiej odległości trafił ostatni cios.', 'Reach display', 'The distance of your last hit.'),
    'speed': ('Prędkość', 'Jak szybko się poruszasz.', 'Speedometer', 'How fast you are moving.'),
    'saturation': ('Nasycenie', 'Ukryty pasek głodu: ile jeszcze „paliwa” masz.', 'Saturation', 'The hidden hunger value: how much "fuel" is left.'),
    'server': ('Adres serwera', 'Na jakim serwerze grasz.', 'Server address', 'Which server you are on.'),
    'tps': ('TPS serwera', 'Czy serwer nadąża (20 = idealnie).', 'Server TPS', 'Whether the server keeps up (20 = perfect).'),
    'memory': ('Pamięć RAM', 'Ile pamięci zużywa gra.', 'Memory', 'How much memory the game uses.'),
    'day': ('Licznik dni', 'Który to dzień w świecie gry.', 'Day counter', 'Which day it is in the world.'),
    'light': ('Poziom światła', 'Światło pod nogami – przy 0 pojawiają się potwory.', 'Light level', 'Light at your feet – monsters spawn at 0.'),
    'session': ('Czas sesji', 'Jak długo już grasz.', 'Session time', 'How long you have been playing.'),
    'stopwatch': ('Stoper', 'Mierzy czas – do speedrunów i wyścigów.', 'Stopwatch', 'Times your runs and races.'),
    'fpsgraph': ('Wykres FPS', 'Płynność z ostatnich sekund jako wykres – spadki widać od razu.', 'FPS graph', 'The frame rate of the last seconds as a graph – dips stand out.'),
    'helditem': ('Przedmiot w ręce', 'Ile sztuk trzymanego przedmiotu masz w ekwipunku albo ile zostało narzędzia.', 'Held item', 'How many of the held item you carry, or how much of the tool is left.'),
    'xp': ('Doświadczenie', 'Poziom i postęp do następnego jako liczby.', 'Experience', 'Your level and the progress to the next one as numbers.'),
    'air': ('Powietrze', 'Ile sekund oddechu zostało pod wodą.', 'Air', 'How many seconds of breath are left under water.'),
    'attack': ('Siła ataku', 'Na ile naładowany jest następny cios – 100% to pełne obrażenia.', 'Attack charge', 'How far your next hit is charged – 100% is full damage.'),
    'players': ('Gracze online', 'Ilu graczy jest na serwerze i ilu z nich gra na Hammer Client.', 'Players online', 'How many players are on the server and how many of them use Hammer Client.'),
    'worldtime': ('Godzina w świecie', 'Zegar świata gry (wschód słońca to 6:00) i faza księżyca.', 'World time', "The world's own clock (sunrise is 6:00) and the moon phase."),
    'weatherhud': ('Pogoda', 'Prawdziwa pogoda w świecie – także gdy masz wyłączony deszcz.', 'Weather', 'The real weather of the world – even with rain switched off.'),
    'rotation': ('Obrót', 'Kąt patrzenia: w poziomie i w pionie.', 'Rotation', 'Where you look: yaw and pitch.'),
    'portal': ('Kalkulator portalu', 'Koordynaty tego miejsca w Netherze (albo w zwykłym świecie).', 'Portal calculator', 'The coordinates of this spot in the Nether (or in the Overworld).'),
    'chunk': ('Chunk', 'W którym chunku stoisz i w którym jego miejscu.', 'Chunk', 'Which chunk you stand in and where inside it.'),
    'tabbadge': ('Znaczek Hammer w Tab', 'Litera H przed nickiem graczy Hammer Client na liście graczy, a H+ dla Hammer+.', 'Hammer badge in Tab', 'An H in front of Hammer Client players in the player list, and H+ for Hammer+.'),
    'watermark': ('Logo Hammer', 'Małe logo Hammer Client w rogu ekranu.', 'Hammer logo', 'A small Hammer Client logo in a corner.'),
    'kills': ('Zabójstwa i śmierci', 'Ile razy wygrałeś, a ile zginąłeś w tej sesji.', 'Kills and deaths', 'How many fights you won and lost this session.'),
    'waypoints': ('Waypointy', 'Zaznacz dom, kopalnię czy portal i zawsze wiedz, gdzie są.', 'Waypoints', 'Mark your home, mine or portal and always know where they are.'),
    'chat': ('Czat', 'Godzina przy każdej wiadomości i dużo dłuższa historia.', 'Chat', 'The time next to every message and a much longer history.'),
    'tabping': ('Ping w liczbach', 'Lista graczy (Tab) pokazuje ping jako liczbę, nie kreski.', 'Ping numbers', 'The player list (Tab) shows ping as a number, not bars.'),
    'overlays': ('Mniej zasłaniania', 'Niższy ogień, bez nakładki dyni i bez ciemnej winiety.', 'Clean view', 'Lower fire, no pumpkin overlay and no dark vignette.'),
    'zoom': ('Przybliżenie', 'Przybliża widok jak luneta.', 'Zoom', 'Zooms in like a spyglass.'),
    'freelook': ('Swobodna kamera', 'Rozglądaj się dookoła bez obracania postaci.', 'Freelook', 'Look around without turning your character.'),
    'togglesprint': ('Przełączany sprint', 'Sprint włącza się jednym wciśnięciem i trzyma sam.', 'Toggle sprint', 'Sprint switches on with one press and stays on.'),
    'togglesneak': ('Przełączane skradanie', 'Skradanie włącza się jednym wciśnięciem.', 'Toggle sneak', 'Sneaking switches on with one press.'),
    'durability': ('Ostrzeżenie o wytrzymałości', 'Ostrzega, zanim pancerz lub narzędzie się zepsuje.', 'Durability warning', 'Warns before armour or a tool breaks.'),
    'crosshair': ('Własny celownik', 'Twój kształt, rozmiar i kolor celownika.', 'Custom crosshair', 'Your own crosshair shape, size and colour.'),
    'target': ('Cel', 'Kogo masz na celowniku: nazwa, pasek życia i odległość.', 'Target HUD', 'Who you are aiming at: name, health bar and distance.'),
    'health': ('Licznik życia', 'Życie i pancerz jako liczby – łatwiej niż liczyć serca.', 'Health display', 'Health and armour as numbers – easier than counting hearts.'),
    'blockinfo': ('Co to za blok', 'Nazwa bloku, na który patrzysz.', 'Block info', 'The name of the block you are looking at.'),
    'lowhealth': ('Ostrzeżenie o życiu', 'Miga, gdy zostaje Ci mało serc.', 'Low health warning', 'Flashes when you are down to a few hearts.'),
    'fullbright': ('Fullbright', 'Jasno w jaskiniach i w nocy, bez pochodni.', 'Fullbright', 'Bright caves and nights, no torches needed.'),
    'timechanger': ('Pora dnia', 'Własna pora dnia – widzisz ją tylko Ty.', 'Time changer', 'Your own time of day – only you see it.'),
    'weather': ('Bezchmurne niebo', 'Wyłącza deszcz i burzę na Twoim ekranie.', 'Clear weather', 'No rain or thunder on your screen.'),
    'nohurtcam': ('Bez trzęsienia kamery', 'Kamera nie drga, gdy dostajesz obrażenia.', 'No hurt cam', 'The camera does not shake when you take damage.'),
    'staticfov': ('Stały FOV', 'Pole widzenia nie skacze przy sprincie.', 'Static FOV', 'The field of view does not jump when sprinting.'),
}

NOTES = {
    'zoom': ('Przytrzymaj %s. Klawisz zmienisz w sterowaniu gry.', 'Hold %s. Change the key in the game controls.'),
    'freelook': ('Klawisz: %s. Na niektórych serwerach PvP freelook jest zabroniony – sprawdź regulamin.', 'Key: %s. Some PvP servers forbid freelook – check their rules.'),
    'stopwatch': ('Start / stop: %s (ustaw klawisz w sterowaniu gry).', 'Start / stop: %s (set the key in the game controls).'),
    'combo': ('Liczone po Twojej stronie – serwer może uznać cios inaczej.', 'Counted on your side – the server may see a hit differently.'),
    'kills': ('Liczone po Twojej stronie: zabójstwo to cel, który zginął tuż po Twoim ciosie.', 'Counted on your side: a kill is a target that died right after your hit.'),
    'waypoints': ('Lista i dodawanie: %s. Punkty widzisz tylko Ty.', 'List and adding: %s. Only you see the points.'),
    'chat': ('Kliknij godzinę przy wiadomości, żeby skopiować jej treść.', 'Click the time next to a message to copy its text.'),
    'crosshair': ('Opcje z plusem (+) są dla Hammer+.', 'Options marked with a plus (+) are for Hammer+.'),
    'reach': ('Odległość liczona po Twojej stronie w chwili ciosu.', 'Distance measured on your side at the moment of the hit.'),
    'tabbadge': ('Mod pyta serwer Hammer o graczy z listy (same identyfikatory kont) i zgłasza, że grasz na Hammer Client.', 'The client asks the Hammer server about the players on the list (account ids only) and tells it that you play on Hammer Client.'),
    'players': ('Graczy Hammer liczy moduł „Znaczek Hammer w Tab”.', 'Hammer players are counted by the "Hammer badge in Tab" module.'),
    'fullbright': ('Zmienia tylko jasność obrazu – jak bardzo wysoka „Jasność” w ustawieniach.', 'Only changes brightness – like a very high "Brightness" option.'),
}

SETTINGS = {
    'scale': ('Rozmiar', 'Size'), 'format': ('Format tekstu', 'Text format'), 'text_color': ('Kolor tekstu', 'Text colour'),
    'label_color': ('Kolor etykiety', 'Label colour'), 'background': ('Tło', 'Background'), 'background_color': ('Kolor tła', 'Background colour'),
    'shadow': ('Cień tekstu', 'Text shadow'), 'right_button': ('Prawy przycisk myszy', 'Right mouse button'), 'layout': ('Układ', 'Layout'),
    'direction': ('Kierunek świata', 'Facing direction'), 'biome': ('Biom', 'Biome'), 'seconds': ('Sekundy', 'Seconds'),
    'twelve_hour': ('Format 12-godzinny', '12-hour clock'), 'details': ('Zużycie w GB', 'Usage in GB'), 'unit': ('Jednostka', 'Unit'),
    'mouse_buttons': ('Przyciski myszy', 'Mouse buttons'), 'show_cps': ('CPS na przyciskach', 'CPS on the buttons'), 'space_bar': ('Spacja', 'Space bar'),
    'pressed_color': ('Kolor wciśnięcia', 'Pressed colour'), 'width': ('Szerokość', 'Width'), 'degrees': ('Stopnie', 'Degrees'),
    'blink': ('Miganie przed końcem', 'Blink before it ends'), 'durability': ('Wytrzymałość', 'Durability'), 'hands': ('Trzymane przedmioty', 'Held items'),
    'slot_color': ('Kolor pól', 'Slot colour'), 'hide_when_empty': ('Ukryj, gdy pusty', 'Hide when empty'),
    'totems': ('Totemy', 'Totems'), 'golden_apples': ('Złote jabłka', 'Golden apples'), 'ender_pearls': ('Perły Endu', 'Ender pearls'),
    'arrows': ('Strzały', 'Arrows'), 'crystals': ('Kryształy Endu', 'End crystals'), 'xp_bottles': ('Butelki z doświadczeniem', 'XP bottles'),
    'threshold': ('Ostrzegaj poniżej', 'Warn below'), 'show_name': ('Napis „Hammer Client”', '"Hammer Client" text'),
    'zoom_level': ('Siła przybliżenia', 'Zoom strength'), 'smooth_zoom': ('Płynne przybliżanie', 'Smooth zooming'),
    'smooth_camera': ('Filmowa kamera podczas zoomu', 'Cinematic camera while zooming'), 'scroll_zoom': ('Kółko myszy zmienia zoom', 'Mouse wheel changes zoom'),
    'key_mode': ('Działanie klawisza', 'Key behaviour'), 'indicator': ('Wskaźnik na HUD', 'HUD indicator'), 'time_of_day': ('Pora dnia', 'Time of day'),
    'crosshair_style': ('Kształt', 'Shape'), 'size': ('Długość', 'Length'), 'gap': ('Odstęp od środka', 'Gap'), 'thickness': ('Grubość', 'Thickness'),
    'color': ('Kolor', 'Colour'), 'outline': ('Czarna obwódka', 'Black outline'), 'center_dot': ('Kropka w środku', 'Centre dot'),
    'hide_third_person': ('Ukryj w widoku z trzeciej osoby', 'Hide in third person'),
    'crosshair_anim': ('Animacja', 'Animation'),
    'death_point': ('Zaznacz miejsce śmierci', 'Mark where you died'), 'show_distance': ('Pokazuj odległość', 'Show the distance'),
    'marker_scale': ('Rozmiar znaczników', 'Marker size'),
    'ping_colors': ('Kolor zależny od pingu', 'Colour by ping'),
    'timestamps': ('Godzina przy wiadomości', 'Time next to messages'), 'seconds': ('Z sekundami', 'With seconds'),
    'click_to_copy': ('Kliknięcie godziny kopiuje wiadomość', 'Clicking the time copies the message'),
    'long_history': ('Długa historia czatu', 'Long chat history'),
    'low_fire': ('Obniż ogień na ekranie', 'Lower the fire on screen'), 'no_pumpkin': ('Bez nakładki dyni', 'No pumpkin overlay'),
    'no_vignette': ('Bez ciemnej winiety', 'No dark vignette'),
    'show_deaths': ('Pokazuj śmierci', 'Show deaths'), 'show_ratio': ('Pokazuj K/D', 'Show K/D'),
    'distance': ('Odległość do celu', 'Distance to the target'), 'only_players': ('Tylko gracze', 'Players only'),
    'xp_progress': ('Postęp w procentach', 'Progress in percent'), 'always_visible': ('Zawsze widoczny', 'Always visible'),
    'moon_phase': ('Faza księżyca', 'Moon phase'), 'hammer_players': ('Gracze Hammer Client', 'Hammer Client players'),
    'total_count': ('Liczba w ekwipunku', 'Count in inventory'), 'in_chunk': ('Miejsce w chunku', 'Place in the chunk'),
    'graph_color': ('Kolor wykresu', 'Graph colour'), 'lowest': ('Najniższa wartość', 'Lowest value'),
    'announce': ('Pokazuj innym, że gram na Hammer Client', 'Show others that I play on Hammer Client'),
    'own_badge': ('Znaczek przy moim nicku', 'Badge next to my own name'),
    'armor_points': ('Punkty pancerza', 'Armour points'), 'hearts': ('Ostrzegaj poniżej (serca)', 'Warn below (hearts)'),
}

OPTIONS = {
    'label_value': ('FPS: 120', 'FPS: 120'), 'value_label': ('120 FPS', '120 FPS'), 'brackets': ('[120 FPS]', '[120 FPS]'),
    'one_line': ('W jednej linii', 'One line'), 'three_lines': ('X, Y, Z osobno', 'X, Y, Z on separate lines'),
    'blocks_s': ('Bloki na sekundę', 'Blocks per second'), 'km_h': ('km/h', 'km/h'),
    'vertical': ('Pionowo', 'Vertical'), 'horizontal': ('Poziomo', 'Horizontal'),
    'number': ('Liczba', 'Number'), 'percent': ('Procent', 'Percent'), 'hidden': ('Ukryta', 'Hidden'),
    'hold': ('Przytrzymaj', 'Hold'), 'toggle': ('Przełącz', 'Toggle'),
    'time_morning': ('Poranek', 'Morning'), 'time_noon': ('Południe', 'Noon'), 'time_sunset': ('Zachód słońca', 'Sunset'),
    'time_night': ('Noc', 'Night'), 'time_midnight': ('Północ', 'Midnight'), 'time_sunrise': ('Wschód słońca', 'Sunrise'),
    'cross': ('Krzyżyk', 'Cross'), 'plus': ('Plus', 'Plus'), 'dot': ('Kropka', 'Dot'), 'circle': ('Okrąg', 'Circle'), 'square': ('Kwadrat', 'Square'),
    'chevron': ('Strzałka', 'Chevron'), 'tee': ('Litera T', 'T shape'), 'diamond': ('Romb', 'Diamond'),
    'anim_none': ('Brak', 'None'), 'anim_pulse': ('Pulsowanie', 'Pulse'), 'anim_breathe': ('Oddech', 'Breathing'),
    'anim_dynamic': ('Dynamiczny (ruch i ciosy)', 'Dynamic (movement and hits)'),
    'hud_classic': ('Klasyczny', 'Classic'), 'hud_glass': ('Szkło', 'Glass'), 'hud_neon': ('Neon', 'Neon'), 'hud_outline': ('Kontur', 'Outline'),
    'bg_default': ('Zachód słońca', 'Dusk'), 'bg_night': ('Noc', 'Night'), 'bg_aurora': ('Zorza', 'Aurora'), 'bg_lava': ('Lawa', 'Lava'),
    'bg_gold': ('Złoto', 'Gold'), 'bg_custom': ('Własny obraz', 'Your own picture'),
    'font_minecraft': ('Minecraft (pikselowa)', 'Minecraft (pixel)'), 'font_hammer': ('Hammer (gładka)', 'Hammer (smooth)'),
}

pl, en = {}, {}
for k, (a, b) in RAW.items():
    pl[k], en[k] = a, b
for k, (a, b) in T.items():
    pl['hammerclient.' + k], en['hammerclient.' + k] = a, b
for k, (a, b, c, d) in MODULES.items():
    pl[f'hammerclient.module.{k}'], pl[f'hammerclient.module.{k}.desc'] = a, b
    en[f'hammerclient.module.{k}'], en[f'hammerclient.module.{k}.desc'] = c, d
for k, (a, b) in NOTES.items():
    pl[f'hammerclient.module.{k}.note'], en[f'hammerclient.module.{k}.note'] = a, b
for k, (a, b) in SETTINGS.items():
    pl['hammerclient.setting.' + k], en['hammerclient.setting.' + k] = a, b
for k, (a, b) in OPTIONS.items():
    pl['hammerclient.option.' + k], en['hammerclient.option.' + k] = a, b

os.makedirs(OUT, exist_ok=True)
for name, data in (('pl_pl', pl), ('en_us', en)):
    with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
print(len(pl), 'keys')
