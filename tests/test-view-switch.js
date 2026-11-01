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
  // Opened as "Personal projects", then the Work / Personal buttons cleared: the Areas page follows
  // the buttons, not how the tab was opened (owner bug report 2026-10-28), and shows the buttons itself.
  let buttons = 0;
  const pg = () => { const n = node(); n.act = node(); return n; };
  const pv = { ...av, state: { focus: 'personal' }, area: null, areaButtons() { buttons++; } };
  let actions = null; let added;
  pv.head = (p, c, t, a) => { actions = a; };
  pv.plugin = { ...host2, addArea(side) { added = side; } };
  drawn = null;
  plugin.ProjectsView.prototype.renderOverview.call(pv, pg());
  assert.deepStrictEqual(drawn, ['a', 'B'], 'buttons cleared: every area, even in a Personal tab');
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
  const lv = { ...pv, areas: av.areas, projects: [], notes: [], tasks: [], filter: 'all', query: '', state: { focus: 'personal' }, area: null,
    plugin: { ...host2, settings: normalizeSettings({ ui: { kind: 'projects', view: 'list' } }) },
    areaButtons() { listButtons++; }, areaSection(h, areas) { listed = areas.map((a) => a.name); return areas.length; },
    head(p, c, t) { listHead = [c.map((x) => x[0]), t]; } };
  lv.renderLists = plugin.ProjectsView.prototype.renderLists;
  plugin.ProjectsView.prototype.renderOverview.call(lv, lp);
  assert.strictEqual(listButtons, 1, 'List has the Work / Personal buttons');
  assert.deepStrictEqual(listed, ['a', 'B'], 'List, buttons cleared in a Personal tab: every area');
  assert.deepStrictEqual(listHead, [['/ Projects'], 'Projects'], 'List, buttons cleared in a Personal tab: the crumb and title say so');
  plugin.ProjectsView.prototype.renderOverview.call({ ...lv, area: 'work' }, pg());
  assert.deepStrictEqual(listed, ['B'], 'List, Work pressed: work areas only');
  assert.deepStrictEqual(listHead, [['/ Projects'], 'Work projects'], 'List, Work pressed: the title says so');
  plugin.ProjectsView.prototype.renderOverview.call({ ...lv, area: 'personal' }, pg());
  assert.deepStrictEqual(listHead, [['/ Projects', 'Personal'], 'Personal projects'], 'List opened as Personal, still Personal: crumb and title unchanged');
  // The buttons survive a trip to a project page and back; a tab opened as Personal goes back to Personal.
  const nav = (state, area) => Object.assign(Object.create(plugin.ProjectsView.prototype), { state, area, expanded: new Set(), render() {} });
  const plain = nav({ page: 'overview', project: null, focus: null }, 'work');
  await plain.setState({ page: 'project', project: 'P.md' }, {});
  await plain.setState({ page: 'overview' }, {});
  assert.strictEqual(plain.area, 'work', 'plain tab: Work stays on after opening a project and coming back');
  const toFocus = nav({ page: 'overview', project: null, focus: null }, 'work');
  await toFocus.setState({ page: 'overview', focus: 'personal' }, {});
  assert.strictEqual(toFocus.area, 'personal', 'the sidebar Personal item turns Personal on');
  await toFocus.setState({ page: 'project', project: 'P.md' }, {});
  await toFocus.setState({ page: 'overview' }, {});
  assert.strictEqual(toFocus.area, 'personal', 'a tab opened as Personal keeps Personal after opening a project and coming back');
  await toFocus.setState({ page: 'overview', focus: null }, {});
  assert.strictEqual(toFocus.area, null, 'Open projects and the crumb out of the Personal list clear it');
  // A restart brings the button back; a tab saved before 1.1.6 has only its focus.
  toFocus.area = 'work';
  const saved2 = JSON.parse(JSON.stringify(toFocus.getState()));
  const restored = nav({ page: 'overview', project: null, focus: null }, null);
  await restored.setState(saved2, {});
  assert.strictEqual(restored.area, 'work', 'a restart keeps the pressed button');
  const older = nav({ page: 'overview', project: null, focus: null }, null);
  await older.setState({ page: 'overview', project: null, focus: 'personal' }, {});
  assert.strictEqual(older.area, 'personal', 'a tab saved before 1.1.6 starts with its focus on');
  console.log('view switch self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
