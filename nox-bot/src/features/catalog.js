'use strict';

/**
 * Browsing the shop when the panel is a compact list (more than 8 products):
 *   catalog:browse               category menu → an ephemeral list of that category, with Buy / Notify me and images
 *   catalog:pick                 product menu (shops without categories) → the order form, or Notify me when sold out
 *   catalog:page:<n>:<category>  ◀ ▶ through a long ephemeral list
 */

const { MessageFlags } = require('discord.js');
const hooks = require('../lib/hooks');
const panels = require('../lib/panels');
const shop = require('./shop');
const { e, COLORS } = require('../lib/theme');
const { UserError } = require('../lib/utils');
const { container, text, divider, btn, row, v2 } = require('../lib/v2');

/** The products behind a menu value: 'c:<category>', 'none' (no category) or 'all'. */
function groupFor(guildId, value) {
  const list = shop.products(guildId);
  if (value === 'all') return { name: null, value: 'all', all: true, products: list };
  return shop.groups(list).find((g) => g.value === value) ?? null;
}

function listPage(guild, group, items, { index = 0, count = 1, nav = count > 1 } = {}) {
  const c = container(COLORS.brand);
  const title = group.all ? `${e(guild, 'cart')} All products` : shop.groupTitle(guild, group);
  c.addTextDisplayComponents(text(`## ${title}\n-# ${shop.groupSummary(group)}${count > 1 ? ` · page ${index + 1} of ${count}` : ''}`));
  c.addSeparatorComponents(divider());
  const pictures = shop.pickImages(items);
  for (const p of items) shop.addCard(c, guild, p, pictures.get(p.id));
  if (nav) {
    c.addSeparatorComponents(divider());
    c.addActionRowComponents(
      row(
        btn(`catalog:page:${index - 1}:${group.value}`, 'Previous', '◀️').setDisabled(index <= 0),
        btn(`catalog:page:${index + 1}:${group.value}`, 'Next', '▶️').setDisabled(index >= count - 1),
      ),
    );
  }
  return v2(c, { files: items.map((p) => pictures.get(p.id)?.file).filter(Boolean) });
}

/** Splits the products into pages that each fit one message (components, text, image uploads). */
function paginate(guild, group) {
  const pages = [];
  let current = [];
  for (const p of group.products) {
    const next = [...current, p];
    if (current.length && !shop.fits(listPage(guild, group, next, { index: 98, count: 99, nav: true }))) {
      pages.push(current);
      current = [p];
    } else current = next;
  }
  if (current.length) pages.push(current);
  return pages;
}

function view(guild, group, page = 0) {
  const pages = paginate(guild, group);
  const index = Math.min(Math.max(0, Number(page) || 0), pages.length - 1);
  return listPage(guild, group, pages[index], { index, count: pages.length });
}

/** A menu keeps showing what was picked – put the panel back so the same option works again. */
function resetMenu(interaction) {
  if (!interaction.message) return;
  Promise.resolve(panels.render('shop', interaction.guild))
    .then((payload) => interaction.message.edit(panels.forEdit(payload)))
    .catch(() => null);
}

const EMPTY = 'This part of the shop is empty now – the catalog was just updated.';

async function browse(interaction, value) {
  const group = groupFor(interaction.guild.id, value);
  if (!group?.products.length) throw new UserError(EMPTY);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return interaction.editReply(view(interaction.guild, group));
}

/** The order form – or, for a sold-out product, its card with Notify me (shop.startOrder). */
function pick(interaction, value) {
  if (value === 'all') return browse(interaction, value);
  return shop.startOrder(interaction, value);
}

async function turnPage(interaction, page, value) {
  const group = groupFor(interaction.guild.id, value);
  if (!group?.products.length) throw new UserError(EMPTY);
  await interaction.deferUpdate();
  return interaction.editReply(panels.forEdit(view(interaction.guild, group, page)));
}

hooks.route('catalog', {
  select(interaction, action) {
    resetMenu(interaction);
    const [value] = interaction.values;
    if (action === 'browse') return browse(interaction, value);
    if (action === 'pick') return pick(interaction, value);
    return null;
  },
  button: (interaction, action, args) => (action === 'page' ? turnPage(interaction, args[0], args.slice(1).join(':')) : null),
});

module.exports = { groupFor, paginate, view };
