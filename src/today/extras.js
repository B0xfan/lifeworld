// Seven more Today widgets (1.7.0, mockup approved 2026-11-23): Month calendar, Focus timer, Vault stats,
// Daily quote, Countdowns, On this day, Random note. The pure parts live here (tested in test-extras.js);
// the cards are drawn in main.js. Their settings are one `more` object in LifeWorld's settings file.
'use strict';

import { pad2, dayOf, addDays, daysBetween, weekdayOf, partsOf, toDayStr, isDayStr } from '../core/dates';

const CAL_SOURCES = ['dateline', 'google', 'apple'];
const FOCUS_GOAL = 4;
const MAX_COUNTDOWNS = 40;

/** @typedef {{ name: string, date: string, yearly: boolean }} Countdown */
/** @typedef {{ setEncoding: (e: string) => unknown, on: (ev: string, fn: (chunk: string) => void) => unknown, write: (s: string) => unknown, destroy: () => unknown }} DlSocket */
/** @typedef {{ week: string, notes: number, words: number, links: number }} StatsBase */
/** @typedef {{ calSource: string, quotesNote: string, countdowns: Countdown[], birthdays: boolean, exclude: string[], focus: { day: string, done: number }, statsBase: StatsBase | null }} More */

/** @param {unknown} raw @returns {More} */
function normalizeMore(raw) {
  const r = /** @type {Record<string, unknown>} */ (raw && typeof raw === 'object' ? raw : {});
  const f = /** @type {Record<string, unknown>} */ (r.focus && typeof r.focus === 'object' ? r.focus : {});
  const b = /** @type {Record<string, unknown>} */ (r.statsBase && typeof r.statsBase === 'object' ? r.statsBase : {});
  const num = (/** @type {unknown} */ v) => (Number.isFinite(v) && /** @type {number} */ (v) >= 0 ? /** @type {number} */ (v) : 0);
  return {
    calSource: CAL_SOURCES.includes(/** @type {string} */ (r.calSource)) ? /** @type {string} */ (r.calSource) : '',
    quotesNote: typeof r.quotesNote === 'string' ? r.quotesNote.trim() : '',
    countdowns: (Array.isArray(r.countdowns) ? r.countdowns : []).map((c) => normalizeCountdown(c)).filter((c) => !!c).slice(0, MAX_COUNTDOWNS),
    birthdays: r.birthdays !== false,
    exclude: [...new Set((Array.isArray(r.exclude) ? /** @type {unknown[]} */ (r.exclude) : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => /** @type {string} */ (x).trim().replace(/^\/+|\/+$/g, '')).filter(Boolean))],
    focus: { day: isDayStr(f.day) ? f.day : '', done: Math.floor(num(f.done)) },
    statsBase: isDayStr(b.week) ? { week: b.week, notes: num(b.notes), words: num(b.words), links: num(b.links) } : null,
  };
}

/** @param {unknown} c @returns {Countdown | null} */
function normalizeCountdown(c) {
  const x = /** @type {Record<string, unknown>} */ (c && typeof c === 'object' ? c : {});
  const name = typeof x.name === 'string' ? x.name.trim().slice(0, 80) : '';
  return name && isDayStr(x.date) ? { name, date: x.date, yearly: x.yearly === true } : null;
}

/* ---- month calendar ------------------------------------------------------ */

// The weeks a month's grid shows, Monday first: whole weeks from the Monday on or before the 1st to the
// Sunday on or after the last day. -> [{ day, out }] (out: from the month before or after).
/** @param {string} ym 'YYYY-MM' */
function monthGrid(ym) {
  const first = `${ym}-01`;
  const start = addDays(first, -((weekdayOf(first) + 6) % 7));
  const last = addDays(`${nextMonth(ym)}-01`, -1);
  const end = addDays(last, (7 - weekdayOf(last)) % 7);
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push({ day: d, out: d.slice(0, 7) !== ym });
  return out;
}
/** @param {string} ym */
function nextMonth(ym) { const { y, m } = partsOf(`${ym}-01`); return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`; }
/** @param {string} ym */
function prevMonth(ym) { const { y, m } = partsOf(`${ym}-01`); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; }

// A colour slot (1 to 4) per calendar name, in the order they first come up.
/** @param {{ calendar?: string }[]} events @returns {Map<string, number>} */
function calendarSlots(events) {
  /** @type {Map<string, number>} */
  const m = new Map();
  for (const e of events) { const n = e.calendar || ''; if (!m.has(n)) m.set(n, (m.size % 4) + 1); }
  return m;
}

// Dateline's list_events answer -> the calendar note's event shape, at this device's local time.
/** @param {unknown} list */
function fromDateline(list) {
  /** @type {Record<string, unknown>[]} */
  const rows = (Array.isArray(list) ? /** @type {unknown[]} */ (list) : []).filter((e) => !!e && typeof e === 'object').map((e) => /** @type {Record<string, unknown>} */ (e));
  return rows.filter((e) => typeof e.start === 'string').map((e) => {
    const s = new Date(String(e.start)); const en = typeof e.end === 'string' ? new Date(e.end) : null;
    const allDay = e.all_day === true;
    const hm = (/** @type {Date} */ d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    return { date: allDay ? String(e.start).slice(0, 10) : dayOf(s), time: allDay ? null : hm(s), end: allDay || !en || isNaN(en.getTime()) ? null : hm(en), all_day: allDay, summary: typeof e.title === 'string' && e.title ? e.title : '(untitled)', calendar: typeof e.calendar === 'string' ? e.calendar : '' };
  }).filter((e) => isDayStr(e.date));
}

// One question to Dateline's assistant connection on this Mac (Dateline Settings › Assistant): the events
// between two days, read only. `connect` is Node's net.createConnection (a stand-in in tests).
// -> events, or a thrown Error whose `plain` is the sentence the card shows.
/** @param {(path: string) => DlSocket} connect @param {string} path @param {string} from @param {string} to @param {number} [timeoutMs] */
function askDateline(connect, path, from, to, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = ''; let done = false;
    const sock = connect(path);
    const fail = (/** @type {string} */ plain) => { if (done) return; done = true; sock.destroy(); reject(Object.assign(new Error('dateline'), { plain })); };
    const timer = window.setTimeout(() => fail('Dateline did not answer. If Dateline is asking whether LifeWorld may use your calendar, answer it, then try again.'), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', () => { window.clearTimeout(timer); fail('Dateline is not open, or its Assistant is off. Open Dateline and turn on Settings › Assistant.'); });
    sock.on('close', () => { window.clearTimeout(timer); fail('Dateline did not let LifeWorld read the calendar.'); });
    sock.on('connect', () => sock.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_events', arguments: { from, to } } })}\n`));
    sock.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl < 0) return;
      window.clearTimeout(timer);
      /** @type {unknown} */
      let raw = null;
      try { raw = JSON.parse(buf.slice(0, nl)); } catch { /* not JSON: falls through to the plain error */ }
      const m = /** @type {{ result?: { isError?: boolean, content?: { text?: string }[] } }} */ (raw && typeof raw === 'object' ? raw : {});
      const text = m.result && m.result.content && m.result.content[0] ? String(m.result.content[0].text || '') : '';
      if (!m.result || m.result.isError) { fail(text ? `Dateline: ${text}` : 'Dateline did not answer.'); return; }
      /** @type {unknown} */
      let list;
      try { list = JSON.parse(text); } catch { fail('Dateline sent an answer LifeWorld cannot read.'); return; }
      done = true; sock.destroy(); resolve(fromDateline(list));
    });
  });
}

/* ---- focus timer --------------------------------------------------------- */

const FOCUS_CHOICES = [{ id: 'f25', label: '25 min', mins: 25, focus: true }, { id: 'f50', label: '50 min', mins: 50, focus: true }, { id: 'b5', label: 'Break 5', mins: 5, focus: false }];
/** @typedef {{ id: string, mins: number, focus: boolean, endsAt: number, left: number | null, task: string }} FocusRun */
// Time left in ms: a paused run keeps its `left`.
/** @param {FocusRun} run @param {number} now */
function focusLeft(run, now) { return Math.max(0, run.left != null ? run.left : run.endsAt - now); }
/** @param {number} ms */
function mmss(ms) { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${pad2(s % 60)}`; }
// Today's finished focus runs (the count starts again each day).
/** @param {More['focus']} f @param {string} today */
function focusDone(f, today) { return f.day === today ? f.done : 0; }

/* ---- vault stats --------------------------------------------------------- */

// Words in a note's text: frontmatter, code fences and markup left out.
/** @param {string} text */
function countWords(text) {
  const body = String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '').replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]|()-]+/g, ' ');
  const m = body.match(/[\p{L}\p{N}][\p{L}\p{N}'’.]*/gu);
  return m ? m.length : 0;
}
// resolvedLinks (source -> { target: count }) -> { links, unlinked paths }.
/** @param {string[]} paths @param {Record<string, Record<string, number>>} resolved */
function linkStats(paths, resolved) {
  let links = 0;
  /** @type {Set<string>} */
  const touched = new Set();
  for (const [src, targets] of Object.entries(resolved || {})) {
    for (const [t, n] of Object.entries(targets || {})) { if (t === src) continue; links += n; touched.add(src); touched.add(t); }
  }
  return { links, unlinked: paths.filter((p) => !touched.has(p)) };
}
// The Monday that starts this week.
/** @param {string} today */
function weekStart(today) { return addDays(today, -((weekdayOf(today) + 6) % 7)); }
/** @param {number} n */
function bigNumber(n) {
  if (n >= 999950) return `${(n / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return n.toLocaleString('en-US');
}
/** @param {number} n */
function deltaText(n) { return n === 0 ? '' : `${n > 0 ? '+' : '−'}${bigNumber(Math.abs(n))}`; }

/* ---- daily quote --------------------------------------------------------- */

// Short, old and well known: every author died long ago, so the words are out of copyright.
const QUOTES = [
  ['Well begun is half done.', 'Aristotle'], ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'], ['Nothing will come of nothing.', 'William Shakespeare'],
  ['Adopt the pace of nature: her secret is patience.', 'Ralph Waldo Emerson'], ['Hope is the thing with feathers.', 'Emily Dickinson'],
  ['Energy and persistence conquer all things.', 'Benjamin Franklin'], ['Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius'],
  ['It does not matter how slowly you go as long as you do not stop.', 'Confucius'], ['Knowing is not enough; we must apply.', 'Johann Wolfgang von Goethe'],
  ['The best way out is always through.', 'Robert Frost'], ['He who has a why to live can bear almost any how.', 'Friedrich Nietzsche'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'], ['Things do not change; we change.', 'Henry David Thoreau'],
  ['What stands in the way becomes the way.', 'Marcus Aurelius'], ['Be not afraid of going slowly; be afraid only of standing still.', 'Chinese proverb'],
  ['Well done is better than well said.', 'Benjamin Franklin'], ['Great things are done by a series of small things brought together.', 'Vincent van Gogh'],
  ['Wherever you go, go with all your heart.', 'Confucius'], ['Simplicity, simplicity, simplicity!', 'Henry David Thoreau'],
  ['Begin at once to live.', 'Seneca'], ['A journey of a thousand miles begins with a single step.', 'Lao Tzu'],
  ['Quality is not an act, it is a habit.', 'Aristotle'], ['The years teach much which the days never know.', 'Ralph Waldo Emerson'],
  ['Nothing is so strong as gentleness, nothing so gentle as real strength.', 'Francis de Sales'], ['Patience is bitter, but its fruit is sweet.', 'Jean-Jacques Rousseau'],
  ['To be prepared is half the victory.', 'Miguel de Cervantes'], ['Lost time is never found again.', 'Benjamin Franklin'],
  ['Act as if what you do makes a difference. It does.', 'William James'], ['Rather than love, than money, than fame, give me truth.', 'Henry David Thoreau'],
  ['Well-arranged time is the surest mark of a well-arranged mind.', 'Isaac Pitman'], ['Whatever you are, be a good one.', 'Abraham Lincoln'],
].map(([text, author]) => ({ text, author }));

// A quote list note: each list line is one quote, "text — author" or "text - author" or just "text".
/** @param {string} text */
function parseQuotes(text) {
  return String(text || '').split('\n').map((l) => /^\s*[-*+]\s+(?!\[[ xX]\])(.+)$/.exec(l)).filter((m) => !!m).map((m) => {
    const line = /** @type {RegExpExecArray} */ (m)[1].trim();
    const at = /^(.+)\s[—–-]\s+(\S.*)$/.exec(line); // greedy: the last separator splits off the author
    return at ? { text: at[1].trim().replace(/^["“]|["”]$/g, ''), author: at[2].trim() } : { text: line.replace(/^["“]|["”]$/g, ''), author: '' };
  }).filter((q) => q.text);
}
// The same quote all day; `shift` steps through the list (↻).
/** @template T @param {T[]} list @param {string} today @param {number} shift @returns {T | null} */
function quoteFor(list, today, shift) {
  if (!list.length) return null;
  const n = daysBetween('2000-01-01', today) + shift;
  return list[((n % list.length) + list.length) % list.length];
}

/* ---- countdowns ---------------------------------------------------------- */

// The next day a countdown lands on, today or later; null when a one-off has passed. A yearly 29 February
// falls on 28 February in other years.
/** @param {{ date: string, yearly: boolean }} c @param {string} today */
function nextDate(c, today) {
  if (!c.yearly) return c.date >= today ? c.date : null;
  const { m, d } = partsOf(c.date);
  const on = (/** @type {number} */ y) => { const s = `${y}-${pad2(m)}-${pad2(d)}`; return toDayStr(s) && partsOf(addDays(s, 0)).m === m ? s : `${y}-${pad2(m)}-28`; };
  const y = partsOf(today).y;
  return on(y) >= today ? on(y) : on(y + 1);
}
// countdowns + birthdays ({ name, date, known }) -> rows soonest first: { name, date, days, yearly, turns, own }.
/** @param {Countdown[]} list @param {{ name: string, date: string, known: boolean }[]} birthdays @param {string} today */
function countdownRows(list, birthdays, today) {
  const rows = [];
  list.forEach((c, i) => { const date = nextDate(c, today); if (date) rows.push({ name: c.name, date, days: daysBetween(today, date), yearly: c.yearly, turns: 0, own: i }); });
  for (const b of birthdays) {
    const date = /** @type {string} */ (nextDate({ date: b.date, yearly: true }, today));
    rows.push({ name: `${b.name}'s birthday`, date, days: daysBetween(today, date), yearly: true, turns: b.known ? partsOf(date).y - partsOf(b.date).y : 0, own: -1 });
  }
  return rows.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));
}
// A `birthday` property: 'YYYY-MM-DD' (year known), or '--MM-DD' / 'MM-DD' (no year). -> { date, known } or null.
/** @param {unknown} v */
function birthdayOf(v) {
  const s = v instanceof Date ? dayOf(v) : String(v == null ? '' : v).trim();
  // A real day only: 30 February rolls over to March, so it is not one.
  const real = (/** @type {string | null} */ d) => !!d && addDays(d, 0) === d;
  const full = toDayStr(s);
  if (full && /^\d{4}-/.test(s) && Number(full.slice(0, 4)) > 1800) return real(full) ? { date: full, known: true } : null;
  const md = /^(?:--)?(\d{2})-(\d{2})$/.exec(s);
  const d = md ? `2000-${md[1]}-${md[2]}` : null;
  return real(d) ? { date: /** @type {string} */ (d), known: false } : null;
}
/** @param {number} days */
function daysWord(days) { return days === 0 ? 'Today' : (days === 1 ? 'Tomorrow' : `${days} days`); }

/* ---- on this day, random note -------------------------------------------- */

// Notes from this month and day in earlier years, newest first: [{ path, date, ... }].
/** @template {{ date: string }} T @param {T[]} list @param {string} today @returns {T[]} */
function onThisDay(list, today) {
  const md = today.slice(5);
  return list.filter((x) => x.date.slice(5) === md && x.date < today).sort((a, b) => b.date.localeCompare(a.date));
}
/** @param {string} date @param {string} today */
function yearsAgo(date, today) { const n = partsOf(today).y - partsOf(date).y; return `${partsOf(date).y} · ${n} year${n === 1 ? '' : 's'} ago`; }
/** @param {string} path @param {string[]} exclude */
function excluded(path, exclude) { return exclude.some((f) => path === f || path.startsWith(`${f}/`)); }
// A random pick that is not `last` when there is a choice. rnd: Math.random (a stand-in in tests).
/** @template T @param {T[]} list @param {T | null} last @param {() => number} rnd @returns {T | null} */
function pickOne(list, last, rnd) {
  const from = list.length > 1 && last != null ? list.filter((x) => x !== last) : list;
  return from.length ? from[Math.floor(rnd() * from.length) % from.length] : null;
}

export {
  normalizeMore, normalizeCountdown, CAL_SOURCES, MAX_COUNTDOWNS, monthGrid, nextMonth, prevMonth, calendarSlots, fromDateline, askDateline,
  FOCUS_CHOICES, FOCUS_GOAL, focusLeft, mmss, focusDone, countWords, linkStats, weekStart, bigNumber, deltaText,
  QUOTES, parseQuotes, quoteFor, nextDate, countdownRows, birthdayOf, daysWord, onThisDay, yearsAgo, excluded, pickOne,
};
