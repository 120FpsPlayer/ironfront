'use strict';

/**
 * "Pay" – the customer sends their payment from the order ticket (config.orders.paymentProofs).
 * The button sits on the ticket's main card while the order waits for its payment (status awaiting or sent).
 * The form takes PaysafeCard PINs (PaysafeCard orders, or no method known), screenshots and a note / transaction ID.
 *
 * On submit the order gets payment = { at, method, note, pins, files: [{ name, url }] } and the status "sent".
 * A "📨 Payment sent" card in the ticket shows it (PINs as ••••-••••-••••-1234 – the whole PIN only for config.orders.pinViewers via Show PIN, the screenshots uploaded again – links from a
 * form expire) and pings the seller handling the ticket, or the order staff roles while nobody has claimed it.
 * The log channel gets the same without the PINs (all but the last 4 digits hidden). Sending it again (e.g. a
 * corrected PIN) works after a short cooldown – it only pings again after the Call support cooldown.
 * A BTC / ETH transaction ID in the note of a crypto order is checked on the blockchain instead (nobody is pinged
 * unless it needs a hand) – the order confirms itself (src/features/cryptoverify.js).
 *
 * Components:
 *   pay:open      "Pay" button on the order card → form
 *   pay:submit    the form
 */

const {
  AttachmentBuilder,
  ButtonStyle,
  FileBuilder,
  FileUploadBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const tickets = require('../tickets/tickets');
const ui = require('../tickets/ui');
const orderstatus = require('./orderstatus');
const { statusOf, statusLabel } = require('../lib/orderStatus');
const { COLORS } = require('../lib/theme');
const { UserError, reply, logEmbed, money, pad, ts, truncate, sendLog, maskPin, maskPins, count } = require('../lib/utils');
const { alertRoleIds } = require('../lib/permissions');
const { quantitySuffix } = require('../lib/orderItems');
const { container, text, divider, gallery, linkBtn, btn, row, v2 } = require('../lib/v2');

const COOLDOWN = 60_000;
const MAX_PINS = 10;
const MAX_FILES = 5;
const NOTE_MAX = 500;
const MB = 1024 * 1024;
const FILE_MAX = 8 * MB;
const TOTAL_MAX = 9 * MB; // one message can carry 10 MB on a server without boosts
const DOWNLOAD_TIMEOUT = 15_000;

const sending = new Set(); // ticket channels with a payment on its way – a double click sends it once

// ───────────── PINs ─────────────

/**
 * "1234-5678-9012-3456, 1111 2222 3333 4444" → { pins: ['1234567890123456', …], bad: null }.
 * PINs are separated by commas, semicolons, new lines or spaces. Dashes inside a PIN are fine, and so are spaces
 * between its groups of 4 digits ("1234 5678 9012 3456") – a group that does not fit (17 digits, 3 digits) is not.
 * bad: the first part that is not a PIN (null when all are fine).
 */
function parsePins(raw) {
  const pins = [];
  for (const part of String(raw ?? '').split(/[,;\n]+/)) {
    let pending = ''; // the groups of a PIN written with spaces
    for (const word of part.trim().split(/\s+/)) {
      const digits = word.replace(/-+/g, '');
      if (!digits) continue;
      if (!/^\d+$/.test(digits)) return { pins, bad: part.trim() };
      if (!pending && digits.length % 16 === 0) {
        for (let i = 0; i < digits.length; i += 16) pins.push(digits.slice(i, i + 16));
        continue;
      }
      if (digits.length % 4 !== 0 || pending.length + digits.length > 16) return { pins, bad: part.trim() };
      pending += digits;
      if (pending.length === 16) {
        pins.push(pending);
        pending = '';
      }
    }
    if (pending) return { pins, bad: part.trim() };
  }
  return { pins: [...new Set(pins)], bad: null };
}

/** "1234567890123456" → "1234-5678-9012-3456" */
const formatPin = (pin) => pin.match(/.{1,4}/g).join('-');
// For the log: at least as loose as parsePins, so no PIN the form takes reaches the log through the note.
const maskText = maskPins;

// ───────────── Checks ─────────────

/** The order ticket in this channel, if this member may send its payment now (or a UserError). */
function requirePayable(channel, userId, now = Date.now()) {
  const ticket = db.getTicket(channel?.id);
  if (!ticket || ticket.typeId !== 'order') throw new UserError('Ten przycisk działa tylko w tickecie zamówienia.');
  if (ticket.ownerId !== userId) {
    throw new UserError(`Płatność za to zamówienie może wysłać tylko <@${ticket.ownerId}>. Zespół potwierdza płatności w menu ⚙️ (**Status: Opłacone**).`);
  }
  if (config.orders?.paymentProofs === false) throw new UserError('Napisz dane płatności w tickecie – sprzedawca sprawdzi je na miejscu.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty.');
  if (ticket.completedAt) throw new UserError('To zamówienie jest już zrealizowane.');
  if (require('./autopay').confirmsItself(ticket)) throw new UserError('Zapłać przez link do płatności w tym tickecie – po zapłacie zamówienie potwierdzi się tutaj automatycznie.');
  if (!ui.acceptsPayment(ticket)) throw new UserError(`Twoja płatność jest już potwierdzona (${statusLabel(statusOf(ticket))}) – nie musisz wysyłać jej ponownie.`);
  const last = ticket.order?.payment?.at;
  if (last && now - last < COOLDOWN) throw new UserError(`Płatność została właśnie wysłana. Poprawkę możesz wysłać ${ts(last + COOLDOWN, 'R')}.`);
  return ticket;
}

// ───────────── Form ─────────────

function paymentModal(ticket) {
  const order = tickets.orderDetails(ticket);
  const summary =
    `**${truncate(order.product || 'Twoje zamówienie', 100)}**${quantitySuffix(order)}` +
    (order.method ? ` · ${truncate(order.method, 60)}` : '') +
    (order.total != null ? ` · Razem **${money(order.total)}**` : '');
  const modal = new ModalBuilder()
    .setCustomId('pay:submit')
    .setTitle(`💳 Zapłać · zamówienie #${pad(ticket.number)}`.slice(0, 45))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${summary}\nWypełnij co najmniej jedno pole – sprzedawca od razu sprawdzi Twoją płatność.\n-# Wysyłaj ją tylko tutaj, w swoim tickecie – nigdy w DM.`),
    );
  if (ui.takesPins(order)) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('PIN PaysafeCard (jeden lub kilka)')
        .setDescription('Każdy PIN ma 16 cyfr. Kilka PIN-ów? Oddziel je przecinkami lub nowymi liniami.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('pins').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setPlaceholder('1234-5678-9012-3456'),
        ),
    );
  }
  const note = new LabelBuilder().setLabel('Notatka lub ID transakcji');
  // BTC / ETH: the transaction ID is checked on the blockchain (src/features/cryptoverify.js) – here, it needs this file's neighbours.
  if (require('./cryptoverify').checksOrder(ticket.order)) note.setDescription('Wklej ID transakcji (hash) – zamówienie potwierdzi się wtedy automatycznie.');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Zrzuty ekranu')
      .setDescription(`Do ${MAX_FILES} zdjęć płatności (opcjonalnie).`)
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('files').setMinValues(0).setMaxValues(MAX_FILES).setRequired(false)),
    note
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('note')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(NOTE_MAX)
          .setPlaceholder('Np. ID transakcji krypto albo coś, o czym sprzedawca powinien wiedzieć'),
      ),
  );
  return modal;
}

/** A text field of the form ('' when it is empty or not in the form). */
function field(interaction, id) {
  try {
    return interaction.fields.getTextInputValue(id)?.trim() ?? '';
  } catch {
    return '';
  }
}

/** The files uploaded in the form (an empty list when there are none). */
function uploadsOf(interaction) {
  try {
    return [...(interaction.fields.getUploadedFiles('files')?.values() ?? [])];
  } catch {
    return [];
  }
}

// ───────────── Screenshots ─────────────

const isImage = (a) => /^image\//i.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? '');

/** A safe, unique file name for the copy ("payment-1-screenshot.png"). */
function fileName(a, i) {
  const clean = String(a.name ?? 'file').replace(/[^\w.-]+/g, '_').replace(/^[._]+/, '').slice(-60) || 'file';
  return `payment-${i + 1}-${clean}`;
}

/** Downloads one file → Buffer (null when it fails or is bigger than max). */
async function download(url, max) {
  try {
    const res = await fetch(url, { signal: globalThis.AbortSignal?.timeout?.(DOWNLOAD_TIMEOUT) });
    if (!res?.ok) return null;
    const length = Number(res.headers?.get?.('content-length'));
    if (length > max) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.length > 0 && buffer.length <= max ? buffer : null;
  } catch {
    return null;
  }
}

/**
 * Copies the uploads (links from a form expire): up to 8 MB each and 9 MB together. → [{ name, url, image, buffer }]
 * buffer is null for a file that could not be copied – it keeps its original link.
 */
async function copyFiles(uploads) {
  const out = [];
  let total = 0;
  for (const [i, a] of uploads.entries()) {
    const item = { name: fileName(a, i), url: a.url ?? null, image: isImage(a), buffer: null };
    const room = Math.min(FILE_MAX, TOTAL_MAX - total);
    if (a.url && !(a.size > room)) item.buffer = await download(a.url, room);
    if (item.buffer) total += item.buffer.length;
    out.push(item);
  }
  return out;
}

// ───────────── Card, log ─────────────

/**
 * Who is told: the seller handling the ticket, otherwise the staff roles of order tickets. A payment sent again
 * (status still "sent") only pings when support was not called within defaults.pingStaffCooldownMinutes – the
 * same cooldown as Call support (ticket.lastStaffPing), so the team isn't pinged every minute. After staff set
 * the order back to awaiting, the next payment pings right away.
 */
function whoToPing(guild, ticket, now = Date.now()) {
  const cooldown = (config.defaults?.pingStaffCooldownMinutes ?? 30) * 60_000;
  if (statusOf(ticket) === 'sent' && ticket.lastStaffPing && now - ticket.lastStaffPing < cooldown) return { users: [], roles: [] };
  if (ticket.claimedBy) return { users: [ticket.claimedBy], roles: [] };
  return { users: [], roles: alertRoleIds(guild.id, config.getType(ticket.typeId)).filter((id) => guild.roles.cache.has(id)) };
}

const quote = (value) => value.split('\n').map((l) => `> ${l}`).join('\n');

/** auto – a crypto transaction ID the bot checks on the blockchain itself (src/features/cryptoverify.js). */
function paymentCard(ticket, { payment, files, pings, again, auto = false }) {
  const c = container(COLORS.warning);
  const who = [...pings.users.map((id) => `<@${id}>`), ...pings.roles.map((id) => `<@&${id}>`)].join(' ');
  c.addTextDisplayComponents(
    text(
      `## 📨 Płatność wysłana${again ? ' ponownie' : ''}\n` +
        `Płatność za zamówienie \`#${pad(ticket.number)}\` od <@${ticket.ownerId}>` +
        (auto ? ' – 🔎 transakcja jest sprawdzana automatycznie w blockchainie.' : who ? ` – ${who}, prośba o sprawdzenie.` : ' – sprzedawca wkrótce ją sprawdzi.'),
    ),
  );
  c.addSeparatorComponents(divider());
  const facts = [`**Metoda:** ${payment.method ? truncate(payment.method, 100) : '—'}`];
  // PINs only as the last 4 digits – the whole PIN only for config.orders.pinViewers (Show PIN).
  if (payment.pins.length) facts.push(`**${payment.pins.length === 1 ? 'PIN' : 'PIN-y'}:** ${payment.pins.map(maskPin).join(' · ')}`);
  if (payment.note) facts.push(`**Notatka:**\n${quote(maskText(payment.note))}`);
  const lost = files.filter((f) => !f.buffer);
  if (files.length) facts.push(`**Zrzuty ekranu:** ${files.length}`);
  if (lost.length) facts.push(`-# Za duże, by je zachować (link wygaśnie): ${lost.map((f) => (f.url ? `[${f.name}](${f.url})` : f.name)).join(', ')}`);
  c.addTextDisplayComponents(text(facts.join('\n')));
  const images = files.filter((f) => f.buffer && f.image);
  if (images.length) c.addMediaGalleryComponents(gallery(...images.map((f) => `attachment://${f.name}`)));
  for (const f of files.filter((x) => x.buffer && !x.image)) c.addFileComponents(new FileBuilder().setURL(`attachment://${f.name}`));
  const next = auto ? 'Bot potwierdzi płatność, gdy potwierdzi ją blockchain – zespół dostanie ping, jeśli będzie potrzebna pomoc' : 'Zespół: sprawdźcie płatność i kliknijcie **Płatność OK**';
  c.addTextDisplayComponents(text(`-# ${statusLabel('sent')} · ${ts(payment.at, 'f')} · ${next}`));
  const showPin = payment.pins.length || maskText(payment.note) !== (payment.note ?? '') ? [btn(`pay:pin:${payment.at}`, payment.pins.length > 1 ? 'Pokaż PIN-y' : 'Pokaż PIN', '🔑', ButtonStyle.Secondary)] : [];
  c.addActionRowComponents(row(require('./delivery').confirmButtonFor(ticket.guildId, ticket), ...showPin)); // here – delivery.js needs this file's neighbours
  return v2(c, {
    mentions: { users: pings.users, roles: pings.roles },
    files: files.filter((f) => f.buffer).map((f) => new AttachmentBuilder(f.buffer, { name: f.name })),
  });
}

/** The log entry – never the PINs: only their last 4 digits, also inside the note. */
function logPayload(channel, ticket, member, { payment, files, again, message }) {
  const fields = [
    { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
    { name: 'Klient', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Metoda', value: truncate(payment.method || '—', 1024), inline: true },
  ];
  if (payment.pins.length) fields.push({ name: payment.pins.length === 1 ? 'PIN' : 'PIN-y', value: payment.pins.map(maskPin).join('\n') });
  if (payment.note) fields.push({ name: 'Notatka', value: truncate(maskText(payment.note), 1024) });
  if (files.length) fields.push({ name: 'Zrzuty ekranu', value: `${files.length} – w tickecie`, inline: true });
  return {
    embeds: [logEmbed(COLORS.warning, again ? '📨 Płatność wysłana ponownie' : '📨 Płatność wysłana', member.user ?? member).addFields(fields)],
    components: message?.url ? [row(linkBtn(message.url, 'Otwórz', '📨'))] : [],
  };
}

// ───────────── Flow ─────────────

async function openForm(interaction) {
  const ticket = requirePayable(interaction.channel, interaction.user.id);
  return interaction.showModal(paymentModal(ticket));
}

async function submit(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { channel, guild } = interaction;
  const ticket = requirePayable(channel, interaction.user.id);
  const order = tickets.orderDetails(ticket);
  const { pins, bad } = ui.takesPins(order) ? parsePins(field(interaction, 'pins')) : { pins: [], bad: null };
  if (bad) {
    throw new UserError(`\`${truncate(bad, 30)}\` to nie jest PIN PaysafeCard – PIN ma 16 cyfr, np. **1234-5678-9012-3456**. Kilka PIN-ów? Oddziel je przecinkami.`);
  }
  if (pins.length > MAX_PINS) throw new UserError(`To ${count(pins.length, 'PIN', 'PIN-y', 'PIN-ów')} – naraz możesz wysłać maks. ${MAX_PINS}. Resztę wyślij osobno.`);
  const note = field(interaction, 'note').slice(0, NOTE_MAX);
  const uploads = uploadsOf(interaction).slice(0, MAX_FILES);
  if (!pins.length && !note && !uploads.length) {
    throw new UserError(`Wypełnij co najmniej jedno pole: ${ui.takesPins(order) ? 'PIN PaysafeCard, ' : ''}zrzut ekranu albo notatkę / ID transakcji.`);
  }
  if (sending.has(channel.id)) throw new UserError('Twoja płatność jest właśnie wysyłana – chwileczkę…');
  const cryptoverify = require('./cryptoverify'); // here – it needs this file's neighbours
  let tx = null;
  sending.add(channel.id);
  try {
    const files = await copyFiles(uploads);
    // Staff may have confirmed, completed or closed the order while the files were copied – check again.
    const current = requirePayable(channel, interaction.user.id);
    const now = Date.now();
    const again = Boolean(current.order?.payment);
    const payment = { at: now, method: order.method ?? null, note: note || null, pins, files: [] };
    tx = cryptoverify.txFor(current, note); // a BTC / ETH transaction ID – the bot checks it, the team isn't pinged
    const pings = tx ? { users: [], roles: [] } : whoToPing(guild, current, now);
    // The customer sees what happens next (once per order), the team gets the payment card below it.
    if (!again) await channel.send(require('./delivery').onTheWayCard(current, { auto: false })).catch(() => null);
    const message = await channel.send(paymentCard(current, { payment, files, pings, again, auto: Boolean(tx) }));
    // The copies in the ticket keep working – the links from the form expire.
    const sent = [...(message.attachments?.values() ?? [])];
    payment.files = files.map((f) => ({ name: f.name, url: (f.buffer && sent.find((a) => a.name === f.name)?.url) || f.url }));
    payment.messageId = message.id;

    // …or while the card was posted: the payment is kept, but the status staff set stays.
    const latest = db.getTicket(channel.id);
    const accepted = ui.acceptsPayment(latest);
    if (accepted) orderstatus.recordStatus(latest, 'sent', { by: interaction.user.id, now, extra: { payment } });
    else db.updateTicket(channel.id, { order: { ...tickets.orderDetails(latest), payment } });
    // The customer acted: the ticket waits for the team now (no auto-close). A ping counts as calling support.
    db.updateTicket(channel.id, {
      lastActivity: now,
      lastMessageBy: 'owner',
      warned: false,
      ...(latest.lastMessageBy === 'staff' && { waitingSince: now }),
      ...((pings.users.length || pings.roles.length) && { lastStaffPing: now }),
    });
    const updated = db.getTicket(channel.id);
    await tickets.refreshControlMessage(channel, updated);
    await sendLog(guild, logPayload(channel, updated, interaction.member, { payment, files, again, message }));
    if (accepted) await hooks.emit('orderStatus', { guild, ticket: updated, status: 'sent', staff: null });
  } finally {
    sending.delete(channel.id);
  }
  if (tx) {
    const crypto = await cryptoverify.start(guild, channel.id, tx).catch((err) => console.warn(`[pay] sprawdzanie krypto ${channel.id}:`, err.message));
    return reply(interaction, cryptoverify.replyFor(crypto));
  }
  return reply(interaction, 'Dzięki! Płatność trafiła do sprzedawcy – sprawdzi ją i potwierdzi w Twoim tickecie.');
}

/** Who may see whole PINs: config.orders.pinViewers (user IDs), or the bot owners when that list is empty. */
function canSeePins(member) {
  const viewers = (config.orders?.pinViewers ?? []).map(String).filter(Boolean);
  return viewers.length ? viewers.includes(member?.id) : require('../lib/permissions').isOwner(member);
}

/** Show PIN – the whole PINs, only to the PIN viewers, only for them (ephemeral), and logged. */
async function showPins(interaction, at) {
  if (!canSeePins(interaction.member)) throw new UserError('PIN-y PaysafeCard widzi tylko właściciel.');
  const ticket = db.getTicket(interaction.channel?.id);
  const payment = ticket?.order?.payment;
  if (!payment) throw new UserError('W tym tickecie nie ma płatności z PIN-em.');
  const old = String(payment.at) !== String(at);
  const lines = [
    ...(payment.pins ?? []).map((p) => `🔑 \`${formatPin(p)}\``),
    ...(payment.note && maskText(payment.note) !== payment.note ? [`**Notatka:**\n${quote(payment.note)}`] : []),
  ];
  await sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.warning, '🔑 Wyświetlono PIN PaysafeCard', interaction.user).setDescription(`Zamówienie \`#${pad(ticket.number)}\` w <#${ticket.channelId}>`)],
  }).catch(() => null);
  return reply(interaction, `${old ? '-# To najnowsza płatność wysłana w tym tickecie.\n' : ''}${lines.join('\n') || 'W tej płatności nie ma PIN-u.'}`);
}

hooks.route('pay', {
  button: (interaction, action, args) => (action === 'open' ? openForm(interaction) : action === 'pin' ? showPins(interaction, args?.[0]) : null),
  modal: (interaction, action) => (action === 'submit' ? submit(interaction) : null),
});

module.exports = { COOLDOWN, MAX_PINS, parsePins, formatPin, maskPin, maskText, paymentModal, paymentCard, copyFiles, canSeePins };
