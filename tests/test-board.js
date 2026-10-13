#!/usr/bin/env node
/* Self-check for the projects board (section 7), no Obsidian needed: which
 * projects the board shows (columns only, area, search), the card description
 * line, tab counts stay full totals while tiles follow the area, a drop in the
 * same column makes no call, Edit writes only `why`, and Activity rows are set
 * as plain text, a card opens the project page, a description found by search
 * survives a note change, a redraw forgets a drag, a new Activity entry redraws
 * the Activity tab, and the phone's "+ Add project" message. Drag, the Move
 * menu and the page look need a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const notices = [];
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const plugin = require(path.join(__dirname, '..', 'dist', 'a4-projects', 'main.js'));
const L = plugin.logic;
const V = plugin.ProjectsView.prototype;

/* ---- which projects are on the board ----------------------------------- */
const P = (name, status, sphere, why) => ({ path: `P/${name}.md`, name, key: name, status, sphere, why: why || '', mtime: 1 });
const all = [P('A', 'active', 'work', 'Designer away'), P('B', 'waiting', 'personal'), P('C', 'blocked', 'unsorted'), P('D', 'done', 'work'),
  P('I', 'idea', 'work'), P('S', 'cold-storage', 'work'), P('F', 'failed', 'work'), P('X', 'dropped', 'personal'), P('N', '', 'work')];
const names = (area, q, extra) => all.filter((p) => L.onBoard(p, area, q, extra && extra(p))).map((p) => p.name).join('');
assert.strictEqual(names(), 'ABCD', 'six columns only: no idea, cold storage, failed, dropped or no status');
assert.strictEqual(names('work'), 'AD', 'Work keeps work projects');
assert.strictEqual(names('personal'), 'B', 'Personal keeps personal projects; unsorted only when no area');
assert.strictEqual(names(null, 'designer'), 'A', 'search reads the why, any case');
assert.strictEqual(names(null, '  b '), 'B', 'search reads the name, trimmed');
assert.strictEqual(names(null, 'photos', (p) => (p.name === 'C' ? ['Send the photos'] : [])), 'C', 'search reads the extra text (description, next step)');
assert.ok(L.PROJECT_STATUSES.includes('waiting') && L.PROJECT_STATUSES.includes('blocked'), 'edit list offers the new columns');
assert.strictEqual(L.readProject({ type: 'project', why: '  kept ' }, 'p', 'p').why, 'kept');
assert.strictEqual(L.readProject({ type: 'project', why: 3 }, 'p', 'p').why, '');

/* ---- description line ---------------------------------------------------- */
assert.strictEqual(L.firstBodyLine('---\ntype: project\n---\n\n# Title\n\nNew menu page.\nMore.\n'), 'New menu page.');
assert.strictEqual(L.firstBodyLine('---\na: 1\n---\n\n# Title\n\n'), '', 'New Project form shape: no description');
assert.strictEqual(L.firstBodyLine('![[x.base]]\n## Tasks\n  hello\n'), 'hello', 'skips embeds and headings');
assert.match(L.stampText(Date.UTC(2026, 9, 12, 16, 10)), /^Oct 1[23], \d{1,2}:\d{2} (AM|PM)$/);

/* ---- the board page on a tiny fake DOM ------------------------------------ */
const node = (tag) => { const n = { tag, kids: [], listeners: {}, className: '', textContent: '', dataset: {}, attrs: {},
  createEl(t) { const c = node(t); n.kids.push(c); return c; }, setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.listeners[t] = f; },
  empty() { n.kids = []; }, setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {} }; return n; };
const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids || []) walk(k, f, out); return out; };
const text = (n) => n.textContent + (n.kids || []).map(text).join('');
const moves = [];
const host = { settings: L.normalizeSettings({ activity: [{ at: Date.UTC(2026, 9, 12, 16), text: 'You moved <b>X</b> to Waiting.' }] }),
  engine: { file: () => null }, moveProject(p, k) { moves.push([p, k]); return Promise.resolve(true); } };
const view = Object.assign(Object.create(V), { plugin: host, app: {}, cfg: { statuses: [], priorities: [] }, today: '2026-10-13', tasks: [], projects: all, query: '', tab: 'projects', area: 'work', descs: new Map(), render() {} });
const page = node('div');
view.renderBoard(page);
const tabs = walk(page, (n) => n.className === 'a4pj-tabs')[0];
assert.deepStrictEqual(tabs.kids.map(text), ['Projects4', 'Ideas1', 'Cold Storage1', 'Activity'], 'tab counts are full totals with Work chosen; Activity has no badge');
const tiles = walk(page, (n) => n.className === 'a4pj-tile');
assert.deepStrictEqual(tiles.map(text), ['0Backlog', '1Active', '0Waiting', '0Paused', '0Blocked', '1Done'], 'tiles follow the area');
assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-btitle').map(text), ['A', 'D'], 'only Work cards');
assert.ok(walk(page, (n) => n.className === 'a4pj-colsub').map(text).includes('Needs a response'), 'column subtitles');
assert.ok(walk(page, (n) => n.className === 'a4pj-bcard').every((c) => c.draggable === true), 'desktop cards drag');

view.dropOn('P/A.md', 'active');
assert.deepStrictEqual(moves, [], 'same column: no move call');
view.dropOn('P/A.md', 'waiting');
view.dropOn('P/I.md', 'waiting'); // not a board card: the view still hands it on (moveProject's own refusal is tested in test-project-moves.js)
view.dropOn('elsewhere.md', 'done');
assert.deepStrictEqual(moves.map((m) => m.join('>')), ['P/A.md>waiting', 'P/I.md>waiting'], 'other columns go through moveProject');
assert.strictEqual(view.dragPath, null);

// A card click opens the plugin's project page, as the List does.
const gone = []; view.go = (st) => gone.push(st);
const card = walk(page, (n) => n.className === 'a4pj-bcard')[0];
card.listeners.click({ target: { closest: () => null } });
card.listeners.click({ target: { closest: () => ({}) } }); // a click on Move / Edit is not a card click
assert.deepStrictEqual(gone, [{ page: 'project', project: 'P/A.md' }], 'card click opens the project page');

// Activity: entries are set as text, never parsed (they carry note names).
const ap = node('div'); view.tab = 'activity'; view.renderBoard(ap);
const row = walk(ap, (n) => n.className === 'a4pj-log')[0];
assert.strictEqual(row.kids[1].textContent, 'You moved <b>X</b> to Waiting.');
assert.ok(!/innerHTML/.test(V.renderActivity.toString()), 'no innerHTML in the Activity tab');

/* ---- a redraw forgets the dragged card (its dragend may never come) -------- */
global.document = { activeElement: null, querySelector: () => null };
{
  const root = Object.assign(node('div'), { contains: () => false, querySelector: () => null, toggleClass() {}, clientWidth: 0 });
  const rv = Object.assign(Object.create(V), { plugin: { engine: { cfg: () => ({}), today: () => '2026-10-13', collectTasks: () => [], collectProjects: () => [] } },
    contentEl: root, state: { page: 'overview' }, dragPath: 'P/A.md', renderOverview() {} });
  rv.render();
  assert.strictEqual(rv.dragPath, null, 'redraw clears the dragged card');
}

/* ---- phone: "+ Add project" says where it works ---------------------------- */
fake.Platform.isMobile = true;
notices.length = 0;
assert.strictEqual(plugin.prototype.addProject.call({ app: { plugins: { plugins: {} } } }), false);
assert.ok(/Mac/.test(notices[0]) && !/turned on/.test(notices[0]), 'phone: no "turn on the plugin" advice');
fake.Platform.isMobile = false;

(async () => {
  /* ---- description search survives a note change ---------------------------- */
  const tick = () => new Promise((r) => setImmediate(r));
  const D = { path: 'P/M.md', name: 'M', key: 'M', status: 'active', sphere: 'work', why: '', mtime: 2 }; // just moved: newer than the kept line
  const dv = Object.assign(Object.create(V), { plugin: { engine: { file: () => ({}) } }, app: { vault: { cachedRead: async () => '# M\n\nNew menu page.\n' } },
    cfg: { statuses: [], priorities: [] }, today: '2026-10-13', tasks: [], projects: [D], tab: 'projects', area: null, render() {} });
  const shownTitles = (pg) => walk(pg, (n) => n.className === 'a4pj-btitle').map(text);
  dv.descs = new Map([['P/M.md', { mtime: 1, line: 'Old notes.' }]]); dv.query = 'old notes';
  let pg = node('div'); dv.renderBoard(pg);
  assert.deepStrictEqual(shownTitles(pg), ['M'], 'a stale description still finds the card until the new one is read');
  dv.descs = new Map(); dv.query = 'menu page'; // hidden card, never read yet
  pg = node('div'); dv.renderBoard(pg);
  await tick(); await tick();
  assert.deepStrictEqual(shownTitles(pg), ['M'], 'a hidden card is read and the search re-runs');

  /* ---- a new Activity entry redraws an open Activity tab --------------------- */
  const redrawn = [];
  const lp = Object.assign(Object.create(plugin.prototype), { settings: L.normalizeSettings({}), saveData: async () => {},
    app: { workspace: { getLeavesOfType: () => [{ view: { tab: 'activity', scheduleRender: () => redrawn.push('activity') } }, { view: { tab: 'projects', scheduleRender: () => redrawn.push('projects') } }] } } });
  await lp.logActivity('Undone: you moved M to Waiting.');
  assert.deepStrictEqual(redrawn, ['activity'], 'only the Activity tab redraws');

  /* ---- Edit (why only) ------------------------------------------------------- */
  const toasts = []; const undos = []; let fm = { type: 'project', status: 'active', why: 'old', goal: '[[G]]' };
  const P2 = plugin.prototype;
  const file = { path: '04 Inner World/My Life/Projects/A.md', extension: 'md', basename: 'A' }; // one object: Undo checks the note is still there
  const self = Object.assign(Object.create(P2), {
    toast: { show: (m, u) => { toasts.push(m); undos.push(u); } },
    engine: { file: () => file },
    app: { fileManager: { processFrontMatter: async (f, fn) => { fn(fm); } } },
  });
  assert.strictEqual(await self.setProjectWhy('x', '   '), false, 'empty answer keeps the why');
  assert.strictEqual(fm.why, 'old');
  assert.strictEqual(await self.setProjectWhy('x', ' new reason '), true);
  assert.deepStrictEqual(fm, { type: 'project', status: 'active', why: 'new reason', goal: '[[G]]' }, 'only why changes');
  assert.strictEqual(await self.setProjectWhy('x', 'new reason'), false, 'same answer: no change, no toast');
  assert.deepStrictEqual(toasts, ['Saved why for "A"']);
  assert.strictEqual(await undos[0](), true, 'Undo runs');
  assert.deepStrictEqual(fm, { type: 'project', status: 'active', why: 'old', goal: '[[G]]' }, 'Undo puts the old why back');
  console.log('board self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
