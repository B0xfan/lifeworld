'use strict';
/* Task dependencies ("Blocked by" / "Blocks", Projects mockup round 4, 2026-10-04).
 * Logic checks for the shared readers (a4-projects, a4-today, a4-planner) and
 * the A4 Projects engine's writes, on an in-memory vault (no Obsidian):
 *  - TaskNotes' blockedBy shapes, what counts as an open blocker
 *  - writes in TaskNotes' exact format, no duplicates, Undo restores
 *  - circles refused (self, 2-step, long chain), loops already in the files end
 *  - deleted / renamed blockers, repeating blockers, "Blocks" computed, freedBy
 *  - blocked tasks sort lower and are never a project's next step
 * `node tests/test-dependencies.js` (A4_VAULT overrides the vault root). */
const path = require('path');
const Module = require('module');

const { built, source } = require('./lib/paths');
const VAULT = process.env.A4_VAULT || null; // real notes only when set

class TFile { constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.md$/, ''); this.extension = 'md'; const i = p.lastIndexOf('/'); this.parent = { path: p.slice(0, i) }; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class {}, setIcon() {}, Platform: {}, Component: class {}, Menu: class {} };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const P = require(built('a4-projects'));
const L = P.logic; const TaskEngine = P.TaskEngine;
const Today = require(built('a4-today'));
const Planner = require(built('a4-planner'));

let n = 0; let failed = 0;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- in-memory vault ------------------------------------------------------- */
const TASKS = '02 Planner/TaskNotes/Tasks'; const ARCH = '02 Planner/TaskNotes/Archive';
function makeVault(notes) {
  const files = new Map(); const fms = new Map();
  const folders = { [TASKS]: new TFolder(TASKS), [ARCH]: new TFolder(ARCH) };
  const add = (p, fm) => { const f = new TFile(p); files.set(p, f); fms.set(p, fm); const dir = p.slice(0, p.lastIndexOf('/')); if (folders[dir]) folders[dir].children.push(f); return f; };
  for (const [p, fm] of Object.entries(notes)) add(p, fm);
  const app = {
    plugins: { plugins: {} },
    vault: {
      getAbstractFileByPath: (p) => folders[p] || files.get(p) || null,
    },
    metadataCache: {
      getFileCache: (f) => (fms.has(f.path) ? { frontmatter: fms.get(f.path), listItems: [] } : null),
      getFirstLinkpathDest: (link, src) => {
        const l = String(link).replace(/\.md$/, '');
        if (files.has(l + '.md')) return files.get(l + '.md');
        for (const f of files.values()) if (f.basename === l) return f;
        return null;
      },
      fileToLinktext: (f) => f.basename,
    },
    fileManager: { processFrontMatter: async (f, fn) => { const fm = fms.get(f.path); fn(fm); } },
  };
  const del = (p) => { const f = files.get(p); files.delete(p); fms.delete(p); for (const d of Object.values(folders)) d.children = d.children.filter((x) => x !== f); };
  const rename = (p, np) => { const fm = fms.get(p); del(p); add(np, fm); };
  return { app, fms, del, rename, add };
}
const task = (status, extra) => ({ status, priority: 'normal', tags: ['task'], dateModified: '2026-10-01T09:00:00.000-06:00', ...extra });
const T = (name) => `${TASKS}/${name}.md`;
function engineFor(v) { const e = new TaskEngine({ app: v.app, settings: { tnSnapshot: null, archiveQueue: [] }, archiveQueueOnStatus: async () => false, cancelArchive: async () => {} }); e.now = () => new Date(2026, 9, 4, 10, 30, 0); return e; }
const DONE = ['done', 'closed'];

/* ---- 1. shared code is the same in all three plugins ------------------------ */
const fs = require('fs');
function extract(src, name) { const m = new RegExp(`^function ${name}\\(`, 'm').exec(src); return m ? src.slice(m.index, src.indexOf('\n}\n', m.index) + 2) : null; }
const srcs = ['a4-projects', 'a4-today', 'a4-planner'].map((p) => fs.readFileSync(source(p), 'utf8'));
for (const name of ['blockerLinks', 'blockerHolds', 'openBlockersOf', 'taskTitleOf', 'taskFromFrontmatter']) ok(extract(srcs[0], name) && extract(srcs[0], name) === extract(srcs[1], name) && extract(srcs[0], name) === extract(srcs[2], name), `shared code identical in all three: ${name}`);
ok(typeof Today === 'function' && typeof Planner === 'function', 'Today and Planner load');

/* ---- 2. reading TaskNotes' blockedBy --------------------------------------- */
eq(L.blockerLinks({ blockedBy: [{ uid: '[[Waiting on Kim]]', reltype: 'FINISHTOSTART' }] }), ['Waiting on Kim'], 'read: TaskNotes mapping');
eq(L.blockerLinks({ blockedBy: ['[[A]]', 'B', { uid: '[[C|shown]]' }, { uid: '[[D#Part]]', reltype: 'STARTTOSTART', gap: 'P1D' }] }), ['A', 'B', 'C', 'D'], 'read: string, bare, alias, heading, other reltype');
eq(L.blockerLinks({ blockedBy: '[[Solo]]' }), ['Solo'], 'read: a single value (not a list)');
eq(L.blockerLinks({ blockedBy: [{ uid: '[[A]]' }, '[[A]]'] }), ['A'], 'read: duplicates collapse');
eq(L.blockerLinks({ blockedBy: [null, {}, { uid: 5 }, '', '[[ ]]'] }), [], 'read: junk entries ignored');
eq(L.blockerLinks({}), [], 'read: no field');
eq(L.blockerLinks(null), [], 'read: no frontmatter');
eq(L.taskFromFrontmatter(task('open', { blockedBy: [{ uid: '[[X]]', reltype: 'FINISHTOSTART' }] }), T('Y'), 'Y').blockedBy, ['X'], 'taskFromFrontmatter carries blockedBy');

/* ---- 3. what still blocks ---------------------------------------------------- */
ok(L.blockerHolds(task('open'), T('a'), DONE), 'holds: open');
ok(L.blockerHolds(task('in-progress'), T('a'), DONE), 'holds: in progress');
ok(L.blockerHolds(task('blocked'), T('a'), DONE), 'holds: its own Waiting status');
ok(L.blockerHolds(task(''), T('a'), DONE), 'holds: empty status = open');
ok(!L.blockerHolds(task('done'), T('a'), DONE), 'clears: done');
ok(!L.blockerHolds(task('closed'), T('a'), DONE), 'clears: closed');
ok(!L.blockerHolds(task('open', { tags: ['task', 'archived'] }), T('a'), DONE), 'clears: archived tag');
ok(!L.blockerHolds(task('open'), `${ARCH}/a.md`, DONE), 'clears: in the archive folder');
ok(!L.blockerHolds(null, T('a'), DONE), 'clears: no note');
ok(L.blockerHolds(task('open', { recurrence: 'DTSTART:20261001;FREQ=DAILY', complete_instances: ['2026-10-04'] }), T('a'), DONE), "repeating blocker: holds while its status is open (TaskNotes' rule), even with today ticked");
ok(!L.blockerHolds(task('done', { recurrence: 'DTSTART:20261001;FREQ=DAILY' }), T('a'), DONE), 'repeating blocker: clears once its status is done');

/* ---- 4. engine: open blockers, Blocks, freedBy ----------------------------- */
{
  const v = makeVault({
    [T('Fix the drip line')]: task('open'),
    [T('Clear the vines')]: task('done'),
    [T('Plan winter crops')]: task('open', { blockedBy: [{ uid: '[[Fix the drip line]]', reltype: 'FINISHTOSTART' }, { uid: '[[Clear the vines]]', reltype: 'FINISHTOSTART' }] }),
    [T('Build a trellis')]: task('open', { blockedBy: [{ uid: '[[Plan winter crops]]', reltype: 'FINISHTOSTART' }] }),
    [T('Water seedlings')]: task('open', { recurrence: 'DTSTART:20261001;FREQ=DAILY' }),
    [T('Mulch')]: task('open', { blockedBy: ['[[Water seedlings]]', '[[Gone task]]', '[[Mulch]]'] }),
  });
  const e = engineFor(v);
  const tasks = e.collectTasks(false);
  const by = (n) => tasks.find((t) => t.title === n);
  eq(by('Plan winter crops').openBlockers.map((b) => b.title), ['Fix the drip line'], 'open blockers: done one does not count');
  eq(by('Build a trellis').openBlockers.map((b) => b.title), ['Plan winter crops'], 'open blockers: chain step');
  eq(by('Mulch').openBlockers.map((b) => b.title), ['Water seedlings'], 'open blockers: deleted link and self link block nothing; repeating open blocker does');
  eq(by('Fix the drip line').openBlockers, [], 'no blockedBy: not blocked');
  eq(e.blockerEntries(T('Mulch')).map((x) => [x.title, x.missing, x.holds]), [['Water seedlings', false, true], ['Gone task', true, false], ['Mulch', false, true]], 'card list: missing note flagged');
  eq(e.waitingOn(T('Plan winter crops')).map((x) => x.title), ['Build a trellis'], 'Blocks: computed from the other task');
  eq(e.waitingOn(T('Fix the drip line')).map((x) => x.title), ['Plan winter crops'], 'Blocks: computed (2)');
  eq(e.freedBy(T('Fix the drip line')).map((x) => x.title), ['Plan winter crops'], 'freedBy: sole open blocker');
  eq(e.freedBy(T('Plan winter crops')).map((x) => x.title), ['Build a trellis'], 'freedBy: chain');
  // Sorting and Next
  const cfg = e.cfg();
  const sorted = L.sortOpenTasks([by('Plan winter crops'), by('Fix the drip line'), by('Build a trellis')], '2026-10-04', cfg).map((t) => t.title);
  eq(sorted, ['Fix the drip line', 'Build a trellis', 'Plan winter crops'], 'sort: blocked below the ones you can do now');
  for (const t of tasks) { t.projectKey = 'Garden'; }
  const st = L.projectStats({ key: 'Garden' }, tasks.filter((t) => ['Plan winter crops', 'Build a trellis'].includes(t.title)), '2026-10-04', cfg);
  eq(st.next, null, 'next step: never a blocked task');
  eq(st.open, 2, 'blocked tasks still count as open (never hidden)');
  // Ticking the blocker clears the marker; Undo brings it back
  (async () => {
    const w = await e.complete(T('Fix the drip line'));
    eq(e.collectTasks(false).find((t) => t.title === 'Plan winter crops').openBlockers, [], 'tick blocker: marker clears');
    await w.undo();
    eq(e.collectTasks(false).find((t) => t.title === 'Plan winter crops').openBlockers.map((b) => b.title), ['Fix the drip line'], 'undo tick: marker back');
    // blocker deleted: stops blocking
    v.del(T('Fix the drip line'));
    eq(e.collectTasks(false).find((t) => t.title === 'Plan winter crops').openBlockers, [], 'deleted blocker: blocks nothing');
    ok(e.blockerEntries(T('Plan winter crops'))[0].missing, 'deleted blocker: shown as gone on the card');
    // renamed blocker without the link updated: same as deleted (Obsidian updates the link: see sandbox run)
    v.rename(T('Build a trellis'), T('Build a bean trellis'));
    v.fms.get(T('Build a bean trellis')).status = 'open';
    eq(e.waitingOn(T('Plan winter crops')).map((x) => x.title), ['Build a bean trellis'], 'renamed waiting task: Blocks still finds it');
    v.rename(T('Clear the vines'), T('Clear old vines'));
    ok(e.blockerEntries(T('Plan winter crops')).find((x) => x.title === 'Clear the vines').missing, 'renamed blocker, link not updated: shown as gone');
    v.fms.get(T('Plan winter crops')).blockedBy[1].uid = '[[Clear old vines]]';
    ok(!e.blockerEntries(T('Plan winter crops')).find((x) => x.title === 'Clear old vines').missing, 'renamed blocker, link updated: found again');
  })().then(next1).catch((err) => { ok(false, 'async block 1', err.stack); next1(); });
}

/* ---- 5. writes, circles, undo ---------------------------------------------- */
function next1() {
  (async () => {
    const v = makeVault({
      [T('A')]: task('open'),
      [T('B')]: task('open', { blockedBy: [{ uid: '[[A]]', reltype: 'FINISHTOSTART' }] }),
      [T('C')]: task('open', { blockedBy: ['[[B]]', { uid: '[[Old]]', reltype: 'FINISHTOSTART', gap: 'P2D' }] }),
      [T('D')]: task('open'),
      [T('L1')]: task('open', { blockedBy: ['[[L2]]'] }),
      [T('L2')]: task('open', { blockedBy: ['[[L1]]'] }),
    });
    const e = engineFor(v);
    ok(e.wouldLoop(T('A'), T('A')), 'circle: self');
    ok(e.wouldLoop(T('A'), T('B')), 'circle: A waits on B while B waits on A');
    ok(e.wouldLoop(T('A'), T('C')), 'circle: long chain A <- B <- C');
    ok(!e.wouldLoop(T('D'), T('C')), 'no circle: D waits on C');
    ok(!e.wouldLoop(T('C'), T('D')), 'no circle: C waits on D');
    ok(e.wouldLoop(T('L1'), T('L2')), 'loop already in the files: detected');
    ok(!e.wouldLoop(T('D'), T('L1')), 'loop already in the files: the walk ends');
    eq(e.openBlockers({ path: T('L1'), blockedBy: ['L2'] }).map((b) => b.title), ['L2'], 'loop already in the files: reading still works');
    let threw = null; try { await e.addBlocker(T('A'), T('C')); } catch (err) { threw = err.message; }
    ok(threw && /circle/.test(threw), 'addBlocker refuses a circle', threw);
    eq(v.fms.get(T('A')).blockedBy, undefined, 'refused: nothing written');
    threw = null; try { await e.addBlocker(T('A'), T('A')); } catch (err) { threw = err.message; } ok(!!threw, 'addBlocker refuses self');

    const before = JSON.stringify(v.fms.get(T('D')));
    const w = await e.addBlocker(T('D'), T('C'));
    eq(v.fms.get(T('D')).blockedBy, [{ uid: '[[C]]', reltype: 'FINISHTOSTART' }], "add: TaskNotes' exact entry");
    eq(v.fms.get(T('D')).dateModified, L.tnTimestamp(new Date(2026, 9, 4, 10, 30, 0)), 'add: dateModified stamped like TaskNotes');
    const w2 = await e.addBlocker(T('D'), T('C'));
    eq(v.fms.get(T('D')).blockedBy.length, 1, 'add twice: no duplicate');
    await w2.undo(); await w.undo();
    eq(JSON.stringify(v.fms.get(T('D'))), before, 'undo add: note exactly as before (field gone)');

    const c0 = JSON.stringify(v.fms.get(T('C')));
    const w3 = await e.addBlocker(T('C'), T('D'));
    eq(v.fms.get(T('C')).blockedBy, ['[[B]]', { uid: '[[Old]]', reltype: 'FINISHTOSTART', gap: 'P2D' }, { uid: '[[D]]', reltype: 'FINISHTOSTART' }], 'add: existing entries kept as written (string, gap)');
    await w3.undo(); eq(JSON.stringify(v.fms.get(T('C'))), c0, 'undo add: existing list restored');

    const w4 = await e.removeBlocker(T('C'), T('B'));
    eq(v.fms.get(T('C')).blockedBy, [{ uid: '[[Old]]', reltype: 'FINISHTOSTART', gap: 'P2D' }], 'remove: only that blocker');
    const w5 = await e.removeBlocker(T('C'), null, 'Old');
    eq(v.fms.get(T('C')).blockedBy, undefined, 'remove a gone note by its link; empty list -> field removed (TaskNotes)');
    await w5.undo(); await w4.undo();
    eq(JSON.stringify(v.fms.get(T('C'))), c0, 'undo removes: list restored');

    // "Blocks" side: adding from the blocker writes the waiting task
    const w6 = await e.addBlocker(T('D'), T('A'));
    eq(e.waitingOn(T('A')).map((x) => x.title), ['B', 'D'], 'Blocks: the new one appears, stored only on D');
    eq(v.fms.get(T('A')).blockedBy, undefined, 'Blocks: nothing stored on the blocker');
    await w6.undo();
    console.log(`RESULT ${n} ${failed}`);
    console.log(failed ? `${failed} of ${n} FAILED` : `TOTAL ${n} checks, 0 failed`);
    process.exit(failed ? 1 : 0);
  })().catch((err) => { console.log('FAIL async block 2', err.stack); process.exit(1); });
}
