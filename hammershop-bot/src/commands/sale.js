'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const deals = require('../features/deals');
const flash = require('../features/flashsales');
const shop = require('../features/shop');
const { COLORS } = require('../lib/theme');
const { embed, logEmbed, reply, replyError, sendLog, truncate, ts, count, plural } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const MAX_LIST = 3800; // embed description budget (Discord allows 4096)

/** "−20% · koniec za 2 godziny (poniedziałek 18:00)" */
const until = (sale) => `**−${sale.percent}%** · koniec ${ts(sale.endsAt, 'R')} (${ts(sale.endsAt, 'f')})`;

function listEmbed(guildId) {
  const list = flash.onSale(guildId);
  const lines = [];
  let budget = MAX_LIST;
  for (const p of list) {
    const line = `⚡ **${p.name}** · ${until(p.sale)}\n-# ${truncate(flash.salePrices(p), 300)}${p.sale.startedBy ? ` · uruchomiona przez <@${p.sale.startedBy}>` : ''}`;
    if (budget - line.length - 1 < 0) break;
    budget -= line.length + 1;
    lines.push(line);
  }
  if (lines.length < list.length) lines.push(`-# …i ${list.length - lines.length} więcej.`);
  return embed(COLORS.brand)
    .setTitle(`⚡ Promocje błyskawiczne (${list.length})`)
    .setDescription(lines.join('\n') || `Nic nie jest teraz w promocji – uruchom promocję przez \`${slash('sale start')}\`.`);
}

const DEAL_STATE = {
  planned: (slot) => `⏳ ${ts(slot.at, 'F')} (${ts(slot.at, 'R')})`,
  started: (slot, guildId) => {
    const p = shop.products(guildId).find((x) => x.id === slot.productId);
    return `✅ ${ts(slot.at, 'F')} – uruchomiona${p ? `: **${truncate(p.name, 80)}** −${slot.percent}%` : ''}`;
  },
  skipped: (slot) => `⏭️ ${ts(slot.at, 'F')} – pominięta, żaden produkt nie mógł zostać przeceniony`,
  missed: (slot) => `⌛ ${ts(slot.at, 'F')} – przegapiona (bot był offline albo sklep był zamknięty)`,
};

/** This week's plan, the deal running now and the settings. */
function dealEmbed(guildId) {
  const opts = deals.settings();
  const plan = deals.plan(guildId);
  const days = plan.days.filter((day) => plan.slots[day]);
  const running = deals.activeDeal(guildId);
  const perWeek = opts.minDays === opts.maxDays ? `${opts.minDays}` : `${opts.minDays}–${opts.maxDays}`;
  const parts = [
    `**Ten tydzień (${plan.week}):** ${days.length ? count(days.length, 'okazja', 'okazje', 'okazji') : 'nie zostały żadne dni z okazją'}`,
    ...days.map((day) => `> ${(DEAL_STATE[plan.slots[day].state] ?? DEAL_STATE.planned)(plan.slots[day], guildId)}`),
    running ? `\n🔥 **Trwa teraz:** **${truncate(running.product.name, 80)}** · ${until(running.product.sale)}` : null,
    `\n-# ${opts.minPercent}–${opts.maxPercent}% rabatu przez ${Math.round(opts.durationMs / 3_600_000)} h na losowy produkt (zwykła cena liczbowa, dostępny, bez promocji) · ` +
      `${perWeek} ${plural(opts.maxDays, 'dzień', 'dni', 'dni')} w tygodniu o losowej porze w godzinach pracy · ogłaszana na #dostawy · uruchom od razu przez \`${slash('sale deal')} teraz:True\``,
  ];
  if (!opts.enabled) parts.unshift(`⚠️ Automatyczne okazje są wyłączone w \`config.json\` (\`deals.enabled\`) – \`${slash('sale deal')} teraz:True\` nadal uruchomi okazję.\n`);
  return embed(COLORS.brand).setTitle(deals.TITLE).setDescription(truncate(parts.filter(Boolean).join('\n'), 4000));
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
    .addSubcommand((s) => s.setName('list').setDescription('The products on sale right now'))
    .addSubcommand((s) =>
      s
        .setName('deal')
        .setDescription("Deal of the week – this week's plan, or start one now")
        .addBooleanOption((o) => o.setName('now').setDescription('Start a deal right now on a random product? (default: only show the plan)')),
    ),

  /** start: every product · stop: only the ones on sale */
  autocomplete: (interaction) =>
    shop.autocomplete(interaction, { filter: interaction.options.getSubcommand(false) === 'stop' ? (p) => Boolean(shop.activeSale(p)) : null }),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą prowadzić promocje błyskawiczne.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'list') return reply(interaction, { embeds: [listEmbed(guild.id)] });

    if (sub === 'deal') {
      if (!o.getBoolean('now')) return reply(interaction, { embeds: [dealEmbed(guild.id)] });
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { product, announced } = await deals.startDeal(guild, { by: interaction.user.id });
      await reply(interaction, {
        embeds: [
          embed(COLORS.success)
            .setTitle(truncate(`🔥 ${product.name} to okazja tygodnia`, 256))
            .setDescription(
              `${until(product.sale)}\n${truncate(flash.salePrices(product), 1500)}${announced ? '\n\nOkazja ogłoszona na #dostawy 📣' : ''}\n` +
                `-# Panel sklepu zaktualizuje się za kilka sekund. Możesz ją zakończyć wcześniej przez \`${slash('sale stop')}\`.`,
            ),
        ],
      });
      return sendLog(guild, {
        embeds: [logEmbed(COLORS.brand, '🔥 Okazja tygodnia uruchomiona', interaction.user).setDescription(`Okazja uruchomiona przez ${interaction.user}: **${product.name}** ${until(product.sale)}`)],
      });
    }

    if (sub === 'stop') {
      const p = flash.stopSale(guild, o.getString('product'));
      await reply(interaction, `Promocja na **${p.name}** zakończona – cena wraca do **${shop.priceLabel(p)}**. Panel sklepu zaktualizuje się za kilka sekund.`);
      return sendLog(guild, { embeds: [logEmbed(COLORS.danger, '⚡ Promocja błyskawiczna zatrzymana', interaction.user).setDescription(`Promocja na **${p.name}** zakończona przez ${interaction.user}`)] });
    }

    const durationMs = flash.saleDuration(o.getString('duration'));
    const { product, replaced } = flash.startSale(guild, o.getString('product'), { percent: o.getInteger('percent'), durationMs, by: interaction.user.id });
    const notes = [];
    if (replaced) notes.push(`Zastępuje trwającą promocję −${replaced.percent}%.`);
    if (product.stock === 'out') notes.push('Produkt jest teraz wyprzedany – kupujący zobaczą cenę promocyjną, gdy wróci do sprzedaży.');
    if ((o.getBoolean('announce') ?? true) && product.stock !== 'out') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (await flash.announceSale(guild, product).catch(() => null)) notes.push('Promocja ogłoszona na #dostawy 📣');
    }
    await reply(interaction, {
      embeds: [
        embed(COLORS.success)
          .setTitle(truncate(`⚡ ${product.name} jest w promocji`, 256))
          .setDescription(`${until(product.sale)}\n${truncate(flash.salePrices(product), 1500)}${notes.length ? `\n\n${notes.join('\n')}` : ''}\n-# Panel sklepu zaktualizuje się za kilka sekund. Możesz ją zakończyć wcześniej przez \`${slash('sale stop')}\`.`),
      ],
    });
    return sendLog(guild, {
      embeds: [logEmbed(COLORS.brand, '⚡ Promocja błyskawiczna uruchomiona', interaction.user).setDescription(`Promocja uruchomiona przez ${interaction.user}: **${product.name}** ${until(product.sale)}`)],
    });
  },
};
