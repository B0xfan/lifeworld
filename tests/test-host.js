// The one LifeWorld plugin (phase 2 section 1): starts the four parts in order under their old
// ids, gives each its own corner of one settings file, lets them find each other without
// Obsidian's plugin list, stops them all on unload. The fake Plugin below copies what Obsidian
// 1.14.4 does (read from its app bundle 2026-10-13): load() awaits onload() then loads children;
// addChild() loads a child only when the parent is loaded and not yet that child; addCommand()
// prefixes the manifest id; loadData()/saveData() read and write <dir>/data.json.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const disk = {}; // dir -> data.json contents (a string, as on disk)
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
  addSettingTab(tab) { this.app.tabs.push(tab); }
  async loadData() { const s = disk[this.manifest.dir]; return s === undefined ? null : JSON.parse(s); }
  async saveData(d) { const s = JSON.stringify(d); writes.push('begin'); await new Promise((r) => setTimeout(r, writeDelay())); disk[this.manifest.dir] = s; writes.push('end'); }
}
const fakeObsidian = new Proxy({ Plugin, Component }, { get: (t, k) => (k in t ? t[k] : k === 'Platform' ? {} : class {}) });
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
let failing = null;
for (const id of IDS) {
  const P = LW.parts[id].prototype;
  P.onload = async function () {
    log.push(`start ${id}`);
    if (failing === id) throw new Error('planted start failure');
    await new Promise((r) => setTimeout(r, 5));
    this.addCommand({ id: 'open', name: 'Open' });
    this.addSettingTab({ part: id, containerEl: { isConnected: false }, display() { log.push(`redraw ${id}`); } });
    this.saved = await this.loadData();
    log.push(`started ${id}`);
  };
  P.onunload = function () { log.push(`stop ${id}`); };
  P.onExternalSettingsChange = async function () { this.saved = await this.loadData(); log.push(`external ${id}`); };
}
const newApp = () => ({ commands: {}, tabs: [], workspace: {} }); // no app.plugins: lookups must not need it
const start = async (data) => {
  const dir = `.obsidian/plugins/lifeworld-${Math.random()}`;
  if (data !== undefined) disk[dir] = JSON.stringify(data);
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
  eq(fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8'), IDS.map((id) => fs.readFileSync(path.join(ROOT, 'src', id.slice(3), 'styles.css'), 'utf8')).join('\n'), 'styles.css is the four parts in start order');

  // Start: in order, one after the other, each under its old id, in LifeWorld's folder.
  const { app, host, parts, dir } = await start({ 'a4-today': { layout: ['weather'] }, 'a4-sidebar': { sort: 'az' } });
  eq(log, IDS.flatMap((id) => [`start ${id}`, `started ${id}`]), 'parts start in order, each after the one before has finished');
  eq(Object.keys(parts), IDS, 'four parts, each under its old id');
  for (const id of IDS) eq(parts[id].manifest.dir, dir, `${id} sits in LifeWorld's folder`);
  eq(Object.keys(app.commands).sort(), IDS.map((id) => `${id}:open`).sort(), 'commands keep their old ids, no clash between parts');
  eq(app.tabs.map((t) => t.part), IDS, 'each part keeps its settings page');

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
  app.tabs.find((t) => t.part === 'a4-sidebar').containerEl.isConnected = true;
  disk[dir] = JSON.stringify({ ...file, 'a4-sidebar': { sort: 'za' } });
  await host.onExternalSettingsChange();
  eq(log, ['external a4-sidebar', 'redraw a4-sidebar'], 'only the Sidebar hears it, its open page redrawn');
  eq(parts['a4-sidebar'].saved, { sort: 'za' }, 'with the new settings');

  // Stop: every part stops, its commands go, and the parts no longer find each other.
  log.length = 0;
  host.unload();
  eq(log.sort(), IDS.map((id) => `stop ${id}`).sort(), 'every part stops with LifeWorld');
  eq(Object.keys(app.commands), [], 'their commands are gone');
  eq(parts['a4-today'].projectsPlugin(), null, 'after stopping, Today no longer finds Projects');

  // A part that fails to start does not stop the others.
  log.length = 0; failing = 'a4-today';
  const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(' '));
  const second = await start();
  console.error = ce; failing = null;
  eq(log.filter((x) => x.startsWith('started')), ['started a4-projects', 'started a4-planner', 'started a4-sidebar'], 'the others still start');
  ok(errs.length === 1 && /A4 Today did not start/.test(errs[0]), 'the failure is logged once, naming the part');
  ok(second.host._children.length === 4, 'the failed part is still stopped with LifeWorld');
  second.host.unload();

  console.log(`host self-check: OK (${n} checks)`);
})().catch((e) => { console.error(e); process.exit(1); });
