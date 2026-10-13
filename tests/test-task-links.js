#!/usr/bin/env node
/* Tests for A4 Projects 0.6.0 "task links": the status circle, priority dot,
 * title and dates drawn on every link to a task note (TaskNotes' old inline
 * task look, restored 2026-10-08). Pure parts only; the drawing and ticking
 * were checked in a hidden test Obsidian (Dex journal 2026-10-08).
 * Built file for behaviour, src/ for text (tests/lib/paths.js). */
'use strict';
const path = require('path');
const fs = require('fs');
const Module = require('module');

const { built, source } = require('./lib/paths');
const VAULT = process.env.A4_VAULT || null;
const MAIN = built('a4-projects');

class TFile {}
class TFolder {}
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const L = require(MAIN).logic;

let n = 0; let failed = 0;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

const TODAY = '2026-10-08';
// The plugin's saved TaskNotes snapshot: the live one with A4_VAULT, else a frozen copy (2026-10-13;
// statuses, priorities, colours and field names only).
const snapshot = VAULT ? JSON.parse(fs.readFileSync(path.join(VAULT, '.obsidian/plugins/a4-projects/data.json'), 'utf8')).tnSnapshot || {}
  : JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tn-snapshot.json'), 'utf8'));
const cfg = L.engineConfig(snapshot);
const SC = L.colorMap(snapshot.customStatuses, {});
const PC = L.colorMap(snapshot.customPriorities, {});
const task = (fm) => L.readTask({ tags: ['task'], status: 'open', priority: 'normal', ...fm }, '02 Planner/TaskNotes/Tasks/X.md', 'X', cfg, false);

// colours
eq(L.colorMap([{ value: 'open', color: '#ff5a2d' }, { value: 'x' }], { none: '#ccc' }), { none: '#ccc', open: '#ff5a2d' }, 'colorMap: list colours over the fallback, entries with no colour skipped');
eq(L.colorMap(null, { a: '1' }), { a: '1' }, 'colorMap: no list = fallback');

// dates (TaskNotes wording)
eq(L.linkDateText('Due', TODAY, TODAY, true), 'Due: Today', 'date: today');
eq(L.linkDateText('Due', '2026-10-12', TODAY, true), 'Due: Oct 12', 'date: this year, month and day');
eq(L.linkDateText('Due', '2026-10-05', TODAY, true), 'Due: Oct 5 (overdue)', 'date: past due is marked overdue');
eq(L.linkDateText('Due', '2026-10-05', TODAY, false), 'Due: Oct 5', 'date: no overdue mark when asked not to (done task)');
eq(L.linkDateText('Scheduled', '2027-01-03', TODAY, false), 'Scheduled: Jan 3, 2027', 'date: another year shows the year');
eq(L.linkDateText('Due', null, TODAY, true), '', 'date: none');

// the widget's state
const open = L.taskLinkView(task({}), cfg, TODAY, SC, PC);
ok(!open.done, 'view: open task is not done');
eq(open.statusColor, SC.open, 'view: open ring uses the Open colour');
eq(open.priorityColor, PC.normal, 'view: priority dot uses the priority colour');
eq(open.dates, [], 'view: no dates');
const done = L.taskLinkView(task({ status: 'done', due: '2026-10-01' }), cfg, TODAY, SC, PC);
ok(done.done, 'view: done task is done');
eq(done.statusColor, SC.done, 'view: done ring uses the Done colour');
eq(done.dates, ['Due: Oct 1'], 'view: done task shows its due date without "overdue"');
const closed = L.taskLinkView(task({ status: 'closed' }), cfg, TODAY, SC, PC);
eq(closed.done, L.isCompletedIn(cfg, 'closed'), 'view: any completed status counts as done');
const late = L.taskLinkView(task({ due: '2026-10-05', scheduled: '2026-10-04' }), cfg, TODAY, SC, PC);
eq(late.dates, ['Due: Oct 5 (overdue)', 'Scheduled: Oct 4'], 'view: due then scheduled, open and late');
const nopri = L.taskLinkView(task({ priority: undefined }), cfg, TODAY, SC, PC);
eq(nopri.priorityColor, null, 'view: no priority = no dot');
const rep = task({ recurrence: 'FREQ=DAILY', scheduled: '2026-10-01', complete_instances: [TODAY] });
const repV = L.taskLinkView(rep, cfg, TODAY, SC, PC);
ok(repV.done && repV.recurring, "view: repeating task is done when today's occurrence is ticked");
ok(!L.taskLinkView(task({ recurrence: 'FREQ=DAILY', scheduled: '2026-10-01', complete_instances: ['2026-10-07'] }), cfg, TODAY, SC, PC).done, "view: repeating task ticked only yesterday is open today");
eq(repV.dates, [], 'view: repeating task does not show its rule start as Scheduled');
eq(L.taskLinkView(task({ status: 'mystery' }), cfg, TODAY, SC, PC).statusColor, SC[cfg.defaultStatus], 'view: unknown status falls back to the default status colour');

// finding links in editor text
const txt = '- 07:03  Kim - x -> [[Answer Sam]] and ![[Embed]] and [[02 Planner/T/Long|Short]] [[Note#Head]] [[ ]]';
const ls = L.wikilinksIn(txt, 100);
eq(ls.map((l) => [l.linkpath, l.alias]), [['Answer Sam', null], ['02 Planner/T/Long', 'Short'], ['Note', null]], 'links: plain, aliased, heading; embeds and empty skipped');
eq(txt.slice(ls[0].from - 100, ls[0].to - 100), '[[Answer Sam]]', 'links: positions cover the whole [[...]], offset applied');
eq(L.wikilinksIn('[[a]]\n[[b', 0).length, 1, 'links: an unclosed link is not a link');

// wiring (static)
const src = fs.readFileSync(source('a4-projects'), 'utf8');
ok(/this\.taskLinks = new TaskLinks\(this\);\s*this\.taskLinks\.start\(\);/.test(src), 'wiring: task links start on load');
ok(/await this\.plugin\.completeTask\(t, !wasDone\)/.test(src.slice(src.indexOf('class TaskLinks'))), 'wiring: a circle tick uses the same completeTask as every A4 tick');
ok(/if \(this\.skipSource\(src\)\) return;/.test(src) && /links\.skipSource\(src\)/.test(src), 'wiring: no widgets on task notes (reading and live preview)');
ok(!/processFrontMatter|vault\.modify|vault\.process/.test(src.slice(src.indexOf('class TaskLinks'), src.indexOf("// The Find window"))), 'wiring: task links never write notes themselves');
const css = fs.readFileSync(path.join(path.dirname(MAIN), 'styles.css'), 'utf8');
// Updated when moved: later sections follow it in the file now (projects board), so stop at the next section comment.
const tlCss = css.slice(css.indexOf('/* Task links (0.6.0)'));
const next = tlCss.indexOf('\n/* ', 1);
const rules = (next < 0 ? tlCss : tlCss.slice(0, next)).split('\n').filter((l) => /^\S.*\{/.test(l));
ok(rules.length > 5 && rules.every((l) => l.startsWith('html:not(#a4pj-guard) ')), 'css: every task-link rule carries the theme guard');

console.log(`RESULT ${n} ${failed}`);
process.exit(failed ? 1 : 0);
