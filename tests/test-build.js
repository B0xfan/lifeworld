// The built file keeps the TaskNotes credit (MIT notice; esbuild drops ordinary comments) and
// exports what Obsidian, the tests and the parts use. Phase 2 section 1: the repo-root main.js is
// the one LifeWorld plugin; section 8: the tests take every part from it (no part is built alone).
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert');
const ROOT = path.join(__dirname, '..');
const MAIN = path.join(ROOT, 'main.js');
assert.ok(/Copyright 2025 Callum Alpass, MIT License/.test(fs.readFileSync(MAIN, 'utf8').slice(0, 400)), 'TaskNotes credit at the top of main.js');
const anyObsidian = { Platform: {} }; // lifeworld() adds the base classes
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? anyObsidian : load.call(this, req, ...a); };
const { lifeworld } = require('./lib/paths');
const LW = lifeworld();
// Obsidian takes `module.exports.default || module.exports` (its plugin loader, 1.14.4 app code).
assert.strictEqual(require(MAIN).default, LW, 'main.js has a default export');
assert.strictEqual(LW.name, 'LifeWorldPlugin', 'the one plugin class is the default export');
assert.ok(!fs.existsSync(path.join(ROOT, 'dist')), 'no part is built alone (dist/ is gone)');
for (const [id, cls] of [['a4-projects', 'A4ProjectsPlugin'], ['a4-today', 'A4TodayPlugin'], ['a4-planner', 'A4PlannerPlugin'], ['a4-sidebar', 'A4SidebarPlugin']]) {
  const P = LW.parts[id];
  assert.strictEqual(P.name, cls, `${id}: its class, name kept by bundling`);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', id.slice(3), 'manifest.json'), 'utf8')).id, id, `${id} manifest id`);
}
const P = LW.parts['a4-projects'];
for (const k of ['logic', 'TaskEngine', 'TaskLinks', 'ProjectsView', 'IdeaModal', 'cardAccent']) assert.ok(P[k], `Projects exports ${k}`);
for (const id of ['a4-today', 'a4-planner']) assert.ok(LW.parts[id].logic, `${id} exports its helpers`);
assert.ok(LW.parts['a4-sidebar'].__logic && LW.parts['a4-sidebar'].addExtra, 'Sidebar exports its helpers and addExtra');
assert.strictEqual(typeof LW.vault.startWith, 'function', 'the tests can start on the frozen test vault');
// Inside Obsidian (a window exists) the test hook is never set, so another plugin cannot reach it (review p2-s8 #2).
delete require.cache[MAIN]; global.window = {};
assert.strictEqual(require(MAIN).default.vault, undefined, 'no vault test hook when a window exists');
delete global.window; delete require.cache[MAIN];
// The shipped main.js carries the four font licence texts (SIL OFL asks for it; review p2-s8 #1).
const built = fs.readFileSync(MAIN, 'utf8');
const lic = fs.readdirSync(path.join(ROOT, 'src', 'today', 'fonts'));
assert.strictEqual(lic.length, 4, 'Today keeps its four font licence texts');
for (const f of lic) assert.ok(built.includes(fs.readFileSync(path.join(ROOT, 'src', 'today', 'fonts', f), 'utf8').trim()), `main.js ships ${f}`);
assert.ok(/SIL OPEN FONT LICENSE Version 1\.1/.test(built.slice(-5000)), 'the licence texts sit at the end of main.js');
// CodeMirror is loaded when the editor add-ons start, never when main.js loads (review p2-s8 #3).
assert.ok(!/^var import_(state|view|language)\d* = require\("@codemirror/m.test(built) && /Promise\.resolve\(\)\.then\(\(\) => __toESM\(require\("@codemirror\/language"\)\)\)/.test(built), 'CodeMirror loads late, inside a promise');
// Greeting: the name comes from Settings › Today page (phase 2 section 5), never from the build.
assert.strictEqual(LW.parts['a4-today'].logic.greetingLine(9), 'Good morning', 'greeting line: no name built in');
assert.ok(!/LW_LOCAL_|local\.json|LW_START_VAULT|define:/.test(fs.readFileSync(path.join(ROOT, 'esbuild.config.mjs'), 'utf8')), 'the build reads no owner-only or test-only values');
// Phase 2 section 8, the checker's code tidy: ES modules only, no `this` alias, no style set from
// code with a fixed value, every package the code imports listed, and Today's greeting not stored
// under `titleEl` (Obsidian's own name for a view's header title, which it writes to).
const srcFiles = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? srcFiles(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
const tidy = { require: /\brequire\(/, 'module.exports': /\bmodule\.exports\b/, 'this alias': /\b(?:const|let|var)\s+\w+\s*=\s*this\s*;/, 'fixed style': /\.style\.\w+\s*=\s*['"`][^$'"`]*['"`]|\.style\.setProperty\(\s*'[\w-]+',\s*'/ };
const found = srcFiles(path.join(ROOT, 'src')).flatMap((f) => Object.entries(tidy).filter(([, re]) => re.test(code(f))).map(([k]) => `${path.relative(ROOT, f)}: ${k}`));
assert.deepStrictEqual(found, [], 'src/: no require, module.exports, this alias or fixed style from code');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies;
const imported = new Set(srcFiles(path.join(ROOT, 'src')).flatMap((f) => [...code(f).matchAll(/\bfrom '(@?[^'./][^']*)'/g)].map((m) => m[1])));
assert.deepStrictEqual([...imported].filter((m) => m !== 'obsidian' && !pkg[m]), [], 'every package src/ imports is a listed dev dependency');
const today = code(path.join(ROOT, 'src', 'today', 'main.js'));
assert.ok(!/this\.titleEl\s*=/.test(today) && /this\.greetEl = left\.createEl\('h2'/.test(today), "Today's greeting is not stored as the view's titleEl");
assert.ok(/createDiv\(\{ cls: 'a4t-accent-probe' \}\)/.test(today) && /body > \.a4t-accent-probe \{ color: var\(--color-accent, var\(--interactive-accent\)\); \}/.test(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8')), "Today reads Obsidian's accent through a CSS class in the shipped styles.css");
console.log('build self-check: OK');
