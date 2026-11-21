# 🔨 HammerShop – bot Discord „wszystko w jednym”

Jeden bot, który **buduje cały serwer Discord jedną komendą**, a potem **go prowadzi**:
weryfikacja, sklep na żywo z przyciskami Kup, kody rabatowe, potwierdzenia zakupu i realizacje zamówień, tickety, opinie,
giveawaye, statystyki sprzedaży, nagrody za zaproszenia, ochrona przed raidami, AutoMod, logi, kopie zapasowe i wiele więcej.
Jasnopomarańczowy motyw, logo z młotkiem, własne banery i własne emotki w zestawie. Wszystko jest po polsku: bot, jego
komendy (`/zbuduj`, `/produkt dodaj`…), strona sklepu i regulamin (`regulamin.md`, publikowany na #regulamin).

Wpisz **`/zbuduj`**, kliknij **Zbuduj**, poczekaj około dwóch minut – gotowe. 🧡

---

## 🔀 Dwa serwery, jeden bot: HammerShop i Hammer Launcher

Ten sam bot prowadzi dwa różne serwery – który, wybierasz jedną linią w `.env`:

| `BOT_PROFILE` | Serwer | Co buduje `/zbuduj` |
|---|---|---|
| *(puste)* | **HammerShop** – sklep | Wszystko, co opisuje reszta tego pliku: sklep, zamówienia, płatności, opinie |
| `launcher` | **Hammer Launcher** – społeczność launchera | Serwer o nazwie **Hammer Launcher** z logo launchera (**młot z wokseli**), własnymi banerami, rolami, regulaminem i kanałami launchera – bez sklepu |

**Serwer Hammer Launcher** (`BOT_PROFILE=launcher`):

```
〔 📊 STATYSTYKI 〕     👥┃ᴄᴢᴌᴏɴᴋᴏᴡɪᴇ: 123 · 🚀┃ᴡᴇʀꜱᴊᴀ: 2.6.0 · 📥┃ᴘᴏʙʀᴀɴɪᴀ: 456 · 🕹️┃ɢʀᴀ ᴛᴇʀᴀᴢ: 12   (liczby biorą się ze strony)
〔 👋 WITAMY 〕         ✅┃ᴡᴇʀʏꜰɪᴋᴀᴄᴊᴀ · 📜┃ʀᴇɢᴜʟᴀᴍɪɴ · 👋┃ᴘᴏᴡɪᴛᴀɴɪᴀ · 📌┃ɪɴꜰᴏʀᴍᴀᴄᴊᴇ · 📢┃ᴏɢᴌᴏꜱᴢᴇɴɪᴀ · 🎭┃ʀᴏʟᴇ
〔 🔨 LAUNCHER 〕       📥┃ᴘᴏʙɪᴇʀᴢ · 🚀┃ᴀᴋᴛᴜᴀʟɪᴢᴀᴄᴊᴇ · 📰┃ᴀᴋᴛᴜᴀʟɴᴏꜱᴄɪ · 🗺️┃ᴘʟᴀɴʏ · ⭐┃ʜᴀᴍᴍᴇʀ-ᴘʟᴜꜱ · ❓┃ꜰᴀǫ
〔 🛒 HAMMERSHOP 〕     🤝┃ʜᴀᴍᴍᴇʀꜱʜᴏᴘ
〔 🤝 PARTNERSTWA 〕    📋┃ᴡꜱᴘᴏᴌᴘʀᴀᴄᴀ · 🤝┃<partner> · 🤝┃<partner> …   (kanały partnerów robi panel admina)
〔 🎧 POMOC 〕          🎫┃ᴛɪᴄᴋᴇᴛʏ · 🐛┃ᴢɢᴌᴏꜱ-ʙᴌᴀᴅ · 💡┃ᴘʀᴏᴘᴏᴢʏᴄᴊᴇ
〔 💬 SPOŁECZNOŚĆ 〕    💬┃ᴄᴢᴀᴛ · 🎮┃ꜱᴇʀᴡᴇʀʏ · 🎉┃ɢɪᴠᴇᴀᴡᴀʏᴇ · 🏆┃ʀᴀɴᴋɪɴɢ · 💎┃ʙᴏᴏꜱᴛᴇʀᴢʏ
〔 🔒 ZESPÓŁ 〕 · 〔 📁 LOGI 〕 · 〔 🎫 TICKETY 〕 · 〔 🔐 ZAMKNIĘTE TICKETY 〕
```

- **Role:** 🔨 Hammer Launcher (rola bota), CEO, Co-CEO, **Developer**, Support, potem **Tester**, **💎 Hammer+** (nadaje bot), Boty, Członek oraz powiadomienia: Ogłoszenia, **Aktualizacje** (ping przy nowej wersji) i Giveawaye. Role, kanały i karty usunięte z układu (Manager, Administrator, Moderator, Stażysta, #zrzuty-ekranu, karta na #serwery) znikają po `/zbuduj tylko:update` – tylko te, które utworzył bot. Na #czat i #serwery bot nie wysyła żadnych kart. **Developer** jest jednym z adminów: widzi kanały zespołu, logi i #kopie-zapasowe i pisze na kanałach tylko do czytania. Na serwerze zbudowanym wcześniej daje mu ten dostęp `/zbuduj tylko:update` – ta sama komenda zmienia też nazwy reguł AutoMod z „HammerShop · …” na „Hammer Launcher · …” (razem z komunikatem, który widzi członek, gdy AutoMod zablokuje wiadomość). **Support** pilnuje porządku: daje przerwę (wyciszenie), usuwa wiadomości i widzi #logi-automod (na serwerze zbudowanym wcześniej też po `/zbuduj tylko:update`); kody Hammer+, panel strony, giveawaye, ogłoszenia i `/zablokuj` zostają dla adminów.
- **Tickety:** *Pomoc z launcherem*, *Zgłoś błąd*, *Hammer+ i płatności*, *Odbierz nagrodę*, *🤝 Partnerstwo* (propozycje współpracy – nazwa serwera, rodzaj, linki, liczba osób; asystent AI dziękuje i woła zespół) i *Rekrutacja* (domyślnie wyłączona – `/tickety`) – z pytaniami o wersję launchera, Minecrafta i log. Bot **nie przypomina** tu o nieprzejętych ticketach (`staffReminders.enabled: false` w `config.launcher.json`).
- **Waluta: złoty (PLN).** Ceny Hammer+ na stronie, płatności Stripe (dzięki temu działają też BLIK i Przelewy24, jeśli włączysz je w panelu Stripe), e-maile i teksty na Discordzie są w zł (`config.launcher.json` → `shop.currency` i `stripe.currency`). Ceny planów ustawiasz w panelu admina, w zakładce **Hammer+** – po zmianie waluty sprawdź, czy kwoty są takie, jak chcesz.
- **#hammershop:** kanał naszego współtwórcy we własnej kategorii (między LAUNCHER a POMOC) z jego banerem i kartą (co sprzedaje, kto za co odpowiada, przycisk do jego strony). Nazwę, adres strony i zaproszenie na jego Discorda ustawiasz w `config.launcher.json` → `partner` (`name`, `url`, `discord` – pusty `discord` = bez przycisku). Na zbudowanym serwerze kategorię i kanał dodaje `/zbuduj tylko:update` (kanał, który był już w kategorii LAUNCHER, przenosi). Ta sama komenda podmienia też emotki, których obrazek zmienił się w nowej wersji (np. logo), zanim odświeży karty. Baner kanału (`assets/banners-launcher/hammershop.png`) to zmniejszony baner HammerShop z `assets/brand/hammershop-pl-banner-wide.png`.
- **🤝 Partnerstwa:** kategoria za 🛒 HAMMERSHOP (przed 🎧 POMOC). Na start ma kanał **#współpraca** z kartą: czym są partnerstwa i jak zostać partnerem (formularz kontaktowy – temat *Współpraca* – albo ticket). Partnerów dodajesz w panelu admina, w zakładce **Partnerstwa** (opis niżej): partner z serwerem Discord dostaje tu własny kanał tylko do czytania (członkowie czytają, piszą admini, Support i bot) z kartą – logo, nazwa, opis, liczba osób, przycisk *Dołącz do serwera*, a przy „Discord + Minecraft” także adres serwera. Serwer Minecraft partnera trafia do **Polecanych serwerów** w launcherze (z tagiem *partner*), a każdy partner – na stronę **/partnerzy**. Na zbudowanym serwerze kategorię i #współpraca dodaje `/zbuduj tylko:update`; gdyby jej nie było, bot zrobi ją sam przy pierwszym partnerze z Discordem. Kanałów partnerów nie ma w układzie, więc `/zbuduj tylko:update` ich nie rusza.
- **Połączenie ze stroną i launcherem:** nowa wersja opublikowana w panelu admina pojawia się na **#aktualizacje** (z pingiem roli Aktualizacje), aktualność – na **#aktualności**, a kanały statystyk pokazują aktualną wersję i liczbę pobrań. `/launcher` pokazuje kartę launchera z aktualną wersją.
- **🕹️ Gra teraz:** kanał statystyk z liczbą osób, które **teraz grają przez launcher** – w każdą wersję gry, także w trybie jednoosobowym. Launcher (od 2.11.3) co 2 minuty mówi stronie „tu działa gra”, a gdy gra się zamknie – „koniec”. Wysyła tylko losowy numer tej jednej sesji gry: bez konta, nicku i adresu. Strona trzyma to 5 minut i tylko w pamięci. Starsze launchery liczą się przez Hammer Client na serwerach (co 90 s mówi „gram”); obie liczby się nie sumują – kanał pokazuje większą. Bot sprawdza liczbę co 5 minut i zmienia nazwę tylko wtedy, gdy liczba się zmieniła – najwyżej 2 razy na 10 minut, bo na tyle pozwala Discord (nadmiarową zmianę pomija, zrobi ją w następnej rundzie). Przez pierwsze 3 minuty po starcie bota kanał zostawia starą liczbę – lista graczy dopiero się wtedy zapełnia.
- **🗺️ #plany:** jedna karta *„Teraz robimy” / „W następnej wersji” / „Później” / „Ostatnio zrobione”* (puste sekcje się nie pokazują, na dole data ostatniej zmiany; gdy nic nie ma – miły pusty stan). Kartę zmieniasz w panelu admina, w zakładce **Plany** – bot **edytuje tę samą wiadomość** (nigdy nie wysyła drugiej i nikogo nie pinguje). Gdy ktoś ją usunie, następna zmiana wyśle ją od nowa i bot ją zapamięta; `/zbuduj tylko:panels` odświeża ją razem z resztą kart. Na zbudowanym serwerze kanał (i 🕹️ Gra teraz) dodaje `/zbuduj tylko:update`.
- **Podpowiedzi na czacie** (bez AI): gdy ktoś na **#czat** albo **#serwery** zada jedno z typowych pytań, bot raz odpowiada krótką kartą ze wskazówką – jako odpowiedź na wiadomość, **bez pingu**, z przyciskiem *To nie to* (chowa ją pytający albo zespół). Tematy: skąd pobrać launcher (→ #pobierz i strona), launcher / gra nie startuje, wywala, czarny ekran (→ ticket *Pomoc z launcherem* + *Konsola → Wyślij logi*), Hammer+ – zakup i kod (→ #hammer-plus / ticket *Hammer+ i płatności*), mody i shadery (→ zakładka *Mody*), mało FPS (→ *Optymalizacja*), logowanie Microsoft / konta non-premium (→ #faq) i „kiedy nowa wersja?” (→ #plany i #aktualizacje). Rozpoznaje pytania bez polskich znaków i z typowymi literówkami („jak pobrac”, „nie dziala”, „crashuje”, „wywala mnie”), ale tylko takie, które pytają albo proszą o pomoc i mówią o launcherze / grze – samo „nie działa” w rozmowie o czymś innym nic nie wywoła. Nie spamuje: ta sama osoba dostaje ten sam temat najwyżej raz na 30 minut, kanał – raz na 2 minuty; nigdy zespół, boty, tickety ani wiadomość usunięta przez filtr czatu. Ustawienia: `config.launcher.json` → `chatHints` – `enabled`, `channels` (klucze kanałów), `userCooldownMinutes`, `channelCooldownMinutes`, `dismissButton`, `words` (grupy słów, np. wszystkie pisownie „launchera” – we wzorcach jako `{launcher}`) i `topics`: `id`, `patterns` (wyrażenia regularne sprawdzane na uproszczonym tekście: małe litery, bez polskich znaków, pojedyncze spacje, spacja na początku i końcu), opcjonalnie `not` (kiedy nie podpowiadać, np. „już działa”) i `"question": false` (temat, którego wzorce same wymagają słów o launcherze / grze – nie musi to być pytanie), oraz `text` z `{#kanał}` (np. `{#launcher}`, `{#tickets}`) i `{site}` (adres strony; linia z nim znika, gdy `PUBLIC_URL` nie jest ustawiony). Zły wzorzec bot pomija z ostrzeżeniem w konsoli. Na serwerze sklepu podpowiedzi są wyłączone (`chatHints.enabled: false` domyślnie).
- **Strona:** adres główny (`PUBLIC_URL`) to **strona launchera** z logo launchera (młot z wokseli) i nazwą Hammer Launcher – pobieranie (po zalogowaniu przez Discorda), aktualności, Hammer+ przez Stripe, program poleceń *Zaproś znajomego*, **Partnerzy** (`/partnerzy` – karta każdego partnera: logo, nazwa, opis, *Dołącz na Discorda*, adres serwera z przyciskiem *Kopiuj IP*; przed pierwszym partnerem – zachęta do napisania przez formularz; link w stopce, w menu na telefonie i na stronie /hammershop); panel admina jest pod `/admin`.
- **Te same emotki** co w HammerShop (jedyny wyjątek: emotka logo to młot launchera). Komend sklepu (`/produkt`, `/sklep`, `/promocja`, `/opinia`…) na tym serwerze nie ma – ani sklepowych opcji w pozostałych (`/panel` bez katalogu i opinii, `/ogloszenie` tylko z banerami launchera, `/giveaway start` bez „tylko-klienci”, `/ticket` bez „zrealizuj”), a `/pomoc` mówi o launcherze.
- **Gdzie zmienić teksty:** `config.launcher.json` (nazwa, opisy, rodzaje ticketów, gotowe odpowiedzi – nakładane na `config.json`), `regulamin-launcher.md`, układ kanałów i ról w `src/builder/layout.launcher.js`, karty kanałów w `src/builder/content.launcher.js`. Grafiki: `assets/banners-launcher/`, `assets/brand/logo-launcher.png`, `assets/brand/server-banner-launcher.png` (`npm run render-assets -- launcher` rysuje je od nowa ze znaku `assets/brand/logo-launcher-mark.png`; złote H w `assets/brand/logo-h.png` to znak HammerShop).
- **Oba serwery naraz:** uruchom dwie kopie bota w osobnych folderach – każda ze swoim `.env` (osobny token bota i `BOT_PROFILE`), portem strony i folderem `data/`.

## ✨ Co dostajesz

### 🏗️ `/zbuduj` – cały serwer jednym kliknięciem
| | |
|---|---|
| 🎭 **19 ról** | **🔨 HammerShop** – własna rola bota: najwyższa rola na serwerze, więc bot jest na samej górze listy członków, i **ma ją tylko bot**. Dalej CEO, Co-CEO, Manager, Administrator, Moderator, Support, Stażysta, Sprzedawca, Stały Klient, Klient, Boty, Członek, 3 role z powiadomieniami + 3 separatory – wszystkie w jasnopomarańczowej palecie i z właściwymi uprawnieniami |
| 📁 **9 kategorii, 33 kanały** (32 z wyłączonym kanałem statusu sklepu) | Statystyki · Witamy · Sklep · Pomoc · Społeczność · Zespół (z pokojem głosowym zespołu) · Logi · Tickety · Zamknięte tickety |
| 🔐 **Dobrze ustawione uprawnienia** | Nowe osoby widzą tylko **#weryfikacja**, **#regulamin** i **#powitania** (tylko do odczytu – dzięki temu dociera do nich ping powitalny). Kanały informacyjne są tylko do odczytu, strefy zespołu i logów są prywatne |
| 🖼️ **Własne banery** | 37 jasnopomarańczowych banerów (1080×400) – każdy kanał informacyjny zaczyna się od własnego banera i ostylowanej karty |
| 😀 **Własne emotki** | 67 jasnopomarańczowych emotek (`:hs_cart:`, `:hs_check:`, `:hs_paypal:`…) – bot używa ich we wszystkich swoich wiadomościach |
| 🔨 **Branding** | Zmienia nazwę serwera na **HammerShop**, ustawia logo z młotkiem jako ikonę serwera (i baner na serwerach z boostami) |
| 🌐 **Tryb społeczności** | Kanały ogłoszeń, ekran powitalny, kanał z zasadami i kanał aktualizacji |
| 🤖 **AutoMod** | Spam, rajdy wzmianek, linki-oszustwa („free nitro”), zaproszenia na Discorda, wyzwiska, podejrzane nazwy – alerty trafiają na #logi-automod |

### 🛒 Sprzedaż
- **Sklep na żywo** na #sklep – dodawaj produkty komendą `/produkt dodaj`, pojawiają się od razu z przyciskiem **Kup**.
  Ceny wpisane jako sama liczba automatycznie dostają walutę (`20` → **20€**).
- **Zakładki i strony** – sklep pokazuje **5 produktów na stronę** z przyciskami ◀ ▶ i **zakładkę dla każdej kategorii** (Wszystkie ·
  Gry · Konta …; przy więcej niż 4 kategoriach zakładki zmieniają się w menu). Zmiana strony albo zakładki otwiera prywatną kopię
  dla tej osoby, więc przeglądanie nigdy nie zmienia sklepu nikomu innemu. Kategorię produktu ustawisz przez `/produkt edytuj kategoria:`.
- **Zdjęcia produktów** – dołącz obrazek do każdego produktu (`/produkt dodaj obrazek:`), pokazuje się obok produktu.
- **Płatności:** PaysafeCard, kryptowaluty (BTC, ETH), PayPal, **Stripe** (karta, Apple Pay, Google Pay) i **BLIK / przelew
  (Simpay)** (link wysyła sprzedawca) – edytujesz je w `config.json`.
- **PIN-y PaysafeCard są ukryte** – ticket pokazuje tylko `••••-••••-••••-1234`; tylko właściciel (`config.json` → `orders.pinViewers`, ID użytkowników) może kliknąć **🔑 Pokaż PIN**, żeby zobaczyć cały PIN (widzi go tylko on, a każde odsłonięcie trafia do logów).
- **Automatyczna dostawa produktu** – daj produktowi pliki i/lub tekst (klucz, dane logowania…): `/produkt dostawa
  produkt:Netflix plik:konto.txt tekst:…` (do 5 plików, łącznie 9 MB) albo `plik:` / `tekst-dostawy:` w `/produkt dodaj`.
  Opłacone przez **PayPal lub Stripe** → *„📦 Twój produkt jest w drodze”*, potem produkt trafia do ticketu **i na DM**
  od razu (zwykle w mniej niż 30 sekund), a zamówienie realizuje się samo. Opłacone **PaysafeCard lub kryptowalutami** → po kliknięciu
  **Zapłać** klient widzi *„📦 Twój produkt jest w drodze”*; Ty sprawdzasz płatność i klikasz **Płatność OK – dostarcz**
  (albo ⚙️ → **Dostarcz produkt** / **Wyślij produkt ponownie**). Produkty bez plików dostarczasz ręcznie, tak jak dotąd.
- **Karta płatności w każdym zamówieniu** – zaraz po złożeniu zamówienia ticket pokazuje **💳 Zapłać 24€** dla wybranej metody:
  - **PaysafeCard** – co zrobić i przycisk **Zapłać** (formularz na PIN + zrzut ekranu).
  - **Kryptowaluty** – Twoje **adresy portfeli BTC / ETH** (`config.json` → metoda płatności Kryptowaluty → `"addresses"`)
    z kwotą w monetach po dzisiejszym kursie (np. *≈ 0.00040000 BTC*) i **Zapłać**, żeby podać ID transakcji albo zrzut ekranu.
  - **PayPal** – z kluczami PayPal w `.env` **link PayPal, który potwierdza się sam** (jak Stripe, niżej); bez kluczy link
    **paypal.me** z wpisaną kwotą (`"paypalMe": "twojanazwa"`), a potem **Zapłać** ze zrzutem ekranu.
- **Płatności PayPal, które potwierdzają się same** – wpisz klucze swojej aplikacji PayPal w `.env` (`PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`): każde zamówienie przez PayPal dostaje link **Zapłać 24€ przez PayPal**. Gdy klient go zatwierdzi,
  bot w ciągu 30 sekund **sam pobiera pieniądze**, zmienia status zamówienia na **Opłacone** i pinguje sprzedawcę. Pieniądze są
  pobierane tylko wtedy, gdy zamówienie wciąż na nie czeka – zamówienie zamknięte albo ze zmienioną kwotą **nigdy nie zostanie
  obciążone** (klient dostaje wtedy nowy link). Zatwierdzone, kiedy sprzedawca już ustawił status Opłacone? Płatność jest
  **wstrzymana**, zespół dostaje informację i może kliknąć **Pobierz płatność PayPal**, jeśli pieniędzy brakuje. Odrzucona karta,
  płatność, którą PayPal wciąż przetwarza (np. taka, którą musisz **zaakceptować** na swoim koncie PayPal) – klient i zespół
  zawsze wiedzą, co się stało.
- **Płatności kartą przez Stripe** – wpisz klucz Stripe w `.env` (`STRIPE_SECRET_KEY`), a każde zamówienie opłacane przez Stripe
  od razu dostaje w tickecie link **Zapłać 24€**. Gdy klient zapłaci, bot widzi to w ciągu 30 sekund, zmienia status zamówienia
  na **Opłacone**, informuje klienta i pinguje sprzedawcę – nikt nie musi niczego sprawdzać ręcznie. Nie potrzeba strony ani
  webhooka, działa na każdym hostingu. Linki są ważne 23 godziny (potem pojawia się przycisk **Nowy link do płatności**); link
  przestaje działać, gdy zamówienie zostanie opłacone w inny sposób albo ticket zostanie zamknięty lub usunięty, więc nikt nie
  zapłaci dwa razy – a płatność, która mimo to wpłynie, nigdy nie przepada: zostaje zapisana, a zespół dostaje informację.
  Status Opłacone jest ustawiany tylko wtedy, gdy kwota zgadza się z sumą zamówienia (w przeciwnym razie zespół jest proszony
  o sprawdzenie). Bez klucza Stripe jest po prostu metodą płatności na liście, a link wysyła ręcznie sprzedawca.
- **Kup → formularz zamówienia → prywatny ticket.** Formularz pyta o wariant, ilość, **metodę płatności** z listy i opcjonalny
  **kod rabatowy** – ticket pokazuje sumę, rabat i kwotę **do zapłaty**.
- **Warianty** – jeden produkt, kilka cen: `/produkt warianty produkt:Netflix warianty:"1 miesiąc = 5, 3 miesiące = 12, 12 miesięcy = 40"`
  (do 10, oddzielone `,` `;` albo nowymi liniami – `none` je usuwa). Sklep pokazuje **od 5€** i każdy wariant,
  formularz zamówienia pyta, który z nich, a ticket, potwierdzenie zakupu, #realizacje, `/sprzedaz` i raport tygodniowy go
  pokazują („Netflix — 3 miesiące”).
- **Licznik sztuk** – `/produkt stan produkt:Nitro ilosc:12` (albo `ilosc:` w `/produkt dodaj` / `/produkt edytuj`): sklep pokazuje
  **zostało 12** / **zostało tylko 2**, każde zrealizowane zamówienie zmniejsza licznik, przy 0 produkt jest **wyprzedany**
  (z przyciskiem Powiadom mnie), a zespół dostaje informację na #logi-ticketów. Nikt nie zamówi więcej, niż zostało. Ustawienie
  samego stanu (bez ilości) wyłącza licznik. „Zostało tylko N” pojawia się od `shop.lowStockAt` (3).
- **Promocje błyskawiczne** – `/promocja start produkt:Nitro procent:20 czas:2h` (30m, 2h, 1d, 1h30m – do 7 dni): sklep pokazuje
  ~~20€~~ **16€** · −20% z odliczaniem na żywo, zamówienia dostają cenę promocyjną (kody rabatowe działają dodatkowo), promocja
  kończy się sama (albo `/promocja stop`) i jest ogłaszana na #dostawy z pingiem roli Dostawy (`ogloszenie:false`, żeby to pominąć).
  `/promocja lista` pokazuje, co jest przecenione. Tylko dla produktów, których cena – albo cena każdego wariantu – jest samą
  liczbą (`20`, `19.99` albo z walutą sklepu, np. `20€`; `$20` w sklepie w € zostanie odrzucone).
- **Odznaki** – 🔥 **Bestseller** przy produkcie z największą liczbą sprzedanych sztuk (co najmniej 3) i ⭐ **4.9** – średnia ocena
  produktu z opinii (od 2 opinii). Sklep odświeża się po każdym zrealizowanym zamówieniu. Wyłączysz je albo zmienisz progi
  w `config.json → badges`.
- **„Zapłać”** – ticket zamówienia ma dla klienta przycisk **Zapłać**: klient wysyła nim PIN(-y) PaysafeCard
  (sprawdzane: po 16 cyfr), zrzuty ekranu i/lub ID transakcji. Sprzedawca obsługujący ticket (albo sprzedawcy, dopóki nikt
  go nie przejął) dostaje ping, zrzuty ekranu zostają w tickecie, a log i archiwalne transkrypcje pokazują tylko 4 ostatnie
  cyfry PIN-u. Poprawiony PIN można wysłać ponownie po minucie – zespół dostaje kolejny ping dopiero po czasie odnowienia
  przycisku Wezwij pomoc (`defaults.pingStaffCooldownMinutes`) albo od razu, gdy sprzedawca przywróci status Oczekuje na płatność.
  Wyłączysz to przez `orders.paymentProofs`.
- **Status zamówienia** – ⚙️ Zarządzaj ticketem → **Status: Opłacone / W realizacji / Oczekuje na płatność**. Ticket pokazuje status
  (⏳ Oczekuje na płatność → 📨 Płatność wysłana → 💳 Opłacone → 🔧 W realizacji → ✅ Dostarczone), a klient dostaje krótki DM
  z linkiem do ticketu (`orders.statusDms`). „Zamówienie zrealizowane” = Dostarczone – tak też pisze potwierdzenie zakupu.
- **Moje zamówienia** – przycisk pod sklepem (na każdej stronie) pokazuje każdemu członkowi, prywatnie, jego otwarte zamówienia
  ze statusem, kwotą i linkiem do ticketu oraz wszystkie zrealizowane zamówienia (10 na stronę, ◀ Nowsze / ▶ Starsze)
  z potwierdzeniem zakupu dla każdego.
- **Kody rabatowe** – `/kod utworz kod:HS10 procent:10` (albo stała kwota rabatu), z datą ważności, limitem użyć, raz na osobę,
  tylko na pierwsze zamówienie.
- **Zamówienie zrealizowane** (menu ticketu → potwierdzenie zapłaconej kwoty) → sprzedaż zostaje zapisana, kupujący dostaje
  **potwierdzenie zakupu na DM** i rolę **Klient** (po 5 zamówieniach **Stały Klient**), a na #realizacje trafia anonimowy wpis
  o **realizacji**.
- **Przypomnienie o opinii** – 24 godziny po zamówieniu klient dostaje DM z przyciskiem **Wystaw opinię** (tylko jeśli nie ma jeszcze opinii).
- **Kod na pierwszy zakup** – nowi członkowie po weryfikacji dostają na DM osobisty kod rabatowy 5%.
- **Powiadom mnie** – wyprzedane produkty mają przycisk 🔔; gdy wrócą do sprzedaży, każdy, kto go kliknął, dostaje DM.
- **Otwarte / zamknięte** – sklep jest otwarty **10:00–20:00 codziennie** (czas polski): kanał statusu na górze pokazuje
  `🟢┃ꜱᴋʟᴇᴘ ᴏᴛᴡᴀʀᴛʏ` / `🔴┃ꜱᴋʟᴇᴘ ᴢᴀᴍᴋɴɪᴇᴛʏ`, a panel sklepu i panel ticketów też to pokazują. Przełącza się samo;
  `/sklep otworz` · `/sklep zamknij` nadpisują godziny pracy do czasu `/sklep auto`.
- **Pingi o dostawach** – nowe produkty i dostawy są ogłaszane na #dostawy z pingiem roli Dostawy.
- **Metody płatności, Jak kupić, FAQ** – gotowe karty, edytujesz je w `config.json`.
- **Automatyczne sprawdzanie kryptowalut** – kupujący klika **Zapłać** i wkleja ID transakcji; bot sprawdza ją w blockchainie
  (BTC: mempool.space, ETH: Blockscout) – właściwy portfel, ≥ 99% kwoty, nie starsza niż zamówienie, użyta tylko raz,
  wystarczająco dużo potwierdzeń – i wtedy zmienia status na Opłacone i dostarcza zamówienie. ETH tylko w sieci **Ethereum**.
  Bez ID transakcji płatność sprawdza ręcznie sprzedawca. Wyłączenie: `crypto.autoVerify: false`.
- **🛒 Koszyk** – dodaj kilka produktów i zapłać za nie w jednym zamówieniu (`cart.maxItems`, domyślnie 10).
- **💰 Saldo sklepu** – `/saldo` je pokazuje; doładowania (`balance.topUpMin`–`topUpMax`) opłaca się jak zamówienie, a saldem
  można płacić za kolejne zamówienia. **Salda nie można wypłacić ani zwrócić.**
- **🎁 Prezenty** – w tickecie zamówienia: **Kup jako prezent** → produkt trafia na DM znajomego, a kupujący zachowuje potwierdzenie zakupu.
- **🎥 Kody twórców** – `/tworca utworz · lista · usun · wyplata · statystyki`: kod rabatowy dla twórcy (domyślnie −5%
  dla kupujących i 10% prowizji dla twórcy, naliczanej od każdej zrealizowanej sprzedaży; wypłacasz ją ręcznie).
- **Kody powrotne** – ticket zamknięty bez płatności → po 24 h kupujący dostaje na DM osobisty, jednorazowy kod −5%.
- **🔥 Okazja tygodnia** – w 1–2 losowe dni w tygodniu jeden produkt jest tańszy o 25–50% przez 24 h (`deals` w `config.json`;
  `/promocja okazja`, żeby uruchomić albo zatrzymać ją ręcznie).
- **Zwroty** – regulamin (§6), FAQ i karty zamówień mówią to samo: dostarczonych produktów cyfrowych nie można zwrócić
  (składając zamówienie, kupujący prosi o natychmiastową dostawę); niedziałający produkt naprawiamy albo wymieniamy – a gdy to
  niemożliwe, zwracamy pieniądze. Saldo sklepu nigdy nie jest wypłacane (`shop.refundPolicy`).
- **Regulamin** – zasady sklepu po polsku są w pliku `regulamin.md` i są publikowane na #regulamin (zob. *Regulamin* niżej).

### 📈 Dla Ciebie i Twojego zespołu
- **`/sprzedaz`** – przychód, zamówienia, średnie zamówienie, najlepsze produkty, sprzedawcy, metody płatności i rabaty za dziś,
  7 dni, 30 dni albo od początku, w porównaniu z poprzednim okresem. W każdy poniedziałek o 10:00 na #sprzedaż trafia **raport tygodniowy**.
- **`/klient profil klient:@osoba`** – zamówienia, łączne wydatki, ostatnie zamówienia, tickety, opinie, zaproszenia i **prywatne
  notatki zespołu** (`/klient notatka dodaj`).
- **Automatyczne kopie zapasowe** – co 24 godziny bot publikuje kopię swoich danych na #kopie-zapasowe (tylko admini); `/kopia` robi ją od razu.
- **Przypomnienia o nieprzejętych ticketach** – gdy sklep jest otwarty, tickety, których nikt nie przejął przez 15 minut, są
  wypisywane na #czat-zespołu (jedna wiadomość z linkami i pingiem ról zespołu z tych ticketów), potem znowu co 60 minut, dopóki
  ktoś ich nie przejmie. O ticketach z nocy bot przypomina po otwarciu sklepu. `staffReminders` w `config.json`
  (`repeatMinutes: 0` = tylko raz).

### 🛡️ Bezpieczeństwo i rozwój
- **Filtr czatu** – żadnych linków na #czat (GIF-y są OK) i żadnych przekleństw ani wyzwisk w wielu językach (angielski, polski, szwedzki, niemiecki, francuski, hiszpański, rosyjski…), także pisanych jako `sh1t`, `k u r w a`, `ᴋᴜʀᴡᴀ` albo cyrylicą. Wiadomość jest usuwana, członek dostaje krótką informację, a #logi-automod – szczegóły; 3 zablokowane wiadomości w 10 minut → 10 min wyciszenia (timeout). Filtr nigdy nie dotyczy zespołu. Ustawienia: `chatFilter` w `config.json` (`noLinks`, `allowedDomains`, `extraWords`, `allowedWords`, `profanity: "public"` = nie w ticketach).
- **Alerty o podszywaniu się** – ktoś dołącza jako „supp0rt_hammershop” albo kopiuje awatar osoby z zespołu? Zespół dostaje alert
  na #logi-automod z przyciskami **Ban / Wyrzuć / Wycisz / Ignoruj**.
- **`/zablokuj`** – podczas raidu nikt poza zespołem nie może pisać, reagować ani wchodzić na kanały głosowe, nowe tickety,
  zamówienia i opinie są wstrzymane (otwarte tickety działają dalej), a zaproszenia zawieszone; `/odblokuj` przywraca każdą rolę
  i każde ustawienie dokładnie tak, jak było.
- **Śledzenie zaproszeń z nagrodami** – bot wie, kto kogo zaprosił. Zaproszenie się liczy, gdy nowy członek się zweryfikuje
  i zostanie na serwerze; przy **5 / 15 / 30** zaproszeniach zapraszający dostaje na DM osobisty kod **10% / 15% / 20%**.
  `/zaproszenia statystyki` · `/zaproszenia ranking`.

### ⭐ Opinie
- Przycisk **Wystaw opinię** z formularzem i oceną w gwiazdkach albo `/opinia` z opcjonalnym zrzutem ekranu.
- Panel opinii jest **przyklejony**: po każdej nowej opinii przeskakuje na dół #opinie, więc przycisk **Wystaw opinię** jest
  zawsze pierwszą rzeczą, którą ludzie widzą (`"stickyPanel": false` to wyłącza).
- Licznik na żywo ze średnią oceną i rozkładem ocen, plus czas odnowienia przeciw spamowi.

### 🎫 Tickety (pełny system ticketów)
- 6 kategorii: **Zakup** (tylko przez Kup w sklepie), **Pomoc, Odbierz nagrodę, Zgłoś użytkownika, Rekrutacja, Odwołanie od kary**.
- Formularze, przejmowanie/oddawanie, priorytety, przenoszenie między kategoriami, dodawanie osób, gotowe odpowiedzi (`/odpowiedz`),
  prośby o zamknięcie, automatyczne zamykanie nieaktywnych ticketów (nigdy dla zamówień już opłaconych albo w realizacji),
  przycisk **„Wezwij pomoc”**, czarna lista.
- **Transkrypcje HTML**, które wyglądają jak Discord, **DM do autora** z transkrypcją i **oceną 1–5 ⭐**.
- `/statystyki` – czasy odpowiedzi, oceny, ranking zespołu.
- **`/tickety wylacz|wlacz|lista`** – kategorię (np. **Rekrutacja**) można wyłączyć na jakiś czas: w panelu ticketów zostaje
  z szarym przyciskiem „Wyłączona”, karta rekrutacji w #informacje mówi „Rekrutacja jest teraz zamknięta”, a nikt nie otworzy
  nowego ticketu tej kategorii (otwarte działają dalej). Na serwerze launchera **Rekrutacja startuje wyłączona**
  (`"disabled": true` w `config.launcher.json`) – włączysz ją `/tickety wlacz kategoria:Rekrutacja`.
- **Dwa kanały logów:** `#📁 logi-ticketów` – tylko to, co dzieje się w ticketach (otwarcie, zamknięcie, płatności i dostawy
  zamówień w tickecie); `#📋 logi-serwera` – cała reszta: panel admina na stronie, Hammer Launcher (wersje, aktualności),
  Hammer+, polecenia, komendy zespołu (`/polecane`, `/hammerplus`, `/promocja`…), blokady. Weryfikacja ma `#✅ logi-weryfikacji`,
  automod `#🤖 logi-automod`, transkrypcje `#📄 transkrypcje`.

### ✅ Weryfikacja
- Przycisk **Zweryfikuj się** + szybkie pytanie matematyczne przeciw botom + minimalny wiek konta (domyślnie 3 dni).
- Każda próba trafia do logów na #logi-weryfikacji. Obecni członkowie automatycznie dostają rolę Członek podczas `/zbuduj`.

### 🎉 Społeczność
- **Giveawaye** – przycisk Dołącz, licznik uczestników na żywo, automatyczne losowanie zwycięzców, ponowne losowanie; wymagania
  udziału: **wymagana rola**, **tylko klienci** (`tylko-klienci:`) i **co najmniej N zaproszeń** (`min-zaproszen:` – liczą się
  tylko zaproszeni członkowie, którzy się zweryfikowali i wciąż są na serwerze); każde wymaganie jest sprawdzane ponownie
  u zwycięzców przy losowaniu i przy ponownym losowaniu; zwycięzcy odbierają nagrody przez ticket.
- **Role z powiadomieniami** na #role (Ogłoszenia / Giveawaye / Dostawy).
- **`/ogloszenie`** – formularz, który publikuje ostylowane ogłoszenie z banerem, opcjonalnym przyciskiem i pingiem.
- **Karty powitalne** na #powitania, **logi** wejść, wyjść, usuniętych i edytowanych wiadomości.
- **Kanały ze statystykami** (👥 Członkowie / ⭐ Opinie) i **ranking** najaktywniejszych osób na czacie (tygodniowy + ogólny).

---

## 🚀 Instalacja (10 minut)

### 1. Utwórz bota
1. Wejdź na <https://discord.com/developers/applications> → **New Application** → nazwij aplikację **HammerShop**.
2. Zakładka **Bot** → **Reset Token** → skopiuj token (zobaczysz go tylko raz – nigdy nikomu go nie podawaj!).
3. Wciąż w zakładce **Bot**, w sekcji *Privileged Gateway Intents* **włącz**:
   - ✅ **Server Members Intent** (wiadomości powitalne, logi, nadawanie ról)
   - ✅ **Message Content Intent** (transkrypcje, logi, ranking)
4. *Opcjonalnie:* wgraj `assets/brand/logo-hammer.png` (albo `logo-hammer-wordmark.png`) jako awatar bota.

### 2. Konfiguracja
1. Skopiuj **`.env.example`** do **`.env`**.
2. Uzupełnij:
   ```env
   DISCORD_TOKEN=token_twojego_bota
   GUILD_ID=id_twojego_serwera
   ```
   > 💡 Jak skopiować ID: Discord → Ustawienia użytkownika → Zaawansowane → włącz **Tryb dewelopera**. Potem kliknij prawym przyciskiem swój serwer → **Kopiuj ID serwera**.
   > Z ustawionym `GUILD_ID` komendy pojawiają się od razu.

   *Opcjonalnie – płatności kartą:* `STRIPE_SECRET_KEY=sk_live_…` (Stripe Dashboard → **Developers → API keys → Secret key**;
   `sk_test_…`, żeby najpierw wypróbować płatności kartami testowymi; wystarczy klucz ograniczony z uprawnieniem **Checkout Sessions: Write**).

   *Opcjonalnie – PayPal:* `PAYPAL_CLIENT_ID=…` i `PAYPAL_CLIENT_SECRET=…` (<https://developer.paypal.com> → **Apps &
   Credentials** → **Live** → **Create App** → skopiuj Client ID i Secret; `PAYPAL_SANDBOX=true` z kluczami Sandbox, żeby
   najpierw wypróbować płatności na kontach testowych).

   *Opcjonalnie – Hammer+ (Hammer Launcher):* `HAMMER_PLUS_PRIVATE_KEY=…` – klucz, którym bot podpisuje kody Hammer+.
   Wygenerujesz go komendą `npm run plus-key` (zob. [Hammer+ i launcher](#-hammer-i-launcher)).

### 3. Uruchomienie
Potrzebujesz **Node.js 18.17 lub nowszego** (<https://nodejs.org>).
```bash
npm install
npm start
```
Konsola wypisze **link z zaproszeniem** – otwórz go i dodaj bota na swój serwer (bot prosi o uprawnienie **Administrator**, którego potrzebuje `/zbuduj`).

**Na hostingu (Wispbyte, Pterodactyl, …):** wgraj pliki tak, żeby `index.js` i `package.json` były w głównym folderze,
utwórz tam `.env`, ustaw **plik startowy na `index.js`** i kliknij Start. Zależności zainstalują się same przy pierwszym uruchomieniu.

### 4. Zbuduj serwer
1. **Ustawienia serwera → Role:** przeciągnij rolę bota na **samą górę**.
2. Wpisz **`/zbuduj`** i kliknij:
   - **Zbuduj** – dodaje wszystko obok Twoich obecnych kanałów, albo
   - **Wyczyść i zbuduj** – najpierw usuwa wszystkie kanały, role i reguły AutoMod, a potem buduje czysty serwer HammerShop
     (tylko właściciel serwera; żeby potwierdzić, trzeba wpisać nazwę serwera).
3. Obserwuj pasek postępu. Gdy pojawi się **HammerShop jest gotowy!**, serwer działa. 🎉
4. Uzupełnij dane sprzedawcy do regulaminu: `config.json` → `rules.seller` (imię i nazwisko albo firma, adres) i
   `rules.email`, uruchom bota ponownie i wpisz `/zbuduj tylko:panels`.

### 5. Zacznij sprzedawać
```
/produkt dodaj nazwa:GTA V cena:20 opis:Dostawa natychmiastowa, pełna gwarancja. emoji:💎
```
Cena pokaże się w sklepie jako **20€**.
Nadaj zespołowi role (Manager, Support, Sprzedawca…) i możesz zaczynać.

---

## 🌐 Strona sklepu (prowadzona przez bota)

Bot prowadzi też stronę internetową Twojego sklepu HammerShop – w tym samym programie, na tym samym serwerze. Strona sprzedaje dokładnie to, co jest w sklepie bota:

- Zmiany z `/produkt dodaj | edytuj | stan | warianty` i `/promocja` od razu widać na stronie.
- Na liście są tylko produkty ze stałą ceną. Każdy wariant jest pokazany osobno, ceny z promocji błyskawicznych są uwzględnione, wyprzedane produkty są ukryte, a zdjęcia produktów widoczne.
- **Zaloguj się przez Discorda** loguje kupującego przez własną aplikację bota. Jego ID na Discordzie łączy wszystko. Do zakupu wystarczy się zalogować – nie ma żadnej opłaty za dostęp.
- Osoba, której jeszcze nie ma na serwerze, jest przy logowaniu **dodawana automatycznie z rolą Członek** (OAuth2 `guilds.join`), a członek bez tej roli ją dostaje. Bot potrzebuje uprawnień *Utwórz zaproszenie* i *Zarządzaj rolami* (ma je po `/zbuduj`).
- Kupujący wypełnia koszyk (działa to też przed zalogowaniem) i płaci kartą przez **Stripe** (ten sam `STRIPE_SECRET_KEY`).
- Po **opłaceniu** na Discordzie otwiera się ticket zamówienia kupującego (opłacone przez stronę, nic więcej do zapłaty). Produkty z plikami albo tekstem (`/produkt dostawa`) są dostarczane od razu w tickecie i na DM, jak każde opłacone zamówienie, a przy pozostałych bot pinguje sprzedawców.
- Kupujący, którego jeszcze nie ma na serwerze, dostaje swój ticket, gdy tylko dołączy.
- Karty produktów pokazują prawdziwy opis i czas dostawy (**⚡ Dostawa natychmiastowa** dla produktów z plikami albo tekstem). Strona płatności Stripe mówi, co dalej dzieje się z zamówieniem.
- Po zapłacie kupujący widzi **potwierdzenie zakupu**: numer zamówienia (z przyciskiem Kopiuj), kupione produkty, kwotę, ticket z przyciskiem prowadzącym prosto do niego i informację, czy zamówienie jest już dostarczone. To samo potwierdzenie przychodzi **na DM** na Discordzie (z przyciskami *Otwórz ticket* i *Moje zamówienia*). **Moje zamówienia** pokazuje każde zamówienie.
- Każda płatność trafia na kanał z logami. Przyciski Pomoc (i karta Discorda w Hammer Launcherze) korzystają z `DISCORD_INVITE_URL` albo ze stałego zaproszenia, które bot tworzy sam. To zaproszenie bot sprawdza przy starcie i co pół godziny – gdy Discord go już nie przyjmuje (np. przebudowa serwera usunęła jego kanał), tworzy nowe. Własne zaproszenie z `DISCORD_INVITE_URL` nigdy nie jest podmieniane; gdy przestanie działać, bot pisze o tym w konsoli.

**Konfiguracja:**
1. `.env`: ustaw `PUBLIC_URL` (adres, który otwierają ludzie) i `DISCORD_CLIENT_SECRET` (Developer Portal → OAuth2). W sekcji Redirects dodaj `<PUBLIC_URL>/api/shop/auth/callback`.
2. Opcjonalnie: ustaw `STRIPE_WEBHOOK_SECRET` (Stripe → Webhooks → `<PUBLIC_URL>/api/shop/stripe/webhook`).
3. Port to `WEB_PORT`. Na panelu hostingowym (Pterodactyl i podobne) zostaw go pustym: bot użyje portu, który przydzieli mu panel.

Dopóki logowanie przez Discorda i Stripe nie są skonfigurowane, strona pokazuje wyraźnie oznaczony podgląd offline. Wygląd HammerShop (jasny pomarańcz, logo z młotkiem, nazwa i obrazki) pochodzi z `scripts/website-theme.js` – `node scripts/build-website.js design.html` sam nakłada go na nowy eksport z ChatGPT, a `npm run render-assets -- web` rysuje obrazki od nowa. Konta i zamówienia ze strony są zapisywane w `data/web.json`.

## 🔨 Hammer+ i launcher

**Hammer Launcher** (launcher Minecrafta od HammerShop) ma płatny pakiet **Hammer+**. Bot wystawia do niego **podpisane kody
przypisane do konta Minecraft**: gracz wkleja kod w launcherze, a launcher sprawdza podpis bez internetu, kluczem publicznym.

**Klucz (ustawiasz raz):**
1. **Masz już klucz** (Hammer Launcher ma wbudowany jego klucz publiczny – `launcher.config.json` → `plusPublicKey`)? Wklej do
   `.env` właśnie jego: `HAMMER_PLUS_PRIVATE_KEY=…` i uruchom bota ponownie. **Nie generuj nowego** – kodów z nowego klucza
   zainstalowane launchery nie przyjmą. Tylko przy pierwszej konfiguracji: `npm run plus-key` wypisze gotową linię z nowym kluczem.
   To klucz prywatny: nikomu go nie podawaj – kto go ma, może wystawiać kody. Bez niego Hammer+ nie jest w sprzedaży na stronie,
   a bot przy starcie pisze o tym w konsoli.
2. `/hammerplus klucz` pokaże **klucz publiczny** – wpisz go w Hammer Launcherze. Zmiana klucza unieważnia wszystkie wystawione kody.

**Wystawianie kodu:** `/hammerplus nadaj nick:Notch dni:30` (`dni:0` = na zawsze). Bot sprawdza nick w Mojang i odpowiada –
tylko Tobie – kodem oraz gotową wiadomością dla klienta: kod wpisuje się w **Hammer Launcher → Hammer+ → „Mam kod”** i działa
tylko na tym koncie Minecraft. `/hammerplus lista` pokazuje, komu, na jak długo i kto wystawił kody (samych kodów bot nie
zapisuje – zgubiony kod wystawiasz od nowa), a `/hammerplus sprawdz kod:…` mówi, czyj jest kod i do kiedy działa. Wystawionego
kodu nie da się cofnąć (launcher sprawdza go offline) – przestaje działać, gdy wygaśnie.

**Polecane serwery:** `/polecane dodaj nazwa: adres: opis:` (opcjonalnie `tagi:`, `ikona:`, `wersja:`, `loader:`, `paczka:`),
`/polecane usun` i `/polecane lista`. Adres to `host` albo `host:port`, a ikona musi być adresem `https://`. Launcher pobiera
tę listę ze strony bota – zmiany widać w nim najpóźniej po 5 minutach.

**API dla launchera** – część [strony sklepu](#-strona-sklepu-prowadzona-przez-bota) (`WEB_PORT`, `PUBLIC_URL`), pod adresem `<PUBLIC_URL>/api/launcher/`:

| Adres | Do czego służy |
|---|---|
| `GET health` | Czy API działa i czy klucz Hammer+ jest ustawiony |
| `GET featured` | Polecane serwery z `/polecane` |
| `GET news` | Aktualności, komunikat na górze launchera i najnowsza wersja (z bezpośrednim adresem instalatora w `/updates/`) – to, co opublikujesz w [panelu admina](#-strona-launchera-aktualizacje-i-panel-admina). Każde zapytanie launchera liczy się jako jedno uruchomienie (same liczby na dzień i wersję) |
| `GET cloud` · `PUT cloud` | Synchronizacja danych launchera w chmurze dla konta Hammer+ (do 256 KB; starszy zapis nie nadpisze nowszego) |
| `GET capes?uuids=…` · `PUT cape` | Peleryny Hammer (`hammer`, `gold`, `ember`, `royal`, `frost`, `crimson`) – widoczne u innych graczy z Hammer Client. `hammer` i `ember` są **za darmo**: bez Hammer+ launcher potwierdza konto jego logowaniem Minecraft (nagłówek `X-Minecraft-Token`, sprawdzany w Mojang i niezapisywany) i takie peleryny nie wygasają. Pozostałe są widoczne, dopóki Hammer+ konta jest ważny. Własna peleryna z Hammer+ zostaje na komputerze gracza (widzi ją tylko on) |
| `GET plus` | Launcher odbiera przedłużenie sam: z nagłówkiem `Authorization: Bearer <kod>` (także wygasłym – nadal pokazuje, czyje to konto) dostaje `{ code, until }` – najdłużej działający kod tego konta Minecraft, czyli dokładnie ten z wiadomości bota (odtworzony z zapisu, nic nowego nie jest wystawiane), albo `code: null`, gdy nie ma dłuższego |
| `PUT presence` | Znaczek **H** / **H+** na liście graczy w grze: mod zgłasza „to konto gra teraz na Hammer Client” (`me`) i pyta o konta z listy (`uuids`, najwyżej 100) → `{ players: { "<uuid>": "h" \| "p" } }`; `p` = konto z aktywnym Hammer+. Kto gra, serwer pamięta 5 minut i tylko w pamięci; pulpit panelu pokazuje, ilu graczy gra teraz |

Chmura i wybór peleryny wymagają kodu Hammer+ (nagłówek `Authorization: Bearer <kod>`) – kontem jest konto Minecraft zapisane
w kodzie. Dane trafiają do `data/web.json`. `<PUBLIC_URL>/join?server=…&name=…` to strona dla linków „dołącz do serwera”: otwiera
serwer w Hammer Launcherze. Dopóki strona nie jest uruchomiona pod publicznym adresem, same kody działają normalnie – czekają
tylko chmura, peleryny i lista polecanych serwerów.

## 🚀 Strona launchera, aktualizacje i panel admina

Bot, strona i Hammer Launcher to jeden system – wszystko stoi na **Twoim serwerze**, nic nie idzie przez GitHub Releases:

```
                 ┌──────────── Twój serwer 24/7 (ten program) ────────────┐
 Discord  ◄────► │  bot HammerShop  ◄──►  strona (PUBLIC_URL)             │ ◄────►  Stripe (płatności)
 (serwer,        │  /zbuduj, tickety,     /            sklep              │
  tickety,       │  sklep, #launcher      /launcher    pobieranie, Hammer+│ ◄────►  Hammer Launcher u graczy
  ogłoszenia)    │                        /admin       panel admina       │         (aktualności, komunikat,
                 │                        /updates/    instalator + aktualizacje        aktualizacje, Hammer+)
                 └─────────────────────────────────────────────────────────┘
```

### Strona launchera – `PUBLIC_URL/launcher`
- **Osobne podstrony zamiast jednej długiej strony.** W profilu Hammer Launcher (`BOT_PROFILE=launcher`) to cała witryna: `/` (start: pobieranie i skróty do reszty), `/funkcje` (trzy części w jednej zakładce – przełącznik *Launcher / Hammer Client / Wygląd* pokazuje jedną naraz; do części prowadzą adresy `/funkcje#hammer-client` i `/funkcje#wyglad`), `/hammer-plus` (plany, zakup, *Twoje kody*), `/polecaj`, `/aktualnosci`, `/pomoc` (częste pytania), `/kontakt` (formularz) i `/hammershop` (nasz współtwórca). W profilu sklepu te same podstrony są pod `/launcher` (`/launcher/hammer-plus` itd.). Każda ma własny tytuł, opis i obrazek do udostępniania; adres, którego nie ma, dostaje prawdziwą stronę 404, a `robots.txt` i `sitemap.xml` robią się same. **Stare linki działają dalej:** `/launcher`, `/launcher#plus`, `/#polecaj`, `/#faq` itd. (są w zainstalowanych launcherach, kartach na Discordzie i zakładkach) prowadzą od razu na właściwą podstronę, a dawne `/hammer-client` i `/wyglad` – do swoich części w zakładce *Funkcje*.
- ***Twoje kody Hammer+*** pokazują tylko kody, które jeszcze działają – kod, którego czas minął, znika z listy (najdłużej ważny jest na górze, a gdy jest ich więcej niż trzy, resztę chowa przycisk *Pokaż wszystkie*).
- Przycisk **Pobierz na Windows** (`/download`) daje aktualny instalator z Twojego serwera i pokazuje wersję, rozmiar i datę. Dopóki nic nie opublikujesz, przycisk mówi *Już wkrótce*.
- **Oficjalny start:** nad przyciskiem *Pobierz* na stronie głównej jest pasek „🚀 Oficjalny start: **6 grudnia 2026**” z odliczaniem (*za 17 dni*, *jutro*), w dniu premiery „🚀 Startujemy dziś!”, a dzień później znika sam. Datę zmieniasz w pliku `config.launcher.json` → `"launch"`: `"date": "2026-12-06"` (rok-miesiąc-dzień) i, jeśli chcesz, `"time": "18:00"` (czas polski – wtedy w dniu premiery pasek mówi „dziś o 18:00”). Zapisz plik i uruchom bota ponownie. Pusta data (`""`) = bez paska.
- **Pobieranie wymaga zalogowania przez Discorda** (tak jak zakup Hammer+): niezalogowany widzi przycisk *Zaloguj przez Discord i pobierz*, przechodzi przez Discorda (i przy okazji trafia na serwer), wraca na stronę, a ta sama zaczyna pobieranie – z napisem „Pobieranie się zaczęło…” i linkiem na wypadek, gdyby nie ruszyło. Pobrania zalogowanych liczą się też na ich konto (statystyki poleceń). Dopóki logowanie przez Discorda nie jest skonfigurowane, przycisk pobiera od razu. Aktualizacje (`/updates/`) i przycisk „Pobierz ze strony” w samym launcherze (prowadzi wprost do instalatora) nigdy nie wymagają logowania.
- **Zaproś znajomego** (podstrona `/polecaj`): każdy zalogowany ma swój link `PUBLIC_URL/r/<kod>` (8 znaków, zawsze ten sam). Wejście z linku zapamiętuje polecającego na 30 dni i prowadzi na stronę launchera. Polecenie liczy się, gdy znajomy **pierwszy raz** loguje się na stronie przez Discorda z tym linkiem – nie siebie, tylko nowe osoby (kto logował się wcześniej, nie może zostać polecony później), konto Discord znajomego starsze niż 30 dni (świeże konta-klony się nie liczą), jeden polecający na zawsze. Gdy polecony znajomy **pierwszy raz** kupi Hammer+, polecający dostaje **+7 dni Hammer+**: jeśli ma działający Hammer+ na koncie powiązanym z Discordem (kupiony na stronie albo `/hammerplus nadaj … osoba:`), bot od razu wystawia nowy kod z doliczonymi 7 dniami (jak przy drugim zakupie – kod wkleja się w launcherze, zastępuje stary), wysyła go na DM i pilnuje rangi 💎 Hammer+; jeśli nie – dni czekają na stronie, a polecający odbiera je, wpisując nick Minecraft (kod pokazuje się na stronie i przychodzi na DM). Sekcja pokazuje link z przyciskiem *Kopiuj*, ile osób przyszło z linku, ile pobrało launcher, ile kupiło Hammer+ i ile dni zdobył.
- **Aktualności** z panelu admina, zrzuty ekranu, częste pytania.
- **Wygląd strony:** podstrony leżą w `web/pages/` – `layout.html` (wspólny nagłówek, menu, stopka, ikony) i po jednym pliku na podstronę; serwer składa je w całość (`src/web/pages.js` – tam też tytuły i opisy podstron). Style i skrypt są wspólne: `web/public/assets/launcher.css` i `launcher.js` (wspólne przyciski i formularze z `site.css`, którego używa też panel admina); mały `launcher-head.js` działa, zanim strona się narysuje: przenosi stare linki z `#` na nowe podstrony i wybiera część zakładki *Funkcje* z adresu. Font Montserrat leży w `web/public/assets/fonts/`, zrzuty launchera, motywy, kosmetyki z gry, peleryny i obrazek do udostępniania (`og.jpg`) – w `web/public/assets/launcher/`. Strona nie ładuje niczego z innych adresów (pilnuje tego Content-Security-Policy w `src/web/server.js`) – nowy obrazek albo font wrzuć do tych folderów. Animacje (iskry, 3D, wjazd sekcji, nagrania) wyłączają się same, gdy system ma ograniczone animacje.
- **Nagrania z launchera** („gify” – krótkie wyciszone filmy w pętli: Graj, Mody, Optymalizacja, motywy, peleryny) leżą w `web/public/assets/launcher/clips/` (`.webm` + `.mp4` + plakat). Nagrywa je od nowa jedna komenda: `node tools/record-launcher-clips.js` (albo tylko wybrane: `… graj mody`). Używa prawdziwego interfejsu launchera z jego danymi testowymi (`hammer-launcher/scripts/preview.js`), więc po zmianie launchera wystarczy ją powtórzyć. Te same dane dają zrzuty ekranu strony: `node tools/record-launcher-clips.js --stills` rysuje od nowa `hero-1400.webp`, `hero-820.webp`, `graj.jpg`, `instancje`, `mody`, `optymalizacja` (`.webp` + `.jpg`) i `motyw-*.webp`. Potrzebny jest Playwright z Chromium (jest w launcherze) i ffmpeg.
- **Logo:** znak launchera to młot z wokseli (zestaw logo: pliki 3D i pixel-art 16/24/32 px). Strona bierze go z czterech plików w `web/public/assets/launcher/`: `logo-mark.png` (znak – nagłówek, plakietki, klocki 3D, stopka), `logo-mark-big.webp` (duży znak na końcu strony), `logo-app.png` (ikona aplikacji na kafelku) i `logo-hammershop.png` (znak współtwórcy – złote H HammerShop, przezroczyste, bez kafelka). Nazwy są tylko w zmiennych `--logo…` na górze `launcher.css`. Ikona karty przeglądarki: `launcher/favicon-16.png` i `favicon-32.png` (pixel-art) oraz `web/public/assets/launcher-icon.png` (256 px – też obrazek statusu Discorda w launcherze); znak w nagłówku panelu admina i stron „Dołącz”: `web/public/assets/launcher-mark.png`. `launcher-icon.png` i `launcher-mark.png` rysuje `npm run render-assets -- launcher`. Po zmianie logo uruchom też `node tools/record-launcher-clips.js` i `node tools/render-og-image.js` (nagrania i obrazek do udostępniania z nowym logo). Peleryny w karuzeli 3D (`launcher/cape-*.png`) to zewnętrzna strona peleryn launchera (`hammer-launcher/src/renderer/assets/capes/`, rysuje je `hammer-client/tools/gen_capes.py` i `gen_cosmetics.py`) w 4 px na teksel: 40×64, ruchome – 16 klatek 40×64 jedna pod drugą; po zmianie peleryn wytnij je ponownie.
- **Hammer+ kupowany kartą (Stripe):** gracz loguje się przez Discorda, wybiera plan, wpisuje **nick Minecraft** (sprawdzany w Mojang, zanim cokolwiek zapłaci) i płaci. Zaraz po płatności bot wystawia kod dla tego konta – kupujący widzi go **na stronie** (także później, w *Twoje kody Hammer+*) i dostaje **na DM**. Kupno w trakcie trwającego Hammer+ dolicza czas na końcu. Sam kod nigdy nie jest zapisywany – strona podpisuje go od nowa z danych zamówienia. Każdy zakup trafia do logów i do `/hammerplus lista` („kupiony na stronie”).
- **Ranga 💎 Hammer+ na Discordzie:** kto ma działający Hammer+, dostaje rangę **💎 Hammer+** – zaraz po zakupie (kupujący loguje się przez Discorda, więc bot wie, czyje to konto), po dołączeniu na serwer, przy logowaniu na stronie i przy sprawdzaniu co 30 minut. Gdy Hammer+ się skończy, ranga znika. Kogo nie ma na serwerze, dostaje w wiadomości prywatnej zaproszenie (a strona pokazuje przycisk *Dołącz do Discorda*). `/zbuduj` tworzy tę rangę; na serwerze zbudowanym wcześniej bot zrobi ją sam przy pierwszym zakupie (potrzebuje uprawnienia *Zarządzanie rolami*). Przy `/hammerplus nadaj` możesz podać `osoba:` – to konto Discord też dostanie rangę.
- Link **Launcher** jest też w menu strony sklepu.

### Aktualizacje launchera – `PUBLIC_URL/updates/`
Zainstalowany launcher sam sprawdza `PUBLIC_URL/updates/latest.yml`, pobiera nową wersję w tle i instaluje ją przy następnym uruchomieniu. Plik `latest.yml` tworzy strona – z instalatora, który wgrasz w panelu (wersja, sha512, rozmiar). Pobieranie obsługuje wznawianie i pobieranie samych zmian (`.blockmap`).

**Jak wydać nową wersję:**
1. Zbuduj launcher (GitHub Actions → artefakt **Hammer-Launcher-Windows**) i przetestuj instalator u siebie.
2. `PUBLIC_URL/admin` → **Wersje launchera** → wgraj `Hammer-Launcher-Setup-x.y.z.exe` (i, jeśli chcesz, plik `.blockmap`). Duży plik możesz też wrzucić na serwer do `data/releases/` przez SFTP – pojawi się na liście.
3. Wpisz wersję i „Co nowego”, kliknij **Opublikuj wersję**. Gotowe: strona daje ten plik do pobrania, launchery się aktualizują, a bot ogłasza wersję na **#launcher** (z pingiem roli *Ogłoszenia*).
4. *Najstarsza wspierana wersja* – starsze launchery pokażą „Wymagana aktualizacja” i nie pozwolą grać, dopóki się nie zaktualizują. Używaj tylko wtedy, gdy stara wersja naprawdę nie może działać.
5. Coś poszło nie tak? **Ustaw jako aktualną** przy starszej wersji – strona wraca do niej (launchery z nowszą wersją same się nie cofną, więc najlepiej wydać poprawkę z wyższym numerem).

**Podpisywanie wydań (zalecane):** aktualizacja to program uruchamiany na komputerach wszystkich graczy. Launcher zawsze sprawdza sumę sha512 z `latest.yml`, ale jeśli w `launcher.config.json` ustawisz `updatePublicKey`, przyjmie **tylko wydania podpisane Twoim kluczem** – wtedy nawet ktoś, kto włamałby się na serwer albo konto admina, nie podmieni aktualizacji. Klucz prywatny trzymasz u siebie (nie na serwerze): `node scripts/sign-release.js` w folderze launchera robi plik `.sig`, którego zawartość wklejasz w polu *Podpis wydania* (szczegóły w README launchera).

### Panel admina – `PUBLIC_URL/admin`
Logujesz się przez Discorda. Dostęp mają tylko: **właściciel** (właściciel serwera i `OWNER_IDS` z `.env`) – wszystko – oraz **administratorzy bota** (role CEO … Administrator) – wszystko oprócz wersji launchera i cennika Hammer+. Każda zmiana trafia na kanał logów z informacją, kto ją zrobił.

| Zakładka | Co robi |
|---|---|
| **Pulpit** | Ile launcherów uruchomiono dziś i w ostatnich 14 dniach, pobrania instalatora, używane wersje, aktywne konta Hammer+, przychód ze strony. Liczone są same liczby – bez adresów IP i kont. Na dole *(tylko właściciel)*: **Wyzeruj statystyki** i – na serwerze Hammer Launcher – **Start od zera (przed premierą)** (zob. [🧹 Jak wyzerować dane](#-jak-wyzerować-dane)) |
| **Aktualności** | Wiadomości na ekranie głównym launchera („Aktualności”) i na stronie launchera: tytuł, treść, etykieta, link, obrazek, przypięcie. Opcjonalnie od razu także na Discordzie (**#launcher**). U graczy pojawiają się najpóźniej po 10 minutach |
| **Ogłoszenia** | Ładne ogłoszenie na Discordzie, na **#📢 ogłoszenia** – ta sama karta co z `/ogloszenie`: tytuł, treść z Markdownem Discorda (przyciski **B** / *I* / lista / link), rodzaj (Ogłoszenie, Aktualizacja, Wydarzenie, Ważne – kolor i baner), obrazek pod treścią (link `https://`), przycisk z linkiem i ping: bez pingu, rola **📢 Ogłoszenia** albo `@everyone` *(tylko właściciel, z dodatkowym potwierdzeniem)*. Podgląd na żywo wygląda jak wiadomość na Discordzie. Wiadomość jest od razu publikowana dla serwerów, które obserwują kanał. Pod spodem 20 ostatnich ogłoszeń z panelu (kto, kiedy, link) z przyciskiem *Usuń z Discorda*; każde trafia też na **#📋 logi-serwera** |
| **Plany** | *(serwer Hammer Launcher)* Karta na Discordzie, na **#🗺️ plany**: dodawanie, edycja i usuwanie punktów (tytuł do 80 znaków, krótka notka do 140), wybór sekcji (*Teraz robimy*, *W następnej wersji*, *Później*, *Ostatnio zrobione* – tu nowe punkty trafiają na górę), strzałki ↑ ↓ zmieniające kolejność w sekcji i podgląd karty. **Każdy zapis od razu zmienia kartę** – bot edytuje tę samą wiadomość i nikogo nie pinguje, więc nie ma osobnego przycisku „Opublikuj”, o którym można zapomnieć. *Odśwież kartę na Discordzie* wysyła ją od nowa, gdy ktoś ją usunął albo Discord nie odpowiadał przy zapisie (zmiana zostaje wtedy zapisana w panelu). Limity pilnują, żeby karta zawsze mieściła się w jednej wiadomości (najwyżej 20 punktów i tyle tekstu, ile zmieści Discord). Każda zmiana trafia na kanał logów |
| **Komunikat** | Pasek na samej górze launchera (informacja / ostrzeżenie / ważne), z linkiem i czasem wyświetlania – np. przerwa techniczna |
| **Wersje launchera** | Wgrywanie instalatora, publikacja, wymagana wersja, podpis, powrót do starszej wersji, liczba pobrań *(tylko właściciel)* |
| **Hammer+** | Wystawianie kodu dla nicku, sprawdzanie kodu, lista wystawionych i **cennik na stronie** – plany (nazwa, dni, cena) sprzedawane przez Stripe *(cennik: tylko właściciel)*. Pusty cennik = sprzedaż wyłączona. Na dole **Zaproś znajomego**: liczba linków, poleconych, pobrań, zakupów i dni w nagrodach oraz kto polecił najwięcej osób |
| **Polecane serwery** | Lista „Polecane serwery” w launcherze (to samo co `/polecane`) |
| **Partnerstwa** | *(serwer Hammer Launcher)* Partnerzy – lista (logo, nazwa, rodzaj: *Discord*, *Minecraft* albo *Discord + Minecraft*, link do kanału, zaproszenie, adres serwera) i formularz: nazwa (do 40 znaków), rodzaj (trzy przyciski jak sekcje w *Planach*), opis (do 200), ikona – adres `https://` albo **logo z komputera** (PNG / JPG / WebP / GIF do 2 MB; bot sprawdza, czym plik naprawdę jest i jaki ma rozmiar w pikselach, trzyma go w `data/partners/` i podaje stronie pod adresem, który zmienia się razem z obrazkiem), zaproszenie na Discorda partnera (bot sprawdza je w Discordzie: martwe albo z terminem ważności odrzuca, a z żywego bierze nazwę, ikonę i liczbę osób) i serwer Minecraft (adres, wersja, loader, paczka z Modrinth, do 5 tagów – *partner* dochodzi sam). **Discord** → kanał w 🤝 PARTNERSTWA z kartą; **Minecraft** → wpis w polecanych serwerach launchera; **Edytuj** zmienia nazwę kanału, kartę i wpis (zmiana rodzaju dodaje albo usuwa kanał i wpis; kanał usunięty ręcznie wraca po zapisie). Kolejność: logo z komputera → ikona z adresu → ikona serwera Discord (w launcherze logo z komputera się nie pokazuje – tam zostaje ikona z adresu albo z Discorda). Opcja **Ogłoś na #ogłoszenia** (domyślnie wyłączona) wysyła krótkie ogłoszenie bez pingu. **Zakończ** pyta o potwierdzenie i usuwa kanał, wpis w launcherze, kartę ze strony i logo – z opcją **Ogłoś zakończenie** (domyślnie włączona, bez pingu). Ogłoszenia trafiają też do historii w zakładce *Ogłoszenia*. Najwyżej 45 partnerów (kategoria na Discordzie mieści 50 kanałów) i tyle serwerów Minecraft, ile mieści lista polecanych (25) |
| **Zamówienia** | Ostatnie 100 płatności ze strony ze statusem i linkiem do ticketu |
| **Wiadomości** | To, co ludzie piszą w formularzu **Kontakt** na stronie – najnowsze na górze, z licznikiem nieprzeczytanych na zakładce: data, imię, temat, e-mail, konto Discord (jeśli ktoś był zalogowany), cała treść, **Przeczytane** i **Usuń** *(usuwa tylko właściciel)*. **Odpowiedz** otwiera pole odpowiedzi na karcie wiadomości: temat jest już wpisany („Re: <temat> – Hammer Launcher”, można zmienić), licznik pilnuje 4000 znaków, a **Wyślij** od razu wysyła ładny e-mail (logo, Twoja odpowiedź, pod spodem jej wiadomość z datą i tematem) z konta strony do tej osoby – „Odpowiedz” u niej trafi na adres kontaktowy. Wynik widać od razu: zielona plakietka **✅ Odpowiedziano** i historia odpowiedzi na karcie albo czerwony powód (brak `MAIL_PASS`, złe hasło, adres odrzucony przez serwer poczty, serwer poczty nieosiągalny) – wpisany tekst zostaje w polu. Mały link **Otwórz w poczcie** otwiera zamiast tego program pocztowy na komputerze. Na górze widać, czy e-mail jest włączony i dokąd idzie, a **Wyślij testowy e-mail** *(tylko właściciel)* pokazuje prawdziwy wynik – np. złe hasło albo port zablokowany przez hosting. W panelu zostaje 300 ostatnich wiadomości |

Na Discordzie `/zbuduj` tworzy kanał **#launcher** z kartą launchera i przyciskami *Pobierz launcher* / *Hammer+* (na istniejącym serwerze: `/zbuduj tylko:update`), a `/launcher` pokazuje tę kartę z aktualną wersją każdemu, kto zapyta.

**Uruchomienie na własnym serwerze** (VPS, domena, HTTPS, Stripe, kopie zapasowe) – krok po kroku w [`DEPLOY.md`](DEPLOY.md).

## ✉️ Kontakt i e-mail ze strony

Strona ma formularz **Kontakt** (imię, e-mail, temat, wiadomość – bez logowania). Każda wiadomość:

1. **zawsze** trafia do panelu admina → zakładka **Wiadomości**,
2. **zawsze** pojawia się jako karta na czacie zespołu na Discordzie (**#💼 czat-zespołu**; bez tego kanału – w logach serwera) – bez pingowania kogokolwiek, z przyciskiem do panelu,
3. a gdy włączysz e-mail – przychodzi też na **adres kontaktowy** (`config.launcher.json` → `"contact"` → `"email"`, dla Hammer Launchera `hammerlauncherclient@gmail.com`). Klikasz w poczcie **Odpowiedz** i piszesz prosto do tej osoby – albo odpisujesz z panelu admina (**Wiadomości** → **Odpowiedz** → **Wyślij**), bez żadnego programu pocztowego.

Na ten sam adres przychodzi też e-mail o **każdym zakupie na stronie** (numer zamówienia, co kupiono, nick Minecraft, kwota, konto Discord i e-mail kupującego, godzina, a przy Hammer+ **sam kod** – możesz go przekazać, gdyby kupujący napisał, że go nie ma) i o odebranej nagrodzie z „Zaproś znajomego”.

**Kupujący też dostaje e-mail** – na adres, który wpisał na stronie płatności Stripe: ładne potwierdzenie (wersja HTML i zwykły tekst) z kodem Hammer+, planem, kontem Minecraft, datą ważności, trzema krokami aktywacji, numerem zamówienia i informacją, gdzie szukać pomocy (zakup w sklepie: co kupił i gdzie dostanie zamówienie). Każdy z tych e-maili wychodzi **raz na zamówienie**, a panel admina → **Zamówienia** pokazuje przy każdym opłaconym zamówieniu, czy poszedł: „e-mail do kupującego: wysłany na …” albo „nie wysłano – …” z powodem (np. brak `MAIL_PASS`, złe hasło, Stripe nie podał adresu).

**Ikonka w e-mailu i przy nadawcy.** Na górze e-maila jest ikona serwera (młot z wokseli) – wysłana w samym e-mailu, więc widać ją od razu, bez ładowania obrazków. Kółko z ikonką obok nadawcy w Gmailu (domyślnie szary ludzik) to **zdjęcie profilowe konta Google**, z którego bot wysyła pocztę – ustawisz je tak: zaloguj się na hammerlauncherclient@gmail.com → myaccount.google.com → **Informacje osobiste** → **Zdjęcie** → wgraj `assets/brand/logo-launcher.png` (kwadrat 1024 px). Gmail pokaże je przy każdym e-mailu od bota (zmiana może zająć do kilku godzin).

**Tekst pod przyciskiem „Zapłać” na stronie Stripe** (np. „Zaraz po płatności zobaczysz swój kod Hammer+…”) wysyła bot przy każdej płatności – w panelu Stripe go nie zmienisz. Tak samo nazwę nad ceną i linijkę pod ceną. Wszystkie trzy zmieniasz w `config.launcher.json` → `checkout`: `plusName` (nazwa nad ceną), `plusDescription` (linijka pod ceną) i `plusMessage` (tekst pod przyciskiem, do 1200 znaków; pusty = bez tej linijki). Bot sam wstawia `{plan}` (nazwa planu z panelu admina → Hammer+), `{nick}` (konto Minecraft), `{time}` („30 dni” albo „na zawsze”) i `{days}`. Po zmianie uruchom bota ponownie. Kolory, logo i czcionkę strony płatności ustawiasz w panelu Stripe: **Settings → Branding**.

**Jak włączyć e-mail (darmowy Gmail, 5 minut):**
1. Zaloguj się na konto Gmail z adresu kontaktowego i na stronie `myaccount.google.com/security` włącz **Weryfikację dwuetapową**.
2. Wejdź na `myaccount.google.com/apppasswords`, wpisz dowolną nazwę (np. *Strona Hammer*) i kliknij **Utwórz**. Google pokaże 16 liter – to „hasło do aplikacji”.
3. W pliku `.env` na serwerze dopisz linię `MAIL_PASS=` i wklej te 16 liter (ze spacjami albo bez). To jedyna potrzebna linia.
4. Uruchom bota ponownie.
5. Panel admina → **Wiadomości** → **Wyślij testowy e-mail**. Zielony komunikat = działa (sprawdź skrzynkę, także Spam). Czerwony mówi wprost, co jest nie tak: złe hasło albo zablokowany port – wtedy napisz do pomocy hostingu z prośbą o odblokowanie portu 465 albo 587 (SMTP) dla `smtp.gmail.com`.

Bez `MAIL_PASS` formularz, zakładka **Wiadomości** i karta na Discordzie działają normalnie – nie wychodzą tylko e-maile. Kłopot z pocztą nigdy nie psuje zakupu ani wysłania wiadomości. Inna skrzynka niż Gmail: `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_TO` (opis w `.env.example`). `npm run check` mówi, czy e-mail jest włączony – nigdy nie wypisuje hasła.

Przed spamem chroni limit (3 wiadomości na 10 minut i 10 dziennie z jednego adresu IP; razem najwyżej 30 na godzinę i 200 dziennie) oraz ukryte pole-pułapka na boty.

## 🤖 Asystent AI w ticketach (Hammer Launcher)

Na serwerze **Hammer Launcher** (`BOT_PROFILE=launcher`) bot może odpowiadać w ticketach, zanim odpisze ktoś z zespołu.
Domyślnie korzysta z **darmowego Groq** (kilka darmowych modeli po kolei, na początek `openai/gpt-oss-120b`) – nie trzeba
za nic płacić ani podawać karty.
Do wyboru jest też płatny **Claude** albo inny darmowy dostawca zgodny z OpenAI, np. **Gemini**.

**Co robi:**
- Gdy ktoś otworzy ticket, od razu **odpowiada na pytanie z formularza** (także na darmowym Groq – jedno zapytanie na
  ticket). Pierwsza wiadomość wygląda tak:
  ```
  Cześć! Jestem asystentem AI Hammera.

  (odpowiedź)
  -# 🔨 Asystent AI
  [Zawołaj zespół] [Wyłącz asystenta]
  ```
  (🔨 to emotka z logo serwera, gdy `/zbuduj` ją wgrał). Kolejne wiadomości to sama odpowiedź i podpis `-# 🔨 Asystent AI`.
  Gdy w formularzu nie ma pytania (np. sam nick) albo zapytanie się nie uda (skończył się darmowy limit, błąd dostawcy),
  zamiast odpowiedzi jest gotowe powitanie dla danego rodzaju ticketu. Potem odpowiada na każdą wiadomość autora (czeka
  chwilę, aż ktoś skończy pisać, i pokazuje „pisze…”).
- Odpowiada krótko i konkretnie, prawdziwymi nazwami z launchera (np. **Optymalizacja → Zoptymalizuj wszystko**), a gdy
  czegoś brakuje, pyta dokładnie o to (np. link z **Konsola → Wyślij logi**). Nigdy nie wysyła urwanego zdania: gdy
  dostawca utnie odpowiedź, zostają jej pełne zdania; długa odpowiedź idzie w dwóch wiadomościach.
- Przed każdą odpowiedzią zagląda do **bazy wiedzy** – pytań i odpowiedzi, które zespół dodaje komendą `/wiedza dodaj` (niżej).
- Pomaga z launcherem, Hammer Client i Hammer+ (instalacja, SmartScreen, logi, FPS, kody…), podaje aktualną wersję
  launchera i cennik Hammer+ z panelu admina.
- **Nagrody z giveawayów:** sprawdza, czy autor ticketu naprawdę wygrał. **Hammer+** wydaje od razu (kod na nick
  Minecraft – w tickecie i w DM, razem z rangą 💎 Hammer+); każdą inną nagrodę (Nitro, pieniądze…) oznacza jako zgłoszoną
  i woła zespół z opisem: kto, który giveaway, jaka nagroda. Każdą nagrodę można odebrać tylko raz, tylko w ciągu 48 h od
  losowania i tylko dla siebie – bez względu na to, co ktoś napisze. Żeby bot wiedział, na ile dni jest Hammer+,
  ustaw w `/giveaway start` opcję `hammerplus-dni` (`0` = na zawsze); przy starszych giveawayach czyta to z nazwy nagrody
  („Hammer+ 30 dni”, „Hammer+ na zawsze”), a gdy nie jest pewny – przekazuje sprawę zespołowi. Po `/giveaway losuj-ponownie`
  nagrodę może odebrać już tylko nowy zwycięzca (kto zdążył odebrać wcześniej, zachowuje swoją).
- **„Człowiek”, „admin”, „ktoś z zespołu”…** – na prośbę o człowieka bot sam pinguje zespół (👑 CEO, 🔱 Co-CEO, 🎧 Support)
  i pisze, że pomoc jest w drodze. To samo robi przy płatnościach, zwrotach, zgłoszeniach użytkowników, odwołaniach od kar
  i podaniach (tam tylko zbiera szczegóły – niczego nie ocenia).
- **Milknie**, gdy w tickecie odpisze ktoś z zespołu, po zawołaniu zespołu i po 25 odpowiedziach w jednym tickecie.
  Włączysz go z powrotem przyciskiem albo `/asystent ticket stan:Włącz`; `/asystent wylacz` wyłącza go na całym serwerze.
- W logach ticketów (#📁 logi-ticketów) zapisuje, co zrobił (wydana nagroda, zawołany zespół, błędy, przerwa) – nigdy
  treści rozmowy. Nie prosi o hasła ani dane karty i nie obiecuje zwrotów.

**Bez AI też działa najważniejsze.** W tickecie **„Odbierz nagrodę”** bot od razu pokazuje listę nieodebranych wygranych
autora z przyciskiem **„Odbierz: …”** przy każdej – także bez klucza i gdy asystent ma przerwę (na Claude: bez klucza
i w przerwie; tam nagrody wydaje też sam asystent). Hammer+
wydaje się od razu – bot pyta tylko o nick Minecraft w okienku – a inne nagrody bot zgłasza zespołowi. Kto nic nie wygrał,
dostaje krótką informację, że zespół to sprawdzi (bez pingu). Prośba o człowieka nadal woła zespół, a pozostałe tickety
działają jak zawsze.

**Jak go włączyć (Groq – za darmo):**
1. Wejdź na **console.groq.com** i zaloguj się (np. kontem Google albo GitHub) – karta nie jest potrzebna.
2. Otwórz **API Keys** → **Create API Key**, nazwij go np. „bot” i skopiuj klucz (`gsk_…`).
3. Wklej go do `.env`: `GROQ_API_KEY=gsk_…` (nikomu go nie pokazuj).
4. Uruchom bota ponownie (po aktualizacji najpierw `npm install`). W konsoli pojawi się
   „🤖 Asystent AI w ticketach: Groq (darmowy) · modele po kolei …”, a `/asystent status` pokaże to samo.

**Darmowe limity – uczciwie:** darmowy plan Groq jest mały i liczony **osobno dla każdego modelu** (na całe konto):
w chwili pisania to mniej więcej **30 zapytań i ok. 8 tys. tokenów na minutę oraz ok. 1000 zapytań i 200 tys. tokenów
dziennie na model** (dokładne liczby dla Twojego konta: console.groq.com → **Settings → Limits**). Dlatego bot:
- przy otwarciu ticketu pyta AI tylko raz i tylko wtedy, gdy w formularzu jest pytanie (w tickecie z nagrodą od razu
  przyciski, bez pytania AI),
- wysyła darmowym modelom krótką instrukcję, tylko ostatnie 6 wiadomości i tylko narzędzia potrzebne w danym tickecie
  (jedno zapytanie to zwykle ok. 2–3 tys. tokenów),
- **sam przełącza się między kilkoma darmowymi modelami**: gdy jednemu skończy się limit, to samo pytanie od razu trafia
  do następnego – w tickecie nic nie widać. Domyślna kolejka: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`,
  `llama-3.3-70b-versatile`, `meta-llama/llama-4-scout-17b-16e-instruct`, `qwen/qwen3-32b`. Model, którego Groq już nie ma,
  bot pomija (jedno ostrzeżenie w konsoli).

Dopiero gdy limit skończy się **wszystkim** modelom, bot pisze w tickecie, że asystent ma przerwę, i w tej samej wiadomości
woła zespół. Do odnowienia limitu (najwyżej godzina, potem próbuje znowu) działa bez AI – nagrody przyciskami – a po przerwie
odpowiada w tym tickecie dalej (chyba że w międzyczasie odpisał ktoś z zespołu). Limity minutowe, które zwalniają się
w kilka sekund, bot po prostu odczekuje. `/asystent status` pokazuje każdy model (✅ działa / ⏸️ limit do … / ❌ niedostępny)
i ile dziś zapytań oraz tokenów zużył.

<a id="baza-wiedzy-asystenta"></a>**Baza wiedzy asystenta – komenda `/wiedza`.** Pytania, które ludzie często zadają, i odpowiedzi
zespołu dodajesz prosto na Discordzie – bez szukania i edytowania plików:
- **`/wiedza dodaj`** otwiera okienko: **Pytanie** (można wpisać kilka sposobów zapytania – każdy w osobnej linii, np.
  „Jak pobrać launcher?” i „Skąd ściągnąć Hammer Launcher?”) i **Odpowiedź** (do 1500 znaków; krótko, z prawdziwymi
  nazwami z launchera). Działa od razu, bez ponownego uruchamiania. Bot potwierdza numer wpisu i zapisuje zmianę w
  #📋 logi-serwera (bez pingów).
- **`/wiedza lista`** – wszystkie wpisy z numerami (strony przyciskami) i ile razy asystent dostał każdy z nich do odpowiedzi.
- **`/wiedza edytuj numer:`** – to samo okienko z obecną treścią; **`/wiedza usun numer:`** – usuwa (po potwierdzeniu).
- **`/wiedza test pytanie:`** – pokazuje, które wpisy asystent weźmie przy takim pytaniu: 🟢 **pasuje** (odpowie na
  jego podstawie), 🟡 **słabo** (dostanie go, ale sam oceni, czy pasuje), 🔴 **nie pasuje** (z brakującymi słowami –
  dopisz takie pytanie jako kolejną wersję we wpisie). Mówi też, gdy asystent jest wyłączony albo nie ma klucza.

Komenda jest tylko na serwerze Hammer Launcher i tylko dla zespołu. Wpisy są w danych bota (`data/db.json`), więc są
w automatycznych kopiach zapasowych i żadna aktualizacja ich nie nadpisze. Limit: 300 wpisów, do 10 wersji pytania
w jednym wpisie.

Asystent szuka pytań podobnych do tego w tickecie – bez względu na polskie znaki („jak pobrac” znajdzie „Jak pobrać…”),
odmianę słów, jedną literówkę w dłuższym słowie („launher”) i kilka synonimów („ściągnąć” = „pobrać”). Słowa, które
są prawie w każdym tickecie („launcher”, „gra”, „działa”, „zmienić”…), same nie wystarczą, żeby wpis pasował – dzięki
temu pytanie o zmianę nicku nie dostanie odpowiedzi o zmianie wersji. Gdy wpis wyraźnie pasuje, asystent odpowiada na
jego podstawie (własnymi słowami, nigdy wbrew niemu). Liczy się też **treść odpowiedzi**: wpis „Jakie płatności
akceptujecie? → przyjmujemy Revolut, kartę, Przelewy24” pasuje do pytania „czy mogę zapłacić revolutem?”.

Oprócz pasujących wpisów (te idą na górę) asystent dostaje przy każdej odpowiedzi **całą resztę bazy**, dopóki się mieści
(ok. 2000 znaków na darmowym planie), i pamięta wpisy, które pasowały wcześniej w tym samym tickecie – dzięki temu
odpowiada dobrze także na dopytania innymi słowami („a przez p24?”). Ma polecenie, że **wiedza zespołu jest ważniejsza
niż wszystko, co wie sam**, i że nigdy nie mówi „nie da się”, jeśli wiedza zespołu mówi, że się da. Metod płatności nie
zna z siebie – bierze je tylko z bazy wiedzy, więc wpisz je przez `/wiedza dodaj`. `/asystent status` pokazuje, ile
wpisów jest z komendy, a ile z pliku.

**Plik `wiedza-asystenta.md` (nieobowiązkowy).** Wpisy z pliku w folderze bota (obok `config.json`) też działają –
asystent przeszukuje oba źródła, a `/wiedza lista` pokazuje je z dopiskiem „z pliku” (zmieniasz je w pliku). Bot tworzy
pusty plik przy pierwszym starcie; nie ma go w paczce bota, więc aktualizacja go nie nadpisze. Format: pytanie jako punkt
`- `, pod nim odpowiedź jako punkt wcięty **tabulatorem** (albo dwiema spacjami):
```
- Jak pobrać launcher?
- Skąd pobrać launcher?
	- Tylko z hammerclient.com – zaloguj się przez Discorda, a pobieranie ruszy samo.
```
Linie zaczynające się od `#` i komentarze `<!-- … -->` są pomijane; zmiany działają od razu. Jeśli edytor na hostingu
psuje wcięcia (`/asystent status` pokaże wtedy pytania bez odpowiedzi), dodaj te wpisy przez `/wiedza dodaj`.

**Uczciwie o prywatności:** na darmowych planach dostawca AI może wykorzystywać rozmowy do ulepszania swoich modeli.
Dlatego w ticketach nikt nie prosi o hasła ani dane karty – zespół tego nie robi i asystent też nie.

**Własna lista modeli:** w `.env` wpisz modele po przecinku, w kolejności, w jakiej mają odpowiadać, np.
`AI_MODEL=openai/gpt-oss-120b, llama-3.3-70b-versatile, qwen/qwen3-32b` (aktualne nazwy: **console.groq.com/docs/models**).
Modele, które nie prowadzą rozmów (np. Prompt Guard, Whisper), bot pomija. Gdy żaden model z listy nie działa, bot napisze
w konsoli, co poprawić, i do ponownego uruchomienia działa bez AI.

**Inny dostawca (`AI_PROVIDER` w `.env`):**
- `auto` (domyślnie) – Groq, gdy jest `GROQ_API_KEY`; inaczej Claude, gdy jest `ANTHROPIC_API_KEY`; inaczej bez AI.
- **Gemini** (też ma darmowy plan): `AI_PROVIDER=openai`, `AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`,
  `AI_API_KEY=` (klucz z aistudio.google.com → Get API key), `AI_MODEL=gemini-2.5-flash`. Tak samo działa każdy inny
  dostawca zgodny z OpenAI – wystarczy jego adres, klucz i nazwa modelu.
- **Claude** (płatny, najlepszy): `AI_PROVIDER=claude` (albo tylko `ANTHROPIC_API_KEY` bez klucza Groq) i klucz z
  **console.anthropic.com** → *API Keys* (najpierw doładuj środki w *Billing*). Domyślny model `claude-opus-5-5`
  (4 $ za milion tokenów wejścia, 20 $ za milion wyjścia; instrukcja asystenta jest zapamiętywana – *prompt caching* – więc
  typowa odpowiedź to ok. 1–2 centy). Odmowy modelu Claude API samo ponawia na modelu zapasowym (*refusal fallbacks*).

Przy chwilowym błędzie dostawcy autor dostaje krótką wiadomość, a przy kolejnym bot woła zespół. Odrzucony klucz (albo
lista, w której żaden model nie działa) wstrzymuje asystenta do ponownego uruchomienia bota – dokładna wskazówka jest
w konsoli; `/asystent status` pokazuje dostawcę, modele i to, czy (i do kiedy) asystent ma przerwę.

## 🗺️ Co tworzy /zbuduj

```
〔 📊 STATYSTYKI 〕     🟢┃ꜱᴋʟᴇᴘ ᴏᴛᴡᴀʀᴛʏ · 👥┃ᴄᴢᴌᴏɴᴋᴏᴡɪᴇ: 123 · ⭐┃ᴏᴘɪɴɪᴇ: 45       (widzą wszyscy, nikt nie może wejść)
〔 👋 WITAMY 〕         ✅┃ᴡᴇʀʏꜰɪᴋᴀᴄᴊᴀ · 📜┃ʀᴇɢᴜʟᴀᴍɪɴ · 👋┃ᴘᴏᴡɪᴛᴀɴɪᴀ · 📌┃ɪɴꜰᴏʀᴍᴀᴄᴊᴇ · 📢┃ᴏɢᴌᴏꜱᴢᴇɴɪᴀ
                        🔨┃ʟᴀᴜɴᴄʜᴇʀ · 🎉┃ɢɪᴠᴇᴀᴡᴀʏᴇ · 🎭┃ʀᴏʟᴇ
〔 🛒 SKLEP 〕          🛒┃ꜱᴋʟᴇᴘ · 📦┃ᴊᴀᴋ-ᴋᴜᴘɪᴄ · 💳┃ᴘᴌᴀᴛɴᴏꜱᴄɪ · ✨┃ᴅᴏꜱᴛᴀᴡʏ · ⭐┃ᴏᴘɪɴɪᴇ · 🧾┃ʀᴇᴀʟɪᴢᴀᴄᴊᴇ
〔 🎧 POMOC 〕          🎫┃ᴛɪᴄᴋᴇᴛʏ · ❓┃ꜰᴀǫ
〔 💬 SPOŁECZNOŚĆ 〕    💬┃ᴄᴢᴀᴛ · 🏆┃ʀᴀɴᴋɪɴɢ · 🚀┃ʙᴏᴏꜱᴛᴇʀᴢʏ
〔 🔒 ZESPÓŁ 〕         💼┃ᴄᴢᴀᴛ-ᴢᴇꜱᴘᴏᴌᴜ · 🔧┃ᴋᴏᴍᴇɴᴅʏ-ᴢᴇꜱᴘᴏᴌᴜ · 📣┃ᴀᴋᴛᴜᴀʟɪᴢᴀᴄᴊᴇ-ᴅɪꜱᴄᴏʀᴅᴀ · 🔒┃ᴘᴏᴋᴏᴊ ᴢᴇꜱᴘᴏᴌᴜ
〔 📁 LOGI 〕           📁┃ʟᴏɢɪ-ᴛɪᴄᴋᴇᴛᴏᴡ · 📄┃ᴛʀᴀɴꜱᴋʀʏᴘᴄᴊᴇ · ✅┃ʟᴏɢɪ-ᴡᴇʀʏꜰɪᴋᴀᴄᴊɪ · 📋┃ʟᴏɢɪ-ꜱᴇʀᴡᴇʀᴀ · 🤖┃ʟᴏɢɪ-ᴀᴜᴛᴏᴍᴏᴅ
                        📈┃ꜱᴘʀᴢᴇᴅᴀᴢ · 💾┃ᴋᴏᴘɪᴇ-ᴢᴀᴘᴀꜱᴏᴡᴇ                          (tylko admini)
〔 🎫 TICKETY 〕 / 〔 🔐 ZAMKNIĘTE TICKETY 〕                   (tu trafiają kanały ticketów: 🛒┃ᴢᴀᴍᴏᴡɪᴇɴɪᴇ-0001)
```
Discord pozwala na 50 kanałów w kategorii: gdy 〔 🎫 TICKETY 〕 się zapełni, bot otwiera **〔 🎫 TICKETY 2 〕** (3, …),
a 〔 🔐 ZAMKNIĘTE TICKETY 〕 trzyma 49 najnowszych zamkniętych ticketów (starsze są usuwane – ich transkrypcje zostają na #transkrypcje).
Chcesz inne kanały albo role? Edytuj `src/builder/layout.js` – to jedna czytelna lista.

**Role, od góry do dołu** – rola integracji bota (tworzy ją Discord i nazywa tak jak Twoją aplikację), a pod nią:

| Rola | Kto ją ma |
|---|---|
| 🔨 **HammerShop** | **Tylko bot.** `/zbuduj` umieszcza ją tuż pod rolą integracji bota (najwyżej, jak bot może nadać rolę) i wyświetla ją osobno, więc bot jest pierwszy na liście członków. Każdy inny, kto ją dostanie, od razu ją traci. Nie daje żadnych uprawnień – to odznaka |
| 👑 CEO · 🔱 Co-CEO | Właściciel (właściciel serwera dostaje CEO podczas `/zbuduj`) |
| 🔥 Manager · 🛡️ Administrator · ⚔️ Moderator · 🎧 Support · 🌱 Stażysta · 💼 Sprzedawca | Twój zespół |
| 🧡 Stały Klient · 🛍️ Klient · 🤖 Boty · ✅ Członek · role z powiadomieniami (📢 Ogłoszenia · 🎉 Giveawaye · 📦 Dostawy) | Nadawane automatycznie |

Trzymaj rolę integracji bota na samej górze w Ustawieniach serwera → Role – rola HammerShop zawsze jest tuż pod nią.

**Kto co widzi**

| | Niezweryfikowani | Członek | Sprzedawca | Support | Moderator | Admin+ |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| #weryfikacja | ✅ | | | | | ✅ |
| #regulamin, statystyki serwera | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Sklep, pomoc, społeczność | | ✅ | ✅ | ✅ | ✅ | ✅ |
| Pisanie na #dostawy | | | ✅ | | | ✅ |
| Czat zespołu, logi ticketów, transkrypcje | | | ✅ | ✅ | ✅ | ✅ |
| Logi serwera, weryfikacji i AutoModa | | | | | ✅ | ✅ |
| #aktualizacje-discorda, #sprzedaż, #kopie-zapasowe | | | | | | ✅ |

---

## 📋 Komendy

| Komenda | Co robi | Kto |
|---|---|---|
| `/zbuduj` | Buduje cały serwer (Zbuduj / Wyczyść i zbuduj) | Właściciel, admini |
| `/zbuduj tylko:update` | **Po aktualizacji bota:** dodaje nowe kategorie, kanały i role (nową kategorię stawia tam, gdzie jest w układzie), stosuje styl nazw, podmienia emotki ze zmienionym obrazkiem i odświeża każdy panel – Twoich własnych kanałów i ról nie rusza | Właściciel, admini |
| `/zbuduj tylko:emojis` | Wgrywa emotki, które się jeszcze nie zmieściły (np. po boostach) | Właściciel, admini |
| `/zbuduj tylko:ikona` | Ustawia aktualne logo jako ikonę serwera (i baner przy boostach), potem odświeża wszystkie karty – ich miniaturki w rogu to ikona serwera, więc po nowym logo trzeba to zrobić raz. `tylko:update` celowo nie zmienia ikony | Właściciel, admini |
| `/zbuduj tylko:panels` | Odświeża wszystkie banery i karty **w miejscu** po edycji `config.json` (opinii, giveawayów i ogłoszeń nigdy nie rusza) | Właściciel, admini |
| `/zbuduj tylko:names` | Zmienia nazwy wszystkich kanałów i kategorii na styl z `config.json` (np. po aktualizacji) – nic innego się nie zmienia | Właściciel, admini |
| `/wylacz-platnosc metoda [powod]` · `/wlacz-platnosc metoda` | Wyłącza na chwilę metodę płatności (np. na czas naprawy PayPala) i włącza ją z powrotem – znika z formularzy zamówienia, koszyka i doładowania, a #płatności, FAQ i panel sklepu pokazują „chwilowo niedostępna”. Złożone już zamówienia działają dalej | Admini, sprzedawcy |
| `/produkt dodaj / edytuj / stan / warianty / dostawa / usun / lista` | Zarządzanie sklepem (kategorie, obrazki, warianty, licznik sztuk, pliki, które dostaje kupujący) – panel na #sklep odświeża się sam | Admini, sprzedawcy |
| `/promocja start / stop / lista` | Promocje błyskawiczne – procentowy rabat na produkt przez jakiś czas, z odliczaniem w sklepie | Admini, sprzedawcy |
| `/kod utworz / lista / info / usun` | Kody rabatowe | Admini, sprzedawcy |
| `/sklep otworz / zamknij / auto / status` | Ręczne otwarcie lub zamknięcie sklepu albo powrót do godzin pracy | Admini, sprzedawcy |
| `/sprzedaz` | Statystyki sprzedaży | Admini, sprzedawcy |
| `/hammerplus nadaj / sprawdz / lista / klucz` | Kody Hammer+ do Hammer Launchera, przypisane do konta Minecraft (`nadaj nick: dni:`, `dni:0` = na zawsze, opcjonalnie `osoba:` – dostanie rangę 💎 Hammer+) i klucz publiczny dla launchera | Admini, sprzedawcy |
| `/polecane dodaj / usun / lista` | Polecane serwery w Hammer Launcherze | Admini, sprzedawcy |
| `/asystent wlacz / wylacz` · `/asystent status` · `/asystent ticket stan:` | Asystent AI w ticketach (serwer Hammer Launcher): włączenie i wyłączenie na całym serwerze (admini), status – dostawca, model, przerwa (zespół), włączenie i wyłączenie w jednym tickecie (zespół) | Admini, zespół |
| `/wiedza dodaj` · `/wiedza lista` · `/wiedza edytuj numer:` · `/wiedza usun numer:` · `/wiedza test pytanie:` | Baza wiedzy asystenta AI (serwer Hammer Launcher): pytania i odpowiedzi zespołu, z których asystent korzysta w ticketach – dodawanie, lista, poprawki, usuwanie i sprawdzenie, które wpisy pasują do pytania | Zespół |
| `/launcher` | Karta Hammer Launchera: co to jest, aktualna wersja z opisem zmian i przyciski *Pobierz launcher* / *Hammer+* | Wszyscy |
| `/klient profil / notatka dodaj / notatka usun` | Profile klientów i prywatne notatki zespołu | Zespół |
| `/zablokuj` · `/odblokuj` | Blokada serwera podczas raidu i jej zdjęcie | Moderatorzy+ |
| `/kopia` | Kopia zapasowa danych bota od razu (robi się też automatycznie) | Admini |
| `/zaproszenia statystyki / ranking` | Twoje zaproszenia, następna nagroda i ranking zapraszających | Wszyscy |
| `/opinia` | Wystawienie opinii (z opcjonalnym zrzutem ekranu) | Wszyscy |
| `/giveaway start / zakoncz / losuj-ponownie / lista` | Giveawaye (start: opcjonalnie `wymagana-rola`, `tylko-klienci`, `min-zaproszen`, `hammerplus-dni` – nagroda Hammer+, którą asystent AI wyda sam) | Moderatorzy+ |
| `/ogloszenie` | Ostylowane ogłoszenie z banerem, przyciskiem i pingiem | Moderatorzy+ |
| `/ticket info / zamknij` | Twój ticket | Autor ticketu |
| `/ticket przejmij / oddaj / dodaj / usun / priorytet / przenies / nazwa / prosba-zamkniecia / zrealizuj` | Obsługa ticketów (`zrealizuj kwota:` = ile zapłacił klient) | Zespół |
| `/odpowiedz` | Gotowe odpowiedzi | Zespół |
| `/czarna-lista dodaj / usun / lista` | Blokowanie osobom dostępu do ticketów | Zespół |
| `/statystyki` | Statystyki ticketów i ranking zespołu | Zespół |
| `/panel` | Ponowne wysłanie panelu (tickety, sklep, opinie, ranking, weryfikacja, role) | Admini |
| `/ustawienia pokaz / zmien / dodaj-role / usun-role` | Ustawienia ticketów (wszystko ustawia automatycznie `/zbuduj`) | Admini |
| `/pomoc` | Komendy, których *Ty* możesz użyć | Wszyscy |

Komendy dla adminów są automatycznie ukryte przed zwykłymi członkami. W `/zbuduj tylko:` Discord pokazuje polskie nazwy
wyborów: `update` = 🆕 Aktualizacja, `emojis` = 😀 Emotki, `panels` = 🔄 Panele, `names` = 🎨 Nazwy.

---

## 🛍️ Jak działa zamówienie

1. Klient klika **Kup** przy produkcie na #sklep – to jedyny sposób zakupu. Pozycja **Zakup** w panelu ticketów oraz karty
   *Jak kupić* i *Płatności* kierują na #sklep (`"shopOnly": true` w typie ticketu `order`).
2. Wybiera wariant, ilość, metodę płatności i (opcjonalnie) kod rabatowy → otwiera się **prywatny ticket** z kwotą do zapłaty
   (z ceną promocyjną, jeśli trwa promocja błyskawiczna). Sprzedawcy i support dostają ping. Poza godzinami pracy ticket informuje,
   kiedy wracacie. Nikt go nie przejmie w ciągu 15 minut? Zespół dostaje przypomnienie na #czat-zespołu.
3. Sprzedawca przejmuje ticket i wysyła dane do płatności (wskazówka: `/odpowiedz` → *💰 Wycena zamówienia*, *💳 Płatność otrzymana*,
   *📦 Dostarczone*). Klient płaci i klika **Zapłać** (PIN / zrzut ekranu / ID transakcji) – sprzedawca dostaje ping, sprawdza
   płatność i ustawia **⚙️ → Status: Opłacone**, później **Status: W realizacji**; klient dostaje DM przy każdym kroku.
4. Po dostawie sprzedawca wybiera **⚙️ Zarządzaj ticketem → Zamówienie zrealizowane** i potwierdza zapłaconą kwotę:
   sprzedaż trafia do `/sprzedaz`, licznik sztuk spada, klient dostaje **potwierdzenie zakupu na DM** (✅ Dostarczone),
   rolę **Klient** (i **Stały Klient** po 5 zamówieniach) oraz przycisk **Wystaw opinię**, a na #realizacje pojawia się anonimowy
   wpis o realizacji. Zamówienie i jego potwierdzenie zostają w **Moich zamówieniach** klienta.
5. Ticket zostaje zamknięty – klient dostaje na DM transkrypcję i prośbę o ocenę, a transkrypcja jest zapisywana na #transkrypcje.
6. 24 godziny później klient dostaje przyjazne przypomnienie o opinii (o ile jeszcze jej nie ma).

---

## 🎨 Dostosowanie – `config.json`

| Sekcja | Co możesz zmienić |
|---|---|
| `brand` | Nazwa, kolor, stopka, slogan i tekst „O nas” |
| `server` | Zmiana nazwy serwera, ikona/baner, **które logo** (`logo`: `hammer`, `hammer-wordmark`, `monogram`, `neon` albo `bag`), tryb społeczności, poziom weryfikacji, język serwera (`locale`: język Discorda – domyślnie `pl`, inne to np. `en-US`, `de`, `sv-SE`), **styl nazw** (zob. niżej) |
| `rules` | Plik regulaminu (`file`, domyślnie `regulamin.md`), dane sprzedawcy (`seller`) i e-mail (`email`) pokazywane w §1 |
| `emojis` | Wgrywanie własnych emotek, prefiks nazw emotek (`hs_`) |
| `verification` | Pytanie matematyczne wł./wył., minimalny wiek konta w dniach |
| `shop` | Waluta, czas dostawy, godziny pomocy (tworzone z `workingHours`, chyba że ustawisz `supportHours`), zasady zwrotów, liczba zamówień do roli Stały Klient, **metody płatności**, `lowStockAt` (licznik sztuk na tym poziomie lub niżej pokazuje „🟠 Zostało tylko N”, domyślnie 3) |
| `vouches` | Przyklejony panel, czas odnowienia, „tylko klienci”, minimalna długość opinii |
| `orders` | Potwierdzenia zakupu na DM, wpisy na #realizacje, przypomnienie o opinii po N godzinach (`0` = wyłączone), DM-y o statusie zamówienia (`statusDms`), przycisk **Zapłać** (`paymentProofs`) |
| `stripe` | Automatyczne linki do płatności Stripe wł./wył. (`enabled`) i ich waluta (`currency`, puste = z `shop.currency`) – wymaga `STRIPE_SECRET_KEY` w `.env` |
| `paypal` | Automatyczne linki do płatności PayPal wł./wył. (`enabled`) i ich waluta (`currency`, puste = z `shop.currency`) – wymaga `PAYPAL_CLIENT_ID` i `PAYPAL_CLIENT_SECRET` w `.env` |
| `crypto` | Waluta, w której liczone są kwoty w monetach (`currency`, puste = z `shop.currency`) – ustaw ją, gdy znak Twojej waluty nie jest jednoznaczny |
| `badges` | 🔥 Bestseller i ⭐ ocena w sklepie wł./wył. (`enabled`), liczba sprzedanych sztuk do Bestsellera (`bestsellerMinSales`, 3), liczba opinii potrzebna do oceny (`ratingMinVouches`, 2) |
| `staffReminders` | Przypomnienia o nieprzejętych ticketach wł./wył., po ilu minutach (`unclaimedMinutes`, 15) i jak często ponownie (`repeatMinutes`, 60 – `0` = raz) |
| `promos`, `welcomeDiscount` | Kody rabatowe wł./wył.; kod na pierwszy zakup (procent, ważność w dniach) |
| `workingHours`, `shopStatus` | Godziny pracy (domyślnie **10:00–20:00 codziennie, Europe/Warsaw**); kanał statusu otwarte/zamknięte wł./wył. (`enabled`) i jego nazwy |
| `invites` | Śledzenie zaproszeń wł./wył. i nagrody (`{ "invites": 5, "percent": 10 }` …) |
| `security` | Alerty o podszywaniu się, czy `/zablokuj` wstrzymuje zaproszenia |
| `backups`, `salesReport` | Jak często robić kopię zapasową; dzień tygodnia i godzina raportu tygodniowego sprzedaży |
| `panel`, `ticketTypes`, `snippets`, `defaults` | Teksty panelu ticketów, kategorie ticketów i ich pytania, gotowe odpowiedzi, limity i automatyczne zamykanie |

Po edycji:
```bash
npm run check          # sprawdza config.json pod kątem limitów Discorda
```
potem **uruchom bota ponownie** i wpisz **`/zbuduj tylko:panels`** – każdy baner i każda karta zostaną odświeżone w miejscu
(nic się nie przesuwa, a Twoich opinii, giveawayów i ogłoszeń bot nigdy nie rusza).

**Metody płatności** – każda pozycja ma `name`, `details`, `emoji`
(`paysafecard`, `crypto`, `paypal`, `card`, `wallet`, `blik`, `coin`, `currency_eur`…) i `type` – `paysafecard`,
`crypto`, `paypal` albo `stripe` – od którego zależy karta płatności w tickecie. Domyślnie są to PaysafeCard, Kryptowaluty (BTC, ETH),
PayPal, Stripe i **BLIK / przelew (Simpay)** – pozycja bez `type`: sprzedawca wysyła link do płatności Simpay w tickecie.
**Wpisz swoje portfele** w pozycji Kryptowaluty: `"addresses": { "BTC": "bc1…", "ETH": "0x…" }` (LTC, SOL, USDT, USDC, XMR,
DOGE, TRX i BNB też działają – dla nich także pokazuje się kwota w monetach). Pozycja PayPal przyjmuje `"paypalMe": "twojanazwa"`
dla linku paypal.me, gdy nie ma kluczy PayPal. Pozycja `stripe` dostaje automatyczne linki do płatności kartą (tylko ze
`STRIPE_SECRET_KEY` w `.env`); `stripe.currency` ustawia walutę Stripe (`eur`, `usd`, `pln`… – puste = z `shop.currency`:
€ → eur, $ → usd, £ → gbp, zł → pln; dla `kr` i innych niejednoznacznych znaków trzeba ją ustawić, inaczej linki nie powstaną),
`stripe.enabled: false` wyłącza linki.

**Styl nazw** – `server.channelStyle` (domyślnie `{emoji}┃{name}`), `server.categoryStyle` (domyślnie `〔 {name} 〕`)
i `server.smallCaps` (`true` → `📦┃ᴊᴀᴋ-ᴋᴜᴘɪᴄ`, `false` → `📦┃jak-kupić`; w kapitalikach polskie litery tracą ogonki, poza ł → ᴌ).
Kanały ticketów mają nazwy według `channelNameFormat` (domyślnie `{prio}{emoji}┃{prefix}-{number}` → `🛒┃ᴢᴀᴍᴏᴡɪᴇɴɪᴇ-0001`).
Same nazwy są w `src/builder/layout.js`. Po zmianie stylu uruchom bota ponownie i wpisz **`/zbuduj tylko:names`**.

### Aktualizacja bota
Podmień pliki bota (zostaw **`.env`** i folder **`data/`**), wpisz `npm install`, uruchom bota ponownie i raz wpisz
**`/zbuduj tylko:update`** – komenda dodaje kanały i role, które są nowe w tej wersji (np. 🧾┃ʀᴇᴀʟɪᴢᴀᴄᴊᴇ, 📈┃ꜱᴘʀᴢᴇᴅᴀᴢ,
💾┃ᴋᴏᴘɪᴇ-ᴢᴀᴘᴀꜱᴏᴡᴇ i kanał statusu sklepu), **usuwa te, które bot utworzył wcześniej, a które nie są już częścią serwera**
(np. strefę VIP, kanały głosowe, #memes – nigdy kanałów ani ról utworzonych przez Ciebie), stosuje styl nazw i odświeża
każdy panel. Uruchom ją na kanale, który zostaje (np. #komendy-zespołu).
Jeśli Twój `config.json` ma Twoje zmiany, możesz go zachować: sekcje, których jeszcze w nim nie ma, dostaną wartości domyślne,
a konsola wypisze każdą funkcję, która jest w nim wyłączona.

**Serwer zbudowany przez angielską wersję HammerShop?** `/zbuduj tylko:update` zmienia też nazwy kanałów i kategorii bota na
polskie, a domyślne role na polskie odpowiedniki (Seller → **Sprzedawca**, Loyal Customer → **Stały Klient**, Member → **Członek**, …) –
role o nazwach nadanych przez Ciebie zostają bez zmian. Teksty paneli, typy ticketów i gotowe odpowiedzi pochodzą z `config.json`:
jeśli zachowasz stary, angielski plik, zostaną po angielsku – weź nowy `config.json` i przenieś do niego swoje ustawienia.

**Przechodzisz z NØX (wersji fioletowej)?** Zostaw `.env` i `data/`, a potem raz wpisz `/zbuduj tylko:update` (świeże
`/zbuduj` też zadziała). Komenda:
- dodaje rolę **🔨 HammerShop** na górze i daje ją botowi,
- zmienia nazwy starych domyślnych ról (Founder → **CEO**, Co-Founder → **Co-CEO**, …) i przemalowuje fioletowe role na
  pomarańczowo – role, którym nazwę albo kolor zmieniono ręcznie, zostają bez zmian,
- zastępuje fioletowe emotki `:nox_*:` jasnopomarańczowymi `:hs_*:` (najpierw zwalnia ich miejsca; emotek wgranych przez
  Ciebie nigdy nie rusza) i wgrywa na nowo, w miejscu, każdy fioletowy baner,
- publikuje nowy regulamin na #regulamin.

Nazwa i ikona serwera zmieniają się tylko przy świeżym `/zbuduj` – możesz też ustawić je ręcznie (Ustawienia serwera → Przegląd,
`assets/brand/logo-hammer.png`).

**Waluta** – `shop.currency` (domyślnie `€`) i `shop.currencyPosition` (`after` → `20€`, `before` → `€20`).
Dostają ją tylko ceny wpisane jako sama liczba; `od 5€` albo `$10` są pokazywane dokładnie tak, jak je wpiszesz.

### Regulamin (zasady sklepu)
`regulamin.md` (obok `config.json`) jest publikowany na #regulamin – baner i tyle kart, ile potrzeba na Discordzie. To zwykły
markdown Discorda: część przed pierwszym `## ` to tytuł, każde `## ` zaczyna nową sekcję. Bot uzupełnia:

| Znacznik | Zamienia się w |
|---|---|
| `{brand}` | `brand.name` (HammerShop) |
| `{#tickets}` `{#shop}` `{#payments}` `{#announcements}` … | link do tego kanału (klucze z `src/builder/layout.js`) |
| `{e:cart}` `{e:check}` … | pomarańczową emotkę bota (nazwy z `assets/emojis`) |
| `{paymentMethods}` | Twoje metody płatności z `shop.paymentMethods` |
| `{seller}` `{email}` | `rules.seller` / `rules.email` – linia z pustą wartością nie jest publikowana |

Edytuj plik, uruchom bota ponownie i wpisz `/zbuduj tylko:panels` – #regulamin zostanie odświeżony w miejscu. Uzupełnij
`rules.seller` (imię i nazwisko albo firma, adres) i `rules.email`: sklep sprzedający konsumentom musi je podawać. Tekst to
solidny szablon, a nie porada prawna.

### Logo
W `assets/brand/` jest pięć logo (1024 × 1024) – wybierz jedno przez `"logo"` w sekcji `server` w `config.json`:

| `hammer` (domyślne) | `hammer-wordmark` | `monogram` | `neon` | `bag` |
|---|---|---|---|---|
| Młotek krzeszący iskry w świecącym pomarańczowym pierścieniu | Młotek + nazwa HAMMERSHOP pod spodem (świetny awatar bota) | „HS” w pierścieniu z małym młotkiem | Jasnopomarańczowy kafelek z nazwą, wyróżnia się na liście serwerów | Pomarańczowa torba na zakupy z młotkiem |

Serwer już zbudowany? Po prostu wgraj logo ręcznie w Ustawieniach serwera → Przegląd albo uruchom `/zbuduj` na świeżym serwerze.

### Własne grafiki
Wszystkie banery, emotki i logo generuje `tools/render-assets.js`. Zmień kolory w `THEME`,
dodaj banery albo emotki do list i uruchom:
```bash
npm i -D playwright && npm run render-assets
```

---

## 🛠️ Rozwiązywanie problemów

| Problem | Rozwiązanie |
|---|---|
| Discord odrzuca połączenie: `privileged intents` nie są włączone | Developer Portal → Bot → włącz **Server Members Intent** i **Message Content Intent** → uruchom bota ponownie |
| Nieprawidłowy `DISCORD_TOKEN` | Zresetuj token w zakładce Bot i wklej go ponownie do `.env` |
| Brak linku PayPal w zamówieniach przez PayPal | Brakuje `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` albo są błędne (konsola pisze, że PayPal je odrzucił; klucze Sandbox wymagają `PAYPAL_SANDBOX=true`), albo PayPal nie przyjmuje tej waluty – ustaw `paypal.currency`. Karta pokazuje wtedy link paypal.me |
| Brak linku Stripe w zamówieniach przez Stripe | Brakuje `STRIPE_SECRET_KEY` w `.env` albo jest błędny (konsola pisze, że Stripe odrzucił `STRIPE_SECRET_KEY`), zamówienie nie ma stałej ceny (np. `od 5€`) – wtedy link wysyła ręcznie sprzedawca – albo kwota jest **niższa niż najmniejsza płatność w Stripe** (0.50€ / $0.50 / £0.30 / 2 zł): klient jest proszony o zapłatę w inny sposób. Po edycji `.env` uruchom bota ponownie |
| Komendy się nie pokazują | Ustaw `GUILD_ID` w `.env` i uruchom bota ponownie. Sprawdź też, czy zaproszenie miało `applications.commands` (link z konsoli je ma) |
| „Potrzebuję uprawnienia Administrator” | Ustawienia serwera → Role → rola bota → włącz **Administrator** |
| Wyczyść i zbuduj nie usunęło niektórych ról | Są nad rolą bota – przeciągnij rolę bota na górę i uruchom to ponownie |
| Wgrało się tylko 50 emotek | Serwery bez boostów mają 50 miejsc na emotki. Zboostuj serwer i wpisz `/zbuduj tylko:emojis` |
| „Discord ogranicza, jak szybko można wgrywać emotki” | Odczekaj godzinę, potem wpisz `/zbuduj tylko:emojis` |
| Tryb społeczności nie został włączony | Discord odmówił dla tego serwera. Wszystko inne działa (kanały ogłoszeń są zwykłymi kanałami tylko do odczytu). Możesz go włączyć później w Ustawieniach serwera → Włącz społeczność |
| Własna emotka została usunięta | Nic się nie psuje – bot używa wtedy zwykłego emoji. Wpisz `/zbuduj tylko:emojis`, żeby wgrać ją ponownie |
| „Discord pozwala zmienić nazwę kanału tylko dwa razy na 10 minut” | To limit Discorda – odczekaj podaną liczbę minut i spróbuj ponownie |
| `⏳` kliknięcie wygasło, zanim bot zdążył odpowiedzieć, albo `Unknown interaction (10062)` | Discord daje botowi 3 sekundy na odpowiedź. Zdarza się to, gdy ktoś kliknie, kiedy bot się uruchamia albo hosting jest bardzo wolny – wystarczy kliknąć jeszcze raz. Jeśli zdarza się ciągle: użyj Node.js 20 lub nowszego i szybszego planu / hostingu w regionie UE lub USA |
| Interakcja została już obsłużona przez inny proces bota | Bot działa dwa razy na tym samym tokenie (np. na Twoim komputerze i na hostingu) – wyłącz jedną kopię |
| `ExperimentalWarning: buffer.File is an experimental feature` | Nieszkodliwe – wypisuje to Node.js 18. Wybierz na hostingu Node.js 20 albo 22, żeby się tego pozbyć (i mieć szybszego bota) |
| Przyciski pokazują „Ta interakcja nie powiodła się” | Bot musi być **online** – przyciski obsługuje bot na żywo |
| Transkrypcje są puste | Włącz **Message Content Intent** |
| Brakuje nowych kanałów (#realizacje, #sprzedaż, #kopie-zapasowe, status sklepu) | Wpisz `/zbuduj tylko:update` (kanał statusu sklepu istnieje tylko wtedy, gdy `shopStatus.enabled` ma wartość `true`) |
| „Obrazek jest za duży” | Obrazki produktów mogą mieć do 1 MB – zapisz go jako JPG albo WEBP |
| Testowy e-mail w panelu: „nie przyjął hasła” | W `MAIL_PASS` musi być 16-literowe **hasło do aplikacji** z `myaccount.google.com/apppasswords` (wymaga włączonej weryfikacji dwuetapowej) – nie zwykłe hasło do Gmaila. Po zmianie `.env` uruchom bota ponownie |
| Testowy e-mail w panelu: „Nie udało się połączyć z serwerem poczty” | Hosting blokuje wysyłanie poczty (porty 465 i 587). Napisz do jego pomocy z prośbą o odblokowanie SMTP dla `smtp.gmail.com`. Do tego czasu wiadomości z formularza są w panelu (Wiadomości) i na czacie zespołu na Discordzie |
| Zaproszenia nie są liczone | Bot musi widzieć zaproszenia serwera – ma uprawnienie Administrator, więc sprawdź, czy nikt nie zmienił jego roli. Zaproszenia liczą się dopiero po weryfikacji nowego członka |

💾 **Kopia zapasowa:** wszystko (tickety, produkty, sprzedaż, kody rabatowe, opinie, giveawaye) jest w `data/db.json`, obrazki
produktów w `data/products/`. Bot publikuje też automatyczne kopie na #kopie-zapasowe – żeby przywrócić kopię, rozpakuj ją,
zmień nazwę pliku na `db.json` i wrzuć go do `data/`, gdy bot jest wyłączony.

---

## 🧹 Jak wyzerować dane

**Nie kasuj całego folderu `data/`, żeby wyzerować statystyki.** W nim jest wszystko, z czego bot i strona działają:

- `data/db.json` (bot): tickety, zapis zbudowanego serwera (ID kanałów i ról z `/zbuduj`), giveawaye, wpisy `/wiedza`, ustawienia, produkty i zamówienia z Discorda, wystawione kody Hammer+,
- `data/web.json` (strona): konta i sesje, zamówienia ze strony i kody Hammer+ kupujących, polecenia i nagrody z „Zaproś znajomego”, aktualności, wersje launchera, cennik Hammer+, wiadomości z formularza – i **statystyki** (pobrania, uruchomienia launchera),
- `data/releases/` – wgrane instalatory launchera, `data/products/` i `data/deliveries/` – obrazki i pliki produktów,
- kopie zapasowe: bot sam wrzuca kopię `data/db.json` na kanał 💾 kopie-zapasowe (gdy są włączone; `/kopia` – od razu). `web.json` i instalatory takiej kopii nie mają.

Po skasowaniu całego folderu bot zapomina zbudowany serwer (panele i kanały przestają działać, trzeba od nowa `/zbuduj`), kupujący tracą „Twoje kody” na stronie, a launcher przestaje sam pobierać przedłużony Hammer+, znikają nagrody z poleceń, aktualności, cennik i wgrane instalatory (strona nie ma czego pobrać), a wszyscy muszą zalogować się od nowa.

**Same statystyki (bezpiecznie):** panel admina → **Pulpit** → **Wyzeruj statystyki** (widzi go tylko właściciel), wpisz `ZERUJ` i potwierdź. Pobrania (dziennie, przy wersjach i przy kontach) i uruchomienia launchera spadają do 0 – w panelu i na kanale „📥 Pobrania” na Discordzie. Zamówienia, kody Hammer+, konta, nagrody z poleceń, aktualności, wersje i ustawienia zostają. Zerowanie trafia do logów serwera i konsoli bota.

**Przed premierą – wszystko, co zostało po testach (serwer Hammer Launcher):** panel admina → **Pulpit** → **Start od zera** (widzi go tylko właściciel). Okienko pokazuje dokładnie, co zniknie, a co zostanie – wpisz `PREMIERA` i potwierdź. Nic nie trzeba uruchamiać na serwerze.

- **Znika:** statystyki (pobrania, uruchomienia launchera), zamówienia ze strony, konta i sesje na stronie (wszyscy – także Ty – logują się od nowa), „Zaproś znajomego” (linki, kto kogo polecił, nagrody, dni do odebrania), wiadomości z formularza, kopie w chmurze Hammer+, wybrane peleryny i dodatki, zamknięte tickety razem z ich kanałami (transkrypcje zostają; następny ticket dostaje numer o jeden wyższy niż najwyższy otwarty, a gdy żaden nie jest otwarty – #0001), śledzenie zaproszeń, licznik wiadomości w #ranking, zakończone giveawaye i lista wystawionych kodów Hammer+ (same kody dalej działają w launcherze do końca ważności, ale ranga 💎 Hammer+ znika).
- **Zostaje:** zbudowany serwer (kanały, role, emotki, panele), wersje launchera i ich pliki, aktualności, komunikat w launcherze, cennik Hammer+, polecane serwery, partnerstwa, #plany, historia ogłoszeń, `/wiedza`, ustawienia, czarna lista, notatki zespołu, otwarte tickety, trwające giveawaye i plik `.env`.
- **Kopia na wszelki wypadek:** zanim cokolwiek zniknie, bot kopiuje `data/db.json` i `data/web.json` do folderu `data/kopia-przed-startem-RRRR-MM-DD-GGMM` (jego nazwę pokazuje panel; strona nigdy nie daje go do pobrania). **Jak cofnąć:** zatrzymaj bota, skopiuj oba pliki z tego folderu z powrotem do `data/` (zastąp te, które tam są) i uruchom bota. Gdy wszystko jest w porządku, folder możesz usunąć.
- Kanał „📥 Pobrania” od razu pokazuje 0, a reset trafia do logów serwera i konsoli bota.

**Całkiem od zera (tylko jeśli naprawdę tego chcesz):** zatrzymaj bota, skopiuj `data/` gdzieś na bok (na wszelki wypadek), usuń `data/`, uruchom bota i wpisz `/zbuduj`. Stracisz wszystko z listy wyżej – kody Hammer+ już wydane działają dalej do końca ważności (są podpisane kluczem z `.env`), ale nie będzie ich na stronie, a ich przedłużenia trzeba wystawić ręcznie (`/hammerplus nadaj`). Pliku `.env` nie usuwaj.

## 🗂️ Pliki

```
index.js                     plik startowy (wybierz go na hostingu)
.env                         Twój token i ID (skopiuj z .env.example)
config.json                  teksty, metody płatności, kategorie ticketów, opcje
regulamin.md                 regulamin sklepu publikowany na #regulamin – edytuj i wpisz /zbuduj tylko:panels
assets/                      banery, emotki, logo (zob. assets/CREDITS.md)
data/db.json                 dane bota (tworzone automatycznie)
src/
├── index.js                 klient Discorda, zdarzenia, timery
├── builder/                 /zbuduj – układ, uprawnienia, treści, wykonanie, wgrywanie emotek
├── features/                weryfikacja, sklep, katalog, zamówienia, kody rabatowe, status sklepu, opinie, giveawaye, role,
│                            ogłoszenia, powitania/logi, statystyki, raport sprzedaży, kopie zapasowe, profile klientów,
│                            Powiadom mnie, zaproszenia, blokada serwera, alerty o podszywaniu się, porządki, promocje
│                            błyskawiczne, odznaki, Zapłać, status zamówienia, Moje zamówienia, przypomnienia dla zespołu,
│                            karty płatności, Stripe, PayPal, własna rola bota HammerShop (brandrole.js), kody Hammer+
│                            (hammerplus.js), polecane serwery launchera (featured.js), nagrody Zaproś znajomego (referrals.js),
│                            partnerstwa (partners.js)
├── tickets/                 system ticketów, karty, transkrypcje HTML
├── commands/                komendy (polskie nazwy dla Discorda: lib/commandsPl.js)
├── handlers/interactions.js przyciski, menu i formularze
├── lib/                     konfiguracja, baza danych, motyw, uprawnienia, funkcje pomocnicze, kody Hammer+ (plus.js),
│                            wysyłanie e-maili (mail.js), e-maile z potwierdzeniem zakupu i odpowiedzią z panelu
│                            (receiptMail.js), logo partnerów (partnerLogo.js)
└── web/                     strona sklepu i API dla Hammer Launchera (launcher.js: /api/launcher/*, /join), panel admina
                             (admin.js: /api/admin/*), instalatory i aktualizacje launchera (releases.js: /download, /updates/),
                             Zaproś znajomego (referrals.js: /r/<kod>, /api/shop/referrals), formularz kontaktowy
                             (contact.js: /api/shop/contact)
web/pages/                   podstrony launchera: layout.html (nagłówek, menu, stopka) + jeden plik na podstronę – składa je src/web/pages.js
web/public/                  index.html (sklep), admin.html (/admin) i pliki stron w assets/ (launcher.css, launcher.js, obrazki, nagrania)
data/web.json                konta i zamówienia ze strony, aktualności, komunikat, wersje launchera, cennik Hammer+, polecenia,
                             wiadomości z formularza kontaktowego
data/releases/               instalatory launchera wgrane w panelu admina
data/partners/               logo partnerów wgrane w panelu admina (zakładka Partnerstwa)
data/kopia-przed-startem-…/  kopia db.json i web.json zrobiona przed „Start od zera” w panelu admina (do przywrócenia)
DEPLOY.md                    uruchomienie na własnym serwerze 24/7 (deploy/: usługa systemd, Caddy)
config.launcher.json         ustawienia serwera Hammer Launcher (BOT_PROFILE=launcher) – nakładane na config.json
regulamin-launcher.md        regulamin serwera Hammer Launcher
tools/render-assets.js       generuje od nowa wszystkie obrazki (bot + obrazki strony; `launcher` – grafiki serwera launchera)
scripts/plus-key.js          npm run plus-key – nowy klucz do podpisywania kodów Hammer+
scripts/website-theme.js     wygląd HammerShop na stronie (kolory, logo, nazwa, obrazki)
test/                        testy z symulowanym serwerem Discord (npm test)
```

## 🧪 Testy
```bash
npm test
```
644 testy działają na symulowanym serwerze Discord, który pilnuje prawdziwych limitów Discorda (nazwy, 40 komponentów / 4000
znaków na kartę, miejsca na emotki, uprawnienia, reguły AutoMod, tryb społeczności): pełna budowa, wyczyść i zbuduj,
każde uprawnienie, ścieżka sklep → ticket → zamówienie → opinia, warianty, licznik sztuk, promocje błyskawiczne, odznaki, Zapłać,
DM-y o statusie zamówienia, Moje zamówienia, przypomnienia dla zespołu, karty płatności, linki do płatności Stripe i PayPal,
wymagania giveawayów, limity kodów rabatowych (także dla zamówień złożonych w tej samej chwili), godziny pracy przy zmianie
czasu letniego/zimowego, blokada serwera, nagrody za zaproszenia, odświeżanie paneli w miejscu, weryfikacja, giveawaye, oceny,
rola HammerShop tylko dla bota, regulamin, kody Hammer+ i API Hammer Launchera (bez internetu – Mojang i klucze są symulowane),
aktualizacja NØX → HammerShop (emotki, banery, role) i więcej.

---

Autorzy i licencje: ikony [Font Awesome](https://fontawesome.com) (CC BY 4.0), czcionka [Montserrat](https://fonts.google.com/specimen/Montserrat) (OFL).
System ticketów i kreator serwera powstały na bazie projektów *Ticket Bot* i *Kreator Serwera* – przetłumaczonych na angielski, przebudowanych dla NØX, przemianowanych na HammerShop, a teraz z powrotem po polsku.
