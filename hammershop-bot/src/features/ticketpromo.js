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
  if (config.promos?.enabled === false) return 'Kody rabatowe są wyłączone.';
  if (!o || ticket.typeId !== 'order' || ticket.status !== 'open' || ticket.completedAt) return 'To działa tylko w otwartym tickecie zamówienia.';
  if (o.topUp) return 'Kody rabatowe nie działają przy doładowaniu salda.';
  if (o.paidWith || statusOf(ticket) !== 'awaiting') return 'To zamówienie jest już w trakcie płatności – kod można dodać tylko przed zapłatą.';
  if (o.promo && !o.promoError) return `Kod **${o.promo}** jest już dodany do tego zamówienia.`;
  if (!(o.subtotal > 0)) return 'To zamówienie nie ma jeszcze ustalonej ceny – podaj swój kod sprzedawcy.';
  return null;
}

/** "🏷️ Got a promo code?" on the order card (src/tickets/ui.js) while one can still be added. */
function addToCard(c, ticket) {
  if (blocked(ticket)) return c;
  c.addSectionComponents(buttonSection('🏷️ **Masz kod rabatowy?** Dodaj go tutaj – cena i link do płatności od razu się zaktualizują.', btn('tpromo:open', 'Dodaj kod rabatowy', '🏷️')));
  return c;
}

function requireBuyer(interaction) {
  const ticket = db.getTicket(interaction.channel?.id);
  if (!ticket) throw new UserError('To działa tylko w tickecie zamówienia.');
  if (interaction.user.id !== ticket.ownerId && !require('../lib/permissions').isStaff(interaction.member)) throw new UserError('Tylko kupujący może tu dodać kod.');
  const why = blocked(ticket);
  if (why) throw new UserError(why);
  return ticket;
}

function openForm(interaction) {
  requireBuyer(interaction);
  const input = new TextInputBuilder().setCustomId('code').setLabel('Kod rabatowy').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setPlaceholder('np. HS10');
  return interaction.showModal(new ModalBuilder().setCustomId('tpromo:submit').setTitle('Dodaj kod rabatowy').addComponents(new ActionRowBuilder().addComponents(input)));
}

/**
 * Removes only the "Pay X€ – …" payment card(s) posted after the ticket's main card – never the main card itself
 * (it has a Pay button too) or anything else. Stripe / PayPal links are replaced by stripe.js / paypal.js.
 */
async function removePaymentCards(channel, ticket) {
  const recent = await channel.messages?.fetch?.({ limit: 50 }).catch(() => null);
  const me = channel.client?.user?.id;
  const after = (id) => {
    if (!ticket.controlMessageId) return true;
    try {
      return BigInt(id) > BigInt(ticket.controlMessageId);
    } catch {
      return id !== ticket.controlMessageId;
    }
  };
  for (const m of recent?.values?.() ?? []) {
    if (m.id === ticket.controlMessageId || !after(m.id) || (me && m.author?.id !== me)) continue;
    const json = JSON.stringify(m.components ?? []);
    if (/"content":"## [^"]*?(?:Pay [^"]*? – |Payment – |Zapłać [^"]*? – |Płatność – )/.test(json)) await m.delete().catch(() => null);
  }
}

async function submit(interaction) {
  const ticket = requireBuyer(interaction);
  const shop = require('./shop');
  const o = ticket.order;
  const code = promos.normalize(interaction.fields.getTextInputValue('code'));
  if (!code) throw new UserError('Wpisz kod rabatowy.');
  const { promo, error } = promos.check(ticket.guildId, code, ticket.ownerId, {
    completedOrders: db.guild(ticket.guildId).orders[ticket.ownerId] ?? 0,
    openOrders: promos.openOrdersOf(ticket.guildId, ticket.ownerId, { except: ticket.channelId }),
    reserved: promos.reservedBy(ticket.guildId, code, { except: ticket.channelId }),
  });
  if (error || !promo) throw new UserError(`Nie można użyć kodu **${code}**. ${error ?? 'Taki kod nie istnieje.'}`);
  if (promo.affiliate?.userId === ticket.ownerId) throw new UserError('Nie możesz użyć własnego kodu twórcy.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { total, discount } = promos.apply(promo, o.subtotal);
  const price = { unitPrice: o.unitPrice ?? o.subtotal, listPrice: o.listPrice ?? null, salePercent: o.salePercent ?? null, subtotal: o.subtotal, total, discount, code, promo, error: null };
  const quantity = o.items ? 1 : o.quantity ?? 1;
  const answers = [...(ticket.answers ?? []).filter((a) => !shop.isPriceAnswer(a)), ...shop.priceAnswers(price, quantity)];
  const order = { ...o, promo: code, promoError: null, total, discount };
  if (promo.affiliate) order.affiliate = { code: promo.code, userId: promo.affiliate.userId, commission: promo.affiliate.commission };
  if (order.cryptoQuote) delete order.cryptoQuote;
  let updated = db.updateTicket(ticket.channelId, { order, answers });
  const channel = interaction.channel;
  await removePaymentCards(channel, ticket);
  await tickets().refreshControlMessage(channel, updated).catch(() => null);
  await channel.send(notice(COLORS.success, `🏷️ Kod **${code}** dodany – **−${money(discount)}**. Nowa kwota do zapłaty: **${money(total)}**.`)).catch(() => null);
  // A new payment card / link for the new amount – the same way a new order gets one.
  const type = require('./paycards').methodType(require('./paycards').methodOf(order));
  updated = db.getTicket(ticket.channelId);
  try {
    if (type === 'stripe' && require('./stripe').enabled()) await require('./stripe').postLink(channel, updated);
    else if (type === 'paypal' && require('./paypal').enabled()) await require('./paypal').postLink(channel, updated);
    else await require('./paycards').postCard(channel, updated);
  } catch (err) {
    console.warn(`[ticketpromo] nowy link do płatności dla ${ticket.channelId}:`, err.message);
    await require('./paycards').postCard(channel, db.getTicket(ticket.channelId)).catch(() => null);
  }
  return interaction.editReply({ content: `✅ Kod **${code}** dodany – nowa kwota do zapłaty to **${money(total)}**.` });
}

hooks.route('tpromo', {
  button: (interaction, action) => (action === 'open' ? openForm(interaction) : null),
  modal: (interaction, action) => (action === 'submit' ? submit(interaction) : null),
});

module.exports = { blocked, addToCard };
