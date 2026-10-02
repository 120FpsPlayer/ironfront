'use strict';

const { SlashCommandBuilder, InteractionContextType, ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const giveaways = require('../features/giveaways');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, parseDuration, ts, truncate } = require('../lib/utils');
const { isMod } = require('../lib/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run giveaways (moderators)')
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a giveaway')
        .addStringOption((o) => o.setName('prize').setDescription('What can people win?').setRequired(true).setMaxLength(120))
        .addStringOption((o) => o.setName('duration').setDescription('How long? e.g. 30m, 2h, 1d, 1w, 1d12h').setRequired(true).setMaxLength(20))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (default 1)').setMinValue(1).setMaxValue(20))
        .addStringOption((o) => o.setName('description').setDescription('Extra info shown on the giveaway').setMaxLength(600))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel (default: #giveaways)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
        .addRoleOption((o) => o.setName('required_role').setDescription('Only members with this role can enter'))
        .addBooleanOption((o) => o.setName('ping').setDescription('Ping the Giveaways role? (default: yes)')),
    )
    .addSubcommand((s) =>
      s
        .setName('end')
        .setDescription('End a giveaway now')
        .addStringOption((o) => o.setName('giveaway').setDescription('Giveaway').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Draw new winner(s) for an ended giveaway')
        .addStringOption((o) => o.setName('giveaway').setDescription('Giveaway').setRequired(true).setAutocomplete(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('Active and recent giveaways')),

  autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    return giveaways.autocomplete(interaction, { active: sub === 'end' ? true : sub === 'reroll' ? false : null });
  },

  async execute(interaction) {
    if (!isMod(interaction.member)) return replyError(interaction, 'Only moderators and administrators can run giveaways.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'start') {
      const durationMs = parseDuration(o.getString('duration'));
      if (!durationMs) return replyError(interaction, 'Invalid duration. Examples: `30m`, `2h`, `1d`, `1w`, `1d12h`.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const { gw, message } = await giveaways.start(guild, interaction.member, {
        prize: o.getString('prize'),
        durationMs,
        winners: o.getInteger('winners') ?? 1,
        description: o.getString('description'),
        channel: o.getChannel('channel'),
        requiredRole: o.getRole('required_role'),
        ping: o.getBoolean('ping') ?? true,
      });
      return reply(interaction, `Giveaway for **${gw.prize}** started in <#${gw.channelId}> – it ends ${ts(gw.endsAt, 'R')}. [Jump](${message.url})`);
    }

    if (sub === 'end' || sub === 'reroll') {
      const gw = giveaways.find(guild.id, o.getString('giveaway'));
      if (!gw) return replyError(interaction, 'There is no such giveaway. Pick one from the suggestions.');
      if (sub === 'end' && gw.ended) return replyError(interaction, 'This giveaway has already ended – use `/giveaway reroll` for a new winner.');
      if (sub === 'reroll' && !gw.ended) return replyError(interaction, 'This giveaway is still running – end it first.');
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const winners = await giveaways.end(guild, gw, { reroll: sub === 'reroll', count: sub === 'reroll' ? o.getInteger('winners') ?? 1 : null });
      return reply(interaction, winners.length ? `Winner${winners.length > 1 ? 's' : ''}: ${winners.map((id) => `<@${id}>`).join(', ')}` : 'No valid entries – nobody could be drawn.');
    }

    const list = giveaways.all(guild.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 15);
    const lines = list.map((g) => `${g.ended ? '✅' : '🎉'} **${truncate(g.prize, 60)}** – ${g.entries.length} entries · ${g.ended ? 'ended' : 'ends'} ${ts(g.endsAt, 'R')} · <#${g.channelId}>`);
    return reply(interaction, { embeds: [embed(COLORS.brand).setTitle('🎉 Giveaways').setDescription(lines.join('\n') || 'No giveaways yet – start one with `/giveaway start`.')] });
  },
};
