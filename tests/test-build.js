// The built files keep the TaskNotes credit (MIT notice; esbuild drops ordinary comments) and
// export what Obsidian, the tests and the parts use. Phase 2 section 1: the repo-root main.js is
// the one LifeWorld plugin; each part is also built alone in dist/<old id>/ for the tests.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main.js');
const PJ = path.join(ROOT, 'dist', 'a4-projects', 'main.js');
for (const f of [MAIN, PJ]) assert.ok(/Copyright 2025 Callum Alpass, MIT License/.test(fs.readFileSync(f, 'utf8').slice(0, 400)), `TaskNotes credit at the top of ${path.relative(ROOT, f)}`);
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const P = require(PJ);
assert.strictEqual(typeof P, 'function', 'module.exports is the plugin class');
assert.strictEqual(P.name, 'A4ProjectsPlugin', 'class names survive bundling');
for (const k of ['logic', 'TaskEngine', 'TaskLinks', 'ProjectsView', 'IdeaModal', 'cardAccent']) assert.ok(P[k], `exports ${k}`);
// The four parts built alone: complete plugin folders that load.
const anyObsidian = new Proxy({}, { get: (t, k) => (k === 'Platform' ? {} : class {}) });
Module._load = function (req, ...a) { return req === 'obsidian' ? anyObsidian : load.call(this, req, ...a); };
for (const [id, cls] of [['a4-projects', 'A4ProjectsPlugin'], ['a4-today', 'A4TodayPlugin'], ['a4-planner', 'A4PlannerPlugin'], ['a4-sidebar', 'A4SidebarPlugin']]) {
  const dir = path.join(ROOT, 'dist', id);
  for (const f of ['main.js', 'manifest.json', 'styles.css']) assert.ok(fs.existsSync(path.join(dir, f)), `${id}/${f} built`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).id, id, `${id} manifest id`);
  assert.strictEqual(require(path.join(dir, 'main.js')).name, cls, `${id} exports its plugin class`);
  // The same part inside the one plugin: same class, same exported helpers.
  const inOne = require(MAIN).parts[id]; const alone = require(path.join(dir, 'main.js'));
  assert.strictEqual(inOne.name, cls, `${id} is in the one plugin`);
  assert.deepStrictEqual(Object.keys(inOne).sort(), Object.keys(alone).sort(), `${id}: same exports in the one plugin`);
  if (alone.logic) assert.deepStrictEqual(Object.keys(inOne.logic).sort(), Object.keys(alone.logic).sort(), `${id}: same helpers in the one plugin`);
}
assert.strictEqual(require(MAIN).name, 'LifeWorldPlugin', 'the one plugin class');
assert.strictEqual(fs.readdirSync(path.join(ROOT, 'dist', 'a4-today', 'fonts')).length, 4, 'Today ships its four font licence texts');
// Greeting: the name comes from Settings › Today page (phase 2 section 5), never from the build.
const T = require(path.join(__dirname, '..', 'dist', 'a4-today', 'main.js')).logic;
assert.strictEqual(T.greetingLine(9), 'Good morning', 'greeting line: no name built in');
assert.ok(!/LW_LOCAL_|local\.json/.test(fs.readFileSync(path.join(__dirname, '..', 'esbuild.config.mjs'), 'utf8')), 'the build reads no owner-only values');
console.log('build self-check: OK');
