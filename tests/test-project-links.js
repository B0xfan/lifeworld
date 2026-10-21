#!/usr/bin/env node
/* Tests for project links (Today 1.2.6, Planner 1.0.5, Projects 0.1.5):
 * an Active projects chip and a task's project label open the project's page
 * in Projects (Cmd/Ctrl-click: a new tab), or the note when Projects is
 * off or has no page for it. No Obsidian needed: `node tests/test-project-links.js`.
 * The click-through in real Obsidian is the hidden-sandbox run (session scratch). */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { part, STYLES, source } = require('./lib/paths');
const FILES = { today: 'a4-today', planner: 'a4-planner', projects: 'a4-projects', sidebar: 'a4-sidebar' };
const src = {}; for (const k of Object.keys(FILES)) src[k] = fs.readFileSync(source(FILES[k]), 'utf8');

class TFile { constructor(p) { this.path = p; this.basename = p.split('/').pop().replace(/\.md$/, ''); this.extension = 'md'; } }
class TFolder {}
const Keymap = { isModEvent: (e) => (e && (e.metaKey || e.ctrlKey) ? 'tab' : false) };
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {}, Menu: class {}, Keymap };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };

let n = 0; let failed = 0;
function ok(cond, name, extra) { n++; if (!cond) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- 1. the shared helper is the same text in Today and Planner ---------- */
function extractAsync(s, name) { const m = new RegExp(`^async function ${name}\\(`, 'm').exec(s); return m ? s.slice(m.index, s.indexOf('\n}\n', m.index) + 2) : null; }
const hT = extractAsync(src.today, 'openProjectPage'); const hP = extractAsync(src.planner, 'openProjectPage');
ok(hT && hP && hT === hP, 'openProjectPage identical in Today and Planner');
// wikilinkTarget, which it uses, is shared too
// Updated in section 7: one copy in src/core/tasks.js (tests/test-core.js checks no plugin keeps its own).
const { fromCore } = require('./lib/core-use');
ok([src.today, src.planner].every((s) => fromCore(s, ['wikilinkTarget'], true)('wikilinkTarget')), 'Today and Planner use wikilinkTarget and take it from the shared core');

/* ---- 2. where it is wired (static) --------------------------------------- */
ok(/a4t-prow' \}\);[\s\S]{0,200}addEventListener\('click', \(e\) => openProjectPage\(this\.app, p\.path, e, p\.path\)\)/.test(src.today), 'Today: Active projects row opens the project page');
ok(!/a4t-prow' \}\);[\s\S]{0,200}openPath\(p\.path/.test(src.today), 'Today: row does not open the note directly');
ok(/chip\(t\.project, 'is-proj'\);\s*\n\s*pc\.addEventListener\('click', \(e\) => \{\s*\n\s*e\.stopPropagation\(\);\s*\n\s*if \(row\._justDragged\) return;\s*\n\s*openProjectPage\(this\.app, t\.projectLink \|\| t\.project, e, t\.path\)/.test(src.today), 'Today: task project label opens the project page, not the task');
ok(/it\.projectLink = asList\(fm\.projects\)\[0\] \|\| null/.test(src.today), 'Today: task keeps its project link');
ok(/'a4pl-chip a4pl-proj'[^\n]*\);\s*\n\s*pc\.addEventListener\('click', \(e\) => \{ e\.stopPropagation\(\); if \(r\._dragged\) return; openProjectPage\(this\.app, it\.projectLink \|\| it\.projectKey, e, it\.path\)/.test(src.planner), 'Planner: task project label opens the project page');
ok(/pj\.openProject\(m\.file\.path\)/.test(src.sidebar), 'Sidebar: project rows already open the project page (unchanged)');
// 0.1.9: one line per project (option 1)
ok(/createEl\('button', \{ cls: 'a4t-prow' \}\)/.test(src.today), 'Today: project lines are buttons (0.1.9, option 1: no area headings)');

/* ---- 3. the helper's behaviour (both copies) ------------------------------ */
const NOTE = '04 Library/My Life/Projects/Garden Plan.md';
function fakeApp(o) {
  const log = [];
  const files = new Map([[NOTE, new TFile(NOTE)]]);
  const app = {
    log,
    plugins: { plugins: {} },
    vault: { getAbstractFileByPath: (p) => files.get(p) || null },
    metadataCache: { getFirstLinkpathDest: (link, from) => { log.push(['resolve', link, from]); return link === 'Garden Plan' ? files.get(NOTE) : null; } },
    workspace: { getLeaf: (m) => ({ openFile: async (f) => { log.push(['openFile', m, f.path]); } }) },
  };
  if (o && o.projects) app.plugins.plugins['a4-projects'] = o.projects;
  return app;
}
const plainClick = { metaKey: false, ctrlKey: false };
const modClick = { metaKey: true, ctrlKey: false };
const ctrlClick = { metaKey: false, ctrlKey: true };

async function helperCases(label, mod) {
  const open = mod.logic.openProjectPage;
  ok(typeof open === 'function', `${label}: helper exported`);
  // Projects on and has the page
  let calls = [];
  let app = fakeApp({ projects: { openProjectPage: async (ref, opts) => { calls.push([ref, opts]); return true; } } });
  eq(await open(app, NOTE, plainClick, NOTE), 'page', `${label}: chip -> page`);
  eq(calls, [[NOTE, { newTab: false }]], `${label}: plain click reuses the Projects tab`);
  calls = [];
  eq(await open(app, NOTE, modClick, NOTE), 'page', `${label}: Cmd-click -> page`);
  eq(calls, [[NOTE, { newTab: true }]], `${label}: Cmd-click asks for a new tab`);
  calls = [];
  await open(app, NOTE, ctrlClick, NOTE);
  eq(calls, [[NOTE, { newTab: true }]], `${label}: Ctrl-click asks for a new tab`);
  calls = [];
  await open(app, '[[Garden Plan]]', null, 'Tasks/x.md');
  eq(calls, [['[[Garden Plan]]', { newTab: false }]], `${label}: a task link goes to Projects as is (no event = plain)`);
  ok(!app.log.some((l) => l[0] === 'openFile'), `${label}: no note opened when the page opened`);
  // Projects off: the note, in a new tab as before
  app = fakeApp();
  eq(await open(app, NOTE, plainClick, NOTE), 'note', `${label}: off -> note`);
  eq(app.log.filter((l) => l[0] === 'openFile'), [['openFile', 'tab', NOTE]], `${label}: off -> note in a new tab`);
  app = fakeApp();
  eq(await open(app, '[[Garden Plan|GP]]', plainClick, 'Tasks/x.md'), 'note', `${label}: off + aliased task link -> note`);
  ok(app.log.some((l) => l[0] === 'resolve' && l[1] === 'Garden Plan' && l[2] === 'Tasks/x.md'), `${label}: link resolved from the task's own path`);
  app = fakeApp();
  eq(await open(app, '[[Garden Plan#Notes]]', plainClick, 'Tasks/x.md'), 'note', `${label}: heading link -> note`);
  app = fakeApp();
  eq(await open(app, 'Missing Project', plainClick, 'Tasks/x.md'), false, `${label}: off + unknown project -> nothing`);
  // Projects on but no page for it, an older Projects part, or a failure: the note
  app = fakeApp({ projects: { openProjectPage: async () => false } });
  eq(await open(app, NOTE, plainClick, NOTE), 'note', `${label}: no page -> note`);
  app = fakeApp({ projects: { openProject: () => {} } });
  eq(await open(app, NOTE, plainClick, NOTE), 'note', `${label}: older Projects part without the API -> note`);
  const err = console.error; console.error = () => {};
  app = fakeApp({ projects: { openProjectPage: async () => { throw new Error('boom'); } } });
  eq(await open(app, NOTE, plainClick, NOTE), 'note', `${label}: page error -> note`);
  console.error = err;
  eq(await open(fakeApp(), null, plainClick, NOTE), false, `${label}: no project -> nothing`);
  eq(await open(fakeApp(), '', plainClick, NOTE), false, `${label}: empty project -> nothing`);
}

/* ---- 4. Projects' public API ------------------------------------------- */
async function projectsCases() {
  const P = part(FILES.projects);
  const projects = [
    { path: NOTE, name: 'Garden Plan', key: 'Garden Plan' },
    { path: '04 Library/My Life/Projects/ABC Northside.md', name: 'ABC Northside', key: 'ABC Northside' },
  ];
  const plugin = Object.create(P.prototype);
  const ws = { leaves: [], made: 0, active: null, revealed: null };
  const mkLeaf = () => { const l = { id: ++ws.made, state: null, async setViewState(s) { this.state = s; } }; return l; };
  ws.getLeavesOfType = (t) => (t === 'a4-projects' ? ws.leaves.filter((l) => l.state) : []);
  ws.getLeaf = (m) => { const l = mkLeaf(); l.mode = m; ws.leaves.push(l); return l; };
  ws.revealLeaf = (l) => { ws.revealed = l; };
  ws.setActiveLeaf = (l) => { ws.active = l; };
  plugin.app = { workspace: ws };
  plugin.engine = { collectProjects: () => projects, collectNotes: () => ({ projects, areas: [] }) };
  eq(plugin.projectPathFor(NOTE), NOTE, 'Projects: a project path finds its page');
  eq(plugin.projectPathFor('[[Garden Plan]]'), NOTE, 'Projects: a task link finds the page');
  eq(plugin.projectPathFor('[[Garden Plan|GP]]'), NOTE, 'Projects: an aliased link finds the page');
  eq(plugin.projectPathFor('[[04 Library/My Life/Projects/ABC Northside]]'), projects[1].path, 'Projects: a path link finds the page');
  eq(plugin.projectPathFor('Garden Plan'), NOTE, 'Projects: a bare name finds the page');
  eq(plugin.projectPathFor('Nope'), null, 'Projects: unknown project -> null');
  eq(plugin.projectPathFor(null), null, 'Projects: nothing -> null');
  eq(plugin.projectPathFor('Some/Other/Note.md'), null, 'Projects: a note that is not a listed project -> null');
  // opening: first click makes a tab, a second plain click reuses it, Cmd-click makes another
  eq(await plugin.openProjectPage('Nope', { newTab: false }), false, 'Projects: no page -> false, nothing opened');
  eq(ws.made, 0, 'Projects: no tab made for an unknown project');
  eq(await plugin.openProjectPage('[[Garden Plan]]', { newTab: false }), true, 'Projects: opens the page');
  eq([ws.made, ws.leaves[0].state], [1, { type: 'a4-projects', active: true, state: { page: 'project', project: NOTE } }], 'Projects: the page state names the note');
  ok(ws.active === ws.leaves[0] && ws.revealed === ws.leaves[0], 'Projects: the page tab is shown and active');
  await plugin.openProjectPage(projects[1].path);
  eq([ws.made, ws.leaves[0].state.state.project], [1, projects[1].path], 'Projects: a plain click reuses the Projects tab');
  await plugin.openProjectPage(NOTE, { newTab: true });
  eq([ws.made, ws.leaves[1].mode, ws.leaves[1].state.state.project, ws.leaves[0].state.state.project], [2, 'tab', NOTE, projects[1].path], 'Projects: Cmd-click opens a new tab and leaves the old one');
  ok(ws.active === ws.leaves[1], 'Projects: the new tab is active');
  // the older entry points still work the same
  await plugin.openProject(NOTE);
  eq(ws.made, 2, 'Projects: openProject(path) without options reuses a tab');
  ok(/openProjects\(\{ page: 'overview' \}\)/.test(src.projects), 'Projects: overview command untouched');
}

(async () => {
  await helperCases('Today', part(FILES.today));
  await helperCases('Planner', part(FILES.planner));
  await projectsCases();
  console.log(`\nTOTAL ${n} checks, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('CRASH', e); process.exit(1); });
