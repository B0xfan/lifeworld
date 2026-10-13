#!/usr/bin/env node
/* Self-check for the tasks board (section 9), no Obsidian needed.
 * `node tests/test-task-board.js` from the repo root.
 * - which column a task sits in, which tasks show (area, "No project", search,
 *   archived), Done / Closed capped at the latest 30;
 * - a board move writes exactly what today's buttons write (tick, untick,
 *   status, Someday), field for field and in the same key order, with the real
 *   task engine on a fake vault and a fixed clock; same column and a second
 *   Done on a repeating task write nothing; Undo puts the note back; the move
 *   is logged; a failed write says so; a failed Someday write after the
 *   reopen puts the task back; Undo restores a cancelled auto-archive;
 * - the board page on a tiny fake DOM: tabs, tiles, cards, archived cards
 *   have no Move, Edit and card click open the task note.
 * - the Move menu (fake Menu): every column, the current one disabled.
 * The page header, real drag and the look need a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
class TFile { constructor(p, fm) { this.path = p; this.extension = 'md'; this.basename = path.basename(p, '.md'); this.fm = fm; } }
const notices = [];
const menus = [];
class Menu { constructor() { this.items = []; menus.push(this); } addItem(f) { const i = { setTitle(t) { i.title = t; return i; }, setDisabled(d) { i.disabled = d; return i; }, onClick(c) { i.click = c; return i; } }; f(i); this.items.push(i); return this; } showAtPosition() {} }
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder: class {}, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, Platform: {}, Component: class {}, Menu };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const Plugin = require(path.join(__dirname, '..', 'main.js'));
const L = Plugin.logic;
const V = Plugin.ProjectsView.prototype;
const clone = (o) => JSON.parse(JSON.stringify(o));
const TODAY = '2026-10-13';
const NOW = new Date(2026, 9, 13, 15, 4, 5);
const cfg = L.engineConfig(null); // TaskNotes' default statuses: the same set as the live vault's

/* ---- columns ---------------------------------------------------------------- */
assert.deepStrictEqual(['open', '', null, 'none', 'in-progress', 'blocked', 'someday', 'done', 'closed', 'Done', 'waiting'].map(L.taskColumn),
  ['open', 'open', 'open', 'open', 'in-progress', 'blocked', 'someday', 'done', 'closed', null, null], 'none or blank sits in Open; unknown statuses on no column');
assert.deepStrictEqual(L.taskColumns(cfg), ['open', 'in-progress', 'blocked', 'someday', 'done', 'closed'], 'six columns, mockup order');
assert.deepStrictEqual(L.taskColumns({ statuses: cfg.statuses.filter((s) => s.value !== 'closed') }), ['open', 'in-progress', 'blocked', 'someday', 'done'], 'a status the settings lack has no column');

/* ---- which tasks show ------------------------------------------------------- */
const PR = (name, sphere) => ({ path: `P/${name}.md`, name, key: name, status: 'active', sphere });
const projects = [PR('Bakery', 'work'), PR('Garden', 'personal'), PR('Loose', 'unsorted')];
const T = (title, o) => ({ path: `T/${title}.md`, title, status: 'open', priority: 'normal', due: null, projectKey: null, project: null, archived: false, recurrenceRaw: null, ...o });
const tasks = [
  T('Menu photos', { projectKey: 'Bakery', project: 'Bakery', priority: 'high', due: '2026-10-10' }),
  T('Drip line', { projectKey: 'Garden', project: 'Garden', status: 'in-progress' }),
  T('Parking pass', { status: 'none' }),
  T('Gone project', { projectKey: 'Old', project: 'Old' }),
  T('Filed open', { archived: true }),
  T('Filed done', { archived: true, status: 'done', completedDate: '2026-10-12' }),
  T('Odd', { status: 'waiting' }),
  T('Shelves', { projectKey: 'Loose', project: 'Loose', status: 'someday', priority: 'low' }),
];
const titles = (area, q) => L.taskBoardRows(tasks, projects, cfg, area, q).map((x) => x.t.title).join(',');
assert.strictEqual(titles(), 'Menu photos,Drip line,Parking pass,Gone project,Filed done,Shelves', 'no area: all but archived-open and unknown status');
assert.strictEqual(titles('work'), 'Menu photos', 'Work: tasks of work projects only, no "No project"');
assert.strictEqual(titles('personal'), 'Drip line');
assert.strictEqual(titles(null, 'BAKERY'), 'Menu photos', 'search reads the project name, any case');
assert.strictEqual(titles(null, ' pass '), 'Parking pass', 'search reads the task name, trimmed');
assert.strictEqual(titles(null, 'old'), 'Gone project', 'a missing project note: its link name still searches');
const many = Array.from({ length: 31 }, (_, i) => ({ t: T(`D${i}`, { status: 'done', completedDate: `2026-09-${String(i % 28 + 1).padStart(2, '0')}` }), col: 'done' }));
const done30 = L.taskColumnCards(many, 'done', TODAY, cfg);
assert.strictEqual(done30.length, 30, 'Done: the latest 30');
assert.ok(done30.every((x, i) => !i || done30[i - 1].t.completedDate >= x.t.completedDate), 'newest finished first');
const open = L.taskColumnCards([{ t: T('b') }, { t: T('a', { priority: 'high' }) }, { t: T('c', { plannedDay: '2026-10-01' }) }], 'open', TODAY, cfg).map((x) => x.t.title);
assert.deepStrictEqual(open, ['c', 'a', 'b'], 'open columns: the List order (overdue, priority, A to Z)');

/* ---- moves through the real engine, on a fake vault ------------------------- */
const TD = '02 Planner/TaskNotes/Tasks';
function world(fm) {
  const files = [new TFile(`${TD}/Task.md`, clone(fm))];
  const writes = [];
  const app = {
    vault: { getAbstractFileByPath: (p) => files.find((f) => f.path === p) || null },
    metadataCache: { getFileCache: (f) => ({ frontmatter: f.fm }) },
    fileManager: { processFrontMatter: async (f, cb) => { writes.push(f.path); const c = clone(f.fm); cb(c); f.fm = c; } },
    plugins: { plugins: {} }, workspace: { getLeavesOfType: () => [] },
  };
  const p = Object.create(Plugin.prototype);
  const toasts = [];
  Object.assign(p, { app, settings: L.normalizeSettings({}), saveData: async () => {}, toast: { show: (m, u) => toasts.push([m, u]) } });
  p.engine = new Plugin.TaskEngine(p); p.engine.now = () => NOW;
  const task = () => L.readTask(files[0].fm, files[0].path, 'Task', cfg, false);
  return { p, file: files[0], writes, toasts, task };
}
// Today's buttons for each column: the tick / untick (completeTask), the task
// card's status buttons (setStatus) and the Someday button (untick first when finished).
async function viaButtons(w, col) {
  const t = w.task(), finished = L.isCompletedIn(cfg, t.status);
  if (col === 'done') return t.recurrenceRaw || !finished ? w.p.completeTask(t, true) : w.p.engine.setStatus(t.path, 'done');
  if (col === 'open' && finished && !t.recurrenceRaw) return w.p.completeTask(t, false);
  if (col === 'someday') { if (finished && !t.recurrenceRaw) await w.p.completeTask(t, false); return w.p.engine.someday(t.path); }
  return w.p.engine.setStatus(t.path, col);
}
const BASE = { title: 'Task', tags: ['task'], priority: 'normal', projects: ['[[Bakery]]'], dateCreated: '2026-10-01T09:00:00.000-06:00', dateModified: '2026-10-02T09:00:00.000-06:00' };
const FIXTURES = {
  open: { ...BASE, status: 'open', due: '2026-10-20', planned_half: 'am', planned_order: 2 },
  none: { ...BASE, status: 'none', planned_day: '2026-10-12' },
  blank: { ...BASE, scheduled: '2026-10-11' },
  progress: { ...BASE, status: 'in-progress', due: '2026-10-09T14:00', reminders: [{ id: 'rem_1', type: 'relative', relatedTo: 'due', offset: '-PT15M' }] },
  done: { ...BASE, status: 'done', completedDate: '2026-10-05', due: '2026-10-04' },
  closed: { ...BASE, status: 'closed', completedDate: '2026-10-06' },
  someday: { ...BASE, status: 'someday' },
  repeat: { ...BASE, status: 'open', recurrence: 'DTSTART:20261001;FREQ=DAILY', scheduled: '2026-10-13', due: '2026-10-13', complete_instances: ['2026-10-12'], skipped_instances: [] },
  repeatSomeday: { ...BASE, status: 'someday', recurrence: 'FREQ=WEEKLY;BYDAY=MO', scheduled: '2026-10-12' },
};

// A4_TASKS_JSON=<file>: a JSON list of real task frontmatter (a copy, read in memory) to run every move on too.
if (process.env.A4_TASKS_JSON) JSON.parse(require('fs').readFileSync(process.env.A4_TASKS_JSON, 'utf8')).forEach((fm, i) => { FIXTURES[`real ${i}`] = fm; });

(async () => {
  let compared = 0;
  for (const [name, fm] of Object.entries(FIXTURES)) {
    for (const col of L.taskColumns(cfg)) {
      const a = world(fm), b = world(fm);
      const from = L.taskColumn(a.task().status);
      const ok = await a.p.moveTask(a.task(), col);
      if (from === col) { assert.strictEqual(ok, false); assert.deepStrictEqual(a.writes, [], `${name}: same column writes nothing`); continue; }
      await viaButtons(b, col);
      assert.strictEqual(JSON.stringify(a.file.fm), JSON.stringify(b.file.fm), `${name} -> ${col}: the same note as today's buttons`);
      assert.deepStrictEqual(a.p.settings.archiveQueue, b.p.settings.archiveQueue, `${name} -> ${col}: the same auto-archive queue`);
      // Undo puts the note back as it was (key order aside, as today's Undo).
      const undo = a.toasts[0][1];
      assert.ok(undo, `${name} -> ${col}: Undo offered`);
      await undo();
      assert.deepStrictEqual(a.file.fm, fm, `${name} -> ${col}: Undo restores the note`);
      assert.deepStrictEqual(a.p.settings.archiveQueue, [], `${name} -> ${col}: Undo cancels the auto-archive`);
      compared++;
    }
  }
  assert.ok(compared >= 40, `compared ${compared} moves`);
  if (process.env.A4_TASKS_JSON) console.log(`compared ${compared} moves`);

  { // spot checks of what that means
    const w = world(FIXTURES.open); await w.p.moveTask(w.task(), 'someday');
    assert.ok(!('due' in w.file.fm) && !('planned_half' in w.file.fm) && w.file.fm.status === 'someday', 'Someday takes the day and due date off');
    assert.match(w.toasts[0][0], /due date was taken off/);
    assert.deepStrictEqual(w.p.settings.activity.map((e) => e.text), ['You moved the task "Task" to Someday.'], 'logged');
    await w.toasts[0][1]();
    assert.strictEqual(w.p.settings.activity[0].text, 'Undone: you moved the task "Task" to Someday.', 'Undo logged');
    const s = world(FIXTURES.someday); await s.p.moveTask(s.task(), 'open');
    assert.deepStrictEqual(Object.keys(s.file.fm).filter((k) => /due|planned|scheduled/.test(k)), [], 'out of Someday: no date invented');
    const d = world(FIXTURES.done); await d.p.moveTask(d.task(), 'someday');
    assert.ok(!('completedDate' in d.file.fm), 'a finished task moved to Someday keeps no completedDate');
    const c = world(FIXTURES.open); await c.p.moveTask(c.task(), 'done');
    assert.strictEqual(c.file.fm.completedDate, TODAY, 'Done stamps completedDate');
    assert.strictEqual(c.p.settings.archiveQueue.length, 1, 'Done queues the auto-archive as today');
  }
  { // a repeating task: Done ticks the current occurrence, as the tick does, and it stays open
    const w = world(FIXTURES.repeat);
    assert.strictEqual(await w.p.moveTask(w.task(), 'done'), true);
    assert.ok(w.file.fm.complete_instances.includes(TODAY) && w.file.fm.status === 'open', 'occurrence done, the task stays open');
    assert.match(w.toasts[0][0], /stays open/);
    assert.match(w.p.settings.activity[0].text, /^You marked the task "Task" done for /);
    // The tick toggles: if the current occurrence is already ticked, Done must not untick it.
    const t = world({ ...FIXTURES.repeat, complete_instances: ['2026-10-12', TODAY] });
    const before = clone(t.file.fm); notices.length = 0;
    assert.strictEqual(await t.p.moveTask(t.task(), 'done'), false);
    assert.deepStrictEqual(t.file.fm, before, 'already ticked: no change');
    assert.deepStrictEqual(t.writes, [], 'already ticked: no write');
    assert.match(notices[0], /already done/);
  }
  { // independent expected results (written out by hand, not from the code's own calls)
    const pick = (fm) => ({ status: fm.status, completedDate: fm.completedDate, due: fm.due, planned_half: fm.planned_half, complete_instances: fm.complete_instances });
    const R = FIXTURES.repeat;
    const EXPECT = [
      ['open', 'in-progress', { status: 'in-progress', due: '2026-10-20', planned_half: 'am' }],
      ['open', 'blocked', { status: 'blocked', due: '2026-10-20', planned_half: 'am' }],
      ['open', 'done', { status: 'done', completedDate: TODAY, due: '2026-10-20', planned_half: 'am' }],
      ['open', 'closed', { status: 'closed', completedDate: TODAY, due: '2026-10-20', planned_half: 'am' }],
      ['open', 'someday', { status: 'someday' }],
      ['done', 'open', { status: 'open', due: '2026-10-04' }],
      ['done', 'closed', { status: 'closed', completedDate: TODAY, due: '2026-10-04' }],
      ['done', 'someday', { status: 'someday' }],
      ['someday', 'in-progress', { status: 'in-progress' }],
      // a repeating task outside Done: the status only, its ticks and dates untouched, no completedDate
      ['repeat', 'in-progress', { status: 'in-progress', due: R.due, complete_instances: R.complete_instances }],
      ['repeat', 'blocked', { status: 'blocked', due: R.due, complete_instances: R.complete_instances }],
      ['repeat', 'closed', { status: 'closed', due: R.due, complete_instances: R.complete_instances }],
      ['repeat', 'someday', { status: 'someday', due: R.due, complete_instances: R.complete_instances }],
      ['repeatSomeday', 'open', { status: 'open' }],
    ];
    for (const [name, col, want] of EXPECT) {
      const w = world(FIXTURES[name]);
      assert.strictEqual(await w.p.moveTask(w.task(), col), true, `${name} -> ${col}`);
      assert.deepStrictEqual(JSON.parse(JSON.stringify(pick(w.file.fm))), want, `${name} -> ${col}: expected fields`);
      assert.notStrictEqual(w.file.fm.dateModified, BASE.dateModified, `${name} -> ${col}: dateModified stamped`);
      if (name.startsWith('repeat')) assert.strictEqual(w.p.settings.archiveQueue.length, 0, `${name} -> ${col}: a repeating task never queues for archive`);
    }
  }
  { // the normal double tick: two Done moves tick two different days, both succeed
    const w = world(FIXTURES.repeat);
    assert.strictEqual(await w.p.moveTask(w.task(), 'done'), true);
    assert.strictEqual(await w.p.moveTask(w.task(), 'done'), true, 'second Done works');
    const added = w.file.fm.complete_instances.filter((d) => !FIXTURES.repeat.complete_instances.includes(d));
    assert.strictEqual(added.length, 2, `two new days ticked (${added})`);
    assert.notStrictEqual(added[0], added[1]);
    assert.strictEqual(w.file.fm.status, 'open', 'still open');
  }
  { // Closed on a repeating task ends the series, and the toast says so, with Undo
    const w = world(FIXTURES.repeat);
    await w.p.moveTask(w.task(), 'closed');
    assert.strictEqual(w.toasts[0][0], 'Closed: "Task" won\'t repeat any more');
    assert.ok(!L.isOpenTask(w.task(), cfg), 'the series is no longer open');
    await w.toasts[0][1]();
    assert.deepStrictEqual(w.file.fm, FIXTURES.repeat, 'Undo brings the series back');
    const o = world(FIXTURES.open); await o.p.moveTask(o.task(), 'closed');
    assert.strictEqual(o.toasts[0][0], 'Moved "Task" to Closed', 'a one-off task: the plain toast');
  }
  { // a repeating Someday task dropped on Done: ticks today's day and says it stays in Someday
    const w = world(FIXTURES.repeatSomeday);
    assert.strictEqual(await w.p.moveTask(w.task(), 'done'), true);
    assert.strictEqual(w.file.fm.status, 'someday');
    assert.strictEqual(w.file.fm.complete_instances.length, 1, 'one day ticked');
    assert.match(w.toasts[0][0], /It repeats, so it stays in Someday$/);
  }
  { // moveTask guards itself: archived and missing notes
    const w = world(FIXTURES.done);
    assert.strictEqual(await w.p.moveTask({ ...w.task(), archived: true }, 'open'), false, 'archived: refused');
    assert.deepStrictEqual(w.writes, [], 'archived: no write');
    notices.length = 0;
    assert.strictEqual(await w.p.moveTask({ ...w.task(), path: 'gone/Task.md' }, 'open'), false, 'missing note: refused');
    assert.match(notices[0], /Could not find "Task"/, 'missing note: says so');
  }
  { // section 10: Undo of a move out of Done puts back the auto-archive it cancelled
    const Q = { taskPath: `${TD}/Task.md`, statusChangeTimestamp: 1, archiveAfterTimestamp: 2, statusValue: 'done' };
    for (const col of ['open', 'closed', 'someday']) {
      const w = world(FIXTURES.done); w.p.settings.archiveQueue = [clone(Q)];
      await w.p.moveTask(w.task(), col);
      assert.deepStrictEqual(w.p.settings.archiveQueue.filter((x) => x.statusValue === 'done' && x.archiveAfterTimestamp === 2), [], `done -> ${col}: the queued archive is cancelled`);
      await w.toasts[0][1]();
      assert.deepStrictEqual(w.p.settings.archiveQueue, [Q], `done -> ${col}: Undo puts the queued archive back`);
      assert.deepStrictEqual(w.file.fm, FIXTURES.done, `done -> ${col}: Undo restores the note`);
    }
  }
  { // section 10: a failed Someday write after the reopen puts the finished task back
    const Q = { taskPath: `${TD}/Task.md`, statusChangeTimestamp: 1, archiveAfterTimestamp: 2, statusValue: 'done' };
    const w = world(FIXTURES.done); w.p.settings.archiveQueue = [clone(Q)];
    const write = w.p.app.fileManager.processFrontMatter; let n = 0;
    w.p.app.fileManager.processFrontMatter = async (f, cb) => { if (++n === 2) throw new Error('disk'); return write(f, cb); };
    notices.length = 0;
    assert.strictEqual(await w.p.moveTask(w.task(), 'someday'), false);
    assert.match(notices[0], /Could not move "Task"/);
    assert.deepStrictEqual(w.file.fm, FIXTURES.done, 'still Done, completedDate kept');
    assert.deepStrictEqual(w.p.settings.archiveQueue, [Q], 'its auto-archive kept');
    assert.deepStrictEqual(w.p.settings.activity, [], 'not logged');
    // Undo of a good move: if the Someday undo fails, the reopen undo still runs.
    const u = world(FIXTURES.done); await u.p.moveTask(u.task(), 'someday');
    const uw = u.p.app.fileManager.processFrontMatter; let m = 0;
    u.p.app.fileManager.processFrontMatter = async (f, cb) => { if (++m === 1) throw new Error('disk'); return uw(f, cb); };
    await assert.rejects(u.toasts[0][1](), /disk/, 'the failure reaches the toast (it says "Could not undo that")');
    assert.strictEqual(u.file.fm.status, 'done', 'the task is finished again');
    assert.strictEqual(u.file.fm.completedDate, FIXTURES.done.completedDate, 'with its completedDate');
  }
  { // section 10: the tab count is what the columns show (a status the settings lack counts nowhere)
    const noClosed = { ...cfg, statuses: cfg.statuses.filter((x) => x.value !== 'closed') };
    const rows = L.taskBoardRows([T('A', { status: 'closed', completedDate: TODAY }), T('B')], [], noClosed);
    assert.deepStrictEqual(rows.map((x) => x.t.title), ['B'], 'no Closed column: the closed task is not counted');
    assert.ok(rows.every((x) => L.taskColumns(noClosed).includes(x.col)));
  }
  { // refusals and failures
    const w = world(FIXTURES.open);
    assert.strictEqual(await w.p.moveTask(w.task(), 'waiting'), false, 'not a column');
    w.p.app.fileManager.processFrontMatter = async () => { throw new Error('disk'); };
    notices.length = 0;
    assert.strictEqual(await w.p.moveTask(w.task(), 'blocked'), false);
    assert.match(notices[0], /Could not move "Task"/);
    assert.deepStrictEqual(w.p.settings.activity, [], 'a failed move is not logged');
    assert.deepStrictEqual(w.file.fm, FIXTURES.open);
  }

  /* ---- the board page on a tiny fake DOM ------------------------------------ */
  const node = (tag) => { const n = { tag, kids: [], listeners: {}, className: '', textContent: '', dataset: {}, attrs: {},
    createEl(t) { const c = node(t); n.kids.push(c); return c; }, setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.listeners[t] = f; },
    empty() { n.kids = []; }, getBoundingClientRect: () => ({ left: 0, bottom: 0 }), setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {} }; return n; };
  const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids || []) walk(k, f, out); return out; };
  const text = (n) => n.textContent + (n.kids || []).map(text).join('');
  const opened = []; const moved = [];
  const view = Object.assign(Object.create(V), { plugin: { settings: L.normalizeSettings({}), openFile: (p) => opened.push(p), moveTask: (t, k) => moved.push([t.title, k]) },
    app: {}, cfg, today: TODAY, tasks: [...tasks, ...many.map((x) => x.t)], projects, query: '', tab: 'projects', area: null, render() {} });
  let page = node('div');
  view.renderTaskBoard(page);
  assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-tabs')[0].kids.map(text), ['Tasks37', 'Activity'], 'Tasks and Activity tabs only; full total');
  assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-tile').map(text), ['3Open', '1In progress', '0Blocked', '1Someday', '32Done', '0Closed'], 'tiles: full counts');
  assert.ok(walk(page, (n) => n.className === 'a4pj-by').map(text).includes('The latest 30 of 32'), 'Done says it shows the latest 30');
  const cards = walk(page, (n) => n.className === 'a4pj-bcard');
  assert.strictEqual(cards.length, 3 + 1 + 1 + 30, 'Done capped at 30 cards');
  const menu = cards.find((c) => /Menu photos/.test(text(c)));
  assert.deepStrictEqual(walk(menu, (n) => /a4pj-pill\b/.test(n.className)).map((n) => [n.className, n.textContent]),
    [['a4pj-pill is-work', 'Work'], ['a4pj-pill is-proj', 'Bakery'], ['a4pj-pill is-high', 'High priority']], 'area, project, High priority');
  const when = walk(menu, (n) => /a4pj-bwhen/.test(n.className))[0];
  assert.ok(when.className === 'a4pj-bwhen is-late' && /^Overdue /.test(when.textContent), `overdue in red (${when.textContent})`);
  const parking = cards.find((c) => /Parking pass/.test(text(c)));
  assert.deepStrictEqual(walk(parking, (n) => /a4pj-pill\b/.test(n.className)).map(text), ['No project'], '"No project", Normal priority has no tag');
  assert.ok(/No due date/.test(text(parking)));
  const filed = cards.find((c) => /Filed done/.test(text(c)));
  assert.ok(!walk(filed, (n) => n.tag === 'button').some((b) => b.textContent === 'Move') && filed.draggable !== true, 'archived: no Move, no drag');
  assert.ok(/Archived/.test(text(filed)));
  const editBtn = walk(menu, (n) => n.tag === 'button' && n.textContent === 'Edit')[0];
  editBtn.listeners.click();
  menu.listeners.click({ target: { closest: () => null } });
  menu.listeners.click({ target: { closest: () => ({}) } });
  assert.deepStrictEqual(opened, ['T/Menu photos.md', 'T/Menu photos.md'], 'Edit and card click open the task note; a button click is not a card click');
  view.dropTask('T/Menu photos.md', 'open'); view.dropTask('T/Filed done.md', 'open'); view.dropTask('T/Menu photos.md', 'blocked');
  assert.deepStrictEqual(moved, [['Menu photos', 'blocked']], 'drop: same column and archived make no call');
  view.area = 'work'; page = node('div'); view.renderTaskBoard(page);
  assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-btitle').map(text), ['Menu photos'], 'Work: work tasks only');
  assert.strictEqual(walk(page, (n) => n.className === 'a4pj-tabs')[0].kids.map(text)[0], 'Tasks37', 'tab count stays the full total');
  { // a repeating card with an old due date is not red and shows how it repeats; nor is Someday red
    const rv = Object.assign(Object.create(V), { plugin: view.plugin, app: {}, cfg, today: TODAY, tasks: [
      T('Stretch', { recurrenceRaw: 'FREQ=DAILY', due: '2026-09-19' }), T('Later', { status: 'someday', due: '2026-10-01' }), T('Late', { due: '2026-10-01', status: 'blocked' })],
    projects, query: '', tab: 'projects', area: null, render() {} });
    const pg = node('div'); rv.renderTaskBoard(pg);
    const whens = Object.fromEntries(walk(pg, (n) => n.className === 'a4pj-bcard').map((c) => [walk(c, (n) => n.className === 'a4pj-btitle')[0].textContent, walk(c, (n) => /a4pj-bwhen/.test(n.className))[0]]));
    assert.deepStrictEqual([whens.Stretch.className, whens.Stretch.textContent], ['a4pj-bwhen', 'Every day'], 'repeating: never overdue, shows the repeat');
    assert.deepStrictEqual([whens.Later.className, whens.Later.textContent], ['a4pj-bwhen', `Due ${L.shortDay('2026-10-01', TODAY)}`], 'Someday: not red');
    assert.strictEqual(whens.Late.className, 'a4pj-bwhen is-late', 'blocked one-off past due: red');
  }
  { // the Move menu: every column, the current one disabled, a pick moves through moveTask
    menus.length = 0; moved.length = 0;
    const anchor = { getBoundingClientRect: () => ({ left: 0, bottom: 0 }) };
    view.taskMoveMenu(anchor, tasks[0], 'open');
    const items = menus[0].items;
    assert.deepStrictEqual(items.map((i) => [i.title, !!i.disabled]), [['Open (here now)', true], ['In progress', false], ['Blocked', false], ['Someday', false], ['Done', false], ['Closed', false]]);
    items[4].click();
    assert.deepStrictEqual(moved, [['Menu photos', 'done']], 'menu pick calls moveTask');
    const mb = walk(menu, (n) => n.tag === 'button' && n.textContent === 'Move')[0];
    menus.length = 0; mb.listeners.click();
    assert.strictEqual(menus.length, 1, 'the card Move button opens the menu');
  }
  console.log('task board self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
