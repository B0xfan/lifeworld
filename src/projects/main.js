/* Projects: Projects overview, project pages, the Inbox and the task card,
 * plus its own built-in task engine.
 *
 * Third-party code: the task engine's write plans and recurrence logic are
 * ported from TaskNotes (https://github.com/callumalpass/tasknotes) and
 * @tasknotes/model, Copyright 2025 Callum Alpass, MIT License. Full notice:
 * THIRD_PARTY_NOTICES.md.
 *
 * Built 2026-10-04 from an approved mockup.
 * Hand-written CommonJS; esbuild bundles it into the repo-root main.js (npm run build).
 * Will later merge with Today and Planner into the one public
 * "Lifeworld" plugin; the engine below is written to be lifted as is.
 *
 * Data (never a parallel model, GL-013 rule 1; fields: GL-002 ruling
 * "Built-in task engine and Projects", 2026-10-04):
 *  - Task notes in the tasks folder (and the finished tasks folder for the
 *    Done lists; both in Settings › Your vault), read and written EXACTLY as TaskNotes 4.12.5 writes them: same
 *    fields, values, key order and timestamp format. The write plans below
 *    are ports of TaskNotes' own code (TaskService.updateProperty,
 *    taskRecurringPlanning.buildRecurringTaskCompletePlan, TaskCreationService,
 *    AutoArchiveService), checked byte for byte against TaskNotes in a test
 *    Obsidian. Field names, statuses and folders come from TaskNotes'
 *    settings (a copy is kept so the engine still works once TaskNotes goes).
 *  - Task names (1.2.4 / Planner 1.0.3 / Projects 0.1.2, 2026-10-05): a task
 *    shows its stored `title` when it has one, else its file name
 *    (taskTitleOf, shared). Text only, never HTML.
 *  - 0.1.3 (2026-10-05): "Start or due?" key removed from project pages; the
 *    task card keeps the page's scroll when it redraws; the Blocked by /
 *    Blocks picker lists every open task (this project, then Other
 *    projects) in a list that scrolls.
 *  - Project notes (LifeWorld 0.1.4, 2026-10-17, mockup Option B): the project
 *    page's "Add a task" label is a Task / Note menu; a note is a dated ###
 *    entry added at the end of the project note's "## Notes" section
 *    (vault.process, add-only), and a Notes timeline sits under Progress.
 *  - 0.1.4 (2026-10-05, task times: mockup v3 + review, approved):
 *    Starts and Due take an optional clock time, written as TaskNotes writes
 *    it ('YYYY-MM-DDTHH:MM', wall-clock time, no zone). A date-and-time
 *    picker (hour and minutes wheels, AM/PM buttons, keyboard), typing boxes
 *    that read plain words with a live preview, quick add puts a typed time
 *    on Due. A due time sets planned_half (before 1 PM is Morning) and the
 *    When row then reads it out. A repeating task's time is its start time
 *    (DTSTART + scheduled). Moves keep the time within its half; into the
 *    other half it comes off, with Undo. Reminders: 0.2.0 below.
 *  - 0.1.5 (2026-10-05): public projectPathFor(ref) and
 *    openProjectPage(ref, { newTab }) so Today and Planner open a
 *    project's page from a project chip or task label (matched by name, as
 *    the page collects its tasks). openProjects/openProject take { newTab }.
 *  - 0.1.8 (2026-10-05): the quick add parser and its "Adds:" line are one
 *    SHARED quick add block (quickAddChips, quickAddPlan), copied verbatim
 *    into Planner 1.0.6 and the menu bar capture add-on 1.0.6 so all three read
 *    and save the same words the same way. No change in what Projects does.
 *  - 0.2.0 (2026-10-05, reminder setup mockup approved): a Reminder
 *    row in the date-and-time picker (None, At the time, 5/15/30 min, 1 hour,
 *    1 day, Other), a bell button next to Due on the task card ("4:15 PM ·
 *    15 min before", a dashed "No reminder", or "add a time to set a
 *    reminder"), and "At the time" for a new task with a time. Stored in
 *    TaskNotes' own `reminders` field and format (GL-002 "Task reminders").
 *    Apple Reminders rings (a separate sync); no
 *    plugin fires its own notification.
 *  - 0.3.0 (2026-10-06, Someday mockup approved; GL-002 task status
 *    `someday`): a "Someday" line in the Schedule box (a task with a due
 *    date asks first: the due date comes off too). Someday tasks leave the
 *    Inbox, Overdue and the project page's open list; a "Show someday tasks"
 *    tick box brings them back on the page. Giving one a day (Schedule, the
 *    When / Due / Starts boxes) makes it open again. A repeating task only
 *    changes status, so its repeat is untouched.
 *  - 0.6.0 (2026-10-08, "restore the circle"): links to a
 *    task note show TaskNotes' old inline task look again (status circle that
 *    ticks, priority dot, title, dates). See "Task links" below.
 *  - Start date = TaskNotes' `scheduled` (one-off tasks) or the rule's
 *    DTSTART (repeating tasks). Steps = top-level Markdown checkboxes in the
 *    note body. No new fields.
 *  - Project notes (type: project) in the projects folder (Settings › Your vault):
 *    sphere, status, goal, client, end_date, parent_area.
 *  - Areas (LifeWorld 0.1.5, 2026-10-18, mockup approved, GL-002 "Areas"): `type: area` notes in
 *    the same folder, ongoing, no status. A project sits in one through `parent_area`; a task's
 *    project link may point at an area (a loose task). Readers keyed on `type: project` leave areas out.
 *
 * Writes go through app.fileManager.processFrontMatter; only step
 * checkboxes (body lines) use vault.process, one checked line at a time.
 * Placing a task on a day uses applyPlacement, as Today and Planner do (the
 * SHARED block is a verbatim copy; tests/test-projects.js fails
 * if it ever differs).
 *
 * Where your tasks live (Settings, launch sections 5 and 5b, mockup v6): LifeWorld tasks (default,
 * the built-in engine), TaskNotes, checkbox lines in any note, ClickUp, Todoist, or Things 3 on a
 * Mac. One at a time (decision B). The last four are sources in src/core/sources.js (this.ext);
 * Today and the Planner read and write through it. Projects pages show checkbox tasks; with ClickUp,
 * Todoist or Things they keep LifeWorld's own task notes (not at launch, decided 2026-10-19).
 */
'use strict';

import { makeSource, isExtPath, thingsOffered, keyOf, setKey, cleanTag } from '../core/sources'; // where tasks live (launch sections 5, 5b)
import { Plugin, ItemView, MarkdownView, TFile, TFolder, Notice, setIcon, PluginSettingTab, Setting, Platform, SuggestModal, Modal, Component, getFrontMatterInfo, Keymap, MarkdownRenderer, Menu, parseYaml, stringifyYaml, editorInfoField, editorLivePreviewField } from 'obsidian';

/* ========================================================================== *
 * Constants
 * ========================================================================== */

const VIEW_TYPE = 'a4-projects';
const PLANNER_COMMAND = 'a4-planner:open'; // the old daily planner fallback was dropped 2026-10-05
const TODAY_COMMAND = 'a4-today:open';
const UNDO_MS = 5000;
const NARROW_WIDTH = 760;
const DONE_PREVIEW = 30;
const CLOSED_STATUSES = ['done', 'failed', 'dropped'];
const PROJECT_STATUSES = ['active', 'paused', 'waiting', 'blocked', 'backlog', 'done', 'failed', 'dropped', 'idea', 'cold-storage'];
// Shelved: not open and not closed; they live on the board's Ideas and Cold Storage tabs.
const SHELVED_STATUSES = ['idea', 'cold-storage'];
const OPEN_ORDER = { active: 0, paused: 1, waiting: 2, blocked: 3, backlog: 4 };
// The projects board's columns, in order (spec 5). Moves only go to these.
const BOARD_COLUMNS = ['backlog', 'active', 'waiting', 'paused', 'blocked', 'done'];
const COLUMN_LABEL = { backlog: 'Backlog', active: 'Active', waiting: 'Waiting', paused: 'Paused', blocked: 'Blocked', done: 'Done' };
const COLUMN_SUB = { backlog: 'Ready to start', active: 'Actively moving', waiting: 'Needs a response', paused: 'Active, but not for now', blocked: 'Waiting on something', done: 'Finished work' };
// Page title per board tab (mockup).
const BOARD_TITLE = { projects: 'What needs attention', ideas: 'Ideas worth keeping', cold: 'Projects paused for later', activity: 'What changed' };
// The tasks board (spec 14): the task statuses the vault already has, plus the planner's Someday. No new status.
const TASK_COLUMNS = ['open', 'in-progress', 'blocked', 'someday', 'done', 'closed'];
const TASK_COLUMN_LABEL = { open: 'Open', 'in-progress': 'In progress', blocked: 'Blocked', someday: 'Someday', done: 'Done', closed: 'Closed' };
const TASK_COLUMN_SUB = { open: 'Ready to do', 'in-progress': 'Being worked on', blocked: 'Stuck on something', someday: 'No day, kept for later', done: 'Finished', closed: 'Finished without doing it' };
const TASK_BOARD_TITLE = { projects: 'What needs doing', activity: 'What changed' };

/* Activity (spec 17): the board's history, in plugin data only, never in a
 * note. settings.activity = [{ at: ms, text: 'You moved X to Waiting.' }],
 * newest first, at most ACTIVITY_CAP; the Activity tab reads it as is. */
const ACTIVITY_CAP = 200;
function addActivity(list, text, at) { return [{ at, text }, ...(Array.isArray(list) ? list : [])].slice(0, ACTIVITY_CAP); }

/* ========================================================================== *
 * SHARED with a4-today and a4-planner (verbatim copies; do not edit here
 * without editing both the same way; the tests compare them character for
 * character)
 * ========================================================================== */

// The shared core (src/core/): one copy of the dates, list, reminder, quick add and task helpers.
import { pad2, dayOf, isDayStr, toDayStr, addDays, daysBetween, weekdayOf, partsOf, parseRRule, occursOn, MONTHS_SHORT, WEEKDAYS_SHORT, halfOfTime, timeText } from '../core/dates';
import { asList } from '../core/lists';
import { REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords } from '../core/reminders';
import { parseDayWord, repeatRule, understand, parseClock, whenValue, firstOccurrence, repeatWords, shortDay, halfWord, quickAddChips, quickAddPlan } from '../core/quickadd';
import { DEFAULT_COMPLETED_STATUSES, wikilinkTarget, wikilinkLabel, taskTitleOf, timeOf, ruleTimeOf, onDay, movedDate, untimedSlot, taskFromFrontmatter, isTaskDone, isOverdue, taskOnDay, isSomeday, applySomeday, sortByOrder, orderForInsert, applyMove, applyPlacement, applyUnschedule, blockerLinks, blockerHolds, openBlockersOf } from '../core/tasks';
import { partOf, ADDON } from '../core/parts'; // the other parts, and what an add-on handed LifeWorld (phase 2)
import { vaultFolders, planning, inTaskFolders, readable, writable, toNote, isRenamed } from '../core/vault'; // Settings › Your vault (phase 2 section 4)

/* ========================================================================== *
 * TaskNotes-compatible engine: configuration
 * Everything TaskNotes reads from its settings, with the owner's values (checked
 * in .obsidian/plugins/tasknotes/data.json on 2026-10-04) as the fallback.
 * ========================================================================== */

const DEFAULT_FIELDS = {
  title: 'title', status: 'status', priority: 'priority', due: 'due', scheduled: 'scheduled', contexts: 'contexts', projects: 'projects',
  timeEstimate: 'timeEstimate', completedDate: 'completedDate', dateCreated: 'dateCreated', dateModified: 'dateModified',
  recurrence: 'recurrence', recurrenceAnchor: 'recurrence_anchor', archiveTag: 'archived', completeInstances: 'complete_instances',
  skippedInstances: 'skipped_instances', googleCalendarExceptionOriginalScheduled: 'googleCalendarExceptionOriginalScheduled',
  googleCalendarMovedOriginalDates: 'googleCalendarMovedOriginalDates',
  blockedBy: 'blockedBy', // the shared readers (taskFromFrontmatter) read this name as is
  reminders: 'reminders', // likewise (reminderOf)
};
const DEFAULT_STATUS_LIST = [
  { value: 'none', label: 'None', isCompleted: false, autoArchive: false, autoArchiveDelay: 5 },
  { value: 'open', label: 'Open', isCompleted: false, autoArchive: false, autoArchiveDelay: 5 },
  { value: 'in-progress', label: 'In progress', isCompleted: false, autoArchive: false, autoArchiveDelay: 5 },
  { value: 'blocked', label: 'Blocked', isCompleted: false, autoArchive: false, autoArchiveDelay: 5 },
  { value: 'done', label: 'Done', isCompleted: true, autoArchive: true, autoArchiveDelay: 5 },
  { value: 'closed', label: 'Closed', isCompleted: true, autoArchive: false, autoArchiveDelay: 5 },
];
const DEFAULT_PRIORITY_LIST = [
  { value: 'none', label: 'None', weight: 0 }, { value: 'low', label: 'Low', weight: 1 },
  { value: 'normal', label: 'Normal', weight: 2 }, { value: 'high', label: 'High', weight: 3 },
];

// The fields Settings › Your vault › Property names covers (core/vault.js PROPS).
const TRANSLATED_FIELDS = ['title', 'status', 'priority', 'due', 'scheduled', 'projects', 'reminders', 'recurrence', 'completedDate', 'dateCreated', 'dateModified', 'completeInstances', 'skippedInstances', 'blockedBy'];
// TaskNotes settings (live object or saved copy) -> the engine's config.
function engineConfig(tn) {
  const s = tn && typeof tn === 'object' ? tn : {};
  const fm = s.fieldMapping && typeof s.fieldMapping === 'object' ? s.fieldMapping : {};
  const F = {};
  for (const k of Object.keys(DEFAULT_FIELDS)) F[k] = typeof fm[k] === 'string' && fm[k].trim() ? fm[k] : DEFAULT_FIELDS[k];
  // Property names changed in Settings › Your vault: the engine reads and writes task notes through
  // LifeWorld's own names (core/vault.js puts them back under the note's names), so those win.
  if (isRenamed()) for (const k of TRANSLATED_FIELDS) F[k] = DEFAULT_FIELDS[k];
  const statuses = Array.isArray(s.customStatuses) && s.customStatuses.length
    ? s.customStatuses.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: String(x.label || x.value), isCompleted: !!x.isCompleted, autoArchive: !!x.autoArchive, autoArchiveDelay: Number(x.autoArchiveDelay) || 0, order: Number(x.order) || 0 }))
    : DEFAULT_STATUS_LIST.map((x) => ({ ...x }));
  const priorities = Array.isArray(s.customPriorities) && s.customPriorities.length
    ? s.customPriorities.filter((x) => x && x.value != null).map((x) => ({ value: String(x.value), label: String(x.label || x.value), weight: Number(x.weight) || 0 }))
    : DEFAULT_PRIORITY_LIST.map((x) => ({ ...x }));
  const defaults = s.taskCreationDefaults && typeof s.taskCreationDefaults === 'object' ? s.taskCreationDefaults : {};
  return {
    F, statuses, priorities,
    // Settings › Your vault, the folders every part reads (TaskNotes' own folder settings are not used).
    tasksFolder: vaultFolders.tasks,
    archiveFolder: vaultFolders.archive,
    moveArchivedTasks: s.moveArchivedTasks !== false,
    taskTag: typeof s.taskTag === 'string' && s.taskTag ? s.taskTag : 'task',
    defaultStatus: typeof s.defaultTaskStatus === 'string' && s.defaultTaskStatus ? s.defaultTaskStatus : 'open',
    defaultPriority: typeof s.defaultTaskPriority === 'string' && s.defaultTaskPriority ? s.defaultTaskPriority : 'normal',
    storeTitleInFilename: s.storeTitleInFilename !== false,
    maintainDueOffset: s.maintainDueDateOffsetInRecurring === true,
    defaultTags: typeof defaults.defaultTags === 'string' ? defaults.defaultTags : '',
    defaultProjects: typeof defaults.defaultProjects === 'string' ? defaults.defaultProjects : '',
    defaultContexts: typeof defaults.defaultContexts === 'string' ? defaults.defaultContexts : '',
  };
}
// The parts of TaskNotes' settings worth keeping a copy of (no secrets).
function snapshotTaskNotes(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const k of ['fieldMapping', 'customStatuses', 'customPriorities', 'tasksFolder', 'archiveFolder', 'moveArchivedTasks', 'taskTag', 'defaultTaskStatus',
    'defaultTaskPriority', 'storeTitleInFilename', 'maintainDueDateOffsetInRecurring', 'taskIdentificationMethod', 'taskFilenameFormat']) if (s[k] !== undefined) out[k] = JSON.parse(JSON.stringify(s[k]));
  if (s.taskCreationDefaults) out.taskCreationDefaults = { defaultTags: s.taskCreationDefaults.defaultTags || '', defaultProjects: s.taskCreationDefaults.defaultProjects || '', defaultContexts: s.taskCreationDefaults.defaultContexts || '' };
  return out;
}
function isCompletedIn(cfg, status) { const s = cfg.statuses.find((x) => x.value === String(status)); return !!(s && s.isCompleted); }
function completedStatusesOf(cfg) { const l = cfg.statuses.filter((x) => x.isCompleted).map((x) => x.value); return l.length ? l : DEFAULT_COMPLETED_STATUSES; }
function firstCompletedStatus(cfg) { return completedStatusesOf(cfg)[0] || 'done'; }
function statusConfigOf(cfg, status) { return cfg.statuses.find((x) => x.value === String(status)) || null; }

/* ========================================================================== *
 * TaskNotes-compatible engine: dates (dateUtils.ts / @tasknotes/model date)
 * ========================================================================== */

// getCurrentTimestamp(): local wall time with milliseconds and the offset.
function tnTimestamp(now) {
  const off = -now.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const p = (n) => String(Math.abs(n)).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}T${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
}
// getDatePart(): the calendar-day part of a stored date or date-time.
function tnDatePart(v) {
  if (v == null || v === '') return '';
  const t = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const i = t.indexOf('T');
  if (i > -1) return t.slice(0, i);
  const sp = t.indexOf(' ');
  if (sp > -1 && /^\d{4}-\d{2}-\d{2}$/.test(t.slice(0, sp))) return t.slice(0, sp);
  return toDayStr(t) || '';
}
function strList(v) { return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
function nonEmpty(v) { return v == null || v === '' ? undefined : (typeof v === 'string' ? v : (v instanceof Date ? dayOf(v) : String(v))); }

/* ========================================================================== *
 * TaskNotes-compatible engine: recurrence (ports of @tasknotes/model
 * recurrence.js and taskRecurringPlanning.ts; the rule itself is read by the
 * shared parseRRule/occursOn, cross-checked against the rrule package)
 * Days are 'YYYY-MM-DD' strings standing for TaskNotes' UTC-midnight dates.
 * Ported from TaskNotes / @tasknotes/model, Copyright 2025 Callum Alpass,
 * MIT License; see THIRD_PARTY_NOTICES.md.
 * ========================================================================== */

// The recurring-relevant part of a task note, as TaskNotes' TaskInfo holds it.
function tnTaskOf(fm, F) {
  const f = fm || {};
  return {
    recurrence: typeof f[F.recurrence] === 'string' && f[F.recurrence].trim() ? f[F.recurrence] : undefined,
    recurrence_anchor: f[F.recurrenceAnchor] === 'completion' ? 'completion' : (f[F.recurrenceAnchor] ? String(f[F.recurrenceAnchor]) : undefined),
    scheduled: nonEmpty(f[F.scheduled]),
    due: nonEmpty(f[F.due]),
    dateCreated: nonEmpty(f[F.dateCreated]),
    complete_instances: strList(f[F.completeInstances]),
    skipped_instances: strList(f[F.skippedInstances]),
    googleCalendarExceptionOriginalScheduled: nonEmpty(f[F.googleCalendarExceptionOriginalScheduled]),
  };
}
// createRRule(): DTSTART from the rule, else scheduled, else dateCreated.
function ruleOfTask(task) {
  if (!task.recurrence) return null;
  const fallback = task.scheduled ? tnDatePart(task.scheduled) : (task.dateCreated ? tnDatePart(task.dateCreated) : null);
  return parseRRule(task.recurrence, fallback);
}
function explicitDtstart(rec) { const m = /DTSTART:(\d{4})(\d{2})(\d{2})/.exec(String(rec || '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; }
function intervalOf(rec) { const m = /INTERVAL=(\d+)/.exec(rec); return m ? parseInt(m[1], 10) : 1; }
function lookAheadDays(rec) {
  const i = intervalOf(rec);
  if (rec.includes('FREQ=DAILY')) return Math.max(30, i * 2);
  if (rec.includes('FREQ=WEEKLY')) return Math.max(90, i * 7 * 2);
  if (rec.includes('FREQ=MONTHLY')) return Math.max(400, i * 31 * 2);
  if (rec.includes('FREQ=YEARLY')) return Math.max(800, i * 366 * 2);
  return 365;
}
function searchDays(rec) {
  const m = /(?:^|;)INTERVAL=(\d+)(?:;|$)/.exec(rec); const i = m ? parseInt(m[1], 10) : 1;
  if (rec.includes('FREQ=DAILY')) return Math.max(30, i * 2);
  if (rec.includes('FREQ=WEEKLY')) return Math.max(90, i * 7 * 2);
  if (rec.includes('FREQ=MONTHLY')) return Math.max(400, i * 31 * 2);
  if (rec.includes('FREQ=YEARLY')) return Math.max(800, i * 366 * 2);
  return 365;
}
// generateRecurringInstances(): occurrence days in [start, end].
function instancesBetween(task, start, end) {
  const rule = ruleOfTask(task);
  if (!rule || end < start) return [];
  const out = [];
  let d = start < rule.dtstart ? rule.dtstart : start;
  for (; d <= end; d = addDays(d, 1)) if (occursOn(rule, d)) out.push(d);
  return out;
}
function nextScheduledBased(task, today) {
  const look = lookAheadDays(task.recurrence);
  const dt = explicitDtstart(task.recurrence);
  const start = dt && dt < today ? dt : today;
  const done = new Set([...task.complete_instances, ...task.skipped_instances]);
  for (const d of instancesBetween(task, start, addDays(today, look))) if (!done.has(d) && d >= today) return d;
  return null;
}
function nextCompletionBased(task, today) {
  const look = lookAheadDays(task.recurrence);
  const dt = explicitDtstart(task.recurrence);
  const start = dt || today;
  const skipped = new Set(task.skipped_instances);
  for (const d of instancesBetween(task, start, addDays(start, look))) if ((!dt || d > dt) && d >= today && !skipped.has(d)) return d;
  return null;
}
function nextUncompleted(task, today) {
  if (!task.recurrence) return null;
  return (task.recurrence_anchor || 'scheduled') === 'completion' ? nextCompletionBased(task, today) : nextScheduledBased(task, today);
}
// updateToNextScheduledOccurrence()
function nextDates(task, maintainOffset, today) {
  const next = nextUncompleted(task, today);
  let scheduled = null; let due = null; let nextDue = null;
  if (next) {
    const os = task.scheduled ? toDayStr(tnDatePart(task.scheduled)) : null;
    const od = task.due ? toDayStr(tnDatePart(task.due)) : null;
    if (os && od) {
      // TaskNotes compares the due day's midnight with the occurrence's own
      // time: with a clock time in DTSTART, a due on that same day counts as before it.
      const timed = /DTSTART:\d{8}T(?!000000)\d{6}/.test(task.recurrence);
      const dueBefore = !maintainOffset && (timed ? od <= next : od < next);
      if (maintainOffset || dueBefore) nextDue = addDays(next, daysBetween(os, od));
    }
    scheduled = task.scheduled && task.scheduled.includes('T') ? `${next}T${task.scheduled.split('T')[1]}` : next;
    if (nextDue && task.due && task.due.includes('T')) due = `${nextDue}T${task.due.split('T')[1]}`;
    else if (nextDue) due = nextDue;
  }
  return { scheduled, due };
}
// formatDtstartValue(): date-only -> YYYYMMDD; a date-time -> local clock + 'Z' (TaskNotes' own format).
function dtstartValue(s, parseLocal) {
  const t = String(s).trim();
  if (/T\d{2}:\d{2}/.test(t)) {
    const d = parseLocal ? parseLocal(t) : new Date(t);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}Z`;
  }
  return tnDatePart(t).replace(/-/g, '');
}
function addDtstart(task) {
  if (!task.recurrence) return null;
  if (task.recurrence.includes('DTSTART:')) return task.recurrence;
  const src = task.scheduled || task.dateCreated;
  if (!src) return null;
  return `DTSTART:${dtstartValue(src)};${task.recurrence}`;
}
function updateDtstart(rec, day) {
  if (!rec) return null;
  const v = dtstartValue(day);
  if (rec.includes('DTSTART:')) return rec.replace(/DTSTART:[^;]+;?/, `DTSTART:${v};`);
  return `DTSTART:${v};${rec}`;
}
function owningDay(task, target) {
  if ((task.recurrence_anchor || 'scheduled') === 'completion' || task.googleCalendarExceptionOriginalScheduled) return null;
  if (instancesBetween(task, target, target).includes(target)) return target;
  const done = new Set([...task.complete_instances, ...task.skipped_instances]);
  const past = instancesBetween(task, addDays(target, -searchDays(task.recurrence)), target);
  for (let i = past.length - 1; i >= 0; i--) if (!done.has(past[i])) return past[i];
  return nextUncompleted(task, target);
}
function moveScheduledTo(scheduled, day) {
  if (!scheduled) return day;
  const part = tnDatePart(scheduled);
  return `${day}${scheduled.slice(part.length)}`;
}
// TaskNotes' getRecurringTaskActionDate() with no explicit day.
function actionDay(task, today) {
  if (task.recurrence_anchor !== 'completion' && task.scheduled) return tnDatePart(task.scheduled);
  return today;
}

// buildRecurringTaskCompletePlan() + applyRecurringTaskCompleteFrontmatterChange().
// Mutates fm; returns { day, done } (the instance and its new state).
function applyRecurringToggle(fm, cfg, opts) {
  const F = cfg.F;
  const task = tnTaskOf(fm, F);
  if (!task.recurrence) throw new Error('Task is not recurring');
  const today = opts.today;
  const target = opts.day || actionDay(task, today);
  const owning = owningDay(task, target);
  const dateStr = owning || target;
  const ci = task.complete_instances;
  const newComplete = !ci.includes(dateStr);
  const updated = { ...task };
  if (newComplete) { updated.complete_instances = ci.includes(dateStr) ? ci : [...ci, dateStr]; }
  else updated.complete_instances = ci.filter((d) => d !== dateStr);
  updated.skipped_instances = task.skipped_instances.filter((d) => d !== dateStr);
  const anchor = task.recurrence_anchor || 'scheduled';
  if (newComplete && typeof updated.recurrence === 'string') {
    if (anchor === 'completion') { const r = updateDtstart(updated.recurrence, dateStr); if (r) updated.recurrence = r; }
    else if (!updated.recurrence.includes('DTSTART:')) { const r = addDtstart(updated); if (r) updated.recurrence = r; }
  }
  const base = owning ? { ...updated, scheduled: moveScheduledTo(updated.scheduled, owning) } : updated;
  const floor = dateStr > today ? dateStr : today;
  const nd = nextDates(base, cfg.maintainDueOffset, floor);
  if (nd.scheduled) updated.scheduled = nd.scheduled;
  if (nd.due) updated.due = nd.due;
  // frontmatter
  if (!fm[F.completeInstances]) fm[F.completeInstances] = [];
  if (!fm[F.skippedInstances]) fm[F.skippedInstances] = [];
  const cur = strList(fm[F.completeInstances]);
  if (newComplete) { if (!cur.includes(dateStr)) fm[F.completeInstances] = [...cur, dateStr]; }
  else fm[F.completeInstances] = cur.filter((d) => d !== dateStr);
  fm[F.skippedInstances] = updated.skipped_instances || [];
  if (updated.recurrence !== task.recurrence) fm[F.recurrence] = updated.recurrence;
  if (updated.scheduled) fm[F.scheduled] = updated.scheduled;
  if (updated.due) fm[F.due] = updated.due;
  writeOptional(fm, F.googleCalendarExceptionOriginalScheduled);
  writeOptional(fm, F.googleCalendarMovedOriginalDates);
  fm[F.dateModified] = opts.stamp;
  return { day: dateStr, done: newComplete, next: updated.scheduled ? tnDatePart(updated.scheduled) : null };
}
// writeOptionalFrontmatterField() with the task's own current value.
function writeOptional(fm, key) {
  const v = fm[key];
  if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) { delete fm[key]; return; }
  fm[key] = v;
}

/* ========================================================================== *
 * TaskNotes-compatible engine: property writes (TaskService.updateProperty)
 * ========================================================================== */

function coerceStatus(s) { const l = String(s).toLowerCase(); return l === 'true' || l === 'false' ? l === 'true' : String(s); }
function statusString(v) { if (typeof v === 'boolean') return v ? 'true' : 'false'; if (typeof v === 'string') return v; if (typeof v === 'number') return String(v); return ''; }

// One property, TaskNotes' order of writes. Mutates fm.
function applyProperty(fm, cfg, prop, value, opts) {
  const F = cfg.F;
  const field = F[prop] || prop;
  const recurring = !!tnTaskOf(fm, F).recurrence;
  if (prop === 'status') {
    const st = statusString(value);
    fm[field] = coerceStatus(st);
    if (!recurring) {
      if (isCompletedIn(cfg, st)) fm[F.completedDate] = opts.day;
      else if (fm[F.completedDate]) delete fm[F.completedDate];
    }
  } else if (prop === 'due' && !value) {
    fm[field] = null; // kept empty, not removed: every task carries a Due row in Obsidian's hover (0.1.3)
  } else if (prop === 'scheduled' && !value) {
    delete fm[field];
  } else {
    fm[field] = value;
  }
  fm[F.dateModified] = opts.stamp;
  writeOptional(fm, F.googleCalendarExceptionOriginalScheduled);
  writeOptional(fm, F.googleCalendarMovedOriginalDates);
  return fm;
}

// toggleArchive(): archive tag and dateModified. Mutates fm.
function applyArchive(fm, cfg, archive, stamp) {
  const tag = cfg.F.archiveTag;
  if (!archive) {
    if (Array.isArray(fm.tags)) { const t = fm.tags.filter((x) => x !== tag); if (!t.length) delete fm.tags; else fm.tags = t; }
  } else {
    if (!fm.tags) fm.tags = []; else if (!Array.isArray(fm.tags)) fm.tags = [fm.tags];
    if (!fm.tags.includes(tag)) fm.tags.push(tag);
  }
  fm[cfg.F.dateModified] = stamp;
  return fm;
}

/* ---- reminders (TaskNotes' `reminders`; GL-002 "Task reminders") -------- */

// The clock time a task rings at, from what is stored: a one-off task's due
// time; a repeating task's start time (`scheduled`, else its DTSTART).
function ringTimeOf(fm) {
  if (!fm) return null;
  return ringField(fm) === 'scheduled' ? (timeOf(fm.scheduled) || ruleTimeOf(fm.recurrence)) : timeOf(fm.due);
}
// One entry in TaskNotes' format, as its quick reminders make it (no description).
function reminderEntry(field, before, idMs) { return { id: `rem_${idMs}`, type: 'relative', relatedTo: field, offset: offsetIso(before) }; }
// The reminder on the ringing field: minutes before (0 = at the time) or null
// (none). Other entries (absolute ones, the other field) stay as found. The
// key goes when the list is empty, as TaskNotes does. -> true when changed.
function applyReminder(fm, F, before, idMs) {
  const key = F.reminders || 'reminders';
  const field = ringField(fm);
  const list = asList(fm[key]);
  const ours = (r) => !!r && typeof r === 'object' && r.type === 'relative' && r.relatedTo === field && offsetMinutes(r.offset) != null;
  const mine = list.filter(ours);
  if (before == null ? !mine.length : (mine.length === 1 && offsetMinutes(mine[0].offset) === before)) return false;
  const keep = list.filter((r) => !ours(r));
  if (before != null) keep.push(reminderEntry(field, before, idMs));
  if (keep.length) fm[key] = keep; else delete fm[key];
  return true;
}
// A task that gets its first ringing time, with no choice made, rings "At the
// time" (default approved 2026-10-05). One that already had a time
// and no reminder keeps none.
function applyReminderDefault(fm, F, hadRing, idMs) {
  if (hadRing || !ringTimeOf(fm) || reminderOf(fm) != null) return false;
  return applyReminder(fm, F, 0, idMs);
}
// Repeat switched on or off: the reminder follows the field that rings.
function retargetReminders(fm, F, from, to) {
  const key = F.reminders || 'reminders';
  if (from === to || !Array.isArray(fm[key])) return;
  fm[key] = fm[key].map((r) => (r && typeof r === 'object' && r.type === 'relative' && r.relatedTo === from ? { ...r, relatedTo: to } : r));
}

/* ========================================================================== *
 * TaskNotes-compatible engine: new task notes (TaskCreationService)
 * ========================================================================== */

function stripControl(s) { return s.replace(/./g, (c) => { const n = c.charCodeAt(0); return n <= 31 || (n >= 127 && n <= 159) ? '' : c; }); }
function titleForStorage(s) { if (!s || typeof s !== 'string') return 'untitled'; const t = stripControl(s.trim().replace(/\s+/g, ' ')).trim(); return t.length ? t : 'untitled'; }
function titleForFilename(s) {
  if (!s || typeof s !== 'string') return 'untitled';
  const t = stripControl(s.trim().replace(/\s+/g, ' ')).replace(/[<>:"/\\|?*#[\]]/g, '').replace(/^\.+|\.+$/g, '').trim();
  return t.length ? t : 'untitled';
}
function sanitizeForFilename(s) {
  if (!s || typeof s !== 'string') return 'untitled';
  const t = stripControl(s.trim().replace(/\s+/g, ' ').replace(/[<>:"/\\|?*#[\]]/g, '')).replace(/^\.+|\.+$/g, '').trim();
  return t.length ? t : 'untitled';
}
function splitDefaults(v) { return String(v || '').split(',').map((x) => x.trim()).filter(Boolean); }
function normTag(t) { return String(t == null ? '' : t).trim().replace(/^#+/, ''); }

// -> { folder, base, frontmatter (ordered object), body }. The caller picks
// the unique filename (name, name-2, name-3 ...) and stringifies the YAML.
function planCreate(input, cfg, stamp, today) {
  const F = cfg.F;
  const raw = String(input.title || '').trim();
  if (!raw) throw new Error('Title is required');
  const title = titleForStorage(raw);
  const fileTitle = cfg.storeTitleInFilename ? titleForFilename(raw) : title;
  const priority = input.priority || cfg.defaultPriority;
  const status = input.status || cfg.defaultStatus;
  const recurrence = input.recurrence || undefined;
  const completedDate = !recurrence ? (isCompletedIn(cfg, status) ? today : undefined) : undefined;
  const contexts = input.contexts || (cfg.defaultContexts ? splitDefaults(cfg.defaultContexts) : []);
  const projects = input.projects || (cfg.defaultProjects ? splitDefaults(cfg.defaultProjects) : []);
  let tags = (input.tags || (cfg.defaultTags ? splitDefaults(cfg.defaultTags) : [])).map(normTag).filter(Boolean);
  const taskTag = normTag(cfg.taskTag);
  if (taskTag && !tags.includes(taskTag)) tags = [taskTag, ...tags];
  const data = {
    title, status, priority, due: input.due || undefined, scheduled: input.scheduled || undefined,
    contexts: contexts.length ? contexts : undefined, projects: projects.length ? projects : undefined,
    dateCreated: stamp, dateModified: stamp, recurrence, completedDate,
  };
  if (data.recurrence && !data.recurrence.includes('DTSTART:')) { const r = addDtstart(data); if (r) data.recurrence = r; }
  const fm = {};
  fm[F.title] = title; // removed below when the filename carries the title
  fm[F.status] = coerceStatus(status);
  fm[F.priority] = priority;
  fm[F.due] = data.due !== undefined ? data.due : null; // always present, empty when undated (0.1.3)
  if (data.scheduled !== undefined) fm[F.scheduled] = data.scheduled;
  if (data.contexts) fm[F.contexts] = data.contexts;
  if (data.projects) fm[F.projects] = data.projects;
  if (data.completedDate !== undefined) fm[F.completedDate] = data.completedDate;
  if (data.recurrence !== undefined) fm[F.recurrence] = data.recurrence;
  fm[F.dateCreated] = stamp;
  fm[F.dateModified] = stamp;
  if (Array.isArray(input.reminders) && input.reminders.length) fm[F.reminders || 'reminders'] = input.reminders; // TaskNotes writes them right before the tags
  fm.tags = tags;
  const custom = input.customFrontmatter && typeof input.customFrontmatter === 'object' ? input.customFrontmatter : {};
  for (const k of Object.keys(custom)) fm[k] = custom[k];
  const body = input.details ? String(input.details).trim().replace(/\r\n/g, '\n').trimEnd() : '';
  return { folder: cfg.tasksFolder, base: sanitizeForFilename(fileTitle), fileTitle, title, frontmatter: fm, body };
}
// Final file text once the unique name is known.
function createContent(plan, uniqueName, cfg, stringify) {
  const fm = { ...plan.frontmatter };
  const represented = cfg.storeTitleInFilename && uniqueName === plan.fileTitle && plan.title === plan.fileTitle;
  if (represented) delete fm[cfg.F.title];
  let content = `---\n${stringify(toNote(fm))}---\n\n`;
  if (plan.body.length > 0) content += `${plan.body}\n`;
  return content;
}

/* ========================================================================== *
 * Reading tasks and projects for the views (pure)
 * ========================================================================== */

function projectKeyOf(link) {
  const t = wikilinkTarget(link);
  return t ? (t.split('#')[0].split('/').pop().replace(/\.md$/i, '').trim() || null) : null;
}

// A task for Projects: the shared reader's fields plus what Projects shows.
// Archived notes are read too (they fill the Done lists).
function readTask(fm, path, basename, cfg, inArchive) {
  if (!fm || typeof fm !== 'object') return null;
  const tags = asList(fm.tags).map(String);
  if (!tags.includes(cfg.taskTag)) return null;
  const archived = !!inArchive || fm.archived === true || tags.includes(cfg.F.archiveTag);
  const view = archived ? { ...fm, archived: false, tags: tags.filter((t) => t !== cfg.F.archiveTag) } : fm;
  const it = taskFromFrontmatter(view, archived ? `${vaultFolders.tasks}/${basename}.md` : path, basename);
  if (!it) return null;
  it.path = path;
  it.archived = archived;
  it.title = taskTitleOf(fm, basename, cfg.F.title); // TaskNotes' field name for the title
  const links = asList(fm[cfg.F.projects]);
  it.projectLink = links.length ? String(links[0]) : null;
  it.projectKey = projectKeyOf(links[0]);
  it.priority = fm[cfg.F.priority] == null ? '' : String(fm[cfg.F.priority]);
  it.completedDate = toDayStr(fm[cfg.F.completedDate]);
  it.dateCreated = toDayStr(fm[cfg.F.dateCreated]);
  it.modified = toDayStr(fm[cfg.F.dateModified]);
  // Start: `scheduled` for a one-off task; the rule's DTSTART for a repeating one.
  it.start = it.recurrenceRaw ? (explicitDtstart(it.recurrenceRaw) || null) : toDayStr(fm[cfg.F.scheduled]);
  it.scheduled = toDayStr(fm[cfg.F.scheduled]);
  // Clock times (TaskNotes' 'YYYY-MM-DDTHH:MM'): Due's, and Starts' (a repeating task's start time is its time).
  it.dueTime = it.recurrenceRaw ? timeOf(fm[cfg.F.due]) : timeOf(view.due); // not it.time: none on a planned day away from Due
  it.startTime = it.recurrenceRaw ? it.time : timeOf(fm[cfg.F.scheduled]);
  // The reminder as stored, also while there is no time to ring at (it rings again once one comes back).
  it.reminderSet = reminderOf(fm);
  return it;
}

function isOpenTask(t, cfg) { return t.recurrenceRaw ? !isCompletedIn(cfg, t.status) : !isCompletedIn(cfg, t.status); }
function isLaterTask(t, today) { return !t.recurrenceRaw && !!t.start && t.start > today && !isSomeday(t); }
// The shared rule (isOverdue): a one-off, unfinished task on a past day (due or planned).
function isOverdueTask(t, today, cfg) { return !t.archived && isOverdue(t, today, completedStatusesOf(cfg)); }
function isInboxTask(t, cfg) { return !t.archived && !t.recurrenceRaw && !t.projectLink && !t.plannedDay && !isSomeday(t) && isOpenTask(t, cfg); }

function priorityWeight(value, cfg) { const p = cfg.priorities.find((x) => x.value === String(value)); return p ? p.weight : (String(value) === '' ? 0 : -1); }

// Mockup's order for open tasks: overdue first, then priority, then the day it
// sits on (no day last), then A to Z.
// Blocked tasks (a blocker still open) go below the ones that can be done now.
function isBlockedTask(t) { return !!(t && t.openBlockers && t.openBlockers.length); }
function sortOpenTasks(list, today, cfg) {
  return [...list].sort((a, b) => (isBlockedTask(a) - isBlockedTask(b)) || (isOverdueTask(b, today, cfg) - isOverdueTask(a, today, cfg))
    || priorityWeight(b.priority, cfg) - priorityWeight(a.priority, cfg)
    || String(a.plannedDay || '9999').localeCompare(String(b.plannedDay || '9999'))
    || (!a.time - !b.time) || String(a.time || '').localeCompare(String(b.time || ''))
    || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
}

// parent_area as written: the first non-empty entry ('' and [] count as none, review s1 #2).
function areaLinkOf(v) { return asList(v).map(String).find((x) => x.trim()) || null; }
function sphereOfNote(fm) { const sp = typeof fm.sphere === 'string' ? fm.sphere.trim().toLowerCase() : ''; return sp === 'work' || sp === 'personal' ? sp : 'unsorted'; }
function readProject(fm, path, basename) {
  if (!fm || fm.type !== 'project') return null;
  return {
    path, name: basename, key: basename,
    sphere: sphereOfNote(fm),
    status: String(fm.status || '').trim().toLowerCase(),
    parentArea: areaLinkOf(fm.parent_area),
    goal: fm.goal ? String(asList(fm.goal)[0]) : null,
    client: fm.client ? String(asList(fm.client)[0]) : null,
    endDate: toDayStr(fm.end_date),
    why: typeof fm.why === 'string' ? fm.why.trim() : '',
    storedFrom: String(fm.stored_from || '').trim().toLowerCase(),
  };
}

// An area (GL-002 "Areas"): ongoing, no status; tasks find it by name, as they find a project.
function readArea(fm, path, basename) {
  if (!fm || fm.type !== 'area') return null;
  return {
    path, name: basename, key: basename, isArea: true, sphere: sphereOfNote(fm),
    goal: fm.goal ? String(asList(fm.goal)[0]) : null,
    client: fm.client ? String(asList(fm.client)[0]) : null,
  };
}
// Puts each project's area on it (area, areaName, areaPath). resolve(link, fromPath) -> the note's
// path or null. A link to a missing note or to anything but an area is no area: areaBad holds its
// text for the project page. Mutates and returns `projects`.
function linkAreas(projects, areas, resolve) {
  const byPath = new Map(areas.map((a) => [a.path, a]));
  for (const p of projects) {
    if (!p.parentArea) continue;
    const t = wikilinkTarget(p.parentArea);
    const a = t ? byPath.get(resolve(t.split('#')[0], p.path)) : null;
    if (a) Object.assign(p, { area: a.key, areaName: a.name, areaPath: a.path });
    else p.areaBad = wikilinkLabel(p.parentArea) || p.parentArea;
  }
  return projects;
}
// Areas for the Projects list: one sphere (or all) and the search, A to Z.
function areaList(areas, query, sphere) {
  const q = String(query || '').trim().toLowerCase();
  return areas.filter((a) => (!sphere || a.sphere === sphere) && (!q || a.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
// An area's page and card: its open projects (overview order), its finished ones (latest first),
// and its own loose tasks counted the way a project's are.
function areaStats(area, projects, tasks, today, cfg) {
  const mine = projects.filter((p) => p.area === area.key);
  const open = mine.filter(isOpenProject).sort((a, b) => ((OPEN_ORDER[a.status] ?? 5) - (OPEN_ORDER[b.status] ?? 5)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return { ...projectStats(area, tasks, today, cfg), openProjects: open, closedProjects: closedProjects(mine), inside: mine.map((p) => p.name) };
}
// "+ Add area": the note, as the form makes it. `client` is a note name (brackets optional); written
// through the YAML writer.
function areaNote(name, sphere, client, today, stringify) {
  const c = String(client || '').trim().replace(/^\[\[|\]\]$/g, '').trim();
  const y = c ? stringify({ client: `[[${c}]]` }).replace(/\n?$/, '\n') : '';
  return `---\ntype: area\ncreated: ${today}\nsphere: ${sphere}\n${y}---\n\n# ${name}\n`;
}
// Turn a project into an area and back (spec decision 6). false = refused (not that type, or a
// project still inside an area). Undo restores the whole note (writeWhole).
function applyToArea(fm) {
  if (!fm || fm.type !== 'project' || areaLinkOf(fm.parent_area)) return false;
  fm.type = 'area';
  for (const k of ['status', 'end_date', 'stored_from']) delete fm[k];
  return true;
}
function applyToProject(fm, goalLink) {
  if (!fm || fm.type !== 'area') return false;
  fm.type = 'project'; fm.status = 'active';
  if (goalLink) fm.goal = goalLink;
  return true;
}

function projectStats(project, tasks, today, cfg) {
  const all = tasks.filter((t) => t.projectKey === project.key);
  const open = all.filter((t) => isOpenTask(t, cfg) && !t.archived);
  return {
    total: all.length,
    done: all.filter((t) => !isOpenTask(t, cfg)).length,
    open: open.filter((t) => !isLaterTask(t, today) && !isSomeday(t)).length,
    later: open.filter((t) => isLaterTask(t, today)).length,
    someday: open.filter((t) => isSomeday(t)).length,
    overdue: open.filter((t) => isOverdueTask(t, today, cfg)).length,
    next: sortOpenTasks(open.filter((t) => !isLaterTask(t, today) && !isSomeday(t) && !isBlockedTask(t)), today, cfg)[0] || null,
  };
}

// Open = what the overview lists (active, paused, waiting, blocked, backlog, anything
// not closed or shelved). The one rule: the overview, the task pickers and the
// sidebar's counts all use it.
function isOpenProject(p) { return !!p && !CLOSED_STATUSES.includes(p.status) && !SHELVED_STATUSES.includes(p.status); }

// Overview lists: [{ sphere, label, projects }], active, paused, waiting, blocked, backlog, A to Z.
// `sphere` ('work' / 'personal', from the sidebar's Work / Personal items) keeps that list only.
function overviewGroups(projects, filter, query, sphere) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const [sp, label] of [['work', 'Work'], ['personal', 'Personal'], ['unsorted', 'Unsorted']]) {
    if (sphere && sp !== sphere) continue;
    const list = projects.filter((p) => p.sphere === sp && isOpenProject(p) && (filter === 'all' || p.status === filter) && (!q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => ((OPEN_ORDER[a.status] ?? 5) - (OPEN_ORDER[b.status] ?? 5)) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    if (list.length) out.push({ sphere: sp, label, projects: list });
  }
  return out;
}
// Projects board (spec 5): the six columns only; `area` keeps one sphere; the search
// looks at the name, the why and `extra` (description, next step).
function onBoard(p, area, query, extra) {
  const q = String(query || '').trim().toLowerCase();
  return !!p && BOARD_COLUMNS.includes(p.status) && (!area || p.sphere === area)
    && (!q || [p.name, p.why, ...(extra || [])].some((x) => String(x || '').toLowerCase().includes(q)));
}
// Tasks board column of a task status: none or blank sits in Open; a status the
// board has no column for shows nowhere (as a project with an unknown status).
function taskColumn(status) { const s = String(status == null ? '' : status).trim(); return s === '' || s === 'none' ? 'open' : TASK_COLUMNS.includes(s) ? s : null; }
// The columns this vault's task settings have (Someday is LifeWorld's own, always there).
function taskColumns(cfg) { return TASK_COLUMNS.filter((k) => k === 'someday' || cfg.statuses.some((x) => x.value === k)); }
// Tasks board cards: { t, p (its project or null), col }. An archived task that is
// still open is left out (as the List's task search). Area: the project's; a task
// with no project only when no area is chosen. Search: task or project name.
function taskBoardRows(tasks, projects, cfg, area, query) {
  const byKey = new Map(projects.map((p) => [p.key, p]));
  const q = String(query || '').trim().toLowerCase();
  const cols = taskColumns(cfg); // the tab count must match what the columns show
  return tasks.filter((t) => !t.archived || !isOpenTask(t, cfg))
    .map((t) => ({ t, p: (t.projectKey && byKey.get(t.projectKey)) || null, col: taskColumn(t.status) }))
    .filter((x) => cols.includes(x.col) && (!area || (x.p && x.p.sphere === area))
      && (!q || [x.t.title, x.p ? x.p.name : x.t.project].some((v) => String(v || '').toLowerCase().includes(q))));
}
// One column's cards: Done and Closed newest finished first, the latest DONE_PREVIEW
// (as the done preview); the others in the List's open-task order.
function taskColumnCards(rows, col, today, cfg) {
  if (col === 'done' || col === 'closed') {
    const day = (x) => x.t.completedDate || x.t.modified || '';
    return [...rows].sort((a, b) => day(b).localeCompare(day(a)) || a.t.title.localeCompare(b.t.title)).slice(0, DONE_PREVIEW);
  }
  const by = new Map(rows.map((x) => [x.t.path, x]));
  return sortOpenTasks(rows.map((x) => x.t), today, cfg).map((t) => by.get(t.path));
}

// A card's text as plain words: links show their name ([[a/B|C]] -> C, [[a/B]] -> B,
// [x](url) -> x), embeds go, backticks and bold/italic marks are taken off. For titles and
// "why" too, so it leaves line starts alone ("- 3 degrees"); firstBodyLine strips those.
function plainLine(text) {
  return String(text || '')
    .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\[([^\]]+)\]\]/g, (m, x) => wikilinkLabel(m) || x)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // shortcut: a URL with ( ) in it leaves a stray ), fine for a card
    .replace(/`+/g, '')
    .replace(/(\*\*|~~|==|\*)(\S(?:.*?\S)?)\1/g, '$2')
    .replace(/(^|[^\w])(__|_)(\S(?:.*?\S)?)\2(?![\w])/g, '$1$3') // _x_ only at word edges: snake_case stays
    .replace(/\s+/g, ' ').trim();
}
// A note's short description: its first body line that is not a heading, an embed or in a
// code block and has words left once cleaned (plainLine).
// Only real syntax is skipped: "#1 priority", "#beach" and "!important call" are text.
function firstBodyLine(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  let fence = false;
  for (const l of s.slice(frontmatterEnd(s)).split('\n')) {
    const t = l.trim();
    if (t.startsWith('```')) { fence = !fence; continue; } // code blocks (dataview etc.) are never the description
    if (fence || !t || /^#{1,6}(\s|$)/.test(t)) continue;
    // Quote, callout, bullet, number, checkbox off first: "- [ ] (x)" is a checkbox, not a link.
    const p = plainLine(t.replace(/^(?:>\s*)*(?:\[![^\]]*\][+-]?\s*)?(?:(?:[-*+]|\d+[.)])(?:\s+|$))?(?:\[[ xX/\-><!?*]\](?:\s+|$))?/, ''));
    if (p) return p;
  }
  return '';
}
// + Add idea (spec 11): the New Project form's note shape (the Quick Create add-on), status
// idea and no goal; the one line is the first body line. `why` (free text) goes
// through the YAML writer; the other values are fixed or checked by the caller.
// The one line is kept exactly as typed (spaces included); only line breaks become a
// space, so it stays one line, and the ends are trimmed.
function ideaNote(title, line, why, sphere, today, stringify) {
  const w = String(why || '').trim(), l = String(line || '').replace(/\r\n|\r|\n/g, ' ').trim();
  const y = w ? stringify({ why: w }).replace(/\n?$/, '\n') : '';
  return `---\ntype: project\nstatus: idea\ncreated: ${today}\nsphere: ${sphere}\n${y}---\n\n# ${title}\n\n${l ? `${l}\n` : ''}`;
}
// "Oct 12, 4:10 PM": card dates and Activity times.
function stampText(ms) { return new Date(ms).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' at ', ', '); }
function closedProjects(projects, query, sphere) {
  const q = String(query || '').trim().toLowerCase();
  return projects.filter((p) => CLOSED_STATUSES.includes(p.status) && (!sphere || p.sphere === sphere) && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || '')) || a.name.localeCompare(b.name));
}
// Tasks that belong to a project of one sphere (no sphere: all of them).
function sphereTasks(tasks, projects, sphere) {
  if (!sphere) return tasks;
  const keys = new Set(projects.filter((p) => p.sphere === sphere).map((p) => p.key));
  return tasks.filter((t) => t.projectKey && keys.has(t.projectKey));
}
const SPHERE_LABEL = { work: 'Work', personal: 'Personal', unsorted: 'Unsorted' };
// Task search (2+ characters): open tasks first, then done ones; at most `max`.
function searchTasks(tasks, query, cfg, max) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const fileName = (t) => String(t.path || '').split('/').pop().replace(/\.md$/i, '');
  const hit = tasks.filter((t) => t.title.toLowerCase().includes(q) || fileName(t).toLowerCase().includes(q) || String(t.project || '').toLowerCase().includes(q));
  return hit.sort((a, b) => (isOpenTask(b, cfg) - isOpenTask(a, cfg)) || a.title.localeCompare(b.title)).slice(0, max || 30);
}
// Find a task (mockup approved 2026-10-06): the Projects page search
// (searchTasks) over every task the page would list, Someday included.
function findTasks(tasks, query, cfg, max) {
  return searchTasks(tasks.filter((t) => !t.archived || !isOpenTask(t, cfg)), query, cfg, max || 50);
}
// The toast after Unschedule: Due comes off too, except with "Just plan it" (Settings › Planning).
function unscheduledText(t) { return !t.due ? 'Unscheduled' : (planning.setsDue ? 'Unscheduled. The due date was taken off' : 'Plan taken off. It stays on its due day'); }
// The grey line under a result: its project, then its day (or done / someday).
function findNote(t, today, cfg) {
  const proj = t.project || t.projectKey || 'no project';
  let when;
  if (!isOpenTask(t, cfg)) when = 'done';
  else if (isSomeday(t)) when = 'someday';
  else if (t.recurrenceRaw) when = repeatWords(t.recurrenceRaw).toLowerCase();
  else if (t.due) when = `due ${shortDay(t.due, today)}`;
  else if (t.plannedDay) when = shortDay(t.plannedDay, today);
  else if (t.start && t.start > today) when = `starts ${shortDay(t.start, today)}`;
  else when = 'no day';
  return `${proj} · ${when}`;
}
// Where the typed text sits in `text` (case ignored): [before, match, after], or null.
function findMark(text, query) {
  const s = String(text || ''); const q = String(query || '').trim();
  if (q.length < 2) return null;
  const i = s.toLowerCase().indexOf(q.toLowerCase());
  return i < 0 ? null : [s.slice(0, i), s.slice(i, i + q.length), s.slice(i + q.length)];
}
function doneGroups(tasks, cfg) {
  const done = tasks.filter((t) => !isOpenTask(t, cfg)); // a repeating task counts once its status is finished (series over)
  const day = (t) => t.completedDate || t.modified || '';
  done.sort((a, b) => day(b).localeCompare(day(a)) || a.title.localeCompare(b.title));
  return done.map((t) => ({ day: day(t), task: t }));
}

// Project status change -> the frontmatter writes (GL-002 end_date rule).
// stored_from lives only while the note is in cold storage (GL-002).
function applyProjectStatus(fm, status, today) {
  fm.status = status;
  if (CLOSED_STATUSES.includes(status)) { if (!fm.end_date) fm.end_date = today; }
  else if (fm.end_date != null) delete fm.end_date;
  if (status !== 'cold-storage' && fm.stored_from !== undefined) delete fm.stored_from;
  return fm;
}

// Board actions (projects board, section 4). Every one changes only these
// fields; fieldsOf/undoFields are the Undo.
const MOVE_FIELDS = ['status', 'end_date', 'stored_from', 'why', 'goal', 'parent_area'];
function fieldsOf(fm) { const o = {}; for (const k of MOVE_FIELDS) if (fm[k] !== undefined) o[k] = fm[k]; return o; }
// Undo puts a field back only while it still holds what the move wrote, so a
// later hand edit survives; returns the moved fields it left alone.
function undoFields(fm, before, after) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const kept = [];
  for (const k of MOVE_FIELDS) {
    if (!same(fm[k], after[k])) { if (!same(before[k], after[k])) kept.push(k); continue; }
    if (k in before) fm[k] = before[k]; else delete fm[k];
  }
  return kept;
}
function statusOf(fm) { return String((fm && fm.status) || '').trim().toLowerCase(); }
// Move to Cold Storage: remember the column it left; an empty answer keeps the old why.
// Storing twice (two dialogs) keeps the first column; a Done project keeps its finish date.
function applyColdStorage(fm, why, today) {
  const from = statusOf(fm), end = fm.end_date;
  applyProjectStatus(fm, 'cold-storage', today);
  if (from && from !== 'cold-storage') fm.stored_from = from;
  if (end != null && (from === 'done' || from === 'cold-storage')) fm.end_date = end;
  const w = String(why || '').trim();
  if (w) fm.why = w;
  return fm;
}
// Where Restore sends a note: its stored_from column, else Backlog.
function restoreTarget(fm) {
  const s = String((fm && fm.stored_from) || '').trim().toLowerCase();
  return BOARD_COLUMNS.includes(s) ? { status: s, fellBack: false } : { status: 'backlog', fellBack: true };
}
// The project page's status menu: an idea leaves only by Promote (goal asked), a
// stored project only by Restore (its saved column); nothing becomes an idea, and
// Cold Storage only from a board column. null = not offered. Same value: null.
function statusRoute(from, to, storedFrom) {
  if (from === to) return null;
  if (from === 'idea') return to === 'backlog' ? 'promote' : null;
  if (from === 'cold-storage') return to === restoreTarget({ stored_from: storedFrom }).status ? 'restore' : null;
  if (to === 'idea') return null;
  if (to === 'cold-storage') return BOARD_COLUMNS.includes(from) ? 'cold' : null;
  return 'write';
}
// The status menu's plain write: the note on disk decides, so a page drawn before the
// note was shelved cannot move it past Promote or Restore. false = refused.
function applyPlainStatus(fm, status, today) { return !SHELVED_STATUSES.includes(statusOf(fm)) && applyProjectStatus(fm, status, today); }
function applyRestore(fm, today) { const r = restoreTarget(fm); applyProjectStatus(fm, r.status, today); return r; }
function hasGoalLink(fm) { return asList(fm && fm.goal).some((g) => String(g).includes('[[')); }
// Promote an idea: Backlog, with the goal link when one was picked.
function applyPromote(fm, goalLink, today) {
  if (goalLink) fm.goal = goalLink;
  return applyProjectStatus(fm, 'backlog', today);
}

// A task's project link, written the way the menu bar capture add-on writes it.
function projectLinkFor(path) { return `[[${String(path).replace(/\.md$/i, '')}]]`; }
function applyProjectLink(fm, F, link) {
  const list = asList(fm[F.projects]).slice();
  if (link) { if (list.length) list[0] = link; else list.push(link); fm[F.projects] = list; }
  else { list.shift(); if (list.length) fm[F.projects] = list; else delete fm[F.projects]; }
  return fm;
}

/* ========================================================================== *
 * Steps: top-level Markdown checkboxes in the note body
 * ========================================================================== */

const STEP_RE = /^([-*+]) \[( |x|X)\] (.*)$/;
function frontmatterEnd(text) {
  if (!text.startsWith('---\n')) return 0;
  const i = text.indexOf('\n---', 4);
  if (i < 0) return 0;
  const nl = text.indexOf('\n', i + 4);
  return nl < 0 ? text.length : nl + 1;
}
// -> [{ line, done, text }] for unindented checkbox lines outside code blocks.
function readSteps(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const start = s.slice(0, frontmatterEnd(s)).split('\n').length - 1;
  const lines = s.split('\n');
  const out = [];
  let fence = false;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) { fence = !fence; continue; }
    if (fence) continue;
    const m = STEP_RE.exec(lines[i]);
    if (m) out.push({ line: i, done: m[2] !== ' ', text: m[3] });
  }
  return out;
}
function setStepDone(text, line, done) {
  const lines = String(text).split('\n');
  const m = STEP_RE.exec(lines[line] || '');
  if (!m) return null;
  lines[line] = `${m[1]} [${done ? 'x' : ' '}] ${m[3]}`;
  return lines.join('\n');
}
// New step after the last step; with no steps yet, first in the body.
function addStep(text, title) {
  const s = String(text || '');
  const clean = String(title).replace(/\s+/g, ' ').trim();
  if (!clean) return s;
  const steps = readSteps(s);
  const line = `- [ ] ${clean}`;
  if (steps.length) {
    const lines = s.split('\n');
    let at = steps[steps.length - 1].line + 1;
    while (at < lines.length && /^\s{2,}\S/.test(lines[at])) at++; // keep its indented lines with it
    lines.splice(at, 0, line);
    return lines.join('\n');
  }
  const end = frontmatterEnd(s);
  const head = s.slice(0, end);
  const body = s.slice(end).replace(/^(?:[ \t]*\n)+/, '');
  if (!body.trim()) return `${head}${head ? '\n' : ''}${line}\n`;
  return `${head}${head ? '\n' : ''}${line}\n\n${body}`;
}
// The step line and its indented continuation lines.
function stepBlock(lines, line) { let end = line + 1; while (end < lines.length && /^\s{2,}\S/.test(lines[end])) end++; return [line, end]; }
function moveStep(text, line, dir) {
  const lines = String(text).split('\n');
  const steps = readSteps(text);
  const i = steps.findIndex((x) => x.line === line);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= steps.length) return null;
  const a = stepBlock(lines, steps[Math.min(i, j)].line); const b = stepBlock(lines, steps[Math.max(i, j)].line);
  if (a[1] !== b[0]) return null; // only swap neighbours that touch
  const first = lines.slice(a[0], a[1]); const second = lines.slice(b[0], b[1]);
  lines.splice(a[0], b[1] - a[0], ...second, ...first);
  return lines.join('\n');
}
function removeStep(text, line) {
  const lines = String(text).split('\n');
  if (!STEP_RE.test(lines[line] || '')) return null;
  const [a, b] = stepBlock(lines, line);
  lines.splice(a, b - a);
  return lines.join('\n');
}

/* ---- Dates with a clock time (task times v3, approved 2026-10-05) --------- */

const CLOCK_RE = '(\\d{1,2}(?::\\d{2})?\\s?(?:am|pm|a\\.m\\.|p\\.m\\.)|\\d{1,2}:\\d{2}|noon|midnight)';

// The typing box next to Starts and Due, and the one in the date-and-time
// picker: "tomorrow at 4pm", "next wednesday afternoon", "oct 20 3:30pm",
// "noon", "tuesday 9". -> null (empty) | { error } | { day, time, half, ask, kept }.
//  - The clock time is cut first, then a half-day word, then the rest is the
//    day (parseDayWord, so "next tuesday" on a Monday is the Tuesday after).
//  - No day typed: the task's current day (cur.day), else today ("tonight": today).
//  - Only a day typed: the task keeps its clock time (kept: true), the same as
//    a move to another day.
//  - "tuesday 9" (a bare hour): the day is kept and saved; ask: true says to
//    add am or pm for a time.
//  - A clock time sets the half (before 1 PM is Morning). Starts takes no
//    half-day word: it means "not before then", with or without a time.
function parseWhen(text, today, cur, kind) {
  let s = ` ${String(text || '').toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim()} `;
  if (!s.trim()) return null;
  const c = cur || {};
  let time = null; let half = null; let tonight = false; let ask = false;
  const cutAt = (m) => { s = `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}`; };
  let m = new RegExp(`\\s(?:at\\s)?${CLOCK_RE}(?=\\s)`).exec(s);
  if (m) { time = parseClock(m[1]); if (!time) return { error: 'time' }; cutAt(m); }
  m = /\s(?:in the |this )?(morning|afternoon|evening|tonight)(?=\s)/.exec(s);
  if (m) { half = m[1] === 'morning' ? 'am' : 'pm'; tonight = m[1] === 'tonight'; cutAt(m); }
  let rest = s.replace(/\s+/g, ' ').trim().replace(/^on /, '').replace(/(?:^| )at$/, '').trim();
  let day = rest ? parseDayWord(rest, today) : null;
  if (rest && !day) {
    const b = /^(.*?)\s*(?:\bat )?(\d{1,2})$/.exec(rest);
    const before = b ? b[1].replace(/(?:^| )at$/, '').trim() : '';
    if (b && Number(b[2]) <= 24 && (!before || parseDayWord(before, today))) { day = before ? parseDayWord(before, today) : null; ask = true; rest = before; }
    else return { error: 'day' };
  }
  if (!day) day = tonight ? today : (c.day || today);
  let kept = false;
  if (!time && !half && c.time) { time = c.time; kept = true; }
  if (time) half = halfOfTime(time);
  if (kind === 'start' && half && !time) return { error: 'start-half' };
  return { day, time, half, ask, kept };
}

// "Thu, Oct 8" with "(today)" / "(tomorrow)", and the year when it isn't this one.
function dayLong(day, today) {
  const { m, d, y } = partsOf(day);
  const base = `${WEEKDAYS_SHORT[weekdayOf(day)]}, ${MONTHS_SHORT[m - 1]} ${d}${y !== Number(today.slice(0, 4)) ? ` ${y}` : ''}`;
  return base + (day === today ? ' (today)' : day === addDays(today, 1) ? ' (tomorrow)' : '');
}
function capHalf(h) { return h === 'am' ? 'Morning' : h === 'pm' ? 'Afternoon' : ''; }

// When a reminder rings: { day, time } moved `before` minutes earlier.
function ringAt(day, time, before) {
  const [h, mi] = time.split(':').map(Number);
  const total = h * 60 + mi - (Number(before) || 0);
  const dd = Math.floor(total / 1440); const m = total - dd * 1440;
  return { day: addDays(day, dd), time: `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}` };
}
// '4:15 PM', or 'Wed 4:30 PM' when it rings on another day than `day`.
function ringText(day, time, before) {
  const r = ringAt(day, time, before);
  return `${r.day !== day ? `${WEEKDAYS_SHORT[weekdayOf(r.day)]} ` : ''}${timeText(r.time)}`;
}
// "reminder at 4:15 PM (15 min before)" / "reminder at 4:30 PM" / "no reminder".
function reminderLine(day, time, before) {
  if (before == null) return 'no reminder';
  return `reminder at ${ringText(day, time, before)}${before ? ` (${reminderWords(before)})` : ''}`;
}

// The orange "what will be saved" line under a typing box and in the picker.
// Only a due time rings (and a repeating task's start time, each time).
// rem: the reminder that will be kept (minutes before, null = none); left out = at the time.
function whenPreview(r, kind, today, repeating, rem) {
  if (!r) return '';
  if (r.error === 'day') return "Didn't catch the day. Try: tomorrow at 4pm, next tuesday 9am, oct 20";
  if (r.error === 'time') return "Didn't catch the time. Try: 4pm, 9:30am, noon";
  if (r.error === 'start-half') return 'Starts takes a clock time (9am), not morning or afternoon';
  const due = kind === 'due';
  const before = rem === undefined ? 0 : rem;
  const parts = [`${due ? 'Due' : 'Starts'} ${dayLong(r.day, today)}${r.time ? `, ${timeText(r.time)}` : ''}`];
  if (due && r.time && repeating) parts.push(capHalf(halfOfTime(r.time)), "a repeating task rings at its start time");
  else if (due && r.time) parts.push(capHalf(halfOfTime(r.time)), reminderLine(r.day, r.time, before));
  else if (due && r.half) parts.push(`${capHalf(r.half)}, no set time`, 'no reminder');
  else if (due) parts.push('Any time', 'no reminder');
  else if (!due && r.time) parts.push(repeating ? (before == null ? 'no reminder' : `rings at ${ringText(r.day, r.time, before).replace(/^\w{3} /, '')}${before ? ` (${reminderWords(before)})` : ''} each time`) : 'no reminder (reminders ring at the due time)');
  if (r.ask) parts.push(r.time ? `keeps ${timeText(r.time)}; add am or pm to change it` : 'add am or pm for a time');
  return parts.join(' · ');
}
const REPEAT_PRESETS = [
  ['', "Doesn't repeat"], ['FREQ=DAILY', 'Every day'], ['FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 'Every weekday (Mon to Fri)'],
  ['FREQ=WEEKLY', 'Every week on this day'], ['FREQ=WEEKLY;INTERVAL=2', 'Every 2 weeks'], ['FREQ=MONTHLY', 'Every month on this date'], ['FREQ=YEARLY', 'Every year'],
];
function ruleBody(raw) { return String(raw || '').replace(/DTSTART(?:;[^:]*)?:[^;]+;?/i, '').replace(/^RRULE:/i, '').replace(/^;/, '').trim(); }

/* ---- small display helpers ----------------------------------------------- */
function longDay(day) { const { y, m, d } = partsOf(day); return `${MONTHS_SHORT[m - 1]} ${d}, ${y}`; }
function monthGrid(month) { const first = `${month}-01`; const mon = addDays(first, -((weekdayOf(first) + 6) % 7)); return Array.from({ length: 42 }, (_, i) => addDays(mon, i)); }
function shiftMonth(month, n) { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`; }
function monthTitle(month) { const [y, m] = month.split('-').map(Number); return `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}`; }
function nextMonday(today) { return addDays(today, ((8 - weekdayOf(today)) % 7) || 7); }

// Body of a project note for the page: frontmatter dropped, and the
// project-tasks list embed (this page already lists the tasks) left out.
function projectBodyForPage(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  let body = s.slice(frontmatterEnd(s));
  body = body.replace(/^[ \t]*!\[\[[^\]]*\.base(?:#[^\]]*)?\]\][ \t]*$/gm, '');
  body = body.replace(/^## Tasks[ \t]*\n(?:[ \t]*\n)*(?=## |$)/m, '');
  return body.replace(/\n{3,}/g, '\n\n').trim();
}

// Project notes (spec: project notes panel). The "## Notes" section of a project note: from the
// end of its heading line to the next # or ## heading (### entries stay inside), code blocks and
// frontmatter skipped. -> { start, end } character offsets, or null when the note has none.
function notesSectionRange(s) {
  const fm = frontmatterEnd(s);
  let pos = 0; let fence = false; let start = -1;
  for (const line of s.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && pos >= fm) {
      if (start < 0) { if (/^##[ \t]+Notes[ \t]*\r?$/i.test(line)) start = pos + line.length; }
      else if (/^#{1,2}[ \t]/.test(line)) return { start, end: pos };
    }
    pos += line.length + 1;
  }
  return start < 0 ? null : { start, end: s.length };
}
// The note text with a new dated entry as the last one under "## Notes" ("## Notes" added at the
// end when missing). Only adds text: every existing character stays where it was.
const NOTE_ESCAPE = /^(#{1,6}(?=\s|$)|```|~~~|%%|<!--|\$\$)/;
function appendProjectNote(text, day, note) {
  const s = String(text || '');
  // One line, as typed; a leading heading, code fence, comment or math opener is escaped with "\" so it
  // can't end the section or swallow the rest of the note (projectNotes drops the "\" again on read).
  const line = String(note || '').replace(/\s*\n\s*/g, ' ').trim().replace(NOTE_ESCAPE, '\\$1');
  const entry = `### [[${day}]]\n${line}`;
  const r = notesSectionRange(s);
  if (!r) return `${s}${s && !s.endsWith('\n') ? '\n' : ''}${s.trim() ? '\n' : ''}## Notes\n\n${entry}\n`;
  let at = r.end;
  while (at > r.start && /\s/.test(s[at - 1])) at--;
  return `${s.slice(0, at)}\n\n${entry}${at === s.length ? '\n' : ''}${s.slice(at)}`;
}
// The entries under "## Notes", newest first: one per ### heading, its date the first [[YYYY-MM-DD]]
// link in the heading, its text the rest of the heading, or (when that's empty) its first paragraph.
function projectNotes(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const r = notesSectionRange(s);
  if (!r) return [];
  const out = []; let cur = null; let fence = false;
  for (const line of s.slice(r.start, r.end).split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; continue; }
    const h = !fence && /^###[ \t]+(.*)$/.exec(line);
    if (h) {
      const d = /\[\[(\d{4}-\d{2}-\d{2})(?:\|[^\]]*)?\]\]/.exec(h[1]);
      cur = { day: d ? d[1] : '', title: (d ? h[1].replace(d[0], '') : h[1]).replace(/^[\s—–:-]+/, '').trim(), body: [] };
      out.push(cur);
    } else if (cur && !fence) cur.body.push(line.trim().replace(/^\\(?=#|```|~~~|%%|<!--|\$\$)/, ''));
  }
  const para = (b) => { const rest = b.slice(Math.max(0, b.findIndex(Boolean))); const j = rest.indexOf(''); return (j < 0 ? rest : rest.slice(0, j)).join(' '); };
  // File order is oldest first; newest first by date, same-day entries latest-added first, undated last.
  return out.map((e) => ({ day: e.day, text: e.title || para(e.body) })).reverse().sort((a, b) => b.day.localeCompare(a.day));
}
const NOTES_PREVIEW = 3;

// The "Blocked by" / "Blocks" picker on a task card. Every candidate is listed
// (no cap): the task's own project first (A to Z), then the other projects
// (by project name, then A to Z; Inbox tasks last). A search narrows both
// groups. Which rows are greyed out is decided by the caller, not here.
function depPickGroups(cands, projectKey, query) {
  const q = String(query || '').trim().toLowerCase();
  const az = (a, b) => String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });
  const hit = cands.filter((c) => !q || String(c.title).toLowerCase().includes(q));
  const mine = projectKey ? hit.filter((c) => c.projectKey === projectKey).sort((a, b) => az(a.title, b.title)) : [];
  const others = hit.filter((c) => !projectKey || c.projectKey !== projectKey)
    .sort((a, b) => (!a.projectKey) - (!b.projectKey) || az(a.project || a.projectKey, b.project || b.projectKey) || az(a.title, b.title));
  return { mine, others };
}

// The picker offers "Create task" when the typed text is not exactly (any case) a listed task's title.
// The task project pickers (task card, Inbox): "Areas" (A to Z), then "Projects" (`keep` filters
// and `order` sorts them). One Areas list on top reads clearer than a Work / Personal split. -> [{ label, notes }]
function projectPickGroups(notes, query, keep, order) {
  const q = String(query || '').trim().toLowerCase();
  const hit = (x) => !q || x.name.toLowerCase().includes(q);
  const areas = notes.filter((x) => x.isArea && hit(x)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const projects = notes.filter((x) => !x.isArea && keep(x) && hit(x)).sort(order);
  return [{ label: 'Areas', notes: areas }, { label: 'Projects', notes: projects }].filter((g) => g.notes.length);
}

// One picker row: the name, a check mark on the task's own project or area, and the status of a
// project that is waiting, blocked or in the backlog (no "area" or "paused" label).
function projectPickRow(host, p, currentKey, onPick) {
  const b = el(host, 'button', 'a4pj-pop-q'); el(b, 'span', null, p.name);
  if (p.key === currentKey) { b.setAttr('aria-current', 'true'); setIcon(el(b, 'span', 'a4pj-k a4pj-k-cur'), 'check'); } else if (!p.isArea && p.status !== 'active' && p.status !== 'paused') el(b, 'span', 'a4pj-k', p.status);
  b.addEventListener('click', () => onPick(p));
}

function depCreateOffer(query, listed) {
  const q = String(query || '').trim();
  return q && !listed.some((c) => String(c.title).trim().toLowerCase() === q.toLowerCase()) ? q : null;
}

const TEXT_TASK_CONFIRM_OVER = 20; // more lines than this in one go asks "Create N tasks?" first

const logic = {
  depPickGroups, depCreateOffer, projectPickGroups,
  engineConfig, snapshotTaskNotes, isCompletedIn, completedStatusesOf, tnTimestamp, tnDatePart, tnTaskOf, ruleOfTask, instancesBetween, nextUncompleted, nextDates,
  addDtstart, updateDtstart, owningDay, actionDay, applyRecurringToggle, applyProperty, applyArchive, planCreate, createContent, titleForFilename, titleForStorage,
  sanitizeForFilename, readTask, isOpenTask, isBlockedTask, blockerLinks, blockerHolds, openBlockersOf, isLaterTask, isOverdueTask, isInboxTask, isSomeday, applySomeday, sortOpenTasks, readProject, readArea, linkAreas, areaList, areaStats, areaNote, applyToArea, applyToProject, projectStats, overviewGroups, closedProjects, isOpenProject, sphereTasks,
  searchTasks, findTasks, findNote, findMark, doneGroups, applyProjectStatus, projectLinkFor,
  ACTIVITY_CAP, addActivity, normalizeSettings, BOARD_COLUMNS, onBoard, TASK_COLUMNS, taskColumn, taskColumns, taskBoardRows, taskColumnCards, firstBodyLine, plainLine, appendProjectNote, projectNotes, stampText, PROJECT_STATUSES, statusRoute, applyPlainStatus, ideaNote, fieldsOf, undoFields, statusOf, applyColdStorage, restoreTarget, applyRestore, hasGoalLink, applyPromote, applyProjectLink, readSteps, setStepDone, addStep, moveStep, removeStep, parseDayWord, understand, quickAddChips, quickAddPlan,
  repeatRule, repeatWords, firstOccurrence, ruleBody, parseClock, parseWhen, whenPreview, whenValue, dayLong, saveWhen, whenToast, whenPickerOpts, shortDay, monthGrid, shiftMonth, nextMonday, projectBodyForPage, projectKeyOf, priorityWeight,
  // shared (also exported by a4-today / a4-planner)
  timeOf, ruleTimeOf, halfOfTime, timeText, onDay, movedDate, untimedSlot,
  REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords,
  ringTimeOf, reminderEntry, applyReminder, applyReminderDefault, retargetReminders, ringAt, ringText, reminderLine, reminderAfter, parseReminderText,
  colorMap, linkDateText, taskLinkView, wikilinksIn, lineTaskTitle, lineTaskSkip, markAt, relocateLines, textTaskProject, selectedLines, TEXT_TASK_CONFIRM_OVER,
  parseRRule, occursOn, applyMove, orderForInsert, taskFromFrontmatter, taskTitleOf, isTaskDone, taskOnDay, sortByOrder, addDays, dayOf, toDayStr,
};

/* ========================================================================== *
 * The engine (Obsidian side): reads the vault, writes like TaskNotes
 * ========================================================================== */

class TaskEngine {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.busy = new Set();
    this.api = this.makeApi();
  }

  tn() { const p = this.app.plugins && this.app.plugins.plugins; return p ? p.tasknotes : null; }
  // TaskNotes' live settings when it is loaded, else the copy we kept.
  cfg() {
    const tn = this.tn();
    if (tn && tn.settings && tn.settings.fieldMapping) return engineConfig(tn.settings);
    return engineConfig(this.plugin.settings.tnSnapshot);
  }
  now() { return new Date(); }
  today() { return dayOf(this.now()); }
  stamp(d) { return tnTimestamp(d || this.now()); }
  file(path) { const f = this.app.vault.getAbstractFileByPath(path); return f instanceof TFile ? f : null; }
  // A note's frontmatter; a task note's under LifeWorld's property names (Settings › Your vault).
  fm(file) { const c = this.app.metadataCache.getFileCache(file); const fm = (c && c.frontmatter) || null; return file && inTaskFolders(file.path) ? readable(fm) : fm; }

  /* ---- reading ---------------------------------------------------------- */

  collectTasks(withArchive) {
    const cfg = this.cfg();
    const out = [];
    const walk = (folder, inArchive) => {
      for (const c of folder.children || []) {
        if (c instanceof TFolder) walk(c, inArchive);
        else if (c instanceof TFile && c.extension === 'md') {
          const cache = this.app.metadataCache.getFileCache(c);
          const t = readTask(readable(cache && cache.frontmatter), c.path, c.basename, cfg, inArchive);
          if (!t) continue;
          const items = (cache && cache.listItems) || [];
          const steps = items.filter((li) => li.task !== undefined && li.parent < 0);
          t.steps = { total: steps.length, done: steps.filter((li) => li.task !== ' ').length };
          t.openBlockers = !t.archived && t.blockedBy.length && isOpenTask(t, cfg) ? this.openBlockers(t) : [];
          out.push(t);
        }
      }
    };
    const root = this.app.vault.getAbstractFileByPath(cfg.tasksFolder);
    if (root instanceof TFolder) walk(root, false);
    if (withArchive) { const ar = this.app.vault.getAbstractFileByPath(cfg.archiveFolder); if (ar instanceof TFolder && ar.path !== root?.path) walk(ar, true); }
    return out;
  }

  // The projects folder in one walk: { projects (each with its area, linkAreas), areas }.
  collectNotes() {
    const projects = []; const areas = [];
    const root = this.app.vault.getAbstractFileByPath(vaultFolders.projects);
    if (!(root instanceof TFolder)) return { projects, areas };
    for (const c of root.children || []) {
      if (!(c instanceof TFile) || c.extension !== 'md') continue;
      const fm = this.fm(c);
      const p = readProject(fm, c.path, c.basename);
      if (p) { p.mtime = c.stat ? c.stat.mtime : 0; projects.push(p); continue; }
      const a = readArea(fm, c.path, c.basename);
      if (a) { a.mtime = c.stat ? c.stat.mtime : 0; areas.push(a); }
    }
    linkAreas(projects, areas, (link, from) => { const f = this.app.metadataCache.getFirstLinkpathDest(link, from); return f instanceof TFile ? f.path : null; });
    return { projects, areas };
  }
  collectProjects() { return this.collectNotes().projects; }
  collectAreas() { return this.collectNotes().areas; }
  // The project or area a task's projectKey names (tasks match by note name), or null.
  noteForKey(key) { if (!key) return null; const n = this.collectNotes(); return n.projects.find((p) => p.key === key) || n.areas.find((a) => a.key === key) || null; }

  isTaskFile(file) {
    if (!(file instanceof TFile) || file.extension !== 'md') return false;
    const cfg = this.cfg();
    const fm = this.fm(file);
    if (!fm || !asList(fm.tags).map(String).includes(cfg.taskTag)) return false;
    return file.path.startsWith(`${cfg.tasksFolder}/`) || file.path.startsWith(`${cfg.archiveFolder}/`);
  }

  /* ---- dependencies (TaskNotes' blockedBy; "Blocks" is computed) ------- */

  completedStatuses() { return completedStatusesOf(this.cfg()); }
  depField() { return this.cfg().F.blockedBy || 'blockedBy'; }
  // The task note a blockedBy link leads to (null when it leads nowhere).
  linkDest(link, sourcePath) { const f = this.app.metadataCache.getFirstLinkpathDest(link, sourcePath); return f instanceof TFile ? f : null; }
  linksOf(path) { const f = this.file(path); const fm = f ? this.fm(f) : null; return fm ? blockerLinks({ blockedBy: fm[this.depField()] }) : []; }
  // Blockers that still hold, for any item with .path and .blockedBy.
  openBlockers(item) { return openBlockersOf(this.app, item, this.completedStatuses()); }
  // For the card: every entry, finished or not; a link to a deleted note is listed as missing.
  blockerEntries(path) {
    const done = this.completedStatuses();
    return this.linksOf(path).map((link) => {
      const f = this.linkDest(link, path);
      if (!f) return { link, path: null, title: wikilinkLabel(`[[${link}]]`) || link, missing: true, holds: false };
      const fm = this.fm(f);
      return { link, path: f.path, title: taskTitleOf(fm, f.basename, this.cfg().F.title), missing: false, holds: blockerHolds(fm, f.path, done) };
    });
  }
  // Tasks whose blockedBy leads to `path` (the "Blocks" list), A to Z.
  waitingOn(path) {
    const done = this.completedStatuses();
    const out = [];
    for (const t of this.collectTasks(false)) {
      if (t.path === path) continue;
      if ((t.blockedBy || []).some((l) => { const f = this.linkDest(l, t.path); return f && f.path === path; })) {
        const fm = this.fm(this.file(t.path));
        out.push({ path: t.path, title: t.title, holds: blockerHolds(fm, t.path, done) });
      }
    }
    return out.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  }
  // Open tasks that wait on `path` and on nothing else still open: ticking `path` frees them.
  freedBy(path) {
    return this.collectTasks(false).filter((t) => isOpenTask(t, this.cfg()) && t.blockedBy && t.blockedBy.length)
      .filter((t) => { const ob = this.openBlockers(t); return ob.length === 1 && ob[0].path === path; });
  }
  // Would "waiting blocked by blocker" close a circle? Walks the blocker's own
  // blockers (all of them, finished or not); a loop already in the files ends the walk.
  wouldLoop(waitingPath, blockerPath) {
    if (waitingPath === blockerPath) return true;
    const seen = new Set();
    const walk = (p) => {
      if (p === waitingPath) return true;
      if (seen.has(p)) return false;
      seen.add(p);
      for (const l of this.linksOf(p)) { const f = this.linkDest(l, p); if (f && walk(f.path)) return true; }
      return false;
    };
    return walk(blockerPath);
  }
  // TaskNotes' entry for a new blocker, as its formatDependencyLink + serializeDependencies write it.
  depEntry(blockerFile, sourcePath) { return { uid: `[[${this.app.metadataCache.fileToLinktext(blockerFile, sourcePath, true)}]]`, reltype: 'FINISHTOSTART' }; }
  async addBlocker(waitingPath, blockerPath) {
    const bf = this.file(blockerPath);
    if (!bf || !this.file(waitingPath)) throw new Error('That task note is gone.');
    if (this.wouldLoop(waitingPath, blockerPath)) throw new Error("Can't: that would make a circle.");
    const F = this.depField(); const now = this.now();
    return this.write(waitingPath, (fm) => {
      const list = asList(fm[F]).slice();
      if (list.some((e) => { const l = blockerLinks({ blockedBy: [e] })[0]; const f = l ? this.linkDest(l, waitingPath) : null; return f && f.path === blockerPath; })) return false;
      list.push(this.depEntry(bf, waitingPath));
      fm[F] = list;
      fm[this.cfg().F.dateModified] = tnTimestamp(now);
      return true;
    });
  }
  // The picker's "Create task" row: a new task (the plugin's own create, so TaskNotes' or built-in
  // format, default status, nothing else) in projectPath, then linked as if picked. Undo takes both back.
  async createAndLink(t, mode, title, projectPath) {
    const input = { title };
    if (projectPath) input.projects = [projectLinkFor(projectPath)];
    const made = await this.plugin.createTask(input);
    const p = made && made.result && made.result.path;
    if (!p || !this.file(p)) throw new Error('The new task note was not found after creating it.');
    const link = mode === 'by' ? await this.addBlocker(t.path, p) : await this.addBlocker(p, t.path);
    return { result: made.result, undo: made.undo ? async () => { if (link && link.undo) await link.undo(); await made.undo(); } : null };
  }
  // Removes the entries that lead to blockerPath (or, for a deleted note, carry that link).
  async removeBlocker(waitingPath, blockerPath, link) {
    const F = this.depField(); const now = this.now();
    return this.write(waitingPath, (fm) => {
      const list = asList(fm[F]);
      const keep = list.filter((e) => {
        const l = blockerLinks({ blockedBy: [e] })[0];
        if (!l) return true;
        const f = this.linkDest(l, waitingPath);
        return blockerPath ? !(f && f.path === blockerPath) : !(l === link && !f);
      });
      if (keep.length === list.length) return false;
      if (keep.length) fm[F] = keep; else delete fm[F];
      fm[this.cfg().F.dateModified] = tnTimestamp(now);
      return true;
    });
  }

  /* ---- writing (each returns an undo function) --------------------------- */

  // Runs `fn` on the frontmatter and remembers what the touched keys held
  // before, so Undo can put them back through the frontmatter API too.
  // keepOrder: Undo also puts a removed key back in its old place (rename).
  async write(path, fn, keepOrder) {
    if (isExtPath(path)) throw new Error('This task lives outside a task note: change it where it lives.');
    const file = this.file(path);
    if (!file) throw new Error('That task note is gone.');
    let before = null; let result; let order = null;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      const copy = JSON.parse(JSON.stringify(fm));
      order = Object.keys(copy);
      result = writable(fm, fn);
      const keys = new Set([...Object.keys(copy), ...Object.keys(fm)]);
      before = {};
      for (const k of keys) if (JSON.stringify(copy[k]) !== JSON.stringify(fm[k])) before[k] = Object.prototype.hasOwnProperty.call(copy, k) ? { v: copy[k] } : null;
    });
    const undo = async () => {
      const f = this.file(path);
      if (!f) return;
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        for (const [k, b] of Object.entries(before || {})) { if (b) fm[k] = b.v; else delete fm[k]; }
        if (!keepOrder || !order) return;
        const now = { ...fm };
        for (const k of Object.keys(fm)) delete fm[k];
        for (const k of order) if (Object.prototype.hasOwnProperty.call(now, k)) fm[k] = now[k];
        for (const k of Object.keys(now)) if (!Object.prototype.hasOwnProperty.call(fm, k)) fm[k] = now[k];
      });
    };
    return { result, undo };
  }

  async complete(path) {
    const cfg = this.cfg();
    const fm0 = this.fm(this.file(path) || {});
    if (fm0 && isCompletedIn(cfg, statusString(fm0[cfg.F.status]))) return { result: null, undo: async () => {} };
    return this.setStatus(path, firstCompletedStatus(cfg));
  }
  async uncomplete(path) {
    const cfg = this.cfg();
    const fm0 = this.fm(this.file(path) || {});
    if (fm0 && !isCompletedIn(cfg, statusString(fm0[cfg.F.status]))) return { result: null, undo: async () => {} };
    return this.setStatus(path, cfg.defaultStatus);
  }
  async setStatus(path, status) {
    const cfg = this.cfg();
    const now = this.now();
    const w = await this.write(path, (fm) => applyProperty(fm, cfg, 'status', status, { day: dayOf(now), stamp: tnTimestamp(now) }));
    const prev = this.plugin.settings.archiveQueue.find((x) => x.taskPath === path);
    const queued = await this.plugin.archiveQueueOnStatus(path, status, cfg, now);
    // Undo puts back an auto-archive this change cancelled (e.g. a Done task moved out of Done).
    return { result: w.result, undo: async () => { await w.undo(); if (queued || prev) await this.plugin.cancelArchive(path, prev); } };
  }
  async setProperty(path, prop, value) {
    const cfg = this.cfg();
    const now = this.now();
    if (prop === 'status') return this.setStatus(path, value);
    return this.write(path, (fm) => applyProperty(fm, cfg, prop, value, { day: dayOf(now), stamp: tnTimestamp(now) }));
  }
  // Repeating task: tick one occurrence (no day = TaskNotes' current one).
  async toggleInstance(path, day) {
    const cfg = this.cfg();
    const now = this.now();
    const fm0 = this.fm(this.file(path) || {});
    if (fm0 && !ruleOfTask(tnTaskOf(fm0, cfg.F))) throw new Error("This task's repeat rule can't be read here.");
    return this.write(path, (fm) => applyRecurringToggle(fm, cfg, { day: day || null, today: dayOf(now), stamp: tnTimestamp(now) }));
  }
  // The overdue roll: the same write as Today's; with "Just plan it" a past plan comes along too.
  async move(path, day, half, order) {
    return this.write(path, (fm) => { applyMove(fm, day, half, order); if (!planning.setsDue && fm.planned_day && toDayStr(fm.planned_day) < day) fm.planned_day = day; });
  }
  // Someday (mockup approved 2026-10-06; GL-002 status `someday`):
  // shared applySomeday plus dateModified, as any status change. Undo puts
  // the removed due date back in its old place.
  async someday(path) {
    const cfg = this.cfg();
    const now = this.now();
    return this.write(path, (fm) => { applySomeday(fm); fm[cfg.F.dateModified] = tnTimestamp(now); }, true);
  }
  // The day comes off, Due too (0.1.16, as the Planner): the caller's toast offers Undo.
  async unschedule(path) {
    return this.write(path, (fm) => { applyUnschedule(fm, planning.setsDue); });
  }
  async setProject(path, projectPath) {
    const cfg = this.cfg();
    const now = this.now();
    return this.write(path, (fm) => { applyProjectLink(fm, cfg.F, projectPath ? projectLinkFor(projectPath) : null); fm[cfg.F.dateModified] = tnTimestamp(now); });
  }
  // Due date, with or without a clock time ('YYYY-MM-DD' / 'YYYY-MM-DDTHH:MM').
  // half: undefined leaves planned_half (a time sets it: before 1 PM is
  // Morning); 'am' / 'pm' sets it; null removes it (Any time).
  // reminder: minutes before (0 = at the time), null = none, undefined = the
  // default (a first time rings "At the time"; anything else stays as it is).
  async setDue(path, value, half, reminder) {
    const cfg = this.cfg();
    const now = this.now();
    return this.write(path, (fm) => {
      const had = ringTimeOf(fm);
      if (value && isSomeday(fm)) fm[cfg.F.status] = 'open'; // given a day: a normal task again
      applyProperty(fm, cfg, 'due', value || undefined, { day: dayOf(now), stamp: tnTimestamp(now) });
      const t = timeOf(value);
      if (t) fm.planned_half = halfOfTime(t);
      else if (half === 'am' || half === 'pm') fm.planned_half = half;
      else if (half === null && fm.planned_half != null) delete fm.planned_half;
      if (reminder === undefined) applyReminderDefault(fm, cfg.F, had, now.getTime());
      else if (ringTimeOf(fm)) applyReminder(fm, cfg.F, reminder, now.getTime());
    });
  }
  // The bell next to Due (or a repeating task's Starts): minutes before, or null for none.
  async setReminder(path, before) {
    const cfg = this.cfg();
    const now = this.now();
    return this.write(path, (fm) => { if (applyReminder(fm, cfg.F, before, now.getTime())) fm[cfg.F.dateModified] = tnTimestamp(now); });
  }
  // Start date, with or without a clock time. A repeating task's start is its
  // rule's DTSTART (TaskNotes writes a time there as the local clock + Z) and
  // its current occurrence (`scheduled`) carries the same time.
  async setStart(path, value, reminder) {
    const cfg = this.cfg();
    const fm0 = this.fm(this.file(path) || {}) || {};
    const rec = typeof fm0[cfg.F.recurrence] === 'string' && fm0[cfg.F.recurrence].trim() ? fm0[cfg.F.recurrence] : null;
    if (!rec && value && isSomeday(fm0)) { const now = this.now(); return this.write(path, (fm) => { fm[cfg.F.status] = 'open'; applyProperty(fm, cfg, 'scheduled', value, { day: dayOf(now), stamp: tnTimestamp(now) }); }); }
    if (!rec) return this.setProperty(path, 'scheduled', value || undefined);
    if (!value) throw new Error('A repeating task always has a first day.');
    const now = this.now();
    const t = timeOf(value);
    return this.write(path, (fm) => {
      const had = ringTimeOf(fm);
      if (isSomeday(fm)) fm[cfg.F.status] = 'open'; // a new start day brings a repeating someday task back
      fm[cfg.F.recurrence] = updateDtstart(fm[cfg.F.recurrence], value);
      const old = toDayStr(fm[cfg.F.scheduled]);
      const nd = nextDates(tnTaskOf({ ...fm, [cfg.F.scheduled]: old ? whenValue(old, t) : value }, cfg.F), cfg.maintainDueOffset, dayOf(now));
      fm[cfg.F.scheduled] = nd.scheduled || value;
      if (t) fm.planned_half = halfOfTime(t);
      if (reminder === undefined) applyReminderDefault(fm, cfg.F, had, now.getTime());
      else if (ringTimeOf(fm)) applyReminder(fm, cfg.F, reminder, now.getTime());
      fm[cfg.F.dateModified] = tnTimestamp(now);
    });
  }
  // rule = RRULE body (no DTSTART) or '' to stop repeating.
  async setRepeat(path, rule) {
    const cfg = this.cfg();
    const now = this.now();
    const today = dayOf(now);
    return this.write(path, (fm) => {
      const F = cfg.F;
      const from = ringField(fm);
      if (!rule) {
        delete fm[F.recurrence];
        if (fm[F.scheduled] != null) delete fm[F.scheduled]; // TaskNotes' "current occurrence" pointer, not a start
      } else {
        const cur = typeof fm[F.recurrence] === 'string' ? explicitDtstart(fm[F.recurrence]) : null;
        const from = cur || today;
        const first = firstOccurrence(rule, from);
        fm[F.recurrence] = `DTSTART:${first.replace(/-/g, '')};${rule}`;
        const nd = nextDates(tnTaskOf({ ...fm, [F.scheduled]: undefined }, F), cfg.maintainDueOffset, today);
        fm[F.scheduled] = nd.scheduled || first;
      }
      retargetReminders(fm, F, from, ringField(fm));
      fm[F.dateModified] = tnTimestamp(now);
    });
  }
  // New name for a task. The file takes the name (made safe for a file name,
  // as create does); the full text is kept in `title` only when the file name
  // could not carry it (a URL, a ":"), and a stale `title` is removed, so the
  // name shown is always the one typed. With "store title in file name" off,
  // only `title` changes. Undo puts back both the file name and `title`.
  async rename(path, title) {
    const file = this.file(path);
    if (!file) throw new Error('That task note is gone.');
    const cfg = this.cfg(); const F = cfg.F;
    const raw = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
    if (!raw) return null;
    const stored = titleForStorage(raw);
    const name = cfg.storeTitleInFilename ? sanitizeForFilename(titleForFilename(raw)) : file.basename;
    const fm0 = this.fm(file) || {};
    if (stored === taskTitleOf(fm0, file.basename, F.title)) return null; // the name it already shows
    const has = Object.prototype.hasOwnProperty.call(fm0, F.title);
    const keep = !cfg.storeTitleInFilename || name !== stored;
    const fmChange = keep ? !(has && fm0[F.title] === stored) : has;
    if (name === file.basename && !fmChange) return null;
    const old = file.path;
    const target = `${file.parent ? file.parent.path + '/' : ''}${name}.md`;
    if (name !== file.basename) {
      if (this.app.vault.getAbstractFileByPath(target)) throw new Error('Another task already has that name.');
      await this.app.fileManager.renameFile(file, target);
    }
    const w = fmChange ? await this.write(target, (fm) => { if (keep) fm[F.title] = stored; else delete fm[F.title]; fm[F.dateModified] = this.stamp(); }, true) : null;
    return { result: target, undo: async () => {
      if (w) await w.undo();
      const f = this.file(target);
      if (target !== old && f && !this.app.vault.getAbstractFileByPath(old)) await this.app.fileManager.renameFile(f, old);
    } };
  }

  async create(input) {
    const cfg = this.cfg();
    const now = this.now();
    // A new task with a time rings "At the time" unless a choice came with it (GL-002).
    const r0 = { due: input && input.due, scheduled: input && input.scheduled, recurrence: input && input.recurrence };
    if (input && input.reminders === undefined && ringTimeOf(r0)) input = { ...input, reminders: [reminderEntry(ringField(r0), 0, now.getTime())] };
    const plan = planCreate(input, cfg, tnTimestamp(now), dayOf(now));
    const folder = plan.folder;
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const exists = async (p) => !!this.app.vault.getAbstractFileByPath(p) || await this.app.vault.adapter.exists(p, false);
    let name = plan.base;
    if (await exists(`${folder}/${name}.md`)) {
      name = null;
      for (let i = 2; i <= 999; i++) if (!(await exists(`${folder}/${plan.base}-${i}.md`))) { name = `${plan.base}-${i}`; break; }
      if (!name) name = `${plan.base.substring(0, 50)}-${Date.now().toString(36)}`;
    }
    const path = `${folder}/${name}.md`;
    const content = createContent(plan, name, cfg, stringifyYaml);
    const file = await this.app.vault.create(path, content);
    return { result: { path: file.path, title: plan.title }, undo: async () => { const f = this.file(file.path); if (f) await this.app.fileManager.trashFile(f); } };
  }

  /* ---- steps (body checkboxes) ------------------------------------------ */

  async editBody(path, fn) {
    const file = this.file(path);
    if (!file) throw new Error('That task note is gone.');
    let before = null; let after = null;
    await this.app.vault.process(file, (text) => { const out = fn(text); if (out == null || out === text) return text; before = text; after = out; return out; });
    if (before == null) return { result: false, undo: async () => {} };
    return { result: true, undo: async () => { const f = this.file(path); if (f) await this.app.vault.process(f, (t) => (t === after ? before : t)); } };
  }
  async steps(path) { const f = this.file(path); return f ? readSteps(await this.app.vault.cachedRead(f)) : []; }
  toggleStep(path, line, done) { return this.editBody(path, (t) => setStepDone(t, line, done)); }
  addStep(path, title) { return this.editBody(path, (t) => addStep(t, title)); }
  moveStep(path, line, dir) { return this.editBody(path, (t) => moveStep(t, line, dir)); }
  removeStep(path, line) { return this.editBody(path, (t) => removeStep(t, line)); }

  /* ---- archive (AutoArchiveService.processItem + toggleArchive) --------- */

  async archive(path) {
    const cfg = this.cfg();
    const file = this.file(path);
    if (!file) return true;
    await this.app.fileManager.processFrontMatter(file, (raw) => writable(raw, (fm) => applyArchive(fm, cfg, true, tnTimestamp(this.now()))));
    if (!cfg.moveArchivedTasks || !cfg.archiveFolder) return true;
    const target = `${cfg.archiveFolder}/${file.name}`;
    if (!this.app.vault.getAbstractFileByPath(cfg.archiveFolder)) await this.app.vault.createFolder(cfg.archiveFolder);
    if (this.app.vault.getAbstractFileByPath(target)) { new Notice(`"${file.basename}" is done, but the archive already has a note with that name, so it stays where it is.`); return true; }
    await this.app.fileManager.renameFile(file, target);
    return true;
  }

  /* ---- the TaskNotes-shaped surface Today and Planner call -------- */

  makeApi() {
    const info = (path) => { const f = this.file(path); const fm = f ? this.fm(f) : null; const cfg = this.cfg(); return { path, status: fm ? statusString(fm[cfg.F.status]) : '', complete_instances: fm ? strList(fm[cfg.F.completeInstances]) : [] }; };
    // Frontmatter can read stale right after a write; return what we wrote.
    const after = async (path, run) => { await run(); return info(path); };
    return {
      apiVersion: 1,
      source: 'a4-projects',
      hasCapability: (c) => ['tasks.read', 'tasks.write', 'recurring.write'].includes(c),
      lifecycle: { isReady: () => true },
      tasks: {
        complete: (path) => after(path, () => this.complete(path)),
        uncomplete: (path) => after(path, () => this.uncomplete(path)),
        create: async (data) => { const r = await this.create(data || {}); return { ...info(r.result.path), path: r.result.path, title: r.result.title }; },
      },
      recurring: {
        toggleCompleteInstance: async (path, day) => {
          const r = await this.toggleInstance(path, day ? toDayStr(day) : null);
          const i = info(path);
          // The cache may lag the write by a moment: report the written list.
          const list = i.complete_instances.slice();
          if (r.result) { const has = list.includes(r.result.day); if (r.result.done && !has) list.push(r.result.day); if (!r.result.done && has) list.splice(list.indexOf(r.result.day), 1); }
          return { ...i, complete_instances: list };
        },
      },
    };
  }
}

/* ========================================================================== *
 * Plugin
 * ========================================================================== */

// "Where your tasks live", as drawn (mockup v6). Things only on a Mac (criterion 17).
const SOURCES = [
  { id: 'builtin', name: 'LifeWorld tasks', desc: 'One note per task. Works with the Projects pages, repeats and reminders.' },
  { id: 'tasknotes', name: 'TaskNotes plugin', desc: 'Your TaskNotes tasks. TaskNotes must be turned on.' },
  { id: 'checkbox', name: 'Checkboxes in your notes', desc: 'Plain "- [ ]" lines in any note. Also reads the Tasks plugin\'s dates (📅 due, ⏳ scheduled) and priorities.' },
  { id: 'clickup', name: 'ClickUp', desc: 'Your ClickUp tasks for today and overdue. Ticking one closes it in ClickUp.', key: ['ClickUp key', 'In ClickUp: your avatar › Settings › Apps › API Token.'] },
  { id: 'todoist', name: 'Todoist', desc: 'Your Todoist tasks for today and overdue. Ticking one closes it in Todoist.', key: ['Todoist key', 'In Todoist: Settings › Integrations › Developer › API token.'] },
  { id: 'things', name: 'Things 3', tag: 'Mac only', desc: 'Your Things to-dos for today and overdue. Only offered on a Mac.', mac: true },
];

function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    // A saved Things choice is kept on a phone (it syncs back to the Mac); the phone shows a short note instead.
    source: SOURCES.some((x) => x.id === s.source) ? s.source : 'builtin',
    cbTag: typeof s.cbTag === 'string' ? s.cbTag : '', // Checkboxes: "Only lines with this tag"
    cuList: typeof s.cuList === 'string' ? s.cuList : '', // ClickUp: the list new tasks go to
    hideProps: s.hideProps !== false,
    tnSnapshot: s.tnSnapshot && typeof s.tnSnapshot === 'object' ? s.tnSnapshot : null,
    archiveQueue: Array.isArray(s.archiveQueue) ? s.archiveQueue.filter((x) => x && typeof x.taskPath === 'string' && Number.isFinite(x.archiveAfterTimestamp)) : [],
    ui: {
      closedOpen: !!(s.ui && s.ui.closedOpen),
      doneOpen: s.ui && s.ui.doneOpen && typeof s.ui.doneOpen === 'object' ? s.ui.doneOpen : {},
      later: s.ui && s.ui.later && typeof s.ui.later === 'object' ? s.ui.later : {},
      someday: s.ui && s.ui.someday && typeof s.ui.someday === 'object' ? s.ui.someday : {},
      // Projects page switches (spec 4): today's List + Projects until picked otherwise.
      view: s.ui && s.ui.view === 'board' ? 'board' : 'list',
      kind: s.ui && (s.ui.kind === 'tasks' || s.ui.kind === 'areas') ? s.ui.kind : 'projects',
    },
    activity: Array.isArray(s.activity) ? s.activity.filter((e) => e && Number.isFinite(e.at) && typeof e.text === 'string').slice(0, ACTIVITY_CAP) : [],
  };
}

/* ========================================================================== *
 * Task links (0.6.0, 2026-10-08, owner request): every link to a task note
 * shows the task the way TaskNotes' inline task link did before TaskNotes was
 * switched off on 2026-10-05: a status circle (clickable: done / back to
 * open), the priority dot, the task's title and its dates. Look measured from
 * TaskNotes 4.12.5 in a test Obsidian (ring 0.85em, 1.5px border in the
 * status colour; priority dot 0.7em; done = filled ring, struck title, row at
 * 60%). Reading view: a markdown post-processor puts the widget in front of
 * the link and hides the link. Live Preview: a CodeMirror view plugin
 * replaces [[link]] with the widget unless the cursor is in it (as TaskNotes
 * did). A tick goes through completeTask, the same write as every tick.
 * Not on task notes themselves: there the task card is the only task UI and
 * links stay plain (2026-10-04).
 * ========================================================================== */

const LINK_STATUS_COLORS = { none: '#cccccc', open: '#ff5a2d', 'in-progress': '#0066cc', blocked: '#aa00aa', done: '#00aa00', closed: '#00aa00' };
const LINK_PRIORITY_COLORS = { none: '#cccccc', low: '#00aa00', normal: '#ffaa00', high: '#ff0000' };

// value -> colour from TaskNotes' status or priority list (its live settings or our copy).
function colorMap(list, fallback) {
  const out = { ...fallback };
  for (const x of Array.isArray(list) ? list : []) if (x && x.value != null && typeof x.color === 'string' && x.color) out[String(x.value)] = x.color;
  return out;
}

// "Due: Today", "Due: Oct 12", "Due: Oct 5 (overdue)", "Scheduled: Oct 12" (TaskNotes' wording).
function linkDateText(label, day, today, overdueOk) {
  if (!isDayStr(day)) return '';
  const { y, m, d } = partsOf(day);
  const words = day === today ? 'Today' : `${MONTHS_SHORT[m - 1]} ${d}${y !== Number(today.slice(0, 4)) ? `, ${y}` : ''}`;
  return `${label}: ${words}${overdueOk && day < today ? ' (overdue)' : ''}`;
}

// Everything the widget draws, from a readTask() item. Pure, for tests.
function taskLinkView(t, cfg, today, statusColors, priorityColors) {
  const done = t.recurrenceRaw ? t.completeInstances.includes(today) : isCompletedIn(cfg, t.status);
  const status = done && t.recurrenceRaw ? firstCompletedStatus(cfg) : t.status;
  const dates = [];
  if (t.due) dates.push(linkDateText('Due', t.due, today, !done));
  if (t.scheduled && !t.recurrenceRaw) dates.push(linkDateText('Scheduled', t.scheduled, today, false));
  return {
    done,
    statusColor: statusColors[status] || statusColors[cfg.defaultStatus] || 'var(--text-faint)',
    priorityColor: t.priority && priorityColors[t.priority] ? priorityColors[t.priority] : null,
    priorityLabel: t.priority ? ((cfg.priorities.find((p) => p.value === t.priority) || {}).label || t.priority) : '',
    dates: dates.filter(Boolean),
    recurring: !!t.recurrenceRaw,
  };
}

// The [[...]] links in a piece of text (not embeds): where, the link path, the alias.
function wikilinksIn(text, offset) {
  const out = [];
  const re = /\[\[([^[\]\n]+?)\]\]/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > 0 && text[m.index - 1] === '!') continue;
    const inner = m[1];
    const bar = inner.indexOf('|');
    const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
    const linkpath = target.split('#')[0].trim();
    if (!linkpath) continue;
    const alias = bar === -1 ? null : inner.slice(bar + 1).trim() || null;
    out.push({ from: (offset || 0) + m.index, to: (offset || 0) + m.index + m[0].length, linkpath, alias });
  }
  return out;
}

/* ---- text to task (right-click "Create task" on selected lines, 2026-10-16) ---- */

// A note line's task title: the words without the list, checkbox or quote marks in front, a
// trailing block id, or one trailing full stop. '' when nothing is left.
function lineTaskTitle(line) {
  return String(line || '')
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, '')
    .replace(/^\s*(?:>\s*)*/, '')
    .replace(/^(?:[-*+]|\d+[.)])\s+(?:\[[^\]]\](?:\s+|$))?/, '') // a checkbox only counts after a list mark
    .trim()
    .replace(/(?<!\.)\.$/, '')
    .trim();
}

// Why a line cannot become a task: 'heading' (marking it would rename the heading and break
// links to it; counted in the message), 'format' (blank, rule, table row, code fence, math or
// comment marks: nothing to name a task), or null when it can.
function lineTaskSkip(line) {
  const s = String(line || '');
  if (/^\s{0,3}(?:>\s*)*#{1,6}(?:\s|$)/.test(s)) return 'heading';
  if (/^\s*(?:>\s*)*(?:\||```|~~~)/.test(s)) return 'format';
  if (!/[\p{L}\p{N}]/u.test(lineTaskTitle(s))) return 'format';
  return null;
}

// Where the mark goes: the end of the line, or just before a trailing block id (Obsidian only
// reads ^id at the very end, so links to that line keep working).
function markAt(line) {
  const s = String(line || '');
  const m = /\s+\^[A-Za-z0-9-]+\s*$/.exec(s);
  return m ? m.index : s.length;
}

// Finds each wanted line in the note as it is now: the line with the same text nearest to where it
// was, each line used once. docLines: the note's lines; items: [{ line, text }]. -> line numbers, -1 = gone.
function relocateLines(docLines, items) {
  const used = new Set();
  return items.map((it) => {
    for (let d = 0; d < docLines.length; d++) {
      for (const l of d ? [it.line - d, it.line + d] : [it.line]) {
        if (l >= 0 && l < docLines.length && !used.has(l) && docLines[l] === it.text) { used.add(l); return l; }
      }
    }
    return -1;
  });
}

// Which project the new tasks go to. self: the note's own path when it is a project note;
// fmPaths: project notes its frontmatter project / projects / linked_projects name; linkPaths:
// every link from the note that leads to a project note, in note order, repeats kept.
// -> { project } when the note settles it, else { ask: true, candidates (most linked first),
// preselect (a path, or null for no project) }. lastPick: path or null, chosen earlier.
function textTaskProject({ self, fmPaths, linkPaths }, lastPick) {
  if (self) return { project: self };
  const fm = [...new Set(fmPaths || [])];
  if (fm.length === 1) return { project: fm[0] };
  const links = [...new Set(linkPaths || [])];
  if (!fm.length && links.length === 1) return { project: links[0] };
  const count = (p) => (linkPaths || []).filter((x) => x === p).length;
  const order = [...new Set([...fm, ...links])];
  const candidates = order.map((p, i) => ({ p, i, n: count(p) })).sort((a, b) => b.n - a.n || a.i - b.i).map((x) => x.p);
  return { ask: true, candidates, preselect: candidates.length ? candidates[0] : (lastPick || null) };
}

// The lines a selection covers, once each, top to bottom. A selection that ends at the very start
// of a line does not take that line; a bare cursor takes its own line.
function selectedLines(selections) {
  const out = new Set();
  for (const s of selections || []) {
    const a = s.anchor; const h = s.head || s.anchor;
    const [from, to] = a.line < h.line || (a.line === h.line && a.ch <= h.ch) ? [a, h] : [h, a];
    const last = to.line > from.line && to.ch === 0 ? to.line - 1 : to.line;
    for (let l = from.line; l <= last; l++) out.add(l);
  }
  return [...out].sort((x, y) => x - y);
}

class TaskLinks {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.busy = new Set();
    this.timer = null;
    this.views = new Set(); // live-preview editors that drew widgets
    this.refreshEffect = null;
  }
  engine() { return this.plugin.engine; }
  colors() {
    const tn = this.engine().tn();
    const s = (tn && tn.settings && tn.settings.customStatuses) ? tn.settings : (this.plugin.settings.tnSnapshot || {});
    return { status: colorMap(s.customStatuses, LINK_STATUS_COLORS), priority: colorMap(s.customPriorities, LINK_PRIORITY_COLORS) };
  }
  // No widgets on a task note itself (the task card is the task UI there).
  skipSource(sourcePath) {
    const f = sourcePath ? this.app.vault.getAbstractFileByPath(sourcePath) : null;
    return f instanceof TFile && this.engine().isTaskFile(f);
  }
  // The task a link leads to, or null.
  taskFor(linkpath, sourcePath) {
    const f = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath || '');
    const eng = this.engine();
    if (!(f instanceof TFile) || !eng.isTaskFile(f)) return null;
    const cfg = eng.cfg();
    return readTask(eng.fm(f), f.path, f.basename, cfg, f.path.startsWith(`${cfg.archiveFolder}/`));
  }
  viewOf(t) { const c = this.colors(); return taskLinkView(t, this.engine().cfg(), this.engine().today(), c.status, c.priority); }
  key(t, label) { const v = this.viewOf(t); return JSON.stringify([t.path, label, t.title, t.status, t.priority, t.due, t.scheduled, t.recurrenceRaw, t.completeInstances, v.done, v.statusColor, this.engine().today()]); }

  // The widget (both modes). linktext/sourcePath: how the original link opens.
  build(t, label, linktext, sourcePath) {
    const el = createSpan({ cls: 'a4pj-tl' });
    el.dataset.taskPath = t.path;
    el.dataset.linktext = linktext;
    el.dataset.source = sourcePath || '';
    el.dataset.label = label || '';
    this.draw(el, t);
    const stop = (e) => { e.stopPropagation(); };
    el.addEventListener('pointerdown', stop);
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.button === 0) e.preventDefault(); });
    el.addEventListener('mouseup', stop);
    el.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const now = this.taskFor(el.dataset.linktext, el.dataset.source);
      if (e.target.closest('.a4pj-tl-dot')) { if (now) this.toggle(now, el); return; }
      this.app.workspace.openLinkText(el.dataset.linktext, el.dataset.source, Keymap.isModEvent(e));
    });
    el.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault(); e.stopPropagation();
      this.app.workspace.openLinkText(el.dataset.linktext, el.dataset.source, 'tab');
    });
    el.addEventListener('keydown', (e) => {
      if (!e.target.closest('.a4pj-tl-dot') || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); e.stopPropagation();
      const now = this.taskFor(el.dataset.linktext, el.dataset.source);
      if (now) this.toggle(now, el);
    });
    const holder = { hoverPopover: null };
    el.addEventListener('mouseover', (e) => {
      const title = e.target.closest('.a4pj-tl-title');
      if (!title) return;
      this.app.workspace.trigger('hover-link', { event: e, source: 'preview', hoverParent: holder, targetEl: title, linktext: el.dataset.linktext, sourcePath: el.dataset.source });
    });
    return el;
  }
  draw(el, t) {
    const v = this.viewOf(t);
    el.empty();
    el.toggleClass('is-done', v.done);
    el.dataset.taskPath = t.path;
    const dot = el.createSpan({ cls: 'a4pj-tl-dot', attr: { role: 'button', tabindex: '0', 'aria-label': v.done ? 'Done. Click to mark not done' : 'Click to mark done' } });
    dot.style.borderColor = v.statusColor;
    if (v.done) dot.style.backgroundColor = v.statusColor;
    if (v.priorityColor) {
      const p = el.createSpan({ cls: 'a4pj-tl-pri', attr: { 'aria-label': `Priority: ${v.priorityLabel}` } });
      p.style.backgroundColor = v.priorityColor;
    }
    el.createSpan({ cls: 'a4pj-tl-title', text: el.dataset.label || t.title });
    if (v.recurring) setIcon(el.createSpan({ cls: 'a4pj-tl-rep', attr: { 'aria-label': 'Repeats' } }), 'refresh-ccw');
    for (const d of v.dates) el.createSpan({ cls: 'a4pj-tl-date', text: d });
  }

  async toggle(t, el) {
    if (this.busy.has(t.path)) return;
    this.busy.add(t.path);
    const eng = this.engine();
    const cfg = eng.cfg();
    const today = eng.today();
    const wasDone = t.recurrenceRaw ? t.completeInstances.includes(today) : isCompletedIn(cfg, t.status);
    // Show it at once; the real state redraws when the note changes.
    if (el) { el.toggleClass('is-done', !wasDone); const dot = el.querySelector('.a4pj-tl-dot'); if (dot) dot.style.backgroundColor = wasDone ? '' : this.colors().status[firstCompletedStatus(cfg)] || ''; }
    const freed = !wasDone && !t.recurrenceRaw ? eng.freedBy(t.path) : [];
    try {
      const w = await this.plugin.completeTask(t, !wasDone);
      const undo = w && w.undo ? async () => { await w.undo(); this.refreshSoon(); } : null;
      if (t.recurrenceRaw) {
        const res = w && w.result;
        this.plugin.toast.show(res ? (res.done ? `Done for ${shortDay(res.day, today)}${res.next ? `; next one ${shortDay(res.next, today)}` : ''}` : `Back to open for ${shortDay(res.day, today)}`) : 'Done', undo);
      } else if (!wasDone) this.plugin.toast.show(`Done: ${t.title}${unblocksText(freed)}`, undo);
      else this.plugin.toast.show('Back to open', undo);
    } catch (err) {
      console.error('[LifeWorld] task link tick failed', err);
      new Notice(`Could not update "${t.title}". ${err && err.message ? err.message : ''}`.trim());
    } finally {
      this.busy.delete(t.path);
      this.refreshSoon();
    }
  }

  /* ---- reading view ---------------------------------------------------- */
  postProcess(el, ctx) {
    const src = ctx && ctx.sourcePath;
    if (this.skipSource(src)) return;
    for (const a of Array.from(el.querySelectorAll('a.internal-link'))) {
      if (a.closest('.a4pj-tl, .a4pj-card, .tasknotes-inline-widget, .markdown-embed-title')) continue;
      if (a.previousElementSibling && a.previousElementSibling.hasClass && a.previousElementSibling.hasClass('a4pj-tl')) continue;
      const linktext = a.getAttribute('data-href') || a.getAttribute('href') || '';
      const linkpath = linktext.split('#')[0].trim();
      if (!linkpath || /^[a-z]+:\/\//i.test(linkpath)) continue;
      const t = this.taskFor(linkpath, src);
      if (!t) continue;
      const text = (a.textContent || '').trim();
      const base = linkpath.split('/').pop();
      const label = text && text !== linktext && text !== linkpath && text !== base ? text : '';
      const w = this.build(t, label, linktext, src);
      a.before(w);
      a.addClass('a4pj-tl-hidden');
    }
  }
  refreshReading() {
    for (const w of Array.from(document.querySelectorAll('.markdown-rendered .a4pj-tl, .markdown-preview-view .a4pj-tl'))) {
      if (w.dataset.cm) continue;
      const t = this.taskFor(w.dataset.linktext.split('#')[0], w.dataset.source);
      if (!t) { const a = w.nextElementSibling; if (a && a.hasClass('a4pj-tl-hidden')) a.removeClass('a4pj-tl-hidden'); w.remove(); continue; }
      if (this.busy.has(t.path)) continue;
      this.draw(w, t);
    }
  }

  /* ---- live preview ---------------------------------------------------- */
  editorExtension({ RangeSetBuilder, StateEffect, Prec, ViewPlugin, Decoration, WidgetType, syntaxTree }) {
    const { views } = this;
    const draw = (t, label, linktext, src) => this.build(t, label, linktext, src);
    const refresh = StateEffect.define();
    this.refreshEffect = refresh;
    class LinkWidget extends WidgetType {
      constructor(t, label, linktext, src, key) { super(); this.t = t; this.label = label; this.linktext = linktext; this.src = src; this.k = key; }
      eq(o) { return o instanceof LinkWidget && o.k === this.k; }
      toDOM() { const el = draw(this.t, this.label, this.linktext, this.src); el.dataset.cm = '1'; return el; }
      ignoreEvent() { return true; }
    }
    const isLive = (state) => { try { return !!state.field(editorLivePreviewField, false); } catch { return false; } };
    const pathOf = (state) => { try { const i = state.field(editorInfoField, false); return i && i.file ? i.file.path : null; } catch { return null; } };
    // A [[link]] the editor itself treats as a link (not in code, not in the properties block).
    const isLinkToken = (state, pos) => {
      try {
        const n = syntaxTree(state).resolveInner(pos, 1);
        return /hmd-internal-link/.test(n.name) && !/code|frontmatter|comment/.test(n.name);
      } catch { return true; }
    };
    const build = (view) => {
      try { return buildRaw(view); } catch (e) { console.error('[LifeWorld] task links: drawing failed', e); return Decoration.none; }
    };
    const buildRaw = (view) => {
      const state = view.state;
      if (!isLive(state)) return Decoration.none;
      const src = pathOf(state);
      if (!src || this.skipSource(src)) return Decoration.none;
      const b = new RangeSetBuilder();
      const sel = state.selection.ranges;
      // One pass over the viewport, widened to whole lines (visibleRanges can
      // split a line around hidden text and would add the same link twice).
      {
        const from = state.doc.lineAt(view.viewport.from).from; const to = state.doc.lineAt(view.viewport.to).to;
        for (const m of wikilinksIn(state.doc.sliceString(from, to), from)) {
          if (sel.some((s) => s.from < m.to && s.to >= m.from)) continue; // cursor in it: show the text
          if (!isLinkToken(state, m.from + 2)) continue;
          const t = this.taskFor(m.linkpath, src);
          if (!t) continue;
          const linktext = state.doc.sliceString(m.from + 2, m.to - 2).split('|')[0].trim();
          const label = m.alias || '';
          b.add(m.from, m.to, Decoration.replace({ widget: new LinkWidget(t, label, linktext, src, this.key(t, label)), inclusive: false }));
        }
      }
      return b.finish();
    };
    // Highest precedence: Obsidian hides the [[ ]] marks with its own replace
    // decorations, and on a redraw those could otherwise win over the widget.
    return Prec.highest(ViewPlugin.fromClass(class {
      constructor(view) { this.view = view; views.add(view); this.decorations = build(view); }
      update(u) {
        const changedMode = isLive(u.startState) !== isLive(u.state) || pathOf(u.startState) !== pathOf(u.state);
        const poked = u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
        // The parser reaches lines further down later, in an update with no other flag (after a load the
        // chips stayed plain until a click). Same check as CodeMirror's own syntax highlighting.
        const parsed = syntaxTree(u.startState) !== syntaxTree(u.state);
        if (u.docChanged || u.viewportChanged || u.selectionSet || changedMode || poked || parsed) this.decorations = build(u.view);
      }
      destroy() { views.delete(this.view); }
    }, { decorations: (v) => v.decorations }));
  }
  refreshEditors() {
    if (!this.refreshEffect) return;
    for (const v of Array.from(this.views)) { try { v.dispatch({ effects: this.refreshEffect.of(null) }); } catch { this.views.delete(v); } }
  }

  // Any task note changed (a tick here, in Today, the Planner, the card, sync): redraw.
  refreshSoon() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => { this.timer = null; this.refreshReading(); this.refreshEditors(); }, 120);
  }
  start() {
    const p = this.plugin;
    p.registerMarkdownPostProcessor((el, ctx) => this.postProcess(el, ctx));
    // CodeMirror loads here, so a missing module turns off only Live Preview links, never the plugin (review p2-s8 #3).
    const ext = [];
    p.registerEditorExtension(ext);
    Promise.all([import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/language')])
      .then((ms) => { ext.push(this.editorExtension(Object.assign({}, ...ms))); this.app.workspace.updateOptions(); })
      .catch((e) => console.warn('[LifeWorld] task links in Live Preview unavailable', e));
    // A note in the task folders (Settings › Your vault); by path, so a deleted note (no cache left) counts too.
    const isTask = (f) => f instanceof TFile && f.path.endsWith('.md') && inTaskFolders(f.path);
    p.registerEvent(this.app.metadataCache.on('changed', (f) => { if (isTask(f)) this.refreshSoon(); }));
    p.registerEvent(this.app.vault.on('rename', (f) => { if (isTask(f)) this.refreshSoon(); }));
    p.registerEvent(this.app.vault.on('delete', (f) => { if (isTask(f)) this.refreshSoon(); }));
    p.register(() => { if (this.timer) window.clearTimeout(this.timer); });
  }
  // Plugin off: put the plain links back in open reading views.
  stop() {
    for (const w of Array.from(document.querySelectorAll('.a4pj-tl'))) { const a = w.nextElementSibling; if (a && a.hasClass && a.hasClass('a4pj-tl-hidden')) a.removeClass('a4pj-tl-hidden'); if (!w.dataset.cm) w.remove(); }
  }
}

// The Find window: Obsidian's own prompt (the quick switcher look), so arrows,
// Enter, Escape and the full-screen phone layout come with it.
class FindTaskModal extends SuggestModal {
  constructor(plugin) {
    super(plugin.app);
    this.plugin = plugin;
    this.cfg = plugin.engine.cfg();
    this.today = plugin.engine.today();
    this.tasks = plugin.engine.collectTasks(true);
    this.shown = [];
    this.limit = 50;
    this.setPlaceholder('Find a task or project…');
    this.setInstructions([{ command: '↑↓', purpose: 'to move' }, { command: '↵', purpose: 'to open the task' }, { command: 'esc', purpose: 'to close' }]);
    this.modalEl.addClass('a4pj-find');
  }
  getSuggestions(query) {
    this.query = query;
    this.shown = findTasks(this.tasks, query, this.cfg, this.limit);
    this.emptyStateText = String(query || '').trim().length < 2 ? 'Type a few letters of a task or project' : 'No task matches';
    return this.shown;
  }
  renderSuggestion(t, row) {
    if (t === this.shown[0] && row.parentElement) {
      const head = createDiv({ cls: 'a4pj-find-head', text: `Tasks · ${this.shown.length}` });
      row.parentElement.insertBefore(head, row);
    }
    row.addClass('mod-complex');
    const body = row.createDiv({ cls: 'suggestion-content' });
    const mark = (host, text) => {
      const m = findMark(text, this.query);
      if (!m) { host.appendText(text); return; }
      host.appendText(m[0]); host.createSpan({ cls: 'suggestion-highlight', text: m[1] }); host.appendText(m[2]);
    };
    mark(body.createDiv({ cls: 'suggestion-title' }), t.title);
    const note = body.createDiv({ cls: 'suggestion-note' });
    if (findMark(t.title, this.query)) note.appendText(findNote(t, this.today, this.cfg)); else mark(note, findNote(t, this.today, this.cfg));
    if (!isOpenTask(t, this.cfg)) row.addClass('a4pj-find-done');
  }
  onChooseSuggestion(t) { this.plugin.openFile(t.path); }
}

/* Small dialogs for the board actions. Each calls done() once, on close:
 * the answer, or null / false when cancelled or dismissed. */
class AskModal extends Modal {
  constructor(app, question, value, done) { super(app); this.question = question; this.value = value || ''; this.done = done; this.answer = null; }
  onOpen() {
    this.titleEl.setText(this.question);
    const input = this.contentEl.createEl('input', { type: 'text', cls: 'a4pj-ask-input' });
    input.value = this.value;
    const ok = () => { this.answer = input.value; this.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } });
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { cls: 'mod-cta', text: 'OK' }).addEventListener('click', ok);
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    window.setTimeout(() => input.focus(), 0);
  }
  onClose() { this.contentEl.empty(); this.done(this.answer); }
}

class ConfirmModal extends Modal {
  constructor(app, title, text, okLabel, done) { super(app); this.title = title; this.text = text; this.okLabel = okLabel; this.done = done; this.ok = false; }
  onOpen() {
    this.titleEl.setText(this.title);
    this.contentEl.createEl('p', { text: this.text });
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { cls: 'mod-warning', text: this.okLabel }).addEventListener('click', () => { this.ok = true; this.close(); });
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
  }
  onClose() { this.contentEl.empty(); this.done(this.ok); }
}

class GoalPickModal extends SuggestModal {
  constructor(app, goals, name, done) { super(app); this.goals = goals; this.done = done; this.picked = null; this.setPlaceholder(`Which goal does "${name}" serve?`); }
  getSuggestions(q) { const s = String(q || '').trim().toLowerCase(); return this.goals.filter((g) => g.basename.toLowerCase().includes(s)); }
  renderSuggestion(g, row) { row.setText(g.basename); }
  onChooseSuggestion(g) { this.picked = g; this.finish(); }
  onClose() { window.setTimeout(() => this.finish(), 0); } // SuggestModal may close before it reports the choice
  finish() { const d = this.done; this.done = null; if (d) d(this.picked); }
}

// The project box for "Create task" when the note does not settle it (mockup-text-to-task.html).
// items: [{ path (null = no project), name, hint }], the preselected one first (SuggestModal
// highlights the first row). done(item) once; null when closed without a choice.
class TextTaskProjectModal extends SuggestModal {
  constructor(app, items, count, done) {
    super(app); this.items = items; this.done = done; this.picked = null; this.modalEl.addClass('a4pj-ttt');
    this.setPlaceholder(`Which project ${count === 1 ? 'is this task' : `are these ${count} tasks`} for?`);
    this.setInstructions([{ command: 'Up / Down', purpose: 'to move' }, { command: 'Enter', purpose: 'to choose' }, { command: 'Esc', purpose: 'to cancel' }]);
  }
  getSuggestions(q) { const s = String(q || '').trim().toLowerCase(); return this.items.filter((it) => it.name.toLowerCase().includes(s)); }
  renderSuggestion(it, row) { row.addClass('a4pj-ttt-row'); row.createSpan({ cls: 'a4pj-ttt-name', text: it.name }); if (it.hint) row.createEl('small', { cls: 'a4pj-ttt-hint', text: it.hint }); }
  onChooseSuggestion(it) { this.picked = it; this.finish(); }
  onClose() { window.setTimeout(() => this.finish(), 0); } // SuggestModal may close before it reports the choice
  finish() { const d = this.done; this.done = null; if (d) d(this.picked); }
}

// "+ Add idea": title, one line, why, Work or Personal. Calls save(values) on OK
// and closes only when it resolves a note (a taken name keeps the form open).
class IdeaModal extends Modal {
  constructor(app, area, save) { super(app); this.area = area; this.save = save; }
  onOpen() {
    this.titleEl.setText('Add an idea');
    const field = (label, ph) => { const w = this.contentEl.createDiv({ cls: 'a4pj-ask-field' }); w.createEl('label', { text: label }); const i = w.createEl('input', { type: 'text', cls: 'a4pj-ask-input' }); i.placeholder = ph; i.setAttr('aria-label', label); return i; };
    const title = field('Title', 'Weekly beach cleanup group');
    const line = field('One line', 'What it is, in a sentence');
    const why = field('Why it is worth keeping', 'Not a project yet: no date or helpers lined up');
    const w = this.contentEl.createDiv({ cls: 'a4pj-ask-field' }); w.createEl('label', { text: 'Work or personal' });
    const sel = w.createEl('select', { cls: 'dropdown' }); sel.setAttr('aria-label', 'Work or personal');
    for (const [v, l] of [['', 'Choose…'], ['work', 'Work'], ['personal', 'Personal']]) sel.createEl('option', { text: l, value: v });
    sel.value = this.area === 'work' || this.area === 'personal' ? this.area : '';
    let busy = false;
    const ok = async () => {
      if (busy) return;
      if (!title.value.trim()) { new Notice('Give the idea a title.'); title.focus(); return; }
      if (!sel.value) { new Notice('Choose work or personal.'); sel.focus(); return; }
      busy = true;
      try { if (await this.save({ title: title.value, line: line.value, why: why.value, sphere: sel.value })) this.close(); }
      finally { busy = false; }
    };
    // Enter steps to the next box; only the last one (why) saves: no Undo for a half-filled idea.
    [title, line, why].forEach((i, n, all) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (all[n + 1]) all[n + 1].focus(); else ok(); } }));
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { cls: 'mod-cta', text: 'Add idea' }).addEventListener('click', ok);
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    window.setTimeout(() => title.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

// "+ Add area" (mockup screen 4): name, work or personal, optional client. Calls save(values) on
// Add and closes only when it resolves a note (a taken name keeps the form open).
class AreaModal extends Modal {
  constructor(app, sphere, save) { super(app); this.sphere = sphere; this.save = save; }
  onOpen() {
    this.titleEl.setText('Add an area');
    this.contentEl.createEl('p', { cls: 'a4pj-modal-note', text: 'Ongoing work that never finishes, like a client or a product. Projects and one-off tasks can live inside it.' });
    const field = (label, ph) => { const w = this.contentEl.createDiv({ cls: 'a4pj-ask-field' }); w.createEl('label', { text: label }); const i = w.createEl('input', { type: 'text', cls: 'a4pj-ask-input' }); i.placeholder = ph; i.setAttr('aria-label', label); return i; };
    const name = field('Name', 'Northwind Bakery');
    const w = this.contentEl.createDiv({ cls: 'a4pj-ask-field' }); w.createEl('label', { text: 'Work or personal' });
    const sel = w.createEl('select', { cls: 'dropdown' }); sel.setAttr('aria-label', 'Work or personal');
    for (const [v, l] of [['', 'Choose…'], ['work', 'Work'], ['personal', 'Personal']]) sel.createEl('option', { text: l, value: v });
    sel.value = this.sphere === 'work' || this.sphere === 'personal' ? this.sphere : '';
    const client = field('Client (optional)', 'A person or company note, e.g. Jane Doe');
    let busy = false;
    const ok = async () => {
      if (busy) return;
      if (!name.value.trim()) { new Notice('Give the area a name.'); name.focus(); return; }
      if (!sel.value) { new Notice('Choose work or personal.'); sel.focus(); return; }
      busy = true;
      try { if (await this.save({ name: name.value, sphere: sel.value, client: client.value })) this.close(); }
      finally { busy = false; }
    };
    for (const i of [name, client]) i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } });
    const row = this.contentEl.createDiv({ cls: 'modal-button-container' });
    row.createEl('button', { cls: 'mod-cta', text: 'Add area' }).addEventListener('click', ok);
    row.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
    window.setTimeout(() => name.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

class ProjectsPlugin extends Plugin {
  async onload() {
    this.settings = normalizeSettings(await this.loadData().catch(() => null));
    this.engine = new TaskEngine(this);
    this.useSource();
    this.register(() => { if (this.ext) this.ext.stop(); this.ext = null; });
    this.toast = new Toast();
    this.register(() => this.toast.destroy());
    // pagesOff (LifeWorld sets it, launch section 1): the Projects switch is off but Today or the Planner
    // is on, so only the task engine runs: no Projects tab, ribbon button or page commands.
    if (!this.pagesOff) {
      this.registerView(VIEW_TYPE, (leaf) => new ProjectsView(leaf, this));
      this.addRibbonIcon('folder-kanban', 'Open Projects', () => this.openProjects({ page: 'overview' }));
      this.addCommand({ id: 'open', name: 'Open projects', callback: () => this.openProjects({ page: 'overview' }) });
      this.addCommand({ id: 'open-work', name: 'Open work projects', callback: () => this.openProjects({ page: 'overview', focus: 'work' }) });
      this.addCommand({ id: 'open-personal', name: 'Open personal projects', callback: () => this.openProjects({ page: 'overview', focus: 'personal' }) });
      this.addCommand({ id: 'open-inbox', name: 'Open the task inbox', callback: () => this.openProjects({ page: 'inbox' }) });
    }
    this.addCommand({ id: 'move-overdue-to-today', name: 'Move all overdue tasks to today', callback: () => this.moveOverdueToToday(null) });
    if (!this.pagesOff) this.addCommand({ id: 'add-task', name: 'Add a task to the inbox', callback: () => this.openProjects({ page: 'inbox', focusAdd: true }) });
    // Cmd/Ctrl+Shift+O: free in a default Obsidian and its plugins (checked 2026-10-06); changeable in Settings › Hotkeys.
    this.addCommand({ id: 'find-task', name: 'Find a task', callback: () => this.openFind() });
    this.addSettingTab(new ProjectsSettingTab(this.app, this));
    this.cards = new TaskCardManager(this);
    this.taskLinks = new TaskLinks(this);
    this.taskLinks.start();
    this.app.workspace.onLayoutReady(() => {
      this.snapshotTaskNotes();
      this.ensureDueType();
      this.cards.start();
      this.processArchiveQueue();
    });
    this.registerInterval(window.setInterval(() => this.processArchiveQueue(), 60000));
    this.registerEvent(this.app.workspace.on('css-change', () => this.cards.refreshAll()));
    this.hideTaskNotesOnTaskNotes();
    this.registerEvent(this.app.workspace.on('editor-menu', (menu, editor, info) => this.textTaskMenu(menu, editor, info)));
  }

  // 0.1.3: Obsidian's hover shows an empty `due` as a date picker only when the property is typed
  // Date. Set once, through Obsidian's own type store, when it has no type; a chosen type is kept.
  ensureDueType() {
    const tm = this.app.metadataTypeManager;
    if (!tm || typeof tm.getAssignedWidget !== 'function' || typeof tm.setType !== 'function') return;
    const name = Object.keys(toNote({ [this.engine.cfg().F.due]: null }))[0];
    if (tm.getAssignedWidget(name)) return;
    Promise.resolve(tm.setType(name, 'date')).catch((e) => console.error('[LifeWorld] could not set the due property type', e));
  }

  /* TaskNotes stays installed as the fallback, but on a task note the task card is
   * the only task UI (2026-10-04). TaskNotes' own in-note task card is
   * off in its settings (showTaskCardInNote). What has no per-note setting is
   * hidden here, only on notes the engine recognises as tasks, without touching
   * TaskNotes' code: its Subtasks/relationships widget, the convert-to-task
   * button on step lines (styles.css, scoped to .a4pj-task-note), the inline
   * card it draws over links to other tasks (reduced to a plain link; clicks
   * open the linked note instead of TaskNotes' edit box), and its two
   * right-click menu entries. Obsidian's Linked/Unlinked mentions are untouched. */
  hideTaskNotesOnTaskNotes() {
    const inTaskNote = (t) => t && t.closest && t.closest('.a4pj-task-note .tasknotes-inline-widget');
    const swallow = (e) => {
      const w = inTaskNote(e.target); if (!w) return;
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (e.type !== 'click' && e.type !== 'auxclick') return;
      if (e.type === 'auxclick' && e.button !== 1) return;
      const card = w.querySelector('[data-task-path]');
      const file = card && this.app.vault.getAbstractFileByPath(card.dataset.taskPath);
      if (file instanceof TFile) this.app.workspace.getLeaf(e.type === 'auxclick' || Keymap.isModEvent(e)).openFile(file);
    };
    for (const type of ['click', 'auxclick', 'dblclick', 'contextmenu']) this.registerDomEvent(document, type, swallow, true);
    // Menu items are added by TaskNotes' own file-menu handler, which may run
    // before or after this one: drop what is there, and catch what comes later.
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!this.engine.isTaskFile(file) || !menu || !Array.isArray(menu.items)) return;
      const isTn = (it) => it && it.section === 'tasknotes';
      // TaskNotes adds a separator right before its entries; it goes with them.
      const isSep = (it) => it && !it.titleEl && !('section' in it);
      const drop = () => { const a = menu.items; menu.items = a.filter((it, i) => !isTn(it) && !(isSep(it) && isTn(a[i + 1]))); };
      drop();
      if (!menu.lifeworldNoTn) {
        menu.lifeworldNoTn = true;
        const add = menu.addItem;
        menu.addItem = function (cb) { const r = add.call(this, cb); drop(); return r; };
      }
    }));
  }

  onunload() { closeAllPops(); if (this.cards) this.cards.stop(); if (this.taskLinks) this.taskLinks.stop(); }

  async onExternalSettingsChange() {
    this.settings = normalizeSettings(await this.loadData().catch(() => null));
    this.useSource();
    this.cards.refreshAll();
    this.refreshActivity();
  }
  // An Activity entry (Undo, sync) is not a note change, so the open Activity tab is redrawn here.
  refreshActivity() { for (const l of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (l.view && l.view.tab === 'activity') l.view.scheduleRender(); }

  async save() { await this.saveData(this.settings); }

  // Keeps a copy of TaskNotes' field names, statuses and folders, so the
  // engine still writes the same way after TaskNotes is turned off.
  async snapshotTaskNotes() {
    const tn = this.engine.tn();
    const snap = tn && tn.settings ? snapshotTaskNotes(tn.settings) : null;
    if (!snap) return;
    if (JSON.stringify(snap) === JSON.stringify(this.settings.tnSnapshot)) return;
    this.settings.tnSnapshot = snap;
    await this.save();
  }

  // For Today / Planner: the engine for LifeWorld's own task notes (every choice but TaskNotes).
  taskApi() { return this.usesBuiltIn() ? this.engine.api : null; }
  usesBuiltIn() { return this.settings.source !== 'tasknotes'; }

  // The task source for checkbox lines, ClickUp, Todoist or Things (src/core/sources.js), or null for
  // task notes. Today and the Planner read it through extSource().
  useSource() {
    if (this.ext && this.ext.id === this.settings.source) return;
    if (this.ext) this.ext.stop();
    this.ext = makeSource(this, this.settings.source);
    this.app.workspace.trigger('lifeworld:tasks');
  }
  extSource() { return this.ext; }
  // Project and area notes by path -> their key (a checkbox task in one, or linking to one, is its task).
  projectNoteKeys() { const n = this.engine.collectNotes(); return new Map([...n.projects, ...n.areas].map((p) => [p.path, p.key])); }
  // Checkbox tasks as the Projects pages read tasks (criterion 24).
  checkboxTasks() {
    if (!this.ext || this.ext.id !== 'checkbox') return [];
    return this.ext.items().map((it) => ({ ...it, archived: false, start: it.ext.start || null, scheduled: null, dueTime: null, startTime: null, completedDate: it.ext.doneDay || null, dateCreated: it.ext.created || null, steps: { total: 0, done: 0 }, openBlockers: [], reminderSet: null }));
  }
  async setSource(id) {
    this.settings.source = id;
    await this.save();
    this.useSource();
    this.cards.refreshAll();
  }

  // Ticks/creates follow the task source: Built-in engine, or TaskNotes' API.
  tnApi() {
    const tn = this.engine.tn(); const api = tn && tn.api;
    if (!api || api.apiVersion !== 1 || typeof api.hasCapability !== 'function' || !api.hasCapability('tasks.write')) return null;
    return api;
  }
  async completeTask(t, wantDone) {
    if (t.ext && this.ext) { await this.ext.toggle(t, this.engine.today()); return { undo: null }; }
    if (!this.usesBuiltIn()) {
      const api = this.tnApi();
      if (!api) throw new Error('TaskNotes is not turned on. Switch the task source to Built-in in Settings › LifeWorld › Tasks.');
      if (t.recurrenceRaw) { await api.recurring.toggleCompleteInstance(t.path); return { undo: null }; }
      if (wantDone) await api.tasks.complete(t.path); else await api.tasks.uncomplete(t.path);
      return { undo: null };
    }
    if (t.recurrenceRaw) return this.engine.toggleInstance(t.path, null);
    return wantDone ? this.engine.complete(t.path) : this.engine.uncomplete(t.path);
  }
  async createTask(input) {
    // Checkboxes: a "- [ ]" line under "Tasks" in that day's daily note (decision C), linked to its project.
    if (this.ext && this.ext.id === 'checkbox') {
      const day = toDayStr(input.due) || toDayStr(input.customFrontmatter && input.customFrontmatter.planned_day);
      const project = projectKeyOf(asList(input.projects)[0]);
      const path = await this.ext.create({ title: input.title, day, project });
      return { result: { path, title: input.title }, undo: null };
    }
    if (!this.usesBuiltIn()) {
      const api = this.tnApi();
      if (!api) throw new Error('TaskNotes is not turned on. Switch the task source to Built-in in Settings › LifeWorld › Tasks.');
      const t = await api.tasks.create(input);
      return { result: { path: t && (t.path || t.id), title: input.title }, undo: null };
    }
    return this.engine.create(input);
  }

  /* ---- text to task: right-click "Create task" on selected lines ------------ */

  // The selected lines that can become tasks: [{ line, text, title }], how many already link to a
  // task (skipped) and how many are headings. Frontmatter, code, math, comment and table lines never count.
  textTaskLines(editor, file) {
    const cache = this.app.metadataCache.getFileCache(file) || {};
    const fmEnd = cache.frontmatterPosition ? cache.frontmatterPosition.end.line : -1;
    const blocks = (cache.sections || []).filter((x) => ['code', 'math', 'comment', 'table', 'html'].includes(x.type)).map((x) => [x.position.start.line, x.position.end.line]);
    const out = []; let skipped = 0; let headings = 0;
    for (const line of selectedLines(editor.listSelections())) {
      if (line <= fmEnd || line >= editor.lineCount() || blocks.some(([a, b]) => line >= a && line <= b)) continue;
      const text = editor.getLine(line);
      const why = lineTaskSkip(text);
      if (why === 'heading') { headings++; continue; }
      if (why) continue;
      const isTask = wikilinksIn(text).some((l) => this.engine.isTaskFile(this.app.metadataCache.getFirstLinkpathDest(l.linkpath, file.path)));
      if (isTask) { skipped++; continue; }
      out.push({ line, text, title: lineTaskTitle(text) });
    }
    return { lines: out, skipped, headings };
  }

  textTaskMenu(menu, editor, info) {
    const file = info && info.file;
    if (!(file instanceof TFile) || this.engine.isTaskFile(file)) return;
    const picked = this.textTaskLines(editor, file);
    if (!picked.lines.length) return;
    const n = picked.lines.length;
    // First in the menu, as in the approved mockup.
    // shortcut: Menu.sections is Obsidian's own section order (not in its typings); without it the entry
    // falls back to Obsidian's default place near the bottom. Recheck if a new Obsidian moves it.
    const SECTION = 'a4pj-text-to-task';
    if (Array.isArray(menu.sections) && !menu.sections.includes(SECTION)) menu.sections.unshift(SECTION);
    menu.addItem((it) => it.setTitle(n === 1 ? 'Create task' : `Create ${n} tasks`).setIcon('list-plus').setSection(SECTION)
      .onClick(() => this.createTasksFromLines(editor, file, picked).catch((e) => { console.error('[LifeWorld] create from lines', e); new Notice(`Could not create the tasks. ${e && e.message ? e.message : ''}`); })));
  }

  // What the note says about its project: itself, its frontmatter, its links (project notes only).
  textTaskProjectFacts(file) {
    const mc = this.app.metadataCache;
    const n = this.engine.collectNotes();
    const projects = new Map([...n.projects, ...n.areas].map((p) => [p.path, p])); // areas take tasks too
    const toProject = (link, from) => { const f = mc.getFirstLinkpathDest(String(link).split('#')[0].split('|')[0], from); return f && projects.has(f.path) ? f.path : null; };
    const cache = mc.getFileCache(file) || {};
    const fm = cache.frontmatter || {};
    const fmPaths = ['project', 'projects', 'linked_projects'].flatMap((k) => asList(fm[k])).map((v) => wikilinkTarget(String(v)) || String(v)).map((l) => toProject(l, file.path)).filter(Boolean);
    const linkPaths = [...(cache.frontmatterLinks || []), ...(cache.links || [])].map((l) => toProject(l.link, file.path)).filter(Boolean);
    return { facts: { self: projects.has(file.path) ? file.path : null, fmPaths, linkPaths }, projects };
  }

  // Resolves the project path, null for no project, or undefined when the box was cancelled.
  async textTaskPickProject(file, count) {
    const { facts, projects } = this.textTaskProjectFacts(file);
    const r = textTaskProject(facts, this.lastTextTaskProject);
    if (!r.ask) return r.project;
    const name = (p) => (projects.get(p) || { name: p }).name;
    const times = (p) => facts.linkPaths.filter((x) => x === p).length;
    const hint = (p) => { const n = times(p); return n ? `mentioned ${n === 1 ? 'once' : `${n} times`} here` : ''; };
    const none = { path: null, name: 'No project (Inbox)', hint: '' };
    // After the note's own links (kept first on purpose): areas, then projects, A to Z, as in the task pickers.
    const others = [...projects.values()].filter((p) => (p.isArea || isOpenProject(p)) && !r.candidates.includes(p.path)).sort((a, b) => (!a.isArea) - (!b.isArea) || a.name.localeCompare(b.name)).map((p) => ({ path: p.path, name: p.name, hint: '' }));
    let items = [...r.candidates.map((p) => ({ path: p, name: name(p), hint: hint(p) })), ...others, none];
    const first = items.findIndex((it) => it.path === r.preselect);
    const top = first === -1 ? items.length - 1 : first; // a last pick no longer open: no project first
    if (top > 0) items = [items[top], ...items.slice(0, top), ...items.slice(top + 1)];
    const it = await new Promise((res) => new TextTaskProjectModal(this.app, items, count, res).open());
    if (!it) return undefined;
    this.lastTextTaskProject = it.path; // only a choice made in the box counts as the last pick
    return it.path;
  }

  // picked: the menu's own list, so the label's count is what gets created.
  async createTasksFromLines(editor, file, picked) {
    const { lines, skipped, headings } = picked;
    if (!lines.length) return;
    // A long selection (Select All) asks first; Cancel creates nothing.
    if (lines.length > TEXT_TASK_CONFIRM_OVER && !(await this.confirmAction(`Create ${lines.length} tasks?`, `Each of the ${lines.length} selected lines becomes its own task.`, `Create ${lines.length} tasks`))) return;
    const projectPath = await this.textTaskPickProject(file, lines.length);
    if (projectPath === undefined) return; // cancelled: nothing created, nothing marked
    const mc = this.app.metadataCache;
    const from = `[[${mc.fileToLinktext(file, this.engine.cfg().tasksFolder + '/x.md', true)}]]`;
    const made = []; const failed = [];
    for (const l of lines) {
      try {
        const input = { title: l.title, details: `From ${from}` };
        if (projectPath) input.projects = [projectLinkFor(projectPath)];
        const w = await this.createTask(input);
        const tf = w && w.result && w.result.path ? this.app.vault.getAbstractFileByPath(w.result.path) : null;
        if (!(tf instanceof TFile)) throw new Error('the task note was not found after creating it');
        made.push({ ...l, link: mc.fileToLinktext(tf, file.path, true) });
      } catch (e) { console.error('[LifeWorld] create from line', e); failed.push(l.title); }
    }
    // Each line is found again now (the box and the creates take time). Still on screen in this
    // editor: one change, so one undo removes every mark. Otherwise straight into the note.
    const view = this.app.workspace.getLeavesOfType('markdown').map((l) => l.view).find((v) => v && v.editor === editor);
    let marked = 0;
    if (made.length && view && view.file && view.file.path === file.path) {
      const doc = []; for (let i = 0; i < editor.lineCount(); i++) doc.push(editor.getLine(i));
      const at = relocateLines(doc, made);
      const changes = made.map((m, i) => (at[i] < 0 ? null : { from: { line: at[i], ch: markAt(m.text) }, text: ` [[${m.link}|task]]` })).filter(Boolean);
      if (changes.length) editor.transaction({ changes });
      marked = changes.length;
    } else if (made.length) {
      await this.app.vault.process(file, (text) => {
        const doc = text.split('\n');
        relocateLines(doc, made).forEach((l, i) => { if (l >= 0) { const c = markAt(doc[l]); doc[l] = `${doc[l].slice(0, c)} [[${made[i].link}|task]]${doc[l].slice(c)}`; marked++; } });
        return doc.join('\n');
      });
    }
    const where = projectPath ? projectPath.split('/').pop().replace(/\.md$/i, '') : 'the Inbox';
    const parts = [];
    if (made.length) parts.push(`Created ${made.length} task${made.length === 1 ? '' : 's'} in ${where}`);
    if (skipped) parts.push(`${skipped} line${skipped === 1 ? ' was' : 's were'} already a task`);
    if (headings) parts.push(`${headings} heading${headings === 1 ? '' : 's'} skipped`);
    if (made.length > marked) parts.push(`${made.length - marked} line${made.length - marked === 1 ? '' : 's'} changed meanwhile, not marked`);
    if (parts.length) this.toast.show(parts.join('; '));
    if (failed.length) new Notice(`Could not create ${failed.length === 1 ? 'this task' : 'these tasks'}: ${failed.join('; ')}`);
  }

  /* ---- auto-archive queue (same rule as TaskNotes' AutoArchiveService) -- */

  async archiveQueueOnStatus(path, status, cfg, now) {
    const sc = statusConfigOf(cfg, status);
    if (!sc) return false;
    const fm = this.engine.fm(this.engine.file(path) || {}) || {};
    const recurring = typeof fm[cfg.F.recurrence] === 'string' && fm[cfg.F.recurrence].trim();
    this.settings.archiveQueue = this.settings.archiveQueue.filter((x) => x.taskPath !== path);
    let queued = false;
    if (sc.autoArchive && !recurring) {
      this.settings.archiveQueue.push({ taskPath: path, statusChangeTimestamp: now.getTime(), archiveAfterTimestamp: now.getTime() + sc.autoArchiveDelay * 60000, statusValue: sc.value });
      queued = true;
    }
    await this.save();
    return queued;
  }
  // `restore`: the entry to put back in its place (Undo of a change that cancelled it).
  async cancelArchive(path, restore) {
    const before = this.settings.archiveQueue.length;
    this.settings.archiveQueue = this.settings.archiveQueue.filter((x) => x.taskPath !== path);
    if (restore) this.settings.archiveQueue.push(restore);
    if (restore || this.settings.archiveQueue.length !== before) await this.save();
  }
  async processArchiveQueue(nowMs) {
    if (this.archiving) return;
    const q = this.settings.archiveQueue;
    if (!q.length) return;
    const now = nowMs || Date.now();
    const due = q.filter((x) => now >= x.archiveAfterTimestamp);
    if (!due.length) return;
    this.archiving = true;
    try {
      const keep = q.filter((x) => now < x.archiveAfterTimestamp);
      const cfg = this.engine.cfg();
      for (const item of due) {
        try {
          const f = this.engine.file(item.taskPath);
          if (!f) continue;                                   // gone or moved: done with it
          const fm = this.engine.fm(f) || {};
          if (statusString(fm[cfg.F.status]) !== String(item.statusValue)) continue; // reopened since
          if (asList(fm.tags).map(String).includes(cfg.F.archiveTag) || fm.archived === true) continue;
          await this.engine.archive(item.taskPath);
        } catch (e) { console.error('[LifeWorld] archive failed', item.taskPath, e); keep.push(item); }
      }
      this.settings.archiveQueue = keep;
      await this.save();
    } finally { this.archiving = false; }
  }

  /* ---- opening things --------------------------------------------------- */

  // opts.newTab (Cmd/Ctrl-click): a new Projects tab; otherwise the open one is reused.
  async openProjects(state, opts) {
    if (this.pagesOff) return null; // the Projects pages are switched off (section 1)
    const ws = this.app.workspace;
    let leaf = opts && opts.newTab ? null : ws.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) leaf = ws.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true, state });
    ws.revealLeaf(leaf);
    ws.setActiveLeaf(leaf, { focus: true });
    return leaf;
  }
  openProject(path, opts) { return this.openProjects({ page: 'project', project: path }, opts); }
  // Public (Today, Planner): the project or area note whose page this plugin shows
  // for `ref`, a note's path or a task's project link or name. Matched
  // by name, the same way the project page collects its tasks. Null: no page.
  projectPathFor(ref) {
    if (ref == null || ref === '') return null;
    const n = this.engine.collectNotes();
    const list = [...n.projects, ...n.areas]; // an area's page is drawn by the same page (renderArea)
    const s = String(ref);
    const byPath = list.find((p) => p.path === s);
    if (byPath) return byPath.path;
    const key = projectKeyOf(s);
    const hit = key ? list.find((p) => p.key === key) : null;
    return hit ? hit.path : null;
  }
  // Public (Planner's Group by: Area): every area, and which area each project or area is in.
  // -> { areas: [{ key, name, path }], of: { projectKey or areaKey: areaKey } }
  areaIndex() {
    const n = this.engine.collectNotes();
    const of = {};
    for (const a of n.areas) of[a.key] = a.key;
    for (const p of n.projects) if (p.area) of[p.key] = p.area;
    return { areas: n.areas.map((a) => ({ key: a.key, name: a.name, path: a.path })), of };
  }
  // Public (Sidebar's Work / Personal counts): does the overview list this
  // project note (its frontmatter) as open? Same reading and rule as the page.
  isOpenProjectNote(fm) { return isOpenProject(readProject(fm, '', '')); }
  // Public: open that project's page. Resolves false when there is none, so the
  // caller can open the note instead.
  async openProjectPage(ref, opts) {
    if (this.pagesOff) return false; // no pages: the caller opens the note (section 1)
    const path = this.projectPathFor(ref);
    if (!path) return false;
    await this.openProject(path, opts);
    return true;
  }
  has(id) { const c = this.app.commands; return !!(c && c.commands && c.commands[id]); }
  run(id) { const c = this.app.commands; if (c && c.commands && c.commands[id]) { c.executeCommandById(id); return true; } return false; }
  // Today or the Planner switched off: no button to it (phase 2 section 6).
  todayOn() { return this.has(TODAY_COMMAND); }
  plannerOn() { return this.has(PLANNER_COMMAND); }
  openPlanner(projectKey) {
    if (!this.run(PLANNER_COMMAND)) { new Notice('The planner is not turned on.'); return; }
    if (!projectKey) return;
    window.setTimeout(() => {
      const leaf = this.app.workspace.getLeavesOfType('a4-planner')[0];
      const v = leaf && leaf.view;
      if (v && typeof v.render === 'function' && 'project' in v) { v.project = projectKey; v.render(); }
    }, 150);
  }
  // Public (Today, Planner, the "Find a task" command): the Find window.
  openFind() { const m = new FindTaskModal(this); m.open(); return m; }
  openToday() { if (!this.run(TODAY_COMMAND)) new Notice('The today page is not turned on.'); }
  openFile(path, newTab) { const f = this.engine.file(path); if (f) this.app.workspace.getLeaf(newTab === false ? false : 'tab').openFile(f); }
  // A task from a source (a checkbox line, ClickUp...) opens where it lives; a task note opens as before.
  openTask(t, newTab) { if (t && t.ext && this.ext) this.ext.open(t, newTab !== false); else this.openFile(t.path, newTab); }

  /* ---- shared actions ---------------------------------------------------- */

  // Orders of the untimed tasks in a lane (timed ones sort first by the clock).
  laneOrders(items, day, half) {
    return sortByOrder(items.filter((it) => !it.time && taskOnDay(it, day) && (it.plannedHalf || null) === (half || null))).map((x) => x.plannedOrder);
  }
  // A placement (applyPlacement, the Planner's rule and Settings › Planning): the due time goes
  // along while the task stays in its half of the day; into the other half (or Any time) it comes off.
  // The result says so (dropsTime) for the toast; Undo puts it back.
  async placeTask(t, day, half, items) {
    if (t.ext && this.ext) { await this.ext.place(t, day, half); return { undo: null }; }
    if (t.recurrenceRaw) { new Notice('Repeating tasks follow their schedule.'); return null; }
    const orders = this.laneOrders(items.filter((x) => x.path !== t.path), day, half);
    const order = orderForInsert(orders, orders.length);
    const w = await this.engine.write(t.path, (fm) => { applyPlacement(fm, day, half, order, planning.setsDue); });
    if (w) w.dropsTime = planning.setsDue && t.time && t.due && halfOfTime(t.time) !== (half || null) ? t.time : null;
    return w;
  }
  // "Move all overdue to today": one write per task (applyMove), one Undo.
  async moveOverdueToToday(projectKey) {
    const today = this.engine.today();
    const cfg = this.engine.cfg();
    const items = this.engine.collectTasks(false);
    const list = items.filter((t) => isOverdueTask(t, today, cfg) && (!projectKey || t.projectKey === projectKey));
    if (!list.length) { new Notice('Nothing is overdue.'); return 0; }
    const undos = [];
    const lanes = {};
    for (const t of list.sort((a, b) => a.plannedDay.localeCompare(b.plannedDay) || a.plannedOrder - b.plannedOrder)) {
      const half = t.plannedHalf || null;
      const key = half || '';
      if (!lanes[key]) lanes[key] = this.laneOrders(items.filter((x) => !list.includes(x)), today, half);
      const order = orderForInsert(lanes[key], lanes[key].length);
      lanes[key].push(order);
      try { const w = await this.engine.move(t.path, today, half, order); undos.push(w.undo); }
      catch (e) { console.error('[LifeWorld] move failed', t.path, e); }
    }
    this.toast.show(`${undos.length} overdue task${undos.length === 1 ? '' : 's'} moved to today`, async () => { for (const u of undos.reverse()) await u(); });
    return undos.length;
  }

  /* ---- projects board actions (spec 7-10, 12) ----------------------------
   * One processFrontMatter write each, touching only MOVE_FIELDS. Each
   * resolves true when the note changed, false when cancelled, refused or
   * failed (a refusal or failed write shows a notice and changes nothing).
   * The metadata cache lags a just-made write, so every guard reads the note
   * itself: inside the write, or (Delete, Promote's goal) a fresh read. */

  refused(name) { new Notice(`Could not do that to "${name}". Try again in a moment.`); return false; }
  // Only the place and kind of file; whether it is a project is decided from the note itself.
  projectFile(path) {
    const f = this.engine.file(path);
    if (f && f.extension === 'md' && f.path.startsWith(`${vaultFolders.projects}/`)) return f;
    this.refused(String(path).split('/').pop().replace(/\.md$/i, ''));
    return null;
  }
  // The frontmatter read from disk (not the cache); null when unreadable.
  async freshFm(f) {
    try {
      const info = getFrontMatterInfo(await this.app.vault.read(f));
      return info.exists ? parseYaml(info.frontmatter) : null;
    } catch (e) { console.error('[LifeWorld] could not read', f.path, e); return null; }
  }
  // The write; returns its Undo, or null when it failed or was refused (not a
  // project, or apply returned false). apply returning 'same' = already
  // there: null, no notice.
  async writeProject(f, apply) {
    let before, after, ok = false, same = false;
    try {
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        if (fm.type !== 'project') return;
        before = fieldsOf(fm); const r = apply(fm); ok = r !== false && r !== 'same'; same = r === 'same'; after = fieldsOf(fm);
      });
    } catch (e) { console.error('[LifeWorld] project write failed', f.path, e); new Notice(`Could not change "${f.basename}".`); return null; }
    if (!ok) { if (!same) this.refused(f.basename); return null; }
    const changed = MOVE_FIELDS.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).length;
    // Resolves true only when at least one field was put back.
    return async () => {
      if (this.engine.file(f.path) !== f) { new Notice(`Could not undo: "${f.basename}" was deleted.`); return false; }
      let kept = [];
      try { await this.app.fileManager.processFrontMatter(f, (fm) => { kept = undoFields(fm, before, after); }); }
      catch (e) { console.error('[LifeWorld] undo failed', f.path, e); new Notice(`Could not undo the change to "${f.basename}".`); return false; }
      const undone = kept.length < changed;
      if (kept.length) new Notice(`${undone ? 'Undone, but your' : 'Nothing undone: your'} later change to ${kept.join(', ')} on "${f.basename}" was kept.`);
      return undone;
    };
  }
  // A failed save never fails the move itself: the note is already changed.
  async logActivity(text) {
    this.settings.activity = addActivity(this.settings.activity, text, Date.now());
    this.refreshActivity();
    try { await this.save(); } catch (e) { console.error('[LifeWorld] activity save failed', e); }
  }
  // Board actions only; the List, Today and hand edits are not logged (spec 17).
  // Undo adds its own entry when it put something back; history is never rewritten.
  // Not awaited: the entry is in memory at once, the toast does not wait for the disk.
  logged(text, undo) {
    this.logActivity(text);
    return async () => { if (await undo()) await this.logActivity(`Undone: ${text[0].toLowerCase()}${text.slice(1)}`); };
  }
  async moveProject(path, status) {
    const f = this.projectFile(path);
    if (!f || !BOARD_COLUMNS.includes(status)) return false;
    const today = this.engine.today();
    // Ideas go through Promote (goal), Cold Storage through Restore.
    const undo = await this.writeProject(f, (fm) => {
      const s = statusOf(fm);
      if (s === status) return 'same'; // a card dropped back in its own column: silent
      return applyPlainStatus(fm, status, today);
    });
    if (!undo) return false;
    this.toast.show(`Moved "${f.basename}" to ${COLUMN_LABEL[status]}`, this.logged(`You moved ${f.basename} to ${COLUMN_LABEL[status]}.`, undo));
    return true;
  }
  // Tasks board move (spec 16): today's actions only, never a new writer. Done on a
  // one-off task and every other column but Someday: the status setter the task
  // card uses (completedDate, dateModified, auto-archive as today; for done that
  // is exactly the tick). Done on a repeating task: the tick, this occurrence only,
  // so it stays open (a Someday one stays in Someday, as the tick leaves it).
  // Closed on a repeating task ends the series (team call 2026-10-13); the toast
  // says so. Someday: the Someday action (a one-off task loses its day and due
  // date). Out of Someday: the status only, no date invented.
  async moveTask(t, column) {
    const cfg = this.engine.cfg();
    if (t.archived || !taskColumns(cfg).includes(column)) return false; // nothing takes a task out of the archive
    const f = this.engine.file(t.path);
    if (!f) { new Notice(`Could not find "${t.title}". It may have been moved or renamed.`); return false; }
    const fm = this.engine.fm(f) || {};
    if (taskColumn(statusString(fm[cfg.F.status])) === column) return false; // dropped back in its own column: silent
    const today = this.engine.today(), label = TASK_COLUMN_LABEL[column];
    let w, msg = `Moved "${t.title}" to ${label}`, text = `You moved the task "${t.title}" to ${label}.`;
    try {
      if (column === 'done' && t.recurrenceRaw) {
        const task = tnTaskOf(fm, cfg.F), day = actionDay(task, today), d = owningDay(task, day) || day;
        // The tick toggles: a second Done must not undo the first.
        if (strList(fm[cfg.F.completeInstances]).includes(d)) { new Notice(`"${t.title}" is already done for ${shortDay(d, today)}. It repeats, so it stays open.`); return false; }
        w = await this.completeTask(t, true);
        const r = (w && w.result) || { day: d };
        msg = `Done for ${shortDay(r.day, today)}${r.next ? `; next one ${shortDay(r.next, today)}` : ''}. It repeats, so it stays ${isSomeday({ status: statusString(fm[cfg.F.status]) }) ? 'in Someday' : 'open'}`;
        text = `You marked the task "${t.title}" done for ${shortDay(r.day, today)}.`;
      } else if (column === 'someday') {
        // A finished one-off task is reopened first (as unticking does), so no completedDate stays behind.
        const reopen = !t.recurrenceRaw && isCompletedIn(cfg, statusString(fm[cfg.F.status])) ? await this.engine.setStatus(t.path, cfg.defaultStatus) : null;
        let sd;
        try { sd = await this.engine.someday(t.path); } catch (e) {
          // Never leave a finished task reopened by a half move: put it back as it was.
          if (reopen) await reopen.undo().catch((u) => console.error('[LifeWorld] task move rollback failed', t.path, u));
          throw e;
        }
        w = { undo: async () => { try { await sd.undo(); } finally { if (reopen) await reopen.undo(); } } };
        if (t.due && !t.recurrenceRaw) msg += '. The due date was taken off';
      } else {
        w = await this.engine.setStatus(t.path, column);
        if (column === 'closed' && t.recurrenceRaw) msg = `Closed: "${t.title}" won't repeat any more`;
      }
    } catch (e) { console.error('[LifeWorld] task move failed', t.path, e); new Notice(`Could not move "${t.title}".`); return false; }
    const undo = w && w.undo;
    if (undo) this.toast.show(msg, this.logged(text, async () => { await undo(); return true; }));
    else { this.logActivity(text); this.toast.show(msg); }
    return true;
  }
  // Only from a board column (the cards that offer it).
  // Re-checked after the dialog: a second dialog on a stored note only updates the why.
  // `log` false: the project page's status menu, not the board (spec 17 logs board actions only).
  async coldStoreProject(path, log = true) {
    const f = this.projectFile(path);
    if (!f) return false;
    const why = await this.ask(`Why are you storing "${f.basename}"?`, '');
    if (why == null) return false;
    const today = this.engine.today();
    const undo = await this.writeProject(f, (fm) => {
      const s = statusOf(fm);
      if (!BOARD_COLUMNS.includes(s) && s !== 'cold-storage') return false;
      applyColdStorage(fm, why, today);
    });
    if (!undo) return false;
    this.toast.show(`Moved "${f.basename}" to Cold Storage`, log ? this.logged(`You moved ${f.basename} to Cold Storage.`, undo) : undo);
    return true;
  }
  async restoreProject(path, log = true) {
    const f = this.projectFile(path);
    if (!f) return false;
    const today = this.engine.today();
    let r;
    const undo = await this.writeProject(f, (fm) => { if (statusOf(fm) !== 'cold-storage') return false; r = applyRestore(fm, today); });
    if (!undo) return false;
    if (r.fellBack) new Notice(`"${f.basename}" had no earlier column saved, so it went to Backlog.`);
    this.toast.show(`Restored "${f.basename}" to ${COLUMN_LABEL[r.status]}`, log ? this.logged(`You restored ${f.basename} to ${COLUMN_LABEL[r.status]}.`, undo) : undo);
    return true;
  }
  // The goal is mandatory outside ideas: the fresh read decides whether to ask,
  // the write refuses a promote that would still leave no goal.
  async promoteIdea(path, log = true) {
    const f = this.projectFile(path);
    if (!f) return false;
    let goal = null;
    if (!hasGoalLink(await this.freshFm(f))) {
      const g = await this.pickGoal(f.basename);
      if (!g) return false;
      goal = `[[${g.basename}]]`;
    }
    const today = this.engine.today();
    const undo = await this.writeProject(f, (fm) => {
      if (statusOf(fm) !== 'idea' || (!goal && !hasGoalLink(fm))) return false;
      applyPromote(fm, goal, today);
    });
    if (!undo) return false;
    this.toast.show(`Promoted "${f.basename}" to a project`, log ? this.logged(`You promoted ${f.basename} to a project.`, undo) : undo);
    return true;
  }
  // Cold Storage cards only (spec 10). Only this note, to the vault's own
  // .trash folder whatever the trash setting; tasks, goal and links untouched.
  // No write to check inside, so it reads the note itself, before and after the confirm.
  async deleteProjectPermanently(path) {
    const f = this.projectFile(path);
    if (!f) return false;
    const stored = async () => {
      const fm = f.path.startsWith(`${vaultFolders.projects}/`) && await this.freshFm(f);
      return !!fm && fm.type === 'project' && statusOf(fm) === 'cold-storage';
    };
    if (!(await stored())) return this.refused(f.basename);
    const ok = await this.confirmAction('Delete permanently', `Delete "${f.basename}"? The project note goes to Obsidian's trash, so you can still get it back from there.`, 'Delete');
    if (!ok) return false;
    if (!(await stored())) return this.refused(f.basename);
    try { await this.app.vault.trash(f, false); }
    catch (e) { console.error('[LifeWorld] delete failed', f.path, e); new Notice(`Could not delete "${f.basename}".`); return false; }
    new Notice("Moved to Obsidian's trash. You can get it back from there.");
    await this.logActivity(`You deleted ${f.basename}.`);
    return true;
  }
  // Edit on a board card (and Edit idea, section 8): only `why`; an empty answer
  // keeps it. Not logged: spec 17 logs moves, not edits.
  async setProjectWhy(path, why) {
    const w = String(why || '').trim();
    if (!w) return false;
    const f = this.projectFile(path);
    if (!f) return false;
    const undo = await this.writeProject(f, (fm) => { if (fm.why === w) return 'same'; fm.why = w; });
    if (!undo) return false;
    this.toast.show(`Saved why for "${f.basename}"`, undo);
    return true;
  }
  // "+ Add project" (spec 13): an add-on's own new project form (LifeWorld's setNewNoteForm), unchanged.
  // preset (an area page's "+ New project"): { sphere, area: the area note's path }, chosen in the form.
  addProject(preset) {
    try { if (ADDON.form && ADDON.form.open('project', preset)) return true; } catch (e) { console.error('LifeWorld: the add-on new-note form failed', e); }
    new Notice('The new project form comes from an add-on, and none is turned on.');
    return false;
  }
  // "+ Add idea" (spec 11): a short form, then one new project note with status idea.
  addIdea(area) { new IdeaModal(this.app, area, (v) => this.createIdea(v)).open(); }
  // The only note this plugin creates for the board. Resolves the new file, or
  // null (the form stays open) when the name is taken or the write failed.
  // No Undo: removing a note is Delete permanently's job only (spec 19).
  async createIdea({ title, line, why, sphere }) {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (!t || !['work', 'personal'].includes(sphere)) return null;
    const name = sanitizeForFilename(t);
    const path = `${vaultFolders.projects}/${name}.md`;
    // Case-blind, like the Mac's disk: "beach cleanup" clashes with "Beach Cleanup".
    const dir = this.app.vault.getAbstractFileByPath(vaultFolders.projects);
    const taken = ((dir && dir.children) || []).find((c) => c.name.toLowerCase() === `${name}.md`.toLowerCase());
    if (taken) { new Notice(`There is already a project called "${taken.basename}".`); return null; }
    let f;
    try { f = await this.app.vault.create(path, ideaNote(t, line, why, sphere, this.engine.today(), stringifyYaml)); }
    catch (e) { console.error('[LifeWorld] idea create failed', path, e); new Notice(`Could not add "${name}".`); return null; }
    this.toast.show(`Added the idea "${f.basename}"`);
    this.logActivity(`You added the idea ${f.basename}.`);
    return f;
  }
  /* ---- areas (GL-002 "Areas", mockup approved 2026-10-18) -------------------- */

  // The project page's Area choice: parent_area set to the area (path-qualified, as task links are)
  // or removed. The area is checked on disk-fresh data; Undo for 5 seconds.
  async setProjectArea(path, areaPath) {
    const f = this.projectFile(path);
    if (!f) return false;
    const area = areaPath ? this.engine.collectAreas().find((a) => a.path === areaPath) : null;
    if (areaPath && !area) return this.refused(f.basename);
    const link = area ? projectLinkFor(area.path) : null;
    const undo = await this.writeProject(f, (fm) => {
      if (link) { if (fm.parent_area === link) return 'same'; fm.parent_area = link; }
      else { if (fm.parent_area === undefined) return 'same'; delete fm.parent_area; }
    });
    if (!undo) return false;
    this.toast.show(area ? `Area: ${area.name}` : `"${f.basename}" is in no area now`, undo);
    return true;
  }
  // One write that keeps the whole frontmatter for Undo (turning a note into an area or back).
  // apply(fm) false = refused. Undo puts the old frontmatter back exactly (keys and order), only
  // while the note still holds what this wrote.
  async writeWhole(f, apply) {
    let before = null, after = null;
    try {
      await this.app.fileManager.processFrontMatter(f, (fm) => {
        const b = JSON.parse(JSON.stringify(fm));
        if (apply(fm) === false) return;
        before = b; after = JSON.parse(JSON.stringify(fm));
      });
    } catch (e) { console.error('[LifeWorld] write failed', f.path, e); new Notice(`Could not change "${f.basename}".`); return null; }
    if (!before) { this.refused(f.basename); return null; }
    return async () => {
      if (this.engine.file(f.path) !== f) { new Notice(`Could not undo: "${f.basename}" was deleted.`); return false; }
      let done = false;
      try {
        await this.app.fileManager.processFrontMatter(f, (fm) => {
          if (JSON.stringify(fm) !== JSON.stringify(after)) return;
          for (const k of Object.keys(fm)) delete fm[k];
          Object.assign(fm, before); done = true;
        });
      } catch (e) { console.error('[LifeWorld] undo failed', f.path, e); new Notice(`Could not undo the change to "${f.basename}".`); return false; }
      if (!done) new Notice(`Nothing undone: "${f.basename}" was changed again since.`);
      return done;
    };
  }
  // Project page menu: only for a project in no area (applyToArea re-checks the note itself).
  async turnIntoArea(path) {
    const f = this.projectFile(path);
    if (!f) return false;
    const undo = await this.writeWhole(f, applyToArea);
    if (!undo) return false;
    this.toast.show(`"${f.basename}" is an area now`, undo);
    return true;
  }
  // Area page menu: only while no project is inside it. A project needs a goal (GL-002), so one is
  // asked for first when the area has none, as Promote does.
  async turnIntoProject(path) {
    const f = this.projectFile(path);
    if (!f) return false;
    const a = this.engine.collectAreas().find((x) => x.path === f.path);
    if (!a || this.engine.collectProjects().some((p) => p.area === a.key)) return this.refused(f.basename);
    let goal = null;
    if (!hasGoalLink(await this.freshFm(f))) {
      const g = await this.pickGoal(f.basename);
      if (!g) return false;
      goal = `[[${g.basename}]]`;
    }
    const undo = await this.writeWhole(f, (fm) => applyToProject(fm, goal));
    if (!undo) return false;
    this.toast.show(`"${f.basename}" is a project again (Active)`, undo);
    return true;
  }
  // "+ Add area": a short form, then one new area note. Resolves the file, or null (the form stays
  // open) when the name is taken (any case, projects and areas share the folder) or the write failed.
  addArea(sphere) { new AreaModal(this.app, sphere, (v) => this.createArea(v)).open(); }
  async createArea({ name, sphere, client }) {
    const t = String(name || '').replace(/\s+/g, ' ').trim();
    if (!t || !['work', 'personal'].includes(sphere)) return null;
    const base = sanitizeForFilename(t);
    const dir = this.app.vault.getAbstractFileByPath(vaultFolders.projects);
    const taken = ((dir && dir.children) || []).find((c) => c.name.toLowerCase() === `${base}.md`.toLowerCase());
    if (taken) { new Notice(`There is already a project or area called "${taken.basename}".`); return null; }
    if (!dir) await this.app.vault.createFolder(vaultFolders.projects).catch(() => {});
    let f;
    try { f = await this.app.vault.create(`${vaultFolders.projects}/${base}.md`, areaNote(t, sphere, client, this.engine.today(), stringifyYaml)); }
    catch (e) { console.error('[LifeWorld] area create failed', e); new Notice(`Could not add "${base}".`); return null; }
    this.toast.show(`Added the area "${f.basename}"`);
    return f;
  }

  // Open goals (not achieved), A to Z, for Promote.
  goalFiles() {
    const root = this.app.vault.getAbstractFileByPath(vaultFolders.goals);
    const out = [];
    if (root instanceof TFolder) for (const c of root.children) {
      const fm = c instanceof TFile && c.extension === 'md' ? this.engine.fm(c) : null;
      if (fm && fm.type === 'goal' && statusOf(fm) !== 'achieved') out.push(c);
    }
    return out.sort((a, b) => a.basename.localeCompare(b.basename));
  }
  pickGoal(name) {
    const goals = this.goalFiles();
    if (!goals.length) { new Notice('There are no open goals yet. Make the goal first, then promote this idea.'); return Promise.resolve(null); }
    return new Promise((resolve) => new GoalPickModal(this.app, goals, name, resolve).open());
  }
  ask(question, value) { return new Promise((resolve) => new AskModal(this.app, question, value, resolve).open()); }
  confirmAction(title, text, okLabel) { return new Promise((resolve) => new ConfirmModal(this.app, title, text, okLabel, resolve).open()); }
}

/* ========================================================================== *
 * Toast with Undo (one at a time, on document.body)
 * ========================================================================== */

class Toast {
  constructor() { this.el = null; this.timer = null; this.undo = null; }
  ensure() {
    if (this.el && this.el.isConnected) return;
    this.el = document.body.createDiv({ cls: 'a4pj-toast' });
    this.msg = this.el.createSpan({ cls: 'a4pj-toast-msg' });
    this.btn = this.el.createEl('button', { cls: 'a4pj-toast-undo', text: 'Undo' });
    this.btn.addEventListener('click', async () => {
      const u = this.undo; this.hide();
      if (u) { try { await u(); } catch (e) { console.error('[LifeWorld] undo failed', e); new Notice('Could not undo that.'); } }
    });
  }
  show(message, undo) {
    this.ensure();
    this.msg.setText(message);
    this.undo = undo || null;
    this.btn.toggleClass('is-hidden', !undo);
    // Phone: sit above Obsidian's floating toolbar, measured, not guessed.
    const nav = document.querySelector('.mobile-navbar');
    if (nav && nav.offsetParent) { const top = nav.getBoundingClientRect().top; this.el.style.bottom = `${Math.max(12, Math.round(window.innerHeight - top + 12))}px`; }
    else this.el.style.removeProperty('bottom');
    this.el.addClass('is-on');
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.hide(), undo ? UNDO_MS : 1800);
  }
  hide() { if (this.timer) window.clearTimeout(this.timer); this.timer = null; this.undo = null; if (this.el) this.el.removeClass('is-on'); }
  destroy() { this.hide(); if (this.el) this.el.remove(); this.el = null; }
}

/* ========================================================================== *
 * Popovers (on document.body; the outside-click listener always goes with
 * the popover: dev notes 2026-10-03)
 * ========================================================================== */

const openPops = new Set();
function closeAllPops() { for (const p of [...openPops]) p.close(); }
const el = (parent, tag, cls, text) => { const e = parent ? parent.createEl(tag) : document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

class Pop {
  constructor(anchor, title, build, opts) {
    const same = [...openPops].some((p) => p.anchor === anchor);
    closeAllPops();
    if (same) { this.dead = true; return; }
    this.anchor = anchor; this.opts = opts || {};
    this.el = document.body.createDiv({ cls: 'a4pj-pop' + (this.opts.narrow ? ' is-narrow' : '') + (this.opts.cls ? ' ' + this.opts.cls : '') });
    this.el.setAttr('role', 'dialog');
    if (title) el(this.el, 'div', 'a4pj-pop-title', title);
    anchor.addClass('is-open');
    openPops.add(this);
    this.away = (e) => { if (!this.el.contains(e.target) && !anchor.contains(e.target)) this.close(); };
    document.addEventListener('pointerdown', this.away, true);
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); anchor.focus && anchor.focus(); } });
    build(this.el, this);
    this.place();
    const first = this.el.querySelector(this.opts.focus || 'button, input');
    if (first) first.focus({ preventScroll: true });
  }
  place() {
    const b = this.anchor.getBoundingClientRect();
    const w = this.el.offsetWidth; const h = this.el.offsetHeight;
    const host = this.opts.host ? this.opts.host.getBoundingClientRect() : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight, width: window.innerWidth };
    let left; let top;
    if (this.opts.narrow) { left = host.left + Math.max(8, (host.width - w) / 2); top = Math.max(8, Math.min(host.bottom - (this.opts.lift || 0), window.innerHeight) - h - 12); }
    else {
      left = Math.max(host.left + 8, Math.min(b.right - w, host.right - w - 8));
      top = b.bottom + 6;
      if (this.opts.fit) {
        // A long list: take the roomier side of the button and scroll inside.
        const below = window.innerHeight - 8 - top; const above = b.top - 6 - 8;
        if (h > below && above > below) { this.el.style.maxHeight = `${Math.floor(above)}px`; top = Math.max(8, b.top - 6 - this.el.offsetHeight); }
        else if (h > below) this.el.style.maxHeight = `${Math.floor(Math.max(below, 160))}px`;
      } else if (top + h > window.innerHeight - 8) top = Math.max(8, b.top - h - 6);
    }
    this.el.style.left = `${Math.round(left)}px`; this.el.style.top = `${Math.round(top)}px`;
  }
  close() {
    if (this.dead) return;
    this.dead = true;
    document.removeEventListener('pointerdown', this.away, true);
    openPops.delete(this);
    this.el.remove();
    this.anchor.removeClass('is-open');
    if (this.opts.onClose) this.opts.onClose();
  }
}

// Month date picker: quick picks, a month grid (keyboard too), a typed date.
function openDatePicker(anchor, o) {
  const today = o.today;
  let month = (o.value || today).slice(0, 7);
  return new Pop(anchor, o.title, (box, pop) => {
    box.addClass('a4pj-dp');
    const pick = (d) => { pop.close(); o.onPick(d); };
    const q = el(box, 'div', 'a4pj-dp-quick');
    const quick = [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', nextMonday(today)]];
    if (o.allowClear !== false) quick.push(['No date', null]);
    for (const [label, d] of quick) {
      const b = el(q, 'button', null); el(b, 'span', null, label); el(b, 'span', 'a4pj-k', d ? `${WEEKDAYS_SHORT[weekdayOf(d)]} ${partsOf(d).d}` : '–');
      b.addEventListener('click', () => pick(d));
    }
    const cal = el(box, 'div');
    const draw = (focusDay) => {
      cal.empty();
      const head = el(cal, 'div', 'a4pj-mc-head');
      const pv = el(head, 'button', 'a4pj-mc-nav'); setIcon(pv, 'chevron-left'); pv.setAttr('aria-label', 'Previous month');
      el(head, 'span', null, monthTitle(month));
      const nx = el(head, 'button', 'a4pj-mc-nav'); setIcon(nx, 'chevron-right'); nx.setAttr('aria-label', 'Next month');
      pv.addEventListener('click', () => { month = shiftMonth(month, -1); draw(); });
      nx.addEventListener('click', () => { month = shiftMonth(month, 1); draw(); });
      const g = el(cal, 'div', 'a4pj-mc'); g.setAttr('role', 'grid');
      for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) el(g, 'span', 'a4pj-mc-dw', d);
      for (const d of monthGrid(month)) {
        const b = el(g, 'button', (d.slice(0, 7) !== month ? 'is-out ' : '') + (d === today ? 'is-today ' : '') + (d === o.value ? 'is-sel' : ''), String(partsOf(d).d));
        b.dataset.day = d;
        b.tabIndex = d === (focusDay || o.value || today) ? 0 : -1;
        b.setAttr('aria-label', `${shortDay(d, today)}${d === today ? ' (today)' : ''}${d === o.value ? ' (current)' : ''}`);
        b.addEventListener('click', () => pick(d));
        b.addEventListener('keydown', (e) => {
          const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (!mv) return;
          e.preventDefault();
          const n = addDays(d, mv);
          if (n.slice(0, 7) !== month) { month = n.slice(0, 7); draw(n); }
          const t = cal.querySelector(`[data-day="${n}"]`); if (t) t.focus();
        });
      }
    };
    draw();
    const foot = el(box, 'div', 'a4pj-dp-foot');
    const ty = el(foot, 'input', 'a4pj-input'); ty.type = 'text'; ty.placeholder = 'Or type: friday, oct 20'; ty.setAttr('aria-label', 'Type a date');
    ty.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const d = parseDayWord(ty.value, today);
      if (d) pick(d); else { ty.value = ''; ty.placeholder = "Didn't catch that, try: oct 20"; }
    });
    if (o.value && o.allowClear !== false) { const c = el(foot, 'button', 'a4pj-dp-clear', 'Clear'); c.addEventListener('click', () => pick(null)); }
    if (o.note) el(box, 'div', 'a4pj-pop-note', o.note);
  }, { narrow: o.narrow, host: o.host, lift: o.lift, focus: '.a4pj-mc button[tabindex="0"]' });
}

/* ---- Starts / Due: date and time picker (task times v3 + review) ---------- *
 * A day from the quick picks, the month (arrow keys too) or the typing box;
 * then, optionally, a time: Any time / Morning / Afternoon / a clock time
 * (Due), or No time / a clock time (Starts). The clock is an hour wheel and a
 * minutes wheel (steps of 5, plus the task's own odd minute) with AM and PM
 * as two buttons. Keyboard: up/down change the focused part, left/right move
 * between hour, minutes and AM/PM, Enter saves, Escape closes. Nothing is
 * written until Save (or Enter); Cancel or Escape closes without saving; the
 * orange line says what will be. The wheels show three rows. On a
 * phone, a picked day folds the month to one line and the line and Save stay
 * pinned at the bottom. */

// The options for a task's Starts or Due picker.
function whenPickerOpts(t, key, today) {
  const due = key === 'due';
  return {
    kind: key, title: `${due ? 'Due' : 'Starts'} · ${t.title}`, today, repeating: !!t.recurrenceRaw,
    day: due ? t.due : t.start, time: due ? t.dueTime : t.startTime, half: due && !t.recurrenceRaw ? t.plannedHalf : null,
    allowClear: !(key === 'start' && t.recurrenceRaw),
    // The Reminder row: on Due for a one-off task, on Starts for a repeating one.
    rings: due ? !t.recurrenceRaw : !!t.recurrenceRaw, reminder: t.reminderSet,
  };
}
// r: null (clear) | { day, time, half }. half: 'am' / 'pm', null (Any time),
// undefined (leave as it is). A time sets the half itself.
// r.reminder: minutes before / null (none), from the picker's Reminder row;
// left out (the typing box) = the default rule (GL-002 "Task reminders").
function saveWhen(engine, t, key, r) {
  const v = r ? whenValue(r.day, r.time) : null;
  const rem = r ? r.reminder : undefined;
  if (key === 'due') return engine.setDue(t.path, v, r && !r.time ? r.half : undefined, rem);
  return engine.setStart(t.path, v, rem);
}
// The reminder a save will leave: the task's own when it already rings (or
// had one set), "At the time" when it gets its first time, else none.
function reminderAfter(t, key, r) {
  const rings = key === 'due' ? !t.recurrenceRaw : !!t.recurrenceRaw;
  if (!rings || !r || !r.time) return null;
  if (t.reminderSet != null) return t.reminderSet;
  return (key === 'due' ? t.dueTime : t.startTime) ? null : 0;
}
const REMINDER_LABEL = { 0: 'At the time', 5: '5 min', 15: '15 min', 30: '30 min', 60: '1 hour', 1440: '1 day' };
// "Other" in the Reminder row: "45 min", "2 hours", "1h30m", "3 days", "90"
// (minutes). -> minutes before, or null when it can't be read. Up to 30 days.
function parseReminderText(s) {
  const t = String(s || '').toLowerCase().replace(/\bbefore\b/g, ' ').replace(/\band\b/g, ' ').replace(/,/g, '.').trim();
  if (!t) return null;
  const re = /\s*(\d+(?:\.\d+)?)\s*(weeks?|wks?|w|days?|d|hours?|hrs?|h|minutes?|mins?|m)?\s*/y;
  const unit = { w: 10080, d: 1440, h: 60, m: 1 };
  let i = 0; let total = 0;
  while (i < t.length) {
    re.lastIndex = i;
    const m = re.exec(t);
    if (!m || !m[0]) return null;
    total += Number(m[1]) * unit[(m[2] || 'm')[0]];
    i = re.lastIndex;
  }
  total = Math.round(total);
  return total >= 0 && total <= 43200 ? total : null;
}
function whenToast(t, key, r, today) {
  const lab = key === 'due' ? 'Due' : 'Starts';
  if (!r) return `${key === 'due' ? 'Due' : 'Start'} date${(key === 'due' ? t.dueTime : t.startTime) ? ' and time' : ''} removed`;
  return `${lab} ${shortDay(r.day, today)}${r.time ? `, ${timeText(r.time)}` : (key === 'due' && r.half ? `, ${halfWord(r.half)}` : '')}`;
}

function openWhenPicker(anchor, o) {
  const today = o.today;
  const due = o.kind === 'due';
  let day = o.day || null;
  let time = o.time || null;
  // Due: 'any' | 'am' | 'pm' | 'time'. Starts: 'any' (No time) | 'time'.
  let choice = time ? 'time' : (due && (o.half === 'am' || o.half === 'pm') ? o.half : 'any');
  let month = (day || today).slice(0, 7);
  let folded = !!(o.narrow && day); // phone: the month folds to one line once a day is picked
  let typedError = null;
  // Reminder row (reminder setup mockup): the stored choice; a task getting
  // its first time starts on "At the time". other: the Other box is open.
  let rem = time ? (o.reminder === undefined ? null : o.reminder) : (o.reminder == null ? 0 : o.reminder);
  let other = rem != null && !Object.prototype.hasOwnProperty.call(REMINDER_LABEL, rem);
  let otherText = other ? reminderWords(rem).replace(/ before$/, '') : '';
  return new Pop(anchor, o.title, (box, pop) => {
    box.addClass('a4pj-dp');
    const top = el(box, 'div', 'a4pj-wp-top');
    const tsec = el(box, 'div', 'a4pj-wp-time');
    const foot = el(box, 'div', 'a4pj-dp-foot');
    const ty = el(foot, 'input', 'a4pj-input'); ty.type = 'text'; ty.placeholder = due ? 'or type: tomorrow at 4pm' : 'or type: monday 9am'; ty.setAttr('aria-label', 'Type a date and time');
    const rsec = o.rings ? el(box, 'div', 'a4pj-wp-rem') : null;
    el(box, 'div', 'a4pj-pop-note', due
      ? 'Scroll or tap the hour and minutes, or use the arrow keys. A time picks Morning or Afternoon for you (before 1 PM is Morning). Start times don\'t ring.'
      : (o.repeating ? 'Starts: the first day this repeat runs. A start time on a repeating task rings each time it comes round.'
        : 'Starts: the first day it shows up. A start time doesn\'t ring; reminders ring at the due time.'));
    // The line, Cancel and Save stay pinned at the bottom (they matter most on a phone).
    const dock = el(box, 'div', 'a4pj-wp-dock');
    const pv = el(dock, 'div', 'a4pj-wp-pv'); pv.setAttr('aria-live', 'polite');
    const btns = el(dock, 'div', 'a4pj-wp-btns');
    const cn = el(btns, 'button', 'a4pj-wp-cancel', 'Cancel');
    const sv = el(btns, 'button', 'a4pj-wp-save', 'Save');
    // Cancel: close without saving, the same as Escape (2026-10-05).
    cn.addEventListener('click', () => { pop.close(); if (anchor.focus) anchor.focus(); });

    const half = () => (choice === 'time' ? halfOfTime(time) : (choice === 'am' || choice === 'pm' ? choice : null));
    // The reminder Save writes: minutes / null; undefined when the row is off (no time).
    const remNow = () => (!rsec || choice !== 'time' ? undefined : (other ? parseReminderText(otherText) : rem));
    const remBad = () => !!rsec && choice === 'time' && other && parseReminderText(otherText) == null;
    const state = () => (day ? { day, time: choice === 'time' ? time : null, half: choice === 'time' ? halfOfTime(time) : (due ? half() : null), reminder: remNow() } : null);
    let otherOut = null;
    const updPv = () => {
      pv.toggleClass('is-err', !!typedError);
      if (typedError) { pv.setText(whenPreview(typedError, o.kind, today, o.repeating)); return; }
      const r = state();
      pv.setText(r ? whenPreview(r, o.kind, today, o.repeating, o.rings ? (r.reminder === undefined ? null : r.reminder) : undefined) : 'Pick a day');
      sv.disabled = !r || remBad();
      if (otherOut) {
        const n = parseReminderText(otherText);
        otherOut.toggleClass('is-err', n == null && !!otherText.trim());
        otherOut.setText(n == null ? (otherText.trim() ? "Didn't catch that" : '') : (r && r.time ? `before = ${ringText(r.day, r.time, n)}` : ''));
      }
      const tb = tsec.querySelector('[data-choice="time"]'); if (tb) tb.setText(choice === 'time' ? timeText(time) : 'Set a time');
    };
    const save = () => { const r = state(); if (!r || remBad()) return; pop.close(); o.onSave(r); };

    // The Reminder row: None, At the time, 5/15/30 min, 1 hour, 1 day, Other.
    // Greyed out while there is no time (nothing to ring at).
    const drawRem = () => {
      if (!rsec) return;
      rsec.empty(); otherOut = null;
      const on = choice === 'time';
      rsec.toggleClass('is-off', !on);
      const lab = el(rsec, 'div', 'a4pj-wp-lab a4pj-wp-remlab');
      setIcon(el(lab, 'span', 'a4pj-ic'), on ? 'bell' : 'bell-off'); lab.appendText('Reminder');
      const chips = el(rsec, 'div', 'a4pj-wp-chips'); chips.setAttr('role', 'radiogroup'); chips.setAttr('aria-label', 'Reminder');
      const opts = [[null, 'None'], ...REMINDER_CHOICES.map((n) => [n, REMINDER_LABEL[n]])];
      for (const [n, label] of opts) {
        const sel = on && !other && rem === n;
        const b = el(chips, 'button', 'a4pj-wp-chip' + (sel ? ' is-on' : ''), label);
        b.setAttr('role', 'radio'); b.setAttr('aria-checked', String(sel)); b.disabled = !on;
        b.addEventListener('click', () => { rem = n; other = false; drawRem(); updPv(); });
      }
      if (on) {
        const ob = el(chips, 'button', 'a4pj-wp-chip is-other' + (other ? ' is-on' : ''), 'Other…');
        ob.setAttr('role', 'radio'); ob.setAttr('aria-checked', String(other));
        ob.addEventListener('click', () => { other = true; drawRem(); updPv(); const i = rsec.querySelector('.a4pj-wp-otherin'); if (i) i.focus(); });
      }
      if (on && other) {
        const ow = el(rsec, 'div', 'a4pj-wp-other');
        const oi = el(ow, 'input', 'a4pj-input a4pj-wp-otherin'); oi.type = 'text'; oi.value = otherText; oi.placeholder = '2 hours'; oi.setAttr('aria-label', 'How long before');
        otherOut = el(ow, 'span', 'a4pj-wp-otherout'); otherOut.setAttr('aria-live', 'polite');
        oi.addEventListener('input', () => { otherText = oi.value; updPv(); });
        oi.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); save(); } });
        el(rsec, 'div', 'a4pj-wp-remhelp', 'Type minutes, hours or days, e.g. "45 min", "2 hours", "3 days".');
      } else {
        el(rsec, 'div', 'a4pj-wp-remhelp', on ? `${o.repeating ? 'before it starts, each time' : "before it's due"}. Rings on your iPhone, Watch and Mac.` : 'Pick a time first. A task without a time has nothing to ring at.');
      }
      replace();
    };
    sv.addEventListener('click', save);

    const drawTop = (focusDay) => {
      top.empty();
      if (folded && day) {
        const line = el(top, 'div', 'a4pj-wp-fold');
        el(line, 'span', null, dayLong(day, today));
        const ch = el(line, 'button', 'a4pj-wp-change', 'change'); ch.setAttr('aria-label', 'Change the day');
        ch.addEventListener('click', () => { folded = false; drawTop(day); });
        return;
      }
      const q = el(top, 'div', 'a4pj-dp-quick');
      const quick = [['Today', today], ['Tomorrow', addDays(today, 1)], ['Next week', nextMonday(today)]];
      if (o.allowClear !== false) quick.push(['No date', null]);
      for (const [label, d] of quick) {
        const b = el(q, 'button', d && d === day ? 'is-sel' : null); el(b, 'span', null, label); el(b, 'span', 'a4pj-k', d ? `${WEEKDAYS_SHORT[weekdayOf(d)]} ${partsOf(d).d}` : '–');
        b.addEventListener('click', () => { if (!d) { pop.close(); o.onSave(null); return; } setDay(d); });
      }
      const head = el(top, 'div', 'a4pj-mc-head');
      const pvb = el(head, 'button', 'a4pj-mc-nav'); setIcon(pvb, 'chevron-left'); pvb.setAttr('aria-label', 'Previous month');
      el(head, 'span', null, monthTitle(month));
      const nx = el(head, 'button', 'a4pj-mc-nav'); setIcon(nx, 'chevron-right'); nx.setAttr('aria-label', 'Next month');
      pvb.addEventListener('click', () => { month = shiftMonth(month, -1); drawTop(); });
      nx.addEventListener('click', () => { month = shiftMonth(month, 1); drawTop(); });
      const g = el(top, 'div', 'a4pj-mc'); g.setAttr('role', 'grid');
      for (const d of ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']) el(g, 'span', 'a4pj-mc-dw', d);
      for (const d of monthGrid(month)) {
        const b = el(g, 'button', (d.slice(0, 7) !== month ? 'is-out ' : '') + (d === today ? 'is-today ' : '') + (d === day ? 'is-sel' : ''), String(partsOf(d).d));
        b.dataset.day = d;
        b.tabIndex = d === (focusDay || day || today) ? 0 : -1;
        b.setAttr('aria-label', `${shortDay(d, today)}${d === today ? ' (today)' : ''}${d === day ? ' (picked)' : ''}`);
        b.addEventListener('click', () => setDay(d, true));
        b.addEventListener('keydown', (e) => {
          const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
          if (!mv) return;
          e.preventDefault();
          const n = addDays(d, mv);
          if (n.slice(0, 7) !== month) { month = n.slice(0, 7); drawTop(n); }
          const t = top.querySelector(`[data-day="${n}"]`); if (t) t.focus();
        });
      }
      if (focusDay) { const t = top.querySelector(`[data-day="${focusDay}"]`); if (t) t.focus({ preventScroll: true }); }
      replace();
    };
    // The panel changes height (month folded or open, clock shown or not): keep it on screen.
    const replace = () => { if (pop.el && pop.el.isConnected && !pop.dead) pop.place(); };
    const setDay = (d, keepFocus) => {
      day = d; month = d.slice(0, 7); typedError = null;
      if (o.narrow) { folded = true; keepFocus = false; }
      drawTop(keepFocus ? d : null);
      updPv();
    };

    // The clock: hour and minutes wheels, AM/PM buttons.
    let wheel = null;
    const drawTime = () => {
      tsec.empty(); wheel = null;
      el(tsec, 'div', 'a4pj-wp-lab', 'Time (optional)');
      const seg = el(tsec, 'div', 'a4pj-seg a4pj-wp-seg');
      const opts = due ? [['any', 'Any time'], ['am', 'Morning'], ['pm', 'Afternoon'], ['time', 'Set a time']] : [['any', 'No time'], ['time', 'Set a time']];
      for (const [k, lab] of opts) {
        const b = el(seg, 'button', choice === k ? 'is-on' : '', k === 'time' && choice === 'time' ? timeText(time) : lab);
        b.dataset.choice = k;
        b.setAttr('aria-pressed', String(choice === k));
        b.addEventListener('click', () => {
          typedError = null;
          if (k === 'time') {
            if (choice !== 'time') { if (!time) time = choice === 'pm' ? '15:00' : '09:00'; if (!day) { day = today; month = today.slice(0, 7); drawTop(); } }
            choice = 'time';
          } else choice = k; // Morning / Afternoon / Any time: the clock time comes off, the half stays
          drawTime(); updPv();
          if (k === 'time' && wheel) wheel.focusCol(0);
        });
      }
      if (choice === 'time') wheel = clockWheel(tsec, time, (t) => { time = t; updPv(); }, save);
      drawRem();
      replace();
    };
    ty.addEventListener('input', () => {
      const r = parseWhen(ty.value, today, { day, time: choice === 'time' ? time : null }, o.kind);
      if (!r) { typedError = null; updPv(); return; }
      if (r.error) { typedError = r; updPv(); return; }
      typedError = null;
      day = r.day; month = day.slice(0, 7);
      if (r.time) { time = r.time; choice = 'time'; } else if (r.half && due) choice = r.half; else if (!r.kept) choice = due && choice !== 'time' ? choice : 'any';
      drawTop(); drawTime(); updPv();
      if (r.ask) pv.setText(whenPreview({ ...state(), ask: true }, o.kind, today, o.repeating));
    });
    ty.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (!typedError) save(); } });
    drawTop(); drawTime(); updPv();
  }, { narrow: o.narrow, host: o.host, lift: o.lift, cls: 'a4pj-wp' + (o.narrow ? ' is-phone' : ''), focus: '.a4pj-mc button[tabindex="0"], .a4pj-wp-change' });
}

// Hour wheel 1-12, minutes wheel (steps of 5, plus `t`'s own minute so an
// existing time is never rounded), AM / PM as two buttons. onChange('HH:MM').
function clockWheel(parent, t, onChange, onEnter) {
  const [H, M] = t.split(':').map(Number);
  const st = { h: H % 12 === 0 ? 12 : H % 12, m: M, pm: H >= 12 };
  const emit = () => onChange(`${pad2((st.h % 12) + (st.pm ? 12 : 0))}:${pad2(st.m)}`);
  const box = el(parent, 'div', 'a4pj-wp-wheel');
  el(box, 'div', 'a4pj-wp-band');
  const parts = [];
  const center = (c, it, smooth) => c.scrollTo({ top: it.offsetTop - c.clientHeight / 2 + it.offsetHeight / 2, behavior: smooth ? 'smooth' : 'auto' });
  const column = (values, cur, label, key, fmt) => {
    const c = el(box, 'div', 'a4pj-wp-col'); c.setAttr('role', 'listbox'); c.setAttr('aria-label', label); c.tabIndex = 0;
    el(c, 'div', 'a4pj-wp-pad');
    const items = values.map((v) => { const it = el(c, 'div', 'a4pj-wp-it' + (v === cur ? ' is-sel' : ''), fmt(v)); it.dataset.v = String(v); it.setAttr('role', 'option'); it.setAttr('aria-selected', String(v === cur)); return it; });
    el(c, 'div', 'a4pj-wp-pad');
    const pick = (it, smooth) => {
      items.forEach((x) => { x.toggleClass('is-sel', x === it); x.setAttr('aria-selected', String(x === it)); });
      st[key] = Number(it.dataset.v); emit();
      if (smooth != null) center(c, it, smooth);
    };
    items.forEach((it) => it.addEventListener('click', () => { c.focus({ preventScroll: true }); pick(it, true); }));
    let tmr = 0; let quiet = false;
    c.addEventListener('scroll', () => {
      if (quiet) return;
      window.clearTimeout(tmr);
      tmr = window.setTimeout(() => {
        const mid = c.scrollTop + c.clientHeight / 2; let best = null; let bd = 1e9;
        for (const it of items) { const d = Math.abs(it.offsetTop + it.offsetHeight / 2 - mid); if (d < bd) { bd = d; best = it; } }
        if (best && !best.hasClass('is-sel')) pick(best);
      }, 120);
    });
    const step = (n) => {
      const i = items.findIndex((x) => x.hasClass('is-sel'));
      const j = (i + n + items.length) % items.length;
      quiet = true; window.clearTimeout(tmr);
      pick(items[j], false);
      window.setTimeout(() => { quiet = false; }, 60);
    };
    parts.push({ el: c, step, focus: () => c.focus({ preventScroll: true }), init: () => { const s = items.find((x) => x.hasClass('is-sel')); if (s) center(c, s, false); } });
    return c;
  };
  const mins = Array.from({ length: 12 }, (_, i) => i * 5);
  if (!mins.includes(M)) { mins.push(M); mins.sort((a, b) => a - b); }
  column(Array.from({ length: 12 }, (_, i) => i + 1), st.h, 'Hour', 'h', String);
  el(box, 'div', 'a4pj-wp-colon', ':');
  column(mins, st.m, 'Minutes', 'm', pad2);
  const ap = el(box, 'div', 'a4pj-wp-ampm'); ap.setAttr('role', 'radiogroup'); ap.setAttr('aria-label', 'AM or PM');
  const abtn = [['AM', false], ['PM', true]].map(([lab, pm]) => {
    const b = el(ap, 'button', st.pm === pm ? 'is-on' : '', lab);
    b.setAttr('role', 'radio'); b.setAttr('aria-checked', String(st.pm === pm)); b.tabIndex = st.pm === pm ? 0 : -1;
    b.addEventListener('click', () => setPm(pm, true));
    return b;
  });
  const setPm = (pm, focus) => {
    st.pm = pm;
    abtn.forEach((b, i) => { const on = (i === 1) === pm; b.toggleClass('is-on', on); b.setAttr('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    emit();
  };
  parts.push({ el: ap, step: () => setPm(!st.pm, true), focus: () => abtn[st.pm ? 1 : 0].focus() });
  box.addEventListener('keydown', (e) => {
    const i = parts.findIndex((p) => p.el === e.target || p.el.contains(e.target));
    if (i < 0) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); parts[i].step(e.key === 'ArrowUp' ? -1 : 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const j = i + (e.key === 'ArrowLeft' ? -1 : 1); if (parts[j]) parts[j].focus(); }
    else if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
  });
  window.requestAnimationFrame(() => parts.forEach((p) => p.init && p.init()));
  return { focusCol: (i) => { if (parts[i]) parts[i].focus(); } };
}

/* ========================================================================== *
 * Shared row pieces (project page, Inbox, search, task card)
 * ========================================================================== */

/* Task card colour (mockup-task-page-color, sample A "Soft", approved
 * 2026-10-07). On a theme that sets --ink-marker the card uses that marker
 * and these inline shades are ignored by the CSS. On any other
 * theme it follows the accent chosen in Today (same shades as Today), and
 * Ink blue when Today is not installed; "Follow Obsidian accent" leaves both
 * unset so the CSS falls back to Obsidian's accent. */
const CARD_ACCENTS = {
  orange: ['#d43f16', '#ff5a2d'],
  blue: ['#1d4ed8', '#86aefc'],
  green: ['#1f6b3a', '#72cf94'],
  plum: ['#7a2e8a', '#d6a1e3'],
  amber: ['#8a5a00', '#efb54a'],
};
function cardAccentId(app) {
  const td = partOf(app, 'a4-today');
  const id = td && td.look && td.look.accent;
  return typeof id === 'string' && (id === 'accent' || CARD_ACCENTS[id]) ? id : 'blue';
}
function setCardAccent(card, app) {
  const pair = CARD_ACCENTS[cardAccentId(app)];
  if (pair) { card.style.setProperty('--pj-acc-l', pair[0]); card.style.setProperty('--pj-acc-d', pair[1]); }
  else { card.style.removeProperty('--pj-acc-l'); card.style.removeProperty('--pj-acc-d'); }
}

function priorityChip(parent, value, cfg) {
  const table = [...cfg.priorities].sort((a, b) => a.weight - b.weight);
  const i = table.findIndex((p) => p.value === String(value));
  const p = i >= 0 ? table[i] : { value: String(value || ''), label: value ? String(value) : 'None', weight: -1 };
  const bars = i >= 0 && table.length > 1 ? Math.round((3 * i) / (table.length - 1)) : 0;
  const top = i === table.length - 1;
  const c = el(parent, 'span', 'a4pj-chip a4pj-pri' + (top ? ' is-top' : '') + (bars <= 1 ? ' is-low' : ''));
  c.setAttr('aria-label', `Priority: ${p.label}`);
  const b = el(c, 'span', 'a4pj-bars');
  for (let k = 1; k <= 3; k++) el(b, 'i', k <= bars ? 'is-on' : '');
  c.appendText(p.label);
  return c;
}
function iconChip(parent, cls, text, icon, onClick, label) {
  const c = el(parent, 'span', `a4pj-chip ${cls || ''}`.trim());
  if (icon) setIcon(el(c, 'span', 'a4pj-ic'), icon);
  c.appendText(text);
  if (onClick) {
    c.addClass('is-click'); c.setAttr('role', 'button'); c.tabIndex = 0;
    if (label) c.setAttr('aria-label', label);
    c.addEventListener('click', (e) => { e.stopPropagation(); onClick(c); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(c); } });
  }
  return c;
}
// The "Blocked" marker: a lock chip; hover names the blockers, a click or tap lists them.
function unblocksText(freed) { return freed && freed.length ? ` · unblocks ${freed.length === 1 ? freed[0].title : `${freed.length} tasks`}` : ''; }
function lockChip(parent, blockers, open, popOpts) {
  const names = blockers.map((b) => b.title).join(', ');
  return iconChip(parent, 'a4pj-lock', blockers.length > 1 ? `Blocked · ${blockers.length}` : 'Blocked', 'lock', (c) => {
    new Pop(c, 'Blocked by', (box, pop) => {
      for (const b of blockers) { const q = el(box, 'button', 'a4pj-pop-q'); el(q, 'span', null, b.title); el(q, 'span', 'a4pj-k', 'open'); q.addEventListener('click', () => { pop.close(); open(b.path); }); }
      el(box, 'div', 'a4pj-pop-note', 'This task can start once these are done. Ticking one clears the marker.');
    }, popOpts || {});
  }, `Blocked by: ${names}`);
}
function ring(parent, done, total, big) {
  const w = el(parent, 'div', 'a4pj-ring' + (big ? ' is-big' : ''));
  const r = 18; const c = 2 * Math.PI * r; const f = total ? done / total : 0;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 46 46'); svg.setAttribute('aria-hidden', 'true');
  for (const [cls, dash] of [['a4pj-ring-bg', null], ['a4pj-ring-fg', `${(c * f).toFixed(1)} ${c.toFixed(1)}`]]) {
    const ci = document.createElementNS(NS, 'circle');
    for (const [k, v] of [['class', cls], ['cx', '23'], ['cy', '23'], ['r', String(r)], ['fill', 'none'], ['stroke-width', '5']]) ci.setAttribute(k, v);
    if (dash) { ci.setAttribute('stroke-linecap', 'round'); ci.setAttribute('stroke-dasharray', dash); }
    svg.appendChild(ci);
  }
  w.appendChild(svg);
  el(w, 'span', 'a4pj-ring-pct', total ? `${done}/${total}` : '–');
  if (total && `${done}/${total}`.length > 4) w.addClass('is-long');
  w.setAttr('aria-label', `${done} of ${total} done`);
  return w;
}

/* ========================================================================== *
 * The Projects view: overview, project page, Inbox
 * ========================================================================== */

class ProjectsView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.state = { page: 'overview', project: null, focus: null };
    this.filter = 'all';
    this.query = '';
    this.expanded = new Set();
    this.justDone = new Map(); // path -> timer: a ticked row stays in place, struck through, for the Undo time
    this.pending = false;
    this.narrow = false;
    this.bodyComp = null;
    this.tab = 'projects'; // board tab: projects / ideas / cold / activity
    this.area = null;      // board Work / Personal button (null = both)
    this.descs = new Map(); // path -> { mtime, line }: card descriptions, read once per change
    this.dragPath = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { const s = this.state; return s.page === 'project' && s.project ? s.project.split('/').pop().replace(/\.md$/, '') : s.page === 'inbox' ? 'Inbox' : s.focus ? `${SPHERE_LABEL[s.focus]} projects` : 'Projects'; }
  getIcon() { return 'folder-kanban'; }
  getState() { return { page: this.state.page, project: this.state.project, focus: this.state.focus }; }
  async setState(state, result) {
    const s = state && typeof state === 'object' ? state : {};
    const page = ['overview', 'project', 'inbox'].includes(s.page) ? s.page : 'overview';
    const focus = s.focus === 'work' || s.focus === 'personal' ? s.focus : null;
    const changed = page !== this.state.page || s.project !== this.state.project || focus !== this.state.focus;
    this.state = { page, project: typeof s.project === 'string' ? s.project : null, focus };
    this.focusAdd = !!s.focusAdd;
    if (changed) { this.query = ''; this.expanded.clear(); this.tab = 'projects'; this.area = focus; this.noteFor = null; this.showAllNotes = null; }
    this.render(true, changed);
    await super.setState(state, result);
    // The tab title and the header strip follow the list. shortcut: leaf.updateHeader and the view's
    // titleEl are Obsidian internals (not in obsidian.d.ts 1.14.4, read in its app code); no public call
    // redraws a tab title. A throwing one is logged, the tab still opens. Upgrade if Obsidian adds one.
    // Each guarded alone, so one failing still lets the other run (review p2-s8 #5).
    try { if (this.leaf && typeof this.leaf.updateHeader === 'function') this.leaf.updateHeader(); } catch (e) { console.error('LifeWorld: the Projects tab title did not update', e); }
    try { if (this.titleEl && this.titleEl.setText) this.titleEl.setText(this.getDisplayText()); } catch (e) { console.error('LifeWorld: the Projects header title did not update', e); }
  }

  async onOpen() {
    this.contentEl.empty();
    this.contentEl.addClass('a4pj-root');
    // Tasks and projects (Projects reads no calendar or weather note).
    const relevant = (p) => typeof p === 'string' && (inTaskFolders(p) || p.startsWith(vaultFolders.projects + '/'));
    this.registerEvent(this.app.metadataCache.on('changed', (f) => { if (f && relevant(f.path)) this.scheduleRender(); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (f && relevant(f.path)) this.scheduleRender(); }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if ((f && relevant(f.path)) || relevant(old)) { if (this.state.project === old) this.state.project = f.path; this.scheduleRender(); } }));
    this.registerEvent(this.app.vault.on('create', (f) => { if (f && relevant(f.path)) this.scheduleRender(); }));
    this.registerInterval(window.setInterval(() => { if (this.plugin.engine.today() !== this.renderedToday) this.render(); }, 30000));
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { const w = this.contentEl.clientWidth; const n = w > 0 && w <= NARROW_WIDTH; if (n !== this.narrow) this.render(); });
      this.ro.observe(this.contentEl);
    }
    this.render(true);
  }

  async onClose() {
    if (this.ro) this.ro.disconnect();
    if (this.timer) window.clearTimeout(this.timer);
    for (const t of this.justDone.values()) window.clearTimeout(t);
    closeAllPops();
    if (this.bodyComp) { this.bodyComp.unload(); this.bodyComp = null; }
  }

  scheduleRender() { if (this.timer) window.clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.timer = null; this.render(); }, 250); }

  go(state) { this.plugin.openProjects(state); }

  // Phone toolbar overlap (same check as the Planner).
  navbarOverlap() {
    const nav = document.querySelector('.mobile-navbar');
    if (!nav || !nav.offsetParent) return 0;
    const nb = nav.getBoundingClientRect(); const rb = this.contentEl.getBoundingClientRect();
    const over = Math.round(rb.bottom - nb.top);
    return nb.height > 0 && over > 0 && over < 240 ? over : 0;
  }
  popOpts() { return { narrow: this.narrow, host: this.contentEl, lift: this.navbarOverlap() }; }

  render(force, resetScroll) {
    const active = document.activeElement;
    const typing = active && this.contentEl.contains(active) && active.tagName === 'INPUT' && active.value;
    if (!force && (openPops.size || typing)) { this.pending = true; return; }
    this.pending = false;
    this.dragPath = null; // a redraw replaces the dragged card, whose dragend may never arrive
    const root = this.contentEl;
    const old = root.querySelector('.a4pj-scroll');
    const scroll = old && !resetScroll ? old.scrollTop : 0;
    const focusKey = active && root.contains(active) ? active.getAttribute('data-focus') : null;
    this.narrow = root.clientWidth > 0 && root.clientWidth <= NARROW_WIDTH;
    root.toggleClass('is-narrow', this.narrow);
    const eng = this.plugin.engine;
    this.cfg = eng.cfg();
    this.today = eng.today();
    this.renderedToday = this.today;
    this.tasks = this.plugin.settings && this.plugin.settings.source === 'checkbox' ? this.plugin.checkboxTasks() : eng.collectTasks(true);
    ({ projects: this.projects, areas: this.areas } = eng.collectNotes());
    this.notes = [...this.projects, ...this.areas]; // what a task's project link can name
    if (this.bodyComp) { this.bodyComp.unload(); this.bodyComp = null; }
    root.empty();
    const sc = el(root, 'div', 'a4pj-scroll');
    const page = el(sc, 'div', 'a4pj-page');
    const lift = this.navbarOverlap();
    if (lift) page.style.paddingBottom = `${40 + lift}px`;
    try {
      if (this.state.page === 'project') this.renderProject(page);
      else if (this.state.page === 'inbox') this.renderInbox(page);
      else this.renderOverview(page);
    } catch (e) {
      console.error('[LifeWorld] render failed', e);
      el(page, 'div', 'a4pj-empty', 'this page could not be drawn');
    }
    sc.scrollTop = scroll;
    if (focusKey) { const f = root.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`); if (f) { f.focus({ preventScroll: true }); if (f.tagName === 'INPUT') { const v = f.value; f.value = ''; f.value = v; } } }
    if (this.focusAdd) { this.focusAdd = false; const i = root.querySelector('.a4pj-qa input'); if (i) i.focus(); }
  }

  head(page, crumbs, title, actions) {
    const head = el(page, 'div', 'a4pj-head');
    const l = el(head, 'div', 'a4pj-head-l');
    const cr = el(l, 'div', 'a4pj-crumb');
    crumbs.forEach(([label, go], i) => {
      if (i) cr.appendText(' / ');
      if (go) { const b = el(cr, 'button', null, label); b.addEventListener('click', go); } else cr.appendText(label);
    });
    el(l, 'h1', 'a4pj-title', title);
    const act = el(head, 'div', 'a4pj-actions');
    for (const a of actions || []) if (a) { const b = el(act, 'button', 'a4pj-btn' + (a.cls ? ' ' + a.cls : ''), a.label); if (a.icon) { const i = createSpan({ cls: 'a4pj-ic' }); setIcon(i, a.icon); b.prepend(i); } if (a.aria) b.setAttr('aria-label', a.aria); b.addEventListener('click', () => a.run(b)); }
    return head;
  }

  /* ---- overview ---------------------------------------------------------- */

  renderOverview(page) {
    const cfg = this.cfg; const today = this.today;
    const inbox = this.tasks.filter((t) => isInboxTask(t, cfg));
    const overdueAll = this.tasks.filter((t) => isOverdueTask(t, today, cfg));
    // Opened from the sidebar's Work / Personal item: that list only (the crumb goes back to all).
    const sp = this.state.focus;
    const ui = this.plugin.settings.ui;
    const tasksKind = ui.kind === 'tasks'; // Tasks is always a board (spec 14)
    const areasKind = ui.kind === 'areas'; // its own page of area cards, never a board (Areas mockup, option 1)
    if (tasksKind && this.tab !== 'activity') this.tab = 'projects'; // Ideas and Cold Storage are for projects only
    const board = !areasKind && (tasksKind || ui.view === 'board');
    // Read settings at click time: a Sync reload swaps the settings object under this page.
    const pick = async (key, k) => { const u = this.plugin.settings.ui; if (u[key] === k) return; u[key] = k; this.query = ''; this.render(true, true); await this.plugin.save(); };
    // Mockup: the board's Ideas, Cold Storage and Activity tabs show no List / Board, Inbox or overdue button; Ideas has + Add idea.
    const side = board && this.tab !== 'projects';
    this.head(page, areasKind ? [['/ Projects', () => pick('kind', 'projects')], ['Areas', null]] : sp ? [['/ Projects', () => this.go({ page: 'overview' })], [SPHERE_LABEL[sp], null]] : [['/ Projects', null]], areasKind ? 'Areas' : board ? (tasksKind ? TASK_BOARD_TITLE : BOARD_TITLE)[this.tab] : sp ? `${SPHERE_LABEL[sp]} projects` : 'Projects', side ? [
      this.tab === 'ideas' ? { label: '+ Add idea', cls: 'is-primary', run: () => this.plugin.addIdea(this.area) } : null,
    ] : [
      overdueAll.length ? { label: `Move ${overdueAll.length} overdue to today`, cls: 'is-warn', icon: 'calendar-check', run: () => this.plugin.moveOverdueToToday(null) } : null,
      { label: `Inbox · ${inbox.length}`, icon: 'inbox', run: () => this.go({ page: 'inbox' }) },
      // + Add task: the plugin's own New task box (Inbox page, as the "Add a task" command); new tasks start in Open.
      tasksKind ? { label: '+ Add task', cls: 'is-primary', run: () => this.go({ page: 'inbox', focusAdd: true }) }
        : board ? { label: '+ Add project', cls: 'is-primary', run: () => this.plugin.addProject() }
          : { label: '+ Add area', cls: 'is-primary', run: () => this.plugin.addArea(sp) },
    ]);
    // Areas / Projects / Tasks (Areas first, owner request 2026-10-19), then List / Board (Projects only: Tasks is a board).
    const act = page.querySelector('.a4pj-actions');
    const switches = [['kind', 'Show', [['areas', 'Areas'], ['projects', 'Projects'], ['tasks', 'Tasks']]]];
    if (ui.kind === 'projects' && !side) switches.push(['view', 'View', [['list', 'List'], ['board', 'Board']]]);
    for (const [key, name, opts] of switches.reverse()) {
      const seg = createDiv({ cls: 'a4pj-seg a4pj-switch', attr: { role: 'group', 'aria-label': name } });
      for (const [k, l] of opts) {
        const b = el(seg, 'button', ui[key] === k ? 'is-on' : '', l);
        b.setAttr('aria-pressed', String(ui[key] === k));
        b.addEventListener('click', () => pick(key, k));
      }
      act.prepend(seg);
    }
    if (tasksKind) { this.renderTaskBoard(page); return; }
    if (areasKind) {
      const host = el(page, 'div', 'a4pj-lists');
      if (!this.areaSection(host, areaList(this.areas, '', sp))) el(host, 'div', 'a4pj-empty', 'no areas yet');
      return;
    }
    if (board) { this.renderBoard(page); return; }
    const tools = el(page, 'div', 'a4pj-tools');
    const seg = el(tools, 'div', 'a4pj-seg');
    for (const [k, l] of [['all', 'All'], ['active', 'Active'], ['paused', 'Paused'], ['waiting', 'Waiting'], ['blocked', 'Blocked'], ['backlog', 'Backlog']]) {
      const b = el(seg, 'button', this.filter === k ? 'is-on' : '', l);
      b.addEventListener('click', () => { this.filter = k; this.render(true); });
    }
    const s = el(tools, 'label', 'a4pj-search');
    setIcon(el(s, 'span', 'a4pj-ic'), 'search');
    const inp = el(s, 'input'); inp.type = 'text'; inp.placeholder = 'Find a project or task'; inp.value = this.query;
    inp.setAttr('aria-label', 'Find a project or task'); inp.dataset.focus = 'search';
    const lists = el(page, 'div', 'a4pj-lists');
    inp.addEventListener('input', () => { this.query = inp.value; this.renderLists(lists); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape' && inp.value) { e.preventDefault(); inp.value = ''; this.query = ''; this.renderLists(lists); } });
    this.renderLists(lists);
  }

  renderLists(host) {
    host.empty();
    const cfg = this.cfg; const today = this.today;
    const sp = this.state.focus;
    const groups = overviewGroups(this.projects, this.filter, this.query, sp);
    // Areas on top (mockup choice 1 A): they have no status, so only under All.
    const areas = this.filter === 'all' ? areaList(this.areas, this.query, sp) : [];
    this.areaSection(host, areas);
    for (const g of groups) {
      const sec = el(host, 'div', 'a4pj-sphere'); sec.dataset.sphere = g.sphere;
      const sh = el(sec, 'div', 'a4pj-sphere-head'); el(sh, 'h3', null, g.label); el(sh, 'span', 'a4pj-count', String(g.projects.length));
      const grid = el(sec, 'div', 'a4pj-plist');
      for (const p of g.projects) this.projectCard(grid, p, projectStats(p, this.tasks, today, cfg));
    }
    const found = searchTasks(sphereTasks(this.tasks, this.notes, sp).filter((t) => !t.archived || !isOpenTask(t, cfg)), this.query, cfg, 30);
    if (found.length) {
      const sec = el(host, 'div', 'a4pj-found');
      const sh = el(sec, 'div', 'a4pj-lbar'); el(sh, 'span', 'a4pj-kicker', 'Tasks'); el(sh, 'span', 'a4pj-count', String(found.length));
      for (const t of found) this.taskRow(sec, t, { showProject: true });
    }
    if (!groups.length && !found.length && !areas.length) el(host, 'div', 'a4pj-empty', this.query ? 'nothing matches' : 'no projects here');
    const closed = closedProjects(this.projects, this.query, sp);
    if (!closed.length || this.filter !== 'all') return;
    const ui = this.plugin.settings.ui;
    const sec = el(host, 'div', 'a4pj-closed');
    const h = el(sec, 'button', 'a4pj-sec-head' + (ui.closedOpen ? '' : ' is-folded'));
    h.setAttr('aria-expanded', String(!!ui.closedOpen));
    setIcon(el(h, 'span', 'a4pj-chev a4pj-ic'), 'chevron-down'); el(h, 'span', 'a4pj-kicker', 'Closed'); el(h, 'span', 'a4pj-count', String(closed.length));
    h.addEventListener('click', async () => { ui.closedOpen = !ui.closedOpen; this.renderLists(host); await this.plugin.save(); });
    if (!ui.closedOpen) return;
    for (const p of closed) this.closedRow(sec, p);
  }

  // The Areas heading and cards: top of Projects > List, and the whole Areas page.
  areaSection(host, areas) {
    if (!areas.length) return false;
    const sec = el(host, 'div', 'a4pj-sphere'); sec.dataset.sphere = 'areas';
    const sh = el(sec, 'div', 'a4pj-sphere-head'); el(sh, 'h3', null, 'Areas'); el(sh, 'span', 'a4pj-count', String(areas.length));
    const grid = el(sec, 'div', 'a4pj-plist');
    for (const a of areas) this.areaCard(grid, a, areaStats(a, this.projects, this.tasks, this.today, this.cfg));
    return true;
  }

  projectCard(grid, p, st, o = {}) {
    const c = el(grid, 'div', 'a4pj-pcard' + (p.status === 'active' ? '' : ' is-dim'));
    c.tabIndex = 0; c.setAttr('role', 'button'); c.setAttr('aria-label', `Open ${p.name}`); c.dataset.focus = `card:${p.path}`;
    ring(c, st.done, st.total);
    const m = el(c, 'div', 'a4pj-pmain');
    const top = el(m, 'div', 'a4pj-ptop');
    el(top, 'span', 'a4pj-pname', p.name);
    el(top, 'span', `a4pj-chip a4pj-st-${p.status || 'none'}`, p.status || 'no status');
    const meta = el(m, 'div', 'a4pj-pmeta');
    el(meta, 'span', null, `${st.open} open`);
    if (st.overdue) el(meta, 'span', 'is-warn', `${st.overdue} overdue`);
    if (st.later) el(meta, 'span', null, `${st.later} later`);
    if (p.areaName && !o.inArea) el(meta, 'span', null, p.areaName);
    if (p.client) el(meta, 'span', null, wikilinkLabel(p.client));
    const nx = el(m, 'div', 'a4pj-pnext' + (st.next ? '' : ' is-none'));
    el(nx, 'b', null, 'Next');
    el(nx, 'span', null, st.next ? st.next.title : (p.status === 'active' ? 'nothing to do yet: add a next step' : 'nothing open'));
    const go = () => this.go({ page: 'project', project: p.path });
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  // Same shape as a project card, a stack icon where the ring would be (mockup choice 1 A).
  areaCard(grid, a, st) {
    const c = el(grid, 'div', 'a4pj-pcard is-area');
    c.tabIndex = 0; c.setAttr('role', 'button'); c.setAttr('aria-label', `Open the area ${a.name}`); c.dataset.focus = `card:${a.path}`;
    setIcon(el(c, 'div', 'a4pj-aicon'), 'layers');
    const m = el(c, 'div', 'a4pj-pmain');
    const top = el(m, 'div', 'a4pj-ptop');
    el(top, 'span', 'a4pj-pname', a.name);
    el(top, 'span', 'a4pj-chip', 'area');
    const meta = el(m, 'div', 'a4pj-pmeta');
    const n = st.openProjects.length;
    el(meta, 'span', null, `${n} ${n === 1 ? 'project' : 'projects'}`);
    el(meta, 'span', null, `${st.open} loose ${st.open === 1 ? 'task' : 'tasks'}`);
    if (st.overdue) el(meta, 'span', 'is-warn', `${st.overdue} overdue`);
    if (a.client) el(meta, 'span', null, wikilinkLabel(a.client));
    const nx = el(m, 'div', 'a4pj-pnext' + (st.next ? '' : ' is-none'));
    el(nx, 'b', null, 'Next');
    el(nx, 'span', null, st.next ? st.next.title : 'nothing open');
    const go = () => this.go({ page: 'project', project: a.path });
    c.addEventListener('click', go);
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  /* ---- projects board (spec 5, 6, 13; mockup approved 2026-10-13) ---------- */

  // Tab counts are full totals, whatever area is chosen.
  boardTabs(page, list) {
    const tabs = el(page, 'div', 'a4pj-tabs'); tabs.setAttr('role', 'tablist');
    for (const [k, l, n] of list) {
      const b = el(tabs, 'button', this.tab === k ? 'is-on' : '', l);
      b.setAttr('role', 'tab'); b.setAttr('aria-selected', String(this.tab === k));
      if (n != null) el(b, 'span', 'a4pj-badge', String(n));
      b.addEventListener('click', () => { if (this.tab === k) return; this.tab = k; this.query = ''; this.render(true, true); });
    }
  }

  renderBoard(page) {
    this.boardTabs(page, [['projects', 'Projects', this.projects.filter((p) => onBoard(p)).length], ['ideas', 'Ideas', this.projects.filter((p) => p.status === 'idea').length],
      ['cold', 'Cold Storage', this.projects.filter((p) => p.status === 'cold-storage').length], ['activity', 'Activity']]);
    if (this.tab === 'activity') { this.renderActivity(page); return; }
    if (this.tab === 'cold') { this.renderCold(page); return; }
    this.areaButtons(page);
    if (this.tab === 'ideas') { this.renderIdeas(page); return; }
    this.boardFrame(page, 'Find a project', 'Search title, reason, next step', (tiles, board, refill) => this.fillBoard(tiles, board, refill));
  }

  // Tasks board (spec 14, 15): Tasks and Activity tabs, the same area buttons,
  // tiles, search, columns, Move and drag as the projects board.
  renderTaskBoard(page) {
    this.boardTabs(page, [['projects', 'Tasks', taskBoardRows(this.tasks, this.notes, this.cfg).length], ['activity', 'Activity']]);
    if (this.tab === 'activity') { this.renderActivity(page); return; }
    this.areaButtons(page);
    this.boardFrame(page, 'Find a task', 'Search task or project name', (tiles, board) => this.fillTaskBoard(tiles, board));
  }

  boardFrame(page, label, placeholder, fillWith) {
    const tiles = el(page, 'div', 'a4pj-tiles');
    const find = el(page, 'label', 'a4pj-bfind');
    el(find, 'span', null, label);
    const inp = el(find, 'input'); inp.type = 'search'; inp.placeholder = placeholder; inp.value = this.query; inp.dataset.focus = 'board-search';
    const board = el(page, 'div', 'a4pj-board');
    // Typing redraws the tiles and columns only, so the box keeps focus.
    const fill = () => fillWith(tiles, board, fill);
    inp.addEventListener('input', () => { this.query = inp.value; fill(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape' && inp.value) { e.preventDefault(); inp.value = ''; this.query = ''; fill(); } });
    // render() waits while the search box has text in it; leaving the box catches up.
    inp.addEventListener('blur', () => { if (this.pending) this.scheduleRender(); });
    fill();
  }

  fillBoard(tiles, board, refill) {
    tiles.empty(); board.empty();
    const cfg = this.cfg; const today = this.today;
    const shown = this.projects.filter((p) => onBoard(p))
      .map((p) => ({ p, st: projectStats(p, this.tasks, today, cfg) }))
      .filter(({ p, st }) => onBoard(p, this.area, this.query, [this.descOf(p, null, refill), st.next && st.next.title]))
      .sort((a, b) => b.p.mtime - a.p.mtime || a.p.name.localeCompare(b.p.name));
    for (const k of BOARD_COLUMNS) {
      const items = shown.filter((x) => x.p.status === k);
      const list = this.boardColumn(tiles, board, k, COLUMN_LABEL[k], COLUMN_SUB[k], items.length, 'Drop a project here', (path) => this.dropOn(path, k));
      for (const { p, st } of items) this.boardCard(list, p, st);
    }
  }

  // One column with its tile; returns the card list. `n` is the full count.
  boardColumn(tiles, board, k, label, sub, n, dropText, onDrop) {
    const t = el(tiles, 'button', 'a4pj-tile'); t.dataset.col = k;
    el(t, 'b', null, String(n)); el(t, 'span', null, label);
    const col = el(board, 'div', 'a4pj-col'); col.dataset.col = k;
    t.addEventListener('click', () => { col.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }); col.removeClass('is-flash'); void col.offsetWidth; col.addClass('is-flash'); });
    const hd = el(col, 'div', 'a4pj-colhead'); el(hd, 'h3', null, label); el(hd, 'span', 'a4pj-badge', String(n));
    el(col, 'div', 'a4pj-colsub', sub);
    const list = el(col, 'div', 'a4pj-cards');
    if (!n) el(list, 'div', this.query ? 'a4pj-empty' : 'a4pj-dropzone', this.query ? 'nothing matches' : dropText);
    col.addEventListener('dragover', (e) => { if (!this.dragPath) return; e.preventDefault(); col.addClass('is-drop'); });
    col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.removeClass('is-drop'); });
    col.addEventListener('drop', (e) => { col.removeClass('is-drop'); if (!this.dragPath) return; e.preventDefault(); onDrop(this.dragPath); });
    return list;
  }

  fillTaskBoard(tiles, board) {
    tiles.empty(); board.empty();
    const cfg = this.cfg; const today = this.today;
    const rows = taskBoardRows(this.tasks, this.notes, cfg, this.area, this.query);
    for (const k of taskColumns(cfg)) {
      const all = rows.filter((x) => x.col === k);
      const cards = taskColumnCards(all, k, today, cfg);
      const list = this.boardColumn(tiles, board, k, TASK_COLUMN_LABEL[k], TASK_COLUMN_SUB[k], all.length, 'Drop a task here', (path) => this.dropTask(path, k));
      for (const x of cards) this.taskCard(list, x);
      if (all.length > cards.length) el(list, 'div', 'a4pj-by', `The latest ${cards.length} of ${all.length}`);
    }
  }

  // Same rules as dropOn: same column makes no call; the board redraws from the notes.
  dropTask(path, column) {
    this.dragPath = null;
    const t = this.tasks.find((x) => x.path === path);
    if (!t || t.archived || taskColumn(t.status) === column) return;
    this.plugin.moveTask(t, column);
  }

  // Desktop drag; phones use the Move menu (spec 18).
  draggable(c, path, name) {
    if (Platform.isMobile) return;
    c.draggable = true;
    c.addEventListener('dragstart', (e) => {
      this.dragPath = path;
      const a = document.activeElement; if (a && a.tagName === 'INPUT' && this.contentEl.contains(a)) a.blur(); // or the drop's redraw waits on the search box
      if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name); }
      c.addClass('is-dragging');
    });
    c.addEventListener('dragend', () => { c.removeClass('is-dragging'); this.dragPath = null; });
  }

  // Task card (spec 15): name, project with its area tag, due date (red when
  // overdue; a repeating task shows how it repeats), High or Low priority. An archived task (finished and filed away)
  // has no Move: no existing action takes it out of the archive.
  taskCard(host, { t, p, col }) {
    const today = this.today;
    const c = el(host, 'div', 'a4pj-bcard');
    c.tabIndex = 0; c.setAttr('aria-label', `Open ${t.title}`); c.dataset.focus = `tcard:${t.path}`;
    if (!t.archived) this.draggable(c, t.path, t.title);
    const top = el(c, 'div', 'a4pj-btop');
    const pills = el(top, 'div', 'a4pj-pills');
    if (p && (p.sphere === 'work' || p.sphere === 'personal')) el(pills, 'span', `a4pj-pill is-${p.sphere}`, SPHERE_LABEL[p.sphere]);
    el(pills, 'span', 'a4pj-pill is-proj', p ? p.name : t.projectKey ? (t.project || t.projectKey) : 'No project');
    if (p && p.areaName) el(pills, 'span', 'a4pj-pill is-proj', p.areaName);
    if (t.archived) el(pills, 'span', 'a4pj-pill is-proj', 'Archived');
    // The List's rule: a repeating task is never overdue and shows how it repeats, not its old due date.
    const late = !t.recurrenceRaw && !!t.due && t.due < today && ['open', 'in-progress', 'blocked'].includes(col);
    // Own line under the chips: beside them it wrapped and clipped in narrow columns.
    el(c, 'div', 'a4pj-bwhen' + (late ? ' is-late' : ''), t.recurrenceRaw ? repeatWords(t.recurrenceRaw) : t.due ? `${late ? 'Overdue' : 'Due'} ${shortDay(t.due, today)}` : 'No due date');
    el(c, 'div', 'a4pj-btitle', plainLine(t.title));
    // Normal is the default, so only High and Low get a tag (mockup).
    if (t.priority === 'high' || t.priority === 'low') el(el(c, 'div', 'a4pj-by'), 'span', `a4pj-pill is-${t.priority}`, t.priority === 'high' ? 'High priority' : 'Low priority');
    const acts = el(c, 'div', 'a4pj-bacts');
    if (!t.archived) { const mv = el(acts, 'button', null, 'Move'); mv.addEventListener('click', () => this.taskMoveMenu(mv, t, col)); }
    const open = () => this.plugin.openFile(t.path); // as the List opens a task
    el(acts, 'button', null, 'Edit').addEventListener('click', open);
    c.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) open(); });
  }

  taskMoveMenu(anchor, t, col) {
    const m = new Menu();
    for (const k of taskColumns(this.cfg)) m.addItem((i) => i.setTitle(TASK_COLUMN_LABEL[k] + (k === col ? ' (here now)' : '')).setDisabled(k === col).onClick(() => this.plugin.moveTask(t, k)));
    const r = anchor.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom });
  }

  areaButtons(page) {
    const areas = el(page, 'div', 'a4pj-areas'); areas.setAttr('role', 'group'); areas.setAttr('aria-label', 'Work or personal');
    for (const k of ['work', 'personal']) {
      const b = el(areas, 'button', this.area === k ? 'is-on' : '', SPHERE_LABEL[k]);
      b.setAttr('aria-pressed', String(this.area === k));
      b.addEventListener('click', () => { this.area = this.area === k ? null : k; this.render(true); });
    }
  }

  // Ideas and Cold Storage (spec 8, 11, 12): a heading, one line, cards two across.
  // No search on either; Cold Storage has no area buttons (mockup).
  shelf(page, title, note, count) {
    const hd = el(page, 'div', 'a4pj-sechead'); el(hd, 'h2', null, title);
    if (count != null) el(hd, 'span', 'a4pj-badge', String(count));
    el(page, 'p', 'a4pj-secnote', note);
    return el(page, 'div', 'a4pj-shelf');
  }
  shelfCard(grid, p, pills) {
    const c = el(grid, 'div', 'a4pj-bcard');
    c.tabIndex = 0; c.setAttr('aria-label', `Open ${p.name}`); c.dataset.focus = `scard:${p.path}`;
    const top = el(c, 'div', 'a4pj-btop');
    const pl = el(top, 'div', 'a4pj-pills');
    if (p.sphere === 'work' || p.sphere === 'personal') el(pl, 'span', `a4pj-pill is-${p.sphere}`, SPHERE_LABEL[p.sphere]);
    for (const t of pills || []) el(pl, 'span', 'a4pj-pill is-from', t);
    el(c, 'div', 'a4pj-btitle', p.name);
    this.descOf(p, el(c, 'div', 'a4pj-bdesc'));
    const open = () => this.go({ page: 'project', project: p.path }); // as on the board
    c.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) open(); });
    return { c, top, sec: (label, text, go) => { const s = el(c, 'div', 'a4pj-bsec'); el(s, 'span', 'a4pj-lab' + (go ? ' is-go' : ''), label); el(s, 'span', 'a4pj-btext', plainLine(text)); } };
  }
  renderIdeas(page) {
    const grid = this.shelf(page, 'Idea inbox', 'Keep rough thoughts here. Promote one only when it deserves a place on the project board.');
    const list = this.projects.filter((p) => p.status === 'idea' && (!this.area || p.sphere === this.area))
      .sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
    if (!list.length) el(grid, 'div', 'a4pj-empty', 'no ideas here yet');
    for (const p of list) {
      const { c, sec } = this.shelfCard(grid, p);
      if (p.why) sec('Why it is here', p.why);
      const btns = el(c, 'div', 'a4pj-sbtns');
      const ed = el(btns, 'button', 'a4pj-btn', 'Edit idea');
      ed.addEventListener('click', async () => { const v = await this.plugin.ask(`Why is "${p.name}" worth keeping?`, p.why || ''); if (v != null) await this.plugin.setProjectWhy(p.path, v); });
      el(btns, 'button', 'a4pj-btn is-outline', 'Promote to project').addEventListener('click', () => this.plugin.promoteIdea(p.path));
    }
  }
  renderCold(page) {
    const list = this.projects.filter((p) => p.status === 'cold-storage').sort((a, b) => b.mtime - a.mtime || a.name.localeCompare(b.name));
    const grid = this.shelf(page, 'Cold Storage', 'Projects you are not continuing right now, kept here until you want them back.', list.length);
    if (!list.length) el(grid, 'div', 'a4pj-empty', 'nothing in Cold Storage');
    for (const p of list) {
      const to = restoreTarget({ stored_from: p.storedFrom });
      const st = projectStats(p, this.tasks, this.today, this.cfg);
      const { c, top, sec } = this.shelfCard(grid, p, to.fellBack ? [] : [`Previously in ${COLUMN_LABEL[to.status]}`]);
      el(top, 'span', 'a4pj-bwhen', p.mtime ? `Stored ${stampText(p.mtime)}` : '');
      sec('Why it was stored', p.why || 'No reason saved.');
      sec('Saved next step', st.next ? st.next.title : 'None saved.', true);
      el(c, 'div', 'a4pj-bsec a4pj-by', to.fellBack ? 'No earlier column was saved: Restore returns this project to Backlog.' : `Restore returns this project to ${COLUMN_LABEL[to.status]}.`);
      const btns = el(c, 'div', 'a4pj-sbtns');
      el(btns, 'button', 'a4pj-btn is-del', 'Delete permanently').addEventListener('click', () => this.plugin.deleteProjectPermanently(p.path));
      el(btns, 'button', 'a4pj-btn is-fill', 'Restore').addEventListener('click', () => this.plugin.restoreProject(p.path));
    }
  }

  // Same column: no call at all. Otherwise moveProject; a refusal or failed write
  // shows its notice and the card stays put (the board only redraws from the notes).
  dropOn(path, column) {
    this.dragPath = null;
    const p = this.projects.find((x) => x.path === path);
    if (!p || p.status === column) return;
    this.plugin.moveProject(path, column);
  }

  // The card's description: read once per note change, filled in when it arrives.
  // Read for hidden cards too (search reads it); until then the old line stands in,
  // and a search re-runs when the new one lands. Draws that ask while a read is
  // pending join it (one read; every waiting card filled, every waiting search re-run).
  descOf(p, target, refill) {
    let d = this.descs.get(p.path);
    if (d && d.mtime === p.mtime) { if (target) target.setText(d.line); return d.line; }
    if (!d) this.descs.set(p.path, d = { mtime: null, line: '' });
    if (target) target.setText(d.line);
    if (d.reading !== p.mtime) {
      const f = this.plugin.engine.file(p.path);
      if (!f) return d.line;
      const mt = p.mtime, old = d.line;
      d.reading = mt; d.targets = new Set(); d.refills = new Set();
      this.app.vault.cachedRead(f).then((text) => {
        if (d.reading !== mt) return; // a newer change is being read
        const line = firstBodyLine(text), targets = d.targets, again = d.refills;
        Object.assign(d, { mtime: mt, line, reading: null, targets: null, refills: null });
        for (const t of targets) t.setText(line);
        if (this.query && line !== old) for (const f of again) f();
      }).catch(() => { if (d.reading === mt) Object.assign(d, { reading: null, targets: null, refills: null }); });
    }
    if (target) d.targets.add(target);
    if (refill) d.refills.add(refill);
    return d.line;
  }

  boardCard(host, p, st) {
    const c = el(host, 'div', 'a4pj-bcard');
    c.tabIndex = 0; c.setAttr('role', 'button'); c.setAttr('aria-label', `Open ${p.name}`); c.dataset.focus = `bcard:${p.path}`;
    this.draggable(c, p.path, p.name);
    const top = el(c, 'div', 'a4pj-btop');
    const pills = el(top, 'div', 'a4pj-pills');
    if (p.sphere === 'work' || p.sphere === 'personal') el(pills, 'span', `a4pj-pill is-${p.sphere}`, SPHERE_LABEL[p.sphere]);
    if (p.areaName) el(pills, 'span', 'a4pj-pill is-proj', p.areaName);
    el(top, 'span', 'a4pj-bwhen', p.mtime ? stampText(p.mtime) : '');
    el(c, 'div', 'a4pj-btitle', p.name);
    this.descOf(p, el(c, 'div', 'a4pj-bdesc'));
    const sec = (label, text, go) => { const s = el(c, 'div', 'a4pj-bsec'); el(s, 'span', 'a4pj-lab' + (go ? ' is-go' : ''), label); el(s, 'span', 'a4pj-btext', plainLine(text)); };
    if (p.why) sec('Why here', p.why);
    if (st.total) el(c, 'div', 'a4pj-by', `${st.done} of ${st.total} ${st.total === 1 ? 'task' : 'tasks'} done`);
    if (st.next) { sec('Next', st.next.title, true); el(c, 'div', 'a4pj-by', 'Click to read notes'); }
    const acts = el(c, 'div', 'a4pj-bacts');
    const mv = el(acts, 'button', null, 'Move'); mv.addEventListener('click', () => this.moveMenu(mv, p));
    const ed = el(acts, 'button', null, 'Edit'); ed.addEventListener('click', () => this.editWhy(p));
    const cs = el(el(c, 'div', 'a4pj-bacts2'), 'button', null, 'Move to Cold Storage');
    cs.addEventListener('click', () => this.plugin.coldStoreProject(p.path));
    const open = () => this.go({ page: 'project', project: p.path }); // the project page, as in the List; it has Open note
    c.addEventListener('click', (e) => { if (!e.target.closest('button')) open(); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) open(); });
  }

  moveMenu(anchor, p) {
    const m = new Menu();
    for (const k of BOARD_COLUMNS) m.addItem((i) => i.setTitle(COLUMN_LABEL[k] + (k === p.status ? ' (here now)' : '')).setDisabled(k === p.status).onClick(() => this.plugin.moveProject(p.path, k)));
    const r = anchor.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom });
  }

  async editWhy(p) {
    const v = await this.plugin.ask(`Why is "${p.name}" in ${COLUMN_LABEL[p.status] || p.status}?`, p.why || '');
    if (v != null) await this.plugin.setProjectWhy(p.path, v);
  }

  // Plain text only (el sets textContent): entries carry note names.
  renderActivity(page) {
    const rows = el(page, 'div', 'a4pj-activity');
    const list = this.plugin.settings.activity;
    if (!list.length) el(rows, 'div', 'a4pj-empty', 'nothing yet: moves made on the board show up here');
    for (const a of list) { const r = el(rows, 'div', 'a4pj-log'); el(r, 'span', 'a4pj-when', stampText(a.at)); el(r, 'span', null, a.text); }
  }

  /* ---- project page ------------------------------------------------------- */

  renderProject(page) {
    const cfg = this.cfg; const today = this.today;
    const area = this.areas.find((x) => x.path === this.state.project);
    if (area) { this.renderArea(page, area); return; }
    const p = this.projects.find((x) => x.path === this.state.project);
    if (!p) { this.head(page, [['/ Projects', () => this.go({ page: 'overview' })]], 'Project not found'); el(page, 'div', 'a4pj-empty', 'that project note is gone'); return; }
    const st = projectStats(p, this.tasks, today, cfg);
    // Mockup choice 2 A: the area in the path ("Projects / Work / Acme Co"), one click back to it.
    const crumbs = [['/ Projects', () => this.go({ page: 'overview' })], [SPHERE_LABEL[p.sphere] || 'Unsorted', p.sphere === 'work' || p.sphere === 'personal' ? () => this.go({ page: 'overview', focus: p.sphere }) : null]];
    if (p.area) crumbs.push([p.areaName, () => this.go({ page: 'project', project: p.areaPath })]);
    this.head(page, crumbs, p.name, [
      this.plugin.todayOn() && { label: 'Open Today', run: () => this.plugin.openToday() },
      this.plugin.plannerOn() && { label: 'Open in Planner', run: () => this.plugin.openPlanner(p.key) },
      { label: '', icon: 'more-horizontal', aria: 'More', run: (b) => this.pageMenu(b, [[p.parentArea ? `Turn into an area (take it out of ${p.areaName || p.areaBad} first)` : 'Turn into an area', !!p.parentArea, () => this.plugin.turnIntoArea(p.path)]]) },
    ]);
    const ph = el(page, 'div', 'a4pj-phead');
    ring(ph, st.done, st.total);
    const facts = el(ph, 'div', 'a4pj-facts');
    const fact = (label) => { const f = el(facts, 'span', 'a4pj-fact'); el(f, 'b', null, label); return f; };
    fact('Sphere').appendText(p.sphere === 'work' ? 'Work' : p.sphere === 'personal' ? 'Personal' : 'not set');
    const sel = el(fact('Status'), 'select', 'a4pj-select dropdown');
    // Ideas, Cold Storage and the way out of them go through Promote / Cold Storage / Restore (statusRoute).
    for (const v of PROJECT_STATUSES) { const o = el(sel, 'option', null, v); o.value = v; o.disabled = v !== p.status && !statusRoute(p.status, v, p.storedFrom); }
    if (!PROJECT_STATUSES.includes(p.status)) { const o = el(sel, 'option', null, p.status || '(none)'); o.value = p.status; }
    sel.value = p.status;
    sel.addEventListener('change', async () => {
      const f = this.plugin.engine.file(p.path); if (!f) return;
      const v = sel.value;
      const how = statusRoute(p.status, v, p.storedFrom);
      let done = false;
      if (how === 'promote') done = await this.plugin.promoteIdea(p.path, false);
      else if (how === 'restore') done = await this.plugin.restoreProject(p.path, false);
      else if (how === 'cold') done = await this.plugin.coldStoreProject(p.path, false);
      else if (how === 'write') {
        const undo = await this.plugin.writeProject(f, (fm) => applyPlainStatus(fm, v, today));
        if (undo) { this.plugin.toast.show(`Status: ${v}`, undo); done = true; }
      }
      if (!done) sel.value = p.status; // cancelled, refused or failed: show what the note still says
    });
    this.areaFact(fact('Area'), p);
    if (p.goal) { const a = el(fact('Goal'), 'a', 'a4pj-link', wikilinkLabel(p.goal)); a.addEventListener('click', () => this.openLink(p.goal, p.path)); }
    if (p.client) { const a = el(fact('Client'), 'a', 'a4pj-link', wikilinkLabel(p.client)); a.addEventListener('click', () => this.openLink(p.client, p.path)); }
    fact('Open').appendText(`${st.open}${st.overdue ? ` · ${st.overdue} overdue` : ''}`);
    const nb = el(ph, 'button', 'a4pj-btn', 'Open note'); nb.addEventListener('click', () => this.plugin.openFile(p.path));

    const cols = el(page, 'div', 'a4pj-cols');
    const main = el(cols, 'div', 'a4pj-main');
    const file = this.plugin.engine.file(p.path);
    this.taskSection(main, p, st, { label: 'Open', placeholder: 'Add a task: "fix the hose tomorrow afternoon", "water plants every Monday", "!high due Friday"' });
    this.noteBody(main, p, file, 'Project note');
    // Side column
    const side = el(cols, 'div', 'a4pj-side');
    const c1 = el(side, 'div', 'a4pj-side-card');
    el(c1, 'div', 'a4pj-kicker', 'Progress');
    const br = el(c1, 'div', 'a4pj-bigring'); ring(br, st.done, st.total, true);
    el(br, 'div', null, `${st.done} of ${st.total} done${st.later ? `, ${st.later} waiting to start` : ''}.`);
    this.notesCard(side, p, file);
  }

  // The project page's Area choice (mockup choice 2 A): every area A to Z and "No area", written at
  // once with Undo. A link to a missing note or a non-area is shown struck, marked "not an area".
  areaFact(f, p) {
    if (p.areaBad) { el(f, 'span', 'a4pj-bad', p.areaBad); el(f, 'span', 'a4pj-chip is-warn', 'not an area'); }
    const sel = el(f, 'select', 'a4pj-select dropdown'); sel.setAttr('aria-label', 'Area');
    const opts = [...(p.areaBad ? [['', 'Change…']] : []), ...areaList(this.areas).map((a) => [a.path, a.name]), ['-', 'No area']];
    for (const [v, l] of opts) { const o = el(sel, 'option', null, l); o.value = v; }
    const now = p.areaPath || (p.areaBad ? '' : '-');
    sel.value = now;
    sel.addEventListener('change', async () => {
      if (!sel.value || sel.value === now) return;
      if (!(await this.plugin.setProjectArea(p.path, sel.value === '-' ? null : sel.value))) sel.value = now;
    });
  }

  // The "More" (…) menu on a project or area page: [[title, disabled, run]].
  pageMenu(anchor, items) {
    const m = new Menu();
    for (const [t, off, run] of items) m.addItem((i) => i.setTitle(t).setDisabled(off).onClick(run));
    const r = anchor.getBoundingClientRect();
    m.showAtPosition({ x: r.left, y: r.bottom });
  }

  /* ---- area page (mockup screen 2) ------------------------------------------ */

  renderArea(page, a) {
    const cfg = this.cfg; const today = this.today;
    const st = areaStats(a, this.projects, this.tasks, today, cfg);
    const sp = a.sphere === 'work' || a.sphere === 'personal' ? a.sphere : null;
    this.head(page, [['/ Projects', () => this.go({ page: 'overview' })], [SPHERE_LABEL[a.sphere], sp ? () => this.go({ page: 'overview', focus: sp }) : null], ['Area', null]], a.name, [
      this.plugin.todayOn() && { label: 'Open Today', run: () => this.plugin.openToday() },
      this.plugin.plannerOn() && { label: 'Open in Planner', run: () => this.plugin.openPlanner(a.key) },
      { label: '+ New project', cls: 'is-primary', run: () => this.plugin.addProject({ sphere: sp || undefined, area: a.path }) },
      // Ideas and stored projects count too but are not listed on the page, so the label names them all (review s1 #1).
      { label: '', icon: 'more-horizontal', aria: 'More', run: (b) => this.pageMenu(b, [[st.inside.length ? `Turn back into a project (first move out: ${st.inside.join(', ')})` : 'Turn back into a project', st.inside.length > 0, () => this.plugin.turnIntoProject(a.path)]]) },
    ]);
    const ph = el(page, 'div', 'a4pj-phead is-area');
    setIcon(el(ph, 'div', 'a4pj-aicon is-big'), 'layers');
    const facts = el(ph, 'div', 'a4pj-facts');
    const fact = (label) => { const f = el(facts, 'span', 'a4pj-fact'); el(f, 'b', null, label); return f; };
    fact('Kind').appendText('Area, ongoing');
    fact('Sphere').appendText(sp ? SPHERE_LABEL[sp] : 'not set');
    if (a.client) { const l = el(fact('Client'), 'a', 'a4pj-link', wikilinkLabel(a.client)); l.addEventListener('click', () => this.openLink(a.client, a.path)); }
    if (a.goal) { const l = el(fact('Goal'), 'a', 'a4pj-link', wikilinkLabel(a.goal)); l.addEventListener('click', () => this.openLink(a.goal, a.path)); }
    const np = st.openProjects.length;
    fact('Open').appendText(`${np} ${np === 1 ? 'project' : 'projects'} · ${st.open} loose ${st.open === 1 ? 'task' : 'tasks'}`);
    const nb = el(ph, 'button', 'a4pj-btn', 'Open note'); nb.addEventListener('click', () => this.plugin.openFile(a.path));

    const cols = el(page, 'div', 'a4pj-cols');
    const main = el(cols, 'div', 'a4pj-main');
    const lb = el(main, 'div', 'a4pj-lbar'); el(lb, 'span', 'a4pj-kicker', 'Projects'); el(lb, 'span', 'a4pj-count', String(np));
    const grid = el(main, 'div', 'a4pj-plist');
    if (!np) el(grid, 'div', 'a4pj-empty', 'no open projects in this area yet');
    for (const p of st.openProjects) this.projectCard(grid, p, projectStats(p, this.tasks, today, cfg), { inArea: true });
    // Finished projects, folded until opened (remembered per area, like the Done list).
    const closed = st.closedProjects;
    if (closed.length) {
      const ui = this.plugin.settings.ui; const key = `${a.path}#projects`;
      const sec = el(main, 'div', 'a4pj-closed a4pj-gap');
      const open = !!ui.doneOpen[key];
      const h = el(sec, 'button', 'a4pj-sec-head' + (open ? '' : ' is-folded'));
      h.setAttr('aria-expanded', String(open));
      setIcon(el(h, 'span', 'a4pj-chev a4pj-ic'), 'chevron-down'); el(h, 'span', 'a4pj-kicker', 'Finished projects'); el(h, 'span', 'a4pj-count', String(closed.length));
      h.addEventListener('click', async () => { if (open) delete ui.doneOpen[key]; else ui.doneOpen[key] = true; this.render(true); await this.plugin.save(); });
      if (open) for (const p of closed) this.closedRow(sec, p);
    }
    this.taskSection(main, a, st, { label: 'Loose tasks', barFirst: true, gap: true, placeholder: 'Add a task: "send the monthly invoice friday", "!high due Monday"' });
    const file = this.plugin.engine.file(a.path);
    this.noteBody(main, a, file, 'Area note');
    const side = el(cols, 'div', 'a4pj-side');
    const c1 = el(side, 'div', 'a4pj-side-card');
    el(c1, 'div', 'a4pj-kicker', 'In this area');
    const stat = (...bits) => { const d = el(c1, 'div', 'a4pj-stat'); bits.forEach((b, i) => (i % 2 ? d.appendText(b) : el(d, 'b', null, String(b)))); };
    stat(np, ` open ${np === 1 ? 'project' : 'projects'}`);
    stat(closed.length, ` finished ${closed.length === 1 ? 'project' : 'projects'}`);
    stat(st.open, ` loose ${st.open === 1 ? 'task' : 'tasks'} open, `, st.done, ' done');
    el(c1, 'p', 'a4pj-small', 'An area never closes. Finished projects fold away under it.');
    this.notesCard(side, a, file);
  }

  // One row of a closed project (the Closed list's look).
  closedRow(sec, p) {
    const st = projectStats(p, this.tasks, this.today, this.cfg);
    const r = el(sec, 'div', 'a4pj-closed-row' + (p.status === 'done' ? '' : ' is-failed'));
    r.tabIndex = 0; r.setAttr('role', 'button');
    el(r, 'span', 'a4pj-nm', p.name);
    el(r, 'span', `a4pj-chip a4pj-st-${p.status}`, p.status === 'done' ? '✓ done' : `✕ ${p.status}`);
    el(r, 'span', 'a4pj-chip', p.sphere === 'work' ? 'Work' : p.sphere === 'personal' ? 'Personal' : 'Unsorted');
    if (st.total) el(r, 'span', 'a4pj-count', `${st.done}/${st.total} ${st.total === 1 ? 'task' : 'tasks'}`);
    el(r, 'span', 'a4pj-when', p.endDate ? `closed ${longDay(p.endDate)}` : '');
    const go = () => this.go({ page: 'project', project: p.path });
    r.addEventListener('click', go); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }

  // A project's (or an area's loose) tasks: the add box, the open list with its later and someday
  // tick boxes, then Done. o: { label, placeholder, barFirst (the bar above the add box), gap }.
  taskSection(main, p, st, o) {
    const cfg = this.cfg; const today = this.today;
    const mine = this.tasks.filter((t) => t.projectKey === p.key);
    const open = mine.filter((t) => !t.archived && (isOpenTask(t, cfg) || this.justDone.has(t.path)));
    const later = open.filter((t) => isLaterTask(t, today));
    const someday = open.filter((t) => isSomeday(t));
    const showLater = !!this.plugin.settings.ui.later[p.path];
    const showSomeday = !!this.plugin.settings.ui.someday[p.path];
    if (!o.barFirst) this.quickAdd(main, { project: p, placeholder: o.placeholder });
    const lb = el(main, 'div', 'a4pj-lbar' + (o.gap ? ' a4pj-gap' : ''));
    el(lb, 'span', 'a4pj-kicker', o.label); el(lb, 'span', 'a4pj-count', String(open.length - later.length - someday.length));
    if (st.overdue) { const b = el(lb, 'button', 'a4pj-btn a4pj-small is-warn', `Move ${st.overdue} overdue to today`); b.addEventListener('click', () => this.plugin.moveOverdueToToday(p.key)); }
    if (later.length) {
      const tg = el(lb, 'label', 'a4pj-toggle');
      const cb = el(tg, 'input'); cb.type = 'checkbox'; cb.checked = showLater;
      tg.appendText(`Show later tasks (${later.length})`);
      cb.addEventListener('change', async () => { if (cb.checked) this.plugin.settings.ui.later[p.path] = true; else delete this.plugin.settings.ui.later[p.path]; this.render(true); await this.plugin.save(); });
    }
    // Someday (mockup approved 2026-10-06): hidden until ticked, like later tasks.
    if (someday.length) {
      const tg = el(lb, 'label', 'a4pj-toggle a4pj-toggle-someday');
      const cb = el(tg, 'input'); cb.type = 'checkbox'; cb.checked = showSomeday;
      tg.appendText(`Show someday tasks (${someday.length})`);
      cb.addEventListener('change', async () => { if (cb.checked) this.plugin.settings.ui.someday[p.path] = true; else delete this.plugin.settings.ui.someday[p.path]; this.render(true); await this.plugin.save(); });
    }
    if (o.barFirst) this.quickAdd(main, { project: p, placeholder: o.placeholder });
    const list = el(main, 'div', 'a4pj-list');
    const shown = open.filter((t) => (isSomeday(t) ? showSomeday : (showLater || !isLaterTask(t, today))));
    const sorted = [...sortOpenTasks(shown.filter((t) => !isSomeday(t) && !isLaterTask(t, today)), today, cfg), ...sortOpenTasks(shown.filter((t) => isLaterTask(t, today)), today, cfg), ...sortOpenTasks(shown.filter((t) => isSomeday(t)), today, cfg)];
    if (!sorted.length) el(list, 'div', 'a4pj-empty', 'nothing open here');
    for (const t of sorted) this.taskRow(list, t, { inProject: true });
    // Done
    const done = doneGroups(mine, cfg).filter((d) => !this.justDone.has(d.task.path));
    const ui = this.plugin.settings.ui;
    const ds = el(main, 'div', 'a4pj-done');
    const dOpen = !!ui.doneOpen[p.path];
    const dh = el(ds, 'button', 'a4pj-sec-head' + (dOpen ? '' : ' is-folded'));
    dh.setAttr('aria-expanded', String(dOpen));
    setIcon(el(dh, 'span', 'a4pj-chev a4pj-ic'), 'chevron-down'); el(dh, 'span', 'a4pj-kicker', 'Done'); el(dh, 'span', 'a4pj-count', String(done.length));
    dh.addEventListener('click', async () => { if (dOpen) delete ui.doneOpen[p.path]; else ui.doneOpen[p.path] = true; this.render(true); await this.plugin.save(); });
    if (dOpen) {
      const all = this.showAllDone === p.path;
      let last = null;
      for (const d of all ? done : done.slice(0, DONE_PREVIEW)) {
        if (d.day !== last) { last = d.day; el(ds, 'div', 'a4pj-done-day', d.day ? (d.day === today ? 'Today' : shortDay(d.day, today)) : 'Earlier'); }
        this.taskRow(ds, d.task, { inProject: true, inDone: true });
      }
      if (!all && done.length > DONE_PREVIEW) { const m = el(ds, 'button', 'a4pj-more', `Show all ${done.length}`); m.addEventListener('click', () => { this.showAllDone = p.path; this.render(true); }); }
    }
  }

  // The note's own body, rendered.
  noteBody(main, p, file, label) {
    const body = el(main, 'div', 'a4pj-body-note');
    el(body, 'div', 'a4pj-kicker', label);
    const md = el(body, 'div', 'a4pj-md markdown-rendered');
    if (!file) return;
    this.bodyComp = new Component(); this.bodyComp.load();
    const comp = this.bodyComp;
    this.app.vault.cachedRead(file).then((text) => {
      if (comp !== this.bodyComp) return;
      const src = projectBodyForPage(text);
      if (!src) { el(md, 'div', 'a4pj-muted', 'The note is empty.'); return; }
      return MarkdownRenderer.render(this.app, src, md, p.path, comp);
    }).catch((e) => console.warn('[LifeWorld] note render failed', e));
  }

  // Notes (mockup Option B, 2026-10-17): the "## Notes" entries as a timeline, newest first.
  notesCard(side, p, file) {
    const today = this.today;
    const nc = el(side, 'div', 'a4pj-notes');
    const nh = el(nc, 'div', 'a4pj-notes-head'); el(nh, 'span', 'a4pj-kicker', 'Notes');
    const tl = el(nc, 'div', 'a4pj-ntl');
    if (file) this.app.vault.cachedRead(file).then((text) => {
      const all = projectNotes(text);
      if (!all.length) { el(tl, 'div', 'a4pj-muted', 'No notes yet. Switch the add box to Note to add one.'); return; }
      el(nh, 'span', 'a4pj-count', String(all.length));
      const showAll = this.showAllNotes === p.path;
      all.slice(0, showAll ? all.length : NOTES_PREVIEW).forEach((n, i) => {
        const it = el(tl, 'div', 'a4pj-nitem' + (i === 0 ? ' is-latest' : ''));
        el(it, 'div', 'a4pj-ndate', n.day ? (n.day === today ? 'Today' : shortDay(n.day, today)) : '');
        this.noteText(el(it, 'div', 'a4pj-ntext'), n.text, p.path);
      });
      if (!showAll && all.length > NOTES_PREVIEW) { const m = el(tl, 'button', 'a4pj-more', `Show all ${all.length}`); m.addEventListener('click', () => { this.showAllNotes = p.path; this.render(true); }); }
    }).catch((e) => console.warn('[LifeWorld] notes read failed', e));
  }

  // A note's text as plain words with its wikilinks clickable (the card's links open like Goal and Client).
  noteText(parent, text, from) {
    for (const part of String(text).replace(/!\[\[[^\]]*\]\]/g, '').split(/(\[\[[^\]]+\]\])/)) {
      if (part.startsWith('[[')) {
        const a = el(parent, 'a', 'a4pj-link', wikilinkLabel(part)); a.tabIndex = 0; a.setAttr('role', 'link');
        a.addEventListener('click', () => this.openLink(part, from));
        a.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.openLink(part, from); });
      } else {
        const t = plainLine(part); // plainLine trims, so the spaces around links are put back
        if (t) parent.appendText(`${/^\s/.test(part) ? ' ' : ''}${t}${/\s$/.test(part) ? ' ' : ''}`);
      }
    }
  }

  // Note mode of the add box: a dated entry under the project note's "## Notes", written with
  // vault.process so nothing else in the note changes.
  async addProjectNote(p, text) {
    const f = this.plugin.engine.file(p.path);
    if (!f) throw new Error('The project note is missing.');
    const day = this.plugin.engine.today();
    await this.app.vault.process(f, (old) => appendProjectNote(old, day, text));
  }

  openLink(link, from) {
    const t = wikilinkTarget(link);
    if (t) this.app.workspace.openLinkText(t, from || '', 'tab');
  }

  /* ---- quick add (plain words) -------------------------------------------- */

  quickAdd(parent, o) {
    const qa = el(parent, 'div', 'a4pj-qa');
    // Project page: the "Add a task" label is a Task / Note menu (mockup Option B). Task each time the page opens.
    let note = !!o.project && this.noteFor === o.project.path;
    const row = o.project ? el(qa, 'div', 'a4pj-qa-row') : qa;
    const mode = o.project ? el(row, 'button', 'a4pj-qa-mode') : null;
    const inp = el(row, 'input'); inp.type = 'text'; inp.dataset.focus = `qa:${o.project ? o.project.path : 'inbox'}`;
    const parse = el(qa, 'div', 'a4pj-parse');
    const setMode = (n) => {
      note = n;
      if (o.project) this.noteFor = n ? o.project.path : null;
      inp.placeholder = n ? "What happened, or what you're waiting on" : this.narrow && o.project ? 'Add a task: "call Max friday !high"' : o.placeholder;
      inp.setAttr('aria-label', n ? 'Add a note' : 'Add a task');
      qa.toggleClass('is-note', n);
      if (mode) {
        mode.empty(); mode.appendText(n ? 'Add a note' : 'Add a task'); setIcon(el(mode, 'span', 'a4pj-ic'), 'chevron-down');
        mode.setAttr('aria-label', `${n ? 'Add a note' : 'Add a task'}, change mode`);
      }
    };
    if (mode) {
      mode.setAttr('aria-haspopup', 'menu');
      mode.addEventListener('click', () => {
        const m = new Menu();
        for (const n of [false, true]) m.addItem((i) => i.setTitle(n ? 'Add a note' : 'Add a task').setChecked(note === n).onClick(() => { setMode(n); show(); inp.focus(); }));
        const r = mode.getBoundingClientRect();
        m.showAtPosition({ x: r.left, y: r.bottom });
      });
    }
    const show = () => {
      parse.empty();
      if (note) { el(parse, 'span', 'a4pj-hint', "Saved under Notes in the project note, with today's date."); return; }
      if (!inp.value.trim()) { el(parse, 'span', 'a4pj-hint', 'Dates, times (friday 3pm), mornings and afternoons, repeats and priority are picked up as you type.'); return; }
      const r = understand(inp.value, this.today);
      el(parse, 'span', 'a4pj-hint', 'Adds:');
      for (const c of quickAddChips(r, this.today, o.project ? o.project.name : null, this.cfg.defaultPriority)) el(parse, 'span', 'a4pj-chip is-got', c);
      el(parse, 'span', 'a4pj-hint', '· Enter');
    };
    inp.addEventListener('input', show);
    inp.addEventListener('blur', () => { if (this.pending && !inp.value) this.scheduleRender(); });
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing || !inp.value.trim()) return;
      e.preventDefault();
      if (note) {
        const typed = inp.value;
        inp.value = '';
        try { await this.addProjectNote(o.project, typed); this.plugin.toast.show(`Note added to ${o.project.name}`); }
        catch (err) { console.error('[LifeWorld] note failed', err); new Notice(`Could not add that note. ${err && err.message ? err.message : ''}`); inp.value = typed; }
        this.scheduleRender();
        window.setTimeout(() => { const i = this.contentEl.querySelector(`[data-focus="${CSS.escape(inp.dataset.focus)}"]`); if (i) i.focus(); }, 300);
        return;
      }
      const r = understand(inp.value, this.today);
      if (!r.title) return;
      const { input, lane } = quickAddPlan(r, this.today);
      if (o.project) input.projects = [projectLinkFor(o.project.path)];
      if (lane) { const orders = this.plugin.laneOrders(this.tasks.filter((t) => !t.archived), lane.day, lane.half); input.customFrontmatter.planned_order = orderForInsert(orders, orders.length); }
      if (!Object.keys(input.customFrontmatter).length) delete input.customFrontmatter;
      inp.value = ''; show();
      try {
        const w = await this.plugin.createTask(input);
        this.plugin.toast.show(o.project ? `Added to ${o.project.name}` : (r.due || r.plannedDay || r.recurrence ? 'Added (it has a day, so it skips the Inbox)' : 'Captured'), w.undo);
      } catch (err) { console.error('[LifeWorld] add failed', err); new Notice(`Could not add that task. ${err && err.message ? err.message : ''}`); inp.value = r.title; }
      this.scheduleRender();
      window.setTimeout(() => { const i = this.contentEl.querySelector(`[data-focus="${CSS.escape(inp.dataset.focus)}"]`); if (i) i.focus(); }, 300);
    });
    setMode(note);
    show();
    return inp;
  }

  /* ---- a task row ----------------------------------------------------------- */

  taskRow(parent, t, o) {
    const cfg = this.cfg; const today = this.today;
    const pendingDone = this.justDone.has(t.path);
    const done = pendingDone || (!t.recurrenceRaw && !isOpenTask(t, cfg));
    const blocked = !done && !o.inDone && isBlockedTask(t);
    const r = el(parent, 'div', 'a4pj-task' + (done ? ' is-done' : '') + ((isLaterTask(t, today) || isSomeday(t)) && !done ? ' is-later' : '') + (blocked ? ' is-blocked' : ''));
    r.dataset.path = t.path;
    if (o.inProject && !o.inDone) {
      const has = t.steps && t.steps.total;
      const ex = el(r, 'button', 'a4pj-expand' + (has ? (this.expanded.has(t.path) ? ' is-open' : '') : ' is-blank'));
      setIcon(ex, 'chevron-right');
      if (has) { ex.setAttr('aria-label', this.expanded.has(t.path) ? 'Hide steps' : 'Show steps'); ex.addEventListener('click', () => { if (this.expanded.has(t.path)) this.expanded.delete(t.path); else this.expanded.add(t.path); this.render(true); }); }
      else ex.tabIndex = -1;
    }
    const tick = el(r, 'button', 'a4pj-tick' + (done ? ' is-on' : ''));
    if (done) setIcon(tick, 'check');
    tick.setAttr('aria-label', done ? 'Mark not done' : 'Mark done');
    tick.dataset.focus = `tick:${t.path}`;
    tick.addEventListener('click', (e) => { e.stopPropagation(); this.tick(t, r, tick); });
    const m = el(r, 'div', 'a4pj-tmain');
    const tt = el(m, 'div', 'a4pj-ttitle is-link', t.title);
    tt.setAttr('role', 'link'); tt.tabIndex = 0;
    const openIt = () => this.plugin.openTask(t);
    tt.addEventListener('click', openIt);
    tt.addEventListener('keydown', (e) => { if (e.key === 'Enter') openIt(); });
    const meta = el(m, 'div', 'a4pj-tmeta');
    if (blocked) lockChip(meta, t.openBlockers, (p) => this.plugin.openFile(p), this.popOpts());
    priorityChip(meta, t.priority, cfg);
    if (o.showProject && t.projectKey) {
      el(meta, 'span', 'a4pj-chip a4pj-proj', t.project || t.projectKey);
      const p = this.projects.find((x) => x.key === t.projectKey); // its project's area, when it has one
      if (p && p.areaName) iconChip(meta, 'a4pj-proj', p.areaName, 'layers');
    }
    if (o.inbox && t.dateCreated) el(meta, 'span', 'a4pj-chip', `added ${shortDay(t.dateCreated, today)}`);
    if (!o.inDone) this.dateChips(meta, t);
    else if (t.archived) el(meta, 'span', 'a4pj-chip', 'archived');
    if (t.steps && t.steps.total) el(meta, 'span', 'a4pj-chip', `${t.steps.done}/${t.steps.total} steps`);
    if (!done && !o.inDone && !o.inbox && !t.recurrenceRaw) {
      const sb = el(r, 'button', 'a4pj-sched'); setIcon(sb, 'calendar'); sb.setAttr('aria-label', 'Schedule'); sb.dataset.focus = `sched:${t.path}`;
      sb.addEventListener('click', (e) => { e.stopPropagation(); this.openSchedule(t, sb); });
    }
    if (o.inbox) {
      const acts = el(r, 'div', 'a4pj-acts');
      const pb = el(acts, 'button', 'a4pj-btn a4pj-small'); setIcon(el(pb, 'span', 'a4pj-ic'), 'folder'); pb.appendText('Project');
      pb.addEventListener('click', (e) => { e.stopPropagation(); this.openProjectPick(t, pb, r); });
      const sb = el(acts, 'button', 'a4pj-btn a4pj-small'); setIcon(el(sb, 'span', 'a4pj-ic'), 'calendar'); sb.appendText('Schedule');
      sb.addEventListener('click', (e) => { e.stopPropagation(); this.openSchedule(t, sb, r); });
    }
    if (o.inProject && !o.inDone && this.expanded.has(t.path)) this.renderSteps(parent, t);
    return r;
  }

  dateChips(meta, t) {
    const today = this.today; const cfg = this.cfg;
    const open = isOpenTask(t, cfg);
    if (isSomeday(t) && open) el(meta, 'span', 'a4pj-chip', 'someday');
    if (t.start && open && (t.recurrenceRaw ? t.start > today : true)) {
      iconChip(meta, 'is-start', `Starts ${shortDay(t.start, today)}${t.startTime ? `, ${timeText(t.startTime)}` : ''}`, 'calendar', t.ext ? null : (c) => this.pickDate(t, 'start', c), 'Start date and time: the first day it shows up. Open the calendar');
    }
    if (t.due && !t.recurrenceRaw) {
      const late = isOverdueTask(t, today, cfg) && t.due < today;
      const d = daysBetween(t.due, today);
      const tm = t.dueTime ? `, ${timeText(t.dueTime)}` : '';
      iconChip(meta, late ? 'is-warn' : (t.due === today ? 'is-today' : 'is-due'), late ? `Due ${shortDay(t.due, today)}${tm} · ${d}d late` : `Due ${shortDay(t.due, today)}${tm}`, 'calendar',
        open && !t.ext ? (c) => this.pickDate(t, 'due', c) : null, 'Due date and time: when it must be done. Open the calendar');
    }
    if (t.plannedDay && t.plannedDay !== t.due && !t.recurrenceRaw) el(meta, 'span', 'a4pj-chip' + (t.plannedDay < today && open ? ' is-warn' : ''), `On ${shortDay(t.plannedDay, today)}${t.plannedHalf ? `, ${halfWord(t.plannedHalf)}` : ''}`);
    else if (t.due && t.plannedHalf && !t.dueTime && !t.recurrenceRaw) el(meta, 'span', 'a4pj-chip', halfWord(t.plannedHalf));
    if (t.recurrenceRaw) el(meta, 'span', 'a4pj-chip', `${repeatWords(t.recurrenceRaw).replace(/^Every/, 'repeats every').replace(/^Repeats/, 'repeats')}${t.time ? `, ${timeText(t.time)}` : (t.plannedHalf ? `, ${halfWord(t.plannedHalf)}` : '')}`);
  }

  async tick(t, row, btn) {
    const cfg = this.cfg;
    if (row.hasClass('is-busy')) return;
    const today = this.plugin.engine.today();
    if (today !== this.renderedToday) { new Notice('A new day started; the page has been refreshed.'); this.render(true); return; }
    const wasDone = this.justDone.has(t.path) || (!t.recurrenceRaw && !isOpenTask(t, cfg));
    // A row ticked a moment ago: a second click is the same as Undo.
    if (this.justDone.has(t.path) && this.lastUndo && this.lastUndo.path === t.path) { const u = this.lastUndo.undo; this.clearJustDone(t.path); this.plugin.toast.hide(); if (u) await u(); this.render(true); return; }
    row.addClass('is-busy');
    row.toggleClass('is-done', !wasDone);
    btn.toggleClass('is-on', !wasDone); btn.empty(); if (!wasDone) setIcon(btn, 'check');
    const freed = !wasDone && !t.recurrenceRaw ? this.plugin.engine.freedBy(t.path) : [];
    try {
      const w = await this.plugin.completeTask(t, !wasDone);
      if (t.recurrenceRaw) {
        const res = w && w.result;
        const msg = res ? (res.done ? `Done for ${shortDay(res.day, today)}${res.next ? `; next one ${shortDay(res.next, today)}` : ''}` : `Back to open for ${shortDay(res.day, today)}`) : 'Done';
        this.plugin.toast.show(msg, w && w.undo);
      } else if (!wasDone) {
        this.justDone.set(t.path, window.setTimeout(() => { this.clearJustDone(t.path); this.render(); }, UNDO_MS));
        this.lastUndo = { path: t.path, undo: w && w.undo };
        this.plugin.toast.show(`Done: ${t.title}${unblocksText(freed)}`, w && w.undo ? async () => { this.clearJustDone(t.path); await w.undo(); this.render(true); } : null);
      } else {
        this.plugin.toast.show('Back to open', w && w.undo);
      }
    } catch (err) {
      console.error('[LifeWorld] tick failed', err);
      new Notice(`Could not update "${t.title}". ${err && err.message ? err.message : ''}`.trim());
      row.toggleClass('is-done', wasDone);
    } finally { row.removeClass('is-busy'); this.scheduleRender(); }
  }
  clearJustDone(path) { const t = this.justDone.get(path); if (t) window.clearTimeout(t); this.justDone.delete(path); if (this.lastUndo && this.lastUndo.path === path) this.lastUndo = null; }

  async renderSteps(parent, t) {
    const box = el(parent, 'div', 'a4pj-steps');
    const steps = await this.plugin.engine.steps(t.path);
    for (const s of steps) {
      const r = el(box, 'div', 'a4pj-step' + (s.done ? ' is-done' : ''));
      const tk = el(r, 'button', 'a4pj-tick a4pj-tick-sm' + (s.done ? ' is-on' : '')); if (s.done) setIcon(tk, 'check');
      tk.setAttr('aria-label', s.done ? 'Mark step not done' : 'Mark step done');
      tk.addEventListener('click', async () => {
        try { const w = await this.plugin.engine.toggleStep(t.path, s.line, !s.done); if (!w.result) new Notice('That step changed in the note; refreshing.'); } catch { new Notice('Could not update that step.'); }
        this.scheduleRender();
      });
      el(r, 'div', 'a4pj-step-t', s.text);
    }
    const add = el(box, 'div', 'a4pj-step-add');
    el(add, 'span', 'a4pj-plus', '+');
    const inp = el(add, 'input'); inp.type = 'text'; inp.placeholder = 'Add a step, press enter'; inp.dataset.focus = `step:${t.path}`;
    inp.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing || !inp.value.trim()) return;
      e.preventDefault();
      const v = inp.value; inp.value = '';
      try { const w = await this.plugin.engine.addStep(t.path, v); this.plugin.toast.show('Step added', w.undo); } catch { new Notice('Could not add that step.'); inp.value = v; }
      this.scheduleRender();
    });
  }

  /* ---- Inbox ---------------------------------------------------------------- */

  renderInbox(page) {
    const cfg = this.cfg;
    this.head(page, [['/ Projects', () => this.go({ page: 'overview' })]], 'Inbox');
    this.quickAdd(page, { placeholder: 'Capture something (no project or date needed)' });
    const list = this.tasks.filter((t) => isInboxTask(t, cfg) || (this.justDone.has(t.path) && !t.projectLink && !t.plannedDay))
      .sort((a, b) => (isBlockedTask(a) - isBlockedTask(b)) || priorityWeight(b.priority, cfg) - priorityWeight(a.priority, cfg) || String(b.dateCreated || '').localeCompare(String(a.dateCreated || '')) || a.title.localeCompare(b.title));
    const lb = el(page, 'div', 'a4pj-lbar');
    el(lb, 'span', 'a4pj-kicker', 'No project, no date'); el(lb, 'span', 'a4pj-count', String(list.length));
    if (!list.length) el(page, 'div', 'a4pj-empty', 'Inbox empty. Nice.');
    const box = el(page, 'div', 'a4pj-list a4pj-inbox');
    for (const t of list) this.taskRow(box, t, { inbox: true });
  }

  /* ---- popovers -------------------------------------------------------------- */

  leave(row) { if (row) row.addClass('is-leaving'); }

  pickDate(t, key, anchor) {
    openWhenPicker(anchor, { ...whenPickerOpts(t, key, this.today), ...this.popOpts(),
      onSave: async (r) => {
        try {
          const w = await saveWhen(this.plugin.engine, t, key, r);
          this.plugin.toast.show(whenToast(t, key, r, this.today), w && w.undo);
        } catch (e) { new Notice(String(e.message || e)); }
        this.scheduleRender();
      },
    });
  }

  openSchedule(t, anchor, row) {
    const today = this.today;
    new Pop(anchor, `Schedule · ${t.title}`, (box, pop) => {
      const tom = addDays(today, 1);
      const place = async (d, h) => {
        pop.close();
        try {
          const w = await this.plugin.placeTask(t, d, h, this.tasks.filter((x) => !x.archived));
          if (w) { this.leave(row); this.plugin.toast.show(`On ${shortDay(d, today)}${h ? `, ${halfWord(h)}` : ''}${w.dropsTime ? `. ${timeText(w.dropsTime)} time taken off` : ''}`, w.undo); }
        } catch (e) { console.error(e); new Notice(e && e.plain ? e.plain : 'That did not work. Nothing was changed.'); }
        this.scheduleRender();
      };
      for (const [label, d, h] of [['Today morning', today, 'am'], ['Today afternoon', today, 'pm'], ['Tomorrow morning', tom, 'am'], ['Tomorrow afternoon', tom, 'pm'], ['Any time today', today, null]]) {
        const b = el(box, 'button', 'a4pj-pop-q'); el(b, 'span', null, label); el(b, 'span', 'a4pj-k', `${WEEKDAYS_SHORT[weekdayOf(d)]} ${partsOf(d).d}`);
        b.addEventListener('click', () => place(d, h));
      }
      const other = el(box, 'button', 'a4pj-pop-q'); el(other, 'span', null, 'Another day…'); el(other, 'span', 'a4pj-k', 'calendar');
      other.addEventListener('click', () => { pop.close(); openDatePicker(anchor, { title: `Put it on · ${t.title}`, value: t.plannedDay, today, ...this.popOpts(), allowClear: false, onPick: (d) => { if (d) place(d, t.plannedHalf || null); } }); });
      // Someday (mockup approved 2026-10-06): no day, kept for later.
      // A task with a due date asks first: the due date comes off too.
      if (!isSomeday(t)) {
        const sd = el(box, 'button', 'a4pj-pop-q a4pj-pop-someday'); el(sd, 'span', null, 'Someday'); el(sd, 'span', 'a4pj-k', 'no day, kept for later');
        const go = async () => {
          pop.close();
          try { const w = await this.plugin.engine.someday(t.path); this.leave(row); this.plugin.toast.show(t.due ? 'Moved to Someday. The due date was taken off' : 'Moved to Someday', w.undo); }
          catch (e) { console.error(e); new Notice('That did not work. Nothing was changed.'); }
          this.scheduleRender();
        };
        sd.addEventListener('click', () => {
          if (!t.due) { go(); return; }
          box.empty();
          el(box, 'div', 'a4pj-pop-title', `Someday · ${t.title}`);
          el(box, 'div', 'a4pj-pop-note', `Due ${shortDay(t.due, today)}${t.dueTime ? `, ${timeText(t.dueTime)}` : ''}. Someday takes the due date off too, so it no longer sits on a day${t.dueTime && t.reminderSet != null ? ' or rings' : ''}.`);
          const yes = el(box, 'button', 'a4pj-wp-save a4pj-pop-go', 'Move to Someday'); yes.addEventListener('click', go);
          const no = el(box, 'button', 'a4pj-pop-q'); el(no, 'span', null, 'Keep the due date'); no.addEventListener('click', () => { pop.close(); this.openSchedule(t, anchor, row); });
          pop.place(); yes.focus();
        });
      }
      el(box, 'div', 'a4pj-pop-sep');
      for (const [k, lab] of [['start', 'Starts'], ['due', 'Due']]) {
        const r2 = el(box, 'div', 'a4pj-pop-row');
        el(r2, 'label', null, lab);
        const v = k === 'due' ? t.due : t.start;
        const vt = k === 'due' ? t.dueTime : t.startTime;
        const db = el(r2, 'button', 'a4pj-pick' + (v ? '' : ' is-dash')); setIcon(el(db, 'span', 'a4pj-ic'), 'calendar'); db.appendText(v ? `${shortDay(v, today)}${vt ? `, ${timeText(vt)}` : ''}` : 'Pick a date');
        db.addEventListener('click', (e) => { e.stopPropagation(); pop.close(); this.pickDate(t, k, anchor); });
      }
      el(box, 'div', 'a4pj-pop-note', 'Starts = the first day it shows up. Due = when it must be done; a due time rings.');
      if (t.plannedDay) {
        el(box, 'div', 'a4pj-pop-sep');
        const u = el(box, 'button', 'a4pj-pop-q'); el(u, 'span', null, 'Unschedule'); el(u, 'span', 'a4pj-k', t.due ? (planning.setsDue ? 'no day, no due date' : 'its due date stays') : 'no day');
        u.addEventListener('click', async () => { pop.close(); try { const w = await this.plugin.engine.unschedule(t.path); this.plugin.toast.show(unscheduledText(t), w.undo); } catch { new Notice('Could not unschedule it.'); } this.scheduleRender(); });
      }
    }, this.popOpts());
  }

  openProjectPick(t, anchor, row, onDone) {
    new Pop(anchor, `Move to project · ${t.title}`, (box, pop) => {
      const find = el(box, 'input', 'a4pj-input a4pj-find'); find.type = 'text'; find.placeholder = 'Find a project';
      const host = el(box, 'div', 'a4pj-pop-list');
      const choose = async (p) => {
        pop.close();
        try {
          const w = await this.plugin.engine.setProject(t.path, p ? p.path : null);
          if (p) this.leave(row);
          this.plugin.toast.show(p ? `Moved to ${p.name}` : 'Back to the Inbox', w.undo);
        } catch { new Notice('Could not move it.'); }
        if (onDone) onDone(); else this.scheduleRender();
      };
      const draw = () => {
        host.empty();
        const q = find.value.trim().toLowerCase();
        const n = this.plugin.engine.collectNotes();
        for (const g of projectPickGroups([...n.areas, ...n.projects], q, (p) => isOpenProject(p) && p.status !== 'backlog', (a, b) => (a.status !== 'active') - (b.status !== 'active') || a.name.localeCompare(b.name))) {
          el(host, 'div', 'a4pj-grp', g.label);
          for (const p of g.notes) projectPickRow(host, p, t.projectKey, choose);
        }
        if (t.projectLink) { el(host, 'div', 'a4pj-pop-sep'); const nb = el(host, 'button', 'a4pj-pop-q'); el(nb, 'span', null, 'No project (back to Inbox)'); nb.addEventListener('click', () => choose(null)); }
      };
      find.addEventListener('input', draw);
      find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = host.querySelector('.a4pj-pop-q'); if (b) b.click(); } });
      draw();
    }, { ...this.popOpts(), cls: 'is-wide' });
  }
}

/* ========================================================================== *
 * The task card: shown above a task note in the normal note view.
 * Obsidian's Properties list and the inline title are hidden on task notes
 * (display only, a class on the view); "All properties" brings them back.
 * The note itself is never changed by showing the card.
 * ========================================================================== */

class TaskCardManager {
  constructor(plugin) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.showProps = new WeakMap(); // view -> true when "All properties" is open
    this.observers = new Map();     // view -> MutationObserver (Reading view is drawn lazily)
    this.timer = null;
  }
  start() {
    const p = this.plugin;
    const later = () => this.schedule();
    p.registerEvent(this.app.workspace.on('layout-change', later));
    p.registerEvent(this.app.workspace.on('file-open', later));
    p.registerEvent(this.app.workspace.on('active-leaf-change', later));
    p.registerEvent(this.app.workspace.on('resize', later));
    // Another task changing can change this card's Blocked by / Blocks rows.
    p.registerEvent(this.app.metadataCache.on('changed', (f) => { if (this.shownPaths().has(f.path)) this.schedule(); else if (f.path.startsWith(vaultFolders.projects + '/')) this.schedule(); else if (f.path.startsWith(vaultFolders.tasks + '/') && this.anyTaskShown()) this.schedule(); }));
    p.registerEvent(this.app.vault.on('delete', () => { if (this.anyTaskShown()) this.schedule(); }));
    p.registerEvent(this.app.vault.on('rename', later));
    this.refreshAll();
  }
  stop() {
    if (this.timer) window.clearTimeout(this.timer);
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) this.clear(leaf.view);
    for (const o of this.observers.values()) o.disconnect();
    this.observers.clear();
  }
  // A view's card host that has no card yet (e.g. Reading view drawn just now).
  missing(view) { return this.hosts(view).some((h) => !h.parent.querySelector(':scope > .a4pj-card')); }
  watch(view) {
    if (this.observers.has(view) || typeof MutationObserver === 'undefined') return;
    const o = new MutationObserver(() => { if (view.file && view.containerEl.hasClass('a4pj-task-note') && this.missing(view)) this.refresh(view); });
    o.observe(view.contentEl, { childList: true, subtree: true });
    this.observers.set(view, o);
  }
  schedule() { if (this.timer) window.clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.timer = null; this.refreshAll(); }, 120); }
  anyTaskShown() { return this.app.workspace.getLeavesOfType('markdown').some((l) => l.view && l.view.containerEl && l.view.containerEl.hasClass('a4pj-task-note')); }
  shownPaths() { const s = new Set(); for (const l of this.app.workspace.getLeavesOfType('markdown')) if (l.view && l.view.file) s.add(l.view.file.path); return s; }

  refreshAll() {
    const live = new Set(this.app.workspace.getLeavesOfType('markdown').map((l) => l.view));
    for (const [v, o] of this.observers) if (!live.has(v)) { o.disconnect(); this.observers.delete(v); }
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const v = leaf.view;
      if (!(v instanceof MarkdownView)) continue;
      try { this.refresh(v); } catch (e) { console.error('[LifeWorld] task card failed', e); }
    }
  }

  clear(view) {
    if (!view || !view.containerEl) return;
    const o = this.observers.get(view); if (o) { o.disconnect(); this.observers.delete(view); }
    view.containerEl.removeClass('a4pj-task-note', 'a4pj-hide-props', 'a4pj-builtin');
    view.containerEl.querySelectorAll('.a4pj-card').forEach((c) => c.remove());
  }

  hosts(view) {
    const out = [];
    const sizer = view.contentEl.querySelector('.markdown-source-view .cm-sizer');
    if (sizer) {
      const content = sizer.querySelector(':scope > .cm-contentContainer');
      out.push({ mode: 'source', parent: sizer, before: content || sizer.firstChild });
    }
    const ps = view.contentEl.querySelector('.markdown-reading-view .markdown-preview-sizer');
    if (ps) {
      const header = ps.querySelector(':scope > .mod-header');
      if (header) out.push({ mode: 'preview', parent: header, before: null });
      else out.push({ mode: 'preview', parent: ps, before: ps.firstChild });
    }
    return out;
  }

  refresh(view) {
    const file = view.file;
    const engine = this.plugin.engine;
    if (!file || !engine.isTaskFile(file)) { this.clear(view); return; }
    const c = view.containerEl;
    c.addClass('a4pj-task-note');
    this.watch(view);
    c.toggleClass('a4pj-hide-props', this.plugin.settings.hideProps && !this.showProps.get(view));
    c.toggleClass('a4pj-builtin', this.plugin.usesBuiltIn());
    for (const h of this.hosts(view)) {
      let card = h.parent.querySelector(':scope > .a4pj-card');
      if (!card) { card = createDiv({ cls: 'a4pj-card a4pj-root-card' }); h.parent.insertBefore(card, h.before); }
      else if (h.before && card.nextSibling !== h.before) h.parent.insertBefore(card, h.before);
      const ae = document.activeElement;
      if (card.contains(ae) && (ae.isContentEditable || (ae.tagName === 'INPUT' && ae.value))) continue; // never redraw under the cursor
      this.render(card, view, file);
    }
    // A card left in a host that is gone from this file's view.
    c.querySelectorAll('.a4pj-card').forEach((x) => { if (x.dataset.path && x.dataset.path !== file.path) x.remove(); });
  }

  // Redrawing empties the card first. On a short note the page then has
  // nothing to scroll for a moment, the browser sets the scroll back to the
  // top, and it stays there once the card is back. Holding the card's height
  // while it is redrawn keeps the page exactly where it was.
  render(card, view, file) {
    const hold = card.isConnected ? card.offsetHeight : 0;
    if (hold) card.style.minHeight = `${hold}px`;
    try { this.draw(card, view, file); } finally { card.style.removeProperty('min-height'); }
  }

  draw(card, view, file) {
    const plugin = this.plugin; const engine = plugin.engine;
    const cfg = engine.cfg(); const today = engine.today();
    const fm = engine.fm(file);
    const inArchive = file.path.startsWith(`${cfg.archiveFolder}/`);
    const t = readTask(fm, file.path, file.basename, cfg, inArchive);
    if (!t) { card.remove(); return; }
    const cache = this.app.metadataCache.getFileCache(file);
    const items = ((cache && cache.listItems) || []).filter((li) => li.task !== undefined && li.parent < 0);
    t.steps = { total: items.length, done: items.filter((li) => li.task !== ' ').length };
    card.empty();
    card.dataset.path = file.path;
    const narrow = view.contentEl.clientWidth > 0 && view.contentEl.clientWidth <= NARROW_WIDTH;
    card.toggleClass('is-narrow', narrow);
    setCardAccent(card, plugin.app);
    const popOpts = { narrow, host: view.contentEl };
    const project = engine.noteForKey(t.projectKey); // a project or an area (a loose task)
    const open = isOpenTask(t, cfg);
    const done = !t.recurrenceRaw && !open;
    const refresh = () => this.schedule();
    const act = async (fn, msg) => { try { const w = await fn(); if (msg) plugin.toast.show(typeof msg === 'function' ? msg(w) : msg, w && w.undo); } catch (e) { console.error('[LifeWorld] card', e); new Notice(String((e && (e.plain || e.message)) || e)); } refresh(); };

    // crumb + buttons
    const bar = el(card, 'div', 'a4pj-card-bar');
    const cr = el(bar, 'div', 'a4pj-crumb');
    // The Projects pages switched off (section 1): the crumb is plain text and the project opens its note.
    if (plugin.pagesOff) cr.appendText('/ Projects');
    else { const b1 = el(cr, 'button', null, '/ Projects'); b1.addEventListener('click', () => plugin.openProjects({ page: 'overview' })); }
    cr.appendText(' / ');
    if (project) { const b2 = el(cr, 'button', null, project.name); b2.addEventListener('click', () => (plugin.pagesOff ? this.app.workspace.openLinkText(project.path, '', false) : plugin.openProject(project.path))); }
    else if (t.projectKey) cr.appendText(t.project || t.projectKey);
    else if (plugin.pagesOff) cr.appendText('Inbox');
    else { const b3 = el(cr, 'button', null, 'Inbox'); b3.addEventListener('click', () => plugin.openProjects({ page: 'inbox' })); }
    cr.appendText(inArchive ? ' / Task (archived)' : ' / Task');
    const acts = el(bar, 'div', 'a4pj-actions');
    if (plugin.plannerOn()) el(acts, 'button', 'a4pj-btn', 'Open in Planner').addEventListener('click', () => plugin.openPlanner(null));
    if (plugin.todayOn()) el(acts, 'button', 'a4pj-btn', 'Show on Today').addEventListener('click', () => { if (t.plannedDay !== today && !(t.recurrenceRaw && taskOnDay(t, today))) new Notice('Not on today yet: choose a day to put it there.'); plugin.openToday(); });

    // tick + name
    const top = el(card, 'div', 'a4pj-card-top');
    const big = el(top, 'button', 'a4pj-bigtick' + (done ? ' is-on' : ''));
    if (done) setIcon(big, 'check');
    big.setAttr('aria-label', done ? 'Mark not done' : (t.recurrenceRaw ? 'Mark this occurrence done' : 'Mark done'));
    big.addEventListener('click', () => { const freed = !done && !t.recurrenceRaw ? engine.freedBy(t.path) : []; act(() => plugin.completeTask(t, !done), (w) => {
      if (t.recurrenceRaw) { const r = w && w.result; return r ? (r.done ? `Done for ${shortDay(r.day, today)}${r.next ? `; next one ${shortDay(r.next, today)}` : ''}` : `Back to open for ${shortDay(r.day, today)}`) : 'Done'; }
      return done ? 'Back to open' : `Done: ${t.title}${unblocksText(freed)}`;
    }); });
    const name = el(top, 'div', 'a4pj-tname' + (done ? ' is-done' : ''), t.title);
    name.contentEditable = 'true'; name.spellcheck = false; name.setAttr('aria-label', 'Task name'); name.setAttr('role', 'textbox');
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } if (e.key === 'Escape') { name.textContent = t.title; name.blur(); } });
    name.addEventListener('blur', () => { const v = (name.textContent || '').replace(/\s+/g, ' ').trim(); if (v && v !== t.title) act(() => engine.rename(t.path, v), 'Renamed'); else name.textContent = t.title; });

    const f = el(card, 'div', 'a4pj-fields');
    const row = (lab) => { el(f, 'div', 'a4pj-lab', lab); return el(f, 'div', 'a4pj-val'); };
    // Project
    const pb = el(row('Project'), 'button', 'a4pj-pick'); setIcon(el(pb, 'span', 'a4pj-ic'), 'folder');
    pb.appendText(project ? project.name : (t.projectKey ? t.project || t.projectKey : 'No project (Inbox)')); setIcon(el(pb, 'span', 'a4pj-ic a4pj-caret'), 'chevron-down');
    pb.addEventListener('click', (e) => { e.stopPropagation(); this.projectPick(t, pb, popOpts, refresh); });
    // Status
    const ss = el(row('Status'), 'div', 'a4pj-seg a4pj-stseg');
    const stOf = statusString(fm[cfg.F.status]);
    for (const [k, lab] of [['open', 'Open'], ['in-progress', 'In progress'], ['blocked', 'Waiting']]) {
      if (!cfg.statuses.some((s) => s.value === k)) continue;
      const b = el(ss, 'button', stOf === k ? 'is-on' : '', lab);
      b.dataset.st = k;
      b.addEventListener('click', () => { if (stOf !== k) act(() => engine.setStatus(t.path, k), `Status: ${lab}`); });
    }
    // Priority
    const ps = el(row('Priority'), 'div', 'a4pj-prisel');
    for (const pr of [...cfg.priorities].sort((a, b) => b.weight - a.weight)) {
      const b = el(ps, 'button', String(t.priority) === pr.value ? 'is-on' : '');
      priorityChip(b, pr.value, cfg);
      b.setAttr('aria-pressed', String(String(t.priority) === pr.value));
      b.addEventListener('click', () => { if (String(t.priority) !== pr.value) act(() => engine.setProperty(t.path, 'priority', pr.value), `Priority: ${pr.label}`); });
    }
    // When (day + half)
    const vw = row('When');
    if (t.recurrenceRaw) el(vw, 'span', 'a4pj-muted', 'by its repeat');
    else {
      const wb = el(vw, 'button', 'a4pj-pick' + (t.plannedDay ? (t.plannedDay < today && open ? ' is-late' : '') : ' is-dash'));
      setIcon(el(wb, 'span', 'a4pj-ic'), 'calendar');
      wb.appendText(t.plannedDay ? (t.due && t.due === t.plannedDay ? `${shortDay(t.plannedDay, today)} (its due day)` : shortDay(t.plannedDay, today)) : 'Not planned');
      wb.addEventListener('click', (e) => {
        e.stopPropagation();
        openDatePicker(wb, { title: `When · ${t.title}`, value: t.plannedDay, today, ...popOpts, allowClear: !!t.plannedDay,
          note: planning.setsDue ? 'The day you pick becomes its due date (same as the Planner).' : (t.due ? 'The day to do it (Today and the Planner). Its due date stays.' : 'The day to do it (Today and the Planner).'),
          onPick: (d) => act(async () => d ? plugin.placeTask(t, d, t.plannedHalf || null, engine.collectTasks(false)) : engine.unschedule(t.path), d ? `On ${shortDay(d, today)}` : unscheduledText(t)) });
      });
    }
    // A clock time on Due (or a repeating task's start) picks the half itself:
    // the buttons give way to one line saying so (change it on Due / Starts).
    if (t.time) {
      const ln = el(vw, 'span', 'a4pj-auto');
      setIcon(el(ln, 'span', 'a4pj-ic'), 'clock');
      ln.appendText(`${halfOfTime(t.time) === 'am' ? 'Morning' : 'Afternoon'}, from the ${timeText(t.time)} ${t.recurrenceRaw ? 'start' : 'due'} time`);
    } else {
      const hs = el(vw, 'div', 'a4pj-seg a4pj-halfseg');
      for (const [k, lab] of [['am', 'Morning'], ['pm', 'Afternoon'], ['', 'Any time']]) {
        const b = el(hs, 'button', (t.plannedHalf || '') === k ? 'is-on' : '', lab);
        b.dataset.half = k || 'any';
        b.addEventListener('click', () => {
          if ((t.plannedHalf || '') === k) return;
          const half = k || null;
          if (t.recurrenceRaw) act(() => engine.write(t.path, (x) => { if (half) x.planned_half = half; else delete x.planned_half; }), lab);
          else act(() => plugin.placeTask(t, t.plannedDay || today, half, engine.collectTasks(false)), `${t.plannedDay ? shortDay(t.plannedDay, today) : 'Today'}, ${lab.toLowerCase()}`);
        });
      }
    }
    // Starts / Due
    // Starts / Due: a date and an optional clock time (task times v3). The
    // button opens the picker; the box understands plain words and shows what
    // it understood under it before Enter saves.
    for (const [k, lab, help] of [['start', 'Starts', 'first day it shows up'], ['due', 'Due', 'must be done by']]) {
      if (k === 'due' && t.recurrenceRaw && !t.due) continue;
      const v = row(lab);
      const val = k === 'due' ? t.due : t.start;
      const tm = k === 'due' ? t.dueTime : t.startTime;
      const late = k === 'due' && val && val < today && open && !t.recurrenceRaw;
      const dueToday = k === 'due' && val === today && open && !t.recurrenceRaw;
      const b = el(v, 'button', 'a4pj-pick' + (val ? '' : ' is-dash') + (late ? ' is-late' : '') + (dueToday ? ' is-today' : '') + (k === 'start' && val ? ' is-dash' : ''));  // a due time is shown plainly; the bell next to it carries the colour (reminder mockup)
      setIcon(el(b, 'span', 'a4pj-ic'), 'calendar'); b.appendText(val ? `${lab} ${shortDay(val, today)}${tm ? `, ${timeText(tm)}` : ''}` : 'Pick a date');
      b.setAttr('aria-label', `${lab} date and time, open the calendar (${help})`);
      const save = (r) => act(() => saveWhen(engine, t, k, r), whenToast(t, k, r, today));
      b.addEventListener('click', (e) => { e.stopPropagation(); openWhenPicker(b, { ...whenPickerOpts(t, k, today), ...popOpts, onSave: save }); });
      const tyw = el(v, 'span', 'a4pj-tyw');
      const ty = el(tyw, 'input', 'a4pj-typed'); ty.type = 'text'; ty.placeholder = k === 'start' ? 'type: monday 9am' : 'type: tomorrow at 4pm'; ty.setAttr('aria-label', `Type a ${lab.toLowerCase()} date and time`);
      const pv = el(tyw, 'div', 'a4pj-typed-pv'); pv.setAttr('aria-live', 'polite');
      const parse = () => parseWhen(ty.value, today, { day: val, time: tm }, k);
      const upd = () => {
        const r = parse();
        pv.empty(); pv.toggleClass('is-on', !!r); pv.toggleClass('is-err', !!(r && r.error));
        if (!r) return;
        pv.appendText(whenPreview(r, k, today, !!t.recurrenceRaw, reminderAfter(t, k, r)));
        if (!r.error) el(pv, 'span', 'a4pj-enter', 'Enter to save');
      };
      ty.addEventListener('input', upd);
      ty.addEventListener('blur', () => pv.removeClass('is-on'));
      ty.addEventListener('focus', upd);
      ty.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { ty.value = ''; upd(); return; }
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        const r = parse();
        if (!r || r.error) { upd(); return; }
        ty.value = ''; upd(); ty.blur(); // saved: the box empties so the card can redraw with the new value
        save({ day: r.day, time: r.time, half: r.time ? undefined : (r.half || undefined) });
      });
      if (val && !(k === 'start' && t.recurrenceRaw)) {
        const x = el(v, 'button', 'a4pj-x'); setIcon(x, 'x');
        const what = `Remove the ${lab === 'Due' ? 'due' : 'start'} date${tm ? ' and its time' : ''}`;
        x.setAttr('aria-label', what); x.setAttr('title', what);
        x.addEventListener('click', () => save(null));
      }
      // Only a due time rings (a repeating task's start time rings each time it
      // comes round). The bell says when, and is the button to change it.
      const rings = k === (t.recurrenceRaw ? 'start' : 'due');
      if (rings && val && open && !inArchive) {
        if (tm) this.bellButton(v, t, k, val, tm, popOpts, act);
        else el(v, 'span', 'a4pj-rem-hint', 'add a time to set a reminder');
      } else if (tm && !rings) b.setAttr('title', "A start time doesn't ring; reminders ring at the due time.");
    }
    // Repeats
    const rb = el(row('Repeats'), 'button', 'a4pj-pick' + (t.recurrenceRaw ? '' : ' is-dash'), repeatWords(t.recurrenceRaw));
    rb.addEventListener('click', (e) => { e.stopPropagation(); this.repeatPick(t, rb, popOpts, act); });
    // Blocked by / Blocks (dependencies mockup round 4)
    this.depRow(row('Blocked by'), t, 'by', popOpts, act);
    this.depRow(row('Blocks'), t, 'blocks', popOpts, act);
    const ob = open && !inArchive ? engine.openBlockers({ path: t.path, blockedBy: t.blockedBy }) : [];
    if (ob.length) { const bn = el(card, 'div', 'a4pj-blocked-note'); setIcon(el(bn, 'span', 'a4pj-ic'), 'lock'); el(bn, 'span', null, `Waiting on ${ob.map((b) => b.title).join(' and ')}. Shown dimmed and lower in lists until then.`); }
    // small meta + all properties
    const sm = el(card, 'div', 'a4pj-small-meta');
    el(sm, 'span', null, t.dateCreated ? `Created ${longDay(t.dateCreated)}` : 'Created: not recorded');
    el(sm, 'span', null, t.recurrenceRaw ? `${t.completeInstances.length} done so far` : (t.completedDate ? `Completed ${longDay(t.completedDate)}` : 'Not completed'));
    if (t.steps.total) el(sm, 'span', null, `Steps ${t.steps.done}/${t.steps.total} (the tick boxes in the note)`);
    if (plugin.settings.hideProps) {
      const n = Object.keys(fm || {}).length;
      const showing = !!this.showProps.get(view);
      const pl2 = el(sm, 'button', 'a4pj-linkbtn', showing ? 'Hide all properties' : `All properties (${n})`);
      pl2.addEventListener('click', () => { this.showProps.set(view, !showing); this.refresh(view); });
    }
    // add a step
    const add = el(card, 'div', 'a4pj-step-add');
    el(add, 'span', 'a4pj-plus', '+');
    const ai = el(add, 'input'); ai.type = 'text'; ai.placeholder = t.steps.total ? 'Add a step, press Enter (steps are the tick boxes below)' : 'Add a step, press Enter';
    ai.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing || !ai.value.trim()) return;
      e.preventDefault();
      const v = ai.value; ai.value = '';
      await act(() => engine.addStep(t.path, v), 'Step added');
    });
  }

  // The bell next to Due (reminder setup mockup): "4:15 PM · 15 min before",
  // or a dashed "No reminder". A click lists the choices with the time each
  // would ring; Other… takes typed words ("2 hours").
  bellButton(parent, t, k, day, tm, popOpts, act) {
    const engine = this.plugin.engine;
    const cur = t.reminderSet;
    const each = k === 'start' ? ' each time' : '';
    const b = el(parent, 'button', 'a4pj-bell' + (cur == null ? ' is-none' : ''));
    setIcon(el(b, 'span', 'a4pj-ic'), cur == null ? 'bell-off' : 'bell');
    b.appendText(cur == null ? 'No reminder' : `${ringText(day, tm, cur)}${cur ? ` · ${reminderWords(cur)}` : ' · at the time'}`);
    setIcon(el(b, 'span', 'a4pj-ic a4pj-caret'), 'chevron-down');
    b.setAttr('aria-label', cur == null ? 'No reminder. Change the reminder' : `Reminder at ${ringText(day, tm, cur)}${each}. Change the reminder`);
    b.setAttr('aria-haspopup', 'true');
    const set = (n) => act(() => engine.setReminder(t.path, n), n == null ? 'No reminder' : `Reminder: ${reminderWords(n).toLowerCase()}${each}`);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      new Pop(b, null, (box, pop) => {
        box.addClass('a4pj-bellmenu');
        const item = (label, n, k2) => {
          const q = el(box, 'button', 'a4pj-pop-q' + (cur === n ? ' is-cur' : ''));
          el(q, 'span', null, label); if (k2) el(q, 'span', 'a4pj-k', k2);
          q.addEventListener('click', () => { pop.close(); if (cur !== n) set(n); });
        };
        item('No reminder', null, null);
        el(box, 'div', 'a4pj-pop-sep');
        for (const n of REMINDER_CHOICES) item(n ? reminderWords(n) : 'At the time', n, ringText(day, tm, n));
        if (cur != null && !REMINDER_CHOICES.includes(cur)) item(reminderWords(cur), cur, ringText(day, tm, cur));
        el(box, 'div', 'a4pj-pop-sep');
        const oth = el(box, 'button', 'a4pj-pop-q'); el(oth, 'span', null, 'Other…');
        oth.addEventListener('click', () => {
          oth.remove();
          const w = el(box, 'div', 'a4pj-wp-other');
          const oi = el(w, 'input', 'a4pj-input a4pj-wp-otherin'); oi.type = 'text'; oi.placeholder = '2 hours'; oi.setAttr('aria-label', 'How long before');
          const out = el(w, 'span', 'a4pj-wp-otherout');
          el(box, 'div', 'a4pj-wp-remhelp', 'Type minutes, hours or days, e.g. "45 min", "2 hours", "3 days". Enter saves.');
          oi.addEventListener('input', () => { const n = parseReminderText(oi.value); out.toggleClass('is-err', n == null && !!oi.value.trim()); out.setText(n == null ? (oi.value.trim() ? "Didn't catch that" : '') : `before = ${ringText(day, tm, n)}`); });
          oi.addEventListener('keydown', (e2) => { if (e2.key !== 'Enter' || e2.isComposing) return; e2.preventDefault(); const n = parseReminderText(oi.value); if (n == null) return; pop.close(); set(n); });
          oi.focus(); pop.place();
        });
      }, { ...popOpts, cls: 'is-bell' });
    });
    return b;
  }

  // mode 'by': this task's own blockedBy. mode 'blocks': worked out from the
  // other tasks; adding or removing there writes the OTHER task's blockedBy.
  depRow(host, t, mode, popOpts, act) {
    const engine = this.plugin.engine;
    const box = el(host, 'div', 'a4pj-deps');
    const list = mode === 'by' ? engine.blockerEntries(t.path) : engine.waitingOn(t.path);
    if (!list.length) el(box, 'span', 'a4pj-muted', mode === 'by' ? 'Nothing' : 'No task waits on this');
    for (const x of list) {
      const d = el(box, 'span', 'a4pj-dep' + (x.missing ? ' is-missing' : (x.holds ? '' : ' is-done')));
      if (mode === 'by') el(d, 'span', 'a4pj-dep-st', x.missing ? 'gone' : (x.holds ? 'open' : '✓ done'));
      const a = el(d, x.path ? 'a' : 'span', 'a4pj-dep-t', x.title);
      if (x.path) { a.setAttr('role', 'link'); a.tabIndex = 0; a.addEventListener('click', () => this.plugin.openFile(x.path)); a.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.plugin.openFile(x.path); }); }
      if (x.missing) d.setAttr('aria-label', 'That task note no longer exists; it blocks nothing');
      const rm = el(d, 'button', 'a4pj-x'); setIcon(rm, 'x'); rm.setAttr('aria-label', `Remove ${x.title}`);
      rm.addEventListener('click', () => act(() => (mode === 'by' ? engine.removeBlocker(t.path, x.path, x.link) : engine.removeBlocker(x.path, t.path)), 'Removed'));
    }
    const add = el(box, 'button', 'a4pj-dep-add', mode === 'by' ? '+ Waiting on…' : '+ Add a task that waits on this');
    add.addEventListener('click', (e) => { e.stopPropagation(); this.depPick(t, mode, add, popOpts, act); });
  }

  depPick(t, mode, anchor, popOpts, act) {
    const engine = this.plugin.engine; const cfg = engine.cfg();
    new Pop(anchor, mode === 'by' ? `${t.title} is waiting on…` : `Which task waits on ${t.title}?`, (box, pop) => {
      const find = el(box, 'input', 'a4pj-input a4pj-find'); find.type = 'text'; find.placeholder = 'Find a task'; find.setAttr('aria-label', 'Find a task');
      const host = el(box, 'div', 'a4pj-pop-list');
      const taken = new Set((mode === 'by' ? engine.blockerEntries(t.path) : engine.waitingOn(t.path)).map((x) => x.path).filter(Boolean));
      const all = engine.collectTasks(false).filter((c) => c.path !== t.path && !c.archived && isOpenTask(c, cfg) && !taken.has(c.path));
      const proj = engine.noteForKey(t.projectKey);
      const projName = proj ? proj.name : (t.project || t.projectKey);
      const draw = () => {
        host.empty();
        host.scrollTop = 0;
        const q = find.value.trim();
        const { mine, others } = depPickGroups(all, t.projectKey, q);
        const make = depCreateOffer(q, [...mine, ...others]);
        if (t.projectKey) {
          el(host, 'div', 'a4pj-grp', projName);
          if (!mine.length && !make) el(host, 'div', 'a4pj-pop-empty', 'No other open task in this project.');
          for (const c of mine) row(c, true);
          if (make) createRow(make);
          if (others.length) el(host, 'div', 'a4pj-grp', 'Other projects');
        } else if (others.length) el(host, 'div', 'a4pj-grp', 'Open tasks');
        for (const c of others) row(c);
        if (!t.projectKey && make) createRow(make);
        else if (!t.projectKey && !others.length) el(host, 'div', 'a4pj-pop-note', 'No open task matches.');
      };
      const createRow = (title) => {
        const where = proj ? proj.name : 'the Inbox';
        const first = !host.querySelector('.a4pj-pop-q:not(.is-no)'); // Enter in the search box picks this row
        const b = el(host, 'button', 'a4pj-pop-q a4pj-pop-make');
        el(b, 'span', null, `+  Create task "${title}" in ${where}`);
        if (first) el(b, 'span', 'a4pj-k', 'Enter ↵');
        b.setAttr('aria-label', mode === 'by' ? `Create task ${title} in ${where}, and wait on it` : `Create task ${title} in ${where}, waiting on this one`);
        b.addEventListener('click', () => {
          pop.close();
          act(() => engine.createAndLink(t, mode, title, proj ? proj.path : null), mode === 'by' ? `Created, and now waiting on ${title}` : `Created; ${title} now waits on this`);
        });
      };
      const row = (c, own) => {
        const loop = mode === 'by' ? engine.wouldLoop(t.path, c.path) : engine.wouldLoop(c.path, t.path);
        const b = el(host, 'button', 'a4pj-pop-q' + (loop ? ' is-no' : ''));
        el(b, 'span', null, c.title);
        if (loop || !own) el(b, 'span', 'a4pj-k', loop ? 'would loop' : (c.project || c.projectKey || 'Inbox'));
        if (loop) {
          b.setAttr('aria-disabled', 'true');
          b.setAttr('aria-label', `${c.title}: can't, that would make a circle`);
          b.addEventListener('click', () => new Notice("Can't: that would make a circle."));
          return;
        }
        b.addEventListener('click', () => {
          pop.close();
          act(() => (mode === 'by' ? engine.addBlocker(t.path, c.path) : engine.addBlocker(c.path, t.path)), mode === 'by' ? `Now waiting on ${c.title}` : `${c.title} now waits on this`);
        });
      };
      find.addEventListener('input', draw);
      find.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = host.querySelector('.a4pj-pop-q:not(.is-no)'); if (b) b.click(); } });
      draw();
      el(box, 'div', 'a4pj-pop-note', mode === 'by' ? 'Open tasks only, this project first. A task that already waits on this one is greyed out.' : 'Saved on the other task (as its "Blocked by"); nothing is stored twice.');
    }, { ...popOpts, cls: 'is-wide is-deps', fit: true });
  }

  projectPick(t, anchor, popOpts, refresh) {
    const engine = this.plugin.engine;
    new Pop(anchor, 'Project', (box, pop) => {
      const find = el(box, 'input', 'a4pj-input a4pj-find'); find.type = 'text'; find.placeholder = 'Find a project';
      const host = el(box, 'div', 'a4pj-pop-list');
      const choose = async (p) => {
        pop.close();
        try { const w = await engine.setProject(t.path, p ? p.path : null); this.plugin.toast.show(p ? `Moved to ${p.name}` : 'Back to the Inbox', w.undo); } catch { new Notice('Could not move it.'); }
        refresh();
      };
      const draw = () => {
        host.empty();
        const q = find.value.trim().toLowerCase();
        const n = engine.collectNotes();
        for (const g of projectPickGroups([...n.areas, ...n.projects], q, isOpenProject, (a, b) => ((OPEN_ORDER[a.status] ?? 5) - (OPEN_ORDER[b.status] ?? 5)) || a.name.localeCompare(b.name))) {
          el(host, 'div', 'a4pj-grp', g.label);
          for (const p of g.notes) projectPickRow(host, p, t.projectKey, choose);
        }
        el(host, 'div', 'a4pj-pop-sep');
        const nb = el(host, 'button', 'a4pj-pop-q'); el(nb, 'span', null, 'No project (back to Inbox)'); nb.addEventListener('click', () => choose(null));
      };
      find.addEventListener('input', draw);
      draw();
    }, { ...popOpts, cls: 'is-wide' });
  }

  repeatPick(t, anchor, popOpts, act) {
    const engine = this.plugin.engine;
    const current = ruleBody(t.recurrenceRaw);
    new Pop(anchor, 'Repeats', (box, pop) => {
      for (const [k, lab] of REPEAT_PRESETS) {
        const b = el(box, 'button', 'a4pj-pop-q'); el(b, 'span', null, lab);
        if (current === k) el(b, 'span', 'a4pj-k', 'current');
        b.addEventListener('click', () => { pop.close(); if (current !== k) act(() => engine.setRepeat(t.path, k), k ? `Repeats: ${lab.toLowerCase()}` : "Doesn't repeat"); });
      }
      el(box, 'div', 'a4pj-pop-sep');
      const ty = el(box, 'input', 'a4pj-input a4pj-find'); ty.type = 'text'; ty.placeholder = 'Or type: every other friday';
      ty.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !ty.value.trim()) return;
        e.preventDefault();
        const rule = repeatRule(ty.value);
        if (!rule) { ty.value = ''; ty.placeholder = "Didn't catch that. Try: every monday"; return; }
        pop.close(); act(() => engine.setRepeat(t.path, rule), 'Repeat changed');
      });
      el(box, 'div', 'a4pj-pop-note', 'Ticking a repeating task finishes this occurrence; the next one shows up on its day.');
    }, popOpts);
  }
}

/* ========================================================================== *
 * Settings
 * ========================================================================== */

class ProjectsSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('a4pj-settings');
    const s = this.plugin.settings;
    // Where your tasks live (mockup v6): one choice; Things only on a Mac.
    new Setting(containerEl).setName('Where your tasks live').setDesc('Today, the Planner and Projects read the one you pick.').settingEl.addClass('a4pj-src-head');
    const box = containerEl.createDiv({ cls: 'a4pj-srcs', attr: { role: 'radiogroup', 'aria-label': 'Where your tasks live' } });
    for (const x of SOURCES.filter((y) => !y.mac || thingsOffered() || s.source === y.id)) {
      const on = s.source === x.id;
      const row = box.createDiv({ cls: `a4pj-src${on ? ' is-on' : ''}`, attr: { role: 'radio', 'aria-checked': String(on), tabindex: '0', 'data-src': x.id } });
      row.createSpan({ cls: 'a4pj-src-dot' });
      const t = row.createDiv();
      const b = t.createEl('b', { text: x.name });
      if (x.tag) b.createSpan({ cls: 'a4pj-src-tag', text: x.tag });
      t.createEl('small', { text: x.desc });
      const pick = async () => {
        if (s.source === x.id) return;
        if (x.id === 'tasknotes' && !this.plugin.tnApi()) new Notice('TaskNotes is not turned on, so ticks and new tasks will not work until it is.');
        await this.plugin.setSource(x.id); this.display();
      };
      row.addEventListener('click', pick);
      row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    }
    const src = SOURCES.find((x) => x.id === s.source) || SOURCES[0];
    const sub = containerEl.createDiv({ cls: 'a4pj-src-sub' });
    if (src.id === 'checkbox') {
      new Setting(sub).setName('Only lines with this tag').setDesc('Leave empty to count every checkbox.').addText((t) => {
        t.setPlaceholder('#task').setValue(s.cbTag);
        t.inputEl.setAttr('aria-label', 'Only lines with this tag');
        t.inputEl.addEventListener('change', async () => { s.cbTag = cleanTag(t.getValue()); t.setValue(s.cbTag); await this.plugin.save(); this.app.workspace.trigger('lifeworld:tasks'); });
      });
      sub.createDiv({ cls: 'setting-item-description', text: 'New tasks you add from Today or the Planner go into that day\'s daily note, under a "Tasks" heading.' });
      const tasksOn = !!(this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['obsidian-tasks-plugin']);
      sub.createDiv({ cls: 'setting-item-description', text: tasksOn ? 'Tasks plugin found: ticking a repeating task goes through it, so the next one appears.' : 'Without the Tasks plugin, a tick marks the line done with today\'s date; a repeating task does not get its next copy.' });
    }
    if (src.key) {
      new Setting(sub).setName(src.key[0]).setDesc(`${src.key[1]} Your key stays on this device: it is not synced or backed up, so paste it once on each device.`).addText((t) => {
        t.inputEl.type = 'password';
        t.inputEl.setAttr('aria-label', src.key[0]);
        t.inputEl.setAttr('autocomplete', 'off');
        t.setPlaceholder('Paste your key').setValue(keyOf(this.app, src.id));
        t.inputEl.addEventListener('change', () => { setKey(this.app, src.id, t.getValue()); if (this.plugin.ext) this.plugin.ext.refresh().then(() => { if (src.id === 'clickup' && containerEl.isConnected) this.display(); }); });
      });
      if (src.id === 'clickup' && this.plugin.ext && this.plugin.ext.lists && this.plugin.ext.lists.size) {
        new Setting(sub).setName('New ClickUp tasks go to').addDropdown((d) => {
          for (const [id, name] of this.plugin.ext.lists) d.addOption(id, name);
          d.setValue(s.cuList && this.plugin.ext.lists.has(s.cuList) ? s.cuList : [...this.plugin.ext.lists.keys()][0]);
          d.onChange(async (v) => { s.cuList = v; await this.plugin.save(); });
        });
      }
    }
    if (src.id === 'things') sub.createDiv({ cls: 'setting-item-description', text: thingsOffered() ? 'No key needed. The first time, your Mac asks once to let Obsidian use Things.' : 'Things tasks show only on a Mac.' });
    if (this.plugin.ext && this.plugin.ext.status().error) sub.createDiv({ cls: 'setting-item-description mod-warning', text: this.plugin.ext.status().error });
    new Setting(containerEl)
      .setName("Hide Obsidian's properties list on task notes")
      .setDesc('The task card shows and edits the same fields, and opens the full list for anything unusual. Nothing in the notes changes either way.')
      .addToggle((t) => t.setValue(s.hideProps).onChange(async (v) => { s.hideProps = v; await this.plugin.save(); this.plugin.cards.refreshAll(); }));
    const q = s.archiveQueue.length;
    containerEl.createDiv({ cls: 'setting-item-description a4pj-set-note', text: `Done tasks move to the archive folder five minutes after they are ticked, as with TaskNotes${q ? ` (${q} waiting now)` : ''}.` });
  }
}

ProjectsPlugin.logic = logic;
ProjectsPlugin.ProjectsSettingTab = ProjectsSettingTab; // for tests (Where your tasks live)
export default ProjectsPlugin;
ProjectsPlugin.TaskEngine = TaskEngine;
ProjectsPlugin.TaskLinks = TaskLinks; // for tests/test-dependencies.js
ProjectsPlugin.ProjectsView = ProjectsView; // for tests (switch clicks)
ProjectsPlugin.IdeaModal = IdeaModal; // for tests (Enter in the form)
ProjectsPlugin.AreaModal = AreaModal;
ProjectsPlugin.cardAccent = { CARD_ACCENTS, cardAccentId, setCardAccent }; // for tests/test-projects.js (task card colour)
