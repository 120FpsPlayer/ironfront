'use strict';

/**
 * „Udostępnij link” in the Galeria tab: one screenshot is uploaded to a temporary-upload host and comes back as
 * a link to paste. The host is NOT HammerShop's – by default Litterbox (the temporary uploads of catbox.moe):
 *
 *   POST <url>   multipart form:  reqtype=fileupload, time=72h, fileToUpload=<the picture>   →   the link, as plain text
 *
 * Endpoint and retention come from launcher.config.json (`screenshotShare: { url, time }`); an empty url switches
 * the feature off. Nothing leaves the computer before the player has said yes: share() refuses without consent
 * (given in the dialog, or remembered with „Nie pytaj ponownie”). Only a PNG or JPEG of at most 20 MB is sent, under a
 * neutral file name, and the answer is only accepted when it is an https address in the host's own family.
 */

const fs = require('node:fs');
const path = require('node:path');
const { USER_AGENT } = require('./net');

const TIMES = { '1h': 1, '12h': 12, '24h': 24, '72h': 72 }; // what Litterbox accepts
const DEFAULT_TIME = '72h';
const MAX_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 120_000; // a big screenshot on a slow line takes a while; a host that never answers is given up on
const MAX_ANSWER = 300;

/** "litterbox.catbox.moe" → "catbox.moe": the family an answer has to come from. */
function family(host) {
  return String(host).toLowerCase().split('.').slice(-2).join('.');
}

/** The configured host, checked: { url, time, hours, host, family } – null when sharing is off or misconfigured. */
function endpoint(config) {
  const raw = config?.screenshotShare ?? {};
  let url;
  try {
    url = new URL(String(raw.url ?? '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
  const time = raw.time in TIMES ? raw.time : DEFAULT_TIME;
  return { url: url.toString(), time, hours: TIMES[time], host: url.hostname, family: family(url.hostname) };
}

/** 'png' or 'jpeg' from the first bytes of a file – null for anything else, whatever its name says. */
function imageKind(data) {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  return null;
}

/** The link from the host's answer – only an https address on the expected family, nothing else. null otherwise. */
function linkFrom(answer, expectedFamily) {
  const text = String(answer ?? '').trim();
  if (!text || text.length > MAX_ANSWER || /\s/.test(text)) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  if (host !== expectedFamily && !host.endsWith(`.${expectedFamily}`)) return null;
  if (url.pathname.length < 2) return null; // the host's front page is not a picture
  return url.toString();
}

/** The multipart form of one upload (exported for the tests). */
function buildForm({ data, kind, time }) {
  const form = new FormData();
  form.set('reqtype', 'fileupload');
  form.set('time', time);
  form.set('fileToUpload', new Blob([data], { type: kind === 'png' ? 'image/png' : 'image/jpeg' }), kind === 'png' ? 'zrzut-ekranu.png' : 'zrzut-ekranu.jpg');
  return form;
}

/**
 * `consent.given()` – the player ticked „Nie pytaj ponownie” before; `consent.remember()` stores that.
 * `fetchFn`, `timeoutMs` and `now` are replaced in the tests.
 */
function createScreenshotShare({ config, fetchFn = (...a) => fetch(...a), consent = { given: () => false, remember: () => {} }, timeoutMs = TIMEOUT_MS, now = () => Date.now() }) {
  const target = () => endpoint(config);

  /** What the window needs: { available, hours, service, ask } – `ask`: the consent dialog comes before an upload. */
  function info() {
    const t = target();
    return { available: Boolean(t), hours: t?.hours ?? null, service: t?.host ?? null, ask: !consent.given() };
  }

  /** Reads and checks the picture: { data, kind }. */
  function load(file) {
    if (!/\.(png|jpe?g)$/i.test(path.basename(String(file)))) throw new Error('Udostępnić można tylko zrzut ekranu w formacie PNG albo JPG.');
    let stat;
    try {
      stat = fs.lstatSync(file); // a link in the screenshots folder is not a screenshot
    } catch {
      throw new Error('Nie ma już tego zrzutu ekranu.');
    }
    if (!stat.isFile()) throw new Error('Nie ma już tego zrzutu ekranu.');
    if (stat.size > MAX_BYTES) throw new Error('Ten zrzut ekranu ma ponad 20 MB – jest za duży, żeby go wysłać.');
    const data = fs.readFileSync(file);
    const kind = imageKind(data);
    if (!kind) throw new Error('Ten plik nie jest obrazem PNG ani JPG – nie został wysłany.');
    return { data, kind };
  }

  /**
   * Uploads one screenshot and returns { url, hours, expiresAt }. `agreed` – the player said yes in the consent
   * dialog just now; `remember` – and ticked „Nie pytaj ponownie”. Without consent nothing is sent.
   */
  async function share(file, { agreed = false, remember = false } = {}) {
    const t = target();
    if (!t) throw new Error('Udostępnianie zrzutów ekranu jest w tej wersji launchera wyłączone.');
    if (!agreed && !consent.given()) throw new Error('Najpierw potwierdź, że zrzut ekranu może zostać wysłany do zewnętrznego serwisu.');
    const { data, kind } = load(file);
    if (agreed && remember) consent.remember();
    let res;
    try {
      res = await fetchFn(t.url, { method: 'POST', headers: { 'user-agent': USER_AGENT }, body: buildForm({ data, kind, time: t.time }), signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new Error('Nie udało się wysłać zrzutu ekranu – serwis nie odpowiada. Sprawdź internet i spróbuj ponownie za chwilę.');
    }
    if (!res.ok) throw new Error(`Serwis nie przyjął zrzutu ekranu (błąd ${res.status}). Spróbuj ponownie za chwilę.`);
    let answer = '';
    try {
      answer = (await res.text()).slice(0, MAX_ANSWER + 1);
    } catch {
      answer = '';
    }
    const url = linkFrom(answer, t.family);
    if (!url) throw new Error('Serwis odpowiedział czymś, co nie jest linkiem do obrazu – nic nie zostało skopiowane. Spróbuj ponownie za chwilę.');
    return { url, hours: t.hours, expiresAt: now() + t.hours * 3600_000 };
  }

  return { info, share };
}

module.exports = { createScreenshotShare, endpoint, imageKind, linkFrom, buildForm, family, MAX_BYTES, TIMES, DEFAULT_TIME };
