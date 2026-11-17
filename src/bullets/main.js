// Typed bullets (Tana-style bullets job, 2026-11-10; approved mockup-tana-style-bullets.html): the # menu
// on a bullet, the field rows under it, the person pill, the live list block, the settings rows and the
// outline look. Runs inside LifeWorld itself (not one of the four parts), its settings in LifeWorld's
// own corner of the settings file under "bullets". Rules with no Obsidian in them: ./logic.js.
'use strict';

import { Notice, Modal, Setting, EditorSuggest, TFile, TFolder, Menu, FuzzySuggestModal, MarkdownRenderChild, Keymap, setIcon, normalizePath, editorLivePreviewField, editorInfoField } from 'obsidian';
import * as L from './logic';
import { PARTS } from '../core/parts';
import { understand, quickAddPlan } from '../core/quickadd';

/** @typedef {import('./logic').BtType} BtType */
/** @typedef {import('./logic').BtField} BtField */
/** @typedef {import('./logic').BtChoice} BtChoice */
/** @typedef {{ store: Record<string, Fm>, writeStore(): Promise<void>, app: import('obsidian').App } & import('obsidian').Plugin} Host */

const HOST = 'lifeworld';
const TASK_COLOR = 'var(--interactive-accent)';
/** @param {BtType | 'task'} t */
const colorOf = (t) => (t === L.TASK ? TASK_COLOR : `var(--color-${t.color})`);
/** @param {BtType | 'task'} t */
const nameOf = (t) => (t === L.TASK ? L.TASK : t.name);
/** @param {string} s */
const low = (s) => String(s || '').toLowerCase();
// A note path's name: "a/b/Mara.md" -> "Mara".
/** @param {string} p */
const baseName = (p) => /** @type {string} */ (p.split('/').pop()).replace(/\.md$/i, '');
// The [[links]] in a line, with their place: [{ from, to, linkpath, alias }].
/** @param {string} text @param {number} [offset] */
function linksIn(text, offset = 0) {
  const out = [];
  const re = /\[\[([^\]|#^]*)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  for (let m = re.exec(text); m; m = re.exec(text)) if (m[1].trim()) out.push({ from: offset + m.index, to: offset + m.index + m[0].length, linkpath: m[1].trim(), alias: m[2] || '' });
  return out;
}

class Bullets {
  /** @param {Host} host */
  constructor(host) {
    this.host = host;
    this.app = host.app;
    /** @type {Set<import('@codemirror/view').EditorView>} */
    this.views = new Set();
    /** @type {import('@codemirror/state').StateEffectType<null> | null} */
    this.refreshEffect = null;
    /** @type {Set<LiveList>} */
    this.lists = new Set();
    /** @type {number | null} */
    this.timer = null;
    /** @type {{ raw: unknown, types: BtType[] } | null} */
    this.typesCache = null;
  }

  /* ---- settings --------------------------------------------------------------------------------------- */
  saved() { const h = this.host.store[HOST] || {}; return /** @type {Fm} */ (h.bullets || {}); }
  // Never saved until the first change, so loading LifeWorld writes nothing (criterion 8).
  /** @returns {BtType[]} */
  types() {
    const raw = this.saved().types;
    // Cleaned once per saved list: a save or a Sync change puts a new list in the store.
    if (!this.typesCache || this.typesCache.raw !== raw) this.typesCache = { raw, types: L.cleanTypes(raw) };
    return this.typesCache.types;
  }
  // The whole feature's switch (owner request, 2026-11-11): off until turned on, so LifeWorld works as before.
  on() { return this.saved().on === true; }
  outlineOn() { return this.saved().outline !== false; }
  /** @param {Fm} patch */
  async save(patch) {
    const h = this.host.store[HOST] || {};
    this.host.store[HOST] = { ...h, bullets: { ...this.saved(), ...patch } };
    await this.host.writeStore();
    this.applyOutline();
    this.refreshSoon();
    // Reading view drew its pills once; turning the feature on or off draws open notes again.
    if ('on' in patch) for (const l of this.app.workspace.getLeavesOfType('markdown')) /** @type {{ previewMode?: { rerender: (full: boolean) => void } }} */ (/** @type {unknown} */ (l.view)).previewMode?.rerender(true);
  }
  /** @param {BtType[]} types */
  saveTypes(types) { return this.save({ types: L.cleanTypes(types) }); }
  applyOutline() { document.body.toggleClass('lw-outline', this.on() && this.outlineOn()); }

  // The type whose own notes live in this note's folder and carry its starting properties (criterion 10a), or null.
  /** @param {TFile | null} f */
  ownType(f) {
    if (!(f instanceof TFile) || f.extension !== 'md') return null;
    const fm = /** @type {Fm} */ ((this.app.metadataCache.getFileCache(f) || {}).frontmatter || {});
    return this.types().find((t) => t.where === 'folder' && t.folder && f.path.startsWith(`${t.folder}/`)
      && Object.entries(t.props || {}).every(([k, v]) => low(String(fm[k] == null ? '' : fm[k])) === low(v))) || null;
  }
  /** @param {TFile | null} f */
  // The Person type when f is one of its notes (its color draws the pill), else null.
  isPerson(f) { const t = this.ownType(f); return t && low(t.name) === 'person' ? t : null; }
  projects() { return PARTS['a4-projects'] || null; }
  /** @param {TFile | null} f */
  isTaskNote(f) { const pj = this.projects(); return !!pj && f instanceof TFile && !!pj.engine && pj.engine.isTaskFile(f); }

  /* ---- start / stop ------------------------------------------------------------------------------------ */
  start() {
    const p = this.host;
    this.applyOutline();
    p.register(() => document.body.removeClass('lw-outline'));
    const menu = new TagSuggest(this);
    p.registerEditorSuggest(menu);
    p.registerEditorSuggest(new PersonSuggest(this));
    // Obsidian's own tag box answers # first; the # menu goes ahead of it on a bullet's end (it answers nothing elsewhere).
    const list = this.app.workspace.editorSuggest && this.app.workspace.editorSuggest.suggests;
    if (Array.isArray(list) && list.includes(menu)) { list.splice(list.indexOf(menu), 1); list.unshift(menu); }
    p.registerMarkdownPostProcessor((el, ctx) => this.postProcess(el, ctx));
    p.registerMarkdownCodeBlockProcessor('lifeworld-bullets', (src, el, ctx) => { ctx.addChild(new LiveList(this, src, el, ctx.sourcePath)); });
    /** @type {import('@codemirror/state').Extension[]} */
    const ext = [];
    p.registerEditorExtension(ext);
    // As the task links do: CodeMirror loads here, so a missing module turns off only the Live Preview look.
    Promise.all([import('@codemirror/state'), import('@codemirror/view')])
      .then((ms) => { ext.push(this.editorExtension(/** @type {CM} */ (Object.assign({}, ...ms)))); this.app.workspace.updateOptions(); })
      .catch((e) => console.warn('[LifeWorld] typed bullets in Live Preview unavailable', e));
    p.registerEvent(this.app.metadataCache.on('changed', (f) => this.changed(f)));
    p.registerEvent(this.app.vault.on('rename', () => this.refreshSoon()));
    p.registerEvent(this.app.vault.on('delete', () => this.refreshSoon()));
    p.register(() => { if (this.timer) window.clearTimeout(this.timer); });
  }
  // A note changed: rows that read its properties, and live lists that may hold it, draw again.
  /** @param {TFile} f */
  changed(f) {
    for (const l of this.lists) l.noteChanged(f);
    const watched = Array.from(document.querySelectorAll('.lw-bt-rows[data-path], .lw-bt-person[data-path]')).some((el) => /** @type {HTMLElement} */ (el).dataset.path === f.path);
    if (watched || this.ownType(f)) this.refreshSoon();
  }
  refreshSoon() {
    if (this.timer) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      for (const v of Array.from(this.views)) { try { if (this.refreshEffect) v.dispatch({ effects: this.refreshEffect.of(null) }); } catch { this.views.delete(v); } }
      for (const el of /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll('.lw-bt-rows[data-path]')))) if (!el.dataset.cm) this.fillRows(el);
      for (const l of this.lists) l.drawSoon();
    }, 150);
  }

  /* ---- the # menu: what picking a choice does (criterion 2, 10) ---------------------------------------- */
  /** @param {import('obsidian').Editor} editor @param {TFile} file @param {number} line @param {number} at where the # is @param {number} end @param {BtChoice} choice */
  async pick(editor, file, line, at, end, choice) {
    const original = editor.getLine(line);
    const rest = original.slice(end);
    if (choice.kind === 'create') {
      editor.transaction({ changes: [{ from: { line, ch: at }, to: { line, ch: end }, text: `#${choice.name}` }] });
      new TypeModal(this, { name: choice.name, onDone: (t, other) => this.afterCreate(editor, file, line, other || t) }).open();
      return;
    }
    const type = choice.type;
    // The tag comes out of the line; a #task in the middle leaves one space, not two.
    const text = (original.slice(0, at).replace(/\s+$/, '') + (rest.trim() ? ` ${rest.trimStart()}` : '')).replace(/\s+$/, '');
    const l = type === L.TASK ? L.anyLine(text) : L.listLine(text);
    if (!l || !l.text.trim()) { new Notice(`Write the bullet first, then add #${type === L.TASK ? L.TASK : type.name}.`); return; }
    const body = l.text.trim();
    // Where the words start, from the line as it is (a #task at the very start leaves no marker to keep).
    if (type === L.TASK) return this.makeTask(editor, file, line, original, L.anyLine(original).textAt, body);
    if (type.where === 'folder') return this.linkOwnNote(editor, file, line, original, l.textAt, body, type);
    const have = L.fieldsUnder(this.docLines(editor), line).map((f) => f.name);
    const add = L.fieldLinesFor(type, l.indent, have);
    // One change, so one Cmd+Z takes the tag and the field lines back.
    editor.transaction({ changes: [{ from: { line, ch: 0 }, to: { line, ch: original.length }, text: `${text}${text.endsWith(' ') ? '' : ' '}#${type.name}${add.length ? `\n${add.join('\n')}` : ''}` }] });
  }
  // Whether this line sits inside a code block (the menus stay out of code).
  /** @param {import('obsidian').Editor} editor @param {number} line */
  inFence(editor, line) { let f = ''; for (let i = 0; i < line; i++) f = L.fenceAfter(f, editor.getLine(i)); return !!f; }
  /** @param {import('obsidian').Editor} editor */
  docLines(editor) { const out = []; for (let i = 0; i < editor.lineCount(); i++) out.push(editor.getLine(i)); return out; }

  // A new type was saved from the box (or "Use Person instead"): the bullet's tag is put right and the type's work done.
  /** @param {import('obsidian').Editor} editor @param {TFile} file @param {number} line0 @param {BtType} type */
  async afterCreate(editor, file, line0, type) {
    const line = this.findTagged(editor, line0);
    if (line < 0) return;
    const t = /** @type {NonNullable<ReturnType<typeof L.tagAtEnd>>} */ (L.tagAtEnd(editor.getLine(line)));
    await this.pick(editor, file, line, t.at, t.end, { kind: 'type', type });
  }
  // The tagged bullet again after a box was open (lines may have moved): the same line if it still ends in a tag, else -1.
  /** @param {import('obsidian').Editor} editor @param {number} line */
  findTagged(editor, line) { return line < editor.lineCount() && L.tagAtEnd(editor.getLine(line)) ? line : -1; }

  // #task (criterion 2): a real task note through the same code as quick add, then the bullet becomes its link.
  /** @param {import('obsidian').Editor} editor @param {TFile} file @param {number} line @param {string} original @param {number} textAt @param {string} body */
  async makeTask(editor, file, line, original, textAt, body) {
    const pj = this.projects();
    if (!pj || !pj.engine) { new Notice('Turn on the Today page, Planner or Projects in Settings › LifeWorld to make tasks.'); return; }
    if (!body || linksIn(body).some((m) => this.isTaskNote(this.app.metadataCache.getFirstLinkpathDest(m.linkpath, file.path)))) {
      new Notice(body ? 'This bullet already links to a task.' : 'Write the task first, then add #task.');
      return;
    }
    const today = pj.engine.today();
    const r = understand(L.plain(body), today);
    if (!r.title) { new Notice('Write the task first, then add #task.'); return; }
    const { input } = quickAddPlan(r, today);
    if (input.customFrontmatter && !Object.keys(input.customFrontmatter).length) delete input.customFrontmatter;
    const project = this.projectOf(file);
    if (project) input.projects = [`[[${project.replace(/\.md$/i, '')}]]`];
    input.details = `${body === L.plain(body) ? '' : `${body}\n\n`}From [[${this.app.metadataCache.fileToLinktext(file, pj.engine.cfg().tasksFolder + '/x.md', true)}]]`;
    let made;
    try { made = await pj.createTask(input); } catch (e) { console.error('[LifeWorld] #task', e); new Notice(`Could not make the task. ${e instanceof Error ? e.message : ''}`.trim()); return; }
    const tf = made && made.result && made.result.path ? this.app.vault.getAbstractFileByPath(made.result.path) : null;
    if (!(tf instanceof TFile)) { new Notice('The task was made, but its note was not found to link it.'); return; }
    // Checkbox tasks live in the daily note, not a note of their own: nothing to link the bullet to.
    // (Asked of the setting, not the note: a note this new is not read by Obsidian yet.)
    if (pj.ext && pj.ext.id === 'checkbox') { new Notice(`Task added to ${tf.basename}: ${r.title}.`); return; }
    const link = this.app.metadataCache.fileToLinktext(tf, file.path, true);
    const shown = link.split('/').pop() === r.title ? '' : `|${r.title}`;
    if (this.replaceLine(editor, line, original, textAt, `[[${link}${shown}]] #task`)) new Notice(`Task made: ${r.title}${project ? ` (in ${baseName(project)})` : ''}. Cmd+Z takes the link off the bullet; the task note stays.`);
    else new Notice(`Task made: ${r.title}. The bullet changed meanwhile, so it was not linked.`);
  }
  // The note's project (criterion 2): the note itself when it is a project, else the first project its own
  // projects / project property links to, else none.
  /** @param {TFile} file @returns {string | null} */
  projectOf(file) {
    const pj = this.projects();
    if (!pj || typeof pj.textTaskProjectFacts !== 'function') return null;
    const { facts } = pj.textTaskProjectFacts(file);
    return facts.self || facts.fmPaths[0] || null;
  }
  // The bullet's text from textAt to the end becomes `text`, in one change (one undo). The line is found
  // again if it moved; false when it was changed meanwhile.
  /** @param {import('obsidian').Editor} editor @param {number} line @param {string} original @param {number} textAt @param {string} text */
  replaceLine(editor, line, original, textAt, text) {
    let at = line < editor.lineCount() && editor.getLine(line) === original ? line : -1;
    if (at < 0) { const lines = this.docLines(editor); const hits = lines.flatMap((x, i) => (x === original ? [i] : [])); if (hits.length === 1) at = hits[0]; }
    if (at < 0) return false;
    editor.transaction({ changes: [{ from: { line: at, ch: textAt }, to: { line: at, ch: original.length }, text }] });
    return true;
  }

  // An own-note type (criterion 2): the bullet's text names the note; an existing one in the folder is
  // linked, else it is made there with the type's starting properties.
  /** @param {import('obsidian').Editor} editor @param {TFile} file @param {number} line @param {string} original @param {number} textAt @param {string} body @param {BtType} type */
  async linkOwnNote(editor, file, line, original, textAt, body, type) {
    const existing = linksIn(body)[0];
    const name = (existing ? this.app.metadataCache.getFirstLinkpathDest(existing.linkpath, file.path)?.basename || existing.linkpath : body).replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
    if (!name) { new Notice(`Write the name first, then add #${type.name}.`); return; }
    const own = await this.ownNote(type, name);
    if (!own) return;
    const { f, made, folder } = own;
    const link = this.app.metadataCache.fileToLinktext(f, file.path, true);
    // Found by an alias ("Mara" for Mara Lopez): the link shows the words typed.
    const shown = low(f.basename) === low(name) ? '' : `|${name}`;
    // A bullet that already links the note keeps all its words; otherwise its text was the name.
    const ok = this.replaceLine(editor, line, original, textAt, existing && existing.linkpath && this.app.metadataCache.getFirstLinkpathDest(existing.linkpath, file.path) === f ? `${body} #${type.name}` : `[[${link}${shown}]] #${type.name}`);
    if (made) new Notice(ok ? `Made ${f.basename} in ${folder}. Cmd+Z takes the link off the bullet; the note stays.` : `Made ${f.basename} in ${folder}. The bullet changed meanwhile, so it was not linked.`);
    else if (!ok) new Notice('The bullet changed meanwhile, so it was not linked.');
  }
  // Saves the folder a type's notes go in, chosen or found (criterion 14), and says so once.
  /** @param {BtType} type @param {string} folder @returns {Promise<BtType>} */
  async setFolder(type, folder) {
    const t = { ...type, folder };
    await this.saveTypes(this.types().map((x) => (x.name === t.name ? t : x)));
    new Notice(`${t.name} notes come from ${folder} now. Change it in LifeWorld settings.`);
    return t;
  }
  // The type's note by this name: found in its folder, else made there with its starting properties. The
  // folder is asked for the first time. null when that was cancelled or the note could not be made.
  /** @param {BtType} type0 @param {string} name @returns {Promise<{ f: TFile, made: boolean, folder: string } | null>} */
  async ownNote(type0, name) {
    let type = type0;
    if (!type.folder) {
      const folder = matchingFolder(this.app, type, this.types()) || await askFolder(this.app, type, `Where do ${type.name} notes go?`, this.types());
      if (!folder) return null;
      type = await this.setFolder(type, folder);
    }
    const folder = /** @type {string} */ (type.folder);
    const found = this.findOwnNote(folder, name);
    if (found) return { f: found, made: false, folder };
    try {
      if (!(this.app.vault.getAbstractFileByPath(folder) instanceof TFolder)) await this.app.vault.createFolder(folder);
      const f = await this.app.vault.create(normalizePath(`${folder}/${name}.md`), '');
      const props = type.props || {};
      if (Object.keys(props).length) await this.app.fileManager.processFrontMatter(f, (fm) => { for (const [k, v] of Object.entries(props)) if (fm[k] == null) fm[k] = v; });
      return { f, made: true, folder };
    } catch (e) { console.error('[LifeWorld] own note', e); new Notice(`Could not make the note for ${name}. ${e instanceof Error ? e.message : ''}`.trim()); return null; }
  }
  // A note in the folder (or below it) by name or one of its aliases, any case.
  /** @param {string} folder @param {string} name */
  findOwnNote(folder, name) {
    const n = low(name);
    const all = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${folder}/`));
    return all.find((f) => low(f.basename) === n) || all.find((f) => this.aliasesOf(f).some((x) => low(x.trim()) === n)) || null;
  }
  /** @param {TFile} f @returns {string[]} */
  aliasesOf(f) {
    const fm = /** @type {Fm} */ ((this.app.metadataCache.getFileCache(f) || {}).frontmatter || {});
    const a = fm.aliases == null ? fm.alias : fm.aliases;
    return (Array.isArray(a) ? a : a == null ? [] : [a]).map(String);
  }

  /* ---- field rows read from a note's properties (own-note types and tasks) ------------------------------- */
  // The rows under a bullet that links to a note of its own: el.dataset.path, .type ('task' or the type's name).
  /** @param {string} path @param {BtType | 'task'} type @param {boolean} [cm] */
  rowsEl(path, type, cm) {
    const el = createDiv({ cls: 'lw-bt-rows' });
    el.dataset.path = path;
    el.dataset.type = nameOf(type);
    if (cm) el.dataset.cm = '1';
    this.fillRows(el);
    return el;
  }
  /** @param {HTMLElement} el */
  fillRows(el) {
    el.empty();
    const f = this.app.vault.getAbstractFileByPath(/** @type {string} */ (el.dataset.path));
    if (!(f instanceof TFile)) return;
    const fm = /** @type {Fm} */ ((this.app.metadataCache.getFileCache(f) || {}).frontmatter || {});
    if (el.dataset.type === L.TASK) return this.taskRows(el, f, fm);
    const type = L.typeFor(this.types(), /** @type {string} */ (el.dataset.type));
    if (!type || type === L.TASK) return;
    for (const fd of type.fields) {
      const v = fm[L.propKey(fd.name)];
      const text = v == null ? '' : Array.isArray(v) ? v.map(String).join(', ') : String(v);
      this.row(el, fd.name, L.plain(text), fd.kind === 'text' ? null : (e) => this.pickValue(e, fd, (val) => this.app.fileManager.processFrontMatter(f, (m) => { if (val === null) delete m[L.propKey(fd.name)]; else m[L.propKey(fd.name)] = val; })),
        fd.kind === 'text' ? () => this.askText(fd.name, text, (val) => this.app.fileManager.processFrontMatter(f, (m) => { m[L.propKey(fd.name)] = val || null; })) : null);
    }
  }
  // A task's Status, Due and Project rows (criterion 2), written through the task engine like every other task change.
  /** @param {HTMLElement} el @param {TFile} f @param {Fm} fm */
  taskRows(el, f, fm) {
    const pj = this.projects();
    if (!pj || !pj.engine) return;
    const eng = pj.engine;
    const cfg = eng.cfg();
    const status = String(fm[cfg.F.status] == null ? cfg.defaultStatus : fm[cfg.F.status]);
    const st = cfg.statuses.find((s) => s.value === status);
    const run = (/** @type {() => Promise<unknown>} */ fn) => fn().catch((e) => { console.error('[LifeWorld] task row', e); new Notice(`Could not change the task. ${e instanceof Error ? e.message : ''}`.trim()); });
    this.row(el, 'Status', st ? st.label : status, (e) => {
      const m = new Menu();
      for (const s of cfg.statuses) m.addItem((it) => it.setTitle(s.label).setChecked(s.value === status).onClick(() => run(() => eng.setStatus(f.path, s.value))));
      m.showAtMouseEvent(e);
    });
    const due = fm[cfg.F.due] == null ? '' : String(fm[cfg.F.due]);
    this.row(el, 'Due', due ? due.replace('T', ' ') : '', (e) => this.pickValue(e, { name: 'Due', kind: 'date' }, (v) => run(() => eng.setDue(f.path, v || null))));
    const proj = fm[cfg.F.projects];
    const list = (Array.isArray(proj) ? proj : proj == null ? [] : [proj]).map((x) => L.plain(String(x)));
    this.row(el, 'Project', list.join(', '), null);
  }
  // One row: the name small and muted, the value (or a faint Empty), a ▾ when it has a picker.
  /** @param {HTMLElement} el @param {string} name @param {string} value @param {((e: MouseEvent) => unknown) | null} onPick @param {(() => unknown) | null} [onEdit] */
  row(el, name, value, onPick, onEdit) {
    const r = el.createDiv({ cls: 'lw-bt-row' });
    r.createSpan({ cls: 'lw-bt-name', text: name });
    const v = r.createSpan({ cls: value ? 'lw-bt-value' : 'lw-bt-value is-empty', text: value || 'Empty' });
    const act = onPick || onEdit;
    if (!act) return;
    v.addClass('is-button');
    v.setAttr('role', 'button');
    v.setAttr('tabindex', '0');
    if (onPick) setIcon(r.createSpan({ cls: 'lw-bt-caret' }), 'chevron-down');
    /** @param {Event} e */
    const go = (e) => { e.preventDefault(); e.stopPropagation(); act(/** @type {MouseEvent} */ (e)); };
    r.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(e); });
  }
  // The picker for a field (criterion 4): Choice a menu, Date a date box, Link the note finder. val null = clear.
  /** @param {MouseEvent} e @param {BtField} fd @param {(val: string | null) => unknown} done */
  pickValue(e, fd, done) {
    if (fd.kind === 'choice') {
      const m = new Menu();
      for (const o of fd.options || []) m.addItem((it) => it.setTitle(o).onClick(() => done(o)));
      m.addItem((it) => it.setTitle('Clear').setIcon('x').onClick(() => done(null)));
      if (e && typeof e.clientX === 'number' && (e.clientX || e.clientY)) m.showAtMouseEvent(e); else m.showAtPosition({ x: 100, y: 100 });
    } else if (fd.kind === 'date') new DateModal(this.app, fd.name, done).open();
    else if (fd.kind === 'link') new NotePickModal(this.app, (f) => done(f ? `[[${this.app.metadataCache.fileToLinktext(f, '', true)}]]` : null)).open();
  }
  /** @param {string} name @param {string} value @param {(v: string) => unknown} done */
  askText(name, value, done) { new TextModal(this.app, name, value, done).open(); }

  /* ---- reading view ------------------------------------------------------------------------------------ */
  /** @param {HTMLElement} el @param {import('obsidian').MarkdownPostProcessorContext} ctx */
  postProcess(el, ctx) {
    if (!this.on()) return;
    const types = this.types();
    const src = ctx.sourcePath;
    for (const a of /** @type {HTMLElement[]} */ (Array.from(el.querySelectorAll('a.tag')))) {
      const li = a.closest('li');
      const type = L.typeFor(types, (a.textContent || '').replace(/^#/, ''));
      if (!li || !type || !this.lastInLine(a, li)) continue;
      a.addClass('lw-bt-tag');
      a.style.setProperty('--lw-bt-c', colorOf(type));
      li.addClass('lw-bt-li');
      li.style.setProperty('--lw-bt-c', colorOf(type));
      if (type === L.TASK || type.where === 'folder') {
        const link = Array.from(li.querySelectorAll('a.internal-link')).find((x) => x.closest('li') === li);
        const dest = link ? this.app.metadataCache.getFirstLinkpathDest((link.getAttribute('data-href') || '').split('#')[0], src) : null;
        if (dest && (type === L.TASK ? this.isTaskNote(dest) : true)) { const sub = li.querySelector(':scope > ul, :scope > ol'); const rows = this.rowsEl(dest.path, type); if (sub) sub.before(rows); else li.append(rows); }
      } else this.fieldItems(li, type, el, ctx);
    }
    for (const a of /** @type {HTMLElement[]} */ (Array.from(el.querySelectorAll('a.internal-link')))) {
      if (a.hasClass('lw-bt-person') || a.closest('.a4pj-tl')) continue;
      const f = this.app.metadataCache.getFirstLinkpathDest((a.getAttribute('data-href') || '').split('#')[0], src);
      const pt = f ? this.isPerson(f) : null;
      if (f && pt && !a.hasClass('a4pj-tl-hidden')) { this.personPill(a, f); a.style.setProperty('--lw-bt-c', colorOf(pt)); }
    }
  }
  // Whether a is the last thing on the bullet's own line (nothing but spaces after it before a sub-list).
  /** @param {HTMLElement} a @param {HTMLElement} li */
  lastInLine(a, li) {
    for (let n = /** @type {Node | null} */ (a); n && n !== li; n = n.parentNode) {
      for (let s = n.nextSibling; s; s = s.nextSibling) {
        if (s.nodeType === 1 && /^(UL|OL|DIV)$/.test(/** @type {Element} */ (s).tagName)) return true;
        if ((s.textContent || '').trim()) return false;
      }
    }
    return true;
  }
  // Field lines under a kept-in-note bullet, drawn as rows; the ▾ writes the value into the note's line.
  /** @param {HTMLElement} li @param {BtType} type @param {HTMLElement} el @param {import('obsidian').MarkdownPostProcessorContext} ctx */
  fieldItems(li, type, el, ctx) {
    const sub = li.querySelector(':scope > ul');
    if (!sub) return;
    for (const item of /** @type {HTMLElement[]} */ (Array.from(sub.children))) {
      const first = Array.from(item.childNodes).find((n) => n.nodeType === 3 && (n.textContent || '').trim());
      const m = first ? /^\s*([^:\n]*?[^:\s]):: ?/.exec(first.textContent || '') : null;
      if (!m || !first) continue;
      const fd = type.fields.find((x) => low(x.name) === low(m[1]));
      item.addClass('lw-bt-fieldli');
      first.textContent = (first.textContent || '').slice(m[0].length);
      const label = createSpan({ cls: 'lw-bt-name', text: m[1].trim() });
      item.insertBefore(label, first);
      const hasValue = Array.from(item.childNodes).some((n) => n !== label && !(n.nodeType === 1 && /^(UL|OL)$/.test(/** @type {Element} */ (n).tagName)) && (n.textContent || '').trim());
      if (!hasValue) label.after(createSpan({ cls: 'lw-bt-value is-empty', text: 'Empty' }));
      if (!fd || fd.kind === 'text') continue;
      const caret = createSpan({ cls: 'lw-bt-caret is-button', attr: { role: 'button', tabindex: '0', 'aria-label': `Pick ${fd.name}` } });
      setIcon(caret, 'chevron-down');
      const sub2 = item.querySelector(':scope > ul');
      if (sub2) sub2.before(caret); else item.append(caret);
      caret.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const info = ctx.getSectionInfo(el);
        const rel = Number(item.getAttribute('data-line'));
        const line = info && Number.isFinite(rel) ? info.lineStart + rel : -1;
        this.pickValue(e, fd, (val) => this.writeField(ctx.sourcePath, line, fd.name, val));
      });
    }
  }
  // Reading view: the value of the field line `line` (found by its name, near that line if it moved) is set.
  /** @param {string} path @param {number} line @param {string} name @param {string | null} val */
  async writeField(path, line, name, val) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) return;
    let done = false;
    await this.app.vault.process(f, (text) => {
      const lines = text.split('\n');
      const ok = (/** @type {number} */ i) => { const fl = i >= 0 && i < lines.length ? L.fieldLine(lines[i]) : null; return fl && low(fl.name) === low(name) ? fl : null; };
      const at = ok(line) ? line : -1;
      if (at < 0) return text;
      const fl = /** @type {NonNullable<ReturnType<typeof L.fieldLine>>} */ (ok(at));
      lines[at] = `${lines[at].slice(0, fl.valueAt).replace(/:: ?$/, ':: ')}${val || ''}`;
      done = true;
      return lines.join('\n');
    });
    if (!done) new Notice(`Could not find the ${name} line to change. Switch to editing and change it there.`);
  }
  /** @param {HTMLElement} a @param {TFile} f */
  personPill(a, f) {
    a.addClass('lw-bt-person');
    a.dataset.path = f.path;
    a.prepend(createSpan({ cls: 'lw-bt-badge', text: L.initials(a.textContent || f.basename) }));
  }

  /* ---- live preview ------------------------------------------------------------------------------------ */
  /** @param {CM} cm */
  editorExtension({ RangeSetBuilder, StateEffect, ViewPlugin, Decoration, WidgetType, Prec }) {
    const rowsEl = this.rowsEl.bind(this);
    const pickValue = this.pickValue.bind(this);
    const views = this.views;
    const refresh = StateEffect.define();
    this.refreshEffect = refresh;
    class Rows extends WidgetType {
      /** @param {string} path @param {BtType | 'task'} type @param {string} key */
      constructor(path, type, key) { super(); this.path = path; this.type = type; this.k = key; }
      /** @param {WidgetType} o */
      eq(o) { return o instanceof Rows && o.k === this.k; }
      toDOM() { return rowsEl(this.path, this.type, true); }
      ignoreEvent() { return true; }
    }
    class Badge extends WidgetType {
      /** @param {string} text @param {string} style */
      constructor(text, style) { super(); this.text = text; this.style = style; }
      /** @param {WidgetType} o */
      eq(o) { return o instanceof Badge && o.text === this.text && o.style === this.style; }
      toDOM() { return createSpan({ cls: 'lw-bt-badge', text: this.text, attr: { style: this.style } }); }
    }
    class Label extends WidgetType {
      /** @param {string} name @param {number} pos */
      constructor(name, pos) { super(); this.name = name; this.pos = pos; }
      /** @param {WidgetType} o */
      eq(o) { return o instanceof Label && o.name === this.name && o.pos === this.pos; }
      /** @param {import('@codemirror/view').EditorView} view */
      toDOM(view) {
        const el = createSpan({ cls: 'lw-bt-name', text: this.name });
        // Clicking the name shows the raw line (criterion 4).
        el.addEventListener('mousedown', (e) => { e.preventDefault(); view.dispatch({ selection: { anchor: this.pos } }); view.focus(); });
        return el;
      }
    }
    // The type tag as one pill; clicking it shows the raw #tag to edit.
    class Pill extends WidgetType {
      /** @param {string} text @param {string} style @param {number} pos */
      constructor(text, style, pos) { super(); this.text = text; this.style = style; this.pos = pos; }
      /** @param {WidgetType} o */
      eq(o) { return o instanceof Pill && o.text === this.text && o.style === this.style && o.pos === this.pos; }
      /** @param {import('@codemirror/view').EditorView} view */
      toDOM(view) {
        const el = createSpan({ cls: 'lw-bt-tag', text: this.text, attr: { style: this.style } });
        el.addEventListener('mousedown', (e) => { e.preventDefault(); view.dispatch({ selection: { anchor: this.pos } }); view.focus(); });
        return el;
      }
    }
    class Caret extends WidgetType {
      /** @param {BtField} fd @param {number} line @param {boolean} empty */
      constructor(fd, line, empty) { super(); this.fd = fd; this.line = line; this.empty = empty; }
      /** @param {WidgetType} o */
      eq(o) { return o instanceof Caret && o.fd.name === this.fd.name && o.fd.kind === this.fd.kind && String(o.fd.options) === String(this.fd.options) && o.line === this.line && o.empty === this.empty; }
      /** @param {import('@codemirror/view').EditorView} view */
      toDOM(view) {
        const el = createSpan({ cls: 'lw-bt-tail' });
        if (this.empty) el.createSpan({ cls: 'lw-bt-value is-empty', text: 'Empty' });
        if (this.fd.kind === 'text') return el;
        const c = el.createSpan({ cls: 'lw-bt-caret is-button', attr: { role: 'button', tabindex: '0', 'aria-label': `Pick ${this.fd.name}` } });
        setIcon(c, 'chevron-down');
        c.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
        c.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          const lineNo = this.line;
          pickValue(e, this.fd, (val) => {
            if (lineNo > view.state.doc.lines) return;
            const ln = view.state.doc.line(lineNo);
            const fl = L.fieldLine(ln.text);
            if (!fl || low(fl.name) !== low(this.fd.name)) return;
            // Through the editor, so it is one Cmd+Z (criterion 4).
            view.dispatch({ changes: { from: ln.from + fl.valueAt, to: ln.to, insert: val || '' } });
          });
        });
        return el;
      }
      ignoreEvent() { return true; }
    }
    /** @param {import('@codemirror/state').EditorState} s */
    const isLive = (s) => { try { return !!s.field(editorLivePreviewField, false); } catch { return false; } };
    /** @param {import('@codemirror/state').EditorState} s */
    const fileOf = (s) => { try { const i = s.field(editorInfoField, false); return i && i.file ? i.file : null; } catch { return null; } };
    /** @param {import('@codemirror/view').EditorView} view */
    const build = (view) => { if (!this.on()) return Decoration.none; try { return buildRaw(view); } catch (e) { console.error('[LifeWorld] typed bullets: drawing failed', e); return Decoration.none; } };
    /** @param {import('@codemirror/view').EditorView} view */
    const buildRaw = (view) => {
      const state = view.state;
      const file = fileOf(state);
      if (!isLive(state) || !file) return Decoration.none;
      const types = this.types();
      const doc = state.doc;
      const sel = state.selection.ranges;
      /** @param {number} a @param {number} b */
      const touched = (a, b) => sel.some((r) => r.from <= b && r.to >= a);
      /** @type {{ from: number, to: number, d: import('@codemirror/view').Decoration, line?: boolean }[]} */
      const out = [];
      const first = doc.lineAt(view.viewport.from).number; const last = doc.lineAt(view.viewport.to).number;
      let fence = '';
      for (let n = 1; n < first; n++) fence = L.fenceAfter(fence, doc.line(n).text); // shortcut: scans from the top for code fences; fine for notes of a few thousand lines
      for (let n = first; n <= last; n++) {
        const ln = doc.line(n);
        const was = fence;
        fence = L.fenceAfter(fence, ln.text);
        if (was || fence) continue;
        for (const m of linksIn(ln.text, ln.from)) {
          if (touched(m.from, m.to)) continue;
          const f = this.app.metadataCache.getFirstLinkpathDest(m.linkpath, file.path);
          const pt = f && !this.isTaskNote(f) ? this.isPerson(f) : null;
          if (f && pt) {
            const style = `--lw-bt-c: ${colorOf(pt)}`;
            out.push({ from: m.from, to: m.from, d: Decoration.widget({ widget: new Badge(L.initials(m.alias || f.basename), style), side: -1 }) });
            out.push({ from: m.from, to: m.to, d: Decoration.mark({ class: 'lw-bt-person', attributes: { 'data-path': f.path, style } }) });
          }
        }
        const t = L.tagAtEnd(ln.text);
        const type = t ? L.typeFor(types, t.tag) : null;
        if (!t || !type) continue;
        const style = `--lw-bt-c: ${colorOf(type)}`;
        out.push({ from: ln.from, to: ln.from, d: Decoration.line({ class: 'lw-bt-line', attributes: { style } }), line: true });
        const tf = ln.from + t.at, tt = ln.from + t.end;
        if (!touched(tf, tt)) out.push({ from: tf, to: tt, d: Decoration.replace({ widget: new Pill(ln.text.slice(t.at, t.end), style, tt) }) });
        if (type === L.TASK || type.where === 'folder') {
          const m = linksIn(ln.text)[0];
          const f = m ? this.app.metadataCache.getFirstLinkpathDest(m.linkpath, file.path) : null;
          if (f && (type === L.TASK ? this.isTaskNote(f) : true)) {
            const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
            out.push({ from: ln.to, to: ln.to, d: Decoration.widget({ widget: new Rows(f.path, type, JSON.stringify([f.path, nameOf(type), fm, type === L.TASK ? null : type])), side: 1 }) });
          }
          continue;
        }
        const lines = [];
        for (let k = n; k <= Math.min(doc.lines, n + 60); k++) lines.push(doc.line(k).text);
        for (const fl of L.fieldsUnder(lines, 0)) {
          const fd = type.fields.find((x) => low(x.name) === low(fl.name));
          const row = doc.line(n + fl.line);
          out.push({ from: row.from, to: row.from, d: Decoration.line({ class: 'lw-bt-fieldline' }), line: true });
          if (touched(row.from, row.to)) continue;
          out.push({ from: row.from + fl.nameAt, to: row.from + fl.valueAt, d: Decoration.replace({ widget: new Label(fl.name, row.from + fl.valueAt) }) });
          if (fd) out.push({ from: row.to, to: row.to, d: Decoration.widget({ widget: new Caret(fd, n + fl.line, !fl.value), side: 1 }) });
          else if (!fl.value) out.push({ from: row.to, to: row.to, d: Decoration.widget({ widget: new Caret({ name: fl.name, kind: 'text' }, n + fl.line, true), side: 1 }) });
        }
      }
      // RangeSetBuilder needs them in order: by place, line decorations first, then the rest as added.
      const rank = (/** @type {{ line?: boolean }} */ x) => (x.line ? 0 : 1);
      out.sort((a, b) => a.from - b.from || rank(a) - rank(b) || a.d.startSide - b.d.startSide);
      /** @type {import('@codemirror/state').RangeSetBuilder<import('@codemirror/view').Decoration>} */
      const b = new RangeSetBuilder();
      let lastLine = -1;
      for (const x of out) {
        if (x.line) { if (x.from === lastLine) continue; lastLine = x.from; }
        b.add(x.from, x.to, x.d);
      }
      return b.finish();
    };
    return Prec.high(ViewPlugin.fromClass(class {
      /** @param {import('@codemirror/view').EditorView} view */
      constructor(view) { this.view = view; views.add(view); this.decorations = build(view); }
      /** @param {import('@codemirror/view').ViewUpdate} u */
      update(u) {
        const poked = u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
        const mode = isLive(u.startState) !== isLive(u.state) || fileOf(u.startState) !== fileOf(u.state);
        if (u.docChanged || u.viewportChanged || u.selectionSet || poked || mode) this.decorations = build(u.view);
      }
      destroy() { views.delete(this.view); }
    }, { decorations: (v) => v.decorations }));
  }

  /* ---- settings rows (criterion 1, 6) ------------------------------------------------------------------- */
  /** @param {() => void} redraw @returns {Group} */
  settingsGroup(redraw) {
    const types = this.types();
    /** @param {BtType} t */
    const summary = (t) => {
      const where = t.where === 'folder' ? `Own note in ${t.folder || 'a folder you pick the first time'}` : 'Kept in the note';
      const also = t.aliases.length ? ` · also called ${t.aliases.join(', ')}` : '';
      const fields = t.fields.length ? ` · ${t.fields.map((f) => `${f.name} (${L.KIND_NAMES[f.kind]}${f.kind === 'choice' && f.options && f.options.length ? `: ${f.options.join(', ')}` : ''})`).join(', ')}` : ' · no fields yet';
      return `${where}${also}${fields}`;
    };
    /** @type {Row[]} */
    const items = [
      { name: L.TASK, desc: 'Built in. Makes a task note in your Tasks folder with the project of the note it is typed in. Days and times in the bullet ("friday", "due friday 3pm") are read the same as quick add.' },
      ...types.map((t) => /** @type {Row} */ ({ name: t.name, desc: summary(t), render: (s) => s
        .addButton((b) => b.setButtonText('Edit').onClick(() => new TypeModal(this, { edit: t, onDone: () => redraw() }).open()))
        .addExtraButton((b) => b.setIcon('trash').setTooltip(`Remove ${t.name}`).onClick(async () => {
          await this.saveTypes(this.types().filter((x) => x.name !== t.name));
          new Notice(`Removed ${t.name}. Notes keep their #${t.name} text.`);
          redraw();
        })) })),
      { name: 'Add a type', render: (s) => s.addButton((b) => b.setButtonText('Add a type').onClick(() => new TypeModal(this, { onDone: () => redraw() }).open())) },
      { name: 'Tana-style outline look', desc: "Round dots, a ring on folded bullets, and thin lines down to each bullet's children, in every note.",
        render: (s) => s.addToggle((t) => t.setValue(this.outlineOn()).onChange((v) => { this.save({ outline: v }).catch((e) => console.error('[LifeWorld] outline switch', e)); })) },
    ];
    const sw = /** @type {Row} */ ({ name: 'Typed bullets', desc: 'Give bullets a type with # (task, Person, Decision and your own), link people with @, and show live lists. Off: LifeWorld leaves your bullets as they are.',
      render: (s) => s.addToggle((t) => t.setValue(this.on()).onChange((v) => { this.save({ on: v }).then(() => redraw(), (e) => console.error('[LifeWorld] typed bullets switch', e)); })) });
    return { type: 'group', heading: 'Bullet types', items: this.on() ? [
      sw,
      { name: 'Bullet types', searchable: false, desc: 'Type # on any bullet to give it one of these types. Its fields appear under it.' },
      ...items,
    ] : [sw] };
  }
}

/* ---- the # suggest --------------------------------------------------------------------------------------- */
/** @extends {EditorSuggest<BtChoice>} */
class TagSuggest extends EditorSuggest {
  /** @param {Bullets} b */
  constructor(b) { super(b.app); this.b = b; this.limit = 20; this.taskOnly = false; }
  /** @param {import('obsidian').EditorPosition} cursor @param {import('obsidian').Editor} editor @param {TFile | null} file */
  onTrigger(cursor, editor, file) {
    if (!file || !this.b.on()) return null;
    const line = editor.getLine(cursor.line);
    const m = /(^|\s)#([\p{L}\p{N}_-]*)$/u.exec(line.slice(0, cursor.ch));
    if (!m || this.b.inFence(editor, cursor.line)) return null;
    const l = L.listLine(line);
    // Types go at a bullet's end; elsewhere only task (criterion 13), from "#tas" on, so other tags keep Obsidian's box.
    this.taskOnly = !l || cursor.ch - m[2].length - 1 < l.textAt || !!line.slice(cursor.ch).trim();
    if (this.taskOnly && (m[2].length < 3 || !L.TASK.startsWith(m[2].toLowerCase()))) return null;
    // A tag already in the vault that is no type stays with Obsidian's own tag box (#new, #real-estate).
    if (m[2] && !L.menuFor(this.b.types(), m[2]).some((c) => c.kind === 'type' && !c.near)) {
      const q = `#${m[2].toLowerCase()}`;
      const tags = this.app.metadataCache.getTags ? Object.keys(this.app.metadataCache.getTags()) : [];
      if (tags.some((t) => t.toLowerCase().startsWith(q))) return null;
    }
    return { start: { line: cursor.line, ch: cursor.ch - m[2].length - 1 }, end: cursor, query: m[2] };
  }
  /** @param {import('obsidian').EditorSuggestContext} ctx */
  getSuggestions(ctx) { return this.taskOnly ? [{ kind: 'type', type: L.TASK }] : L.menuFor(this.b.types(), ctx.query); }
  /** @param {BtChoice} c @param {HTMLElement} el */
  renderSuggestion(c, el) {
    el.addClass('lw-bt-suggest');
    if (c.kind === 'create') { el.createSpan({ cls: 'lw-bt-create', text: `Create type "${c.name}"` }); return; }
    const t = c.type;
    const pill = el.createSpan({ cls: 'lw-bt-tag', text: nameOf(t) });
    pill.style.setProperty('--lw-bt-c', colorOf(t));
    const hint = c.alias ? `also called ${c.alias}` : c.near ? 'did you mean?' : t === L.TASK ? 'makes a task' : t.fields.map((f) => f.name).join(', ');
    if (hint) el.createSpan({ cls: 'lw-bt-hint', text: hint });
  }
  /** @param {BtChoice} c */
  selectSuggestion(c) {
    const ctx = this.context;
    if (!ctx || !ctx.file) return;
    const { editor, file, start, end } = ctx;
    this.close();
    this.b.pick(editor, file, start.line, start.ch, end.ch, c).catch((e) => { console.error('[LifeWorld] # menu', e); new Notice(`That did not work. ${e instanceof Error ? e.message : ''}`.trim()); });
  }
}

/* ---- the @ menu: people (criterion 12) ------------------------------------------------------------------- */
/** @typedef {{ kind: 'person', name: string, aliases: string[], f: TFile } | { kind: 'new', name: string } | { kind: 'setup' }} AtChoice */
/** @extends {EditorSuggest<AtChoice>} */
class PersonSuggest extends EditorSuggest {
  /** @param {Bullets} b */
  constructor(b) { super(b.app); this.b = b; this.limit = 20; }
  person() { return this.b.types().find((t) => t.where === 'folder' && low(t.name) === 'person') || null; }
  /** @param {import('obsidian').EditorPosition} cursor @param {import('obsidian').Editor} editor @param {TFile | null} file */
  onTrigger(cursor, editor, file) {
    if (!file || !this.b.on() || !this.person()) return null;
    // After a space or at the line's start only, so an email address opens nothing.
    const m = /(^|\s)@([\p{L}\p{N}_.'-]*)$/u.exec(editor.getLine(cursor.line).slice(0, cursor.ch));
    return m && !this.b.inFence(editor, cursor.line) ? { start: { line: cursor.line, ch: cursor.ch - m[2].length - 1 }, end: cursor, query: m[2] } : null;
  }
  /** @param {import('obsidian').EditorSuggestContext} ctx @returns {AtChoice[]} */
  getSuggestions(ctx) {
    let t = this.person();
    if (!t) return [];
    if (!t.folder) {
      // Nothing found stays nothing found for this @: no new vault scan on every keystroke.
      const at = `${ctx.file && ctx.file.path}:${ctx.start.line}:${ctx.start.ch}`;
      const folder = this.missed === at ? '' : matchingFolder(this.app, t, this.b.types());
      if (!folder) { this.missed = at; return [{ kind: 'setup' }]; }
      // Saved at once in memory, so the next keystroke finds it set and this runs only once.
      this.b.setFolder(t, folder).catch((e) => console.error('[LifeWorld] @ menu', e));
      t = { ...t, folder };
    }
    const people = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(`${t.folder}/`))
      .map((f) => /** @type {AtChoice} */ ({ kind: 'person', name: f.basename, aliases: this.b.aliasesOf(f), f }));
    const hits = L.peopleFor(/** @type {{ kind: 'person', name: string, aliases: string[], f: TFile }[]} */ (people), ctx.query);
    const name = ctx.query.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
    return hits.length || !name ? hits : [{ kind: 'new', name }];
  }
  /** @param {AtChoice} c @param {HTMLElement} el */
  renderSuggestion(c, el) {
    el.addClass('lw-bt-suggest');
    if (c.kind === 'setup') { el.createSpan({ cls: 'lw-bt-create', text: 'Choose where people\'s notes are' }); return; }
    if (c.kind === 'new') { el.createSpan({ cls: 'lw-bt-create', text: `Add ${c.name} as a new person` }); return; }
    const pill = el.createSpan({ cls: 'lw-bt-person' });
    const t = this.person();
    if (t) pill.style.setProperty('--lw-bt-c', colorOf(t));
    pill.createSpan({ cls: 'lw-bt-badge', text: L.initials(c.name) });
    pill.appendText(c.name);
    const q = low(this.context ? this.context.query : '');
    const alias = q && !low(c.name).includes(q) ? c.aliases.find((a) => low(a).includes(q)) : '';
    if (alias) el.createSpan({ cls: 'lw-bt-hint', text: `also called ${alias}` });
  }
  /** @param {AtChoice} c */
  selectSuggestion(c) {
    const ctx = this.context;
    if (!ctx || !ctx.file) return;
    const { editor, file, start, end } = ctx;
    this.close();
    const t = this.person();
    if (!t) return;
    const put = (/** @type {TFile} */ f) => {
      const text = `[[${this.app.metadataCache.fileToLinktext(f, file.path, true)}]]`;
      // Only if the @word is still there (a box may have been open meanwhile).
      if (editor.getRange(start, end) !== `@${ctx.query}`) { new Notice(`${f.basename} was not linked: the line changed meanwhile.`); return; }
      editor.transaction({ changes: [{ from: start, to: end, text }], selection: { from: { line: start.line, ch: start.ch + text.length } } });
    };
    if (c.kind === 'person') { put(c.f); return; }
    if (c.kind === 'setup') {
      askFolder(this.app, t, 'Where are people\'s notes?', this.b.types()).then((folder) => folder && this.b.setFolder(t, folder)).catch((e) => console.error('[LifeWorld] @ menu', e));
      return;
    }
    // A box first, so Enter after "@noon" never makes a note by itself, and the full name can be typed.
    new TextModal(this.app, 'Add a new person', c.name, (v) => {
      const name = v.replace(/[\\/:*?"<>|#^[\]]/g, '').trim();
      if (!name) return;
      this.b.ownNote(t, name).then((own) => {
        if (!own) return;
        put(own.f);
        if (own.made) new Notice(`Made ${own.f.basename} in ${own.folder}.`);
      }).catch((e) => { console.error('[LifeWorld] @ menu', e); new Notice(`That did not work. ${e instanceof Error ? e.message : ''}`.trim()); });
    }, undefined, 'Full name').open();
  }
}

/* ---- the type box: settings Edit / Add, and "Create type" on the spot (criterion 1, 10) ----------------- */
class TypeModal extends Modal {
  /** @param {Bullets} b @param {{ edit?: BtType, name?: string, onDone: (t: BtType, useInstead?: BtType) => unknown }} o */
  constructor(b, o) {
    super(b.app);
    this.b = b; this.o = o;
    const e = o.edit;
    /** @type {BtType} */
    this.t = e ? structuredClone(e) : { name: o.name || '', color: L.COLORS[b.types().length % L.COLORS.length], aliases: [], fields: [], where: 'note' };
  }
  onOpen() { this.draw(); }
  draw() {
    const el = this.contentEl;
    el.empty();
    el.addClass('lw-bt-modal');
    const t = this.t;
    const spot = !this.o.edit && !!this.o.name;
    this.setTitle(this.o.edit ? `Edit ${this.o.edit.name}` : spot ? `New type: ${t.name}` : 'New type');
    if (!spot) new Setting(el).setName('Name').addText((x) => x.setValue(t.name).setPlaceholder('Decision').onChange((v) => { t.name = v.trim().replace(/^#/, ''); }));
    new Setting(el).setName('Color').addDropdown((d) => { for (const c of L.COLORS) d.addOption(c, c[0].toUpperCase() + c.slice(1)); d.setValue(t.color).onChange((v) => { t.color = v; }); });
    new Setting(el).setName('Other names').setDesc('Tags that mean this type, comma between them.').addText((x) => x.setValue(t.aliases.join(', ')).setPlaceholder('Beach, spot').onChange((v) => { t.aliases = v.split(',').map((a) => a.trim().replace(/^#/, '')).filter(Boolean); }));
    new Setting(el).setName('Where it lives').addDropdown((d) => d.addOption('note', 'Kept in the note').addOption('folder', 'Make a note in a folder').setValue(t.where).onChange((v) => {
      t.where = v === 'folder' ? 'folder' : 'note';
      if (t.where === 'folder' && !t.folder) t.folder = matchingFolder(this.app, t, this.b.types()) || '';
      if (t.where === 'folder' && !t.props) t.props = { type: low(t.name) };
      this.draw();
    }));
    if (t.where === 'folder') {
      new Setting(el).setName('Folder').setDesc(t.folder && !(this.app.vault.getAbstractFileByPath(t.folder) instanceof TFolder) ? 'New folder: made the first time it is used.' : '')
        .addText((x) => x.setValue(t.folder || '').setPlaceholder('Contacts/people').onChange((v) => { t.folder = v.trim().replace(/^\/+|\/+$/g, ''); }))
        .addButton((b) => b.setButtonText('Pick').onClick(() => new FolderPick(this.app, (p) => { t.folder = p; this.draw(); }).open()));
      new Setting(el).setName('Every new note gets').setDesc('Properties, one per line, like "type: person".').addTextArea((x) => x
        .setValue(Object.entries(t.props || {}).map(([k, v]) => `${k}: ${v}`).join('\n'))
        .onChange((v) => { t.props = Object.fromEntries(v.split('\n').map((l) => /^([^:]+):\s*(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [/** @type {RegExpExecArray} */ (m)[1].trim(), /** @type {RegExpExecArray} */ (m)[2].trim()])); }));
      const owner = t.folder ? L.folderOwner(this.b.types(), t.folder, this.o.edit ? this.o.edit.name : t.name) : null;
      if (owner) {
        const w = el.createDiv({ cls: 'lw-bt-warn', text: `${owner.name} already makes notes in ${owner.folder}. ${spot ? `Use ${owner.name} instead?` : ''}` });
        if (spot) w.createEl('button', { cls: 'mod-cta', text: `Use ${owner.name}` }).addEventListener('click', () => { this.close(); this.o.onDone(owner, owner); });
      }
    }
    el.createEl('h4', { text: 'Fields' });
    if (!t.fields.length) el.createDiv({ cls: 'setting-item-description', text: 'No fields yet. You can add them now or later in Settings › LifeWorld › Bullet types.' });
    t.fields.forEach((f, i) => {
      const s = new Setting(el).addText((x) => x.setValue(f.name).setPlaceholder('Field name').onChange((v) => { f.name = v; }))
        .addDropdown((d) => { for (const k of L.KINDS) d.addOption(k, L.KIND_NAMES[k]); d.setValue(f.kind).onChange((v) => { f.kind = /** @type {BtField['kind']} */ (v); this.draw(); }); });
      if (f.kind === 'choice') s.addText((x) => x.setValue((f.options || []).join(', ')).setPlaceholder('Options, comma between').onChange((v) => { f.options = v.split(',').map((o) => o.trim()).filter(Boolean); }));
      s.addExtraButton((b) => b.setIcon('trash').setTooltip('Remove field').onClick(() => { t.fields.splice(i, 1); this.draw(); }));
    });
    new Setting(el).addButton((b) => b.setButtonText('Add a field').onClick(() => { t.fields.push({ name: '', kind: 'text' }); this.draw(); }));
    const msg = el.createDiv({ cls: 'lw-bt-warn' });
    new Setting(el)
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.o.edit ? 'Save' : 'Make the type').setCta().onClick(async () => {
        const name = L.tagName(t.name);
        const others = this.b.types().filter((x) => !this.o.edit || x.name !== this.o.edit.name);
        const clash = name ? L.typeFor(others, name) : null;
        if (!name) { msg.setText('The name can hold letters, numbers, - and _ only.'); return; }
        if (clash) { msg.setText(`${clash === L.TASK ? 'task' : clash.name} already uses that name.`); return; }
        if (t.where === 'folder' && !t.folder) { msg.setText('Pick the folder its notes go in.'); return; }
        const clean = L.cleanTypes([{ ...t, name }])[0];
        const list = this.o.edit ? this.b.types().map((x) => (x.name === /** @type {BtType} */ (this.o.edit).name ? clean : x)) : [...this.b.types(), clean];
        await this.b.saveTypes(list);
        this.close();
        this.o.onDone(clean);
      }));
  }
  onClose() { this.contentEl.empty(); }
}

// A folder whose name matches the type or one of its other names (Places for place), for the box's first guess.
/** @param {import('obsidian').App} app @param {BtType} t */
// Not a folder another type already owns (criterion 10.3).
/** @param {import('obsidian').App} app @param {BtType} t @param {BtType[]} types */
function matchingFolder(app, t, types) {
  const f = L.guessFolder(t, app.vault.getMarkdownFiles().map((x) => ({ path: x.path, fm: app.metadataCache.getFileCache(x)?.frontmatter })));
  return f && !L.folderOwner(types, f, t.name) ? f : '';
}
// The first use of an own-note type with no folder yet: asks once (criterion 1), suggesting a matching folder.
/** @param {import('obsidian').App} app @param {BtType} type @param {string} title @param {BtType[]} types @returns {Promise<string>} */
function askFolder(app, type, title, types) {
  return new Promise((res) => new TextModal(app, title, matchingFolder(app, type, types), (v) => res(v.trim().replace(/^\/+|\/+$/g, '')), () => res(''), 'Folder, for example Contacts/People').open());
}

/** @extends {FuzzySuggestModal<TFolder>} */
class FolderPick extends FuzzySuggestModal {
  /** @param {import('obsidian').App} app @param {(path: string) => unknown} done */
  constructor(app, done) { super(app); this.done = done; this.setPlaceholder('Pick a folder'); }
  getItems() { return /** @type {TFolder[]} */ (this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== '/' && !f.path.startsWith('.'))); }
  /** @param {TFolder} f */
  getItemText(f) { return f.path; }
  /** @param {TFolder} f */
  onChooseItem(f) { this.done(f.path); }
}
/** @extends {FuzzySuggestModal<TFile>} */
class NotePickModal extends FuzzySuggestModal {
  /** @param {import('obsidian').App} app @param {(f: TFile) => unknown} done */
  constructor(app, done) { super(app); this.done = done; this.setPlaceholder('Pick a note'); }
  getItems() { return this.app.vault.getMarkdownFiles(); }
  /** @param {TFile} f */
  getItemText(f) { return f.path.replace(/\.md$/i, ''); }
  /** @param {TFile} f */
  onChooseItem(f) { this.done(f); }
}
class DateModal extends Modal {
  /** @param {import('obsidian').App} app @param {string} name @param {(v: string | null) => unknown} done */
  constructor(app, name, done) { super(app); this.name = name; this.done = done; }
  onOpen() {
    this.setTitle(this.name);
    const input = this.contentEl.createEl('input', { type: 'date', cls: 'lw-bt-date' });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText('Clear').onClick(() => { this.close(); this.done(null); }))
      .addButton((b) => b.setButtonText('Set').setCta().onClick(() => { if (!input.value) return; this.close(); this.done(input.value); }));
    input.focus();
  }
  onClose() { this.contentEl.empty(); }
}
class TextModal extends Modal {
  /** @param {import('obsidian').App} app @param {string} title @param {string} value @param {(v: string) => unknown} done @param {() => unknown} [cancel] @param {string} [placeholder] */
  constructor(app, title, value, done, cancel, placeholder) { super(app); this.title = title; this.value = value; this.done = done; this.cancel = cancel; this.placeholder = placeholder || ''; this.ok = false; }
  onOpen() {
    this.setTitle(this.title);
    /** @type {import('obsidian').TextComponent | null} */
    let box = null;
    const s = new Setting(this.contentEl).addText((x) => { box = x; x.setValue(this.value).setPlaceholder(this.placeholder); x.inputEl.addClass('lw-bt-wide'); x.inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.finish(x.getValue()); } }); });
    if (this.placeholder.startsWith('Folder')) s.addButton((b) => b.setButtonText('Pick').onClick(() => new FolderPick(this.app, (p) => { if (box) box.setValue(p); }).open()));
    new Setting(this.contentEl).addButton((b) => b.setButtonText('OK').setCta().onClick(() => { if (box) this.finish(box.getValue()); }));
    if (box) /** @type {import('obsidian').TextComponent} */ (box).inputEl.focus();
  }
  /** @param {string} v */
  finish(v) { this.ok = true; this.close(); this.done(v); }
  onClose() { this.contentEl.empty(); if (!this.ok && this.cancel) this.cancel(); }
}

/* ---- the live list block (criterion 5) ----------------------------------------------------------------------- */
class LiveList extends MarkdownRenderChild {
  /** @param {Bullets} b @param {string} src @param {HTMLElement} el @param {string} sourcePath */
  constructor(b, src, el, sourcePath) {
    super(el);
    this.b = b; this.src = src; this.sourcePath = sourcePath;
    /** @type {Set<string>} */
    this.paths = new Set();
    /** @type {number | null} */
    this.timer = null;
    this.run = 0;
  }
  onload() { this.b.lists.add(this); this.drawSafe(); }
  drawSafe() { this.draw().catch((e) => { console.error('[LifeWorld] live list', e); this.containerEl.empty(); this.containerEl.createDiv({ cls: 'lw-bt-error', text: 'This list could not be drawn. Details are in the developer console.' }); }); }
  onunload() { this.b.lists.delete(this); if (this.timer) window.clearTimeout(this.timer); }
  /** @param {TFile} f */
  noteChanged(f) {
    if (this.paths.has(f.path) || f.path === this.sourcePath) { this.drawSoon(); return; }
    const q = L.parseQuery(this.src, this.b.types());
    if ('error' in q) return;
    const tags = ((this.b.app.metadataCache.getFileCache(f) || {}).tags || []).map((t) => low(t.tag.slice(1)));
    if ([q.type.name, ...q.type.aliases].some((n) => tags.includes(low(n))) || (q.type.where === 'folder' && f.path.startsWith(`${q.type.folder}/`))) this.drawSoon();
  }
  drawSoon() { if (this.timer) window.clearTimeout(this.timer); this.timer = window.setTimeout(() => { this.timer = null; this.drawSafe(); }, 1500); }
  async draw() {
    const run = ++this.run;
    const app = this.b.app;
    const q = L.parseQuery(this.src, this.b.types());
    const el = this.containerEl;
    if (!this.b.on()) { el.empty(); el.createDiv({ cls: 'lw-bt-error', text: 'Typed bullets are off. Turn them on in LifeWorld settings to see this list.' }); return; }
    if ('error' in q) { el.empty(); el.createDiv({ cls: 'lw-bt-error', text: q.error }); return; }
    const mc = app.metadataCache;
    const names = [q.type.name, ...q.type.aliases].map(low);
    /** @type {{ text: string, note: string, path: string, line: number, fields: Record<string, string> }[]} */
    let rows = [];
    const files = app.vault.getMarkdownFiles().filter((f) => ((mc.getFileCache(f) || {}).tags || []).some((t) => names.includes(low(t.tag.slice(1)))) && (!q.project || this.inProject(f)));
    const texts = await Promise.all(files.map((f) => app.vault.cachedRead(f)));
    /** @type {Set<string>} */
    const paths = new Set(files.map((f) => f.path));
    for (const [i, f] of files.entries()) {
      const text = texts[i];
      for (const r of L.bulletsIn(text, q.type)) {
        let fields = r.fields;
        let shown = r.text;
        if (q.type.where === 'folder') {
          const m = linksIn(r.text)[0];
          const dest = m ? mc.getFirstLinkpathDest(m.linkpath, f.path) : null;
          const fm = /** @type {Fm} */ (dest ? (mc.getFileCache(dest) || {}).frontmatter || {} : {});
          fields = Object.fromEntries(q.type.fields.map((fd) => { const v = fm[L.propKey(fd.name)]; return [low(fd.name), v == null ? '' : Array.isArray(v) ? v.join(', ') : String(v)]; }));
          if (dest) paths.add(dest.path);
        }
        shown = L.plain(shown);
        rows.push({ text: shown, note: f.basename, path: f.path, line: r.line, fields });
      }
    }
    if (run !== this.run) return; // a newer draw started meanwhile
    this.paths = paths;
    rows = L.sortRows(rows.filter((r) => L.rowMatches(r, q.where)), q.sort);
    el.empty();
    const box = el.createDiv({ cls: 'lw-bt-list' });
    const head = box.createDiv({ cls: 'lw-bt-list-head' });
    const pill = head.createSpan({ cls: 'lw-bt-tag', text: q.type.name });
    pill.style.setProperty('--lw-bt-c', colorOf(q.type));
    const bits = [...q.where.map((w) => `${w.field} is ${w.not ? 'not ' : ''}${w.value}`), ...(q.project ? ['this project'] : [])];
    if (bits.length) head.createSpan({ cls: 'lw-bt-hint', text: bits.join(' · ') });
    head.createSpan({ cls: 'lw-bt-count', text: `${rows.length} bullet${rows.length === 1 ? '' : 's'}` });
    if (!rows.length) { box.createDiv({ cls: 'lw-bt-hint lw-bt-none', text: 'No bullets match yet.' }); return; }
    const wrap = box.createDiv({ cls: 'lw-bt-scroll' });
    const table = wrap.createEl('table');
    const hr = table.createEl('thead').createEl('tr');
    for (const h of ['Bullet', ...q.type.fields.map((f) => f.name), 'Note']) hr.createEl('th', { text: h });
    const body = table.createEl('tbody');
    for (const r of rows) {
      const tr = body.createEl('tr', { cls: 'lw-bt-list-row' });
      tr.createEl('td', { text: r.text });
      for (const fd of q.type.fields) { const v = L.plain(r.fields[low(fd.name)] || ''); tr.createEl('td', { cls: v ? '' : 'is-empty', text: v || 'Empty' }); }
      tr.createEl('td', { cls: 'lw-bt-note', text: r.note });
      tr.addEventListener('click', (e) => {
        const f = app.vault.getAbstractFileByPath(r.path);
        if (f instanceof TFile) app.workspace.getLeaf(Keymap.isModEvent(e)).openFile(f, { eState: { line: r.line } }).catch((err) => console.error('[LifeWorld] open bullet', err));
      });
    }
  }
  // "project: this one": the note is this one, or names it in its project / projects property.
  /** @param {TFile} f */
  inProject(f) {
    if (f.path === this.sourcePath) return true;
    const pj = this.b.projects();
    return !!pj && typeof pj.textTaskProjectFacts === 'function' && pj.textTaskProjectFacts(f).facts.fmPaths.includes(this.sourcePath);
  }
}

/** @typedef {typeof import('@codemirror/state') & typeof import('@codemirror/view')} CM */
export { Bullets };
