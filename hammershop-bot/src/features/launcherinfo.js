'use strict';

/**
 * Hammer Launcher on Discord: the card of the #launcher channel (/build posts it under the banner) and of /launcher.
 * The download and Hammer+ buttons lead to the website's launcher page (PUBLIC_URL/launcher – src/web/server.js); the
 * admin panel's news and new versions are posted into the same channel (src/features/website.js → announce).
 */

const { env } = require('../env');
const db = require('../lib/db');
const { COLORS, e, ce } = require('../lib/theme');
const { container, text, divider, header, linkBtn, row } = require('../lib/v2');
const { truncate, ts } = require('../lib/utils');

const profile = require('../lib/profile');

/** The launcher's page of the website: its own page on the shop's site, the front page on the launcher's own site. */
const page = () => (env.web.publicUrl ? `${env.web.publicUrl}${profile.launcher ? '/' : '/launcher'}` : null);
const channel = (guild, key, fallback) => (db.channelId(guild.id, key) ? `<#${db.channelId(guild.id, key)}>` : fallback);

/** The newest published installer – null when the website is off or nothing is published yet. */
function currentRelease() {
  if (!env.web.enabled) return null;
  return require('../web/releases').publicInfo(env.web.publicUrl);
}

/**
 * The card. live: also say which version is out right now and what is new in it (for /launcher – the channel's card
 * stays the same between versions, the versions themselves are announced under it).
 */
function card(guild, { live = false } = {}) {
  const E = (name) => e(guild, name);
  const c = container(COLORS.brand);
  header(c, `# ${E('rocket')} Hammer Launcher\nNasz własny, autorski launcher Minecrafta – **wersja beta**. Wszystko w jednym miejscu:`, guild.iconURL?.({ size: 256 }) ?? null);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `> ${E('folder')} **Instancje** – różne wersje gry, światy, serwery i skórki bez szukania po folderach\n` +
        `> ${E('flame')} **FPS boost jednym kliknięciem** – pamięć, Java i mody wydajnościowe dobrane pod Twój komputer\n` +
        `> ${E('box')} **Ponad tysiąc modów** z Modrinth – zależności instalują się same\n` +
        `> ${E('sparkles')} **Hammer Client w grze** – własne menu, edytor HUD, waypointy i zoom\n` +
        `> ${E('refresh')} **Aktualizuje się sam** – nowości i nowe wersje ogłaszamy na ${channel(guild, 'updates', channel(guild, 'launcher', 'tym serwerze'))}`,
    ),
  );
  const release = live ? currentRelease() : null;
  if (release) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(`${E('download')} **Aktualna wersja: ${release.version}** (beta) · ${ts(Date.parse(release.date), 'D')}${release.notes ? `\n${truncate(release.notes, 600)}` : ''}`));
  }
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `${E('star')} **Hammer+** – dodatek dla chętnych: własne kolory i tła, peleryny, kopie światów i chmura. Sam wygląd i wygoda, żadnej przewagi w grze.\n` +
        `-# Potrzebujesz oryginalnego Minecrafta: Java Edition (konto Microsoft). Coś nie działa? Napisz na ${channel(guild, 'tickets', 'kanale z ticketami')}.`,
    ),
  );
  if (page()) c.addActionRowComponents(row(linkBtn(page(), release || !live ? 'Pobierz launcher' : 'Strona launchera', ce(guild, 'download')), linkBtn(`${page()}#plus`, 'Hammer+', ce(guild, 'star'))));
  else if (live) c.addTextDisplayComponents(text('-# Strona launchera nie jest jeszcze uruchomiona – link do pobrania pojawi się tutaj.'));
  return c;
}

module.exports = { card, currentRelease, page };
