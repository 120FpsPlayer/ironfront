'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const db = require('../lib/db');
const images = require('../lib/productImages');
const restock = require('../features/restock');
const shop = require('../features/shop');
const delivery = require('../features/delivery');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, truncate, ts } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

const STOCK_CHOICES = [
  { name: '🟢 In stock', value: 'in' },
  { name: '🟠 Low stock', value: 'low' },
  { name: '🔴 Sold out', value: 'out' },
];

const categoryOption = (o, description) => o.setName('category').setDescription(description).setMaxLength(30).setAutocomplete(true);
const imageOption = (o, description) => o.setName('image').setDescription(description);
const countOption = (o, description) => o.setName('count').setDescription(description).setMinValue(0).setMaxValue(100_000);

/** "**in stock** · **12 left**" – the stock status, and the counter when the product has one. */
const stockState = (p) =>
  `**${(shop.STOCK[p.stock] ?? shop.STOCK.in).label.toLowerCase()}**${shop.counted(p) && p.stock !== 'out' ? ` · **${p.stockCount} left**` : ''}`;

/** The options of a product as a preview: "1 month — 5€" (and the sale price during a flash sale). */
function variantPreview(p) {
  const sale = shop.activeSale(p);
  const lines = shop.variantsOf(p).map((v) => `• ${v.name} — ${sale ? `~~${shop.formatPrice(v.price)}~~ ` : ''}**${shop.variantPrice(p, v)}**`);
  if (sale) lines.push(`-# ⚡ −${sale.percent}% flash sale until ${ts(sale.endsAt, 'f')}`);
  return lines.join('\n');
}

/** Checks the image before deferring, then downloads it (Discord's links expire). */
async function readImage(interaction) {
  const attachment = interaction.options.getAttachment('image');
  if (!attachment) return null;
  images.check(attachment);
  if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return images.download(attachment);
}

/** After a restock: announce it in #restocks and say who got a DM (features/restock.js) → " Restock announced 📦 · 🔔 …" or ''. */
async function restockNotes(guild, product, { restocked, announce }) {
  if (!restocked) return '';
  const notes = [];
  if (announce && (await shop.announceProduct(guild, product, 'restock').catch(() => null))) notes.push('Restock announced 📦');
  const dms = restock.takeResult(guild.id, product.id);
  if (dms?.waiting) {
    const people = `${dms.waiting} ${dms.waiting === 1 ? 'person' : 'people'} waiting`;
    notes.push(dms.sent === dms.waiting ? `🔔 DM sent to the ${people}` : `🔔 DM sent to ${dms.sent} of the ${people} (the others don't accept DMs)`);
  }
  return notes.length ? ` ${notes.join(' · ')}` : '';
}

/** /product list – grouped by category. */
function listEmbed(guild) {
  const list = shop.products(guild.id);
  const waiting = db.guild(guild.id).notify;
  const line = (p) => {
    const sale = shop.activeSale(p);
    const options = shop.variantsOf(p).length;
    const extras = [
      shop.counted(p) && `${p.stockCount} left`,
      options && `${options} ${options === 1 ? 'option' : 'options'}`,
      sale && `⚡ −${sale.percent}% until ${ts(sale.endsAt, 'R')}`,
      p.image && '🖼️',
      delivery.hasDelivery(p) && '📦 instant delivery',
      waiting[p.id]?.length && `🔔 ${waiting[p.id].length} waiting`,
    ].filter(Boolean);
    return `${shop.STOCK[p.stock]?.dot ?? '🟢'} **${p.name}** — ${shop.priceLabel(p)}${extras.map((x) => ` · ${x}`).join('')}\n${require('../lib/v2').subtext(truncate(p.description, 90))}`;
  };
  const gs = shop.groups(list);
  const titled = gs.some((g) => g.name);
  const text = gs.map((g) => `${titled ? `### ${shop.groupTitle(guild, g)}\n` : ''}${g.products.map(line).join('\n')}`).join('\n');
  return embed(COLORS.brand)
    .setTitle(`🛒 Products (${list.length})`)
    .setDescription(truncate(text || 'No products yet – add one with `/product add`.', 4000));
}

const DELIVERY_CHOICES = [
  { name: '⚡ Instant delivery', value: 'instant' },
  ...[1, 2, 3, 4, 5, 6, 7].map((d) => ({ name: `🕒 ${d} day${d === 1 ? '' : 's'}`, value: String(d) })),
  { name: '🕒 Up to 14 days', value: '14' },
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
        .addStringOption((o) => o.setName('price').setDescription('Price – a plain number like 20 or 9.99 is shown as 20€ / 9.99€').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('description').setDescription('Short description').setRequired(true).setMaxLength(400))
        .addStringOption((o) => o.setName('emoji').setDescription('Emoji shown next to the name (optional)').setMaxLength(64))
        .addStringOption((o) => o.setName('stock').setDescription('Stock status (default: in stock)').addChoices(...STOCK_CHOICES))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce it in #restocks with a ping? (default: yes)'))
        .addStringOption((o) => categoryOption(o, 'Category in the shop, e.g. Games or 🎮 Games (pick one or type a new one)'))
        .addAttachmentOption((o) => imageOption(o, 'Product image – PNG, JPG, WEBP or GIF, up to 1 MB'))
        .addIntegerOption((o) => countOption(o, 'How many you have – shown as "12 left", counted down per completed order'))
        .addAttachmentOption((o) => o.setName('file').setDescription('The product itself – sent to the buyer after payment (more: /product delivery)'))
        .addStringOption((o) => o.setName('delivery_text').setDescription('Text sent to the buyer after payment, e.g. a key or a login').setMaxLength(1500))
        .addStringOption((o) => o.setName('delivery_time').setDescription('How long the buyer waits: instant, 1–7 days or up to 14 days').addChoices(...DELIVERY_CHOICES)),
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
        .addBooleanOption((o) => o.setName('remove_image').setDescription('Remove the product image'))
        .addStringOption((o) => o.setName('stock').setDescription('New stock status – on its own it turns the stock counter off').addChoices(...STOCK_CHOICES))
        .addIntegerOption((o) => countOption(o, 'How many are left – sets the stock status, counted down per completed order'))
        .addStringOption((o) => o.setName('delivery_time').setDescription('How long the buyer waits: instant, 1–7 days or up to 14 days').addChoices(...DELIVERY_CHOICES, { name: '↩️ Automatic (default)', value: 'auto' })),
    )
    .addSubcommand((s) =>
      s
        .setName('stock')
        .setDescription('Change the stock status, or set how many are left')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addStringOption((o) => o.setName('status').setDescription('Stock status – on its own it turns the stock counter off').addChoices(...STOCK_CHOICES))
        .addIntegerOption((o) => countOption(o, 'How many are left – sets the status (0 = sold out), counted down per order'))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce a restock in #restocks? (default: yes)')),
    )
    .addSubcommand((s) =>
      s
        .setName('variants')
        .setDescription('Options with their own price, e.g. 1 / 3 / 12 months')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName('variants')
            .setDescription('"1 month = 5, 3 months = 12" – up to 10, separated by , or ; – "none" removes them')
            .setRequired(true)
            .setMaxLength(1000),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('delivery')
        .setDescription('What the buyer gets after paying: files and/or text – sent automatically')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addAttachmentOption((o) => o.setName('file').setDescription('A file the buyer gets (same name = replaced)'))
        .addAttachmentOption((o) => o.setName('file2').setDescription('Another file'))
        .addAttachmentOption((o) => o.setName('file3').setDescription('Another file'))
        .addAttachmentOption((o) => o.setName('file4').setDescription('Another file'))
        .addAttachmentOption((o) => o.setName('file5').setDescription('Another file'))
        .addStringOption((o) => o.setName('text').setDescription('Text the buyer gets, e.g. a key or login – "none" removes it').setMaxLength(1500))
        .addBooleanOption((o) => o.setName('clear').setDescription('Remove all files and text first')),
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
        stockCount: o.getInteger('count'),
        category: o.getString('category'),
        image,
        deliveryTime: o.getString('delivery_time'),
      });
      if ((o.getBoolean('announce') ?? true) && product.stock !== 'out') {
        if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await shop.announceProduct(guild, product, 'new').catch(() => null);
      }
      const file = o.getAttachment('file');
      const deliveryText = o.getString('delivery_text');
      if (file || deliveryText) {
        if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await delivery.setDelivery(guild, product.id, { attachments: [file], text: deliveryText });
      }
      const extras = [product.category && ` in **${product.category}**`, product.image && ' with its image'].filter(Boolean).join('');
      const counter = shop.counted(product) ? ` It is ${stockState(product)}.` : '';
      const delivers = file || deliveryText ? `\n📦 Delivered after payment: ${delivery.deliverySummary(shop.findProduct(guild.id, product.id))}.` : '';
      return reply(interaction, `Added **${product.name}** (${shop.formatPrice(product.price)}) to the shop${extras}.${counter} The shop panel updates in a few seconds.${delivers}`);
    }

    if (sub === 'edit') {
      const target = shop.findProduct(guild.id, o.getString('product'));
      if (!target) return replyError(interaction, 'There is no such product. Pick one from the suggestions.');
      const image = await readImage(interaction);
      if (!interaction.deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const wasOut = target.stock === 'out';
      const p = await shop.editProduct(guild, target.id, {
        name: o.getString('name'),
        price: o.getString('price'),
        description: o.getString('description'),
        emoji: o.getString('emoji'),
        category: o.getString('category'),
        stock: o.getString('stock'),
        stockCount: o.getInteger('count'),
        deliveryTime: o.getString('delivery_time'),
        image,
        removeImage: o.getBoolean('remove_image') ?? false,
      });
      const notes = await restockNotes(guild, p, { restocked: wasOut && p.stock !== 'out', announce: true });
      const stock = o.getInteger('count') != null || o.getString('stock') ? ` It is ${stockState(p)}${shop.counted(p) ? '' : ' (no stock counter)'}.` : '';
      return reply(interaction, `Updated **${p.name}**${p.category ? ` (category: **${p.category}**)` : ''}.${stock} The shop panel updates in a few seconds.${notes}`);
    }

    if (sub === 'stock') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { product, restocked, counterOff } = await shop.setStock(guild, o.getString('product'), o.getString('status'), { count: o.getInteger('count') });
      const notes = await restockNotes(guild, product, { restocked, announce: o.getBoolean('announce') ?? true });
      const counter = shop.counted(product)
        ? ' Completed orders count it down – at 0 it is sold out.'
        : counterOff
          ? ' The stock counter is off now – set a **count** to turn it back on.'
          : '';
      return reply(interaction, `**${product.name}** is now ${stockState(product)}.${counter}${notes}`);
    }

    if (sub === 'variants') {
      const p = shop.setVariants(guild, o.getString('product'), o.getString('variants'));
      if (!shop.variantsOf(p).length) {
        return reply(interaction, `**${p.name}** has no options any more – it is sold for one price again: **${shop.formatPrice(p.price)}**. The shop panel updates in a few seconds.`);
      }
      const n = shop.variantsOf(p).length;
      return reply(interaction, {
        embeds: [
          embed(COLORS.success)
            .setTitle(truncate(`🧩 ${p.name} – ${n} ${n === 1 ? 'option' : 'options'}`, 256))
            .setDescription(
              `${variantPreview(p)}\n\nThe shop shows **${shop.priceLabel(p)}**, and buyers pick an option in the order form. ` +
                'The shop panel updates in a few seconds.\n-# Run the command again to change them – an option that keeps its name stays valid in order forms that are already open.',
            ),
        ],
      });
    }

    if (sub === 'delivery') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const p = await delivery.setDelivery(guild, o.getString('product'), {
        attachments: ['file', 'file2', 'file3', 'file4', 'file5'].map((n) => o.getAttachment(n)),
        text: o.getString('text'),
        clear: o.getBoolean('clear') ?? false,
      });
      if (!delivery.hasDelivery(p)) return reply(interaction, `**${p.name}** delivers nothing automatically now – a seller delivers it by hand.`);
      return reply(interaction, {
        embeds: [
          embed(COLORS.success)
            .setTitle(truncate(`📦 ${p.name} – delivery`, 256))
            .setDescription(
              `${delivery.deliverySummary(p)}\n\n` +
                '**PayPal / Stripe:** sent automatically right after the payment – in the ticket and by DM – and the order is completed.\n' +
                '**PaysafeCard / Crypto:** after the customer clicks **Pay**, check the payment and click **Payment OK – deliver**.\n' +
                '-# Run it again to add files (same name = replaced), `text:none` removes the text, `clear:True` starts over.',
            ),
        ],
      });
    }

    if (sub === 'remove') {
      const p = shop.removeProduct(guild, o.getString('product'));
      return reply(interaction, `Removed **${p.name}** from the shop.`);
    }

    return reply(interaction, { embeds: [listEmbed(guild)] });
  },
};
