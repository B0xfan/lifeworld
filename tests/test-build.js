// The built main.js keeps the TaskNotes credit (MIT notice; esbuild drops ordinary comments)
// and exports what Obsidian and the other A4 plugins/tests use.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const MAIN = path.join(__dirname, '..', 'main.js');
const head = fs.readFileSync(MAIN, 'utf8').slice(0, 400);
assert.ok(/Copyright 2025 Callum Alpass, MIT License/.test(head), 'TaskNotes credit at the top of main.js');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const P = require(MAIN);
assert.strictEqual(typeof P, 'function', 'module.exports is the plugin class');
assert.strictEqual(P.name, 'A4ProjectsPlugin', 'class names survive bundling');
for (const k of ['logic', 'TaskEngine', 'TaskLinks', 'ProjectsView', 'IdeaModal', 'cardAccent']) assert.ok(P[k], `exports ${k}`);
console.log('build self-check: OK');
