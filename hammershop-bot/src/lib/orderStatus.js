'use strict';

/**
 * Where an order is – ticket.order.status. Shown in the order ticket, in "My orders" and in the DMs.
 *
 *   awaiting  – placed, waiting for the payment (orders without a status are this too)
 *   sent      – the customer clicked "Pay" and sent proof – a seller checks it
 *   paid      – a seller confirmed the payment
 *   progress  – the seller is preparing / delivering it
 *   delivered – Order completed (the ticket has completedAt)
 *   cancelled – the ticket was closed without completing the order
 *
 * ticket.order also keeps statusAt, statusBy and history: [{ status, at, by }].
 */

const ORDER_STATUS = {
  awaiting: { label: 'Oczekuje na płatność', emoji: '⏳' },
  sent: { label: 'Płatność wysłana – sprawdzamy', emoji: '📨' },
  paid: { label: 'Opłacone', emoji: '💳' },
  progress: { label: 'W realizacji', emoji: '🔧' },
  delivered: { label: 'Dostarczone', emoji: '✅' },
  cancelled: { label: 'Anulowane', emoji: '❌' },
};

/** The status key of an order ticket (null for other tickets). */
function statusOf(ticket) {
  if (!ticket || ticket.typeId !== 'order') return null;
  if (ticket.completedAt) return 'delivered';
  if (ticket.status !== 'open') return 'cancelled';
  return ORDER_STATUS[ticket.order?.status] ? ticket.order.status : 'awaiting';
}

/** "💳 Opłacone" */
const statusLabel = (key) => (ORDER_STATUS[key] ? `${ORDER_STATUS[key].emoji} ${ORDER_STATUS[key].label}` : '—');

module.exports = { ORDER_STATUS, statusOf, statusLabel };
