'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const promos = require('../features/promos');
const { COLORS } = require('../lib/theme');
const { UserError, embed, logEmbed, money, reply, replyError, sendLog, truncate, ts } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');

const MAX_LIST = 3800; // embed description budget (Discord allows 4096)

/** 'active' | 'expired' | 'used up' | 'inactive' */
function status(p, now = Date.now()) {
  if (!p.active) return 'inactive';
  if (p.expiresAt && now > p.expiresAt) return 'expired';
  if (p.maxUses != null && p.uses.length >= p.maxUses) return 'used up';
  return 'active';
}

const DOT = { active: '🟢', expired: '⌛', 'used up': '🔴', inactive: '⚫' };
/** "1/3 uses", plus the open orders holding the code: "0/1 uses · 1 held by an open order". */
const uses = (p, held = 0) =>
  `${p.uses.length}/${p.maxUses ?? '∞'} uses${held ? ` · ${held === 1 ? '1 held by an open order' : `${held} held by open orders`}` : ''}`;
/** Open orders hold every remaining use – new orders can't use the code until one of them is cancelled. */
const fullyHeld = (p, held) => p.maxUses != null && held > 0 && p.uses.length < p.maxUses && p.uses.length + held >= p.maxUses;
const expiry = (p) => (p.expiresAt ? `${Date.now() > p.expiresAt ? 'expired' : 'expires'} ${ts(p.expiresAt, 'R')}` : 'no expiry');

function line(p, held = 0) {
  const s = status(p);
  const flags = [];
  if (p.firstOrderOnly) flags.push('first order only');
  if (!p.oncePerUser) flags.push('reusable');
  const owner = p.userId ? ` · 👤 personal: <@${p.userId}>${p.reason ? ` (${p.reason})` : ''}` : '';
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
  if (lines.length < list.length) lines.push(`-# …and ${list.length - lines.length} more – look one up with \`/promo info\`.`);
  return embed(COLORS.brand)
    .setTitle(`🏷️ Promo codes (${list.length})`)
    .setDescription(lines.join('\n') || 'No promo codes yet – create one with `/promo create`.')
    .addFields(
      { name: 'Active', value: String(active), inline: true },
      { name: 'Public', value: String(list.length - personal.length), inline: true },
      { name: 'Personal', value: String(personal.length), inline: true },
    );
}

/** Discount, status, uses, expiry and rules of a code as embed fields. held – open orders holding it. */
function detailFields(p, held = 0) {
  const s = status(p);
  return [
    { name: 'Discount', value: promos.label(p), inline: true },
    { name: 'Status', value: `${DOT[s]} ${s}${s === 'active' && fullyHeld(p, held) ? ' – all remaining uses are held by open orders' : ''}`, inline: true },
    { name: 'Uses', value: uses(p, held), inline: true },
    { name: 'Expires', value: p.expiresAt ? `${ts(p.expiresAt, 'f')} (${ts(p.expiresAt, 'R')})` : 'Never', inline: true },
    { name: 'Once per member', value: p.oncePerUser ? 'Yes' : 'No', inline: true },
    { name: 'First order only', value: p.firstOrderOnly ? 'Yes' : 'No', inline: true },
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
  if (p.userId) e.addFields({ name: 'Personal code', value: `👤 <@${p.userId}>${p.reason ? ` · ${p.reason}` : ''}`, inline: true });
  e.addFields({ name: 'Created', value: `${ts(p.createdAt, 'R')}${p.createdBy ? ` by <@${p.createdBy}>` : ' automatically'}`, inline: true });
  e.addFields({ name: `Recent uses (${p.uses.length})`, value: truncate(recent.join('\n') || 'Not used yet.', 1024) });
  const holding = promos.openOrdersWith(guildId, p.code);
  if (holding.length) {
    const lines = holding.slice(0, 15).map((t) => `<#${t.channelId}> · <@${t.ownerId}>`);
    if (holding.length > lines.length) lines.push(`…and ${holding.length - lines.length} more`);
    e.addFields({ name: `Held by open orders (${holding.length})`, value: truncate(`${lines.join('\n')}\n-# Counted as used until the order is completed or closed.`, 1024) });
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
        .addStringOption((o) => o.setName('code').setDescription('The code buyers type, e.g. NOX10 (3–24 letters, numbers, - and _)').setRequired(true).setMinLength(3).setMaxLength(24))
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
        .map((p) => ({ name: truncate(`${p.code} · ${promos.label(p)} · ${uses(p)} · ${status(p)}${p.userId ? ' · personal' : ''}`, 100), value: p.code })),
    );
  },

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Only administrators and sellers can manage promo codes.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'create') {
      const percent = o.getInteger('percent');
      const amount = o.getNumber('amount');
      if (percent == null && amount == null) throw new UserError(`Give the discount: either **percent** (e.g. 10 → 10% off) or **amount** (e.g. 5 → ${money(5)} off).`);
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
            .setTitle(`🏷️ Promo code ${p.code} created`)
            .setDescription(
              `Buyers type \`${p.code}\` in the **Promo code** field of the order form.` +
                (config.promos.enabled === false ? '\n⚠️ Promo codes are turned off in `config.json` (`promos.enabled`) – the order form has no code field right now.' : ''),
            )
            .addFields(detailFields(p)),
        ],
      });
      return sendLog(guild, { embeds: [logEmbed(COLORS.brand, '🏷️ Promo code created', interaction.user).setDescription(`${interaction.user} created \`${p.code}\` · ${line(p)}`)] });
    }

    if (sub === 'list') return reply(interaction, { embeds: [listEmbed(guild.id)] });

    const code = promos.normalize(o.getString('code'));
    const p = promos.find(guild.id, code);
    if (!p) throw new UserError(`There is no promo code **${truncate(code, 24)}**. Pick one from the suggestions.`);

    if (sub === 'info') return reply(interaction, { embeds: [infoEmbed(guild.id, p)] });

    promos.remove(guild.id, p.code);
    await reply(interaction, `Deleted the promo code **${p.code}** (${promos.label(p)}, ${uses(p)}). It can't be used anymore – open orders that already use it keep their discount.`);
    return sendLog(guild, { embeds: [logEmbed(COLORS.danger, '🗑️ Promo code deleted', interaction.user).setDescription(`${interaction.user} deleted \`${p.code}\` (${promos.label(p)}, ${uses(p)})`)] });
  },
};
