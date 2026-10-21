// Where tasks live, besides LifeWorld's own task notes and TaskNotes (launch sections 5 and 5b):
// checkbox lines in any note (with the Tasks plugin's signs), Todoist, ClickUp and, on a Mac, Things 3.
// One source at a time (decision B). Each source gives the same task items Today and the Planner
// already draw (src/core/tasks.js taskFromFrontmatter's shape), with an `ext` part saying where it
// lives, and does the writes: tick, place on a day, add.
//
// Pure parts first (parsing and building items, unit-tested), then the sources, which need Obsidian.
// Pasted keys are read only through keyOf() and kept only in Obsidian's per-vault local storage on this
// device (app.saveLocalStorage): never in data.json, a note or the console (criterion 29).
'use strict';

import { requestUrl, Platform, TFile, moment } from 'obsidian';
import { toDayStr, dayOf, halfOfTime } from './dates';
import { planning } from './vault';
import { wikilinkTarget } from './tasks';
import { insertUnderHeading, writeDailyNote } from './daily';

/* ---- checkbox lines and the Tasks plugin's signs (Tasks Emoji Format, read 2026-10-19) ---------- */

const CHECKBOX_RE = /^(\s*(?:>\s*)*)([-*+]|\d+[.)])\s+\[(.)\]\s+(.*)\r?$/; // \r: notes saved with Windows line endings
const VS = '\uFE0F?'; // emoji variation selector, which some keyboards add
const DATE_SIGNS = { due: '📅', scheduled: '⏳', start: '🛫', created: '➕', done: '✅', cancelled: '❌' };
const PRIORITY_SIGNS = [['🔺', 'highest'], ['⏫', 'high'], ['🔼', 'medium'], ['🔽', 'low'], ['⏬', 'lowest']];
// Every sign Tasks reads, for cutting the description short of them.
const ALL_SIGNS = ['📅', '📆', '🗓', '⏳', '⌛', '🛫', '➕', '✅', '❌', '🔁', '🆔', '⛔', '🏁', '🔺', '⏫', '🔼', '🔽', '⏬'];
const signRe = (sign) => new RegExp(`${sign}${VS}\\s*(\\d{4}-\\d{2}-\\d{2})`, 'u');

// One checkbox line -> { prefix, bullet, mark, open, body, title, due, scheduled, start, created, done,
// cancelled, priority, repeat, blockId } or null when it is not a checkbox with words in it.
// open: ' ' (to do) and '/' (in progress); any other mark is finished, as in Obsidian and Tasks.
function parseCheckbox(line) {
  const m = CHECKBOX_RE.exec(String(line == null ? '' : line));
  if (!m) return null;
  const body = m[4];
  const out = { prefix: m[1], bullet: m[2], mark: m[3], open: m[3] === ' ' || m[3] === '/', body };
  for (const [k, sign] of Object.entries(DATE_SIGNS)) { const d = signRe(sign).exec(body); out[k] = d ? d[1] : null; }
  if (!out.due) { const d = /[📆🗓]\uFE0F?\s*(\d{4}-\d{2}-\d{2})/u.exec(body); if (d) out.due = d[1]; }
  if (!out.scheduled) { const d = /⌛\uFE0F?\s*(\d{4}-\d{2}-\d{2})/u.exec(body); if (d) out.scheduled = d[1]; }
  const p = PRIORITY_SIGNS.find(([s]) => body.includes(s));
  out.priority = p ? p[1] : '';
  const r = new RegExp(`🔁${VS}\\s*([^${ALL_SIGNS.join('')}^]*)`, 'u').exec(body);
  out.repeat = r ? r[1].trim() : '';
  const b = /\s\^([A-Za-z0-9-]+)\s*$/.exec(body);
  out.blockId = b ? b[1] : '';
  if (out.cancelled) out.open = false;
  // The words: up to the first sign, block id cut off.
  let cut = body.length;
  for (const s of ALL_SIGNS) { const i = body.indexOf(s); if (i >= 0 && i < cut) cut = i; }
  out.title = body.slice(0, cut).replace(/\s\^[A-Za-z0-9-]+\s*$/, '').trim();
  if (!out.title) return null;
  return out;
}

// The line with one date sign set to `day` (or taken off when day is null). A new sign goes before the
// block id, if any, at the end.
function setDateSign(line, key, day) {
  if (String(line).endsWith('\r')) return `${setDateSign(String(line).slice(0, -1), key, day)}\r`; // a Windows line ending stays
  const sign = DATE_SIGNS[key];
  const re = new RegExp(`\\s*${sign}${VS}\\s*\\d{4}-\\d{2}-\\d{2}`, 'u');
  let s = String(line);
  if (re.test(s)) return day ? s.replace(new RegExp(`${sign}${VS}\\s*\\d{4}-\\d{2}-\\d{2}`, 'u'), `${sign} ${day}`) : s.replace(re, '');
  if (!day) return s;
  const b = /(\s\^[A-Za-z0-9-]+)\s*$/.exec(s);
  return b ? `${s.slice(0, b.index)} ${sign} ${day}${b[1]}` : `${s.replace(/\s+$/, '')} ${sign} ${day}`;
}

// A tick without the Tasks plugin: [ ] -> [x] with ✅ today; [x] -> [ ] without the ✅ date. A repeat
// is not rolled forward (the stated limit in Settings).
function toggleCheckboxLine(line, today) {
  const p = parseCheckbox(line);
  if (!p) return line;
  const at = p.prefix.length + p.bullet.length;
  const head = line.slice(0, at);
  const rest = line.slice(at).replace(/^(\s+)\[.\]/, p.open ? '$1[x]' : '$1[ ]');
  return p.open ? setDateSign(head + rest, 'done', today) : setDateSign(head + rest, 'done', null);
}

// A tag as typed in Settings ("#task", "task") -> "#task", or '' for none.
function cleanTag(raw) { const t = String(raw == null ? '' : raw).trim().replace(/^#+/, ''); return t && /^[^\s#]+$/u.test(t) ? `#${t}` : ''; }
function hasTag(body, tag) {
  if (!tag) return true;
  const esc = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${esc}(?=$|[\\s,.;:!?)])`, 'iu').test(body);
}

// A new checkbox task's line (decision C). day: its day or null; plan: "just plan it" writes ⏳.
function newCheckboxLine({ title, day, project, tag, plan }) {
  let s = `- [ ] ${String(title).replace(/\s+/g, ' ').trim()}`;
  if (project) s += ` [[${project}]]`;
  if (tag) s += ` ${tag}`;
  if (day) s += ` ${plan ? '⏳' : '📅'} ${day}`;
  return s;
}

/* ---- items --------------------------------------------------------------------------------- */

// The task item Today and the Planner draw, for a task from a source. due / scheduled: 'YYYY-MM-DD',
// or with a clock time 'YYYY-MM-DDTHH:MM' (due only). "Set its due date": due places it;
// "Just plan it": a scheduled day away from Due places it (as task notes, criterion 23).
function extItem({ source, id, title, due, scheduled, done, priority, project, projectKey, repeats, url, extra }) {
  const dueDay = toDayStr(due ? String(due).slice(0, 10) : null);
  const sched = toDayStr(scheduled ? String(scheduled).slice(0, 10) : null);
  const t = /T(\d{2}):(\d{2})/.exec(String(due || ''));
  const time = t ? `${t[1]}:${t[2]}` : null;
  const plannedAway = !planning.setsDue && !!sched && sched !== dueDay;
  return {
    path: `${source}:${id}`,
    title: String(title || '(untitled)'),
    status: done ? 'done' : 'open',
    priority: priority || '',
    due: dueDay,
    plannedDay: plannedAway ? sched : (dueDay || sched),
    plannedHalf: time && !plannedAway ? halfOfTime(time) : null,
    plannedOrder: 0,
    time: plannedAway ? null : time,
    reminder: null,
    project: project || null,
    projectKey: projectKey || project || null,
    projectLink: project ? `[[${project}]]` : null,
    recurrenceRaw: null,
    recurrence: null,
    completeInstances: [],
    skippedInstances: [],
    blockedBy: [],
    repeats: !!repeats,
    ext: { source, id, url: url || null, ...(extra || {}) },
  };
}

const isExtPath = (p) => /^(checkbox|todoist|clickup|things):/.test(String(p || ''));

// A local wall-clock 'YYYY-MM-DDTHH:MM' from an instant (ms or ISO with a zone).
function localStamp(v) { const d = new Date(v); return Number.isFinite(d.getTime()) ? `${dayOf(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null; }

// Todoist (API v1, read 2026-10-19): due.date is 'YYYY-MM-DD', a floating 'YYYY-MM-DDTHH:MM:SS', or a
// fixed-zone time ending in Z. priority 4 is urgent, 1 is normal (the docs' words); the app's p1 and p2 are 4 and 3.
function fromTodoist(t) {
  const d = t && t.due && t.due.date ? String(t.due.date) : '';
  const due = /Z$|[+-]\d\d:?\d\d$/.test(d) ? localStamp(d) : (d.length > 10 ? d.slice(0, 16) : d);
  return extItem({ source: 'todoist', id: String(t.id), title: t.content, due, done: !!(t.checked || t.completed_at), priority: { 4: 'high', 3: 'high' }[t.priority] || '', repeats: !!(t.due && t.due.is_recurring), url: `https://app.todoist.com/app/task/${encodeURIComponent(t.id)}`, extra: { recurring: !!(t.due && t.due.is_recurring) } });
}

// ClickUp (API v2, read 2026-10-19): due_date is Unix ms as text; due_date_time says whether the time counts.
function fromClickUp(t) {
  const ms = Number(t && t.due_date);
  const due = Number.isFinite(ms) && ms > 0 ? (t.due_date_time ? localStamp(ms) : dayOf(new Date(ms))) : null;
  const st = t && t.status ? t.status : {};
  return extItem({ source: 'clickup', id: String(t.id), title: t.name, due, done: st.type === 'closed' || st.type === 'done', priority: t.priority && /^(urgent|high)$/i.test(t.priority.priority) ? 'high' : '', url: t.url || null, extra: { list: t.list ? String(t.list.id) : null } });
}

// Things 3 (its AppleScript, read 2026-10-19): fields as the script below prints them.
function fromThings(r) {
  return extItem({ source: 'things', id: r.id, title: r.name, due: r.deadline || null, scheduled: r.start || null, done: r.status === 'completed' || r.status === 'canceled', project: r.project || null, url: `things:///show?id=${encodeURIComponent(r.id)}` });
}

/* ---- the sources ---------------------------------------------------------------------------- */

const SOURCE_NAMES = { checkbox: 'Checkboxes', todoist: 'Todoist', clickup: 'ClickUp', things: 'Things' };
const KEY_PREFIX = 'lifeworld-key-';
const STALE_MS = 5 * 60 * 1000;

// The one place a pasted key is read; '' when none.
function keyOf(app, name) {
  try { const v = app && typeof app.loadLocalStorage === 'function' ? app.loadLocalStorage(KEY_PREFIX + name) : null; return typeof v === 'string' ? v.trim() : ''; } catch { return ''; }
}
function setKey(app, name, value) { if (app && typeof app.saveLocalStorage === 'function') app.saveLocalStorage(KEY_PREFIX + name, value && String(value).trim() ? String(value).trim() : null); }

class Source {
  constructor(plugin, id) { this.plugin = plugin; this.app = plugin.app; this.id = id; this.list = []; this.error = ''; this.fetched = 0; this.loading = null; }
  name() { return SOURCE_NAMES[this.id]; }
  changed() { this.app.workspace.trigger('lifeworld:tasks'); }
  items() { if (!this.loading && Date.now() - this.fetched > STALE_MS) this.refresh(); return this.list; }
  status() { return { error: this.error, loading: !!this.loading }; }
  // Fetches again; one at a time. A failure keeps the last list and sets a short plain message.
  refresh() {
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try { this.list = await this.fetch(); this.error = ''; } catch (e) { this.error = this.message(e); console.warn(`LifeWorld: ${this.name()} tasks could not be read (${e && e.status ? `status ${e.status}` : 'no answer'})`); }
      this.fetched = Date.now(); this.loading = null; this.changed();
    })();
    return this.loading;
  }
  message(e) {
    const s = e && e.status;
    if (e && e.plain) return e.plain;
    if (s === 401 || s === 403) return `${this.name()} did not accept your key. Paste it again in Settings › LifeWorld › Tasks.`;
    if (s === 429) return `${this.name()} asked LifeWorld to slow down. Your tasks come back in a minute.`;
    if (s) return `${this.name()} answered with an error (${s}). Nothing was changed.`;
    return `Could not reach ${this.name()}. Check the internet connection; nothing was lost.`;
  }
  // After a write: the list again, so the page shows what the app now holds. A fetch already running started
  // before the write, so it is waited out first. batch: the caller reloads once after many writes.
  async reload() { if (this.batch) return; if (this.loading) await this.loading; this.fetched = 0; await this.refresh(); }
  stop() {}
}

// Checkbox lines anywhere in the vault (criterion 18): Obsidian's own list index finds the notes that have
// them; each note is parsed when it changes. Finds a task's project: the project note it sits in, or a
// project note it links to (criterion 24).
class CheckboxSource extends Source {
  constructor(plugin) {
    super(plugin, 'checkbox');
    this.byFile = new Map();
    this.ready = false;
    const mc = this.app.metadataCache;
    this.refs = [
      mc.on('changed', (file, data) => { if (this.ready && file instanceof TFile) { this.index(file, data); this.changed(); } }),
      this.app.vault.on('delete', (f) => { if (this.byFile.delete(f.path)) this.changed(); }),
      this.app.vault.on('rename', (f, old) => { if (this.byFile.delete(old) && f instanceof TFile) this.app.vault.cachedRead(f).then((t) => { this.index(f, t); this.changed(); }); }),
    ];
    this.app.workspace.onLayoutReady(() => this.build());
  }
  stop() { for (const r of this.refs) { this.app.metadataCache.offref(r); this.app.vault.offref(r); } }
  skip(path) {
    const ip = this.app.internalPlugins;
    const tpl = ip && ip.getEnabledPluginById ? ip.getEnabledPluginById('templates') : null;
    const folder = tpl && tpl.options && tpl.options.folder ? String(tpl.options.folder).replace(/\/$/, '') : '';
    return !!folder && path.startsWith(`${folder}/`); // template notes hold empty checkboxes, not tasks
  }
  async build() {
    const files = this.app.vault.getMarkdownFiles().filter((f) => { const c = this.app.metadataCache.getFileCache(f); return c && c.listItems && c.listItems.some((li) => li.task !== undefined); });
    for (const f of files) { try { this.index(f, await this.app.vault.cachedRead(f)); } catch { /* gone meanwhile */ } }
    this.ready = true; this.fetched = Date.now(); this.changed();
  }
  index(file, text) {
    if (file.extension !== 'md' || this.skip(file.path)) { this.byFile.delete(file.path); return; }
    const out = [];
    String(text).split('\n').forEach((line, i) => { const p = parseCheckbox(line); if (p) out.push({ line: i, text: line, p }); });
    if (out.length) this.byFile.set(file.path, out); else this.byFile.delete(file.path);
  }
  async fetch() { return this.list; }
  refresh() { return Promise.resolve(); }
  items() {
    const tag = cleanTag(this.plugin.settings.cbTag);
    const projects = this.plugin.projectNoteKeys ? this.plugin.projectNoteKeys() : new Map(); // path -> key
    const out = [];
    for (const [path, rows] of this.byFile) {
      const here = projects.get(path) || null;
      for (const r of rows) {
        if (!hasTag(r.p.body, tag)) continue;
        let key = here; let keyLink = null;
        if (!key) for (const m of r.p.body.matchAll(/\[\[([^\]]+)\]\]/g)) { const f = this.app.metadataCache.getFirstLinkpathDest(wikilinkTarget(`[[${m[1]}]]`).split('#')[0], path); if (f && projects.get(f.path)) { key = projects.get(f.path); keyLink = m[0]; break; } }
        // Shown as plain words: the link naming its project goes (the project chip shows it), other links
        // and [text](url) read as their names, the filter tag goes.
        let title = (keyLink ? r.p.title.split(keyLink).join(' ') : r.p.title)
          .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, (x, t) => t.split('#')[0].split('/').pop()).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
        if (tag) title = title.replace(new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\s)`, 'giu'), ' ');
        title = title.replace(/\s+/g, ' ').trim();
        const it = extItem({ source: 'checkbox', id: `${path}:${r.line}`, title: title || r.p.title, due: r.p.due, scheduled: r.p.scheduled, done: !r.p.open, priority: r.p.priority, project: key, repeats: !!r.p.repeat, extra: { file: path, line: r.line, text: r.text, start: r.p.start, doneDay: r.p.done || r.p.cancelled, created: r.p.created } });
        out.push(it);
      }
    }
    return out;
  }
  // The line as it is now: by its number when unchanged, else the same text anywhere in the note.
  async editLine(item, fn) {
    const file = this.app.vault.getAbstractFileByPath(item.ext.file);
    if (!(file instanceof TFile)) throw Object.assign(new Error('gone'), { plain: 'That note is gone.' });
    let done = false;
    await this.app.vault.process(file, (text) => {
      const lines = text.split('\n');
      let i = lines[item.ext.line] === item.ext.text ? item.ext.line : lines.indexOf(item.ext.text);
      if (i < 0) return text;
      const next = fn(lines[i]);
      if (next == null || next === lines[i]) return text;
      lines.splice(i, 1, ...String(next).split('\n'));
      done = true;
      return lines.join('\n');
    });
    if (!done) throw Object.assign(new Error('changed'), { plain: 'That line changed since the page was drawn. Try again.' });
  }
  // Tasks plugin on: its own toggle, so a repeat makes its next copy (criterion 20).
  tasksApi() { const p = this.app.plugins && this.app.plugins.plugins && this.app.plugins.plugins['obsidian-tasks-plugin']; const a = p && p.apiV1; return a && typeof a.executeToggleTaskDoneCommand === 'function' ? a : null; }
  async toggle(item, day) {
    const api = this.tasksApi();
    await this.editLine(item, (line) => (api ? api.executeToggleTaskDoneCommand(line, item.ext.file) : toggleCheckboxLine(line, day || dayOf(new Date()))));
    return item.status !== 'done';
  }
  async place(item, day) { await this.editLine(item, (line) => setDateSign(line, planning.setsDue ? 'due' : 'scheduled', day)); }
  async create({ title, day, project }) {
    const line = newCheckboxLine({ title, day, project, tag: cleanTag(this.plugin.settings.cbTag), plan: !planning.setsDue });
    const when = day ? moment(day, 'YYYY-MM-DD').toDate() : new Date();
    return writeDailyNote(this.app, when, (text) => insertUnderHeading(text, 'Tasks', line));
  }
  open(item, newTab) { const f = this.app.vault.getAbstractFileByPath(item.ext.file); if (f instanceof TFile) this.app.workspace.getLeaf(newTab ? 'tab' : false).openFile(f, { eState: { line: item.ext.line } }); }
}

// HTTP through Obsidian's requestUrl (works on phones, no CORS). An answer of 400+ becomes an error with
// its status; nothing about the key is ever logged.
async function call(url, method, headers, body) {
  let r;
  try { r = await requestUrl({ url, method: method || 'GET', headers, contentType: body ? 'application/json' : undefined, body: body ? JSON.stringify(body) : undefined, throw: false }); } catch { throw new Error('network'); }
  if (r.status >= 400) throw Object.assign(new Error('http'), { status: r.status });
  try { return r.json; } catch { return null; }
}

class RemoteSource extends Source {
  key() { return keyOf(this.app, this.id); }
  needKey() { if (!this.key()) throw Object.assign(new Error('no key'), { plain: `Paste your ${this.name()} key in Settings › LifeWorld › Tasks to see your tasks here.` }); }
  open(item) { if (/^https:\/\//i.test(item.ext.url || '')) window.open(item.ext.url); } // ClickUp's url comes from its answer
  async after(run) { try { await run(); } catch (e) { this.error = this.message(e); this.changed(); throw Object.assign(new Error(this.error), { plain: this.error }); } await this.reload(); }
}

const TODOIST = 'https://api.todoist.com/api/v1';
class TodoistSource extends RemoteSource {
  constructor(plugin) { super(plugin, 'todoist'); }
  h() { return { Authorization: `Bearer ${this.key()}` }; }
  async fetch() {
    this.needKey();
    const out = []; let cursor = null;
    for (let page = 0; page < 10; page++) {
      const q = `query=${encodeURIComponent('today | overdue')}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const r = await call(`${TODOIST}/tasks/filter?${q}`, 'GET', this.h());
      for (const t of (r && r.results) || []) out.push(fromTodoist(t));
      cursor = r && r.next_cursor; if (!cursor) break;
    }
    return out;
  }
  toggle(item) { const done = item.status !== 'done'; return this.after(() => call(`${TODOIST}/tasks/${encodeURIComponent(item.ext.id)}/${done ? 'close' : 'reopen'}`, 'POST', this.h())).then(() => done); }
  // A plain due date would end a repeat (Todoist reads the repeat from the due words), so those stay put.
  place(item, day) {
    if (item.ext && item.ext.recurring) return Promise.reject(Object.assign(new Error('recurring'), { plain: `"${item.title}" repeats in Todoist. Move it there to keep its repeat.` }));
    return this.after(() => call(`${TODOIST}/tasks/${encodeURIComponent(item.ext.id)}`, 'POST', this.h(), day ? (item.time ? { due_datetime: `${day}T${item.time}:00` } : { due_date: day }) : { due_string: 'no date' }));
  }
  create({ title, day, time }) { this.needKey(); return this.after(() => call(`${TODOIST}/tasks`, 'POST', this.h(), { content: title, ...(day ? (time ? { due_datetime: `${day}T${time}:00` } : { due_date: day }) : {}) })); }
}

const CLICKUP = 'https://api.clickup.com/api/v2';
// The end of today, in Unix ms (ClickUp filters by due date with it).
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
class ClickUpSource extends RemoteSource {
  constructor(plugin) { super(plugin, 'clickup'); this.statuses = new Map(); }
  h() { return { Authorization: this.key() }; }
  async who() {
    if (this.me && this.me.key === this.key()) return this.me;
    const u = await call(`${CLICKUP}/user`, 'GET', this.h());
    const t = await call(`${CLICKUP}/team`, 'GET', this.h());
    this.me = { key: this.key(), user: u && u.user ? u.user.id : null, teams: ((t && t.teams) || []).map((x) => x.id) };
    return this.me;
  }
  async fetch() {
    this.needKey();
    const me = await this.who();
    const out = []; const lists = new Map();
    for (const team of me.teams) {
      for (let page = 0; page < 5; page++) {
        const q = `page=${page}&subtasks=true&due_date_lt=${endOfToday()}${me.user ? `&assignees[]=${encodeURIComponent(me.user)}` : ''}`;
        const r = await call(`${CLICKUP}/team/${encodeURIComponent(team)}/task?${q}`, 'GET', this.h());
        const tasks = (r && r.tasks) || [];
        for (const t of tasks) { out.push(fromClickUp(t)); if (t.list) lists.set(String(t.list.id), String(t.list.name || 'List')); }
        if (r && r.last_page !== false) break;
      }
    }
    this.lists = lists;
    return out;
  }
  // The list's closed and first open status (statuses are per list in ClickUp).
  async statusFor(list, closed) {
    if (!this.statuses.has(list)) { const l = await call(`${CLICKUP}/list/${encodeURIComponent(list)}`, 'GET', this.h()); this.statuses.set(list, (l && l.statuses) || []); }
    const s = this.statuses.get(list);
    const hit = closed ? s.find((x) => x.type === 'closed') || s.find((x) => x.type === 'done') : s.find((x) => x.type === 'open') || s[0];
    if (!hit) throw Object.assign(new Error('status'), { plain: 'ClickUp has no matching status on that list.' });
    return hit.status;
  }
  toggle(item) { const done = item.status !== 'done'; return this.after(async () => call(`${CLICKUP}/task/${encodeURIComponent(item.ext.id)}`, 'PUT', this.h(), { status: await this.statusFor(item.ext.list, done) })).then(() => done); }
  place(item, day) {
    const ms = day ? (item.time ? moment(`${day}T${item.time}`).valueOf() : moment(`${day}T12:00`).valueOf()) : null;
    return this.after(() => call(`${CLICKUP}/task/${encodeURIComponent(item.ext.id)}`, 'PUT', this.h(), { due_date: ms, due_date_time: !!(day && item.time) }));
  }
  // New tasks go to the list picked in Settings, else the list of the newest task read.
  newList() { const s = this.plugin.settings.cuList; return s || (this.lists && this.lists.size ? [...this.lists.keys()][0] : null); }
  create({ title, day, time }) {
    this.needKey();
    const list = this.newList();
    if (!list) return Promise.reject(Object.assign(new Error('no list'), { plain: 'Pick the ClickUp list for new tasks in Settings › LifeWorld › Tasks.' }));
    const ms = day ? moment(`${day}T${time || '12:00'}`).valueOf() : null;
    return this.after(() => call(`${CLICKUP}/list/${encodeURIComponent(list)}/task`, 'POST', this.h(), { name: title, ...(ms ? { due_date: ms, due_date_time: !!time } : {}) }));
  }
}

// Things 3 through its AppleScript (Mac only, decided 2026-10-19). The list "Today" holds today's and
// overdue to-dos. Things keeps no clock time a script can read, so its to-dos sit in Morning.
// shortcut: Things' built-in list names are English here; Things in another language names them
// differently (its docs say so). Upgrade with a per-language list if someone needs it.
const THINGS_READ = `tell application "System Events" to set running to (exists process "Things3")
if not running then return "NOT_RUNNING"
set out to ""
tell application "Things3"
  repeat with t in to dos of list "Today"
    set d to due date of t
    set a to activation date of t
    set p to ""
    try
      set p to name of project of t
    end try
    set out to out & (id of t) & (ASCII character 31) & (name of t) & (ASCII character 31) & (status of t as text) & (ASCII character 31) & my ymd(d) & (ASCII character 31) & my ymd(a) & (ASCII character 31) & p & (ASCII character 30)
  end repeat
end tell
return out
on ymd(d)
  if d is missing value then return ""
  return ((year of d) as text) & "-" & text -2 thru -1 of ("0" & ((month of d) as integer)) & "-" & text -2 thru -1 of ("0" & (day of d))
end ymd`;
const asText = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]+/g, ' ')}"`;
// An AppleScript date for 'YYYY-MM-DD', built from numbers (a date string would depend on the Mac's language).
const asDate = (day) => { const [y, m, d] = day.split('-').map(Number); return `(my mk(${y}, ${m}, ${d}))`; };
const MK = `on mk(y, m, d)
  set t to current date
  set day of t to 1
  set year of t to y
  set month of t to m
  set day of t to d
  set time of t to 0
  return t
end mk`;

function parseThings(out) {
  return String(out || '').split('\u001e').filter((x) => x.trim()).map((row) => { const [id, name, status, deadline, start, project] = row.split('\u001f'); return { id, name, status, deadline: deadline || null, start: start || null, project: project || null }; });
}

class ThingsSource extends Source {
  constructor(plugin) { super(plugin, 'things'); }
  run(script) {
    if (!(Platform.isMacOS && Platform.isDesktopApp)) return Promise.reject(Object.assign(new Error('mac'), { plain: 'Things tasks show only on a Mac.' }));
    // Desktop only: Node's child_process, loaded on demand so phones never touch it.
    const { execFile } = window.require('child_process');
    return new Promise((resolve, reject) => {
      execFile('osascript', ['-e', script], { timeout: 15000 }, (err, stdout) => {
        if (err) reject(Object.assign(new Error('osascript'), { plain: /-1743|not allowed/i.test(String(err.message)) ? 'macOS has not allowed Obsidian to use Things yet. Allow it in System Settings › Privacy & Security › Automation.' : 'Things did not answer. Open Things, then try again.' }));
        else resolve(String(stdout).replace(/\n$/, ''));
      });
    });
  }
  async fetch() {
    const out = await this.run(THINGS_READ);
    if (out === 'NOT_RUNNING') throw Object.assign(new Error('not running'), { plain: 'Things is not open. Open Things to see its to-dos here.' });
    return parseThings(out).map(fromThings);
  }
  async after(run) { try { await run(); } catch (e) { this.error = this.message(e); this.changed(); throw e; } await this.reload(); }
  toggle(item) { const done = item.status !== 'done'; return this.after(() => this.run(`tell application "Things3" to set status of to do id ${asText(item.ext.id)} to ${done ? 'completed' : 'open'}`)).then(() => done); }
  place(item, day) {
    const script = day ? `${MK}\ntell application "Things3" to schedule to do id ${asText(item.ext.id)} for ${asDate(day)}` : `tell application "Things3" to move to do id ${asText(item.ext.id)} to list "Anytime"`;
    return this.after(() => this.run(script));
  }
  create({ title, day }) {
    const today = dayOf(new Date());
    const script = !day || day === today ? `tell application "Things3" to make new to do with properties {name:${asText(title)}} at beginning of list "Today"`
      : `${MK}\ntell application "Things3"\n  set t to make new to do with properties {name:${asText(title)}}\n  schedule t for ${asDate(day)}\nend tell`;
    return this.after(() => this.run(script));
  }
  open(item) { window.open(item.ext.url); }
}

// Things is offered only on a Mac (criterion 17).
const thingsOffered = () => !!(Platform.isMacOS && Platform.isDesktopApp && !Platform.isMobile);

function makeSource(plugin, id) {
  if (id === 'checkbox') return new CheckboxSource(plugin);
  if (id === 'todoist') return new TodoistSource(plugin);
  if (id === 'clickup') return new ClickUpSource(plugin);
  if (id === 'things') return new ThingsSource(plugin);
  return null;
}

export { parseCheckbox, setDateSign, toggleCheckboxLine, cleanTag, hasTag, newCheckboxLine, extItem, isExtPath, fromTodoist, fromClickUp, fromThings, parseThings, keyOf, setKey, SOURCE_NAMES, thingsOffered, makeSource, CheckboxSource, TodoistSource, ClickUpSource, ThingsSource, THINGS_READ };
