'use strict';

/**
 * What /build posts on the Hammer Launcher server (BOT_PROFILE=launcher) – the cards of its own channels. content.js
 * asks here first; keys this file does not know (verify, rules, roles, tickets, leaderboard) are posted the way the
 * shop server posts them, with the launcher's texts from config.launcher.json and regulamin-launcher.md.
 */

const { ButtonStyle } = require('discord.js');
const config = require('../lib/config');
const { env } = require('../env');
const { ce, COLORS } = require('../lib/theme');
const { ts } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, header, v2 } = require('../lib/v2');
const { slash } = require('../lib/commandsPl');

const card = (c) => ({ payload: v2(c) });
const buttons = (...list) => row(...list.filter(Boolean));
const site = () => (env.web.publicUrl ? env.web.publicUrl : null);
const open = (x, type, label, icon, style = ButtonStyle.Secondary) => (config.getType(type) ? btn(`ticket:open:${type}`, label, ce(x.guild, icon), style) : null);

function welcome(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('logo')} Witamy w ${x.brand}\n${config.brand.tagline ?? ''}\n\n` +
      `Pierwszy raz tutaj? Zweryfikuj się na ${x.ch('verify')}, przeczytaj ${x.ch('rules')} i pobierz launcher na ${x.ch('launcher')}. ` +
      'Każdego nowego członka witamy właśnie tutaj. 🧡',
    x.icon,
  );
  c.addActionRowComponents(buttons(x.link('launcher', 'Pobierz launcher', 'download'), x.link('tickets', 'Pomoc', 'ticket'), x.link('plus', 'Hammer+', 'star')));
  return card(c);
}

function information(x, build) {
  const about = container(COLORS.brand);
  header(about, `# ${x.E('logo')} O ${x.brand}\n${config.brand.about ?? ''}`, x.icon);
  about.addSeparatorComponents(divider());
  about.addTextDisplayComponents(
    text(
      `### ${x.E('sparkles')} Co potrafi launcher?\n` +
        `> ${x.E('folder')} **Wszystko w jednym miejscu** – instancje, światy, serwery, skórki i zrzuty ekranu\n` +
        `> ${x.E('flame')} **FPS boost jednym kliknięciem** – pamięć, Java i mody wydajnościowe dobrane pod Twój komputer\n` +
        `> ${x.E('box')} **Ponad tysiąc modów** – mody, paczki, tekstury i shadery z Modrinth\n` +
        `> ${x.E('sparkles')} **Hammer Client w grze** – własne menu, edytor HUD, waypointy i zoom\n` +
        `> ${x.E('refresh')} **Aktualizuje się sam** – nowe wersje ogłaszamy na ${x.ch('updates')}\n` +
        '-# Wersja beta · za darmo · Windows 10 i 11 · potrzebny oryginalny Minecraft: Java Edition',
    ),
  );
  const aboutButtons = [x.link('launcher', 'Pobierz launcher', 'download'), x.link('plus', 'Hammer+', 'star')];
  if (build?.invite) aboutButtons.push(linkBtn(build.invite, 'Zaproś znajomych', ce(x.guild, 'share')));
  about.addActionRowComponents(buttons(...aboutButtons));

  const guide = container(COLORS.brand);
  guide.addTextDisplayComponents(text(`# ${x.E('hash')} Przewodnik po kanałach\nGdzie co znajdziesz na **${x.brand}**.`));
  guide.addSeparatorComponents(divider());
  guide.addTextDisplayComponents(
    text(
      `### ${x.E('home')} Zacznij tutaj\n` +
        `> ${x.ch('rules')} – zasady serwera i launchera\n> ${x.ch('announcements')} – oficjalne ogłoszenia\n> ${x.ch('roles')} – role i powiadomienia\n` +
        `### ${x.E('rocket')} Launcher\n` +
        `> ${x.ch('launcher')} – pobierz launcher\n> ${x.ch('updates')} – nowe wersje i lista zmian\n> ${x.ch('news')} – aktualności, które widać też w launcherze\n` +
        `> ${x.ch('plus')} – Hammer+: co daje i jak go zdobyć\n> ${x.ch('faq')} – szybkie odpowiedzi\n` +
        `### ${x.E('ticket')} Pomoc\n` +
        `> ${x.ch('tickets')} – otwórz ticket\n> ${x.ch('bugs')} – jak zgłosić błąd\n> ${x.ch('suggestions')} – Twoje pomysły na nowe funkcje\n` +
        `### ${x.E('chat')} Społeczność\n` +
        `> ${x.ch('chat')} · ${x.ch('screenshots')} · ${x.ch('servers')} · ${x.ch('giveaways')} · ${x.ch('leaderboard')}`,
    ),
  );

  const team = container(COLORS.brand);
  team.addTextDisplayComponents(
    text(
      `# ${x.E('shield')} Nasz zespół\nLudzie, dzięki którym **${x.brand}** działa.\n` +
        `> ${x.role('founder')} · ${x.role('coowner')}\n> ${x.role('developer')} – tworzy launcher i Hammer Client\n> ${x.role('manager')} · ${x.role('admin')}\n` +
        `> ${x.role('moderator')} · ${x.role('support')} · ${x.role('trialSupport')}\n> ${x.role('tester')} – testuje nowe wersje przed wydaniem`,
    ),
  );
  team.addSeparatorComponents(divider());
  team.addTextDisplayComponents(
    text(`-# ${x.E('warning')} Nasz zespół **nigdy** nie prosi o hasło, kod z e-maila ani dane karty i nie wysyła „launchera” w wiadomości prywatnej. Nie wiesz, czy ktoś jest z zespołu? Sprawdź jego role.`),
  );

  const contact = container(COLORS.brand);
  contact.addTextDisplayComponents(
    text(
      `# ${x.E('mail')} Kontakt\nNajszybciej skontaktujesz się z nami przez ticket na ${x.ch('tickets')} – prywatny kanał z naszym zespołem.\n` +
        `> ${x.E('question')} **Launcher nie działa?** → ticket **Pomoc z launcherem**\n> ${x.E('warning')} **Znalazłeś błąd?** → ticket **Zgłoś błąd** (jak: ${x.ch('bugs')})\n` +
        `> ${x.E('star')} **Pytanie o Hammer+?** → ticket **Hammer+ i płatności**\n` +
        `-# ${config.shop.supportHours ? `Godziny pracy: ${config.shop.supportHours}` : ''}`,
    ),
  );
  contact.addActionRowComponents(buttons(open(x, 'support', 'Napisz do pomocy', 'mail', ButtonStyle.Primary), x.link('tickets', 'Wszystkie rodzaje ticketów', 'ticket')));

  const hiring = container(COLORS.brand);
  hiring.addTextDisplayComponents(
    text(
      `# ${x.E('person')} Dołącz do zespołu\nSzukamy osób, które chcą pomagać graczom i rozwijać launcher: support, moderacja, testy.\n` +
        '> ✅ 16+ i dobry polski\n> ✅ Kilka godzin w tygodniu\n> ✅ Cierpliwość, uczciwość i chęć pomocy\n' +
        '-# Złóż podanie przyciskiem poniżej – czytamy każde zgłoszenie.',
    ),
  );
  hiring.addActionRowComponents(buttons(open(x, 'apply', 'Złóż podanie', 'pencil', ButtonStyle.Success)));

  return [{ banner: 'discord' }, card(about), { banner: 'channels' }, card(guide), { banner: 'staff' }, card(team), { banner: 'contact' }, card(contact), { banner: 'join-us' }, card(hiring)];
}

function announcements(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('sparkles')} ${x.brand} już działa!\nWitamy w domu naszego launchera. 🧡\n\n` +
      `> ${x.E('download')} Pobierz launcher na ${x.ch('launcher')}\n> ${x.E('rocket')} Nowe wersje ogłaszamy na ${x.ch('updates')}\n` +
      `> ${x.E('bell')} Odbierz role z powiadomieniami na ${x.ch('roles')}, żeby nie przegapić żadnej nowości`,
    x.icon,
  );
  c.addTextDisplayComponents(text(`-# Zespół ${x.brand} · ${ts(Date.now(), 'D')}`));
  return card(c);
}

function updates(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('rocket')} Aktualizacje\nTutaj ogłaszamy **każdą nową wersję** ${x.brand} razem z listą zmian.\n` +
        `> ${x.E('refresh')} Zainstalowany launcher aktualizuje się sam – niczego nie musisz pobierać ponownie\n` +
        `> ${x.E('download')} Pierwsza instalacja: ${x.ch('launcher')}\n` +
        `-# Chcesz ping przy każdej wersji? Odbierz rolę ${x.role('pingUpdates', 'Aktualizacje')} na ${x.ch('roles')}.`,
    ),
  );
  return card(c);
}

function news(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('bell')} Aktualności\nWiadomości od zespołu – **te same, które widzisz na ekranie głównym launchera**: wydarzenia, zmiany, zapowiedzi.\n` +
        `-# Nowe wersje launchera znajdziesz na ${x.ch('updates')}, a ważne ogłoszenia serwera na ${x.ch('announcements')}.`,
    ),
  );
  return card(c);
}

function plus(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('star')} Hammer+\nDodatek dla tych, którzy chcą **więcej wyglądu i wygody**. Nie daje żadnej przewagi w grze – a wszystko, co w launcherze jest darmowe, zostaje darmowe.`,
    x.icon,
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${x.E('sparkles')} Co dostajesz\n` +
        `> ${x.E('brush')} Własne kolory i tła launchera\n> ${x.E('camera')} Własne tło menu w grze\n> ${x.E('crown')} Peleryny Hammer+ – widzą je gracze z Hammer Client\n` +
        `> ${x.E('folder')} Automatyczne kopie światów\n> ${x.E('cloud')} Chmura: ustawienia launchera na każdym komputerze\n> ${x.E('person')} Biblioteka na 200 skórek i zestawy skórek`,
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${x.E('card')} Jak go zdobyć\n` +
        `> **1.** Wejdź na stronę launchera i wybierz plan Hammer+${site() ? '' : ' (adres podamy w ogłoszeniach)'}\n` +
        '> **2.** Zaloguj się przez Discorda i wpisz swój **nick w Minecraft**\n' +
        '> **3.** Zapłać kartą (Stripe) – kod pojawi się od razu na stronie i w wiadomości prywatnej od bota\n' +
        '> **4.** W launcherze: **Hammer+ → „Mam kod”** → wklej kod\n' +
        `-# Kod działa na koncie Minecraft, dla którego go kupisz. Coś poszło nie tak? Ticket **Hammer+ i płatności** na ${x.ch('tickets')}.`,
    ),
  );
  c.addActionRowComponents(buttons(site() ? linkBtn(`${site()}/#plus`, 'Kup Hammer+', ce(x.guild, 'star')) : null, open(x, 'plus', 'Pomoc z Hammer+', 'ticket')));
  return card(c);
}

function faq(x) {
  const qa = [
    ['Skąd pobrać launcher?', `Tylko z naszej strony – przycisk jest na ${x.ch('launcher')}. Nie uruchamiaj „launchera”, którego ktoś wysłał Ci prywatnie.`],
    ['Windows ostrzega przy instalacji. Czy to bezpieczne?', 'Tak. W wersji beta instalator nie ma jeszcze płatnego certyfikatu wydawcy, dlatego SmartScreen pokazuje okno „System Windows ochronił ten komputer”. Kliknij **Więcej informacji → Uruchom mimo to**.'],
    ['Czy potrzebuję oryginalnego Minecrafta?', 'Tak – Minecraft: Java Edition na koncie Microsoft. Logujesz się oficjalną stroną Microsoftu w oknie launchera. Kont nieoryginalnych nie obsługujemy.'],
    ['Jak działają aktualizacje?', `Launcher sam pobiera nową wersję w tle i instaluje ją, gdy go zamkniesz. O każdej wersji piszemy na ${x.ch('updates')}.`],
    ['Gra nie startuje albo się wysypuje', `Otwórz w launcherze **Konsola → Udostępnij log** i wyślij nam link w tickecie **Pomoc z launcherem** na ${x.ch('tickets')}. Podaj wersję Minecrafta i listę modów.`],
    ['Jak zwiększyć FPS?', 'Zakładka **Optymalizacja** → **Zoptymalizuj wszystko**. Launcher dobierze pamięć, ustawienia Javy i mody wydajnościowe. Wynik sprawdzisz **Testem FPS**.'],
    ['Co daje Hammer+ i jak go aktywować?', `Wygląd i wygodę – bez przewagi w grze. Wszystko opisaliśmy na ${x.ch('plus')}. Kod wpisujesz w launcherze: **Hammer+ → „Mam kod”**.`],
    ['Mam pomysł na nową funkcję', `Super – napisz go na ${x.ch('suggestions')}. Czytamy wszystkie.`],
    ['Czy mogę dołączyć do zespołu?', `Jasne – otwórz ticket **Rekrutacja** na ${x.ch('tickets')}.`],
  ];
  const c = container(COLORS.brand);
  header(c, `# ${x.E('question')} Najczęściej zadawane pytania\nNie ma tu Twojego pytania? Otwórz ticket na ${x.ch('tickets')}.`, x.icon);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(qa.map(([q, a]) => `**${x.E('arrow_right')} ${q}**\n> ${a}`).join('\n\n')));
  return card(c);
}

function bugs(x) {
  const c = container(COLORS.brand);
  header(c, `# ${x.E('warning')} Zgłoś błąd\nLauncher jest w wersji beta – każde dobre zgłoszenie to szybsza poprawka. Dziękujemy, że pomagasz! 🧡`, x.icon);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      '### Co nam najbardziej pomaga\n' +
        '> **1.** Wersja launchera (lewy dolny róg okna) oraz wersja Minecrafta i loader instancji\n' +
        '> **2.** Co robisz **krok po kroku** i co się wtedy dzieje\n' +
        '> **3.** Log: w launcherze **Konsola → Udostępnij log** – wklej link, który dostaniesz\n' +
        '> **4.** Zrzut ekranu, jeśli coś źle wygląda\n' +
        `-# Lukę w bezpieczeństwie zgłoś **tylko** ticketem – nigdy publicznie. Pomysły na nowe funkcje: ${x.ch('suggestions')}.`,
    ),
  );
  c.addActionRowComponents(buttons(open(x, 'bug', 'Zgłoś błąd', 'warning', ButtonStyle.Primary), open(x, 'support', 'Pomoc z launcherem', 'question')));
  return card(c);
}

function suggestions(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('sparkles')} Propozycje\nCzego brakuje Ci w launcherze albo w Hammer Client? Napisz tutaj.\n` +
        '> 💡 Jeden pomysł = jedna wiadomość – łatwiej o nim rozmawiać\n> 👍 Podoba Ci się czyjś pomysł? Zostaw reakcję\n> 🔍 Sprawdź, czy ktoś już tego nie zaproponował\n' +
        `-# Błędy zgłaszaj ticketem (${x.ch('bugs')}). Czytamy wszystko, ale nie każdy pomysł da się zrealizować.`,
    ),
  );
  return card(c);
}

function screenshots(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('camera')} Zrzuty ekranu\nPochwal się swoim HUD-em, buildem, shaderami albo ustawieniami launchera.\n` +
        '> 📸 W launcherze: **Galeria** → wybierz zrzut → **Kopiuj** albo **Udostępnij link**\n' +
        '-# Tylko własne zrzuty z gry i launchera. Bez spamu i treści niezgodnych z regulaminem.',
    ),
  );
  return card(c);
}

function servers(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('group')} Serwery i ekipa\nSzukasz ludzi do gry albo serwera? Napisz, w co grasz i kogo szukasz.\n` +
        '> 🔗 Zaproś znajomych jednym linkiem: w launcherze **Serwery → Zaproś** – launcher sam przygotuje im wersję gry i mody\n' +
        '> ⭐ Serwery polecane przez nas znajdziesz w launcherze w zakładce **Serwery**\n' +
        `-# Reklamy serwerów Discord i sklepów są zabronione (${x.ch('rules')}).`,
    ),
  );
  return card(c);
}

function giveaways(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('gift')} Giveawaye\nRegularnie rozdajemy tutaj Hammer+ i inne nagrody.\n` +
        '> 🎉 Kliknij **Dołącz** pod giveawayem, żeby wziąć udział\n> 🏆 Zwycięzcy są losowani automatycznie, gdy skończy się czas\n' +
        '> 🎁 Zwycięzcy odbierają nagrodę przez ticket **Odbierz nagrodę** w ciągu 48 godzin\n' +
        `-# Chcesz ping przy każdym giveawayu? Odbierz rolę ${x.role('pingGiveaways', 'Giveawaye')} na ${x.ch('roles')}.`,
    ),
  );
  return card(c);
}

function boosters(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('diamond')} Boosterzy serwera\nBoost dla ${x.brand} odblokowuje lepszy serwer dla wszystkich – dziękujemy! 🧡\n` +
        `### ${x.E('gift')} Nagrody dla boosterów\n` +
        '> 💎 Specjalna rola na górze listy członków\n> 🧡 Nasza dozgonna wdzięczność\n' +
        '-# Ogłoszenia o boostach pojawiają się na tym kanale.',
    ),
  );
  return card(c);
}

function staff(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('shield')} Poradnik zespołu\nWszystko, czego potrzebujesz, żeby prowadzić **${x.brand}**.\n` +
        `### ${x.E('ticket')} Tickety\n> Przejmij ticket, zanim odpowiesz · gotowe odpowiedzi wysyłasz przez \`${slash('reply')}\` (prośba o log, o wersję, jak wpisać kod Hammer+…)\n` +
        '> Przy błędzie zawsze poproś o **wersję launchera, wersję Minecrafta i log** (Konsola → Udostępnij log)\n' +
        `> Transkrypcje trafiają na ${x.ch('transcripts')}, każda akcja na ${x.ch('ticketLogs')}\n` +
        `### ${x.E('star')} Hammer+\n> \`${slash('hammerplus grant')}\` – kod dla nicku (sprawdzany w Mojang) · \`${slash('hammerplus check')}\` – czyj jest kod i do kiedy działa · \`${slash('hammerplus list')}\`\n` +
        '> Kod kupiony na stronie przychodzi graczowi sam (strona + DM). Zły nick albo kod nie działa → sprawdź kod, w razie potrzeby wystaw nowy\n' +
        `### ${x.E('rocket')} Launcher i strona\n> Panel admina na stronie${site() ? ` (${site()}/admin)` : ''}: **aktualności** i **komunikat** widoczne w launcherze, **wersje launchera**, cennik Hammer+, polecane serwery\n` +
        `> Nowe wersje i aktualności z panelu pojawiają się same na ${x.ch('updates')} i ${x.ch('news')} · \`${slash('launcher')}\` pokazuje aktualną wersję · \`${slash('featured add')}\` – polecane serwery\n` +
        `### ${x.E('gift')} Społeczność\n> \`${slash('giveaway start')}\` · \`${slash('giveaway end')}\` · \`${slash('giveaway reroll')}\` · \`${slash('announce')}\` – ładne ogłoszenie z opcjonalnym banerem i pingiem\n` +
        `### ${x.E('refresh')} Zmiana tekstów\n> Edytuj \`config.launcher.json\` albo \`regulamin-launcher.md\`, uruchom bota ponownie i użyj \`${slash('build')} tylko:panels\` – każda karta zaktualizuje się na miejscu\n` +
        `### ${x.E('warning')} Złote zasady\n> Nigdy nie proś o hasła ani dane karty · nie wysyłaj plików na DM · zachowuj kulturę · w razie wątpliwości zapytaj kogoś z rolą ${x.role('manager', 'Manager')}`,
    ),
  );
  return card(c);
}

/**
 * The messages for one "post" key on the Hammer Launcher server – null for a key that is posted like on the shop
 * server. x: content.js's context (channels, roles, emojis); build: the server's build record.
 */
function postsFor(key, x, build) {
  switch (key) {
    case 'welcome':
      return [{ banner: 'welcome' }, welcome(x)];
    case 'information':
      return information(x, build);
    case 'announcements':
      return [{ banner: 'announcements' }, announcements(x)];
    case 'launcher':
      return [{ banner: 'launcher' }, card(require('../features/launcherinfo').card(x.guild))];
    case 'updates':
      return [{ banner: 'updates' }, updates(x)];
    case 'news':
      return [{ banner: 'whats-new' }, news(x)];
    case 'plus':
      return [{ banner: 'plus' }, plus(x)];
    case 'faq':
      return [{ banner: 'faq' }, faq(x)];
    case 'bugs':
      return [{ banner: 'bugs' }, bugs(x)];
    case 'suggestions':
      return [{ banner: 'suggestions' }, suggestions(x)];
    case 'screenshots':
      return [{ banner: 'media' }, screenshots(x)];
    case 'servers':
      return [{ banner: 'servers' }, servers(x)];
    case 'giveaways':
      return [{ banner: 'giveaways' }, giveaways(x)];
    case 'boosters':
      return [{ banner: 'boosters' }, boosters(x)];
    case 'staff':
      return [{ banner: 'staff' }, staff(x)];
    default:
      return null;
  }
}

module.exports = { postsFor };
