#!/usr/bin/env node
/* Logic tests for the A4 Sidebar.
 * `node tests/test-sidebar.js`. No Obsidian needed; the rendered checks are the
 * hidden-sandbox run (session scratch).
 *
 * 1. Work / Personal / Unsorted project counts (0.6.1, bug 2026-10-05: the
 *    sidebar said 16 work projects, the Projects page listed 14; the 2 failed
 *    ones were counted). The count must equal what A4 Projects lists as open,
 *    using A4 Projects' own rule, never a copy.
 * 2. (0.6.2, ruling 2026-10-05) the list that folds out shows only those open
 *    projects; closed ones stay on the Projects page's Closed section.
 * 3. (0.6.2) a drop refused because the folder already has that name says so
 *    in a notice. The row must ACCEPT dragover for that case, or the browser
 *    never delivers the drop and the notice is dead code (it was in 0.6.1).
 * 4. (0.7.0, plugin overhaul step 3) the toolbar buttons are A4 Sidebar's own
 *    commands, so they work with ICOR Connect off; the canvas name; the Audrey
 *    badge opens the roster note; nothing calls ICOR Connect any more.
 * 5. (0.7.1, 2026-10-07) Scheduled Jobs/Reports lists newest first, like
 *    the Scratchpad and Journal; every other folder stays A to Z.
 * 6. (0.8.0, mockups approved 2026-10-07 / 2026-10-08) sort settings: real
 *    dates in names, per-folder orders pre-filled from the two retired sort
 *    plugins, nearest listed folder wins, and the order is computed from the
 *    names every time (a new note lands in place; nothing is a frozen list).
 * 7. (0.9.0, mockup approved 2026-10-08) the Bases button: a database icon
 *    in both rows, a drop-down of every base A to Z with its folder, read
 *    fresh on every click; TaskNotes' starter views left out (files kept).
 * Moved from the A4 vault: behaviour checks load the built files, text checks read
 * src/ (tests/lib/paths.js). Vault checks read tests/fixtures/vault, or the owner's vault with A4_VAULT. */
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const { part, STYLES, source } = require('./lib/paths');
const VAULT = require('./lib/paths').vault; // the owner's vault with A4_VAULT, else the frozen copy
const SB_MAIN = 'a4-sidebar';
const PJ_MAIN = 'a4-projects';

class TFile {}
class TFolder {}
const stub = class {};
const fakeObsidian = new Proxy({ TFile, TFolder, Platform: { isMobile: false }, Keymap: { isModEvent: () => false }, setIcon() {} }, { get: (t, k) => (k in t ? t[k] : stub) });
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };

const SB = part(SB_MAIN);
const S = SB.__logic;
const PJ = part(PJ_MAIN);
const L = PJ.logic;

let n = 0; let failed = 0;
function ok(cond, name, extra) { n++; if (!cond) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- 1. project counts ------------------------------------------------------ */
// A real A4 Projects plugin object (its prototype, no Obsidian), as the sidebar sees it.
const pj = Object.create(PJ.prototype);
ok(typeof pj.isOpenProjectNote === 'function', 'A4 Projects offers isOpenProjectNote');
const rule = S.openRuleFrom(pj);
const fm = (status, extra) => Object.assign({ type: 'project', sphere: 'work', status }, extra);
for (const s of ['active', 'backlog', 'paused', 'Active', ' paused ', '', undefined]) ok(rule(fm(s)) === true, `open: status ${JSON.stringify(s)}`);
for (const s of ['done', 'failed', 'dropped', 'Failed', ' DONE ']) ok(rule(fm(s)) === false, `closed: status ${JSON.stringify(s)}`);
ok(rule({ status: 'active' }) === false, 'not a project note: not counted');
// Without A4 Projects there is no open list; every project counts (old behaviour).
const none = S.openRuleFrom(null);
ok(none(fm('failed')) === true && S.openRuleFrom({}).call(null, fm('done')) === true, 'A4 Projects off: every project counts');
// The count itself.
const members = ['active', 'paused', 'failed', 'backlog', 'done'].map((s, i) => ({ name: `P${i}`, status: s, open: rule(fm(s)) }));
eq(S.openProjectCount(members), 3, 'count leaves out failed and done');
eq(S.openProjectCount([]), 0, 'count of none is 0');

// Real data (read-only; the frozen copy unless A4_VAULT): for each list, the sidebar's count = the page's open list.
const parse = (t) => { const m = /^---\n([\s\S]*?)\n---/.exec(t); const o = {}; if (m) for (const l of m[1].split('\n')) { const x = /^([\w-]+):\s*(.*)$/.exec(l); if (x) o[x[1]] = x[2].trim().replace(/^"(.*)"$/, '$1'); } return o; };
const PD = path.join(VAULT || '', '04 Inner World/My Life/Projects');
const notes = !VAULT ? [] : fs.readdirSync(PD).filter((f) => f.endsWith('.md')).map((f) => ({ name: f.replace(/\.md$/, ''), fm: parse(fs.readFileSync(path.join(PD, f), 'utf8')) })).filter((x) => x.fm.type === 'project');
const projects = notes.map((x) => L.readProject(x.fm, `x/${x.name}.md`, x.name));
const closedSeen = [];
if (VAULT) for (const kind of ['work', 'personal', 'unsorted']) {
  const sbMembers = notes.filter((x) => S.sphereOf(x.fm) === kind).map((x) => ({ name: x.name, open: rule(x.fm) }));
  const page = L.overviewGroups(projects, 'all', '', kind).flatMap((g) => g.projects).map((p) => p.name).sort();
  eq(S.openProjectCount(sbMembers), page.length, `real data: ${kind} count = projects the page lists as open (${page.length})`);
  eq(sbMembers.filter((m) => m.open).map((m) => m.name).sort(), page, `real data: ${kind}, same projects`);
  closedSeen.push(...sbMembers.filter((m) => !m.open).map((m) => m.name));
}
// Updated in section 4: ideas and cold storage are not open either, so they are left out too.
if (VAULT) eq(closedSeen.sort(), [...L.closedProjects(projects, ''), ...projects.filter((p) => p.status === 'idea' || p.status === 'cold-storage')].map((p) => p.name).sort(), 'real data: the ones left out are exactly the Closed list plus Ideas and Cold storage');
if (require('./lib/paths').FROZEN) ok(projects.some((p) => p.status === 'idea') && projects.some((p) => p.status === 'cold-storage') && L.closedProjects(projects, '').length > 0, 'real data: the notes include closed, idea and cold-storage projects');

/* ---- 2. the folded-out list = the open projects -------------------------- */
eq(S.openProjects(members).map((m) => m.name), ['P0', 'P1', 'P3'], 'list leaves out failed and done');
eq(S.openProjects(members).length, S.openProjectCount(members), 'list length = count');
eq(S.openProjects([{ name: 'X', open: false }]), [], 'only closed: empty list (Unsorted hides)');
if (VAULT) for (const kind of ['work', 'personal', 'unsorted']) {
  const shown = S.openProjects(notes.filter((x) => S.sphereOf(x.fm) === kind).map((x) => ({ name: x.name, open: rule(x.fm) }))).map((m) => m.name).sort();
  const page = L.overviewGroups(projects, 'all', '', kind).flatMap((g) => g.projects).map((p) => p.name).sort();
  eq(shown, page, `real data: ${kind} folded-out list = the page's open list`);
}

/* ---- 3. name-taken drop says so ------------------------------------------- */
const exists = (set) => (p) => set.has(p);
const taken = S.planMove('03 WiP/Plan.md', false, '01 Inbox', exists(new Set(['01 Inbox/Plan.md'])));
eq(taken.reason, 'name-taken', 'clash is name-taken');
ok(S.dropAccepts(taken) === true, 'name-taken: dragover accepted so drop fires');
ok(S.dropAccepts(S.planMove('03 WiP/Plan.md', false, '01 Inbox', exists(new Set()))) === true, 'free name: accepted');
ok(S.dropAccepts(S.planMove('01 Inbox/Plan.md', false, '01 Inbox', exists(new Set()))) === false, 'same folder: refused silently');
ok(S.dropAccepts(S.planMove('03 WiP/F', true, '01 Inbox', exists(new Set()))) === false, 'folder: refused silently');
ok(S.dropAccepts(null) === false, 'nothing dragged: refused');
eq(S.nameTakenMessage('Plan.md', '01 Inbox'), 'A note called Plan is already in Inbox.', 'message: note, room prefix dropped');
eq(S.nameTakenMessage('photo.png', 'Images'), 'A note called photo.png is already in Images.', 'message: other file keeps extension');
ok(!/\u2014/.test(S.nameTakenMessage('a.md', 'b')), 'message: no em dash');

// Static: the sidebar uses the count and A4 Projects' rule, and keeps no copy of the closed statuses.
const src = fs.readFileSync(source('a4-sidebar'), 'utf8');
ok(/count: openProjectCount\(members\)/.test(src) && !/count: members\.length/.test(src), 'sidebar: the Work / Personal item shows the open count');
// Updated in phase 2 section 1: the parts find each other through LifeWorld (core/parts.js).
ok(/openRuleFrom\(partOf\(this\.app, 'a4-projects'\)\)/.test(src), "sidebar: the rule comes from A4 Projects");
ok(!/'failed'|'dropped'|CLOSED_STATUSES/.test(src), 'sidebar: no copy of the closed statuses');
ok(/const members = openProjects\(this\.projectsOf\(v\.kind\)\)/.test(src), 'sidebar: the folded-out list uses openProjects');
ok(/if \(!x \|\| !dropAccepts\(x\.p\)\) return;/.test(src) && /if \(x\.p\.ok\) row\.addClass\('is-drop'\)/.test(src), 'sidebar: dragover uses dropAccepts, highlights only a real move');
ok(/new Notice\(nameTakenMessage\(x\.f\.name, folder\.name\)\)/.test(src), 'sidebar: drop shows the name-taken notice');
const pjSrc = fs.readFileSync(source('a4-projects'), 'utf8');
ok(/isOpenProjectNote\(fm\) \{ return isOpenProject\(readProject\(fm, '', ''\)\); \}/.test(pjSrc), 'A4 Projects: the public method uses the page rule');
// Updated when moved: on the projects board branch the Closed list holds the closed statuses only
// (ideas and cold storage are neither open nor closed), so it no longer negates the open rule.
ok(/p\.sphere === sp && isOpenProject\(p\)/.test(pjSrc) && /function closedProjects[^\n]*\n[^\n]*\n\s*return projects\.filter\(\(p\) => CLOSED_STATUSES\.includes\(p\.status\)/.test(pjSrc), 'A4 Projects: overview uses the open rule, Closed lists the closed statuses');

/* ---- 4. toolbar and Files tab chrome without ICOR Connect (0.7.0) ---------- */
eq(S.TOOLS.map((t) => t.id), ['daily', 'unique', 'canvas', 'graph'], 'toolbar: four buttons in the order already known');
eq(S.TOOLS.map((t) => t.icon), ['calendar-check', 'file-clock', 'layout-dashboard', 'git-fork'], 'toolbar: same icons as before');
eq(S.TOOLS.map((t) => t.label), ["Open today's daily note", 'New unique note', 'New canvas in the Daily Scratchpad', 'Open graph view'], 'toolbar: same tooltips as before');
ok(S.TOOLS.every((t) => t.command.startsWith('a4-sidebar:')), 'toolbar: every button runs an A4 Sidebar command');
for (const t of S.TOOLS) { const id = t.command.split(':')[1]; ok(!!S.CORE_TOOLS[id] || new RegExp(`id: '${id}'`).test(src), `toolbar: command ${id} is registered by the sidebar`); }
eq(Object.values(S.CORE_TOOLS).map((c) => c.core), ['daily-notes', 'zk-prefixer', 'graph:open'], 'toolbar: core commands behind daily, unique, graph');
ok(!/icor-for-life-connect:|micor-/.test(src), 'sidebar: no ICOR Connect command or class used');
ok(/if \(this\.connectOn\(\)\) \{ this\.clear\(\); return; \}/.test(src), 'sidebar: steps aside if ICOR Connect is switched back on (no doubled buttons)');
const d = new Date(2026, 9, 6, 13, 5);
eq(S.canvasPath(d, () => false), '00 Daily Scratchpad/2026-10-06_canvas.canvas', 'canvas: dated name in the Daily Scratchpad');
const taken2 = new Set(['00 Daily Scratchpad/2026-10-06_canvas.canvas', '00 Daily Scratchpad/2026-10-06_canvas-1.canvas']);
eq(S.canvasPath(d, (p) => taken2.has(p)), '00 Daily Scratchpad/2026-10-06_canvas-2.canvas', 'canvas: -1, -2 when taken');
eq(S.canvasPath(new Date(2026, 0, 9), () => false), '00 Daily Scratchpad/2026-01-09_canvas.canvas', 'canvas: zero-padded month and day');
if (VAULT) ok(fs.existsSync(path.join(VAULT, S.ROSTER)), 'badge: the roster note exists (' + S.ROSTER + ')');
if (VAULT) ok(fs.existsSync(path.join(VAULT, S.SCRATCHPAD)), 'canvas: the Daily Scratchpad folder exists');
ok(/'Open the AI Team roster'/.test(src) && /openRoster\(e\)/.test(src), 'badge: clicking opens the roster');
ok(!/chevron-up|micor-explorer-dot|is-connected/.test(src), 'badge: no arrow and no status dot');
ok(!/'gauge'/.test(src), 'no room-folder gauge icons');
ok(/stop\(\) \{[\s\S]*?this\.clear\(\);/.test(src) && /document\.querySelectorAll\('\.a4sb-files-tool, \.a4sb-audrey, \.a4sb-top-btn'\)\.forEach\(\(e\) => e\.remove\(\)\)/.test(src), 'turning the plugin off removes what it added');
const zk = path.join(VAULT || '', '.obsidian/zk-prefixer.json');
if (VAULT) ok(fs.existsSync(zk) && /MM-DD-YYYY - h-mm A/.test(fs.readFileSync(zk, 'utf8')), 'unique notes keep their name format (core setting, not the plugin)');

// 5. newest-first folders (0.7.1)
{
  const kids = (names) => names.map((name) => ({ name, isFolder: false }));
  const order = (folder, names) => S.sortChildren(folder, kids(names)).map((x) => x.name);
  const rep = ['2026-09-12-shop-sync-check.md', '2026-10-06-dream-full.md', '2026-09-30-automation-health.md'];
  eq(order('06 AI Team/Scheduled Jobs/Reports', rep), ['2026-10-06-dream-full.md', '2026-09-30-automation-health.md', '2026-09-12-shop-sync-check.md'], 'sort: Scheduled Jobs/Reports newest first');
  eq(order('04 Inner World/Journal/2026/10', ['2026-10-01.md', '2026-10-05.md']), ['2026-10-05.md', '2026-10-01.md'], 'sort: Journal still newest first');
  eq(order('00 Daily Scratchpad', ['10-01-2026.md', '10-06-2026.md']), ['10-06-2026.md', '10-01-2026.md'], 'sort: Scratchpad still newest first');
  eq(order('06 AI Team/Scheduled Jobs', ['b.md', 'a.md']), ['a.md', 'b.md'], 'sort: Scheduled Jobs itself stays A to Z');
  eq(order('03 WiP', ['b.md', 'a.md']), ['a.md', 'b.md'], 'sort: other folders A to Z');
  const mixed = S.sortChildren('06 AI Team/Scheduled Jobs/Reports', [{ name: 'z', isFolder: true }, { name: 'a', isFolder: true }, { name: '2026-01-01.md', isFolder: false }]).map((x) => x.name);
  eq(mixed, ['a', 'z', '2026-01-01.md'], 'sort: subfolders first, A to Z, in a newest-first folder');
}

// 6. sort settings (0.8.0)
{
  const D = S.normalizeSort(undefined);
  const kids = (names) => names.map((name) => ({ name, isFolder: false }));
  const order = (folder, names, sort) => S.sortChildren(folder, kids(names), sort || D).map((x) => x.name);
  // pre-fill = what the two retired plugins did
  eq(D.perFolder, { '00 Daily Scratchpad': 'newest', '04 Inner World': 'az', '04 Inner World/Library Notes': 'az', '04 Inner World/My Life': 'az', '06 AI Team/Scheduled Jobs/Reports': 'newest' }, 'pre-fill: folder-by-folder list');
  eq([D.dates, D.text, D.folders], ['last', 'az', false], 'pre-fill: Newest last, A to Z, folders off');
  eq(D.newestFirstIn, ['00 Daily Scratchpad', 'Journal', '06 AI Team/Scheduled Jobs/Reports'], 'pre-fill: always newest first in');
  eq(order('06 AI Team/Agents/Dex/Journal', ['2026-09-02-a.md', '2026-10-08-b.md']), ['2026-10-08-b.md', '2026-09-02-a.md'], 'every Journal folder newest first (AI Team journals too, as in 0.7)');
  ok(!S.SORT_MODES.includes('own') && !/My own order/.test(src), 'no drag-your-own-order option (2026-10-08)');
  // damaged / partial settings never break the list
  eq(S.normalizeSort({ dates: 'x', text: 7, perFolder: { a: 'own', b: 'za' }, newestFirstIn: 'x' }), { dates: 'last', text: 'az', folders: false, newestFirstIn: D.newestFirstIn, perFolder: { b: 'za' } }, 'damaged values fall back');
  eq(S.normalizeSort({ perFolder: {} }).perFolder, {}, 'an emptied list stays empty (not re-filled)');
  // dates in A4 names
  eq(S.dateKey('10-08-2026.md'), { day: 20261008, time: -1 }, 'date: daily note');
  eq(S.dateKey('10-08-2026 - 2-05 PM.md'), { day: 20261008, time: 845 }, 'date: quick capture PM');
  eq(S.dateKey('10-08-2026 - 12-05 AM.md'), { day: 20261008, time: 5 }, 'date: 12 AM is midnight');
  eq(S.dateKey('09-12-2026 - 1328 - ABC Northside.md'), { day: 20260912, time: 808 }, 'date: older HHmm capture');
  eq(S.dateKey('2026-10-03-wip-sweep.md'), { day: 20261003, time: -1 }, 'date: ISO report');
  eq(S.dateKey('2026-10-08_canvas.canvas'), { day: 20261008, time: -1 }, 'date: scratchpad canvas');
  for (const n of ['67 Ways to Bake.md', 'README.md', '13-40-2026.md', '2026-1-1.md', '123-45-6789.md']) ok(S.dateKey(n) === null, `not a date: ${n}`);
  // Scratchpad: newest first across the new year and within a day
  eq(order('00 Daily Scratchpad', ['12-31-2026.md', 'README.md', '01-02-2027.md', '01-02-2027 - 11-00 AM.md', '01-02-2027 - 1-05 PM.md']),
    ['01-02-2027 - 1-05 PM.md', '01-02-2027 - 11-00 AM.md', '01-02-2027.md', '12-31-2026.md', 'README.md'], 'Scratchpad: real dates, newest first, README below');
  // Reports: same order the old reverse-name sort gave, ties included
  const rep = ['2026-10-03-vault-root-check.md', '2026-10-02-wip-sweep.md', '2026-10-03-wip-sweep.md', '2026-10-06-dream-full.md'];
  eq(order('06 AI Team/Scheduled Jobs/Reports', rep), rep.slice().sort((a, b) => -a.localeCompare(b)), 'Reports: same as before (reverse name), same-day ties too');
  // Journal (always newest first, inherited into YYYY/MM)
  eq(order('04 Inner World/Journal/2026/10', ['2026-10-01.md', '2026-10-05.md']), ['2026-10-05.md', '2026-10-01.md'], 'Journal month: newest first');
  // A to Z pre-fill reaches subfolders (My Life -> Projects -> Project Notes; Topics; Sports)
  for (const f of ['04 Inner World/My Life/Projects/Project Notes', '04 Inner World/My Life/Topics', '04 Inner World/My Life/Sports', '04 Inner World/Meetings']) eq(S.sortRuleFor(f, D) && S.sortRuleFor(f, D).mode, 'az', `A to Z inherited: ${f}`);
  eq(S.sortRuleFor('04 Inner World/Journal/2026/10', D), { mode: 'newest', from: '04 Inner World/Journal', always: true }, 'nearest listed folder wins (Journal over Inner World)');
  eq(S.sortRuleFor('03 WiP', D), null, 'unlisted folder: main setting');
  // Library Notes: A to Z by name, a quote-mark title first, dates not special
  eq(order('04 Inner World/Library Notes', ['Twin Market.md', '‘I got carried away’.md', '67 Ways to Bake.md', 'Applewood.md']), ['‘I got carried away’.md', '67 Ways to Bake.md', 'Applewood.md', 'Twin Market.md'], 'Library Notes: A to Z');
  // a NEW note lands in place (computed from names, nothing frozen)
  const topics = ['A3.md', 'A4.md', 'Cabin Retreat.md', 'Zebra.md'];
  eq(order('04 Inner World/My Life/Topics', topics.concat('Banana.md')), ['A3.md', 'A4.md', 'Banana.md', 'Cabin Retreat.md', 'Zebra.md'], 'new note lands A to Z, not at the bottom');
  eq(order('00 Daily Scratchpad', ['10-06-2026.md', '10-07-2026.md', '10-08-2026.md'])[0], '10-08-2026.md', 'new daily note lands on top');
  // the main settings
  const main = (p) => S.normalizeSort({ ...p, perFolder: {}, newestFirstIn: [] });
  eq(order('03 WiP', ['b.md', '09-02-2026.md', 'a.md', '09-01-2026.md']), ['09-01-2026.md', '09-02-2026.md', 'a.md', 'b.md'], 'main: dated first, newest last, then A to Z');
  eq(order('03 WiP', ['b.md', '09-02-2026.md', 'a.md', '09-01-2026.md'], main({ dates: 'first', text: 'za' })), ['09-02-2026.md', '09-01-2026.md', 'b.md', 'a.md'], 'main: newest first + Z to A');
  const mf = (sort) => S.sortChildren('03 WiP', [{ name: '2026-09-10 Garden', isFolder: true }, { name: '2026-10-08-sort', isFolder: true }, { name: 'Alpha', isFolder: true }, { name: 'n.md', isFolder: false }], sort).map((x) => x.name);
  eq(mf(main({ dates: 'first' })), ['2026-09-10 Garden', '2026-10-08-sort', 'Alpha', 'n.md'], 'folders off: folders on top A to Z');
  eq(mf(main({ dates: 'first', folders: true })), ['2026-10-08-sort', '2026-09-10 Garden', 'Alpha', 'n.md'], 'folders on: folders follow the rules, still on top');
  // right-click choices and edits
  let s2 = S.setFolderSort(D, '04 Inner World/My Life/Topics', 'za');
  eq(order('04 Inner World/My Life/Topics', topics, s2), topics.slice().reverse(), 'per-folder Z to A');
  ok(D.perFolder['04 Inner World/My Life/Topics'] === undefined, 'setFolderSort does not change the old object');
  s2 = S.setFolderSort(s2, '04 Inner World/My Life/Topics', null);
  ok(!('04 Inner World/My Life/Topics' in s2.perFolder), 'Use main setting removes the entry');
  eq(order('x', ['2026-01-02.md', '2026-01-01.md', 'b.md'], S.setFolderSort(main({}), 'x', 'oldest')), ['2026-01-01.md', '2026-01-02.md', 'b.md'], 'per-folder oldest first');
  const rn = S.renameSortPaths(D, '04 Inner World', '04 Inner Worlds');
  ok(rn.perFolder['04 Inner Worlds/Library Notes'] === 'az' && rn.newestFirstIn.includes('Journal') && !rn.perFolder['04 Inner World'], 'folder rename carries its settings');
  eq(S.folderDisplay('04 Inner World/Library Notes'), 'Inner World / Library Notes', 'display name');
  ok(/'Sort this folder'/.test(src) && /setSubmenu/.test(src) && /'Use main setting'/.test(src), 'right-click: Sort this folder menu');
  ok(/this\.menuOn\(row, folder, o\.fillWith \? \{ noSort: true \} : null\)/.test(src), 'Work/Personal project lists keep their own order (no sort menu)');
  ok(/onExternalSettingsChange/.test(src), 'synced settings from the phone are picked up');
  // 0.8.1 bug (2026-10-08 06:14): WiP set to Newest first listed its dated
  // work FOLDERS oldest first, because subfolders only followed the main switch.
  const wip = (sort) => S.sortChildren('03 WiP', ['2026-09-07 Summer Road Trip', '_archive', '2026-10-08-shelf-paint-colours', '2026-09-11-weekly-bread-notes', '2026-09-10 Garden Language Club'].map((name) => ({ name, isFolder: true })).concat([{ name: 'README.md', isFolder: false }, { name: '2026-10-06_garden-meeting-prep.md', isFolder: false }]), sort).map((x) => x.name);
  eq(wip(S.setFolderSort(D, '03 WiP', 'newest')), ['2026-10-08-shelf-paint-colours', '2026-09-11-weekly-bread-notes', '2026-09-10 Garden Language Club', '2026-09-07 Summer Road Trip', '_archive', '2026-10-06_garden-meeting-prep.md', 'README.md'], 'folder set to Newest first: its dated subfolders newest first, _archive after them, notes below');
  eq(wip(S.setFolderSort(D, '03 WiP', 'oldest')).slice(0, 5), ['2026-09-07 Summer Road Trip', '2026-09-10 Garden Language Club', '2026-09-11-weekly-bread-notes', '2026-10-08-shelf-paint-colours', '_archive'], 'Oldest first: subfolders oldest first, _archive after them');
  eq(wip(D).slice(0, 5), ['_archive', '2026-09-07 Summer Road Trip', '2026-09-10 Garden Language Club', '2026-09-11-weekly-bread-notes', '2026-10-08-shelf-paint-colours'], 'no own order + folders switch Off: folders A to Z as before');
  const jr = S.sortChildren('04 Inner World/Journal/2026', [{ name: '10', isFolder: true }, { name: '09', isFolder: true }], D).map((x) => x.name);
  eq(jr, ['09', '10'], 'Journal month folders (no date in the name) keep A to Z');
}

// 7. Bases button (0.9.0)
{
  eq([S.BASES_TOOL.id, S.BASES_TOOL.icon, S.BASES_TOOL.label], ['bases', 'database', 'Open a base'], 'bases: database icon, tooltip "Open a base"');
  eq(S.TOOLS.length, 4, 'bases: the four older buttons are unchanged');
  // the vault, read-only (the frozen copy unless A4_VAULT)
  const found = [];
  if (VAULT) {
  const walk = (d) => { for (const e of fs.readdirSync(path.join(VAULT, d), { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = d ? `${d}/${e.name}` : e.name; if (e.isDirectory()) walk(p); else found.push(p); } };
  walk('');
  const real = S.listBases(found);
  eq(real.map((b) => b.name), ['Companies', 'Documents', 'Library Notes', 'People', 'Places'], 'bases: the 5 real bases, A to Z');
  eq(real.map((b) => b.where), ['Contacts', 'Inner World', 'Inner World', 'Contacts', 'Guide'], 'bases: folder names as in the mockup');
  const tn = found.filter((p) => p.startsWith('02 Planner/TaskNotes/') && p.endsWith('.base'));
  ok(tn.length === 7, `bases: the 7 TaskNotes views are still in the vault (${tn.length})`);
  ok(!real.some((b) => b.path.startsWith('02 Planner/TaskNotes/')), 'bases: TaskNotes views left out of the list');
  }
  // new bases land in place; case does not split the list; non-bases ignored
  const syn = S.listBases(['b/Zoo.base', 'x/apple.base', 'Top.base', '03 WiP/Mid.base', 'a/notes.md', 'a/x.canvas', '02 Planner/TaskNotes/Views/kanban-default.base', 'z/Mid.base']);
  eq(syn.map((b) => b.name), ['apple', 'Mid', 'Mid', 'Top', 'Zoo'], 'bases: A to Z ignoring case; only .base files');
  eq(syn.map((b) => b.where), ['x', 'WiP', 'z', '', 'b'], 'bases: room number dropped; a base at the top level shows no folder');
  if (VAULT) eq(S.listBases(found.concat('04 Inner World/My Life/Health/Health.base')).map((b) => b.name), ['Companies', 'Documents', 'Health', 'Library Notes', 'People', 'Places'], 'bases: a new base appears in its A to Z place');
  eq(S.baseWhere('04 Inner World/Contacts/People/People.base', 'People'), 'Contacts', 'bases: named after its folder, shows the folder above');
  // wiring
  ok(/data-tool': BASES_TOOL\.id[\s\S]*?this\.plugin\.showBases\(bb\)[\s\S]*?const sectionIds/.test(src), 'bases: A4 tab button sits after the four tools, before collapse-all');
  ok(/attachTools\(ex\) \{[\s\S]*?for \(const t of TOOLS\)[\s\S]*?a4sb-files-tool', attr: \{ 'aria-label': BASES_TOOL\.label[\s\S]*?bar\.insertBefore\(bb, at\)/.test(src), 'bases: same button on the Files tab, after graph, removed with the others');
  ok(/showBases\(btn\) \{\s*const bases = listBases\(this\.app\.vault\.getFiles\(\)/.test(src), 'bases: list read from the vault on every click');
  ok(/menu\.setUseNativeMenu\(false\)/.test(src), "bases: Obsidian's own menu, so the folder names show");
  ok(/menu\.showAtPosition\(\{ x: r\.left, y: r\.bottom \+ 4 \}, btn\.ownerDocument\)/.test(src), "bases: menu drops down under the button, in the button's own window");
  ok(/setTitle\('Bases, A to Z'\)\.setDisabled\(true\)/.test(src), 'bases: arrow keys step over the title row');
  ok(/openBase\(path, e\) \{[\s\S]*?getLeaf\(\(e && !IS_MOBILE && Keymap\.isModEvent\(e\)\) \|\| false\)/.test(src), 'bases: Cmd-click opens a new tab');
}

console.log(`\n${n} checks, ${failed} failed`);
process.exit(failed ? 1 : 0);
