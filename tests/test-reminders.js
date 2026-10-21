#!/usr/bin/env node
/* Task reminders (reminder setup mockup, approved 2026-10-05) across
 * Projects, Today and Planner. No Obsidian: an in-memory vault.
 * `node tests/test-reminders.js` (re-runs itself in several time zones).
 *
 *  1. The reminder helpers are one copy, in src/core/reminders.js (section 6).
 *  2. The field: TaskNotes' own `reminders` format, offsets both ways
 *     (PT0M, -PT15M, -PT1H, -P1D, Other), which entry LifeWorld reads, the words
 *     and the small "15m" mark, typed "Other" amounts.
 *  3. When it rings: the ring time (also across midnight), the picker's
 *     orange line, the reminder a save leaves.
 *  4. Engine writes: "At the time" for a new timed task and a first time;
 *     none for an untimed task; a kept offset when the time changes; None
 *     removes the key; other entries are kept; repeat on/off retargets;
 *     Undo puts it back; key order on create (TaskNotes: right before tags).
 *  5. Readers: Today and Planner see the same reminder (bell) as Projects;
 *     a task with no time never rings; a done task shows no bell (source).
 *  6. No plugin fires its own notification (no double ring on the Mac).
 * Built files for behaviour, src/ for text (tests/lib/paths.js); the TaskNotes settings
 * check reads tests/fixtures/vault, or the owner's vault with LIFEWORLD_VAULT. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const { part, STYLES, source } = require('./lib/paths');
const VAULT = require('./lib/paths').vault; // the owner's vault with LIFEWORLD_VAULT, else the frozen copy
const ZONES = ['America/Regina', 'UTC', 'Pacific/Kiritimati', 'Australia/Lord_Howe', 'America/New_York'];

if (!process.env.LWRM_CHILD) {
  let fails = 0; let total = 0;
  for (const tz of ZONES) {
    try {
      const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, LWRM_CHILD: '1' }, encoding: 'utf8', timeout: 120000 });
      const m = /RESULT (\d+) (\d+)/.exec(out);
      total += Number(m[1]); fails += Number(m[2]);
      console.log(`${tz.padEnd(22)} ${m[1]} checks, ${m[2]} failed`);
      if (Number(m[2])) console.log(out.split('\n').filter((l) => /^FAIL|CRASH/.test(l)).slice(0, 60).join('\n'));
    } catch (e) { fails++; console.log(`${tz.padEnd(22)} FAILED\n${((e.stdout || '') + (e.stderr || '')).slice(0, 4000)}`); }
  }
  console.log(`\nTOTAL ${total} checks, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

class TFile { constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.md$/, ''); this.extension = 'md'; const i = p.lastIndexOf('/'); this.parent = { path: p.slice(0, i) }; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
class Notice { constructor() {} hide() {} }
let lastYaml = null;
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice, setIcon() {}, Platform: {}, Component: class {}, Menu: class {},
  stringifyYaml: (o) => { lastYaml = JSON.parse(JSON.stringify(o)); return `${JSON.stringify(o)}\n`; } };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const PJ = part('a4-projects');
const L = PJ.logic; const T = part('a4-today').logic; const PL = part('a4-planner').logic;
const TaskEngine = PJ.TaskEngine;

let n = 0; let failed = 0;
const tz = process.env.TZ;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL [${tz}] ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }
const clone = (x) => JSON.parse(JSON.stringify(x));
const srcs = ['a4-projects', 'a4-today', 'a4-planner'].map((p) => fs.readFileSync(source(p), 'utf8'));

const TASKS = '02 Planner/TaskNotes/Tasks';
function makeVault(notes) {
  const files = new Map(); const fms = new Map();
  const folders = { [TASKS]: new TFolder(TASKS) };
  const add = (p, fm) => { const f = new TFile(p); files.set(p, f); fms.set(p, fm); folders[TASKS].children.push(f); return f; };
  for (const [p, fm] of Object.entries(notes)) add(p, fm);
  const app = {
    plugins: { plugins: {} },
    vault: {
      getAbstractFileByPath: (p) => folders[p] || files.get(p) || null,
      adapter: { exists: async (p) => files.has(p) },
      createFolder: async () => {},
      create: async (p, content) => { add(p, lastYaml); return files.get(p); },
    },
    metadataCache: { getFileCache: (f) => (fms.has(f.path) ? { frontmatter: fms.get(f.path), listItems: [] } : null), getFirstLinkpathDest: () => null },
    fileManager: { processFrontMatter: async (f, fn) => { fn(fms.get(f.path)); } },
  };
  return { app, fms };
}
const tk = (extra) => ({ status: 'open', priority: 'normal', tags: ['task'], dateModified: '2026-10-01T09:00:00.000-06:00', ...extra });
const TP = (name) => `${TASKS}/${name}.md`;
const NOW = new Date(2026, 9, 5, 10, 30, 0);
function engineFor(v) { const e = new TaskEngine({ app: v.app, settings: { tnSnapshot: null, archiveQueue: [] }, archiveQueueOnStatus: async () => false, cancelArchive: async () => {} }); e.now = () => NOW; return e; }
const remOf = (fm) => fm.reminders;

(async () => {
/* ---- 1. one copy, in the shared core -------------------------------------------- */
// Updated in section 6: the reminder helpers moved from Projects, Today and Planner (verbatim
// copies) to src/core/reminders.js; tests/test-core.js checks no plugin keeps a copy.
{
  const R = require('./lib/paths').fromSrc('core/reminders');
  const names = ['REMINDER_CHOICES', 'ringField', 'offsetMinutes', 'offsetIso', 'reminderOf', 'reminderShort', 'reminderWords'];
  for (const [i, logic] of [L, T, PL].entries()) for (const x of names) ok(logic[x] !== undefined, `${['Projects', 'Today', 'Planner'][i]} still offers ${x}`);
  for (const src of srcs) eq(((/^import \{ ([^}]*) \} from '\.\.\/core\/reminders';$/m.exec(src) || [null, ''])[1]).split(', '), names, 'takes every reminder helper from the shared core');
  eq(Object.keys(R).sort(), [...names].sort(), 'the core offers exactly these');
  // Updated in section 7: one copy in src/core/tasks.js (tests/test-core.js checks no plugin keeps its own).
  ok(srcs.every((s) => require('./lib/core-use').fromCore(s, ['taskFromFrontmatter'], true)('taskFromFrontmatter')), 'all three use taskFromFrontmatter and take it from the shared core');
}

/* ---- 2. the field --------------------------------------------------------------- */
{
  // TaskNotes' own quick offsets (4.12.5: atTime PT0M, -PT5M, -PT15M, -PT1H, -P1D) and more
  eq(['PT0M', '-PT5M', '-PT15M', '-PT30M', '-PT1H', '-P1D', '-PT2H', '-PT1H30M', '-P3D', '-P1W', 'PT15M', '+PT15M', '-PT0S', 'PT0S', '-PT90S'].map(L.offsetMinutes),
    [0, 5, 15, 30, 60, 1440, 120, 90, 4320, 10080, -15, -15, 0, 0, 1], 'offset -> minutes before (negative = after)');
  eq(['', 'P', 'PT', '15m', null, undefined, 'soon', '-PTM', 42].map(L.offsetMinutes), [null, null, null, null, null, null, null, null, null], 'offset: junk reads as no reminder');
  eq([0, 5, 15, 30, 60, 1440, 120, 90, 45, 4320, 2880 + 60, -15].map(L.offsetIso), ['PT0M', '-PT5M', '-PT15M', '-PT30M', '-PT1H', '-P1D', '-PT2H', '-PT1H30M', '-PT45M', '-P3D', '-PT49H', 'PT15M'], 'minutes -> the offset TaskNotes writes');
  for (const m of [0, 1, 5, 15, 59, 60, 61, 90, 120, 1439, 1440, 1500, 4320, 43200]) eq(L.offsetMinutes(L.offsetIso(m)), m, `round trip ${m} min`);
  // which entry LifeWorld reads
  const e = (relatedTo, offset, extra) => ({ id: 'rem_1', type: 'relative', relatedTo, offset, ...extra });
  eq(L.reminderOf({ due: '2026-10-08T16:30', reminders: [e('due', '-PT15M')] }), 15, 'one-off: the due entry');
  eq(L.reminderOf({ due: '2026-10-08T16:30', reminders: [e('scheduled', '-PT15M')] }), null, 'one-off: a start-relative entry does not ring');
  eq(L.reminderOf({ recurrence: 'FREQ=DAILY', scheduled: '2026-10-05T09:00', reminders: [e('due', '-PT5M'), e('scheduled', '-PT30M')] }), 30, 'repeating: the start (scheduled) entry');
  eq(L.reminderOf({ reminders: [{ id: 'rem_2', type: 'absolute', absoluteTime: '2026-10-08T09:00:00' }, e('due', 'PT0M', { description: 'At time' })] }), 0, 'absolute entries are skipped; a description is fine');
  eq(L.reminderOf({ reminders: [e('due', 'nonsense'), e('due', '-PT1H')] }), 60, 'an unreadable entry is skipped');
  eq([L.reminderOf({}), L.reminderOf({ reminders: [] }), L.reminderOf({ reminders: 'x' }), L.reminderOf(null)], [null, null, null, null], 'no entry: no reminder');
  eq([L.ringField({}), L.ringField({ recurrence: 'FREQ=DAILY' }), L.ringField({ recurrence: '  ' })], ['due', 'scheduled', 'due'], 'ringing field');
  // words and marks (mockup: "15 min before", "1 hour before", Today's "15m")
  eq([0, 5, 15, 30, 60, 1440, 120, 90, 4320, -15].map(L.reminderWords), ['At the time', '5 min before', '15 min before', '30 min before', '1 hour before', '1 day before', '2 hours before', '1 hour 30 min before', '3 days before', '15 min after'], 'words');
  eq([0, 5, 15, 60, 1440, 90, 120].map(L.reminderShort), ['', '5m', '15m', '1h', '1d', '1h30m', '2h'], 'the small mark after the bell');
  eq(L.REMINDER_CHOICES, [0, 5, 15, 30, 60, 1440], 'the picker\'s choices (mockup: At the time, 5, 15, 30 min, 1 hour, 1 day)');
  // "Other" (mockup: "45 min", "2 hours", "3 days")
  eq(['45 min', '2 hours', '3 days', '2 hours before', '90', '1h30m', '1 hour 30 min', '1.5 hours', '1,5 h', '2h', '1 week', '0', ' 10 minutes '].map(L.parseReminderText),
    [45, 120, 4320, 120, 90, 90, 90, 90, 90, 120, 10080, 0, 10], 'Other: typed amounts');
  eq(['', 'soon', '2 parsecs', 'hours', '-5 min', '31 days', '5 min tomorrow'].map(L.parseReminderText), [null, null, null, null, null, null, null], 'Other: what it refuses');
}

/* ---- 3. when it rings --------------------------------------------------------------- */
{
  eq(L.ringAt('2026-10-08', '16:30', 15), { day: '2026-10-08', time: '16:15' }, 'ring: 15 min before');
  eq(L.ringAt('2026-10-08', '00:10', 15), { day: '2026-10-07', time: '23:55' }, 'ring: across midnight');
  eq(L.ringAt('2026-10-08', '16:30', 1440), { day: '2026-10-07', time: '16:30' }, 'ring: 1 day before');
  eq(L.ringAt('2026-03-01', '09:00', 4320), { day: '2026-02-26', time: '09:00' }, 'ring: 3 days before, across a month');
  eq([L.ringText('2026-10-08', '16:30', 15), L.ringText('2026-10-08', '16:30', 0), L.ringText('2026-10-08', '16:30', 1440)], ['4:15 PM', '4:30 PM', 'Wed 4:30 PM'], 'ring text (menu: "Wed 4:30 PM" for 1 day)');
  const TODAY = '2026-10-05';
  // the picker's orange line, word for word from the mockup
  eq(L.whenPreview({ day: '2026-10-08', time: '16:30' }, 'due', TODAY, false, 15), 'Due Thu, Oct 8, 4:30 PM · Afternoon · reminder at 4:15 PM (15 min before)', 'line: mockup 1');
  eq(L.whenPreview({ day: '2026-10-07', time: null, half: null }, 'due', TODAY, false, null), 'Due Wed, Oct 7 · Any time · no reminder', 'line: mockup 2 (no time)');
  eq(L.whenPreview({ day: '2026-10-06', time: '15:00' }, 'due', TODAY, false, 120), 'Due Tue, Oct 6 (tomorrow), 3:00 PM · Afternoon · reminder at 1:00 PM (2 hours before)', 'line: mockup 3 (Other: 2 hours)');
  eq(L.whenPreview({ day: '2026-10-08', time: '16:30' }, 'due', TODAY, false, 0), 'Due Thu, Oct 8, 4:30 PM · Afternoon · reminder at 4:30 PM', 'line: at the time');
  eq(L.whenPreview({ day: '2026-10-08', time: '16:30' }, 'due', TODAY, false, null), 'Due Thu, Oct 8, 4:30 PM · Afternoon · no reminder', 'line: None');
  eq(L.whenPreview({ day: '2026-10-08', time: '16:30' }, 'due', TODAY, false), 'Due Thu, Oct 8, 4:30 PM · Afternoon · reminder at 4:30 PM', 'line: no choice given = at the time (as before)');
  eq(L.whenPreview({ day: '2026-10-12', time: '09:00' }, 'start', TODAY, true, 15), 'Starts Mon, Oct 12, 9:00 AM · rings at 8:45 AM (15 min before) each time', 'line: repeating start');
  eq(L.whenPreview({ day: '2026-10-12', time: '09:00' }, 'start', TODAY, false, 15), 'Starts Mon, Oct 12, 9:00 AM · no reminder (reminders ring at the due time)', 'line: a one-off start never rings');
  // the reminder a save leaves (the card's typing box)
  const t0 = { recurrenceRaw: null, dueTime: null, startTime: null, reminderSet: null };
  eq(L.reminderAfter(t0, 'due', { day: '2026-10-08', time: '16:30' }), 0, 'typed: a first time rings at the time');
  eq(L.reminderAfter({ ...t0, dueTime: '15:00' }, 'due', { day: '2026-10-08', time: '16:30' }), null, 'typed: a task that had a time and no reminder keeps none');
  eq(L.reminderAfter({ ...t0, dueTime: '15:00', reminderSet: 15 }, 'due', { day: '2026-10-08', time: '16:30' }), 15, 'typed: a new time keeps its "15 min before"');
  eq(L.reminderAfter({ ...t0, reminderSet: 30 }, 'due', { day: '2026-10-08', time: '16:30' }), 30, 'typed: a time coming back rings with the old offset');
  eq(L.reminderAfter(t0, 'due', { day: '2026-10-08', time: null }), null, 'typed: no time, nothing rings');
  eq(L.reminderAfter(t0, 'start', { day: '2026-10-08', time: '09:00' }), null, 'typed: a one-off start never rings');
  // picker options carry the row only where a time rings
  const rt = L.readTask(tk({ due: '2026-10-08T16:30', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT15M' }] }), TP('a'), 'a', L.engineConfig(null), false);
  eq([L.whenPickerOpts(rt, 'due', TODAY).rings, L.whenPickerOpts(rt, 'due', TODAY).reminder, L.whenPickerOpts(rt, 'start', TODAY).rings], [true, 15, false], 'picker: the Reminder row on Due (one-off), not on Starts');
  const rr = L.readTask(tk({ recurrence: 'DTSTART:20261005T090000Z;FREQ=DAILY', scheduled: '2026-10-05T09:00' }), TP('r'), 'r', L.engineConfig(null), false);
  eq([L.whenPickerOpts(rr, 'due', TODAY).rings, L.whenPickerOpts(rr, 'start', TODAY).rings], [false, true], 'picker: a repeating task\'s row is on Starts');
  const ru = L.readTask(tk({ due: '2026-10-08', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT5M' }] }), TP('u'), 'u', L.engineConfig(null), false);
  eq([ru.reminder, ru.reminderSet], [null, 5], 'reader: no time, no ring; the stored choice is kept for when a time comes back');
}

/* ---- 4. engine writes ------------------------------------------------------------- */
{
  const v = makeVault({
    [TP('a')]: tk({ due: '2026-10-08', planned_half: 'am' }),
    [TP('b')]: tk({ due: '2026-10-08T15:00' }),
    [TP('c')]: tk({ due: '2026-10-08T15:00', reminders: [{ id: 'rem_9', type: 'absolute', absoluteTime: '2026-10-08T08:00:00' }, { id: 'rem_8', type: 'relative', relatedTo: 'due', offset: '-PT15M', description: 'mine' }] }),
    [TP('r')]: tk({ recurrence: 'DTSTART:20261005;FREQ=WEEKLY;BYDAY=MO', scheduled: '2026-10-05' }),
    [TP('o')]: tk({ due: '2026-10-08T15:00', reminders: [{ id: 'rem_7', type: 'relative', relatedTo: 'due', offset: '-PT30M' }] }),
  });
  const e = engineFor(v);
  const id = `rem_${NOW.getTime()}`;
  // first time, no choice -> At the time
  const before = clone(v.fms.get(TP('a')));
  const w = await e.setDue(TP('a'), '2026-10-08T16:30');
  eq(remOf(v.fms.get(TP('a'))), [{ id, type: 'relative', relatedTo: 'due', offset: 'PT0M' }], 'first time: "At the time", in TaskNotes\' format');
  await w.undo();
  eq(v.fms.get(TP('a')), before, 'Undo: the reminder goes with the time');
  // first time with an explicit choice (the picker's row)
  await e.setDue(TP('a'), '2026-10-08T16:30', undefined, 15);
  eq(remOf(v.fms.get(TP('a'))), [{ id, type: 'relative', relatedTo: 'due', offset: '-PT15M' }], 'picker: 15 min written as -PT15M');
  // the time moves: the offset stays (the same entry, untouched)
  const kept = clone(remOf(v.fms.get(TP('a'))));
  await e.setDue(TP('a'), '2026-10-09T10:00');
  eq(remOf(v.fms.get(TP('a'))), kept, 'a changed due time keeps "15 min before"');
  // time taken off: the entry stays, nothing rings; it comes back with the time
  await e.setDue(TP('a'), '2026-10-09', null);
  eq([remOf(v.fms.get(TP('a'))), L.taskFromFrontmatter(v.fms.get(TP('a')), TP('a'), 'a').reminder], [kept, null], 'time off: entry kept, the task does not ring');
  await e.setDue(TP('a'), '2026-10-09T11:00');
  eq(L.taskFromFrontmatter(v.fms.get(TP('a')), TP('a'), 'a').reminder, 15, 'time back: rings 15 min before again');
  // picker None removes the key
  await e.setDue(TP('a'), '2026-10-09T11:00', undefined, null);
  ok(!('reminders' in v.fms.get(TP('a'))), 'None: the key is removed (as TaskNotes removes an empty list)');
  // a task that already had a time and no reminder stays without one
  await e.setDue(TP('b'), '2026-10-09T09:00');
  ok(!('reminders' in v.fms.get(TP('b'))), 'had a time, no reminder: a new time adds none');
  // the bell's own write
  const bBefore = clone(v.fms.get(TP('b')));
  const wb = await e.setReminder(TP('b'), 60);
  eq(remOf(v.fms.get(TP('b'))), [{ id, type: 'relative', relatedTo: 'due', offset: '-PT1H' }], 'bell: 1 hour before');
  ok(/^2026-10-05T10:30:00\.000[+-]\d{2}:\d{2}$/.test(v.fms.get(TP('b')).dateModified), 'bell: dateModified stamped as TaskNotes does');
  await wb.undo();
  eq(v.fms.get(TP('b')), bBefore, 'bell: Undo');
  const dm = v.fms.get(TP('o')).dateModified;
  await e.setReminder(TP('o'), 30);
  eq([remOf(v.fms.get(TP('o')))[0].id, v.fms.get(TP('o')).dateModified], ['rem_7', dm], 'bell: choosing the current offset writes nothing');
  // other entries are kept as found
  await e.setReminder(TP('c'), 5);
  eq(remOf(v.fms.get(TP('c'))), [{ id: 'rem_9', type: 'absolute', absoluteTime: '2026-10-08T08:00:00' }, { id, type: 'relative', relatedTo: 'due', offset: '-PT5M' }], 'other entries kept; ours replaced');
  await e.setReminder(TP('c'), null);
  eq(remOf(v.fms.get(TP('c'))), [{ id: 'rem_9', type: 'absolute', absoluteTime: '2026-10-08T08:00:00' }], 'None keeps an absolute entry it does not use');
  // repeating: the start time rings; a first time gets At the time on `scheduled`
  await e.setStart(TP('r'), '2026-10-05T09:00');
  eq(remOf(v.fms.get(TP('r'))), [{ id, type: 'relative', relatedTo: 'scheduled', offset: 'PT0M' }], 'repeating: a first start time rings at the time (relatedTo scheduled)');
  await e.setStart(TP('r'), '2026-10-05T09:30', 15);
  eq(L.taskFromFrontmatter(v.fms.get(TP('r')), TP('r'), 'r').reminder, 15, 'repeating: 15 min before its start, each time');
  // repeat off: the reminder follows the field that rings
  await e.setRepeat(TP('r'), '');
  eq(remOf(v.fms.get(TP('r')))[0].relatedTo, 'due', 'repeat off: the reminder moves to due');
  await e.setRepeat(TP('o'), 'FREQ=DAILY');
  eq(remOf(v.fms.get(TP('o')))[0].relatedTo, 'scheduled', 'repeat on: the reminder moves to the start');
  // moves never add a reminder (they only keep or drop the time)
  const mv = makeVault({ [TP('m')]: tk({ due: '2026-10-08T09:00' }) });
  await engineFor(mv).move(TP('m'), '2026-10-09', 'am', 10);
  ok(!('reminders' in mv.fms.get(TP('m'))), 'a move adds no reminder');
}

/* ---- 4b. create ---------------------------------------------------------------------- */
{
  const v = makeVault({});
  const e = engineFor(v);
  const id = `rem_${NOW.getTime()}`;
  const r1 = await e.create({ title: 'Pay the electricity bill', due: '2026-10-08T16:30' });
  const fm1 = v.fms.get(r1.result.path);
  eq(fm1.reminders, [{ id, type: 'relative', relatedTo: 'due', offset: 'PT0M' }], 'create with a time: "At the time"');
  const keys = Object.keys(fm1);
  ok(keys.indexOf('reminders') === keys.indexOf('tags') - 1 && keys.indexOf('reminders') > keys.indexOf('dateModified'), 'create: reminders right before tags (TaskNotes\' order)', keys.join(','));
  const r2 = await e.create({ title: 'Water the garden', due: '2026-10-07' });
  ok(!('reminders' in v.fms.get(r2.result.path)), 'create without a time: no reminder');
  const r3 = await e.create({ title: 'Standup', recurrence: 'FREQ=DAILY', scheduled: '2026-10-06T09:30' });
  eq(v.fms.get(r3.result.path).reminders, [{ id, type: 'relative', relatedTo: 'scheduled', offset: 'PT0M' }], 'create a repeat with a time: rings at its start');
  const r4 = await e.create({ title: 'Book flights', scheduled: '2026-10-12T09:00' });
  ok(!('reminders' in v.fms.get(r4.result.path)), 'create with only a start time (one-off): no reminder');
  const own = [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT1H' }];
  const r5 = await e.create({ title: 'Call Max', due: '2026-10-06T15:00', reminders: own });
  eq(v.fms.get(r5.result.path).reminders, own, 'create: a choice that came with the task is kept');
  const r6 = await e.create({ title: 'No ring', due: '2026-10-06T15:00', reminders: [] });
  ok(!('reminders' in v.fms.get(r6.result.path)), 'create: an empty choice writes nothing');
  // quick add through the engine (the same input the Planner and Menu Bar Capture send)
  const qa = L.quickAddPlan(L.understand('call Max friday 3pm', '2026-10-05'), '2026-10-05').input;
  const r7 = await e.create(qa);
  eq(L.taskFromFrontmatter(v.fms.get(r7.result.path), r7.result.path, 'x').reminder, 0, 'quick add with a time: rings at the time (quick add itself unchanged)');
}

/* ---- 5. readers agree ------------------------------------------------------------------ */
{
  const fms = [
    tk({ due: '2026-10-08T16:30', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT15M' }] }),
    tk({ due: '2026-10-08T15:00', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: 'PT0M' }] }),
    tk({ due: '2026-10-08T17:00' }),
    tk({ due: '2026-10-08', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: 'PT0M' }] }),
    tk({ recurrence: 'DTSTART:20261005T090000Z;FREQ=DAILY', scheduled: '2026-10-05T09:00', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'scheduled', offset: '-PT5M' }] }),
  ];
  const want = [15, 0, null, null, 5];
  for (const [name, X] of [['Projects', L], ['Today', T], ['Planner', PL]]) eq(fms.map((fm, i) => X.taskFromFrontmatter(fm, TP(`t${i}`), `t${i}`).reminder), want, `${name}: which tasks ring (bell) and how early`);
  ok(/if \(t\.time && t\.reminder != null && !done\)/.test(srcs[1]) && /a4t-bell/.test(srcs[1]), 'Today: the bell only on an open timed task that rings');
  ok(/if \(it\.time && it\.reminder != null && !done\)/.test(srcs[2]) && /a4pl-bell/.test(srcs[2]), 'Planner: the bell only on an open timed task that rings');
}

/* ---- 6. no double ring --------------------------------------------------------------------- */
{
  for (const [i, p] of ['a4-projects', 'a4-today', 'a4-planner'].entries()) ok(!/new Notification\(|Notification\.requestPermission/.test(srcs[i]), `${p}: fires no notification of its own`);
  const tn = path.join(VAULT || '', '.obsidian/plugins/tasknotes/data.json');
  if (VAULT && fs.existsSync(tn)) ok(JSON.parse(fs.readFileSync(tn, 'utf8')).enableNotifications === false, 'TaskNotes\' own notifications are off (turning it back on cannot ring twice)');
}

console.log(`RESULT ${n} ${failed}`);
})().catch((e) => { console.log(`CRASH ${e.stack}`); console.log(`RESULT ${n} ${failed + 1}`); });
