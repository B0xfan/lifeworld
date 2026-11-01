// Activity heatmap (phase 4): a year of active days. Obsidian keeps only a note's created and last-edited
// dates, so older days can show gaps; while the widget is on, each day's count is kept in the settings file
// (numbers only, no note names). Each day has its own setting there, so two devices merge day by day.
'use strict';

import { dayOf, isDayStr, utcOf, addDays, MONTHS_SHORT } from './dates';
import { asList } from './lists';

const HEAT_MODES = { edited: 'Notes edited', daily: 'Daily note written', tasks: 'Tasks done' };
const KEEP_DAYS = 400;

/** @param {unknown} v @returns {keyof typeof HEAT_MODES} */
function normalizeHeatCount(v) { return v === 'daily' || v === 'tasks' ? v : 'edited'; }

/** @param {unknown} raw @returns {Record<string, number>} */
function normalizeActivity(raw) {
  /** @type {Record<string, number>} */
  const out = {};
  if (raw && typeof raw === 'object') for (const [d, n] of Object.entries(/** @type {Record<string, unknown>} */ (raw))) if (isDayStr(d) && Number.isInteger(n) && n > 0) out[d] = /** @type {number} */ (n);
  return out;
}

// The kept days without the ones older than a year and a bit.
/** @param {Record<string, number>} log @param {string} today @returns {Record<string, number>} */
function pruneActivity(log, today) {
  const from = addDays(today, -KEEP_DAYS);
  return Object.fromEntries(Object.entries(log).filter(([d]) => d >= from));
}

// Notes per day from their created and last-edited dates; a note created and edited on one day counts once.
/** @param {{ stat?: { mtime?: number, ctime?: number } | null }[]} files @returns {Record<string, number>} */
function datesPerDay(files) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const f of files) {
    const st = f.stat || {};
    const days = new Set([st.mtime, st.ctime].filter((t) => t && Number.isFinite(t)).map((t) => dayOf(new Date(/** @type {number} */ (t)))));
    for (const d of days) out[d] = (out[d] || 0) + 1;
  }
  return out;
}

// Each day's higher count of the two.
/** @param {Record<string, number>} a @param {Record<string, number>} b */
function mergeCounts(a, b) {
  const out = { ...a };
  for (const [d, n] of Object.entries(b)) out[d] = Math.max(out[d] || 0, n);
  return out;
}

// Finished tasks per day, from their frontmatter: the day a task was done, and each finished day of a repeating one.
/** @param {(Fm | null | undefined)[]} list @returns {Record<string, number>} */
function tasksDonePerDay(list) {
  /** @type {Record<string, number>} */
  const out = {};
  /** @param {unknown} v */
  const add = (v) => { const d = String(v == null ? '' : v).slice(0, 10); if (isDayStr(d)) out[d] = (out[d] || 0) + 1; };
  for (const fm of list) {
    if (!fm) continue;
    add(fm.completedDate);
    asList(fm.complete_instances).forEach(add);
  }
  return out;
}

/** @param {number} n */
function heatLevel(n) { return n <= 0 ? 0 : n <= 2 ? 1 : n <= 5 ? 2 : n <= 10 ? 3 : 4; }

// The days drawn, oldest first: whole weeks from a Sunday 52 weeks back, up to today.
/** @param {string} today */
function heatDays(today) {
  const first = addDays(today, -(52 * 7 + new Date(utcOf(today)).getUTCDay()));
  /** @type {string[]} */
  const out = [];
  for (let d = first; d <= today; d = addDays(d, 1)) out.push(d);
  return out;
}

// The month names over the grid: { col, label } for the first week each month starts in.
/** @param {string[]} days */
function heatMonths(days) {
  /** @type {{ col: number, label: string }[]} */
  const out = [];
  for (let c = 1; (c + 3) * 7 < days.length; c++) { // the last weeks are too narrow for a name
    const m = days[c * 7].slice(5, 7);
    if (m !== days[(c - 1) * 7].slice(5, 7)) out.push({ col: c, label: MONTHS_SHORT[Number(m) - 1] });
  }
  return out;
}

// One day in words: 'Mar 3: 6 notes edited'.
/** @param {string} day @param {number} n @param {keyof typeof HEAT_MODES} mode */
function heatWords(day, n, mode) {
  const when = `${MONTHS_SHORT[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8))}`;
  if (mode === 'daily') return `${when}: ${n ? 'daily note written' : 'no daily note'}`;
  if (mode === 'tasks') return `${when}: ${n} ${n === 1 ? 'task' : 'tasks'} done`;
  return `${when}: ${n} ${n === 1 ? 'note' : 'notes'} edited`;
}

export { HEAT_MODES, normalizeHeatCount, normalizeActivity, pruneActivity, datesPerDay, mergeCounts, tasksDonePerDay, heatLevel, heatDays, heatMonths, heatWords };
