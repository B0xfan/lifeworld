#!/usr/bin/env node
/* Self-check for the tasks board (section 9), no Obsidian needed.
 * `node tests/test-task-board.js` from the repo root.
 * - which column a task sits in, which tasks show (area, "No project", search,
 *   archived), Done / Closed capped at the latest 30;
 * - a board move writes exactly what today's buttons write (tick, untick,
 *   status, Someday), field for field and in the same key order, with the real
 *   task engine on a fake vault and a fixed clock; same column and a second
 *   Done on a repeating task write nothing; Undo puts the note back; the move
 *   is logged; a failed write says so;
 * - the board page on a tiny fake DOM: tabs, tiles, cards, archived cards
 *   have no Move, Edit and card click open the task note.
 * The page header, drag, the Move menu and the look need a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
class TFile { constructor(p, fm) { this.path = p; this.extension = 'md'; this.basename = path.basename(p, '.md'); this.fm = fm; } }
const notices = [];
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder: class {}, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, Platform: {}, Component: class {} };
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
    empty() { n.kids = []; }, setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {} }; return n; };
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
  console.log('task board self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
