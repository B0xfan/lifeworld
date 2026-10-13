// LifeWorld: one plugin that starts its four parts (phase 2 section 1). Each part is the plugin
// class it was before, started inside LifeWorld under its old id, so its commands, tabs and ribbon
// button stay exactly as they were; its settings live in its own corner of LifeWorld's one
// settings file, under that id. One settings page (section 2): the Parts switches, then each
// part's own settings under its heading. A part switched off is not started at all.
'use strict';

const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');
const { PARTS } = require('./core/parts');

// Start order: Projects first (the task engine the others use).
const PART_LIST = [
  [require('./projects/manifest.json'), require('./projects/main')],
  [require('./today/manifest.json'), require('./today/main')],
  [require('./planner/manifest.json'), require('./planner/main')],
  [require('./sidebar/manifest.json'), require('./sidebar/main')],
];

// Settings › Parts, in the approved mockup's order and words (lifeworld-step0-mockup.html).
// Today and the Planner show Projects' tasks, so they cannot be on without it.
const SWITCHES = [
  { id: 'a4-today', name: 'Today page', desc: 'Your day at a glance', needsProjects: true },
  { id: 'a4-planner', name: 'Planner', desc: 'Week and day board, drag tasks onto mornings and afternoons', needsProjects: true },
  { id: 'a4-projects', name: 'Projects and tasks', desc: 'The task list everything shares. Today and the Planner need it.' },
  { id: 'a4-sidebar', name: 'Sidebar', desc: "The LifeWorld panel on the left. Off: Obsidian's normal file list." },
];
// Each part's own settings, under the mockup's heading for it, in the mockup's order (the Planner has none).
const HEADINGS = [['a4-projects', 'Tasks'], ['a4-today', 'Today page'], ['a4-sidebar', 'Sidebar']];
const HOST = 'lifeworld'; // LifeWorld's own corner of the settings file

// A copy each way, as the old disk read and write gave each part its own object.
const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

class LifeWorldPlugin extends Plugin {
  async onload() {
    this.saving = Promise.resolve();
    const found = await this.readStore();
    if (!found) await this.setAsideDamaged();
    this.store = found || {};
    this.tabs = {};
    // A part with no corner yet takes its old plugin's settings file once (read only, left as it
    // was), so switching over needs no script and works for anyone who had the old plugins.
    let carried = false;
    for (const [m] of PART_LIST) if (this.store[m.id] == null) carried = (await this.carryOver(m.id)) || carried;
    if (carried) await this.writeStore();
    this.running = {};
    this.views = {};
    this.applying = Promise.resolve();
    for (const entry of PART_LIST) if (this.wanted(entry[0].id)) await this.startPart(entry);
    this.addSettingTab(new LifeWorldSettingTab(this.app, this));
  }

  // The Parts switches; a part never switched is on, so an existing setup starts with all four.
  isOn(id) {
    const h = this.store[HOST];
    return !(h && h.parts && h.parts[id] === false);
  }

  wanted(id) {
    const sw = SWITCHES.find((x) => x.id === id);
    return this.isOn(id) && !(sw.needsProjects && !this.isOn('a4-projects'));
  }

  async startPart([manifest, Part]) {
    const id = manifest.id;
    const part = new Part(this.app, { ...manifest, dir: this.manifest.dir });
    part.loadData = async () => copy(this.store[id]);
    part.saveData = (data) => { this.store[id] = copy(data); return this.writeStore(); };
    // Kept for LifeWorld's one settings page instead of a page of its own.
    part.addSettingTab = (tab) => {
      this.tabs[id] = tab; part.settingTab = tab;
      part.register(() => { if (typeof tab.hide === 'function') tab.hide(); if (this.tabs[id] === tab) delete this.tabs[id]; part.settingTab = null; });
    };
    // Its tab types, so switching it off can close its tabs (the mockup: Sidebar off gives back
    // Obsidian's file list). Turning LifeWorld itself off leaves tabs alone, as Obsidian asks.
    const views = (this.views[id] = []);
    const addView = part.registerView.bind(part);
    part.registerView = (type, make) => { views.push(type); return addView(type, make); };
    PARTS[id] = part;
    // Started one after the other and waited for, as Obsidian started the four plugins; added
    // as a child after, so turning LifeWorld off stops every part (addChild skips a started one).
    // A part that fails to start is logged, stopped and left out (the others see it as off, as a
    // failed separate plugin was); the rest still start.
    try { await part.load(); } catch (e) {
      console.error(`LifeWorld: ${manifest.name} did not start`, e);
      try { part.unload(); } catch (e2) { console.error(`LifeWorld: ${manifest.name} did not stop cleanly`, e2); }
      delete PARTS[id];
      return;
    }
    this.running[id] = part;
    this.addChild(part);
  }

  // Brings the running parts in line with the switches: the ones that use Projects stop first,
  // Projects starts first. One change at a time.
  applyParts() {
    this.applying = this.applying.catch(() => {}).then(async () => {
      for (const [m] of PART_LIST.slice().reverse()) {
        const part = this.running[m.id];
        if (!part || this.wanted(m.id)) continue;
        for (const type of this.views[m.id]) this.app.workspace.detachLeavesOfType(type);
        delete this.running[m.id]; delete PARTS[m.id]; this.removeChild(part);
        // Sidebar off: Obsidian's file list comes forward in its place, as the mockup says.
        const files = m.id === 'a4-sidebar' && this.app.workspace.getLeavesOfType('file-explorer')[0];
        if (files) await this.app.workspace.revealLeaf(files);
      }
      for (const entry of PART_LIST) if (this.wanted(entry[0].id) && !this.running[entry[0].id]) await this.startPart(entry);
    });
    return this.applying;
  }

  // A switch in Settings › Parts. Projects off takes Today and the Planner with it; Projects on
  // brings them back (as the mockup does).
  async setPart(id, on) {
    const parts = { ...((this.store[HOST] && this.store[HOST].parts) || {}), [id]: on };
    if (id === 'a4-projects') for (const x of SWITCHES) if (x.needsProjects) parts[x.id] = on;
    this.store[HOST] = { ...(this.store[HOST] || {}), parts };
    await this.writeStore();
    await this.applyParts();
  }

  onunload() {
    for (const [m] of PART_LIST) delete PARTS[m.id];
  }

  // -> the settings file's contents, {} when there is none yet, or null when it is damaged.
  // Obsidian's loadData gives null for a missing file and undefined for one it cannot read or
  // parse (it logs and does not throw; checked in Obsidian 1.14.4's own code).
  async readStore() {
    const d = await this.loadData();
    if (d === null) return {};
    if (d && typeof d === 'object' && !Array.isArray(d)) return d;
    return null;
  }

  // A damaged settings file at start: copy it aside first, then start on defaults. Until the copy
  // exists nothing is written, so the original can never be overwritten unbacked.
  async setAsideDamaged() {
    const file = `${this.manifest.dir}/data.json`;
    const p2 = (x) => String(x).padStart(2, '0');
    const d = new Date();
    const backup = `${this.manifest.dir}/data.damaged-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`;
    try {
      await this.app.vault.adapter.write(backup, await this.app.vault.adapter.read(file));
      new Notice(`LifeWorld: its settings file was damaged. A copy was kept (${backup}) and LifeWorld started on default settings.`, 0);
    } catch (e) {
      console.error('LifeWorld: damaged settings file could not be copied', e);
      this.noWrites = true;
      new Notice('LifeWorld: its settings file is damaged and could not be copied, so LifeWorld will not save any settings until Obsidian is restarted. Your file was left as it is.', 0);
    }
  }

  // -> true when the old plugin's settings were taken. Missing or unreadable: defaults, old file untouched.
  async carryOver(id) {
    const file = `${this.app.vault.configDir}/plugins/${id}/data.json`;
    let text;
    try { text = await this.app.vault.adapter.read(file); } catch { return false; }
    try {
      const d = JSON.parse(text);
      if (d && typeof d === 'object' && !Array.isArray(d)) { this.store[id] = d; return true; }
    } catch { /* unreadable, below */ }
    console.warn(`LifeWorld: could not read ${file}; that part starts on defaults (the file is left as it is).`);
    return false;
  }

  // One write at a time, each with every part's newest settings, so a slower write never lands last.
  writeStore() {
    if (this.noWrites) return Promise.resolve();
    this.saving = this.saving.catch(() => {}).then(() => this.saveData(this.store));
    return this.saving;
  }

  // The file changed outside (Obsidian Sync): each part whose corner changed hears it, as before,
  // and its settings page is redrawn if open (what Obsidian did for each plugin).
  async onExternalSettingsChange() {
    const before = this.store;
    const now = await this.readStore();
    // shortcut: a damaged file arriving by Sync is ignored (usually half-synced; the full one follows).
    if (!now) { console.warn('LifeWorld: settings changed outside but the file is damaged; kept the current settings'); return; }
    this.store = now;
    for (const [m] of PART_LIST) {
      const p = this.running[m.id];
      if (!p || typeof p.onExternalSettingsChange !== 'function') continue;
      if (JSON.stringify(before[m.id]) === JSON.stringify(this.store[m.id])) continue;
      await p.onExternalSettingsChange();
      const tab = this.tabs[m.id];
      if (tab && tab.containerEl && tab.containerEl.isConnected) tab.display();
    }
    // Parts switched on or off elsewhere (the phone): follow them here too.
    if (JSON.stringify(before[HOST]) !== JSON.stringify(this.store[HOST])) await this.applyParts();
  }
}

// LifeWorld's one settings page: Parts, then each running part's own settings, drawn by the part's
// own settings page into a section here (so every part's page works exactly as before).
class LifeWorldSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    this.hide();
    const el = this.containerEl;
    el.empty();
    el.addClass('lw-settings');
    new Setting(el).setName('Parts').setHeading();
    for (const x of SWITCHES) {
      const off = x.needsProjects && !this.plugin.isOn('a4-projects');
      const row = new Setting(el).setName(x.name).setDesc(x.desc).addToggle((t) => t
        .setValue(this.plugin.wanted(x.id))
        .setDisabled(off)
        .onChange(async (v) => { await this.plugin.setPart(x.id, v); this.display(); }));
      if (off) row.settingEl.addClass('lw-dim');
    }
    for (const [id, heading] of HEADINGS) {
      const tab = this.plugin.tabs[id];
      if (!tab) continue;
      new Setting(el).setName(heading).setHeading();
      tab.containerEl = el.createDiv();
      tab.display();
    }
  }

  // Leaving the page: each part's page lets go of what it listens to, as when its own page closed.
  hide() {
    for (const tab of Object.values(this.plugin.tabs)) if (typeof tab.hide === 'function') tab.hide();
  }
}

// The four part classes, for the tests.
LifeWorldPlugin.parts = Object.fromEntries(PART_LIST.map(([m, P]) => [m.id, P]));

module.exports = LifeWorldPlugin;
