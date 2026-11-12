<!--
  REGULAMIN SERWERA HAMMER LAUNCHER – bot publikuje ten plik na kanale z regulaminem przy /zbuduj, gdy działa
  z profilem launchera (BOT_PROFILE=launcher w .env). Po zmianie: zapisz plik, uruchom bota ponownie i wpisz
  /zbuduj tylko:panels – regulamin zaktualizuje się w miejscu.

  Wstawki, które bot podmienia (te same co w regulamin.md):
    {brand}             nazwa z config.launcher.json (brand.name)
    {#tickets} {#launcher} {#updates} {#plus} {#bugs} {#suggestions} {#faq} {#announcements}
                        link do kanału (klucze kanałów są w src/builder/layout.launcher.js)
    {e:info}            pomarańczowa emotka bota (nazwy plików z assets/emojis)
    {supportHours}      godziny pracy z config.json (workingHours)
    {seller} {email}    dane sprzedawcy i e-mail z config.json (rules.seller, rules.email)
  Linia z pustą wstawką (np. bez uzupełnionego {seller}) nie jest publikowana.
  Każda sekcja zaczyna się od "## ". Komentarze takie jak ten nie są publikowane.

  WAŻNE: jeśli sprzedajesz Hammer+, uzupełnij w config.json → rules.seller dane sprzedawcy i rules.email.
  To solidny wzór, ale nie porada prawna.
-->
# 📜 Regulamin {brand}
-# Wersja 1.0 · obowiązuje od 12.11.2026 · serwer Discord i launcher {brand}

To zasady naszego serwera Discord i korzystania z **{brand}**. Będąc tutaj albo używając launchera, akceptujesz ten regulamin oraz [Zasady społeczności Discorda](https://discord.com/guidelines).

## {e:info} §1 · O co tu chodzi
> **1.1** {brand} to darmowy launcher Minecrafta. Ten serwer to miejsce, gdzie go pobierzesz ({#launcher}), przeczytasz o nowych wersjach ({#updates}), dostaniesz pomoc ({#tickets}) i pogadasz z innymi graczami.
> **1.2** Launcher jest w wersji **beta** – działa, ale wciąż go dopracowujemy. Coś może się zmienić albo chwilowo nie działać; zgłoszenia błędów bardzo nam pomagają.
> **1.3** Do gry potrzebujesz oryginalnego Minecrafta: Java Edition na koncie Microsoft. Nie jesteśmy powiązani z Mojang ani Microsoft.
> 🏢 **Sprzedawca Hammer+:** {seller}
> ✉️ **E-mail:** {email}

## {e:chat} §2 · Kultura na serwerze
> **2.1** Szanuj innych. Zero wyzwisk, nękania, gróźb, mowy nienawiści i treści 18+.
> **2.2** Nie spamuj, nie floodź, nie pisz CAPSEM i nie oznaczaj nikogo bez potrzeby – zwłaszcza zespołu.
> **2.3** Żadnych reklam: innych serwerów Discord, sklepów, launcherów i klientów – także w wiadomościach prywatnych do członków.
> **2.4** Piszemy po polsku i na temat kanału. Na pomoc jest {#tickets}, na pomysły {#suggestions}.
> **2.5** Nick, awatar i opis profilu też muszą być zgodne z tymi zasadami. Nie podszywaj się pod zespół.

## {e:shield} §3 · Uczciwa gra i bezpieczeństwo
> **3.1** Zakazane jest rozmawianie o cheatach, hackowanych klientach i kontach z nielegalnego źródła, proszenie o nie i ich udostępnianie. Nie pomagamy w grze na kontach nieoryginalnych.
> **3.2** Pobieraj launcher **tylko** z naszej strony i z kanału {#launcher}. Nigdy nie uruchamiaj plików, które ktoś wysłał Ci prywatnie jako „launcher” albo „aktualizację”.
> **3.3** Zespół **nigdy** nie prosi o hasło, kod z e-maila, dane karty ani token. Logujesz się wyłącznie na oficjalnej stronie Microsoftu, w oknie launchera.
> **3.4** Nie próbuj łamać zabezpieczeń launchera, strony ani bota. Znalazłeś lukę? Zgłoś ją prywatnie ticketem – podziękujemy.
> **3.5** Mody, paczki i shadery instalujesz na własną odpowiedzialność – pochodzą od ich autorów (Modrinth), nie od nas.

## {e:star} §4 · Hammer+
> **4.1** Hammer+ to płatny dodatek do launchera: wygląd i wygoda (motywy, tła, peleryny, kopie światów, chmura). **Nie daje żadnej przewagi w grze**, a wszystko, co w launcherze jest darmowe, zostaje darmowe. Szczegóły: {#plus}.
> **4.2** Hammer+ kupujesz na naszej stronie – płatność obsługuje Stripe. Kod jest przypisany do **konta Minecraft**, dla którego go kupujesz, i działa tylko na nim. Sprawdź nick przed zapłatą.
> **4.3** Kod dostajesz od razu po płatności (na stronie i w wiadomości prywatnej od bota). To treść cyfrowa dostarczana natychmiast – kupując, zgadzasz się na jej natychmiastowe dostarczenie i przyjmujesz do wiadomości, że po dostarczeniu kodu nie przysługuje prawo odstąpienia od umowy.
> **4.4** Kod nie działa albo kupiłeś go dla złego nicku? Otwórz ticket **Hammer+ i płatności** – każdą sprawę sprawdzamy i naprawiamy, co się da.
> **4.5** Sprzedawanie i odsprzedawanie kodów jest zabronione. Za kod zdobyty nieuczciwie (np. cofnięta płatność) grozi ban na serwerze.

## {e:question} §5 · Pomoc i zgłaszanie błędów
> **5.1** Pomoc dostaniesz przez ticket na {#tickets}. Zanim napiszesz, zajrzyj na {#faq} – wiele odpowiedzi już tam jest.
> **5.2** W zgłoszeniu podaj wersję launchera, wersję Minecrafta i opis krok po kroku. Najbardziej pomaga log: **Konsola → Udostępnij log** w launcherze. Jak zgłaszać błędy: {#bugs}.
> **5.3** Pomagamy w godzinach pracy zespołu: {supportHours}. Poza nimi odpowiedź może przyjść później.
> **5.4** Pomysły na nowe funkcje wrzucaj na {#suggestions} – czytamy wszystkie, ale nie każdy da się zrealizować.

## {e:warning} §6 · Kary
> **6.1** Za łamanie regulaminu grozi: ostrzeżenie, wyciszenie, wyrzucenie albo ban – zależnie od tego, co się stało i czy to pierwszy raz.
> **6.2** Za oszustwa, cheaty, groźby i ataki na serwer albo launcher ban jest natychmiastowy.
> **6.3** Od kary możesz się odwołać ticketem **Odwołanie od kary**. Omijanie bana drugim kontem kończy się banem obu kont.
> **6.4** O sprawach, których regulamin nie opisuje, decyduje zespół – kierując się zdrowym rozsądkiem.

## {e:lock_locked} §7 · Prywatność
> **7.1** Bot zapisuje tylko to, czego potrzebuje do działania: ID Discorda, treść ticketów i ich transkrypcje, a przy Hammer+ – nick i UUID konta Minecraft oraz dane zamówienia. Danych karty nie widzimy – zostają w Stripe.
> **7.2** Launcher liczy uruchomienia anonimowo (same liczby na dzień i wersję – bez adresów IP i kont). Chmura Hammer+ przechowuje ustawienia launchera, które sam do niej wyślesz.
> **7.3** Chcesz wiedzieć, co o Tobie przechowujemy, albo to usunąć? Napisz ticket – załatwimy to.
