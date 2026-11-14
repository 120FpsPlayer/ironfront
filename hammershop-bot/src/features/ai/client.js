'use strict';

/**
 * The Claude API client of the AI assistant in tickets (src/features/aiassistant.js) – the official Anthropic SDK.
 *
 *   ANTHROPIC_API_KEY  in .env – without it the assistant is off and tickets work exactly as before
 *   AI_MODEL           optional – the model (default: claude-opus-5-5)
 *
 * Tests put a fake client here with setClient(fake) – it only needs beta.messages.create(params).
 */

require('../../env'); // .env is read before the key is looked at

const DEFAULT_MODEL = 'claude-opus-5-5';

let injected = null;
let real = null;
let sdkModule; // undefined: not tried yet · null: the package is missing

const apiKey = () => (process.env.ANTHROPIC_API_KEY || '').trim();
const model = () => (process.env.AI_MODEL || '').trim() || DEFAULT_MODEL;

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

/** The Anthropic class – its static error classes (RateLimitError, …) are what the assistant catches. */
const Anthropic = () => {
  const mod = sdk();
  return mod ? mod.Anthropic ?? mod.default ?? mod : null;
};

/** Tests: a fake client (null = back to the real one). */
function setClient(fake) {
  injected = fake ?? null;
}

/** Can the assistant talk to Claude at all? (a key and the SDK – or a test's fake) */
const configured = () => Boolean(injected || (apiKey() && Anthropic()));

/** The client – null when not configured. One real client for the whole bot (the SDK retries 429/5xx itself). */
function client() {
  if (injected) return injected;
  if (!apiKey()) return null;
  if (!real) {
    const A = Anthropic();
    if (!A) return null;
    real = new A({ apiKey: apiKey(), maxRetries: 2, timeout: 120_000 }); // timeout in milliseconds
  }
  return real;
}

/** Why it is off, for the start-up warning and /asystent status – null when it is configured. */
function problem() {
  if (configured()) return null;
  if (!apiKey()) return 'no-key';
  return 'no-sdk';
}

module.exports = { DEFAULT_MODEL, apiKey, model, client, configured, problem, setClient, Anthropic };
