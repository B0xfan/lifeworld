#!/usr/bin/env node
/* Self-check for the Projects page switches (section 6): List / Board and
 * Projects / Tasks are kept in plugin data, default to today's List + Projects,
 * and anything else in the data falls back to that. No Obsidian needed. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const { normalizeSettings } = require(path.join(__dirname, '..', 'main.js')).logic;

const ui = (raw) => { const u = normalizeSettings(raw).ui; return [u.view, u.kind]; };
assert.deepStrictEqual(ui(null), ['list', 'projects'], 'no data: List + Projects');
assert.deepStrictEqual(ui({ ui: { closedOpen: true } }), ['list', 'projects'], 'data from before the switches: List + Projects');
assert.deepStrictEqual(ui({ ui: { view: 'board', kind: 'tasks' } }), ['board', 'tasks'], 'last choice kept');
assert.deepStrictEqual(ui({ ui: { view: 'Board', kind: 7 } }), ['list', 'projects'], 'anything else: the default');
// The choice survives a save and load round trip with the other settings.
const saved = JSON.parse(JSON.stringify(normalizeSettings({ ui: { view: 'board', closedOpen: true }, activity: [{ at: 1, text: 't' }] })));
assert.deepStrictEqual([saved.ui.view, saved.ui.kind, saved.ui.closedOpen, saved.activity.length], ['board', 'projects', true, 1]);
assert.deepStrictEqual(ui(saved), ['board', 'projects']);
console.log('view switch self-check: OK');
