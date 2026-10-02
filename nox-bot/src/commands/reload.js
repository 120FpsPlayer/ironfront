'use strict';

const { SlashCommandBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const config = require('../lib/config');
const { COLORS } = require('../lib/theme');
const { embed, replyError, isAdmin, duration } = require('../lib/utils');
const { reloadAll } = require('../builder/reload');
const { running } = require('../builder/session');

const STEPS = ['Files', 'Branding', 'Roles & channels', 'Emojis', 'Messages'];
const LABELS = {
  Files: '📄 Files',
  Branding: '🌙 Name & logo',
  'Roles & channels': '📁 Roles & channels',
  Emojis: '😀 Emojis',
  Messages: '📨 Banners, cards & panels',
  Server: '🏗️ Server',
};

function render(steps, current, { done = false, started }) {
  const lines = steps.map((s) => `${s.ok ? '✅' : '❌'} **${LABELS[s.name] ?? s.name}** – ${s.detail}`);
  if (current) lines.push(`⏳ **${LABELS[current] ?? current}**…`);
  const failed = steps.some((s) => !s.ok);
  const e = embed(done ? (failed ? COLORS.warning : COLORS.success) : COLORS.brand)
    .setTitle(done ? (failed ? `⚠️ ${config.brand.name} reloaded with notes` : `✅ ${config.brand.name} reloaded`) : `🔄 Reloading ${config.brand.name}…`)
    .setDescription(lines.join('\n').slice(0, 4000));
  if (done) {
    e.setFooter({ text: `Took ${duration(Date.now() - started)} · Changed other .js files? Restart the bot first, then run /reload.` });
  }
  return { embeds: [e] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reload')
    .setDescription('Reload config.json + scripts and update all channels, roles, the logo and every banner/card')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!isAdmin(interaction.member)) return replyError(interaction, 'Only the server owner and administrators can use `/reload`.');
    const guild = interaction.guild;
    if (running.has(guild.id)) return replyError(interaction, 'A build or reload is already running on this server.');
    running.set(guild.id, { abort: false });
    const started = Date.now();
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { steps } = await reloadAll(guild, {
        invokerId: interaction.user.id,
        onStep: (name, done) => interaction.editReply(render(done, name, { started })).catch(() => null),
      });
      return interaction.editReply(render(steps, null, { done: true, started }));
    } finally {
      running.delete(guild.id);
    }
  },

  STEPS,
};
