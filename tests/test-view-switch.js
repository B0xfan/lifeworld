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
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
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
const node = () => { const n = { kids: [], listeners: {}, className: '', textContent: '',
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
  plugin.ProjectsView.prototype.renderOverview.call(pv, pg());
  assert.deepStrictEqual(drawn, ['a', 'B'], 'buttons cleared: every area, even in a Personal tab');
  assert.strictEqual(buttons, 1, 'the Areas page has the Work / Personal buttons');
  plugin.ProjectsView.prototype.renderOverview.call({ ...pv, area: 'work' }, pg());
  assert.deepStrictEqual(drawn, ['B'], 'Work pressed: work areas only');
  console.log('view switch self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
