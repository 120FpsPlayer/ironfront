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
    'news.title': ('Co nowego', "What's new"),
    'news.0': ('Działa od Minecrafta 1.21 do 26.3', 'Works from Minecraft 1.21 to 26.3'),
    'news.1': ('Prawie 40 modułów z własnymi ustawieniami', 'Nearly 40 modules, each with its own options'),
    'news.2': ('Edytor HUD z przyciąganiem i skalowaniem', 'HUD editor with snapping and scaling'),
    'news.3': ('Profile: osobny układ na PvP i survival', 'Profiles: one layout for PvP, one for survival'),
    'news.4': ('Własny celownik, freelook i fullbright', 'Custom crosshair, freelook and fullbright'),
    'tip.0': ('Prawy Shift otwiera panel modułów Hammer.', 'Right Shift opens the Hammer module panel.'),
    'tip.1': ('Przytrzymaj C, aby przybliżyć. Kółko myszy zmienia zoom.', 'Hold C to zoom in. The mouse wheel changes the zoom.'),
    'tip.2': ('W edytorze HUD kółko myszy zmienia rozmiar modułu.', 'In the HUD editor the mouse wheel resizes a module.'),
    'tip.3': ('Dołącz do naszego Discorda – giveawaye, pomoc i nowości.', 'Join our Discord – giveaways, help and news.'),
    'tip.4': ('F2 robi zrzut ekranu – znajdziesz go w Galerii launchera.', "F2 takes a screenshot – it shows up in the launcher's Gallery."),
    'tip.5': ('Profile pozwalają mieć inny HUD do PvP, a inny do budowania.', 'Profiles let you keep one HUD for PvP and another for building.'),

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

    # HUD editor
    'editor.title': ('Edytor HUD', 'HUD editor'),
    'editor.hint': ('Przeciągnij moduły tam, gdzie chcesz je mieć.', 'Drag the modules where you want them.'),
    'editor.hint2': ('Kółko myszy – rozmiar  ·  prawy przycisk – ustawienia  ·  Esc – zapisz', 'Mouse wheel – size  ·  right click – options  ·  Esc – save'),
    'editor.mods': ('Moduły', 'Modules'), 'editor.reset': ('Reset', 'Reset'),

    # HUD texts
    'hud.facing': ('Kierunek', 'Facing'), 'hud.biome': ('Biom', 'Biome'), 'hud.day': ('Dzień', 'Day'), 'hud.speed': ('Prędkość', 'Speed'),
    'hud.reach': ('Zasięg', 'Reach'), 'hud.saturation': ('Nasycenie', 'Saturation'), 'hud.stopwatch': ('Stoper', 'Stopwatch'),
    'hud.session': ('Sesja', 'Session'), 'hud.light': ('Światło', 'Light'), 'hud.lmb': ('LPM', 'LMB'), 'hud.rmb': ('PPM', 'RMB'),
    'hud.sprinting': ('Sprint włączony', 'Sprint toggled'),
    'hud.health': ('Życie', 'Health'), 'hud.armor': ('Pancerz', 'Armour'), 'hud.low_health': ('Mało życia: %s serca', 'Low health: %s hearts'),
    'hud.sample_target': ('Steve', 'Steve'), 'hud.sample_block': ('Ruda diamentu', 'Diamond Ore'),
    'hud.durability': ('Niska wytrzymałość: %s (%s)', 'Low durability: %s (%s)'),
    'hud.sample_effect': ('Szybkość', 'Speed'), 'hud.sample_effect2': ('Siła', 'Strength'), 'hud.sample_item': ('Diamentowy kilof', 'Diamond Pickaxe'),
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
    'watermark': ('Logo Hammer', 'Małe logo Hammer Client w rogu ekranu.', 'Hammer logo', 'A small Hammer Client logo in a corner.'),
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
    'reach': ('Odległość liczona po Twojej stronie w chwili ciosu.', 'Distance measured on your side at the moment of the hit.'),
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
    'distance': ('Odległość do celu', 'Distance to the target'), 'only_players': ('Tylko gracze', 'Players only'),
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
