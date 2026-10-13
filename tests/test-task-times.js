#!/usr/bin/env node
/* Task times (mockup v3 + review, approved 2026-10-05) across
 * A4 Projects, A4 Today and A4 Planner. No Obsidian: an in-memory vault.
 * `node tests/test-task-times.js` (re-runs itself in several time zones).
 *
 *  1. The time helpers are the same code in all three plugins.
 *  2. Typed words: every phrase in the v2 table, the review's edge cases,
 *     clock times, the 1 PM split, and what the orange line says.
 *  3. Quick add puts a typed time on Due (or on Starts, or a repeat's start).
 *  4. Storage in TaskNotes' format ('YYYY-MM-DDTHH:MM') and back, through the
 *     A4 Projects engine; "due always wins"; repeating tasks keep the time
 *     when ticked.
 *  5. Moves and drags keep the time inside its half of the day; into the
 *     other half (or Any time) it comes off, and Undo puts it back. Also the
 *     "Move all N to today" buttons and their Undo.
 *  6. Clearing a time keeps the day.
 * Built files for behaviour, src/ for text (tests/lib/paths.js). */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const { built, source } = require('./lib/paths');
const ZONES = ['America/Costa_Rica', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'America/New_York', 'Australia/Lord_Howe'];

if (!process.env.A4TT_CHILD) {
  let fails = 0; let total = 0;
  for (const tz of ZONES) {
    try {
      const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, A4TT_CHILD: '1' }, encoding: 'utf8', timeout: 120000 });
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
const notices = [];
class Notice { constructor(m) { notices.push(typeof m === 'string' ? m : '[fragment]'); } hide() {} }
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice, setIcon() {}, Platform: {}, Component: class {}, Menu: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const PJ = require(built('a4-projects'));
const TodayPlugin = require(built('a4-today'));
const PlannerPlugin = require(built('a4-planner'));
const L = PJ.logic; const T = TodayPlugin.logic; const PL = PlannerPlugin.logic;
const TaskEngine = PJ.TaskEngine;

let n = 0; let failed = 0;
const tz = process.env.TZ;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL [${tz}] ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }
const clone = (x) => JSON.parse(JSON.stringify(x));

(async () => {
/* ---- 1. same code in all three --------------------------------------------- */
{
  const srcs = ['a4-projects', 'a4-today', 'a4-planner'].map((p) => fs.readFileSync(source(p), 'utf8'));
  const extract = (src, name) => { const m = new RegExp(`^function ${name}\\(`, 'm').exec(src); if (!m) return null; const first = src.slice(m.index, src.indexOf('\n', m.index)); const o = (first.match(/\{/g) || []).length; const c = (first.match(/\}/g) || []).length; return o && o === c ? first : src.slice(m.index, src.indexOf('\n}\n', m.index) + 2); };
  // Updated in section 6: halfOfTime and timeText moved to src/core/dates.js (tests/test-core.js).
  for (const name of ['timeOf', 'ruleTimeOf', 'onDay', 'movedDate', 'untimedSlot', 'taskFromFrontmatter', 'sortByOrder', 'applyMove']) {
    const a = extract(srcs[0], name);
    ok(a && a === extract(srcs[1], name) && a === extract(srcs[2], name), `same code in all three plugins: ${name}`);
  }
  const wu = (s) => { const i = s.indexOf('async function writeWithUndo('); return s.slice(i, s.indexOf('\n}\n', i)); };
  ok(wu(srcs[1]) && wu(srcs[1]) === wu(srcs[2]), 'Today and Planner: the same writeWithUndo');
}

/* ---- 2. typed words ---------------------------------------------------------- */
const MON = '2026-10-05'; // a Monday, the day the v2 table was run
{
  // clock times
  const C = L.parseClock;
  eq(['4pm', '4PM', '4 pm', '4 p.m.', '4p.m.', '9:30am', '12am', '12pm', '12:30pm', '15:30', '0:05', 'noon', 'midnight', '11:59 PM'].map(C),
    ['16:00', '16:00', '16:00', '16:00', '16:00', '09:30', '00:00', '12:00', '12:30', '15:30', '00:05', '12:00', '00:00', '23:59'], 'clock: am/pm, colon, noon, midnight');
  eq(['9', '13pm', '0am', '25:00', '9:75am', '9:5am', 'tea', '', '12:60'].map(C), [null, null, null, null, null, null, null, null, null], 'clock: a bare hour or an impossible time is never a time');

  const W = (s, cur, kind) => L.parseWhen(s, MON, cur || null, kind || 'due');
  const pick = (r) => (r && !r.error ? { day: r.day, time: r.time, half: r.half } : r);
  // The v2 table, as written ("I ran each of these through the mockup on Monday, Oct 5")
  eq(pick(W('tomorrow at 4PM')), { day: '2026-10-06', time: '16:00', half: 'pm' }, 'v2: tomorrow at 4PM');
  eq(pick(W('next tuesday at 9AM')), { day: '2026-10-13', time: '09:00', half: 'am' }, 'v2: next tuesday at 9AM');
  eq(pick(W('next wednesday afternoon')), { day: '2026-10-14', time: null, half: 'pm' }, 'v2: next wednesday afternoon (no set time)');
  eq(pick(W('friday morning')), { day: '2026-10-09', time: null, half: 'am' }, 'v2: friday morning');
  eq(pick(W('oct 20 3:30pm')), { day: '2026-10-20', time: '15:30', half: 'pm' }, 'v2: oct 20 3:30pm');
  eq(pick(W('friday at 4 p.m.')), { day: '2026-10-09', time: '16:00', half: 'pm' }, 'v2: friday at 4 p.m.');
  eq(pick(W('next week 10am')), { day: '2026-10-12', time: '10:00', half: 'am' }, 'v2: next week 10am');
  eq(pick(W('in 2 days')), { day: '2026-10-07', time: null, half: null }, 'v2: in 2 days (a date only)');
  eq(pick(W('noon')), { day: MON, time: '12:00', half: 'am' }, 'v2: noon = today at 12:00 PM (Morning: before 1 PM)');
  eq(pick(W('noon', { day: '2026-10-08' })), { day: '2026-10-08', time: '12:00', half: 'am' }, 'v2: noon = the task\'s current due day at noon');
  eq(pick(W('tonight')), { day: MON, time: null, half: 'pm' }, 'v2: tonight = today, afternoon, no set time');
  const t9 = W('tuesday 9');
  eq([t9.day, t9.time, t9.ask], ['2026-10-06', null, true], 'v2 + review 6: "tuesday 9" keeps the day and asks for am or pm');
  ok(/add am or pm for a time/.test(L.whenPreview(t9, 'due', MON)) && /^Due Tue, Oct 6/.test(L.whenPreview(t9, 'due', MON)), 'review 6: the line shows the day and asks for am/pm', L.whenPreview(t9, 'due', MON));
  // Review 7: plain "tuesday" and "this tuesday" next to "next tuesday"
  eq([W('tuesday').day, W('this tuesday').day, W('next tuesday').day], ['2026-10-06', '2026-10-06', '2026-10-13'], 'review 7: tuesday / this tuesday = tomorrow; next tuesday = a week later');
  eq(W('monday').day, '2026-10-12', 'today\'s weekday = a week ahead (as quick capture reads it)');
  // more edges
  eq(pick(W('Tuesday, 9AM')), { day: '2026-10-06', time: '09:00', half: 'am' }, 'capitals and a comma');
  eq(pick(W('on friday at 3:15pm')), { day: '2026-10-09', time: '15:15', half: 'pm' }, '"on ... at ..."');
  eq(pick(W('tonight at 8pm')), { day: MON, time: '20:00', half: 'pm' }, 'tonight at 8pm');
  eq(pick(W('tomorrow evening')), { day: '2026-10-06', time: null, half: 'pm' }, 'evening = afternoon half');
  eq(pick(W('midnight')), { day: MON, time: '00:00', half: 'am' }, 'midnight');
  eq(pick(W('4pm')), { day: MON, time: '16:00', half: 'pm' }, 'a time alone, no current day: today');
  eq(pick(W('4pm', { day: '2026-10-08', time: '09:00' })), { day: '2026-10-08', time: '16:00', half: 'pm' }, 'a time alone: the current day, new time');
  eq(pick(W('2026-11-02 7:45am')), { day: '2026-11-02', time: '07:45', half: 'am' }, 'ISO day + time');
  eq(pick(W('10/20 noon')), { day: '2026-10-20', time: '12:00', half: 'am' }, 'M/D + noon');
  const at9 = W('tuesday at 9'); eq([at9.day, at9.ask], ['2026-10-06', true], '"tuesday at 9" asks too');
  const b9 = W('9', { day: '2026-10-08' }); eq([b9.day, b9.ask, b9.time], ['2026-10-08', true, null], 'a bare "9": the current day, asks');
  const oct9 = W('oct 20 9'); eq([oct9.day, oct9.ask], ['2026-10-20', true], '"oct 20 9": the day, asks');
  eq(W('blah'), { error: 'day' }, 'unclear day: error, nothing saved');
  eq(W('tomorrow 13pm'), { error: 'time' }, 'impossible time: error');
  eq(W(''), null, 'empty box: nothing');
  eq(W('   '), null, 'spaces only: nothing');
  // a day alone keeps the task's time (the same as a move); a half word takes it off
  const kept = W('friday', { day: '2026-10-08', time: '16:30' });
  eq([kept.day, kept.time, kept.half, kept.kept], ['2026-10-09', '16:30', 'pm', true], 'a day alone keeps the time');
  eq(pick(W('friday morning', { day: '2026-10-08', time: '16:30' })), { day: '2026-10-09', time: null, half: 'am' }, 'a half word replaces the time');
  const askKept = W('tuesday 9', { day: '2026-10-08', time: '16:30' });
  ok(askKept.time === '16:30' && /keeps 4:30 PM; add am or pm/.test(L.whenPreview(askKept, 'due', MON)), '"tuesday 9" on a timed task: keeps its time and says so');
  // Starts
  eq(pick(W('monday 9am', null, 'start')), { day: '2026-10-12', time: '09:00', half: 'am' }, 'Starts: monday 9am');
  eq(W('monday morning', null, 'start'), { error: 'start-half' }, 'Starts takes no half-day word');
  // The 1 PM split
  eq(['00:00', '09:00', '12:00', '12:30', '12:59', '13:00', '13:01', '16:30', '23:59'].map(L.halfOfTime), ['am', 'am', 'am', 'am', 'am', 'pm', 'pm', 'pm', 'pm'], '1 PM split: before 1 PM is Morning');
  eq(W('12:30pm').half, 'am', '1 PM split: 12:30 PM is Morning');
  eq(W('1pm').half, 'pm', '1 PM split: 1 PM is Afternoon');
  eq(W('12:59').half, 'am', '1 PM split: 12:59 (24-hour) is Morning');
  eq(W('13:00').half, 'pm', '1 PM split: 13:00 is Afternoon');
  // What the orange line says (review 2 and 4: only due times ring)
  const P = (r, k, rep) => L.whenPreview(r, k, MON, rep);
  eq(P({ day: '2026-10-08', time: '16:30', half: 'pm' }, 'due'), 'Due Thu, Oct 8, 4:30 PM · Afternoon · reminder at 4:30 PM', 'line: due with a time');
  eq(P({ day: '2026-10-08', time: null, half: 'pm' }, 'due'), 'Due Thu, Oct 8 · Afternoon, no set time · no reminder', 'line: Afternoon, no set time, no reminder');
  eq(P({ day: '2026-10-12', time: '09:00', half: 'am' }, 'start'), 'Starts Mon, Oct 12, 9:00 AM · no reminder (reminders ring at the due time)', 'line: a start time does not ring');
  eq(P({ day: '2026-10-12', time: '09:00', half: 'am' }, 'start', true), 'Starts Mon, Oct 12, 9:00 AM · rings at 9:00 AM each time', 'line: a repeating task\'s start time rings each time');
  eq(P({ day: MON, time: '09:00', half: 'am' }, 'due'), 'Due Mon, Oct 5 (today), 9:00 AM · Morning · reminder at 9:00 AM', 'review 8: "Set a time" with no day shows today');
  eq(P({ day: '2026-10-06', time: null }, 'due'), 'Due Tue, Oct 6 (tomorrow) · Any time · no reminder', 'line: a date only (reminder mockup: Any time · no reminder)');
  ok(/Didn't catch the day/.test(P({ error: 'day' }, 'due')) && /Didn't catch the time/.test(P({ error: 'time' }, 'due')), 'line: errors say what to try');
  eq(L.timeText('16:30'), '4:30 PM', 'shown: 4:30 PM'); eq(L.timeText('00:05'), '12:05 AM', 'shown: 12:05 AM'); eq(L.timeText('12:00'), '12:00 PM', 'shown: 12:00 PM'); eq(L.timeText('16:00', true), '4 PM', 'shown short: 4 PM (Planner week)'); eq(L.timeText('16:30', true), '4:30 PM', 'shown short keeps minutes');
}

/* ---- 3. quick add -------------------------------------------------------------- */
{
  const U = (s) => L.understand(s, MON);
  eq(U('call Ana friday 3pm'), { priority: null, time: '15:00', plannedHalf: 'pm', due: '2026-10-09', title: 'Call Ana' }, 'quick add: "call Ana friday 3pm" -> Due Fri 3:00 PM');
  eq(U('call Ana 3pm').due, MON, 'quick add: a time alone -> due today');
  eq(U('call Ana due friday 4pm'), { priority: null, due: '2026-10-09', time: '16:00', plannedHalf: 'pm', title: 'Call Ana' }, 'quick add: due friday 4pm');
  eq(U('lunch at noon tomorrow').due, '2026-10-06', 'quick add: at noon tomorrow -> due tomorrow');
  eq(U('lunch at noon tomorrow').time, '12:00', 'quick add: at noon');
  eq(U('meet at 15:30').time, '15:30', 'quick add: "at 15:30"');
  eq(U('read Acts 2:38'), { priority: null, title: 'Read Acts 2:38' }, 'quick add: a bare colon number stays in the title');
  eq(U('buy 3 eggs'), { priority: null, title: 'Buy 3 eggs' }, 'quick add: numbers in titles are left alone');
  eq(U('call Ana tomorrow afternoon'), { priority: null, plannedHalf: 'pm', plannedDay: '2026-10-06', title: 'Call Ana' }, 'quick add: no clock time = as before');
  eq(U('book flights starts monday 9am'), { priority: null, start: '2026-10-12', startTime: '09:00', title: 'Book flights' }, 'quick add: "starts monday 9am" -> the time goes with Starts');
  const rep = U('water plants every monday 9am');
  eq([rep.recurrence, rep.time, rep.plannedHalf, rep.due, rep.plannedDay], ['FREQ=WEEKLY;BYDAY=MO', '09:00', 'am', undefined, undefined], 'quick add: a repeat with a time');
  eq(U('standup tomorrow 9:30 a.m. !high').priority, 'high', 'quick add: time and priority together');
  eq(U('standup tomorrow 9:30 a.m. !high').due, '2026-10-06', 'quick add: tomorrow 9:30 a.m.');
  eq(L.whenValue('2026-10-09', '15:00'), '2026-10-09T15:00', 'quick add writes TaskNotes\' format');
  eq(L.whenValue('2026-10-09', null), '2026-10-09', 'no time: a plain date');
}

/* ---- 4. storage: TaskNotes' format, round trips, due always wins ----------------- */
const TASKS = '02 Planner/TaskNotes/Tasks';
function makeVault(notes) {
  const files = new Map(); const fms = new Map();
  const folders = { [TASKS]: new TFolder(TASKS) };
  const add = (p, fm) => { const f = new TFile(p); files.set(p, f); fms.set(p, fm); folders[TASKS].children.push(f); return f; };
  for (const [p, fm] of Object.entries(notes)) add(p, fm);
  const app = {
    plugins: { plugins: {} },
    vault: { getAbstractFileByPath: (p) => folders[p] || files.get(p) || null },
    metadataCache: { getFileCache: (f) => (fms.has(f.path) ? { frontmatter: fms.get(f.path), listItems: [] } : null), getFirstLinkpathDest: () => null },
    fileManager: { processFrontMatter: async (f, fn) => { fn(fms.get(f.path)); } },
  };
  return { app, fms };
}
const tk = (extra) => ({ status: 'open', priority: 'normal', tags: ['task'], dateModified: '2026-10-01T09:00:00.000-06:00', ...extra });
const TP = (name) => `${TASKS}/${name}.md`;
function engineFor(v) { const e = new TaskEngine({ app: v.app, settings: { tnSnapshot: null, archiveQueue: [] }, archiveQueueOnStatus: async () => false, cancelArchive: async () => {} }); e.now = () => new Date(2026, 9, 5, 10, 30, 0); return e; }
{
  // reading what TaskNotes writes
  eq(['2026-10-08T16:30', '2026-10-08T16:30:00', '2026-10-08 16:30', '2026-10-08T16:30:00Z', '2026-10-08', null, '', 'soon', '2026-10-08T25:00'].map(L.timeOf),
    ['16:30', '16:30', '16:30', '16:30', null, null, null, null, null], 'read: TaskNotes\' date-time shapes; a plain date has no time');
  eq(L.timeOf(new Date()), null, 'read: a parsed Date has no time we trust');
  eq([L.ruleTimeOf('DTSTART:20261012T090000Z;FREQ=WEEKLY'), L.ruleTimeOf('DTSTART:20261012;FREQ=WEEKLY'), L.ruleTimeOf('DTSTART:20261012T000000Z;FREQ=DAILY'), L.ruleTimeOf('FREQ=DAILY')], ['09:00', null, null, null], 'read: a repeat\'s DTSTART time (midnight = none)');
  for (const [name, X] of [['Projects', L], ['Today', T], ['Planner', PL]]) {
    const it = X.taskFromFrontmatter(tk({ due: '2026-10-08T16:30', planned_day: '2026-10-05', planned_half: 'am' }), TP('a'), 'a');
    eq([it.due, it.plannedDay, it.time, it.plannedHalf], ['2026-10-08', '2026-10-08', '16:30', 'pm'], `${name}: due always wins and the due time picks the half (a stale planned_half is overruled)`);
    const r = X.taskFromFrontmatter(tk({ recurrence: 'DTSTART:20261005T090000Z;FREQ=DAILY', scheduled: '2026-10-05T09:00', planned_half: 'pm' }), TP('r'), 'r');
    eq([r.time, r.plannedHalf], ['09:00', 'am'], `${name}: a repeating task's time is its start time`);
    const u = X.taskFromFrontmatter(tk({ due: '2026-10-08', planned_half: 'pm' }), TP('u'), 'u');
    eq([u.time, u.plannedHalf], [null, 'pm'], `${name}: a date with no time keeps its half`);
    const s = X.taskFromFrontmatter(tk({ scheduled: '2026-10-08T09:00' }), TP('s'), 's');
    eq([s.time, s.plannedDay], [null, null], `${name}: a one-off start time is not the time shown (it never places a task)`);
  }
  const rt = L.readTask(tk({ due: '2026-10-08T16:30', scheduled: '2026-10-06T09:15' }), TP('a'), 'a', L.engineConfig(null), false);
  eq([rt.due, rt.dueTime, rt.start, rt.startTime], ['2026-10-08', '16:30', '2026-10-06', '09:15'], 'Projects: Due and Starts each keep their own time');

  // engine writes in TaskNotes' format, and Undo puts it back
  const v = makeVault({ [TP('a')]: tk({ due: '2026-10-08', planned_half: 'am', planned_order: 10 }), [TP('b')]: tk({}), [TP('r')]: tk({ recurrence: 'DTSTART:20261005;FREQ=WEEKLY;BYDAY=MO', scheduled: '2026-10-05' }) });
  const e = engineFor(v);
  const before = clone(v.fms.get(TP('a')));
  const w1 = await e.setDue(TP('a'), '2026-10-08T16:30');
  eq([v.fms.get(TP('a')).due, v.fms.get(TP('a')).planned_half], ['2026-10-08T16:30', 'pm'], 'write: due 2026-10-08T16:30 (TaskNotes\' format), half from the time');
  ok(/^2026-10-05T10:30:00\.000[+-]\d{2}:\d{2}$/.test(v.fms.get(TP('a')).dateModified), 'write: dateModified stamped as TaskNotes does');
  const back = L.taskFromFrontmatter(v.fms.get(TP('a')), TP('a'), 'a');
  eq([back.due, back.time, back.plannedHalf], ['2026-10-08', '16:30', 'pm'], 'round trip: what was written reads back the same');
  eq(L.tnDatePart(v.fms.get(TP('a')).due), '2026-10-08', 'round trip: TaskNotes\' own getDatePart reads the day');
  await w1.undo(); eq(v.fms.get(TP('a')), before, 'Undo: the note is exactly as before');
  await e.setDue(TP('b'), '2026-10-09T09:45');
  eq([v.fms.get(TP('b')).due, v.fms.get(TP('b')).planned_half], ['2026-10-09T09:45', 'am'], 'write: 9:45 AM -> Morning');
  // 6. clearing a time keeps the day
  await e.setDue(TP('b'), '2026-10-09', 'pm');
  eq([v.fms.get(TP('b')).due, v.fms.get(TP('b')).planned_half], ['2026-10-09', 'pm'], 'clear the time, tap Afternoon: day kept, Afternoon, no time');
  await e.setDue(TP('b'), '2026-10-09T10:00');
  await e.setDue(TP('b'), '2026-10-09', null);
  ok(v.fms.get(TP('b')).due === '2026-10-09' && !('planned_half' in v.fms.get(TP('b'))), 'clear the time, tap Any time: day kept, no half');
  await e.setDue(TP('b'), '2026-10-09T10:00');
  await e.setDue(TP('b'), null);
  ok(!('due' in v.fms.get(TP('b'))), 'the x removes the due date and its time');
  // start time, one-off
  await e.setStart(TP('b'), '2026-10-12T09:00');
  eq(v.fms.get(TP('b')).scheduled, '2026-10-12T09:00', 'write: a start time on scheduled');
  await e.setStart(TP('b'), '2026-10-12');
  eq(v.fms.get(TP('b')).scheduled, '2026-10-12', 'clear the start time: the day stays');
  // repeating task: the time goes on its start (DTSTART + scheduled) and survives a tick
  await e.setStart(TP('r'), '2026-10-05T09:00');
  const rfm = v.fms.get(TP('r'));
  eq([rfm.recurrence, rfm.scheduled, rfm.planned_half], ['DTSTART:20261005T090000Z;FREQ=WEEKLY;BYDAY=MO', '2026-10-05T09:00', 'am'], 'repeat: DTSTART with the local clock + Z (TaskNotes\' format), scheduled with the time');
  eq(L.taskFromFrontmatter(rfm, TP('r'), 'r').time, '09:00', 'repeat: reads back 9:00 AM');
  await e.toggleInstance(TP('r'), '2026-10-05');
  eq(v.fms.get(TP('r')).scheduled, '2026-10-12T09:00', 'repeat: ticking moves to next Monday and keeps 9:00');
  await e.setStart(TP('r'), '2026-10-12');
  ok(!/T\d{6}/.test(v.fms.get(TP('r')).recurrence) && v.fms.get(TP('r')).scheduled === '2026-10-12', 'repeat: clearing the start time keeps the day', JSON.stringify(v.fms.get(TP('r'))));
  // the picker's save rules
  const calls = [];
  const fake = { setDue: async (...a) => { calls.push(['due', ...a]); }, setStart: async (...a) => { calls.push(['start', ...a]); } };
  const t0 = { path: 'p', dueTime: null, startTime: null };
  const saveWhen = L.saveWhen; // what the card, the list chips and the Schedule popover call
  await saveWhen(fake, t0, 'due', { day: '2026-10-08', time: '16:30', half: 'pm' });
  await saveWhen(fake, t0, 'due', { day: '2026-10-08', time: null, half: 'am' });
  await saveWhen(fake, t0, 'due', { day: '2026-10-08', time: null, half: null });
  await saveWhen(fake, t0, 'due', { day: '2026-10-08', time: null, half: undefined });
  await saveWhen(fake, t0, 'start', { day: '2026-10-12', time: '09:00' });
  await saveWhen(fake, t0, 'due', null);
  eq(calls, [['due', 'p', '2026-10-08T16:30', undefined, undefined], ['due', 'p', '2026-10-08', 'am', undefined], ['due', 'p', '2026-10-08', null, undefined], ['due', 'p', '2026-10-08', undefined, undefined], ['start', 'p', '2026-10-12T09:00', undefined], ['due', 'p', null, undefined, undefined]], 'picker save: time / Morning / Any time / day only / start / clear');
}

/* ---- 5. sorting, moves, drags, Move all N, Undo ------------------------------------ */
{
  const day = '2026-10-05';
  const fms = {
    'T/u1.md': tk({ due: day, planned_half: 'am', planned_order: 10 }),
    'T/u2.md': tk({ due: day, planned_half: 'am', planned_order: 20 }),
    'T/t930.md': tk({ due: `${day}T09:30`, planned_order: 50 }),
    'T/t1230.md': tk({ due: `${day}T12:30`, planned_order: 5 }),
    'T/t1300.md': tk({ due: `${day}T13:00`, planned_order: 1 }),
    'T/t0800.md': tk({ due: `${day}T08:00`, planned_order: 99 }),
    'T/p1.md': tk({ planned_day: day, planned_half: 'pm', planned_order: 10 }),
  };
  const load = (m, X) => Object.entries(m).map(([p, fm]) => (X || T).taskFromFrontmatter(fm, p, p.slice(2, -3)));
  const lists = T.buildTaskLists(load(fms), day);
  eq(lists.morning.map((x) => x.path), ['T/t0800.md', 'T/t930.md', 'T/t1230.md', 'T/u1.md', 'T/u2.md'], 'Today Morning: timed first in clock order (12:30 PM is Morning), then the rest by order');
  eq(lists.afternoon.map((x) => x.path), ['T/t1300.md', 'T/p1.md'], 'Today Afternoon: 1:00 PM is Afternoon, timed first');
  eq(PL.laneOf(load(fms, PL), day, 'am').map((x) => x.path), lists.morning.map((x) => x.path).filter((p) => p !== 'T/u0'), 'Planner Morning lane: same order as Today');
  eq(PL.laneOf(load(fms, PL), day, 'pm').map((x) => x.path), ['T/t1300.md', 'T/p1.md'], 'Planner Afternoon lane: same');
  const cfg = L.engineConfig(null);
  const pjs = Object.entries(fms).map(([p, fm]) => L.readTask(fm, p, p.slice(2, -3), cfg, false));
  eq(L.sortOpenTasks(pjs, day, cfg).map((x) => x.path).slice(0, 4), ['T/t0800.md', 'T/t930.md', 'T/t1230.md', 'T/t1300.md'], 'Projects list: same day, timed first in clock order');

  // applyMove: same half keeps the time; other half or Any time takes it off
  for (const [name, X] of [['Projects', L], ['Today', T], ['Planner', PL]]) {
    eq(X.applyMove({ due: '2026-10-05T09:30', planned_half: 'am' }, '2026-10-07', 'am', 10), { due: '2026-10-07T09:30', planned_half: 'am', planned_order: 10 }, `${name}: move to another day, same half: time kept`);
    eq(X.applyMove({ due: '2026-10-05T09:30' }, '2026-10-07', 'pm', 10), { due: '2026-10-07', planned_half: 'pm', planned_order: 10 }, `${name}: into the other half: time taken off`);
    eq(X.applyMove({ due: '2026-10-05T16:30', planned_half: 'pm' }, '2026-10-05', null, 10), { due: '2026-10-05', planned_half: null, planned_order: 10 }, `${name}: to Any time: time taken off`);
    eq(X.applyMove({ due: '2026-10-05T16:30:00', planned_half: 'pm' }, '2026-10-06', 'pm', 10).due, '2026-10-06T16:30:00', `${name}: the time is kept exactly as written (seconds)`);
    eq(X.applyMove({ due: '2026-10-05', planned_half: 'pm' }, '2026-10-06', 'am', 10).due, '2026-10-06', `${name}: no time: as before`);
    eq(X.applyMove({ planned_day: '2026-10-05' }, '2026-10-06', 'am', 10), { planned_day: '2026-10-06', planned_half: 'am', planned_order: 10 }, `${name}: undated task: planned_day as before`);
  }
  eq(T.applyMove({ due: '2026-10-05T12:30' }, '2026-10-06', 'am', 10).due, '2026-10-06T12:30', '1 PM split in moves: 12:30 stays with Morning');
  eq(T.applyMove({ due: '2026-10-05T13:00' }, '2026-10-06', 'am', 10).due, '2026-10-06', '1 PM split in moves: 1:00 PM dropped into Morning loses its time');

  // drags (Today and Planner): every task to every slot of a mixed lane. Timed
  // tasks stay first in clock order; an untimed drop lands exactly where it
  // was dropped among the untimed; a timed task dropped in its own half keeps
  // its time and its clock place; dropped in the other half it loses the time.
  let tried = 0; let landed = 0;
  const lanesShapes = [
    [['09:30', 50], [null, 10], [null, 20], ['08:00', 99], [null, null], [null, 30]],
    [[null, null], [null, null], ['11:00', 0], [null, null]],
    [['10:00', 10], ['09:00', 20]],
  ];
  for (const shape of lanesShapes) {
    const base = shape.map(([t, o], i) => [`T/x${i}.md`, tk({ due: t ? `${day}T${t}` : day, planned_half: 'am', ...(o == null ? {} : { planned_order: o }) })]);
    for (const [name, X, laneOfMap] of [['Today', T, (items) => T.buildTaskLists(items, day).morning], ['Planner', PL, (items) => PL.laneOf(items, day, 'am')]]) {
      const read = (m) => [...m].map(([p, fm]) => X.taskFromFrontmatter(fm, p, p.slice(2, -3)));
      const shown0 = laneOfMap(read(new Map(base)));
      for (let from = 0; from < shown0.length; from++) {
        for (let to = 0; to < shown0.length; to++) {
          const out = new Map(base.map(([p, fm]) => [p, clone(fm)]));
          const shown = laneOfMap(read(out));
          const moving = shown[from];
          const rows = shown.filter((x) => x !== moving);
          const slot = X.untimedSlot(rows, to);
          const plan = (X.planInsert || T.planInsert)(slot.list.map((x) => x.plannedOrder), slot.idx);
          X.applyMove(out.get(moving.path), day, 'am', plan.order);
          if (plan.others) slot.list.forEach((x, k) => { if (x.plannedOrder !== plan.others[k]) out.get(x.path).planned_order = plan.others[k]; });
          const after = laneOfMap(read(out)).map((x) => x.path);
          const timed = rows.filter((x) => x.time);
          let want;
          if (moving.time) want = [...[...timed, moving].sort((a, b) => a.time.localeCompare(b.time) || a.plannedOrder - b.plannedOrder || a.path.localeCompare(b.path)).map((x) => x.path), ...rows.filter((x) => !x.time).map((x) => x.path)];
          else { const un = rows.filter((x) => !x.time).map((x) => x.path); un.splice(slot.idx, 0, moving.path); want = [...timed.map((x) => x.path), ...un]; }
          const timeKept = !moving.time || out.get(moving.path).due === `${day}T${moving.time}`;
          tried++;
          if (JSON.stringify(after) === JSON.stringify(want) && timeKept) landed++;
          else ok(false, `${name} drag ${JSON.stringify(shape)} ${from} -> ${to}`, JSON.stringify({ after, want, timeKept }));
        }
      }
    }
  }
  ok(landed === tried && tried > 50, `drags: timed stay first, untimed land where dropped, times kept (${landed}/${tried})`);
  const slotEx = T.untimedSlot([{ time: '09:00' }, { time: null, p: 1 }, { time: '10:00' }, { time: null, p: 2 }], 3);
  eq([slotEx.list.length, slotEx.idx], [2, 1], 'untimedSlot: a screen index counts only untimed rows');

  // Today plugin: moveTask keeps the time in its half, takes it off into the other, Undo puts it back
  {
    const files = { 'P/a.md': tk({ due: `${day}T09:30`, planned_half: 'am', planned_order: 10 }), 'P/b.md': tk({ due: day, planned_half: 'pm', planned_order: 10 }) };
    const app = { vault: { getAbstractFileByPath: (p) => (files[p] ? new TFile(p) : null) }, fileManager: { processFrontMatter: async (f, fn) => { fn(files[f.path]); } }, plugins: { plugins: {} } };
    const undo = await T.writeWithUndo(app, new TFile('P/a.md'), (fm) => T.applyMove(fm, day, 'pm', 20));
    eq([files['P/a.md'].due, files['P/a.md'].planned_half], [day, 'pm'], 'Today/Planner write: into Afternoon, the 9:30 AM time comes off');
    await undo();
    eq(files['P/a.md'], tk({ due: `${day}T09:30`, planned_half: 'am', planned_order: 10 }), 'Undo: time, half and order are back exactly');
    const undo2 = await PL.writeWithUndo(app, new TFile('P/b.md'), (fm) => { fm.extra = 1; });
    await undo2();
    ok(!('extra' in files['P/b.md']), 'Undo: a key that was not there is removed again');
  }

  // Planner plugin's moveTask (real method, fake app): drop a 4:30 PM task on Tuesday Afternoon, then into Morning
  {
    const files = { [TP('pay')]: tk({ due: '2026-10-08T16:30', planned_half: 'pm', planned_order: 10 }), [TP('o')]: tk({ due: '2026-10-09', planned_half: 'am', planned_order: 10 }) };
    const app = { vault: { getAbstractFileByPath: (p) => (files[p] ? new TFile(p) : null) }, fileManager: { processFrontMatter: async (f, fn) => { fn(files[f.path]); } }, plugins: { plugins: {} }, metadataCache: { getFileCache: () => null } };
    const plugin = Object.assign(Object.create(PlannerPlugin.prototype), { app });
    const items = () => Object.entries(files).map(([p, fm]) => PL.plannerItem(fm, p, p.split('/').pop().slice(0, -3)));
    const it = items()[0];
    const r1 = await plugin.moveTask(it, '2026-10-06', 'pm', null, items());
    eq([files[TP('pay')].due, r1.dropsTime], ['2026-10-06T16:30', false], 'Planner drag to another day, same half: 4:30 PM kept, no Undo needed');
    const it2 = items()[0];
    const r2 = await plugin.moveTask(it2, '2026-10-09', 'am', { before: TP('o'), after: null }, items());
    eq([files[TP('pay')].due, files[TP('pay')].planned_half, r2.dropsTime], ['2026-10-09', 'am', true], 'Planner drag into Morning: time taken off, Undo offered');
    await r2.undo();
    eq([files[TP('pay')].due, files[TP('pay')].planned_half], ['2026-10-06T16:30', 'pm'], 'Planner Undo: back on Tuesday at 4:30 PM');
  }

  // "Move all N to today" (Today) keeps times; its Undo puts them back
  {
    const files = {
      [TP('late-timed')]: tk({ due: '2026-10-01T16:30', planned_half: 'pm', planned_order: 5 }),
      [TP('late-plain')]: tk({ due: '2026-10-02' }),
      [TP('late-am')]: tk({ due: '2026-10-03T08:15:00' }),
    };
    const orig = clone(files);
    const app = { vault: { getAbstractFileByPath: (p) => (files[p] ? new TFile(p) : null) }, fileManager: { processFrontMatter: async (f, fn) => { fn(files[f.path]); } }, plugins: { plugins: {} } };
    const plugin = Object.assign(Object.create(TodayPlugin.prototype), { app });
    const lists = T.buildTaskLists(Object.entries(files).map(([p, fm]) => T.taskFromFrontmatter(fm, p, p)), day);
    const res = await plugin.moveOverdueToToday(T.planOverdueMove(lists), day);
    eq(res.moved.length, 3, 'Today Move all: three moved');
    eq([files[TP('late-timed')].due, files[TP('late-plain')].due, files[TP('late-am')].due], [`${day}T16:30`, day, `${day}T08:15:00`], 'Today Move all: times kept');
    const after = T.buildTaskLists(Object.entries(files).map(([p, fm]) => T.taskFromFrontmatter(fm, p, p)), day);
    eq([after.morning.map((x) => x.path)[0], after.afternoon.map((x) => x.path)[0]], [TP('late-am'), TP('late-timed')], 'Today Move all: the timed ones sit first in their half');
    await res.undo();
    eq(files, orig, 'Today Move all Undo: every note exactly as before, times included');
  }
  // "Move N overdue to today" (Projects) keeps times; its Undo puts them back
  {
    const v = makeVault({ [TP('late-timed')]: tk({ due: '2026-10-01T16:30', planned_half: 'pm' }), [TP('late-plain')]: tk({ due: '2026-10-02' }) });
    const orig = clone([...v.fms]);
    const e = engineFor(v);
    const toast = { shown: null, show(m, u) { this.shown = [m, u]; } };
    const plugin = Object.assign(Object.create(PJ.prototype), { app: v.app, engine: e, toast });
    const nMoved = await plugin.moveOverdueToToday(null);
    eq(nMoved, 2, 'Projects Move overdue: two moved');
    eq([v.fms.get(TP('late-timed')).due, v.fms.get(TP('late-plain')).due], [`${day}T16:30`, day], 'Projects Move overdue: time kept');
    await toast.shown[1]();
    eq([...v.fms], orig, 'Projects Move overdue Undo: exactly as before');
    // placeTask (Schedule popover / card When): into the other half, the time comes off and the toast says so
    const v2 = makeVault({ [TP('m')]: tk({ due: '2026-10-08T09:00', planned_half: 'am' }) });
    const e2 = engineFor(v2);
    const p2 = Object.assign(Object.create(PJ.prototype), { app: v2.app, engine: e2, toast });
    const t = e2.collectTasks(false)[0];
    const w = await p2.placeTask(t, '2026-10-06', 'pm', e2.collectTasks(false));
    eq([v2.fms.get(TP('m')).due, w.dropsTime], ['2026-10-06', '09:00'], 'Projects Schedule "Tomorrow afternoon": the 9:00 AM time comes off and is named');
    await w.undo();
    eq(v2.fms.get(TP('m')).due, '2026-10-08T09:00', 'Projects Undo: the time is back');
    const w2 = await p2.placeTask(e2.collectTasks(false)[0], '2026-10-09', 'am', e2.collectTasks(false));
    eq([v2.fms.get(TP('m')).due, w2.dropsTime], ['2026-10-09T09:00', null], 'Projects "Another day", same half: time kept');
  }
}

console.log(`RESULT ${n} ${failed}`);
})().catch((e) => { console.log('CRASH', e && e.stack); console.log(`RESULT ${n} ${failed + 1}`); });
