'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const { COLORS } = require('../lib/theme');
const { embed, reply, isStaff, isAdmin } = require('../lib/utils');
const { isMod, isShopManager } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription(`All ${config.brand.name} bot commands you can use`).setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.member;
    const e = embed(COLORS.brand)
      .setTitle(`📖 ${config.brand.name} – help`)
      .setDescription('Buy something with the **Buy** buttons in the shop channel, get help with the **ticket panel**.')
      .addFields({
        name: '👤 Everyone',
        value: [
          '`/vouch` – leave a review after a purchase',
          '`/ticket info` · `/ticket close` – inside your ticket',
          '🔔 **Call support** – a button in your ticket if you have been waiting a while',
        ].join('\n'),
      });
    if (isStaff(member)) {
      e.addFields({
        name: '🎧 Staff',
        value: [
          '`/ticket claim` · `/ticket unclaim` · `/ticket add` · `/ticket remove`',
          '`/ticket priority` · `/ticket move` · `/ticket rename` · `/ticket request-close`',
          '`/ticket complete` – mark a purchase as delivered (Customer role + vouch request)',
          '`/reply` – canned replies · `/blacklist` · `/stats`',
        ].join('\n'),
      });
    }
    if (isShopManager(member)) {
      e.addFields({ name: '🛒 Shop', value: '`/product add` · `/product edit` · `/product stock` · `/product remove` · `/product list`' });
    }
    if (isMod(member)) {
      e.addFields({ name: '🎉 Community', value: '`/giveaway start` · `/giveaway end` · `/giveaway reroll` · `/giveaway list`\n`/announce` – styled announcement with banner & ping' });
    }
    if (isAdmin(member)) {
      e.addFields({
        name: '🛡️ Administration',
        value: ['`/build` – build the whole server', '`/build only:emojis` · `/build only:panels`', '`/panel` – re-send a panel', '`/setup show` · `/setup set` · `/setup role-add`'].join('\n'),
      });
    }
    return reply(interaction, { embeds: [e] });
  },
};
