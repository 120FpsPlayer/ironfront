'use strict';

/**
 * "🔔 Notify me" on sold-out products. The button toggles a one-time DM for when the product is back
 * (subscribers live in db.guild(id).notify[productId]). shop.setStock / editProduct emit productRestocked
 * when a sold-out product can be bought again: everyone waiting gets one DM and the list is cleared.
 */

const { ButtonStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const images = require('../lib/productImages');
const shop = require('./shop');
const { ce, COLORS } = require('../lib/theme');
const { UserError, embed, reply } = require('../lib/utils');
const { container, text, header, row, btn, linkBtn, v2, channelUrl } = require('../lib/v2');

const MAX_WAITING = 500; // per product – more people should grab the Restocks role instead

const waiting = (guildId, productId) => db.guild(guildId).notify[productId] ?? [];

/** Adds or removes someone from a product's list → true when they will be notified. */
function toggle(guildId, productId, userId) {
  const g = db.guild(guildId);
  const list = g.notify[productId] ?? [];
  if (list.includes(userId)) {
    const rest = list.filter((id) => id !== userId);
    if (rest.length) g.notify[productId] = rest;
    else delete g.notify[productId];
    db.save();
    return false;
  }
  if (list.length >= MAX_WAITING) {
    throw new UserError('So many people are waiting for this product already – grab the **Restocks** role in the roles channel to get pinged when it is back.');
  }
  g.notify[productId] = [...list, userId];
  db.save();
  return true;
}

async function onNotifyButton(interaction, productId) {
  const guild = interaction.guild;
  const product = shop.findProduct(guild.id, productId);
  if (!product) throw new UserError('This product is no longer in the shop.');
  const name = `${shop.productEmoji(guild, product)} **${product.name}**`;
  if (product.stock !== 'out') {
    return reply(interaction, {
      embeds: [embed(COLORS.success).setDescription(`🎉 ${name} is in stock right now – you can order it straight away.`)],
      components: [row(btn(`shop:buy:${product.id}`, 'Buy now', ce(guild, 'cart'), ButtonStyle.Primary))],
    });
  }
  const on = toggle(guild.id, product.id, interaction.user.id);
  const description = on
    ? `🔔 **You're on the list!** I'll send you one DM as soon as ${name} is back in stock.\n-# Click **Notify me** again to cancel. Make sure your DMs are open for members of this server.`
    : `🔕 **Okay, no DM.** You won't be notified about ${name} anymore.\n-# Changed your mind? Click **Notify me** again.`;
  return reply(interaction, { embeds: [embed(on ? COLORS.brand : COLORS.muted).setDescription(description)] });
}

/** The DM someone gets when a product they waited for is back. */
function restockDm(guild, product) {
  const image = images.attachment(product);
  const c = container(COLORS.success);
  header(
    c,
    `## 🔔 Back in stock!\n${shop.productEmoji(guild, product)} **${product.name}** is available again at **${config.brand.name}**.\n` +
      `**Price:** ${shop.formatPrice(product.price)}\n-# Restocks can sell out fast – be quick!`,
    image?.url ?? guild.iconURL?.({ size: 256 }),
  );
  const shopChannel = db.channelId(guild.id, 'shop');
  if (shopChannel) c.addActionRowComponents(row(linkBtn(channelUrl(guild.id, shopChannel), 'Buy now in the shop', ce(guild, 'cart'))));
  c.addTextDisplayComponents(text(`-# You asked to be notified on ${guild.name}. This was a one-time message.`));
  return v2(c, { files: image ? [image.file] : [] });
}

/** DMs everyone waiting for the product, once, and clears its list → number of DMs delivered. */
async function notifyRestock({ guild, product }) {
  const g = db.guild(guild.id);
  const ids = [...new Set(g.notify[product.id] ?? [])];
  if (!ids.length) return 0;
  delete g.notify[product.id]; // cleared first – a DM is never sent twice, even if one fails
  db.save();
  let sent = 0;
  for (const id of ids) {
    const user = await guild.client.users.fetch(id).catch(() => null);
    const ok = user ? await user.send(restockDm(guild, product)).then(() => true, () => false) : false;
    if (ok) sent += 1;
  }
  console.log(`[restock] ${product.name}: notified ${sent}/${ids.length} ${ids.length === 1 ? 'person' : 'people'} by DM`);
  return sent;
}

hooks.on('productRestocked', notifyRestock);
hooks.route('restock', {
  button: (interaction, action, [productId]) => (action === 'notify' ? onNotifyButton(interaction, productId) : null),
});

module.exports = { MAX_WAITING, waiting, toggle, restockDm, notifyRestock };
