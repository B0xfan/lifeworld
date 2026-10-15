/* A4 Today: a calm overview of the day, in its own tab.
 *
 * Built 2026-10-03 (Dex) from the approved mockup
 * (mockup-today-page.html, round 2) and the
 * A4 build section of 2026-10-03_today-page-obsidian-plugin-plan.md.
 * Hand-written CommonJS, no build step, same as the other A4 plugins.
 * Written new; Lifeworld's Today page was read as a reference for shape only.
 *
 * What it reads (never a parallel data model, GL-013 rule 1):
 *  - TaskNotes task notes in the tasks folder (Settings › Your vault), with the same
 *    planned_day / planned_half / planned_order contract as the A4 Daily
 *    Planner ("due always wins": a dated task sits on its due date).
 *  - The weather note and the calendar note (paths in LifeWorld's settings), both
 *    machine-written feeds (read-only here).
 *  - Habit notes (type: habit, the '## Log' body format A4 Habits owns),
 *    mood check-ins, active projects, the latest journal entry.
 *
 * What it writes:
 *  - Ticking a task goes through A4 Projects' task engine
 *    (api.tasks.complete / uncomplete, api.recurring.toggleCompleteInstance),
 *    so status, completedDate, complete_instances, dateModified and
 *    auto-archive match A4 Projects. Only when that engine is not on does it
 *    fall back to app.fileManager.processFrontMatter with the same fields the
 *    A4 Daily Planner writes. TaskNotes itself is never used (2026-10-13).
 *  - Ticking a habit toggles '- YYYY-MM-DD done' under '## Log' in that habit
 *    note (A4 Habits' format), atomically through vault.process.
 *  - Capture appends '- HH:MM  text' under '## Quick notes' in today's Daily
 *    Scratchpad (MM-DD-YYYY.md), creating the note from the Daily notes
 *    template when it does not exist yet. Append only; nothing is removed.
 *    A missing '## Quick notes' heading is added at the top of the body,
 *    under the frontmatter (ruling 2026-10-04).
 *  - Display only: in Live Preview, Daily Scratchpad notes hide the Places
 *    machine markers (<!-- places-today:start/end -->, <!-- stay:... -->);
 *    the file is never changed (see buildMarkerHider).
 *  - "Move all N to today" (1.2.3, Overdue card): for each task the card
 *    lists, `due` takes today's day (a time after it is kept) and
 *    `planned_order` puts it at the bottom of its lane; nothing else changes.
 *    One processFrontMatter per task; Undo writes back exactly the keys
 *    that changed (a key that was absent is deleted again).
 *  - Task names (1.2.4 / Planner 1.0.3 / Projects 0.1.2, 2026-10-05): a task
 *    shows its stored `title` when it has one, else its file name
 *    (taskTitleOf, shared). Text only, never HTML.
 *  - Task times (1.2.5 / Planner 1.0.4 / Projects 0.1.4, 2026-10-05, mockup
 *    v3 + review): a clock time lives on `due` (or a repeating task's start)
 *    as 'YYYY-MM-DDTHH:MM', TaskNotes' format. It shows in front of the name,
 *    picks the lane (before 1 PM is Morning) and sorts timed tasks first.
 *    Every move keeps it while the task stays in its half of the day; moved
 *    into the other half it comes off, with Undo (shared applyMove).
 *  - Project links (1.2.6 / Planner 1.0.5 / Projects 0.1.5, 2026-10-05):
 *    an Active projects chip and a task's project label open that
 *    project's page in A4 Projects (its openProjectPage); Cmd/Ctrl-click
 *    opens a new tab. With A4 Projects off, the note opens (shared
 *    openProjectPage). Looks unchanged.
 *  - Reminders (1.3.0 / Planner 1.1.0 / Projects 0.2.0, 2026-10-05, reminder
 *    setup mockup approved): a small orange bell after a task's time
 *    when it will ring, with "15m" when it rings earlier. Read from TaskNotes'
 *    own `reminders` field (shared reminderOf). The ringing itself is Apple
 *    Reminders' job (a separate sync); no plugin fires its own
 *    notification, so nothing rings twice on the Mac.
 *  - Someday (1.3.2 / Planner 1.2.0 / Projects 0.3.0, 2026-10-06, Someday
 *    mockup approved): a task with status `someday` is kept for later
 *    with no day. Today shows nothing new; it simply never lists one as
 *    planned for a day or overdue (shared taskOnDay / isSomeday), and "Move
 *    all to today" skips it. Giving it a day (applyMove) makes it open again.
 *  - The widget layout lives in this plugin's own data.json (saveData),
 *    never in a note. Hiding a widget touches no note.
 *  - Settings › Calendars (1.2.0, 2026-10-04): the calendars picked are
 *    saved in data.json as calendars.selected (stable ids). The program that
 *    writes the calendar note reads them and fetches only those. Running it
 *    right after a change (and for "Refresh list") is an add-on's job: it
 *    calls LifeWorld's setCalendarSync (phase 2 section 7; no Node code here).
 *  - Settings › Today page › Your name (phase 2 section 5): saved in
 *    data.json as userName, shown in the greeting; empty = no name.
 *
 * The capture link (obsidian://a4-today-capture?text=...) only OPENS the
 * capture box pre-filled; saving still takes the user's own Enter. A link
 * from any web page can therefore never write into the vault on its own
 * (GL-011 rule 2 without a stored secret).
 */
'use strict';

import { Plugin, ItemView, TFile, TFolder, Notice, Modal, setIcon, PluginSettingTab, Setting, Keymap, Menu, moment, editorInfoField, editorLivePreviewField } from 'obsidian';

/* ========================================================================== *
 * Constants (A4 paths; this build is for one vault, not generalized)
 * ========================================================================== */

const VIEW_TYPE = 'a4-today';
const MOOD_FOLDER = '04 Inner World/My Life/Mood';
const SYNC_AFTER_CHANGE_MS = 2500; // a calendar choice is handed to the add-on's sync this long after the last tick
const QUICK_NOTES_HEADING = '## Quick notes';
const PLANNER_COMMAND = 'a4-planner:open'; // the old A4 Daily Planner fallback was dropped 2026-10-05
const MOOD_COMMAND = 'a4-health:new-mood-checkin';
const STALE_AFTER_MS = 2 * 60 * 60 * 1000; // mockup: amber after 2 hours
const OVERDUE_PREVIEW = 5;                  // mockup: first 5, then "Show N more"
const CALENDAR_DAYS_AHEAD = 7;
const JOURNAL_EXCERPT_CHARS = 260;
const CAPTURE_MAX_CHARS = 2000;
const NARROW_WIDTH = 720;                   // one column + up/down arrows below this
// What Today redraws for: the weather and calendar notes (when set) and the folders it reads.
const watches = (p) => p === feedNotes.weather || p === feedNotes.calendar || [vaultFolders.tasks, vaultFolders.archive, vaultFolders.habits, MOOD_FOLDER, vaultFolders.projects, vaultFolders.journal].some((f) => p.startsWith(f + '/'));
const OVERDUE_UNDO_MS = 6000;               // mockup: the "N moved to today · Undo" line, a few seconds

/* ========================================================================== *
 * Pure logic (no Obsidian objects; unit-tested in tests/test-today.js)
 * Every day is a local calendar day as 'YYYY-MM-DD'. Day arithmetic runs on
 * UTC-anchored dates so daylight-saving changes can never shift a day.
 * ========================================================================== */

// The shared core (src/core/): one copy of the dates, list, reminder, quick add and task helpers.
import { pad2, dayOf, toDayStr, addDays, daysBetween, weekdayOf, partsOf, parseRRule, occursOn, MONTHS_SHORT, WEEKDAYS_SHORT, halfOfTime, timeText } from '../core/dates';
import { asList } from '../core/lists';
import { REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords } from '../core/reminders';
import { DEFAULT_COMPLETED_STATUSES, wikilinkTarget, taskTitleOf, timeOf, ruleTimeOf, onDay, movedDate, untimedSlot, taskFromFrontmatter, isTaskDone, taskOnDay, isSomeday, applySomeday, sortByOrder, orderForInsert, applyMove, planInsert, openBlockersOf } from '../core/tasks';
import { partOf } from '../core/parts'; // the other parts, through LifeWorld (phase 2)
import { vaultFolders, propNames, feedNotes, dailyNotes, readable, writable } from '../core/vault'; // Settings › Your vault (phase 2 section 4)

/* ---- tasks ---------------------------------------------------------------- */

// -> { morning, afternoon, overdue, open, total } for `today`.
function buildTaskLists(items, today, completedStatuses) {
  const done = (t) => isTaskDone(t, today, completedStatuses);
  const onToday = items.filter((t) => taskOnDay(t, today));
  const morning = sortByOrder(onToday.filter((t) => t.plannedHalf !== 'pm'));
  const afternoon = sortByOrder(onToday.filter((t) => t.plannedHalf === 'pm'));
  // Overdue: open, one-off, due before today. No cap (the mockup's Show more).
  // Newest first, as drawn; ties keep planned order.
  const overdue = items
    .filter((t) => !t.recurrenceRaw && t.due && t.due < today && !done(t) && !isSomeday(t))
    .sort((a, b) => b.due.localeCompare(a.due) || a.plannedOrder - b.plannedOrder || a.path.localeCompare(b.path));
  const total = morning.length + afternoon.length;
  const open = [...morning, ...afternoon].filter((t) => !done(t)).length;
  return { morning, afternoon, overdue, open, total };
}

function plateText(open, total) {
  if (!total) return 'a clear day ahead';
  if (!open) return 'all done, nice work';
  return `${open} thing${open === 1 ? '' : 's'} on your plate today`;
}

function greeting(hour) {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
// Settings › Today page › Your name; empty: no trailing comma.
function greetingLine(hour, name) { const n = normalizeUserName(name); return n ? `${greeting(hour)}, ${n}` : greeting(hour); }
function normalizeUserName(raw) { return typeof raw === 'string' ? raw.trim().slice(0, 60) : ''; }

/* ---- moving a task (same writes as the A4 Daily Planner's assignItem) ----- */

/* ---- "Move all N to today" on the Overdue card (1.2.3, mockup option A,
 * approved 2026-10-05). ------------------------------------------ */

// The due date's day becomes `day`; anything after the day (a time, a zone)
// is kept as written. A value that is not a readable date becomes `day`.
function dueOnDay(due, day) {
  if (due instanceof Date) return day;
  const s = due == null ? '' : String(due);
  const m = /^(\s*)\d{4}-\d{2}-\d{2}/.exec(s);
  return m ? m[1] + day + s.slice(m[0].length) : day;
}

// What the button moves: exactly the tasks the card lists (open, one-off,
// due before today), oldest first. Afternoon tasks go to the bottom of
// Afternoon, every other one to the bottom of Morning, in that order.
// The half itself is never rewritten: 'pm' stays 'pm', 'am' stays 'am', and
// a task with no half keeps none (Today shows it in Morning, the Planner
// under "Any time").
// -> [{ path, lane: 'am' | 'pm', order }]
function planOverdueMove(lists) {
  const tail = {
    am: lists.morning.map((t) => t.plannedOrder),
    pm: lists.afternoon.map((t) => t.plannedOrder),
  };
  const oldestFirst = [...lists.overdue].filter((t) => !t.recurrenceRaw && t.due)
    .sort((a, b) => a.due.localeCompare(b.due) || a.plannedOrder - b.plannedOrder || a.path.localeCompare(b.path));
  return oldestFirst.map((t) => {
    const lane = t.plannedHalf === 'pm' ? 'pm' : 'am';
    const orders = tail[lane];
    const order = orders.length ? Math.max(...orders) + 10 : 10;
    orders.push(order);
    return { path: t.path, lane, order };
  });
}

// The write for one task. Re-checks the note itself first, so a task that
// changed since the card was drawn (now repeating, done, or no longer
// overdue) is left alone. Returns true when it wrote.
function applyOverdueMove(fm, day, order, completedStatuses) {
  if (!fm || typeof fm !== 'object') return false;
  if (typeof fm.recurrence === 'string' && fm.recurrence.trim()) return false;
  const due = toDayStr(fm.due);
  if (!due || due >= day) return false;
  const status = fm.status == null || fm.status === '' ? 'open' : String(fm.status);
  if ((completedStatuses || DEFAULT_COMPLETED_STATUSES).includes(status)) return false;
  if (isSomeday(fm)) return false; // kept for later: never overdue
  fm.due = dueOnDay(fm.due, day);
  fm.planned_order = order;
  return true;
}

// One frontmatter write that remembers what the keys it changed held before;
// the returned undo() puts exactly those back (a key that was absent is
// removed again), through the frontmatter API too.
async function writeWithUndo(app, file, fn) {
  let before = {};
  await app.fileManager.processFrontMatter(file, (fm) => {
    const copy = JSON.parse(JSON.stringify(fm || {}));
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
function blockedChip(meta, blockers, open, pre) {
  const c = meta.createSpan({ cls: `${pre}-chip ${pre}-lock` });
  setIcon(c.createSpan({ cls: `${pre}-ic` }), 'lock');
  c.appendText(blockers.length > 1 ? `blocked · ${blockers.length}` : 'blocked');
  const names = `Blocked by: ${blockers.map((b) => b.title).join(', ')}`;
  c.setAttr('aria-label', names); c.setAttr('title', names); c.setAttr('role', 'button'); c.tabIndex = 0;
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

// A project chip or label (2026-10-05): its page in A4 Projects, in a new
// tab on Cmd/Ctrl-click; the note itself (a new tab, as before) when A4 Projects
// is off or has no page for it. `ref`: a project note's path, or a task's
// project link or name. Resolves 'page', 'note', or false.
async function openProjectPage(app, ref, e, sourcePath) {
  if (ref == null || ref === '') return false;
  const newTab = !!(e && Keymap && Keymap.isModEvent(e));
  const pj = partOf(app, 'a4-projects');
  if (pj && typeof pj.openProjectPage === 'function') {
    try { if (await pj.openProjectPage(ref, { newTab })) return 'page'; } catch (err) { console.error('[a4] opening the project page failed', err); }
  }
  const s = String(ref);
  let f = app.vault.getAbstractFileByPath(s);
  if (!(f instanceof TFile)) f = app.metadataCache.getFirstLinkpathDest((wikilinkTarget(s) || s).split('#')[0], sourcePath || '');
  if (!(f instanceof TFile)) return false;
  await app.workspace.getLeaf('tab').openFile(f);
  return 'note';
}

/* ---- look: accent colour and handwriting font (plugin settings) ----------
 * Owned by the plugin, not the theme (2026-10-03). Each fixed accent has
 * a light-mode and a dark-mode shade (no single colour reads at 4.5:1 on both
 * a white and a near-black page); shades from mockup-today-accent-colors.html.
 * Orange is the A4 INKLINE marker pair, so the existing page looks the same. */
const ACCENTS = [
  { id: 'orange', name: 'Orange', light: '#d43f16', dark: '#ff5a2d' },
  { id: 'accent', name: 'Follow Obsidian accent' },
  { id: 'blue', name: 'Ink blue', light: '#1d4ed8', dark: '#86aefc' },
  { id: 'green', name: 'Forest green', light: '#1f6b3a', dark: '#72cf94' },
  { id: 'plum', name: 'Plum', light: '#7a2e8a', dark: '#d6a1e3' },
  { id: 'amber', name: 'Amber', light: '#8a5a00', dark: '#efb54a' },
];
// Fonts are bundled at the end of this file (SIL Open Font License 1.1; licence
// texts in src/today/fonts/, shipped at the end of main.js). Unique family names so a theme's own
// copy of the same font can never shadow or be shadowed by these.
const HAND_FONTS = [
  { id: 'caveat', name: 'Caveat', family: 'A4 Today Caveat', weight: 600 },
  { id: 'patrickhand', name: 'Patrick Hand', family: 'A4 Today Patrick Hand', weight: 400 },
  { id: 'kalam', name: 'Kalam', family: 'A4 Today Kalam', weight: 400 },
  { id: 'gochihand', name: 'Gochi Hand', family: 'A4 Today Gochi Hand', weight: 400 },
];
// Ink blue is the public default (2026-10-06); a saved Orange is kept
// because his data.json stores it explicitly.
const DEFAULT_LOOK = { accent: 'blue', font: 'caveat' };
function normalizeLook(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    accent: ACCENTS.some((a) => a.id === r.accent) ? r.accent : DEFAULT_LOOK.accent,
    font: HAND_FONTS.some((f) => f.id === r.font) ? r.font : DEFAULT_LOOK.font,
  };
}
function rgbOf(c) {
  if (Array.isArray(c)) return c.slice(0, 3);
  const s = String(c || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])].map(Math.round) : null;
}
function luminance(rgb) { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]); }
function contrastRatio(a, b) { const x = luminance(rgbOf(a)), y = luminance(rgbOf(b)); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
function toHexColor(rgb) { return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hslToRgb([h, s, l]) { if (!s) return [l, l, l].map((v) => Math.round(v * 255)); const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; const t = (x) => { x = (x + 1) % 1; return x < 1 / 6 ? p + (q - p) * 6 * x : x < 0.5 ? q : x < 2 / 3 ? p + (q - p) * (2 / 3 - x) * 6 : p; }; return [t(h + 1 / 3), t(h), t(h - 1 / 3)].map((v) => Math.round(v * 255)); }
// "Follow Obsidian accent": keep the hue, nudge lightness until it reads at
// 4.5:1 on the page background (as drawn in the mockup).
function readableShade(color, bg, target) {
  const want = target || 4.5;
  let rgb = rgbOf(color); const b = rgbOf(bg);
  if (!rgb || !b) return color;
  if (contrastRatio(rgb, b) >= want) return toHexColor(rgb);
  const hsl = rgbToHsl(rgb); const darker = luminance(b) > 0.18;
  for (let i = 0; i < 100 && contrastRatio(rgb, b) < want; i++) { hsl[2] = Math.max(0, Math.min(1, hsl[2] + (darker ? -0.01 : 0.01))); rgb = hslToRgb(hsl); }
  return toHexColor(rgb);
}
function accentShade(look, dark, obsidianAccent, bg) {
  const a = ACCENTS.find((x) => x.id === look.accent) || ACCENTS[0];
  if (a.id === 'accent') return obsidianAccent ? readableShade(obsidianAccent, bg || (dark ? '#1e1e1e' : '#ffffff')) : null;
  return dark ? a.dark : a.light;
}

/* ---- color scheme (Settings > Appearance > Color scheme) ------------------
 * Checked in Obsidian 1.13.7's app.js: that dropdown calls app.changeTheme(id)
 * with ids 'moonstone' (light), 'obsidian' (dark) and 'system', and shows
 * app.vault.getConfig('theme'). Neither is in the public plugin API, so both
 * are feature-checked before use. */
const SCHEMES = [
  { id: 'moonstone', label: 'Light', icon: 'sun' },
  { id: 'obsidian', label: 'Dark', icon: 'moon' },
  { id: 'system', label: 'System', icon: 'monitor' },
];
function schemeOf(value) { return SCHEMES.find((x) => x.id === value) || null; }

/* ---- habits (A4 Habits' '## Log' format) ---------------------------------- */

const LOG_LINE_RE = /^-\s+(\d{4}-\d{2}-\d{2})\s+(done|missed)\b/;

function findLogSpan(text) {
  const re = /^## (.+)$/gm;
  let m; let found = null;
  while ((m = re.exec(text))) { if (m[1].trim() === 'Log') { found = m; break; } }
  if (!found) return null;
  let start = found.index + found[0].length;
  if (text[start] === '\n') start += 1;
  re.lastIndex = found.index + found[0].length;
  const next = re.exec(text);
  return { start, end: next ? next.index : text.length };
}

function parseDoneSet(text) {
  const span = findLogSpan(text || '');
  const per = new Map();
  if (span) {
    for (const line of text.slice(span.start, span.end).split('\n')) {
      const m = LOG_LINE_RE.exec(line.trim());
      if (m) per.set(m[1], m[2]);
    }
  }
  return new Set([...per].filter(([, v]) => v === 'done').map(([k]) => k));
}

// Same rule as A4 Habits: consecutive done days ending today, or yesterday
// when today isn't ticked yet.
function computeStreak(doneSet, today) {
  let d = doneSet.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (doneSet.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// Adds or removes '- <day> done' inside '## Log', touching nothing else.
function toggleHabitLog(text, day) {
  let span = findLogSpan(text);
  if (!span) {
    const sep = text.endsWith('\n') ? '' : '\n';
    text = `${text}${sep}\n## Log\n\n`;
    span = { start: text.length, end: text.length };
  }
  const log = text.slice(span.start, span.end);
  const lines = log.split('\n');
  const target = `- ${day} done`;
  const idx = lines.findIndex((l) => l.trim() === target);
  if (idx !== -1) {
    return { text: text.slice(0, span.start) + lines.filter((_, i) => i !== idx).join('\n') + text.slice(span.end), on: false };
  }
  let last = -1;
  lines.forEach((l, i) => { if (LOG_LINE_RE.test(l.trim())) last = i; });
  if (last === -1) {
    const trimmed = log.replace(/\s+$/, '');
    const rebuilt = trimmed.length ? `${trimmed}\n\n${target}\n` : `${target}\n`;
    return { text: text.slice(0, span.start) + rebuilt + text.slice(span.end), on: true };
  }
  const out = lines.slice(); out.splice(last + 1, 0, target);
  return { text: text.slice(0, span.start) + out.join('\n') + text.slice(span.end), on: true };
}

/* ---- capture --------------------------------------------------------------- */

// Today's daily note, as Obsidian's own Daily notes setting names it (folder and date format).
// `fmt` formats a date the moment way (Obsidian's moment in the plugin, the small one in tests).
function scratchNameFor(d, dn, fmt) { return (fmt || formatDateTokens)(d, (dn || dailyNotes(null)).format); }
function scratchPathFor(d, dn, fmt) {
  const folder = (dn || dailyNotes(null)).folder;
  return `${folder ? folder + '/' : ''}${scratchNameFor(d, dn, fmt)}.md`;
}
function cleanCapture(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim().slice(0, CAPTURE_MAX_CHARS);
}
function captureLine(d, text) { return `- ${pad2(d.getHours())}:${pad2(d.getMinutes())}  ${text}`; }
// Drag-to-enlarge for the Today capture box (1.6.0). The box never gets
// smaller than its resting size, and never taller than CAPTURE_MAX_PX or 60%
// of the window, whichever is less. The height is NOT remembered: a save
// snaps the box back to its resting size.
const CAPTURE_MAX_PX = 480;
function captureMaxHeight(restH, viewH) {
  const cap = Math.min(CAPTURE_MAX_PX, Math.floor((Number(viewH) || 0) * 0.6));
  return Math.max(restH, cap);
}
function captureDragHeight(startH, dy, restH, viewH) {
  const h = Math.round((Number(startH) || restH) + (Number(dy) || 0));
  return Math.min(captureMaxHeight(restH, viewH), Math.max(restH, h));
}

// Minimal moment-style formatter for template tokens (used when Obsidian's
// moment isn't available, e.g. in tests).
function formatDateTokens(d, fmt) {
  const map = { YYYY: String(d.getFullYear()), MM: pad2(d.getMonth() + 1), DD: pad2(d.getDate()), HH: pad2(d.getHours()), mm: pad2(d.getMinutes()) };
  return fmt.replace(/YYYY|MM|DD|HH|mm/g, (t) => map[t]);
}
// Obsidian's moment, when there is one (not in the logic tests).
function momentFormat() { return moment ? (d, p) => moment(d).format(p) : null; }
function renderTemplate(tpl, d, fmt, title) {
  const f = fmt || ((date, pattern) => formatDateTokens(date, pattern));
  const name = title == null ? scratchNameFor(d, null, f) : title;
  return String(tpl)
    .replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_, p) => f(d, p))
    .replace(/\{\{\s*time\s*:\s*([^}]+?)\s*\}\}/g, (_, p) => f(d, p))
    .replace(/\{\{\s*date\s*\}\}/g, f(d, 'YYYY-MM-DD'))
    .replace(/\{\{\s*time\s*\}\}/g, f(d, 'HH:mm'))
    .replace(/\{\{\s*title\s*\}\}/g, name);
}

// Insert `line` at the end of the bullet list that follows '## Quick notes'.
// When the heading isn't there yet it is added at the TOP of the body,
// directly under the frontmatter (ruling 2026-10-04: a day reads
// Quick notes -> Places -> end of day -> WhatsApp). Never writes inside the
// frontmatter or between any other section's lines; nothing is reordered.
function insertQuickNote(text, line) {
  text = String(text == null ? '' : text).replace(/\r\n/g, '\n');
  const fmEnd = (() => {
    if (!text.startsWith('---\n')) return 0;
    const i = text.indexOf('\n---', 4);
    if (i < 0) return 0;
    const nl = text.indexOf('\n', i + 4);
    return nl < 0 ? text.length : nl + 1;
  })();
  const lines = text.split('\n');
  let offset = 0; let startLine = 0;
  for (let i = 0; i < lines.length; i++) { if (offset >= fmEnd) { startLine = i; break; } offset += lines[i].length + 1; startLine = i + 1; }
  let h = -1;
  for (let i = startLine; i < lines.length; i++) if (/^## Quick notes[ \t]*$/.test(lines[i])) { h = i; break; }
  if (h === -1) return insertSectionAtTop(text, fmEnd, `${QUICK_NOTES_HEADING}\n\n${line}`);
  let i = h + 1;
  while (i < lines.length && lines[i].trim() === '') i++;
  let last = -1;
  while (i < lines.length && (/^\s*[-*+] /.test(lines[i]) || (last !== -1 && /^\s{2,}\S/.test(lines[i])))) { last = i; i++; }
  if (last === -1) {
    const out = lines.slice(0, h + 1).concat(['', line]);
    const rest = lines.slice(h + 1);
    while (rest.length && rest[0].trim() === '') rest.shift();
    if (rest.length) out.push('', ...rest);
    let s = out.join('\n'); if (!s.endsWith('\n')) s += '\n';
    return s;
  }
  const out = lines.slice(0, last + 1).concat([line], lines.slice(last + 1));
  return out.join('\n');
}

// Put `section` (markdown, no trailing newline) first in the body: right after
// the frontmatter (fmEnd = offset just past its closing '---' line), one blank
// line around it. Only blank lines at the very top of the body are dropped;
// every other character of the note is kept in order.
function insertSectionAtTop(text, fmEnd, section) {
  const head = text.slice(0, fmEnd);
  const body = text.slice(fmEnd).replace(/^(?:[ \t]*\n)+/, '');
  const lead = head ? '\n' : '';
  if (!body.trim()) return `${head}${lead}${section}\n`;
  return `${head}${lead}${section}\n\n${body.endsWith('\n') ? body : `${body}\n`}`;
}

/* ---- hidden machine markers in Daily Scratchpads (Live Preview) ----------- */
//
// The Places detector and the end-of-day review keep their bookkeeping in HTML
// comments: '<!-- places-today:start -->' / ':end -->' on their own lines and a
// trailing '<!-- stay:<key> -->' per Places line. Reading view drops HTML
// comments by itself; Live Preview shows them as text (and the INKLINE theme
// sets that text in its handwriting font). This hides exactly those markers,
// for display only, in Live Preview, in Daily Scratchpad notes. The file on
// disk is never touched, so every script that reads the markers is unaffected.
// A marker shows again while the cursor or a selection is on its line, so it
// can still be seen and edited on purpose; Source mode always shows it.
const MARKER_LINE_RE = /^[ \t]*<!--[ \t]*places-today:(?:start|end)[ \t]*-->[ \t]*$/;
const MARKER_INLINE_RE = /[ \t]*<!--[ \t]*stay:[^\s>]+[ \t]*-->/g;

// -> [{ from, to, line: true|false }] character offsets into `text`.
function markerRanges(text) {
  const out = [];
  const s = String(text == null ? '' : text);
  let pos = 0;
  for (const raw of s.split('\n')) {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (MARKER_LINE_RE.test(l)) out.push({ from: pos, to: pos + l.length, line: true });
    else if (l.includes('<!--')) {
      MARKER_INLINE_RE.lastIndex = 0;
      let m; while ((m = MARKER_INLINE_RE.exec(l))) out.push({ from: pos + m.index, to: pos + m.index + m[0].length, line: false });
    }
    pos += raw.length + 1;
  }
  return out;
}

// A note in the daily notes folder. shortcut: with the daily notes at the vault's top, every note
// there counts (the markers it hides only appear in daily notes); upgrade if that ever misfires.
function isScratchpadPath(p, dn) {
  const { folder, format } = dn || dailyNotes(null);
  if (typeof p !== 'string' || !p.endsWith('.md')) return false;
  if (folder) return p.startsWith(`${folder}/`);
  // Top-level daily notes: as deep as the date format's own folders (YYYY/MM/YYYY-MM-DD), review p2-s5,
  // and named by it, read strictly with Obsidian's moment (review p2-s6; the logic tests have no moment).
  // Depth from a formatted date, not the format text: 'L' prints slashes the format does not hold (review p2-s7).
  const fmt = format || 'YYYY-MM-DD';
  const m = moment;
  return p.split('/').length === (m ? m().format(fmt) : fmt).split('/').length && (!m || m(p.slice(0, -3), fmt, true).isValid());
}

// The CodeMirror 6 extension ('@codemirror/*' come from Obsidian; the tests use the dev copies).
function buildMarkerHider(app, { StateField, RangeSetBuilder, Decoration, EditorView }) {
  const hideLine = Decoration.replace({ block: true });
  const hideInline = Decoration.replace({});
  const pathOf = (state) => { try { const i = state.field(editorInfoField, false); return i && i.file ? i.file.path : null; } catch { return null; } };
  const isLive = (state) => { try { return !!state.field(editorLivePreviewField, false); } catch { return false; } };
  const compute = (state) => {
    if (!isLive(state) || !isScratchpadPath(pathOf(state), dailyNotes(app))) return Decoration.none;
    const text = state.doc.toString();
    if (!text.includes('<!--')) return Decoration.none;
    const sel = state.selection.ranges;
    const b = new RangeSetBuilder();
    for (const r of markerRanges(text)) {
      const ln = state.doc.lineAt(r.from);
      if (sel.some((s) => s.from <= ln.to && s.to >= ln.from)) continue; // cursor on this line: show it
      b.add(r.from, r.to, r.line ? hideLine : hideInline);
    }
    return b.finish();
  };
  return StateField.define({
    create: (state) => ({ path: pathOf(state), live: isLive(state), deco: compute(state) }),
    update(v, tr) {
      const path = pathOf(tr.state); const live = isLive(tr.state);
      if (tr.docChanged || tr.selection || path !== v.path || live !== v.live) return { path, live, deco: compute(tr.state) };
      return v;
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  });
}

/* ---- weather, calendar, journal, mood -------------------------------------- */

function weatherAge(updated, now) {
  const t = Date.parse(String(updated || ''));
  if (!Number.isFinite(t)) return { label: 'last update unknown', stale: true, minutes: null };
  const mins = Math.max(0, Math.round((now.getTime() - t) / 60000));
  let label;
  if (mins < 1) label = 'updated just now';
  else if (mins < 60) label = `updated ${mins} min ago`;
  else if (mins < 60 * 48) label = `updated ${Math.floor(mins / 60)}h ago`;
  else label = `updated ${Math.floor(mins / 1440)} days ago`;
  return { label, stale: now.getTime() - t > STALE_AFTER_MS, minutes: mins };
}

function tideMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP]M)?$/i.exec(String(s || '').trim());
  if (!m) return 99999;
  let h = Number(m[1]) % 12; if (!m[3]) h = Number(m[1]);
  else if (m[3].toUpperCase() === 'PM') h += 12;
  return h * 60 + Number(m[2]);
}
function tidesLine(tides) {
  return asList(tides).filter((t) => t && t.type && t.time)
    .sort((a, b) => tideMinutes(a.time) - tideMinutes(b.time))
    .map((t) => `${t.type} ${t.time}`).join(' · ');
}

function wmoIcon(code) {
  const c = Number(code);
  if (c === 0) return 'sun';
  if (c === 1 || c === 2) return 'cloud-sun';
  if (c === 3) return 'cloud';
  if (c === 45 || c === 48) return 'cloud-fog';
  if (c >= 51 && c <= 57) return 'cloud-drizzle';
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return 'cloud-rain';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'cloud-snow';
  if (c >= 95) return 'cloud-lightning';
  return 'cloud-sun';
}

function fmt12(hhmm) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(hhmm || ''));
  if (!m) return String(hhmm || '');
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

function eventsWindow(events, today, daysAhead) {
  const last = addDays(today, daysAhead == null ? CALENDAR_DAYS_AHEAD : daysAhead);
  return asList(events)
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ date: toDayStr(e.date), time: e.time || null, allDay: !!e.all_day || !e.time, summary: String(e.summary || '(untitled)'), calendar: e.calendar ? String(e.calendar) : '' }))
    .filter((e) => e.date && e.date >= today && e.date <= last)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.allDay === b.allDay ? String(a.time || '').localeCompare(String(b.time || '')) : (a.allDay ? -1 : 1)));
}

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function longDate(day) { const { m, d } = partsOf(day); return `${WEEKDAYS_LONG[weekdayOf(day)]}, ${MONTHS_LONG[m - 1]} ${d}`; }
function shortDue(day) { const { m, d } = partsOf(day); return `${MONTHS_SHORT[m - 1]} ${d}`; }
function eventDayLabel(day, today) { return day === today ? 'Today' : `${WEEKDAYS_SHORT[weekdayOf(day)]} ${partsOf(day).d}`; }
function moodWhen(day, time, today) {
  const label = day === today ? 'Today' : (day === addDays(today, -1) ? 'Yesterday' : `${WEEKDAYS_SHORT[weekdayOf(day)]}, ${shortDue(day)}`);
  return time ? `${label} · ${time}` : label;
}
function clockText(d) {
  const h = d.getHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${pad2(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

function journalExcerpt(body, max) {
  const n = max || JOURNAL_EXCERPT_CHARS;
  const plain = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^#{1,6} .*$/gm, ' ')
    .replace(/!\[\[[^\]]*\]\]/g, ' ')
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, (_, t) => t.split('#')[0].split('/').pop())
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]+/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= n) return { text: plain, cut: false };
  const cut = plain.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return { text: (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, ''), cut: true };
}

function timeToMinutes(t) { return tideMinutes(t) === 99999 ? -1 : tideMinutes(t); }

/* ---- widgets and layout ---------------------------------------------------- */

const ZONES = ['top', 'c1', 'c2', 'c3'];
const WIDGETS = [
  { id: 'weather', name: 'Weather and tides', desc: 'From your weather feed', zone: 'top' },
  { id: 'capture', name: 'Quick capture', desc: "Jot a thought into today's scratchpad", zone: 'top' },
  { id: 'morning', name: 'Morning tasks', desc: 'Planned before one', zone: 'c1' },
  { id: 'afternoon', name: 'Afternoon tasks', desc: 'Planned after one', zone: 'c1' },
  { id: 'overdue', name: 'Overdue', desc: 'Everything past its due date', zone: 'c1' },
  { id: 'plannerlink', name: 'Planner shortcut', desc: 'One button to your Daily Planner', zone: 'c1' },
  { id: 'habits', name: 'Habits', desc: 'Tick today, see streaks', zone: 'c2' },
  { id: 'mood', name: 'Mood', desc: 'Last check-in', zone: 'c2' },
  { id: 'calendar', name: 'Calendar', desc: 'Today and the next 7 days', zone: 'c2' },
  { id: 'projects', name: 'Active projects', desc: 'One click to each', zone: 'c3' },
  { id: 'journal', name: 'Latest journal', desc: 'A few lines from your last entry', zone: 'c3' },
];
const LATER_WIDGETS = [
  { id: 'goals', name: 'Weekly goals', desc: 'Your starred tasks for the week' },
  { id: 'health', name: 'Health today', desc: 'Steps, sleep, resting heart rate' },
  { id: 'reading', name: 'Now reading', desc: 'Your current book and progress' },
];
// Widgets an add-on adds through LifeWorld (phase 2 section 7): { id, name, desc, zone, render(body, el) },
// zone one of the three columns. shortcut: kept for this LifeWorld start only; an add-on adds them again
// when LifeWorld restarts, and a layout saved while one is missing forgets its place (back to its zone).
const EXTRA_WIDGETS = [];
const allWidgets = () => WIDGETS.concat(EXTRA_WIDGETS);
const isWidget = (id) => allWidgets().some((w) => w.id === id);
function addExtraWidget(def) {
  // main, upd, item: the card's a4t-w-<id> class would match parts of the weather strip (review p2-s7b).
  if (isWidget(def.id) || LATER_WIDGETS.some((w) => w.id === def.id) || ['main', 'upd', 'item'].includes(def.id)) throw new Error(`LifeWorld: there is already a Today widget "${def.id}"`);
  const w = { ...def, desc: typeof def.desc === 'string' ? def.desc : '', zone: ['c1', 'c2', 'c3'].includes(def.zone) ? def.zone : 'c3' };
  EXTRA_WIDGETS.push(w);
  return () => { const i = EXTRA_WIDGETS.indexOf(w); if (i !== -1) EXTRA_WIDGETS.splice(i, 1); };
}
const TOP_ONLY = ['weather', 'capture'];

function defaultLayout() {
  const zones = { top: [], c1: [], c2: [], c3: [] };
  allWidgets().forEach((w) => zones[w.zone].push(w.id));
  return { zones, hidden: [] };
}

// Clean any stored layout: unknown ids dropped, duplicates removed, and any
// widget that is neither placed nor hidden goes back to its default zone.
function normalizeLayout(raw) {
  const out = { zones: { top: [], c1: [], c2: [], c3: [] }, hidden: [] };
  const seen = new Set();
  const src = raw && typeof raw === 'object' ? raw : {};
  const zones = src.zones && typeof src.zones === 'object' ? src.zones : null;
  if (!zones) return defaultLayout();
  for (const z of ZONES) {
    for (const id of asList(zones[z])) {
      if (isWidget(id) && !seen.has(id)) { out.zones[z].push(id); seen.add(id); }
    }
  }
  for (const id of asList(src.hidden)) {
    if (isWidget(id) && !seen.has(id)) { out.hidden.push(id); seen.add(id); }
  }
  for (const w of allWidgets()) if (!seen.has(w.id)) out.zones[w.zone].push(w.id);
  return out;
}

function cloneLayout(l) { return { zones: Object.fromEntries(ZONES.map((z) => [z, l.zones[z].slice()])), hidden: l.hidden.slice() }; }
function zoneOf(layout, id) { return ZONES.find((z) => layout.zones[z].includes(id)) || null; }

function removeWidget(layout, id) {
  const l = cloneLayout(layout);
  const z = zoneOf(l, id);
  if (!z) return l;
  l.zones[z] = l.zones[z].filter((x) => x !== id);
  if (!l.hidden.includes(id)) l.hidden.push(id);
  return l;
}

// heights: zone -> pixel height, so a new card lands in the shortest column.
function addWidget(layout, id, heights) {
  const l = cloneLayout(layout);
  if (!isWidget(id) || zoneOf(l, id)) return l;
  l.hidden = l.hidden.filter((x) => x !== id);
  let zone = 'top';
  if (!TOP_ONLY.includes(id)) {
    const cols = ['c1', 'c2', 'c3'];
    zone = cols.reduce((best, z) => {
      const hb = heights && heights[best] != null ? heights[best] : l.zones[best].length;
      const hz = heights && heights[z] != null ? heights[z] : l.zones[z].length;
      return hz < hb ? z : best;
    }, cols[0]);
  }
  l.zones[zone].push(id);
  return l;
}

// Up/down at phone width: walks the flat order (top, column 1, 2, 3) and
// crosses into the neighbouring zone at a zone edge, like the mockup.
function moveWidget(layout, id, dir) {
  const l = cloneLayout(layout);
  const z = zoneOf(l, id);
  if (!z) return l;
  const list = l.zones[z];
  const i = list.indexOf(id);
  const j = i + dir;
  if (j >= 0 && j < list.length) { list.splice(i, 1); list.splice(j, 0, id); return l; }
  const zi = ZONES.indexOf(z) + dir;
  if (zi < 0 || zi >= ZONES.length) return l;
  list.splice(i, 1);
  const target = l.zones[ZONES[zi]];
  if (dir < 0) target.push(id); else target.unshift(id);
  return l;
}

function placeWidget(layout, id, zone, index) {
  const l = cloneLayout(layout);
  const z = zoneOf(l, id);
  if (z) l.zones[z] = l.zones[z].filter((x) => x !== id);
  l.hidden = l.hidden.filter((x) => x !== id);
  const list = l.zones[zone] || l.zones.c1;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, id);
  return l;
}

function sameLayout(a, b) { return JSON.stringify(normalizeLayout(a)) === JSON.stringify(normalizeLayout(b)); }

/* ---- calendar picker (Settings › Calendars) ------------------------------- *
 * Mockup approved 2026-10-04 (mockup-calendar-picker.html). The program that
 * writes the calendar note lists every calendar on the account in its
 * `calendars` frontmatter list; the choice is saved HERE, in this part's
 * settings as calendars.selected (calendar ids), and that program reads it and
 * fetches only those. Ids are stable hashes, so a rename never loses a tick.
 */
const CAL_GROUP_ORDER = ['My calendars', 'Shared', 'Subscribed', 'Other'];

// Saved choice -> array of ids, or null when nothing has been saved yet.
function normalizeCalSel(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.selected)) return null;
  return [...new Set(raw.selected.filter((x) => typeof x === 'string' && x))];
}

// `calendars` frontmatter -> clean list (bad rows dropped).
function calendarListFrom(fm) {
  return asList(fm && fm.calendars)
    .filter((c) => c && typeof c === 'object' && typeof c.id === 'string' && c.id)
    .map((c) => ({
      id: c.id, name: String(c.name || 'Calendar'), account: String(c.account || 'iCloud'),
      group: CAL_GROUP_ORDER.includes(c.group) ? c.group : 'Other',
      color: /^#[0-9a-f]{6}$/i.test(String(c.color || '')) ? String(c.color) : null,
      subscribed: c.subscribed === true, kind: c.kind === 'reminders' ? 'reminders' : 'events',
      selected: c.selected === true,
      events: Number.isFinite(c.events) ? c.events : null,
      status: ['ok', 'empty', 'unreachable'].includes(c.status) ? c.status : null,
    }));
}

// -> [{ account, groups: [{ group, items }] }], only selectable calendars.
function groupCalendars(list) {
  const accounts = [];
  list.filter((c) => c.kind === 'events').forEach((c) => {
    let a = accounts.find((x) => x.account === c.account);
    if (!a) { a = { account: c.account, groups: [] }; accounts.push(a); }
    let g = a.groups.find((x) => x.group === c.group);
    if (!g) { g = { group: c.group, items: [] }; a.groups.push(g); }
    g.items.push(c);
  });
  accounts.forEach((a) => a.groups.sort((x, y) => CAL_GROUP_ORDER.indexOf(x.group) - CAL_GROUP_ORDER.indexOf(y.group)));
  return accounts;
}

// The note on the right of a calendar row: { text, warn } or null.
function calendarNote(c) {
  if (c.status === 'empty') return { text: 'feed is empty right now', warn: true };
  if (c.status === 'unreachable') return { text: "couldn't reach it on the last sync", warn: true };
  if (c.events > 0) return { text: `${c.events} event${c.events === 1 ? '' : 's'} this week and next`, warn: false };
  return null;
}

// '2026-10-04 07:47' (the sync's local time) -> 'today at 7:47 AM'.
function listUpdatedText(updated, today) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(updated || ''));
  if (!m) return 'List not synced yet';
  const day = m[1] === today ? 'today' : (m[1] === addDays(today, -1) ? 'yesterday' : shortDue(m[1]));
  return `List updated ${day} at ${fmt12(`${m[2]}:${m[3]}`)}`;
}

// Footer naming the reminder lists that are left out.
function remindersFooter(list) {
  const names = list.filter((c) => c.kind === 'reminders').map((c) => c.name.replace(/\s*⚠️?\s*$/u, '').trim());
  if (!names.length) return '';
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length - 3;
  return `Reminder lists (${shown}${rest > 0 ? ` and ${rest} more` : ''}) are not calendars and are left out.`;
}

/* Startup: open the Today page when Obsidian starts (default on). Off means
 * Obsidian simply restores whatever was open last; Today is never opened,
 * focused or revealed at startup. Opening it by hand always works. */
function normalizeOpenOnStartup(raw) { return raw !== false; }
function startupOpensToday(saved) { return normalizeOpenOnStartup(saved && saved.openOnStartup); }

const logic = {
  normalizeOpenOnStartup, startupOpensToday,
  ACCENTS, HAND_FONTS, DEFAULT_LOOK, normalizeLook, contrastRatio, readableShade, accentShade, SCHEMES, schemeOf, orderForInsert, applyMove, planInsert, dueOnDay, planOverdueMove, applyOverdueMove, pad2, dayOf, toDayStr, addDays, daysBetween, weekdayOf, parseRRule, occursOn, taskFromFrontmatter, taskTitleOf, isTaskDone, openProjectPage,
  taskOnDay, isSomeday, applySomeday, sortByOrder, buildTaskLists, plateText, greeting, findLogSpan, parseDoneSet, computeStreak, toggleHabitLog,
  greetingLine, scratchPathFor, cleanCapture, captureLine, captureMaxHeight, captureDragHeight, CAPTURE_MAX_PX, renderTemplate, formatDateTokens, insertQuickNote, insertSectionAtTop, markerRanges, isScratchpadPath, weatherAge, tidesLine,
  wmoIcon, fmt12, eventsWindow, longDate, shortDue, eventDayLabel, moodWhen, clockText, journalExcerpt, defaultLayout,
  normalizeLayout, removeWidget, addWidget, moveWidget, placeWidget, sameLayout, WIDGETS, LATER_WIDGETS, ZONES, EXTRA_WIDGETS,
  normalizeCalSel, normalizeUserName, calendarListFrom, groupCalendars, calendarNote, listUpdatedText, remindersFooter, CAL_GROUP_ORDER,
  timeOf, ruleTimeOf, halfOfTime, timeText, onDay, movedDate, untimedSlot, writeWithUndo,
  REMINDER_CHOICES, ringField, offsetMinutes, offsetIso, reminderOf, reminderShort, reminderWords,
};

/* ========================================================================== *
 * Plugin
 * ========================================================================== */

class A4TodayPlugin extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    this.layout = normalizeLayout(saved.layout);
    this.look = normalizeLook(saved.look);
    this.calSel = normalizeCalSel(saved.calendars);
    this.openOnStartup = normalizeOpenOnStartup(saved.openOnStartup);
    this.userName = normalizeUserName(saved.userName);
    // Runs the calendar sync now: (refresh) => Promise<boolean>. Set through LifeWorld's setCalendarSync
    // by a companion add-on; none = the picker saves the choice and the next sync picks it up.
    this.calendarSync = null;
    this.addSettingTab(new TodaySettingTab(this.app, this));
    // First run after the picker shipped: adopt what the sync is already
    // fetching (it carried old ticks over) as the saved choice.
    this.registerEvent(this.app.metadataCache.on('changed', (file) => { if (file && feedNotes.calendar && file.path === feedNotes.calendar) this.adoptCalendarChoice(); }));
    this.app.workspace.onLayoutReady(() => this.adoptCalendarChoice());
    this.registerEvent(this.app.workspace.on('css-change', () => this.applyLook()));

    // Display-only: hide the Places/stay HTML-comment markers in Live Preview.
    // CodeMirror loads here, so a missing module turns off only this, never the plugin (review p2-s8 #3).
    const markerExt = [];
    this.registerEditorExtension(markerExt);
    Promise.all([import('@codemirror/state'), import('@codemirror/view')])
      .then((ms) => { markerExt.push(buildMarkerHider(this.app, Object.assign({}, ...ms))); this.app.workspace.updateOptions(); })
      .catch((e) => console.warn('A4 Today: marker hiding unavailable', e));

    this.registerView(VIEW_TYPE, (leaf) => new TodayView(leaf, this));
    this.addRibbonIcon('sun', 'Open Today', () => this.openToday());
    this.addCommand({ id: 'open', name: 'Open today', callback: () => this.openToday() });
    this.addCommand({ id: 'capture', name: "Quick capture to today's scratchpad", callback: () => new CaptureModal(this.app, this, '').open() });
    // Opens the capture box pre-filled; the user's Enter does the saving.
    this.registerObsidianProtocolHandler('a4-today-capture', (params) => {
      new CaptureModal(this.app, this, cleanCapture(params && params.text)).open();
    });
    // The only place Today opens itself at startup; the setting decides.
    this.app.workspace.onLayoutReady(() => { if (this.openOnStartup) this.openToday(); });
  }

  async onExternalSettingsChange() {
    const saved = (await this.loadData()) || {};
    this.layout = normalizeLayout(saved.layout);
    this.look = normalizeLook(saved.look);
    this.calSel = normalizeCalSel(saved.calendars);
    this.openOnStartup = normalizeOpenOnStartup(saved.openOnStartup);
    this.userName = normalizeUserName(saved.userName);
    this.applyLook();
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (!l.view) return; if (l.view.onLayoutChangedElsewhere) l.view.onLayoutChangedElsewhere(); if (l.view.data && l.view.renderHeader) l.view.renderHeader(); });
  }

  // An add-on widget was added or removed (LifeWorld calls this). Read from the saved layout, so a widget
  // the person had placed or hidden comes back there (it was set aside while it was missing).
  async extrasChanged() {
    const saved = (await this.loadData()) || {};
    this.layout = normalizeLayout(saved.layout);
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (l.view && l.view.onLayoutChangedElsewhere) l.view.onLayoutChangedElsewhere(); });
  }

  async saveLayout(layout) {
    this.layout = normalizeLayout(layout);
    const data = (await this.loadData()) || {};
    data.layout = this.layout;
    await this.saveData(data);
  }

  async saveOpenOnStartup(on) {
    this.openOnStartup = !!on;
    const data = (await this.loadData()) || {};
    data.openOnStartup = this.openOnStartup;
    await this.saveData(data);
  }

  async saveUserName(name) {
    const data = (await this.loadData()) || {};
    data.userName = normalizeUserName(name);
    await this.saveData(data);
    this.userName = data.userName; // only once saved: a failed write leaves the name as it was
    this.app.workspace.getLeavesOfType(VIEW_TYPE).forEach((l) => { if (l.view && l.view.data && l.view.renderHeader) l.view.renderHeader(); });
  }

  async saveLook(look) {
    this.look = normalizeLook(look);
    const data = (await this.loadData()) || {};
    data.look = this.look;
    await this.saveData(data);
    this.applyLook();
  }

  /* ---- calendar picker ---- */

  calendarFrontmatter() {
    const f = feedNotes.calendar ? this.app.vault.getAbstractFileByPath(feedNotes.calendar) : null;
    const c = f instanceof TFile ? this.app.metadataCache.getFileCache(f) : null;
    return (c && c.frontmatter) || null;
  }

  calendarList() { return calendarListFrom(this.calendarFrontmatter()); }

  async saveCalendarChoice(ids) {
    this.calSel = normalizeCalSel({ selected: ids });
    const data = (await this.loadData()) || {};
    data.calendars = { selected: this.calSel };
    await this.saveData(data);
  }

  async adoptCalendarChoice() {
    if (this.calSel !== null || this.adopting) return;
    const list = this.calendarList();
    if (!list.length) return;
    this.adopting = true;
    try {
      const data = (await this.loadData()) || {};
      if (normalizeCalSel(data.calendars) !== null) { this.calSel = normalizeCalSel(data.calendars); return; }
      await this.saveCalendarChoice(list.filter((c) => c.kind === 'events' && c.selected).map((c) => c.id));
    } finally { this.adopting = false; }
  }

  // The calendar note's path changed (Sync, or set later): adopt from that note now, not after
  // its next rewrite (review p2-s5).
  onVaultChange() { this.adoptCalendarChoice().catch((e) => console.warn('[a4-today] calendar choice not adopted', e)); }

  canRunSync() { return typeof this.calendarSync === 'function'; }

  // Runs the add-on's calendar sync now; one run at a time, a request during a run runs once after it.
  // Resolves true on success.
  runCalendarSync(refresh) {
    if (!this.canRunSync()) return Promise.resolve(false);
    if (this.syncRun) { this.syncAgain = refresh ? true : this.syncAgain || 'plain'; return this.syncRun; }
    this.syncRun = Promise.resolve().then(() => this.calendarSync(!!refresh)).then((ok) => ok === true, (e) => {
      console.warn('[a4-today] calendar sync failed', e); return false;
    }).then((ok) => {
      this.syncRun = null;
      const again = this.syncAgain; this.syncAgain = null;
      return again ? this.runCalendarSync(again === true) : ok;
    });
    return this.syncRun;
  }

  // After a tick changes: sync shortly, once, however many boxes were ticked.
  scheduleCalendarSync(onDone) {
    if (!this.canRunSync()) return false;
    if (this.syncTimer) window.clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => { this.syncTimer = null; this.runCalendarSync(false).then((ok) => onDone && onDone(ok)); }, SYNC_AFTER_CHANGE_MS);
    return true;
  }

  onunload() { if (this.syncTimer) window.clearTimeout(this.syncTimer); }

  // Loads a bundled font once (FontFace API, works on desktop and mobile).
  loadHandFont(id) {
    this.fontLoads = this.fontLoads || {};
    if (this.fontLoads[id]) return this.fontLoads[id];
    const f = HAND_FONTS.find((x) => x.id === id);
    const b64 = typeof A4T_FONT_DATA !== 'undefined' && A4T_FONT_DATA[id];
    if (!f || !b64 || typeof FontFace === 'undefined') return Promise.resolve(false);
    this.fontLoads[id] = (async () => {
      try {
        const bin = atob(b64); const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const face = new FontFace(f.family, buf.buffer, { weight: String(f.weight), style: 'normal' });
        await face.load();
        document.fonts.add(face);
        this.register(() => { try { document.fonts.delete(face); } catch { /* gone */ } });
        return true;
      } catch (e) { console.warn('[a4-today] font failed to load', id, e); return false; }
    })();
    return this.fontLoads[id];
  }

  obsidianAccent() {
    const probe = document.body.createDiv({ cls: 'a4t-accent-probe' });
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }

  // Sets the accent shade and handwriting font on an element (a Today page or
  // the settings preview) for the current light/dark mode.
  styleLook(el, look) {
    const l = look || this.look;
    const dark = document.body.classList.contains('theme-dark');
    const bg = getComputedStyle(el).backgroundColor;
    const bgOk = rgbOf(bg) && !/rgba\(.*,\s*0\)$/.test(bg) ? bg : null;
    const shade = accentShade(l, dark, l.accent === 'accent' ? this.obsidianAccent() : null, bgOk);
    if (shade) el.style.setProperty('--a4t-acc', shade); else el.style.removeProperty('--a4t-acc');
    const f = HAND_FONTS.find((x) => x.id === l.font) || HAND_FONTS[0];
    el.style.setProperty('--a4t-hand-family', `'${f.family}'`);
    el.style.setProperty('--a4t-hand-weight', String(f.weight));
    this.loadHandFont(f.id);
  }

  applyLook() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view && leaf.view.contentEl) this.styleLook(leaf.view.contentEl);
  }

  async openToday() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  // The Find window lives in A4 Projects (its search, its engine): one window for Today, the Planner and the command.
  openFind() {
    const pj = partOf(this.app, 'a4-projects');
    if (pj && typeof pj.openFind === 'function') { pj.openFind(); return true; }
    new Notice('Find needs the projects and tasks part turned on.');
    return false;
  }

  plannerOn() { const cmds = this.app.commands; return !!(cmds && cmds.commands && cmds.commands[PLANNER_COMMAND]); }

  openPlanner() {
    const cmds = this.app.commands;
    if (cmds && cmds.commands && cmds.commands[PLANNER_COMMAND]) { cmds.executeCommandById(PLANNER_COMMAND); return; }
    new Notice('The planner is not turned on.');
  }

  openMoodCheckin() {
    const cmds = this.app.commands;
    if (cmds && cmds.commands && cmds.commands[MOOD_COMMAND]) cmds.executeCommandById(MOOD_COMMAND);
    else new Notice('Mood check-in is part of A4 Health, which is not turned on.');
  }

  /* ---- color scheme ------------------------------------------------------ */

  canReadScheme() { return !!(this.app.vault && typeof this.app.vault.getConfig === 'function'); }

  currentScheme() {
    if (!this.canReadScheme()) return null;
    return schemeOf(this.app.vault.getConfig('theme')) || schemeOf(document.body.classList.contains('theme-dark') ? 'obsidian' : 'moonstone');
  }

  // Obsidian saves this setting to appearance.json on a 1 s debounce and
  // re-reads that file on a separate debounce (app.js 1.13.7: requestSaveConfig,
  // reloadConfig). Two changes close together can be undone by that re-read,
  // which restores the older saved value (seen in a test with no plugin
  // involved). Saving right away with Obsidian's own vault.saveConfig (what the
  // debounce calls) puts the new value on disk before any re-read.
  setScheme(id) {
    const ok = this.applyScheme(id);
    const v = this.app.vault;
    if (ok && v && typeof v.saveConfig === 'function') {
      Promise.resolve().then(() => v.saveConfig()).catch((e) => console.warn('[a4-today] saving the color scheme failed', e));
    }
    return ok;
  }

  applyScheme(id) {
    const app = this.app;
    if (typeof app.changeTheme === 'function') { app.changeTheme(id); return true; }
    if (app.vault && typeof app.vault.setConfig === 'function') { // older or changed builds: same setting, then redraw
      app.vault.setConfig('theme', id);
      if (typeof app.updateTheme === 'function') app.updateTheme();
      return true;
    }
    new Notice('Change the color scheme in settings › appearance.');
    return false;
  }

  openPath(path, newTab) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof TFile) this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(f);
  }

  /* ---- tasks (A4 Projects' task engine) -------------------------------- */

  projectsPlugin() { return partOf(this.app, 'a4-projects'); }

  // A4 Projects' task engine, when it is the chosen task source (Settings › A4 Projects).
  tasksApi() {
    const own = this.projectsPlugin();
    return own && typeof own.taskApi === 'function' ? own.taskApi() : null;
  }

  completedStatuses() {
    const own = this.projectsPlugin();
    let list = [];
    try { if (own && own.engine) list = own.engine.cfg().statuses.filter((s) => s.isCompleted).map((s) => s.value); } catch { /* defaults below */ }
    return list.length ? list : DEFAULT_COMPLETED_STATUSES;
  }

  // Returns the task's new done state for `day`.
  async toggleTask(item, day) {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) throw new Error('That task note is gone.');
    const wasDone = isTaskDone(item, day, this.completedStatuses());
    const api = this.tasksApi();
    if (api) {
      if (item.recurrenceRaw) {
        // An explicit day: the engine reads 'YYYY-MM-DD' as a UTC-anchored
        // calendar day, so the stored instance is exactly `day`.
        const t = await api.recurring.toggleCompleteInstance(item.path, day);
        const list = asList(t && t.complete_instances).map(toDayStr);
        const nowDone = list.includes(day);
        if (nowDone === wasDone) console.warn('[a4-today] the task engine recorded a different day than expected', item.path, day, list);
        return nowDone;
      }
      if (wasDone) await api.tasks.uncomplete(item.path); else await api.tasks.complete(item.path);
      return !wasDone;
    }
    // Fallback without A4 Projects' engine: the same fields the A4 Daily Planner writes.
    let nowDone = !wasDone;
    await this.app.fileManager.processFrontMatter(file, (raw) => writable(raw, (fm) => {
      const stamp = new Date().toISOString();
      if (item.recurrenceRaw) {
        const list = asList(fm.complete_instances).map(toDayStr).filter(Boolean);
        const i = list.indexOf(day);
        if (i >= 0) list.splice(i, 1); else list.push(day);
        fm.complete_instances = list;
        nowDone = list.includes(day);
      } else if (wasDone) {
        fm.status = 'open';
        delete fm.completedDate;
      } else {
        fm.status = 'done';
        fm.completedDate = dayOf(new Date());
      }
      fm.dateModified = stamp;
    }));
    return nowDone;
  }

  // "Move all N to today": `plan` from planOverdueMove. One frontmatter write
  // per task; each remembers what the keys it changed held before, so the
  // returned undo() puts every note back exactly (a key that was absent is
  // removed again). -> { moved: [paths], failed: [paths], undo }
  async moveOverdueToToday(plan, day) {
    const completed = this.completedStatuses();
    const restores = [];
    const moved = []; const failed = [];
    for (const step of plan) {
      const file = this.app.vault.getAbstractFileByPath(step.path);
      if (!(file instanceof TFile)) { failed.push(step.path); continue; }
      let before = null;
      try {
        await this.app.fileManager.processFrontMatter(file, (fm) => {
          const copy = JSON.parse(JSON.stringify(fm || {}));
          if (!writable(fm, (v) => applyOverdueMove(v, day, step.order, completed))) return;
          before = {};
          for (const k of [propNames.due, propNames.planned_order]) {
            before[k] = Object.prototype.hasOwnProperty.call(copy, k) ? { v: copy[k] } : null;
          }
        });
      } catch (e) {
        console.error('[a4-today] move to today failed', step.path, e);
        failed.push(step.path);
        continue;
      }
      if (before) { moved.push(step.path); restores.push({ path: step.path, before }); }
    }
    const undo = async () => {
      let bad = 0;
      for (const r of restores.slice().reverse()) {
        const f = this.app.vault.getAbstractFileByPath(r.path);
        if (!(f instanceof TFile)) { bad++; continue; }
        try {
          await this.app.fileManager.processFrontMatter(f, (fm) => {
            for (const [k, b] of Object.entries(r.before)) { if (b) fm[k] = b.v; else delete fm[k]; }
          });
        } catch (e) { console.error('[a4-today] undo failed', r.path, e); bad++; }
      }
      return bad;
    };
    return { moved, failed, undo };
  }

  /* ---- habits ----------------------------------------------------------- */

  async toggleHabit(file, day) {
    let on = false;
    await this.app.vault.process(file, (text) => { const r = toggleHabitLog(text, day); on = r.on; return r.text; });
    return on;
  }

  /* ---- capture ---------------------------------------------------------- */

  async capture(rawText) {
    const text = cleanCapture(rawText);
    if (!text) return null;
    const now = new Date();
    const dn = dailyNotes(this.app);
    const path = scratchPathFor(now, dn, momentFormat());
    const line = captureLine(now, text);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      const content = insertQuickNote(await this.newScratchpadContent(now, dn), line);
      try {
        // Every missing folder on the way, so a nested date format ('YYYY/MM/YYYY-MM-DD') works too.
        const steps = path.split('/').slice(0, -1);
        for (let i = 1; i <= steps.length; i++) {
          const dir = steps.slice(0, i).join('/');
          if (!this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir);
        }
        await this.app.vault.create(path, content);
        return path;
      } catch (e) {
        file = this.app.vault.getAbstractFileByPath(path); // created meanwhile (e.g. by Daily notes)
        if (!(file instanceof TFile)) throw e;
      }
    }
    await this.app.vault.process(file, (t) => insertQuickNote(t, line));
    return path;
  }

  async newScratchpadContent(now, dn) {
    const d = dn || dailyNotes(this.app);
    // Obsidian stores the template without '.md'.
    const tpl = d.template ? this.app.vault.getAbstractFileByPath(/\.md$/i.test(d.template) ? d.template : `${d.template}.md`) : null;
    const fmt = momentFormat();
    if (tpl instanceof TFile) {
      // {{title}} is the note's own name, also when the date format nests it in folders.
      try { return renderTemplate(await this.app.vault.read(tpl), now, fmt, scratchNameFor(now, d, fmt).split('/').pop()); } catch { /* fall through */ }
    }
    return `---\ntype: scratchpad\ndate: ${dayOf(now)}\n---\n`;
  }
}

/* ========================================================================== *
 * Capture modal (command + link)
 * ========================================================================== */

// The "Enter" key-cap beside a capture box. Before 1.6.0 it was only a label;
// now it is a real control that saves, the same as pressing Enter.
function captureSendButton(box) {
  return box.createEl('kbd', { text: 'Enter', cls: 'a4t-capture-send', attr: { role: 'button', tabindex: '0', 'aria-label': "Save to today's scratchpad", title: "Save to today's scratchpad", 'data-testid': 'a4t-capture-send' } });
}

class CaptureModal extends Modal {
  constructor(app, plugin, initial) { super(app); this.plugin = plugin; this.initial = initial || ''; }
  onOpen() {
    this.modalEl.addClass('a4t-capture-modal');
    this.plugin.styleLook(this.modalEl);
    const { contentEl } = this;
    contentEl.createDiv({ cls: 'a4t-kicker', text: "Today's scratchpad" });
    const box = contentEl.createDiv({ cls: 'a4t-capture' });
    setIcon(box.createSpan({ cls: 'a4t-ic' }), 'pencil');
    const input = box.createEl('input', { type: 'text', attr: { placeholder: "Jot a thought for today's scratchpad", autocomplete: 'off' } });
    input.value = this.initial;
    const send = captureSendButton(box);
    const submit = async () => {
      if (!cleanCapture(input.value)) return;
      try { await this.plugin.capture(input.value); new Notice("Added to today's scratchpad"); this.close(); }
      catch (err) { console.error('[a4-today] capture failed', err); new Notice('Could not save that note. Nothing was lost; try again.'); }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submit();
    });
    send.addEventListener('pointerdown', (e) => e.preventDefault());
    send.addEventListener('click', (e) => { e.preventDefault(); submit(); });
    send.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); submit(); } });
    window.setTimeout(() => input.focus(), 30);
  }
  onClose() { this.contentEl.empty(); }
}

/* ========================================================================== *
 * Settings: accent colour and handwriting font, with a live preview
 * ========================================================================== */

class TodaySettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('a4t-settings');
    const look = { ...this.plugin.look };
    let swatches;
    let preview;
    const update = async (patch) => {
      Object.assign(look, patch);
      await this.plugin.saveLook(look);
      paintSwatches();
      paintPreview();
    };
    // The approved step 0 mockup's first Today page row (lifeworld-step0-mockup.html, Settings).
    new Setting(containerEl)
      .setName('Your name')
      .setDesc('Shown in the greeting. Leave empty for none.')
      .addText((t) => {
        t.setPlaceholder('Optional').setValue(this.plugin.userName);
        t.inputEl.setAttr('aria-label', 'Your name');
        // Saved when the box is left or Enter is pressed, not on every keystroke.
        t.inputEl.addEventListener('change', async () => {
          try { await this.plugin.saveUserName(t.getValue()); } catch (e) { console.error('[a4-today] name not saved', e); new Notice('Your name could not be saved.'); }
          t.setValue(this.plugin.userName); // the box shows what is saved (trimmed, cut to length, or the old name)
          if (preview && preview.isConnected) preview.querySelector('.a4t-pv-title').setText(greetingLine(new Date().getHours(), this.plugin.userName));
        });
      });
    new Setting(containerEl)
      .setName('Open the today page when Obsidian starts')
      .setDesc('Turn off to reopen whatever you had open last.')
      .addToggle((t) => {
        t.setValue(this.plugin.openOnStartup);
        t.onChange((v) => this.plugin.saveOpenOnStartup(v));
      })
      .then((s) => s.settingEl.addClass('a4t-startup'));
    new Setting(containerEl)
      .setName('Accent colour')
      .setDesc('Colour of the underline under the greeting and the handwritten lines. Following the Obsidian accent uses the accent from settings › appearance, shaded so it stays readable.')
      .addDropdown((d) => {
        ACCENTS.forEach((a) => d.addOption(a.id, a.name));
        d.setValue(look.accent);
        d.onChange((v) => update({ accent: v }));
      })
      .then((s) => { swatches = s.controlEl.createDiv({ cls: 'a4t-swatches' }); });
    new Setting(containerEl)
      .setName('Handwriting font')
      .setDesc('Used for the line under the greeting and the small handwritten notes. All four are bundled with the plugin.')
      .addDropdown((d) => {
        HAND_FONTS.forEach((f) => d.addOption(f.id, f.name));
        d.setValue(look.font);
        d.onChange((v) => update({ font: v }));
      });
    preview = containerEl.createDiv({ cls: 'a4t-preview' });
    preview.createDiv({ cls: 'a4t-pv-k', text: 'Preview' });
    preview.createDiv({ cls: 'a4t-pv-title', text: greetingLine(new Date().getHours(), this.plugin.userName) });
    preview.createDiv({ cls: 'a4t-pv-hand', text: '5 things on your plate today' });
    const dark = () => document.body.classList.contains('theme-dark');
    const paintSwatches = () => {
      swatches.empty();
      ACCENTS.filter((a) => a.light).forEach((a) => {
        const sw = swatches.createSpan({ cls: `a4t-swatch${look.accent === a.id ? ' is-on' : ''}`, attr: { 'aria-label': a.name, 'data-accent': a.id } });
        sw.style.setProperty('--a4t-sw', dark() ? a.dark : a.light);
        sw.addEventListener('click', () => { const dd = containerEl.querySelector('select'); if (dd) dd.value = a.id; update({ accent: a.id }); });
      });
    };
    const paintPreview = () => this.plugin.styleLook(preview, look);
    paintSwatches();
    paintPreview();
    if (this._cssRef) this.app.workspace.offref(this._cssRef);
    this._cssRef = this.app.workspace.on('css-change', () => { if (preview.isConnected) { paintSwatches(); paintPreview(); } });
    this.plugin.registerEvent(this._cssRef);

    this.calHost = containerEl.createDiv({ cls: 'a4t-cal-picker' });
    this.calStatus = '';
    this.renderCalendars();
    if (this._calRef) this.app.metadataCache.offref(this._calRef);
    this._calRef = this.app.metadataCache.on('changed', (file) => {
      if (file && feedNotes.calendar && file.path === feedNotes.calendar && this.calHost && this.calHost.isConnected) this.renderCalendars();
    });
    this.plugin.registerEvent(this._calRef);
  }

  renderCalendars() {
    const host = this.calHost;
    const plugin = this.plugin;
    host.empty();
    const list = plugin.calendarList();
    const fm = plugin.calendarFrontmatter();
    const chosen = new Set(plugin.calSel !== null ? plugin.calSel : list.filter((c) => c.selected).map((c) => c.id));
    const desktop = plugin.canRunSync();
    // No calendar note and no sync: there is nothing to pick from (a new install, section 7).
    if (!feedNotes.calendar && !desktop) return;

    const head = new Setting(host)
      .setName('Calendars')
      .setDesc(`Tick the calendars you want to see. Your choice is used on the Today page and in the Planner. ${desktop ? 'Changes show up within a minute.' : 'Changes show up after the next calendar sync.'}`);
    head.settingEl.addClass('a4t-cal-head');
    head.addButton((b) => {
      b.setButtonText(this.refreshing ? 'Refreshing…' : 'Refresh list').setCta();
      b.buttonEl.addClass('a4t-cal-refresh');
      if (!desktop) { b.setDisabled(true); b.setTooltip('Refresh needs a calendar sync on this device'); }
      if (this.refreshing) b.setDisabled(true);
      b.onClick(async () => {
        this.refreshing = true; this.calStatus = ''; this.renderCalendars();
        const ok = await plugin.runCalendarSync(true);
        this.refreshing = false;
        this.calStatus = ok ? '' : 'The refresh did not finish. The list below is from the last sync.';
        if (host.isConnected) this.renderCalendars();
      });
    });
    const upd = head.controlEl.createDiv({ cls: 'a4t-cal-updated', text: listUpdatedText(fm && fm.updated, dayOf(new Date())) });
    head.controlEl.addClass('a4t-cal-head-ctl');
    upd.toggleClass('is-hidden', !fm);

    if (this.calStatus) host.createDiv({ cls: 'a4t-cal-status', text: this.calStatus });

    const accounts = groupCalendars(list);
    if (!accounts.length) {
      host.createDiv({ cls: 'a4t-cal-empty', text: 'No calendar list yet. It appears after the next calendar sync' + (desktop ? ', or press Refresh list.' : '.') });
      return;
    }
    const save = async () => {
      await plugin.saveCalendarChoice([...chosen]);
      if (plugin.scheduleCalendarSync((ok) => {
        this.calStatus = ok ? '' : 'Saved. The calendar will update at the next sync.';
        if (host.isConnected) this.renderCalendars();
      })) this.calStatus = 'Saved. Updating the calendar…';
      else this.calStatus = 'Saved. The next calendar sync picks this up.';
      const st = host.querySelector('.a4t-cal-status') || host.insertBefore(createDiv({ cls: 'a4t-cal-status' }), host.querySelector('.a4t-cal-account'));
      st.setText(this.calStatus);
    };
    accounts.forEach((acc) => {
      const box = host.createDiv({ cls: 'a4t-cal-account' });
      const ah = box.createDiv({ cls: 'a4t-cal-account-h' });
      ah.createSpan({ text: acc.account });
      const all = acc.groups.flatMap((g) => g.items);
      const tally = ah.createSpan({ cls: 'a4t-cal-tally' });
      const paintTally = () => tally.setText(`${all.filter((c) => chosen.has(c.id)).length} of ${all.length} ticked`);
      paintTally();
      acc.groups.forEach((g) => {
        box.createDiv({ cls: 'a4t-cal-group-h', text: g.group });
        g.items.forEach((c) => {
          const row = box.createEl('label', { cls: 'a4t-cal-row', attr: { 'data-cal-id': c.id } });
          const cb = row.createEl('input', { type: 'checkbox' });
          cb.checked = chosen.has(c.id);
          const dot = row.createSpan({ cls: 'a4t-cal-dot' });
          if (c.color) dot.style.setProperty('background', c.color);
          row.createSpan({ cls: 'a4t-cal-name', text: c.name });
          if (c.subscribed) row.createSpan({ cls: 'a4t-cal-badge', text: 'subscribed' });
          const note = calendarNote(c);
          row.createSpan({ cls: `a4t-cal-note${note && note.warn ? ' is-warn' : ''}`, text: note ? note.text : '' });
          cb.addEventListener('change', () => {
            if (cb.checked) chosen.add(c.id); else chosen.delete(c.id);
            paintTally();
            save();
          });
        });
      });
    });
    const foot = host.createDiv({ cls: 'a4t-cal-foot' });
    const rem = remindersFooter(list);
    if (rem) foot.createDiv({ text: rem });
    foot.createDiv({ text: 'New calendars you add on your phone appear here unticked.' });
  }

  hide() {
    if (this._cssRef) { this.app.workspace.offref(this._cssRef); this._cssRef = null; }
    if (this._calRef) { this.app.metadataCache.offref(this._calRef); this._calRef = null; }
  }
}

/* ========================================================================== *
 * The Today view
 * ========================================================================== */

class TodayView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.editing = false;
    this.panelOpen = false;
    this.overdueExpanded = false;
    this.renderedDay = null;
    this.data = null;
    this.drag = null;
    this.seq = 0;
    this.pending = new Map(); // path -> { done, until } so a just-ticked row never flickers back
    this.lastItems = new Map(); // path -> last good task (frontmatter can read empty right after a write)
    this.widgetEls = new Map();
    this._timer = null;
  }

  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Today'; }
  getIcon() { return 'sun'; }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('a4t-root');
    this.scroller = root.createDiv({ cls: 'a4t-scroll' });
    this.page = this.scroller.createDiv({ cls: 'a4t-page' });
    this.panel = root.createDiv({ cls: 'a4t-addpanel' });
    this.panel.hidden = true;
    this.buildShell();

    const onChange = (file) => { if (file && typeof file.path === 'string' && watches(file.path)) this.scheduleRefresh(); };
    this.registerEvent(this.app.metadataCache.on('changed', onChange));
    this.registerEvent(this.app.vault.on('create', onChange));
    this.registerEvent(this.app.vault.on('delete', onChange));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => { onChange(file); onChange({ path: oldPath }); }));
    this.registerEvent(this.app.metadataCache.on('resolved', () => { if (!this.data) this.scheduleRefresh(); }));
    // Clock, stale flag and midnight rollover.
    this.registerInterval(window.setInterval(() => this.tick(), 30000));
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => this.updateWidth());
      this.ro.observe(root);
    }
    this.updateWidth();
    this.plugin.styleLook(root);
    await this.refresh();
  }

  async onClose() {
    this.clearOverdueMoved(false);
    this.closeMoveMenu();
    this.closeSchemeMenu();
    if (this._timer) window.clearTimeout(this._timer);
    if (this.ro) this.ro.disconnect();
    this.endDrag(true);
  }

  updateWidth() {
    const w = this.contentEl.clientWidth;
    if (!w) return;
    this.contentEl.toggleClass('is-narrow', w < NARROW_WIDTH);
  }

  scheduleRefresh() {
    if (this._timer) window.clearTimeout(this._timer);
    this._timer = window.setTimeout(() => { this._timer = null; this.refresh(); }, 300);
  }

  tick() {
    if (dayOf(new Date()) !== this.renderedDay) { this.refresh(); return; }
    this.renderClock();
    this.renderWeatherAge();
  }

  /* ---- data ------------------------------------------------------------- */

  async collect() {
    const app = this.app;
    const today = dayOf(new Date());
    const completed = this.plugin.completedStatuses();

    // Tasks
    const items = [];
    const seenPaths = new Set();
    const root = app.vault.getAbstractFileByPath(vaultFolders.tasks);
    const walk = (folder) => {
      for (const c of folder.children || []) {
        if (c instanceof TFolder) walk(c);
        else if (c instanceof TFile && c.extension === 'md') {
          seenPaths.add(c.path);
          const cache = app.metadataCache.getFileCache(c);
          if (!cache || !cache.frontmatter) {
            const prev = this.lastItems.get(c.path); // brief empty read after a write
            if (prev) items.push(prev);
            continue;
          }
          const fm = readable(cache.frontmatter);
          const it = taskFromFrontmatter(fm, c.path, c.basename);
          if (it) it.projectLink = asList(fm.projects)[0] || null; // the label shows the name; the link finds the page
          if (it) { items.push(it); this.lastItems.set(c.path, it); } else this.lastItems.delete(c.path);
        }
      }
    };
    if (root instanceof TFolder) walk(root);
    for (const p of [...this.lastItems.keys()]) if (!seenPaths.has(p)) this.lastItems.delete(p);
    // Keep a just-ticked state until the cache agrees (or 4 s pass).
    const now = Date.now();
    for (const [path, st] of [...this.pending]) {
      const it = items.find((x) => x.path === path);
      if (!it || now > st.until) { this.pending.delete(path); continue; }
      if (isTaskDone(it, st.day, completed) === st.done) { this.pending.delete(path); continue; }
      it.optimistic = st.done;
    }
    const lists = buildTaskLists(items, today, completed);

    // Weather
    let weather = null;
    const wf = feedNotes.weather ? app.vault.getAbstractFileByPath(feedNotes.weather) : null;
    if (wf instanceof TFile) {
      const fm = (app.metadataCache.getFileCache(wf) || {}).frontmatter;
      if (fm && fm.temp != null) weather = fm;
    }

    // Calendar
    let events = [];
    const cf = feedNotes.calendar ? app.vault.getAbstractFileByPath(feedNotes.calendar) : null;
    if (cf instanceof TFile) {
      const fm = (app.metadataCache.getFileCache(cf) || {}).frontmatter;
      events = eventsWindow(fm && fm.events, today, CALENDAR_DAYS_AHEAD);
    }

    // Journal days (for the derived habit) and the latest entry
    const journalDays = new Set();
    let latest = null;
    for (const f of app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(vaultFolders.journal + '/')) continue;
      const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
      if (!fm || fm.type !== 'journal') continue;
      const d = toDayStr(fm.date);
      if (!d) continue;
      journalDays.add(d);
      if (!latest || d > latest.date) latest = { file: f, date: d };
    }
    let journal = null;
    if (latest) {
      try {
        const text = await app.vault.cachedRead(latest.file);
        const pos = (app.metadataCache.getFileCache(latest.file) || {}).frontmatterPosition;
        const body = pos && pos.end ? text.slice(pos.end.offset) : text.replace(/^---\n[\s\S]*?\n---\n?/, '');
        journal = { path: latest.file.path, date: latest.date, ...journalExcerpt(body) };
      } catch { journal = { path: latest.file.path, date: latest.date, text: '', cut: false }; }
    }

    // Habits: active daily habit notes, same filter as the Planner and A4 Habits
    const habits = [];
    const hf = app.vault.getAbstractFileByPath(vaultFolders.habits);
    if (hf instanceof TFolder) {
      for (const f of hf.children || []) {
        if (!(f instanceof TFile) || f.extension !== 'md') continue;
        const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!fm || fm.type !== 'habit' || fm.status !== 'active' || fm.cadence !== 'daily') continue;
        const derived = fm.derived === 'journal';
        let done = journalDays;
        if (!derived) { try { done = parseDoneSet(await app.vault.cachedRead(f)); } catch { done = new Set(); } }
        habits.push({ path: f.path, name: f.basename, derived, doneToday: done.has(today), streak: computeStreak(done, today) });
      }
      habits.sort((a, b) => a.name.localeCompare(b.name));
    }

    // Mood: the latest check-in, any day
    let mood = null;
    const mf = app.vault.getAbstractFileByPath(MOOD_FOLDER);
    if (mf instanceof TFolder) {
      for (const f of mf.children || []) {
        if (!(f instanceof TFile) || f.extension !== 'md') continue;
        const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!fm || fm.type !== 'mood-checkin') continue;
        const d = toDayStr(fm.date);
        const score = Number(fm.score);
        if (!d || !Number.isFinite(score)) continue;
        const key = `${d} ${String(timeToMinutes(fm.time)).padStart(5, '0')} ${String(f.stat ? f.stat.ctime : 0).padStart(15, '0')}`;
        if (!mood || key > mood.key) mood = { key, path: f.path, date: d, time: fm.time ? String(fm.time) : '', score: Math.round(score), felt: asList(fm.felt).map(String) };
      }
    }

    // Active projects
    const projects = [];
    const pf = app.vault.getAbstractFileByPath(vaultFolders.projects);
    if (pf instanceof TFolder) {
      for (const f of pf.children || []) {
        if (!(f instanceof TFile) || f.extension !== 'md') continue;
        const fm = (app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (fm && fm.type === 'project' && fm.status === 'active') projects.push({ path: f.path, name: f.basename });
      }
      projects.sort((a, b) => a.name.localeCompare(b.name));
    }

    return { today, completed, items, lists, weather, events, journal, habits, mood, projects };
  }

  async refresh() {
    const seq = ++this.seq;
    let data;
    try { data = await this.collect(); } catch (e) { console.error('[a4-today] refresh failed', e); return; }
    if (seq !== this.seq) return; // a newer refresh started while this one awaited
    if (this.drag || this.tdrag) { this.scheduleRefresh(); return; } // never redraw under a drag
    this.closeMoveMenu();
    if (data.today !== this.renderedDay) { this.overdueExpanded = false; this.clearOverdueMoved(false); }
    this.data = data;
    this.renderedDay = data.today;
    this.renderHeader();
    this.renderWidgets();
    this.renderClock();
  }

  /* ---- shell ------------------------------------------------------------ */

  buildShell() {
    const head = this.page.createDiv({ cls: 'a4t-head' });
    const left = head.createDiv();
    this.kickerEl = left.createDiv({ cls: 'a4t-kicker' });
    // Not `titleEl`: on a view that name is Obsidian's own header title (an internal it writes to).
    this.greetEl = left.createEl('h2', { cls: 'a4t-title' });
    this.plateEl = left.createSpan({ cls: 'a4t-hand-note' });

    const actions = head.createDiv({ cls: 'a4t-head-actions' });
    if (this.plugin.canReadScheme()) {
      this.schemeBtn = actions.createEl('button', { cls: 'a4t-btn a4t-ghost a4t-icon-only', attr: { 'aria-label': 'Color scheme' } });
      this.schemeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.openSchemeMenu(); });
      this.updateSchemeIcon();
      // Changes made anywhere (Settings, a command, Sync) arrive here.
      this.registerEvent(this.app.vault.on('config-changed', (key) => { if (key === 'theme') this.updateSchemeIcon(); }));
      this.registerEvent(this.app.workspace.on('css-change', () => this.updateSchemeIcon()));
    }
    const findBtn = actions.createEl('button', { cls: 'a4t-btn a4t-ghost a4t-find-btn', attr: { 'aria-label': 'Find a task' } });
    setIcon(findBtn.createSpan({ cls: 'a4t-ic' }), 'search');
    findBtn.appendText('Find');
    findBtn.addEventListener('click', () => this.plugin.openFind());
    const editBtn = actions.createEl('button', { cls: 'a4t-btn a4t-ghost' });
    setIcon(editBtn.createSpan({ cls: 'a4t-ic' }), 'layout-grid');
    editBtn.appendText('Edit layout');
    editBtn.addEventListener('click', () => this.setEditing(true));
    const planBtn = this.planBtn = actions.createEl('button', { cls: 'a4t-btn' });
    setIcon(planBtn.createSpan({ cls: 'a4t-ic' }), 'calendar-range');
    planBtn.appendText('Planner');
    planBtn.addEventListener('click', () => this.plugin.openPlanner());

    const edit = head.createDiv({ cls: 'a4t-edit-actions' });
    edit.createSpan({ cls: 'a4t-hand-note a4t-edit-hint', text: 'drag to reorder, × to remove' });
    const addBtn = edit.createEl('button', { cls: 'a4t-btn' });
    setIcon(addBtn.createSpan({ cls: 'a4t-ic' }), 'plus');
    addBtn.appendText('Add widget');
    addBtn.addEventListener('click', () => this.openPanel(true));
    const resetBtn = edit.createEl('button', { cls: 'a4t-btn a4t-ghost', text: 'Reset' });
    resetBtn.addEventListener('click', () => this.applyLayout(defaultLayout(), 'Back to the original layout'));
    const doneBtn = edit.createEl('button', { cls: 'a4t-btn a4t-primary', text: 'Done' });
    doneBtn.addEventListener('click', () => { this.setEditing(false); new Notice('Layout saved'); });

    this.zoneEls = {};
    this.zoneEls.top = this.page.createDiv({ cls: 'a4t-zone a4t-zone-top', attr: { 'data-zone': 'top' } });
    const grid = this.page.createDiv({ cls: 'a4t-grid' });
    for (const z of ['c1', 'c2', 'c3']) this.zoneEls[z] = grid.createDiv({ cls: 'a4t-zone a4t-col', attr: { 'data-zone': z } });
    // The closing line rides at the end of the right-hand column
    // (2026-10-03), under whichever widget is last there; in one column (phone)
    // that column is last, so the line ends the page.
    this.clockEl = this.zoneEls.c3.createDiv({ cls: 'a4t-hand-aside' });
  }

  updateSchemeIcon() {
    if (!this.schemeBtn) return;
    const cur = this.plugin.currentScheme();
    const icon = cur ? cur.icon : 'sun-moon';
    if (this.schemeBtn.dataset.icon !== icon) { this.schemeBtn.empty(); setIcon(this.schemeBtn, icon); this.schemeBtn.dataset.icon = icon; }
    this.schemeBtn.setAttr('aria-label', cur ? `Color scheme: ${cur.label}` : 'Color scheme');
    if (this.schemeMenu) this.schemeMenu.querySelectorAll('[data-scheme]').forEach((b) => b.toggleClass('is-on', !!cur && b.dataset.scheme === cur.id));
  }

  closeSchemeMenu() {
    if (this._schemeAway) { document.removeEventListener('pointerdown', this._schemeAway, true); this._schemeAway = null; }
    if (this._schemeScroll) { this.scroller.removeEventListener('scroll', this._schemeScroll); this._schemeScroll = null; }
    if (this.schemeMenu) { this.schemeMenu.remove(); this.schemeMenu = null; }
  }

  openSchemeMenu() {
    if (this.schemeMenu) { this.closeSchemeMenu(); return; }
    this.closeMoveMenu();
    const cur = this.plugin.currentScheme();
    const menu = this.schemeMenu = this.contentEl.createDiv({ cls: 'a4t-movemenu a4t-schememenu' });
    menu.createDiv({ cls: 'a4t-mm-k', text: 'Color scheme' });
    for (const sc of SCHEMES) {
      const b = menu.createEl('button', { cls: cur && cur.id === sc.id ? 'is-on' : '', attr: { 'data-scheme': sc.id } });
      setIcon(b.createSpan({ cls: 'a4t-ic' }), sc.icon);
      b.appendText(sc.label);
      setIcon(b.createSpan({ cls: 'a4t-ic a4t-ck' }), 'check');
      b.addEventListener('click', (e) => { e.stopPropagation(); this.closeSchemeMenu(); this.plugin.setScheme(sc.id); this.updateSchemeIcon(); });
    }
    menu.createDiv({ cls: 'a4t-mm-note', text: 'Changes all of Obsidian, same as Settings › Appearance.' });
    const rr = this.contentEl.getBoundingClientRect();
    const br = this.schemeBtn.getBoundingClientRect();
    menu.style.setProperty('--a4t-mx', `${Math.max(8, Math.min(br.left - rr.left, rr.width - 208))}px`);
    menu.style.setProperty('--a4t-my', `${br.bottom - rr.top + 6}px`);
    this._schemeAway = (e) => { if (!menu.contains(e.target) && !this.schemeBtn.contains(e.target)) this.closeSchemeMenu(); };
    document.addEventListener('pointerdown', this._schemeAway, true);
    this._schemeScroll = () => this.closeSchemeMenu();
    this.scroller.addEventListener('scroll', this._schemeScroll);
  }

  setEditing(on) {
    this.editing = on;
    this.closeMoveMenu();
    this.page.toggleClass('is-editing', on);
    if (!on) this.openPanel(false);
  }

  openPanel(on) {
    this.panelOpen = on;
    this.panel.hidden = !on;
    this.page.toggleClass('is-panel-open', on);
    if (on) this.renderPanel();
  }

  onLayoutChangedElsewhere() {
    if (this.drag) return;
    this.renderWidgets();
    if (this.panelOpen) this.renderPanel();
  }

  async applyLayout(layout, message) {
    await this.plugin.saveLayout(layout);
    this.renderWidgets();
    if (this.panelOpen) this.renderPanel();
    if (message) new Notice(message);
  }

  /* ---- header and clock ------------------------------------------------- */

  renderHeader() {
    const d = this.data;
    const now = new Date();
    this.kickerEl.setText(longDate(d.today));
    this.greetEl.setText(greetingLine(now.getHours(), this.plugin.userName));
    this.plateEl.setText(plateText(this.openCount(), d.lists.total));
    // The Planner switched off: its button goes, as drawn (phase 2 section 6).
    this.planBtn.toggleClass('a4t-off', !this.plugin.plannerOn());
  }

  openCount() {
    const d = this.data;
    return [...d.lists.morning, ...d.lists.afternoon].filter((t) => !this.doneOf(t)).length;
  }

  doneOf(t) { return t.optimistic != null ? t.optimistic : isTaskDone(t, this.data.today, this.data.completed); }

  renderClock() { if (this.clockEl) this.clockEl.setText(`it's ${clockText(new Date())}, one thing at a time.`); }

  renderWeatherAge() {
    const el = this.page.querySelector('.a4t-w-upd');
    const w = this.data && this.data.weather;
    if (!el || !w) return;
    const age = weatherAge(w.updated, new Date());
    el.setText(age.label);
    el.toggleClass('is-stale', age.stale);
  }

  /* ---- widgets ---------------------------------------------------------- */

  widgetEl(id) {
    let el = this.widgetEls.get(id);
    if (el) return el;
    const meta = allWidgets().find((w) => w.id === id);
    el = createDiv({ cls: `a4t-w a4t-w-${id}`, attr: { 'data-w': id } });
    const tools = el.createDiv({ cls: 'a4t-wtools' });
    const grip = tools.createSpan({ cls: 'a4t-grip', attr: { 'aria-label': 'Drag to move' } });
    setIcon(grip.createSpan({ cls: 'a4t-ic' }), 'grip-vertical');
    grip.appendText(meta.name);
    tools.createSpan({ cls: 'a4t-sp' });
    const up = tools.createEl('button', { cls: 'a4t-mv', attr: { 'aria-label': 'Move up' } });
    setIcon(up, 'chevron-up');
    const down = tools.createEl('button', { cls: 'a4t-mv', attr: { 'aria-label': 'Move down' } });
    setIcon(down, 'chevron-down');
    const rm = tools.createEl('button', { cls: 'a4t-rm', text: '×', attr: { 'aria-label': `Remove ${meta.name}` } });
    up.addEventListener('click', () => this.applyLayout(moveWidget(this.plugin.layout, id, -1)));
    down.addEventListener('click', () => this.applyLayout(moveWidget(this.plugin.layout, id, 1)));
    rm.addEventListener('click', () => this.applyLayout(removeWidget(this.plugin.layout, id), `${meta.name} removed. Add it back from "Add widget".`));
    this.registerDomEvent(grip, 'pointerdown', (e) => this.startDrag(e, id));
    el.createDiv({ cls: 'a4t-wbody' });
    this.widgetEls.set(id, el);
    return el;
  }

  renderWidgets() {
    if (!this.data) return;
    const layout = this.plugin.layout;
    for (const z of ZONES) {
      const zoneEl = this.zoneEls[z];
      const ids = layout.zones[z];
      ids.forEach((id, idx) => {
        const el = this.widgetEl(id);
        el.toggleClass('in-top', z === 'top');
        // Move only when out of place: re-inserting a node would drop the
        // focus (and the half-typed text's caret) in the capture box.
        if (zoneEl.children[idx] !== el) zoneEl.insertBefore(el, zoneEl.children[idx] || null);
        if (id === 'capture') { if (!el.dataset.built) this.renderCapture(el.querySelector('.a4t-wbody')); el.dataset.built = '1'; }
        else this.renderWidget(id, el.querySelector('.a4t-wbody'), el);
      });
    }
    // Hidden widgets, and an add-on's widget that is gone, leave the page.
    for (const [id, el] of this.widgetEls) if (!zoneOf(layout, id)) { el.detach(); if (!isWidget(id)) this.widgetEls.delete(id); }
    if (this.zoneEls.c3.lastElementChild !== this.clockEl) this.zoneEls.c3.appendChild(this.clockEl);
  }

  renderWidget(id, body, el) {
    body.empty();
    el.removeClass('a4t-card', 'a4t-warn-card', 'a4t-strip', 'a4t-link');
    const x = EXTRA_WIDGETS.find((w) => w.id === id);
    // An add-on's draw gets a fresh body each time: an earlier slow draw that finishes or fails late
    // lands in the old, detached one, never over the newer drawing (review p2-s7b).
    if (x) { const fresh = createDiv({ cls: 'a4t-wbody' }); body.replaceWith(fresh); body = fresh; }
    try {
      if (id === 'weather') return this.renderWeather(body, el);
      if (id === 'morning') return this.renderTaskCard(body, el, 'Morning', 'Before one', this.data.lists.morning, 'nothing planned for the morning');
      if (id === 'afternoon') return this.renderTaskCard(body, el, 'Afternoon', 'After one', this.data.lists.afternoon, 'afternoon is open');
      if (id === 'overdue') return this.renderOverdue(body, el);
      if (id === 'plannerlink') return this.renderPlannerLink(body, el);
      if (id === 'habits') return this.renderHabits(body, el);
      if (id === 'mood') return this.renderMood(body, el);
      if (id === 'calendar') return this.renderCalendar(body, el);
      if (id === 'projects') return this.renderProjects(body, el);
      if (id === 'journal') return this.renderJournal(body, el);
      if (x) return Promise.resolve(x.render(body, el)).catch((e) => this.widgetFailed(id, body, e));
    } catch (e) {
      this.widgetFailed(id, body, e);
    }
  }

  widgetFailed(id, body, e) {
    console.error('[a4-today] widget failed', id, e);
    body.empty();
    body.createDiv({ cls: 'a4t-empty', text: 'this part could not be drawn' });
  }

  cardHead(body, kicker, title, countOrAction, warn) {
    const head = body.createDiv({ cls: 'a4t-card-head' });
    const left = head.createDiv();
    left.createDiv({ cls: `a4t-kicker${warn ? ' is-warn' : ''}`, text: kicker });
    left.createEl('h3', { text: title });
    if (typeof countOrAction === 'number') head.createSpan({ cls: 'a4t-count', text: String(countOrAction) });
    return head;
  }

  renderWeather(body, el) {
    el.addClass('a4t-strip');
    const w = this.data.weather;
    if (!w) { body.createDiv({ cls: 'a4t-muted', text: 'No weather feed yet.' }); return; }
    const main = body.createDiv({ cls: 'a4t-w-main' });
    setIcon(main.createSpan({ cls: 'a4t-ic a4t-ic-lg' }), wmoIcon(w.weathercode));
    main.createEl('b', { text: `${Math.round(Number(w.temp))}°` });
    if (w.description) main.createSpan({ text: String(w.description) });
    if (w.high != null && w.low != null) body.createDiv({ cls: 'a4t-w-item', text: `H ${Math.round(Number(w.high))}° · L ${Math.round(Number(w.low))}°` });
    if (w.rain_chance != null) {
      const r = body.createDiv({ cls: 'a4t-w-item' });
      setIcon(r.createSpan({ cls: 'a4t-ic' }), 'droplet');
      r.appendText(`${w.rain_chance}%`);
    }
    if (w.sunrise || w.sunset) {
      const s = body.createDiv({ cls: 'a4t-w-item' });
      setIcon(s.createSpan({ cls: 'a4t-ic' }), 'sun');
      s.appendText(`${w.sunrise || '?'} – ${w.sunset || '?'}`);
    }
    const tides = tidesLine(w.tides_today);
    if (tides) {
      const t = body.createDiv({ cls: 'a4t-w-item' });
      setIcon(t.createSpan({ cls: 'a4t-ic' }), 'waves');
      t.appendText(tides);
    }
    const upd = body.createDiv({ cls: 'a4t-w-upd', attr: { title: 'When your weather feed last updated. Turns amber after 2 hours.' } });
    const age = weatherAge(w.updated, new Date());
    upd.setText(age.label);
    upd.toggleClass('is-stale', age.stale);
  }

  renderCapture(body) {
    const box = body.createDiv({ cls: 'a4t-capture' });
    setIcon(box.createSpan({ cls: 'a4t-ic' }), 'pencil');
    // A wrapping text area (was a one-line input) so the box can be dragged
    // taller. Enter still saves; the saved note is still one line.
    const input = box.createEl('textarea', { cls: 'a4t-capture-text', attr: { rows: '1', placeholder: "Jot a thought for today's scratchpad", autocomplete: 'off', 'data-testid': 'a4t-capture' } });
    const send = captureSendButton(box);
    const grip = box.createDiv({ cls: 'a4t-capture-grip', attr: { title: 'Drag to make the box taller', 'aria-hidden': 'true', 'data-testid': 'a4t-capture-grip' } });
    const reset = () => { input.style.removeProperty('height'); box.removeClass('is-grown'); };
    const submit = async () => {
      const value = input.value;
      if (!cleanCapture(value) || input.disabled) return;
      input.disabled = true;
      try { await this.plugin.capture(value); input.value = ''; reset(); new Notice("Added to today's scratchpad"); }
      catch (err) { console.error('[a4-today] capture failed', err); new Notice('Could not save that note. Your text is still in the box.'); }
      finally { input.disabled = false; input.focus(); }
    };
    this.registerDomEvent(input, 'keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      submit();
    });
    // The on-screen Enter does exactly what the Enter key does.
    this.registerDomEvent(send, 'pointerdown', (e) => e.preventDefault()); // keep the caret in the box
    this.registerDomEvent(send, 'click', (e) => { e.preventDefault(); submit(); });
    this.registerDomEvent(send, 'keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); submit(); } });
    // Drag handle on the bottom edge: taller only, never wider.
    this.registerDomEvent(grip, 'pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (!box.hasClass('is-grown')) this.captureRestH = input.getBoundingClientRect().height;
      const restH = this.captureRestH || input.getBoundingClientRect().height;
      const startH = input.getBoundingClientRect().height; const startY = e.clientY;
      const win = input.win || window;
      try { grip.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
      box.addClass('is-resizing');
      const move = (ev) => {
        const h = captureDragHeight(startH, ev.clientY - startY, restH, win.innerHeight);
        if (h <= restH + 0.5) reset();
        else { input.style.height = h + 'px'; box.addClass('is-grown'); }
      };
      const end = () => {
        grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', end); grip.removeEventListener('pointercancel', end);
        box.removeClass('is-resizing'); input.focus();
      };
      grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
    });
  }

  renderTaskCard(body, el, kicker, title, list, emptyText) {
    el.addClass('a4t-card');
    this.cardHead(body, kicker, title, list.length);
    if (!list.length) { body.createDiv({ cls: 'a4t-empty', text: emptyText }); return; }
    const lane = kicker === 'Morning' ? 'am' : 'pm';
    list.forEach((t) => this.renderTask(body, t, false, lane));
  }

  renderOverdue(body, el) {
    el.addClass('a4t-card', 'a4t-warn-card');
    const done = this.overdueMoved;
    // Right after a move the cache can still hold the old dates for a moment;
    // the moved tasks never flicker back onto the card.
    const list = this.data.lists.overdue.filter((t) => !(done && done.paths.has(t.path)));
    this.cardHead(body, 'Overdue', 'Slipped through', list.length, true);
    if (!list.length) {
      if (done) this.renderOverdueUndo(body, done);
      else body.createDiv({ cls: 'a4t-empty', text: 'nothing overdue' });
      return;
    }
    const shown = this.overdueExpanded ? list : list.slice(0, OVERDUE_PREVIEW);
    shown.forEach((t) => this.renderTask(body, t, true, 'overdue'));
    const rest = list.length - shown.length;
    if (rest > 0) {
      const more = body.createEl('button', { cls: 'a4t-more' });
      setIcon(more.createSpan({ cls: 'a4t-ic' }), 'chevron-down');
      more.appendText(`Show ${rest} more`);
      more.addEventListener('click', () => { this.overdueExpanded = true; this.renderWidget('overdue', body, el); });
    }
    if (done) this.renderOverdueUndo(body, done);
    // Option A (approved 2026-10-05): a small button under the list. Moves
    // every task the card lists, the "Show more" ones included.
    const btn = body.createEl('button', { cls: 'a4t-btn a4t-small a4t-od-move', attr: { 'data-testid': 'a4t-overdue-move' } });
    setIcon(btn.createSpan({ cls: 'a4t-ic' }), 'calendar-check');
    btn.appendText(`Move all ${list.length} to today`);
    btn.addEventListener('click', () => this.moveAllOverdue(list, btn));
  }

  renderOverdueUndo(body, done) {
    const line = body.createDiv({ cls: 'a4t-od-undo' });
    setIcon(line.createSpan({ cls: 'a4t-ic' }), 'calendar-check');
    line.createSpan({ cls: 'a4t-od-undo-text', text: `${done.count} moved to today` });
    const u = line.createEl('button', { cls: 'a4t-od-undo-btn', text: 'Undo', attr: { 'data-testid': 'a4t-overdue-undo' } });
    u.addEventListener('click', async () => {
      if (this.overdueMoved !== done) return;
      this.clearOverdueMoved(false);
      u.disabled = true;
      const bad = await done.undo();
      if (bad) new Notice(`Could not put ${bad} task${bad === 1 ? '' : 's'} back.`);
      this.scheduleRefresh();
    });
  }

  clearOverdueMoved(rerender) {
    const done = this.overdueMoved;
    if (!done) return;
    if (done.timer) window.clearTimeout(done.timer);
    this.overdueMoved = null;
    if (rerender) {
      const el = this.widgetEls.get('overdue');
      if (el && el.isConnected && this.data) this.renderWidget('overdue', el.querySelector('.a4t-wbody'), el);
    }
  }

  async moveAllOverdue(list, btn) {
    if (btn.disabled) return;
    if (dayOf(new Date()) !== this.renderedDay) { new Notice('A new day started; the page has been refreshed.'); this.refresh(); return; }
    btn.disabled = true;
    const lists = this.data.lists;
    const plan = planOverdueMove({ morning: lists.morning, afternoon: lists.afternoon, overdue: list });
    let res;
    try { res = await this.plugin.moveOverdueToToday(plan, this.data.today); }
    catch (e) { console.error('[a4-today] move all failed', e); new Notice('Could not move the overdue tasks.'); btn.disabled = false; return; }
    if (res.failed.length) new Notice(`Could not move ${res.failed.length} task${res.failed.length === 1 ? '' : 's'}.`);
    this.clearOverdueMoved(false);
    if (res.moved.length) {
      const done = { count: res.moved.length, paths: new Set(res.moved), undo: res.undo, timer: null };
      done.timer = window.setTimeout(() => { if (this.overdueMoved === done) this.clearOverdueMoved(true); }, OVERDUE_UNDO_MS);
      this.overdueMoved = done;
    }
    const el = this.widgetEls.get('overdue');
    if (el && el.isConnected) this.renderWidget('overdue', el.querySelector('.a4t-wbody'), el);
    this.scheduleRefresh();
  }

  renderTask(parent, t, overdue, lane) {
    const today = this.data.today;
    const done = this.doneOf(t);
    // Dependencies (Projects mockup round 4): open blockers dim the row and add a lock chip.
    const blockers = done ? [] : openBlockersOf(this.app, t, this.data.completed);
    const row = parent.createDiv({ cls: `a4t-task${done ? ' is-done' : ''}${blockers.length ? ' is-blocked' : ''}`, attr: { 'data-path': t.path } });
    const tick = row.createEl('button', { cls: 'a4t-tick', attr: { 'aria-label': done ? 'Mark not done' : 'Mark done' } });
    setIcon(tick, 'check');
    const main = row.createDiv({ cls: 'a4t-task-main' });
    const tl = main.createDiv({ cls: 'a4t-task-title' });
    // A clock time (due time, or a repeating task's start time) goes first, in the accent colour.
    if (t.time) tl.createSpan({ cls: 'a4t-time', text: timeText(t.time) });
    // A small bell: it will ring (reminder setup mockup); "15m" when earlier than the time.
    if (t.time && t.reminder != null && !done) {
      const bell = tl.createSpan({ cls: 'a4t-bell', attr: { 'aria-label': `Reminder: ${reminderWords(t.reminder).toLowerCase()}`, title: `Reminder: ${reminderWords(t.reminder).toLowerCase()}` } });
      setIcon(bell.createSpan({ cls: 'a4t-ic' }), 'bell');
      if (reminderShort(t.reminder)) bell.createSpan({ cls: 'a4t-bell-k', text: reminderShort(t.reminder) });
    }
    tl.appendText(t.title);
    const meta = main.createDiv({ cls: 'a4t-task-meta' });
    const chip = (text, cls, icon) => {
      const c = meta.createSpan({ cls: `a4t-chip${cls ? ' ' + cls : ''}` });
      if (icon) setIcon(c.createSpan({ cls: 'a4t-ic' }), icon);
      c.appendText(text);
      return c;
    };
    if (t.recurrenceRaw) chip('repeats', '', 'clock');
    if (t.project) {
      // The project label opens the project's page, like the Active projects card.
      const pc = chip(t.project, 'is-proj');
      pc.addEventListener('click', (e) => {
        e.stopPropagation();
        if (row._justDragged) return;
        openProjectPage(this.app, t.projectLink || t.project, e, t.path);
      });
    }
    if (overdue) chip(`due ${shortDue(t.due)}`, 'is-warn');
    else if (!t.recurrenceRaw && t.due === today) chip('due today');
    if (blockers.length) blockedChip(meta, blockers, (p) => this.plugin.openPath(p, true), 'a4t');
    if (t.status === 'in-progress') chip('in progress', 'is-prog');
    else if (t.status === 'blocked' && !blockers.length) chip('blocked', 'is-warn');
    if (/^(high|urgent)$/i.test(t.priority)) chip(t.priority.toLowerCase());
    if (!meta.childElementCount) meta.remove();

    tick.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (row.hasClass('is-busy')) return;
      if (dayOf(new Date()) !== this.renderedDay) { new Notice('A new day started; the page has been refreshed.'); this.refresh(); return; }
      const want = !row.hasClass('is-done');
      row.addClass('is-busy');
      row.toggleClass('is-done', want);
      tick.setAttr('aria-label', want ? 'Mark not done' : 'Mark done');
      this.plateEl.setText(plateText(this.openCount() + (overdue ? 0 : (want ? -1 : 1)), this.data.lists.total));
      try {
        const now = await this.plugin.toggleTask(t, today);
        this.pending.set(t.path, { done: now, day: today, until: Date.now() + 4000 });
        t.optimistic = now;
      } catch (err) {
        console.error('[a4-today] tick failed', err);
        new Notice(`Could not update "${t.title}". ${err && err.message ? err.message : ''}`.trim());
        row.toggleClass('is-done', !want);
      } finally {
        row.removeClass('is-busy');
        this.scheduleRefresh();
      }
    });
    const more = row.createEl('button', { cls: 'a4t-t-more', attr: { 'aria-label': 'Move to' } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.openMoveMenu(t, more, lane); });
    this.registerDomEvent(main, 'pointerdown', (e) => this.startTaskDrag(e, t, row, lane));
    main.addEventListener('click', () => { if (row._justDragged) return; this.plugin.openPath(t.path, true); });
  }

  /* ---- moving tasks (mockup round 3). Writes exactly what the Daily
   * Planner's assignItem writes (applyMove), with its orderForInsert. ---- */

  laneList(half, day) {
    const d = day || this.data.today;
    const lists = d === this.data.today ? this.data.lists : buildTaskLists(this.data.items, d, this.data.completed);
    return half === 'pm' ? lists.afternoon : lists.morning;
  }

  async moveTask(t, half, day, index) {
    if (dayOf(new Date()) !== this.renderedDay) { new Notice('A new day started; the page has been refreshed.'); this.refresh(); return; }
    const target = day || this.data.today;
    // Timed tasks sit first in clock order: the drop counts only the untimed ones.
    const slot = untimedSlot(this.laneList(half, target).filter((x) => x.path !== t.path), index);
    const others = slot.list;
    const plan = planInsert(others.map((x) => x.plannedOrder), slot.idx);
    const order = plan.order;
    const file = this.app.vault.getAbstractFileByPath(t.path);
    if (!(file instanceof TFile)) return;
    // Into the other half of the day, the clock time comes off (applyMove); Undo puts it back.
    const dropsTime = !!(t.time && !t.recurrenceRaw && halfOfTime(t.time) !== half);
    try {
      const undo = await writeWithUndo(this.app, file, (fm) => { applyMove(fm, target, half, order); });
      // Renumbered lane: write planned_order only, and only where it changed.
      if (plan.others) {
        for (let k = 0; k < others.length; k++) {
          if (others[k].plannedOrder === plan.others[k]) continue;
          const f = this.app.vault.getAbstractFileByPath(others[k].path);
          if (f instanceof TFile) await this.app.fileManager.processFrontMatter(f, (raw) => writable(raw, (fm) => { fm.planned_order = plan.others[k]; }));
        }
      }
      const where = target !== this.data.today ? 'Moved to tomorrow' : `Moved to ${half === 'pm' ? 'Afternoon' : 'Morning'}`;
      if (dropsTime) undoNotice(`${where}. The ${timeText(t.time)} time was taken off.`, async () => { await undo(); this.scheduleRefresh(); });
      else new Notice(where);
    } catch (err) {
      console.error('[a4-today] move failed', err);
      new Notice(`Could not move "${t.title}".`);
    }
    this.scheduleRefresh();
  }

  closeMoveMenu() {
    // Always drop the outside-click listener with the menu: a stale one from an
    // earlier menu closed the next menu on pointerdown, so its click was lost.
    if (this._moveAway) { document.removeEventListener('pointerdown', this._moveAway, true); this._moveAway = null; }
    if (this._moveScroll) { this.scroller.removeEventListener('scroll', this._moveScroll); this._moveScroll = null; }
    if (this.moveMenu) { this.moveMenu.remove(); this.moveMenu = null; }
    this.contentEl.querySelectorAll('.a4t-t-more.is-open').forEach((b) => b.removeClass('is-open'));
  }

  openMoveMenu(t, btn, lane) {
    const wasOpen = btn.hasClass('is-open');
    this.closeMoveMenu();
    if (wasOpen || this.editing) return;
    btn.addClass('is-open');
    const repeats = !!t.recurrenceRaw;
    const menu = this.contentEl.createDiv({ cls: 'a4t-movemenu' });
    this.moveMenu = menu;
    menu.createDiv({ cls: 'a4t-mm-k', text: 'Move to' });
    const opt = (label, key, disabled, run) => {
      const b = menu.createEl('button', { attr: { 'data-mv': key } });
      b.appendText(label);
      if (lane === key) b.createSpan({ cls: 'a4t-mm-here', text: 'here now' });
      if (disabled) b.disabled = true;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.closeMoveMenu(); run(); });
    };
    opt('Morning', 'am', lane === 'am', () => this.moveTask(t, 'am'));
    opt('Afternoon', 'pm', lane === 'pm', () => this.moveTask(t, 'pm'));
    opt('Tomorrow', 'tomorrow', repeats, () => this.moveTask(t, t.plannedHalf === 'pm' ? 'pm' : 'am', addDays(this.data.today, 1)));
    if (repeats) menu.createDiv({ cls: 'a4t-mm-note', text: 'Repeats on its own schedule' });
    const rr = this.contentEl.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const left = Math.max(8, Math.min(br.right - rr.left - 200, rr.width - 208));
    let top = br.bottom - rr.top + 4;
    if (top + 190 > rr.height) top = Math.max(8, br.top - rr.top - 190);
    menu.style.setProperty('--a4t-mx', `${left}px`);
    menu.style.setProperty('--a4t-my', `${top}px`);
    this._moveAway = (e) => { if (!menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) this.closeMoveMenu(); };
    document.addEventListener('pointerdown', this._moveAway, true);
    this._moveScroll = () => this.closeMoveMenu();
    this.scroller.addEventListener('scroll', this._moveScroll);
  }

  // Task drag: starts after a 6 px move so a plain click still opens the
  // task; never while Edit layout is on (that drag moves whole widgets).
  startTaskDrag(e, t, row, lane) {
    if (this.editing || this.drag || this.tdrag || (e.button != null && e.button !== 0)) return;
    const sx = e.clientX; const sy = e.clientY;
    const lanesNow = () => ['am', 'pm'].map((h) => ({ h, el: this.widgetEls.get(h === 'am' ? 'morning' : 'afternoon') }))
      .filter((x) => x.el && x.el.isConnected).map((x) => ({ h: x.h, body: x.el.querySelector('.a4t-wbody'), card: x.el }));
    const move = (ev) => {
      if (!this.tdrag) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        if (!lanesNow().length) return;
        this.closeMoveMenu();
        const r = row.getBoundingClientRect();
        const ph = createDiv({ cls: 'a4t-t-ph' });
        row.after(ph);
        this.tdrag = { t, row, ph, dx: sx - r.left, dy: sy - r.top, half: null, index: 0 };
        row.style.setProperty('--a4t-w', `${r.width}px`);
        row.addClass('is-tdragging');
      }
      const d = this.tdrag;
      // An absolute row is placed from its offsetParent's padding box, and
      // that is the card (.a4t-w is position: relative), not the page.
      // Measuring from the page put the ghost one card-offset too low (1.2.1).
      const op = row.offsetParent || this.page;
      const pr = op.getBoundingClientRect();
      row.style.setProperty('--a4t-x', `${ev.clientX - d.dx - pr.left - op.clientLeft + op.scrollLeft}px`);
      row.style.setProperty('--a4t-y', `${ev.clientY - d.dy - pr.top - op.clientTop + op.scrollTop}px`);
      const sr = this.scroller.getBoundingClientRect();
      if (ev.clientY < sr.top + 40) this.scroller.scrollTop -= 14;
      else if (ev.clientY > sr.bottom - 40) this.scroller.scrollTop += 14;
      let best = null; let bd = Infinity;
      for (const l of lanesNow()) {
        const r = l.card.getBoundingClientRect();
        const dx = ev.clientX < r.left ? r.left - ev.clientX : (ev.clientX > r.right ? ev.clientX - r.right : 0);
        const dy = ev.clientY < r.top ? r.top - ev.clientY : (ev.clientY > r.bottom ? ev.clientY - r.bottom : 0);
        if (dx * 4 + dy < bd) { bd = dx * 4 + dy; best = l; }
      }
      for (const l of lanesNow()) l.card.toggleClass('is-ttarget', l === best);
      const rows = Array.from(best.body.querySelectorAll(':scope > .a4t-task')).filter((x) => x !== row);
      const before = rows.find((x) => { const b = x.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
      if (before) before.before(d.ph); else best.body.appendChild(d.ph);
      d.half = best.h;
      d.index = before ? rows.indexOf(before) : rows.length;
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const d = this.tdrag;
      if (!d) return;
      this.tdrag = null;
      row.removeClass('is-tdragging');
      ['--a4t-x', '--a4t-y', '--a4t-w'].forEach((v) => row.style.removeProperty(v));
      for (const l of lanesNow()) l.card.removeClass('is-ttarget');
      d.ph.replaceWith(row);
      row._justDragged = true;
      window.setTimeout(() => { row._justDragged = false; }, 60);
      if (ev.type === 'pointercancel' || !d.half) { this.scheduleRefresh(); return; }
      this.moveTask(t, d.half, null, d.index);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  renderPlannerLink(body, el) {
    // The Planner switched off: no shortcut to it (phase 2 section 6).
    el.toggleClass('a4t-off', !this.plugin.plannerOn());
    el.addClass('a4t-link');
    body.createSpan({ text: 'Want to move things around?' });
    const b = body.createEl('button', { cls: 'a4t-btn a4t-small' });
    setIcon(b.createSpan({ cls: 'a4t-ic' }), 'calendar-range');
    b.appendText('Arrange in Planner');
    b.addEventListener('click', () => this.plugin.openPlanner());
  }

  renderHabits(body, el) {
    el.addClass('a4t-card');
    this.cardHead(body, 'Habits', 'Daily practice');
    const list = this.data.habits;
    if (!list.length) { body.createDiv({ cls: 'a4t-empty', text: 'no active daily habits' }); return; }
    const wrap = body.createDiv({ cls: 'a4t-habits' });
    list.forEach((h) => {
      const b = wrap.createEl('button', { cls: `a4t-habit${h.doneToday ? ' is-on' : ''}${h.derived ? ' is-derived' : ''}` });
      if (h.derived) b.setAttr('title', 'Counted from your journal entries');
      setIcon(b.createSpan({ cls: 'a4t-hc' }), 'check');
      b.appendText(h.name);
      const s = b.createSpan({ cls: 'a4t-streak' });
      setIcon(s.createSpan({ cls: 'a4t-ic' }), 'flame');
      const n = s.createEl('b', { text: String(h.streak) });
      b.addEventListener('click', async () => {
        if (h.derived) {
          new Notice(h.doneToday ? "Counted from today's journal entry." : "Write today's journal entry to count this one.");
          return;
        }
        if (b.disabled) return;
        const f = this.app.vault.getAbstractFileByPath(h.path);
        if (!(f instanceof TFile)) return;
        const today = dayOf(new Date());
        if (today !== this.renderedDay) { this.refresh(); return; }
        b.disabled = true;
        try {
          const on = await this.plugin.toggleHabit(f, today);
          b.toggleClass('is-on', on);
          n.setText(String(Math.max(0, h.streak + (on === h.doneToday ? 0 : (on ? 1 : -1)))));
        } catch (err) { console.error('[a4-today] habit failed', err); new Notice(`Could not update ${h.name}.`); }
        finally { b.disabled = false; this.scheduleRefresh(); }
      });
    });
  }

  renderMood(body, el) {
    el.addClass('a4t-card');
    const m = this.data.mood;
    const head = this.cardHead(body, 'Mood', m ? `Last check-in · ${m.score}` : 'How are you?');
    if (this.app.commands && this.app.commands.commands && this.app.commands.commands[MOOD_COMMAND]) {
      const b = head.createEl('button', { cls: 'a4t-btn a4t-small', text: 'Check in' });
      b.addEventListener('click', () => this.plugin.openMoodCheckin());
    }
    if (!m) { body.createDiv({ cls: 'a4t-empty', text: 'no check-ins yet' }); return; }
    const row = body.createDiv({ cls: 'a4t-mood' });
    const ring = row.createDiv({ cls: 'a4t-mood-score', text: String(m.score) });
    ring.style.setProperty('--a4t-s', String(Math.max(0, Math.min(100, m.score))));
    ring.addEventListener('click', () => this.plugin.openPath(m.path, true));
    const right = row.createDiv();
    right.createDiv({ cls: 'a4t-muted a4t-small-text', text: moodWhen(m.date, m.time, this.data.today) });
    if (m.felt.length) {
      const feel = right.createDiv({ cls: 'a4t-feel' });
      m.felt.slice(0, 6).forEach((f) => feel.createSpan({ cls: 'a4t-chip', text: f }));
    }
  }

  renderCalendar(body, el) {
    el.addClass('a4t-card');
    this.cardHead(body, 'Calendar', 'Today & next 7 days');
    const list = this.data.events;
    if (!list.length) { body.createDiv({ cls: 'a4t-empty', text: 'no events this week' }); return; }
    list.forEach((e) => {
      const row = body.createDiv({ cls: `a4t-event${e.date === this.data.today ? ' is-today' : ''}` });
      const when = row.createDiv({ cls: 'a4t-ev-when' });
      when.appendText(eventDayLabel(e.date, this.data.today));
      when.createSpan({ text: e.allDay ? 'all day' : fmt12(e.time) });
      const what = row.createDiv({ text: e.summary });
      if (e.calendar) what.createSpan({ cls: 'a4t-muted a4t-small-text', text: ` · ${e.calendar}` });
    });
  }

  renderProjects(body, el) {
    el.addClass('a4t-card');
    const list = this.data.projects;
    this.cardHead(body, 'Active projects', list.length ? `${list.length} in motion` : 'Nothing active');
    if (!list.length) { body.createDiv({ cls: 'a4t-empty', text: 'no active projects' }); return; }
    const wrap = body.createDiv({ cls: 'a4t-projs' });
    list.forEach((p) => {
      const b = wrap.createEl('button', { cls: 'a4t-proj' });
      setIcon(b.createSpan({ cls: 'a4t-ic' }), 'square-kanban');
      b.appendText(p.name);
      b.addEventListener('click', (e) => openProjectPage(this.app, p.path, e, p.path));
    });
  }

  renderJournal(body, el) {
    el.addClass('a4t-card');
    const j = this.data.journal;
    this.cardHead(body, 'Latest journal', j ? longDate(j.date) : 'No entries yet');
    if (!j) { body.createDiv({ cls: 'a4t-empty', text: 'no journal entries yet' }); return; }
    body.createEl('p', { cls: 'a4t-journal', text: j.text ? `${j.text}${j.cut ? '…' : ''}` : '(empty entry)' });
    const b = body.createEl('button', { cls: 'a4t-btn a4t-small a4t-ghost' });
    b.appendText('Read entry ');
    setIcon(b.createSpan({ cls: 'a4t-ic' }), 'arrow-up-right');
    b.addEventListener('click', () => this.plugin.openPath(j.path, true));
  }

  /* ---- add-widget panel ------------------------------------------------- */

  renderPanel() {
    const p = this.panel;
    p.empty();
    const head = p.createDiv({ cls: 'a4t-ap-head' });
    const left = head.createDiv();
    left.createDiv({ cls: 'a4t-kicker', text: 'Edit layout' });
    left.createEl('h3', { text: 'Add widget' });
    const close = head.createEl('button', { cls: 'a4t-btn a4t-small a4t-ghost', text: '×', attr: { 'aria-label': 'Close' } });
    close.addEventListener('click', () => this.openPanel(false));
    const list = p.createDiv({ cls: 'a4t-ap-list' });
    const layout = this.plugin.layout;
    [...allWidgets(), ...LATER_WIDGETS.map((w) => ({ ...w, later: true }))].forEach((m) => {
      const row = list.createDiv({ cls: `a4t-ap-item${m.later ? ' is-later' : ''}` });
      const txt = row.createDiv({ cls: 'a4t-ap-txt' });
      txt.createDiv({ cls: 'a4t-ap-name', text: m.name });
      txt.createDiv({ cls: 'a4t-ap-desc', text: m.desc });
      if (m.later) row.createSpan({ cls: 'a4t-tag-later', text: 'later' });
      else if (zoneOf(layout, m.id)) row.createSpan({ cls: 'a4t-tag-on', text: 'on page' });
      else {
        const b = row.createEl('button', { cls: 'a4t-btn a4t-small', attr: { 'data-add': m.id } });
        setIcon(b.createSpan({ cls: 'a4t-ic' }), 'plus');
        b.appendText('Add');
        b.addEventListener('click', () => {
          const heights = {};
          for (const z of ['c1', 'c2', 'c3']) heights[z] = this.zoneEls[z].offsetHeight;
          this.applyLayout(addWidget(this.plugin.layout, m.id, heights), `${m.name} added`);
        });
      }
    });
    p.createEl('p', { cls: 'a4t-muted a4t-small-text a4t-ap-foot', text: 'Widgets marked "later" are ideas for after the first build. Removing a widget only hides it; nothing in your notes changes.' });
  }

  /* ---- drag (Pointer Events: one path for mouse, pen and touch) ---------- */

  startDrag(e, id) {
    if (!this.editing || this.drag || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    const el = this.widgetEls.get(id);
    const r = el.getBoundingClientRect();
    const ph = createDiv({ cls: 'a4t-ph' });
    ph.style.setProperty('--a4t-h', `${r.height}px`);
    el.after(ph);
    this.drag = { id, el, ph, dx: e.clientX - r.left, dy: e.clientY - r.top, pointerId: e.pointerId };
    el.style.setProperty('--a4t-w', `${r.width}px`);
    el.addClass('is-dragging');
    this.moveGhost(e);
    this._onMove = (ev) => this.onDragMove(ev);
    this._onUp = () => this.endDrag(false);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  moveGhost(e) {
    const pr = this.page.getBoundingClientRect();
    this.drag.el.style.setProperty('--a4t-x', `${e.clientX - this.drag.dx - pr.left}px`);
    this.drag.el.style.setProperty('--a4t-y', `${e.clientY - this.drag.dy - pr.top}px`);
  }

  onDragMove(e) {
    if (!this.drag) return;
    this.moveGhost(e);
    // Auto-scroll near the edges of the scrolling area.
    const sr = this.scroller.getBoundingClientRect();
    if (e.clientY < sr.top + 40) this.scroller.scrollTop -= 14;
    else if (e.clientY > sr.bottom - 40) this.scroller.scrollTop += 14;
    let zone = null; let best = Infinity;
    for (const z of ZONES) {
      const r = this.zoneEls[z].getBoundingClientRect();
      const dx = e.clientX < r.left ? r.left - e.clientX : (e.clientX > r.right ? e.clientX - r.right : 0);
      const dy = e.clientY < r.top ? r.top - e.clientY : (e.clientY > r.bottom ? e.clientY - r.bottom : 0);
      const d = dx * 4 + dy;
      if (d < best) { best = d; zone = z; }
    }
    for (const z of ZONES) this.zoneEls[z].toggleClass('is-drop-here', z === zone);
    const zoneEl = this.zoneEls[zone];
    const sibs = Array.from(zoneEl.children).filter((c) => c.hasClass('a4t-w') && !c.hasClass('is-dragging'));
    const before = sibs.find((s) => { const r = s.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (before) before.before(this.drag.ph); else zoneEl.insertBefore(this.drag.ph, this.clockEl.parentElement === zoneEl ? this.clockEl : null);
  }

  endDrag(cancel) {
    if (!this.drag) return;
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);
    const { id, el, ph } = this.drag;
    const zoneEl = ph.parentElement;
    const zone = zoneEl && zoneEl.getAttr ? zoneEl.getAttr('data-zone') : null;
    const index = zoneEl ? Array.from(zoneEl.children).filter((c) => c === ph || (c.hasClass('a4t-w') && !c.hasClass('is-dragging'))).indexOf(ph) : -1;
    el.removeClass('is-dragging');
    ['--a4t-x', '--a4t-y', '--a4t-w'].forEach((v) => el.style.removeProperty(v));
    ph.remove();
    for (const z of ZONES) this.zoneEls[z].removeClass('is-drop-here');
    this.drag = null;
    if (!cancel && zone && index >= 0) this.applyLayout(placeWidget(this.plugin.layout, id, zone, index));
    else this.renderWidgets();
  }
}

A4TodayPlugin.logic = logic;
A4TodayPlugin.addExtraWidget = addExtraWidget; // for LifeWorld's add-on hooks (phase 2 section 7)
A4TodayPlugin.TodayView = TodayView; // for tests (the Planner button)
A4TodayPlugin.TodaySettingTab = TodaySettingTab; // for tests (the Calendars picker)
export default A4TodayPlugin;

/* ==== bundled fonts (generated by build-main.js; SIL Open Font License 1.1, see fonts/) ==== */
/* Caveat: Copyright 2014 The Caveat Project Authors. Patrick Hand: Copyright (c) 2010-2012 Patrick Wagesreiter.
   Kalam: Copyright (c) 2014, Indian Type Foundry. Gochi Hand: Copyright (c) 2011, Juan Pablo del Peral.
   Latin subsets as served by Google Fonts (woff2); licence texts in src/today/fonts/, shipped at the end of main.js. */
var A4T_FONT_DATA = {
  caveat: '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',
  patrickhand: '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',
  kalam: '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',
  gochihand: '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',
};
