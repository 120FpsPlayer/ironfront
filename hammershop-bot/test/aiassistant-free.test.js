'use strict';

// 🤖 The AI assistant on the free providers (Groq, any OpenAI-compatible API) and without AI at all. Groq is a fake
// fetch – nothing leaves the computer. This file runs in its own process, so the profile is set before anything loads.
process.env.HS_TEST_PROFILE = 'launcher';
for (const key of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'AI_API_KEY']) delete process.env[key];

const { db } = require('./helpers/setup');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { FakeGuild } = require('./helpers/fakeDiscord');
const { createInteraction, lastResponse, textOf, customIds } = require('./helpers/fakeInteraction');
const { buildServer } = require('../src/builder/executor');
const { env } = require('../src/env');
const config = require('../src/lib/config');
const hooks = require('../src/lib/hooks');
const tickets = require('../src/tickets/tickets');
const handle = require('../src/handlers/interactions');
const loadCommands = require('../src/commands');
const hammerplus = require('../src/features/hammerplus');
const assistant = require('../src/features/aiassistant');
const ai = require('../src/features/ai/client');
const openai = require('../src/features/ai/openai');
const { SYSTEM_PROMPT } = require('../src/features/ai/prompt');
const assistantCommand = require('../src/commands/assistant');

env.plusPrivateKey = crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
assistant.timing.debounce = 5;
assistant.timing.open = 5;
openai.setRetryDelay(0);
openai.setShortWait(0); // every 429 starts a break here – the short wait has its own test
const commands = loadCommands();
const LIMIT_TEXT = 'Asystent AI ma teraz przerwę – skończył się darmowy limit. Zawołałem zespół, ktoś zaraz odpisze.';

hammerplus.setFetch(async (url) => {
  const name = decodeURIComponent(String(url).split('/').pop());
  return { ok: true, status: 200, json: async () => ({ id: crypto.createHash('md5').update(name).digest('hex'), name }) };
});

let guild;
let n = 932000000000000000n;
const uid = () => String(++n);
const role = (key) => db.roleId(guild.id, key);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Which keys .env has in this test – everything else is removed. */
function useEnv(values = {}) {
  for (const key of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'AI_PROVIDER', 'AI_MODEL', 'AI_BASE_URL', 'AI_API_KEY']) delete process.env[key];
  Object.assign(process.env, values);
}

async function server(values = { GROQ_API_KEY: 'gsk_test_key' }) {
  if (!guild) {
    guild = new FakeGuild();
    await buildServer({ guild, mode: 'add', invokerId: guild.ownerId });
  }
  assistant.setClient(null);
  assistant._reset();
  db.guild(guild.id).aiAssistant = { enabled: true };
  useEnv(values);
  openai.setFetch(async (url) => {
    throw new Error(`unexpected AI request: ${url}`);
  });
  return guild;
}

/** A fake Groq: answers from the script in order (a chat/completions body, or { status, headers, body }). */
function groq(...script) {
  const calls = [];
  openai.setFetch(async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    const next = script.shift();
    if (!next) throw new Error('fake Groq: nothing more in the script');
    const { status = 200, headers = {}, body } = next;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  });
  return calls;
}
const chat = (message, finish = 'stop') => ({ body: { id: 'chatcmpl-x', model: 'openai/gpt-oss-120b', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: finish }], usage: { prompt_tokens: 900, completion_tokens: 40 } } });
const say = (content) => chat({ content });
const callTools = (...calls) => chat({ content: null, tool_calls: calls.map(([name, args, id]) => ({ id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } })) }, 'tool_calls');

async function open(typeId, answers = [], author = guild.addMember(uid(), [role('member')])) {
  const channel = await tickets.openTicket(author, config.getType(typeId), answers.map(([label, value]) => ({ label, value })));
  await assistant.settle();
  return { author, channel };
}
async function write(channel, member, text) {
  const msg = channel.userMessage(member.id, text);
  msg.member = member;
  await hooks.emit('messageCreate', msg);
  await assistant.settle();
}
const aiOf = (channel) => db.getTicket(channel.id).ai;
const botMessages = (channel) => channel.messageList.filter((m) => m.author.id === guild.client.user.id);
const botTexts = (channel) => botMessages(channel).map((m) => textOf(m.body));
const panelOf = (channel) => botMessages(channel).find((m) => /Twoje wygrane|Nagrody odebrane/.test(textOf(m.body)));
const ticketLog = () => guild.channels.cache.get(db.channelId(guild.id, 'ticketLogs')).messageList.map((m) => textOf(m.body));
const toolMessages = (call) => call.body.messages.filter((m) => m.role === 'tool');

function giveaway({ prize, winners, entries = winners, plusDays = null, endsAt = Date.now() - 60_000, ended = true, claims }) {
  const id = crypto.randomBytes(4).toString('hex');
  const gw = { id, guildId: guild.id, channelId: '1', messageId: null, prize, description: null, winnersCount: winners.length || 1, endsAt, hostId: guild.ownerId, requiredRoleId: null, buyersOnly: false, minInvites: null, plusDays, entries, winners, ended, createdAt: endsAt - 86_400_000, ...(claims && { claims }) };
  db.guild(guild.id).giveaways[id] = gw;
  return gw;
}

/** A click or a form through the bot's real interaction router (errors come back as the user sees them). */
async function click(member, channel, customId, { kind = 'button', fields, message } = {}) {
  const interaction = createInteraction({ guild, member, kind, customId, channel, fields, message });
  await handle(interaction, commands);
  return interaction;
}

test('Groq is the default with GROQ_API_KEY: an OpenAI-style request without anything only Claude knows', async () => {
  await server();
  assert.deepEqual([ai.provider(), ai.model()], ['groq', 'openai/gpt-oss-120b']);
  const calls = groq(say('Cześć! Jestem asystentem AI. Wyślij proszę log z Konsola → Udostępnij log.'));
  const { channel } = await open('support', [['Temat', 'Gra się nie uruchamia'], ['Wersja launchera i Minecrafta', '2.6.0, 1.21.4 Fabric'], ['Opisz dokładnie, co się dzieje', 'Czarny ekran']]);

  assert.equal(calls.length, 1);
  const [req] = calls;
  assert.equal(req.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(req.headers.authorization, 'Bearer gsk_test_key');
  assert.equal(req.body.model, 'openai/gpt-oss-120b');
  assert.equal(req.body.tool_choice, 'auto');
  assert.equal(req.body.reasoning_effort, 'low');
  assert.ok(req.body.max_tokens <= openai.MAX_OUTPUT);
  assert.deepEqual(req.body.tools.map((t) => [t.type, t.function.name]), [['function', 'info_launchera'], ['function', 'moje_wygrane'], ['function', 'odbierz_nagrode'], ['function', 'wezwij_zespol']]);
  for (const t of req.body.tools) {
    assert.ok(t.function.description.length > 20);
    assert.equal(t.function.parameters.type, 'object');
  }
  const raw = JSON.stringify(req.body);
  for (const claudeOnly of ['cache_control', 'betas', 'fallbacks', 'output_config', '"strict"', 'additionalProperties', 'thinking']) assert.equal(raw.includes(claudeOnly), false, claudeOnly);
  assert.deepEqual(req.body.messages[0], { role: 'system', content: SYSTEM_PROMPT });
  assert.equal(req.body.messages[1].role, 'user');
  assert.match(req.body.messages[1].content, /Czarny ekran/);
  const context = req.body.messages.at(-1);
  assert.equal(context.role, 'system', 'the mid-conversation system message stays a system message');
  assert.match(context.content, /ticket typu support/);
  assert.match(botTexts(channel).join('\n'), /Cześć! Jestem asystentem AI/);

  const status = createInteraction({ guild, member: guild.members.cache.get(guild.ownerId), kind: 'command', commandName: 'assistant', subcommand: 'status', channel });
  await assistantCommand.execute(status);
  assert.match(textOf(lastResponse(status)), /Groq \(darmowy\)[\s\S]*openai\/gpt-oss-120b/);
});

test('Groq tool calls: moje_wygrane → odbierz_nagrode hands out a Hammer+ code (tool results come back as role "tool")', async () => {
  await server();
  const author = guild.addMember(uid(), [role('member')]);
  const gw = giveaway({ prize: 'Hammer+ na miesiąc', winners: [author.id], plusDays: 30 });
  const calls = groq(callTools(['moje_wygrane', {}, 'call_1']), callTools(['odbierz_nagrode', { giveawayId: gw.id, minecraftNick: 'Steve' }, 'call_2']), say('Gotowe! Kod masz wyżej – wpisz go w launcherze: Hammer+ → „Mam kod”.'));
  const { channel } = await open('reward', [['Który giveaway wygrałeś/aś?', 'Hammer+ na miesiąc'], ['Twój nick w Minecraft', 'Steve']], author);

  assert.equal(calls.length, 3);
  const second = calls[1].body.messages;
  const at = second.findIndex((m) => m.role === 'assistant' && m.tool_calls?.[0]?.id === 'call_1');
  assert.ok(at > 0);
  assert.equal(second[at - 1].role, 'system', 'the context message stays where it was');
  assert.equal(second[at].content, null);
  assert.equal(second[at].tool_calls[0].function.arguments, '{}', 'arguments are a JSON string');
  assert.deepEqual([second[at + 1].role, second[at + 1].tool_call_id, second[at + 1].name], ['tool', 'call_1', 'moje_wygrane']);
  assert.equal(JSON.parse(second[at + 1].content).wygrane[0].id, gw.id);
  const granted = toolMessages(calls[2]).at(-1);
  assert.equal(granted.tool_call_id, 'call_2');
  assert.match(granted.content, /Kod Hammer\+ \(30 dni\) dla konta Minecraft Steve/);
  assert.doesNotMatch(granted.content, /HP1\./, 'the code never goes to the model');

  assert.ok(botTexts(channel).some((t) => /Twoja nagroda: Hammer\+ 30 dni/.test(t) && /HP1\./.test(t)));
  assert.match(textOf(guild.dms.filter((d) => d.to === author.id).at(-1).payload), /HP1\./);
  assert.equal(gw.claims[author.id].status, 'granted');
  assert.ok(ticketLog().some((t) => /Asystent AI wydał nagrodę/.test(t) && !/HP1\./.test(t)));
});

test('broken tool JSON from a free model: an error tool result and another try – never a crash; Groq\'s tool_use_failed is retried', async () => {
  await server();
  const calls = groq(callTools(['moje_wygrane', '{"giveawayId": "ab', 'c1']), say('Przepraszam – spróbujmy jeszcze raz. Czego dotyczy problem?'));
  const { channel } = await open('support');
  assert.equal(calls.length, 2);
  const [toolMsg] = toolMessages(calls[1]);
  assert.equal(toolMsg.tool_call_id, 'c1');
  assert.match(toolMsg.content, /poprawnym JSON/);
  assert.equal(calls[1].body.messages.find((m) => m.tool_calls)?.tool_calls[0].function.arguments, '{}');
  assert.ok(botTexts(channel).some((t) => /spróbujmy jeszcze raz/.test(t)));

  const retried = groq({ status: 400, body: { error: { message: 'Failed to call a function. Please adjust your prompt.', type: 'invalid_request_error', code: 'tool_use_failed' } } }, say('Cześć!'));
  const second = await open('support');
  assert.equal(retried.length, 2, 'one more try after tool_use_failed');
  assert.equal(aiOf(second.channel).active, true);
  assert.ok(botTexts(second.channel).some((t) => /^Cześć!/.test(t)));
});

test('429 (free limit): the assistant takes a break until retry-after, says so, calls the team – and comes back', async () => {
  await server();
  const calls = groq(say('Cześć!'), { status: 429, headers: { 'retry-after': '1' }, body: { error: { message: 'Rate limit reached for model openai/gpt-oss-120b', type: 'tokens', code: 'rate_limit_exceeded' } } });
  const { channel, author } = await open('support');
  await write(channel, author, 'mody mi się nie instalują');
  assert.equal(calls.length, 2);
  assert.ok(botTexts(channel).some((t) => t.startsWith(LIMIT_TEXT)), 'the exact message about the break');
  const ping = botMessages(channel).find((m) => /Wołam zespół/.test(textOf(m.body)));
  assert.ok(ping, 'the team is called');
  assert.ok(ping.body.allowedMentions.roles.includes(role('support')));
  assert.equal(aiOf(channel).stopped, 'escalated');
  assert.equal(assistant.paused().reason, 'limit');
  assert.ok(assistant.paused().until - Date.now() <= 1100);
  assert.ok(ticketLog().some((t) => /skończył się darmowy limit/.test(t)));
  assert.equal(assistant.available(), false);

  // During the break: no AI calls; a winner still gets the claim buttons.
  const winner = guild.addMember(uid(), [role('member')]);
  const gw = giveaway({ prize: 'Hammer+ 30 dni', winners: [winner.id] });
  const reward = await open('reward', [], winner);
  assert.equal(calls.length, 2);
  assert.deepEqual(customIds(panelOf(reward.channel).body), [`ai:claim:${gw.id}`, 'ai:human']);

  // After it: answers again.
  await sleep(1100);
  assert.equal(assistant.paused(), null);
  const back = groq(say('Jestem z powrotem!'));
  const later = await open('support');
  assert.equal(back.length, 1);
  assert.ok(botTexts(later.channel).some((t) => /Jestem z powrotem!/.test(t)));
});

test('a per-minute limit that frees up within seconds is waited out once – no break, no ping', async () => {
  await server();
  openai.setShortWait(2000);
  try {
    const calls = groq({ status: 429, headers: { 'retry-after': '0.05' }, body: { error: { message: 'Rate limit reached (tokens per minute)', code: 'rate_limit_exceeded' } } }, say('Cześć!'));
    const { channel } = await open('support');
    assert.equal(calls.length, 2);
    assert.equal(assistant.paused(), null);
    assert.equal(aiOf(channel).active, true);
    assert.equal(botTexts(channel).some((t) => /Wołam zespół|przerwę/.test(t)), false);
  } finally {
    openai.setShortWait(0);
  }
});

test('how long a break lasts: retry-after or the reset of the exhausted limit, never more than an hour', () => {
  assert.equal(openai.retryAfter(new Headers({ 'retry-after': '30' })), 30_000);
  assert.equal(openai.retryAfter(new Headers({ 'retry-after': '86400' })), 3_600_000);
  assert.equal(openai.retryAfter(new Headers({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '2m59.56s', 'x-ratelimit-remaining-requests': '12', 'x-ratelimit-reset-requests': '1s' })), 179_560);
  assert.equal(openai.retryAfter(new Headers()), 60_000);
  assert.equal(openai.parseDuration('1h2m'), 3_720_000);
  assert.equal(openai.parseDuration('350ms'), 350);
});

test('401 (a bad key): a clear console message, the assistant pauses, the ticket goes to the team', async (t) => {
  await server();
  const errors = t.mock.method(console, 'error', () => {});
  groq({ status: 401, body: { error: { message: 'Invalid API Key', type: 'invalid_request_error', code: 'invalid_api_key' } } });
  const { channel } = await open('support');
  assert.equal(assistant.paused().reason, 'auth');
  assert.ok(errors.mock.calls.some((c) => /GROQ_API_KEY/.test(c.arguments[0]) && /uruchom bota ponownie/.test(c.arguments[0])));
  assert.equal(aiOf(channel).stopped, 'escalated');
  const status = createInteraction({ guild, member: guild.members.cache.get(guild.ownerId), kind: 'command', commandName: 'assistant', subcommand: 'status', channel });
  await assistantCommand.execute(status);
  assert.match(textOf(lastResponse(status)), /ma przerwę do[\s\S]*klucz API został odrzucony/);
  assert.match(textOf(lastResponse(status)), /Przerwa ⏸️ do/);
});

test('a model Groq does not know (404): tells the owner to set AI_MODEL, pauses, and a reward ticket gets the buttons', async (t) => {
  await server({ GROQ_API_KEY: 'gsk_test_key', AI_MODEL: 'llama-stary-model' });
  const errors = t.mock.method(console, 'error', () => {});
  const calls = groq({ status: 404, body: { error: { message: 'The model `llama-stary-model` does not exist or you do not have access to it.', type: 'invalid_request_error', code: 'model_not_found' } } });
  const author = guild.addMember(uid(), [role('member')]);
  const gw = giveaway({ prize: 'Hammer+ 30 dni', winners: [author.id], plusDays: 30 });
  const { channel } = await open('reward', [], author);
  assert.equal(calls[0].body.model, 'llama-stary-model');
  assert.equal(assistant.paused().reason, 'model');
  assert.ok(errors.mock.calls.some((c) => /console\.groq\.com\/docs\/models/.test(c.arguments[0]) && /AI_MODEL=/.test(c.arguments[0])));
  assert.ok(botTexts(channel).some((t) => /Wołam zespół/.test(t)));
  assert.deepEqual(customIds(panelOf(channel).body), [`ai:claim:${gw.id}`, 'ai:human'], 'the no-AI path still works');
});

test('no key: a reward ticket lists only real, unclaimed wins; Hammer+ asks for the nick and issues the code like the AI does', async () => {
  await server({});
  assert.equal(ai.provider(), null);
  const author = guild.addMember(uid(), [role('member')]);
  const other = guild.addMember(uid(), [role('member')]);
  const now = Date.now();
  const plusWin = giveaway({ prize: 'Hammer+ 30 dni', winners: [author.id], plusDays: 30, endsAt: now - 60_000 });
  const nitroWin = giveaway({ prize: 'Discord Nitro', winners: [author.id], endsAt: now - 120_000 });
  giveaway({ prize: 'Hammer+ 7 dni', winners: [author.id], endsAt: now - 180_000, claims: { [author.id]: { status: 'granted', at: now - 100_000, nick: 'Stary' } } });
  const lost = giveaway({ prize: 'Hammer+ na zawsze', winners: [other.id], entries: [other.id, author.id], endsAt: now - 240_000 });
  giveaway({ prize: 'Hammer+ na rok', winners: [], entries: [author.id], ended: false, endsAt: now + 3_600_000 });

  const { channel } = await open('reward', [['Który giveaway wygrałeś/aś?', 'Hammer+'], ['Twój nick w Minecraft', 'Steve']], author);
  const panel = panelOf(channel);
  assert.deepEqual(customIds(panel.body), [`ai:claim:${plusWin.id}`, `ai:claim:${nitroWin.id}`, 'ai:human'], 'only the two real, unclaimed wins');
  assert.match(textOf(panel.body), /Odbierz: Hammer\+ 30 dni[\s\S]*Odbierz: Discord Nitro/);
  assert.equal(aiOf(channel).mode, 'noai');

  // Hammer+ → the nick form (the nick from the ticket form already filled in) → the code.
  const button = await click(author, channel, `ai:claim:${plusWin.id}`, { message: panel });
  const form = button.state.modals[0];
  assert.equal(form.custom_id, `ai:nick:${plusWin.id}`);
  assert.equal(form.components[0].component.value, 'Steve');
  const submit = await click(author, channel, `ai:nick:${plusWin.id}`, { kind: 'modal', fields: { nick: 'Steve' }, message: panel });
  assert.match(textOf(lastResponse(submit)), /Gotowe! Kod Hammer\+ dla konta `Steve`/);
  assert.ok(botTexts(channel).some((t) => /Twoja nagroda: Hammer\+ 30 dni/.test(t) && /HP1\./.test(t)));
  assert.match(textOf(guild.dms.filter((d) => d.to === author.id).at(-1).payload), /HP1\./);
  assert.equal(plusWin.claims[author.id].status, 'granted');
  assert.ok(guild.members.cache.get(author.id).roles.cache.some((r) => r.name === '💎 Hammer+'));
  assert.ok(ticketLog().some((t) => /Asystent AI wydał nagrodę/.test(t) && !/HP1\./.test(t)));
  assert.deepEqual(customIds(panel.body), [`ai:claim:${nitroWin.id}`, 'ai:human'], 'the list is refreshed');

  // Twice is refused – the button and the form.
  const codes = hammerplus.codes(guild.id).length;
  const again = await click(author, channel, `ai:claim:${plusWin.id}`);
  assert.match(textOf(lastResponse(again)), /została już odebrana/);
  const againForm = await click(author, channel, `ai:nick:${plusWin.id}`, { kind: 'modal', fields: { nick: 'Alex' } });
  assert.match(textOf(lastResponse(againForm)), /została już odebrana/);
  assert.equal(hammerplus.codes(guild.id).length, codes);

  // Forged custom IDs: a giveaway the author did not win, a button clicked by somebody else.
  const forged = await click(author, channel, `ai:claim:${lost.id}`);
  assert.match(textOf(lastResponse(forged)), /Nie wygrałeś\/aś tego giveawayu/);
  const forgedForm = await click(author, channel, `ai:nick:${lost.id}`, { kind: 'modal', fields: { nick: 'Haker' } });
  assert.match(textOf(lastResponse(forgedForm)), /Nie wygrałeś\/aś tego giveawayu/);
  const stranger = await click(other, channel, `ai:claim:${nitroWin.id}`);
  assert.match(textOf(lastResponse(stranger)), /tylko autor ticketu/);
  assert.equal(lost.claims, undefined);
  assert.equal(hammerplus.codes(guild.id).length, codes);

  // Nitro → reported, the team is called with the summary.
  const nitro = await click(author, channel, `ai:claim:${nitroWin.id}`);
  assert.match(textOf(lastResponse(nitro)), /Zgłosiłem nagrodę zespołowi/);
  assert.equal(nitroWin.claims[author.id].status, 'reported');
  const call = botMessages(channel).find((m) => /Wołam zespół/.test(textOf(m.body)));
  assert.match(textOf(call.body), /Discord Nitro/);
  assert.ok(call.body.allowedMentions.roles.includes(role('coowner')));
  assert.match(textOf(panel.body), /Nagrody odebrane/);
});

test('no key: no win on this account → a short note without a ping; „człowiek” calls the team', async () => {
  await server({});
  const { channel, author } = await open('reward', [['Który giveaway wygrałeś/aś?', 'Hammer+ 30 dni']]);
  const note = botMessages(channel).find((m) => /Nie znalazłem Twojej wygranej/.test(textOf(m.body)));
  assert.ok(note);
  assert.match(textOf(note.body), /zespół to sprawdzi/);
  assert.deepEqual(note.body.allowedMentions, { parse: [] });
  assert.equal(botTexts(channel).some((t) => /Wołam zespół/.test(t)), false);
  await write(channel, author, 'chcę rozmawiać z prawdziwym człowiekiem');
  assert.ok(botTexts(channel).some((t) => /Wołam zespół/.test(t)));
  await write(channel, author, 'admin!!');
  assert.equal(botTexts(channel).filter((t) => /Wołam zespół/.test(t)).length, 1, 'once per ticket');
});

test('AI_PROVIDER=openai: any OpenAI-compatible API, e.g. Gemini; auto picks Groq first, then Claude', async () => {
  await server({ AI_PROVIDER: 'openai', AI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/openai', AI_API_KEY: 'gemini-test-key', AI_MODEL: 'gemini-2.5-flash' });
  const calls = groq(say('Cześć z Gemini!'));
  await open('support');
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(calls[0].headers.authorization, 'Bearer gemini-test-key');
  assert.equal(calls[0].body.model, 'gemini-2.5-flash');
  assert.equal(calls[0].body.reasoning_effort, undefined, 'only gpt-oss gets reasoning_effort');
  assert.match(ai.label(), /zgodne z OpenAI \(generativelanguage\.googleapis\.com\)/);

  useEnv({ AI_PROVIDER: 'openai', AI_BASE_URL: 'https://example.com/v1' });
  assert.equal(ai.problem(), 'openai-incomplete');
  assert.match(assistant.unavailableText(), /AI_BASE_URL.*AI_API_KEY.*AI_MODEL/);
  useEnv({ ANTHROPIC_API_KEY: 'sk-ant-test' });
  assert.deepEqual([ai.provider(), ai.model()], ['claude', 'claude-opus-5-5']);
  useEnv({ ANTHROPIC_API_KEY: 'sk-ant-test', GROQ_API_KEY: 'gsk_x' });
  assert.equal(ai.provider(), 'groq');
  useEnv({ AI_PROVIDER: 'gemini' });
  assert.equal(ai.problem(), 'bad-provider');
  useEnv({});
});

test('the adapter: Anthropic blocks ↔ chat messages, finish reasons, defensive argument parsing', () => {
  const body = openai.toChat({
    model: 'openai/gpt-oss-120b',
    max_tokens: 8000,
    system: [{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }],
    tools: [{ name: 'moje_wygrane', description: 'd', strict: true, input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] },
      { role: 'system', content: 'KONTEKST' },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Sprawdzam' }, { type: 'tool_use', id: 't1', name: 'moje_wygrane', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}' }] },
    ],
  });
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user', 'system', 'assistant', 'tool']);
  assert.equal(body.messages[1].content, 'a\n\nb');
  assert.equal(body.messages[3].content, 'Sprawdzam');
  assert.deepEqual(body.messages[4], { role: 'tool', tool_call_id: 't1', name: 'moje_wygrane', content: '{"ok":true}' });
  assert.equal(body.max_tokens, openai.MAX_OUTPUT);
  assert.deepEqual(body.tools[0], { type: 'function', function: { name: 'moje_wygrane', description: 'd', parameters: { type: 'object', properties: {} } } });

  const msg = (finish, message) => openai.fromChat({ choices: [{ message, finish_reason: finish }] }, 'm');
  assert.equal(msg('length', { content: 'ucię' }).stop_reason, 'max_tokens');
  assert.equal(msg('content_filter', { content: '' }).stop_reason, 'refusal');
  assert.equal(msg('stop', { content: '<think>hmm</think>Cześć' }).content[0].text, 'Cześć');
  const call = msg('stop', { content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'moje_wygrane', arguments: '[1,2]' } }] });
  assert.equal(call.stop_reason, 'tool_use', 'a tool call is a tool call even when the provider says "stop"');
  assert.equal(call.content[0].invalid_json, '[1,2]');
  assert.deepEqual(openai.parseArguments('{"a":"b"}'), { ok: true, value: { a: 'b' } });
  assert.deepEqual(openai.parseArguments(''), { ok: true, value: {} });
  assert.equal(openai.parseArguments('{"a":').ok, false);
});
