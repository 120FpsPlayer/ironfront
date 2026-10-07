'use strict';

/**
 * Shop badges on the product cards (src/features/shop.js), worked out once per panel render:
 *
 *   🔥 Bestseller   the product with the most units sold (db.sales) – at least badges.bestsellerMinSales,
 *                   ties go to the product that comes first in the catalog
 *   ⭐ 4.9          the average vouch rating of a product – once it has badges.ratingMinVouches vouches
 *
 * Sales and vouches point to their product by ID; older ones (and orders from the Purchase ticket form)
 * only have the product name, so those are matched by name.
 */

const config = require('../lib/config');
const db = require('../lib/db');

const setting = (key, fallback) => {
  const n = Number(config.badges?.[key]);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const enabled = () => config.badges?.enabled !== false;

/** record → the catalog product a sale or vouch is about: by productId, or by name (any case) for records without one. */
function finder(list) {
  const byId = new Map();
  const byName = new Map();
  for (const p of list) {
    byId.set(p.id, p);
    if (!byName.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p);
  }
  return (record) => (record.productId ? byId.get(record.productId) : byName.get(String(record.product ?? '').trim().toLowerCase())) ?? null;
}

const productOf = (list, record) => finder(list)(record);

/** The bestselling product's ID (or null): most units sold, at least bestsellerMinSales, ties → earlier in the catalog. */
function bestseller(guildId) {
  const list = db.guild(guildId).products;
  const find = finder(list);
  const units = new Map();
  for (const sale of db.sales(guildId)) {
    const p = find(sale);
    if (p) units.set(p.id, (units.get(p.id) ?? 0) + (Number(sale.quantity) || 1));
  }
  let best = null;
  for (const p of list) if ((units.get(p.id) ?? 0) > (best ? units.get(best.id) : 0)) best = p;
  return best && units.get(best.id) >= Math.max(1, setting('bestsellerMinSales', 3)) ? best.id : null;
}

/** Average vouch rating per product → Map(productId → { avg, count }), all products with at least one vouch. */
function ratings(guildId) {
  const find = finder(db.guild(guildId).products);
  const sums = new Map();
  for (const v of db.guild(guildId).vouches) {
    const p = find(v);
    if (!p || !(Number(v.rating) > 0)) continue;
    const s = sums.get(p.id) ?? { total: 0, count: 0 };
    sums.set(p.id, { total: s.total + Number(v.rating), count: s.count + 1 });
  }
  return new Map([...sums].map(([id, s]) => [id, { avg: s.total / s.count, count: s.count }]));
}

/** The badges of every product → Map(productId → ['🔥 Bestseller', '⭐ 4.9']) – empty when badges are turned off. */
function compute(guildId) {
  const out = new Map();
  if (!enabled()) return out;
  const add = (id, badge) => out.set(id, [...(out.get(id) ?? []), badge]);
  const best = bestseller(guildId);
  if (best) add(best, '🔥 Bestseller');
  const min = Math.max(1, setting('ratingMinVouches', 2));
  for (const [id, r] of ratings(guildId)) if (r.count >= min) add(id, `⭐ ${r.avg.toFixed(1)}`);
  return out;
}

module.exports = { enabled, finder, productOf, bestseller, ratings, compute };
