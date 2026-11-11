'use strict';

/** /featured – the servers Hammer Launcher recommends (the launcher reads them from /api/launcher/featured). */

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const featured = require('../features/featured');
const { COLORS } = require('../lib/theme');
const { UserError, embed, logEmbed, reply, replyError, sendLog, truncate } = require('../lib/utils');
const { isShopManager } = require('../lib/permissions');
const { slash } = require('../lib/commandsPl');

const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge', vanilla: 'Vanilla' };

/** "Minecraft 1.21.4 · Fabric · paczka: hammer-smp · survival, pvp · 🖼️ ikona" – what the entry has besides the basics. */
function extras(s) {
  return [s.mc && `Minecraft ${s.mc}`, s.loader && LOADER_NAMES[s.loader], s.pack && `paczka: ${truncate(s.pack, 40)}`, s.tags.length && s.tags.join(', '), s.icon && '🖼️ ikona'].filter(Boolean).join(' · ');
}

function line(s) {
  const more = extras(s);
  return `**${truncate(s.name, 40)}** — \`${s.address}\`\n${truncate(s.description, 120)}${more ? `\n-# ${more}` : ''}`;
}

function listEmbed(guildId) {
  const servers = featured.list(guildId);
  return embed(COLORS.brand)
    .setTitle(`🌍 Polecane serwery (${servers.length}/${featured.MAX_SERVERS})`)
    .setDescription(truncate(servers.map(line).join('\n\n') || `Lista jest pusta – dodaj pierwszy serwer przez \`${slash('featured add')}\`.`, 4000));
}

function detailFields(s) {
  return [
    { name: 'Adres', value: `\`${s.address}\``, inline: true },
    { name: 'Wersja', value: s.mc ? `Minecraft ${s.mc}` : '—', inline: true },
    { name: 'Loader', value: s.loader ? LOADER_NAMES[s.loader] : '—', inline: true },
    { name: 'Opis', value: truncate(s.description, 1024) },
    ...(s.tags.length ? [{ name: 'Tagi', value: s.tags.join(', '), inline: true }] : []),
    ...(s.pack ? [{ name: 'Paczka', value: truncate(s.pack, 200), inline: true }] : []),
  ];
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('featured')
    .setDescription('Servers featured in Hammer Launcher (admins & sellers)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a server to the featured list in the launcher')
        .addStringOption((o) => o.setName('name').setDescription('Server name').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('address').setDescription('Server address: host or host:port, e.g. mc.hammershop.pl').setRequired(true).setMaxLength(260))
        .addStringOption((o) => o.setName('description').setDescription('Short description (up to 200 characters)').setRequired(true).setMaxLength(200))
        .addStringOption((o) => o.setName('tags').setDescription('Tags separated by commas, e.g. survival, pvp (up to 6)').setMaxLength(150))
        .addStringOption((o) => o.setName('icon').setDescription('Address of the server icon – must start with https://').setMaxLength(300))
        .addStringOption((o) => o.setName('mc').setDescription('Minecraft version, e.g. 1.21.4').setMaxLength(12))
        .addStringOption((o) => o.setName('loader').setDescription('Mod loader').addChoices(...featured.LOADERS.map((value) => ({ name: LOADER_NAMES[value], value }))))
        .addStringOption((o) => o.setName('pack').setDescription('Modpack the launcher should install for this server (optional)').setMaxLength(200)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a server from the featured list')
        .addStringOption((o) => o.setName('server').setDescription('The server').setRequired(true).setAutocomplete(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('The featured servers')),

  autocomplete(interaction) {
    if (!isShopManager(interaction.member)) return interaction.respond([]);
    const q = String(interaction.options.getFocused() ?? '').trim().toLowerCase();
    return interaction.respond(
      featured
        .list(interaction.guild.id)
        .filter((s) => !q || s.name.toLowerCase().includes(q) || s.address.includes(q) || s.id.includes(q))
        .slice(0, 25)
        .map((s) => ({ name: truncate(`${s.name} · ${s.address}`, 100), value: s.id })),
    );
  },

  async execute(interaction) {
    if (!isShopManager(interaction.member)) return replyError(interaction, 'Tylko administratorzy i sprzedawcy mogą zarządzać polecanymi serwerami.');
    const o = interaction.options;
    const sub = o.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'list') return reply(interaction, { embeds: [listEmbed(guild.id)] });

    if (sub === 'add') {
      const server = featured.add(guild.id, {
        name: o.getString('name'),
        address: o.getString('address'),
        description: o.getString('description'),
        tags: o.getString('tags'),
        icon: o.getString('icon'),
        mc: o.getString('mc'),
        loader: o.getString('loader'),
        pack: o.getString('pack'),
        addedBy: interaction.user.id,
      });
      const card = embed(COLORS.success)
        .setTitle(`🌍 ${truncate(server.name, 60)} jest na liście polecanych`)
        .setDescription('Hammer Launcher pokaże ten serwer w ciągu kilku minut – lista serwerów jest zapamiętywana najwyżej na 5 minut.')
        .addFields(detailFields(server));
      if (server.icon) card.setThumbnail(server.icon);
      await reply(interaction, { embeds: [card] });
      return sendLog(guild, { embeds: [logEmbed(COLORS.brand, '🌍 Polecany serwer dodany', interaction.user).setDescription(`Dodany przez ${interaction.user}: **${truncate(server.name, 60)}** — \`${server.address}\``)] });
    }

    // The option holds the entry's ID (from the suggestions) – a typed name or address works too.
    const wanted = String(o.getString('server') ?? '').trim().toLowerCase();
    const match = featured.list(guild.id).find((s) => s.id === wanted) ?? featured.list(guild.id).find((s) => s.address === wanted || s.name.toLowerCase() === wanted);
    if (!match) throw new UserError(`Nie ma takiego serwera na liście polecanych. Wybierz go z podpowiedzi albo sprawdź \`${slash('featured list')}\`.`);
    featured.remove(guild.id, match.id);
    await reply(interaction, `Usunięto **${truncate(match.name, 60)}** (\`${match.address}\`) z polecanych serwerów. Z launchera zniknie w ciągu kilku minut.`);
    return sendLog(guild, { embeds: [logEmbed(COLORS.danger, '🗑️ Polecany serwer usunięty', interaction.user).setDescription(`Usunięty przez ${interaction.user}: **${truncate(match.name, 60)}** — \`${match.address}\``)] });
  },
};
