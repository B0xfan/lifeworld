// LifeWorld: one plugin that starts its four parts (phase 2 section 1). Each part is the plugin
// class it was before, started inside LifeWorld under its old id, so its commands, tabs and ribbon
// button stay exactly as they were; its settings live in its own corner of LifeWorld's one
// settings file, under that id. One settings page (section 2): the Parts switches, then each
// part's own settings under its heading. A part switched off is not started at all.
'use strict';

import { Plugin, PluginSettingTab, Setting, Notice, Modal } from 'obsidian';
import { PARTS, ADDON } from './core/parts';
import * as vault from './core/vault';
import { findSetup, SetupModal } from './setup';
import { linksOf } from './core/calendars';
import projectsManifest from './projects/manifest.json';
import Projects from './projects/main';
import todayManifest from './today/manifest.json';
import Today from './today/main';
import plannerManifest from './planner/manifest.json';
import Planner from './planner/main';
import sidebarManifest from './sidebar/manifest.json';
import Sidebar from './sidebar/main';

// Start order: Projects first (the task engine the others use).
/** @typedef {[import('obsidian').PluginManifest, new (app: import('obsidian').App, manifest: import('obsidian').PluginManifest) => PartPlugin]} PartEntry */
/** @type {PartEntry[]} */
const PART_LIST = [
  [projectsManifest, Projects],
  [todayManifest, Today],
  [plannerManifest, Planner],
  [sidebarManifest, Sidebar],
];
const PART_MAIN = Object.fromEntries(PART_LIST.map(([m, P]) => [m.id, P]));

// Settings › Parts, in the approved mockup's order and words (mockup-lifeworld-today-launch.html, v6).
// Each part works on its own (launch section 1): the task engine (the Projects part) runs whenever
// Today, the Planner or Projects is on; with the Projects switch off it runs without its pages.
const SWITCHES = [
  { id: 'a4-today', name: 'Today page', desc: 'Your day at a glance' },
  { id: 'a4-planner', name: 'Planner', desc: 'Day, week and month board' },
  { id: 'a4-projects', name: 'Projects and areas', desc: 'Project pages, areas, the task board and Inbox' },
  { id: 'a4-sidebar', name: 'Sidebar', desc: "The LifeWorld panel on the left. Off: Obsidian's normal file list." },
];
// Each part's own settings, under the mockup's heading for it, in the mockup's order (the Planner has none).
const HEADINGS = [['a4-projects', 'Tasks'], ['a4-today', 'Today page'], ['a4-sidebar', 'Sidebar']];
const HOST = 'lifeworld'; // LifeWorld's own corner of the settings file
// The manual is a PDF in the public repo (docs/, built by scripts/build-manual.sh), never in the install
// files. GitHub's viewer page, not a raw download: it reads in the browser on every device and has a Download button.
const MANUAL_URL = 'https://github.com/B0xfan/lifeworld/blob/HEAD/docs/LifeWorld-manual.pdf';

// Settings › Your vault, as drawn (lifeworld-your-vault-mockup.html, approved 2026-10-14).
// The mockup's "Found on first run" line under the task notes folder comes with the first-run screen.
/** @type {[string, string, string][]} */
const FOLDER_ROWS = [
  ['tasks', 'Task notes folder', ''],
  ['archive', 'Finished tasks folder', 'Archived tasks move here'],
  ['projects', 'Projects folder', ''],
  ['goals', 'Goals folder', 'Goals your projects point to'],
  ['habits', 'Habits folder', 'One note per habit, ticked on the Today page'],
  ['journal', 'Journal folder', 'The newest note here shows on the Today page'],
  ['mood', 'Mood folder', 'Your mood check-ins'],
];
// The Property names dialog: [LifeWorld's name, row label, what it holds]; MORE fold away.
/** @type {[string, string, string][]} */
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
/** @type {[string, string, string][]} */
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
/** @param {unknown} v @returns {unknown} */
const copy = (v) => { const c = /** @type {unknown} */ (v === undefined ? null : JSON.parse(JSON.stringify(v))); return c; };

/** @typedef {Record<string, Fm>} LwStore */
class LifeWorldPlugin extends Plugin {
  async onload() {
    /** @type {Promise<void>} */
    this.saving = Promise.resolve();
    this.gone = false;
    const found = await this.readStore();
    if (!found) await this.setAsideDamaged();
    // A brand-new install: no settings file yet (or an empty one), nothing carried over below. Only then
    // does the setup window open by itself (spec criteria 1, 3, 4); an existing setup never sees it.
    this.firstRun = !!found && Object.keys(found).length === 0;
    // A damaged file starts on defaults with carry-over marked done, so a part that saves nothing
    // now cannot pick up its old plugin's (older) settings at a later start (review p2-s3).
    /** @type {LwStore} */
    this.store = found || { [HOST]: { carriedOver: true } };
    /** @type {LwStore} */
    this.ondisk = /** @type {LwStore} */ (copy(this.store)); // what the file holds as far as LifeWorld knows (see onExternalSettingsChange)
    vault.setVault(this.store[HOST] && this.store[HOST].vault); // before any part starts: every part reads it
    /** @type {Record<string, PartSettingTab>} */
    this.tabs = {};
    // A part with no corner yet takes its old plugin's settings file once (read only, left as it
    // was), so switching over needs no script and works for anyone who had the old plugins.
    // Not after a damaged file: older settings must never quietly replace the newer ones in the
    // copy kept aside, and the notice promises default settings.
    let carried = false;
    if (!(this.store[HOST] && this.store[HOST].carriedOver)) for (const [m] of PART_LIST) if (this.store[m.id] == null) carried = (await this.carryOver(m.id)) || carried;
    // A failed save here must not stop LifeWorld: it runs on what was carried, the next save retries.
    if (carried) this.firstRun = false;
    if (carried) await this.writeStore().catch((e) => {
      console.error('LifeWorld: the settings carried over from the old plugins could not be saved', e);
      new Notice('LifeWorld: your old settings were taken over but could not be saved yet. LifeWorld will try again at the next change.', 0);
    });
    /** @type {Record<string, PartPlugin>} */
    this.running = {};
    /** @type {Record<string, string[]>} */
    this.views = {};
    /** @type {Promise<void>} */
    this.applying = Promise.resolve();
    for (const entry of PART_LIST) if (this.wanted(entry[0].id)) await this.startPart(entry);
    this.addSettingTab(new LifeWorldSettingTab(this.app, this));
    this.addCommand({ id: 'open-manual', name: 'Open the manual', callback: () => window.open(MANUAL_URL) });
    // A tab open before the later parts started (Today before the Planner) drew them as off: all open
    // tabs draw again now, or at a cold start once the layout is back (a tab not yet loaded is skipped).
    this.app.workspace.onLayoutReady(() => { if (!this.gone) this.redrawViews(); });
    this.app.workspace.onLayoutReady(() => { if (!this.gone && this.firstRun) this.openSetup(true); });
    // A companion add-on that started first hears that the hooks below are there (one that starts later
    // checks `ready`); it hears it again after LifeWorld is turned off and on, which drops what it added.
    this.ready = true;
    this.app.workspace.trigger('lifeworld:ready', this);
  }

  // The Parts switches; a part never switched is on, so an existing setup starts with all four.
  /** @param {string} id */
  isOn(id) {
    const h = this.store[HOST];
    const parts = /** @type {Fm | undefined} */ (h && h.parts);
    return !(h && parts && parts[id] === false);
  }

  // Whether a part runs: its switch, except the task engine (the Projects part), which also runs for
  // Today and the Planner, then without its pages (pagesOff).
  /** @param {string} id */
  wanted(id) {
    if (id === 'a4-projects') return ['a4-projects', 'a4-today', 'a4-planner'].some((x) => this.isOn(x));
    return this.isOn(id);
  }

  /** @param {PartEntry} entry */
  async startPart([manifest, Part]) {
    if (this.gone) return;
    const id = manifest.id;
    // Old id (commands, tabs, ribbon buttons and anyone's hotkeys keep theirs); LifeWorld's name, so
    // Obsidian shows every command as "LifeWorld: ..." (it prefixes manifest.name, 1.14.4).
    const part = new Part(this.app, { ...manifest, name: this.manifest.name, dir: this.manifest.dir });
    // The Projects switch off while Today or the Planner is on: the task engine only, no pages (section 1).
    if (id === 'a4-projects') part.pagesOff = !this.isOn('a4-projects');
    part.loadData = async () => copy(this.store[id]);
    part.saveData = (data) => { this.store[id] = /** @type {Fm} */ (copy(data)); return this.writeStore(); };
    // Kept for LifeWorld's one settings page instead of a page of its own.
    part.addSettingTab = (/** @type {PartSettingTab} */ tab) => {
      this.tabs[id] = tab; part.settingTab = tab;
      part.register(() => { if (typeof tab.hide === 'function') tab.hide(); if (this.tabs[id] === tab) delete this.tabs[id]; part.settingTab = null; });
    };
    // Its tab types, so switching it off can close its tabs (the mockup: Sidebar off gives back
    // Obsidian's file list). Turning LifeWorld itself off leaves tabs alone, as Obsidian asks.
    /** @type {string[]} */
    const views = (this.views[id] = []);
    const addView = part.registerView.bind(part);
    part.registerView = (/** @type {string} */ type, /** @type {import('obsidian').ViewCreator} */ make) => { views.push(type); return addView(type, make); };
    /** @type {Record<string, unknown>} */ (PARTS)[id] = part;
    // Started one after the other and waited for, as Obsidian started the four plugins; added
    // as a child after, so turning LifeWorld off stops every part (addChild skips a started one).
    // A part that fails to start is logged, stopped and left out (the others see it as off, as a
    // failed separate plugin was); the rest still start.
    try { await part.load(); } catch (e) {
      console.error(`LifeWorld: ${manifest.name} did not start`, e);
      try { part.unload(); } catch (e2) { console.error(`LifeWorld: ${manifest.name} did not stop cleanly`, e2); }
      delete /** @type {Record<string, unknown>} */ (PARTS)[id];
      return;
    }
    // LifeWorld was turned off while this part was starting: stop it, or it would run on alone.
    if (this.gone) { part.unload(); delete /** @type {Record<string, unknown>} */ (PARTS)[id]; return; }
    this.running[id] = part;
    // An add-on's sync, kept across a switch. Set after Today's onload, which runs no sync (review p2-s7).
    if (id === 'a4-today') part.calendarSync = this.calendarSync || null;
    this.addChild(part);
  }

  // For a companion add-on (phase 2 section 7): the calendar sync the Today page runs after a calendar
  // tick and for "Refresh list", (refresh) => Promise<boolean>; anything but a function removes it.
  // Kept here, so it survives the Today page being switched off and on. -> a function that removes it.
  /** @param {unknown} fn */
  setCalendarSync(fn) {
    this.calendarSync = typeof fn === 'function' ? fn : null;
    if (this.running['a4-today']) this.running['a4-today'].calendarSync = this.calendarSync;
    this.redrawCalendarPicker();
    return () => { if (this.calendarSync === fn) this.setCalendarSync(null); };
  }

  // For a companion add-on (phase 2 section 7), each -> a function that removes what it added:
  //   addSidebarItem({ id, label, icon, onClick })    a row under Today, Planner and Focus in the Sidebar
  //   addToolbarButton({ id, label, icon, onClick, before })  a button on the Sidebar's toolbar and the Files
  //     tab's; before = a built-in button's id ('daily', 'unique', 'graph', 'bases') to sit in front of,
  //     else it goes after them
  //   addTabRowButton({ id, label, icon, onClick })   a button on the right sidebar's tab row, before Settings
  //   addFilesFooter({ id, draw(el) })                 a strip at the foot of the Files tab; draw fills el, and
  //     again whenever Obsidian rebuilds the tab
  //   addItemCommand({ item, command })                the Sidebar item named item (a folder name) opens this
  //     command while it is registered, instead of its landing note
  //   addTodayWidget({ id, name, desc, zone, render(body, el) })  a widget on the Today page, placed, moved
  //     and hidden like the others; zone 'c1' | 'c2' | 'c3' (default 'c3'); render draws into a fresh body on
  //     every refresh (el.addClass('a4t-card') for the card look). icon is an Obsidian icon name; an id is
  //     letters, digits, dash and underscore.
  // Errors in onClick, draw or render are logged and never break the page. Kept while the Sidebar or the
  // Today page is switched off, shown again when it is back on.
  /** @param {unknown} def */
  addSidebarItem(def) { return this.addExtra('a4-sidebar', 'Sidebar item', def, ['id', 'label', 'icon'], 'onClick', (d) => /** @type {typeof Sidebar} */ (PART_MAIN['a4-sidebar']).addExtra('nav', d)); }
  /** @param {unknown} def */
  addToolbarButton(def) { return this.addExtra('a4-sidebar', 'toolbar button', def, ['id', 'label', 'icon'], 'onClick', (d) => /** @type {typeof Sidebar} */ (PART_MAIN['a4-sidebar']).addExtra('tools', d)); }
  /** @param {unknown} def */
  addTabRowButton(def) { return this.addExtra('a4-sidebar', 'tab row button', def, ['id', 'label', 'icon'], 'onClick', (d) => /** @type {typeof Sidebar} */ (PART_MAIN['a4-sidebar']).addExtra('top', d)); }
  /** @param {unknown} def */
  addFilesFooter(def) { return this.addExtra('a4-sidebar', 'Files tab footer', def, ['id'], 'draw', (d) => /** @type {typeof Sidebar} */ (PART_MAIN['a4-sidebar']).addExtra('foot', d)); }
  /** @param {unknown} def */
  addItemCommand(def) { return this.addExtra('a4-sidebar', 'Sidebar item command', def, ['item', 'command'], null, (d) => /** @type {typeof Sidebar} */ (PART_MAIN['a4-sidebar']).addExtra('items', d)); }
  /** @param {unknown} def */
  addTodayWidget(def) { return this.addExtra('a4-today', 'Today widget', def, ['id', 'name'], 'render', (d) => /** @type {typeof Today} */ (PART_MAIN['a4-today']).addExtraWidget(/** @type {Parameters<typeof Today.addExtraWidget>[0]} */ (d))); }

  // For a companion add-on: its new-note form, { targets(), open(key, preset) }. targets() -> [{ navPath, key,
  // label }]: a folder row whose path is a navPath gets a "+" that calls open(key); "+ Add project" on the
  // Projects page calls open('project'); open -> true when it handled it. Anything else removes it.
  // -> a function that removes it.
  /** @param {unknown} form */
  setNewNoteForm(form) {
    const f = /** @type {{ targets?: unknown, open?: unknown } | null | undefined} */ (form);
    ADDON.form = f && typeof f.targets === 'function' && typeof f.open === 'function' ? /** @type {typeof ADDON.form} */ (f) : null;
    this.extrasChanged('a4-sidebar');
    return () => { if (ADDON.form === form) this.setNewNoteForm(null); };
  }

  // For a companion add-on: the command the Today page's Mood card runs for "Check in" (shown while that
  // command is registered); anything but text removes it. -> a function that removes it.
  /** @param {unknown} command */
  setMoodCheckin(command) {
    const id = typeof command === 'string' ? command.trim() : '';
    ADDON.moodCheckin = id;
    this.extrasChanged('a4-today');
    return () => { if (id && ADDON.moodCheckin === id) this.setMoodCheckin(null); };
  }

  // A part redraws after an add-on change (it may be off: then it draws them when it starts).
  /** @param {string} part */
  extrasChanged(part) {
    const p = this.running[part];
    if (p && typeof p.extrasChanged === 'function') Promise.resolve().then(() => /** @type {() => unknown} */ (p.extrasChanged)()).catch((e) => console.error(`LifeWorld: ${part} did not redraw`, e));
  }

  /** @param {string} part @param {string} what @param {unknown} defIn @param {string[]} texts @param {string | null} fn @param {(d: SidebarExtra) => () => void} add */
  addExtra(part, what, defIn, texts, fn, add) {
    const def = /** @type {Record<string, unknown> & SidebarExtra} */ (defIn);
    const bad = !def || typeof def !== 'object' || texts.some((k) => { const v = def[k]; return typeof v !== 'string' || !v.trim(); }) || (fn && typeof def[fn] !== 'function');
    if (bad) throw new TypeError(`LifeWorld: a ${what} needs ${texts.join(', ')} (text)${fn ? ` and ${fn} (a function)` : ''}`);
    if (texts.includes('id') && !/^[A-Za-z0-9_-]+$/.test(/** @type {string} */ (def.id))) throw new TypeError(`LifeWorld: a ${what} id is letters, digits, dash and underscore only`);
    const changed = () => this.extrasChanged(part);
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
  /** @returns {Promise<void>} */
  applyParts() {
    this.applying = this.applying.catch(() => {}).then(async () => {
      if (this.gone) return;
      for (const [m] of PART_LIST.slice().reverse()) {
        const part = this.running[m.id];
        // The task engine with or without its pages: started again in the other way.
        const modeChanged = part && m.id === 'a4-projects' && !!part.pagesOff !== !this.isOn('a4-projects');
        if (!part || (this.wanted(m.id) && !modeChanged)) continue;
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

  // A switch in Settings › Parts. Each part on its own (section 1); the task engine follows wanted().
  /** @param {string} id @param {boolean} on */
  async setPart(id, on) {
    const parts = { .../** @type {Fm} */ ((this.store[HOST] && this.store[HOST].parts) || {}), [id]: on };
    this.store[HOST] = { ...(this.store[HOST] || {}), parts };
    await this.writeStore();
    await this.applyParts();
  }

  // Settings › Your vault (and Planning): change = { folders: {...} }, { feeds: {...} }, { names: {...} } or { placeOnDay }, merged into what
  // is saved (feeds: the note paths, set by an owner's companion add-on; no row, build plan section 2).
  // Every part reads the new folders and names from the next time it looks; open views redraw.
  /** @param {{ folders?: Record<string, string>, feeds?: Record<string, string>, names?: Record<string, string>, placeOnDay?: string }} change */
  async setVaultSettings(change) {
    const h = this.store[HOST] || {};
    const v = /** @type {Fm} */ (h.vault || {});
    /** @type {Fm} */
    const next = { ...v };
    if (change.folders) next.folders = { .../** @type {Fm} */ (v.folders || {}), ...change.folders };
    if (change.feeds) next.feeds = { .../** @type {Fm} */ (v.feeds || {}), ...change.feeds };
    if (change.names) next.names = change.names;
    if (change.placeOnDay) next.placeOnDay = change.placeOnDay;
    this.store[HOST] = { ...h, vault: next };
    this.applyVault(next);
    await this.writeStore();
  }

  // New Your vault settings: every part reads them from now on, open views redraw, and a part that
  // acts on a changed note path hears it (Today adopts the calendar choice, review p2-s5).
  /** @param {unknown} v */
  applyVault(v) {
    vault.setVault(v);
    this.redrawViews();
    for (const p of Object.values(this.running)) if (p && typeof p.onVaultChange === 'function') p.onVaultChange();
  }

  // Each open LifeWorld tab draws again (Today, Planner, Projects schedule their own redraw; the Sidebar draws now),
  // and so do Projects' task cards on open task notes (review p2-s6). One that fails is logged; the rest still draw.
  redrawViews() {
    /** @param {string} what @param {() => unknown} fn */
    const draw = (what, fn) => { try { fn(); } catch (e) { console.error(`LifeWorld: ${what} did not redraw`, e); } };
    for (const types of Object.values(this.views || {})) for (const type of types) for (const leaf of this.app.workspace.getLeavesOfType(type)) {
      const v = /** @type {{ scheduleRefresh?: () => void, scheduleRender?: () => void, render?: () => void }} */ (leaf.view);
      if (v && typeof v.scheduleRefresh === 'function') draw(type, () => /** @type {() => void} */ (v.scheduleRefresh)());
      else if (v && typeof v.scheduleRender === 'function') draw(type, () => /** @type {() => void} */ (v.scheduleRender)());
      else if (v && typeof v.render === 'function') draw(type, () => /** @type {() => void} */ (v.render)()); // the Sidebar
    }
    const cards = this.running['a4-projects'] && this.running['a4-projects'].cards;
    if (cards) draw('task cards', () => cards.refreshAll());
  }

  // The setup window: first = opened by itself on a new install (closing it in any way records that it
  // was seen); otherwise from Settings › Your vault › Run setup (nothing saved unless Start is pressed).
  /** @param {boolean} first */
  openSetup(first) {
    if (first) this.firstRun = false;
    let found;
    try {
      const td = /** @type {PartTypes['a4-today'] | undefined} */ (/** @type {unknown} */ (this.running['a4-today']));
      // Weather shows on Today (its note or a town); calendars on Today and the Planner (their note or links).
      const weather = !!td && (!!vault.feedNotes.weather || !!(td.weatherCfg && td.weatherCfg.place));
      const calendars = !!(td || this.running['a4-planner']) && (!!vault.feedNotes.calendar || linksOf(this.app).length > 0);
      found = findSetup(this.app, { engine: !!this.running['a4-projects'], sidebar: !!this.running['a4-sidebar'], weather, calendars });
    } catch (e) { console.error('LifeWorld: the setup window could not look at the vault', e); return; }
    this.setup = new SetupModal(this.app, found, {
      onStart: (f) => this.applySetup(f),
      onChange: () => { const s = this.app.setting; s.open(); if (typeof s.openTabById === 'function') s.openTabById(this.manifest.id); },
      onSeen: first ? () => { this.store[HOST] = { ...(this.store[HOST] || {}), setupSeen: true }; this.writeStore().catch((e) => console.error('LifeWorld: could not save that setup was seen', e)); } : null,
    });
    this.setup.open();
  }

  // Start with this: the found task source and folders, through the existing settings (Tasks, Your vault).
  /** @param {{ source: string | null, folders: Record<string, string> }} found */
  async applySetup(found) {
    const pj = /** @type {PartTypes['a4-projects'] | undefined} */ (/** @type {unknown} */ (this.running['a4-projects']));
    if (pj && found.source && pj.settings.source !== found.source) await pj.setSource(found.source);
    if (Object.keys(found.folders).length) await this.setVaultSettings({ folders: found.folders });
    this.app.workspace.trigger('lifeworld:tasks');
  }

  onunload() {
    if (this.setup) this.setup.closeQuietly();
    this.gone = true; // a switch or outside change still under way starts nothing more
    this.ready = false; // its hooks are gone with it
    this.running = {};
    for (const [m] of PART_LIST) delete /** @type {Record<string, unknown>} */ (PARTS)[m.id];
  }

  // -> the settings file's contents, {} when there is none yet, or null when it is damaged.
  // Obsidian's loadData gives null for a missing file and undefined for one it cannot read or
  // parse (it logs and does not throw; checked in Obsidian 1.14.4's own code).
  /** @returns {Promise<LwStore | null>} */
  async readStore() {
    const d = await this.loadData();
    if (d === null) return {};
    if (d && typeof d === 'object' && !Array.isArray(d)) return /** @type {LwStore} */ (d);
    return null;
  }

  // A damaged settings file at start: copy it aside first, then start on defaults. Until the copy
  // exists nothing is written, so the original can never be overwritten unbacked.
  async setAsideDamaged() {
    const file = `${this.manifest.dir}/data.json`;
    /** @param {number} x */
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
  /** @param {string} id */
  async carryOver(id) {
    const file = `${this.app.vault.configDir}/plugins/${id}/data.json`;
    let text;
    try { text = await this.app.vault.adapter.read(file); } catch { return false; }
    try {
      const d = /** @type {unknown} */ (JSON.parse(text));
      if (d && typeof d === 'object' && !Array.isArray(d)) { this.store[id] = /** @type {Fm} */ (d); return true; }
    } catch { /* unreadable, below */ }
    console.warn(`LifeWorld: could not read ${file}; that part starts on defaults (the file is left as it is).`);
    return false;
  }

  // One write at a time, each with every part's newest settings, so a slower write never lands last.
  /** @returns {Promise<void>} */
  writeStore() {
    if (this.noWrites) return Promise.resolve();
    this.saving = this.saving.catch(() => {}).then(async () => {
      const snap = /** @type {LwStore} */ (copy(this.store));
      this.writing = true;
      try {
        await this.saveData(snap);
        // A Sync change taken during this write: its corners stay the record of what is on disk
        // (the follow-up write puts them there), or a second Sync change to them would look like
        // a change made here and be dropped (review p2-s3). Corners kept from here are in snap.
        const s = this.syncedDuring;
        this.ondisk = snap;
        if (s) {
          this.ondisk = /** @type {LwStore} */ (copy(s.now));
          for (const k of s.kept) if (k in snap) this.ondisk[k] = snap[k]; else delete this.ondisk[k];
        }
      } finally { this.writing = false; this.syncedDuring = null; }
    });
    return this.saving;
  }

  // The file changed outside (Obsidian Sync): each part whose corner changed hears it, as before,
  // and its settings page is redrawn if open (what Obsidian did for each plugin).
  async onExternalSettingsChange() {
    // Settings arrived from another device (Sync): this is not a new install after all. The setup window
    // closes without saving anything, so the synced settings stay as they arrived (spec criterion 5).
    this.firstRun = false;
    if (this.setup) this.setup.closeQuietly();
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
    /** @type {LwStore} */
    const merged = { ...now };
    /** @type {string[]} */
    const kept = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(was)])) {
      if (JSON.stringify(before[k]) === JSON.stringify(was[k])) continue;
      kept.push(k);
      if (k in before) merged[k] = before[k]; else delete merged[k];
    }
    this.ondisk = now;
    this.store = merged;
    /** @type {{ now: LwStore, kept: string[] } | null | undefined} */
    if (this.writing) this.syncedDuring = { now: /** @type {LwStore} */ (copy(now)), kept };
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
      await /** @type {() => Promise<unknown>} */ (p.onExternalSettingsChange)();
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
  /** @param {import('obsidian').App} app @param {LifeWorldPlugin} plugin */
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  display() {
    this.hide();
    const el = this.containerEl;
    el.empty();
    el.addClass('lw-settings');
    new Setting(el).setName('User manual').setDesc('How to use every part, with pictures. Opens the PDF in your web browser, where you can also download it.')
      .addButton((b) => b.setButtonText('Open manual').onClick(() => window.open(MANUAL_URL)));
    new Setting(el).setName('Parts').setHeading();
    for (const x of SWITCHES) {
      new Setting(el).setName(x.name).setDesc(x.desc).addToggle((t) => t
        .setValue(this.plugin.isOn(x.id))
        .onChange(async (v) => { await this.plugin.setPart(x.id, v); this.display(); }));
    }
    el.createDiv({ cls: 'setting-item-description lw-hint', text: 'Each part works on its own. Turn on only what you want.' });
    this.drawPlanning(el);
    this.drawVault(el);
    for (const [id, heading] of HEADINGS) {
      const tab = this.plugin.tabs[id];
      if (!tab) continue;
      new Setting(el).setName(heading).setHeading();
      tab.containerEl = el.createDiv();
      tab.display();
    }
  }

  taskSource() { const pj = this.plugin.running['a4-projects']; return pj && pj.settings ? pj.settings.source : 'builtin'; }

  // Planning: one choice every part follows when a task is put on a day (0.1.16).
  /** @param {HTMLElement} el */
  drawPlanning(el) {
    new Setting(el).setName('Planning').setHeading();
    new Setting(el).setName('When you place a task on a day')
      .setDesc(this.taskSource() === 'checkbox' ? 'Checkboxes: "Set its due date" writes 📅, "Just plan it" writes ⏳.' : 'Dragging a task onto a day, picking a day for it, or adding one straight onto a day. "Set its due date": that day becomes its due date. "Just plan it for that day": the task shows on that day and its due date, if it has one, stays as it is.')
      .addDropdown((d) => d.addOption('due', 'Set its due date').addOption('plan', 'Just plan it for that day')
        .setValue(vault.planning.setsDue ? 'due' : 'plan')
        .onChange(async (v) => { await this.plugin.setVaultSettings({ placeOnDay: v }); this.plugin.app.workspace.trigger('lifeworld:tasks'); }));
  }

  // Your vault: the six folders, Daily notes (Obsidian's own setting), Property names.
  /** @param {HTMLElement} el */
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
    new Setting(el).setName('Look for my notes again').setDesc('Shows the welcome window again. Nothing changes unless you choose to start with what it found.')
      .addButton((b) => b.setButtonText('Run setup').onClick(() => this.plugin.openSetup(false)));
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
  /** @param {import('obsidian').App} app @param {LifeWorldPlugin} plugin @param {() => void} onDone */
  constructor(app, plugin, onDone) { super(app); this.plugin = plugin; this.onDone = onDone; }

  onOpen() {
    const el = this.contentEl;
    el.empty();
    el.addClass('lw-names');
    this.setTitle('Property names');
    el.createEl('p', { cls: 'lw-names-intro', text: 'The properties LifeWorld reads and writes on your task notes. Change a name only if your notes already use a different one. This does not rename anything in your notes.' });
    /** @type {{ key: string, label: string, t: import('obsidian').TextComponent }[]} */
    this.inputs = [];
    /** @param {HTMLElement} parent @param {[string, string, string]} r */
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
    /** @type {Record<string, number>} */
    const count = {};
    for (const x of this.inputs) { const v = x.t.getValue().trim(); count[v] = (count[v] || 0) + 1; }
    for (const x of this.inputs) { const v = x.t.getValue().trim(); x.t.inputEl.toggleClass('lw-bad', !v || count[v] > 1 || vault.BAD_NAME.test(v) || vault.isReserved(v)); }
    this.err.setText(msg);
    this.done.setDisabled(!!msg);
    return !msg;
  }

  async save() {
    if (!this.check()) return;
    /** @type {Record<string, string>} */
    const names = {};
    for (const x of this.inputs) { const v = x.t.getValue().trim(); if (v !== x.key) names[x.key] = v; }
    await this.plugin.setVaultSettings({ names });
    this.close();
    this.onDone();
  }

  onClose() { this.contentEl.empty(); }
}

// The four part classes, for the tests.
// For tests only (start on the frozen test vault's settings). Never set inside Obsidian, which always has a
// window, so no other plugin can reach the vault settings through it (review p2-s8 #2).
if (typeof window === 'undefined') LifeWorldPlugin.vault = vault;
LifeWorldPlugin.parts = Object.fromEntries(PART_LIST.map(([m, P]) => [m.id, P]));

export default LifeWorldPlugin;
LifeWorldPlugin.PropertyNamesModal = PropertyNamesModal; // for tests (the dialog's checks)
