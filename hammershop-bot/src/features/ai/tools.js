'use strict';

/**
 * The AI assistant's tools – JSON-schema definitions (strict) and what they do.
 *
 * The list is fixed and always in the same order (it is the very start of the cached prompt). Every tool acts on the
 * ticket's owner only: the owner's ID comes from the ticket record (ctx.ownerId), never from the model's input – no
 * tool takes a user, so nothing can be granted to anyone else whatever a user writes. Inputs are validated here as
 * well (strict schemas are not a reason to trust them).
 *
 * ctx (from aiassistant.js): { guild, channel, ticket, ownerId, botId, escalate(reason, opts), deliverCode(granted) }
 */

const hammerplus = require('../hammerplus');
const launcherinfo = require('../launcherinfo');
const prizes = require('./prizes');
const { money, truncate } = require('../../lib/utils');

const NICK = /^[A-Za-z0-9_]{1,16}$/;

const object = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const TOOLS = [
  {
    name: 'info_launchera',
    description:
      'Aktualna wersja Hammer Launchera (numer, data, lista zmian), link do strony z pobieraniem, cennik Hammer+ i status Hammer+ autora ticketu. ' +
      'Podaj nick, żeby sprawdzić Hammer+ konkretnego konta Minecraft. Użyj, gdy ktoś pyta o wersję, pobieranie, ceny Hammer+ albo o to, czy jego Hammer+ działa.',
    strict: true,
    input_schema: object({ nick: { type: 'string', description: 'Nick Minecraft do sprawdzenia (opcjonalnie)' } }),
  },
  {
    name: 'moje_wygrane',
    description:
      'Giveawaye autora ticketu: wygrane (z ID, nagrodą i statusem odbioru), te, w których bierze udział, i ostatnie bez wygranej. ' +
      'Użyj, zanim cokolwiek powiesz o wygranej, nagrodzie albo giveawayu.',
    strict: true,
    input_schema: object({}),
  },
  {
    name: 'odbierz_nagrode',
    description:
      'Wydaje autorowi ticketu nagrodę z giveawayu, który wygrał (ID z moje_wygrane). Bot sam sprawdza wygraną, koniec giveawayu i to, czy nagroda nie została już odebrana. ' +
      'Hammer+ jest wydawany od razu na podany nick Minecraft (Java Edition); inne nagrody bot zgłasza zespołowi i woła go do ticketu.',
    strict: true,
    input_schema: object(
      {
        giveawayId: { type: 'string', description: 'ID giveawayu z moje_wygrane' },
        minecraftNick: { type: 'string', description: 'Nick Minecraft (Java Edition), na który ma być kod – potrzebny, gdy nagrodą jest Hammer+' },
      },
      ['giveawayId'],
    ),
  },
  {
    name: 'wezwij_zespol',
    description:
      'Woła zespół do ticketu (ping) i wyłącza asystenta w tym tickecie. Użyj, gdy ktoś prosi o człowieka, sprawa dotyczy pieniędzy, płatności, zwrotu albo bezpieczeństwa konta, ' +
      'zgłoszenie/odwołanie/podanie jest kompletne albo nie umiesz pomóc.',
    strict: true,
    input_schema: object({ powod: { type: 'string', description: 'Jedno–dwa zdania dla zespołu: czego dotyczy sprawa (bez ocen)' } }, ['powod']),
  },
];

/** Checks the input against the tool's schema (no extra keys, required present, strings only) → error text or null. */
function invalid(tool, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Dane narzędzia muszą być obiektem.';
  const { properties, required } = tool.input_schema;
  for (const key of Object.keys(input)) if (!(key in properties)) return `Nieznane pole: ${key}. Narzędzie działa tylko na koncie autora ticketu.`;
  for (const key of required) if (input[key] === undefined || input[key] === null || input[key] === '') return `Brakuje pola: ${key}.`;
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && typeof value !== 'string') return `Pole ${key} musi być tekstem.`;
    if (typeof value === 'string' && value.length > 400) return `Pole ${key} jest za długie.`;
  }
  return null;
}

const json = (value) => JSON.stringify(value);
const fail = (message) => ({ content: json({ ok: false, blad: message }), isError: true });
const done = (value) => ({ content: json({ ok: true, ...value }) });

/** "do 1 gru 2026, 18:00 (konto Notch)" – a Hammer+ end in unix seconds (0 = never, null = none). */
function untilText(until) {
  if (until === null || until === undefined) return null;
  if (until === 0) return 'aktywny na zawsze';
  return `aktywny do ${new Date(until * 1000).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'medium', timeStyle: 'short' })}`;
}

/** The owner's own Hammer+ – every Minecraft account issued for their Discord account. */
function ownPlus(guildId, userId) {
  const accounts = new Map();
  for (const c of hammerplus.codes(guildId)) if (c.discordId === userId) accounts.set(c.mc, c.nick);
  const running = [...accounts].map(([mc, nick]) => ({ nick, until: hammerplus.runningUntil(guildId, mc) })).filter((a) => a.until !== null);
  if (!running.length) return 'brak aktywnego Hammer+ przypisanego do tego konta Discord';
  return running.map((a) => `${untilText(a.until)} (konto Minecraft ${a.nick})`).join('; ');
}

function plans() {
  try {
    const { currencyCode, DECIMALS } = require('../../lib/currency');
    const unit = 10 ** (DECIMALS[currencyCode() ?? 'eur'] ?? 2);
    return require('../../web/store')
      .plusPlans()
      .map((p) => ({ plan: p.name, czas: p.days === 0 ? 'na zawsze' : `${p.days} dni`, cena: money(p.price / unit) }));
  } catch {
    return [];
  }
}

async function infoLauncher(ctx, input) {
  const release = launcherinfo.currentRelease();
  const list = plans();
  const out = {
    wersja: release
      ? { numer: release.version, data: release.date.slice(0, 10), zmiany: truncate(release.notes || 'brak opisu', 600) }
      : 'brak danych o wersji (nic nie opublikowano albo strona jest wyłączona) – najnowszą wersję launcher pobiera sam',
    strona: launcherinfo.page() ?? 'https://hammerclient.com',
    hammer_plus_cennik: list.length ? list : 'cennik nie jest teraz dostępny – aktualne plany są na stronie launchera',
    hammer_plus_autora: ownPlus(ctx.guild.id, ctx.ownerId),
  };
  const nick = String(input.nick ?? '').trim();
  if (nick) {
    if (!NICK.test(nick)) out.hammer_plus_nicku = 'nieprawidłowy nick (najwyżej 16 znaków: litery, cyfry, _)';
    else {
      try {
        const account = await hammerplus.lookup(nick);
        out.hammer_plus_nicku = { nick: account.nick, status: untilText(hammerplus.runningUntil(ctx.guild.id, account.mc)) ?? 'brak aktywnego Hammer+' };
      } catch (err) {
        out.hammer_plus_nicku = err.message;
      }
    }
  }
  return done(out);
}

function myWins(ctx) {
  return done(prizes.winsOverview(ctx.guild.id, ctx.ownerId));
}

const REPORT_WHY = {
  other: 'to nie jest Hammer+',
  'unknown-length': 'to Hammer+, ale z nagrody nie wynika, na ile dni',
  late: 'minęło 48 godzin na odbiór',
  'no-key': 'bot nie może teraz wystawiać kodów Hammer+ (brak klucza)',
};

async function claimPrize(ctx, input) {
  const nick = input.minecraftNick ? String(input.minecraftNick).trim() : '';
  if (nick && !NICK.test(nick)) return fail('Nieprawidłowy nick Minecraft – najwyżej 16 znaków: litery, cyfry i podkreślenie (_). Poproś autora o poprawny nick.');
  const r = await prizes.claim({ guildId: ctx.guild.id, userId: ctx.ownerId, giveawayId: input.giveawayId, nick, botId: ctx.botId, channelId: ctx.channel.id });
  switch (r.result) {
    case 'not-found':
      return fail('Nie ma giveawayu o tym ID na tym serwerze. Sprawdź ID w moje_wygrane.');
    case 'not-ended':
      return fail(`Giveaway „${r.gw.prize}” jeszcze trwa – zwycięzców bot wylosuje, gdy skończy się czas.`);
    case 'not-winner':
      return fail(`Autor ticketu nie jest zwycięzcą giveawayu „${r.gw.prize}”. Nagrody nie można wydać.`);
    case 'already':
      return fail(`Nagroda z giveawayu „${r.gw.prize}” została już ${r.claim.status === 'granted' ? `odebrana (kod Hammer+ dla konta ${r.claim.nick})` : 'zgłoszona zespołowi'} – drugi raz nie można jej wydać.`);
    case 'busy':
      return fail('Ta nagroda jest właśnie wydawana – poczekaj chwilę.');
    case 'need-nick':
      return fail('Nagrodą jest Hammer+ – potrzebny jest nick Minecraft (Java Edition), na który ma trafić kod. Zapytaj autora o nick i wywołaj narzędzie jeszcze raz.');
    case 'bad-nick':
      return fail(`Nie udało się sprawdzić nicku: ${r.error}`);
    case 'granted':
      await ctx.deliverCode(r);
      return done({
        wydano: `Kod Hammer+ (${prizes.plusLength(r.days)}) dla konta Minecraft ${r.record.nick} – bot wysłał go w tickecie i w wiadomości prywatnej.`,
        dalej: 'Potwierdź krótko i przypomnij: launcher → Hammer+ → „Mam kod” → wklej → Aktywuj, na koncie, dla którego jest kod. Nie przepisuj kodu.',
      });
    case 'reported':
      await ctx.escalate(`Nagroda do wydania ręcznie: „${r.gw.prize}” (giveaway ${r.gw.id}) – ${REPORT_WHY[r.why] ?? r.why}.`, { prize: r });
      return done({ zgloszono: 'Nagrodę zgłoszono zespołowi, który wyda ją ręcznie; zespół został zawołany do ticketu.' });
    default:
      return fail('Nie udało się wydać nagrody.');
  }
}

async function callTeam(ctx, input) {
  await ctx.escalate(String(input.powod ?? '').trim() || 'Asystent AI prosi zespół o pomoc.');
  return done({ zawolano: 'Zespół został zawołany do ticketu.' });
}

const RUN = { info_launchera: infoLauncher, moje_wygrane: myWins, odbierz_nagrode: claimPrize, wezwij_zespol: callTeam };

/** Runs one tool_use block → { content (text for the tool_result), isError }. Never throws. */
async function runTool(name, input, ctx) {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return fail(`Nie ma narzędzia ${name}.`);
  const problem = invalid(tool, input);
  if (problem) return fail(problem);
  try {
    return await RUN[name](ctx, input);
  } catch (err) {
    console.error(`[asystent] narzędzie ${name}:`, err);
    return fail('Narzędzie nie zadziałało (błąd po stronie bota).');
  }
}

module.exports = { TOOLS, runTool, invalid };
