'use strict';

/**
 * "Pay" – the customer sends their payment from the order ticket (config.orders.paymentProofs).
 * The button sits on the ticket's main card while the order waits for its payment (status awaiting or sent).
 * The form takes PaysafeCard PINs (PaysafeCard orders, or no method known), screenshots and a note / transaction ID.
 *
 * On submit the order gets payment = { at, method, note, pins, files: [{ name, url }] } and the status "sent".
 * A "📨 Payment sent" card in the ticket shows it (PINs in spoilers, the screenshots uploaded again – links from a
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
const { UserError, reply, logEmbed, money, pad, ts, truncate, sendLog, maskPin, maskPins } = require('../lib/utils');
const { alertRoleIds } = require('../lib/permissions');
const { container, text, divider, gallery, linkBtn, row, v2 } = require('../lib/v2');

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
  if (!ticket || ticket.typeId !== 'order') throw new UserError('This button only works in an order ticket.');
  if (ticket.ownerId !== userId) {
    throw new UserError(`Only <@${ticket.ownerId}> can send the payment for this order. Staff confirm payments in the ⚙️ menu (**Status: Paid**).`);
  }
  if (config.orders?.paymentProofs === false) throw new UserError('Please write your payment details in the ticket – a seller checks them there.');
  if (ticket.status !== 'open') throw new UserError('This ticket is closed.');
  if (ticket.completedAt) throw new UserError('This order is already completed.');
  if (require('./autopay').confirmsItself(ticket)) throw new UserError('Pay with the payment link in this ticket – your order is confirmed here automatically once you\'ve paid.');
  if (!ui.acceptsPayment(ticket)) throw new UserError(`Your payment is already confirmed (${statusLabel(statusOf(ticket))}) – no need to send it again.`);
  const last = ticket.order?.payment?.at;
  if (last && now - last < COOLDOWN) throw new UserError(`You've just sent your payment. You can send a correction ${ts(last + COOLDOWN, 'R')}.`);
  return ticket;
}

// ───────────── Form ─────────────

function paymentModal(ticket) {
  const order = tickets.orderDetails(ticket);
  const summary =
    `**${truncate(order.product || 'Your order', 100)}** × ${order.quantity ?? 1}` +
    (order.method ? ` · ${truncate(order.method, 60)}` : '') +
    (order.total != null ? ` · Total **${money(order.total)}**` : '');
  const modal = new ModalBuilder()
    .setCustomId('pay:submit')
    .setTitle(`💳 Pay · order #${pad(ticket.number)}`.slice(0, 45))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`${summary}\nFill in at least one field – a seller checks your payment right away.\n-# Only send it here, in your ticket – never in DMs.`),
    );
  if (ui.takesPins(order)) {
    modal.addLabelComponents(
      new LabelBuilder()
        .setLabel('PaysafeCard PIN(s)')
        .setDescription('16 digits each. Several PINs? Separate them with commas or new lines.')
        .setTextInputComponent(
          new TextInputBuilder().setCustomId('pins').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(400).setPlaceholder('1234-5678-9012-3456'),
        ),
    );
  }
  const note = new LabelBuilder().setLabel('Note or transaction ID');
  // BTC / ETH: the transaction ID is checked on the blockchain (src/features/cryptoverify.js) – here, it needs this file's neighbours.
  if (require('./cryptoverify').checksOrder(ticket.order)) note.setDescription('Paste the transaction ID (hash) – your order is then confirmed automatically.');
  modal.addLabelComponents(
    new LabelBuilder()
      .setLabel('Screenshots')
      .setDescription(`Up to ${MAX_FILES} pictures of your payment (optional).`)
      .setFileUploadComponent(new FileUploadBuilder().setCustomId('files').setMinValues(0).setMaxValues(MAX_FILES).setRequired(false)),
    note
      .setTextInputComponent(
        new TextInputBuilder()
          .setCustomId('note')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(NOTE_MAX)
          .setPlaceholder('E.g. the crypto transaction ID, or anything the seller should know'),
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
      `## 📨 Payment sent${again ? ' again' : ''}\n` +
        `<@${ticket.ownerId}> sent the payment for order \`#${pad(ticket.number)}\`` +
        (auto ? ' – 🔎 the transaction is checked on the blockchain automatically.' : who ? ` – ${who}, please check it.` : ' – a seller checks it shortly.'),
    ),
  );
  c.addSeparatorComponents(divider());
  const facts = [`**Method:** ${payment.method ? truncate(payment.method, 100) : '—'}`];
  if (payment.pins.length) facts.push(`**${payment.pins.length === 1 ? 'PIN' : 'PINs'}:** ${payment.pins.map((p) => `||${formatPin(p)}||`).join(' · ')}`);
  if (payment.note) facts.push(`**Note:**\n${quote(payment.note)}`);
  const lost = files.filter((f) => !f.buffer);
  if (files.length) facts.push(`**Screenshots:** ${files.length}`);
  if (lost.length) facts.push(`-# Too big to keep (the link expires): ${lost.map((f) => (f.url ? `[${f.name}](${f.url})` : f.name)).join(', ')}`);
  c.addTextDisplayComponents(text(facts.join('\n')));
  const images = files.filter((f) => f.buffer && f.image);
  if (images.length) c.addMediaGalleryComponents(gallery(...images.map((f) => `attachment://${f.name}`)));
  for (const f of files.filter((x) => x.buffer && !x.image)) c.addFileComponents(new FileBuilder().setURL(`attachment://${f.name}`));
  const next = auto ? 'Confirmed by the bot once the blockchain does – staff are pinged if it needs a hand' : 'Staff: check the payment, then click **Payment OK**';
  c.addTextDisplayComponents(text(`-# ${statusLabel('sent')} · ${ts(payment.at, 'f')} · ${next}`));
  c.addActionRowComponents(row(require('./delivery').confirmButtonFor(ticket.guildId, ticket))); // here – delivery.js needs this file's neighbours
  return v2(c, {
    mentions: { users: pings.users, roles: pings.roles },
    files: files.filter((f) => f.buffer).map((f) => new AttachmentBuilder(f.buffer, { name: f.name })),
  });
}

/** The log entry – never the PINs: only their last 4 digits, also inside the note. */
function logPayload(channel, ticket, member, { payment, files, again, message }) {
  const fields = [
    { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
    { name: 'Customer', value: `<@${ticket.ownerId}>`, inline: true },
    { name: 'Method', value: truncate(payment.method || '—', 1024), inline: true },
  ];
  if (payment.pins.length) fields.push({ name: payment.pins.length === 1 ? 'PIN' : 'PINs', value: payment.pins.map(maskPin).join('\n') });
  if (payment.note) fields.push({ name: 'Note', value: truncate(maskText(payment.note), 1024) });
  if (files.length) fields.push({ name: 'Screenshots', value: `${files.length} – in the ticket`, inline: true });
  return {
    embeds: [logEmbed(COLORS.warning, again ? '📨 Payment sent again' : '📨 Payment sent', member.user ?? member).addFields(fields)],
    components: message?.url ? [row(linkBtn(message.url, 'Open', '📨'))] : [],
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
    throw new UserError(`\`${truncate(bad, 30)}\` is not a PaysafeCard PIN – a PIN has 16 digits, like **1234-5678-9012-3456**. Several PINs? Put a comma between them.`);
  }
  if (pins.length > MAX_PINS) throw new UserError(`That's ${pins.length} PINs – you can send up to ${MAX_PINS} at once. Send the rest in a second message.`);
  const note = field(interaction, 'note').slice(0, NOTE_MAX);
  const uploads = uploadsOf(interaction).slice(0, MAX_FILES);
  if (!pins.length && !note && !uploads.length) {
    throw new UserError(`Fill in at least one field: ${ui.takesPins(order) ? 'your PaysafeCard PIN, ' : ''}a screenshot or a note / transaction ID.`);
  }
  if (sending.has(channel.id)) throw new UserError('Your payment is being sent – one moment…');
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
    const crypto = await cryptoverify.start(guild, channel.id, tx).catch((err) => console.warn(`[pay] crypto check ${channel.id}:`, err.message));
    return reply(interaction, cryptoverify.replyFor(crypto));
  }
  return reply(interaction, "Thanks! Your payment was sent to the seller – they'll check it and confirm it in your ticket.");
}

hooks.route('pay', {
  button: (interaction, action) => (action === 'open' ? openForm(interaction) : null),
  modal: (interaction, action) => (action === 'submit' ? submit(interaction) : null),
});

module.exports = { COOLDOWN, MAX_PINS, parsePins, formatPin, maskPin, maskText, paymentModal, paymentCard, copyFiles };
