'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ButtonStyle } = require('discord.js');
const config = require('../lib/config');
const paymentState = require('../lib/paymentState');
const db = require('../lib/db');
const { e, ce, COLORS } = require('../lib/theme');
const { ts } = require('../lib/utils');
const { container, text, divider, btn, linkBtn, row, header, v2, channelUrl } = require('../lib/v2');
const { verifyPanel } = require('../features/verification');
const { slash } = require('../lib/commandsPl');
const { rolesPanels } = require('../features/selfroles');
const { CATEGORIES, ROLES } = require('./layout');

/**
 * Everything /build posts into the channels. Each "post" key returns a list of messages:
 *   { banner: 'shop' }            → the banner image
 *   { panel: 'shop' }             → a live panel the bot keeps up to date
 *   { payload }                   → a normal Components V2 card
 */

/** Polish channel and role names from layout.js ("📦 jak-kupić" → "jak-kupić") – used when the real one is missing. */
const CHANNEL_NAMES = new Map(CATEGORIES.flatMap((cat) => cat.channels.map((c) => [c.key, c.name.replace(/^\S+\s+/, '')])));
const ROLE_NAMES = new Map(ROLES.map((r) => [r.key, r.name.replace(/^\S+\s+/, '')]));

function context(guild) {
  const ch = (key, fallback = `#${CHANNEL_NAMES.get(key) ?? key}`) => (db.channelId(guild.id, key) ? `<#${db.channelId(guild.id, key)}>` : fallback);
  const role = (key, fallback) => (db.roleId(guild.id, key) ? `<@&${db.roleId(guild.id, key)}>` : fallback ?? ROLE_NAMES.get(key) ?? key);
  const url = (key) => (db.channelId(guild.id, key) ? channelUrl(guild.id, db.channelId(guild.id, key)) : null);
  const link = (key, label, icon) => (url(key) ? linkBtn(url(key), label, ce(guild, icon)) : null);
  const icon = guild.iconURL?.({ size: 256 }) ?? null;
  return { guild, ch, role, url, link, icon, E: (name) => e(guild, name), brand: config.brand.name };
}

const card = (c) => ({ payload: v2(c) });

/** config.shop.refundPolicy – "Dostarczonych produktów cyfrowych nie można zwrócić … Salda sklepu nie wypłacamy ani nie zwracamy." */
const refundPolicy = () =>
  config.shop.refundPolicy ??
  'Dostarczonych produktów cyfrowych nie można zwrócić – składając zamówienie, prosisz o natychmiastową dostawę. Salda sklepu nie wypłacamy ani nie zwracamy.';
const buttons = (...list) => row(...list.filter(Boolean));

// ───────────── WELCOME category ─────────────

/** config.json → rules.file (default regulamin.md, next to config.json) – the shop's terms, posted in #rules. */
const rulesFile = () => path.join(__dirname, '..', '..', config.rules?.file || 'regulamin.md');
const RULES_MAX_TEXT = 3800; // Discord allows 4000 characters of text per message – a little room to spare
const EMPTY = '\u0000';

/**
 * regulamin.md with its placeholders filled in: {brand}, {#channel}, {/command}, {e:emoji}, {paymentMethods}, {supportHours},
 * {seller}, {email}. A line whose placeholder is empty (e.g. no seller details yet) is left out; <!-- comments --> too.
 */
function fillRules(src, x) {
  const methods = config.shop.paymentMethods ?? [];
  const values = {
    brand: config.brand.name,
    seller: String(config.rules?.seller ?? '').trim(),
    email: String(config.rules?.email ?? '').trim(),
    supportHours: config.shop.supportHours ?? '',
    paymentMethods: methods.length ? `> ${methods.map((m) => `${x.E(m.emoji ?? 'card')} **${m.name}**`).join(' · ')}` : '',
  };
  return String(src)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\/([a-z][a-z -]*)\}/g, (_, path) => slash(path))
    .replace(/\{e:([a-z0-9_]+)\}/g, (_, name) => x.E(name))
    .replace(/\{#([A-Za-z0-9_]+)\}/g, (_, key) => x.ch(key))
    .replace(/\{([A-Za-z]+)\}/g, (all, key) => (key in values ? values[key] || EMPTY : all))
    .split('\n')
    .filter((line) => !line.includes(EMPTY))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Splits a long block at line breaks into pieces that fit one message. */
function splitLines(block, max) {
  const out = [];
  let cur = '';
  for (const line of block.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * The shop's terms from regulamin.md: the part before the first "## " is the title, every "## " starts a section.
 * As many cards as needed (Discord: 4000 characters of text per message). No file → the built-in rules (rulesCard).
 */
function rulesCards(x) {
  let src = '';
  try {
    src = fs.readFileSync(rulesFile(), 'utf8');
  } catch {
    return [rulesCard(x)];
  }
  const body = fillRules(src, x);
  if (!body) return [rulesCard(x)];
  const [intro, ...sections] = body.split(/^## /m);
  const cards = [];
  let c = container(COLORS.brand);
  let used = 0;
  if (intro.trim()) {
    header(c, intro.trim().slice(0, RULES_MAX_TEXT), x.icon);
    used = intro.trim().length;
  }
  for (const section of sections) {
    for (const part of splitLines(`### ${section.trim()}`, RULES_MAX_TEXT)) {
      if (used && used + part.length > RULES_MAX_TEXT) {
        cards.push(card(c));
        c = container(COLORS.brand);
        used = 0;
      }
      if (used) c.addSeparatorComponents(divider());
      c.addTextDisplayComponents(text(part));
      used += part.length;
    }
  }
  cards.push(card(c));
  return cards;
}

/** The built-in server rules – used when regulamin.md is missing. */
function rulesCard(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('shield')} ${x.brand} – Zasady serwera\nZostając na tym serwerze, akceptujesz poniższe zasady oraz ` +
      '[Warunki korzystania z usługi](https://discord.com/terms) i [Wytyczne dla społeczności](https://discord.com/guidelines) Discorda.',
    x.icon,
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `### ${x.E('heart')} 1 · Szacunek i zachowanie\n` +
        '> **1.1** Szanuj innych – zero nękania, mowy nienawiści, dyskryminacji i gróźb.\n' +
        '> **1.2** Zakaz spamu, floodu, nadużywania caps locka i masowego pingowania.\n' +
        '> **1.3** Na kanałach publicznych piszemy po polsku, żeby każdy mógł śledzić rozmowę.\n' +
        '> **1.4** Zakaz treści NSFW, drastycznych i innych niepokojących – wszędzie.\n' +
        '> **1.5** Zakaz reklamy i autopromocji, także w wiadomościach prywatnych do naszych członków.\n' +
        '> **1.6** Zakaz podszywania się pod zespół lub innych członków.\n' +
        '> **1.7** Zakaz przekleństw, obelg i mowy nienawiści – w każdym języku.\n' +
        '> **1.8** Zakaz wysyłania linków na czacie (GIF-y są w porządku).',
    ),
  );
  c.addTextDisplayComponents(
    text(
      `### ${x.E('cart')} 2 · Sklep i płatności\n` +
        `> **2.1** Każdy zakup odbywa się **wyłącznie w tickecie** (${x.ch('tickets')}) – nigdy w wiadomościach prywatnych.\n` +
        '> **2.2** Zespół **nigdy nie pisze do Ciebie pierwszy** w sprawie płatności. Każdy, kto to robi, jest oszustem – zgłoś go.\n' +
        '> **2.3** **Zwroty** – dostarczonych produktów cyfrowych nie można zwrócić, więc przed zakupem przeczytaj opis produktu. Salda sklepu nie zwracamy ani nie wypłacamy. Produkt nie działa? Otwórz ticket **Pomoc** – naprawimy go lub wymienimy, a jeśli się nie da, oddamy Ci pieniądze.\n' +
        '> **2.4** Obciążenie zwrotne (chargeback), spór o płatność lub próba oszustwa = permanentny ban i czarna lista.\n' +
        '> **2.5** Problemy z zamówieniem zgłaszaj przez ticket w ciągu **48 godzin**.\n' +
        '> **2.6** Odsprzedawanie i udostępnianie kupionych produktów bez zgody jest zabronione.',
    ),
  );
  c.addTextDisplayComponents(
    text(
      `### ${x.E('ticket')} 3 · Tickety i pomoc\n` +
        '> **3.1** Jedna sprawa = jeden ticket. Opisz ją jasno i dodaj zrzuty ekranu.\n' +
        '> **3.2** Nie pinguj zespołu – dostaje powiadomienie automatycznie.\n' +
        '> **3.3** Tickety bez odpowiedzi są zamykane automatycznie.\n' +
        '> **3.4** Nadużywanie ticketów (trollowanie, spam) kończy się blokadą ich tworzenia.',
    ),
  );
  c.addTextDisplayComponents(
    text(
      `### ${x.E('warning')} 4 · Kary\n` +
        '> Łamanie zasad kończy się ostrzeżeniem, wyciszeniem, wyrzuceniem lub banem – zależnie od wagi przewinienia. ' +
        'Decyzje zespołu są ostateczne – możesz się od nich odwołać przez ticket **Odwołanie od kary**.',
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`-# Ostatnia aktualizacja: ${ts(Date.now(), 'D')} · Zespół może zmienić te zasady w każdej chwili.`));
  return card(c);
}

function welcomeIntro(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('logo')} Witamy w ${x.brand}\n${config.brand.tagline ?? ''}\n\n` +
      `Pierwszy raz tutaj? Zweryfikuj się na ${x.ch('verify')}, przeczytaj ${x.ch('rules')} i zajrzyj na ${x.ch('shop')}. ` +
      'Każdego nowego członka witamy właśnie tutaj. 🧡',
    x.icon,
  );
  c.addActionRowComponents(buttons(x.link('shop', 'Sklep', 'cart'), x.link('tickets', 'Pomoc', 'ticket'), x.link('vouches', 'Opinie', 'star')));
  return card(c);
}

function informationPosts(x, build) {
  const about = container(COLORS.brand);
  header(about, `# ${x.E('logo')} O ${x.brand}\n${config.brand.about ?? ''}`, x.icon);
  about.addSeparatorComponents(divider());
  about.addTextDisplayComponents(
    text(
      `### ${x.E('sparkles')} Dlaczego ${x.brand}?\n` +
        `> ${x.E('rocket')} **Szybka dostawa** – ${config.shop.deliveryTime ?? 'większość zamówień dostarczamy błyskawicznie'}\n` +
        `> ${x.E('lock_locked')} **Bezpieczne płatności** – tylko w prywatnych ticketach, nigdy w wiadomościach prywatnych\n` +
        `> ${x.E('star')} **Zaufanie** – prawdziwe opinie prawdziwych klientów na ${x.ch('vouches')}\n` +
        `> ${x.E('chat')} **Prawdziwa pomoc** – ${config.shop.supportHours ?? 'zespół, który naprawdę odpisuje'}`,
    ),
  );
  const aboutButtons = [x.link('shop', 'Sklep', 'cart'), x.link('vouches', 'Opinie', 'star')];
  if (build?.invite) aboutButtons.push(linkBtn(build.invite, 'Zaproś znajomych', ce(x.guild, 'share')));
  about.addActionRowComponents(buttons(...aboutButtons));

  const guide = container(COLORS.brand);
  guide.addTextDisplayComponents(text(`# ${x.E('hash')} Przewodnik po kanałach\nGdzie co znajdziesz na **${x.brand}**.`));
  guide.addSeparatorComponents(divider());
  guide.addTextDisplayComponents(
    text(
      `### ${x.E('home')} Zacznij tutaj\n` +
        `> ${x.ch('rules')} – regulamin\n> ${x.ch('announcements')} – oficjalne nowości\n> ${x.ch('launcher')} – Hammer Launcher: pobieranie i nowe wersje\n> ${x.ch('giveaways')} – darmowe nagrody\n` +
        `> ${x.ch('roles')} – role i powiadomienia\n` +
        `### ${x.E('cart')} Sklep\n` +
        `> ${x.ch('shop')} – wszystkie produkty\n> ${x.ch('howToBuy')} – jak złożyć zamówienie\n> ${x.ch('payments')} – metody płatności\n` +
        `> ${x.ch('restocks')} – nowe produkty i dostawy\n> ${x.ch('vouches')} – opinie klientów\n` +
        `### ${x.E('ticket')} Pomoc\n` +
        `> ${x.ch('tickets')} – otwórz ticket\n> ${x.ch('faq')} – szybkie odpowiedzi\n` +
        `### ${x.E('chat')} Społeczność\n` +
        `> ${x.ch('chat')} · ${x.ch('leaderboard')} · ${x.ch('boosters')}`,
    ),
  );

  const team = container(COLORS.brand);
  team.addTextDisplayComponents(
    text(
      `# ${x.E('shield')} Nasz zespół\nLudzie, dzięki którym **${x.brand}** działa.\n` +
        `> ${x.role('founder')} · ${x.role('coowner')}\n> ${x.role('manager')} · ${x.role('admin')}\n` +
        `> ${x.role('moderator')} · ${x.role('support')} · ${x.role('trialSupport')}\n> ${x.role('seller')} – obsługuje Twoje zamówienia`,
    ),
  );
  team.addSeparatorComponents(divider());
  team.addTextDisplayComponents(text(`-# ${x.E('warning')} Nasz zespół **nigdy** nie pisze do Ciebie pierwszy i nie prosi o płatność poza ticketem. Nie wiesz, czy ktoś jest z zespołu? Sprawdź jego role.`));

  const contact = container(COLORS.brand);
  contact.addTextDisplayComponents(
    text(
      `# ${x.E('mail')} Kontakt\nNajszybciej skontaktujesz się z nami przez ticket na ${x.ch('tickets')} – prywatny kanał z naszym zespołem.\n` +
        `> ${x.E('cart')} **Chcesz coś kupić?** → kliknij **Kup** na ${x.ch('shop')}\n> ${x.E('question')} **Potrzebujesz pomocy?** → ticket **Pomoc**\n` +
        `-# ${config.shop.supportHours ? `Godziny pracy: ${config.shop.supportHours}` : ''}`,
    ),
  );
  contact.addActionRowComponents(buttons(btn('ticket:open:support', 'Napisz do pomocy', ce(x.guild, 'mail'), ButtonStyle.Primary), x.link('tickets', 'Wszystkie rodzaje ticketów', 'ticket')));

  const hiring = container(COLORS.brand);
  hiring.addTextDisplayComponents(
    text(
      `# ${x.E('person')} Dołącz do zespołu\nCiągle szukamy miłych, aktywnych osób, które pomogą naszym klientom.\n` +
        '> ✅ 16+ i dobry polski\n> ✅ Kilka godzin w tygodniu\n> ✅ Cierpliwość, uczciwość i chęć pomocy\n' +
        '-# Złóż podanie przyciskiem poniżej – czytamy każde zgłoszenie.',
    ),
  );
  hiring.addActionRowComponents(row(btn('ticket:open:apply', 'Złóż podanie', ce(x.guild, 'pencil'), ButtonStyle.Success)));

  return [
    { banner: 'discord' }, card(about),
    { banner: 'channels' }, card(guide),
    { banner: 'staff' }, card(team),
    { banner: 'contact' }, card(contact),
    { banner: 'join-us' }, card(hiring),
  ];
}

function announcementsIntro(x) {
  const c = container(COLORS.brand);
  header(
    c,
    `# ${x.E('sparkles')} ${x.brand} już działa!\nWitamy w naszym nowym domu. 🧡\n\n` +
      `> ${x.E('cart')} Przeglądaj katalog na ${x.ch('shop')}\n> ${x.E('gift')} Giveawaye odbywają się na ${x.ch('giveaways')}\n` +
      `> ${x.E('bell')} Odbierz role z powiadomieniami na ${x.ch('roles')}, żeby nie przegapić żadnej nowości`,
    x.icon,
  );
  c.addTextDisplayComponents(text(`-# Zespół ${x.brand} · ${ts(Date.now(), 'D')}`));
  return card(c);
}

function giveawaysIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('gift')} Giveawaye\nRegularnie rozdajemy tutaj produkty i inne nagrody.\n` +
        '> 🎉 Kliknij **Dołącz** pod giveawayem, żeby wziąć udział\n> 🏆 Zwycięzcy są losowani automatycznie, gdy skończy się czas\n' +
        '> 🎁 Zwycięzcy odbierają nagrodę przez ticket **Odbierz nagrodę** w ciągu 48 godzin\n' +
        `-# Chcesz ping przy każdym giveawayu? Odbierz rolę ${x.role('pingGiveaways', 'Giveawaye')} na ${x.ch('roles')}.`,
    ),
  );
  return card(c);
}

// ───────────── SHOP category ─────────────

function howToBuy(x) {
  const c = container(COLORS.brand);
  header(c, `# ${x.E('box')} Jak kupić\nZamówienie zajmuje około minuty. Tak to działa:`, x.icon);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `> **1.** Przejrzyj produkty na ${x.ch('shop')} i kliknij **Kup** przy tym, który chcesz\n` +
        '> **2.** Wypełnij krótki formularz (wariant, ilość i metoda płatności)\n' +
        `> **3.** Otworzy się prywatny ticket – ${x.role('seller', 'Sprzedawca')} potwierdzi cenę i wyśle dane do płatności\n` +
        (config.orders.paymentProofs === false
          ? '> **4.** Zapłać i odbierz produkt bezpośrednio w tickecie\n'
          : '> **4.** Kliknij **Zapłać** w tickecie (PIN PaysafeCard, ID transakcji krypto albo zrzut ekranu) – przy PayPal lub Stripe produkt dostajesz od razu\n') +
        `> **5.** Gotowe – wystaw jeszcze opinię na ${x.ch('vouches')} ${x.E('star')}\n` +
        `-# ${config.orders.statusDms === false ? '' : 'Dostaniesz wiadomość prywatną, gdy płatność zostanie potwierdzona i gdy zamówienie będzie w drodze · '}**Moje zamówienia** na ${x.ch('shop')} pokazuje Twoje zamówienia i potwierdzenia zakupu`,
    ),
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(
    text(
      `${x.E('clock')} **Dostawa:** ${config.shop.deliveryTime ?? '—'}\n` +
        `${x.E('chat')} **Pomoc:** ${config.shop.supportHours ?? '—'}\n` +
        `${x.E('info')} **Zwroty:** ${refundPolicy()} Produkt nie działa? Otwórz ticket **Pomoc** – naprawimy go lub wymienimy, a jeśli się nie da, oddamy Ci pieniądze.`,
    ),
  );
  c.addActionRowComponents(buttons(x.link('shop', 'Przejdź do sklepu', 'cart'), x.link('payments', 'Płatności', 'card')));
  return card(c);
}

function payments(x) {
  const c = container(COLORS.brand);
  header(c, `# ${x.E('card')} Metody płatności\nPłać tak, jak lubisz – wszystkie płatności odbywają się w Twoim prywatnym tickecie.`, x.icon);
  c.addSeparatorComponents(divider());
  const methods = config.shop.paymentMethods;
  c.addTextDisplayComponents(
    text(
      methods.length
        ? methods
            .map((m) => {
              const off = paymentState.offNote(x.guild.id, m); // switched off with /disable
              return off ? `### ${x.E(m.emoji ?? 'wallet')} ~~${m.name}~~\n-# **${off}** – na razie wybierz inną metodę.` : `### ${x.E(m.emoji ?? 'wallet')} ${m.name}\n-# ${m.details ?? ''}`;
            })
            .join('\n')
        : 'Metody płatności pojawią się tutaj wkrótce.',
    ),
  );
  c.addSeparatorComponents(divider());
  const has = (re) => methods.some((m) => re.test(`${m.name} ${m.emoji ?? ''}`));
  const tips = ['> Płać tylko na dane, które sprzedawca poda **w Twoim tickecie** – nigdy w wiadomościach prywatnych. Nigdy nie prosimy o hasła.'];
  if (has(/crypto|btc|eth|bitcoin|ethereum/i)) tips.push('> **Krypto:** wyślij co najmniej kwotę podaną w tickecie, we właściwej sieci, na adres z ticketu – płatności krypto nie da się cofnąć.');
  if (has(/paysafe/i)) tips.push('> **PaysafeCard:** PIN podawaj tylko w swoim tickecie – sprzedawca sprawdzi go przed dostawą.');
  if (has(/paypal/i)) tips.push('> **PayPal:** płać tylko przez link lub na adres PayPal z Twojego ticketu.');
  if (has(/stripe/i)) tips.push('> **Stripe:** zapłać kartą, Apple Pay lub Google Pay na bezpiecznej stronie Stripe – link znajdziesz w tickecie, a my nigdy nie widzimy danych Twojej karty.');
  tips.push(`> **Zwroty:** ${refundPolicy()} Przed płatnością sprawdź produkt i cenę.`);
  tips.push('> Próba oszustwa lub spór o płatność kończy się permanentnym banem.');
  c.addTextDisplayComponents(text(`${x.E('warning')} **Zachowaj ostrożność**\n${tips.join('\n')}`));
  c.addActionRowComponents(buttons(x.link('shop', 'Przejdź do sklepu', 'cart'), x.link('howToBuy', 'Jak kupić', 'info')));
  return card(c);
}

function restocksIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('sparkles')} Dostawy i nowe produkty\nKażdy nowy produkt i każdą dostawę ogłaszamy najpierw tutaj.\n` +
        `-# Chcesz dostawać ping? Odbierz rolę ${x.role('pingRestocks', 'Dostawy')} na ${x.ch('roles')}.`,
    ),
  );
  return card(c);
}

function proofsIntro(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('check')} Realizacje zamówień\nKażde dostarczone zamówienie trafia tutaj automatycznie – prawdziwe zamówienia, na bieżąco.\n` +
        `-# Nie pokazujemy nicków ani danych osobowych. Chcesz przeczytać, co piszą klienci? Zajrzyj na ${x.ch('vouches')}.`,
    ),
  );
  c.addActionRowComponents(buttons(x.link('shop', 'Sklep', 'cart'), x.link('vouches', 'Opinie', 'star')));
  return card(c);
}

// ───────────── SUPPORT category ─────────────

function faq(x) {
  const qa = [
    ['Jak coś kupić?', `Kliknij **Kup** przy produkcie na ${x.ch('shop')} – od razu otworzy się Twój prywatny ticket z zamówieniem. Pełny poradnik: ${x.ch('howToBuy')}.`],
    ['Jakie metody płatności przyjmujecie?', `${config.shop.paymentMethods.map((m) => (paymentState.isOff(x.guild.id, m) ? `${m.name} (chwilowo niedostępna)` : m.name)).join(', ') || 'Lista metod'} – szczegóły na ${x.ch('payments')}.`],
    ['Jak szybka jest dostawa?', `${config.shop.deliveryTime ?? 'Zwykle bardzo szybka'}. Wszystko dostajesz w swoim tickecie.`],
    ['Czy zakupy tutaj są bezpieczne?', `Tak – płatności odbywają się tylko w prywatnych ticketach z naszym zespołem, a prawdziwe opinie przeczytasz na ${x.ch('vouches')}. Nigdy nie piszemy do Ciebie pierwsi.`],
    ['Zamówienie nie dotarło albo coś jest nie tak', `Otwórz ticket **Pomoc** na ${x.ch('tickets')} w ciągu 48 godzin i podaj szczegóły zamówienia.`],
    [
      'Czy mogę dostać zwrot pieniędzy?',
      'Dostarczonych produktów cyfrowych nie można zwrócić – składając zamówienie, prosisz o natychmiastową dostawę. Salda sklepu również nie zwracamy ani nie wypłacamy. ' +
        `Produkt nie działa albo nie zgadza się z opisem? Otwórz ticket **Pomoc** na ${x.ch('tickets')} – naprawimy go lub wymienimy, a jeśli się nie da, oddamy Ci pieniądze. Pełne zasady: ${x.ch('rules')}.`,
    ],
    ['Jak wygrać giveaway?', `Klikaj **Dołącz** pod giveawayami na ${x.ch('giveaways')} i włącz ping o giveawayach na ${x.ch('roles')}.`],
    ['Czy mogę dołączyć do zespołu?', `Jasne – otwórz ticket **Rekrutacja** na ${x.ch('tickets')}.`],
  ];
  const c = container(COLORS.brand);
  header(c, `# ${x.E('question')} Najczęściej zadawane pytania\nNie ma tu Twojego pytania? Otwórz ticket na ${x.ch('tickets')}.`, x.icon);
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(qa.map(([q, a]) => `**${x.E('arrow_right')} ${q}**\n> ${a}`).join('\n\n')));
  return card(c);
}

// ───────────── COMMUNITY ─────────────

function boostersCard(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('rocket')} Boosterzy serwera\nBoost dla ${x.brand} odblokowuje lepszy serwer dla wszystkich – dziękujemy! 🧡\n` +
        `### ${x.E('gift')} Nagrody dla boosterów\n` +
        '> 🚀 Specjalna rola na górze listy członków\n> 🧡 Nasza dozgonna wdzięczność\n' +
        '-# Ogłoszenia o boostach pojawiają się na tym kanale.',
    ),
  );
  return card(c);
}

function staffHandbook(x) {
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(
      `# ${x.E('shield')} Poradnik zespołu\nWszystko, czego potrzebujesz, żeby prowadzić **${x.brand}**.\n` +
        `### ${x.E('ticket')} Tickety\n> Przejmij ticket, zanim odpowiesz · gotowe odpowiedzi wysyłasz przez \`${slash('reply')}\`\n` +
        '> W tickecie **Zakup** ustaw w menu ⚙️ **Status: Opłacone** / **W realizacji** (klient dostaje wiadomość prywatną), a po dostawie wybierz **Zamówienie zrealizowane** – klient dostaje rolę Klient i prośbę o opinię\n' +
        `> Transkrypcje trafiają na ${x.ch('transcripts')}, każda akcja na ${x.ch('ticketLogs')}\n` +
        `### ${x.E('cart')} Sklep\n> \`${slash('product add')}\` · \`${slash('product edit')}\` · \`${slash('product stock')}\` · \`${slash('product variants')}\` · \`${slash('product remove')}\` – panel na ${x.ch('shop')} aktualizuje się sam\n` +
        `> \`${slash('sale start')}\` – promocja błyskawiczna z odliczaniem · \`${slash('sale deal')}\` – automatyczna okazja tygodnia · \`${slash('product stock')} ilosc:\` – licznik sztuk, który sam się zmniejsza\n` +
        `> **Zwroty** – dostarczonych produktów nie można zwrócić, a salda sklepu nie zwracamy ani nie wypłacamy. Produkt nie działa? Najpierw go napraw lub wymień – dopiero gdy to niemożliwe, manager oddaje pieniądze (zasady: ${x.ch('rules')} §6)\n` +
        `> Nowe produkty i dostawy są ogłaszane na ${x.ch('restocks')} automatycznie\n` +
        `### ${x.E('gift')} Społeczność\n> \`${slash('giveaway start')}\` (opcjonalnie: tylko klienci, minimum zaproszeń) · \`${slash('giveaway end')}\` · \`${slash('giveaway reroll')}\`\n> \`${slash('announce')}\` – ładne ogłoszenie z opcjonalnym banerem i pingiem\n` +
        `### ${x.E('refresh')} Zmiana tekstów\n> Edytuj \`config.json\` (teksty, płatności), zrestartuj bota i użyj \`${slash('build')} tylko:panels\` – każda karta zaktualizuje się na miejscu · nowy styl nazw → \`${slash('build')} tylko:names\`\n` +
        `### ${x.E('warning')} Złote zasady\n> Nigdy nie proś o płatność poza ticketem · zachowuj kulturę · w razie wątpliwości zapytaj kogoś z rolą ${x.role('manager', 'Manager')}`,
    ),
  );
  return card(c);
}

/** All messages for one "post" key. */
function postsFor(key, guild) {
  const x = context(guild);
  const build = db.build(guild.id);
  switch (key) {
    case 'verify':
      return [{ banner: 'verification' }, { payload: verifyPanel(guild) }];
    case 'rules':
      return [{ banner: 'rules' }, ...rulesCards(x)];
    case 'welcome':
      return [{ banner: 'welcome' }, welcomeIntro(x)];
    case 'information':
      return informationPosts(x, build);
    case 'announcements':
      return [{ banner: 'announcements' }, announcementsIntro(x)];
    case 'launcher':
      return [{ banner: 'launcher' }, card(require('../features/launcherinfo').card(guild))];
    case 'giveaways':
      return [{ banner: 'giveaways' }, giveawaysIntro(x)];
    case 'roles':
      return [{ banner: 'roles' }, ...rolesPanels(guild).map((payload) => ({ payload }))];
    case 'shop':
      return [{ banner: 'shop' }, { panel: 'shop' }];
    case 'howToBuy':
      return [{ banner: 'how-to-buy' }, howToBuy(x)];
    case 'payments':
      return [{ banner: 'payments' }, payments(x)];
    case 'restocks':
      return [{ banner: 'restocks' }, restocksIntro(x)];
    case 'vouches':
      return [{ banner: 'vouches' }, { panel: 'vouches' }];
    case 'proofs':
      return [{ banner: 'proofs' }, proofsIntro(x)];
    case 'tickets':
      return [{ banner: 'support' }, { panel: 'tickets', extra: { style: 'buttons' } }];
    case 'faq':
      return [{ banner: 'faq' }, faq(x)];
    case 'leaderboard':
      return [{ banner: 'leaderboard' }, { panel: 'leaderboard' }];
    case 'boosters':
      return [{ banner: 'boosters' }, boostersCard(x)];
    case 'staff':
      return [{ banner: 'staff' }, staffHandbook(x)];
    default:
      return [];
  }
}

module.exports = { postsFor, context, fillRules, rulesCards, rulesFile };
