'use strict';

const crypto = require('node:crypto');
const { ButtonStyle, LabelBuilder, MessageFlags, ModalBuilder, TextDisplayBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { isSafeSelfRole } = require('../lib/guards');
const { sendToChannel, ts, embed } = require('../lib/utils');
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
    `# ${e(guild, 'shield')} Verify your account\n` +
      `Welcome to **${config.brand.name}**! To keep our community safe from bots, raiders and scammers, ` +
      'every member verifies once – it takes about five seconds.',
    guild.iconURL?.({ size: 256 }),
  );
  c.addSeparatorComponents(divider());
  const steps = [
    rules ? `Read the rules in <#${rules}>` : 'Read the server rules',
    'Click **Verify** below',
    v.captcha ? 'Answer a quick math question – done!' : 'Done – the whole server unlocks instantly!',
  ];
  c.addTextDisplayComponents(text(`### ${e(guild, 'info')} How it works\n${steps.map((s, i) => `> **${i + 1}.** ${s}`).join('\n')}`));
  c.addSeparatorComponents(divider());
  const notes = ['By verifying you agree to our rules and to Discord\'s Terms of Service.'];
  if (v.minAccountAgeDays > 0) notes.push(`Accounts younger than **${v.minAccountAgeDays} days** can't verify yet.`);
  notes.push('Trouble verifying? Ask a staff member.');
  c.addTextDisplayComponents(text(notes.map((n) => `-# ${n}`).join('\n')));
  c.addActionRowComponents(row(btn('verify:start', 'Verify', ce(guild, 'check'), ButtonStyle.Success)));
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
    .setDescription(ok ? `✅ ${user} passed verification.` : `⚠️ ${user} failed verification: ${reason}`)
    .addFields(
      { name: 'Account created', value: `${ts(user.createdTimestamp, 'R')}${ageDays < 7 ? ' ⚠️ new account' : ''}`, inline: true },
      { name: 'User ID', value: `\`${user.id}\``, inline: true },
    );
  await sendToChannel(guild, channelId, { embeds: [e1], allowedMentions: { parse: [] } });
}

function checkRole(interaction) {
  const role = memberRole(interaction.guild);
  if (!role) return { error: '❌ The verification role is missing. Please tell the staff (an admin can fix it with `/build`).' };
  if (!isSafeSelfRole(role)) return { error: '❌ I cannot assign the verification role (it is above my role or has moderation permissions). Please tell the staff.' };
  if (interaction.member.roles.cache.has(role.id)) return { done: true, role };
  return { role };
}

async function grant(interaction, role) {
  await interaction.member.roles.add(role, 'Verification');
  const g = interaction.guild;
  const c = container(COLORS.success);
  c.addTextDisplayComponents(
    text(`## ${e(g, 'check')} You're verified!\nWelcome to **${config.brand.name}**, ${interaction.member.displayName} 💜 Every channel is unlocked now – here's where to start:`),
  );
  const links = [
    ['shop', 'Shop', 'cart'],
    ['tickets', 'Support', 'ticket'],
    ['roles', 'Roles', 'bell'],
  ]
    .map(([key, label, icon]) => [db.channelId(g.id, key), label, icon])
    .filter(([id]) => id)
    .map(([id, label, icon]) => linkBtn(channelUrl(g.id, id), label, ce(g, icon)));
  if (links.length) c.addActionRowComponents(row(...links));
  await interaction.reply({ ...v2(c), flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
  // Log after replying – Discord needs an answer within 3 seconds.
  await log(interaction, { ok: true });
  await hooks.emit('verified', interaction.member);
}

async function handleButton(interaction) {
  const check = checkRole(interaction);
  if (check.error) return reply(interaction, COLORS.danger, check.error);
  if (check.done) return reply(interaction, COLORS.success, '✅ You are already verified – enjoy your stay!');

  const minDays = Number(config.verification.minAccountAgeDays) || 0;
  if (minDays > 0) {
    const created = interaction.user.createdTimestamp;
    if (Date.now() - created < minDays * DAY) {
      await reply(
        interaction,
        COLORS.warning,
        `⏳ Your Discord account is too new. Accounts must be at least **${minDays} days** old to join ${config.brand.name}.\nYou can verify ${ts(created + minDays * DAY, 'R')}.`,
      );
      return log(interaction, { ok: false, reason: `account younger than ${minDays} days` });
    }
  }

  if (config.verification.captcha) {
    const a = crypto.randomInt(2, 10);
    const b = crypto.randomInt(2, 10);
    const sig = sign(interaction.user.id, a, b);
    const modal = new ModalBuilder()
      .setCustomId(`verify:answer:${a}:${b}:${sig}`)
      .setTitle(`${config.brand.name} · Verification`.slice(0, 45))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('Quick check to make sure you\'re a human 🤖❌'))
      .addLabelComponents(
        new LabelBuilder()
          .setLabel(`What is ${a} + ${b}?`)
          .setDescription('Type the result as a number, e.g. 12')
          .setTextInputComponent(new TextInputBuilder().setCustomId('answer').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(4)),
      );
    return interaction.showModal(modal);
  }
  return grant(interaction, check.role);
}

async function handleAnswer(interaction) {
  const [, , a, b, sig] = interaction.customId.split(':');
  if (sig !== sign(interaction.user.id, a, b)) {
    return reply(interaction, COLORS.warning, '⌛ This question expired – click **Verify** again.');
  }
  let answer = '';
  try {
    answer = interaction.fields.getTextInputValue('answer').trim();
  } catch {
    answer = '';
  }
  if (Number.parseInt(answer, 10) !== Number(a) + Number(b)) {
    await reply(interaction, COLORS.danger, '❌ Wrong answer. Click **Verify** and try again.');
    return log(interaction, { ok: false, reason: 'wrong answer to the check question' });
  }
  const check = checkRole(interaction);
  if (check.error) return reply(interaction, COLORS.danger, check.error);
  if (check.done) return reply(interaction, COLORS.success, '✅ You are already verified – enjoy your stay!');
  return grant(interaction, check.role);
}

module.exports = { verifyPanel, handleButton, handleAnswer, sign };
