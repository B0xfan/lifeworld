#!/usr/bin/env node
/* Self-check for section 8, no Obsidian needed: the Ideas and Cold Storage tabs
 * (cards, area, buttons call the board actions), + Add idea (note shape, taken
 * name, logged), the project page's status menu routes (an idea leaves only by
 * Promote, a stored project only by Restore), the List's Waiting / Blocked
 * chips, and one description read per note change. The page look, the real
 * form and the real menus need a real Obsidian. */
'use strict';
const path = require('path');
const Module = require('module');
const assert = require('assert');
const notices = [];
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const plugin = require(path.join(__dirname, '..', 'dist', 'a4-projects', 'main.js'));
const L = plugin.logic;
const V = plugin.ProjectsView.prototype;

/* ---- status menu routes ---------------------------------------------------- */
const R = L.statusRoute;
assert.ok(L.PROJECT_STATUSES.includes('idea') && L.PROJECT_STATUSES.includes('cold-storage'), 'the menu lists idea and cold-storage');
assert.strictEqual(R('idea', 'backlog'), 'promote', 'idea to Backlog = Promote (asks for a goal)');
for (const to of ['active', 'waiting', 'done', 'failed', 'cold-storage']) assert.strictEqual(R('idea', to), null, `idea to ${to}: not offered`);
assert.strictEqual(R('cold-storage', 'paused', 'paused'), 'restore', 'stored: only its saved column');
assert.strictEqual(R('cold-storage', 'active', 'paused'), null);
assert.strictEqual(R('cold-storage', 'backlog', ''), 'restore', 'nothing saved: Backlog');
assert.strictEqual(R('cold-storage', 'backlog', 'failed'), 'restore', 'saved value not a column: Backlog');
assert.strictEqual(R('cold-storage', 'idea', 'paused'), null);
for (const from of ['backlog', 'active', 'waiting', 'paused', 'blocked', 'done']) assert.strictEqual(R(from, 'cold-storage'), 'cold', `${from} can be stored`);
for (const from of ['failed', 'dropped', '']) assert.strictEqual(R(from, 'cold-storage'), null, `${from || 'no status'} cannot be stored`);
for (const from of ['active', 'done', 'failed', '']) assert.strictEqual(R(from, 'idea'), null, 'nothing becomes an idea');
assert.strictEqual(R('active', 'waiting'), 'write');
assert.strictEqual(R('', 'backlog'), 'write', 'a project with no status can be given one');
assert.strictEqual(R('active', 'active'), null);
assert.strictEqual(L.readProject({ type: 'project', status: 'cold-storage', stored_from: ' Paused ' }, 'p', 'p').storedFrom, 'paused');
// The menu's plain write: the note on disk decides, so a stale page cannot shelve-skip.
for (const s of ['idea', 'cold-storage', ' Idea ']) {
  const fm = { status: s };
  assert.strictEqual(L.applyPlainStatus(fm, 'paused', '2026-10-13'), false, `a note now "${s}" (page drawn before): refused`);
  assert.strictEqual(fm.status, s, 'nothing written');
}
assert.strictEqual(L.applyPlainStatus({ status: 'active' }, 'paused', '2026-10-13').status, 'paused');

/* ---- idea note shape ------------------------------------------------------- */
const yaml = (o) => Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n';
assert.strictEqual(L.ideaNote('Beach cleanup', '  A signup   page. ', 'No date: yet', 'personal', '2026-10-13', yaml),
  '---\ntype: project\nstatus: idea\ncreated: 2026-10-13\nsphere: personal\nwhy: "No date: yet"\n---\n\n# Beach cleanup\n\nA signup   page.\n', 'spaces kept as typed, ends trimmed');
assert.ok(L.ideaNote('X', 'one\r\ntwo\nthree\rfour', '', 'work', 'd', yaml).endsWith('# X\n\none two three four\n'), 'line breaks become one space, so it stays one line');
assert.strictEqual(L.ideaNote('X', '', '  ', 'work', '2026-10-13', yaml), '---\ntype: project\nstatus: idea\ncreated: 2026-10-13\nsphere: work\n---\n\n# X\n\n', 'no why, no line: the New Project shape');
assert.strictEqual(L.firstBodyLine(L.ideaNote('X', 'One line.', '', 'work', '2026-10-13', yaml)), 'One line.', 'the one line is the card description');
assert.ok(L.ideaNote('X', '', 'w', 'work', 'd', (o) => `why: ${o.why}`).includes('why: w\n---'), 'a YAML writer without a final newline still closes the block');
// The one line is saved exactly as typed (hard rule: never delete what the user wrote).
for (const typed of ['!important call', '#1 priority', '#beach cleanup ideas', '!!! urgent', '## Plan', '![[pic.png]] the spot', '#'])
  assert.ok(L.ideaNote('X', typed, '', 'work', 'd', yaml).endsWith(`# X\n\n${typed}\n`), `"${typed}" is saved as typed`);
// The card shows it as is unless it is a real heading or embed (then the note keeps it, the card shows none).
for (const [typed, shown] of [['!important call', '!important call'], ['#1 priority', '#1 priority'], ['#beach cleanup ideas', '#beach cleanup ideas'],
  ['!!! urgent', '!!! urgent'], ['## Plan', ''], ['#', ''], ['![[pic.png]] the spot', ''], ['![alt](x.png)', '![alt](x.png)']])
  assert.strictEqual(L.firstBodyLine(L.ideaNote('X', typed, '', 'work', 'd', yaml)), shown, `"${typed}" shows as "${shown}"`);

/* ---- fake DOM -------------------------------------------------------------- */
const node = (tag) => { const n = { tag, kids: [], listeners: {}, className: '', textContent: '', dataset: {}, attrs: {},
  createEl(t) { const c = node(t); n.kids.push(c); return c; }, setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.listeners[t] = f; },
  empty() { n.kids = []; }, setText(t) { n.textContent = t; }, appendText(t) { n.kids.push({ kids: [], textContent: t }); }, addClass() {}, removeClass() {} }; return n; };
const walk = (n, f, out = []) => { if (f(n)) out.push(n); for (const k of n.kids || []) walk(k, f, out); return out; };
const text = (n) => n.textContent + (n.kids || []).map(text).join('');
const byCls = (pg, c) => walk(pg, (n) => n.className === c);

const P = (name, status, sphere, extra) => ({ path: `P/${name}.md`, name, key: name, status, sphere, why: '', storedFrom: '', mtime: 1, ...extra });
const projects = [P('Act', 'active', 'work'), P('Idea W', 'idea', 'work', { why: 'Ask two owners first.', mtime: 3 }), P('Idea P', 'idea', 'personal', { mtime: 2 }), P('Idea U', 'idea', 'unsorted'),
  P('Cold', 'cold-storage', 'work', { why: 'No time.', storedFrom: 'paused' }), P('Cold2', 'cold-storage', 'personal', { storedFrom: '' })];
const calls = [];
const host = { settings: L.normalizeSettings({}), engine: { file: () => null },
  promoteIdea: (p) => calls.push(['promote', p]), restoreProject: (p) => calls.push(['restore', p]), deleteProjectPermanently: (p) => calls.push(['delete', p]),
  ask: async () => 'Better reason', setProjectWhy: async (p, w) => calls.push(['why', p, w]) };
const tasks = [{ title: 'Write the outline', projectKey: 'Cold', path: 'T/o.md', status: 'open' }];
const view = Object.assign(Object.create(V), { plugin: host, app: {}, cfg: { statuses: [{ value: 'open', isCompleted: false }], priorities: [], doneStatus: 'done' }, today: '2026-10-13', tasks, projects, query: '', tab: 'ideas', area: null, descs: new Map(), render() {}, go() {} });

(async () => {
  // Ideas: every idea when no area, newest change first; Work keeps work.
  let pg = node('div'); view.renderBoard(pg);
  assert.deepStrictEqual(byCls(pg, 'a4pj-btitle').map(text), ['Idea W', 'Idea P', 'Idea U']);
  assert.strictEqual(byCls(pg, 'a4pj-areas').length, 1, 'Ideas has the Work / Personal buttons');
  assert.strictEqual(byCls(pg, 'a4pj-bfind').length, 0, 'no search on Ideas');
  assert.ok(text(byCls(pg, 'a4pj-bcard')[0]).includes('Why it is hereAsk two owners first.'));
  assert.ok(!text(byCls(pg, 'a4pj-bcard')[1]).includes('Why it is here'), 'no why: no section');
  view.area = 'work'; pg = node('div'); view.renderBoard(pg);
  assert.deepStrictEqual(byCls(pg, 'a4pj-btitle').map(text), ['Idea W'], 'Work: work ideas only');
  const card = byCls(pg, 'a4pj-bcard')[0];
  const btn = (c, label) => walk(c, (n) => n.tag === 'button' && n.textContent === label)[0];
  btn(card, 'Promote to project').listeners.click();
  await btn(card, 'Edit idea').listeners.click();
  assert.deepStrictEqual(calls, [['promote', 'P/Idea W.md'], ['why', 'P/Idea W.md', 'Better reason']], 'Promote and Edit idea call the board actions');
  view.area = 'personal'; view.projects = projects.filter((p) => p.status !== 'idea'); pg = node('div'); view.renderBoard(pg);
  assert.strictEqual(text(byCls(pg, 'a4pj-empty')[0]), 'no ideas here yet');
  view.projects = projects;

  // Cold Storage: all areas, no area buttons, saved column, next step, Restore line.
  calls.length = 0; view.tab = 'cold'; view.area = 'personal'; pg = node('div'); view.renderBoard(pg);
  assert.strictEqual(byCls(pg, 'a4pj-areas').length, 0, 'no area buttons on Cold Storage');
  assert.deepStrictEqual(byCls(pg, 'a4pj-btitle').map(text), ['Cold', 'Cold2'], 'every stored project, whatever the area');
  assert.ok(text(byCls(pg, 'a4pj-sechead')[0]).includes('Cold Storage2'), 'heading with the count');
  const [c1, c2] = byCls(pg, 'a4pj-bcard');
  const t1 = text(c1), t2 = text(c2);
  assert.ok(t1.includes('Previously in Paused') && t1.includes('Why it was storedNo time.') && t1.includes('Saved next stepWrite the outline') && t1.includes('Restore returns this project to Paused.'), t1);
  assert.ok(/Stored \w{3} \d/.test(t1), 'stored date');
  assert.ok(!t2.includes('Previously in') && t2.includes('No reason saved.') && t2.includes('None saved.') && t2.includes('to Backlog'), t2);
  btn(c1, 'Restore').listeners.click(); btn(c1, 'Delete permanently').listeners.click();
  assert.deepStrictEqual(calls, [['restore', 'P/Cold.md'], ['delete', 'P/Cold.md']]);
  assert.strictEqual(walk(c1, (n) => n.textContent === 'Move to Cold Storage').length, 0);

  // Delete permanently is offered on Cold Storage cards only (spec 10d).
  const src = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'projects', 'main.js'), 'utf8'); // source text, not the bundle
  assert.strictEqual((src.match(/deleteProjectPermanently\(/g) || []).length, 2, 'one definition, one caller (the Cold Storage card)');

  // A card click opens the project page; a button click does not.
  const gone = []; view.go = (s) => gone.push(s);
  c1.listeners.click({ target: { closest: () => null } }); c1.listeners.click({ target: { closest: () => ({}) } });
  assert.deepStrictEqual(gone, [{ page: 'project', project: 'P/Cold.md' }]);

  // Header: + Add idea on Ideas only.
  assert.ok(/this\.tab === 'ideas' \? \{ label: '\+ Add idea'/.test(src));
  assert.ok(/\['waiting', 'Waiting'\], \['blocked', 'Blocked'\]/.test(src), 'List chips offer Waiting and Blocked');
  assert.ok(/else if \(how === 'write'\) \{[^}]*applyPlainStatus\(fm, v, today\)/.test(src), 'the status menu write goes through the shelved-note guard');
  assert.ok(/return applyPlainStatus\(fm, status, today\)/.test(src), 'a board move goes through it too');

  /* ---- + Add idea form: Enter steps to the next box, only Why saves -------- */
  {
    let focused = null; const saved = [];
    const fn = (tag, o) => { const n = { tag, kids: [], on: {}, value: '', textContent: (o && o.text) || '', attrs: {},
      createEl(t, oo) { const c = fn(t, oo); n.kids.push(c); return c; }, createDiv(oo) { return n.createEl('div', oo); },
      setAttr(k, v) { n.attrs[k] = v; }, addEventListener(t, f) { n.on[t] = f; }, focus() { focused = n; }, setText(t) { n.textContent = t; }, empty() { n.kids = []; } }; return n; };
    if (typeof window === 'undefined') global.window = { setTimeout: () => {} };
    const m = new plugin.IdeaModal({}, 'work', async (v) => { saved.push(v); return {}; });
    Object.assign(m, { titleEl: fn('h'), contentEl: fn('div'), close() {} });
    m.onOpen();
    const [ti, li, wi] = walk(m.contentEl, (n) => n.tag === 'input');
    const enter = (i) => i.on.keydown({ key: 'Enter', isComposing: false, preventDefault() {} });
    ti.value = 'Beach cleanup';
    enter(ti); assert.strictEqual(focused, li, 'Enter in Title: on to One line'); assert.strictEqual(saved.length, 0, 'Enter in Title does not save');
    enter(li); assert.strictEqual(focused, wi, 'Enter in One line: on to Why'); assert.strictEqual(saved.length, 0, 'Enter in One line does not save');
    enter(wi); await new Promise((r) => setImmediate(r));
    assert.deepStrictEqual(saved, [{ title: 'Beach cleanup', line: '', why: '', sphere: 'work' }], 'Enter in Why saves');
  }

  /* ---- one description read per note change ------------------------------- */
  let reads = 0; let release;
  const gate = new Promise((r) => { release = r; });
  const dv = Object.assign(Object.create(V), { plugin: { engine: { file: () => ({}) } }, app: { vault: { cachedRead: () => { reads++; return gate; } } }, descs: new Map(), query: '' });
  const D = { path: 'P/D.md', mtime: 5 };
  const a = node('div'), b = node('div');
  dv.descOf(D, null, () => {}); dv.descOf(D, a); dv.descOf(D, null, () => {}); dv.descOf(D, b);
  assert.strictEqual(reads, 1, 'a pending read is joined, not repeated');
  release('# D\n\nThe line.\n'); await gate; await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual([a.textContent, b.textContent], ['The line.', 'The line.'], 'every waiting card is filled');
  assert.strictEqual(dv.descOf(D), 'The line.'); assert.strictEqual(reads, 1, 'cached after');
  dv.descOf({ path: 'P/D.md', mtime: 6 }); assert.strictEqual(reads, 2, 'a note change reads again');

  // With search text: every search that joined the read re-runs once when a new line lands.
  const gates = []; const later = (text) => { const g = gates.shift(); g.release(text); return g.p; };
  const sv = Object.assign(Object.create(V), { plugin: dv.plugin, descs: new Map(), query: 'cleanup',
    app: { vault: { cachedRead: () => { const g = {}; g.p = new Promise((r) => { g.release = r; }); gates.push(g); return g.p; } } } });
  const S = { path: 'P/S.md', mtime: 1 }; let runs = 0;
  sv.descOf(S, null, () => runs++); sv.descOf(S, node('div'), () => runs++);
  assert.strictEqual(gates.length, 1, 'joined: one read');
  await later('Beach cleanup crew.'); await new Promise((r) => setImmediate(r));
  assert.strictEqual(runs, 2, 'each waiting search re-run once');

  // The note changes while a read is pending: the old read fills nothing, the new one fills the later card.
  const oldCard = node('div'), newCard = node('div');
  sv.descOf({ path: 'P/S.md', mtime: 2 }, oldCard); sv.descOf({ path: 'P/S.md', mtime: 3 }, newCard);
  assert.strictEqual(gates.length, 2, 'a newer change starts its own read');
  await later('Old text.'); await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual([oldCard.textContent, newCard.textContent], ['Beach cleanup crew.', 'Beach cleanup crew.'], 'the superseded read fills nothing');
  await later('New text.'); await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual([oldCard.textContent, newCard.textContent], ['Beach cleanup crew.', 'New text.'], 'the newer read fills the later card only');
  assert.strictEqual(sv.descOf({ path: 'P/S.md', mtime: 3 }), 'New text.');

  /* ---- + Add idea ----------------------------------------------------------- */
  const made = []; const toasts = []; const logs = [];
  const dir = { children: [{ name: 'Taken.md', basename: 'Taken' }] };
  const pl = Object.assign(Object.create(plugin.prototype), {
    engine: { today: () => '2026-10-13' }, toast: { show: (m, u) => toasts.push([m, u]) }, logActivity: (t) => logs.push(t),
    app: { vault: { getAbstractFileByPath: (p) => (p === '04 Inner World/My Life/Projects' ? dir : null), create: async (p, c) => { made.push([p, c]); return { path: p, basename: p.split('/').pop().replace(/\.md$/, '') }; } } },
  });
  fake.stringifyYaml = yaml;
  notices.length = 0;
  assert.strictEqual(await pl.createIdea({ title: 'Taken', line: '', why: '', sphere: 'work' }), null, 'a taken name keeps the form open');
  assert.ok(/already/.test(notices[0]));
  assert.strictEqual(await pl.createIdea({ title: 'taken', line: '', why: '', sphere: 'work' }), null, 'a name that differs only in case is taken too (the Mac disk ignores case)');
  assert.strictEqual(notices[1], 'There is already a project called "Taken".');
  assert.strictEqual(await pl.createIdea({ title: '  ', sphere: 'work' }), null);
  assert.strictEqual(await pl.createIdea({ title: 'X', sphere: 'unsorted' }), null, 'Work or Personal only');
  assert.strictEqual(made.length, 0);
  const f = await pl.createIdea({ title: 'Rental: helper?', line: 'Listing from photos.', why: 'Ask owners.', sphere: 'work' });
  assert.ok(f);
  assert.deepStrictEqual(made, [['04 Inner World/My Life/Projects/Rental helper.md', '---\ntype: project\nstatus: idea\ncreated: 2026-10-13\nsphere: work\nwhy: "Ask owners."\n---\n\n# Rental: helper?\n\nListing from photos.\n']]);
  assert.deepStrictEqual(logs, ['You added the idea Rental helper.']);
  assert.strictEqual(toasts[0][1], undefined, 'no Undo: only Delete permanently removes a note');
  const fail = Object.assign(Object.create(plugin.prototype), { engine: pl.engine, toast: pl.toast, logActivity: (t) => logs.push(t),
    app: { vault: { getAbstractFileByPath: () => null, create: async () => { throw new Error('disk'); } } } });
  const ce = console.error; console.error = () => {};
  try { assert.strictEqual(await fail.createIdea({ title: 'Y', sphere: 'personal' }), null, 'a failed write keeps the form open'); } finally { console.error = ce; }
  assert.strictEqual(logs.length, 1, 'a failed add logs nothing');

  /* ---- the status menu is not the board: not logged ------------------------ */
  let fm = { type: 'project', status: 'cold-storage', stored_from: 'paused' };
  const file = { path: '04 Inner World/My Life/Projects/S.md', extension: 'md', basename: 'S' };
  const quiet = []; const shown = [];
  const sp = Object.assign(Object.create(plugin.prototype), { engine: { file: () => file, today: () => '2026-10-13' }, toast: { show: (m, u) => shown.push(u) },
    logActivity: (t) => quiet.push(t), app: { fileManager: { processFrontMatter: async (_, fn) => { fn(fm); } } } });
  assert.strictEqual(await sp.restoreProject(file.path, false), true);
  assert.strictEqual(fm.status, 'paused'); assert.deepStrictEqual(quiet, [], 'Restore from the status menu: not logged');
  assert.strictEqual(await sp.restoreProject(file.path, true), false, 'already restored: refused');
  fm = { type: 'project', status: 'cold-storage', stored_from: 'paused' };
  assert.strictEqual(await sp.restoreProject(file.path), true); assert.strictEqual(quiet.length, 1, 'from the board: logged');
  quiet.length = 0; sp.ask = async () => 'No time.'; sp.freshFm = async () => fm;
  fm = { type: 'project', status: 'active' };
  assert.strictEqual(await sp.coldStoreProject(file.path, false), true);
  assert.strictEqual(fm.status, 'cold-storage'); assert.deepStrictEqual(quiet, [], 'Cold Storage from the status menu: not logged');
  fm = { type: 'project', status: 'idea', goal: '[[G]]' };
  assert.strictEqual(await sp.promoteIdea(file.path, false), true);
  assert.strictEqual(fm.status, 'backlog'); assert.deepStrictEqual(quiet, [], 'Promote from the status menu: not logged');
  fm = { type: 'project', status: 'idea', goal: '[[G]]' };
  assert.strictEqual(await sp.promoteIdea(file.path), true); fm = { type: 'project', status: 'active' };
  assert.strictEqual(await sp.coldStoreProject(file.path), true); assert.strictEqual(quiet.length, 2, 'both from the board: logged');
  console.log('shelf self-check: OK');
})().catch((e) => { console.error(e); process.exit(1); });
