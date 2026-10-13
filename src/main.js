// LifeWorld: one plugin that starts its four parts (phase 2 section 1). Each part is the plugin
// class it was before, started inside LifeWorld under its old id, so its commands, tabs, ribbon
// button and settings page stay exactly as they were; its settings live in its own corner of
// LifeWorld's one settings file, under that id.
'use strict';

const { Plugin } = require('obsidian');
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
    this.store = await this.readStore();
    this.saving = Promise.resolve();
    this.tabs = {};
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
      // A part that fails to start is logged and the rest still start, as with separate plugins.
      try { await part.load(); } catch (e) { console.error(`LifeWorld: ${manifest.name} did not start`, e); }
      this.addChild(part);
    }
  }

  onunload() {
    for (const [m] of PART_LIST) delete PARTS[m.id];
  }

  async readStore() {
    const d = await this.loadData();
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  }

  // One write at a time, each with every part's newest settings, so a slower write never lands last.
  writeStore() {
    this.saving = this.saving.catch(() => {}).then(() => this.saveData(this.store));
    return this.saving;
  }

  // The file changed outside (Obsidian Sync): each part whose corner changed hears it, as before,
  // and its settings page is redrawn if open (what Obsidian did for each plugin).
  async onExternalSettingsChange() {
    const before = this.store;
    this.store = await this.readStore();
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
