# 🖥️ HammerShop na własnym serwerze 24/7

Jeden program – **bot Discord + strona + pliki launchera** – działa na Twoim serwerze przez całą dobę. Wszystkie sekrety
(token bota, klucze Stripe, klucz Hammer+) leżą **tylko tam**, w pliku `.env`. W launcherze, który pobierają gracze, nie ma
żadnego sekretu.

```
gracz ──► https://twojadomena.pl ──► Caddy (HTTPS) ──► bot + strona (port 8080) ──► Discord, Stripe
                                                           └── data/  (baza, zamówienia, instalatory launchera)
```

## Czego potrzebujesz
- **Serwer VPS** z Ubuntu 22.04 / 24.04 (wystarczy 1 vCPU, 1–2 GB RAM, 20 GB dysku) i dostęp po SSH.
- **Domena** z rekordem `A` wskazującym na adres IP serwera (np. `hammershop.pl` i `www`).
- Konto **Stripe** i aplikacja bota w **Discord Developer Portal** (ta sama, której token masz w `.env`).

## 1. Przygotuj serwer
```bash
sudo apt update && sudo apt install -y curl git ufw
```
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```
```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw --force enable
```
Zapora wpuszcza tylko SSH i stronę (80/443). Port bota (8080) zostaje zamknięty – z internetu widać go wyłącznie przez Caddy.

## 2. Wgraj pliki
```bash
sudo useradd --system --create-home --home-dir /opt/hammershop --shell /usr/sbin/nologin hammershop
```
Skopiuj folder `hammershop-bot` do `/opt/hammershop/hammershop-bot` (np. `git clone` swojego **prywatnego** repozytorium albo
SFTP), a potem:
```bash
cd /opt/hammershop/hammershop-bot && sudo chown -R hammershop:hammershop . && sudo -u hammershop mkdir -p data && sudo -u hammershop npm ci --omit=dev
```

## 3. Ustaw `.env`
```bash
sudo -u hammershop cp .env.example .env && sudo -u hammershop nano .env
```
Najważniejsze linie:

| Linia | Skąd ją wziąć |
|---|---|
| `DISCORD_TOKEN=` | Developer Portal → Twoja aplikacja → **Bot → Reset Token** |
| `GUILD_ID=` | ID Twojego serwera Discord |
| `OWNER_IDS=` | Twoje ID na Discordzie (pełny dostęp do panelu admina) – tylko zaufane osoby |
| `WEB_PORT=8080` | port, na którym działa strona (Caddy przekazuje na niego ruch) |
| `PUBLIC_URL=https://twojadomena.pl` | adres strony, bez ukośnika na końcu |
| `DISCORD_CLIENT_SECRET=` | Developer Portal → **OAuth2 → Client Secret**; w **Redirects** dodaj `https://twojadomena.pl/api/shop/auth/callback` |
| `STRIPE_SECRET_KEY=` | Stripe → **Developers → API keys → Secret key** (`sk_test_…` do prób, potem `sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET=` | Stripe → **Developers → Webhooks → Add endpoint** `https://twojadomena.pl/api/shop/stripe/webhook`, zdarzenia `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired` → **Signing secret** (`whsec_…`) |
| `HAMMER_PLUS_PRIVATE_KEY=` | linia z pliku z kluczem, który już masz – albo nowy: `npm run plus-key` |

```bash
sudo chmod 600 .env
```
Plik `.env` czyta tylko użytkownik `hammershop`. **Nigdy** nie wrzucaj go do repozytorium ani na Discorda.

## 4. Uruchom jako usługę
```bash
sudo cp deploy/hammershop.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable --now hammershop
```
```bash
journalctl -u hammershop -n 50
```
W logach zobaczysz link z zaproszeniem bota i `🌐 Strona na porcie 8080`. Usługa startuje sama po restarcie serwera i wstaje
po awarii.

## 5. HTTPS (Caddy)
```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list && sudo apt update && sudo apt install -y caddy
```
W pliku `deploy/Caddyfile` podmień `hammershop.pl` na swoją domenę, a potem:
```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy
```
Caddy sam wyrobi i odnowi certyfikat. Wejdź na `https://twojadomena.pl` – powinna otworzyć się strona sklepu.

> Używasz nginx zamiast Caddy? Ustaw `client_max_body_size 800m;` i `proxy_read_timeout 600s;` – inaczej wgrywanie instalatora w panelu się nie uda.

## 6. Zbuduj serwer Discord i sprawdź całość
1. Na Discordzie: `/zbuduj` (albo `/zbuduj tylko:update` na istniejącym serwerze – doda kanał **#launcher**).
2. `https://twojadomena.pl/admin` → **Zaloguj przez Discord**. Pulpit pokaże, czego jeszcze brakuje w `.env`.
3. **Hammer+ → Cennik**: dodaj plany i ceny. Kup jeden kartą testową Stripe `4242 4242 4242 4242` (z kluczem `sk_test_…`) – kod powinien pojawić się na stronie i na DM.
4. `/hammerplus klucz` pokaże klucz publiczny – musi być taki sam jak `plusPublicKey` w `launcher.config.json` launchera.

## 7. Podłącz launcher i wydaj pierwszą wersję
1. W `hammer-launcher/launcher.config.json` ustaw `"website": "https://twojadomena.pl"` (to stąd launcher bierze aktualności, komunikaty, aktualizacje i Hammer+), zatwierdź zmianę i poczekaj na GitHub Actions.
2. Pobierz artefakt **Hammer-Launcher-Windows**, zainstaluj i przetestuj u siebie.
3. `https://twojadomena.pl/admin` → **Wersje launchera** → wgraj `Hammer-Launcher-Setup-x.y.z.exe` → **Opublikuj wersję**.
4. Od teraz `https://twojadomena.pl/launcher` daje launcher do pobrania, a każda kolejna opublikowana wersja sama trafia do graczy.

## Kopie zapasowe
Wszystko, co ważne, jest w dwóch miejscach: **`.env`** i folder **`data/`** (baza bota, zamówienia, aktualności, instalatory).
```bash
sudo tar -czf /root/hammershop-$(date +%F).tar.gz -C /opt/hammershop/hammershop-bot .env data
```
Trzymaj kopię poza serwerem. Bot robi też własne kopie bazy na kanale **#kopie-zapasowe**.

## Aktualizacja bota
```bash
cd /opt/hammershop/hammershop-bot && sudo -u hammershop git pull && sudo -u hammershop npm ci --omit=dev && sudo systemctl restart hammershop
```
Folderu `data/` i pliku `.env` aktualizacja nie rusza. Po aktualizacji wpisz na Discordzie `/zbuduj tylko:update`.

## Bezpieczeństwo – krótka lista
- **Repozytorium prywatne.** Dopóki kod jest publiczny na GitHubie, każdy może go skopiować – ustaw repozytorium jako *Private* (Settings → General → Danger Zone → Change visibility).
- **Sekrety tylko na serwerze** (`.env`, uprawnienia 600). W launcherze są wyłącznie klucze publiczne – nie da się z niego wyciągnąć niczego, co pozwala wystawiać kody albo brać płatności.
- **Konto właściciela na Discordzie z 2FA.** Panel admina to logowanie Twoim kontem Discord – kto je przejmie, może publikować aktualizacje launchera.
- **Podpisuj wydania launchera** (`updatePublicKey` + `scripts/sign-release.js` w folderze launchera). Wtedy nawet po włamaniu na serwer nikt nie podmieni aktualizacji – klucz do podpisu masz tylko Ty, poza serwerem.
- **Certyfikat do podpisywania kodu Windows** (płatny, opcjonalny) usuwa ostrzeżenie SmartScreen przy instalacji.
- Aktualizuj system: `sudo apt update && sudo apt upgrade -y` raz na jakiś czas.

### Czy da się „zaszyfrować” launcher, żeby nikt go nie skopiował?
Uczciwie: **nie do końca – i nie trzeba.** Program, który działa na komputerze gracza, zawsze da się skopiować; tak jest z każdą
aplikacją. Dlatego zabezpieczenie jest zrobione tam, gdzie naprawdę działa:
- **Nic cennego nie ma w pliku `.exe`.** Token bota, klucze Stripe i klucz do kodów Hammer+ są tylko na serwerze.
- **Hammer+ nie da się podrobić**: kod jest podpisany kluczem prywatnym z serwera i przypisany do konta Minecraft. Chmura i peleryny są dodatkowo sprawdzane po stronie serwera.
- **Launcher jest utwardzony**: kod jest spakowany (asar) ze sprawdzaniem integralności, a furtki do uruchamiania w nim własnego kodu są wyłączone – zwykła podmiana plików nie działa.
- **Aktualizacje są sprawdzane** sumą sha512 i (po włączeniu) Twoim podpisem.
- **Kod źródłowy** chronisz, ustawiając repozytorium jako prywatne.
