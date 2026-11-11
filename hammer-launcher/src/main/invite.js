'use strict';

/**
 * Zaproszenia – "join this server" links. A server owner (or any player) sends one; the friend clicks it and the
 * launcher prepares everything:
 *
 *   hammer://join?server=<host[:port]>&name=<display name>&mc=<game version>&loader=<fabric|quilt|forge|neoforge|vanilla>
 *                &pack=<Modrinth modpack id or slug>&icon=<https URL>
 *
 * Only `server` is required. The shop's page  https://<website>/join?<the same query>  forwards to that link, so
 * both forms are read here. Unknown parameters are ignored.
 *
 * A link is untrusted input: every field is checked before it is used, the icon is only ever shown (and only
 * when it is https – this module never fetches it), and nothing happens until the player confirms in the window.
 * No Electron here.
 */

const { LOADERS } = require('./instances');
const { cleanAddress } = require('./servers');

const MAX_LINK = 2000;
const MAX_NAME = 48;
const MAX_ICON = 300;
const MC_VERSION = /^[0-9A-Za-z][\w.\-+ ]{0,39}$/;
/** A Modrinth project id (base62) or slug. */
const PACK = /^[0-9A-Za-z][\w.+!-]{2,63}$/;
const FIELDS = ['server', 'name', 'mc', 'loader', 'pack', 'icon'];

/** What is wrong with an invitation, in Polish – shown to the player as it is. */
class InviteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InviteError';
  }
}
const bad = (message) => new InviteError(message);
const NOT_AN_INVITE = 'To nie wygląda na zaproszenie do Hammer Launchera. Zaproszenie zaczyna się od „hammer://join” albo prowadzi do strony …/join.';

/** One line of plain text: control and text-direction characters become spaces. */
const line = (text) => String(text ?? '').replace(/[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();

/** An https picture address that may be shown – anything else (http, data:, a login in the address) is null. */
function cleanIcon(value) {
  const text = String(value ?? '').trim();
  if (!text || text.length > MAX_ICON) return null;
  let url = null;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) return null;
  return url.href.length <= MAX_ICON ? url.href : null;
}

/**
 * Checks the fields of an invitation: { server, name, mc, loader, pack, icon } – name, mc, loader, pack and icon
 * are null when the link does not give them. Throws InviteError with what is wrong.
 */
function cleanInvite(raw = {}) {
  if (raw.server == null || !String(raw.server).trim()) throw bad('W tym zaproszeniu brakuje adresu serwera.');
  let server;
  try {
    server = cleanAddress(raw.server);
  } catch {
    throw bad('W tym zaproszeniu jest nieprawidłowy adres serwera.');
  }
  const name = line(raw.name);
  if (name.length > MAX_NAME) throw bad(`Nazwa serwera w tym zaproszeniu jest za długa (najwyżej ${MAX_NAME} znaków).`);
  const mc = String(raw.mc ?? '').trim();
  if (mc && !MC_VERSION.test(mc)) throw bad('W tym zaproszeniu jest nieprawidłowa wersja Minecrafta.');
  const loader = String(raw.loader ?? '').trim().toLowerCase();
  if (loader && !LOADERS.includes(loader)) throw bad('W tym zaproszeniu jest nieznany loader modów.');
  const pack = String(raw.pack ?? '').trim();
  if (pack && !PACK.test(pack)) throw bad('W tym zaproszeniu jest nieprawidłowa paczka modów.');
  return { server, name: name || null, mc: mc || null, loader: loader || null, pack: pack || null, icon: cleanIcon(raw.icon) };
}

/**
 * Reads a link – "hammer://join?…" or "https://…/join?…" – into checked fields (see cleanInvite).
 * Quotes, backticks and the <…> Discord puts around links are dropped first.
 */
function parseInvite(text) {
  const link = String(text ?? '').slice(0, MAX_LINK * 2).trim().replace(/^[<`'"„”\s]+|[>`'"„”\s]+$/g, '');
  if (!link) throw bad('Wklej link z zaproszeniem.');
  if (link.length > MAX_LINK) throw bad('Ten link jest za długi jak na zaproszenie.');
  let url;
  try {
    url = new URL(link);
  } catch {
    throw bad(NOT_AN_INVITE);
  }
  // hammer://join?…  (Windows may hand it over as hammer://join/?…), or the shop's page https://…/join?…
  let ours = false;
  if (url.protocol === 'hammer:') ours = `${url.hostname}${url.pathname}`.replace(/\/+$/, '').toLowerCase() === 'join';
  else if (url.protocol === 'https:' && url.hostname) ours = /\/join\/*$/i.test(url.pathname);
  if (!ours) throw bad(NOT_AN_INVITE);
  return cleanInvite(Object.fromEntries(FIELDS.map((key) => [key, url.searchParams.get(key)])));
}

/**
 * The link for an invitation: "<website>/join?…" when the launcher has an https website (a page that opens the
 * launcher and explains what to do without it), else "hammer://join?…". The fields are checked first.
 */
function buildInvite(fields, { website = '' } = {}) {
  const invite = cleanInvite(fields);
  const query = new URLSearchParams(FIELDS.filter((key) => invite[key]).map((key) => [key, invite[key]]));
  const site = String(website ?? '').trim().replace(/\/+$/, '');
  const base = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(site) ? `${site}/join` : 'hammer://join';
  return `${base}?${query}`;
}

/** The invitation among the arguments a program was started with (Windows passes the clicked link that way). */
function inviteFromArgs(argv) {
  const hit = (Array.isArray(argv) ? argv : []).find((arg) => typeof arg === 'string' && /^hammer:/i.test(arg.trim()));
  return hit ? hit.trim().slice(0, MAX_LINK * 2) : null;
}

module.exports = { parseInvite, cleanInvite, buildInvite, inviteFromArgs, cleanIcon, InviteError, MAX_LINK, MAX_NAME, MC_VERSION, PACK, FIELDS };
