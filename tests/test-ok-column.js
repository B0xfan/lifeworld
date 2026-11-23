#!/usr/bin/env node
/* Self-check for the "Needs my OK" column (mockup approved
 * 2026-10-15), no Obsidian needed: which progress reports count, title, project,
 * date and order; the column shows only when the vault has work folders with
 * reports; first column, no drop target, area and search filters, the card opens
 * the report. The page look needs a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
class TFile {} class TFolder {}
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const { part } = require('./lib/paths');
const plugin = part('a4-projects');
const L = plugin.logic;
const V = plugin.ProjectsView.prototype;

/* ---- which reports count -------------------------------------------------- */
const R = (folder, fm, heading) => ({ path: `03 WiP/${folder}/progress-report.md`, folder, fm: { type: 'progress-report', ...fm }, heading });
const reports = [
  R('2026-10-01-manual', { work_status: 'WAITING', waiting_on: "Sam's review of the manual", project: '[[Notes/Projects/Garden Shop]]', updated: '2026-10-14 09:10' }, 'Vehicle manual: progress'),
  R('2026-10-02-photos', { work_status: 'BLOCKED', waiting_on: 'Sam: a go-ahead', updated: '2026-10-12 10:00' }, ''),
  R('2026-10-03-other', { work_status: 'WAITING', waiting_on: 'Lee, then Sam', updated: '2026-10-15 08:00' }, 'Other: progress'),
  R('2026-10-04-done', { work_status: 'DONE', waiting_on: 'Sam', updated: '2026-10-15 08:00' }, 'Done: progress'),
  R('2026-10-05-samantha', { work_status: 'WAITING', waiting_on: 'Samantha to reply' }, 'Samantha: progress'),
  R('2026-10-06-quoted', { work_status: 'waiting', waiting_on: '  Sam to restart Obsidian', updated: '2026-10-13' }, 'Restart: progress'),
  R('2026-10-07-none', { work_status: 'WAITING' }, 'No line: progress'),
  R('2026-10-08-links', { work_status: 'WAITING', waiting_on: 'sam: lower case', updated: '2026-10-11' }, '[[Bakery]] fix for [[Shop|the shop]] — progress report'),
  R('2026-10-09-closed', { status: 'closed', work_status: 'WAITING', waiting_on: 'Sam', updated: '2026-10-15' }, 'Closed: progress'),
];
const items = L.okItems(reports, 'Sam');
assert.deepStrictEqual(items.map((x) => x.title), ['Vehicle manual', 'Restart', '2026-10-02-photos', 'Bakery fix for the shop'],
  'WAITING/BLOCKED whose waiting line starts with Sam (any case), newest first; not closed; no heading: the folder name; links shown as words');
assert.deepStrictEqual(items.map((x) => [x.project, x.updated]), [['Garden Shop', '2026-10-14'], [null, '2026-10-13'], [null, '2026-10-12'], [null, '2026-10-11']], 'project from the path link, day only');
assert.strictEqual(items[1].waiting, 'Sam to restart Obsidian', 'waiting line trimmed');
assert.deepStrictEqual(L.okItems([], 'Sam'), []);

/* ---- okWork: work folders only ------------------------------------------------- */
const folder = (p, kids) => Object.assign(new TFolder(), { path: p, name: p.split('/').pop(), children: kids || [] });
const file = (p, fm, heading) => Object.assign(new TFile(), { path: p, fm, heading });
const vault = (files) => ({ vault: { getAbstractFileByPath: (p) => files[p] || null },
  metadataCache: { getFileCache: (f) => ({ headings: f.heading ? [{ heading: f.heading }] : [] }) } });
const okWork = (files, name = 'Sam') => plugin.prototype.okWork.call({ settings: { okName: name }, app: vault(files), engine: { fm: (f) => f.fm } });
assert.strictEqual(okWork({}), null, 'no work folder: no column');
const empty = folder('03 WiP', [folder('03 WiP/2026-10-01-x')]);
assert.strictEqual(okWork({ '03 WiP': empty }), null, 'work folders but no progress report: no column');
const a = folder('03 WiP/2026-10-01-a'); const arch = folder('03 WiP/_archive');
const files = { '03 WiP': folder('03 WiP', [a, arch, file('03 WiP/README.md')]),
  '03 WiP/2026-10-01-a/progress-report.md': file('03 WiP/2026-10-01-a/progress-report.md', { type: 'progress-report', work_status: 'ACTIVE' }, 'A: progress'),
  '03 WiP/_archive/progress-report.md': file('x', { type: 'progress-report', work_status: 'WAITING', waiting_on: 'Sam' }) };
assert.deepStrictEqual(okWork(files), [], 'a vault with reports and nothing waiting: an empty column');
files['03 WiP/2026-10-01-a/progress-report.md'].fm.work_status = 'WAITING'; files['03 WiP/2026-10-01-a/progress-report.md'].fm.waiting_on = "Sam's OK";
assert.deepStrictEqual(okWork(files).map((x) => x.title), ['A'], 'archived work never counts');
assert.strictEqual(okWork(files, '  '), null, 'no name in Settings: no column');

/* ---- the column on a tiny fake DOM ------------------------------------------ */
const node = (tag) => { const n = { tag, kids: [], listeners: {}, className: '', textContent: '', dataset: {}, attrs: {},
  createEl(t) { const c = node(t); n.kids.push(c); return c; }, setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.listeners[t] = f; },
  empty() { n.kids = []; }, setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {} }; return n; };
const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids || []) walk(k, f, out); return out; };
const text = (n) => n.textContent + (n.kids || []).map(text).join('');
const opened = [];
let work = items;
const host = { settings: L.normalizeSettings({ ui: { view: 'board' } }), engine: { file: () => null }, okWork: () => work, goalFiles: () => [], openFile: (p) => opened.push(p) };
const P = (name, status, sphere) => ({ path: `P/${name}.md`, name, key: name, status, sphere, why: '', mtime: 1 });
const view = Object.assign(Object.create(V), { plugin: host, app: {}, cfg: { statuses: [], priorities: [] }, today: '2026-10-15', tasks: [],
  projects: [P('Garden Shop', 'active', 'work'), P('Home', 'active', 'personal')], query: '', tab: 'projects', area: null, descs: new Map(), render() {} });
let page = node('div'); view.renderBoard(page);
const cols = walk(page, (n) => n.className === 'a4pj-col');
assert.strictEqual(cols[0].dataset.col, 'ok', 'first column');
assert.strictEqual(text(cols[0].kids[0]), "Needs my OK4");
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-board has-ok').length, 1, 'seven-column board');
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-tile').length, 7, 'a tile for it too');
assert.strictEqual(cols[0].listeners.drop, undefined, 'nothing can be dropped on it');
const cards = walk(cols[0], (n) => n.className === 'a4pj-bcard is-work');
assert.deepStrictEqual(cards.map((c) => walk(c, (n) => n.className === 'a4pj-pill is-proj').map(text)[0]), ['Garden Shop', 'no project', 'no project', 'no project']);
assert.strictEqual(walk(cards[0], (n) => n.className === 'a4pj-bwait').map(text)[0], "Sam's review of the manual");
assert.strictEqual(cards[0].draggable, undefined, 'work cards do not drag');
walk(cards[0], (n) => n.textContent === 'Open progress page')[0].listeners.click();
cards[1].listeners.click({ target: { closest: () => null } });
assert.deepStrictEqual(opened, ['03 WiP/2026-10-01-manual/progress-report.md', '03 WiP/2026-10-06-quoted/progress-report.md'], 'button and card open the report');

view.area = 'work'; page = node('div'); view.renderBoard(page);
assert.deepStrictEqual(walk(walk(page, (n) => n.className === 'a4pj-col')[0], (n) => n.className === 'a4pj-btitle').map(text), ['Vehicle manual', 'Restart', '2026-10-02-photos', 'Bakery fix for the shop'], 'Work: work projects, plus work with no project');
view.area = 'personal'; page = node('div'); view.renderBoard(page);
assert.deepStrictEqual(walk(walk(page, (n) => n.className === 'a4pj-col')[0], (n) => n.className === 'a4pj-btitle').map(text), ['Restart', '2026-10-02-photos', 'Bakery fix for the shop'], 'Personal: a work project\'s report hides');
const keyed = []; host.openFile = (p) => keyed.push(p);
walk(page, (n) => n.className === 'a4pj-bcard is-work')[0].listeners.keydown({ key: ' ', target: walk(page, (n) => n.className === 'a4pj-bcard is-work')[0], preventDefault() {} });
assert.strictEqual(keyed.length, 1, 'Space opens a card');
view.area = null; view.query = 'restart'; page = node('div'); view.renderBoard(page);
assert.deepStrictEqual(walk(walk(page, (n) => n.className === 'a4pj-col')[0], (n) => n.className === 'a4pj-btitle').map(text), ['Restart'], 'search reads the waiting line');
view.query = '';
work = []; page = node('div'); view.renderBoard(page);
assert.deepStrictEqual(walk(walk(page, (n) => n.className === 'a4pj-col')[0], (n) => n.className === 'a4pj-empty').map(text), ['nothing waiting for you'], 'empty: a plain line, not a drop zone');
work = null; page = node('div'); view.renderBoard(page);
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-col').length, 6, 'no work folders: the six columns only');
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-board').length, 1);
host.settings.ui.group = 'goal'; work = items; page = node('div'); view.renderBoard(page);
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-bcard is-work').length, 0, 'By goal has no OK column');
console.log('ok column self-check: OK');
