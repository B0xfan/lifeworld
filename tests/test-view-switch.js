#!/usr/bin/env node
/* Self-check for the Projects page switches (section 6), no Obsidian needed:
 * normalizeSettings gives List + Projects by default and for bad values and
 * keeps a saved pick through a JSON round trip; a switch click after the
 * settings object is swapped (as a Sync reload does) changes and saves the
 * current settings. Real saving to disk and the page look are not exercised. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const plugin = require(path.join(__dirname, '..', 'main.js'));
const { normalizeSettings } = plugin.logic;

const ui = (raw) => { const u = normalizeSettings(raw).ui; return [u.view, u.kind]; };
assert.deepStrictEqual(ui(null), ['list', 'projects'], 'no data: List + Projects');
assert.deepStrictEqual(ui({ ui: { closedOpen: true } }), ['list', 'projects'], 'data from before the switches: List + Projects');
assert.deepStrictEqual(ui({ ui: { view: 'board', kind: 'tasks' } }), ['board', 'tasks'], 'last choice kept');
assert.deepStrictEqual(ui({ ui: { view: 'Board', kind: 7 } }), ['list', 'projects'], 'anything else: the default');
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
const view = { plugin: host, cfg: {}, today: '2026-10-13', tasks: [], state: {}, query: 'x', tab: 'projects', head() {}, render() {}, renderBoard() {} };
plugin.ProjectsView.prototype.renderOverview.call(view, page);
host.settings = normalizeSettings({ ui: { view: 'board' } }); // Sync reload: new object, same pick
const find = (n, text) => n.textContent === text ? n : n.kids.map((c) => find(c, text)).find(Boolean);
(async () => {
  await find(page.act, 'List').listeners.click();
  assert.strictEqual(host.settings.ui.view, 'list', 'click changes the current settings, not the ones captured at render');
  assert.strictEqual(host.saved, host.settings, 'the current settings are saved');
  console.log('view switch self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
