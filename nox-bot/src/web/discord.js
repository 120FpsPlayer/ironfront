'use strict';

/**
 * Website sign-in – "Continue with Discord" with the bot's own application. Scopes: identify (who you are) and
 * guilds.join (the bot adds you to the NØX server – src/features/website.js joinServer).
 */

const { env } = require('../env');

const web = () => env.web;
let appId = null;
/** The OAuth2 client ID: DISCORD_CLIENT_ID, or the bot's own application (set when the bot is ready). */
const clientId = () => web().clientId || appId;
const setClientId = (id) => (appId = id ? String(id) : null);

const redirectUri = () => `${web().publicUrl}/api/nox/auth/callback`;

function authorizeUrl(state) {
  const q = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'identify guilds.join',
    state,
    prompt: 'none',
  });
  return `${web().discordAuthorize}?${q}`;
}

/**
 * The code from Discord → { me: the signed-in user ({ id, username, global_name, avatar }), accessToken }. The token is
 * only used right away to add the user to the server – it is never stored.
 */
async function userFromCode(code) {
  const tokenRes = await fetch(`${web().discordApi}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: web().clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) throw new Error(`Discord refused the sign-in (${tokenRes.status})`);
  const meRes = await fetch(`${web().discordApi}/users/@me`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15_000) });
  const me = await meRes.json().catch(() => ({}));
  if (!meRes.ok || !me.id) throw new Error(`Discord didn't return the account (${meRes.status})`);
  return { me, accessToken: token.access_token };
}

module.exports = { authorizeUrl, userFromCode, redirectUri, clientId, setClientId };
