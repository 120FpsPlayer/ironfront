'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const flash = require('../features/flashsales');
const shop = require('../features/shop');
const { COLORS } = require('../lib/theme');
const { embed, logEmbed, reply, replyError, sendLog, truncate, ts } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

const MAX_LIST = 3800; // embed description budget (Discord allows 4096)

/** "−20% · ends in 2 hours (Monday 18:00)" */
const until = (sale) => `**−${sale.percent}%** · ends ${ts(sale.endsAt, 'R')} (${ts(sale.endsAt, 'f')})`;

function listEmbed(guildId) {
  const list = flash.onSale(guildId);
  const lines = [];
  let budget = MAX_LIST;
  for (const p of list) {
    const line = `⚡ **${p.name}** · ${until(p.sale)}\n-# ${truncate(flash.salePrices(p), 300)}${p.sale.startedBy ? ` · started by <@${p.sale.startedBy}>` : ''}`;
    if (budget - line.length - 1 < 0) break;
    budget -= line.length + 1;
    lines.push(line);
  }
  if (lines.length < list.length) lines.push(`-# …and ${list.length - lines.length} more.`);
  return embed(COLORS.brand)
    .setTitle(`⚡ Flash sales (${list.length})`)
    .setDescription(lines.join('\n') || 'Nothing is on sale right now – start a sale with `/sale start`.');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('sale')
    .setDescription('Flash sales – a percentage off a product for a while (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Put a product on sale – the shop shows the old and the new price with a countdown')
        .addStringOption((o) => o.setName('product').setDescription('Product').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('percent').setDescription(`Percent off (${flash.MIN_PERCENT}–${flash.MAX_PERCENT})`).setRequired(true).setMinValue(flash.MIN_PERCENT).setMaxValue(flash.MAX_PERCENT))
        .addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 30m, 2h, 1d or 1h30m (up to 7 days)').setRequired(true).setMaxLength(20))
        .addBooleanOption((o) => o.setName('announce').setDescription('Announce it in #restocks with a ping? (default: yes)')),
    )
    .addSubcommand((s) =>
      s
        .setName('stop')
        .setDescription('End a sale now')
        .addStringOption((o) => o.setName('product').setDescription('Product on sale').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('The products on sale right now')),

  /** start: every product · stop: only the ones on sale */
  autocomplete: (interaction) =>
    shop.autocomplete(interaction, { filter: interaction.options.getSubcommand(false) === 'stop' ? (p) => Boolean(shop.activeSale(p)) : null }),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Only administrators and sellers can run flash sales.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'list') return reply(interaction, { embeds: [listEmbed(guild.id)] });

    if (sub === 'stop') {
      const p = flash.stopSale(guild, o.getString('product'));
      await reply(interaction, `The sale of **${p.name}** has ended – it is back to **${shop.priceLabel(p)}**. The shop panel updates in a few seconds.`);
      return sendLog(guild, { embeds: [logEmbed(COLORS.danger, '⚡ Flash sale stopped', interaction.user).setDescription(`${interaction.user} ended the sale of **${p.name}**`)] });
    }

    const durationMs = flash.saleDuration(o.getString('duration'));
    const { product, replaced } = flash.startSale(guild, o.getString('product'), { percent: o.getInteger('percent'), durationMs, by: interaction.user.id });
    const notes = [];
    if (replaced) notes.push(`It replaces the −${replaced.percent}% sale that was running.`);
    if (product.stock === 'out') notes.push("It's sold out right now – buyers see the sale price once it's back in stock.");
    if ((o.getBoolean('announce') ?? true) && product.stock !== 'out') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (await flash.announceSale(guild, product).catch(() => null)) notes.push('Sale announced in #restocks 📣');
    }
    await reply(interaction, {
      embeds: [
        embed(COLORS.success)
          .setTitle(truncate(`⚡ ${product.name} is on sale`, 256))
          .setDescription(`${until(product.sale)}\n${truncate(flash.salePrices(product), 1500)}${notes.length ? `\n\n${notes.join('\n')}` : ''}\n-# The shop panel updates in a few seconds. End it early with \`/sale stop\`.`),
      ],
    });
    return sendLog(guild, {
      embeds: [logEmbed(COLORS.brand, '⚡ Flash sale started', interaction.user).setDescription(`${interaction.user} put **${product.name}** on sale: ${until(product.sale)}`)],
    });
  },
};
