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
const fakeEl = (tag) => ({ tag, kids: [], cls: [], attr: {}, text: '', empty() { this.kids = []; }, addClass(c) { this.cls.push(c); }, toggleClass(c, on) { this.cls = this.cls.filter((x) => x !== c); if (on) this.cls.push(c); },
  setAttr(k, v) { this.attr[k] = v; }, setText(t) { this.text = t; }, createDiv(o) { return this.createEl('div', o); },
  createEl(t, o) { const d = fakeEl(t); if (o && o.text) d.text = o.text; if (o && o.attr) Object.assign(d.attr, o.attr); this.kids.push(d); return d; } });
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = fakeEl(); } }
class Setting {
  constructor(el) { this.settingEl = fakeEl(); this.rec = {}; el.kids.push(this); }
  setName(v) { this.rec.name = v; return this; }
  setDesc(v) { this.rec.desc = v; return this; }
  setHeading() { this.rec.heading = true; return this; }
  addToggle(cb) { const r = this.rec; const t = { setValue(v) { r.on = v; return t; }, setDisabled(v) { r.disabled = v; return t; }, onChange(f) { r.change = f; return t; } }; cb(t); return this; }
  // A text box: typing = setValue then its onChange, as Obsidian's does.
  addText(cb) { const r = this.rec; const t = { inputEl: fakeEl('input'), setPlaceholder(v) { r.placeholder = v; return t; }, setValue(v) { r.value = v; return t; }, getValue() { return r.value; }, onChange(f) { r.change = f; return t; }, type(v) { r.value = v; return r.change && r.change(v); } }; r.text = t; cb(t); return this; }
  addButton(cb) { const b = { setButtonText(v) { b.label = v; return b; }, onClick(f) { b.click = f; return b; }, setCta() { b.cta = true; return b; }, setDisabled(v) { b.disabled = v; return b; } }; (this.rec.buttons = this.rec.buttons || []).push(b); cb(b); return this; }
}
class Modal { constructor(app) { this.app = app; this.contentEl = fakeEl('div'); } open() { this.isOpen = true; this.onOpen(); } close() { this.isOpen = false; this.onClose(); } setTitle(t) { this.title = t; return this; } }
class TFile { constructor(path) { this.path = path; this.basename = path.split('/').pop().replace(/\.md$/, ''); this.name = path.split('/').pop(); this.extension = 'md'; } }
class TFolder { constructor(path, children) { this.path = path; this.children = children; } }
const fakeObsidian = new Proxy({ Plugin, Component, Notice, PluginSettingTab, Setting, Modal, TFile, TFolder }, { get: (t, k) => (k in t ? t[k] : k === 'Platform' ? {} : class {}) });
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fakeObsidian : load.call(this, req, ...a); };

const LW = require(path.join(ROOT, 'main.js'));
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
    this.addSettingTab({ part: id, containerEl: { isConnected: false }, display() { log.push(`redraw ${id}`); this.drawnIn = this.containerEl; }, hide() { log.push(`hide ${id}`); } });
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
const newApp = () => { const closed = []; return { commands: {}, tabs: [], views: [], closed, workspace: { detachLeavesOfType(t) { closed.push(t); }, getLeavesOfType: (t) => (t === 'file-explorer' ? ['files'] : []), async revealLeaf(l) { closed.push(`reveal ${l}`); } }, vault: { configDir: '.obsidian', adapter } }; }; // no app.plugins: lookups must not need it
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
  eq(Object.keys(app.commands).sort(), IDS.map((id) => `${id}:open`).sort(), 'commands keep their old ids, no clash between parts');
  ok(Object.values(app.commands).every((c) => c.name === "LifeWorld: Open"), 'every command shows as "LifeWorld: ..." (Obsidian prefixes the manifest name)');
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
  // and its settings page is redrawn when open.
  log.length = 0;
  host.tabs['a4-sidebar'].containerEl.isConnected = true;
  disk[dir] = JSON.stringify({ ...file, 'a4-sidebar': { sort: 'za' } });
  await host.onExternalSettingsChange();
  eq(log, ['external a4-sidebar', 'redraw a4-sidebar'], 'only the Sidebar hears it, its open page redrawn');
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
  ok(errs.length === 1 && /A4 Today did not start/.test(errs[0]), 'the failure is logged once, naming the part');
  eq(second.host._children.map((p) => p.manifest.id), ['a4-projects', 'a4-planner', 'a4-sidebar'], 'the failed part is left out');
  ok(log.includes('stop a4-today') && second.parts['a4-planner'].projectsPlugin() === second.parts['a4-projects'], 'the failed part is stopped at once; the others still find each other');
  ok(!Object.keys(second.app.commands).some((c) => c.startsWith('a4-today:')), 'the failed part leaves no command behind');
  started['a4-today'].look = { accent: 'green' };
  ok(LW.parts['a4-projects'].cardAccent.cardAccentId(second.app) !== 'green', 'Projects does not find the failed Today (it is off, as a failed plugin was)');
  second.host.unload();

  // Section 2: one settings page, the Parts switches.
  const draw = (h) => { h.settingTab.display(); return h.settingTab.containerEl.kids.map((k) => (k.rec ? k.rec : 'section')); };
  const rows = (h) => draw(h).filter((r) => r !== 'section' && !r.heading && 'on' in r); // the Parts switches
  const heads = (h) => draw(h).filter((r) => r.heading).map((r) => r.name);
  const cmds = (a) => Object.keys(a.commands).map((c) => c.split(':')[0]).sort();
  const pg = await start({ 'a4-today': { layout: ['weather'] } });
  eq(rows(pg.host).map((r) => [r.name, r.desc, r.on, !!r.disabled]), [
    ['Today page', 'Your day at a glance', true, false],
    ['Planner', 'Week and day board, drag tasks onto mornings and afternoons', true, false],
    ['Projects and tasks', 'The task list everything shares. Today and the Planner need it.', true, false],
    ['Sidebar', "The LifeWorld panel on the left. Off: Obsidian's normal file list.", true, false],
  ], 'Parts: the four switches as drawn, all on for a setup that never switched one');
  eq(heads(pg.host), ['Parts', 'Your vault', 'Tasks', 'Today page', 'Sidebar'], 'then each part\'s own settings under the mockup\'s heading, in its order');
  const secs = pg.host.settingTab.containerEl.kids.filter((k) => !k.rec);
  ok(secs.length === 3 && secs.every((d, i) => pg.host.tabs[['a4-projects', 'a4-today', 'a4-sidebar'][i]].drawnIn === d), 'each part draws its own settings into its section');
  ok(pg.host.settingTab.containerEl.cls.includes('lw-settings'), 'the page carries LifeWorld\'s class');

  // Planner off: not running, no command, its choice saved; the others untouched.
  log.length = 0;
  await draw(pg.host).find((r) => r.name === 'Planner').change(false);
  eq(log.filter((x) => x.startsWith('st')), ['stop a4-planner'], 'Planner off: only the Planner stops');
  eq(cmds(pg.app), ['a4-projects', 'a4-sidebar', 'a4-today'], 'its command is gone');
  eq(pg.app.closed, ['a4-planner-view'], 'its open tabs are closed');
  eq(JSON.parse(disk[pg.dir]).lifeworld, { parts: { 'a4-planner': false } }, 'the switch is saved in LifeWorld\'s corner');
  eq(JSON.parse(disk[pg.dir])['a4-today'], { layout: ['weather'] }, 'the parts\' own settings are untouched');

  // Projects off: Today and the Planner go with it, dimmed and not switchable; Projects on brings them back.
  log.length = 0;
  await pg.host.setPart('a4-projects', false);
  eq(log.filter((x) => x.startsWith('stop')), ['stop a4-today', 'stop a4-projects'], 'Projects off: Today stops first, then Projects');
  ok(log.includes('hide a4-today') && log.includes('hide a4-projects'), 'a stopped part\'s settings let go of what they listen to');
  eq(cmds(pg.app), ['a4-sidebar'], 'only the Sidebar is left');
  eq(pg.app.closed.slice(1), ['a4-today-view', 'a4-projects-view'], 'their open tabs are closed');
  eq(rows(pg.host).map((r) => [r.name, r.on, !!r.disabled]), [['Today page', false, true], ['Planner', false, true], ['Projects and tasks', false, false], ['Sidebar', true, false]], 'Today and the Planner shown off and not switchable');
  const dims = pg.host.settingTab.containerEl.kids.filter((k) => k.rec && k.settingEl.cls.includes('lw-dim')).map((k) => k.rec.name);
  eq(dims, ['Today page', 'Planner'], 'their rows dimmed, as drawn');
  eq(heads(pg.host), ['Parts', 'Your vault', 'Sidebar'], 'only the running part\'s settings are shown');
  log.length = 0;
  await pg.host.setPart('a4-projects', true);
  eq(log.filter((x) => x.startsWith('started')), ['started a4-projects', 'started a4-today'], 'Projects on: Projects starts first, Today comes back; the Planner, off before, stays off');
  eq(cmds(pg.app), ['a4-projects', 'a4-sidebar', 'a4-today'], 'commands back for the parts that were on');
  eq(rows(pg.host).map((r) => [r.name, r.on, !!r.disabled]), [['Today page', true, false], ['Planner', false, false], ['Projects and tasks', true, false], ['Sidebar', true, false]], 'the Planner\'s own switch kept');
  eq(pg.host.running['a4-today'].saved, { layout: ['weather'] }, 'a part started again reads its saved settings');
  eq(JSON.parse(disk[pg.dir]).lifeworld.parts, { 'a4-planner': false, 'a4-projects': true }, 'saved');
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
  eq(log.filter((x) => x.startsWith('started')), ['started a4-sidebar'], 'Projects off in the file: Today and the Planner do not start either');

  // Switched on the phone: followed here.
  disk[odd.dir] = JSON.stringify({ lifeworld: { parts: { 'a4-projects': true, 'a4-today': true, 'a4-planner': false } } });
  await odd.host.onExternalSettingsChange();
  eq(Object.keys(odd.host.running).sort(), ['a4-projects', 'a4-sidebar', 'a4-today'], 'switches changed outside: parts started and stopped to match');
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
  // The folders and scratchpad the four A4 plugins had written into their code before section 4.
  const OLDF = { tasks: '02 Planner/TaskNotes/Tasks', archive: '02 Planner/TaskNotes/Archive', projects: '04 Inner World/My Life/Projects', goals: '04 Inner World/My Life/Goals', habits: '04 Inner World/My Life/Habits', journal: '04 Inner World/Journal' };
  const OLD_SP = (d) => `00 Daily Scratchpad/${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}.md`;
  const OLD_TPL = '06 AI Team/AI Team Knowledge/Templates/Daily Scratchpad.md';
  const withDaily = (app, options) => { app.internalPlugins = { getEnabledPluginById: (id) => (id === 'daily-notes' && options ? { options } : null) }; return app; };
  const vaultRows = (h) => { const all = draw(h); const i = all.findIndex((r) => r.heading && r.name === 'Your vault'); return all.slice(i + 1, all.findIndex((r, k) => k > i && r.heading)); };
  const T = LW.parts['a4-today'].logic;
  const Engine = LW.parts['a4-projects'].TaskEngine;
  const oct3 = new Date(2026, 9, 3, 9, 0);

  // New install: the rows as drawn, with the drawn defaults; Obsidian's Daily notes defaults.
  const fresh = await start({});
  withDaily(fresh.app, null);
  eq(vaultRows(fresh.host).map((r) => [r.name, r.desc, r.value, r.placeholder || (r.buttons || []).map((b) => b.label).join()]), [
    ['Task notes folder', '', 'Tasks', 'Tasks'],
    ['Finished tasks folder', 'Archived tasks move here', 'Tasks/Archive', 'Tasks/Archive'],
    ['Projects folder', '', 'Projects', 'Projects'],
    ['Goals folder', 'Goals your projects point to', 'Goals', 'Goals'],
    ['Habits folder', 'One note per habit, ticked on the Today page', 'Habits', 'Habits'],
    ['Journal folder', 'The newest note here shows on the Today page', 'Journal', 'Journal'],
    ['Daily notes', "Uses Obsidian's own Daily notes settings (the vault's top folder, YYYY-MM-DD)", undefined, 'Open'],
    ['Property names', 'status, due, scheduled, priority, projects, reminders', undefined, 'Change'],
  ], 'new install: the Your vault rows and defaults as drawn');
  const freshEngine = new Engine({ app: fresh.app, settings: {} });
  eq([freshEngine.cfg().tasksFolder, freshEngine.cfg().archiveFolder], ['Tasks', 'Tasks/Archive'], 'new install: the task engine uses the same folders');
  eq(T.scratchPathFor(oct3), '2026-10-03.md', "new install: today's daily note follows Obsidian's defaults (top folder, YYYY-MM-DD)");
  withDaily(fresh.app, { folder: 'Daily notes/', format: 'YYYY-MM-DD' });
  ok(vaultRows(fresh.host).find((r) => r.name === 'Daily notes').desc === "Uses Obsidian's own Daily notes settings (folder \"Daily notes\", YYYY-MM-DD)", "Daily notes reads Obsidian's own setting each time the page is drawn");
  // A folder typed in: saved, read by every part; emptied: back to the default.
  await vaultRows(fresh.host)[0].text.type('My Tasks/ ');
  await fresh.host.saving;
  eq([JSON.parse(disk[fresh.dir]).lifeworld.vault.folders.tasks, freshEngine.cfg().tasksFolder], ['My Tasks/', 'My Tasks'], 'a typed folder is saved and read (trailing slash dropped)');
  await vaultRows(fresh.host)[0].text.type('');
  eq(freshEngine.cfg().tasksFolder, 'Tasks', 'an emptied folder falls back to the default');
  fresh.host.unload();

  // The owner's preset (the frozen vault's LifeWorld file and Obsidian Daily notes setting, shaped like
  // owner's): every folder, the scratchpad and every property name come out as the old code had them.
  const owner = await start(fixJson('plugins/lifeworld/data.json'));
  withDaily(owner.app, fixJson('daily-notes.json'));
  eq(Object.fromEntries(vaultRows(owner.host).slice(0, 6).map((r, i) => [Object.keys(OLDF)[i], r.value])), OLDF, 'preset: the six folder rows hold the old folders');
  const je = new Engine({ app: owner.app, settings: {} });
  eq([je.cfg().tasksFolder, je.cfg().archiveFolder], [OLDF.tasks, OLDF.archive], 'preset: the task engine reads the old task folders');
  eq(Object.entries(je.cfg().F).filter(([k, v]) => k !== v && !['recurrenceAnchor', 'archiveTag', 'completeInstances', 'skippedInstances'].includes(k)), [], 'preset: property names unchanged');
  const jdn = { folder: '00 Daily Scratchpad', format: 'MM-DD-YYYY' };
  eq(T.scratchPathFor(oct3, fixJson('daily-notes.json')), OLD_SP(oct3), "preset: today's scratchpad path as before");
  eq(T.scratchPathFor(new Date(2027, 0, 9), jdn), '00 Daily Scratchpad/01-09-2027.md', 'preset: zero-padded, as before');
  eq(vaultRows(owner.host).find((r) => r.name === 'Daily notes').desc, 'Uses Obsidian\'s own Daily notes settings (folder "00 Daily Scratchpad", MM-DD-YYYY, template "Daily Scratchpad")', 'preset: Daily notes row as drawn for the owner');
  eq(vaultRows(owner.host).find((r) => r.name === 'Property names').desc, 'status, due, scheduled, priority, projects, reminders', 'preset: property names row');
  eq(T.renderTemplate('# {{title}}', oct3), '# 2026-10-03', 'template title: the daily note name (defaults here)');
  eq(T.renderTemplate('# {{title}}', oct3, null, '10-03-2026'), '# 10-03-2026', 'template title: the name it is given');
  ok(T.isScratchpadPath('00 Daily Scratchpad/10-04-2026.md', jdn) && !T.isScratchpadPath('03 WiP/x.md', jdn) && T.isScratchpadPath('2026-10-04.md', { folder: '' }) && !T.isScratchpadPath('a/2026-10-04.md', { folder: '' }), 'scratchpad notes: in the daily notes folder');
  await owner.parts['a4-today'].saveData({ layout: ['x'] }); await owner.host.saving;
  eq(JSON.parse(disk[owner.dir]).lifeworld, fixJson('plugins/lifeworld/data.json').lifeworld, 'preset: saving a part leaves the Your vault settings as they were');

  // The owner's own settings, read only (A4_VAULT; else the frozen copy): Obsidian's Daily notes setting gives
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
  const CV = require('../src/core/vault');
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

  console.log(`host self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
