'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const images = require('../lib/productImages');
const shop = require('../features/shop');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, truncate } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

const STOCK_CHOICES = [
  { name: '🟢 In stock', value: 'in' },
  { name: '🟠 Low stock', value: 'low' },
  { name: '🔴 Sold out', value: 'out' },
];

const categoryOption = (o, description) => o.setName('category').setDescription(description).setMaxLength(30).setAutocomplete(true);
const imageOption = (o, description) => o.setName('image').setDescription(description);

/** Checks the image before deferring, then downloads it (Discord's links expire). */
async function readImage(interaction) {
  const attachment = interaction.options.getAttachment('image');
  if (!attachment) return null;
  images.check(attachment);
  if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return images.download(attachment);
}

/** /product list – grouped by category. */
function listEmbed(guild) {
  const list = shop.products(guild.id);
  const waiting = db.guild(guild.id).notify;
  const line = (p) =>
    `${shop.STOCK[p.stock]?.dot ?? '🟢'} **${p.name}** — ${shop.formatPrice(p.price)}${p.image ? ' · 🖼️' : ''}` +
    `${waiting[p.id]?.length ? ` · 🔔 ${waiting[p.id].length} waiting` : ''}\n-# ${truncate(p.description, 90)}`;
  const gs = shop.groups(list);
  const titled = gs.some((g) => g.name);
  const text = gs.map((g) => `${titled ? `### ${shop.groupTitle(guild, g)}\n` : ''}${g.products.map(line).join('\n')}`).join('\n');
  return embed(COLORS.brand)
    .setTitle(`🛒 Products (${list.length})`)
    .setDescription(truncate(text || 'No products yet – add one with `/product add`.', 4000));
}

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
        .addStringOption((o) => o.setName('price').setDescription('Price – a plain number like 20 or 9.99 is shown as 20€ / 9.99€').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setRequired(true).setMaxLength(400))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji shown next to the name (optional)').setMaxLength(64))
        .addStringOption((o) => o.setName('stock').setDescription('Stock status (default: in stock)').addChoices(...STOCK_CHOICES))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce it in #restocks with a ping? (default: yes)'))
        .addStringOption((o) => categoryOption(o, 'Category in the shop, e.g. Games or 🎮 Games (pick one or type a new one)'))
        .addAttachmentOption((o) => imageOption(o, 'Product image – PNG, JPG, WEBP or GIF, up to 1 MB')),
    )
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit a product')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(80))
        .addStringOption((o) => o.setName('price').setDescription('New price').setMaxLength(40))
        .addStringOption((o) => o.setName('description').setDescription('New description').setMaxLength(400))
        .addStringOption((o) => o.setName('emoji').setDescription('New emoji').setMaxLength(64))
        .addStringOption((o) => categoryOption(o, 'New category – or "none" to remove it'))
        .addAttachmentOption((o) => imageOption(o, 'New product image – PNG, JPG, WEBP or GIF, up to 1 MB'))
        .addBooleanOption((o) => o.setName('remove_image').setDescription('Remove the product image')),
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
      const image = await readImage(interaction);
      const product = shop.addProduct(guild, {
        name: o.getString('name'),
        price: o.getString('price'),
        description: o.getString('description'),
        emoji: o.getString('emoji'),
        stock: o.getString('stock') ?? 'in',
        category: o.getString('category'),
        image,
      });
      if ((o.getBoolean('announce') ?? true) && product.stock !== 'out') {
        if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await shop.announceProduct(guild, product, 'new').catch(() => null);
      }
      const extras = [product.category && `in **${product.category}**`, product.image && 'with its image'].filter(Boolean).join(' ');
      return reply(interaction, `Added **${product.name}** (${shop.formatPrice(product.price)})${extras ? ` ${extras}` : ''} to the shop. The shop panel updates in a few seconds.`);
    }

    if (sub === 'edit') {
      const image = await readImage(interaction);
      if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const p = await shop.editProduct(guild, o.getString('product'), {
        name: o.getString('name'),
        price: o.getString('price'),
        description: o.getString('description'),
        emoji: o.getString('emoji'),
        category: o.getString('category'),
        image,
        removeImage: o.getBoolean('remove_image') ?? false,
      });
      return reply(interaction, `Updated **${p.name}**${p.category ? ` (category: **${p.category}**)` : ''}. The shop panel updates in a few seconds.`);
    }

    if (sub === 'stock') {
      const target = shop.findProduct(guild.id, o.getString('product'));
      const waiting = target ? db.guild(guild.id).notify[target.id]?.length ?? 0 : 0;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { product, restocked } = await shop.setStock(guild, o.getString('product'), o.getString('status'));
      const notes = [];
      if (restocked && (o.getBoolean('announce') ?? true)) {
        await shop.announceProduct(guild, product, 'restock').catch(() => null);
        notes.push('Restock announced 📦');
      }
      if (restocked && waiting) notes.push(`🔔 ${waiting} ${waiting === 1 ? 'person' : 'people'} waiting got a DM`);
      return reply(interaction, `**${product.name}** is now **${shop.STOCK[product.stock].label.toLowerCase()}**.${notes.length ? ` ${notes.join(' · ')}` : ''}`);
    }

    if (sub === 'remove') {
      const p = shop.removeProduct(guild, o.getString('product'));
      return reply(interaction, `Removed **${p.name}** from the shop.`);
    }

    return reply(interaction, { embeds: [listEmbed(guild)] });
  },
};
