'use strict';

/**
 * Automatic payments – Stripe (src/features/stripe.js) and PayPal (src/features/paypal.js). What both do when
 * money comes in, and whether an order has a link that confirms itself (then "Pay" isn't needed).
 *
 * An order is only set to Paid when the amount and currency match its total and it wasn't paid already –
 * otherwise the team is asked to check it (a changed total, a second payment). A payment on a closed or deleted
 * ticket is still recorded, and the team is told.
 */

const config = require('../lib/config');
const db = require('../lib/db');
const tickets = require('../tickets/tickets');
const orderstatus = require('./orderstatus');
const { alertRoleIds } = require('../lib/permissions');
const { COLORS } = require('../lib/theme');
const { logEmbed, money, pad, truncate, sendLog } = require('../lib/utils');
const { notice } = require('../lib/v2');
const { DECIMALS } = require('../lib/currency');

const PAID = ['paid', 'progress', 'delivered'];

/** Where the order stood before the payment: 'awaiting' | 'sent' | 'paid' | 'progress' | 'delivered'. */
const statusBefore = (ticket) => (ticket.completedAt ? 'delivered' : ticket.order?.status ?? 'awaiting');

/** The claimer, or the team of the ticket type (Sellers for purchases). */
const pingsFor = (guild, ticket) =>
  ticket.claimedBy
    ? { users: [ticket.claimedBy], roles: [] }
    : { users: [], roles: alertRoleIds(guild.id, config.getType(ticket.typeId)).filter((id) => guild.roles.cache.has(id)) };

/**
 * Money came in through a provider. The caller has already saved its own record (e.g. order.stripe.status = 'paid').
 * @param {{ gateway: string, paidAmount: number, paidCurrency: string, expectedCurrency: string|null,
 *   reference: string|null, before: string, refreshCard?: (ticket) => Promise<void> }} p
 */
async function paymentReceived(guild, ticket, { gateway, paidAmount, paidCurrency, expectedCurrency, reference, before, refreshCard }) {
  let updated = db.getTicket(ticket.channelId) ?? ticket;
  const total = tickets.orderDetails(updated).total;
  // Within half the currency's smallest unit: the provider charges whole cents (or whole yen for a 1172.3 total).
  const unit = 10 ** -(DECIMALS[expectedCurrency] ?? 2);
  const matches = String(paidCurrency ?? '').toLowerCase() === expectedCurrency && total != null && Math.abs(paidAmount - total) <= unit / 2 + 1e-9;
  const twice = PAID.includes(before);
  // A deleted ticket's channel may still be there for a few seconds – the log is the place then.
  const channel = updated.status === 'deleted' ? null : guild.channels.cache.get(updated.channelId) ?? null;
  const bot = guild.client.user;
  if (matches && !twice) {
    // Open ticket → the usual status change (notice, card, DM); closed ticket → recorded, so reopening shows it.
    if (channel && updated.status === 'open') await orderstatus.setStatus(channel, 'paid', bot).catch((err) => console.warn(`[${gateway}] status:`, err.message));
    else orderstatus.recordStatus(updated, 'paid', { by: bot?.id ?? null });
    updated = db.getTicket(updated.channelId);
  }
  if (refreshCard) await refreshCard(updated);

  const warnings = [];
  if (twice) warnings.push(`⚠️ This order was already **${before === 'delivered' ? 'completed' : 'marked as paid'}** – the customer may have paid twice. Check it (refunds: your ${gateway} account).`);
  else if (!matches) warnings.push(`⚠️ The order total is **${total == null ? 'not fixed' : money(total)}** – it was **not** set to Paid. Check the difference first.`);
  if (updated.status !== 'open') warnings.push(`⚠️ The ticket was ${channel ? 'closed' : 'deleted'} when the payment came in${channel ? ' – reopen it to deliver' : ' – contact the customer'}.`);
  // Paid in full on an open ticket and the product has files or text → delivered right away (src/features/delivery.js).
  const delivery = require('./delivery'); // here – it needs this file's neighbours loaded
  const instant = matches && !twice && channel && updated.status === 'open' && !updated.order?.delivered && delivery.deliverable(guild.id, updated);
  const pings = instant ? { users: [], roles: [] } : pingsFor(guild, updated); // nothing for the team to do when it's delivered automatically
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  const head = `💳 **${gateway} payment received – ${money(paidAmount)}** for order \`#${pad(updated.number)}\`.`;
  if (channel) {
    const done = updated.order?.topUp ? ' 💰 The balance is credited automatically.' : ' 📦 The product is delivered automatically.'; // a top-up: features/balance.js
    const ask = instant ? done : matches && !twice && who ? ` ${who}, please deliver it.` : who ? ` ${who}` : '';
    await channel.send(notice(warnings.length ? COLORS.warning : COLORS.success, `${head}${ask}${warnings.length ? `\n${warnings.join('\n')}` : ''}`, { mentions: pings })).catch(() => null);
  }
  await sendLog(guild, {
    // Without a ticket channel the log is the only place the team hears about it – ping them there.
    ...(!channel && who && { content: who, allowedMentions: pings }),
    embeds: [
      logEmbed(warnings.length ? COLORS.warning : COLORS.success, `💳 ${gateway} payment received`, bot).addFields(
        { name: 'Ticket', value: `<#${updated.channelId}> (\`#${pad(updated.number)}\`)`, inline: true },
        { name: 'Customer', value: `<@${updated.ownerId}>`, inline: true },
        { name: 'Amount', value: money(paidAmount), inline: true },
        { name: gateway, value: `\`${truncate(reference ?? '—', 100)}\``, inline: true },
        ...(warnings.length ? [{ name: 'Check', value: truncate(warnings.join('\n'), 1024) }] : []),
      ),
    ],
  }).catch(() => null);
  if (instant) await delivery.deliverPaid(channel, db.getTicket(updated.channelId), { amount: paidAmount }).catch((err) => console.warn(`[${gateway}] delivery:`, err.message));
}

/** The order has a payment link that confirms itself – "Pay" isn't needed then. Here – stripe.js and paypal.js need this file. */
const confirmsItself = (ticket) => require('./stripe').confirmsItself(ticket) || require('./paypal').confirmsItself(ticket);

module.exports = { PAID, statusBefore, pingsFor, paymentReceived, confirmsItself };
