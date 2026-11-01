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
const { UserError, embed, reply, plural } = require('../lib/utils');
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
    throw new UserError('Na ten produkt czeka już bardzo dużo osób – weź rolę **📦 Dostawy** na kanale z rolami, a dostaniesz ping, gdy wróci.');
  }
  g.notify[productId] = [...list, userId];
  db.save();
  return true;
}

async function onNotifyButton(interaction, productId) {
  const guild = interaction.guild;
  const product = shop.findProduct(guild.id, productId);
  if (!product) throw new UserError('Tego produktu nie ma już w sklepie.');
  const name = `${shop.productEmoji(guild, product)} **${product.name}**`;
  if (product.stock !== 'out') {
    return reply(interaction, {
      embeds: [embed(COLORS.success).setDescription(`🎉 ${name} jest teraz dostępny – możesz go od razu zamówić.`)],
      components: [row(btn(`shop:buy:${product.id}`, 'Kup teraz', ce(guild, 'cart'), ButtonStyle.Primary))],
    });
  }
  const on = toggle(guild.id, product.id, interaction.user.id);
  const description = on
    ? `🔔 **Jesteś na liście!** Wyślę Ci jedną wiadomość prywatną, gdy tylko ${name} wróci do sprzedaży.\n-# Kliknij ponownie **Powiadom mnie**, żeby anulować. Upewnij się, że masz włączone wiadomości prywatne od członków tego serwera.`
    : `🔕 **Okej, bez wiadomości.** Nie dostaniesz już powiadomienia o ${name}.\n-# Zmiana zdania? Kliknij ponownie **Powiadom mnie**.`;
  return reply(interaction, { embeds: [embed(on ? COLORS.brand : COLORS.muted).setDescription(description)] });
}

/** The DM someone gets when a product they waited for is back. */
function restockDm(guild, product) {
  const image = images.attachment(product);
  const c = container(COLORS.success);
  header(
    c,
    `## 🔔 Znowu dostępny!\n${shop.productEmoji(guild, product)} **${product.name}** jest znowu dostępny w **${config.brand.name}**.\n` +
      `**Cena:** ${shop.activeSale(product) ? shop.priceMarkdown(product) : shop.priceLabel(product)}\n-# Dostawy potrafią szybko się wyprzedać – nie zwlekaj!`,
    image?.url ?? guild.iconURL?.({ size: 256 }),
  );
  const shopChannel = db.channelId(guild.id, 'shop');
  if (shopChannel) c.addActionRowComponents(row(linkBtn(channelUrl(guild.id, shopChannel), 'Kup teraz w sklepie', ce(guild, 'cart'))));
  c.addTextDisplayComponents(text(`-# Prośba o powiadomienie została złożona na serwerze ${guild.name}. To jednorazowa wiadomość.`));
  return v2(c, { files: image ? [image.file] : [] });
}

// The last restock DMs per product, so /product can report them: `${guildId}:${productId}` → { sent, waiting }
const results = new Map();

/** DMs everyone waiting for the product, once, and clears its list → { sent, waiting }. */
async function notifyRestock({ guild, product }) {
  const key = `${guild.id}:${product.id}`;
  const g = db.guild(guild.id);
  const ids = [...new Set(g.notify[product.id] ?? [])];
  results.set(key, { sent: 0, waiting: ids.length });
  if (!ids.length) return results.get(key);
  delete g.notify[product.id]; // cleared first – a DM is never sent twice, even if one fails
  db.save();
  let sent = 0;
  for (const id of ids) {
    const user = await guild.client.users.fetch(id).catch(() => null);
    const ok = user ? await user.send(restockDm(guild, product)).then(() => true, () => false) : false;
    if (ok) sent += 1;
  }
  const result = { sent, waiting: ids.length };
  results.set(key, result);
  console.log(`[restock] ${product.name}: powiadomiono w wiadomości prywatnej ${sent}/${ids.length} ${plural(ids.length, 'osobę', 'osoby', 'osób')}`);
  return result;
}

/** The DMs of the last restock of a product (read once) → { sent, waiting } | null. */
function takeResult(guildId, productId) {
  const key = `${guildId}:${productId}`;
  const result = results.get(key) ?? null;
  results.delete(key);
  return result;
}

hooks.on('productRestocked', notifyRestock);
hooks.route('restock', {
  button: (interaction, action, [productId]) => (action === 'notify' ? onNotifyButton(interaction, productId) : null),
});

module.exports = { MAX_WAITING, waiting, toggle, restockDm, notifyRestock, takeResult };
