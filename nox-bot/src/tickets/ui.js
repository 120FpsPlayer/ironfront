'use strict';

const {
  ButtonBuilder,
  ButtonStyle,
  SectionBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { PRIORITIES, pad, ts, duration, workingStatus, avgResponseTime } = require('../lib/utils');
const { SPACER, text, divider, btn, linkBtn, row, section, container, header, v2, notice } = require('../lib/v2');

/** Custom NØX emoji for a ticket type (falls back to the Unicode emoji from config.json). */
const typeEmoji = (guild, type) => (type?.icon && guild ? ce(guild, type.icon) : type?.emoji ?? '🎫');
const typeText = (guild, type) => (type?.icon && guild ? e(guild, type.icon) : type?.emoji ?? '🎫');

function panelPayload(guild, style = 'buttons') {
  const p = config.panel;
  const types = config.ticketTypes;
  const useSections = style !== 'select' && types.length <= 8;

  const c = container(COLORS.brand);
  const head = `# ${e(guild, 'ticket')} ${p.title}\n${p.description}`;
  header(c, head, config.brand.logo ?? guild.iconURL?.({ size: 256 }));

  if (p.rules.length) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`**${e(guild, 'pin')} Before you open a ticket**\n${p.rules.map((r) => `> ${r}`).join('\n')}`));
  }
  c.addSeparatorComponents(divider(true));

  if (useSections) {
    for (const t of types) {
      c.addSectionComponents(
        new SectionBuilder()
          .addTextDisplayComponents(text(`### ${typeText(guild, t)} ${t.label}\n-# ${t.description ?? '​'}`))
          .setButtonAccessory(
            new ButtonBuilder()
              .setCustomId(`ticket:open:${t.id}`)
              .setLabel(p.buttonLabel ?? 'Open')
              .setEmoji(typeEmoji(guild, t))
              .setStyle(t.id === 'order' ? ButtonStyle.Primary : ButtonStyle.Secondary),
          ),
      );
    }
  } else {
    c.addTextDisplayComponents(text(`**${e(guild, 'folder')} Choose a category from the list below:**`));
    c.addActionRowComponents(
      row(
        new StringSelectMenuBuilder()
          .setCustomId('ticket:open')
          .setPlaceholder('Choose a ticket category…')
          .addOptions(types.map((t) => ({ label: t.label, value: t.id, description: t.description?.slice(0, 100), emoji: typeEmoji(guild, t) }))),
      ),
    );
  }

  const footer = [];
  const status = workingStatus();
  if (status.text) footer.push(status.text);
  if (p.showStats !== false) {
    const avg = avgResponseTime(guild.id);
    const open = db.tickets((t) => t.guildId === guild.id && t.status === 'open').length;
    footer.push(`⏱️ Average response time: **${avg ? `~${duration(avg)}` : 'no data yet'}**${SPACER}📨 Open tickets: **${open}**`);
  }
  if (footer.length) {
    c.addSeparatorComponents(divider(true));
    c.addTextDisplayComponents(text(footer.map((l) => `-# ${l}`).join('\n')));
  }
  return v2(c);
}

function statusLine(ticket) {
  const p = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
  const status = ticket.status === 'open' ? '🟢 Open' : '🔴 Closed';
  const claim = ticket.claimedBy ? `<@${ticket.claimedBy}>` : '*waiting to be claimed*';
  return (
    `**Status:** ${status}${SPACER}**Priority:** ${p.emoji} ${p.label}\n` +
    `**Handled by:** ${claim}${SPACER}**Created:** ${ts(ticket.createdAt, 'R')}` +
    (ticket.completedAt ? `\n**Order:** ✅ completed ${ts(ticket.completedAt, 'R')}` : '')
  );
}

function ticketCard(ticket, type, { guild, ownerUser, ownerMember, pingRoles = [], previousCount = 0 } = {}) {
  const p = PRIORITIES[ticket.priority] ?? PRIORITIES.normal;
  const c = container(p.color);

  const status = workingStatus(new Date(ticket.createdAt));
  const intro =
    `## ${typeText(guild, type)} ${type?.label ?? 'Ticket'}${SPACER}\`#${pad(ticket.number)}\`\n` +
    `Hi <@${ticket.ownerId}>! 👋 Thanks for reaching out to **${config.brand.name}**.\n` +
    (type?.id === 'order'
      ? 'A seller will confirm your order, the final price and payment details right here. **Never pay anyone in DMs.**'
      : 'Please describe your request in as much detail as possible and attach screenshots if you can – our team will reply shortly.') +
    (status.open ? '' : `\n-# ${status.text}`);
  c.addSectionComponents(section(intro, ownerUser?.displayAvatarURL?.({ size: 128 })));

  if (ticket.answers?.length) {
    c.addSeparatorComponents(divider());
    const budget = Math.floor(2200 / ticket.answers.length);
    const answers = ticket.answers
      .map((a) => {
        const value = (a.value || '*no answer*').slice(0, budget) + ((a.value?.length ?? 0) > budget ? '…' : '');
        return `**${a.label}**\n${value.split('\n').map((l) => `> ${l}`).join('\n')}`;
      })
      .join('\n');
    c.addTextDisplayComponents(text(`### 📝 Form\n${answers}`));
  }

  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(statusLine(ticket)));

  if (ticket.participants?.length) {
    c.addTextDisplayComponents(text(`**Added members:** ${ticket.participants.map((id) => `<@${id}>`).join(', ')}`));
  }

  const meta = [];
  if (ownerUser?.createdAt) meta.push(`👤 Account created ${ts(ownerUser.createdAt, 'D')}`);
  if (ownerMember?.joinedAt) meta.push(`📥 Joined ${ts(ownerMember.joinedAt, 'D')}`);
  meta.push(`🗂️ Previous tickets: ${previousCount}`);
  c.addTextDisplayComponents(text(`-# ${meta.join(' · ')}`));

  if (ticket.status === 'open') {
    c.addSeparatorComponents(divider());
    c.addActionRowComponents(
      row(
        btn('ticket:close', 'Close', '🔒', ButtonStyle.Danger),
        ticket.claimedBy ? btn('ticket:unclaim', 'Unclaim', '↩️') : btn('ticket:claim', 'Claim', '🙋', ButtonStyle.Success),
        btn('ticket:ping', 'Call support', '🔔'),
        btn('ticket:transcript', 'Transcript', '📄'),
      ),
    );
    c.addActionRowComponents(row(manageSelect(ticket, guild)));
    c.addActionRowComponents(
      row(new UserSelectMenuBuilder().setCustomId('ticket:adduser').setPlaceholder('➕ Add someone to the ticket (staff)').setMinValues(1).setMaxValues(5)),
    );
  }

  if (pingRoles.length) c.addTextDisplayComponents(text(`-# 🔔 ${pingRoles.map((id) => `<@&${id}>`).join(' ')}`));

  return v2(c, { mentions: { users: [ticket.ownerId], roles: pingRoles } });
}

function manageSelect(ticket, guild) {
  const options = [];
  if (ticket.typeId === 'order' && !ticket.completedAt) {
    options.push({
      label: 'Order completed',
      value: 'complete',
      emoji: guild ? ce(guild, 'check') : '✅',
      description: 'Gives the Customer role and asks for a vouch',
    });
  }
  for (const [value, p] of Object.entries(PRIORITIES)) {
    if (value === ticket.priority) continue;
    options.push({ label: `Priority: ${p.label}`, value: `prio:${value}`, emoji: p.emoji, description: 'Change the ticket priority' });
  }
  options.push({ label: 'Ask the author to close', value: 'closereq', emoji: '📨', description: 'The author confirms the issue is resolved' });
  for (const t of config.ticketTypes) {
    if (t.id === ticket.typeId || options.length >= 25) continue;
    options.push({ label: `Move to: ${t.label}`.slice(0, 100), value: `move:${t.id}`, emoji: typeEmoji(guild, t), description: 'Change the ticket category' });
  }
  return new StringSelectMenuBuilder().setCustomId('ticket:manage').setPlaceholder('⚙️ Manage ticket (staff)').addOptions(options);
}

function closedCard(ticket, actorId, { messageCount, transcriptUrl } = {}) {
  const c = container(COLORS.danger);
  c.addTextDisplayComponents(
    text(
      '## 🔒 Ticket closed\n' +
        `Closed by <@${actorId}> ${ts(ticket.closedAt ?? Date.now(), 'R')}` +
        (ticket.closeReason ? `\n**Reason:** ${ticket.closeReason}` : ''),
    ),
  );
  c.addSeparatorComponents(divider());
  const lines = [
    `⏱️ **Duration:** ${duration((ticket.closedAt ?? Date.now()) - ticket.createdAt)}`,
    `⚡ **First response:** ${ticket.firstResponseAt ? `after ${duration(ticket.firstResponseAt - ticket.createdAt)}` : '—'}`,
    `🙋 **Handled by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—'}`,
  ];
  if (messageCount != null) lines.push(`💬 **Messages:** ${messageCount}`);
  c.addTextDisplayComponents(text(lines.join('\n')));
  c.addSeparatorComponents(divider());
  const buttons = [
    btn('ticket:reopen', 'Reopen', '🔓', ButtonStyle.Success),
    btn('ticket:transcript', 'Transcript', '📄'),
    btn('ticket:delete', 'Delete ticket', '🗑️', ButtonStyle.Danger),
  ];
  if (transcriptUrl) buttons.push(linkBtn(transcriptUrl, 'Download', '⬇️'));
  c.addActionRowComponents(row(...buttons));
  return v2(c);
}

function closeRequestCard(ticket, staffId, state = 'pending') {
  const c = container(state === 'pending' ? COLORS.warning : state === 'accepted' ? COLORS.success : COLORS.danger);
  if (state === 'pending') {
    c.addTextDisplayComponents(
      text(
        `## 📨 Can we close this ticket?\n<@${ticket.ownerId}>, <@${staffId}> believes your request has been handled.\n` +
          'If everything is fine – click **Yes, close it**. If you still need help – just let us know!',
      ),
    );
    c.addActionRowComponents(
      row(btn('ticket:closereq_yes', 'Yes, close it', '✅', ButtonStyle.Success), btn('ticket:closereq_no', 'No, I still need help', '✋')),
    );
  } else if (state === 'accepted') {
    c.addTextDisplayComponents(text('✅ **The author confirmed everything is sorted** – the ticket is being closed.'));
  } else {
    c.addTextDisplayComponents(text(`✋ **<@${ticket.ownerId}> still needs help** – the ticket stays open.`));
  }
  return v2(c, { mentions: { users: state === 'pending' ? [ticket.ownerId] : [] } });
}

function inactivityWarning(ticket, closeAt) {
  const c = container(COLORS.warning);
  c.addTextDisplayComponents(
    text(
      `## ⏰ Do you still need help?\n<@${ticket.ownerId}>, we haven't heard back from you in a while.\n` +
        `This ticket will be **closed automatically ${ts(closeAt, 'R')}** unless you reply or click the button below.`,
    ),
  );
  c.addActionRowComponents(row(btn('ticket:still', 'I still need help', '✋', ButtonStyle.Primary)));
  return v2(c, { mentions: { users: [ticket.ownerId] } });
}

/** Shown in the ticket after staff marks an order as completed. */
function orderCompletedCard(guild, ticket, staffId, { loyal = false, orders = 1 } = {}) {
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(
      `## ${e(guild, 'check')} Order completed!\n` +
        `Thank you for shopping at **${config.brand.name}**, <@${ticket.ownerId}> 💜\n` +
        `You now have the **Customer** role${loyal ? ' and – with ' + orders + ' orders – the **Loyal Customer** role. You\'re one of the family!' : '.'}\n\n` +
        `${e(guild, 'star')} **Happy with your order?** A quick vouch helps us a lot – click the button below.`,
    ),
  );
  c.addTextDisplayComponents(text(`-# Delivered by <@${staffId}> · ${ts(Date.now(), 'f')}`));
  c.addActionRowComponents(row(btn('vouch:open', 'Leave a vouch', ce(guild, 'star'), ButtonStyle.Success)));
  return v2(c, { mentions: { users: [ticket.ownerId] } });
}

module.exports = {
  typeEmoji,
  typeText,
  panelPayload,
  ticketCard,
  closedCard,
  closeRequestCard,
  inactivityWarning,
  orderCompletedCard,
  notice,
};
