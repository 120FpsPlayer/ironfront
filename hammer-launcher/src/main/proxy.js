'use strict';

/**
 * Some networks (schools, companies, hotels) only let traffic out through a proxy and announce it in the
 * HTTPS_PROXY / HTTP_PROXY environment variables. Node ignores those on its own, so the launcher would look
 * "offline" there. When a proxy is set, all of the launcher's own requests (game files, Modrinth, Microsoft
 * sign-in) go through it; NO_PROXY is respected. Without those variables nothing changes.
 */

const { Agent, EnvHttpProxyAgent, setGlobalDispatcher } = require('undici');

function proxyUrl(env = process.env) {
  return env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || '';
}

/** An undici Agent for downloads – through the proxy when one is configured. */
function createAgent(options = {}, env = process.env) {
  return proxyUrl(env) ? new EnvHttpProxyAgent(options) : new Agent(options);
}

let applied = false;

/** Routes the built-in fetch through the configured proxy (once). Returns true when a proxy is in use. */
function useSystemProxy(env = process.env) {
  if (!proxyUrl(env)) return false;
  if (!applied) {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    applied = true;
  }
  return true;
}

module.exports = { proxyUrl, createAgent, useSystemProxy };
