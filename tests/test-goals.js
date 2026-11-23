#!/usr/bin/env node
/* Self-check for "By goal" on the projects board (mockup approved 2026-10-15),
 * no Obsidian needed: grouping and order, goal resolution and status, the
 * goals-with-no-project list (hidden while filtering), status pills on cards,
 * the By status / By goal setting and switch, and the page title. The page
 * look needs a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const { part } = require('./lib/paths');
const plugin = part('a4-projects');
const L = plugin.logic;
const V = plugin.ProjectsView.prototype;

/* ---- grouping ---------------------------------------------------------------- */
const P = (name, status, goal, sphere) => ({ path: `P/${name}.md`, name, key: name, status, sphere: sphere || 'work', goal, why: '', mtime: 1 });
const it = (p) => ({ p, st: { total: 0, done: 0 } });
const G = { '[[Grow]]': { key: 'G/Grow.md', name: 'Grow', status: 'achieved' }, '[[Keep]]': { key: 'G/Keep.md', name: 'Keep', status: 'not-achieved' },
  '[[Old]]': { key: 'G/Old.md', name: 'Old', status: 'not-achieved' } };
const goalOf = (p) => (p.goal ? G[p.goal] : null);
const groups = L.goalGroups([it(P('Zed', 'paused', '[[Old]]')), it(P('Misc', 'active', '[[Keep]]')), it(P('Alpha', 'backlog', '[[Keep]]')),
  it(P('Pipa', 'active', '[[Grow]]')), it(P('Loose', 'active', null)), it(P('Done one', 'done', '[[Old]]'))], goalOf);
assert.deepStrictEqual(groups.map((g) => g.goal.name), ['Grow', 'Keep', 'Old', 'No goal'], 'liveliest project first, then A to Z; No goal last');
assert.deepStrictEqual(groups[1].items.map((x) => x.p.name), ['Misc', 'Alpha'], 'inside a goal: active before backlog');
assert.deepStrictEqual(groups[2].items.map((x) => x.p.name), ['Zed', 'Done one'], 'paused before done');
assert.deepStrictEqual(L.goalGroups([], goalOf), []);

/* ---- normalizeSettings ------------------------------------------------------- */
assert.strictEqual(L.normalizeSettings(null).ui.group, 'status', 'default: By status');
assert.strictEqual(L.normalizeSettings({ ui: { group: 'goal' } }).ui.group, 'goal', 'kept');
assert.strictEqual(L.normalizeSettings({ ui: { group: 'Goal' } }).ui.group, 'status', 'anything else: default');

/* ---- the page on a tiny fake DOM -------------------------------------------- */
const node = (tag) => { const n = { tag, kids: [], listeners: {}, className: '', textContent: '', dataset: {}, attrs: {}, classes: new Set(),
  createEl(t) { const c = node(t); n.kids.push(c); return c; }, setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.listeners[t] = f; },
  empty() { n.kids = []; }, setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {},
  toggleClass(c, on) { if (on) n.classes.add(c); else n.classes.delete(c); } }; return n; };
const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids || []) walk(k, f, out); return out; };
const text = (n) => n.textContent + (n.kids || []).map(text).join('');
const files = { Grow: { path: 'G/Grow.md', basename: 'Grow', fm: { type: 'goal', status: 'achieved' } }, Keep: { path: 'G/Keep.md', basename: 'Keep', fm: { type: 'goal', status: 'not-achieved' } },
  Sleep: { path: 'G/Sleep.md', basename: 'Sleep', fm: { type: 'goal', status: 'on-hold' } } };
const opened = [];
const host = { settings: L.normalizeSettings({ ui: { view: 'board', group: 'goal' } }), engine: { file: () => null, fm: (f) => f.fm },
  okWork: () => null, goalFiles: () => [files.Keep, files.Sleep], openFile: (p) => opened.push(p) }; // open goals only: Grow is achieved
files.Note = { path: 'N/Note.md', basename: 'Note', fm: { type: 'note' } };
const app = { metadataCache: { getFirstLinkpathDest: (link) => files[link] || null } };
const projects = [P('Pipa', 'active', '[[Grow]]'), P('Misc', 'active', '[[Keep|Keep going]]', 'personal'), P('Gone', 'paused', '[[Missing goal]]'),
  P('Idea', 'idea', '[[Keep]]'), P('Shut', 'failed', '[[Sleep]]'), P('Odd', 'backlog', '[[Note]]'), P('Head', 'backlog', '[[#Top]]')];
const view = Object.assign(Object.create(V), { plugin: host, app, cfg: { statuses: [], priorities: [] }, today: '2026-10-15', tasks: [], projects, query: '', tab: 'projects', area: null, descs: new Map(), render() {} });
let page = node('div');
view.renderBoard(page);
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-board is-goals').length, 1, 'board laid out as goal sections');
assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-tile'), [], 'no tiles in By goal');
const heads = walk(page, (n) => n.className === 'a4pj-goalhead').map(text);
assert.deepStrictEqual(heads, ['Growachieved1 project', 'Keepnot achieved1 project', 'Note1 project', 'Missing goal1 project', 'No goal1 project'],
  'goal sections, real goal status; a missing or non-goal note shows its name, no status; "[[#Top]]" is No goal');
assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-btitle').map(text), ['Pipa', 'Misc', 'Odd', 'Gone', 'Head'], 'board projects only: no idea, no failed');
assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-pill is-st').map(text), ['Active', 'Active', 'Backlog', 'Paused', 'Backlog'], 'each card shows its status');
assert.ok(walk(page, (n) => n.className === 'a4pj-bcard').every((c) => c.draggable !== true), 'no dragging in By goal');
assert.strictEqual(walk(page, (n) => n.tag === 'h3' && n.className === 'a4pj-goalh').length, 5, 'a heading per goal');
const rest = walk(page, (n) => n.className === 'a4pj-goalrest')[0];
assert.strictEqual(text(rest.kids[0]), 'Goals with no open project (1)');
const restBtn = walk(rest, (n) => n.tag === 'button')[0];
assert.strictEqual(restBtn.textContent, 'Sleep', 'a goal whose only project is closed is listed');
restBtn.listeners.click();
walk(page, (n) => n.className === 'a4pj-goalname' && n.tag === 'button')[0].listeners.click();
assert.deepStrictEqual(opened, ['G/Sleep.md', 'G/Grow.md'], 'goal names open the goal note');
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-goalname' && n.tag === 'span' && n.textContent === 'Missing goal').length, 1, 'an unresolved goal is plain text');

// Filtering: the "no open project" list is about every goal, so it hides; Work keeps work projects.
view.area = 'work'; page = node('div'); view.renderBoard(page);
assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-btitle').map(text), ['Pipa', 'Odd', 'Gone', 'Head']);
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-goalrest').length, 0, 'hidden while an area is chosen');
view.area = null; view.query = 'zzz'; page = node('div'); view.renderBoard(page);
assert.deepStrictEqual(walk(page, (n) => n.className === 'a4pj-empty').map(text), ['nothing matches']);
view.query = '';

// By status keeps the columns, no status pill.
host.settings.ui.group = 'status'; page = node('div'); view.renderBoard(page);
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-board').length, 1, 'plain board');
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-tile').length, 6, 'columns and tiles as before');
assert.strictEqual(walk(page, (n) => n.className === 'a4pj-pill is-st').length, 0, 'no status pill in columns');

/* ---- the switch and the title ------------------------------------------------- */
const sw = () => { const n = { kids: [], listeners: {}, className: '', textContent: '', dataset: {}, value: '', createEl() { const c = sw(); n.kids.push(c); return c; }, setAttr() {}, prepend(c) { n.kids.unshift(c); },
  addEventListener(t, f) { n.listeners[t] = f; }, querySelector() { return n.act; } }; return n; };
global.createDiv = () => sw();
const run = (settings, tab) => { const pg = sw(); pg.act = sw(); let title = null;
  const v = { plugin: { settings, async save() {} }, cfg: {}, today: '2026-10-15', tasks: [], state: {}, query: '', tab, head(_, __, t) { title = t; }, areaButtons() {}, render() {}, renderBoard() {}, renderTaskBoard() {}, renderLists() {} };
  V.renderOverview.call(v, pg); return { pg, title }; };
const labels = (pg) => walk(pg.act, (n) => n.textContent === 'By goal' || n.textContent === 'By status').map((n) => n.textContent);
let r = run(L.normalizeSettings({ ui: { view: 'board', group: 'goal' } }), 'projects');
assert.deepStrictEqual(labels(r.pg), ['By status', 'By goal'], 'switch on the projects board');
assert.strictEqual(r.title, 'Projects by goal');
r = run(L.normalizeSettings({ ui: { view: 'board' } }), 'projects');
assert.strictEqual(r.title, 'What needs attention');
assert.deepStrictEqual(labels(run(L.normalizeSettings({ ui: { view: 'list' } }), 'projects').pg), [], 'not on the List');
assert.deepStrictEqual(labels(run(L.normalizeSettings({ ui: { view: 'board', kind: 'tasks' } }), 'projects').pg), [], 'not on the Tasks board');
assert.deepStrictEqual(labels(run(L.normalizeSettings({ ui: { view: 'board', group: 'goal' } }), 'ideas').pg), [], 'not on Ideas');
assert.strictEqual(run(L.normalizeSettings({ ui: { view: 'board', group: 'goal' } }), 'ideas').title, 'Ideas worth keeping');
(async () => {
  const s = L.normalizeSettings({ ui: { view: 'board' } });
  const { pg } = run(s, 'projects');
  await walk(pg.act, (n) => n.textContent === 'By goal')[0].listeners.click();
  assert.strictEqual(s.ui.group, 'goal', 'the switch saves the pick');
  console.log('goals self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
