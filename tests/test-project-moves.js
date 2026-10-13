#!/usr/bin/env node
/* Self-check for the projects board actions (section 4).
 * `node tests/test-project-moves.js` from the repo root. Each move, Cold Storage,
 * Restore, Promote and Delete: the fields it writes, that nothing else changes,
 * and that Cancel changes nothing. Runs against a fake vault, no Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
class TFile { constructor(p, fm) { this.path = p; this.extension = path.extname(p).slice(1); this.basename = path.basename(p, `.${this.extension}`); this.fm = fm; } }
class TFolder { constructor(p, children) { this.path = p; this.children = children; } }
const notices = [];
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, Platform: {}, Component: class {},
  getFrontMatterInfo: (t) => { const m = /^---\n([\s\S]*?)\n---\n/.exec(t); return { exists: !!m, frontmatter: m ? m[1] : '' }; }, parseYaml: JSON.parse };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const Plugin = require(path.join(__dirname, '..', 'main.js'));
const L = Plugin.logic;

const TODAY = '2026-10-13';
const BASE = { type: 'project', sphere: 'work', goal: '[[G]]', why: 'old why', client: '[[C]]', tags: ['x'] };
const clone = (o) => JSON.parse(JSON.stringify(o));
// Everything but the named keys must be byte-for-byte the same.
const sameExcept = (a, b, keys, msg) => {
  const strip = (o) => { const c = clone(o); for (const k of keys) delete c[k]; return c; };
  assert.deepStrictEqual(strip(b), strip(a), msg);
};

/* ---- pure logic ---------------------------------------------------------- */
const FROM = ['backlog', 'active', 'waiting', 'paused', 'blocked', 'done', 'cold-storage', 'failed', ''];
let n = 0;
for (const from of FROM) for (const to of L.BOARD_COLUMNS) {
  const before = { ...BASE, status: from, ...(from === 'done' ? { end_date: '2026-01-02' } : {}), ...(from === 'cold-storage' ? { stored_from: 'paused' } : {}) };
  const fm = L.applyProjectStatus(clone(before), to, TODAY);
  assert.strictEqual(fm.status, to);
  if (to === 'done') assert.strictEqual(fm.end_date, before.end_date || TODAY, 'Done keeps or sets end_date');
  else assert.ok(!('end_date' in fm), `${from} -> ${to}: end_date removed`);
  assert.ok(!('stored_from' in fm), 'leaving cold-storage clears stored_from');
  sameExcept(before, fm, ['status', 'end_date', 'stored_from'], `${from} -> ${to}: only status (and end_date / stored_from) change`);
  n++;
}

for (const from of L.BOARD_COLUMNS) {
  const before = { ...BASE, status: from[0].toUpperCase() + from.slice(1), ...(from === 'done' ? { end_date: '2026-01-02' } : {}) };
  const fm = L.applyColdStorage(clone(before), '  no time  ', TODAY);
  assert.deepStrictEqual([fm.status, fm.stored_from, fm.why], ['cold-storage', from, 'no time'], `cold storage from ${from}`);
  if (from === 'done') assert.strictEqual(fm.end_date, '2026-01-02', 'a stored Done project keeps its finish date');
  else assert.ok(!('end_date' in fm), 'cold storage is not closed');
  sameExcept(before, fm, ['status', 'stored_from', 'why', 'end_date'], 'cold storage changes nothing else');
  assert.strictEqual(L.applyColdStorage(clone(before), '   ', TODAY).why, 'old why', 'empty answer keeps the why');
  const back = L.applyRestore(clone(fm), TODAY);
  assert.deepStrictEqual(back, { status: from, fellBack: false });
  const r = L.applyRestore(fm, TODAY) && fm;
  assert.strictEqual(r.status, from, `restore to ${from}`);
  assert.ok(!('stored_from' in r), 'restore clears stored_from');
  assert.strictEqual(r.why, 'no time', 'why travels with the project');
  if (from === 'done') assert.strictEqual(r.end_date, '2026-01-02', 'restore to Done brings back the original end_date');
  else assert.ok(!('end_date' in r));
  n++;
}
for (const bad of [undefined, '', 'idea', 'failed', 'nonsense']) {
  const fm = { ...BASE, status: 'cold-storage', ...(bad === undefined ? {} : { stored_from: bad }) };
  assert.deepStrictEqual(L.applyRestore(fm, TODAY), { status: 'backlog', fellBack: true }, `stored_from ${bad}: Backlog`);
  assert.ok(fm.status === 'backlog' && !('stored_from' in fm));
}

{
  const idea = { type: 'project', sphere: 'personal', status: 'idea', why: 'w' };
  assert.strictEqual(L.hasGoalLink(idea), false);
  const p = L.applyPromote(clone(idea), '[[My goal]]', TODAY);
  assert.deepStrictEqual(p, { ...idea, status: 'backlog', goal: '[[My goal]]' }, 'promote: backlog + goal, nothing else');
  const withGoal = { ...idea, goal: '[[Old]]' };
  assert.strictEqual(L.hasGoalLink(withGoal), true);
  assert.deepStrictEqual(L.applyPromote(clone(withGoal), null, TODAY), { ...withGoal, status: 'backlog' }, 'promote keeps an existing goal');
  assert.strictEqual(L.hasGoalLink({ goal: 'plain text' }), false, 'a goal without a link does not count');
}

{ // Undo puts back exactly what was there, including missing keys.
  const before = { ...BASE, status: 'active' };
  const fm = clone(before);
  const snap = L.fieldsOf(fm);
  L.applyColdStorage(fm, 'x', TODAY);
  assert.deepStrictEqual(L.undoFields(fm, snap, L.fieldsOf(fm)), [], 'undo keeps nothing');
  assert.deepStrictEqual(fm, before, 'undo');
  // A hand edit after the move survives Undo and is reported.
  const fm2 = clone(before);
  L.applyColdStorage(fm2, 'x', TODAY);
  const after = L.fieldsOf(fm2);
  fm2.why = 'typed later'; fm2.goal = '[[Other]]';
  assert.deepStrictEqual(L.undoFields(fm2, snap, after), ['why'], 'goal was not moved, so only why is reported');
  assert.deepStrictEqual([fm2.status, fm2.stored_from, fm2.why, fm2.goal], ['active', undefined, 'typed later', '[[Other]]'], 'later edits kept, the rest undone');
}
{ // Two Cold Storage writes on one note: the first column is kept.
  const fm = { ...BASE, status: 'done', end_date: '2026-01-02' };
  L.applyColdStorage(fm, 'first', TODAY);
  L.applyColdStorage(fm, 'second', TODAY);
  assert.deepStrictEqual([fm.status, fm.stored_from, fm.why, fm.end_date], ['cold-storage', 'done', 'second', '2026-01-02'], 'double store keeps stored_from and end_date');
  assert.deepStrictEqual(L.applyRestore(fm, TODAY), { status: 'done', fellBack: false });
  assert.strictEqual(fm.end_date, '2026-01-02');
}

{ // Activity: newest first, capped, and loaded data is cleaned.
  let a = [];
  for (let i = 0; i < 205; i++) a = L.addActivity(a, `e${i}`, i);
  assert.strictEqual(a.length, L.ACTIVITY_CAP, 'capped at 200');
  assert.strictEqual(L.ACTIVITY_CAP, 200);
  assert.deepStrictEqual([a[0], a[199]], [{ at: 204, text: 'e204' }, { at: 5, text: 'e5' }], 'newest first, oldest dropped');
  assert.deepStrictEqual(L.addActivity(undefined, 'x', 1), [{ at: 1, text: 'x' }], 'no list yet');
  const loaded = L.normalizeSettings({ activity: [...a, { at: 1, text: 'over' }, null, { at: 'x', text: 'bad' }, { at: 2 }] });
  assert.strictEqual(loaded.activity.length, 200, 'loaded list is capped too');
  assert.deepStrictEqual(L.normalizeSettings({}).activity, [], 'old data: empty history');
  assert.deepStrictEqual(L.normalizeSettings({ activity: [null, { at: 3, text: 't' }] }).activity, [{ at: 3, text: 't' }], 'bad entries dropped');
}

/* ---- plugin actions on a fake vault ------------------------------------- */
const PD = '04 Inner World/My Life/Projects';
function world(notes, answers) {
  const files = Object.entries(notes).map(([name, fm]) => new TFile(`${name.includes('/') ? name : `${PD}/${name}`}${/\.\w+$/.test(name) ? '' : '.md'}`, clone(fm)));
  const goals = new TFolder('04 Inner World/My Life/Goals', files.filter((f) => f.path.startsWith('04 Inner World/My Life/Goals/')));
  const trashed = []; const writes = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p) => (p === goals.path ? goals : files.find((f) => f.path === p) || null),
      read: async (f) => { if (!files.includes(f)) throw new Error('gone'); return f.fm ? `---\n${JSON.stringify(f.fm)}\n---\nbody` : 'body'; },
      trash: async (f, system) => { trashed.push([f.path, system]); files.splice(files.indexOf(f), 1); },
      delete: () => { throw new Error('never a permanent delete'); },
    },
    fileManager: { processFrontMatter: async (f, cb) => { writes.push(f.path); const c = clone(f.fm); cb(c); f.fm = c; }, trashFile: () => { throw new Error('use vault.trash'); } },
  };
  const toasts = []; const saves = [];
  const p = Object.create(Plugin.prototype);
  Object.assign(p, {
    app, settings: { activity: [] }, saveData: async (d) => { saves.push(clone(d)); },
    toast: { show: (m, u) => toasts.push([m, u]) },
    engine: { file: (q) => files.find((f) => f.path === q) || null, fm: (f) => f.fm, today: () => TODAY },
    ask: async () => answers.ask, confirmAction: async () => answers.confirm, pickGoal: async () => answers.goal,
  });
  return { p, saves, log: () => p.settings.activity.map((e) => e.text), files, fmOf: (name) => (files.find((f) => f.basename === name) || {}).fm, trashed, writes, toasts };
}
const P = (name) => `${PD}/${name}.md`;

(async () => {
  const notes = {
    Act: { ...BASE, status: 'active' }, Done: { ...BASE, status: 'done', end_date: '2026-01-02' }, Cold: { ...BASE, status: 'cold-storage', stored_from: 'waiting' },
    Idea: { type: 'project', sphere: 'work', status: 'idea', why: 'w' }, IdeaG: { type: 'project', sphere: 'work', status: 'idea', goal: '[[Old]]' },
    'Other/Act': { ...BASE, status: 'active' }, NotProject: { type: 'note', status: 'cold-storage' }, 'Scan.pdf': { type: 'project', status: 'cold-storage' },
  };

  // Cancel / refuse: nothing written
  let w = world(notes, { ask: null, confirm: false, goal: null });
  notices.length = 0;
  assert.strictEqual(await w.p.coldStoreProject(P('Act')), false, 'cold storage cancelled');
  assert.strictEqual(await w.p.deleteProjectPermanently(P('Cold')), false, 'delete cancelled');
  assert.strictEqual(await w.p.promoteIdea(P('Idea')), false, 'promote without goal cancelled');
  assert.deepStrictEqual(notices, [], 'a cancel shows no notice');
  assert.strictEqual(await w.p.moveProject(P('Act'), 'active'), false, 'same column: no write');
  assert.deepStrictEqual(notices, [], 'a card dropped back in its own column shows no notice');
  assert.strictEqual(await w.p.moveProject(P('Act'), 'cold-storage'), false, 'move only to board columns');
  assert.strictEqual(await w.p.moveProject(P('Idea'), 'active'), false, 'ideas go through Promote');
  assert.strictEqual(await w.p.moveProject(P('Cold'), 'active'), false, 'cold storage goes through Restore');
  assert.strictEqual(await w.p.moveProject('Other/Act.md', 'done'), false, 'outside the Projects folder');
  assert.strictEqual(await w.p.restoreProject(P('Act')), false, 'restore only from cold storage');
  w.p.ask = async () => 'x';
  assert.strictEqual(await w.p.coldStoreProject(P('Idea')), false, 'cold storage only from a board column');
  for (const n2 of ['NotProject', 'Scan.pdf']) {
    assert.strictEqual(await w.p.moveProject(`${PD}/${n2}${n2.includes('.') ? '' : '.md'}`, 'done'), false, `${n2}: no move`);
    assert.strictEqual(await w.p.coldStoreProject(`${PD}/${n2}${n2.includes('.') ? '' : '.md'}`), false, `${n2}: no cold storage`);
  }
  assert.strictEqual(await w.p.writeProject(w.files.find((f) => f.basename === 'NotProject'), (fm) => { fm.status = 'done'; }), null, 'the List write refuses a non-project too');
  assert.ok(!w.writes.includes(`${PD}/Scan.pdf`), 'a non-note is never written');
  assert.strictEqual(notices.length, 10, 'every refusal shows a notice (not a move to a non-column, a caller error; not a same-column move)');
  assert.ok(notices.every((m) => /^Could not do that to "/.test(m)), 'the refusal notice');
  // Guards now decide inside the write, so a refusal may open it but changes nothing.
  for (const f of w.files) assert.deepStrictEqual(f.fm, notes[Object.keys(notes).find((k) => f.path === `${PD}/${k}` || f.path.endsWith(`${k}.md`))], `${f.path} unchanged`);
  assert.deepStrictEqual(w.trashed, [], 'nothing trashed');
  assert.deepStrictEqual(w.log(), [], 'cancelled or refused: nothing logged');

  // Delete: only from cold storage, only that note, to the vault .trash
  w = world(notes, { confirm: true });
  for (const n2 of ['Act', 'Done', 'Idea', 'NotProject']) assert.strictEqual(await w.p.deleteProjectPermanently(P(n2)), false, `no delete for ${n2}`);
  assert.strictEqual(await w.p.deleteProjectPermanently(`${PD}/Scan.pdf`), false, 'no delete for a file that is not a note');
  assert.strictEqual(await w.p.deleteProjectPermanently(P('Cold')), true);
  assert.deepStrictEqual(w.trashed, [[P('Cold'), false]], "only the note, to Obsidian's trash");
  assert.deepStrictEqual(w.writes, [], 'delete writes no note');
  assert.strictEqual(w.files.length, Object.keys(notes).length - 1);
  assert.deepStrictEqual(w.log(), ['You deleted Cold.'], 'delete logged once; refused deletes not');

  // The happy paths, with Undo
  w = world(notes, { ask: 'Parked till Jan', goal: { basename: 'New goal' } });
  assert.strictEqual(await w.p.moveProject(P('Act'), 'waiting'), true);
  assert.strictEqual(w.fmOf('Act').status, 'waiting');
  assert.strictEqual(await w.p.coldStoreProject(P('Done')), true);
  assert.deepStrictEqual([w.fmOf('Done').status, w.fmOf('Done').stored_from, w.fmOf('Done').why, w.fmOf('Done').end_date], ['cold-storage', 'done', 'Parked till Jan', '2026-01-02']);
  assert.strictEqual(await w.p.restoreProject(P('Cold')), true);
  assert.deepStrictEqual([w.fmOf('Cold').status, w.fmOf('Cold').stored_from], ['waiting', undefined]);
  assert.strictEqual(await w.p.promoteIdea(P('Idea')), true);
  assert.deepStrictEqual([w.fmOf('Idea').status, w.fmOf('Idea').goal], ['backlog', '[[New goal]]']);
  w.p.pickGoal = async () => { throw new Error('must not ask when a goal exists'); };
  assert.strictEqual(await w.p.promoteIdea(P('IdeaG')), true);
  assert.strictEqual(w.fmOf('IdeaG').goal, '[[Old]]');
  const done = ['You promoted IdeaG to a project.', 'You promoted Idea to a project.', 'You restored Cold to Waiting.', 'You moved Done to Cold Storage.', 'You moved Act to Waiting.'];
  assert.deepStrictEqual(w.log(), done, 'every board action logged, newest first');
  assert.ok(w.p.settings.activity.every((e) => Number.isFinite(e.at)), 'each entry has its time');
  assert.deepStrictEqual(w.saves[w.saves.length - 1].activity, w.p.settings.activity, 'saved to plugin data');
  for (const [, undo] of w.toasts.reverse()) await undo();
  for (const k of ['Act', 'Done', 'Cold', 'Idea', 'IdeaG']) assert.deepStrictEqual(w.fmOf(k), notes[k], `Undo restores ${k}`);
  assert.deepStrictEqual(w.log().slice(0, 5), done.slice().reverse().map((t) => `Undone: y${t.slice(1)}`), 'each Undo logs its own entry');
  assert.deepStrictEqual(w.log().slice(5), done, 'history is never rewritten');

  // Restore with no saved column: Backlog and a notice
  w = world({ C: { ...BASE, status: 'cold-storage' } }, {});
  notices.length = 0;
  assert.strictEqual(await w.p.restoreProject(P('C')), true);
  assert.strictEqual(w.fmOf('C').status, 'backlog');
  assert.ok(/no earlier column saved/.test(notices[0]), 'says it went to Backlog');

  // A failed write: a notice, false, the note unchanged
  w = world({ A: { ...BASE, status: 'active' } }, {});
  w.p.app.fileManager.processFrontMatter = async () => { throw new Error('disk'); };
  notices.length = 0;
  assert.strictEqual(await w.p.moveProject(P('A'), 'done'), false);
  assert.strictEqual(w.fmOf('A').status, 'active');
  assert.ok(/Could not change/.test(notices[0]));
  assert.deepStrictEqual(w.log(), [], 'failed write: nothing logged');
  { // The List's status menu writes through writeProject directly: not logged.
    const v = world({ A: { ...BASE, status: 'active' } }, {});
    const u = await v.p.writeProject(v.files[0], (fm) => { L.applyProjectStatus(fm, 'paused', TODAY); });
    assert.ok(u && v.fmOf('A').status === 'paused', 'direct write went through');
    assert.strictEqual(await u(), true, 'undo reports it wrote');
    assert.deepStrictEqual(v.log(), [], 'a direct write (the List) is not logged, nor its Undo');
  }

  // Two Cold Storage dialogs open on one note: the second keeps stored_from.
  w = world({ A: { ...BASE, status: 'waiting' } }, { ask: 'first' });
  let release; const gate = new Promise((r) => { release = r; });
  w.p.ask = async () => { await gate; return 'later'; };
  const second = w.p.coldStoreProject(P('A'));
  w.p.ask = async () => 'first';
  assert.strictEqual(await w.p.coldStoreProject(P('A')), true);
  release();
  assert.strictEqual(await second, true);
  assert.deepStrictEqual([w.fmOf('A').status, w.fmOf('A').stored_from, w.fmOf('A').why], ['cold-storage', 'waiting', 'later']);
  assert.strictEqual(await w.p.restoreProject(P('A')), true);
  assert.strictEqual(w.fmOf('A').status, 'waiting', 'restore goes back to the real column');

  // Stale cache: the guards read the note itself, so a quick move and move back works.
  w = world({ A: { ...BASE, status: 'active' }, C: { ...BASE, status: 'active' } }, { ask: 'x' });
  const cache = new Map(w.files.map((f) => [f, clone(f.fm)]));
  w.p.engine.fm = (f) => cache.get(f); // never catches up
  assert.strictEqual(await w.p.moveProject(P('A'), 'waiting'), true);
  assert.strictEqual(await w.p.moveProject(P('A'), 'active'), true, 'move back not refused by the stale cache');
  assert.strictEqual(w.fmOf('A').status, 'active');
  assert.strictEqual(await w.p.moveProject(P('A'), 'active'), false, 'same column refused from the note itself');
  assert.strictEqual(await w.p.coldStoreProject(P('C')), true);
  assert.strictEqual(await w.p.restoreProject(P('C')), true, 'restore right after storing');
  assert.strictEqual(await w.p.moveProject(P('C'), 'done'), true);
  assert.strictEqual(await w.p.coldStoreProject(P('C')), true);
  assert.strictEqual(await w.p.moveProject(P('C'), 'active'), false, 'cold storage refused from the note, not the cache');
  assert.strictEqual(await w.p.restoreProject(P('C')), true);
  assert.deepStrictEqual([w.fmOf('C').status, w.fmOf('C').end_date], ['done', TODAY]);

  // Undo after a hand edit keeps the edit and says so; Undo on a deleted note says so.
  w = world({ A: { ...BASE, status: 'active' }, B: { ...BASE, status: 'active' } }, { ask: 'stored' });
  await w.p.coldStoreProject(P('A'));
  w.fmOf('A').why = 'my own words';
  notices.length = 0;
  await w.toasts[0][1]();
  assert.deepStrictEqual([w.fmOf('A').status, w.fmOf('A').why, w.fmOf('A').stored_from], ['active', 'my own words', undefined]);
  assert.ok(/later change to why/.test(notices[0]), 'says the edit was kept');
  await w.p.moveProject(P('B'), 'done');
  w.files.splice(w.files.findIndex((f) => f.basename === 'B'), 1);
  notices.length = 0;
  await w.toasts[1][1]();
  assert.ok(/Could not undo: "B" was deleted/.test(notices[0]), 'deleted note: a clear notice');
  assert.ok(!w.log().some((t) => t.startsWith('Undone: you moved B')), 'deleted note: no Undone entry');
  w = world({ A: { ...BASE, status: 'active' } }, {});
  await w.p.moveProject(P('A'), 'done');
  w.p.app.fileManager.processFrontMatter = async () => { throw new Error('disk'); };
  notices.length = 0;
  await w.toasts[0][1]();
  assert.ok(/Could not undo the change to "A"/.test(notices[0]), 'failed undo write: a clear notice');
  assert.deepStrictEqual(w.log(), ['You moved A to Done.'], 'failed undo: no Undone entry');
  // A failed save of the history never fails the move.
  w = world({ A: { ...BASE, status: 'active' } }, {});
  w.p.saveData = async () => { throw new Error('disk'); };
  const err = console.error; const errs = []; console.error = (...a) => errs.push(a);
  try {
    assert.strictEqual(await w.p.moveProject(P('A'), 'done'), true, 'move still succeeds');
    await new Promise((r) => setImmediate(r));
  } finally { console.error = err; }
  assert.strictEqual(w.fmOf('A').status, 'done');
  assert.deepStrictEqual(w.log(), ['You moved A to Done.'], 'the entry stays in memory');
  assert.ok(errs.some((a) => /activity save failed/.test(a[0])), 'the failed save goes to the console');

  // The toast does not wait for the history save.
  w = world({ A: { ...BASE, status: 'active' } }, {});
  w.p.saveData = () => new Promise(() => {}); // a save that never finishes
  assert.strictEqual(await w.p.moveProject(P('A'), 'done'), true);
  assert.strictEqual(w.toasts.length, 1, 'toast shown before the save finished');
  assert.deepStrictEqual(w.log(), ['You moved A to Done.']);

  // Undo that puts nothing back (every moved field edited by hand since): no Undone entry.
  w = world({ A: { ...BASE, status: 'active' } }, { ask: 'stored' });
  await w.p.coldStoreProject(P('A'));
  Object.assign(w.fmOf('A'), { status: 'paused', stored_from: 'mine', why: 'mine' });
  notices.length = 0;
  await w.toasts[0][1]();
  assert.deepStrictEqual([w.fmOf('A').status, w.fmOf('A').why], ['paused', 'mine'], 'hand edits kept');
  assert.ok(/^Nothing undone: your later change/.test(notices[0]), 'says nothing was undone');
  assert.deepStrictEqual(w.log(), ['You moved A to Cold Storage.'], 'no Undone entry when nothing went back');

  // Empty metadata cache (just after a write): every action decides from the note itself.
  w = world({ A: { ...BASE, status: 'active' }, I: { type: 'project', status: 'idea' } }, { ask: 'x', confirm: true, goal: { basename: 'G1' } });
  w.p.engine.fm = () => undefined;
  assert.strictEqual(await w.p.coldStoreProject(P('A')), true);
  assert.strictEqual(await w.p.restoreProject(P('A')), true, 'restore straight after cold storage, empty cache');
  assert.strictEqual(w.fmOf('A').status, 'active');
  assert.strictEqual(await w.p.coldStoreProject(P('A')), true);
  assert.strictEqual(await w.p.deleteProjectPermanently(P('A')), true, 'delete straight after cold storage, empty cache');
  assert.strictEqual(await w.p.promoteIdea(P('I')), true, 'promote, empty cache');
  assert.strictEqual(w.fmOf('I').goal, '[[G1]]');

  // Promote, Undo, Promote with a stale cache still showing the goal: the picker is asked again.
  w = world({ I: { type: 'project', status: 'idea' } }, { goal: { basename: 'G1' } });
  await w.p.promoteIdea(P('I'));
  const stale = clone(w.fmOf('I'));
  w.p.engine.fm = () => stale;
  await w.toasts[0][1]();
  assert.ok(!('goal' in w.fmOf('I')), 'undo removed the goal');
  let asked = 0; w.p.pickGoal = async () => { asked++; return { basename: 'G2' }; };
  assert.strictEqual(await w.p.promoteIdea(P('I')), true);
  assert.deepStrictEqual([asked, w.fmOf('I').goal], [1, '[[G2]]'], 'goal picker asked from the note itself');
  // The goal disappears between the read and the write: the write refuses.
  w = world({ I: { type: 'project', status: 'idea' } }, {});
  w.p.freshFm = async () => ({ type: 'project', status: 'idea', goal: '[[Gone]]' });
  w.p.pickGoal = async () => { throw new Error('must not ask'); };
  notices.length = 0;
  assert.strictEqual(await w.p.promoteIdea(P('I')), false, 'no promote without a goal');
  assert.deepStrictEqual(w.fmOf('I'), { type: 'project', status: 'idea' }, 'unchanged');
  assert.ok(/^Could not do that/.test(notices[0]));

  // Delete re-checks after the confirm: restored meanwhile, nothing trashed.
  w = world({ C: { ...BASE, status: 'cold-storage', stored_from: 'waiting' } }, {});
  w.p.confirmAction = async () => { await w.p.restoreProject(P('C')); return true; };
  assert.strictEqual(await w.p.deleteProjectPermanently(P('C')), false, 'restored during the confirm: no delete');
  assert.deepStrictEqual(w.trashed, []);
  assert.strictEqual(w.fmOf('C').status, 'waiting');

  // Goal list: open goals only
  const GD = '04 Inner World/My Life/Goals';
  const gw = world({ [`${GD}/B goal`]: { type: 'goal', status: 'not-achieved' }, [`${GD}/A goal`]: { type: 'goal', status: 'on-hold' }, [`${GD}/Done goal`]: { type: 'goal', status: 'Achieved' }, [`${GD}/README`]: { type: 'readme' } }, {});
  assert.deepStrictEqual(gw.p.goalFiles().map((f) => f.basename), ['A goal', 'B goal'], 'open goals, A to Z');

  console.log(`project moves: OK (${n} move/store/restore cases)`);
})().catch((e) => { console.error('FAIL', e.stack || e.message); process.exit(1); });
