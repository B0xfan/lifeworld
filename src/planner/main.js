/* Planner: the week/day planning board, Lifeworld-style, for TaskNotes-format tasks.
 *
 * Built 2026-10-04 from the approved mockup
 * (the planner mockup, round 5).
 * Replaces the old daily planner.
 *
 * Reads (never a parallel data model):
 *  - TaskNotes task notes in the tasks folder (Settings › Your vault; tag `task`), with the
 *    planned_day / planned_half / planned_order / weekly_goal contract
 *    (GL-002). "Due always wins": a dated task sits on its due date.
 *    A drop (or a Schedule pick, "+ add", an event made into a task) onto a day
 *    sets Due to that day and takes planned_day off (LifeWorld 0.1.14, owner
 *    request 2026-10-19), unless Settings › Planning says "Just plan it for that
 *    day" (0.1.16): then the rule before 0.1.14 (shared applyPlacement).
 *  - TaskNotes' own settings for completed statuses and priorities.
 *  - The calendar note (path in LifeWorld's settings; read only).
 *  - Goal notes and their projects, for the Goals tab.
 *
 * Writes:
 *  - Moves: app.fileManager.processFrontMatter with the shared applyPlacement()
 *    and planInsert() (src/core/tasks.js), the SAME functions Today and Projects use. When a drop lands between two tasks with the same
 *    order (tasks never placed all read 0), the lane is renumbered 10, 20,
 *    30... so the drop sticks (1.0.2).
 *  - Unschedule: removes planned_day / planned_half / planned_order and empties
 *    Due (0.1.14: otherwise every placed task would be stuck on its day).
 *  - Ticks: Projects' task engine, with the a4-today fallback when that
 *    engine is not on. TaskNotes itself is never used (2026-10-13).
 *  - New tasks (quick add, "+ add", a calendar event dropped on the board):
 *    Projects' api.tasks.create, so ids, dates, tags and filename follow
 *    its settings; planned_* go in through customFrontmatter.
 *  - Task names (1.2.4 / Planner 1.0.3 / Projects 0.1.2, 2026-10-05): a task
 *    shows its stored `title` when it has one, else its file name
 *    (taskTitleOf, shared). Text only, never HTML.
 *  - Task times (Planner 1.0.4, 2026-10-05, mockup v3 + review): a clock time
 *    lives on `due` (or a repeating task's start), TaskNotes' format
 *    'YYYY-MM-DDTHH:MM'. It shows in front of the name, picks the lane
 *    (before 1 PM is Morning) and sorts timed tasks first. A move keeps it
 *    while the task stays in its half; into the other half (or Any time) it
 *    comes off, with Undo.
 *  - Project links (Planner 1.0.5, 2026-10-05): a task's project label
 *    opens that project's page in Projects (Cmd/Ctrl-click: a new tab);
 *    with Projects off, the project note. Shared openProjectPage.
 *  - Quick add understands dates and times (Planner 1.0.6, 2026-10-05, task
 *    times v3): "call Max friday 3pm" is Due Fri 3:00 PM. The SAME parser as
 *    Projects' quick add (the SHARED quick add block, verbatim) and the
 *    same orange "Adds:" line before Enter. A calendar event dropped into the
 *    half of the day its start time is in keeps that time on Due; dropped
 *    elsewhere it comes off (the move rule, movedDate).
 *    After a quick add the board redraws at once (an empty, focused quick add
 *    box no longer holds the redraw back) and the box keeps the focus.
 *  - Reminders (Planner 1.1.0, 2026-10-05, reminder setup mockup approved):
 *    a small orange bell after a task's time when it will ring, with
 *    "15m" when it rings earlier (shared reminderOf, TaskNotes' `reminders`).
 *    Apple Reminders does the ringing (a separate sync); the
 *    plugin fires no notification of its own.
 *  - Someday (Planner 1.2.0, 2026-10-06, Someday mockup approved;
 *    GL-002 task status `someday`): a "Someday" line in the Schedule box
 *    (a task with a due date asks first, since the due date comes off too),
 *    and one folded "Someday" group at the bottom of the Unscheduled list.
 *    Someday tasks never sit on a day, in Overdue or in Weekly goals. A drag
 *    onto a day or the Schedule box makes one a normal open task again
 *    (shared applyMove); dragged onto the list it becomes open with no day.
 *  - Projects by typing (Planner 1.4.0, 2026-10-07, mockup approved):
 *    in the side panel's New task box, "+" and the start of a project name
 *    opens a short list of matching projects (the dropdown's own list:
 *    projectNames). Arrows move, Enter/Tab/click picks, Esc closes. A pick
 *    takes the "+text" out of the name and sets the dropdown; Enter with the
 *    list closed saves as before. A "+word" that fits no project stays in the
 *    name, with a quiet note. Not shared: the other quick add boxes are as they were.
 *  - Group by: Project / Area (LifeWorld 0.1.5, areas mockup screen 5): a switch over the
 *    Unscheduled list, remembered, Project by default (as before). Area: one group per area,
 *    A to Z, with its loose tasks and its projects' tasks, then "No area". Which project is in
 *    which area comes from Projects (areaIndex); without Projects the switch is not shown.
 *  - Calendar events are never written: Apple Calendar is read-only here.
 *  - Month (LifeWorld 0.1.15, calendar mockup option 1, approved 2026-10-19): a third
 *    view, Day | Week | Month. Monday-first grid, events then tasks per day,
 *    "+N more" opens that Day. A drop on a day is the same move as Week (due
 *    set, half kept). Phone width: dots per day, a tap lists the day below.
 *  - Its own data.json: folded groups, day/week/month choice, events already made
 *    into tasks.
 */
'use strict';

import { Plugin, ItemView, TFile, TFolder, Notice, setIcon, Menu, Keymap } from 'obsidian';

/* ========================================================================== *
 * Constants
 * ========================================================================== */

const VIEW_TYPE = 'a4-planner';
const DEFAULT_PRIORITIES = [
  { value: 'none', label: 'None', weight: 0 },
  { value: 'low', label: 'Low', weight: 1 },
  { value: 'normal', label: 'Normal', weight: 2 },
  { value: 'high', label: 'High', weight: 3 },
];
const NARROW_WIDTH = 760;
const MID_WIDTH = 1180;
const NO_PROJECT = '';
const MADE_KEEP_DAYS = 60;

/* ========================================================================== *
 * SHARED with a4-today (verbatim copies; do not edit here without editing
 * a4-today the same way; the test compares them character for character)
 * ========================================================================== */

// The shared core (src/core/): one copy of the dates, list, reminder, quick add and task helpers.
import { pad2, dayOf, isDayStr, toDayStr, utcOf, addDays, daysBetween, weekdayOf, partsOf, parseRRule, occursOn, halfOfTime, timeText } from '../core/dates';
import { asList } from '../core/lists';
import { REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords } from '../core/reminders';
import { understand, parseClock, quickAddChips, quickAddPlan } from '../core/quickadd';
import { DEFAULT_COMPLETED_STATUSES, wikilinkTarget, taskTitleOf, timeOf, ruleTimeOf, onDay, movedDate, untimedSlot, taskFromFrontmatter, isTaskDone, isOverdue, taskOnDay, isSomeday, applySomeday, sortByOrder, orderForInsert, applyMove, applyPlacement, applyUnschedule, planInsert, openBlockersOf } from '../core/tasks';
import { errField } from '../core/sources';
import { partOf } from '../core/parts'; // the other parts, through LifeWorld (phase 2)
import { calendarEvents } from '../core/calendars'; // calendar links (launch section 6)
import { vaultFolders, feedNotes, planning, inTaskFolders, readable, writable } from '../core/vault'; // Settings › Your vault (phase 2 section 4)

// One frontmatter write that remembers what the keys it changed held before;
// the returned undo() puts exactly those back (a key that was absent is
// removed again), through the frontmatter API too.
/** @param {import('obsidian').App} app @param {TFile} file @param {(fm: Fm) => unknown} fn */
async function writeWithUndo(app, file, fn) {
  /** @type {Record<string, { v: unknown } | null>} */
  let before = {};
  await app.fileManager.processFrontMatter(file, (fm) => {
    const parsed = /** @type {unknown} */ (JSON.parse(JSON.stringify(fm || {})));
    const copy = /** @type {Fm} */ (parsed);
    writable(fm, fn);
    before = {};
    for (const k of new Set([...Object.keys(copy), ...Object.keys(fm)])) {
      if (JSON.stringify(copy[k]) !== JSON.stringify(fm[k])) before[k] = Object.prototype.hasOwnProperty.call(copy, k) ? { v: copy[k] } : null;
    }
  });
  return async () => {
    const f = app.vault.getAbstractFileByPath(file.path);
    if (!f) return;
    await app.fileManager.processFrontMatter(f, (fm) => { for (const [k, b] of Object.entries(before)) { if (b) fm[k] = b.v; else delete fm[k]; } });
  };
}

// An Obsidian notice with an Undo button (a move that took a clock time off).
/** @param {string} text @param {() => Promise<unknown>} undo */
function undoNotice(text, undo) {
  const frag = document.createDocumentFragment();
  const box = frag.createDiv({ cls: 'a4-undo-notice' });
  box.createSpan({ text });
  const b = box.createEl('button', { text: 'Undo', cls: 'mod-cta a4-undo-btn' });
  const n = new Notice(frag, 8000);
  b.addEventListener('click', async (e) => {
    e.stopPropagation();
    n.hide();
    try { await undo(); } catch (err) { console.error('undo failed', err); new Notice('Could not undo that.'); }
  });
  return n;
}

// The "Blocked" marker (lock chip). Hover names the blockers; a click or tap
// lists them in a menu that opens each one. Not shared code: it renders.
/** @param {HTMLElement} meta @param {{ path: string, title: string }[]} blockers @param {(path: string) => void} open @param {string} pre */
function blockedChip(meta, blockers, open, pre) {
  const c = meta.createSpan({ cls: `${pre}-chip ${pre}-lock` });
  setIcon(c.createSpan({ cls: `${pre}-ic` }), 'lock');
  c.appendText(blockers.length > 1 ? `blocked · ${blockers.length}` : 'blocked');
  const names = `Blocked by: ${blockers.map((b) => b.title).join(', ')}`;
  c.setAttr('aria-label', names); c.setAttr('title', names); c.setAttr('role', 'button'); c.tabIndex = 0;
  /** @param {Event} e */
  const show = (e) => {
    e.preventDefault(); e.stopPropagation();
    const m = new Menu();
    for (const b of blockers) m.addItem((i) => i.setTitle(b.title).setIcon('lock').onClick(() => open(b.path)));
    if (e instanceof MouseEvent && e.clientX) m.showAtMouseEvent(e); else { const r = c.getBoundingClientRect(); m.showAtPosition({ x: r.left, y: r.bottom }); }
  };
  c.addEventListener('pointerdown', (e) => e.stopPropagation());
  c.addEventListener('click', show);
  c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') show(e); });
  return c;
}

// A project chip or label (2026-10-05): its page in Projects, in a new
// tab on Cmd/Ctrl-click; the note itself (a new tab, as before) when Projects
// is off or has no page for it. `ref`: a project note's path, or a task's
// project link or name. Resolves 'page', 'note', or false.
/** @param {import('obsidian').App} app @param {unknown} ref @param {MouseEvent | KeyboardEvent | null | undefined} e @param {string} [sourcePath] */
async function openProjectPage(app, ref, e, sourcePath) {
  if (ref == null || ref === '') return false;
  const newTab = !!(e && Keymap && Keymap.isModEvent(e));
  const pj = partOf(app, 'a4-projects');
  if (pj && typeof pj.openProjectPage === 'function') {
    try { if (await pj.openProjectPage(ref, { newTab })) return 'page'; } catch (err) { console.error('LifeWorld: opening the project page failed', err); }
  }
  const s = String(ref);
  let f = app.vault.getAbstractFileByPath(s);
  if (!(f instanceof TFile)) f = app.metadataCache.getFirstLinkpathDest((wikilinkTarget(s) || s).split('#')[0], sourcePath || '');
  if (!(f instanceof TFile)) return false;
  await app.workspace.getLeaf('tab').openFile(f);
  return 'note';
}

/* ---- "+project" typing in the New task box (Planner 1.4.0) ---------------- *
 * Planner only (not shared): plain matching against the same project list as
 * the dropdown (projectNames). understand() never sees a picked "+text": it
 * comes out of the box on the pick. An unpicked "+text" stays in the name. */
const PROJECT_HITS_MAX = 8;
/** @param {string} ch */
const isWordChar = (ch) => /[\p{L}\p{N}'’]/u.test(ch);
// Projects a typed "+text" can mean, best first: names that start with it,
// then names with a later word that starts with it (each group in the list's
// own A to Z order). -> [{ name, at, len }] (at/len: the matched part)
/** @param {unknown} query @param {string[] | null | undefined} names */
function projectMatches(query, names) {
  const q = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!q) return [];
  /** @type {{ name: string, at: number, len: number }[]} */
  const first = [];
  /** @type {{ name: string, at: number, len: number }[]} */
  const later = [];
  for (const name of names || []) {
    const lo = String(name).toLowerCase();
    if (lo.startsWith(q)) { first.push({ name, at: 0, len: q.length }); continue; }
    for (let i = 1; i < lo.length; i++) {
      if (isWordChar(lo[i]) && !isWordChar(lo[i - 1]) && lo.startsWith(q, i)) { later.push({ name, at: i, len: q.length }); break; }
    }
  }
  return first.concat(later);
}
// The "+text" being typed at the caret -> { start, end, query } or null.
// "+" starts the box or follows a space; the query runs from it to the caret
// and may hold a space only while it still fits a project ("+garden plan").
// `end` takes in the rest of the word after the caret, so a pick removes it all.
/** @param {unknown} text @param {number | null | undefined} caret @param {string[]} names */
function projectToken(text, caret, names) {
  const s = String(text || ''); const c = caret == null ? s.length : Math.min(caret, s.length);
  for (let i = c - 1; i >= 0; i--) {
    if (s[i] !== '+' || (i > 0 && !/\s/.test(s[i - 1]))) continue;
    const query = s.slice(i + 1, c);
    if (!query || /^\s/.test(query) || query.includes('+')) return null;
    if (/\s/.test(query) && !projectMatches(query, names).length) return null;
    return { start: i, end: c + /** @type {RegExpExecArray} */ (/^\S*/.exec(s.slice(c)))[0].length, query };
  }
  return null;
}
// A pick takes the "+text" out of the box -> { text, caret }.
/** @param {unknown} text @param {{ start: number, end: number }} tok */
function pickProjectText(text, tok) {
  const s = String(text || '');
  const before = s.slice(0, tok.start); let after = s.slice(tok.end);
  if ((!before || /\s$/.test(before)) && /^\s/.test(after)) after = after.replace(/^\s+/, '');
  return { text: before + after, caret: before.length };
}
// "+word"s that fit no project: they stay in the name, and the box says so.
/** @param {unknown} text @param {string[]} names */
function unmatchedProjectWords(text, names) {
  /** @type {string[]} */
  const out = []; const re = /(^|\s)\+([^\s+]+)/g; let m;
  while ((m = re.exec(String(text || '')))) if (!projectMatches(m[2], names).length) out.push(`+${m[2]}`);
  return out;
}

/* ========================================================================== *
 * Planner pure logic (unit-tested in tests/test-planner.js)
 * ========================================================================== */

/** @param {string} day */
function mondayOf(day) { return addDays(day, -((weekdayOf(day) + 6) % 7)); }
/** @param {string} day */
function weekOf(day) { const m = mondayOf(day); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(m, i)); }

// Project grouping key = the project note's basename, so [[Name]] and
// [[full/path/Name]] land in one group (checked 2026-09-07).
/** @param {unknown} link */
function projectKeyOf(link) {
  const t = wikilinkTarget(link);
  return t ? (/** @type {string} */ (t.split('#')[0].split('/').pop()).replace(/\.md$/i, '').trim() || null) : null;
}

/** @param {Fm | null | undefined} fm @param {string} path @param {string} basename @returns {PlanItem | null} */
function plannerItem(fm, path, basename) {
  const it = /** @type {PlanItem | null} */ (taskFromFrontmatter(fm, path, basename));
  if (!it || !fm) return null;
  it.projectKey = projectKeyOf(asList(fm.projects)[0]);
  it.projectLink = /** @type {string | null} */ (asList(fm.projects)[0] || null);
  it.weeklyGoal = fm.weekly_goal === true;
  return it;
}

// TaskNotes priorities -> { value, label, weight, bars (0-3), top }.
/** @param {unknown} custom @returns {PlanPriority[]} */
function priorityTable(custom) {
  /** @type {(PriorityDef & Partial<PlanPriority>)[]} */
  const list = Array.isArray(custom) && custom.length
    ? /** @type {Fm[]} */ (custom).filter((p) => p && p.value != null).map((p) => ({ value: String(p.value), label: String(p.label || p.value), weight: Number(p.weight) || 0 }))
    : DEFAULT_PRIORITIES.map((p) => ({ ...p }));
  const sorted = [...list].sort((a, b) => a.weight - b.weight);
  const n = sorted.length;
  sorted.forEach((p, i) => { p.bars = n > 1 ? Math.round((3 * i) / (n - 1)) : 3; p.top = i === n - 1; p.rank = i; });
  return /** @type {PlanPriority[]} */ (sorted);
}
/** @param {unknown} value @param {PlanPriority[]} table @returns {PlanPriority} */
function priorityOf(value, table) {
  const v = value == null ? '' : String(value);
  const hit = table.find((p) => p.value === v);
  if (hit) return hit;
  if (v === '') return table.find((p) => p.value === 'none') || { value: '', label: 'None', weight: -1, bars: 0, top: false, rank: -1 };
  return { value: v, label: v, weight: -1, bars: 0, top: false, rank: -1 }; // a value TaskNotes doesn't list: shown as written
}

/** @param {PlanItem} it @param {string[]} completed */
function isUnscheduled(it, completed) { return !it.recurrenceRaw && !it.plannedDay && !isSomeday(it) && !isTaskDone(it, null, completed); }
/** @param {PlanItem[]} items @param {string[]} completed */
function unscheduledOf(items, completed) { return items.filter((it) => isUnscheduled(it, completed)); }
// Overdue: a one-off task that is not done and sits on a past day (its due
// date, or the day it was planned for). Oldest first.
/** @param {PlanItem[]} items @param {string} today @param {string[]} completed */
function overdueOf(items, today, completed) {
  return items.filter((it) => isOverdue(it, today, completed))
    .sort((a, b) => /** @type {string} */ (a.due || a.plannedDay).localeCompare(/** @type {string} */ (b.due || b.plannedDay)) || a.title.localeCompare(b.title));
}
/** @param {PlanItem[]} items @param {string} today @param {string[]} completed */
function weeklyGoalsOf(items, today, completed) {
  return items.filter((it) => it.weeklyGoal && !isSomeday(it) && !isTaskDone(it, today, completed)).sort((a, b) => a.title.localeCompare(b.title));
}
// Someday (mockup approved 2026-10-06): the tasks kept for later, for
// the one folded group at the bottom of the list. Repeating ones too (they
// show here, off their days, until they are set back to open). Same order as
// a project group: blocked last, highest priority first, then A to Z.
/** @param {PlanItem[]} items @param {string[]} completed @param {PlanPriority[]} table */
function somedayOf(items, completed, table) {
  return items.filter((it) => isSomeday(it) && !(!it.recurrenceRaw && isTaskDone(it, null, completed)))
    .sort((a, b) => (!!(a.blockers && a.blockers.length) - !!(b.blockers && b.blockers.length)) || priorityOf(b.priority, table).weight - priorityOf(a.priority, table).weight || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
}
/** @param {PlanItem[]} items @param {string} day @param {string | null} [half] */
function laneOf(items, day, half) {
  return sortByOrder(items.filter((it) => taskOnDay(it, day) && (it.plannedHalf || null) === (half || null)));
}

// Drop position -> index in the FULL lane (the dragged task left out). A drop
// names its neighbours on screen: `before` = the task the red line sits above,
// `after` = the last task shown above it. With a project filter on, tasks of
// other projects sit in the same lane unseen, so a screen index is not a lane
// index. No neighbours given (Schedule button, empty lane) = the end.
/** @param {{ path: string }[]} others @param {{ before?: string | null, after?: string | null } | null | undefined} at */
function insertIndexOf(others, at) {
  const paths = others.map((x) => x.path);
  if (at && at.before) { const i = paths.indexOf(at.before); if (i >= 0) return i; }
  if (at && at.after) { const i = paths.indexOf(at.after); if (i >= 0) return i + 1; }
  return paths.length;
}

// Unscheduled list -> [{ key, label, items }]: projects A to Z (case-insensitive),
// "No project" last; inside a group, highest priority first, then A to Z.
/** @param {PlanPriority[]} table @returns {(a: PlanItem, b: PlanItem) => number} */
const groupOrder = (table) => (a, b) => (!!(a.blockers && a.blockers.length) - !!(b.blockers && b.blockers.length)) || priorityOf(b.priority, table).weight - priorityOf(a.priority, table).weight || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path);
/** @param {PlanItem[]} list @param {PlanPriority[]} table */
function groupUnscheduled(list, table) {
  /** @type {Map<string, PlanItem[]>} */
  const by = new Map();
  /** @type {Map<string, string>} */
  const labels = new Map();
  for (const it of list) {
    const k = it.projectKey || NO_PROJECT;
    if (!by.has(k)) by.set(k, []);
    /** @type {PlanItem[]} */ (by.get(k)).push(it);
    if (k && !labels.has(k) && it.project && it.project !== k) labels.set(k, it.project);
  }
  const keys = [...by.keys()].filter((k) => k !== NO_PROJECT).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }) || a.localeCompare(b));
  if (by.has(NO_PROJECT)) keys.push(NO_PROJECT);
  return keys.map((k) => ({
    key: k,
    label: k === NO_PROJECT ? 'No project' : (labels.get(k) || k),
    items: /** @type {PlanItem[]} */ (by.get(k)).sort(groupOrder(table)),
  }));
}
// Group by: Area (areas mockup screen 5). ix = Projects' areaIndex(): { areas: [{ key, name }],
// of: { projectKey or areaKey: areaKey } }. One group per area A to Z, holding its loose tasks
// and its projects' tasks, then "No area" last; same order inside a group as above. `area` is the
// group's area key (null for No area); fold keys never meet project names.
/** @param {PlanItem[]} list @param {PlanPriority[]} table @param {{ areas: { key: string, name: string }[], of: Record<string, string> }} ix */
function groupByArea(list, table, ix) {
  const names = new Map(ix.areas.map((a) => [a.key, a.name]));
  /** @type {Map<string, PlanItem[]>} */
  const by = new Map();
  for (const it of list) {
    const k = (it.projectKey && ix.of[it.projectKey]) || NO_PROJECT;
    if (!by.has(k)) by.set(k, []);
    /** @type {PlanItem[]} */ (by.get(k)).push(it);
  }
  const keys = [...by.keys()].filter((k) => k !== NO_PROJECT).sort((a, b) => String(names.get(a) || a).localeCompare(String(names.get(b) || b), undefined, { sensitivity: 'base' }));
  if (by.has(NO_PROJECT)) keys.push(NO_PROJECT);
  return keys.map((k) => ({ key: k ? `§area:${k}` : '§area-none', area: k || null, label: k ? (names.get(k) || k) : 'No area', items: /** @type {PlanItem[]} */ (by.get(k)).sort(groupOrder(table)) }));
}

// The one fold/open button over the Unscheduled list, like the file explorer's:
// true when every project group is folded and Someday (if there is one) is shut,
// so the next click opens all. No groups and no open Someday = false (click folds).
/** @param {{ key: string }[]} groups @param {Record<string, unknown> | null | undefined} collapsed @param {unknown} somedayOpen @param {boolean} hasSomeday */
function allUnscheduledFolded(groups, collapsed, somedayOpen, hasSomeday) {
  const sOpen = !!hasSomeday && somedayOpen === true;
  if (!groups.length) return false;
  return !sOpen && groups.every((g) => !!(collapsed || {})[g.key || '§none']);
}

// Calendar Events.md rows for one day, all-day first, then by start time.
/** @param {unknown} events @param {string} day @returns {PlanEvent[]} */
function eventsForDay(events, day) {
  return /** @type {Fm[]} */ (asList(events)).filter((e) => e && toDayStr(e.date) === day)
    .map((e) => ({ date: toDayStr(e.date), time: e.time ? String(e.time) : null, end: e.end ? String(e.end) : null, allDay: e.all_day === true || !e.time, summary: String(e.summary || '(untitled)'), calendar: e.calendar ? String(e.calendar) : '' }))
    .sort((a, b) => (a.allDay === b.allDay ? 0 : a.allDay ? -1 : 1) || String(a.time || '').localeCompare(String(b.time || '')) || a.summary.localeCompare(b.summary));
}
/** @param {PlanEvent} ev */
function eventKey(ev) { return `${ev.date}|${ev.time || ''}|${ev.summary}`; }
/** @param {PlanEvent} ev */
function eventWhen(ev) { return ev.allDay ? 'All day' : `${ev.time}${ev.end ? '–' + ev.end : ''}`; }
/** @param {string} day @param {Intl.DateTimeFormatOptions} opts */
function fmtDay(day, opts) { return new Date(utcOf(day)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' }); }
/** @param {PlanEvent} ev */
function eventDetails(ev) {
  return `From your calendar${ev.calendar ? ` (${ev.calendar})` : ''}: ${fmtDay(/** @type {string} */ (ev.date), { weekday: 'short', month: 'short', day: 'numeric' })}, ${eventWhen(ev)}.`;
}
// What a new task made from an event (or "+ add") writes besides TaskNotes' own fields.
/** @param {string | null | undefined} day @param {string | null | undefined} half @param {number} order @returns {Fm} */
function plannedFields(day, half, order) {
  if (!day) return {};
  /** @type {Fm} */
  const out = { planned_day: day };
  if (half) out.planned_half = half;
  out.planned_order = order;
  return out;
}
/** @param {Record<string, unknown> | null | undefined} made @param {string} today */
function pruneMade(made, today) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(made || {})) if (isDayStr(v) && daysBetween(v, today) <= MADE_KEEP_DAYS) out[k] = v;
  return out;
}
/** @param {PlanItem} item @param {string} today @param {string[]} completed */
function dueChipOf(item, today, completed) {
  if (!item.due || item.recurrenceRaw || isSomeday(item)) return null;
  const diff = daysBetween(item.due, today);
  if (diff > 0 && !isTaskDone(item, today, completed)) return { cls: 'warn', text: `${diff}D OVER` };
  if (diff === 0) return { cls: 'today', text: 'TODAY' };
  return { cls: '', text: 'due ' + fmtDay(item.due, { month: 'short', day: 'numeric' }) };
}
// Month grid (Monday first, 6 weeks) for the Schedule popover's calendar.
/** @param {string} month */
function monthGrid(month) { const first = mondayOf(`${month}-01`); return Array.from({ length: 42 }, (_, i) => addDays(first, i)); }
/** @param {string} month @param {number} n */
function shiftMonth(month, n) { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`; }
// The saved Planner view (Day | Week | Month), Week for anything else.
/** @param {unknown} m @returns {'day' | 'week' | 'month'} */
function viewModeOf(m) { return m === 'day' || m === 'month' ? m : 'week'; }
// A drop on a Month day keeps the task's half of the day (so its clock time
// stays); an event lands in the half its start time is in.
/** @param {{ ev?: PlanEvent | null, item?: PlanItem | null }} d */
function monthDropHalf(d) { return d.ev ? (d.ev.allDay ? null : halfOfTime(d.ev.time)) : (/** @type {PlanItem} */ (d.item).plannedHalf || null); }
/** @param {string} day @param {string | null} half @param {string} today */
function moveLabel(day, half, today) {
  const d = day === today ? 'today' : day === addDays(today, 1) ? 'tomorrow' : fmtDay(day, { weekday: 'long', month: 'short', day: 'numeric' });
  return `${d}, ${half === 'am' ? 'morning' : half === 'pm' ? 'afternoon' : 'any time'}`;
}

/* ========================================================================== *
 * Plugin
 * ========================================================================== */

/** @typedef {{ collapsed: Record<string, boolean>, mode: string, made: Record<string, string>, somedayOpen: boolean, groupBy: string, [key: string]: unknown }} PlannerData */
/** @type {PlannerData} */
const DEFAULT_DATA = { collapsed: {}, mode: 'week', made: {}, somedayOpen: false, groupBy: 'project' };

class PlannerPlugin extends Plugin {
  async onload() {
    const saved = /** @type {Partial<PlannerData>} */ ((await this.loadData().catch(() => null)) || {});
    /** @type {PlannerData} */
    this.data = { ...DEFAULT_DATA, ...saved, collapsed: { ...(saved.collapsed || {}) }, made: { ...(saved.made || {}) } };
    this.registerView(VIEW_TYPE, (leaf) => new PlannerView(leaf, this));
    this.addRibbonIcon('calendar-days', 'Open Planner', () => this.openPlanner());
    this.addCommand({ id: 'open', name: 'Open planner', callback: () => this.openPlanner() });
  }

  onunload() { closeOpenPopovers(); }

  async save() { await this.saveData(this.data); }

  // The Find window lives in Projects (its search, its engine): one window for Today, the Planner and the command.
  openFind() {
    const pj = partOf(this.app, 'a4-projects');
    if (pj && typeof pj.openFind === 'function') { pj.openFind(); return true; }
    new Notice('Find needs the projects and tasks part turned on.');
    return false;
  }

  async openPlanner() {
    const ws = this.app.workspace;
    const existing = ws.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { ws.revealLeaf(existing[0]); ws.setActiveLeaf(existing[0], { focus: true }); const v = /** @type {PlannerView} */ (existing[0].view); if (v.goToday) v.goToday(); return; }
    const leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    ws.revealLeaf(leaf);
  }

  projectsPlugin() { return partOf(this.app, 'a4-projects'); }

  // Projects' task engine, when it is the chosen task source (Settings › LifeWorld › Tasks).
  tasksApi() {
    const own = this.projectsPlugin();
    return own && typeof own.taskApi === 'function' ? own.taskApi() : null;
  }

  // Projects' task settings (statuses, priorities, defaults), or null.
  engineCfg() {
    const own = this.projectsPlugin();
    try { return own && own.engine ? own.engine.cfg() : null; } catch { return null; }
  }

  completedStatuses() {
    const c = this.engineCfg();
    const list = c ? c.statuses.filter((s) => s.isCompleted).map((s) => s.value) : [];
    return list.length ? list : DEFAULT_COMPLETED_STATUSES;
  }

  // The priority a task gets when none is typed (the quick add line leaves it out).
  defaultPriority() {
    const c = this.engineCfg();
    return c && c.defaultPriority ? c.defaultPriority : 'normal';
  }

  priorities() {
    const c = this.engineCfg();
    return priorityTable(c && c.priorities);
  }

  // The chosen task source when it is not task notes (checkboxes, ClickUp, Todoist, Things), or null.
  ext() { const own = this.projectsPlugin(); return own && typeof own.extSource === 'function' ? own.extSource() : null; }

  /** @returns {PlanItem[]} */
  collectItems() {
    const ext = this.ext();
    if (ext) return ext.items().map((it) => ({ ...it, weeklyGoal: false }));
    const root = this.app.vault.getAbstractFileByPath(vaultFolders.tasks);
    /** @type {PlanItem[]} */
    const out = [];
    /** @param {TFolder} folder */
    const walk = (folder) => {
      for (const c of folder.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') {
          const cache = this.app.metadataCache.getFileCache(c);
          const it = plannerItem(readable(/** @type {Fm | null} */ (cache && cache.frontmatter)), c.path, c.basename);
          if (it) out.push(it);
        }
      }
    };
    if (root instanceof TFolder) walk(root);
    return out;
  }

  // The calendar note's events (when set) and the calendar links' (launch section 6), the same shape.
  calendarEvents() {
    const f = feedNotes.calendar ? this.app.vault.getAbstractFileByPath(feedNotes.calendar) : null;
    const fm = /** @type {Fm | null | undefined} */ (f instanceof TFile ? (this.app.metadataCache.getFileCache(f) || {}).frontmatter : null);
    const linked = calendarEvents(this.app); // the module's, not this method
    return (fm ? asList(fm.events) : []).concat(linked);
  }

  // Projects' area index (Group by: Area, areas marked in the project lists), or null without Projects.
  areaIndex() {
    const own = this.projectsPlugin();
    try { return own && typeof own.areaIndex === 'function' ? own.areaIndex() : null; } catch (e) { console.error('LifeWorld: the area list failed', e); return null; }
  }

  /** @param {PlanItem[]} items */
  projectNames(items) {
    const names = new Set(items.map((i) => i.projectKey).filter(Boolean));
    const root = this.app.vault.getAbstractFileByPath(vaultFolders.projects);
    if (root instanceof TFolder) {
      for (const c of root.children || []) {
        if (!(c instanceof TFile) || c.extension !== 'md') continue;
        const fm = /** @type {Fm} */ ((this.app.metadataCache.getFileCache(c) || {}).frontmatter || {});
        if (fm.type === 'area' || !fm.status || /active|in-progress|open/i.test(String(fm.status))) names.add(c.basename); // areas take tasks too
      }
    }
    return /** @type {string[]} */ ([...names]).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  /** @param {string} path */
  fileOf(path) { const f = this.app.vault.getAbstractFileByPath(path); return f instanceof TFile ? f : null; }

  // The one move: same writes and order rule as a4-today (planInsert).
  // `at` = { before, after } neighbour paths from the drop, or null for the end.
  /** @param {PlanItem} item @param {string} day @param {string | null} half @param {{ before?: string | null, after?: string | null } | null} at @param {PlanItem[]} items @returns {Promise<{ undo: (() => Promise<void>) | null, dropsTime: boolean } | false>} */
  async moveTask(item, day, half, at, items) {
    if (item.ext) { await /** @type {NonNullable<ReturnType<PlannerPlugin['ext']>>} */ (this.ext()).place(/** @type {ExtItem} */ (item), day, half); return { undo: null, dropsTime: false }; }
    if (item.recurrenceRaw) { new Notice('Repeating tasks follow their schedule.'); return false; }
    const file = this.fileOf(item.path);
    if (!file) { new Notice('That task note is gone.'); return false; }
    const lane = laneOf(items, day, half).filter((x) => x.path !== item.path);
    // Timed tasks sit first in clock order: the drop counts only the untimed ones.
    const slot = untimedSlot(lane, insertIndexOf(lane, at));
    const others = slot.list;
    const plan = planInsert(others.map((x) => x.plannedOrder), slot.idx);
    // Into the other half of the day, the clock time comes off (applyMove); Undo puts it back.
    const dropsTime = !!(planning.setsDue && item.time && halfOfTime(item.time) !== (half || null)); // "just plan it" never touches Due
    const undo = await writeWithUndo(this.app, file, (fm) => { applyPlacement(fm, day, half, plan.order, planning.setsDue); });
    // Renumbered lane: write planned_order only, and only where it changed.
    if (plan.others) {
      for (let k = 0; k < others.length; k++) {
        if (others[k].plannedOrder === plan.others[k]) continue;
        const f = this.fileOf(others[k].path);
        const others2 = plan.others;
        if (f) await this.app.fileManager.processFrontMatter(f, (raw) => writable(raw, (fm) => { fm.planned_order = others2[k]; }));
      }
    }
    return { undo, dropsTime };
  }

  // "Moved to ..." after a move; when the move took the clock time off, with Undo.
  /** @param {PlanItem} item @param {string} day @param {string | null} half @param {{ undo: (() => Promise<void>) | null, dropsTime: boolean } | false | null} res @param {() => void} [onUndo] */
  movedNotice(item, day, half, res, onUndo) {
    const text = `Moved to ${moveLabel(day, half, dayOf(new Date()))}`;
    const u = res && res.undo;
    if (res && res.dropsTime && u) undoNotice(`${text}. The ${timeText(item.time)} time was taken off.`, async () => { await u(); if (onUndo) onUndo(); });
    else new Notice(text);
  }

  // Someday (mockup approved 2026-10-06): through Projects' engine
  // when it is on (it stamps dateModified, as a status change in TaskNotes
  // does), else the frontmatter API. -> { undo }
  /** @param {PlanItem} item */
  async somedayTask(item) {
    if (item.ext) throw new Error('Someday is for LifeWorld tasks. This one stays where it is.');
    const own = partOf(this.app, 'a4-projects');
    if (own && own.engine && typeof own.engine.someday === 'function') return own.engine.someday(item.path);
    const file = this.fileOf(item.path);
    if (!file) throw new Error('That task note is gone.');
    return { undo: await writeWithUndo(this.app, file, (fm) => { applySomeday(fm); }) };
  }

  /** @param {PlanItem} item */
  async unscheduleTask(item) {
    if (item.ext) { if (!item.plannedDay) return false; await /** @type {NonNullable<ReturnType<PlannerPlugin['ext']>>} */ (this.ext()).place(/** @type {ExtItem} */ (item), null, null); new Notice('Back to unscheduled'); return true; }
    if (isSomeday(item)) { // dragged out of Someday onto the list: an open task again, still with no day
      const file = this.fileOf(item.path);
      if (!file) return false;
      await this.app.fileManager.processFrontMatter(file, (raw) => writable(raw, (fm) => { if (isSomeday(fm)) fm.status = 'open'; }));
      new Notice('Back to unscheduled');
      return true;
    }
    if (item.recurrenceRaw || !item.plannedDay) return false; // a repeating task follows its schedule
    const file = this.fileOf(item.path);
    if (!file) return false;
    const undo = await writeWithUndo(this.app, file, (fm) => { applyUnschedule(fm, planning.setsDue); });
    // The due date comes off too (0.1.14), so a mis-drag gets an Undo; "just plan it" keeps it (0.1.18).
    if (item.due && !planning.setsDue) undoNotice('Plan taken off. It stays on its due day.', undo);
    else if (item.due) undoNotice('Back to unscheduled. The due date was taken off.', undo);
    else new Notice('Back to unscheduled');
    return true;
  }

  /** @param {PlanItem} item @param {string} day */
  async toggleTask(item, day) {
    if (item.ext) { await /** @type {NonNullable<ReturnType<PlannerPlugin['ext']>>} */ (this.ext()).toggle(/** @type {ExtItem} */ (item), day); return; }
    const file = this.fileOf(item.path);
    if (!file) throw new Error('That task note is gone.');
    const wasDone = isTaskDone(item, day, this.completedStatuses());
    const api = this.tasksApi();
    if (api) {
      if (item.recurrenceRaw) { await api.recurring.toggleCompleteInstance(item.path, day); return; }
      if (wasDone) await api.tasks.uncomplete(item.path); else await api.tasks.complete(item.path);
      return;
    }
    await this.app.fileManager.processFrontMatter(file, (raw) => writable(raw, (fm) => {
      if (item.recurrenceRaw) {
        const list = asList(fm.complete_instances).map(toDayStr).filter(Boolean);
        const i = list.indexOf(day);
        if (i >= 0) list.splice(i, 1); else list.push(day);
        fm.complete_instances = list;
      } else if (wasDone) { fm.status = 'open'; delete fm.completedDate; } else { fm.status = 'done'; fm.completedDate = dayOf(new Date()); }
      fm.dateModified = new Date().toISOString();
    }));
  }

  /** @param {PlanItem} item */
  async toggleWeeklyGoal(item) {
    if (item.ext) { new Notice('Weekly goals are for LifeWorld tasks.'); return; }
    const file = this.fileOf(item.path);
    if (!file) return;
    await this.app.fileManager.processFrontMatter(file, (fm) => { fm.weekly_goal = fm.weekly_goal !== true; });
  }

  // New task through Projects' engine (its folder, filename, id, dates and defaults).
  // `time` (a calendar event's start, 'HH:MM') goes on Due as the engine writes
  // it when the task lands in that time's half of the day (the move rule).
  /** @param {{ title: unknown, project?: string | null, day?: string | null, half?: string | null, details?: string, time?: string | null }} arg @param {PlanItem[]} items */
  async createTask({ title, project, day, half, details, time }, items) {
    const ext = this.ext();
    if (ext) return ext.create({ title: String(title).trim(), day: day || null, half, time: time && day ? time : null, project: project || null });
    const api = this.tasksApi();
    if (!api) { new Notice('Adding tasks needs the projects and tasks part turned on.'); return null; }
    const lane = day ? laneOf(items, day, half) : [];
    const order = orderForInsert(lane.map((x) => x.plannedOrder), lane.length);
    /** @type {NewTaskInput & { customFrontmatter: Fm }} */
    const data = { title: String(title).trim(), customFrontmatter: plannedFields(day, half, order) };
    // A day goes on Due (Settings › Planning), with the event's time when it kept it; else planned_day.
    const timed = day && time ? movedDate(`${day}T${time}`, day, half) : null;
    const due = timeOf(timed) ? timed : (day && planning.setsDue ? day : null);
    if (due) { data.due = due; delete data.customFrontmatter.planned_day; }
    if (project) data.projects = [`[[${project}]]`];
    if (details) data.details = details;
    const t = await api.tasks.create(data);
    return t;
  }

  // Quick add: plain words through the shared parser, saved the way
  // Projects' quick add saves them (quickAddPlan; planned_order at the end of
  // the lane's untimed tasks, as Projects' laneOrders).
  /** @param {string} text @param {string | null} project @param {PlanItem[]} items @param {string} today */
  async createTyped(text, project, items, today) {
    const ext = this.ext();
    if (ext) {
      const r = understand(text, today);
      if (!r.title) return null;
      const day = r.due || r.plannedDay || null;
      return ext.create({ title: r.title, day, time: day && r.time ? r.time : null, project: project || null }); // each source takes what it uses
    }
    const api = this.tasksApi();
    if (!api) { new Notice('Adding tasks needs the projects and tasks part turned on.'); return null; }
    const r = understand(text, today);
    if (!r.title) return null;
    const { input, lane } = quickAddPlan(r, today);
    if (project) input.projects = [`[[${project}]]`];
    if (lane) { const l = laneOf(items, lane.day, lane.half).filter((x) => !x.time); /** @type {Fm} */ (input.customFrontmatter).planned_order = orderForInsert(l.map((x) => x.plannedOrder), l.length); }
    if (!Object.keys(/** @type {Fm} */ (input.customFrontmatter)).length) delete input.customFrontmatter;
    return api.tasks.create(input);
  }

  /** @param {PlanEvent} ev @param {string} today */
  async markEventMade(ev, today) {
    this.data.made = pruneMade(this.data.made, today);
    this.data.made[eventKey(ev)] = today;
    await this.save();
  }
}

/* ========================================================================== *
 * View
 * ========================================================================== */

/** @type {Set<SchedulePopover>} */
const openPopovers = new Set();
function closeOpenPopovers() { for (const p of [...openPopovers]) p.close(false); }

/** @type {<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement | null, tag: K, cls?: string | null, text?: string | null) => HTMLElementTagNameMap[K]} */
const h = (parent, tag, cls, text) => { const e = (parent ? parent.createEl(tag) : document.createElement(tag)); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** @typedef {HTMLElement & { _dragged?: boolean }} PlanRow */
/** @typedef {{ item?: PlanItem, ev?: PlanEvent, row: PlanRow, x0: number, y0: number, live: boolean, inSheet: boolean, ghost?: HTMLElement, zone?: HTMLElement | null, idx?: number | null, at?: { before: string | null, after: string | null } | null }} PlanDrag */
/** @typedef {{ day?: string | null, side?: boolean, drag?: boolean, compact?: boolean, hideProject?: boolean }} PlanRowOpts */
class PlannerView extends ItemView {
  // Set on every render (no value before the first one).
  /** @type {string} */ renderedToday;
  /** @type {PlanItem[]} */ items;
  /** @type {PlanItem[]} */ visible;
  /** @type {string[]} */ completed;
  /** @type {PlanPriority[]} */ ptable;
  /** @type {ReturnType<PlannerPlugin['areaIndex']>} */ areaIx;
  /** @type {Set<string>} */ areaNames;
  /** @type {unknown[]} */ events;
  /** @type {boolean} */ mid;
  /** @type {boolean | undefined} */ editing;
  /** @type {number | null | undefined} */ timer;
  /** @type {ResizeObserver | undefined} */ ro;

  /** @param {import('obsidian').WorkspaceLeaf} leaf @param {PlannerPlugin} plugin */
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.mode = viewModeOf(plugin.data.mode);
    this.anchor = dayOf(new Date());
    this.tab = 'tasks';
    this.project = '';
    this.sheetOpen = false;
    /** @type {PlanDrag | null} */
    this.drag = null;
    /** @type {SchedulePopover | null} */
    this.pop = null;
    this.pendingRender = false;
    this.narrow = false;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Planner'; }
  getIcon() { return 'calendar-days'; }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('a4pl-root');
    this.anchor = dayOf(new Date());
    // The task folders, the calendar note (when set), and the projects folder (which project is in which area).
    /** @param {unknown} p */
    const watched = (p) => typeof p === 'string' && ((!!feedNotes.calendar && p === feedNotes.calendar) || inTaskFolders(p) || p.startsWith(`${vaultFolders.projects}/`));
    /** @param {import('obsidian').TAbstractFile | null | undefined} f */
    const relevant = (f) => f && watched(f.path);
    this.registerEvent(this.app.metadataCache.on('changed', (f) => { if (relevant(f)) this.scheduleRender(); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (relevant(f)) this.scheduleRender(); }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if (relevant(f) || watched(old)) this.scheduleRender(); }));
    this.registerEvent(this.app.workspace.on('css-change', () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on('lifeworld:tasks', () => this.scheduleRender()));
    this.registerEvent(this.app.workspace.on('lifeworld:calendars', () => this.scheduleRender()));
    this.registerInterval(window.setInterval(() => { if (this.today() !== this.renderedToday) this.render(); }, 60000));
    this.registerDomEvent(document, 'pointermove', (e) => this.onPointerMove(e));
    this.registerDomEvent(document, 'pointerup', (e) => this.onPointerUp(e));
    this.registerDomEvent(document, 'pointercancel', () => this.cancelDrag());
    this.registerDomEvent(document, 'keydown', (e) => { if (e.key === 'Escape' && this.drag) this.cancelDrag(); });
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { const w = this.contentEl.clientWidth; const n = w > 0 && w <= NARROW_WIDTH; const m = !n && w > 0 && w <= MID_WIDTH; if (n !== this.narrow || m !== this.mid) this.render(); });
      this.ro.observe(this.contentEl);
    }
    this.render();
  }

  async onClose() {
    if (this.ro) this.ro.disconnect();
    if (this.timer) window.clearTimeout(this.timer);
    if (this.pop) this.pop.close(false);
    this.cancelDrag();
  }

  today() { return dayOf(new Date()); }

  scheduleRender() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.render(); }, 300);
  }

  goToday() { this.anchor = this.today(); this.render(); }

  render() {
    // Typing holds redraws back, except in an EMPTY quick add box (just saved):
    // the new task then shows at once and the box keeps the focus (data-focus).
    const ae = /** @type {HTMLInputElement | null} */ (document.activeElement);
    const idleAdd = ae && ae.dataset && ae.dataset.focus === 'quick-add' && !ae.value;
    if (this.drag || this.pop || (this.editing && !idleAdd)) { this.pendingRender = true; return; }
    this.pendingRender = false;
    const root = this.contentEl;
    const keepMain = root.querySelector('.a4pl-scroll'); const keepSheet = root.querySelector('.a4pl-sheet-body');
    const scrollMain = keepMain ? keepMain.scrollTop : 0; const scrollSheet = keepSheet ? keepSheet.scrollTop : 0;
    const focusKey = document.activeElement && root.contains(document.activeElement) ? document.activeElement.getAttribute('data-focus') : null;
    const today = this.today();
    this.renderedToday = today;
    this.narrow = root.clientWidth > 0 && root.clientWidth <= NARROW_WIDTH;
    root.toggleClass('is-narrow', this.narrow);
    this.mid = !this.narrow && root.clientWidth > 0 && root.clientWidth <= MID_WIDTH;
    root.toggleClass('is-mid', this.mid);
    const items = this.plugin.collectItems();
    this.items = items;
    this.completed = this.plugin.completedStatuses();
    for (const it of items) it.blockers = it.blockedBy && it.blockedBy.length ? openBlockersOf(this.app, it, this.completed) : [];
    this.ptable = this.plugin.priorities();
    this.areaIx = this.plugin.areaIndex();
    this.areaNames = new Set((this.areaIx ? this.areaIx.areas : []).map((a) => a.name));
    this.events = this.plugin.calendarEvents();
    const mode = this.narrow && this.mode === 'week' ? 'day' : this.mode; // phone: Day or Month
    const days = mode === 'day' ? [this.anchor] : mode === 'month' ? monthGrid(this.anchor.slice(0, 7)) : weekOf(this.anchor);
    const visible = this.project ? items.filter((it) => (this.project === '-' ? !it.projectKey : it.projectKey === this.project)) : items;
    this.visible = visible;

    root.empty();
    const scroll = h(root, 'div', 'a4pl-scroll');
    const page = h(scroll, 'div', 'a4pl-page');
    this.renderHead(page, mode, days, today);
    const body = h(page, 'div', 'a4pl-body');
    const side = h(body, 'div', 'a4pl-side');
    if (!this.narrow) this.renderSide(side, mode === 'month' ? days.filter((d) => d.startsWith(this.anchor.slice(0, 7))) : days, today);
    const grid = h(body, 'div', `a4pl-days is-${mode}`);
    if (mode === 'month') this.renderMonth(grid, days, today);
    else for (const d of days) this.renderDay(grid, d, mode, today);
    if (this.narrow) {
      const sheet = h(root, 'div', 'a4pl-sheet' + (this.sheetOpen ? '' : ' is-closed'));
      const sh = h(sheet, 'div', 'a4pl-sheet-head');
      sh.setAttr('role', 'button'); sh.tabIndex = 0;
      h(sh, 'span', 'a4pl-handle');
      h(sh, 'span', 'a4pl-kicker', 'Unscheduled');
      h(sh, 'span', 'a4pl-count', String(unscheduledOf(visible, this.completed).length));
      const chev = h(sh, 'span', 'a4pl-ic a4pl-sheet-chev'); setIcon(chev, this.sheetOpen ? 'chevron-down' : 'chevron-up');
      const toggle = () => { this.sheetOpen = !this.sheetOpen; this.render(); };
      sh.addEventListener('click', toggle);
      sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
      const lift = this.navbarOverlap();
      if (lift) { sheet.style.bottom = `${lift}px`; page.style.paddingBottom = `${90 + lift}px`; }
      const sb = h(sheet, 'div', 'a4pl-sheet-body');
      if (this.sheetOpen) this.renderPool(sb, today);
      sb.scrollTop = scrollSheet;
    }
    scroll.scrollTop = scrollMain;
    if (focusKey) { const el = /** @type {HTMLElement | null} */ (root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)); if (el) el.focus({ preventScroll: true }); }
  }

  // Obsidian's phone toolbar floats over the bottom of the view; keep the drawer above it.
  navbarOverlap() {
    const nav = /** @type {HTMLElement | null} */ (document.querySelector('.mobile-navbar'));
    if (!nav || !nav.offsetParent) return 0;
    const nb = nav.getBoundingClientRect(); const rb = this.contentEl.getBoundingClientRect();
    const over = Math.round(rb.bottom - nb.top);
    return nb.height > 0 && over > 0 && over < 240 ? over : 0;
  }

  /** @param {HTMLElement} page @param {string} mode @param {string[]} days @param {string} today */
  renderHead(page, mode, days, today) {
    const head = h(page, 'div', 'a4pl-head');
    const left = h(head, 'div');
    h(left, 'div', 'a4pl-kicker', '/ The Planner');
    h(left, 'h1', 'a4pl-title', mode === 'week' ? `Week of ${fmtDay(days[0], { month: 'long', day: 'numeric' })}` : mode === 'month' ? fmtDay(`${this.anchor.slice(0, 7)}-15`, { month: 'long', year: 'numeric' }) : fmtDay(this.anchor, { weekday: 'long', month: 'long', day: 'numeric' }));
    const act = h(head, 'div', 'a4pl-actions');
    const fb = h(act, 'button', 'a4pl-btn a4pl-find-btn'); setIcon(h(fb, 'span', 'a4pl-find-ic'), 'search'); h(fb, 'span', null, 'Find');
    fb.setAttr('aria-label', 'Find a task');
    fb.addEventListener('click', () => this.plugin.openFind());
    if (!this.narrow) {
      const sel = h(act, 'select', 'a4pl-select dropdown');
      sel.setAttr('aria-label', 'Show one project');
      /** @type {[string, string][]} */
      const opts = [['', 'All projects'], ...this.plugin.projectNames(this.items).map((p) => /** @type {[string, string]} */ ([p, this.areaNames.has(p) ? `${p} (area)` : p])), ['-', 'No project']];
      for (const [v, l] of opts) { const o = h(sel, 'option', null, l); o.value = v; }
      sel.value = this.project;
      sel.addEventListener('change', () => { this.project = sel.value; this.render(); });
    }
    // Day | Week | Month, remembered; the phone has no Week (it shows one day).
    const seg = h(act, 'div', 'a4pl-seg');
    for (const [m, l] of /** @type {['day' | 'week' | 'month', string][]} */ ([['day', 'Day'], ['week', 'Week'], ['month', 'Month']])) {
      if (this.narrow && m === 'week') continue;
      const b = h(seg, 'button', mode === m ? 'is-on' : '', l);
      b.addEventListener('click', async () => { this.mode = m; this.plugin.data.mode = m; this.render(); await this.plugin.save(); });
    }
    const nav = h(act, 'div', 'a4pl-nav');
    const step = mode === 'week' ? 7 : 1;
    const unit = mode === 'month' ? 'month' : mode === 'week' ? 'week' : 'day';
    /** @param {number} n */
    const go = (n) => { this.anchor = mode === 'month' ? `${shiftMonth(this.anchor.slice(0, 7), n)}-01` : addDays(this.anchor, n * step); this.render(); };
    const prev = h(nav, 'button', 'a4pl-icon-btn'); setIcon(prev, 'chevron-left'); prev.setAttr('aria-label', `Previous ${unit}`);
    prev.addEventListener('click', () => go(-1));
    const tb = h(nav, 'button', 'a4pl-btn', 'Today');
    tb.addEventListener('click', () => {
      if (mode === 'week' && days.includes(today) && !this.narrow) { this.mode = 'day'; this.plugin.data.mode = 'day'; this.plugin.save(); }
      this.anchor = today; this.render();
    });
    const next = h(nav, 'button', 'a4pl-icon-btn'); setIcon(next, 'chevron-right'); next.setAttr('aria-label', `Next ${unit}`);
    next.addEventListener('click', () => go(1));
  }

  /* ---- left panel ------------------------------------------------------- */

  /** @param {HTMLElement} side @param {string[]} days @param {string} today */
  renderSide(side, days, today) {
    const tabs = h(side, 'div', 'a4pl-tabs');
    for (const [k, l] of [['tasks', 'Tasks'], ['agenda', 'Agenda'], ['goals', 'Goals']]) {
      const b = h(tabs, 'button', this.tab === k ? 'is-on' : '', l);
      b.addEventListener('click', () => { this.tab = k; this.render(); });
    }
    if (this.tab === 'agenda') return this.renderAgenda(side, days, today);
    if (this.tab === 'goals') return this.renderGoals(side, today);
    const ext = this.plugin.ext();
    if (ext && ext.status().error) h(side, 'div', 'a4pl-src-err', ext.status().error); // a wrong key, no internet... (criterion 28)
    const od = overdueOf(this.visible, today, this.completed);
    if (od.length) this.renderSection(side, '§overdue', 'Overdue', od, true, today);
    this.renderSection(side, '§goals', 'Weekly goals', weeklyGoalsOf(this.visible, today, this.completed), false, today);
    const ut = h(side, 'div', 'a4pl-uns-title');
    h(ut, 'span', 'a4pl-kicker', 'Unscheduled');
    h(ut, 'span', 'a4pl-count', String(unscheduledOf(this.visible, this.completed).length));
    // One toggle, the file explorer's icon and flip: chevrons-down-up folds all, chevrons-up-down opens all.
    this.groupSwitch(ut);
    const folded = allUnscheduledFolded(this.unscheduledGroups(), this.plugin.data.collapsed, this.plugin.data.somedayOpen, somedayOf(this.visible, this.completed, this.ptable).length > 0);
    const fb = h(ut, 'button', 'a4pl-icon-btn a4pl-fold-all');
    setIcon(fb, folded ? 'chevrons-up-down' : 'chevrons-down-up');
    fb.setAttr('aria-label', folded ? 'Open all' : 'Fold all');
    fb.addEventListener('click', () => this.setAll(!folded));
    this.renderPool(side, today);
    this.renderQuickAdd(side);
  }

  // The Unscheduled groups the switch asks for (by area only when Projects can say which is which).
  unscheduledGroups() {
    const list = unscheduledOf(this.visible, this.completed);
    return this.plugin.data.groupBy === 'area' && this.areaIx ? groupByArea(list, this.ptable, this.areaIx) : groupUnscheduled(list, this.ptable);
  }

  // Group by: Project / Area (remembered; Project is today's list).
  /** @param {HTMLElement} host */
  groupSwitch(host) {
    if (!this.areaIx) return;
    const seg = h(host, 'div', 'a4pl-seg a4pl-groupby'); seg.setAttr('role', 'group'); seg.setAttr('aria-label', 'Group by');
    const cur = this.plugin.data.groupBy === 'area' ? 'area' : 'project';
    for (const [k, l] of [['project', 'Project'], ['area', 'Area']]) {
      const b = h(seg, 'button', cur === k ? 'is-on' : '', l);
      b.setAttr('aria-pressed', String(cur === k));
      b.addEventListener('click', async () => { if (cur === k) return; this.plugin.data.groupBy = k; this.render(); await this.plugin.save(); });
    }
  }

  /** @param {HTMLElement} side @param {string} key @param {string} title @param {PlanItem[]} list @param {boolean} warn @param {string} today */
  renderSection(side, key, title, list, warn, today) {
    const folded = !!this.plugin.data.collapsed[key];
    const s = h(side, 'div', 'a4pl-sec' + (folded ? ' is-folded' : ''));
    const head = h(s, 'button', 'a4pl-sec-head');
    head.setAttr('aria-expanded', String(!folded));
    const chev = h(head, 'span', 'a4pl-chev a4pl-ic'); setIcon(chev, 'chevron-down');
    h(head, 'span', 'a4pl-kicker' + (warn ? ' is-warn' : ''), title);
    h(head, 'span', 'a4pl-count', String(list.length));
    head.addEventListener('click', () => this.toggleFold(key));
    if (folded) return;
    const l = h(s, 'div', 'a4pl-sec-list');
    if (!list.length) h(l, 'div', 'a4pl-empty', warn ? 'nothing overdue' : 'no weekly goals pinned');
    for (const it of list) l.appendChild(this.taskRow(it, { side: true, drag: true, day: it.plannedDay || today }));
  }

  /** @param {HTMLElement} host @param {string} today */
  renderPool(host, today) {
    const pool = h(host, 'div', 'a4pl-pool');
    pool.dataset.drop = 'pool';
    if (this.narrow) this.groupSwitch(pool); // the phone drawer has no Unscheduled title row
    const groups = this.unscheduledGroups();
    /** @type {{ key: string, label: string, items: PlanItem[], area?: string | null }[]} */
    const grouped = groups;
    const byArea = grouped.some((g) => 'area' in g);
    const someday = somedayOf(this.visible, this.completed, this.ptable);
    if (!groups.length) h(pool, 'div', 'a4pl-empty', 'everything has a home');
    for (const g of grouped) {
      const key = g.key || '§none';
      const folded = !!this.plugin.data.collapsed[key];
      const none = byArea ? !g.area : !g.key;
      const el = h(pool, 'div', 'a4pl-grp' + (none ? ' is-none' : '') + (folded ? ' is-folded' : ''));
      el.dataset.group = key;
      const head = h(el, 'button', 'a4pl-grp-head');
      head.setAttr('aria-expanded', String(!folded));
      const chev = h(head, 'span', 'a4pl-chev a4pl-ic'); setIcon(chev, 'chevron-down');
      // An area's group carries the stack icon, in either grouping.
      if (byArea ? g.area : (this.areaIx && this.areaIx.of[g.key] === g.key)) { const ai = h(head, 'span', 'a4pl-ic a4pl-area-ic'); setIcon(ai, 'layers'); ai.setAttr('aria-label', 'Area'); }
      h(head, 'span', 'a4pl-grp-name', g.label);
      h(head, 'span', 'a4pl-pill', String(g.items.length));
      head.addEventListener('click', () => this.toggleFold(key));
      if (folded) continue;
      const list = h(el, 'div', 'a4pl-grp-list');
      // By area, each row names its project (a loose task needs no name: the group is its area).
      for (const it of g.items) list.appendChild(this.taskRow(it, { side: true, drag: true, hideProject: !byArea || it.projectKey === g.area, day: today }));
    }
    // Someday: one group at the bottom, folded until opened (it remembers).
    if (someday.length) {
      const open = this.plugin.data.somedayOpen === true;
      const el = h(pool, 'div', 'a4pl-grp is-someday' + (open ? '' : ' is-folded'));
      el.dataset.group = '§someday';
      const head = h(el, 'button', 'a4pl-grp-head');
      head.setAttr('aria-expanded', String(open));
      head.setAttr('title', 'Kept for later, with no day. Drag one onto a day, or use its Schedule button, to bring it back.');
      const chev = h(head, 'span', 'a4pl-chev a4pl-ic'); setIcon(chev, 'chevron-down');
      h(head, 'span', 'a4pl-grp-name', 'Someday');
      h(head, 'span', 'a4pl-pill', String(someday.length));
      head.addEventListener('click', async () => { this.plugin.data.somedayOpen = !open; this.render(); await this.plugin.save(); });
      if (open) {
        const list = h(el, 'div', 'a4pl-grp-list');
        for (const it of someday) list.appendChild(this.taskRow(it, { side: true, drag: !it.recurrenceRaw, day: today }));
      }
    }
  }

  /** @param {HTMLElement} side */
  renderQuickAdd(side) {
    const qa = h(side, 'div', 'a4pl-quick');
    h(qa, 'div', 'a4pl-kicker', 'New task');
    const names = this.plugin.projectNames(this.items);
    const anchor = h(qa, 'div', 'a4pl-qa-anchor');
    const inp = h(anchor, 'input', 'a4pl-input'); inp.type = 'text'; inp.placeholder = 'What needs doing? "call Max friday 3pm"'; inp.dataset.focus = 'quick-add';
    // "+project" (1.4.0): a quiet note when a "+word" fits no project.
    const note = h(qa, 'div', 'a4pl-nomatch'); note.hidden = true;
    // The orange line: what Enter will save (same chips as Projects' quick add).
    const parse = h(qa, 'div', 'a4pl-parse');
    const show = () => {
      parse.empty();
      const miss = inp.value.trim() ? unmatchedProjectWords(inp.value, names) : [];
      note.hidden = !miss.length;
      note.textContent = miss.length ? `No project matches “${miss[0]}”, so it stays in the name.` : '';
      if (!inp.value.trim()) {
        // 1.4.1: the line SHOWS the typing (keys in bold), not just names it.
        const hint = h(parse, 'span', 'a4pl-hint', 'Dates, times (friday 3pm), mornings and afternoons, repeats (every monday), priority (');
        /** @param {string} t */
        const bit = (t) => hint.appendChild(document.createTextNode(t));
        h(hint, 'span', 'a4pl-hint-key', '!high'); bit(', ');
        h(hint, 'span', 'a4pl-hint-key', '!low'); bit(') and projects (');
        h(hint, 'span', 'a4pl-hint-key', '+Project Name'); bit(') are picked up as you type.');
        return;
      }
      const today = this.today();
      h(parse, 'span', 'a4pl-hint', 'Adds:');
      for (const c of quickAddChips(understand(inp.value, today), today, ps.value || null, this.plugin.defaultPriority())) h(parse, 'span', 'a4pl-chip is-got', c);
      h(parse, 'span', 'a4pl-hint', '· Enter');
    };
    const ps = h(qa, 'select', 'a4pl-select dropdown');
    for (const [v, l] of /** @type {[string, string][]} */ ([['', 'No project'], ...names.map((p) => [p, this.areaNames.has(p) ? `${p} (area)` : p])])) { const o = h(ps, 'option', null, l); o.value = v; }
    if (this.project && this.project !== '-') ps.value = this.project;
    // The suggestion list under the box while a "+text" is typed.
    /** @type {HTMLElement | null} */
    let list = null;
    /** @type {{ tok: { start: number, end: number, query: string }, hits: { name: string, at: number, len: number }[], key: string | null } | null} */
    let shown = null;
    let sel = 0;
    /** @type {string | null} */
    let dismissed = null;
    const closeList = () => { if (list) list.remove(); list = null; shown = null; };
    const drawList = () => {
      const opening = !list;
      if (!list) list = h(anchor, 'div', 'a4pl-pop a4pl-sugg');
      const box = /** @type {HTMLElement} */ (list); const sh = /** @type {NonNullable<typeof shown>} */ (shown);
      box.empty();
      box.setAttr('role', 'listbox');
      h(box, 'div', 'a4pl-pop-title', `Projects matching “${sh.tok.query.trim()}”`);
      sh.hits.forEach((m, i) => {
        const b = h(box, 'button', 'a4pl-pop-q' + (i === sel ? ' is-active' : ''));
        b.type = 'button'; b.tabIndex = -1; b.setAttr('role', 'option'); b.setAttr('aria-selected', String(i === sel));
        const label = h(b, 'span');
        label.appendChild(document.createTextNode(m.name.slice(0, m.at)));
        h(label, 'b', 'a4pl-hit', m.name.slice(m.at, m.at + m.len));
        label.appendChild(document.createTextNode(m.name.slice(m.at + m.len)));
        if (this.areaNames.has(m.name)) h(b, 'span', 'a4pl-pop-k', 'area');
        if (i === sel) h(b, 'span', 'a4pl-pop-k', 'Enter');
        b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the box
        b.addEventListener('click', (e) => { e.preventDefault(); pick(m.name); });
      });
      h(box, 'div', 'a4pl-pop-sep');
      h(box, 'div', 'a4pl-pop-note', '↑ ↓ to move · Enter, Tab or click picks · Esc closes');
      // The box sits low in the side panel: bring the whole list into view as it opens.
      if (opening && typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
    };
    const refreshList = () => {
      const tok = activeDocument.activeElement === inp && inp.selectionStart === inp.selectionEnd ? projectToken(inp.value, inp.selectionStart, names) : null;
      const hits = tok ? projectMatches(tok.query, names).slice(0, PROJECT_HITS_MAX) : [];
      const key = tok ? `${tok.start}|${tok.query}` : null;
      if (!hits.length || key === dismissed) { closeList(); return; }
      if (!shown || shown.key !== key) sel = 0;
      shown = { tok, hits, key };
      drawList();
    };
    /** @param {string} name */
    const pick = (name) => {
      if (!shown) return;
      const r = pickProjectText(inp.value, shown.tok);
      inp.value = r.text; inp.setSelectionRange(r.caret, r.caret);
      ps.value = name; ps.addClass('is-picked');
      closeList(); show();
    };
    show();
    inp.addEventListener('input', () => { dismissed = null; show(); refreshList(); });
    inp.addEventListener('click', refreshList);
    inp.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshList(); });
    ps.addEventListener('change', () => { ps.removeClass('is-picked'); show(); });
    inp.addEventListener('focus', () => { this.editing = true; });
    inp.addEventListener('blur', () => { closeList(); this.editing = false; if (this.pendingRender) this.scheduleRender(); });
    inp.addEventListener('keydown', async (e) => {
      if (e.isComposing) return;
      // While the list is open, arrows move, Enter and Tab pick, Esc closes it.
      if (shown) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = shown.hits.length; sel = (sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; drawList(); return; }
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); pick(shown.hits[sel].name); return; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); dismissed = shown.key; closeList(); return; }
      }
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      e.preventDefault();
      const text = inp.value; inp.value = ''; ps.removeClass('is-picked'); show();
      try { if (await this.plugin.createTyped(text, ps.value || null, this.items, this.today())) new Notice('Task added'); else inp.value = text; }
      catch (err) { console.error('[LifeWorld] add failed', err); new Notice('Could not add that task.'); inp.value = text; show(); }
      this.scheduleRender();
    });
  }

  /** @param {HTMLElement} side @param {string[]} days @param {string} today */
  renderAgenda(side, days, today) {
    let any = false;
    for (const d of days) {
      const list = this.visible.filter((it) => taskOnDay(it, d));
      if (!list.length) continue;
      any = true;
      h(side, 'div', 'a4pl-ag-day', fmtDay(d, { weekday: 'short', month: 'short', day: 'numeric' }));
      for (const it of sortByOrder(list)) side.appendChild(this.taskRow(it, { side: true, day: d }));
    }
    if (!any) h(side, 'div', 'a4pl-empty', 'nothing planned in this range');
  }

  /** @param {HTMLElement} side @param {string} today */
  renderGoals(side, today) {
    /** @type {TFile[]} */
    const goals = [];
    const root = this.app.vault.getAbstractFileByPath(vaultFolders.goals);
    if (root instanceof TFolder) for (const c of root.children || []) if (c instanceof TFile && c.extension === 'md') goals.push(c);
    goals.sort((a, b) => a.basename.localeCompare(b.basename));
    /** @type {Record<string, string>} */
    const projectGoal = {};
    const proot = this.app.vault.getAbstractFileByPath(vaultFolders.projects);
    if (proot instanceof TFolder) {
      for (const c of proot.children || []) {
        if (!(c instanceof TFile) || c.extension !== 'md') continue;
        const fm = /** @type {Fm} */ ((this.app.metadataCache.getFileCache(c) || {}).frontmatter || {});
        const g = projectKeyOf(asList(fm.goal)[0]);
        if (g) projectGoal[c.basename] = g;
      }
    }
    if (!goals.length) { h(side, 'div', 'a4pl-empty', 'no goal notes yet'); return; }
    for (const f of goals) {
      const fm = /** @type {Fm} */ ((this.app.metadataCache.getFileCache(f) || {}).frontmatter || {});
      const linked = this.items.filter((it) => it.projectKey && projectGoal[it.projectKey] === f.basename);
      const open = linked.filter((it) => !isTaskDone(it, today, this.completed)).length;
      const late = linked.filter((it) => isOverdue(it, today, this.completed)).length;
      const row = h(side, 'div', 'a4pl-goal'); row.setAttr('role', 'button'); row.tabIndex = 0;
      const top = h(row, 'div', 'a4pl-goal-top');
      h(top, 'span', 'a4pl-goal-name', f.basename);
      if (fm.status) h(top, 'span', 'a4pl-chip', String(fm.status));
      h(row, 'div', 'a4pl-goal-counts', `${open} open · ${late} overdue`);
      const go = () => this.app.workspace.getLeaf('tab').openFile(f);
      row.addEventListener('click', go);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    }
  }

  /** @param {string} key */
  async toggleFold(key) {
    if (this.plugin.data.collapsed[key]) delete this.plugin.data.collapsed[key]; else this.plugin.data.collapsed[key] = true;
    this.render();
    await this.plugin.save();
  }

  /** @param {boolean} fold */
  async setAll(fold) {
    for (const g of this.unscheduledGroups()) {
      const k = g.key || '§none';
      if (fold) this.plugin.data.collapsed[k] = true; else delete this.plugin.data.collapsed[k];
    }
    if (fold) this.plugin.data.somedayOpen = false; // Open all leaves Someday folded: it stays out of the way
    this.render();
    await this.plugin.save();
  }

  /* ---- day columns ------------------------------------------------------- */

  /** @param {HTMLElement} grid @param {string} day @param {string} mode @param {string} today */
  renderDay(grid, day, mode, today) {
    const col = h(grid, 'div', 'a4pl-day' + (day === today ? ' is-today' : '') + (day < today ? ' is-past' : ''));
    col.dataset.day = day;
    const head = h(col, 'div', 'a4pl-day-head');
    h(head, 'span', 'a4pl-dow', fmtDay(day, { weekday: 'short' }));
    h(head, 'span', 'a4pl-dom', String(partsOf(day).d));
    if (day === today) h(head, 'span', 'a4pl-today-tag', 'today');
    const dayItems = this.visible.filter((it) => taskOnDay(it, day));
    if (day === today && dayItems.length) {
      const done = dayItems.filter((it) => isTaskDone(it, day, this.completed)).length;
      const p = h(col, 'div', 'a4pl-progress');
      h(h(p, 'div', 'a4pl-track'), 'div', 'a4pl-fill').style.width = `${Math.round((done / dayItems.length) * 100)}%`;
      h(p, 'div', 'a4pl-plabel', `${done}/${dayItems.length} DONE`);
    }
    const evs = eventsForDay(this.events, day);
    if (evs.length) {
      const c = h(col, 'div', 'a4pl-cal');
      if (mode === 'day') { const ch = h(c, 'div', 'a4pl-cal-head'); h(ch, 'span', 'a4pl-slot-label', 'Calendar'); h(ch, 'span', 'a4pl-hint', 'drag an event to make a task'); }
      for (const ev of evs) c.appendChild(this.eventRow(ev));
    }
    const any = laneOf(this.visible, day, null);
    if (any.length) this.renderSlot(col, day, null, any, mode);
    this.renderSlot(col, day, 'am', laneOf(this.visible, day, 'am'), mode);
    this.renderSlot(col, day, 'pm', laneOf(this.visible, day, 'pm'), mode);
  }

  /** @param {PlanEvent} ev */
  eventRow(ev) {
    const r = h(null, 'div', 'a4pl-ev');
    r.setAttr('title', 'Drag onto Morning, Afternoon or the Unscheduled list to make a task. The event itself stays in Apple Calendar.');
    h(r, 'span', 'a4pl-ev-t', ev.allDay ? 'All day' : ev.time);
    h(r, 'span', 'a4pl-ev-s', ev.summary);
    if (this.plugin.data.made[eventKey(ev)]) h(r, 'span', 'a4pl-ev-made', '✓ task');
    r.addEventListener('pointerdown', (e) => this.startDrag(e, { ev }, r));
    return r;
  }

  // A day's tasks in the Day/Week lane order: Any time, Morning, Afternoon.
  /** @param {string} day */
  dayTasks(day) { return [null, 'am', 'pm'].flatMap((half) => laneOf(this.visible, day, half)); }

  /** @param {string} day */
  openDay(day) { this.mode = 'day'; this.plugin.data.mode = 'day'; this.anchor = day; this.render(); this.plugin.save(); }

  // Month (0.1.15): each day lists its events, then its tasks, four lines and
  // "+N more" (opens that Day). Phone width: dots, and a tap lists the picked
  // day (the anchor) under the grid, its rows dragged by the grip as in the drawer.
  /** @param {HTMLElement} grid @param {string[]} days @param {string} today */
  renderMonth(grid, days, today) {
    const month = this.anchor.slice(0, 7);
    const mg = h(grid, 'div', 'a4pl-mgrid');
    for (const d of days.slice(0, 7)) h(mg, 'div', 'a4pl-mdow', fmtDay(d, { weekday: 'short' }));
    for (const day of days) {
      const evs = eventsForDay(this.events, day);
      const tasks = this.dayTasks(day);
      const c = h(mg, 'div', 'a4pl-mday' + (day.slice(0, 7) !== month ? ' is-out' : '') + (day === today ? ' is-today' : '') + (day < today ? ' is-past' : '') + (this.narrow && day === this.anchor ? ' is-sel' : ''));
      c.dataset.drop = 'mday'; c.dataset.day = day;
      const head = h(c, 'div', 'a4pl-mhead');
      const dn = h(head, 'button', 'a4pl-mdn', String(partsOf(day).d));
      dn.setAttr('aria-label', fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' }));
      if (this.narrow) {
        const dots = h(c, 'div', 'a4pl-mdots');
        evs.forEach(() => h(dots, 'i', 'is-ev'));
        tasks.forEach(() => h(dots, 'i'));
        c.addEventListener('click', () => { this.anchor = day; this.render(); });
        continue;
      }
      if (day === today) h(head, 'span', 'a4pl-today-tag', 'today');
      dn.addEventListener('click', () => this.openDay(day));
      /** @type {{ ev?: PlanEvent, it?: PlanItem }[]} */
      const all = [...evs.map((ev) => ({ ev })), ...tasks.map((it) => ({ it }))];
      for (const x of all.slice(0, 4)) { const it = /** @type {PlanItem} */ (x.it); c.appendChild(x.ev ? this.eventRow(x.ev) : this.taskRow(it, { day, drag: !it.recurrenceRaw, compact: true })); }
      if (all.length > 4) { const more = h(c, 'button', 'a4pl-more', `+${all.length - 4} more`); more.addEventListener('click', () => this.openDay(day)); }
    }
    if (!this.narrow) return;
    const day = this.anchor;
    const list = h(grid, 'div', 'a4pl-mlist');
    h(list, 'div', 'a4pl-kicker', fmtDay(day, { weekday: 'long', month: 'long', day: 'numeric' }));
    const evs = eventsForDay(this.events, day);
    const tasks = this.dayTasks(day);
    for (const ev of evs) list.appendChild(this.eventRow(ev));
    for (const it of tasks) list.appendChild(this.taskRow(it, { side: true, drag: !it.recurrenceRaw, day }));
    if (!evs.length && !tasks.length) h(list, 'div', 'a4pl-empty', 'nothing on this day');
  }

  /** @param {HTMLElement} col @param {string} day @param {string | null} half @param {PlanItem[]} list @param {string} mode */
  renderSlot(col, day, half, list, mode) {
    const s = h(col, 'div', `a4pl-slot is-${half || 'any'}`);
    s.dataset.drop = 'slot'; s.dataset.day = day; s.dataset.half = half || '';
    h(s, 'div', 'a4pl-slot-label', half === 'am' ? 'Morning' : half === 'pm' ? 'Afternoon' : 'Any time');
    for (const it of list) s.appendChild(this.taskRow(it, { day, drag: !it.recurrenceRaw, compact: mode === 'week' }));
    if (half) {
      const add = h(s, 'button', 'a4pl-slot-add', '+ add');
      add.addEventListener('click', () => this.inlineAdd(s, add, day, half));
    }
    if (half === 'am') h(h(s, 'div', 'a4pl-noon'), 'span', null, '13:00');
  }

  /** @param {HTMLElement} slot @param {HTMLElement} btn @param {string} day @param {string} half */
  inlineAdd(slot, btn, day, half) {
    const inp = createEl('input', { cls: 'a4pl-slot-input', type: 'text' });
    inp.placeholder = 'New task…';
    btn.replaceWith(inp);
    this.editing = true;
    inp.focus();
    const done = () => { this.editing = false; this.render(); };
    inp.addEventListener('blur', done);
    inp.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') { inp.blur(); return; }
      if (e.key !== 'Enter' || !inp.value.trim()) return;
      const title = inp.value.trim(); inp.value = '';
      try { await this.plugin.createTask({ title, day, half }, this.items); } catch (err) { console.error('[LifeWorld] add failed', err); new Notice('Could not add that task.'); }
      inp.blur();
    });
  }

  /* ---- task row ---------------------------------------------------------- */

  /** @param {PlanItem} it @param {PlanRowOpts} o */
  taskRow(it, o) {
    const day = o.day || this.today();
    const done = isTaskDone(it, day, this.completed);
    // Dependencies (Projects mockup round 4): open blockers dim the row and add a lock chip.
    const blockers = done ? [] : (it.blockers || openBlockersOf(this.app, it, this.completed));
    const r = /** @type {PlanRow} */ (h(null, 'div', 'a4pl-task' + (done ? ' is-done' : '') + (o.drag ? ' is-drag' : '') + (it.projectKey ? ' has-project' : '') + (blockers.length ? ' is-blocked' : '')));
    r.dataset.path = it.path;
    if (o.drag && o.side && this.narrow) { const g = h(r, 'span', 'a4pl-grip a4pl-ic'); setIcon(g, 'grip-vertical'); }
    const tick = h(r, 'button', 'a4pl-tick' + (done ? ' is-on' : ''));
    tick.setAttr('aria-label', done ? 'Mark not done' : 'Mark done');
    if (done) setIcon(tick, 'check');
    tick.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await this.plugin.toggleTask(it, day); } catch (err) { new Notice(String(errField(err, 'message') || err)); }
      this.scheduleRender();
    });
    const main = h(r, 'div', 'a4pl-task-main');
    const tl = h(main, 'div', 'a4pl-task-title');
    // A clock time (due time, or a repeating task's start time) goes first, in the accent colour.
    if (it.time) h(tl, 'span', 'a4pl-time', timeText(it.time, o.compact));
    // A small bell: it will ring (reminder setup mockup); "15m" when earlier than the time.
    if (it.time && it.reminder != null && !done) {
      const bell = h(tl, 'span', 'a4pl-bell');
      bell.setAttr('aria-label', `Reminder: ${reminderWords(it.reminder).toLowerCase()}`); bell.setAttr('title', `Reminder: ${reminderWords(it.reminder).toLowerCase()}`);
      setIcon(h(bell, 'span', 'a4pl-ic'), 'bell');
      if (reminderShort(it.reminder)) h(bell, 'span', 'a4pl-bell-k', reminderShort(it.reminder));
    }
    tl.appendText(it.title);
    const meta = h(main, 'div', 'a4pl-meta');
    if (blockers.length) blockedChip(meta, blockers, (p) => { const f = this.plugin.fileOf(p); if (f) this.app.workspace.getLeaf('tab').openFile(f); }, 'a4pl');
    const pr = priorityOf(it.priority, this.ptable);
    const pc = h(meta, 'span', 'a4pl-chip a4pl-pri' + (pr.top ? ' is-top' : '') + (pr.bars === 0 ? ' is-low' : pr.bars === 1 ? ' is-low' : ''));
    pc.setAttr('data-tip', 'Priority');
    const bars = h(pc, 'span', 'a4pl-bars');
    for (let i = 1; i <= 3; i++) h(bars, 'i', i <= pr.bars ? 'is-on' : '');
    pc.appendText(pr.label);
    if (it.projectKey && !o.hideProject) {
      // The project label opens the project's page in Projects (as in Today).
      const pc = h(meta, 'span', 'a4pl-chip a4pl-proj', it.project || it.projectKey);
      pc.addEventListener('click', (e) => { e.stopPropagation(); if (r._dragged) return; openProjectPage(this.app, it.projectLink || it.projectKey, e, it.path); });
    }
    if (it.recurrenceRaw || it.repeats) h(meta, 'span', 'a4pl-chip', 'repeats');
    const due = dueChipOf(it, this.today(), this.completed);
    if (due && !(due.cls === '' && !o.side && it.plannedDay === it.due)) h(meta, 'span', 'a4pl-chip' + (due.cls ? ' is-' + due.cls : ''), due.text);
    if (o.side && it.plannedDay && it.plannedDay !== it.due) h(meta, 'span', 'a4pl-chip', fmtDay(it.plannedDay, { weekday: 'short', day: 'numeric' }));
    if (!it.recurrenceRaw && !done) {
      const sb = h(r, 'button', 'a4pl-sched a4pl-ic');
      setIcon(sb, 'calendar');
      sb.setAttr('aria-label', 'Schedule'); sb.dataset.focus = 'sched:' + it.path + '@' + (o.side ? 'side' : day);
      sb.addEventListener('click', (e) => { e.stopPropagation(); this.openSchedule(it, sb); });
      r.tabIndex = 0;
      r.dataset.focus = 'row:' + it.path + '@' + (o.side ? 'side' : day);
      r.addEventListener('keydown', (e) => {
        if (e.target !== r) return;
        if (e.key === 'Enter' || e.key === 's' || e.key === 'S') { e.preventDefault(); this.openSchedule(it, sb); }
        else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const rows = /** @type {HTMLElement[]} */ ([...this.contentEl.querySelectorAll('.a4pl-task[tabindex="0"]')]).filter((x) => x.offsetParent);
          const i = rows.indexOf(r);
          const n = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
          if (n) n.focus();
        }
      });
    }
    const pin = h(r, 'button', 'a4pl-pin a4pl-ic' + (it.weeklyGoal ? ' is-on' : '') + (it.ext ? ' a4pl-off' : ''));
    setIcon(pin, 'star');
    pin.setAttr('aria-label', it.weeklyGoal ? 'Unpin from weekly goals' : 'Pin as weekly goal');
    pin.addEventListener('click', async (e) => { e.stopPropagation(); await this.plugin.toggleWeeklyGoal(it); this.scheduleRender(); });
    main.addEventListener('click', () => { if (r._dragged) return; if (it.ext) { const own = this.plugin.projectsPlugin(); if (own) own.openTask(/** @type {ExtItem} */ (it)); return; } const f = this.plugin.fileOf(it.path); if (f) this.app.workspace.getLeaf('tab').openFile(f); });
    if (o.drag) r.addEventListener('pointerdown', (e) => this.startDrag(e, { item: it }, r));
    return r;
  }

  /* ---- dragging (pointer events: mouse and finger) ------------------------ */

  /** @param {PointerEvent} e @param {{ item?: PlanItem, ev?: PlanEvent }} what @param {PlanRow} row */
  startDrag(e, what, row) {
    const target = /** @type {HTMLElement} */ (e.target);
    if (e.button !== 0 || target.closest('.a4pl-tick, .a4pl-pin, .a4pl-sched')) return;
    const inSheet = !!row.closest('.a4pl-sheet, .a4pl-mlist');
    if (inSheet && what.item && !target.closest('.a4pl-grip')) return; // the phone drawer (and Month's day list) scrolls; the grip drags
    if (e.pointerType === 'touch' && !inSheet && !what.ev) return; // board rows on touch: use the Schedule button
    this.drag = { ...what, row, x0: e.clientX, y0: e.clientY, live: false, inSheet };
    if (e.pointerType !== 'touch' || inSheet) e.preventDefault();
  }

  /** @param {PointerEvent} e */
  onPointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.live) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
      d.live = true;
      if (d.item) d.row.addClass('is-lifted');
      d.ghost = document.body.createDiv({ cls: 'a4pl-ghost', text: d.ev ? 'New task: ' + d.ev.summary : d.item.title });
      if (d.inSheet) { this.sheetOpen = false; const s = this.contentEl.querySelector('.a4pl-sheet'); if (s) s.addClass('is-closed'); }
    }
    const ghost = /** @type {HTMLElement} */ (d.ghost);
    ghost.style.left = `${e.clientX + 12}px`;
    ghost.style.top = `${e.clientY + 8}px`;
    this.clearMarks();
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const zone = /** @type {HTMLElement | null} */ (hit && this.contentEl.contains(hit) ? hit.closest('[data-drop]') : null);
    d.zone = zone; d.idx = null; d.at = null;
    this.autoScroll(e.clientY);
    if (!zone) return;
    zone.addClass('is-over');
    if (zone.dataset.drop === 'slot' && d.item) {
      const rows = /** @type {HTMLElement[]} */ ([...zone.querySelectorAll(':scope > .a4pl-task:not(.is-lifted)')]);
      let idx = rows.length;
      for (let i = 0; i < rows.length; i++) { const b = rows[i].getBoundingClientRect(); if (e.clientY < b.top + b.height / 2) { idx = i; break; } }
      d.idx = idx;
      d.at = { before: idx < rows.length ? rows[idx].dataset.path || null : null, after: idx > 0 ? rows[idx - 1].dataset.path || null : null };
      const line = createDiv({ cls: 'a4pl-drop-line' });
      if (idx < rows.length) zone.insertBefore(line, rows[idx]); else zone.insertBefore(line, zone.querySelector('.a4pl-slot-add, .a4pl-noon'));
    }
  }

  /** @param {number} y */
  autoScroll(y) {
    const sc = this.contentEl.querySelector('.a4pl-scroll');
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    if (y < r.top + 40) sc.scrollTop -= 14; else if (y > r.bottom - 40) sc.scrollTop += 14;
  }

  clearMarks() {
    this.contentEl.querySelectorAll('.is-over').forEach((z) => z.removeClass('is-over'));
    this.contentEl.querySelectorAll('.a4pl-drop-line').forEach((l) => l.remove());
  }

  cancelDrag() {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.clearMarks();
    if (d.ghost) d.ghost.remove();
    if (d.row) d.row.removeClass('is-lifted');
    if (this.pendingRender) this.render();
  }

  async onPointerUp() {
    const d = this.drag;
    if (!d) return;
    this.cancelDrag();
    if (!d.live || !d.zone) return;
    d.row._dragged = true; window.setTimeout(() => { d.row._dragged = false; }, 50);
    const today = this.today();
    const zone = d.zone;
    const toPool = zone.dataset.drop === 'pool';
    const day = toPool ? null : /** @type {string} */ (zone.dataset.day);
    const onMonth = zone.dataset.drop === 'mday';
    if (onMonth && d.item && day === d.item.plannedDay) return; // Month has no drop line: a nudge on its own day is not a move
    const half = toPool ? null : onMonth ? monthDropHalf(d) : (zone.dataset.half || null);
    try {
      if (d.ev) {
        await this.plugin.createTask({ title: d.ev.summary, day, half, details: eventDetails(d.ev), time: d.ev.allDay ? null : d.ev.time }, this.items);
        await this.plugin.markEventMade(d.ev, today);
        new Notice(day ? `Task made for ${moveLabel(day, half, today)}` : 'Task made, in Unscheduled');
      } else if (toPool) {
        await this.plugin.unscheduleTask(/** @type {PlanItem} */ (d.item));
      } else {
        const item = /** @type {PlanItem} */ (d.item); const to = /** @type {string} */ (day);
        const res = await this.plugin.moveTask(item, to, half, d.at || null, this.items);
        if (res) this.plugin.movedNotice(item, to, half, res, () => this.scheduleRender());
      }
    } catch (err) { console.error('[LifeWorld] drop failed', err); new Notice(String(errField(err, 'plain') || 'That did not work. Nothing was changed.')); }
    this.scheduleRender();
  }

  /* ---- Schedule popover --------------------------------------------------- */

  /** @param {PlanItem} it @param {HTMLElement} btn */
  openSchedule(it, btn) {
    const same = this.pop && this.pop.btn === btn;
    if (this.pop) this.pop.close(false);
    if (same) return;
    this.pop = new SchedulePopover(this, it, btn);
  }
}

class SchedulePopover {
  /** @param {PlannerView} view @param {PlanItem} it @param {HTMLElement} btn */
  constructor(view, it, btn) {
    this.view = view; this.it = it; this.btn = btn;
    const today = view.today();
    this.today = today;
    this.sel = it.plannedDay || today;
    this.month = this.sel.slice(0, 7);
    /** @type {string} */
    this.half = it.plannedHalf || 'am';
    this.el = document.body.createDiv({ cls: 'a4pl-pop' + (view.narrow ? ' is-narrow' : '') });
    this.el.setAttr('role', 'dialog'); this.el.setAttr('aria-label', 'Schedule ' + it.title);
    btn.addClass('is-open');
    openPopovers.add(this);
    /** @param {PointerEvent} e */
    this.away = (e) => { if (!this.el.contains(/** @type {Node} */ (e.target)) && !btn.contains(/** @type {Node} */ (e.target))) this.close(false); };
    document.addEventListener('pointerdown', this.away, true);
    this.onScroll = () => this.place();
    this.scroller = view.contentEl.querySelector('.a4pl-scroll');
    if (this.scroller) this.scroller.addEventListener('scroll', this.onScroll);
    this.el.addEventListener('keydown', (e) => this.onKey(e));
    this.draw();
    this.place();
    const first = /** @type {HTMLElement | null} */ (this.el.querySelector('.a4pl-pop-q'));
    if (first) first.focus();
  }

  close(restore = true) {
    document.removeEventListener('pointerdown', this.away, true);
    if (this.scroller) this.scroller.removeEventListener('scroll', this.onScroll);
    openPopovers.delete(this);
    this.el.remove();
    this.btn.removeClass('is-open');
    if (this.view.pop === this) this.view.pop = null;
    const key = this.btn.dataset.focus;
    if (this.view.pendingRender) this.view.render();
    if (restore && key) { const b = /** @type {HTMLElement | null} */ (this.view.contentEl.querySelector(`[data-focus="${CSS.escape(key)}"]`)); if (b) b.focus(); }
  }

  /** @param {KeyboardEvent} e */
  onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); return; }
    const target = /** @type {HTMLElement} */ (e.target);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && target.classList.contains('a4pl-pop-q')) {
      e.preventDefault();
      const q = /** @type {HTMLElement[]} */ ([...this.el.querySelectorAll('.a4pl-pop-q')]);
      const i = q.indexOf(target);
      q[(i + (e.key === 'ArrowDown' ? 1 : q.length - 1)) % q.length].focus();
    }
  }

  /** @param {() => Promise<unknown>} fn */
  async act(fn) {
    const view = this.view;
    this.close(false);
    try { await fn(); } catch (err) { console.error('[LifeWorld] schedule failed', err); new Notice(String(errField(err, 'plain') || 'That did not work. Nothing was changed.')); }
    view.scheduleRender();
    const key = /** @type {string} */ (this.btn.dataset.focus).replace(/^sched:/, 'row:').replace(/@.*$/, '');
    window.setTimeout(() => { const r = /** @type {HTMLElement[]} */ ([...view.contentEl.querySelectorAll('[data-focus]')]).find((x) => /** @type {string} */ (x.dataset.focus).startsWith(key + '@')); if (r) r.focus({ preventScroll: true }); }, 450);
  }

  /** @param {string} day @param {string | null} half */
  placeOn(day, half) {
    const { view, it } = this;
    this.act(async () => { const res = await view.plugin.moveTask(it, day, half, null, view.items); if (res) view.plugin.movedNotice(it, day, half, res, () => view.scheduleRender()); });
  }

  draw() {
    const { el, it, today } = this;
    el.empty();
    h(el, 'div', 'a4pl-pop-title', 'Schedule · ' + it.title);
    const tom = addDays(today, 1);
    for (const [label, d, half] of /** @type {[string, string, string | null][]} */ ([['Today morning', today, 'am'], ['Today afternoon', today, 'pm'], ['Tomorrow morning', tom, 'am'], ['Tomorrow afternoon', tom, 'pm'], ['Any time today', today, null]])) {
      const b = h(el, 'button', 'a4pl-pop-q');
      h(b, 'span', null, label);
      h(b, 'span', 'a4pl-pop-k', fmtDay(d, { weekday: 'short', day: 'numeric' }));
      b.addEventListener('click', () => this.placeOn(d, half));
    }
    // Someday (mockup approved 2026-10-06): no day, kept for later.
    if (!isSomeday(it)) {
      const sd = h(el, 'button', 'a4pl-pop-q a4pl-pop-someday');
      h(sd, 'span', null, 'Someday');
      h(sd, 'span', 'a4pl-pop-k', 'no day, kept for later');
      sd.addEventListener('click', () => { if (it.due) this.confirmSomeday(); else this.toSomeday(); });
    }
    h(el, 'div', 'a4pl-pop-sep');
    const mh = h(el, 'div', 'a4pl-mc-head');
    const pv = h(mh, 'button', 'a4pl-mc-nav'); setIcon(pv, 'chevron-left'); pv.setAttr('aria-label', 'Previous month');
    h(mh, 'span', null, fmtDay(`${this.month}-15`, { month: 'long', year: 'numeric' }));
    const nx = h(mh, 'button', 'a4pl-mc-nav'); setIcon(nx, 'chevron-right'); nx.setAttr('aria-label', 'Next month');
    pv.addEventListener('click', () => { this.month = shiftMonth(this.month, -1); this.draw(); });
    nx.addEventListener('click', () => { this.month = shiftMonth(this.month, 1); this.draw(); });
    const g = h(el, 'div', 'a4pl-mc'); g.setAttr('role', 'grid');
    for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) h(g, 'span', 'a4pl-mc-dw', d);
    for (const d of monthGrid(this.month)) {
      const b = h(g, 'button', (d.slice(0, 7) !== this.month ? 'is-out ' : '') + (d === today ? 'is-today ' : '') + (d === this.sel ? 'is-sel' : ''), String(partsOf(d).d));
      b.tabIndex = d === this.sel ? 0 : -1;
      b.setAttr('aria-label', fmtDay(d, { weekday: 'long', month: 'long', day: 'numeric' }));
      b.addEventListener('click', () => { this.sel = d; this.draw(); this.focusSel(); });
      b.addEventListener('keydown', (e) => {
        const mv = /** @type {Record<string, number>} */ ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 })[e.key];
        if (mv) { e.preventDefault(); this.sel = addDays(this.sel, mv); this.month = this.sel.slice(0, 7); this.draw(); this.focusSel(); }
        else if (e.key === 'Enter') { e.preventDefault(); this.placeOn(this.sel, this.half === 'any' ? null : this.half); }
      });
    }
    const seg = h(el, 'div', 'a4pl-seg a4pl-pop-seg');
    for (const [k, l] of [['am', 'Morning'], ['pm', 'Afternoon'], ['any', 'Any time']]) {
      const b = h(seg, 'button', this.half === k ? 'is-on' : '', l);
      b.addEventListener('click', () => { this.half = k; this.draw(); });
    }
    const pl = h(el, 'button', 'a4pl-pop-place', `Place on ${fmtDay(this.sel, { weekday: 'short', month: 'short', day: 'numeric' })}`);
    pl.addEventListener('click', () => this.placeOn(this.sel, this.half === 'any' ? null : this.half));
    if (it.plannedDay && !it.recurrenceRaw) {
      h(el, 'div', 'a4pl-pop-sep');
      const u = h(el, 'button', 'a4pl-pop-q');
      h(u, 'span', null, 'Unschedule'); h(u, 'span', 'a4pl-pop-k', 'back to list');
      u.addEventListener('click', () => this.act(async () => { await this.view.plugin.unscheduleTask(this.it); }));
    }
  }

  toSomeday() {
    const { view, it } = this;
    this.act(async () => {
      const w = await view.plugin.somedayTask(it);
      const text = it.due ? 'Moved to Someday. The due date was taken off.' : 'Moved to Someday';
      const u = w && w.undo;
      if (u) undoNotice(text, async () => { await u(); view.scheduleRender(); }); else new Notice(text);
    });
  }

  // A task with a due date asks first: Someday takes the due date off too.
  confirmSomeday() {
    const { el, it } = this;
    el.empty();
    h(el, 'div', 'a4pl-pop-title', 'Someday · ' + it.title);
    h(el, 'div', 'a4pl-pop-note', `Due ${fmtDay(/** @type {string} */ (it.due), { month: 'short', day: 'numeric' })}${it.time ? `, ${timeText(it.time)}` : ''}. Someday takes the due date off too, so it no longer sits on a day${it.time && it.reminder != null ? ' or rings' : ''}.`);
    const go = h(el, 'button', 'a4pl-pop-place', 'Move to Someday');
    go.addEventListener('click', () => this.toSomeday());
    const back = h(el, 'button', 'a4pl-pop-q');
    h(back, 'span', null, 'Keep the due date');
    back.addEventListener('click', () => { this.draw(); this.place(); const q = /** @type {HTMLElement | null} */ (this.el.querySelector('.a4pl-pop-q')); if (q) q.focus(); });
    this.place();
    go.focus();
  }

  focusSel() { const b = /** @type {HTMLElement | null} */ (this.el.querySelector('.a4pl-mc .is-sel')); if (b) b.focus(); }

  place() {
    const { el, btn, view } = this;
    if (!btn.isConnected) { this.close(false); return; }
    const b = btn.getBoundingClientRect();
    const f = view.contentEl.getBoundingClientRect();
    const w = el.offsetWidth, ht = el.offsetHeight;
    let left, top;
    if (view.narrow) { left = f.left + Math.max(8, (f.width - w) / 2); top = Math.max(8, Math.min(f.bottom - view.navbarOverlap(), window.innerHeight) - ht - 12); }
    else {
      left = Math.max(f.left + 8, Math.min(b.right - w, f.right - w - 8));
      top = b.bottom + 6;
      if (top + ht > window.innerHeight - 8) top = Math.max(8, b.top - ht - 6);
    }
    el.style.left = `${left}px`; el.style.top = `${top}px`;
  }
}

export default PlannerPlugin;
// Pure functions for tests/test-planner.js (same convention as a4-today's .logic).
PlannerPlugin.logic = { allUnscheduledFolded, projectMatches, projectToken, pickProjectText, unmatchedProjectWords, PROJECT_HITS_MAX, isSomeday, applySomeday, somedayOf, understand, quickAddChips, quickAddPlan, parseClock, timeOf, ruleTimeOf, halfOfTime, timeText, onDay, movedDate, untimedSlot, writeWithUndo, taskFromFrontmatter, priorityTable, priorityOf, groupUnscheduled, groupByArea, unscheduledOf, overdueOf, weeklyGoalsOf, laneOf, plannerItem, taskTitleOf, projectKeyOf, applyUnschedule, applyPlacement, applyMove, orderForInsert, planInsert, insertIndexOf, eventsForDay, eventKey, eventDetails, plannedFields, pruneMade, dueChipOf, monthGrid, shiftMonth, viewModeOf, monthDropHalf, moveLabel, mondayOf, weekOf, taskOnDay, isTaskDone, occursOn, parseRRule, sortByOrder, addDays, openProjectPage, REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords };
