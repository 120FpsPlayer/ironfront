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
const { unlocalize, slash } = require('../lib/commandsPl');
const db = require('../lib/db');
const panels = require('../lib/panels');
const t = require('../tickets/tickets');
const { createTranscript } = require('../tickets/transcript');
const { env } = require('../env');
const { UserError, COLORS, embed, reply, replyError, isStaff, isAdmin, pad, count } = require('../lib/utils');
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
          .setTitle(`${type.emoji ?? '🎫'} Ticket utworzony!`)
          .setDescription(`Twój ticket jest gotowy: ${channel}\nZespół dostał powiadomienie – odpowiemy najszybciej, jak to możliwe.`),
      ],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Przejdź do ticketu').setEmoji('🎫').setURL(channel.url))],
    });
  } catch (err) {
    if (!(err instanceof UserError)) console.error('[open]', err);
    await replyError(interaction, err instanceof UserError ? err.message : 'Nie udało się utworzyć ticketu. Sprawdź, czy bot ma uprawnienia do zarządzania kanałami i rolami.');
  }
}

/** Purchases only go through the Buy (Kup) buttons in #sklep – older buttons and the ticket menu point there. */
function replyShopOnly(interaction) {
  const shopId = db.channelId(interaction.guild.id, 'shop');
  const payload = {
    embeds: [
      embed(COLORS.brand).setDescription(
        `🛒 **Chcesz coś kupić?** Przejdź do ${shopId ? `<#${shopId}>` : 'sklepu'} i kliknij **Kup** przy wybranym produkcie – Twój prywatny ticket z zamówieniem otworzy się od razu.`,
      ),
    ],
    components: shopId ? [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Przejdź do sklepu').setEmoji('🛒').setURL(`https://discord.com/channels/${interaction.guild.id}/${shopId}`))] : [],
    flags: MessageFlags.Ephemeral,
  };
  return interaction.reply(payload);
}

async function handleOpen(interaction, typeId, origin) {
  if (origin === 's') resetSelectPanel(interaction, 'tickets');
  const type = config.getType(typeId);
  if (!type) return replyError(interaction, 'Ta kategoria już nie istnieje – poproś zespół o odświeżenie panelu.');
  if (type.shopOnly) return replyShopOnly(interaction);
  if (require('../tickets/typestate').isOff(interaction.guild.id, type)) return replyError(interaction, require('../tickets/typestate').closedText(type));
  const error = t.checkCanOpen(interaction.member);
  if (error) return replyError(interaction, error);
  if (type.questions.length) return interaction.showModal(t.buildForm(type, origin));
  return createAndRespond(interaction, type, []);
}

async function handleForm(interaction, typeId) {
  const type = config.getType(typeId);
  if (!type) return replyError(interaction, 'Ta kategoria już nie istnieje.');
  if (type.shopOnly) return replyShopOnly(interaction);
  if (require('../tickets/typestate').isOff(interaction.guild.id, type)) return replyError(interaction, require('../tickets/typestate').closedText(type));
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
    .setTitle('🔒 Zamknij ticket')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Powód zamknięcia')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('reason').setPlaceholder('Np. zamówienie dostarczone, sprawa załatwiona…').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500),
        ),
    );
}

async function handleTicketButton(interaction, action) {
  const { channel, member } = interaction;
  const ticket = db.getTicket(channel.id);
  if (!ticket) return replyError(interaction, 'Ten kanał nie jest już ticketem.');
  const type = config.getType(ticket.typeId);
  const staff = isStaff(member, type);
  const isOwner = ticket.ownerId === member.id;
  const canClose = staff || (isOwner && env.ownerCanClose);

  switch (action) {
    case 'close':
      if (!canClose) return replyError(interaction, 'Nie możesz zamknąć tego ticketu.');
      if (ticket.status !== 'open') return replyError(interaction, 'Ten ticket jest już zamknięty.');
      return reply(interaction, {
        embeds: [embed(COLORS.warning).setTitle('❓ Zamknąć ten ticket?').setDescription('Po zamknięciu autor straci dostęp do kanału, a transkrypcja zostanie zapisana.')],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket:close_confirm').setLabel('Tak, zamknij').setEmoji('🔒').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('ticket:close_reason').setLabel('Zamknij z powodem').setEmoji('📝').setStyle(ButtonStyle.Secondary),
          ),
        ],
      });

    case 'close_confirm':
      if (!canClose) return replyError(interaction, 'Nie możesz zamknąć tego ticketu.');
      await interaction.update({ embeds: [embed(COLORS.muted).setDescription('⏳ Zamykam ticket i zapisuję transkrypcję…')], components: [] });
      await t.closeTicket(channel, member);
      return interaction.editReply({ embeds: [embed(COLORS.success).setDescription('✅ Ticket zamknięty.')] }).catch(() => null);

    case 'close_reason':
      if (!canClose) return replyError(interaction, 'Nie możesz zamknąć tego ticketu.');
      return interaction.showModal(closeReasonModal());

    case 'claim':
      if (!staff) return replyError(interaction, 'Tylko zespół może przejmować tickety.');
      await interaction.deferReply(ephemeral);
      await t.claimTicket(channel, member);
      return reply(interaction, 'Przejmujesz ten ticket. Powodzenia! 💪');

    case 'unclaim':
      if (!staff) return replyError(interaction, 'Tylko zespół może to zrobić.');
      await interaction.deferReply(ephemeral);
      await t.unclaimTicket(channel, member);
      return reply(interaction, 'Nie obsługujesz już tego ticketu.');

    case 'ping':
      await interaction.deferReply(ephemeral);
      await t.pingStaff(channel, member);
      return reply(interaction, 'Zespół dostał powiadomienie 🔔');

    case 'still':
      await interaction.deferReply(ephemeral);
      await t.stillNeedHelp(channel, member, interaction.message);
      return reply(interaction, 'Dzięki! Ticket pozostaje otwarty.');

    case 'closereq_yes':
    case 'closereq_no':
      if (!isOwner && !staff) return replyError(interaction, 'Na tę prośbę może odpowiedzieć tylko autor ticketu.');
      if (!isOwner && action === 'closereq_no') return replyError(interaction, 'Tylko autor może odrzucić tę prośbę.');
      await interaction.deferReply(ephemeral);
      await t.answerCloseRequest(channel, member, action === 'closereq_yes', interaction.message);
      return reply(interaction, action === 'closereq_yes' ? 'Ticket zamknięty – dziękujemy!' : 'Zespół dostał powiadomienie, że nadal potrzebujesz pomocy.');

    case 'reopen':
      if (!staff) return replyError(interaction, 'Tylko zespół może ponownie otwierać tickety.');
      await interaction.deferReply(ephemeral);
      await t.reopenTicket(channel, member);
      await interaction.message.delete().catch(() => null);
      return reply(interaction, 'Ticket został ponownie otwarty.');

    case 'delete':
      if (!(env.staffCanDelete ? staff : isAdmin(member))) {
        return replyError(interaction, env.staffCanDelete ? 'Tylko zespół może usuwać tickety.' : 'Tylko administratorzy mogą usuwać tickety.');
      }
      await interaction.deferReply(ephemeral);
      await t.deleteTicket(channel, member);
      return reply(interaction, 'Ticket zostanie za chwilę usunięty.');

    case 'transcript': {
      if (!staff) return replyError(interaction, 'Transkrypcje są dostępne tylko dla zespołu.');
      await interaction.deferReply(ephemeral);
      const { attachment, messageCount } = await createTranscript(channel, ticket, type);
      return interaction.editReply({
        embeds: [embed(COLORS.brand).setDescription(`📄 Aktualna transkrypcja ticketu \`#${pad(ticket.number)}\` · ${count(messageCount, 'wiadomość', 'wiadomości', 'wiadomości')}`)],
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
  if (!ticket) return replyError(interaction, 'Ten kanał nie jest już ticketem.');
  if (!isStaff(member, config.getType(ticket.typeId))) {
    await t.refreshControlMessage(channel, ticket);
    return replyError(interaction, 'To menu jest dostępne tylko dla zespołu.');
  }
  if (interaction.values[0] === 'complete') return showCompleteForm(interaction, channel);
  await interaction.deferReply(ephemeral);
  const [kind, value] = interaction.values[0].split(':');
  try {
    if (kind === 'prio') {
      await t.setPriority(channel, value, member);
      return await reply(interaction, 'Priorytet zmieniony.');
    }
    if (kind === 'move') {
      await t.moveTicket(channel, value, member);
      return await reply(interaction, 'Ticket został przeniesiony.');
    }
    if (kind === 'closereq') {
      await t.requestClose(channel, member);
      await t.refreshControlMessage(channel, ticket);
      return await reply(interaction, 'Prośba o zamknięcie wysłana do autora.');
    }
    if (kind === 'deliver') {
      const done = await require('../features/delivery').confirmAndDeliver(channel, member, { again: Boolean(db.getTicket(channel.id)?.order?.delivered) });
      return await reply(interaction, done);
    }
    if (kind === 'status') {
      const { dm } = await orderstatus.setStatus(channel, value, member);
      return await reply(interaction, `Status zamówienia zmieniony na **${statusLabel(value)}**${dm ? ' – klient dostał DM.' : '.'}`);
    }
    return null;
  } catch (err) {
    await t.refreshControlMessage(channel, ticket);
    throw err;
  }
}

/** "Zamówienie zrealizowane" → a form where the seller confirms the amount paid (handled in src/features/orders.js). */
async function showCompleteForm(interaction, channel) {
  try {
    await interaction.showModal(t.completeForm(channel));
  } finally {
    // Reset the menu, so "Zamówienie zrealizowane" can be picked again if the form is closed.
    await t.refreshControlMessage(channel, db.getTicket(channel.id));
  }
}

async function handleAddUser(interaction) {
  const { channel, member } = interaction;
  const ticket = db.getTicket(channel.id);
  if (!ticket) return replyError(interaction, 'Ten kanał nie jest już ticketem.');
  if (!isStaff(member, config.getType(ticket.typeId))) {
    await t.refreshControlMessage(channel, ticket);
    return replyError(interaction, 'Tylko zespół może dodawać osoby.');
  }
  await interaction.deferReply(ephemeral);
  try {
    const added = await t.addUsers(channel, [...interaction.users.values()], member);
    return await reply(interaction, `Dodano ${count(added, 'osobę', 'osoby', 'osób')}.`);
  } catch (err) {
    await t.refreshControlMessage(channel, ticket);
    throw err;
  }
}

function ratingModal(channelId, stars) {
  return new ModalBuilder()
    .setCustomId(`ratemodal:${channelId}:${stars}`)
    .setTitle(`Twoja ocena: ${'⭐'.repeat(stars)}`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Komentarz (opcjonalnie)')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('comment').setPlaceholder('Co poszło dobrze, a co możemy poprawić?').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(500),
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
    .setTitle(stars >= 4 ? '🧡 Dziękujemy za świetną ocenę!' : '🧡 Dziękujemy za ocenę!')
    .setDescription(
      `## ${'⭐'.repeat(stars)}${'☆'.repeat(5 - stars)}\n` +
        (comment ? `>>> ${comment}` : '') +
        (stars <= 2 ? '\n\nPrzykro nam, że coś poszło nie tak – przekażemy Twoją opinię zespołowi.' : ''),
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
        if (ticket?.rating) return replyError(interaction, 'Ten ticket ma już ocenę. Dziękujemy!');
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
            return replyError(interaction, 'Nie możesz zamknąć tego ticketu.');
          }
          const reason = interaction.fields.getTextInputValue('reason');
          if (interaction.isFromMessage()) {
            await interaction.update({ embeds: [embed(COLORS.muted).setDescription('⏳ Zamykam ticket i zapisuję transkrypcję…')], components: [] });
          } else {
            await interaction.deferReply(ephemeral);
          }
          await t.closeTicket(interaction.channel, interaction.member, reason);
          return interaction.editReply({ embeds: [embed(COLORS.success).setDescription('✅ Ticket zamknięty.')] }).catch(() => null);
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
  const what = interaction.customId ? `Kliknięcie (${interaction.customId})` : slash(interaction.commandName);
  if (err.code === 40060) {
    console.warn(`⚠️  ${what}: odpowiedział już inny proces bota – czy bot działa dwa razy na tym samym tokenie (np. na Twoim komputerze i na hostingu)? Wyłącz dodatkową kopię.`);
    return;
  }
  const age = ((Date.now() - interaction.createdTimestamp) / 1000).toFixed(1);
  console.warn(`⏳ ${what}: interakcja wygasła, zanim bot zdążył odpowiedzieć (Discord daje 3 s, minęło ${age} s). Nic nie zostało utworzone – wystarczy spróbować ponownie.`);
  const now = Date.now();
  lateClicks.push(now);
  while (lateClicks.length && now - lateClicks[0] > 10 * 60_000) lateClicks.shift();
  if (lateClicks.length === 3) {
    console.warn('   To się powtarza – hosting jest za wolny albo za daleko. Użyj Node.js 20 lub nowszego i szybszego planu albo regionu blisko Discorda (EU/US).');
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
      if (interaction.isRepliable()) await interaction.reply({ content: `Komendy ${config.brand.name} działają tylko na serwerze.`, flags: MessageFlags.Ephemeral });
      return;
    }
    // Polish command names (/produkt dodaj nazwa:…) → the English names the commands use (src/lib/commandsPl.js).
    if (interaction.isAutocomplete() || interaction.isChatInputCommand()) unlocalize(interaction);
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
        ? 'Brakuje mi uprawnień, żeby to zrobić. Upewnij się, że moja rola ma uprawnienie **Administrator** i jest na samej górze listy ról.'
        : 'Wystąpił nieoczekiwany błąd. Spróbuj ponownie za chwilę.',
    ).catch(() => null);
  }
};
