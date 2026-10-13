'use strict';

const { pad2, isDayStr, toDayStr, utcOf, fromUtc, addDays, weekdayOf, partsOf, parseRRule, occursOn, halfOfTime, timeText, MONTHS_SHORT, WEEKDAYS_SHORT } = require('./dates');

/* ========================================================================== *
 * Quick add: one copy for every part of LifeWorld (phase 1 section 6; before, a
 * verbatim copy each in Projects and Planner). The Menu Bar Capture companion
 * keeps its own copy of this block; the A4 vault's tests compare it with this
 * one. Plain words -> a new task: "call Ana friday 3pm !high".
 * ========================================================================== */

const DOW_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DOW_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const MON_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function dowIndex(w) { const x = String(w).toLowerCase(); if (x.length < 3) return -1; return DOW_NAMES.findIndex((d) => d.startsWith(x) || (x.startsWith(d.slice(0, 3)) && d.startsWith(x.replace(/s$/, '')))); }
function nextDow(today, idx, skipToday) { let n = (idx - weekdayOf(today) + 7) % 7; if (n === 0 && skipToday) n = 7; return addDays(today, n); }
function validDay(y, m, d) { const s = `${y}-${pad2(m)}-${pad2(d)}`; return isDayStr(s) && toDayStr(fromUtc(utcOf(s))) === s ? s : null; }

// A typed day -> 'YYYY-MM-DD' or null.
function parseDayWord(w, today) {
  const x = String(w || '').trim().toLowerCase().replace(/^on /, '').replace(/[.,]+$/, '');
  if (!x) return null;
  if (x === 'today' || x === 'tonight') return today;
  if (x === 'tomorrow' || x === 'tmrw') return addDays(today, 1);
  if (x === 'yesterday') return addDays(today, -1);
  if (x === 'next week') return addDays(today, ((8 - weekdayOf(today)) % 7) || 7);
  let m = /^in (\d{1,3}) (day|days|week|weeks)$/.exec(x);
  if (m) return addDays(today, Number(m[1]) * (m[2].startsWith('week') ? 7 : 1));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(x);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  // Same rule as Scripts/quick-capture-sync.py: a weekday name is its next
  // one (a week ahead when it is today); "next <weekday>" adds a week.
  m = /^(next |this )?([a-z]+)$/.exec(x);
  if (m && dowIndex(m[2]) >= 0) { const base = nextDow(today, dowIndex(m[2]), true); return m[1] === 'next ' && base !== addDays(today, 7) ? addDays(base, 7) : base; }
  const year = Number(today.slice(0, 4));
  const ahead = (mo, d) => { const s = validDay(year, mo, d); if (!s) return null; return s < today ? validDay(year + 1, mo, d) : s; };
  m = /^([a-z]{3})[a-z]* (\d{1,2})(?:st|nd|rd|th)?$/.exec(x) || /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3})[a-z]*$/.exec(x);
  if (m) { const mon = MON_NAMES.indexOf(isNaN(m[1]) ? m[1] : m[2]); const d = Number(isNaN(m[1]) ? m[2] : m[1]); if (mon >= 0) return ahead(mon + 1, d); }
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(x);
  if (m) return ahead(Number(m[1]), Number(m[2]));
  return null;
}

const DAY_RE = '(today|tonight|tomorrow|tmrw|next week|in \\d{1,3} (?:days?|weeks?)|\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}/\\d{1,2}|(?:next |this )?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \\d{1,2}(?:st|nd|rd|th)?|\\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)';

// "every ..." words -> RRULE body (no DTSTART) or null.
function repeatRule(words) {
  const w = String(words || '').trim().toLowerCase().replace(/^every /, '');
  if (!w) return null;
  if (w === 'day' || w === 'daily') return 'FREQ=DAILY';
  if (w === 'other day') return 'FREQ=DAILY;INTERVAL=2';
  if (w === 'weekday' || w === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (w === 'week' || w === 'weekly') return 'FREQ=WEEKLY';
  if (w === 'other week') return 'FREQ=WEEKLY;INTERVAL=2';
  if (w === 'month' || w === 'monthly') return 'FREQ=MONTHLY';
  if (w === 'other month') return 'FREQ=MONTHLY;INTERVAL=2';
  if (w === 'year' || w === 'yearly') return 'FREQ=YEARLY';
  let m = /^(\d{1,3}) (day|days|week|weeks|month|months|year|years)$/.exec(w);
  if (m) { const f = { d: 'DAILY', w: 'WEEKLY', m: 'MONTHLY', y: 'YEARLY' }[m[2][0]]; return Number(m[1]) > 1 ? `FREQ=${f};INTERVAL=${Number(m[1])}` : `FREQ=${f}`; }
  m = /^(other |2nd |second )?(.+)$/.exec(w);
  const parts = m[2].split(/\s*(?:,|and|&)\s*/).filter(Boolean);
  const idx = parts.map(dowIndex);
  if (parts.length && idx.every((i) => i >= 0)) {
    const days = [...new Set(idx)].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((i) => DOW_CODES[i]);
    return `FREQ=WEEKLY;${m[1] ? 'INTERVAL=2;' : ''}BYDAY=${days.join(',')}`;
  }
  return null;
}
const REPEAT_RE = /\severy (other day|other week|other month|day|daily|weekdays?|week|weekly|month|monthly|year|yearly|\d{1,3} (?:days?|weeks?|months?|years?)|(?:other |2nd |second )?(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*(?:\s*(?:,|and|&)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*)*)\b/i;

// -> { title, priority, due, start, plannedDay, plannedHalf, recurrence, repeatText, time, startTime }
// (time: the due time, or a repeating task's start time; startTime: a one-off start's)
function understand(text, today) {
  let s = ` ${String(text || '')} `;
  const r = { priority: null };
  // Takes the first match the reader accepts (fn returns true) and cuts
  // only that one out of the title; a match it can't read stays in the text.
  const cut = (re, fn) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let m;
    while ((m = g.exec(s))) { if (fn(m)) { s = s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length); return; } g.lastIndex = m.index + 1; }
  };
  cut(/\s!(high|low|none|normal)\b/i, (m) => { r.priority = m[1].toLowerCase(); return true; });
  cut(/\s(p1|p2|p3|p4)\b/i, (m) => { r.priority = { p1: 'high', p2: 'normal', p3: 'low', p4: 'none' }[m[1].toLowerCase()]; return true; });
  cut(REPEAT_RE, (m) => { const rule = repeatRule(m[1]); if (!rule) return false; r.recurrence = rule; r.repeatText = m[1].toLowerCase(); return true; });
  cut(new RegExp(`\\s(?:starts?|start on|starting|from) ${DAY_RE}\\b`, 'i'), (m) => { const d = parseDayWord(m[1], today); if (!d) return false; r.start = d; return true; });
  cut(new RegExp(`\\s(?:due|by) ${DAY_RE}\\b`, 'i'), (m) => { const d = parseDayWord(m[1], today); if (!d) return false; r.due = d; return true; });
  // A clock time: "3pm", "at 9:30am", "4 p.m.", or "at 15:30" / "at noon" (a bare
  // colon time needs "at" here, so "Read Acts 2:38" stays a title).
  cut(/\s(?:at\s)?(\d{1,2}(?::\d{2})?\s?(?:am|pm|a\.m\.|p\.m\.))(?=\s)/i, (m) => { const tm = parseClock(m[1]); if (!tm) return false; r.time = tm; return true; });
  if (!r.time) cut(/\sat\s(\d{1,2}:\d{2}|noon|midnight)(?=\s)/i, (m) => { const tm = parseClock(m[1]); if (!tm) return false; r.time = tm; return true; });
  cut(/\s(?:in the |this )?(morning|afternoon|evening|tonight)\b/i, (m) => { r.plannedHalf = m[1].toLowerCase() === 'morning' ? 'am' : 'pm'; if (m[1].toLowerCase() === 'tonight') r.plannedDay = today; return true; });
  cut(new RegExp(`\\s(?:on )?${DAY_RE}\\b`, 'i'), (m) => { const d = parseDayWord(m[1], today); if (!d) return false; r.plannedDay = d; return true; });
  // "starts monday 9am" with no other day: the time goes with the start.
  if (r.time && !r.recurrence && r.start && !r.due && !r.plannedDay && !r.plannedHalf) { r.startTime = r.time; delete r.time; }
  if (r.time) r.plannedHalf = halfOfTime(r.time);    // a clock time picks the half (before 1 PM is Morning)
  if (r.time && !r.due && !r.recurrence) { r.due = r.plannedDay || today; delete r.plannedDay; } // and lives on Due
  if (r.plannedHalf && !r.plannedDay && !r.due && !r.recurrence) r.plannedDay = today;
  if (r.due && r.plannedDay) delete r.plannedDay;     // due always wins
  if (r.recurrence) { delete r.plannedDay; delete r.due; }
  r.title = s.replace(/\s+/g, ' ').trim();
  if (r.title) r.title = r.title[0].toUpperCase() + r.title.slice(1);
  return r;
}

// A typed clock time -> 'HH:MM' or null. Needs am/pm or a colon ("4pm",
// "4 p.m.", "9:30am", "15:30"), or is "noon" / "midnight". A bare "9" is not
// a time: it could be either half of the day, so it is never guessed.
function parseClock(s) {
  const x = String(s || '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, '');
  if (x === 'noon') return '12:00';
  if (x === 'midnight') return '00:00';
  let m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(x);
  if (m) {
    let h = Number(m[1]); const mi = Number(m[2] || 0);
    if (h < 1 || h > 12 || mi > 59) return null;
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    return `${pad2(h)}:${pad2(mi)}`;
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(x);
  if (m) { const h = Number(m[1]); const mi = Number(m[2]); return h <= 23 && mi <= 59 ? `${pad2(h)}:${pad2(mi)}` : null; }
  return null;
}

// The value written: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM' (TaskNotes' format).
function whenValue(day, time) { return day ? (time ? `${day}T${time}` : day) : null; }

// First occurrence of a new rule on or after `from` (for DTSTART/scheduled).
function firstOccurrence(rule, from) {
  const r = parseRRule(`DTSTART:${from.replace(/-/g, '')};${rule}`);
  if (!r) return from;
  for (let d = from, i = 0; i < 800; d = addDays(d, 1), i++) if (occursOn(r, d)) return d;
  return from;
}

// RRULE -> plain words ("Every Monday and Thursday").
const DOW_LONG = { SU: 'Sunday', MO: 'Monday', TU: 'Tuesday', WE: 'Wednesday', TH: 'Thursday', FR: 'Friday', SA: 'Saturday' };
function joinWords(list) { return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`; }
function ordinal(n) { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}`; }
function repeatWords(raw) {
  if (!raw) return "Doesn't repeat";
  const r = parseRRule(raw, '2000-01-01');
  if (!r) return 'Repeats (custom rule)';
  const n = r.interval;
  const days = r.byday ? r.byday.filter((b) => !b.n).map((b) => DOW_CODES[b.wd]) : null;
  if (r.freq === 'DAILY') return n === 1 ? 'Every day' : `Every ${n} days`;
  if (r.freq === 'WEEKLY') {
    if (days && days.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => days.includes(d)) && n === 1) return 'Every weekday (Mon to Fri)';
    const on = days && days.length ? joinWords(days.map((d) => DOW_LONG[d])) : DOW_LONG[DOW_CODES[weekdayOf(r.dtstart)]];
    return n === 1 ? `Every ${on}` : `Every ${n} weeks on ${on}`;
  }
  if (r.freq === 'MONTHLY') {
    const day = r.bymonthday && r.bymonthday.length === 1 ? r.bymonthday[0] : (r.byday ? null : partsOf(r.dtstart).d);
    const what = day ? `on the ${day < 0 ? 'last day' : ordinal(day)}` : 'on a set weekday';
    return n === 1 ? `Every month ${what}` : `Every ${n} months ${what}`;
  }
  if (r.freq === 'YEARLY') return n === 1 ? 'Every year' : `Every ${n} years`;
  return 'Repeats (custom rule)';
}

// Days and halves as the quick add line shows them.
function shortDay(day, today) {
  if (day === today) return 'today';
  if (day === addDays(today, 1)) return 'tomorrow';
  if (day === addDays(today, -1)) return 'yesterday';
  const { m, d, y } = partsOf(day);
  return `${WEEKDAYS_SHORT[weekdayOf(day)]}, ${MONTHS_SHORT[m - 1]} ${d}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
}
function halfWord(h) { return h === 'am' ? 'morning' : h === 'pm' ? 'afternoon' : ''; }

// The orange "what will be saved" line under a quick add box, as chip texts:
// the title, the project (when given), the day, Due, Starts, the repeat, and a
// priority that isn't the default one.
function quickAddChips(r, today, project, defaultPriority) {
  const out = [r.title || '…'];
  if (project) out.push(project);
  if (r.plannedDay) out.push(`On ${shortDay(r.plannedDay, today)}${r.plannedHalf ? `, ${halfWord(r.plannedHalf)}` : ''}`);
  else if (r.plannedHalf && !r.recurrence && !r.time) out.push(halfWord(r.plannedHalf));
  if (r.due) out.push(`Due ${shortDay(r.due, today)}${r.time ? `, ${timeText(r.time)}` : ''}`);
  if (r.start) out.push(`Starts ${shortDay(r.start, today)}${r.startTime ? `, ${timeText(r.startTime)}` : ''}`);
  if (r.recurrence) out.push(`${repeatWords(`DTSTART:${firstOccurrence(r.recurrence, today).replace(/-/g, '')};${r.recurrence}`)}${r.time ? `, ${timeText(r.time)}` : (r.plannedHalf ? `, ${halfWord(r.plannedHalf)}` : '')}`);
  if (r.priority && r.priority !== defaultPriority) out.push(r.priority[0].toUpperCase() + r.priority.slice(1));
  return out;
}

// What a quick add saves: TaskNotes' own fields (a time written as TaskNotes
// writes it, 'YYYY-MM-DDTHH:MM') plus A4's planned_* fields. `lane` is the
// day and half the task joins ({ day, half }, or null): the caller adds
// planned_order at the end of that lane. -> { input, lane }
function quickAddPlan(r, today) {
  const input = { title: r.title, customFrontmatter: {} };
  const cf = input.customFrontmatter;
  if (r.priority) input.priority = r.priority;
  if (r.due) input.due = whenValue(r.due, r.time);
  if (r.start) input.scheduled = whenValue(r.start, r.startTime);
  let lane = null;
  if (r.recurrence) { const first = firstOccurrence(r.recurrence, r.start || today); input.recurrence = r.recurrence; input.scheduled = whenValue(first, r.time); if (r.plannedHalf) cf.planned_half = r.plannedHalf; }
  else if (r.plannedDay || r.due) {
    lane = { day: r.due || r.plannedDay, half: r.plannedHalf || null };
    if (!r.due) cf.planned_day = r.plannedDay;
    if (lane.half) cf.planned_half = lane.half;
  }
  return { input, lane };
}
/* ---- end of SHARED quick add ---------------------------------------------- */

module.exports = { DOW_NAMES, DOW_CODES, MON_NAMES, dowIndex, nextDow, validDay, parseDayWord, DAY_RE, repeatRule, REPEAT_RE, understand, parseClock, whenValue, firstOccurrence, DOW_LONG, joinWords, ordinal, repeatWords, shortDay, halfWord, quickAddChips, quickAddPlan };
