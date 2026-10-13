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
  addCommand(c) { c.id = `${this.manifest.id}:${c.id}`; this.app.commands[c.id] = c; this.register(() => delete this.app.commands[c.id]); return c; }
  registerView(type) { this.app.views.push(type); }
  addSettingTab(tab) { this.settingTab = tab; this.app.tabs.push(tab); }
  removeChild(c) { const i = this._children.indexOf(c); if (i !== -1) { this._children.splice(i, 1); c.unload(); } return c; }
  async loadData() { const s = disk[this.manifest.dir]; if (s === undefined) return null; try { return JSON.parse(s); } catch { return undefined; } }
  async saveData(d) { const s = JSON.stringify(d); writes.push('begin'); await new Promise((r) => setTimeout(r, writeDelay())); disk[this.manifest.dir] = s; writes.push('end'); }
}
class Notice { constructor(m) { notices.push(m); } }
// Settings page stand-ins: a Setting records what it shows; an element records what is put in it.
const fakeEl = () => ({ kids: [], cls: [], empty() { this.kids = []; }, addClass(c) { this.cls.push(c); }, createDiv() { const d = fakeEl(); this.kids.push(d); return d; } });
class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = fakeEl(); } }
class Setting {
  constructor(el) { this.settingEl = fakeEl(); this.rec = {}; el.kids.push(this); }
  setName(v) { this.rec.name = v; return this; }
  setDesc(v) { this.rec.desc = v; return this; }
  setHeading() { this.rec.heading = true; return this; }
  addToggle(cb) { const r = this.rec; const t = { setValue(v) { r.on = v; return t; }, setDisabled(v) { r.disabled = v; return t; }, onChange(f) { r.change = f; return t; } }; cb(t); return this; }
}
const fakeObsidian = new Proxy({ Plugin, Component, Notice, PluginSettingTab, Setting }, { get: (t, k) => (k in t ? t[k] : k === 'Platform' ? {} : class {}) });
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
for (const id of IDS) {
  const P = LW.parts[id].prototype;
  P.onload = async function () {
    log.push(`start ${id}`); started[id] = this;
    if (failing === id) throw new Error('planted start failure');
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
  const rows = (h) => draw(h).filter((r) => r !== 'section' && !r.heading);
  const heads = (h) => draw(h).filter((r) => r.heading).map((r) => r.name);
  const cmds = (a) => Object.keys(a.commands).map((c) => c.split(':')[0]).sort();
  const pg = await start({ 'a4-today': { layout: ['weather'] } });
  eq(rows(pg.host).map((r) => [r.name, r.desc, r.on, !!r.disabled]), [
    ['Today page', 'Your day at a glance', true, false],
    ['Planner', 'Week and day board, drag tasks onto mornings and afternoons', true, false],
    ['Projects and tasks', 'The task list everything shares. Today and the Planner need it.', true, false],
    ['Sidebar', "The LifeWorld panel on the left. Off: Obsidian's normal file list.", true, false],
  ], 'Parts: the four switches as drawn, all on for a setup that never switched one');
  eq(heads(pg.host), ['Parts', 'Tasks', 'Today page', 'Sidebar'], 'then each part\'s own settings under the mockup\'s heading, in its order');
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
  eq(heads(pg.host), ['Parts', 'Sidebar'], 'only the running part\'s settings are shown');
  log.length = 0;
  await pg.host.setPart('a4-projects', true);
  eq(log.filter((x) => x.startsWith('started')), ['started a4-projects', 'started a4-today', 'started a4-planner'], 'Projects on: Projects starts first, Today and the Planner come back');
  eq(cmds(pg.app), IDS.slice().sort(), 'all four commands back');
  eq(pg.host.running['a4-today'].saved, { layout: ['weather'] }, 'a part started again reads its saved settings');
  eq(JSON.parse(disk[pg.dir]).lifeworld.parts, { 'a4-planner': true, 'a4-projects': true, 'a4-today': true }, 'saved');

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
  eq(JSON.parse(disk[dmg.dir]), { 'a4-today': { layout: [] } }, 'after the copy exists, saving works again');
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
  for (const id of IDS) delete disk[OLD(id)];

  console.log(`host self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
