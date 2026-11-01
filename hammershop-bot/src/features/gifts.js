'use strict';

/**
 * Gifts – buying for a friend. The buyer clicks "🎁 Make it a gift" on the card of their open order and picks a
 * member: when the product is delivered (src/features/delivery.js) it goes to that member by DM ("🎁 A gift from
 * @buyer"), a copy is posted in the ticket for the buyer, and the buyer is told whether the DM got through. The
 * receipt stays with the buyer. The gift can be changed or removed until the product is delivered.
 *
 * ticket.order.giftTo = the user ID of the member who gets the product
 *
 * Components:
 *   gift:open    "Make it a gift" / "Change gift" on the order card → the member picker (buyer only)
 *   gift:pick    the member picker
 *   gift:remove  "Not a gift" – the product goes to the buyer again
 */

const { MessageFlags, UserSelectMenuBuilder } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const { COLORS } = require('../lib/theme');
const { UserError, embed, truncate } = require('../lib/utils');
const { text, btn, row, buttonSection, notice } = require('../lib/v2');

// Here – tickets.js and delivery.js need the ticket card, which needs this file.
const tickets = () => require('../tickets/tickets');
const delivery = () => require('./delivery');

const enabled = () => config.gifts?.enabled !== false;

/** The member who gets the product of this order – null when it isn't a gift. */
const recipientOf = (ticket) => ticket?.order?.giftTo ?? null;

/** Why this order's gift can't be set or changed now – or null when it can. */
function lockedReason(ticket) {
  if (!ticket || ticket.typeId !== 'order' || !ticket.order) return 'Prezentem mogą być tylko zamówienia ze sklepu.';
  if (ticket.order.topUp) return 'Doładowanie salda nie może być prezentem.';
  if (ticket.status !== 'open') return 'Ten ticket jest zamknięty.';
  if (ticket.completedAt || ticket.order.delivered) return 'To zamówienie zostało już dostarczone – prezentu nie można już zmienić.';
  if (delivery().isDelivering(ticket.channelId)) return 'Produkt jest właśnie dostarczany.';
  return null;
}

/** The gift line on the order card (src/tickets/ui.js): the button while it can be changed, the recipient after. */
function addToCard(c, ticket) {
  const to = recipientOf(ticket);
  const changeable = enabled() && !lockedReason(ticket);
  if (!changeable) {
    if (to) c.addTextDisplayComponents(text(`🎁 **Prezent dla <@${to}>** – produkt trafi do odbiorcy w wiadomości prywatnej, a potwierdzenie zakupu zostaje u <@${ticket.ownerId}>.`));
    return c;
  }
  const content = to
    ? `🎁 **Prezent dla <@${to}>** – odbiorca dostanie produkt w wiadomości prywatnej po dostarczeniu, a potwierdzenie zakupu zostaje u Ciebie.`
    : '🎁 **Kupujesz dla znajomego?** Kup jako prezent – produkt trafi prosto do odbiorcy w wiadomości prywatnej.';
  c.addSectionComponents(buttonSection(content, btn('gift:open', to ? 'Zmień prezent' : 'Kup jako prezent', '🎁')));
  return c;
}

/** The order ticket of this click, if its buyer clicked and the gift can still be changed (a UserError otherwise). */
function requireBuyer(interaction) {
  const ticket = db.getTicket(interaction.channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('To działa tylko w tickecie zamówienia.');
  if (ticket.ownerId !== interaction.user.id) throw new UserError('Tylko kupujący może zamienić to zamówienie w prezent.');
  if (!enabled()) throw new UserError('Prezenty są wyłączone na tym serwerze.');
  const locked = lockedReason(ticket);
  if (locked) throw new UserError(locked);
  return ticket;
}

/** "Make it a gift" → the member picker (only the buyer sees it). */
function openPicker(interaction) {
  const ticket = requireBuyer(interaction);
  const to = recipientOf(ticket);
  const rows = [row(new UserSelectMenuBuilder().setCustomId('gift:pick').setPlaceholder('Kto ma dostać produkt?').setMinValues(1).setMaxValues(1))];
  if (to) rows.push(row(btn('gift:remove', 'To nie prezent – wyślij do mnie', '↩️')));
  return interaction.reply({
    embeds: [
      embed(COLORS.brand)
        .setTitle('🎁 Kup jako prezent')
        .setDescription(
          `${to ? `Teraz to prezent dla <@${to}>. Wybierz kogoś innego albo zostaw produkt dla siebie.` : `Wybierz członka serwera, który dostanie **${truncate(ticket.order.product ?? 'to zamówienie', 100)}**.`}\n` +
            '-# Odbiorca dostanie produkt w wiadomości prywatnej zaraz po dostarczeniu – Ty też zobaczysz go tutaj i zachowasz potwierdzenie zakupu. Do tego czasu możesz to zmienić.',
        ),
    ],
    components: rows,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

/** Checks the picked member: on this server, not a bot, not the buyer. */
async function checkRecipient(guild, buyerId, user) {
  if (!user) throw new UserError('Wybierz członka serwera.');
  if (user.bot) throw new UserError('Boty nie mogą dostawać prezentów – wybierz członka serwera.');
  if (user.id === buyerId) throw new UserError('To Ty – jeśli produkt ma trafić do Ciebie, po prostu nie zamieniaj zamówienia w prezent.');
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
  if (!member) throw new UserError('Tej osoby nie ma już na serwerze – wybierz kogoś innego.');
  return member;
}

/** Saves the gift (or removes it: userId null), refreshes the order card and tells the ticket. */
async function setGift(channel, userId) {
  const ticket = db.getTicket(channel.id);
  const before = recipientOf(ticket);
  const order = { ...ticket.order };
  if (userId) order.giftTo = userId;
  else delete order.giftTo;
  const updated = db.updateTicket(channel.id, { order });
  await tickets().refreshControlMessage(channel, updated);
  const line = userId
    ? `🎁 Zamówienie <@${ticket.ownerId}> to teraz prezent dla <@${userId}>${before ? ` (zamiast <@${before}>)` : ''} – po dostarczeniu produkt trafi do odbiorcy w wiadomości prywatnej. Potwierdzenie zakupu zostaje u kupującego.`
    : `🎁 To zamówienie nie jest już prezentem – produkt trafi do <@${ticket.ownerId}>.`;
  await channel.send(notice(COLORS.brand, line)).catch(() => null);
  return updated;
}

/** gift:pick – the buyer picked the member. */
async function pick(interaction) {
  const ticket = requireBuyer(interaction);
  const user = interaction.users?.first?.() ?? null;
  await checkRecipient(interaction.guild, ticket.ownerId, user);
  await interaction.deferUpdate();
  await setGift(interaction.channel, user.id);
  return interaction.editReply({
    embeds: [embed(COLORS.success).setDescription(`🎁 Teraz to prezent dla <@${user.id}> – odbiorca dostanie produkt w wiadomości prywatnej po dostarczeniu. Do tego czasu możesz to zmienić.`)],
    components: [],
    allowedMentions: { parse: [] },
  });
}

/** gift:remove – the product goes to the buyer again. */
async function removeGift(interaction) {
  const ticket = requireBuyer(interaction);
  if (!recipientOf(ticket)) throw new UserError('To zamówienie nie jest prezentem.');
  await interaction.deferUpdate();
  await setGift(interaction.channel, null);
  return interaction.editReply({ embeds: [embed(COLORS.success).setDescription('↩️ To już nie prezent – produkt trafi do Ciebie.')], components: [] });
}

/** The ticket's note after a gift was delivered: did the DM reach the recipient? */
function deliveredNotice(ticket, giftTo, dm, { many = false } = {}) {
  return dm
    ? notice(COLORS.success, `🎁 <@${ticket.ownerId}> Twój prezent został dostarczony – ${many ? 'produkty trafiły' : 'produkt trafił'} do <@${giftTo}> w wiadomości prywatnej.`, { mentions: { users: [ticket.ownerId] } })
    : notice(
        COLORS.warning,
        `📭 <@${ticket.ownerId}> nie udało się wysłać wiadomości prywatnej do <@${giftTo}> (zamknięte wiadomości prywatne albo tej osoby nie ma już na serwerze) – ${many ? 'produkty są' : 'produkt jest'} tuż powyżej, przekaż ${many ? 'je' : 'go'} odbiorcy samodzielnie.`,
        { mentions: { users: [ticket.ownerId] } },
      );
}

hooks.route('gift', {
  button: (interaction, action) => {
    if (action === 'open') return openPicker(interaction);
    if (action === 'remove') return removeGift(interaction);
    return null;
  },
  userSelect: (interaction, action) => (action === 'pick' ? pick(interaction) : null),
});

module.exports = { enabled, recipientOf, lockedReason, addToCard, checkRecipient, setGift, deliveredNotice };
