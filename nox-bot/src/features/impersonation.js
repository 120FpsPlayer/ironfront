'use strict';

/**
 * Anti-impersonation alerts (config.security.impersonationAlerts).
 *
 * When someone joins or changes their username, display name, server nickname or avatar, they are compared
 * with the staff (members with a staff role, and admins). Look-alikes get an alert card in #automod-logs with
 * Ban / Kick / Timeout 24h / Ignore buttons – only moderators can press them, the result is shown on the card.
 *
 * Names are normalised first: lowercase, accents removed, look-alikes mapped (0→o 3→e 4→a 5→s 7→t @→a $→s,
 * i / I / l / 1 / | → l, Cyrillic / Greek twins), only letters and digits kept, repeated letters collapsed – the
 * same way for staff and members, so "MIA", "mia" and "M1a" are one name. A name matches a staff member when it is
 *   exact     the same name                                          "Al3x" = alex
 *   title     the staff name plus support / admin / staff / team …   "alex_support", "Support | Alex", "NØX Team"
 *   similar   one edit away (staff names of 5+ characters)           "Danial" ≈ daniel
 *   avatar    the same avatar picture
 * Staff and bots are never flagged. One alert per user + name per 24 hours while they stay – someone who is kicked,
 * banned or leaves and comes back is reported again; Ignore silences that user + name for good.
 * The staff list is kept per server (staffList) and rebuilt when the staff or their roles change.
 *
 * Buttons: imp:<ban|kick|timeout|ignore>:<alertId>
 * State:   db.guild(id).security.impersonation = { alerts: { [id]: ALERT }, ignored: { [key]: { by, at } } }
 *          key = "<userId>:<normalised name>" or "<userId>:avatar:<hash>"
 */

const crypto = require('node:crypto');
const { ButtonStyle, escapeMarkdown } = require('discord.js');
const { env } = require('../env');
const hooks = require('../lib/hooks');
const config = require('../lib/config');
const db = require('../lib/db');
const members = require('../lib/members');
const { e, ce, COLORS } = require('../lib/theme');
const { allStaffRoleIds, isMod, isStaff } = require('../lib/permissions');
const { UserError, ts, truncate, sendToChannel } = require('../lib/utils');
const { container, text, divider, btn, row, header, v2 } = require('../lib/v2');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const REPEAT_AFTER = DAY;
const KEEP_ALERTS = 30 * DAY;
const NEW_ACCOUNT = 7 * DAY;

// ───────────── Names ─────────────

/** Characters that look like Latin letters (NFKD already turns 𝐀 / Ａ / ⓐ into a). */
const LOOKALIKES = {
  0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's',
  // Cyrillic
  а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x',
  і: 'i', ї: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ԛ: 'q', ԝ: 'w',
  // Greek
  α: 'a', β: 'b', ε: 'e', η: 'n', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x', ω: 'w',
  // Latin letters without a decomposition
  ø: 'o', ł: 'l', đ: 'd', ħ: 'h', ı: 'i', ß: 'ss', æ: 'ae', œ: 'oe',
};

const collapse = (s) => s.replace(/(.)\1+/g, '$1');

/**
 * { full, short, size } – the normalised name, without and with repeated letters collapsed. i, I, l, 1, | and !
 * all look alike, so they become the same letter (l) – on both sides, so "MIA", "mia" and "M1a" are one name.
 * size is how many letters the name really has (repeats counted once, i and l still told apart): it decides
 * whether a name is long enough to compare, so merging i and l doesn't make "Ali" or "Emily" shorter.
 */
function forms(name) {
  const plain = String(name ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/(?<=\p{L})\|(?=\p{L})/gu, 'l') // "A|ex" – but "Alex | Support" keeps its separator
    .replace(/(?<=\p{L})!(?=\p{L})/gu, 'i') // "L!am" – but "Alex!!" is just Alex
    .toLowerCase();
  const letters = [...plain]
    .map((ch) => LOOKALIKES[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]/g, '')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w');
  const full = letters.replace(/i/g, 'l');
  return { full, short: collapse(full), size: collapse(letters).length };
}

/** "Ａ1ex_$upp0rt" → "alexsuport" */
const normalize = (name) => forms(name).short;

/** Edit distance where swapping two neighbouring letters is one edit ("jhon" → "john"). */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Words that make a name look official ("alex support", "nøx team"). */
const TITLES = ['support', 'admin', 'administrator', 'staff', 'team', 'mod', 'moderator', 'helper', 'help', 'official', 'owner', 'founder', 'manager', 'seller', 'service', 'real'];
const TITLE_FORMS = [...TITLES, config.brand.name].map(forms);
const WORDS = { full: TITLE_FORMS.map((f) => f.full), short: TITLE_FORMS.map((f) => f.short) };
const isTitle = (word) => WORDS.full.includes(forms(word).full) || WORDS.short.includes(forms(word).short);

/** Can `rest` be split completely into title words ("suportteam" → support + team)? */
function onlyTitles(rest, words) {
  const ok = [true];
  for (let i = 1; i <= rest.length; i += 1) ok[i] = words.some((w) => w.length <= i && ok[i - w.length] && rest.startsWith(w, i - w.length));
  return ok[rest.length];
}

/** The staff name with nothing but title words around it. */
function titled(candidate, staff) {
  return ['full', 'short'].some((form) => {
    const name = staff[form];
    const at = name.length >= 3 ? candidate[form].indexOf(name) : -1;
    if (at === -1) return false;
    const before = candidate[form].slice(0, at);
    const after = candidate[form].slice(at + name.length);
    return Boolean(before || after) && onlyTitles(before, WORDS[form]) && onlyTitles(after, WORDS[form]);
  });
}

/** compare() for names that are already normalised with forms(). */
function compareForms(a, b, { titleOnly = false } = {}) {
  if (a.size < 3 || b.size < 3) return null;
  if (!titleOnly && a.short === b.short) return 'exact';
  if (titled(a, b)) return 'title';
  if (!titleOnly && b.size >= 5 && Math.abs(a.short.length - b.short.length) <= 1 && distance(a.short, b.short) <= 1) return 'similar';
  return null;
}

/** 'exact' | 'title' | 'similar' | null. titleOnly – only "<name> + title" counts (used for the brand name). */
const compare = (name, staffName, opts) => compareForms(forms(name), forms(staffName), opts);

/** "Alex | NØX Support" → "Alex" – the person's name without the titles staff put in their nickname. */
function core(name) {
  const tokens = String(name ?? '').split(/[\s|/\\·•:,;~+*#()[\]{}<>_.-]+/).filter(Boolean);
  const kept = tokens.filter((t) => !isTitle(t));
  return kept.length && kept.length < tokens.length ? kept.join(' ') : null;
}

// ───────────── Profiles ─────────────

const FIELDS = { username: 'Username', globalName: 'Display name', nickname: 'Server nickname' };

/** [[field, name]] – the names a member is shown with. */
function namesOf(member) {
  return [
    ['username', member.user?.username],
    ['globalName', member.user?.globalName],
    ['nickname', member.nickname],
  ].filter(([, name]) => name);
}

const avatarsOf = (member) => [...new Set([member.user?.avatar, member.avatar].filter(Boolean))];

/**
 * Every staff member's names (plus their name without titles) and avatars – and the brand as "the team".
 * roleIds (roles that can make someone staff) is a cheap first filter, so isStaff() only runs for likely staff.
 */
function staffProfiles(guild, roleIds = allStaffRoleIds(guild)) {
  const hasStaffRole = (m) => {
    for (const id of m.roles.cache.keys()) if (roleIds.has(id)) return true; // roles.cache builds a new Collection – read it once
    return false;
  };
  const maybeStaff = (m) => m.id === guild.ownerId || env.ownerIds.includes(m.id) || hasStaffRole(m);
  const list = [];
  for (const m of guild.members.cache.values()) {
    if (m.user?.bot || !maybeStaff(m) || !isStaff(m)) continue;
    const names = namesOf(m).map(([, name]) => name);
    for (const name of [...names]) {
      const c = core(name);
      if (c && !names.includes(c)) names.push(c);
    }
    list.push({ id: m.id, names: names.map((name) => ({ name, forms: forms(name) })), avatars: avatarsOf(m) });
  }
  list.push({ id: null, names: [{ name: config.brand.name, forms: forms(config.brand.name) }], avatars: [], titleOnly: true });
  return list;
}

/**
 * staffProfiles(), kept per server – a raid of joins compares against the same list instead of scanning every
 * member each time. Rebuilt when the staff roles change (a role is created, deleted or gets admin permissions,
 * /setup, /build, a new owner), when a staff member changes, joins or leaves (forgetStaff), and at the latest
 * after STAFF_TTL in case Discord didn't tell us about something.
 */
const STAFF_TTL = 10 * 60_000;
const staffCache = new WeakMap(); // Guild → { signature, at, list }

function staffList(guild, now = Date.now()) {
  const roleIds = allStaffRoleIds(guild);
  const signature = `${guild.ownerId}|${[...roleIds].filter((id) => guild.roles.cache.has(id)).sort().join(',')}`;
  const cached = staffCache.get(guild);
  if (cached && cached.signature === signature && now - cached.at < STAFF_TTL) return cached.list;
  const list = staffProfiles(guild, roleIds);
  staffCache.set(guild, { signature, at: now, list });
  return list;
}

const forgetStaff = (guild) => guild && staffCache.delete(guild);

/** Is this member staff now, or in the kept staff list (e.g. just lost their staff role)? */
const staffChange = (member) => isStaff(member) || Boolean(staffCache.get(member.guild)?.list.some((s) => s.id === member.id));

const RANK = { exact: 0, title: 1, similar: 2 };

/** What makes this member look like staff: [{ key, kind, field, name, staffId, staffName }]. */
function findMatches(member, staff) {
  const found = new Map();
  for (const [field, name] of namesOf(member)) {
    const own = forms(name);
    const key = `${member.id}:${own.short}`;
    for (const s of staff) {
      for (const { name: staffName, forms: theirs } of s.names) {
        const kind = compareForms(own, theirs, s);
        const prev = found.get(key);
        if (kind && (!prev || RANK[kind] < RANK[prev.kind])) found.set(key, { key, kind, field, name, staffId: s.id, staffName });
      }
    }
  }
  const own = avatarsOf(member);
  for (const s of staff) {
    for (const hash of s.avatars) {
      const key = `${member.id}:avatar:${hash}`;
      if (own.includes(hash) && !found.has(key)) found.set(key, { key, kind: 'avatar', field: 'avatar', name: null, staffId: s.id, staffName: null });
    }
  }
  return [...found.values()];
}

// ───────────── Alerts ─────────────

function store(guildId) {
  const security = db.guild(guildId).security;
  security.impersonation ??= {};
  security.impersonation.alerts ??= {};
  security.impersonation.ignored ??= {};
  return security.impersonation;
}

function prune(state, now) {
  for (const [id, alert] of Object.entries(state.alerts)) if (now - alert.at > KEEP_ALERTS) delete state.alerts[id];
}

/**
 * Was this user + name reported in the last 24 hours, during the member's current stay? A kick or ban from the
 * alert, leaving the server (goneAt) or a different join time ends that stay – someone who comes back is new.
 */
function alertedRecently(state, key, now, member) {
  const joinedAt = member.joinedTimestamp ?? null;
  return Object.values(state.alerts).some(
    (a) =>
      now - a.at < REPEAT_AFTER &&
      !a.goneAt &&
      !a.actions.some((x) => x.action === 'kick' || x.action === 'ban') &&
      (a.joinedAt == null || joinedAt == null || a.joinedAt === joinedAt) &&
      a.matches.some((m) => m.key === key),
  );
}

/** The member left (or was kicked / banned): their earlier alerts don't hold back a new one when they come back. */
function memberGone(member, now = Date.now()) {
  if (!member?.guild) return;
  const state = store(member.guild.id);
  let changed = false;
  for (const alert of Object.values(state.alerts)) {
    if (alert.userId !== member.id || alert.goneAt) continue;
    alert.goneAt = now;
    changed = true;
  }
  if (changed) db.save();
}

const TRIGGERS = {
  join: 'joined the server',
  username: 'changed their username',
  globalName: 'changed their display name',
  nickname: 'changed their server nickname',
  avatar: 'changed their avatar',
  guildAvatar: 'changed their server avatar',
  profile: 'updated their profile',
};

const ACTIONS = {
  ban: { label: 'Ban', icon: 'x', style: ButtonStyle.Danger, done: 'Banned', final: true },
  kick: { label: 'Kick', icon: 'arrow_right', style: ButtonStyle.Danger, done: 'Kicked', final: true },
  timeout: { label: 'Timeout 24h', icon: 'clock', style: ButtonStyle.Primary, done: 'Timed out for 24 hours' },
  ignore: { label: 'Ignore', icon: 'check', style: ButtonStyle.Secondary, done: "Ignored – this name won't be reported again", final: true },
};

const quote = (name) => `“${truncate(escapeMarkdown(String(name)), 64)}”`;

function matchLine(guild, m) {
  const who = m.staffId ? `<@${m.staffId}>` : `the **${config.brand.name}** team`;
  if (m.kind === 'avatar') return `> ${e(guild, 'person')} **Avatar** – the same picture as ${who}`;
  const how = {
    exact: `the same name as ${who} (${quote(m.staffName)})`,
    title: m.staffId ? `${who}'s name (${quote(m.staffName)}) with a staff title` : `poses as ${who}`,
    similar: `one letter away from ${who} (${quote(m.staffName)})`,
  }[m.kind];
  return `> ${e(guild, 'warning')} **${FIELDS[m.field]}** ${quote(m.name)} – ${how}`;
}

function buttonsFor(guild, alert) {
  if (alert.actions.some((a) => ACTIONS[a.action].final)) return [];
  const timedOut = alert.actions.some((a) => a.action === 'timeout');
  return Object.entries(ACTIONS)
    .filter(([action]) => !(timedOut && action === 'timeout'))
    .map(([action, a]) => btn(`imp:${action}:${alert.id}`, a.label, ce(guild, a.icon), a.style));
}

/** The card in #automod-logs – rendered from the stored alert, so it can be redrawn after the member is gone. */
function alertCard(guild, alert, now = Date.now()) {
  const handled = alert.actions.some((a) => ACTIONS[a.action].final);
  const c = container(handled ? COLORS.muted : COLORS.warning);
  header(
    c,
    `## ${e(guild, 'shield')} Possible staff impersonation\n` +
      `<@${alert.userId}> · \`${truncate(alert.username ?? 'unknown', 40)}\` · \`${alert.userId}\`\n` +
      `They ${TRIGGERS[alert.trigger] ?? TRIGGERS.profile} and look like a member of the team.`,
    alert.avatarUrl,
  );
  c.addSeparatorComponents(divider());
  c.addTextDisplayComponents(text(`### What matched\n${alert.matches.map((m) => matchLine(guild, m)).join('\n')}`));
  const fresh = alert.createdAt && now - alert.createdAt < NEW_ACCOUNT ? ` · ${e(guild, 'warning')} **new account**` : '';
  c.addTextDisplayComponents(
    text(
      `**Account created:** ${alert.createdAt ? `${ts(alert.createdAt, 'D')} (${ts(alert.createdAt, 'R')})${fresh}` : 'unknown'}\n` +
        `**Joined the server:** ${alert.joinedAt ? ts(alert.joinedAt, 'R') : 'unknown'}`,
    ),
  );
  if (alert.actions.length) {
    c.addSeparatorComponents(divider());
    c.addTextDisplayComponents(text(alert.actions.map((a) => `${e(guild, 'check')} **${ACTIONS[a.action].done}** by <@${a.by}> · ${ts(a.at, 'R')}`).join('\n')));
  }
  const buttons = buttonsFor(guild, alert);
  if (buttons.length) c.addActionRowComponents(row(...buttons));
  c.addTextDisplayComponents(text(`-# Alert \`${alert.id}\` · ${ts(alert.at, 'f')} · only moderators can use these buttons`));
  return v2(c);
}

/** Compares a member with the staff and posts an alert for new matches. Returns the alert or null. */
async function check(member, trigger = 'join', now = Date.now()) {
  if (!config.security.impersonationAlerts || !member?.guild || member.user?.bot || isStaff(member)) return null;
  const guild = member.guild;
  const channelId = db.channelId(guild.id, 'automodLogs');
  if (!channelId) return null;
  const state = store(guild.id);
  prune(state, now);
  const matches = findMatches(member, staffList(guild, now)).filter((m) => !state.ignored[m.key] && !alertedRecently(state, m.key, now, member));
  if (!matches.length) return null;

  const alert = {
    id: crypto.randomBytes(4).toString('hex'),
    userId: member.id,
    username: member.user?.username ?? null,
    avatarUrl: member.displayAvatarURL?.({ size: 128 }) ?? null,
    createdAt: member.user?.createdTimestamp ?? null,
    joinedAt: member.joinedTimestamp ?? null,
    trigger,
    matches,
    at: now,
    actions: [],
  };
  state.alerts[alert.id] = alert; // stored before sending, so a second event right after can't alert twice
  db.save();
  const message = await sendToChannel(guild, channelId, alertCard(guild, alert, now));
  if (!message) {
    delete state.alerts[alert.id];
    db.save();
    return null;
  }
  alert.messageId = message.id;
  db.save();
  return alert;
}

// ───────────── Buttons ─────────────

const auditReason = (user, what) => `${config.brand.name}: ${what} from an impersonation alert by ${user.tag ?? user.username}`.slice(0, 512);

async function target(guild, alert, required) {
  const member = await guild.members.fetch(alert.userId).catch(() => null);
  if (!member && required) throw new UserError(`<@${alert.userId}> is no longer on the server.`);
  if (member && isStaff(member)) throw new UserError(`<@${alert.userId}> is a staff member now – I won't act on them.`);
  return member;
}

const ACT = {
  async ban(guild, alert, user) {
    const member = await target(guild, alert, false);
    if (member && !member.bannable) throw new UserError(`I can't ban <@${alert.userId}> – their highest role is above mine.`);
    await guild.bans.create(alert.userId, { reason: auditReason(user, 'ban'), deleteMessageSeconds: HOUR / 1000 });
  },
  async kick(guild, alert, user) {
    const member = await target(guild, alert, true);
    if (!member.kickable) throw new UserError(`I can't kick <@${alert.userId}> – their highest role is above mine.`);
    await member.kick(auditReason(user, 'kick'));
  },
  async timeout(guild, alert, user) {
    const member = await target(guild, alert, true);
    if (!member.moderatable) throw new UserError(`I can't time out <@${alert.userId}> – their highest role is above mine.`);
    await member.timeout(DAY, auditReason(user, '24h timeout'));
  },
  async ignore(guild, alert, user) {
    const { ignored } = store(guild.id);
    for (const m of alert.matches) ignored[m.key] = { by: user.id, at: Date.now() };
  },
};

async function onButton(interaction, action, [alertId]) {
  if (!ACTIONS[action]) return null;
  const { guild, user } = interaction;
  if (!isMod(interaction.member)) throw new UserError('Only moderators and administrators can act on impersonation alerts.');
  const alert = store(guild.id).alerts[alertId];
  if (!alert) throw new UserError('This alert is too old – act on the member directly (right-click → Ban / Kick / Timeout).');
  const final = alert.actions.find((a) => ACTIONS[a.action].final);
  if (final) throw new UserError(`This alert was already handled: **${ACTIONS[final.action].done}** by <@${final.by}>.`);
  if (action === 'timeout' && alert.actions.some((a) => a.action === 'timeout')) throw new UserError('This member is already timed out.');
  await ACT[action](guild, alert, user);
  alert.actions.push({ action, by: user.id, at: Date.now() });
  db.save();
  return interaction.update(alertCard(guild, alert));
}

// ───────────── Wiring ─────────────

function memberChange(before, after) {
  if (!before || before.partial) return 'profile';
  if ((before.nickname ?? null) !== (after.nickname ?? null)) return 'nickname';
  if ((before.avatar ?? null) !== (after.avatar ?? null)) return 'guildAvatar';
  return null;
}

function userChange(before, after) {
  if (!before || before.partial) return 'profile';
  if (before.username !== after.username) return 'username';
  if ((before.globalName ?? null) !== (after.globalName ?? null)) return 'globalName';
  if ((before.avatar ?? null) !== (after.avatar ?? null)) return 'avatar';
  return null;
}

// A staff member who joins, leaves, gets or loses a staff role or changes their profile → rebuild the staff list.
hooks.on('memberAdd', (member) => {
  if (staffChange(member)) forgetStaff(member.guild);
  return check(member, 'join');
});
hooks.on('memberRemove', (member) => {
  if (staffChange(member)) forgetStaff(member.guild);
  memberGone(member);
});
hooks.on('memberUpdate', (before, after) => {
  if (!before || before.partial || isStaff(before) || staffChange(after)) forgetStaff(after.guild);
  const what = memberChange(before, after);
  return what ? check(after, what) : null;
});
hooks.on('userUpdate', async (before, after) => {
  const what = userChange(before, after);
  if (!what) return;
  for (const guild of after.client?.guilds?.cache?.values() ?? []) {
    const member = guild.members.cache.get(after.id);
    if (!member) continue;
    if (staffChange(member)) forgetStaff(guild);
    await check(member, what);
  }
});
// Staff who haven't talked since the start aren't cached – load everyone once, so all staff names are known.
// A server the bot is (re-)added to is a new Guild object with almost no members cached: load it too.
async function loadMembers(guild) {
  if (!config.security.impersonationAlerts) return;
  await members.fetchAll(guild);
  forgetStaff(guild);
}
hooks.on('ready', async (client) => {
  for (const guild of client.guilds.cache.values()) await loadMembers(guild);
});
hooks.on('guildCreate', (guild) => loadMembers(guild));
hooks.route('imp', { button: onButton });

module.exports = { normalize, forms, distance, compare, core, findMatches, staffProfiles, staffList, forgetStaff, check, alertCard, store };
