'use strict';

/** "Continue with Discord" (OAuth2, scope identify) and the order notice for the team (a channel webhook). */

const { env } = require('./env');

const redirectUri = () => `${env.publicUrl}/api/nox/auth/callback`;

function authorizeUrl(state) {
  const q = new URLSearchParams({
    client_id: env.discordClientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `${env.discordAuthorize}?${q}`;
}

/** The code from Discord → the signed-in user ({ id, username, global_name, avatar }). */
async function userFromCode(code) {
  const tokenRes = await fetch(`${env.discordApi}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.discordClientId,
      client_secret: env.discordClientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) throw new Error(`Discord refused the sign-in (${tokenRes.status})`);
  const meRes = await fetch(`${env.discordApi}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.id) throw new Error(`Discord didn't return the account (${meRes.status})`);
  return me;
}

const money = (cents, currency) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100);

/** A paid order → a message in the team's channel (DISCORD_ORDER_WEBHOOK_URL). Never throws. */
async function notifyPaid(order, user) {
  if (!env.discordOrderWebhook) return false;
  const what = order.kind === 'access' ? 'NØX Access pass' : order.items.map((i) => `${i.quantity} × ${i.name}`).join('\n');
  const body = {
    username: 'NØX Store',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: order.kind === 'access' ? '🔓 New NØX Access' : '🛒 New paid order – deliver it',
        color: 0xa855f7,
        fields: [
          { name: 'Order', value: `\`${order.id}\``, inline: true },
          { name: 'Customer', value: user ? `<@${user.id}> (${user.username})` : order.userId, inline: true },
          { name: 'Paid', value: money(order.amount, order.currency), inline: true },
          { name: 'Items', value: what.slice(0, 1000) },
        ],
        timestamp: new Date().toISOString(),
      },
    ],
  };
  try {
    const res = await fetch(env.discordOrderWebhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch (err) {
    console.warn('[discord] order notice failed:', err.message);
    return false;
  }
}

module.exports = { authorizeUrl, userFromCode, notifyPaid, redirectUri };
