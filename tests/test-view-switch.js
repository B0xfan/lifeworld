#!/usr/bin/env node
/* Self-check for the Projects page switches (section 6), no Obsidian needed:
 * normalizeSettings gives List + Projects by default and for bad values and
 * keeps a saved pick through a JSON round trip; a switch click after the
 * settings object is swapped (as a Sync reload does) changes and saves the
 * current settings. Real saving to disk and the page look are not exercised. */
'use strict';
const path = require('path');
const Module = require('module');
const { part } = require('./lib/paths');
const assert = require('assert');
const fake = { Plugin: class {}, ItemView: class { async setState() {} }, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const plugin = part('a4-projects');
const { normalizeSettings } = plugin.logic;

const ui = (raw) => { const u = normalizeSettings(raw).ui; return [u.view, u.kind]; };
assert.deepStrictEqual(ui(null), ['list', 'projects'], 'no data: List + Projects');
assert.deepStrictEqual(ui({ ui: { closedOpen: true } }), ['list', 'projects'], 'data from before the switches: List + Projects');
assert.deepStrictEqual(ui({ ui: { view: 'board', kind: 'tasks' } }), ['board', 'tasks'], 'last choice kept');
assert.deepStrictEqual(ui({ ui: { view: 'Board', kind: 7 } }), ['list', 'projects'], 'anything else: the default');
assert.deepStrictEqual(ui({ ui: { kind: 'areas' } }), ['list', 'areas'], 'Areas is remembered like Tasks');
// The choice survives a save and load round trip with the other settings.
const saved = JSON.parse(JSON.stringify(normalizeSettings({ ui: { view: 'board', closedOpen: true }, activity: [{ at: 1, text: 't' }] })));
assert.deepStrictEqual([saved.ui.view, saved.ui.kind, saved.ui.closedOpen, saved.activity.length], ['board', 'projects', true, 1]);
assert.deepStrictEqual(ui(saved), ['board', 'projects']);

// A click after a Sync reload swapped the settings object writes to the new one.
// Tiny fake DOM: just what renderOverview's switches touch.
const node = () => { const n = { kids: [], listeners: {}, className: '', textContent: '', dataset: {}, empty() {},
  createEl() { const c = node(); n.kids.push(c); return c; }, setAttr() {}, prepend(c) { n.kids.unshift(c); },
  addEventListener(t, f) { n.listeners[t] = f; }, querySelector() { return n.act; } }; return n; };
global.createDiv = () => node();
const page = node(); page.act = node();
const host = { settings: normalizeSettings({ ui: { view: 'board' } }), saved: null, async save() { this.saved = this.settings; } };
const view = { plugin: host, cfg: {}, today: '2026-10-13', tasks: [], state: {}, query: 'x', tab: 'projects', head() {}, render() {}, renderBoard() {}, areaButtons() {} };
plugin.ProjectsView.prototype.renderOverview.call(view, page);
host.settings = normalizeSettings({ ui: { view: 'board' } }); // Sync reload: new object, same pick
const find = (n, text) => n.textContent === text ? n : n.kids.map((c) => find(c, text)).find(Boolean);
(async () => {
  await find(page.act, 'List').listeners.click();
  assert.strictEqual(host.settings.ui.view, 'list', 'click changes the current settings, not the ones captured at render');
  assert.strictEqual(host.saved, host.settings, 'the current settings are saved');
  // Show switch reads Areas | Projects | Tasks; the Areas page has its own crumb, title and area cards, no List / Board.
  const shows = page.act.kids.find((k) => k.kids.some((c) => c.textContent === 'Tasks'));
  assert.deepStrictEqual(shows.kids.map((c) => c.textContent), ['Areas', 'Projects', 'Tasks'], 'switch order');
  const ap = node(); ap.act = node(); let heads = null; let drawn = null;
  const host2 = { settings: normalizeSettings({ ui: { kind: 'areas' } }), async save() {} };
  const av = { ...view, plugin: host2, areas: [{ name: 'B', sphere: 'work' }, { name: 'a', sphere: 'personal' }], head(pg, crumbs, title) { heads = [crumbs.map((c) => c[0]), title]; },
    areaSection(h, list) { drawn = list.map((x) => x.name); return true; }, renderTaskBoard() { throw new Error('no board'); } };
  plugin.ProjectsView.prototype.renderOverview.call(av, ap);
  assert.deepStrictEqual(heads, [['/ Projects', 'Areas'], 'Areas'], 'Areas page crumb and title');
  assert.deepStrictEqual(drawn, ['a', 'B'], 'every area, A to Z');
  assert.ok(!find(ap.act, 'List'), 'no List / Board on the Areas page');
  assert.strictEqual(find(ap.act, 'Areas').className, 'is-on', 'Areas is on');
  // The Areas page follows
  // the buttons, not how the tab was opened (owner bug report 2026-10-28), and shows the buttons itself.
  let buttons = 0;
  const pg = () => { const n = node(); n.act = node(); return n; };
  const pv = { ...av, area: null, areaButtons() { buttons++; } };
  let actions = null; let added;
  pv.head = (p, c, t, a) => { actions = a; };
  pv.plugin = { ...host2, addArea(side) { added = side; } };
  drawn = null;
  plugin.ProjectsView.prototype.renderOverview.call(pv, pg());
  assert.deepStrictEqual(drawn, ['a', 'B'], 'no button pressed: every area');
  assert.strictEqual(buttons, 1, 'the Areas page has the Work / Personal buttons');
  added = 'x'; actions.find((x) => x && x.label === '+ Add area').run();
  assert.strictEqual(added, null, 'buttons cleared: + Add area starts with no side chosen');
  drawn = null;
  plugin.ProjectsView.prototype.renderOverview.call({ ...pv, area: 'work' }, pg());
  assert.deepStrictEqual(drawn, ['B'], 'Work pressed: work areas only');
  actions.find((x) => x && x.label === '+ Add area').run();
  assert.strictEqual(added, 'work', 'Work pressed: + Add area starts with work');
  const empty = pg();
  plugin.ProjectsView.prototype.renderOverview.call({ ...pv, area: 'work', areas: [], areaSection() { return false; } }, empty);
  assert.ok(find(empty, 'no work areas yet'), 'an empty Work list says so');
  // Projects > List follows the same buttons (owner task 2026-10-28): the areas, projects and tasks it lists,
  // whatever the tab was opened from. Same fixtures as above; a real areaList, overviewGroups and search.
  const lp = pg(); let listButtons = 0; let listed = null; let listHead = null;
  const lv = { ...pv, areas: av.areas, projects: [], notes: [], tasks: [], filter: 'all', query: '', state: {}, area: null,
    plugin: { ...host2, settings: normalizeSettings({ ui: { kind: 'projects', view: 'list' } }) },
    areaButtons() { listButtons++; }, areaSection(h, areas) { listed = areas.map((a) => a.name); return areas.length; },
    head(p, c, t) { listHead = [c.map((x) => x[0]), t]; } };
  lv.renderLists = plugin.ProjectsView.prototype.renderLists;
  plugin.ProjectsView.prototype.renderOverview.call(lv, lp);
  assert.strictEqual(listButtons, 1, 'List has the Work / Personal buttons');
  assert.deepStrictEqual(listed, ['a', 'B'], 'List, no button pressed: every area');
  assert.deepStrictEqual(listHead, [['/ Projects'], 'Projects'], 'List, no button pressed: crumb and title say so');
  plugin.ProjectsView.prototype.renderOverview.call({ ...lv, area: 'work' }, pg());
  assert.deepStrictEqual(listed, ['B'], 'List, Work pressed: work areas only');
  assert.deepStrictEqual(listHead, [['/ Projects', 'Work'], 'Work projects'], 'List, Work pressed: crumb and title say so');
  plugin.ProjectsView.prototype.renderOverview.call({ ...lv, area: 'personal' }, pg());
  assert.deepStrictEqual(listHead, [['/ Projects', 'Personal'], 'Personal projects'], 'List, Personal pressed: crumb and title say so');
  // The button is the only source. A restart brings it back, because the tab's saved state holds it.
  // "/ Projects" and Open projects mean all projects on every page; the Work or Personal crumb means that list.
  const nav = (area) => Object.assign(Object.create(plugin.ProjectsView.prototype), { state: { page: 'overview', project: null }, area, expanded: new Set(), query: 'typed', tab: 'ideas', render() {}, leaf: {} });
  const a = nav('work');
  const before = JSON.parse(JSON.stringify(a.getState()));
  await a.setState({ page: 'project', project: 'P.md' }, {});
  assert.strictEqual(a.area, 'work', 'opening a project keeps the button');
  await a.setState(before, {});
  assert.strictEqual(a.area, 'work', 'its saved state still holds the button');
  const restored = nav(null);
  await restored.setState(before, {});
  assert.strictEqual(restored.area, 'work', 'a restart brings the pressed button back');
  await a.setState({ page: 'project', project: 'P.md' }, {});
  await a.setState({ page: 'overview' }, {});
  assert.strictEqual(a.area, null, '/ Projects from a project page: all projects');
  await a.setState({ page: 'overview', focus: 'personal' }, {});
  assert.strictEqual(a.area, 'personal', 'the sidebar Personal item, or a Personal crumb, turns Personal on');
  await a.setState({ page: 'overview' }, {});
  assert.strictEqual(a.area, null, 'Open projects, or / Projects on the list: all projects');
  const older = nav(null);
  await older.setState({ page: 'overview', project: null, focus: 'personal' }, {});
  assert.strictEqual(older.area, 'personal', 'a tab saved before 1.1.6 starts with its focus on');
  // Asking for the page already showing keeps the search and the tab.
  const same = nav('work');
  await same.setState({ page: 'overview', focus: 'work' }, {});
  assert.deepStrictEqual([same.query, same.tab], ['typed', 'ideas'], 'the same page again: search and tab stay');
  // A move is saved with the layout, so it survives a quit.
  const moved2 = nav(null); const res = {};
  await moved2.setState({ page: 'overview', focus: 'work' }, res);
  assert.strictEqual(res.layout, true, 'a change of list asks Obsidian to save the layout');
  // go() acts on its own tab, not the first Projects tab.
  let moved = null; let elsewhere = false;
  const own = nav(null); own.leaf = { setViewState: async (v) => { moved = v.state; } }; own.plugin = { openProjects() { elsewhere = true; } };
  await own.go({ page: 'overview', focus: 'work' });
  assert.deepStrictEqual([moved, elsewhere], [{ page: 'overview', focus: 'work' }, false], 'a click moves its own tab');
  // A pressed button is saved with the layout.
  let layoutSaves = 0;
  const pressed = nav(null); pressed.app = { workspace: { requestSaveLayout() { layoutSaves++; } } }; pressed.refreshTitle = () => {};
  const bar = node(); bar.setAttr = () => {};
  pressed.areaButtons(bar);
  find(bar, 'Work').listeners.click();
  assert.deepStrictEqual([pressed.area, layoutSaves], ['work', 1], 'pressing a button asks Obsidian to save the layout');
  console.log('view switch self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
