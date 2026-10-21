// Where tasks live (launch sections 5 and 5b): checkbox lines with the Tasks plugin's signs, and
// Todoist, ClickUp and Things 3 against stand-in answers. No real account is called: the web answers
// are made up here from each service's documented shapes (read 2026-10-19), and Things' AppleScript
// runs against a stand-in for macOS. Keys are checked to stay in local storage and out of every log.
'use strict';
const assert = require('assert');
const path = require('path');
const Module = require('module');

let n = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const ok = (v, m) => { assert.ok(v, m); n++; };

// ---- an Obsidian stand-in the bundle below uses (requestUrl, Platform, TFile, moment) ----
class TFile { constructor(p) { this.path = p; this.extension = 'md'; this.basename = p.split('/').pop().replace(/\.md$/, ''); } }
const web = { calls: [], answer: null };
const Platform = { isMacOS: false, isDesktopApp: true, isMobile: false };
const ob = { TFile, Platform, moment: require('moment'), requestUrl: async (r) => { web.calls.push(r); return web.answer(r); } };
const ld = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? ob : ld.call(this, req, ...a); };

// The sources and the vault settings in one bundle, so they share one `planning` object.
const ROOT = path.join(__dirname, '..');
const code = require('esbuild').buildSync({ stdin: { contents: "export * from './src/core/sources'; export { planning, setVault } from './src/core/vault';", resolveDir: ROOT, loader: 'js' }, bundle: true, format: 'cjs', platform: 'node', external: ['obsidian'], write: false, logLevel: 'error' }).outputFiles[0].text;
const m = new Module(path.join(ROOT, 'sources-bundle.js')); m.paths = Module._nodeModulePaths(ROOT); m._compile(code, m.id);
const S = m.exports;

(async () => {
  // ---- parsing (Tasks Emoji Format) ----
  const p = S.parseCheckbox('- [ ] Call the plumber ⏫ 🔁 every week 📅 2026-10-20 ⏳ 2026-10-19 🛫 2026-10-18 ➕ 2026-10-01 ^abc1');
  eq([p.title, p.open, p.due, p.scheduled, p.start, p.created, p.priority, p.repeat, p.blockId], ['Call the plumber', true, '2026-10-20', '2026-10-19', '2026-10-18', '2026-10-01', 'high', 'every week', 'abc1'], 'Tasks signs: dates, priority, repeat, block id read; the words stop at the first sign');
  eq(S.parseCheckbox('  * [x] Done thing ✅ 2026-10-18').open, false, 'a ticked line is not open');
  eq([S.parseCheckbox('- [-] Dropped').open, S.parseCheckbox('- [ ] Dropped ❌ 2026-10-18').open, S.parseCheckbox('- [/] Half way').open], [false, false, true], 'cancelled ([-] or ❌) is not open; in progress ([/]) is');
  eq(S.parseCheckbox('1. [ ] Numbered 📅️ 2026-10-20').due, '2026-10-20', 'numbered list and the emoji variation selector');
  eq([S.parseCheckbox('- [ ] '), S.parseCheckbox('- [ ] 📅 2026-10-20'), S.parseCheckbox('just text'), S.parseCheckbox('- [] no')], [null, null, null, null], 'empty or not a checkbox: not a task');
  eq([S.parseCheckbox('- [ ] a 🔺').priority, S.parseCheckbox('- [ ] a 🔽').priority, S.parseCheckbox('- [ ] a').priority], ['highest', 'low', ''], 'priorities');
  eq(S.parseCheckbox('> - [ ] In a quote').title, 'In a quote', 'a checkbox inside a quote');

  // ---- writing signs ----
  eq(S.setDateSign('- [ ] a', 'due', '2026-10-20'), '- [ ] a 📅 2026-10-20', 'due added');
  eq(S.setDateSign('- [ ] a 📅 2026-10-01 #x', 'due', '2026-10-20'), '- [ ] a 📅 2026-10-20 #x', 'due replaced in place');
  eq(S.setDateSign('- [ ] a ^id9', 'scheduled', '2026-10-20'), '- [ ] a ⏳ 2026-10-20 ^id9', 'a new sign goes before the block id');
  eq(S.setDateSign('- [ ] a 📅 2026-10-01 b', 'due', null), '- [ ] a b', 'due taken off');
  eq(S.toggleCheckboxLine('- [ ] a 📅 2026-10-20', '2026-10-19'), '- [x] a 📅 2026-10-20 ✅ 2026-10-19', 'tick without the Tasks plugin: [x] and ✅ today');
  eq(S.toggleCheckboxLine('- [x] a ✅ 2026-10-19', '2026-10-19'), '- [ ] a', 'untick takes the ✅ date off');
  eq(S.toggleCheckboxLine('    - [ ] nested 🔁 every day', '2026-10-19'), '    - [x] nested 🔁 every day ✅ 2026-10-19', 'indent kept; a repeat is not rolled forward (stated limit)');
  eq([S.cleanTag(' #task '), S.cleanTag('task'), S.cleanTag(''), S.cleanTag('two words')], ['#task', '#task', '', ''], 'the tag box');
  eq([S.hasTag('a #task b', '#task'), S.hasTag('a #tasks', '#task'), S.hasTag('a #Task.', '#task'), S.hasTag('a', '')], [true, false, true, true], 'tag matching: whole tag, any case; no tag = every line');
  eq(S.newCheckboxLine({ title: ' Buy  milk ', day: '2026-10-20', project: 'Home', tag: '#task', plan: false }), '- [ ] Buy milk [[Home]] #task 📅 2026-10-20', 'a new line: project link, tag, 📅');
  eq(S.newCheckboxLine({ title: 'x', day: '2026-10-20', plan: true }), '- [ ] x ⏳ 2026-10-20', '"Just plan it": ⏳');

  // ---- items: placement follows Settings › Planning (criterion 23) ----
  const a = S.extItem({ source: 'checkbox', id: 'n.md:3', title: 't', due: '2026-10-25', scheduled: '2026-10-20' });
  eq([a.path, a.due, a.plannedDay, a.time, a.status], ['checkbox:n.md:3', '2026-10-25', '2026-10-25', null, 'open'], '"Set its due date": the due day places it');
  S.planning.setsDue = false;
  eq(S.extItem({ source: 'checkbox', id: 'x', title: 't', due: '2026-10-25', scheduled: '2026-10-20' }).plannedDay, '2026-10-20', '"Just plan it": the ⏳ day places it');
  S.planning.setsDue = true;
  const timed = S.extItem({ source: 'todoist', id: '1', title: 't', due: '2026-10-19T15:30' });
  eq([timed.time, timed.plannedHalf], ['15:30', 'pm'], 'a time picks the half (criterion 27)');
  eq(S.extItem({ source: 'todoist', id: '2', title: 't', due: '2026-10-19' }).plannedHalf, null, 'no time: Morning on Today, as untimed tasks');
  eq([S.isExtPath('todoist:1'), S.isExtPath('Tasks/a.md')], [true, false], 'a source task is told from a task note');

  // ---- service answers -> items ----
  eq(S.fromTodoist({ id: 'A1', content: 'Pay rent', due: { date: '2026-10-19', is_recurring: true }, priority: 1 }).repeats, true, 'Todoist: a recurring task shows as repeating');
  eq([4, 3, 2, 1].map((priority) => S.fromTodoist({ id: 'P', content: 'p', priority }).priority), ['high', 'high', '', ''], 'Todoist: 4 (urgent, the app\'s p1) and 3 are high; 1 is normal (review r1 #1)');
  eq(S.parseCheckbox('- [ ] Windows note 📅 2026-10-20\r').title, 'Windows note', 'a line with a Windows line ending is still a task (review r1 #10)');
  eq([S.setDateSign('- [ ] Win  \r', 'due', '2026-10-21'), S.setDateSign('- [ ] Win ^b1\r', 'due', '2026-10-21')], ['- [ ] Win 📅 2026-10-21\r', '- [ ] Win 📅 2026-10-21 ^b1\r'], 'a date added to a Windows-ending line keeps its line ending (review r2)');
  eq(S.fromTodoist({ id: 'A2', content: 'Call', due: { date: '2026-10-19T09:15:00' } }).time, '09:15', 'Todoist: a floating time is the wall-clock time');
  const z = new Date('2026-10-19T15:00:00Z');
  eq(S.fromTodoist({ id: 'A3', content: 'z', due: { date: '2026-10-19T15:00:00Z' } }).time, `${String(z.getHours()).padStart(2, '0')}:00`, 'Todoist: a fixed-zone time becomes local time');
  const cu = S.fromClickUp({ id: 'c9', name: 'Ship', due_date: String(new Date(2026, 9, 19, 14, 30).getTime()), due_date_time: true, status: { status: 'to do', type: 'open' }, list: { id: 7 }, url: 'https://app.clickup.com/t/c9' });
  eq([cu.due, cu.time, cu.status, cu.ext.list], ['2026-10-19', '14:30', 'open', '7'], 'ClickUp: Unix ms due date, its time when due_date_time, its list');
  eq(S.fromClickUp({ id: 'c8', name: 'x', due_date: String(new Date(2026, 9, 18, 12).getTime()), due_date_time: false, status: { type: 'closed' } }).status, 'done', 'ClickUp: a closed status is done');
  const th = S.parseThings('id1\u001fBuy bread\u001fopen\u001f2026-10-21\u001f2026-10-19\u001fGroceries\u001eid2\u001fOld\u001fcompleted\u001f\u001f\u001f\u001e').map(S.fromThings);
  eq(th.map((x) => [x.title, x.due, x.plannedDay, x.project, x.status]), [['Buy bread', '2026-10-21', '2026-10-21', 'Groceries', 'open'], ['Old', null, null, null, 'done']], 'Things: the script\'s rows become items');

  // ---- the checkbox source on a stand-in vault ----
  const files = {
    'Projects/Home.md': '# Home\n- [ ] Fix the gate 📅 2026-10-19\n- [x] Old one ✅ 2026-10-01\n',
    'Notes/Errands.md': 'text\n- [ ] Buy paint [[Home]] #task\n- [ ] Loose task\n- [ ] Repeating 🔁 every day 📅 2026-10-18\n',
    'Templates/Daily.md': '- [ ] \n- [ ] Template task\n',
  };
  const events = {}; const fired = [];
  const vault = {
    getMarkdownFiles: () => Object.keys(files).map((x) => new TFile(x)),
    getAbstractFileByPath: (x) => (files[x] !== undefined ? new TFile(x) : (x.includes('.') ? null : { path: x })),
    cachedRead: async (f) => files[f.path], read: async (f) => files[f.path],
    process: async (f, fn) => { files[f.path] = fn(files[f.path]); },
    create: async (x, c) => { files[x] = c; return new TFile(x); }, createFolder: async () => {},
    on: (e, fn) => { events[e] = fn; return e; }, offref() {},
  };
  const app = {
    vault,
    metadataCache: { on: (e, fn) => { events[`mc:${e}`] = fn; return e; }, offref() {}, getFileCache: () => ({ listItems: [{ task: ' ' }] }), getFirstLinkpathDest: (l) => (l === 'Home' ? new TFile('Projects/Home.md') : null) },
    workspace: { onLayoutReady: (fn) => fn(), trigger: (e) => fired.push(e), getLeaf: () => ({ openFile() {} }) },
    internalPlugins: { getEnabledPluginById: (id) => (id === 'templates' ? { options: { folder: 'Templates' } } : id === 'daily-notes' ? { options: { folder: 'Days', format: 'YYYY-MM-DD', template: '' } } : null) },
    plugins: { plugins: {} },
  };
  const plugin = { app, settings: { cbTag: '' }, projectNoteKeys: () => new Map([['Projects/Home.md', 'Home']]) };
  const cb = new S.CheckboxSource(plugin);
  await new Promise((r) => setTimeout(r, 10));
  let items = cb.items();
  const by = (t) => items.find((x) => x.title === t);
  eq(items.map((x) => x.title).sort(), ['Buy paint #task', 'Fix the gate', 'Loose task', 'Old one', 'Repeating'], 'every checkbox line with words, anywhere; the Templates folder is left out (criterion 18)');
  eq([by('Fix the gate').project, by('Buy paint #task').project, by('Loose task').project], ['Home', 'Home', null], 'a line in a project note, or linking to one, is that project\'s task (criterion 24)');
  eq([by('Old one').status, by('Repeating').repeats, by('Fix the gate').plannedDay], ['done', true, '2026-10-19'], 'done lines are done; 🔁 shows as repeating; 📅 places it');
  plugin.settings.cbTag = '#task';
  items = cb.items();
  eq(items.map((x) => x.title), ['Buy paint'], 'with "Only lines with this tag": only tagged lines, the tag left out of the name (criterion 18)');
  plugin.settings.cbTag = '';
  items = cb.items();
  // Tick without the Tasks plugin
  await cb.toggle(by('Loose task'), '2026-10-19');
  ok(files['Notes/Errands.md'].includes('- [x] Loose task ✅ 2026-10-19'), 'tick without the Tasks plugin: [x] and ✅ (criterion 20)');
  // Tick with the Tasks plugin: its own toggle, a repeat gets its next copy
  const asked = [];
  app.plugins.plugins['obsidian-tasks-plugin'] = { apiV1: { executeToggleTaskDoneCommand: (line, p0) => { asked.push([line, p0]); return '- [ ] Repeating 🔁 every day 📅 2026-10-19\n- [x] Repeating 🔁 every day 📅 2026-10-18 ✅ 2026-10-19'; } } };
  await cb.toggle(by('Repeating'), '2026-10-19');
  eq(asked, [['- [ ] Repeating 🔁 every day 📅 2026-10-18', 'Notes/Errands.md']], 'with the Tasks plugin on: its own toggle gets the line and the note');
  ok(files['Notes/Errands.md'].endsWith('- [ ] Repeating 🔁 every day 📅 2026-10-19\n- [x] Repeating 🔁 every day 📅 2026-10-18 ✅ 2026-10-19\n'), 'its two lines (the next copy) replace the one');
  delete app.plugins.plugins['obsidian-tasks-plugin'];
  // The note changed meanwhile: found by its text; gone: a plain message, nothing written
  cb.index(new TFile('Notes/Errands.md'), files['Notes/Errands.md']);
  items = cb.items();
  const paint = by('Buy paint #task');
  files['Notes/Errands.md'] = 'new first line\n' + files['Notes/Errands.md'];
  await cb.place(paint, '2026-10-22');
  ok(files['Notes/Errands.md'].includes('- [ ] Buy paint [[Home]] #task 📅 2026-10-22'), 'a line that moved down is still found by its text; "Set its due date" writes 📅 (criterion 23)');
  S.planning.setsDue = false;
  cb.index(new TFile('Notes/Errands.md'), files['Notes/Errands.md']); items = cb.items();
  await cb.place(by('Buy paint #task'), '2026-10-23');
  ok(files['Notes/Errands.md'].includes('📅 2026-10-22 ⏳ 2026-10-23'), '"Just plan it" writes ⏳ and keeps 📅');
  S.planning.setsDue = true;
  const before = files['Notes/Errands.md'];
  let msg = '';
  try { await cb.place({ ...paint, ext: { ...paint.ext, text: '- [ ] not there', line: 0 } }, '2026-10-24'); } catch (e) { msg = e.plain; }
  eq([msg, files['Notes/Errands.md']], ['That line changed since the page was drawn. Try again.', before], 'a line that is gone: a plain message, the note untouched');
  // New task: under "Tasks" in that day's daily note, made when missing (criterion 22)
  await cb.create({ title: 'Water plants', day: '2026-10-20', project: 'Home' });
  eq(files['Days/2026-10-20.md'], '## Tasks\n\n- [ ] Water plants [[Home]] 📅 2026-10-20\n', 'a new checkbox task: its day\'s daily note, under Tasks');
  await cb.create({ title: 'Second', day: '2026-10-20' });
  eq(files['Days/2026-10-20.md'], '## Tasks\n\n- [ ] Water plants [[Home]] 📅 2026-10-20\n- [ ] Second 📅 2026-10-20\n', 'the next one joins the same list');
  // Live changes: Obsidian's changed event re-reads one note
  events['mc:changed'](new TFile('Notes/New.md'), '- [ ] Fresh one');
  ok(cb.items().some((x) => x.title === 'Fresh one') && fired.includes('lifeworld:tasks'), 'a changed note is read again and the pages are told');

  // ---- keys: local storage only, never logged ----
  const store = {};
  const logs = [];
  const cw = console.warn; const ce = console.error; const cl = console.log;
  console.warn = console.error = console.log = (...x) => logs.push(x.map(String).join(' '));
  const rapp = { workspace: { trigger: (e) => fired.push(e) }, loadLocalStorage: (k) => (k in store ? store[k] : null), saveLocalStorage: (k, v) => { if (v == null) delete store[k]; else store[k] = v; } };
  try {
    const td = new S.TodoistSource({ app: rapp, settings: {} });
    await td.refresh();
    eq(td.status().error, 'Paste your Todoist key in Settings › LifeWorld › Tasks to see your tasks here.', 'no key: a plain message, no call');
    eq(web.calls.length, 0, 'no key: nothing sent');
    S.setKey(rapp, 'todoist', '  secret-todoist-123 ');
    eq([store['lifeworld-key-todoist'], S.keyOf(rapp, 'todoist')], ['secret-todoist-123', 'secret-todoist-123'], 'the key is kept in local storage only (criterion 29)');
    const pages = [{ results: [{ id: 'T1', content: 'Pay rent', due: { date: '2026-10-19' } }], next_cursor: 'c2' }, { results: [{ id: 'T2', content: 'Late', due: { date: '2026-10-10T08:00:00' } }], next_cursor: null }];
    web.answer = (r) => ({ status: 200, json: pages.shift() });
    await td.refresh();
    eq([td.status().error, td.items().map((x) => [x.title, x.plannedDay, x.time])], ['', [['Pay rent', '2026-10-19', null], ['Late', '2026-10-10', '08:00']]], 'Todoist: today and overdue, every page');
    ok(web.calls[0].url.startsWith('https://api.todoist.com/api/v1/tasks/filter?query=today%20%7C%20overdue') && web.calls[0].headers.Authorization === 'Bearer secret-todoist-123', 'Todoist: the filter call with the key as a Bearer header');
    web.calls.length = 0;
    web.answer = (r) => ({ status: 200, json: r.url.includes('/filter') ? { results: [], next_cursor: null } : null });
    eq(await td.toggle(td.items()[0]), true, 'Todoist: a tick');
    eq([web.calls[0].method, web.calls[0].url], ['POST', 'https://api.todoist.com/api/v1/tasks/T1/close'], 'Todoist: a tick closes it there (criterion 25)');
    web.calls.length = 0;
    await td.place({ ext: { id: 'T2' }, time: '08:00' }, '2026-10-21');
    eq(JSON.parse(web.calls[0].body), { due_datetime: '2026-10-21T08:00:00' }, 'Todoist: placing on a day sets its due date there, keeping its time');
    web.calls.length = 0;
    let rmsg = '';
    try { await td.place({ title: 'Pay rent', ext: { id: 'T9', recurring: true } }, '2026-10-21'); } catch (e) { rmsg = e.plain; }
    eq([rmsg, web.calls.length], ['"Pay rent" repeats in Todoist. Move it there to keep its repeat.', 0], 'Todoist: a repeating task is not given a plain date (that would end its repeat) (review r1 #8)');
    td.batch = true;
    await td.place({ ext: { id: 'T2' } }, '2026-10-21'); await td.place({ ext: { id: 'T3' } }, '2026-10-21');
    td.batch = false; await td.reload();
    eq(web.calls.filter((c) => c.url.includes('/filter')).length, 1, 'many moves in a row: one list fetch at the end (review r1 #9)');
    web.calls.length = 0;
    let release; const slow = new Promise((r) => { release = r; });
    const realAnswer = web.answer;
    web.answer = (r) => (r.url.includes('/filter') && !release.done ? slow.then(() => { release.done = true; return realAnswer(r); }) : realAnswer(r));
    const early = td.refresh();
    const write = td.toggle({ status: 'open', ext: { id: 'T1' } });
    await new Promise((r) => setTimeout(r, 5)); // the write is done while the first fetch still runs
    release(); await early; await write;
    eq(web.calls.filter((c) => c.url.includes('/filter')).length, 2, 'a write during a fetch fetches again after it, so the tick shows (review r1 #13)');
    web.answer = realAnswer;
    web.calls.length = 0;
    await td.create({ title: 'New one', day: '2026-10-20' });
    eq([web.calls[0].url, JSON.parse(web.calls[0].body)], ['https://api.todoist.com/api/v1/tasks', { content: 'New one', due_date: '2026-10-20' }], 'Todoist: a task added in LifeWorld is created there');
    // errors: wrong key, rate limit, no internet (criterion 28)
    for (const [status, want] of [[401, 'Todoist did not accept your key. Paste it again in Settings › LifeWorld › Tasks.'], [429, 'Todoist asked LifeWorld to slow down. Your tasks come back in a minute.']]) {
      web.answer = () => ({ status, json: null });
      td.fetched = 0; await td.refresh();
      eq(td.status().error, want, `Todoist ${status}: a short plain message`);
    }
    web.answer = () => { throw new Error('offline'); };
    td.fetched = 0; await td.refresh();
    eq(td.status().error, 'Could not reach Todoist. Check the internet connection; nothing was lost.', 'no internet: a short plain message');
    eq(td.items().length, 0, 'the last good list stays (here: empty after the tick refresh)');

    // ClickUp
    S.setKey(rapp, 'clickup', 'pk_secret_clickup');
    const cuSrc = new S.ClickUpSource({ app: rapp, settings: { cuList: '' } });
    web.calls.length = 0;
    web.answer = (r) => {
      if (r.url.endsWith('/user')) return { status: 200, json: { user: { id: 42 } } };
      if (r.url.endsWith('/team')) return { status: 200, json: { teams: [{ id: '900' }] } };
      if (r.url.includes('/team/900/task')) return { status: 200, json: { tasks: [{ id: 'k1', name: 'Ship it', due_date: String(new Date(2026, 9, 19, 9).getTime()), due_date_time: true, status: { type: 'open' }, list: { id: '55', name: 'Work' } }], last_page: true } };
      if (r.url.endsWith('/list/55')) return { status: 200, json: { statuses: [{ status: 'to do', type: 'open' }, { status: 'complete', type: 'closed' }] } };
      return { status: 200, json: {} };
    };
    await cuSrc.refresh();
    eq([cuSrc.status().error, cuSrc.items().map((x) => [x.title, x.time, x.plannedHalf])], ['', [['Ship it', '09:00', 'am']]], 'ClickUp: tasks due by today, assigned to the key\'s person; a time picks Morning');
    ok(web.calls.find((c) => c.url.includes('/team/900/task')).url.includes('assignees[]=42') && web.calls.every((c) => c.headers.Authorization === 'pk_secret_clickup'), 'ClickUp: own tasks only, the personal token as its header');
    web.calls.length = 0;
    await cuSrc.toggle(cuSrc.items()[0]);
    eq([web.calls.find((c) => c.method === 'PUT').url, JSON.parse(web.calls.find((c) => c.method === 'PUT').body)], ['https://api.clickup.com/api/v2/task/k1', { status: 'complete' }], 'ClickUp: a tick sets the list\'s closed status (criterion 25)');
    web.calls.length = 0;
    await cuSrc.create({ title: 'Plan sprint', day: '2026-10-20' });
    const post = web.calls.find((c) => c.method === 'POST');
    eq([post.url, JSON.parse(post.body).name, JSON.parse(post.body).due_date_time], ['https://api.clickup.com/api/v2/list/55/task', 'Plan sprint', false], 'ClickUp: a new task goes to the list of the tasks it read (or the one picked)');

    const opened = []; global.window = { open: (u) => opened.push(u) };
    cuSrc.open({ ext: { url: 'javascript:alert(1)' } }); cuSrc.open({ ext: { url: 'https://app.clickup.com/t/k1' } });
    delete global.window;
    eq(opened, ['https://app.clickup.com/t/k1'], 'a task address from the answer opens only when it is https (review r1 #5)');

    // Things: Mac only; a stand-in for macOS's osascript
    const thSrc = new S.ThingsSource({ app: rapp, settings: {} });
    await thSrc.refresh();
    eq(thSrc.status().error, 'Things tasks show only on a Mac.', 'Things off a Mac: a short note, nothing run (criterion 17)');
    Platform.isMacOS = true;
    const ran = [];
    let out = 'NOT_RUNNING';
    global.window = { require: (x) => (x === 'child_process' ? { execFile: (cmd, args, o, cb2) => { ran.push([cmd, args[1]]); cb2(null, `${out}\n`); } } : null), open() {} };
    eq(S.thingsOffered(), true, 'Things offered on a Mac');
    thSrc.fetched = 0; await thSrc.refresh();
    eq(thSrc.status().error, 'Things is not open. Open Things to see its to-dos here.', 'Things not running: a short plain message (criterion 28)');
    out = 'id1\u001fBuy bread\u001fopen\u001f\u001f2026-10-19\u001f\u001e';
    thSrc.fetched = 0; await thSrc.refresh();
    eq([thSrc.status().error, thSrc.items().map((x) => [x.title, x.plannedDay, x.plannedHalf])], ['', [['Buy bread', '2026-10-19', null]]], 'Things: today\'s list read; no clock time, so Morning (criterion 27)');
    ran.length = 0;
    await thSrc.toggle(thSrc.items()[0]);
    eq(ran[0], ['osascript', 'tell application "Things3" to set status of to do id "id1" to completed'], 'Things: a tick completes it there (criterion 26)');
    ran.length = 0;
    await thSrc.create({ title: 'Say "hi"', day: '2026-10-25' });
    ok(ran[0][1].includes('make new to do with properties {name:"Say \\"hi\\""}') && ran[0][1].includes('schedule t for (my mk(2026, 10, 25))'), 'Things: a new to-do, quoted safely, scheduled by numbers (not a date in words)');
    delete global.window; Platform.isMacOS = false;
  } finally { console.warn = cw; console.error = ce; console.log = cl; }
  ok(!logs.some((l) => /secret|pk_/.test(l)), `no key in any log line (${logs.length} lines checked)`);
  console.log(`sources self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
