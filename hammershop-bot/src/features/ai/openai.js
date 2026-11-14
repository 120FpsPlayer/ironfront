'use strict';

/**
 * Groq and other OpenAI-compatible chat APIs (Gemini, …) for the AI assistant – plain fetch, no extra package.
 *
 * The adapter takes the Anthropic-shaped request aiassistant.js builds and gives back an Anthropic-shaped message, so the
 * assistant's tool loop is the same for every provider:
 *   request:  system (top-level and mid-conversation role:'system') → system messages · assistant tool_use blocks →
 *             tool_calls (arguments: a JSON string) · user tool_result blocks → role:'tool' messages right after ·
 *             thinking blocks skipped · tools → { type:'function', function:{ name, description, parameters } } ·
 *             everything only Claude knows (cache_control, betas, fallbacks, output_config, strict) left out
 *   response: content → a text block · tool_calls → tool_use blocks (broken JSON arguments are marked invalid_json, so
 *             the loop answers with an error tool_result and the model tries again) · finish_reason stop → end_turn,
 *             tool_calls → tool_use, length → max_tokens, content_filter → refusal
 * Errors are ProviderError with a kind the assistant acts on: 'rate-limit' (with retryAfterMs) · 'auth' · 'model' ·
 * 'server' · 'network' · 'timeout' · 'bad-request'.
 */

const crypto = require('node:crypto');

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 1500; // free plans count tokens per minute – the replies are short anyway
const MAX_RETRY_AFTER_MS = 3_600_000;
const DEFAULT_RETRY_AFTER_MS = 60_000;

class ProviderError extends Error {
  constructor(kind, message, { status = null, code = null, retryAfterMs = null, provider = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
    this.provider = provider;
  }
}

/** Tests put their own fetch here (nothing leaves the computer); the bot uses the real one. */
let fetcher = null;
const setFetch = (fn) => (fetcher = fn ?? null);
let retryDelayMs = 1000;
const setRetryDelay = (ms) => (retryDelayMs = ms);
// A per-minute limit that frees up within seconds is waited out once instead of starting a break (and a staff ping).
let shortWaitMs = 15_000;
const setShortWait = (ms) => (shortWaitMs = ms);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Text of a string or a list of Anthropic content blocks. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n\n');
}

/** The JSON schema without what only Claude's strict mode wants (some OpenAI-compatible servers reject it). */
function plainSchema(schema = {}) {
  const out = { type: schema.type ?? 'object', properties: {} };
  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    const rest = { ...value };
    delete rest.additionalProperties;
    out.properties[key] = rest;
  }
  if (schema.required?.length) out.required = [...schema.required];
  return out;
}

const EFFORT = { low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };

/** Anthropic-shaped request → the chat/completions body. */
function toChat(params) {
  const messages = [];
  const toolNames = new Map();
  const system = textOf(params.system).trim();
  if (system) messages.push({ role: 'system', content: system });
  for (const m of params.messages ?? []) {
    if (m.role === 'system') {
      const text = textOf(m.content).trim();
      if (text) messages.push({ role: 'system', content: text });
      continue;
    }
    if (m.role === 'assistant') {
      if (typeof m.content === 'string') {
        if (m.content.trim()) messages.push({ role: 'assistant', content: m.content });
        continue;
      }
      const text = textOf(m.content).trim();
      const calls = (m.content ?? [])
        .filter((b) => b.type === 'tool_use')
        .map((b) => {
          toolNames.set(b.id, b.name);
          return { id: b.id, type: 'function', function: { name: b.name, arguments: b.invalid_json !== undefined ? '{}' : JSON.stringify(b.input ?? {}) } };
        });
      if (!text && !calls.length) continue; // only thinking / fallback blocks
      messages.push({ role: 'assistant', content: text || null, ...(calls.length && { tool_calls: calls }) });
      continue;
    }
    if (typeof m.content === 'string') {
      messages.push({ role: 'user', content: m.content });
      continue;
    }
    for (const b of m.content ?? []) {
      if (b.type !== 'tool_result') continue;
      const name = toolNames.get(b.tool_use_id);
      messages.push({ role: 'tool', tool_call_id: b.tool_use_id, ...(name && { name }), content: textOf(b.content) || (b.is_error ? 'Błąd' : 'OK') });
    }
    const text = textOf(m.content).trim();
    if (text) messages.push({ role: 'user', content: text });
  }
  const model = params.model;
  const body = { model, messages, max_tokens: Math.min(params.max_tokens ?? MAX_OUTPUT, MAX_OUTPUT) };
  if (params.tools?.length) {
    body.tools = params.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: plainSchema(t.input_schema) } }));
    body.tool_choice = 'auto';
  }
  // gpt-oss reasons before it answers – "low" keeps that short (and inside the free token limits).
  if (/gpt-oss/i.test(model ?? '')) body.reasoning_effort = EFFORT[params.output_config?.effort] ?? 'low';
  return body;
}

/** Tool arguments from the model – free models sometimes send broken JSON. → { ok, value } */
function parseArguments(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return { ok: true, value: raw };
  const text = String(raw ?? '').trim();
  if (!text) return { ok: true, value: {} };
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** The chat/completions response → an Anthropic-shaped message. */
function fromChat(json, model) {
  const choice = json.choices[0];
  const msg = choice?.message ?? {};
  const raw = typeof msg.content === 'string' ? msg.content : Array.isArray(msg.content) ? msg.content.map((p) => p?.text ?? '').join('') : '';
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // models that write their reasoning into the answer
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const call of msg.tool_calls ?? []) {
    if (call?.type && call.type !== 'function') continue;
    const args = parseArguments(call.function?.arguments);
    content.push({
      type: 'tool_use',
      id: call.id || `call_${crypto.randomBytes(6).toString('hex')}`,
      name: String(call.function?.name ?? ''),
      input: args.ok ? args.value : {},
      ...(!args.ok && { invalid_json: String(call.function?.arguments ?? '').slice(0, 500) }),
    });
  }
  const finish = choice?.finish_reason;
  const stopReason =
    finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn';
  return {
    id: json.id ?? `chat_${crypto.randomBytes(6).toString('hex')}`,
    type: 'message',
    role: 'assistant',
    model: json.model ?? model,
    content,
    stop_reason: stopReason,
    stop_details: null,
    usage: { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 },
  };
}

/** "2m59.56s", "7.66s", "1h2m", "350ms", "12" (seconds) → milliseconds (null when unreadable). */
function parseDuration(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  let total = 0;
  let matched = '';
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(m[1]) * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2]];
    matched += m[0];
  }
  return matched === s ? Math.round(total) : null;
}

/** How long to wait after a 429: retry-after, or the reset of the limit that ran out. Capped at an hour. */
function retryAfter(headers) {
  const get = (name) => headers?.get?.(name) ?? null;
  let ms = parseDuration(get('retry-after'));
  if (ms === null) {
    const date = Date.parse(get('retry-after') ?? '');
    if (Number.isFinite(date)) ms = date - Date.now();
  }
  if (ms === null) {
    const resets = [];
    if (get('x-ratelimit-remaining-requests') === '0') resets.push(parseDuration(get('x-ratelimit-reset-requests')));
    if (get('x-ratelimit-remaining-tokens') === '0') resets.push(parseDuration(get('x-ratelimit-reset-tokens')));
    if (!resets.length) resets.push(parseDuration(get('x-ratelimit-reset-requests')), parseDuration(get('x-ratelimit-reset-tokens')));
    const known = resets.filter((x) => x !== null);
    if (known.length) ms = Math.max(...known);
  }
  return Math.min(Math.max(ms ?? DEFAULT_RETRY_AFTER_MS, 0), MAX_RETRY_AFTER_MS);
}

function toError(res, json, provider) {
  const body = Array.isArray(json) ? json[0] : json; // Gemini wraps its error in a list
  const code = body?.error?.code ?? body?.error?.type ?? null;
  const message = String(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
  const meta = { status: res.status, code, provider };
  if (res.status === 429) return new ProviderError('rate-limit', message, { ...meta, retryAfterMs: retryAfter(res.headers) });
  if (res.status === 401 || res.status === 403) return new ProviderError('auth', message, meta);
  if (res.status === 404 || code === 'model_not_found' || code === 'model_decommissioned') return new ProviderError('model', message, meta);
  if (res.status >= 500) return new ProviderError('server', message, meta);
  if (code === 'tool_use_failed') return new ProviderError('server', message, meta); // Groq: the model wrote a broken tool call
  return new ProviderError('bad-request', message, meta);
}

/**
 * A client with the same surface as the Anthropic SDK's beta.messages.create (only what the assistant uses).
 * provider: 'groq' | 'openai' – for messages; baseURL without /chat/completions.
 */
function createClient({ provider, baseURL, apiKey }) {
  const url = `${String(baseURL).replace(/\/+$/, '')}/chat/completions`;
  async function create(params) {
    const body = toChat(params);
    for (let attempt = 0; ; attempt += 1) {
      let res;
      try {
        res = await (fetcher ?? globalThis.fetch)(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
        if (!timeout && attempt === 0) {
          await sleep(retryDelayMs);
          continue;
        }
        throw new ProviderError(timeout ? 'timeout' : 'network', timeout ? `brak odpowiedzi w ${TIMEOUT_MS / 1000} s` : `brak połączenia (${err?.message ?? err})`, { provider });
      }
      const json = await res.json().catch(() => null);
      if (res.ok) {
        if (!Array.isArray(json?.choices) || !json.choices.length) throw new ProviderError('server', 'pusta odpowiedź', { status: res.status, provider });
        return fromChat(json, body.model);
      }
      const err = toError(res, json, provider);
      if (err.kind === 'rate-limit' && attempt === 0 && err.retryAfterMs <= shortWaitMs) {
        await sleep(err.retryAfterMs);
        continue;
      }
      if (err.kind === 'server' && attempt === 0) {
        await sleep(retryDelayMs); // one more try – a 5xx or a broken tool call usually works the second time
        continue;
      }
      throw err;
    }
  }
  return { provider, url, beta: { messages: { create } } };
}

module.exports = { createClient, ProviderError, toChat, fromChat, parseArguments, parseDuration, retryAfter, setFetch, setRetryDelay, setShortWait, MAX_OUTPUT };
