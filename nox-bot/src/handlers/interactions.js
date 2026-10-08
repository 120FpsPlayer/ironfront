'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const panels = require('../lib/panels');
const t = require('../tickets/tickets');
const { createTranscript } = require('../tickets/transcript');
const { env } = require('../env');
const { UserError, COLORS, embed, reply, replyError, isStaff, isAdmin, pad } = require('../lib/utils');
const verification = require('../features/verification');
const selfroles = require('../features/selfroles');
const shop = require('../features/shop');
const vouches = require('../features/vouches');
const giveaways = require('../features/giveaways');
const announce = require('../features/announce');
const orderstatus = require('../features/orderstatus');
const { statusLabel } = require('../lib/orderStatus');
const buildSession = require('../builder/session');

const ephemeral = { flags: MessageFlags.Ephemeral };

/** After picking from a dropdown panel, reset it so the same option can be picked again. */
function resetSelectPanel(interaction, kind) {
  if (!interaction.isStringSelectMenu?.() || !interaction.message) return;
  const panel = db.panels(interaction.guild.id).find((p) => p.messageId === interaction.message.id);
  Promise.resolve(panels.render(kind, interaction.guild, panel ?? {}))
    .then((payload) => interaction.message.edit(payload))
    .catch(() => null);
}

async function createAndRespond(interaction, type, answers) {
  await interaction.deferReply(ephemeral);
  try {
    const channel = await t.openTicket(interaction.member, type, answers);
    await interaction.editReply({
      embeds: [
        embed(COLORS.success)
          .setTitle(`${type.emoji ?? '🎫'} Ticket created!`)
          .setDescription(`Your ticket is ready: ${channel}\nThe team has been notified – we'll reply as soon as possible.`),
      ],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Go to ticket').setEmoji('🎫').setURL(channel.url))],
    });
  } catch (err) {
    if (!(err instanceof UserError)) console.error('[open]', err);
    await replyError(interaction, err instanceof UserError ? err.message : 'Failed to create the ticket. Make sure the bot has permission to manage channels and roles.');
  }
}

/** Purchases only go through the Buy buttons in #shop – older buttons and the ticket menu point there. */
function replyShopOnly(interaction) {
  const shopId = db.channelId(interaction.guild.id, 'shop');
  const payload = {
    embeds: [
      embed(COLORS.brand).setDescription(
        `🛒 **Buying something?** Go to ${shopId ? `<#${shopId}>` : 'the shop'} and click **Buy** next to the product you want – your private order ticket opens right away.`,
      ),
    ],
    components: shopId ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Go to shop').setEmoji('🛒').setURL(`https://discord.com/channels/${interaction.guild.id}/${shopId}`))] : [],
    flags: MessageFlags.Ephemeral,
  };
  return interaction.reply(payload);
}

async function handleOpen(interaction, typeId, origin) {
  if (origin === 's') resetSelectPanel(interaction, 'tickets');
  const type = config.getType(typeId);
  if (!type) return replyError(interaction, 'This category no longer exists – ask the staff to refresh the panel.');
  if (type.shopOnly) return replyShopOnly(interaction);
  const error = t.checkCanOpen(interaction.member);
  if (error) return replyError(interaction, error);
  if (type.questions.length) return interaction.showModal(t.buildForm(type, origin));
  return createAndRespond(interaction, type, []);
}

async function handleForm(interaction, typeId) {
  const type = config.getType(typeId);
  if (!type) return replyError(interaction, 'This category no longer exists.');
  if (type.shopOnly) return replyShopOnly(interaction);
  const answers = type.questions.map((q) => {
    let value = '';
    try {
      value = interaction.fields.getTextInputValue(q.id)?.trim() ?? '';
    } catch {
      value = '';
    }
    return { label: q.label, value };
  });
  return createAndRespond(interaction, type, answers);
}

function closeReasonModal() {
  return new ModalBuilder()
    .setCustomId('ticket:close_modal')
    .setTitle('🔒 Close ticket')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Close reason')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('reason').setPlaceholder('E.g. order delivered, issue resolved…').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
        ),
    );
}

async function handleTicketButton(interaction, action) {
  const { channel, member } = interaction;
  const ticket = db.getTicket(channel.id);
  if (!ticket) return replyError(interaction, 'This channel is no longer a ticket.');
  const type = config.getType(ticket.typeId);
  const staff = isStaff(member, type);
  const isOwner = ticket.ownerId === member.id;
  const canClose = staff || (isOwner && env.ownerCanClose);

  switch (action) {
    case 'close':
      if (!canClose) return replyError(interaction, 'You cannot close this ticket.');
      if (ticket.status !== 'open') return replyError(interaction, 'This ticket is already closed.');
      return reply(interaction, {
        embeds: [embed(COLORS.warning).setTitle('❓ Close this ticket?').setDescription('After closing, the author loses access to the channel and the transcript is saved.')],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket:close_confirm').setLabel('Yes, close it').setEmoji('🔒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('ticket:close_reason').setLabel('Close with reason').setEmoji('📝').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });

    case 'close_confirm':
      if (!canClose) return replyError(interaction, 'You cannot close this ticket.');
      await interaction.update({ embeds: [embed(COLORS.muted).setDescription('⏳ Closing the ticket and saving the transcript…')], components: [] });
      await t.closeTicket(channel, member);
      return interaction.editReply({ embeds: [embed(COLORS.success).setDescription('✅ Ticket closed.')] }).catch(() => null);

    case 'close_reason':
      if (!canClose) return replyError(interaction, 'You cannot close this ticket.');
      return interaction.showModal(closeReasonModal());

    case 'claim':
      if (!staff) return replyError(interaction, 'Only staff members can claim tickets.');
      await interaction.deferReply(ephemeral);
      await t.claimTicket(channel, member);
      return reply(interaction, 'You claimed this ticket. Good luck! 💪');

    case 'unclaim':
      if (!staff) return replyError(interaction, 'Only staff members can do this.');
      await interaction.deferReply(ephemeral);
      await t.unclaimTicket(channel, member);
      return reply(interaction, 'You are no longer handling this ticket.');

    case 'ping':
      await interaction.deferReply(ephemeral);
      await t.pingStaff(channel, member);
      return reply(interaction, 'Support has been notified 🔔');

    case 'still':
      await interaction.deferReply(ephemeral);
      await t.stillNeedHelp(channel, member, interaction.message);
      return reply(interaction, 'Thanks! The ticket stays open.');

    case 'closereq_yes':
    case 'closereq_no':
      if (!isOwner && !staff) return replyError(interaction, 'Only the ticket author can answer this request.');
      if (!isOwner && action === 'closereq_no') return replyError(interaction, 'Only the author can decline this request.');
      await interaction.deferReply(ephemeral);
      await t.answerCloseRequest(channel, member, action === 'closereq_yes', interaction.message);
      return reply(interaction, action === 'closereq_yes' ? 'Ticket closed – thank you!' : 'Support has been notified that you still need help.');

    case 'reopen':
      if (!staff) return replyError(interaction, 'Only staff members can reopen tickets.');
      await interaction.deferReply(ephemeral);
      await t.reopenTicket(channel, member);
      await interaction.message.delete().catch(() => null);
      return reply(interaction, 'The ticket has been reopened.');

    case 'delete':
      if (!(env.staffCanDelete ? staff : isAdmin(member))) {
        return replyError(interaction, env.staffCanDelete ? 'Only staff members can delete tickets.' : 'Only administrators can delete tickets.');
      }
      await interaction.deferReply(ephemeral);
      await t.deleteTicket(channel, member);
      return reply(interaction, 'The ticket will be deleted in a moment.');

    case 'transcript': {
      if (!staff) return replyError(interaction, 'Transcripts are only available to staff members.');
      await interaction.deferReply(ephemeral);
      const { attachment, messageCount } = await createTranscript(channel, ticket, type);
      return interaction.editReply({
        embeds: [embed(COLORS.brand).setDescription(`📄 Current transcript of ticket \`#${pad(ticket.number)}\` · ${messageCount} messages`)],
        files: [attachment],
      });
    }
    default:
      return null;
  }
}

async function handleManage(interaction) {
  const { channel, member } = interaction;
  const ticket = db.getTicket(channel.id);
  if (!ticket) return replyError(interaction, 'This channel is no longer a ticket.');
  if (!isStaff(member, config.getType(ticket.typeId))) {
    await t.refreshControlMessage(channel, ticket);
    return replyError(interaction, 'This menu is only available to staff members.');
  }
  if (interaction.values[0] === 'complete') return showCompleteForm(interaction, channel);
  await interaction.deferReply(ephemeral);
  const [kind, value] = interaction.values[0].split(':');
  try {
    if (kind === 'prio') {
      await t.setPriority(channel, value, member);
      return await reply(interaction, 'Priority changed.');
    }
    if (kind === 'move') {
      await t.moveTicket(channel, value, member);
      return await reply(interaction, 'The ticket has been moved.');
    }
    if (kind === 'closereq') {
      await t.requestClose(channel, member);
      await t.refreshControlMessage(channel, ticket);
      return await reply(interaction, 'Close request sent to the author.');
    }
    if (kind === 'deliver') {
      const done = await require('../features/delivery').confirmAndDeliver(channel, member, { again: Boolean(db.getTicket(channel.id)?.order?.delivered) });
      return await reply(interaction, done);
    }
    if (kind === 'status') {
      const { dm } = await orderstatus.setStatus(channel, value, member);
      return await reply(interaction, `Order status set to **${statusLabel(value)}**${dm ? ' – the customer got a DM.' : '.'}`);
    }
    return null;
  } catch (err) {
    await t.refreshControlMessage(channel, ticket);
    throw err;
  }
}

/** "Order completed" → a form where the seller confirms the amount paid (handled in src/features/orders.js). */
async function showCompleteForm(interaction, channel) {
  try {
    await interaction.showModal(t.completeForm(channel));
  } finally {
    // Reset the menu, so "Order completed" can be picked again if the form is closed.
    await t.refreshControlMessage(channel, db.getTicket(channel.id));
  }
}

async function handleAddUser(interaction) {
  const { channel, member } = interaction;
  const ticket = db.getTicket(channel.id);
  if (!ticket) return replyError(interaction, 'This channel is no longer a ticket.');
  if (!isStaff(member, config.getType(ticket.typeId))) {
    await t.refreshControlMessage(channel, ticket);
    return replyError(interaction, 'Only staff members can add people.');
  }
  await interaction.deferReply(ephemeral);
  try {
    const count = await t.addUsers(channel, [...interaction.users.values()], member);
    return await reply(interaction, `Added ${count} ${count === 1 ? 'member' : 'members'}.`);
  } catch (err) {
    await t.refreshControlMessage(channel, ticket);
    throw err;
  }
}

function ratingModal(channelId, stars) {
  return new ModalBuilder()
    .setCustomId(`ratemodal:${channelId}:${stars}`)
    .setTitle(`Your rating: ${'⭐'.repeat(stars)}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Comment (optional)')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('comment').setPlaceholder('What went well, and what could we improve?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
        ),
    );
}

async function handleRatingSubmit(interaction, channelId, stars) {
  let comment = '';
  try {
    comment = interaction.fields.getTextInputValue('comment')?.trim() ?? '';
  } catch {
    comment = '';
  }
  await t.saveRating(interaction.client, channelId, interaction.user.id, stars, comment);
  const thanks = embed(stars >= 4 ? COLORS.success : COLORS.brand)
    .setTitle(stars >= 4 ? '💜 Thanks for the great rating!' : '💜 Thanks for your rating!')
    .setDescription(
      `## ${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)}\n` +
        (comment ? `>>> ${comment}` : '') +
        (stars <= 2 ? "\n\nWe're sorry something went wrong – we'll pass your feedback on to the team." : ''),
    );
  if (interaction.isFromMessage()) return interaction.update({ embeds: [...interaction.message.embeds, thanks], components: [] });
  return reply(interaction, { embeds: [thanks] });
}

/** Routes buttons, menus and modals by the first part of their custom ID. */
async function handleComponent(interaction) {
  const [scope, action, ...args] = interaction.customId.split(':');

  // Features that registered themselves with hooks.route()
  const plugin = hooks.routeFor(scope);
  if (plugin) {
    if (interaction.isButton() && plugin.button) return plugin.button(interaction, action, args);
    if (interaction.isStringSelectMenu() && plugin.select) return plugin.select(interaction, action, args);
    if (interaction.isUserSelectMenu() && plugin.userSelect) return plugin.userSelect(interaction, action, args);
    if (interaction.isModalSubmit() && plugin.modal) return plugin.modal(interaction, action, args);
    return null;
  }

  if (interaction.isButton()) {
    switch (scope) {
      case 'ticket':
        if (action === 'open') return handleOpen(interaction, args[0], 'b');
        return handleTicketButton(interaction, action);
      case 'rate': {
        const ticket = db.getTicket(action);
        if (ticket?.rating) return replyError(interaction, 'This ticket has already been rated. Thank you!');
        return interaction.showModal(ratingModal(action, Number(args[0])));
      }
      case 'verify':
        return verification.handleButton(interaction);
      case 'sr':
        return selfroles.handleButton(interaction);
      case 'shop':
        if (action === 'buy') return shop.startOrder(interaction, args[0]);
        return null;
      case 'vouch':
        return vouches.openModal(interaction);
      case 'gw':
        return giveaways.toggleEntry(interaction);
      case 'build':
        return buildSession.handle(interaction);
      default:
        return null;
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'ticket:open') return handleOpen(interaction, interaction.values[0], 's');
    if (interaction.customId === 'ticket:manage') return handleManage(interaction);
    if (interaction.customId === 'shop:select') {
      resetSelectPanel(interaction, 'shop');
      return shop.startOrder(interaction, interaction.values[0]);
    }
    return null;
  }

  if (interaction.isUserSelectMenu() && interaction.customId === 'ticket:adduser') return handleAddUser(interaction);

  if (interaction.isModalSubmit()) {
    switch (scope) {
      case 'ticket':
        if (action === 'form') return handleForm(interaction, args[0]);
        if (action === 'close_modal') {
          const ticket = db.getTicket(interaction.channel.id);
          const type = ticket && config.getType(ticket.typeId);
          if (!ticket || (!isStaff(interaction.member, type) && !(ticket.ownerId === interaction.user.id && env.ownerCanClose))) {
            return replyError(interaction, 'You cannot close this ticket.');
          }
          const reason = interaction.fields.getTextInputValue('reason');
          if (interaction.isFromMessage()) {
            await interaction.update({ embeds: [embed(COLORS.muted).setDescription('⏳ Closing the ticket and saving the transcript…')], components: [] });
          } else {
            await interaction.deferReply(ephemeral);
          }
          await t.closeTicket(interaction.channel, interaction.member, reason);
          return interaction.editReply({ embeds: [embed(COLORS.success).setDescription('✅ Ticket closed.')] }).catch(() => null);
        }
        return null;
      case 'ratemodal':
        return handleRatingSubmit(interaction, action, Number(args[0]));
      case 'verify':
        return verification.handleAnswer(interaction);
      case 'shop':
        return shop.submitOrder(interaction, args[0]);
      case 'vouch':
        return vouches.submitModal(interaction);
      case 'ann':
        return announce.submit(interaction);
      case 'build':
        return buildSession.handle(interaction);
      default:
        return null;
    }
  }
  return null;
}

/**
 * Discord gives the bot 3 seconds to answer a click or a form. 10062 = it came too late (the bot was busy
 * starting, the host is slow or the connection lagged) – nothing happened, the user can just try again.
 * 40060 = something else already answered it, which means a second copy of the bot runs with the same token.
 * Neither can be answered any more, so this is one clear console line instead of a stack trace.
 */
const TOO_LATE = new Set([10062, 40060]);
const lateClicks = [];
function reportTooLate(interaction, err) {
  const what = interaction.customId ? `A click (${interaction.customId})` : `/${interaction.commandName}`;
  if (err.code === 40060) {
    console.warn(`⚠️  ${what} was already answered by another bot process – is the bot running twice with the same token (e.g. on your PC and on the host)? Stop the extra copy.`);
    return;
  }
  const age = ((Date.now() - interaction.createdTimestamp) / 1000).toFixed(1);
  console.warn(`⏳ ${what} expired before the bot could answer (Discord allows 3 s, it was ${age} s old). Nothing was created – the user can simply try again.`);
  const now = Date.now();
  lateClicks.push(now);
  while (lateClicks.length && now - lateClicks[0] > 10 * 60_000) lateClicks.shift();
  if (lateClicks.length === 3) {
    console.warn('   This keeps happening – the host is too slow or far away. Use Node.js 20 or newer and a faster plan or a host region close to Discord (EU/US).');
  }
}

module.exports = async function handleInteraction(interaction, commands) {
  try {
    if (!interaction.inGuild() || !interaction.guild) {
      // Ticket ratings are sent by DM – those buttons and forms must work outside the server.
      const id = interaction.customId ?? '';
      if (id.startsWith('rate:') || id.startsWith('ratemodal:') || hooks.routeFor(id.split(':')[0])?.dm) {
        await handleComponent(interaction);
        return;
      }
      if (interaction.isRepliable()) await interaction.reply({ content: `${config.brand.name} commands work on the server only.`, flags: MessageFlags.Ephemeral });
      return;
    }
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (command) await command.execute(interaction);
      return;
    }
    if ('customId' in interaction) await handleComponent(interaction);
  } catch (err) {
    if (interaction.isAutocomplete()) return;
    if (err instanceof UserError) {
      await replyError(interaction, err.message).catch(() => null);
      return;
    }
    if (TOO_LATE.has(err?.code)) return reportTooLate(interaction, err);
    console.error('[interaction]', interaction.customId ?? interaction.commandName, err);
    const missing = err?.code === 50013;
    await replyError(
      interaction,
      missing
        ? "I'm missing permissions for that. Make sure my role has **Administrator** and is at the top of the role list."
        : 'An unexpected error occurred. Please try again in a moment.',
    ).catch(() => null);
  }
};
