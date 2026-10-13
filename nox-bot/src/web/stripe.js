'use strict';

/** Website payments – Stripe Checkout through the REST API: create a payment page, read it back, check webhook signatures. */

const crypto = require('node:crypto');
const { env } = require('../env');

const web = () => env.web;

/** Stripe wants form encoding with brackets: line_items[0][price_data][currency]=eur … */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

async function call(method, path, body = null, { idempotencyKey } = {}) {
  const res = await fetch(`${web().stripeApi}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env.stripeKey}`,
      ...(body && { 'content-type': 'application/x-www-form-urlencoded' }),
      ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
    },
    body: body ? form(body).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * A Checkout Session for an order. lines: [{ name, amount (cents, each), quantity, description? }].
 * Returns { id, url }.
 */
function createCheckout({ order, user, lines, currency, idempotencyKey }) {
  const back = web().publicUrl;
  return call(
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      submit_type: 'pay',
      custom_text: { submit: { message: 'Right after payment, your order opens in a private ticket on the NØX Discord – instant products are delivered there and by DM.' } },
      success_url: `${back}/?payment=return&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${back}/?payment=cancelled`,
      client_reference_id: user.id,
      line_items: lines.map((l) => ({
        quantity: l.quantity,
        price_data: { currency, unit_amount: l.amount, product_data: { name: l.name, ...(l.description && { description: l.description }) } },
      })),
      metadata: { order_id: order.id, user_id: user.id, kind: order.kind },
      payment_intent_data: { metadata: { order_id: order.id, user_id: user.id, kind: order.kind } },
      expires_at: Math.floor(Date.now() / 1000) + 3600, // the link works for an hour
    },
    { idempotencyKey },
  );
}

const getCheckout = (id) => call('GET', `/checkout/sessions/${encodeURIComponent(id)}`);

/** Checks the Stripe-Signature header (HMAC-SHA256 of "t.body"), 5 minutes tolerance. Returns the event or throws. */
function verifyWebhook(rawBody, header, secret = web().stripeWebhookSecret, now = Date.now()) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const parts = Object.fromEntries(String(header ?? '').split(',').map((p) => p.split('=').map((x) => x.trim())));
  const sigs = String(header ?? '').split(',').filter((p) => p.trim().startsWith('v1=')).map((p) => p.trim().slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) throw new Error('Bad signature header');
  if (Math.abs(now / 1000 - t) > 300) throw new Error('Signature too old');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('Signature does not match');
  return JSON.parse(rawBody);
}

module.exports = { createCheckout, getCheckout, verifyWebhook, form };
