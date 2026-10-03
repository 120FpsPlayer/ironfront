'use strict';

const { ButtonStyle } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { ts } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, header, v2, channelUrl } = require('../lib/v2');
const { verifyPanel } = require('../features/verification');
const { rolesPanels } = require('../features/selfroles');

/**
 * Everything /build posts into the channels. Each "post" key returns a list of messages:
 *   { banner: 'shop' }            → the banner image
 *   { panel: 'shop' }             → a live panel the bot keeps up to date
 *   { payload }                   → a normal Components V2 card
 */

function context(guild) {
  const ch = (key, fallback = `#${key}`) => (db.channelId(guild.id, key) ? `<#${db.channelId(guild.id, key)}>` : fallback);
  const role = (key, fallback) => (db.roleId(guild.id, key) ? `<@&${db.roleId(guild.id, key)}>` : fallback ?? key);
  const url = (key) => (db.channelId(guild.id, key) ? channelUrl(guild.id, db.channelId(guild.id, key)) : null);
  const link = (key, label, icon) => (url(key) ? linkBtn(url(key), label, ce(guild, icon)) : null);
  const icon = guild.iconURL?.({ size: 256 }) ?? null;
  return { guild, ch, role, url, link, icon, E: (name) => e(guild, name), brand: config.brand.name };
}

const card = (c) => ({ payload: v2(c) });
const buttons = (...list) => row(...list.filter(Boolean));

// ───────────── WELCOME category ─────────────

function rulesCard(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('shield')} ${x.brand} — Server Rules\nBy staying on this server you agree to the rules below and to Discord's ` +
      '[Terms of Service](https://discord.com/terms) and [Community Guidelines](https://discord.com/guidelines).',
    x.icon,
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${x.E('heart')} 1 · Respect & behaviour\n` +
        '> **1.1** Be respectful – no harassment, hate speech, discrimination or threats.\n' +
        '> **1.2** No spam, flooding, excessive caps or mass-pinging.\n' +
        '> **1.3** Keep public channels in English so everyone can follow.\n' +
        '> **1.4** No NSFW, gore or otherwise disturbing content – anywhere.\n' +
        '> **1.5** No advertising or self-promotion, including in DMs to our members.\n' +
        '> **1.6** No impersonating staff, partners or other members.',
    ),
  );
  c.addTextDisplayComponents(
    text(
      `### ${x.E('cart')} 2 · Shop & payments\n` +
        `> **2.1** Every purchase happens **only inside a ticket** (${x.ch('tickets')}) – never in DMs.\n` +
        '> **2.2** Staff will **never DM you first** asking for payment. Anyone who does is a scammer – report them.\n' +
        '> **2.3** Read the product description before buying. Payments are final once delivery has started.\n' +
        '> **2.4** Chargebacks, payment disputes or fraud attempts = permanent ban and blacklist.\n' +
        '> **2.5** Report problems with an order within **48 hours** through a ticket.\n' +
        '> **2.6** Reselling or sharing purchased products without permission is not allowed.',
    ),
  );
  c.addTextDisplayComponents(
    text(
      `### ${x.E('ticket')} 3 · Tickets & support\n` +
        '> **3.1** One issue = one ticket. Explain clearly and add screenshots.\n' +
        "> **3.2** Don't ping staff – they're notified automatically.\n" +
        '> **3.3** Tickets without a reply are closed automatically.\n' +
        '> **3.4** Abusing tickets (trolling, spam) gets you blocked from them.',
    ),
  );
  c.addTextDisplayComponents(
    text(
      `### ${x.E('warning')} 4 · Punishments\n` +
        '> Breaking the rules leads to a warning, timeout, kick or ban depending on how serious it is. ' +
        `Staff decisions are final – you can appeal through a **Punishment Appeal** ticket.`,
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`-# Last updated ${ts(Date.now(), 'D')} · The team may update these rules at any time.`));
  return card(c);
}

function welcomeIntro(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('moon')} Welcome to ${x.brand}\n${config.brand.tagline ?? ''}\n\n` +
      `New here? Verify in ${x.ch('verify')}, read ${x.ch('rules')} and check out ${x.ch('shop')}. ` +
      'Every new member is greeted right here. 💜',
    x.icon,
  );
  c.addActionRowComponents(buttons(x.link('shop', 'Shop', 'cart'), x.link('tickets', 'Support', 'ticket'), x.link('vouches', 'Vouches', 'star')));
  return card(c);
}

function informationPosts(x, build) {
  const about = container(COLORS.brand);
  header(about, `# ${x.E('nox')} About ${x.brand}\n${config.brand.about ?? ''}`, x.icon);
  about.addSeparatorComponents(divider());
  about.addTextDisplayComponents(
    text(
      `### ${x.E('sparkles')} Why ${x.brand}?\n` +
        `> ${x.E('rocket')} **Fast delivery** – ${config.shop.deliveryTime ?? 'most orders are delivered quickly'}\n` +
        `> ${x.E('lock_locked')} **Safe payments** – only inside private tickets, never in DMs\n` +
        `> ${x.E('star')} **Trusted** – real reviews from real customers in ${x.ch('vouches')}\n` +
        `> ${x.E('chat')} **Real support** – ${config.shop.supportHours ?? 'a team that actually answers'}`,
    ),
  );
  const aboutButtons = [x.link('shop', 'Shop', 'cart'), x.link('vouches', 'Vouches', 'star')];
  if (build?.invite) aboutButtons.push(linkBtn(build.invite, 'Invite friends', ce(x.guild, 'share')));
  about.addActionRowComponents(buttons(...aboutButtons));

  const guide = container(COLORS.brand);
  guide.addTextDisplayComponents(text(`# ${x.E('hash')} Channel guide\nWhere to find everything on **${x.brand}**.`));
  guide.addSeparatorComponents(divider());
  guide.addTextDisplayComponents(
    text(
      `### ${x.E('home')} Start here\n` +
        `> ${x.ch('rules')} – the rules\n> ${x.ch('announcements')} – official news\n> ${x.ch('giveaways')} – free stuff\n` +
        `> ${x.ch('roles')} – roles & notifications\n> ${x.ch('partners')} – our partners\n` +
        `### ${x.E('cart')} Shop\n` +
        `> ${x.ch('shop')} – all products\n> ${x.ch('howToBuy')} – how ordering works\n> ${x.ch('payments')} – payment methods\n` +
        `> ${x.ch('restocks')} – new products & restocks\n> ${x.ch('vouches')} – customer reviews\n` +
        `### ${x.E('ticket')} Support\n` +
        `> ${x.ch('tickets')} – open a ticket\n> ${x.ch('faq')} – quick answers\n` +
        `### ${x.E('chat')} Community\n` +
        `> ${x.ch('chat')} · ${x.ch('media')} · ${x.ch('memes')} · ${x.ch('commands')} · ${x.ch('leaderboard')}`,
    ),
  );

  const team = container(COLORS.brand);
  team.addTextDisplayComponents(
    text(
      `# ${x.E('shield')} Our team\nThe people keeping **${x.brand}** running.\n` +
        `> ${x.role('founder')} · ${x.role('coowner')}\n> ${x.role('manager')} · ${x.role('admin')}\n` +
        `> ${x.role('moderator')} · ${x.role('support')} · ${x.role('trialSupport')}\n> ${x.role('seller')} – handles your orders`,
    ),
  );
  team.addSeparatorComponents(divider());
  team.addTextDisplayComponents(text(`-# ${x.E('warning')} Our team will **never** DM you first or ask for payment outside a ticket. Not sure if someone is staff? Check their roles.`));

  const contact = container(COLORS.brand);
  contact.addTextDisplayComponents(
    text(
      `# ${x.E('mail')} Contact\nThe fastest way to reach us is a ticket in ${x.ch('tickets')} – a private channel with our team.\n` +
        `> ${x.E('cart')} **Buying something?** → Purchase ticket\n> ${x.E('question')} **Need help?** → Support ticket\n` +
        `> ${x.E('group')} **Business or partnership?** → Partnership ticket\n` +
        `-# ${config.shop.supportHours ? `Support hours: ${config.shop.supportHours}` : ''}`,
    ),
  );
  contact.addActionRowComponents(buttons(btn('ticket:open:support', 'Contact support', ce(x.guild, 'mail'), ButtonStyle.Primary), x.link('tickets', 'All ticket types', 'ticket')));

  const hiring = container(COLORS.brand);
  hiring.addTextDisplayComponents(
    text(
      `# ${x.E('person')} Join the team\nWe're always looking for friendly, active people to help our customers.\n` +
        '> ✅ 16+ and good English\n> ✅ A few hours per week\n> ✅ Patient, honest and helpful\n' +
        '-# Apply with the button below – we read every application.',
    ),
  );
  hiring.addActionRowComponents(row(btn('ticket:open:apply', 'Apply now', ce(x.guild, 'pencil'), ButtonStyle.Success)));

  return [
    { banner: 'discord' }, card(about),
    { banner: 'channels' }, card(guide),
    { banner: 'staff' }, card(team),
    { banner: 'contact' }, card(contact),
    { banner: 'join-us' }, card(hiring),
  ];
}

function announcementsIntro(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('sparkles')} ${x.brand} is open!\nWelcome to our brand-new home. 💜\n\n` +
      `> ${x.E('cart')} Browse the catalog in ${x.ch('shop')}\n> ${x.E('gift')} Giveaways run in ${x.ch('giveaways')}\n` +
      `> ${x.E('bell')} Grab notification roles in ${x.ch('roles')} so you never miss a drop`,
    x.icon,
  );
  c.addTextDisplayComponents(text(`-# ${x.brand} team · ${ts(Date.now(), 'D')}`));
  return card(c);
}

function giveawaysIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('gift')} Giveaways\nWe regularly give away products and goodies here.\n` +
        '> 🎉 Click **Enter** on a giveaway to join\n> 🏆 Winners are drawn automatically when the timer ends\n' +
        '> 🎁 Winners claim their prize with a **Claim a Reward** ticket within 48 hours\n' +
        `-# Want a ping for every giveaway? Grab the ${x.role('pingGiveaways', 'Giveaways')} role in ${x.ch('roles')}.`,
    ),
  );
  return card(c);
}

function partnersIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('group')} Partners\nServers and brands we work with. Want to join them?\n` +
        `### ${x.E('check')} Requirements\n> Active community (100+ members)\n> No NSFW, scams or illegal content\n> You post our ad in return\n` +
        '-# Partners get the Partner role and access to the VIP lounge.',
    ),
  );
  c.addActionRowComponents(row(btn('ticket:open:partnership', 'Become a partner', ce(x.guild, 'group'), ButtonStyle.Primary)));
  return card(c);
}

// ───────────── SHOP category ─────────────

function howToBuy(x) {
  const c = container(COLORS.brand);
  header(c, `# ${x.E('box')} How to buy\nOrdering takes about a minute. Here's how it works:`, x.icon);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `> **1.** Browse the products in ${x.ch('shop')} and click **Buy** – or open a **Purchase** ticket in ${x.ch('tickets')}\n` +
        '> **2.** Fill in the short form (quantity + payment method)\n' +
        `> **3.** A private ticket opens – a ${x.role('seller', 'Seller')} confirms the price and sends payment details\n` +
        '> **4.** Pay and receive your product right in the ticket\n' +
        `> **5.** Enjoy – and leave a vouch in ${x.ch('vouches')} ${x.E('star')}`,
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `${x.E('clock')} **Delivery:** ${config.shop.deliveryTime ?? '—'}\n` +
        `${x.E('chat')} **Support:** ${config.shop.supportHours ?? '—'}\n` +
        `${x.E('info')} **Refunds:** ${config.shop.refundPolicy ?? 'See the rules.'}`,
    ),
  );
  c.addActionRowComponents(buttons(btn('ticket:open:order', 'Place an order', ce(x.guild, 'cart'), ButtonStyle.Primary), x.link('shop', 'Shop', 'basket'), x.link('payments', 'Payments', 'card')));
  return card(c);
}

function payments(x) {
  const c = container(COLORS.brand);
  header(c, `# ${x.E('card')} Payment methods\nPay the way you like – all payments are handled inside your private ticket.`, x.icon);
  c.addSeparatorComponents(divider());
  const methods = config.shop.paymentMethods;
  c.addTextDisplayComponents(
    text(methods.length ? methods.map((m) => `### ${x.E(m.emoji ?? 'wallet')} ${m.name}\n-# ${m.details ?? ''}`).join('\n') : 'Payment methods will be listed here soon.'),
  );
  c.addSeparatorComponents(divider());
  const has = (re) => methods.some((m) => re.test(`${m.name} ${m.emoji ?? ''}`));
  const tips = ['> Only pay to the details a seller gives you **inside your ticket** – never in DMs. We never ask for passwords.'];
  if (has(/crypto|btc|eth|bitcoin|ethereum/i)) tips.push("> **Crypto:** send the exact amount on the right network and double-check the address – crypto payments can't be reversed.");
  if (has(/paysafe/i)) tips.push('> **PaysafeCard:** only share your PIN inside your ticket – a seller confirms it before delivery.');
  if (has(/paypal/i)) tips.push('> **PayPal:** only pay to the PayPal address a seller gives you in your ticket.');
  tips.push('> Fraud attempts or payment disputes result in a permanent ban.');
  c.addTextDisplayComponents(text(`${x.E('warning')} **Stay safe**\n${tips.join('\n')}`));
  c.addActionRowComponents(buttons(btn('ticket:open:order', 'Place an order', ce(x.guild, 'cart'), ButtonStyle.Primary), x.link('howToBuy', 'How to buy', 'info')));
  return card(c);
}

function restocksIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('sparkles')} Restocks & new products\nEvery new product and every restock is announced here first.\n` +
        `-# Get pinged: grab the ${x.role('pingRestocks', 'Restocks')} role in ${x.ch('roles')}.`,
    ),
  );
  return card(c);
}

function proofsIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('check')} Order proofs\nEvery order we deliver is posted here automatically – real orders, in real time.\n` +
        `-# No names or personal details are shown. Want to read what customers say? Check ${x.ch('vouches')}.`,
    ),
  );
  c.addActionRowComponents(buttons(x.link('shop', 'Shop', 'cart'), x.link('vouches', 'Vouches', 'star')));
  return card(c);
}

// ───────────── SUPPORT category ─────────────

function faq(x) {
  const qa = [
    ['How do I buy something?', `Click **Buy** on a product in ${x.ch('shop')} or open a **Purchase** ticket in ${x.ch('tickets')}. Full guide: ${x.ch('howToBuy')}.`],
    ['Which payment methods do you accept?', `${config.shop.paymentMethods.map((m) => m.name).join(', ') || 'See'} – details in ${x.ch('payments')}.`],
    ['How fast is delivery?', `${config.shop.deliveryTime ?? 'Usually very fast'}. You receive everything inside your ticket.`],
    ['Is it safe to buy here?', `Yes – payments only happen in private tickets with our team, and you can read real reviews in ${x.ch('vouches')}. We never DM you first.`],
    ["I didn't get my order / something is wrong", `Open a **Support** ticket in ${x.ch('tickets')} within 48 hours and include your order details.`],
    ['Can I get a refund?', config.shop.refundPolicy ?? 'Open a support ticket and we will look at your case.'],
    ['How do I win giveaways?', `Click **Enter** on giveaways in ${x.ch('giveaways')} and turn on the giveaway ping in ${x.ch('roles')}.`],
    ['Can I partner with you or join the team?', `Sure – open a **Partnership** or **Staff Application** ticket in ${x.ch('tickets')}.`],
  ];
  const c = container(COLORS.brand);
  header(c, `# ${x.E('question')} Frequently asked questions\nCan't find your answer? Open a ticket in ${x.ch('tickets')}.`, x.icon);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(qa.map(([q, a]) => `**${x.E('arrow_right')} ${q}**\n> ${a}`).join('\n\n')));
  return card(c);
}

// ───────────── COMMUNITY & VIP ─────────────

function simple(x, title, body) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(text(`# ${title}\n${body}`));
  return card(c);
}

function commandsCard(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('gear')} Bot commands\nUse commands in this channel to keep the chat clean.\n` +
        `### ${x.E('person')} Everyone\n` +
        '> `/vouch` – leave a review after a purchase\n> `/help` – all commands you can use\n' +
        '> `/ticket info` · `/ticket close` – inside your ticket\n' +
        `### ${x.E('shield')} Staff\n` +
        '> `/ticket` · `/reply` · `/stats` · `/blacklist` – tickets\n> `/product` – manage the shop catalog\n' +
        '> `/giveaway` – run giveaways · `/announce` – post announcements',
    ),
  );
  return card(c);
}

function boostersCard(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('rocket')} Server Boosters\nBoosting ${x.brand} unlocks a better server for everyone – thank you! 💜\n` +
        `### ${x.E('gift')} Booster perks\n> ${x.E('diamond')} Access to the VIP lounge ${x.ch('vipChat')}\n` +
        '> 🚀 A special role at the top of the member list\n> 💜 Our eternal gratitude\n' +
        '-# Boost announcements appear in this channel.',
    ),
  );
  return card(c);
}

function vipCard(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('diamond')} VIP Lounge\nWelcome to the inner circle. This space is for ${x.role('vip', 'VIPs')}, ${x.role('partner', 'partners')}, ` +
        `${x.role('loyal', 'loyal customers')} and boosters.\n> ${x.E('sparkles')} Early access to drops and restocks\n` +
        '> 🏷️ Exclusive deals – watch this channel\n> 💬 A calmer place to hang out',
    ),
  );
  return card(c);
}

function staffHandbook(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('shield')} Staff handbook\nEverything you need to run **${x.brand}**.\n` +
        `### ${x.E('ticket')} Tickets\n> Claim a ticket before you answer · use \`/reply\` for canned replies\n` +
        '> In a **Purchase** ticket choose **Order completed** in the ⚙️ menu after delivery – the customer gets the Customer role and a vouch request\n' +
        `> Transcripts land in ${x.ch('transcripts')}, every action in ${x.ch('ticketLogs')}\n` +
        `### ${x.E('cart')} Shop\n> \`/product add\` · \`/product edit\` · \`/product stock\` · \`/product remove\` – the ${x.ch('shop')} panel updates by itself\n` +
        `> New products and restocks are announced in ${x.ch('restocks')} automatically\n` +
        `### ${x.E('gift')} Community\n> \`/giveaway start\` · \`/giveaway end\` · \`/giveaway reroll\`\n> \`/announce\` – a styled announcement with an optional banner and ping\n` +
        `### ${x.E('refresh')} Changing the texts\n> Edit \`config.json\` (texts, payments), restart the bot and run \`/build only:panels\` – every card updates in place · new name style → \`/build only:names\`\n` +
        `### ${x.E('warning')} Golden rules\n> Never ask for payment outside a ticket · stay polite · when unsure, ask a ${x.role('manager', 'Manager')}`,
    ),
  );
  return card(c);
}

/** All messages for one "post" key. */
function postsFor(key, guild) {
  const x = context(guild);
  const build = db.build(guild.id);
  switch (key) {
    case 'verify':
      return [{ banner: 'verification' }, { payload: verifyPanel(guild) }];
    case 'rules':
      return [{ banner: 'rules' }, rulesCard(x)];
    case 'welcome':
      return [{ banner: 'welcome' }, welcomeIntro(x)];
    case 'information':
      return informationPosts(x, build);
    case 'announcements':
      return [{ banner: 'announcements' }, announcementsIntro(x)];
    case 'giveaways':
      return [{ banner: 'giveaways' }, giveawaysIntro(x)];
    case 'roles':
      return [{ banner: 'roles' }, ...rolesPanels(guild).map((payload) => ({ payload }))];
    case 'partners':
      return [{ banner: 'partners' }, partnersIntro(x)];
    case 'shop':
      return [{ banner: 'shop' }, { panel: 'shop' }];
    case 'howToBuy':
      return [{ banner: 'how-to-buy' }, howToBuy(x)];
    case 'payments':
      return [{ banner: 'payments' }, payments(x)];
    case 'restocks':
      return [{ banner: 'restocks' }, restocksIntro(x)];
    case 'vouches':
      return [{ banner: 'vouches' }, { panel: 'vouches' }];
    case 'proofs':
      return [{ banner: 'proofs' }, proofsIntro(x)];
    case 'tickets':
      return [{ banner: 'support' }, { panel: 'tickets', extra: { style: 'buttons' } }];
    case 'faq':
      return [{ banner: 'faq' }, faq(x)];
    case 'media':
      return [{ banner: 'media' }, simple(x, `${x.E('camera')} Media`, 'Share screenshots, clips and pictures.\n-# Keep it SFW · no ads · credit creators.')];
    case 'memes':
      return [{ banner: 'memes' }, simple(x, '😂 Memes', 'Post your best memes here.\n-# Keep it SFW and friendly – no hate, no NSFW.')];
    case 'commands':
      return [{ banner: 'bot-commands' }, commandsCard(x)];
    case 'leaderboard':
      return [{ banner: 'leaderboard' }, { panel: 'leaderboard' }];
    case 'boosters':
      return [{ banner: 'boosters' }, boostersCard(x)];
    case 'vip':
      return [{ banner: 'vip' }, vipCard(x)];
    case 'staff':
      return [{ banner: 'staff' }, staffHandbook(x)];
    default:
      return [];
  }
}

module.exports = { postsFor, context };
