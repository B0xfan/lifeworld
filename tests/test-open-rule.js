#!/usr/bin/env node
/* Self-check for the project open rule (projects board, section 3).
 * `node tests/test-open-rule.js` from the repo root. Every status value:
 * open ones show in the overview and the task pickers, closed ones in Closed,
 * idea and cold-storage in neither. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { part } = require('./lib/paths');
const MAIN = 'a4-projects';
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const Plugin = part(MAIN);
const L = Plugin.logic;
const assert = require('assert');

const OPEN = ['active', 'paused', 'waiting', 'blocked', 'backlog', '', 'someunknown'];
const CLOSED = ['done', 'failed', 'dropped'];
const SHELVED = ['idea', 'cold-storage'];
const all = [...OPEN, ...CLOSED, ...SHELVED];
const ps = all.map((st) => L.readProject({ type: 'project', sphere: 'work', status: st }, `P/${st}.md`, st || 'nostatus'));
const isOpenNote = (fm) => Plugin.prototype.isOpenProjectNote.call({}, fm);

for (const p of ps) {
  const want = OPEN.includes(p.status);
  assert.strictEqual(L.isOpenProject(p), want, `isOpenProject(${p.status || '(none)'})`);
  assert.strictEqual(isOpenNote({ type: 'project', status: p.status }), want, `isOpenProjectNote(${p.status || '(none)'}) (sidebar counts)`);
}
assert.strictEqual(isOpenNote({ type: 'project' }), true, 'no status line: open, as before');
assert.strictEqual(isOpenNote({ type: 'project', status: 'Idea ' }), false, 'status is trimmed and lower-cased');
assert.strictEqual(isOpenNote({ type: 'project', status: 'Cold-Storage' }), false, 'cold-storage, any case');
assert.strictEqual(L.isOpenProject(null), false, 'no project: not open');

const listed = L.overviewGroups(ps, 'all', '').flatMap((g) => g.projects.map((p) => p.status));
assert.deepStrictEqual(listed.slice(0, 5), ['active', 'paused', 'waiting', 'blocked', 'backlog'], 'List order: waiting and blocked after paused, before backlog');
assert.deepStrictEqual([...listed].sort(), [...OPEN].sort(), 'List shows exactly the open ones');
assert.deepStrictEqual(L.closedProjects(ps, '').map((p) => p.status).sort(), [...CLOSED].sort(), 'Closed shows done, failed, dropped only (no ideas, no cold storage)');

// Both task pickers use the shared rule, not their own copy of the closed list.
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'projects', 'main.js'), 'utf8'); // source text, not the bundle
assert.strictEqual((src.match(/collectProjects\(\)\.filter\(\(p\) => p\.sphere === sp && isOpenProject\(p\)/g) || []).length, 2, 'both pickers call isOpenProject');
assert.strictEqual((src.match(/!CLOSED_STATUSES\.includes\(p\.status\)/g) || []).length, 1, 'only isOpenProject tests the closed list for openness');
console.log(`open rule: OK (${all.length} status values)`);
