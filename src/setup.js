// The first-run setup window (mockup-first-run-setup.html, approved 2026-10-24): what LifeWorld finds in
// the vault, read only from Obsidian's file list and note index (no note is opened); nothing is saved
// until "Start with this". src/main.js decides when it opens by itself (a brand-new install only).
'use strict';

import { Modal, TFile, TFolder, setIcon, moment } from 'obsidian';
import { dailyNotes, vaultFolders, FOLDER_DEFAULTS } from './core/vault';
import Sidebar from './sidebar/main';

/** @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;

// A top-level folder by name, in any upper or lower case.
/** @param {import('obsidian').App} app @param {string} name @returns {TFolder | null} */
function topFolder(app, name) {
  const f = app.vault.getRoot().children.find((c) => c instanceof TFolder && c.name.toLowerCase() === name.toLowerCase());
  return f instanceof TFolder ? f : null;
}
// The folder Settings › Your vault already names (Run setup in a set-up vault), else a top-level one by its default name.
/** @param {import('obsidian').App} app @param {'tasks' | 'projects'} key @returns {TFolder | null} */
function folderFor(app, key) {
  const set = vaultFolders[key] ? app.vault.getAbstractFileByPath(vaultFolders[key]) : null;
  return set instanceof TFolder ? set : topFolder(app, FOLDER_DEFAULTS[key]);
}

/** @param {TFolder} folder @param {boolean} deep @returns {TFile[]} */
function notesIn(folder, deep) {
  /** @type {TFile[]} */
  const out = [];
  for (const c of folder.children) {
    if (c instanceof TFile && c.extension === 'md') out.push(c);
    else if (deep && c instanceof TFolder) out.push(...notesIn(c, true));
  }
  return out;
}

/**
 * @typedef {{ key: string, title: string, desc: string, ok: boolean, icon?: string }} Row
 * @typedef {{ rows: Row[], source: string | null, folders: Record<string, string> }} Found
 */
// -> what the window shows and what Start saves. engine: the task engine runs (Tasks and Projects rows);
// sidebar: the Sidebar runs (its row); weather, calendars: they are on. Task source, first match wins (spec criterion 8).
/** @param {import('obsidian').App} app @param {{ engine: boolean, sidebar: boolean, weather?: boolean, calendars?: boolean }} on @returns {Found} */
function findSetup(app, on) {
  /** @type {Row[]} */
  const rows = [];
  /** @type {Record<string, string>} */
  const folders = {};
  let source = null;
  const files = app.vault.getMarkdownFiles();
  const fm = (/** @type {TFile} */ f) => { const c = app.metadataCache.getFileCache(f); return (c && c.frontmatter) || null; };

  // Daily notes: the notes whose path inside Obsidian's daily notes folder reads as a date in its format.
  const dn = dailyNotes(app);
  const pre = dn.folder ? `${dn.folder}/` : '';
  const m = /** @type {MomentFn} */ (/** @type {unknown} */ (moment));
  const days = files.filter((f) => f.path.startsWith(pre) && (dn.folder || !f.path.includes('/')) && m(f.path.slice(pre.length, -3), dn.format, true).isValid()).length;
  const where = dn.folder ? `"${dn.folder}"` : 'the top of your vault';
  rows.push(days
    ? { key: 'daily', title: `${count(days, 'daily note')} ${dn.folder ? 'in ' : 'at '}${where}`, desc: "From Obsidian's Daily notes settings. Habits and quick notes go there.", ok: true }
    : { key: 'daily', title: 'No daily notes yet', desc: `LifeWorld uses Obsidian's Daily notes settings: ${dn.folder ? `the folder ${where}` : where}.`, ok: false });

  if (on.engine) {
    const tn = /** @type {TaskNotesPlugin | undefined} */ (app.plugins && app.plugins.plugins && app.plugins.plugins.tasknotes);
    const tasks = folderFor(app, 'tasks');
    if (tn) {
      // What LifeWorld will read: notes with TaskNotes' task tag in its tasks folder (as the task engine does).
      const s = tn.settings || {};
      const folder = typeof s.tasksFolder === 'string' ? s.tasksFolder.replace(/^\/+|\/+$/g, '') : '';
      const tag = typeof s.taskTag === 'string' && s.taskTag ? s.taskTag : 'task';
      const n = files.filter((f) => (!folder || f.path.startsWith(`${folder}/`)) && [fm(f)?.tags ?? []].flat().map(String).includes(tag)).length;
      source = 'tasknotes';
      if (folder) folders.tasks = folder;
      if (typeof s.archiveFolder === 'string' && s.archiveFolder.trim()) folders.archive = s.archiveFolder.replace(/^\/+|\/+$/g, '');
      rows.push({ key: 'tasks', title: `${count(n, 'task')} from the TaskNotes plugin`, desc: 'LifeWorld reads them as they are. Tasks source: TaskNotes plugin.', ok: true });
    } else if (tasks && notesIn(tasks, true).length) {
      source = 'builtin';
      folders.tasks = tasks.path;
      rows.push({ key: 'tasks', title: `${count(notesIn(tasks, true).length, 'task')} in "${tasks.path}"`, desc: 'Each task is its own note. Tasks source: LifeWorld tasks.', ok: true });
    } else {
      let n = 0;
      for (const f of files) { const c = app.metadataCache.getFileCache(f); for (const li of (c && c.listItems) || []) if (li.task === ' ') n++; }
      if (n) {
        source = 'checkbox';
        rows.push({ key: 'tasks', title: `${count(n, 'checkbox', 'checkboxes')} in your notes`, desc: 'Plain "- [ ]" lines, read where they are. Tasks source: Checkboxes in your notes.', ok: true });
      } else {
        source = 'builtin';
        rows.push({ key: 'tasks', title: 'LifeWorld tasks, none yet', desc: `Each task becomes its own note in "${vaultFolders.tasks}" when you add one.`, ok: false });
      }
    }
    const pj = folderFor(app, 'projects');
    if (pj) folders.projects = pj.path;
    rows.push(pj
      ? { key: 'projects', title: `${count(notesIn(pj, false).length, 'project')} in "${pj.path}"`, desc: 'Project pages, the task board and the Planner use this folder.', ok: true }
      : { key: 'projects', title: 'Projects folder: none yet', desc: 'Made when you add your first project.', ok: false });
  }

  if (on.sidebar) {
    const top = app.vault.getRoot().children.filter((c) => c instanceof TFolder).map((c) => c.path);
    const n = Sidebar.__logic.findRoomFolders(top).length;
    rows.push({ key: 'sidebar', title: `Sidebar: your ${count(n, 'top folder')}`, desc: 'You can add your own groups later.', ok: true });
  }
  // Their real state (spec amendment 2026-10-24): a vault where they are on must not read "off".
  const w = !!on.weather, c = !!on.calendars;
  const [title, desc] = w && c ? ['Weather and calendars: on', 'Change them in Settings.']
    : w ? ['Weather: on, calendars: off', 'Turn calendars on in Settings when you want them.']
      : c ? ['Calendars: on, weather: off', 'Turn weather on in Settings when you want it.']
        : ['Weather and calendars: off', 'Turn them on in Settings when you want them.'];
  rows.push({ key: 'weather', title, desc, ok: w || c, icon: 'cloud' });
  return { rows, source, folders };
}

// The window. onStart(found) saves; onChange opens LifeWorld's settings; onSeen (first run only) records
// that it was closed. closeQuietly(): closes without onSeen (settings arrived by Sync, criterion 5).
class SetupModal extends Modal {
  /** @param {import('obsidian').App} app @param {Found} found @param {{ onStart: (f: Found) => Promise<void>, onChange: () => void, onSeen: (() => void) | null }} hooks */
  constructor(app, found, hooks) { super(app); this.found = found; this.hooks = hooks; this.quiet = false; }

  onOpen() {
    const el = this.contentEl;
    el.empty();
    this.modalEl.addClass('lw-setup');
    this.modalEl.setAttr('aria-label', 'Welcome to LifeWorld');
    el.createDiv({ cls: 'lw-setup-eyebrow', text: 'Welcome to LifeWorld' });
    el.createDiv({ cls: 'lw-setup-title', text: 'Here is what I found in your vault' });
    el.createDiv({ cls: 'lw-setup-lead', text: 'Nothing has been changed. Check these, then start.' });
    for (const r of this.found.rows) {
      const row = el.createDiv({ cls: 'lw-setup-row' });
      setIcon(row.createSpan({ cls: `lw-setup-ic${r.ok ? '' : ' is-off'}` }), r.icon || (r.ok ? 'circle-check' : 'circle'));
      const t = row.createDiv({ cls: 'lw-setup-text' });
      t.createEl('b', { text: r.title });
      t.createEl('small', { text: r.desc });
      if (r.key === 'weather') continue;
      const ch = row.createEl('a', { cls: 'lw-setup-change', text: 'Change', href: '#', attr: { 'aria-label': `Change: ${r.title}` } });
      ch.addEventListener('click', (e) => { e.preventDefault(); this.close(); this.hooks.onChange(); });
    }
    const btns = el.createDiv({ cls: 'modal-button-container' });
    btns.createEl('button', { text: 'Set up later' }).addEventListener('click', () => this.close());
    const go = btns.createEl('button', { cls: 'mod-cta', text: 'Start with this' });
    go.addEventListener('click', () => {
      go.disabled = true;
      this.hooks.onStart(this.found).then(() => this.close(), (e) => { console.error('LifeWorld: setup could not be saved', e); go.disabled = false; });
    });
  }

  closeQuietly() { if (this.shut) return; this.quiet = true; this.close(); }

  onClose() {
    this.shut = true;
    this.contentEl.empty();
    if (!this.quiet && this.hooks.onSeen) this.hooks.onSeen();
  }
}

export { findSetup, SetupModal };
