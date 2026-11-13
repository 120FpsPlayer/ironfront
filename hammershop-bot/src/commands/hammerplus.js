'use strict';

/** /hammerplus – Hammer+ codes for Hammer Launcher: issue one for a Minecraft account, check one, see what was issued, and the key. */

const { SlashCommandBuilder, InteractionContextType, MessageFlags } = require('discord.js');
const { env } = require('../env');
const plus = require('../lib/plus');
const hammerplus = require('../features/hammerplus');
const { COLORS } = require('../lib/theme');
const { embed, logEmbed, reply, replyError, sendLog, ts, count } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const LIST = 15;

/** "`Notch` · `069a79f4…`" – in code spans, so a nick like _Steve_ is never read as markdown. */
const accountText = (nick, mc) => `${nick ? `\`${nick}\` · ` : ''}\`${mc}\``;

/** The answer to "grant": the code and the two sentences for the customer as plain text (easy to copy, also on a phone). */
function grantReply(code, record) {
  return {
    content:
      `🔨 **Kod Hammer+ dla konta Minecraft \`${record.nick}\`** – ważny ${hammerplus.validity(record.exp)}:\n` +
      `\`\`\`\n${code}\n\`\`\`\n` +
      '**Wiadomość dla klienta** (skopiuj razem z kodem):\n' +
      '> Wpisz ten kod w Hammer Launcherze: **Hammer+** → **„Mam kod”**.\n' +
      `> Kod działa tylko na koncie Minecraft \`${record.nick}\`.`,
    embeds: [
      embed(COLORS.success)
        .addFields(
          { name: 'Konto Minecraft', value: accountText(record.nick, record.mc), inline: true },
          { name: 'Ważny', value: hammerplus.validity(record.exp), inline: true },
          { name: 'ID kodu', value: `\`${record.id}\``, inline: true },
        )
        .setDescription(`-# Bot nie zapisuje samego kodu – skopiuj go teraz. Zgubiony kod? Wystaw nowy przez \`${slash('hammerplus grant')}\`.`),
    ],
  };
}

function checkEmbed(result) {
  const { payload, record } = result;
  const issued = record ? `${ts(record.at, 'f')} przez ${record.by ? `<@${record.by}>` : 'bota'}` : `${ts(payload.iat * 1000, 'f')} – nie ma go w historii tego serwera`;
  return embed(result.valid ? COLORS.success : COLORS.danger)
    .setTitle(result.valid ? '✅ Kod Hammer+ jest ważny' : '⌛ Kod Hammer+ wygasł')
    .setDescription(result.valid ? 'Podpis się zgadza – launcher przyjmie ten kod na koncie poniżej.' : `Kod jest prawdziwy, ale wygasł ${ts(payload.exp * 1000, 'R')} – launcher już go nie przyjmie.`)
    .addFields(
      { name: 'Konto Minecraft', value: accountText(record?.nick, payload.mc), inline: true },
      { name: result.valid ? 'Ważny' : 'Wygasł', value: result.valid ? hammerplus.validity(payload.exp) : ts(payload.exp * 1000, 'f'), inline: true },
      { name: 'ID kodu', value: `\`${payload.id}\``, inline: true },
      { name: 'Wystawiony', value: issued },
    );
}

function listEmbed(guildId) {
  const all = hammerplus.codes(guildId);
  const lines = hammerplus.recent(guildId, LIST).map((r) => hammerplus.line(r));
  const active = all.filter((r) => !hammerplus.expired(r.exp)).length;
  if (all.length > lines.length) lines.push(`-# …i ${count(all.length - lines.length, 'starszy', 'starsze', 'starszych')}.`);
  if (lines.length) lines.push('-# Samych kodów bot nie zapisuje – widać tylko, komu i na jak długo je wystawiono.');
  return embed(COLORS.brand)
    .setTitle(`🔨 Kody Hammer+ (${all.length})`)
    .setDescription(lines.join('\n') || `Nie wystawiono jeszcze żadnego kodu – pierwszy wystawisz przez \`${slash('hammerplus grant')}\`.`)
    .addFields({ name: 'Aktywne', value: String(active), inline: true }, { name: 'Wygasłe', value: String(all.length - active), inline: true });
}

function keyEmbed() {
  if (!plus.ready()) return embed(COLORS.warning).setTitle('🔑 Klucz Hammer+ nie jest ustawiony').setDescription(hammerplus.setupHelp());
  const site = env.web.enabled && env.web.publicUrl ? `Adres API dla launchera: \`${env.web.publicUrl}/api/launcher/\`` : 'Strona bota nie ma jeszcze publicznego adresu (`PUBLIC_URL`) – chmura i peleryny Hammer+ ruszą razem z nią. Same kody działają już teraz: launcher sprawdza je bez internetu.';
  return embed(COLORS.success)
    .setTitle('🔑 Klucz Hammer+ jest ustawiony')
    .setDescription(
      `**Klucz publiczny** – wpisz go w Hammer Launcherze, żeby przyjmował kody wystawione przez tego bota:\n\`\`\`\n${plus.publicKey()}\n\`\`\`\n` +
        `${site}\n` +
        '-# Klucz publiczny można pokazywać każdemu. Klucza prywatnego z `.env` nie podawaj nikomu – a jego zmiana unieważnia wszystkie wystawione kody.',
    );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hammerplus')
    .setDescription('Hammer+ codes for Hammer Launcher, bound to a Minecraft account (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('grant')
        .setDescription('Issue a Hammer+ code for a customer\'s Minecraft account')
        .addStringOption((o) => o.setName('nick').setDescription('The customer\'s Minecraft nick (premium account)').setRequired(true).setMinLength(1).setMaxLength(16))
        .addIntegerOption((o) => o.setName('days').setDescription('Valid for this many days (0 = forever)').setRequired(true).setMinValue(0).setMaxValue(hammerplus.MAX_DAYS))
        .addUserOption((o) => o.setName('user').setDescription('Their Discord account – gets the Hammer+ role while it runs (optional)')),
    )
    .addSubcommand((s) =>
      s
        .setName('check')
        .setDescription('Check a code: whose it is and until when it works')
        .addStringOption((o) => o.setName('code').setDescription('The Hammer+ code (HP1.…)').setRequired(true).setMaxLength(1100)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('The last issued codes – nick, expiry and who issued them (never the codes)'))
    .addSubcommand((s) => s.setName('key').setDescription('Is the signing key set? Shows the public key to put into the launcher')),

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą zarządzać Hammer+.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'key') return reply(interaction, { embeds: [keyEmbed()] });
    hammerplus.requireKey(); // everything else needs the signing key – explains what to add to .env

    if (sub === 'grant') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // asking Mojang can take a few seconds
      const owner = o.getUser('user');
      const { code, record } = await hammerplus.grant(guild.id, { nick: o.getString('nick'), days: o.getInteger('days') ?? 0, by: interaction.user.id, discordId: owner?.id ?? null });
      await reply(interaction, grantReply(code, record));
      if (owner) await require('../features/plusrole').sync(guild, owner.id).catch(() => null); // 💎 Hammer+ role
      // The log says who got Hammer+ – the code itself is never written anywhere.
      return sendLog(guild, {
        embeds: [logEmbed(COLORS.brand, '🔨 Kod Hammer+ wystawiony', interaction.user).setDescription(`Wystawiony przez ${interaction.user}: konto Minecraft ${accountText(record.nick, record.mc)} · ważny ${hammerplus.validity(record.exp)}${owner ? ` · dla ${owner} (ranga Hammer+)` : ''} · ID \`${record.id}\``)],
      });
    }

    if (sub === 'check') {
      const result = hammerplus.inspect(guild.id, o.getString('code'));
      if (!result.payload) return replyError(interaction, result.message);
      return reply(interaction, { embeds: [checkEmbed(result)] });
    }

    return reply(interaction, { embeds: [listEmbed(guild.id)] });
  },
};
