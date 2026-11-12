'use strict';

const { ButtonStyle, MessageFlags } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { isSafeSelfRole } = require('../lib/guards');
const { embed, count } = require('../lib/utils');
const { container, text, divider, btn, row, v2 } = require('../lib/v2');
const profile = require('../lib/profile');

/** Notification roles members can toggle in #roles (button id: sr:<key>). */
const SELF_ROLES = [
  { key: 'pingAnnouncements', label: 'Ogłoszenia', icon: 'bell', description: 'ważne nowości, aktualizacje i otwarcia' },
  { key: 'pingGiveaways', label: 'Giveawaye', icon: 'gift', description: 'każdy nowy giveaway' },
  // The third one is the server's own: the shop pings for restocks, the launcher's server for new versions.
  profile.launcher ? { key: 'pingUpdates', label: 'Aktualizacje', icon: 'rocket', description: 'każda nowa wersja launchera' } : { key: 'pingRestocks', label: 'Dostawy', icon: 'box', description: 'nowe produkty i dostawy' },
];

/** Who-is-who card + the notification role buttons (posted in #roles). */
function rolesPanels(guild) {
  const r = (key) => (db.roleId(guild.id, key) ? `<@&${db.roleId(guild.id, key)}>` : null);
  const line = (key, desc) => (r(key) ? `> ${r(key)} – ${desc}` : null);
  const lines = (list) => list.map(([k, d]) => line(k, d)).filter(Boolean).join('\n');

  const guide = container(COLORS.brand);
  guide.addTextDisplayComponents(text(`# ${e(guild, 'crown')} Role na serwerze\nKto jest kim na **${config.brand.name}** i jak zdobyć każdą rolę.`));
  guide.addSeparatorComponents(divider());
  guide.addTextDisplayComponents(
    text(
      `### ${e(guild, 'shield')} Zespół\n` +
        lines([
          ['brand', profile.launcher ? `sam bot ${config.brand.name} – przez niego działają tickety, weryfikacja i ogłoszenia nowych wersji` : `sam bot ${config.brand.name} – przez niego działają sklep, tickety i zamówienia`],
          ['founder', `właściciel ${config.brand.name}`],
          ['coowner', profile.launcher ? 'prowadzi projekt razem z CEO' : 'prowadzi sklep razem z CEO'],
          ['developer', 'tworzy launcher i Hammer Client'],
          ['manager', profile.launcher ? 'zarządza zespołem i serwerem' : 'zarządza zespołem i sklepem'],
          ['admin', 'administracja serwera'],
          ['moderator', 'dba o bezpieczeństwo czatu i obsługuje zgłoszenia'],
          ['support', 'odpowiada na tickety i pytania'],
          ['seller', 'obsługuje zamówienia i dostawy'],
        ]),
    ),
  );
  guide.addTextDisplayComponents(
    text(
      `### ${e(guild, 'diamond')} Specjalne\n` +
        lines([
          ['loyal', `nadawana automatycznie po ${count(config.shop.loyalAfterOrders || 5, 'zrealizowanym zamówieniu', 'zrealizowanych zamówieniach', 'zrealizowanych zamówieniach')}`],
          ['customer', 'nadawana automatycznie po pierwszym zrealizowanym zamówieniu'],
          ['tester', 'testuje nowe wersje przed wydaniem – nadaje ją zespół'],
          ['member', 'każdy po weryfikacji'],
        ]),
    ),
  );

  const pings = container(COLORS.brand);
  pings.addTextDisplayComponents(
    text(
      `# ${e(guild, 'bell')} Powiadomienia\nWybierz, o czym chcesz dostawać pingi. Kliknij jeszcze raz, żeby zdjąć rolę.\n` +
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
  if (!role) return say(COLORS.danger, '❌ Ta rola już nie istnieje. Daj znać zespołowi.');
  if (!isSafeSelfRole(role)) return say(COLORS.danger, '❌ Nie mogę nadać tej roli. Daj znać zespołowi.');
  if (interaction.member.roles.cache.has(role.id)) {
    await interaction.member.roles.remove(role, 'Usunięto rolę z powiadomieniami');
    return say(COLORS.muted, `🔕 Zdjęto rolę ${role} – pingi **${def.label}** wyłączone.`);
  }
  await interaction.member.roles.add(role, 'Dodano rolę z powiadomieniami');
  return say(COLORS.success, `🔔 Dodano rolę ${role} – będziesz dostawać pingi: **${def.description}**.`);
}

module.exports = { SELF_ROLES, rolesPanels, handleButton };
