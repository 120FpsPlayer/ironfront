# 🌙 NØX – all-in-one Discord bot

One bot that **builds your whole Discord server with a single command** and then **runs it**:
verification, a live shop with Buy buttons, discount codes, receipts and order proofs, tickets, vouches, giveaways,
sales stats, invite rewards, raid protection, AutoMod, logs, backups and more.
Purple theme, custom banners and custom emojis included. Everything is in English.

Type **`/build`**, click **Build**, wait about two minutes – done. 💜

---

## ✨ What you get

### 🏗️ `/build` – the whole server in one click
| | |
|---|---|
| 🎭 **18 roles** | Founder, Co-Founder, Manager, Administrator, Moderator, Support, Trial Support, Seller, Loyal Customer, Customer, Bots, Member, 3 notification roles + 3 separators – all in a purple palette with the right permissions |
| 📁 **9 categories, 32 channels** (31 with the shop status channel turned off) | Server stats · Welcome · Shop · Support · Community · Staff (with the staff voice room) · Logs · Tickets · Closed tickets |
| 🔐 **Permissions done right** | New people only see **#verify**, **#rules** and **#welcome** (read-only, so their welcome ping reaches them). Info channels are read-only, staff and log areas are private |
| 🖼️ **Custom banners** | 36 purple banners (1080×400) – every info channel starts with its own banner and a styled card |
| 😀 **Custom emojis** | 67 purple emojis (`:nox_cart:`, `:nox_check:`, `:nox_paypal:`…) – the bot uses them in all its messages |
| 🌙 **Branding** | Renames the server to **NØX**, sets the server icon (and banner on boosted servers) |
| 🌐 **Community mode** | Announcement channels, welcome screen, rules + updates channels |
| 🤖 **AutoMod** | Spam, mention raids, scam links ("free nitro"), Discord invites, slurs, scam names – alerts go to #automod-logs |

### 🛒 Selling
- **Live shop panel** in #shop – add products with `/product add`, they appear instantly with a **Buy** button.
  Prices typed as plain numbers get the currency automatically (`20` → **20€**).
- **Tabs and pages** – the shop shows **5 products per page** with ◀ ▶ buttons, and a **tab per category** (All · Games ·
  Accounts …; with more than 4 categories the tabs become a menu). Turning pages or switching tabs opens a private copy
  for that person, so browsing never changes the shop for anyone else. Give products a category with `/product edit category:`.
- **Product pictures** – attach an image to each product (`/product add image:`), it's shown next to the product.
- **Payments:** PaysafeCard, Crypto (BTC, ETH), PayPal and **Stripe** (card, Apple Pay, Google Pay) – edit them in `config.json`.
- **Payment card in every order** – right after the order the ticket shows **💳 Pay 24€** for the chosen method:
  - **PaysafeCard** – what to do, and an **Enter PIN** button (PIN + screenshot form).
  - **Crypto** – your **BTC / ETH wallet addresses** (`config.json` → the Crypto payment method → `"addresses"`) with
    the amount in coins at today's rate (e.g. *≈ 0.00040000 BTC*), and **I've paid** for the transaction ID or a screenshot.
  - **PayPal** – with PayPal keys in `.env` a **PayPal link that confirms itself** (like Stripe, below); without keys a
    **paypal.me** link with the amount filled in (`"paypalMe": "yourname"`), then **I've paid** with a screenshot.
- **PayPal payments that confirm themselves** – put your PayPal app's keys in `.env` (`PAYPAL_CLIENT_ID`,
  `PAYPAL_CLIENT_SECRET`): every PayPal order gets a **Pay 24€ with PayPal** link. When the customer has approved it,
  the bot **takes the money itself** within 30 seconds, sets the order to **Paid** and pings the seller. The money is only
  taken while the order still wants it – an order that was closed, paid another way or whose total changed is **never
  charged** (the customer gets a new link instead).
- **Stripe card payments** – put your Stripe key in `.env` (`STRIPE_SECRET_KEY`) and every order paid with Stripe gets a
  **Pay 24€** link in its ticket right away. Once the customer has paid, the bot sees it within 30 seconds, sets the
  order to **Paid**, tells the customer and pings the seller – nobody has to check anything by hand. No website or
  webhook needed, it works on any host. Links last 23 hours (then a **New payment link** button appears); a link stops
  working when the order is paid another way or the ticket is closed or deleted, so nobody pays twice – and a payment
  that still comes in is never lost: it's recorded and the team is told. The order is only set to Paid when the amount
  matches its total (otherwise staff are asked to check). Without a key Stripe is just a payment method in the list
  and the seller sends a link by hand.
- **Buy → order form → private ticket.** The form asks for the option, quantity, a **payment method** from a list and an
  optional **promo code** – the ticket shows the subtotal, the discount and the **total to pay**.
- **Options** – one product, several prices: `/product variants product:Netflix variants:"1 month = 5, 3 months = 12, 12 months = 40"`
  (up to 10, separated by `,` `;` or new lines – `none` removes them). The shop shows **from 5€** and every option,
  the order form asks which one, and the ticket, receipt, #proofs, `/sales` and the weekly report show it ("Netflix — 3 months").
- **Stock counter** – `/product stock product:Nitro count:12` (or `count:` on `/product add` / `/product edit`): the shop shows
  **12 left** / **Only 2 left**, every completed order counts it down, at 0 it's **Sold out** (with Notify me) and the team
  gets a note in #ticket-logs. Nobody can order more than is left. Setting only a status turns the counter off.
  "Only N left" starts at `shop.lowStockAt` (3).
- **Flash sales** – `/sale start product:Nitro percent:20 duration:2h` (30m, 2h, 1d, 1h30m – up to 7 days): the shop shows
  ~~20€~~ **16€** · −20% with a live countdown, orders get the sale price (promo codes come on top), it ends by itself
  (or `/sale stop`) and is announced in #restocks with the Restocks ping (`announce:false` to skip). `/sale list` shows
  what's on sale. Only for products whose price – or every option price – is a plain number (`20`, `19.99`, or with the
  shop currency like `20€`; `$20` in a € shop is refused).
- **Badges** – 🔥 **Bestseller** on the product with the most units sold (at least 3) and ⭐ **4.9** – the average vouch
  rating of a product (from 2 vouches). The shop updates after every completed order. Turn them off or change the limits
  in `config.json → badges`.
- **"I've paid"** – the order ticket has an **I've paid** button for the customer: they send their PaysafeCard PIN(s)
  (checked: 16 digits each), screenshots and/or a transaction ID. The seller handling the ticket (or the sellers, while
  nobody has claimed it) is pinged, the screenshots are kept in the ticket, and the log and the archived transcripts
  only show the last 4 digits of a PIN. A corrected PIN can be sent again after a minute – it only pings the team again after the Call support
  cooldown (`defaults.pingStaffCooldownMinutes`), or right away once a seller set the order back to Awaiting payment.
  Turn it off with `orders.paymentProofs`.
- **Order status** – ⚙️ Manage ticket → **Status: Paid / In progress / Awaiting payment**. The ticket shows the status
  (⏳ Awaiting payment → 📨 Payment sent → 💳 Paid → 🔧 In progress → ✅ Delivered) and the customer gets a short DM
  with a link to the ticket (`orders.statusDms`). "Order completed" = Delivered – the receipt says so.
- **My orders** – a button under the shop (on every page) shows each member, privately, their open orders with their
  status, total and a link to the ticket, and all their completed orders (10 per page, ◀ Newer / ▶ Older) with a
  receipt for each.
- **Discount codes** – `/promo create code:NOX10 percent:10` (or an amount off), with expiry, max uses, once per member,
  first order only.
- **Order completed** (ticket menu → confirm the amount paid) → the sale is recorded, the buyer gets a **receipt by DM**,
  the **Customer** role (after 5 orders **Loyal Customer**), and an anonymous **proof** is posted in #proofs.
- **Vouch reminder** – 24 hours after the order the customer gets a DM with a **Leave a vouch** button (only if they haven't vouched yet).
- **First-purchase code** – new members get a personal 5% code by DM after they verify.
- **Notify me** – sold-out products get a 🔔 button; when they're back in stock everyone who clicked gets a DM.
- **Open / closed** – the shop is open **10:00–20:00 every day** (Polish time): the status channel at the top shows
  `🟢┃ꜱʜᴏᴘ ᴏᴘᴇɴ` / `🔴┃ꜱʜᴏᴘ ᴄʟᴏꜱᴇᴅ`, and the shop and ticket panels say so. It switches by itself;
  `/shop open` · `/shop close` override it until `/shop auto`.
- **Restock pings** – new products and restocks are announced in #restocks and ping the Restocks role.
- **Payment methods, How to buy, FAQ** – ready-made cards, edit them in `config.json`.

### 📈 For you and your team
- **`/sales`** – revenue, orders, average order, top products, sellers, payment methods and discounts for today,
  7 days, 30 days or all time, compared with the period before. A **weekly report** is posted in #sales every Monday at 10:00.
- **`/customer view @user`** – orders, total spent, last orders, tickets, vouches, invites and **private staff notes**
  (`/customer note add`).
- **Automatic backups** – every 24 hours the bot posts a backup of its data in #backups (admins only); `/backup` makes one now.
- **Unclaimed ticket reminders** – while the shop is open, tickets nobody has claimed for 15 minutes are listed in
  #staff-chat (one message, with links, pinging the staff roles of those tickets), again every 60 minutes until someone
  claims them. Tickets from the night are reminded when the shop opens. `staffReminders` in `config.json`
  (`repeatMinutes: 0` = only once).

### 🛡️ Security & growth
- **Look-alike alerts** – someone joins as "supp0rt_nox" or copies a staff member's avatar? Staff get an alert in
  #automod-logs with **Ban / Kick / Timeout / Ignore** buttons.
- **`/lockdown`** – during a raid everyone except the team can't chat, react or use voice, new tickets, orders and vouches
  are paused (open tickets keep working) and invites are paused; `/unlock` puts every role and setting back exactly.
- **Invite tracking with rewards** – the bot knows who invited whom. An invite counts once the new member verifies and stays;
  at **5 / 15 / 30** invites the inviter gets a personal **10% / 15% / 20%** code by DM. `/invites stats` · `/invites top`.

### ⭐ Vouches
- **Leave a vouch** button with a star-rating form, or `/vouch` with an optional screenshot.
- The vouch panel is **sticky**: after every new vouch it jumps to the bottom of #vouches, so the
  **Leave a vouch** button is always the first thing people see (`"stickyPanel": false` turns this off).
- Live counter with the average rating and a rating breakdown, plus a cooldown against spam.

### 🎫 Tickets (full ticket system)
- 6 categories: **Purchase** (only through Buy in the shop), **Support, Claim a Reward, Report a User, Staff Application, Punishment Appeal**.
- Forms, claim/unclaim, priorities, move between categories, add people, canned replies (`/reply`), close requests,
  auto-close for inactive tickets (never for orders that are already paid or in progress), **"Call support"** button, blacklist.
- **HTML transcripts** that look like Discord, **DM to the author** with the transcript and a **1–5 ⭐ rating**.
- `/stats` – response times, ratings, staff leaderboard.

### ✅ Verification
- **Verify** button + a quick math question against bots + minimum account age (3 days by default).
- Every attempt is logged in #verify-logs. Existing members get the Member role automatically during `/build`.

### 🎉 Community
- **Giveaways** – Enter button, live entry count, automatic winner draw, reroll; entry requirements: a **required role**,
  **customers only** (`buyers_only:`) and **at least N invites** (`min_invites:` – only invited members who verified and
  are still here count); every requirement is checked again for the winners at the draw and on rerolls; winners claim
  through a ticket.
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

   *Optional – card payments:* `STRIPE_SECRET_KEY=sk_live_…` (Stripe Dashboard → **Developers → API keys → Secret key**;
   `sk_test_…` to try it with test cards first; a restricted key with **Checkout Sessions: Write** is enough).

   *Optional – PayPal:* `PAYPAL_CLIENT_ID=…` and `PAYPAL_CLIENT_SECRET=…` (<https://developer.paypal.com> → **Apps &
   Credentials** → **Live** → **Create App** → copy the Client ID and Secret; `PAYPAL_SANDBOX=true` with Sandbox keys to
   try it with test accounts first).

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
〔 📊 SERVER STATS 〕    🟢┃ꜱʜᴏᴘ ᴏᴘᴇɴ · 👥┃ᴍᴇᴍʙᴇʀꜱ: 123 · ⭐┃ᴠᴏᴜᴄʜᴇꜱ: 45      (everyone can see, nobody can join)
〔 👋 WELCOME 〕         ✅┃ᴠᴇʀɪꜰʏ · 📜┃ʀᴜʟᴇꜱ · 👋┃ᴡᴇʟᴄᴏᴍᴇ · 📌┃ɪɴꜰᴏʀᴍᴀᴛɪᴏɴ · 📢┃ᴀɴɴᴏᴜɴᴄᴇᴍᴇɴᴛꜱ
                        🎉┃ɢɪᴠᴇᴀᴡᴀʏꜱ · 🎭┃ʀᴏʟᴇꜱ
〔 🛒 SHOP 〕            🛒┃ꜱʜᴏᴘ · 📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ · 💳┃ᴘᴀʏᴍᴇɴᴛꜱ · ✨┃ʀᴇꜱᴛᴏᴄᴋꜱ · ⭐┃ᴠᴏᴜᴄʜᴇꜱ · 🧾┃ᴘʀᴏᴏꜰꜱ
〔 🎧 SUPPORT 〕         🎫┃ᴛɪᴄᴋᴇᴛꜱ · ❓┃ꜰᴀǫ
〔 💬 COMMUNITY 〕       💬┃ᴄʜᴀᴛ · 🏆┃ʟᴇᴀᴅᴇʀʙᴏᴀʀᴅ · 🚀┃ʙᴏᴏꜱᴛᴇʀꜱ
〔 🔒 STAFF 〕           💼┃ꜱᴛᴀꜰꜰ-ᴄʜᴀᴛ · 🔧┃ꜱᴛᴀꜰꜰ-ᴄᴏᴍᴍᴀɴᴅꜱ · 📣┃ᴅɪꜱᴄᴏʀᴅ-ᴜᴘᴅᴀᴛᴇꜱ · 🔒┃ꜱᴛᴀꜰꜰ ʀᴏᴏᴍ
〔 📁 LOGS 〕            📁┃ᴛɪᴄᴋᴇᴛ-ʟᴏɢꜱ · 📄┃ᴛʀᴀɴꜱᴄʀɪᴘᴛꜱ · ✅┃ᴠᴇʀɪꜰʏ-ʟᴏɢꜱ · 📋┃ꜱᴇʀᴠᴇʀ-ʟᴏɢꜱ · 🤖┃ᴀᴜᴛᴏᴍᴏᴅ-ʟᴏɢꜱ
                        📈┃ꜱᴀʟᴇꜱ · 💾┃ʙᴀᴄᴋᴜᴘꜱ                                  (admins only)
〔 🎫 TICKETS 〕 / 〔 🔐 CLOSED TICKETS 〕                        (ticket channels go here: 🛒┃ᴏʀᴅᴇʀ-0001)
```
Discord allows 50 channels per category: when 〔 🎫 TICKETS 〕 is full the bot opens **〔 🎫 TICKETS 2 〕** (3, …),
and 〔 🔐 CLOSED TICKETS 〕 keeps the newest 49 closed tickets (older ones are deleted – their transcripts stay in #transcripts).
Want different channels or roles? Edit `src/builder/layout.js` – it's one readable list.

**Who sees what**

| | Not verified | Member | Seller | Support | Moderator | Admin+ |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| #verify | ✅ | | | | | ✅ |
| #rules, server stats | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Shop, support, community | | ✅ | ✅ | ✅ | ✅ | ✅ |
| Write in #restocks | | | ✅ | | | ✅ |
| Staff chat, ticket logs, transcripts | | | ✅ | ✅ | ✅ | ✅ |
| Server, verify & AutoMod logs | | | | | ✅ | ✅ |
| #discord-updates, #sales, #backups | | | | | | ✅ |

---

## 📋 Commands

| Command | What it does | Who |
|---|---|---|
| `/build` | Build the whole server (Build / Wipe & Build) | Owner, admins |
| `/build only:update` | **After a bot update:** adds new channels & roles, applies the name style and updates every panel – nothing is deleted | Owner, admins |
| `/build only:emojis` | Upload the emojis that didn't fit yet (e.g. after boosting) | Owner, admins |
| `/build only:panels` | Update all banners & cards **in place** after editing `config.json` (vouches, giveaways and announcements are never touched) | Owner, admins |
| `/build only:names` | Rename all channels & categories to the name style from `config.json` (e.g. after an update) – nothing else changes | Owner, admins |
| `/product add / edit / stock / variants / remove / list` | Manage the shop (categories, images, options, stock counter) – the #shop panel updates by itself | Admins, sellers |
| `/sale start / stop / list` | Flash sales – a percentage off a product for a while, with a countdown in the shop | Admins, sellers |
| `/promo create / list / info / delete` | Discount codes | Admins, sellers |
| `/shop open / close / auto / status` | Open or close the shop by hand, or follow the opening hours again | Admins, sellers |
| `/sales` | Sales statistics | Admins, sellers |
| `/customer view / note add / note remove` | Customer profiles and private staff notes | Staff |
| `/lockdown` · `/unlock` | Lock the server during a raid and unlock it again | Moderators+ |
| `/backup` | Back up the bot data now (it also happens automatically) | Admins |
| `/invites stats / top` | Your invites, the next reward and the top inviters | Everyone |
| `/vouch` | Leave a review (with optional screenshot) | Everyone |
| `/giveaway start / end / reroll / list` | Giveaways (start: optional `required_role`, `buyers_only`, `min_invites`) | Moderators+ |
| `/announce` | Styled announcement with banner, button and ping | Moderators+ |
| `/ticket info / close` | Your ticket | Ticket author |
| `/ticket claim / unclaim / add / remove / priority / move / rename / request-close / complete` | Handle tickets (`complete amount:` = what the customer paid) | Staff |
| `/reply` | Canned replies | Staff |
| `/blacklist add / remove / list` | Block people from tickets | Staff |
| `/stats` | Ticket statistics and staff leaderboard | Staff |
| `/panel` | Re-send a panel (tickets, shop, vouches, leaderboard, verification, roles) | Admins |
| `/setup show / set / role-add / role-remove` | Ticket settings (all set automatically by `/build`) | Admins |
| `/help` | The commands *you* can use | Everyone |

Admin commands are hidden from normal members automatically.

---

## 🛍️ How an order works

1. A customer clicks **Buy** next to a product in #shop – that's the only way to buy. The **Purchase** entry in the ticket
   panel, *How to buy* and *Payments* all send people to #shop (`"shopOnly": true` on the `order` ticket type).
2. They choose the option, quantity, a payment method and (optionally) a promo code → a **private ticket** opens with the
   total to pay (with the flash sale price, if one is running). Sellers and support are pinged. Outside the opening hours
   the ticket says when you're back. Nobody claims it within 15 minutes? The team is reminded in #staff-chat.
3. A seller claims it and sends the payment details (tip: `/reply` → *Order quote*, *Payment received*, *Delivered*).
   The customer pays and clicks **I've paid** (PIN / screenshot / transaction ID) – the seller is pinged, checks it and sets
   **⚙️ → Status: Paid**, later **Status: In progress**; the customer gets a DM for each step.
4. After delivery the seller picks **⚙️ Manage ticket → Order completed** and confirms the amount paid:
   the sale is recorded for `/sales`, the stock counter goes down, the customer gets a **receipt by DM** (✅ Delivered),
   the **Customer** role (and **Loyal Customer** after 5 orders) and a **Leave a vouch** button, and an anonymous proof
   appears in #proofs. The order and its receipt stay in the customer's **My orders**.
5. The ticket is closed – the customer gets the transcript and a rating request by DM, the transcript is saved in #transcripts.
6. 24 hours later the customer gets a friendly vouch reminder (unless they already left one).

---

## 🎨 Customizing – `config.json`

| Section | What you can change |
|---|---|
| `brand` | Name, color, footer, tagline and the "About us" text |
| `server` | Rename the server, set icon/banner, **which logo to use** (`logo`: `eclipse-nox`, `eclipse`, `eclipse-wordmark`, `night` or `neon`), Community mode, verification level, server language (`locale`: a Discord language such as `en-US`, `de`, `pl`, `sv-SE`), **name style** (see below) |
| `emojis` | Upload custom emojis, emoji name prefix |
| `verification` | Math question on/off, minimum account age in days |
| `shop` | Currency, delivery time, support hours (written from `workingHours` unless you set `supportHours`), refund policy, orders needed for Loyal Customer, **payment methods**, `lowStockAt` (a stock counter at or below this shows "🟠 Only N left", default 3) |
| `vouches` | Sticky panel, cooldown, "customers only", minimum review length |
| `orders` | Receipts by DM, #proofs posts, vouch reminder after N hours (`0` = off), order status DMs (`statusDms`), the **I've paid** button (`paymentProofs`) |
| `stripe` | Automatic Stripe payment links on/off (`enabled`) and their currency (`currency`, empty = from `shop.currency`) – needs `STRIPE_SECRET_KEY` in `.env` |
| `paypal` | Automatic PayPal payment links on/off (`enabled`) and their currency (`currency`, empty = from `shop.currency`) – needs `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` in `.env` |
| `badges` | 🔥 Bestseller and ⭐ rating in the shop on/off (`enabled`), units sold for Bestseller (`bestsellerMinSales`, 3), vouches needed for a rating (`ratingMinVouches`, 2) |
| `staffReminders` | Unclaimed ticket reminders on/off, after how many minutes (`unclaimedMinutes`, 15) and how often again (`repeatMinutes`, 60 – `0` = once) |
| `promos`, `welcomeDiscount` | Discount codes on/off; the first-purchase code (percent, days valid) |
| `workingHours`, `shopStatus` | Opening hours (default **10:00–20:00 every day, Europe/Warsaw**); the open/closed status channel on/off (`enabled`) and its names |
| `invites` | Invite tracking on/off and the rewards (`{ "invites": 5, "percent": 10 }` …) |
| `security` | Look-alike alerts, whether `/lockdown` pauses invites |
| `backups`, `salesReport` | How often to back up; the weekday and hour of the weekly sales report |
| `panel`, `ticketTypes`, `snippets`, `defaults` | Ticket panel texts, ticket categories and their questions, canned replies, limits and auto-close |

After editing:
```bash
npm run check          # validates config.json against Discord's limits
```
then **restart the bot** and run **`/build only:panels`** – every banner and card is updated in place
(nothing moves, and your vouches, giveaways and announcements are never touched).

**Payment methods** – each entry has a `name`, `details`, an `emoji`
(`paysafecard`, `crypto`, `paypal`, `card`, `wallet`, `blik`, `coin`, `currency_eur`…) and a `type` – `paysafecard`,
`crypto`, `paypal` or `stripe` – that decides the payment card in the ticket. The default is PaysafeCard, Crypto (BTC, ETH),
PayPal and Stripe. **Fill in your wallets** in the Crypto entry: `"addresses": { "BTC": "bc1…", "ETH": "0x…" }` (LTC, SOL,
USDT, USDC, XMR, DOGE, TRX and BNB work too – the amount in coins is shown for them). The PayPal entry takes
`"paypalMe": "yourname"` for the paypal.me link when there are no PayPal keys. The `stripe` entry gets the automatic card
payment links (only with `STRIPE_SECRET_KEY` in `.env`); `stripe.currency` sets the Stripe currency (`eur`, `usd`, `pln`… – empty =
from `shop.currency`: € → eur, $ → usd, £ → gbp, zł → pln; for `kr` and other unclear signs set it, otherwise no
links are made), `stripe.enabled: false` turns the links off.

**Name style** – `server.channelStyle` (default `{emoji}┃{name}`), `server.categoryStyle` (default `〔 {name} 〕`)
and `server.smallCaps` (`true` → `📦┃ʜᴏᴡ-ᴛᴏ-ʙᴜʏ`, `false` → `📦┃how-to-buy`). Ticket channels follow `channelNameFormat`
(default `{prio}{emoji}┃{prefix}-{number}` → `🛒┃ᴏʀᴅᴇʀ-0001`). The names themselves are in `src/builder/layout.js`.
After changing the style, restart the bot and run **`/build only:names`**.

### Updating the bot
Replace the bot files (keep **`.env`** and the **`data/`** folder), run `npm install`, restart the bot and run
**`/build only:update`** once – it adds the channels and roles that are new in this version (e.g. 🧾┃ᴘʀᴏᴏꜰꜱ,
📈┃ꜱᴀʟᴇꜱ, 💾┃ʙᴀᴄᴋᴜᴘꜱ and the shop status channel), **removes the ones the bot made earlier that are no longer part
of the server** (e.g. the VIP lounge, the voice channels, #memes – never channels or roles you made yourself),
applies the name style and updates every panel. Run it in a channel that stays (e.g. #staff-commands).
If you changed `config.json` yourself you can keep your copy: sections it doesn't have yet get the default values,
and the console lists every feature that is turned off in it.

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
| No PayPal link in PayPal orders | `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` missing or wrong (the console says *"refused by PayPal"*; Sandbox keys need `PAYPAL_SANDBOX=true`), or the currency isn't taken by PayPal – set `paypal.currency`. The card shows the paypal.me link instead |
| No Stripe link in Stripe orders | `STRIPE_SECRET_KEY` missing or wrong in `.env` (the console says *"STRIPE_SECRET_KEY was refused"*), or the order has no fixed price (e.g. `from 5€`) – a seller sends a link by hand then. Restart the bot after editing `.env` |
| Commands don't show up | Set `GUILD_ID` in `.env` and restart. Also check the invite had `applications.commands` (the console link does) |
| "I need the Administrator permission" | Server Settings → Roles → the bot's role → enable **Administrator** |
| Some roles weren't removed by Wipe & Build | They are above the bot's role – drag the bot's role to the top and run it again |
| Only 50 emojis were uploaded | Servers without boosts have 50 emoji slots. Boost the server and run `/build only:emojis` |
| "Discord limits how fast emojis can be uploaded" | Wait an hour, then run `/build only:emojis` |
| Community mode wasn't enabled | Discord refused it for this server. Everything else still works (announcement channels are normal read-only channels). You can turn it on later under Server Settings → Enable Community |
| A custom emoji was deleted | Nothing breaks – the bot switches to a normal emoji. Run `/build only:emojis` to upload it again |
| "Discord only allows renaming a channel twice per 10 minutes" | That's Discord's limit – wait the minutes it says and try again |
| `⏳ A click (…) expired before the bot could answer` or `Unknown interaction (10062)` | Discord gives the bot 3 seconds to answer. It happens when someone clicks while the bot is starting or the host is very slow – they just click again. If it happens all the time: use Node.js 20 or newer and a faster plan / a host region in the EU or US |
| `… was already answered by another bot process` | The bot is running twice with the same token (e.g. on your PC and on the host) – stop one of them |
| `ExperimentalWarning: buffer.File is an experimental feature` | Harmless – it's printed by Node.js 18. Pick Node.js 20 or 22 on your host to get rid of it (and for a faster bot) |
| Buttons say "This interaction failed" | The bot must be **online** – buttons are handled live by the bot |
| Transcripts are empty | Turn on **Message Content Intent** |
| The new channels (#proofs, #sales, #backups, shop status) are missing | Run `/build only:update` (the shop status channel only exists while `shopStatus.enabled` is `true`) |
| "The image is too big" | Product images can be up to 1 MB – save it as JPG or WEBP |
| Invites aren't counted | The bot needs to see the server's invites – it has Administrator, so check its role wasn't changed. Invites only count after the new member verifies |

💾 **Backup:** everything (tickets, products, sales, promo codes, vouches, giveaways) lives in `data/db.json`, product images in
`data/products/`. The bot also posts an automatic backup in #backups – to restore one, unzip it, rename it to `db.json`
and put it in `data/` while the bot is stopped.

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
├── features/                verification, shop, catalog, orders, promo codes, shop status, vouches, giveaways, roles,
│                            announcements, welcome/logs, stats, sales report, backups, customer profiles,
│                            Notify me, invites, lockdown, look-alike alerts, housekeeping, flash sales, badges,
│                            I've paid, order status, My orders, staff reminders, payment cards, Stripe, PayPal
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
291 tests run against a simulated Discord server that enforces Discord's real limits (names, 40 components / 4000
characters per card, emoji slots, permissions, AutoMod rules, Community mode): a full build, wipe & build,
every permission, the shop → ticket → order → vouch flow, options, stock counter, flash sales, badges, I've paid,
order status DMs, My orders, staff reminders, payment cards, Stripe and PayPal payment links, giveaway requirements, promo code limits (also for orders placed at the same moment),
opening hours across summer/winter time, lockdown, invite rewards, in-place panel updates, verification, giveaways, ratings and more.

---

Credits: icons by [Font Awesome](https://fontawesome.com) (CC BY 4.0), font [Montserrat](https://fonts.google.com/specimen/Montserrat) (OFL).
The ticket system and server builder are based on the *Ticket Bot* and *Kreator Serwera* projects, translated to English and rebuilt for NØX.
