# 🌙 NØX – all-in-one Discord bot

One bot that **builds your whole Discord server with a single command** and then **runs it**:
verification, a live shop with Buy buttons, tickets, vouches, giveaways, AutoMod, logs, stats and more.
Purple theme, custom banners and custom emojis included. Everything is in English.

Type **`/build`**, click **Build**, wait about two minutes – done. 💜

---

## ✨ What you get

### 🏗️ `/build` – the whole server in one click
| | |
|---|---|
| 🎭 **20 roles** | Founder, Co-Founder, Manager, Administrator, Moderator, Support, Trial Support, Seller, VIP, Partner, Loyal Customer, Customer, Bots, Member, 3 notification roles + 3 separators – all in a purple palette with the right permissions |
| 📁 **11 categories, 39 channels** | Server stats · Welcome · Shop · Support · Community · VIP Lounge · Voice · Staff · Logs · Tickets · Closed tickets |
| 🔐 **Permissions done right** | New people only see **#verify**, **#rules** and **#welcome** (read-only, so their welcome ping reaches them). Info channels are read-only, staff/log/VIP areas are private, media channels allow files, AFK is muted |
| 🖼️ **Custom banners** | 35 purple banners (1080×400) – every info channel starts with its own banner and a styled card |
| 😀 **Custom emojis** | 67 purple emojis (`:nox_cart:`, `:nox_check:`, `:nox_paypal:`…) – the bot uses them in all its messages |
| 🌙 **Branding** | Renames the server to **NØX**, sets the server icon (and banner on boosted servers) |
| 🌐 **Community mode** | Announcement channels, welcome screen, rules + updates channels |
| 🤖 **AutoMod** | Spam, mention raids, scam links ("free nitro"), Discord invites, slurs, scam names – alerts go to #automod-logs |

### 🛒 Selling
- **Live shop panel** in #shop – add products with `/product add`, they appear instantly with a **Buy** button.
  Prices typed as plain numbers get the currency automatically (`20` → **20€**).
- **Payments:** PaysafeCard, Crypto (BTC, ETH) and PayPal – edit them in `config.json`.
- **Buy → order form → private ticket.** The form asks for quantity and lets the buyer **pick a payment method from a list**.
- **Order completed** (one click in the ticket menu) → the buyer gets the **Customer** role automatically, after 5 orders **Loyal Customer**, and is asked for a vouch.
- **Restock pings** – new products and restocks are announced in #restocks and ping the Restocks role.
- **Payment methods, How to buy, FAQ** – ready-made cards, edit them in `config.json`.

### ⭐ Vouches
- **Leave a vouch** button with a star-rating form, or `/vouch` with an optional screenshot.
- The vouch panel is **sticky**: after every new vouch it jumps to the bottom of #vouches, so the
  **Leave a vouch** button is always the first thing people see (`"stickyPanel": false` turns this off).
- Live counter with the average rating and a rating breakdown, plus a cooldown against spam.

### 🎫 Tickets (full ticket system)
- 7 categories: **Purchase, Support, Claim a Reward, Partnership, Report a User, Staff Application, Punishment Appeal**.
- Forms, claim/unclaim, priorities, move between categories, add people, canned replies (`/reply`), close requests,
  auto-close for inactive tickets, **"Call support"** button, blacklist.
- **HTML transcripts** that look like Discord, **DM to the author** with the transcript and a **1–5 ⭐ rating**.
- `/stats` – response times, ratings, staff leaderboard.

### ✅ Verification
- **Verify** button + a quick math question against bots + minimum account age (3 days by default).
- Every attempt is logged in #verify-logs. Existing members get the Member role automatically during `/build`.

### 🎉 Community
- **Giveaways** – Enter button, live entry count, automatic winner draw, reroll, required role; winners claim through a ticket.
- **Notification roles** in #roles (Announcements / Giveaways / Restocks).
- **`/announce`** – a form that posts a styled announcement with a banner, an optional button and a ping.
- **Welcome cards** in #welcome, **logs** for joins, leaves, deleted and edited messages.
- **Stats channels** (👥 Members / ⭐ Vouches) and a **leaderboard** of the most active chatters (weekly + all time).

---

## 🚀 Setup (10 minutes)

### 1. Create the bot
1. Go to <https://discord.com/developers/applications> → **New Application** → name it **NØX**.
2. **Bot** tab → **Reset Token** → copy the token (you only see it once – never share it!).
3. Still on the **Bot** tab, under *Privileged Gateway Intents* turn **ON**:
   - ✅ **Server Members Intent** (welcome messages, logs, giving roles)
   - ✅ **Message Content Intent** (transcripts, logs, leaderboard)
4. *Optional:* upload `assets/brand/logo-eclipse-nox.png` as the bot's avatar.

### 2. Configure
1. Copy **`.env.example`** to **`.env`**.
2. Fill in:
   ```env
   DISCORD_TOKEN=your_bot_token
   GUILD_ID=your_server_id
   ```
   > 💡 To copy an ID: Discord → Settings → Advanced → **Developer Mode** on. Then right-click your server → **Copy Server ID**.
   > With `GUILD_ID` set, the slash commands appear instantly.

### 3. Start
You need **Node.js 18.17 or newer** (<https://nodejs.org>).
```bash
npm install
npm start
```
The console prints an **invite link** – open it and add the bot to your server (it asks for **Administrator**, which `/build` needs).

**On a host (Wispbyte, Pterodactyl, …):** upload the files so that `index.js` and `package.json` are in the main folder,
create `.env` there, set the **startup file to `index.js`** and press Start. Dependencies install themselves on the first start.

### 4. Build the server
1. **Server Settings → Roles:** drag the bot's role to the **very top**.
2. Type **`/build`** and click:
   - **Build** – adds everything next to your current channels, or
   - **Wipe & Build** – deletes all channels, roles and AutoMod rules first, then builds a clean NØX server
     (server owner only, you have to type the server name to confirm).
3. Watch the progress bar. When it says **NØX is ready!** you're live. 🎉

### 5. Start selling
```
/product add name:GTA V price:20 description:Instant delivery, full warranty. emoji:💎
```
The price shows as **20€** in the shop.
Give your team their roles (Manager, Support, Seller…) and you're good to go.

---

## 🗺️ What /build creates

```
📊 SERVER STATS      👥 Members: 123 · ⭐ Vouches: 45                        (everyone can see, nobody can join)
✦ WELCOME ✦          ✅┃verify · 📜┃rules · 👋┃welcome · 📌┃information · 📢┃announcements
                     🎉┃giveaways · 🎭┃roles · 🤝┃partners
✦ SHOP ✦             🛒┃shop · 📦┃how-to-buy · 💳┃payments · ✨┃restocks · ⭐┃vouches
✦ SUPPORT ✦          🎫┃tickets · ❓┃faq
✦ COMMUNITY ✦        💬┃chat · 📸┃media · 😂┃memes · 🤖┃commands · 🏆┃leaderboard · 🚀┃boosters
✦ VIP LOUNGE ✦       💎┃vip-chat · 💎┃VIP Lounge                            (VIP, partners, loyal customers, boosters, staff)
✦ VOICE ✦            🔊┃Lounge · 🎮┃Gaming · 🎵┃Music · 👥┃Duo · 💤┃AFK
✦ STAFF ✦            🛡️┃staff-chat · ⚙️┃staff-commands · 📣┃discord-updates · 🛡️┃Staff Room
✦ LOGS ✦             📁┃ticket-logs · 📄┃transcripts · ✅┃verify-logs · 🗂️┃server-logs · 🤖┃automod-logs
🎫 TICKETS / 📁 CLOSED TICKETS                                                 (ticket channels go here)
```
Discord allows 50 channels per category: when 🎫 TICKETS is full the bot opens **🎫 TICKETS 2** (3, …),
and 📁 CLOSED TICKETS keeps the newest 49 closed tickets (older ones are deleted – their transcripts stay in #transcripts).
Want different channels or roles? Edit `src/builder/layout.js` – it's one readable list.

**Who sees what**

| | Not verified | Member | Seller | Support | Moderator | Admin+ |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| #verify | ✅ | | | | | ✅ |
| #rules, server stats | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shop, support, community | | ✅ | ✅ | ✅ | ✅ | ✅ |
| VIP lounge | | VIP / partner / loyal / booster | ✅ | ✅ | ✅ | ✅ |
| Write in #restocks | | | ✅ | | | ✅ |
| Staff chat, ticket logs, transcripts | | | ✅ | ✅ | ✅ | ✅ |
| Server, verify & AutoMod logs | | | | | ✅ | ✅ |
| #discord-updates | | | | | | ✅ |

---

## 📋 Commands

| Command | What it does | Who |
|---|---|---|
| `/build` | Build the whole server (Build / Wipe & Build) | Owner, admins |
| `/build only:emojis` | Upload the emojis that didn't fit yet (e.g. after boosting) | Owner, admins |
| `/build only:panels` | Update all banners & cards **in place** after editing `config.json` (vouches, giveaways and announcements are never touched) | Owner, admins |
| `/product add / edit / stock / remove / list` | Manage the shop – the #shop panel updates by itself | Admins, sellers |
| `/vouch` | Leave a review (with optional screenshot) | Everyone |
| `/giveaway start / end / reroll / list` | Giveaways | Moderators+ |
| `/announce` | Styled announcement with banner, button and ping | Moderators+ |
| `/ticket info / close` | Your ticket | Ticket author |
| `/ticket claim / unclaim / add / remove / priority / move / rename / request-close / complete` | Handle tickets | Staff |
| `/reply` | Canned replies | Staff |
| `/blacklist add / remove / list` | Block people from tickets | Staff |
| `/stats` | Ticket statistics and staff leaderboard | Staff |
| `/panel` | Re-send a panel (tickets, shop, vouches, leaderboard, verification, roles) | Admins |
| `/setup show / set / role-add / role-remove` | Ticket settings (all set automatically by `/build`) | Admins |
| `/help` | The commands *you* can use | Everyone |

Admin commands are hidden from normal members automatically.

---

## 🛍️ How an order works

1. A customer clicks **Buy** in #shop (or opens a **Purchase** ticket).
2. They choose the quantity and a payment method → a **private ticket** opens. Sellers and support are pinged.
3. A seller claims it, sends the price and payment details (tip: `/reply` → *Order quote*, *Payment received*, *Delivered*).
4. After delivery the seller picks **⚙️ Manage ticket → Order completed**:
   the customer gets the **Customer** role (and **Loyal Customer** after 5 orders) and a **Leave a vouch** button.
5. The ticket is closed – the customer gets the transcript and a rating request by DM, the transcript is saved in #transcripts.

---

## 🎨 Customizing – `config.json`

| Section | What you can change |
|---|---|
| `brand` | Name, color, footer, tagline and the "About us" text |
| `server` | Rename the server, set icon/banner, **which logo to use** (`logo`: `eclipse-nox`, `eclipse`, `eclipse-wordmark`, `night` or `neon`), Community mode, verification level, AFK timeout, server language (`locale`: a Discord language such as `en-US`, `de`, `pl`, `sv-SE`) |
| `emojis` | Upload custom emojis, emoji name prefix |
| `verification` | Math question on/off, minimum account age in days |
| `shop` | Currency, delivery time, support hours, refund policy, orders needed for Loyal Customer, **payment methods** |
| `vouches` | Sticky panel, cooldown, "customers only", minimum review length |
| `panel`, `ticketTypes`, `snippets`, `defaults` | Ticket panel texts, ticket categories and their questions, canned replies, limits and auto-close |

After editing:
```bash
npm run check          # validates config.json against Discord's limits
```
then **restart the bot** and run **`/build only:panels`** – every banner and card is updated in place
(nothing moves, and your vouches, giveaways and announcements are never touched).

**Payment methods** – each entry has a `name`, `details` and an `emoji`
(`paysafecard`, `crypto`, `paypal`, `card`, `wallet`, `blik`, `coin`, `currency_eur`…). The default is PaysafeCard,
Crypto (BTC, ETH) and PayPal.

**Currency** – `shop.currency` (default `€`) and `shop.currencyPosition` (`after` → `20€`, `before` → `€20`).
Only plain-number prices get it; `from 5€` or `$10` are shown exactly as you typed them.

### The logo
There are five logos in `assets/brand/` (1024 × 1024) – pick one with `"logo"` in the `server` section of `config.json`:

| `eclipse-nox` (default) | `eclipse` | `eclipse-wordmark` | `night` | `neon` |
|---|---|---|---|---|
| NØX across a glowing eclipse | The Ø as an eclipse – no text | Eclipse + NØX name below | Crescent moon behind NØX | Bright purple tile, pops in the server list |

Already built? Just upload the logo yourself in Server Settings → Overview, or run `/build` on a fresh server.

### Your own art
All banners, emojis and the logo are generated by `tools/render-assets.js`. Change the colors in `THEME`,
add banners or emojis to the lists and run:
```bash
npm i -D playwright && npm run render-assets
```

---

## 🛠️ Troubleshooting

| Problem | Fix |
|---|---|
| `privileged intents are not enabled` | Developer Portal → Bot → turn on **Server Members Intent** and **Message Content Intent** → restart |
| `Invalid DISCORD_TOKEN` | Reset the token on the Bot tab and paste it into `.env` again |
| Commands don't show up | Set `GUILD_ID` in `.env` and restart. Also check the invite had `applications.commands` (the console link does) |
| "I need the Administrator permission" | Server Settings → Roles → the bot's role → enable **Administrator** |
| Some roles weren't removed by Wipe & Build | They are above the bot's role – drag the bot's role to the top and run it again |
| Only 50 emojis were uploaded | Servers without boosts have 50 emoji slots. Boost the server and run `/build only:emojis` |
| "Discord limits how fast emojis can be uploaded" | Wait an hour, then run `/build only:emojis` |
| Community mode wasn't enabled | Discord refused it for this server. Everything else still works (announcement channels are normal read-only channels). You can turn it on later under Server Settings → Enable Community |
| A custom emoji was deleted | Nothing breaks – the bot switches to a normal emoji. Run `/build only:emojis` to upload it again |
| "Discord only allows renaming a channel twice per 10 minutes" | That's Discord's limit – wait the minutes it says and try again |
| Buttons say "This interaction failed" | The bot must be **online** – buttons are handled live by the bot |
| Transcripts are empty | Turn on **Message Content Intent** |

💾 **Backup:** everything (tickets, products, vouches, giveaways) lives in `data/db.json` – copy that file.

---

## 🗂️ Files

```
index.js                     startup file (select it on your host)
.env                         your token & IDs (copy from .env.example)
config.json                  texts, payment methods, ticket categories, options
assets/                      banners, emojis, logo (see assets/CREDITS.md)
data/db.json                 the bot's data (created automatically)
src/
├── index.js                 Discord client, events, timers
├── builder/                 /build – layout, permissions, content, executor, emoji upload
├── features/                verification, shop, vouches, giveaways, roles, announcements, welcome/logs, stats
├── tickets/                 ticket system, cards, HTML transcripts
├── commands/                slash commands
├── handlers/interactions.js buttons, menus and forms
└── lib/                     config, database, theme, permissions, helpers
tools/render-assets.js       re-generates all images
test/                        tests with a simulated Discord server (npm test)
```

## 🧪 Tests
```bash
npm test
```
42 tests run against a simulated Discord server that enforces Discord's real limits (names, 40 components / 4000
characters per card, emoji slots, permissions, AutoMod rules, Community mode): a full build, wipe & build,
every permission, the shop → ticket → order → vouch flow, in-place panel updates, verification, giveaways, ratings and more.

---

Credits: icons by [Font Awesome](https://fontawesome.com) (CC BY 4.0), font [Montserrat](https://fonts.google.com/specimen/Montserrat) (OFL).
The ticket system and server builder are based on the *Ticket Bot* and *Kreator Serwera* projects, translated to English and rebuilt for NØX.
