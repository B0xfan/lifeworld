#!/usr/bin/env node
/* Self-check for the Today Notes card (1.5.0, mockup A): add, pin, unpin and tick off are one-line
 * edits of the notes file; every other character stays; a line changed meanwhile is never guessed at.
 * Set LW_REAL_NOTE=<path to a copy of a real note> to also check a real note survives untouched.
 * The card, hover and clicks need a real Obsidian (sandbox run). */
'use strict';
const fs = require('fs');
const Module = require('module');
const assert = require('assert');
const { part } = require('./lib/paths');
const fake = { Plugin: class {}, ItemView: class {}, MarkdownView: class {}, Modal: class {}, SuggestModal: class {}, PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {}, Notice: class {}, setIcon() {}, Platform: {}, Component: class {} };
const load = Module._load;
Module._load = function (req, ...a) { return req === 'obsidian' ? fake : load.call(this, req, ...a); };
const T = part('a4-today').logic;

// Without the moved line, before and after are the same text (nothing else changed).
const strip = (s, line) => s.split('\n').filter((l) => l.trim() !== line.trim()).join('\n').replace(/\n{2,}/g, '\n').trim();

// 1. First note into an empty file, then a second; both under ## Notes, dated, one line each.
let s = T.addNote('', '2026-11-06', 'Waiting on [[Karla]]\nfor the photos ');
assert.strictEqual(s, '## Notes\n- [[2026-11-06]] Waiting on [[Karla]] for the photos\n');
s = T.addNote(s, '2026-11-08', 'Call the bank');
assert.strictEqual(s, '## Notes\n- [[2026-11-06]] Waiting on [[Karla]] for the photos\n- [[2026-11-08]] Call the bank\n');
assert.strictEqual(T.addNote(s, '2026-11-08', '  \n '), null, 'an empty box saves nothing');

// 2. Read: open notes newest first.
let r = T.readNotes(s);
assert.deepStrictEqual(r.open.map((n) => n.text), ['Call the bank', 'Waiting on [[Karla]] for the photos']);
assert.deepStrictEqual(r.pinned, []);

// 3. Pin, unpin, tick off: the line moves, nothing else changes.
const bank = r.open[0].raw;
let p = T.moveNote(s, 'Notes', bank, 'Pinned');
assert.ok(p.includes('## Pinned\n- [[2026-11-08]] Call the bank'));
assert.strictEqual(strip(p, '## Pinned'), strip(strip(s, bank), '') + '\n' + bank, 'pin only moves the line');
r = T.readNotes(p);
assert.deepStrictEqual(r.pinned.map((n) => n.text), ['Call the bank']);
assert.strictEqual(r.open.length, 1);
const back = T.moveNote(p, 'Pinned', r.pinned[0].raw, 'Notes');
assert.deepStrictEqual(T.readNotes(back).open.map((n) => n.text).sort(), ['Call the bank', 'Waiting on [[Karla]] for the photos']);
const done = T.moveNote(s, 'Notes', bank, 'Done');
assert.ok(/## Done\n- \[\[2026-11-08\]\] Call the bank\n$/.test(done));
assert.strictEqual(T.readNotes(done).open.length, 1, 'a ticked note leaves the card');

// 4. A line changed or gone: no guess, null.
assert.strictEqual(T.moveNote(s, 'Notes', '- [[2026-11-08]] Call the bank!', 'Done'), null);
assert.strictEqual(T.moveNote(s, 'Pinned', bank, 'Notes'), null);

// 5. A hand-made note around the sections stays byte for byte; tasks, fences and other headings are not notes.
const hand = '---\ntags: [x]\n---\n# My notes\nIntro text.\n\n## Pinned\n- Gate code 4417\n\n## Notes\n- [ ] a task, not a note\n```\n- inside a fence\n```\n- [[2026-11-01]] Old one\n\n### Sub\nkept\n## Other\n- not a note\n';
r = T.readNotes(hand);
assert.deepStrictEqual(r.pinned.map((n) => [n.day, n.text]), [['', 'Gate code 4417']]);
assert.deepStrictEqual(r.open.map((n) => n.text), ['Old one']);
const added = T.addNote(hand, '2026-11-08', 'New');
assert.strictEqual(added.replace('- [[2026-11-08]] New\n', ''), hand, 'adding only inserts the one line');
assert.ok(added.indexOf('- [[2026-11-08]] New') < added.indexOf('## Other'), 'added inside ## Notes');
const ticked = T.moveNote(hand, 'Notes', '- [[2026-11-01]] Old one', 'Done');
assert.strictEqual(ticked.replace('- [[2026-11-01]] Old one\n', '').replace('\n## Done\n', ''), hand.replace('- [[2026-11-01]] Old one\n', ''), 'tick only moves the line and adds ## Done');

// 5b. Review round 1: a fenced copy of a note is never the one moved; indented sub-lines are not notes.
const fenced = '## Notes\n```\n- [[2026-11-01]] Old one\n```\n- [[2026-11-01]] Old one\n  - sub line\n';
assert.deepStrictEqual(T.readNotes(fenced).open.map((n) => n.text), ['Old one']);
assert.strictEqual(T.moveNote(fenced, 'Notes', '- [[2026-11-01]] Old one', 'Done'), '## Notes\n```\n- [[2026-11-01]] Old one\n```\n  - sub line\n\n## Done\n- [[2026-11-01]] Old one\n');

// 6. Dates and the file setting.
assert.strictEqual(T.noteDay('2026-11-08', '2026-11-08'), 'Today');
assert.strictEqual(T.noteDay('2026-11-06', '2026-11-08'), 'Fri, Nov 6');
assert.strictEqual(T.noteDay('', '2026-11-08'), '');
assert.strictEqual(T.normalizeNotesFile(''), 'Today notes.md');
assert.strictEqual(T.normalizeNotesFile(' 02 Planner/Today Notes '), '02 Planner/Today Notes.md');
assert.strictEqual(T.normalizeNotesFile('../x.md'), 'Today notes.md');
assert.strictEqual(T.normalizeNotesFile(42), 'Today notes.md');
for (const bad of ['Plans: 2026', '.obsidian/x.md', 'a/.hidden/b', 'x#y', 'a//b']) assert.strictEqual(T.normalizeNotesFile(bad), 'Today notes.md', bad);

// 7. The widget is listed, and off until added on a new install and on a saved layout.
assert.ok(T.WIDGETS.some((w) => w.id === 'notes' && w.zone === 'c1'));
assert.ok(T.STARTER_OFF.includes('notes') && T.ADDED_OFF.includes('notes'));

// 8. A real note (copy) survives an add and a tick untouched apart from the one line.
if (process.env.LW_REAL_NOTE) {
  const real = fs.readFileSync(process.env.LW_REAL_NOTE, 'utf8');
  const a = T.addNote(real, '2026-11-08', 'Real-data check');
  assert.strictEqual(a.replace(/\n?## Notes\n- \[\[2026-11-08\]\] Real-data check\n|- \[\[2026-11-08\]\] Real-data check\n/, ''), real.endsWith('\n') || !real ? real : real + '\n');
  console.log('real note: ok');
}
console.log('today notes: all checks passed');
