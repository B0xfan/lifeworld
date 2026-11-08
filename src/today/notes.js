// Today notes (1.5.0, mockup A approved 2026-11-08): notes that stay on the Today page until ticked off.
// They live in one ordinary note, one list line per note, the date first, in three sections:
//   ## Pinned  /  ## Notes  /  ## Done
// Plain "- " lines, never "- [ ]", so no task source reads them as tasks. These functions only edit text;
// the card writes through app.vault.process, so the whole read-change-write is one step.
'use strict';

import { MONTHS_SHORT, WEEKDAYS_SHORT, weekdayOf, partsOf } from '../core/dates';

// Top-level list lines only: an indented sub-line stays with the note above it.
const LINE = /^[-*+][ \t]+(?!\[[ xX]\])(.*)$/;
const DATED = /^\[\[(\d{4}-\d{2}-\d{2})(?:\|[^\]]*)?\]\][ \t]*/;

// The "## <name>" section: from the end of its heading line to the next # or ## heading, code blocks
// and frontmatter skipped. -> { start, end } character offsets, or null when the note has none.
/** @param {string} s @param {string} name */
function sectionRange(s, name) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/.exec(s);
  const head = new RegExp(`^##[ \\t]+${name}[ \\t]*\\r?$`, 'i');
  let pos = 0; let fence = false; let start = -1;
  for (const line of s.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    else if (!fence && pos >= (fm ? fm[0].length : 0)) {
      if (start < 0) { if (head.test(line)) start = pos + line.length; }
      else if (/^#{1,2}[ \t]/.test(line)) return { start, end: pos };
    }
    pos += line.length + 1;
  }
  return start < 0 ? null : { start, end: s.length };
}

// What the box typed becomes: one line, ends trimmed.
/** @param {unknown} text */
const noteLine = (text) => String(text == null ? '' : text).replace(/\s*[\r\n]+\s*/g, ' ').trim();

// s with `line` as the last line of section `name` (the section added at the end when missing).
// Only adds text: every existing character stays where it was.
/** @param {string} s @param {string} name @param {string} line */
function appendToSection(s, name, line) {
  const r = sectionRange(s, name);
  if (!r) return `${s}${s && !s.endsWith('\n') ? '\n' : ''}${s.trim() ? '\n' : ''}## ${name}\n${line}\n`;
  let at = r.end;
  while (at > r.start && /\s/.test(s[at - 1])) at--;
  const tail = s.slice(at);
  return `${s.slice(0, at)}\n${line}${tail.startsWith('\n') ? '' : '\n'}${tail}`;
}

// A new note dated `day`, the last line under "## Notes". -> the new text, or null when the box is empty.
/** @param {string} s @param {string} day @param {unknown} text */
function addNote(s, day, text) {
  const t = noteLine(text);
  return t ? appendToSection(String(s || ''), 'Notes', `- [[${day}]] ${t}`) : null;
}

// Every note line of one section, file order: { section, raw (the whole line), day, text }.
/** @param {string} s @param {string} name */
function sectionNotes(s, name) {
  const r = sectionRange(s, name);
  if (!r) return [];
  /** @type {{ section: string, raw: string, day: string, text: string }[]} */
  const out = [];
  let fence = false;
  for (const raw of s.slice(r.start, r.end).split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    const m = !fence && LINE.exec(raw.replace(/\r$/, ''));
    if (!m || !m[1].trim()) continue;
    const d = DATED.exec(m[1]);
    out.push({ section: name, raw: raw.replace(/\r$/, ''), day: d ? d[1] : '', text: (d ? m[1].slice(d[0].length) : m[1]).trim() });
  }
  return out;
}

// What the card shows: the pinned notes in file order, then the open ones newest first (same day:
// the later line first; undated last).
/** @param {unknown} text */
function readNotes(text) {
  const s = String(text || '').replace(/\r\n/g, '\n');
  const open = sectionNotes(s, 'Notes').reverse().sort((a, b) => b.day.localeCompare(a.day));
  return { pinned: sectionNotes(s, 'Pinned'), open };
}

// s with the note line `raw` taken out of section `from` and added as the last line of section `to`.
// -> the new text, or null when that exact line is no longer in `from` (changed by hand or by sync).
/** @param {string} s @param {string} from @param {string} raw @param {string} to */
function moveNote(s, from, raw, to) {
  const t = String(s || '');
  const r = sectionRange(t, from);
  if (!r) return null;
  const body = t.slice(r.start, r.end);
  const lines = body.split('\n');
  let fence = false;
  const i = lines.findIndex((l, k) => { if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return false; } return k > 0 && !fence && l.replace(/\r$/, '') === raw; });
  if (i < 0) return null;
  lines.splice(i, 1);
  const without = t.slice(0, r.start) + lines.join('\n') + t.slice(r.end);
  return appendToSection(without, to, raw.trim());
}

// A note's date as the card shows it: 'Today', else 'Fri, Nov 6'.
/** @param {string} day @param {string} today */
function noteDay(day, today) {
  if (!day) return '';
  if (day === today) return 'Today';
  const { m, d } = partsOf(day);
  return `${WEEKDAYS_SHORT[weekdayOf(day)]}, ${MONTHS_SHORT[m - 1]} ${d}`;
}

// The notes file setting: a note path ending in .md, else the default (also for a name Obsidian or the
// disk refuses, or a hidden or config folder).
const NOTES_FILE = 'Today notes.md';
/** @param {unknown} v */
function normalizeNotesFile(v) {
  const p = typeof v === 'string' ? v.trim().replace(/^\/+|\/+$/g, '') : '';
  if (!p || /[\\:*?"<>|#^[\]]/.test(p) || p.split('/').some((x) => !x || x.startsWith('.'))) return NOTES_FILE;
  return p.toLowerCase().endsWith('.md') ? p : `${p}.md`;
}

const NOTES_PREVIEW = 3;

export { sectionRange, noteLine, addNote, readNotes, moveNote, noteDay, normalizeNotesFile, NOTES_FILE, NOTES_PREVIEW };
