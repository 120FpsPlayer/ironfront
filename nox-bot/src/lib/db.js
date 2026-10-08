'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

/**
 * Tiny JSON file database (data/db.json). Everything is kept in memory and written
 * to disk at most twice per second (atomic write via a temp file).
 */

const DATA_DIR = process.env.NOX_DATA_DIR || path.join(__dirname, '..', '..', 'data');
const FILE = path.join(DATA_DIR, 'db.json');

let state = { guilds: {}, tickets: {} };
let saveTimer = null;

function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    try {
      state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch (err) {
      const backup = `${FILE}.broken-${Date.now()}`;
      fs.copyFileSync(FILE, backup);
      console.error(`[db] data/db.json was corrupted – saved a copy as ${path.basename(backup)} and started fresh.`, err.message);
      state = {};
    }
  }
  state.guilds ??= {};
  state.tickets ??= {};
}

function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    try {
      flush();
    } catch (err) {
      console.error('[db] Failed to save data:', err.message);
    }
  }, 500);
  saveTimer.unref?.();
}

function defaultSettings() {
  const d = config.defaults;
  return {
    staffRoleIds: [],
    categoryId: null,
    closedCategoryId: null,
    logChannelId: null,
    transcriptChannelId: null,
    maxOpenTicketsPerUser: d.maxOpenTicketsPerUser ?? 2,
    autoCloseHours: d.autoCloseHours ?? 48,
    autoCloseWarningHours: d.autoCloseWarningHours ?? 24,
    pingStaffOnOpen: true,
  };
}

/** The raw guild record (created on first use). */
function guild(guildId) {
  if (!state.guilds[guildId]) {
    state.guilds[guildId] = { settings: defaultSettings(), counter: 0, blacklist: [] };
    save();
  }
  const g = state.guilds[guildId];
  g.settings = { ...defaultSettings(), ...g.settings };
  g.blacklist ??= [];
  g.panels ??= [];
  g.build ??= null;
  g.emojis ??= {};
  g.products ??= []; // see PRODUCT below
  g.vouches ??= []; // { n, userId, rating, product, productId, review, at, messageId } – productId on newer vouches
  g.orders ??= {};
  g.giveaways ??= {};
  g.activity ??= { total: {}, weekKey: null, week: {} };
  g.stats ??= {};
  g.vouchCooldowns ??= {};
  g.promos ??= []; // discount codes – see src/features/promos.js
  g.sales ??= []; // completed orders – see SALE below
  g.notes ??= {}; // staff notes per user: { [userId]: [{ id, by, text, at }] }
  g.invites ??= { members: {}, inviters: {}, rewarded: {} }; // invite tracking
  g.notify ??= {}; // "Notify me" on sold-out products: { [productId]: [userId] }
  g.shopStatus ??= { mode: 'auto' }; // 'auto' (working hours) | 'open' | 'closed'
  g.security ??= {}; // lockdown state, ignored impersonation alerts
  g.reminders ??= {}; // vouch reminders: { [ticketChannelId]: { userId, dueAt, sent } }
  g.balances ??= {}; // store balance: { [userId]: { amount, history: [{ at, change, reason, by, ref }] } } – src/features/balance.js
  g.affiliates ??= []; // creator codes: [{ code, userId, discount, commission, createdAt, earned, paidOut }] – src/features/affiliates.js
  g.carts ??= {}; // shopping carts: { [userId]: { items: [{ productId, variantId, quantity }], updatedAt } } – src/features/cart.js
  g.usedTxs ??= {}; // crypto transactions already used for an order: { [txid]: ticketChannelId } – src/features/cryptoverify.js
  g.disabledMethods ??= {}; // payment methods switched off with /disable: { [name]: { by, at, reason } } – src/lib/paymentState.js
  g.deals ??= {}; // the deal of the week: { week, days: [dayKeys], current: { productId, percent, endsAt } } – src/features/deals.js
  g.abandoned ??= {}; // abandoned-order codes sent: { [ticketChannelId]: { userId, sentAt, code } } – src/features/abandoned.js
  return g;
}

module.exports = {
  /** Folder of db.json (data/ or $NOX_DATA_DIR) – other bot files (e.g. product images) go here too. */
  dataDir: DATA_DIR,
  load,
  flush,
  save,
  guild,
  allGuildIds: () => Object.keys(state.guilds),
  /** For tests. */
  _reset() {
    state = { guilds: {}, tickets: {} };
  },

  // ───────────── Ticket settings ─────────────
  settings(guildId) {
    const { env } = require('../env');
    const s = guild(guildId).settings;
    return {
      ...s,
      categoryId: s.categoryId ?? env.ids('TICKET_CATEGORY_ID')[0] ?? null,
      closedCategoryId: s.closedCategoryId ?? env.ids('CLOSED_CATEGORY_ID')[0] ?? null,
      logChannelId: s.logChannelId ?? env.ids('LOG_CHANNEL_ID')[0] ?? null,
      transcriptChannelId: s.transcriptChannelId ?? env.ids('TRANSCRIPT_CHANNEL_ID')[0] ?? null,
    };
  },
  updateSettings(guildId, patch) {
    const g = guild(guildId);
    Object.assign(g.settings, patch);
    save();
    return g.settings;
  },
  nextTicketNumber(guildId) {
    const g = guild(guildId);
    g.counter += 1;
    save();
    return g.counter;
  },

  // ───────────── Live panels (tickets, shop, vouches, leaderboard) ─────────────
  panels: (guildId, kind = null) => guild(guildId).panels.filter((p) => !kind || (p.kind ?? 'tickets') === kind),
  addPanel(guildId, panel) {
    const g = guild(guildId);
    g.panels = [...g.panels.filter((p) => p.messageId !== panel.messageId), { kind: 'tickets', ...panel }].slice(-30);
    save();
  },
  removePanel(guildId, messageId) {
    const g = guild(guildId);
    g.panels = g.panels.filter((p) => p.messageId !== messageId);
    save();
  },

  // ───────────── Built server (role / channel IDs created by /build) ─────────────
  build: (guildId) => guild(guildId).build,
  setBuild(guildId, build) {
    guild(guildId).build = build;
    save();
  },
  /** When a tracked /build message is re-sent (e.g. the sticky vouch panel), point to the new copy. */
  replacePostId(guildId, oldId, newId) {
    const posts = guild(guildId).build?.posts;
    if (!posts) return;
    for (const list of Object.values(posts)) {
      for (const entry of list) if (entry.id === oldId) entry.id = newId;
    }
    save();
  },
  roleId: (guildId, key) => guild(guildId).build?.roles?.[key] ?? null,
  channelId: (guildId, key) => guild(guildId).build?.channels?.[key] ?? null,
  emojiIds: (guildId) => guild(guildId).emojis,
  setEmoji(guildId, name, id) {
    const g = guild(guildId);
    if (id) g.emojis[name] = id;
    else delete g.emojis[name];
    save();
  },

  // ───────────── Products ─────────────
  /**
   * PRODUCT – one product in the shop (src/features/shop.js):
   * { id, name, price, description, emoji, category, stock ('in' | 'low' | 'out'), image, createdAt, updatedAt,
   *   variants:   [{ id, name, price }] – options with their own price (e.g. 1 / 3 / 12 months); empty = one price
   *   stockCount: number | null – how many are left; null = not counted (only the stock status). Completed
   *               orders count it down; 0 → Sold out
   *   sale:       { percent, endsAt, startedBy, startedAt } | null – a flash sale (/sale start)
   *   delivery:   { files: [{ name, size }], text, updatedAt } | null – what the buyer gets (src/features/delivery.js) }
   *
   * ORDER – ticket.order of an order ticket placed in the shop:
   * { productId, product, variant, unitPrice, quantity, method, methodIndex, promo, discount, subtotal, total,
   *   salePercent, listPrice, status, statusAt, statusBy, history, payment }
   *   variant – the variant's name (product = "Name — variant"); salePercent – the flash sale it was bought in,
   *             listPrice – the unit price before that sale (both only when a sale applied)
   *   status  – see src/lib/orderStatus.js; history – the last 20 changes
   *   payment – what "Pay" sent: { at, method, note, pins, files: [{ name, url }], messageId } (src/features/payments.js)
   *   items   – a cart order: [{ productId, product, variant, quantity, unitPrice }] (product / productId of the order
   *             then describe the whole cart: product = "Netflix × 1, Nitro × 2", productId = null) – src/features/cart.js
   *   giftTo  – a gift: the user ID who gets the product (src/features/gifts.js)
   *   paidWith – 'balance' when paid with store balance (src/features/balance.js); topUp – { amount } for a balance top-up
   *   affiliate – the creator code used: { code, userId, commission } (src/features/affiliates.js)
   *   crypto  – automatic crypto check: { coin, txid, amount, status ('checking' | 'confirmed' | 'short' | 'failed'),
   *             confirmations, checkedAt } (src/features/cryptoverify.js)
   *
   * Order and other tickets also keep unclaimedAt (when staff last unclaimed it) and unclaimedRemindedAt (the last
   * "nobody has claimed this" reminder in the staff chat – src/features/staffreminders.js).
   */

  // ───────────── Sales ─────────────
  /**
   * SALE – one completed order:
   * { id, ticketNumber, channelId, userId, sellerId, productId, product, variant, quantity, amount, currency,
   *   method, promo, discount, createdAt, completedAt }
   * amount = total paid (number, in config.shop.currency) or null when unknown; discount = amount saved.
   */
  sales: (guildId) => guild(guildId).sales,
  addSale(guildId, sale) {
    guild(guildId).sales.push(sale);
    save();
    return sale;
  },

  // ───────────── Blacklist ─────────────
  isBlacklisted: (guildId, userId) => guild(guildId).blacklist.some((b) => b.userId === userId),
  blacklist: (guildId) => guild(guildId).blacklist,
  addBlacklist(guildId, entry) {
    const g = guild(guildId);
    g.blacklist = g.blacklist.filter((b) => b.userId !== entry.userId);
    g.blacklist.push(entry);
    save();
  },
  removeBlacklist(guildId, userId) {
    const g = guild(guildId);
    const before = g.blacklist.length;
    g.blacklist = g.blacklist.filter((b) => b.userId !== userId);
    save();
    return before !== g.blacklist.length;
  },

  // ───────────── Tickets ─────────────
  createTicket(ticket) {
    state.tickets[ticket.channelId] = ticket;
    save();
    return ticket;
  },
  getTicket: (channelId) => state.tickets[channelId] ?? null,
  updateTicket(channelId, patch) {
    const t = state.tickets[channelId];
    if (!t) return null;
    Object.assign(t, patch);
    save();
    return t;
  },
  tickets(filter = () => true) {
    return Object.values(state.tickets).filter(filter);
  },
};
