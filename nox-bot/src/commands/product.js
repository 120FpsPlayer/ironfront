'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const shop = require('../features/shop');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, truncate } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

const STOCK_CHOICES = [
  { name: '🟢 In stock', value: 'in' },
  { name: '🟠 Low stock', value: 'low' },
  { name: '🔴 Sold out', value: 'out' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('product')
    .setDescription('Manage the shop catalog (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a product to the shop')
        .addStringOption((o) => o.setName('name').setDescription('Product name').setRequired(true).setMaxLength(80))
        .addStringOption((o) => o.setName('price').setDescription('Price, e.g. €9.99 or "from $5"').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setRequired(true).setMaxLength(400))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji shown next to the name (optional)').setMaxLength(64))
        .addStringOption((o) => o.setName('stock').setDescription('Stock status (default: in stock)').addChoices(...STOCK_CHOICES))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce it in #restocks with a ping? (default: yes)')),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit a product')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(80))
        .addStringOption((o) => o.setName('price').setDescription('New price').setMaxLength(40))
        .addStringOption((o) => o.setName('description').setDescription('New description').setMaxLength(400))
        .addStringOption((o) => o.setName('emoji').setDescription('New emoji').setMaxLength(64)),
    )
    .addSubcommand((s) =>
      s
        .setName('stock')
        .setDescription('Change the stock status')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('status').setDescription('Stock status').setRequired(true).addChoices(...STOCK_CHOICES))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce a restock in #restocks? (default: yes)')),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a product')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List all products')),

  autocomplete: (interaction) => shop.autocomplete(interaction),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Only administrators and sellers can manage the shop.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'add') {
      const product = shop.addProduct(guild, {
        name: o.getString('name'),
        price: o.getString('price'),
        description: o.getString('description'),
        emoji: o.getString('emoji'),
        stock: o.getString('stock') ?? 'in',
      });
      if ((o.getBoolean('announce') ?? true) && product.stock !== 'out') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await shop.announceProduct(guild, product, 'new').catch(() => null);
      }
      return reply(interaction, `Added **${product.name}** (${product.price}) to the shop. The shop panel updates in a few seconds.`);
    }

    if (sub === 'edit') {
      const p = shop.editProduct(guild, o.getString('product'), {
        name: o.getString('name'),
        price: o.getString('price'),
        description: o.getString('description'),
        emoji: o.getString('emoji'),
      });
      return reply(interaction, `Updated **${p.name}**.`);
    }

    if (sub === 'stock') {
      const { product, restocked } = shop.setStock(guild, o.getString('product'), o.getString('status'));
      if (restocked && (o.getBoolean('announce') ?? true)) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await shop.announceProduct(guild, product, 'restock').catch(() => null);
      }
      return reply(interaction, `**${product.name}** is now **${shop.STOCK[product.stock].label.toLowerCase()}**.${restocked ? ' Restock announced 📦' : ''}`);
    }

    if (sub === 'remove') {
      const p = shop.removeProduct(guild, o.getString('product'));
      return reply(interaction, `Removed **${p.name}** from the shop.`);
    }

    const list = shop.products(guild.id);
    const lines = list.map((p) => `${shop.STOCK[p.stock]?.dot ?? '🟢'} **${p.name}** — ${p.price}\n-# ${truncate(p.description, 90)}`);
    return reply(interaction, {
      embeds: [embed(COLORS.brand).setTitle(`🛒 Products (${list.length})`).setDescription(truncate(lines.join('\n') || 'No products yet – add one with `/product add`.', 4000))],
    });
  },
};
