// The one LifeWorld plugin (phase 2 section 1): starts the four parts in order under their old
// ids, gives each its own corner of one settings file, lets them find each other without
// Obsidian's plugin list, stops them all on unload. The fake Plugin below copies what Obsidian
// 1.14.4 does (read from its app bundle 2026-10-13): load() awaits onload() then loads children;
// addChild() loads a child only when the parent is loaded and not yet that child; addCommand()
// prefixes the manifest id; loadData()/saveData() read and write <dir>/data.json, and loadData()
// gives null for a missing file and undefined for one it cannot parse (it logs, never throws).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const disk = {}; // dir -> data.json contents (a string, as on disk)
const files = {}; // any other file, by path
const notices = [];
let failCopy = false;
let failSave = false;
const writes = []; // 'begin' / 'end' of each write, in order
let writeDelay = () => 0;
class Component {
  constructor() { this._loaded = false; this._children = []; this._events = []; }
  async load() { if (this._loaded) return; this._loaded = true; await this.onload(); for (const c of this._children.slice()) await c.load(); }
  onload() {}
  unload() { if (!this._loaded) return; this._loaded = false; while (this._children.length) this._children.pop().unload(); while (this._events.length) this._events.pop()(); this.onunload(); }
  onunload() {}
  addChild(c) { this._children.push(c); if (this._loaded) c.load(); return c; }
  register(fn) { this._events.push(fn); }
}
class Plugin extends Component {
  constructor(app, manifest) { super(); this.app = app; this.manifest = manifest; }
  addCommand(c) { c.id = `${this.manifest.id}:${c.id}`; c.name = `${this.manifest.name}: ${c.name}`; this.app.commands[c.id] = c; this.register(() => delete this.app.commands[c.id]); return c; }
  registerView(type) { this.app.views.push(type); }
  addSettingTab(tab) { this.settingTab = tab; this.app.tabs.push(tab); }
  removeChild(c) { const i = this._children.indexOf(c); if (i !== -1) { this._children.splice(i, 1); c.unload(); } return c; }
  async loadData() { const s = disk[this.manifest.dir]; if (s === undefined) return null; try { return JSON.parse(s); } catch { return undefined; } }
  async saveData(d) { if (failSave) throw new Error('disk full'); const s = JSON.stringify(d); writes.push('begin'); await new Promise((r) => setTimeout(r, writeDelay())); disk[this.manifest.dir] = s; writes.push('end'); }
}
class Notice { constructor(m) { notices.push(m); } }
// Settings page stand-ins: a Setting records what it shows; an element records what is put in it.
const fakeEl = (tag) => ({ tag, kids: [], cls: [], attr: {}, dataset: {}, text: '', on: {}, addEventListener(t, f) { (this.on[t] = this.on[t] || []).push(f); }, fire(t) { return Promise.all((this.on[t] || []).map((f) => f())); }, empty() { this.kids = []; }, addClass(c) { this.cls.push(c); }, toggleClass(c, on) { this.cls = this.cls.filter((x) => x !== c); if (on) this.cls.push(c); },
  setAttr(k, v) { this.attr[k] = v; }, setText(t) { this.text = t; }, createDiv(o) { return this.createEl('div', o); },
  createSpan(o) { return this.createEl('span', o); }, createSvg(t, o) { return this.createEl(t, o); }, appendText(t) { this.text += t; },
  createEl(t, o) { const d = fakeEl(t); if (o && o.text) d.text = o.text; if (o && o.cls) d.cls.push(...String(o.cls).split(' ')); if (o && o.attr) Object.assign(d.attr, o.attr); this.kids.push(d); return d; } });
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = fakeEl(); } }
class Setting {
  constructor(el) { this.settingEl = fakeEl(); this.rec = {}; el.kids.push(this); }
  setName(v) { this.rec.name = v; return this; }
  setDesc(v) { this.rec.desc = v; return this; }
  setHeading() { this.rec.heading = true; return this; }
  addToggle(cb) { const r = this.rec; const t = { setValue(v) { r.on = v; return t; }, setDisabled(v) { r.disabled = v; return t; }, onChange(f) { r.change = f; return t; } }; cb(t); return this; }
  // A text box: typing = setValue then its onChange, as Obsidian's does.
  addText(cb) { const r = this.rec; const t = { inputEl: fakeEl('input'), setPlaceholder(v) { r.placeholder = v; return t; }, setValue(v) { r.value = v; return t; }, getValue() { return r.value; }, onChange(f) { r.change = f; return t; }, type(v) { r.value = v; return r.change && r.change(v); }, commit(v) { t.type(v); return t.inputEl.fire('change'); } }; r.text = t; cb(t); return this; }
  addDropdown(cb) { const r = this.rec; r.options = []; const d = { addOption(k, v) { r.options.push([k, v]); return d; }, setValue(v) { r.value = v; return d; }, onChange(f) { r.change = f; return d; } }; cb(d); return this; }
  addExtraButton(cb) { const b = { setIcon(v) { b.icon = v; return b; }, setTooltip(v) { b.tip = v; return b; }, setDisabled(v) { b.disabled = v; return b; }, onClick(f) { b.click = f; return b; } }; (this.rec.extras = this.rec.extras || []).push(b); cb(b); return this; }
  addButton(cb) { const b = { setButtonText(v) { b.label = v; return b; }, onClick(f) { b.click = f; return b; }, setCta() { b.cta = true; return b; }, setDisabled(v) { b.disabled = v; return b; } }; (this.rec.buttons = this.rec.buttons || []).push(b); cb(b); return this; }
}
class Modal { constructor(app) { this.app = app; this.contentEl = fakeEl('div'); this.modalEl = fakeEl('div'); } open() { this.isOpen = true; this.onOpen(); } close() { this.isOpen = false; this.onClose(); } setTitle(t) { this.title = t; return this; } }
class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); this.name = path.split('/').pop(); this.extension = 'md'; } }
class TFolder { constructor(path, children) { this.path = path; this.children = children; } }
// The type-ahead list under a box (Obsidian 1.14.4 app.js, read 2026-10-20): setValue/close on the box; each one made is kept.
const suggests = [];
class AbstractInputSuggest { constructor(app, inputEl) { this.app = app; this.inputEl = inputEl; this.suggestEl = fakeEl('div'); this.value = ''; this.closed = 0; suggests.push(this); } setValue(v) { this.value = v; } close() { this.closed++; } }
// Obsidian's debounce with resetTimer: runs once, with the last arguments, `ms` after the last call.
const debounce = (f, ms) => { let t = null; const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; f(...a); }, ms); }; d.cancel = () => { clearTimeout(t); t = null; }; return d; };
const fakeObsidian = new Proxy({ Plugin, Component, Notice, PluginSettingTab, Setting, Modal, TFile, TFolder, AbstractInputSuggest, debounce, setIcon() {}, moment: require('moment') }, { get: (t, k) => (k in t ? t[k] : k === 'Platform' ? {} : class {}) });
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : load.call(this, req, ...a); };

const LW = require(path.join(ROOT, 'main.js')).default; // the new-install start (no test vault settings)
const { fromSrc } = require('./lib/paths');
const IDS = ['a4-projects', 'a4-today', 'a4-planner', 'a4-sidebar'];
let n = 0;
const ok = (v, msg) => { assert.ok(v, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

// The parts' real onload needs a whole Obsidian; here each part's start is a small stand-in that
// uses only what LifeWorld changes (start order, its data, a command, a settings tab).
const log = [];
const started = {}; // the newest instance of each part
let failing = null;
let gate = null; // { id, wait }: that part's start waits until released
for (const id of IDS) {
  const P = LW.parts[id].prototype;
  P.onload = async function () {
    log.push(`start ${id}`); started[id] = this;
    if (failing === id) throw new Error('planted start failure');
    if (gate && gate.id === id) await gate.wait;
    await new Promise((r) => setTimeout(r, 5));
    this.addCommand({ id: 'open', name: 'Open' });
    this.registerView(`${id}-view`, () => null);
    this.addSettingTab({ part: id, containerEl: { isConnected: false }, getSettingDefinitions: () => [{ type: 'group', items: [{ name: `${id} row` }] }], hide() { log.push(`hide ${id}`); } });
    this.saved = await this.loadData();
    log.push(`started ${id}`);
  };
  P.onunload = function () { log.push(`stop ${id}`); };
  P.onExternalSettingsChange = async function () { this.saved = await this.loadData(); log.push(`external ${id}`); };
}
const DATA = /\/data\.json$/;
const adapter = {
  async read(p) { const s = DATA.test(p) ? disk[p.replace(DATA, '')] : files[p]; if (s === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return s; },
  async write(p, s) { if (failCopy) throw new Error('disk full'); if (DATA.test(p)) disk[p.replace(DATA, '')] = s; else files[p] = s; },
};
let openTabs = {}; // tab type -> leaves already open when LifeWorld starts
const newApp = () => { const closed = []; return { commands: {}, tabs: [], views: [], closed, workspace: { onLayoutReady: (f) => f(), trigger(name, x) { (this.fired = this.fired || []).push([name, x]); }, detachLeavesOfType(t) { closed.push(t); }, getLeavesOfType: (t) => (t === 'file-explorer' ? ['files'] : openTabs[t] || []), async revealLeaf(l) { closed.push(`reveal ${l}`); } }, vault: { configDir: '.obsidian', adapter, getRoot: () => new TFolder('', []), getMarkdownFiles: () => [], getAbstractFileByPath: () => null }, metadataCache: { getFileCache: () => null } }; }; // no app.plugins: lookups must not need it
const start = async (data) => {
  const dir = `.obsidian/plugins/lifeworld-${Math.random()}`;
  if (data !== undefined) disk[dir] = typeof data === 'string' ? data : JSON.stringify(data); // a string: the raw file
  const app = newApp();
  const host = new LW(app, { id: 'lifeworld', name: 'LifeWorld', dir });
  await host.load();
  const parts = Object.fromEntries(host._children.map((p) => [p.manifest.id, p]));
  return { app, host, parts, dir };
};

(async () => {
  // Manifest: the directory's rules for the one plugin.
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  eq([man.id, man.name, man.isDesktopOnly], ['lifeworld', 'LifeWorld', false], 'manifest id, name, phone support');
  ok(/^[a-z-]+$/.test(man.id) && !/obsidian|plugin$/.test(man.id), 'manifest id: lowercase, no "obsidian", not ending in "plugin"');
  ok(man.description.length <= 250 && man.description.endsWith('.') && !/obsidian|plugin/i.test(man.name), 'name without "Obsidian"/"Plugin"; description up to 250 characters, ends with a period');
  const ver = (v) => v.split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
  for (const id of IDS) ok(ver(man.minAppVersion) >= ver(JSON.parse(fs.readFileSync(path.join(ROOT, 'src', id.slice(3), 'manifest.json'), 'utf8')).minAppVersion), `minAppVersion covers ${id}`);
  // Styles: the four parts' styles, in start order.
  eq(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'), ['src', ...IDS.map((id) => path.join('src', id.slice(3)))].map((d) => fs.readFileSync(path.join(ROOT, d, 'styles.css'), 'utf8')).join('\n'), "styles.css is LifeWorld's own, then the four parts in start order");

  // Start: in order, one after the other, each under its old id, in LifeWorld's folder.
  const { app, host, parts, dir } = await start({ 'a4-today': { layout: ['weather'] }, 'a4-sidebar': { sort: 'az' } });
  eq(log, IDS.flatMap((id) => [`start ${id}`, `started ${id}`]), 'parts start in order, each after the one before has finished');
  eq(Object.keys(parts), IDS, 'four parts, each under its old id');
  for (const id of IDS) eq(parts[id].manifest.dir, dir, `${id} sits in LifeWorld's folder`);
  eq(Object.keys(app.commands).sort(), [...IDS.map((id) => `${id}:open`), 'lifeworld:open-manual'].sort(), "commands keep their old ids, no clash between parts; LifeWorld's own: open the manual");
  ok(Object.values(app.commands).every((c) => c.name === (c.id === 'lifeworld:open-manual' ? 'LifeWorld: Open the manual' : 'LifeWorld: Open')), 'every command shows as "LifeWorld: ..." (Obsidian prefixes the manifest name)');
  ok(app.tabs.length === 1 && app.tabs[0] === host.settingTab && app.tabs[0].plugin === host, 'one settings page, LifeWorld\'s; the parts add none of their own');
  eq(Object.keys(host.tabs), IDS, 'each part\'s own settings are kept for that page');

  // Settings: each part reads its own corner, as its own copy; a part with none gets null, as before.
  eq(parts['a4-today'].saved, { layout: ['weather'] }, 'Today reads its corner');
  eq(parts['a4-sidebar'].saved, { sort: 'az' }, 'Sidebar reads its corner');
  eq([parts['a4-projects'].saved, parts['a4-planner'].saved], [null, null], 'no corner yet: null, as a missing file gave');
  const got = await parts['a4-today'].loadData(); got.layout.push('changed, not saved');
  eq(await parts['a4-today'].loadData(), { layout: ['weather'] }, 'a change not saved does not reach the next read');
  ok(got !== (await parts['a4-today'].loadData()), 'every read is a fresh copy');
  eq(await parts['a4-today'].loadData(), (await host.loadData())['a4-today'], 'the corner is in the one settings file');

  // Saving: every part's corner survives the others' saves; one write at a time.
  writes.length = 0;
  let k = 0; writeDelay = () => [30, 1, 15][k++ % 3]; // the first write is the slowest
  const kept = { folded: ['x'] };
  await Promise.all([parts['a4-planner'].saveData(kept), parts['a4-projects'].saveData({ source: 'own' }), parts['a4-today'].saveData({ layout: [] })]);
  kept.folded.push('later');
  writeDelay = () => 0;
  const file = JSON.parse(disk[dir]);
  eq(file, { 'a4-today': { layout: [] }, 'a4-sidebar': { sort: 'az' }, 'a4-planner': { folded: ['x'] }, 'a4-projects': { source: 'own' } }, 'all four corners in the file after three saves at once; later edits to a saved object do not leak in');
  eq(writes, ['begin', 'end', 'begin', 'end', 'begin', 'end'], 'three writes, one at a time (the slow first one cannot land last)');

  // Lookups: Today, the Planner and the Sidebar find Projects, and Projects finds Today, without
  // Obsidian's plugin list (the fake app has none).
  eq(parts['a4-today'].projectsPlugin(), parts['a4-projects'], 'Today finds Projects through LifeWorld');
  eq(parts['a4-planner'].projectsPlugin(), parts['a4-projects'], 'the Planner finds Projects through LifeWorld');
  parts['a4-projects'].openFind = () => log.push('find');
  ok(parts['a4-today'].openFind() === true && parts['a4-planner'].openFind() === true && log.filter((x) => x === 'find').length === 2, 'Find from Today and the Planner opens Projects\' Find');

  parts['a4-today'].look = { accent: 'green' };
  eq(LW.parts['a4-projects'].cardAccent.cardAccentId(app), 'green', 'Projects finds Today (task card colour) through LifeWorld');
  delete parts['a4-today'].look;

  // Settings changed outside (Sync): only the part whose corner changed hears it, with the new data,
  // and LifeWorld's settings page (where the part's rows are) is redrawn when open.
  log.length = 0;
  const page = host.settingPage;
  page.containerEl.isConnected = true;
  const redraw0 = page.redraw; page.redraw = () => log.push('redraw page');
  disk[dir] = JSON.stringify({ ...file, 'a4-sidebar': { sort: 'za' } });
  await host.onExternalSettingsChange();
  eq(log, ['external a4-sidebar', 'redraw page'], 'only the Sidebar hears it, the open settings page redrawn');
  // Obsidian 1.13+ (settingItems set) redraws the page itself after this handler: no redraw here, however many parts changed.
  log.length = 0; page.settingItems = [];
  disk[dir] = JSON.stringify({ ...file, 'a4-sidebar': { sort: 'az' }, 'a4-today': { name: 'J' } });
  await host.onExternalSettingsChange();
  ok(!log.includes('redraw page'), 'on 1.13+ a sync leaves the redraw to Obsidian');
  delete page.settingItems;
  page.redraw = redraw0; page.containerEl.isConnected = false;
  disk[dir] = JSON.stringify({ ...file, 'a4-sidebar': { sort: 'za' } });
  await host.onExternalSettingsChange();
  eq(parts['a4-sidebar'].saved, { sort: 'za' }, 'with the new settings');

  // Stop: every part stops, its commands go, and the parts no longer find each other.
  log.length = 0;
  host.unload();
  eq(log.filter((x) => x.startsWith('stop')).sort(), IDS.map((id) => `stop ${id}`).sort(), 'every part stops with LifeWorld');
  eq(app.closed, [], 'turning LifeWorld off leaves open tabs alone');
  eq(Object.keys(app.commands), [], 'their commands are gone');
  eq(parts['a4-today'].projectsPlugin(), null, 'after stopping, Today no longer finds Projects');

  // A part that fails to start does not stop the others.
  log.length = 0; failing = 'a4-today';
  const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' '));
  const second = await start();
  console.error = ce; failing = null;
  eq(log.filter((x) => x.startsWith('started')), ['started a4-projects', 'started a4-planner', 'started a4-sidebar'], 'the others still start');
  ok(errs.length === 1 && /Today did not start/.test(errs[0]), 'the failure is logged once, naming the part');
  eq(second.host._children.map((p) => p.manifest.id), ['a4-projects', 'a4-planner', 'a4-sidebar'], 'the failed part is left out');
  ok(log.includes('stop a4-today') && second.parts['a4-planner'].projectsPlugin() === second.parts['a4-projects'], 'the failed part is stopped at once; the others still find each other');
  ok(!Object.keys(second.app.commands).some((c) => c.startsWith('a4-today:')), 'the failed part leaves no command behind');
  started['a4-today'].look = { accent: 'green' };
  ok(LW.parts['a4-projects'].cardAccent.cardAccentId(second.app) !== 'green', 'Projects does not find the failed Today (it is off, as a failed plugin was)');
  second.host.unload();

  // Section 2: one settings page, the Parts switches.
  const draw = (h) => { h.settingTab.display(); return h.settingTab.containerEl.kids.filter((k) => !(k.cls || []).includes('lw-hint')).map((k) => (k.rec ? k.rec : 'section')); };
  const rows = (h) => draw(h).filter((r) => r !== 'section' && !r.heading && 'on' in r); // the Parts switches
  const heads = (h) => draw(h).filter((r) => r.heading).map((r) => r.name);
  const cmds = (a) => Object.keys(a.commands).map((c) => c.split(':')[0]).filter((p) => p !== 'lifeworld').sort(); // the parts' commands
  const pg = await start({ 'a4-today': { layout: ['weather'] } });
  eq(rows(pg.host).map((r) => [r.name, r.desc, r.on, !!r.disabled]), [
    ['Today page', 'Your day at a glance', true, false],
    ['Planner', 'Day, week and month board', true, false],
    ['Projects and areas', 'Project pages, areas, the task board and Inbox', true, false],
    ['Sidebar', "The LifeWorld panel on the left. Off: Obsidian's normal file list.", true, false],
  ], 'Parts: the four switches as drawn, all on for a setup that never switched one');
  eq(heads(pg.host), ['Parts', 'Planning', 'Your vault', 'Tasks', 'Today page', 'Sidebar'], 'then each part\'s own settings under the mockup\'s heading, in its order');
  const names = draw(pg.host).filter((r) => r !== 'section').map((r) => r.name);
  ok(['a4-projects', 'a4-today', 'a4-sidebar'].every((id, i) => names.indexOf(`${id} row`) === names.lastIndexOf(heads(pg.host)[3 + i]) + 1), 'each part\'s own rows sit under its heading');
  ok(pg.host.settingTab.containerEl.cls.includes('lw-settings'), 'the page carries LifeWorld\'s class');

  // Planner off: not running, no command, its choice saved; the others untouched.
  log.length = 0;
  await draw(pg.host).find((r) => r.name === 'Planner').change(false);
  eq(log.filter((x) => x.startsWith('st')), ['stop a4-planner'], 'Planner off: only the Planner stops');
  eq(cmds(pg.app), ['a4-projects', 'a4-sidebar', 'a4-today'], 'its command is gone');
  eq(pg.app.closed, ['a4-planner-view'], 'its open tabs are closed');
  eq(JSON.parse(disk[pg.dir]).lifeworld, { parts: { 'a4-planner': false } }, 'the switch is saved in LifeWorld\'s corner');
  eq(JSON.parse(disk[pg.dir])['a4-today'], { layout: ['weather'] }, 'the parts\' own settings are untouched');

  // Projects off (launch section 1): Today keeps running; the task engine starts again without its pages.
  log.length = 0;
  await pg.host.setPart('a4-projects', false);
  eq(log.filter((x) => /^(stop|started) /.test(x)), ['stop a4-projects', 'started a4-projects'], 'Projects off: only the task engine restarts, Today keeps running');
  ok(pg.host.running['a4-projects'].pagesOff === true && pg.host.running['a4-today'], 'the engine runs without its pages while Today is on');
  eq(pg.app.closed.slice(1), ['a4-projects-view'], 'the Projects tabs are closed');
  eq(rows(pg.host).map((r) => [r.name, r.on, !!r.disabled]), [['Today page', true, false], ['Planner', false, false], ['Projects and areas', false, false], ['Sidebar', true, false]], 'every switch on its own, none greyed');
  ok(!pg.host.settingTab.containerEl.kids.some((k) => k.rec && k.settingEl.cls.includes('lw-dim')), 'no Parts row dimmed');
  ok(heads(pg.host).includes('Tasks'), 'the task settings stay while the engine runs');
  await pg.host.setPart('a4-today', false);
  ok(!('a4-projects' in pg.host.running) && !('a4-today' in pg.host.running), 'Today, the Planner and Projects all off: the engine stops too');
  await pg.host.setPart('a4-today', true);
  ok(pg.host.running['a4-projects'] && pg.host.running['a4-projects'].pagesOff === true, 'Today back on: the engine starts again, without pages');
  log.length = 0;
  await pg.host.setPart('a4-projects', true);
  eq(log.filter((x) => /^(stop|started) /.test(x)), ['stop a4-projects', 'started a4-projects'], 'Projects on: the engine restarts with its pages');
  ok(pg.host.running['a4-projects'].pagesOff === false, 'pages on');
  eq(cmds(pg.app), ['a4-projects', 'a4-sidebar', 'a4-today'], 'commands back for the parts that are on');
  eq(rows(pg.host).map((r) => [r.name, r.on, !!r.disabled]), [['Today page', true, false], ['Planner', false, false], ['Projects and areas', true, false], ['Sidebar', true, false]], 'the Planner\'s own switch kept');
  eq(pg.host.running['a4-today'].saved, { layout: ['weather'] }, 'a part started again reads its saved settings');
  eq(JSON.parse(disk[pg.dir]).lifeworld.parts, { 'a4-planner': false, 'a4-projects': true, 'a4-today': true }, 'saved');
  await pg.host.setPart('a4-planner', true);
  eq(cmds(pg.app), IDS.slice().sort(), 'Planner on again: all four commands back');

  // Two switches at once: one change at a time, never two copies of a part.
  log.length = 0;
  await pg.host.setPart('a4-sidebar', false);
  await Promise.all([pg.host.setPart('a4-sidebar', true), pg.host.setPart('a4-sidebar', true)]);
  eq(log.filter((x) => /^start(ed)? a4-sidebar/.test(x)), ['start a4-sidebar', 'started a4-sidebar'], 'switched on twice at once: the Sidebar starts once');
  ok(pg.app.closed.includes('reveal files'), "Sidebar off: Obsidian's file list brought forward");
  eq(pg.host._children.filter((c) => c.manifest.id === 'a4-sidebar').length, 1, 'one Sidebar');
  pg.host.unload();

  // Next start: a part switched off is not started; Today or the Planner on without Projects stay off.
  log.length = 0;
  const off = await start({ lifeworld: { parts: { 'a4-sidebar': false } } });
  ok(!log.includes('start a4-sidebar') && !('a4-sidebar' in off.host.running), 'switched off: not started at all');
  eq(cmds(off.app), ['a4-planner', 'a4-projects', 'a4-today'], 'no command from it');
  ok(!off.host.tabs['a4-sidebar'] && heads(off.host).indexOf('Sidebar') === -1, 'no settings from it');
  off.host.unload();
  log.length = 0;
  const odd = await start({ lifeworld: { parts: { 'a4-projects': false } } }); // edited by hand
  eq(log.filter((x) => x.startsWith('started')), ['started a4-projects', 'started a4-today', 'started a4-planner', 'started a4-sidebar'], 'Projects off in the file: Today and the Planner still start, on the engine without pages');
  ok(odd.host.running['a4-projects'].pagesOff === true, 'without pages');

  // Switched on the phone: followed here.
  disk[odd.dir] = JSON.stringify({ lifeworld: { parts: { 'a4-projects': true, 'a4-today': true, 'a4-planner': false } } });
  await odd.host.onExternalSettingsChange();
  eq(Object.keys(odd.host.running).sort(), ['a4-projects', 'a4-sidebar', 'a4-today'], 'switches changed outside: parts started and stopped to match');
  ok(odd.host.running['a4-projects'].pagesOff === false, 'Projects pages back on');
  odd.host.unload();

  // A damaged settings file: copied aside first, a notice, defaults; the original is not written
  // over before the copy exists.
  const quiet = (fn) => async (...a) => { const w = console.warn, e = console.error; console.warn = console.error = () => {}; try { return await fn(...a); } finally { console.warn = w; console.error = e; } };
  const startQuiet = quiet(start);
  notices.length = 0;
  const bad = '{"a4-today": {"layout": ["weather"]}, "a4-sid';
  const dmg = await startQuiet(bad);
  const copies = Object.keys(files).filter((f) => f.startsWith(`${dmg.dir}/data.damaged-`));
  ok(copies.length === 1 && /data\.damaged-\d{8}-\d{6}\.json$/.test(copies[0]) && files[copies[0]] === bad, 'damaged file copied aside, byte for byte, with a time stamp');
  ok(notices.length === 1 && notices[0].includes(copies[0]), 'one notice, naming the copy');
  eq(IDS.map((id) => dmg.parts[id].saved), [null, null, null, null], 'every part starts on defaults');
  eq(disk[dmg.dir], bad, 'the original is not written over at start');
  await dmg.parts['a4-today'].saveData({ layout: [] });
  eq(JSON.parse(disk[dmg.dir]), { 'a4-today': { layout: [] }, lifeworld: { carriedOver: true } }, 'after the copy exists, saving works again (carry-over marked done)');
  dmg.host.unload();

  notices.length = 0; failCopy = true;
  const stuck = await startQuiet(bad);
  ok(notices.length === 1 && /could not be copied/.test(notices[0]), 'copy failed: a notice says nothing will be saved');
  await stuck.parts['a4-today'].saveData({ layout: [] });
  eq(disk[stuck.dir], bad, 'copy failed: the damaged original is never written over');
  failCopy = false; stuck.host.unload();

  // Settings changed outside to a damaged file (a half-synced copy): ignored, the current settings stay.
  const live = await start({ 'a4-sidebar': { sort: 'az' } });
  log.length = 0; disk[live.dir] = bad;
  await quiet(() => live.host.onExternalSettingsChange())();
  eq(log, [], 'no part hears a damaged outside change');
  eq(await live.parts['a4-sidebar'].loadData(), { sort: 'az' }, 'the current settings stay');
  live.host.unload();

  // Carried over from the old plugins: once per part with no corner, read only, without a script.
  const OLD = (id) => `.obsidian/plugins/${id}`;
  disk[OLD('a4-today')] = JSON.stringify({ layout: ['calendar'], calendars: { selected: ['x'] } });
  disk[OLD('a4-planner')] = '{"folded": [';
  disk[OLD('a4-sidebar')] = JSON.stringify({ sort: 'old' });
  const oldFiles = { ...disk };
  const warns = []; const cw = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  const mig = await start({ 'a4-sidebar': { sort: 'az' } });
  console.warn = cw;
  eq(mig.parts['a4-today'].saved, { layout: ['calendar'], calendars: { selected: ['x'] } }, 'present old file: Today takes it');
  eq(mig.parts['a4-planner'].saved, null, 'malformed old file: the Planner starts on defaults');
  ok(warns.length === 1 && warns[0].includes('a4-planner'), 'malformed old file: one warning naming it');
  eq(mig.parts['a4-projects'].saved, null, 'missing old file: Projects starts on defaults');
  eq(mig.parts['a4-sidebar'].saved, { sort: 'az' }, 'a corner already there wins over the old file');
  eq(JSON.parse(disk[mig.dir]), { 'a4-sidebar': { sort: 'az' }, 'a4-today': { layout: ['calendar'], calendars: { selected: ['x'] } } }, 'what was taken is saved at once');
  for (const id of ['a4-today', 'a4-planner', 'a4-sidebar']) eq(disk[OLD(id)], oldFiles[OLD(id)], `old ${id} file left as it was`);
  mig.host.unload();
  disk[OLD('a4-today')] = JSON.stringify({ layout: ['changed later'] });
  const again = await startQuiet(JSON.parse(disk[mig.dir]));
  eq(again.parts['a4-today'].saved, { layout: ['calendar'], calendars: { selected: ['x'] } }, 'second start: the old file is not read again');
  again.host.unload();

  // Review p2-s2 must-fix: after a damaged LifeWorld file, no carry-over (the notice promises defaults,
  // and older settings must not quietly replace the ones in the copy kept aside).
  disk[OLD('a4-today')] = JSON.stringify({ layout: ['old'] });
  notices.length = 0;
  const dmg2 = await startQuiet(bad);
  eq(dmg2.parts['a4-today'].saved, null, 'damaged file and an old Today file: Today starts on defaults');
  eq(disk[dmg2.dir], bad, 'nothing saved at start');
  ok(notices.length === 1 && /default settings/.test(notices[0]), 'the notice says default settings, and that is true');
  dmg2.host.unload();
  // Review p2-s3 should-fix 1: a part that saved nothing after the damaged start does not take its old
  // plugin's settings at a later start either.
  disk[OLD('a4-planner')] = JSON.stringify({ folded: ['old'] });
  const dmg3 = await startQuiet(bad);
  await dmg3.parts['a4-today'].saveData({ layout: ['new'] });
  dmg3.host.unload();
  const after = await start(JSON.parse(disk[dmg3.dir]));
  eq([after.parts['a4-today'].saved, after.parts['a4-planner'].saved], [{ layout: ['new'] }, null], 'restart after a damaged start: Today keeps its save, the Planner stays on defaults (old file not taken)');
  after.host.unload();
  delete disk[OLD('a4-planner')];

  // The save after a carry-over fails (disk full): LifeWorld still starts, on what was carried, with a notice.
  notices.length = 0; failSave = true;
  const full = await startQuiet();
  failSave = false;
  ok(Object.keys(full.host.running).length === 4 && full.parts['a4-today'].saved && full.parts['a4-today'].saved.layout[0] === 'old', 'carry-over save failed: every part starts, Today with the carried settings');
  ok(notices.length === 1 && /could not be saved/.test(notices[0]), 'one notice says so');
  await full.parts['a4-sidebar'].saveData({ sort: 'az' });
  eq(JSON.parse(disk[full.dir])['a4-today'], { layout: ['old'] }, 'the next save writes the carried settings too');
  full.host.unload();
  for (const id of IDS) delete disk[OLD(id)];

  // LifeWorld turned off while a switch is starting a part: the part does not run on alone.
  const mid = await start({ lifeworld: { parts: { 'a4-sidebar': false } } });
  let release; gate = { id: 'a4-sidebar', wait: new Promise((res) => { release = res; }) };
  log.length = 0;
  const flip = mid.host.setPart('a4-sidebar', true);
  while (!log.includes('start a4-sidebar')) await new Promise((res) => setTimeout(res, 1));
  mid.host.unload();
  release(); await flip; gate = null;
  ok(log.includes('stop a4-sidebar'), 'the late-started part is stopped');
  eq(Object.keys(mid.app.commands), [], 'no command left behind');
  eq(mid.host.running, {}, 'nothing listed as running');
  await mid.host.applyParts();
  ok(!log.slice(log.indexOf('stop a4-sidebar')).some((x) => x.startsWith('start')), 'after LifeWorld is off, nothing starts again');

  // Sync changes the file while a save is under way or queued: the change made here and the one
  // from outside both survive, in memory and on disk.
  const race = await start({ 'a4-today': { layout: ['a'] }, 'a4-sidebar': { sort: 'az' } });
  writeDelay = () => 20;
  const s1 = race.parts['a4-today'].saveData({ layout: ['b'] }); // under way when Sync lands
  const s2 = race.parts['a4-planner'].saveData({ folded: ['x'] }); // queued behind it
  await new Promise((res) => setTimeout(res, 5));
  disk[race.dir] = JSON.stringify({ 'a4-today': { layout: ['a'] }, 'a4-sidebar': { sort: 'synced' } });
  log.length = 0;
  await race.host.onExternalSettingsChange();
  eq(log, ['external a4-sidebar'], 'only the Sidebar hears the outside change');
  await s1; await s2; await race.host.saving;
  writeDelay = () => 0;
  eq(JSON.parse(disk[race.dir]), { 'a4-today': { layout: ['b'] }, 'a4-sidebar': { sort: 'synced' }, 'a4-planner': { folded: ['x'] } }, 'on disk: both saves made here and the Sync change');
  eq([await race.parts['a4-today'].loadData(), await race.parts['a4-sidebar'].loadData()], [{ layout: ['b'] }, { sort: 'synced' }], 'in memory the same');
  disk[race.dir] = JSON.stringify({ ...JSON.parse(disk[race.dir]), 'a4-today': { layout: ['phone'] } });
  await race.host.onExternalSettingsChange();
  eq(await race.parts['a4-today'].loadData(), { layout: ['phone'] }, 'with nothing waiting to be saved, an outside change to a corner is taken');
  // Only one save, under way when Sync lands: one more write follows, so the Sync change is not lost on disk.
  writeDelay = () => 20;
  const s3 = race.parts['a4-today'].saveData({ layout: ['c'] });
  await new Promise((res) => setTimeout(res, 5));
  disk[race.dir] = JSON.stringify({ ...JSON.parse(disk[race.dir]), 'a4-sidebar': { sort: 'synced again' } });
  await race.host.onExternalSettingsChange();
  await s3; await race.host.saving;
  writeDelay = () => 0;
  eq([JSON.parse(disk[race.dir])['a4-today'], JSON.parse(disk[race.dir])['a4-sidebar']], [{ layout: ['c'] }, { sort: 'synced again' }], 'a save under way alone: the file ends with both');
  // Review p2-s3 should-fix 2: a second Sync change to the same corner, landing while the follow-up
  // write runs, is taken (it was dropped as if it were a change made here).
  const pause = (ms) => new Promise((res) => setTimeout(res, ms));
  const syncSidebar = async (v) => { disk[race.dir] = JSON.stringify({ ...JSON.parse(disk[race.dir]), 'a4-sidebar': { sort: v } }); await race.host.onExternalSettingsChange(); };
  writeDelay = () => 20;
  const s4 = race.parts['a4-today'].saveData({ layout: ['d'] });
  await pause(5); await syncSidebar('sync1');
  await s4; await pause(5); // the follow-up write is under way
  ok(race.host.writing, 'the second Sync change lands during the follow-up write');
  await syncSidebar('sync2');
  await race.host.saving;
  writeDelay = () => 0;
  eq([await race.parts['a4-sidebar'].loadData(), JSON.parse(disk[race.dir])['a4-sidebar'], JSON.parse(disk[race.dir])['a4-today']], [{ sort: 'sync2' }, { sort: 'sync2' }, { layout: ['d'] }], 'second Sync change kept, in memory and on disk; the change made here too');
  // Review p2-s3 nice-to-have 3: the follow-up write failing is logged, not swallowed.
  const logged = []; const ce2 = console.error; console.error = (...a) => logged.push(a.join(' '));
  writeDelay = () => 20;
  const s5 = race.parts['a4-today'].saveData({ layout: ['e'] });
  await pause(5); failSave = true; await syncSidebar('sync3');
  await s5; await race.host.saving.catch(() => {});
  failSave = false; writeDelay = () => 0; console.error = ce2;
  ok(logged.some((e) => e.includes('save after a settings change from outside failed')), 'a failed follow-up write leaves a log line');
  race.host.unload();

  // Review p2-s3b nice-to-have 1: a save made here that ends while the Sync file is still being
  // read keeps its change, and the file ends with both (the older read used to replace it).
  const slow = await start({ 'a4-today': { layout: ['a'] }, 'a4-sidebar': { sort: 'az' } });
  const plainRead = slow.host.loadData;
  disk[slow.dir] = JSON.stringify({ 'a4-today': { layout: ['a'] }, 'a4-sidebar': { sort: 'synced' } });
  slow.host.loadData = async function () { const d = await plainRead.call(this); await slow.parts['a4-today'].saveData({ layout: ['mine'] }); return d; };
  await slow.host.onExternalSettingsChange();
  slow.host.loadData = plainRead;
  await slow.host.saving;
  eq([await slow.parts['a4-today'].loadData(), await slow.parts['a4-sidebar'].loadData()], [{ layout: ['mine'] }, { sort: 'synced' }], 'save during the Sync read: in memory, the change made here and the Sync change');
  eq(JSON.parse(disk[slow.dir]), { 'a4-today': { layout: ['mine'] }, 'a4-sidebar': { sort: 'synced' } }, 'save during the Sync read: on disk, both');
  slow.host.unload();

  // ---- Section 4: Settings › Your vault (lifeworld-your-vault-mockup.html, approved 2026-10-14) ----
  const FIX = path.join(ROOT, 'tests', 'fixtures', 'vault');
  const fixJson = (p) => JSON.parse(fs.readFileSync(path.join(FIX, '.obsidian', p), 'utf8'));
  // The folders and scratchpad the four old plugins had written into their code before section 4.
  const OLDF = { tasks: '02 Planner/TaskNotes/Tasks', archive: '02 Planner/TaskNotes/Archive', projects: '04 Library/My Life/Projects', goals: '04 Library/My Life/Goals', habits: '04 Library/My Life/Habits', journal: '04 Library/Journal' };
  const OLD_SP = (d) => `00 Daily Notes/${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}.md`;
  const OLD_TPL = '06 Admin/Admin Notes/Templates/Daily Notes.md';
  const withDaily = (app, options) => { app.internalPlugins = { getEnabledPluginById: (id) => (id === 'daily-notes' && options ? { options } : null) }; return app; };
  const vaultRows = (h) => { const all = draw(h); const i = all.findIndex((r) => r.heading && r.name === 'Your vault'); return all.slice(i + 1, all.findIndex((r, k) => k > i && r.heading)); };
  const T = LW.parts['a4-today'].logic;
  const Engine = LW.parts['a4-projects'].TaskEngine;
  const oct3 = new Date(2026, 9, 3, 9, 0);

  // New install: the rows as drawn, with the drawn defaults; Obsidian's Daily notes defaults.
  const fresh = await start({});
  withDaily(fresh.app, null);
  eq(vaultRows(fresh.host).map((r) => [r.name, r.desc || '', r.value, r.placeholder || (r.buttons || []).map((b) => b.label).join()]), [
    ['Task notes folder', '', 'Tasks', 'Tasks'],
    ['Finished tasks folder', 'Archived tasks move here', 'Tasks/Archive', 'Tasks/Archive'],
    ['Projects folder', '', 'Projects', 'Projects'],
    ['Goals folder', 'Goals your projects point to', 'Goals', 'Goals'],
    ['Habits folder', 'One note per habit, ticked on the Today page', 'Habits', 'Habits'],
    ['Journal folder', 'The newest note here shows on the Today page', 'Journal', 'Journal'],
    ['Mood folder', 'Your mood check-ins', 'Mood', 'Mood'],
    ['Daily notes', "Uses Obsidian's own Daily notes settings (the vault's top folder, YYYY-MM-DD)", undefined, 'Open'],
    ['Property names', 'status, due, scheduled, priority, projects, reminders', undefined, 'Change'],
    ['Look for my notes again', 'Shows the welcome window again. Nothing changes unless you choose to start with what it found.', undefined, 'Run setup'],
  ], 'new install: the Your vault rows and defaults as drawn');
  const freshEngine = new Engine({ app: fresh.app, settings: {} });
  eq([freshEngine.cfg().tasksFolder, freshEngine.cfg().archiveFolder], ['Tasks', 'Tasks/Archive'], 'new install: the task engine uses the same folders');
  eq(T.scratchPathFor(oct3), '2026-10-03.md', "new install: today's daily note follows Obsidian's defaults (top folder, YYYY-MM-DD)");
  withDaily(fresh.app, { folder: 'Daily notes/', format: 'YYYY-MM-DD' });
  ok(vaultRows(fresh.host).find((r) => r.name === 'Daily notes').desc === "Uses Obsidian's own Daily notes settings (folder \"Daily notes\", YYYY-MM-DD)", "Daily notes reads Obsidian's own setting each time the page is drawn");
  // A folder typed in: saved, read by every part; emptied: back to the default.
  // Review p2-s4 nice-to-have 1: typing alone saves nothing; leaving the box (or Enter) saves.
  vaultRows(fresh.host)[0].text.type('My Ta');
  await fresh.host.saving;
  eq([disk[fresh.dir], freshEngine.cfg().tasksFolder], [JSON.stringify({}), 'Tasks'], 'a folder being typed is neither saved nor read');
  await vaultRows(fresh.host)[0].text.commit('My Tasks/ ');
  await fresh.host.saving;
  eq([JSON.parse(disk[fresh.dir]).lifeworld.vault.folders.tasks, freshEngine.cfg().tasksFolder], ['My Tasks/', 'My Tasks'], 'a typed folder is saved and read (trailing slash dropped)');
  await vaultRows(fresh.host)[0].text.commit('');
  eq(freshEngine.cfg().tasksFolder, 'Tasks', 'an emptied folder falls back to the default');
  await vaultRows(fresh.host)[0].text.commit(' ../x//y/./ ');
  eq(freshEngine.cfg().tasksFolder, 'x/y', "a folder's '..', '.' and doubled slashes are dropped");
  await vaultRows(fresh.host)[0].text.commit('');
  // Settings › Planning (0.1.16): one choice, "Set its due date" by default; the other is saved and read.
  const placeRow = () => draw(fresh.host).find((r) => r.name === 'When you place a task on a day');
  eq([placeRow().options, placeRow().value, LW.vault.planning.setsDue], [[['due', 'Set its due date'], ['plan', 'Just plan it for that day']], 'due', true], 'Planning: two choices, due date by default');
  await placeRow().change('plan');
  eq([JSON.parse(disk[fresh.dir]).lifeworld.vault.placeOnDay, LW.vault.planning.setsDue, placeRow().value], ['plan', false, 'plan'], 'Just plan it: saved and read by every part');
  await placeRow().change('due');
  ok(LW.vault.planning.setsDue, 'back to Set its due date');
  fresh.host.unload();

  // The owner's preset (the frozen vault's LifeWorld file and Obsidian Daily notes setting, shaped like
  // owner's): every folder, the scratchpad and every property name come out as the old code had them.
  const owner = await start(fixJson('plugins/lifeworld/data.json'));
  withDaily(owner.app, fixJson('daily-notes.json'));
  eq(Object.fromEntries(vaultRows(owner.host).slice(0, 6).map((r, i) => [Object.keys(OLDF)[i], r.value])), OLDF, 'preset: the six folder rows hold the old folders');
  const je = new Engine({ app: owner.app, settings: {} });
  eq([je.cfg().tasksFolder, je.cfg().archiveFolder], [OLDF.tasks, OLDF.archive], 'preset: the task engine reads the old task folders');
  eq(Object.entries(je.cfg().F).filter(([k, v]) => k !== v && !['recurrenceAnchor', 'archiveTag', 'completeInstances', 'skippedInstances'].includes(k)), [], 'preset: property names unchanged');
  const jdn = { folder: '00 Daily Notes', format: 'MM-DD-YYYY' };
  eq(T.scratchPathFor(oct3, fixJson('daily-notes.json')), OLD_SP(oct3), "preset: today's scratchpad path as before");
  eq(T.scratchPathFor(new Date(2027, 0, 9), jdn), '00 Daily Notes/01-09-2027.md', 'preset: zero-padded, as before');
  eq(vaultRows(owner.host).find((r) => r.name === 'Daily notes').desc, 'Uses Obsidian\'s own Daily notes settings (folder "00 Daily Notes", MM-DD-YYYY, template "Daily Notes")', 'preset: Daily notes row as drawn for the owner');
  eq(vaultRows(owner.host).find((r) => r.name === 'Property names').desc, 'status, due, scheduled, priority, projects, reminders', 'preset: property names row');
  eq(T.renderTemplate('# {{title}}', oct3), '# 2026-10-03', 'template title: the daily note name (defaults here)');
  eq(T.renderTemplate('# {{title}}', oct3, null, '10-03-2026'), '# 10-03-2026', 'template title: the name it is given');
  await owner.parts['a4-today'].saveData({ layout: ['x'] }); await owner.host.saving;
  eq(JSON.parse(disk[owner.dir]).lifeworld, fixJson('plugins/lifeworld/data.json').lifeworld, 'preset: saving a part leaves the Your vault settings as they were');
  // Phase 2 section 5: the calendar and weather notes the old code had built in come from the preset.
  const PL = LW.parts['a4-planner'].prototype;
  const notesSeen = [];
  const calApp = { vault: { getAbstractFileByPath: (p) => { notesSeen.push(p); return null; } }, metadataCache: { getFileCache: () => null } };
  PL.calendarEvents.call({ app: calApp });
  LW.parts['a4-today'].prototype.calendarFrontmatter.call({ app: calApp });
  eq(notesSeen, ['02 Planner/Calendar Events.md', '02 Planner/Calendar Events.md'], 'preset: the Planner and Today read the old calendar note');

  // The owner's own settings, read only (LIFEWORLD_VAULT; else the frozen copy): Obsidian's Daily notes setting gives
  // the old scratchpad path and template, TaskNotes' folders and names are the preset's.
  const V = require('./lib/paths').vault;
  const readOnly = (p) => JSON.parse(fs.readFileSync(path.join(V, '.obsidian', p), 'utf8'));
  const hisDaily = readOnly('daily-notes.json');
  eq([T.scratchPathFor(oct3, { folder: hisDaily.folder, format: hisDaily.format }), `${hisDaily.template}.md`], [OLD_SP(oct3), OLD_TPL], `the owner's Daily notes setting (${require('./lib/paths').FROZEN ? 'frozen copy' : 'the owner\'s vault'}): same scratchpad and template as before`);
  const hisTn = readOnly('plugins/tasknotes/data.json');
  eq([hisTn.tasksFolder, hisTn.archiveFolder], [OLDF.tasks, OLDF.archive], "the owner's TaskNotes folders are the preset's");
  eq(['title', 'status', 'priority', 'due', 'scheduled', 'projects', 'reminders', 'recurrence', 'completedDate', 'dateCreated', 'dateModified', 'blockedBy'].filter((k) => hisTn.fieldMapping[k] !== k).concat(hisTn.fieldMapping.completeInstances === 'complete_instances' && hisTn.fieldMapping.skippedInstances === 'skipped_instances' ? [] : ['instances']), [], "the owner's notes use the default property names");
  if (!require('./lib/paths').FROZEN) ok(Object.values(OLDF).every((d) => fs.statSync(path.join(V, d)).isDirectory()), "every preset folder exists in the owner's vault");
  owner.host.unload();

  // New install: no calendar or weather note is read at all.
  const nf = await start({});
  const nfSeen = [];
  LW.parts['a4-planner'].prototype.calendarEvents.call({ app: { vault: { getAbstractFileByPath: (p) => { nfSeen.push(p); return null; } } } });
  eq(nfSeen, [], 'new install: the Planner reads no calendar note');
  // A calendar note set from the phone (Sync) is read at once.
  disk[nf.dir] = JSON.stringify({ lifeworld: { vault: { feeds: { calendar: 'Feeds/Cal.md' } } } });
  await nf.host.onExternalSettingsChange();
  LW.parts['a4-planner'].prototype.calendarEvents.call({ app: { vault: { getAbstractFileByPath: (p) => { nfSeen.push(p); return null; } } } });
  eq(nfSeen, ['Feeds/Cal.md'], 'a calendar note set on another device is read');
  nf.host.unload();

  // Review p2-s5 must-fix 3: a calendar note path changed (Sync, or a Your vault save) makes Today
  // adopt the calendar choice at once, not after the note's next rewrite.
  const ad = await start({});
  let adopts = 0;
  ad.parts['a4-today'].adoptCalendarChoice = async () => { adopts++; };
  disk[ad.dir] = JSON.stringify({ lifeworld: { vault: { feeds: { calendar: 'Feeds/Cal.md' } } } });
  await ad.host.onExternalSettingsChange();
  eq(adopts, 1, 'calendar note set on another device: Today adopts the calendar choice at once');
  await ad.host.setVaultSettings({ folders: {} });
  eq(adopts, 2, 'Your vault saved here: Today hears it too');
  ad.host.unload();

  // The Property names dialog: rows, the three checks, Reset to defaults, Done.
  const pn = await start({});
  const nameRow = () => vaultRows(pn.host).find((r) => r.name === 'Property names');
  const dlgOf = () => { let m; const M = LW.PropertyNamesModal; const o = M.prototype.open; M.prototype.open = function () { m = this; o.call(this); }; nameRow().buttons[0].click(); M.prototype.open = o; return m; };
  let dlg = dlgOf();
  const field = (label) => dlg.inputs.find((x) => x.label === label).t;
  const doneBtn = () => dlg.done;
  const more = dlg.contentEl.kids.find((k) => k.tag === 'details');
  eq([dlg.title, dlg.inputs.length, more.kids.filter((k) => k.rec).length, more.kids[0].text], ['Property names', 17, 5, 'More properties (rarely changed)'], 'dialog: title, 12 rows, 5 more folded away');
  eq(dlg.inputs.slice(0, 12).map((x) => [x.label, x.t.getValue()]).map((x) => x.join('=')).join(' '), 'Title=title Status=status Priority=priority Due date=due Scheduled date=scheduled Projects=projects Reminders=reminders Repeats=recurrence Finished on=completedDate Planned day=planned_day Planned half=planned_half Planned order=planned_order', 'dialog: the drawn rows, each with the name in use');
  ok(!dlg.err.text && !doneBtn().disabled, 'dialog: no problem, Done on');
  field('Status').type('');
  eq([dlg.err.text, doneBtn().disabled, field('Status').inputEl.cls.includes('lw-bad')], ['A property name cannot be empty.', true, true], 'empty name refused, row marked');
  field('Status').type('due');
  eq([dlg.err.text, doneBtn().disabled, field('Due date').inputEl.cls.includes('lw-bad')], ['Two rows use "due". Each needs its own name.', true, true], 'duplicate refused, both rows marked');
  field('Status').type('my: status');
  eq([dlg.err.text, doneBtn().disabled], ['"my: status" has a character property names cannot use.', true], 'invalid character refused');
  await dlg.save();
  ok(dlg.isOpen && !JSON.parse(disk[pn.dir] || '{}').lifeworld, 'Done does nothing while a name is refused');
  dlg.contentEl.kids.find((k) => k.rec && k.rec.buttons && k.rec.buttons.length === 2).rec.buttons[0].click();
  ok(!dlg.err.text && !doneBtn().disabled && dlg.inputs.every((x) => x.t.getValue() === x.key), 'Reset to defaults: every name back, no problem');
  field('Due date').type('deadline'); field('Planned day').type(' plan_day ');
  dlg.close();
  ok(!JSON.parse(disk[pn.dir] || '{}').lifeworld && nameRow().desc === 'status, due, scheduled, priority, projects, reminders', 'closing without Done saves nothing');
  dlg = dlgOf();
  field('Due date').type('deadline'); field('Planned day').type(' plan_day '); field('Priority').type('prio');
  await dlg.save(); await pn.host.saving;
  eq([dlg.isOpen, JSON.parse(disk[pn.dir]).lifeworld.vault.names, nameRow().desc], [false, { priority: 'prio', due: 'deadline', planned_day: 'plan_day' }, 'status, deadline, scheduled, prio, projects, reminders'], 'Done saves only the changed names; the row shows them');

  // Renamed names, read and written by the task engine under the note's names.
  const notes = { 'Tasks/A.md': { title: 'A', status: 'open', prio: 'high', deadline: '2026-10-01', tags: ['task'], other: 1 }, 'Tasks/B.md': { status: 'open', tags: ['task'], due: 'left alone' } };
  const tfiles = Object.fromEntries(Object.keys(notes).map((p) => [p, new TFile(p)]));
  const eapp = { vault: { getAbstractFileByPath: (p) => (p === 'Tasks' ? new TFolder('Tasks', Object.values(tfiles)) : tfiles[p] || null) }, metadataCache: { getFileCache: (f) => ({ frontmatter: notes[f.path] }), getFirstLinkpathDest: () => null }, fileManager: { async processFrontMatter(f, fn) { fn(notes[f.path]); } } };
  const ren = new Engine({ app: eapp, settings: {} });
  const readBack = Object.fromEntries(ren.collectTasks(false).map((t) => [t.path, [t.due, t.plannedDay]]));
  eq(readBack, { 'Tasks/A.md': ['2026-10-01', '2026-10-01'], 'Tasks/B.md': [null, null] }, 'renamed: due read from "deadline"; a stray "due" is not read');
  const tnRen = new Engine({ app: eapp, settings: { tnSnapshot: { fieldMapping: { priority: 'tnPrio' } } } });
  eq(tnRen.collectTasks(false).find((t) => t.path === 'Tasks/A.md').priority, 'high', 'renamed in LifeWorld: its names win over a TaskNotes field mapping');
  const mv = await ren.move('Tasks/A.md', '2026-10-05', 'am', 10);
  await ren.move('Tasks/B.md', '2026-10-06', 'pm', 20);
  eq(notes, { 'Tasks/A.md': { title: 'A', status: 'open', prio: 'high', deadline: '2026-10-05', tags: ['task'], other: 1, planned_half: 'am', planned_order: 10 }, 'Tasks/B.md': { status: 'open', tags: ['task'], due: 'left alone', plan_day: '2026-10-06', planned_half: 'pm', planned_order: 20 } }, 'renamed: a move writes under the note\'s names, every other key untouched');
  await mv.undo();
  eq(notes['Tasks/A.md'], { title: 'A', status: 'open', prio: 'high', deadline: '2026-10-01', tags: ['task'], other: 1 }, 'renamed: Undo puts the note back');
  // Sync brings other names from the phone: taken.
  disk[pn.dir] = JSON.stringify({ ...JSON.parse(disk[pn.dir]), lifeworld: { vault: { names: {}, folders: { goals: 'Aims' } } } });
  await pn.host.onExternalSettingsChange();
  eq([nameRow().desc, vaultRows(pn.host).find((r) => r.name === 'Goals folder').value], ['status, due, scheduled, priority, projects, reminders', 'Aims'], 'a Your vault change from Sync is taken');
  pn.host.unload();

  // core/vault.js on its own: the name translation and the saved-settings guard.
  const CV = fromSrc('core/vault');
  CV.setVault({ names: { due: 'deadline', status: 'state' } });
  eq(CV.readable({ deadline: 'd', state: 's', due: 'stale', x: 1 }), { x: 1, status: 's', due: 'd' }, 'readable: note names to LifeWorld names; a stale default-named key hidden');
  const raw = { a: 1, deadline: 'd', state: 's', due: 'stale' };
  CV.writable(raw, (v) => { v.due = 'D'; delete v.status; v.planned_day = 'p'; delete v.a; v.b = 2; });
  eq(raw, { deadline: 'D', due: 'stale', planned_day: 'p', b: 2 }, 'writable: changes go back under the note names; other keys kept, removed or added');
  eq(Object.keys(CV.toNote({ title: 't', due: 'd', tags: [] })), ['title', 'deadline', 'tags'], 'toNote: a new note under the note names, same order');
  CV.setVault({ names: { due: 'x', status: 'x' } });
  eq([CV.propNames.due, CV.propNames.status, CV.isRenamed()], ['due', 'status', false], 'a saved file with two rows the same falls back to the default names');
  const same = { due: 1 };
  ok(CV.readable(same) === same, 'nothing renamed: the very same frontmatter object is read');
  eq(CV.namesProblem([['A', 'ok'], ['B', ' ok ']]), 'Two rows use "ok". Each needs its own name.', 'names are compared trimmed');

  // Review p2-s4 should-fix 1: a name Obsidian or LifeWorld already reads is refused, in any case.
  for (const r of ['tags', 'Aliases', 'cssclasses', 'archived', 'weekly_goal', ' contexts ']) eq(CV.namesProblem([['Title', r]]), `"${r.trim()}" is already used by Obsidian or LifeWorld. Pick another name.`, `"${r.trim()}" refused`);
  CV.setVault({ names: { title: 'tags' } });
  eq([CV.propNames.title, CV.isRenamed()], ['title', false], 'a saved file renaming to a reserved name falls back to the default names');
  CV.setVault(null);
  // Review p2-s5 must-fix 2 and optional 8: with a preset in the build, a saved empty note path means
  // none (it beats the preset), a missing or damaged one takes the preset, a folder-style one is none.
  const PV = fromSrc('core/vault');
  PV.startWith({ feeds: { calendar: 'P/Cal.md', weather: 'P/W.md' } });
  eq({ ...PV.feedNotes }, { calendar: 'P/Cal.md', weather: 'P/W.md' }, 'preset: nothing saved, the preset notes');
  PV.setVault({ feeds: { calendar: '', weather: 7 } });
  eq({ ...PV.feedNotes }, { calendar: '', weather: 'P/W.md' }, 'preset: a saved empty path is none; a damaged one takes the preset');
  PV.setVault({ feeds: { calendar: '02 Planner/', weather: ' Feeds/W.md ' } });
  eq({ ...PV.feedNotes }, { calendar: '', weather: 'Feeds/W.md' }, 'a folder-style note path is none; a note path is cleaned');
  // The list comes from the code: every engine field outside the renamable ones is reserved.
  const fieldsSrc = fs.readFileSync(path.join(ROOT, 'src', 'projects', 'main.js'), 'utf8');
  const fixed = [...fieldsSrc.slice(fieldsSrc.indexOf('const DEFAULT_FIELDS'), fieldsSrc.indexOf('};', fieldsSrc.indexOf('const DEFAULT_FIELDS'))).matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]);
  ok(fixed.length > 15, 'the engine field list was found');
  eq(fixed.filter((f) => !CV.PROPS.includes(f) && !CV.isReserved(f)), [], 'every fixed-name engine field is reserved');
  ok(/fm\.weekly_goal/.test(fs.readFileSync(path.join(ROOT, 'src', 'planner', 'main.js'), 'utf8')) && CV.isReserved('weekly_goal'), "the Planner's weekly_goal is reserved");
  const dlgR = await start({});
  const nr = vaultRows(dlgR.host).find((r) => r.name === 'Property names');
  let mR; const MR = LW.PropertyNamesModal; const oR = MR.prototype.open; MR.prototype.open = function () { mR = this; oR.call(this); }; nr.buttons[0].click(); MR.prototype.open = oR;
  mR.inputs.find((x) => x.label === 'Title').t.type('tags');
  eq([mR.err.text, mR.done.disabled, mR.inputs.find((x) => x.label === 'Title').t.inputEl.cls.includes('lw-bad')], ['"tags" is already used by Obsidian or LifeWorld. Pick another name.', true, true], 'dialog: a reserved name is refused, its row marked, Done off');
  dlgR.host.unload();

  // Review p2-s4 nice-to-have 3: a save that ends during the Sync read, with the file already holding
  // the result, needs no extra write.
  const calm = await start({ 'a4-today': { layout: ['a'] } });
  const readQ = calm.host.loadData;
  calm.host.loadData = async function () { await calm.parts['a4-today'].saveData({ layout: ['a'] }); return readQ.call(this); };
  writes.length = 0;
  await calm.host.onExternalSettingsChange();
  calm.host.loadData = readQ;
  await calm.host.saving;
  eq(writes, ['begin', 'end'], 'save during the Sync read, nothing new: only that save, no extra write');
  calm.host.unload();

  // Review p2-s5 should-fix 1: after that skipped write, the next Sync change to the same corner is
  // taken (the record of what is on disk must be our save, not the older file the read returned).
  const skip = await start({ 'a4-today': { layout: ['a'] } });
  const readS = skip.host.loadData;
  skip.host.loadData = async function () { const d = await readS.call(this); await skip.parts['a4-today'].saveData({ layout: ['b'] }); return d; };
  disk[skip.dir] = JSON.stringify({ 'a4-today': { layout: ['a'] } });
  await skip.host.onExternalSettingsChange();
  skip.host.loadData = readS;
  await skip.host.saving;
  disk[skip.dir] = JSON.stringify({ 'a4-today': { layout: ['c'] } });
  await skip.host.onExternalSettingsChange();
  await skip.host.saving;
  eq(await skip.parts['a4-today'].loadData(), { layout: ['c'] }, 'skipped write after a Sync read: the next Sync change to that setting is taken');
  skip.host.unload();

  // Review p2-s4 should-fix 2: a task note deleted from the tasks folder (here the default "Tasks", no
  // "TaskNotes" in the path) redraws the task links.
  const tl = await start({});
  const TL = LW.parts['a4-projects'].TaskLinks;
  const evs = {};
  const tlApp = { metadataCache: { on: (n, f) => { evs[n] = f; } }, vault: { on: (n, f) => { evs[n] = f; } }, workspace: { updateOptions() {} } };
  const links = new TL({ app: tlApp, engine: { isTaskFile: () => false }, registerMarkdownPostProcessor() {}, registerEditorExtension() {}, registerEvent() {}, register() {} });
  links.editorExtension = () => null;
  let redraws = 0; links.refreshSoon = () => { redraws++; };
  links.start();
  evs.delete(new TFile('Tasks/Gone.md')); evs.delete(new TFile('Notes/Other.md'));
  evs.rename(new TFile('Tasks/Renamed.md'));
  eq(redraws, 2, 'deleting or renaming a note in the tasks folder redraws task links; other notes do not');
  // Review p2-s8 #3: CodeMirror loads when the links start; a missing module turns off only the Live Preview links.
  for (const missing of [false, true]) {
    const exts = []; let updated = 0; const Mod = require('module'); const load = Mod._load; const warn = console.warn; const warned = [];
    if (missing) Mod._load = function (r, ...a) { if (r === '@codemirror/language') throw new Error('planted: no module'); return load.call(this, r, ...a); };
    console.warn = (m) => warned.push(m);
    const cmLinks = new TL({ app: { ...tlApp, workspace: { updateOptions: () => updated++ } }, engine: { isTaskFile: () => false }, registerMarkdownPostProcessor() {}, registerEditorExtension: (e) => exts.push(e), registerEvent() {}, register() {} });
    cmLinks.editorExtension = (cm) => (typeof cm.syntaxTree === 'function' && typeof cm.ViewPlugin === 'function' && typeof cm.StateEffect === 'function' ? 'ext' : null);
    try { cmLinks.start(); await new Promise((r) => setTimeout(r, 0)); } finally { Mod._load = load; console.warn = warn; }
    eq([exts.length, exts[0], updated, warned.length], missing ? [1, [], 0, 1] : [1, ['ext'], 1, 0], missing ? 'task links: a missing CodeMirror module is logged and only Live Preview links are off' : 'task links: CodeMirror loads at start and the editors are told');
  }
  tl.host.unload();

  // ---- Section 6: the Sidebar's content is stored data; a part switched off hides its buttons ----
  const SBL = LW.parts['a4-sidebar'].__logic;
  const VLT = SBL.SBC; // the live object the Sidebar reads
  // The Sidebar exactly as it was written into the Sidebar's code before section 6.
  const OLD_SB = {
    groups: [
      { id: 'direction', label: 'Direction', folders: ['Key Elements', 'Goals', 'Personal projects', 'Unsorted projects', 'Habits', 'Topics'] },
      { id: 'wellbeing', label: 'Wellbeing', folders: ['Health', 'Mood'] },
      { id: 'money', label: 'Money & work', folders: ['Work projects', 'Finance', 'Charts'] },
      { id: 'free', label: 'Free time', folders: ['Movies', 'Media', 'Reading', 'Sports', 'Recipes', 'Trips', 'Guide'] },
      { id: 'notes', label: 'Notes', folders: ['Notes', 'Weather'] },
    ],
    icons: { 'Charts': 'chart', Finance: 'wallet', Goals: 'target', Guide: 'map', Habits: 'flame', Health: 'pulse', 'Key Elements': 'diamond', Media: 'music', Mood: 'smile', Movies: 'film', Notes: 'note', Projects: 'kanban', Reading: 'book', Recipes: 'chef', Sports: 'trophy', Topics: 'hash', Trips: 'plane', Weather: 'cloudSun', 'Work projects': 'kanban', 'Personal projects': 'kanban', 'Unsorted projects': 'kanban' },
    labels: { Media: 'Music', Guide: 'Places' },
    noCount: ['Finance', 'Health', 'Charts', 'Weather', 'Mood', 'Sports'],
    rooms: [['00 ', 'Daily Notes', 'pen'], ['01 ', 'Inbox', 'inbox'], ['02 ', 'Planner', 'calendar'], ['03 ', 'Desk', 'bench'], ['04 ', 'Library', 'sparkle'], ['05 ', 'Assets', 'box'], ['06 ', 'Admin', 'bot']].map(([prefix, name, icon], c) => ({ prefix, name, icon, c })),
  };
  // New install: no groups, no rooms; the top folders A to Z under "Folders", plain; named LifeWorld.
  const sb0 = await start({});
  eq([VLT.brand, VLT.life, VLT.groups, VLT.rooms, VLT.basesSkip], ['LifeWorld', '', [], [], []], 'new install: no Sidebar groups, rooms or skipped bases; named LifeWorld');
  eq(SBL.findRoomFolders(['Notes', 'Attachments', 'daily', '03 Desk']), [['03 Desk', 'folder'], ['Attachments', 'folder'], ['daily', 'folder'], ['Notes', 'folder']].map(([name, icon]) => ({ name, icon, path: name })), 'new install: every top folder, A to Z, plain (no room colour)');
  eq(SBL.listBases(['02 Planner/TaskNotes/Views/a.base']).length, 1, 'new install: no base left out of the Bases list');
  sb0.host.unload();
  // The owner's preset (the frozen vault's LifeWorld file): the very groups, icons, names, counts
  // and rooms the old code had, so the owner's Sidebar draws as before.
  const ownerFile = JSON.parse(fs.readFileSync(path.join(FIX, '.obsidian', 'plugins', 'lifeworld', 'data.json'), 'utf8'));
  const sb1 = await start(ownerFile);
  eq([VLT.brand, VLT.life, VLT.groups, VLT.icons, VLT.labels, VLT.noCount, VLT.basesSkip], ['Home', '04 Library/My Life', OLD_SB.groups, OLD_SB.icons, OLD_SB.labels, OLD_SB.noCount, ['02 Planner/TaskNotes/']], "owner's preset: brand, My Life folder, groups, icons, names, counts and skipped bases as before");
  const rootNames = fs.readdirSync(FIX, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name);
  const oldRooms = OLD_SB.rooms.map((r) => { const p = rootNames.filter((x) => x.startsWith(r.prefix)).sort()[0]; return p ? { ...r, path: p } : null; }).filter(Boolean);
  eq(SBL.findRoomFolders(rootNames), oldRooms, "owner's preset: the frozen vault's rooms, names, icons and colours as before");
  ok(oldRooms.length >= 3, 'the frozen vault has rooms to compare');
  eq(SBL.buildLifeGroups(['Notes', 'Health', 'Goals', 'Projects', 'Odd']).map((g) => [g.label, g.items]), [['Direction', ['Goals', 'Personal projects', 'Unsorted projects']], ['Wellbeing', ['Health']], ['Money & work', ['Work projects']], ['Notes', ['Notes']], ['More', ['Odd']]], "owner's preset: My Life groups as before (Projects split, the rest under More)");
  eq([SBL.itemLabel('Guide'), SBL.itemIcon('Work projects'), SBL.itemShowsCount('Finance'), SBL.itemShowsCount('Goals')], ['Places', 'kanban', false, true], "owner's preset: a label, an icon and the counts as before");
  // A damaged value (wrong type, an empty room start) counts as missing; the other values stay.
  sb1.host.store.lifeworld.vault.sidebar = { ...ownerFile.lifeworld.vault.sidebar, groups: 'x', rooms: [{ prefix: '', name: 'All', icon: 'box' }], brand: ' ' };
  await sb1.host.setVaultSettings({ folders: {} }); // reads the whole stored block again
  eq([VLT.groups, VLT.rooms, VLT.brand, VLT.labels], [[], [], 'LifeWorld', OLD_SB.labels], 'a damaged Sidebar value falls back to the new-install default; the others are kept');
  sb1.host.unload();
  // Switching a part off or on redraws the tabs still open (the Sidebar draws now, the others schedule it).
  const sw = await start({});
  const drawn = [];
  sw.app.workspace.getLeavesOfType = (t) => (t === 'a4-sidebar-view' ? [{ view: { render: () => drawn.push('sidebar') } }] : t === 'a4-projects-view' ? [{ view: { scheduleRender: () => drawn.push('projects') } }] : []);
  await sw.host.setPart('a4-planner', false);
  eq(drawn, ['projects', 'sidebar'], 'a part switched off: the open Projects and Sidebar tabs draw again');
  sw.host.unload();
  // A Today tab already open when LifeWorld starts draws again once every part is running, so its
  // Planner button shows (it was drawn before the Planner started).
  const early = []; const from = log.length;
  openTabs = { 'a4-today-view': [{ view: { scheduleRefresh: () => early.push(log.slice(from).includes('started a4-sidebar') ? 'after all parts' : 'too early') } }] };
  const st = await start({});
  openTabs = {};
  eq(early, ['after all parts'], 'an open Today tab draws again once every part has started');
  st.host.unload();
  // Today: the Planner button and the Planner shortcut go while the Planner is off, and come back.
  const TV = LW.parts['a4-today'].TodayView.prototype;
  const tp = Object.create(LW.parts['a4-today'].prototype);
  tp.app = { commands: { commands: { 'a4-planner:open': {} } } };
  const btn = fakeEl('button'); const card = fakeEl('div');
  const box = () => Object.assign(fakeEl('div'), { createSpan: () => box(), createEl: () => box(), appendText() {} });
  const tv = { plugin: tp, planBtn: btn, data: { today: '2026-10-14', lists: { total: 0 } }, openCount: () => 0, kickerEl: fakeEl(), greetEl: fakeEl(), plateEl: fakeEl() };
  const offNow = () => [btn.cls.includes('a4t-off'), card.cls.includes('a4t-off')];
  TV.renderHeader.call(tv); TV.renderPlannerLink.call(tv, box(), card);
  eq(offNow(), [false, false], 'Planner on: Today shows its Planner button and shortcut');
  tp.app.commands.commands = {};
  TV.renderHeader.call(tv); TV.renderPlannerLink.call(tv, box(), card);
  eq(offNow(), [true, true], 'Planner off: Today hides its Planner button and shortcut, as drawn');
  tp.app.commands.commands = { 'a4-planner:open': {} };
  TV.renderHeader.call(tv); TV.renderPlannerLink.call(tv, box(), card);
  eq(offNow(), [false, false], 'Planner back on: both come back');
  // Launch section 1: the Active projects card goes while the Projects pages are off.
  const pcard = fakeEl('div'); tv.app = { vault: {} }; tv.cardHead = () => {};
  tp.projectsPlugin = () => null; tv.data.projects = [];
  tp.app.commands.commands = {};
  TV.renderProjects.call(tv, box(), pcard);
  ok(pcard.cls.includes('a4t-off'), 'Projects pages off: no Active projects card on Today');
  tp.app.commands.commands = { 'a4-projects:open': {} };
  TV.renderProjects.call(tv, box(), pcard);
  ok(!pcard.cls.includes('a4t-off'), 'Projects pages on: the card is back');

  // ---- Section 6 review fixes ----
  {
  // A switch redraws the open task cards too; one view that fails to draw does not stop the rest.
  const rv = await start({});
  const drew = [];
  rv.app.workspace.getLeavesOfType = (t) => (t === 'a4-sidebar-view' ? [{ view: { render: () => drew.push('sidebar') } }] : t === 'a4-projects-view' ? [{ view: { scheduleRender: () => { throw new Error('planted'); } } }] : []);
  rv.host.running['a4-projects'].cards = { refreshAll: () => drew.push('cards') };
  const errs = []; const ce = console.error; console.error = (...a) => errs.push(a[0]);
  try { await rv.host.setPart('a4-planner', false); } finally { console.error = ce; }
  eq(drew, ['sidebar', 'cards'], 'a part switched: task cards redraw, and a failing tab does not stop the others');
  eq(errs, ['LifeWorld: a4-projects-view did not redraw'], 'the failing tab is logged');
  rv.host.unload();
  // The Sidebar's tab title follows a changed name.
  const hdr = []; const sv = Object.create(SBL.SidebarView.prototype);
  Object.assign(sv, { titleEl: { setText: (t) => hdr.push(`title ${t}`) }, leaf: { updateHeader: () => hdr.push('header') } });
  const brand0 = VLT.brand;
  sv.syncTitle(); eq(hdr, [], 'tab title: nothing to change on the first draw');
  VLT.brand = 'My Place'; sv.syncTitle(); sv.syncTitle();
  eq(hdr, ['title My Place', 'header'], 'tab title: a changed Sidebar name updates the tab header once');
  VLT.brand = brand0;
  }

  // ---- Section 7: the calendar sync hook an add-on sets, true wording without one ----
  {
    const cs = await start({});
    const today = () => cs.host.running['a4-today'];
    eq(today().canRunSync(), false, 'no add-on: the Today page has no calendar sync');
    const sync = async () => true;
    const remove = cs.host.setCalendarSync(sync);
    eq([today().calendarSync, today().canRunSync(), await today().runCalendarSync(true)], [sync, true, true], "an add-on's calendar sync reaches the Today page and runs");
    await cs.host.setPart('a4-today', false); await cs.host.setPart('a4-today', true);
    eq(today().calendarSync, sync, 'the sync is kept when the Today page is switched off and on');
    const other = async () => true; const removeOther = cs.host.setCalendarSync(other);
    remove();
    eq(today().calendarSync, other, 'an older remover does not take away a newer sync');
    removeOther();
    eq([today().calendarSync, cs.host.calendarSync], [null, null], 'removed: no sync again');
    cs.host.setCalendarSync('not a function');
    eq(today().canRunSync(), false, 'anything but a function is no sync');
    cs.host.unload();
    // No calendar note and no sync (a new install): Settings shows no Calendars picker at all.
    const TS = LW.parts['a4-today'].TodaySettingTab.prototype;
    const calHost = fakeEl('div');
    TS.renderCalendars.call({ calHost, plugin: { calendarList: () => [], calendarFrontmatter: () => null, calSel: null, canRunSync: () => false } });
    eq(calHost.kids.length, 0, 'no calendar note, no sync: no Calendars picker');
    // Launch section 2: the widget list in Settings, grouped as drawn, with arrows and switches.
    {
      const TL = LW.parts['a4-today'].logic;
      const wh = fakeEl('div'); let changed = 0;
      const plug = { layout: TL.defaultLayout(), taskKind: () => 'notes', partOn: (x) => x !== 'projects', async saveLayout(l) { this.layout = TL.normalizeLayout(l); }, layoutChanged() { changed++; } };
      const sh = fakeEl('div');
      plug.places = []; plug.pins = []; plug.habits = []; plug.canRunSync = () => false;
      const tab = { widgetsHost: wh, setupHost: sh, app: { vault: { getAbstractFileByPath: () => null }, loadLocalStorage: () => null }, plugin: plug, renderWidgetList: TS.renderWidgetList, renderSetup: TS.renderSetup };
      tab.renderSetup();
      eq(sh.kids.filter((k) => k.rec).map((k) => k.rec.name), ['Habits', 'Add a habit', 'Calendars', 'Add a calendar link'], 'the starter set: the Habits and Calendar setup sections; Weather, World clock and Pinned are off');
      tab.renderWidgetList();
      const groups = () => wh.kids.filter((k) => !k.rec && k.cls.includes('a4t-wl-group')).map((k) => k.text);
      const wrows = () => wh.kids.filter((k) => k.rec);
      const row = (name) => wrows().find((r) => r.rec.name === name);
      eq(groups(), ['Top strip', 'Left', 'Middle', 'Right'], 'widget list grouped Top, Left, Middle, Right');
      eq(wrows().map((r) => [r.rec.name, r.rec.on]), [['Quick capture', true], ['Weather', false], ['Morning tasks', true], ['Afternoon tasks', true], ['Overdue', true], ['Planner shortcut', false],
        ['Calendar', true], ['Recent notes', true], ['Mood', true], ['Habits', true], ['World clock', false], ['Active projects', false], ['Latest journal', false], ['Pinned shortcuts', false], ['Journal box', false]], 'every launch widget listed with its switch; the starter set on; the checkbox card left out for note tasks');
      const pj = row('Active projects');
      eq([pj.rec.desc, pj.rec.disabled, pj.settingEl.cls.includes('lw-dim')], ['Needs Projects (off under Parts)', true, true], 'a widget whose part is off: greyed, says which part, cannot be switched on');
      eq(row('Quick capture').rec.extras.map((b) => !!b.disabled), [true, true], 'Top strip: the only shown widget cannot move');
      await row('World clock').rec.change(true);
      eq([plug.layout.zones.c2.slice(-1), changed], [['clock'], 1], 'switched on: at the end of its column, and the open Today page follows');
      ok(sh.kids.some((k) => k.rec && k.rec.heading && k.rec.name === 'World clock') && sh.kids.some((k) => k.rec && k.rec.name === 'Add a place'), 'World clock on: its setup section shows');
      // Add a place (2026-10-20): one search box with matches as you type, no time zone list or Add button.
      const addRow = sh.kids.find((k) => k.rec && k.rec.name === 'Add a place');
      eq([!!addRow.rec.text, addRow.rec.options, addRow.rec.buttons, addRow.rec.desc], [true, undefined, undefined, 'Type 3 or more letters, then pick a city from the list. Its time zone is filled in for you. Searching needs internet; the clocks do not.'], 'Add a place: one search box, no time zone list, the 3-letter wording');
      const sug = suggests[suggests.length - 1];
      const PlaceSuggest = sug.constructor; // Today's own type-ahead class, as Settings made it
      eq([PlaceSuggest.name, sug.inputEl === addRow.rec.text.inputEl, addRow.rec.text.inputEl.on.change], ['PlaceSuggest', true, undefined], 'Add a place: the type-ahead list is on that box; nothing waits for Enter');
      // Picking a match adds it as 0.2.1 did: city and region, the match's zone; the box empties and the list closes.
      const GJ = { name: 'Grand Junction, Colorado, United States', short: 'Grand Junction, Colorado', tz: 'America/Denver' };
      plug.savePlaces = async function (list) { this.places = TL.normalizePlaces(list); }; // the real one also writes data.json
      plug.places = [{ name: 'Fresno, CA', tz: 'America/Los_Angeles' }]; sug.value = 'grand junction';
      await sug.selectSuggestion(GJ);
      eq([plug.places, sug.value, sug.closed, sh.kids.some((k) => k.rec && k.rec.name === 'Grand Junction, Colorado' && k.rec.desc === 'America/Denver')], [[{ name: 'Fresno, CA', tz: 'America/Los_Angeles' }, { name: 'Grand Junction, Colorado', tz: 'America/Denver' }], '', 1, true], 'pick: added with its zone, box emptied, list closed, shown in the settings list');
      notices.length = 0; const before = plug.places;
      await suggests[suggests.length - 1].selectSuggestion({ ...GJ, tz: 'Nope/Zone' });
      eq([plug.places, notices], [before, ['This device cannot show the time for Grand Junction, Colorado, United States.']], 'pick: a zone this device cannot read adds nothing, same notice as 0.2.1');
      await suggests[suggests.length - 1].selectSuggestion({ none: 'qzxq' });
      eq(plug.places, before, 'pick: the no-match line cannot be picked');
      plug.places = [];
      // The search itself, with a stand-in place service.
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const settles = (p, ms = 400) => Promise.race([p.then((v) => ({ v })), wait(ms).then(() => 'pending')]);
      const asked = []; let answer = (q) => [{ ...GJ, q }];
      const ps = new PlaceSuggest({}, fakeEl('input'), () => {}, async (q) => { asked.push(q); return answer(q); });
      eq([ps.getSuggestions('gr'), ps.getSuggestions(' gr '), ps.getSuggestions(''), asked], [[], [], [], []], 'fewer than 3 letters (spaces not counted): no search, an empty list (closes it)');
      const pending = ps.getSuggestions('gra'); eq(ps.getSuggestions('gr'), [], 'back to 2 letters: empty list'); await wait(350);
      eq([asked, await settles(pending)], [[], 'pending'], 'back to 2 letters before the pause: the waiting search is not made');
      let last; for (const [k, word] of [...'grand junction'].entries()) { last = ps.getSuggestions('grand junction'.slice(0, k + 1)); await wait(word === ' ' ? 350 : 40); }
      eq([asked, (await last).map((m) => m.q)], [['grand', 'grand junction'], ['grand junction']], 'typing with one pause: one search per pause, not per letter; the list is the last query\'s');
      // Out of order: "gra" answers after "grand junction"; the list keeps the newer matches.
      const gates = {}; answer = (q) => new Promise((r) => { gates[q] = () => r([{ ...GJ, q }]); }); asked.length = 0;
      const old = ps.getSuggestions('gra'); await wait(350);
      const neu = ps.getSuggestions('grand junction'); await wait(350);
      gates['grand junction'](); eq((await neu).map((m) => m.q), ['grand junction'], 'newer search: its matches');
      gates.gra(); eq([asked, await settles(old)], [['gra', 'grand junction'], 'pending'], 'older, slower answer: dropped, never replaces the newer list');
      // No match: one line that cannot be picked, no notice.
      notices.length = 0; answer = () => [];
      const nm = await ps.getSuggestions('qzxq'); const nmEl = fakeEl('div'); ps.renderSuggestion(nm[0], nmEl);
      eq([nm, nmEl.text, notices], [[{ none: 'qzxq' }], 'No place called "qzxq" was found.', []], 'no match: one line in the list, no corner notice');
      const mEl = fakeEl('div'); ps.renderSuggestion(GJ, mEl);
      eq(mEl.kids.map((k) => [k.cls[0], k.text]), [['a4t-pick-name', 'Grand Junction, Colorado, United States'], ['a4t-pick-tz', 'America/Denver']], 'a match: city, region, country with its zone beside it');
      // No internet: one notice until a search works again (or Settings reopens: a new box).
      answer = () => { throw new Error('network'); };
      eq([await ps.getSuggestions('lon'), await ps.getSuggestions('lond'), notices], [[], [], ['Could not search places right now. Check the internet connection.']], 'failed searches while typing: one notice, empty list');
      answer = (q) => [{ ...GJ, q }]; await ps.getSuggestions('londo');
      answer = () => { throw new Error('network'); }; await ps.getSuggestions('london');
      eq(notices.length, 2, 'after a search works, a new failure shows the notice again');
      // A pick makes a waiting or in-flight search an old one: no stray list after the pick (review s1, 2026-10-20).
      answer = (q) => [{ ...GJ, q }]; asked.length = 0;
      const waiting = ps.getSuggestions('grand j'); await ps.selectSuggestion(GJ); await wait(350);
      eq([asked, await settles(waiting)], [[], 'pending'], 'pick while a search waits for the pause: that search is not made, its list never opens');
      answer = (q) => new Promise((r) => { gates[q] = () => r([{ ...GJ, q }]); });
      const flying = ps.getSuggestions('grand ju'); await wait(350); await ps.selectSuggestion(GJ); gates['grand ju']();
      eq([asked, await settles(flying)], [['grand ju'], 'pending'], 'pick while a search is under way: its late answer is dropped');
      // The card: no "Here" tile; one line per place (name, time, day) in the order saved; none with no places.
      const TVc = LW.parts['a4-today'].TodayView.prototype;
      const drawClock = (places) => { const body = fakeEl('div'); body.isConnected = true; const heads = []; TVc.renderClockWidget.call({ plugin: { places }, cardHead: (b, k, t) => heads.push(t) }, body, fakeEl('div')); return { body, heads }; };
      const find = (el, cls, out = []) => { for (const k of el.kids || []) { if (k.cls && k.cls.includes(cls)) out.push(k); find(k, cls, out); } return out; };
      const two = drawClock([{ name: 'Fresno, CA', tz: 'America/Los_Angeles' }, { name: 'Windsor, CO', tz: 'America/Denver' }]);
      const lines = find(two.body, 'a4t-clk-place');
      const at = TL.clockAt(new Date(), 'America/Denver');
      eq([two.heads, find(two.body, 'a4t-clk-city').length, lines.length, lines.map((l) => l.kids.map((k) => k.cls[0])), lines.map((l) => [l.kids[0].text, l.kids[0].attr.title])],
        [['3 places'], 0, 2, [['a4t-clk-name', 'a4t-clk-time', 'a4t-clk-day'], ['a4t-clk-name', 'a4t-clk-time', 'a4t-clk-day']], [['Fresno, CA', 'Fresno, CA'], ['Windsor, CO', 'Windsor, CO']]], 'World clock card: no Here tile, one line per place in saved order, full name on hover, count unchanged');
      eq([lines[1].kids[2].text, /^\d\d:\d\d [ap]m$/.test(lines[1].kids[1].text)], [at.day, true], 'each line: that zone\'s time and day');
      const none = drawClock([]);
      eq([none.heads, find(none.body, 'a4t-clk-places').length], [['1 place'], 0], 'no places: only the big clock, no empty list');
      await row('Calendar').rec.extras[0].click();
      eq([plug.layout.zones.c1.slice(-1), plug.layout.zones.c2[0]], [['calendar'], 'recent'], 'up from the top of Middle: into Left');
      plug.taskKind = () => 'checkbox'; tab.renderWidgetList();
      ok(row("Today's tasks") && !row('Morning tasks') && !row('Afternoon tasks'), "checkbox tasks: one Today's tasks card instead of Morning and Afternoon");
    }
    // The picker's words hold without the Mac add-on: no Mac, macOS or "every 10 minutes".
    const tsrc = fs.readFileSync(path.join(ROOT, 'src', 'today', 'main.js'), 'utf8');
    const picker = tsrc.slice(tsrc.indexOf('  renderCalendars() {'), tsrc.indexOf('accounts.forEach((acc) =>'));
    ok(picker.length > 500 && !/macOS|Mac\b|Mac’s|10 minutes/.test(picker), 'Calendars picker wording: nothing about a Mac or a 10-minute sync');
  }

  // ---- Section 7 review fixes (p2-s7) ----
  {
    const brand0 = VLT.brand;
    // The tab title: Obsidian's two calls gone, or throwing, never stop the Sidebar drawing.
    const bare = Object.create(SBL.SidebarView.prototype);
    bare.syncTitle(); VLT.brand = 'Elsewhere'; bare.syncTitle();
    eq(bare.shownTitle, 'Elsewhere', 'tab title: no titleEl and no updateHeader, no error');
    const bad = Object.create(SBL.SidebarView.prototype);
    Object.assign(bad, { titleEl: { setText() {} }, leaf: { updateHeader() { throw new Error('planted'); } } });
    const errs = []; const ce = console.error; console.error = (...a) => errs.push(a[0]);
    try { bad.syncTitle(); VLT.brand = 'Again'; bad.syncTitle(); } finally { console.error = ce; }
    eq(errs, ['LifeWorld: the Sidebar tab title did not update'], 'tab title: a throwing updateHeader is logged, not thrown');
    VLT.brand = brand0;
    // Phase 2 section 8: Projects' tab title uses the same two internals, guarded the same way.
    const PJV = LW.parts['a4-projects'].ProjectsView;
    Object.getPrototypeOf(PJV.prototype).setState = async () => {};
    const pv = () => Object.assign(Object.create(PJV.prototype), { state: {}, expanded: new Set(), render() {}, getDisplayText: () => 'Projects' });
    const hdr2 = []; const good = Object.assign(pv(), { titleEl: { setText: (t) => hdr2.push(`title ${t}`) }, leaf: { updateHeader: () => hdr2.push('header') } });
    await good.setState({ page: 'inbox' }, {});
    eq(hdr2, ['header', 'title Projects'], 'Projects tab title: updateHeader, then the header strip');
    await pv().setState({ page: 'inbox' }, {});
    ok(true, 'Projects tab title: no titleEl and no updateHeader, no error');
    const strip = []; const pbad = Object.assign(pv(), { titleEl: { setText: (t) => strip.push(t) }, leaf: { updateHeader() { throw new Error('planted'); } } });
    const perrs = []; console.error = (...a) => perrs.push(a[0]);
    let opened = true;
    try { await pbad.setState({ page: 'inbox' }, {}); } catch { opened = false; } finally { console.error = ce; }
    ok(opened && perrs[0] === 'LifeWorld: the Projects tab title did not update', 'Projects tab title: a throwing updateHeader is logged, the tab still opens');
    eq(strip, ['Projects'], 'Projects tab title: a throwing updateHeader still lets the header strip update (review p2-s8 #5)');
    // A calendar sync that arrives while Settings is open redraws the Calendars picker.
    const cs = await start({});
    const drawn = [];
    const tab = { calHost: { isConnected: true }, renderCalendars: () => drawn.push('picker') };
    cs.host.running['a4-today'].settingTab = tab;
    const remove = cs.host.setCalendarSync(async () => true);
    eq(drawn, ['picker'], 'a sync set while Settings is open: the Calendars picker draws again');
    tab.calHost.isConnected = false; remove();
    eq(drawn, ['picker'], 'Settings closed: no redraw');
    cs.host.unload();
  }

  // ---- Section 7: the add-on hooks (a Sidebar item, a toolbar button, a Today widget) ----
  {
    const SB = LW.parts['a4-sidebar'].__logic;
    const TL = LW.parts['a4-today'].logic;
    const TV = LW.parts['a4-today'].TodayView.prototype;
    const tick = () => new Promise((r) => setTimeout(r, 20));
    const ex = await start({ 'a4-today': { layout: { zones: { top: [], c1: ['tides'], c2: [], c3: [] }, hidden: ['journal'] } } });
    const redrew = [];
    ex.host.running['a4-sidebar'].extrasChanged = () => redrew.push('sidebar');
    const clicks = [];
    // Checked at the door: what is missing or already taken is refused, nothing is added.
    const throwsMsg = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    ok(/needs id, label, icon \(text\) and onClick/.test(throwsMsg(() => ex.host.addSidebarItem({ id: 'x', label: 'X', icon: 'star' }))), 'a Sidebar item without onClick is refused');
    ok(/needs id, name \(text\) and render/.test(throwsMsg(() => ex.host.addTodayWidget({ id: ' ', name: 'Tides', render() {} }))), 'a Today widget with a blank id is refused');
    ok(/already a Sidebar item "today"/.test(throwsMsg(() => ex.host.addSidebarItem({ id: 'today', label: 'T', icon: 'sun', onClick() {} }))), "a Sidebar item cannot take a built-in row's id");
    ok(/already a Today widget "weather"/.test(throwsMsg(() => ex.host.addTodayWidget({ id: 'weather', name: 'W', render() {} }))) && /already a Today widget "clock"/.test(throwsMsg(() => ex.host.addTodayWidget({ id: 'clock', name: 'G', render() {} }))), "a Today widget cannot take a built-in widget's id");
    eq([SB.EXTRA.nav.length, SB.EXTRA.tools.length, TL.EXTRA_WIDGETS.length, redrew], [0, 0, 0, []], 'refused: nothing added, nothing redrawn');
    // A Sidebar item and a toolbar button: added, the Sidebar told, removed once.
    const rmItem = ex.host.addSidebarItem({ id: 'finance', label: 'Finance', icon: 'wallet', onClick: () => clicks.push('finance') });
    const rmTool = ex.host.addToolbarButton({ id: 'canvas2', label: 'New canvas', icon: 'layout-dashboard', onClick: () => { throw new Error('planted'); } });
    await tick();
    eq([SB.EXTRA.nav.map((x) => x.id), SB.EXTRA.tools.map((x) => x.id), redrew], [['finance'], ['canvas2'], ['sidebar', 'sidebar']], 'a Sidebar item and a toolbar button are added and the Sidebar redraws');
    ok(/already a Sidebar button "canvas2"/.test(throwsMsg(() => ex.host.addToolbarButton({ id: 'canvas2', label: 'Again', icon: 'x', onClick() {} }))), 'the same button id twice is refused');
    // Drawn as an Obsidian toolbar button; its click runs, a failing click is logged, not thrown.
    const bar = fakeEl('div');
    const btn = SB.extraButton(bar, 'clickable-icon nav-action-button', SB.EXTRA.tools[0]);
    const errs = []; const ce = console.error; console.error = (...a) => errs.push(a[0]);
    try { await btn.fire('click'); await tick(); await SB.runExtra(SB.EXTRA.nav[0]); } finally { console.error = ce; }
    eq([bar.kids.length, btn.attr['aria-label'], btn.attr['data-tool'], errs, clicks], [1, 'New canvas', 'canvas2', ['LifeWorld: add-on button canvas2 failed'], ['finance']], 'an add-on button: drawn with its label, a failing click logged, a working click runs');
    // Kept while the Sidebar is off; the Sidebar part that comes back draws them.
    await ex.host.setPart('a4-sidebar', false); await ex.host.setPart('a4-sidebar', true);
    eq(SB.EXTRA.nav.map((x) => x.id), ['finance'], 'add-on rows are kept while the Sidebar is switched off');
    ex.host.running['a4-sidebar'].extrasChanged = () => redrew.push('sidebar again');
    rmItem(); rmItem(); rmTool(); await tick();
    eq([SB.EXTRA.nav.length, SB.EXTRA.tools.length, redrew.slice(2)], [0, 0, ['sidebar again', 'sidebar again']], 'removed (a second remove does nothing); the Sidebar redraws');
    // A Today widget: its saved place and hidden state come back from the settings file.
    const today = ex.host.running['a4-today'];
    const rmW = ex.host.addTodayWidget({ id: 'tides', name: 'Tides', desc: 'High and low water', zone: 'c2', render: (body) => body.createDiv({ text: 'tides drawn' }) });
    await tick();
    eq([today.layout.zones.c1[0], today.layout.hidden.includes('journal')], ['tides', true], 'an add-on widget goes back where it was saved; hidden stays hidden');
    eq(TL.normalizeLayout(null).zones.c2.slice(-1), ['tides'], 'a new install: the add-on widget sits in its own column');
    const noC1 = TL.removeWidget(today.layout, 'tides');
    eq(TL.addWidget(noC1, 'tides', { c1: 9, c2: 1, c3: 5 }).zones.c2.slice(-1), ['tides'], '"Add widget" works for an add-on widget (shortest column)');
    // Drawn by its own render; a failing one shows the usual line, the page goes on.
    const view = { widgetFailed: TV.widgetFailed, data: {} };
    const cardEl = { removeClass() {} };
    // Each draw gets a fresh body in the old one's place (review p2-s7b); `body` follows it.
    const gc0 = global.createDiv; global.createDiv = () => fakeEl('div');
    let body = fakeEl('div');
    const follow = (b) => { b.replaceWith = (f) => { body = follow(f); }; return b; };
    follow(body);
    await TV.renderWidget.call(view, 'tides', body, cardEl);
    eq(body.kids.map((k) => k.text), ['tides drawn'], "an add-on widget draws with its own render");
    const rmBad = ex.host.addTodayWidget({ id: 'bad', name: 'Bad', render: async () => { throw new Error('planted'); } });
    const errs2 = []; console.error = (...a) => errs2.push(a[1]);
    try { await TV.renderWidget.call(view, 'bad', body, cardEl); } finally { console.error = ce; }
    eq([body.kids.map((k) => k.text), errs2], [['this part could not be drawn'], ['bad']], 'a failing add-on widget shows "this part could not be drawn" and is logged');
    global.createDiv = gc0;
    rmBad(); rmW(); await tick();
    eq([TL.EXTRA_WIDGETS.length, today.layout.zones.c1.includes('tides')], [0, false], 'removed: the widget leaves the layout (its saved place stays in the file)');
    eq(JSON.parse(disk[ex.dir])['a4-today'].layout.zones.c1, ['tides'], 'adding and removing an add-on widget writes nothing to the settings file');
    // An open Today page: the removed widget's card leaves the page and is forgotten; a hidden one only leaves.
    const gone = []; const card = (id) => ({ id, dataset: {}, toggleClass() {}, querySelector: () => ({}), detach() { gone.push(id); } });
    const zone = () => ({ children: [], insertBefore(el) { this.children.push(el); }, appendChild() {} });
    const page = { data: {}, plugin: { layout: today.layout }, zoneEls: { top: zone(), c1: zone(), c2: zone(), c3: zone() }, clockEl: {},
      widgetEls: new Map([['tides', card('tides')], ['journal', card('journal')]]), renderWidget() {}, renderCapture() {} };
    page.widgetEl = (id) => page.widgetEls.get(id) || (page.widgetEls.set(id, card(id)), page.widgetEls.get(id));
    TV.renderWidgets.call(page);
    eq([gone.sort(), page.widgetEls.has('tides'), page.widgetEls.has('journal')], [['journal', 'tides'], false, true], 'open page: a removed add-on widget leaves and is forgotten, a hidden one is kept for later');
    ex.host.unload();
  }

  // ---- Section 7 review fixes (p2-s7b) ----
  {
    const SB = LW.parts['a4-sidebar'].__logic;
    const TL = LW.parts['a4-today'].logic;
    const TV = LW.parts['a4-today'].TodayView.prototype;
    const tick = () => new Promise((r) => setTimeout(r, 20));
    const ex = await start({});
    ex.host.running['a4-sidebar'].extrasChanged = () => {};
    const throwsMsg = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const ce = console.error;
    // #2: the Sidebar's own Expand/Collapse button id is taken; so are the weather strip's class names.
    ok(/already a Sidebar button "toggle-all"/.test(throwsMsg(() => ex.host.addToolbarButton({ id: 'toggle-all', label: 'X', icon: 'x', onClick() {} }))), "a toolbar button cannot take the Sidebar's Expand/Collapse id");
    for (const id of ['main', 'upd', 'item']) ok(/already a Today widget/.test(throwsMsg(() => ex.host.addTodayWidget({ id, name: 'X', render() {} }))), `a Today widget cannot be "${id}" (its card would match a weather strip part)`);
    // #6: ids are letters, digits, dash and underscore only.
    for (const id of ['my widget', 'a"b', 'a.b']) ok(/letters, digits/.test(throwsMsg(() => ex.host.addSidebarItem({ id, label: 'X', icon: 'x', onClick() {} }))), `an id like ${JSON.stringify(id)} is refused`);
    eq([SB.EXTRA.nav.length, SB.EXTRA.tools.length, TL.EXTRA_WIDGETS.length], [0, 0, 0], 'refused ids add nothing');
    // #1: two overlapping draws of one async widget; the late first one (drawing or failing) never shows.
    const gc = global.createDiv; global.createDiv = () => fakeEl('div');
    let release; const gate = new Promise((r) => { release = r; });
    let draws = 0;
    const rm1 = ex.host.addTodayWidget({ id: 'slow', name: 'Slow', render: async (body) => { const n1 = ++draws; if (n1 === 1) { await gate; body.createDiv({ text: 'old' }); } else body.createDiv({ text: 'new' }); } });
    let shown = fakeEl('div');
    const card = { removeClass() {} };
    const swap = (b) => { b.replaceWith = (f) => { if (shown === b) shown = swap(f); }; return b; };
    swap(shown);
    const view = { widgetFailed: TV.widgetFailed, data: {} };
    const first = TV.renderWidget.call(view, 'slow', shown, card);
    await TV.renderWidget.call(view, 'slow', shown, card);
    release(); await first;
    eq(shown.kids.map((k) => k.text), ['new'], 'a slow earlier draw that finishes late does not land on the newer one');
    let fail; const failGate = new Promise((r) => { fail = r; });
    draws = 0;
    const rm2 = ex.host.addTodayWidget({ id: 'flaky', name: 'Flaky', render: async (body) => { if (++draws === 1) { await failGate; throw new Error('planted'); } body.createDiv({ text: 'fresh' }); } });
    console.error = () => {};
    try {
      const a = TV.renderWidget.call(view, 'flaky', shown, card);
      await TV.renderWidget.call(view, 'flaky', shown, card);
      fail(); await a;
    } finally { console.error = ce; }
    eq(shown.kids.map((k) => k.text), ['fresh'], 'a slow earlier draw that fails late does not clear the newer one');
    rm1(); rm2();
    // #8: the Files tab toolbar draws the add-on's button after LifeWorld's own, once per change.
    const fileTool = (o) => { const d = fakeEl('div'); d.cls.push(o.cls); Object.assign(d.attr, o.attr); d.dataset = {}; return d; };
    global.createDiv = (o) => (o ? fileTool(o) : fakeEl('div'));
    const bar = { kids: [], firstChild: null, addClass() {},
      own: () => bar.kids.filter((k) => k.cls.some((c) => /a4sb-files-tool/.test(c)) || k.attr['data-tool'] === 'canvas2'),
      querySelector: () => bar.own()[0] || null,
      querySelectorAll: () => bar.own().map((k) => ({ remove: () => bar.kids.splice(bar.kids.indexOf(k), 1) })),
      insertBefore(b) { bar.kids.push(b); } };
    const files = { querySelector: () => bar };
    const ran = [];
    const plugin = { app: {}, runTool: (c) => ran.push(c), showBases: () => ran.push('bases') };
    const chrome = new SB.FilesChrome(plugin);
    const rmT = ex.host.addToolbarButton({ id: 'canvas2', label: 'Another canvas', icon: 'layout-dashboard', onClick: () => ran.push('canvas2') });
    chrome.refresh(); chrome.attachTools(files);
    const ids = () => bar.kids.map((k) => k.attr['data-tool']);
    eq(ids(), ['daily', 'unique', 'graph', 'bases', 'canvas2'], "Files tab: the add-on's button sits after LifeWorld's own");
    await bar.kids[4].fire('click'); await tick();
    eq(ran, ['canvas2'], "Files tab: the add-on's button runs its click");
    chrome.attachTools(files);
    eq(bar.kids.length, 5, 'Files tab: drawn once, not again on the next attach');
    rmT(); chrome.refresh(); chrome.attachTools(files);
    eq(ids(), ['daily', 'unique', 'graph', 'bases'], 'Files tab: a removed button leaves after the next change');
    global.createDiv = gc;
    ex.host.unload();
  }

  // ---- The companion add-on job: tab row, Files tab footer, item commands, toolbar place, new-note form, mood, ready ----
  {
    const SB = LW.parts['a4-sidebar'].__logic;
    const V = LW.vault;
    const tick = () => new Promise((r) => setTimeout(r, 20));
    const throwsMsg = (f) => { try { f(); return null; } catch (e) { return e.message; } };
    const ce = console.error;
    const ex = await start({});
    eq([ex.host.ready, ex.app.workspace.fired.map(([nm, x]) => [nm, x === ex.host])], [true, [['lifeworld:ready', true]]], 'LifeWorld says once that it is ready, with itself');
    ex.host.running['a4-sidebar'].extrasChanged = () => {};
    // Toolbar place: in front of a built-in button, or after them when it names none (or an unknown one).
    const rmA = ex.host.addToolbarButton({ id: 'canvas', label: 'New canvas', icon: 'layout-dashboard', onClick() {}, before: 'graph' });
    const rmB = ex.host.addToolbarButton({ id: 'late', label: 'Late', icon: 'x', onClick() {}, before: 'nope' });
    eq(SB.toolbarItems().map((t) => t.id), ['daily', 'unique', 'canvas', 'graph', 'bases', 'late'], 'toolbar: "before" puts a button in front of that built-in one; an unknown one goes last');
    rmA(); rmB();
    // Tab row: before Settings; the Settings id is taken.
    ok(/already a Sidebar tab row button "settings"/.test(throwsMsg(() => ex.host.addTabRowButton({ id: 'settings', label: 'S', icon: 'x', onClick() {} }))), "a tab row button cannot take Settings' id");
    const ran = [];
    const rmTop = ex.host.addTabRowButton({ id: 'terminal', label: 'Open terminal', icon: 'terminal', onClick: () => ran.push('terminal') });
    const row = fakeEl('div'); row.querySelector = () => null; row.querySelectorAll = () => [];
    const doc0 = global.document; global.document = { querySelector: () => row };
    const chrome = new SB.FilesChrome({ app: { setting: { open: () => ran.push('settings') } } });
    try { chrome.attachTopButtons(); } finally { global.document = doc0; }
    eq(row.kids.map((k) => k.attr['aria-label']), ['Open terminal', 'Settings'], "tab row: the add-on's button, then Settings");
    await row.kids[0].fire('click'); await row.kids[1].fire('click'); await tick();
    eq(ran, ['terminal', 'settings'], 'tab row: both buttons run');
    rmTop();
    // Files tab footer: drawn by the add-on, once per change; a failing draw is logged and the rest still draw.
    ok(/needs id \(text\) and draw/.test(throwsMsg(() => ex.host.addFilesFooter({ id: 'x' }))), 'a footer without draw is refused');
    const rmF = ex.host.addFilesFooter({ id: 'badge', draw: (el) => el.createDiv({ text: 'Badge' }) });
    const rmBad = ex.host.addFilesFooter({ id: 'bad', draw: () => { throw new Error('planted'); } });
    const files = fakeEl('div'); files.querySelectorAll = () => files.kids.filter((k) => k.attr['data-foot']).map((k) => Object.assign(k, { remove: () => files.kids.splice(files.kids.indexOf(k), 1) }));
    const errs = []; console.error = (m) => errs.push(m);
    try { chrome.refresh(); chrome.attachFoot(files); chrome.attachFoot(files); } finally { console.error = ce; }
    eq([files.kids.map((k) => k.attr['data-foot']), files.kids[0].kids.map((k) => k.text), errs], [['badge', 'bad'], ['Badge'], ['LifeWorld: add-on footer bad failed']], 'Files tab footer: drawn in order, once; a failing one logged');
    rmBad(); rmF(); chrome.refresh(); chrome.attachFoot(files);
    eq(files.kids.length, 0, 'Files tab footer: removed after the next change');
    // Item commands: the item opens the command while it is registered, else its landing note as before.
    ok(/needs item, command \(text\)$/.test(throwsMsg(() => ex.host.addItemCommand({ item: 'Finance' }))), 'an item command without a command is refused');
    const rmI = ex.host.addItemCommand({ item: 'Charts', command: 'x:open' });
    ok(/already a Sidebar item command for "Charts"/.test(throwsMsg(() => ex.host.addItemCommand({ item: 'Charts', command: 'y:open' }))), 'one command per item');
    const land = (has) => SB.resolveLanding('Charts', 'L/Charts', ['L/Charts/Charts.md'], (id) => has && id === 'x:open');
    eq([land(true), land(false)], [{ kind: 'command', id: 'x:open' }, { kind: 'file', path: 'L/Charts/Charts.md' }], "an item opens the add-on's command while it is registered, else its landing note");
    rmI();
    eq(land(true), { kind: 'file', path: 'L/Charts/Charts.md' }, 'removed: the landing note again');
    // New-note form: "+" targets and "+ Add project"; none: no "+" and a notice.
    const pj = ex.host.running['a4-projects'];
    notices.length = 0;
    eq([SB.formTargets(), pj.addProject(), notices], [{}, false, ['The new project form comes from an add-on, and none is turned on.']], 'no form: no "+" and "+ Add project" says so');
    const opened = [];
    const rmForm = ex.host.setNewNoteForm({ targets: () => [{ navPath: 'Projects', key: 'project', label: 'New project' }], open: (k, pre) => { opened.push([k, pre]); return true; } });
    eq([Object.keys(SB.formTargets()), pj.addProject(), opened], [['Projects'], true, [['project', undefined]]], 'a form: rows get their "+", "+ Add project" opens it');
    const errs2 = []; console.error = (m) => errs2.push(m);
    const rmBroken = ex.host.setNewNoteForm({ targets: () => { throw new Error('planted'); }, open: () => { throw new Error('planted'); } });
    try { eq([SB.formTargets(), pj.addProject()], [{}, false], 'a failing form: no "+", the page carries on'); } finally { console.error = ce; }
    eq(errs2.length, 2, 'a failing form is logged');
    rmForm(); // the older one: the newer (broken) form stays in place
    const errs3 = []; console.error = (m) => errs3.push(m);
    try { SB.formTargets(); } finally { console.error = ce; }
    eq(errs3.length, 1, 'removing an older form leaves the newer one');
    rmBroken();
    eq(SB.formTargets(), {}, 'removed: no form');
    // Mood check-in: shown while the add-on's command is registered.
    const today = ex.host.running['a4-today'];
    const runs = [];
    today.app.commands = { commands: {}, executeCommandById: (id) => runs.push(id) };
    const rmM = ex.host.setMoodCheckin('h:new-mood');
    eq(today.moodCheckinOn(), false, 'mood: not shown before the command is registered');
    today.app.commands.commands['h:new-mood'] = {};
    today.openMoodCheckin();
    eq([today.moodCheckinOn(), runs], [true, ['h:new-mood']], 'mood: "Check in" runs the add-on command');
    rmM();
    eq(today.moodCheckinOn(), false, 'mood: removed');
    // The add-on fills the owner's note paths and mood folder (no rows); other saved values stay.
    await ex.host.setVaultSettings({ feeds: { calendar: 'P/Cal.md' } });
    await ex.host.setVaultSettings({ feeds: { weather: 'P/W.md' }, folders: { mood: 'L/Mood' } });
    eq([JSON.parse(disk[ex.dir]).lifeworld.vault.feeds, V.feedNotes.calendar, V.vaultFolders.mood], [{ calendar: 'P/Cal.md', weather: 'P/W.md' }, 'P/Cal.md', 'L/Mood'], 'note paths and the mood folder are saved and read');
    await ex.host.setVaultSettings({ folders: { mood: '' } });
    eq(V.vaultFolders.mood, 'Mood', 'an emptied mood folder: the default, Mood (launch section 9)');
    // An add-on button in the Sidebar tab closes the phone drawer after its click, as the built-in ones do.
    const after = []; const xb = SB.extraButton(fakeEl('div'), 'c', { id: 'z', label: 'Z', icon: 'x', onClick: () => after.push('click') }, () => after.push('drawer'));
    await xb.fire('click'); await tick();
    eq(after, ['click', 'drawer'], 'an add-on button runs its click, then the after-step');
    const sbSrc = fs.readFileSync(path.join(ROOT, 'src/sidebar/main.js'), 'utf8');
    ok(/extraButton\(bar, 'clickable-icon nav-action-button', t, \(\) => this\.closeDrawer\(\)\)/.test(sbSrc) && /runExtra\(x\)\.then\(\(\) => this\.closeDrawer\(\)\)/.test(sbSrc), 'Sidebar tab: add-on toolbar buttons and rows close the phone drawer');
    ex.host.unload();
    eq(ex.host.ready, false, 'LifeWorld off: no longer ready');
  }

  // First-run setup window (factory job 2026-10-24-lifeworld-first-run-setup).
  {
    const V = LW.vault;
    const tick = () => new Promise((r) => setTimeout(r, 20));
    const tf = (p) => new TFile(p);
    // A vault: path list -> folders and files; caches: path -> metadata cache entry.
    const vaultOf = (paths, caches = {}) => {
      const root = new TFolder('', []); const dirs = { '': root }; const all = [];
      const dir = (p) => { if (dirs[p]) return dirs[p]; const d = new TFolder(p, []); d.name = p.split('/').pop(); dir(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '').children.push(d); return (dirs[p] = d); };
      for (const p of paths) { const f = tf(p); all.push(f); dir(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '').children.push(f); }
      return { getRoot: () => root, getMarkdownFiles: () => all, getAbstractFileByPath: (p) => dirs[p] || all.find((f) => f.path === p) || null, cache: { getFileCache: (f) => caches[f.path] || null } };
    };
    const startIn = async (data, v, more = {}) => {
      const dir = `.obsidian/plugins/lifeworld-${Math.random()}`;
      if (data !== undefined) disk[dir] = typeof data === 'string' ? data : JSON.stringify(data);
      const app = newApp();
      if (v) { Object.assign(app.vault, { getRoot: v.getRoot, getMarkdownFiles: v.getMarkdownFiles, getAbstractFileByPath: v.getAbstractFileByPath }); app.metadataCache = v.cache; }
      Object.assign(app, more);
      const host = new LW(app, { id: 'lifeworld', name: 'LifeWorld', dir });
      await host.load();
      return { app, host, dir };
    };
    const rowsOf = (h) => h.setup.found.rows.map((r) => r.title);

    // Who sees it: a new install (no file) once the layout is ready; an existing file or a carry-over never.
    const neu = await startIn(undefined);
    ok(neu.host.setup && neu.host.setup.isOpen, 'new install: the setup window opens by itself');
    eq(neu.app.vault.getMarkdownFiles().length, 0, 'fixture: empty vault');
    const before = disk[neu.dir];
    neu.host.setup.close();
    await tick();
    ok(JSON.parse(disk[neu.dir]).lifeworld.setupSeen === true && before === undefined, 'closed: only that it was seen is saved');
    const again = await startIn(disk[neu.dir]);
    ok(!again.host.setup, 'after it was closed: never opens by itself again');
    const old = await startIn({ 'a4-today': { layout: [] } });
    ok(!old.host.setup, 'an existing settings file: never opens by itself');
    disk['.obsidian/plugins/a4-sidebar'] = JSON.stringify({ placed: true });
    const carried = await startIn(undefined);
    ok(!carried.host.setup, 'old plugin settings carried over at this start: never opens by itself');
    delete disk['.obsidian/plugins/a4-sidebar'];

    // Sync: settings arrive while it is open -> it closes, nothing saved, the file stays as it arrived.
    const dev2 = await startIn(undefined);
    const synced = JSON.stringify({ lifeworld: { vault: { folders: { tasks: 'Mine' } } } });
    disk[dev2.dir] = synced;
    await dev2.host.onExternalSettingsChange();
    await tick();
    eq([dev2.host.setup.isOpen, disk[dev2.dir]], [false, synced], 'Sync while open: closed, synced settings untouched');

    // What it finds: TaskNotes on wins; else a Tasks folder; else checkboxes; else none yet. Projects in any case.
    const daily = { internalPlugins: { getEnabledPluginById: (id) => (id === 'daily-notes' ? { options: { folder: 'Daily', format: 'YYYY-MM-DD' } } : null) } };
    const v1 = vaultOf(['Daily/2026-10-01.md', 'Daily/2026-10-02.md', 'Daily/notes.md', 'tasks/a.md', 'tasks/Archive/b.md', 'projects/P1.md', 'projects/P2.md', 'projects/sub/x.md', 'Other/n.md']);
    const s1 = await startIn(undefined, v1, daily);
    eq(rowsOf(s1.host), ['2 daily notes in "Daily"', '2 tasks in "tasks"', '2 projects in "projects"', 'Sidebar: your 4 top folders', 'Weather and calendars: off'], 'Tasks folder and lower-case projects found');
    eq([s1.host.setup.found.source, s1.host.setup.found.folders], ['builtin', { tasks: 'tasks', projects: 'projects' }], 'Start would save LifeWorld tasks and those folders');
    const v2 = vaultOf(['Inbox.md', 'Day.md'], { 'Inbox.md': { listItems: [{ task: ' ' }, { task: 'x' }, { task: ' ' }] }, 'Day.md': { listItems: [{ task: ' ' }] } });
    const s2 = await startIn(undefined, v2);
    eq(rowsOf(s2.host).slice(0, 3), ['No daily notes yet', '3 checkboxes in your notes', 'Projects folder: none yet'], 'checkboxes counted from the note index (open ones)');
    const v3 = vaultOf(['TN/t1.md', 'TN/t2.md', 'TN/plain.md', 'Tasks/x.md'], { 'TN/t1.md': { frontmatter: { tags: ['task'] } }, 'TN/t2.md': { frontmatter: { tags: 'task' } } });
    const s3 = await startIn(undefined, v3, { plugins: { plugins: { tasknotes: { settings: { tasksFolder: 'TN', archiveFolder: 'TN/Done', taskTag: 'task' } } } } });
    eq([rowsOf(s3.host)[1], s3.host.setup.found.source, s3.host.setup.found.folders], ['2 tasks from the TaskNotes plugin', 'tasknotes', { tasks: 'TN', archive: 'TN/Done' }], 'TaskNotes on: first match, its folder and tag');
    eq(rowsOf(neu.host).slice(0, 2), ['No daily notes yet', 'LifeWorld tasks, none yet'], 'empty vault: nothing found, said plainly');

    // Start with this: the found source through the task engine, the found folders through Your vault.
    const calls = [];
    const pj = s1.host.running['a4-projects'];
    pj.settings = { source: 'checkbox' }; pj.setSource = async (id) => { calls.push(id); };
    await s1.host.applySetup(s1.host.setup.found);
    eq([calls, JSON.parse(disk[s1.dir]).lifeworld.vault.folders, V.vaultFolders.tasks], [['builtin'], { tasks: 'tasks', projects: 'projects' }, 'tasks'], 'Start: source and folders saved and read');
    await s1.host.setVaultSettings({ folders: { tasks: '', projects: '' } }); // back to defaults for the checks after

    // Parts off: Tasks and Projects rows need the task engine, the Sidebar row the Sidebar.
    const partsOff = await startIn({ lifeworld: { parts: { 'a4-today': false, 'a4-planner': false, 'a4-projects': false, 'a4-sidebar': false } } }, v1, daily);
    partsOff.host.openSetup(false);
    eq(rowsOf(partsOff.host), ['2 daily notes in "Daily"', 'Weather and calendars: off'], 'parts off: their rows hidden');

    // Weather and calendars: their real state (spec amendment 2026-10-24), not always "off".
    const wxRow = (h) => { h.openSetup(false); const r = h.setup.found.rows.find((x) => x.key === 'weather'); h.setup.closeQuietly(); return [r.title, r.ok]; };
    // The parts here are stand-ins: a town set = the real Today part's weatherCfg after its start.
    const withTown = (x) => { x.host.running['a4-today'].weatherCfg = { place: { name: 'Springfield', lat: 40, lon: -89 } }; return x.host; };
    const link = { loadLocalStorage: (k) => (k === 'lifeworld-calendar-links' ? [{ id: 'a', url: 'https://x.test/c.ics', name: 'Home' }] : null) };
    eq(wxRow((await startIn({ 'a4-today': {} }, v1)).host), ['Weather and calendars: off', false], 'nothing set: off');
    eq(wxRow(withTown(await startIn({ 'a4-today': {} }, v1))), ['Weather: on, calendars: off', true], 'a town set: weather on');
    eq(wxRow((await startIn({ 'a4-today': {} }, v1, link)).host), ['Calendars: on, weather: off', true], 'a calendar link: calendars on');
    eq(wxRow(withTown(await startIn({ 'a4-today': {} }, v1, link))), ['Weather and calendars: on', true], 'both on');
    eq(wxRow((await startIn({ lifeworld: { parts: { 'a4-today': false, 'a4-planner': false } } }, v1, link)).host), ['Weather and calendars: off', false], 'Today and Planner off: nothing shows them, off');
    const mine0 = await startIn({ 'a4-today': {} }, v1);
    await mine0.host.setVaultSettings({ feeds: { weather: 'Feeds/W.md', calendar: 'Feeds/C.md' } });
    eq(wxRow(mine0.host), ['Weather and calendars: on', true], 'weather and calendar notes set: on');
    await mine0.host.setVaultSettings({ feeds: { weather: '', calendar: '' } });

    // Run setup in a set-up vault (found in the owner's copy, sandbox 2026-10-24): its own nested Tasks and Projects
    // folders win over checkboxes elsewhere, so Start would keep the task source, not switch it to checkboxes.
    const vJ = vaultOf(['02 Planner/Tasks/t1.md', '02 Planner/Tasks/t2.md', 'Life/Projects/P.md', 'Day.md'], { 'Day.md': { listItems: [{ task: ' ' }] } });
    const setUp = await startIn({ lifeworld: { vault: { folders: { tasks: '02 Planner/Tasks', projects: 'Life/Projects' } } } }, vJ);
    setUp.host.openSetup(false);
    eq([rowsOf(setUp.host).slice(1, 3), setUp.host.setup.found.source], [['2 tasks in "02 Planner/Tasks"', '1 project in "Life/Projects"'], 'builtin'], 'set-up vault: its own folders are found, source stays LifeWorld tasks');
    setUp.host.setup.closeQuietly();
    await setUp.host.setVaultSettings({ folders: { tasks: '', projects: '' } });

    // Run setup on an existing setup: opens; closing it changes nothing on disk.
    const mine = await startIn({ 'a4-today': { layout: [] } }, v1);
    const was = disk[mine.dir];
    mine.host.openSetup(false);
    ok(mine.host.setup.isOpen, 'Run setup opens it in any vault');
    mine.host.setup.close();
    await tick();
    eq(disk[mine.dir], was, 'Run setup closed without Start: settings file unchanged');
  }

  console.log(`host self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
