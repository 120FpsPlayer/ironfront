'use strict';

/**
 * Orders and sales with several products (a cart – src/features/cart.js) keep them in `items`:
 *   order.items / sale.items = [{ productId, product, variant, quantity, unitPrice }]
 * product / productId of the order then describe the whole cart ("Netflix — 3 months × 1, Nitro × 2", null).
 * These helpers let every place that reads "one product per order" handle both kinds the same way.
 */

const { truncate } = require('./utils');

/** Does this order / sale hold several products (a cart)? */
const isCart = (record) => Array.isArray(record?.items) && record.items.length > 0;

/** The product lines of an order or sale – its items, or the record itself as its only line. */
const linesOf = (record) => (isCart(record) ? record.items : record ? [record] : []);

/** "Netflix — 3 months × 1" */
const lineText = (item) => `${item.product || 'Product'} × ${Number(item.quantity) || 1}`;

/**
 * "Netflix — 3 months × 1, Nitro × 2" – as many lines as fit into max characters, then "+2 more".
 * The first line is always there (shortened when it alone is too long).
 */
function cartTitle(items, max = 100) {
  const parts = items.map(lineText);
  if (parts.join(', ').length <= max) return parts.join(', ');
  const shown = [];
  for (const [i, part] of parts.entries()) {
    const more = ` +${parts.length - i - 1} more`;
    if ([...shown, part].join(', ').length + more.length > max) break;
    shown.push(part);
  }
  if (!shown.length) shown.push(truncate(parts[0], Math.max(10, max - 12)));
  return `${shown.join(', ')} +${parts.length - shown.length} more`;
}

/** " × 2" behind an order's product – nothing for a cart or a balance top-up (their title says it all). */
const quantitySuffix = (order) => (isCart(order) || order?.topUp ? '' : ` × ${order?.quantity ?? 1}`);

/**
 * What an order is about, for one line of text: "Spotify × 2" – or, for a cart or a balance top-up,
 * just its title ("Netflix × 1, Nitro × 2", "Balance top-up 25€") without a quantity behind it.
 */
const orderTitle = (order, { max = 100, fallback = 'Custom order' } = {}) => `${truncate(order?.product || fallback, max)}${quantitySuffix(order)}`;

module.exports = { isCart, linesOf, lineText, cartTitle, quantitySuffix, orderTitle };
