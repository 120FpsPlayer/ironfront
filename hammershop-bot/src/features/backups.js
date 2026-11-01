'use strict';

/**
 * Automatic backups of the bot's data (config.backups: { enabled, everyHours }).
 *
 * Every 15 minutes a timer checks when this server's last backup was made (db.guild(id).stats.backup) and,
 * when one is due, posts hammershop-backup-<YYYY-MM-DD-HHmm>.json.gz in #backups: the server's record plus its
 * tickets, laid out like data/db.json – restoring is "unzip it and use it as data/db.json".
 * /backup (src/commands/backup.js) makes one right away; it counts as the period's backup.
 */

const zlib = require('node:zlib');
const { promisify } = require('node:util');
const { AttachmentBuilder } = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const { COLORS } = require('../lib/theme');
const { embed, sendToChannel, truncate, ts } = require('../lib/utils');
const { localParts, timezone } = require('./salesreport');

const HOUR = 3_600_000;
const CHECK_EVERY = 15 * 60_000;
/** Discord accepts uploads up to 10 MB from bots – bigger backups are replaced by a warning. */
const LIMITS = { maxBytes: 9 * 1024 * 1024 };

const gzip = promisify(zlib.gzip);
const pad2 = (n) => String(n).padStart(2, '0');
const periodMs = () => Math.max(1, Number(config.backups.everyHours) || 24) * HOUR;

/** "1.4 MB", "820 KB", "512 B" */
function size(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** hammershop-backup-2026-10-03-1405.json.gz (local time of the shop). */
function fileName(now, tz = timezone()) {
  const p = localParts(now, tz);
  return `hammershop-backup-${p.year}-${pad2(p.month)}-${pad2(p.day)}-${pad2(p.hour)}${pad2(p.minute)}.json.gz`;
}

/** This server's data in the shape of data/db.json – only its guild record and its own tickets. */
function snapshot(guild, now = Date.now()) {
  const tickets = Object.fromEntries(db.tickets((t) => t.guildId === guild.id).map((t) => [t.channelId, t]));
  return {
    backup: { app: 'hammershop-bot', version: 1, guildId: guild.id, guildName: guild.name, createdAt: now },
    guilds: { [guild.id]: db.guild(guild.id) },
    tickets,
  };
}

function counts(data, guildId) {
  const g = data.guilds[guildId];
  const tickets = Object.values(data.tickets);
  return {
    tickets: tickets.length,
    openTickets: tickets.filter((t) => t.status === 'open').length,
    sales: g.sales.length,
    products: g.products.length,
    vouches: g.vouches.length,
    promos: g.promos.length,
    notes: Object.values(g.notes).reduce((n, list) => n + list.length, 0),
    blacklist: g.blacklist.length,
  };
}

/** Builds the gzip file: { name, gz, size, rawSize, counts, createdAt }. */
async function createBackup(guild, now = Date.now()) {
  const data = snapshot(guild, now);
  const json = JSON.stringify(data, null, 2);
  const gz = await gzip(Buffer.from(json, 'utf8'), { level: 9 });
  return { name: fileName(now), gz, size: gz.length, rawSize: Buffer.byteLength(json), counts: counts(data, guild.id), createdAt: now };
}

const RESTORE =
  '1. Zatrzymaj bota i zachowaj kopię obecnego pliku `data/db.json`\n' +
  '2. Rozpakuj ten plik (to gzip – 7-Zip, `gunzip` albo dowolny program do archiwów)\n' +
  '3. Zmień jego nazwę na `db.json` i wrzuć go do `data/` (zastąp stary plik)\n' +
  '4. Uruchom bota\n' +
  '*Bot działa na kilku serwerach? Zamiast tego skopiuj do swojego db.json tylko ten serwer z `guilds` i jego `tickets`.*';

function backupEmbed(guild, b, { by } = {}) {
  const c = b.counts;
  const next = config.backups.enabled ? `\nNastępna automatyczna kopia ${ts(b.createdAt + periodMs(), 'R')}.` : '';
  return embed(COLORS.brand)
    .setTitle('💾 Kopia zapasowa')
    .setDescription(`${by ? `Kopia wykonana na prośbę <@${by}>` : `Automatyczna kopia (co ${periodMs() / HOUR} h)`} – serwer **${truncate(guild.name, 100)}** · \`${b.name}\`${next}`)
    .addFields(
      { name: 'Rozmiar', value: `${size(b.size)} (${size(b.rawSize)} po rozpakowaniu)`, inline: true },
      { name: 'Tickety', value: `${c.tickets} (otwarte: ${c.openTickets})`, inline: true },
      { name: 'Sprzedaż', value: String(c.sales), inline: true },
      { name: 'Produkty', value: String(c.products), inline: true },
      { name: 'Opinie', value: String(c.vouches), inline: true },
      { name: 'Kody rabatowe', value: String(c.promos), inline: true },
      { name: '♻️ Jak przywrócić', value: RESTORE },
    );
}

function tooBigEmbed(guild, b) {
  return embed(COLORS.warning)
    .setTitle('⚠️ Kopia zapasowa jest za duża')
    .setDescription(
      `Kopia serwera **${truncate(guild.name, 100)}** ma **${size(b.size)}** – Discord przyjmuje tu pliki do ${size(LIMITS.maxBytes)}, więc nie została opublikowana.\n` +
        'Zamiast tego skopiuj `data/db.json` z serwera, na którym działa bot – są tam wszystkie dane.',
    );
}

/** Written to disk right away (not in 0.5 s) – a crash or restart right after posting must not post it again. */
function persist() {
  try {
    db.flush();
  } catch (err) {
    console.warn('[backups] Nie udało się zapisać danych:', err.message);
    db.save();
  }
}

/**
 * Makes a backup and posts it in #backups – or, when there is no such channel, only returns it (for /backup).
 * The time is saved in db.guild(id).stats.backup before anything else, so two checks running at once (or a
 * restart right after posting) can never post it twice. Returns { backup, tooBig, message, payload }.
 */
async function backupNow(guild, { now = Date.now(), by = null } = {}) {
  const stats = db.guild(guild.id).stats;
  const before = stats.backup ?? null;
  const mine = { lastAt: now, by };
  const release = () => {
    if (stats.backup !== mine) return; // another backup (e.g. /backup) finished in the meantime – keep it
    if (before) stats.backup = before;
    else delete stats.backup;
    db.save();
  };
  stats.backup = mine;
  persist();
  let b;
  try {
    b = await createBackup(guild, now);
  } catch (err) {
    release();
    throw err;
  }
  const tooBig = b.size > LIMITS.maxBytes;
  Object.assign(mine, { file: b.name, size: b.size, tooBig });
  db.save();
  const payload = tooBig ? { embeds: [tooBigEmbed(guild, b)] } : { embeds: [backupEmbed(guild, b, { by })], files: [new AttachmentBuilder(b.gz, { name: b.name })] };
  const channelId = db.channelId(guild.id, 'backups');
  const message = channelId ? await sendToChannel(guild, channelId, payload) : null;
  if (channelId && !message) release(); // not delivered (channel deleted, missing permissions) – the next check tries again
  return { backup: b, tooBig, message, payload };
}

/** Is an automatic backup due? (never more than once per config.backups.everyHours) */
function isDue(guildId, now = Date.now()) {
  const last = db.guild(guildId).stats.backup?.lastAt;
  return !last || now - last >= periodMs();
}

async function runBackups(client, now = Date.now()) {
  if (!config.backups.enabled) return;
  for (const guild of client.guilds.cache.values()) {
    if (!db.channelId(guild.id, 'backups') || !isDue(guild.id, now)) continue;
    await backupNow(guild, { now }).catch((err) => console.warn(`[backups] ${guild.name}:`, err.message));
  }
}

hooks.every('backups', CHECK_EVERY, (client) => runBackups(client), 3 * 60_000);

module.exports = { LIMITS, size, fileName, snapshot, createBackup, backupNow, isDue, runBackups };
