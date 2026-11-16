// Typed bullets (Tana-style bullets job, 2026-11-10): the rules with no Obsidian in them, so the tests
// run them directly. A type labels one bullet ("- text #Decision"); its fields are child lines
// "Field:: value" (kept in the note) or the properties of a note of its own (Person). Plain Markdown,
// the same "Field:: value" form Dataview reads.
'use strict';

/** @typedef {{ name: string, kind: 'text' | 'date' | 'choice' | 'link', options?: string[], default?: string }} BtField */
/** @typedef {{ name: string, color: string, aliases: string[], fields: BtField[], where: 'note' | 'folder', folder?: string, props?: Record<string, string> }} BtType */

// The theme's own colors (Obsidian's --color-* variables), so both the light and dark theme fit.
const COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
const KINDS = /** @type {const} */ (['text', 'date', 'choice', 'link']);
const KIND_NAMES = { text: 'Text', date: 'Date', choice: 'Choice', link: 'Link to a note' };
// Built in: makes a real task note (criterion 2). Never saved, never removed.
const TASK = 'task';

/** @returns {BtType[]} */
function starterTypes() {
  return [
    { name: 'Person', color: 'orange', aliases: ['contact', 'people'], where: 'folder', folder: '', props: { type: 'person' },
      fields: [{ name: 'Company', kind: 'link' }, { name: 'Email', kind: 'text' }] },
    { name: 'Decision', color: 'purple', aliases: [], where: 'note',
      fields: [{ name: 'Decided by', kind: 'text' }, { name: 'Final', kind: 'choice', options: ['not yet', 'yes'] }] },
  ];
}

/** @param {unknown} s */
const low = (s) => String(s || '').trim().toLowerCase();

// A saved list cleaned up: bad entries dropped, missing parts filled, names unique (first wins), never "task".
/** @typedef {{ name?: unknown, kind?: unknown, options?: unknown, default?: unknown }} RawField */
/** @typedef {{ name?: unknown, color?: unknown, aliases?: unknown, fields?: unknown, where?: unknown, folder?: unknown, props?: unknown }} RawType */
/** @param {unknown} raw @returns {BtType[]} */
function cleanTypes(raw) {
  if (!Array.isArray(raw)) return starterTypes();
  /** @param {unknown} v @returns {unknown[]} */
  const arr = (v) => (Array.isArray(v) ? v : []);
  /** @type {Set<string>} */
  const seen = new Set([TASK]);
  /** @type {BtType[]} */
  const out = [];
  for (const t of /** @type {(RawType | null)[]} */ (raw)) {
    if (!t || typeof t !== 'object') continue;
    const name = tagName(String(t.name || ''));
    if (!name || seen.has(low(name))) continue;
    seen.add(low(name));
    const fields = /** @type {(RawField | null)[]} */ (arr(t.fields)).flatMap((f) => {
      const fname = f && typeof f.name === 'string' ? f.name.trim() : '';
      if (!f || !fname || /[:\n]/.test(fname)) return [];
      const kind = /** @type {BtField['kind']} */ (KINDS.find((k) => k === f.kind) || 'text');
      /** @type {BtField} */
      const c = { name: fname, kind };
      if (kind === 'choice') c.options = arr(f.options).map((o) => String(o).trim()).filter(Boolean);
      if (typeof f.default === 'string' && f.default.trim()) c.default = f.default.trim();
      return [c];
    });
    /** @type {BtType} */
    const c = { name, color: COLORS.find((x) => x === t.color) || 'blue', aliases: arr(t.aliases).map((a) => tagName(String(a))).filter((a) => a && low(a) !== low(name) && low(a) !== TASK), fields, where: t.where === 'folder' ? 'folder' : 'note' };
    if (c.where === 'folder') {
      c.folder = typeof t.folder === 'string' ? t.folder.trim().replace(/^\/+|\/+$/g, '') : '';
      c.props = t.props && typeof t.props === 'object' ? Object.fromEntries(Object.entries(t.props).filter(([k, v]) => k.trim() && typeof v === 'string').map(([k, v]) => [k.trim(), String(v)])) : {};
    }
    out.push(c);
  }
  return out;
}

// What a tag may hold (Obsidian's own tag rules, less nesting): letters, digits, _ and -; not all digits.
/** @param {unknown} s */
function tagName(s) {
  const t = String(s || '').trim().replace(/^#/, '');
  return /^[\p{L}\p{N}_-]+$/u.test(t) && !/^\d+$/.test(t) ? t : '';
}

// The type a tag means: its name or one of its other names, any case. task -> 'task'.
/** @param {BtType[]} types @param {string} tag @returns {BtType | 'task' | null} */
function typeFor(types, tag) {
  const x = low(tag);
  if (x === TASK) return TASK;
  return types.find((t) => low(t.name) === x) || types.find((t) => t.aliases.some((a) => low(a) === x)) || null;
}

// Edit distance (a swap of two letters next to each other counts as one), stopping early above max.
/** @param {string} a @param {string} b @param {number} max */
function distance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  /** @type {number[]} */
  let before = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], before[j - 2] + 1);
    }
    if (Math.min(...cur) > max) return max + 1;
    before = prev; prev = cur;
  }
  return prev[b.length];
}

// "Small spelling distance" (criterion 10.2): 1 for short names, 2 from 6 letters; a plural s counts as none.
/** @param {string} typed @param {string} name */
function near(typed, name) {
  const a = low(typed); const b = low(name);
  if (!a || a === b) return false;
  if (a.replace(/e?s$/, '') === b || b.replace(/e?s$/, '') === a) return true;
  return a.length >= 3 && distance(a, b, 2) <= (Math.max(a.length, b.length) >= 6 ? 2 : 1);
}

// The # menu (criterion 10), in order: types whose name or other name starts with what was typed, then
// "did you mean" for near spellings, then Create type. Nothing typed: every type. A whole match on a
// name or other name hides Create (it would make a duplicate).
/** @typedef {{ kind: 'type', type: BtType | 'task', alias?: string, near?: boolean } | { kind: 'create', name: string }} BtChoice */
/** @param {BtType[]} types @param {string} typed @returns {BtChoice[]} */
function menuFor(types, typed) {
  const q = low(typed);
  /** @type {BtChoice[]} */
  const out = [];
  /** @type {Set<unknown>} */
  const taken = new Set();
  const all = [/** @type {BtType | 'task'} */ (TASK), ...types];
  const nameOf = (/** @type {BtType | 'task'} */ t) => (t === TASK ? TASK : t.name);
  for (const t of all) if (low(nameOf(t)).startsWith(q)) { out.push({ kind: 'type', type: t }); taken.add(t); }
  if (q) for (const t of types) {
    if (taken.has(t)) continue;
    const a = t.aliases.find((x) => low(x).startsWith(q));
    if (a) { out.push({ kind: 'type', type: t, alias: a }); taken.add(t); }
  }
  if (q) for (const t of all) {
    if (taken.has(t)) continue;
    if ([nameOf(t), ...(t === TASK ? [] : t.aliases)].some((n) => near(q, n))) { out.push({ kind: 'type', type: t, near: true }); taken.add(t); }
  }
  const name = tagName(typed);
  if (name && !typeFor(types, name)) out.push({ kind: 'create', name });
  return out;
}

// Another type that already makes notes in this folder (criterion 10.3's warning), or null.
/** @param {BtType[]} types @param {string} folder @param {string} [except] */
function folderOwner(types, folder, except) {
  const f = low(String(folder).replace(/^\/+|\/+$/g, ''));
  return types.find((t) => t.where === 'folder' && t.folder && low(t.folder) === f && low(t.name) !== low(except)) || null;
}

// The folder an own-note type's notes already live in, for a type with no folder yet (criterion 14): the
// one holding the most notes with its starting properties, else the fullest folder named after the type or
// one of its other names (People, Contacts, Persons). '' when there is none.
/** @param {BtType} type @param {{ path: string, fm?: Record<string, unknown> | null }[]} notes */
function guessFolder(type, notes) {
  // up: a note also counts for the folders above it, so notes spread over subfolders give the folder they
  // share; on a tie the deeper folder wins (Contacts/People over Contacts).
  /** @param {(x: { path: string, fm?: Record<string, unknown> | null }, dir: string) => boolean} keep @param {boolean} up */
  const fullest = (keep, up) => {
    /** @type {Map<string, number>} */
    const n = new Map();
    for (const x of notes) {
      let dir = x.path.slice(0, Math.max(0, x.path.lastIndexOf('/')));
      if (!dir || !keep(x, dir)) continue;
      for (; dir; dir = up ? dir.slice(0, Math.max(0, dir.lastIndexOf('/'))) : '') n.set(dir, (n.get(dir) || 0) + 1);
    }
    return [...n].sort((a, b) => b[1] - a[1] || b[0].split('/').length - a[0].split('/').length)[0]?.[0] || '';
  };
  // An empty starting value says nothing about a note; a list value matches when it holds the value.
  const props = Object.entries(type.props || {}).filter(([, v]) => low(v));
  const has = (/** @type {unknown} */ x, /** @type {unknown} */ v) => (Array.isArray(x) ? x.some((y) => low(y) === low(v)) : low(x) === low(v));
  const names = [type.name, ...type.aliases].flatMap((w) => [low(w), `${low(w)}s`, `${low(w)}es`]);
  return (props.length && fullest((x) => props.every(([k, v]) => has(x.fm && x.fm[k], v)), true))
    || fullest((_, dir) => names.includes(low(dir.slice(dir.lastIndexOf('/') + 1))), false);
}

/* ---- lines -------------------------------------------------------------------------------------------- */

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(\[.\]\s+)?(.*)$/;
// A list line: its indent (tabs as 4), marker and text. null: not a list line.
/** @param {string} line */
function listLine(line) {
  const m = LIST_RE.exec(line);
  if (!m) return null;
  return { indent: m[1], depth: m[1].replace(/\t/g, '    ').length, text: m[4], textAt: line.length - m[4].length };
}

// The type tag at the end of a list line: "- Favourites page #Decision" -> { tag, at, text }. at is the
// tag's offset in the line (its #). The last word only, so a tag in the middle of the text stays plain.
/** @param {string} line */
function tagAtEnd(line) {
  const l = listLine(line);
  if (!l) return null;
  const m = /(^|\s)#([\p{L}\p{N}_-]+)\s*$/u.exec(l.text);
  if (!m || /^\d+$/.test(m[2])) return null;
  const at = l.textAt + m.index + m[1].length;
  return { tag: m[2], at, end: at + 1 + m[2].length, text: l.text.slice(0, m.index).trim(), depth: l.depth, indent: l.indent };
}

// Any line as a task source (criterion 13): a list line, else the whole line after its indent.
/** @param {string} line */
function anyLine(line) {
  const l = listLine(line);
  if (l) return l;
  const indent = /^\s*/.exec(line)[0];
  return { indent, depth: indent.replace(/\t/g, '    ').length, text: line.slice(indent.length), textAt: indent.length };
}

// People for "@query" (criterion 12): name or alias has a word starting with it, names that start with it first.
/** @template {{ name: string, aliases: string[] }} P @param {P[]} people @param {string} typed @returns {P[]} */
function peopleFor(people, typed) {
  const q = low(typed);
  const hit = (/** @type {string} */ n) => low(n).split(/[\s.-]+/).some((w) => w.startsWith(q));
  const out = people.filter((p) => !q || [p.name, ...p.aliases].some(hit));
  const rank = (/** @type {P} */ p) => (low(p.name).startsWith(q) ? 0 : 1);
  return out.sort((x, y) => rank(x) - rank(y) || x.name.localeCompare(y.name));
}

const FIELD_RE = /^(\s*)([-*+])(\s+)([^:\n]*?[^:\s]):: ?(.*)$/;
// A field line "  - Decided by:: Mara" -> { name, value, nameAt, valueAt, depth }.
/** @param {string} line */
function fieldLine(line) {
  const m = FIELD_RE.exec(line);
  if (!m) return null;
  return { name: m[4].trim(), value: m[5].trim(), nameAt: m[1].length + m[2].length + m[3].length, valueAt: line.length - m[5].length, depth: m[1].replace(/\t/g, '    ').length };
}

// The field lines straight under the tagged bullet on line i: its own children only (not grandchildren),
// stopping at the first line that is not deeper. -> [{ line, ...fieldLine }]
/** @param {string[]} lines @param {number} i */
function fieldsUnder(lines, i) {
  const head = listLine(lines[i]);
  if (!head) return [];
  const out = [];
  let child = -1;
  for (let j = i + 1; j < lines.length; j++) {
    if (!lines[j].trim()) break;
    const l = listLine(lines[j]);
    if (!l || l.depth <= head.depth) break;
    if (child < 0) child = l.depth;
    const f = l.depth === child ? fieldLine(lines[j]) : null;
    if (f) out.push({ line: j, ...f });
  }
  return out;
}

// The child indent for a bullet's indent: one more tab, or four more spaces when it is indented with spaces.
/** @param {string} indent */
const childIndent = (indent) => (/ /.test(indent) ? `${indent}    ` : `${indent}\t`);

// The field lines to add under a bullet, skipping those already there (criterion 2: never duplicated).
/** @param {BtType} type @param {string} indent @param {string[]} have field names already under it */
function fieldLinesFor(type, indent, have) {
  const h = new Set(have.map(low));
  return type.fields.filter((f) => !h.has(low(f.name))).map((f) => `${childIndent(indent)}- ${f.name}:: ${f.default || ''}`);
}

// The code fence open after this line ('' = none): a fence closes only on the same character, as long or longer.
/** @param {string} fence @param {string} line */
function fenceAfter(fence, line) {
  const f = /^\s*(`{3,}|~{3,})/.exec(line);
  if (!f) return fence;
  if (!fence) return f[1];
  // Only a bare fence line closes ("```js" inside a block does not).
  return f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim() ? '' : fence;
}

// Every bullet of one type in a note's text: [{ line, text, fields: { name -> value } }]. Code blocks skipped.
/** @param {string} text @param {BtType} type */
function bulletsIn(text, type) {
  const lines = text.split('\n');
  const out = [];
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const was = fence;
    fence = fenceAfter(fence, lines[i]);
    if (was || fence) continue;
    const t = tagAtEnd(lines[i]);
    if (!t) continue;
    const wanted = low(t.tag) === low(type.name) || type.aliases.some((a) => low(a) === low(t.tag));
    if (!wanted) continue;
    /** @type {Record<string, string>} */
    const fields = {};
    for (const fl of fieldsUnder(lines, i)) if (!(low(fl.name) in fields)) fields[low(fl.name)] = fl.value;
    out.push({ line: i, text: t.text, fields });
  }
  return out;
}

// A property name for a field of a type with its own note: "Decided by" -> "decided_by".
/** @param {string} name */
const propKey = (name) => low(name).replace(/\s+/g, '_');

/* ---- live list (criterion 5) --------------------------------------------------------------------------- */

/** @typedef {{ field: string, not: boolean, value: string }} BtWhere */
/** @typedef {{ type: BtType, where: BtWhere[], project: boolean, sort: { field: string, desc: boolean } | null }} BtQuery */

// The block's lines -> the query, or { error } in plain words.
/** @param {string} src @param {BtType[]} types @returns {BtQuery | { error: string }} */
function parseQuery(src, types) {
  const names = () => { const n = [TASK, ...types.map((t) => t.name)]; return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]; };
  /** @type {Partial<BtQuery> & { where: BtWhere[] }} */
  const q = { where: [], project: false, sort: null };
  let typeName = '';
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const m = /^([a-z]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) return { error: `This line is not understood: "${line}". Each line starts with type:, where:, project: or sort:.` };
    const key = low(m[1]); const val = m[2].trim();
    if (key === 'type') typeName = val.replace(/^#/, '');
    else if (key === 'where') {
      const w = /^(.+?)\s+is\s+(not\s+)?(.*)$/i.exec(val);
      if (!w) return { error: `"where: ${val}" is not understood. Write it like "where: Final is not yet" or "where: Email is not empty".` };
      q.where.push({ field: w[1].trim(), not: !!w[2], value: w[3].trim() });
    } else if (key === 'project') {
      if (!/^(this( one| project)?|yes)$/i.test(val)) return { error: `"project: ${val}" is not understood. Write "project: this one" for bullets in this project's notes.` };
      q.project = true;
    } else if (key === 'sort') {
      const s = /^(.*?)(\s+(desc|descending|z to a|newest first))?$/i.exec(val);
      q.sort = val ? { field: /** @type {RegExpExecArray} */ (s)[1].trim(), desc: !!(/** @type {RegExpExecArray} */ (s)[2]) } : null;
    } else return { error: `"${m[1]}:" is not something the list knows. Use type:, where:, project: or sort:.` };
  }
  if (!typeName) return { error: `Say which type to list, for example "type: Decision". Your types are ${names()}.` };
  if (low(typeName) === TASK) return { error: 'Tasks have their own lists in Today, the Planner and Projects. Pick another type here.' };
  const type = typeFor(types, typeName);
  if (!type || type === TASK) return { error: `There is no type called ${typeName}. Your types are ${names()}.` };
  const fieldNames = ['bullet', 'note', ...type.fields.map((f) => low(f.name))];
  for (const w of q.where) {
    if (!fieldNames.includes(low(w.field))) return { error: `${type.name} has no field called ${w.field}. Its fields are ${type.fields.map((f) => f.name).join(', ') || 'none yet'}.` };
    // "Final is not yet": a choice that itself starts with "not" is the value, not "is not" + "yet".
    const f = type.fields.find((x) => low(x.name) === low(w.field));
    if (w.not && f && (f.options || []).some((o) => low(o) === low(`not ${w.value}`))) { w.not = false; w.value = `not ${w.value}`; }
  }
  if (q.sort && q.sort.field && !fieldNames.includes(low(q.sort.field))) return { error: `Can't sort by ${q.sort.field}: ${type.name} has no field by that name.` };
  return { type, where: q.where, project: !!q.project, sort: q.sort && q.sort.field ? q.sort : null };
}

// A row passes every where line. "is empty" / "is not empty" test for a value at all; otherwise the
// value is compared as text, any case, links shown as their name.
/** @param {{ text: string, note: string, fields: Record<string, string> }} row @param {BtWhere[]} where */
function rowMatches(row, where) {
  return where.every((w) => {
    const k = low(w.field);
    const v = low(plain(k === 'bullet' ? row.text : k === 'note' ? row.note : row.fields[k] || ''));
    const hit = low(w.value) === 'empty' ? v === '' : v === low(plain(w.value));
    return w.not ? !hit : hit;
  });
}

// A value as shown: [[Note|Alias]] -> Alias, [[Folder/Note]] -> Note.
/** @param {string} v */
function plain(v) {
  return String(v || '').replace(/\[\[([^\]|]*?)(?:\|([^\]]*))?\]\]/g, (_, /** @type {string} */ p, /** @type {string | undefined} */ a) => a || String(p.split('/').pop()));
}

/** @template {{ text: string, note: string, fields: Record<string, string> }} R @param {R[]} rows @param {{ field: string, desc: boolean } | null} sort */
function sortRows(rows, sort) {
  if (!sort) return rows;
  const k = low(sort.field);
  /** @param {R} r */
  const val = (r) => plain(k === 'bullet' ? r.text : k === 'note' ? r.note : r.fields[k] || '');
  // Empty values last either way.
  return rows.slice().sort((a, b) => { const x = val(a); const y = val(b); if (!x || !y) return (!x ? 1 : 0) - (!y ? 1 : 0); const c = x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }); return sort.desc ? -c : c; });
}

// Up to two initials for the person pill: "Mara" -> "MA", "Ada Lovelace" -> "AL".
/** @param {string} name */
function initials(name) {
  const w = String(name || '').trim().split(/\s+/).filter((x) => /[\p{L}\p{N}]/u.test(x));
  if (!w.length) return '?';
  if (w.length === 1) return Array.from(w[0].replace(/[^\p{L}\p{N}]/gu, '')).slice(0, 2).join('').toUpperCase();
  return (Array.from(w[0])[0] + Array.from(w[w.length - 1])[0]).toUpperCase();
}

export { COLORS, KINDS, KIND_NAMES, TASK, fenceAfter, starterTypes, cleanTypes, tagName, typeFor, distance, near, menuFor, folderOwner, guessFolder, listLine, anyLine, peopleFor, tagAtEnd, fieldLine, fieldsUnder, childIndent, fieldLinesFor, bulletsIn, propKey, parseQuery, rowMatches, plain, sortRows, initials };
