'use strict';

const {
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  SectionBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { PRIORITIES, pad, ts, duration, workingStatus, avgResponseTime, money, count } = require('../lib/utils');
const shop = require('../features/shop'); // used at render time – safe with circular requires
const productImages = require('../lib/productImages');
const { ORDER_STATUS, statusOf, statusLabel } = require('../lib/orderStatus');
const { isCart } = require('../lib/orderItems');
const { SPACER, text, divider, btn, linkBtn, row, section, buttonSection, container, header, v2, notice, channelUrl, subtext } = require('../lib/v2');

/** Custom HammerShop emoji for a ticket type (falls back to the Unicode emoji from config.json). */
const typeEmoji = (guild, type) => (type?.icon && guild ? ce(guild, type.icon) : type?.emoji ?? '🎫');
const typeText = (guild, type) => (type?.icon && guild ? e(guild, type.icon) : type?.emoji ?? '🎫');

function panelPayload(guild, style = 'buttons') {
  const p = config.panel;
  // The Hammer Launcher server has no shop: the type that only the shop's Buy buttons open is not offered there.
  const types = config.ticketTypes.filter((t) => !(t.shopOnly && require('../lib/profile').launcher));
  const useSections = style !== 'select' && types.length <= 8;

  const c = container(COLORS.brand);
  const head = `# ${e(guild, 'ticket')} ${p.title}\n${p.description}`;
  header(c, head, config.brand.logo ?? guild.iconURL?.({ size: 256 }));

  if (p.rules.length) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`**${e(guild, 'pin')} Zanim otworzysz ticket**\n${p.rules.map((r) => `> ${r}`).join('\n')}`));
  }
  c.addSeparatorComponents(divider(true));

  if (useSections) {
    const shopId = db.channelId(guild.id, 'shop');
    for (const t of types) {
      // Shop-only types (Zakup) send people to #sklep – buying works through the Buy buttons there.
      const button =
        t.shopOnly && shopId
          ? new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(channelUrl(guild.id, shopId)).setLabel('Przejdź do sklepu').setEmoji(typeEmoji(guild, t))
          : new ButtonBuilder()
              .setCustomId(`ticket:open:${t.id}`)
              .setLabel(p.buttonLabel ?? 'Otwórz')
              .setEmoji(typeEmoji(guild, t))
              .setStyle(t.id === 'order' ? ButtonStyle.Primary : ButtonStyle.Secondary);
      c.addSectionComponents(
        new SectionBuilder().addTextDisplayComponents(text(`### ${typeText(guild, t)} ${t.label}\n${subtext(t.description) || '-# ​'}`)).setButtonAccessory(button),
      );
    }
  } else {
    c.addTextDisplayComponents(text(`**${e(guild, 'folder')} Wybierz kategorię z listy poniżej:**`));
    c.addActionRowComponents(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('ticket:open')
          .setPlaceholder('Wybierz kategorię ticketu…')
          .addOptions(types.map((t) => ({ label: t.label, value: t.id, description: t.description?.slice(0, 100), emoji: typeEmoji(guild, t) }))),
      ),
    );
  }

  const footer = [];
  const status = workingStatus(undefined, guild.id);
  if (status.text) footer.push(status.text);
  if (p.showStats !== false) {
    const avg = avgResponseTime(guild.id);
    const open = db.tickets((t) => t.guildId === guild.id && t.status === 'open').length;
    footer.push(`⏱️ Średni czas odpowiedzi: **${avg ? `~${duration(avg)}` : 'brak danych'}**${SPACER}📨 Otwarte tickety: **${open}**`);
  }
  if (footer.length) {
    c.addSeparatorComponents(divider(true));
    c.addTextDisplayComponents(text(footer.map((l) => `-# ${l}`).join('\n')));
  }
  return v2(c);
}

/** "**Zamówienie:** 💳 Opłacone · <t:…:R>" for order tickets (null for other tickets). */
function orderStatusLine(ticket) {
  const status = statusOf(ticket) ?? (ticket.completedAt ? 'delivered' : null);
  if (!status) return null;
  const at = { delivered: ticket.completedAt, cancelled: ticket.closedAt }[status] ?? (ticket.order?.status === status ? ticket.order.statusAt : null);
  return `**Zamówienie:** ${statusLabel(status)}${at ? ` · ${ts(at, 'R')}` : ''}`;
}

function statusLine(ticket) {
  const p = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
  const status = ticket.status === 'open' ? '🟢 Otwarty' : '🔴 Zamknięty';
  const claim = ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*czeka na przejęcie*';
  const order = orderStatusLine(ticket);
  return (
    `**Status:** ${status}${SPACER}**Priorytet:** ${p.emoji} ${p.label}\n` +
    `**Obsługa:** ${claim}${SPACER}**Utworzony:** ${ts(ticket.createdAt, 'R')}` +
    (order ? `\n${order}` : '')
  );
}

/** Does the order take PaysafeCard PINs – a PaysafeCard method (by its type or name), or no payment method known. */
function takesPins(order) {
  const method = typeof order === 'string' ? order : order?.method;
  if (!String(method ?? '').trim()) return true;
  const paycards = require('../features/paycards'); // here – it needs this file
  return paycards.methodType(typeof order === 'string' ? { name: order } : paycards.methodOf(order)) === 'paysafecard';
}

/** Can the customer send their payment ("Zapłać") – an open order that waits for its payment. */
function acceptsPayment(ticket) {
  return (
    config.orders?.paymentProofs !== false &&
    ticket?.typeId === 'order' &&
    ticket.status === 'open' &&
    !ticket.completedAt &&
    !require('../features/autopay').confirmsItself(ticket) && // an open Stripe / PayPal link confirms itself – here, as those need this file
    ['awaiting', 'sent'].includes(statusOf(ticket))
  );
}

/** "Zapłać" on the order card (src/features/payments.js). */
function paymentSection(ticket) {
  const sent = statusOf(ticket) === 'sent' ? ticket.order?.payment : null; // not after staff set it back to awaiting
  const order = ticket.order ?? require('./tickets').orderDetails(ticket); // here – tickets.js needs this file
  const proof = takesPins(order) ? 'PIN PaysafeCard, zrzut ekranu albo ID transakcji' : 'zrzut ekranu albo ID transakcji';
  const content = sent?.at
    ? `📨 **Płatność wysłana ${ts(sent.at, 'R')}** – sprzedawca ją sprawdza.\n-# Pomyłka? Kliknij ponownie **Zapłać**, żeby wysłać poprawkę.`
    : `💳 **Chcesz zapłacić?** Kliknij **Zapłać** i wyślij ${proof} – sprzedawca od razu dostanie powiadomienie.`;
  return buttonSection(content, btn('pay:open', 'Zapłać', '💳', ButtonStyle.Success));
}

function ticketCard(ticket, type, { guild, ownerUser, ownerMember, pingRoles = [], previousCount = 0 } = {}) {
  const p = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
  const c = container(p.color);

  const guildId = guild?.id ?? ticket.guildId;
  const status = workingStatus(new Date(ticket.createdAt ?? Date.now()), guildId, 'ticket');
  // "We're closed right now" only until someone from the team has taken the ticket.
  const closedNote = !status.open && !ticket.claimedBy && !ticket.firstResponseAt;
  const intro =
    `## ${typeText(guild, type)} ${type?.label ?? 'Ticket'}${SPACER}\`#${pad(ticket.number)}\`\n` +
    `Cześć <@${ticket.ownerId}>! 👋 Dziękujemy za kontakt z **${config.brand.name}**.\n` +
    (type?.id === 'order'
      ? 'Sprzedawca potwierdzi tutaj Twoje zamówienie, ostateczną cenę i szczegóły płatności. **Nigdy nie płać nikomu w prywatnych wiadomościach.**'
      : 'Opisz swoją sprawę jak najdokładniej i w miarę możliwości dołącz zrzuty ekranu – nasz zespół wkrótce odpowie.') +
    (closedNote ? `\n-# ${status.text}` : '');
  c.addSectionComponents(section(intro, ownerUser?.displayAvatarURL?.({ size: 128 })));

  // An order for a shop product shows the product image next to the form.
  const product = type?.id === 'order' && ticket.answers?.length ? shop.ticketProduct(guildId, ticket) : null;
  const picture = product ? productImages.attachment(product) : null;
  if (ticket.answers?.length) {
    c.addSeparatorComponents(divider());
    const budget = Math.floor(2200 / ticket.answers.length);
    const answers = ticket.answers
      .map((a) => {
        const value = (a.value || '*brak odpowiedzi*').slice(0, budget) + ((a.value?.length ?? 0) > budget ? '…' : '');
        return `**${a.label}**\n${value.split('\n').map((l) => `> ${l}`).join('\n')}`;
      })
      .join('\n');
    if (picture) c.addSectionComponents(section(`### 📝 Formularz\n${answers}`, picture.url));
    else c.addTextDisplayComponents(text(`### 📝 Formularz\n${answers}`));
  }

  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(statusLine(ticket)));
  if (acceptsPayment(ticket)) c.addSectionComponents(paymentSection(ticket));
  if (type?.id === 'order') require('../features/gifts').addToCard(c, ticket); // "🎁 Kup jako prezent" – here, as gifts.js needs this file
  if (type?.id === 'order') require('../features/ticketpromo').addToCard(c, ticket); // "🏷️ Dodaj kod rabatowy" while it waits for payment

  if (ticket.participants?.length) {
    c.addTextDisplayComponents(text(`**Dodane osoby:** ${ticket.participants.map((id) => `<@${id}>`).join(', ')}`));
  }

  const meta = [];
  if (ownerUser?.createdAt) meta.push(`👤 Konto założone ${ts(ownerUser.createdAt, 'D')}`);
  if (ownerMember?.joinedAt) meta.push(`📥 Na serwerze od ${ts(ownerMember.joinedAt, 'D')}`);
  meta.push(`🗂️ Poprzednie tickety: ${previousCount}`);
  c.addTextDisplayComponents(text(`-# ${meta.join(' · ')}`));

  if (ticket.status === 'open') {
    c.addSeparatorComponents(divider());
    c.addActionRowComponents(
      row(
        btn('ticket:close', 'Zamknij', '🔒', ButtonStyle.Danger),
        ticket.claimedBy ? btn('ticket:unclaim', 'Oddaj', '↩️') : btn('ticket:claim', 'Przejmij', '🙋', ButtonStyle.Success),
        btn('ticket:ping', 'Wezwij pomoc', '🔔'),
        btn('ticket:transcript', 'Transkrypcja', '📄'),
      ),
    );
    c.addActionRowComponents(row(manageSelect(ticket, guild)));
    c.addActionRowComponents(
      row(new UserSelectMenuBuilder().setCustomId('ticket:adduser').setPlaceholder('➕ Dodaj kogoś do ticketu (zespół)').setMinValues(1).setMaxValues(5)),
    );
  }

  if (pingRoles.length) c.addTextDisplayComponents(text(`-# 🔔 ${pingRoles.map((id) => `<@&${id}>`).join(' ')}`));

  return v2(c, { mentions: { users: [ticket.ownerId], roles: pingRoles }, files: picture ? [picture.file] : [] });
}

/** What the "Status: …" options of the ⚙️ menu do (src/features/orderstatus.js). */
const STATUS_OPTIONS = {
  paid: 'Płatność jest potwierdzona',
  progress: 'Przygotowujesz / dostarczasz zamówienie',
  awaiting: 'Cofnij – nadal czekamy na płatność',
};

function manageSelect(ticket, guild) {
  const options = [];
  if (ticket.typeId === 'order' && !ticket.completedAt) {
    options.push({
      label: 'Zamówienie zrealizowane',
      value: 'complete',
      emoji: guild ? ce(guild, 'check') : '✅',
      description: 'Potwierdź zapłaconą kwotę – zapisuje sprzedaż, daje rolę Klient',
    });
    const current = statusOf(ticket);
    const dm = config.orders?.statusDms !== false ? ' – klient dostaje DM' : '';
    for (const [key, what] of Object.entries(STATUS_OPTIONS)) {
      if (key === current) continue;
      options.push({ label: `Status: ${ORDER_STATUS[key].label}`, value: `status:${key}`, emoji: ORDER_STATUS[key].emoji, description: `${what}${dm}` });
    }
  }
  // The product's files / text (src/features/delivery.js) – here, as delivery.js needs this file.
  if (ticket.typeId === 'order' && guild && require('../features/delivery').canDeliver(guild.id, ticket)) {
    const sent = ticket.order?.delivered;
    options.push({
      label: sent ? 'Wyślij produkt ponownie' : 'Dostarcz produkt',
      value: 'deliver',
      emoji: '📦',
      description: sent ? 'Wysyła klientowi pliki / tekst produktu jeszcze raz' : 'Płatność OK → wysyła produkt i realizuje zamówienie',
    });
  }
  for (const [value, p] of Object.entries(PRIORITIES)) {
    if (value === ticket.priority) continue;
    options.push({ label: `Priorytet: ${p.label}`, value: `prio:${value}`, emoji: p.emoji, description: 'Zmień priorytet ticketu' });
  }
  options.push({ label: 'Poproś autora o zamknięcie', value: 'closereq', emoji: '📨', description: 'Autor potwierdza, że sprawa jest załatwiona' });
  for (const t of config.ticketTypes) {
    if (t.id === ticket.typeId || options.length >= 25 || (t.shopOnly && require('../lib/profile').launcher)) continue;
    options.push({ label: `Przenieś do: ${t.label}`.slice(0, 100), value: `move:${t.id}`, emoji: typeEmoji(guild, t), description: 'Zmień kategorię ticketu' });
  }
  return new StringSelectMenuBuilder().setCustomId('ticket:manage').setPlaceholder('⚙️ Zarządzaj ticketem (zespół)').addOptions(options);
}

function closedCard(ticket, actorId, { messageCount, transcriptUrl } = {}) {
  const c = container(COLORS.danger);
  c.addTextDisplayComponents(
    text(
      '## 🔒 Ticket zamknięty\n' +
        `Zamknięty przez <@${actorId}> ${ts(ticket.closedAt ?? Date.now(), 'R')}` +
        (ticket.closeReason ? `\n**Powód:** ${ticket.closeReason}` : ''),
    ),
  );
  c.addSeparatorComponents(divider());
  const lines = [
    `⏱️ **Czas trwania:** ${duration((ticket.closedAt ?? Date.now()) - ticket.createdAt)}`,
    `⚡ **Pierwsza odpowiedź:** ${ticket.firstResponseAt ? `po ${duration(ticket.firstResponseAt - ticket.createdAt)}` : '—'}`,
    `🙋 **Obsługa:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—'}`,
  ];
  if (messageCount != null) lines.push(`💬 **Wiadomości:** ${messageCount}`);
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addSeparatorComponents(divider());
  const buttons = [
    btn('ticket:reopen', 'Otwórz ponownie', '🔓', ButtonStyle.Success),
    btn('ticket:transcript', 'Transkrypcja', '📄'),
    btn('ticket:delete', 'Usuń ticket', '🗑️', ButtonStyle.Danger),
  ];
  if (transcriptUrl) buttons.push(linkBtn(transcriptUrl, 'Transkrypcja', '📄'));
  c.addActionRowComponents(row(...buttons));
  return v2(c);
}

function closeRequestCard(ticket, staffId, state = 'pending') {
  const c = container(state === 'pending' ? COLORS.warning : state === 'accepted' ? COLORS.success : COLORS.danger);
  if (state === 'pending') {
    c.addTextDisplayComponents(
      text(
        `## 📨 Czy możemy zamknąć ten ticket?\n<@${ticket.ownerId}>, <@${staffId}> uważa, że Twoja sprawa została załatwiona.\n` +
          'Jeśli wszystko jest w porządku – kliknij **Tak, zamknij**. Jeśli nadal potrzebujesz pomocy – po prostu daj nam znać!',
      ),
    );
    c.addActionRowComponents(
      row(btn('ticket:closereq_yes', 'Tak, zamknij', '✅', ButtonStyle.Success), btn('ticket:closereq_no', 'Nie, nadal potrzebuję pomocy', '✋')),
    );
  } else if (state === 'accepted') {
    c.addTextDisplayComponents(text('✅ **Autor potwierdza, że wszystko jest załatwione** – ticket jest zamykany.'));
  } else {
    c.addTextDisplayComponents(text(`✋ **<@${ticket.ownerId}> nadal potrzebuje pomocy** – ticket pozostaje otwarty.`));
  }
  return v2(c, { mentions: { users: state === 'pending' ? [ticket.ownerId] : [] } });
}

function inactivityWarning(ticket, closeAt) {
  const c = container(COLORS.warning);
  c.addTextDisplayComponents(
    text(
      `## ⏰ Czy nadal potrzebujesz pomocy?\n<@${ticket.ownerId}>, od dłuższego czasu nie mamy od Ciebie odpowiedzi.\n` +
        `Ten ticket zostanie **automatycznie zamknięty ${ts(closeAt, 'R')}**, chyba że odpiszesz albo klikniesz przycisk poniżej.`,
    ),
  );
  c.addActionRowComponents(row(btn('ticket:still', 'Nadal potrzebuję pomocy', '✋', ButtonStyle.Primary)));
  return v2(c, { mentions: { users: [ticket.ownerId] } });
}

/** Shown in the ticket after staff marks an order as completed. */
function orderCompletedCard(guild, ticket, staffId, { loyal = false, orders = 1, sale = null } = {}) {
  if (ticket.order?.topUp) return require('../features/balance').topUpDoneCard(guild, ticket, sale); // no vouch for a top-up
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(
      `## ${e(guild, 'check')} Zamówienie zrealizowane!\n` +
        `Dziękujemy za zakupy w **${config.brand.name}**, <@${ticket.ownerId}> 🧡\n` +
        `Masz teraz rolę **Klient**${loyal ? ` oraz – po ${count(orders, 'zamówieniu', 'zamówieniach', 'zamówieniach')} – rolę **Stały Klient**. Jesteś już częścią rodziny!` : '.'}\n\n` +
        `${e(guild, 'star')} **Podoba Ci się zamówienie?** Krótka opinia bardzo nam pomoże – kliknij przycisk poniżej.`,
    ),
  );
  const receipt = sale ? `Potwierdzenie zakupu \`${sale.id}\`${sale.amount != null ? ` · Zapłacono ${money(sale.amount)}` : ''} · ` : '';
  c.addTextDisplayComponents(text(`-# ${receipt}Dostarczone przez <@${staffId}> · ${ts(Date.now(), 'f')}`));
  c.addActionRowComponents(row(btn('vouch:open', 'Wystaw opinię', ce(guild, 'star'), ButtonStyle.Success)));
  return v2(c, { mentions: { users: [ticket.ownerId] } });
}

/** "Zamówienie zrealizowane" form for staff: confirms the amount the customer actually paid. */
function completeOrderModal(ticket, { promoWarning = null } = {}) {
  const o = ticket.order;
  let summary = o
    ? `**${o.product || 'Zamówienie indywidualne'}**${isCart(o) || o.topUp ? '' : ` × ${o.quantity ?? 1}`}${o.method ? ` · ${o.method}` : ''}${o.promo ? ` · kod **${o.promo}**` : ''}\n` +
      (o.total != null ? `Do zapłaty: **${money(o.total)}**` : 'Cena nie była stałą kwotą – wpisz, ile zapłacił klient.')
    : 'Zamówienie indywidualne – wpisz, ile zapłacił klient.';
  if (o?.promo && promoWarning) {
    summary += `\n⚠️ **Kod ${o.promo} przekroczył swój limit** – ${promoWarning}. ${o.total != null ? 'Kwota powyżej nadal uwzględnia jego rabat' : 'Jego rabat nadal jest w tym zamówieniu'} – wpisz, ile klient faktycznie zapłacił.`;
  }
  if (o?.topUp) summary += '\n💰 Doładowanie salda: zapłacona kwota trafi na saldo sklepu klienta.'; // features/balance.js
  const input = new TextInputBuilder().setCustomId('amount').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(12).setPlaceholder('np. 19.99 – zostaw puste, jeśli nie wiesz');
  if (o?.total != null) input.setValue(Number.isInteger(o.total) ? String(o.total) : o.total.toFixed(2));
  return new ModalBuilder()
    .setCustomId('order:complete')
    .setTitle(`✅ Zrealizuj zamówienie #${pad(ticket.number)}`)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${summary}\n-# Zapisuje sprzedaż i daje klientowi rolę Klient${config.orders.receipts ? ' oraz potwierdzenie zakupu w DM' : ''}.`))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(`Zapłacona kwota (${config.shop.currency ?? '€'})`.slice(0, 45))
        .setDescription('Ile klient faktycznie zapłacił. Zostaw puste, jeśli nie wiesz.')
        .setTextInputComponent(input),
    );
}

/** The staff member's confirmation after completing an order. */
function orderCompletedReply({ orders, loyal, sale, promoWarning = null }) {
  const paid = sale.amount != null ? ` – zapłacono ${money(sale.amount)}` : '';
  const discount = sale.discount > 0 ? `jego rabat −${money(sale.discount)}` : 'kod';
  return (
    `Zamówienie zrealizowane – sprzedaż \`${sale.id}\` zapisana${paid}${sale.promo ? ` (kod ${sale.promo})` : ''}. ` +
    `Klient ma teraz ${count(orders, 'zamówienie', 'zamówienia', 'zamówień')}${loyal ? ' i rolę Stały Klient 🧡' : ''}.` +
    (sale.promo && promoWarning ? `\n⚠️ Kod ${sale.promo} przekroczył limit (${promoWarning}) – ${discount} nadal jest zapisany w tej sprzedaży.` : '')
  );
}

module.exports = {
  typeEmoji,
  typeText,
  panelPayload,
  orderStatusLine,
  takesPins,
  acceptsPayment,
  ticketCard,
  closedCard,
  closeRequestCard,
  inactivityWarning,
  orderCompletedCard,
  completeOrderModal,
  orderCompletedReply,
  notice,
};
