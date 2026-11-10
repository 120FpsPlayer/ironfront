'use strict';

/**
 * "Wyślij logi" – uploads a game log to mclo.gs (the paste service Minecraft communities use for logs) and returns
 * the link, so a player can paste it on Discord when asking for help. Anything that looks like a login token is
 * removed before the log leaves the computer.
 */

const { USER_AGENT } = require('./net');

const API = 'https://api.mclo.gs/1/log';
const MAX_BYTES = 10 * 1024 * 1024; // the limit of mclo.gs
const HIDDEN = '<ukryty token>';

/** Removes Minecraft access tokens: the --accessToken argument, the old "Session ID" line and anything shaped like a JWT. */
function redact(log) {
  return String(log ?? '')
    .replace(/(--accessToken)(\s+|=)\S+/g, `$1$2${HIDDEN}`)
    .replace(/\(Session ID is [^)\r\n]*\)/g, `(Session ID is ${HIDDEN})`)
    .replace(/\btoken:[^\s:]+:[0-9a-fA-F-]+/g, HIDDEN)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(\.[A-Za-z0-9_-]*)?/g, HIDDEN);
}

/** The newest part of a log that fits in `maxBytes` (cut at a line break) – a crash is always at the end. */
function tail(log, maxBytes = MAX_BYTES) {
  const buf = Buffer.from(log, 'utf8');
  if (buf.length <= maxBytes) return log;
  const note = '[Hammer Launcher] Log był za długi – to jego ostatnia część.\n';
  let start = buf.length - (maxBytes - Buffer.byteLength(note));
  const lineBreak = buf.indexOf(0x0a, start);
  if (lineBreak !== -1 && lineBreak < buf.length - 1) start = lineBreak + 1;
  else while (start < buf.length && (buf[start] & 0xc0) === 0x80) start += 1; // not in the middle of a character
  return note + buf.subarray(start).toString('utf8');
}

/** Uploads the log; returns { url, id }. Errors are Polish sentences for the interface. */
async function shareLog(log, { fetchFn = fetch, maxBytes = MAX_BYTES } = {}) {
  const content = tail(redact(log), maxBytes);
  if (!content.trim()) throw new Error('Nie ma jeszcze żadnych logów do wysłania – najpierw uruchom grę.');
  let res;
  try {
    res = await fetchFn(API, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: new URLSearchParams({ content }).toString(),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('Nie udało się połączyć z mclo.gs. Sprawdź internet i spróbuj ponownie.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.success) throw new Error(`Serwis mclo.gs nie przyjął logów${data?.error ? `: ${String(data.error).slice(0, 200)}` : ` (błąd ${res.status})`}.`);
  let url;
  try {
    url = new URL(String(data.url));
  } catch {
    url = null;
  }
  // The link is shown and opened in the browser – only a real mclo.gs address is accepted.
  if (!url || url.protocol !== 'https:' || !/(^|\.)mclo\.gs$/.test(url.hostname)) throw new Error('Serwis mclo.gs zwrócił nieprawidłową odpowiedź.');
  return { url: url.toString(), id: typeof data.id === 'string' ? data.id : null };
}

module.exports = { shareLog, redact, tail, API, MAX_BYTES };
