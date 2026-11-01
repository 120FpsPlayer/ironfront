'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const affiliates = require('../features/affiliates');
const promos = require('../features/promos');
const { COLORS } = require('../lib/theme');
const { UserError, embed, logEmbed, money, reply, replyError, sendLog, truncate, count, plural } = require('../lib/utils');
const { isShopManager, isStaff } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const MANAGE = ['create', 'list', 'remove', 'payout'];

/** DMs a creator – a closed DM is fine, the team sees the answer anyway. */
const dm = (user, payload) => user.send({ ...payload, allowedMentions: { parse: [] } }).then(() => true).catch(() => false);

async function create(interaction) {
  if (!affiliates.enabled()) throw new UserError('Kody twórców są wyłączone w `config.json` (`affiliates.enabled`).');
  const o = interaction.options;
  const user = o.getUser('user');
  if (user.bot) throw new UserError('Boty nie mogą być twórcami – wybierz członka serwera.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // the DM to the creator can take a moment
  const a = affiliates.create(interaction.guild.id, {
    userId: user.id,
    code: o.getString('code'),
    discount: o.getInteger('discount'),
    commission: o.getInteger('commission'),
    createdBy: interaction.user.id,
  });
  const terms = `kupujący dostają **${a.discount}% rabatu**, a <@${a.userId}> zarabia **${a.commission}%** od każdej zrealizowanej sprzedaży z tym kodem`;
  const told = await dm(user, {
    embeds: [
      embed(COLORS.success)
        .setTitle('🎥 Masz kod twórcy!')
        .setDescription(
          `Twój kod na serwerze **${truncate(interaction.guild.name, 100)}** to **${a.code}** – Twoi odbiorcy dostają z nim **${a.discount}% rabatu**, ` +
            `a Ty zarabiasz **${a.commission}%** od każdej zrealizowanej sprzedaży.\n-# Wpisują go w polu **Kod rabatowy** w formularzu zamówienia. \`${slash('affiliate stats')}\` pokazuje Twoje zarobki.`,
        ),
    ],
  });
  await reply(interaction, {
    embeds: [
      embed(COLORS.success)
        .setTitle(`🎥 Kod twórcy ${a.code} utworzony`)
        .setDescription(
          `Warunki: ${terms}. Kupujący wpisują \`${a.code}\` w polu **Kod rabatowy** w formularzu zamówienia – każdy członek może go używać dowolną liczbę razy; sam twórca nie może z niego korzystać.` +
            `\n-# ${told ? 'Wiadomość prywatna do twórcy została wysłana.' : 'Nie udało się wysłać wiadomości prywatnej do twórcy – przekaż kod samodzielnie.'}` +
            (config.promos.enabled === false ? '\n⚠️ Kody rabatowe są wyłączone w `config.json` (`promos.enabled`) – formularz zamówienia nie ma teraz pola na kod.' : ''),
        ),
    ],
  });
  return sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.brand, '🎥 Kod twórcy utworzony', interaction.user).setDescription(`Utworzony przez ${interaction.user}: \`${a.code}\` – ${terms}.`)],
  });
}

async function remove(interaction) {
  const { entry, open } = affiliates.remove(interaction.guild.id, interaction.options.getString('code'), interaction.user.id);
  const owed = affiliates.owedOf(entry);
  await reply(
    interaction,
    `Usunięto kod twórcy **${entry.code}** należący do <@${entry.userId}> – nie można go już używać w nowych zamówieniach.` +
      (open ? ` ${open} ${plural(open, 'otwarte zamówienie zachowuje', 'otwarte zamówienia zachowują', 'otwartych zamówień zachowuje')} rabat, a twórca nadal dostanie z ${open === 1 ? 'niego' : 'nich'} prowizję.` : '') +
      (owed > 0 ? ` Do wypłaty pozostaje jeszcze **${money(owed)}** – po wypłacie użyj \`${slash('affiliate payout')}\`.` : ''),
  );
  return sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.danger, '🗑️ Kod twórcy usunięty', interaction.user).setDescription(`Usunięty przez ${interaction.user}: \`${entry.code}\` należący do <@${entry.userId}>${owed > 0 ? ` – do wypłaty pozostaje ${money(owed)}` : ''}`)],
  });
}

async function payout(interaction) {
  const user = interaction.options.getUser('user');
  if (!affiliates.byUser(interaction.guild.id, user.id).length) throw new UserError(`<@${user.id}> nie ma kodu twórcy.`);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const { amount, codes } = affiliates.payout(interaction.guild.id, user.id, interaction.user.id);
  if (amount <= 0) return reply(interaction, `<@${user.id}> nie ma teraz nic do wypłaty – cała prowizja została już wypłacona.`);
  const told = await dm(user, {
    embeds: [embed(COLORS.success).setTitle('💸 Prowizja wypłacona').setDescription(`**${money(amount)}** prowizji z ${codes.length === 1 ? 'Twojego kodu' : 'Twoich kodów'} **${codes.join(', ')}** na serwerze **${truncate(interaction.guild.name, 100)}** zostało Ci wypłacone. Dziękujemy! 🧡`)],
  });
  await reply(interaction, `Oznaczono **${money(amount)}** jako wypłacone dla <@${user.id}> (${codes.join(', ')}). Nic nie zostało do wypłaty.${told ? ' Wysłano wiadomość prywatną.' : ''}\n-# To tylko zapis – pieniądze wyślij samodzielnie.`);
  return sendLog(interaction.guild, {
    embeds: [logEmbed(COLORS.success, '💸 Prowizja twórcy wypłacona', interaction.user).setDescription(`Wypłacone przez ${interaction.user}: **${money(amount)}** dla <@${user.id}> (${codes.join(', ')})`)],
  });
}

function stats(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const self = user.id === interaction.user.id;
  if (!self && !isStaff(interaction.member)) throw new UserError('Możesz zobaczyć tylko swoje statystyki twórcy.');
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
        .addStringOption((o) => o.setName('code').setDescription('The code buyers type, e.g. HS-ALEX (3–24 letters, numbers, - and _)').setRequired(true).setMinLength(3).setMaxLength(24))
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
        .map((a) => ({ name: truncate(`${a.code} · ${a.discount ?? '?'}% rabatu · ${a.commission}% prowizji · ${count((a.sales ?? []).length, 'sprzedaż', 'sprzedaże', 'sprzedaży')}`, 100), value: a.code })),
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (MANAGE.includes(sub) && !isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą zarządzać kodami twórców.');
    if (sub === 'create') return create(interaction);
    if (sub === 'list') return reply(interaction, { embeds: [affiliates.listEmbed(interaction.guild.id)] });
    if (sub === 'remove') return remove(interaction);
    if (sub === 'payout') return payout(interaction);
    return stats(interaction);
  },
};
