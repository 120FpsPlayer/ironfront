'use strict';

const { SlashCommandBuilder, InteractionContextType } = require('discord.js');
const config = require('../lib/config');
const invites = require('../features/invites');
const { COLORS } = require('../lib/theme');
const { embed, reply, isStaff, isAdmin, truncate } = require('../lib/utils');
const { isMod, isShopManager } = require('../lib/permissions');
const { MAP, slash } = require('../lib/commandsPl');
const db = require('../lib/db');

/** /help on the Hammer Launcher server: no shop there – the launcher, tickets, Hammer+ and the community. */
function launcherHelp(interaction, cmd) {
  const member = interaction.member;
  const guild = interaction.guild;
  const channel = (key, name) => (db.channelId(guild.id, key) ? `<#${db.channelId(guild.id, key)}>` : `#${name}`);
  const only = (value) => `\`${slash('build')} ${MAP.build.options.only.name}:${value}\``;
  const e = embed(COLORS.brand)
    .setTitle(`📖 ${config.brand.name} – pomoc`)
    .setDescription(`Launcher pobierzesz na ${channel('launcher', 'pobierz')}, a pomoc dostaniesz przez **panel ticketów** na ${channel('tickets', 'tickety')}.`)
    .addFields({
      name: '👤 Wszyscy',
      value: [
        `${cmd('launcher')} – aktualna wersja launchera, lista zmian i link do pobrania`,
        config.invites.enabled === false ? null : `${cmd('invites stats', 'invites top')} – Twoje zaproszenia i ranking zapraszających`,
        `${cmd('ticket info', 'ticket close')} – w Twoim tickecie`,
        '🔔 **Wezwij pomoc** – przycisk w Twoim tickecie, gdy czekasz już dłuższą chwilę',
        `🐛 Błąd w launcherze? Jak go zgłosić: ${channel('bugs', 'zgłoś-błąd')} · 💡 pomysły: ${channel('suggestions', 'propozycje')}`,
      ]
        .filter(Boolean)
        .join('\n'),
    });
  if (isStaff(member)) {
    e.addFields({
      name: '🎧 Zespół',
      value: [
        cmd('ticket claim', 'ticket unclaim', 'ticket add', 'ticket remove'),
        cmd('ticket priority', 'ticket move', 'ticket rename', 'ticket request-close'),
        `${cmd('reply')} – gotowe odpowiedzi (prośba o log, o wersję, jak wpisać kod Hammer+) · ${cmd('blacklist', 'stats')}`,
      ].join('\n'),
    });
  }
  if (isShopManager(member)) {
    e.addFields({
      name: '🔨 Hammer+ i launcher',
      value: [
        `${cmd('hammerplus grant', 'hammerplus check', 'hammerplus list', 'hammerplus key')} – kody Hammer+ przypisane do konta Minecraft`,
        `${cmd('featured add', 'featured remove', 'featured list')} – polecane serwery w launcherze`,
        'Aktualności, komunikat i nowe wersje launchera publikujesz w **panelu admina** na stronie.',
      ].join('\n'),
    });
  }
  if (isMod(member)) {
    e.addFields({
      name: '🎉 Społeczność i bezpieczeństwo',
      value: [`${cmd('giveaway start', 'giveaway end', 'giveaway reroll', 'giveaway list')} · ${cmd('announce')} – ogłoszenie z banerem i pingiem`, `${cmd('lockdown', 'unlock')} – blokada serwera podczas raidu`].join('\n'),
    });
  }
  if (isAdmin(member)) {
    e.addFields({
      name: '🛡️ Administracja',
      value: [
        `${cmd('build')} – zbuduj cały serwer · ${only('update')} – po aktualizacji bota`,
        `${cmd('ticket-types off', 'ticket-types on', 'ticket-types list')} – wyłącz kategorię ticketów na jakiś czas (np. rekrutację) i włącz ją z powrotem`,
        [only('emojis'), only('panels'), only('names')].join(' · '),
        `${cmd('backup')} – kopia zapasowa danych bota · ${cmd('panel')} – wyślij panel ponownie`,
        cmd('setup show', 'setup set', 'setup role-add'),
      ].join('\n'),
    });
  }
  return reply(interaction, { embeds: [e] });
}

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription(truncate(`All ${config.brand.name} bot commands you can use`, 100)).setContexts(InteractionContextType.Guild),

  async execute(interaction) {
    const member = interaction.member;
    const cmd = (...paths) => paths.map((path) => `\`${slash(path)}\``).join(' · ');
    if (require('../lib/profile').launcher) return launcherHelp(interaction, cmd);
    const opt = (command, sub, name) => `\`${MAP[command]?.options?.[sub]?.options?.[name]?.name ?? name}\``;
    const only = (value) => `\`${slash('build')} ${MAP.build.options.only.name}:${value}\``;
    const channel = (key, name) => {
      const id = db.channelId(interaction.guild.id, key);
      return id ? `<#${id}>` : `#${name}`;
    };
    const shopId = db.channelId(interaction.guild.id, 'shop');
    // Only what is turned on in config.json.
    const rewards = config.promos.enabled !== false && invites.levels().length > 0;
    const inviteLine = config.invites.enabled === false ? null : `${cmd('invites stats', 'invites top')} – Twoje zaproszenia${rewards ? ' i nagrody, które możesz zdobyć' : ' i ranking zapraszających'}`;
    const e = embed(COLORS.brand)
      .setTitle(`📖 ${config.brand.name} – pomoc`)
      .setDescription(`Kupuj przyciskami **Kup** ${shopId ? `na <#${shopId}>` : 'na kanale sklepu'}, a pomoc dostaniesz przez **panel ticketów**.`)
      .addFields({
        name: '👤 Wszyscy',
        value: [
          `${cmd('vouch')} – wystaw opinię po zakupie`,
          inviteLine,
          `${cmd('ticket info', 'ticket close')} – w Twoim tickecie`,
          '🔔 **Wezwij pomoc** – przycisk w Twoim tickecie, gdy czekasz już dłuższą chwilę',
          config.orders.paymentProofs === false ? null : '💳 **Zapłać** – przycisk w tickecie zamówienia: wyślij PIN PaysafeCard, ID transakcji krypto albo zrzut ekranu',
          '🧾 **Moje zamówienia** – przycisk w sklepie: Twoje otwarte zamówienia, ich status i wszystkie potwierdzenia zakupu',
        ]
          .filter(Boolean)
          .join('\n'),
      });
    if (isStaff(member)) {
      e.addFields({
        name: '🎧 Zespół',
        value: [
          cmd('ticket claim', 'ticket unclaim', 'ticket add', 'ticket remove'),
          cmd('ticket priority', 'ticket move', 'ticket rename', 'ticket request-close'),
          `${cmd('ticket complete')} – oznacz zakup jako dostarczony (zapis sprzedaży, potwierdzenie zakupu, realizacja, rola Klient)`,
          `⚙️ menu ticketu → **Status: Opłacone / W realizacji**${config.orders.statusDms === false ? '' : ' – klient dostaje DM'}${config.staffReminders.enabled === false ? '' : ' · przypomnienia o nieprzejętych ticketach trafiają na czat zespołu'}`,
          `${cmd('customer view', 'customer note add')} – profile klientów i prywatne notatki`,
          `${cmd('reply')} – gotowe odpowiedzi · ${cmd('blacklist', 'stats')}`,
        ].join('\n'),
      });
    }
    if (isShopManager(member)) {
      e.addFields({
        name: '🛒 Sklep',
        value: [
          `${cmd('disable', 'enable')} – wyłącz na chwilę metodę płatności (np. na czas naprawy PayPala) i włącz ją z powrotem`,
          `${cmd('product add', 'product edit', 'product stock', 'product variants', 'product delivery', 'product remove', 'product list')} – kategorie, obrazki, warianty, stan, pliki dla kupującego`,
          `${cmd('sale start', 'sale stop', 'sale list')} – promocje błyskawiczne z odliczaniem w sklepie`,
          `${cmd('promo create', 'promo list', 'promo info', 'promo delete')} – kody rabatowe`,
          `${cmd('shop open', 'shop close', 'shop auto', 'shop status')} – sklep otwarty / zamknięty`,
          `${cmd('sales')} – przychód, zamówienia, najlepsze produkty i sprzedawcy`,
        ].join('\n'),
      });
      e.addFields({
        name: '🔨 Hammer+ i launcher',
        value: [
          `${cmd('hammerplus grant', 'hammerplus check', 'hammerplus list', 'hammerplus key')} – kody Hammer+ do Hammer Launchera, przypisane do konta Minecraft`,
          `${cmd('featured add', 'featured remove', 'featured list')} – polecane serwery w launcherze`,
        ].join('\n'),
      });
    }
    if (isMod(member)) {
      e.addFields({
        name: '🎉 Społeczność',
        value:
          `${cmd('giveaway start', 'giveaway end', 'giveaway reroll', 'giveaway list')} – ${opt('giveaway', 'start', 'required_role')} / ${opt('giveaway', 'start', 'buyers_only')} / ${opt('giveaway', 'start', 'min_invites')} ograniczają, kto może dołączyć (sprawdzane ponownie przy losowaniu)\n` +
          `${cmd('announce')} – ładne ogłoszenie z banerem i pingiem`,
      });
      e.addFields({
        name: '🚨 Bezpieczeństwo',
        value: `${cmd('lockdown', 'unlock')} – blokada serwera podczas raidu${config.security.impersonationAlerts ? `\nKonta podszywające się pod zespół są automatycznie zgłaszane na ${channel('automodLogs', 'logi-automod')}` : ''}`,
      });
    }
    if (isAdmin(member)) {
      e.addFields({
        name: '🛡️ Administracja',
        value: [
          `${cmd('build')} – zbuduj cały serwer`,
          `${only('update')} – po aktualizacji bota: nowe kanały i role, nazwy, panele`,
          [only('emojis'), only('panels'), only('names')].join(' · '),
          `${cmd('backup')} – zrób teraz kopię zapasową danych bota${config.backups.enabled ? ` (robi się też automatycznie, na ${channel('backups', 'kopie-zapasowe')})` : ''}`,
          `${cmd('panel')} – wyślij panel ponownie`,
          cmd('setup show', 'setup set', 'setup role-add'),
        ].join('\n'),
      });
    }
    return reply(interaction, { embeds: [e] });
  },
};
