// LifeWorld: one plugin that starts its four parts (phase 2 section 1). Each part is the plugin
// class it was before, started inside LifeWorld under its old id, so its commands, tabs, ribbon
// button and settings page stay exactly as they were; its settings live in its own corner of
// LifeWorld's one settings file, under that id.
'use strict';

const { Plugin, Notice } = require('obsidian');
const { PARTS } = require('./core/parts');

// Start order: Projects first (the task engine the others use).
const PART_LIST = [
  [require('./projects/manifest.json'), require('./projects/main')],
  [require('./today/manifest.json'), require('./today/main')],
  [require('./planner/manifest.json'), require('./planner/main')],
  [require('./sidebar/manifest.json'), require('./sidebar/main')],
];

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
    for (const [manifest, Part] of PART_LIST) {
      const id = manifest.id;
      const part = new Part(this.app, { ...manifest, dir: this.manifest.dir });
      part.loadData = async () => copy(this.store[id]);
      part.saveData = (data) => { this.store[id] = copy(data); return this.writeStore(); };
      const addTab = part.addSettingTab.bind(part);
      part.addSettingTab = (tab) => { this.tabs[id] = tab; addTab(tab); };
      PARTS[id] = part;
      // Started one after the other and waited for, as Obsidian started the four plugins; added
      // as a child after, so turning LifeWorld off stops every part (addChild skips a started one).
      // A part that fails to start is logged, stopped and left out (the others see it as off, as a
      // failed separate plugin was); the rest still start.
      try { await part.load(); } catch (e) {
        console.error(`LifeWorld: ${manifest.name} did not start`, e);
        try { part.unload(); } catch (e2) { console.error(`LifeWorld: ${manifest.name} did not stop cleanly`, e2); }
        delete PARTS[id];
        continue;
      }
      this.addChild(part);
    }
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
      const p = PARTS[m.id];
      if (!p || typeof p.onExternalSettingsChange !== 'function') continue;
      if (JSON.stringify(before[m.id]) === JSON.stringify(this.store[m.id])) continue;
      await p.onExternalSettingsChange();
      const tab = this.tabs[m.id];
      if (tab && tab.containerEl && tab.containerEl.isConnected) tab.display();
    }
  }
}

// The four part classes, for the tests.
LifeWorldPlugin.parts = Object.fromEntries(PART_LIST.map(([m, P]) => [m.id, P]));

module.exports = LifeWorldPlugin;
