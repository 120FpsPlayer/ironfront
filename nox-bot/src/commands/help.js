'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const invites = require('../features/invites');
const { COLORS } = require('../lib/theme');
const { embed, reply, isStaff, isAdmin, truncate } = require('../lib/utils');
const { isMod, isShopManager } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription(truncate(`All ${config.brand.name} bot commands you can use`, 100)).setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.member;
    // Only what is turned on in config.json.
    const rewards = config.promos.enabled !== false && invites.levels().length > 0;
    const inviteLine = config.invites.enabled === false ? null : `\`/invites stats\` · \`/invites top\` – your invites${rewards ? ' and the rewards you can earn' : ' and the top inviters'}`;
    const e = embed(COLORS.brand)
      .setTitle(`📖 ${config.brand.name} – help`)
      .setDescription('Buy something with the **Buy** buttons in the shop channel, get help with the **ticket panel**.')
      .addFields({
        name: '👤 Everyone',
        value: [
          '`/vouch` – leave a review after a purchase',
          inviteLine,
          '`/ticket info` · `/ticket close` – inside your ticket',
          '🔔 **Call support** – a button in your ticket if you have been waiting a while',
          config.orders.paymentProofs === false ? null : '💳 **Pay** – a button in your order ticket: send your PaysafeCard PIN, the crypto transaction ID or a screenshot',
          '🧾 **My orders** – a button in the shop: your open orders, their status and all your receipts',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    if (isStaff(member)) {
      e.addFields({
        name: '🎧 Staff',
        value: [
          '`/ticket claim` · `/ticket unclaim` · `/ticket add` · `/ticket remove`',
          '`/ticket priority` · `/ticket move` · `/ticket rename` · `/ticket request-close`',
          '`/ticket complete` – mark a purchase as delivered (records the sale, receipt, proof, Customer role)',
          `⚙️ ticket menu → **Status: Paid / In progress**${config.orders.statusDms === false ? '' : ' – the customer gets a DM'}${config.staffReminders.enabled === false ? '' : ' · unclaimed tickets are reminded in the staff chat'}`,
          '`/customer view` · `/customer note add` – customer profiles and private notes',
          '`/reply` – canned replies · `/blacklist` · `/stats`',
        ].join('\n'),
      });
    }
    if (isShopManager(member)) {
      e.addFields({
        name: '🛒 Shop',
        value: [
          '`/product add` · `/product edit` · `/product stock` · `/product variants` · `/product delivery` · `/product remove` · `/product list` – categories, images, options, stock, files the buyer gets',
          '`/sale start` · `/sale stop` · `/sale list` – flash sales with a countdown in the shop',
          '`/promo create` · `/promo list` · `/promo info` · `/promo delete` – discount codes',
          '`/shop open` · `/shop close` · `/shop auto` · `/shop status` – open/closed status',
          '`/sales` – revenue, orders, top products and sellers',
        ].join('\n'),
      });
    }
    if (isMod(member)) {
      e.addFields({
        name: '🎉 Community',
        value:
          '`/giveaway start` · `/giveaway end` · `/giveaway reroll` · `/giveaway list` – `required_role` / `buyers_only` / `min_invites` limit who can enter (checked again at the draw)\n' +
          '`/announce` – styled announcement with banner & ping',
      });
      e.addFields({
        name: '🚨 Security',
        value: `\`/lockdown\` · \`/unlock\` – lock the server during a raid${config.security.impersonationAlerts ? '\nLook-alike staff accounts are reported in #automod-logs automatically' : ''}`,
      });
    }
    if (isAdmin(member)) {
      e.addFields({
        name: '🛡️ Administration',
        value: [
          '`/build` – build the whole server',
          '`/build only:update` – after a bot update: new channels & roles, names, panels',
          '`/build only:emojis` · `/build only:panels` · `/build only:names`',
          `\`/backup\` – back up the bot data now${config.backups.enabled ? ' (also automatic, in #backups)' : ''}`,
          '`/panel` – re-send a panel',
          '`/setup show` · `/setup set` · `/setup role-add`',
        ].join('\n'),
      });
    }
    return reply(interaction, { embeds: [e] });
  },
};
