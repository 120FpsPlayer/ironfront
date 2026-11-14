'use strict';

/**
 * „Zaproś znajomego” – the bot's side of the referral programme (the website's side is src/web/referrals.js):
 * a friend who came through your link buys Hammer+ for the first time → you get 7 days of Hammer+ for free.
 *
 * Extra time on a Minecraft account reaches the launcher the way a second purchase does (src/features/website.js
 * deliverPlus): the launcher checks codes offline and each code is signed with its end date, so a NEW code is issued for
 * that account – the time it still has plus the reward – and sent by DM; the player pastes it in Hammer+ → „Mam kod”
 * and the launcher keeps the longer code. The website shows the same code again (signed anew from what was issued).
 *
 *   - you have Hammer+ running on an account tied to your Discord (a purchase on the website, or /hammerplus grant with
 *     "user"): the 7 days go onto that account right away – new code by DM, the 💎 Hammer+ role kept in sync
 *   - you don't (or only Hammer+ forever): the days wait as a balance; you claim them on the website by typing your
 *     Minecraft nick (checked at Mojang, like a purchase) – the code shows on the page and comes by DM
 */

const webStore = require('../web/store');
const { COLORS, e, ce } = require('../lib/theme');
const { container, header, text, divider, linkBtn, row, v2 } = require('../lib/v2');
const { logEmbed, sendLog, UserError } = require('../lib/utils');
const { REWARD_DAYS } = require('../web/referrals');

const DAY_MS = 86_400_000;
const hp = () => require('./hammerplus');
const siteGuild = () => require('./website').guildOf();
/** The launcher page's referral card – where the link, the numbers and the claim are. */
const cardUrl = () => {
  const page = require('./launcherinfo').page();
  return page ? `${page}#polecaj` : null;
};
const plural = (n) => (n === 1 ? 'dzień' : 'dni');

/**
 * The account a reward goes onto: the Minecraft account of this Discord user whose Hammer+ is running and has an end
 * (the most recently issued first) → { mc, nick, until } | null.
 */
function accountOf(guildId, discordId, now = Date.now()) {
  const mine = hp().codes(guildId).filter((c) => c.discordId === String(discordId)).sort((a, b) => b.at - a.at);
  for (const c of mine) {
    const until = hp().runningUntil(guildId, c.mc, now);
    if (until) return { mc: c.mc, nick: c.nick, until };
  }
  return null;
}

/**
 * days of Hammer+ on the account, after the time it still has – a new code, written down like any other.
 * friend: whose purchase earned it (null for claimed days). → { code, record, days (in the code), replaces (the account had Hammer+) }
 */
function grantOnto(guild, { mc, nick }, days, discordId, now, friend = null) {
  const until = hp().runningUntil(guild.id, mc, now);
  const extra = until ? Math.ceil((until * 1000 - now) / DAY_MS) : 0;
  const total = Math.min(hp().MAX_DAYS, days + extra);
  const { code, record } = hp().grantKnown(guild.id, { mc, nick, days: total, now, source: 'referral', discordId });
  webStore.addReferralReward(discordId, { id: record.id, mc, nick: record.nick, days: total, at: now, friend: friend ? String(friend) : null });
  return { code, record, days: total, replaces: Boolean(until) };
}

/** The DM with a code from the programme – a reward that went straight onto the account, or claimed days. */
function codeDm(guild, { title, lead, code, record, replaces }) {
  const c = container(COLORS.success);
  header(c, `## ${title}\n${lead}`, guild?.iconURL?.({ size: 128 }));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`\`\`\`\n${code}\n\`\`\``));
  c.addTextDisplayComponents(
    text(
      `**Konto Minecraft:** \`${record.nick}\` · **Ważny:** ${hp().validity(record.exp)}\n` +
        `**Jak go użyć:** Hammer Launcher → **Hammer+** → **„Mam kod”** → wklej kod. ${replaces ? 'Zastąpi poprzedni kod na tym koncie.' : 'Działa tylko na tym koncie Minecraft.'}\n` +
        `-# Zaproś znajomego: +${REWARD_DAYS} dni Hammer+ za każdego znajomego, który kupi Hammer+ z Twojego linku.`,
    ),
  );
  if (cardUrl()) c.addActionRowComponents(row(linkBtn(cardUrl(), 'Twój link polecający', ce(guild, 'gift'))));
  return v2(c);
}

/** The DM when the days wait to be claimed on the website. */
function balanceDm(guild, balance) {
  const c = container(COLORS.success);
  header(c, `## 🎁 Twój znajomy kupił Hammer+ – dostajesz +${REWARD_DAYS} dni!\nDziękujemy, że polecasz Hammer Launchera.`, guild?.iconURL?.({ size: 128 }));
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `Masz **${balance} ${plural(balance)} Hammer+** do odebrania. Wejdź na stronę launchera → **Zaproś znajomego**, wpisz swój nick z Minecrafta i odbierz kod.\n` +
        '-# Dni nie przepadają – odbierzesz je, kiedy chcesz.',
    ),
  );
  if (cardUrl()) c.addActionRowComponents(row(linkBtn(cardUrl(), 'Odbierz na stronie', ce(guild, 'gift'))));
  return v2(c);
}

async function dm(guild, userId, payload) {
  const user = await guild?.client?.users?.fetch?.(String(userId)).catch(() => null);
  return Promise.resolve()
    .then(() => user.send(payload))
    .then(() => true, () => false); // closed DMs: the website still shows everything
}

/**
 * A paid Hammer+ order on the website (src/features/website.js onPaid). When it is the buyer's first and somebody
 * referred them, that somebody gets the reward. → 'granted' | 'balance' | null (nothing to reward). Never throws.
 */
async function onPurchase(order, now = Date.now()) {
  try {
    if (order?.kind !== 'plus' || order.status !== 'paid') return null;
    const referrer = webStore.referralPurchase(order.userId, order.id, now);
    if (!referrer) return null;
    return await reward(referrer, order.userId, now);
  } catch (err) {
    console.warn(`[referrals] nagroda za ${order?.id}:`, err.message);
    return null;
  }
}

async function reward(referrerId, friendId, now) {
  const guild = siteGuild();
  const account = guild ? accountOf(guild.id, referrerId, now) : null;
  let granted = null;
  if (account) {
    try {
      granted = grantOnto(guild, account, REWARD_DAYS, referrerId, now, friendId);
    } catch (err) {
      console.warn(`[referrals] kod dla ${account.nick}:`, err.message); // no key, …: the days wait on the website instead
    }
  }
  webStore.addReferralDays(referrerId, REWARD_DAYS, { balance: !granted });
  const balance = webStore.referralOf(referrerId)?.balance ?? 0;
  let sent = false;
  if (granted) {
    sent = await dm(guild, referrerId, codeDm(guild, { title: `🎁 Twój znajomy kupił Hammer+ – dostajesz +${REWARD_DAYS} dni!`, lead: `Dziękujemy, że polecasz Hammer Launchera. Oto Twój nowy kod – ma już doliczone ${REWARD_DAYS} dni:`, ...granted }));
    await require('./plusrole').sync(guild, referrerId, now).catch(() => null); // 💎 Hammer+
  } else if (guild) {
    sent = await dm(guild, referrerId, balanceDm(guild, balance));
  }
  if (guild) {
    await sendLog(guild, {
      embeds: [
        logEmbed(COLORS.success, '🎁 Zaproś znajomego – nagroda', guild.client.user).addFields(
          { name: 'Polecający', value: `<@${referrerId}>`, inline: true },
          { name: 'Znajomy', value: `<@${friendId}> – pierwszy Hammer+`, inline: true },
          { name: 'Nagroda', value: granted ? `+${REWARD_DAYS} dni na konto \`${granted.record.nick}\` (${hp().validity(granted.record.exp)})` : `+${REWARD_DAYS} dni do odebrania na stronie (razem ${balance})`, inline: false },
          { name: 'DM', value: sent ? 'wysłany' : 'nie doszedł – wszystko jest na stronie', inline: true },
        ),
      ],
    }).catch(() => null);
  }
  return granted ? 'granted' : 'balance';
}

/**
 * The website's „Odbierz” (POST /api/shop/referrals/claim): the whole balance becomes Hammer+ on the account behind
 * nick – looked up at Mojang first, added after the time it still has. → { code, nick, until (ms, 0 = never), days }.
 * Throws a UserError (said on the page) for a wrong nick or an account with Hammer+ forever; the balance then stays.
 */
async function claim(user, nick, now = Date.now()) {
  const guild = siteGuild();
  if (!guild) throw Object.assign(new Error('Bot nie jest jeszcze połączony z Discordem – spróbuj ponownie za chwilę.'), { status: 503 });
  hp().requireKey();
  const account = await hp().lookup(nick);
  if (hp().runningUntil(guild.id, account.mc, now) === 0) throw new UserError(`Konto ${account.nick} ma już Hammer+ na zawsze – wpisz inne konto, a dni trafią na nie.`);
  const days = webStore.takeReferralBalance(user.id);
  if (!days) throw Object.assign(new Error('Nie masz teraz dni Hammer+ do odebrania.'), { status: 409 });
  let granted;
  try {
    granted = grantOnto(guild, account, days, user.id, now);
  } catch (err) {
    webStore.addReferralDays(user.id, days, { earned: false, balance: true }); // nothing was issued: the days stay
    throw err;
  }
  const sent = await dm(guild, user.id, codeDm(guild, { title: `${e(guild, 'check')} Odebrano ${days} ${plural(days)} Hammer+`, lead: granted.days > days ? 'Oto Twój kod do **Hammer Launchera** – razem z czasem, który konto już miało:' : 'Oto Twój kod do **Hammer Launchera**:', ...granted }));
  await require('./plusrole').sync(guild, user.id, now).catch(() => null);
  await sendLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '🎁 Zaproś znajomego – odebrane dni', guild.client.user).addFields(
        { name: 'Kto', value: `<@${user.id}>`, inline: true },
        { name: 'Konto Minecraft', value: `\`${granted.record.nick}\``, inline: true },
        { name: 'Ważny', value: hp().validity(granted.record.exp), inline: true },
        { name: 'Kod na DM', value: sent ? 'wysłany' : 'nie doszedł – widać go na stronie', inline: true },
      ),
    ],
  }).catch(() => null);
  return { code: granted.code, nick: granted.record.nick, until: granted.record.exp ? granted.record.exp * 1000 : 0, days, total: granted.days };
}

module.exports = { onPurchase, claim, accountOf, REWARD_DAYS };
