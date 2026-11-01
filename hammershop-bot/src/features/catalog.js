'use strict';

/**
 * Browsing the shop: the panel in #shop shows page 1 of "All". Its tabs and ◀ ▶ buttons answer with a private
 * copy you can keep browsing in (it updates in place), so nobody changes the panel for anyone else.
 *   shopview:tab:<tab>          a tab button ('all' or a category value from shop.groups)
 *   shopview:tabs               the tab menu (more categories than fit in one row)
 *   shopview:page:<n>:<tab>     ◀ / ▶
 * Older panels used catalog:browse / catalog:pick / catalog:page – those still work.
 */

const { MessageFlags } = require('discord.js');
const hooks = require('../lib/hooks');
const panels = require('../lib/panels');
const shop = require('./shop');

const isPrivate = (interaction) => Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));

async function show(interaction, tab, page = 0) {
  const payload = shop.shopView(interaction.guild, { tab, page, userId: interaction.user.id }); // a private page: their 🛒 Cart (n)
  if (isPrivate(interaction)) {
    await interaction.deferUpdate();
    return interaction.editReply(panels.forEdit(payload));
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return interaction.editReply(payload);
}

/** A menu on the public panel keeps showing what was picked – put the panel back so the same option works again. */
function resetMenu(interaction) {
  if (!interaction.message || isPrivate(interaction)) return;
  Promise.resolve(panels.render('shop', interaction.guild))
    .then((payload) => interaction.message.edit(panels.forEdit(payload)))
    .catch(() => null);
}

hooks.route('shopview', {
  button(interaction, action, args) {
    if (action === 'tab') return show(interaction, args.join(':'), 0);
    if (action === 'page') return show(interaction, args.slice(1).join(':'), args[0]);
    return null;
  },
  select(interaction, action) {
    if (action !== 'tabs') return null;
    resetMenu(interaction);
    return show(interaction, interaction.values[0], 0);
  },
});

// Panels posted before the tabs existed.
hooks.route('catalog', {
  select(interaction, action) {
    resetMenu(interaction);
    const [value] = interaction.values;
    if (action === 'pick' && value !== 'all') return shop.startOrder(interaction, value);
    return show(interaction, value, 0);
  },
  button: (interaction, action, args) => (action === 'page' ? show(interaction, args.slice(1).join(':'), args[0]) : null),
});

module.exports = { show };
