'use strict';

/**
 * Working hours (config.json → workingHours) in the shop's own time zone:
 *   { "enabled": true, "timezone": "Europe/Warsaw", "days": [1, 2, 3, 4, 5, 6, 0], "from": "10:00", "to": "20:00" }
 * days: 0 = Sunday … 6 = Saturday. "to" may be after midnight ("18:00"–"02:00").
 * No bot dependencies, so config.js can use it to write the support hours text.
 */

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0];
const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const formats = new Map();
function formatter(timeZone) {
  if (!formats.has(timeZone)) {
    formats.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }),
    );
  }
  return formats.get(timeZone);
}

/** Wall-clock time in a time zone: { year, month, day, weekday (0 = Sunday), minutes since midnight }. */
function zoned(now, timeZone = 'UTC') {
  const p = Object.fromEntries(formatter(timeZone).formatToParts(now).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), weekday: SHORT.indexOf(p.weekday), minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** "10:00" → 600 */
const toMinutes = (s) => {
  const [h, m] = String(s).split(':');
  return Number(h) * 60 + Number(m ?? 0);
};

const range = (wh) => ({ from: toMinutes(wh.from ?? '00:00'), to: toMinutes(wh.to ?? '24:00'), days: wh.days ?? ALL_DAYS });

/** Whether the time is inside the working hours (always true when they are turned off). */
function inHours(wh, now = new Date()) {
  if (!wh?.enabled) return true;
  const { from, to, days } = range(wh);
  const z = zoned(now, wh.timezone);
  if (from <= to) return days.includes(z.weekday) && z.minutes >= from && z.minutes < to;
  // Over midnight: the early hours still belong to the day before.
  return (days.includes(z.weekday) && z.minutes >= from) || (days.includes((z.weekday + 6) % 7) && z.minutes < to);
}

/** The moment it is `minutes` after midnight of year-month-day in that time zone (handles DST). */
function wallTime(year, month, day, minutes, timeZone) {
  const target = Date.UTC(year, month - 1, day, 0, minutes);
  const offset = (t) => {
    const z = zoned(new Date(t), timeZone);
    return Date.UTC(z.year, z.month - 1, z.day, 0, z.minutes) - t;
  };
  let t = target - offset(target);
  t = target - offset(t);
  return new Date(t);
}

/** When the hours start next, after `now` (null when they are off or have no days). */
function nextOpening(wh, now = new Date()) {
  if (!wh?.enabled) return null;
  const { from, days } = range(wh);
  const today = zoned(now, wh.timezone);
  for (let d = 0; d <= 7; d += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    if (!days.includes(date.getUTCDay())) continue;
    const at = wallTime(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), from, wh.timezone);
    if (at > now) return at;
  }
  return null;
}

/** When the current opening ends (null when it's closed now, or the hours are off). */
function nextClosing(wh, now = new Date()) {
  if (!wh?.enabled) return null;
  const { from, to, days } = range(wh);
  const today = zoned(now, wh.timezone);
  for (let d = -1; d <= 7; d += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + d));
    if (!days.includes(date.getUTCDay())) continue;
    const ymd = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    const opens = wallTime(...ymd, from, wh.timezone);
    const closes = wallTime(...ymd, from <= to ? to : to + 1440, wh.timezone);
    if (opens <= now && now < closes) return closes;
  }
  return null;
}

/** "at 10:00" / "tomorrow at 10:00" / "on Monday at 10:00" – `at` seen from `now`, in that time zone. */
function whenText(wh, at, now = new Date()) {
  const a = zoned(at, wh.timezone);
  const n = zoned(now, wh.timezone);
  const days = Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(n.year, n.month - 1, n.day)) / 86_400_000);
  const time = `${Math.floor(a.minutes / 60)}:${String(a.minutes % 60).padStart(2, '0')}`.padStart(5, '0');
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${LONG[a.weekday]} at ${time}`;
}

/** "Central European Time" for Europe/Warsaw, "UTC" for UTC. */
function zoneLabel(timeZone = 'UTC') {
  if (/^(Etc\/)?(UTC|GMT)$/i.test(timeZone)) return 'UTC';
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

/** [1,2,3,4,5,6,0] → "Every day", [1,2,3,4,5] → "Mon–Fri", [6,0] → "Weekends", [1,3,5] → "Mon, Wed, Fri". */
function daysText(days = ALL_DAYS) {
  const list = MONDAY_FIRST.filter((d) => days.includes(d));
  if (list.length === 7) return 'Every day';
  if (list.length === 2 && list.includes(6) && list.includes(0)) return 'Weekends';
  const idx = list.map((d) => MONDAY_FIRST.indexOf(d));
  const run = idx.every((v, i) => i === 0 || v === idx[i - 1] + 1);
  if (run && list.length >= 3) return `${SHORT[list[0]]}–${SHORT[list[list.length - 1]]}`;
  return list.map((d) => SHORT[d]).join(', ');
}

/** "Every day 10:00–20:00 (Central European Time)" – null when working hours are off. */
function hoursText(wh) {
  if (!wh?.enabled) return null;
  return `${daysText(wh.days)} ${wh.from ?? '00:00'}–${wh.to ?? '24:00'} (${zoneLabel(wh.timezone)})`;
}

module.exports = { zoned, toMinutes, inHours, nextOpening, nextClosing, whenText, zoneLabel, daysText, hoursText };
