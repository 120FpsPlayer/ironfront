'use strict';

/**
 * Creator (affiliate) codes – a promo code linked to a creator. Buyers type it in the promo field of the order
 * form and get its discount (the usual promo limits and holds apply – src/features/promos.js); the creator earns
 * a commission on every completed sale with it. The team pays it out by hand and marks it with /affiliate payout.
 *
 * AFFILIATE (db.guild(id).affiliates):
 * { code, userId, discount, commission, createdAt, createdBy, earned, paidOut,
 *   sales:   [{ saleId, ticketNumber, buyerId, amount, commission, at }] – one per completed sale (never twice)
 *   payouts: [{ amount, at, by }], removedAt, removedBy }
 *   its promo: a normal promo code with oncePerUser: false and affiliate: { userId, commission }
 *
 * ticket.order.affiliate = { code, userId, commission } – taken when the order is placed, so removing the code or
 * changing the commission later doesn't change what an open order earns.
 */

const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const promos = require('./promos');
const { COLORS } = require('../lib/theme');
const { UserError, embed, logEmbed, money, pad, sendTicketLog, truncate, ts, count, plural } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');

const MAX_LIST = 3800; // embed description budget (Discord allows 4096)

const enabled = () => config.affiliates?.enabled !== false;
const round = (n) => Math.round(n * 100) / 100;
const percentOr = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

/** The discount and commission a new code gets when the command leaves them out (config.json → affiliates). */
const defaults = () => ({
  discount: percentOr(config.affiliates?.discountPercent, 5),
  commission: percentOr(config.affiliates?.commissionPercent, 10),
});

const list = (guildId) => db.guild(guildId).affiliates;
const byUser = (guildId, userId) => list(guildId).filter((a) => a.userId === userId);
const owedOf = (a) => round(Math.max(0, (a.earned ?? 0) - (a.paidOut ?? 0)));

/** Is the code still in use – not removed, and its promo code still there (it can also go with /promo delete)? */
const isActive = (guildId, a) => !a.removedAt && promos.find(guildId, a.code)?.affiliate?.userId === a.userId;

/** The creator code entry of a code that can be used right now – or null. */
const activeByCode = (guildId, code) => list(guildId).find((a) => a.code === promos.normalize(code) && isActive(guildId, a)) ?? null;

// ───────────── Managing codes ─────────────

/** /affiliate create – the promo code (with its discount) and the creator entry. */
function create(guildId, { userId, code, discount = null, commission = null, createdBy = null }) {
  const d = defaults();
  const pct = discount ?? d.discount;
  const cut = commission ?? d.commission;
  if (!(Number(cut) >= 0 && Number(cut) <= 100)) throw new UserError('Prowizja musi wynosić od 0 do 100%.');
  const promo = promos.create(guildId, {
    code,
    percent: pct,
    oncePerUser: false, // a creator code is for everyone, every time
    reason: 'creator code',
    createdBy,
    affiliate: { userId, commission: Number(cut) },
  });
  const entry = {
    code: promo.code,
    userId,
    discount: promo.percent,
    commission: Number(cut),
    createdAt: promo.createdAt,
    createdBy,
    earned: 0,
    paidOut: 0,
    sales: [],
    payouts: [],
  };
  list(guildId).push(entry);
  db.save();
  return entry;
}

/**
 * /affiliate remove – the code stops working for new orders. Open orders that already use it keep their discount,
 * and the creator still earns from them; what is owed stays owed.
 */
function remove(guildId, code, by = null) {
  const c = promos.normalize(code);
  const entry = list(guildId).find((a) => a.code === c && !a.removedAt);
  if (!entry) throw new UserError(`Nie ma kodu twórcy **${truncate(c, 24)}**. Wybierz kod z podpowiedzi.`);
  if (promos.find(guildId, c)?.affiliate?.userId === entry.userId) promos.remove(guildId, c);
  const open = openOrders(guildId, entry);
  Object.assign(entry, { removedAt: Date.now(), removedBy: by });
  db.save();
  return { entry, open };
}

/** /affiliate payout – marks everything owed to this creator as paid out. → { amount, codes } (amount 0: nothing owed). */
function payout(guildId, userId, by = null) {
  const now = Date.now();
  let amount = 0;
  const codes = [];
  for (const a of byUser(guildId, userId)) {
    const owed = owedOf(a);
    if (owed <= 0) continue;
    a.payouts = [...(a.payouts ?? []), { amount: owed, at: now, by }];
    a.paidOut = round((a.paidOut ?? 0) + owed);
    amount = round(amount + owed);
    codes.push(a.code);
  }
  if (amount > 0) db.save();
  return { amount, codes };
}

/** Open orders that use this creator's code (and will earn commission when they're completed). */
const openOrders = (guildId, a) =>
  promos.openOrdersWith(guildId, a.code).filter((t) => (t.order.affiliate ? t.order.affiliate.userId === a.userId : isActive(guildId, a))).length;

/** Uses (completed + open orders), sales, revenue and commission of some creator codes together. */
function totals(guildId, entries) {
  const t = { uses: 0, open: 0, sales: 0, revenue: 0, earned: 0, paidOut: 0, owed: 0 };
  for (const a of entries) {
    const open = openOrders(guildId, a);
    const sales = a.sales ?? [];
    t.open += open;
    t.sales += sales.length;
    t.uses += sales.length + open;
    t.revenue = round(t.revenue + sales.reduce((n, s) => n + (Number(s.amount) || 0), 0));
    t.earned = round(t.earned + (a.earned ?? 0));
    t.paidOut = round(t.paidOut + (a.paidOut ?? 0));
    t.owed = round(t.owed + owedOf(a));
  }
  return t;
}

// ───────────── Orders and commission ─────────────

/** What an order's code earns: the order's own record, else the code as it is now, else the code as it was when the order was placed. */
function affiliateOf(guildId, ticket, code) {
  const c = promos.normalize(code);
  const own = ticket?.order?.affiliate;
  if (own?.userId && promos.normalize(own.code) === c) return own;
  const promo = promos.find(guildId, c);
  if (promo) return promo.affiliate ? { code: promo.code, userId: promo.affiliate.userId, commission: promo.affiliate.commission } : null;
  // The code was deleted since – it still counts if it was a creator code when the order was placed.
  const placedAt = ticket?.createdAt ?? 0;
  const past = list(guildId)
    .filter((a) => a.code === c && a.createdAt <= placedAt && (!a.removedAt || a.removedAt > placedAt))
    .at(-1);
  return past ? { code: past.code, userId: past.userId, commission: past.commission } : null;
}

const alreadyCredited = (guildId, saleId) => list(guildId).some((a) => (a.sales ?? []).some((s) => s.saleId === saleId));

/** The creator entry that gets a sale's commission (made again if it's missing, so nothing earned is lost). */
function entryFor(guildId, aff) {
  const mine = list(guildId).filter((a) => a.code === aff.code && a.userId === aff.userId);
  const entry = mine.find((a) => !a.removedAt) ?? mine.at(-1);
  if (entry) return entry;
  const made = { code: aff.code, userId: aff.userId, discount: null, commission: aff.commission, createdAt: Date.now(), createdBy: null, earned: 0, paidOut: 0, sales: [], payouts: [] };
  list(guildId).push(made);
  return made;
}

/**
 * Records the commission of a completed sale – once per sale. → { entry, aff, commission } or null (no creator
 * code, the creator's own order, a balance top-up, or already recorded). Synchronous, so it can't run twice.
 */
function credit(guildId, ticket, sale) {
  if (!sale?.id || !sale.promo || ticket?.order?.topUp) return null;
  if (alreadyCredited(guildId, sale.id)) return null;
  const aff = affiliateOf(guildId, ticket, sale.promo);
  if (!aff || aff.userId === sale.userId) return null;
  const pct = Number(aff.commission) || 0;
  const commission = sale.amount == null ? 0 : Math.max(0, round((Number(sale.amount) * pct) / 100));
  const entry = entryFor(guildId, aff);
  entry.sales = [...(entry.sales ?? []), { saleId: sale.id, ticketNumber: sale.ticketNumber ?? null, buyerId: sale.userId, amount: sale.amount ?? null, commission, at: Date.now() }];
  entry.earned = round((entry.earned ?? 0) + commission);
  db.save();
  return { entry, aff, commission };
}

/** An order placed with a creator code remembers it (and its commission) right away. */
function onOrderPlaced({ ticket }) {
  const latest = ticket && db.getTicket(ticket.channelId);
  const order = latest?.order;
  if (!order?.promo || order.affiliate) return;
  const promo = promos.find(latest.guildId, order.promo);
  if (!promo?.affiliate) return;
  db.updateTicket(latest.channelId, { order: { ...order, affiliate: { code: promo.code, userId: promo.affiliate.userId, commission: promo.affiliate.commission } } });
}

/** A completed sale with a creator code → the commission is recorded and the creator gets a DM. */
async function onOrderCompleted({ guild, ticket, sale }) {
  const done = credit(guild.id, ticket, sale);
  if (!done) return;
  const { entry, commission } = done;
  const user = await guild.client.users.fetch(entry.userId).catch(() => null);
  const dm =
    commission > 0 && user
      ? await user
          .send({
            embeds: [
              embed(COLORS.success)
                .setTitle('💸 Nowa prowizja')
                .setDescription(
                  `Dostajesz **${money(commission)}** prowizji za sprzedaż z Twoim kodem **${entry.code}** na serwerze **${truncate(guild.name, 100)}**.\n` +
                    `-# Do wypłaty dla Ciebie: ${money(owedOf(entry))} · \`${slash('affiliate stats')}\` pokazuje wszystko.`,
                ),
            ],
            allowedMentions: { parse: [] },
          })
          .then(() => true)
          .catch(() => false)
      : false;
  await sendTicketLog(guild, {
    embeds: [
      logEmbed(COLORS.brand, '🎥 Prowizja twórcy').addFields(
        { name: 'Twórca', value: `<@${entry.userId}>`, inline: true },
        { name: 'Kod', value: `\`${entry.code}\``, inline: true },
        { name: 'Sprzedaż', value: `\`${sale.id}\`${sale.ticketNumber ? ` (\`#${pad(sale.ticketNumber)}\`)` : ''}`, inline: true },
        { name: 'Prowizja', value: sale.amount == null ? '0 – zapłacona kwota jest nieznana' : `${money(commission)} (${done.aff.commission}% z ${money(sale.amount)})`, inline: true },
        { name: 'Do wypłaty łącznie', value: money(owedOf(entry)), inline: true },
        { name: 'Wiadomość prywatna', value: commission > 0 ? (dm ? 'wysłana' : 'nie udało się wysłać') : '—', inline: true },
      ),
    ],
  }).catch(() => null);
}

hooks.on('orderPlaced', onOrderPlaced);
hooks.on('orderCompleted', onOrderCompleted);

// ───────────── Embeds ─────────────

/** "🟢 `HS-ALEX` · 5% rabatu · 10% prowizji · 3 sprzedaże" */
function codeLine(guildId, a, { owner = false } = {}) {
  const active = isActive(guildId, a);
  const sales = (a.sales ?? []).length;
  const owed = owedOf(a);
  return (
    `${active ? '🟢' : '⚫'} \`${a.code}\`${owner ? ` · <@${a.userId}>` : ''}` +
    `${a.discount != null ? ` · ${a.discount}% rabatu` : ''} · ${a.commission}% prowizji · ${count(sales, 'sprzedaż', 'sprzedaże', 'sprzedaży')}` +
    `${owed > 0 ? ` · **${money(owed)} do wypłaty**` : ''}${active ? '' : a.removedAt ? ` · usunięty ${ts(a.removedAt, 'R')}` : ' · kod usunięty'}`
  );
}

/** /affiliate list – active codes first, then removed ones that still have commission owed, then the rest. */
function listEmbed(guildId) {
  const rank = (a) => (isActive(guildId, a) ? 0 : owedOf(a) > 0 ? 1 : 2);
  const all = [...list(guildId)].sort((a, b) => rank(a) - rank(b) || b.createdAt - a.createdAt);
  const lines = [];
  let budget = MAX_LIST;
  for (const a of all) {
    const l = codeLine(guildId, a, { owner: true });
    if (budget - l.length - 1 < 0) break;
    budget -= l.length + 1;
    lines.push(l);
  }
  if (lines.length < all.length) lines.push(`-# …i ${all.length - lines.length} więcej – statystyki jednego twórcy pokaże \`${slash('affiliate stats')}\`.`);
  const t = totals(guildId, all);
  return embed(COLORS.brand)
    .setTitle(`🎥 Kody twórców (${all.length})`)
    .setDescription(lines.join('\n') || `Nie ma jeszcze kodów twórców – utwórz pierwszy przez \`${slash('affiliate create')}\`.`)
    .addFields(
      { name: 'Aktywne', value: String(all.filter((a) => isActive(guildId, a)).length), inline: true },
      { name: 'Sprzedaż', value: `${t.sales} · ${money(t.revenue)}`, inline: true },
      { name: 'Do wypłaty łącznie', value: money(t.owed), inline: true },
    );
}

/** /affiliate stats – uses, sales, revenue and commission (earned / paid out / owed) of one creator. */
function statsEmbed(guildId, user, { self = false } = {}) {
  const entries = byUser(guildId, user.id);
  const name = user.globalName ?? user.username ?? 'Twórca';
  if (!entries.length) {
    throw new UserError(self ? 'Nie masz kodu twórcy. Jeśli chcesz go mieć, zapytaj zespół.' : `<@${user.id}> nie ma kodu twórcy.`);
  }
  const t = totals(guildId, entries);
  const recent = entries
    .flatMap((a) => (a.sales ?? []).map((s) => ({ ...s, code: a.code })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 5)
    .map((s) => `\`${s.code}\` · ${s.amount == null ? 'kwota nieznana' : money(s.amount)} → **+${money(s.commission)}** · ${ts(s.at, 'R')}`);
  const lastPayout = entries.flatMap((a) => a.payouts ?? []).sort((a, b) => b.at - a.at)[0];
  return embed(COLORS.brand)
    .setTitle(truncate(`🎥 Statystyki twórcy – ${name}`, 256))
    .setDescription(
      truncate(entries.map((a) => codeLine(guildId, a)).join('\n'), 3000) +
        (self ? '\n-# Kupujący wpisują Twój kod w polu **Kod rabatowy** w formularzu zamówienia. Prowizję wypłaca zespół.' : ''),
    )
    .addFields(
      { name: 'Użycia', value: `${t.uses}${t.open ? ` (${t.open} w ${plural(t.open, 'otwartym zamówieniu', 'otwartych zamówieniach', 'otwartych zamówieniach')})` : ''}`, inline: true },
      { name: 'Sprzedaż', value: String(t.sales), inline: true },
      { name: 'Przychód', value: money(t.revenue), inline: true },
      { name: 'Zarobiona prowizja', value: money(t.earned), inline: true },
      { name: 'Wypłacono', value: `${money(t.paidOut)}${lastPayout ? ` · ostatnio ${ts(lastPayout.at, 'R')}` : ''}`, inline: true },
      { name: 'Do wypłaty', value: `**${money(t.owed)}**`, inline: true },
      { name: 'Ostatnia sprzedaż', value: recent.join('\n') || 'Jeszcze nic nie sprzedano.' },
    );
}

module.exports = { enabled, defaults, list, byUser, owedOf, isActive, activeByCode, create, remove, payout, totals, affiliateOf, credit, listEmbed, statsEmbed };
