#!/usr/bin/env node
/* Logic tests for the Today plugin.
 * No Obsidian and no dependencies: `node tests/test-today.js`.
 * The whole suite re-runs itself under several time zones (midnight and
 * daylight-saving edges). Optional: RRULE_JS=<path to the rrule package>
 * adds a cross-check of the recurrence engine against the rrule library
 * (the one TaskNotes bundles) over two years of days for many rules.
 * Moved from the owner's vault: behaviour checks load Today from the built main.js,
 * text checks read src/today/main.js (tests/lib/paths.js). */
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const { part, STYLES, source } = require('./lib/paths');
const MAIN = 'a4-today';
const SRC = source('a4-today');
const ZONES = ['America/Regina', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'America/New_York', 'Australia/Lord_Howe'];

if (!process.env.LWT_CHILD) {
  let fails = 0; let total = 0;
  for (const tz of ZONES) {
    try {
      const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, LWT_CHILD: '1' }, encoding: 'utf8', timeout: 60000 });
      const m = /RESULT (\d+) (\d+)/.exec(out);
      total += Number(m[1]); fails += Number(m[2]);
      console.log(`${tz.padEnd(22)} ${m[1]} checks, ${m[2]} failed`);
    } catch (e) {
      fails++;
      console.log(`${tz.padEnd(22)} FAILED\n${(e.stdout || '') + (e.stderr || '')}`);
    }
  }
  console.log(`\nTOTAL ${total} checks, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

/* ---- minimal obsidian stand-in ------------------------------------------- */
class TFile { constructor(p) { this.path = p; this.basename = p.split('/').pop().replace(/\.md$/, ''); this.extension = 'md'; } }
class TFolder {}
const notices = [];
const fakeObsidian = { Plugin: class {}, ItemView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const Plugin = part(MAIN);
const L = Plugin.logic;

let n = 0; let failed = 0;
const tz = process.env.TZ;
function ok(cond, name, extra) { n++; if (!cond) { failed++; console.log(`FAIL [${tz}] ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- recurrence ----------------------------------------------------------- */
const R = (s, start) => L.parseRRule(s, start);
const days = (rule, from, to) => { const out = []; for (let d = from; d <= to; d = L.addDays(d, 1)) if (L.occursOn(rule, d)) out.push(d); return out; };

// Three real-world rules
const mood = R('DTSTART:20260905;FREQ=DAILY;INTERVAL=2');
ok(L.occursOn(mood, '2026-10-03'), 'every-2-days rule lands on 10-03');
ok(!L.occursOn(mood, '2026-10-04'), 'every-2-days rule skips 10-04');
const recon = R('DTSTART:20260904;FREQ=DAILY;INTERVAL=1');
ok(L.occursOn(recon, '2026-10-03') && !L.occursOn(recon, '2026-09-03'), 'daily rule from its start only');
const fleeting = R('DTSTART:20260904;FREQ=WEEKLY;INTERVAL=1');
eq(days(fleeting, '2026-09-01', '2026-09-30'), ['2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25'], 'weekly with no BYDAY uses the start weekday (Fri)');

eq(days(R('DTSTART:20260901;FREQ=WEEKLY;BYDAY=MO,WE,FR'), '2026-09-01', '2026-09-09'), ['2026-09-02', '2026-09-04', '2026-09-07', '2026-09-09'], 'weekly BYDAY');
eq(days(R('DTSTART:20260907;FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH'), '2026-09-07', '2026-09-30'), ['2026-09-07', '2026-09-10', '2026-09-21', '2026-09-24'], 'every other week');
eq(days(R('DTSTART:20260131;FREQ=MONTHLY'), '2026-01-01', '2026-07-31'), ['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31'], 'monthly on the 31st skips short months');
eq(days(R('DTSTART:20260101;FREQ=MONTHLY;BYDAY=2TU'), '2026-01-01', '2026-03-31'), ['2026-01-13', '2026-02-10', '2026-03-10'], 'second Tuesday');
eq(days(R('DTSTART:20260101;FREQ=MONTHLY;BYDAY=-1FR'), '2026-01-01', '2026-03-31'), ['2026-01-30', '2026-02-27', '2026-03-27'], 'last Friday');
eq(days(R('DTSTART:20260101;FREQ=MONTHLY;BYMONTHDAY=-1'), '2026-01-01', '2026-03-31'), ['2026-01-31', '2026-02-28', '2026-03-31'], 'last day of month');
eq(days(R('DTSTART:20260101;FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1'), '2026-01-01', '2026-05-31'), ['2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29'], 'last weekday of month');
eq(days(R('DTSTART:20240229;FREQ=YEARLY'), '2024-01-01', '2028-12-31'), ['2024-02-29', '2028-02-29'], 'yearly on Feb 29');
eq(days(R('DTSTART:20261001;FREQ=DAILY;COUNT=3'), '2026-09-30', '2026-10-10'), ['2026-10-01', '2026-10-02', '2026-10-03'], 'COUNT');
eq(days(R('DTSTART:20261001;FREQ=DAILY;UNTIL=20261003T235959Z'), '2026-09-30', '2026-10-10'), ['2026-10-01', '2026-10-02', '2026-10-03'], 'UNTIL');
eq(days(R('DTSTART:20261001\nRRULE:FREQ=DAILY\nEXDATE:20261002'), '2026-10-01', '2026-10-03'), ['2026-10-01', '2026-10-03'], 'EXDATE');
eq(days(R('DTSTART;TZID=America/New_York:20261030T090000\nRRULE:FREQ=DAILY'), '2026-10-30', '2026-11-03'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'], 'DTSTART with TZID, across US DST end');
eq(days(R('DTSTART:20260306;FREQ=DAILY;INTERVAL=1'), '2026-03-06', '2026-03-10'), ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'], 'daily across US DST start');
eq(days(R('DTSTART:20261003;FREQ=DAILY;INTERVAL=7'), '2026-10-03', '2026-11-07'), ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07'], 'every 7 days across DST');
eq(days(R('FREQ=WEEKLY;BYDAY=SA', '2026-09-05'), '2026-09-01', '2026-09-20'), ['2026-09-05', '2026-09-12', '2026-09-19'], 'no DTSTART falls back to scheduled');
ok(R('FREQ=HOURLY', '2026-09-05') === null, 'unknown frequency is refused');
ok(R('garbage') === null, 'garbage is refused');
ok(!L.occursOn(null, '2026-10-03'), 'unreadable rule never shows');

// Optional cross-check against the rrule library
if (process.env.RRULE_JS) {
  const { RRule } = require(process.env.RRULE_JS);
  const rules = [
    'FREQ=DAILY', 'FREQ=DAILY;INTERVAL=3', 'FREQ=WEEKLY', 'FREQ=WEEKLY;INTERVAL=2', 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    'FREQ=WEEKLY;INTERVAL=3;BYDAY=TU,SU', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA;WKST=SU', 'FREQ=MONTHLY', 'FREQ=MONTHLY;INTERVAL=2',
    'FREQ=MONTHLY;BYMONTHDAY=1,15', 'FREQ=MONTHLY;BYMONTHDAY=-1', 'FREQ=MONTHLY;BYDAY=1MO', 'FREQ=MONTHLY;BYDAY=-1SU',
    'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', 'FREQ=MONTHLY;BYDAY=TH', 'FREQ=YEARLY', 'FREQ=YEARLY;BYMONTH=3,9;BYMONTHDAY=10',
    'FREQ=DAILY;COUNT=17', 'FREQ=WEEKLY;BYDAY=TU,TH;COUNT=9', 'FREQ=DAILY;UNTIL=20270115', 'FREQ=DAILY;BYDAY=MO,FR',
    'FREQ=MONTHLY;BYMONTHDAY=31', 'FREQ=YEARLY;BYMONTH=2;BYDAY=-1MO',
  ];
  const starts = ['20260131', '20260904', '20261003', '20250228', '20260229'.replace('0229', '0301')];
  let compared = 0;
  for (const r of rules) {
    for (const s of starts) {
      const mine = days(R(`DTSTART:${s};${r}`), '2025-01-01', '2027-12-31');
      const rr = RRule.fromString(`DTSTART:${s}T000000Z\nRRULE:${r}`);
      const theirs = rr.between(new Date(Date.UTC(2025, 0, 1)), new Date(Date.UTC(2027, 11, 31)), true).map((d) => d.toISOString().slice(0, 10));
      compared++;
      eq(mine, theirs, `rrule cross-check ${s} ${r}`);
    }
  }
  console.log(`rrule cross-check: ${compared} rule/start pairs over 3 years`);
}

/* ---- tasks ---------------------------------------------------------------- */
const T = (fm, name) => L.taskFromFrontmatter(fm, `02 Planner/TaskNotes/Tasks/${name}.md`, name);
ok(T({ tags: ['note'] }, 'x') === null, 'non-task ignored');
ok(T({ tags: ['task'], archived: true }, 'x') === null, 'archived ignored');
ok(T({ tags: ['task', 'archived'] }, 'x') === null, 'archived tag ignored');
ok(L.taskFromFrontmatter({ tags: ['task'] }, '02 Planner/TaskNotes/Archive/x.md', 'x') === null, 'archive folder ignored');
eq(T({ tags: ['task'], due: '2026-10-05', planned_day: '2026-10-03' }, 'x').plannedDay, '2026-10-05', 'due wins over planned_day');
eq(T({ tags: ['task'], planned_day: '2026-10-03' }, 'x').plannedDay, '2026-10-03', 'planned_day places an undated task');
eq(T({ tags: ['task'], due: '2026-10-03T14:00' }, 'x').due, '2026-10-03', 'due with a time');
eq(T({ tags: 'task', projects: '[[04 Library/My Life/Projects/Bake Sale|PF]]' }, 'x').project, 'PF', 'single tag string and project alias');
eq(T({ tags: ['task'], projects: ['[[04 Library/My Life/Projects/Bake Sale]]'] }, 'x').project, 'Bake Sale', 'project basename');

const today = '2026-10-03';
const items = [
  T({ tags: ['task'], due: today, planned_half: 'am', planned_order: 20 }, 'b-am20'),
  T({ tags: ['task'], due: today, planned_half: 'am', planned_order: 10 }, 'a-am10'),
  T({ tags: ['task'], planned_day: today, planned_order: 5 }, 'no-half'),
  T({ tags: ['task'], due: today, planned_half: 'pm', planned_order: 1 }, 'pm1'),
  T({ tags: ['task'], due: today, planned_half: 'pm', status: 'done', planned_order: 2 }, 'pm-done'),
  T({ tags: ['task'], recurrence: 'DTSTART:20260905;FREQ=DAILY;INTERVAL=2', planned_half: 'am', planned_order: -20, due: '2026-09-07', complete_instances: ['2026-10-01'] }, 'rec-today'),
  T({ tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=WEEKLY', planned_half: 'pm', due: today }, 'rec-not-today'),
  T({ tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=DAILY', skipped_instances: [today] }, 'rec-skipped'),
  T({ tags: ['task'], due: '2026-10-05', planned_day: today }, 'future-due'),
];
for (let i = 1; i <= 12; i++) items.push(T({ tags: ['task'], due: L.addDays(today, -i), planned_order: i % 3 }, `od${String(i).padStart(2, '0')}`));
items.push(T({ tags: ['task'], due: '2026-09-01', status: 'done' }, 'od-done'));
items.push(T({ tags: ['task'], due: '2026-09-01', status: 'closed' }, 'od-closed'));
items.push(T({ tags: ['task'], due: '2026-09-01', status: 'in-progress' }, 'od-prog'));
const lists = L.buildTaskLists(items, today, ['done', 'closed']);
eq(lists.morning.map((t) => t.title), ['rec-today', 'no-half', 'a-am10', 'b-am20'], 'morning: planned order, no-half counts as morning');
eq(lists.afternoon.map((t) => t.title), ['pm1', 'pm-done'], 'afternoon: planned order, done stays visible');
eq(lists.overdue.length, 13, 'overdue: all 13, no cap');
eq(lists.overdue[0].title, 'od01', 'overdue newest first');
ok(!lists.overdue.some((t) => /done|closed|rec/.test(t.title)), 'overdue excludes done, closed and repeating');
eq(lists.total, 6, 'today total');
eq(lists.open, 5, 'open count (pm-done excluded)');
ok(!lists.morning.concat(lists.afternoon).some((t) => t.title === 'rec-skipped'), 'skipped occurrence hidden');
ok(!L.isTaskDone(items[5], today) && L.isTaskDone(items[5], '2026-10-01'), 'repeating done is per day');
eq(L.plateText(5, 6), '5 things on your plate today', 'plate text');
eq(L.plateText(1, 1), '1 thing on your plate today', 'plate singular');
eq(L.plateText(0, 3), 'all done, nice work', 'plate all done');
eq(L.plateText(0, 0), 'a clear day ahead', 'plate empty');

/* ---- midnight and time zones ---------------------------------------------- */
const before = new Date(2026, 9, 3, 23, 59, 59);
const after = new Date(2026, 9, 4, 0, 0, 0);
eq(L.dayOf(before), '2026-10-03', 'local day just before midnight');
eq(L.dayOf(after), '2026-10-04', 'local day at midnight');
const dueToday = [T({ tags: ['task'], due: '2026-10-03', planned_half: 'pm' }, 'due-3rd')];
eq(L.buildTaskLists(dueToday, L.dayOf(before)).afternoon.length, 1, 'due task is today at 23:59:59');
eq(L.buildTaskLists(dueToday, L.dayOf(after)).overdue.length, 1, 'same task is overdue at 00:00');
const daily = [T({ tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=DAILY', complete_instances: ['2026-10-03'] }, 'daily')];
eq(L.buildTaskLists(daily, L.dayOf(before)).open, 0, 'repeating ticked today: done at 23:59');
eq(L.buildTaskLists(daily, L.dayOf(after)).open, 1, 'repeating is open again after midnight');
eq(L.scratchPathFor(before), '00 Daily Notes/10-03-2026.md', 'scratchpad path before midnight');
eq(L.scratchPathFor(after), '00 Daily Notes/10-04-2026.md', 'scratchpad path after midnight');
eq(L.captureLine(new Date(2026, 9, 3, 7, 5), 'hi'), '- 07:05  hi', 'capture line uses local time');
eq(L.toDayStr(new Date(2026, 0, 1, 0, 0, 0)), '2026-01-01', 'Date object -> local day');
eq(L.addDays('2026-12-31', 1), '2027-01-01', 'year rollover');
eq(L.addDays('2026-03-08', 1), '2026-03-09', 'addDays across DST start');
eq(L.addDays('2026-11-01', 1), '2026-11-02', 'addDays across DST end');
eq(L.daysBetween('2026-03-01', '2026-04-01'), 31, 'daysBetween across DST');
const w = L.weatherAge('2026-10-03T12:24:42+00:00', new Date(Date.UTC(2026, 9, 3, 12, 36, 42)));
eq([w.label, w.stale], ['updated 12 min ago', false], 'weather age in any zone');
eq(L.weatherAge('2026-10-03T12:24:42+00:00', new Date(Date.UTC(2026, 9, 3, 14, 25, 0))).stale, true, 'stale after 2 hours');
eq(L.weatherAge('nonsense', new Date()).stale, true, 'unknown update time counts as stale');
eq(L.greeting(new Date(2026, 9, 3, 8).getHours()), 'Good morning', 'greeting morning');
eq(L.greeting(17), 'Good evening', 'greeting evening');

/* ---- moves (must equal the Daily Planner's assignItem/orderForInsert) ---- */
{
  // The old Daily Planner's own code (a4-daily-planner/main.js, orderForInsert
  // and assignItem), pinned here 2026-10-05 when that plugin was retired.
  const plannerOrder = (orders, idx) => {
    if (!orders.length) return 10;
    if (idx <= 0) return orders[0] - 10;
    if (idx >= orders.length) return orders[orders.length - 1] + 10;
    return (orders[idx - 1] + orders[idx]) / 2;
  };
  const plannerAssign = (fm, day, half, order) => {
    if (fm.due) fm.due = day;
    else fm.planned_day = day;
    fm.planned_half = half;
    fm.planned_order = order;
    return fm;
  };
  for (const [orders, idx] of [[[], 0], [[10], 0], [[10], 1], [[-30, -20, 10], 1], [[-30, -20, 10], 3], [[5, 5], 1], [[0, 1.5, 2], 2]]) {
    eq(L.orderForInsert(orders, idx), plannerOrder(orders, idx), `order matches the Planner ${JSON.stringify(orders)}@${idx}`);
  }
  const cases = [
    [{ tags: ['task'], due: '2026-09-30', planned_half: null }, today, 'am', 15],
    [{ tags: ['task'], planned_day: today, planned_half: 'am', planned_order: 3 }, today, 'pm', 20],
    [{ tags: ['task'], due: today, planned_half: 'pm' }, L.addDays(today, 1), 'am', 10],
    [{ tags: ['task'] }, L.addDays(today, 1), 'pm', 10],
    [{ tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=DAILY', planned_half: 'am' }, today, 'pm', 5],
  ];
  for (const [fm, d, h, o] of cases) {
    eq(L.applyMove(JSON.parse(JSON.stringify(fm)), d, h, o), plannerAssign(JSON.parse(JSON.stringify(fm)), d, h, o), `move writes the same fields as the Planner ${JSON.stringify(fm)} -> ${d} ${h}`);
  }
  const moved = L.applyMove({ tags: ['task'], due: '2026-09-30' }, today, 'pm', 10);
  const it = L.taskFromFrontmatter(moved, 'x.md', 'x');
  ok(L.buildTaskLists([it], today).afternoon.length === 1 && L.buildTaskLists([it], today).overdue.length === 0, 'overdue task dropped in Afternoon leaves Overdue and lands in Afternoon');

  // Snap-back (1.2.1): a drop must land exactly where it was dropped, after
  // the lane is rebuilt from the written frontmatter. Lanes shaped like a real
  // live Morning on 2026-10-05: two placed repeats, then tasks never placed
  // (order missing = 0), then placed ones. Every task to every slot.
  const lanes = [
    [-30, -20, null, null, null, null, null, null, null, null, 10, 20],
    [null, null, null], [5, 5, 5, 6], [0, 10, 20, 30], [1, 1.0000001, null, 7],
  ];
  let landed = 0; let tried = 0;
  for (const shape of lanes) {
    const fms = shape.map((o, i) => ({ tags: ['task'], due: today, ...(o == null ? {} : { planned_half: 'am', planned_order: o }), _n: `t${String(i).padStart(2, '0')}` }));
    for (let from = 0; from < fms.length; from++) {
      for (let to = 0; to < fms.length; to++) {
        const items = fms.map((fm) => L.taskFromFrontmatter(JSON.parse(JSON.stringify(fm)), `T/${fm._n}.md`, fm._n));
        const shown = L.buildTaskLists(items, today).morning;
        const moving = shown[from];
        const others = shown.filter((x) => x !== moving);
        const plan = L.planInsert(others.map((x) => x.plannedOrder), to);
        // write exactly what moveTask writes
        const out = new Map(fms.map((fm) => [`T/${fm._n}.md`, JSON.parse(JSON.stringify(fm))]));
        L.applyMove(out.get(moving.path), today, 'am', plan.order);
        if (plan.others) others.forEach((x, k) => { if (x.plannedOrder !== plan.others[k]) out.get(x.path).planned_order = plan.others[k]; });
        const after = L.buildTaskLists([...out].map(([p, fm]) => L.taskFromFrontmatter(fm, p, fm._n)), today).morning.map((x) => x.path);
        const want = others.map((x) => x.path); want.splice(to, 0, moving.path);
        tried++;
        if (JSON.stringify(after) === JSON.stringify(want)) landed++;
        else ok(false, `drop lands where dropped: ${JSON.stringify(shape)} ${from} -> ${to}, got ${JSON.stringify(after)}`);
      }
    }
  }
  ok(landed === tried, `every drop lands where dropped and the rest keep their order (${landed}/${tried})`);
  eq(L.planInsert([10, 20], 1), { order: 15, others: null }, 'room between neighbours: one write, Planner midpoint');
  eq(L.planInsert([0, 0, 0], 1), { order: 20, others: [10, 30, 40] }, 'tie between neighbours: lane renumbered');
}

/* ---- "Move all N to today" on the Overdue card (1.2.3, mockup option A) ---- */
{
  const day = '2026-10-05';
  // The approved mockup's own example, as drawn.
  const fms = {
    'T/review.md': { tags: ['task'], due: day, planned_half: 'am', planned_order: 10, projects: ['[[Garden Plan]]'] },
    'T/water.md': { tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=DAILY', scheduled: '2026-09-04', planned_half: 'am', planned_order: 20 },
    'T/gym.md': { tags: ['task'], due: day, planned_half: 'pm', planned_order: 10 },
    'T/car.md': { tags: ['task'], due: '2026-10-03', priority: 'high' },
    'T/internet.md': { tags: ['task'], due: '2026-10-02', planned_half: 'am', planned_order: 0 },
    'T/bake.md': { tags: ['task'], due: '2026-09-30', planned_half: 'pm', planned_order: 5 },
    'T/dentist.md': { tags: ['task'], due: '2026-09-29T09:30', planned_order: 40 },
    'T/planned-undated.md': { tags: ['task'], planned_day: '2026-10-01', planned_half: 'pm' }, // no due: its planned day counts (2026-10-18)
    // never on the card, so never moved:
    'T/rep-old.md': { tags: ['task'], recurrence: 'DTSTART:20260901;FREQ=WEEKLY', due: '2026-09-01' },
    'T/done-old.md': { tags: ['task'], due: '2026-09-28', status: 'done' },
  };
  const load = (m) => Object.entries(m).map(([p, fm]) => L.taskFromFrontmatter(fm, p, p.slice(2, -3)));
  const lists0 = L.buildTaskLists(load(fms), day);
  eq(lists0.overdue.map((t) => t.path), ['T/car.md', 'T/internet.md', 'T/planned-undated.md', 'T/bake.md', 'T/dentist.md'], 'card lists the five overdue (one undated, by its planned day), newest first');
  const plan = L.planOverdueMove(lists0);
  eq(plan, [
    { path: 'T/dentist.md', lane: 'am', order: 30 },
    { path: 'T/bake.md', lane: 'pm', order: 20 },
    { path: 'T/planned-undated.md', lane: 'pm', order: 30 },
    { path: 'T/internet.md', lane: 'am', order: 40 },
    { path: 'T/car.md', lane: 'am', order: 50 },
  ], 'plan: oldest first, afternoon stays afternoon, the rest to the bottom of Morning');
  const out = JSON.parse(JSON.stringify(fms));
  for (const s of plan) ok(L.applyOverdueMove(out[s.path], day, s.order), `move writes ${s.path}`);
  const lists1 = L.buildTaskLists(load(out), day);
  eq(lists1.overdue.length, 0, 'after the move nothing is overdue');
  // Task times (1.2.5): a timed task sits first in its lane, in clock order
  // (dentist is due at 9:30 AM); the untimed moved ones go to the bottom, oldest first.
  eq(lists1.morning.map((t) => t.path), ['T/dentist.md', 'T/review.md', 'T/water.md', 'T/internet.md', 'T/car.md'], 'Morning as in the mockup (moved at the bottom, oldest first; timed first)');
  eq(lists1.afternoon.map((t) => t.path), ['T/gym.md', 'T/bake.md', 'T/planned-undated.md'], 'Afternoon as in the mockup, plus the undated one');
  eq(out['T/planned-undated.md'], { tags: ['task'], planned_day: day, planned_half: 'pm', planned_order: 30 }, 'undated: planned day moves to today, no due added');
  eq(out['T/dentist.md'].due, '2026-10-05T09:30', 'a time on the due date is kept');
  eq(out['T/car.md'], { tags: ['task'], due: day, priority: 'high', planned_order: 50 }, 'no half stays no half (Planner: Any time); only due + order written');
  eq(out['T/bake.md'].planned_half, 'pm', 'afternoon half kept');
  for (const p of ['T/rep-old.md', 'T/done-old.md', 'T/review.md', 'T/water.md', 'T/gym.md']) eq(out[p], fms[p], `untouched: ${p}`);
  // Guards at write time
  eq(L.applyOverdueMove({ tags: ['task'], recurrence: 'FREQ=DAILY', due: '2026-09-01' }, day, 10), false, 'repeating task is never written');
  eq(L.applyOverdueMove({ tags: ['task'], due: day }, day, 10), false, 'no longer overdue: not written');
  eq(L.applyOverdueMove({ tags: ['task'], due: '2026-09-01', status: 'done' }, day, 10), false, 'done meanwhile: not written');
  eq(L.applyOverdueMove({ tags: ['task'], planned_day: '2026-09-01' }, day, 10), true, 'undated task on a past planned day is the card\'s');
  eq(L.applyOverdueMove({ tags: ['task'], planned_day: day }, day, 10), false, 'undated, planned today: not written');
  eq(L.applyOverdueMove({ tags: ['task'], due: '2026-10-09', planned_day: '2026-09-01' }, day, 10), false, 'due wins over an old planned day: not written');
  eq(L.planOverdueMove({ morning: [], afternoon: [], overdue: [{ path: 'r', recurrenceRaw: 'FREQ=DAILY', due: '2026-09-01', plannedOrder: 0 }] }), [], 'plan never includes a repeating task');
  // Empty card: nothing to plan.
  eq(L.planOverdueMove(L.buildTaskLists(load({ 'T/a.md': fms['T/review.md'] }), day)), [], 'empty state: nothing overdue, empty plan');
  // Empty lanes start at 10; ties (unplaced 0s) still land below every task.
  eq(L.planOverdueMove({ morning: [], afternoon: [], overdue: [{ path: 'a', due: '2026-09-01', plannedDay: '2026-09-01', plannedOrder: 0 }, { path: 'b', due: '2026-09-02', plannedDay: '2026-09-02', plannedOrder: 0 }] }).map((s) => s.order), [10, 20], 'empty lane: 10, 20');
  eq(L.planOverdueMove({ morning: [{ plannedOrder: 0 }, { plannedOrder: 0 }], afternoon: [], overdue: [{ path: 'a', due: '2026-09-01', plannedDay: '2026-09-01', plannedOrder: 0 }] })[0].order, 10, 'lane of unplaced tasks: moved one sorts after them');
  // dueOnDay keeps whatever follows the day
  eq(L.dueOnDay('2026-09-29', day), day, 'bare date');
  eq(L.dueOnDay('2026-09-29T14:00:00-06:00', day), '2026-10-05T14:00:00-06:00', 'date-time with zone keeps time and zone');
  eq(L.dueOnDay('2026-09-29 14:00', day), '2026-10-05 14:00', 'space-separated time kept');
}

/* ---- color scheme ids (as Obsidian's Settings > Appearance uses them) ---- */
eq(L.SCHEMES.map((x) => [x.id, x.label, x.icon]), [['moonstone', 'Light', 'sun'], ['obsidian', 'Dark', 'moon'], ['system', 'System', 'monitor']], 'scheme ids, labels, icons');
ok(L.schemeOf('nonsense') === null, 'unknown scheme value is not guessed');

/* ---- look: accent colour and handwriting font ------------------------------ */
eq(L.normalizeLook(undefined), { accent: 'blue', font: 'caveat' }, 'no saved look = public default Ink blue + Caveat');
eq(L.normalizeLook({ accent: 'nope', font: 'kalam' }), { accent: 'blue', font: 'kalam' }, 'unknown accent falls back to Ink blue, valid font kept');
eq(L.normalizeLook({ accent: 'orange', font: 'caveat' }), { accent: 'orange', font: 'caveat' }, 'a saved Orange + Caveat is kept');
{
  // Any-theme defaults (mockup-today-any-theme, approved 2026-10-07): every token
  // still reads the theme's --ink-* variable first, so a page on such a theme is unchanged.
  const fs = require('fs');
  const css = fs.readFileSync(STYLES, 'utf8');
  const blocks = [...css.matchAll(/\.a4t-capture-modal \{([^}]*)\}/g)].map((m) => m[1]);
  ok(blocks.length === 2, 'two token blocks (base + dark)', String(blocks.length));
  for (const blk of blocks) for (const m of blk.matchAll(/(--a4t-[\w-]+):\s*([^;]+);/g)) {
    if (m[1] === '--a4t-f-hand') continue;
    ok(/^var\(--ink(-[\w-]+)?,/.test(m[2].trim()), `${m[1]} reads its --ink-* theme variable first`, m[2]);
  }
  ok(!/--text-faint/.test(blocks.join('')), 'faint text no longer uses the too-pale Obsidian faint colour');
  ok(/--a4t-marker: var\(--ink-marker, var\(--a4t-acc/.test(css), 'ticks and buttons follow the chosen accent when the theme sets no --ink-marker');
  const tok = (blk, k) => (blk.match(new RegExp(k + ':\\s*var\\(--ink[\\w-]*,\\s*(#[0-9a-f]{6})\\)')) || [])[1];
  // indigo colours only the project icons (graphics: 3:1); the others colour text (4.5:1)
  for (const [k, need] of [['--a4t-warning', 4.5], ['--a4t-cyan', 4.5], ['--a4t-yellow', 4.5], ['--a4t-indigo', 3]]) {
    const lt = tok(blocks[0], k), dk = tok(blocks[1], k);
    ok(lt && L.contrastRatio(lt, '#ffffff') >= need && L.contrastRatio(lt, '#f6f6f6') >= need, `${k} light fallback reads on light pages`, lt);
    ok(dk && L.contrastRatio(dk, '#1e1e1e') >= need && L.contrastRatio(dk, '#262626') >= need, `${k} dark fallback reads on dark pages`, dk);
  }
  for (const a of L.ACCENTS.filter((x) => x.light)) {
    ok(L.contrastRatio(a.light, '#ffffff') >= 4.5, `${a.name}: white text on the light accent button`);
    ok(L.contrastRatio(a.dark, '#10131a') >= 4.5, `${a.name}: dark text on the dark accent button`);
  }
}
eq(L.ACCENTS.map((a) => a.id), ['orange', 'accent', 'blue', 'green', 'plum', 'amber'], 'accent choices in order');
eq(L.HAND_FONTS.map((f) => f.name), ['Caveat', 'Patrick Hand', 'Kalam', 'Gochi Hand'], 'font choices');
eq([L.accentShade({ accent: 'orange' }, false), L.accentShade({ accent: 'orange' }, true)], ['#d43f16', '#ff5a2d'], 'orange = the owner theme marker pair (nothing changes on an existing page)');
for (const a of L.ACCENTS.filter((x) => x.light && x.id !== 'orange')) {
  ok(L.contrastRatio(a.light, '#ffffff') >= 4.5 && L.contrastRatio(a.light, '#f6f3ec') >= 4.5, `${a.name} light shade >= 4.5 on light pages`);
  ok(L.contrastRatio(a.dark, '#1e1e1e') >= 4.5 && L.contrastRatio(a.dark, '#262626') >= 4.5 && L.contrastRatio(a.dark, '#090a0c') >= 4.5, `${a.name} dark shade >= 4.5 on dark pages`);
}
for (const [acc, bg] of [['#8a5cf5', '#ffffff'], ['#14b8a6', '#ffffff'], ['#f97316', '#ffffff'], ['#8a5cf5', '#1e1e1e'], ['#1d4ed8', '#1e1e1e'], ['rgb(20, 184, 166)', 'rgb(246, 243, 236)']]) {
  const sh = L.readableShade(acc, bg);
  ok(L.contrastRatio(sh, bg) >= 4.5, `follow-accent shade of ${acc} reads on ${bg}`, `${sh} ${L.contrastRatio(sh, bg).toFixed(2)}`);
}
eq(L.readableShade('#1d4ed8', '#ffffff'), '#1d4ed8', 'an accent that already reads is left as is');
eq(L.accentShade({ accent: 'accent' }, false, null), null, 'no accent available: fall back to the theme accent in CSS');

/* ---- habits --------------------------------------------------------------- */
const habit = '---\ntype: habit\n---\n## Why\n\nbecause\n\n## Log\n\n- 2026-10-01 done\n- 2026-10-02 done\n\n## After\n\nkeep me\n';
const on = L.toggleHabitLog(habit, '2026-10-03');
ok(on.on && on.text.includes('- 2026-10-02 done\n- 2026-10-03 done\n'), 'habit tick appends after the last log line');
ok(on.text.endsWith('## After\n\nkeep me\n') && on.text.startsWith('---\ntype: habit\n---\n## Why'), 'habit tick leaves other sections alone');
const off = L.toggleHabitLog(on.text, '2026-10-03');
ok(!off.on && off.text === habit, 'second tick restores the note exactly');
const fresh = L.toggleHabitLog('---\ntype: habit\n---\nBody', '2026-10-03');
ok(fresh.text === '---\ntype: habit\n---\nBody\n\n## Log\n\n- 2026-10-03 done\n', 'creates ## Log when missing', JSON.stringify(fresh.text));
const set = L.parseDoneSet(on.text);
eq([...set].sort(), ['2026-10-01', '2026-10-02', '2026-10-03'], 'done set');
eq(L.computeStreak(set, '2026-10-03'), 3, 'streak including today');
eq(L.computeStreak(new Set(['2026-10-01', '2026-10-02']), '2026-10-03'), 2, 'streak still alive from yesterday');
eq(L.computeStreak(new Set(['2026-10-01']), '2026-10-03'), 0, 'one missed day ends the streak');
eq(L.parseDoneSet('## Log\n- 2026-10-01 done\n- 2026-10-01 missed\n').size, 0, 'later line for a day wins');

/* ---- capture ---------------------------------------------------------------- */
const tpl = '---\ntype: scratchpad\ndate: {{date:YYYY-MM-DD}}\n---\n\n\n\n## WhatsApp';
const d0 = new Date(2026, 9, 3, 9, 41);
const created = L.renderTemplate(tpl, d0);
ok(created.includes('date: 2026-10-03\n'), 'template date token');
const first = L.insertQuickNote(created, '- 09:41  first');
eq(first, '---\ntype: scratchpad\ndate: 2026-10-03\n---\n\n## Quick notes\n\n- 09:41  first\n\n## WhatsApp\n', 'old template: quick notes opened at the top, under the frontmatter');
const second = L.insertQuickNote(first, '- 09:50  second');
eq(second, '---\ntype: scratchpad\ndate: 2026-10-03\n---\n\n## Quick notes\n\n- 09:41  first\n- 09:50  second\n\n## WhatsApp\n', 'second capture follows the first');
/* new template (2026-10-04): Quick notes first, WhatsApp last */
const tplNew = '---\ntype: scratchpad\ndate: {{date:YYYY-MM-DD}}\n---\n\n## Quick notes\n\n\n\n## WhatsApp\n';
const n1 = L.insertQuickNote(L.renderTemplate(tplNew, d0), '- 09:41  first');
eq(n1, '---\ntype: scratchpad\ndate: 2026-10-03\n---\n\n## Quick notes\n\n- 09:41  first\n\n## WhatsApp\n', 'new template: capture lands in the top section');
eq((n1.match(/## Quick notes/g) || []).length, 1, 'no duplicate heading');
/* a day with machine blocks under Quick notes: Places, end of day, WhatsApp */
const busy = '---\ntype: scratchpad\n---\n\n## Quick notes\n\n- 07:50  a\n\n<!-- places-today:start -->\n#### Places today\n\n- 12:04 – 12:34 [[X]] (30m) <!-- stay:droplet:1 -->\n\n*9 pings.*\n<!-- places-today:end -->\n\n- End of day report: [[E|2026-10-03]]\n\n## WhatsApp\n- 09:08  Kim - hi\n';
eq(L.insertQuickNote(busy, '- 23:30  late'), busy.replace('- 07:50  a\n', '- 07:50  a\n- 23:30  late\n'), 'late capture stays in Quick notes, above Places / end of day');
const emptyBusy = busy.replace('- 07:50  a\n\n', '');
eq(L.insertQuickNote(emptyBusy, '- 23:30  late'), busy.replace('- 07:50  a\n', '- 23:30  late\n'), 'empty Quick notes above Places: first capture under the heading');
/* note made by the Places detector (no template): heading opens at the top */
const placesOnly = '---\ntype: scratchpad\ndate: 2026-10-03\n---\n\n<!-- places-today:start -->\n#### Places today\n<!-- places-today:end -->\n';
eq(L.insertQuickNote(placesOnly, '- 1'), '---\ntype: scratchpad\ndate: 2026-10-03\n---\n\n## Quick notes\n\n- 1\n\n<!-- places-today:start -->\n#### Places today\n<!-- places-today:end -->\n', 'Places-only note: heading at the top, block kept intact');
/* older note shape (Quick notes last): left where it is, no second heading */
const old = '---\ntype: scratchpad\n---\n\n## WhatsApp\n- w\n\n## Quick notes\n\n- a\n';
eq(L.insertQuickNote(old, '- b'), old + '- b\n', 'older note: existing bottom section reused, nothing reordered');
eq(L.insertQuickNote('---\nx: 1\n---\nmy own words\n', '- 1'), '---\nx: 1\n---\n\n## Quick notes\n\n- 1\n\nmy own words\n', "no heading: added above the user's text, text kept");
eq(L.insertQuickNote('no frontmatter\n', '- 1'), '## Quick notes\n\n- 1\n\nno frontmatter\n', 'no frontmatter: heading first');
const mid = '---\ntype: scratchpad\n---\nmy words\n\n## Quick notes\n\n- 08:00  a\n\n## WhatsApp\n- 08:14  Kim\n';
const mid2 = L.insertQuickNote(mid, '- 09:00  b');
eq(mid2, '---\ntype: scratchpad\n---\nmy words\n\n## Quick notes\n\n- 08:00  a\n- 09:00  b\n\n## WhatsApp\n- 08:14  Kim\n', 'insert stays inside its own section');
ok(L.insertQuickNote(mid2, '- 10:00  c').includes('my words'), "user's text kept");
const emptyHead = L.insertQuickNote('x\n\n## Quick notes\n\n## Next\ny\n', '- 1');
eq(emptyHead, 'x\n\n## Quick notes\n\n- 1\n\n## Next\ny\n', 'empty quick notes section');
eq(L.insertQuickNote('---\na: 1\n---\n', '- 1'), '---\na: 1\n---\n\n## Quick notes\n\n- 1\n', 'frontmatter-only note');
eq(L.insertQuickNote('', '- 1'), '## Quick notes\n\n- 1\n', 'empty note');
ok(!L.insertQuickNote('---\ntitle: "## Quick notes"\n---\nbody\n', '- 1').startsWith('---\ntitle: "## Quick notes"\n---\nbody\n\n- 1'), 'heading text inside frontmatter is not a section');
eq(L.cleanCapture('  two\nlines\t here '), 'two lines here', 'capture text cleaned to one line');
eq(L.cleanCapture('x'.repeat(5000)).length, 2000, 'capture capped');

/* ---- weather, calendar, journal ------------------------------------------- */
eq(L.tidesLine([{ type: 'High', time: '7:41 PM' }, { type: 'Low', time: '12:46 AM' }, { type: 'High', time: '7:03 AM' }, { type: 'Low', time: '1:29 PM' }]), 'Low 12:46 AM · High 7:03 AM · Low 1:29 PM · High 7:41 PM', 'tides in time order');
eq(L.fmt12('08:00'), '8:00 AM', '12-hour time');
eq(L.fmt12('00:30'), '12:30 AM', 'midnight hour');
eq(L.fmt12('13:05'), '1:05 PM', 'afternoon time');
const ev = L.eventsWindow([
  { date: '2026-10-02', all_day: true, summary: 'old' },
  { date: '2026-10-03', time: '08:00', summary: 'Market', calendar: 'Family' },
  { date: '2026-10-03', time: null, all_day: true, summary: 'All day' },
  { date: '2026-10-10', time: '08:00', summary: 'edge' },
  { date: '2026-10-11', all_day: true, summary: 'too far' },
], '2026-10-03', 7);
eq(ev.map((e) => e.summary), ['All day', 'Market', 'edge'], 'calendar window today..+7, all-day first');
// Phase 2 section 5: no Node module anywhere in the public code (the Mac calendar sync left Today).
{
  const fs = require('fs'); const pth = require('path');
  const SRC_DIR = pth.join(__dirname, '..', 'src');
  const builtins = new Set(require('module').builtinModules.flatMap((m) => [m, `node:${m}`]).concat(['electron']));
  const js = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? js(pth.join(d, e.name)) : e.name.endsWith('.js') ? [pth.join(d, e.name)] : []));
  const used = js(SRC_DIR).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/(?:require\(\s*|\bfrom\s+|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g)].filter((m) => builtins.has(m[1])).map((m) => `${pth.relative(SRC_DIR, f)}: ${m[1]}`));
  // The one exception (launch section 5b, Things 3 approved Mac only): Things answers only to AppleScript, run
  // through osascript, loaded on demand behind a Mac desktop check in that one file.
  eq(used, ['core/sources.js: child_process'], 'no Node or Electron module anywhere in src/, except the Mac-only Things source');
  const things = fs.readFileSync(pth.join(SRC_DIR, 'core', 'sources.js'), 'utf8');
  const at = things.indexOf("window.require('child_process')");
  ok(at > 0 && /if \(!\(Platform\.isMacOS && Platform\.isDesktopApp\)\) return Promise\.reject/.test(things.slice(things.lastIndexOf('run(script) {', at), at)), 'Things: the system call is loaded only after the Mac desktop check');
  ok(!/SYNC_PYTHON|SYNC_SCRIPT|syncEnv|LW_LOCAL_/.test(fs.readFileSync(SRC, 'utf8')), 'Today has no calendar-sync script, interpreter or build-time owner value left');
}
eq(L.eventDayLabel('2026-10-05', '2026-10-03'), 'Mon 5', 'event day label');
eq(L.longDate('2026-10-03'), 'Saturday, October 3', 'long date');
const je = L.journalExcerpt('# Head\n\nWent to [[Corner Shop]] and [[04 Library/My Life/Guide/Swim Club|Swim Club]]. **Good** day.', 260);
eq(je.text, 'Went to Corner Shop and Swim Club. Good day.', 'journal excerpt strips markup');
ok(L.journalExcerpt('word '.repeat(200), 260).cut, 'long excerpt is cut');

/* ---- layout ---------------------------------------------------------------- */
const def = L.defaultLayout();
eq(def.zones.top, ['capture'], 'default top (starter set, decision 10)');
eq(def.zones.c1, ['morning', 'afternoon', 'todaytasks', 'overdue'], 'default column 1');
eq([def.zones.c2, def.zones.c3], [['calendar', 'recent', 'mood', 'habits'], ['projects']], 'default columns 2 and 3: the starter set');
eq(def.hidden, ['weather', 'plannerlink', 'clock', 'journal', 'pinned', 'journalbox'], 'everything else starts off');
eq(L.WIDGETS.map((w) => w.id).filter((id) => ['goals', 'health', 'reading', 'news', 'heatmap'].includes(id)), [], 'no placeholder, News feeds or Activity heatmap widget');
const saved = L.normalizeLayout({ zones: { top: ['weather', 'capture'], c1: ['morning', 'afternoon', 'overdue', 'plannerlink'], c2: ['calendar', 'mood', 'habits'], c3: ['projects', 'journal'] }, hidden: [] });
eq([saved.zones.top, saved.zones.c1, saved.zones.c2, saved.zones.c3, saved.hidden], [['weather', 'capture'], ['morning', 'afternoon', 'overdue', 'plannerlink', 'todaytasks'], ['calendar', 'mood', 'habits'], ['projects', 'journal'], ['recent', 'clock', 'pinned', 'journalbox']], 'a layout saved before launch: the same page; the new widgets start off');
eq(L.normalizeLayout(null), def, 'missing layout -> default');
eq(L.normalizeLayout({ zones: 'x' }), def, 'garbage layout -> default');
const odd = L.normalizeLayout({ zones: { top: ['capture', 'bogus', 'capture'], c1: ['journal'], c2: [], c3: [] }, hidden: ['mood', 'nope'] });
eq(odd.zones.top, ['capture', 'weather'], 'unknown/duplicate dropped, missing widget returns to its zone');
ok(odd.hidden.includes('mood') && !odd.zones.c2.includes('mood'), 'hidden stays hidden');
let lay = L.removeWidget(def, 'habits');
ok(!lay.zones.c2.includes('habits') && lay.hidden.includes('habits'), 'remove hides');
lay = L.addWidget(lay, 'habits', { c1: 900, c2: 300, c3: 500 });
eq(lay.zones.c2[lay.zones.c2.length - 1], 'habits', 'add goes to the shortest column');
lay = L.addWidget(def, 'weather', { c1: 0, c2: 0, c3: 0 });
eq(lay.zones.top, ['capture', 'weather'], 'weather goes back to the top');
eq(L.moveWidget(def, 'morning', -1), def, 'up from the top of column 1: column widgets never go into the Top strip');
eq(L.moveWidget(lay, 'weather', 1), L.moveWidget(lay, 'weather', 1) && lay, 'the last Top strip widget cannot go down into a column');
eq(L.moveWidget(lay, 'weather', -1).zones.top, ['weather', 'capture'], 'Top strip widgets move within the strip');
lay = L.moveWidget(def, 'overdue', 1);
eq([lay.zones.c1.slice(-1), lay.zones.c2[0]], [['todaytasks'], 'overdue'], 'down from bottom of column 1 crosses into column 2');
lay = L.moveWidget(def, 'calendar', -1);
eq(lay.zones.c1.slice(-1), ['calendar'], 'up from the top of column 2 crosses into column 1');
const notesOnly = (id) => id !== 'todaytasks';
eq(L.moveWidget(def, 'afternoon', 1, notesOnly).zones.c1, ['morning', 'overdue', 'todaytasks', 'afternoon'], 'arrows skip a card that is not shown (here: the checkbox card)');
eq([L.canMoveWidget(def, 'morning', -1), L.canMoveWidget(def, 'projects', 1), L.canMoveWidget(def, 'projects', -1)], [false, false, true], 'arrows off at the very first and last place');
eq(L.setWidgetOn(def, 'clock', true).zones.c2.slice(-1), ['clock'], 'switched on in Settings: at the end of its own column');
ok(L.setWidgetOn(def, 'mood', false).hidden.includes('mood'), 'switched off in Settings: hidden, as × does');
lay = L.placeWidget(def, 'journal', 'c1', 0);
eq([lay.zones.c1[0], lay.zones.c3], ['journal', ['projects']], 'drag places across columns');
ok(L.sameLayout(L.normalizeLayout(JSON.parse(JSON.stringify(lay))), lay), 'layout survives a save round trip');

/* ---- launch section 3: daily-note widgets ---------------------------------- */
eq(L.insertUnderHeading('', 'Journal', '- hi'), '## Journal\n\n- hi\n', 'journal heading made in an empty note');
eq(L.insertUnderHeading('---\nx: 1\n---\n# Day\n\nsome', 'Journal', '- hi'), '---\nx: 1\n---\n# Day\n\nsome\n\n## Journal\n\n- hi\n', 'missing heading: added at the end, nothing else changes');
eq(L.insertUnderHeading('## Journal\n\n- a\n\n## Other\nz\n', 'Journal', '- b'), '## Journal\n\n- a\n- b\n\n## Other\nz\n', 'the line ends its own section, before the next heading');
eq(L.insertUnderHeading('# Journal\nfirst\n## sub\nx\n# Next\n', 'Journal', '- b'), '# Journal\nfirst\n## sub\nx\n- b\n\n# Next\n', 'a sub-heading stays inside the section');
{
  const dn = { folder: 'Days', format: 'YYYY-MM-DD' };
  const parse = (rel, f) => (f === 'YYYY-MM-DD' && /^\d{4}-\d\d-\d\d$/.test(rel) ? rel : null);
  eq([L.dayFromNoteName('Days/2026-10-18.md', dn, parse), L.dayFromNoteName('Other/2026-10-18.md', dn, parse), L.dayFromNoteName('Days/notes.md', dn, parse)], ['2026-10-18', null, null], 'a daily note is known by its folder and date format');
  let parsed = 0; const counting = (rel, f) => { parsed++; return parse(rel, f); };
  eq([L.dayFromNoteName('Days/Shopping list.md', dn, counting), L.dayFromNoteName('Days/2026-10-18 meeting with the whole team.md', dn, counting), L.dayFromNoteName('Days/2026-10-18.md', dn, counting), parsed], [null, null, '2026-10-18', 1], 'a name with no digit or far too long is not parsed at all (review r2 #11)');
  const notes = { 'Days/2026-10-19.md': '---\na: 1\n---\n## Quick notes\n\n- \n', 'Days/2026-10-18.md': '# Monday\n\nWalked by the river.', 'Days/2026-10-20.md': 'future' };
  const list = Object.keys(notes).map((p) => ({ path: p, date: L.dayFromNoteName(p, dn, parse) }));
  (async () => {
    const got = await L.latestDailyEntry(list, '2026-10-19', async (p) => notes[p]);
    eq([got.path, got.text], ['Days/2026-10-18.md', 'Walked by the river.'], 'Latest journal: the newest daily note with writing in it (an empty template is skipped, a future day too)');
    eq(await L.latestDailyEntry([], '2026-10-19', async () => ''), null, 'no daily notes: nothing');
  })();
}
{
  const srcText = require('fs').readFileSync(SRC, 'utf8');
  ok(srcText.includes("Today's daily note"), 'the wording check reads the real source');
  const plannerText = require('fs').readFileSync(source('a4-planner'), 'utf8'); const projectsText = require('fs').readFileSync(source('a4-projects'), 'utf8');
  ok((plannerText.match(/String\(errField\(err, 'plain'\) \|\| /g) || []).length === 2 && /'plain' in e \? e\.plain :/.test(projectsText) && projectsText.includes('er.plain || er.message') && /t\.ext && t\.ext\.recurring\) rep\+\+/.test(srcText),
    'a repeating Todoist task that stays put says why in the Planner, Projects and "Move all to today" (review r2)');
  const visible = srcText.match(/(["'`])(?:(?!\1)[^\n])*scratchpad(?:(?!\1)[^\n])*\1/gi) || [];
  eq(visible, [], 'no "scratchpad" in any text the Today page shows');
}

/* ---- launch section 4: Recent notes, Pinned, World clock --------------------- */
eq(L.recentNotes([{ path: 'a', mtime: 1 }, { path: 'b', mtime: 3 }, { path: 'c', mtime: 2 }], 2).map((x) => x.path), ['b', 'c'], 'recent notes: newest edits first, cut to the count');
eq(L.normalizePins(['A.md', ' A.md ', 'Folder', 3, '']), ['A.md', 'Folder'], 'pins: paths, no repeats, nothing else');
eq(L.normalizePlaces([{ name: 'X', tz: 'Nope/Zone' }, { name: ' London ', tz: 'Europe/London' }, { name: '', tz: 'UTC' }]), [{ name: 'London', tz: 'Europe/London' }], 'places: a zone the device cannot read, or no name, is dropped');
{
  const at = new Date('2026-10-19T15:41:23Z');
  const lon = L.clockAt(at, 'Europe/London'); const tok = L.clockAt(at, 'Asia/Tokyo');
  eq([lon.time, lon.big, lon.day, tok.time, tok.day], ['04:41 pm', '4:41:23 pm', 'MON', '12:41 am', 'TUE'], 'world clock: each place at its own time and day, from the device alone');
  eq(L.handAngles(L.clockAt(at, 'UTC')), { h: 110.5, m: 248.3, s: 138 }, 'world clock: hand angles');
  const ut = { name: 'Windsor, Colorado, United States', short: 'Windsor, Colorado', tz: 'America/Denver' }; const on = { name: 'Windsor, Ontario, Canada', short: 'Windsor, Ontario', tz: 'America/Toronto' };
  eq([L.placeFromMatch(ut), L.placeFromMatch(on)], [{ name: 'Windsor, Colorado', tz: 'America/Denver' }, { name: 'Windsor, Ontario', tz: 'America/Toronto' }], 'add a place: the time zone comes from the search match; same-name towns stay apart');
  eq([L.placeFromMatch({ ...ut, tz: 'Nope/Zone' }), L.placeFromMatch({ ...ut, tz: '' }), L.placeFromMatch(null)], [null, null, null], 'add a place: a match whose zone this device cannot read adds nothing');
}

/* ---- launch section 8: habits as yes/no on the daily note ------------------ */
let writeBackHabits = null;
eq(L.normalizeHabits([{ name: ' Walk ' }, { name: 'walk' }, { name: 'tags' }, { name: 'a:b' }, { name: 'Read 20 pages' }, null]), [{ name: 'Walk' }, { name: 'Read 20 pages' }], 'habits: trimmed, no repeats (any case), no reserved or unusable names');
eq([L.habitNameProblem('', []), L.habitNameProblem('Walk', [{ name: 'walk' }]), L.habitNameProblem('x#y', []), L.habitNameProblem('Stretch', [])], ['Type a name for the habit.', 'There is already a habit called "Walk".', 'A habit name cannot hold : # [ ] { } | or a comma.', ''], 'habit names: why one cannot be used');
eq([L.habitNameProblem('Walk', [], { Walk: 'twice' }), L.habitNameProblem('Walk', [], { Walk: false }), L.habitNameProblem('Walk', [], { Walk: '' }), L.habitNameProblem('Walk', [], null)], ['Today\'s daily note already uses "Walk" for something else. Pick another name.', '', '', ''], 'habit names: a name today\'s daily note uses for a non-yes/no value is refused');
{
  const yesDays = new Set(['2026-10-17', '2026-10-18']);
  eq([L.propStreak((d) => yesDays.has(d), '2026-10-19'), L.propStreak((d) => yesDays.has(d) || d === '2026-10-19', '2026-10-19'), L.propStreak(() => false, '2026-10-19')], [2, 3, 0], 'streak: days in a row with a yes, counted from yesterday until today is ticked');
}
writeBackHabits = async () => {
  // Ticking writes yes, then no, on today's daily note through the frontmatter API; a missing note is made first.
  const notes = {}; const fms = {};
  const app = {
    vault: { getAbstractFileByPath: (p) => (p in notes ? new TFile(p) : null), create: async (p, c) => { notes[p] = c; fms[p] = {}; }, createFolder: async () => {}, process: async (f, fn) => { notes[f.path] = fn(notes[f.path]); }, read: async (f) => notes[f.path] },
    fileManager: { processFrontMatter: async (f, fn) => { fn(fms[f.path]); } },
    internalPlugins: { getEnabledPluginById: () => ({ options: { folder: 'Days', format: 'YYYY-MM-DD', template: '' } }) },
  };
  const plugin = Object.assign(Object.create(Plugin.prototype), { app });
  eq(await plugin.toggleHabitProp('Walk'), true, 'habit ticked: yes');
  const path = `Days/${L.dayOf(new Date())}.md`;
  eq([path in notes, fms[path]], [true, { Walk: true }], "today's daily note made, the habit's property set to yes");
  eq(await plugin.toggleHabitProp('Walk'), false, 'ticked again: no');
  eq(fms[path], { Walk: false }, 'the property says no (kept, not removed)');
  fms[path].date = '2026-10-19';
  let msg = '';
  try { await plugin.toggleHabitProp('date'); } catch (e) { msg = e.plain; }
  eq([msg, fms[path].date], ['Today\'s daily note already uses "date" for something else. Rename the habit.', '2026-10-19'], 'a habit never overwrites a property that holds something else (review r1 #2)');
  fms[path].Swim = '';
  eq([await plugin.toggleHabitProp('Swim'), fms[path].Swim], [true, true], 'a habit property left blank by hand counts as not set (review r2)');
};

/* ---- write-back through the plugin (fake app) ------------------------------ */
async function writeBack() {
  function fakeApp(files, withApi) {
    const calls = [];
    const app = {
      vault: {
        getAbstractFileByPath: (p) => (files[p] !== undefined ? Object.assign(new TFile(p)) : null),
        process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
        read: async (f) => files[f.path],
        create: async (p, c) => { if (files[p] !== undefined) throw new Error('exists'); files[p] = c; },
        createFolder: async (p) => { files[p] = null; },
      },
      fileManager: { processFrontMatter: async (f, fn) => { fn(files[f.path]); } },
      plugins: { plugins: {} },
    };
    if (withApi) {
      app.plugins.plugins.tasknotes = {
        settings: { customStatuses: [{ value: 'done', isCompleted: true }, { value: 'closed', isCompleted: true }, { value: 'open' }] },
        api: {
          apiVersion: 1,
          hasCapability: (c) => ['tasks.write', 'recurring.write'].includes(c),
          lifecycle: { isReady: () => true },
          tasks: {
            complete: async (p) => { calls.push(['complete', p]); files[p].status = 'done'; return files[p]; },
            uncomplete: async (p) => { calls.push(['uncomplete', p]); files[p].status = 'open'; return files[p]; },
          },
          recurring: {
            toggleCompleteInstance: async (p, day) => {
              calls.push(['instance', p, day]);
              const l = files[p].complete_instances || [];
              files[p].complete_instances = l.includes(day) ? l.filter((x) => x !== day) : [...l, day];
              return files[p];
            },
          },
        },
      };
    }
    return { app, calls };
  }
  const P = '02 Planner/TaskNotes/Tasks/';
  // via TaskNotes
  {
    const files = { [P + 'one.md']: { tags: ['task'], status: 'open', due: today }, [P + 'rep.md']: { tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=DAILY', complete_instances: ['2026-10-02'] } };
    const { app, calls } = fakeApp(files, true);
    const plugin = Object.assign(Object.create(Plugin.prototype), { app });
    const one = L.taskFromFrontmatter(files[P + 'one.md'], P + 'one.md', 'one');
    eq(await plugin.toggleTask(one, today), true, 'TaskNotes path: tick a one-off');
    const oneDone = L.taskFromFrontmatter(files[P + 'one.md'], P + 'one.md', 'one');
    eq(await plugin.toggleTask(oneDone, today), false, 'TaskNotes path: untick');
    const rep = L.taskFromFrontmatter(files[P + 'rep.md'], P + 'rep.md', 'rep');
    eq(await plugin.toggleTask(rep, today), true, 'TaskNotes path: tick a repeating task');
    // Updated when moved: Today stopped calling TaskNotes on 2026-10-13 (its header says so);
    // the three old "TaskNotes path uses ..." checks failed on the vault copy since then.
    eq(calls, [], 'TaskNotes itself is never called');
    eq(files[P + 'rep.md'].complete_instances, ['2026-10-02', today], 'instance recorded');
    ok(files[P + 'rep.md'].status === undefined, 'repeating task status untouched');
    const rep2 = L.taskFromFrontmatter(files[P + 'rep.md'], P + 'rep.md', 'rep');
    eq(await plugin.toggleTask(rep2, today), false, 'TaskNotes path: untick a repeating task');
    eq(files[P + 'rep.md'].complete_instances, ['2026-10-02'], 'instance removed, earlier days kept');
    const closed = L.taskFromFrontmatter({ tags: ['task'], status: 'closed' }, P + 'one.md', 'one');
    files[P + 'one.md'].status = 'closed';
    eq(await plugin.toggleTask(closed, today), false, 'closed counts as done (uncomplete)');
  }
  // without TaskNotes: Planner-equivalent fields only
  {
    const files = { [P + 'one.md']: { tags: ['task'], status: 'in-progress', due: today, planned_half: 'am', planned_order: 3 }, [P + 'rep.md']: { tags: ['task'], recurrence: 'DTSTART:20260904;FREQ=DAILY', complete_instances: ['2026-10-02'], status: 'open' } };
    const { app } = fakeApp(files, false);
    const plugin = Object.assign(Object.create(Plugin.prototype), { app });
    const one = L.taskFromFrontmatter(files[P + 'one.md'], P + 'one.md', 'one');
    eq(await plugin.toggleTask(one, today), true, 'fallback tick');
    const f1 = files[P + 'one.md'];
    eq([f1.status, f1.completedDate, f1.planned_half, f1.planned_order, f1.due], ['done', L.dayOf(new Date()), 'am', 3, today], 'fallback writes status + completedDate, plan fields untouched');
    ok(typeof f1.dateModified === 'string', 'fallback stamps dateModified');
    eq(await plugin.toggleTask(L.taskFromFrontmatter(f1, P + 'one.md', 'one'), today), false, 'fallback untick');
    ok(files[P + 'one.md'].status === 'open' && !('completedDate' in files[P + 'one.md']), 'fallback untick clears completedDate');
    const rep = L.taskFromFrontmatter(files[P + 'rep.md'], P + 'rep.md', 'rep');
    eq(await plugin.toggleTask(rep, today), true, 'fallback repeating tick');
    eq([files[P + 'rep.md'].complete_instances, files[P + 'rep.md'].status], [['2026-10-02', today], 'open'], 'fallback repeating writes the day only');
  }
  // habit and capture writes
  {
    const files = { 'h.md': habit, '06 Admin/Admin Notes/Templates/Daily Notes.md': tpl };
    const { app } = fakeApp(files, false);
    const plugin = Object.assign(Object.create(Plugin.prototype), { app });
    eq(await plugin.toggleHabit(new TFile('h.md'), '2026-10-03'), true, 'habit write on');
    eq(await plugin.toggleHabit(new TFile('h.md'), '2026-10-03'), false, 'habit write off');
    ok(files['h.md'] === habit, 'habit note byte-identical after on+off');
    const p1 = await plugin.capture('  hello\nthere ');
    const now = new Date();
    eq(p1, L.scratchPathFor(now), 'capture creates today\'s scratchpad');
    ok(files[p1].startsWith('---\ntype: scratchpad\ndate: ' + L.dayOf(now)) && files[p1].includes('## WhatsApp') && /^---\n[^]*?\n---\n\n## Quick notes\n\n- \d\d:\d\d  hello there\n\n## WhatsApp\n?$/.test(files[p1]), 'new scratchpad from template + capture', JSON.stringify(files[p1]));
    await plugin.capture('second');
    ok(/- \d\d:\d\d  hello there\n- \d\d:\d\d  second\n\n## WhatsApp\n?$/.test(files[p1]), 'second capture appended');
    eq(await plugin.capture('   '), null, 'blank capture writes nothing');
    // Review p2-s4 nice-to-have 2: a nested daily-note date format gets its year and month folders.
    const made = [];
    const mk = app.vault.createFolder; app.vault.createFolder = async (p) => { made.push(p); return mk(p); };
    app.internalPlugins = { getEnabledPluginById: () => ({ options: { folder: 'Daily', format: 'YYYY/MM/YYYY-MM-DD', template: 'T' } }) };
    files['T.md'] = '# {{title}}\n';
    const pn = await plugin.capture('nested');
    const d = new Date(); const ymd = L.dayOf(d);
    eq([pn, made], [`Daily/${ymd.slice(0, 4)}/${ymd.slice(5, 7)}/${ymd}.md`, ['Daily', `Daily/${ymd.slice(0, 4)}`, `Daily/${ymd.slice(0, 4)}/${ymd.slice(5, 7)}`]], 'nested date format: the note and every folder on the way are created');
    ok(/^# \d{4}-\d\d-\d\d$/m.test(files[pn]) && files[pn].includes(`# ${ymd}\n`) && files[pn].includes('nested'), 'nested date format: the capture is written; {{title}} is the note name, not its folders');
    delete app.internalPlugins;
    // Launch section 3: no template: an empty new note, no type line; the journal box writes under "Journal".
    app.internalPlugins = { getEnabledPluginById: () => ({ options: { folder: 'Days', format: 'YYYY-MM-DD', template: '' } }) };
    const pj = await plugin.capture('plain');
    ok(/^## Quick notes\n\n- \d\d:\d\d  plain\n$/.test(files[pj]) && !files[pj].includes('type:'), 'a daily note made without a template: no type line, just the capture', JSON.stringify(files[pj]));
    await plugin.journalLine('  a good day ');
    await plugin.journalLine('second line');
    ok(/## Quick notes\n\n- \d\d:\d\d  plain\n\n## Journal\n\n- a good day\n- second line\n$/.test(files[pj]), 'journal box: lines under a Journal heading, made when missing', JSON.stringify(files[pj]));
    eq(await plugin.journalLine('  '), null, 'a blank journal line writes nothing');
    delete app.internalPlugins;
  }
  // "Move all N to today" and its Undo (1.2.3)
  {
    const day = '2026-10-05';
    const P = '02 Planner/TaskNotes/Tasks/';
    const files = {
      [P + 'a.md']: { tags: ['task'], status: 'open', due: '2026-10-02', planned_half: 'pm', planned_order: 5, dateModified: 'x' },
      [P + 'b.md']: { tags: ['task'], status: 'open', due: '2026-09-29T09:30' },
      [P + 'c.md']: { tags: ['task'], status: 'open', due: '2026-09-30', recurrence: 'FREQ=DAILY' },
      [P + 'd.md']: { tags: ['task'], status: 'done', due: '2026-09-30' },
    };
    const orig = JSON.parse(JSON.stringify(files));
    const { app } = fakeApp(files, false);
    const plugin = Object.assign(Object.create(Plugin.prototype), { app });
    const plan = [
      { path: P + 'b.md', lane: 'am', order: 30 }, { path: P + 'a.md', lane: 'pm', order: 20 },
      { path: P + 'c.md', lane: 'am', order: 40 }, { path: P + 'd.md', lane: 'am', order: 50 }, { path: P + 'gone.md', lane: 'am', order: 60 },
    ];
    const res = await plugin.moveOverdueToToday(plan, day);
    eq(res.moved, [P + 'b.md', P + 'a.md'], 'move: only the two real overdue tasks written');
    eq(res.failed, [P + 'gone.md'], 'move: a missing note is reported, not thrown');
    eq(files[P + 'a.md'], { ...orig[P + 'a.md'], due: day, planned_order: 20 }, 'move: due + order only, half kept');
    eq(files[P + 'b.md'], { ...orig[P + 'b.md'], due: day + 'T09:30', planned_order: 30 }, 'move: time kept, order added');
    eq([files[P + 'c.md'], files[P + 'd.md']], [orig[P + 'c.md'], orig[P + 'd.md']], 'move: repeating and done untouched');
    eq(await res.undo(), 0, 'undo reports no failures');
    eq(files, orig, 'undo: every note exactly as before (added key removed again)');
    ok(!('planned_order' in files[P + 'b.md']), 'undo: planned_order absent again, not null');
    const empty = await plugin.moveOverdueToToday([], day);
    eq([empty.moved, empty.failed, await empty.undo()], [[], [], 0], 'empty plan: nothing written, undo is a no-op');
  }
}

/* ---- Planner button: Planner only (old Daily Planner fallback dropped 1.2.7) ---- */
{
  const ran = [];
  const withCmds = (ids) => ({ app: { commands: { commands: Object.fromEntries(ids.map((i) => [i, {}])), executeCommandById: (i) => ran.push(i) } } });
  notices.length = 0;
  Plugin.prototype.openPlanner.call(withCmds(['a4-planner:open', 'a4-daily-planner:open-board']));
  eq(ran, ['a4-planner:open'], 'planner button opens the Planner');
  ran.length = 0;
  Plugin.prototype.openPlanner.call(withCmds(['a4-daily-planner:open-board']));
  eq([ran, notices], [[], ['The planner is not turned on.']], 'old Daily Planner is never a fallback');
  notices.length = 0;
  ok(!/a4-daily-planner/.test(require('fs').readFileSync(SRC, 'utf8').replace(/\/\/.*$/gm, '')), 'no old Daily Planner reference in code');
}

/* ---- Open Today when Obsidian starts (setting, 1.3.1) ---------------------- */
eq([L.startupOpensToday(undefined), L.startupOpensToday({}), L.startupOpensToday({ openOnStartup: true }), L.startupOpensToday({ openOnStartup: false })], [true, true, true, false], 'startup setting: on unless saved as false');
eq([L.normalizeOpenOnStartup('false'), L.normalizeOpenOnStartup(0), L.normalizeOpenOnStartup(null)], [true, true, true], 'startup setting: only a real false turns it off (damaged data keeps today\'s behaviour)');
async function startupRun(saved) {
  // Real onload against a stand-in app: count every way Today could be opened,
  // focused or revealed once the layout is ready.
  const ready = []; const touched = []; let stored = saved; const cm = { exts: [], updated: 0 };
  const p = Object.create(Plugin.prototype);
  const nop = () => {};
  p.app = {
    workspace: {
      onLayoutReady: (cb) => ready.push(cb), on: () => ({}), getLeavesOfType: () => [],
      getLeaf: () => { touched.push('getLeaf'); return { setViewState: async () => touched.push('setViewState') }; },
      revealLeaf: () => touched.push('revealLeaf'), setActiveLeaf: () => touched.push('setActiveLeaf'),
      updateOptions: () => cm.updated++,
    },
    metadataCache: { on: () => ({}), getFileCache: () => null }, vault: { getAbstractFileByPath: () => null },
  };
  Object.assign(p, { loadData: async () => stored, saveData: async (d) => { stored = JSON.parse(JSON.stringify(d)); }, addSettingTab: nop, registerEvent: nop,
    registerEditorExtension: (e) => cm.exts.push(e), registerView: nop, addRibbonIcon: nop, addCommand: nop, registerObsidianProtocolHandler: nop });
  await p.onload(); for (const cb of ready) await cb(); await new Promise((r) => setTimeout(r, 0));
  return { p, touched, stored: () => stored, cm };
}
const startupChecks = (async () => {
  const keep = { layout: { zones: { top: ['weather'] }, hidden: [] }, look: { accent: 'orange', font: 'caveat' }, calendars: { selected: ['x'] } };
  const on = await startupRun(JSON.parse(JSON.stringify(keep)));
  ok(on.touched.includes('setViewState'), 'startup, no saved setting: Today opens as before');
  eq([on.cm.exts.length, on.cm.updated], [0, 0], 'startup: Today adds no editor extension (the marker hiding left with the companion add-on)');
  const off = await startupRun({ ...JSON.parse(JSON.stringify(keep)), openOnStartup: false });
  eq(off.touched, [], 'startup, setting off: Today is not opened, revealed or focused');
  const fresh = await startupRun(null);
  ok(fresh.touched.includes('setViewState'), 'startup, brand-new install: Today opens');
  // Saving the toggle keeps every other saved choice.
  await on.p.saveOpenOnStartup(false);
  eq(on.stored(), { ...keep, openOnStartup: false }, 'turning it off saves only the new setting');
  eq(on.p.openOnStartup, false, 'turning it off takes effect at once');
  // Opening by hand still works with the setting off.
  off.touched.length = 0;
  await off.p.openToday();
  ok(off.touched.includes('setViewState'), 'setting off: Open Today by hand still opens it');
  // A synced change from the phone is picked up.
  const sync = await startupRun({ openOnStartup: true });
  sync.p.applyLook = nop2; await sync.p.saveData({ openOnStartup: false }); await sync.p.onExternalSettingsChange();
  eq(sync.p.openOnStartup, false, 'synced change of the setting is picked up');
  // Settings › Today page › Your name (phase 2 section 5; approved step 0 mockup).
  const named = await startupRun({ ...JSON.parse(JSON.stringify(keep)), userName: '  Sam ' });
  eq(named.p.userName, 'Sam', 'your name: read from the saved settings, trimmed');
  eq([L.greetingLine(9, named.p.userName), L.greetingLine(14, ''), L.greetingLine(18, '  ')], ['Good morning, Sam', 'Good afternoon', 'Good evening'], 'greeting: with the name; empty means no name and no comma');
  await named.p.saveUserName(' Kim ');
  eq([named.stored(), named.p.userName], [{ ...keep, userName: 'Kim' }, 'Kim'], 'your name: saving keeps every other saved choice');
  eq((await startupRun(null)).p.userName, '', 'new install: no name');
  named.p.applyLook = nop2; await named.p.saveData({ userName: 'Lee' }); await named.p.onExternalSettingsChange();
  eq(named.p.userName, 'Lee', 'your name from another device is picked up');
  const save0 = named.p.saveData; named.p.saveData = async () => { throw new Error('planted disk error'); };
  let threw = false; try { await named.p.saveUserName('Max'); } catch (e) { threw = true; }
  named.p.saveData = save0;
  eq([threw, named.p.userName], [true, 'Lee'], 'your name: a failed save is reported and leaves the name as it was (review p2-s5)');
  const src0 = require('fs').readFileSync(SRC, 'utf8');
  const tab = src0.slice(src0.indexOf('class TodaySettingTab'));
  ok(/\.setName\('Your name'\)\s*\.setDesc\('Shown in the greeting\. Leave empty for none\.'\)\s*\.addText\(\(t\) => \{\s*t\.setPlaceholder\('Optional'\)/.test(tab), 'Your name row: wording and placeholder as drawn');
  ok([...tab.matchAll(/\.setName\('([^']+)'\)/g)][0][1] === 'Your name', 'Your name is the first Today page row, as drawn');
  // The calendar sync is a companion add-on's (section 7): without one there is nothing to run.
  ok(!on.p.canRunSync() && (await on.p.runCalendarSync(true)) === false && on.p.scheduleCalendarSync(() => {}) === false, 'no add-on: no sync is run, the picker only saves');
  const runs = []; let release;
  on.p.calendarSync = (refresh) => { runs.push(refresh); return new Promise((r) => { release = r; }); };
  const first = on.p.runCalendarSync(true);
  const second = on.p.runCalendarSync(false); const third = on.p.runCalendarSync(false);
  await new Promise((r) => setTimeout(r, 0)); release(true);
  await new Promise((r) => setTimeout(r, 0)); release(true);
  eq([await first, await second, await third, runs], [true, true, true, [true, false]], "add-on's sync: run with the refresh flag; requests during a run make one more run, not two");
  // Review p2-s5 must-fix 1: a Refresh list asked for during a plain run is not lost.
  runs.length = 0;
  const plain = on.p.runCalendarSync(false);
  on.p.runCalendarSync(false); const refreshAsk = on.p.runCalendarSync(true);
  await new Promise((r) => setTimeout(r, 0)); release(true);
  await new Promise((r) => setTimeout(r, 0)); release(true);
  await plain; await refreshAsk;
  eq(runs, [false, true], 'plain run, then plain and Refresh list asked: the one follow-up run refreshes');
  on.p.calendarSync = () => { throw new Error('planted'); };
  const w = console.warn; console.warn = () => {};
  eq(await on.p.runCalendarSync(false), false, "add-on's sync failing: reported as not finished, no crash");
  console.warn = w;
  // Static: the one self-opening call in the code is the guarded startup line.
  const src = require('fs').readFileSync(SRC, 'utf8');
  const self = src.match(/onLayoutReady\([^\n]*openToday[^\n]*/g) || [];
  eq(self, ["onLayoutReady(() => { if (this.openOnStartup) this.openToday(); });"], 'only one startup path opens Today, and it obeys the setting');
})();
function nop2() {}

/* ---- Find button (mockup approved 2026-10-06) ---- */
{
  const opened = [];
  const withPj = (pj) => Object.assign(Object.create(Plugin.prototype), { app: { plugins: { plugins: pj ? { 'a4-projects': pj } : {} } } });
  notices.length = 0;
  ok(withPj({ openFind: () => opened.push('find') }).openFind() === true && opened.join() === 'find' && notices.length === 0, 'Find opens Projects\' Find window');
  ok(withPj(null).openFind() === false && notices[0] === 'Find needs the projects and tasks part turned on.', 'Find without Projects: a plain notice, no error');
  const src = require('fs').readFileSync(SRC, 'utf8');
  const head = src.slice(src.indexOf('  buildShell() {'), src.indexOf("    const edit = head.createDiv({ cls: 'a4t-edit-actions' });"));
  ok(head.indexOf("findBtn.appendText('Find')") > 0 && head.indexOf("findBtn.appendText('Find')") < head.indexOf("editBtn.appendText('Edit layout')"), 'Find button sits just before Edit layout');
  ok(/findBtn\.addEventListener\('click', \(\) => this\.plugin\.openFind\(\)\)/.test(head) && /setIcon\(findBtn\.createSpan\(\{ cls: 'a4t-ic' \}\), 'search'\)/.test(head), 'Find button: search icon, opens the Find window');
}

/* ---- capture box: drag to enlarge, snap back on save, working on-screen Enter (1.6.0) ---- */
{
  eq(L.CAPTURE_MAX_PX, 480, 'capture box max height is 480 px');
  eq(L.captureMaxHeight(19, 1000), 480, 'tall window: capped at 480 px');
  eq(L.captureMaxHeight(19, 500), 300, 'short window: capped at 60% of its height');
  eq(L.captureMaxHeight(19, 20), 19, 'tiny window: never below the resting size');
  eq(L.captureDragHeight(19, 100, 19, 1000), 119, 'drag down 100 px: 100 px taller');
  eq(L.captureDragHeight(19, -50, 19, 1000), 19, 'drag up past the start: stays at the resting size (no smaller)');
  eq(L.captureDragHeight(200, -60, 19, 1000), 140, 'drag up from an enlarged box shrinks it');
  eq(L.captureDragHeight(19, 5000, 19, 1000), 480, 'drag far down: stops at the max');
  eq(L.captureDragHeight(19, NaN, 19, 1000), 19, 'bad pointer value: resting size');
  const src = require('fs').readFileSync(SRC, 'utf8');
  const rc = src.slice(src.indexOf('  renderCapture(body) {'), src.indexOf('  renderTaskCard('));
  ok(/createEl\('textarea'[^\n]*rows: '1'[^\n]*'data-testid': 'a4t-capture'/.test(rc), 'Today box is a one-row text area that can grow');
  ok(/'data-testid': 'a4t-capture-grip'/.test(rc), 'Today box has a drag handle');
  ok(/registerDomEvent\(input, 'keydown'[^]*?e\.key !== 'Enter'[^]*?submit\(\);/.test(rc), 'Enter key saves through submit()');
  ok(/registerDomEvent\(send, 'click', \(e\) => \{ e\.preventDefault\(\); submit\(\); \}\)/.test(rc), 'on-screen Enter saves through the same submit()');
  ok(/input\.value = ''; reset\(\);/.test(rc), 'a successful save empties the box and snaps it back to its resting size');
  ok(/catch \(err\)[^\n]*Your text is still in the box/.test(rc) && !/catch \(err\)[^\n]*reset\(\)/.test(rc), 'a failed save keeps the text and the size');
  ok(!/saveData|saveSettings|localStorage/.test(rc), 'the enlarged size is never remembered');
  ok(/const reset = \(\) => \{ input\.style\.removeProperty\('height'\); box\.removeClass\('is-grown'\); \};/.test(rc), 'snap back clears the dragged height');
  const md = src.slice(src.indexOf('class CaptureModal extends Modal {'), src.indexOf('  onClose() { this.contentEl.empty(); }'));
  ok(/captureSendButton\(box\)/.test(md) && /send\.addEventListener\('click', \(e\) => \{ e\.preventDefault\(\); submit\(\); \}\)/.test(md), 'capture window: on-screen Enter saves too');
  ok(/function captureSendButton[^]*?role: 'button', tabindex: '0'/.test(src), 'on-screen Enter is a real, focusable control');
  const css = require('fs').readFileSync(STYLES, 'utf8');
  const capCss = css.split('\n').filter((l) => /a4t-capture-(grip|send|text)/.test(l)).join('\n');
  ok(capCss.length > 0 && !/#[0-9a-f]{3,8}\b|rgb\(/i.test(capCss), 'handle and Enter styles use theme colours only');
  ok(/textarea\.a4t-capture-text \{[^}]*resize: none/.test(css), 'no native resize corner (it could widen the box)');
}

// Active projects, one line per project (option 1, 2026-10-18)
{
  const G = L.projectLines;
  const pj = (name) => ({ name, path: `P/${name}.md` });
  const list = [pj('Paint the Shed'), pj('Village Choir - Learn the songs'), pj('Bake Sale - Book the hall'), pj('Garden - Plant beans'), pj('Bake Sale - Print flyers'), pj('Choir songbook'), pj('Odd - Name')];
  const ix = { areas: [{ key: 'Bake Sale', name: 'Bake Sale', path: 'P/Bake Sale.md' }, { key: 'Garden', name: 'Garden', path: 'P/Garden.md' }, { key: 'Village Choir', name: 'Village Choir', path: 'P/Choir.md' }],
    of: { 'Bake Sale - Book the hall': 'Bake Sale', 'Bake Sale - Print flyers': 'Bake Sale', 'Garden - Plant beans': 'Garden', 'Village Choir - Learn the songs': 'Village Choir', 'Choir songbook': 'Village Choir' } };
  const g = G(list, ix);
  eq(g.map((r) => [r.label, r.rest]), [['Bake Sale', 'Book the hall'], ['Bake Sale', 'Print flyers'], ['Garden', 'Plant beans'], ['Village Choir', 'Learn the songs'], ['Village Choir', 'Choir songbook'], ['', 'Paint the Shed'], ['', 'Odd - Name']],
    'areas A to Z (list order kept inside one), no-area last with no label and its name whole; no "X - " start = the area name');
  eq(g[0].path, 'P/Bake Sale - Book the hall.md', 'each line keeps its project path');
  eq(G([pj('A - B')], null).map((r) => [r.label, r.rest]), [['', 'A - B']], 'without Projects: plain names, untouched');
  const css = require('fs').readFileSync(STYLES, 'utf8').split('\n').filter((l) => /a4t-(prow|plab)/.test(l)).join('\n');
  ok(css.length > 0 && !/#[0-9a-f]{3,8}\b|rgb\(/i.test(css) && /a4t-prow \{[^}]*overflow-wrap: anywhere/.test(css), 'project lines wrap and use theme colours only');
  ok(/a4t-prow \{[^}]*justify-content: flex-start/.test(css) && /a4t-prow \{[^}]*text-align: left/.test(css), 'project lines start at the left, not Obsidian\'s centred button default');
  ok(!/a4t-areah|setIcon\(b\.createSpan\(\{ cls: 'a4t-ic' \}\), 'square-kanban'\)/.test(require('fs').readFileSync(path.join(__dirname, '..', 'src', 'today', 'main.js'), 'utf8')), 'no area headings, no row icons');
}

startupChecks.then(writeBack).then(() => writeBackHabits()).then(() => {
  console.log(`RESULT ${n} ${failed}`);
}).catch((e) => { console.log('CRASH', e && e.stack); console.log(`RESULT ${n} ${failed + 1}`); });
