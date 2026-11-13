'use strict';

/**
 * The store website, run by the bot – one program, one server (src/web/*, the page in web/public/).
 *
 * The bot starts it on WEB_PORT (or the port a hosting panel gives: SERVER_PORT / PORT) and keeps it in sync:
 *   - products   the website sells the bot's shop (the server in WEB_GUILD_ID / GUILD_ID, or the one server the bot
 *                is in): numeric prices, flash sales included, every option of a product as its own entry, sold-out
 *                products hidden, product pictures shown. /product add | edit | stock shows on the website at once.
 *   - sign-in    "Continue with Discord" uses the bot's own application (DISCORD_CLIENT_SECRET in .env). Signing in is
 *                all it takes to buy. Someone who isn't on the server yet is added right away (OAuth2 guilds.join) with
 *                the Member role – the same role verification gives – and a member without it gets it.
 *   - paid order the buyer's order ticket opens on Discord (paid with "Website", nothing to pay there), and the product
 *                is delivered right away when it has files or text (/product delivery) – in the ticket and by DM –
 *                exactly like a paid Discord order. Buyers who aren't on the server yet get it as soon as they join.
 *                Every payment is logged in the log channel.
 *   - invite     the Support / community buttons use DISCORD_INVITE_URL, or a permanent invite the bot makes itself.
 *   - launcher   Hammer Launcher reads the featured servers of the same server (/featured, src/features/featured.js) from
 *                /api/launcher/featured; Hammer+ cloud sync and capes are the website's own (src/web/launcher.js).
 *   - Hammer+    bought on the website's launcher page (Stripe): once paid, the code for the buyer's Minecraft account is
 *                issued here (like /hammerplus grant, added after a Hammer+ that is still running) and sent by DM; the
 *                order on the website shows it too.
 *   - admin      the admin panel (/admin, src/web/admin.js) asks the bot who may use it (the server's owner and
 *                OWNER_IDS – everything; the bot's admins – the rest), posts news and new launcher versions on Discord
 *                and writes every change to the log channel.
 *
 * Bot side: ticket.order.paidWith = 'website', order.web = { orderId, stripe }.
 * Website side (data/web.json): order.handedOver, ticketChannelId, ticketNumber, ticketUrl, waitingForMember, delivered,
 * delivery (the text in My orders and on the receipt).
 */

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { env } = require('../env');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const images = require('../lib/productImages');
const tickets = require('../tickets/tickets');
const webStore = require('../web/store');
const webAuth = require('../web/discord');
const { createWebServer, authReady, paymentsReady } = require('../web/server');
const { currencyCode, DECIMALS } = require('../lib/currency');
const { cartTitle } = require('../lib/orderItems');
const { COLORS } = require('../lib/theme');
const { logEmbed, money, pad, parseAmount, sendLog, truncate, ts } = require('../lib/utils');
const { notice, container, header, text, divider, linkBtn, row, v2, channelUrl } = require('../lib/v2');
const { e, ce } = require('../lib/theme');
const { isSafeSelfRole } = require('../lib/guards');
const permissions = require('../lib/permissions');
const plusLib = require('../lib/plus');
const { banner, hasBanner } = require('../lib/theme');
const { gallery } = require('../lib/v2');

const shop = () => require('./shop');
const delivery = () => require('./delivery');
const METHOD = 'Strona internetowa';
const TABS = ['Games', 'Discord Bots', 'Discord Servers']; // the page's filter tabs
let client = null;
let server = null;
const handing = new Set();

// ───────────── Which server, which products ─────────────
function guildOf() {
  if (!client) return null;
  const id = env.web.guildId || env.guildId;
  if (id) return client.guilds.cache.get(id) ?? null;
  const built = [...client.guilds.cache.values()].filter((g) => db.build(g.id));
  return (built.length ? built : [...client.guilds.cache.values()])[0] ?? null;
}

const currency = () => currencyCode() ?? 'eur';
const unit = () => 10 ** (DECIMALS[currency()] ?? 2);

/** The page's tabs are Games / Discord Bots / Discord Servers – the shop's categories are matched to them. */
function tabOf(p) {
  const raw = String(p.category ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
  const exact = TABS.find((t) => t.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const text = `${raw} ${p.name}`.toLowerCase();
  if (/\bbot[sy]?\b/.test(text)) return 'Discord Bots'; // bots, boty
  if (/\bservers?\b|\bserwer[y]?\b/.test(text)) return 'Discord Servers'; // serwery
  if (/game|gry|gra\b|steam|spiel/.test(text)) return 'Games';
  return raw || 'Other';
}
function artOf(p, tab) {
  if (tab === 'Discord Bots') return 'bot';
  if (tab === 'Discord Servers') return 'server';
  return /bundle|combo|pack/i.test(`${p.name} ${p.category ?? ''}`) ? 'bundle' : 'games';
}

/**
 * What the product card says about delivery: the delivery time picked in /product add | edit, or "Dostawa natychmiastowa"
 * when the product has files or text to send (a website order is paid by card, so it goes out right away).
 */
function etaOf(p) {
  const label = shop().DELIVERY_TIMES[p.deliveryTime];
  if (label) return { instant: p.deliveryTime === 'instant', eta: label.replace(/^[^\p{L}]+/u, '') };
  return require('./delivery').hasDelivery(p) ? { instant: true, eta: 'Dostawa natychmiastowa' } : { instant: false, eta: null };
}

/** The bot's shop as website products – prices in cents, every option its own entry. */
function catalog() {
  const guild = guildOf();
  if (!guild) return [];
  const s = shop();
  const out = [];
  for (const p of s.products(guild.id)) {
    if (p.stock === 'out') continue;
    const sale = s.activeSale(p);
    const cents = (raw) => {
      const n = parseAmount(raw);
      if (n == null) return null;
      return Math.round((sale ? s.salePrice(n, sale.percent) : n) * unit());
    };
    const tab = tabOf(p);
    const imagePath = images.file(p);
    const base = { category: tab, description: plain(p.description), art: artOf(p, tab), imagePath, productId: p.id, ...etaOf(p) };
    const variants = s.variantsOf(p);
    const entries = variants.length
      ? variants.map((v) => ({ ...base, id: `${p.id}~${v.id}`, name: plain(`${p.name} – ${v.name}`), price: cents(v.price), variant: v.name }))
      : [{ ...base, id: p.id, name: plain(p.name), price: cents(p.price), variant: null }];
    for (const e of entries) if (e.price > 0) out.push({ ...e, image: imagePath ? `/api/shop/image/${encodeURIComponent(e.id)}` : null });
  }
  return out;
}

/**
 * Shop texts are written for Discord: custom emojis (<:hs_wallet:123…>), **bold**, -# small text… The website can't
 * show Discord's custom emojis, so they are left out there (normal emojis like 🎮 stay) and the markdown is removed.
 */
function plain(text) {
  return String(text ?? '')
    .replace(/<a?:\w{1,32}:\d{15,25}>/g, '')
    .replace(/:\w{1,32}:/g, (m) => (/^:[a-z0-9_]+:$/i.test(m) && !/^:\d/.test(m) ? '' : m))
    .replace(/<(#|@&?|@!?)\d{15,25}>/g, '')
    .replace(/^\s*-#\s+/gm, '')
    .replace(/^\s*#{1,3}\s+/gm, '')
    .replace(/\*\*|__|~~|\|\||`/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}

/** The servers Hammer Launcher recommends – the /featured list of the server the website belongs to. */
function featuredServers() {
  const guild = guildOf();
  return guild ? require('./featured').publicList(guild.id) : [];
}

const inviteOf = () => env.web.invite || (guildOf() && db.guild(guildOf().id).webInvite?.url) || null;

/** A permanent invite for the website's Support / community buttons (once; DISCORD_INVITE_URL wins). */
async function ensureInvite(guild) {
  if (!guild || env.web.invite || db.guild(guild.id).webInvite?.url) return;
  const keys = ['rules', 'welcome', 'announcements', 'chat'];
  const candidates = [...keys.map((k) => guild.channels.cache.get(db.channelId(guild.id, k))), ...guild.channels.cache.values()].filter(
    (c) => c && c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite),
  );
  for (const channel of candidates) {
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: `Strona ${config.brand.name} – przycisk Pomoc / społeczność` }).catch(() => null);
    if (invite) {
      db.guild(guild.id).webInvite = { code: invite.code, url: `https://discord.gg/${invite.code}` };
      db.save();
      console.log(`🌐 Zaproszenie na Discorda dla strony i launchera: discord.gg/${invite.code}`);
      return;
    }
  }
}

/**
 * Whether Discord still takes an invite: false when it is gone or has run out (Discord answers 404 – "Unknown Invite"
 * or "Invite is expired"), or leads to another server; null when Discord could not be asked (no verdict).
 */
async function inviteWorks(guild, code) {
  try {
    const invite = await guild.client.fetchInvite(code);
    if (invite?.guild?.id && invite.guild.id !== guild.id) return false;
    if (invite?.expiresTimestamp && invite.expiresTimestamp <= Date.now()) return false;
    return true;
  } catch (err) {
    return err?.status === 404 || err?.code === 10006 || err?.code === 50270 ? false : null;
  }
}

const INVITE_CHECK_MS = 30 * 60_000;
let inviteChecked = 0;
let pauseWarned = false;
let ownInviteBroken = false; // DISCORD_INVITE_URL is not taken by Discord (shown in the admin panel too)

/**
 * Nobody can join right now: the server's invites are paused – Server settings → Invites → „Pause invites”, or a
 * security action (for up to a day). Every invite, however permanent, then answers „Invite is expired”.
 */
/** The invite from DISCORD_INVITE_URL was refused by Discord at the last check (and invites are not paused). */
const ownInviteFailing = () => ownInviteBroken && !invitesPaused();

function invitesPaused(guild = guildOf()) {
  if (!guild) return false;
  if (guild.features?.includes?.('INVITES_DISABLED')) return true;
  const until = guild.incidentsData?.invitesDisabledUntil;
  return Boolean(until && new Date(until).getTime() > Date.now());
}

/**
 * The invite the website and Hammer Launcher hand out must keep working. A channel deleted by a rebuild takes its
 * invites with it – and Discord says nothing about that – so the stored one is checked now and then and replaced
 * when Discord no longer takes it. DISCORD_INVITE_URL from .env is the owner's own and is never replaced.
 */
async function checkInvite(guild, { force = false } = {}) {
  if (!guild) return;
  if (!force && Date.now() - inviteChecked < INVITE_CHECK_MS) return;
  inviteChecked = Date.now();
  // Paused invites: a new invite would not work either – the owner has to resume them in Discord.
  if (invitesPaused(guild)) {
    if (!pauseWarned) console.warn(`🌐 Zaproszenia na serwer „${guild.name}” są WSTRZYMANE w Discordzie – nikt nie może dołączyć, a karta Discorda na stronie i w Hammer Launcherze nie działa. Wznów je: Ustawienia serwera → Zaproszenia → „Wznów zaproszenia” (albo menu serwera → Działania bezpieczeństwa).`);
    pauseWarned = true;
    return;
  }
  pauseWarned = false;
  if (env.web.invite) {
    const code = /([\w-]{2,64})\/?$/.exec(env.web.invite)?.[1];
    const works = code ? await inviteWorks(guild, code) : null;
    if (works !== null) ownInviteBroken = works === false;
    if (works === false) console.warn(`🌐 Zaproszenie z DISCORD_INVITE_URL (${env.web.invite}) nie działa – Discord mówi, że wygasło albo zostało usunięte. Wpisz w .env nowe, bezterminowe zaproszenie.`);
    return;
  }
  const stored = db.guild(guild.id).webInvite;
  if (stored?.code && (await inviteWorks(guild, stored.code)) === false) {
    console.warn(`🌐 Zaproszenie strony discord.gg/${stored.code} przestało działać – tworzę nowe.`);
    delete db.guild(guild.id).webInvite;
    db.save();
  }
  await ensureInvite(guild);
}

// ───────────── Sign-in → on the server, with the Member role ─────────────
/**
 * Website sign-in → the user is on the HammerShop Discord with the Member role. Not a member yet: the bot adds them with the
 * OAuth2 token (scope guilds.join) and the role in one step. Already a member without the role: it's given.
 * Returns { added, member } – never throws for Discord errors (banned, server full, missing permissions…).
 */
async function onLogin(user, accessToken) {
  const guild = guildOf();
  if (!guild || !user?.id) return { added: false, member: null };
  const role = require('./verification').memberRole(guild);
  const roleOk = role && isSafeSelfRole(role);
  let member = await guild.members.fetch(user.id).catch(() => null);
  if (member) {
    if (roleOk && !member.roles.cache.has(role.id)) {
      await member.roles.add(role, `Logowanie na stronie ${config.brand.name}`);
      await hooks.emit('verified', member);
    }
    return { added: false, member: true };
  }
  if (!accessToken) return { added: false, member: false };
  try {
    member = await guild.members.add(user.id, { accessToken, ...(roleOk && { roles: [role.id] }) });
  } catch (err) {
    console.warn(`[website] nie udało się dodać ${user.username ?? user.id} do serwera:`, err.message);
    return { added: false, member: false };
  }
  member ??= await guild.members.fetch(user.id).catch(() => null);
  if (!member) return { added: false, member: false };
  if (roleOk && !member.roles.cache.has(role.id)) await member.roles.add(role, `Logowanie na stronie ${config.brand.name}`).catch(() => null);
  await sendLog(guild, { embeds: [logEmbed(COLORS.success, '🌐 Dołączenie przez stronę', guild.client.user).setDescription(`<@${user.id}>${user.username ? ` (${user.username})` : ''} loguje się na stronie i trafia na serwer${roleOk ? ` z rolą ${role}` : ''}.`)] }).catch(() => null);
  if (roleOk) await hooks.emit('verified', member);
  return { added: true, member: true };
}

const isMember = (userId) => {
  const guild = guildOf();
  return guild ? guild.members.cache.has(userId) : null;
};

// ───────────── A paid website order → the bot ─────────────
/** The order the ticket holds, in the same shape as a cart / single order placed on Discord – already paid. */
function ticketOrder(order, guildId) {
  const now = Date.now();
  const items = order.items.map((i) => {
    const base = (i.productId && shop().findProduct(guildId, i.productId)?.name) || i.name;
    return { productId: i.productId ?? null, product: i.variant ? `${base} — ${i.variant}` : base, variant: i.variant ?? null, quantity: i.quantity, unitPrice: i.price / unit() };
  });
  const total = order.amount / unit();
  const paid = { method: METHOD, methodIndex: null, paidWith: 'website', status: 'paid', statusAt: now, statusBy: null, history: [{ status: 'paid', at: now, by: null }] };
  const web = { web: { orderId: order.id, stripe: order.stripe_id } };
  if (items.length === 1) {
    const [i] = items;
    return { productId: i.productId, product: i.product, ...(i.variant && { variant: i.variant }), unitPrice: i.unitPrice, quantity: i.quantity, promo: null, discount: 0, subtotal: total, total, ...paid, ...web };
  }
  return { productId: null, product: cartTitle(items), items, unitPrice: null, quantity: 1, promo: null, discount: 0, subtotal: total, total, ...paid, ...web };
}

function ticketAnswers(order) {
  const lines = order.items.map((i) => `${i.name} × ${i.quantity} — ${money((i.price * i.quantity) / unit())}`);
  return [
    { label: order.items.length > 1 ? 'Produkty' : 'Produkt', value: lines.join('\n') },
    { label: 'Metoda płatności', value: 'Strona internetowa – karta (Stripe)' },
    { label: 'Cena', value: `**Opłacone: ${money(order.amount / unit())}** ✅ · zamówienie ze strony \`${order.id}\`` },
  ];
}

const setDelivery = (order, patch) => webStore.updateOrder(order.id, patch);

/** The buyer's order confirmation by DM – the same order reference, items and total as the receipt on the website. */
function receiptDm(guild, order, ticket, channel) {
  const c = container(COLORS.success);
  const instant = delivery().deliverable(guild.id, ticket);
  const items = order.items.map((i) => `\`${i.quantity}×\` ${i.name} — **${money((i.price * i.quantity) / unit())}**`).join('\n');
  header(c, `## ${e(guild, 'check')} Zamówienie potwierdzone – dziękujemy!\nTwoja płatność na stronie **HammerShop** przeszła pomyślnie. Oto potwierdzenie zakupu:`, guild.iconURL?.({ size: 128 }));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(`${items}\n\n**Zapłacono razem: ${money(order.amount / unit())}** · karta (Stripe)\n-# Numer zamówienia \`${order.id}\` · ${ts(order.paidAt ?? Date.now(), 'f')}`),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(instant ? `📦 Twoje zamówienie czeka w tickecie **#${pad(ticket.number)}** – produkt od razu trafi tam i do tej wiadomości.` : `🎫 Twoje zamówienie czeka w tickecie **#${pad(ticket.number)}** – sprzedawca dostarczy je tam. Dostaniesz powiadomienie.`),
  );
  const buttons = [linkBtn(channelUrl(guild.id, channel.id), `Otwórz ticket #${pad(ticket.number)}`, ce(guild, 'ticket'))];
  if (env.web.publicUrl) buttons.push(linkBtn(`${env.web.publicUrl}/?view=orders`, 'Moje zamówienia', ce(guild, 'cart')));
  c.addActionRowComponents(row(...buttons));
  return v2(c);
}

/** Opens the buyer's (paid) order ticket – or waits until they join the server. Never throws. */
async function handOver(order) {
  if (order.kind !== 'products' || order.status !== 'paid' || order.handedOver || handing.has(order.id)) return;
  handing.add(order.id);
  try {
    const guild = guildOf();
    if (!guild) {
      setDelivery(order, { delivery: `Zespół HammerShop dostarczy Twoje zamówienie na Discordzie – zachowaj numer zamówienia ${order.id}.` });
      return;
    }
    const member = await guild.members.fetch(order.userId).catch(() => null);
    if (!member) {
      setDelivery(order, {
        waitingForMember: true,
        delivery: `Dołącz do serwera HammerShop na Discordzie z kontem, którym logujesz się na stronie – Twoje zamówienie otworzy się tam automatycznie (numer ${order.id}).`,
      });
      await sendLog(guild, { embeds: [logEmbed(COLORS.warning, '🌐 Zamówienie ze strony czeka', guild.client.user).setDescription(`Zamówienie \`${order.id}\` (${money(order.amount / unit())}) jest opłacone – <@${order.userId}> nie ma jeszcze na serwerze. Ticket otworzy się, gdy tylko dołączy.`)] }).catch(() => null);
      return;
    }
    let channel;
    try {
      channel = await tickets.openTicket(member, config.getType('order'), ticketAnswers(order), { order: ticketOrder(order, guild.id) }, { force: true });
    } catch (err) {
      console.warn(`[website] ticket dla ${order.id}:`, err.message);
      setDelivery(order, { delivery: `Zespół HammerShop skontaktuje się z Tobą na Discordzie, aby je dostarczyć (numer ${order.id}).` });
      await sendLog(guild, { embeds: [logEmbed(COLORS.danger ?? COLORS.warning, '🌐 Zamówienie ze strony – brak ticketu', guild.client.user).setDescription(`Zamówienie \`${order.id}\` od <@${order.userId}> jest **opłacone** (${money(order.amount / unit())}), ale nie udało się otworzyć ticketu: ${truncate(err.message, 300)}\nDostarcz je ręcznie.`)] }).catch(() => null);
      return;
    }
    const ticket = db.getTicket(channel.id);
    setDelivery(order, {
      handedOver: true,
      waitingForMember: false,
      ticketChannelId: channel.id,
      ticketNumber: pad(ticket.number),
      ticketUrl: `https://discord.com/channels/${guild.id}/${channel.id}`,
      delivery: `Twoje zamówienie czeka w tickecie #${pad(ticket.number)} na Discordzie HammerShop – sprzedawca dostarczy je tam.`,
    });
    await member.send(receiptDm(guild, webStore.getOrder(order.id) ?? order, ticket, channel)).catch(() => null);
    await hooks.emit('orderPlaced', { guild, channel, ticket, member });
  } finally {
    handing.delete(order.id);
  }
}

/** Website → bot: a paid order (once per order). */
async function onPaid(order) {
  const current = webStore.getOrder(order.id) ?? order;
  if (current.kind === 'plus') await deliverPlus(current);
  else await handOver(current);
}

// ───────────── Hammer+ bought on the website ─────────────
const DAY_MS = 86_400_000;
const plusPage = () => require('./launcherinfo').page();

/** The DM with the code: whose it is, how long it runs, where to type it in. */
function plusDm(guild, order, code, record) {
  const hp = require('./hammerplus');
  const c = container(COLORS.success);
  header(c, `## ${e(guild, 'check')} Hammer+ kupiony – dziękujemy!\nTwoja płatność na stronie **${config.brand.name}** przeszła pomyślnie. Oto Twój kod do **Hammer Launchera**:`, guild?.iconURL?.({ size: 128 }));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`\`\`\`\n${code}\n\`\`\``));
  c.addTextDisplayComponents(
    text(
      `**Konto Minecraft:** \`${record.nick}\` · **Ważny:** ${hp.validity(record.exp)}\n` +
        '**Jak go użyć:** otwórz Hammer Launcher → **Hammer+** → **„Mam kod”** → wklej kod. Działa tylko na tym koncie Minecraft.\n' +
        `-# Numer zamówienia \`${order.id}\` · zapłacono ${money(order.amount / unit())} · kartą (Stripe). Kod znajdziesz też na stronie launchera po zalogowaniu.`,
    ),
  );
  if (plusPage()) c.addActionRowComponents(row(linkBtn(plusPage(), 'Strona launchera', ce(guild, 'cart'))));
  return v2(c);
}

/**
 * A paid Hammer+ order → the code for the buyer's Minecraft account. Time is added after a Hammer+ that is still
 * running on that account. The order keeps what the code was signed from (never the code), so the website can show
 * it again. Never throws.
 */
async function deliverPlus(order) {
  if (order.kind !== 'plus' || order.status !== 'paid' || order.plus?.grantedAt || handing.has(order.id)) return;
  handing.add(order.id);
  try {
    const hp = require('./hammerplus');
    const guild = guildOf();
    const p = order.plus;
    const now = order.paidAt ?? Date.now();
    const until = guild ? hp.runningUntil(guild.id, p.mc, now) : null; // seconds | 0 (forever) | null
    const extra = until ? Math.ceil((until * 1000 - now) / DAY_MS) : 0;
    const days = p.days === 0 || until === 0 ? 0 : Math.min(hp.MAX_DAYS, p.days + extra);
    let granted;
    try {
      granted = guild
        ? hp.grantKnown(guild.id, { mc: p.mc, nick: p.nick, days, by: order.userId, now, source: 'website' })
        : (() => {
            const code = plusLib.issue({ mc: p.mc, days, now });
            return { code, record: { id: plusLib.verify(code, { now }).id, nick: p.nick, exp: days ? Math.floor(now / 1000) + days * 86_400 : 0 } };
          })();
    } catch (err) {
      console.warn(`[website] Hammer+ dla ${order.id}:`, err.message);
      setDelivery(order, { delivery: `Płatność przeszła – kod Hammer+ dla konta ${p.nick} wystawi zespół ${config.brand.name}. Napisz do nas na Discordzie i podaj numer zamówienia ${order.id}.` });
      if (guild) await sendLog(guild, { embeds: [logEmbed(COLORS.danger ?? COLORS.warning, '🌐 Hammer+ ze strony – brak kodu', guild.client.user).setDescription(`Zamówienie \`${order.id}\` od <@${order.userId}> jest **opłacone** (${money(order.amount / unit())}), ale kod dla \`${p.nick}\` nie został wystawiony: ${truncate(err.message, 300)}\nWystaw go ręcznie: \`/hammerplus nadaj nick:${p.nick} dni:${p.days}\`.`)] }).catch(() => null);
      return;
    }
    const { code, record } = granted;
    setDelivery(order, {
      plus: { ...p, grantDays: days, grantedAt: now, exp: record.exp, codeId: record.id }, // the website shows this same code again
      delivered: true,
      delivery: `Kod Hammer+ dla konta ${record.nick} jest gotowy – znajdziesz go na stronie launchera (sekcja Hammer+) i w wiadomości prywatnej na Discordzie. Wpisz go w Hammer Launcherze: Hammer+ → „Mam kod”.`,
    });
    const user = await client?.users?.fetch?.(order.userId).catch(() => null);
    const sent = await Promise.resolve()
      .then(() => user.send(plusDm(guild, order, code, record)))
      .then(() => true, () => false); // closed DMs, or not on the server: the website still shows the code
    if (guild) {
      await sendLog(guild, {
        embeds: [
          logEmbed(COLORS.success, '🌐 Hammer+ kupiony na stronie', guild.client.user).addFields(
            { name: 'Klient', value: `<@${order.userId}>`, inline: true },
            { name: 'Konto Minecraft', value: `\`${record.nick}\``, inline: true },
            { name: 'Ważny', value: hp.validity(record.exp), inline: true },
            { name: 'Kwota', value: money(order.amount / unit()), inline: true },
            { name: 'Zamówienie', value: `\`${order.id}\``, inline: true },
            { name: 'Kod na DM', value: sent ? 'wysłany' : 'nie doszedł (zamknięte DM) – klient widzi go na stronie', inline: true },
          ),
        ],
      }).catch(() => null);
    }
  } finally {
    handing.delete(order.id);
  }
}

// ───────────── The admin panel (/admin) ─────────────
const levels = new Map(); // userId → { level, at } – asked on every request, so remembered for a moment

/** Who is this on the panel: 'owner' (the server's owner, OWNER_IDS), 'admin' (the bot's admins) or null. */
async function panelLevel(userId) {
  if (!userId) return null;
  if (env.ownerIds.includes(userId)) return 'owner';
  const guild = guildOf();
  if (!guild) return null;
  const known = levels.get(userId);
  if (known && Date.now() - known.at < 30_000) return known.level;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  const level = !member ? null : permissions.isOwner(member) ? 'owner' : permissions.isAdmin(member) ? 'admin' : null;
  if (levels.size > 500) levels.clear();
  levels.set(userId, { level, at: Date.now() });
  return level;
}

/**
 * The channel a post about the launcher goes to. On the Hammer Launcher server new versions have #aktualizacje and
 * news #aktualności; on the shop server both go under the launcher's card (#launcher), or to the announcements.
 */
function launcherChannel(guild, kind = 'news') {
  for (const key of [kind === 'release' ? 'updates' : 'news', 'launcher', 'announcements']) {
    const channel = guild.channels.cache.get(db.channelId(guild.id, key));
    if (channel?.isTextBased?.()) return channel;
  }
  return null;
}

/**
 * The admin panel publishes on Discord too: a news item, or a new version of the launcher (with the opt-in
 * announcements ping). → { url } of the message, or null when there is nowhere to post.
 */
async function announce({ kind, title, body, url, image }) {
  const guild = guildOf();
  const channel = guild && launcherChannel(guild, kind);
  if (!channel) return null;
  const release = kind === 'release';
  const c = container(COLORS.brand);
  const files = [];
  const key = release ? 'updates' : 'whats-new';
  if (image) c.addMediaGalleryComponents(gallery(image));
  else if (hasBanner(key)) {
    const file = banner(key);
    files.push(file);
    c.addMediaGalleryComponents(gallery(`attachment://${file.name}`));
  }
  const lead = release ? 'Nowa wersja jest już do pobrania. Zainstalowany launcher zaktualizuje się sam.' : '';
  c.addTextDisplayComponents(text(truncate(`# ${release ? '🚀 ' : ''}${title}\n${[lead, body].filter(Boolean).join('\n\n')}`, 3800)));
  c.addSeparatorComponents(divider());
  const roleId = release ? db.roleId(guild.id, 'pingUpdates') ?? db.roleId(guild.id, 'pingAnnouncements') : null; // 🚀 Aktualizacje where the server has it
  c.addTextDisplayComponents(text(`-# 🔨 Hammer Launcher · ${config.brand.name}${roleId ? ` · <@&${roleId}>` : ''}`));
  const link = url || plusPage();
  if (link) c.addActionRowComponents(row(linkBtn(link, release ? 'Pobierz launcher' : 'Otwórz', '🔗')));
  const sent = await channel.send(v2(c, { mentions: roleId ? { roles: [roleId] } : { parse: [] }, files }));
  if (channel.type === ChannelType.GuildAnnouncement) await sent.crosspost().catch(() => null);
  return { url: sent.url };
}

/** What happened in the panel → the log channel. */
async function panelLog(textLine) {
  const guild = guildOf();
  if (guild) await sendLog(guild, { embeds: [logEmbed(COLORS.brand, '🌐 Panel admina', guild.client.user).setDescription(truncate(textLine, 1500))] }).catch(() => null);
}

const needGuild = () => {
  const guild = guildOf();
  if (!guild) throw Object.assign(new Error('Bot nie jest jeszcze na serwerze Discord.'), { status: 503 });
  return guild;
};

/** Hammer+ for the panel and the checkout – the same functions /hammerplus uses. */
const panelPlus = {
  lookup: (nick) => require('./hammerplus').lookup(nick),
  grant: ({ nick, days, by }) => require('./hammerplus').grant(needGuild().id, { nick, days, by }),
  recent: () => {
    const guild = guildOf();
    return guild ? require('./hammerplus').recent(guild.id, 50).map((r) => ({ id: r.id, nick: r.nick, exp: r.exp, by: r.by ?? null, at: r.at, source: r.source ?? null })) : [];
  },
  inspect: (code) => {
    const r = require('./hammerplus').inspect(needGuild().id, code);
    return { valid: r.valid, message: r.message, nick: r.record?.nick ?? null, mc: r.payload?.mc ?? null, exp: r.payload?.exp ?? null };
  },
  active: () => {
    const guild = guildOf();
    return guild ? require('./hammerplus').activeAccounts(guild.id) : 0;
  },
  /** The account (UUID, 32 hex digits) has Hammer+ running – it gets the H+ badge in the game's player list. */
  running: (mc) => {
    const guild = guildOf();
    return Boolean(guild) && require('./hammerplus').runningUntil(guild.id, mc) !== null;
  },
  /** When the account's Hammer+ ends: unix seconds, 0 = never, null = none running. */
  until: (mc) => {
    const guild = guildOf();
    return guild ? require('./hammerplus').runningUntil(guild.id, mc) : null;
  },
};

/** The featured servers for the panel – the same list /featured edits. */
const panelFeatured = {
  list: () => featuredServers(),
  add: (fields, by) => require('./featured').add(needGuild().id, { ...fields, addedBy: by }),
  remove: (id) => require('./featured').remove(needGuild().id, id),
};

/** The opened ticket: the "paid on the website" notice, then instant delivery – like an order paid with store balance. */
async function onOrderPlaced({ guild, channel, ticket }) {
  if (!channel || ticket?.order?.paidWith !== 'website') return;
  const delivery = require('./delivery');
  const autopay = require('./autopay');
  const order = ticket.order;
  const instant = delivery.deliverable(guild.id, ticket);
  const pings = instant ? { users: [], roles: [] } : autopay.pingsFor(guild, ticket);
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  const ask = instant ? ' 📦 Produkt zostanie dostarczony automatycznie.' : who ? ` ${who} – prosimy o dostawę.` : '';
  await channel.send(notice(COLORS.success, `🌐 **Opłacone na stronie – ${money(order.total)}** (karta, Stripe) za zamówienie \`#${pad(ticket.number)}\` · \`${order.web?.orderId ?? '—'}\`.${ask}`, { mentions: pings })).catch(() => null);
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '🌐 Opłacone na stronie', guild.client.user).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Klient', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Kwota', value: money(order.total), inline: true },
        { name: 'Stripe', value: `\`${truncate(order.web?.stripe ?? '—', 100)}\``, inline: true },
      ),
    ],
  }).catch(() => null);
  if (!instant) return;
  const done = await delivery.deliverPaid(channel, db.getTicket(channel.id), { amount: order.total }).catch((err) => {
    console.warn('[website] dostawa:', err.message);
    return false;
  });
  if (done && order.web?.orderId) {
    webStore.updateOrder(order.web.orderId, { delivered: true, delivery: `Dostarczone! Twój produkt czeka w tickecie #${pad(ticket.number)} na Discordzie HammerShop i w Twoich wiadomościach prywatnych.` });
  }
  if (!done) {
    const team = autopay.pingsFor(guild, ticket);
    const mention = [...team.users.map((id) => `<@${id}>`), ...team.roles.map((id) => `<@&${id}>`)].join(' ');
    await channel.send(notice(COLORS.warning, `⚠️ Nie udało się dostarczyć produktu automatycznie${mention ? ` – ${mention}, prosimy o ręczną dostawę` : ' – sprzedawca dostarczy go ręcznie'}.`, { mentions: team })).catch(() => null);
  }
}

/** Someone who paid on the website before joining: their order opens now. */
async function onMemberAdd(member) {
  if (guildOf()?.id !== member.guild.id) return;
  for (const order of webStore.ordersOf(member.id)) if (order.waitingForMember && !order.handedOver) await handOver(order);
}

// ───────────── Start ─────────────
function start(c) {
  client = c;
  if (!env.web.enabled || server) return;
  webStore.load();
  process.once('exit', () => {
    try {
      webStore.flush();
    } catch (err) {
      console.warn('💾 Nie udało się zapisać bazy strony przy zamykaniu:', err.message);
    }
  });
  webAuth.setClientId(c.application?.id ?? c.user?.id);
  server = createWebServer({ catalog, info: () => ({ invite: inviteOf() }), invitesPaused: () => invitesPaused(), ownInviteFailing, onPaid, onLogin, isMember, currency, featured: featuredServers, level: panelLevel, announce, log: panelLog, plus: panelPlus, featuredAdmin: panelFeatured });
  server.on('error', (err) => {
    console.warn(`🌐 Strona: nie można użyć portu ${env.web.port} (${err.code ?? err.message}) – bot działa dalej bez niej.`);
    server = null;
  });
  server.listen(env.web.port, '0.0.0.0', () => {
    console.log(`🌐 Strona na porcie ${env.web.port}${env.web.publicUrl ? ` – ${env.web.publicUrl}` : ''}`);
    if (!env.web.publicUrl) console.warn('🌐 Strona: ustaw PUBLIC_URL w .env (adres, który otwierają ludzie) – bez niego logowanie przez Discord i płatności są wyłączone.');
    else if (!authReady()) console.warn('🌐 Strona: logowanie przez Discord jest wyłączone – ustaw DISCORD_CLIENT_SECRET (Developer Portal → OAuth2) i dodaj przekierowanie …/api/shop/auth/callback.');
    if (env.web.publicUrl && !paymentsReady()) console.warn('🌐 Strona: płatności są wyłączone – ustaw STRIPE_SECRET_KEY.');
  });
  checkInvite(guildOf(), { force: true }).catch(() => null);
  setInterval(() => checkInvite(guildOf()).catch(() => null), INVITE_CHECK_MS).unref?.();
}

hooks.on('ready', start);
hooks.on('orderPlaced', onOrderPlaced);
hooks.on('memberAdd', (member) => onMemberAdd(member).catch((err) => console.warn('[website] dołączenie członka:', err.message)));
hooks.on('inviteDelete', (invite) => {
  const g = invite.guild && db.guild(invite.guild.id);
  if (g?.webInvite?.code === invite.code) {
    delete g.webInvite;
    db.save();
    ensureInvite(invite.guild).catch(() => null);
  }
});

module.exports = {
  catalog, featuredServers, plain, tabOf, artOf, guildOf, ticketOrder, handOver, onPaid, onLogin, isMember, start, stop: () => server?.close(), _setClient: (c) => (client = c),
  deliverPlus, panelLevel, announce, panelLog, panelPlus, panelFeatured, launcherChannel, checkInvite, inviteOf, invitesPaused, ownInviteFailing,
};
