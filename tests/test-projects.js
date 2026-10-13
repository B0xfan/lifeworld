#!/usr/bin/env node
/* Logic tests for the A4 Projects plugin and its built-in task engine
 * `node tests/test-projects.js`.
 * Re-runs itself in several time zones (each with a timeout).
 *
 * 1. The code shared with A4 Today and A4 Planner is a character-for-character copy.
 * 2. Repeats: the engine's "tick an occurrence" write is compared with
 *    TaskNotes' own algorithm, run on TaskNotes' own recurrence package
 *    (@tasknotes/model, which uses the rrule library) for thousands of rules,
 *    starts, ticked days and "todays", including the real repeating tasks.
 *    Needs TASKNOTES_MODEL=<folder with node_modules/@tasknotes/model and rrule>;
 *    without it these checks are skipped and say so.
 * 3. New-note frontmatter has TaskNotes' key order (mapTaskToFrontmatter).
 * 4. Status writes, archive writes, undo snapshots, timestamps across time
 *    zones and midnight / daylight-saving edges.
 * 5. Quick-add words, repeat words, steps, Inbox/overdue/later rules, and the
 *    overview on a copy of the real task and project notes (read-only).
 * Moved from the A4 vault: behaviour checks load the built main.js, text checks read
 * src/ (tests/lib/paths.js).  Note checks read the frozen, made-up copy in
 * tests/fixtures/vault, or the owner's vault with A4_VAULT (its repeats by name with
 * A4_REAL_REPEATS=<task name>,<task name>). */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const { built, source, repeats: REPEATS } = require('./lib/paths');
const VAULT = require('./lib/paths').vault; // the owner's vault with A4_VAULT, else the frozen copy
const MAIN = built('a4-projects');
const SRC = source('a4-projects');
const ZONES = ['America/Costa_Rica', 'UTC', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'Asia/Kolkata', 'America/New_York', 'Australia/Lord_Howe'];

if (!process.env.A4PJ_CHILD) {
  let fails = 0; let total = 0;
  // shortcut: the oracle needs TaskNotes' own model package, not installed here or on GitHub; add it as a dev dependency to run it in CI.
  if (!process.env.TASKNOTES_MODEL) console.log('skipped: the TaskNotes oracle checks (repeat ticks compared with TaskNotes\' own code); TASKNOTES_MODEL is not set');
  if (!REPEATS.length) console.log('skipped: the Someday round trip on real repeats; A4_REAL_REPEATS is not set');
  for (const tz of ZONES) {
    try {
      const out = execFileSync(process.execPath, [__filename], { env: { ...process.env, TZ: tz, A4PJ_CHILD: '1' }, encoding: 'utf8', timeout: 240000, maxBuffer: 1 << 26 });
      const m = /RESULT (\d+) (\d+)/.exec(out);
      total += Number(m[1]); fails += Number(m[2]);
      console.log(`${tz.padEnd(22)} ${m[1]} checks, ${m[2]} failed`);
      if (Number(m[2])) console.log(out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 40).join('\n'));
    } catch (e) { fails++; console.log(`${tz.padEnd(22)} FAILED\n${((e.stdout || '') + (e.stderr || '')).slice(0, 4000)}`); }
  }
  console.log(`\nTOTAL ${total} checks, ${fails} failed`);
  process.exit(fails ? 1 : 0);
}

/* ---- obsidian stand-in ------------------------------------------------------ */
class TFile {}
class TFolder {}
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const L = require(MAIN).logic;

let n = 0; let failed = 0;
const tz = process.env.TZ;
function ok(cond, name, extra) { n++; if (!cond) { failed++; console.log(`FAIL [${tz}] ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- 1. shared code ---------------------------------------------------------- */
const SHARED = ['pad2', 'dayOf', 'isDayStr', 'toDayStr', 'utcOf', 'fromUtc', 'addDays', 'daysBetween', 'weekdayOf', 'partsOf', 'daysInMonth',
  'WD', 'parseRRule', 'monthDaysByDay', 'monthDaysByMonthDay', 'applySetPos', 'matchesPattern', 'occursOn',
  'wikilinkTarget', 'wikilinkLabel', 'asList', 'taskTitleOf', 'timeOf', 'ruleTimeOf', 'halfOfTime', 'timeText', 'REMINDER_CHOICES', 'ringField', 'offsetMinutes', 'offsetIso', 'reminderOf', 'reminderShort', 'reminderWords', 'onDay', 'movedDate', 'untimedSlot', 'taskFromFrontmatter', 'isTaskDone', 'taskOnDay', 'sortByOrder', 'orderForInsert', 'applyMove', 'blockerLinks', 'blockerHolds', 'openBlockersOf', 'isSomeday', 'applySomeday'];
function extract(src, name) {
  const m = new RegExp(`^(function ${name}\\(|const ${name} = )`, 'm').exec(src);
  if (!m) return null;
  const first = src.slice(m.index, src.indexOf('\n', m.index));
  if (/^const /.test(first) && first.trim().endsWith(';')) return first;
  const code = first.replace(/\/\/.*$/, '');
  const o = (code.match(/\{/g) || []).length; const c = (code.match(/\}/g) || []).length;
  if (o > 0 && o === c) return first;
  return src.slice(m.index, src.indexOf('\n}\n', m.index) + 2);
}
const srcJ = fs.readFileSync(SRC, 'utf8');
for (const other of ['a4-planner', 'a4-today']) {
  const srcO = fs.readFileSync(source(other), 'utf8');
  for (const name of SHARED) { const a = extract(srcJ, name); const b = extract(srcO, name); ok(a && b && a === b, `shared code identical with ${other}: ${name}`); }
  for (const c of ['TASKS_FOLDER', 'ARCHIVE_FOLDER', 'DEFAULT_COMPLETED_STATUSES']) {
    const re = new RegExp(`^const ${c} = (.*);$`, 'm'); const a = re.exec(srcJ); const b = re.exec(srcO);
    ok(a && b && a[1] === b[1], `same constant as ${other}: ${c}`);
  }
}

/* ---- config from A4's real TaskNotes settings ------------------------------- */
let tnSettings = null;
try { tnSettings = JSON.parse(fs.readFileSync(path.join(VAULT || '', '.obsidian/plugins/tasknotes/data.json'), 'utf8')); } catch (e) { /* none */ }
const cfg = L.engineConfig(tnSettings);
eq(cfg.F.completeInstances, 'complete_instances', 'config: field names from TaskNotes');
eq(cfg.tasksFolder, '02 Planner/TaskNotes/Tasks', 'config: tasks folder');
eq(L.completedStatusesOf(cfg), ['done', 'closed'], 'config: finished statuses');
const cfgDefault = L.engineConfig(null);
eq(JSON.stringify(cfgDefault.F), JSON.stringify(cfg.F), 'config: built-in defaults match A4 TaskNotes');
eq(cfgDefault.statuses.map((s) => [s.value, s.isCompleted, s.autoArchive]), cfg.statuses.map((s) => [s.value, s.isCompleted, s.autoArchive]), 'config: built-in statuses match A4 TaskNotes');
const snap = L.snapshotTaskNotes(tnSettings || {});
eq(JSON.stringify(L.engineConfig(snap)), JSON.stringify(cfg), 'config: saved copy gives the same config');
ok(!/token|auth|apiKey/i.test(JSON.stringify(snap)), 'config: saved copy holds no secrets');

/* ---- 2. repeats vs TaskNotes' own code --------------------------------------- */
const D = L.addDays;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
let oracle = null;
if (process.env.TASKNOTES_MODEL) {
  const req = Module.createRequire(path.join(process.env.TASKNOTES_MODEL, 'x.js'));
  oracle = { rec: req('@tasknotes/model/recurrence'), map: req('@tasknotes/model/mapping') };
}
const utc = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
const fmtUTC = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
function datePart(s) { if (!s) return ''; const t = String(s).trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t; const i = t.indexOf('T'); return i > -1 ? t.slice(0, i) : t; }

// TaskNotes' buildRecurringTaskCompletePlan + applyRecurringTaskCompleteFrontmatterChange,
// transcribed from src/services/task-service/taskRecurringPlanning.ts (4.12.5),
// running on the model package's own recurrence functions.
function oracleToggle(fm, target, today, maintain, stamp) {
  const R = oracle.rec;
  const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const nz = (v) => (v == null || v === '' ? undefined : String(v));
  const task = { recurrence: fm.recurrence, recurrence_anchor: fm.recurrence_anchor, scheduled: nz(fm.scheduled), due: nz(fm.due), dateCreated: nz(fm.dateCreated), complete_instances: strings(fm.complete_instances), skipped_instances: strings(fm.skipped_instances) };
  // No explicit day: TaskNotes uses the scheduled day, else the local today (passed in here).
  const targetDate = target ? utc(target) : (task.recurrence_anchor !== 'completion' && task.scheduled ? utc(datePart(task.scheduled)) : utc(today));
  // core/recurrence.ts wraps addDTSTART with this minute-precision fix.
  const minute = (v) => { const m = v && String(v).trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(Z|[+-]\d{2}:\d{2})?$/); return m ? `${m[1]}T${m[2]}:00${m[3] || ''}` : v; };
  const addDt = (t) => R.addDTSTARTToRecurrenceRule({ ...t, scheduled: minute(t.scheduled), dateCreated: minute(t.dateCreated) });
  const searchDays = (rec) => { const m = rec.match(/(?:^|;)INTERVAL=(\d+)(?:;|$)/); const i = m ? parseInt(m[1], 10) : 1; if (rec.includes('FREQ=DAILY')) return Math.max(30, i * 2); if (rec.includes('FREQ=WEEKLY')) return Math.max(90, i * 14); if (rec.includes('FREQ=MONTHLY')) return Math.max(400, i * 62); if (rec.includes('FREQ=YEARLY')) return Math.max(800, i * 732); return 365; };
  const owning = (() => {
    if ((task.recurrence_anchor || 'scheduled') === 'completion') return null;
    const exact = R.generateRecurringInstances(task, targetDate, targetDate);
    const ts = fmtUTC(targetDate);
    if (exact.some((o) => fmtUTC(o) === ts)) return targetDate;
    const processed = new Set([...(task.complete_instances || []), ...(task.skipped_instances || [])]);
    const past = R.generateRecurringInstances(task, new Date(targetDate.getTime() - searchDays(task.recurrence) * 86400000), targetDate);
    for (let i = past.length - 1; i >= 0; i--) if (!processed.has(fmtUTC(past[i]))) return past[i];
    return R.getNextUncompletedOccurrence(task, { today: ts });
  })();
  const instance = owning || targetDate;
  const dateStr = fmtUTC(instance);
  const ci = task.complete_instances;
  const newComplete = !ci.includes(dateStr);
  const upd = { ...task };
  if (newComplete) { upd.complete_instances = [...ci, dateStr]; upd.skipped_instances = task.skipped_instances.filter((d) => d !== dateStr); }
  else { upd.complete_instances = ci.filter((d) => d !== dateStr); upd.skipped_instances = task.skipped_instances.filter((d) => d !== dateStr); }
  if (newComplete && typeof upd.recurrence === 'string') {
    if ((task.recurrence_anchor || 'scheduled') === 'completion') { const r = R.updateDTSTARTInRecurrenceRule(upd.recurrence, dateStr); if (r) upd.recurrence = r; }
    else if (!upd.recurrence.includes('DTSTART:')) { const r = addDt(upd); if (r) upd.recurrence = r; }
  }
  const base = owning ? { ...upd, scheduled: upd.scheduled ? `${fmtUTC(owning)}${upd.scheduled.slice(datePart(upd.scheduled).length)}` : fmtUTC(owning) } : upd;
  const floor = dateStr > today ? dateStr : today;
  const next = R.updateToNextScheduledOccurrence(base, maintain, { today: floor });
  if (next.scheduled) upd.scheduled = next.scheduled;
  if (next.due) upd.due = next.due;
  const out = JSON.parse(JSON.stringify(fm));
  if (!out.complete_instances) out.complete_instances = [];
  if (!out.skipped_instances) out.skipped_instances = [];
  const cd = strings(out.complete_instances);
  if (newComplete) { if (!cd.includes(dateStr)) out.complete_instances = [...cd, dateStr]; } else out.complete_instances = cd.filter((d) => d !== dateStr);
  out.skipped_instances = upd.skipped_instances || [];
  if (upd.recurrence !== task.recurrence) out.recurrence = upd.recurrence;
  if (upd.scheduled) out.scheduled = upd.scheduled;
  if (upd.due) out.due = upd.due;
  for (const k of ['googleCalendarExceptionOriginalScheduled', 'googleCalendarMovedOriginalDates']) { const v = out[k]; if (v == null || (Array.isArray(v) && !v.length)) delete out[k]; }
  out.dateModified = stamp;
  return out;
}

const realRecurring = [];
for (const dir of VAULT ? ['02 Planner/TaskNotes/Tasks', '02 Planner/TaskNotes/Archive'] : []) {
  let files = []; try { files = fs.readdirSync(path.join(VAULT, dir)); } catch (e) { /* none */ }
  for (const f of files) {
    if (!f.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(VAULT, dir, f), 'utf8');
    if (!/^recurrence: /m.test(text)) continue;
    const fm = {};
    const block = /^---\n([\s\S]*?)\n---/.exec(text); if (!block) continue;
    let key = null;
    for (const line of block[1].split('\n')) {
      let m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (m) { key = m[1]; const v = m[2].trim(); fm[key] = v === '' ? null : v.replace(/^"(.*)"$/, '$1'); continue; }
      m = /^\s+-\s+(.*)$/.exec(line);
      if (m && key) { if (!Array.isArray(fm[key])) fm[key] = []; fm[key].push(m[1].trim().replace(/^"(.*)"$/, '$1')); }
    }
    realRecurring.push({ name: f, fm });
  }
}
if (VAULT) ok(realRecurring.length >= 3, `found the real repeating tasks (${realRecurring.length})`);

if (oracle) {
  const stamp = '2026-10-04T09:00:00.000-06:00';
  let compared = 0;
  const check = (fm0, target, today, label) => {
    const mine = JSON.parse(JSON.stringify(fm0));
    let err = null; let res = null;
    try { res = L.applyRecurringToggle(mine, cfg, { day: target, today, stamp }); } catch (e) { err = e; }
    const theirs = oracleToggle(fm0, target, today, false, stamp);
    compared++;
    if (err) { ok(false, `${label} engine threw`, err.message); return; }
    eq(mine, theirs, label);
    ok(res && L.toDayStr(res.day) === res.day, `${label} reports the day`);
  };
  // the real tasks, ticked on every day of a window around now, from several "todays"
  for (const { name, fm } of realRecurring) {
    for (const today of ['2026-10-04', '2026-10-05', '2026-11-30', '2027-01-01']) {
      check(fm, null, today, `real ${name} no-day @${today}`);
      for (let k = -10; k <= 10; k++) check(fm, D(today, k), today, `real ${name} ${D(today, k)} @${today}`);
    }
    // tick twice = back where it was (except dateModified/scheduled moves)
    const a = JSON.parse(JSON.stringify(fm)); L.applyRecurringToggle(a, cfg, { day: '2026-10-04', today: '2026-10-04', stamp });
    const b = JSON.parse(JSON.stringify(a)); L.applyRecurringToggle(b, cfg, { day: '2026-10-04', today: '2026-10-04', stamp });
    eq(b.complete_instances.filter((d) => d === '2026-10-04').length, (fm.complete_instances || []).filter((d) => d === '2026-10-04').length, `real ${name}: tick twice toggles back`);
  }
  // generated rules
  const R = rng(20261004 + ZONES.indexOf(tz));
  const pick = (a) => a[Math.floor(R() * a.length)];
  const days = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  for (let i = 0; i < 700; i++) {
    const freq = pick(['DAILY', 'DAILY', 'WEEKLY', 'WEEKLY', 'WEEKLY', 'MONTHLY', 'YEARLY']);
    const parts = [`FREQ=${freq}`];
    const iv = pick([1, 1, 1, 2, 3]); if (iv > 1) parts.push(`INTERVAL=${iv}`);
    if (freq === 'WEEKLY' && R() < 0.7) parts.push(`BYDAY=${[...new Set([pick(days), pick(days), pick(days)].slice(0, 1 + Math.floor(R() * 3)))].join(',')}`);
    if (freq === 'MONTHLY' && R() < 0.5) parts.push(`BYMONTHDAY=${pick([1, 5, 15, 28, 31, -1])}`);
    if (R() < 0.08) parts.push(`COUNT=${2 + Math.floor(R() * 20)}`);
    const today = D('2026-06-01', Math.floor(R() * 600));
    const start = D(today, -Math.floor(R() * 120) + 20);
    const hasDt = R() < 0.85;
    const rec = (hasDt ? `DTSTART:${start.replace(/-/g, '')};` : '') + parts.join(';');
    const fm = { status: 'open', priority: 'normal', dateCreated: `${D(start, -2)}T10:11:12.000-06:00`, dateModified: '2026-09-01T00:00:00.000-06:00', tags: ['task'], recurrence: rec };
    const sch = R();
    if (sch < 0.3) fm.scheduled = D(today, -Math.floor(R() * 20));
    else if (sch < 0.5) fm.scheduled = D(today, Math.floor(R() * 20));
    else if (sch < 0.55) fm.scheduled = `${D(today, Math.floor(R() * 5))}T09:30`;
    else if (sch < 0.65) fm.scheduled = null;
    if (R() < 0.35) fm.due = D(today, Math.floor(R() * 30) - 15);
    const ci = []; for (let k = 0; k < Math.floor(R() * 6); k++) ci.push(D(today, -Math.floor(R() * 30)));
    if (R() < 0.8) fm.complete_instances = [...new Set(ci)];
    if (R() < 0.5) fm.skipped_instances = R() < 0.3 ? [D(today, -Math.floor(R() * 10))] : [];
    const target = R() < 0.3 ? null : D(today, Math.floor(R() * 21) - 10);
    check(fm, target, today, `gen#${i} ${rec} t=${target} @${today}`);
  }
  console.log(`oracle: ${compared} repeat ticks compared with TaskNotes' algorithm`);

  // instances and next occurrence, straight
  const R2 = rng(77);
  for (let i = 0; i < 300; i++) {
    const freq = ['DAILY', 'WEEKLY', 'MONTHLY'][i % 3];
    const today = D('2026-01-01', Math.floor(R2() * 700));
    const rec = `DTSTART:${D(today, -40).replace(/-/g, '')};FREQ=${freq}${i % 4 === 0 ? ';INTERVAL=2' : ''}${freq === 'WEEKLY' && i % 2 ? ';BYDAY=MO,TH' : ''}`;
    const task = { recurrence: rec, complete_instances: [D(today, -1), D(today, 0)], skipped_instances: [D(today, 1)] };
    const theirs = oracle.rec.generateRecurringInstances(task, utc(D(today, -10)), utc(D(today, 30))).map(fmtUTC);
    eq(L.instancesBetween({ ...task }, D(today, -10), D(today, 30)), theirs, `instances ${rec} @${today}`);
    const tn = oracle.rec.getNextUncompletedOccurrence(task, { today });
    eq(L.nextUncompleted({ ...task }, today), tn ? fmtUTC(tn) : null, `next open occurrence ${rec} @${today}`);
  }
}

/* ---- 3. new task notes: TaskNotes' key order --------------------------------- */
const STAMP = '2026-10-04T08:15:30.123-06:00';
const cases = [
  { title: 'Buy compost' },
  { title: '  Call  Ana about the van  ', priority: 'high', projects: ['[[04 Inner World/My Life/Projects/Miscellaneous]]'] },
  { title: 'Water the seedlings', recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH', scheduled: '2026-10-05', customFrontmatter: { planned_half: 'am' } },
  { title: 'Fix the drip line', due: '2026-10-06', customFrontmatter: { planned_half: 'pm', planned_order: 10 } },
  { title: 'Plan winter crops', scheduled: '2026-10-19', details: 'Garlic in the corner bed.\n\n- [ ] list seeds\n' },
  { title: 'Weird: name / with # chars?', customFrontmatter: { planned_day: '2026-10-07', planned_order: 10 } },
];
for (const c of cases) {
  const plan = L.planCreate(c, cfg, STAMP, '2026-10-04');
  const yaml = (o) => JSON.stringify(o);
  const content = L.createContent(plan, plan.base, cfg, (o) => yaml(o) + '\n');
  const fmMine = JSON.parse(/^---\n([\s\S]*)\n---\n/.exec(content)[1]);
  if (oracle) {
    const rawTitle = c.title.trim();
    const title = L.titleForStorage(rawTitle); const fileTitle = L.titleForFilename(rawTitle);
    const data = { title, status: c.status || 'open', priority: c.priority || 'normal', due: c.due, scheduled: c.scheduled, projects: c.projects, dateCreated: STAMP, dateModified: STAMP, recurrence: c.recurrence };
    if (data.recurrence && !data.recurrence.includes('DTSTART:')) data.recurrence = oracle.rec.addDTSTARTToRecurrenceRule(data);
    const represented = plan.base === fileTitle && title === fileTitle;
    let fm = oracle.map.mapTaskToFrontmatter(cfg.F.title === 'title' ? { ...oracle.map.DEFAULT_FIELD_MAPPING, ...tnSettings.fieldMapping } : {}, data, 'task', represented);
    fm.tags = ['task'];
    fm = { ...fm, ...(c.customFrontmatter || {}) };
    if (represented) delete fm.title;
    eq(Object.keys(fmMine), Object.keys(fm), `create keys/order: ${c.title}`);
    eq(fmMine, fm, `create values: ${c.title}`);
  }
  ok(content.startsWith('---\n') && /\n---\n\n/.test(content), `create: TaskNotes' file shape (${c.title})`);
  if (c.details) ok(content.endsWith(`${c.details.trim()}\n`), 'create: body = details, trimmed, one newline');
  else ok(content.endsWith('---\n\n'), 'create: empty body leaves one blank line');
}
eq(L.planCreate({ title: 'Weird: name / with # chars?' }, cfg, STAMP, '2026-10-04').base, 'Weird name  with  chars'.replace(/\s+/g, ' '), 'create: filename sanitized like TaskNotes');
ok('title' in L.planCreate({ title: 'Weird: name / with # chars?' }, cfg, STAMP, '2026-10-04').frontmatter, 'create: title kept in frontmatter when the filename cannot carry it');

/* ---- 4. status, archive, timestamps ------------------------------------------- */
{
  const fm = { status: 'open', priority: 'normal', dateCreated: 'x', dateModified: 'y', tags: ['task'] };
  L.applyProperty(fm, cfg, 'status', 'done', { day: '2026-10-04', stamp: STAMP });
  eq(Object.keys(fm), ['status', 'priority', 'dateCreated', 'dateModified', 'tags', 'completedDate'], 'complete: completedDate appended, order kept');
  eq([fm.status, fm.completedDate, fm.dateModified], ['done', '2026-10-04', STAMP], 'complete: values');
  L.applyProperty(fm, cfg, 'status', 'open', { day: '2026-10-05', stamp: STAMP });
  ok(!('completedDate' in fm) && fm.status === 'open', 'uncomplete: completedDate removed');
  const r = { status: 'open', recurrence: 'DTSTART:20260901;FREQ=DAILY', dateModified: 'y' };
  L.applyProperty(r, cfg, 'status', 'done', { day: '2026-10-04', stamp: STAMP });
  ok(!('completedDate' in r), 'repeating task status: no completedDate (TaskNotes rule)');
  const g = { status: 'open', googleCalendarMovedOriginalDates: [], dateModified: 'y' };
  L.applyProperty(g, cfg, 'priority', 'high', { day: '2026-10-04', stamp: STAMP });
  ok(!('googleCalendarMovedOriginalDates' in g) && g.priority === 'high', 'empty calendar field dropped like TaskNotes');
  const d = { due: '2026-10-01', dateModified: 'y' };
  L.applyProperty(d, cfg, 'due', undefined, { day: '2026-10-04', stamp: STAMP });
  ok(!('due' in d), 'clearing due deletes the field');
  const t = { status: 'true' }; L.applyProperty(t, cfg, 'status', 'true', { day: '2026-10-04', stamp: STAMP }); eq(t.status, true, 'status "true" stored as boolean (TaskNotes)');
  const a = { tags: ['task', 'x'], dateModified: 'y' }; L.applyArchive(a, cfg, true, STAMP); eq(a.tags, ['task', 'x', 'archived'], 'archive: tag appended');
  L.applyArchive(a, cfg, true, STAMP); eq(a.tags, ['task', 'x', 'archived'], 'archive twice: one tag');
  const s1 = { tags: 'task' }; L.applyArchive(s1, cfg, true, STAMP); eq(s1.tags, ['task', 'archived'], 'archive: single tag string becomes a list');
}
// Timestamps: TaskNotes' local-time-with-offset format, read back to the same instant.
for (const ms of [Date.UTC(2026, 9, 4, 5, 59, 59, 999), Date.UTC(2026, 9, 4, 6, 0, 0, 0), Date.UTC(2026, 2, 8, 7, 30), Date.UTC(2026, 10, 1, 5, 30), Date.UTC(2026, 3, 5, 15, 0), Date.UTC(2026, 9, 4, 13, 45, 1, 7), Date.UTC(2027, 0, 1, 0, 0)]) {
  const now = new Date(ms);
  const s = L.tnTimestamp(now);
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/.test(s), `timestamp shape ${s}`);
  eq(new Date(s).getTime(), ms, `timestamp is the same instant (${s})`);
  eq(s.slice(0, 10), L.dayOf(now), `timestamp day is the local day (${s})`);
}
// Around local midnight the completion day is the local day of the click.
{
  const base = new Date(2026, 9, 4, 23, 59, 59, 900);
  const after = new Date(base.getTime() + 200);
  eq(L.dayOf(base), '2026-10-04', 'midnight: 23:59:59.9 is still today');
  ok(L.dayOf(after) === '2026-10-05', 'midnight: 00:00:00.1 is tomorrow');
}

/* ---- 5. words, steps, rules, real data ------------------------------------------ */
const TD = '2026-10-04'; // a Sunday
const U = (s) => L.understand(s, TD);
eq(U('call Ana tomorrow afternoon !high'), { priority: 'high', plannedHalf: 'pm', plannedDay: '2026-10-05', title: 'Call Ana' }, 'words: tomorrow afternoon !high');
eq(U('water plants every Monday').recurrence, 'FREQ=WEEKLY;BYDAY=MO', 'words: every Monday');
eq(U('water plants every monday and thursday morning'), { priority: null, recurrence: 'FREQ=WEEKLY;BYDAY=MO,TH', repeatText: 'monday and thursday', plannedHalf: 'am', title: 'Water plants' }, 'words: two weekdays + morning');
eq(U('pay rent every month').recurrence, 'FREQ=MONTHLY', 'words: every month');
eq(U('stretch every other day').recurrence, 'FREQ=DAILY;INTERVAL=2', 'words: every other day');
eq(U('run every other friday').recurrence, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', 'words: every other friday');
eq(U('send report due friday').due, '2026-10-09', 'words: due friday');
eq(U('book flights starts oct 20').start, '2026-10-20', 'words: starts oct 20');
eq(U('taxes due 4/15').due, '2027-04-15', 'words: M/D in the past rolls to next year');
eq(U('pay rent this month').title, 'Pay rent this month', 'words: "this month" is not a weekday');
eq(U('fix the van monday').plannedDay, '2026-10-05', 'words: plain weekday = next one');
eq(U('fix the van next monday').plannedDay, '2026-10-12', 'words: next weekday = a week later (same as the iPhone capture)');
eq(U('fix the van sunday').plannedDay, '2026-10-11', 'words: today\'s weekday = a week ahead');
eq(U('afternoon nap').plannedDay, TD, 'words: a half alone means today');
eq(U('plan on 2026-11-02 !low'), { priority: 'low', plannedDay: '2026-11-02', title: 'Plan' }, 'words: ISO day');
eq(U('meet in 3 days').plannedDay, '2026-10-07', 'words: in 3 days');
eq(U('due tomorrow call Ana tomorrow').due, '2026-10-05', 'words: due wins over a plain day');
ok(!('plannedDay' in U('due tomorrow call Ana tomorrow')), 'words: due wins (no planned day)');
eq(L.parseDayWord('feb 30', TD), null, 'day words: impossible date refused');
eq(L.parseDayWord('next week', TD), '2026-10-05', 'day words: next week = next Monday');
eq(L.repeatWords('DTSTART:20260905;FREQ=DAILY;INTERVAL=2'), 'Every 2 days', 'repeat words: every 2 days');
eq(L.repeatWords('DTSTART:20261005;FREQ=WEEKLY;BYDAY=MO,TH'), 'Every Monday and Thursday', 'repeat words: two weekdays');
eq(L.repeatWords('DTSTART:20260904;FREQ=WEEKLY;INTERVAL=1'), 'Every Friday', 'repeat words: weekly on its start day');
eq(L.repeatWords('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'Every weekday (Mon to Fri)', 'repeat words: weekdays');
eq(L.repeatWords(null), "Doesn't repeat", 'repeat words: none');
eq(L.firstOccurrence('FREQ=WEEKLY;BYDAY=TH', TD), '2026-10-08', 'first occurrence of a new rule');

// steps
const note = '---\nstatus: open\ntags:\n  - task\n---\n\nIntro line\n\n- [ ] one\n- [x] two\n  more about two\n- [ ] three\n  - [ ] nested is not a step\n```\n- [ ] in code\n```\n';
eq(L.readSteps(note).map((s) => [s.text, s.done]), [['one', false], ['two', true], ['three', false]], 'steps: top-level checkboxes only');
const s2 = L.setStepDone(note, L.readSteps(note)[0].line, true);
eq(L.readSteps(s2)[0].done, true, 'steps: tick');
eq(s2.length, note.length, 'steps: tick changes one character');
const s3 = L.addStep(note, 'four');
eq(L.readSteps(s3).map((s) => s.text), ['one', 'two', 'three', 'four'], 'steps: add after the last one');
ok(s3.includes('- [ ] three\n  - [ ] nested is not a step\n- [ ] four'), 'steps: added below the last step and its indented lines');
eq(L.addStep('---\na: 1\n---\n\nBody text\n', 'first'), '---\na: 1\n---\n\n- [ ] first\n\nBody text\n', 'steps: first step goes on top of the body');
eq(L.addStep('---\na: 1\n---\n', 'first'), '---\na: 1\n---\n\n- [ ] first\n', 'steps: first step in an empty body');
const s4 = L.moveStep(note, L.readSteps(note)[2].line, -1);
eq(L.readSteps(s4).map((s) => s.text), ['one', 'three', 'two'], 'steps: move up keeps indented lines');
ok(s4.includes('- [x] two\n  more about two'), 'steps: indented line moved with its step');
eq(L.readSteps(L.removeStep(note, L.readSteps(note)[1].line)).map((s) => s.text), ['one', 'three'], 'steps: remove');
eq(L.setStepDone(note, 0, true), null, 'steps: a line that is not a step is refused');

// rules on made-up tasks
const mk = (o) => Object.assign({ path: `t/${o.title}.md`, title: 'x', status: 'open', priority: 'normal', due: null, plannedDay: null, plannedHalf: null, plannedOrder: 0, recurrenceRaw: null, archived: false, projectLink: null, projectKey: null, start: null }, o);
ok(L.isInboxTask(mk({ title: 'a' }), cfg), 'inbox: no project, no day');
ok(!L.isInboxTask(mk({ title: 'b', projectLink: '[[P]]' }), cfg), 'inbox: a project takes it out');
ok(!L.isInboxTask(mk({ title: 'c', plannedDay: TD }), cfg), 'inbox: a day takes it out');
ok(!L.isInboxTask(mk({ title: 'd', recurrenceRaw: 'FREQ=DAILY' }), cfg), 'inbox: repeating tasks are not inbox');
ok(!L.isInboxTask(mk({ title: 'e', status: 'done' }), cfg), 'inbox: done is not inbox');
ok(L.isOverdueTask(mk({ title: 'f', plannedDay: '2026-10-03' }), TD, cfg), 'overdue: past day');
ok(!L.isOverdueTask(mk({ title: 'g', plannedDay: TD }), TD, cfg), 'overdue: today is not overdue');
ok(L.isLaterTask(mk({ title: 'h', start: '2026-10-05' }), TD), 'later: start in the future');
ok(!L.isLaterTask(mk({ title: 'i', start: TD }), TD), 'later: start today shows');
eq(L.sortOpenTasks([mk({ title: 'z', priority: 'low' }), mk({ title: 'y', plannedDay: '2026-10-01' }), mk({ title: 'x', priority: 'high' })], TD, cfg).map((t) => t.title), ['y', 'x', 'z'], 'sort: overdue, then priority');
eq(L.applyProjectStatus({ status: 'active' }, 'done', TD), { status: 'done', end_date: TD }, 'project closes: end_date set');
eq(L.applyProjectStatus({ status: 'done', end_date: '2026-01-01' }, 'failed', TD), { status: 'failed', end_date: '2026-01-01' }, 'project: an end_date already set is kept');
eq(L.applyProjectStatus({ status: 'done', end_date: '2026-01-01' }, 'active', TD), { status: 'active' }, 'project reopens: end_date removed');
eq(L.applyProjectLink({ projects: ['[[A]]', '[[B]]'] }, cfg.F, '[[C]]'), { projects: ['[[C]]', '[[B]]'] }, 'project link: first entry replaced');
eq(L.applyProjectLink({ projects: ['[[A]]'] }, cfg.F, null), {}, 'project link: removed');
eq(L.projectBodyForPage('---\na: 1\n---\n## Tasks\n\n![[02 Planner/TaskNotes/Views/project-tasks.base]]\n\n## Notes\n\nNote: hi\n'), '## Notes\n\nNote: hi', 'project note: task-list embed left out');

// real data (read-only; the frozen copy unless A4_VAULT): every task and project note parses; overview agrees with the Planner's overdue rule
if (VAULT) {
  const parseFm = (text) => {
    const block = /^---\n([\s\S]*?)\n---/.exec(text); if (!block) return null;
    const fm = {}; let key = null;
    for (const line of block[1].split('\n')) {
      let m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
      if (m) { key = m[1]; const v = m[2].trim(); fm[key] = v === '' ? null : v === 'true' ? true : v === 'false' ? false : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); continue; }
      m = /^\s+-\s+(.*)$/.exec(line);
      if (m && key) { if (!Array.isArray(fm[key])) fm[key] = []; fm[key].push(m[1].trim().replace(/^"(.*)"$/, '$1')); }
    }
    return fm;
  };
  const tasks = [];
  for (const [dir, arch] of [['02 Planner/TaskNotes/Tasks', false], ['02 Planner/TaskNotes/Archive', true]]) {
    for (const f of fs.readdirSync(path.join(VAULT, dir)).filter((x) => x.endsWith('.md'))) {
      const fm = parseFm(fs.readFileSync(path.join(VAULT, dir, f), 'utf8'));
      const t = L.readTask(fm, `${dir}/${f}`, f.replace(/\.md$/, ''), cfg, arch);
      if (t) tasks.push(t);
    }
  }
  ok(tasks.length > 40, `real tasks read (${tasks.length})`);
  const live = tasks.filter((t) => !t.archived);
  const P = require(built('a4-planner')).logic;
  const plannerOverdue = P.overdueOf(live.map((t) => ({ ...t })), TD, ['done', 'closed']).map((t) => t.path).sort();
  eq(live.filter((t) => L.isOverdueTask(t, TD, cfg)).map((t) => t.path).sort(), plannerOverdue, 'real data: overdue = the Planner\'s overdue list');
  const plannerUns = P.unscheduledOf(live, ['done', 'closed']).filter((t) => !t.projectKey).map((t) => t.path).sort();
  eq(live.filter((t) => L.isInboxTask(t, cfg)).map((t) => t.path).sort(), plannerUns, 'real data: Inbox = the Planner\'s unscheduled "No project" group');
  const projects = [];
  const PD = path.join(VAULT, '04 Inner World/My Life/Projects');
  for (const f of fs.readdirSync(PD).filter((x) => x.endsWith('.md'))) { const p = L.readProject(parseFm(fs.readFileSync(path.join(PD, f), 'utf8')), `x/${f}`, f.replace(/\.md$/, '')); if (p) projects.push(p); }
  const groups = L.overviewGroups(projects, 'all', '');
  const closed = L.closedProjects(projects, '');
  // Updated in section 4: ideas and cold storage sit on the board's own tabs (neither open nor closed).
  const shelved = projects.filter((p) => p.status === 'idea' || p.status === 'cold-storage');
  eq(groups.reduce((a, g) => a + g.projects.length, 0) + closed.length + shelved.length, projects.length, 'real data: every project is in Work, Personal, Unsorted, Closed, Ideas or Cold storage');
  // Updated in section 4: the board branch added waiting and blocked (OPEN_ORDER in src/projects).
  const ord = (s) => ({ active: 0, paused: 1, waiting: 2, blocked: 3, backlog: 4 }[s] ?? 5);
  ok(groups.every((g) => g.projects.every((p, i, a) => !i || ord(a[i - 1].status) <= ord(p.status))), 'real data: active, paused, waiting, blocked, then backlog');
  for (const p of projects) { const s = L.projectStats(p, tasks, TD, cfg); ok(s.done + s.open + s.later <= s.total && s.done >= 0, `real data: counts add up for ${p.name}`); }

  /* ---- Find a task (mockup approved 2026-10-06) on the real tasks ---- */
  const pageSearch = (q) => L.searchTasks(tasks.filter((t) => !t.archived || !L.isOpenTask(t, cfg)), q, cfg, 50);
  for (const q of ['mood', 'check', 'task', 'xq', 'a', '']) eq(L.findTasks(tasks, q, cfg).map((t) => t.path), pageSearch(q).map((t) => t.path), `find: same results as the Projects page search for "${q}"`);
  eq(L.findTasks(tasks, 'k', cfg), [], 'find: one letter shows nothing yet (the page search starts at two)');
  const hits = L.findTasks(tasks, 'MOOD', cfg);
  ok(hits.length >= 1 && hits.every((t) => /mood/i.test(t.title + ' ' + t.path + ' ' + (t.project || ''))), `find: case ignored, every result really matches (${hits.length})`);
  const firstDone = hits.findIndex((t) => !L.isOpenTask(t, cfg));
  ok(firstDone < 0 || hits.slice(firstDone).every((t) => !L.isOpenTask(t, cfg)), 'find: open tasks first, finished ones after');
  let missing = [];
  for (const t of tasks) { if (t.archived && L.isOpenTask(t, cfg)) continue; if (!L.findTasks(tasks, t.title, cfg).includes(t)) missing.push(t.title); }
  eq(missing, [], 'find: every listed real task is found by its own title');
  // Someday: a copy of every real open one-off task set to Someday is still found, marked "someday".
  let sdOk = true; let sdN = 0;
  for (const t of tasks.filter((x) => !x.archived && L.isOpenTask(x, cfg))) {
    const c = Object.assign({}, t, { status: 'someday' }); const list = tasks.map((x) => (x === t ? c : x));
    sdN++; if (!L.findTasks(list, t.title, cfg).includes(c) || !/ · someday$/.test(L.findNote(c, TD, cfg))) sdOk = false;
  }
  ok(sdOk && sdN > 10, `find: Someday tasks are found and marked "someday" (${sdN} real tasks tried)`);
  for (const t of tasks.filter((x) => x.status === 'someday')) ok(L.findTasks(tasks, t.title, cfg).includes(t), `find: real Someday task found: ${t.title}`);
}
{
  const mk = (o) => Object.assign({ path: 't/x.md', title: 'x', status: 'open', due: null, plannedDay: null, recurrenceRaw: null, archived: false, projectKey: null, project: null, start: null }, o);
  eq(L.findNote(mk({ project: 'Garden Plan', due: '2026-10-05' }), TD, cfg), 'Garden Plan · due tomorrow', 'find line: project and due day');
  eq(L.findNote(mk({ project: 'P', plannedDay: TD }), TD, cfg), 'P · today', 'find line: planned day');
  eq(L.findNote(mk({}), TD, cfg), 'no project · no day', 'find line: no project, no day');
  eq(L.findNote(mk({ project: 'P', status: 'done', due: TD }), TD, cfg), 'P · done', 'find line: finished task says done');
  eq(L.findNote(mk({ project: 'P', status: 'someday' }), TD, cfg), 'P · someday', 'find line: Someday task says someday');
  eq(L.findNote(mk({ project: 'P', start: '2026-12-01' }), TD, cfg), 'P · starts Tue, Dec 1', 'find line: a later start');
  ok(/^P · every/.test(L.findNote(mk({ project: 'P', recurrenceRaw: 'DTSTART:20260904;FREQ=DAILY' }), TD, cfg)), 'find line: a repeating task shows its repeat');
  eq(L.findMark('Check with Sam to log in', 'sam'), ['Check with ', 'Sam', ' to log in'], 'find: the matched letters are marked, case kept');
  eq([L.findMark('abc', 'x'), L.findMark('abc', 'a')], [null, null], 'find: no mark without a match or under two letters');
  const src = fs.readFileSync(SRC, 'utf8');
  ok(/addCommand\(\{ id: 'find-task', name: 'Find a task', hotkeys: \[\{ modifiers: \['Mod', 'Shift'\], key: 'O' \}\], callback: \(\) => this\.openFind\(\) \}\)/.test(src), 'command "Find a task", Cmd/Ctrl+Shift+O');
  ok(/this\.shown = findTasks\(this\.tasks, query, this\.cfg, this\.limit\)/.test(src) && /this\.tasks = plugin\.engine\.collectTasks\(true\)/.test(src), 'Find window uses the Projects page search on every task');
  ok(/onChooseSuggestion\(t\) \{ this\.plugin\.openFile\(t\.path\); \}/.test(src), 'Enter opens the task note (its card) in a new tab');
  ok(/setPlaceholder\('Find a task or project…'\)/.test(src) && /'to open the task'/.test(src), 'Find window words as in the mockup');
}

/* ---- Someday (mockup approved 2026-10-06; GL-002 status `someday`) ---- */
{
  const TDs = '2026-10-04';
  const mkS = (o) => Object.assign({ path: `t/${o.title}.md`, title: 'x', status: 'open', priority: 'normal', due: null, plannedDay: null, plannedHalf: null, plannedOrder: 0, recurrenceRaw: null, archived: false, projectLink: null, projectKey: null, start: null }, o);
  const sA = mkS({ title: 'sA', status: 'someday' });
  const sB = mkS({ title: 'sB', status: 'someday', plannedDay: '2026-10-01', projectKey: 'P', projectLink: '[[P]]' });
  const sC = mkS({ title: 'sC', status: 'someday', start: '2026-12-01', projectKey: 'P', projectLink: '[[P]]' });
  const sD = mkS({ title: 'sD', status: 'someday', recurrenceRaw: 'DTSTART:20260904;FREQ=DAILY', projectKey: 'P', projectLink: '[[P]]' });
  const oE = mkS({ title: 'oE', projectKey: 'P', projectLink: '[[P]]' });
  const oF = mkS({ title: 'oF', start: '2026-12-01', projectKey: 'P', projectLink: '[[P]]' });
  ok(!L.isInboxTask(sA, cfg), 'someday: not in the Inbox');
  ok(!L.isOverdueTask(sB, TDs, cfg), 'someday: never overdue');
  ok(!L.isLaterTask(sC, TDs) && L.isLaterTask(oF, TDs), 'someday wins over "later"');
  ok(L.isOpenTask(sA, cfg), 'someday: still open (not finished)');
  const st = L.projectStats({ key: 'P' }, [sB, sC, sD, oE, oF], TDs, cfg);
  eq([st.open, st.later, st.someday, st.overdue, st.next && st.next.title], [1, 1, 3, 0, 'oE'], 'project counts: someday tasks counted apart, never "next"');
  // Source: the Schedule box line and the project page tick box.
  const src = fs.readFileSync(SRC, 'utf8');
  ok(/'Someday'\); el\(sd, 'span', 'a4pj-k', 'no day, kept for later'\)/.test(src), 'Schedule box: "Someday · no day, kept for later"');
  ok(/Show someday tasks \(\$\{someday\.length\}\)/.test(src) && /settings\.ui\.someday\[p\.path\]/.test(src), 'project page: "Show someday tasks (N)" tick box, remembered per project');
  ok(/someday: s\.ui && s\.ui\.someday/.test(src), 'settings keep the someday tick boxes');
}

/* ---- Someday through the engine (in-memory notes; the real repeats copied in) ---- */
{
  const TaskEngine = require(MAIN).TaskEngine;
  const notes = new Map(); const files = new Map();
  const put = (p, fm) => { const f = Object.assign(new TFile(), { path: p, name: p.split('/').pop(), basename: p.split('/').pop().replace(/\.md$/, ''), extension: 'md' }); files.set(p, f); notes.set(p, fm); };
  const app = { plugins: { plugins: {} }, vault: { getAbstractFileByPath: (p) => files.get(p) || null },
    metadataCache: { getFileCache: (f) => (notes.has(f.path) ? { frontmatter: notes.get(f.path) } : null), getFirstLinkpathDest: () => null },
    fileManager: { processFrontMatter: async (f, fn) => { fn(notes.get(f.path)); } } };
  const eng = new TaskEngine({ app, settings: { tnSnapshot: null, archiveQueue: [] }, archiveQueueOnStatus: async () => false, cancelArchive: async () => {} });
  eng.now = () => new Date(2026, 9, 6, 17, 45, 0);
  const TDIR = '02 Planner/TaskNotes/Tasks';
  const parseReal = (name) => { try { const t = fs.readFileSync(path.join(VAULT, TDIR, name + '.md'), 'utf8'); const b = /^---\n([\s\S]*?)\n---/.exec(t)[1]; const fm = {}; let k = null; for (const line of b.split('\n')) { let m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line); if (m) { k = m[1]; const v = m[2].trim(); fm[k] = v === '' ? null : v === '[]' ? [] : /^-?\d+$/.test(v) ? Number(v) : v.replace(/^"(.*)"$/, '$1'); continue; } m = /^\s+-\s+(.*)$/.exec(line); if (m && k) { if (!Array.isArray(fm[k])) fm[k] = []; fm[k].push(m[1].trim().replace(/^"(.*)"$/, '$1')); } } return fm; } catch (e) { return null; } };
  const run = async () => {
    // One-off with a due time and a reminder.
    const P1 = `${TDIR}/someday-one.md`;
    const one = { status: 'open', priority: 'normal', due: '2026-10-09T16:30', dateCreated: '2026-10-01T09:00:00.000-06:00', dateModified: '2026-10-01T09:00:00.000-06:00', tags: ['task'], planned_half: 'pm', planned_order: 20, reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT15M' }] };
    put(P1, JSON.parse(JSON.stringify(one)));
    const w = await eng.someday(P1);
    const a = notes.get(P1);
    eq([a.status, a.due, a.planned_half, a.planned_order, a.reminders.length], ['someday', undefined, undefined, undefined, 1], 'engine someday: status, due and day off, reminder entry kept');
    ok(/^2026-10-06T17:45:00\.000[-+]\d\d:\d\d$/.test(a.dateModified), 'engine someday: dateModified stamped as TaskNotes does');
    await w.undo();
    eq(JSON.stringify(notes.get(P1)), JSON.stringify(one), 'engine someday: Undo puts it back exactly, key order too');
    await eng.someday(P1);
    await eng.move(P1, '2026-10-12', 'am', 10);
    eq([notes.get(P1).status, notes.get(P1).planned_day], ['open', '2026-10-12'], 'round trip: Schedule back to a day = open on that day');
    await eng.someday(P1);
    await eng.setDue(P1, '2026-10-15T09:00');
    eq([notes.get(P1).status, notes.get(P1).due], ['open', '2026-10-15T09:00'], 'round trip: typing a due date brings it back');
    await eng.someday(P1);
    await eng.setStart(P1, '2026-10-20');
    eq([notes.get(P1).status, notes.get(P1).scheduled], ['open', '2026-10-20'], 'round trip: a start date brings it back');
    await eng.setDue(P1, null);
    eq(notes.get(P1).status, 'open', 'removing a date never touches status');
    // The real repeats.
    // Repeats by name: the frozen copy's, or the owner's from A4_REAL_REPEATS (names stay out of the repo).
    for (const name of REPEATS) {
      const real = parseReal(name);
      if (!real) { ok(false, `real repeat present: ${name}`); continue; }
      const p = `${TDIR}/${name}.md`;
      put(p, JSON.parse(JSON.stringify(real)));
      await eng.someday(p);
      const s1 = notes.get(p);
      const changed = Object.keys({ ...real, ...s1 }).filter((k) => JSON.stringify(real[k]) !== JSON.stringify(s1[k])).sort();
      eq(changed, ['dateModified', 'status'], `real repeat "${name}": Someday changes status (and the stamp) only`);
      const it = L.readTask(s1, p, name, cfg, false);
      let onAny = false; for (let i = 0; i < 60; i++) if (L.taskOnDay(it, L.addDays('2026-10-06', i))) onAny = true;
      ok(!onAny, `real repeat "${name}": on no day while someday`);
      await eng.setStatus(p, 'open');
      const s2 = notes.get(p);
      const changed2 = Object.keys({ ...real, ...s2 }).filter((k) => JSON.stringify(real[k]) !== JSON.stringify(s2[k])).sort();
      eq(changed2, ['dateModified'], `real repeat "${name}": set back to open = the note as it was (bar the stamp)`);
      const r2 = await eng.toggleInstance(p, '2026-10-07');
      ok(r2 && r2.result && r2.result.done && notes.get(p).complete_instances.includes('2026-10-07'), `real repeat "${name}": ticking still works after the round trip`);
      // A new start day also brings a repeating someday task back, its rule intact bar DTSTART.
      put(p, JSON.parse(JSON.stringify(real)));
      await eng.someday(p);
      await eng.setStart(p, '2026-10-10');
      ok(notes.get(p).status === 'open' && /FREQ=DAILY/.test(notes.get(p).recurrence) && /DTSTART:20261010/.test(notes.get(p).recurrence), `real repeat "${name}": a new start day brings it back`);
    }
  };
  globalThis.__somedayRun = run;
}

/* ---- 6. Work / Personal lists (bug 2026-10-05: the sidebar's "Personal projects"
 * opened the overview with every project; the focus only scrolled to the section) ---- */
{
  const mk = (name, sphere, status) => ({ path: `x/${name}.md`, name, key: name, sphere, status, goal: null, client: null, endDate: null });
  const ps = [mk('W1', 'work', 'active'), mk('W2', 'work', 'done'), mk('P1', 'personal', 'paused'), mk('P2', 'personal', 'failed'), mk('U1', 'unsorted', 'active')];
  const names = (gs) => gs.map((g) => [g.sphere, g.projects.map((p) => p.name)]);
  eq(names(L.overviewGroups(ps, 'all', '', 'personal')), [['personal', ['P1']]], 'personal list: personal projects only');
  eq(names(L.overviewGroups(ps, 'all', '', 'work')), [['work', ['W1']]], 'work list: work projects only');
  eq(names(L.overviewGroups(ps, 'all', '')), [['work', ['W1']], ['personal', ['P1']], ['unsorted', ['U1']]], 'no sphere: every list');
  eq(L.closedProjects(ps, '', 'personal').map((p) => p.name), ['P2'], 'personal list: closed personal only');
  eq(L.closedProjects(ps, '', 'work').map((p) => p.name), ['W2'], 'work list: closed work only');
  eq(L.closedProjects(ps, '').map((p) => p.name).sort(), ['P2', 'W2'], 'no sphere: all closed');
  // One open/closed rule (0.1.7): the overview, the Closed list and the sidebar's counts.
  eq(ps.filter(L.isOpenProject).map((p) => p.name), ['W1', 'P1', 'U1'], 'isOpenProject: what the overview lists');
  ok(ps.every((p) => L.isOpenProject(p) !== L.closedProjects(ps, '').includes(p)), 'isOpenProject: exactly the ones not in Closed');
  ok(L.isOpenProject(null) === false, 'isOpenProject: no project, not open');
  const ts = [{ projectKey: 'W1' }, { projectKey: 'P1' }, { projectKey: null }, { projectKey: 'U1' }];
  eq(L.sphereTasks(ts, ps, 'personal').map((t) => t.projectKey), ['P1'], 'personal list: search finds personal-project tasks only');
  eq(L.sphereTasks(ts, ps, null).length, 4, 'no sphere: search finds every task');
  // The view must pass the sidebar's choice through and keep it (static checks on the source).
  const src = fs.readFileSync(SRC, 'utf8');
  ok(/id: 'open-personal'[^\n]*focus: 'personal'/.test(src), "command open-personal asks for the personal list");
  ok(/id: 'open-work'[^\n]*focus: 'work'/.test(src), "command open-work asks for the work list");
  ok(/overviewGroups\(this\.projects, this\.filter, this\.query, sp\)/.test(src) && /closedProjects\(this\.projects, this\.query, sp\)/.test(src), 'the overview filters by the chosen list');
  ok(!/this\.state\.focus = null/.test(src), 'the chosen list is not dropped after the first draw');
  // Real data (the frozen copy unless A4_VAULT): the two lists split the projects exactly, with no overlap.
  if (VAULT) {
  const parse = (t) => { const m = /^---\n([\s\S]*?)\n---/.exec(t); const fm = {}; if (m) for (const l of m[1].split('\n')) { const x = /^([\w-]+):\s*(.*)$/.exec(l); if (x) fm[x[1]] = x[2].trim().replace(/^"(.*)"$/, '$1'); } return fm; };
  const PD = path.join(VAULT, '04 Inner World/My Life/Projects');
  const real = fs.readdirSync(PD).filter((f) => f.endsWith('.md')).map((f) => L.readProject(parse(fs.readFileSync(path.join(PD, f), 'utf8')), `x/${f}`, f.replace(/\.md$/, ''))).filter(Boolean);
  // Ideas and Cold Storage live on the board's own tabs, not in the List (projects board, 2026-10-13).
  const inList = (sp) => [...L.overviewGroups(real, 'all', '', sp).flatMap((g) => g.projects), ...L.closedProjects(real, '', sp), ...real.filter((p) => p.sphere === sp && (p.status === 'idea' || p.status === 'cold-storage'))];
  const rp = inList('personal'); const rw = inList('work');
  ok(rp.length && rp.every((p) => p.sphere === 'personal'), `real data: Personal shows only personal projects (${rp.length})`);
  ok(rw.length && rw.every((p) => p.sphere === 'work'), `real data: Work shows only work projects (${rw.length})`);
  eq(rp.length + rw.length + real.filter((p) => p.sphere === 'unsorted').length, real.length, 'real data: Work + Personal + Unsorted = every project');
  }
}

/* ---- 7. Task card fixes, 0.1.3 (2026-10-05) ----
 * (a) Blocked by / Blocks picker: the owner saw ~12 tasks, no scroll, other projects
 *     on top. Cause: the list was cut at 12 (the owner's project had only one other open
 *     task, so everything after it was other projects A to Z). Now every open
 *     task is listed: own project first, then other projects; search covers all.
 * (b) Clicking Morning / Afternoon / Any time / Status / Priority jumped the note
 *     to the top. Cause: the card is emptied before it is redrawn; on a short
 *     note the page then has nothing to scroll and the browser resets it to 0.
 * (c) The "Start or due?" key is gone from project pages. */
{
  const mk = (title, projectKey, project) => ({ title, projectKey: projectKey || null, project: project || projectKey || null, path: `T/${title}.md` });
  const cands = [mk('zeta', 'B'), mk('Alpha', 'B'), mk('mine z', 'A'), mk('Mine a', 'A'), mk('inbox one'), mk('beta', 'C'), mk('Aardvark', 'C')];
  const g = L.depPickGroups(cands, 'A', '');
  eq(g.mine.map((c) => c.title), ['Mine a', 'mine z'], 'picker: this project first, A to Z (case-insensitive)');
  eq(g.others.map((c) => c.title), ['Alpha', 'zeta', 'Aardvark', 'beta', 'inbox one'], 'picker: other projects by project then A to Z, Inbox last');
  eq(g.mine.length + g.others.length, cands.length, 'picker: every candidate listed once');
  const q = L.depPickGroups(cands, 'A', '  A ');
  eq(q.mine.map((c) => c.title), ['Mine a'], 'picker search: narrows this project');
  eq(q.others.map((c) => c.title), ['Alpha', 'zeta', 'Aardvark', 'beta'], 'picker search: also searches the other projects');
  eq(L.depPickGroups(cands, 'A', 'nothing like this').mine.length + L.depPickGroups(cands, 'A', 'nothing like this').others.length, 0, 'picker search: no match, nothing listed');
  const noProj = L.depPickGroups(cands, null, '');
  eq([noProj.mine.length, noProj.others.length], [0, cands.length], 'picker for an Inbox task: everything in one list');
  const many = Array.from({ length: 150 }, (_, i) => mk(`Task ${String(i).padStart(3, '0')}`, i % 3 ? 'X' : 'A'));
  const gm = L.depPickGroups(many, 'A', '');
  eq(gm.mine.length + gm.others.length, 150, 'picker: no cap (150 of 150 listed)');
  eq(L.depPickGroups(many, 'A', 'Task 14').others.map((c) => c.title), ['Task 140', 'Task 142', 'Task 143', 'Task 145', 'Task 146', 'Task 148', 'Task 149'], 'picker search: finds tasks far down the list');
  // Real data (read-only; the frozen copy unless A4_VAULT): every open task is reachable from every open task's picker.
  if (VAULT) {
  const parse = (t) => { const m = /^---\n([\s\S]*?)\n---/.exec(t); const fm = {}; let key = null; if (m) for (const line of m[1].split('\n')) { let x = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line); if (x) { key = x[1]; const v = x[2].trim(); fm[key] = v === '' ? null : v.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1'); continue; } x = /^\s+-\s+(.*)$/.exec(line); if (x && key) { if (!Array.isArray(fm[key])) fm[key] = []; fm[key].push(x[1].trim().replace(/^"(.*)"$/, '$1')); } } return fm; };
  const TD2 = path.join(VAULT, '02 Planner/TaskNotes/Tasks');
  const open = fs.readdirSync(TD2).filter((f) => f.endsWith('.md')).map((f) => L.readTask(parse(fs.readFileSync(path.join(TD2, f), 'utf8')), `x/${f}`, f.replace(/\.md$/, ''), cfg, false)).filter((t) => t && L.isOpenTask(t, cfg));
  let reach = true; let order = true;
  for (const t of open) {
    const r = L.depPickGroups(open.filter((c) => c.path !== t.path), t.projectKey, '');
    if (r.mine.length + r.others.length !== open.length - 1) reach = false;
    if (!r.mine.every((c) => c.projectKey === t.projectKey) || r.others.some((c) => t.projectKey && c.projectKey === t.projectKey)) order = false;
  }
  ok(open.length > 12 && reach, `real data: every one of ${open.length} open tasks reachable from each picker (old cap was 12)`);
  ok(order, 'real data: own project group holds only own-project tasks, and all of them');
  }
  // Static checks on the source.
  const src = fs.readFileSync(SRC, 'utf8');
  const pick = src.slice(src.indexOf('  depPick(t, mode'), src.indexOf('  projectPick(t, anchor'));
  ok(pick.length > 100 && !/\.slice\(0,\s*\d+\)/.test(pick), 'picker: no cut-off on the list');
  ok(/'Other projects'/.test(pick) && /el\(host, 'div', 'a4pj-grp', projName\)/.test(pick), 'picker: project heading, then "Other projects"');
  ok(/is-deps/.test(pick) && /fit: true/.test(pick), 'picker: scrolling list class and fit-to-screen placement');
  const css = fs.readFileSync(path.join(path.dirname(MAIN), 'styles.css'), 'utf8');
  ok(/\.a4pj-pop\.is-deps \.a4pj-pop-list \{[^}]*overflow-y: auto/.test(css) && /\.a4pj-pop\.is-deps \.a4pj-pop-list \{[^}]*min-height: 0/.test(css), 'picker: the list itself scrolls');
  ok(/is-wide is-deps/.test(pick) && /is-deps\.is-narrow \{[^}]*width: min\(/.test(css), 'picker: fits a phone-width screen');
  const card = src.slice(src.indexOf('class TaskCardManager'), src.indexOf('  depRow(host, t, mode'));
  ok(/render\(card, view, file\) \{\s*const hold = card\.isConnected \? card\.offsetHeight : 0;\s*if \(hold\) card\.style\.minHeight = `\$\{hold\}px`;\s*try \{ this\.draw\(card, view, file\); \} finally \{ card\.style\.minHeight = ''; \}/.test(card), 'card redraw holds its height (no jump to the top)');
  ok((card.match(/card\.empty\(\)/g) || []).length === 1 && card.indexOf('card.empty()') > card.indexOf('  draw(card, view, file)'), 'card is only emptied inside the held redraw');
  ok(!/'Start or due\?'/.test(src) && !/a4pj-legend/.test(src) && !/a4pj-legend/.test(css), 'project page: "Start or due?" key removed');
}

/* ---- Planner button: A4 Planner only (old Daily Planner fallback dropped 0.1.9) ---- */
{
  const P = require(MAIN);
  const ran = [];
  const self = (ids) => { const c = { commands: Object.fromEntries(ids.map((i) => [i, {}])), executeCommandById: (i) => ran.push(i) }; return { app: { commands: c }, run: P.prototype.run }; };
  P.prototype.openPlanner.call(self(['a4-planner:open', 'a4-daily-planner:open-board']));
  eq(ran, ['a4-planner:open'], 'planner button opens the A4 Planner');
  ran.length = 0;
  P.prototype.openPlanner.call(self(['a4-daily-planner:open-board']));
  eq(ran, [], 'old Daily Planner is never a fallback');
  ok(!/a4-daily-planner/.test(require('fs').readFileSync(SRC, 'utf8').replace(/\/\/.*$/gm, '')), 'no old Daily Planner reference in code');
}

/* ---- task card colour: sample A "Soft" (approved 2026-10-07) ---- */
{
  const CA = require(MAIN).cardAccent;
  const appWith = (look) => ({ plugins: { plugins: look === undefined ? {} : { 'a4-today': { look } } } });
  eq(CA.cardAccentId(appWith(undefined)), 'blue', 'card accent: Ink blue when A4 Today is not installed');
  eq(CA.cardAccentId(appWith({ accent: 'orange' })), 'orange', "card accent: follows A4 Today's Orange");
  eq(CA.cardAccentId(appWith({ accent: 'plum' })), 'plum', "card accent: follows A4 Today's Plum");
  eq(CA.cardAccentId(appWith({ accent: 'accent' })), 'accent', 'card accent: "Follow Obsidian accent" passes through');
  eq(CA.cardAccentId(appWith({ accent: 'nonsense' })), 'blue', 'card accent: an unknown value falls back to Ink blue');
  eq(CA.cardAccentId(null), 'blue', 'card accent: no app at all is safe');
  eq(CA.CARD_ACCENTS.orange, ['#d43f16', '#ff5a2d'], 'card accent: Orange is the INKLINE marker pair');
  eq(CA.CARD_ACCENTS.blue, ['#1d4ed8', '#86aefc'], 'card accent: Ink blue shades match A4 Today');
  const props = {}; const fakeEl = { style: { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; } } };
  CA.setCardAccent(fakeEl, appWith(undefined));
  eq([props['--pj-acc-l'], props['--pj-acc-d']], ['#1d4ed8', '#86aefc'], 'card accent: light and dark shades set on the card');
  CA.setCardAccent(fakeEl, appWith({ accent: 'accent' }));
  ok(!('--pj-acc-l' in props) && !('--pj-acc-d' in props), "card accent: Obsidian's accent leaves the shades unset");
  const src = fs.readFileSync(SRC, 'utf8');
  const css = fs.readFileSync(path.join(path.dirname(MAIN), 'styles.css'), 'utf8');
  const draw = src.slice(src.indexOf('  draw(card, view, file)'), src.indexOf('  depRow(host, t, mode'));
  ok(/setCardAccent\(card, plugin\.app\)/.test(draw), 'card colour: accent set on every draw');
  ok(/'a4pj-seg a4pj-stseg'/.test(draw) && /b\.dataset\.st = k;/.test(draw), 'card colour: status buttons carry their value');
  ok(/'a4pj-seg a4pj-halfseg'/.test(draw) && /b\.dataset\.half = k \|\| 'any';/.test(draw), 'card colour: Morning / Afternoon buttons carry their value');
  ok(/const dueToday = k === 'due' && val === today && open && !t\.recurrenceRaw;/.test(draw) && /dueToday \? ' is-today' : ''/.test(draw), 'card colour: Due today is marked (open, one-off tasks only)');
  ok(!/\.a4pj-prisel button \{ opacity: \.38; \}/.test(css) && !/prisel button[^{]*\{[^}]*opacity/.test(css), 'card colour: unpicked priorities are no longer faded');
  ok(/\.a4pj-prisel button \.a4pj-chip \{ color: var\(--pj-choice\)/.test(css), 'card colour: unpicked priorities are plain grey');
  ok(/--pj-acc: var\(--ink-marker, var\(--pj-acc-l, var\(--interactive-accent\)\)\)/.test(css) && /body\.theme-dark \.a4pj-card \{\s*--pj-acc: var\(--ink-marker, var\(--pj-acc-d/.test(css), "card colour: INKLINE's marker wins, then the A4 accent, light and dark");
  for (const [sel, name] of [['data-st="in-progress"', 'In progress'], ['data-st="blocked"', 'Waiting'], ['data-half="am"', 'Morning'], ['.a4pj-chip.is-top', 'High'], ['.a4pj-pick.is-today', 'Due today'], ['.a4pj-pick.is-late', 'overdue']]) ok(css.includes(sel), `card colour: ${name} has a colour rule`);
  ok(/\.a4pj-card \.a4pj-bigtick \{ border-color: var\(--pj-acc\)/.test(css), 'card colour: the tick circle is outlined in the accent');
}

(globalThis.__somedayRun ? globalThis.__somedayRun() : Promise.resolve()).catch((e) => ok(false, 'someday engine checks threw', e && e.stack)).then(() => console.log(`RESULT ${n} ${failed}`));
