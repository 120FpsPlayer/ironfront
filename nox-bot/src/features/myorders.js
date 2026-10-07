'use strict';

/**
 * "My orders" – a button in the shop's bottom row (on the panel and on every private page). It answers privately
 * with the orders of the member who clicked, nobody else's:
 *   open orders       their open order tickets: number, product, quantity, total, status (lib/orderStatus.js) and a link
 *   completed orders  their sales, newest first – 10 per page, ◀ Newer / ▶ Older for the rest
 *   View a receipt    a menu with the completed orders of that page – shows the receipt (features/orders.js) in place
 *
 * Components (<page> = the page of completed orders, so ◀ My orders goes back to where the member was):
 *   myorders:open             the shop button – always a new private message
 *   myorders:page:<page>      ◀ Newer / ▶ Older – the list in place
 *   myorders:back:<page>      ◀ My orders under a receipt – the list again (in place)
 *   myorders:receipt:<page>   the receipt menu – value: a sale ID, refused unless it's the member's own sale
 */

const { MessageFlags, StringSelectMenuBuilder } = require('discord.js');
const hooks = require('../lib/hooks');
const db = require('../lib/db');
const orders = require('./orders');
const tickets = require('../tickets/tickets');
const { statusOf, statusLabel } = require('../lib/orderStatus');
const { e, ce, COLORS } = require('../lib/theme');
const { UserError, money, pad, ts, truncate } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, buttonSection, v2, channelUrl } = require('../lib/v2');

const SHOWN_OPEN = 5; // open orders with their own ticket button – more are only linked
const SHOWN_SALES = 10; // completed orders per page (and in the receipt menu – Discord allows 25 options)
const MORE_LINKS = 10; // channel links for the open orders after those

const isPrivate = (interaction) => Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));
const productName = (name) => truncate(name || 'Custom order', 60);
const day = (at) => new Date(at).toISOString().slice(0, 10);
const pageOf = (raw) => Math.max(0, Math.trunc(Number(raw)) || 0); // custom IDs can be forged – too far is clamped by the view

// ───────────── This member's orders ─────────────

/** Open order tickets, newest first – delivered ones are listed with the completed orders. */
function openOrders(guildId, userId) {
  return db
    .tickets((t) => t.guildId === guildId && t.ownerId === userId && t.typeId === 'order' && t.status === 'open' && !t.completedAt)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Completed orders (sales), newest first. */
function completedOrders(guildId, userId) {
  return db
    .sales(guildId)
    .filter((s) => s.userId === userId)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
}

/** "Order #0012 · Spotify × 2 · 40€" + its status – shop orders have ticket.order, older tickets only the form answers. */
function openLine(ticket) {
  const order = tickets.orderDetails(ticket);
  const total = order.total != null ? ` · **${money(order.total)}**` : '';
  const placed = ticket.createdAt ? ` · placed ${ts(ticket.createdAt, 'R')}` : '';
  return `**Order #${pad(ticket.number)}** · ${productName(order.product)} × ${order.quantity ?? 1}${total}\n${statusLabel(statusOf(ticket))}${placed}`;
}

/** "`S-0003` · Spotify × 1 · 40€ · <date> · ✅ Delivered" – with a link while its ticket is still open. */
function saleLine(sale) {
  const parts = [`\`${sale.id}\``, `${productName(sale.product)} × ${sale.quantity ?? 1}`];
  if (sale.amount != null) parts.push(`**${money(sale.amount)}**`);
  if (sale.completedAt) parts.push(ts(sale.completedAt, 'd'));
  parts.push(statusLabel('delivered'));
  if (db.getTicket(sale.channelId)?.status === 'open') parts.push(`<#${sale.channelId}>`);
  return parts.join(' · ');
}

function receiptMenu(sales, page) {
  const unique = sales.filter((s, i) => sales.findIndex((x) => x.id === s.id) === i).slice(0, 25);
  return new StringSelectMenuBuilder()
    .setCustomId(`myorders:receipt:${page}`)
    .setPlaceholder('🧾 View a receipt…')
    .addOptions(
      unique.map((s) => ({
        label: truncate(`${s.id} · ${s.product || 'Custom order'} × ${s.quantity ?? 1}`, 100),
        value: s.id,
        description: truncate([s.amount != null ? money(s.amount) : null, s.completedAt ? `delivered ${day(s.completedAt)}` : null].filter(Boolean).join(' · ') || 'Completed order', 100),
        emoji: '🧾',
      })),
    );
}

/** The private "My orders" view of one member – page: which 10 of their completed orders are listed (0 = the newest). */
function ordersView(guild, userId, { page = 0 } = {}) {
  const open = openOrders(guild.id, userId);
  const sales = completedOrders(guild.id, userId);
  const shop = db.channelId(guild.id, 'shop');
  const c = container(COLORS.brand);
  if (!open.length && !sales.length) {
    c.addTextDisplayComponents(
      text(
        `## ${e(guild, 'box')} My orders\n` +
          `You haven't ordered anything yet. Find something you like in ${shop ? `<#${shop}>` : 'the shop'} and click **Buy** next to the product – ` +
          'your orders and receipts will show up right here.',
      ),
    );
    if (shop) c.addActionRowComponents(row(linkBtn(channelUrl(guild.id, shop), 'Shop', ce(guild, 'cart'))));
    return v2(c);
  }

  const summary = [open.length ? `${open.length} open` : null, sales.length ? `${sales.length} completed` : null].filter(Boolean).join(' · ');
  c.addTextDisplayComponents(text(`## ${e(guild, 'box')} My orders\n-# ${summary} · only you can see this`));
  if (open.length) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`### ${e(guild, 'ticket')} Open orders`));
    for (const t of open.slice(0, SHOWN_OPEN)) {
      c.addSectionComponents(buttonSection(openLine(t), linkBtn(channelUrl(guild.id, t.channelId), 'Go to ticket', ce(guild, 'ticket'))));
    }
    const rest = open.slice(SHOWN_OPEN);
    if (rest.length) c.addTextDisplayComponents(text(`-# +${rest.length} more: ${rest.slice(0, MORE_LINKS).map((t) => `<#${t.channelId}>`).join(' ')}`));
  }
  if (sales.length) {
    const pages = Math.ceil(sales.length / SHOWN_SALES);
    const index = Math.min(pageOf(page), pages - 1);
    const shown = sales.slice(index * SHOWN_SALES, (index + 1) * SHOWN_SALES);
    const range = pages > 1 ? `\n-# ${index * SHOWN_SALES + 1}–${index * SHOWN_SALES + shown.length} of ${sales.length} completed orders` : '';
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`### ${e(guild, 'check')} Completed orders\n${shown.map(saleLine).join('\n')}${range}`));
    c.addActionRowComponents(row(receiptMenu(shown, index)));
    if (pages > 1) {
      c.addActionRowComponents(
        row(
          btn(`myorders:page:${index - 1}`, 'Newer', '◀️').setDisabled(index <= 0),
          btn(`myorders:page:${index + 1}`, 'Older', '▶️').setDisabled(index >= pages - 1),
        ),
      );
    }
  }
  return v2(c);
}

// ───────────── Buttons and the receipt menu ─────────────

/** Under the private list / receipt the answer replaces it; anywhere else it is a new private message. */
const defer = (interaction, inPlace) =>
  inPlace && isPrivate(interaction) ? interaction.deferUpdate() : interaction.deferReply({ flags: MessageFlags.Ephemeral });

async function showList(interaction, inPlace, page = 0) {
  await defer(interaction, inPlace);
  return interaction.editReply(ordersView(interaction.guild, interaction.user.id, { page }));
}

async function showReceipt(interaction, page = 0) {
  const guild = interaction.guild;
  const sale = db.sales(guild.id).find((s) => s.id === interaction.values?.[0]);
  // Menu values can be forged – only the member's own receipts.
  if (!sale || sale.userId !== interaction.user.id) throw new UserError("That receipt isn't one of your orders.");
  await defer(interaction, true);
  const seller = sale.sellerId ? await guild.members.fetch(sale.sellerId).catch(() => null) : null;
  const sellerName = seller?.displayName ?? seller?.user?.globalName ?? seller?.user?.username ?? null;
  const payload = orders.receiptCard(guild, { sale, ticket: db.getTicket(sale.channelId), sellerName });
  payload.components[0].addActionRowComponents(row(btn(`myorders:back:${pageOf(page)}`, 'My orders', '◀️')));
  return interaction.editReply(payload);
}

hooks.route('myorders', {
  button(interaction, action, args) {
    if (action === 'open') return showList(interaction, false);
    if (action === 'back' || action === 'page') return showList(interaction, true, args[0]);
    return null;
  },
  select: (interaction, action, args) => (action === 'receipt' ? showReceipt(interaction, args[0]) : null),
});

module.exports = { ordersView, openOrders, completedOrders, SHOWN_SALES };
