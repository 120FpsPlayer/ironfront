'use strict';

const crypto = require('node:crypto');
const { ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { isSafeSelfRole } = require('../lib/guards');
const { sendToChannel, ts, embed, count } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');
const { container, text, divider, btn, linkBtn, row, header, v2, channelUrl } = require('../lib/v2');

/**
 * Verification gate. New members only see #verify and #rules; clicking "Verify" (and solving
 * a quick math check) gives them the Member role, which unlocks the rest of the server.
 *
 * Button:  verify:start
 * Modal:   verify:answer:<a>:<b>:<signature>   (HMAC – nobody can swap in their own question)
 */

const SECRET = crypto.randomBytes(32);
const DAY = 86_400_000;

const sign = (...parts) => crypto.createHmac('sha256', SECRET).update(parts.join('|')).digest('base64url').slice(0, 12);

function memberRole(guild) {
  const id = db.roleId(guild.id, 'member') ?? db.guild(guild.id).settings.verifyRoleId;
  return id ? guild.roles.cache.get(id) ?? null : null;
}

/** The card posted in #verify by /build. */
function verifyPanel(guild) {
  const v = config.verification;
  const c = container(COLORS.brand);
  const rules = db.channelId(guild.id, 'rules');
  header(
    c,
    `# ${e(guild, 'shield')} Zweryfikuj swoje konto\n` +
      `Witamy w **${config.brand.name}**! Żeby chronić naszą społeczność przed botami, raiderami i oszustami, ` +
      'każdy członek weryfikuje się raz – zajmuje to około pięciu sekund.',
    guild.iconURL?.({ size: 256 }),
  );
  c.addSeparatorComponents(divider());
  const steps = [
    rules ? `Przeczytaj regulamin na <#${rules}>` : 'Przeczytaj regulamin serwera',
    'Kliknij **Zweryfikuj się** poniżej',
    v.captcha ? 'Odpowiedz na szybkie pytanie matematyczne – gotowe!' : 'Gotowe – cały serwer odblokuje się od razu!',
  ];
  c.addTextDisplayComponents(text(`### ${e(guild, 'info')} Jak to działa\n${steps.map((s, i) => `> **${i + 1}.** ${s}`).join('\n')}`));
  c.addSeparatorComponents(divider());
  const notes = ['Weryfikując się, akceptujesz nasz regulamin i Warunki korzystania z usługi Discorda.'];
  if (v.minAccountAgeDays > 0) notes.push(`Konta młodsze niż **${count(v.minAccountAgeDays, 'dzień', 'dni', 'dni')}** nie mogą się jeszcze zweryfikować.`);
  notes.push('Problem z weryfikacją? Zapytaj kogoś z zespołu.');
  c.addTextDisplayComponents(text(notes.map((n) => `-# ${n}`).join('\n')));
  c.addActionRowComponents(row(btn('verify:start', 'Zweryfikuj się', ce(guild, 'check'), ButtonStyle.Success)));
  return v2(c);
}

function reply(interaction, color, description) {
  return interaction.reply({ embeds: [embed(color).setDescription(description)], flags: MessageFlags.Ephemeral });
}

async function log(interaction, { ok, reason }) {
  const { user, guild } = interaction;
  const channelId = db.channelId(guild.id, 'verifyLogs');
  if (!channelId) return;
  const ageDays = Math.floor((Date.now() - user.createdTimestamp) / DAY);
  const e1 = embed(ok ? COLORS.success : COLORS.warning)
    .setAuthor({ name: user.tag ?? user.username, iconURL: user.displayAvatarURL?.() })
    .setDescription(ok ? `✅ ${user} – weryfikacja zakończona sukcesem.` : `⚠️ ${user} – weryfikacja nieudana: ${reason}`)
    .addFields(
      { name: 'Konto utworzone', value: `${ts(user.createdTimestamp, 'R')}${ageDays < 7 ? ' ⚠️ nowe konto' : ''}`, inline: true },
      { name: 'ID użytkownika', value: `\`${user.id}\``, inline: true },
    );
  await sendToChannel(guild, channelId, { embeds: [e1], allowedMentions: { parse: [] } });
}

function checkRole(interaction) {
  const role = memberRole(interaction.guild);
  if (!role) return { error: `❌ Brakuje roli weryfikacji. Daj znać zespołowi (administrator naprawi to komendą \`${slash('build')}\`).` };
  if (!isSafeSelfRole(role)) return { error: '❌ Nie mogę nadać roli weryfikacji (jest nad moją rolą albo ma uprawnienia moderacyjne). Daj znać zespołowi.' };
  if (interaction.member.roles.cache.has(role.id)) return { done: true, role };
  return { role };
}

async function grant(interaction, role) {
  await interaction.member.roles.add(role, 'Weryfikacja');
  const g = interaction.guild;
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(`## ${e(g, 'check')} Konto zweryfikowane!\nWitamy w **${config.brand.name}**, ${interaction.member.displayName} 🧡 Wszystkie kanały są już odblokowane – zacznij tutaj:`),
  );
  const links = [
    ['shop', 'Sklep', 'cart'],
    ['tickets', 'Pomoc', 'ticket'],
    ['roles', 'Role', 'bell'],
  ]
    .map(([key, label, icon]) => [db.channelId(g.id, key), label, icon])
    .filter(([id]) => id)
    .map(([id, label, icon]) => linkBtn(channelUrl(g.id, id), label, ce(g, icon)));
  if (links.length) c.addActionRowComponents(row(...links));
  try {
    await interaction.reply({ ...v2(c), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  } finally {
    // The role is given at this point – log it and run the 'verified' features (invite credit, welcome code)
    // even when Discord refused a late reply. Logging comes after the reply: Discord needs an answer within 3 seconds.
    await log(interaction, { ok: true }).catch((err) => console.warn('[verify] Nie udało się zapisać logu:', err.message));
    await hooks.emit('verified', interaction.member);
  }
}

async function handleButton(interaction) {
  const check = checkRole(interaction);
  if (check.error) return reply(interaction, COLORS.danger, check.error);
  if (check.done) return reply(interaction, COLORS.success, '✅ Twoje konto jest już zweryfikowane – miłego pobytu!');

  const minDays = Number(config.verification.minAccountAgeDays) || 0;
  if (minDays > 0) {
    const created = interaction.user.createdTimestamp;
    if (Date.now() - created < minDays * DAY) {
      await reply(
        interaction,
        COLORS.warning,
        `⏳ Twoje konto Discord jest za nowe. Żeby dołączyć do ${config.brand.name}, konto musi mieć co najmniej **${count(minDays, 'dzień', 'dni', 'dni')}**.\nZweryfikujesz się ${ts(created + minDays * DAY, 'R')}.`,
      );
      return log(interaction, { ok: false, reason: `konto młodsze niż ${count(minDays, 'dzień', 'dni', 'dni')}` });
    }
  }

  if (config.verification.captcha) {
    const a = crypto.randomInt(2, 10);
    const b = crypto.randomInt(2, 10);
    const sig = sign(interaction.user.id, a, b);
    const modal = new ModalBuilder()
      .setCustomId(`verify:answer:${a}:${b}:${sig}`)
      .setTitle(`${config.brand.name} · Weryfikacja`.slice(0, 45))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Szybkie sprawdzenie, czy jesteś człowiekiem 🤖❌'))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(`Ile to jest ${a} + ${b}?`)
          .setDescription('Wpisz wynik jako liczbę, np. 12')
          .setTextInputComponent(new TextInputBuilder().setCustomId('answer').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4)),
      );
    return interaction.showModal(modal);
  }
  return grant(interaction, check.role);
}

async function handleAnswer(interaction) {
  const [, , a, b, sig] = interaction.customId.split(':');
  if (sig !== sign(interaction.user.id, a, b)) {
    return reply(interaction, COLORS.warning, '⌛ To pytanie wygasło – kliknij **Zweryfikuj się** jeszcze raz.');
  }
  let answer = '';
  try {
    answer = interaction.fields.getTextInputValue('answer').trim();
  } catch {
    answer = '';
  }
  if (Number.parseInt(answer, 10) !== Number(a) + Number(b)) {
    await reply(interaction, COLORS.danger, '❌ Zła odpowiedź. Kliknij **Zweryfikuj się** i spróbuj ponownie.');
    return log(interaction, { ok: false, reason: 'błędna odpowiedź na pytanie matematyczne' });
  }
  const check = checkRole(interaction);
  if (check.error) return reply(interaction, COLORS.danger, check.error);
  if (check.done) return reply(interaction, COLORS.success, '✅ Twoje konto jest już zweryfikowane – miłego pobytu!');
  return grant(interaction, check.role);
}

module.exports = { verifyPanel, handleButton, handleAnswer, sign, memberRole };
