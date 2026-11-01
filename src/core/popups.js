// Reminder pop-ups (phase 4): when a task's reminder comes due, for tasks with a reminder and a clock time.
// What has rung is kept per device: Obsidian can only pop up where it is open.
'use strict';

import { dayOf, addDays, minutesWords } from './dates';
import { DEFAULT_COMPLETED_STATUSES, isTaskDone, taskOnDay, isSomeday } from './tasks';

/** @typedef {{ key: string, day: string, due: number, at: number }} Ring */

/** @param {string} day @param {string} time 'HH:MM' */
function msOf(day, time) {
  const [y, m, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}

// The reminders of one task around today. A key holds the day, time and reminder, so moving a task rings it anew.
/** @param {TaskItem} item @param {string} today @param {string[]} [completed] @returns {Ring[]} */
function ringsOf(item, today, completed) {
  const before = item.reminder;
  if (before == null || !item.time || isSomeday(item)) return [];
  if (item.recurrenceRaw && (completed || DEFAULT_COMPLETED_STATUSES).includes(item.status)) return []; // finished for good
  /** @type {string[]} */
  let days = [];
  if (!item.recurrenceRaw) days = item.due ? [item.due] : [];
  else {
    // A reminder a day before a repeating task rings for tomorrow's; one after it, for an earlier day's.
    // A day further back too: "In 10 minutes" can run past midnight.
    const far = Math.ceil(Math.abs(before) / 1440);
    for (let k = before >= 0 ? -1 : -far - 1; k <= (before >= 0 ? far : 0); k++) days.push(addDays(today, k));
    days = days.filter((d) => taskOnDay(item, d));
  }
  const time = item.time;
  return days.filter((d) => !isTaskDone(item, d, completed)).map((day) => {
    const due = msOf(day, time);
    return { key: `${item.path}|${day}|${time}|${before}`, day, due, at: due - before * 60000 };
  });
}

// The ones to show now, oldest first: come due today and not rung yet, or back from "In 10 minutes".
// seen: key -> 0 rung, or the time it comes back.
/** @template {Ring} R @param {R[]} rings @param {number} now @param {Record<string, number>} seen @param {string} today @returns {R[]} */
function ringsDue(rings, now, seen, today) {
  return rings.filter((r) => {
    if (r.key in seen) return seen[r.key] > 0 && seen[r.key] <= now && dayOf(new Date(seen[r.key])) === today; // an old snooze is skipped
    return r.at <= now && dayOf(new Date(r.at)) === today;
  }).sort((a, b) => a.at - b.at);
}

// Old records go. shortcut: a reminder set over a month after its task would ring again; none of the choices is.
/** @param {Record<string, number>} seen @param {string} today @returns {Record<string, number>} */
function pruneSeen(seen, today) {
  const from = addDays(today, -31);
  return Object.fromEntries(Object.entries(seen).filter(([k]) => (k.split('|').slice(-3)[0] || '') >= from));
}

// How far off the task's time is: 'in 15 min', 'now', '10 min ago', 'in 4 h'.
/** @param {number} due @param {number} now */
function ringWhen(due, now) {
  const min = Math.round((due - now) / 60000);
  const n = Math.abs(min);
  if (n < 1) return 'now';
  return min > 0 ? `in ${minutesWords(n)}` : `${minutesWords(n)} ago`;
}

// A task note renamed or moved: what has rung stays rung.
/** @param {Record<string, number>} seen @param {string} oldPath @param {string} newPath @returns {Record<string, number>} */
function renameSeen(seen, oldPath, newPath) {
  return Object.fromEntries(Object.entries(seen).map(([k, v]) => [k.startsWith(`${oldPath}|`) ? newPath + k.slice(oldPath.length) : k, v]));
}

export { ringsOf, ringsDue, pruneSeen, ringWhen, renameSeen };
