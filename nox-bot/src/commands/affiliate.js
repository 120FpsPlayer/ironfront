'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const affiliates = require('../features/affiliates');
const promos = require('../features/promos');
const { COLORS } = require('../lib/theme');
const { UserError, embed, logEmbed, money, reply, replyError, sendLog, truncate } = require('../lib/utils');
const { isShopManager, isStaff } = require('../lib/permissions');

const MANAGE = ['create', 'list', 'remove', 'payout'];

/** DMs a creator – a closed DM is fine, the team sees the answer anyway. */
const dm = (user, payload) => user.send({ ...payload, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);

async function create(interaction) {
  if (!affiliates.enabled()) throw new UserError('Creator codes are turned off in `config.json` (`affiliates.enabled`).');
  const o = interaction.options;
  const user = o.getUser('user');
  if (user.bot) throw new UserError("Bots can't be creators – pick a member.");
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // the DM to the creator can take a moment
  const a = affiliates.create(interaction.guild.id, {
    userId: user.id,
    code: o.getString('code'),
    discount: o.getInteger('discount'),
    commission: o.getInteger('commission'),
    createdBy: interaction.user.id,
  });
  const terms = `buyers get **${a.discount}% off**, <@${a.userId}> earns **${a.commission}%** of every completed sale with it`;
  const told = await dm(user, {
    embeds: [
      embed(COLORS.success)
        .setTitle('🎥 You have a creator code!')
        .setDescription(
          `Your code at **${truncate(interaction.guild.name, 100)}** is **${a.code}** – your audience gets **${a.discount}% off** with it, ` +
            `and you earn **${a.commission}%** of every completed sale.\n-# They type it in the **Promo code** field of the order form. \`/affiliate stats\` shows your earnings.`,
        ),
    ],
  });
  await reply(interaction, {
    embeds: [
      embed(COLORS.success)
        .setTitle(`🎥 Creator code ${a.code} created`)
        .setDescription(
          `${terms}. Buyers type \`${a.code}\` in the **Promo code** field of the order form – every member can use it, every time; the creator can't use it themselves.` +
            `\n-# ${told ? 'The creator got a DM.' : "I couldn't DM the creator – tell them their code."}` +
            (config.promos.enabled === false ? '\n⚠️ Promo codes are turned off in `config.json` (`promos.enabled`) – the order form has no code field right now.' : ''),
        ),
    ],
  });
  return sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.brand, '🎥 Creator code created', interaction.user).setDescription(`${interaction.user} created \`${a.code}\` – ${terms}.`)],
  });
}

async function remove(interaction) {
  const { entry, open } = affiliates.remove(interaction.guild.id, interaction.options.getString('code'), interaction.user.id);
  const owed = affiliates.owedOf(entry);
  await reply(
    interaction,
    `Removed the creator code **${entry.code}** of <@${entry.userId}> – it can't be used for new orders any more.` +
      (open ? ` ${open} open ${open === 1 ? 'order keeps its' : 'orders keep their'} discount, and the creator still earns from ${open === 1 ? 'it' : 'them'}.` : '') +
      (owed > 0 ? ` **${money(owed)}** is still owed – \`/affiliate payout\` once you've paid it.` : ''),
  );
  return sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.danger, '🗑️ Creator code removed', interaction.user).setDescription(`${interaction.user} removed \`${entry.code}\` of <@${entry.userId}>${owed > 0 ? ` – ${money(owed)} still owed` : ''}`)],
  });
}

async function payout(interaction) {
  const user = interaction.options.getUser('user');
  if (!affiliates.byUser(interaction.guild.id, user.id).length) throw new UserError(`<@${user.id}> has no creator code.`);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { amount, codes } = affiliates.payout(interaction.guild.id, user.id, interaction.user.id);
  if (amount <= 0) return reply(interaction, `Nothing is owed to <@${user.id}> right now – every commission is already paid out.`);
  const told = await dm(user, {
    embeds: [embed(COLORS.success).setTitle('💸 Commission paid out').setDescription(`**${money(amount)}** of commission from your code${codes.length === 1 ? '' : 's'} **${codes.join(', ')}** at **${truncate(interaction.guild.name, 100)}** was paid out to you. Thank you! 💜`)],
  });
  await reply(interaction, `Marked **${money(amount)}** as paid out to <@${user.id}> (${codes.join(', ')}). Nothing is owed now.${told ? ' They got a DM.' : ''}\n-# This only records it – send the money yourself.`);
  return sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.success, '💸 Creator commission paid out', interaction.user).setDescription(`${interaction.user} paid out **${money(amount)}** to <@${user.id}> (${codes.join(', ')})`)],
  });
}

function stats(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const self = user.id === interaction.user.id;
  if (!self && !isStaff(interaction.member)) throw new UserError('You can only see your own creator stats.');
  return reply(interaction, { embeds: [affiliates.statsEmbed(interaction.guild.id, user, { self })] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('affiliate')
    .setDescription('Creator codes: buyers get a discount, the creator earns commission on every sale')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Give a creator their own code (admins & sellers)')
        .addUserOption((o) => o.setName('user').setDescription('The creator').setRequired(true))
        .addStringOption((o) => o.setName('code').setDescription('The code buyers type, e.g. NOX-ALEX (3–24 letters, numbers, - and _)').setRequired(true).setMinLength(3).setMaxLength(24))
        .addIntegerOption((o) => o.setName('discount').setDescription(`Percent off for buyers (default: ${affiliates.defaults().discount}%)`).setMinValue(1).setMaxValue(100))
        .addIntegerOption((o) => o.setName('commission').setDescription(`Percent of each sale the creator earns (default: ${affiliates.defaults().commission}%)`).setMinValue(0).setMaxValue(100)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('All creator codes with their sales and the commission owed (admins & sellers)'))
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a creator code – new orders cannot use it (admins & sellers)')
        .addStringOption((o) => o.setName('code').setDescription('The code').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('payout')
        .setDescription("Mark a creator's owed commission as paid out (admins & sellers)")
        .addUserOption((o) => o.setName('user').setDescription('The creator').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('stats')
        .setDescription('Uses, sales, revenue and commission of your creator code')
        .addUserOption((o) => o.setName('user').setDescription("Another creator's stats (staff only)")),
    ),

  autocomplete(interaction) {
    if (!isShopManager(interaction.member)) return interaction.respond([]);
    const q = promos.normalize(interaction.options.getFocused());
    const guildId = interaction.guild.id;
    return interaction.respond(
      affiliates
        .list(guildId)
        .filter((a) => !a.removedAt && (!q || a.code.includes(q)))
        .slice(0, 25)
        .map((a) => ({ name: truncate(`${a.code} · ${a.discount ?? '?'}% off · ${a.commission}% commission · ${(a.sales ?? []).length} sales`, 100), value: a.code })),
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (MANAGE.includes(sub) && !isShopManager(interaction.member)) return replyError(interaction, 'Only administrators and sellers can manage creator codes.');
    if (sub === 'create') return create(interaction);
    if (sub === 'list') return reply(interaction, { embeds: [affiliates.listEmbed(interaction.guild.id)] });
    if (sub === 'remove') return remove(interaction);
    if (sub === 'payout') return payout(interaction);
    return stats(interaction);
  },
};
