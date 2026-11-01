'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const promos = require('../features/promos');
const { COLORS } = require('../lib/theme');
const { UserError, embed, logEmbed, money, reply, replyError, sendLog, truncate, ts, plural } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const MAX_LIST = 3800; // embed description budget (Discord allows 4096)

/** 'active' | 'expired' | 'used up' | 'inactive' */
function status(p, now = Date.now()) {
  if (!p.active) return 'inactive';
  if (p.expiresAt && now > p.expiresAt) return 'expired';
  if (p.maxUses != null && p.uses.length >= p.maxUses) return 'used up';
  return 'active';
}

const DOT = { active: '🟢', expired: '⌛', 'used up': '🔴', inactive: '⚫' };
const STATUS_LABEL = { active: 'aktywny', expired: 'wygasł', 'used up': 'wykorzystany', inactive: 'nieaktywny' };
/** Stored reasons of automatic codes → what is shown (other reasons as they are). */
const reasonText = (r) => ({ welcome: 'powitalny', manual: 'ręczny', 'creator code': 'kod twórcy' })[r] ?? r;
/** "1/3 użyć", plus the open orders holding the code: "0/1 użyć · 1 zarezerwowane przez otwarte zamówienie". */
const uses = (p, held = 0) =>
  `${p.uses.length}/${p.maxUses ?? '∞'} użyć${held ? ` · ${held === 1 ? '1 zarezerwowane przez otwarte zamówienie' : `${held} ${plural(held, 'zarezerwowane', 'zarezerwowane', 'zarezerwowanych')} przez otwarte zamówienia`}` : ''}`;
/** Open orders hold every remaining use – new orders can't use the code until one of them is cancelled. */
const fullyHeld = (p, held) => p.maxUses != null && held > 0 && p.uses.length < p.maxUses && p.uses.length + held >= p.maxUses;
const expiry = (p) => (p.expiresAt ? `${Date.now() > p.expiresAt ? 'wygasł' : 'wygasa'} ${ts(p.expiresAt, 'R')}` : 'bezterminowy');

function line(p, held = 0) {
  const s = status(p);
  const flags = [];
  if (p.firstOrderOnly) flags.push('tylko pierwsze zamówienie');
  if (!p.oncePerUser) flags.push('wielokrotnego użytku');
  const owner = p.userId
    ? ` · 👤 osobisty: <@${p.userId}>${p.reason ? ` (${reasonText(p.reason)})` : ''}`
    : p.affiliate
      ? ` · 🎥 kod twórcy <@${p.affiliate.userId}> (${p.affiliate.commission}% prowizji)`
      : '';
  return `${DOT[s]} \`${p.code}\` · **${promos.label(p)}** · ${uses(p, held)} · ${expiry(p)}${flags.length ? ` · ${flags.join(', ')}` : ''}${owner}`;
}

/** Public codes first, then personal ones – active before expired / used up, newest first. */
function sorted(list) {
  const rank = (p) => (p.userId ? 2 : 0) + (status(p) === 'active' ? 0 : 1);
  return [...list].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
}

function listEmbed(guildId) {
  const list = sorted(promos.list(guildId));
  const personal = list.filter((p) => p.userId);
  const active = list.filter((p) => status(p) === 'active').length;
  const lines = [];
  let budget = MAX_LIST;
  for (const p of list) {
    const l = line(p, promos.reservedBy(guildId, p.code).length);
    if (budget - l.length - 1 < 0) break;
    budget -= l.length + 1;
    lines.push(l);
  }
  if (lines.length < list.length) lines.push(`-# …i ${list.length - lines.length} więcej – sprawdź konkretny kod przez \`${slash('promo info')}\`.`);
  return embed(COLORS.brand)
    .setTitle(`🏷️ Kody rabatowe (${list.length})`)
    .setDescription(lines.join('\n') || `Nie ma jeszcze kodów rabatowych – utwórz pierwszy przez \`${slash('promo create')}\`.`)
    .addFields(
      { name: 'Aktywne', value: String(active), inline: true },
      { name: 'Publiczne', value: String(list.length - personal.length), inline: true },
      { name: 'Osobiste', value: String(personal.length), inline: true },
    );
}

/** Discount, status, uses, expiry and rules of a code as embed fields. held – open orders holding it. */
function detailFields(p, held = 0) {
  const s = status(p);
  return [
    { name: 'Rabat', value: promos.label(p), inline: true },
    { name: 'Status', value: `${DOT[s]} ${STATUS_LABEL[s]}${s === 'active' && fullyHeld(p, held) ? ' – wszystkie pozostałe użycia są zarezerwowane przez otwarte zamówienia' : ''}`, inline: true },
    { name: 'Użycia', value: uses(p, held), inline: true },
    { name: 'Wygasa', value: p.expiresAt ? `${ts(p.expiresAt, 'f')} (${ts(p.expiresAt, 'R')})` : 'Nigdy', inline: true },
    { name: 'Raz na osobę', value: p.oncePerUser ? 'Tak' : 'Nie', inline: true },
    { name: 'Tylko pierwsze zamówienie', value: p.firstOrderOnly ? 'Tak' : 'Nie', inline: true },
  ];
}

function infoEmbed(guildId, p) {
  const recent = p.uses
    .slice(-10)
    .reverse()
    .map((u) => `<@${u.userId}>${u.saleId ? ` · \`${u.saleId}\`` : ''} · ${ts(u.at, 'R')}`);
  const held = promos.reservedBy(guildId, p.code).length;
  const e = embed(status(p) === 'active' ? COLORS.success : COLORS.muted)
    .setTitle(`🏷️ ${p.code}`)
    .addFields(detailFields(p, held));
  if (p.userId) e.addFields({ name: 'Kod osobisty', value: `👤 <@${p.userId}>${p.reason ? ` · ${reasonText(p.reason)}` : ''}`, inline: true });
  e.addFields({ name: 'Utworzono', value: `${ts(p.createdAt, 'R')}${p.createdBy ? ` przez <@${p.createdBy}>` : ' automatycznie'}`, inline: true });
  e.addFields({ name: `Ostatnie użycia (${p.uses.length})`, value: truncate(recent.join('\n') || 'Jeszcze nieużyty.', 1024) });
  const holding = promos.openOrdersWith(guildId, p.code);
  if (holding.length) {
    const lines = holding.slice(0, 15).map((t) => `<#${t.channelId}> · <@${t.ownerId}>`);
    if (holding.length > lines.length) lines.push(`…i ${holding.length - lines.length} więcej`);
    e.addFields({ name: `Zarezerwowany przez otwarte zamówienia (${holding.length})`, value: truncate(`${lines.join('\n')}\n-# Liczy się jako użyty, dopóki zamówienie nie zostanie zrealizowane albo zamknięte.`, 1024) });
  }
  return e;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('promo')
    .setDescription('Discount codes for the shop (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a discount code – give a percentage OR an amount off')
        .addStringOption((o) => o.setName('code').setDescription('The code buyers type, e.g. HS10 (3–24 letters, numbers, - and _)').setRequired(true).setMinLength(3).setMaxLength(24))
        .addIntegerOption((o) => o.setName('percent').setDescription('Percent off (1–100)').setMinValue(1).setMaxValue(100))
        .addNumberOption((o) => o.setName('amount').setDescription(`Fixed amount off, in ${config.shop.currency ?? '€'}`).setMinValue(0.01).setMaxValue(100_000))
        .addIntegerOption((o) => o.setName('expires_in_days').setDescription('Valid for this many days (default: no expiry)').setMinValue(1).setMaxValue(3650))
        .addIntegerOption((o) => o.setName('max_uses').setDescription('How many orders can use it in total (default: unlimited)').setMinValue(1).setMaxValue(100_000))
        .addBooleanOption((o) => o.setName('once_per_user').setDescription('Each member can use it only once (default: yes)'))
        .addBooleanOption((o) => o.setName('first_order_only').setDescription("Only for members who haven't bought anything yet (default: no)")),
    )
    .addSubcommand((s) => s.setName('list').setDescription('All promo codes with their uses and expiry'))
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Details and recent uses of one code')
        .addStringOption((o) => o.setName('code').setDescription('The code').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete a code – it stops working right away')
        .addStringOption((o) => o.setName('code').setDescription('The code').setRequired(true).setAutocomplete(true)),
    ),

  autocomplete(interaction) {
    if (!isShopManager(interaction.member)) return interaction.respond([]);
    const q = promos.normalize(interaction.options.getFocused());
    return interaction.respond(
      sorted(promos.list(interaction.guild.id))
        .filter((p) => !q || p.code.includes(q))
        .slice(0, 25)
        .map((p) => ({ name: truncate(`${p.code} · ${promos.label(p)} · ${uses(p)} · ${STATUS_LABEL[status(p)]}${p.userId ? ' · osobisty' : ''}`, 100), value: p.code })),
    );
  },

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą zarządzać kodami rabatowymi.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'create') {
      const percent = o.getInteger('percent');
      const amount = o.getNumber('amount');
      if (percent == null && amount == null) throw new UserError(`Podaj rabat: **procent** (np. 10 → 10% rabatu) albo **kwota** (np. 5 → ${money(5)} rabatu).`);
      const days = o.getInteger('expires_in_days');
      const p = promos.create(guild.id, {
        code: o.getString('code'),
        percent,
        amount,
        expiresAt: days ? Date.now() + days * promos.DAY : null,
        maxUses: o.getInteger('max_uses'),
        oncePerUser: o.getBoolean('once_per_user') ?? true,
        firstOrderOnly: o.getBoolean('first_order_only') ?? false,
        reason: 'manual',
        createdBy: interaction.user.id,
      });
      await reply(interaction, {
        embeds: [
          embed(COLORS.success)
            .setTitle(`🏷️ Kod rabatowy ${p.code} utworzony`)
            .setDescription(
              `Kupujący wpisują \`${p.code}\` w polu **Kod rabatowy** w formularzu zamówienia.` +
                (config.promos.enabled === false ? '\n⚠️ Kody rabatowe są wyłączone w `config.json` (`promos.enabled`) – formularz zamówienia nie ma teraz pola na kod.' : ''),
            )
            .addFields(detailFields(p)),
        ],
      });
      return sendLog(guild, { embeds: [logEmbed(COLORS.brand, '🏷️ Kod rabatowy utworzony', interaction.user).setDescription(`Utworzony przez ${interaction.user}: \`${p.code}\` · ${line(p)}`)] });
    }

    if (sub === 'list') return reply(interaction, { embeds: [listEmbed(guild.id)] });

    const code = promos.normalize(o.getString('code'));
    const p = promos.find(guild.id, code);
    if (!p) throw new UserError(`Nie ma kodu rabatowego **${truncate(code, 24)}**. Wybierz kod z podpowiedzi.`);

    if (sub === 'info') return reply(interaction, { embeds: [infoEmbed(guild.id, p)] });

    promos.remove(guild.id, p.code);
    await reply(interaction, `Usunięto kod rabatowy **${p.code}** (${promos.label(p)}, ${uses(p)}). Nie można go już używać – otwarte zamówienia, które go używają, zachowują rabat.`);
    return sendLog(guild, { embeds: [logEmbed(COLORS.danger, '🗑️ Kod rabatowy usunięty', interaction.user).setDescription(`Usunięty przez ${interaction.user}: \`${p.code}\` (${promos.label(p)}, ${uses(p)})`)] });
  },
};
