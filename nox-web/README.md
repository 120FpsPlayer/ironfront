# NØX website

The NØX store page (your design, unchanged) with a real server behind it:

- **Continue with Discord**: sign-in with Discord (scope `identify`, only the public profile).
- **NØX Access**: a one-time access pass paid with **Stripe**. The store unlocks after the payment is confirmed.
- **Bag → Checkout**: products are paid with Stripe Checkout. Prices always come from `products.json` on the server, never from the browser.
- **My orders**: pending, paid and expired orders. Paid products show their delivery text.
- **Team notice**: every paid order is posted to a Discord channel through a webhook, so you know what to deliver.

Until Discord **and** Stripe are both set up, the page shows its own clearly marked **offline preview** (demo account, no payments). Opening `public/index.html` straight from disk also shows the preview.

## Start

You need Node.js 18 or newer. There is nothing to install with npm.

```bash
cp .env.example .env      # then fill it in (see below)
npm start                 # → http://localhost:3000
```

## Settings (`.env`)

| Key | What it is |
|---|---|
| `PUBLIC_URL` | The address people open, e.g. `https://nox.example.com`. Must be **https** for real payments. |
| `PORT` | The port the server listens on (default 3000). |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | From discord.com/developers → your app → **OAuth2**. Under **Redirects**, add `https://your-domain/api/nox/auth/callback`. |
| `DISCORD_INVITE_URL` | Your server invite, used by the Support and "Meet the community" buttons. Use one that never expires. |
| `DISCORD_ORDER_WEBHOOK_URL` | Optional. A channel webhook (Channel settings → Integrations → Webhooks). Every paid order is posted there. |
| `STRIPE_SECRET_KEY` | From dashboard.stripe.com → Developers → API keys. Use `sk_test_…` to test and `sk_live_…` for real money. |
| `STRIPE_WEBHOOK_SECRET` | Recommended. Go to Developers → Webhooks → add the endpoint `https://your-domain/api/nox/stripe/webhook` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. Then copy the `whsec_…` secret. |
| `ACCESS_PRICE` | The NØX Access price in euros (default `9.90`). `0` makes access free, so signing in is enough. |
| `CURRENCY` | `eur` by default. |

Without the Stripe webhook, payments are still confirmed when the buyer comes back from Stripe, or when they click **Refresh payment status** in My orders. The webhook also catches buyers who close the tab.

## Products (`products.json`)

```json
{ "id": "games", "name": "The Game Collection", "category": "Games", "description": "…",
  "price": 9.90, "art": "games", "published": true,
  "delivery": "Text the buyer sees in My orders once it's paid" }
```

- `art` picks the card picture: `games`, `bundle`, `bot` or `server`.
- `"published": false` hides a product.
- Changes are picked up without a restart.

## Hosting

The page needs this server running. A ChatGPT preview link can't run it. Use any host that runs Node, for example a VPS, Railway, Render or the same machine as the bot. Put it behind HTTPS, for example with Caddy, nginx or the host's built-in HTTPS, and set `PUBLIC_URL` to that https address.

Orders, sessions and accounts are kept in `data/store.json`. Back that file up.

## Changing the design

Export the new design from ChatGPT as one HTML file, then run:

```bash
node tools/build-html.js path/to/NOX_website.html
```

This writes `public/index.html` and `public/assets/`. It moves the embedded images to files, connects the page to this server and adds the layout fixes for phones.

## Tests

```bash
npm test
```

The tests use fake Discord and Stripe servers. `test/ui.test.js` clicks through the real page in Chromium (sign in → access → bag → checkout → My orders) when Playwright is installed, and skips otherwise.
