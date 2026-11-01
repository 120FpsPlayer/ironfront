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
  if (!ticket || ticket.typeId !== 'order' || !ticket.order) return 'Only shop orders can be a gift.';
  if (ticket.order.topUp) return "A balance top-up can't be a gift.";
  if (ticket.status !== 'open') return 'This ticket is closed.';
  if (ticket.completedAt || ticket.order.delivered) return 'This order was already delivered – the gift can no longer be changed.';
  if (delivery().isDelivering(ticket.channelId)) return 'The product is being delivered right now.';
  return null;
}

/** The gift line on the order card (src/tickets/ui.js): the button while it can be changed, the recipient after. */
function addToCard(c, ticket) {
  const to = recipientOf(ticket);
  const changeable = enabled() && !lockedReason(ticket);
  if (!changeable) {
    if (to) c.addTextDisplayComponents(text(`🎁 **Gift for <@${to}>** – the product goes to their DMs, the receipt stays with <@${ticket.ownerId}>.`));
    return c;
  }
  const content = to
    ? `🎁 **Gift for <@${to}>** – they get the product by DM when it's delivered; the receipt stays with you.`
    : '🎁 **Buying for a friend?** Make it a gift – the product goes straight to their DMs.';
  c.addSectionComponents(buttonSection(content, btn('gift:open', to ? 'Change gift' : 'Make it a gift', '🎁')));
  return c;
}

/** The order ticket of this click, if its buyer clicked and the gift can still be changed (a UserError otherwise). */
function requireBuyer(interaction) {
  const ticket = db.getTicket(interaction.channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This only works in an order ticket.');
  if (ticket.ownerId !== interaction.user.id) throw new UserError('Only the buyer can make this order a gift.');
  if (!enabled()) throw new UserError('Gifts are turned off on this server.');
  const locked = lockedReason(ticket);
  if (locked) throw new UserError(locked);
  return ticket;
}

/** "Make it a gift" → the member picker (only the buyer sees it). */
function openPicker(interaction) {
  const ticket = requireBuyer(interaction);
  const to = recipientOf(ticket);
  const rows = [row(new UserSelectMenuBuilder().setCustomId('gift:pick').setPlaceholder('Who gets the product?').setMinValues(1).setMaxValues(1))];
  if (to) rows.push(row(btn('gift:remove', 'Not a gift – send it to me', '↩️')));
  return interaction.reply({
    embeds: [
      embed(COLORS.brand)
        .setTitle('🎁 Make it a gift')
        .setDescription(
          `${to ? `Right now it's a gift for <@${to}>. Pick someone else, or make it yours again.` : `Pick the member who gets **${truncate(ticket.order.product ?? 'this order', 100)}**.`}\n` +
            "-# They get the product by DM as soon as it's delivered – you see it here too and keep the receipt. You can change it until then.",
        ),
    ],
    components: rows,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

/** Checks the picked member: on this server, not a bot, not the buyer. */
async function checkRecipient(guild, buyerId, user) {
  if (!user) throw new UserError('Pick a member.');
  if (user.bot) throw new UserError("Bots can't get gifts – pick a member.");
  if (user.id === buyerId) throw new UserError("That's you – to get the product yourself, just don't make it a gift.");
  const member = guild.members.cache.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
  if (!member) throw new UserError("That member isn't on this server any more – pick someone else.");
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
    ? `🎁 <@${ticket.ownerId}> made this order a gift for <@${userId}>${before ? ` (instead of <@${before}>)` : ''} – the product goes to their DMs when it's delivered. The receipt stays with the buyer.`
    : `🎁 This order is no longer a gift – the product goes to <@${ticket.ownerId}>.`;
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
    embeds: [embed(COLORS.success).setDescription(`🎁 It's a gift for <@${user.id}> now – they get the product by DM when it's delivered. You can change it until then.`)],
    components: [],
    allowedMentions: { parse: [] },
  });
}

/** gift:remove – the product goes to the buyer again. */
async function removeGift(interaction) {
  const ticket = requireBuyer(interaction);
  if (!recipientOf(ticket)) throw new UserError("This order isn't a gift.");
  await interaction.deferUpdate();
  await setGift(interaction.channel, null);
  return interaction.editReply({ embeds: [embed(COLORS.success).setDescription('↩️ Not a gift any more – the product comes to you.')], components: [] });
}

/** The ticket's note after a gift was delivered: did the DM reach the recipient? */
function deliveredNotice(ticket, giftTo, dm, { many = false } = {}) {
  const what = many ? 'products' : 'product';
  return dm
    ? notice(COLORS.success, `🎁 <@${ticket.ownerId}> your gift is delivered – <@${giftTo}> got the ${what} by DM.`, { mentions: { users: [ticket.ownerId] } })
    : notice(
        COLORS.warning,
        `📭 <@${ticket.ownerId}> I couldn't DM <@${giftTo}> (their DMs are closed, or they left the server) – the ${what} ${many ? 'are' : 'is'} right above, please pass ${many ? 'them' : 'it'} on to them yourself.`,
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
