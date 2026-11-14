'use strict';

/** /assistant (/asystent) – the AI assistant in tickets: on / off for the whole server (admins), per ticket and its status (staff). */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const assistant = require('../features/aiassistant');
const config = require('../lib/config');
const db = require('../lib/db');
const { COLORS } = require('../lib/theme');
const { embed, reply, replyError, isAdmin, isStaff, pad, ts } = require('../lib/utils');
const { slash } = require('../lib/commandsPl');

const STOPPED = { staff: 'odpisał ktoś z zespołu', escalated: 'zawołał zespół', manual: 'wyłączony przez zespół' };

function ticketLine(s) {
  if (!s.ticket) return null;
  if (!s.ticket.open) return 'Ten ticket jest zamknięty.';
  if (s.ticket.mode === 'noai' && !s.ticket.stopped) return '⚪ bez AI – nagrody przyciskami, „człowiek” woła zespół';
  if (s.ticket.active) return `🟢 odpowiada · odpowiedzi: **${s.ticket.replies ?? 0}/${s.maxReplies}**`;
  if (s.ticket.stopped) return `⚪ nie odpowiada – ${STOPPED[s.ticket.stopped] ?? s.ticket.stopped} · \`${slash('assistant ticket')}\` włącza go ponownie`;
  return `⚪ nie działa w tym tickecie · \`${slash('assistant ticket')}\` go włącza`;
}

function statusEmbed(guild, channel) {
  const s = assistant.status(guild, db.getTicket(channel?.id) ? channel : null);
  const working = !s.problem && !s.pause && s.global;
  const e = embed(working ? COLORS.success : s.pause ? COLORS.warning : COLORS.muted)
    .setTitle('🤖 Asystent AI w ticketach')
    .setDescription(
      s.problem ??
        s.pauseText ??
        (s.global
          ? 'Odpowiada w nowych ticketach, zanim odpisze zespół: pomaga z launcherem, wydaje nagrody z giveawayów (Hammer+ od razu, resztę zgłasza zespołowi) i woła zespół, gdy trzeba.'
          : `Wyłączony na całym serwerze – włączysz go przez \`${slash('assistant on')}\`. Nagrody z giveawayów odbiera się wtedy przyciskami w tickecie.`),
    )
    .addFields(
      { name: 'Dostawca AI', value: s.providerLabel, inline: true },
      { name: 'Model', value: s.model ? `\`${s.model}\`` : '—', inline: true },
      { name: 'Klucz API', value: s.problem ? '❌ brak albo niepełna konfiguracja' : '✅ ustawiony', inline: true },
      { name: 'Na serwerze', value: s.global ? '🟢 włączony' : '⚪ wyłączony', inline: true },
      { name: 'Przerwa', value: s.pause ? `⏸️ do ${ts(s.pause.until, 't')} (${ts(s.pause.until, 'R')})` : '—', inline: true },
      { name: 'Aktywny w ticketach', value: String(s.activeTickets), inline: true },
    )
    .setFooter({
      text:
        s.provider === 'claude'
          ? 'Odmowy modelu obsługuje model zapasowy · logi: kanał logów ticketów'
          : 'Bez klucza albo w przerwie nagrody odbiera się przyciskami, a „człowiek” woła zespół · logi: kanał logów ticketów',
    });
  const line = ticketLine(s);
  if (line) e.addFields({ name: 'Ten ticket', value: line });
  return e;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('assistant')
    .setDescription('The AI assistant in tickets (Groq / Claude) – on/off and status')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('on').setDescription('Turn the AI assistant on for the whole server (admins)'))
    .addSubcommand((s) => s.setName('off').setDescription('Turn the AI assistant off for the whole server (admins)'))
    .addSubcommand((s) => s.setName('status').setDescription('Is the assistant on, which model, how many tickets it answers in'))
    .addSubcommand((s) =>
      s
        .setName('ticket')
        .setDescription('Turn the assistant on or off in this ticket (staff)')
        .addStringOption((o) =>
          o
            .setName('state')
            .setDescription('On or off')
            .setRequired(true)
            .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;
    const member = interaction.member;

    if (sub === 'on' || sub === 'off') {
      if (!isAdmin(member)) return replyError(interaction, 'Asystenta na całym serwerze może włączyć albo wyłączyć tylko administrator.');
      const on = sub === 'on';
      if (on && assistant.unavailableText()) return replyError(interaction, assistant.unavailableText());
      if (assistant.globallyOn(guild.id) === on) return reply(interaction, on ? 'Asystent AI już jest włączony.' : 'Asystent AI już jest wyłączony.');
      assistant.setGlobal(guild, on, member);
      return reply(
        interaction,
        on
          ? 'Asystent AI włączony – będzie odpowiadał w nowych ticketach.'
          : `Asystent AI wyłączony na całym serwerze – nie odpowie w żadnym tickecie, dopóki nie włączysz go przez \`${slash('assistant on')}\`.`,
      );
    }

    if (sub === 'ticket') {
      const ticket = db.getTicket(interaction.channel?.id);
      if (!ticket) return replyError(interaction, 'Tej komendy użyj na kanale ticketu.');
      if (!isStaff(member, config.getType(ticket.typeId))) return replyError(interaction, 'Asystenta w tickecie może włączyć albo wyłączyć tylko zespół.');
      const on = interaction.options.getString('state') === 'on';
      await assistant.setTicket(interaction.channel, on, member);
      return reply(interaction, on ? `Asystent AI znów odpowiada w tickecie \`#${pad(ticket.number)}\`.` : `Asystent AI wyłączony w tickecie \`#${pad(ticket.number)}\`.`);
    }

    if (!isStaff(member)) return replyError(interaction, 'Status asystenta widzi tylko zespół.');
    return reply(interaction, { embeds: [statusEmbed(guild, interaction.channel)] });
  },
};
