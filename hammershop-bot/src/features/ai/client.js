'use strict';

/**
 * Which AI the assistant in tickets talks to (src/features/aiassistant.js) – chosen in .env:
 *
 *   AI_PROVIDER = auto (default) | groq | claude | openai
 *     auto    Groq when GROQ_API_KEY is set, else Claude when ANTHROPIC_API_KEY is set, else none (the no-AI mode:
 *             prizes are claimed with buttons, „człowiek” still calls the team)
 *     groq    free – GROQ_API_KEY from console.groq.com; model openai/gpt-oss-120b unless AI_MODEL
 *     claude  paid – ANTHROPIC_API_KEY, the official Anthropic SDK; model claude-opus-5-5 unless AI_MODEL
 *     openai  any OpenAI-compatible API (e.g. Gemini) – AI_BASE_URL + AI_API_KEY + AI_MODEL
 *
 * Every provider is used with the same Anthropic-shaped request and response: Claude through its SDK, Groq and the
 * OpenAI-compatible ones through the adapter in ./openai.js (plain fetch). Tests put a fake client here with setClient().
 */

require('../../env'); // .env is read before the keys are looked at
const openai = require('./openai');

const PROVIDERS = ['groq', 'claude', 'openai'];
const DEFAULT_MODELS = { groq: 'openai/gpt-oss-120b', claude: 'claude-opus-5-5' };
const GROQ_URL = 'https://api.groq.com/openai/v1';
/** The .env key of each provider – for messages about a rejected key. */
const KEY_VARS = { groq: 'GROQ_API_KEY', claude: 'ANTHROPIC_API_KEY', openai: 'AI_API_KEY' };

const str = (name) => (process.env[name] || '').trim();

let injected = null;
let injectedProvider = 'claude';
let real = null;
let realKey = null;
let sdkModule; // undefined: not tried yet · null: the package is missing

/** The @anthropic-ai/sdk package – null when it isn't installed (npm install not run after the update). */
function sdk() {
  if (sdkModule !== undefined) return sdkModule;
  try {
    sdkModule = require('@anthropic-ai/sdk');
  } catch {
    sdkModule = null;
  }
  return sdkModule;
}

/** The Anthropic class – its static error classes (RateLimitError, …) are what the assistant catches for Claude. */
const Anthropic = () => {
  const mod = sdk();
  return mod ? mod.Anthropic ?? mod.default ?? mod : null;
};

/** Tests: a fake client (null = back to the real ones); provider: what the fake stands for. */
function setClient(fake, { provider = 'claude' } = {}) {
  injected = fake ?? null;
  injectedProvider = provider;
}

const wanted = () => str('AI_PROVIDER').toLowerCase() || 'auto';

/** 'groq' | 'claude' | 'openai' | null (no AI). */
function provider() {
  if (injected) return injectedProvider;
  const want = wanted();
  if (PROVIDERS.includes(want)) return want;
  if (want !== 'auto') return null;
  if (str('GROQ_API_KEY')) return 'groq';
  if (str('ANTHROPIC_API_KEY')) return 'claude';
  return null;
}

const model = () => str('AI_MODEL') || DEFAULT_MODELS[provider()] || '';

/** Why there is no AI – null when it is configured. */
function problem() {
  if (injected) return null;
  const want = wanted();
  if (want !== 'auto' && !PROVIDERS.includes(want)) return 'bad-provider';
  const p = provider();
  if (!p) return 'no-key';
  if (p === 'groq' && !str('GROQ_API_KEY')) return 'no-groq-key';
  if (p === 'claude' && !str('ANTHROPIC_API_KEY')) return 'no-claude-key';
  if (p === 'claude' && !Anthropic()) return 'no-sdk';
  if (p === 'openai' && !(str('AI_BASE_URL') && str('AI_API_KEY') && str('AI_MODEL'))) return 'openai-incomplete';
  return null;
}

const configured = () => !problem();

/** The client – null when not configured. Claude: one SDK client (it retries 429/5xx itself); the others: the adapter. */
function client() {
  if (injected) return injected;
  if (problem()) return null;
  const p = provider();
  if (p === 'claude') {
    if (!real || realKey !== str('ANTHROPIC_API_KEY')) {
      const A = Anthropic();
      realKey = str('ANTHROPIC_API_KEY');
      real = new A({ apiKey: realKey, maxRetries: 2, timeout: 120_000 }); // timeout in milliseconds
    }
    return real;
  }
  if (p === 'groq') return openai.createClient({ provider: 'groq', baseURL: GROQ_URL, apiKey: str('GROQ_API_KEY') });
  return openai.createClient({ provider: 'openai', baseURL: str('AI_BASE_URL'), apiKey: str('AI_API_KEY') });
}

/** "Groq", "Claude (Anthropic)", "zgodne z OpenAI (generativelanguage.googleapis.com)" – for /asystent status and logs. */
function label(p = provider()) {
  if (p === 'groq') return 'Groq (darmowy)';
  if (p === 'claude') return 'Claude (Anthropic)';
  if (p === 'openai') {
    let host = str('AI_BASE_URL');
    try {
      host = new URL(host).host;
    } catch {
      /* not a URL – shown as written */
    }
    return `zgodne z OpenAI${host ? ` (${host})` : ''}`;
  }
  return 'brak';
}

/**
 * How much of the ticket goes into one request. The free providers count tokens per minute and per day, so they get
 * a shorter history; Claude reads the long prefix from its cache.
 */
const budget = () => (provider() === 'claude' ? { history: 30, messageChars: 1500, formChars: 3000 } : { history: 10, messageChars: 600, formChars: 1200 });

module.exports = { DEFAULT_MODELS, KEY_VARS, GROQ_URL, provider, model, client, configured, problem, label, budget, setClient, Anthropic };
