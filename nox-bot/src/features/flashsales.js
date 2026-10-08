'use strict';

/**
 * Flash sales – "/sale start product:Nitro percent:20 duration:2h". product.sale = { percent, endsAt, startedBy, startedAt }.
 * The shop card shows ~~20€~~ **16€** · −20% with a live "Sale ends in …" countdown, the order form and the order's
 * price use the reduced price (shop.priceOrder). A sale counts only while Date.now() < endsAt; the timer below
 * clears ended sales and refreshes the shop panel. Starting one can announce it in #restocks with the Restocks ping.
 */

const { ButtonStyle } = require('discord.js');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const images = require('../lib/productImages');
const panels = require('../lib/panels');
const shop = require('./shop');
const { e, ce, COLORS } = require('../lib/theme');
const { UserError, parseDuration, sendToChannel, truncate, ts } = require('../lib/utils');
const { container, text, btn, row, header, v2 } = require('../lib/v2');

const MIN_PERCENT = 1;
const MAX_PERCENT = 90;
const MIN_DURATION = 60_000;
const MAX_DURATION = 7 * 86_400_000;
const CHECK_EVERY = 60_000;

/** "2h", "30m", "1d", "1h30m" → milliseconds, from 1 minute up to 7 days (or a UserError). */
function saleDuration(input) {
  const ms = parseDuration(input);
  if (ms == null || ms < MIN_DURATION || ms > MAX_DURATION) {
    throw new UserError('The duration must look like `30m`, `2h`, `1d` or `1h30m` – from 1 minute up to 7 days.');
  }
  return ms;
}

/** Puts a product on sale (a running sale is replaced) → { product, replaced }. */
function startSale(guild, query, { percent, durationMs, by = null, now = Date.now() }) {
  const p = shop.requireProduct(guild.id, query);
  const pct = Number(percent);
  if (!Number.isInteger(pct) || pct < MIN_PERCENT || pct > MAX_PERCENT) throw new UserError(`The discount must be a whole number from ${MIN_PERCENT} to ${MAX_PERCENT} percent.`);
  if (!(durationMs >= MIN_DURATION && durationMs <= MAX_DURATION)) throw new UserError('A flash sale can run from 1 minute up to 7 days.');
  const problem = shop.saleProblem(p);
  if (problem) throw new UserError(`**${p.name}** can't go on sale: ${problem}. Change it with \`/product edit price:\` or \`/product variants\` first.`);
  const replaced = shop.activeSale(p, now);
  p.sale = { percent: pct, endsAt: now + durationMs, startedBy: by, startedAt: now };
  p.updatedAt = now;
  db.save();
  shop.refreshShop(guild);
  return { product: p, replaced };
}

/** Ends a product's sale right away → the product. */
function stopSale(guild, query, now = Date.now()) {
  const p = shop.requireProduct(guild.id, query);
  if (!shop.activeSale(p, now)) throw new UserError(`**${p.name}** is not on sale right now.`);
  p.sale = null;
  p.updatedAt = now;
  db.save();
  shop.refreshShop(guild);
  return p;
}

/** The products on sale right now, the ones ending first on top. */
const onSale = (guildId, now = Date.now()) =>
  shop
    .products(guildId)
    .filter((p) => shop.activeSale(p, now))
    .sort((a, b) => a.sale.endsAt - b.sale.endsAt);

/** "~~20€~~ **16€**", or for products with options: "1 month ~~5€~~ **4€** · 3 months ~~12€~~ **9.60€**". */
function salePrices(p, now = Date.now()) {
  const options = shop.variantsOf(p);
  if (!options.length) return `~~${shop.formatPrice(p.price)}~~ **${shop.variantPrice(p, p, now)}**`;
  return options.map((v) => `${v.name} ~~${shop.formatPrice(v.price)}~~ **${shop.variantPrice(p, v, now)}**`).join(' · ');
}

/** Posts "⚡ Flash sale" (or another title, e.g. "🔥 Deal of the week") in #restocks and pings the Restocks role (like shop.announceProduct). */
async function announceSale(guild, p, now = Date.now(), { title = '⚡ Flash sale' } = {}) {
  const sale = shop.activeSale(p, now);
  const channelId = db.channelId(guild.id, 'restocks');
  if (!sale || !channelId) return null;
  const roleId = db.roleId(guild.id, 'pingRestocks');
  const image = images.attachment(p);
  const c = container(COLORS.warning);
  header(
    c,
    `## ${title}: ${shop.productEmoji(guild, p)} ${p.name} −${sale.percent}%\n${truncate(p.description, 400)}\n\n` +
      `**Price:** ${truncate(salePrices(p, now), 1500)}\n${e(guild, 'clock')} Ends ${ts(sale.endsAt, 'R')} (${ts(sale.endsAt, 'f')})`,
    image?.url,
  );
  c.addActionRowComponents(row(btn(`shop:buy:${p.id}`, 'Buy now', ce(guild, 'cart'), ButtonStyle.Primary)));
  if (roleId) c.addTextDisplayComponents(text(`-# 🔔 <@&${roleId}>`));
  return sendToChannel(guild, channelId, v2(c, { mentions: { roles: roleId ? [roleId] : [] }, files: image ? [image.file] : [] }));
}

/** Clears the sales that have ended (and refreshes the shop panel) in every available server → how many ended. */
async function expireSales(client, now = Date.now()) {
  let ended = 0;
  for (const guildId of db.allGuildIds()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild || guild.available === false) continue; // a Discord outage – try again on the next run
    const over = shop.products(guildId).filter((p) => p.sale && !shop.activeSale(p, now));
    if (!over.length) continue;
    for (const p of over) p.sale = null;
    db.save();
    ended += over.length;
    console.log(`[flash sale] ${guild.name}: ended the sale of ${over.map((p) => p.name).join(', ')}`);
    await panels.refresh(guild, 'shop').catch((err) => console.warn('[flash sale]', err.message));
  }
  return ended;
}

hooks.every('flashSales', CHECK_EVERY, (client) => expireSales(client), 30_000);

module.exports = { MIN_PERCENT, MAX_PERCENT, MAX_DURATION, saleDuration, startSale, stopSale, onSale, salePrices, announceSale, expireSales };
