// Task reading: one copy for every part of LifeWorld (phase 1 section 7; before, a verbatim copy
// each in Today, Planner and Projects; planInsert in Today and Planner). The task folders, links,
// titles, clock times, the task item read from frontmatter, done/on-a-day, Someday, moves and
// dependencies. Pure functions: a move changes the frontmatter object it is given; the plugins
// do the writing.
'use strict';

import { toDayStr, parseRRule, occursOn, halfOfTime } from './dates';
import { asList } from './lists';
import { reminderOf } from './reminders';
import { vaultFolders, readable } from './vault';

const DEFAULT_COMPLETED_STATUSES = ['done', 'closed'];

function wikilinkTarget(link) {
  if (link == null) return null;
  let s = String(link).trim();
  if (s.startsWith('[[') && s.endsWith(']]')) s = s.slice(2, -2);
  return s.split('|', 1)[0].trim() || null;
}

function wikilinkLabel(link) {
  if (link == null) return null;
  let s = String(link).trim();
  if (s.startsWith('[[') && s.endsWith(']]')) s = s.slice(2, -2);
  const i = s.indexOf('|');
  if (i >= 0 && s.slice(i + 1).trim()) return s.slice(i + 1).trim();
  const t = wikilinkTarget(link);
  return t ? t.split('#')[0].split('/').pop().replace(/\.md$/i, '').trim() || null : null;
}

// The name a task shows: its stored `title` when it has one, else the file
// name. TaskNotes keeps a `title` when the file name had to differ (a URL, a
// ":" or "**" taken out, or a "-2" added for a clash). Read the way
// TaskNotes 4.12.5 reads it (mapFromFrontmatter): a list is joined with ", ",
// a number or yes/no is written out, a blank or anything else falls back.
// Runs of spaces and line breaks become one space. Shown as text only.
function taskTitleOf(fm, basename, key) {
  const v = fm && typeof fm === 'object' ? fm[key || 'title'] : undefined;
  let s = '';
  if (typeof v === 'string') s = v;
  else if (Array.isArray(v)) s = v.filter((x) => x != null && typeof x !== 'object').map(String).join(', ');
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
  s = s.replace(/\s+/g, ' ').trim();
  return s || String(basename == null ? '' : basename);
}

// Clock times (task times v3, approved 2026-10-05). A clock time lives only
// on `due` and `scheduled` (Starts), written the way TaskNotes writes it:
// 'YYYY-MM-DDTHH:MM', wall-clock time with no zone. A date with no time stays
// a date. Before 1 PM is Morning, 1 PM or later Afternoon: the same split as
// Today's lanes ("Before one") and the Planner's 13:00 line.
function timeOf(v) {
  if (v == null || v instanceof Date) return null;
  const m = /^\s*\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(String(v));
  return m && Number(m[1]) <= 23 && Number(m[2]) <= 59 ? `${m[1]}:${m[2]}` : null;
}

// A repeating task's time when `scheduled` has none: its DTSTART's clock
// (TaskNotes writes the local clock there, e.g. DTSTART:20261012T090000Z).
// Midnight counts as none, as in TaskNotes' own "timed" check.
function ruleTimeOf(raw) {
  const m = /DTSTART(?:;[^:\n]*)?[:=]\d{8}T(\d{2})(\d{2})/i.exec(String(raw || ''));
  if (!m || (m[1] === '00' && m[2] === '00') || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1]}:${m[2]}`;
}

// A stored date put on `day`; whatever follows the day (a time) is kept as written.
function onDay(v, day) {
  const s = v == null || v instanceof Date ? '' : String(v);
  const m = /^(\s*)\d{4}-\d{2}-\d{2}/.exec(s);
  return m ? m[1] + day + s.slice(m[0].length) : day;
}

// The date a move writes: the time goes along while the task stays in its half
// of the day; moved into the other half (or Any time), the time comes off.
function movedDate(v, day, half) {
  const t = timeOf(v);
  return t && halfOfTime(t) === (half || null) ? onDay(v, day) : day;
}

// Timed tasks sort first, in clock order, so a drop position counts only the
// untimed tasks of the lane: -> { list: the untimed others, idx: in that list }.
function untimedSlot(others, idx) {
  const i = Math.max(0, Math.min(idx == null ? others.length : idx, others.length));
  return { list: others.filter((x) => !x.time), idx: i - others.slice(0, i).filter((x) => x.time).length };
}

function taskFromFrontmatter(fm, path, basename) {
  if (!fm || typeof fm !== 'object') return null;
  const tags = asList(fm.tags).map(String);
  if (!tags.includes('task')) return null;
  if (fm.archived === true || tags.includes('archived')) return null;
  if (path.startsWith(vaultFolders.archive + '/')) return null;
  const due = toDayStr(fm.due);
  const recurrenceRaw = typeof fm.recurrence === 'string' && fm.recurrence.trim() ? fm.recurrence.trim() : null;
  const projectLink = asList(fm.projects)[0];
  const order = Number(fm.planned_order);
  // The clock time shown and sorted by: the due time; a repeating task's start time.
  const time = recurrenceRaw ? (timeOf(fm.scheduled) || ruleTimeOf(recurrenceRaw)) : timeOf(fm.due);
  return {
    path,
    title: taskTitleOf(fm, basename),
    status: fm.status == null || fm.status === '' ? 'open' : String(fm.status),
    priority: fm.priority == null ? '' : String(fm.priority),
    due,
    // Same rule as the A4 Daily Planner: due always wins; planned_day only
    // places an undated task. A repeating task is placed by its rule instead.
    plannedDay: due || toDayStr(fm.planned_day),
    // A clock time picks the half of the day (before 1 PM is Morning).
    plannedHalf: time ? halfOfTime(time) : (fm.planned_half === 'pm' ? 'pm' : (fm.planned_half === 'am' ? 'am' : null)),
    plannedOrder: Number.isFinite(order) ? order : 0,
    time,
    // Minutes before the time it rings (0 = at the time), or null; only a timed task rings.
    reminder: time ? reminderOf(fm) : null,
    project: projectLink ? wikilinkLabel(projectLink) : null,
    recurrenceRaw,
    recurrence: recurrenceRaw ? parseRRule(recurrenceRaw, fm.scheduled || fm.due || fm.dateCreated) : null,
    completeInstances: asList(fm.complete_instances).map(toDayStr).filter(Boolean),
    skippedInstances: asList(fm.skipped_instances).map(toDayStr).filter(Boolean),
    blockedBy: blockerLinks(fm),
  };
}

function isTaskDone(item, day, completedStatuses) {
  if (item.recurrenceRaw) return item.completeInstances.includes(day);
  return (completedStatuses || DEFAULT_COMPLETED_STATUSES).includes(item.status);
}

function taskOnDay(item, day) {
  if (isSomeday(item)) return false; // kept for later: on no day, repeating or not
  if (item.recurrenceRaw) return occursOn(item.recurrence, day) && !item.skippedInstances.includes(day);
  return item.plannedDay === day;
}

// Someday (mockup approved 2026-10-06; GL-002 task status `someday`):
// a task kept for later with no day. Not finished, but never on a day, never
// due or overdue, never rung. Takes a task item or its frontmatter.
function isSomeday(x) { return !!x && typeof x === 'object' && String(x.status) === 'someday'; }

// Setting Someday. A one-off task's day comes off (due too: the caller asks
// first). A repeating task only changes status: its rule, start, due and done
// days stay exactly as they are, so its repeat picks up again when it comes
// back. Mutates and returns `fm`.
function applySomeday(fm) {
  fm.status = 'someday';
  if (typeof fm.recurrence === 'string' && fm.recurrence.trim()) return fm;
  delete fm.due; delete fm.planned_day; delete fm.planned_half; delete fm.planned_order;
  return fm;
}

function sortByOrder(list) {
  return [...list].sort((a, b) => (!a.time - !b.time) || String(a.time || '').localeCompare(String(b.time || '')) || a.plannedOrder - b.plannedOrder || a.path.localeCompare(b.path));
}

// Planner's orderForInsert: midpoint of the neighbours at the drop index;
// 10 in an empty lane, first - 10 at the top, last + 10 at the end.
function orderForInsert(orders, idx) {
  if (!orders.length) return 10;
  if (idx <= 0) return orders[0] - 10;
  if (idx >= orders.length) return orders[orders.length - 1] + 10;
  return (orders[idx - 1] + orders[idx]) / 2;
}

// Planner's assignItem, field for field: a dated task moves its `due`
// ("due always wins"), an undated one gets `planned_day`; both get
// `planned_half` and `planned_order`. Mutates and returns `fm`.
function applyMove(fm, day, half, order) {
  if (isSomeday(fm)) fm.status = 'open'; // given a day: a normal task again
  if (fm.due) fm.due = movedDate(fm.due, day, half);
  else fm.planned_day = day;
  fm.planned_half = half;
  fm.planned_order = order;
  return fm;
}

// Where a dropped task goes, given the lane's other orders (in shown order)
// and the drop index. Usually the Planner's midpoint. But tasks never placed
// all read order 0, and the midpoint of 0 and 0 is 0: the tie then sorts by
// file name and the task lands back where it was (the 1.2.1 snap-back). So
// when the new order is not strictly between its neighbours, the whole lane
// is renumbered 10, 20, 30... in the new shown order.
// -> { order, others: null | [new order for each other task, same positions] }
function planInsert(orders, idx) {
  const i = Math.max(0, Math.min(idx == null ? orders.length : idx, orders.length));
  const order = orderForInsert(orders, i);
  const prev = i > 0 ? orders[i - 1] : -Infinity;
  const next = i < orders.length ? orders[i] : Infinity;
  if (Number.isFinite(order) && order > prev && order < next) return { order, others: null };
  return { order: (i + 1) * 10, others: orders.map((_, k) => (k < i ? k + 1 : k + 2) * 10) };
}

// Dependencies (ruling 2026-10-04, GL-002): TaskNotes' own `blockedBy` list,
// each entry { uid: "[[Task]]", reltype: FINISHTOSTART } or a bare link.
// Returns the link targets, in order, without repeats. "Blocks" is never
// stored: it is the other tasks' blockedBy, read the other way round.
function blockerLinks(fm) {
  const out = [];
  for (const e of asList(fm && fm.blockedBy)) {
    const raw = typeof e === 'string' ? e : (e && typeof e === 'object' && typeof e.uid === 'string' ? e.uid : null);
    const t = raw ? wikilinkTarget(raw) : null;
    const link = t ? t.split('#')[0].trim() : '';
    if (link && !out.includes(link)) out.push(link);
  }
  return out;
}

// A blocker holds while its note is a task that is not finished (TaskNotes'
// rule: the status, also for a repeating task) and not archived.
function blockerHolds(fm, path, completedStatuses) {
  if (!fm || typeof fm !== 'object') return false;
  const tags = asList(fm.tags).map(String);
  if (fm.archived === true || tags.includes('archived') || String(path).startsWith(vaultFolders.archive + '/')) return false;
  const st = fm.status == null || fm.status === '' ? 'open' : String(fm.status);
  return !(completedStatuses || DEFAULT_COMPLETED_STATUSES).includes(st);
}

// The blockers of `item` that still hold: [{ path, title }]. A link that no
// longer leads to a note (the blocker was deleted) blocks nothing.
function openBlockersOf(app, item, completedStatuses) {
  const out = [];
  const mc = app && app.metadataCache;
  if (!mc || !item) return out;
  for (const link of item.blockedBy || []) {
    const f = mc.getFirstLinkpathDest(link, item.path);
    if (!f || f.path === item.path || out.some((x) => x.path === f.path)) continue;
    const c = mc.getFileCache(f);
    const fm = readable(c && c.frontmatter);
    if (blockerHolds(fm, f.path, completedStatuses)) out.push({ path: f.path, title: taskTitleOf(fm, f.basename) });
  }
  return out;
}

export { DEFAULT_COMPLETED_STATUSES, wikilinkTarget, wikilinkLabel, taskTitleOf, timeOf, ruleTimeOf, onDay, movedDate, untimedSlot, taskFromFrontmatter, isTaskDone, taskOnDay, isSomeday, applySomeday, sortByOrder, orderForInsert, applyMove, planInsert, blockerLinks, blockerHolds, openBlockersOf };
