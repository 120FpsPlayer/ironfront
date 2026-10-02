'use strict';

const { ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { isSafeSelfRole } = require('../lib/guards');
const { embed } = require('../lib/utils');
const { container, text, divider, btn, row, v2 } = require('../lib/v2');

/** Notification roles members can toggle in #roles (button id: sr:<key>). */
const SELF_ROLES = [
  { key: 'pingAnnouncements', label: 'Announcements', icon: 'bell', description: 'big news, updates and openings' },
  { key: 'pingGiveaways', label: 'Giveaways', icon: 'gift', description: 'every new giveaway' },
  { key: 'pingRestocks', label: 'Restocks', icon: 'box', description: 'new products and restocks' },
];

/** Who-is-who card + the notification role buttons (posted in #roles). */
function rolesPanels(guild) {
  const r = (key) => (db.roleId(guild.id, key) ? `<@&${db.roleId(guild.id, key)}>` : null);
  const line = (key, desc) => (r(key) ? `> ${r(key)} – ${desc}` : null);
  const lines = (list) => list.map(([k, d]) => line(k, d)).filter(Boolean).join('\n');

  const guide = container(COLORS.brand);
  guide.addTextDisplayComponents(text(`# ${e(guild, 'crown')} Server roles\nWho is who on **${config.brand.name}** and how to get each role.`));
  guide.addSeparatorComponents(divider());
  guide.addTextDisplayComponents(
    text(
      `### ${e(guild, 'shield')} Team\n` +
        lines([
          ['founder', 'owner of the server'],
          ['coowner', 'runs the server together with the founder'],
          ['manager', 'manages the team and the shop'],
          ['admin', 'server administration'],
          ['moderator', 'keeps chat safe and handles reports'],
          ['support', 'answers tickets and questions'],
          ['seller', 'handles orders and deliveries'],
        ]),
    ),
  );
  guide.addTextDisplayComponents(
    text(
      `### ${e(guild, 'diamond')} Special\n` +
        lines([
          ['vip', 'exclusive deals and the VIP lounge'],
          ['partner', 'official partner servers'],
          ['loyal', `given automatically after ${config.shop.loyalAfterOrders || 5} completed orders`],
          ['customer', 'given automatically after your first completed order'],
          ['member', 'everyone who passed verification'],
        ]) +
        '\n-# 🚀 Server Boosters also get access to the VIP lounge.',
    ),
  );

  const pings = container(COLORS.brand);
  pings.addTextDisplayComponents(
    text(
      `# ${e(guild, 'bell')} Notifications\nPick what you want to be pinged for. Click again to remove a role.\n` +
        SELF_ROLES.filter((s) => db.roleId(guild.id, s.key)).map((s) => `> ${e(guild, s.icon)} **${s.label}** – ${s.description}`).join('\n'),
    ),
  );
  const buttons = SELF_ROLES.filter((s) => db.roleId(guild.id, s.key)).map((s) => btn(`sr:${s.key}`, s.label, ce(guild, s.icon), ButtonStyle.Secondary));
  if (buttons.length) pings.addActionRowComponents(row(...buttons));
  return [v2(guide), v2(pings)];
}

async function handleButton(interaction) {
  const key = interaction.customId.split(':')[1];
  const def = SELF_ROLES.find((s) => s.key === key);
  const roleId = def ? db.roleId(interaction.guild.id, key) : null;
  const role = roleId ? interaction.guild.roles.cache.get(roleId) : null;
  const say = (color, msg) => interaction.reply({ embeds: [embed(color).setDescription(msg)], flags: MessageFlags.Ephemeral });
  if (!role) return say(COLORS.danger, '❌ This role no longer exists. Please tell the staff.');
  if (!isSafeSelfRole(role)) return say(COLORS.danger, '❌ I cannot give out this role. Please tell the staff.');
  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.member.roles.remove(role, 'Notification role removed');
    return say(COLORS.muted, `🔕 Removed ${role} – you won't be pinged for **${def.label.toLowerCase()}** anymore.`);
  }
  await interaction.member.roles.add(role, 'Notification role added');
  return say(COLORS.success, `🔔 Added ${role} – you'll be pinged for **${def.description}**.`);
}

module.exports = { SELF_ROLES, rolesPanels, handleButton };
