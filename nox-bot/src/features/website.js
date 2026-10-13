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
const { logEmbed, money, pad, parseAmount, sendLog, truncate } = require('../lib/utils');
const { notice } = require('../lib/v2');
const { isSafeSelfRole } = require('../lib/guards');

const shop = () => require('./shop');
const METHOD = 'Website';
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
  if (/\bbots?\b/.test(text)) return 'Discord Bots';
  if (/\bservers?\b/.test(text)) return 'Discord Servers';
  if (/game|gry|gra\b|steam|spiel/.test(text)) return 'Games';
  return raw || 'Other';
}
function artOf(p, tab) {
  if (tab === 'Discord Bots') return 'bot';
  if (tab === 'Discord Servers') return 'server';
  return /bundle|combo|pack/i.test(`${p.name} ${p.category ?? ''}`) ? 'bundle' : 'games';
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
    const base = { category: tab, description: plain(p.description), art: artOf(p, tab), imagePath, productId: p.id };
    const variants = s.variantsOf(p);
    const entries = variants.length
      ? variants.map((v) => ({ ...base, id: `${p.id}~${v.id}`, name: plain(`${p.name} – ${v.name}`), price: cents(v.price), variant: v.name }))
      : [{ ...base, id: p.id, name: plain(p.name), price: cents(p.price), variant: null }];
    for (const e of entries) if (e.price > 0) out.push({ ...e, image: imagePath ? `/api/nox/image/${encodeURIComponent(e.id)}` : null });
  }
  return out;
}

/**
 * Shop texts are written for Discord: custom emojis (<:nox_wallet:123…>), **bold**, -# small text… The website can't
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

const inviteOf = () => env.web.invite || (guildOf() && db.guild(guildOf().id).webInvite?.url) || null;

/** A permanent invite for the website's Support / community buttons (once; DISCORD_INVITE_URL wins). */
async function ensureInvite(guild) {
  if (!guild || env.web.invite || db.guild(guild.id).webInvite?.url) return;
  const keys = ['rules', 'welcome', 'announcements', 'chat'];
  const candidates = [...keys.map((k) => guild.channels.cache.get(db.channelId(guild.id, k))), ...guild.channels.cache.values()].filter(
    (c) => c && c.type === ChannelType.GuildText && c.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.CreateInstantInvite),
  );
  for (const channel of candidates) {
    const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: false, reason: 'NØX website – Support / community button' }).catch(() => null);
    if (invite) {
      db.guild(guild.id).webInvite = { code: invite.code, url: `https://discord.gg/${invite.code}` };
      db.save();
      return;
    }
  }
}

// ───────────── Sign-in → on the server, with the Member role ─────────────
/**
 * Website sign-in → the user is on the NØX Discord with the Member role. Not a member yet: the bot adds them with the
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
      await member.roles.add(role, 'Signed in on the NØX website');
      await hooks.emit('verified', member);
    }
    return { added: false, member: true };
  }
  if (!accessToken) return { added: false, member: false };
  try {
    member = await guild.members.add(user.id, { accessToken, ...(roleOk && { roles: [role.id] }) });
  } catch (err) {
    console.warn(`[website] couldn't add ${user.username ?? user.id} to the server:`, err.message);
    return { added: false, member: false };
  }
  member ??= await guild.members.fetch(user.id).catch(() => null);
  if (!member) return { added: false, member: false };
  if (roleOk && !member.roles.cache.has(role.id)) await member.roles.add(role, 'Signed in on the NØX website').catch(() => null);
  await sendLog(guild, { embeds: [logEmbed(COLORS.success, '🌐 Joined through the website', guild.client.user).setDescription(`<@${user.id}>${user.username ? ` (${user.username})` : ''} signed in on the website and was added to the server${roleOk ? ` with ${role}` : ''}.`)] }).catch(() => null);
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
    { label: order.items.length > 1 ? 'Products' : 'Product', value: lines.join('\n') },
    { label: 'Payment method', value: 'Website – card (Stripe)' },
    { label: 'Price', value: `**Paid: ${money(order.amount / unit())}** ✅ · website order \`${order.id}\`` },
  ];
}

const setDelivery = (order, patch) => webStore.updateOrder(order.id, patch);

/** Opens the buyer's (paid) order ticket – or waits until they join the server. Never throws. */
async function handOver(order) {
  if (order.kind !== 'products' || order.status !== 'paid' || order.handedOver || handing.has(order.id)) return;
  handing.add(order.id);
  try {
    const guild = guildOf();
    if (!guild) {
      setDelivery(order, { delivery: `The NØX team delivers your order on Discord – keep your order reference ${order.id}.` });
      return;
    }
    const member = await guild.members.fetch(order.userId).catch(() => null);
    if (!member) {
      setDelivery(order, {
        waitingForMember: true,
        delivery: `Join the NØX Discord server with the account you signed in with – your order opens there automatically (reference ${order.id}).`,
      });
      await sendLog(guild, { embeds: [logEmbed(COLORS.warning, '🌐 Website order waiting', guild.client.user).setDescription(`Order \`${order.id}\` (${money(order.amount / unit())}) is paid – <@${order.userId}> isn't on the server yet. It opens as soon as they join.`)] }).catch(() => null);
      return;
    }
    let channel;
    try {
      channel = await tickets.openTicket(member, config.getType('order'), ticketAnswers(order), { order: ticketOrder(order, guild.id) }, { force: true });
    } catch (err) {
      console.warn(`[website] ticket for ${order.id}:`, err.message);
      setDelivery(order, { delivery: `The NØX team contacts you on Discord to deliver it (reference ${order.id}).` });
      await sendLog(guild, { embeds: [logEmbed(COLORS.danger ?? COLORS.warning, '🌐 Website order – no ticket', guild.client.user).setDescription(`Order \`${order.id}\` of <@${order.userId}> is **paid** (${money(order.amount / unit())}) but its ticket couldn't open: ${truncate(err.message, 300)}\nDeliver it by hand.`)] }).catch(() => null);
      return;
    }
    const ticket = db.getTicket(channel.id);
    setDelivery(order, {
      handedOver: true,
      waitingForMember: false,
      ticketChannelId: channel.id,
      ticketNumber: pad(ticket.number),
      ticketUrl: `https://discord.com/channels/${guild.id}/${channel.id}`,
      delivery: `Your order is in ticket #${pad(ticket.number)} on the NØX Discord – a seller delivers it there.`,
    });
    await hooks.emit('orderPlaced', { guild, channel, ticket, member });
  } finally {
    handing.delete(order.id);
  }
}

/** Website → bot: a paid order (once per order). */
async function onPaid(order) {
  await handOver(webStore.getOrder(order.id) ?? order);
}

/** The opened ticket: the "paid on the website" notice, then instant delivery – like an order paid with store balance. */
async function onOrderPlaced({ guild, channel, ticket }) {
  if (!channel || ticket?.order?.paidWith !== 'website') return;
  const delivery = require('./delivery');
  const autopay = require('./autopay');
  const order = ticket.order;
  const instant = delivery.deliverable(guild.id, ticket);
  const pings = instant ? { users: [], roles: [] } : autopay.pingsFor(guild, ticket);
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  const ask = instant ? ' 📦 The product is delivered automatically.' : who ? ` ${who}, please deliver it.` : '';
  await channel.send(notice(COLORS.success, `🌐 **Paid on the website – ${money(order.total)}** (card, Stripe) for order \`#${pad(ticket.number)}\` · \`${order.web?.orderId ?? '—'}\`.${ask}`, { mentions: pings })).catch(() => null);
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '🌐 Paid on the website', guild.client.user).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Amount', value: money(order.total), inline: true },
        { name: 'Stripe', value: `\`${truncate(order.web?.stripe ?? '—', 100)}\``, inline: true },
      ),
    ],
  }).catch(() => null);
  if (!instant) return;
  const done = await delivery.deliverPaid(channel, db.getTicket(channel.id), { amount: order.total }).catch((err) => {
    console.warn('[website] delivery:', err.message);
    return false;
  });
  if (done && order.web?.orderId) {
    webStore.updateOrder(order.web.orderId, { delivered: true, delivery: `Delivered! Your product is in ticket #${pad(ticket.number)} on the NØX Discord and in your DMs.` });
  }
  if (!done) {
    const team = autopay.pingsFor(guild, ticket);
    const mention = [...team.users.map((id) => `<@${id}>`), ...team.roles.map((id) => `<@&${id}>`)].join(' ');
    await channel.send(notice(COLORS.warning, `⚠️ The product couldn't be delivered automatically${mention ? ` – ${mention}, please deliver it by hand` : ' – a seller delivers it by hand'}.`, { mentions: team })).catch(() => null);
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
  process.once('exit', () => webStore.flush());
  webAuth.setClientId(c.application?.id ?? c.user?.id);
  server = createWebServer({ catalog, info: () => ({ invite: inviteOf() }), onPaid, onLogin, isMember, currency });
  server.on('error', (err) => {
    console.warn(`🌐 Website: can't use port ${env.web.port} (${err.code ?? err.message}) – the bot keeps running without it.`);
    server = null;
  });
  server.listen(env.web.port, '0.0.0.0', () => {
    console.log(`🌐 Website on port ${env.web.port}${env.web.publicUrl ? ` – ${env.web.publicUrl}` : ''}`);
    if (!env.web.publicUrl) console.warn('🌐 Website: set PUBLIC_URL in .env (the address people open) – Discord sign-in and payments stay off without it.');
    else if (!authReady()) console.warn('🌐 Website: Discord sign-in is off – set DISCORD_CLIENT_SECRET (Developer Portal → OAuth2) and add the redirect …/api/nox/auth/callback.');
    if (env.web.publicUrl && !paymentsReady()) console.warn('🌐 Website: payments are off – set STRIPE_SECRET_KEY.');
  });
  ensureInvite(guildOf()).catch(() => null);
}

hooks.on('ready', start);
hooks.on('orderPlaced', onOrderPlaced);
hooks.on('memberAdd', (member) => onMemberAdd(member).catch((err) => console.warn('[website] member join:', err.message)));
hooks.on('inviteDelete', (invite) => {
  const g = invite.guild && db.guild(invite.guild.id);
  if (g?.webInvite?.code === invite.code) {
    delete g.webInvite;
    db.save();
    ensureInvite(invite.guild).catch(() => null);
  }
});

module.exports = { catalog, plain, tabOf, artOf, guildOf, ticketOrder, handOver, onPaid, onLogin, isMember, start, stop: () => server?.close(), _setClient: (c) => (client = c) };
