#!/usr/bin/env node
/* Logic tests for the Planner plugin.
 * No Obsidian and no dependencies: `node tests/test-planner.js`.
 * Re-runs itself under several time zones. Also checks that the code the
 * Planner shares with Today (task reading, repeats, moves) is still a
 * character-for-character copy, so the two can never disagree.
 * Moved from the owner's vault: behaviour checks load the built files, text checks read
 * src/ (tests/lib/paths.js). Vault checks read tests/fixtures/vault, or the owner's vault with LIFEWORLD_VAULT. */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const { part, STYLES, source } = require('./lib/paths');
const MAIN = 'a4-planner';
const TODAY_MAIN = 'a4-today';
const SRC = source('a4-planner');
const TODAY_SRC = source('a4-today');
const ZONES = ['America/Costa_Rica', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'America/New_York', 'Australia/Lord_Howe'];

if (!process.env.LWPL_CHILD) {
  let fails = 0; let total = 0;
  for (const tz of ZONES) {
    try {
      const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, LWPL_CHILD: '1' }, encoding: 'utf8', timeout: 60000 });
      const m = /RESULT (\d+) (\d+)/.exec(out);
      total += Number(m[1]); fails += Number(m[2]);
      console.log(`${tz.padEnd(22)} ${m[1]} checks, ${m[2]} failed`);
      if (Number(m[2])) console.log(out);
    } catch (e) {
      fails++;
      console.log(`${tz.padEnd(22)} FAILED\n${(e.stdout || '') + (e.stderr || '')}`);
    }
  }
  console.log(`\nTOTAL ${total} checks, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

/* ---- minimal obsidian stand-in ------------------------------------------- */
class TFile {}
class TFolder {}
const fakeObsidian = { Plugin: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const L = part(MAIN).logic;
const T = part(TODAY_MAIN).logic;

let n = 0; let failed = 0;
const tz = process.env.TZ;
function ok(cond, name, extra) { n++; if (!cond) { failed++; console.log(`FAIL [${tz}] ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- 1. shared code is a verbatim copy of Today's ---------------------- */
// Updated in section 5: the date and repeat-rule helpers moved to src/core/dates.js (tests/test-core.js).
// Updated in section 6: asList, halfOfTime, timeText and the reminder helpers moved to src/core/ too.
// Updated in section 7: the task-reading helpers and the task folder constants moved to src/core/tasks.js
// (tests/test-core.js checks no plugin keeps its own copy); what is left here: each takes them from the core.
const { fromCore } = require('./lib/core-use');
const SHARED = [
  'TASKS_FOLDER', 'ARCHIVE_FOLDER', 'DEFAULT_COMPLETED_STATUSES', 'wikilinkTarget', 'wikilinkLabel', 'taskTitleOf', 'timeOf', 'ruleTimeOf', 'onDay', 'movedDate', 'untimedSlot', 'taskFromFrontmatter', 'isTaskDone', 'taskOnDay', 'sortByOrder', 'orderForInsert', 'applyMove', 'planInsert', 'blockerLinks', 'blockerHolds', 'openBlockersOf', 'isSomeday', 'applySomeday'];
const srcP = fs.readFileSync(SRC, 'utf8');
const srcT = fs.readFileSync(TODAY_SRC, 'utf8');
const viaCore = [fromCore(srcP, SHARED), fromCore(srcT, SHARED)];
for (const name of SHARED) ok(viaCore.every((f) => f(name)), `Planner and Today take ${name} from the shared core (no own copy)`);
// The calendar note both read: the one "from a note" setting in the core (phase 2 section 5), no own constant.
ok(![srcP, srcT].some((s) => /const CALENDAR_NOTE/.test(s)) && [srcP, srcT].every((s) => /feedNotes\.calendar/.test(s) && /import \{[^}]*\bfeedNotes\b[^}]*\} from '\.\.\/core\/vault'/.test(s)), 'Planner and Today read the calendar note from the core setting');

/* ---- 2. moves behave exactly like Today's (and the old Daily Planner's) -- */
const ORDERS = [[], [10], [10, 20], [-5, 0, 7.5, 30], [1, 1, 1]];
for (const o of ORDERS) for (let i = -1; i <= o.length + 1; i++) eq(L.orderForInsert(o, i), T.orderForInsert(o, i), `orderForInsert ${JSON.stringify(o)} @${i}`);
for (const fm0 of [{ due: '2026-10-01', planned_half: 'am' }, { planned_day: '2026-10-01' }, {}, { due: '2026-10-09', planned_day: '2026-10-01', planned_order: 3 }]) {
  for (const [day, half] of [['2026-10-05', 'am'], ['2026-10-06', 'pm'], ['2026-10-07', null]]) {
    eq(L.applyMove({ ...fm0 }, day, half, 15), T.applyMove({ ...fm0 }, day, half, 15), `applyMove ${JSON.stringify(fm0)} -> ${day} ${half}`);
  }
}
// Old Daily Planner's assignItem, field for field (copied from a4-daily-planner/main.js).
function oldAssign(fm, day, half, order) { if (fm.due) fm.due = day; else fm.planned_day = day; fm.planned_half = half; fm.planned_order = order; return fm; }
eq(L.applyMove({ due: '2026-10-01' }, '2026-10-03', 'pm', 5), oldAssign({ due: '2026-10-01' }, '2026-10-03', 'pm', 5), 'same as old planner: dated');
eq(L.applyMove({}, '2026-10-03', 'am', 5), oldAssign({}, '2026-10-03', 'am', 5), 'same as old planner: undated');

/* ---- 3. reading tasks ----------------------------------------------------- */
const mk = (title, fm) => L.plannerItem({ tags: ['task'], status: 'open', priority: 'normal', ...fm }, `02 Planner/TaskNotes/Tasks/${title}.md`, title);
ok(L.plannerItem({ tags: ['note'] }, 'x.md', 'x') === null, 'not a task -> ignored');
ok(L.plannerItem({ tags: ['task'], archived: true }, 'x.md', 'x') === null, 'archived -> ignored');
ok(L.plannerItem({ tags: ['task'] }, '02 Planner/TaskNotes/Archive/x.md', 'x') === null, 'archive folder -> ignored');
eq(mk('a', { projects: ['[[04 Inner World/My Life/Projects/Garden Beds]]'] }).projectKey, 'Garden Beds', 'full-path project link -> basename key');
eq(mk('a', { projects: ['[[Garden Beds|Garden]]'] }).projectKey, 'Garden Beds', 'aliased link -> basename key');
eq(mk('a', { projects: ['[[Garden Beds|Garden]]'] }).project, 'Garden', 'aliased link -> alias label');
eq(mk('a', { projects: '[[Garden Beds]]' }).projectKey, 'Garden Beds', 'single string projects');
eq(mk('a', {}).projectKey, null, 'no project');
eq(mk('a', { weekly_goal: true }).weeklyGoal, true, 'weekly goal read');
eq(mk('a', { due: '2026-10-05', planned_day: '2026-10-01' }).plannedDay, '2026-10-05', 'due always wins');

/* ---- 4. priorities (the owner's TaskNotes settings) ------------------------------ */
const A4P = [{ id: 'none', value: 'none', label: 'None', weight: 0 }, { id: 'low', value: 'low', label: 'Low', weight: 1 }, { id: 'normal', value: 'normal', label: 'Normal', weight: 2 }, { id: 'high', value: 'high', label: 'High', weight: 3 }];
const PT = L.priorityTable(A4P);
eq(PT.map((p) => [p.value, p.bars, p.top]), [['none', 0, false], ['low', 1, false], ['normal', 2, false], ['high', 3, true]], 'priorities -> bars');
eq(L.priorityTable(null).map((p) => p.value), ['none', 'low', 'normal', 'high'], 'defaults when TaskNotes is off');
eq(L.priorityOf('high', PT).label, 'High', 'label from TaskNotes');
eq(L.priorityOf('', PT).value, 'none', 'empty -> None');
eq(L.priorityOf(undefined, PT).value, 'none', 'missing -> None');
eq([L.priorityOf('urgent', PT).label, L.priorityOf('urgent', PT).weight], ['urgent', -1], 'unknown value shown as written, sorts last');
const P5 = L.priorityTable([{ value: 'a', weight: 0 }, { value: 'b', weight: 1 }, { value: 'c', weight: 2 }, { value: 'd', weight: 3 }, { value: 'e', weight: 4 }]);
eq(P5.map((p) => p.bars), [0, 1, 2, 2, 3], 'five custom levels map onto 0-3 bars');
eq(L.priorityTable([{ value: 'x', label: 'X', weight: 9 }, { value: 'y', weight: 1 }]).map((p) => p.value), ['y', 'x'], 'sorted by weight');

/* ---- 5. unscheduled, grouped --------------------------------------------- */
const DONE = ['done', 'closed'];
const items = [
  mk('Zeta', { projects: ['[[Bathroom Remodel]]'] }),
  mk('Alpha', { projects: ['[[Bathroom Remodel]]'], priority: 'low' }),
  mk('Beta', { projects: ['[[04 Inner World/My Life/Projects/Bathroom Remodel]]'], priority: 'high' }),
  mk('Gamma', { projects: ['[[Garden Beds]]'] }),
  mk('Delta', {}),
  mk('Echo', { priority: 'high' }),
  mk('Planned', { planned_day: '2026-10-05', projects: ['[[Garden Beds]]'] }),
  mk('Dated', { due: '2026-10-05', projects: ['[[Garden Beds]]'] }),
  mk('Repeating', { recurrence: 'FREQ=DAILY', scheduled: '2026-10-01', projects: ['[[Garden Beds]]'] }),
  mk('Finished', { status: 'done', projects: ['[[Garden Beds]]'] }),
  mk('Closed', { status: 'closed' }),
  mk('apple', { projects: ['[[apple orchard]]'] }),
];
const un = L.unscheduledOf(items, DONE);
eq(un.map((i) => i.title).sort(), ['Alpha', 'Beta', 'Delta', 'Echo', 'Gamma', 'Zeta', 'apple'], 'unscheduled = undated, unplanned, not repeating, not done');
const G = L.groupUnscheduled(un, PT);
eq(G.map((g) => g.label), ['apple orchard', 'Bathroom Remodel', 'Garden Beds', 'No project'], 'groups A to Z, No project last');
eq(G[G.length - 1].label, 'No project', '"No project" is last');
ok(G.map((g) => g.label).indexOf('apple orchard') < G.map((g) => g.label).indexOf('Garden Beds'), 'A to Z ignores case');
const br = G.find((g) => g.key === 'Bathroom Remodel');
eq(br.items.map((i) => i.title), ['Beta', 'Zeta', 'Alpha'], 'full-path and short link share one group; High, Normal, Low');
eq(G.find((g) => g.key === '').items.map((i) => i.title), ['Echo', 'Delta'], 'High first inside No project');
const ties = L.groupUnscheduled([mk('b task', { projects: ['[[P]]'] }), mk('A task', { projects: ['[[P]]'] }), mk('c task', { projects: ['[[P]]'], priority: 'high' })], PT);
eq(ties[0].items.map((i) => i.title), ['c task', 'A task', 'b task'], 'same priority -> A to Z, case-insensitive');
eq(L.groupUnscheduled([], PT), [], 'empty list -> no groups');
const aliased = L.groupUnscheduled([mk('x', { projects: ['[[Big Project|BP]]'] }), mk('y', { projects: ['[[Big Project]]'] })], PT);
eq([aliased.length, aliased[0].label], [1, 'BP'], 'alias used as the group label');

/* ---- 6. overdue, weekly goals, lanes ------------------------------------- */
const TODAY = '2026-10-04';
const od = L.overdueOf([
  mk('late due', { due: '2026-10-01' }), mk('late plan', { planned_day: '2026-10-02' }), mk('today', { due: TODAY }),
  mk('done late', { due: '2026-09-01', status: 'done' }), mk('rep', { recurrence: 'FREQ=DAILY', due: '2026-09-01' }), mk('future', { due: '2026-10-08' }),
], TODAY, DONE);
eq(od.map((i) => i.title), ['late due', 'late plan'], 'overdue: past due or past planned day, not done, not repeating, oldest first');
eq(L.weeklyGoalsOf([mk('g1', { weekly_goal: true }), mk('g2', { weekly_goal: true, status: 'done' }), mk('g3', {})], TODAY, DONE).map((i) => i.title), ['g1'], 'weekly goals: pinned and open');
const lane = [mk('b', { planned_day: TODAY, planned_half: 'am', planned_order: 20 }), mk('a', { planned_day: TODAY, planned_half: 'am', planned_order: 10 }),
  mk('any', { planned_day: TODAY }), mk('pm', { due: TODAY, planned_half: 'pm' }), mk('rep', { recurrence: 'FREQ=WEEKLY;BYDAY=SU', scheduled: '2026-09-06', planned_half: 'am' })];
eq(L.laneOf(lane, TODAY, 'am').map((i) => i.title), ['rep', 'a', 'b'], 'morning lane sorted by planned order (repeating task on its day)');
eq(L.laneOf(lane, TODAY, null).map((i) => i.title), ['any'], 'Any time lane = no half');
eq(L.laneOf(lane, TODAY, 'pm').map((i) => i.title), ['pm'], 'afternoon lane');
eq(L.laneOf(lane, '2026-10-05', 'am').map((i) => i.title), [], 'repeating weekly task not on Monday');

/* ---- 6b. snap-back: a drop lands where it was dropped (1.0.2) -------------- */
// Lanes shaped like a real live board on 2026-10-05: repeats placed at -30/-20,
// tasks never placed (order missing = 0), then placed ones. Every task to every
// slot, the lane rebuilt from the written frontmatter, with and without a
// project filter hiding some of the lane. Before 1.0.2 the midpoint of 0 and 0
// was 0 and the task snapped back to its file-name place.
{
  const shapes = [
    [-30, -20, null, null, 10, 20], [null, null, null, null, null, null], [-20, null, 2.5, 12.5],
    [0, 10, 20, 30, 40, 50, 60, 70], [5, 5, 5, 6], [1, 1.0000001, null, 7], [null],
  ];
  let tried = 0; let landed = 0;
  for (const shape of shapes) {
    const fms = shape.map((o, i) => ({ tags: ['task'], status: 'open', due: TODAY, planned_half: 'am', ...(o == null ? {} : { planned_order: o }),
      projects: [i % 3 === 1 ? '[[Hidden]]' : '[[Shown]]'], _n: `t${String(i).padStart(2, '0')}` }));
    for (const filter of [null, 'Shown']) {
      const read = (map) => [...map].map(([p, fm]) => L.plannerItem(fm, p, fm._n));
      const fresh = () => new Map(fms.map((fm) => [`T/${fm._n}.md`, JSON.parse(JSON.stringify(fm))]));
      const shownLane = L.laneOf(read(fresh()), TODAY, 'am').filter((x) => !filter || x.projectKey === filter);
      for (let from = 0; from < shownLane.length; from++) {
        for (let to = 0; to < shownLane.length; to++) {
          const out = fresh();
          const items = read(out);
          const shown = L.laneOf(items, TODAY, 'am').filter((x) => !filter || x.projectKey === filter);
          const moving = shown[from];
          const rows = shown.filter((x) => x !== moving); // rows on screen while dragging
          const at = { before: to < rows.length ? rows[to].path : null, after: to > 0 ? rows[to - 1].path : null };
          const others = L.laneOf(items, TODAY, 'am').filter((x) => x.path !== moving.path);
          const plan = L.planInsert(others.map((x) => x.plannedOrder), L.insertIndexOf(others, at));
          L.applyMove(out.get(moving.path), TODAY, 'am', plan.order); // what moveTask writes
          if (plan.others) others.forEach((x, k) => { if (x.plannedOrder !== plan.others[k]) out.get(x.path).planned_order = plan.others[k]; });
          const full = L.laneOf(read(out), TODAY, 'am').map((x) => x.path);
          const after = full.filter((p) => !filter || out.get(p).projects[0] === `[[${filter}]]`);
          const want = rows.map((x) => x.path); want.splice(to, 0, moving.path);
          const hiddenKept = JSON.stringify(full.filter((p) => p !== moving.path)) === JSON.stringify(others.map((x) => x.path));
          tried++;
          if (JSON.stringify(after) === JSON.stringify(want) && hiddenKept) landed++;
          else ok(false, `drop lands where dropped: ${JSON.stringify(shape)} filter=${filter} ${from} -> ${to}`, JSON.stringify({ after, want, hiddenKept }));
        }
      }
    }
  }
  ok(landed === tried && tried > 200, `every drop lands where dropped, the rest keep their order (${landed}/${tried})`);
  eq(L.planInsert([10, 20], 1), { order: 15, others: null }, 'room between neighbours: one write, midpoint');
  eq(L.planInsert([0, 0, 0], 1), { order: 20, others: [10, 30, 40] }, 'tie between neighbours: lane renumbered');
  eq(L.planInsert([0, 0], null), { order: 10, others: null }, 'Schedule button (no index): end of lane, one write');
  const O = [{ path: 'a' }, { path: 'h' }, { path: 'b' }];
  eq([L.insertIndexOf(O, { before: 'b', after: 'a' }), L.insertIndexOf(O, { before: null, after: 'b' }), L.insertIndexOf(O, null), L.insertIndexOf(O, { before: 'gone', after: 'a' })], [2, 3, 3, 1], 'screen neighbours -> lane index (hidden task h skipped)');
}

/* ---- 7. unschedule --------------------------------------------------------- */
eq(L.applyUnschedule({ planned_day: TODAY, planned_half: 'am', planned_order: 3, title: 'x', priority: 'high' }), { title: 'x', priority: 'high' }, 'unschedule removes only the planned fields');

/* ---- 8. calendar events --------------------------------------------------- */
const EV = [
  { date: '2026-10-04', time: '17:30', end: '20:00', all_day: false, summary: 'Dinner', calendar: 'Family' },
  { date: '2026-10-04', time: '08:00', end: '10:00', all_day: false, summary: 'Market', calendar: 'Family' },
  { date: '2026-10-04', time: null, end: null, all_day: true, summary: 'Holiday', calendar: 'Holidays' },
  { date: '2026-10-05', time: '09:30', summary: 'Other day' }, null, { summary: 'no date' },
];
eq(L.eventsForDay(EV, '2026-10-04').map((e) => e.summary), ['Holiday', 'Market', 'Dinner'], 'events: that day only, all-day first, then by time');
eq(L.eventsForDay(null, '2026-10-04'), [], 'no events note -> nothing');
const ev = L.eventsForDay(EV, '2026-10-04')[1];
eq(L.eventKey(ev), '2026-10-04|08:00|Market', 'event key');
eq(L.eventDetails(ev), 'From Apple Calendar (Family): Sun, Oct 4, 08:00–10:00.', 'event note text');
eq(L.eventDetails(L.eventsForDay(EV, '2026-10-04')[0]), 'From Apple Calendar (Holidays): Sun, Oct 4, All day.', 'all-day event note text');
eq(L.plannedFields('2026-10-05', 'pm', 10), { planned_day: '2026-10-05', planned_half: 'pm', planned_order: 10 }, 'event dropped on afternoon');
eq(L.plannedFields('2026-10-05', null, 10), { planned_day: '2026-10-05', planned_order: 10 }, 'event dropped on Any time: no half');
eq(L.plannedFields(null, null, 10), {}, 'event dropped on Unscheduled: no planned fields');
eq(L.pruneMade({ a: '2026-10-01', b: '2026-07-01', c: 'junk' }, TODAY), { a: '2026-10-01' }, 'made-into-task marks older than 60 days are dropped');

/* ---- 9. chips, calendar grid, labels ------------------------------------- */
eq(L.dueChipOf(mk('x', { due: '2026-10-01' }), TODAY, DONE), { cls: 'warn', text: '3D OVER' }, 'overdue chip');
eq(L.dueChipOf(mk('x', { due: TODAY }), TODAY, DONE).text, 'TODAY', 'today chip');
eq(L.dueChipOf(mk('x', { due: '2026-10-09' }), TODAY, DONE).text, 'due Oct 9', 'future due chip');
eq(L.dueChipOf(mk('x', { due: '2026-10-01', status: 'done' }), TODAY, DONE).text, 'due Oct 1', 'done task never reads overdue');
eq(L.dueChipOf(mk('x', { due: '2026-09-01', recurrence: 'FREQ=DAILY' }), TODAY, DONE), null, 'repeating task has no due chip');
const grid = L.monthGrid('2026-10');
eq([grid.length, grid[0], grid[41]], [42, '2026-09-28', '2026-11-08'], 'October 2026 grid starts Monday Sep 28');
ok(grid.includes('2026-10-31'), 'grid holds the whole month');
eq([L.shiftMonth('2026-12', 1), L.shiftMonth('2026-01', -1), L.shiftMonth('2026-10', 0)], ['2027-01', '2025-12', '2026-10'], 'month stepping over year ends');
eq(L.moveLabel(TODAY, 'am', TODAY), 'today, morning', 'label today');
eq(L.moveLabel('2026-10-05', 'pm', TODAY), 'tomorrow, afternoon', 'label tomorrow');
eq(L.moveLabel('2026-10-09', null, TODAY), 'Friday, Oct 9, any time', 'label other day');
eq(L.weekOf('2026-10-04'), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'], 'week of a Sunday starts Monday');
eq(L.weekOf('2026-11-01')[0], '2026-10-26', 'week across a daylight-saving weekend');
eq(L.weekOf('2027-01-01')[0], '2026-12-28', 'week across New Year');
for (let i = 0; i < 400; i++) { const d = L.addDays('2026-01-01', i); const w = L.weekOf(d); ok(w.length === 7 && w.includes(d) && new Date(w[0] + 'T12:00:00Z').getUTCDay() === 1, `weekOf ${d}`); }

/* ---- 10. wiring to other plugins ----------------------------------------- */
ok(/id: 'open'/.test(srcP), "planner registers command 'open' (a4-planner:open)");
ok(/'a4-planner:open'/.test(srcT), 'Today points its Planner buttons at a4-planner:open');
ok(!/localStorage/.test(srcP), 'folding is kept in plugin data, not localStorage');
ok(!/Pick a spot/.test(srcP), 'no pick-a-spot mode (removed)');

/* ---- 11. Someday (mockup approved 2026-10-06; GL-002 status `someday`) ---- */
{
  const SD = (fm) => L.applySomeday(JSON.parse(JSON.stringify(fm)));
  // One-off: the day comes off, due too; everything else stays.
  const one = { status: 'open', priority: 'high', scheduled: '2026-10-01', due: '2026-10-09T16:30', planned_day: '2026-10-02', planned_half: 'pm', planned_order: 30, tags: ['task'], reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT15M' }], projects: ['[[P]]'] };
  const s1 = SD(one);
  eq(s1, { status: 'someday', priority: 'high', scheduled: '2026-10-01', tags: ['task'], reminders: one.reminders, projects: ['[[P]]'] }, 'someday: one-off loses due and planned_*, keeps start, reminder entry, project');
  eq(Object.keys(s1), ['status', 'priority', 'scheduled', 'tags', 'reminders', 'projects'], 'someday: key order kept (status written in place)');
  // Repeating: only the status changes, so the repeat is untouched.
  const rep = { status: 'open', scheduled: '2026-10-07', due: '2026-09-11', recurrence: 'DTSTART:20260904;FREQ=DAILY;INTERVAL=1', planned_day: '2026-09-05', planned_half: 'am', planned_order: 10, complete_instances: ['2026-10-05', '2026-10-06'], skipped_instances: [], tags: ['task'] };
  eq(SD(rep), { ...rep, status: 'someday' }, 'someday: repeating task changes status only');
  ok(L.isSomeday({ status: 'someday' }) && !L.isSomeday({ status: 'open' }) && !L.isSomeday(null) && !L.isSomeday({}) && !L.isSomeday('someday'), 'isSomeday: status someday only');
  // Never on a day, never overdue, never in Unscheduled or Weekly goals; in the Someday group.
  const it1 = mk('A', { status: 'someday', planned_day: '2026-10-01', weekly_goal: true });
  const it2 = mk('B', { status: 'someday', due: '2026-10-01' });
  const it3 = mk('C', { ...rep, status: 'someday' });
  const it4 = mk('D', {});
  const all = [it1, it2, it3, it4];
  let anyDay = false;
  for (let i = -30; i < 400; i++) { const d = L.addDays(TODAY, i); if ([it1, it2, it3].some((x) => L.taskOnDay(x, d))) anyDay = true; }
  ok(!anyDay, 'someday: on no day for 430 days (one-off with a stale day, with a due date, repeating)');
  ok(L.taskOnDay(mk('C2', rep), TODAY), 'control: the same repeat set to open is on today');
  eq(L.overdueOf(all, TODAY, DONE).map((x) => x.title), [], 'someday: never overdue');
  eq(L.unscheduledOf(all, DONE).map((x) => x.title), ['D'], 'someday: not in Unscheduled');
  eq(L.weeklyGoalsOf(all, TODAY, DONE).map((x) => x.title), [], 'someday: not in Weekly goals');
  eq(L.somedayOf(all, DONE, PT).map((x) => x.title).sort(), ['A', 'B', 'C'], 'someday group holds the someday tasks, repeating too');
  eq(L.dueChipOf(it2, TODAY, DONE), null, 'someday: no due / overdue chip');
  for (const h of ['am', 'pm', null]) eq(L.laneOf(all, '2026-10-01', h).map((x) => x.title), [], `someday: no lane on its old day (${h})`);
  // Coming back: any move gives it a day and makes it open again.
  const back = L.applyMove(SD(one), '2026-10-12', 'am', 10);
  eq([back.status, back.planned_day, back.planned_half, back.due], ['open', '2026-10-12', 'am', undefined], 'round trip: Someday then a day = open on that day');
  eq(L.applyMove({ status: 'in-progress', due: '2026-10-01' }, '2026-10-02', null, 5).status, 'in-progress', 'a move leaves other statuses alone');
  // Today shows none of it and its "move all to today" skips it.
  const TL = T.buildTaskLists(all, TODAY, DONE);
  ok(![...TL.morning, ...TL.afternoon, ...TL.overdue].some((x) => L.isSomeday(x)), 'Today: someday tasks in no lane and not in Overdue');
  const fmOd = { status: 'someday', due: '2026-10-01' };
  eq([T.applyOverdueMove(fmOd, TODAY, 10, DONE), fmOd.due], [false, '2026-10-01'], 'Today: Move all to today skips a someday task');
  // Source: the Schedule box line and the folded group.
  ok(/'Someday'/.test(srcP) && /'no day, kept for later'/.test(srcP), 'Schedule box: "Someday · no day, kept for later"');
  ok(/confirmSomeday\(\)/.test(srcP) && /Someday takes the due date off too/.test(srcP), 'Schedule box: a task with a due date asks first');
  ok(/somedayOpen: false/.test(srcP) && /a4pl-grp is-someday/.test(srcP), 'Someday group: folded until opened');
}

/* ---- 12. Someday on a copy of the task notes (read-only; the frozen copy unless LIFEWORLD_VAULT) */
{
  const VAULT = require('./lib/paths').vault; // the owner's vault with LIFEWORLD_VAULT, else the frozen copy
  const parseFm = (text) => {
    const block = /^---\n([\s\S]*?)\n---/.exec(text); if (!block) return null;
    const fm = {}; let key = null;
    for (const line of block[1].split('\n')) {
      let m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (m) { key = m[1]; const v = m[2].trim(); fm[key] = v === '' ? null : v === '[]' ? [] : v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); continue; }
      m = /^\s+-\s+(.*)$/.exec(line);
      if (m && key) { if (!Array.isArray(fm[key])) fm[key] = []; fm[key].push(m[1].trim().replace(/^"(.*)"$/, '$1')); }
    }
    return fm;
  };
  const dir = path.join(VAULT, '02 Planner/TaskNotes/Tasks');
  const real = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => ({ name: f.replace(/\.md$/, ''), fm: parseFm(fs.readFileSync(path.join(dir, f), 'utf8')) })).filter((x) => x.fm && L.plannerItem(x.fm, `02 Planner/TaskNotes/Tasks/${x.name}.md`, x.name));
  if (require('./lib/paths').FROZEN) eq(real.length, 48, 'frozen data: all 48 tasks read'); else ok(real.length > 40, `real tasks read (${real.length})`);
  const repeats = real.filter((x) => typeof x.fm.recurrence === 'string');
  ok(repeats.length >= 2, 'real repeating tasks read');
  let fine = true; let repeatKept = true; let comesBack = true;
  for (const x of real) {
    const p = `02 Planner/TaskNotes/Tasks/${x.name}.md`;
    const before = L.plannerItem(x.fm, p, x.name);
    const fm2 = L.applySomeday(JSON.parse(JSON.stringify(x.fm)));
    const it = L.plannerItem(fm2, p, x.name);
    for (let i = -10; i < 120; i++) if (L.taskOnDay(it, L.addDays(TODAY, i))) fine = false;
    if (L.overdueOf([it], TODAY, DONE).length || L.unscheduledOf([it], DONE).length) fine = false;
    if (before.recurrenceRaw) {
      for (const k of Object.keys(x.fm)) if (k !== 'status' && JSON.stringify(x.fm[k]) !== JSON.stringify(fm2[k])) repeatKept = false;
      // Set back to open: exactly the same days as before.
      const again = L.plannerItem({ ...fm2, status: x.fm.status }, p, x.name);
      for (let i = -10; i < 400; i++) { const d = L.addDays(TODAY, i); if (L.taskOnDay(again, d) !== L.taskOnDay(before, d)) comesBack = false; }
    } else {
      const m = L.applyMove(JSON.parse(JSON.stringify(fm2)), '2026-10-12', 'pm', 10);
      const b = L.plannerItem(m, p, x.name);
      if (!(m.status === 'open' && L.taskOnDay(b, '2026-10-12') && b.plannedHalf === 'pm')) comesBack = false;
    }
  }
  ok(fine, 'real data: every task set to Someday is on no day, not overdue, not unscheduled');
  ok(repeatKept, 'real data: a repeating task set to Someday keeps rule, start, due and done days exactly');
  ok(comesBack, 'real data: every task comes back (one-off: a day makes it open; repeat: the same days as before)');
}

/* ---- Find button (mockup approved 2026-10-06) ---- */
{
  const P = part(MAIN);
  const opened = [];
  const withPj = (pj) => Object.assign(Object.create(P.prototype), { app: { plugins: { plugins: pj ? { 'a4-projects': pj } : {} } } });
  ok(withPj({ openFind: () => opened.push('find') }).openFind() === true && opened.join() === 'find', 'Find opens Projects\' Find window');
  ok(withPj(null).openFind() === false, 'Find without Projects: no error');
  const src = fs.readFileSync(SRC, 'utf8');
  const head = src.slice(src.indexOf('  renderHead(page, mode, days, today) {'), src.indexOf("    const nav = h(act, 'div', 'a4pl-nav');"));
  ok(head.indexOf("'Find')") > 0 && head.indexOf("'Find')") < head.indexOf("'a4pl-select dropdown'") && head.indexOf("'Find')") < head.indexOf('if (!this.narrow)'), 'Find button comes before the project chooser, and shows on the phone too');
  ok(/fb\.addEventListener\('click', \(\) => this\.plugin\.openFind\(\)\)/.test(head), 'Find button opens the Find window');
}

/* ---- "+project" typing in the New task box (1.4.0, mockup approved 2026-10-07) ---- */
{
  const N = ['A1 Kitchen Ideas', 'A2 Kitchen Ideas', "Rosa's Restaurant", 'ABC Northside', 'Lake Sunsets',
    'Build a Plant Map', 'Client Prospects', 'Cabin Retreat', 'Evening Drills', 'Hilltop Language Lab', 'Mill and Barn',
    'Miscellaneous', 'Personal', 'Pine Farm', 'Purple Lake Bike Hire', 'Elm Grove Day', 'Sea November US Trip'];
  const names = (q) => L.projectMatches(q, N).map((m) => m.name);
  // The mockup's lists, in its order: name starts first, then later words.
  eq(names('p'), ['Personal', 'Pine Farm', 'Purple Lake Bike Hire', 'Build a Plant Map', 'Client Prospects'], '+p: the mockup list, in order');
  eq(names('elm'), ['Elm Grove Day'], '+elm: only Elm Grove Day');
  eq(names('ELM'), ['Elm Grove Day'], 'matching ignores capitals');
  eq(names('xyz'), [], '+xyz: nothing');
  eq(names(''), [], 'a bare + lists nothing');
  eq(names('s'), ['Sea November US Trip', 'Lake Sunsets'], "+s: Sea first, then Lake Sunsets; Rosa's apostrophe is not a word start");
  eq(names('purple lake'), ['Purple Lake Bike Hire'], 'a multi-word query fits a multi-word name');
  eq(names('purple  lake'), ['Purple Lake Bike Hire'], 'extra spaces in the query are ignored');
  eq(names('lake bike'), ['Purple Lake Bike Hire'], 'a later-word query can span words');
  eq(names('ove'), [], 'no match in the middle of a word ("Grove")');
  const hit = L.projectMatches('pro', N).find((m) => m.name === 'Client Prospects');
  eq([hit.at, hit.len], [7, 3], 'the matched part is marked where it is (Client [Pro]spects)');
  eq(L.PROJECT_HITS_MAX, 8, 'the list shows at most 8');
  // The token at the caret.
  const T = 'call Max friday 3pm +elm';
  eq(L.projectToken(T, T.length, N), { start: 20, end: 24, query: 'elm' }, 'token: "+elm" at the end');
  eq(L.projectToken(T, undefined, N), { start: 20, end: 24, query: 'elm' }, 'token: no caret given = the end');
  eq(L.projectToken('+elm', 4, N), { start: 0, end: 4, query: 'elm' }, 'token: "+" at the start of the box');
  eq(L.projectToken('call +', 6, N), null, 'token: a bare "+" opens nothing');
  eq(L.projectToken('2+2', 3, N), null, 'token: "+" inside a word is not a project ("2+2")');
  eq(L.projectToken('C++ notes', 3, N), null, 'token: "C++" is not a project');
  eq(L.projectToken('call + elm', 10, N), null, 'token: "+ elm" (space after +) is not a project');
  eq(L.projectToken('x +purple lake', 14, N), { start: 2, end: 14, query: 'purple lake' }, 'token: spaces allowed while the name still fits');
  eq(L.projectToken('x +elm call', 11, N), null, 'token: a following word that breaks the fit ends it');
  eq(L.projectToken('x +elm call', 6, N), { start: 2, end: 6, query: 'elm' }, 'token: caret back on the "+elm" word');
  eq(L.projectToken('x +elmxx y', 5, N), { start: 2, end: 8, query: 'el' }, 'token: caret mid-word; the pick takes the whole word');
  eq(L.projectToken('call Max', 8, N), null, 'token: no "+" at all');
  eq(L.projectToken('+elm call +', 11, N), null, 'token: the nearest "+" counts, bare = nothing');
  // A pick takes the "+text" out of the name.
  const pk = (t, c) => L.pickProjectText(t, L.projectToken(t, c, N));
  eq(pk(T), { text: 'call Max friday 3pm ', caret: 20 }, 'pick at the end: "+elm" gone, caret ready for more');
  eq(pk('call +elm friday', 9), { text: 'call friday', caret: 5 }, 'pick in the middle: one space left');
  eq(pk('+elm call', 4), { text: 'call', caret: 0 }, 'pick at the start: no leading space');
  eq(pk('x +purple lake tomorrow', 14), { text: 'x tomorrow', caret: 2 }, 'pick of a multi-word query removes all of it');
  eq(pk('x +elmxx y', 5), { text: 'x y', caret: 2 }, 'pick mid-word removes the whole word');
  // After the pick, the shared parser still reads the rest exactly as before.
  const D = '2026-10-07';
  const after = L.understand(pk(T).text + '!high', D);
  const plain = L.understand('call Max friday 3pm !high', D);
  eq(after, plain, 'after a pick: the date, time and priority read exactly as without the "+elm"');
  eq(L.quickAddChips(after, D, 'Elm Grove Day', 'normal'), ['Call Max', 'Elm Grove Day', 'Due Fri, Oct 9, 3:00 PM', 'High'], 'the orange line after the pick (mockup state 4)');
  // No match: stays in the name, quietly noted.
  eq(L.unmatchedProjectWords('call Max friday 3pm +xyz', N), ['+xyz'], 'no match: "+xyz" is noted');
  eq(L.understand('call Max friday 3pm +xyz', D).title, 'Call Max +xyz', 'no match: "+xyz" stays in the name (mockup state 5)');
  eq(L.unmatchedProjectWords('call +elm +purple', N), [], 'matching "+words" are not noted');
  eq(L.unmatchedProjectWords('2+2 is c++', N), [], '"+" inside words is not noted');
  eq(L.unmatchedProjectWords('', N), [], 'empty box: nothing noted');
  // The box: Enter picks while the list is open, else saves as before.
  const src = fs.readFileSync(SRC, 'utf8');
  const qa = src.slice(src.indexOf('  renderQuickAdd(side) {'), src.indexOf('  renderAgenda('));
  const kd = qa.slice(qa.indexOf("inp.addEventListener('keydown'"));
  ok(kd.indexOf('if (shown) {') > 0 && kd.indexOf('if (shown) {') < kd.indexOf("if (e.key !== 'Enter' || !inp.value.trim()) return;"), 'Enter with the list open picks before the save code runs');
  ok(/if \(e\.key === 'Enter' \|\| \(e\.key === 'Tab' && !e\.shiftKey\)\) \{ e\.preventDefault\(\); pick\(shown\.hits\[sel\]\.name\); return; \}/.test(kd), 'Enter and Tab pick, and stop there');
  ok(/this\.plugin\.createTyped\(text, ps\.value \|\| null, this\.items, this\.today\(\)\)/.test(kd), 'save still goes through createTyped with the dropdown project');
  ok(/const names = this\.plugin\.projectNames\(this\.items\);/.test(qa) && /\.\.\.names\.map\(\(p\) => \[p, p\]\)/.test(qa), 'the list and the dropdown use the same project names');
  ok(qa.includes("repeats (every monday), priority (") && qa.includes("'!high'") && qa.includes("'!low'") && qa.includes(") and projects (") && qa.includes("'+Project Name'"), 'the help line shows how to type a repeat, a priority and a project');
  ok(!/\u2014/.test(qa.slice(qa.indexOf("'a4pl-hint', 'Dates"), qa.indexOf('are picked up as you type'))), 'the help line has no em dash');
  ok(L.understand('x !high', '2026-10-07').priority === 'high' && L.understand('x !low', '2026-10-07').priority === 'low' && !!L.understand('x every monday', '2026-10-07').recurrence, 'the help line examples are real syntax the parser accepts');
  ok(/b\.addEventListener\('mousedown', \(e\) => e\.preventDefault\(\)\)/.test(qa), 'clicking a project keeps the focus in the box');
  const shared = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'quickadd.js'), 'utf8'); // updated in section 6: the shared block is the core file
  ok(shared.length > 5000, 'the shared quick add block is there to check');
  ok(!/project(Matches|Token)|pickProjectText/.test(shared), 'the +project code is outside the shared quick add block');
}

/* ---- One fold/open-all icon button over Unscheduled (1.4.2, go-ahead 2026-10-07) ---- */
{
  const G = [{ key: 'A' }, { key: 'B' }, { key: '' }];
  const F = L.allUnscheduledFolded;
  eq(F(G, {}, false, false), false, 'nothing folded: the button folds all');
  eq(F(G, { A: true }, false, false), false, 'some folded: the button still folds all (like the file explorer)');
  eq(F(G, { A: true, B: true, '§none': true }, false, false), true, 'all folded: the button opens all');
  eq(F(G, { A: true, B: true }, false, false), false, '"No project" open counts as not all folded');
  eq(F(G, { A: true, B: true, '§none': true }, true, true), false, 'all groups folded but Someday open: the button folds all');
  eq(F(G, { A: true, B: true, '§none': true }, true, false), true, 'a leftover "Someday open" with no Someday tasks is ignored');
  eq(F([], {}, false, false), false, 'no groups: the button folds (does nothing harmful)');
  eq(F(G, undefined, false, false), false, 'no saved folds yet: no error');
  const src = fs.readFileSync(SRC, 'utf8');
  const side = src.slice(src.indexOf('  renderSide(side, days, today) {'), src.indexOf('  renderSection('));
  ok(!/'Fold all'\); fa|'Open all'\); oa|a4pl-link/.test(side), 'the two text buttons are gone');
  ok(/setIcon\(fb, folded \? 'chevrons-up-down' : 'chevrons-down-up'\)/.test(side), "the file explorer's icons: down-up folds, up-down opens");
  ok(/fb\.setAttr\('aria-label', folded \? 'Open all' : 'Fold all'\)/.test(side), 'the tooltip says what the click will do');
  ok(/fb\.addEventListener\('click', \(\) => this\.setAll\(!folded\)\)/.test(side), 'one click folds all, or opens all when all are folded');
  ok(side.indexOf('a4pl-fold-all') > side.indexOf("'a4pl-count', String(unscheduledOf"), 'the button sits after the count, at the right end');
  const css = fs.readFileSync(STYLES, 'utf8');
  ok(/\.a4pl-uns-title \{[^}]*flex-wrap: nowrap/.test(css), 'the Unscheduled header stays on one line');
  const fcss = (/\.a4pl-fold-all \{([^}]*)\}/.exec(css) || [])[1] || '';
  ok(fcss && !/#[0-9a-f]{3,6}\b|rgb/i.test(fcss), 'the button uses theme colours only');
}

console.log(`RESULT ${n} ${failed}`);
