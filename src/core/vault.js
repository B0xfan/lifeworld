// "Your vault" (Settings, phase 2 section 4): the folders and task property names every part of
// LifeWorld reads. One live object per build; LifeWorld fills it from its settings at start and on
// every change (src/main.js), the parts read it each time they need a folder or a name.
'use strict';

// A new install's folders, as drawn (lifeworld-your-vault-mockup.html, approved 2026-10-14).
const FOLDER_DEFAULTS = { tasks: 'Tasks', archive: 'Tasks/Archive', projects: 'Projects', goals: 'Goals', habits: 'Habits', journal: 'Journal' };
// Task note properties, LifeWorld's own name for each; a new install uses the same names in the notes.
const PROPS = ['title', 'status', 'priority', 'due', 'scheduled', 'projects', 'reminders', 'recurrence', 'completedDate', 'planned_day', 'planned_half', 'planned_order',
  'dateCreated', 'dateModified', 'complete_instances', 'skipped_instances', 'blockedBy'];
// Obsidian's own Daily notes defaults, used when its Daily notes plugin is off.
const DAILY_DEFAULTS = { folder: '', format: 'YYYY-MM-DD', template: '' };
// The parts built alone for the test suites start on the frozen test vault's settings
// (esbuild.config.mjs); the one plugin starts on the defaults above.
const START = typeof LW_START_VAULT !== 'undefined' && LW_START_VAULT ? LW_START_VAULT : {};

const folders = {};
const names = {};
const daily = { ...DAILY_DEFAULTS, ...(START.daily || {}) }; // fallback when Obsidian's setting cannot be read
let renamed = false; // any property name differs from LifeWorld's own

// A character a property name cannot hold (the approved mockup's rule).
const BAD_NAME = /[:#[\]{}|,]/;
// Names a task property cannot be renamed to, because something already reads them by that name:
// Obsidian's own (tags, aliases, cssclasses and their old one-word forms; Obsidian 1.14.4 matches
// them in any case) and the task note properties LifeWorld reads under a fixed name (the engine's
// fields outside PROPS, Projects' DEFAULT_FIELDS; the Planner's weekly_goal). Compared in any case.
const RESERVED = ['tags', 'aliases', 'cssclasses', 'tag', 'alias', 'cssclass',
  'archived', 'contexts', 'timeEstimate', 'recurrence_anchor', 'googleCalendarExceptionOriginalScheduled', 'googleCalendarMovedOriginalDates', 'weekly_goal'];
const isReserved = (v) => RESERVED.some((r) => r.toLowerCase() === String(v).trim().toLowerCase());

// A folder as typed -> 'a/b': no leading, trailing or doubled slash, no '.' or '..' step.
const cleanFolder = (v) => (typeof v === 'string' ? v.trim().split('/').filter((x) => x && x !== '.' && x !== '..').join('/') : '');

// -> '' when the names can be used, else what is wrong (the Property names dialog shows it).
// Each entry: [row label, name]. Same checks as the approved mockup: empty, two rows the same, a
// character a property name cannot hold.
function namesProblem(list) {
  const seen = new Set();
  for (const [, raw] of list) {
    const v = String(raw == null ? '' : raw).trim();
    if (!v) return 'A property name cannot be empty.';
    if (seen.has(v)) return `Two rows use "${v}". Each needs its own name.`;
    if (BAD_NAME.test(v)) return `"${v}" has a character property names cannot use.`;
    if (isReserved(v)) return `"${v}" is already used by Obsidian or LifeWorld. Pick another name.`;
    seen.add(v);
  }
  return '';
}

// Takes LifeWorld's saved "vault" settings ({ folders, names }); anything missing, empty or
// unusable falls back to the default, so a damaged or hand-edited file never points nowhere.
function setVault(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const f = s.folders && typeof s.folders === 'object' ? s.folders : {};
  const start = START.folders || {};
  for (const k of Object.keys(FOLDER_DEFAULTS)) folders[k] = cleanFolder(f[k]) || cleanFolder(start[k]) || FOLDER_DEFAULTS[k];
  const n = s.names && typeof s.names === 'object' ? s.names : {};
  const want = PROPS.map((k) => [k, typeof n[k] === 'string' && n[k].trim() ? n[k].trim() : k]);
  const ok = !namesProblem(want);
  for (const [k, v] of want) names[k] = ok ? v : k;
  renamed = PROPS.some((k) => names[k] !== k);
}
setVault(null);

// Obsidian's own Daily notes settings: { folder, format, template } (template without '.md', as
// Obsidian stores it). shortcut: reads the core plugin's live options, an undocumented internal
// (app.internalPlugins, checked in Obsidian 1.14.4's app code); upgrade if Obsidian documents one.
function dailyNotes(app) {
  const ip = app && app.internalPlugins;
  const dn = ip && typeof ip.getEnabledPluginById === 'function' ? ip.getEnabledPluginById('daily-notes') : null;
  const o = dn && dn.options;
  if (!o) return { ...daily };
  return { folder: cleanFolder(o.folder), format: (typeof o.format === 'string' && o.format.trim()) || DAILY_DEFAULTS.format, template: cleanFolder(o.template) };
}

// A path inside the tasks or the finished tasks folder (where task notes live).
function inTaskFolders(path) {
  const p = String(path || '');
  return p.startsWith(`${folders.tasks}/`) || p.startsWith(`${folders.archive}/`);
}

// A task note's frontmatter under LifeWorld's own property names. With no name changed (every
// setup so far) this is the very same object, so nothing reads differently.
function readable(fm) {
  if (!renamed || !fm || typeof fm !== 'object') return fm;
  const inNote = new Set(Object.values(names));
  const out = {};
  for (const k of Object.keys(fm)) if (!inNote.has(k) && !PROPS.includes(k)) out[k] = fm[k];
  for (const k of PROPS) if (Object.prototype.hasOwnProperty.call(fm, names[k])) out[k] = fm[names[k]];
  return out;
}

// Runs fn on a task note's frontmatter under LifeWorld's names (inside processFrontMatter) and puts
// the result back under the note's names. Untouched keys keep their place; a property the note
// has under LifeWorld's own name while renamed is left alone.
function writable(fm, fn) {
  if (!renamed) return fn(fm);
  const view = readable(fm);
  const r = fn(view);
  for (const k of PROPS) { if (Object.prototype.hasOwnProperty.call(view, k)) fm[names[k]] = view[k]; else delete fm[names[k]]; }
  const inNote = new Set(Object.values(names));
  for (const k of Object.keys(view)) if (!PROPS.includes(k)) fm[k] = view[k];
  for (const k of Object.keys(fm)) if (!inNote.has(k) && !PROPS.includes(k) && !Object.prototype.hasOwnProperty.call(view, k)) delete fm[k];
  return r;
}

// A new note's frontmatter, written with LifeWorld's names, under the note's names (same order).
function toNote(fm) {
  if (!renamed) return fm;
  const out = {};
  for (const k of Object.keys(fm)) out[PROPS.includes(k) ? names[k] : k] = fm[k];
  return out;
}

const isRenamed = () => renamed;

module.exports = { BAD_NAME, RESERVED, isReserved, FOLDER_DEFAULTS, PROPS, DAILY_DEFAULTS, vaultFolders: folders, propNames: names, setVault, namesProblem, dailyNotes, inTaskFolders, readable, writable, toNote, isRenamed };
