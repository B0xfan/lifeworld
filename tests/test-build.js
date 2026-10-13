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
// Today, Planner and Sidebar: complete plugin folders that load.
const anyObsidian = new Proxy({}, { get: (t, k) => (k === 'Platform' ? {} : class {}) });
Module._load = function (req, ...a) { return req === 'obsidian' ? anyObsidian : load.call(this, req, ...a); };
for (const [id, cls] of [['a4-today', 'A4TodayPlugin'], ['a4-planner', 'A4PlannerPlugin'], ['a4-sidebar', 'A4SidebarPlugin']]) {
  const dir = path.join(__dirname, '..', 'dist', id);
  for (const f of ['main.js', 'manifest.json', 'styles.css']) assert.ok(fs.existsSync(path.join(dir, f)), `${id}/${f} built`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).id, id, `${id} manifest id`);
  assert.strictEqual(require(path.join(dir, 'main.js')).name, cls, `${id} exports its plugin class`);
}
assert.strictEqual(fs.readdirSync(path.join(__dirname, '..', 'dist', 'a4-today', 'fonts')).length, 4, 'Today ships its four font licence texts');
// Greeting: the build-time name when local.json has one, else no trailing comma.
const localFile = path.join(__dirname, '..', 'local.json');
const name = fs.existsSync(localFile) ? JSON.parse(fs.readFileSync(localFile, 'utf8')).userName || '' : '';
const T = require(path.join(__dirname, '..', 'dist', 'a4-today', 'main.js')).logic;
assert.strictEqual(T.greetingLine(9), name ? `Good morning, ${name}` : 'Good morning', 'greeting line');
console.log('build self-check: OK');
