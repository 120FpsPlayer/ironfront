'use strict';

const {
  ButtonStyle,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const { e, ce, COLORS, banner } = require('../lib/theme');
const { isOwner, isAdmin } = require('../lib/permissions');
const { ts, truncate, duration, embed } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, header, gallery, v2, channelUrl } = require('../lib/v2');
const { ROLES, CATEGORIES } = require('./layout');
const { buildServer } = require('./executor');
const { refreshContent } = require('./refresh');
const { syncEmojis, describeEmojiResult } = require('./emojis');
const { EMOJI_PRIORITY } = require('../lib/theme');

/** One build per server at a time. */
const running = new Map();

const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

function canBuild(member) {
  return isOwner(member) || isAdmin(member);
}

function previewCard(guild, member) {
  const c = container(COLORS.brand);
  const file = banner('welcome');
  c.addMediaGalleryComponents(gallery(`attachment://${file.name}`));
  const channels = CATEGORIES.reduce((n, cat) => n + cat.channels.length, 0);
  const prev = db.build(guild.id);
  header(
    c,
    `# ${e(guild, 'sparkles')} Build ${config.brand.name}\n` +
      `This sets up the complete **${config.brand.name}** server in one go – roles, channels, permissions, banners, ` +
      'custom emojis, verification, shop, tickets, vouches, giveaways, AutoMod and more.',
    null,
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${e(guild, 'box')} What will be created\n` +
        `> 🎭 **${ROLES.length}** roles in a purple palette (Founder → Member + notification roles)\n` +
        `> 📁 **${CATEGORIES.length}** categories with **${channels}** channels and fine-tuned permissions\n` +
        `> 🖼️ Custom banners and cards in every info channel\n` +
        `> 😀 Up to **${EMOJI_PRIORITY.length}** purple custom emojis (as many as your server has room for)\n` +
        '> ✅ Verification gate · 🛒 live shop · 🎫 tickets · ⭐ vouches · 🎉 giveaways · 🏆 leaderboard\n' +
        `> 🤖 AutoMod (spam, raids, scams, invites) · server name **${config.brand.name}** + icon`,
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      CATEGORIES.map((cat) => `**${cat.name}**\n-# ${cat.channels.map((ch) => ch.name).join(' · ') || 'ticket channels appear here'}`).join('\n'),
    ),
  );
  c.addSeparatorComponents(divider());
  const notes = [
    `${e(guild, 'info')} **Build** adds everything next to your current channels. **Wipe & Build** deletes all channels, roles and AutoMod rules first (server owner only).`,
    `${e(guild, 'warning')} Members without the Member role must verify. Existing members get it automatically.`,
  ];
  if (prev?.at) notes.unshift(`${e(guild, 'warning')} **${config.brand.name} was already built here** ${ts(prev.at, 'R')}. Building again without a wipe creates duplicate channels.`);
  c.addTextDisplayComponents(text(notes.join('\n')));
  c.addActionRowComponents(
    row(
      btn('build:go', 'Build', ce(guild, 'rocket'), ButtonStyle.Success),
      btn('build:wipe', 'Wipe & Build', ce(guild, 'warning'), ButtonStyle.Danger).setDisabled(!isOwner(member)),
      btn('build:cancel', 'Cancel', ce(guild, 'x'), ButtonStyle.Secondary),
    ),
  );
  return { ...v2(c, { files: [file] }), flags: V2_EPHEMERAL };
}

function progressCard(guild, s, { finishedPhases = [] } = {}) {
  const pct = Math.min(100, Math.round((s.done / Math.max(1, s.total)) * 100));
  const width = 20;
  const filled = Math.round((pct / 100) * width);
  const bar = `${'▰'.repeat(filled)}${'▱'.repeat(width - filled)}`;
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${e(guild, 'gear')} Building ${config.brand.name}…\n\`${bar}\` **${pct}%**\n` +
        `**Now:** ${s.phase}${s.label ? ` – ${truncate(s.label, 80)}` : ''}\n` +
        (finishedPhases.length ? `${finishedPhases.map((p) => `${e(guild, 'check')} ${p}`).join('\n')}\n` : '') +
        `-# ⏱️ ${duration(s.elapsed)} · Please keep this message open – you can close Discord, the build continues anyway.`,
    ),
  );
  c.addActionRowComponents(row(btn('build:stop', 'Stop', ce(guild, 'x'), ButtonStyle.Secondary)));
  return { components: [c], flags: MessageFlags.IsComponentsV2, attachments: [] };
}

function resultCard(guild, R, { originChannelId, wipe }) {
  const ok = !R.fatal && !R.aborted;
  const c = container(ok ? COLORS.success : R.aborted ? COLORS.warning : COLORS.danger);
  const title = ok ? `${e(guild, 'check')} ${config.brand.name} is ready!` : R.aborted ? '⏹️ Build stopped' : '💥 Build failed';
  const head = [`# ${title}`];
  if (R.fatal) head.push(`**Error:** ${R.fatal}`);
  head.push(
    `> 🎭 **${R.created.roles}** roles · 📁 **${R.created.categories}** categories · 💬 **${R.created.channels}** channels\n` +
      `> 📨 **${R.created.messages}** messages · 🤖 **${R.created.automod}** AutoMod rules · 😀 **${R.created.emojis}** emojis uploaded`,
  );
  if (wipe) head.push(`-# Removed: ${R.deleted.channels} channels · ${R.deleted.roles} roles · ${R.deleted.automod} AutoMod rules`);
  head.push(`-# ⏱️ ${duration(R.duration)}${R.community ? ' · 🌐 Community mode on' : ''}`);
  c.addTextDisplayComponents(text(head.join('\n')));

  const notes = [...R.errors, ...R.warnings];
  if (notes.length) {
    c.addSeparatorComponents(divider());
    const shown = notes.slice(0, 10).map((n) => `> ${truncate(n, 180)}`);
    if (notes.length > 10) shown.push(`> …and ${notes.length - 10} more (see the bot console)`);
    c.addTextDisplayComponents(text(`### ${e(guild, 'warning')} Notes\n${shown.join('\n')}`));
  }
  if (ok) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(
      text(
        `### ${e(guild, 'sparkles')} Next steps\n` +
          '> **1.** Server Settings → Roles: drag the bot\'s role to the very top\n' +
          '> **2.** Add your products with `/product add` – they appear in the shop instantly\n' +
          '> **3.** Give your team their roles (Manager, Support, Seller…)\n' +
          '> **4.** Optional: edit `config.json` (payments, texts) and run `/build only:panels`',
      ),
    );
  }
  const links = ['verify', 'shop', 'tickets', 'staffChat']
    .map((key) => [key, db.channelId(guild.id, key)])
    .filter(([, id]) => id && guild.channels.cache.has(id))
    .map(([key, id]) => linkBtn(channelUrl(guild.id, id), { verify: 'Verify', shop: 'Shop', tickets: 'Tickets', staffChat: 'Staff chat' }[key], ce(guild, { verify: 'shield', shop: 'cart', tickets: 'ticket', staffChat: 'group' }[key])));
  if (links.length) c.addActionRowComponents(row(...links.slice(0, 4)));
  if (wipe && originChannelId && guild.channels.cache.has(originChannelId)) {
    c.addActionRowComponents(row(btn(`build:delorigin:${originChannelId}`, 'Delete this old channel', '🗑️', ButtonStyle.Danger)));
  }
  return { components: [c], flags: MessageFlags.IsComponentsV2, attachments: [] };
}

async function start(interaction) {
  const { guild, member } = interaction;
  if (!canBuild(member)) {
    return interaction.reply({ embeds: [embed(COLORS.danger).setDescription('🔒 Only the server owner and administrators can use `/build`.')], flags: MessageFlags.Ephemeral });
  }
  if (!guild.members.me.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      embeds: [embed(COLORS.danger).setTitle('🔒 I need the Administrator permission').setDescription('Server Settings → Roles → my role → turn on **Administrator**, then run `/build` again. (Or re-invite me with the link from the console.)')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (running.has(guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('⏳ A build is already running on this server.')], flags: MessageFlags.Ephemeral });
  }

  const only = interaction.options.getString('only');
  if (only === 'emojis') return runEmojis(interaction);
  if (only === 'panels') return runRepost(interaction);
  return interaction.reply(previewCard(guild, member));
}

async function runEmojis(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  running.set(interaction.guild.id, { abort: false });
  try {
    const res = await syncEmojis(interaction.guild, { reason: `${config.brand.name} emojis by ${interaction.user.id}` });
    return interaction.editReply({ embeds: [embed(COLORS.brand).setTitle('😀 Emojis').setDescription(describeEmojiResult(res))] });
  } finally {
    running.delete(interaction.guild.id);
  }
}

async function runRepost(interaction) {
  if (!db.build(interaction.guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('This server has not been built yet – run `/build` first.')], flags: MessageFlags.Ephemeral });
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  running.set(interaction.guild.id, { abort: false });
  try {
    const res = await refreshContent(interaction.guild);
    const desc =
      `Updated **${res.edited}** messages in place${res.sent ? ` and re-sent **${res.sent}** missing ones` : ''} in **${res.channels}** channels.` +
      (res.errors.length ? `\n\n⚠️ ${res.errors.slice(0, 5).join('\n')}` : '');
    return interaction.editReply({ embeds: [embed(res.errors.length ? COLORS.warning : COLORS.success).setTitle('🔄 Panels refreshed').setDescription(desc)] });
  } finally {
    running.delete(interaction.guild.id);
  }
}

function wipeModal(guild) {
  return new ModalBuilder()
    .setCustomId('build:wipeconfirm')
    .setTitle('⚠️ Wipe & Build')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Type the server name to confirm')
        .setDescription(truncate(`All channels, roles and AutoMod rules will be deleted. Server name: ${guild.name}`, 100))
        .setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setPlaceholder(truncate(guild.name, 100))),
    );
}

async function run(interaction, mode) {
  const { guild } = interaction;
  if (running.has(guild.id)) {
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('⏳ A build is already running on this server.')], flags: MessageFlags.Ephemeral });
  }
  const state = { abort: false };
  running.set(guild.id, state);
  const originChannelId = interaction.channelId;
  let lastEdit = 0;
  let editsWork = true;

  const push = async (payload) => {
    if (!editsWork) return;
    await interaction.editReply(payload).catch(() => {
      editsWork = false; // the 15-minute interaction window ran out – the build continues anyway
    });
  };

  await interaction.update(progressCard(guild, { done: 0, total: 1, phase: 'Preparing', label: '', elapsed: 0 }));
  try {
    const R = await buildServer({
      guild,
      mode,
      invokerId: interaction.user.id,
      keepChannelIds: mode === 'wipe' ? [originChannelId] : [],
      shouldAbort: () => state.abort,
      onProgress: (s) => {
        const now = Date.now();
        if (now - lastEdit < 1500) return;
        lastEdit = now;
        push(progressCard(guild, s, { finishedPhases: s.phases }));
      },
    });
    await push(resultCard(guild, R, { originChannelId, wipe: mode === 'wipe' }));
    if (!editsWork) {
      await interaction.user.send({ embeds: [embed(COLORS.brand).setTitle(`${config.brand.name} build finished`).setDescription(`Created ${R.created.channels} channels and ${R.created.roles} roles in ${duration(R.duration)}.`)] }).catch(() => null);
    }
    return R;
  } finally {
    running.delete(guild.id);
  }
}

async function handle(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  const { guild, member } = interaction;
  const deny = (msg) => interaction.reply({ embeds: [embed(COLORS.danger).setDescription(msg)], flags: MessageFlags.Ephemeral });

  if (action === 'stop') {
    const state = running.get(guild.id);
    if (!state) return deny('No build is running.');
    if (!canBuild(member)) return deny('Only administrators can stop the build.');
    state.abort = true;
    return interaction.reply({ embeds: [embed(COLORS.warning).setDescription('⏹️ Stopping after the current step…')], flags: MessageFlags.Ephemeral });
  }
  if (action === 'delorigin') {
    if (!isOwner(member)) return deny('Only the server owner can do this.');
    const channel = guild.channels.cache.get(arg);
    await interaction.update({ components: [container(COLORS.muted).addTextDisplayComponents(text('🗑️ Deleting this channel…'))], flags: MessageFlags.IsComponentsV2, attachments: [] }).catch(() => null);
    await channel?.delete('Old channel removed after /build').catch(() => null);
    return null;
  }
  if (!canBuild(member)) return deny('Only the server owner and administrators can use `/build`.');

  switch (action) {
    case 'cancel':
      return interaction.update({ components: [container(COLORS.muted).addTextDisplayComponents(text('✖️ Build cancelled – nothing was changed.'))], flags: MessageFlags.IsComponentsV2, attachments: [] });
    case 'go':
      return run(interaction, 'add');
    case 'wipe':
      if (!isOwner(member)) return deny('🔒 Only the server owner can wipe the server.');
      return interaction.showModal(wipeModal(guild));
    case 'wipeconfirm': {
      if (!isOwner(member)) return deny('🔒 Only the server owner can wipe the server.');
      const typed = interaction.fields.getTextInputValue('name').trim().toLowerCase();
      if (typed !== guild.name.trim().toLowerCase()) return deny('❌ The name does not match – nothing was deleted.');
      return run(interaction, 'wipe');
    }
    default:
      return null;
  }
}

module.exports = { start, handle, previewCard, progressCard, resultCard, running };
