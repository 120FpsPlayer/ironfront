'use strict';

/**
 * A promo code added in the order ticket – for a buyer who forgot it or typed it wrong in the order form.
 *
 *   tpromo:open    "Add promo code" on the order card (only while the order waits for payment) → the code form
 *   tpromo:submit  the form → the code is checked like in the order form, the total is worked out again, the old
 *                  payment card / Stripe / PayPal link is removed and a new one with the new amount is posted
 */

const { MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const promos = require('./promos');
const { COLORS } = require('../lib/theme');
const { UserError, money } = require('../lib/utils');
const { btn, buttonSection, notice } = require('../lib/v2');
const { statusOf } = require('../lib/orderStatus');

const tickets = () => require('../tickets/tickets');

/** Why a code can't be added to this order right now, or null. */
function blocked(ticket) {
  const o = ticket?.order;
  if (config.promos?.enabled === false) return 'Promo codes are turned off.';
  if (!o || ticket.typeId !== 'order' || ticket.status !== 'open' || ticket.completedAt) return 'This only works in an open order ticket.';
  if (o.topUp) return 'Promo codes don\'t work on balance top-ups.';
  if (o.paidWith === 'balance' || statusOf(ticket) !== 'awaiting') return 'This order is already being paid – a code can only be added before you pay.';
  if (o.promo && !o.promoError) return `Code **${o.promo}** is already on this order.`;
  if (!(o.subtotal > 0)) return 'This order has no fixed price yet – tell the seller your code.';
  return null;
}

/** "🏷️ Got a promo code?" on the order card (src/tickets/ui.js) while one can still be added. */
function addToCard(c, ticket) {
  if (blocked(ticket)) return c;
  c.addSectionComponents(buttonSection('🏷️ **Got a promo code?** Add it here – the price and the payment link update right away.', btn('tpromo:open', 'Add promo code', '🏷️')));
  return c;
}

function requireBuyer(interaction) {
  const ticket = db.getTicket(interaction.channel?.id);
  if (!ticket) throw new UserError('This only works in an order ticket.');
  if (interaction.user.id !== ticket.ownerId && !require('../lib/permissions').isStaff(interaction.member)) throw new UserError('Only the buyer can add a code here.');
  const why = blocked(ticket);
  if (why) throw new UserError(why);
  return ticket;
}

function openForm(interaction) {
  requireBuyer(interaction);
  const input = new TextInputBuilder().setCustomId('code').setLabel('Promo code').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setPlaceholder('e.g. NOX10');
  return interaction.showModal(new ModalBuilder().setCustomId('tpromo:submit').setTitle('Add a promo code').addComponents(new ActionRowBuilder().addComponents(input)));
}

/** Removes the bot's payment cards (the manual "Pay X€" card) from the ticket – links are replaced by stripe.js / paypal.js. */
async function removePaymentCards(channel) {
  const recent = await channel.messages?.fetch?.({ limit: 50 }).catch(() => null);
  const me = channel.client?.user?.id;
  for (const m of recent?.values?.() ?? []) {
    if (me && m.author?.id !== me) continue;
    const json = JSON.stringify(m.components ?? []);
    if (json.includes('"pay:open"') || /## [^"]*(Pay \d|Payment – )/.test(json)) await m.delete().catch(() => null);
  }
}

async function submit(interaction) {
  const ticket = requireBuyer(interaction);
  const shop = require('./shop');
  const o = ticket.order;
  const code = promos.normalize(interaction.fields.getTextInputValue('code'));
  if (!code) throw new UserError('Type a promo code.');
  const { promo, error } = promos.check(ticket.guildId, code, ticket.ownerId, {
    completedOrders: db.guild(ticket.guildId).orders[ticket.ownerId] ?? 0,
    openOrders: promos.openOrdersOf(ticket.guildId, ticket.ownerId, { except: ticket.channelId }),
    reserved: promos.reservedBy(ticket.guildId, code, { except: ticket.channelId }),
  });
  if (error || !promo) throw new UserError(`Code **${code}** can't be used: ${error ?? 'it doesn\'t exist'}.`);
  if (promo.affiliate?.userId === ticket.ownerId) throw new UserError('You can\'t use your own creator code.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { total, discount } = promos.apply(promo, o.subtotal);
  const price = { unitPrice: o.unitPrice ?? o.subtotal, listPrice: o.listPrice ?? null, salePercent: o.salePercent ?? null, subtotal: o.subtotal, total, discount, code, promo, error: null };
  const quantity = o.items ? 1 : o.quantity ?? 1;
  const answers = [...(ticket.answers ?? []).filter((a) => a.label !== 'Price' && a.label !== 'Promo code'), ...shop.priceAnswers(price, quantity)];
  const order = { ...o, promo: code, promoError: null, total, discount };
  if (promo.affiliate) order.affiliate = { code: promo.code, userId: promo.affiliate.userId, commission: promo.affiliate.commission };
  if (order.cryptoQuote) delete order.cryptoQuote;
  let updated = db.updateTicket(ticket.channelId, { order, answers });
  const channel = interaction.channel;
  await removePaymentCards(channel);
  await tickets().refreshControlMessage(channel, updated).catch(() => null);
  await channel.send(notice(COLORS.success, `🏷️ Code **${code}** added – **−${money(discount)}**. New total: **${money(total)}**.`)).catch(() => null);
  // A new payment card / link for the new amount – the same way a new order gets one.
  const type = require('./paycards').methodType(require('./paycards').methodOf(order));
  updated = db.getTicket(ticket.channelId);
  try {
    if (type === 'stripe' && require('./stripe').enabled()) await require('./stripe').postLink(channel, updated);
    else if (type === 'paypal' && require('./paypal').enabled()) await require('./paypal').postLink(channel, updated);
    else await require('./paycards').postCard(channel, updated);
  } catch (err) {
    console.warn(`[ticketpromo] new payment link for ${ticket.channelId}:`, err.message);
    await require('./paycards').postCard(channel, db.getTicket(ticket.channelId)).catch(() => null);
  }
  return interaction.editReply({ content: `✅ Code **${code}** added – the new total is **${money(total)}**.` });
}

hooks.route('tpromo', {
  button: (interaction, action) => (action === 'open' ? openForm(interaction) : null),
  modal: (interaction, action) => (action === 'submit' ? submit(interaction) : null),
});

module.exports = { blocked, addToCard };
