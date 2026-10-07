'use strict';

/**
 * Where an order is – ticket.order.status. Shown in the order ticket, in "My orders" and in the DMs.
 *
 *   awaiting  – placed, waiting for the payment (orders without a status are this too)
 *   sent      – the customer clicked "I've paid" and sent proof – a seller checks it
 *   paid      – a seller confirmed the payment
 *   progress  – the seller is preparing / delivering it
 *   delivered – Order completed (the ticket has completedAt)
 *   cancelled – the ticket was closed without completing the order
 *
 * ticket.order also keeps statusAt, statusBy and history: [{ status, at, by }].
 */

const ORDER_STATUS = {
  awaiting: { label: 'Awaiting payment', emoji: '⏳' },
  sent: { label: 'Payment sent – being checked', emoji: '📨' },
  paid: { label: 'Paid', emoji: '💳' },
  progress: { label: 'In progress', emoji: '🔧' },
  delivered: { label: 'Delivered', emoji: '✅' },
  cancelled: { label: 'Cancelled', emoji: '❌' },
};

/** The status key of an order ticket (null for other tickets). */
function statusOf(ticket) {
  if (!ticket || ticket.typeId !== 'order') return null;
  if (ticket.completedAt) return 'delivered';
  if (ticket.status !== 'open') return 'cancelled';
  return ORDER_STATUS[ticket.order?.status] ? ticket.order.status : 'awaiting';
}

/** "💳 Paid" */
const statusLabel = (key) => (ORDER_STATUS[key] ? `${ORDER_STATUS[key].emoji} ${ORDER_STATUS[key].label}` : '—');

module.exports = { ORDER_STATUS, statusOf, statusLabel };
