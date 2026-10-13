'use strict';

/** Fake Discord + Stripe APIs for the tests (one local HTTP server), and the env that points the site at them. */

const http = require('node:http');

function startFakes() {
  const state = { sessions: new Map(), created: 0, user: { id: '111222333444555666', username: 'tester', global_name: 'Tester', avatar: null }, lastCheckout: null };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const json = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (url.pathname === '/discord/authorize') {
        // Discord's consent screen, skipped: straight back to the site with a good code.
        res.writeHead(302, { location: `${state.siteBase}/api/nox/auth/callback?code=good&state=${url.searchParams.get('state')}` });
        return res.end();
      }
      if (url.pathname === '/discord/oauth2/token' && req.method === 'POST') {
        const p = new URLSearchParams(body);
        return p.get('code') === 'good' ? json(200, { access_token: 'tok', token_type: 'Bearer' }) : json(400, { error: 'invalid_grant' });
      }
      if (url.pathname === '/discord/users/@me') return req.headers.authorization === 'Bearer tok' ? json(200, state.user) : json(401, {});
      if (url.pathname === '/stripe/v1/checkout/sessions' && req.method === 'POST') {
        if (req.headers.authorization !== 'Bearer sk_test_fake') return json(401, { error: { message: 'Invalid API Key' } });
        const p = new URLSearchParams(body);
        state.lastCheckout = p;
        const key = req.headers['idempotency-key'];
        const existing = [...state.sessions.values()].find((s) => s.key === key);
        if (existing) return json(200, existing);
        state.created += 1;
        let amount = 0;
        for (let i = 0; p.has(`line_items[${i}][quantity]`); i++) amount += Number(p.get(`line_items[${i}][quantity]`)) * Number(p.get(`line_items[${i}][price_data][unit_amount]`));
        const id = `cs_test_${state.created}`;
        const s = { id, key, url: `https://checkout.stripe.com/c/pay/${id}`, status: 'open', payment_status: 'unpaid', amount_total: amount, currency: p.get('line_items[0][price_data][currency]'), metadata: { order_id: p.get('metadata[order_id]'), user_id: p.get('metadata[user_id]'), kind: p.get('metadata[kind]') } };
        state.sessions.set(id, s);
        return json(200, s);
      }
      const m = url.pathname.match(/^\/stripe\/v1\/checkout\/sessions\/(.+)$/);
      if (m && req.method === 'GET') {
        const s = state.sessions.get(decodeURIComponent(m[1]));
        return s ? json(200, s) : json(404, { error: { message: 'No such session' } });
      }
      if (url.pathname === '/webhook' && req.method === 'POST') {
        state.notices = [...(state.notices ?? []), JSON.parse(body)];
        res.writeHead(204);
        return res.end();
      }
      json(404, {});
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, base, state, pay: (id) => Object.assign(state.sessions.get(id), { status: 'complete', payment_status: 'paid' }) });
    }),
  );
}

/** Points the bot's website settings (env.web, env.stripeKey) at the fakes. */
function useFakes(env, base, site, extra = {}) {
  Object.assign(env.web, {
    enabled: true,
    publicUrl: site,
    clientId: '123',
    clientSecret: 'secret',
    stripeWebhookSecret: 'whsec_test',
    accessPrice: 990,
    invite: 'https://discord.gg/nox',
    discordApi: `${base}/discord`,
    discordAuthorize: `${base}/discord/authorize`,
    stripeApi: `${base}/stripe/v1`,
    ...extra,
  });
  env.stripeKey = 'sk_test_fake';
}

module.exports = { startFakes, useFakes };
