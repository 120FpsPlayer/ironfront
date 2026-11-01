'use strict';

/**
 * Polish texts for the store website (web/public/index.html). applyTheme (scripts/website-theme.js) calls translate() last,
 * so `node scripts/build-website.js …` and `node scripts/website-theme.js` both give the Polish page.
 *
 * Every pair is an exact piece of the themed page (the NØX name is already HammerShop there): [english, polish]. The
 * pieces are JS string literals of the minified bundle – escapes like \xB7, \u2026 and \u2019 are kept as they are
 * written there, and Polish letters are written as they are (the page is UTF-8). Internal values stay English: the
 * product categories ("Games", "All products" – the bot's website.js sends them) are only translated where they are
 * shown (nxCat), and status values like "paid" are untouched.
 *
 * Safe to run twice: no Polish text contains an English piece, and a page that is Polish already (<html lang="pl">)
 * is left as it is. On an English page every piece must be found – a missing one is reported (the design changed).
 */

const R = String.raw;

// ───────────── <head>, <noscript> ─────────────
const HEAD = [
  ['<html lang="en">', '<html lang="pl">'],
  [
    'content="HammerShop – games, Discord bots and Discord servers. Sign in with Discord, pay securely by card and get your order on Discord."',
    'content="HammerShop – gry, boty i serwery Discord. Zaloguj się przez Discord, zapłać bezpiecznie kartą i odbierz zamówienie na Discordzie."',
  ],
  ['<meta property="og:title" content="HammerShop – your next level starts here">', '<meta property="og:locale" content="pl_PL"><meta property="og:title" content="HammerShop – wejdź na nowy poziom">'],
  [
    'content="Games, Discord bots and Discord servers. Sign in with Discord, pay securely by card, get it on Discord."',
    'content="Gry, boty i serwery Discord. Zaloguj się przez Discord, zapłać kartą i odbierz zamówienie na Discordzie."',
  ],
  ['<title>HammerShop — Your next level starts here.</title>', '<title>HammerShop — Wejdź na nowy poziom</title>'],
  ['>Enable JavaScript to view the interactive HammerShop store.</noscript>', '>Włącz JavaScript, aby zobaczyć sklep HammerShop.</noscript>'],
];

// ───────────── The page (the React bundle) ─────────────
const PAGE = [
  // Helpers for the pieces below: Polish plurals and the shown name of a category (the values stay English).
  [
    R`var s7=[["How do I buy?",`,
    R`var nxPl=(n,a,b,c)=>n===1?a:n%10>1&&n%10<5&&(n%100<10||n%100>20)?b:c,nxCat=c=>{const m={"All products":"Wszystkie produkty",Games:"Gry","Discord Bots":"Boty Discord","Discord Servers":"Serwery Discord",Other:"Inne"};return typeof m[c]=="string"?m[c]:c};var s7=[["Jak kupić?",`,
  ],

  // Sample products of the offline preview
  [R`name:"The Game Collection"`, R`name:"Kolekcja gier"`],
  [R`"Discover the HammerShop game collection. Final titles, platforms and activation details will be confirmed before launch."`, R`"Poznaj kolekcję gier HammerShop. Ostateczne tytuły, platformy i sposób aktywacji potwierdzimy przed startem."`],
  [R`name:"Your Discord. Upgraded."`, R`name:"Twój Discord. Na wyższym poziomie."`],
  [R`"A dedicated bot for your community. Features, hosting and delivery scope will be confirmed before launch."`, R`"Bot stworzony dla Twojej społeczności. Funkcje, hosting i zakres dostawy potwierdzimy przed startem."`],
  [R`name:"The Game Bundle"`, R`name:"Pakiet gier"`],
  [R`"A collection for your next adventure. The included games and product terms will be confirmed before launch."`, R`"Zestaw na Twoją kolejną przygodę. Gry w pakiecie i warunki produktu potwierdzimy przed startem."`],
  [R`name:"A Server of Your Own."`, R`name:"Twój własny serwer."`],
  [R`"A Discord home with its own identity. Channels, roles, branding and handover details will be confirmed before launch."`, R`"Dom na Discordzie z własnym charakterem. Kanały, role, branding i szczegóły przekazania potwierdzimy przed startem."`],

  // Product pictures
  [R`alt:"HammerShop gaming collection preview"`, R`alt:"Podgląd kolekcji gier HammerShop"`],
  [R`"aria-label":"Illustrative HammerShop game bundle"`, R`"aria-label":"Poglądowy pakiet gier HammerShop"`],
  [R`(Lt,{}),"PLAY",`, R`(Lt,{}),"GRAJ",`],
  [R`(me,{}),"EXPLORE",`, R`(me,{}),"ODKRYWAJ",`],
  [R`(Lt,{}),"DISCOVER",`, R`(Lt,{}),"POZNAWAJ",`],
  [R`"YOUR NEXT ADVENTURE"`, R`"TWOJA KOLEJNA PRZYGODA"`],
  [R`"HammerShop Assistant "`, R`"Asystent HammerShop "`],
  [R`{children:"APP"}`, R`{children:"APLIKACJA"}`],
  [R`"Your community. In sync."`, R`"Twoja społeczność. Zawsze zgrana."`],
  [R`" possibilities "`, R`" możliwości "`],
  [R`{children:"Automate"}`, R`{children:"Automatyzuj"}`],
  [R`{children:"Connect"}`, R`{children:"Łącz"}`],
  [R`{children:"Create"}`, R`{children:"Twórz"}`],
  [R`"Your universe "`, R`"Twój świat "`],
  [R`"YOUR COMMUNITY"`, R`"TWOJA SPOŁECZNOŚĆ"`],
  [R`"# welcome"`, R`"# powitania"`],
  [R`"# general"`, R`"# czat"`],
  [R`"# announcements"`, R`"# ogłoszenia"`],
  [R`"\u2667 lounge"`, R`"\u2667 rozmowy"`],
  [R`"HAMMERSHOP / BUILT FOR YOU"`, R`"HAMMERSHOP / STWORZONE DLA CIEBIE"`],

  // Errors when talking to the server
  [R`"The HammerShop server can't be reached right now. Please try again in a moment."`, R`"Nie można teraz połączyć się z serwerem HammerShop. Spróbuj ponownie za chwilę."`],
  [R`"Something went wrong. Please try again."`, R`"Coś poszło nie tak. Spróbuj ponownie."`],

  // FAQ (the first question is in the helpers' piece above)
  [
    R`"Sign in with Discord – that’s all. There is no membership or access fee: fill your bag, pay securely by card with Stripe and your order opens in a private ticket on the HammerShop Discord."`,
    R`"Zaloguj się przez Discord – to wszystko. Nie ma członkostwa ani opłaty za dostęp: dodaj produkty do koszyka, zapłać bezpiecznie kartą przez Stripe, a Twoje zamówienie otworzy się w prywatnym tickecie na Discordzie HammerShop."`,
  ],
  [R`"Do I have to join the HammerShop Discord first?"`, R`"Czy muszę najpierw dołączyć do Discorda HammerShop?"`],
  [
    R`"No. When you sign in, we add you to the HammerShop server automatically and give you the Member role – your orders and support are always one click away."`,
    R`"Nie. Gdy się zalogujesz, automatycznie dodamy Cię do serwera HammerShop i nadamy Ci rolę Członek – Twoje zamówienia i pomoc są zawsze o jedno kliknięcie od Ciebie."`,
  ],
  [R`"How fast is delivery?"`, R`"Jak szybka jest dostawa?"`],
  [
    R`"Products with instant delivery arrive the moment your payment is confirmed – in your ticket and in your Discord DMs. Everything else is delivered by the HammerShop team in your ticket."`,
    R`"Produkty z dostawą natychmiastową trafiają do Ciebie w chwili potwierdzenia płatności – do Twojego ticketu i do wiadomości prywatnych na Discordzie. Resztę dostarcza zespół HammerShop w Twoim tickecie."`,
  ],
  [R`"What happens if I change my Discord name?"`, R`"Co, jeśli zmienię nazwę na Discordzie?"`],
  [
    R`"Your orders are linked to your unique Discord ID. Changing your display name will not change that ID. Always sign in with the same account."`,
    R`"Twoje zamówienia są powiązane z Twoim unikalnym ID Discorda. Zmiana wyświetlanej nazwy nie zmienia tego ID. Zawsze loguj się tym samym kontem."`,
  ],
  [R`"Where do I find my purchases?"`, R`"Gdzie znajdę swoje zakupy?"`],
  [
    R`"Open My orders after signing in. Every order shows its status, its delivery and a direct link to its Discord ticket."`,
    R`"Po zalogowaniu otwórz Moje zamówienia. Przy każdym zamówieniu widać jego status, dostawę i bezpośredni link do ticketu na Discordzie."`,
  ],

  // Receipt after paying – checking
  [R`"ALMOST THERE"`, R`"JUŻ PRAWIE"`],
  [R`"Confirming your payment…"`, R`"Potwierdzamy Twoją płatność…"`],
  [
    R`"Stripe is confirming your payment and your order is being prepared on Discord. This only takes a moment – please keep this page open."`,
    R`"Stripe potwierdza Twoją płatność, a my przygotowujemy Twoje zamówienie na Discordzie. To potrwa tylko chwilę – nie zamykaj tej strony."`,
  ],
  // – failed / error
  [R`f?"PAYMENT NOT COMPLETED":"SOMETHING WENT WRONG"`, R`f?"PŁATNOŚĆ NIEZAKOŃCZONA":"COŚ POSZŁO NIE TAK"`],
  [R`f?"This payment didn’t go through.":"We couldn’t check your payment."`, R`f?"Ta płatność nie przeszła.":"Nie udało się sprawdzić Twojej płatności."`],
  [
    R`f?"No money was taken. Your bag is still here – try again whenever you’re ready.":(s.error||"Please try again in a moment.")+" If you were charged, contact HammerShop – we’ll sort it out."`,
    R`f?"Nie pobrano żadnych pieniędzy. Twój koszyk wciąż na Ciebie czeka – spróbuj ponownie, kiedy zechcesz.":(s.error||"Spróbuj ponownie za chwilę.")+" Jeśli pobrano od Ciebie pieniądze, skontaktuj się z HammerShop – wszystko wyjaśnimy."`,
  ],
  [R`"Back to your bag"`, R`"Wróć do koszyka"`],
  [R`"Check again"`, R`"Sprawdź ponownie"`],
  [R`"Contact support"`, R`"Kontakt z pomocą"`],
  // – pending
  [R`"PAYMENT PROCESSING"`, R`"PŁATNOŚĆ W TOKU"`],
  [R`"Your payment is on its way."`, R`"Twoja płatność jest w drodze."`],
  [
    R`"Stripe hasn’t confirmed it yet – with some payment methods that takes a few minutes. Your order opens on Discord automatically as soon as it’s confirmed."`,
    R`"Stripe jeszcze jej nie potwierdził – przy niektórych metodach płatności trwa to kilka minut. Twoje zamówienie otworzy się na Discordzie automatycznie, gdy tylko płatność zostanie potwierdzona."`,
  ],
  // – paid
  [R`"PAYMENT CONFIRMED"`, R`"PŁATNOŚĆ POTWIERDZONA"`],
  [R`"Thank you"+first`, R`"Dziękujemy"+first`],
  [
    R`"Your order is complete and already delivered – it’s waiting in your Discord ticket and your DMs."`,
    R`"Twoje zamówienie jest zrealizowane i już dostarczone – czeka w Twoim tickecie na Discordzie i w wiadomościach prywatnych."`,
  ],
  [R`"Your order is confirmed and waiting for you in a private ticket on the HammerShop Discord."`, R`"Twoje zamówienie jest potwierdzone i czeka na Ciebie w prywatnym tickecie na Discordzie HammerShop."`],
  [
    R`"Your order is confirmed. Join the HammerShop Discord with this account and it opens there automatically."`,
    R`"Twoje zamówienie jest potwierdzone. Dołącz do Discorda HammerShop z tego konta, a otworzy się tam automatycznie."`,
  ],
  [R`"Your order is confirmed. We’re opening your private ticket on Discord…"`, R`"Twoje zamówienie jest potwierdzone. Otwieramy Twój prywatny ticket na Discordzie…"`],
  [R`"ORDER REFERENCE"`, R`"NUMER ZAMÓWIENIA"`],
  [R`"aria-label":"Copy order reference"`, R`"aria-label":"Kopiuj numer zamówienia"`],
  [R`cp?"Copied":"Copy"`, R`cp?"Skopiowano":"Kopiuj"`],
  [R`{children:"DATE"}`, R`{children:"DATA"}`],
  [R`toLocaleDateString("en-GB"`, R`toLocaleDateString("pl-PL"`],
  [R`{children:"Total paid"}`, R`{children:"Zapłacono razem"}`],
  [R`"Paid by card \xB7 secured by Stripe"`, R`"Zapłacono kartą \xB7 zabezpieczone przez Stripe"`],
  [
    R`ticket?"Questions about this order? Just write in your ticket – the HammerShop team helps you there.":"Questions about this order? Contact HammerShop support and mention your order reference."`,
    R`ticket?"Pytania o to zamówienie? Napisz w swoim tickecie – zespół HammerShop pomoże Ci na miejscu.":"Pytania o to zamówienie? Napisz do pomocy HammerShop i podaj numer zamówienia."`,
  ],
  [R`"Payment received"`, R`"Płatność otrzymana"`],
  [R`"Confirmed by Stripe"`, R`"Potwierdzona przez Stripe"`],
  [R`"Ticket #"+o.ticketNumber+" opened":waiting?"Join the HammerShop Discord":"Opening your ticket"`, R`"Ticket #"+o.ticketNumber+" otwarty":waiting?"Dołącz do Discorda HammerShop":"Otwieramy Twój ticket"`],
  [
    R`ticket?"Your private channel on the HammerShop Discord":waiting?"Your ticket opens as soon as you join":"This takes a few seconds"`,
    R`ticket?"Twój prywatny kanał na Discordzie HammerShop":waiting?"Ticket otworzy się, gdy tylko dołączysz":"To potrwa kilka sekund"`,
  ],
  [R`done?"Delivered":"Delivery"`, R`done?"Dostarczone":"Dostawa"`],
  [R`done?"In your ticket and your Discord DMs":"A seller delivers it in your ticket"`, R`done?"W Twoim tickecie i w wiadomościach prywatnych":"Sprzedawca dostarczy je w Twoim tickecie"`],
  [R`"Open ticket #"`, R`"Otwórz ticket #"`],
  [R`"Join the HammerShop Discord"`, R`"Dołącz do Discorda HammerShop"`],
  [R`"Continue shopping"`, R`"Kupuj dalej"`],
  [R`"My orders"`, R`"Moje zamówienia"`],

  // Toasts and messages of the page
  [R`"The live connection is unavailable. You are viewing a clearly marked design preview."`, R`"Brak połączenia ze sklepem. Oglądasz wyraźnie oznaczony podgląd strony."`],
  [R`"Checkout cancelled – you haven’t been charged."`, R`"Płatność anulowana – nie pobraliśmy żadnych pieniędzy."`],
  [R`"Welcome to HammerShop! You’ve been added to our Discord with the Member role."`, R`"Witaj w HammerShop! Dodaliśmy Cię do naszego Discorda z rolą Członek."`],
  [R`"Discord sign-in didn't work. Please try again."`, R`"Logowanie przez Discord nie powiodło się. Spróbuj ponownie."`],
  [R`"Discord sign-in was cancelled."`, R`"Logowanie przez Discord zostało anulowane."`],
  [R`"Discord sign-in is not connected yet. You can explore the demo."`, R`"Logowanie przez Discord nie jest jeszcze włączone. Możesz obejrzeć wersję demo."`],
  [R`Ue(b.name+" added to your bag.")`, R`Ue("Dodano do koszyka: "+b.name)`],
  [R`"Demo access activated. No payment was taken."`, R`"Dostęp demo aktywny. Nie pobrano żadnej płatności."`],
  [R`"Checkout is not open yet. No payment has been taken."`, R`"Płatności nie są jeszcze uruchomione. Nic nie zostało pobrane."`],
  [R`"Payment link could not be verified."`, R`"Nie udało się zweryfikować linku do płatności."`],

  // Preview bar, header
  [R`"Skip to collection"`, R`"Przejdź do kolekcji"`],
  [R`"OFFLINE PREVIEW "`, R`"PODGLĄD OFFLINE "`],
  [R`"/ Sample products & prices. No live checkout."`, R`"/ Przykładowe produkty i ceny. Bez prawdziwych płatności."`],
  [R`fa?"Reset demo":"Try the member experience"`, R`fa?"Zresetuj demo":"Wypróbuj konto demo"`],
  [R`"aria-label":"HammerShop home"`, R`"aria-label":"HammerShop – strona główna"`],
  [R`"The collection"`, R`"Kolekcja"`],
  [R`"How it works"`, R`"Jak to działa"`],
  [R`children:["Support",`, R`children:["Pomoc",`],
  ['"aria-label":`Open bag, ${eu} items`', '"aria-label":`Otwórz koszyk, ${eu} ${nxPl(eu,"produkt","produkty","produktów")}`'],
  [R`fa?"Preview member":t.user?.name:"Connect Discord"`, R`fa?"Konto demo":t.user?.name:"Połącz Discord"`],
  [R`"aria-label":"Toggle menu"`, R`"aria-label":"Pokaż lub ukryj menu"`],

  // Hero
  [R`" THE HAMMERSHOP UNIVERSE "`, R`" ŚWIAT HAMMERSHOP "`],
  [R`children:["Your next level",(0,d.jsx)("br",{}),"starts ",(0,d.jsx)("em",{children:"here."})]`, R`children:["Wejdź na",(0,d.jsx)("br",{}),"nowy ",(0,d.jsx)("em",{children:"poziom."})]`],
  [R`children:["Exceptional games. Custom Discord builds.",(0,d.jsx)("br",{}),"Digital essentials, with the HammerShop touch."]`, R`children:["Wyjątkowe gry. Discord szyty na miarę.",(0,d.jsx)("br",{}),"Cyfrowe produkty w stylu HammerShop."]`],
  [R`"Explore the collection"`, R`"Odkryj kolekcję"`],
  [R`"Sign in with Discord"`, R`"Zaloguj się przez Discord"`],
  [R`"Your Discord. Your access. Your world."`, R`"Twój Discord. Twój dostęp. Twój świat."`],
  [R`"aria-label":"HammerShop member card illustration"`, R`"aria-label":"Ilustracja karty członkowskiej HammerShop"`],
  [R`alt:"HammerShop logo"`, R`alt:"Logo HammerShop"`],
  [R`"CONNECTED TO YOUR WORLD"`, R`"POŁĄCZONE Z TWOIM ŚWIATEM"`],
  [R`children:["MEMBER",(0,d.jsx)("br",{}),"CARD"]`, R`children:["KARTA",(0,d.jsx)("br",{}),"CZŁONKA"]`],
  [R`"ONE ACCOUNT. ENDLESS POSSIBILITIES."`, R`"JEDNO KONTO. NIESKOŃCZONE MOŻLIWOŚCI."`],
  [R`ia?"WELCOME TO THE INSIDE.":"YOUR NEXT CHAPTER."`, R`ia?"WITAJ W ŚRODKU.":"TWÓJ NOWY ROZDZIAŁ."`],
  [R`"Made for your Discord"`, R`"Stworzone dla Twojego Discorda"`],
  [R`"One identity. Everything connected."`, R`"Jedna tożsamość. Wszystko połączone."`],
  [R`"CURATED. CONNECTED. HAMMERSHOP."`, R`"WYBRANE. POŁĄCZONE. HAMMERSHOP."`],
  [R`"SCROLL TO DISCOVER \u2193"`, R`"PRZEWIŃ, ABY ODKRYĆ \u2193"`],

  // Benefits bar
  [R`"One Discord identity"`, R`"Jedno konto Discord"`],
  [R`"Your purchases stay with you"`, R`"Twoje zakupy zawsze przy Tobie"`],
  [R`"Secure checkout"`, R`"Bezpieczne płatności"`],
  [R`"Card payments by Stripe"`, R`"Płatności kartą przez Stripe"`],
  [R`"A human on the other side"`, R`"Po drugiej stronie – człowiek"`],
  [R`"Support through our community"`, R`"Pomoc w naszej społeczności"`],

  // The collection
  [R`" THE COLLECTION"`, R`" KOLEKCJA"`],
  [R`children:["Find your next upgrade",`, R`children:["Znajdź coś dla siebie",`],
  [R`fa?"Demo account":ia?"Signed in – ready to shop":"Sign in with Discord to buy"`, R`fa?"Konto demo":ia?"Zalogowano – możesz kupować":"Zaloguj się przez Discord, aby kupić"`],
  [R`"aria-label":"Categories"`, R`"aria-label":"Kategorie"`],
  [R`," ",b,T===0&&`, R`," ",nxCat(b),T===0&&`],
  [R`(b.name+" "+b.category).toLowerCase()`, R`(b.name+" "+b.category+" "+nxCat(b.category)).toLowerCase()`],
  [R`"aria-label":"Search products",placeholder:"Find something good\u2026"`, R`"aria-label":"Szukaj produktów",placeholder:"Znajdź coś dobrego\u2026"`],
  [R`"aria-label":"Clear search"`, R`"aria-label":"Wyczyść wyszukiwanie"`],
  [R`"aria-label":"Sort products"`, R`"aria-label":"Sortuj produkty"`],
  [R`children:"Featured"`, R`children:"Polecane"`],
  [R`"Price: low to high"`, R`"Cena: od najniższej"`],
  [R`"Price: high to low"`, R`"Cena: od najwyższej"`],
  [R`"aria-label":"View "+b.name`, R`"aria-label":"Zobacz: "+b.name`],
  [R`," ",b.category]`, R`," ",nxCat(b.category)]`],
  [R`b.category==="Games"?"PLAY SOMETHING NEW":"BUILT AROUND YOU"`, R`b.category==="Games"?"ZAGRAJ W COŚ NOWEGO":"SZYTE NA MIARĘ"`],
  [
    R`b.art==="games"?"Your next adventure is waiting.":b.art==="bundle"?"More to play. One collection.":b.art==="bot"?"Make your community work for you.":"A home your community deserves."`,
    R`b.art==="games"?"Twoja kolejna przygoda już czeka.":b.art==="bundle"?"Więcej grania. Jedna kolekcja.":b.art==="bot"?"Niech Twoja społeczność pracuje dla Ciebie.":"Dom, na jaki zasługuje Twoja społeczność."`,
  ],
  [R`a.preview?"preview price":"per product"`, R`a.preview?"cena poglądowa":"za sztukę"`],
  [R`a.preview?"illustrative price":"per product"`, R`a.preview?"cena poglądowa":"za sztukę"`],
  [R`" Add to bag"`, R`" Do koszyka"`],
  [R`"No matches just yet."`, R`"Nic tu jeszcze nie ma."`],
  [R`"Try another search or explore the full collection."`, R`"Wpisz coś innego albo przejrzyj całą kolekcję."`],
  [R`"View all products"`, R`"Pokaż wszystkie produkty"`],
  [
    R`a.preview?"A first look at HammerShop. Final availability and prices will be confirmed before launch.":"Prices in EUR. Please review the product details before purchase."`,
    R`a.preview?"Pierwsze spojrzenie na HammerShop. Ostateczną dostępność i ceny potwierdzimy przed startem.":"Ceny w EUR. Przed zakupem sprawdź szczegóły produktu."`,
  ],
  [R`"Secure checkout by Stripe \xB7 delivered on Discord"`, R`"Bezpieczne płatności przez Stripe \xB7 dostawa na Discordzie"`],

  // How it works
  [R`" YOUR KEY TO HAMMERSHOP"`, R`" TWÓJ KLUCZ DO HAMMERSHOP"`],
  [R`children:["One connection.",(0,d.jsx)("br",{}),"A whole new ",(0,d.jsx)("em",{children:"world."})]`, R`children:["Jedno połączenie.",(0,d.jsx)("br",{}),"Zupełnie nowy ",(0,d.jsx)("em",{children:"świat."})]`],
  [
    R`"Sign in with the Discord account you already use. Pick what you like, pay securely and get it delivered right on Discord."`,
    R`"Zaloguj się kontem Discord, którego już używasz. Wybierz, co lubisz, zapłać bezpiecznie i odbierz zamówienie prosto na Discordzie."`,
  ],
  [R`ia?"View your account":`, R`ia?"Zobacz swoje konto":`],
  [R`"No membership. No access fee. You only pay for what you buy."`, R`"Bez członkostwa. Bez opłaty za dostęp. Płacisz tylko za to, co kupujesz."`],
  [R`title:"Sign in with Discord.",text:"One click. You’re added to the HammerShop server with the Member role automatically."`, R`title:"Zaloguj się przez Discord.",text:"Jedno kliknięcie. Automatycznie dodamy Cię do serwera HammerShop z rolą Członek."`],
  [R`title:"Fill your bag.",text:"Games, bots and servers. Pay securely by card – Stripe handles the payment."`, R`title:"Wypełnij koszyk.",text:"Gry, boty i serwery. Zapłać bezpiecznie kartą – płatność obsługuje Stripe."`],
  [
    R`title:"Get it on Discord.",text:"Your order opens in a private ticket. Instant products arrive right away – in the ticket and your DMs."`,
    R`title:"Odbierz na Discordzie.",text:"Twoje zamówienie otwiera się w prywatnym tickecie. Produkty z dostawą natychmiastową trafiają od razu do ticketu i do Twoich wiadomości prywatnych."`,
  ],
  [R`children:["STEP 0",`, R`children:["KROK 0",`],

  // FAQ, community, footer
  [R`" GOOD TO KNOW"`, R`" WARTO WIEDZIEĆ"`],
  [R`children:["A little clarity.",(0,d.jsx)("br",{}),"Before you join."]`, R`children:["Trochę jasności.",(0,d.jsx)("br",{}),"Zanim dołączysz."]`],
  [R`children:["Something else on your mind?",(0,d.jsx)("br",{}),"We\u2019re one conversation away."]`, R`children:["Masz inne pytanie?",(0,d.jsx)("br",{}),"Jesteśmy o jedną wiadomość od Ciebie."]`],
  [R`"Talk to HammerShop"`, R`"Porozmawiaj z HammerShop"`],
  [R`"More than a store. A place to belong."`, R`"Więcej niż sklep. Miejsce dla Ciebie."`],
  [R`"The HammerShop experience continues on Discord."`, R`"Przygoda z HammerShop trwa dalej na Discordzie."`],
  [R`"Meet the community"`, R`"Poznaj społeczność"`],
  [R`"A different kind of digital."`, R`"Cyfrowo, ale inaczej."`],
  [R`"Purchase information"`, R`"Informacje o zakupach"`],
  [R`" HammerShop. All rights reserved."`, R`" HammerShop. Wszelkie prawa zastrzeżone."`],
  [R`"DESIGNED FOR YOUR NEXT CHAPTER \u2726"`, R`"ZAPROJEKTOWANE NA TWÓJ NOWY ROZDZIAŁ \u2726"`],
  [R`"aria-label":"Dismiss"`, R`"aria-label":"Zamknij powiadomienie"`],
  [R`"aria-label":"Close"`, R`"aria-label":"Zamknij"`],

  // Account (sign-in) dialog
  [R`"HAMMERSHOP ACCOUNT"`, R`"KONTO HAMMERSHOP"`],
  [R`"SIGN IN TO SHOP"`, R`"ZALOGUJ SIĘ, ABY KUPOWAĆ"`],
  [R`ia?"Make yourself at home.":"Good things start with a connection."`, R`ia?"Rozgość się.":"Dobre rzeczy zaczynają się od połączenia."`],
  [R`"One Discord account for every order – and a place on the HammerShop server with the Member role."`, R`"Jedno konto Discord do wszystkich zamówień – i miejsce na serwerze HammerShop z rolą Członek."`],
  [R`"Connect Discord"`, R`"Połącz Discord"`],
  [R`"Start shopping"`, R`"Zacznij zakupy"`],
  [R`"Demo account. No real connection or payment."`, R`"Konto demo. Bez prawdziwego połączenia i płatności."`],
  [R`fa?"HammerShop Preview":t.user.name`, R`fa?"Podgląd HammerShop":t.user.name`],
  [R`fa?"Simulated member":`, R`fa?"Symulowany klient":`],
  [R`fa?"DEMO":"CONNECTED"`, R`fa?"DEMO":"POŁĄCZONO"`],
  [
    R`fa?"Demo account is ready.":t.member?"You’re signed in and a Member of the HammerShop Discord.":"You’re signed in and ready to shop."`,
    R`fa?"Konto demo jest gotowe.":t.member?"Konto połączone – należysz do Discorda HammerShop z rolą Członek.":"Konto połączone – możesz kupować."`,
  ],
  [R`"HammerShop Access"`, R`"Dostęp HammerShop"`],
  [R`"One-time fee \xB7 products sold separately"`, R`"Jednorazowa opłata \xB7 produkty osobno"`],
  [R`At(a.accessPrice):"Soon"`, R`At(a.accessPrice):"Wkrótce"`],
  [R`fa?"Preview access activation":"Activate my access"`, R`fa?"Podgląd aktywacji dostępu":"Aktywuj mój dostęp"`],
  [R`a.preview?"Illustrative access price for this preview.":"Your access is activated after payment verification."`, R`a.preview?"Poglądowa cena dostępu w tym podglądzie.":"Dostęp zostanie aktywowany po weryfikacji płatności."`],
  [R`fa?"Exit preview account":"Sign out"`, R`fa?"Wyjdź z konta demo":"Wyloguj się"`],
  [R`"Continue with Discord"`, R`"Kontynuuj z Discordem"`],
  [R`"Discord sign-in isn’t switched on yet. You can explore the store in the meantime."`, R`"Logowanie przez Discord nie jest jeszcze włączone. W międzyczasie możesz przeglądać sklep."`],
  [
    R`"We only use your Discord name and avatar, and add you to the HammerShop server. Nothing is ever posted for you."`,
    R`"Używamy tylko Twojej nazwy i awatara z Discorda oraz dodajemy Cię do serwera HammerShop. Nigdy nic nie publikujemy w Twoim imieniu."`,
  ],
  [R`"Explore with a preview account"`, R`"Przeglądaj z kontem demo"`],

  // Product dialog
  [R`children:[c.category,a.preview?" / PREVIEW":""]`, R`children:[nxCat(c.category),a.preview?" / PODGLĄD":""]`],
  [R`"Instant delivery \u2013 in your ticket and your DMs"`, R`"Dostawa natychmiastowa \u2013 w Twoim tickecie i w wiadomościach prywatnych"`],
  [R`"Linked to your Discord account"`, R`"Powiązane z Twoim kontem Discord"`],
  [R`"Delivered in your private Discord ticket"`, R`"Dostawa w Twoim prywatnym tickecie na Discordzie"`],
  [R`"Real support from the HammerShop team"`, R`"Prawdziwa pomoc od zespołu HammerShop"`],
  [R`"Preview listing. Final product details and delivery terms must be confirmed before real sales."`, R`"Oferta poglądowa. Szczegóły produktu i warunki dostawy potwierdzimy przed rozpoczęciem sprzedaży."`],

  // Bag
  [R`"YOUR NEXT UPGRADE"`, R`"TWOJE ZAKUPY"`],
  [R`children:["Your bag ",`, R`children:["Twój koszyk ",`],
  [R`"aria-label":"Reduce "+b.name`, R`"aria-label":"Zmniejsz ilość: "+b.name`],
  [R`"aria-label":"Increase "+b.name`, R`"aria-label":"Zwiększ ilość: "+b.name`],
  [R`"aria-label":"Remove "+b.name`, R`"aria-label":"Usuń: "+b.name`],
  [R`{children:"Total"}`, R`{children:"Razem"}`],
  [R`fa?"Create a demo order":ia?"Continue to checkout":"Sign in with Discord to check out"`, R`fa?"Utwórz zamówienie demo":ia?"Przejdź do płatności":"Zaloguj się przez Discord, aby zamówić"`],
  [R`fa?"Simulation only. No charge or product delivery.":"Secure card payment by Stripe. Your order opens on Discord right after."`, R`fa?"Tylko symulacja. Bez płatności i dostawy produktów.":"Bezpieczna płatność kartą przez Stripe. Zaraz potem Twoje zamówienie otworzy się na Discordzie."`],
  [R`"A little room for something good."`, R`"Tu jest miejsce na coś dobrego."`],
  [R`"Your next upgrade is waiting in the collection."`, R`"Coś dla Ciebie czeka w kolekcji."`],
  [R`"Explore products"`, R`"Przeglądaj produkty"`],

  // My orders
  [R`"YOUR HAMMERSHOP ACCOUNT"`, R`"TWOJE KONTO HAMMERSHOP"`],
  [R`"Demo orders only. No money is charged."`, R`"Tylko zamówienia demo. Nie pobieramy pieniędzy."`],
  [R`"Checking your orders\u2026"`, R`"Sprawdzamy Twoje zamówienia\u2026"`],
  [
    R`b.status==="demo"?"DEMO COMPLETE":b.status==="paid"?b.delivered?"DELIVERED":"PAID":b.status==="pending"?"AWAITING PAYMENT":b.status==="failed"?"NOT COMPLETED":b.status.toUpperCase()`,
    R`b.status==="demo"?"DEMO ZAKOŃCZONE":b.status==="paid"?b.delivered?"DOSTARCZONE":"OPŁACONE":b.status==="pending"?"OCZEKUJE NA PŁATNOŚĆ":b.status==="failed"?"NIEZAKOŃCZONE":b.status==="expired"?"WYGASŁO":b.status.toUpperCase()`,
  ],
  [R`"Payment confirmed. Delivery is being prepared. Contact HammerShop with your order reference."`, R`"Płatność potwierdzona. Przygotowujemy dostawę. W razie pytań napisz do HammerShop i podaj numer zamówienia."`],
  [R`"Refresh payment status"`, R`"Odśwież status płatności"`],
  [R`"Your story starts here."`, R`"Tu zaczyna się Twoja historia."`],
  [R`"Your purchases will appear here."`, R`"Tutaj pojawią się Twoje zakupy."`],
  [R`"Keep exploring"`, R`"Przeglądaj dalej"`],
  [R`"Your purchases, all together."`, R`"Wszystkie Twoje zakupy w jednym miejscu."`],
  [R`"Connect the account you used at checkout."`, R`"Połącz konto Discord użyte przy zakupie."`],

  // Support and purchase information
  [R`"WE\u2019RE HERE FOR YOU"`, R`"JESTEŚMY DLA CIEBIE"`],
  [R`"Let\u2019s talk."`, R`"Porozmawiajmy."`],
  [R`"Questions about a product or an order? The HammerShop team is on Discord and happy to help."`, R`"Pytania o produkt lub zamówienie? Zespół HammerShop jest na Discordzie i chętnie pomoże."`],
  [R`"Open HammerShop on Discord"`, R`"Otwórz HammerShop na Discordzie"`],
  [
    R`"The community invite will be added before launch. You can explore the FAQ and your demo orders in this preview."`,
    R`"Zaproszenie na serwer dodamy przed startem. W tym podglądzie możesz przejrzeć FAQ i swoje zamówienia demo."`,
  ],
  [R`"Read the FAQ"`, R`"Przeczytaj FAQ"`],
  [R`"For an existing purchase, have your order reference ready."`, R`"Jeśli chodzi o złożone zamówienie, przygotuj jego numer."`],
  [R`"BEFORE YOU BUY"`, R`"ZANIM KUPISZ"`],
  [R`"Clear from the start."`, R`"Jasno od samego początku."`],
  [R`{children:"Buying"}`, R`{children:"Zakupy"}`],
  [
    R`"Sign in with Discord and you can buy right away – there is no membership or access fee. You only pay for the products in your bag."`,
    R`"Zaloguj się przez Discord i od razu możesz kupować – nie ma członkostwa ani opłaty za dostęp. Płacisz tylko za produkty w koszyku."`,
  ],
  [R`{children:"Your account"}`, R`{children:"Twoje konto"}`],
  [
    R`"Your unique Discord ID links your orders. Your public name and avatar are used for your profile, and you’re added to the HammerShop Discord with the Member role."`,
    R`"Twoje unikalne ID Discorda łączy Twoje zamówienia. Publiczna nazwa i awatar służą do Twojego profilu, a my dodajemy Cię do Discorda HammerShop z rolą Członek."`,
  ],
  [R`{children:"Payment and delivery"}`, R`{children:"Płatność i dostawa"}`],
  [
    R`"Card payments are handled by Stripe – HammerShop never sees your card details. After payment your order opens in a private ticket on Discord, and products with instant delivery arrive there and in your DMs right away."`,
    R`"Płatności kartą obsługuje Stripe – HammerShop nigdy nie widzi danych Twojej karty. Po płatności Twoje zamówienie otwiera się w prywatnym tickecie na Discordzie, a produkty z dostawą natychmiastową od razu trafiają tam i do Twoich wiadomości prywatnych."`,
  ],
  [R`{children:"About this preview"}`, R`{children:"O tym podglądzie"}`],
  [
    R`"Catalog entries and prices are illustrative. Seller details, final product descriptions and purchase terms must be supplied before real sales."`,
    R`"Produkty i ceny są poglądowe. Dane sprzedawcy, ostateczne opisy produktów i warunki zakupu uzupełnimy przed rozpoczęciem sprzedaży."`,
  ],
];

const PAIRS = [...HEAD, ...PAGE];

/** The English pieces that are not in this page (an English page should have all of them). */
const missing = (html) => PAIRS.filter(([en]) => !html.includes(en)).map(([en]) => en);

/** The page in Polish. A page that is Polish already comes back unchanged. */
function translate(html) {
  if (html.includes('<html lang="pl">')) return html;
  const gone = missing(html);
  if (gone.length) console.warn(`website-pl: ${gone.length} English piece(s) not found – was the design changed? ${gone.map((s) => `\n  ${s.slice(0, 100)}`).join('')}`);
  let out = html;
  for (const [en, pl] of PAIRS) out = out.split(en).join(pl);
  return out;
}

module.exports = { translate, missing, PAIRS };
