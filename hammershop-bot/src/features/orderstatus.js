'use strict';

/**
 * Order status (src/lib/orderStatus.js): awaiting payment → payment sent ("Pay", features/payments.js)
 * → paid → in progress → delivered (Order completed).
 *
 *   Staff set it from the ⚙️ menu of an open order ticket: "Status: Paid", "Status: In progress" and "Status:
 *   Awaiting payment" to undo. The ticket gets a short notice, its card shows the new status and the customer
 *   gets a small DM with a link to the ticket (config.orders.statusDms).
 *   Delivered: the receipt DM (config.orders.receipts) says "✅ Delivered" – without receipts the status DM goes
 *   out instead, so the customer never gets two.
 *
 * Every change is kept in ticket.order (status, statusAt, statusBy, history) and emitted as orderStatus.
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const tickets = require('../tickets/tickets');
const { ORDER_STATUS, statusOf, statusLabel } = require('../lib/orderStatus');
const { orderTitle } = require('../lib/orderItems');
const { COLORS } = require('../lib/theme');
const { UserError, pad, ts, truncate } = require('../lib/utils');
const { container, text, divider, linkBtn, row, header, v2, notice, channelUrl } = require('../lib/v2');

const HISTORY_MAX = 20;
/** What staff can pick in the ⚙️ menu – delivered is "Order completed", cancelled is closing the ticket. */
const MENU_STATUSES = ['paid', 'progress', 'awaiting'];

const COLOR = {
  awaiting: COLORS.warning,
  sent: COLORS.warning,
  paid: COLORS.brand,
  progress: COLORS.brand,
  delivered: COLORS.success,
  cancelled: COLORS.danger,
};

const HINTS = {
  awaiting: 'Czekamy na Twoją płatność – dane do płatności są w Twoim tickecie. Kliknij tam **Zapłać**, żeby ją wysłać.',
  sent: 'Sprzedawca właśnie sprawdza Twoją płatność.',
  paid: 'Twoja płatność jest potwierdzona – dziękujemy! Sprzedawca zaraz zajmie się Twoim zamówieniem.',
  progress: 'Sprzedawca właśnie przygotowuje Twoje zamówienie – dostarczymy je w Twoim tickecie.',
  delivered: 'Twoje zamówienie zostało dostarczone – wszystko znajdziesz w swoim tickecie. Miłego korzystania! 🧡',
};

const statusDms = () => config.orders?.statusDms !== false;

/** The open, not yet completed order ticket in this channel (or a UserError). */
function requireOpenOrder(channel) {
  const ticket = db.getTicket(channel?.id);
  if (!ticket) throw new UserError('Tej akcji można użyć tylko na kanale ticketu.');
  if (ticket.typeId !== 'order') throw new UserError('Status zamówienia mają tylko tickety zakupu.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty.');
  if (ticket.completedAt) throw new UserError('To zamówienie jest już zrealizowane.');
  return ticket;
}

/**
 * Stores a new status on the ticket's order → the ticket. Order tickets from older versions have no ticket.order –
 * it is built from their form answers first (orderDetails), so their product and quantity are kept.
 * extra: more order fields saved with it (the payment of "Pay").
 */
function recordStatus(ticket, status, { by = null, now = Date.now(), extra = {} } = {}) {
  const order = { ...tickets.orderDetails(ticket) };
  const history = [...(order.history ?? []), { status, at: now, by }].slice(-HISTORY_MAX);
  return db.updateTicket(ticket.channelId, { order: { ...order, ...extra, status, statusAt: now, statusBy: by, history } });
}

/** The status DM: order number, product, the new status and a link to the ticket. */
function statusCard(guild, ticket, status) {
  const order = tickets.orderDetails(ticket);
  const s = ORDER_STATUS[status] ?? ORDER_STATUS.awaiting;
  const c = container(COLOR[status] ?? COLORS.brand);
  header(c, `## ${s.emoji} Aktualizacja zamówienia\nNowy status Twojego zamówienia w **${truncate(guild.name, 100)}**: **${s.label}**.`, guild.iconURL?.({ size: 128 }));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      [
        `**Zamówienie:** \`#${pad(ticket.number)}\``,
        `**Produkt:** ${orderTitle(order)}`,
        `**Status:** ${statusLabel(status)}`,
      ].join('\n'),
    ),
  );
  c.addTextDisplayComponents(text(`${HINTS[status] ?? ''}\n-# Nigdy nie prosimy o płatność w DM – tylko w Twoim tickecie.`.trim()));
  c.addActionRowComponents(row(linkBtn(channelUrl(guild.id, ticket.channelId), 'Przejdź do ticketu', '🎫')));
  return v2(c);
}

/** DMs the customer the order's new status → true when it arrived (false: turned off, or their DMs are closed). */
async function sendStatusDm(guild, ticket, status) {
  if (!statusDms()) return false;
  const user = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  if (!user?.send) return false;
  return user
    .send(statusCard(guild, ticket, status))
    .then(() => true)
    .catch(() => false);
}

/**
 * Staff changes the status (⚙️ menu): saved on the order, a notice in the ticket, the card refreshed and a DM
 * to the customer. → { status, dm } (dm: whether the DM arrived)
 */
async function setStatus(channel, status, staff) {
  if (!MENU_STATUSES.includes(status)) throw new UserError('Nieznany status zamówienia.');
  const ticket = requireOpenOrder(channel);
  if (statusOf(ticket) === status) throw new UserError(`Zamówienie ma już status **${statusLabel(status)}**.`);
  const now = Date.now();
  const updated = recordStatus(ticket, status, { by: staff.id, now });
  await tickets.refreshControlMessage(channel, updated);
  await channel.send(notice(COLOR[status], `${ORDER_STATUS[status].emoji} Status zamówienia: **${ORDER_STATUS[status].label}**\n-# Ustawiony przez <@${staff.id}> ${ts(now, 'R')}`));
  const dm = await sendStatusDm(channel.guild, updated, status);
  await hooks.emit('orderStatus', { guild: channel.guild, ticket: updated, status, staff });
  return { status, dm };
}

/** Order completed = delivered: kept in the history; the status DM only goes out when there is no receipt (it says Delivered). */
async function delivered({ guild, ticket, staff }) {
  if (ticket?.typeId !== 'order') return;
  const updated = recordStatus(ticket, 'delivered', { by: staff?.id ?? null, now: ticket.completedAt ?? Date.now() }) ?? ticket;
  if (!config.orders?.receipts) await sendStatusDm(guild, updated, 'delivered');
  await hooks.emit('orderStatus', { guild, ticket: updated, status: 'delivered', staff });
}

hooks.on('orderCompleted', delivered);

module.exports = { MENU_STATUSES, requireOpenOrder, recordStatus, statusCard, sendStatusDm, setStatus };
