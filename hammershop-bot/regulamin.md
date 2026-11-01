<!--
  REGULAMIN HAMMERSHOP – bot publikuje ten plik na kanale z regulaminem (#rules) przy /build.
  Po zmianie: zapisz plik, zrestartuj bota i wpisz /build only:panels – regulamin zaktualizuje się w miejscu.

  Wstawki, które bot podmienia:
    {brand}             nazwa sklepu z config.json (brand.name)
    {#shop} {#tickets} {#payments} {#announcements} {#faq} {#howToBuy} {#vouches}
                        link do kanału (klucze kanałów są w src/builder/layout.js)
    {e:cart}            pomarańczowa emotka bota (nazwy plików z assets/emojis, np. {e:check})
    {paymentMethods}    metody płatności z config.json (shop.paymentMethods)
    {supportHours}      godziny pracy z config.json (workingHours – tekst po angielsku)
    {seller} {email}    dane sprzedawcy i e-mail z config.json (rules.seller, rules.email)
  Linia z pustą wstawką (np. bez uzupełnionego {seller}) nie jest publikowana.
  Każda sekcja zaczyna się od "## ". Komentarze takie jak ten nie są publikowane.

  WAŻNE: uzupełnij w config.json → rules.seller dane sprzedawcy (imię i nazwisko lub nazwa firmy, adres,
  ewentualnie NIP) i rules.email – sklep, który sprzedaje konsumentom, musi je podać. Ten regulamin to solidny
  wzór, ale nie porada prawna – przy większej sprzedaży warto dać go do sprawdzenia prawnikowi.
-->
# 📜 Regulamin {brand}
-# Wersja 2.0 · obowiązuje od 01.11.2026 · sklep hammershop.pl i serwer Discord {brand}

Ten regulamin opisuje zasady zakupów w sklepie **{brand}** i zasady korzystania z naszego serwera Discord. Korzystając z serwera lub składając zamówienie, akceptujesz regulamin oraz [Warunki korzystania z Discorda](https://discord.com/terms) i [Wytyczne dla społeczności](https://discord.com/guidelines).

## {e:info} §1 · Postanowienia ogólne
> **1.1** {brand} to sklep z produktami cyfrowymi (m.in. pluginy i pliki do pobrania). Sklep działa na stronie **hammershop.pl** i na naszym serwerze Discord – obie części tworzą jeden sklep.
> 🏢 **Sprzedawca:** {seller}
> ✉️ **E-mail:** {email}
> **1.2** Kontakt we wszystkich sprawach – zamówienia, reklamacje, dane osobowe: ticket na kanale {#tickets}.
> **1.3** Do zakupów potrzebujesz konta Discord. Osoby niepełnoletnie robią zakupy za zgodą rodzica lub opiekuna.
> **1.4** Cena przy produkcie to cena końcowa – nie doliczamy ukrytych opłat. Opłaty sieci przy płatności kryptowalutą pokrywa kupujący.

## {e:cart} §2 · Jak kupić
> **2.1** Wybierz produkt na kanale {#shop} i kliknij **Buy** albo dodaj kilka produktów do koszyka. Na stronie hammershop.pl logujesz się przez Discord i płacisz kartą.
> **2.2** W formularzu wybierasz wariant, ilość, metodę płatności i – jeśli masz – kod rabatowy. Od razu otwiera się **prywatny ticket**, który widzisz tylko Ty i nasz zespół.
> **2.3** W tickecie dostajesz kwotę do zapłaty i instrukcję płatności. Zamówienie realizujemy po zaksięgowaniu płatności.
> **2.4** Zamówienia obsługujemy **wyłącznie w ticketach** i na stronie hammershop.pl. Nasz zespół **nigdy nie pisze pierwszy w DM** z prośbą o płatność – taka osoba to oszust, zgłoś ją w tickecie.
> **2.5** Kody rabatowe mają własne warunki (termin ważności, limit użyć, np. tylko pierwsze zamówienie). Kodów nie wymieniamy na gotówkę.

## {e:card} §3 · Płatności
{paymentMethods}
> Instrukcje do każdej metody znajdziesz na kanale {#payments}.
> **3.1** Płatności z linkiem w tickecie potwierdzają się automatycznie. Płatności sprawdzane ręcznie, np. **PaySafeCard**, weryfikujemy w godzinach pracy sklepu (status 🟢 / 🔴 na górze serwera) – najpóźniej **do 24 godzin**.
> **3.2** Kod PaySafeCard podajesz **tylko** przyciskiem **Pay** w swoim tickecie – nigdy w DM ani na czacie. Pełny kod widzi wyłącznie właściciel sklepu.
> **3.3** Saldo sklepu (komenda **/balance**) służy wyłącznie do zakupów w {brand}. Nie wypłacamy go i nie zwracamy.
> **3.4** Próby oszustwa – fałszywe potwierdzenia płatności, cudze karty lub kody, nieuzasadnione obciążenia zwrotne (chargeback) – kończą się trwałą blokadą.

## {e:box} §4 · Dostawa i licencja
> **4.1** Produkty z dostawą automatyczną dostajesz zaraz po potwierdzeniu płatności – w tickecie **i** w wiadomości prywatnej (DM) od bota. Pozostałe dostarcza sprzedawca, zwykle w ciągu kilkunastu minut w godzinach pracy.
> **4.2** Włącz wiadomości prywatne od członków serwera, żeby dostać produkt i potwierdzenie zakupu także w DM.
> **4.3** Zachowaj pliki i dane dostępowe. Zgubiłeś je? Otwórz ticket – wyślemy je ponownie. Historię zamówień znajdziesz pod przyciskiem **My orders** na kanale {#shop}.
> **4.4** Dostęp do zakupionych plików jest bezterminowy, chyba że opis produktu mówi inaczej.
> **4.5** Kupując produkt, otrzymujesz prawo do korzystania z niego na własny użytek, np. na swoim serwerze. Nie wolno go odsprzedawać, udostępniać, publikować ani rozpowszechniać – także po przeróbkach. Naruszenie oznacza blokadę i koniec wsparcia.

## {e:gift} §5 · Produkty darmowe
> **5.1** Część produktów udostępniamy za **0 zł** – nie wymagają płatności.
> **5.2** Produkty darmowe udostępniamy „tak jak są”: bez gwarancji działania i bez obowiązku wsparcia technicznego.
> **5.3** Zasady licencji z punktu **4.5** obowiązują także przy produktach darmowych.

## {e:refresh} §6 · Odstąpienie od umowy, reklamacje i zwroty
> **6.1** Jako konsument możesz odstąpić od umowy zawartej na odległość w ciągu **14 dni** od zakupu, bez podawania przyczyny.
> **6.2** Prawo odstąpienia **wygasa**, gdy zaczniemy dostarczać treść cyfrową (wyślemy plik, klucz lub dostęp). Składając zamówienie, prosisz o natychmiastową dostawę i przyjmujesz do wiadomości, że po dostawie tracisz prawo odstąpienia.
> **6.3** Produkt nie działa albo jest niezgodny z opisem? Otwórz ticket **Support** na kanale {#tickets}, opisz problem i dołącz zrzuty ekranu. Najpierw naprawimy lub wymienimy produkt, a gdy to niemożliwe – **zwrócimy pieniądze** lub obniżymy cenę.
> **6.4** Na reklamację odpowiadamy w ciągu **14 dni**, zwykle dużo szybciej. Zgłoś problem jak najszybciej – najlepiej w ciągu 48 godzin od zakupu, wtedy rozwiążemy go najsprawniej.
> **6.5** Zwrot pieniędzy wysyłamy tą samą metodą, którą zapłaciłeś. Przy płatności PaySafeCard formę zwrotu ustalamy w tickecie.
> **6.6** Zwrotem nie są objęte: produkty działające zgodnie z opisem, problemy wynikające z niespełnienia wymagań podanych przy produkcie (np. wersja serwera) oraz saldo sklepu.

## {e:shield} §7 · Zasady serwera Discord
> **7.1** Szanuj innych – zero nękania, hejtu, dyskryminacji i gróźb.
> **7.2** Bez spamu, floodu, nadmiernego caps locka i masowego oznaczania.
> **7.3** Bez wulgaryzmów oraz treści NSFW, drastycznych lub nielegalnych.
> **7.4** Bez reklam i autopromocji – także w DM do naszych członków.
> **7.5** Bez linków na czacie (GIF-y są w porządku).
> **7.6** Nie podszywaj się pod zespół {brand} ani innych użytkowników.
> **7.7** Jeden problem = jeden ticket. Nie oznaczaj zespołu – dostaje powiadomienie automatycznie. Tickety bez odpowiedzi zamykają się same.
> **7.8** Za łamanie zasad grozi ostrzeżenie, wyciszenie, wyrzucenie lub ban. Od kary odwołasz się ticketem **Punishment Appeal**.

## {e:lock_locked} §8 · Konto i bezpieczeństwo
> **8.1** Nie udostępniaj nikomu swojego konta Discord ani danych logowania do hammershop.pl.
> **8.2** Ktoś pisze w imieniu {brand}? Sprawdź jego role na serwerze – zespół ma role od **CEO** do **Support**, a bot ma własną rangę **HammerShop**. W razie wątpliwości otwórz ticket.

## {e:person} §9 · Dane osobowe (RODO)
> **9.1** Administratorem danych jest Sprzedawca. Przetwarzamy tylko dane potrzebne do obsługi zamówień: identyfikator i nazwę konta Discord, historię zamówień i ticketów oraz – przy płatnościach – dane przekazane operatorowi płatności.
> **9.2** Dane przekazujemy wyłącznie operatorom płatności (np. Simpay, Stripe, PayPal) w zakresie potrzebnym do przyjęcia płatności.
> **9.3** Dane przechowujemy przez czas obsługi zamówienia i reklamacji, a dane rozliczeniowe – tak długo, jak wymagają tego przepisy.
> **9.4** Masz prawo dostępu do swoich danych, ich poprawienia, usunięcia, ograniczenia przetwarzania i przeniesienia, a także prawo skargi do Prezesa UODO. Napisz do nas w tickecie.

## {e:bell} §10 · Zmiany regulaminu
> **10.1** Regulamin może się zmienić, np. po dodaniu nowej metody płatności lub zmianie przepisów. O każdej nowej wersji informujemy na kanale {#announcements}.
> **10.2** Zamówienia złożone przed zmianą realizujemy według regulaminu z dnia zakupu.
> **10.3** W sprawach nieuregulowanych stosuje się prawo polskie, w szczególności Kodeks cywilny i ustawę o prawach konsumenta.

-# {e:heart} Dziękujemy za zakupy w {brand}! · Pytania? Ticket na {#tickets}
