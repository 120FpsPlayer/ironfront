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
  g.products ??= [];
  g.vouches ??= [];
  g.orders ??= {};
  g.giveaways ??= {};
  g.activity ??= { total: {}, weekKey: null, week: {} };
  g.stats ??= {};
  g.vouchCooldowns ??= {};
  return g;
}

module.exports = {
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
