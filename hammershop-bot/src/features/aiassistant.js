'use strict';

/**
 * 🤖 AI assistant in tickets (Hammer Launcher server) – answers people before the team does. The AI is chosen in .env
 * (src/features/ai/client.js): Groq (free, the default with GROQ_API_KEY), Claude, or any OpenAI-compatible API.
 *
 *   - A ticket opens → the assistant reads the form answers and writes first (after the ticket card is posted).
 *   - The ticket's author writes → it answers (bursts are waited out – DEBOUNCE – and "typing…" is shown).
 *   - It can check giveaway wins and hand out the prize (Hammer+ codes at once, anything else goes to the team),
 *     tell the current launcher version / Hammer+ prices, and call the team (src/features/ai/tools.js).
 *   - Somebody asks for a person („człowiek”, „admin”…) → the bot calls the team itself, without the model
 *     (src/features/ai/human.js), says help is coming and the assistant goes quiet in that ticket.
 *   - It stops in a ticket once a staff member writes there (a human took over), after calling the team and after
 *     MAX_REPLIES answers. Staff turn it back on / off per ticket (buttons, /asystent ticket) and for the whole server
 *     (/asystent wlacz|wylacz – src/commands/assistant.js).
 *
 * No-AI mode – no key at all, or the assistant paused (free limit used up, key or model rejected): a „Odbierz nagrodę”
 * ticket lists the author's unclaimed wins with a claim button each (Hammer+ asks for the nick in a form and issues the
 * code like the AI does, anything else goes to the team), and asking for a person still calls the team. Other tickets
 * work as before the assistant existed. Only on the Hammer Launcher server (BOT_PROFILE=launcher).
 *
 * State: ticket.ai = { mode ('ai' | 'noai'), active, stopped ('staff' | 'escalated' | 'manual' | null), replies, msgIds
 *   (its own messages), firstMsgId, answeredUpTo (the newest author message already answered), greeted, failures,
 *   escalatedAt, resumedAt, panelId (the no-AI prize list) }
 *   db.guild(id).aiAssistant = { enabled (false = off on the whole server), by, at }
 * Logs: what it does (prize handed out, team called, errors) goes to the ticket log – never the conversation.
 */

const { ButtonStyle, MessageFlags, ModalBuilder } = require('discord.js');
const config = require('../lib/config');
const db = require('../lib/db');
const hooks = require('../lib/hooks');
const profile = require('../lib/profile');
const perms = require('../lib/permissions');
const { COLORS } = require('../lib/theme');
const { btn, row, notice, container, text, v2 } = require('../lib/v2');
const { slash } = require('../lib/commandsPl');
const { UserError, logEmbed, sendLog, sendTicketLog, pad, truncate, reply, isStaff, ts } = require('../lib/utils');
const hammerplus = require('./hammerplus');
const ai = require('./ai/client');
const prizes = require('./ai/prizes');
const { SYSTEM_PROMPT } = require('./ai/prompt');
const { TOOLS, runTool, brokenInput, REPORT_WHY } = require('./ai/tools');
const { ProviderError } = require('./ai/openai');
const { asksForHuman } = require('./ai/human');

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'; // Claude: refusal fallbacks – a declined request is retried on another model
const EFFORT = 'low'; // chat / support – Opus 5.5 always thinks, effort keeps it short (gpt-oss on Groq: reasoning_effort)
const MAX_TOKENS = 8000; // thinking counts toward it too; the replies themselves are short (free providers: capped lower)
const MAX_ITERATIONS = 6; // model calls per answer (tool round trips)
const MAX_REPLIES = 25; // per ticket – then the team takes over
const HOURLY_CAP = 20; // answers per author per hour, across tickets
const MAX_FAILURES = 2; // failed answers in a row before the team is called
const BODY_MAX = 1820; // + the footer line stays under 1900 characters
const KEY_PAUSE_MS = 3_600_000; // a rejected key or model / no credits: no new calls for an hour (fix .env, restart)
const MAX_PAUSE_MS = 3_600_000; // a free limit: as long as the provider says, at most an hour
const LIMIT_TEXT = 'Asystent AI ma teraz przerwę – skończył się darmowy limit. Zawołałem zespół, ktoś zaraz odpisze.';
const NICK = /^[A-Za-z0-9_]{1,16}$/;
const ESCALATE_AGAIN_MS = 10 * 60_000;

const timing = { debounce: 4000, open: 2500, typing: 8000 };

// ───────────── Switches ─────────────

let pause = null; // { until (ms), reason: 'limit' | 'auth' | 'model' | 'config' | 'billing' }

/** The assistant's break – null when there is none (or it is over). */
const paused = () => (pause && Date.now() < pause.until ? pause : null);
function pauseFor(reason, ms) {
  const until = Date.now() + Math.min(Math.max(ms, 1000), MAX_PAUSE_MS);
  if (!paused() || pause.until < until) pause = { until, reason };
  return pause;
}
const PAUSE_REASONS = {
  limit: 'skończył się darmowy limit dostawcy AI',
  auth: 'klucz API został odrzucony – popraw go w .env i uruchom bota ponownie',
  model: 'dostawca nie zna modelu – ustaw AI_MODEL w .env i uruchom bota ponownie',
  config: 'klucz API albo model został odrzucony – sprawdź .env',
  billing: 'brak środków na koncie Anthropic',
};

const globallyOn = (guildId) => db.guild(guildId).aiAssistant?.enabled !== false;
/** The assistant can run on this bot at all: launcher server, a configured AI (or a test's client), no break. */
const available = () => profile.launcher && ai.configured() && !paused();
const activeIn = (guildId) => available() && globallyOn(guildId);
const eligible = (type) => Boolean(type) && !type.shopOnly && type.id !== 'order';

function setGlobal(guild, enabled, actor) {
  const g = db.guild(guild.id);
  g.aiAssistant = { ...(g.aiAssistant ?? {}), enabled: Boolean(enabled), by: actor?.id ?? null, at: Date.now() };
  db.save();
  sendLog(guild, {
    embeds: [logEmbed(enabled ? COLORS.success : COLORS.muted, enabled ? '🤖 Asystent AI włączony' : '🔕 Asystent AI wyłączony', actor?.user ?? actor).setDescription(`${actor ?? 'Ktoś'} ${enabled ? 'włącza' : 'wyłącza'} asystenta AI w ticketach na całym serwerze.`)],
  }).catch(() => null);
}

const PROBLEMS = {
  'no-key':
    'Asystent AI jest wyłączony – w pliku `.env` nie ma klucza. Darmowy klucz: `GROQ_API_KEY` z console.groq.com (README → „Asystent AI w ticketach”). Do tego czasu nagrody z giveawayów odbiera się przyciskami w tickecie.',
  'no-groq-key': '`AI_PROVIDER=groq`, ale w pliku `.env` brakuje `GROQ_API_KEY` (console.groq.com → API Keys).',
  'no-claude-key': '`AI_PROVIDER=claude`, ale w pliku `.env` brakuje `ANTHROPIC_API_KEY`.',
  'no-sdk': 'Brakuje pakietu `@anthropic-ai/sdk` – uruchom `npm install` w folderze bota i uruchom go ponownie.',
  'openai-incomplete': '`AI_PROVIDER=openai` potrzebuje w pliku `.env` trzech wartości: `AI_BASE_URL`, `AI_API_KEY` i `AI_MODEL`.',
  'bad-provider': '`AI_PROVIDER` w pliku `.env` ma nieznaną wartość – wpisz `auto`, `groq`, `claude` albo `openai`.',
};

/** Why it can't run at all (the setup) – for /asystent (Polish), null when it can. A break is pauseText(). */
function unavailableText() {
  if (!profile.launcher) return 'Asystent AI działa tylko na serwerze Hammer Launcher (`BOT_PROFILE=launcher`).';
  const p = ai.problem();
  return p ? PROBLEMS[p] ?? p : null;
}

/** "Asystent AI ma przerwę do 18:00 (za 20 minut) – skończył się darmowy limit…" – null without a break. */
function pauseText() {
  const p = paused();
  return p ? `Asystent AI ma przerwę do ${ts(p.until, 't')} (${ts(p.until, 'R')}) – ${PAUSE_REASONS[p.reason] ?? p.reason}. W tym czasie tickety działają bez AI.` : null;
}

// ───────────── Ticket state ─────────────

function patchAi(channelId, patch) {
  const t = db.getTicket(channelId);
  if (!t) return null;
  return db.updateTicket(channelId, { ai: { ...(t.ai ?? {}), ...patch } });
}

/** A staff member answered (a message, or a /reply snippet) or claimed the ticket after the assistant was (re)started. */
function humanTookOver(t) {
  const since = t.ai?.resumedAt ?? 0;
  if (t.firstResponseAt && t.firstResponseAt > since) return true;
  return Boolean(t.claimedBy && !t.ai?.resumedAt);
}

const channels = new Map(); // channelId → { timer, running, again }
const pending = new Set();
const state = (id) => {
  if (!channels.has(id)) channels.set(id, { timer: null, running: false, again: false });
  return channels.get(id);
};

function clearTimer(channelId) {
  const s = channels.get(channelId);
  if (s?.timer) clearTimeout(s.timer);
  if (s) {
    s.timer = null;
    s.again = false;
  }
}

function stop(channel, why) {
  clearTimer(channel.id);
  patchAi(channel.id, { active: false, stopped: why });
}

function track(promise) {
  pending.add(promise);
  promise.finally(() => pending.delete(promise));
  return promise;
}

/** Answers after `delay` ms – a new message in the meantime moves it again; during an answer, one more follows it. */
function schedule(channel, delay) {
  const s = state(channel.id);
  if (s.running) {
    s.again = true;
    return;
  }
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    track(run(channel));
  }, delay);
  s.timer.unref?.();
}

const repliesTo = new Map(); // author ID → timestamps of answers in the last hour
function recentReplies(userId, now = Date.now()) {
  const list = (repliesTo.get(userId) ?? []).filter((t) => now - t < 3_600_000);
  repliesTo.set(userId, list);
  return list.length;
}
const noteReply = (userId) => repliesTo.set(userId, [...(repliesTo.get(userId) ?? []), Date.now()]);

// ───────────── The conversation ─────────────

const FOOTER_FIRST = '-# 🤖 Asystent AI – może się pomylić. Napisz „człowiek”, a zawołam zespół.';
const FOOTER = '-# 🤖 Asystent AI';
const stripFooter = (text) => String(text ?? '').split('\n').filter((line) => !line.startsWith('-# 🤖')).join('\n').trim();
/** No pings from the model's text (allowedMentions is empty anyway) and nothing that looks like one. */
const clean = (text) =>
  String(text ?? '')
    .replace(/<@[!&]?\d+>/g, '')
    .replace(/@(everyone|here)/gi, '@\u200b$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** One Discord message as text for the model: content plus the names of its files (the model can't open them). */
function describe(m, max) {
  let text = String(m.content ?? '').trim();
  const files = [...(m.attachments?.values?.() ?? [])].map((a) => a.name).filter(Boolean);
  if (files.length) text += `${text ? '\n' : ''}[załącznik: ${files.join(', ')} – nie widzisz jego treści]`;
  if (!text && m.stickers?.size) text = '[naklejka]';
  return truncate(text, max);
}

function formBlock(ticket, type, max) {
  const lines = [`[Ticket #${pad(ticket.number)} · ${type?.label ?? ticket.typeId} · autor: ${ticket.ownerName ?? 'nieznany'}]`];
  const answers = (ticket.answers ?? []).filter((a) => a?.label);
  if (answers.length) lines.push('Formularz ticketu:', ...answers.map((a) => `${a.label}: ${String(a.value ?? '').trim() || '—'}`));
  else lines.push('Ticket otwarty bez formularza.');
  return truncate(lines.join('\n'), max);
}

/** The bot's own context for this answer – a system message after the history, so the cached prefix stays the same. */
function contextMessage(ticket, type, first) {
  const today = new Date().toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'full' });
  const lines = [`Kontekst od bota: ticket typu ${type?.id ?? ticket.typeId} („${type?.label ?? ticket.typeId}”). Dziś jest ${today}.`];
  if (first) lines.push('To Twoja pierwsza wiadomość w tym tickecie: przywitaj się, przedstaw jako asystent AI i od razu zajmij się sprawą z formularza.');
  return { role: 'system', content: lines.join('\n') };
}

/**
 * The messages for the API: the form first, then the channel oldest → newest (the assistant's own messages as its
 * turns), and the author's messages it hasn't answered yet at the end. null when there is nothing to answer.
 */
function buildConversation(guild, ticket, type, history, budget = ai.budget()) {
  const s = ticket.ai ?? {};
  const mine = new Set(s.msgIds ?? []);
  const botId = guild.client?.user?.id;
  const answered = s.answeredUpTo ? BigInt(s.answeredUpTo) : null;
  const older = [];
  const fresh = [];
  let newestOwnerId = null;
  for (const m of history) {
    if (!m?.author || m.id === ticket.controlMessageId) continue;
    if (m.author.bot || m.author.id === botId) {
      const text = mine.has(m.id) ? stripFooter(m.content) : '';
      if (text) older.push({ role: 'assistant', text });
      continue;
    }
    const text = describe(m, budget.messageChars);
    if (!text) continue;
    if (m.author.id === ticket.ownerId) {
      newestOwnerId = m.id;
      (answered === null || BigInt(m.id) > answered ? fresh : older).push({ role: 'user', text });
      continue;
    }
    const member = m.member ?? guild.members.cache.get(m.author.id);
    const name = member?.displayName ?? m.author.username ?? 'ktoś';
    older.push({ role: 'user', text: `[${isStaff(member, type) ? 'Zespół' : 'Inna osoba w tickecie'} – ${name}]: ${text}` });
  }
  const opening = !s.greeted;
  if (!fresh.length && !opening) return null;
  const turns = [{ role: 'user', text: formBlock(ticket, type, budget.formChars) }, ...older, ...fresh];
  const messages = [];
  for (const turn of turns) {
    const last = messages[messages.length - 1];
    if (last?.role === turn.role) last.content.push({ type: 'text', text: turn.text });
    else messages.push({ role: turn.role, content: [{ type: 'text', text: turn.text }] });
  }
  if (messages[messages.length - 1].role !== 'user') return null;
  messages.push(contextMessage(ticket, type, !(s.msgIds ?? []).length));
  return { messages, newestOwnerId };
}

/** The request – tools, system prompt and settings never change, so they are read from the cache after the first call. */
const request = (messages) => ({
  model: ai.model(),
  max_tokens: MAX_TOKENS,
  betas: [FALLBACK_BETA],
  fallbacks: 'default',
  output_config: { effort: EFFORT },
  cache_control: { type: 'ephemeral' }, // the growing conversation
  system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }], // tools + system prompt
  tools: TOOLS,
  tool_choice: { type: 'auto' },
  messages,
});

/**
 * Content to send back on the next call. After a fallback (another model took over mid-answer) the blocks before the
 * last `fallback` block are dropped except text – the fallback block itself stays where it was.
 */
function echoable(content) {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback');
  if (boundary === -1) return content;
  return content.filter((b, i) => i >= boundary || b.type === 'text' || b.type === 'fallback');
}

const textOf = (content) =>
  content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n\n')
    .trim();

/**
 * The tool loop → { kind: 'text', text } | { kind: 'cut' } (max_tokens without text) | { kind: 'refusal' }
 * | { kind: 'escalated' } (a tool called the team – nothing more is said) | { kind: 'limit' } (too many steps).
 */
async function converse(messages, ctx) {
  const client = ai.client();
  for (let i = 0; i < MAX_ITERATIONS; i += 1) {
    const response = await client.beta.messages.create(request(messages));
    const content = echoable(response.content ?? []);
    const stopReason = response.stop_reason;
    if (stopReason === 'refusal') return { kind: 'refusal' };
    const uses = content.filter((b) => b.type === 'tool_use');
    if (stopReason === 'tool_use' && uses.length) {
      messages.push({ role: 'assistant', content });
      const results = [];
      for (const use of uses) {
        const r = use.invalid_json !== undefined ? brokenInput() : await runTool(use.name, use.input, ctx);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: r.content, ...(r.isError && { is_error: true }) });
      }
      messages.push({ role: 'user', content: results }); // all results of one turn in one message
      if (ctx.escalated) return { kind: 'escalated' };
      continue;
    }
    if (stopReason === 'pause_turn') {
      messages.push({ role: 'assistant', content });
      continue;
    }
    const text = textOf(content);
    if (stopReason === 'max_tokens' && !text) return { kind: 'cut' }; // never run a cut-off tool call
    return { kind: 'text', text };
  }
  return { kind: 'limit' };
}

// ───────────── Answering ─────────────

async function sendReply(channel, text) {
  const s = db.getTicket(channel.id)?.ai ?? {};
  const first = !(s.msgIds ?? []).length;
  const body = truncate(clean(text), BODY_MAX);
  if (!body) return null;
  const msg = await channel.send({
    content: `${body}\n${first ? FOOTER_FIRST : FOOTER}`,
    allowedMentions: { parse: [] },
    components: first ? [row(btn('ai:human', 'Zawołaj zespół', '🙋'), btn('ai:off', 'Wyłącz asystenta', '🔕'))] : [],
  });
  const now = db.getTicket(channel.id)?.ai ?? {};
  patchAi(channel.id, { msgIds: [...(now.msgIds ?? []), msg.id].slice(-40), replies: (now.replies ?? 0) + 1, firstMsgId: now.firstMsgId ?? msg.id, lastReplyAt: Date.now() });
  return msg;
}

async function answer(channel) {
  const guild = channel.guild;
  const ticket = db.getTicket(channel.id);
  if (!ticket || ticket.status !== 'open' || !ticket.ai?.active) return;
  if (humanTookOver(ticket)) return stop(channel, 'staff');
  if (!activeIn(guild.id)) return paused() && globallyOn(guild.id) ? takeBreak(channel) : undefined; // a break began meanwhile
  const type = config.getType(ticket.typeId);
  const budget = ai.budget();
  const list = await channel.messages.fetch({ limit: budget.history }).catch(() => null);
  const convo = buildConversation(guild, ticket, type, list ? [...list.values()].reverse() : [], budget);
  if (!convo) return;
  if ((ticket.ai.replies ?? 0) >= MAX_REPLIES) return escalate(channel, { reason: `Asystent AI wykorzystał limit ${MAX_REPLIES} odpowiedzi w tym tickecie.`, source: 'limit' });
  if (recentReplies(ticket.ownerId) >= HOURLY_CAP) return escalate(channel, { reason: `Autor dostał już ${HOURLY_CAP} odpowiedzi asystenta w ciągu godziny.`, source: 'limit' });

  const ctx = { guild, channel, ticket, ownerId: ticket.ownerId, botId: guild.client?.user?.id ?? null, escalated: false };
  ctx.escalate = async (reason, opts = {}) => {
    ctx.escalated = true;
    await escalate(channel, { reason, source: opts.prize ? 'prize' : 'ai' });
  };
  ctx.deliverCode = (granted) => deliverCode(channel, ticket, granted);

  let outcome;
  try {
    outcome = await converse(convo.messages, ctx);
  } catch (err) {
    return failed(channel, err);
  }
  if (outcome.kind === 'cut') return failed(channel, null); // nothing usable – those messages stay unanswered
  patchAi(channel.id, { answeredUpTo: convo.newestOwnerId ?? ticket.ai.answeredUpTo ?? null, greeted: true, failures: 0 });
  if (outcome.kind === 'escalated') return;
  if (outcome.kind === 'refusal') return escalate(channel, { reason: 'Asystent AI nie może pomóc w tej sprawie – potrzebny ktoś z zespołu.', source: 'refusal' });
  if (outcome.kind === 'limit') return escalate(channel, { reason: 'Asystent AI nie poradził sobie z odpowiedzią.', source: 'error' });
  const now = db.getTicket(channel.id);
  if (!outcome.text || now?.status !== 'open' || !now.ai?.active) return; // e.g. staff wrote while it was answering
  if (await sendReply(channel, outcome.text)) noteReply(ticket.ownerId);
}

async function run(channel) {
  const s = state(channel.id);
  s.running = true;
  const typing = () => channel.sendTyping?.()?.catch?.(() => null);
  typing();
  const interval = setInterval(typing, timing.typing);
  interval.unref?.();
  try {
    await answer(channel);
  } catch (err) {
    console.error('[asystent]', err);
  } finally {
    clearInterval(interval);
    s.running = false;
    if (s.again) {
      s.again = false;
      schedule(channel, timing.debounce);
    }
  }
}

// ───────────── Errors ─────────────

/**
 * 'transient' (try again) | 'limit' (a free plan's limit – a break) | 'auth' (key rejected) | 'model' (unknown model) |
 * 'config' (Claude: key / model) | 'billing' (Claude: no credits) | 'request' (400 – a bug) | 'bug'.
 */
function classify(err) {
  if (err instanceof ProviderError) {
    return { 'rate-limit': 'limit', auth: 'auth', model: 'model', 'bad-request': 'request' }[err.kind] ?? 'transient';
  }
  const A = ai.Anthropic();
  if (!err || !A) return 'bug';
  if (err instanceof A.AuthenticationError || err instanceof A.PermissionDeniedError || err instanceof A.NotFoundError) return 'config';
  if (err instanceof A.BadRequestError) return 'request';
  if (err instanceof A.RateLimitError || err instanceof A.InternalServerError || err instanceof A.APIConnectionError) return 'transient';
  if (err instanceof A.APIError) return err.type === 'billing_error' || err.status === 402 ? 'billing' : 'transient';
  return 'bug';
}

const errorText = (err) => (err ? truncate(`${err.constructor?.name ?? 'Error'}${err.status ? ` (HTTP ${err.status})` : ''}: ${err.message ?? ''}`, 300) : 'odpowiedź ucięta (max_tokens)');

/** One clear console line for the owner when the assistant has to take a break. */
function announcePause(kind, err) {
  const who = ai.label();
  const until = new Date(paused()?.until ?? Date.now()).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' });
  const keyVar = ai.KEY_VARS[ai.provider()] ?? 'klucz';
  const lines = {
    limit: `🤖 Asystent AI (${who}): skończył się darmowy limit – przerwa do ${until}. W tym czasie tickety działają bez AI (nagrody przyciskami, „człowiek” woła zespół).`,
    auth: `🤖 Asystent AI (${who}): klucz został odrzucony (HTTP ${err?.status ?? '?'}) – sprawdź ${keyVar} w .env i uruchom bota ponownie. Asystent wstrzymany do ${until}.`,
    model:
      ai.provider() === 'groq'
        ? `🤖 Asystent AI (Groq): model „${ai.model()}” nie istnieje albo został wycofany. Wybierz aktualny model z https://console.groq.com/docs/models i wpisz go w .env jako AI_MODEL=…, potem uruchom bota ponownie. Asystent wstrzymany do ${until}.`
        : `🤖 Asystent AI (${who}): dostawca nie zna modelu „${ai.model()}” – popraw AI_MODEL w .env i uruchom bota ponownie. Asystent wstrzymany do ${until}.`,
    config: `🤖 Asystent AI: Claude API odrzuciło klucz ANTHROPIC_API_KEY albo nie zna modelu AI_MODEL – sprawdź .env. Asystent wstrzymany do ${until}.`,
    billing: `🤖 Asystent AI: brak środków na koncie Anthropic (console.anthropic.com → Billing) – asystent wstrzymany do ${until}.`,
  };
  console.error(lines[kind]);
}

async function failed(channel, err) {
  const kind = err ? classify(err) : 'transient';
  const failures = (db.getTicket(channel.id)?.ai?.failures ?? 0) + 1;
  patchAi(channel.id, { failures });
  const breaks = ['limit', 'auth', 'model', 'config', 'billing'].includes(kind);
  if (breaks) {
    pauseFor(kind, kind === 'limit' ? err?.retryAfterMs ?? 60_000 : KEY_PAUSE_MS);
    announcePause(kind, err);
  } else if (kind !== 'transient') console.error('[asystent] błąd odpowiedzi:', err);
  else console.warn('[asystent] chwilowy błąd:', errorText(err));

  const ticket = db.getTicket(channel.id);
  await sendTicketLog(channel.guild, {
    embeds: [
      logEmbed(COLORS.danger, kind === 'limit' ? '⏸️ Asystent AI: skończył się darmowy limit' : '⚠️ Asystent AI: błąd').addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket?.number ?? 0)}\`)`, inline: true },
        { name: breaks ? 'Przerwa do' : 'Próba', value: breaks ? ts(paused()?.until ?? Date.now(), 'f') : `${failures} z ${MAX_FAILURES}`, inline: true },
        { name: 'Błąd', value: errorText(err) },
      ),
    ],
  });
  if (breaks) return takeBreak(channel, kind);
  if (kind === 'transient' && failures < MAX_FAILURES) {
    await channel
      .send({ content: `⚠️ Mam chwilowy problem z odpowiedzią. Napisz proszę jeszcze raz za chwilę – albo napisz „człowiek”, a zawołam zespół.\n${FOOTER}`, allowedMentions: { parse: [] } })
      .catch(() => null);
    return;
  }
  await escalate(channel, { reason: 'Asystent AI ma problem techniczny i nie może teraz odpowiedzieć.', source: 'error' });
}

/**
 * The assistant has a break (free limit, rejected key or model) while a ticket waits for it: say so, call the team –
 * and in a „Odbierz nagrodę” ticket offer the claim buttons of the no-AI mode, so a winner doesn't have to wait.
 */
async function takeBreak(channel, kind = paused()?.reason) {
  const ticket = db.getTicket(channel.id);
  if (!ticket || ticket.ai?.stopped) return;
  if (kind === 'limit') await channel.send({ content: `${LIMIT_TEXT}\n${FOOTER}`, allowedMentions: { parse: [] } }).catch(() => null);
  await escalate(channel, {
    reason: kind === 'limit' ? 'Skończył się darmowy limit asystenta AI – sprawą musi zająć się zespół.' : 'Asystent AI ma przerwę (problem z kluczem albo modelem AI) i nie może odpowiedzieć.',
    source: kind === 'limit' ? 'free-limit' : 'error',
  });
  if (ticket.typeId === 'reward' && !db.getTicket(channel.id)?.ai?.panelId) await showRewardPanel(channel);
}

// ───────────── Calling the team ─────────────

const SOURCES = {
  ai: 'decyzja asystenta',
  keyword: 'autor poprosił o człowieka',
  button: 'przycisk „Zawołaj zespół”',
  prize: 'nagroda do wydania ręcznie',
  refusal: 'asystent nie mógł pomóc',
  limit: 'limit odpowiedzi',
  'free-limit': 'skończył się darmowy limit AI',
  error: 'błąd asystenta',
};

/** The founder, co-owner and support roles plus the ticket type's own staff roles – who gets the ping. */
function pingRoles(guild, type) {
  const keys = ['founder', 'coowner', 'support', ...(type?.staffRoles ?? [])];
  const ids = [...keys.map((k) => db.roleId(guild.id, k)), ...(type?.staffRoleIds ?? [])].filter((id) => id && guild.roles.cache.has(id));
  const list = ids.length ? ids : perms.alertRoleIds(guild.id, type).filter((id) => guild.roles.cache.has(id));
  return [...new Set(list)];
}

/** "Calling the team": a ping in the ticket, "help is coming", the assistant off here. → false when the team was just called. */
async function escalate(channel, { reason = '', source = 'ai', force = false } = {}) {
  const guild = channel.guild;
  const ticket = db.getTicket(channel.id);
  if (!ticket) return false;
  clearTimer(channel.id);
  const before = ticket.ai ?? {};
  const again = before.escalatedAt && Date.now() - before.escalatedAt < ESCALATE_AGAIN_MS;
  patchAi(channel.id, { active: false, stopped: 'escalated', escalatedAt: again ? before.escalatedAt : Date.now() });
  if (again && !force) return false; // force: a second prize to hand out is a new matter

  const type = config.getType(ticket.typeId);
  const roles = pingRoles(guild, type);
  const users = ticket.claimedBy ? [ticket.claimedBy] : [];
  const who = [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' ') || 'Zespół';
  const why = truncate(clean(reason).replace(/\n+/g, ' '), 300);
  await channel
    .send(
      notice(
        COLORS.warning,
        `### 🙋 Wołam zespół\n${who} – <@${ticket.ownerId}> potrzebuje pomocy.\n${why ? `> ${why}\n` : ''}` +
          'Zaraz ktoś z zespołu Ci pomoże – zwykle odpisujemy w ciągu kilku godzin. 🧡\n-# 🤖 Asystent AI nie odpowiada już w tym tickecie.',
        { mentions: { roles, users }, buttons: [btn('ai:on', 'Włącz asystenta ponownie', '🤖')] },
      ),
    )
    .catch((err) => console.warn('[asystent] nie udało się zawołać zespołu:', err.message));
  const owner = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  await sendTicketLog(guild, {
    embeds: [
      logEmbed(COLORS.warning, '🙋 Asystent AI wezwał zespół', owner).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Autor', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Dlaczego', value: SOURCES[source] ?? source, inline: true },
        { name: 'Powód', value: why || '—' },
      ),
    ],
  });
  return true;
}

// ───────────── Prizes ─────────────

/** A Hammer+ code from a giveaway: in the ticket, by DM, the 💎 role, and a line in the ticket log (never the code). */
async function deliverCode(channel, ticket, { code, record, days, gw }) {
  const guild = channel.guild;
  const howTo = 'Wpisz go w Hammer Launcherze: **Hammer+ → „Mam kod”** → wklej → **Aktywuj**.';
  const where = `-# Kod działa tylko na koncie Minecraft \`${record.nick}\` · ważny ${hammerplus.validity(record.exp)}`;
  // The prize is already written down as claimed – a failed post must not look like "nothing happened" to the model.
  await channel
    .send(
      notice(COLORS.success, `## 🎁 Twoja nagroda: Hammer+ ${prizes.plusLength(days)}\n<@${ticket.ownerId}>, gratulacje wygranej w giveawayu **${gw.prize}**! Oto Twój kod:\n\`\`\`\n${code}\n\`\`\`\n${howTo}\n${where} · wysłaliśmy go też w wiadomości prywatnej.`, {
        mentions: { users: [ticket.ownerId] },
      }),
    )
    .catch((err) => console.warn('[asystent] nie udało się wysłać kodu Hammer+ w tickecie:', err.message));
  const owner = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  await owner
    ?.send?.(notice(COLORS.success, `## 🎁 Hammer+ z giveawayu na ${guild.name}\nGratulacje! Nagroda z giveawayu **${gw.prize}** – Twój kod:\n\`\`\`\n${code}\n\`\`\`\n${howTo}\n${where}`))
    ?.catch?.(() => null);
  const role = await require('./plusrole').sync(guild, ticket.ownerId).catch(() => 'failed');
  await sendTicketLog(guild, {
    embeds: [
      logEmbed(COLORS.success, '🎁 Asystent AI wydał nagrodę', owner).addFields(
        { name: 'Ticket', value: `${channel} (\`#${pad(ticket.number)}\`)`, inline: true },
        { name: 'Zwycięzca', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'Giveaway', value: truncate(`${gw.prize} (\`${gw.id}\`)`, 1024), inline: true },
        { name: 'Hammer+', value: `\`${record.nick}\` · ${hammerplus.validity(record.exp)} · ID \`${record.id}\``, inline: true },
        { name: 'Ranga 💎', value: role === 'added' || role === 'kept' ? 'nadana' : role === 'not-member' ? 'nie ma go na serwerze' : '—', inline: true },
      ),
    ],
  });
}

// ───────────── No-AI mode: prizes with buttons ─────────────

const PRIZE_ERRORS = {
  'not-found': 'Tego giveawayu już nie ma.',
  'not-ended': 'Ten giveaway jeszcze trwa – zwycięzców bot wylosuje, gdy skończy się czas.',
  'not-winner': 'Nie wygrałeś/aś tego giveawayu, więc nie możesz odebrać tej nagrody.',
  busy: 'Ta nagroda właśnie się wydaje – chwilka.',
};

function prizeError(r) {
  if (r.result !== 'already') return PRIZE_ERRORS[r.result] ?? 'Nie udało się odebrać nagrody.';
  return r.claim.status === 'granted'
    ? `Ta nagroda została już odebrana – kod Hammer+ dla konta \`${r.claim.nick}\` jest wyżej w tickecie i w Twoich wiadomościach prywatnych.`
    : 'Ta nagroda jest już zgłoszona zespołowi – wyda ją ręcznie.';
}

/** The author's unclaimed wins, a claim button each (prizes.js decides what can be claimed). after: right after a claim. */
function rewardPanel(guild, ticket, { after = false } = {}) {
  const list = prizes.claimable(guild.id, ticket.ownerId).slice(0, 10);
  if (!list.length) {
    return after
      ? notice(COLORS.success, '### ✅ Nagrody odebrane\nKody i zgłoszenia znajdziesz wyżej w tym tickecie.')
      : notice(COLORS.muted, '### 🔍 Nie znalazłem Twojej wygranej\nNa tym koncie Discord nie ma nieodebranej nagrody z giveawayu. Jeśli to pomyłka, zespół to sprawdzi i odpisze tutaj.');
  }
  const lines = list.map((gw) => {
    const prize = prizes.prizeOf(gw);
    const late = Date.now() > prizes.claimDeadline(gw, ticket.ownerId);
    const how = late ? 'minęło 48 h – o wydaniu zdecyduje zespół' : prize.kind === 'plus' ? `kod Hammer+ od razu (${prizes.plusLength(prize.days)})` : 'wyda zespół';
    return `> 🎁 **${gw.prize}** · ${how}`;
  });
  const c = container(COLORS.brand);
  c.addTextDisplayComponents(
    text(`## 🎁 Twoje wygrane\n${lines.join('\n')}\n-# Kliknij przycisk przy nagrodzie. Hammer+ wydajemy od razu – podasz tylko nick Minecraft (Java Edition). Inne nagrody wyda zespół.`),
  );
  const buttons = [...list.map((gw) => btn(`ai:claim:${gw.id}`, truncate(`Odbierz: ${gw.prize}`, 80), '🎁', ButtonStyle.Success)), btn('ai:human', 'Zawołaj zespół', '🙋')];
  for (let i = 0; i < buttons.length; i += 5) c.addActionRowComponents(row(...buttons.slice(i, i + 5)));
  return v2(c);
}

async function showRewardPanel(channel) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) return null;
  const msg = await channel.send(rewardPanel(channel.guild, ticket)).catch((err) => (console.warn('[asystent] lista nagród:', err.message), null));
  if (msg) patchAi(channel.id, { panelId: msg.id });
  return msg;
}

async function refreshPanel(channel) {
  const ticket = db.getTicket(channel.id);
  const msg = ticket?.ai?.panelId ? await channel.messages.fetch(ticket.ai.panelId).catch(() => null) : null;
  await msg?.edit(rewardPanel(channel.guild, ticket, { after: true })).catch(() => null);
}

/** The ticket a claim button / form belongs to – only its author (the winner) may use it. */
function claimTicket(interaction) {
  const ticket = db.getTicket(interaction.channel?.id);
  if (!ticket) throw new UserError('To działa tylko w tickecie.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty.');
  if (interaction.user.id !== ticket.ownerId) throw new UserError('Nagrodę może odebrać tylko autor ticketu – osoba, która wygrała.');
  return ticket;
}

function nickForm(gwId, ticket) {
  const known = String((ticket.answers ?? []).find((a) => /nick/i.test(a?.label ?? ''))?.value ?? '').trim();
  const { labeledInput } = require('../tickets/tickets'); // here – tickets.js loads features itself
  return new ModalBuilder()
    .setCustomId(`ai:nick:${gwId}`)
    .setTitle('🎁 Odbierz Hammer+')
    .addLabelComponents(
      labeledInput(
        { id: 'nick', label: 'Twój nick w Minecraft (Java Edition)', description: 'Kod Hammer+ zadziała tylko na tym koncie.', style: 'short', placeholder: 'Np. Notch', maxLength: 16 },
        { value: NICK.test(known) ? known : undefined },
      ),
    );
}

/** „Odbierz: …” – a Hammer+ asks for the nick first, any other prize goes to the team at once. */
async function claimButton(interaction, gwId) {
  const ticket = claimTicket(interaction);
  const check = prizes.precheck({ guildId: interaction.guild.id, userId: ticket.ownerId, giveawayId: gwId });
  if (check.result !== 'ok') throw new UserError(prizeError(check));
  if (check.needsNick) return interaction.showModal(nickForm(check.gw.id, ticket));
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return finishClaim(interaction, ticket, check.gw.id, null);
}

async function nickSubmit(interaction, gwId) {
  const ticket = claimTicket(interaction);
  const nick = String(interaction.fields.getTextInputValue('nick') ?? '').trim();
  if (!NICK.test(nick)) throw new UserError('Nick Minecraft ma najwyżej 16 znaków: litery, cyfry i podkreślenie (_).');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }); // asking Mojang can take a few seconds
  return finishClaim(interaction, ticket, gwId, nick);
}

/** The same hand-out as the AI's odbierz_nagrode: every check in prizes.claim, the code like deliverCode does it. */
async function finishClaim(interaction, ticket, gwId, nick) {
  const channel = interaction.channel;
  const r = await prizes.claim({ guildId: interaction.guild.id, userId: ticket.ownerId, giveawayId: gwId, nick, botId: interaction.client?.user?.id ?? null, channelId: channel.id });
  if (r.result === 'granted') {
    await deliverCode(channel, ticket, r);
    await refreshPanel(channel);
    return reply(interaction, `Gotowe! Kod Hammer+ dla konta \`${r.record.nick}\` jest w tickecie i w Twoich wiadomościach prywatnych.`);
  }
  if (r.result === 'reported') {
    await escalate(channel, { reason: `Nagroda do wydania ręcznie: „${r.gw.prize}” (giveaway ${r.gw.id}) – ${REPORT_WHY[r.why] ?? r.why}.`, source: 'prize', force: true });
    await refreshPanel(channel);
    return reply(interaction, 'Zgłosiłem nagrodę zespołowi – wyda ją ręcznie. Zespół został zawołany do ticketu.');
  }
  if (r.result === 'bad-nick') throw new UserError(r.error);
  if (r.result === 'need-nick') throw new UserError('Do tej nagrody potrzebny jest nick Minecraft – kliknij przycisk jeszcze raz.');
  throw new UserError(prizeError(r));
}

// ───────────── Staff switches ─────────────

/** Staff turn the assistant on / off in one ticket (button or /asystent ticket). */
async function setTicket(channel, on, actor) {
  const ticket = db.getTicket(channel.id);
  if (!ticket) throw new UserError('Tego można użyć tylko na kanale ticketu.');
  if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty.');
  const by = actor?.toString?.() ?? 'zespół';
  if (on) {
    const why = unavailableText() ?? pauseText();
    if (why) throw new UserError(why);
    if (!globallyOn(channel.guild.id)) throw new UserError(`Asystent jest wyłączony na całym serwerze – najpierw \`${slash('assistant on')}\`.`);
    if (!eligible(config.getType(ticket.typeId))) throw new UserError('W tym rodzaju ticketu asystent nie działa.');
    if (ticket.ai?.active) throw new UserError('Asystent już odpowiada w tym tickecie.');
    // Only what the author writes from now on is new – older messages were answered by the team.
    const latest = await channel.messages.fetch({ limit: 1 }).catch(() => null);
    patchAi(channel.id, { mode: 'ai', active: true, stopped: null, failures: 0, resumedAt: Date.now(), escalatedAt: null, greeted: true, answeredUpTo: latest?.first?.()?.id ?? ticket.ai?.answeredUpTo ?? null, replies: 0 });
  } else {
    if (!ticket.ai?.active) throw new UserError('Asystent nie odpowiada w tym tickecie.');
    stop(channel, 'manual');
  }
  await channel.send(notice(on ? COLORS.brand : COLORS.muted, on ? `🤖 Asystent AI znów odpowiada w tym tickecie – włącza go ${by}.` : `🔕 Asystent AI nie odpowiada już w tym tickecie – wyłącza go ${by}.`)).catch(() => null);
  await sendTicketLog(channel.guild, {
    embeds: [logEmbed(on ? COLORS.brand : COLORS.muted, on ? '🤖 Asystent AI włączony w tickecie' : '🔕 Asystent AI wyłączony w tickecie', actor?.user ?? actor).setDescription(`${by} · ${channel} (\`#${pad(ticket.number)}\`)`)],
  });
}

/** For /asystent status. */
function status(guild, channel = null) {
  const open = db.tickets((t) => t.guildId === guild.id && t.status === 'open');
  const ticket = channel ? db.getTicket(channel.id) : null;
  return {
    problem: unavailableText(),
    provider: ai.provider(),
    providerLabel: ai.label(),
    pause: paused(),
    pauseText: pauseText(),
    model: ai.model(),
    global: globallyOn(guild.id),
    activeTickets: open.filter((t) => t.ai?.active).length,
    ticket: ticket ? { open: ticket.status === 'open', ...(ticket.ai ?? {}) } : null,
    maxReplies: MAX_REPLIES,
  };
}

// ───────────── Events ─────────────

hooks.on('ticketOpened', async ({ guild, channel, ticket, type }) => {
  if (!guild || !channel || !ticket || !profile.launcher || !eligible(type)) return;
  if (activeIn(guild.id)) {
    patchAi(channel.id, { mode: 'ai', active: true, stopped: null, replies: 0, msgIds: [], failures: 0, greeted: false, answeredUpTo: null, since: Date.now() });
    schedule(channel, timing.open);
    return;
  }
  // No-AI mode (no key, a break, or switched off): prizes with buttons, „człowiek” still calls the team.
  patchAi(channel.id, { mode: 'noai', active: false, stopped: null, since: Date.now() });
  if (type.id === 'reward') await showRewardPanel(channel);
});

async function onMessage(message) {
  if (!message.guild || !message.author || message.author.bot) return;
  const ticket = db.getTicket(message.channel?.id);
  // stopped: a human took over, the team was called or staff switched it off – the bot stays out of it.
  if (!ticket?.ai || ticket.ai.stopped || ticket.status !== 'open') return;
  const channel = message.channel;
  if (message.author.id !== ticket.ownerId) {
    const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
    if (isStaff(member, config.getType(ticket.typeId))) stop(channel, 'staff'); // a human took over
    return;
  }
  if (humanTookOver(ticket)) return stop(channel, 'staff');
  if (asksForHuman(message.content)) {
    await escalate(channel, { reason: 'Autor ticketu prosi o rozmowę z kimś z zespołu.', source: 'keyword' }); // with or without AI
    return;
  }
  if (!ticket.ai.active) return; // no-AI mode
  if (activeIn(message.guild.id)) return schedule(channel, timing.debounce);
  if (paused() && globallyOn(message.guild.id)) await takeBreak(channel); // it answered here before – say why it doesn't now
}
hooks.on('messageCreate', (message) => onMessage(message).catch((err) => console.warn('[asystent]', err.message)));

hooks.route('ai', {
  async button(interaction, action, args = []) {
    if (action === 'claim') return claimButton(interaction, args[0]);
    const ticket = db.getTicket(interaction.channel?.id);
    if (!ticket) throw new UserError('To działa tylko w tickecie.');
    const staff = isStaff(interaction.member, config.getType(ticket.typeId));
    if (action === 'human') {
      if (interaction.user.id !== ticket.ownerId && !staff) throw new UserError('Ten przycisk jest dla autora ticketu.');
      if (ticket.status !== 'open') throw new UserError('Ten ticket jest zamknięty.');
      if (ticket.ai?.stopped === 'staff') return reply(interaction, 'Ktoś z zespołu już zajmuje się Twoim ticketem – odpowie tutaj.');
      const called = await escalate(interaction.channel, { reason: 'Autor ticketu kliknął „Zawołaj zespół”.', source: 'button' });
      return reply(interaction, called ? 'Zespół został zawołany – zaraz ktoś Ci pomoże.' : 'Zespół jest już powiadomiony – zaraz ktoś Ci pomoże.');
    }
    if (action !== 'on' && action !== 'off') return null;
    if (!staff) throw new UserError('Asystenta w tickecie może włączyć albo wyłączyć tylko zespół.');
    await setTicket(interaction.channel, action === 'on', interaction.member);
    return reply(interaction, action === 'on' ? 'Asystent AI znów odpowiada w tym tickecie.' : 'Asystent AI wyłączony w tym tickecie.');
  },
  async modal(interaction, action, args = []) {
    if (action === 'nick') return nickSubmit(interaction, args[0]);
    return null;
  },
});

hooks.on('ready', () => {
  if (!profile.launcher) return;
  const p = ai.problem();
  if (p === 'no-key') {
    console.warn('🤖 Asystent AI: brak klucza w .env – asystent w ticketach jest wyłączony. Nagrody z giveawayów odbiera się przyciskami, a „człowiek” woła zespół. Darmowy klucz: GROQ_API_KEY z console.groq.com (README → „Asystent AI w ticketach”).');
  } else if (p) console.warn(`🤖 Asystent AI jest wyłączony: ${PROBLEMS[p].replace(/`/g, '')}`);
  else console.log(`🤖 Asystent AI w ticketach: ${ai.label()} · model ${ai.model()}${ai.provider() === 'claude' ? ' · odmowy obsługuje model zapasowy' : ''}.`);
});

// ───────────── Tests ─────────────

/** Waits until no answer is scheduled or running. */
async function settle() {
  for (let i = 0; i < 100; i += 1) {
    const waiting = [...channels.values()].some((s) => s.timer || s.running);
    if (!waiting && !pending.size) return;
    await Promise.all([...pending]);
    await new Promise((resolve) => setTimeout(resolve, Math.max(timing.debounce, timing.open) + 2));
  }
}

function _reset() {
  for (const id of channels.keys()) clearTimer(id);
  channels.clear();
  repliesTo.clear();
  pause = null;
}

module.exports = {
  setClient: ai.setClient,
  available,
  paused,
  pauseText,
  rewardPanel,
  activeIn,
  globallyOn,
  setGlobal,
  setTicket,
  status,
  escalate,
  unavailableText,
  buildConversation,
  request,
  echoable,
  classify,
  settle,
  timing,
  _reset,
  MAX_REPLIES,
  HOURLY_CAP,
};
