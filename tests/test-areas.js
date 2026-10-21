'use strict';
/* Areas (0.1.5, mockup approved 2026-10-18; GL-002 "Areas"). Logic checks on an in-memory vault
 * (no Obsidian): reading areas and parent_area, where areas never show (spec 1, 12), the area
 * page's counts, the Area choice, turning a project into an area and back (with exact Undo),
 * "+ Add area", the task project pickers, and the links Today and the Planner open (spec 10).
 * Drawing and clicks need a real Obsidian. `node tests/test-areas.js` */
const Module = require('module');
const { part } = require('./lib/paths');

class TFile { constructor(p) { this.path = p; this.name = p.split('/').pop(); this.basename = this.name.replace(/\.md$/, ''); this.extension = 'md'; } }
class TFolder { constructor(p) { this.path = p; this.children = []; } }
const notices = [];
const fakeObsidian = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile, TFolder, Notice: class { constructor(m) { notices.push(m); } }, setIcon() {}, Platform: {}, Component: class {}, Menu: class {}, stringifyYaml: (o) => Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n' };
const origLoad = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : origLoad.call(this, req, ...a); };
const P = part('a4-projects');
const L = P.logic; const TaskEngine = P.TaskEngine;

let n = 0; let failed = 0;
function ok(c, name, extra) { n++; if (!c) { failed++; console.log(`FAIL ${name}${extra ? ' :: ' + extra : ''}`); } }
function eq(a, b, name) { const x = JSON.stringify(a); const y = JSON.stringify(b); ok(x === y, name, `got ${x} want ${y}`); }

/* ---- in-memory vault -------------------------------------------------------- */
const TASKS = '02 Planner/TaskNotes/Tasks'; const ARCH = '02 Planner/TaskNotes/Archive'; const PROJ = '04 Library/My Life/Projects';
function makeVault(notes) {
  const files = new Map(); const fms = new Map();
  const folders = { [TASKS]: new TFolder(TASKS), [ARCH]: new TFolder(ARCH), [PROJ]: new TFolder(PROJ) };
  const add = (p, fm) => { const f = new TFile(p); files.set(p, f); fms.set(p, fm); const dir = p.slice(0, p.lastIndexOf('/')); if (folders[dir]) folders[dir].children.push(f); return f; };
  for (const [p, fm] of Object.entries(notes)) add(p, JSON.parse(JSON.stringify(fm))); // each check gets its own copy
  const app = {
    plugins: { plugins: {} },
    vault: {
      getAbstractFileByPath: (p) => folders[p] || files.get(p) || null,
      create: async (p, text) => { const f = add(p, { __text: text }); return f; },
    },
    metadataCache: {
      getFileCache: (f) => (fms.has(f.path) ? { frontmatter: fms.get(f.path), listItems: [] } : null),
      getFirstLinkpathDest: (link) => {
        const l = String(link).replace(/\.md$/, '');
        if (files.has(l + '.md')) return files.get(l + '.md');
        for (const f of files.values()) if (f.basename === l) return f;
        return null;
      },
    },
    fileManager: { processFrontMatter: async (f, fn) => { fn(fms.get(f.path)); } },
  };
  return { app, fms, files };
}
const PJ = (name) => `${PROJ}/${name}.md`;
const T = (name) => `${TASKS}/${name}.md`;
const task = (status, project, extra) => ({ status, priority: 'normal', tags: ['task'], ...(project ? { projects: [project] } : {}), ...extra });
function setup(notes) {
  const v = makeVault(notes);
  const engine = new TaskEngine({ app: v.app, settings: { tnSnapshot: null, archiveQueue: [] }, archiveQueueOnStatus: async () => false, cancelArchive: async () => {} });
  engine.now = () => new Date(2026, 9, 18, 10, 0, 0);
  const shown = [];
  const pl = Object.create(P.prototype);
  Object.assign(pl, { app: v.app, engine, toast: { show: (m, u) => shown.push({ m, u }) }, settings: { ui: { doneOpen: {} }, activity: [] } });
  pl.freshFm = async (f) => v.fms.get(f.path);
  return { ...v, engine, pl, shown };
}

const VAULT = {
  [PJ('Acme Co')]: { type: 'area', sphere: 'work', client: '[[Jane Doe]]', goal: '[[Grow]]' },
  [PJ('Home')]: { type: 'area', sphere: 'personal', parent_area: '[[Acme Co]]' }, // an area's own parent_area is ignored
  [PJ('Website redesign')]: { type: 'project', status: 'active', sphere: 'work', goal: '[[Grow]]', parent_area: `[[${PROJ}/Acme Co]]` },
  [PJ('Newsletter')]: { type: 'project', status: 'waiting', sphere: 'work', goal: '[[Grow]]', parent_area: '[[Acme Co|the client]]' },
  [PJ('Logo refresh')]: { type: 'project', status: 'done', sphere: 'work', goal: '[[Grow]]', end_date: '2026-09-12', parent_area: '[[Acme Co]]' },
  [PJ('Tax return')]: { type: 'project', status: 'active', sphere: 'work', goal: '[[Grow]]' },
  [PJ('Old one')]: { type: 'project', status: 'active', sphere: 'work', goal: '[[Grow]]', parent_area: '[[Gone client]]' },
  [PJ('Wrong kind')]: { type: 'project', status: 'paused', sphere: 'personal', goal: '[[Grow]]', parent_area: '[[Tax return]]' },
  [PJ('Shed')]: { type: 'project', status: 'idea', sphere: 'personal' },
  [T('Send the invoice')]: task('open', `[[${PROJ}/Acme Co]]`, { due: '2026-10-17' }),
  [T('Reply to quote')]: task('open', '[[Acme Co]]'),
  [T('Renew domain')]: task('done', '[[Acme Co]]'),
  [T('Pick photos')]: task('open', `[[${PROJ}/Website redesign]]`),
  [T('Loose thought')]: task('open'),
};

/* ---- 1. reading ----------------------------------------------------------------- */
{
  const { engine } = setup(VAULT);
  const { projects, areas } = engine.collectNotes();
  eq(areas.map((a) => a.name).sort(), ['Acme Co', 'Home'], 'areas: type: area notes in the projects folder');
  ok(!projects.some((p) => p.name === 'Acme Co' || p.name === 'Home'), 'areas are never in the project list');
  const by = (nm) => projects.find((p) => p.name === nm);
  eq([by('Website redesign').area, by('Website redesign').areaPath], ['Acme Co', PJ('Acme Co')], 'parent_area as a full-path link');
  eq(by('Newsletter').areaName, 'Acme Co', 'parent_area with an alias');
  eq([by('Old one').area, by('Old one').areaBad], [undefined, 'Gone client'], 'a missing area note: no area, its text kept for the page');
  eq([by('Wrong kind').area, by('Wrong kind').areaBad], [undefined, 'Tax return'], 'a link to a project is not an area');
  eq(by('Tax return').area, undefined, 'no parent_area: no area');
  const acme = areas.find((a) => a.name === 'Acme Co');
  eq([acme.sphere, acme.client, acme.goal, acme.parentArea], ['work', '[[Jane Doe]]', '[[Grow]]', undefined], 'an area reads sphere, client and goal; areas do not nest');
  eq(L.readArea({ type: 'area' }, 'x.md', 'x').sphere, 'unsorted', 'an area with no sphere is unsorted');
  eq([L.readProject({ type: 'project', parent_area: '' }, 'x.md', 'x').parentArea, L.readProject({ type: 'project', parent_area: [] }, 'x.md', 'x').parentArea, L.readProject({ type: 'project', parent_area: ['', '[[A]]'] }, 'x.md', 'x').parentArea], [null, null, '[[A]]'], "an empty parent_area ('' or []) is no area");
  ok(L.applyToArea({ type: 'project', status: 'active', parent_area: '' }), 'an empty parent_area does not block Turn into an area');
  ok(L.readArea({ type: 'project' }, 'x.md', 'x') === null && L.readProject({ type: 'area' }, 'x.md', 'x') === null, 'project and area readers keep to their own type');
  ok(!P.prototype.isOpenProjectNote.call(null, { type: 'area', sphere: 'work' }), "the Sidebar's open-project rule never counts an area");
}

/* ---- 2. where areas never show (spec 1, 12) ------------------------------------------ */
{
  const { engine } = setup(VAULT);
  const { projects } = engine.collectNotes();
  const names = (l) => l.map((p) => p.name);
  ok(!L.overviewGroups(projects, 'all', '', null).flatMap((g) => names(g.projects)).includes('Acme Co'), 'not in the Work / Personal lists');
  ok(!projects.filter((p) => L.onBoard(p)).some((p) => p.isArea), 'not on the board');
  ok(!names(L.closedProjects(projects, '', null)).includes('Acme Co'), 'not in Closed');
  ok(projects.filter((p) => p.status === 'idea' || p.status === 'cold-storage').every((p) => !p.isArea), 'not in Ideas or Cold Storage');
  const cfg = engine.cfg();
  const tasks = engine.collectTasks(true);
  const inbox = tasks.filter((t) => L.isInboxTask(t, cfg)).map((t) => t.title);
  eq(inbox, ['Loose thought'], 'a task in an area is not in the Inbox (spec 10)');
}

/* ---- 3. the Projects list and the area page's counts (spec 2, 3) -------------------- */
{
  const { engine } = setup(VAULT);
  const { projects, areas } = engine.collectNotes();
  eq(L.areaList(areas, '', 'work').map((a) => a.name), ['Acme Co'], 'Areas follow the Work / Personal filter');
  eq(L.areaList(areas, 'hom', null).map((a) => a.name), ['Home'], 'Areas follow the search');
  const cfg = engine.cfg(); const tasks = engine.collectTasks(true);
  const st = L.areaStats(areas.find((a) => a.name === 'Acme Co'), projects, tasks, '2026-10-18', cfg);
  eq(st.openProjects.map((p) => p.name), ['Website redesign', 'Newsletter'], 'open projects inside, active before waiting');
  eq(st.closedProjects.map((p) => p.name), ['Logo refresh'], 'finished projects inside');
  eq([st.open, st.overdue, st.done, st.total], [2, 1, 1, 3], "loose tasks only: a project's own task is not the area's");
  eq(st.inside, ['Website redesign', 'Newsletter', 'Logo refresh'], 'inside names every project that points to it (Turn back is refused, and names them)');
  eq(st.next.title, 'Send the invoice', 'next loose task: overdue first');
}

/* ---- 4. Today and Planner links open the area's page (spec 10) ---------------------- */
{
  const { pl } = setup(VAULT);
  eq(pl.projectPathFor('[[Acme Co]]'), PJ('Acme Co'), 'a task label naming an area finds its page');
  eq(pl.projectPathFor(`[[${PROJ}/Acme Co]]`), PJ('Acme Co'), 'a full-path link too');
  eq(pl.projectPathFor('Website redesign'), PJ('Website redesign'), 'projects as before');
  const ix = pl.areaIndex();
  eq(ix.of, { 'Acme Co': 'Acme Co', Home: 'Home', 'Website redesign': 'Acme Co', Newsletter: 'Acme Co', 'Logo refresh': 'Acme Co' }, "areaIndex: which area each project or area is in (the Planner's Group by: Area)");
}

/* ---- 5. tasks board and pickers (spec 9, 10) ------------------------------------------ */
{
  const { engine } = setup(VAULT);
  const n = engine.collectNotes(); const notes = [...n.projects, ...n.areas];
  const cfg = engine.cfg(); const tasks = engine.collectTasks(true);
  const rows = L.taskBoardRows(tasks, notes, cfg, 'work', '');
  const inv = rows.find((x) => x.t.title === 'Send the invoice');
  ok(inv && inv.p && inv.p.name === 'Acme Co', 'tasks board: a loose task carries its area and its Work filter');
  ok(!L.taskBoardRows(tasks, notes, cfg, 'personal', '').some((x) => x.t.title === 'Send the invoice'), "tasks board: not under the other side's filter");
  eq(L.taskBoardRows(tasks, notes, cfg, null, 'acme').map((x) => x.t.title).sort(), ['Renew domain', 'Reply to quote', 'Send the invoice'], 'tasks board search finds an area by name (Done column too)');
  const g = L.projectPickGroups(notes, '', L.isOpenProject, (a, b) => a.name.localeCompare(b.name));
  eq(g.map((x) => [x.label, x.notes.map((p) => (p.isArea ? `area:${p.name}` : p.name))]), [
    ['Areas', ['area:Acme Co', 'area:Home']],
    ['Projects', ['Newsletter', 'Old one', 'Tax return', 'Website redesign', 'Wrong kind']],
  ], 'pickers: all areas first under Areas, then the open projects under Projects');
  eq(L.projectPickGroups(notes, 'acm', L.isOpenProject, () => 0).map((x) => x.notes.map((p) => p.name)), [['Acme Co']], 'pickers: the search finds areas');
}

/* ---- 6. the Area choice (spec 6) ------------------------------------------------------ */
(async () => {
  {
    const { pl, fms, shown } = setup(VAULT);
    const fm = fms.get(PJ('Tax return'));
    ok(await pl.setProjectArea(PJ('Tax return'), PJ('Acme Co')), 'Area choice: written');
    eq(fm.parent_area, `[[${PROJ}/Acme Co]]`, 'Area choice: a full-path link, as task links are written');
    ok(typeof shown[0].u === 'function' && shown[0].m === 'Area: Acme Co', 'Area choice: toast with Undo');
    await shown[0].u();
    ok(!('parent_area' in fm), 'Undo takes it off again');
    ok(!(await pl.setProjectArea(PJ('Tax return'), null)), 'No area on a project in none: nothing to do');
    const nb = fms.get(PJ('Old one'));
    ok(await pl.setProjectArea(PJ('Old one'), null) && !('parent_area' in nb), 'No area removes a link that is not an area');
    notices.length = 0;
    ok(!(await pl.setProjectArea(PJ('Tax return'), PJ('Website redesign'))) && notices.length === 1, 'a project is refused as an area');
  }

  /* ---- 7. turn into an area and back (spec 14) ---------------------------------------- */
  {
    const { pl, fms, shown, engine } = setup(VAULT);
    const before = JSON.stringify(fms.get(PJ('Tax return')));
    fms.get(PJ('Tax return')).end_date = '2026-01-01';
    const withEnd = JSON.stringify(fms.get(PJ('Tax return')));
    ok(await pl.turnIntoArea(PJ('Tax return')), 'Turn into an area: done');
    eq(fms.get(PJ('Tax return')), { type: 'area', sphere: 'work', goal: '[[Grow]]' }, 'type area; status and end_date gone; the rest kept');
    ok(engine.collectAreas().some((a) => a.name === 'Tax return'), 'it reads as an area now');
    await shown[0].u();
    eq(JSON.stringify(fms.get(PJ('Tax return'))), withEnd, 'Undo restores the note exactly, key order included');
    ok(before !== withEnd, '(the check above had something to restore)');
    notices.length = 0;
    ok(!(await pl.turnIntoArea(PJ('Website redesign'))) && notices.length === 1, 'refused for a project inside an area');
    ok(!(await pl.turnIntoProject(PJ('Acme Co'))), 'Turn back refused while a project is inside');
    fms.get(PJ('Home')).goal = '[[Grow]]';
    ok(await pl.turnIntoProject(PJ('Home')), 'Turn back: an area with no project inside');
    eq([fms.get(PJ('Home')).type, fms.get(PJ('Home')).status, fms.get(PJ('Home')).goal], ['project', 'active', '[[Grow]]'], 'back to an Active project, its goal kept');
  }
  {
    const { pl, fms } = setup(VAULT);
    pl.goalFiles = () => [{ basename: 'Grow' }];
    pl.pickGoal = async () => ({ basename: 'Grow' });
    ok(await pl.turnIntoProject(PJ('Home')) && fms.get(PJ('Home')).goal === '[[Grow]]', 'Turn back asks for a goal when the area has none (GL-002)');
    pl.pickGoal = async () => null;
    fms.get(PJ('Home')).type = 'area'; delete fms.get(PJ('Home')).goal;
    ok(!(await pl.turnIntoProject(PJ('Home'))) && fms.get(PJ('Home')).type === 'area', 'no goal picked: nothing changes');
  }
  {
    // A later hand edit wins over Undo.
    const { pl, fms, shown } = setup(VAULT);
    await pl.turnIntoArea(PJ('Tax return'));
    fms.get(PJ('Tax return')).why = 'typed later';
    notices.length = 0;
    ok(!(await shown[0].u()) && fms.get(PJ('Tax return')).type === 'area' && notices.length === 1, 'Undo leaves a note changed again since');
  }

  /* ---- 8. + Add area (spec 5) ------------------------------------------------------------ */
  {
    const { pl, fms } = setup(VAULT);
    eq(L.areaNote('Northwind', 'work', ' [[Jane: Doe]] ', '2026-10-18', fakeObsidian.stringifyYaml), '---\ntype: area\ncreated: 2026-10-18\nsphere: work\nclient: "[[Jane: Doe]]"\n---\n\n# Northwind\n', 'the note: type area, sphere, client through the YAML writer');
    eq(L.areaNote('Home', 'personal', '', '2026-10-18', fakeObsidian.stringifyYaml), '---\ntype: area\ncreated: 2026-10-18\nsphere: personal\n---\n\n# Home\n', 'no client: no client line');
    notices.length = 0;
    ok((await pl.createArea({ name: 'acme co', sphere: 'work' })) === null && /already a project or area called "Acme Co"/.test(notices[0]), 'a name in use (any case) is refused; the form stays open');
    ok((await pl.createArea({ name: 'x', sphere: '' })) === null, 'no side chosen: nothing made');
    const f = await pl.createArea({ name: 'Northwind  Bakery', sphere: 'work', client: 'Jane Doe' });
    ok(f && f.path === PJ('Northwind Bakery') && /type: area/.test(fms.get(f.path).__text), 'one area note in the projects folder');
  }

  /* ---- 9. Planner: Group by Area (spec 11) ----------------------------------------------- */
  {
    const { pl, engine } = setup(VAULT);
    const PL = part('a4-planner').logic;
    const ix = pl.areaIndex();
    const items = engine.collectTasks(false).map((t) => ({ ...t, projectKey: t.projectKey }));
    const table = PL.priorityTable(null);
    const open = items.filter((t) => t.status === 'open');
    const g = PL.groupByArea(open, table, ix);
    eq(g.map((x) => [x.label, x.area, x.items.map((t) => t.title)]), [
      ['Acme Co', 'Acme Co', ['Pick photos', 'Reply to quote', 'Send the invoice']],
      ['No area', null, ['Loose thought']],
    ], "by area: an area's loose tasks and its projects' tasks together, A to Z, then No area");
    ok(g.every((x) => x.key.startsWith('§area')), 'area group fold keys never meet a project name');
    eq(PL.groupUnscheduled(open, table).map((x) => x.label), ['Acme Co', 'Website redesign', 'No project'], 'by project: as before (an area is one more group)');
    const empty = PL.groupByArea(open, table, { areas: [], of: {} });
    eq(empty.map((x) => x.label), ['No area'], 'no areas yet: everything under No area');
  }

  /* ---- 10. Sidebar: that side's areas first (spec 13) ------------------------------------- */
  {
    const { app } = setup(VAULT);
    const S = part('a4-sidebar').__logic;
    const view = Object.create(S.SidebarView.prototype);
    view.app = app; view.folder = (p) => app.vault.getAbstractFileByPath(p);
    eq(view.areasOf('work').map((f) => f.basename), ['Acme Co'], 'Work: its areas');
    eq(view.areasOf('personal').map((f) => f.basename), ['Home'], 'Personal: its areas');
    const fs = require('fs'); const src = fs.readFileSync(require('./lib/paths').source('a4-sidebar'), 'utf8');
    ok(/for \(const m of (?:\/\*\* @type \{[^\n]*?\} \*\/ \()?\[\.\.\.areas\.map\(\(file\) => \(\{ file, area: true \}\)\), \.\.\.members\]\)/.test(src), 'areas are listed before the projects');
    ok(/count: openProjectCount\(members\)/.test(src), 'the count stays open projects only');
  }

  console.log(`${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
