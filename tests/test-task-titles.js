#!/usr/bin/env node
'use strict';
/* Task names in the built-in engine (2026-10-05): a task shows its stored
 * `title` when it has one, else its file name. Covers A4 Today 1.2.4,
 * A4 Planner 1.0.3 and A4 Projects 0.1.2 (the shared reader is one verbatim
 * copy in all three):
 *  - the reading rule (TaskNotes 4.12.5 mapFromFrontmatter: string, list,
 *    number/yes-no, blank falls back to the file name)
 *  - every list that shows a name: Today (lanes, overdue), Planner (day,
 *    week, goals, unscheduled), Projects (lists, archived, search, blockers,
 *    Blocks)
 *  - renaming when name and file name differ, and Undo
 *  - names are only ever shown as text (no HTML sink in the three plugins)
 *  - The task notes, read only: tests/fixtures/vault, or the owner's vault with A4_VAULT.
 * `node tests/test-task-titles.js` */
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { built, source } = require('./lib/paths');
const VAULT = require('./lib/paths').vault; // the owner's vault with A4_VAULT, else the frozen copy

class TFile { constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.md$/, ''); this.extension = 'md'; const i = p.lastIndexOf('/'); this.parent = { path: p.slice(0, i) }; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {}, Menu: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const P = require(built('a4-projects'));
const J = P.logic; const TaskEngine = P.TaskEngine;
const T = require(built('a4-today')).logic;
const L = require(built('a4-planner')).logic;

let n = 0; let failed = 0;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

const TASKS = '02 Planner/TaskNotes/Tasks'; const ARCH = '02 Planner/TaskNotes/Archive';
const TP = (name) => `${TASKS}/${name}.md`;
const task = (extra) => ({ status: 'open', priority: 'normal', tags: ['task'], dateModified: '2026-10-01T09:00:00.000-06:00', ...extra });
const URL_T = 'Check out https://www.example.com/';
const URL_F = 'Check out example.com';

/* ---- 1. one copy of the rule in all three plugins --------------------------- */
const srcs = ['a4-projects', 'a4-today', 'a4-planner'].map((p) => fs.readFileSync(source(p), 'utf8'));
function extract(src, name) { const m = new RegExp(`^function ${name}\\(`, 'm').exec(src); return m ? src.slice(m.index, src.indexOf('\n}\n', m.index) + 2) : null; }
for (const name of ['taskTitleOf', 'taskFromFrontmatter', 'openBlockersOf']) ok(extract(srcs[0], name) && srcs.every((s) => extract(s, name) === extract(srcs[0], name)), `shared code identical in all three: ${name}`);
for (const lg of [J, T, L]) ok(lg.taskTitleOf === undefined || typeof lg.taskTitleOf === 'function', 'exported');

/* ---- 2. the reading rule ---------------------------------------------------- */
const tt = J.taskTitleOf;
eq(tt({ title: URL_T }, URL_F), URL_T, 'stored title wins over the file name');
eq(tt({}, URL_F), URL_F, 'no title: file name');
eq(tt(null, 'x'), 'x', 'no frontmatter: file name');
eq(tt({ title: '' }, 'x'), 'x', 'blank title: file name');
eq(tt({ title: '   ' }, 'x'), 'x', 'spaces only: file name');
eq(tt({ title: null }, 'x'), 'x', 'empty YAML value: file name');
eq(tt({ title: { a: 1 } }, 'x'), 'x', 'a map: file name (TaskNotes reads it as blank)');
eq(tt({ title: 2026 }, 'x'), '2026', 'a number is written out (TaskNotes)');
eq(tt({ title: true }, 'x'), 'true', 'yes/no is written out (TaskNotes)');
eq(tt({ title: ['a', 'b'] }, 'x'), 'a, b', 'a list is joined with ", " (TaskNotes)');
eq(tt({ title: [] }, 'x'), 'x', 'an empty list: file name');
eq(tt({ title: '  two\n lines\there ' }, 'x'), 'two lines here', 'line breaks and runs of spaces: one space');
eq(tt({ name: 'other key' }, 'x', 'name'), 'other key', 'TaskNotes field mapping: other key name');
eq(tt({ title: 'Plan' }, 'x', 'name'), 'x', 'mapped key absent: file name, never `title`');
const html = '<img src=x onerror="alert(1)"><b>bold</b> & co';
eq(tt({ title: html }, 'x'), html, 'markup is kept as plain characters (shown as text, never parsed)');

/* ---- 3. Today --------------------------------------------------------------- */
const TODAY = '2026-10-05';
{
  const it = T.taskFromFrontmatter(task({ title: URL_T, due: TODAY }), TP(URL_F), URL_F);
  eq(it.title, URL_T, 'Today: reader shows the stored title');
  eq(it.path, TP(URL_F), 'Today: the path still points at the file');
  const it2 = T.taskFromFrontmatter(task({ due: TODAY }), TP('Buy rice'), 'Buy rice');
  eq(it2.title, 'Buy rice', 'Today: no title -> file name');
  const late = T.taskFromFrontmatter(task({ title: 'Call Ana: van', due: '2026-10-01' }), TP('Call Ana van'), 'Call Ana van');
  const lists = T.buildTaskLists([it, it2, late], TODAY);
  eq(lists.morning.map((x) => x.title).sort(), ['Buy rice', URL_T].sort(), 'Today: morning lane names');
  eq(lists.overdue.map((x) => x.title), ['Call Ana: van'], 'Today: overdue card name');
}

/* ---- 4. Planner ------------------------------------------------------------- */
{
  const mk = (file, fm) => L.plannerItem(task(fm), TP(file), file);
  const a = mk('Zebra file', { title: 'Alpha shown', planned_day: TODAY, planned_half: 'am' });
  const b = mk('Beta', { planned_day: TODAY, planned_half: 'am' });
  const g = mk('Goal file-2', { title: 'Goal shown', weekly_goal: true, planned_day: '2026-10-06' });
  const u1 = mk('Yak-2', { title: 'Aardvark', projects: ['[[Garden]]'] });
  const u2 = mk('Bee', { projects: ['[[Garden]]'] });
  const od = mk('k3j9x', { title: 'Late one', planned_day: '2026-10-01' });
  eq(a.title, 'Alpha shown', 'Planner: reader shows the stored title');
  eq(L.laneOf([a, b], TODAY, 'am').map((x) => x.title).sort(), ['Alpha shown', 'Beta'], 'Planner: day/week lane names');
  eq(L.weeklyGoalsOf([g, a], TODAY, ['done']).map((x) => x.title), ['Goal shown'], 'Planner: goals name');
  const grp = L.groupUnscheduled(L.unscheduledOf([u1, u2], ['done']), L.priorityTable ? L.priorityTable(null) : undefined);
  eq(grp[0].items.map((x) => x.title), ['Aardvark', 'Bee'], 'Planner: unscheduled names, sorted by the shown name (not the file name)');
  eq(L.overdueOf([od, a], TODAY, ['done']).map((x) => x.title), ['Late one'], 'Planner: overdue name');
}

/* ---- 5. Projects (reading, archive, search, sort) --------------------------- */
const cfg = J.engineConfig(undefined);
{
  const r = J.readTask(task({ title: URL_T }), TP(URL_F), URL_F, cfg, false);
  eq(r.title, URL_T, 'Projects: list name is the stored title');
  const arch = J.readTask(task({ title: 'Renew passport', status: 'done', tags: ['task', 'archived'] }), `${ARCH}/Renew passport-2.md`, 'Renew passport-2', cfg, true);
  eq([arch.title, arch.archived], ['Renew passport', true], 'Projects: archived "-2" note shows its title');
  const code = J.readTask(task({ title: 'Pay the water bill', status: 'done' }), `${ARCH}/251004mq3.md`, '251004mq3', cfg, true);
  eq(code.title, 'Pay the water bill', 'Projects: archived code-named note shows its title');
  const plain = J.readTask(task({}), TP('Water plants'), 'Water plants', cfg, false);
  eq(plain.title, 'Water plants', 'Projects: no title -> file name');
  const mapped = J.readTask(task({ name: 'From mapped key', title: 'ignored' }), TP('m'), 'm', { ...cfg, F: { ...cfg.F, title: 'name' } }, false);
  eq(mapped.title, 'From mapped key', "Projects: TaskNotes' field mapping for the title is followed");
  const all = [r, arch, code, plain];
  eq(J.searchTasks(all, 'https', cfg).map((x) => x.title), [URL_T], 'search: finds the stored title text');
  eq(J.searchTasks(all, 'example.com', cfg).map((x) => x.title), [URL_T], 'search: finds it by either spelling');
  eq(J.searchTasks(all, '251004', cfg).map((x) => x.title), ['Pay the water bill'], 'search: the file name still finds it');
  eq(J.searchTasks(all, 'water', cfg).map((x) => x.title), ['Water plants', 'Pay the water bill'], 'search: open first, names shown');
  eq(J.sortOpenTasks([plain, r], TODAY, cfg).map((x) => x.title), [URL_T, 'Water plants'], 'sort A to Z by the shown name');
}

/* ---- 6. in-memory vault for blockers and renames --------------------------- */
function makeVault(notes) {
  const files = new Map(); const fms = new Map();
  const folders = { [TASKS]: new TFolder(TASKS), [ARCH]: new TFolder(ARCH) };
  const add = (p, fm) => { const f = new TFile(p); files.set(p, f); fms.set(p, fm); const dir = p.slice(0, p.lastIndexOf('/')); if (folders[dir]) folders[dir].children.push(f); return f; };
  for (const [p, fm] of Object.entries(notes)) add(p, fm);
  const del = (p) => { const f = files.get(p); files.delete(p); fms.delete(p); for (const d of Object.values(folders)) d.children = d.children.filter((x) => x !== f); };
  const app = {
    plugins: { plugins: {} },
    vault: { getAbstractFileByPath: (p) => folders[p] || files.get(p) || null },
    metadataCache: {
      getFileCache: (f) => (fms.has(f.path) ? { frontmatter: fms.get(f.path), listItems: [] } : null),
      getFirstLinkpathDest: (link) => { const l = String(link).replace(/\.md$/, ''); if (files.has(l + '.md')) return files.get(l + '.md'); for (const f of files.values()) if (f.basename === l) return f; return null; },
      fileToLinktext: (f) => f.basename,
    },
    fileManager: {
      processFrontMatter: async (f, fn) => { fn(fms.get(f.path)); },
      renameFile: async (f, np) => { const fm = fms.get(f.path); del(f.path); add(np, fm); },
    },
  };
  return { app, fms, files };
}
const NOW = new Date(2026, 9, 5, 10, 30, 0);
function engineFor(v, snap) { const e = new TaskEngine({ app: v.app, settings: { tnSnapshot: snap || null, archiveQueue: [] }, archiveQueueOnStatus: async () => false, cancelArchive: async () => {} }); e.now = () => NOW; return e; }

(async () => {
  // Blockers and Blocks show stored titles.
  {
    const v = makeVault({
      [TP(URL_F)]: task({ title: URL_T }),
      [TP('Follow up')]: task({ blockedBy: [{ uid: `[[${URL_F}]]`, reltype: 'FINISHTOSTART' }] }),
    });
    const e = engineFor(v);
    const fu = e.collectTasks(false).find((t) => t.path === TP('Follow up'));
    eq(fu.openBlockers.map((b) => b.title), [URL_T], 'blocked-by chip / menu: stored title');
    eq(J.openBlockersOf(v.app, T.taskFromFrontmatter(v.fms.get(TP('Follow up')), TP('Follow up'), 'Follow up')).map((b) => b.title), [URL_T], 'Today: blocker name is the stored title');
    eq(e.blockerEntries(TP('Follow up')).map((x) => x.title), [URL_T], 'task card "Blocked by" list: stored title');
    eq(e.waitingOn(TP(URL_F)).map((x) => x.title), ['Follow up'], 'task card "Blocks" list');
    eq(e.collectTasks(false).find((t) => t.path === TP(URL_F)).title, URL_T, 'engine collectTasks: stored title');
  }

  // Rename 1: a task with a URL title gets a new plain name -> file renamed, stale title removed.
  {
    const fm0 = { title: URL_T, ...task({}) }; // title first, as TaskNotes writes it
    const v = makeVault({ [TP(URL_F)]: fm0 });
    const before = JSON.stringify(fm0);
    const e = engineFor(v);
    const w = await e.rename(TP(URL_F), 'Try example');
    ok(v.files.has(TP('Try example')) && !v.files.has(TP(URL_F)), 'rename: file takes the new name');
    eq(v.fms.get(TP('Try example')).title, undefined, 'rename: stale stored title removed (file name carries the name)');
    eq(e.collectTasks(false)[0].title, 'Try example', 'rename: shown name is the one typed');
    eq(v.fms.get(TP('Try example')).dateModified, J.tnTimestamp(NOW), 'rename: dateModified stamped when the note changes');
    await w.undo();
    ok(v.files.has(TP(URL_F)) && !v.files.has(TP('Try example')), 'undo rename: old file name back');
    eq(JSON.stringify(v.fms.get(TP(URL_F))), before, 'undo rename: note exactly as before (title back, in its old place)');
    eq(Object.keys(v.fms.get(TP(URL_F)))[0], 'title', 'undo rename: title is the first key again');
  }
  // Rename 2: the new name needs characters a file name can't hold -> title kept in full.
  {
    const v = makeVault({ [TP('Buy rice')]: task({}) });
    const e = engineFor(v);
    const w = await e.rename(TP('Buy rice'), 'Read https://example.com/a: notes');
    const f = [...v.files.keys()][0];
    ok(f !== TP('Buy rice') && !/[:/]/.test(f.slice(TASKS.length + 1)), 'rename to a URL: safe file name', f);
    eq(v.fms.get(f).title, 'Read https://example.com/a: notes', 'rename to a URL: full text kept in title');
    eq(e.collectTasks(false)[0].title, 'Read https://example.com/a: notes', 'rename to a URL: shown in full');
    await w.undo();
    ok(v.files.has(TP('Buy rice')), 'undo: file name back');
    eq(v.fms.get(TP('Buy rice')).title, undefined, 'undo: added title removed again');
  }
  // Rename 3: only the shown name differs from the file name -> no file rename, title fixed.
  {
    const v = makeVault({ [TP(URL_F)]: task({ title: URL_T }) });
    const e = engineFor(v);
    const w = await e.rename(TP(URL_F), URL_F);
    ok(v.files.has(TP(URL_F)), 'same file name: no rename');
    eq(v.fms.get(TP(URL_F)).title, undefined, 'typed the file name: stored title removed');
    eq(e.collectTasks(false)[0].title, URL_F, 'typed the file name: shown');
    await w.undo();
    eq(v.fms.get(TP(URL_F)).title, URL_T, 'undo: stored title back');
    const w2 = await e.rename(TP(URL_F), URL_T);
    eq(w2, null, 'typing the shown name again: nothing written');
  }
  // Rename 4: a "-2" note renamed to a name in use -> refused, nothing changed.
  {
    const v = makeVault({ [TP('Renew passport')]: task({}), [TP('Renew passport-2')]: task({ title: 'Renew passport' }) });
    const e = engineFor(v);
    const snap = JSON.stringify(v.fms.get(TP('Renew passport-2')));
    let threw = null; try { await e.rename(TP('Renew passport-2'), 'Renew passport'); } catch (err) { threw = err.message; }
    // The file name "Renew passport" is taken, but the typed name equals the shown name: no-op, no error.
    ok(threw === null, 'same shown name on a "-2" note: no error', threw);
    eq(JSON.stringify(v.fms.get(TP('Renew passport-2'))), snap, '"-2" note untouched');
    threw = null; let w0; try { w0 = await e.rename(TP('Renew passport-2'), ' Renew  passport '); } catch (err) { threw = err.message; }
    ok(threw === null && w0 === null, 'extra spaces only: no-op');
    const w = await e.rename(TP('Renew passport-2'), 'Renew passport (Ana)');
    ok(v.files.has(TP('Renew passport (Ana)')) && v.fms.get(TP('Renew passport (Ana)')).title === undefined, '"-2" note renamed to a free name: file + title in step');
    await w.undo();
    eq(v.fms.get(TP('Renew passport-2')).title, 'Renew passport', 'undo: "-2" title back');
    threw = null; try { await e.rename(TP('Renew passport (Ana)'), 'x'); } catch (err) { threw = err.message; } ok(threw && /gone/.test(threw), 'renaming a missing note: clear error');
    const fresh = makeVault({ [TP('A')]: task({}), [TP('B')]: task({}) });
    threw = null; try { await engineFor(fresh).rename(TP('B'), 'A'); } catch (err) { threw = err.message; }
    ok(threw && /already has that name/.test(threw), 'rename onto another task: refused');
    eq(fresh.fms.get(TP('B')).title, undefined, 'refused: nothing written');
  }
  // Rename 5: TaskNotes set to zettel file names (title not in the file name) -> only title changes.
  {
    const v = makeVault({ [TP('251004abc')]: task({ title: 'Old name' }) });
    const e = engineFor(v, { storeTitleInFilename: false });
    ok(e.cfg().storeTitleInFilename === false, 'snapshot honoured');
    const w = await e.rename(TP('251004abc'), 'New: name');
    ok(v.files.has(TP('251004abc')), 'zettel names: file not renamed');
    eq(v.fms.get(TP('251004abc')).title, 'New: name', 'zettel names: title updated');
    await w.undo(); eq(v.fms.get(TP('251004abc')).title, 'Old name', 'undo');
  }

  /* ---- 7. shown as text only ------------------------------------------------ */
  for (const [i, p] of ['a4-projects', 'a4-today', 'a4-planner'].entries()) {
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|createContextualFragment|document\.write/.test(srcs[i]), `${p}: no HTML sink anywhere`);
  }
  ok(/const h = \(parent, tag, cls, text\) => \{[^\n]*e\.textContent = text/.test(srcs[2]), 'Planner h(): textContent');
  ok(/const el = \(parent, tag, cls, text\) => \{[^\n]*e\.textContent = text/.test(srcs[0]), 'Projects el(): textContent');
  ok(/const tl = main\.createDiv\(\{ cls: 'a4t-task-title' \}\);[\s\S]{0,1200}?tl\.appendText\(t\.title\);/.test(srcs[1]), 'Today task row: name added as text (after the time)');
  ok(/const tl = h\(main, 'div', 'a4pl-task-title'\);[\s\S]{0,1200}?tl\.appendText\(it\.title\);/.test(srcs[2]), 'Planner task row: name added as text (after the time)');
  ok(/createDiv\(\{ cls: 'a4pl-ghost', text: [^}]*d\.item\.title \}\)/.test(srcs[2]), 'Planner drag preview: text option');

  /* ---- 8. The task notes, read only (the frozen copy unless A4_VAULT) ------- */
  const real = [];
  for (const [dir, inArch] of VAULT ? [[TASKS, false], [ARCH, true]] : []) {
    const abs = path.join(VAULT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (!f.endsWith('.md')) continue;
      const txt = fs.readFileSync(path.join(abs, f), 'utf8');
      const m = /^---\n([\s\S]*?)\n---/.exec(txt);
      if (!m) continue;
      const tl = /^title:[ \t]*(.*)$/m.exec(m[1]);
      const tags = /(^|\n)tags:([\s\S]*?)(\n\S|$)/.exec(m[1]);
      if (!tags || !/\btask\b/.test(tags[2])) continue;
      let t = tl ? tl[1].trim() : '';
      if (/^(['"]).*\1$/.test(t)) t = t.slice(1, -1).replace(/''/g, "'");
      real.push({ dir, inArch, base: f.slice(0, -3), title: t });
    }
  }
  if (real.length) {
    const diff = real.filter((r) => r.title && r.title !== r.base);
    let mism = 0;
    for (const r of diff) { const it = J.readTask({ tags: ['task'], status: 'open', title: r.title }, `${r.dir}/${r.base}.md`, r.base, cfg, r.inArch); if (!it || it.title !== r.title.replace(/\s+/g, ' ').trim()) mism++; }
    ok(mism === 0, `real notes: all ${diff.length} with a different stored title show it`);
    ok(diff.length > 0, 'real notes: some stored titles differ from their file names');
    console.log(`(real notes read: ${real.length}; stored title differs from file name: ${diff.length})`);
  }

  console.log(`RESULT ${n} ${failed}`);
  console.log(failed ? `${failed} of ${n} FAILED` : `TOTAL ${n} checks, 0 failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.log('FAIL async', err.stack); process.exit(1); });
