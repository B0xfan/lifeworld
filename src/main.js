// LifeWorld: one plugin that starts its four parts (phase 2 section 1). Each part is the plugin
// class it was before, started inside LifeWorld under its old id, so its commands, tabs and ribbon
// button stay exactly as they were; its settings live in its own corner of LifeWorld's one
// settings file, under that id. One settings page (section 2): the Parts switches, then each
// part's own settings under its heading. A part switched off is not started at all.
'use strict';

const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require('obsidian');
const { PARTS } = require('./core/parts');
const vault = require('./core/vault');

// Start order: Projects first (the task engine the others use).
const PART_LIST = [
  [require('./projects/manifest.json'), require('./projects/main')],
  [require('./today/manifest.json'), require('./today/main')],
  [require('./planner/manifest.json'), require('./planner/main')],
  [require('./sidebar/manifest.json'), require('./sidebar/main')],
];
const PART_MAIN = Object.fromEntries(PART_LIST.map(([m, P]) => [m.id, P]));

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

// Settings › Your vault, as drawn (lifeworld-your-vault-mockup.html, approved 2026-10-14).
// The mockup's "Found on first run" line under the task notes folder comes with the first-run screen.
const FOLDER_ROWS = [
  ['tasks', 'Task notes folder', ''],
  ['archive', 'Finished tasks folder', 'Archived tasks move here'],
  ['projects', 'Projects folder', ''],
  ['goals', 'Goals folder', 'Goals your projects point to'],
  ['habits', 'Habits folder', 'One note per habit, ticked on the Today page'],
  ['journal', 'Journal folder', 'The newest note here shows on the Today page'],
];
// The Property names dialog: [LifeWorld's name, row label, what it holds]; MORE fold away.
const PROP_ROWS = [
  ['title', 'Title', 'The name a task shows, when it differs from the file name'],
  ['status', 'Status', 'Open, in progress, done...'],
  ['priority', 'Priority', 'High, normal, low'],
  ['due', 'Due date', ''],
  ['scheduled', 'Scheduled date', 'The day you plan to start'],
  ['projects', 'Projects', 'Links to the projects a task belongs to'],
  ['reminders', 'Reminders', ''],
  ['recurrence', 'Repeats', 'How often a task comes back'],
  ['completedDate', 'Finished on', 'The day a task was done'],
  ['planned_day', 'Planned day', 'The day the planner puts it on'],
  ['planned_half', 'Planned half', 'Morning or afternoon'],
  ['planned_order', 'Planned order', 'Its place in that half'],
];
const MORE_PROP_ROWS = [
  ['dateCreated', 'Created', ''],
  ['dateModified', 'Last changed', ''],
  ['complete_instances', 'Repeats done', 'Days a repeating task was done'],
  ['skipped_instances', 'Repeats skipped', 'Days a repeating task was skipped'],
  ['blockedBy', 'Waiting on', 'Tasks this one waits for'],
];
// The six names the Property names row shows, in the mockup's order.
const PROP_SUMMARY = ['status', 'due', 'scheduled', 'priority', 'projects', 'reminders'];

// A copy each way, as the old disk read and write gave each part its own object.
const copy = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

class LifeWorldPlugin extends Plugin {
  async onload() {
    this.saving = Promise.resolve();
    this.gone = false;
    const found = await this.readStore();
    if (!found) await this.setAsideDamaged();
    // A damaged file starts on defaults with carry-over marked done, so a part that saves nothing
    // now cannot pick up its old plugin's (older) settings at a later start (review p2-s3).
    this.store = found || { [HOST]: { carriedOver: true } };
    this.ondisk = copy(this.store); // what the file holds as far as LifeWorld knows (see onExternalSettingsChange)
    vault.setVault(this.store[HOST] && this.store[HOST].vault); // before any part starts: every part reads it
    this.tabs = {};
    // A part with no corner yet takes its old plugin's settings file once (read only, left as it
    // was), so switching over needs no script and works for anyone who had the old plugins.
    // Not after a damaged file: older settings must never quietly replace the newer ones in the
    // copy kept aside, and the notice promises default settings.
    let carried = false;
    if (!(this.store[HOST] && this.store[HOST].carriedOver)) for (const [m] of PART_LIST) if (this.store[m.id] == null) carried = (await this.carryOver(m.id)) || carried;
    // A failed save here must not stop LifeWorld: it runs on what was carried, the next save retries.
    if (carried) await this.writeStore().catch((e) => {
      console.error('LifeWorld: the settings carried over from the old plugins could not be saved', e);
      new Notice('LifeWorld: your old settings were taken over but could not be saved yet. LifeWorld will try again at the next change.', 0);
    });
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
    if (this.gone) return;
    const id = manifest.id;
    // Old id (commands, tabs, ribbon buttons and anyone's hotkeys keep theirs); LifeWorld's name, so
    // Obsidian shows every command as "LifeWorld: ..." (it prefixes manifest.name, 1.14.4).
    const part = new Part(this.app, { ...manifest, name: this.manifest.name, dir: this.manifest.dir });
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
    // LifeWorld was turned off while this part was starting: stop it, or it would run on alone.
    if (this.gone) { part.unload(); delete PARTS[id]; return; }
    this.running[id] = part;
    // An add-on's sync, kept across a switch. Set after Today's onload, which runs no sync (review p2-s7).
    if (id === 'a4-today') part.calendarSync = this.calendarSync || null;
    this.addChild(part);
  }

  // For a companion add-on (phase 2 section 7): the calendar sync the Today page runs after a calendar
  // tick and for "Refresh list", (refresh) => Promise<boolean>; anything but a function removes it.
  // Kept here, so it survives the Today page being switched off and on. -> a function that removes it.
  setCalendarSync(fn) {
    this.calendarSync = typeof fn === 'function' ? fn : null;
    if (this.running['a4-today']) this.running['a4-today'].calendarSync = this.calendarSync;
    this.redrawCalendarPicker();
    return () => { if (this.calendarSync === fn) this.setCalendarSync(null); };
  }

  // For a companion add-on (phase 2 section 7), each -> a function that removes what it added:
  //   addSidebarItem({ id, label, icon, onClick })    a row under Today, Planner and Focus in the Sidebar
  //   addToolbarButton({ id, label, icon, onClick })  a button on the Sidebar's toolbar and the Files tab's
  //   addTodayWidget({ id, name, desc, zone, render(body, el) })  a widget on the Today page, placed, moved
  //     and hidden like the others; zone 'c1' | 'c2' | 'c3' (default 'c3'); render draws into a fresh body on
  //     every refresh (el.addClass('a4t-card') for the card look). icon is an Obsidian icon name; an id is
  //     letters, digits, dash and underscore.
  // Errors in onClick or render are logged and never break the page. Kept while the Sidebar or the
  // Today page is switched off, shown again when it is back on.
  addSidebarItem(def) { return this.addExtra('a4-sidebar', 'Sidebar item', def, ['id', 'label', 'icon'], 'onClick', (d) => PART_MAIN['a4-sidebar'].addExtra('nav', d)); }
  addToolbarButton(def) { return this.addExtra('a4-sidebar', 'toolbar button', def, ['id', 'label', 'icon'], 'onClick', (d) => PART_MAIN['a4-sidebar'].addExtra('tools', d)); }
  addTodayWidget(def) { return this.addExtra('a4-today', 'Today widget', def, ['id', 'name'], 'render', (d) => PART_MAIN['a4-today'].addExtraWidget(d)); }

  addExtra(part, what, def, texts, fn, add) {
    const bad = !def || typeof def !== 'object' || texts.some((k) => typeof def[k] !== 'string' || !def[k].trim()) || typeof def[fn] !== 'function';
    if (bad) throw new TypeError(`LifeWorld: a ${what} needs ${texts.join(', ')} (text) and ${fn} (a function)`);
    if (!/^[A-Za-z0-9_-]+$/.test(def.id)) throw new TypeError(`LifeWorld: a ${what} id is letters, digits, dash and underscore only`);
    const changed = () => { const p = this.running[part]; if (p && typeof p.extrasChanged === 'function') Promise.resolve().then(() => p.extrasChanged()).catch((e) => console.error(`LifeWorld: ${part} did not redraw`, e)); };
    const remove = add({ ...def });
    changed();
    let done = false;
    return () => { if (done) return; done = true; remove(); changed(); };
  }

  // A sync that arrives while Settings is open: the Calendars picker draws again (review p2-s7).
  redrawCalendarPicker() {
    const tab = this.running['a4-today'] && this.running['a4-today'].settingTab;
    if (tab && tab.calHost && tab.calHost.isConnected) {
      try { tab.renderCalendars(); } catch (e) { console.error('LifeWorld: the Calendars picker did not redraw', e); }
    }
  }

  // Brings the running parts in line with the switches: the ones that use Projects stop first,
  // Projects starts first. One change at a time.
  applyParts() {
    this.applying = this.applying.catch(() => {}).then(async () => {
      if (this.gone) return;
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
      // The tabs still open draw again: a part switched off hides its buttons and links in the
      // others (phase 2 section 6, as drawn), one switched on shows them.
      this.redrawViews();
    });
    return this.applying;
  }

  // A switch in Settings › Parts. Projects off takes Today and the Planner with it (wanted());
  // Projects on brings back each of them that was on before, so their own switches are kept.
  async setPart(id, on) {
    const parts = { ...((this.store[HOST] && this.store[HOST].parts) || {}), [id]: on };
    this.store[HOST] = { ...(this.store[HOST] || {}), parts };
    await this.writeStore();
    await this.applyParts();
  }

  // Settings › Your vault: change = { folders: {...} } or { names: {...} }, merged into what is saved.
  // Every part reads the new folders and names from the next time it looks; open views redraw.
  async setVaultSettings(change) {
    const h = this.store[HOST] || {};
    const v = h.vault || {};
    const next = { ...v };
    if (change.folders) next.folders = { ...(v.folders || {}), ...change.folders };
    if (change.names) next.names = change.names;
    this.store[HOST] = { ...h, vault: next };
    this.applyVault(next);
    await this.writeStore();
  }

  // New Your vault settings: every part reads them from now on, open views redraw, and a part that
  // acts on a changed note path hears it (Today adopts the calendar choice, review p2-s5).
  applyVault(v) {
    vault.setVault(v);
    this.redrawViews();
    for (const p of Object.values(this.running)) if (p && typeof p.onVaultChange === 'function') p.onVaultChange();
  }

  // Each open LifeWorld tab draws again (Today, Planner, Projects schedule their own redraw; the Sidebar draws now),
  // and so do Projects' task cards on open task notes (review p2-s6). One that fails is logged; the rest still draw.
  redrawViews() {
    const draw = (what, fn) => { try { fn(); } catch (e) { console.error(`LifeWorld: ${what} did not redraw`, e); } };
    for (const types of Object.values(this.views || {})) for (const type of types) for (const leaf of this.app.workspace.getLeavesOfType(type)) {
      const v = leaf.view;
      if (v && typeof v.scheduleRefresh === 'function') draw(type, () => v.scheduleRefresh());
      else if (v && typeof v.scheduleRender === 'function') draw(type, () => v.scheduleRender());
      else if (v && typeof v.render === 'function') draw(type, () => v.render()); // the Sidebar
    }
    const cards = this.running['a4-projects'] && this.running['a4-projects'].cards;
    if (cards) draw('task cards', () => cards.refreshAll());
  }

  onunload() {
    this.gone = true; // a switch or outside change still under way starts nothing more
    this.running = {};
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
    this.saving = this.saving.catch(() => {}).then(async () => {
      const snap = copy(this.store);
      this.writing = true;
      try {
        await this.saveData(snap);
        // A Sync change taken during this write: its corners stay the record of what is on disk
        // (the follow-up write puts them there), or a second Sync change to them would look like
        // a change made here and be dropped (review p2-s3). Corners kept from here are in snap.
        const s = this.syncedDuring;
        this.ondisk = snap;
        if (s) {
          this.ondisk = copy(s.now);
          for (const k of s.kept) if (k in snap) this.ondisk[k] = snap[k]; else delete this.ondisk[k];
        }
      } finally { this.writing = false; this.syncedDuring = null; }
    });
    return this.saving;
  }

  // The file changed outside (Obsidian Sync): each part whose corner changed hears it, as before,
  // and its settings page is redrawn if open (what Obsidian did for each plugin).
  async onExternalSettingsChange() {
    const before = this.store;
    const was = this.ondisk;
    const now = await this.readStore();
    // A save of ours that ended during the read: the file holds it, not `now`, and its corners
    // must count as changed here, or the older values just read replace them (review p2-s3b).
    const saved = this.ondisk !== was;
    const ours = this.ondisk; // what that save put on disk; it landed after the Sync write that started this read
    // shortcut: a damaged file arriving by Sync is ignored (usually half-synced; the full one follows).
    if (!now) { console.warn('LifeWorld: settings changed outside but the file is damaged; kept the current settings'); return; }
    // A corner changed here and not yet on disk (its save queued or under way) keeps the change
    // made here; every other corner takes the file's. A write under way carries the corners from
    // before this change, so one more write follows it.
    const merged = { ...now };
    const kept = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(was)])) {
      if (JSON.stringify(before[k]) === JSON.stringify(was[k])) continue;
      kept.push(k);
      if (k in before) merged[k] = before[k]; else delete merged[k];
    }
    this.ondisk = now;
    this.store = merged;
    if (this.writing) this.syncedDuring = { now: copy(now), kept };
    // After a save that ended during the read, write only if the file does not already hold the
    // result (review p2-s4: no write when nothing changed).
    if (this.writing || (saved && JSON.stringify(merged) !== JSON.stringify(ours))) {
      this.writeStore().catch((e) => console.error('LifeWorld: the save after a settings change from outside failed', e));
    } else if (saved) {
      // No write: the file holds our save, not `now`; else the next Sync change looks local and is dropped (review p2-s5).
      this.ondisk = ours;
    }
    for (const [m] of PART_LIST) {
      const p = this.running[m.id];
      if (!p || typeof p.onExternalSettingsChange !== 'function') continue;
      if (JSON.stringify(before[m.id]) === JSON.stringify(this.store[m.id])) continue;
      await p.onExternalSettingsChange();
      const tab = this.tabs[m.id];
      if (tab && tab.containerEl && tab.containerEl.isConnected) tab.display();
    }
    // Parts switched on or off, or Your vault changed, elsewhere (the phone): follow them here too.
    if (JSON.stringify(before[HOST]) !== JSON.stringify(this.store[HOST])) {
      const h = this.store[HOST];
      // The settings page needs no redraw here: Obsidian 1.14.4 calls the open page's update() after
      // this handler, which draws it again (refreshCurrentPage).
      if (JSON.stringify(before[HOST] && before[HOST].vault) !== JSON.stringify(h && h.vault)) this.applyVault(h && h.vault);
      await this.applyParts();
    }
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
    this.drawVault(el);
    for (const [id, heading] of HEADINGS) {
      const tab = this.plugin.tabs[id];
      if (!tab) continue;
      new Setting(el).setName(heading).setHeading();
      tab.containerEl = el.createDiv();
      tab.display();
    }
  }

  // Your vault: the six folders, Daily notes (Obsidian's own setting), Property names.
  drawVault(el) {
    new Setting(el).setName('Your vault').setHeading();
    for (const [key, name, desc] of FOLDER_ROWS) {
      new Setting(el).setName(name).setDesc(desc).addText((t) => {
        t.setPlaceholder(vault.FOLDER_DEFAULTS[key]).setValue(vault.vaultFolders[key]);
        // Saved when the box is left or Enter is pressed (the change event), not on every keystroke:
        // a half-typed folder would be read and sent out through Sync (review p2-s4).
        t.inputEl.addEventListener('change', () => this.plugin.setVaultSettings({ folders: { [key]: t.getValue().trim() } }));
        t.inputEl.setAttr('aria-label', name);
      });
    }
    const dn = vault.dailyNotes(this.app);
    const where = dn.folder ? `folder "${dn.folder}"` : "the vault's top folder";
    const tpl = dn.template ? `, template "${dn.template.split('/').pop()}"` : '';
    new Setting(el).setName('Daily notes').setDesc(`Uses Obsidian's own Daily notes settings (${where}, ${dn.format}${tpl})`)
      // shortcut: app.setting is Obsidian's undocumented settings window; upgrade if it gets an API.
      .addButton((b) => b.setButtonText('Open').onClick(() => { const s = this.app.setting; if (s && typeof s.openTabById === 'function') s.openTabById('daily-notes'); }));
    new Setting(el).setName('Property names').setDesc(PROP_SUMMARY.map((k) => vault.propNames[k]).join(', '))
      .addButton((b) => b.setButtonText('Change').onClick(() => new PropertyNamesModal(this.app, this.plugin, () => this.display()).open()));
  }

  // Leaving the page: each part's page lets go of what it listens to, as when its own page closed.
  hide() {
    for (const tab of Object.values(this.plugin.tabs)) if (typeof tab.hide === 'function') tab.hide();
  }
}

// Settings › Your vault › Property names: Change (the approved mockup's dialog). Names are saved
// only by Done; an empty, repeated or unusable name keeps Done off and says why. Renaming here
// never renames anything in the notes.
class PropertyNamesModal extends Modal {
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone; }

  onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('lw-names');
    this.setTitle('Property names');
    el.createEl('p', { cls: 'lw-names-intro', text: 'The properties LifeWorld reads and writes on your task notes. Change a name only if your notes already use a different one. This does not rename anything in your notes.' });
    this.inputs = [];
    const row = (parent, [key, label, desc]) => new Setting(parent).setName(label).setDesc(desc).addText((t) => {
      t.setValue(vault.propNames[key]).onChange(() => this.check());
      t.inputEl.setAttr('aria-label', `${label} property name`);
      t.inputEl.setAttr('spellcheck', 'false');
      this.inputs.push({ key, label, t });
    });
    for (const r of PROP_ROWS) row(el, r);
    const more = el.createEl('details', { cls: 'lw-names-more' });
    more.createEl('summary', { text: 'More properties (rarely changed)' });
    for (const r of MORE_PROP_ROWS) row(more, r);
    this.err = el.createDiv({ cls: 'lw-names-err', attr: { role: 'alert' } });
    const foot = new Setting(el)
      .addButton((b) => b.setButtonText('Reset to defaults').onClick(() => { for (const x of this.inputs) x.t.setValue(x.key); this.check(); }))
      .addButton((b) => { this.done = b; b.setButtonText('Done').setCta().onClick(() => this.save()); });
    foot.settingEl.addClass('lw-names-foot');
    this.check();
  }

  // The mockup's checks, on every keystroke: the first problem shows, its row is marked, Done is off.
  check() {
    const msg = vault.namesProblem(this.inputs.map((x) => [x.label, x.t.getValue()]));
    const count = {};
    for (const x of this.inputs) { const v = x.t.getValue().trim(); count[v] = (count[v] || 0) + 1; }
    for (const x of this.inputs) { const v = x.t.getValue().trim(); x.t.inputEl.toggleClass('lw-bad', !v || count[v] > 1 || vault.BAD_NAME.test(v) || vault.isReserved(v)); }
    this.err.setText(msg);
    this.done.setDisabled(!!msg);
    return !msg;
  }

  async save() {
    if (!this.check()) return;
    const names = {};
    for (const x of this.inputs) { const v = x.t.getValue().trim(); if (v !== x.key) names[x.key] = v; }
    await this.plugin.setVaultSettings({ names });
    this.close();
    this.onDone();
  }

  onClose() { this.contentEl.empty(); }
}

// The four part classes, for the tests.
LifeWorldPlugin.parts = Object.fromEntries(PART_LIST.map(([m, P]) => [m.id, P]));

module.exports = LifeWorldPlugin;
module.exports.PropertyNamesModal = PropertyNamesModal; // for tests (the dialog's checks)
