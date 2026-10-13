// Dates and repeat rules: one copy for every part of LifeWorld (phase 1 section 5; before, a
// verbatim copy each in Today, Planner and Projects). Every day is a local calendar day as
// 'YYYY-MM-DD'; day arithmetic runs on UTC-anchored dates so daylight saving never shifts a day.
'use strict';

function pad2(n) { return String(n).padStart(2, '0'); }
function dayOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function isDayStr(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function toDayStr(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : dayOf(v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v).trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function utcOf(day) { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); }
function fromUtc(ms) { const d = new Date(ms); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; }
function addDays(day, n) { return fromUtc(utcOf(day) + n * 86400000); }
function daysBetween(a, b) { return Math.round((utcOf(b) - utcOf(a)) / 86400000); }
function weekdayOf(day) { return new Date(utcOf(day)).getUTCDay(); } // 0 = Sunday
function partsOf(day) { const [y, m, d] = day.split('-').map(Number); return { y, m, d }; }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

/* ---- recurrence (RFC 5545 subset TaskNotes writes) -----------------------
 * Handles DTSTART (date or date-time), FREQ DAILY/WEEKLY/MONTHLY/YEARLY,
 * INTERVAL, BYDAY (with ordinals for MONTHLY/YEARLY), BYMONTHDAY, BYMONTH,
 * BYSETPOS, COUNT, UNTIL, WKST and EXDATE. A rule it cannot read returns
 * null and the task is never shown as due (never guessed). */

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRRule(raw, fallbackStart) {
  if (!raw || typeof raw !== 'string') return null;
  const out = { interval: 1, byday: null, bymonthday: null, bymonth: null, bysetpos: null, count: null, until: null, wkst: 1, exdates: [] };
  let text = raw.replace(/\r/g, '');
  // DTSTART may carry parameters (DTSTART;TZID=...:20260904T090000); read it
  // whole before splitting the rest on ';'. Only the calendar date matters.
  const ds = /DTSTART(?:;[^:\n]*)?[:=](\d{4})(\d{2})(\d{2})[^;\n]*/i.exec(text);
  if (ds) { out.dtstart = `${ds[1]}-${ds[2]}-${ds[3]}`; text = text.replace(ds[0], ''); }
  const ex = /EXDATE(?:;[^:\n]*)?[:=]([0-9TZ,]+)/gi;
  let em;
  while ((em = ex.exec(text))) {
    em[1].split(',').forEach((x) => { const m = /(\d{4})(\d{2})(\d{2})/.exec(x); if (m) out.exdates.push(`${m[1]}-${m[2]}-${m[3]}`); });
  }
  text = text.replace(ex, '');
  const parts = text.split(/[;\n]/).map((p) => p.trim().replace(/^RRULE:/i, '')).filter(Boolean);
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i).trim().toUpperCase();
    const val = p.slice(i + 1).trim();
    if (k === 'FREQ') out.freq = val.toUpperCase();
    else if (k === 'INTERVAL') out.interval = Math.max(1, parseInt(val, 10) || 1);
    else if (k === 'COUNT') out.count = Math.max(0, parseInt(val, 10) || 0);
    else if (k === 'UNTIL') { const m = /(\d{4})(\d{2})(\d{2})/.exec(val); if (m) out.until = `${m[1]}-${m[2]}-${m[3]}`; }
    else if (k === 'WKST') { if (WD[val.toUpperCase()] != null) out.wkst = WD[val.toUpperCase()]; }
    else if (k === 'BYDAY') {
      out.byday = val.split(',').map((t) => {
        const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(t.trim());
        return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD[m[2].toUpperCase()] } : null;
      }).filter(Boolean);
      if (!out.byday.length) return null;
    } else if (k === 'BYMONTHDAY') out.bymonthday = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x && Math.abs(x) <= 31);
    else if (k === 'BYMONTH') out.bymonth = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 12);
    else if (k === 'BYSETPOS') out.bysetpos = val.split(',').map((x) => parseInt(x, 10)).filter((x) => x);
  }
  if (!out.dtstart) out.dtstart = toDayStr(fallbackStart);
  if (!out.dtstart || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(out.freq)) return null;
  return out;
}

// Weekdays `byday` picks inside one month (y, m 1-based), as day numbers.
function monthDaysByDay(byday, y, m) {
  const dim = daysInMonth(y, m);
  const out = new Set();
  for (const { n, wd } of byday) {
    const hits = [];
    for (let d = 1; d <= dim; d++) if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === wd) hits.push(d);
    if (!n) hits.forEach((d) => out.add(d));
    else { const d = n > 0 ? hits[n - 1] : hits[hits.length + n]; if (d) out.add(d); }
  }
  return out;
}
function monthDaysByMonthDay(list, y, m) {
  const dim = daysInMonth(y, m);
  const out = new Set();
  for (const x of list) { const d = x > 0 ? x : dim + 1 + x; if (d >= 1 && d <= dim) out.add(d); }
  return out;
}
function applySetPos(set, pos) {
  if (!pos) return set;
  const sorted = [...set].sort((a, b) => a - b);
  const out = new Set();
  for (const p of pos) { const v = p > 0 ? sorted[p - 1] : sorted[sorted.length + p]; if (v != null) out.add(v); }
  return out;
}

// Pattern match only (ignores COUNT, UNTIL and EXDATE).
function matchesPattern(r, day) {
  const s = r.dtstart;
  if (day < s) return false;
  const { y, m, d } = partsOf(day);
  const st = partsOf(s);
  const wd = weekdayOf(day);
  if (r.bymonth && !r.bymonth.includes(m)) return false;
  if (r.freq === 'DAILY') {
    if (daysBetween(s, day) % r.interval !== 0) return false;
    if (r.bymonthday && !monthDaysByMonthDay(r.bymonthday, y, m).has(d)) return false;
    if (r.byday && !r.byday.some((b) => b.wd === wd)) return false;
    return true;
  }
  if (r.freq === 'WEEKLY') {
    const startOfWeek = (x) => addDays(x, -((weekdayOf(x) - r.wkst + 7) % 7));
    const weeks = daysBetween(startOfWeek(s), startOfWeek(day)) / 7;
    if (weeks % r.interval !== 0) return false;
    const days = r.byday ? r.byday.map((b) => b.wd) : [weekdayOf(s)];
    return days.includes(wd);
  }
  if (r.freq === 'MONTHLY') {
    const months = (y - st.y) * 12 + (m - st.m);
    if (months % r.interval !== 0) return false;
    let set;
    if (r.bymonthday && r.byday) {
      const a = monthDaysByMonthDay(r.bymonthday, y, m); const b = monthDaysByDay(r.byday, y, m);
      set = new Set([...a].filter((x) => b.has(x)));
    } else if (r.bymonthday) set = monthDaysByMonthDay(r.bymonthday, y, m);
    else if (r.byday) set = monthDaysByDay(r.byday, y, m);
    else set = new Set(st.d <= daysInMonth(y, m) ? [st.d] : []); // RFC: months without that day are skipped
    return applySetPos(set, r.bysetpos).has(d);
  }
  if (r.freq === 'YEARLY') {
    if ((y - st.y) % r.interval !== 0) return false;
    const months = r.bymonth || [st.m];
    if (!months.includes(m)) return false;
    let set;
    if (r.bymonthday) set = monthDaysByMonthDay(r.bymonthday, y, m);
    else if (r.byday) set = monthDaysByDay(r.byday, y, m);
    else set = new Set(st.d <= daysInMonth(y, m) ? [st.d] : []);
    return applySetPos(set, r.bysetpos).has(d);
  }
  return false;
}

function occursOn(rule, day) {
  if (!rule || !isDayStr(day) || day < rule.dtstart) return false;
  if (rule.until && day > rule.until) return false;
  if (!matchesPattern(rule, day)) return false;
  if (rule.exdates.includes(day)) return false;
  if (rule.count) {
    // RFC 5545: COUNT counts pattern hits from DTSTART (EXDATE still uses a slot).
    let n = 0;
    for (let x = rule.dtstart; x <= day; x = addDays(x, 1)) {
      if (matchesPattern(rule, x)) n++;
      if (n > rule.count) return false;
    }
  }
  return true;
}

// Short month and weekday names, and clock times ('HH:MM'): moved in section 6 with the quick add that uses them.
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function halfOfTime(t) { return t ? (t < '13:00' ? 'am' : 'pm') : null; }

// 'HH:MM' -> '4:30 PM' ('4 PM' with short and no minutes).
function timeText(t, short) {
  if (!t) return '';
  const [h, mi] = t.split(':').map(Number);
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${short && !mi ? hh : `${hh}:${pad2(mi)}`} ${h < 12 ? 'AM' : 'PM'}`;
}

module.exports = { pad2, dayOf, isDayStr, toDayStr, utcOf, fromUtc, addDays, daysBetween, weekdayOf, partsOf, daysInMonth, WD, parseRRule, monthDaysByDay, monthDaysByMonthDay, applySetPos, matchesPattern, occursOn, MONTHS_SHORT, WEEKDAYS_SHORT, halfOfTime, timeText };
