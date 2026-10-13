#!/usr/bin/env node
/* Quick add with dates and times in A4 Planner, the same as A4 Projects' quick
 * add (task times v3, approved 2026-10-05). Moved from the A4 vault: Menu Bar
 * Capture is a separate companion, not in this repo, so its checks (old parts
 * 1 and 5) stay in the vault copy only.
 * No Obsidian: stand-ins for the vault and TaskNotes' API.
 * `node tests/test-quick-add.js` (re-runs itself in several time zones).
 *
 *  1. One quick add parser, in src/core/quickadd.js (before section 6, the SHARED
 *     block was a verbatim copy in Projects and Planner); every name it calls exists.
 *  2. The three plugins read every phrase the same way: same task fields, same
 *     orange "Adds:" line.
 *  3. Planner quick add saves what Projects' quick add saves (time on Due in
 *     TaskNotes' format, planned_half, planned_order, project), through A4
 *     Projects' own engine (planCreate) as well.
 *  4. A calendar event dropped on the Planner keeps its start time on Due only
 *     inside that time's half of the day.
 *  5. Menu Bar Capture: typed words win over the buttons; with none typed the
 *     buttons save exactly what they saved before; the panel's line; the task
 *     list mode is unchanged.
 * Built files for behaviour, src/ for text (tests/lib/paths.js). */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const { built, source } = require('./lib/paths');
const ZONES = ['America/Costa_Rica', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'Australia/Lord_Howe'];

if (!process.env.A4QA_CHILD) {
  console.log('skipped: the Menu Bar Capture checks (old parts 1 and 5); that companion is not in this repo, its checks run in the A4 vault copy');
  let fails = 0; let total = 0;
  for (const tz of ZONES) {
    try {
      const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, A4QA_CHILD: '1' }, encoding: 'utf8', timeout: 120000 });
      const m = /RESULT (\d+) (\d+)/.exec(out);
      total += Number(m[1]); fails += Number(m[2]);
      console.log(`${tz.padEnd(22)} ${m[1]} checks, ${m[2]} failed`);
      if (Number(m[2])) console.log(out.split('\n').filter((l) => /^FAIL|CRASH/.test(l)).slice(0, 60).join('\n'));
    } catch (e) { fails++; console.log(`${tz.padEnd(22)} FAILED\n${((e.stdout || '') + (e.stderr || '')).slice(0, 4000)}`); }
  }
  console.log(`\nTOTAL ${total} checks, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

class TFile { constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.md$/, ''); this.extension = 'md'; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
const notices = [];
class Notice { constructor(m) { notices.push(m); } hide() {} }
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice, setIcon() {}, Platform: {}, Component: class {}, Menu: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const PJ = require(built('a4-projects')); const PlannerPlugin = require(built('a4-planner'));
const L = PJ.logic; const PL = PlannerPlugin.logic;

let n = 0; let failed = 0;
const tz = process.env.TZ;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL [${tz}] ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }
const clone = (x) => JSON.parse(JSON.stringify(x));

async function main() {
  /* ---- 1. one parser, in the shared core -------------------------------------- */
  // Updated in section 6: the SHARED quick add block moved from Projects and Planner (verbatim
  // copies) to src/core/quickadd.js; tests/test-core.js checks no plugin keeps a copy.
  const src = { pj: fs.readFileSync(source('a4-projects'), 'utf8'), pl: fs.readFileSync(source('a4-planner'), 'utf8') };
  const QA = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'quickadd.js'), 'utf8');
  ok(QA.length > 5000 && !src.pj.includes('end of SHARED quick add') && !src.pl.includes('end of SHARED quick add'), 'one quick add block, in src/core/quickadd.js, none left in Projects or Planner');
  for (const k of ['pj', 'pl']) {
    const m = /^const \{ ([^}]*) \} = require\('\.\.\/core\/quickadd'\);$/m.exec(src[k]);
    const names = m ? m[1].split(', ') : [];
    ok(['understand', 'parseClock', 'quickAddChips', 'quickAddPlan'].every((x) => names.includes(x)), `${k}: takes the parser and the "Adds:" line from the shared core`);
  }
  for (const name of ['understand', 'parseDayWord', 'parseClock', 'repeatRule', 'quickAddChips', 'quickAddPlan', 'whenValue', 'shortDay']) {
    ok((QA.match(new RegExp(`^function ${name}\\(`, 'gm')) || []).length === 1, `core: ${name} is defined once (no second copy overriding it)`);
  }
  // Every top-level name the shared block uses is defined there or taken from the dates core (no
  // ReferenceError waiting for a phrase the tests didn't try).
  const used = [...new Set((QA.match(/(?<![\\.\w])[A-Za-z_][A-Za-z0-9_]*(?=\()/g) || []))].filter((x) => !['function', 'if', 'for', 'while', 'return', 'String', 'Number', 'RegExp', 'Array', 'Math', 'Date', 'Set', 'isNaN', 'exec', 'test', 'push', 'slice', 'replace', 'join', 'map', 'filter', 'split', 'trim', 'toLowerCase', 'toUpperCase', 'startsWith', 'includes', 'findIndex', 'indexOf', 'sort', 'cut', 'fn', 'ahead', 'padStart', 'every', 'source', 'flags', 'endsWith', 'require'].includes(x));
  const fromDates = (/^const \{ ([^}]*) \} = require\('\.\/dates'\);$/m.exec(QA) || [null, ''])[1].split(', ');
  eq(used.filter((x) => !new RegExp(`^(?:function ${x}\\(|const ${x} = )`, 'm').test(QA) && !fromDates.includes(x)), [], 'every function the shared block calls is defined');

  /* ---- 2. same reading, same orange line ------------------------------------- */
  const MON = '2026-10-05'; // a Monday
  const PHRASES = ['call Ana friday 3pm', 'call Ana 3pm', 'call Ana due friday 4pm', 'lunch at noon tomorrow', 'meet at 15:30', 'read Acts 2:38', 'buy 3 eggs',
    'call Ana tomorrow afternoon', 'book flights starts monday 9am', 'standup every monday 9am', 'standup tomorrow 9:30 a.m. !high', 'water plants every Monday',
    'fix the hose tomorrow afternoon', '!high due Friday', 'pay rent oct 20 p1', 'dentist next tuesday 10:15am', 'gym every weekday 6am', 'trash tonight',
    'review report in 3 days', 'call mom this evening', 'tomorrow', 'plan trip 12/24', 'ship it at midnight', 'meet 4 p.m. thursday', 'email Alex', ''];
  for (const p of PHRASES) {
    const a = L.understand(p, MON); const b = PL.understand(p, MON);
    eq(b, a, `Planner reads "${p}" as Projects does`);
    const ca = L.quickAddChips(a, MON, 'Miscellaneous', 'normal');
    eq(PL.quickAddChips(b, MON, 'Miscellaneous', 'normal'), ca, `Planner's "Adds:" line for "${p}"`);
    eq(PL.quickAddPlan(b, MON), L.quickAddPlan(a, MON), `Planner saves "${p}" as Projects does`);
  }
  // The brief's own example, end to end.
  const ana = L.understand('call Ana friday 3pm', MON);
  eq(L.quickAddChips(ana, MON, null, 'normal'), ['Call Ana', 'Due Fri, Oct 9, 3:00 PM'], '"call Ana friday 3pm" -> the line reads Due Fri, Oct 9, 3:00 PM');
  eq(L.quickAddPlan(ana, MON), { input: { title: 'Call Ana', customFrontmatter: { planned_half: 'pm' }, due: '2026-10-09T15:00' }, lane: { day: '2026-10-09', half: 'pm' } }, '"call Ana friday 3pm" -> due 2026-10-09T15:00, afternoon');
  eq(L.quickAddChips(L.understand('standup every monday 9am !high', MON), MON, 'Work', 'normal'), ['Standup', 'Work', 'Every Monday, 9:00 AM', 'High'], 'repeat, time, project and priority on the line');
  eq(L.quickAddChips(L.understand('email Alex !normal', MON), MON, null, 'normal'), ['Email Alex'], 'the default priority is left off the line');
  eq(L.quickAddChips({ title: '' }, MON, null, 'normal'), ['…'], 'no title yet: an ellipsis');

  /* ---- 3. Planner quick add saves what Projects saves ------------------------- */
  const pmItem = (o) => Object.assign({ path: `T/${o.t}.md`, title: o.t, status: 'open', priority: '', due: null, plannedDay: null, plannedHalf: null, plannedOrder: 0, time: null, recurrenceRaw: null, recurrence: null, completeInstances: [], skippedInstances: [], blockedBy: [] }, o);
  const items = [
    pmItem({ t: 'a', due: '2026-10-09', plannedDay: '2026-10-09', plannedHalf: 'pm', plannedOrder: 10 }),
    pmItem({ t: 'b', plannedDay: '2026-10-09', plannedHalf: 'pm', plannedOrder: 30 }),
    pmItem({ t: 'timed', due: '2026-10-09', plannedDay: '2026-10-09', plannedHalf: 'pm', plannedOrder: 500, time: '16:00' }),
    pmItem({ t: 'c', plannedDay: '2026-10-06', plannedHalf: 'pm', plannedOrder: 5 }),
  ];
  const plugin = new PlannerPlugin();
  const made = [];
  const fakeApi = { tasks: { create: async (d) => { made.push(clone(d)); return { path: `T/${d.title}.md` }; } } };
  plugin.tasksApi = () => fakeApi; // updated when moved: Planner asks A4 Projects' engine now, not TaskNotes (2026-10-13)
  await plugin.createTyped('call Ana friday 3pm !high', 'Miscellaneous', items, MON);
  eq(made.pop(), { title: 'Call Ana', customFrontmatter: { planned_half: 'pm', planned_order: 40 }, priority: 'high', due: '2026-10-09T15:00', projects: ['[[Miscellaneous]]'] },
    'Planner quick add: Due Fri 3:00 PM in TaskNotes\' format, afternoon, after the untimed tasks of that lane, the picked project');
  await plugin.createTyped('call Ana tomorrow afternoon', null, items, MON);
  eq(made.pop(), { title: 'Call Ana', customFrontmatter: { planned_day: '2026-10-06', planned_half: 'pm', planned_order: 15 } }, 'Planner quick add: tomorrow afternoon -> planned day and half, as Projects');
  await plugin.createTyped('email Alex', null, items, MON);
  eq(made.pop(), { title: 'Email Alex' }, 'Planner quick add: no date -> Unscheduled, no planned fields (as before)');
  await plugin.createTyped('standup every monday 9am', null, items, MON);
  eq(made.pop(), { title: 'Standup', customFrontmatter: { planned_half: 'am' }, recurrence: 'FREQ=WEEKLY;BYDAY=MO', scheduled: '2026-10-05T09:00' }, 'Planner quick add: a repeat keeps its time as its start');
  eq(await plugin.createTyped('tomorrow 3pm', null, items, MON), null, 'Planner quick add: only a day and time, no title -> nothing saved');
  eq(made.length, 0, '... and TaskNotes was not called');
  // The same fields through A4 Projects' engine: what lands in the note.
  const cfg = L.engineConfig(null);
  const fmOf = (input) => L.planCreate(input, cfg, '2026-10-05T10:00:00.000-06:00', MON).frontmatter;
  await plugin.createTyped('call Ana friday 3pm', null, items, MON);
  const fm = fmOf(made.pop());
  eq([fm.due, fm.planned_half, fm.planned_order, fm.planned_day], ['2026-10-09T15:00', 'pm', 40, undefined], 'through the engine: due 2026-10-09T15:00 (TaskNotes\' format), afternoon, no planned_day');
  const back = PL.taskFromFrontmatter(Object.assign({}, fm, { tags: ['task'] }), 'T/Call Ana.md', 'Call Ana');
  eq([back.due, back.time, back.plannedHalf, back.plannedDay], ['2026-10-09', '15:00', 'pm', '2026-10-09'], 'read back by the Planner: Fri, 3:00 PM, in the Afternoon');
  ok(!PL.understand.toString().includes('this.'), 'parser is pure');

  /* ---- 4. calendar events dropped on the board ------------------------------- */
  const ev = { date: '2026-10-10', time: '08:00', end: '14:00', allDay: false, summary: 'FarmMarket', calendar: 'Family' };
  const drop = async (day, half, e) => { await plugin.createTask({ title: e.summary, day, half, details: PL.eventDetails(e), time: e.allDay ? null : e.time }, items); return made.pop(); };
  let d = await drop('2026-10-10', 'am', ev);
  eq([d.due, d.customFrontmatter], ['2026-10-10T08:00', { planned_half: 'am', planned_order: 10 }], 'event at 8:00 dropped on that Morning: due 8:00 AM, no planned_day');
  d = await drop('2026-10-12', 'am', ev);
  eq(d.due, '2026-10-12T08:00', 'dropped on another day\'s Morning: the time goes along (the move rule)');
  d = await drop('2026-10-10', 'pm', ev);
  eq([d.due, d.customFrontmatter], [undefined, { planned_day: '2026-10-10', planned_half: 'pm', planned_order: 10 }], 'dropped on the Afternoon: the 8:00 time comes off, as before');
  d = await drop('2026-10-10', null, ev);
  eq([d.due, d.customFrontmatter], [undefined, { planned_day: '2026-10-10', planned_order: 10 }], 'dropped on Any time: no time');
  d = await drop(null, null, ev);
  eq([d.due, d.customFrontmatter], [undefined, {}], 'dropped on Unscheduled: no day, no time (as before)');
  d = await drop('2026-10-11', 'pm', { date: '2026-10-11', time: '14:05', end: '17:05', allDay: false, summary: 'Football', calendar: 'Sports' });
  eq(d.due, '2026-10-11T14:05', 'a 2:05 PM event on the Afternoon: due 2:05 PM');
  d = await drop('2026-10-06', 'am', { date: '2026-10-06', time: null, allDay: true, summary: "Alex's Birthday", calendar: 'Family' });
  eq([d.due, d.customFrontmatter.planned_day], [undefined, '2026-10-06'], 'an all-day event: no time, as before');
  d = await drop('2026-10-10', 'am', Object.assign({}, ev, { time: 'soon' }));
  eq(d.due, undefined, 'a time that isn\'t HH:MM is ignored');
  eq(d.details, 'From Apple Calendar (Family): Sat, Oct 10, soon–14:00.', 'the note line is unchanged');

  ok(src.pl.includes("time: d.ev.allDay ? null : d.ev.time }"), 'Planner passes an event\'s start time when it is dropped');
}

main().then(() => console.log(`RESULT ${n} ${failed}`)).catch((e) => { console.log(`CRASH ${e && e.stack}`); console.log(`RESULT ${n + 1} ${failed + 1}`); });
